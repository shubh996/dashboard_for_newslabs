// Yahoo Finance ticker routes — completely independent of /api/edgar.
// Snapshots land in yahoo_finance_snapshots and never touch SEC tables.

import express from 'express'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'
import { FETCH_UNITS, fetchAllYahooModules, fetchUnit, listModuleCatalogue, toPlainJson } from './modules.js'
import { toYahooSymbol } from '../yahooClient.js'

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
})

const router = express.Router()

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY to .env.local')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function errorMessage(error, fallback) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
  return fallback
}

function normalizeSnapshot(row) {
  if (!row) return null
  return {
    ticker: row.ticker,
    data: row.data,
    rawJson: row.raw_json,
    moduleStatus: row.module_status,
    sourceMetadata: row.source_metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceTable: 'yahoo_finance_snapshots',
    source: 'yahoo-finance',
  }
}

router.get('/modules', (_request, response) => {
  response.json({
    source: 'yahoo-finance',
    units: listModuleCatalogue(),
    quoteSummaryModules: FETCH_UNITS.flatMap((unit) => unit.quoteSummary || unit.rawQuoteSummary || []),
  })
})

// Must be registered before /:ticker routes so "search" is not treated as a ticker.
// Returns saved snapshots when present, plus live Yahoo Finance quote matches
// so the search bar always shows suggestions while typing (not only for saved tickers).
router.get('/search', async (request, response) => {
  try {
    const q = String(request.query.q || '').trim()
    const supabase = getSupabase()

    let saved = []
    try {
      let query = supabase
        .from('yahoo_finance_snapshots')
        .select('ticker, data, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(200)
      if (q) query = query.ilike('ticker', `%${q}%`)
      const { data, error } = await query
      // Table may not exist yet if schema_yahoo_finance.sql hasn't been applied.
      if (!error) {
        saved = (data || []).map((row) => ({
          ticker: row.ticker,
          label: row.ticker,
          companyName: row.data?.companyName || null,
          savedAt: row.updated_at || row.created_at,
          exchange: null,
          quoteType: null,
          source: 'yahoo-finance',
        }))
      }
    } catch {
      saved = []
    }

    const savedSet = new Set(saved.map((item) => String(item.ticker || '').toUpperCase()))
    let live = []

    if (q.length >= 1) {
      try {
        const result = await yahooFinance.search(
          q,
          { quotesCount: 12, newsCount: 0 },
          { validateResult: false },
        )
        const quotes = Array.isArray(result?.quotes) ? result.quotes : []
        live = quotes
          .filter((quote) => quote?.symbol && !savedSet.has(String(quote.symbol).toUpperCase()))
          // Prefer equities/ETFs/funds over options chains in the typeahead.
          .filter((quote) => {
            const type = String(quote.quoteType || quote.typeDisp || '').toUpperCase()
            return !type.includes('OPTION')
          })
          .slice(0, 12)
          .map((quote) => ({
            ticker: String(quote.symbol).toUpperCase(),
            label: String(quote.symbol).toUpperCase(),
            companyName: quote.longname || quote.shortname || null,
            savedAt: null,
            exchange: quote.exchDisp || quote.exchange || null,
            quoteType: quote.typeDisp || quote.quoteType || null,
            source: 'yahoo-finance',
          }))
      } catch {
        // Live Yahoo search failed — still return any saved matches.
      }
    }

    response.json({
      source: 'yahoo-finance',
      tickers: [...saved, ...live],
    })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Yahoo Finance search failed') })
  }
})

// Interactive chart timeframes — separate from the bulk module fetch so the
// UI can switch 1D/5D/1M/… without re-running every Yahoo module.
//
// Bar size (interval) is Yahoo-style:
//   1D  → 1m (per minute)   | 5D → 15m | 1M → 1h | longer → 1d / 1wk / 1mo
// Yahoo limits: 1m only ~last 7 days; intraday (<1d) only ~last 60 days.
const CHART_RANGES = {
  // Look back a few calendar days so weekends/holidays still return the last
  // regular session; the UI filters 1D down to the latest trading day.
  '1d': { days: 5, interval: '1m', allowed: ['1m', '2m', '5m'] },
  '5d': { days: 7, interval: '15m', allowed: ['5m', '15m', '30m', '60m', '1h'] },
  '1mo': { days: 31, interval: '1h', allowed: ['15m', '30m', '60m', '1h', '1d'] },
  '3mo': { days: 93, interval: '1d', allowed: ['1h', '1d'] },
  '6mo': { days: 186, interval: '1d', allowed: ['1d', '1wk'] },
  ytd: { ytd: true, interval: '1d', allowed: ['1d', '1wk'] },
  '1y': { days: 365, interval: '1d', allowed: ['1d', '1wk'] },
  '5y': { days: 365 * 5, interval: '1wk', allowed: ['1d', '1wk', '1mo'] },
  max: { years: 30, interval: '1mo', allowed: ['1wk', '1mo'] },
}

const ALL_CHART_INTERVALS = new Set([
  '1m',
  '2m',
  '5m',
  '15m',
  '30m',
  '60m',
  '90m',
  '1h',
  '1d',
  '5d',
  '1wk',
  '1mo',
  '3mo',
])

// Lightweight live quote (unofficial yahoo-finance2) for ticker chips in the news UI.
router.get('/:ticker/quote', async (request, response) => {
  try {
    const ticker = request.params.ticker.toUpperCase()
    const symbol = toYahooSymbol(ticker)
    const raw = await yahooFinance.quote(symbol, {}, { validateResult: false })
    const q = raw && typeof raw === 'object' ? raw : {}
    const logoSymbol = String(q.symbol || symbol).toUpperCase().replace(/[^A-Z0-9.-]/g, '')

    // Yahoo quote has no logo field — resolve company website for a favicon, else public symbol logos.
    let website = null
    try {
      const summary = await yahooFinance.quoteSummary(
        symbol,
        { modules: ['assetProfile', 'summaryProfile'] },
        { validateResult: false },
      )
      website =
        summary?.assetProfile?.website ||
        summary?.summaryProfile?.website ||
        null
    } catch {
      website = null
    }

    let logoUrl = null
    if (website) {
      try {
        const host = new URL(website).hostname.replace(/^www\./, '')
        if (host) logoUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`
      } catch {
        logoUrl = null
      }
    }
    if (!logoUrl && logoSymbol) {
      // Public IEX logo CDN (PNG) — works for most US equities without auth.
      logoUrl = `https://storage.googleapis.com/iex/api/logos/${logoSymbol}.png`
    }

    response.json({
      ticker,
      symbol,
      source: 'yahoo-finance',
      quote: {
        symbol: q.symbol || symbol,
        shortName: q.shortName || q.longName || null,
        regularMarketPrice: q.regularMarketPrice ?? null,
        regularMarketChange: q.regularMarketChange ?? null,
        regularMarketChangePercent: q.regularMarketChangePercent ?? null,
        regularMarketPreviousClose: q.regularMarketPreviousClose ?? null,
        currency: q.currency || null,
        marketState: q.marketState || null,
        exchange: q.fullExchangeName || q.exchange || null,
        website,
        logoUrl,
      },
    })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to fetch Yahoo Finance quote') })
  }
})

router.get('/:ticker/chart', async (request, response) => {
  try {
    const ticker = request.params.ticker.toUpperCase()
    const symbol = toYahooSymbol(ticker)
    const rangeKey = String(request.query.range || '1y').toLowerCase()
    const config = CHART_RANGES[rangeKey] || CHART_RANGES['1y']
    const resolvedRange = rangeKey in CHART_RANGES ? rangeKey : '1y'

    // Optional interval override (must be Yahoo-valid and sensible for the range).
    const requestedInterval = String(request.query.interval || '').toLowerCase()
    let interval = config.interval
    if (requestedInterval && ALL_CHART_INTERVALS.has(requestedInterval)) {
      if (!config.allowed || config.allowed.includes(requestedInterval)) {
        interval = requestedInterval
      }
    }

    // 1m bars: Yahoo only returns ~7 days per request — clamp lookback.
    let lookbackDays = config.days
    if (interval === '1m' && lookbackDays != null && lookbackDays > 7) {
      lookbackDays = 7
    }
    // Intraday bars (< 1d): typically only available for ~60 calendar days.
    const isIntraday = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'].includes(interval)
    if (isIntraday && lookbackDays != null && lookbackDays > 60) {
      lookbackDays = 60
    }

    const period2 = new Date()
    let period1
    if (config.ytd && !isIntraday) {
      period1 = new Date(period2.getFullYear(), 0, 1)
    } else if (config.years && !isIntraday) {
      period1 = new Date(period2)
      period1.setFullYear(period1.getFullYear() - config.years)
    } else if (lookbackDays != null) {
      period1 = new Date(period2.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
    } else if (config.years) {
      period1 = new Date(period2)
      period1.setFullYear(period1.getFullYear() - config.years)
    } else {
      period1 = new Date(period2.getTime() - 365 * 24 * 60 * 60 * 1000)
    }

    const chart = await yahooFinance.chart(
      symbol,
      {
        period1,
        period2,
        interval,
        events: 'div|split|earn',
      },
      { validateResult: false },
    )

    response.json({
      ticker,
      symbol,
      range: resolvedRange,
      interval,
      allowedIntervals: config.allowed || [config.interval],
      chart: toPlainJson(chart),
      source: 'yahoo-finance',
    })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to fetch Yahoo Finance chart') })
  }
})

// Module-by-module fetch — one unit at a time for UI progress.
router.get('/:ticker/unit/:unitId', async (request, response) => {
  try {
    const ticker = request.params.ticker.toUpperCase()
    const result = await fetchUnit(ticker, request.params.unitId)
    response.json({
      ticker,
      symbol: toYahooSymbol(ticker),
      source: 'yahoo-finance',
      unit: toPlainJson(result),
    })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to fetch Yahoo Finance module') })
  }
})

// Full fetch of every supported module. Never fails the whole ticker because
// of one bad module — per-module status is returned instead.
router.get('/:ticker/full', async (request, response) => {
  try {
    const ticker = request.params.ticker.toUpperCase()
    const bundle = await fetchAllYahooModules(ticker)
    response.json(bundle)
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to fetch Yahoo Finance data') })
  }
})

// SSE stream: emits one event per unit so the UI can show module progress.
router.get('/:ticker/stream', async (request, response) => {
  const ticker = request.params.ticker.toUpperCase()
  response.setHeader('Content-Type', 'text/event-stream')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.flushHeaders?.()

  const send = (event, payload) => {
    response.write(`event: ${event}\n`)
    response.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  try {
    send('start', {
      ticker,
      symbol: toYahooSymbol(ticker),
      units: listModuleCatalogue(),
      source: 'yahoo-finance',
    })

    const bundle = await fetchAllYahooModules(ticker, {
      onUnit: (unitResult) => {
        send('unit', {
          unitId: unitResult.unitId,
          label: unitResult.label,
          group: unitResult.group,
          status: unitResult.status,
          error: unitResult.error,
          moduleStatus: unitResult.moduleStatus,
          // Include raw so the client can assemble the full payload live.
          raw: toPlainJson(unitResult.raw || {}),
        })
      },
    })

    send('complete', bundle)
    response.write('event: done\ndata: {}\n\n')
    response.end()
  } catch (error) {
    send('error', { error: errorMessage(error, 'Failed to stream Yahoo Finance data') })
    response.end()
  }
})

router.get('/:ticker/saved', async (request, response) => {
  try {
    const ticker = request.params.ticker.toUpperCase()
    const supabase = getSupabase()
    const { data, error } = await supabase.from('yahoo_finance_snapshots').select('*').eq('ticker', ticker).maybeSingle()
    if (error) throw error
    if (!data) {
      response.status(404).json({ error: 'No saved Yahoo Finance snapshot for this ticker' })
      return
    }
    response.json(normalizeSnapshot(data))
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to load saved Yahoo Finance snapshot') })
  }
})

// Upsert into yahoo_finance_snapshots only — never touches ticker_dashboard_snapshots.
router.post('/:ticker/save', async (request, response) => {
  try {
    const ticker = request.params.ticker.toUpperCase()
    const body = request.body || {}
    const data = body.data && typeof body.data === 'object' ? body.data : {}
    const rawJson = body.rawJson && typeof body.rawJson === 'object' ? body.rawJson : body.raw_json && typeof body.raw_json === 'object' ? body.raw_json : {}
    const moduleStatus =
      body.moduleStatus && typeof body.moduleStatus === 'object'
        ? body.moduleStatus
        : body.module_status && typeof body.module_status === 'object'
          ? body.module_status
          : {}
    const sourceMetadata =
      body.sourceMetadata && typeof body.sourceMetadata === 'object'
        ? body.sourceMetadata
        : body.source_metadata && typeof body.source_metadata === 'object'
          ? body.source_metadata
          : { source: 'yahoo-finance', fetchedAt: new Date().toISOString() }

    const supabase = getSupabase()
    const row = {
      ticker,
      data,
      raw_json: rawJson,
      module_status: moduleStatus,
      source_metadata: { ...sourceMetadata, source: 'yahoo-finance' },
      updated_at: new Date().toISOString(),
    }

    const { data: saved, error } = await supabase
      .from('yahoo_finance_snapshots')
      .upsert(row, { onConflict: 'ticker' })
      .select()
      .single()

    if (error) throw error
    response.json({ ok: true, snapshot: normalizeSnapshot(saved) })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to save Yahoo Finance snapshot') })
  }
})

// Live-fetch every module then upsert — used by "Refresh from Yahoo Finance".
router.post('/:ticker/refresh', async (request, response) => {
  try {
    const ticker = request.params.ticker.toUpperCase()
    const bundle = await fetchAllYahooModules(ticker)
    const supabase = getSupabase()
    const row = {
      ticker,
      data: bundle.data,
      raw_json: bundle.raw_json,
      module_status: bundle.module_status,
      source_metadata: {
        source: 'yahoo-finance',
        fetchedAt: bundle.fetchedAt,
        units: bundle.units,
      },
      updated_at: new Date().toISOString(),
    }
    const { data: saved, error } = await supabase
      .from('yahoo_finance_snapshots')
      .upsert(row, { onConflict: 'ticker' })
      .select()
      .single()
    if (error) throw error
    response.json({ ok: true, bundle, snapshot: normalizeSnapshot(saved) })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to refresh Yahoo Finance snapshot') })
  }
})

export default router
