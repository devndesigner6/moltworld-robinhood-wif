# Production deployment checklist

## Target architecture

This codebase is a single Hono/Node service: the same process serves the website and Playground, the x402 API, request ledger hooks, and receipts. For the current layout, deploy one web service on **Render**. Vercel is not needed unless the frontend is split into a separate deployable application.

Keep the original Algorand site running until the new Robinhood deployment has passed the live readiness checks and you explicitly approve the cutover. No deployment or production transaction should be used as a substitute for this checklist.

## Public chain settings

- Chain: Robinhood Chain mainnet, chain ID `4663`, CAIP-2 `eip155:4663`.
- WIF ERC-20: `0x5173b8eA6923c2d40267890D45C46a3480954773` (18 decimals).
- Merchant `payTo`: `0x0cbF84496640E7441eF743f8F03189Aa8C0B8cb6`.
- The WIF contract address identifies the asset; `payTo` identifies your receiving wallet. The receiving address was found on Robinhood Chain Blockscout as a non-contract account. These values must never be swapped.
- Default x402 facilitator: `https://x402.primer.systems`; production startup must verify that its supported-network response includes Robinhood Chain and the configured exact/Permit2 flow.
- Live price source: the project-linked Robinhood WIF/ETH pool through DexScreener. It is off-chain market data, not an oracle. Low-liquidity, stale, inactive, or malformed responses are rejected.

## Secrets and managed services required

Add the following only in Render's environment settings or secure secret store; do not commit them or send wallet secrets in chat:

| Variable | What to provide |
| --- | --- |
| `DATABASE_URL` | Render PostgreSQL internal connection URL; production receipts and payment records require durable PostgreSQL. |
| `RECEIPT_SIGNING_KEY` | A generated base64 32-byte Ed25519 seed. Generate a new secret specifically for this deployment and preserve it for receipt verification. |
| `OPENAI_API_KEY` or `OPENROUTER_API_KEY` | A real provider credential with at least one supported chat model. |
| `ADMIN_TOKEN` | A strong random bearer token if operator endpoints are needed; otherwise leave unset. |
| `REDIS_URL` | Recommended before scaling beyond one app instance, because replay locks and concurrent spend reservations are shared through Redis. |
| `FACILITATOR_URL` | Optional override if not using the documented Primer facilitator. |

Set the public values `PAYMENT_CHAIN=robinhood`, `ROBINHOOD_NETWORK=mainnet`, `EVM_ADDRESS`, and `WIF_TOKEN_ADDRESS` exactly as in `.env.example`. Keep `MOCK_PROVIDERS=false` and `SKIP_UPSTREAM_VERIFICATION=false`. Configure `PUBLIC_DOMAIN` for the chosen new deployment hostname until the existing domain is intentionally moved.

## Build and run commands

- Build: `node_modules/.bin/tsx scripts/build-vendor.ts && node_modules/.bin/tsc && node_modules/.bin/tsc -p sdk/js/tsconfig.json --noEmit`
- Start: `node dist/server.js`
- Health check: `GET /health`
- API quote: `POST /v1/quote`
- x402 chat endpoint: `POST /v1/models/{model}/chat/completions`

For Render, build dependencies must include the development dependencies needed for the asset build and TypeScript compilation. Set one instance initially; provision PostgreSQL and, if running more than one instance, Redis. Confirm the actual Render plan/cost in the service creation flow before provisioning paid resources.

## Cutover blockers

Do not direct `moltworld.xyz` traffic or advertise mainnet checkout until all of the following pass:

1. Required secrets and persistent services are set.
2. Render build succeeds and `/health` is ready, with the app reporting Robinhood Chain mainnet and real providers.
3. Facilitator reports Robinhood Chain plus the WIF Permit2 scheme as supported.
4. The production WIF/USD source reports an acceptable current price and liquidity.
5. MetaMask/Robinhood Wallet connects to chain 4663, WIF balance is readable, and the first-use exact Permit2 approval is understandable (users need a small ETH gas balance for that approval).
6. A separately approved, low-value real transaction is observed on Blockscout, is paid in WIF to the configured `payTo`, is stored durably, and produces a valid signed receipt.
7. User-facing pages and support text clearly distinguish enabled chat from disabled legacy Algorand features.

No test fixture, local simulated settlement, or mock transaction satisfies item 6. The migration currently disables non-chat modalities, old mandate flows, marketplace payouts, and automatic WIF refunds; these must be implemented and tested before the full website can be described as migrated.
