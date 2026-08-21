/**
 * Notifications dashboard APIs:
 * - list monitored tickers from device_monitored_tickers
 * - scrape Perplexity finance via Firecrawl for equity "Notable Price Movement"
 * - scrape Trading Economics via Firecrawl for non-equity (commodity / forex / crypto / index)
 * - save ONLY new/changed dates under a ticker-scoped date map:
 *     notable_price_movements.dates["YYYY-MM-DD"] = { event… }
 *
 * Shape (v2):
 * {
 *   version: 2,
 *   ticker: "AAPL",
 *   updated_at, last_scraped_at, source_url,
 *   dates: { "2026-07-21": { event_date, price, summary, sources, saved_at, … } }
 * }
 */

import { load as loadHtml } from 'cheerio'
import {
  classifyAsset,
  resolveTradingEconomicsTarget,
  scrapeTradingEconomicsNotableMovements,
} from './tradingEconomics.js'
import {
  buildMomentumAlertTitle,
  formatDashesToCommas,
  isStockAlertTicker,
  rewriteStockHeadlineToTicker,
  sanitizeStockHeadlineInSummary,
} from './momentum/notifyCopy.js'
import {
  isTestModeEnabled,
  getTestModeAllowlistRecipients,
  ensureAlwaysNotifyRecipients,
  resolvePushRecipients,
  ALWAYS_NOTIFY_DEVICES,
} from './momentum/testMode.js'

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1'
const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
}

function firecrawlKey() {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) {
    throw new Error('Add FIRECRAWL_API_KEY to .env.local')
  }
  return key
}

function normalizeTicker(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    // Keep Yahoo futures (GC=F), forex (EURUSD=X), indexes (^GSPC), class shares (BRK.B)
    .replace(/[^A-Z0-9.^_=\-]/g, '')
}

function perplexityFinanceUrl(ticker) {
  return `https://www.perplexity.ai/finance/${encodeURIComponent(ticker)}`
}

/**
 * Perplexity Agent API — multi-provider models with web_search tool.
 * Model default: perplexity/deepseek-v4-flash-0731
 *
 * Endpoint: POST https://api.perplexity.ai/v1/agent
 * (NOT legacy /chat/completions Sonar-only path)
 *
 * Env: PERPLEXITY_API_KEY, optional PERPLEXITY_MODEL
 */
export async function callPerplexityResearch({
  apiKey,
  model,
  prompt,
  maxTokens = 4096,
}) {
  const resolvedModel =
    String(
      model ||
        process.env.PERPLEXITY_MODEL ||
        'perplexity/deepseek-v4-flash-0731',
    ).trim() || 'perplexity/deepseek-v4-flash-0731'
  const url = 'https://api.perplexity.ai/v1/agent'
  // Keep Agent "instructions" short; full rules live in the user prompt (INSTRUCTIONS → OUTPUT → INPUT).
  const instructions = [
    'Financial market-move research agent.',
    'Use web_search for live catalysts.',
    'Follow the prompt sections in order: INSTRUCTIONS, then OUTPUT format, then INPUT.',
    'Return only the OUTPUT block format. Do not invent facts. British English.',
  ].join(' ')

  const body = {
    model: resolvedModel,
    input: String(prompt || ''),
    instructions,
    tools: [{ type: 'web_search' }],
    max_output_tokens: Math.min(Math.max(Number(maxTokens) || 4096, 256), 8192),
    tool_choice: 'auto',
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `Perplexity Agent API failed (${res.status})`
    const err = new Error(String(message))
    err.status = res.status === 429 ? 429 : res.status || 502
    err.model = resolvedModel
    err.body = data
    err.quota = res.status === 429 || /quota|rate limit/i.test(String(message))
    err.provider = 'perplexity'
    throw err
  }

  // Agent API: output is an array of message / search_results / tool items
  const outputItems = Array.isArray(data?.output) ? data.output : []
  let summary = ''
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    summary = data.output_text.trim()
  } else {
    const parts = []
    for (const item of outputItems) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === 'output_text' && c.text) parts.push(String(c.text))
          else if (typeof c?.text === 'string') parts.push(c.text)
        }
      }
    }
    summary = parts.join('\n').trim()
  }
  summary = String(summary)
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  // Collect web hits from search_results output blocks
  const searchResults = []
  const citations = []
  for (const item of outputItems) {
    if (item?.type === 'search_results' && Array.isArray(item.results)) {
      for (const r of item.results) {
        searchResults.push({
          title: r?.title || null,
          url: r?.url || null,
          source: r?.source || 'web',
          date: r?.date || r?.last_updated || null,
          snippet: r?.snippet ? String(r.snippet).slice(0, 280) : null,
        })
        if (r?.url) citations.push(String(r.url))
      }
    }
  }

  const toolsUsed = Array.isArray(data?.tools)
    ? data.tools.map((t) => ({
        name: t?.type || t?.name || 'tool',
        provider: 'perplexity',
        description:
          t?.type === 'web_search'
            ? 'Agent API web_search tool'
            : t?.type === 'fetch_url'
              ? 'Agent API fetch_url tool'
              : t?.type === 'finance_search'
                ? 'Agent API finance_search tool'
                : `Agent tool: ${t?.type || 'unknown'}`,
      }))
    : [
        {
          name: 'web_search',
          provider: 'perplexity',
          description: 'Agent API web_search tool',
        },
      ]

  const usage = data?.usage || null
  const cost = usage?.cost && typeof usage.cost === 'object' ? usage.cost : null
  const promptTokens = Number(usage?.input_tokens ?? usage?.prompt_tokens)
  const completionTokens = Number(
    usage?.output_tokens ?? usage?.completion_tokens,
  )
  const totalTokens = Number(
    usage?.total_tokens ??
      (Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
        ? promptTokens + completionTokens
        : NaN),
  )
  const totalCost = Number(cost?.total_cost)
  const costUsdDisplay = Number.isFinite(totalCost)
    ? `$${totalCost.toFixed(totalCost < 0.01 ? 6 : 4)}`
    : null

  // Normalize cost field names for UI (Agent uses input_cost / output_cost)
  const costNormalized = cost
    ? {
        input_tokens_cost: cost.input_cost ?? cost.input_tokens_cost ?? null,
        output_tokens_cost: cost.output_cost ?? cost.output_tokens_cost ?? null,
        request_cost: cost.request_cost ?? cost.tool_calls_cost ?? null,
        tool_calls_cost: cost.tool_calls_cost ?? null,
        total_cost: cost.total_cost ?? null,
        currency: cost.currency || 'USD',
        total_cost_display: costUsdDisplay,
      }
    : null

  return {
    summary,
    model: resolvedModel,
    modelVersion: data?.model || resolvedModel,
    requestId: data?.id || null,
    usageMetadata: usage
      ? {
          promptTokenCount: Number.isFinite(promptTokens) ? promptTokens : null,
          candidatesTokenCount: Number.isFinite(completionTokens)
            ? completionTokens
            : null,
          totalTokenCount: Number.isFinite(totalTokens) ? totalTokens : null,
          searchContextSize: usage.search_context_size || null,
        }
      : null,
    usageRaw: {
      ...usage,
      // aliases for UI token cards
      prompt_tokens: Number.isFinite(promptTokens) ? promptTokens : null,
      completion_tokens: Number.isFinite(completionTokens)
        ? completionTokens
        : null,
      total_tokens: Number.isFinite(totalTokens) ? totalTokens : null,
    },
    cost: costNormalized,
    cost_usd_display: costUsdDisplay,
    citations: [...new Set(citations)],
    search_results: searchResults,
    tools: toolsUsed,
    finishReason: data?.status || null,
    provider: 'perplexity',
    use_web_search: true,
    endpoint: url,
    agent_status: data?.status || null,
  }
}

/**
 * Paid-tier USD prices per 1M tokens (approximate public Gemini API rates).
 * Override via GEMINI_PRICE_INPUT_PER_1M / GEMINI_PRICE_OUTPUT_PER_1M.
 * Free-tier traffic is still metered in tokens; cost is estimated at paid rates
 * unless GEMINI_BILLING_TIER=free (then cost is $0).
 */
function geminiPricePerMillion(modelName = '') {
  const envIn = Number(process.env.GEMINI_PRICE_INPUT_PER_1M)
  const envOut = Number(process.env.GEMINI_PRICE_OUTPUT_PER_1M)
  if (Number.isFinite(envIn) && Number.isFinite(envOut) && envIn >= 0 && envOut >= 0) {
    return { input: envIn, output: envOut, source: 'env' }
  }

  const m = String(modelName || '').toLowerCase()
  // Model-specific defaults (USD / 1M tokens). Keep conservative / commonly published rates.
  if (m.includes('3.5-flash-lite') || m.includes('flash-lite-latest')) {
    return { input: 0.3, output: 1.5, source: 'default:flash-lite-3.5' }
  }
  if (m.includes('3.1-flash-lite') || m.includes('3-flash-lite')) {
    return { input: 0.25, output: 1.5, source: 'default:flash-lite-3.1' }
  }
  if (m.includes('2.5-flash-lite') || m.includes('2.0-flash-lite')) {
    return { input: 0.1, output: 0.4, source: 'default:flash-lite-2.5' }
  }
  if (m.includes('flash-lite')) {
    return { input: 0.1, output: 0.4, source: 'default:flash-lite' }
  }
  // gemini-2.5-flash (paid public rates, approx.)
  if (m.includes('2.5-flash') && !m.includes('lite')) {
    return { input: 0.3, output: 2.5, source: 'default:2.5-flash' }
  }
  // gemini-3.5-flash
  if (m.includes('3.5-flash') && !m.includes('lite')) {
    return { input: 0.3, output: 2.5, source: 'default:3.5-flash' }
  }
  if (m.includes('3.6-flash') || m.includes('flash-latest')) {
    return { input: 0.3, output: 2.5, source: 'default:flash' }
  }
  if (m.includes('3-flash') || m.includes('3.1-flash')) {
    return { input: 0.5, output: 3.0, source: 'default:flash-3' }
  }
  if (m.includes('pro')) {
    return { input: 1.25, output: 10.0, source: 'default:pro' }
  }
  return { input: 0.3, output: 2.5, source: 'default:fallback' }
}

/**
 * Build usage + estimated cost from Gemini generateContent usageMetadata.
 */
function buildGeminiUsageReport(usageMetadata, modelName, modelVersion = null) {
  const usage = usageMetadata && typeof usageMetadata === 'object' ? usageMetadata : {}
  const promptTokens = Number(usage.promptTokenCount || 0) || 0
  const candidatesTokens = Number(usage.candidatesTokenCount || 0) || 0
  const thoughtsTokens = Number(usage.thoughtsTokenCount || 0) || 0
  const totalTokens =
    Number(usage.totalTokenCount || 0) || promptTokens + candidatesTokens + thoughtsTokens
  // Thinking tokens (if any) are billed as output on Gemini.
  const outputTokens = candidatesTokens + thoughtsTokens
  const prices = geminiPricePerMillion(modelVersion || modelName)
  const billingTier = String(process.env.GEMINI_BILLING_TIER || 'paid')
    .trim()
    .toLowerCase()
  const isFreeTier = billingTier === 'free' || billingTier === 'free_tier'
  const inputCost = isFreeTier ? 0 : (promptTokens / 1_000_000) * prices.input
  const outputCost = isFreeTier ? 0 : (outputTokens / 1_000_000) * prices.output
  const totalCost = inputCost + outputCost

  const round6 = (n) => Math.round(n * 1e6) / 1e6
  const round8 = (n) => Math.round(n * 1e8) / 1e8

  return {
    model: modelName || null,
    model_version: modelVersion || null,
    service_tier: usage.serviceTier || null,
    billing_tier: isFreeTier ? 'free' : 'paid',
    prompt_tokens: promptTokens,
    candidates_tokens: candidatesTokens,
    thoughts_tokens: thoughtsTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    // "Credits" = total tokens consumed (useful meter when free tier has no $ bill).
    credits_used: totalTokens,
    price_per_1m: {
      input_usd: prices.input,
      output_usd: prices.output,
      source: prices.source,
    },
    cost_usd: {
      input: round8(inputCost),
      output: round8(outputCost),
      total: round8(totalCost),
    },
    cost_usd_total: round8(totalCost),
    cost_usd_display:
      totalCost > 0 && totalCost < 0.000001
        ? `~$${round8(totalCost).toExponential(2)}`
        : `$${round6(totalCost).toFixed(6)}`,
    note: isFreeTier
      ? 'Billing tier free — estimated paid cost set to $0. Tokens still counted as credits.'
      : 'Estimated paid-tier cost from published Gemini rates (override via GEMINI_PRICE_* env).',
  }
}

/** Sum usage reports across generate + retry attempts. */
function mergeGeminiUsageReports(reports, modelName) {
  const list = (reports || []).filter(Boolean)
  if (!list.length) return null
  if (list.length === 1) return { ...list[0], attempts: 1 }

  const sum = (key) => list.reduce((acc, r) => acc + (Number(r[key]) || 0), 0)
  const promptTokens = sum('prompt_tokens')
  const candidatesTokens = sum('candidates_tokens')
  const thoughtsTokens = sum('thoughts_tokens')
  const outputTokens = sum('output_tokens')
  const totalTokens = sum('total_tokens')
  const inputCost = sum('cost_usd') ? list.reduce((a, r) => a + (r.cost_usd?.input || 0), 0) : 0
  const outputCost = list.reduce((a, r) => a + (r.cost_usd?.output || 0), 0)
  const totalCost = list.reduce((a, r) => a + (Number(r.cost_usd_total) || 0), 0)
  const prices = list[0].price_per_1m || geminiPricePerMillion(modelName)
  const round6 = (n) => Math.round(n * 1e6) / 1e6
  const round8 = (n) => Math.round(n * 1e8) / 1e8

  return {
    ...list[list.length - 1],
    model: modelName || list[list.length - 1].model,
    attempts: list.length,
    prompt_tokens: promptTokens,
    candidates_tokens: candidatesTokens,
    thoughts_tokens: thoughtsTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    credits_used: totalTokens,
    price_per_1m: prices,
    cost_usd: {
      input: round8(inputCost),
      output: round8(outputCost),
      total: round8(totalCost),
    },
    cost_usd_total: round8(totalCost),
    cost_usd_display:
      totalCost > 0 && totalCost < 0.000001
        ? `~$${round8(totalCost).toExponential(2)}`
        : `$${round6(totalCost).toFixed(6)}`,
    note: `Combined usage across ${list.length} attempt(s). ${list[0].note || ''}`.trim(),
  }
}

function formatUsdDisplay(totalCost) {
  const n = Number(totalCost) || 0
  const round6 = (v) => Math.round(v * 1e6) / 1e6
  const round8 = (v) => Math.round(v * 1e8) / 1e8
  if (n > 0 && n < 0.000001) return `~$${round8(n).toExponential(2)}`
  return `$${round6(n).toFixed(6)}`
}

/** Pull usage numbers from a Gemini usage report / client override. */
function usageNumbersFromReport(report) {
  if (!report || typeof report !== 'object') return null
  const prompt =
    Number(report.prompt_tokens ?? report.tokens?.prompt ?? 0) || 0
  const thoughts =
    Number(report.thoughts_tokens ?? report.tokens?.thoughts ?? 0) || 0
  const output =
    Number(
      report.output_tokens ??
        report.candidates_tokens ??
        report.tokens?.output ??
        0,
    ) || 0
  const total =
    Number(report.total_tokens ?? report.tokens?.total ?? 0) ||
    prompt + output + thoughts
  const credits = Number(report.credits_used ?? total) || total
  let cost = Number(
    report.cost_usd_total ??
      report.cost_usd ??
      report.cost_usd?.total ??
      0,
  )
  if (!Number.isFinite(cost)) cost = 0
  const display =
    report.cost_usd_display || formatUsdDisplay(cost)
  if (prompt === 0 && output === 0 && total === 0 && cost === 0) {
    // Still allow explicit zero reports only when display present after a real call.
    if (!report.model && !report.model_version && !report.skip_generate) return null
  }
  return {
    prompt_tokens: prompt,
    output_tokens: output,
    thoughts_tokens: thoughts,
    total_tokens: total,
    credits_used: credits,
    cost_usd: Math.round(cost * 1e8) / 1e8,
    cost_usd_display: display,
  }
}

/** Add a usage report onto existing per-date Gemini meters (cumulative). */
function mergeGeminiUsageOntoEvent(existing, usageReport, nowIso) {
  const add = usageNumbersFromReport(usageReport)
  if (!add) {
    return {
      gemini_prompt_tokens: Number(existing?.gemini_prompt_tokens) || 0,
      gemini_output_tokens: Number(existing?.gemini_output_tokens) || 0,
      gemini_thoughts_tokens: Number(existing?.gemini_thoughts_tokens) || 0,
      gemini_total_tokens: Number(existing?.gemini_total_tokens) || 0,
      gemini_credits_used: Number(existing?.gemini_credits_used) || 0,
      gemini_cost_usd: Number(existing?.gemini_cost_usd) || 0,
      gemini_cost_usd_display:
        existing?.gemini_cost_usd_display ||
        formatUsdDisplay(Number(existing?.gemini_cost_usd) || 0),
      gemini_last_prompt_tokens: Number(existing?.gemini_last_prompt_tokens) || 0,
      gemini_last_output_tokens: Number(existing?.gemini_last_output_tokens) || 0,
      gemini_last_total_tokens: Number(existing?.gemini_last_total_tokens) || 0,
      gemini_last_credits_used: Number(existing?.gemini_last_credits_used) || 0,
      gemini_last_cost_usd: Number(existing?.gemini_last_cost_usd) || 0,
      gemini_last_cost_usd_display:
        existing?.gemini_last_cost_usd_display ||
        formatUsdDisplay(Number(existing?.gemini_last_cost_usd) || 0),
      gemini_usage_updated_at: existing?.gemini_usage_updated_at || null,
    }
  }

  const cumPrompt = (Number(existing?.gemini_prompt_tokens) || 0) + add.prompt_tokens
  const cumOutput = (Number(existing?.gemini_output_tokens) || 0) + add.output_tokens
  const cumThoughts =
    (Number(existing?.gemini_thoughts_tokens) || 0) + add.thoughts_tokens
  const cumTotal = (Number(existing?.gemini_total_tokens) || 0) + add.total_tokens
  const cumCredits = (Number(existing?.gemini_credits_used) || 0) + add.credits_used
  const cumCost =
    Math.round(((Number(existing?.gemini_cost_usd) || 0) + add.cost_usd) * 1e8) / 1e8

  return {
    gemini_prompt_tokens: cumPrompt,
    gemini_output_tokens: cumOutput,
    gemini_thoughts_tokens: cumThoughts,
    gemini_total_tokens: cumTotal,
    gemini_credits_used: cumCredits,
    gemini_cost_usd: cumCost,
    gemini_cost_usd_display: formatUsdDisplay(cumCost),
    gemini_last_prompt_tokens: add.prompt_tokens,
    gemini_last_output_tokens: add.output_tokens,
    gemini_last_total_tokens: add.total_tokens,
    gemini_last_credits_used: add.credits_used,
    gemini_last_cost_usd: add.cost_usd,
    gemini_last_cost_usd_display: add.cost_usd_display,
    gemini_usage_updated_at: nowIso || new Date().toISOString(),
  }
}

/** Sum Gemini meters across a dates map or event list. */
function sumGeminiUsageFromDates(datesOrEvents) {
  const list = Array.isArray(datesOrEvents)
    ? datesOrEvents
    : Object.values(datesOrEvents || {})
  let prompt = 0
  let output = 0
  let thoughts = 0
  let total = 0
  let credits = 0
  let cost = 0
  let dated = 0
  for (const event of list) {
    const t = Number(event?.gemini_total_tokens) || 0
    const c = Number(event?.gemini_cost_usd) || 0
    if (t > 0 || c > 0 || event?.gemini_formating || event?.gemini_classified_at) {
      dated += 1
    }
    prompt += Number(event?.gemini_prompt_tokens) || 0
    output += Number(event?.gemini_output_tokens) || 0
    thoughts += Number(event?.gemini_thoughts_tokens) || 0
    total += t
    credits += Number(event?.gemini_credits_used) || 0
    cost += c
  }
  cost = Math.round(cost * 1e8) / 1e8
  return {
    dates_with_gemini: dated,
    prompt_tokens: prompt,
    output_tokens: output,
    thoughts_tokens: thoughts,
    total_tokens: total,
    credits_used: credits,
    cost_usd: cost,
    cost_usd_display: formatUsdDisplay(cost),
  }
}

export function geminiMaxOutputTokens() {
  const raw = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS)
  if (Number.isFinite(raw) && raw >= 256) return Math.min(Math.floor(raw), 8192)
  return 8192
}

function absPercentFromChangeServer(change) {
  const m = String(change || '')
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/)
  if (!m) return 0
  const n = Math.abs(Number(m[0]))
  return Number.isFinite(n) ? n : 0
}

function eventClosePremarketAbs(event) {
  return Math.max(
    absPercentFromChangeServer(event?.price_change || event?.momentum),
    absPercentFromChangeServer(premarketChangeFromEvent(event)),
  )
}

function isoToDateEt(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

async function recordFirecrawlUsage(supabase, {
  ticker = null,
  credits_used = 0,
  remaining_after = null,
  plan_credits = null,
  meta = {},
} = {}) {
  if (!supabase) return null
  const used = Number(credits_used)
  if (!Number.isFinite(used) || used <= 0) return null
  const day = todayIsoEastern()
  const { error } = await supabase.from('usage_daily_ledger').insert({
    day,
    provider: 'firecrawl',
    ticker: ticker || null,
    credits_used: used,
    cost_usd: 0,
    meta: {
      remaining_after,
      plan_credits,
      ...meta,
    },
  })
  if (error) {
    console.warn('[usage_daily_ledger] firecrawl insert failed:', error.message)
    return null
  }
  return { day, credits_used: used }
}

async function recordGeminiUsageLedger(supabase, {
  ticker = null,
  credits_used = 0,
  cost_usd = 0,
  meta = {},
} = {}) {
  if (!supabase) return null
  const credits = Number(credits_used) || 0
  const cost = Number(cost_usd) || 0
  if (credits <= 0 && cost <= 0) return null
  const day = todayIsoEastern()
  const { error } = await supabase.from('usage_daily_ledger').insert({
    day,
    provider: 'gemini',
    ticker: ticker || null,
    credits_used: credits,
    cost_usd: cost,
    meta,
  })
  if (error) {
    console.warn('[usage_daily_ledger] gemini insert failed:', error.message)
    return null
  }
  return { day, credits_used: credits, cost_usd: cost }
}

/**
 * Log one Perplexity research call (tokens as credits_used, real USD in cost_usd).
 * Also appends a local JSON fallback so the dashboard still works if Supabase is down.
 */
export async function recordPerplexityUsageLedger(
  supabase,
  {
    ticker = null,
    credits_used = 0,
    cost_usd = 0,
    total_tokens = 0,
    prompt_tokens = 0,
    completion_tokens = 0,
    meta = {},
  } = {},
) {
  const tokens = Number(total_tokens) || Number(credits_used) || 0
  const cost = Number(cost_usd) || 0
  if (tokens <= 0 && cost <= 0) return null
  const day = todayIsoEastern()
  const row = {
    day,
    provider: 'perplexity',
    ticker: ticker || null,
    credits_used: tokens,
    cost_usd: cost,
    meta: {
      total_tokens: tokens,
      prompt_tokens: Number(prompt_tokens) || 0,
      completion_tokens: Number(completion_tokens) || 0,
      ...meta,
    },
  }

  // Local fallback file (always)
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = path.join(process.cwd(), 'data')
    const file = path.join(dir, 'perplexity-usage-ledger.json')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    let list = []
    if (fs.existsSync(file)) {
      try {
        list = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (!Array.isArray(list)) list = []
      } catch {
        list = []
      }
    }
    list.push({
      ...row,
      created_at: new Date().toISOString(),
    })
    // Cap file size
    if (list.length > 5000) list = list.slice(-5000)
    fs.writeFileSync(file, JSON.stringify(list, null, 0), 'utf8')
  } catch (e) {
    console.warn('[perplexity usage] local ledger write failed:', e?.message || e)
  }

  if (!supabase) return { day, credits_used: tokens, cost_usd: cost, source: 'local' }
  const { error } = await supabase.from('usage_daily_ledger').insert({
    day: row.day,
    provider: 'perplexity',
    ticker: row.ticker,
    credits_used: row.credits_used,
    cost_usd: row.cost_usd,
    meta: row.meta,
  })
  if (error) {
    console.warn('[usage_daily_ledger] perplexity insert failed:', error.message)
    return { day, credits_used: tokens, cost_usd: cost, source: 'local', error: error.message }
  }
  return { day, credits_used: tokens, cost_usd: cost, source: 'supabase' }
}

async function loadPerplexityUsageDaily({ supabase, days = 30 } = {}) {
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(1, days))
  const cutoffDay = cutoff.toISOString().slice(0, 10)
  const byDay = new Map()

  const addRow = (dayRaw, credits, cost, tokens, calls = 1) => {
    const day = String(dayRaw || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < cutoffDay) return
    const prev = byDay.get(day) || {
      day,
      cost_usd: 0,
      credits_used: 0,
      total_tokens: 0,
      calls: 0,
    }
    prev.cost_usd += Number(cost) || 0
    prev.credits_used += Number(credits) || 0
    prev.total_tokens += Number(tokens) || Number(credits) || 0
    prev.calls += calls
    byDay.set(day, prev)
  }

  // 1) Supabase ledger
  if (supabase) {
    try {
      const { data: rows, error } = await supabase
        .from('usage_daily_ledger')
        .select('day, credits_used, cost_usd, meta, created_at')
        .eq('provider', 'perplexity')
        .gte('day', cutoffDay)
        .order('day', { ascending: false })
      if (!error && Array.isArray(rows)) {
        for (const row of rows) {
          const meta = row.meta && typeof row.meta === 'object' ? row.meta : {}
          const tokens =
            Number(meta.total_tokens) || Number(row.credits_used) || 0
          addRow(row.day, row.credits_used, row.cost_usd, tokens, 1)
        }
      }
    } catch (e) {
      console.warn('[perplexity usage] supabase read failed:', e?.message || e)
    }
  }

  // 2) Local file fallback (merge; avoid double-count if same rows — file is source when supabase empty)
  if (byDay.size === 0) {
    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const file = path.join(process.cwd(), 'data', 'perplexity-usage-ledger.json')
      if (fs.existsSync(file)) {
        const list = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (Array.isArray(list)) {
          for (const row of list) {
            const meta = row.meta && typeof row.meta === 'object' ? row.meta : {}
            const tokens =
              Number(meta.total_tokens) || Number(row.credits_used) || 0
            addRow(row.day, row.credits_used, row.cost_usd, tokens, 1)
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 3) Research tables (historical saves)
  if (supabase && byDay.size === 0) {
    const tables = [
      'momentum_research_monitored_stocks',
      'momentum_research_commodities',
      'momentum_research_forex',
      'momentum_research_crypto',
      'momentum_research_indexes',
    ]
    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('created_at, cost_usd, tokens, cost')
          .gte('created_at', `${cutoffDay}T00:00:00.000Z`)
          .order('created_at', { ascending: false })
          .limit(500)
        if (error || !Array.isArray(data)) continue
        for (const row of data) {
          const day = isoToDateEt(row.created_at)
          const cost =
            Number(row.cost_usd) ||
            Number(row.cost?.total_cost) ||
            0
          const tokens =
            Number(row.tokens?.total) ||
            Number(row.tokens?.total_tokens) ||
            0
          addRow(day, tokens, cost, tokens, 1)
        }
      } catch {
        /* table may not exist */
      }
    }
  }

  const daily = [...byDay.values()]
    .map((row) => ({
      day: row.day,
      cost_usd: Math.round(row.cost_usd * 1e8) / 1e8,
      cost_usd_display: formatUsdDisplay(row.cost_usd),
      credits_used: Math.round(row.credits_used),
      total_tokens: Math.round(row.total_tokens),
      calls: row.calls,
    }))
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))

  const total_cost = daily.reduce((s, d) => s + (Number(d.cost_usd) || 0), 0)
  const total_credits = daily.reduce((s, d) => s + (Number(d.credits_used) || 0), 0)
  const total_tokens = daily.reduce((s, d) => s + (Number(d.total_tokens) || 0), 0)
  const total_calls = daily.reduce((s, d) => s + (Number(d.calls) || 0), 0)

  return {
    daily,
    total_cost_usd: Math.round(total_cost * 1e8) / 1e8,
    total_cost_usd_display: formatUsdDisplay(total_cost),
    total_credits,
    total_tokens,
    total_calls,
  }
}

/** Aggregate Gemini spend by ET day from stored notable_price_movements dates. */
function aggregateGeminiSpendByDay(rows, { days = 30 } = {}) {
  const byDay = new Map()
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(1, days))

  for (const row of rows || []) {
    const dates = extractDatesMap(row.notable_price_movements)
    for (const event of Object.values(dates)) {
      const cost = Number(event?.gemini_cost_usd) || 0
      const tokens = Number(event?.gemini_total_tokens) || 0
      const credits = Number(event?.gemini_credits_used) || tokens
      if (cost <= 0 && tokens <= 0 && !event?.gemini_formating) continue
      const day =
        isoToDateEt(event.gemini_usage_updated_at) ||
        isoToDateEt(event.gemini_classified_at) ||
        String(event.event_date || '').slice(0, 10)
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      if (new Date(`${day}T12:00:00Z`) < cutoff) continue
      const prev = byDay.get(day) || {
        day,
        cost_usd: 0,
        total_tokens: 0,
        credits_used: 0,
        calls: 0,
        tickers: new Set(),
      }
      prev.cost_usd += cost
      prev.total_tokens += tokens
      prev.credits_used += credits
      prev.calls += 1
      if (row.ticker) prev.tickers.add(normalizeTicker(row.ticker) || row.ticker)
      byDay.set(day, prev)
    }
  }

  return [...byDay.values()]
    .map((row) => ({
      day: row.day,
      cost_usd: Math.round(row.cost_usd * 1e8) / 1e8,
      cost_usd_display: formatUsdDisplay(row.cost_usd),
      total_tokens: row.total_tokens,
      credits_used: row.credits_used,
      calls: row.calls,
      ticker_count: row.tickers.size,
    }))
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))
}

function assertCronAuth(request) {
  const secret = String(process.env.CRON_SECRET || process.env.MARKET_CLOSE_CRON_SECRET || '').trim()
  if (!secret) {
    const err = new Error('CRON_SECRET is not configured on the server')
    err.status = 503
    throw err
  }
  const header = String(request.headers?.authorization || '').trim()
  const bearer = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''
  const alt = String(request.headers?.['x-cron-secret'] || '').trim()
  if (bearer !== secret && alt !== secret) {
    const err = new Error('Unauthorized cron request')
    err.status = 401
    throw err
  }
}

function mockResCapture() {
  const state = { statusCode: 200, body: null }
  return {
    state,
    status(code) {
      state.statusCode = code
      return this
    },
    json(body) {
      state.body = body
      return this
    },
  }
}

export function structuredReasonHasLikelyDriver(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  if (!/likely\s*driver\s*:/i.test(raw)) return false
  const driver = extractLikelyDriver(raw)
  return Boolean(driver && driver.length >= 12)
}

function isGeminiQuotaError(status, message) {
  const text = String(message || '').toLowerCase()
  return (
    status === 429 ||
    text.includes('quota') ||
    text.includes('rate limit') ||
    text.includes('resource_exhausted') ||
    text.includes('rate_limit') ||
    text.includes('too many requests')
  )
}

/**
 * Capacity / high-demand / temporary overload — switch to next model in cascade.
 * Covers messages like: "This model is currently experiencing high demand..."
 */
function isGeminiCapacityError(status, message) {
  const text = String(message || '').toLowerCase()
  return (
    status === 503 ||
    status === 529 ||
    status === 500 &&
      (text.includes('high demand') ||
        text.includes('overloaded') ||
        text.includes('try again later') ||
        text.includes('temporarily')) ||
    text.includes('high demand') ||
    text.includes('spikes in demand') ||
    text.includes('experiencing high demand') ||
    text.includes('try again later') ||
    text.includes('overloaded') ||
    text.includes('capacity') ||
    text.includes('currently unavailable') ||
    text.includes('service unavailable') ||
    text.includes('temporarily unavailable') ||
    text.includes('deadline exceeded') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('unavailable') ||
    text.includes('server error') ||
    text.includes('internal error') ||
    text.includes('backend error')
  )
}

function isGeminiModelUnavailableError(status, message) {
  const text = String(message || '').toLowerCase()
  return (
    status === 404 ||
    text.includes('not found') ||
    text.includes('is not supported') ||
    text.includes('no longer available') ||
    text.includes('not available to new users') ||
    text.includes('is not found for api version') ||
    text.includes('invalid model')
  )
}

/** True → immediately try the next model in the cascade (do not abort the whole run). */
function shouldSwitchGeminiModel(error) {
  if (!error) return false
  return Boolean(
    error.quota ||
      error.capacity ||
      error.model_unavailable ||
      isGeminiQuotaError(error.status, error.message) ||
      isGeminiCapacityError(error.status, error.message) ||
      isGeminiModelUnavailableError(error.status, error.message),
  )
}

/**
 * Text-generation models — Flash-first cascade (image / TTS / audio / live skipped).
 * Prefer GEMINI_MODEL first, then GEMINI_MODEL_CASCADE (comma-separated), else this order.
 *
 * On high demand / quota / unavailable, callGeminiWithModelCascade walks this list.
 */
function geminiModelCascade(preferred = '') {
  // 3.x Flash + stable aliases. Many 2.0/2.5 ids 404 for new API keys.
  const defaults = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-preview',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-omni-flash-preview',
    'gemini-pro-latest',
  ]
  // Still listed in some docs / env cascades but blocked for new users
  const blocked = new Set([
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash-lite-preview',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash-lite-001',
    'gemini-2.1-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
    'gemini-1.5-pro-latest',
  ])
  const fromEnv = String(process.env.GEMINI_MODEL_CASCADE || '')
    .split(/[,|\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const base = (fromEnv.length ? fromEnv : defaults).filter(
    (m) => m && !blocked.has(m),
  )
  const pref = String(
    preferred || process.env.GEMINI_MODEL || '',
  ).trim()
  const ordered = []
  if (pref && !blocked.has(pref)) ordered.push(pref)
  for (const model of base.length ? base : defaults) {
    if (model && !ordered.includes(model) && !blocked.has(model)) {
      ordered.push(model)
    }
  }
  return ordered.length ? ordered : defaults
}

async function callGeminiGenerateContent({
  apiKey,
  model,
  prompt,
  maxOutputTokens,
  /** When true, enable Google Search grounding (commodity / crypto / FX research). */
  useGoogleSearch = false,
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: useGoogleSearch ? 0.35 : 0.25,
      maxOutputTokens,
    },
  }
  // Google Search grounding (momentum live research + optional commodity flows).
  // Gemini API: tools: [{ google_search: {} }]
  if (useGoogleSearch) {
    body.tools = [{ google_search: {} }]
  }

  const geminiResponse = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })

  const geminiBody = await geminiResponse.json().catch(() => ({}))
  if (!geminiResponse.ok) {
    const message =
      geminiBody?.error?.message ||
      geminiBody?.error ||
      `Gemini request failed (${geminiResponse.status})`
    const err = new Error(String(message))
    err.status = geminiResponse.status === 429 ? 429 : geminiResponse.status || 502
    err.model = model
    err.body = geminiBody
    err.quota = isGeminiQuotaError(geminiResponse.status, message)
    err.capacity = isGeminiCapacityError(geminiResponse.status, message)
    err.model_unavailable = isGeminiModelUnavailableError(
      geminiResponse.status,
      message,
    )
    // Normalize high-demand so cascade always treats it as switchable.
    if (err.capacity && !err.quota) {
      err.status = err.status === 200 ? 503 : err.status
    }
    throw err
  }

  let summary =
    geminiBody?.candidates?.[0]?.content?.parts
      ?.map((part) => String(part?.text || ''))
      .join('')
      .trim() || ''

  summary = summary
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  return {
    summary,
    model,
    usageMetadata: geminiBody?.usageMetadata || null,
    modelVersion: geminiBody?.modelVersion || null,
    finishReason: geminiBody?.candidates?.[0]?.finishReason || null,
  }
}

