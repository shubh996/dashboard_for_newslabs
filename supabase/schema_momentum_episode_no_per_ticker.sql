-- Per-ticker episode numbers: SNDK #001, #002… independent of AAPL #001, #002…
-- Apply in Supabase SQL editor (or via migration runner).
--
-- Changes:
--   1) Drop global UNIQUE on episode_no
--   2) Drop events FK that pointed at global episode_no
--   3) UNIQUE (ticker, episode_no)
--   4) Renumber existing rows per ticker by started_at (oldest = 1)

-- Events only join on episode_id going forward
alter table public.momentum_episode_events
  drop constraint if exists momentum_episode_events_episode_no_fkey;

-- Drop serial uniqueness (name varies by how bigserial was created)
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.momentum_episodes'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%episode_no%';
  if cname is not null then
    execute format('alter table public.momentum_episodes drop constraint %I', cname);
  end if;
end $$;

drop index if exists public.momentum_episodes_episode_no_key;

-- Per-ticker unique number
create unique index if not exists momentum_episodes_ticker_no_uidx
  on public.momentum_episodes (ticker, episode_no);

comment on column public.momentum_episodes.episode_no is
  'Per-ticker sequence: #001, #002… for that symbol only (not global).';

-- Renumber each ticker oldest → newest as 1, 2, 3…
with ordered as (
  select
    id,
    row_number() over (partition by ticker order by started_at asc, created_at asc) as new_no
  from public.momentum_episodes
),
updated as (
  update public.momentum_episodes e
  set episode_no = o.new_no,
      updated_at = now()
  from ordered o
  where e.id = o.id
    and e.episode_no is distinct from o.new_no
  returning e.episode_id, e.ticker, e.episode_no
)
update public.momentum_episode_events ev
set episode_no = e.episode_no,
    updated_at = now()
from public.momentum_episodes e
where ev.episode_id = e.episode_id
  and (ev.episode_no is distinct from e.episode_no);
