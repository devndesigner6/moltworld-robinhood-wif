import type { Context, MiddlewareHandler } from "hono";
import algosdk from "algosdk";
import crypto from "crypto";
import { config } from "../config.js";
import {
  createListing,
  creatorEarnings,
  getListingBySlug,
  listListings,
  listPayouts,
  ListingRecord,
  newId,
} from "../ledger/index.js";
import { verifyOwnerMessage } from "../mandates/index.js";
import { microToUsdString, usdToMicroCeil } from "../pricing/index.js";
import { sha256Hex } from "../receipts/index.js";
import { apiError, isGatewayReady } from "../payments/gateway.js";
import { getPaymentState, setPaymentState } from "../payments/state.js";
import { safeCreatorFetch, SafeResponse, validateCreatorUrl } from "../market/safeFetch.js";

/**
 * Creator marketplace: anyone with an Algorand wallet can put their own HTTPS
 * API behind Moltworld's x402 checkout. Moltworld collects the USDC, forwards the
 * call with an HMAC signature the creator can verify, and pays the creator's
 * share out on-chain in batched transfers once it passes the payout threshold.
 */

const SLUG = /^[a-z0-9][a-z0-9-]{2,47}$/;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PRICE_USD = 5;

type CreatorFetcher = typeof safeCreatorFetch;
let creatorFetcher: CreatorFetcher = safeCreatorFetch;

/** Tests point listings at local servers, which the SSRF guard would (correctly) refuse. */
export function setCreatorFetcherForTests(fetcher: CreatorFetcher | null) {
  creatorFetcher = fetcher ?? safeCreatorFetch;
}

function publicListing(l: ListingRecord) {
  return {
    slug: l.slug,
    name: l.name,
    description: l.description,
    creator: l.creator,
    price: microToUsdString(l.price_micro),
    price_micro_usdc: l.price_micro,
    endpoint: `/v1/market/${l.slug}/call`,
    input_example: l.input_example,
    status: l.status,
    creator_share_percent: 100 - config.marketplaceFeePercent,
    created_at: l.created_at,
  };
}

export async function handleListingCreate(c: Context): Promise<Response> {
  if (config.paymentChain === "robinhood") return apiError(c, 503, "migration_incomplete", "Marketplace listing signatures and creator payouts are still Algorand-specific.");
  const body: any = await c.req.json().catch(() => null);
  const listing = body?.listing;
  if (!listing || typeof body.creator_sig !== "string") {
    return apiError(c, 400, "validation_error", "Body must be { listing: {...}, creator_sig }.");
  }
  if (listing.action !== "list") return apiError(c, 400, "validation_error", "listing.action must be 'list'.");
  if (!algosdk.isValidAddress(listing.creator ?? "")) return apiError(c, 400, "validation_error", "listing.creator must be an Algorand address.");
  if (typeof listing.issued_at !== "number" || Math.abs(Date.now() / 1000 - listing.issued_at) > 600) {
    return apiError(c, 400, "validation_error", "listing.issued_at must be within 10 minutes of server time.");
  }
  if (!SLUG.test(listing.slug ?? "")) return apiError(c, 400, "validation_error", "slug: 3-48 chars of a-z, 0-9 and '-'.");
  if (typeof listing.name !== "string" || !listing.name.trim() || listing.name.length > 80) {
    return apiError(c, 400, "validation_error", "name is required (max 80 chars).");
  }
  if (typeof listing.description !== "string" || listing.description.length < 10 || listing.description.length > 1000) {
    return apiError(c, 400, "validation_error", "description must be 10-1000 chars.");
  }
  const priceUsd = Number(listing.price_usd);
  if (!(priceUsd >= config.priceMinFloor && priceUsd <= MAX_PRICE_USD)) {
    return apiError(c, 400, "validation_error", `price_usd must be between ${config.priceMinFloor} and ${MAX_PRICE_USD}.`);
  }
  try {
    validateCreatorUrl(String(listing.upstream_url));
  } catch (err: any) {
    return apiError(c, 400, "validation_error", err.message);
  }
  if (!verifyOwnerMessage(listing, body.creator_sig, listing.creator)) {
    return apiError(c, 401, "invalid_signature", "creator_sig must sign the canonical JSON of `listing` with the creator's key.");
  }

  const signingSecret = crypto.randomBytes(32).toString("base64url");
  const created = await createListing({
    id: newId("lst"),
    slug: listing.slug,
    name: listing.name.trim(),
    description: listing.description.trim(),
    creator: listing.creator,
    upstream_url: listing.upstream_url,
    price_micro: usdToMicroCeil(priceUsd),
    input_example: listing.input_example ?? null,
    signing_secret: signingSecret,
  });
  if (!created) return apiError(c, 409, "slug_taken", `The slug '${listing.slug}' is taken.`);
  return c.json(
    {
      listing: publicListing(created),
      signing_secret: signingSecret,
      verification:
        "Each forwarded call carries X-Moltworld-Timestamp, X-Moltworld-Request-Id and X-Moltworld-Signature = base64url(HMAC-SHA256(signing_secret, `${timestamp}.${request_id}.${sha256_hex(body)}`)). Reject calls that fail this check.",
      review: "Listings go live after review. Status is visible at GET /v1/market/listings/" + created.slug,
    },
    201
  );
}

