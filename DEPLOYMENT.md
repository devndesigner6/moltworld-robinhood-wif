# Production deployment guide

## Current public architecture

This repository powers the WIF deployment. The public site and API are served at `https://motoworld-wif.vercel.app`; Vercel proxies API and site requests to the Hono/Node service at `https://motoworld-wif.onrender.com`. Render holds the database connection and provider/receipt secrets. Vercel does not need the database URL or provider key.

The live Robinhood Chain checkout is **chat-only**. One user-authorized WIF mainnet payment has been confirmed with its returned AI response and signed receipt. The user connected and signed from their own wallet; the gateway never holds a wallet key. Autonomous mandates, marketplace listings and creator payouts, image/speech/video calls, and automatic WIF refunds are not live.

The WIF documentation is hosted at [algorand-54fd52b3.mintlify.app](https://algorand-54fd52b3.mintlify.app). This generated Mintlify hostname is account-provisioned; the legacy `docs.moltworld.xyz` host is a separate deployment and is not changed by this guide.

## Public chain settings

- Chain: Robinhood Chain mainnet, chain ID `4663`, CAIP-2 `eip155:4663`.
- WIF ERC-20: `0x5173b8eA6923c2d40267890D45C46a3480954773` (18 decimals).
- Merchant `payTo`: `0xdfF3eC4B06e39BCE04Ece791D2372C03b8AAC78a`.
- The token contract identifies the asset; `payTo` identifies the receiving wallet. Never interchange them.
- Default x402 facilitator: `https://x402.primer.systems`; production startup checks the configured Robinhood exact/Permit2 flow.
- Live WIF/USD pricing reads the exact Uniswap v4 pool through StateView and combines it with Chainlink's on-chain ETH/USD feed. Chain ID, latest-block freshness, oracle heartbeat, and active liquidity are checked. RPC/oracle failures fail closed; no hard-coded price fallback is used.

## Secrets and managed services

Set production secrets only in Render's environment settings or a secure secret manager. Never commit them or send wallet keys in chat.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Render PostgreSQL internal URL for durable request and receipt records. |
| `RECEIPT_SIGNING_KEY` | Persistent base64 Ed25519 seed used to sign public receipts. |
| `OPENROUTER_API_KEY` or `OPENAI_API_KEY` | Real model provider credential for enabled chat models. |
| `ADMIN_TOKEN` | Strong bearer token only if operator endpoints are needed. |
| `REDIS_URL` | Recommended before running multiple app instances so replay locks and reservations are shared. |
| `FACILITATOR_URL` | Optional override for the documented Primer facilitator. |

Set the public values `PAYMENT_CHAIN=robinhood`, `ROBINHOOD_NETWORK=mainnet`, `EVM_ADDRESS`, `WIF_TOKEN_ADDRESS`, `WIF_POOL_ID`, `PUBLIC_DOMAIN`, and `DOCS_URL` as shown in [`.env.example`](.env.example). Keep `MOCK_PROVIDERS=false` and `SKIP_UPSTREAM_VERIFICATION=false`. Do not add a merchant private key to the backend; the server only needs the public recipient address.

## Build and verify

- Build: `node_modules/.bin/tsx scripts/build-vendor.ts && node_modules/.bin/tsc && node_modules/.bin/tsc -p sdk/js/tsconfig.json --noEmit`
- Start: `node dist/server.js`
- Health: `GET /health`
- Free quote: `POST /v1/quote`
- Paid chat: `POST /v1/models/{model}/chat/completions`
- Public API/docs base: `https://motoworld-wif.vercel.app`

For Render, build dependencies must include the development dependencies needed for the asset build and TypeScript compilation. Use one instance initially. If running more than one instance, provision Redis as well as PostgreSQL. Confirm plan and cost in Render before provisioning paid resources.

## Availability on Render Free

The current Render Free web service can spin down when idle, so the first request after inactivity may be slow while it wakes. A scheduled self-ping is not a reliable way to make a Free service continuously available and no keep-alive cron is configured. For predictable always-on availability, use a paid always-on web-service plan and review Render's current [Free instance limits](https://render.com/docs/free) and [pricing](https://render.com/pricing).

## Not enabled on the WIF rail

- Image, speech, and video model payments.
- EIP-1271 spending mandates. The contract and signer in the repository are an experimental prototype, undeployed and unaudited, with no owner setup/revoke flow or real facilitator validation.
- Marketplace listing, creator earnings reconciliation, and WIF payouts. The routes are disabled; the staged ledger/credit code is not escrow or an automated payout service.
- Automatic WIF refunds or rebates. A rare post-settlement error requires manual review.
- Autonomous payment from the remote MCP server. It is keyless and relays only caller-signed chat requests.
