import { config } from "../config.js";
import type { ModelDefinition } from "../models/registry.js";
import { AIProvider } from "./types.js";
import { OpenRouterProvider } from "./openrouter.js";
import { MockProvider } from "./mock.js";
import { DirectOpenAIProvider } from "./direct.js";
import { ElevenLabsProvider } from "./elevenlabs.js";

export * from "./types.js";
export * from "./openrouter.js";
export * from "./mock.js";
export * from "./direct.js";
export * from "./fal.js";
export * from "./elevenlabs.js";

export class ProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();
  private readonly mock = new MockProvider();

  constructor() {
    if (config.openrouterApiKey) {
      this.registerProvider(new OpenRouterProvider(config.openrouterApiKey, config.upstreamTimeoutMs));
    }
    if (config.openaiApiKey) {
      this.registerProvider(new DirectOpenAIProvider(config.openaiApiKey, config.upstreamTimeoutMs));
    }
    if (config.elevenlabsApiKey) {
      this.registerProvider(new ElevenLabsProvider(config.elevenlabsApiKey, config.upstreamTimeoutMs));
    }
  }

  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  /** Fails closed: there is no silent fallback to mock or another provider. */
  getProvider(providerId: string): AIProvider {
    if (config.mockProviders) return this.mock;
    const provider = this.providers.get(providerId.toLowerCase());
    if (!provider) {
      throw new Error(`Upstream AI provider '${providerId}' is not configured. Request rejected before payment.`);
    }
    return provider;
  }

  hasProvider(providerId: string): boolean {
    return config.mockProviders || this.providers.has(providerId.toLowerCase());
  }

  supports(model: ModelDefinition): boolean {
    if (!this.hasProvider(model.provider)) return false;
    const p = this.getProvider(model.provider);
    switch (model.modality) {
      case "chat":
        return typeof p.chatComplete === "function";
      case "image":
        return typeof p.generateImage === "function";
      case "voice":
        return typeof p.generateSpeech === "function";
      case "video":
        return typeof p.submitVideo === "function" && typeof p.getVideoStatus === "function";
    }
  }

  listConfiguredProviders(): string[] {
    return config.mockProviders ? ["mock"] : Array.from(this.providers.keys());
  }
}

export const defaultProviderRegistry = new ProviderRegistry();
