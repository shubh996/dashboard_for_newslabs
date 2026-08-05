/**
 * Thin Supabase Edge Function: proxies market-close job to the Node API.
 *
 * Secrets (supabase secrets set …):
 *   MARKET_CLOSE_API_URL  e.g. https://your-api.example.com/api/notifications/jobs/market-close
 *   CRON_SECRET           same value as Node CRON_SECRET / MARKET_CLOSE_CRON_SECRET
 *
 * Invoke:
 *   - pg_cron → net.http_post(this function URL)
 *   - external cron → curl -H "Authorization: Bearer $CRON_SECRET" ...
 *   - supabase functions invoke market-close-run
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors })
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET") || Deno.env.get("MARKET_CLOSE_CRON_SECRET") || ""
    const apiUrl = Deno.env.get("MARKET_CLOSE_API_URL") || ""

    if (!apiUrl) {
      return new Response(
        JSON.stringify({ error: "MARKET_CLOSE_API_URL is not set" }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
      )
    }
    if (!cronSecret) {
      return new Response(
        JSON.stringify({ error: "CRON_SECRET is not set" }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
      )
    }

    // Optional: require same secret on the Edge Function itself when called from cron.
    const auth = req.headers.get("Authorization") || ""
    const alt = req.headers.get("x-cron-secret") || ""
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
    // Allow Supabase service role / internal invoke without bearer when header missing
    // but still protect if CRON_SECRET_REQUIRE_ON_EDGE=1
    if (Deno.env.get("CRON_SECRET_REQUIRE_ON_EDGE") === "1") {
      if (bearer !== cronSecret && alt !== cronSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        })
      }
    }

    const url = new URL(req.url)
    const dryRun = url.searchParams.get("dry_run") === "1"
    const target = dryRun
      ? `${apiUrl}${apiUrl.includes("?") ? "&" : "?"}dry_run=1`
      : apiUrl

    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({
        source: "supabase-edge",
        dry_run: dryRun,
      }),
    })

    const text = await upstream.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      /* keep text */
    }

    return new Response(JSON.stringify(body), {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Edge market-close proxy failed",
      }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    )
  }
})
