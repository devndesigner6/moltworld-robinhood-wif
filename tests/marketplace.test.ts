import { beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

// Load this unit under the Robinhood test network so the EIP-712 domain has a
// numeric chain id. The production default remains disabled unless explicitly enabled.
process.env.PAYMENT_CHAIN = "robinhood";
process.env.ROBINHOOD_NETWORK = "testnet";
delete process.env.ROBINHOOD_MARKETPLACE_ENABLED;

const evm = await import("../src/payments/marketplace-evm.js");
const market = await import("../src/routes/market.js");
const ledger = await import("../src/ledger/index.js");
const db = await import("../src/ledger/db.js");
const { usdMicroToTokenAtomic } = await import("../src/pricing/wif.js");

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const PAY_TO = "0x00000000000000000000000000000000000000aa";
const listing = {
  action: "list" as const,
  creator: account.address,
  slug: "weather-api",
  name: "Weather API",
  description: "Returns current weather for a requested city.",
  upstream_url: "https://creator.example/weather",
  price_micro: 20_000,
  input_example: { city: "Lagos" },
  nonce: "nonce-001",
  issued_at: Math.floor(Date.now() / 1000),
};

beforeEach(async () => {
  await db.resetDatabaseForTests();
  delete process.env.ROBINHOOD_MARKETPLACE_ENABLED;
});

describe("WIF marketplace safeguards", () => {
  it("verifies the EIP-712 domain and configured chain, and rejects nonce or domain replay", async () => {
    const typed = evm.marketplaceListingTypedData(listing);
    const signature = await account.signTypedData(typed as any);
    expect(await evm.verifyCreatorListingSignature(listing, signature)).toBe(true);

    expect(await evm.verifyCreatorListingSignature({ ...listing, nonce: "nonce-002" }, signature)).toBe(false);
    const wrongDomainSignature = await account.signTypedData({
      ...typed,
      domain: { ...typed.domain, chainId: 1 },
    } as any);
    expect(await evm.verifyCreatorListingSignature(listing, wrongDomainSignature)).toBe(false);
  });

  it("binds the USD quote to an exact WIF base-unit amount and credits exact creator units", () => {
    expect(usdMicroToTokenAtomic(20_000, 2_000_000_000_000_000_000n, 18)).toBe("10000000000000000");
    expect(usdMicroToTokenAtomic(20_000, 3_000_000_000_000_000_000n, 18)).toBe("6666666666666667");
    expect(evm.creatorShareAtomic("10000000000000000", 15)).toBe("8500000000000000");
  });

  it("consumes a creator nonce at the ledger boundary and rejects replay", async () => {
    const common = {
      slug: "replay-safe",
      name: "Replay Safe",
      description: "A listing used to test nonce replay protection.",
      creator: listing.creator.toLowerCase(),
      upstream_url: listing.upstream_url,
      price_micro: listing.price_micro,
      input_example: null,
      signing_secret: "secret",
      listing_nonce: listing.nonce,
    };
    expect(await ledger.createListing({ id: "lst_first", ...common })).toBeTruthy();
    expect(await ledger.createListing({ id: "lst_replay", ...common })).toBeUndefined();
  });

  it("keeps creator credits and payout batches in exact WIF base units", async () => {
    const requestId = "req_wif_creator_credit";
    const network = "eip155:46630";
    const asset = "0x5173b8eA6923c2d40267890D45C46a3480954773";
    expect(await ledger.createRequest({
      id: requestId,
      paymentHash: "0x" + "ab".repeat(32),
      kind: "market",
      resource: "/v1/market/weather-api/call",
      listingId: "lst_weather",
      payer: listing.creator,
      payTo: PAY_TO,
      network,
      asset,
      amountMicro: 100_000,
      amountAtomic: "100000000000000000",
      paymentFlow: "authorization",
      requestSha256: "0".repeat(64),
    })).toBe(true);
    await ledger.addCredit(listing.creator.toLowerCase(), "creator", 85_000, requestId, "85000000000000000", {
      assetAddress: asset,
      assetSymbol: "WIF",
      assetDecimals: 18,
      network,
    });

    const legacyRequestId = "req_legacy_creator_credit";
    expect(await ledger.createRequest({
      id: legacyRequestId,
      paymentHash: "0x" + "cd".repeat(32),
      kind: "market",
      resource: "/v1/market/weather-api/call",
      listingId: "lst_legacy_weather",
      payer: listing.creator,
      payTo: PAY_TO,
      network: "algorand:mainnet",
      asset: "10458941",
      amountMicro: 10_000,
      amountAtomic: "10000",
      paymentFlow: "upfront",
      requestSha256: "1".repeat(64),
    })).toBe(true);
    await ledger.addCredit(listing.creator.toLowerCase(), "creator", 10_000, legacyRequestId);

    const earnings = await ledger.creatorEarnings(listing.creator.toLowerCase(), asset, network);
    expect(earnings.unpaidMicro).toBe(85_000);
    expect(earnings.unpaidAtomic).toBe("85000000000000000");
    const combinedLegacyEarnings = await ledger.creatorEarnings(listing.creator.toLowerCase(), asset, network, true);
    expect(combinedLegacyEarnings.unpaidMicro).toBe(95_000);
    const legacyPayouts = await ledger.createPayoutsFromCredits("creator", 5_000, {
      assetAddress: "10458941", assetSymbol: "USDC", assetDecimals: 6, network: "algorand:mainnet",
    }, true);
    expect(legacyPayouts).toHaveLength(1);
    const wifPayouts = await ledger.createPayoutsFromCredits("creator", 5_000, {
      assetAddress: asset, assetSymbol: "WIF", assetDecimals: 18, network,
    });
    expect(wifPayouts).toHaveLength(1);
    const wifPayout = wifPayouts[0];
    const legacyPayout = legacyPayouts[0];
    expect(wifPayout?.amount_atomic).toBe("85000000000000000");
    expect(legacyPayout?.amount_atomic).toBe("10000");
    const earningsAfterBatching = await ledger.creatorEarnings(listing.creator.toLowerCase(), asset, network);
    expect(earningsAfterBatching.unpaidMicro).toBe(85_000);

    const legacyWorkerBatch = await ledger.claimPendingPayouts(16, {
      assetAddress: "10458941", assetSymbol: "USDC", assetDecimals: 6, network: "algorand:mainnet",
    }, true);
    expect(legacyWorkerBatch).toHaveLength(1);
    expect(legacyWorkerBatch[0].asset_symbol).toBe("USDC");
    expect(legacyWorkerBatch[0].asset_address).toBe("");
    const wifWorkerBatch = await ledger.claimPendingPayouts(16, {
      assetAddress: asset, assetSymbol: "WIF", assetDecimals: 18, network,
    });
    expect(wifWorkerBatch).toHaveLength(1);
    expect(wifWorkerBatch[0].asset_symbol).toBe("WIF");
  });

  it("is disabled by default on Robinhood and only enables explicitly", () => {
    expect(market.robinhoodMarketplaceEnabled()).toBe(false);
    process.env.ROBINHOOD_MARKETPLACE_ENABLED = "true";
    expect(market.robinhoodMarketplaceEnabled()).toBe(true);
  });
});
