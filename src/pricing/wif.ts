import { config } from "../config.js";

export const WIF_PRICE_SOURCE = "DexScreener Robinhood Uniswap v4 pool";
const SCALE = 10n ** 18n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const POOL_ID = /^0x[0-9a-fA-F]{64}$/;

export interface WifPriceSnapshot {
  priceUsd: string;
  effectivePriceUsdScaled18: string;
  liquidityUsd: number;
  source: string;
  observedAt: string;
}

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

export function findConfiguredWifPool(body: any, tokenAddress: string, priceUrl: string): any | null {
  const candidates = Array.isArray(body?.pairs) ? body.pairs : body?.pair ? [body.pair] : [];
  const expectedPool = priceUrl.match(/\/pairs\/robinhood\/(0x[0-9a-fA-F]{64})(?:[/?]|$)/i)?.[1];
  if (!expectedPool || !POOL_ID.test(expectedPool)) throw new Error("WIF_PRICE_URL must identify a specific Robinhood v4 pool ID.");
  return candidates.find((item: any) =>
    String(item?.chainId).toLowerCase() === "robinhood" &&
    String(item?.baseToken?.address).toLowerCase() === tokenAddress.toLowerCase() &&
    String(item?.pairAddress).toLowerCase() === expectedPool.toLowerCase()
  ) ?? null;
}

/**
 * Fetch and validate the project's linked WIF/ETH pool. The API is an off-chain
 * market-data source, not a signed oracle, so low-liquidity or inactive quotes
 * are rejected and callers should bind this snapshot to a single 402 challenge.
 */
export async function getWifPriceSnapshot(fetcher: typeof fetch = fetch): Promise<WifPriceSnapshot> {
  if (!config.wifPriceUrl) throw new Error("WIF price source is not configured for this network.");
  const response = await fetcher(config.wifPriceUrl, { signal: AbortSignal.timeout(3500), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`WIF price source returned HTTP ${response.status}.`);
  const body: any = await response.json();
  const pair = findConfiguredWifPool(body, config.paymentAssetAddress, config.wifPriceUrl);
  if (!pair) throw new Error("WIF price source did not return the configured Robinhood WIF pool.");
  const liquidityUsd = Number(pair.liquidity?.usd);
  const activeTrades = Number(pair.txns?.m5?.buys ?? 0) + Number(pair.txns?.m5?.sells ?? 0);
  if (!Number.isFinite(liquidityUsd) || liquidityUsd < config.wifPriceMinLiquidityUsd) {
    throw new Error(`WIF pool liquidity is below the configured $${config.wifPriceMinLiquidityUsd} minimum.`);
  }
  if (!Number.isFinite(activeTrades) || activeTrades < 1) throw new Error("WIF pool has no trades in the last five minutes; refusing a stale quote.");
  if (!Number.isFinite(config.wifPriceHaircutBps) || config.wifPriceHaircutBps < 0 || config.wifPriceHaircutBps >= 10_000) {
    throw new Error("WIF_PRICE_HAIRCUT_BPS must be from 0 to 9999.");
  }
  const priceUsd = String(pair.priceUsd ?? "");
  const spotScaled = decimalToScaled18(priceUsd);
  const effectivePrice = (spotScaled * BigInt(10_000 - Math.floor(config.wifPriceHaircutBps))) / 10_000n;
  if (effectivePrice <= 0n) throw new Error("WIF effective price is invalid after the configured safety haircut.");
  return {
    priceUsd,
    effectivePriceUsdScaled18: effectivePrice.toString(),
    liquidityUsd,
    source: WIF_PRICE_SOURCE,
    observedAt: new Date().toISOString(),
  };
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