/**
 * Try models in cascade order.
 * Switch immediately on: free-tier quota, high demand / capacity, missing model.
 * If Google Search hits quota/unavailable, retry the SAME model without search
 * before walking to the next model (search has its own free-tier pool).
 * Same model gets one structure-retry if "Likely driver:" is missing.
 */
async function callGeminiWithModelCascade({
  apiKey,
  models,
  prompt,
  maxOutputTokens,
  useGoogleSearch = false,
  /**
   * When true (momentum research): never fall back to plain generateContent
   * without Google Search. Search grounding is mandatory.
   */
  requireGoogleSearch = false,
}) {
  const usageAttempts = []
  const modelsTried = []
  const modelErrors = []
  let lastError = null
  let usedGoogleSearch = false
  const mustSearch = Boolean(useGoogleSearch && requireGoogleSearch)

  async function generateWithSearchFallback(model, textPrompt) {
    try {
      const result = await callGeminiGenerateContent({
        apiKey,
        model,
        prompt: textPrompt,
        maxOutputTokens,
        useGoogleSearch,
      })
      if (useGoogleSearch) usedGoogleSearch = true
      return result
    } catch (error) {
      // Optional soft path only when search is not required
      if (
        useGoogleSearch &&
        !mustSearch &&
        (error?.quota ||
          error?.status === 429 ||
          error?.model_unavailable ||
          error?.capacity)
      ) {
        modelErrors.push({
          model,
          error: `search: ${error instanceof Error ? error.message : String(error)}`,
          quota: Boolean(error?.quota),
          capacity: Boolean(error?.capacity),
          model_unavailable: Boolean(error?.model_unavailable),
          search_fallback: true,
        })
        const plain = await callGeminiGenerateContent({
          apiKey,
          model,
          prompt: textPrompt,
          maxOutputTokens,
          useGoogleSearch: false,
        })
        return plain
      }
      // Required search failed — do not invent a no-web answer
      if (mustSearch) {
        const msg =
          error instanceof Error ? error.message : String(error)
        const err = new Error(
          /quota|rate|429|exceeded/i.test(msg)
            ? 'Web grounding (Google Search) is unavailable — quota exceeded or rate limited. Momentum research will not run without live web search. Fix billing/quota in Google AI Studio, then try again.'
            : `Web grounding (Google Search) failed: ${msg}. Momentum research will not run without live web search.`,
        )
        err.status = error?.status === 429 || error?.quota ? 429 : error?.status || 503
        err.quota = Boolean(error?.quota || error?.status === 429)
        err.capacity = Boolean(error?.capacity)
        err.model_unavailable = Boolean(error?.model_unavailable)
        err.require_google_search = true
        err.model = model
        throw err
      }
      throw error
    }
  }

  for (const model of models) {
    modelsTried.push(model)
    try {
      const first = await generateWithSearchFallback(model, prompt)
      usageAttempts.push(
        buildGeminiUsageReport(first.usageMetadata, model, first.modelVersion),
      )

      let summary = first.summary
      let finishReason = first.finishReason
      let modelVersion = first.modelVersion
      let structureRetries = 0

      if (!structuredReasonHasLikelyDriver(summary)) {
        structureRetries = 1
        const retryPrompt = [
          prompt,
          '',
          'CRITICAL REVISION:',
          'Your previous answer did not include a valid structured reason.',
          'You MUST output the exact format with these labels on their own lines:',
          'Likely driver: …',
          'Secondary driver: …',
          'Move classification: …',
          'Confidence: …',
          'Do not omit "Likely driver:". Do not invent volume or tap-to-see lines.',
        ].join('\n')

        try {
          const second = await generateWithSearchFallback(model, retryPrompt)
          usageAttempts.push(
            buildGeminiUsageReport(second.usageMetadata, model, second.modelVersion),
          )
          summary = second.summary
          finishReason = second.finishReason
          modelVersion = second.modelVersion || modelVersion
        } catch (retryError) {
          // Quota / high-demand / unavailable on retry → next model.
          lastError = retryError
          modelErrors.push({
            model,
            error: retryError instanceof Error ? retryError.message : String(retryError),
            quota: Boolean(retryError?.quota),
            capacity: Boolean(retryError?.capacity),
            model_unavailable: Boolean(retryError?.model_unavailable),
          })
          if (shouldSwitchGeminiModel(retryError)) {
            continue
          }
          throw retryError
        }
      }

      if (!structuredReasonHasLikelyDriver(summary)) {
        // Try next model for better structured output if this one won't cooperate.
        lastError = new Error(
          `Model ${model} returned output without a valid "Likely driver:" line`,
        )
        lastError.status = 502
        lastError.model = model
        modelErrors.push({
          model,
          error: lastError.message,
          quota: false,
          capacity: false,
          model_unavailable: false,
        })
        continue
      }

      const switched = modelsTried.length > 1
      let switchReason = null
      if (switched) {
        if (modelErrors.some((e) => e.capacity)) switchReason = 'high_demand'
        else if (modelErrors.some((e) => e.quota)) switchReason = 'quota'
        else if (modelErrors.some((e) => e.model_unavailable)) switchReason = 'unavailable'
        else switchReason = 'structure_or_error'
      }
      if (mustSearch && !usedGoogleSearch) {
        const err = new Error(
          'Web grounding (Google Search) did not attach to this run. Momentum research will not return a result without live web search.',
        )
        err.status = 503
        err.require_google_search = true
        throw err
      }

      return {
        summary,
        model,
        modelVersion,
        finishReason,
        structureRetries,
        modelsTried,
        modelErrors,
        usageAttempts,
        use_google_search: usedGoogleSearch,
        model_switched: switched,
        model_switch_from: switched ? modelsTried[0] : null,
        model_switch_to: switched ? model : null,
        model_switch_reason: switchReason,
      }
    } catch (error) {
      lastError = error
      modelErrors.push({
        model,
        error: error instanceof Error ? error.message : String(error),
        quota: Boolean(error?.quota),
        capacity: Boolean(error?.capacity),
        model_unavailable: Boolean(error?.model_unavailable),
      })
      // High demand / quota / model gone → try next model immediately.
      if (shouldSwitchGeminiModel(error)) {
        continue
      }
      // Hard failure on this model (auth, bad request, etc.) — stop cascade.
      error.modelsTried = modelsTried
      error.modelErrors = modelErrors
      error.usageAttempts = usageAttempts
      throw error
    }
  }

  const err =
    lastError ||
    new Error(
      'All Gemini models in the cascade failed (quota, high demand, or unavailable)',
    )
  const anyQuota = modelErrors.some((e) => e.quota)
  const anyCapacity = modelErrors.some((e) => e.capacity)
  err.status =
    lastError?.status === 429 || anyQuota
      ? 429
      : anyCapacity
        ? 503
        : 502
  err.quota = Boolean(lastError?.quota) || anyQuota
  err.capacity = Boolean(lastError?.capacity) || anyCapacity
  err.modelsTried = modelsTried
  err.modelErrors = modelErrors
  err.usageAttempts = usageAttempts
  err.message = [
    err.message,
    modelsTried.length ? `Tried: ${modelsTried.join(' → ')}` : '',
    anyCapacity ? '(high demand / capacity on one or more models)' : '',
  ]
    .filter(Boolean)
    .join(' · ')
  throw err
}

async function firecrawlFetch(path, init = {}) {
  const response = await fetch(`${FIRECRAWL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${firecrawlKey()}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  if (!response.ok) {
    const message =
      body?.error ||
      body?.message ||
      `Firecrawl ${path} failed (${response.status})`
    const error = new Error(message)
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

export async function getFirecrawlCreditUsage() {
  const body = await firecrawlFetch('/team/credit-usage')
  const data = body?.data || body || {}
  const remaining =
    data.remaining_credits ?? data.remainingCredits ?? null
  const plan = data.plan_credits ?? data.planCredits ?? null
  return {
    remaining_credits: remaining,
    plan_credits: plan,
    billing_period_start:
      data.billing_period_start ?? data.billingPeriodStart ?? null,
    billing_period_end:
      data.billing_period_end ?? data.billingPeriodEnd ?? null,
    raw: data,
  }
}

function parseDisplayDateToIso(displayDate, now = new Date()) {
  const match = String(displayDate || '').match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i,
  )
  if (!match) return null
  const monthName = match[1][0].toUpperCase() + match[1].slice(1, 3).toLowerCase()
  const month = MONTHS[monthName]
  const day = Number(match[2])
  if (month == null || !Number.isFinite(day)) return null

  let year = now.getFullYear()
  let candidate = new Date(Date.UTC(year, month, day))
  // If the date is more than ~2 days in the future, it belongs to last year.
  const maxFutureMs = 2 * 24 * 60 * 60 * 1000
  if (candidate.getTime() - now.getTime() > maxFutureMs) {
    year -= 1
    candidate = new Date(Date.UTC(year, month, day))
  }
  const yyyy = candidate.getUTCFullYear()
  const mm = String(candidate.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(candidate.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function titleFromDomain(domain) {
  const host = String(domain || '')
    .replace(/^www\./i, '')
    .trim()
  if (!host) return ''
  const base = host.split('.')[0] || host
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Collect every concrete source we can see in the event block:
 * favicon domains, markdown links, bare https URLs.
 * We never invent sources that are not present in the scraped text.
 */
function extractSources(block) {
  const sources = []
  const seen = new Set()

  function addSource({ domain, url, title }) {
    const cleanDomain = String(domain || '')
      .toLowerCase()
      .replace(/^www\./, '')
      .trim()
    const cleanUrl = String(url || (cleanDomain ? `https://${cleanDomain}` : '')).trim()
    if (!cleanDomain && !cleanUrl) return
    // Not an external news source — skip Perplexity chrome / self links.
    if (cleanDomain === 'perplexity.ai' || /\.perplexity\.ai$/i.test(cleanDomain)) return
    const key = cleanUrl || cleanDomain
    if (seen.has(key) || (cleanDomain && seen.has(cleanDomain))) return
    seen.add(key)
    if (cleanDomain) seen.add(cleanDomain)
    sources.push({
      title: title || titleFromDomain(cleanDomain) || cleanDomain || cleanUrl,
      domain: cleanDomain || null,
      url: cleanUrl || null,
    })
  }

  const text = String(block || '')

  // Google favicon chips: domain=example.com
  const faviconRe = /domain=([a-z0-9.-]+\.[a-z]{2,})/gi
  let match
  while ((match = faviconRe.exec(text)) !== null) {
    addSource({ domain: match[1], url: `https://${match[1]}` })
  }

  // Markdown links [title](url)
  const mdLinkRe = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi
  while ((match = mdLinkRe.exec(text)) !== null) {
    try {
      const u = new URL(match[2])
      if (/google\.com\/s2\/favicons/i.test(u.href)) continue
      if (/perplexity\.ai$/i.test(u.hostname.replace(/^www\./, ''))) continue
      addSource({
        title: match[1]?.trim() || titleFromDomain(u.hostname),
        domain: u.hostname.replace(/^www\./, ''),
        url: u.href,
      })
    } catch {
      // ignore bad urls
    }
  }

  // Bare URLs
  const bareRe = /https?:\/\/[^\s)\]>"']+/gi
  while ((match = bareRe.exec(text)) !== null) {
    try {
      const u = new URL(match[0].replace(/[.,;:]+$/, ''))
      if (/google\.com\/s2\/favicons/i.test(u.href)) continue
      if (/perplexity\.ai$/i.test(u.hostname.replace(/^www\./, ''))) continue
      addSource({
        domain: u.hostname.replace(/^www\./, ''),
        url: u.href,
      })
    } catch {
      // ignore
    }
  }

  return sources
}

/**
 * Infer up/down from the day's narrative. Prefer the opening sentence so a
 * past-week "selloff" mention does not flip a rebound day to negative.
 */
function inferMoveDirection(summary) {
  const text = String(summary || '')
  const head = text.slice(0, 200)

  const downHead =
    /\b(declined|fell|dropped|slid|slipped|tumbled|plunged|retreat(?:ed)?|sold off|closed (?:modestly |slightly |somewhat )?lower|shares fell|is falling|traded lower|moved lower)\b/i.test(
      head,
    )
  const upHead =
    /\b(rose|rising|surged|rallied|gained|climbed|jumped|advanced|rebounded|bounced|edged higher|closed (?:modestly |slightly |somewhat )?higher|shares rose|is rising|traded higher|moved higher|outperformed)\b/i.test(
      head,
    )

  if (downHead && !upHead) return 'down'
  if (upHead && !downHead) return 'up'

  if (
    /\b(shares fell|declined alongside|closed lower|fell roughly|fell over|fell amid|dropped roughly|sold off as)\b/i.test(
      text,
    )
  ) {
    return 'down'
  }
  if (
    /\b(shares rose|surged over|rallied strongly|closed higher|edged higher|is rising|gained nearly|rose modestly|closed modestly higher)\b/i.test(
      text,
    )
  ) {
    return 'up'
  }
  return null
}

/**
 * Perplexity often prints unsigned "2.21%" even on down days.
 * Prefer an explicit +/- from the page; otherwise use visual arrow/color.
 *
 * IMPORTANT: only pass session-specific narrative into `summary` (e.g. close
 * reason for close %). Never sign after-hours / pre-market using the close
 * "fell/rose" sentence — that flips extended-hours moves incorrectly.
 */
function normalizeSignedChange(priceChange, summary, visualDirection = null) {
  if (priceChange == null || priceChange === '') return null
  const raw = String(priceChange).trim().replace(/^−/, '-')
  const numeric = raw.replace(/^[+\-]/, '').trim()
  if (!numeric) return raw

  // The finance page's arrow/color is authoritative for that session.
  if (visualDirection === 'down') return `-${numeric}`
  if (visualDirection === 'up') return `+${numeric}`

  if (raw.startsWith('-')) return `-${numeric}`
  if (raw.startsWith('+')) return `+${numeric}`

  // Optional: only when caller passed a session-appropriate narrative.
  if (summary) {
    const direction = inferMoveDirection(summary)
    if (direction === 'down') return `-${numeric}`
    if (direction === 'up') return `+${numeric}`
  }
  // Ambiguous / flat — keep unsigned rather than inventing a sign
  return numeric
}

/**
 * Firecrawl markdown omits Perplexity's finance arrow and color, leaving an
 * unsigned percentage. The HTML retains both:
 * - text-finance-positive / -rotate-45 → up
 * - text-finance-negative / rotate-45 → down
 */
export function extractMovementDirectionsFromHtml(html, now = new Date()) {
  const source = String(html || '')
  if (!source) return {}

  const headingIndex = source.toLowerCase().indexOf('notable price movement')
  if (headingIndex < 0) return {}
  const openingHeadingIndex = source.lastIndexOf('<h2', headingIndex)
  const sectionStart = openingHeadingIndex >= 0 ? openingHeadingIndex : headingIndex
  const nextHeadingIndex = source.toLowerCase().indexOf('<h2', headingIndex + 24)
  const sectionHtml = source.slice(
    sectionStart,
    nextHeadingIndex > headingIndex ? nextHeadingIndex : sectionStart + 250_000,
  )
  const $ = loadHtml(sectionHtml)
  const directions = {}

  $('div.contents').each((_, element) => {
    const row = $(element)
    const dateText = row
      .find('*')
      .toArray()
      .map((child) => $(child).text().trim())
      .find((text) =>
        /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/i.test(
          text,
        ),
      )
    if (!dateText) return
    const eventDate = parseDisplayDateToIso(dateText, now)
    if (!eventDate) return

    const indicators = row.find(
      '[class*="text-finance-positive"], [class*="text-finance-negative"]',
    )
    indicators.each((__, indicatorElement) => {
      const indicator = $(indicatorElement)
      const indicatorText = indicator.text().replace(/\s+/g, ' ').trim()
      if (!/\d+(?:\.\d+)?%/.test(indicatorText)) return

      const className = String(indicator.attr('class') || '')
      const svgClass = String(indicator.find('svg').first().attr('class') || '')
      let direction = null
      if (/text-finance-negative/i.test(className)) direction = 'down'
      else if (/text-finance-positive/i.test(className)) direction = 'up'
      else if (/(?:^|\s)-rotate-45(?:\s|$)/.test(svgClass)) direction = 'up'
      else if (/(?:^|\s)rotate-45(?:\s|$)/.test(svgClass)) direction = 'down'
      if (!direction) return

      let market = 'regular'
      if (/pre[\s-]?market/i.test(indicatorText)) market = 'premarket'
      else if (/after[\s-]?hours?/i.test(indicatorText)) market = 'after_hours'
      else if (/\bat\s*close\b/i.test(indicatorText)) market = 'regular'
      directions[eventDate] = {
        ...(directions[eventDate] || {}),
        [market]: direction,
      }
    })
  })

  return directions
}

function premarketChangeFromEvent(event) {
  return (
    event?.premarket_change ??
    event?.pre_market_change ??
    event?.premarket_price_change ??
    event?.pre_market_price_change ??
    event?.premarket_change_percent ??
    event?.pre_market_change_percent ??
    event?.preMarketChangePercent ??
    event?.preMarketChange ??
    event?.premarket_movement ??
    null
  )
}

function afterHoursChangeFromEvent(event) {
  return (
    event?.after_hours_change ??
    event?.afterhours_change ??
    event?.after_hours_price_change ??
    event?.after_hours_change_percent ??
    event?.afterHoursChange ??
    event?.afterHoursChangePercent ??
    event?.postmarket_change ??
    event?.post_market_change ??
    null
  )
}

function afterHoursPriceFromEvent(event) {
  return (
    event?.after_hours_price ??
    event?.afterhours_price ??
    event?.afterHoursPrice ??
    event?.postmarket_price ??
    event?.post_market_price ??
    null
  )
}

/**
 * Reason / summary should explain WHY the stock moved — never restate the
 * session move % (that already lives on price_change / premarket_change).
 * Strip leading metric residue Firecrawl often leaves in the narrative blob.
 */
function stripRedundantMovePercentFromReason(summary, changes = {}) {
  let text = String(summary || '').replace(/\s+/g, ' ').trim()
  if (!text) return text

  const normalizePct = (value) => {
    if (value == null || value === '') return null
    const match = String(value)
      .replace(/,/g, '')
      .replace(/^−/, '-')
      .match(/[+\-]?\d+(?:\.\d+)?/)
    if (!match) return null
    return match[0].replace(/^\+/, '').replace(/^-/, '')
  }

  const known = new Set(
    [changes.priceChange, changes.premarketChange, changes.afterHoursChange]
      .map(normalizePct)
      .filter(Boolean),
  )

  // Drop pure "6.03%" / "6.03% at Close" heads (repeat until clean).
  let guard = 0
  while (guard < 6) {
    guard += 1
    const lead = text.match(
      /^([+\-−]?\d+(?:\.\d+)?)%\s*(?:(?:at\s*)?close|after[\s-]?hours?|(?:in\s+)?pre[\s-]?market)?\s*[:·–—,\|\-]*\s*/i,
    )
    if (!lead) break
    const n = normalizePct(lead[1])
    const hasSessionLabel = /(?:close|after|pre)/i.test(lead[0])
    // Always strip when it matches the event move, or when it's clearly a
    // session metric header (with label). Bare unknown % at start of a
    // longer sentence is left alone only if not in known moves.
    if (n && (known.has(n) || hasSessionLabel || known.size === 0)) {
      // If known is empty and no session label, only strip when the entire
      // remainder would be empty or starts with a separator — otherwise a
      // real sentence starting with "50% of revenue…" stays.
      if (!known.has(n) && !hasSessionLabel) {
        const rest = text.slice(lead[0].length).trim()
        if (rest && !/^[:·–—,\|\-]/.test(rest)) break
      }
      text = text.slice(lead[0].length).trim()
      continue
    }
    break
  }

  // If the whole "reason" is just the move % itself, clear it.
  const onlyPct = text.match(/^([+\-−]?\d+(?:\.\d+)?)%\s*$/)
  if (onlyPct) {
    const n = normalizePct(onlyPct[1])
    if (n && (known.has(n) || known.size === 0)) return ''
  }

  return text
}

/**
 * Remove URLs / publisher chips that leaked into the reason narrative after
 * they were already captured in `sources[]`.
 */
function stripSourceLeakageFromReason(summary, sources = []) {
  let text = String(summary || '').replace(/\s+/g, ' ').trim()
  if (!text) return text

  // Drop bare URLs and markdown links from the narrative.
  text = text
    .replace(/\[([^\]]*)\]\(https?:\/\/[^)\s]+\)/gi, ' ')
    .replace(/https?:\/\/[^\s)\]>"']+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  for (const source of Array.isArray(sources) ? sources : []) {
    const domain = String(source?.domain || '')
      .replace(/^www\./i, '')
      .trim()
    const title = String(source?.title || '').trim()
    if (domain) {
      const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      text = text
        .replace(new RegExp(`\\b(?:https?:\\/\\/)?(?:www\\.)?${escaped}\\b`, 'gi'), ' ')
        .trim()
    }
    // Only strip exact trailing/standalone publisher titles (avoid eating words
    // like "Apple" mid-sentence when a source is titled that way).
    if (title && title.length >= 3 && title.length <= 48 && !/\s{2,}/.test(title)) {
      const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      text = text
        .replace(new RegExp(`(?:^|[\\s·|,;—-])${escapedTitle}(?=$|[\\s·|,;—-])`, 'gi'), ' ')
        .trim()
    }
  }

  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s,·|:—-]+|[\s,·|:—-]+$/g, '')
    .trim()
}

/**
 * True when a scrape line is only a session metric (price move), not narrative.
 */
function isSessionMetricOnlyLine(line) {
  const t = String(line || '').trim()
  if (!t) return false
  if (/^[+\-−]?\d+(?:\.\d+)?%\s*$/.test(t)) return true
  if (
    /^[+\-−]?\d+(?:\.\d+)?%\s*(?:at\s*close|after[\s-]?hours?|(?:in\s+)?pre[\s-]?market)\s*[:·–—-]*\s*$/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /^(?:at\s*close|after[\s-]?hours?|pre[\s-]?market)(?:\s+(?:movement|change|trading))?\s*[:·–—-]?\s*[+\-−]?\d+(?:\.\d+)?%\s*$/i.test(
      t,
    )
  ) {
    return true
  }
  if (
    /^(?:at\s*close|after[\s-]?hours?|pre[\s-]?market)(?:\s+(?:movement|change|trading))?\s*[:·–—-]?\s*$/i.test(
      t,
    )
  ) {
    return true
  }
  return false
}

/**
 * Pull close + after-hours (and pre-market) price/% pairs from a Perplexity event chunk.
 * Example markdown:
 *   $1,288.03
 *   6.03% at Close
 *   ·
 *   $1,311.97
 *   1.86% After Hours
 */
function extractSessionQuotesFromChunk(chunkText) {
  const text = String(chunkText || '')
  const result = {
    close_price: null,
    close_change: null,
    after_hours_price: null,
    after_hours_change: null,
    premarket_change: null,
  }

  // "$1,288.03 … 6.03% at Close" (price may be on previous line)
  const closeBlock = text.match(
    /(\$[\d,]+(?:\.\d+)?)\s*[\n\r\s·|–—-]*([+\-−]?\d+(?:\.\d+)?%)\s*at\s*close\b/i,
  )
  if (closeBlock) {
    result.close_price = closeBlock[1]
    result.close_change = closeBlock[2].replace(/^−/, '-')
  } else {
    const closePct = text.match(/([+\-−]?\d+(?:\.\d+)?%)\s*at\s*close\b/i)
    if (closePct) result.close_change = closePct[1].replace(/^−/, '-')
  }

  const afterBlock = text.match(
    /(\$[\d,]+(?:\.\d+)?)\s*[\n\r\s·|–—-]*([+\-−]?\d+(?:\.\d+)?%)\s*after[\s-]?hours?\b/i,
  )
  if (afterBlock) {
    result.after_hours_price = afterBlock[1]
    result.after_hours_change = afterBlock[2].replace(/^−/, '-')
  } else {
    const afterPct = text.match(/([+\-−]?\d+(?:\.\d+)?%)\s*after[\s-]?hours?\b/i)
    if (afterPct) result.after_hours_change = afterPct[1].replace(/^−/, '-')
  }

  const preBlock = text.match(
    /([+\-−]?\d+(?:\.\d+)?%)\s*(?:in\s+)?pre[\s-]?market\b/i,
  )
  if (preBlock) result.premarket_change = preBlock[1].replace(/^−/, '-')

  // If labels are missing, keep first $ + first % as close, second pair as after-hours
  // when the chunk clearly has two price lines.
  if (!result.close_price || !result.after_hours_price) {
    const prices = [...text.matchAll(/\$[\d,]+(?:\.\d+)?/g)].map((m) => m[0])
    const pcts = [...text.matchAll(/(?:^|[\s·|])([+\-−]?\d+(?:\.\d+)%)(?=\s|$)/gm)].map(
      (m) => m[1].replace(/^−/, '-'),
    )
    if (!result.close_price && prices[0]) result.close_price = prices[0]
    if (!result.after_hours_price && prices[1]) result.after_hours_price = prices[1]
    // Only fill bare percents when session labels were not found.
    if (!result.close_change && !result.after_hours_change && !result.premarket_change) {
      if (pcts[0]) result.close_change = pcts[0]
      if (pcts[1]) result.after_hours_change = pcts[1]
    }
  }

  return result
}

function premarketReasonFromEvent(event) {
  const value =
    event?.premarket_reason ??
    event?.pre_market_reason ??
    event?.premarket_summary ??
    event?.pre_market_summary ??
    event?.premarket_reasons ??
    event?.pre_market_reasons ??
    null
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean).join(' ')
  }
  return value == null ? '' : String(value).trim()
}

function eventContentFingerprint(event) {
  const sources = Array.isArray(event?.sources)
    ? event.sources
        .map((s) => `${s?.domain || ''}|${s?.url || ''}|${s?.title || ''}`)
        .sort()
        .join(';')
    : ''
  const reasons = Array.isArray(event?.reasons) ? event.reasons.join('|') : ''
  return JSON.stringify({
    event_date: event?.event_date || '',
    time_label: String(event?.time_label || '').trim(),
    price: event?.price || '',
    price_change: event?.price_change || event?.momentum || '',
    direction: event?.direction || '',
    premarket_change: premarketChangeFromEvent(event) || '',
    premarket_direction: event?.premarket_direction || '',
    premarket_reason: premarketReasonFromEvent(event),
    after_hours_price: afterHoursPriceFromEvent(event) || '',
    after_hours_change: afterHoursChangeFromEvent(event) || '',
    after_hours_direction: event?.after_hours_direction || '',
    summary: (event?.summary || '').trim(),
    reasons,
    sources,
  })
}

/** Today's calendar date in US/Eastern (Perplexity labels use ET). */
function todayIsoEastern(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Normalize scrape time labels like "9:46 AM ET" → minutes from midnight,
 * or a compact uppercased string if unparseable.
 */
function normalizeTimeLabelMinutes(label) {
  if (label == null) return null
  const s = String(label).trim()
  if (!s) return null
  const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return s.toUpperCase().replace(/\s+/g, ' ')
  let hours = Number(m[1])
  const minutes = Number(m[2])
  const ap = m[3].toUpperCase()
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (ap === 'PM' && hours < 12) hours += 12
  if (ap === 'AM' && hours === 12) hours = 0
  return hours * 60 + minutes
}

/**
 * Compare two time labels.
 * @returns {boolean|null} true if different, false if same, null if cannot compare
 */
function timeLabelsDiffer(a, b) {
  const na = normalizeTimeLabelMinutes(a)
  const nb = normalizeTimeLabelMinutes(b)
  if (na == null || nb == null) return null
  return na !== nb
}

/** Gemini meter fields to preserve when keeping a stored row. */
function pickStoredGeminiFields(previous, row = {}) {
  return {
    gemini_formating: Boolean(
      previous?.gemini_formating ||
        row?.gemini_formating ||
        previous?.gemini_classified_at ||
        row?.gemini_classified_at ||
        /likely\s*driver\s*:/i.test(String(previous?.summary || row?.summary || '')),
    ),
    gemini_classified_at:
      previous?.gemini_classified_at || row?.gemini_classified_at || null,
    gemini_model: previous?.gemini_model || row?.gemini_model || null,
    gemini_prompt_tokens:
      Number(previous?.gemini_prompt_tokens) || Number(row?.gemini_prompt_tokens) || 0,
    gemini_output_tokens:
      Number(previous?.gemini_output_tokens) || Number(row?.gemini_output_tokens) || 0,
    gemini_thoughts_tokens:
      Number(previous?.gemini_thoughts_tokens) || Number(row?.gemini_thoughts_tokens) || 0,
    gemini_total_tokens:
      Number(previous?.gemini_total_tokens) || Number(row?.gemini_total_tokens) || 0,
    gemini_credits_used:
      Number(previous?.gemini_credits_used) || Number(row?.gemini_credits_used) || 0,
    gemini_cost_usd:
      Number(previous?.gemini_cost_usd) || Number(row?.gemini_cost_usd) || 0,
    gemini_cost_usd_display:
      previous?.gemini_cost_usd_display ||
      row?.gemini_cost_usd_display ||
      formatUsdDisplay(
        Number(previous?.gemini_cost_usd) || Number(row?.gemini_cost_usd) || 0,
      ),
    gemini_last_prompt_tokens:
      Number(previous?.gemini_last_prompt_tokens) ||
      Number(row?.gemini_last_prompt_tokens) ||
      0,
    gemini_last_output_tokens:
      Number(previous?.gemini_last_output_tokens) ||
      Number(row?.gemini_last_output_tokens) ||
      0,
    gemini_last_total_tokens:
      Number(previous?.gemini_last_total_tokens) ||
      Number(row?.gemini_last_total_tokens) ||
      0,
    gemini_last_credits_used:
      Number(previous?.gemini_last_credits_used) ||
      Number(row?.gemini_last_credits_used) ||
      0,
    gemini_last_cost_usd:
      Number(previous?.gemini_last_cost_usd) || Number(row?.gemini_last_cost_usd) || 0,
    gemini_last_cost_usd_display:
      previous?.gemini_last_cost_usd_display ||
      row?.gemini_last_cost_usd_display ||
      null,
    gemini_usage_updated_at:
      previous?.gemini_usage_updated_at || row?.gemini_usage_updated_at || null,
  }
}

/**
 * Normalize any historical shape of notable_price_movements into a flat
 * date → event map. Supports:
 *   v2: { dates: { "YYYY-MM-DD": event } }
 *   v1: { events_by_date: { … } }
 *   legacy: { "YYYY-MM-DD": event, … }
 */

/**
 * Score a stored event for merge conflicts (multiple device rows / re-scrapes).
 * Higher = richer / more trustworthy for timeline display.
 */
function eventRichnessScore(event) {
  if (!event || typeof event !== 'object') return -1
  let score = 0
  const summary = String(event.summary || '').trim()
  if (event.gemini_formating || event.gemini_classified_at) score += 1000
  if (/likely\s*driver\s*:/i.test(summary)) score += 400
  if (summary.length > 40) score += Math.min(200, summary.length)
  if (event.price) score += 20
  if (event.price_change || event.momentum) score += 20
  if (premarketChangeFromEvent(event)) score += 15
  if (afterHoursChangeFromEvent(event) || afterHoursPriceFromEvent(event)) score += 15
  if (Array.isArray(event.sources) && event.sources.length) score += 10 + event.sources.length
  if (event.time_label) score += 5
  if (event.saved_at) score += 1
  const savedAt = Date.parse(String(event.saved_at || event.gemini_usage_updated_at || '')) || 0
  score += Math.min(50, Math.floor(savedAt / 1e11))
  return score
}

/**
 * When two rows claim the same event_date, keep the richer one (Gemini +
 * complete metrics beat a bare scrape stub). Never blindly last-write-wins.
 */
function preferRicherEvent(current, incoming) {
  if (!current) return incoming
  if (!incoming) return current
  const a = eventRichnessScore(current)
  const b = eventRichnessScore(incoming)
  if (b > a) return incoming
  if (a > b) return current
  const aAt = String(current.saved_at || '')
  const bAt = String(incoming.saved_at || '')
  return bAt > aAt ? incoming : current
}

/** Merge date maps without clobbering richer Gemini/full events. */
function mergeDateMaps(base, extra) {
  const out = { ...(base || {}) }
  for (const [date, event] of Object.entries(extra || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    out[date] = preferRicherEvent(out[date], event)
  }
  return out
}

function extractDatesMap(notable) {
  if (!notable || typeof notable !== 'object' || Array.isArray(notable)) return {}

  if (notable.dates && typeof notable.dates === 'object' && !Array.isArray(notable.dates)) {
    return Object.fromEntries(
      Object.entries(notable.dates).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)),
    )
  }

  if (
    notable.events_by_date &&
    typeof notable.events_by_date === 'object' &&
    !Array.isArray(notable.events_by_date)
  ) {
    return Object.fromEntries(
      Object.entries(notable.events_by_date).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)),
    )
  }

  return Object.fromEntries(
    Object.entries(notable).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)),
  )
}

