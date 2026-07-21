-- Notifications / monitored tickers: store scraped "Notable Price Movement"
-- events (past ~30 days) as date-keyed JSON on each ticker row.
-- Run once in the Supabase SQL editor for this project.

alter table public.device_monitored_tickers
  add column if not exists notable_price_movements jsonb not null default '{}'::jsonb;

comment on column public.device_monitored_tickers.notable_price_movements is
  'Date-keyed notable price movement events from Perplexity finance scrapes. '
  'Shape: { "updated_at": iso, "source_url": string, "events_by_date": { "YYYY-MM-DD": { event_date, price, price_change, summary, reasons[], sources[], source_count, saved_at } } }';

create index if not exists device_monitored_tickers_ticker_idx
  on public.device_monitored_tickers (ticker);
