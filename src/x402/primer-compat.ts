import { isDeepStrictEqual } from "node:util";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

const ROBINHOOD_MAINNET = "eip155:4663";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sameAddress(left: unknown, right: unknown): boolean {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

/** Primer's live Permit2 verifier currently looks for `payload.authorization`.
 * Preserve x402's canonical `permit2Authorization` and add only an identical
 * alias at the outbound facilitator boundary; never alter the signed fields.
 */
export function addPrimerPermit2AuthorizationAlias(
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): PaymentPayload {
  const accepted = (paymentPayload as any).accepted;
  const transferMethod = (paymentRequirements.extra as any)?.assetTransferMethod;
  if (
    paymentPayload.x402Version !== 2 ||
    paymentRequirements.scheme !== "exact" ||
    paymentRequirements.network !== ROBINHOOD_MAINNET ||
    transferMethod !== "permit2" ||
    accepted?.scheme !== "exact" ||
    accepted?.network !== paymentRequirements.network ||
    !sameAddress(accepted?.asset, paymentRequirements.asset) ||
    !sameAddress(accepted?.payTo, paymentRequirements.payTo) ||
    String(accepted?.amount ?? "") !== String(paymentRequirements.amount ?? "") ||
    accepted?.extra?.assetTransferMethod !== "permit2"
  ) {
    return paymentPayload;
  }

  const body = (paymentPayload as any).payload;
  if (!isJsonObject(body) || !isJsonObject(body.permit2Authorization)) return paymentPayload;

  if (body.authorization !== undefined) {
    if (!isDeepStrictEqual(body.authorization, body.permit2Authorization)) {
      throw new Error("Refusing to forward a Permit2 payload with mismatched authorization fields.");
    }
    return paymentPayload;
  }

  return {
    ...paymentPayload,
    payload: {
      ...body,
      authorization: structuredClone(body.permit2Authorization),
    },
  } as PaymentPayload;
}

export function withPrimerPermit2Compatibility(client: FacilitatorClient): FacilitatorClient {
  return {
    verify: (paymentPayload, paymentRequirements) =>
      client.verify(addPrimerPermit2AuthorizationAlias(paymentPayload, paymentRequirements), paymentRequirements),
    settle: (paymentPayload, paymentRequirements) =>
      client.settle(addPrimerPermit2AuthorizationAlias(paymentPayload, paymentRequirements), paymentRequirements),
    getSupported: () => client.getSupported(),
  };
}

export function isPrimerFacilitatorUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "x402.primer.systems";
  } catch {
    return false;
  }
}
