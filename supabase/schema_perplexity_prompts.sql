-- Editable Perplexity prompt templates (momentum research + market bulletins).
-- Apply in Supabase Dashboard → SQL → New query → Run.
--
-- One row per prompt id. Empty / missing row → server uses built-in default.
-- Server also mirrors to data/perplexity-prompts.json.

create extension if not exists pgcrypto;

create table if not exists public.perplexity_prompts (
  id text primary key,
  label text,
  body text not null default '',
  updated_at timestamptz not null default now()
);

comment on table public.perplexity_prompts is
  'Operator-editable Perplexity prompt templates (momentum research per asset class, reversal override, market bulletins).';

alter table public.perplexity_prompts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'perplexity_prompts'
      and policyname = 'perplexity_prompts_service_all'
  ) then
    create policy perplexity_prompts_service_all
      on public.perplexity_prompts
      for all
      using (true)
      with check (true);
  end if;
end $$;
