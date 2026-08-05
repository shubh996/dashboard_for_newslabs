# Market-close job — exact setup (step by step)

## Pehle picture samajh lo (kya kya baat karta hai)

```
[pg_cron in Supabase]
   Mon–Fri 16:01 America/New_York
        │
        ▼ HTTP POST
[Edge Function: market-close-run]   ← thin proxy (Supabase pe live)
        │
        ▼ HTTP POST + CRON_SECRET
[Node API: /api/notifications/jobs/market-close]  ← asli kaam (scrape, Gemini, digest)
        │
        ▼
[Supabase tables]  usage + run logs
```

| Piece | Folder file | Kahan rehta hai |
|-------|-------------|-----------------|
| DB tables | `supabase/schema_usage_and_jobs.sql` | Supabase SQL Editor me paste |
| Edge Function | `supabase/functions/market-close-run/index.ts` | `supabase functions deploy` |
| Cron schedule | `supabase/cron_market_close.sql` | SQL Editor me (values fill karke) |
| Job logic | `server/notifications.js` | Tumhara Node API server |

**Important:** Cron / Edge Function **browser open hone pe depend nahi** karta. Node API **public URL** pe online hona chahiye (local-only laptop se production cron kaam nahi karega jab laptop band ho).

---

## STEP 0 — Values ready rakho

In cheezon ki values pehle note kar lo:

| Name | Kahan milta hai | Example |
|------|-----------------|---------|
| **PROJECT_REF** | Supabase Dashboard → Project Settings → General → Reference ID | `abcdefghijklmnop` |
| **SERVICE_ROLE_KEY** | Project Settings → API → `service_role` (secret) | `eyJhbGciOi...` |
| **CRON_SECRET** | Tum khud banao (random long string) | `openssl rand -hex 32` |
| **YOUR_API_HOST** | Jahan Node API production pe chalti hai | `https://api.yourdomain.com` ya Railway/Render URL |

Secret generate (Mac terminal):

```bash
openssl rand -hex 32
```

Output copy karke save karo — yehi **CRON_SECRET** hoga (Node + Edge dono pe same).

---

## STEP 1 — Database tables (SQL paste)

### File
Project me ye file hai:

`/Users/shubh./Desktop/dashboard_for_newslabs/supabase/schema_usage_and_jobs.sql`

### Exactly kya karna hai

1. File **Finder** se open karo, ya VS Code / Cursor me open karke **poori file select → Copy**  
   (`Cmd+A` → `Cmd+C`)
2. Browser me **Supabase Dashboard** kholo → apna project  
3. Left sidebar → **SQL Editor**  
4. **New query**  
5. **Paste** (`Cmd+V`)  
6. **Run** (bottom right / Ctrl+Enter)

### Success kya dikhega
- “Success. No rows returned” jaisa message  
- Tables ban jayengi:
  - `usage_daily_ledger`
  - `market_close_runs`
  - `market_close_run_tickers`

Check: left → **Table Editor** me ye tables dikhni chahiye.

### Is step se kya milta hai
- Firecrawl daily credits log  
- Market-close job history  
- Gemini popup ke liye ledger support (Gemini spend dates se bhi derive hota hai)

---

## STEP 2 — Node API env (local + production)

### File
`.env.local` project root me (local). Production pe bhi same keys env panel me.

### Exactly kya karna hai

1. Project root open karo:  
   `/Users/shubh./Desktop/dashboard_for_newslabs/`
2. `.env.local` open karo (agar nahi hai to `.env.example` se copy banao)
3. Ye lines add / fill karo:

```bash
CRON_SECRET=yahan_step0_wala_secret_paste_karo
MARKET_CLOSE_JOB_ENABLED=1
```

4. API restart:
   ```bash
   # project folder me
   npm run dev
   # ya jo bhi tum production me API chalate ho — redeploy / restart
   ```

### Local test (optional, pehle dry run)

API local chal rahi ho (`http://localhost:3001`):

```bash
export CRON_SECRET='yahan_same_secret'

curl -X POST "http://localhost:3001/api/notifications/jobs/market-close?dry_run=1" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json"
```

- `dry_run=1` → full pipeline **bina** real digest send / heavy writes ke design ke hisaab se safe-ish test  
- Response me `ok: true` / `run_id` / status dekhna

### Production API URL

Jahan API public host hai, wahan bhi same env set karo, phir:

```bash
curl -X POST "https://YOUR_API_HOST/api/notifications/jobs/market-close?dry_run=1" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json"
```

**Real run (users ko digest jayega — carefully):**

```bash
curl -X POST "https://YOUR_API_HOST/api/notifications/jobs/market-close" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json"
```

---

## STEP 3 — Edge Function deploy + secrets

### File (already in repo)
```
supabase/functions/market-close-run/index.ts
```
Isko manually copy-paste Edge dashboard me **zaruri nahi** — CLI se deploy hota hai (folder structure se).

### Terminal me exactly

