create table if not exists public.thresholds (
  id text not null default 'global'::text,
  thresholds jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (id)
);
