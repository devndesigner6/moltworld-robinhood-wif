import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { fromBase64, fromUtf8, utf8 } from "./encoding.js";

/** Mirror of the gateway's receipt format (see /.well-known/moltworld-receipts.json). */
export interface MoltworldReceipt {
  v: 1;
  kid: string;
  iss: string;
  id: string;
  network: string;
  asset: string;
  payer: string;
  payTo: string;
  amountMicro: number;
  amountAtomic?: string;
  assetDecimals?: number;
  assetSymbol?: string;
  quotedUsdMicro?: number;
  wifPrice?: { source: string; priceUsd: string; observedAt: string; liquidityUsd: number };
  txid: string;
  resource: string;
  model: string | null;
  upstreamProvider: string | null;
  upstreamModel: string | null;
  requestSha256: string;
  responseSha256: string;
  rebateMicro: number;
  issuedAt: number;
  sig: string;
}

export interface ReceiptCheck {
  signatureValid: boolean;
  requestMatches: boolean | null;
  responseMatches: boolean | null;
  ok: boolean;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8(data) : data));
}

export function decodeReceiptHeader(header: string): MoltworldReceipt {
  return JSON.parse(fromUtf8(fromBase64(header)));
}

/** Verify a receipt against the gateway's published key and the bytes you sent and received. */
export function checkReceipt(
  receipt: MoltworldReceipt,
  publicKeyBase64: string,
  bytes: { request?: Uint8Array | string; response?: Uint8Array }
): ReceiptCheck {
  let signatureValid = false;
  try {
    const { sig, ...payload } = receipt;
    signatureValid = ed25519.verify(fromBase64(sig), utf8(canonicalJson(payload)), fromBase64(publicKeyBase64));
  } catch {
    signatureValid = false;
  }
  const requestMatches = bytes.request === undefined ? null : sha256Hex(bytes.request) === receipt.requestSha256;
  const responseMatches = bytes.response === undefined ? null : sha256Hex(bytes.response) === receipt.responseSha256;
  return { signatureValid, requestMatches, responseMatches, ok: signatureValid && requestMatches !== false && responseMatches !== false };
}