function normalizeEventRow(event) {
  const eventDate = String(event?.event_date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null

  const sources = Array.isArray(event?.sources) ? event.sources : []
  const reasons = Array.isArray(event?.reasons)
    ? event.reasons
    : event?.summary
      ? [event.summary]
      : []
  const premarketChange = premarketChangeFromEvent(event)
  const premarketReason = premarketReasonFromEvent(event)
  const afterHoursChange = afterHoursChangeFromEvent(event)
  const afterHoursPrice = afterHoursPriceFromEvent(event)

  return {
    event_date: eventDate,
    display_date: event?.display_date || null,
    time_label: event?.time_label || null,
    price: event?.price || null,
    price_change: event?.price_change || event?.momentum || null,
    momentum: event?.momentum || event?.price_change || null,
    direction: event?.direction || null,
    premarket_change: premarketChange,
    premarket_direction: event?.premarket_direction || null,
    premarket_reason: premarketReason,
    after_hours_price: afterHoursPrice,
    after_hours_change: afterHoursChange,
    after_hours_direction: event?.after_hours_direction || null,
    summary: event?.summary || '',
    original_summary: event?.original_summary || null,
    reasons,
    sources,
    source_count: sources.length,
    claimed_source_count: event?.claimed_source_count ?? null,
    gemini_classified_at: event?.gemini_classified_at || null,
    gemini_model: event?.gemini_model || null,
    /** True when this date's reason was produced/confirmed via Gemini formatting. */
    gemini_formating: Boolean(
      event?.gemini_formating ||
        event?.gemini_classified_at ||
        /likely\s*driver\s*:/i.test(String(event?.summary || '')),
    ),
    // Cumulative Gemini meter for this date (persisted in notable_price_movements JSON).
    gemini_prompt_tokens: Number(event?.gemini_prompt_tokens) || 0,
    gemini_output_tokens: Number(event?.gemini_output_tokens) || 0,
    gemini_thoughts_tokens: Number(event?.gemini_thoughts_tokens) || 0,
    gemini_total_tokens: Number(event?.gemini_total_tokens) || 0,
    gemini_credits_used: Number(event?.gemini_credits_used) || 0,
    gemini_cost_usd: Number(event?.gemini_cost_usd) || 0,
    gemini_cost_usd_display:
      event?.gemini_cost_usd_display ||
      formatUsdDisplay(Number(event?.gemini_cost_usd) || 0),
    // Last single generate call (for tag brackets).
    gemini_last_prompt_tokens: Number(event?.gemini_last_prompt_tokens) || 0,
    gemini_last_output_tokens: Number(event?.gemini_last_output_tokens) || 0,
    gemini_last_total_tokens: Number(event?.gemini_last_total_tokens) || 0,
    gemini_last_credits_used: Number(event?.gemini_last_credits_used) || 0,
    gemini_last_cost_usd: Number(event?.gemini_last_cost_usd) || 0,
    gemini_last_cost_usd_display:
      event?.gemini_last_cost_usd_display ||
      formatUsdDisplay(Number(event?.gemini_last_cost_usd) || 0),
    gemini_usage_updated_at: event?.gemini_usage_updated_at || null,
    content_fingerprint: eventContentFingerprint({
      event_date: eventDate,
      price: event?.price || null,
      price_change: event?.price_change || event?.momentum || null,
      direction: event?.direction || null,
      premarket_change: premarketChange,
      premarket_direction: event?.premarket_direction || null,
      premarket_reason: premarketReason,
      after_hours_price: afterHoursPrice,
      after_hours_change: afterHoursChange,
      after_hours_direction: event?.after_hours_direction || null,
      summary: event?.summary || '',
      reasons,
      sources,
    }),
  }
}

/**
 * True when Supabase already holds a Gemini-structured reason for this date.
 * Those must never be wiped by a later Perplexity re-fetch (except today when
 * the story timestamp actually moved — see markChanged).
 */
function hasStoredGeminiReason(event) {
  if (!event || typeof event !== 'object') return false
  if (event.gemini_formating || event.gemini_classified_at) return true
  return /likely\s*driver\s*:/i.test(String(event.summary || ''))
}

/**
 * Classify scraped events against already-saved dates for a ticker.
 * status: "new" | "changed" | "saved"
 *
 * Intended product flow:
 *  1) Fetch Perplexity → save new/changed to Supabase
 *  2) Gemini on selected dates → summary becomes Gemini version (kept forever)
 *  3) Re-open dashboard → timeline is always Supabase (Gemini where done)
 *  4) Re-fetch never overwrites past Gemini dates
 *  5) Today only may refresh from Perplexity when time/content actually moved
 *
 * Rules (date + time, ET calendar):
 *  - Missing date in DB → new
 *  - Older than today (already in DB) → always saved (keep Supabase / Gemini)
 *  - Today + Gemini already done + same time_label → saved (keep Gemini)
 *  - Today + different time_label (or content) → changed (fresh Perplexity;
 *    Gemini tag cleared until re-run)
 */
function classifyEventsAgainstSaved(events, existingDates) {
  const saved = existingDates && typeof existingDates === 'object' ? existingDates : {}
  let newCount = 0
  let changedCount = 0
  let savedCount = 0
  const today = todayIsoEastern()

  const keepStored = (raw, row, previous, extra = {}) => {
    savedCount += 1
    const hadGemini = hasStoredGeminiReason(previous)
    // Metrics: fill holes from scrape, but never drop stored values.
    // Reason: if Gemini already ran, Supabase Gemini text always wins.
    return {
      ...raw,
      ...row,
      // Start from previous (DB) so scrape cannot clobber stored fields by default.
      ...previous,
      // Session metrics: prefer stored, fall back to fresh scrape if missing.
      time_label: previous.time_label || row.time_label || null,
      display_date: previous.display_date || row.display_date || null,
      price: previous.price || row.price || null,
      price_change:
        previous.price_change || previous.momentum || row.price_change || row.momentum || null,
      momentum:
        previous.momentum || previous.price_change || row.momentum || row.price_change || null,
      direction: previous.direction || row.direction || null,
      premarket_change:
        premarketChangeFromEvent(previous) || premarketChangeFromEvent(row) || null,
      premarket_direction:
        previous.premarket_direction || row.premarket_direction || null,
      premarket_reason:
        premarketReasonFromEvent(previous) || premarketReasonFromEvent(row) || '',
      after_hours_price:
        afterHoursPriceFromEvent(previous) || afterHoursPriceFromEvent(row) || null,
      after_hours_change:
        afterHoursChangeFromEvent(previous) || afterHoursChangeFromEvent(row) || null,
      after_hours_direction:
        previous.after_hours_direction || row.after_hours_direction || null,
      sources:
        Array.isArray(previous.sources) && previous.sources.length
          ? previous.sources
          : Array.isArray(row.sources)
            ? row.sources
            : [],
      // Reason body: Gemini (or any stored summary) wins over Perplexity re-scrape.
      summary: hadGemini
        ? previous.summary || row.summary || ''
        : previous.summary || row.summary || '',
      original_summary:
        previous.original_summary ||
        (!hadGemini ? previous.summary : null) ||
        row.original_summary ||
        null,
      reasons:
        Array.isArray(previous.reasons) && previous.reasons.length
          ? previous.reasons
          : previous.summary
            ? [previous.summary]
            : Array.isArray(row.reasons) && row.reasons.length
              ? row.reasons
              : row.summary
                ? [row.summary]
                : [],
      ...pickStoredGeminiFields(previous, row),
      save_status: 'saved',
      previously_saved_at: previous.saved_at || null,
      ...extra,
    }
  }

  const markChanged = (raw, row, previous, reason) => {
    changedCount += 1
    // Today only: accept fresh Perplexity narrative. Preserve first scrape text
    // in original_summary so Gemini can re-run from the raw move reason later.
    const priorOriginal =
      previous.original_summary ||
      (!hasStoredGeminiReason(previous) ? previous.summary : null) ||
      row.original_summary ||
      null
    return {
      ...raw,
      ...row,
      original_summary: priorOriginal,
      // Fresh scrape body until Gemini is re-run for this new timestamp.
      summary: row.summary || '',
      reasons:
        Array.isArray(row.reasons) && row.reasons.length
          ? row.reasons
          : row.summary
            ? [row.summary]
            : [],
      // Clear Gemini tag — content moved; needs a new Gemini pass.
      gemini_formating: false,
      gemini_classified_at: null,
      // Keep cumulative usage meters from previous (spend history).
      gemini_prompt_tokens: Number(previous?.gemini_prompt_tokens) || 0,
      gemini_output_tokens: Number(previous?.gemini_output_tokens) || 0,
      gemini_thoughts_tokens: Number(previous?.gemini_thoughts_tokens) || 0,
      gemini_total_tokens: Number(previous?.gemini_total_tokens) || 0,
      gemini_credits_used: Number(previous?.gemini_credits_used) || 0,
      gemini_cost_usd: Number(previous?.gemini_cost_usd) || 0,
      gemini_cost_usd_display:
        previous?.gemini_cost_usd_display ||
        formatUsdDisplay(Number(previous?.gemini_cost_usd) || 0),
      save_status: 'changed',
      previously_saved_at: previous.saved_at || null,
      change_reason: reason,
      previous_time_label: previous.time_label || null,
      had_gemini_before: hasStoredGeminiReason(previous),
    }
  }

  const classified = (Array.isArray(events) ? events : []).map((raw) => {
    const row = normalizeEventRow(raw)
    if (!row) {
      return { ...raw, save_status: 'invalid' }
    }
    const previous = saved[row.event_date]
    if (!previous) {
      newCount += 1
      return { ...raw, ...row, save_status: 'new' }
    }

    const isToday = row.event_date === today

    // Past dates: Supabase is source of truth (Gemini stays Gemini forever).
    if (!isToday) {
      return keepStored(raw, row, previous, {
        change_reason: hasStoredGeminiReason(previous)
          ? 'historical_gemini_protected'
          : 'older_date_left_alone',
      })
    }

    // Today + Gemini already done + same Perplexity time stamp → keep Gemini.
    // (Re-fetch does not thrash a finished Gemini reason for the same story.)
    const timeDiff = timeLabelsDiffer(previous.time_label, row.time_label)
    if (timeDiff === false && hasStoredGeminiReason(previous)) {
      return keepStored(raw, row, previous, {
        change_reason: 'today_gemini_same_time_protected',
      })
    }

    // Today: time stamp is the primary signal that the story was re-written.
    if (timeDiff === true) {
      return markChanged(raw, row, previous, 'time_label_diff')
    }
    if (timeDiff === false) {
      return keepStored(raw, row, previous, {
        change_reason: 'same_time_label',
      })
    }

    // Missing time on one/both sides — fall back to content fingerprint.
    // If Gemini already structured today's reason, keep it unless metrics/time
    // clearly moved (handled above). Fingerprint alone must not wipe Gemini.
    if (hasStoredGeminiReason(previous)) {
      return keepStored(raw, row, previous, {
        change_reason: 'today_gemini_fingerprint_protected',
      })
    }
    const prevFp =
      previous.content_fingerprint || eventContentFingerprint(previous)
    const nextFp = row.content_fingerprint || eventContentFingerprint(row)
    if (prevFp === nextFp) {
      return keepStored(raw, row, previous, {
        change_reason: 'same_content_fingerprint',
      })
    }
    return markChanged(raw, row, previous, 'content_fingerprint_diff')
  })

  return {
    events: classified,
    summary: {
      total: classified.length,
      new: newCount,
      changed: changedCount,
      already_saved: savedCount,
      compare_mode: 'date_and_time_et',
      today_et: today,
    },
  }
}

function buildNotablePayload({
  ticker,
  dates,
  sourceUrl,
  scrapedAt,
  nowIso,
  sourceProvider = null,
  assetClass = null,
}) {
  const stamp = nowIso || new Date().toISOString()
  // Primary structure is `dates` (ticker → date-wise segregation).
  // Keep `events_by_date` as a mirror for any older readers.
  return {
    version: 2,
    ticker,
    updated_at: stamp,
    last_scraped_at: scrapedAt || stamp,
    source_url: sourceUrl || perplexityFinanceUrl(ticker),
    source_provider: sourceProvider || null,
    asset_class: assetClass || null,
    dates,
    events_by_date: dates,
  }
}

/** Users list → device_monitored_tickers · Extreme/Pinned → pinned_monitored_tickers */
const MONITOR_TABLE_DEVICE = 'device_monitored_tickers'
const MONITOR_TABLE_PINNED = 'pinned_monitored_tickers'

function normalizeMonitorScope(value) {
  const scope = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  if (
    scope === 'pinned' ||
    scope === 'pin' ||
    scope === 'extreme' ||
    scope === 'pinnedmonitored' ||
    scope === 'pinnedmonitoredtickers'
  ) {
    return 'pinned'
  }
  return 'device'
}

function monitorTableForScope(scope) {
  return normalizeMonitorScope(scope) === 'pinned'
    ? MONITOR_TABLE_PINNED
    : MONITOR_TABLE_DEVICE
}

function resolveMonitorScope(request) {
  return normalizeMonitorScope(
    request?.body?.monitor_scope ||
      request?.body?.scope ||
      request?.query?.monitor_scope ||
      request?.query?.scope ||
      'device',
  )
}

async function loadTickerMeta(supabase, ticker, scope = 'device') {
  const table = monitorTableForScope(scope)
  const { data, error } = await supabase
    .from(table)
    .select('ticker, company_name')
    .eq('ticker', ticker)
    .limit(5)

  if (error) throw error
  if (data?.length) {
    const named = data.find((row) => row.company_name && row.company_name !== row.ticker)
    return {
      ticker,
      company_name: named?.company_name || data[0]?.company_name || ticker,
      monitor_scope: normalizeMonitorScope(scope),
    }
  }

  // Case-insensitive fallback
  const { data: soft, error: softError } = await supabase
    .from(table)
    .select('ticker, company_name')
    .ilike('ticker', ticker)
    .limit(5)
  if (softError) throw softError
  if (!soft?.length) {
    // Pinned miss → still try device name as a display fallback (never write cross-table here).
    if (normalizeMonitorScope(scope) === 'pinned') {
      try {
        const deviceMeta = await loadTickerMeta(supabase, ticker, 'device')
        return { ...deviceMeta, monitor_scope: 'pinned' }
      } catch {
        /* ignore */
      }
    }
    return { ticker, company_name: ticker, monitor_scope: normalizeMonitorScope(scope) }
  }
  const named = soft.find((row) => row.company_name && row.company_name !== row.ticker)
  return {
    ticker: soft[0]?.ticker || ticker,
    company_name: named?.company_name || soft[0]?.company_name || ticker,
    monitor_scope: normalizeMonitorScope(scope),
  }
}

/**
 * Route scrape: equity → Perplexity, non-equity → Trading Economics.
 */
export async function scrapeNotableMovementsForTicker(ticker, { companyName = '' } = {}) {
  const classification = classifyAsset(ticker, companyName)
  if (classification.scrape_source === 'trading_economics') {
    return scrapeTradingEconomicsNotableMovements(ticker, { companyName })
  }
  const result = await scrapePerplexityNotableMovements(ticker)
  return {
    ...result,
    asset_class: 'equity',
    scrape_source: 'perplexity',
    source_provider: 'perplexity',
  }
}

/**
 * Merge only the given events into the existing dates map.
 * Unrelated dates are left untouched — never a full replace of history.
 */
function mergeDatesIntoMap(existingDates, eventsToWrite, nowIso) {
  const next = { ...(existingDates || {}) }
  const written = []
  const skipped = []
  const today = todayIsoEastern()

  for (const event of eventsToWrite) {
    const row = normalizeEventRow(event)
    if (!row) {
      skipped.push({ reason: 'invalid_date', event })
      continue
    }
    const previous = next[row.event_date]
    // Hard guard: never let a non-Gemini re-fetch clobber a past Gemini date
    // (or today's Gemini if the client accidentally sent save_status=changed).
    if (
      previous &&
      hasStoredGeminiReason(previous) &&
      !hasStoredGeminiReason(row) &&
      row.event_date !== today
    ) {
      skipped.push({
        reason: 'historical_gemini_protected',
        event_date: row.event_date,
      })
      continue
    }
    // Today: allow overwrite (fresh Perplexity / new Gemini). Past non-Gemini:
    // still allow normal new/changed writes.
    next[row.event_date] = {
      ...row,
      // If we are re-writing Gemini for today, keep cumulative spend meters.
      ...(previous && hasStoredGeminiReason(previous) && hasStoredGeminiReason(row)
        ? {
            gemini_prompt_tokens:
              Number(row.gemini_prompt_tokens) ||
              Number(previous.gemini_prompt_tokens) ||
              0,
            gemini_output_tokens:
              Number(row.gemini_output_tokens) ||
              Number(previous.gemini_output_tokens) ||
              0,
            gemini_total_tokens:
              Number(row.gemini_total_tokens) ||
              Number(previous.gemini_total_tokens) ||
              0,
            gemini_credits_used:
              Number(row.gemini_credits_used) ||
              Number(previous.gemini_credits_used) ||
              0,
            gemini_cost_usd:
              Number(row.gemini_cost_usd) || Number(previous.gemini_cost_usd) || 0,
          }
        : previous && !hasStoredGeminiReason(row)
          ? {
              // Preserve cumulative meters even when today's Gemini is cleared
              // by a fresh Perplexity story (time_label moved).
              gemini_prompt_tokens: Number(previous.gemini_prompt_tokens) || 0,
              gemini_output_tokens: Number(previous.gemini_output_tokens) || 0,
              gemini_total_tokens: Number(previous.gemini_total_tokens) || 0,
              gemini_credits_used: Number(previous.gemini_credits_used) || 0,
              gemini_cost_usd: Number(previous.gemini_cost_usd) || 0,
              gemini_cost_usd_display:
                previous.gemini_cost_usd_display ||
                formatUsdDisplay(Number(previous.gemini_cost_usd) || 0),
            }
          : {}),
      saved_at: nowIso,
    }
    written.push(row.event_date)
  }

  return { dates: next, written, skipped }
}

async function loadTickerDates(supabase, ticker, scope = 'device') {
  const table = monitorTableForScope(scope)
  const { data, error } = await supabase
    .from(table)
    .select('ticker, company_name, notable_price_movements, updated_at')
    .eq('ticker', ticker)

  if (error) throw error
  if (!data?.length) {
    // Case-insensitive fallback
    const soft = await supabase
      .from(table)
      .select('ticker, company_name, notable_price_movements, updated_at')
      .ilike('ticker', ticker)
    if (soft.error) throw soft.error
    if (!soft.data?.length) {
      return {
        rows: [],
        dates: {},
        found: false,
        monitor_scope: normalizeMonitorScope(scope),
        table,
      }
    }
    let dates = {}
    for (const row of soft.data) {
      dates = mergeDateMaps(dates, extractDatesMap(row.notable_price_movements))
    }
    return {
      rows: soft.data,
      dates,
      found: true,
      monitor_scope: normalizeMonitorScope(scope),
      table,
    }
  }

  // Multiple device rows may share a ticker — merge all date maps (union),
  // preferring richer Gemini / complete metric payloads over sparse stubs.
  let dates = {}
  for (const row of data) {
    dates = mergeDateMaps(dates, extractDatesMap(row.notable_price_movements))
  }
  return {
    rows: data,
    dates,
    found: true,
    monitor_scope: normalizeMonitorScope(scope),
    table,
  }
}

/**
 * Ensure a row exists in the target monitor table (device or pinned).
 * Pinned Extreme scrapes call this so auto-save never fails for “not in device list”.
 */
async function ensureMonitorTickerRow(
  supabase,
  ticker,
  { companyName = '', scope = 'device' } = {},
) {
  const monitorScope = normalizeMonitorScope(scope)
  const table = monitorTableForScope(monitorScope)
  const loaded = await loadTickerDates(supabase, ticker, monitorScope)
  if (loaded.found) {
    return { created: false, loaded, table, monitor_scope: monitorScope }
  }

  const nowIso = new Date().toISOString()
  const name = String(companyName || ticker).trim() || ticker
  const notable = buildNotablePayload({
    ticker,
    dates: {},
    sourceUrl: perplexityFinanceUrl(ticker),
    scrapedAt: null,
    nowIso,
    sourceProvider: 'perplexity',
    assetClass: 'equity',
  })

  if (monitorScope === 'pinned') {
    const row = {
      ticker,
      company_name: name,
      notable_price_movements: notable,
      pinned_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    }
    const { data, error } = await supabase
      .from(table)
      .upsert(row, { onConflict: 'ticker' })
      .select('ticker, company_name, notable_price_movements, updated_at')
      .limit(1)
    if (error) throw error
    return {
      created: true,
      loaded: {
        rows: data || [row],
        dates: {},
        found: true,
        monitor_scope: 'pinned',
        table,
      },
      table,
      monitor_scope: 'pinned',
    }
  }

  // Device (Users) — same insert shapes as addTicker
  const baseRow = {
    ticker,
    company_name: name,
    subscribers: [],
    notable_price_movements: notable,
    updated_at: nowIso,
  }
  const candidates = [
    baseRow,
    { ...baseRow, created_at: nowIso },
    { ...baseRow, device_id: 'dashboard' },
    { ...baseRow, device_id: 'dashboard', created_at: nowIso },
  ]
  let data = null
  let lastError = null
  for (const insertRow of candidates) {
    const result = await supabase
      .from(table)
      .insert(insertRow)
      .select('ticker, company_name, notable_price_movements, updated_at')
      .limit(1)
    if (!result.error) {
      data = result.data
      lastError = null
      break
    }
    lastError = result.error
    if (/duplicate|unique/i.test(result.error.message || '')) {
      lastError = null
      data = [{ ticker, company_name: name, notable_price_movements: notable, updated_at: nowIso }]
      break
    }
  }
  if (lastError) throw lastError
  return {
    created: true,
    loaded: {
      rows: data || [],
      dates: {},
      found: true,
      monitor_scope: 'device',
      table,
    },
    table,
    monitor_scope: 'device',
  }
}

async function persistTickerDates(supabase, ticker, payload, scope = 'device') {
  const monitorScope = normalizeMonitorScope(scope)
  const table = monitorTableForScope(monitorScope)
  const nowIso = payload.updated_at || new Date().toISOString()

  // Prefer exact ticker match first.
  let { data, error } = await supabase
    .from(table)
    .update({
      notable_price_movements: payload,
      updated_at: nowIso,
    })
    .eq('ticker', ticker)
    .select('ticker, company_name, notable_price_movements, updated_at')

  if (error) throw error

  // Case-insensitive fallback (e.g. row stored as "aapl").
  if (!data?.length) {
    ;({ data, error } = await supabase
      .from(table)
      .update({
        notable_price_movements: payload,
        updated_at: nowIso,
      })
      .ilike('ticker', ticker)
      .select('ticker, company_name, notable_price_movements, updated_at'))
    if (error) throw error
  }

  // Pinned (and optional device ensure): create row then update once.
  if (!data?.length) {
    await ensureMonitorTickerRow(supabase, ticker, {
      companyName: payload?.ticker || ticker,
      scope: monitorScope,
    })
    ;({ data, error } = await supabase
      .from(table)
      .update({
        notable_price_movements: payload,
        updated_at: nowIso,
      })
      .eq('ticker', ticker)
      .select('ticker, company_name, notable_price_movements, updated_at'))
    if (error) throw error
  }

  if (!data?.length) {
    throw new Error(
      `Supabase update matched 0 rows for ticker ${ticker} in ${table}. ` +
        `Check the row exists and that the service role can UPDATE (RLS). ` +
        (monitorScope === 'pinned'
          ? 'Run supabase/schema_pinned_monitored_tickers.sql if the table is missing.'
          : 'Check the ticker exists in device_monitored_tickers.'),
    )
  }
  return data
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
// Expo rejects a batch when its tokens belong to different projects.
// Sending one message per request keeps mixed dev/preview/production tokens isolated.
const EXPO_PUSH_BATCH = 1

function isExpoPushToken(token) {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(token.trim())
}

function normalizeNotificationApp(value) {
  const app = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  return app === 'trigger' || app === 'triggerapp' ? 'trigger' : 'nineam'
}

function subscriberNotificationApp(subscriber) {
  const explicit =
    subscriber?.app_key ??
    subscriber?.app ??
    subscriber?.app_id ??
    subscriber?.app_name ??
    subscriber?.notification_app ??
    subscriber?.client_app ??
    subscriber?.project ??
    subscriber?.project_id ??
    subscriber?.bundle_id ??
    subscriber?.package_name
  // Existing subscriber records predate app tagging and belong to 9AM.
  if (explicit == null || explicit === '') return 'nineam'
  const raw = String(explicit).trim().toLowerCase()
  // Common mobile package / slug variants for Trigger.
  if (
    raw.includes('trigger') ||
    raw === 'com.newslabs.trigger' ||
    raw.endsWith('.trigger')
  ) {
    return 'trigger'
  }
  if (
    raw.includes('nineam') ||
    raw.includes('9am') ||
    raw === 'com.newslabs.nineam' ||
    raw.endsWith('.nineam')
  ) {
    return 'nineam'
  }
  return normalizeNotificationApp(explicit)
}

/**
 * Robust on/off for subscriber JSON (apps write mixed shapes over time).
 * Treats false / "false" / 0 / "off" / "disabled" as stopped.
 * Missing flag → still considered on (legacy rows).
 */
function isSubscriberEnabled(subscriber) {
  if (!subscriber || typeof subscriber !== 'object') return false
  const candidates = [
    subscriber.enabled,
    subscriber.notifications_enabled,
    subscriber.notification_enabled,
    subscriber.push_enabled,
    subscriber.is_enabled,
    subscriber.active,
    subscriber.subscribed,
  ]
  let sawTruthy = false
  for (const value of candidates) {
    if (value === undefined || value === null || value === '') continue
    if (value === false || value === 0) return false
    if (typeof value === 'string') {
      const s = value.trim().toLowerCase()
      if (['false', '0', 'no', 'off', 'disabled', 'inactive', 'stopped'].includes(s)) {
        return false
      }
      if (['true', '1', 'yes', 'on', 'enabled', 'active'].includes(s)) {
        sawTruthy = true
      }
    } else if (value === true || value === 1) {
      sawTruthy = true
    }
  }
  // Explicit true wins when no false was seen; no flags at all → legacy on.
  return sawTruthy || candidates.every((v) => v === undefined || v === null || v === '')
}

/**
 * Delivery gates:
 *  1. Dashboard Test Mode ON  → selected allowlist from Test Mode picker
 *  2. Else legacy PUSH_ALLOWLIST_* env → only those devices
 *  3. Else all eligible subscribers (+ always-notify injected elsewhere)
 *
 * Env (comma-separated), legacy:
 *   PUSH_ALLOWLIST_DEVICE_IDS=ios-…
 *   PUSH_ALLOWLIST_TOKENS=ExponentPushToken[…]
 */
function getPushAllowlist() {
  // Dashboard Test Mode: selected devices from the Studio picker
  if (isTestModeEnabled()) {
    const forced = getTestModeAllowlistRecipients('trigger')
    const deviceIds = forced.map((r) => r.device_id).filter(Boolean)
    const tokens = forced.map((r) => r.expo_push_token).filter(Boolean)
    // Include aliases so legacy device_ids still pass filters
    for (const d of ALWAYS_NOTIFY_DEVICES) {
      if (tokens.includes(d.expo_push_token) || deviceIds.includes(d.device_id)) {
        for (const a of d.aliases || []) deviceIds.push(a)
      }
    }
    return {
      active: true,
      source: 'test_mode',
      deviceIds,
      tokens,
      deviceIdSet: new Set(deviceIds),
      tokenSet: new Set(tokens),
    }
  }
  // Legacy env allowlist only when explicitly opted in (does NOT run with Test Mode OFF by default)
  const useEnv =
    process.env.MOMENTUM_USE_ENV_ALLOWLIST === '1' ||
    process.env.MOMENTUM_USE_ENV_ALLOWLIST === 'true'
  if (!useEnv) {
    return {
      active: false,
      source: 'none',
      deviceIds: [],
      tokens: [],
      deviceIdSet: new Set(),
      tokenSet: new Set(),
    }
  }
  const deviceIds = String(process.env.PUSH_ALLOWLIST_DEVICE_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const tokens = String(process.env.PUSH_ALLOWLIST_TOKENS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    active: deviceIds.length > 0 || tokens.length > 0,
    source: 'env',
    deviceIds,
    tokens,
    deviceIdSet: new Set(deviceIds),
    tokenSet: new Set(tokens),
  }
}

/**
 * Build forced recipients when test mode / env allowlist is active.
 * @param {string} [appKey='trigger']
 * @returns {Array<{ device_id: string|null, expo_push_token: string, enabled: boolean, app_key: string, forced: boolean }>|null}
 *   null when allowlist is inactive
 */
function forceAllowlistRecipients(appKey = 'trigger') {
  if (isTestModeEnabled()) {
    return getTestModeAllowlistRecipients(appKey)
  }
  const allow = getPushAllowlist()
  if (!allow.active) return null
  const selectedApp = normalizeNotificationApp(appKey)
  const ids = allow.deviceIds
  const tokens = allow.tokens
  const n = Math.max(ids.length, tokens.length, 1)
  const out = []
  const seen = new Set()
  for (let i = 0; i < n; i += 1) {
    const token = String(tokens[i] || tokens[0] || '').trim()
    const device_id = String(ids[i] || ids[0] || '').trim() || null
    if (!token || !isExpoPushToken(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    out.push({
      device_id,
      expo_push_token: token,
      enabled: true,
      app_key: selectedApp,
      forced: true,
    })
  }
  return out
}

/**
 * Filter recipients / Expo messages to the allowlist (if configured).
 * Matches device_id OR expo_push_token / message.to.
 * @template T
 * @param {T[]} list
 * @param {(item: T) => { device_id?: string|null, expo_push_token?: string|null, to?: string|null }} pick
 * @returns {T[]}
 */
function applyPushAllowlist(list, pick) {
  const allow = getPushAllowlist()
  if (!allow.active) return list || []
  const filtered = (list || []).filter((item) => {
    const { device_id, expo_push_token, to } = pick(item) || {}
    const id = device_id != null ? String(device_id).trim() : ''
    const token = String(expo_push_token || to || '').trim()
    if (id && allow.deviceIdSet.has(id)) return true
    if (token && allow.tokenSet.has(token)) return true
    return false
  })
  if ((list || []).length > 0 && filtered.length === 0) {
    console.warn(
      `[push allowlist] blocked all recipients (${allow.source || 'env'}) — none matched tester / PUSH_ALLOWLIST_*`,
    )
  } else if ((list || []).length !== filtered.length) {
    console.log(
      `[push allowlist] ${filtered.length}/${(list || []).length} recipient(s) after ${allow.source || 'env'} gate`,
    )
  }
  return filtered
}

/** Mask Expo token for UI logs (keep start + end). */
function maskExpoToken(token) {
  const t = String(token || '').trim()
  if (!t) return '—'
  if (t.length <= 28) return t
  return `${t.slice(0, 18)}…${t.slice(-8)}`
}

/**
 * Unique push-ready devices on ticker row(s) for an app — pure audience math.
 * Same rules as delivery eligibility, but:
 *   - no PUSH_ALLOWLIST force-inject
 *   - no allowlist filter
 * Use this for dashboard subscriber counts so dev allowlists don't show "1" on every ticker.
 *
 * @param {Array<Record<string, unknown>>|Record<string, unknown>|null|undefined} rows
 * @param {string} [appKey='trigger']
 * @returns {Array<{ device_id: string|null, expo_push_token: string, enabled: boolean, app_key: string }>}
 */
export function listWatchlistSubscribers(rows, appKey = 'trigger') {
  const selectedApp = normalizeNotificationApp(appKey)
  const list = Array.isArray(rows) ? rows : rows ? [rows] : []
  const byToken = new Map()
  for (const row of list) {
    const subs = Array.isArray(row?.subscribers) ? row.subscribers : []
    for (const sub of subs) {
      if (!sub || !isSubscriberEnabled(sub)) continue
      if (subscriberNotificationApp(sub) !== selectedApp) continue
      const token = String(sub.expo_push_token || '').trim()
      if (!isExpoPushToken(token)) continue
      if (byToken.has(token)) {
        const prev = byToken.get(token)
        if (!prev.device_id && sub.device_id) {
          prev.device_id = sub.device_id
        }
        continue
      }
      byToken.set(token, {
        device_id: sub.device_id || null,
        expo_push_token: token,
        enabled: true,
        app_key: selectedApp,
      })
    }
  }
  return [...byToken.values()]
}

/**
 * Collect enabled subscribers with valid Expo tokens from ticker row(s).
 * Dedupes by token (same phone subscribed once even if listed twice).
 * Only tokens with ≥1 enabled subscription for the selected app are returned
 * (used for actual push sends).
 *
 * When PUSH_ALLOWLIST_* is set: returns forced allowlist recipients only
 * (ignores empty watchlist — still delivers to the tester device).
 *
 * Exported so other modules can reuse the exact push-delivery path.
 */
export function collectPushRecipients(rows, appKey = 'nineam') {
  const selectedApp = normalizeNotificationApp(appKey)
  const forced = forceAllowlistRecipients(selectedApp)
  if (forced && forced.length) {
    console.log(
      `[push] ${isTestModeEnabled() ? 'test mode' : 'allowlist'} → force-deliver to ${forced.length} device(s) (watchlist ignored)`,
    )
    return forced
  }

  // Real subscribers + both always-notify testers (even if not on this ticker)
  const subs = listWatchlistSubscribers(rows, selectedApp)
  return ensureAlwaysNotifyRecipients(subs, selectedApp)
}

/**
 * Build Audience device cards for one app: includes stopped devices so the
 * dashboard can show Notifications off (not only the alertable subset).
 */
function buildAudienceDevices(rows, appKey = 'nineam') {
  const selectedApp = normalizeNotificationApp(appKey)
  /** @type {Map<string, any>} */
  const byToken = new Map()

  for (const row of rows || []) {
    const ticker = normalizeTicker(row.ticker)
    const assetClass = classifyAsset(ticker, row.company_name || '').asset_class
    const subs = Array.isArray(row?.subscribers) ? row.subscribers : []
    for (const sub of subs) {
      if (!sub) continue
      if (subscriberNotificationApp(sub) !== selectedApp) continue
      const token = String(sub.expo_push_token || '').trim()
      if (!isExpoPushToken(token)) continue

      if (!byToken.has(token)) {
        byToken.set(token, {
          device_id: sub.device_id || null,
          expo_push_token: token,
          app_key: selectedApp,
          enabled_tickers: new Set(),
          disabled_tickers: new Set(),
          crypto_tickers: new Set(),
        })
      }
      const entry = byToken.get(token)
      if (!entry.device_id && sub.device_id) entry.device_id = sub.device_id

      if (!ticker) continue
      if (isSubscriberEnabled(sub)) {
        entry.enabled_tickers.add(ticker)
        entry.disabled_tickers.delete(ticker)
        if (assetClass === 'crypto') entry.crypto_tickers.add(ticker)
      } else {
        // Only mark stopped if they are not also enabled on this ticker.
        if (!entry.enabled_tickers.has(ticker)) {
          entry.disabled_tickers.add(ticker)
        }
      }
    }
  }

  const devices = [...byToken.values()].map((entry) => {
    const enabledTickers = [...entry.enabled_tickers].sort()
    const disabledTickers = [...entry.disabled_tickers]
      .filter((t) => !entry.enabled_tickers.has(t))
      .sort()
    const cryptoTickers = [...entry.crypto_tickers].sort()
    const notificationsOn = enabledTickers.length > 0
    let subscription_status = 'off'
    if (notificationsOn && disabledTickers.length > 0) subscription_status = 'partial'
    else if (notificationsOn) subscription_status = 'on'
    return {
      device_id: entry.device_id,
      expo_push_token: entry.expo_push_token,
      app_key: selectedApp,
      enabled: notificationsOn,
      subscription_status,
      // Back-compat: tickers = currently enabled stock/crypto symbols.
      tickers: enabledTickers,
      enabled_tickers: enabledTickers,
      disabled_tickers: disabledTickers,
      crypto_tickers: cryptoTickers,
      pro_crypto: cryptoTickers.length > 0,
      enabled_count: enabledTickers.length,
      disabled_count: disabledTickers.length,
    }
  })

  // Alertable first, then partial, then fully stopped; stable by device_id.
  const rank = { on: 0, partial: 1, off: 2 }
  devices.sort((a, b) => {
    const dr = (rank[a.subscription_status] ?? 9) - (rank[b.subscription_status] ?? 9)
    if (dr !== 0) return dr
    return String(a.device_id || a.expo_push_token).localeCompare(
      String(b.device_id || b.expo_push_token),
    )
  })

  return devices
}

function latestMovementEvent(notable) {
  const dates = extractDatesMap(notable)
  const keys = Object.keys(dates).sort().reverse()
  if (!keys.length) return null
  return dates[keys[0]] || null
}

/**
 * Normalize momentum for the notification title, e.g. "+1.2%" / "-0.8%".
 */
function formatMomentumForTitle(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  // Already signed
  if (s.startsWith('+') || s.startsWith('-') || s.startsWith('−')) return s.replace(/^−/, '-')
  // Bare percent / number → treat as positive if non-zero
  const n = Number.parseFloat(s.replace(/%/g, '').replace(/,/g, ''))
  if (!Number.isFinite(n) || n === 0) {
    return s.includes('%') ? s : `${s}%`
  }
  const withPct = s.includes('%') ? s.replace(/^[+-]?/, '') : `${Math.abs(n)}%`
  return n < 0 ? `-${withPct.replace(/^-/, '')}` : `+${withPct.replace(/^\+/, '')}`
}

/**
 * From a Gemini market-notification summary, take only the Likely driver line/section.
 * Returns the driver text without the "Likely driver:" label.
 */
/**
 * Pull "Likely driver: …" from Perplexity / Gemini structured reason.
 * Handles markdown (**Likely driver:**), inline after [TICKER] headers, and
 * multi-line sections. Exported so momentum auto-start uses the same logic.
 *
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function extractLikelyDriver(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''

  // Strip light markdown wrappers around the label: **Likely driver:**
  const normalized = raw.replace(
    /\*{0,2}\s*likely\s*driver\s*\*{0,2}\s*:/gi,
    'Likely driver:',
  )

  // Prefer a labelled section. Capture until Secondary driver / Move classification /
  // Confidence / Volume / Tap to see / end. Works when "Likely driver:" is mid-line
  // after e.g. [GOLD DEC 26] [+1.31%] [16 hours …].
  const sectionMatch = normalized.match(
    /likely\s*driver\s*:\s*([\s\S]*?)(?=(?:\n\s*)?(?:\*{0,2}\s*)?(?:secondary\s*driver|move\s*classification|confidence|volume|tap\s+to\s+see)(?:\s*\*{0,2})?\s*:|$)/i,
  )
  if (sectionMatch?.[1]) {
    return sectionMatch[1]
      .replace(/\*+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Inline single-line form: "Likely driver: …"
  const lineMatch = normalized.match(/likely\s*driver\s*:\s*(.+)/i)
  if (lineMatch?.[1]) {
    return lineMatch[1]
      .split(/\n/)[0]
      .replace(/\*+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return ''
}

/**
 * First headline line of a Gemini structured reason — everything before
 * "Likely driver:" (typically: "[ASSET] [PRICE MOVE] [TIME PERIOD PHRASE]").
 * Falls back to the first non-empty free-text line when labels are missing.
 */
function extractGeminiHeadline(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''

  const likelyIdx = raw.search(/likely\s*driver\s*:/i)
  const before = likelyIdx > 0 ? raw.slice(0, likelyIdx).trim() : ''
  if (before) {
    const firstLine = before
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    if (firstLine) return firstLine.replace(/\s+/g, ' ').trim()
  }

  // Unstructured / pre-Gemini scrape: first short non-empty line.
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^likely\s*driver\s*:/i.test(line))
  if (firstLine && firstLine.length > 0 && firstLine.length <= 160) {
    return firstLine.replace(/\s+/g, ' ').trim()
  }

  return ''
}

/**
 * Push body narrative for a notable move.
 * Prefer Gemini "Likely driver" only; otherwise fall back to cleaned scrape reason.
 */
function reasonTextOnly(event) {
  const summary = String(event?.summary || '').trim()
  const reasonsJoined = Array.isArray(event?.reasons)
    ? event.reasons.map((r) => String(r || '').trim()).filter(Boolean).join('\n')
    : ''
  const premarketReason = premarketReasonFromEvent(event)

  // 1) Gemini classified summary → body is only the Likely driver.
  const fromSummary = extractLikelyDriver(summary)
  if (fromSummary) return fromSummary
  const fromReasons = extractLikelyDriver(reasonsJoined)
  if (fromReasons) return fromReasons

  // 2) Legacy scrape narrative (no Gemini classification yet).
  const parts = []
  if (Array.isArray(event?.reasons)) {
    for (const r of event.reasons) {
      const t = String(r || '').trim()
      if (t) parts.push(t)
    }
  }
  if (summary && !parts.includes(summary)) parts.unshift(summary)
  if (premarketReason && !parts.includes(premarketReason)) parts.push(premarketReason)

  let text = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (!text) return ''

  // If the joined blob still contains a Likely driver label, extract it.
  const fromJoined = extractLikelyDriver(text)
  if (fromJoined) return fromJoined

  // Peel off leading metadata fragments that sometimes leak into summary.
  for (let i = 0; i < 8; i += 1) {
    const before = text
    text = text
      .replace(/^\d{4}-\d{2}-\d{2}\b[\s,·|:—-]*/i, '')
      .replace(
        /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{4})?\b[\s,·|:—-]*/i,
        '',
      )
      .replace(/^\d{1,2}:\d{2}\s*(?:AM|PM)?\s*(?:ET|EST|EDT|PT|UTC)?\b[\s,·|:—-]*/i, '')
      .replace(/^\$[\d,]+(?:\.\d+)?\b[\s,·|:—-]*/i, '')
      .replace(/^[+\-−]?\d+(?:\.\d+)?%\b[\s,·|:—-]*/i, '')
      .replace(/^\d+\s+sources?\b[\s,·|:—-]*/i, '')
      .replace(/^[\s,·|:—-]+/, '')
      .trim()
    if (text === before) break
  }

  return text
}

/**
 * Push copy for a notable move:
 *   title (line 1):  "🔴 SNDK fell 4.2% so far in regular trading"
 *                    (Gemini first headline line + direction icon)
 *   body  (line 2):  Gemini "Likely driver" only (or legacy cleaned reason)
 */
function buildAlertMessage({
  ticker,
  companyName,
  event,
  titleOverride,
  bodyOverride,
  appKey = 'nineam',
}) {
  const changeRaw = event?.price_change || event?.momentum || ''
  const change = formatMomentumForTitle(changeRaw)
  const premarketChange = premarketChangeFromEvent(event)
  const formattedPremarketChange = formatMomentumForTitle(premarketChange)
  const afterHoursChange = afterHoursChangeFromEvent(event)
  const formattedAfterHoursChange = formatMomentumForTitle(afterHoursChange)
  // Prefer Likely driver from Gemini response for the user-facing push body.
  const reason = reasonTextOnly(event)
  // Prefer Gemini first headline line for the push title (before "Likely driver:").
  const reasonsJoined = Array.isArray(event?.reasons)
    ? event.reasons.map((r) => String(r || '').trim()).filter(Boolean).join('\n')
    : ''
  const geminiHeadline =
    extractGeminiHeadline(event?.summary) ||
    extractGeminiHeadline(reasonsJoined) ||
    extractGeminiHeadline(premarketReasonFromEvent(event))

  const sym = String(ticker || '').trim().toUpperCase() || 'TICKER'
  const company = String(companyName || sym).trim() || sym
  const isStock =
    classifyAsset(sym, company).asset_class === 'equity' ||
    isStockAlertTicker(sym)
  const headingName = isStock ? sym : company
  const notificationApp = normalizeNotificationApp(appKey)
  const deepLinkScheme = notificationApp === 'trigger' ? 'trigger' : 'nineam'
  const eventDate = event?.event_date || null
  const price = event?.price || null
  const afterHoursPrice = afterHoursPriceFromEvent(event)
  const priceChange = event?.price_change || event?.momentum || null
  const hasRegularMovement = Boolean(String(priceChange || '').trim())
  const hasPremarketMovement = Boolean(String(premarketChange || '').trim())
  const hasAfterHoursMovement = Boolean(String(afterHoursChange || '').trim())
  const movementType = (() => {
    const parts = []
    if (hasRegularMovement) parts.push('regular')
    if (hasPremarketMovement) parts.push('premarket')
    if (hasAfterHoursMovement) parts.push('after_hours')
    if (parts.length === 0) return 'regular_market'
    if (parts.length === 1) {
      return parts[0] === 'regular' ? 'regular_market' : parts[0]
    }
    return parts.join('_and_')
  })()
  const notificationType =
    notificationApp === 'trigger'
      ? `trigger_${movementType}_movement`
      : 'nineam_notable_price_movement'
  const deepLinkParams = new URLSearchParams({
    kind: 'notable_move',
    notification_type: notificationType,
    movement_type: movementType,
  })
  if (eventDate) deepLinkParams.set('event_date', eventDate)
  const deepLink = `${deepLinkScheme}://ticker/${encodeURIComponent(sym)}?${deepLinkParams.toString()}`

  // Direction icon from the latest session move (premarket → after hours → regular).
  // Negative % → red, positive % → green. No hardcoded "Market close" session tag.
  const titleMovement = formattedPremarketChange || formattedAfterHoursChange || change
  const directionEmoji = titleMovement
    ? /^[\s]*[-−]/.test(titleMovement)
      ? '🔴'
      : /^[\s]*\+/.test(titleMovement)
        ? '🟢'
        : '🟠'
    : '🟠'

  // Line 1 — direction icon + Gemini first-line headline.
  // Stocks: always the ticker (SNDK), never the company name (Sandisk).
  let title = titleOverride && String(titleOverride).trim()
  if (!title) {
    if (geminiHeadline) {
      const heading = isStock
        ? rewriteStockHeadlineToTicker(geminiHeadline, sym, company)
        : geminiHeadline
      title = `${directionEmoji} ${heading}`
    } else {
      title = `${directionEmoji} ${headingName}${titleMovement ? ` ${titleMovement}` : ''}`.trim()
    }
    // Keep lock-screen titles compact (dashboard input maxLength is 120).
    if (title.length > 120) title = `${title.slice(0, 117)}…`
  } else if (isStock) {
    title = rewriteStockHeadlineToTicker(title, sym, company)
  }

  // Line 2 — reason text only (never date / price / momentum)
  let body = bodyOverride && String(bodyOverride).trim()
  if (!body) {
    body = reason || `New notable price movement for ${sym}.`
    if (body.length > 400) body = `${body.slice(0, 397)}…`
  }

  // Deep-link metadata for the mobile app (tap → Monitor with this ticker).
  // Expo/FCM on Android requires string key-values — never send nulls/objects
  // or the entire `data` bag can be dropped and the client only sees title/body.
  const str = (v) => (v == null || v === '' ? '' : String(v));
  const data = {
    // Routing
    type: 'notable_price_movement',
    notification_type: notificationType,
    movement_type: movementType,
    kind: 'notable_move',
    screen: 'notable_move',
    path: `/ticker/${encodeURIComponent(sym)}`,
    app_key: notificationApp,
    deep_link: deepLink,
    url: deepLink,
    app_url: deepLink,

    // Identity
    ticker: sym,
    company_name: isStock ? sym : str(company) || sym,

    // Event snapshot (all strings)
    event_date: str(eventDate),
    display_date: str(event?.display_date),
    time_label: str(event?.time_label),
    price: str(price),
    price_change: str(priceChange),
    momentum: str(event?.momentum || priceChange),
    premarket_change: str(premarketChange),
    premarket_reason: str(premarketReasonFromEvent(event)),
    after_hours_price: str(afterHoursPrice),
    after_hours_change: str(afterHoursChange),
    reason: str(reason),
    summary: str(reason),

    // What the user saw on the notification
    notification_title: str(title),
    notification_body: str(body),
  }

  return {
    title,
    body,
    data,
  }
}

/** Strip exchange prefixes like "NASDAQ:NVDA" → "NVDA". */
function normalizeTickerSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9]+:/, '')
    .replace(/[^A-Z0-9.^_-]/g, '')
}

