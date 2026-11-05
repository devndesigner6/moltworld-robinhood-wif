import { config } from "../config.js";
import { ModelDefinition, ModelRegistry } from "./registry.js";

/**
 * Keeps the catalog honest at runtime:
 *  - a model whose upstream id the provider does not list is marked unverified
 *    and is neither advertised nor sold (fail closed);
 *  - chat token rates follow OpenRouter's live price list;
 *  - COST_<SLUG> environment variables override any of the above.
 */

type FetchLike = typeof fetch;

export interface SyncReport {
  verified: string[];
  unverified: Record<string, string>;
  repriced: string[];
  errors: string[];
}

function envOverrideName(slug: string): string {
  return `COST_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** COST_<SLUG> is "in,out" per million tokens for chat, otherwise the per-unit USD rate. */
export function applyEnvCostOverride(model: ModelDefinition, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[envOverrideName(model.slug)];
  if (!raw) return false;
  if (model.cost.kind === "tokens") {
    const [input, output] = raw.split(",").map(Number);
    if (!Number.isFinite(input) || !Number.isFinite(output)) return false;
    model.cost = { kind: "tokens", inputPerMillionUsd: input, outputPerMillionUsd: output };
  } else {
    const usd = Number(raw);
    if (!Number.isFinite(usd)) return false;
    model.cost = { ...model.cost, usd };
  }
  model.costSource = "env-override";
  return true;
}

async function syncOpenRouter(models: ModelDefinition[], registry: ModelRegistry, report: SyncReport, fetchImpl: FetchLike) {
  const res = await fetchImpl("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`OpenRouter model list returned ${res.status}`);
  const data = (await res.json()) as { data: Array<{ id: string; pricing?: Record<string, string> }> };
  const byId = new Map(data.data.map((m) => [m.id, m]));

  for (const model of models) {
    const listed = byId.get(model.upstreamModelId);
    if (!listed) {
      registry.markUnverified(model.slug, `upstream '${model.upstreamModelId}' is not listed by OpenRouter`);
      report.unverified[model.slug] = model.upstreamModelId;
      continue;
    }
    registry.clearUnverified(model.slug);
    report.verified.push(model.slug);
    if (model.cost.kind === "tokens" && listed.pricing) {
      const input = Number(listed.pricing.prompt) * 1_000_000;
      const output = Math.max(
        Number(listed.pricing.completion),
        Number(listed.pricing.internal_reasoning ?? 0)
      ) * 1_000_000;
      if (Number.isFinite(input) && Number.isFinite(output) && output > 0) {
        model.cost = { kind: "tokens", inputPerMillionUsd: Number(input.toFixed(6)), outputPerMillionUsd: Number(output.toFixed(6)) };
        model.costSource = "openrouter-live";
        report.repriced.push(model.slug);
      }
    }
  }
}

/** OpenAI's catalog is account-specific; use the same key that serves requests. */
async function syncOpenAI(models: ModelDefinition[], registry: ModelRegistry, report: SyncReport, fetchImpl: FetchLike) {
  if (!models.length) return;
  if (!config.openaiApiKey) {
    for (const model of models) {
      registry.markUnverified(model.slug, "OpenAI API key is not configured");
      report.unverified[model.slug] = model.upstreamModelId;
    }
    return;
  }
  const res = await fetchImpl("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`OpenAI model list returned ${res.status}`);
  const data = await res.json() as { data?: Array<{ id: string; shutdown_date?: string | null }> };
  if (!Array.isArray(data.data)) throw new Error("OpenAI model list returned an invalid catalog");
  const today = new Date().toISOString().slice(0, 10);
  const ids = new Set(data.data.filter(m => !m.shutdown_date || m.shutdown_date > today).map(m => m.id));
  for (const model of models) {
    if (!ids.has(model.upstreamModelId)) {
      registry.markUnverified(model.slug, `upstream '${model.upstreamModelId}' is not listed or has retired for this OpenAI account`);
      report.unverified[model.slug] = model.upstreamModelId;
      continue;
    }
    registry.clearUnverified(model.slug);
    report.verified.push(model.slug);
  }
}

export async function syncCatalog(registry: ModelRegistry, fetchImpl: FetchLike = fetch): Promise<SyncReport> {
  const report: SyncReport = { verified: [], unverified: {}, repriced: [], errors: [] };
  const all = registry.getAllModels().filter((m) => m.enabled);

  if (!config.skipUpstreamVerification) {
    const openrouter = all.filter((m) => m.provider === "openrouter");
    const openai = all.filter((m) => m.provider === "openai");
    // Nothing is sold until its upstream has been seen at least once.
    for (const m of [...openrouter, ...openai]) {
      if (!registry.wasVerified(m.slug)) registry.markUnverified(m.slug, "upstream verification pending");
    }
    try {
      await syncOpenRouter(openrouter, registry, report, fetchImpl);
    } catch (err: any) {
      // Models verified on an earlier run stay up; never-verified ones stay off.
      for (const m of openrouter) {
        if (!registry.wasVerified(m.slug)) registry.markUnverified(m.slug, "OpenRouter model list unavailable");
      }
      report.errors.push(`OpenRouter sync failed: ${err.message}`);
    }
    try {
      await syncOpenAI(openai, registry, report, fetchImpl);
    } catch (err: any) {
      for (const m of openai) {
        if (!registry.wasVerified(m.slug)) registry.markUnverified(m.slug, "OpenAI model list unavailable");
      }
      report.errors.push(`OpenAI sync failed: ${err.message}`);
    }
  }

  for (const model of all) {
    if (applyEnvCostOverride(model)) report.repriced.push(model.slug);
  }
  return report;
}

/** Re-sync periodically so prices track upstream changes. */
export function scheduleCatalogSync(registry: ModelRegistry, intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    syncCatalog(registry).catch((err) => console.error("Catalog re-sync failed:", err));
  }, intervalMs);
  timer.unref();
  return timer;
}
