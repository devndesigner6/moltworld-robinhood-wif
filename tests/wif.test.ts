import { describe, expect, it } from "vitest";
import {
  configuredWifPoolId,
  decimalToScaled18,
  findConfiguredGeckoTerminalPool,
  findConfiguredWifPool,
  geckoTerminalPoolUrl,
  tokenAtomicToUsdMicro,
  usdMicroToTokenAtomic,
} from "../src/pricing/wif.js";

const poolId = "0x71ef4106340f0a3b9c19ec994eef4fc44a1d2513f38faac39d7636b156548c79";
const token = "0x5173b8eA6923c2d40267890D45C46a3480954773";
const dexUrl = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${poolId}`;

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

  it("extracts the exact configured bytes32 pool ID and fallback URL", () => {
    expect(configuredWifPoolId(dexUrl)).toBe(poolId);
    expect(geckoTerminalPoolUrl(dexUrl)).toBe(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${poolId}`);
    expect(() => configuredWifPoolId("https://example.test/no-pool")).toThrow();
  });

  it("matches the configured Robinhood pool by chain, token and pool ID", () => {
    const valid = { chainId: "robinhood", pairAddress: poolId, baseToken: { address: token } };
    const wrongPool = { ...valid, pairAddress: "0x" + "ab".repeat(32) };
    const wrongToken = { ...valid, baseToken: { address: "0x" + "cd".repeat(20) } };
    const wrongChain = { ...valid, chainId: "ethereum" };

    expect(findConfiguredWifPool({ pairs: [wrongPool, wrongToken, wrongChain, valid] }, token, dexUrl)).toBe(valid);
    expect(findConfiguredWifPool({ pairs: [wrongPool] }, token, dexUrl)).toBeNull();
  });

  it("accepts a GeckoTerminal quote only for the exact Robinhood pool and WIF token", () => {
    const valid = {
      data: {
        id: `robinhood_${poolId}`,
        attributes: {
          address: poolId,
          base_token_price_usd: "0.001383565",
          reserve_in_usd: "103024.50",
          transactions: { m5: { buys: 5, sells: 5 } },
        },
        relationships: {
          base_token: { data: { id: `robinhood_${token.toLowerCase()}` } },
          quote_token: { data: { id: `robinhood_${"0x" + "00".repeat(20)}` } },
        },
      },
    };
    const wrongPool = structuredClone(valid);
    wrongPool.data.attributes.address = "0x" + "ab".repeat(32);
    const wrongToken = structuredClone(valid);
    wrongToken.data.relationships.base_token.data.id = `robinhood_${"0x" + "cd".repeat(20)}`;
    const wrongNetwork = structuredClone(valid);
    wrongNetwork.data.id = `ethereum_${poolId}`;

    expect(findConfiguredGeckoTerminalPool(valid, token, poolId)).toEqual({
      priceUsd: "0.001383565",
      liquidityUsd: 103024.5,
      activeTrades: 10,
    });
    expect(findConfiguredGeckoTerminalPool(wrongPool, token, poolId)).toBeNull();
    expect(findConfiguredGeckoTerminalPool(wrongToken, token, poolId)).toBeNull();
    expect(findConfiguredGeckoTerminalPool(wrongNetwork, token, poolId)).toBeNull();
  });

  it("reads the WIF USD quote when WIF is the pool's quote token", () => {
    const reversed = {
      data: {
        id: `robinhood_${poolId}`,
        attributes: {
          address: poolId,
          quote_token_price_usd: "0.0014",
          reserve_in_usd: "50000",
          transactions: { m5: { buys: 1, sells: 2 } },
        },
        relationships: {
          base_token: { data: { id: `robinhood_${"0x" + "00".repeat(20)}` } },
          quote_token: { data: { id: `robinhood_${token.toLowerCase()}` } },
        },
      },
    };
    expect(findConfiguredGeckoTerminalPool(reversed, token, poolId)?.priceUsd).toBe("0.0014");
  });
});
