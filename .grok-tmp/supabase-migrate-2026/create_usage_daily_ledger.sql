create table if not exists public.usage_daily_ledger (
  id bigint not null,
  day date not null,
  provider text not null,
  ticker text,
  credits_used numeric not null default 0,
  cost_usd numeric not null default 0,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (id)
);
