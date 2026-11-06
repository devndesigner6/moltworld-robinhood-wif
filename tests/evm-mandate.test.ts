import { describe, expect, it } from "vitest";
import {
  PERMIT2_ADDRESS,
  permit2WitnessTypes,
  x402ExactPermit2ProxyAddress,
} from "@x402/evm";
import {
  decodeAbiParameters,
  getAddress,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createWifEvmMandateSigner,
  ROBINHOOD_MAINNET_CHAIN_ID,
} from "../sdk/js/src/evm-mandate.js";

const SESSION_PRIVATE_KEY = ("0x" + "11".repeat(32)) as Hex;
const sessionAccount = privateKeyToAccount(SESSION_PRIVATE_KEY);
const VAULT = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const PAY_TO = "0x3333333333333333333333333333333333333333";
const EXPIRY = BigInt(Math.floor(Date.now() / 1000) + 3_600);
const CAP = 1_000n;

const policy = {
  sessionPrivateKey: SESSION_PRIVATE_KEY,
  vaultAddress: VAULT,
  expectedChainId: ROBINHOOD_MAINNET_CHAIN_ID,
  expectedWifToken: TOKEN,
  expectedPayTo: PAY_TO,
  expectedPermit2Proxy: x402ExactPermit2ProxyAddress,
  maxPerCallAmount: CAP,
  expiryTimestamp: EXPIRY,
} as const;

function request(overrides: Record<string, unknown> = {}) {
  return {
    domain: {
      name: "Permit2",
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: permit2WitnessTypes,
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token: TOKEN, amount: 100n },
      spender: x402ExactPermit2ProxyAddress,
      nonce: 42n,
      deadline: EXPIRY,
      witness: { to: PAY_TO, validAfter: 0n },
    },
    ...overrides,
  } as any;
}

const WRAPPER_TYPES = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "spender", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
  { name: "to", type: "address" },
  { name: "validAfter", type: "uint256" },
  { name: "sessionSignature", type: "bytes" },
] as const;

describe("WIF EIP-1271 mandate EVM signer", () => {
  it("accepts the exact policy and wraps a session-key Permit2 signature", async () => {
    const signer = createWifEvmMandateSigner(policy);
    const typedData = request({ message: { ...request().message, deadline: EXPIRY - 300n } });
    const wrapperSignature = await signer.signTypedData(typedData);

    expect(signer.address).toBe(getAddress(VAULT));
    const [token, amount, spender, nonce, deadline, to, validAfter, sessionSignature] = decodeAbiParameters(
      WRAPPER_TYPES,
      wrapperSignature,
    );
    expect({ token, amount, spender, nonce, deadline, to, validAfter }).toEqual({
      token: getAddress(TOKEN),
      amount: 100n,
      spender: getAddress(x402ExactPermit2ProxyAddress),
      nonce: 42n,
      deadline: EXPIRY - 300n,
      to: getAddress(PAY_TO),
      validAfter: 0n,
    });

    const recovered = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: sessionSignature,
    });
    expect(recovered).toBe(sessionAccount.address);
  });

  it.each([
    ["wrong chain", { domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2_ADDRESS } }],
    ["wrong token", { message: { ...request().message, permitted: { token: VAULT, amount: 100n } } }],
    ["wrong spender", { message: { ...request().message, spender: PERMIT2_ADDRESS } }],
    ["wrong payTo", { message: { ...request().message, witness: { to: VAULT, validAfter: 0n } } }],
    ["amount over cap", { message: { ...request().message, permitted: { token: TOKEN, amount: CAP + 1n } } }],
    ["wrong expiry", { message: { ...request().message, deadline: EXPIRY + 1n } }],
  ])("rejects %s before signing", async (_label, overrides) => {
    const signer = createWifEvmMandateSigner(policy);
    await expect(signer.signTypedData(request(overrides))).rejects.toThrow();
  });

  it("rejects a non-zero validAfter time bound", async () => {
    const signer = createWifEvmMandateSigner(policy);
    await expect(
      signer.signTypedData(request({ message: { ...request().message, witness: { to: PAY_TO, validAfter: 1n } } })),
    ).rejects.toThrow(/time bounds/);
  });

  it("rejects a mandate configured with a zero per-call cap", () => {
    expect(() => createWifEvmMandateSigner({ ...policy, maxPerCallAmount: 0n })).toThrow(/positive bigint/);
  });
});
