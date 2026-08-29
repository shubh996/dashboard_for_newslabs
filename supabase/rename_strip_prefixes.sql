-- Drop momentum_ / trigger_ prefixes from live tables.
-- Safe to re-run: only renames when the old name still exists.

do $$
begin
  if to_regclass('public.momentum_episode_events') is not null
     and to_regclass('public.events_episodes') is null then
    alter table public.momentum_episode_events rename to events_episodes;
  end if;

  if to_regclass('public.momentum_episodes') is not null
     and to_regclass('public.episodes') is null then
    alter table public.momentum_episodes rename to episodes;
  end if;

  if to_regclass('public.momentum_episodes_stocks') is not null
     and to_regclass('public.episodes_stocks') is null then
    alter table public.momentum_episodes_stocks rename to episodes_stocks;
  end if;

  if to_regclass('public.momentum_episodes_indexes') is not null
     and to_regclass('public.episodes_indexes') is null then
    alter table public.momentum_episodes_indexes rename to episodes_indexes;
  end if;

  if to_regclass('public.momentum_episodes_forex') is not null
     and to_regclass('public.episodes_forex') is null then
    alter table public.momentum_episodes_forex rename to episodes_forex;
  end if;

  if to_regclass('public.momentum_episodes_etfs') is not null
     and to_regclass('public.episodes_etfs') is null then
    alter table public.momentum_episodes_etfs rename to episodes_etfs;
  end if;

  if to_regclass('public.momentum_episodes_crypto') is not null
     and to_regclass('public.episodes_crypto') is null then
    alter table public.momentum_episodes_crypto rename to episodes_crypto;
  end if;

  if to_regclass('public.momentum_episodes_commodities') is not null
     and to_regclass('public.episodes_commodities') is null then
    alter table public.momentum_episodes_commodities rename to episodes_commodities;
  end if;

  if to_regclass('public.momentum_research') is not null
     and to_regclass('public.research') is null then
    alter table public.momentum_research rename to research;
  end if;

  if to_regclass('public.momentum_thresholds') is not null
     and to_regclass('public.thresholds') is null then
    alter table public.momentum_thresholds rename to thresholds;
  end if;

  if to_regclass('public.trigger_device_monitor') is not null
     and to_regclass('public.device_monitor') is null then
    alter table public.trigger_device_monitor rename to device_monitor;
  end if;

  if to_regclass('public.trigger_device_profiles') is not null
     and to_regclass('public.device_profiles') is null then
    alter table public.trigger_device_profiles rename to device_profiles;
  end if;
end $$;
