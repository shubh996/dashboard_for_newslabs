-- One-shot rename (safe if already renamed).
-- Run in Supabase SQL editor if the live table is still the old name.

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'momentum_research_monitored_stocks'
  ) and not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'momentum_research_stocks'
  ) then
    alter table public.momentum_research_monitored_stocks
      rename to momentum_research_stocks;
  end if;
end $$;

-- Helpful indexes (no-op if they already exist under new names)
create index if not exists momentum_research_stocks_ticker_created_idx
  on public.momentum_research_stocks (ticker, created_at desc);
create index if not exists momentum_research_stocks_created_idx
  on public.momentum_research_stocks (created_at desc);
