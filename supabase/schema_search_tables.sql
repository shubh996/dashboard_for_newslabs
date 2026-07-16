-- Search bar + saved-record browsing: dedupes/constrains the existing ticker
-- table so it can be upserted, and adds one table per new entity type
-- (politicians, hedge funds/institutions, ETF-style fund managers).
-- Run this in the Supabase SQL editor (same project as schema.sql and
-- schema_ticker_dashboard.sql).

-- One-time cleanup: keep only the most recent row per ticker so a unique
-- index can be added safely (earlier testing likely left duplicates).
delete from public.ticker_dashboard_snapshots a
  using public.ticker_dashboard_snapshots b
  where a.ticker = b.ticker and a.created_at < b.created_at;

create unique index if not exists ticker_dashboard_snapshots_ticker_key
  on public.ticker_dashboard_snapshots (ticker);

create table if not exists public.politician_snapshots (
  id uuid primary key default gen_random_uuid(),
  filer_id text not null,
  data jsonb not null,
  source_metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists politician_snapshots_filer_id_key
  on public.politician_snapshots (filer_id);

create table if not exists public.institution_snapshots (
  id uuid primary key default gen_random_uuid(),
  cik bigint not null,
  manager_name text not null,
  data jsonb not null,
  source_metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists institution_snapshots_cik_key
  on public.institution_snapshots (cik);

create table if not exists public.etf_snapshots (
  id uuid primary key default gen_random_uuid(),
  cik bigint not null,
  manager_name text not null,
  data jsonb not null,
  source_metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists etf_snapshots_cik_key
  on public.etf_snapshots (cik);

alter table public.politician_snapshots enable row level security;
alter table public.institution_snapshots enable row level security;
alter table public.etf_snapshots enable row level security;

-- Same anon-select/insert/update + service_role-all pattern already used for
-- ticker_dashboard_snapshots (supabase/schema_ticker_dashboard.sql), applied
-- uniformly to all three new tables.
do $$
declare
  tbl text;
begin
  foreach tbl in array array['politician_snapshots', 'institution_snapshots', 'etf_snapshots']
  loop
    execute format('drop policy if exists "Service role can manage %I" on public.%I', tbl, tbl);
    execute format(
      'create policy "Service role can manage %I" on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
      tbl, tbl
    );

    execute format('drop policy if exists "Publishable key can read %I" on public.%I', tbl, tbl);
    execute format('create policy "Publishable key can read %I" on public.%I for select to anon using (true)', tbl, tbl);

    execute format('drop policy if exists "Publishable key can insert %I" on public.%I', tbl, tbl);
    execute format('create policy "Publishable key can insert %I" on public.%I for insert to anon with check (true)', tbl, tbl);

    execute format('drop policy if exists "Publishable key can update %I" on public.%I', tbl, tbl);
    execute format('create policy "Publishable key can update %I" on public.%I for update to anon using (true) with check (true)', tbl, tbl);
  end loop;
end $$;
