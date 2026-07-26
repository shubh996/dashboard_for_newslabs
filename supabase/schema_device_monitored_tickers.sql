-- Notifications / monitored tickers: store scraped "Notable Price Movement"
-- events date-wise under each ticker (append-only for new dates).
-- Run once in the Supabase SQL editor for this project.

alter table public.device_monitored_tickers
  add column if not exists notable_price_movements jsonb not null default '{}'::jsonb;

comment on column public.device_monitored_tickers.notable_price_movements is
  'Per-ticker notable price movements, segregated by date. '
  'Shape v2: { '
  '"version": 2, '
  '"ticker": "AAPL", '
  '"updated_at": iso, '
  '"last_scraped_at": iso, '
  '"source_url": string, '
  '"dates": { '
  '  "YYYY-MM-DD": { '
  '    "event_date", "display_date", "time_label", "price", "price_change", '
  '    "summary", "reasons"[], "sources"[], "source_count", '
  '    "content_fingerprint", "saved_at" '
  '  } '
  '}, '
  '"events_by_date": <same map as dates, for older readers> '
  '}. '
  'Only new (or content-changed) dates are written; existing dates are never bulk-replaced.';

create index if not exists device_monitored_tickers_ticker_idx
  on public.device_monitored_tickers (ticker);
