-- Drop heavy unused columns from unified research.
alter table public.research
  drop column if exists search_results,
  drop column if exists prompt,
  drop column if exists input_facts;
