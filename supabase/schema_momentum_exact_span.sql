-- Exact move duration for mobile: "UP +10% in 48 minutes"
-- (true bar span, not only window key like "1h" / "24h").
-- Apply in Supabase SQL editor once.

-- Episodes
alter table public.momentum_episodes
  add column if not exists reference_time timestamptz,
  add column if not exists exact_minutes integer,
  add column if not exists exact_label text,
  add column if not exists window_minutes integer;

comment on column public.momentum_episodes.exact_minutes is
  'True elapsed minutes from reference bar → episode start (e.g. 48).';
comment on column public.momentum_episodes.exact_label is
  'Human label for exact_minutes (e.g. "48 minutes", "2h 5m").';
comment on column public.momentum_episodes.window_minutes is
  'Nominal window key minutes (5, 60, 1440, …).';
comment on column public.momentum_episodes.reference_time is
  'ISO time of the reference price bar used for the move %.';

-- Timeline events
alter table public.momentum_episode_events
  add column if not exists exact_minutes integer,
  add column if not exists exact_label text,
  add column if not exists window_minutes integer,
  add column if not exists reference_time timestamptz,
  add column if not exists reference_price double precision;

comment on column public.momentum_episode_events.exact_minutes is
  'True elapsed minutes for this event (start span or live span on accel).';
comment on column public.momentum_episode_events.exact_label is
  'Human label for exact_minutes.';