```bash
cd /Users/shubh./Desktop/dashboard_for_newslabs

# 1) Login (browser open hoga)
supabase login

# 2) Project link (PROJECT_REF = dashboard se Reference ID)
supabase link --project-ref YOUR_PROJECT_REF

# 3) Secrets — Edge Function ko Node API URL + same CRON_SECRET
supabase secrets set \
  MARKET_CLOSE_API_URL="https://YOUR_API_HOST/api/notifications/jobs/market-close" \
  CRON_SECRET="yahan_same_secret_jo_env_local_me_hai"

# 4) Deploy function
supabase functions deploy market-close-run
```

### Success
- Deploy output me function URL type:  
  `https://YOUR_PROJECT_REF.supabase.co/functions/v1/market-close-run`

### Edge Function test (optional)

```bash
curl -X POST \
  "https://YOUR_PROJECT_REF.supabase.co/functions/v1/market-close-run?dry_run=1" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: YOUR_CRON_SECRET" \
  -d '{}'
```

Ye Edge → tumhari Node API call karega.

---

## STEP 4 — pg_cron schedule (Supabase pe automatic time)

### File
`supabase/cron_market_close.sql`

Isme abhi schedule **commented** hai — pehle values replace karni hain.

### Exactly kya karna hai

1. File open karo: `supabase/cron_market_close.sql`
2. Neeche wala block **uncomment** karke 3 cheezein replace karo:

| Placeholder | Replace with |
|-------------|----------------|
| `PROJECT_REF` | Supabase Reference ID |
| `SERVICE_ROLE_KEY` | service_role secret key |
| `YOUR_CRON_SECRET` | same CRON_SECRET |

Example (dummy):

```sql
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'market-close-trigger';

select cron.schedule(
  'market-close-trigger',
  '1 16 * * 1-5',
  $$
  select net.http_post(
    url := 'https://abcdefghijklmnop.supabase.co/functions/v1/market-close-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'eyJhbGciOi...SERVICE_ROLE...',
      'x-cron-secret', 'a1b2c3d4...your_cron_secret...'
    ),
    body := jsonb_build_object('source', 'pg_cron')
  ) as request_id;
  $$,
  'America/New_York'
);
```

3. Pure SQL ko **Supabase → SQL Editor → paste → Run**

### Schedule meaning
- `1 16 * * 1-5` + timezone `America/New_York`  
  = **Monday–Friday 4:01 PM US Eastern**  
  = market close ke ~1 minute baad  
  = UK summer ~ **9:01 PM**

### Check cron registered
SQL Editor:

```sql
select * from cron.job where jobname = 'market-close-trigger';
```

### Unschedule (band karna ho)
```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'market-close-trigger';
```

---

## Manual test order (recommended)

| Order | Action | Safe? |
|-------|--------|--------|
| 1 | Step 1 SQL schema | Safe |
| 2 | Step 2 env + API restart | Safe |
| 3 | `curl ... market-close?dry_run=1` local | Safer |
| 4 | `curl ... market-close?dry_run=1` production API | Safer |
| 5 | Edge deploy + secrets | Safe |
| 6 | Edge curl dry_run | Safer |
| 7 | Step 4 pg_cron schedule | Safe (waits for schedule) |
| 8 | Real `curl` without dry_run | **Sends digest to users** |

After a real/dry run, Table Editor me check:
- `market_close_runs` — status, counts  
- `market_close_run_tickers` — per ticker  
- `usage_daily_ledger` — Firecrawl credits after scrapes  

---

## Kill switch / troubleshooting

| Problem | Fix |
|---------|-----|
| Job bilkul na chale | `MARKET_CLOSE_JOB_ENABLED=0` check; set `1` |
| 401 Unauthorized | Node `CRON_SECRET` ≠ Edge secret / curl Bearer galat |
| Edge 503 MARKET_CLOSE_API_URL | `supabase secrets set MARKET_CLOSE_API_URL=...` phir redeploy |
| Cron chala lekin API nahi | Production API public URL sahi? firewall? |
| “Already have run …” | Aaj ET day pe pehle success/partial/running ho chuka — kal ya failed retry |
| Firecrawl popup empty | Schema apply + kam se kam 1 scrape after schema |

---

## Header Gemini / Firecrawl popups

Alag se deploy nahi — **frontend + API** already code me hai.

1. API + web app chalao  
2. Notifications/Trigger dashboard  
3. Top chips **Gemini** / **Firecrawl** click  
4. Daily table popup  

Firecrawl history tab tab bharna shuru jab:
- schema applied, **aur**
- scrapes hone lage (ledger rows insert)

---

## Short checklist

- [ ] `schema_usage_and_jobs.sql` → SQL Editor → Run  
- [ ] `.env.local` (+ production): `CRON_SECRET`, `MARKET_CLOSE_JOB_ENABLED=1`  
- [ ] API restart / redeploy  
- [ ] `curl dry_run=1` on API works  
- [ ] `supabase login` + `link`  
- [ ] `supabase secrets set` (API URL + CRON_SECRET)  
- [ ] `supabase functions deploy market-close-run`  
- [ ] Edge dry_run curl works  
- [ ] `cron_market_close.sql` values fill → Run  
- [ ] `select * from cron.job` shows job  
- [ ] Optional: real run once off-hours carefully  

Agar kisi step pe exact screen / error message aaye to woh paste kar dena — us step pe pinpoint kar denge.
