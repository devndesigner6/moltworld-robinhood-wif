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
    uint256 sessionEpoch,
    bytes sessionSignature
)
```

The contract checks the wrapper against the immutable token, exact x402 proxy (`spender`), and fixed `payTo`; checks the active session, exclusive expiry, per-call limit, Permit2 allowance, and witness time window; and recomputes the exact Permit2 `PermitWitnessTransferFrom` digest. The session key signs a separate EIP-712 `SessionAuthorization(permit2Digest, sessionEpoch)` digest. Each arm and revoke advances the on-chain epoch, so a previously unused signature cannot be revived by re-arming the same key. Both 65-byte and EIP-2098 64-byte signatures are accepted.

On Robinhood mainnet (`chainId=4663`), construction rejects anything except the canonical WIF token, Permit2, and x402 exact Permit2 proxy, and checks those addresses have code. The pay-to address remains an immutable constructor value and must be compared with the trusted live gateway `/health` pay-to before deployment and agent use. `arm` is owner-only and installs one EOA session agent, per-call raw-token limit, expiry, and a finite token allowance to Permit2; `uint256.max` is rejected. `revoke` is owner-only, disables the session, advances the epoch, and sets that allowance to zero. `withdraw` is owner-only and only works while inactive; it transfers the fixed token back to the fixed owner. There is no generic call/execute path, arbitrary-token approval, ownership transfer, or session-key policy mutation.

## Important scope note

The aggregate cap depends on the canonical WIF ERC-20 decrementing allowance after each successful Permit2 transfer. The validator checks live allowance before each signature validation; it does not reserve concurrent validations. A local Ganache test exercises state transitions, but this prototype has not been production-audited or verified through a real Robinhood Permit2/facilitator settlement.

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

The stateful test starts transient Ganache on localhost with throwaway test keys and a test-only ERC-20. It checks owner `arm`, epoch-bound signature acceptance, wrong amount/spender/epoch rejection, `uint256.max` allowance rejection, non-owner revoke rejection, finite mock allowance decrement, owner revoke/reset, and invalidation of an unused signature after re-arm. It is local simulated-chain coverage only—not proof of a real Permit2 deployment, facilitator, Robinhood RPC, or production security. An independent audit remains required.
