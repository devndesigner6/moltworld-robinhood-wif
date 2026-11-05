# Vercel public URL and Render backend

`https://motoworld-wif.vercel.app` is the public Moltworld URL. Vercel external rewrites proxy requests to the Render service at `https://motoworld-wif.onrender.com`; the browser keeps the Vercel URL for pages, API calls, x402 challenges, and receipts. The fixed-origin Hono proxy in `src/index.ts` also forwards paths served by the function itself (including `/` and `/.well-known`) to Render, so the root does not show a separate preview UI. Function-proxied responses use `Cache-Control: no-store`.

The live gateway and all secrets stay in Render. Keep `DATABASE_URL`, `OPENROUTER_API_KEY`, any `OPENAI_API_KEY`, `RECEIPT_SIGNING_KEY`, and payment configuration out of Vercel and Git. Render's `PUBLIC_DOMAIN` must be set to `https://motoworld-wif.vercel.app`; this value binds generated x402 resource URLs and site metadata to the public origin. The Render service uses its private/internal Postgres URL.

Robinhood Chain WIF checkout is currently live for chat requests only. The browser wallet signs WIF Permit2 authorizations on chain `eip155:4663`; the backend does not hold payer keys. First use may need a caller-approved bounded WIF allowance to Permit2 and native ETH for that approval. The project does not claim Robinhood support for Algorand mandates, marketplace payouts, image/voice/video, or automatic WIF refunds until those paths are ported and verified.

The deployment test flow checks the public site, model catalog, quote and 402 challenge without signing a wallet payment. Do not use a mock settlement or claim a paid request works until a real wallet signs and the production facilitator returns a settlement transaction.

Vercel documents external rewrites as a reverse-proxy mechanism and describes path-capture syntax in its [rewrite guide](https://vercel.com/docs/routing/rewrites). The current Render origin is intentionally fixed in `vercel.json` and `src/index.ts` so this project cannot be used as an arbitrary proxy. If the Render service URL changes, update both fixed targets and Render's `PUBLIC_DOMAIN` configuration.
