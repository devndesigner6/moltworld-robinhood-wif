import crypto from "crypto";
import { config } from "../config.js";

/**
 * Signed proof of a paid request. It binds the on-chain settlement (txid, payer,
 * amount) to exactly what was asked (sha256 of the raw request body) and exactly
 * what was returned (sha256 of the raw response body bytes), plus the upstream
 * model that actually produced the output.
 */
export interface ReceiptPayload {
  v: 1;
  kid: string;
  iss: string;
  id: string;
  network: string;
  asset: string;
  payer: string;
  payTo: string;
  amountMicro: number;
  /** Exact asset base units as a string; required for 18-decimal EVM assets. */
  amountAtomic?: string;
  assetDecimals?: number;
  assetSymbol?: string;
  /** The corresponding model quote in micro-USD, separate from token base units. */
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
}

export interface SignedReceipt extends ReceiptPayload {
  sig: string; // base64url Ed25519 signature over canonicalJson(payload)
}

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(data: Uint8Array | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function keyIdFor(rawPublicKey: Buffer): string {
  return sha256Hex(rawPublicKey).slice(0, 16);
}

function rawPublicKey(publicKey: crypto.KeyObject): Buffer {
  return publicKey.export({ type: "spki", format: "der" }).subarray(ED25519_SPKI_PREFIX.length);
}

/** Accepts a base64 32-byte seed or a base64 PKCS#8 DER Ed25519 private key. */
export function parseSigningKey(encoded: string): crypto.KeyObject {
  const bytes = Buffer.from(encoded, "base64");
  const der = bytes.length === 32 ? Buffer.concat([ED25519_PKCS8_PREFIX, bytes]) : bytes;
  return crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

export function publicKeyFromRaw(raw: Buffer): crypto.KeyObject {
  return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

export class ReceiptSigner {
  readonly kid: string;
  readonly ephemeral: boolean;
  private readonly privateKey: crypto.KeyObject;
  private readonly publicRaw: Buffer;
  private readonly trusted = new Map<string, crypto.KeyObject>();

  constructor(encodedKey = config.receiptSigningKey, previousPublicKeys = process.env.RECEIPT_PREVIOUS_PUBLIC_KEYS) {
    if (encodedKey) {
      this.privateKey = parseSigningKey(encodedKey);
      this.ephemeral = false;
    } else {
      // Development only: assertProductionConfig() requires a persistent key on mainnet.
      this.privateKey = crypto.generateKeyPairSync("ed25519").privateKey;
      this.ephemeral = true;
    }
    this.publicRaw = rawPublicKey(crypto.createPublicKey(this.privateKey));
    this.kid = keyIdFor(this.publicRaw);
    this.trusted.set(this.kid, crypto.createPublicKey(this.privateKey));
    // Rotated-out keys stay trusted for verification so old receipts remain checkable.
    for (const encoded of (previousPublicKeys ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const raw = Buffer.from(encoded, "base64");
      this.trusted.set(keyIdFor(raw), publicKeyFromRaw(raw));
    }
  }

  sign(payload: Omit<ReceiptPayload, "v" | "kid" | "iss" | "issuedAt">): SignedReceipt {
    const full: ReceiptPayload = {
      v: 1,
      kid: this.kid,
      iss: config.publicDomain,
      issuedAt: Math.floor(Date.now() / 1000),
      ...payload,
    };
    const sig = crypto.sign(null, Buffer.from(canonicalJson(full)), this.privateKey).toString("base64url");
    return { ...full, sig };
  }

  verify(receipt: SignedReceipt): boolean {
    const key = this.trusted.get(receipt.kid);
    if (!key) return false;
    return verifyReceiptWithKey(receipt, key);
  }

  publicKeys() {
    return [...this.trusted.entries()].map(([kid, key]) => ({
      kid,
      alg: "Ed25519",
      publicKey: rawPublicKey(key).toString("base64"),
      current: kid === this.kid,
    }));
  }
}

export function verifyReceiptWithKey(receipt: SignedReceipt, key: crypto.KeyObject): boolean {
  try {
    const { sig, ...payload } = receipt;
    return crypto.verify(null, Buffer.from(canonicalJson(payload)), key, Buffer.from(sig, "base64url"));
  } catch {
    return false;
  }
}

export function encodeReceiptHeader(receipt: SignedReceipt): string {
  return Buffer.from(JSON.stringify(receipt)).toString("base64url");
}

export function decodeReceiptHeader(header: string): SignedReceipt {
  return JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
}

export const receiptSigner = new ReceiptSigner();