/**
 * Map various sentiment labels → bullish | bearish | neutral.
 */
function mapSentimentToSide(label) {
  const s = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
  if (!s) return null
  if (
    s === 'positive' ||
    s === 'bullish' ||
    s === 'somewhat-bullish' ||
    s === 'buy' ||
    s === 'strongly-bullish'
  ) {
    return 'bullish'
  }
  if (
    s === 'negative' ||
    s === 'bearish' ||
    s === 'somewhat-bearish' ||
    s === 'sell' ||
    s === 'strongly-bearish'
  ) {
    return 'bearish'
  }
  if (s === 'neutral' || s === 'mixed') return 'neutral'
  // numeric score if someone passes it as string
  const n = Number.parseFloat(s)
  if (Number.isFinite(n)) {
    if (n > 0.15) return 'bullish'
    if (n < -0.15) return 'bearish'
    return 'neutral'
  }
  return null
}

/** Arrow for push header: bullish ↑ · bearish ↓ · neutral = no arrow */
function sideArrow(side) {
  if (side === 'bullish') return '↑'
  if (side === 'bearish') return '↓'
  return ''
}

/**
 * Build news push header line:
 *   "NVDA ↑ · AAPL ↓ · MSFT →"
 * Sentiment from raw_json.insights / editor_ticker_details / ticker_sentiment.
 */
function buildNewsImpactBody(article) {
  const raw = article?.raw_json && typeof article.raw_json === 'object' ? article.raw_json : {}
  const sentimentByTicker = new Map()

  const absorb = (ticker, label) => {
    const sym = normalizeTickerSymbol(ticker)
    if (!sym || sentimentByTicker.has(sym)) return
    const side = mapSentimentToSide(label)
    if (side) sentimentByTicker.set(sym, side)
  }

  for (const item of Array.isArray(raw.insights) ? raw.insights : []) {
    absorb(item?.ticker, item?.sentiment || item?.sentiment_label)
  }
  for (const item of Array.isArray(raw.editor_ticker_details)
    ? raw.editor_ticker_details
    : []) {
    absorb(item?.ticker, item?.sentiment_label || item?.sentiment)
  }
  for (const item of Array.isArray(raw.ticker_sentiment) ? raw.ticker_sentiment : []) {
    absorb(
      item?.ticker,
      item?.ticker_sentiment_label || item?.sentiment_label || item?.sentiment,
    )
  }

  const overall =
    mapSentimentToSide(article?.sentiment_label) ||
    mapSentimentToSide(article?.sentiment_score) ||
    'neutral'

  const tickers = Array.isArray(article?.tickers) ? article.tickers : []
  const sides = []
  const seen = new Set()

  for (const t of tickers) {
    const sym = normalizeTickerSymbol(t)
    if (!sym || seen.has(sym)) continue
    seen.add(sym)
    // Prefer bullish/bearish; if only neutral known, still show it.
    const side = sentimentByTicker.get(sym) || overall
    sides.push({ ticker: sym, side, arrow: sideArrow(side) })
  }

  // If article.tickers empty but insights have tickers, use those.
  if (!sides.length) {
    for (const [sym, side] of sentimentByTicker) {
      sides.push({ ticker: sym, side, arrow: sideArrow(side) })
    }
  }

  // Header: "NVDA ↑ · AAPL ↓ · MSFT" (bullish ↑, bearish ↓, neutral = symbol only)
  const body = sides
    .map((s) => (s.arrow ? `${s.ticker} ${s.arrow}` : s.ticker))
    .join(' · ')
  return { body, sides }
}

/**
 * Full headline for push title: collapse whitespace / newlines, never ellipsis-truncate.
 * Keeps the complete article title so the notification shows the full headline.
 */
function normalizeNotificationHeadline(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function sendExpoPushMessages(messages) {
  const tickets = []
  const errors = []
  const expoAccessToken = String(process.env.EXPO_ACCESS_TOKEN || '').trim()

  // Hard gate: even if a caller builds messages without collectPushRecipients,
  // never send outside the allowlist when configured.
  const outbound = applyPushAllowlist(messages || [], (m) => ({
    device_id: m?._device_id,
    expo_push_token: m?.to,
    to: m?.to,
  }))
  if ((messages || []).length > 0 && outbound.length === 0) {
    return {
      tickets: [],
      errors: [
        {
          batch_start: 0,
          failed_count: 0,
          device_ids: [],
          status: 0,
          error:
            'Push allowlist active — no messages matched PUSH_ALLOWLIST_DEVICE_IDS / PUSH_ALLOWLIST_TOKENS',
        },
      ],
      ok: 0,
      failed: 0,
      allowlist_blocked: true,
    }
  }

  for (let i = 0; i < outbound.length; i += EXPO_PUSH_BATCH) {
    const batch = outbound.slice(i, i + EXPO_PUSH_BATCH)
    // Never send internal bookkeeping fields to Expo.
    const payload = batch.map(({ _device_id, ...msg }) => {
      void _device_id
      return msg
    })
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        ...(expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { raw: text }
    }
    if (!response.ok) {
      errors.push({
        batch_start: i,
        failed_count: batch.length,
        device_ids: batch.map((message) => message._device_id).filter(Boolean),
        status: response.status,
        error: body?.errors || body?.error || body?.message || `Expo push failed (${response.status})`,
        response: body,
      })
      continue
    }
    const data = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : []
    for (let j = 0; j < data.length; j += 1) {
      const ticket = data[j] || {}
      const msg = batch[j] || {}
      tickets.push({
        status: ticket.status || 'unknown',
        id: ticket.id || null,
        message: ticket.message || null,
        details: ticket.details || null,
        to: msg.to || null,
        device_id: msg._device_id || null,
      })
    }
  }

  const ok = tickets.filter((t) => t.status === 'ok').length
  const failed =
    tickets.filter((t) => t.status !== 'ok').length +
    errors.reduce((total, error) => total + (error.failed_count || 1), 0)
  return { tickets, errors, ok, failed }
}

/**
 * Same Expo push transport used by Trigger alert / news / digest handlers.
 * Exported so the momentum episode engine can reuse the exact path.
 * @param {Array<Record<string, unknown>>} messages
 */
export async function sendExpoPush(messages) {
  return sendExpoPushMessages(messages)
}

/**
 * Enabled Expo recipients for one ticker from device_monitored_tickers.subscribers.
 * This is the mobile in-app watchlist (synced to Supabase) — source of truth for delivery.
 * Only devices with that exact ticker + app + valid Expo token + notifications on.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} ticker
 * @param {string} [appKey='trigger']
 * @returns {Promise<Array<{ device_id: string|null, expo_push_token: string, enabled: boolean, app_key: string }>>}
 */
export async function loadExpoRecipientsForTicker(supabase, ticker, appKey = 'trigger') {
  const symbol = normalizeTicker(ticker)
  if (!symbol || !supabase) return []

  let { data: rows, error } = await supabase
    .from('device_monitored_tickers')
    .select('ticker, company_name, subscribers')
    .eq('ticker', symbol)

  if (error) throw error
  if (!rows?.length) {
    ;({ data: rows, error } = await supabase
      .from('device_monitored_tickers')
      .select('ticker, company_name, subscribers')
      .ilike('ticker', symbol))
    if (error) throw error
  }

  // Exact ticker match after normalize (ilike can over-match)
  const matched = (rows || []).filter((row) => normalizeTicker(row.ticker) === symbol)
  return collectPushRecipients(matched, appKey)
}

/**
 * Build Expo `data` bag for a Trigger episode alert (string values only — Android bridge).
 * Same deep-link style as notable-move alerts so the Trigger app can open the ticker.
 */
export function buildTriggerEpisodePushData({
  ticker,
  title,
  body,
  eventType,
  direction,
  movePercent,
  price,
  episodeId,
  detectedWindow,
  reason,
  marketSession,
  appKey = 'trigger',
}) {
  const sym = normalizeTicker(ticker) || String(ticker || '').toUpperCase()
  const notificationApp = normalizeNotificationApp(appKey)
  const deepLinkScheme = notificationApp === 'trigger' ? 'trigger' : 'nineam'
  const kind = 'episode_alert'
  const notificationType =
    notificationApp === 'trigger'
      ? `trigger_episode_${String(eventType || 'alert')
          .toLowerCase()
          .replace(/^momentum_/, '')}`
      : `nineam_episode_${String(eventType || 'alert').toLowerCase()}`
  const deepLinkParams = new URLSearchParams({
    kind,
    notification_type: notificationType,
    event_type: String(eventType || ''),
  })
  if (episodeId) deepLinkParams.set('episode_id', String(episodeId))
  const deepLink = `${deepLinkScheme}://ticker/${encodeURIComponent(sym)}?${deepLinkParams.toString()}`
  const str = (v) => (v == null || v === '' ? '' : String(v))

  return {
    type: 'episode_alert',
    notification_type: notificationType,
    movement_type: 'episode',
    kind,
    screen: 'notable_move',
    path: `/ticker/${encodeURIComponent(sym)}`,
    app_key: notificationApp,
    deep_link: deepLink,
    url: deepLink,
    app_url: deepLink,
    ticker: sym,
    company_name: sym,
    event_type: str(eventType),
    direction: str(direction),
    move_percent: str(movePercent),
    price: str(price),
    episode_id: str(episodeId),
    detected_window: str(detectedWindow),
    reason: str(reason),
    market_session: str(marketSession),
    notification_title: str(title),
    notification_body: str(body),
  }
}

/**
 * Send a Trigger episode push via the same Expo pipeline as `/api/notifications/alert/:ticker`.
 * Eligibility: device must currently have `ticker` in its in-app watchlist
 * (device_monitored_tickers.subscribers) for the Trigger app with push enabled.
 *
 * @param {{
 *   supabase: import('@supabase/supabase-js').SupabaseClient|null,
 *   ticker: string,
 *   title: string,
 *   body: string,
 *   eventType?: string,
 *   direction?: string,
 *   movePercent?: number|null,
 *   price?: number|null,
 *   episodeId?: string|null,
 *   detectedWindow?: string|null,
 *   reason?: string|null,
 *   marketSession?: string|null,
 *   appKey?: string,
 *   dryRun?: boolean,
 * }} opts
 */
export async function sendTriggerEpisodePush(opts = {}) {
  const {
    supabase,
    ticker,
    title,
    body,
    eventType = 'MOMENTUM_STARTED',
    direction = '',
    movePercent = null,
    price = null,
    episodeId = null,
    detectedWindow = null,
    reason = null,
    marketSession = null,
    appKey = 'trigger',
    dryRun = false,
  } = opts

  const sym = normalizeTicker(ticker)
  // Final safety: never ship em/en dashes in push copy
  const titleText = formatDashesToCommas(String(title || '').trim())
  const bodyText = formatDashesToCommas(String(body || '').trim())
  if (!sym || !titleText) {
    return {
      ok: false,
      skipped: true,
      reason: 'ticker and title required',
      recipient_count: 0,
      sent_ok: 0,
      sent_failed: 0,
      tickets: [],
      errors: [],
      device_ids: [],
    }
  }

  if (!supabase) {
    return {
      ok: false,
      skipped: true,
      reason: 'supabase not configured',
      recipient_count: 0,
      sent_ok: 0,
      sent_failed: 0,
      tickets: [],
      errors: [],
      device_ids: [],
    }
  }

  // Test mode / env allowlist: only forced tester device(s).
  // Prod: watchlist subscribers + always-notify tester (even if not subscribed).
  const forced = forceAllowlistRecipients(appKey)
  let recipients = []
  let forcedAllowlist = false
  if (forced && forced.length) {
    recipients = forced
    forcedAllowlist = true
  } else {
    try {
      const subs = await loadExpoRecipientsForTicker(supabase, sym, appKey)
      recipients = resolvePushRecipients(subs, appKey)
    } catch (err) {
      // Still deliver to always-notify tester even if watchlist lookup fails
      recipients = resolvePushRecipients([], appKey)
      if (!recipients.length) {
        return {
          ok: false,
          skipped: true,
          reason: err instanceof Error ? err.message : String(err),
          recipient_count: 0,
          sent_ok: 0,
          sent_failed: 0,
          tickets: [],
          errors: [{ error: err instanceof Error ? err.message : String(err) }],
          device_ids: [],
          recipients: [],
        }
      }
    }
  }

  if (!recipients.length) {
    return {
      ok: true,
      skipped: true,
      reason: `No enabled ${normalizeNotificationApp(appKey) === 'trigger' ? 'Trigger' : '9AM'} devices with Expo tokens watching ${sym}`,
      recipient_count: 0,
      sent_ok: 0,
      sent_failed: 0,
      tickets: [],
      errors: [],
      device_ids: [],
      recipients: [],
    }
  }

  const pushData = buildTriggerEpisodePushData({
    ticker: sym,
    title: titleText,
    body: bodyText || titleText,
    eventType,
    direction,
    movePercent,
    price,
    episodeId,
    detectedWindow,
    reason,
    marketSession,
    appKey,
  })

  const messages = recipients.map((r) => ({
    to: r.expo_push_token,
    sound: 'default',
    title: titleText,
    body: bodyText || titleText,
    data: pushData,
    priority: 'high',
    _device_id: r.device_id,
  }))

  const recipientSummaries = recipients.map((r) => ({
    device_id: r.device_id || null,
    expo_push_token: r.expo_push_token,
    expo_push_token_masked: maskExpoToken(r.expo_push_token),
    forced: Boolean(r.forced || forcedAllowlist),
  }))

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      recipient_count: recipients.length,
      sent_ok: 0,
      sent_failed: 0,
      tickets: [],
      errors: [],
      device_ids: recipients.map((r) => r.device_id).filter(Boolean),
      recipients: recipientSummaries,
      forced_allowlist: forcedAllowlist,
      sample: messages[0]
        ? { title: messages[0].title, body: messages[0].body, data: messages[0].data }
        : null,
    }
  }

  const pushResult = await sendExpoPushMessages(messages)
  // Merge ticket status onto recipient rows for UI
  const ticketByDevice = new Map()
  const ticketByToken = new Map()
  for (const t of pushResult.tickets || []) {
    if (t.device_id) ticketByDevice.set(String(t.device_id), t)
    if (t.to) ticketByToken.set(String(t.to), t)
  }
  const recipientsWithStatus = recipientSummaries.map((r) => {
    const ticket =
      (r.device_id && ticketByDevice.get(String(r.device_id))) ||
      ticketByToken.get(String(r.expo_push_token)) ||
      null
    return {
      ...r,
      status: ticket?.status || (pushResult.allowlist_blocked ? 'blocked' : 'unknown'),
      ticket_id: ticket?.id || null,
      error: ticket?.status && ticket.status !== 'ok' ? ticket.message || null : null,
    }
  })

  return {
    ok: pushResult.failed === 0 && pushResult.errors.length === 0,
    skipped: false,
    recipient_count: recipients.length,
    sent_ok: pushResult.ok,
    sent_failed: pushResult.failed,
    tickets: pushResult.tickets,
    errors: pushResult.errors,
    device_ids: recipients.map((r) => r.device_id).filter(Boolean),
    recipients: recipientsWithStatus,
    forced_allowlist: forcedAllowlist,
    deep_link: pushData.deep_link,
    notification_type: pushData.notification_type,
  }
}

function expoFailureSummary(pushResult) {
  const failedTicket = pushResult?.tickets?.find((ticket) => ticket.status !== 'ok')
  if (failedTicket?.message) {
    const code = failedTicket.details?.error
    return code ? `${code}: ${failedTicket.message}` : failedTicket.message
  }
  const gatewayError = pushResult?.errors?.[0]
  const detail = gatewayError?.error
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.message || item?.error || JSON.stringify(item))
      .filter(Boolean)
      .join('; ')
  }
  if (detail && typeof detail === 'object') {
    return detail.message || detail.error || JSON.stringify(detail)
  }
  return ''
}

/**
 * Parse Perplexity finance markdown "Notable Price Movement" section
 * into structured timeline events (past ~30 days when filtered).
 */
export function parseNotablePriceMovements(
  markdown,
  { days = 30, directionsByDate = {} } = {},
) {
  const text = String(markdown || '')
  // Note: JS has no \Z — use $ for end-of-string (do not use \Z or it matches literal "Z").
  const sectionMatch = text.match(
    /##\s*Notable Price Movement\s*\n([\s\S]*?)(?=\n##\s+|\nView more\b|$)/i,
  )
  const section = sectionMatch ? sectionMatch[1] : ''
  if (!section.trim()) {
    return { events: [], sectionFound: Boolean(sectionMatch), rawSection: section }
  }

  const chunks = section.split(
    /(?=^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s*$)/im,
  )
  const now = new Date()
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const events = []

  for (const chunk of chunks) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    const lines = trimmed.split(/\n/).map((line) => line.trim())
    const dateLine = lines[0] || ''
    if (!/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/i.test(dateLine)) {
      continue
    }

    const eventDate = parseDisplayDateToIso(dateLine, now)
    if (!eventDate) continue
    const eventTime = new Date(`${eventDate}T12:00:00.000Z`)
    if (eventTime < cutoff) continue

    let timeLabel = null
    let price = null
    let priceChange = null
    let premarketChange = null
    let afterHoursPrice = null
    let afterHoursChange = null
    let awaitingPremarketChange = false
    let awaitingAfterHoursChange = false
    let awaitingCloseChange = false
    const bodyLines = []

    // Prefer structured Close / After Hours pairs from the full chunk.
    const sessionQuotes = extractSessionQuotesFromChunk(trimmed)
    if (sessionQuotes.close_price) price = sessionQuotes.close_price
    if (sessionQuotes.close_change) priceChange = sessionQuotes.close_change
    if (sessionQuotes.after_hours_price) afterHoursPrice = sessionQuotes.after_hours_price
    if (sessionQuotes.after_hours_change) afterHoursChange = sessionQuotes.after_hours_change
    if (sessionQuotes.premarket_change) premarketChange = sessionQuotes.premarket_change

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i]
      if (!line) continue
      if (/^[·•|–—-]+$/.test(line)) continue
      if (/^\d{1,2}:\d{2}\s*(AM|PM)\s*ET$/i.test(line) && !timeLabel) {
        timeLabel = line
        continue
      }

      // "$1,288.03" — first = close, second distinct price = after hours.
      // If sessionQuotes already set close, don't re-tag the same $ line as AH.
      if (/^\$[\d,]+(?:\.\d+)?$/.test(line)) {
        if (!price) {
          price = line
          continue
        }
        if (!afterHoursPrice && line !== price) {
          afterHoursPrice = line
          continue
        }
        continue
      }

      // "6.03% at Close" / "at Close 6.03%"
      if (/\bat\s*close\b/i.test(line)) {
        const inlineChange = line.match(/[+\-−]?\d+(?:\.\d+)?%/)
        if (inlineChange && !priceChange) {
          priceChange = inlineChange[0].replace(/^−/, '-')
        }
        awaitingCloseChange = !priceChange
        continue
      }
      if (
        awaitingCloseChange &&
        /^[+\-−]?\d+(?:\.\d+)?%$/.test(line) &&
        !priceChange
      ) {
        priceChange = line.replace(/^−/, '-')
        awaitingCloseChange = false
        continue
      }

      // "1.86% After Hours"
      if (/after[\s-]?hours?/i.test(line)) {
        const inlineChange = line.match(/[+\-−]?\d+(?:\.\d+)?%/)
        const labelOnly =
          /^after[\s-]?hours?(?:\s+(?:movement|change|trading))?\s*[:·–—-]?\s*$/i.test(
            line,
          )
        if (inlineChange && !afterHoursChange) {
          afterHoursChange = inlineChange[0].replace(/^−/, '-')
          awaitingAfterHoursChange = false
          continue
        }
        if (labelOnly) {
          awaitingAfterHoursChange = true
          continue
        }
      }
      if (
        awaitingAfterHoursChange &&
        /^[+\-−]?\d+(?:\.\d+)?%$/.test(line) &&
        !afterHoursChange
      ) {
        afterHoursChange = line.replace(/^−/, '-')
        awaitingAfterHoursChange = false
        continue
      }

      if (/pre[\s-]?market/i.test(line)) {
        const inlineChange = line.match(/[+\-−]?\d+(?:\.\d+)?%/)
        const labelOnly =
          /^pre[\s-]?market(?:\s+(?:movement|change))?\s*[:·–—-]?\s*$/i.test(line)
        if (inlineChange && !premarketChange) {
          premarketChange = inlineChange[0].replace(/^−/, '-')
          awaitingPremarketChange = false
          // Keep only the narrative remainder — never the move % itself.
          const narrative = line
            .replace(inlineChange[0], '')
            .replace(/\bpre[\s-]?market\b\s*(?:movement|change)?/i, '')
            .replace(/^[\s:·–—-]+|[\s:·–—-]+$/g, '')
            .trim()
          if (narrative && !isSessionMetricOnlyLine(narrative)) {
            bodyLines.push(narrative)
          }
          continue
        }
        if (labelOnly) {
          awaitingPremarketChange = true
          continue
        }
      }
      if (
        awaitingPremarketChange &&
        /^[+\-−]?\d+(?:\.\d+)?%$/.test(line) &&
        !premarketChange
      ) {
        premarketChange = line.replace(/^−/, '-')
        awaitingPremarketChange = false
        continue
      }
      // Bare percent line = session metric only. Capture as close % if missing,
      // but never put it into the reason body (UI already shows price_change).
      if (/^[+\-−]?\d+(?:\.\d+)?%\s*$/.test(line)) {
        if (!priceChange) priceChange = line.replace(/^−/, '-')
        continue
      }
      if (/^\d+\s+sources?$/i.test(line)) continue
      if (/^!\[/.test(line)) continue
      if (/^View more$/i.test(line)) continue
      // Skip pure session-quote / metric lines from narrative body.
      if (isSessionMetricOnlyLine(line)) continue
      // Source chrome belongs in `sources[]`, never in the reason narrative.
      if (/^https?:\/\//i.test(line)) continue
      if (/^\[[^\]]*\]\(https?:\/\//i.test(line)) continue
      if (/domain=[a-z0-9.-]+\.[a-z]{2,}/i.test(line)) continue
      if (/google\.com\/s2\/favicons/i.test(line)) continue
      // Bare publisher chip like "Bloomberg" / "Reuters" with no sentence structure
      if (/^[A-Za-z0-9][A-Za-z0-9.-]{1,40}\.[a-z]{2,}$/i.test(line)) continue
      if (
        /^(Bloomberg|Reuters|CNBC|WSJ|Wall Street Journal|Financial Times|FT|Barron'?s|MarketWatch|Yahoo Finance|Seeking Alpha|The Verge|TechCrunch|Benzinga|Investor'?s Business Daily|AP|Associated Press|Dow Jones)\s*$/i.test(
          line,
        )
      ) {
        continue
      }
      bodyLines.push(line)
    }

    const sources = extractSources(trimmed)
    // Reason = narrative only. Strip residual move % + any source leakage.
    let summary = stripRedundantMovePercentFromReason(
      bodyLines.join(' ').replace(/\s+/g, ' ').trim(),
      {
        priceChange,
        premarketChange,
        afterHoursChange,
      },
    )
    summary = stripSourceLeakageFromReason(summary, sources)
    const claimedMatch = trimmed.match(/(\d+)\s+sources?/i)
    const claimedSourceCount = claimedMatch ? Number(claimedMatch[1]) : null
    const visualDirections = directionsByDate[eventDate] || {}
    // Close may infer sign from the day's narrative when HTML arrows are missing.
    const signedChange = normalizeSignedChange(
      priceChange,
      summary,
      visualDirections.regular,
    )
    // Pre-market / after-hours: only visual arrow or explicit +/-.
    // Do NOT reuse the close "fell/rose" sentence — that corrupts AH/PM signs.
    const signedPremarketChange = normalizeSignedChange(
      premarketChange,
      null,
      visualDirections.premarket,
    )
    const signedAfterHoursChange = normalizeSignedChange(
      afterHoursChange,
      null,
      visualDirections.after_hours,
    )

    events.push({
      event_date: eventDate,
      display_date: dateLine,
      time_label: timeLabel,
      // Close session
      price,
      price_change: signedChange,
      momentum: signedChange,
      direction: signedChange
        ? visualDirections.regular || inferMoveDirection(summary)
        : null,
      // Pre-market (when present)
      premarket_change: signedPremarketChange,
      premarket_direction: signedPremarketChange
        ? visualDirections.premarket || inferMoveDirection(summary)
        : null,
      // After hours — always persist when scraped
      after_hours_price: afterHoursPrice,
      after_hours_change: signedAfterHoursChange,
      after_hours_direction: signedAfterHoursChange
        ? visualDirections.after_hours || inferMoveDirection(summary)
        : null,
      summary,
      reasons: summary ? [summary] : [],
      sources,
      // Always reflect exact extracted sources — never pad / invent extras.
      source_count: sources.length,
      claimed_source_count: claimedSourceCount,
    })
  }

  // Newest first
  events.sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)))

  return { events, sectionFound: true, rawSection: section }
}

