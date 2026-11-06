import { describe, expect, it } from "vitest";
import { PERMIT2_ADDRESS, x402ExactPermit2ProxyAddress } from "@x402/evm";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  readWifMandatePolicy,
  ROBINHOOD_WIF_MAINNET_TOKEN,
  type EvmMandateReader,
} from "../sdk/js/src/evm-mandate-client.js";

const KEY = (`0x${"12".repeat(32)}`) as Hex;
const AGENT = privateKeyToAccount(KEY).address;
const VAULT = "0x4444444444444444444444444444444444444444" as Address;
const PAY_TO = "0x3333333333333333333333333333333333333333" as Address;

function reader(overrides: Record<string, unknown> = {}, chainId = 4663, code: Hex = "0x6000"): EvmMandateReader {
  const values: Record<string, unknown> = {
    token: ROBINHOOD_WIF_MAINNET_TOKEN,
    permit2: getAddress(PERMIT2_ADDRESS),
    exactProxy: getAddress(x402ExactPermit2ProxyAddress),
    payTo: getAddress(PAY_TO),
    sessionAgent: getAddress(AGENT),
    maxPerCall: 100_000_000_000_000_000n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3_600),
    active: true,
    remainingAllowance: 2_000_000_000_000_000_000n,
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
    await expect(readWifMandatePolicy(reader(), VAULT, KEY)).resolves.toMatchObject({
      address: getAddress(VAULT),
      token: ROBINHOOD_WIF_MAINNET_TOKEN,
      payTo: getAddress(PAY_TO),
      sessionAgent: getAddress(AGENT),
      active: true,
      maxPerCall: 100_000_000_000_000_000n,
    });
  });

  it.each([
    ["testnet or wrong chain", reader({}, 46630)],
    ["address without code", reader({}, 4663, "0x")],
    ["non-WIF token", reader({ token: PAY_TO })],
    ["wrong Permit2", reader({ permit2: PAY_TO })],
    ["wrong x402 proxy", reader({ exactProxy: PAY_TO })],
    ["wrong session key", reader({ sessionAgent: PAY_TO })],
    ["revoked mandate", reader({ active: false })],
    ["expired mandate", reader({ expiry: 1n })],
    ["empty allowance", reader({ remainingAllowance: 0n })],
  ])("rejects %s before signing", async (_label, mockReader) => {
    await expect(readWifMandatePolicy(mockReader as EvmMandateReader, VAULT, KEY)).rejects.toThrow();
  });
});
