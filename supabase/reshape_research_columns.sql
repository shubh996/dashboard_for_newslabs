-- Research table: keep drivers + combined alert; drop duplicate/unused columns.
-- Fill episode_id on existing rows from nearby episode events when possible.

alter table public.research
  add column if not exists alert jsonb;

update public.research
set alert = jsonb_build_object(
  'title', coalesce(push_title, ''),
  'body', coalesce(push_body, '')
)
where alert is null
  and (push_title is not null or push_body is not null);

update public.research
set model_version = coalesce(nullif(btrim(model_version), ''), model)
where model_version is null or btrim(model_version) = '';

update public.research r
set episode_id = sub.episode_id
from (
  select distinct on (r2.id)
    r2.id,
    ev.episode_id
  from public.research r2
  join public.episodes_events ev
    on upper(ev.ticker) = upper(r2.ticker)
   and coalesce(ev.episode_id, '') <> ''
   and ev.event_type in (
     'MOMENTUM_RESEARCH_DONE',
     'MOMENTUM_STARTED',
     'MOMENTUM_ALERT_SENT'
   )
  where abs(extract(epoch from (ev.detected_at - r2.created_at))) <= 7200
  order by r2.id, abs(extract(epoch from (ev.detected_at - r2.created_at)))
) sub
where r.id = sub.id
  and coalesce(r.episode_id, '') = '';

alter table public.research
  drop column if exists attempt_no,
  drop column if exists status,
  drop column if exists reason,
  drop column if exists push_title,
  drop column if exists push_body,
  drop column if exists model,
  drop column if exists provider,
  drop column if exists tools;
