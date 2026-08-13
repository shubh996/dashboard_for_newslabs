-- App release settings: current version + build number per product app.
-- Dashboard Settings page reads/writes these rows (service role).
-- Run once in the Supabase SQL editor.

create table if not exists public.app_release_settings (
  app_key text primary key
    constraint app_release_settings_app_key_check
    check (app_key in ('trigger', 'nineam')),
  version text not null default '',
  build_number text not null default '',
  notes text,
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.app_release_settings is
  'Current mobile/app release version + build number per product (trigger | nineam). '
  'Managed from the notifications dashboard Settings screen.';

comment on column public.app_release_settings.version is
  'User-facing version string, e.g. 1.4.2';

comment on column public.app_release_settings.build_number is
  'Build / CFBundleVersion / versionCode, e.g. 184';

create or replace function public.set_app_release_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_app_release_settings_updated_at on public.app_release_settings;

create trigger set_app_release_settings_updated_at
before update on public.app_release_settings
for each row
execute function public.set_app_release_settings_updated_at();

-- Seed rows so the dashboard always has something to load.
insert into public.app_release_settings (app_key, version, build_number)
values
  ('trigger', '', ''),
  ('nineam', '', '')
on conflict (app_key) do nothing;

alter table public.app_release_settings enable row level security;

drop policy if exists "Service role can manage app release settings"
  on public.app_release_settings;
drop policy if exists "Publishable key can read app release settings"
  on public.app_release_settings;

create policy "Service role can manage app release settings"
on public.app_release_settings
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- Dashboard server may use the publishable key when service role is not set.
create policy "Publishable key can read app release settings"
on public.app_release_settings
for select
using (true);

create policy "Publishable key can insert app release settings"
on public.app_release_settings
for insert
with check (true);

create policy "Publishable key can update app release settings"
on public.app_release_settings
for update
using (true)
with check (true);
