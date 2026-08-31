-- Episode tables: drop payload + latest_driver; club last notification + research id.

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'episodes_stocks',
    'episodes_indexes',
    'episodes_forex',
    'episodes_etfs',
    'episodes_crypto',
    'episodes_commodities'
  ]
  loop
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists last_alert jsonb',
      tbl
    );

    execute format($sql$
      update public.%I
      set last_alert = jsonb_strip_nulls(jsonb_build_object(
        'title', last_notification_title,
        'body', last_notification_body,
        'research_id', latest_research_id
      ))
      where last_alert is null
        and (
          last_notification_title is not null
          or last_notification_body is not null
          or latest_research_id is not null
        )
    $sql$, tbl);

    execute format(
      'alter table public.%I drop column if exists payload',
      tbl
    );
    execute format(
      'alter table public.%I drop column if exists last_notification_title',
      tbl
    );
    execute format(
      'alter table public.%I drop column if exists last_notification_body',
      tbl
    );
    execute format(
      'alter table public.%I drop column if exists latest_driver',
      tbl
    );
  end loop;
end $$;
