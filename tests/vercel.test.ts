import { afterEach, describe, expect, it, vi } from "vitest";
import serverlessApp from "../src/index.js";

describe("Vercel deployment readiness", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("serves the actual site while deployment setup is pending", async () => {
    vi.stubEnv("ENABLE_LIVE_PAYMENTS", "false");
    const response = await serverlessApp.request("/");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Moltworld");
  });

  it("fails closed for API routes instead of returning simulated data", async () => {
    vi.stubEnv("ENABLE_LIVE_PAYMENTS", "false");
    const response = await serverlessApp.request("/v1/models");

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "gateway_disabled" },
    });
  });
});
