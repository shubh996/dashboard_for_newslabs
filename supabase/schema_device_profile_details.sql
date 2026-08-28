-- Extra device identity / telemetry columns for Audience + Momentum Studio Users popup.
-- Safe to re-run. Mobile/register path can populate these when available.

alter table public.device_profiles
  add column if not exists user_id text,
  add column if not exists device_model text,
  add column if not exists manufacturer text,
  add column if not exists os_version text,
  add column if not exists app_version text,
  add column if not exists build_number text,
  add column if not exists timezone text,
  add column if not exists locale text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists token_updated_at timestamptz;

alter table public.trigger_device_profiles
  add column if not exists user_id text,
  add column if not exists device_model text,
  add column if not exists manufacturer text,
  add column if not exists os_version text,
  add column if not exists app_version text,
  add column if not exists build_number text,
  add column if not exists timezone text,
  add column if not exists locale text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists token_updated_at timestamptz;

create index if not exists device_profiles_user_id_idx
  on public.device_profiles (user_id)
  where user_id is not null;

create index if not exists trigger_device_profiles_user_id_idx
  on public.trigger_device_profiles (user_id)
  where user_id is not null;

create index if not exists device_profiles_last_seen_at_idx
  on public.device_profiles (last_seen_at desc nulls last);

create index if not exists trigger_device_profiles_last_seen_at_idx
  on public.trigger_device_profiles (last_seen_at desc nulls last);
