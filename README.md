# dashboard_for_newslabs

React + TypeScript dashboard for fetching market news from Alpha Vantage, Polygon, Yahoo Finance through the local `yfinance-main` Python package, and NewsAPI. API keys stay in the local backend proxy.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The frontend proxies `/api` requests to the local Express server on port `3001`.

## Environment

Copy `.env.example` to `.env.local` and fill in values. The provider keys are already in `.env.local` on this machine. Add Supabase values before using **Save to Supabase**:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Prefer `SUPABASE_SERVICE_ROLE_KEY` only for this local backend proxy. Do not expose it in a browser bundle.

## Supabase

Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL editor. It creates `public.market_news_articles` with normalized columns and a `raw_json` JSONB column for the full provider payload.

The current SQL allows writes with the publishable key so the local dashboard can save articles immediately. For a production backend, prefer a service-role key on the server and remove the anon write policies.

## Cloudflare Pages

Cloudflare Pages serves the Vite build as a static site, so the local Vite proxy in [`vite.config.ts`](./vite.config.ts) does not run there. This repo includes Pages Functions for the Supabase article routes:

- `GET /api/articles/saved`
- `POST /api/articles/save`
- `PUT /api/articles/saved/:id`
- `DELETE /api/articles/saved/:id`

Add these variables in **Cloudflare Pages > Settings > Environment variables** for Production and Preview:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Use `SUPABASE_ANON_KEY` only if you intentionally want the anon policies in [`supabase/schema.sql`](./supabase/schema.sql) to handle writes. Keep `SUPABASE_SERVICE_ROLE_KEY` only in Cloudflare/server-side environments, never in frontend `VITE_` variables.
