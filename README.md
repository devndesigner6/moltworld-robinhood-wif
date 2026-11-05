# Moltworld — Robinhood Chain / WIF migration

Moltworld is an x402 pay-per-request gateway for AI services. This repository is the migration worktree for settling eligible requests in **WIF (World Is Flat)** on **Robinhood Chain** instead of USDC on Algorand.

> **Migration status:** Robinhood WIF checkout is chat-only. The TypeScript SDK, Python SDK, local MCP payer, and remote MCP relay support that WIF chat path. Algorand-specific mandates, creator marketplace/payouts, image/voice/video, and automatic WIF refunds are not migrated. A successful mainnet payment still requires a user wallet to approve any first-use allowance and sign a real payment.

## Payment addresses

These are different kinds of addresses and must not be interchanged:

| Setting | Value | Purpose |
| --- | --- | --- |
| WIF token contract (`WIF_TOKEN_ADDRESS`) | `0x5173b8eA6923c2d40267890D45C46a3480954773` | ERC-20 asset paid by users; 18 decimals |
| Merchant recipient (`EVM_ADDRESS`) | `0x0cbF84496640E7441eF743f8F03189Aa8C0B8cb6` | Your wallet; x402 settlements are sent here |

The backend only needs the public recipient address. **Never provide or commit its seed phrase or private key.** A user connects MetaMask or Robinhood Wallet and authorizes a WIF payment. First use may require an exact ERC-20 approval to Permit2; that separate approval transaction consumes native ETH for gas. The x402 payment itself is in WIF.

## Current payment flow

1. The gateway validates a chat request and computes its USD quote before issuing an x402 challenge.
2. A guarded live WIF/USD price snapshot is converted to an exact 18-decimal token amount using integer arithmetic. Stale, inactive, low-liquidity, invalid, or unavailable quotes fail closed.
3. The challenge names Robinhood Chain (`eip155:4663` on mainnet), the WIF ERC-20 contract, the receiving wallet, the exact raw amount, and Permit2 transfer metadata.
4. A connected wallet authorizes the x402 payment; the facilitator verifies and settles it to the configured recipient.
5. The gateway verifies that chain, token, recipient, and amount still match the quote; it records the payment and signs a receipt containing the exact token amount and the USD quote.

No automated WIF refund is implemented. Chat is configured to settle after successful work; a rare failure after an already-confirmed settlement is marked for manual review rather than invoking the legacy Algorand-USDC refund worker.

## Run and verify locally

Requirements: Node.js 20+, pnpm, and the project dependencies.

```bash
cp .env.example .env
# Add real development credentials only in your local .env; never commit it.
pnpm install --frozen-lockfile
node_modules/.bin/tsc --noEmit -p tsconfig.json
node_modules/.bin/tsc -p sdk/js/tsconfig.json --noEmit
node_modules/.bin/tsc -p web/tsconfig.json
node_modules/.bin/vitest run
node_modules/.bin/tsx scripts/build-vendor.ts
```

The automated tests use deterministic test fixtures and do not broadcast a blockchain payment. The WIF price adapter used by the running application uses live pool data and fails closed; the code does not create simulated production settlements.

## Public deployment

The public website and API origin is [motoworld-wif.vercel.app](https://motoworld-wif.vercel.app). Vercel proxies requests to the Render Hono service at `https://motoworld-wif.onrender.com`; Render holds the database connection and provider/receipt secrets. Set Render `PUBLIC_DOMAIN=https://motoworld-wif.vercel.app` so x402 challenges and canonical links use the public origin. Vercel does not need the database URL or provider key.

See [`.env.example`](.env.example) for the service settings. Production requires `NODE_ENV=production`, `PAYMENT_CHAIN=robinhood`, `ROBINHOOD_NETWORK=mainnet`, the public `EVM_ADDRESS`, WIF contract, a real OpenAI or OpenRouter key, PostgreSQL, a receipt signing seed, and `MOCK_PROVIDERS=false` / `SKIP_UPSTREAM_VERIFICATION=false`. Keep secrets in Render, not Git. The Render free service can sleep when idle; its first request may take time to wake.

## Scope not yet migrated

- WIF settlement/refunds for image, voice, and video calls.
- Creator marketplace listing signatures, royalty accounting, and WIF payouts.
- Algorand mandate/LogicSig replacement with an EVM-compatible delegation model.
- A real mainnet wallet payment and settlement/receipt check. The current validation has not signed or broadcast a user payment.

The code deliberately blocks these legacy-only payment actions on the Robinhood rail rather than silently routing them through Algorand.

## Source and license

This public [migration repository](https://github.com/devndesigner6/moltworld-robinhood-wif) is based on the MIT-licensed [`hackcat29/moltworld-x402`](https://github.com/hackcat29/moltworld-x402) codebase. The original license is retained in [`LICENSE`](LICENSE); the new repository has its own history and is not a fork.
