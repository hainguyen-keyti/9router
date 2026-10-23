import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import {
  AUDIO_GEN_CONFIG_KEY,
  AUDIO_GEN_MAX_PROMPT_CHARS,
  AUDIO_GEN_RANGES,
  AUDIO_GEN_BOOL_PARAMS,
  AUDIO_GEN_DEFAULT_OUTPUT_FORMAT,
  AUDIO_GEN_OUTPUT_FORMATS,
  AUDIO_GEN_CODEC_MIME,
} from "../config/audioGenConfig.js";
import { getAudioGenAdapter } from "./audioGenProviders/index.js";
import { createAudioResponse } from "./ttsCore.js";

class ValidationError extends Error {}

// Picks the kind's params out of the client body and range-checks them. Only fields the
// client actually sent are returned, so upstream defaults apply to everything else.
function validateParams(kind, body) {
  const params = {};

  for (const [key, [min, max]] of Object.entries(AUDIO_GEN_RANGES[kind] || {})) {
    const raw = body[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < min || num > max) {
      throw new ValidationError(`${key} must be a number between ${min} and ${max}`);
    }
    params[key] = num;
  }

  for (const key of AUDIO_GEN_BOOL_PARAMS[kind] || []) {
    const raw = body[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (raw === true || raw === "true") params[key] = true;
    else if (raw === false || raw === "false") params[key] = false;
    else throw new ValidationError(`${key} must be a boolean`);
  }

  return params;
}

/**
 * Validate a request without touching credentials or the network, so callers can reject
 * bad input before picking an account.
 *
 * @returns {{ error: object } | { cfg, adapter, prompt, params, outputFormat }}
 *   `error` is a createErrorResult() value.
 */
export function prepareAudioGenRequest({ kind, provider, body = {} }) {
  const cfg = PROVIDER_MEDIA[provider]?.[AUDIO_GEN_CONFIG_KEY[kind]];
  const adapter = cfg && getAudioGenAdapter(cfg.format);
  if (!adapter) {
    return { error: createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support ${kind} generation.`) };
  }

  const prompt = String(body.prompt ?? body.input ?? "").trim();
  if (!prompt) return { error: createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt") };
  if (prompt.length > AUDIO_GEN_MAX_PROMPT_CHARS) {
    return { error: createErrorResult(HTTP_STATUS.BAD_REQUEST, `prompt must be at most ${AUDIO_GEN_MAX_PROMPT_CHARS} characters`) };
  }

  const outputFormat = body.output_format || AUDIO_GEN_DEFAULT_OUTPUT_FORMAT;
  if (!AUDIO_GEN_OUTPUT_FORMATS.has(outputFormat)) {
    return { error: createErrorResult(HTTP_STATUS.BAD_REQUEST, `Unsupported output_format: ${outputFormat}`) };
  }

  try {
    return { cfg, adapter, prompt, params: validateParams(kind, body), outputFormat };
  } catch (err) {
    if (err instanceof ValidationError) return { error: createErrorResult(HTTP_STATUS.BAD_REQUEST, err.message) };
    throw err;
  }
}

/**
 * Generate audio (sound effect or music) from a text prompt.
 *
 * @param {object} args
 * @param {"sfx"|"music"} args.kind
 * @param {string} args.provider - provider id (e.g. "elevenlabs")
 * @param {string} args.model - upstream model id
 * @param {object} args.body - client request body (`prompt` or `input`, plus kind params)
 * @param {object} [args.credentials] - { apiKey }
 * @param {string} [args.responseFormat] - "binary" (default) | "json"
 * @returns {Promise<{success, response, status?, error?}>}
 */
export async function handleAudioGenCore({ kind, provider, model, body = {}, credentials, responseFormat }) {
  const prepared = prepareAudioGenRequest({ kind, provider, body });
  if (prepared.error) return prepared.error;
  const { cfg, adapter, prompt, params, outputFormat } = prepared;

  if (cfg.authType !== "none" && !credentials?.apiKey) {
    return createErrorResult(HTTP_STATUS.UNAUTHORIZED, `${provider} API key required`);
  }

  try {
    const base64 = await adapter({ cfg, model, prompt, params, outputFormat, apiKey: credentials?.apiKey });
    const codec = outputFormat.split("_")[0];
    return createAudioResponse(base64, codec, responseFormat, AUDIO_GEN_CODEC_MIME[codec]);
  } catch (err) {
    return createErrorResult(err.status || HTTP_STATUS.BAD_GATEWAY, err.message || `${kind} generation failed`);
  }
}
