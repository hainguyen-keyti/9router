// ElevenLabs text-to-audio (sound effects + music) transport contract.
//
// Black-box tests against open-sse/handlers/audioGenCore.js. Wire observables only:
//   - dispatch via the registry's sfxConfig / musicConfig, never a hardcoded URL in the core;
//   - xi-api-key auth header, not Bearer; output_format rides the query string;
//   - body carries the prompt (`text` for sfx, `prompt` for music) + model_id, and only
//     the params the client actually sent (upstream defaults apply to the rest);
//   - out-of-range / malformed params → 400 before any upstream call;
//   - ElevenLabs out-of-credit (detail.status quota_exceeded) → 429 so accounts rotate;
//   - binary audio by default, { audio, format } with responseFormat "json".
//
// NOT pinned: ElevenLabs plan entitlements (music on free tier), real audio content.
import { describe, it, expect, vi, afterEach } from "vitest";

import { handleAudioGenCore } from "open-sse/handlers/audioGenCore.js";

const CRED = { apiKey: "sk-el-TEST" };
const AUDIO = new Uint8Array(2048).fill(7);

function stubFetch({ status = 200, json = null } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", async (url, opts) => {
    calls.push({ url: new URL(String(url)), opts, body: opts?.body ? JSON.parse(opts.body) : null });
    if (status !== 200) {
      return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
    }
    return new Response(AUDIO, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  });
  return calls;
}

function run(kind, body, extra = {}) {
  const model = kind === "sfx" ? "eleven_text_to_sound_v2" : "music_v2_5";
  return handleAudioGenCore({ kind, provider: "elevenlabs", model, body, credentials: CRED, ...extra });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ElevenLabs sound effects", () => {
  it("posts text + model_id to /v1/sound-generation with xi-api-key and default output_format", async () => {
    const calls = stubFetch();
    const result = await run("sfx", { prompt: "laser blast" });

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://api.elevenlabs.io/v1/sound-generation");
    expect(calls[0].url.searchParams.get("output_format")).toBe("mp3_44100_128");
    expect(calls[0].opts.headers["xi-api-key"]).toBe("sk-el-TEST");
    expect(calls[0].opts.headers.Authorization).toBeUndefined();
    expect(calls[0].body).toEqual({ text: "laser blast", model_id: "eleven_text_to_sound_v2" });
  });

  it("forwards only the params the client sent, coerced to proper types", async () => {
    const calls = stubFetch();
    await run("sfx", { input: "rain", duration_seconds: "2.5", prompt_influence: 0.6, loop: "true", output_format: "opus_48000_128" });

    expect(calls[0].body).toEqual({ text: "rain", model_id: "eleven_text_to_sound_v2", duration_seconds: 2.5, prompt_influence: 0.6, loop: true });
    expect(calls[0].url.searchParams.get("output_format")).toBe("opus_48000_128");
  });

  it("rejects out-of-range params with 400 and never calls upstream", async () => {
    const calls = stubFetch();
    for (const body of [
      { prompt: "x", duration_seconds: 99 },
      { prompt: "x", prompt_influence: -1 },
      { prompt: "x", loop: "maybe" },
      { prompt: "x", output_format: "wav_44100" },
      { prompt: "x".repeat(2001) },
      { prompt: "   " },
    ]) {
      const result = await run("sfx", body);
      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("ElevenLabs music", () => {
  it("posts prompt + model_id + music params to /v1/music", async () => {
    const calls = stubFetch();
    const result = await run("music", { prompt: "lofi piano", music_length_ms: 30000, force_instrumental: true });

    expect(result.success).toBe(true);
    expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://api.elevenlabs.io/v1/music");
    expect(calls[0].body).toEqual({ prompt: "lofi piano", model_id: "music_v2_5", music_length_ms: 30000, force_instrumental: true });
  });

  it("does not accept sfx-only params as music params", async () => {
    const calls = stubFetch();
    await run("music", { prompt: "jazz", duration_seconds: 5 });
    expect(calls[0].body).toEqual({ prompt: "jazz", model_id: "music_v2_5" });
  });

  it("rejects music_length_ms outside 3000..600000", async () => {
    stubFetch();
    expect((await run("music", { prompt: "jazz", music_length_ms: 1000 })).status).toBe(400);
    expect((await run("music", { prompt: "jazz", music_length_ms: 600001 })).status).toBe(400);
  });
});

describe("responses and errors", () => {
  it("returns binary audio/mpeg by default", async () => {
    stubFetch();
    const result = await run("sfx", { prompt: "door creak" });
    expect(result.response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(AUDIO);
  });

  it("returns { audio: base64, format } when responseFormat is json", async () => {
    stubFetch();
    const result = await run("music", { prompt: "jazz" }, { responseFormat: "json" });
    const json = await result.response.json();
    expect(json.format).toBe("mp3");
    expect(Buffer.from(json.audio, "base64")).toEqual(Buffer.from(AUDIO));
  });

  it("maps ElevenLabs quota_exceeded to 429 so the account pool rotates", async () => {
    stubFetch({ status: 401, json: { detail: { status: "quota_exceeded", message: "This request exceeds your quota." } } });
    const result = await run("sfx", { prompt: "boom" });
    expect(result.status).toBe(429);
    expect(result.error).toBe("This request exceeds your quota.");
  });

  it("passes other upstream errors through with their status and message", async () => {
    stubFetch({ status: 401, json: { detail: { status: "invalid_api_key", message: "Invalid API key" } } });
    const result = await run("music", { prompt: "jazz" });
    expect(result.status).toBe(401);
    expect(result.error).toBe("Invalid API key");
  });

  it("requires an API key", async () => {
    const calls = stubFetch();
    const result = await run("sfx", { prompt: "boom" }, { credentials: undefined });
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("rejects providers without the kind's config", async () => {
    const result = await handleAudioGenCore({ kind: "sfx", provider: "openai", model: "x", body: { prompt: "boom" }, credentials: CRED });
    expect(result.status).toBe(400);
  });
});
