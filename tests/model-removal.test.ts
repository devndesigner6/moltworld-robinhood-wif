import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { INITIAL_MODELS } from "../src/models/registry.js";
import { buildX402Routes } from "../src/x402/server.js";
import { ModelRegistry } from "../src/models/registry.js";

const removedImages = ["gpt-image-1", "flux-2-pro", "recraft-v4.1-flash", "qwen-image-3", "seedream-5.0", "grok-imagine-image", "recraft-v3"];
const removedVideos = ["veo-3.1-fast", "kling-v3.0-std", "wan-3.0", "hailuo-3", "sora-2-pro"];

describe("removed model surfaces", () => {
  it("has no fal.ai or retired video models or x402 payment routes", () => {
    expect(INITIAL_MODELS.some(m => m.provider === "fal" || m.modality === "video")).toBe(false);
    const routes = buildX402Routes(new ModelRegistry());
    for (const slug of [...removedImages, ...removedVideos]) {
      expect(Object.keys(routes).some(route => route.includes(`/models/${slug}/`))).toBe(false);
    }
  });

  it("returns 404 without payment challenges for every removed endpoint", async () => {
    for (const [models, operation] of [[removedImages, "images/generations"], [removedVideos, "videos/generations"]] as const) {
      for (const model of models) {
        const res = await app.fetch(new Request(`http://localhost/v1/models/${model}/${operation}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "availability check" }),
        }));
        expect(res.status).toBe(404);
        expect(res.headers.has("payment-required")).toBe(false);
      }
    }
  });

  it("does not advertise removed models in catalog or agent discovery", async () => {
    for (const path of ["/v1/models", "/.well-known/x402", "/.well-known/agent-card.json", "/llms.txt"]) {
      const res = await app.fetch(new Request(`http://localhost${path}`));
      expect(res.status).toBe(200);
      const text = await res.text();
      for (const slug of [...removedImages, ...removedVideos]) {
        expect(text).not.toContain(`"${slug}"`);
        expect(text).not.toContain(`/models/${slug}/`);
      }
    }
  });
});
