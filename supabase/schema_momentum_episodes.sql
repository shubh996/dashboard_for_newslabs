-- Momentum episodes + timeline events (Recent Events rail).
-- Apply in Supabase Dashboard → SQL → New query → Run.
--
-- Episodes were previously in-memory only (lost on API restart).
-- This is the durable store the dashboard hydrates from.
--
-- Tables:
--   momentum_episodes         one row per episode; episode_no is PER TICKER (#001, #002, …)
--   momentum_episode_events   Started / Holding / Alert / Ended rows

create extension if not exists pgcrypto;

create table if not exists public.momentum_episodes (
  id uuid primary key default gen_random_uuid(),
  -- Per-ticker sequence (app assigns: max(ticker)+1). Unique with ticker, not global.
  episode_no bigint not null,
  episode_id text not null unique,
  ticker text not null,
  direction text not null,
  status text not null,
  state text,
  detected_window text,
  started_at timestamptz not null,
  ended_at timestamptz,
  end_reason text,
  peak_move_percent double precision,
  current_move_percent double precision,
  initial_move_percent double precision,
  reference_price double precision,
  trigger_price double precision,
  current_price double precision,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.momentum_episodes is
  'Durable momentum episodes. episode_no is per-ticker #001 / #002 (not global).';

create unique index if not exists momentum_episodes_ticker_no_uidx
  on public.momentum_episodes (ticker, episode_no);
create index if not exists momentum_episodes_ticker_started_idx
  on public.momentum_episodes (ticker, started_at desc);
create index if not exists momentum_episodes_status_idx
  on public.momentum_episodes (status, started_at desc);

create table if not exists public.momentum_episode_events (
  id uuid primary key default gen_random_uuid(),
  -- episode_no is denormalized per-ticker label; join events via episode_id
  episode_no bigint,
  episode_id text not null default '',
  ticker text not null,
  event_type text not null,
  state text,
  direction text,
  detected_window text,
  detected_at timestamptz not null,
  move_percent double precision,
  price double precision,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.momentum_episode_events is
  'Timeline rows for an episode (MOMENTUM_STARTED, STATE, ACCELERATING, ENDED, research, alerts).';

create unique index if not exists momentum_episode_events_dedupe_idx
  on public.momentum_episode_events (ticker, event_type, detected_at, episode_id);
create index if not exists momentum_episode_events_ticker_at_idx
  on public.momentum_episode_events (ticker, detected_at desc);
create index if not exists momentum_episode_events_episode_idx
  on public.momentum_episode_events (episode_id, detected_at);

alter table public.momentum_episodes enable row level security;
alter table public.momentum_episode_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'momentum_episodes'
      and policyname = 'momentum_episodes_service_all'
  ) then
    create policy momentum_episodes_service_all
      on public.momentum_episodes
      for all
      using (true)
      with check (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'momentum_episode_events'
      and policyname = 'momentum_episode_events_service_all'
  ) then
    create policy momentum_episode_events_service_all
      on public.momentum_episode_events
      for all
      using (true)
      with check (true);
  end if;
end $$;

-- Idempotent column add if an older copy of this table already exists.
alter table public.momentum_episode_events
  add column if not exists updated_at timestamptz not null default now();
