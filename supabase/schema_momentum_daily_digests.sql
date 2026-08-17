-- Daily Digest: OPEN / MIDDAY / CLOSE market summaries (separate from episodes).
-- Apply in Supabase Dashboard → SQL → New query → Run.
--
-- One row per ticker × trading session × slot.
-- Unique (ticker, session_date, slot) prevents duplicate notifications across restarts.

create extension if not exists pgcrypto;

create table if not exists public.momentum_daily_digests (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  -- Exchange-local trading date (YYYY-MM-DD), e.g. America/New_York for US equities
  session_date date not null,
  slot text not null check (slot in ('OPEN', 'MIDDAY', 'CLOSE')),
  direction text,
  move_percent double precision,
  current_price double precision,
  previous_close double precision,
  title text,
  body text,
  -- User-facing explanation only (no "Likely driver" / "Reason" labels)
  research_text text,
  research_status text not null default 'pending',
  research_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  notified_at timestamptz,
  push_result jsonb,
  detected_at timestamptz not null default now(),
  exchange_tz text default 'America/New_York',
  asset_class text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticker, session_date, slot)
);

comment on table public.momentum_daily_digests is
  'Scheduled OPEN/MIDDAY/CLOSE digests for equities/indexes. Separate from momentum episodes.';

create index if not exists momentum_daily_digests_ticker_at_idx
  on public.momentum_daily_digests (ticker, detected_at desc);
create index if not exists momentum_daily_digests_session_idx
  on public.momentum_daily_digests (session_date desc, slot);
create index if not exists momentum_daily_digests_status_idx
  on public.momentum_daily_digests (status, detected_at desc);

alter table public.momentum_daily_digests enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'momentum_daily_digests'
      and policyname = 'momentum_daily_digests_service_all'
  ) then
    create policy momentum_daily_digests_service_all
      on public.momentum_daily_digests
      for all
      using (true)
      with check (true);
  end if;
end $$;
