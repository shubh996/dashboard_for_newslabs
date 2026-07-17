-- Yahoo Finance snapshots — completely separate from SEC ticker_dashboard_snapshots.
-- Run this in the Supabase SQL editor (same project as schema_ticker_dashboard.sql).
-- Saving Yahoo data never overwrites or deletes SEC rows.

create table if not exists public.yahoo_finance_snapshots (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  -- Structured, UI-friendly payload assembled from all modules.
  data jsonb not null default '{}',
  -- Complete raw response for every module (no field dropped).
  raw_json jsonb not null default '{}',
  -- Per-module status: success | empty | error (+ optional error message).
  module_status jsonb not null default '{}',
  source_metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists yahoo_finance_snapshots_ticker_key
  on public.yahoo_finance_snapshots (ticker);

create index if not exists yahoo_finance_snapshots_ticker_updated_idx
  on public.yahoo_finance_snapshots (ticker, updated_at desc);

-- Do NOT add a GIN index on data/raw_json. Large Yahoo snapshots (~1–2MB) make
-- every upsert rebuild the index and hit statement_timeout (57014) on Supabase.
-- If you already created it from an older schema, drop it:
drop index if exists public.yahoo_finance_snapshots_data_idx;

alter table public.yahoo_finance_snapshots enable row level security;

drop policy if exists "Service role can manage yahoo finance snapshots" on public.yahoo_finance_snapshots;
create policy "Service role can manage yahoo finance snapshots"
on public.yahoo_finance_snapshots
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Publishable key can read yahoo finance snapshots" on public.yahoo_finance_snapshots;
create policy "Publishable key can read yahoo finance snapshots"
on public.yahoo_finance_snapshots
for select
to anon
using (true);

drop policy if exists "Publishable key can insert yahoo finance snapshots" on public.yahoo_finance_snapshots;
create policy "Publishable key can insert yahoo finance snapshots"
on public.yahoo_finance_snapshots
for insert
to anon
with check (true);

drop policy if exists "Publishable key can update yahoo finance snapshots" on public.yahoo_finance_snapshots;
create policy "Publishable key can update yahoo finance snapshots"
on public.yahoo_finance_snapshots
for update
to anon
using (true)
with check (true);
