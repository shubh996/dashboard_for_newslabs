-- Add structured Move classification + Confidence on public.research.
-- Populated when Perplexity momentum research completes.
-- Apply: supabase db query --linked -f supabase/add_research_classification_confidence.sql

alter table public.research
  add column if not exists move_classification text,
  add column if not exists confidence text;

comment on column public.research.move_classification is
  'Perplexity “Move classification: …” line (e.g. 60% company-specific, 40% sector/macro).';

comment on column public.research.confidence is
  'Perplexity “Confidence: High|Medium|Low — …” line.';
