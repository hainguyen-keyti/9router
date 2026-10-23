// ElevenLabs text-to-audio: sound effects (POST /v1/sound-generation) and music (POST /v1/music).
// Both take a JSON body, `output_format` as a query param, auth via the config's header,
// and answer with raw audio bytes.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { AUDIO_GEN_QUOTA_ERROR_STATUSES } from "../../config/audioGenConfig.js";

// ElevenLabs errors come as { detail: { status, message } }, { detail: "..." }, or a
// 422 validation list { detail: [{ msg }] }. Out-of-credit statuses become 429 so the
// caller's account-fallback loop tries the next connection.
function upstreamError(status, data, fallback) {
  const detail = data?.detail;
  const isObject = detail && typeof detail === "object" && !Array.isArray(detail);
  const message =
    (typeof detail === "string" && detail) ||
    (Array.isArray(detail) && detail.map((d) => d?.msg).filter(Boolean).join("; ")) ||
    (isObject && detail.message) ||
    fallback;
  const err = new Error(message);
  err.status = isObject && AUDIO_GEN_QUOTA_ERROR_STATUSES.has(detail.status) ? HTTP_STATUS.RATE_LIMITED : status;
  return err;
}

async function requestAudio(cfg, apiKey, outputFormat, payload, label) {
  const url = new URL(cfg.baseUrl);
  url.searchParams.set("output_format", outputFormat);

  const res = await fetch(url, {
    method: "POST",
    headers: { [cfg.authHeader]: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw upstreamError(res.status, data, `ElevenLabs ${label} failed: ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) {
    throw Object.assign(new Error(`ElevenLabs ${label} returned empty audio`), { status: HTTP_STATUS.BAD_GATEWAY });
  }
  return Buffer.from(buf).toString("base64");
}

// `params` is already validated and contains only the fields the client sent.
export async function generateSoundEffect({ cfg, model, prompt, params, outputFormat, apiKey }) {
  return requestAudio(cfg, apiKey, outputFormat, { text: prompt, model_id: model, ...params }, "sound effect");
}

export async function composeMusic({ cfg, model, prompt, params, outputFormat, apiKey }) {
  return requestAudio(cfg, apiKey, outputFormat, { prompt, model_id: model, ...params }, "music");
}
