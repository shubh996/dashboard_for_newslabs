-- Schedule market-close Edge Function Mon–Fri 16:01 America/New_York.
-- Prerequisites:
--   1. schema_usage_and_jobs.sql applied
--   2. Edge Function `market-close-run` deployed
--   3. Secrets set on Edge Function: MARKET_CLOSE_API_URL, CRON_SECRET
--   4. Extensions: pg_cron, pg_net (usually available on Supabase)

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Replace PROJECT_REF with your Supabase project ref.
-- Replace SERVICE_ROLE_KEY with service_role key (or use a dedicated function JWT).
--
-- Edge URL shape:
--   https://PROJECT_REF.supabase.co/functions/v1/market-close-run

/*
select cron.unschedule(jobid)
from cron.job
where jobname = 'market-close-trigger';

select cron.schedule(
  'market-close-trigger',
  '1 16 * * 1-5',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/market-close-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'SERVICE_ROLE_KEY',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := jsonb_build_object('source', 'pg_cron')
  ) as request_id;
  $$,
  'America/New_York'
);
*/

-- Manual test (after replace):
-- select net.http_post(
--   url := 'https://PROJECT_REF.supabase.co/functions/v1/market-close-run?dry_run=1',
--   headers := jsonb_build_object(
--     'Content-Type', 'application/json',
--     'Authorization', 'Bearer SERVICE_ROLE_KEY',
--     'x-cron-secret', 'YOUR_CRON_SECRET'
--   ),
--   body := '{}'::jsonb
-- );
