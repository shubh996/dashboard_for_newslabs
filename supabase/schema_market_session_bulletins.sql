-- Daily multi-market OPEN+CLOSE bulletin rows (Perplexity short body + Yahoo snapshot).
-- One row per (market, slot, session_date).
-- Markets: us | india | china | australia

create table if not exists public.market_session_bulletins (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('us', 'india', 'china', 'australia')),
  slot text not null check (slot in ('OPEN', 'CLOSE')),
  session_date date not null,
  timezone text not null,
  title text not null,
  body text not null,
  body_source text not null default 'perplexity'
    check (body_source in ('perplexity', 'yahoo_fallback')),
  yahoo_market_state text null,
  probe_symbol text null,
  open_price numeric null,
  close_or_last_price numeric null,
  day_change_percent numeric null,
  previous_close numeric null,
  quote_snapshot jsonb null,
  perplexity_meta jsonb null,
  push_sent_ok int not null default 0,
  push_sent_failed int not null default 0,
  recipient_count int not null default 0,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (market, slot, session_date)
);

create index if not exists market_session_bulletins_date_idx
  on public.market_session_bulletins (session_date desc, market, slot);

alter table public.market_session_bulletins enable row level security;

drop policy if exists market_session_bulletins_service_all on public.market_session_bulletins;
create policy market_session_bulletins_service_all
  on public.market_session_bulletins
  for all
  using (true)
  with check (true);

-- Expand market check if table already existed with us/india only.
alter table public.market_session_bulletins
  drop constraint if exists market_session_bulletins_market_check;
alter table public.market_session_bulletins
  add constraint market_session_bulletins_market_check
  check (market in ('us', 'india', 'china', 'australia'));

comment on table public.market_session_bulletins is
  'Trigger market OPEN/CLOSE bulletins (US/India/China/Australia): short Perplexity summary + Yahoo probe snapshot, targeted by subscriber holdings region.';
