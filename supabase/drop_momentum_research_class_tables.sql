-- Backfill leftover class-research rows into unified momentum_research, then drop
-- the per-class research tables. Do NOT drop momentum_research / device tables.

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
  prompt, input_facts, process_steps, 'momentum_research_etfs', created_at
from public.momentum_research_etfs
on conflict (id) do nothing;

drop table if exists public.momentum_research_stocks cascade;
drop table if exists public.momentum_research_commodities cascade;
drop table if exists public.momentum_research_forex cascade;
drop table if exists public.momentum_research_crypto cascade;
drop table if exists public.momentum_research_indexes cascade;
drop table if exists public.momentum_research_etfs cascade;
drop table if exists public.momentum_research_monitored_stocks cascade;
