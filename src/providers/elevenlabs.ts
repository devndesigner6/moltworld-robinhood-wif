import type { ModelDefinition } from "../models/registry.js";
import { AIProvider, AudioSpeechRequest, AudioSpeechResponse, UpstreamError, UpstreamResult, upstreamFetch } from "./types.js";

// ElevenLabs' premade "Rachel" voice; callers can pass any voice id they have access to.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export class ElevenLabsProvider implements AIProvider {
  readonly id = "elevenlabs";

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number = 30000
  ) {
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is required to initialize ElevenLabsProvider.");
  }

  async generateSpeech(model: ModelDefinition, request: AudioSpeechRequest): Promise<UpstreamResult<AudioSpeechResponse>> {
    const voiceId = request.voice ?? DEFAULT_VOICE_ID;
    const res = await upstreamFetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: request.input, model_id: model.upstreamModelId }),
        timeoutMs: this.timeoutMs,
        secret: this.apiKey,
        label: "ElevenLabs",
      }
    );
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new UpstreamError("ElevenLabs returned empty audio.");
    return {
      body: {
        object: "audio.speech",
        created: Math.floor(Date.now() / 1000),
        model: model.slug,
        format: "mp3",
        mime_type: "audio/mpeg",
        audio_b64: audio.toString("base64"),
        character_count: request.input.length,
      },
      upstreamProvider: "elevenlabs",
      upstreamModel: model.upstreamModelId,
    };
  }
}
