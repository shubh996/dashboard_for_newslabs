-- Missing tables from old project (xufydubsuztxgsylzxub) — create on News-app

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.app_feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.app_releases (
  id text primary key,
  min_version text not null default '0.0.0',
  min_build integer not null default 0,
  latest_version text not null default '0.0.0',
  latest_build integer not null default 0,
  force_update boolean not null default false,
  title text,
  message text,
  store_url text,
  check_eas_update boolean not null default true,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.device_monitored_tickers (
  ticker text primary key,
  company_name text,
  subscribers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  notable_price_movements jsonb not null default '{}'::jsonb
);

create index if not exists device_monitored_tickers_subscribers_gin
  on public.device_monitored_tickers using gin (subscribers);
create index if not exists device_monitored_tickers_ticker_idx
  on public.device_monitored_tickers (ticker);

create table if not exists public.device_profiles (
  device_id text primary key,
  expo_push_token text,
  platform text,
  notifications_enabled boolean not null default false,
  permission_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists device_profiles_expo_push_token_idx
  on public.device_profiles (expo_push_token)
  where expo_push_token is not null;

create table if not exists public.trigger_device_monitor (
  ticker text primary key,
  company_name text,
  subscribers jsonb not null default '[]'::jsonb,
  notable_price_movements jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists trigger_device_monitor_subscribers_gin
  on public.trigger_device_monitor using gin (subscribers);

create table if not exists public.trigger_device_profiles (
  device_id text primary key,
  expo_push_token text,
  platform text,
  notifications_enabled boolean not null default false,
  permission_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trigger_device_profiles_expo_push_token_idx
  on public.trigger_device_profiles (expo_push_token)
  where expo_push_token is not null;

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  email text not null,
  asset_class text not null,
  symbol text,
  instrument_name text,
  plan text not null default 'pro',
  expected_price_gbp numeric not null default 10,
  source text not null default 'mobile_app',
  created_at timestamptz not null default now(),
  constraint waitlist_signups_asset_class_check
    check (asset_class = any (array['crypto'::text, 'forex'::text, 'index'::text, 'commodity'::text])),
  constraint waitlist_signups_user_id_asset_class_key unique (user_id, asset_class)
);

create index if not exists waitlist_signups_asset_class_idx on public.waitlist_signups (asset_class);
create index if not exists waitlist_signups_email_idx on public.waitlist_signups (email);

-- RLS
alter table public.app_admin_users enable row level security;
alter table public.app_feature_flags enable row level security;
alter table public.app_releases enable row level security;
alter table public.device_monitored_tickers enable row level security;
alter table public.device_profiles enable row level security;
alter table public.trigger_device_monitor enable row level security;
alter table public.trigger_device_profiles enable row level security;
alter table public.waitlist_signups enable row level security;

drop policy if exists "Admin users can read themselves" on public.app_admin_users;
create policy "Admin users can read themselves"
  on public.app_admin_users for select
  using (lower(email) = lower((auth.jwt() ->> 'email')));

drop policy if exists "Feature flags are readable by clients" on public.app_feature_flags;
create policy "Feature flags are readable by clients"
  on public.app_feature_flags for select using (true);

drop policy if exists "Feature flags are updatable by admins" on public.app_feature_flags;
create policy "Feature flags are updatable by admins"
  on public.app_feature_flags for update
  using (exists (select 1 from public.app_admin_users admin where lower(admin.email) = lower((auth.jwt() ->> 'email'))))
  with check (exists (select 1 from public.app_admin_users admin where lower(admin.email) = lower((auth.jwt() ->> 'email'))));

drop policy if exists "Feature flags are writable by admins" on public.app_feature_flags;
create policy "Feature flags are writable by admins"
  on public.app_feature_flags for insert
  with check (exists (select 1 from public.app_admin_users admin where lower(admin.email) = lower((auth.jwt() ->> 'email'))));

drop policy if exists "App releases are readable by clients" on public.app_releases;
create policy "App releases are readable by clients"
  on public.app_releases for select to anon, authenticated
  using (enabled = true);

drop policy if exists device_monitored_tickers_anon_all on public.device_monitored_tickers;
create policy device_monitored_tickers_anon_all
  on public.device_monitored_tickers for all to anon, authenticated
  using (true) with check (true);

drop policy if exists trigger_shared_monitor_read on public.device_monitored_tickers;
create policy trigger_shared_monitor_read
  on public.device_monitored_tickers for select to anon, authenticated
  using (true);

drop policy if exists device_profiles_anon_all on public.device_profiles;
create policy device_profiles_anon_all
  on public.device_profiles for all to anon, authenticated
  using (true) with check (true);

drop policy if exists trigger_device_monitor_anon_all on public.trigger_device_monitor;
create policy trigger_device_monitor_anon_all
  on public.trigger_device_monitor for all to anon, authenticated
  using (true) with check (true);

drop policy if exists trigger_device_profiles_anon_all on public.trigger_device_profiles;
create policy trigger_device_profiles_anon_all
  on public.trigger_device_profiles for all to anon, authenticated
  using (true) with check (true);

drop policy if exists waitlist_signups_anon_insert on public.waitlist_signups;
create policy waitlist_signups_anon_insert
  on public.waitlist_signups for insert to anon, authenticated
  with check (
    (email is not null)
    and (length(trim(both from email)) > 3)
    and (asset_class = any (array['crypto'::text, 'forex'::text, 'index'::text, 'commodity'::text]))
    and (source = 'mobile_app'::text)
  );

grant select, insert, update, delete on public.app_admin_users to anon, authenticated, service_role;
grant select, insert, update, delete on public.app_feature_flags to anon, authenticated, service_role;
grant select, insert, update, delete on public.app_releases to anon, authenticated, service_role;
grant select, insert, update, delete on public.device_monitored_tickers to anon, authenticated, service_role;
grant select, insert, update, delete on public.device_profiles to anon, authenticated, service_role;
grant select, insert, update, delete on public.trigger_device_monitor to anon, authenticated, service_role;
grant select, insert, update, delete on public.trigger_device_profiles to anon, authenticated, service_role;
grant select, insert, update, delete on public.waitlist_signups to anon, authenticated, service_role;
