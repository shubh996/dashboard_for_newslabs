# Supabase migration report (2026-08-29)

## Projects
- SOURCE (untouched): `ebcjsmpqogbwaxypgllh` (News-app, ap-southeast-2 / Sydney) — cloudio.today
- TARGET: `bsammfevuefowmpvsnju` (Trigger Database, eu-central-1) — new account

## Migrated
- All 14 public app tables (schema from source column metadata)
- All public row data — counts match source (249 rows total)
- RLS enabled + policies copied
- Indexes (46 non-PK) copied
- Sequences: `momentum_episodes_episode_no_seq` (765), `usage_daily_ledger_id_seq` (max/412)
- Edge Function `market-close-run` deployed to TARGET
- Extra schema applied: `momentum_episode_policy` (repo SQL; was missing on source public list but required by API)
- Local `.env.local` cut over to TARGET URL + publishable + service_role + DB password
- Backup: `.env.local.bak-pre-bsamm-*`
- Local verify: Vite requests hit `bsammfevuefowmpvsnju.supabase.co`; Settings → Platforms → Supabase opens new project dashboard

## Not done / manual follow-up
- Railway env vars (CLI not installed on this machine) — set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` on the API service
- Cloudflare Pages env vars (wrangler not logged in) — set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and redeploy
- Edge Function secrets (`MARKET_CLOSE_API_URL`, `CRON_SECRET`) — not present in local `.env.local`; set if market-close cron is used
- Auth users — not copied (OTP / magic link will create users on TARGET as needed)
- Storage — none required for current desk tables
- SOURCE project intentionally not deleted/modified
- Direct Postgres (`psql`/`pg_dump`) blocked from this network (pooler SSL hang; direct host IPv6-only); used Management API + PostgREST instead

## Verify checklist
- [ ] Local desk loads episodes / monitored tickers from new project
- [ ] Restart Vite + API so they pick up `.env.local`
- [ ] Railway + Cloudflare env updated + redeployed
- [ ] Settings → Platforms → Supabase opens `bsammfevuefowmpvsnju` dashboard
