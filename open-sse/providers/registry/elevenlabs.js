export default {
  id: "elevenlabs",
  alias: "el",
  display: {
    name: "ElevenLabs",
    icon: "record_voice_over",
    color: "#6C47FF",
    textIcon: "EL",
    website: "https://elevenlabs.io",
    notice: {
      apiKeyUrl: "https://elevenlabs.io/app/settings/api-keys"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "tts",
    "stt",
    "sfx",
    "music"
  ],
  // Params the Scribe API accepts; mirrored per-model in `models[].params` below,
  // which is what the dashboard example card gates its fields on. The engine reads
  // the incoming request's own fields, so a new scribe model needs only a `models` entry.
  models: [
    {
      id: "scribe_v1",
      name: "Scribe v1",
      params: ["language", "response_format", "timestamps_granularity", "tag_audio_events", "diarize", "num_speakers"],
      kind: "stt"
    },
    {
      id: "scribe_v2",
      name: "Scribe v2",
      params: ["language", "response_format", "timestamps_granularity", "tag_audio_events", "diarize", "num_speakers"],
      kind: "stt"
    },
    {
      id: "eleven_text_to_sound_v2",
      name: "Sound Effects v2",
      params: ["duration_seconds", "prompt_influence", "loop", "output_format"],
      kind: "sfx"
    },
    {
      id: "music_v2_5",
      name: "Music v2.5",
      params: ["music_length_ms", "force_instrumental", "output_format"],
      kind: "music"
    },
    {
      id: "music_v2",
      name: "Music v2",
      params: ["music_length_ms", "force_instrumental", "output_format"],
      kind: "music"
    },
    {
      id: "music_v1",
      name: "Music v1",
      params: ["music_length_ms", "force_instrumental", "output_format"],
      kind: "music"
    },
  ],
  ttsConfig: {
    baseUrl: "https://api.elevenlabs.io/v1/text-to-speech",
    authType: "apikey",
    authHeader: "xi-api-key",
    format: "elevenlabs",
    models: [
      {
        id: "eleven_multilingual_v2",
        name: "Eleven Multilingual v2"
      },
      {
        id: "eleven_turbo_v2_5",
        name: "Eleven Turbo v2.5"
      }
    ]
  },
  sttConfig: {
    baseUrl: "https://api.elevenlabs.io/v1/speech-to-text",
    authType: "apikey",
    authHeader: "xi-api-key",
    format: "elevenlabs-stt",
    // OpenAI response_format → Scribe `additional_formats[].format`. Requests the
    // matching extra render alongside the JSON body; the engine then serves it.
    responseFormats: { segments: "seg_json", subtitles: "srt", captions: "vtt" }
  },
  // Text-to-audio generation (open-sse/handlers/audioGenCore.js). `format` picks the adapter.
  sfxConfig: {
    baseUrl: "https://api.elevenlabs.io/v1/sound-generation",
    authType: "apikey",
    authHeader: "xi-api-key",
    format: "elevenlabs-sfx"
  },
  musicConfig: {
    baseUrl: "https://api.elevenlabs.io/v1/music",
    authType: "apikey",
    authHeader: "xi-api-key",
    format: "elevenlabs-music"
  }
}
