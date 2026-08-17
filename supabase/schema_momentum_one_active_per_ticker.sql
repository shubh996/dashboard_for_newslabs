-- Enforce at most one ACTIVE momentum episode per ticker (DB-level).
-- Apply in Supabase SQL editor after schema_momentum_episodes.sql.
--
-- Partial unique index: multiple terminal rows (EXPIRED/ENDED/REVERSED/…)
-- are allowed; only one row with status = 'ACTIVE' may exist per ticker.
-- Concurrent workers that both try to INSERT ACTIVE will race; one wins,
-- the other fails the unique constraint and must not open a second episode.

create unique index if not exists momentum_episodes_one_active_per_ticker_uidx
  on public.momentum_episodes (ticker)
  where upper(status) = 'ACTIVE';

comment on index public.momentum_episodes_one_active_per_ticker_uidx is
  'At most one ACTIVE episode per ticker. Terminal statuses unrestricted.';

-- Optional: event-level idempotency column for push dedupe across restarts.
-- App still uses in-memory claim first; this helps multi-instance deploys.
alter table public.momentum_episode_events
  add column if not exists idempotency_key text;

create unique index if not exists momentum_episode_events_idempotency_uidx
  on public.momentum_episode_events (idempotency_key)
  where idempotency_key is not null and idempotency_key <> '';

comment on column public.momentum_episode_events.idempotency_key is
  'Stable key: episodeId:eventType:cycleNumber — suppress duplicate push rows.';
