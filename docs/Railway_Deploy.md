# Railway — always-on Node API (easiest 24×7)

Frontend stays on **Cloudflare Pages**.  
Railway runs **Express + momentum poll + Expo pushes**.

```
[Phones] ← Expo ← [Railway Node 24×7]
                        ↑
[Cloudflare Pages] ── VITE_API_BASE_URL ──┘
```

---

## 0) Pricing note (what you see on Free plan)

Railway **Free** plan (screenshot):

- 30-day trial with **$5 credits**, then **~$1 / month** plan fee  
- Up to **1 vCPU / 0.5 GB RAM** per service  
- **0.5 GB** volume  

Usage (CPU/RAM time) can burn the $5 credit; after that you need a card / paid usage.  
**0.5 GB RAM is tight** for this app — if it OOMs, upgrade RAM or Hobby.

This is still the **easiest** always-on path (no SSH).

---

## 1) Deploy from GitHub

1. Open https://railway.app → login (GitHub)
2. **Deploy a new project**
3. **Deploy from GitHub repo**
4. Select **`shubh996/dashboard_for_newslabs`**
5. Branch: **`main`**
6. Railway uses the **Dockerfile** (`railway.toml` → `builder = "DOCKERFILE"`).

If it asks for root directory → leave **empty** (repo root).

### Service settings (Railway → service → Settings)

| Setting | Value |
|---------|--------|
| **Builder** | Dockerfile (auto from `railway.toml`) |
| **Start Command** | leave default / `node server/index.js` |
| **Healthcheck path** | `/api/health` |

### If build failed with `npm ci` + `EBUSY … node_modules/.cache` (or Node `v22.11.0`)

That log is **Nixpacks**, not the Dockerfile. Signs:

- `RUN --mount=type=cache,...target=/app/node_modules/.cache`
- `current: { node: 'v22.11.0' }` (Dockerfile pins **22.14**)

**Fix in Railway UI:**

1. Service → **Settings → Build**
2. Set **Builder** to **Dockerfile** (must match `railway.toml`)
3. Clear any custom **Build Command** (do not set `npm ci` in the UI)
4. Confirm **Dockerfile path** = `Dockerfile`
5. Under **Config-as-code**, ensure Railway is reading `railway.toml` (not ignoring it)
6. Deployments → confirm you are redeploying commit **`c5dd5dd`** or newer on `main`  
   (an Aug 17 Nixpacks failure is the *old* attempt — Redeploy latest)
7. **Deploy** → **Redeploy**

You should then see build steps like `FROM node:22.14-bookworm-slim` and `NPM_CONFIG_CACHE=/tmp/npm-cache`, not a mount on `node_modules/.cache`.

Generate a public domain:

- **Settings → Networking → Generate Domain**  
- Example: `https://dashboard-for-newslabs-production.up.railway.app`

Copy that URL — this is your **API host**.

---

## 2) Environment variables (Railway → Variables)

Paste the same secrets as local `.env.local` (server-side only — **not** `VITE_*` except you don’t need VITE on Railway).

### Required

```env
NODE_ENV=production

# CORS: your Cloudflare Pages URL(s), comma-separated
CORS_ORIGINS=https://dashboard-for-newslabs.pages.dev

SUPABASE_URL=https://YOUR_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

PERPLEXITY_API_KEY=...
GEMINI_API_KEY=...
```

### Strongly recommended for Trigger / notifications

```env
EXPO_ACCESS_TOKEN=...
CRON_SECRET=...
FIRECRAWL_API_KEY=...
```

### Optional providers (if you use them)

```env
ALPHA_VANTAGE_API_KEY=...
POLYGON_API_KEY=...
NEWSAPI_API_KEY=...
GEMINI_MODEL=gemini-3.6-flash
PERPLEXITY_MODEL=perplexity/deepseek-v4-flash-0731
```

**Do not set** `PORT` manually — Railway injects it.  
Our server reads `PORT` first, then `API_PORT`.

After saving variables → Railway redeploys automatically.

---

## 3) Verify API is live

```bash
curl -s https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/health
```

Expect:

```json
{"ok":true,"service":"dashboard-api",...}
```

Logs: Railway → **Deployments → View logs**  
Look for: `News dashboard API listening` and `[MOMENTUM]`.

---

## 4) Point Cloudflare Pages at Railway

**Cloudflare** → Pages → your project → **Settings → Environment variables** (Production):

| Name | Value |
|------|--------|
| `VITE_API_BASE_URL` | `https://YOUR-RAILWAY-DOMAIN.up.railway.app` |

No trailing slash.

Then **Redeploy** Pages (Vite bakes env at build time).

Also keep:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

---

## 5) After each git push

If the Railway service is connected to GitHub `main`, every push **auto-deploys**.

Or: Railway → **Deploy** → Redeploy.

---

## 6) Market-close cron (optional)

Supabase Edge secret:

```text
MARKET_CLOSE_API_URL=https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/notifications/jobs/market-close
CRON_SECRET=<same as Railway CRON_SECRET>
```

---

## Checklist

- [ ] Railway service from GitHub `main`
- [ ] Variables set (Supabase, CORS_ORIGINS, keys)
- [ ] Public domain generated
- [ ] `curl …/api/health` → ok
- [ ] Cloudflare `VITE_API_BASE_URL` = Railway URL
- [ ] Pages **redeployed**
- [ ] Momentum Studio on Pages → no 405; Network tab shows Railway host

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails on `tsc` / vite | Use Dockerfile builder; do not run `npm run build` on Railway |
| `EBUSY rmdir node_modules/.cache` | Fixed via Dockerfile + `/tmp/npm-cache`; redeploy latest `main` |
| `EBADENGINE` Node 22.11 | Dockerfile pins **Node 22.14** |
| App crashes / OOM | Raise memory in Railway plan; 0.5 GB is tight |
| CORS error | Add exact Pages origin to `CORS_ORIGINS`, redeploy API |
| Pages still hits `pages.dev/api/...` 405 | `VITE_API_BASE_URL` missing or Pages not rebuilt |
| Sleep / no pushes | Service must stay **running** (not removed); check usage credits |
| Port errors | Don’t hardcode PORT; let Railway set it |

---

## What runs where

| Piece | Host |
|-------|------|
| UI (dashboard, studio) | Cloudflare Pages |
| API + momentum loop + push | **Railway** |
| Database | Supabase |
