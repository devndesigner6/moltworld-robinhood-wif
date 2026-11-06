import { describe, expect, it } from "vitest";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { addPrimerPermit2AuthorizationAlias, isPrimerFacilitatorUrl, withPrimerPermit2Compatibility } from "../src/x402/primer-compat.js";

const authorization = {
  from: "0x1111111111111111111111111111111111111111",
  permitted: { token: "0x2222222222222222222222222222222222222222", amount: "123456" },
  spender: "0x3333333333333333333333333333333333333333",
  nonce: "99",
  deadline: "1900000000",
  witness: { to: "0x4444444444444444444444444444444444444444", validAfter: "0" },
};

function requirements(overrides: Record<string, unknown> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:4663",
    amount: "123456",
    asset: authorization.permitted.token,
    payTo: authorization.witness.to,
    maxTimeoutSeconds: 120,
    extra: { assetTransferMethod: "permit2" },
    ...overrides,
  } as PaymentRequirements;
}

function payload(overrides: Record<string, unknown> = {}): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:4663",
      amount: "123456",
      asset: authorization.permitted.token,
      payTo: authorization.witness.to,
      maxTimeoutSeconds: 120,
      extra: { assetTransferMethod: "permit2" },
    },
    payload: { signature: "0xdeadbeef", permit2Authorization: structuredClone(authorization) },
    ...overrides,
  } as PaymentPayload;
}

describe("Primer Robinhood Permit2 compatibility", () => {
  it("adds an identical alias only to the forwarded payload and uses it for verify and settle", async () => {
    const forwarded: PaymentPayload[] = [];
    const upstream = {
      verify: async (p: PaymentPayload) => { forwarded.push(p); return { isValid: false, invalidReason: "test" } as any; },
      settle: async (p: PaymentPayload) => { forwarded.push(p); return { success: false, errorReason: "test" } as any; },
      getSupported: async () => ({}) as any,
    } as FacilitatorClient;
    const compat = withPrimerPermit2Compatibility(upstream);
    const original = payload();

    await compat.verify(original, requirements());
    await compat.settle(original, requirements());

    expect(forwarded).toHaveLength(2);
    for (const sent of forwarded) {
      expect((sent as any).payload.authorization).toEqual(authorization);
      expect((sent as any).payload.authorization).not.toBe((sent as any).payload.permit2Authorization);
      expect((sent as any).payload.permit2Authorization).toEqual(authorization);
      expect((sent as any).payload.signature).toBe("0xdeadbeef");
    }
    expect((original as any).payload.authorization).toBeUndefined();
    expect((original as any).payload.permit2Authorization).toEqual(authorization);
  });

  it("does not adapt EIP-3009, other networks, or a nonmatching accepted requirement", () => {
    const eip3009 = payload({
      accepted: { scheme: "exact", network: "eip155:4663", amount: "123456", asset: authorization.permitted.token, payTo: authorization.witness.to, extra: { assetTransferMethod: "eip3009" } },
      payload: { signature: "0xbeef", authorization },
    });
    expect((addPrimerPermit2AuthorizationAlias(eip3009, requirements({ extra: { assetTransferMethod: "eip3009" } })) as any).payload.authorization).toBe(authorization);

    const otherNetwork = payload({
      accepted: { ...(payload() as any).accepted, network: "eip155:8453" },
      payload: { signature: "0xdeadbeef", permit2Authorization: authorization },
    });
    const baseRequirements = requirements({ network: "eip155:8453" });
    expect((addPrimerPermit2AuthorizationAlias(otherNetwork, baseRequirements) as any).payload.authorization).toBeUndefined();

    const wrongAmount = payload({ accepted: { ...(payload() as any).accepted, amount: "1" } });
    expect((addPrimerPermit2AuthorizationAlias(wrongAmount, requirements()) as any).payload.authorization).toBeUndefined();
  });

  it("fails closed if an existing authorization alias differs from the signed Permit2 fields", () => {
    const inconsistent = payload({
      payload: { signature: "0xdeadbeef", permit2Authorization: authorization, authorization: { ...authorization, nonce: "100" } },
    });
    expect(() => addPrimerPermit2AuthorizationAlias(inconsistent, requirements())).toThrow(/mismatched authorization fields/);
  });

  it("recognizes only Primer's HTTPS facilitator host", () => {
    expect(isPrimerFacilitatorUrl("https://x402.primer.systems")).toBe(true);
    expect(isPrimerFacilitatorUrl("https://x402.primer.systems/")).toBe(true);
    expect(isPrimerFacilitatorUrl("http://x402.primer.systems")).toBe(false);
    expect(isPrimerFacilitatorUrl("https://x402.primer.systems.evil.example")).toBe(false);
    expect(isPrimerFacilitatorUrl("not a url")).toBe(false);
  });
});
