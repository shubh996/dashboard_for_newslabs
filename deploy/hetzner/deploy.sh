#!/usr/bin/env bash
# Run on the VPS inside the repo to pull + restart API.
# Usage: bash deploy/hetzner/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> Pull"
git fetch origin
BRANCH="${DEPLOY_BRANCH:-main}"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Install deps (prod)"
npm ci --omit=dev

echo "==> Ensure data/logs"
mkdir -p logs data

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found — run: npm i -g pm2"
  exit 1
fi

echo "==> Restart API"
if pm2 describe dashboard-api >/dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

echo "==> Health"
sleep 2
curl -fsS "http://127.0.0.1:${API_PORT:-3001}/api/health" || {
  echo "Health check failed — see: pm2 logs dashboard-api"
  exit 1
}
echo ""
echo "Deploy OK."
