import { handleAudioGeneration } from "@/sse/handlers/audioGeneration.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/** POST /v1/audio/music - Music generation from a text prompt */
export async function POST(request) {
  return await handleAudioGeneration(request, "music");
}
