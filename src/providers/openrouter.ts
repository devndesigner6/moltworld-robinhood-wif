import type { ModelDefinition } from "../models/registry.js";
import {
  AIProvider,
  AudioSpeechRequest,
  AudioSpeechResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  UpstreamError,
  UpstreamResult,
  upstreamFetch,
} from "./types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Wrap raw 16-bit little-endian mono PCM in a WAV container. */
export function pcm16ToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class OpenRouterProvider implements AIProvider {
  readonly id = "openrouter";

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number = 25000
  ) {
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required to initialize OpenRouterProvider.");
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://moltworld.xyz",
      "X-Title": "Moltworld x402 AI Gateway",
    };
  }

  async chatComplete(model: ModelDefinition, request: ChatCompletionRequest): Promise<UpstreamResult<ChatCompletionResponse>> {
    const res = await upstreamFetch(OPENROUTER_URL, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: model.upstreamModelId,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        usage: { include: true },
      }),
      timeoutMs: this.timeoutMs,
      secret: this.apiKey,
      label: "OpenRouter",
    });
    const data: any = await res.json();
    if (data?.error) throw new UpstreamError(`OpenRouter error: ${data.error.message ?? "unknown"}`);

    // OpenRouter echoes the model that served the request (sometimes as a dated snapshot id).
    // It goes into the receipt verbatim; a different vendor is never accepted.
    const served = String(data.model ?? model.upstreamModelId);
    if (served.split("/")[0] !== model.upstreamModelId.split("/")[0]) {
      throw new UpstreamError(`OpenRouter served '${served}' instead of '${model.upstreamModelId}'.`);
    }

    const choices = (data.choices ?? []).map((choice: any, idx: number) => ({
      index: choice.index ?? idx,
      message: { role: "assistant" as const, content: String(choice.message?.content ?? "") },
      finish_reason: choice.finish_reason ?? "stop",
    }));
    if (!choices.length || !choices[0].message.content.trim()) {
      throw new UpstreamError("OpenRouter returned an empty completion.");
    }

    const usage = data.usage
      ? {
          prompt_tokens: Number(data.usage.prompt_tokens ?? 0),
          completion_tokens: Number(data.usage.completion_tokens ?? 0),
          total_tokens: Number(data.usage.total_tokens ?? 0),
        }
      : undefined;

    return {
      body: {
        id: String(data.id ?? `chatcmpl-${Date.now()}`),
        object: "chat.completion",
        created: Number(data.created ?? Math.floor(Date.now() / 1000)),
        model: model.slug,
        choices,
        usage,
      },
      upstreamProvider: "openrouter",
      upstreamModel: served,
      upstreamCostUsd: typeof data.usage?.cost === "number" ? data.usage.cost : undefined,
      usage,
    };
  }

  /**
   * Speech via OpenRouter's audio output modality. Audio output is streamed as
   * base64 PCM16 chunks, which are concatenated and wrapped as WAV.
   */
  async generateSpeech(model: ModelDefinition, request: AudioSpeechRequest): Promise<UpstreamResult<AudioSpeechResponse>> {
    const res = await upstreamFetch(OPENROUTER_URL, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: model.upstreamModelId,
        modalities: ["text", "audio"],
        audio: { voice: request.voice ?? "alloy", format: "pcm16" },
        stream: true,
        usage: { include: true },
        messages: [
          { role: "system", content: "Read the user's text aloud exactly as written. Do not add, omit or answer anything." },
          { role: "user", content: request.input },
        ],
      }),
      timeoutMs: this.timeoutMs,
      secret: this.apiKey,
      label: "OpenRouter audio",
    });
    if (!res.body) throw new UpstreamError("OpenRouter audio returned no stream.");

    const chunks: Buffer[] = [];
    let cost: number | undefined;
    let served = model.upstreamModelId;
    const decoder = new TextDecoder();
    let buffered = "";
    for await (const part of res.body as any as AsyncIterable<Uint8Array>) {
      buffered += decoder.decode(part, { stream: true });
      let newline: number;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let event: any;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (event.error) throw new UpstreamError(`OpenRouter audio error: ${event.error.message ?? "unknown"}`);
        if (event.model) served = String(event.model);
        const audio = event.choices?.[0]?.delta?.audio?.data;
        if (typeof audio === "string" && audio) chunks.push(Buffer.from(audio, "base64"));
        if (typeof event.usage?.cost === "number") cost = event.usage.cost;
      }
    }
    if (!chunks.length) throw new UpstreamError("OpenRouter audio returned no audio data.");

    const wav = pcm16ToWav(Buffer.concat(chunks));
    return {
      body: {
        object: "audio.speech",
        created: Math.floor(Date.now() / 1000),
        model: model.slug,
        format: "wav",
        mime_type: "audio/wav",
        audio_b64: wav.toString("base64"),
        character_count: request.input.length,
      },
      upstreamProvider: "openrouter",
      upstreamModel: served,
      upstreamCostUsd: cost,
    };
  }
}
