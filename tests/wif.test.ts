import { describe, expect, it } from "vitest";
import { decimalToScaled18, findConfiguredWifPool, tokenAtomicToUsdMicro, usdMicroToTokenAtomic } from "../src/pricing/wif.js";

describe("WIF amount math", () => {
  it("parses decimal prices without floating-point rounding", () => {
    expect(decimalToScaled18("2.50")).toBe(2_500_000_000_000_000_000n);
    expect(decimalToScaled18("0.00000001")).toBe(10_000_000_000n);
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
  });

  it("matches the configured Robinhood v4 pool by its bytes32 pool ID", () => {
    const poolId = "0x71ef4106340f0a3b9c19ec994eef4fc44a1d2513f38faac39d7636b156548c79";
    const token = "0x5173b8eA6923c2d40267890D45C46a3480954773";
    const valid = { chainId: "robinhood", pairAddress: poolId, baseToken: { address: token } };
    const wrongPool = { ...valid, pairAddress: "0x" + "ab".repeat(32) };
    const wrongToken = { ...valid, baseToken: { address: "0x" + "cd".repeat(20) } };
    const url = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${poolId}`;

    expect(findConfiguredWifPool({ pairs: [wrongPool, wrongToken, valid] }, token, url)).toBe(valid);
    expect(findConfiguredWifPool({ pairs: [wrongPool] }, token, url)).toBeNull();
    expect(() => findConfiguredWifPool({ pair: valid }, token, "https://example.test/no-pool")).toThrow();
  });
});
