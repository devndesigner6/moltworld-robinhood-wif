import { describe, expect, it } from "vitest";
import {
  decimalToScaled18,
  scaled18ToDecimal,
  snapshotFromOnchainState,
  tokenAtomicToUsdMicro,
  usdMicroToTokenAtomic,
} from "../src/pricing/wif.js";

const Q96 = 1n << 96n;
const stableInput = {
  // sqrt(P)=1000, so 1 ETH is worth 1,000,000 WIF when both use 18 decimals.
  sqrtPriceX96: Q96 * 1_000n,
  activeLiquidity: 10n ** 22n,
  ethUsdAnswer: 200_000_000_000n,
  ethUsdDecimals: 8,
  ethUsdUpdatedAt: 99_900,
  blockTimestamp: 99_999,
  nowSeconds: 100_000,
  wifTokenDecimals: 18,
  minLiquidityUsd: 25_000,
  haircutBps: 500,
  feedHeartbeatSeconds: 86_400,
  maxBlockAgeSeconds: 60,
};

describe("WIF amount math", () => {
  it("parses and formats 18-decimal prices without floating-point rounding", () => {
    expect(decimalToScaled18("2.50")).toBe(2_500_000_000_000_000_000n);
    expect(decimalToScaled18("0.00000001")).toBe(10_000_000_000n);
    expect(scaled18ToDecimal(1_375_000_000_000_000n)).toBe("0.001375");
  });

  it("converts a USD quote into the exact 18-decimal WIF amount", () => {
    expect(usdMicroToTokenAtomic(1_000_000, 2_000_000_000_000_000_000n, 18)).toBe("500000000000000000");
  });

  it("rounds token amounts up so the quote is never under-collected", () => {
    expect(usdMicroToTokenAtomic(1_000_000, 3_000_000_000_000_000_000n, 18)).toBe("333333333333333334");
  });

  it("values an ERC-20 balance in USD micro-units with integer arithmetic", () => {
    expect(tokenAtomicToUsdMicro(500_000_000_000_000_000n, 2_000_000_000_000_000_000n, 18)).toBe(1_000_000);
  });

  it("rejects malformed and zero prices", () => {
    expect(() => decimalToScaled18("NaN")).toThrow();
    expect(() => decimalToScaled18("0")).toThrow();
    expect(() => scaled18ToDecimal(0n)).toThrow();
  });
});

describe("Robinhood on-chain WIF/USD quote", () => {
  it("derives WIF/USD from v4 sqrtPriceX96 and Chainlink ETH/USD using integer math", () => {
    const snapshot = snapshotFromOnchainState(stableInput);
    expect(snapshot.priceUsd).toBe("0.002");
    expect(snapshot.effectivePriceUsdScaled18).toBe("1900000000000000");
    expect(snapshot.liquidityUsd).toBe(40_000);
    expect(snapshot.source).toContain("StateView");
    expect(snapshot.source).toContain("Chainlink ETH/USD");
  });

  it("rejects an uninitialized pool or zero active liquidity", () => {
    expect(() => snapshotFromOnchainState({ ...stableInput, sqrtPriceX96: 0n })).toThrow(/initialized spot price/);
    expect(() => snapshotFromOnchainState({ ...stableInput, activeLiquidity: 0n })).toThrow(/active liquidity/);
  });

  it("rejects a stale Chainlink round beyond its documented heartbeat", () => {
    expect(() => snapshotFromOnchainState({ ...stableInput, ethUsdUpdatedAt: 1 })).toThrow(/heartbeat/);
  });

  it("rejects a stale latest block instead of using a cached price", () => {
    expect(() => snapshotFromOnchainState({ ...stableInput, blockTimestamp: 99_900, nowSeconds: 100_000 })).toThrow(/block is stale/);
  });

  it("rejects a feed round newer than the latest block", () => {
    expect(() => snapshotFromOnchainState({ ...stableInput, ethUsdUpdatedAt: 100_100 })).toThrow(/newer than the latest/);
  });

  it("rejects a pool below the configured minimum active liquidity", () => {
    expect(() => snapshotFromOnchainState({ ...stableInput, activeLiquidity: 10n ** 20n })).toThrow(/below the configured/);
  });

  it("rejects invalid haircut configuration", () => {
    expect(() => snapshotFromOnchainState({ ...stableInput, haircutBps: 10_000 })).toThrow(/HAIRCUT/);
  });
});
