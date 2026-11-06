import {
  PERMIT2_ADDRESS,
  permit2WitnessTypes,
  x402ExactPermit2ProxyAddress,
  type ClientEvmSigner,
} from "@x402/evm";
import {
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROBINHOOD_MAINNET_CHAIN_ID = 4663;
const WRAPPER_SIGNATURE_TYPES = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "spender", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
  { name: "to", type: "address" },
  { name: "validAfter", type: "uint256" },
  { name: "sessionEpoch", type: "uint256" },
  { name: "sessionSignature", type: "bytes" },
] as const;

const SESSION_AUTH_TYPES = {
  SessionAuthorization: [
    { name: "permit2Digest", type: "bytes32" },
    { name: "sessionEpoch", type: "uint256" },
  ],
} as const;

export interface WifEvmMandateSignerOptions {
  /** Private key for the short-lived session key. It is never exposed by the returned signer. */
  sessionPrivateKey: Hex | string;
  /** Contract wallet / vault address whose EIP-1271 wrapper will be checked on-chain. */
  vaultAddress: Address | string;
  /** Chain ID in the Permit2 domain. Defaults to Robinhood Chain mainnet. */
  expectedChainId?: number;
  expectedWifToken: Address | string;
  expectedPayTo: Address | string;
  /** Defaults to x402's exact Permit2 proxy; a supplied value must equal that official address. */
  expectedPermit2Proxy?: Address | string;
  /** Maximum WIF base units allowed in one Permit2 authorization. */
  maxPerCallAmount: bigint;
  /** Current on-chain policy epoch; old signatures cannot be reused after revoke/re-arm. */
  sessionEpoch: bigint;
  /** Exact Unix-seconds deadline accepted by this signer. */
  expiryTimestamp: bigint | number;
}

type SignTypedDataRequest = Parameters<ClientEvmSigner["signTypedData"]>[0];

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameKeys(value: PlainObject, expected: PlainObject): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length && actualKeys.every((key, i) => key === expectedKeys[i]);
}

function deeplyEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && actual.every((item, i) => deeplyEqual(item, expected[i]));
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    return sameKeys(actual, expected) && Object.keys(expected).every((key) => deeplyEqual(actual[key], expected[key]));
  }
  return false;
}

function requireAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${label} must be a valid EVM address.`);
  }
}

function requireTimestamp(value: bigint | number, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} must be a non-negative Unix timestamp.`);
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer Unix timestamp.`);
  }
  return BigInt(value);
}

function requireRequestObject(value: unknown, label: string): PlainObject {
  if (!isPlainObject(value)) throw new Error(`${label} is malformed.`);
  return value;
}

function requireBigint(value: unknown, label: string): bigint {
  if (typeof value !== "bigint") throw new Error(`${label} must be a bigint.`);
  return value;
}

/**
 * Creates an isolated x402 ClientEvmSigner for a future EIP-1271 WIF mandate.
 *
 * x402 supplies a Permit2 `PermitWitnessTransferFrom` request. This adapter checks the
 * complete request against the local policy, binds the session signature to both the Permit2
 * digest and current on-chain epoch, and returns the mandate's EIP-1271 wrapper:
 *
 * `abi.encode(token, amount, spender, nonce, deadline, to, validAfter, sessionEpoch, sessionSignature)`.
 *
 * This helper does not deploy a wallet, submit transactions, or make any allowance claim;
 * it only bounds and wraps the off-chain signature.
 */
export function createWifEvmMandateSigner(options: WifEvmMandateSignerOptions): ClientEvmSigner {
  const vaultAddress = requireAddress(options.vaultAddress, "vaultAddress");
  const expectedToken = requireAddress(options.expectedWifToken, "expectedWifToken");
  const expectedPayTo = requireAddress(options.expectedPayTo, "expectedPayTo");
  const expectedProxy = requireAddress(
    options.expectedPermit2Proxy ?? x402ExactPermit2ProxyAddress,
    "expectedPermit2Proxy",
  );
  if (expectedProxy !== getAddress(x402ExactPermit2ProxyAddress)) {
    throw new Error("expectedPermit2Proxy must be x402's official exact Permit2 proxy.");
  }
  const expectedChainId = options.expectedChainId ?? ROBINHOOD_MAINNET_CHAIN_ID;
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1) {
    throw new Error("expectedChainId must be a positive safe integer.");
  }
  if (typeof options.maxPerCallAmount !== "bigint" || options.maxPerCallAmount <= 0n) {
    throw new Error("maxPerCallAmount must be a positive bigint.");
  }
  const expiryTimestamp = requireTimestamp(options.expiryTimestamp, "expiryTimestamp");
  if (typeof options.sessionEpoch !== "bigint" || options.sessionEpoch <= 0n) {
    throw new Error("sessionEpoch must be a positive bigint read from the active mandate.");
  }
  const sessionAccount = privateKeyToAccount(options.sessionPrivateKey as Hex);
  const permit2Address = getAddress(PERMIT2_ADDRESS);

  return {
    address: vaultAddress,
    async signTypedData(request: SignTypedDataRequest): Promise<Hex> {
      const domain = requireRequestObject(request.domain, "EIP-712 domain");
      const types = requireRequestObject(request.types, "EIP-712 types");
      const message = requireRequestObject(request.message, "Permit2 message");

      if (request.primaryType !== "PermitWitnessTransferFrom") {
        throw new Error("Refusing to sign a non-PermitWitnessTransferFrom request.");
      }
      if (!sameKeys(domain, { name: "", chainId: 0, verifyingContract: "" })) {
        throw new Error("Refusing to sign a Permit2 request with unexpected domain fields.");
      }
      if (domain.name !== "Permit2" || domain.chainId !== expectedChainId) {
        throw new Error("Refusing to sign a Permit2 request for the wrong domain or chain.");
      }
      if (typeof domain.verifyingContract !== "string" || getAddress(domain.verifyingContract) !== permit2Address) {
        throw new Error("Refusing to sign a Permit2 request for the wrong verifying contract.");
      }
      if (!deeplyEqual(types, permit2WitnessTypes)) {
        throw new Error("Refusing to sign a Permit2 request with unexpected typed-data fields.");
      }
      if (!sameKeys(message, { permitted: {}, spender: "", nonce: 0n, deadline: 0n, witness: {} })) {
        throw new Error("Refusing to sign a Permit2 request with unexpected message fields.");
      }

      const permitted = requireRequestObject(message.permitted, "Permit2 permitted fields");
      const witness = requireRequestObject(message.witness, "Permit2 witness fields");
      if (!sameKeys(permitted, { token: "", amount: 0n })) {
        throw new Error("Refusing to sign a Permit2 request with unexpected permitted fields.");
      }
      if (!sameKeys(witness, { to: "", validAfter: 0n })) {
        throw new Error("Refusing to sign a Permit2 request with unexpected witness fields.");
      }
      if (typeof permitted.token !== "string" || getAddress(permitted.token) !== expectedToken) {
        throw new Error("Refusing to sign a Permit2 request for the wrong WIF token.");
      }
      if (typeof message.spender !== "string" || getAddress(message.spender) !== expectedProxy) {
        throw new Error("Refusing to sign a Permit2 request for the wrong x402 proxy.");
      }
      if (typeof witness.to !== "string" || getAddress(witness.to) !== expectedPayTo) {
        throw new Error("Refusing to sign a Permit2 request for the wrong payTo.");
      }

      const amount = requireBigint(permitted.amount, "Permit2 amount");
      const nonce = requireBigint(message.nonce, "Permit2 nonce");
      const deadline = requireBigint(message.deadline, "Permit2 deadline");
      const validAfter = requireBigint(witness.validAfter, "Permit2 validAfter");
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (amount <= 0n || amount > options.maxPerCallAmount) {
        throw new Error("Refusing to sign a Permit2 amount over the mandate cap.");
      }
      if (nonce < 0n || deadline > expiryTimestamp || deadline <= now) {
        throw new Error("Refusing to sign a Permit2 request with an invalid or expired deadline.");
      }
      if (validAfter !== 0n || validAfter > now || deadline <= validAfter) {
        throw new Error("Refusing to sign a Permit2 request with invalid time bounds.");
      }

      // The epoch is included in the session-key signature, not only the wrapper. This
      // prevents an unused old Permit2 signature from being revived by re-arming the same key.
      const permit2Digest = hashTypedData({
        domain: request.domain as any,
        types: request.types as any,
        primaryType: request.primaryType as any,
        message: request.message as any,
      });
      const sessionSignature = await sessionAccount.signTypedData({
        domain: {
          name: "MoltworldWifSessionMandate",
          chainId: expectedChainId,
          verifyingContract: vaultAddress,
        },
        types: SESSION_AUTH_TYPES,
        primaryType: "SessionAuthorization",
        message: { permit2Digest, sessionEpoch: options.sessionEpoch },
      });
      return encodeAbiParameters(WRAPPER_SIGNATURE_TYPES, [
        expectedToken,
        amount,
        expectedProxy,
        nonce,
        deadline,
        expectedPayTo,
        validAfter,
        options.sessionEpoch,
        sessionSignature,
      ]);
    },
  };
}

export { ROBINHOOD_MAINNET_CHAIN_ID };
