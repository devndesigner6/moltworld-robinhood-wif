import { describe, expect, it } from "vitest";
import { PERMIT2_ADDRESS, x402ExactPermit2ProxyAddress } from "@x402/evm";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  isCanonicalWifMandateRuntime,
  readWifMandatePolicy,
  ROBINHOOD_WIF_MAINNET_TOKEN,
  type EvmMandateReader,
} from "../sdk/js/src/evm-mandate-client.js";
import { WIF_MANDATE_ARTIFACT } from "../sdk/js/src/wif-mandate-artifact.js";

const KEY = (`0x${"12".repeat(32)}`) as Hex;
const AGENT = privateKeyToAccount(KEY).address;
const VAULT = "0x4444444444444444444444444444444444444444" as Address;
const OWNER = "0x6666666666666666666666666666666666666666" as Address;
const PAY_TO = "0x3333333333333333333333333333333333333333" as Address;

function reader(
  overrides: Record<string, unknown> = {},
  chainId = 4663,
  code: Hex = WIF_MANDATE_ARTIFACT.runtimeTemplate,
): EvmMandateReader {
  const values: Record<string, unknown> = {
    owner: getAddress(OWNER),
    token: ROBINHOOD_WIF_MAINNET_TOKEN,
    permit2: getAddress(PERMIT2_ADDRESS),
    exactProxy: getAddress(x402ExactPermit2ProxyAddress),
    payTo: getAddress(PAY_TO),
    sessionAgent: getAddress(AGENT),
    maxPerCall: 100_000_000_000_000_000n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3_600),
    active: true,
    remainingAllowance: 2_000_000_000_000_000_000n,
    tokenBalance: 2_000_000_000_000_000_000n,
    sessionEpoch: 1n,
    ...overrides,
  };
  return {
    async getChainId() { return chainId; },
    async getCode() { return code; },
    async readContract({ functionName }) { return values[functionName]; },
  };
}

describe("WIF on-chain mandate policy reader", () => {
  it("accepts the canonical active mandate for the configured session key", async () => {
    await expect(readWifMandatePolicy(reader(), VAULT, KEY, OWNER, PAY_TO)).resolves.toMatchObject({
      address: getAddress(VAULT),
      owner: getAddress(OWNER),
      token: ROBINHOOD_WIF_MAINNET_TOKEN,
      payTo: getAddress(PAY_TO),
      sessionAgent: getAddress(AGENT),
      active: true,
      maxPerCall: 100_000_000_000_000_000n,
      sessionEpoch: 1n,
      tokenBalance: 2_000_000_000_000_000_000n,
    });
  });

  it("recognizes only the pinned runtime bytecode after zeroing constructor immutables", () => {
    expect(isCanonicalWifMandateRuntime(WIF_MANDATE_ARTIFACT.runtimeTemplate)).toBe(true);
    expect(isCanonicalWifMandateRuntime("0x6000")).toBe(false);
  });

  it.each([
    ["testnet or wrong chain", reader({}, 46630)],
    ["address without code", reader({}, 4663, "0x")],
    ["unrecognized deployed code", reader({}, 4663, "0x6000")],
    ["wrong owner", reader({ owner: PAY_TO })],
    ["non-WIF token", reader({ token: PAY_TO })],
    ["wrong Permit2", reader({ permit2: PAY_TO })],
    ["wrong x402 proxy", reader({ exactProxy: PAY_TO })],
    ["wrong gateway recipient", reader({ payTo: "0x5555555555555555555555555555555555555555" })],
    ["wrong session key", reader({ sessionAgent: PAY_TO })],
    ["revoked mandate", reader({ active: false })],
    ["expired mandate", reader({ expiry: 1n })],
    ["empty allowance", reader({ remainingAllowance: 0n })],
    ["allowance above token balance", reader({ tokenBalance: 1n })],
  ])("rejects %s before signing", async (_label, mockReader) => {
    await expect(readWifMandatePolicy(mockReader as EvmMandateReader, VAULT, KEY, OWNER, PAY_TO)).rejects.toThrow();
  });
});
