#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Moltworld x402 Gateway: VPS provisioning (Ubuntu 22.04+ / Debian 12+)
# Cloudflare (DNS + TLS) -> Nginx -> Node 22 gateway (systemd) -> PostgreSQL (native)
# Safe to re-run: existing secrets in .env are kept.
# ==============================================================================

APP_DIR="/opt/moltworld"
REPO_URL="https://github.com/hackcat29/moltworld-x402.git"
ENV_FILE="$APP_DIR/.env"

log() { echo -e "\033[0;32m==> $*\033[0m"; }
warn() { echo -e "\033[1;33m!!  $*\033[0m"; }

if [ "$EUID" -ne 0 ]; then
  echo "Run as root (or via sudo)." >&2
  exit 1
fi

# Stop any legacy docker containers if docker is installed/running
if command -v docker >/dev/null 2>&1; then
  docker stop moltworld-postgres moltworld-redis 2>/dev/null || true
  docker rm moltworld-postgres moltworld-redis 2>/dev/null || true
fi

log "Installing system packages (native PostgreSQL)"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl git ufw nginx jq openssl ca-certificates postgresql postgresql-contrib
systemctl enable --now postgresql

run_pg() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- psql "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u postgres psql "$@"
  else
    su -s /bin/bash postgres -c "psql $(printf '%q ' "$@")"
  fi
}

log "Installing Node.js 22 and pnpm"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@10 --activate

log "Firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "Fetching the application into $APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin main && git -C "$APP_DIR" reset --hard origin/main
fi
cd "$APP_DIR"

