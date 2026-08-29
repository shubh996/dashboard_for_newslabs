-- Optimize events_episodes storage (safe / preview-first).
-- Apply AFTER deploying code that writes slim measure + canonical state.
--
-- This file does NOT drop tables. Destructive DELETEs are commented out.
-- Run the PREVIEW queries first; only uncomment UPDATEs/DELETEs after review.

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) Indexes (idempotent — skip if already present)
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists events_episodes_episode_detected_idx
  on public.events_episodes (episode_id, detected_at desc);

create index if not exists events_episodes_ticker_detected_idx
  on public.events_episodes (ticker, detected_at desc);

create index if not exists events_episodes_type_detected_idx
  on public.events_episodes (event_type, detected_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) PREVIEW — how much fat / pollution exists
-- ═══════════════════════════════════════════════════════════════════════════

-- Events still carrying formulaLines inside measure
-- select
--   count(*) as with_formula_lines,
--   round(avg(pg_column_size(measure))) as avg_measure_bytes
-- from public.events_episodes
-- where measure ? 'formulaLines';

-- RESEARCH_DONE rows whose state looks like research prose
-- select count(*) as polluted_research_state
-- from public.events_episodes
-- where event_type = 'MOMENTUM_RESEARCH_DONE'
--   and state is not null
--   and (
--     length(state) > 40
--     or state ilike '%Likely driver%'
--     or state ilike '%RESEARCH%'
--   );

-- ALERT_SENT with redundant state/reason = RESEARCH
-- select count(*) as alert_research_label
-- from public.events_episodes
-- where event_type = 'MOMENTUM_ALERT_SENT'
--   and (state = 'RESEARCH' or reason in ('RESEARCH', 'RESEARCH_FALLBACK'));

-- Consecutive same-state MOMENTUM_STATE pairs (candidate purge)
-- with ordered as (
--   select
--     id,
--     episode_id,
--     state,
--     detected_at,
--     lag(state) over (partition by episode_id order by detected_at, id) as prev_state
--   from public.events_episodes
--   where event_type = 'MOMENTUM_STATE'
--     and coalesce(episode_id, '') <> ''
-- )
-- select count(*) as consecutive_same_state_rows
-- from ordered
-- where prev_state is not null
--   and prev_state = state;

-- Sample of consecutive same-state rows (inspect before delete)
-- with ordered as (
--   select
--     id,
--     episode_id,
--     ticker,
--     state,
--     detected_at,
--     lag(state) over (partition by episode_id order by detected_at, id) as prev_state
--   from public.events_episodes
--   where event_type = 'MOMENTUM_STATE'
--     and coalesce(episode_id, '') <> ''
-- )
-- select *
-- from ordered
-- where prev_state is not null
--   and prev_state = state
-- order by detected_at desc
-- limit 50;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) SAFE UPDATES — slim existing measure / fix polluted state
-- ═══════════════════════════════════════════════════════════════════════════

-- Strip formulaLines + duplicated scalars; keep peak/trough/peakMove only.
-- update public.events_episodes
-- set measure = case
--   when measure is null then null
--   when event_type in (
--     'MOMENTUM_RESEARCH_DONE',
--     'MOMENTUM_RESEARCH_RUNNING',
--     'MOMENTUM_ALERT_SENT'
--   ) then null
--   else jsonb_strip_nulls(jsonb_build_object(
--     'peakPrice', nullif(measure->>'peakPrice', '0')::float8,
--     'troughPrice', nullif(measure->>'troughPrice', '0')::float8,
--     'peakMovePercent', (measure->>'peakMovePercent')::float8
--   ))
-- end
-- where measure is not null
--    or event_type in (
--      'MOMENTUM_RESEARCH_DONE',
--      'MOMENTUM_RESEARCH_RUNNING',
--      'MOMENTUM_ALERT_SENT'
--    );

-- Clear research prose from state on RESEARCH_DONE
-- update public.events_episodes
-- set state = null
-- where event_type = 'MOMENTUM_RESEARCH_DONE'
--   and state is not null
--   and (
--     length(state) > 40
--     or state ilike '%Likely driver%'
--     or lower(state) = 'research'
--   );

-- Clear redundant ALERT labels
-- update public.events_episodes
-- set
--   state = case when state = 'RESEARCH' then null else state end,
--   reason = case
--     when reason in ('RESEARCH', 'RESEARCH_FALLBACK') then null
--     else reason
--   end
-- where event_type = 'MOMENTUM_ALERT_SENT'
--   and (state = 'RESEARCH' or reason in ('RESEARCH', 'RESEARCH_FALLBACK'));

-- Coerce measure peakPrice/troughPrice 0 → null leftovers
-- update public.events_episodes
-- set measure = measure
--   - case when (measure->>'peakPrice') in ('0', '0.0') then 'peakPrice' else 'peakPrice' end
-- where measure ? 'peakPrice'
--   and (measure->>'peakPrice') in ('0', '0.0');
-- (Prefer the jsonb_build_object rewrite above instead of this fragile form.)

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) OPTIONAL DESTRUCTIVE — consecutive same-state MOMENTUM_STATE purge
--    DO NOT RUN until PREVIEW counts reviewed and backed up.
-- ═══════════════════════════════════════════════════════════════════════════

-- delete from public.events_episodes e
-- using (
--   with ordered as (
--     select
--       id,
--       state,
--       lag(state) over (partition by episode_id order by detected_at, id) as prev_state
--     from public.events_episodes
--     where event_type = 'MOMENTUM_STATE'
--       and coalesce(episode_id, '') <> ''
--   )
--   select id from ordered
--   where prev_state is not null
--     and prev_state = state
-- ) d
-- where e.id = d.id;

-- ═══════════════════════════════════════════════════════════════════════════
-- Notes
-- ═══════════════════════════════════════════════════════════════════════════
-- • New writes (post-deploy) already omit formulaLines and use canonical state.
-- • episode_no, detected_at, created_at, research_id, asset_class retained.
-- • Full research body remains in public.research (not duplicated into state).
