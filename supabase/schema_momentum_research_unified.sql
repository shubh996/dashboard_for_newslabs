-- Unified research archive (episode_id-centric).
-- Do NOT drop momentum_research_stocks / forex / crypto / commodities / indexes yet.
-- Dual-write from saveMomentumResearchRow; backfill below is idempotent.

create extension if not exists pgcrypto;

create table if not exists public.momentum_research (
  id uuid primary key default gen_random_uuid(),
  episode_id text,
  ticker text not null,
  asset_class text,
  attempt_no integer,
  status text,
  likely_driver text,
  secondary_driver text,
  reason text,
  push_title text,
  push_body text,
  model text,
  model_version text,
  request_id text,
  provider text default 'perplexity',
  citations jsonb not null default '[]'::jsonb,
  search_results jsonb not null default '[]'::jsonb,
  tools jsonb,
  tokens jsonb,
  cost jsonb,
  cost_usd double precision,
  cost_usd_display text,
  prompt text,
  input_facts text,
  process_steps jsonb,
  source_table text,
  created_at timestamptz not null default now()
);

create index if not exists momentum_research_episode_idx
  on public.momentum_research (episode_id, created_at desc);
create index if not exists momentum_research_ticker_idx
  on public.momentum_research (ticker, created_at desc);
create index if not exists momentum_research_asset_idx
  on public.momentum_research (asset_class, created_at desc);

alter table public.momentum_episodes
  add column if not exists asset_class text,
  add column if not exists latest_research_id uuid,
  add column if not exists latest_driver text;

alter table public.momentum_episode_events
  add column if not exists research_id uuid,
  add column if not exists short_reason text;

create index if not exists momentum_episodes_status_started_idx
  on public.momentum_episodes (status, started_at desc);
create index if not exists momentum_episode_events_episode_detected_idx
  on public.momentum_episode_events (episode_id, detected_at);

-- Backfill from class tables (skip rows already copied by id).
insert into public.momentum_research (
  id, ticker, asset_class, likely_driver, secondary_driver, reason,
  push_title, push_body, model, model_version, request_id, provider,
  citations, search_results, tools, tokens, cost, cost_usd, cost_usd_display,
  prompt, input_facts, process_steps, source_table, created_at
)
select
  id, ticker, asset_class, likely_driver, secondary_driver, reason,
  push_title, push_body, model, model_version, request_id, provider,
  coalesce(citations, '[]'::jsonb), coalesce(search_results, '[]'::jsonb),
  tools, tokens, cost, cost_usd, cost_usd_display,
  prompt, input_facts, process_steps, 'momentum_research_stocks', created_at
from public.momentum_research_stocks
on conflict (id) do nothing;

insert into public.momentum_research (
  id, ticker, asset_class, likely_driver, secondary_driver, reason,
  push_title, push_body, model, model_version, request_id, provider,
  citations, search_results, tools, tokens, cost, cost_usd, cost_usd_display,
  prompt, input_facts, process_steps, source_table, created_at
)
select
  id, ticker, asset_class, likely_driver, secondary_driver, reason,
  push_title, push_body, model, model_version, request_id, provider,
  coalesce(citations, '[]'::jsonb), coalesce(search_results, '[]'::jsonb),
  tools, tokens, cost, cost_usd, cost_usd_display,
  prompt, input_facts, process_steps, 'momentum_research_commodities', created_at
from public.momentum_research_commodities
on conflict (id) do nothing;

insert into public.momentum_research (
  id, ticker, asset_class, likely_driver, secondary_driver, reason,
  push_title, push_body, model, model_version, request_id, provider,
  citations, search_results, tools, tokens, cost, cost_usd, cost_usd_display,
  prompt, input_facts, process_steps, source_table, created_at
)
select
  id, ticker, asset_class, likely_driver, secondary_driver, reason,
  push_title, push_body, model, model_version, request_id, provider,
  coalesce(citations, '[]'::jsonb), coalesce(search_results, '[]'::jsonb),
  tools, tokens, cost, cost_usd, cost_usd_display,
  prompt, input_facts, process_steps, 'momentum_research_forex', created_at
from public.momentum_research_forex
on conflict (id) do nothing;

insert into public.momentum_research (
  id, ticker, asset_class, likely_driver, secondary_driver, reason,
  push_title, push_body, model, model_version, request_id, provider,
  citations, search_results, tools, tokens, cost, cost_usd, cost_usd_display,
  prompt, input_facts, process_steps, source_table, created_at
)
select
  id, ticker, asset_class, likely_driver, secondary_driver, reason,
  push_title, push_body, model, model_version, request_id, provider,
  coalesce(citations, '[]'::jsonb), coalesce(search_results, '[]'::jsonb),
  tools, tokens, cost, cost_usd, cost_usd_display,
  prompt, input_facts, process_steps, 'momentum_research_crypto', created_at
from public.momentum_research_crypto
on conflict (id) do nothing;

insert into public.momentum_research (
  id, ticker, asset_class, likely_driver, secondary_driver, reason,
  push_title, push_body, model, model_version, request_id, provider,
  citations, search_results, tools, tokens, cost, cost_usd, cost_usd_display,
  prompt, input_facts, process_steps, source_table, created_at
)
select
  id, ticker, asset_class, likely_driver, secondary_driver, reason,
  push_title, push_body, model, model_version, request_id, provider,
  coalesce(citations, '[]'::jsonb), coalesce(search_results, '[]'::jsonb),
  tools, tokens, cost, cost_usd, cost_usd_display,
  prompt, input_facts, process_steps, 'momentum_research_indexes', created_at
from public.momentum_research_indexes
on conflict (id) do nothing;
