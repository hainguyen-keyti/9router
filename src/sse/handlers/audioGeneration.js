import {
  extractApiKey, isValidApiKey,
  getProviderCredentials, markAccountUnavailable,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { getKeyAccessContext, enforceKeyAccess } from "../services/keyAccess.js";
import { handleAudioGenCore, prepareAudioGenRequest } from "open-sse/handlers/audioGenCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { handleComboChat } from "open-sse/services/combo.js";
import * as log from "../utils/logger.js";

// Providers that support a given kind and need stored credentials (derived from providers.js)
function credentialedProviders(kind) {
  return new Set(
    Object.entries(AI_PROVIDERS)
      .filter(([, p]) => p.serviceKinds?.includes(kind) && !p.noAuth)
      .map(([id]) => id)
  );
}

/**
 * Text-to-audio generation (sound effects / music). Same lifecycle as TTS:
 * API key → per-key access → combo expansion → per-account fallback loop.
 *
 * @param {Request} request
 * @param {"sfx"|"music"} kind
 */
export async function handleAudioGeneration(request, kind) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;
  // binary audio (default) | json → { audio: base64, format }
  const responseFormat = url.searchParams.get("response_format") || body.response_format || "binary";
  log.request("POST", `${url.pathname} | ${modelStr} | format=${responseFormat}`);

  const settings = await getSettings();
  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    const valid = await isValidApiKey(apiKey);
    if (!valid) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");

  // Per-key access control: requested target, before combo expansion.
  const keyAccessDenied = await enforceKeyAccess(await getKeyAccessContext(request), modelStr);
  if (keyAccessDenied) return keyAccessDenied;

  const handleSingle = (b, m) => handleSingleModel(b, m, kind, responseFormat);

  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    const comboStrategies = settings.comboStrategies || {};
    const comboStrategy = comboStrategies[modelStr]?.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("AUDIO", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: handleSingle,
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
    });
  }

  return handleSingle(body, modelStr);
}

async function handleSingleModel(body, modelStr, kind, responseFormat) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  log.info("ROUTING", `Provider: ${provider}, Model: ${model}, Kind: ${kind}`);

  // Reject bad input before picking (or burning) any account
  const prepared = prepareAudioGenRequest({ kind, provider, body });
  if (prepared.error) return prepared.error.response;

  // noAuth providers — no credential needed
  if (!credentialedProviders(kind).has(provider)) {
    const result = await handleAudioGenCore({ kind, provider, model, body, responseFormat });
    if (result.success) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Audio generation failed");
  }

  // Credentialed providers — fallback loop (same pattern as TTS)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${msg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const result = await handleAudioGenCore({ kind, provider, model, body, credentials, responseFormat });

    if (result.success) return result.response;

    // Upstream 400 (e.g. a prompt ElevenLabs rejects) is the same for every account — don't burn the pool.
    if (result.status === HTTP_STATUS.BAD_REQUEST) return result.response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return result.response || errorResponse(result.status, result.error);
  }
}
