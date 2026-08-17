-- Episode policy per asset class (accel pp, giveback bands, inactivity, …).
-- Apply in Supabase Dashboard → SQL → New query → Run.
--
-- Single-row store (id = 'global'). policy jsonb holds either:
--   { byClass: { equity: {…}, commodity: {…}, … }, …flat equity for legacy }
-- or a flat map (legacy) which the server seeds onto every class on load.
-- Server also mirrors to data/momentum-episode-policy.json.
-- Mirrors the Rolling returns → "Episode rules" settings panel (per asset-class tab).

create extension if not exists pgcrypto;

create table if not exists public.momentum_episode_policy (
  id text primary key default 'global',
  policy jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.momentum_episode_policy is
  'Momentum episode rules per asset class (equity/commodity/forex/crypto/index): acceleration pp, giveback %, inactivity min, re-arm buffer, strong-fade toggle. Stored as policy.byClass.';

insert into public.momentum_episode_policy (id, policy)
values ('global', '{}'::jsonb)
on conflict (id) do nothing;

alter table public.momentum_episode_policy enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'momentum_episode_policy'
      and policyname = 'momentum_episode_policy_service_all'
  ) then
    create policy momentum_episode_policy_service_all
      on public.momentum_episode_policy
      for all
      using (true)
      with check (true);
  end if;
end $$;
