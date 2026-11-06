import crypto from "crypto";
import { canonicalJson } from "../receipts/index.js";

function paymentBody(payload: any): any {
  return payload && typeof payload === "object" && "payload" in payload ? payload.payload : payload;
}

export function evmPayerFromPayload(payload: any): string | null {
  const body = paymentBody(payload);
  const raw = body?.authorization?.from ?? body?.permit2Authorization?.from;
  return typeof raw === "string" && /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : null;
}

/** Stable request lock key for an off-chain EIP-712/Permit2 authorization. */
export function evmPaymentIdFromPayload(payload: any): string | null {
  const body = paymentBody(payload);
  const signature = body?.signature;
  const authorization = body?.authorization ?? body?.permit2Authorization;
  if (typeof signature !== "string" || !authorization || typeof authorization !== "object") return null;
  return crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/** Extracts the x402 v2 accepted requirement from the base64 Payment-Signature envelope. */
export function evmAcceptedFromHeader(header: string): any | null {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    const accepted = JSON.parse(decoded)?.accepted;
    return accepted && typeof accepted === "object" ? accepted : null;
  } catch {
    return null;
  }
}

export function evmPaymentIdFromHeader(header: string): string | null {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    return evmPaymentIdFromPayload(JSON.parse(decoded));
  } catch {
    return null;
  }
}
