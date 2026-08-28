-- episodes_events: asset_class, drop fat payload + unused span/ratio columns.

alter table public.episodes_events
  add column if not exists asset_class text;

update public.episodes_events
set giveback_pct = giveback_ratio * 100
where giveback_pct is null
  and giveback_ratio is not null
  and abs(giveback_ratio) <= 1.5;

update public.episodes_events
set asset_class = case
  when lower(coalesce(payload->>'assetClass', payload->>'asset_class', ''))
    in ('crypto', 'cryptocurrency')
    or ticker ilike '%-USD'
    or ticker ilike '%-USDT' then 'crypto'
  when lower(coalesce(payload->>'assetClass', payload->>'asset_class', ''))
    in ('forex', 'fx', 'currency')
    or ticker ilike '%=X' then 'forex'
  when lower(coalesce(payload->>'assetClass', payload->>'asset_class', ''))
    in ('commodity', 'commodities', 'futures')
    or ticker ilike '%=F' then 'commodities'
  when lower(coalesce(payload->>'assetClass', payload->>'asset_class', ''))
    in ('index', 'indexes', 'indices')
    or ticker like '^%' then 'indexes'
  when lower(coalesce(payload->>'assetClass', payload->>'asset_class', ''))
    in ('etf', 'etfs') then 'etfs'
  else 'stocks'
end
where coalesce(asset_class, '') = '';

alter table public.episodes_events
  drop column if exists payload,
  drop column if exists exact_label,
  drop column if exists window_minutes,
  drop column if exists giveback_ratio;
