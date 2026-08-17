-- Rich mobile fields for episodes + events (alert copy, measure, giveback).
-- Apply after schema_momentum_episodes.sql (+ exact_span if present).
-- payload jsonb already holds the full mobile DTO; columns make filtering easier.

-- Episodes: last alert copy + live giveback
alter table public.momentum_episodes
  add column if not exists last_notification_title text,
  add column if not exists last_notification_body text,
  add column if not exists last_notification_at timestamptz,
  add column if not exists giveback_ratio double precision,
  add column if not exists giveback_pct double precision;

comment on column public.momentum_episodes.last_notification_title is
  'Last push title shown to the user for this episode.';
comment on column public.momentum_episodes.last_notification_body is
  'Last push body (research driver / copy).';
comment on column public.momentum_episodes.giveback_ratio is
  'Current giveback of peak/trough move as ratio 0–1 (live snapshot on last persist).';
comment on column public.momentum_episodes.giveback_pct is
  'Current giveback as percent 0–100 (live snapshot on last persist).';

-- Events: notification + measure
alter table public.momentum_episode_events
  add column if not exists notification_title text,
  add column if not exists notification_body text,
  add column if not exists notified_at timestamptz,
  add column if not exists should_notify boolean,
  add column if not exists giveback_ratio double precision,
  add column if not exists giveback_pct double precision,
  add column if not exists measure jsonb;

comment on column public.momentum_episode_events.notification_title is
  'User-facing alert title (if any) for this event.';
comment on column public.momentum_episode_events.notification_body is
  'User-facing alert body for this event.';
comment on column public.momentum_episode_events.measure is
  'How the move/giveback was calculated (prices, formula lines, exact span).';
comment on column public.momentum_episode_events.payload is
  'Full mobile DTO (schemaVersion 2): identity, measure, notification, pushResult, research.';
