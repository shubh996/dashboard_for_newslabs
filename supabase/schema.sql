create extension if not exists pgcrypto;

create table if not exists public.market_news_articles (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_article_id text,
  title text not null,
  summary text,
  url text not null,
  image_url text,
  source_name text,
  author text,
  published_at timestamptz,
  tickers text[] not null default '{}',
  topics text[] not null default '{}',
  sentiment_score numeric,
  sentiment_label text,
  raw_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_news_articles_provider_url_key unique (provider, url),
  constraint market_news_articles_provider_check check (
    provider in ('alpha-vantage', 'finnhub', 'polygon', 'yahoo-finance', 'newsapi')
  )
);

alter table public.market_news_articles
  drop constraint if exists market_news_articles_provider_check;

alter table public.market_news_articles
  add constraint market_news_articles_provider_check check (
    provider in ('alpha-vantage', 'finnhub', 'polygon', 'yahoo-finance', 'newsapi')
  );

create index if not exists market_news_articles_provider_published_idx
  on public.market_news_articles (provider, published_at desc);

create index if not exists market_news_articles_tickers_idx
  on public.market_news_articles using gin (tickers);

create index if not exists market_news_articles_topics_idx
  on public.market_news_articles using gin (topics);

create index if not exists market_news_articles_raw_json_idx
  on public.market_news_articles using gin (raw_json);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_market_news_articles_updated_at on public.market_news_articles;

create trigger set_market_news_articles_updated_at
before update on public.market_news_articles
for each row
execute function public.set_updated_at();

alter table public.market_news_articles enable row level security;

drop policy if exists "Service role can manage market news articles" on public.market_news_articles;
drop policy if exists "Publishable key can read market news articles" on public.market_news_articles;
drop policy if exists "Publishable key can insert market news articles" on public.market_news_articles;
drop policy if exists "Publishable key can update market news articles" on public.market_news_articles;
drop policy if exists "Publishable key can delete market news articles" on public.market_news_articles;

create policy "Service role can manage market news articles"
on public.market_news_articles
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Publishable key can read market news articles"
on public.market_news_articles
for select
to anon
using (true);

create policy "Publishable key can insert market news articles"
on public.market_news_articles
for insert
to anon
with check (true);

create policy "Publishable key can update market news articles"
on public.market_news_articles
for update
to anon
using (true)
with check (true);

create policy "Publishable key can delete market news articles"
on public.market_news_articles
for delete
to anon
using (true);
