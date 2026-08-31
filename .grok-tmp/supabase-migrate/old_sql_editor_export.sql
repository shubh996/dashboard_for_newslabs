-- =============================================================================
-- Run this in OLD Supabase project SQL Editor:
--   https://supabase.com/dashboard/project/xufydubsuztxgsylzxub/sql/new
--
-- How to use:
-- 1. Paste ONE section at a time (or whole file if Editor allows).
-- 2. Click Run.
-- 3. Use "Download CSV" / copy results and send back here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Inventory: schemas + tables + views
-- -----------------------------------------------------------------------------
select n.nspname as schema_name,
       c.relname as object_name,
       case c.relkind
         when 'r' then 'table'
         when 'v' then 'view'
         when 'm' then 'materialized_view'
         when 'p' then 'partitioned_table'
         when 'f' then 'foreign_table'
         else c.relkind::text
       end as object_type
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','v','m','p','f')
  and n.nspname not in ('pg_catalog','information_schema','pg_toast')
order by 1, 3, 2;

-- -----------------------------------------------------------------------------
-- 2) Columns (public + any app schemas)
-- -----------------------------------------------------------------------------
select table_schema,
       table_name,
       ordinal_position,
       column_name,
       data_type,
       udt_name,
       is_nullable,
       column_default,
       character_maximum_length,
       numeric_precision,
       numeric_scale
from information_schema.columns
where table_schema not in ('pg_catalog','information_schema')
order by table_schema, table_name, ordinal_position;

-- -----------------------------------------------------------------------------
-- 3) Primary / unique / foreign keys + check constraints
-- -----------------------------------------------------------------------------
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  kcu.ordinal_position,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  pg_get_constraintdef(pgc.oid) as constraint_def
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
left join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.table_schema = tc.table_schema
join pg_constraint pgc
  on pgc.conname = tc.constraint_name
join pg_namespace n
  on n.oid = pgc.connamespace
 and n.nspname = tc.table_schema
where tc.table_schema not in ('pg_catalog','information_schema')
order by tc.table_schema, tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- -----------------------------------------------------------------------------
-- 4) Indexes
-- -----------------------------------------------------------------------------
select schemaname as schema_name,
       tablename as table_name,
       indexname as index_name,
       indexdef
from pg_indexes
where schemaname not in ('pg_catalog','information_schema')
order by schemaname, tablename, indexname;

-- -----------------------------------------------------------------------------
-- 5) RLS enabled?
-- -----------------------------------------------------------------------------
select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p')
  and n.nspname not in ('pg_catalog','information_schema','pg_toast')
order by 1, 2;

-- -----------------------------------------------------------------------------
-- 6) RLS policies
-- -----------------------------------------------------------------------------
select schemaname as schema_name,
       tablename as table_name,
       policyname,
       permissive,
       roles,
       cmd,
       qual as using_expression,
       with_check as with_check_expression
from pg_policies
order by schemaname, tablename, policyname;

-- -----------------------------------------------------------------------------
-- 7) Functions / procedures (DDL)
-- -----------------------------------------------------------------------------
select n.nspname as schema_name,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid) as function_ddl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog','information_schema','pg_toast')
  and p.prokind in ('f','p') -- function / procedure
order by 1, 2;

-- -----------------------------------------------------------------------------
-- 8) Triggers
-- -----------------------------------------------------------------------------
select
  n.nspname as schema_name,
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid, true) as trigger_ddl
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname not in ('pg_catalog','information_schema','pg_toast')
order by 1, 2, 3;

-- -----------------------------------------------------------------------------
-- 9) Extensions
-- -----------------------------------------------------------------------------
select extname, extversion
from pg_extension
order by 1;

-- -----------------------------------------------------------------------------
-- 10) Sequences (useful for identity / serial)
-- -----------------------------------------------------------------------------
select sequence_schema, sequence_name, data_type, start_value, minimum_value, maximum_value, increment
from information_schema.sequences
where sequence_schema not in ('pg_catalog','information_schema')
order by 1, 2;

-- -----------------------------------------------------------------------------
-- 11) Row counts (approx via stats — fast)
-- -----------------------------------------------------------------------------
select n.nspname as schema_name,
       c.relname as table_name,
       coalesce(s.n_live_tup, 0) as approx_row_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where c.relkind = 'r'
  and n.nspname = 'public'
order by approx_row_count desc, table_name;

-- -----------------------------------------------------------------------------
-- 12) Exact row counts for public tables (slower — run if section 11 looks empty)
-- -----------------------------------------------------------------------------
/*
do $$
declare r record;
begin
  raise notice 'table_name,exact_count';
  for r in
    select quote_ident(schemaname)||'.'||quote_ident(tablename) as fq
    from pg_tables where schemaname = 'public'
  loop
    execute format('select count(*) from %s', r.fq) into r;
  end loop;
end $$;
*/

-- Better exact counts as a result set:
select
  t.relname as table_name,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.relname), false, true, '')))[1]::text::bigint as exact_count
from pg_class t
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relkind = 'r'
order by exact_count desc nulls last, table_name;

-- -----------------------------------------------------------------------------
-- 13) Cron jobs (if pg_cron installed)
-- -----------------------------------------------------------------------------
select jobid, schedule, command, nodename, nodeport, database, username, active, jobname
from cron.job
order by jobid;

-- -----------------------------------------------------------------------------
-- 14) Storage buckets (if storage used)
-- -----------------------------------------------------------------------------
select id, name, public, file_size_limit, allowed_mime_types, created_at
from storage.buckets
order by name;

-- -----------------------------------------------------------------------------
-- 15) Auth users count (no PII dump here)
-- -----------------------------------------------------------------------------
select count(*) as auth_users_count from auth.users;
select count(*) as auth_identities_count from auth.identities;