log "Preparing $ENV_FILE"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"
chmod 600 "$ENV_FILE"
get_env() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
set_env() {
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
ensure_secret() {
  local name="$1" value="$2"
  if [ -z "$(get_env "$name")" ]; then set_env "$name" "$value"; echo "   generated $name"; fi
}

# Reuse the password of an existing database URL so an initialised db keeps working.
existing_db_pw="$(get_env DATABASE_URL | sed -nE 's|^postgres(ql)?://[^:]+:([^@]+)@.*|\2|p')"
ensure_secret POSTGRES_PASSWORD "${existing_db_pw:-$(openssl rand -hex 24)}"
ensure_secret RECEIPT_SIGNING_KEY "$(openssl rand -base64 32)"
ensure_secret ADMIN_TOKEN "$(openssl rand -hex 32)"
ensure_secret DATABASE_URL "postgres://moltworld:$(get_env POSTGRES_PASSWORD)@127.0.0.1:5432/moltworld"

# Mainnet spend counter for capped mandates (public app id, see ops/OPERATIONS.md). Kept if already set.
if [ "$(get_env ALGORAND_NETWORK)" = "mainnet" ] && [ -z "$(get_env MANDATE_COUNTER_APP_ID)" ]; then
  set_env MANDATE_COUNTER_APP_ID 3755263517; echo "   set MANDATE_COUNTER_APP_ID"
fi

log "Configuring native PostgreSQL database and user"
systemctl enable --now postgresql
for i in $(seq 1 15); do
  if run_pg -c "SELECT 1" >/dev/null 2>&1; then break; fi
  sleep 1
done

PG_PASSWORD="$(get_env POSTGRES_PASSWORD)"
run_pg -c "DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'moltworld') THEN
    CREATE ROLE moltworld WITH LOGIN PASSWORD '$PG_PASSWORD';
  ELSE
    ALTER ROLE moltworld WITH PASSWORD '$PG_PASSWORD';
  END IF;
END
\$\$;"

run_pg -tc "SELECT 1 FROM pg_database WHERE datname = 'moltworld'" | grep -q 1 || \
  run_pg -c "CREATE DATABASE moltworld OWNER moltworld;"
run_pg -c "GRANT ALL PRIVILEGES ON DATABASE moltworld TO moltworld;"

log "Building"
pnpm install --frozen-lockfile
pnpm build

log "Installing the systemd unit"
cp deploy/moltworld.service /etc/systemd/system/moltworld.service
systemctl daemon-reload
systemctl enable moltworld

log "Nginx and SSL"
mkdir -p /var/www/html /etc/nginx/ssl
cp deploy/nginx-moltworld.conf /etc/nginx/sites-available/moltworld

# Remove conflicting older moltworld/default configs in sites-enabled without wiping other hosted projects
rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/moltworld.conf
ln -sf /etc/nginx/sites-available/moltworld /etc/nginx/sites-enabled/moltworld

# If a Let's Encrypt certificate exists, use it
if [ -f /etc/letsencrypt/live/moltworld.xyz/fullchain.pem ]; then
  ln -sf /etc/letsencrypt/live/moltworld.xyz/fullchain.pem /etc/nginx/ssl/moltworld.crt
  ln -sf /etc/letsencrypt/live/moltworld.xyz/privkey.pem /etc/nginx/ssl/moltworld.key
# Generate temporary self-signed certificate if no certificate exists yet
elif [ ! -f /etc/nginx/ssl/moltworld.crt ]; then
  warn "Generating temporary certificate in /etc/nginx/ssl/."
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/moltworld.key -out /etc/nginx/ssl/moltworld.crt -subj "/CN=moltworld.xyz"
fi
nginx -t && systemctl reload nginx

# Attempt to obtain a real Let's Encrypt certificate via Certbot (HTTP-01 challenge over port 80)
if ! openssl x509 -in /etc/nginx/ssl/moltworld.crt -noout -issuer 2>/dev/null | grep -qi "Let's Encrypt\|Cloudflare"; then
  log "Attempting to issue trusted Let's Encrypt certificate via Certbot..."
  apt-get install -y certbot || true
  if certbot certonly --webroot -w /var/www/html -d moltworld.xyz -d www.moltworld.xyz --non-interactive --agree-tos --register-unsafely-without-email 2>/dev/null; then
    ln -sf /etc/letsencrypt/live/moltworld.xyz/fullchain.pem /etc/nginx/ssl/moltworld.crt
    ln -sf /etc/letsencrypt/live/moltworld.xyz/privkey.pem /etc/nginx/ssl/moltworld.key
    log "Installed trusted Let's Encrypt SSL certificate."
    nginx -t && systemctl reload nginx
  else
    warn "Certbot automated issuance not available; keeping existing certificate."
    warn "Note: If Cloudflare reports Error 526, either set Cloudflare SSL/TLS to 'Full' (instead of 'Strict')"
    warn "or install a Cloudflare Origin CA certificate into /etc/nginx/ssl/moltworld.crt."
  fi
fi

missing=()
for key in AVM_ADDRESS OPENROUTER_API_KEY; do [ -n "$(get_env $key)" ] || missing+=("$key"); done
if [ "$(get_env ALGORAND_NETWORK)" = "mainnet" ] && [ ${#missing[@]} -gt 0 ]; then
  warn "Set ${missing[*]} in $ENV_FILE, then: systemctl restart moltworld"
else
  log "Restarting Moltworld gateway"
  systemctl restart moltworld
  log "Waiting for gateway to report healthy..."
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3402/health 2>/dev/null | grep -q '"ready":true'; then
      echo "Gateway healthy and serving requests on port 3402!"
      curl -fsS http://127.0.0.1:3402/health | jq '{status, ready, network, ledger, enabled_models, receipts}' || true
      exit 0
    fi
    sleep 2
  done
  warn "Gateway did not become healthy:"
  curl -s http://127.0.0.1:3402/health || true
  journalctl -u moltworld -n 60 --no-pager
  exit 1
fi

cat <<EOF

Provisioned without Docker. Next:
  1. Edit $ENV_FILE: AVM_ADDRESS (revenue; can be cold/multisig), provider keys
     (OPENROUTER_API_KEY, FAL_KEY, OPENAI_API_KEY, ELEVENLABS_API_KEY) and
     PAYOUT_WALLET_MNEMONIC (hot wallet for refunds/rebates/creator payouts).
  2. systemctl restart moltworld && curl -s localhost:3402/health | jq
  3. Back up RECEIPT_SIGNING_KEY offline: losing it makes past receipts unverifiable
     (rotate with RECEIPT_PREVIOUS_PUBLIC_KEYS, see ops/OPERATIONS.md).
EOF
