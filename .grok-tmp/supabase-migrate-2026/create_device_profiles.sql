create table if not exists public.device_profiles (
  device_id text not null,
  expo_push_token text,
  platform text,
  notifications_enabled boolean not null default false,
  permission_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (device_id)
);
