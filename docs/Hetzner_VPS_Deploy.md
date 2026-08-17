# Hetzner VPS — always-on Node API (cheapest solid 24×7)

Frontend stays on **Cloudflare Pages**.  
This box runs **only the Express API + momentum poll + Expo pushes**.

```
[Users' phones] ← Expo push ← [Hetzner Node 24×7]
                                      ↑
[Cloudflare Pages UI] ──fetch──→ VITE_API_BASE_URL
```

If this VPS is down → **no new momentum notifications**.

---

## 0) Create the server (Hetzner Cloud Console)

1. https://console.hetzner.cloud → **New project** (or existing)
2. **Add Server**
   - Location: closest to you (e.g. Falkenstein / Nuremberg / Ashburn)
   - Image: **Ubuntu 24.04**
   - Type: **CX22** (or cheapest shared) — enough for this API
   - SSH key: add your public key (`~/.ssh/id_ed25519.pub`)
3. Create → note **IPv4** (example: `49.13.x.x`)

Cost: typically **~€3–5 / month**.

---

## 1) First SSH + base install

From your Mac:

```bash
ssh root@YOUR_SERVER_IP
```

On the server:

```bash
# paste repo script or run commands from deploy/hetzner/setup-server.sh
curl -fsSL https://raw.githubusercontent.com/shubh996/dashboard_for_newslabs/main/deploy/hetzner/setup-server.sh | bash
```

Or clone first then:

```bash
git clone https://github.com/shubh996/dashboard_for_newslabs.git
cd dashboard_for_newslabs
bash deploy/hetzner/setup-server.sh
```

---

## 2) App + secrets

```bash
cd /root/dashboard_for_newslabs   # or wherever you cloned
npm ci --omit=dev
mkdir -p logs data
cp .env.example .env.local
nano .env.local
```

### Required in `.env.local` (minimum for Trigger momentum)

```env
API_PORT=3001
API_HOST=0.0.0.0
NODE_ENV=production

# Browser origins allowed (your Cloudflare Pages URL + custom domain)
CORS_ORIGINS=https://dashboard-for-newslabs.pages.dev

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
# optional if service role not used everywhere:
# SUPABASE_ANON_KEY=...

PERPLEXITY_API_KEY=...
GEMINI_API_KEY=...
EXPO_ACCESS_TOKEN=...   # if Expo push security enabled

CRON_SECRET=...         # same as Supabase edge market-close job
```

Copy other keys from your local `.env.local` as needed (Firecrawl, etc.).

```bash
chmod 600 .env.local
```

---

## 3) Start with PM2 (survives reboot)

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
# run the command PM2 prints (sudo env PATH=...)
```

Check:

```bash
pm2 status
pm2 logs dashboard-api --lines 50
curl -s http://127.0.0.1:3001/api/health
```

From your Mac (firewall must allow 3001):

```bash
curl -s http://YOUR_SERVER_IP:3001/api/health
```

Should return `{"ok":true,...}`.

---

## 4) Cloudflare Pages → point UI at this API

**Cloudflare Dashboard** → Pages → `dashboard-for-newslabs` → **Settings** → **Environment variables** (Production):

| Name | Value |
|------|--------|
| `VITE_API_BASE_URL` | `http://YOUR_SERVER_IP:3001` **or** `https://api.yourdomain.com` |

Also set (if not already) any `VITE_SUPABASE_*` the UI needs.

Then **Redeploy** Pages (Vite bakes `VITE_*` at build time).

> Prefer HTTPS + domain later (see nginx example). Browsers may warn on mixed content if Pages is `https://` and API is plain `http://IP`.  
> **Best:** put nginx + Let's Encrypt on the VPS (`deploy/hetzner/nginx-api.conf.example`) and use `https://api.…`.

---

## 5) Redeploy after git push

On the VPS:

```bash
cd /root/dashboard_for_newslabs
bash deploy/hetzner/deploy.sh
```

Or:

```bash
git pull && npm ci --omit=dev && pm2 restart dashboard-api
```

---

## 6) Optional: HTTPS with nginx

```bash
apt install -y nginx certbot python3-certbot-nginx
# DNS A record: api.yourdomain.com → YOUR_SERVER_IP
cp deploy/hetzner/nginx-api.conf.example /etc/nginx/sites-available/api
# edit server_name
ln -sf /etc/nginx/sites-available/api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
ufw allow 80/tcp && ufw allow 443/tcp
certbot --nginx -d api.yourdomain.com
```

Then:

```env
VITE_API_BASE_URL=https://api.yourdomain.com
CORS_ORIGINS=https://dashboard-for-newslabs.pages.dev,https://yourdomain.com
```

Redeploy Pages.

---

## 7) Market-close cron (Supabase)

If you use `market-close-run` Edge Function, set:

```text
MARKET_CLOSE_API_URL=https://api.yourdomain.com/api/notifications/jobs/market-close
CRON_SECRET=<same as .env.local>
```

Laptop-local URLs will **not** work for production cron.

---

## Checklist

- [ ] VPS Ubuntu + Node 22 + PM2
- [ ] `.env.local` with Supabase + push + CORS_ORIGINS
- [ ] `curl /api/health` OK from outside
- [ ] `pm2 startup` so reboot restarts API
- [ ] Cloudflare `VITE_API_BASE_URL` set + **redeploy**
- [ ] Open Momentum Studio on Pages → console me 405 nahi, API calls API host pe

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Pages still 405 on `/api/momentum` | `VITE_API_BASE_URL` missing or Pages not rebuilt |
| CORS error in browser | Add Pages origin to `CORS_ORIGINS`, restart PM2 |
| `curl IP:3001` timeout | Hetzner firewall / `ufw allow 3001` |
| Process dies after SSH logout | Use PM2, not raw `node server/index.js` |
| No pushes | Check Expo token, Supabase service role, `pm2 logs` |
