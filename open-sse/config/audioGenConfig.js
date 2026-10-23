// Text-to-audio generation (sound effects, music): kinds, request limits, output formats.

export const AUDIO_GEN_KINDS = { SFX: "sfx", MUSIC: "music" };

// Registry key holding a provider's upstream config for each kind (e.g. `sfxConfig`).
export const AUDIO_GEN_CONFIG_KEY = { sfx: "sfxConfig", music: "musicConfig" };

// Upper bound on the prompt we forward upstream (request-size guard).
export const AUDIO_GEN_MAX_PROMPT_CHARS = 2000;

// Inclusive numeric ranges per kind. Out-of-range values are rejected with 400
// before any upstream call (and before any credit is spent).
export const AUDIO_GEN_RANGES = {
  sfx: {
    duration_seconds: [0.5, 30],
    prompt_influence: [0, 1],
  },
  music: {
    music_length_ms: [3000, 600000],
  },
};

// Boolean params forwarded as-is when the client sends them.
export const AUDIO_GEN_BOOL_PARAMS = {
  sfx: ["loop"],
  music: ["force_instrumental"],
};

export const AUDIO_GEN_DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

// `codec_sampleRate[_bitrate]` values accepted by both ElevenLabs sound-generation and music.
export const AUDIO_GEN_OUTPUT_FORMATS = new Set([
  "mp3_22050_32", "mp3_24000_48", "mp3_44100_32", "mp3_44100_64", "mp3_44100_96",
  "mp3_44100_128", "mp3_44100_192",
  "pcm_8000", "pcm_16000", "pcm_22050", "pcm_24000", "pcm_32000", "pcm_44100", "pcm_48000",
  "ulaw_8000", "alaw_8000",
  "opus_48000_32", "opus_48000_64", "opus_48000_96", "opus_48000_128", "opus_48000_192",
]);

// Codec (first segment of output_format) → Content-Type of the binary response.
export const AUDIO_GEN_CODEC_MIME = {
  mp3: "audio/mpeg",
  pcm: "audio/pcm",
  ulaw: "audio/basic",
  alaw: "audio/basic",
  opus: "audio/ogg",
};

// ElevenLabs `detail.status` values that mean "this account is out of credit/quota".
// Mapped to 429 so the account-fallback loop moves on to the next connection.
export const AUDIO_GEN_QUOTA_ERROR_STATUSES = new Set([
  "quota_exceeded",
  "insufficient_credits",
  "too_many_concurrent_requests",
]);