export async function handleMarketList(c: Context): Promise<Response> {
  if (config.paymentChain === "robinhood") return apiError(c, 503, "migration_incomplete", "Marketplace payments are not enabled on the WIF rail yet.");
  const listings = await listListings("approved");
  return c.json({ object: "list", data: listings.map(publicListing) });
}

export async function handleListingGet(c: Context): Promise<Response> {
  if (config.paymentChain === "robinhood") return apiError(c, 503, "migration_incomplete", "Marketplace payments are not enabled on the WIF rail yet.");
  const listing = await getListingBySlug(c.req.param("slug") ?? "");
  if (!listing) return apiError(c, 404, "listing_not_found", "No such listing.");
  return c.json({ listing: publicListing(listing), review_note: listing.review_note });
}

export async function handleCreatorEarnings(c: Context): Promise<Response> {
  if (config.paymentChain === "robinhood") return apiError(c, 503, "migration_incomplete", "Creator payout accounting is still Algorand-USDC-specific.");
  const address = c.req.param("address") ?? "";
  if (!algosdk.isValidAddress(address)) return apiError(c, 400, "validation_error", "Invalid address.");
  const earnings = await creatorEarnings(address);
  const payouts = (await listPayouts(address)).filter((p) => p.kind === "creator");
  return c.json({
    creator: address,
    paid_calls: earnings.calls,
    unpaid: microToUsdString(earnings.unpaidMicro),
    paid_out: microToUsdString(earnings.paidMicro),
    payout_threshold: `$${config.creatorPayoutMinUsd}`,
    payouts: payouts.map((p) => ({ id: p.id, amount: microToUsdString(p.amount_micro), status: p.status, txid: p.txid, at: p.created_at })),
  });
}

/** Pre-payment checks for POST /v1/market/:slug/call (mirrors prepareModelRequest). */
export const prepareMarketRequest: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "POST") return next();
  const match = c.req.path.match(/^\/v1\/market\/([^/]+)\/call$/);
  if (!match) return next();
  if (config.paymentChain === "robinhood") return apiError(c, 503, "migration_incomplete", "Marketplace WIF settlement and refunds are not enabled yet. No payment was taken.");
  const listing = await getListingBySlug(match[1]);
  if (!listing || listing.status !== "approved") {
    return apiError(c, 404, "listing_not_found", `No live listing '${match[1]}'. No payment was taken.`);
  }
  if (!isGatewayReady()) return apiError(c, 503, "facilitator_unavailable", "Payment verification is unavailable. No payment was taken.");
  const rawBody = new Uint8Array(await c.req.arrayBuffer());
  if (rawBody.length > MAX_BODY_BYTES) return apiError(c, 413, "body_too_large", `Body exceeds ${MAX_BODY_BYTES} bytes.`);
  if (rawBody.length) {
    try {
      JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return apiError(c, 400, "invalid_json", "Body must be JSON. No payment was taken.");
    }
  }
  setPaymentState(c, {
    requestId: newId("req"),
    kind: "market",
    resource: `/v1/market/${listing.slug}/call`,
    listing,
    rawBody,
    requestSha256: sha256Hex(rawBody),
    amountMicro: listing.price_micro,
    amountAtomic: String(listing.price_micro),
    // Creator APIs are served before settlement; the exposure guard bounds unsettled spend.
    paymentFlow: "authorization",
  });
  return next();
};

export function signForCreator(secret: string, timestamp: string, requestId: string, body: Uint8Array): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${requestId}.${sha256Hex(body)}`).digest("base64url");
}

export async function handleMarketCall(c: Context): Promise<Response> {
  if (config.paymentChain === "robinhood") return apiError(c, 503, "migration_incomplete", "Marketplace WIF settlement is not enabled yet.");
  const state = getPaymentState(c);
  const listing = state?.listing;
  if (!state || !listing) return apiError(c, 500, "internal_error", "Request was not prepared.");
  const timestamp = String(Math.floor(Date.now() / 1000));
  let upstream: SafeResponse;
  try {
    upstream = await creatorFetcher(listing.upstream_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Moltworld-Market/1.0",
        "X-Moltworld-Request-Id": state.requestId,
        "X-Moltworld-Payer": state.payer ?? "",
        "X-Moltworld-Timestamp": timestamp,
        "X-Moltworld-Signature": signForCreator(listing.signing_secret, timestamp, state.requestId, state.rawBody),
      },
      body: state.rawBody,
      timeoutMs: 30_000,
      maxBytes: MAX_RESPONSE_BYTES,
    });
  } catch (err: any) {
    return apiError(c, 502, "creator_unreachable", `${err.message} Your payment was not settled; you were not charged.`);
  }
  if (upstream.status < 200 || upstream.status >= 300) {
    return apiError(c, 502, "creator_error", `Creator endpoint returned HTTP ${upstream.status}. Your payment was not settled.`);
  }
  state.upstream = { provider: "market", model: listing.slug };
  // Never serve creator-controlled HTML/JS from Moltworld's origin.
  const contentType = /^application\/json\b/i.test(upstream.contentType) ? "application/json" : "text/plain; charset=utf-8";
  return new Response(Buffer.from(upstream.body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
