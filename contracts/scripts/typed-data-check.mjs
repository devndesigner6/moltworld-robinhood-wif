import assert from "node:assert/strict";
import {
  concat,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
} from "viem";

const permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const token = "0x1111111111111111111111111111111111111111";
const spender = "0x2222222222222222222222222222222222222222";
const to = "0x3333333333333333333333333333333333333333";
const amount = 123456789n;
const nonce = 987654321n;
const deadline = 1_900_000_000n;
const validAfter = 1_800_000_000n;
const chainId = 4663;
const mandate = "0x4444444444444444444444444444444444444444";
const sessionEpoch = 3n;
const sessionSignature = "0x1234567890abcdef";

const domain = {
  name: "Permit2",
  chainId,
  verifyingContract: permit2,
};
const types = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Witness" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  Witness: [
    { name: "to", type: "address" },
    { name: "validAfter", type: "uint256" },
  ],
};
const message = {
  permitted: { token, amount },
  spender,
  nonce,
  deadline,
  witness: { to, validAfter },
};

const viemDigest = hashTypedData({
  domain,
  types,
  primaryType: "PermitWitnessTransferFrom",
  message,
});

const domainTypeHash = keccak256(
  new TextEncoder().encode("EIP712Domain(string name,uint256 chainId,address verifyingContract)")
);
const permit2NameHash = keccak256(new TextEncoder().encode("Permit2"));
const tokenPermissionsTypeHash = keccak256(
  new TextEncoder().encode("TokenPermissions(address token,uint256 amount)")
);
const witnessTypeHash = keccak256(new TextEncoder().encode("Witness(address to,uint256 validAfter)"));
const permitWitnessTypeHash = keccak256(
  new TextEncoder().encode(
    "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,Witness witness)TokenPermissions(address token,uint256 amount)Witness(address to,uint256 validAfter)"
  )
);
const abi32 = [
  { type: "bytes32" },
  { type: "bytes32" },
  { type: "uint256" },
  { type: "address" },
];
const domainSeparator = keccak256(
  encodeAbiParameters(abi32, [domainTypeHash, permit2NameHash, BigInt(chainId), permit2])
);
const permittedHash = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
    [tokenPermissionsTypeHash, token, amount]
  )
);
const witnessHash = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
    [witnessTypeHash, to, validAfter]
  )
);
const structHash = keccak256(
  encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [permitWitnessTypeHash, permittedHash, spender, nonce, deadline, witnessHash]
  )
);
const manualDigest = keccak256(concat(["0x1901", domainSeparator, structHash]));
assert.equal(manualDigest, viemDigest, "manual digest must match viem's typed-data digest");

const sessionNameHash = keccak256(new TextEncoder().encode("MoltworldWifSessionMandate"));
const sessionAuthTypeHash = keccak256(
  new TextEncoder().encode("SessionAuthorization(bytes32 permit2Digest,uint256 sessionEpoch)")
);
const sessionDomainSeparator = keccak256(
  encodeAbiParameters(abi32, [domainTypeHash, sessionNameHash, BigInt(chainId), mandate])
);
const sessionStructHash = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
    [sessionAuthTypeHash, viemDigest, sessionEpoch]
  )
);
const manualSessionDigest = keccak256(concat(["0x1901", sessionDomainSeparator, sessionStructHash]));
const viemSessionDigest = hashTypedData({
  domain: { name: "MoltworldWifSessionMandate", chainId, verifyingContract: mandate },
  types: {
    SessionAuthorization: [
      { name: "permit2Digest", type: "bytes32" },
      { name: "sessionEpoch", type: "uint256" },
    ],
  },
  primaryType: "SessionAuthorization",
  message: { permit2Digest: viemDigest, sessionEpoch },
});
assert.equal(manualSessionDigest, viemSessionDigest, "manual session digest must match viem's epoch-bound digest");

const wrapper = encodeAbiParameters(
  [
    { type: "address" },
    { type: "uint256" },
    { type: "address" },
    { type: "uint256" },
    { type: "uint256" },
    { type: "address" },
    { type: "uint256" },
    { type: "uint256" },
    { type: "bytes" },
  ],
  [token, amount, spender, nonce, deadline, to, validAfter, sessionEpoch, sessionSignature]
);
assert.equal(
  wrapper.slice(0, 2 + 64),
  `0x${token.slice(2).padStart(64, "0")}`,
  "wrapper must begin with the encoded token address"
);
assert.equal(wrapper.length % 64, 2, "canonical abi.encode wrapper must be word-aligned");

console.log(`typed-data digest agreement: ${manualDigest}`);
console.log(`epoch-bound session digest agreement: ${manualSessionDigest}`);
console.log(`wrapper bytes: ${(wrapper.length - 2) / 2}`);
