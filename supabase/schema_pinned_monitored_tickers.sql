-- Extreme / Pinned monitor store (separate from device_monitored_tickers / Users).
-- Same notable_price_movements shape so scrape / auto-save / Gemini / alert copy work
-- without requiring any subscriber row in device_monitored_tickers.
-- Run once in the Supabase SQL editor.

create table if not exists public.pinned_monitored_tickers (
  ticker text primary key,
  company_name text,
  notable_price_movements jsonb not null default '{}'::jsonb,
  pinned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pinned_monitored_tickers is
  'Dashboard Extreme → Pinned tickers. Holds scrape/save history independently of user subscriptions (device_monitored_tickers).';

comment on column public.pinned_monitored_tickers.notable_price_movements is
  'Same shape as device_monitored_tickers.notable_price_movements (v2 dates map).';

create index if not exists pinned_monitored_tickers_updated_at_idx
  on public.pinned_monitored_tickers (updated_at desc);

-- Service role / dashboard API needs full access (mirror device table policy style).
alter table public.pinned_monitored_tickers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pinned_monitored_tickers'
      and policyname = 'pinned_monitored_tickers_service_all'
  ) then
    create policy pinned_monitored_tickers_service_all
      on public.pinned_monitored_tickers
      for all
      using (true)
      with check (true);
  end if;
end $$;
