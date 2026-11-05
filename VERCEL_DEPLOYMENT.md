# Vercel deployment notes

This project uses the Hono entrypoint at `src/index.ts`. The site routes render without database or provider credentials. Vercel API routes remain disabled and return HTTP 503 until `ENABLE_LIVE_PAYMENTS=true` and the mainnet configuration passes the existing fail-closed production checks.

The Vercel Hobby deployment is for a non-commercial preview only. Do not enable paid WIF requests on Hobby. The migration currently supports the Robinhood WIF chat-payment slice; legacy mandates, marketplace payouts, and automatic refunds remain disabled until ported and verified.

The Render database connection URL contains a password. Never add it to Git, `vercel.json`, `.env.example`, client-side JavaScript, or commit history. For a Vercel-hosted backend, get the **External Database URL** from the Render database page's **Connect** menu and set it as an encrypted `DATABASE_URL` environment variable in Vercel. If the backend is hosted on Render in the same region, use the **Internal Database URL** in that Render service instead. Render recommends the internal URL wherever possible.

Set `OPENAI_API_KEY` as an encrypted server environment variable, not in source control. Add the public Vercel URL as `PUBLIC_DOMAIN` only if overriding the runtime `VERCEL_URL` fallback is needed. After changing environment variables, redeploy so the function sees the new configuration.
