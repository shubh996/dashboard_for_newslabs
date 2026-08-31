create table if not exists public.perplexity_prompts (
  id text not null,
  label text,
  body text not null default ''::text,
  updated_at timestamptz not null default now(),
  primary key (id)
);
