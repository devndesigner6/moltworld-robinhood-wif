# Deploying Moltworld

One origin serves `moltworld.xyz`: a VPS running Nginx, the Node 22 gateway (systemd),
and native PostgreSQL 16 (apt). Cloudflare provides DNS and TLS. The Cloudflare Worker
bound to the zone is a pass-through to the origin (see `src/worker.ts`); it can be deleted.

## First install

```bash
ssh root@<vps>
git clone https://github.com/hackcat29/moltworld-x402.git /opt/moltworld
bash /opt/moltworld/deploy/contabo-setup.sh
```

The script is idempotent. It installs Node 22, pnpm, native PostgreSQL and Nginx, generates any missing
secrets in `/opt/moltworld/.env` (`POSTGRES_PASSWORD`, `RECEIPT_SIGNING_KEY`, `ADMIN_TOKEN`, `DATABASE_URL`),
configures the PostgreSQL database, builds, installs the systemd unit and configures Nginx. Then set in `.env`:

- `ALGORAND_NETWORK=mainnet` and `AVM_ADDRESS` (revenue address; the gateway never needs its key)
- provider keys: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`
- `PAYOUT_WALLET_MNEMONIC` for refunds, rebates and creator payouts

and `systemctl restart moltworld`. On mainnet the gateway refuses to start without
`DATABASE_URL` and `RECEIPT_SIGNING_KEY`, and with mock providers enabled.

## Upgrading an existing VPS to this version

The ledger moved to PostgreSQL and receipts need a persistent key. Either run the setup script:

```bash
cd /opt/moltworld && git pull && bash deploy/contabo-setup.sh
```

or let the GitHub Actions CI workflow auto-provision native PostgreSQL and missing credentials on push to `main`.

## Cloudflare

- DNS: `A @` and `A www` to the VPS, proxied.
- SSL/TLS: Full (strict) with a Cloudflare Origin CA certificate at
  `/etc/ssl/certs/moltworld.pem` and `/etc/ssl/private/moltworld.key`.
- Worker route: deployed by CI as a pass-through. To remove it, delete the route under
  Workers Routes and run `pnpm wrangler delete`, then drop the `edge` job from CI.

## CI/CD

`.github/workflows/ci.yml` runs on every push and PR: typecheck, unit and e2e tests (PGlite),
payment e2e on PostgreSQL 16, Python interop, and the Playwright UI suite. On `main` it then
deploys the origin over SSH (secrets `CONTABO_HOST`, `CONTABO_USER`, `CONTABO_SSH_KEY`,
`CONTABO_PORT`), redeploys the pass-through Worker (`CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`), and verifies the public endpoint: healthy, PostgreSQL ledger,
persistent receipt key, no mock providers, a live 402 challenge, A2A and MCP.
