-- Split momentum_episodes into per-asset-class tables.
-- Keep unified momentum_research; class research tables are dropped after backfill.
-- Events stay in momentum_episode_events (one lightweight log).

do $$
declare
  cls text;
  tbl text;
begin
  foreach cls in array array['stocks','indexes','forex','etfs','crypto','commodities']
  loop
    tbl := 'momentum_episodes_' || cls;

    execute format(
      'create table if not exists public.%I (like public.momentum_episodes including defaults including generated including identity)',
      tbl
    );

    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', tbl)::regclass
        and contype = 'p'
    ) then
      execute format(
        'alter table public.%I add constraint %I primary key (id)',
        tbl, tbl || '_pkey'
      );
    end if;

    execute format(
      'create unique index if not exists %I on public.%I (episode_id)',
      tbl || '_episode_id_key', tbl
    );
    execute format(
      'create unique index if not exists %I on public.%I (ticker, episode_no)',
      tbl || '_ticker_no_uidx', tbl
    );
    execute format(
      'create index if not exists %I on public.%I (ticker, started_at desc)',
      tbl || '_ticker_started_idx', tbl
    );
    execute format(
      'create index if not exists %I on public.%I (status, started_at desc)',
      tbl || '_status_started_idx', tbl
    );
    execute format(
      'create unique index if not exists %I on public.%I (ticker) where (upper(status) = ''ACTIVE'')',
      tbl || '_one_active_uidx', tbl
    );

    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_service_all', tbl);
    execute format(
      'create policy %I on public.%I for all using (true) with check (true)',
      tbl || '_service_all', tbl
    );

    execute format(
      'grant all on table public.%I to anon, authenticated, service_role, postgres',
      tbl
    );
  end loop;
end $$;

-- Copy existing episodes into the matching class table (ticker heuristics).
insert into public.momentum_episodes_crypto
select * from public.momentum_episodes e
where lower(coalesce(e.asset_class, '')) in ('crypto', 'cryptocurrency')
   or e.ticker ilike '%-USD'
   or e.ticker ilike '%-USDT'
on conflict (episode_id) do nothing;

insert into public.momentum_episodes_forex
select * from public.momentum_episodes e
where lower(coalesce(e.asset_class, '')) in ('forex', 'fx', 'currency')
   or e.ticker ilike '%=X'
on conflict (episode_id) do nothing;

insert into public.momentum_episodes_commodities
select * from public.momentum_episodes e
where lower(coalesce(e.asset_class, '')) in ('commodity', 'commodities', 'futures')
   or e.ticker ilike '%=F'
on conflict (episode_id) do nothing;

insert into public.momentum_episodes_indexes
select * from public.momentum_episodes e
where lower(coalesce(e.asset_class, '')) in ('index', 'indexes', 'indices')
   or e.ticker like '^%'
on conflict (episode_id) do nothing;

insert into public.momentum_episodes_etfs
select * from public.momentum_episodes e
where lower(coalesce(e.asset_class, '')) in ('etf', 'etfs')
   or lower(coalesce(e.payload->>'quoteType', '')) = 'etf'
on conflict (episode_id) do nothing;

insert into public.momentum_episodes_stocks
select * from public.momentum_episodes e
where not exists (
  select 1 from public.momentum_episodes_crypto c where c.episode_id = e.episode_id
)
and not exists (
  select 1 from public.momentum_episodes_forex f where f.episode_id = e.episode_id
)
and not exists (
  select 1 from public.momentum_episodes_commodities m where m.episode_id = e.episode_id
)
and not exists (
  select 1 from public.momentum_episodes_indexes i where i.episode_id = e.episode_id
)
and not exists (
  select 1 from public.momentum_episodes_etfs t where t.episode_id = e.episode_id
)
on conflict (episode_id) do nothing;
