import { beforeEach, describe, expect, it } from "vitest";
import type { WifPriceSnapshot } from "../src/pricing/wif.js";
import {
  clearWifQuoteChallengesForTests,
  getWifQuoteChallenge,
  matchesWifQuoteRequirement,
  rememberWifQuoteChallenge,
  WIF_QUOTE_CHALLENGE_TTL_MS,
  type WifQuoteChallenge,
} from "../src/payments/wif-challenges.js";

const snapshotA: WifPriceSnapshot = {
  priceUsd: "0.001264985953002795",
  effectivePriceUsdScaled18: "1201736655352655",
  liquidityUsd: 250_000,
  source: "Robinhood Uniswap v4 StateView + Chainlink ETH/USD",
  observedAt: "2026-11-06T10:00:00.000Z",
  blockNumber: "123456",
  blockTimestamp: 1_794_000_000,
  ethUsdUpdatedAt: 1_793_999_950,
};

const initial = {
  quoteId: "wq_testQuote123456",
  route: "/v1/models/gpt/chat/completions",
  requestSha256: "a".repeat(64),
  amountMicro: 1_000,
  amountAtomic: "832129065503577841",
  wifPrice: snapshotA,
};

const terms = {
  network: "eip155:4663",
  asset: "0x5173b8eA6923c2d40267890D45C46a3480954773",
  payTo: "0xdfF3eC4B06e39BCE04Ece791D2372C03b8AAC78a",
  symbol: "WIF",
  decimals: 18,
  maxTimeoutSeconds: 120,
};

function acceptedRequirement(challenge: Omit<WifQuoteChallenge, "expiresAt">) {
  return {
    scheme: "exact",
    network: terms.network,
    amount: challenge.amountAtomic,
    asset: terms.asset,
    payTo: terms.payTo,
    maxTimeoutSeconds: terms.maxTimeoutSeconds,
    extra: {
      assetTransferMethod: "permit2",
      decimals: 18,
      symbol: "WIF",
      quotedUsdMicro: challenge.amountMicro,
      wifPriceUsdScaled18: challenge.wifPrice.effectivePriceUsdScaled18,
      wifSpotPriceUsd: challenge.wifPrice.priceUsd,
      quoteId: challenge.quoteId,
      tag: "x402-global-challenge",
    },
  };
}

describe("server-issued WIF quote challenge cache", () => {
  beforeEach(() => clearWifQuoteChallengesForTests());

  it("reuses the original exact quote after the live pool price changes", () => {
    rememberWifQuoteChallenge(initial, 1_000);
    const restored = getWifQuoteChallenge(initial.quoteId, initial.route, initial.requestSha256, 6_000);
    expect(restored?.amountAtomic).toBe(initial.amountAtomic);
    expect(restored?.wifPrice.effectivePriceUsdScaled18).toBe(snapshotA.effectivePriceUsdScaled18);
    expect(matchesWifQuoteRequirement(acceptedRequirement(initial), restored!, terms)).toBe(true);
  });

  it("refuses reuse for a different route, body, or expired challenge", () => {
    rememberWifQuoteChallenge(initial, 1_000);
    expect(getWifQuoteChallenge(initial.quoteId, "/v1/models/other/chat/completions", initial.requestSha256, 2_000)).toBeUndefined();
    expect(getWifQuoteChallenge(initial.quoteId, initial.route, "b".repeat(64), 2_000)).toBeUndefined();
    expect(getWifQuoteChallenge(initial.quoteId, initial.route, initial.requestSha256, 1_000 + WIF_QUOTE_CHALLENGE_TTL_MS)).toBeUndefined();
  });

  it("matches all signed WIF challenge terms, not just the quote ID", () => {
    rememberWifQuoteChallenge(initial, 1_000);
    const restored = getWifQuoteChallenge(initial.quoteId, initial.route, initial.requestSha256, 2_000)!;
    expect(matchesWifQuoteRequirement(acceptedRequirement(initial), restored, terms)).toBe(true);

    const alteredAmount = acceptedRequirement(initial);
    alteredAmount.amount = "832129065503577842";
    expect(matchesWifQuoteRequirement(alteredAmount, restored, terms)).toBe(false);

    const alteredPrice = acceptedRequirement(initial);
    alteredPrice.extra.wifPriceUsdScaled18 = "999999999999999999";
    expect(matchesWifQuoteRequirement(alteredPrice, restored, terms)).toBe(false);

    const alteredPayTo = acceptedRequirement(initial);
    alteredPayTo.payTo = "0x0000000000000000000000000000000000000001";
    expect(matchesWifQuoteRequirement(alteredPayTo, restored, terms)).toBe(false);
  });
});
