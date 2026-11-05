// Base64 helpers that work in Node, browsers and edge runtimes (no Buffer).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : "=";
  }
  return out;
}

/** Accepts standard or URL-safe base64, with or without padding. */
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, value = 0, o = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("Invalid base64.");
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

export const utf8 = (text: string) => new TextEncoder().encode(text);
export const fromUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
