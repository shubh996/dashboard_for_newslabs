-- Global rolling-return |move %| thresholds (momentum dashboard settings).
-- Apply in Supabase Dashboard → SQL → New query → Run.
--
-- Single-row store (id = 'global'). Server also mirrors to data/momentum-thresholds.json.

create extension if not exists pgcrypto;

create table if not exists public.momentum_thresholds (
  id text primary key default 'global',
  thresholds jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.momentum_thresholds is
  'Global momentum rolling-return thresholds (5m, 15m, day, …). Blank/0 = off.';

insert into public.momentum_thresholds (id, thresholds)
values ('global', '{}'::jsonb)
on conflict (id) do nothing;

alter table public.momentum_thresholds enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'momentum_thresholds'
      and policyname = 'momentum_thresholds_service_all'
  ) then
    create policy momentum_thresholds_service_all
      on public.momentum_thresholds
      for all
      using (true)
      with check (true);
  end if;
end $$;
