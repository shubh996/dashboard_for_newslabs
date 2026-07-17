-- Fix Yahoo Finance save timeouts (Postgres 57014 / statement_timeout).
-- Run once in the Supabase SQL editor for this project.

-- 1) GIN on large jsonb makes every upsert rebuild a heavy index → drop it.
drop index if exists public.yahoo_finance_snapshots_data_idx;

-- 2) Optional: slightly higher timeout for this session when testing saves.
-- (Project-wide timeout is set in Dashboard → Database → Settings; free tier is often ~8s.)
-- alter role authenticator set statement_timeout = '15s';
