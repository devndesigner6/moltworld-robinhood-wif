# moltworld-sdk

x402 client for Moltworld's pay-per-request AI gateway. WIF payments use an EVM signer; the legacy AVM signer path remains for Algorand deployments. The live WIF model surface currently accepts chat calls only.

## WIF with an EVM wallet

Use a wallet client backed by an injected EIP-1193 provider or a WalletConnect session. Mobile WalletConnect requires the public Reown project ID to be configured on the deployment. Configure the wallet on Robinhood Chain mainnet (chain ID `4663`) and read the WIF contract and receiving address from `/health`.

```ts
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { toClientEvmSigner } from "@x402/evm";
import { MoltworldClient } from "moltworld-sdk";

const provider = window.ethereum;
const [address] = await provider.request({ method: "eth_requestAccounts" });
const chain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
};
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account: address, chain, transport: custom(provider) });
const evmSigner = toClientEvmSigner({
  address,
  signTypedData: (data) => walletClient.signTypedData({ ...data, account: address }),
}, publicClient);

const client = new MoltworldClient({
  baseUrl: "https://motoworld-wif.vercel.app",
  evmSigner,
  maxPerRequestUsd: 0.25,
  budgetUsd: 5,
});
const result = await client.chat("gpt-4o", {
  messages: [{ role: "user", content: "Hi" }],
  max_tokens: 300,
});
console.log(result.data.choices[0].message.content);
console.log(result.receipt?.amountAtomic, result.receipt?.assetSymbol); // exact WIF base units
console.log(result.verification?.ok); // signed receipt + request/response hashes checked
```

For tokens without a usable Permit2 allowance, clients must arrange a WIF approval to the Permit2 contract before x402 payment creation. The Playground requests an exact allowance, not an unlimited one; that separate approval transaction requires a small amount of native ETH for gas. The x402 request itself is denominated in WIF. Never pass a wallet private key or seed phrase to Moltworld.

`paidMicro` in SDK results remains the USD quote value for spend-budget accounting; `receipt.amountAtomic` is the exact ERC-20 amount in base units and must not be converted through JavaScript `Number`.

## Experimental WIF agent mandate

The SDK exports `createWifEvmMandateSigner` and `createWifMandateClientSigner` for the repository's prototype EIP-1271 policy wallet. The session key signs only an exact Permit2 payment whose chain, WIF token, x402 proxy, pay-to, amount and deadline pass local checks; the on-chain contract independently rechecks them. A local Ganache test covers stateful arm/signature/revoke behavior, but it does not test a real Permit2 deployment, facilitator, or Robinhood transaction. This is not a live Moltworld feature: no mandate contract is deployed by the service, no website setup wizard exists, and there is no independent audit. Do not fund it with valuable balances. See [`contracts/README.md`](../../contracts/README.md) and [`docs/agents/mcp.mdx`](../../docs/agents/mcp.mdx) for the current scope.

## Legacy Algorand signer

Algorand-specific helpers (`mnemonic`, `privateKeyBase64`, AVM signers, and spending mandates) remain for legacy deployments only. The Robinhood WIF gateway disables mandate endpoints and does not accept AVM payment payloads. No Algorand LogicSig or application ID can be reused on Robinhood Chain.

The Python SDK also supports WIF calls using a dedicated local EOA, but that path is local-development-only: its process budgets are not an on-chain mandate. Never give it a user's master wallet key. Python marketplace calls are guarded but the live WIF marketplace remains disabled; the EIP-1271 mandate prototype currently applies only to the JavaScript x402 client/MCP path, and creator payout verification is not implemented.
