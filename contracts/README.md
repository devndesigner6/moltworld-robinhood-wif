# WIF Permit2 session mandate prototype

`src/WifPermit2SessionMandate.sol` is a self-contained Solidity prototype implementing an owner-funded EIP-1271 signer for x402 EVM exact Permit2 payments.

## Wrapper

The `isValidSignature` wrapper is exactly:

```solidity
abi.encode(
    address token,
    uint256 amount,
    address spender,
    uint256 nonce,
    uint256 deadline,
    address to,
    uint256 validAfter,
    bytes sessionSignature
)
```

The contract checks the wrapper against the immutable token, exact x402 proxy (`spender`), and fixed `payTo`; checks the active session, expiry, per-call limit, Permit2 allowance, and witness time window; recomputes the exact Permit2 `PermitWitnessTransferFrom` EIP-712 digest using `block.chainid`; and accepts only a low-`s` ECDSA signature recovering to the configured session agent. Both 65-byte and EIP-2098 64-byte signatures are accepted.

`arm` is owner-only and installs one agent, per-call raw-token limit, expiry, and a finite token allowance to Permit2. `revoke` is owner-only, disables the session, and sets that allowance to zero. `withdraw` is owner-only and only works while inactive; it transfers the fixed token back to the fixed owner. There is no generic call/execute path, arbitrary-token approval, ownership transfer, or session-key policy mutation.

## Important scope note

The finite ERC-20 allowance is an aggregate spend cap only assuming a standard ERC-20 whose `transferFrom` decrements allowance after each successful Permit2 transfer. The validator checks the live allowance before each signature validation; it does not maintain a separate spend counter or reserve concurrent validations. A local Ganache test exercises state transitions, but this prototype has not been production-audited.

## Compile

From the repository root, with no root dependency changes:

```sh
npx --yes solc@0.8.30 --base-path contracts --include-path contracts --bin --abi \
  contracts/src/WifPermit2SessionMandate.sol -o /tmp/wif-permit2-solc
```

From the repository root, after installing the root Node dependencies, run:

```sh
npm --prefix contracts run compile
npm --prefix contracts run test:typed-data
npm --prefix contracts run test:stateful
```

The stateful test starts transient Ganache on localhost with throwaway test keys and a test-only ERC-20. It checks owner `arm`, exact Permit2 witness signature acceptance, wrong amount/spender rejection, non-owner revoke rejection, finite mock allowance decrement, owner revoke/reset, and invalidation after revoke. It is local simulated-chain coverage only—not proof of a real Permit2 deployment, facilitator, Robinhood RPC, or production security. An independent audit remains required.