export async function scrapePerplexityNotableMovements(ticker) {
  const cleanTicker = normalizeTicker(ticker)
  if (!cleanTicker) throw new Error('Ticker is required')

  const url = perplexityFinanceUrl(cleanTicker)
  const logs = []
  const pushLog = (level, message, detail) => {
    logs.push({
      at: new Date().toISOString(),
      level,
      message,
      detail: detail ?? null,
    })
  }

  pushLog('info', `Starting Firecrawl scrape for ${cleanTicker}`, { url })

  let creditsBefore = null
  try {
    creditsBefore = await getFirecrawlCreditUsage()
    pushLog('info', 'Firecrawl balance (before scrape)', {
      remaining_credits: creditsBefore.remaining_credits,
      plan_credits: creditsBefore.plan_credits,
      billing_period_end: creditsBefore.billing_period_end,
    })
  } catch (error) {
    pushLog('warn', 'Could not fetch Firecrawl balance before scrape', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const scrapeStarted = Date.now()
  const scrapeBody = await firecrawlFetch('/scrape', {
    method: 'POST',
    body: JSON.stringify({
      url,
      formats: ['markdown', 'html'],
      onlyMainContent: false,
      waitFor: 8000,
      timeout: 90000,
      // Fresh scrape for live finance pages
      maxAge: 0,
      actions: [{ type: 'wait', milliseconds: 4000 }],
    }),
  })
  const scrapeDurationMs = Date.now() - scrapeStarted

  const markdown = scrapeBody?.data?.markdown || ''
  const html = scrapeBody?.data?.html || ''
  const directionsByDate = extractMovementDirectionsFromHtml(html)
  pushLog('info', 'Firecrawl scrape completed', {
    duration_ms: scrapeDurationMs,
    markdown_chars: markdown.length,
    html_chars: html.length,
    visual_directions_found: Object.keys(directionsByDate).length,
    status_code: scrapeBody?.data?.metadata?.statusCode ?? null,
    title: scrapeBody?.data?.metadata?.title ?? null,
  })

  let creditsAfter = null
  let creditsUsed = null
  try {
    creditsAfter = await getFirecrawlCreditUsage()
    if (
      creditsBefore?.remaining_credits != null &&
      creditsAfter?.remaining_credits != null
    ) {
      creditsUsed = Math.max(
        0,
        Number(creditsBefore.remaining_credits) - Number(creditsAfter.remaining_credits),
      )
    }
    pushLog('info', 'Firecrawl balance (after scrape)', {
      remaining_credits: creditsAfter.remaining_credits,
      plan_credits: creditsAfter.plan_credits,
      credits_used_this_scrape: creditsUsed,
      billing_period_end: creditsAfter.billing_period_end,
    })
  } catch (error) {
    pushLog('warn', 'Could not fetch Firecrawl balance after scrape', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const parsed = parseNotablePriceMovements(markdown, {
    days: 30,
    directionsByDate,
  })
  pushLog(
    parsed.events.length ? 'success' : 'warn',
    parsed.sectionFound
      ? `Parsed ${parsed.events.length} notable movement event(s) in past 30 days`
      : 'Notable Price Movement section not found in page markdown',
    { event_count: parsed.events.length },
  )

  // Log exact per-event sources + signed change for the right-side log panel.
  for (const event of parsed.events.slice(0, 40)) {
    pushLog('info', `${event.event_date} · change ${event.price_change || 'n/a'} · ${event.sources.length} source(s)`, {
      event_date: event.event_date,
      price: event.price,
      price: event.price,
      price_change: event.price_change,
      premarket_change: event.premarket_change,
      after_hours_price: event.after_hours_price,
      after_hours_change: event.after_hours_change,
      claimed_source_count: event.claimed_source_count,
      extracted_source_count: event.sources.length,
      sources: event.sources,
    })
  }

  return {
    ticker: cleanTicker,
    url,
    scraped_at: new Date().toISOString(),
    events: parsed.events,
    section_found: parsed.sectionFound,
    asset_class: 'equity',
    scrape_source: 'perplexity',
    source_provider: 'perplexity',
    credits: {
      before: creditsBefore,
      after: creditsAfter,
      used: creditsUsed,
    },
    logs,
    markdown_preview: markdown.slice(0, 4000),
  }
}

/**
 * Map asset class → Supabase table for Perplexity momentum research saves.
 * Five isolated tables (stocks / commodities / forex / crypto / indexes).
 */
export function momentumResearchTableForAssetClass(assetClass) {
  const cls = String(assetClass || 'equity')
    .trim()
    .toLowerCase()
  if (cls === 'commodity') return 'momentum_research_commodities'
  if (cls === 'forex' || cls === 'fx' || cls === 'currency') {
    return 'momentum_research_forex'
  }
  if (cls === 'crypto' || cls === 'cryptocurrency') {
    return 'momentum_research_crypto'
  }
  if (cls === 'index' || cls === 'indices' || cls === 'etf') {
    return 'momentum_research_indexes'
  }
  // equity / stock / default
  return 'momentum_research_monitored_stocks'
}

function extractSecondaryDriverFromReason(reason) {
  const text = String(reason || '')
  const m = text.match(
    /^secondary\s*driver\s*:\s*(.+?)(?=\n\s*(?:move\s*classification|confidence)\s*:|\n\s*$)/ims,
  )
  if (!m) return null
  return m[1].replace(/\s+/g, ' ').trim() || null
}

/**
 * Persist a successful Perplexity momentum research run to the asset-class table.
 */
export async function saveMomentumResearchRow(supabase, payload = {}) {
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured' }
  }
  const assetClass = String(payload.asset_class || 'equity').toLowerCase()
  const table = momentumResearchTableForAssetClass(assetClass)
  const movePercent = Number(payload.move_percent)
  const costUsd = Number(
    payload.cost?.total_cost ??
      payload.cost_usd ??
      String(payload.cost_usd_display || '')
        .replace(/[^0-9.eE+-]/g, ''),
  )
  const row = {
    ticker: String(payload.ticker || '').toUpperCase(),
    company_name: payload.company_name || null,
    asset_class: assetClass,
    event_date: payload.event_date || todayIsoEastern(),
    window_key: payload.window_key || null,
    window_label: payload.window_label || null,
    exact_label: payload.exact_label || null,
    exact_minutes: Number.isFinite(Number(payload.exact_minutes))
      ? Number(payload.exact_minutes)
      : null,
    move_percent: Number.isFinite(movePercent) ? movePercent : null,
    user_movement: payload.user_movement || null,
    market_session: payload.market_session || null,
    live_price:
      payload.live_price != null && Number.isFinite(Number(payload.live_price))
        ? Number(payload.live_price)
        : null,
    reference_price:
      payload.reference_price != null &&
      Number.isFinite(Number(payload.reference_price))
        ? Number(payload.reference_price)
        : null,
    reference_time: payload.reference_time || null,
    headline: payload.headline || null,
    likely_driver: payload.likely_driver || null,
    secondary_driver:
      payload.secondary_driver ||
      extractSecondaryDriverFromReason(payload.reason) ||
      null,
    reason: String(payload.reason || '').trim() || '(empty)',
    push_title: payload.push_title || null,
    push_body: payload.push_body || null,
    model: payload.model || null,
    model_version: payload.model_version || null,
    request_id: payload.request_id || null,
    provider: payload.provider || 'perplexity',
    citations: Array.isArray(payload.citations) ? payload.citations : [],
    search_results: Array.isArray(payload.search_results)
      ? payload.search_results
      : [],
    tools: Array.isArray(payload.tools) ? payload.tools : [],
    tokens: payload.tokens || null,
    cost: payload.cost || null,
    cost_usd: Number.isFinite(costUsd) ? costUsd : null,
    cost_usd_display: payload.cost_usd_display || null,
    prompt: payload.prompt || null,
    input_facts: payload.input_facts || null,
    process_steps: Array.isArray(payload.process_steps)
      ? payload.process_steps
      : null,
  }

  if (!row.ticker) {
    return { ok: false, error: 'ticker required to save research', table }
  }

  const { data, error } = await supabase
    .from(table)
    .insert(row)
    .select('id, created_at')
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      error: error.message || String(error),
      table,
      code: error.code || null,
    }
  }
  return {
    ok: true,
    table,
    id: data?.id || null,
    created_at: data?.created_at || null,
  }
}

export function createNotificationsRouter({ getSupabase }) {
  // Express 5-compatible router factory without depending on express import order.
  // Use a const object so marketCloseJob can call sibling handlers (scrape, gemini, digest).
  const handlers = {
    async listTickers(request, response) {
      try {
        const appKey = normalizeNotificationApp(request.query?.app)
        const supabase = getSupabase()
        let data = null
        let error = null

        ;({ data, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, company_name, created_at, updated_at, notable_price_movements, subscribers')
          .order('ticker', { ascending: true }))

        // Column may not exist until schema_device_monitored_tickers.sql is applied.
        if (error && /notable_price_movements/i.test(error.message || '')) {
          ;({ data, error } = await supabase
            .from('device_monitored_tickers')
            .select('ticker, company_name, created_at, updated_at, subscribers')
            .order('ticker', { ascending: true }))
        }

        if (error) throw error

        // Deduplicate device rows by ticker; merge date maps so one tab = one ticker.
        const byTicker = new Map()
        for (const row of data || []) {
          const ticker = normalizeTicker(row.ticker)
          if (!ticker) continue
          const dates = extractDatesMap(row.notable_price_movements)
          const recipients = collectPushRecipients([row], appKey)
          const existing = byTicker.get(ticker)
          if (!existing) {
            byTicker.set(ticker, {
              ticker,
              company_name: row.company_name || ticker,
              created_at: row.created_at,
              updated_at: row.updated_at,
              dates: { ...dates },
              last_saved_at: row.notable_price_movements?.updated_at || null,
              recipients: recipients.slice(),
            })
            continue
          }
          // Prefer richer date payloads (Gemini / complete metrics) — do not
          // let a sparse device row clobber a full timeline event.
          existing.dates = mergeDateMaps(existing.dates, dates)
          if (row.company_name && existing.company_name === ticker) {
            existing.company_name = row.company_name
          }
          const rowSavedAt = row.notable_price_movements?.updated_at || null
          if (
            rowSavedAt &&
            (!existing.last_saved_at || String(rowSavedAt) > String(existing.last_saved_at))
          ) {
            existing.last_saved_at = rowSavedAt
          }
          const seen = new Set(existing.recipients.map((r) => r.expo_push_token))
          for (const r of recipients) {
            if (!seen.has(r.expo_push_token)) {
              existing.recipients.push(r)
              seen.add(r.expo_push_token)
            }
          }
        }

        // Users list = only tickers that have ≥1 enabled device for this app.
        // Zero-subscriber / dashboard-only / Extreme-pinned rows must not appear here.
        const includeZero = ['1', 'true', 'yes'].includes(
          String(request.query?.include_zero || '').toLowerCase(),
        )

        const tickers = [...byTicker.values()]
          .map((item) => {
            const saved_event_count = Object.keys(item.dates).length
            const classification = classifyAsset(item.ticker, item.company_name)
            const teTarget =
              classification.scrape_source === 'trading_economics'
                ? resolveTradingEconomicsTarget(item.ticker, item.company_name)
                : null
            const saved_events = Object.values(item.dates)
              .map((event) => normalizeEventRow(event))
              .filter(Boolean)
              .sort((left, right) =>
                String(right.event_date).localeCompare(String(left.event_date)),
              )
              .map((event) => ({ ...event, save_status: 'saved' }))
            const gemini_usage = sumGeminiUsageFromDates(saved_events)
            return {
              ticker: item.ticker,
              company_name: item.company_name,
              created_at: item.created_at,
              updated_at: item.updated_at,
              has_saved_movements: saved_event_count > 0,
              saved_event_count,
              last_saved_at: item.last_saved_at,
              saved_dates: Object.keys(item.dates).sort().reverse(),
              saved_events,
              gemini_usage,
              gemini_total_tokens: gemini_usage.total_tokens,
              gemini_credits_used: gemini_usage.credits_used,
              gemini_cost_usd: gemini_usage.cost_usd,
              gemini_cost_usd_display: gemini_usage.cost_usd_display,
              subscriber_count: item.recipients.length,
              device_ids: item.recipients.map((r) => r.device_id).filter(Boolean),
              asset_class: classification.asset_class,
              scrape_source: classification.scrape_source,
              source_url:
                classification.scrape_source === 'trading_economics'
                  ? teTarget?.url || null
                  : perplexityFinanceUrl(item.ticker),
            }
          })
          .filter((item) => includeZero || (item.subscriber_count ?? 0) > 0)
          .sort((a, b) => a.ticker.localeCompare(b.ticker))

        const gemini_totals = sumGeminiUsageFromDates(
          tickers.flatMap((t) => t.saved_events || []),
        )
        response.json({
          ok: true,
          app_key: appKey,
          count: tickers.length,
          tickers,
          gemini_totals,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to load monitored tickers',
        })
      }
    },

    /**
     * Ensure a ticker exists in device_monitored_tickers so scrape/save work.
     * Used by the dashboard sidebar: Yahoo search → + add.
     * Body: { ticker, company_name? }
     */
    async addTicker(request, response) {
      try {
        const ticker = normalizeTicker(request.body?.ticker || request.params?.ticker)
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }

        const companyName =
          String(request.body?.company_name || request.body?.companyName || '')
            .trim() || ticker

        const classification = classifyAsset(ticker, companyName)
        if (classification.asset_class && classification.asset_class !== 'equity') {
          response.status(400).json({
            error: `Only equity tickers can be added to the stocks list (got ${classification.asset_class}).`,
          })
          return
        }

        const supabase = getSupabase()
        const loaded = await loadTickerDates(supabase, ticker)
        if (loaded.found) {
          const meta = await loadTickerMeta(supabase, ticker)
          response.json({
            ok: true,
            created: false,
            already_exists: true,
            ticker,
            company_name: meta.company_name || companyName,
          })
          return
        }

        const nowIso = new Date().toISOString()
        const notable = buildNotablePayload({
          ticker,
          dates: {},
          sourceUrl: perplexityFinanceUrl(ticker),
          scrapedAt: null,
          nowIso,
          sourceProvider: 'perplexity',
          assetClass: 'equity',
        })

        const baseRow = {
          ticker,
          company_name: companyName,
          subscribers: [],
          notable_price_movements: notable,
          updated_at: nowIso,
        }

        // Try a few insert shapes — table schema varies slightly across deploys.
        const candidates = [
          baseRow,
          { ...baseRow, created_at: nowIso },
          { ...baseRow, device_id: 'dashboard' },
          { ...baseRow, device_id: 'dashboard', created_at: nowIso },
        ]

        let data = null
        let lastError = null
        for (const row of candidates) {
          const result = await supabase
            .from('device_monitored_tickers')
            .insert(row)
            .select('ticker, company_name, created_at, updated_at')
            .limit(1)
          if (!result.error) {
            data = result.data
            lastError = null
            break
          }
          lastError = result.error
          // Already inserted by a concurrent request
          if (/duplicate|unique/i.test(result.error.message || '')) {
            lastError = null
            data = [{ ticker, company_name: companyName, created_at: nowIso, updated_at: nowIso }]
            break
          }
        }

        if (lastError) throw lastError

        const row = Array.isArray(data) ? data[0] : data
        response.status(201).json({
          ok: true,
          created: true,
          already_exists: false,
          ticker: row?.ticker || ticker,
          company_name: row?.company_name || companyName,
          created_at: row?.created_at || nowIso,
          updated_at: row?.updated_at || nowIso,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to add monitored ticker',
        })
      }
    },

    async scrape(request, response) {
      try {
        const ticker = normalizeTicker(request.params.ticker || request.body?.ticker)
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }

        // ?auto_save=0 disables the default save of all new/content-changed dates.
        const autoSaveRaw = request.query?.auto_save
        const autoSave =
          autoSaveRaw === undefined || autoSaveRaw === null || autoSaveRaw === ''
            ? true
            : !['0', 'false', 'no'].includes(String(autoSaveRaw).toLowerCase())
        const monitorScope = resolveMonitorScope(request)
        const monitorTable = monitorTableForScope(monitorScope)

        const supabase = getSupabase()
        const meta = await loadTickerMeta(supabase, ticker, monitorScope)
        const companyName =
          (request.body?.company_name && String(request.body.company_name).trim()) ||
          meta.company_name ||
          ticker
        const route = classifyAsset(ticker, companyName)

        const result = await scrapeNotableMovementsForTicker(ticker, { companyName })
        result.logs = Array.isArray(result.logs) ? result.logs : []
        result.logs.unshift({
          at: new Date().toISOString(),
          level: 'info',
          message:
            route.scrape_source === 'trading_economics'
              ? `Routed ${ticker} → Trading Economics (${route.asset_class})`
              : `Routed ${ticker} → Perplexity finance (equity)`,
          detail: {
            asset_class: route.asset_class,
            scrape_source: route.scrape_source,
            reason: route.reason,
            company_name: companyName,
            source_url: result.url,
            monitor_scope: monitorScope,
            monitor_table: monitorTable,
          },
        })

        // Extreme/Pinned: only write to pinned_monitored_tickers when the row already
        // exists (user clicked Pin) or the client explicitly asks to create.
        // Never create a Users/device_monitored_tickers row from this path.
        // Never auto-pin just because Extreme scrape ran.
        let loaded = await loadTickerDates(supabase, ticker, monitorScope)
        const createPinnedIfMissing =
          monitorScope === 'pinned' &&
          (request.body?.create_if_missing === true ||
            request.body?.create_if_missing === 1 ||
            request.body?.create_if_missing === '1' ||
            request.query?.create_if_missing === '1' ||
            request.query?.create_if_missing === 'true')
        if (!loaded.found && createPinnedIfMissing) {
          const ensured = await ensureMonitorTickerRow(supabase, ticker, {
            companyName,
            scope: 'pinned',
          })
          loaded = ensured.loaded
          result.logs.push({
            at: new Date().toISOString(),
            level: 'info',
            message: `Created ${ticker} in ${monitorTable} (Pinned store only · not Users)`,
            detail: { created: ensured.created, monitor_scope: 'pinned' },
          })
        }

        const classified = classifyEventsAgainstSaved(result.events, loaded.dates)

        result.logs.push({
          at: new Date().toISOString(),
          level: 'info',
          message: `Compared scrape vs Supabase (date + time ET) for ${ticker}`,
          detail: {
            already_in_db: Object.keys(loaded.dates).length,
            scrape_total: classified.summary.total,
            new: classified.summary.new,
            changed: classified.summary.changed,
            already_saved: classified.summary.already_saved,
            compare_mode: classified.summary.compare_mode,
            today_et: classified.summary.today_et,
            scrape_source: result.scrape_source || route.scrape_source,
            asset_class: result.asset_class || route.asset_class,
            monitor_scope: monitorScope,
            monitor_table: monitorTable,
            change_reasons: classified.events
              .filter((e) => e.save_status === 'changed' || e.change_reason)
              .map((e) => ({
                date: e.event_date,
                status: e.save_status,
                reason: e.change_reason || null,
                prev_time: e.previous_time_label || null,
                scrape_time: e.time_label || null,
              })),
          },
        })

        let autoSaveResult = null
        const pendingAutoSaveCount = classified.summary.new + classified.summary.changed
        if (autoSave && pendingAutoSaveCount > 0) {
          if (!loaded.found) {
            autoSaveResult = {
              ok: false,
              mode: 'new_and_changed_dates',
              inserted: 0,
              updated: 0,
              message: `Auto-save skipped — ${ticker} not found in ${monitorTable}`,
              monitor_scope: monitorScope,
            }
            result.logs.push({
              at: new Date().toISOString(),
              level: 'warn',
              message: autoSaveResult.message,
              detail: null,
            })
          } else {
            try {
              const nowIso = new Date().toISOString()
              const pendingEvents = classified.events.filter(
                (event) => event.save_status === 'new' || event.save_status === 'changed',
              )
              const insertedDates = pendingEvents
                .filter((event) => event.save_status === 'new')
                .map((event) => event.event_date)
              const updatedDates = pendingEvents
                .filter((event) => event.save_status === 'changed')
                .map((event) => event.event_date)
              const { dates, written } = mergeDatesIntoMap(
                loaded.dates,
                pendingEvents,
                nowIso,
              )
              const payload = buildNotablePayload({
                ticker,
                dates,
                sourceUrl: result.url,
                scrapedAt: result.scraped_at,
                nowIso,
                sourceProvider: result.source_provider || route.scrape_source,
                assetClass: result.asset_class || route.asset_class,
              })
              const rows = await persistTickerDates(
                supabase,
                ticker,
                payload,
                monitorScope,
              )
              autoSaveResult = {
                ok: true,
                mode: 'new_and_changed_dates',
                inserted: insertedDates.length,
                updated: updatedDates.length,
                inserted_dates: insertedDates,
                updated_dates: updatedDates,
                unchanged: classified.summary.already_saved,
                total_saved_events: Object.keys(dates).length,
                monitor_scope: monitorScope,
                monitor_table: monitorTable,
                message:
                  written.length > 0
                    ? `Auto-saved ${insertedDates.length} new and ${updatedDates.length} updated date(s) to ${monitorTable}.`
                    : 'No new or changed dates to auto-save.',
                rows_updated: rows.length,
              }
              result.logs.push({
                at: new Date().toISOString(),
                level: 'success',
                message: autoSaveResult.message,
                detail: {
                  inserted_dates: insertedDates,
                  updated_dates: updatedDates,
                  total_saved_events: autoSaveResult.total_saved_events,
                  rows_updated: rows.length,
                  structure: 'notable_price_movements.dates[YYYY-MM-DD]',
                  monitor_scope: monitorScope,
                  monitor_table: monitorTable,
                },
              })

              // Only mark as saved in UI after a real DB write succeeded.
              const after = classifyEventsAgainstSaved(result.events, dates)
              classified.events = after.events
              classified.summary = after.summary
            } catch (saveError) {
              // Scrape still succeeds — surface auto-save failure clearly.
              const message =
                saveError instanceof Error ? saveError.message : 'Auto-save to Supabase failed'
              autoSaveResult = {
                ok: false,
                mode: 'new_and_changed_dates',
                inserted: 0,
                updated: 0,
                message,
                monitor_scope: monitorScope,
              }
              result.logs.push({
                at: new Date().toISOString(),
                level: 'error',
                message: `Auto-save failed: ${message}`,
                detail: null,
              })
            }
          }
        } else if (autoSave && pendingAutoSaveCount === 0) {
          autoSaveResult = {
            ok: true,
            mode: 'new_and_changed_dates',
            inserted: 0,
            updated: 0,
            inserted_dates: [],
            updated_dates: [],
            unchanged: classified.summary.already_saved,
            total_saved_events: Object.keys(loaded.dates).length,
            message:
              classified.summary.total === 0
                ? 'Nothing to save — no events in scrape.'
                : `No new or changed dates to write — ${classified.summary.already_saved} already in Supabase.`,
          }
          result.logs.push({
            at: new Date().toISOString(),
            level: 'info',
            message: autoSaveResult.message,
            detail: classified.summary,
          })
        }

        // Ledger Firecrawl credits for daily spend popup (credits only).
        if (result?.credits?.used != null && Number(result.credits.used) > 0) {
          void recordFirecrawlUsage(supabase, {
            ticker,
            credits_used: result.credits.used,
            remaining_after: result.credits.after?.remaining_credits ?? null,
            plan_credits: result.credits.after?.plan_credits ?? null,
            meta: { source: result.scrape_source || route.scrape_source },
          })
        }

        response.json({
          ok: true,
          ...result,
          events: classified.events,
          compare: classified.summary,
          auto_save: autoSaveResult,
          monitor_scope: monitorScope,
          monitor_table: monitorTable,
        })
      } catch (error) {
        response.status(error.status && error.status < 500 ? error.status : 500).json({
          error: error instanceof Error ? error.message : 'Scrape failed',
          detail: error.body || null,
        })
      }
    },

    async save(request, response) {
      try {
        const ticker = normalizeTicker(request.params.ticker || request.body?.ticker)
        const events = Array.isArray(request.body?.events) ? request.body.events : []
        // Default: only new + content-changed. Pass only_new=true to skip updates.
        const onlyNew = Boolean(request.body?.only_new)
        const monitorScope = resolveMonitorScope(request)
        const monitorTable = monitorTableForScope(monitorScope)
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }
        if (!events.length) {
          response.status(400).json({ error: 'No events to save. Refresh/scrape first.' })
          return
        }

        const supabase = getSupabase()
        let loaded = await loadTickerDates(supabase, ticker, monitorScope)
        if (!loaded.found) {
          const allowCreatePinned =
            monitorScope === 'pinned' &&
            (request.body?.create_if_missing === true ||
              request.body?.create_if_missing === 1 ||
              request.body?.create_if_missing === '1')
          if (allowCreatePinned) {
            const companyName =
              String(request.body?.company_name || '').trim() || ticker
            const ensured = await ensureMonitorTickerRow(supabase, ticker, {
              companyName,
              scope: 'pinned',
            })
            loaded = ensured.loaded
          } else {
            response.status(404).json({
              error:
                monitorScope === 'pinned'
                  ? `Ticker ${ticker} is not pinned yet. Pin from Extreme first (Pinned tab · not Users).`
                  : `Ticker ${ticker} not found in ${monitorTable}`,
            })
            return
          }
        }

        const classified = classifyEventsAgainstSaved(events, loaded.dates)
        const toWrite = classified.events.filter((event) =>
          onlyNew ? event.save_status === 'new' : event.save_status === 'new' || event.save_status === 'changed',
        )
        const skippedSaved = classified.events.filter((e) => e.save_status === 'saved')

        if (!toWrite.length) {
          response.json({
            ok: true,
            ticker,
            changed: false,
            mode: onlyNew ? 'new_dates_only' : 'new_and_changed',
            inserted: 0,
            updated: 0,
            skipped_already_saved: skippedSaved.length,
            inserted_dates: [],
            updated_dates: [],
            total_saved_events: Object.keys(loaded.dates).length,
            monitor_scope: monitorScope,
            monitor_table: monitorTable,
            message:
              skippedSaved.length > 0
                ? `No writes — all ${skippedSaved.length} date(s) already saved with the same content.`
                : 'No events to save.',
            structure: 'notable_price_movements.dates[YYYY-MM-DD]',
            dates: Object.keys(loaded.dates).sort().reverse(),
          })
          return
        }

        const nowIso = new Date().toISOString()
        const insertedDates = toWrite
          .filter((e) => e.save_status === 'new')
          .map((e) => e.event_date)
        const updatedDates = toWrite
          .filter((e) => e.save_status === 'changed')
          .map((e) => e.event_date)

        const { dates, written } = mergeDatesIntoMap(loaded.dates, toWrite, nowIso)
        const meta = await loadTickerMeta(supabase, ticker, monitorScope)
        const route = classifyAsset(ticker, meta.company_name)
        const teUrl =
          route.scrape_source === 'trading_economics'
            ? resolveTradingEconomicsTarget(ticker, meta.company_name).url
            : null
        const payload = buildNotablePayload({
          ticker,
          dates,
          sourceUrl:
            request.body?.source_url ||
            teUrl ||
            perplexityFinanceUrl(ticker),
          scrapedAt: request.body?.scraped_at || nowIso,
          nowIso,
          sourceProvider:
            request.body?.source_provider ||
            route.scrape_source ||
            null,
          assetClass: request.body?.asset_class || route.asset_class || null,
        })
        const rows = await persistTickerDates(supabase, ticker, payload, monitorScope)

        response.json({
          ok: true,
          ticker,
          changed: true,
          mode: onlyNew ? 'new_dates_only' : 'new_and_changed',
          inserted: insertedDates.length,
          updated: updatedDates.length,
          skipped_already_saved: skippedSaved.length,
          inserted_dates: insertedDates,
          updated_dates: updatedDates,
          written_dates: written,
          total_saved_events: Object.keys(dates).length,
          monitor_scope: monitorScope,
          monitor_table: monitorTable,
          message: [
            insertedDates.length
              ? `Inserted ${insertedDates.length} new date(s): ${insertedDates.join(', ')}`
              : null,
            updatedDates.length
              ? `Updated ${updatedDates.length} changed date(s): ${updatedDates.join(', ')}`
              : null,
            skippedSaved.length
              ? `Skipped ${skippedSaved.length} already-saved date(s)`
              : null,
          ]
            .filter(Boolean)
            .join('. ') + '.',
          structure: 'notable_price_movements.dates[YYYY-MM-DD]',
          dates: Object.keys(dates).sort().reverse(),
          rows_updated: rows.length,
          row: rows[0] || null,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Save failed',
        })
      }
    },

    /**
     * Extreme → Pinned list (pinned_monitored_tickers). Independent of Users/subscribers.
     */
    async listPinnedTickers(_request, response) {
      try {
        const supabase = getSupabase()
        const { data, error } = await supabase
          .from(MONITOR_TABLE_PINNED)
          .select('ticker, company_name, notable_price_movements, pinned_at, created_at, updated_at')
          .order('updated_at', { ascending: false })

        if (error) {
          if (/does not exist|relation|42P01/i.test(error.message || '')) {
            response.status(503).json({
              error:
                'pinned_monitored_tickers table missing. Run supabase/schema_pinned_monitored_tickers.sql in Supabase.',
              code: 'pinned_table_missing',
            })
            return
          }
          throw error
        }

        const tickers = (data || []).map((row) => {
          const dates = extractDatesMap(row.notable_price_movements)
          const events = Object.values(dates)
            .map((event) => normalizeEventRow(event))
            .filter(Boolean)
            .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)))
          return {
            ticker: String(row.ticker || '').toUpperCase(),
            company_name: row.company_name || row.ticker,
            pinned_at: row.pinned_at || row.created_at || null,
            created_at: row.created_at || null,
            updated_at: row.updated_at || null,
            has_saved_movements: events.length > 0,
            saved_event_count: events.length,
            last_saved_at: row.notable_price_movements?.updated_at || row.updated_at || null,
            subscriber_count: 0,
            device_ids: [],
            saved_events: events,
            asset_class: 'equity',
            scrape_source: 'perplexity',
            monitor_scope: 'pinned',
          }
        })

        response.json({
          ok: true,
          monitor_scope: 'pinned',
          monitor_table: MONITOR_TABLE_PINNED,
          count: tickers.length,
          tickers,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to load pinned tickers',
        })
      }
    },

    async addPinnedTicker(request, response) {
      try {
        const ticker = normalizeTicker(request.body?.ticker || request.params?.ticker)
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }
        const companyName =
          String(request.body?.company_name || request.body?.companyName || '')
            .trim() || ticker
        const supabase = getSupabase()
        const ensured = await ensureMonitorTickerRow(supabase, ticker, {
          companyName,
          scope: 'pinned',
        })
        // Touch company_name / pinned_at if already existed
        if (!ensured.created) {
          await supabase
            .from(MONITOR_TABLE_PINNED)
            .update({
              company_name: companyName,
              updated_at: new Date().toISOString(),
            })
            .eq('ticker', ticker)
        }
        response.status(ensured.created ? 201 : 200).json({
          ok: true,
          created: ensured.created,
          already_exists: !ensured.created,
          ticker,
          company_name: companyName,
          monitor_scope: 'pinned',
          monitor_table: MONITOR_TABLE_PINNED,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to pin ticker'
        const status = /does not exist|relation|42P01/i.test(message) ? 503 : 500
        response.status(status).json({
          error: message,
          hint:
            status === 503
              ? 'Run supabase/schema_pinned_monitored_tickers.sql in Supabase SQL editor.'
              : undefined,
        })
      }
    },

    async removePinnedTicker(request, response) {
      try {
        const ticker = normalizeTicker(request.params?.ticker || request.body?.ticker)
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }
        const supabase = getSupabase()
        const { error } = await supabase
          .from(MONITOR_TABLE_PINNED)
          .delete()
          .eq('ticker', ticker)
        if (error) throw error
        response.json({
          ok: true,
          ticker,
          removed: true,
          monitor_scope: 'pinned',
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to unpin ticker',
        })
      }
    },

    async credits(_request, response) {
      try {
        const usage = await getFirecrawlCreditUsage()
        response.json({ ok: true, credits: usage })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Credit usage fetch failed',
        })
      }
    },

    /**
     * App release config from public.app_releases (ios | android | all).
     * Query: ?id=ios optional — omit to list all rows.
     */
    async getAppSettings(request, response) {
      try {
        const supabase = getSupabase()
        const id = String(request.query?.id || request.body?.id || '')
          .trim()
          .toLowerCase()

        let query = supabase
          .from('app_releases')
          .select(
            'id, min_version, min_build, latest_version, latest_build, force_update, title, message, store_url, check_eas_update, enabled, updated_at',
          )
          .order('id', { ascending: true })

        if (id) query = query.eq('id', id)

        const { data, error } = id ? await query.maybeSingle() : await query

        if (error) {
          const code = String(error.code || '')
          const msg = String(error.message || '')
          const missing =
            code === 'PGRST205' ||
            code === '42P01' ||
            (/could not find the table/i.test(msg) && /app_releases/i.test(msg)) ||
            (/relation .*app_releases.* does not exist/i.test(msg)) ||
            (/schema cache/i.test(msg) && /app_releases/i.test(msg))
          if (missing) {
            response.status(503).json({
              ok: false,
              error: 'Table public.app_releases is missing or not readable.',
              needs_schema: true,
              details: msg || null,
              code: code || null,
            })
            return
          }
          response.status(500).json({
            ok: false,
            error: msg || 'Failed to load app releases',
            code: code || null,
          })
          return
        }

        if (id) {
          response.json({
            ok: true,
            id,
            settings: data || null,
            releases: data ? [data] : [],
          })
          return
        }

        response.json({
          ok: true,
          releases: Array.isArray(data) ? data : [],
          settings: Array.isArray(data) ? data[0] || null : data,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to load app releases',
        })
      }
    },

    /**
     * Update one app_releases row by id (ios | android | all).
     * Body maps to latest_version / latest_build (current release) and optional min_* / force_update / copy fields.
     * Upserts if the row does not exist yet.
     *
     * Writes require SUPABASE_SERVICE_ROLE_KEY (or RLS policies that allow update/insert).
     * With the publishable/anon key alone, SELECT usually works but UPDATE is blocked by RLS.
     */
    async updateAppSettings(request, response) {
      try {
        const id = String(request.body?.id || request.query?.id || '')
          .trim()
          .toLowerCase()
        if (!id) {
          response.status(400).json({ error: 'id is required (ios | android | all)' })
          return
        }
        if (!['ios', 'android', 'all'].includes(id)) {
          response.status(400).json({ error: 'id must be ios, android, or all' })
          return
        }

        const latestVersion = String(
          request.body?.latest_version ??
            request.body?.version ??
            request.body?.current_version ??
            '',
        ).trim()
        const latestBuildRaw =
          request.body?.latest_build ??
          request.body?.build_number ??
          request.body?.buildNumber ??
          request.body?.current_build
        const minVersion =
          request.body?.min_version != null
            ? String(request.body.min_version).trim()
            : undefined
        const minBuildRaw =
          request.body?.min_build != null ? request.body.min_build : undefined

        const parseBuild = (value) => {
          if (value === undefined || value === null || value === '') return null
          const n = Number.parseInt(String(value).trim(), 10)
          return Number.isFinite(n) ? n : null
        }

        const latestBuild = parseBuild(latestBuildRaw)
        const minBuild = minBuildRaw === undefined ? undefined : parseBuild(minBuildRaw)

        if (!latestVersion && latestBuild == null && minVersion === undefined && minBuild === undefined) {
          response.status(400).json({
            error: 'Provide at least latest_version or latest_build (or min_* fields)',
          })
          return
        }

        // Do not put primary key `id` in the update body — only use it in .eq().
        const patch = {
          updated_at: new Date().toISOString(),
        }
        if (latestVersion) patch.latest_version = latestVersion
        if (latestBuild != null) patch.latest_build = latestBuild
        if (minVersion !== undefined) patch.min_version = minVersion || '0.0.0'
        if (minBuild !== undefined && minBuild != null) patch.min_build = minBuild
        if (typeof request.body?.force_update === 'boolean') {
          patch.force_update = request.body.force_update
        }
        if (request.body?.title !== undefined) {
          patch.title = request.body.title == null ? null : String(request.body.title).trim() || null
        }
        if (request.body?.message !== undefined) {
          patch.message =
            request.body.message == null ? null : String(request.body.message).trim() || null
        }
        if (request.body?.store_url !== undefined) {
          patch.store_url =
            request.body.store_url == null
              ? null
              : String(request.body.store_url).trim() || null
        }
        if (typeof request.body?.check_eas_update === 'boolean') {
          patch.check_eas_update = request.body.check_eas_update
        }
        if (typeof request.body?.enabled === 'boolean') {
          patch.enabled = request.body.enabled
        }

        const supabase = getSupabase()
        const usingServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
        const selectCols =
          'id, min_version, min_build, latest_version, latest_build, force_update, title, message, store_url, check_eas_update, enabled, updated_at'

        const rlsWriteDenied = (error) => {
          if (!error) return false
          const code = String(error.code || '')
          const msg = String(error.message || '')
          return (
            code === '42501' ||
            code === 'PGRST301' ||
            /row-level security/i.test(msg) ||
            /permission denied/i.test(msg) ||
            /violates row-level security/i.test(msg)
          )
        }

        const tableMissing = (error) => {
          if (!error) return false
          const code = String(error.code || '')
          const msg = String(error.message || '')
          return (
            code === 'PGRST205' ||
            code === '42P01' ||
            (/could not find the table/i.test(msg) && /app_releases/i.test(msg)) ||
            /relation .*app_releases.* does not exist/i.test(msg) ||
            (/schema cache/i.test(msg) && /app_releases/i.test(msg))
          )
        }

        const permissionHelp =
          'Writes to app_releases are blocked by RLS. Add SUPABASE_SERVICE_ROLE_KEY to .env.local ' +
          '(Supabase → Project Settings → API → service_role), restart the API server, and try again. ' +
          'Alternatively add UPDATE/INSERT policies for your key.'

        // Prefer update; if row truly missing, upsert so first save works.
        let { data, error } = await supabase
          .from('app_releases')
          .update(patch)
          .eq('id', id)
          .select(selectCols)
          .maybeSingle()

        // RLS often returns { data: null, error: null } for blocked updates.
        // Distinguish "no row" vs "blocked" by checking whether the row exists.
        if (!error && !data) {
          const existing = await supabase
            .from('app_releases')
            .select('id')
            .eq('id', id)
            .maybeSingle()

          if (existing.error) {
            error = existing.error
          } else if (existing.data) {
            // Row exists but update returned nothing → write blocked (almost always RLS + anon key).
            response.status(403).json({
              ok: false,
              error: permissionHelp,
              code: 'RLS_WRITE_DENIED',
              needs_service_role: !usingServiceRole,
            })
            return
          } else {
            const upsert = await supabase
              .from('app_releases')
              .upsert(
                {
                  id,
                  min_version: patch.min_version ?? '0.0.0',
                  min_build: patch.min_build ?? 0,
                  latest_version: patch.latest_version ?? '0.0.0',
                  latest_build: patch.latest_build ?? 0,
                  force_update: patch.force_update ?? false,
                  title: patch.title ?? null,
                  message: patch.message ?? null,
                  store_url: patch.store_url ?? null,
                  check_eas_update: patch.check_eas_update ?? true,
                  enabled: patch.enabled ?? true,
                  updated_at: patch.updated_at,
                },
                { onConflict: 'id' },
              )
              .select(selectCols)
              .maybeSingle()
            data = upsert.data
            error = upsert.error
          }
        }

        if (error) {
          if (tableMissing(error)) {
            response.status(503).json({
              ok: false,
              error: 'Table public.app_releases is missing or not readable.',
              needs_schema: true,
              details: error.message || null,
              code: error.code || null,
            })
            return
          }
          if (rlsWriteDenied(error)) {
            response.status(403).json({
              ok: false,
              error: permissionHelp,
              details: error.message || null,
              code: error.code || null,
              needs_service_role: !usingServiceRole,
            })
            return
          }
          response.status(500).json({
            ok: false,
            error: error.message || 'Failed to update app release',
            code: error.code || null,
          })
          return
        }

        if (!data) {
          response.status(500).json({
            ok: false,
            error: `Failed to save app_releases row id="${id}".`,
          })
          return
        }

        response.json({
          ok: true,
          id,
          settings: data,
          message: `Saved ${id} · v${data.latest_version} · build ${data.latest_build}`,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to update app release',
        })
      }
    },

    /**
     * Audience devices for an app (Trigger / 9AM).
     * Returns every device that has any subscriber row for that app — including
     * fully stopped ones — so the dashboard can show Notifications on/off correctly.
     * Alertable subset = devices where enabled === true (subscription_status on|partial).
     */
    async listDevices(request, response) {
      try {
        const appKey = normalizeNotificationApp(request.query?.app)
        const supabase = getSupabase()
        const { data, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, company_name, subscribers')

        if (error) throw error

        const devices = buildAudienceDevices(data || [], appKey)
        const alertable = devices.filter((d) => d.enabled)
        const stopped = devices.filter((d) => !d.enabled)

        response.json({
          ok: true,
          app_key: appKey,
          count: devices.length,
          alertable_count: alertable.length,
          stopped_count: stopped.length,
          // Full list for Audience UI (on + partial + off).
          devices,
          // Back-compat for any caller that only wants push-ready tokens.
          recipients: collectPushRecipients(data || [], appKey),
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to load devices',
        })
      }
    },

    /**
     * News articles from Supabase market_news_articles (newest first).
     */
    async listNews(request, response) {
      try {
        const limit = Math.min(Math.max(Number(request.query.limit || 50), 1), 100)
        const offset = Math.max(Number(request.query.offset || 0), 0)
        const supabase = getSupabase()

        const { data, error, count } = await supabase
          .from('market_news_articles')
          .select(
            'id, provider, title, summary, url, image_url, source_name, author, published_at, tickers, topics, sentiment_label, sentiment_score, raw_json, created_at',
            { count: 'exact' },
          )
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1)

        if (error) throw error

        const articles = (data || []).map((row) => {
          const base = {
            id: String(row.id),
            provider: row.provider || null,
            title: row.title || 'Untitled',
            summary: row.summary || '',
            url: row.url || '',
            image_url: row.image_url || null,
            source_name: row.source_name || null,
            author: row.author || null,
            published_at: row.published_at || null,
            tickers: Array.isArray(row.tickers) ? row.tickers : [],
            topics: Array.isArray(row.topics) ? row.topics : [],
            sentiment_label: row.sentiment_label || null,
            created_at: row.created_at || null,
            raw_json: row.raw_json || null,
          }
          // Preview of push body line for the dashboard.
          const impact = buildNewsImpactBody(base)
          return {
            ...base,
            impact_body: impact.body,
            ticker_sides: impact.sides,
            raw_json: undefined,
          }
        })

        response.json({
          ok: true,
          count: articles.length,
          total: count ?? null,
          limit,
          offset,
          has_more: articles.length === limit,
          articles,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to load news',
        })
      }
    },

        /**
     * Push a news article (or custom title/body) to enabled devices.
     * News format:
     *   title (header): NVDA (bullish) · AAPL (bearish) · …
     *   body  (line 2): full article headline
     *   no image payload (text-only notification)
     *
     * Body: { article_id } or { title, body, url, article_id?, device_ids?, expo_push_tokens? }
     */
    async alertNews(request, response) {
      try {
        const appKey = normalizeNotificationApp(request.body?.app_key || request.query?.app)
        const deepLinkScheme = appKey === 'trigger' ? 'trigger' : 'nineam'
        const supabase = getSupabase()
        const articleId = request.body?.article_id || request.body?.id || null

        let article = null
        if (articleId) {
          const { data, error } = await supabase
            .from('market_news_articles')
            .select(
              'id, title, summary, url, image_url, source_name, published_at, tickers, provider, sentiment_label, sentiment_score, raw_json',
            )
            .eq('id', articleId)
            .maybeSingle()
          if (error) throw error
          if (!data) {
            response.status(404).json({ error: `Article ${articleId} not found` })
            return
          }
          article = data
        }

        const pushType =
          (request.body?.type && String(request.body.type).trim()) ||
          (articleId || article?.id ? 'news_alert' : 'custom_alert')

        // Full article headline — never truncate (used as body for news alerts).
        const headline = normalizeNotificationHeadline(
          (article?.title && String(article.title)) ||
            (request.body?.headline && String(request.body.headline)) ||
            '',
        )

        let title = ''
        let bodyText = ''
        let tickerSides = []

        if (pushType === 'custom_alert') {
          // Custom: free-form title + body as the user typed them.
          title =
            (request.body?.title && String(request.body.title).trim()) || headline || ''
          bodyText =
            (request.body?.body && String(request.body.body).trim()) ||
            (article?.summary && String(article.summary).trim()) ||
            ''
          if (bodyText.length > 800) bodyText = `${bodyText.slice(0, 797)}…`
        } else {
          // News: header = tickers · (bullish|bearish); body = full headline.
          if (request.body?.title && String(request.body.title).trim()) {
            // Explicit title override (rare) — still treat as header line.
            title = String(request.body.title).trim()
          } else if (article) {
            const built = buildNewsImpactBody(article)
            title = built.body || 'News alert'
            tickerSides = built.sides
          } else {
            title = 'News alert'
          }

          if (request.body?.body && String(request.body.body).trim()) {
            bodyText = String(request.body.body).trim()
          } else {
            bodyText = headline
          }

          if (!title) title = 'News alert'
          // Ticker header is usually short; soft-cap only if pathologically long.
          if (title.length > 500) title = `${title.slice(0, 497)}…`
          // Never truncate the headline body.
        }

        if (pushType === 'custom_alert' && !title) {
          response.status(400).json({
            error: 'Provide article_id or title for the news alert',
          })
          return
        }
        if (pushType === 'news_alert' && !bodyText) {
          response.status(400).json({
            error: 'Article has no headline to send',
          })
          return
        }
        if (!bodyText && pushType === 'custom_alert') {
          bodyText = title
        }
        if (!bodyText) {
          bodyText = title || 'News alert'
        }

        const { data: rows, error: rowsError } = await supabase
          .from('device_monitored_tickers')
          .select('subscribers')
        if (rowsError) throw rowsError

        let recipients = collectPushRecipients(rows || [], appKey)

        // Optional filter: only send to selected devices.
        // Accept device_ids: string[] and/or expo_push_tokens: string[]
        const selectedIds = Array.isArray(request.body?.device_ids)
          ? request.body.device_ids.map((id) => String(id || '').trim()).filter(Boolean)
          : []
        const selectedTokens = Array.isArray(request.body?.expo_push_tokens)
          ? request.body.expo_push_tokens
              .map((t) => String(t || '').trim())
              .filter(Boolean)
          : []
        if (selectedIds.length || selectedTokens.length) {
          const idSet = new Set(selectedIds)
          const tokenSet = new Set(selectedTokens)
          recipients = recipients.filter(
            (r) =>
              (r.device_id && idSet.has(String(r.device_id))) ||
              tokenSet.has(r.expo_push_token),
          )
        }

        if (!recipients.length) {
          response.status(400).json({
            error:
              selectedIds.length || selectedTokens.length
                ? 'No matching enabled devices for the selected IDs/tokens'
                : 'No enabled devices with Expo push tokens found',
            recipient_count: 0,
          })
          return
        }

        const url =
          (request.body?.url && String(request.body.url).trim()) ||
          article?.url ||
          null
        const tickers = Array.isArray(article?.tickers) ? article.tickers : []
        // Soft channel: only send channelId if client opts in. Unknown channelIds
        // on Android can prevent the notification from showing.
        // Default = omit → Expo/Android "Default" channel.
        const forceChannel =
          request.body?.channel_id != null
            ? String(request.body.channel_id).trim()
            : request.body?.use_named_channel === true
              ? pushType === 'custom_alert'
                ? 'custom-alert'
                : 'news-alert'
              : ''
        const resolvedArticleId = article?.id
          ? String(article.id)
          : articleId
            ? String(articleId)
            : null

        // Deep-link payload for the mobile app (tap → Home feed first card).
        // Expo/FCM Android: all values must be strings (nulls can drop the whole bag).
        const str = (v) => (v == null || v === '' ? '' : String(v))
        const summaryText = str(article?.summary).slice(0, 800)
        const tickerList = Array.isArray(tickers)
          ? tickers.map((t) => String(t || '').trim()).filter(Boolean)
          : []
        const appDeepLink =
          pushType === 'news_alert'
            ? resolvedArticleId
              ? `${deepLinkScheme}://news/${encodeURIComponent(resolvedArticleId)}`
              : `${deepLinkScheme}://news`
            : `${deepLinkScheme}://home`
        const newsData =
          pushType === 'news_alert'
            ? {
                // Routing
                type: 'news_alert',
                app_key: appKey,
                kind: 'news',
                screen: 'news',
                path: resolvedArticleId
                  ? `/news/${encodeURIComponent(resolvedArticleId)}`
                  : '/news',
                deep_link: appDeepLink,
                url: appDeepLink,
                app_url: appDeepLink,

                // Identity — several aliases so the app can read any common key
                article_id: str(resolvedArticleId),
                news_id: str(resolvedArticleId),
                id: str(resolvedArticleId),

                // Content — enough for a full NewsFeedItem before Supabase fetch
                article_url: str(url),
                headline: str(bodyText),
                summary: summaryText,
                notification_title: str(title),
                notification_body: str(bodyText),
                source_name: str(article?.source_name),
                published_at: str(article?.published_at),
                provider: str(article?.provider),
                // JSON strings only (native bridges drop nested arrays/objects)
                tickers: JSON.stringify(tickerList),
                ticker_sides_json: JSON.stringify(tickerSides || []),
              }
            : {
                type: 'custom_alert',
                app_key: appKey,
                kind: 'custom',
                screen: 'home',
                path: '/',
                deep_link: appDeepLink,
                url: appDeepLink,
                app_url: appDeepLink,
                article_id: str(resolvedArticleId),
                news_id: str(resolvedArticleId),
                id: str(resolvedArticleId),
                article_url: str(url),
                headline: str(title),
                summary: summaryText,
                notification_title: str(title),
                notification_body: str(bodyText),
                source_name: str(article?.source_name),
                tickers: JSON.stringify(tickerList),
                ticker_sides_json: JSON.stringify(tickerSides || []),
              }

        const messages = recipients.map((r) => {
          const msg = {
            to: r.expo_push_token,
            sound: 'default',
            title,
            body: bodyText,
            data: newsData,
            priority: 'high',
            _device_id: r.device_id,
          }
          if (forceChannel) {
            msg.channelId = forceChannel
          }
          return msg
        })

        // Sample of what Expo actually receives (first recipient, no token).
        const samplePayload = messages[0]
          ? (() => {
              const { _device_id, to, ...rest } = messages[0]
              void _device_id
              return {
                ...rest,
                to: to ? `${String(to).slice(0, 28)}…` : null,
                channelId: rest.channelId ?? null,
              }
            })()
          : null

        const pushResult = await sendExpoPushMessages(messages)
        const label = pushType === 'custom_alert' ? 'Custom alert' : 'News alert'
        const failureSummary = expoFailureSummary(pushResult)
        const imageNote = 'Text-only notification; image payload disabled.'

        response.json({
          ok: pushResult.failed === 0 && pushResult.errors.length === 0,
          app_key: appKey,
          type: pushType,
          article_id: article?.id ? String(article.id) : articleId || null,
          title,
          title_length: title.length,
          title_is_full_headline: true,
          body: bodyText,
          deep_link: newsData.deep_link,
          image_url: null,
          rich_content_attached: false,
          image_probe: {
            ok: false,
            url: null,
            reason: 'Image payload disabled',
            content_type: null,
            status: null,
          },
          image_note: imageNote,
          ios_nse_required: false,
          ios_nse_docs: null,
          channel_id: forceChannel || null,
          channel_note: forceChannel
            ? `Using channelId "${forceChannel}" — app must create this Android channel.`
            : 'No channelId sent (Android Default channel) — more reliable for images.',
          ticker_sides: tickerSides,
          sample_expo_payload: samplePayload,
          recipient_count: recipients.length,
          device_ids: recipients.map((r) => r.device_id).filter(Boolean),
          sent_ok: pushResult.ok,
          sent_failed: pushResult.failed,
          tickets: pushResult.tickets,
          errors: pushResult.errors,
          message:
            pushResult.ok > 0
              ? `${label} sent to ${pushResult.ok} device(s)` +
                (pushResult.failed ? ` · ${pushResult.failed} failed` : '') +
                ' · text only'
              : `Failed to send ${label.toLowerCase()}` +
                (failureSummary ? ` · ${failureSummary}` : ''),
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'News alert push failed',
        })
      }
    },

    /**
     * Trigger-only personalized momentum digest.
     * Each recipient gets their own subscribed tickers with the latest saved momentum.
     */
    async alertTriggerDigest(request, response) {
      try {
        const supabase = getSupabase()
        const { data: rows, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, subscribers, notable_price_movements')
        if (error) throw error

        let recipients = collectPushRecipients(rows || [], 'trigger')
        const selectedIds = Array.isArray(request.body?.device_ids)
          ? request.body.device_ids.map((id) => String(id || '').trim()).filter(Boolean)
          : []
        const selectedTokens = Array.isArray(request.body?.expo_push_tokens)
          ? request.body.expo_push_tokens
              .map((token) => String(token || '').trim())
              .filter(Boolean)
          : []
        if (selectedIds.length || selectedTokens.length) {
          const idSet = new Set(selectedIds)
          const tokenSet = new Set(selectedTokens)
          recipients = recipients.filter(
            (recipient) =>
              (recipient.device_id && idSet.has(String(recipient.device_id))) ||
              tokenSet.has(recipient.expo_push_token),
          )
        }

        if (!recipients.length) {
          response.status(400).json({
            error: 'No matching enabled Trigger users with Expo push tokens',
            recipient_count: 0,
          })
          return
        }

        const title =
          String(request.body?.title || '').trim() || "Today's notable price momentum"
        const previews = recipients.map((recipient) => {
          const subscribed = new Map()
          for (const row of rows || []) {
            const ticker = normalizeTicker(row.ticker)
            if (!ticker || subscribed.has(ticker)) continue
            const hasSubscription = (Array.isArray(row.subscribers) ? row.subscribers : []).some(
              (subscriber) =>
                subscriber &&
                isSubscriberEnabled(subscriber) &&
                subscriberNotificationApp(subscriber) === 'trigger' &&
                String(subscriber.expo_push_token || '').trim() === recipient.expo_push_token,
            )
            if (!hasSubscription) continue
            const movement = latestMovementEvent(row.notable_price_movements)
            const momentum = formatMomentumForTitle(
              movement?.price_change || movement?.momentum || '',
            )
            const premarketMomentum = formatMomentumForTitle(
              premarketChangeFromEvent(movement),
            )
            subscribed.set(ticker, {
              ticker,
              momentum,
              premarket_momentum: premarketMomentum,
              event_date: movement?.event_date || null,
            })
          }
          const tickerItems = [...subscribed.values()].sort((left, right) =>
            left.ticker.localeCompare(right.ticker),
          )
          const body = tickerItems.length
            ? tickerItems
                .map((item) =>
                  item.momentum || item.premarket_momentum
                    ? `${item.ticker} (${[
                        item.momentum,
                        item.premarket_momentum
                          ? `pre-market ${item.premarket_momentum}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(', ')})`
                    : item.ticker,
                )
                .join(' · ')
            : 'No subscribed ticker momentum is available yet.'
          return {
            device_id: recipient.device_id,
            expo_push_token: recipient.expo_push_token,
            title,
            body: body.length > 400 ? `${body.slice(0, 397)}…` : body,
            tickers: tickerItems,
          }
        })

        if (request.body?.preview_only === true) {
          response.json({
            ok: true,
            preview_only: true,
            app_key: 'trigger',
            notification_type: 'trigger_momentum_digest',
            title,
            recipient_count: previews.length,
            previews: previews.map(({ expo_push_token, ...preview }) => preview),
          })
          return
        }

        const messages = previews.map((preview) => ({
          to: preview.expo_push_token,
          sound: 'default',
          title: preview.title,
          body: preview.body,
          priority: 'high',
          data: {
            type: 'notable_momentum_digest',
            notification_type: 'trigger_momentum_digest',
            movement_type: 'digest',
            kind: 'momentum_digest',
            app_key: 'trigger',
            screen: 'momentum',
            path: '/momentum',
            deep_link:
              'trigger://momentum?notification_type=trigger_momentum_digest&movement_type=digest',
            url: 'trigger://momentum?notification_type=trigger_momentum_digest&movement_type=digest',
            app_url:
              'trigger://momentum?notification_type=trigger_momentum_digest&movement_type=digest',
            tickers: JSON.stringify(preview.tickers),
            notification_title: preview.title,
            notification_body: preview.body,
          },
          _device_id: preview.device_id,
        }))
        const pushResult = await sendExpoPushMessages(messages)
        const failureSummary = expoFailureSummary(pushResult)

        response.json({
          ok: pushResult.failed === 0 && pushResult.errors.length === 0,
          app_key: 'trigger',
          notification_type: 'trigger_momentum_digest',
          title,
          recipient_count: previews.length,
          device_ids: previews.map((preview) => preview.device_id).filter(Boolean),
          previews: previews.map(({ expo_push_token, ...preview }) => preview),
          sent_ok: pushResult.ok,
          sent_failed: pushResult.failed,
          tickets: pushResult.tickets,
          errors: pushResult.errors,
          message:
            pushResult.ok > 0
              ? `Momentum digest sent to ${pushResult.ok} Trigger user(s)` +
                (pushResult.failed ? ` · ${pushResult.failed} failed` : '')
              : 'Failed to send Trigger momentum digest' +
                (failureSummary ? ` · ${failureSummary}` : ''),
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Trigger momentum digest failed',
        })
      }
    },

    /**
     * Read-only preview of the exact notable-movement notification copy.
     * Accepts an optional event so a dashboard card can preview that card only.
     * Extreme / Pinned: works even when ticker is not in device_monitored_tickers.
     */
    async previewAlert(request, response) {
      try {
        const ticker = normalizeTicker(request.params.ticker || request.body?.ticker)
        const appKey = normalizeNotificationApp(request.body?.app_key || request.query?.app)
        const allRecipients =
          request.body?.all_recipients === true ||
          request.body?.recipient_scope === 'all' ||
          String(request.body?.recipient_scope || '').toLowerCase() === 'all'
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }

        const supabase = getSupabase()
        let { data: rows, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, company_name, subscribers, notable_price_movements')
          .eq('ticker', ticker)

        if (error) throw error
        if (!rows?.length) {
          ;({ data: rows, error } = await supabase
            .from('device_monitored_tickers')
            .select('ticker, company_name, subscribers, notable_price_movements')
            .ilike('ticker', ticker))
          if (error) throw error
        }

        // Non-monitored Extreme/Pinned tickers: still build copy from body.event / company_name.
        const hasEventBody =
          request.body?.event && typeof request.body.event === 'object'
        if (!rows?.length && !hasEventBody && !String(request.body?.title || '').trim()) {
          response.status(404).json({
            error: `Ticker ${ticker} not found in device_monitored_tickers`,
          })
          return
        }
        if (!rows?.length) rows = []

        let event = null
        if (hasEventBody) {
          event = normalizeEventRow(request.body.event) || request.body.event
        }
        if (!event && rows.length) {
          const merged = {}
          for (const row of rows) {
            Object.assign(merged, extractDatesMap(row.notable_price_movements))
          }
          event = latestMovementEvent({ dates: merged })
        }

        const companyName =
          String(request.body?.company_name || '').trim() ||
          rows.find((row) => row.company_name)?.company_name ||
          ticker
        const preview = buildAlertMessage({
          ticker,
          companyName,
          event,
          titleOverride: request.body?.title,
          bodyOverride: request.body?.body,
          appKey,
        })

        let recipients = collectPushRecipients(rows, appKey)
        if (allRecipients) {
          const { data: allRows, error: allError } = await supabase
            .from('device_monitored_tickers')
            .select('subscribers')
          if (allError) throw allError
          recipients = collectPushRecipients(allRows || [], appKey)
        }

        response.json({
          ok: true,
          app_key: appKey,
          ticker,
          title: preview.title,
          body: preview.body,
          event_date: event?.event_date || null,
          notification_type: preview.data.notification_type,
          movement_type: preview.data.movement_type,
          deep_link: preview.data.deep_link,
          all_recipients: allRecipients,
          recipient_count: recipients.length,
          device_ids: recipients.map((recipient) => recipient.device_id).filter(Boolean),
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Alert preview failed',
        })
      }
    },

    /**
     * Push an alert to enabled Expo devices.
     * Default: devices subscribed to this ticker.
     * Extreme / Pinned (`all_recipients: true`): any selected app device, even if they
     * never subscribed to this ticker (and ticker need not exist in monitored table).
     */
    async alert(request, response) {
      try {
        const ticker = normalizeTicker(request.params.ticker || request.body?.ticker)
        const appKey = normalizeNotificationApp(request.body?.app_key || request.query?.app)
        const allRecipients =
          request.body?.all_recipients === true ||
          request.body?.recipient_scope === 'all' ||
          String(request.body?.recipient_scope || '').toLowerCase() === 'all'
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }

        const supabase = getSupabase()
        let { data: rows, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, company_name, subscribers, notable_price_movements')
          .eq('ticker', ticker)

        if (error) throw error
        if (!rows?.length) {
          ;({ data: rows, error } = await supabase
            .from('device_monitored_tickers')
            .select('ticker, company_name, subscribers, notable_price_movements')
            .ilike('ticker', ticker))
          if (error) throw error
        }

        const selectedIds = Array.isArray(request.body?.device_ids)
          ? request.body.device_ids.map((id) => String(id || '').trim()).filter(Boolean)
          : []
        const selectedTokens = Array.isArray(request.body?.expo_push_tokens)
          ? request.body.expo_push_tokens
              .map((token) => String(token || '').trim())
              .filter(Boolean)
          : []
        const hasEventBody =
          request.body?.event && typeof request.body.event === 'object'
        const hasTitleOverride = Boolean(String(request.body?.title || '').trim())

        // Extreme/Pinned: allow push without a monitored-tickers row when explicit
        // recipients + event/title are provided.
        if (!rows?.length) {
          if (
            !allRecipients &&
            !(selectedIds.length || selectedTokens.length) &&
            !hasEventBody &&
            !hasTitleOverride
          ) {
            response.status(404).json({
              error: `Ticker ${ticker} not found in device_monitored_tickers`,
            })
            return
          }
          rows = []
        }

        let recipients = collectPushRecipients(rows, appKey)
        if (allRecipients || (!recipients.length && (selectedIds.length || selectedTokens.length))) {
          const { data: allRows, error: allError } = await supabase
            .from('device_monitored_tickers')
            .select('subscribers')
          if (allError) throw allError
          recipients = collectPushRecipients(allRows || [], appKey)
        }

        if (selectedIds.length || selectedTokens.length) {
          const idSet = new Set(selectedIds)
          const tokenSet = new Set(selectedTokens)
          recipients = recipients.filter(
            (recipient) =>
              (recipient.device_id && idSet.has(String(recipient.device_id))) ||
              tokenSet.has(recipient.expo_push_token),
          )
        } else if (allRecipients) {
          // All-recipients without an explicit selection is too dangerous — require pick.
          response.status(400).json({
            error:
              'Select at least one device. Extreme/Pinned alerts require explicit recipients (use Select all or pick devices).',
            ticker,
            app_key: appKey,
            recipient_count: 0,
            all_recipients: true,
          })
          return
        }
        if (!recipients.length) {
          response.status(400).json({
            error:
              selectedIds.length || selectedTokens.length
                ? `No matching selected ${appKey === 'trigger' ? 'Trigger' : '9AM'} devices for ${ticker}`
                : `No enabled ${appKey === 'trigger' ? 'Trigger' : '9AM'} devices with Expo push tokens for ${ticker}`,
            ticker,
            app_key: appKey,
            recipient_count: 0,
          })
          return
        }

        // Prefer body.event (card send); else latest saved movement for monitored tickers.
        let event = null
        if (hasEventBody) {
          event = normalizeEventRow(request.body.event) || request.body.event
        }
        if (!event && rows.length) {
          const merged = {}
          for (const row of rows) {
            Object.assign(merged, extractDatesMap(row.notable_price_movements))
          }
          event = latestMovementEvent({ dates: merged })
        }

        const companyName =
          String(request.body?.company_name || '').trim() ||
          rows.find((r) => r.company_name)?.company_name ||
          ticker
        const { title, body, data: pushData } = buildAlertMessage({
          ticker,
          companyName,
          event,
          titleOverride: request.body?.title,
          bodyOverride: request.body?.body,
          appKey,
        })

        // Soft channel: only if client opts in (unknown channelId can hide Android notifs).
        const forceChannel =
          request.body?.channel_id != null
            ? String(request.body.channel_id).trim()
            : request.body?.use_named_channel === true
              ? 'notable-price-movement'
              : ''

        const messages = recipients.map((r) => {
          const msg = {
            to: r.expo_push_token,
            sound: 'default',
            title,
            body,
            data: pushData,
            priority: 'high',
            _device_id: r.device_id,
          }
          if (forceChannel) msg.channelId = forceChannel
          return msg
        })

        const samplePayload = messages[0]
          ? (() => {
              const { _device_id, to, ...rest } = messages[0]
              void _device_id
              return {
                ...rest,
                to: to ? `${String(to).slice(0, 28)}…` : null,
                data: rest.data || null,
              }
            })()
          : null

        const pushResult = await sendExpoPushMessages(messages)

        response.json({
          ok: pushResult.failed === 0 && pushResult.errors.length === 0,
          app_key: appKey,
          ticker,
          title,
          body,
          event_date: event?.event_date || null,
          notification_type: pushData.notification_type,
          movement_type: pushData.movement_type,
          deep_link: pushData.deep_link || null,
          data: pushData,
          sample_expo_payload: samplePayload,
          recipient_count: recipients.length,
          device_ids: recipients.map((r) => r.device_id).filter(Boolean),
          sent_ok: pushResult.ok,
          sent_failed: pushResult.failed,
          tickets: pushResult.tickets,
          errors: pushResult.errors,
          message:
            pushResult.ok > 0
              ? `Alert sent to ${pushResult.ok} device(s) for ${ticker}` +
                (pushResult.failed ? ` · ${pushResult.failed} failed` : '')
              : `Failed to send alert for ${ticker}`,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Alert push failed',
        })
      }
    },

    /**
     * Classify a scraped reason/summary into a market-intelligence notification via Gemini,
     * then optionally replace the saved reason for that event date in Supabase.
     *
     * Body: {
     *   text | summary, ticker?, company_name?, event_date?,
     *   price?, price_change?, event?, auto_save?
     * }
     */
    async geminiSummarize(request, response) {
      try {
        const text = String(request.body?.text || request.body?.summary || '').trim()
        const summaryOverride = String(
          request.body?.summary_override || request.body?.edited_summary || '',
        ).trim()
        const skipGenerate = ['1', 'true', 'yes'].includes(
          String(request.body?.skip_generate || '').toLowerCase(),
        )

        const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
        if (!skipGenerate && !apiKey) {
          response.status(500).json({
            error: 'Add GEMINI_API_KEY to .env.local (server-side only)',
          })
          return
        }

        // skip_generate: save an already-edited notification without calling Gemini again.
        if (!skipGenerate && !text) {
          response.status(400).json({ error: 'text (summary/reason) is required' })
          return
        }
        if (skipGenerate && !summaryOverride) {
          response.status(400).json({
            error: 'summary_override is required when skip_generate is true',
          })
          return
        }

        const ticker = normalizeTicker(
          request.body?.ticker || request.body?.event?.ticker || '',
        )
        const companyName = String(
          request.body?.company_name || request.body?.event?.company_name || '',
        ).trim()
        const eventDate = String(
          request.body?.event_date || request.body?.event?.event_date || '',
        )
          .trim()
          .slice(0, 10)
        const priceChange = String(
          request.body?.price_change ||
            request.body?.event?.price_change ||
            request.body?.event?.momentum ||
            '',
        ).trim()
        const price = String(
          request.body?.price || request.body?.event?.price || '',
        ).trim()
        const autoSaveRaw = request.body?.auto_save
        const autoSave =
          autoSaveRaw === undefined || autoSaveRaw === null || autoSaveRaw === ''
            ? true
            : !['0', 'false', 'no'].includes(String(autoSaveRaw).toLowerCase())

        // Preferred model + Studio list cascade (see geminiModelCascade defaults).
        const preferredModel =
          String(process.env.GEMINI_MODEL || request.body?.model || '').trim() ||
          'gemini-3.6-flash'
        const models = geminiModelCascade(preferredModel)
        let model = preferredModel
        let modelVersion = null

        let summary = ''
        let lines = []
        let usageReport = null
        let modelsTried = []
        let modelErrors = []
        let modelSwitched = false
        let modelSwitchFrom = null
        let modelSwitchTo = null
        let modelSwitchReason = null

        if (skipGenerate) {
          summary = summaryOverride
          lines = summary
            .split(/\r?\n/)
            .map((line) => line.trimEnd())
            .filter((line, index, arr) => line.length > 0 || (index > 0 && index < arr.length - 1))
          usageReport = {
            model: null,
            skip_generate: true,
            prompt_tokens: 0,
            candidates_tokens: 0,
            thoughts_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            credits_used: 0,
            cost_usd_total: 0,
            cost_usd_display: '$0.000000',
            note: 'No Gemini call — edited text saved without generation.',
          }
        } else {
        const eventPayload =
          request.body?.event && typeof request.body.event === 'object'
            ? request.body.event
            : {}
        const eventForSession = {
          ...eventPayload,
          event_date: eventDate || eventPayload.event_date,
          price_change: priceChange || eventPayload.price_change || eventPayload.momentum,
          momentum: priceChange || eventPayload.momentum || eventPayload.price_change,
          summary: text || eventPayload.summary,
          original_summary: eventPayload.original_summary || text,
        }
        const { ctx: sessionCtx, lines: sessionContextLines } =
          buildSessionContextLines(eventForSession)

        const stockHeadline =
          ticker &&
          (classifyAsset(ticker, companyName).asset_class === 'equity' ||
            isStockAlertTicker(ticker))
        const contextBits = [
          ticker ? `Ticker: ${ticker}` : '',
          companyName && !stockHeadline ? `Asset name: ${companyName}` : '',
          stockHeadline
            ? `Headline asset: use ticker ${ticker} only — never the company name.`
            : '',
          priceChange ? `Price move: ${priceChange}` : '',
          price ? `Price: ${price}` : '',
          eventDate ? `Event date: ${eventDate}` : '',
          ...sessionContextLines,
        ].filter(Boolean)

        const informationBlock = [
          ...contextBits,
          contextBits.length ? '' : null,
          text,
        ]
          .filter((line) => line != null)
          .join('\n')

        // Optional editable prompt template from the dashboard (without event text).
        const promptTemplate = String(
          request.body?.prompt_template || request.body?.custom_prompt || '',
        ).trim()
        const template =
          promptTemplate || buildDefaultGeminiPromptTemplate()
        const prompt = template.includes('{{INFORMATION}}')
          ? template.replace(/\{\{INFORMATION\}\}/g, informationBlock)
          : `${template.replace(/\n*Information to classify:\s*$/i, '').trim()}\n\nInformation to classify:\n\n${informationBlock}`

        const maxOutputTokens = geminiMaxOutputTokens()
        let finishReason = null
        let structureRetries = 0

        try {
          const result = await callGeminiWithModelCascade({
            apiKey,
            models,
            prompt,
            maxOutputTokens,
          })
          // Belt-and-braces: rewrite completed-session headlines while market still open
          summary = sanitizeGeminiSessionHeadline(result.summary, sessionCtx)
          summary = sanitizeStockHeadlineInSummary(
            summary,
            ticker,
            companyName,
            classifyAsset(ticker, companyName).asset_class,
          )
          model = result.model
          modelVersion = result.modelVersion
          finishReason = result.finishReason
          structureRetries = result.structureRetries || 0
          modelsTried = result.modelsTried || [model]
          modelErrors = result.modelErrors || []
          modelSwitched = Boolean(result.model_switched)
          modelSwitchFrom = result.model_switch_from || null
          modelSwitchTo = result.model_switch_to || null
          modelSwitchReason = result.model_switch_reason || null
          usageReport = mergeGeminiUsageReports(result.usageAttempts, model)
          if (usageReport && typeof usageReport === 'object') {
            usageReport.session_phase = sessionCtx.phase
            usageReport.preferred_time_phrase = sessionCtx.preferred_time_phrase
          }
        } catch (error) {
          const status =
            error?.status === 429 || error?.quota
              ? 429
              : error?.capacity || error?.status === 503
                ? 503
                : error?.status && error.status < 500
                  ? error.status
                  : 502
          const message =
            error instanceof Error ? error.message : 'Gemini request failed'
          const mergedUsage = mergeGeminiUsageReports(
            error?.usageAttempts || [],
            error?.model || preferredModel,
          )
          response.status(status).json({
            error: message,
            model: error?.model || preferredModel,
            models_tried: error?.modelsTried || models,
            model_errors: error?.modelErrors || [],
            quota: Boolean(error?.quota) || status === 429,
            capacity: Boolean(error?.capacity) || status === 503,
            model_errors: error?.modelErrors || [],
            models_tried: error?.modelsTried || models,
            hint:
              status === 429
                ? 'All model quotas in the cascade may be exhausted. Wait and retry, edit GEMINI_MODEL_CASCADE, or enable paid billing in Google AI Studio.'
                : status === 503 || error?.capacity
                  ? 'Models are experiencing high demand. The cascade tried every listed model; wait a minute and retry, or set GEMINI_MODEL / GEMINI_MODEL_CASCADE to prefer available ones.'
                  : null,
            usage: mergedUsage,
            tokens: mergedUsage
              ? {
                  prompt: mergedUsage.prompt_tokens,
                  output: mergedUsage.output_tokens,
                  thoughts: mergedUsage.thoughts_tokens,
                  total: mergedUsage.total_tokens,
                }
              : null,
            credits_used: mergedUsage?.credits_used ?? 0,
            cost_usd: mergedUsage?.cost_usd_total ?? 0,
            cost_usd_display: mergedUsage?.cost_usd_display || '$0.000000',
          })
          return
        }

        if (!summary) {
          response.status(502).json({
            error: 'Gemini returned an empty structured reason',
            model,
            models_tried: modelsTried,
            finish_reason: finishReason,
            usage: usageReport,
          })
          return
        }

        lines = summary
          .split(/\r?\n/)
          .map((line) => line.trimEnd())
          .filter((line, index, arr) => line.length > 0 || (index > 0 && index < arr.length - 1))

        if (usageReport) {
          usageReport.model = model
          usageReport.model_version = modelVersion || usageReport.model_version
          usageReport.max_output_tokens = maxOutputTokens
          usageReport.finish_reason = finishReason
          usageReport.models_tried = modelsTried
          usageReport.model_errors = modelErrors
          usageReport.validation = {
            has_likely_driver: true,
            retries: structureRetries,
          }
        }
        } // end !skipGenerate

        summary = sanitizeStockHeadlineInSummary(
          summary,
          ticker,
          companyName,
          classifyAsset(ticker, companyName).asset_class,
        )
        lines = summary
          .split(/\r?\n/)
          .map((line) => line.trimEnd())
          .filter((line, index, arr) => line.length > 0 || (index > 0 && index < arr.length - 1))

        // --- Auto-save: replace the reason/summary for this event date in Supabase ---
        let saveResult = null
        const monitorScope = resolveMonitorScope(request)
        const monitorTable = monitorTableForScope(monitorScope)
        if (autoSave && ticker && /^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
          const supabase = getSupabase()
          let loaded = await loadTickerDates(supabase, ticker, monitorScope)
          const allowCreatePinned =
            monitorScope === 'pinned' &&
            (request.body?.create_if_missing === true ||
              request.body?.create_if_missing === 1 ||
              request.body?.create_if_missing === '1')
          if (!loaded.found && allowCreatePinned) {
            await ensureMonitorTickerRow(supabase, ticker, {
              companyName,
              scope: 'pinned',
            })
            loaded = await loadTickerDates(supabase, ticker, 'pinned')
          }
          if (!loaded.found) {
            saveResult = {
              ok: false,
              saved: false,
              error:
                monitorScope === 'pinned'
                  ? `Ticker ${ticker} is not pinned yet (Pinned store only · not Users)`
                  : `Ticker ${ticker} not found in ${monitorTable}`,
              monitor_scope: monitorScope,
            }
          } else {
            const existing = loaded.dates[eventDate] || {}
            const incoming =
              request.body?.event && typeof request.body.event === 'object'
                ? request.body.event
                : {}
            // Prefer the scrape reason the client sent (text). Never overwrite a
            // previously stored original_summary with a Gemini notification body.
            const alreadyGemini =
              Boolean(existing.gemini_formating) ||
              Boolean(incoming.gemini_formating) ||
              Boolean(existing.gemini_classified_at) ||
              Boolean(incoming.gemini_classified_at)
            const previousReason =
              existing.original_summary ||
              incoming.original_summary ||
              text ||
              (!alreadyGemini ? existing.summary : '') ||
              (!alreadyGemini ? incoming.summary : '') ||
              ''
            const didGenerate = !skipGenerate
            const saveNowIso = new Date().toISOString()
            // Generate path uses live usageReport; review-dialog save passes usage_override.
            const clientUsage =
              request.body?.usage_override ||
              (request.body?.usage && !request.body.usage.skip_generate
                ? request.body.usage
                : null)
            const usageForMeter = didGenerate
              ? usageReport
              : clientUsage && usageNumbersFromReport(clientUsage)
                ? clientUsage
                : null
            const usageFields = mergeGeminiUsageOntoEvent(
              existing,
              usageForMeter,
              saveNowIso,
            )
            const mergedEvent = {
              ...existing,
              ...incoming,
              event_date: eventDate,
              display_date: incoming.display_date || existing.display_date || null,
              time_label: incoming.time_label || existing.time_label || null,
              price: price || incoming.price || existing.price || null,
              price_change:
                priceChange ||
                incoming.price_change ||
                existing.price_change ||
                existing.momentum ||
                null,
              momentum:
                priceChange ||
                incoming.momentum ||
                existing.momentum ||
                existing.price_change ||
                null,
              direction: incoming.direction || existing.direction || null,
              premarket_change:
                premarketChangeFromEvent(incoming) ||
                premarketChangeFromEvent(existing) ||
                null,
              premarket_direction:
                incoming.premarket_direction || existing.premarket_direction || null,
              premarket_reason:
                premarketReasonFromEvent(incoming) ||
                premarketReasonFromEvent(existing) ||
                null,
              after_hours_price:
                afterHoursPriceFromEvent(incoming) ||
                afterHoursPriceFromEvent(existing) ||
                null,
              after_hours_change:
                afterHoursChangeFromEvent(incoming) ||
                afterHoursChangeFromEvent(existing) ||
                null,
              after_hours_direction:
                incoming.after_hours_direction ||
                existing.after_hours_direction ||
                null,
              // Keep first scrape reason for re-runs; replace summary with notification text.
              original_summary: previousReason || null,
              summary,
              reasons: summary
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean),
              sources: Array.isArray(incoming.sources)
                ? incoming.sources
                : Array.isArray(existing.sources)
                  ? existing.sources
                  : [],
              claimed_source_count:
                incoming.claimed_source_count ?? existing.claimed_source_count ?? null,
              gemini_classified_at: didGenerate
                ? new Date().toISOString()
                : existing.gemini_classified_at ||
                  incoming.gemini_classified_at ||
                  // Saving a structured Gemini body with skip_generate still counts.
                  (structuredReasonHasLikelyDriver(summary)
                    ? new Date().toISOString()
                    : null),
              gemini_model: didGenerate
                ? modelVersion || model
                : existing.gemini_model ||
                  incoming.gemini_model ||
                  modelVersion ||
                  model ||
                  null,
              // Tag used by dashboard to skip already-formatted dates.
              // Also true when skip_generate saves a structured "Likely driver:" body
              // (review dialog path), so UI does not keep showing "No Gemini".
              gemini_formating: didGenerate
                ? true
                : Boolean(
                    existing.gemini_formating ||
                      incoming.gemini_formating ||
                      existing.gemini_classified_at ||
                      incoming.gemini_classified_at ||
                      structuredReasonHasLikelyDriver(summary),
                  ),
              ...usageFields,
            }

            const nowIso = saveNowIso
            const { dates, written } = mergeDatesIntoMap(
              loaded.dates,
              [mergedEvent],
              nowIso,
            )
            const meta = await loadTickerMeta(supabase, ticker, monitorScope)
            const route = classifyAsset(ticker, meta.company_name || companyName)
            const teUrl =
              route.scrape_source === 'trading_economics'
                ? resolveTradingEconomicsTarget(
                    ticker,
                    meta.company_name || companyName,
                  ).url
                : null
            const payload = buildNotablePayload({
              ticker,
              dates,
              sourceUrl:
                request.body?.source_url ||
                teUrl ||
                perplexityFinanceUrl(ticker),
              scrapedAt: request.body?.scraped_at || nowIso,
              nowIso,
              sourceProvider:
                request.body?.source_provider || route.scrape_source || null,
              assetClass: request.body?.asset_class || route.asset_class || null,
            })
            await persistTickerDates(supabase, ticker, payload, monitorScope)
            saveResult = {
              ok: true,
              saved: true,
              ticker,
              event_date: eventDate,
              written_dates: written,
              monitor_scope: monitorScope,
              monitor_table: monitorTable,
              message: `Saved Gemini notification for ${ticker} · dates[${eventDate}] · ${monitorTable}`,
              structure: 'notable_price_movements.dates[YYYY-MM-DD].summary',
            }
            // Mirror Gemini spend into daily ledger for header popup (also derived from dates).
            if (usageForMeter && !usageForMeter.skip_generate) {
              const nums = usageNumbersFromReport(usageForMeter)
              if (nums) {
                void recordGeminiUsageLedger(supabase, {
                  ticker,
                  credits_used: nums.credits_used,
                  cost_usd: nums.cost_usd,
                  meta: {
                    event_date: eventDate,
                    model: modelVersion || model,
                    skip_generate: false,
                  },
                })
              }
            } else if (usageForMeter && usageNumbersFromReport(usageForMeter)?.total_tokens) {
              const nums = usageNumbersFromReport(usageForMeter)
              void recordGeminiUsageLedger(supabase, {
                ticker,
                credits_used: nums.credits_used,
                cost_usd: nums.cost_usd,
                meta: {
                  event_date: eventDate,
                  model: modelVersion || model,
                  skip_generate: true,
                },
              })
            }
          }
        } else if (autoSave) {
          saveResult = {
            ok: false,
            saved: false,
            error:
              !ticker
                ? 'auto_save skipped — ticker required'
                : 'auto_save skipped — valid event_date (YYYY-MM-DD) required',
          }
        }

        response.json({
          ok: true,
          model: skipGenerate ? null : model,
          model_version: usageReport?.model_version || null,
          models_tried: skipGenerate ? [] : modelsTried,
          model_errors: skipGenerate ? [] : modelErrors,
          model_switched: skipGenerate ? false : modelSwitched,
          model_switch_from: skipGenerate ? null : modelSwitchFrom,
          model_switch_to: skipGenerate ? null : modelSwitchTo,
          model_switch_reason: skipGenerate ? null : modelSwitchReason,
          skip_generate: skipGenerate,
          ticker: ticker || null,
          event_date: eventDate || null,
          original: text || null,
          summary,
          lines,
          usage: usageReport,
          tokens: usageReport
            ? {
                prompt: usageReport.prompt_tokens,
                output: usageReport.output_tokens,
                thoughts: usageReport.thoughts_tokens,
                total: usageReport.total_tokens,
              }
            : null,
          credits_used: usageReport?.credits_used ?? 0,
          cost_usd: usageReport?.cost_usd_total ?? 0,
          cost_usd_display: usageReport?.cost_usd_display || '$0.000000',
          max_output_tokens: skipGenerate ? null : geminiMaxOutputTokens(),
          validation: usageReport?.validation || {
            has_likely_driver: skipGenerate
              ? structuredReasonHasLikelyDriver(summary)
              : true,
            retries: usageReport?.validation?.retries ?? 0,
          },
          auto_save: saveResult,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Gemini summarize failed',
        })
      }
    },

    /**
     * Momentum research — single-shot Gemini live research (no scraping).
     *
     * phase = "run" (default) | "gemini": build asset-class prompt + call Gemini
     * phase = "prepare": build prompt only (optional expand/edit)
     *
     * Body: ticker, company_name?, window_key, window_label?, exact_label?,
     * exact_minutes?, move_percent?, live_price?, reference_price?,
     * reference_time?, market_session?, asset_class?, prompt? (override)
     */
    async momentumResearch(request, response) {
      try {
        const phaseRaw = String(request.body?.phase || 'run')
          .trim()
          .toLowerCase()
        const phase = phaseRaw === 'prepare' ? 'prepare' : 'run'

        const ticker = normalizeTicker(
          request.body?.ticker || request.params?.ticker || '',
        )
        if (!ticker) {
          response.status(400).json({ error: 'ticker is required' })
          return
        }
        const companyName = String(
          request.body?.company_name || request.body?.label || '',
        ).trim()
        const windowKey = String(request.body?.window_key || 'day').trim() || 'day'
        const windowLabel = String(
          request.body?.window_label || windowKey,
        ).trim()
        const exactLabel = String(request.body?.exact_label || '').trim()
        const exactMinutes = Number(request.body?.exact_minutes)
        const movePercent = Number(request.body?.move_percent)
        const moveText = Number.isFinite(movePercent)
          ? `${movePercent > 0 ? '+' : ''}${movePercent.toFixed(2)}%`
          : String(request.body?.price_change || request.body?.momentum || '').trim()
        const livePrice = request.body?.live_price
        const referencePrice = request.body?.reference_price
        const referenceTime = request.body?.reference_time
          ? String(request.body.reference_time)
          : null
        const marketSession = String(request.body?.market_session || '').trim()
        const assetClassIn = String(request.body?.asset_class || '').trim()
        const classification = classifyAsset(ticker, companyName)
        const assetClass =
          assetClassIn ||
          classification.asset_class ||
          classification.scrape_source ||
          'equity'
        const cls = String(assetClass || 'equity').toLowerCase()

        let preferredTimePhrase = String(
          request.body?.preferred_time_phrase || '',
        ).trim()
        const sess = marketSession.toUpperCase()
        if (!preferredTimePhrase) {
          if (windowKey === 'day') {
            if (sess === 'PRE') preferredTimePhrase = 'in pre-market trading'
            else if (sess === 'PREPRE') preferredTimePhrase = 'overnight'
            else if (sess === 'POST' || sess === 'POSTPOST')
              preferredTimePhrase = 'in after-hours trading'
            else if (sess === 'CLOSED') preferredTimePhrase = 'at the close'
            else preferredTimePhrase = 'so far in regular trading'
          } else if (exactLabel) {
            preferredTimePhrase = `in the last ${exactLabel}`
          } else {
            preferredTimePhrase = `over the last ${windowLabel}`
          }
        }

        const userMovement = buildMomentumUserMovementLine({
          ticker,
          companyName,
          moveText,
          preferredTimePhrase,
          exactLabel,
          windowLabel,
          windowKey,
        })
        const inputFacts = buildMomentumInputFacts({
          ticker,
          companyName,
          assetClass: cls,
          moveText,
          preferredTimePhrase,
          exactLabel,
          exactMinutes,
          windowLabel,
          windowKey,
          livePrice,
          referencePrice,
          referenceTime,
          marketSession,
        })
        const eventDate =
          String(request.body?.event_date || '').trim().slice(0, 10) ||
          todayIsoEastern()

        const promptTemplate =
          String(
            request.body?.prompt_template || request.body?.custom_prompt || '',
          ).trim() || buildMomentumResearchGeminiPromptTemplate(cls)

        let fullPrompt = String(request.body?.prompt || '').trim()
        if (!fullPrompt) {
          fullPrompt = fillMomentumResearchPrompt(
            promptTemplate,
            userMovement,
            inputFacts,
          )
        } else if (
          !fullPrompt.includes(userMovement) &&
          fullPrompt.includes('{{USER_MOVEMENT}}')
        ) {
          fullPrompt = fillMomentumResearchPrompt(
            fullPrompt,
            userMovement,
            inputFacts,
          )
        } else if (!/USER MOVEMENT/i.test(fullPrompt)) {
          // Client edited template without movement — always append input
          fullPrompt = `${fullPrompt}\n\n─── AUTHORITATIVE INPUT ───\n\nUSER MOVEMENT:\n${userMovement}\n\nINPUT FACTS:\n${inputFacts}`
        }

        const preferredModel =
          String(
            process.env.PERPLEXITY_MODEL || request.body?.model || '',
          ).trim() || 'perplexity/deepseek-v4-flash-0731'

        if (phase === 'prepare') {
          response.json({
            ok: true,
            phase: 'prepare',
            provider: 'perplexity',
            model: preferredModel,
            tools: [
              {
                name: 'web_search',
                provider: 'perplexity',
                description: 'Sonar built-in live web search',
              },
            ],
            ticker,
            company_name: companyName || null,
            asset_class: cls,
            event_date: eventDate,
            window_key: windowKey,
            window_label: windowLabel,
            exact_label: exactLabel || null,
            preferred_time_phrase: preferredTimePhrase,
            user_movement: userMovement,
            input_facts: inputFacts,
            scrape_source: 'none',
            source_url: null,
            sources: [],
            raw_summary: null,
            information_block: `USER MOVEMENT:\n${userMovement}\n\nINPUT FACTS:\n${inputFacts}`,
            prompt_template: promptTemplate,
            prompt: fullPrompt,
            process_steps: [
              {
                id: 'classify',
                label: 'Asset class + movement',
                status: 'done',
                detail: `${cls} · ${userMovement}`,
              },
              {
                id: 'build_prompt',
                label: 'Build research prompt',
                status: 'done',
                detail: `${fullPrompt.length.toLocaleString()} chars · model ${preferredModel}`,
              },
              {
                id: 'await_run',
                label: 'Ready for Perplexity',
                status: 'pending',
                detail: 'Web search via Sonar on Run research',
              },
            ],
          })
          return
        }

        // ─── RUN: Perplexity Sonar (built-in web search) — no Gemini ───
        const apiKey = String(process.env.PERPLEXITY_API_KEY || '').trim()
        if (!apiKey) {
          response.status(500).json({
            error:
              'Add PERPLEXITY_API_KEY to .env.local (server-side only). Momentum research uses Perplexity web search.',
          })
          return
        }

        if (!String(fullPrompt || '').trim()) {
          response.status(400).json({
            error: 'Empty research prompt — missing USER MOVEMENT input',
          })
          return
        }

        const maxOutputTokens = geminiMaxOutputTokens()

        let summary = ''
        let model = preferredModel
        let modelVersion = null
        let requestId = null
        let usageReport = null
        let modelsTried = [preferredModel]
        let modelErrors = []
        let citations = []
        let searchResults = []
        let toolsUsed = []
        let costInfo = null
        let costUsdDisplay = null
        let usageRaw = null
        let structureRetried = false
        let finishReason = null
        let searchActuallyUsed = true

        try {
          let result = await callPerplexityResearch({
            apiKey,
            model: preferredModel,
            prompt: fullPrompt,
            maxTokens: maxOutputTokens,
          })

          // One structure retry if Likely driver missing
          if (!structuredReasonHasLikelyDriver(result.summary)) {
            structureRetried = true
            const retryPrompt = [
              fullPrompt,
              '',
              'CRITICAL REVISION:',
              'Your previous answer did not include a valid structured reason.',
              'You MUST output the exact format with these labels on their own lines:',
              'Likely driver: …',
              'Secondary driver: …',
              'Move classification: …',
              'Confidence: …',
              'Do not omit "Likely driver:".',
            ].join('\n')
            try {
              result = await callPerplexityResearch({
                apiKey,
                model: preferredModel,
                prompt: retryPrompt,
                maxTokens: maxOutputTokens,
              })
            } catch (retryErr) {
              modelErrors.push({
                model: preferredModel,
                error:
                  retryErr instanceof Error
                    ? retryErr.message
                    : String(retryErr),
              })
            }
          }

          summary = sanitizeGeminiSessionHeadline(result.summary, {
            preferred_time_phrase: preferredTimePhrase,
            allow_todays_session: windowKey === 'day' && sess === 'CLOSED',
            phase:
              sess === 'PRE'
                ? 'pre_market'
                : sess === 'PREPRE'
                  ? 'overnight'
                  : sess === 'POST' || sess === 'POSTPOST'
                    ? 'after_hours'
                    : sess === 'CLOSED'
                      ? 'regular_closed'
                      : 'regular_hours_open',
          })
          summary = sanitizeStockHeadlineInSummary(
            summary,
            ticker,
            companyName,
            cls,
          )
          model = result.model
          modelVersion = result.modelVersion
          requestId = result.requestId || null
          citations = result.citations || []
          searchResults = result.search_results || []
          toolsUsed = result.tools || []
          costInfo = result.cost || null
          costUsdDisplay = result.cost_usd_display || null
          usageRaw = result.usageRaw || null
          finishReason = result.finishReason || null
          usageReport = result.usageMetadata
            ? {
                ...buildGeminiUsageReport(
                  result.usageMetadata,
                  model,
                  modelVersion,
                ),
                cost_usd_display:
                  costUsdDisplay ||
                  buildGeminiUsageReport(
                    result.usageMetadata,
                    model,
                    modelVersion,
                  )?.cost_usd_display,
                // Prefer Perplexity's own cost totals when present
                perplexity_cost: costInfo,
                prompt_tokens: result.usageMetadata.promptTokenCount,
                completion_tokens: result.usageMetadata.candidatesTokenCount,
                total_tokens: result.usageMetadata.totalTokenCount,
                search_context_size:
                  result.usageMetadata.searchContextSize || null,
              }
            : null
          if (costUsdDisplay && usageReport) {
            usageReport.cost_usd_display = costUsdDisplay
          }
        } catch (error) {
          const status =
            error?.status === 429 || error?.quota
              ? 429
              : error?.status === 401 || error?.status === 403
                ? 401
                : 502
          response.status(status).json({
            error:
              error instanceof Error
                ? error.message
                : 'Perplexity momentum research failed',
            phase: 'run',
            provider: 'perplexity',
            require_web_search: true,
            model: preferredModel,
            models_tried: modelsTried,
            model_errors: [
              {
                model: preferredModel,
                error:
                  error instanceof Error ? error.message : String(error),
              },
            ],
            tools: [
              {
                name: 'web_search',
                provider: 'perplexity',
                description: 'Sonar built-in live web search',
              },
            ],
            process_steps: [
              {
                id: 'call_perplexity',
                label: 'Call Perplexity Sonar',
                status: 'error',
                detail:
                  error instanceof Error ? error.message : String(error),
              },
            ],
            prompt: fullPrompt,
            user_movement: userMovement,
            input_facts: inputFacts,
          })
          return
        }

        if (!summary) {
          response.status(502).json({
            error: 'Perplexity returned an empty reason',
            phase: 'run',
            provider: 'perplexity',
            model,
            prompt: fullPrompt,
            user_movement: userMovement,
          })
          return
        }

        if (!structuredReasonHasLikelyDriver(summary)) {
          response.status(502).json({
            error:
              'Perplexity response missing "Likely driver:" — try again or edit the prompt.',
            phase: 'run',
            provider: 'perplexity',
            model,
            reason: summary,
            prompt: fullPrompt,
            user_movement: userMovement,
            citations,
            search_results: searchResults,
            usage: usageReport,
            cost: costInfo,
            cost_usd_display: costUsdDisplay,
          })
          return
        }

        const likelyLine = summary
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => /^likely driver:\s*/i.test(l))
        // Dashes → commas before Supabase save + push
        const likelyDriver = formatDashesToCommas(
          likelyLine
            ? likelyLine.replace(/^likely driver:\s*/i, '').trim()
            : '',
        )
        summary = formatDashesToCommas(summary)
        const headlineLine = formatDashesToCommas(
          summary
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find(
              (l) =>
                l &&
                !/^likely driver:/i.test(l) &&
                !/^secondary/i.test(l) &&
                !/^move classification:/i.test(l) &&
                !/^confidence:/i.test(l),
            ) || '',
        )

        // Title: 🟢 SNDK +7.6% in last 3 trading hours (ticker, trading-time wording)
        // Body:  Likely driver only
        const dirForTitle =
          Number.isFinite(movePercent) && movePercent < 0 ? 'DOWN' : 'UP'
        const pushTitle = buildMomentumAlertTitle({
          ticker,
          direction: dirForTitle,
          movePercent: Number.isFinite(movePercent) ? movePercent : null,
          exactMinutes: Number.isFinite(exactMinutes) ? exactMinutes : null,
          exactLabel: exactLabel || null,
          windowKey,
          referenceTime,
          nowIso: new Date().toISOString(),
          marketSession,
        })
        const pushBody = likelyDriver || ''

        const processSteps = [
          {
            id: 'classify',
            label: 'Asset class + movement',
            status: 'done',
            detail: `${cls} · ${userMovement}`,
          },
          {
            id: 'build_prompt',
            label: 'Build research prompt',
            status: 'done',
            detail: `${fullPrompt.length.toLocaleString()} chars`,
          },
          {
            id: 'call_perplexity',
            label: 'Call Perplexity Sonar',
            status: 'done',
            detail: `Model ${modelVersion || model}${structureRetried ? ' · structure retry' : ''}${finishReason ? ` · finish ${finishReason}` : ''}`,
            result: {
              endpoint: 'https://api.perplexity.ai/v1/agent',
              model: modelVersion || model,
              request_id: requestId,
            },
          },
          {
            id: 'web_search',
            label: 'Web search / grounding',
            status: 'done',
            detail: `${searchResults.length} result(s) · ${citations.length} citation(s) · tool web_search`,
            result: {
              tool: 'web_search',
              provider: 'perplexity',
              endpoint: 'Agent API tools',
              search_context_size: usageRaw?.search_context_size || null,
            },
          },
          {
            id: 'parse_output',
            label: 'Parse Likely / Secondary driver',
            status: 'done',
            detail: likelyDriver
              ? `Likely driver: ${String(likelyDriver).slice(0, 120)}`
              : 'Structured reason parsed',
          },
          {
            id: 'fill_push',
            label: 'Fill push title + body',
            status: 'done',
            detail: 'Preview ready',
          },
        ]

        // Save research findings into the asset-class Supabase table
        let saveResult = null
        try {
          const supabase = getSupabase()
          saveResult = await saveMomentumResearchRow(supabase, {
            ticker,
            company_name: companyName || null,
            asset_class: cls,
            event_date: eventDate,
            window_key: windowKey,
            window_label: windowLabel,
            exact_label: exactLabel || null,
            exact_minutes: Number.isFinite(exactMinutes) ? exactMinutes : null,
            move_percent: Number.isFinite(movePercent) ? movePercent : null,
            user_movement: userMovement,
            market_session: marketSession || null,
            live_price: livePrice,
            reference_price: referencePrice,
            reference_time: referenceTime,
            headline: headlineLine || null,
            likely_driver: likelyDriver || null,
            reason: summary,
            push_title: pushTitle,
            push_body: pushBody,
            model,
            model_version: modelVersion,
            request_id: requestId,
            provider: 'perplexity',
            citations,
            search_results: searchResults,
            tools: toolsUsed,
            tokens: {
              prompt: usageRaw?.prompt_tokens ?? null,
              completion: usageRaw?.completion_tokens ?? null,
              total: usageRaw?.total_tokens ?? null,
            },
            cost: costInfo,
            cost_usd_display: costUsdDisplay,
            prompt: fullPrompt,
            input_facts: inputFacts,
            process_steps: processSteps,
          })
          processSteps.push({
            id: 'save_supabase',
            label: `Save to Supabase (${saveResult.table || '…'})`,
            status: saveResult.ok ? 'done' : 'error',
            detail: saveResult.ok
              ? `id ${saveResult.id || '—'} · ${saveResult.table}`
              : saveResult.error || 'save failed',
            result: saveResult,
          })
        } catch (saveErr) {
          saveResult = {
            ok: false,
            error:
              saveErr instanceof Error ? saveErr.message : String(saveErr),
          }
          processSteps.push({
            id: 'save_supabase',
            label: 'Save to Supabase',
            status: 'error',
            detail: saveResult.error,
          })
        }

        response.json({
          ok: true,
          phase: 'run',
          provider: 'perplexity',
          use_google_search: searchActuallyUsed,
          use_web_search: searchActuallyUsed,
          require_web_search: true,
          ticker,
          company_name: companyName || null,
          asset_class: cls,
          event_date: eventDate,
          window_key: windowKey,
          window_label: windowLabel,
          exact_label: exactLabel || null,
          preferred_time_phrase: preferredTimePhrase,
          user_movement: userMovement,
          input_facts: inputFacts,
          scrape_source: 'none',
          source_url: null,
          sources: citations,
          citations,
          search_results: searchResults,
          tools: toolsUsed.length
            ? toolsUsed
            : [
                {
                  name: 'web_search',
                  provider: 'perplexity',
                  description: 'Agent API web_search tool',
                },
              ],
          raw_summary: null,
          information_block: `USER MOVEMENT:\n${userMovement}\n\nINPUT FACTS:\n${inputFacts}`,
          prompt_template: promptTemplate,
          prompt: fullPrompt,
          reason: summary,
          likely_driver: likelyDriver || null,
          headline: headlineLine || null,
          push_title: pushTitle,
          push_body: pushBody,
          model,
          model_version: modelVersion,
          request_id: requestId,
          models_tried: modelsTried,
          model_errors: modelErrors,
          structure_retried: structureRetried,
          finish_reason: finishReason,
          usage: usageReport,
          usage_raw: usageRaw,
          cost: costInfo,
          tokens: {
            prompt: usageRaw?.prompt_tokens ?? usageReport?.prompt_tokens ?? null,
            completion:
              usageRaw?.completion_tokens ??
              usageReport?.completion_tokens ??
              null,
            total:
              usageRaw?.total_tokens ?? usageReport?.total_tokens ?? null,
            search_context_size: usageRaw?.search_context_size || null,
          },
          credits_used: usageReport?.credits_used ?? 0,
          cost_usd_display:
            costUsdDisplay || usageReport?.cost_usd_display || '$0.000000',
          chosen_event_date: eventDate,
          process_steps: processSteps,
          supabase_save: saveResult,
        })

        // Track Perplexity spend for dashboard (non-blocking)
        try {
          const supabase = getSupabase()
          const totalTok =
            Number(usageRaw?.total_tokens) ||
            Number(usageReport?.total_tokens) ||
            Number(usageReport?.credits_used) ||
            0
          const costUsd =
            Number(costInfo?.total_cost) ||
            Number(usageReport?.cost_usd_total) ||
            Number(usageReport?.cost_usd) ||
            0
          void recordPerplexityUsageLedger(supabase, {
            ticker,
            credits_used: totalTok,
            total_tokens: totalTok,
            prompt_tokens:
              Number(usageRaw?.prompt_tokens) ||
              Number(usageReport?.prompt_tokens) ||
              0,
            completion_tokens:
              Number(usageRaw?.completion_tokens) ||
              Number(usageReport?.completion_tokens) ||
              0,
            cost_usd: costUsd,
            meta: {
              model,
              request_id: requestId,
              window_key: windowKey,
              asset_class: cls,
              structure_retried: structureRetried,
            },
          })
        } catch (ledgerErr) {
          console.warn(
            '[perplexity usage] ledger failed:',
            ledgerErr?.message || ledgerErr,
          )
        }
      } catch (error) {
        response.status(500).json({
          error:
            error instanceof Error ? error.message : 'Momentum research failed',
        })
      }
    },

    async usagePerplexity(request, response) {
      try {
        const days = Math.min(90, Math.max(1, Number(request.query?.days) || 30))
        const supabase = getSupabase()
        const agg = await loadPerplexityUsageDaily({ supabase, days })
        response.json({
          ok: true,
          provider: 'perplexity',
          days,
          daily: agg.daily,
          total_cost_usd: agg.total_cost_usd,
          total_cost_usd_display: agg.total_cost_usd_display,
          total_credits: agg.total_credits,
          total_tokens: agg.total_tokens,
          total_calls: agg.total_calls,
          // Perplexity API does not expose remaining prepaid balance publicly
          balance: {
            remaining_usd: null,
            note:
              'Remaining prepaid balance is only on console.perplexity.ai — this app tracks spend from each research call.',
            console_url: 'https://www.perplexity.ai/account/api/billing',
          },
          note:
            'Credits = tokens used. Cost = Perplexity usage.cost.total_cost from each Agent call.',
        })
      } catch (error) {
        response.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to load Perplexity usage',
        })
      }
    },

    async usageGemini(request, response) {
      try {
        const days = Math.min(90, Math.max(1, Number(request.query?.days) || 30))
        const supabase = getSupabase()
        const { data: rows, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, notable_price_movements')
        if (error) throw error
        const daily = aggregateGeminiSpendByDay(rows || [], { days })
        const total_cost = daily.reduce((s, d) => s + (Number(d.cost_usd) || 0), 0)
        const total_tokens = daily.reduce((s, d) => s + (Number(d.total_tokens) || 0), 0)
        response.json({
          ok: true,
          provider: 'gemini',
          days,
          daily,
          total_cost_usd: Math.round(total_cost * 1e8) / 1e8,
          total_cost_usd_display: formatUsdDisplay(total_cost),
          total_tokens,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to load Gemini usage',
        })
      }
    },

    async usageFirecrawl(request, response) {
      try {
        const days = Math.min(90, Math.max(1, Number(request.query?.days) || 30))
        const supabase = getSupabase()
        const cutoff = new Date()
        cutoff.setUTCDate(cutoff.getUTCDate() - days)
        const cutoffDay = cutoff.toISOString().slice(0, 10)

        const { data: rows, error } = await supabase
          .from('usage_daily_ledger')
          .select('day, credits_used, ticker, meta, created_at')
          .eq('provider', 'firecrawl')
          .gte('day', cutoffDay)
          .order('day', { ascending: false })

        if (error) {
          if (/usage_daily_ledger|does not exist/i.test(error.message || '')) {
            response.json({
              ok: true,
              provider: 'firecrawl',
              days,
              daily: [],
              total_credits: 0,
              note: 'usage_daily_ledger not applied yet — run schema_usage_and_jobs.sql',
            })
            return
          }
          throw error
        }

        const byDay = new Map()
        for (const row of rows || []) {
          const day = String(row.day).slice(0, 10)
          const prev = byDay.get(day) || { day, credits_used: 0, scrapes: 0 }
          prev.credits_used += Number(row.credits_used) || 0
          prev.scrapes += 1
          byDay.set(day, prev)
        }
        const daily = [...byDay.values()].sort((a, b) =>
          String(b.day).localeCompare(String(a.day)),
        )
        const total_credits = daily.reduce(
          (s, d) => s + (Number(d.credits_used) || 0),
          0,
        )

        let balance = null
        try {
          balance = await getFirecrawlCreditUsage()
        } catch {
          balance = null
        }

        response.json({
          ok: true,
          provider: 'firecrawl',
          days,
          daily,
          total_credits,
          balance,
        })
      } catch (error) {
        response.status(500).json({
          error:
            error instanceof Error ? error.message : 'Failed to load Firecrawl usage',
        })
      }
    },

    /**
     * Market-close job: fetch+save all → Gemini ≥4% → Today digest (all Trigger users).
     * Auth: Bearer CRON_SECRET
     */
    async marketCloseJob(request, response) {
      const supabase = getSupabase()
      let runId = null
      try {
        assertCronAuth(request)
        if (String(process.env.MARKET_CLOSE_JOB_ENABLED || '1') === '0') {
          response.json({ ok: true, skipped: true, reason: 'MARKET_CLOSE_JOB_ENABLED=0' })
          return
        }

        const dryRun =
          request.query?.dry_run === '1' ||
          request.body?.dry_run === true ||
          request.body?.dry_run === '1'
        const runDateEt = todayIsoEastern()

        if (!dryRun) {
          const { data: existing } = await supabase
            .from('market_close_runs')
            .select('id, status')
            .eq('run_date_et', runDateEt)
            .eq('dry_run', false)
            .maybeSingle()
          if (existing && ['success', 'partial', 'running'].includes(existing.status)) {
            response.json({
              ok: true,
              skipped: true,
              reason: `Already have run ${existing.id} status=${existing.status} for ${runDateEt}`,
              run_id: existing.id,
            })
            return
          }
        }

        const { data: runRow, error: runErr } = await supabase
          .from('market_close_runs')
          .insert({
            run_date_et: runDateEt,
            status: 'running',
            dry_run: dryRun,
          })
          .select('id')
          .single()
        if (runErr) {
          if (/duplicate|unique/i.test(runErr.message || '')) {
            response.json({ ok: true, skipped: true, reason: runErr.message })
            return
          }
          throw runErr
        }
        runId = runRow.id

        const { data: rows, error: listErr } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, company_name, subscribers, notable_price_movements')
        if (listErr) throw listErr

        const tickers = []
        for (const row of rows || []) {
          const ticker = normalizeTicker(row.ticker)
          if (!ticker) continue
          const route = classifyAsset(ticker, row.company_name)
          if (route.asset_class && route.asset_class !== 'equity') continue
          const subs = Array.isArray(row.subscribers) ? row.subscribers : []
          const triggerCount = subs.filter(
            (s) =>
              s &&
              isSubscriberEnabled(s) &&
              subscriberNotificationApp(s) === 'trigger' &&
              String(s.expo_push_token || '').trim(),
          ).length
          if (triggerCount < 1) continue
          tickers.push({
            ticker,
            company_name: row.company_name || ticker,
            subscriber_count: triggerCount,
          })
        }

        let tickersOk = 0
        let tickersFailed = 0
        let hitsGe4 = 0
        let geminiOk = 0
        let geminiFailed = 0
        const hitEvents = []

        for (const item of tickers) {
          const tickerRes = mockResCapture()
          try {
            await handlers.scrape(
              {
                params: { ticker: item.ticker },
                query: { auto_save: dryRun ? '0' : '1' },
                body: {},
                headers: {},
              },
              tickerRes,
            )
            const body = tickerRes.state.body || {}
            if (tickerRes.state.statusCode >= 400 || !body.ok) {
              tickersFailed += 1
              await supabase.from('market_close_run_tickers').insert({
                run_id: runId,
                ticker: item.ticker,
                status: 'error',
                error: body.error || `HTTP ${tickerRes.state.statusCode}`,
              })
              continue
            }

            const events = Array.isArray(body.events) ? body.events : []
            const pending = events.filter(
              (e) => e.save_status === 'new' || e.save_status === 'changed',
            )
            const notable = pending.filter((e) => eventClosePremarketAbs(e) >= 4)
            hitsGe4 += notable.length
            tickersOk += 1

            let geminiCount = 0
            if (!dryRun) {
              for (const event of notable) {
                const sourceText = String(
                  event.original_summary || event.summary || '',
                ).trim()
                if (!sourceText) {
                  geminiFailed += 1
                  continue
                }
                const gRes = mockResCapture()
                await handlers.geminiSummarize(
                  {
                    body: {
                      text: sourceText,
                      ticker: item.ticker,
                      company_name: item.company_name,
                      event_date: event.event_date,
                      price: event.price,
                      price_change: event.price_change || event.momentum,
                      event,
                      auto_save: true,
                    },
                    headers: {},
                    query: {},
                    params: {},
                  },
                  gRes,
                )
                if (gRes.state.statusCode < 400 && gRes.state.body?.ok) {
                  geminiOk += 1
                  geminiCount += 1
                } else {
                  geminiFailed += 1
                }
              }
            }

            hitEvents.push(
              ...notable.map((e) => ({
                ticker: item.ticker,
                event_date: e.event_date,
                abs: eventClosePremarketAbs(e),
              })),
            )

            await supabase.from('market_close_run_tickers').insert({
              run_id: runId,
              ticker: item.ticker,
              status: 'ok',
              hit_count: notable.length,
              gemini_count: geminiCount,
              detail: { compare: body.compare, auto_save: body.auto_save },
            })
          } catch (err) {
            tickersFailed += 1
            await supabase.from('market_close_run_tickers').insert({
              run_id: runId,
              ticker: item.ticker,
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        let digestSentOk = 0
        let digestSentFailed = 0
        let digestMessage = null
        if (!dryRun) {
          const dRes = mockResCapture()
          await handlers.alertTriggerDigest(
            {
              body: { title: "Today's notable price momentum" },
              headers: {},
              query: {},
              params: {},
            },
            dRes,
          )
          const dBody = dRes.state.body || {}
          if (dRes.state.statusCode < 400 && dBody.ok !== false) {
            digestSentOk = Number(dBody.sent_ok ?? dBody.recipient_count ?? 0) || 0
            digestSentFailed = Number(dBody.sent_failed ?? 0) || 0
            digestMessage = dBody.message || null
          } else {
            digestMessage = dBody.error || 'Digest failed'
            digestSentFailed = 1
          }
        }

        const status =
          tickersFailed === 0 ? 'success' : tickersOk > 0 ? 'partial' : 'failed'

        await supabase
          .from('market_close_runs')
          .update({
            status,
            finished_at: new Date().toISOString(),
            tickers_total: tickers.length,
            tickers_ok: tickersOk,
            tickers_failed: tickersFailed,
            hits_ge_4pct: hitsGe4,
            gemini_ok: geminiOk,
            gemini_failed: geminiFailed,
            digest_sent_ok: digestSentOk,
            digest_sent_failed: digestSentFailed,
            detail: {
              dry_run: dryRun,
              hits: hitEvents.slice(0, 200),
              digest_message: digestMessage,
            },
          })
          .eq('id', runId)

        response.json({
          ok: true,
          run_id: runId,
          run_date_et: runDateEt,
          dry_run: dryRun,
          status,
          tickers_total: tickers.length,
          tickers_ok: tickersOk,
          tickers_failed: tickersFailed,
          hits_ge_4pct: hitsGe4,
          gemini_ok: geminiOk,
          gemini_failed: geminiFailed,
          digest_sent_ok: digestSentOk,
          digest_sent_failed: digestSentFailed,
          digest_message: digestMessage,
        })
      } catch (error) {
        if (runId) {
          try {
            await supabase
              .from('market_close_runs')
              .update({
                status: 'failed',
                finished_at: new Date().toISOString(),
                error: error instanceof Error ? error.message : String(error),
              })
              .eq('id', runId)
          } catch {
            /* ignore */
          }
        }
        response.status(error.status || 500).json({
          error: error instanceof Error ? error.message : 'Market close job failed',
          run_id: runId,
        })
      }
    },
  }
  return handlers
}

function countSavedEvents(notable) {
  return Object.keys(extractDatesMap(notable)).length
}

/**
 * US/Eastern clock parts for equities session logic (weekday + minutes from midnight).
 * Holiday calendar is not applied — weekdays only.
 */
function getEasternMarketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (type) => parts.find((p) => p.type === type)?.value || ''
  let hour = Number(get('hour'))
  const minute = Number(get('minute'))
  // en-US hour12:false can still give 24 for midnight in some engines
  if (hour === 24) hour = 0
  const weekday = get('weekday') // Sun, Mon, ...
  const weekend = weekday === 'Sat' || weekday === 'Sun'
  const minutesFromMidnight =
    (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0)
  const dateEt = `${get('year')}-${get('month')}-${get('day')}`
  const timeEt = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET`
  return {
    dateEt,
    timeEt,
    weekday,
    weekend,
    minutesFromMidnight,
  }
}

/**
 * Resolve how the first-line TIME PERIOD should read for this event right now.
 * Prevents "in today's session" while the regular session is still open.
 */
function resolveSessionPhaseForEvent(event = {}, now = new Date()) {
  const eventDate = String(event?.event_date || '')
    .trim()
    .slice(0, 10)
  const clock = getEasternMarketClock(now)
  const todayEt = clock.dateEt
  const hasPremarket = Boolean(String(premarketChangeFromEvent(event) || '').trim())
  const hasAfterHours = Boolean(String(afterHoursChangeFromEvent(event) || '').trim())
  const hasCloseMove = Boolean(
    String(event?.price_change || event?.momentum || '').trim(),
  )
  const summaryBlob = [
    event?.summary,
    event?.original_summary,
    premarketReasonFromEvent(event),
  ]
    .filter(Boolean)
    .join(' ')
  const textHintsPremarket = /\bpre[-\s]?market\b/i.test(summaryBlob)
  const textHintsAh = /\bafter[-\s]?hours?\b|\bafter hours\b|\bpost[-\s]?market\b/i.test(
    summaryBlob,
  )
  const textHintsClose =
    /\bat the close\b|\bclosed at\b|\bsession (?:ended|finished|closed)\b|\bfinal print\b/i.test(
      summaryBlob,
    )

  // Pre-market: 4:00–9:30 ET; Regular: 9:30–16:00; AH: 16:00–20:00 (approx)
  const PRE_OPEN = 4 * 60
  const REG_OPEN = 9 * 60 + 30
  const REG_CLOSE = 16 * 60
  const AH_END = 20 * 60
  const mins = clock.minutesFromMidnight

  let phase = 'unknown'
  let preferred_time_phrase = 'in recent trading'
  let allow_todays_session = false
  let session_complete = false

  if (eventDate && /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && eventDate < todayEt) {
    phase = 'historical_closed'
    preferred_time_phrase = 'at the close'
    allow_todays_session = true
    session_complete = true
  } else if (eventDate && /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && eventDate > todayEt) {
    phase = 'future_or_unknown'
    preferred_time_phrase = 'in recent trading'
    allow_todays_session = false
    session_complete = false
  } else if (clock.weekend) {
    phase = 'weekend'
    preferred_time_phrase = 'in the latest session'
    allow_todays_session = true
    session_complete = true
  } else if (mins < PRE_OPEN) {
    phase = 'overnight'
    preferred_time_phrase = hasAfterHours || textHintsAh
      ? 'in after-hours trading'
      : 'in the latest session'
    allow_todays_session = !hasPremarket && !textHintsPremarket
    session_complete = true
  } else if (mins < REG_OPEN) {
    phase = 'pre_market'
    preferred_time_phrase = 'in pre-market trading'
    allow_todays_session = false
    session_complete = false
  } else if (mins < REG_CLOSE) {
    phase = 'regular_hours_open'
    preferred_time_phrase = 'so far in regular trading'
    allow_todays_session = false
    session_complete = false
  } else if (mins < AH_END) {
    phase = 'after_hours'
    preferred_time_phrase =
      hasAfterHours || textHintsAh
        ? 'in after-hours trading'
        : hasCloseMove || textHintsClose
          ? 'at the close'
          : 'in after-hours trading'
    allow_todays_session = !(hasAfterHours || textHintsAh)
    session_complete = true
  } else {
    phase = 'regular_closed'
    preferred_time_phrase = 'at the close'
    allow_todays_session = true
    session_complete = true
  }

  // Field/text overrides when the move itself is clearly pre-market or AH-only
  if ((hasPremarket || textHintsPremarket) && phase === 'pre_market') {
    preferred_time_phrase = 'in pre-market trading'
    allow_todays_session = false
  }
  if ((hasAfterHours || textHintsAh) && (phase === 'after_hours' || phase === 'overnight')) {
    preferred_time_phrase = 'in after-hours trading'
    allow_todays_session = false
  }

  return {
    phase,
    preferred_time_phrase,
    allow_todays_session,
    session_complete,
    clock,
    has_premarket: hasPremarket,
    has_after_hours: hasAfterHours,
    has_close_move: hasCloseMove,
    event_date: eventDate || null,
    today_et: todayEt,
  }
}

/**
 * If Gemini still writes "in today's session" while the session is incomplete,
 * rewrite the first headline line to the preferred open-market phrase.
 */
export function sanitizeGeminiSessionHeadline(summary, sessionCtx) {
  const raw = String(summary || '')
  if (!raw.trim() || !sessionCtx || sessionCtx.allow_todays_session) return raw

  const preferred = String(sessionCtx.preferred_time_phrase || '').trim()
  if (!preferred) return raw

  const lines = raw.split(/\r?\n/)
  let firstIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim()
    if (!t) continue
    if (/^likely\s*driver\s*:/i.test(t)) break
    firstIdx = i
    break
  }
  if (firstIdx < 0) return raw

  let line = lines[firstIdx]
  const banned =
    /\bin\s+today['’]?s\s+session\b|\bduring\s+today['’]?s\s+session\b|\bin\s+the\s+session\s+today\b|\bat\s+the\s+close\b|\bin\s+today['’]?s\s+trading\s+session\b/gi

  if (!banned.test(line)) {
    // Also fix "declined X% today" sounding finished when still open
    if (
      sessionCtx.phase === 'regular_hours_open' &&
      /\b(today)\b/i.test(line) &&
      !/\bso far\b/i.test(line) &&
      !/\bpre[-\s]?market\b/i.test(line)
    ) {
      line = line.replace(/\btoday\b/i, 'so far today')
      lines[firstIdx] = line
      return lines.join('\n')
    }
    return raw
  }

  // Replace banned completed-session phrases with preferred open-phase phrase
  line = line.replace(banned, () => {
    // preferred already includes leading "in" / "so far" / "at"
    return preferred
  })
  // Clean double prepositions if any (e.g. "in so far")
  line = line
    .replace(/\bin\s+so far\b/gi, 'so far')
    .replace(/\s{2,}/g, ' ')
    .trim()

  lines[firstIdx] = line
  return lines.join('\n')
}

function buildSessionContextLines(event = {}, now = new Date()) {
  const ctx = resolveSessionPhaseForEvent(event, now)
  const pre = premarketChangeFromEvent(event)
  const ah = afterHoursChangeFromEvent(event)
  const close = String(event?.price_change || event?.momentum || '').trim()
  const lines = [
    `Market clock (US/Eastern): ${ctx.clock.dateEt} ${ctx.clock.timeEt} · weekday ${ctx.clock.weekday}${ctx.clock.weekend ? ' (weekend)' : ''}`,
    `Session phase for this write-up: ${ctx.phase}`,
    `Preferred TIME PERIOD phrase: ${ctx.preferred_time_phrase}`,
    `Session complete (regular hours finished for this phrasing): ${ctx.session_complete ? 'yes' : 'no'}`,
    `Allow "in today's session" / "at the close" language: ${ctx.allow_todays_session ? 'yes' : 'no — use Preferred TIME PERIOD phrase instead'}`,
    close ? `Close / regular move field: ${close}` : null,
    pre ? `Pre-market move field: ${pre}` : null,
    ah ? `After-hours move field: ${ah}` : null,
  ].filter(Boolean)
  return { ctx, lines }
}

/**
 * One-line asset-class focus for momentum research prompts.
 */
export function buildMomentumAssetClassFocus(assetClass) {
  const cls = String(assetClass || 'equity')
    .trim()
    .toLowerCase()
  if (cls === 'commodity') {
    return 'Focus: commodity — inventory/supply, USD & yields, peers; classify as asset-specific.'
  }
  if (cls === 'crypto') {
    return 'Focus: crypto — protocol/ETF/regulation/flows; classify as asset-specific.'
  }
  if (cls === 'forex' || cls === 'fx' || cls === 'currency') {
    return 'Focus: FX — central banks, rate differentials, macro; classify as asset-specific.'
  }
  if (cls === 'index' || cls === 'etf') {
    return 'Focus: index/ETF — macro, mega-caps, sector rotation; classify as asset-specific.'
  }
  return 'Focus: equity — company news first, then sector/macro; prefer company-specific when clear. Headline ASSET must be the ticker symbol (SNDK, AAPL), never the company name.'
}

/**
 * Momentum research prompt for Perplexity Agent API.
 * Order: INSTRUCTIONS (concise) → OUTPUT → INPUT.
 * Placeholders: {{USER_MOVEMENT}}, {{INPUT_FACTS}}
 */
export function buildMomentumResearchGeminiPromptTemplate(assetClass) {
  const focus = buildMomentumAssetClassFocus(assetClass)
  return [
    '## INSTRUCTIONS',
    'Explain WHY the move below happened. Use web_search. Be concise, factual, British English.',
    '',
    'Rules:',
    '- USER MOVEMENT % and lookback are authoritative — do not replace with other site prices.',
    '- Research that exact window (now = end if no timestamp). Catalysts only before/during the move.',
    '- Search: asset news, macro, rates, geo, peers, USD/yields, supply/demand, positioning.',
    '- Likely driver = strongest catalyst only (1–2 short sentences). Secondary = other material factors (no duplicates).',
    '- Do NOT restate USER MOVEMENT in Likely/Secondary driver (no “X moved +Y% over …”, no repeating asset + % + window). The headline line already has that.',
    '- Do NOT pad Likely/Secondary with negatives or non-findings (e.g. “No single new company announcement was confirmed for the exact window”, “no press release found”, “nothing confirmed in the window”). State a real catalyst, or one short honest unknown — never that filler style.',
    '- If no secondary: Secondary driver: No clear secondary driver identified.',
    '- Do not invent prices, headlines, inventory, volume, or analyst views.',
    '- If no credible catalyst: say so in one plain line (e.g. “Unclear — no confirmed catalyst found.”). Correlation ≠ causation.',
    '- Classification totals 100%: company-specific (stocks) or asset-specific (commodities/crypto/FX/indices) + sector/market/macro-related. Or: Unattributed.',
    '- Confidence: High / Medium / Low — one short reason.',
    `- ${focus}`,
    '',
    '## OUTPUT strictly to be in this format only',
    'Return only:',
    '',
    '[ASSET] [PRICE MOVE] [EXACT TIME PERIOD]',
    '',
    'Likely driver: [catalyst only — no restated move %, no “no announcement” filler, be direct and to the point]',
    '',
    'Secondary driver: [secondary catalyst(s) only — same rules]',
    '',
    'Move classification: [X]% asset/company-specific, [Y]% sector/market/macro-related.',
    '',
    'Confidence: [High/Medium/Low] — [brief explanation]',
    '',
    '## INPUT',
    'USER MOVEMENT:',
    '{{USER_MOVEMENT}}',
    '',
    'INPUT FACTS:',
    '{{INPUT_FACTS}}',
  ].join('\n')
}

/** Build the authoritative USER_MOVEMENT line for momentum research. */
export function buildMomentumUserMovementLine({
  ticker,
  companyName,
  moveText,
  preferredTimePhrase,
  exactLabel,
  windowLabel,
  windowKey,
} = {}) {
  const cls = classifyAsset(ticker, companyName).asset_class
  const isStock =
    cls === 'equity' || isStockAlertTicker(ticker)
  const asset = isStock
    ? String(ticker || 'Asset').trim().toUpperCase()
    : String(companyName || ticker || 'Asset').trim()
  const move = String(moveText || '').trim() || 'moved'
  let period = String(preferredTimePhrase || '').trim()
  if (exactLabel) {
    period = `in the last ${String(exactLabel).trim()}`
  } else if (windowKey && windowKey !== 'day' && windowLabel) {
    period = `over the last ${String(windowLabel).trim()}`
  } else if (!period) {
    period = 'so far in regular trading'
  }
  // e.g. “Silver +3.2% in the last 45 minutes.”
  return `${asset} ${move} ${period}.`.replace(/\s+/g, ' ').trim()
}

/** Structured facts block for the INPUT section. */
export function buildMomentumInputFacts({
  ticker,
  companyName,
  assetClass,
  moveText,
  preferredTimePhrase,
  exactLabel,
  exactMinutes,
  windowLabel,
  windowKey,
  livePrice,
  referencePrice,
  referenceTime,
  marketSession,
} = {}) {
  return [
    `Ticker: ${ticker || '—'}`,
    companyName ? `Name: ${companyName}` : null,
    assetClass ? `Asset class: ${assetClass}` : null,
    moveText ? `Move % (authoritative): ${moveText}` : null,
    exactLabel ? `Lookback: ${exactLabel}` : null,
    Number.isFinite(Number(exactMinutes))
      ? `Exact minutes: ${exactMinutes}`
      : null,
    windowKey ? `Window: ${windowKey}${windowLabel ? ` (${windowLabel})` : ''}` : null,
    preferredTimePhrase ? `Time phrase: ${preferredTimePhrase}` : null,
    livePrice != null && Number.isFinite(Number(livePrice))
      ? `Live price: ${livePrice}`
      : null,
    referencePrice != null && Number.isFinite(Number(referencePrice))
      ? `Reference price: ${referencePrice}`
      : null,
    referenceTime ? `Reference time: ${referenceTime}` : null,
    marketSession ? `Session: ${marketSession}` : null,
    `As of (UTC): ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Fill research template with user movement + input facts. */
export function fillMomentumResearchPrompt(
  template,
  userMovement,
  inputFacts,
) {
  let out = String(template || '')
  if (!out.includes('{{USER_MOVEMENT}}') || !out.includes('{{INPUT_FACTS}}')) {
    // Ensure canonical order if template is incomplete
    out = [
      out.trim(),
      '',
      '## INPUT',
      'USER MOVEMENT:',
      '{{USER_MOVEMENT}}',
      '',
      'INPUT FACTS:',
      '{{INPUT_FACTS}}',
    ]
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n')
  }
  return out
    .replace(/\{\{USER_MOVEMENT\}\}/g, userMovement || '(missing movement)')
    .replace(/\{\{INPUT_FACTS\}\}/g, inputFacts || '(no facts)')
    .replace(/\{\{ASSET_CLASS_FOCUS\}\}/g, '')
}

/** Default Gemini classification prompt (without the per-event "Information to classify" block). */
export function buildDefaultGeminiPromptTemplate() {
  return [
    'You are a financial market-movement classification assistant.',
    '',
    'You will receive information explaining why a financial asset moved. The asset may be a stock, commodity, cryptocurrency, currency, index, bond, ETF, futures contract, or any other traded financial instrument.',
    '',
    'Transform the information into a concise, professional, user-facing market notification.',
    '',
    'Use only the information available in the input. Do not browse the web, independently verify facts, or add any facts, events, prices, sources, analyst views, volume figures, or explanations that are not available.',
    '',
    'IMPORTANT:',
    'The final notification must read like a standalone market-intelligence alert.',
    '',
    'Never mention:',
    '',
    '* the input',
    '* the prompt',
    '* the raw summary',
    '* supplied or provided text',
    '* supplied or provided data',
    '* the source material',
    '* that the notification was generated or transformed',
    '* that information was not independently verified',
    '* that the analysis is based on limited input',
    '* the market clock block as a meta topic (use it only to choose TIME PERIOD wording)',
    '',
    'Use this exact output format:',
    '',
    '[ASSET OR TICKER] [PRICE MOVE] [TIME PERIOD PHRASE]',
    '',
    'Likely driver: [The first complete point from the input, framed as the primary catalyst. Keep that full first point — do not over-shorten it into a stub.]',
    '',
    'Secondary driver: [Every other material point from the input that is not already stated in Likely driver. Cover the remaining catalysts completely; do not leave important summary points out.]',
    '',
    'Move classification: [X]% company/asset-specific, [Y]% sector/market/macro-related.',
    '',
    'Confidence: [High, Medium, or Low] — [brief market-focused explanation of why the identified catalyst appears strong, plausible, mixed, or uncertain.]',
    '',
    'Rules:',
    '',
    '1. Return only the completed notification.',
    '',
    '2. Do not include an introduction, explanation, disclaimer, notes, headings, bullet points, or concluding paragraph outside the notification.',
    '',
    '3. Keep the language concise, direct, professional, and notification-friendly.',
    '',
    '4. Identify the asset from the information available. For stocks/equities the first headline token MUST be the ticker symbol (e.g. SNDK, AAPL) — never the company name. For commodities, FX, crypto and indices use the common asset name (e.g. Natural Gas, Gold, Bitcoin).',
    '',
    '5. Use the exact percentage move when available. Prefer the move field that matches the session phase (pre-market field in pre-market; close/regular field in regular hours; after-hours field after the close when that is the story).',
    '',
    '6. When the move is approximate, preserve wording such as:',
    '   “over 5%”',
    '   “roughly 3%”',
    '   “nearly 7%”',
    '',
    '7. TIME PERIOD / session language (critical — do not imply a finished session while it is still open):',
    '   a. If the Information block includes “Preferred TIME PERIOD phrase” or “Session phase”, you MUST follow it for the first headline line.',
    '   b. If Session phase is pre_market (or the story is pre-market): use “in pre-market trading” (or “in pre-market”). Never say the regular session closed.',
    '   c. If Session phase is regular_hours_open (market still trading): use “so far in regular trading” or “so far today”. NEVER write “in today’s session”, “during today’s session”, or “at the close” — those imply the day is finished.',
    '   d. If Session phase is after_hours and the move is after-hours: use “in after-hours trading”.',
    '   e. If Session phase is regular_closed / historical_closed / weekend, OR the input explicitly says the stock closed / settled / final print: “at the close” or “in today’s session” is allowed.',
    '   f. If only a multi-day window is available: “over the past week”, “after earnings”, etc., when present in the input.',
    '   g. When in doubt and the market clock says regular hours are still open: choose incomplete-session wording (“so far…”), never completed-session wording.',
    '',
    '8. Likely driver = the first complete point in the input summary (the first full idea until its terminating period / full stop). Frame that full first point in clear notification English. Do not compress it into a few words or drop essential detail from that first point. Do not pack later or secondary catalysts into Likely driver.',
    '',
    '9. Do not select broader market sentiment as the likely driver when a clear company-specific or asset-specific catalyst is available.',
    '',
    '10. Secondary driver coverage (critical):',
    '    a. First identify every distinct material point in the input (company news, partnership, earnings detail, guidance, sector/macro, valuation, analyst views, positioning, technicals, etc.).',
    '    b. Put the full first primary point (framed, not truncated) in Likely driver.',
    '    c. Put ALL remaining material points into Secondary driver so the full summary is covered across Likely + Secondary.',
    '    d. Do NOT repeat the Likely driver point (or a paraphrase of it) inside Secondary driver.',
    '    e. Do NOT invent points that are not in the input.',
    '    f. If several remaining points exist, combine them into one coherent Secondary driver sentence/paragraph — still omit the primary point.',
    '    g. If nothing material remains after Likely driver, write: “Secondary driver: No clear secondary driver identified.”',
    '',
    '11. Possible secondary-driver themes (only if present in the input and not already used as Likely driver):',
    '    sector performance,',
    '    macroeconomic developments,',
    '    earnings reassessment,',
    '    valuation,',
    '    analyst commentary,',
    '    technical rebound,',
    '    bargain-hunting,',
    '    short covering,',
    '    positioning,',
    '    risk appetite,',
    '    partnership or product detail not used as the primary catalyst,',
    '    or broader market sentiment.',
    '',
    '12. The move-classification percentages must total exactly 100%.',
    '',
    '13. Use “company-specific” for the shares of an individual company.',
    '',
    '14. Use “asset-specific” for commodities, cryptocurrencies, currencies, bonds, indices, ETFs, futures, and other non-company assets.',
    '',
    '15. Use “sector/market/macro-related” for external or broader influences.',
    '',
    '16. Confidence definitions:',
    '',
    'High:',
    'A clear and direct catalyst is present, with multiple consistent supporting details.',
    '',
    'Medium:',
    'The explanation is plausible, but the move appears driven by several factors or includes meaningful interpretation.',
    '',
    'Low:',
    'No clear direct catalyst is identifiable, the explanations conflict, or the move appears largely speculative.',
    '',
    '17. The confidence explanation must focus only on the strength of the market explanation.',
    '',
    'Good example:',
    '“Confidence: High — the partnership announcement provides a clear and timely company-specific catalyst.”',
    '',
    'Good example:',
    '“Confidence: Medium — the rebound appears driven by a combination of valuation, positioning and broader technology-sector strength.”',
    '',
    'Bad example:',
    '“Confidence: Medium — based on the supplied information.”',
    '',
    'Bad example:',
    '“Confidence: Low — the source data is limited.”',
    '',
    'Bad example:',
    '“Confidence: Medium — this was not independently verified.”',
    '',
    '18. Never invent source confirmation.',
    '',
    'Do not write:',
    '“confirmed by three sources”',
    '“confirmed by market reports”',
    '“according to multiple sources”',
    '',
    'unless that exact level of confirmation is explicitly available.',
    '',
    '19. When no credible secondary driver is identifiable after assigning the primary catalyst, write:',
    '    “Secondary driver: No clear secondary driver identified.”',
    '',
    '20. When several possible catalysts are present, prioritise them according to:',
    '    a. direct company or asset announcement',
    '    b. earnings, guidance, regulatory, legal, operational, or corporate development',
    '    c. sector or peer movement',
    '    d. macroeconomic development',
    '    e. analyst commentary or valuation reassessment',
    '    f. positioning, technical movement, bargain-hunting, or sentiment',
    '    When the first complete input point (until its period) is a material catalyst, assign that full first point to Likely driver; place every later material item in Secondary driver without repeating it.',
    '',
    '21. Do not expose uncertainty about the generation process. Express uncertainty only as uncertainty about the market catalyst itself.',
    '',
    '22. Use British English.',
    '',
    '23. Do not include a Volume line or a “Tap to see” line (or any similar CTA footer).',
  ].join('\n')
}

export function mountNotificationsRoutes(app, { getSupabase }) {
  const handlers = createNotificationsRouter({ getSupabase })

  app.get('/api/notifications/monitored-tickers', (req, res) => handlers.listTickers(req, res))
  app.post('/api/notifications/monitored-tickers', (req, res) => handlers.addTicker(req, res))
  app.get('/api/notifications/pinned-tickers', (req, res) => handlers.listPinnedTickers(req, res))
  app.post('/api/notifications/pinned-tickers', (req, res) => handlers.addPinnedTicker(req, res))
  app.delete('/api/notifications/pinned-tickers/:ticker', (req, res) =>
    handlers.removePinnedTicker(req, res),
  )
  app.get('/api/notifications/firecrawl/credits', (req, res) => handlers.credits(req, res))
  app.get('/api/notifications/devices', (req, res) => handlers.listDevices(req, res))
  app.get('/api/notifications/app-settings', (req, res) => handlers.getAppSettings(req, res))
  app.put('/api/notifications/app-settings', (req, res) => handlers.updateAppSettings(req, res))
  app.get('/api/notifications/news', (req, res) => handlers.listNews(req, res))
  app.get('/api/notifications/usage/gemini', (req, res) => handlers.usageGemini(req, res))
  app.get('/api/notifications/usage/firecrawl', (req, res) =>
    handlers.usageFirecrawl(req, res),
  )
  app.get('/api/notifications/usage/perplexity', (req, res) =>
    handlers.usagePerplexity(req, res),
  )
  app.get('/api/notifications/gemini-prompt', (_req, res) => {
    res.json({
      ok: true,
      prompt_template: buildDefaultGeminiPromptTemplate(),
    })
  })
  app.post('/api/notifications/scrape/:ticker', (req, res) => handlers.scrape(req, res))
  app.post('/api/notifications/save/:ticker', (req, res) => handlers.save(req, res))
  app.post('/api/notifications/preview/:ticker', (req, res) => handlers.previewAlert(req, res))
  app.post('/api/notifications/alert/:ticker', (req, res) => handlers.alert(req, res))
  app.post('/api/notifications/alert-news', (req, res) => handlers.alertNews(req, res))
  app.post('/api/notifications/alert-trigger-digest', (req, res) =>
    handlers.alertTriggerDigest(req, res),
  )
  app.post('/api/notifications/gemini-summarize', (req, res) =>
    handlers.geminiSummarize(req, res),
  )
  app.post('/api/notifications/momentum-research', (req, res) =>
    handlers.momentumResearch(req, res),
  )
  app.post('/api/notifications/jobs/market-close', (req, res) =>
    handlers.marketCloseJob(req, res),
  )
}
