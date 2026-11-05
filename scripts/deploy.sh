#!/usr/bin/env bash
# Manual deploy of the origin. CI does the same on every push to main.
#   DEPLOY_HOST=root@<vps-ip> bash scripts/deploy.sh
set -euo pipefail
: "${DEPLOY_HOST:?Set DEPLOY_HOST, e.g. root@203.0.113.10}"
pnpm build
pnpm test
ssh "$DEPLOY_HOST" 'set -e; cd /opt/moltworld && git fetch origin main && git reset --hard origin/main \
  && pnpm install --frozen-lockfile && pnpm build && systemctl restart moltworld \
  && sleep 3 && curl -fsS http://127.0.0.1:3402/health'
