create table if not exists public.assets_monitor_based_on_device (
  ticker text not null,
  subscribers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  asset_class text,
  primary key (ticker)
);
