import { config } from "../config.js";

export const WIF_PRICE_SOURCE = "Live Robinhood WIF pool data (DexScreener / GeckoTerminal)";
const SCALE = 10n ** 18n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const POOL_ID = /^0x[0-9a-fA-F]{64}$/;
const SNAPSHOT_CACHE_TTL_MS = 15_000;
const MAX_SNAPSHOT_AGE_MS = 60_000;

export interface WifPriceSnapshot {
  priceUsd: string;
  effectivePriceUsdScaled18: string;
  liquidityUsd: number;
  source: string;
  observedAt: string;
}

export interface WifPoolQuote {
  priceUsd: string;
  liquidityUsd: number;
  activeTrades: number;
}

let cachedSnapshot: WifPriceSnapshot | undefined;
let inFlightSnapshot: Promise<WifPriceSnapshot> | undefined;

/** Parse a positive decimal price without binary floating-point rounding. */
export function decimalToScaled18(value: string): bigint {
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("WIF price must be a plain positive decimal.");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > 18) throw new Error("WIF price has more than 18 decimal places.");
  const scaled = BigInt(whole) * SCALE + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  if (scaled <= 0n) throw new Error("WIF price must be greater than zero.");
  return scaled;
}

export function usdMicroToTokenAtomic(usdMicro: number, tokenPriceUsdScaled18: bigint, tokenDecimals = 18): string {
  if (!Number.isSafeInteger(usdMicro) || usdMicro < 0) throw new Error("USD quote must be a non-negative safe integer in micro-dollars.");
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) throw new Error("Unsupported token decimals.");
  if (tokenPriceUsdScaled18 <= 0n) throw new Error("Token price must be positive.");
  const numerator = BigInt(usdMicro) * (10n ** BigInt(tokenDecimals + 12));
  const atomic = (numerator + tokenPriceUsdScaled18 - 1n) / tokenPriceUsdScaled18;
  return atomic.toString();
}

/** Value a raw token balance in micro-USD using the exact quote-time price. */
export function tokenAtomicToUsdMicro(amountAtomic: bigint, tokenPriceUsdScaled18: bigint, tokenDecimals = 18): number {
  if (amountAtomic < 0n || tokenPriceUsdScaled18 <= 0n) return 0;
  const value = (amountAtomic * tokenPriceUsdScaled18) / (10n ** BigInt(tokenDecimals + 12));
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > max ? max : value);
}

export function configuredWifPoolId(priceUrl: string): string {
  const expectedPool = priceUrl.match(/\/pairs\/robinhood\/(0x[0-9a-fA-F]{64})(?:[/?]|$)/i)?.[1];
  if (!expectedPool || !POOL_ID.test(expectedPool)) throw new Error("WIF_PRICE_URL must identify a specific Robinhood pool ID.");
  return expectedPool;
}

export function geckoTerminalPoolUrl(priceUrl: string): string {
  const poolId = configuredWifPoolId(priceUrl);
  return `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${poolId}`;
}

export function findConfiguredWifPool(body: any, tokenAddress: string, priceUrl: string): any | null {
  const candidates = Array.isArray(body?.pairs) ? body.pairs : body?.pair ? [body.pair] : [];
  const expectedPool = configuredWifPoolId(priceUrl).toLowerCase();
  return candidates.find((item: any) =>
    String(item?.chainId).toLowerCase() === "robinhood" &&
    String(item?.baseToken?.address).toLowerCase() === tokenAddress.toLowerCase() &&
    String(item?.pairAddress).toLowerCase() === expectedPool
  ) ?? null;
}

/** Return a quote only when GeckoTerminal identifies this exact chain, pool and WIF token. */
export function findConfiguredGeckoTerminalPool(body: any, tokenAddress: string, poolId: string): WifPoolQuote | null {
  if (!ADDRESS.test(tokenAddress) || !POOL_ID.test(poolId)) return null;
  const data = body?.data;
  const attributes = data?.attributes;
  const expectedPool = poolId.toLowerCase();
  if (String(data?.id ?? "").toLowerCase() !== `robinhood_${expectedPool}`) return null;
  if (String(attributes?.address ?? "").toLowerCase() !== expectedPool) return null;

  const tokenId = `robinhood_${tokenAddress.toLowerCase()}`;
  const baseId = String(data?.relationships?.base_token?.data?.id ?? "").toLowerCase();
  const quoteId = String(data?.relationships?.quote_token?.data?.id ?? "").toLowerCase();
  const rawPrice = baseId === tokenId
    ? attributes?.base_token_price_usd
    : quoteId === tokenId ? attributes?.quote_token_price_usd : undefined;
  if (rawPrice === undefined || rawPrice === null) return null;

  const buys = Number(attributes?.transactions?.m5?.buys ?? 0);
  const sells = Number(attributes?.transactions?.m5?.sells ?? 0);
  return {
    priceUsd: String(rawPrice),
    liquidityUsd: Number(attributes?.reserve_in_usd),
    activeTrades: buys + sells,
  };
}

