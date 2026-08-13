-- Momentum / Perplexity research findings — one table per asset class.
-- Apply in Supabase Dashboard → SQL → New query → Run.
--
-- Tables:
--   momentum_research_monitored_stocks  (equity / stocks)
--   momentum_research_commodities
--   momentum_research_forex
--   momentum_research_crypto
--   momentum_research_indexes

create extension if not exists pgcrypto;

-- ─── Monitored Stocks ───────────────────────────────────────────
create table if not exists public.momentum_research_monitored_stocks (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  company_name text,
  asset_class text not null default 'equity',
  event_date date,
  window_key text,
  window_label text,
  exact_label text,
  exact_minutes integer,
  move_percent double precision,
  user_movement text,
  market_session text,
  live_price double precision,
  reference_price double precision,
  reference_time timestamptz,
  headline text,
  likely_driver text,
  secondary_driver text,
  reason text not null,
  push_title text,
  push_body text,
  model text,
  model_version text,
  request_id text,
  provider text not null default 'perplexity',
  citations jsonb not null default '[]'::jsonb,
  search_results jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  tokens jsonb,
  cost jsonb,
  cost_usd double precision,
  cost_usd_display text,
  prompt text,
  input_facts text,
  process_steps jsonb,
  created_at timestamptz not null default now()
);

create index if not exists momentum_research_monitored_stocks_ticker_created_idx
  on public.momentum_research_monitored_stocks (ticker, created_at desc);
create index if not exists momentum_research_monitored_stocks_created_idx
  on public.momentum_research_monitored_stocks (created_at desc);

-- ─── Commodities ────────────────────────────────────────────────
create table if not exists public.momentum_research_commodities (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  company_name text,
  asset_class text not null default 'commodity',
  event_date date,
  window_key text,
  window_label text,
  exact_label text,
  exact_minutes integer,
  move_percent double precision,
  user_movement text,
  market_session text,
  live_price double precision,
  reference_price double precision,
  reference_time timestamptz,
  headline text,
  likely_driver text,
  secondary_driver text,
  reason text not null,
  push_title text,
  push_body text,
  model text,
  model_version text,
  request_id text,
  provider text not null default 'perplexity',
  citations jsonb not null default '[]'::jsonb,
  search_results jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  tokens jsonb,
  cost jsonb,
  cost_usd double precision,
  cost_usd_display text,
  prompt text,
  input_facts text,
  process_steps jsonb,
  created_at timestamptz not null default now()
);

create index if not exists momentum_research_commodities_ticker_created_idx
  on public.momentum_research_commodities (ticker, created_at desc);
create index if not exists momentum_research_commodities_created_idx
  on public.momentum_research_commodities (created_at desc);

-- ─── Forex ──────────────────────────────────────────────────────
create table if not exists public.momentum_research_forex (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  company_name text,
  asset_class text not null default 'forex',
  event_date date,
  window_key text,
  window_label text,
  exact_label text,
  exact_minutes integer,
  move_percent double precision,
  user_movement text,
  market_session text,
  live_price double precision,
  reference_price double precision,
  reference_time timestamptz,
  headline text,
  likely_driver text,
  secondary_driver text,
  reason text not null,
  push_title text,
  push_body text,
  model text,
  model_version text,
  request_id text,
  provider text not null default 'perplexity',
  citations jsonb not null default '[]'::jsonb,
  search_results jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  tokens jsonb,
  cost jsonb,
  cost_usd double precision,
  cost_usd_display text,
  prompt text,
  input_facts text,
  process_steps jsonb,
  created_at timestamptz not null default now()
);

create index if not exists momentum_research_forex_ticker_created_idx
  on public.momentum_research_forex (ticker, created_at desc);
create index if not exists momentum_research_forex_created_idx
  on public.momentum_research_forex (created_at desc);

-- ─── Crypto ─────────────────────────────────────────────────────
create table if not exists public.momentum_research_crypto (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  company_name text,
  asset_class text not null default 'crypto',
  event_date date,
  window_key text,
  window_label text,
  exact_label text,
  exact_minutes integer,
  move_percent double precision,
  user_movement text,
  market_session text,
  live_price double precision,
  reference_price double precision,
  reference_time timestamptz,
  headline text,
  likely_driver text,
  secondary_driver text,
  reason text not null,
  push_title text,
  push_body text,
  model text,
  model_version text,
  request_id text,
  provider text not null default 'perplexity',
  citations jsonb not null default '[]'::jsonb,
  search_results jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  tokens jsonb,
  cost jsonb,
  cost_usd double precision,
  cost_usd_display text,
  prompt text,
  input_facts text,
  process_steps jsonb,
  created_at timestamptz not null default now()
);

create index if not exists momentum_research_crypto_ticker_created_idx
  on public.momentum_research_crypto (ticker, created_at desc);
create index if not exists momentum_research_crypto_created_idx
  on public.momentum_research_crypto (created_at desc);

-- ─── Indexes ────────────────────────────────────────────────────
create table if not exists public.momentum_research_indexes (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  company_name text,
  asset_class text not null default 'index',
  event_date date,
  window_key text,
  window_label text,
  exact_label text,
  exact_minutes integer,
  move_percent double precision,
  user_movement text,
  market_session text,
  live_price double precision,
  reference_price double precision,
  reference_time timestamptz,
  headline text,
  likely_driver text,
  secondary_driver text,
  reason text not null,
  push_title text,
  push_body text,
  model text,
  model_version text,
  request_id text,
  provider text not null default 'perplexity',
  citations jsonb not null default '[]'::jsonb,
  search_results jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  tokens jsonb,
  cost jsonb,
  cost_usd double precision,
  cost_usd_display text,
  prompt text,
  input_facts text,
  process_steps jsonb,
  created_at timestamptz not null default now()
);

create index if not exists momentum_research_indexes_ticker_created_idx
  on public.momentum_research_indexes (ticker, created_at desc);
create index if not exists momentum_research_indexes_created_idx
  on public.momentum_research_indexes (created_at desc);

-- RLS: readable by anon/authenticated; inserts allowed for anon + service_role (server)
alter table public.momentum_research_monitored_stocks enable row level security;
alter table public.momentum_research_commodities enable row level security;
alter table public.momentum_research_forex enable row level security;
alter table public.momentum_research_crypto enable row level security;
alter table public.momentum_research_indexes enable row level security;

do $$
declare
  t text;
  tables text[] := array[
    'momentum_research_monitored_stocks',
    'momentum_research_commodities',
    'momentum_research_forex',
    'momentum_research_crypto',
    'momentum_research_indexes'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_select', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to anon, authenticated, service_role with check (true)',
      t || '_insert', t
    );
  end loop;
end $$;
