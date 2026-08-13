-- Usage ledgers + market-close job runs (Trigger automation).
-- Apply in Supabase SQL editor (or: supabase db query -f ...).

-- ---------------------------------------------------------------------------
-- Daily provider usage (Firecrawl credits; optional Gemini mirror rows)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_daily_ledger (
  id bigserial primary key,
  day date not null,
  provider text not null check (provider in ('gemini', 'firecrawl', 'perplexity')),
  ticker text null,
  credits_used numeric not null default 0,
  cost_usd numeric not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_daily_ledger_day_provider_idx
  on public.usage_daily_ledger (day desc, provider);

create index if not exists usage_daily_ledger_provider_day_idx
  on public.usage_daily_ledger (provider, day desc);

comment on table public.usage_daily_ledger is
  'Per-scrape / per-call usage rows. Firecrawl: credits_used. Gemini may also be mirrored here.';

-- ---------------------------------------------------------------------------
-- Market close automation runs
-- ---------------------------------------------------------------------------
create table if not exists public.market_close_runs (
  id uuid primary key default gen_random_uuid(),
  run_date_et date not null,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  tickers_total int not null default 0,
  tickers_ok int not null default 0,
  tickers_failed int not null default 0,
  hits_ge_4pct int not null default 0,
  gemini_ok int not null default 0,
  gemini_failed int not null default 0,
  digest_sent_ok int not null default 0,
  digest_sent_failed int not null default 0,
  dry_run boolean not null default false,
  error text null,
  detail jsonb not null default '{}'::jsonb
);

-- App enforces one successful/running run per ET day (failed runs can be retried).
create index if not exists market_close_runs_date_idx
  on public.market_close_runs (run_date_et desc, dry_run, status);

create table if not exists public.market_close_run_tickers (
  id bigserial primary key,
  run_id uuid not null references public.market_close_runs (id) on delete cascade,
  ticker text not null,
  status text not null default 'pending'
    check (status in ('pending', 'ok', 'error', 'skipped')),
  error text null,
  hit_count int not null default 0,
  gemini_count int not null default 0,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists market_close_run_tickers_run_idx
  on public.market_close_run_tickers (run_id);

-- Optional: enable HTTP from pg_cron (Supabase usually has pg_net)
-- create extension if not exists pg_net with schema extensions;

-- Example schedule (edit project URL + service role / anon + function JWT as needed).
-- Runs Mon–Fri at 16:01 America/New_York via Edge Function proxy → Node job.
/*
select cron.unschedule('market-close-trigger') where exists (
  select 1 from cron.job where jobname = 'market-close-trigger'
);

select cron.schedule(
  'market-close-trigger',
  '1 16 * * 1-5',
  $$
  select net.http_post(
    url := current_setting('app.settings.market_close_edge_url', true),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.market_close_cron_secret', true)
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
  $$,
  'America/New_York'
);
*/
