import type { Context, MiddlewareHandler } from "hono";
import crypto from "crypto";
import { config } from "../config.js";
import { listListings, listPayouts, listRefunds, retryRefund, setListingStatus } from "../ledger/index.js";
import { microToUsdString } from "../pricing/index.js";
import { apiError } from "../payments/gateway.js";

/** Operator endpoints. Disabled (404) unless ADMIN_TOKEN is configured. */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (!config.adminToken) return apiError(c, 404, "not_found", "Not found.");
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(config.adminToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return apiError(c, 401, "unauthorized", "Invalid admin token.");
  return next();
};

export async function handleOpsRefunds(c: Context) {
  const refunds = await listRefunds(c.req.query("status") || undefined);
  return c.json({ data: refunds.map((r) => ({ ...r, amount: microToUsdString(r.amount_micro) })) });
}

export async function handleOpsRefundRetry(c: Context) {
  const ok = await retryRefund(c.req.param("id") ?? "");
  return ok ? c.json({ ok: true }) : apiError(c, 409, "not_retryable", "Only failed refunds can be retried.");
}

export async function handleOpsPayouts(c: Context) {
  const payouts = await listPayouts();
  return c.json({ data: payouts.map((p) => ({ ...p, amount: microToUsdString(p.amount_micro) })) });
}

export async function handleOpsListings(c: Context) {
  const status = (c.req.query("status") || undefined) as any;
  const listings = await listListings(status);
  return c.json({ data: listings.map(({ signing_secret: _secret, ...rest }) => rest) });
}

export async function handleOpsListingReview(c: Context) {
  const body: any = await c.req.json().catch(() => ({}));
  if (!["approved", "rejected", "suspended"].includes(body.status)) {
    return apiError(c, 400, "validation_error", "status must be approved, rejected or suspended.");
  }
  const ok = await setListingStatus(c.req.param("id") ?? "", body.status, typeof body.note === "string" ? body.note : undefined);
  return ok ? c.json({ ok: true }) : apiError(c, 404, "listing_not_found", "No such listing.");
}
