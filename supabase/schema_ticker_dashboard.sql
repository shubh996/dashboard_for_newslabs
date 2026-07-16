-- Ticker dashboard: 13F institutional-holdings cache + saved full ticker snapshots.
-- Run this in the Supabase SQL editor (same project as schema.sql).

create table if not exists public.edgar_holdings_cache (
  cik bigint primary key,
  manager_name text not null,
  filing_date date,
  filing_url text,
  holdings jsonb not null default '[]',
  fetched_at timestamptz not null default now()
);

create table if not exists public.ticker_dashboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  data jsonb not null,
  source_metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists ticker_dashboard_snapshots_ticker_idx
  on public.ticker_dashboard_snapshots (ticker, created_at desc);

create index if not exists ticker_dashboard_snapshots_data_idx
  on public.ticker_dashboard_snapshots using gin (data);

alter table public.edgar_holdings_cache enable row level security;
alter table public.ticker_dashboard_snapshots enable row level security;

drop policy if exists "Service role can manage edgar holdings cache" on public.edgar_holdings_cache;
create policy "Service role can manage edgar holdings cache"
on public.edgar_holdings_cache
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Service role can manage ticker dashboard snapshots" on public.ticker_dashboard_snapshots;
create policy "Service role can manage ticker dashboard snapshots"
on public.ticker_dashboard_snapshots
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Publishable key can read ticker dashboard snapshots" on public.ticker_dashboard_snapshots;
create policy "Publishable key can read ticker dashboard snapshots"
on public.ticker_dashboard_snapshots
for select
to anon
using (true);

drop policy if exists "Publishable key can insert ticker dashboard snapshots" on public.ticker_dashboard_snapshots;
create policy "Publishable key can insert ticker dashboard snapshots"
on public.ticker_dashboard_snapshots
for insert
to anon
with check (true);

drop policy if exists "Publishable key can update ticker dashboard snapshots" on public.ticker_dashboard_snapshots;
create policy "Publishable key can update ticker dashboard snapshots"
on public.ticker_dashboard_snapshots
for update
to anon
using (true)
with check (true);
