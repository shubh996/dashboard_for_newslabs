#!/usr/bin/env bash
# Run ONCE on a fresh Hetzner Ubuntu 24.04 VPS as root (or with sudo).
# Usage:  curl -fsSL … | bash   OR   bash setup-server.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "==> System packages"
apt-get update -y
apt-get install -y ca-certificates curl git ufw build-essential

echo "==> Node.js 22 (NodeSource)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> PM2"
npm install -g pm2

echo "==> Firewall (SSH + API 3001; open 80/443 if you add nginx later)"
ufw allow OpenSSH
ufw allow 3001/tcp
# ufw allow 80/tcp
# ufw allow 443/tcp
ufw --force enable || true
ufw status

echo "==> App user (optional shared deploy user)"
if ! id -u deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy || true
fi

echo ""
echo "OK. Next steps as deploy user (or root):"
echo "  1) git clone https://github.com/shubh996/dashboard_for_newslabs.git"
echo "  2) cd dashboard_for_newslabs && npm ci --omit=dev"
echo "  3) nano .env.local   # paste production secrets"
echo "  4) mkdir -p logs data"
echo "  5) pm2 start ecosystem.config.cjs"
echo "  6) pm2 save && pm2 startup"
echo "  7) curl http://127.0.0.1:3001/api/health"
echo ""
