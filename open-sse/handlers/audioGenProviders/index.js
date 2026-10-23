// Text-to-audio adapter registry, keyed by the provider config's `format`
// (registry `sfxConfig.format` / `musicConfig.format`).
import { generateSoundEffect, composeMusic } from "./elevenlabs.js";

const FORMAT_ADAPTERS = {
  "elevenlabs-sfx": generateSoundEffect,
  "elevenlabs-music": composeMusic,
};

export function getAudioGenAdapter(format) {
  return FORMAT_ADAPTERS[format] || null;
}
