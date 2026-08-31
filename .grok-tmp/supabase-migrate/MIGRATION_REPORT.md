# Supabase migration report

## Projects
- OLD (untouched): `xufydubsuztxgsylzxub` (newslabs, eu-west-1) — account shubh.helloworld@gmail.com
- NEW (target): `ebcjsmpqogbwaxypgllh` (News-app, ap-southeast-2) — account cloudio.today@gmail.com

## Migrated
- All public app tables schema (repo SQL + missing tables CREATE)
- All public row data — counts match OLD exactly
- Sequences: momentum_episodes_episode_no_seq (765), usage_daily_ledger_id_seq (408)
- RLS policies for missing tables
- Edge Function `market-close-run` deployed to NEW
- App config: `.env.local` + `app-sidebar.tsx` SUPABASE_PROJECT

## Preserved on NEW
- Existing tables `bookmarks`, `news`, `recommendations` left intact

## Not migrated / manual follow-up
- Auth user UUID differs (same email `shubh.helloworld@gmail.com` already exists on NEW). OTP login works; profile avatar/full_name from OLD not copied.
- Storage: none on OLD
- pg_cron jobs: none on OLD (`cron.job` missing)
- Edge Function secrets (`MARKET_CLOSE_API_URL`, `CRON_SECRET`): set via `supabase secrets set` if market-close cron used
- Railway / Cloudflare Pages env vars: update manually to NEW URL/keys
- OLD project intentionally not deleted/modified

## New credentials (local)
- URL: https://ebcjsmpqogbwaxypgllh.supabase.co
- Publishable: sb_publishable_OB0-SQPShomhAEuFaaoDhA_rL9iUpBK
- Legacy anon JWT also available from API keys
- Service role: (in .env.local)
- DB password: Beawarwale1959