function makeSnapshot(quote: WifPoolQuote, source: string): WifPriceSnapshot {
  if (!Number.isFinite(quote.liquidityUsd) || quote.liquidityUsd < config.wifPriceMinLiquidityUsd) {
    throw new Error(`WIF pool liquidity is below the configured $${config.wifPriceMinLiquidityUsd} minimum.`);
  }
  if (!Number.isFinite(quote.activeTrades) || quote.activeTrades < 1) {
    throw new Error("WIF pool has no trades in the last five minutes; refusing a stale quote.");
  }
  if (!Number.isFinite(config.wifPriceHaircutBps) || config.wifPriceHaircutBps < 0 || config.wifPriceHaircutBps >= 10_000) {
    throw new Error("WIF_PRICE_HAIRCUT_BPS must be from 0 to 9999.");
  }
  const spotScaled = decimalToScaled18(quote.priceUsd);
  const effectivePrice = (spotScaled * BigInt(10_000 - Math.floor(config.wifPriceHaircutBps))) / 10_000n;
  if (effectivePrice <= 0n) throw new Error("WIF effective price is invalid after the configured safety haircut.");
  return {
    priceUsd: quote.priceUsd,
    effectivePriceUsdScaled18: effectivePrice.toString(),
    liquidityUsd: quote.liquidityUsd,
    source,
    observedAt: new Date().toISOString(),
  };
}

async function fetchJson(fetcher: typeof fetch, url: string, provider: string): Promise<any> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(3500), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${provider} HTTP ${response.status}`);
  return response.json();
}

async function fromDexScreener(fetcher: typeof fetch): Promise<WifPriceSnapshot> {
  const body = await fetchJson(fetcher, config.wifPriceUrl, "DexScreener");
  const pair = findConfiguredWifPool(body, config.paymentAssetAddress, config.wifPriceUrl);
  if (!pair) throw new Error("DexScreener did not return the configured Robinhood WIF pool");
  return makeSnapshot({
    priceUsd: String(pair.priceUsd ?? ""),
    liquidityUsd: Number(pair.liquidity?.usd),
    activeTrades: Number(pair.txns?.m5?.buys ?? 0) + Number(pair.txns?.m5?.sells ?? 0),
  }, "DexScreener (Robinhood WIF pool)");
}

async function fromGeckoTerminal(fetcher: typeof fetch): Promise<WifPriceSnapshot> {
  const url = geckoTerminalPoolUrl(config.wifPriceUrl);
  const body = await fetchJson(fetcher, url, "GeckoTerminal");
  const quote = findConfiguredGeckoTerminalPool(body, config.paymentAssetAddress, configuredWifPoolId(config.wifPriceUrl));
  if (!quote) throw new Error("GeckoTerminal did not return the configured Robinhood WIF pool and token");
  return makeSnapshot(quote, "GeckoTerminal (Robinhood WIF pool)");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

async function fetchLiveSnapshot(fetcher: typeof fetch): Promise<WifPriceSnapshot> {
  let dexError: unknown;
  try {
    return await fromDexScreener(fetcher);
  } catch (error) {
    dexError = error;
  }
  try {
    return await fromGeckoTerminal(fetcher);
  } catch (geckoError) {
    throw new Error(`No valid live WIF price snapshot: ${message(dexError)}; ${message(geckoError)}.`);
  }
}

function cachedSnapshotAgeMs(): number {
  if (!cachedSnapshot) return Number.POSITIVE_INFINITY;
  const observedAt = Date.parse(cachedSnapshot.observedAt);
  return Number.isFinite(observedAt) ? Math.max(0, Date.now() - observedAt) : Number.POSITIVE_INFINITY;
}

/**
 * Fetch the configured Robinhood WIF pool from live market-data APIs. DexScreener
 * is primary; GeckoTerminal is a real same-pool fallback. Calls are coalesced and
 * cached briefly to respect public API limits. A bounded recent snapshot may be
 * reused during a temporary outage; no hard-coded price is ever substituted.
 */
export async function getWifPriceSnapshot(fetcher: typeof fetch = fetch): Promise<WifPriceSnapshot> {
  if (!config.wifPriceUrl) throw new Error("WIF price source is not configured for this network.");

  // Custom fetchers are used by tests and callers; do not leak their data into the production cache.
  if (fetcher !== fetch) return fetchLiveSnapshot(fetcher);

  const age = cachedSnapshotAgeMs();
  if (cachedSnapshot && age <= SNAPSHOT_CACHE_TTL_MS) return cachedSnapshot;
  if (inFlightSnapshot) return inFlightSnapshot;

  const pending = fetchLiveSnapshot(fetcher)
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      return snapshot;
    })
    .catch((error) => {
      if (cachedSnapshot && cachedSnapshotAgeMs() <= MAX_SNAPSHOT_AGE_MS) return cachedSnapshot;
      throw error;
    });
  inFlightSnapshot = pending;
  try {
    return await pending;
  } finally {
    if (inFlightSnapshot === pending) inFlightSnapshot = undefined;
  }
}

export async function wifBalanceUsdMicro(address: string, price: WifPriceSnapshot): Promise<number | null> {
  if (!ADDRESS.test(address) || !ADDRESS.test(config.paymentAssetAddress)) return null;
  try {
    const { createPublicClient, http } = await import("viem");
    const client = createPublicClient({ transport: http(config.robinhoodRpcUrl, { timeout: 4000 }) });
    const balance = await client.readContract({
      address: config.paymentAssetAddress as `0x${string}`,
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] }],
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    }) as bigint;
    return tokenAtomicToUsdMicro(balance, BigInt(price.effectivePriceUsdScaled18), config.paymentAssetDecimals);
  } catch {
    return null;
  }
}
