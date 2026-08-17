// Yahoo Finance ticker routes — completely independent of /api/edgar.
// Snapshots land in yahoo_finance_snapshots and never touch SEC tables.

import express from 'express'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'
import { FETCH_UNITS, fetchAllYahooModules, fetchUnit, listModuleCatalogue, toPlainJson } from './modules.js'
import { toYahooSymbol } from '../yahooClient.js'
import { getYahooLiveQuotes } from './liveQuotes.js'

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
})

const router = express.Router()

function marketTimeToIso(value) {
  if (value == null) return null
  const date = value instanceof Date
    ? value
    : typeof value === 'number'
      ? new Date(value < 1_000_000_000_000 ? value * 1000 : value)
      : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Yahoo quote.marketState (no overnightMarket* fields exist).
 *
 *   PREPRE  → Overnight: postMarket* hold overnight session
 *             (e.g. Blue Ocean ATS ~8pm–4am ET Sun–Thu)
 *   PRE     → Pre-market: preMarket*
 *   REGULAR → Open: regularMarket*
 *   POST    → After-hours: postMarket*
 *   POSTPOST→ After-hours ended: postMarket* last AH print
 *   CLOSED  → Closed / At close: regularMarket* primary
 *             (postMarket* may still hold residual extended print)
 *
 * Pass marketState through as-is — do not invent sessions from the ET clock.
 */
const YAHOO_MARKET_STATES = new Set([
  'PRE',
  'PREPRE',
  'REGULAR',
  'POST',
  'POSTPOST',
  'CLOSED',
])

/** Yahoo pricing WS marketHours enum → PRE / REGULAR / POST (no PREPRE). */
function streamMarketState(marketHours) {
  if (marketHours === 0) return 'PRE'
  if (marketHours === 1) return 'REGULAR'
  if (marketHours === 2 || marketHours === 3) return 'POST'
  return null
}

/**
 * Prefer Yahoo REST marketState exactly. Streamer only fills gaps when REST
 * has no state (streamer has no PREPRE / POSTPOST).
 */
function resolveQuoteMarketState(streamed, restMarketState) {
  const rest = String(restMarketState || '')
    .trim()
    .toUpperCase()
  if (YAHOO_MARKET_STATES.has(rest)) return rest
  if (rest === 'OPEN') return 'REGULAR'
  if (rest === 'CLOSE') return 'CLOSED'
  return streamMarketState(streamed?.marketHours) || 'CLOSED'
}

/**
 * Which Yahoo price group to update / display for marketState.
 * PREPRE and POST/POSTPOST both use postMarket* (overnight vs after-hours
 * is distinguished only by marketState, not by field name).
 */
function priceBucketForMarketState(marketState) {
  const s = String(marketState || '').toUpperCase()
  if (s === 'PRE') return 'pre'
  if (s === 'PREPRE' || s === 'POST' || s === 'POSTPOST') return 'post'
  if (s === 'REGULAR') return 'regular'
  return 'regular' // CLOSED → At close
}

/** Prefer finite number from REST, else stream-derived. */
function numOrNull(...vals) {
  for (const v of vals) {
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY to .env.local')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function errorMessage(error, fallback) {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error instanceof Error) {
    // Supabase / PostgREST errors often put useful detail on extra fields.
    const extra = [error.details, error.hint, error.code].filter(Boolean).join(' · ')
    return extra ? `${error.message} (${extra})` : error.message
  }
  if (typeof error === 'object') {
    const message = typeof error.message === 'string' ? error.message : fallback
    const extra = [error.details, error.hint, error.code].filter(Boolean).join(' · ')
    return extra ? `${message} (${extra})` : message
  }
  return fallback
}

function normalizeSnapshot(row) {
  if (!row) return null
  return {
    ticker: row.ticker,
    data: row.data ?? {},
    rawJson: row.raw_json ?? {},
    moduleStatus: row.module_status ?? {},
    sourceMetadata: row.source_metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceTable: 'yahoo_finance_snapshots',
    source: 'yahoo-finance',
  }
}

/**
 * Yahoo full modules are ~1.5–2MB (chart alone ~500KB, duplicated in data + raw).
 * Upserting that + GIN on jsonb hits Supabase statement_timeout (~5s, code 57014).
 * Slim before write: drop re-fetchable series, cap huge arrays.
 */
function capList(value, max) {
  if (!Array.isArray(value)) return value
  if (value.length <= max) return value
  return value.slice(0, max)
}

function slimChart(chart) {
  if (!chart || typeof chart !== 'object') return chart
  const meta = chart.meta ?? chart.chart?.result?.[0]?.meta ?? null
  return {
    omitted: true,
    meta,
    note: 'OHLCV series omitted from Supabase snapshot — load live via /api/yahoo/:ticker/chart',
  }
}

function slimHeavyObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const out = { ...input }

  if ('chart' in out) out.chart = slimChart(out.chart)

  // Common Yahoo module shapes with long histories.
  if (out.upgradeDowngradeHistory && typeof out.upgradeDowngradeHistory === 'object') {
    const hist = out.upgradeDowngradeHistory
    out.upgradeDowngradeHistory = {
      ...hist,
      history: capList(hist.history, 80),
    }
  }
  if (Array.isArray(out.history)) out.history = capList(out.history, 80)

  if (out.options && typeof out.options === 'object') {
    const opt = out.options
    out.options = {
      ...opt,
      calls: capList(opt.calls, 40),
      puts: capList(opt.puts, 40),
      expirationDates: capList(opt.expirationDates, 12),
      options: Array.isArray(opt.options)
        ? opt.options.slice(0, 2).map((chain) => ({
            ...chain,
            calls: capList(chain?.calls, 40),
            puts: capList(chain?.puts, 40),
          }))
        : opt.options,
    }
  }

  if (out.insights && typeof out.insights === 'object') {
    const insights = out.insights
    out.insights = {
      ...insights,
      // Keep summary fields; drop bulky report blobs when present.
      reports: capList(insights.reports, 5),
      sigDevs: capList(insights.sigDevs, 15),
    }
  }

  if (out.secFilings && typeof out.secFilings === 'object') {
    const filings = out.secFilings
    out.secFilings = {
      ...filings,
      filings: capList(filings.filings, 40),
      raw: undefined,
    }
  }
  if (Array.isArray(out.filings)) out.filings = capList(out.filings, 40)

  if (out.insiderTransactions && typeof out.insiderTransactions === 'object') {
    const insider = out.insiderTransactions
    out.insiderTransactions = {
      ...insider,
      transactions: capList(insider.transactions, 60),
    }
  }
  if (out.insider && typeof out.insider === 'object') {
    out.insider = {
      ...out.insider,
      transactions: capList(out.insider.transactions, 60),
      holders: capList(out.insider.holders, 40),
    }
  }

  if (out.statements && typeof out.statements === 'object') {
    // Keep statements but they are already moderate; no-op unless arrays explode.
    for (const key of Object.keys(out.statements)) {
      if (Array.isArray(out.statements[key])) {
        out.statements[key] = capList(out.statements[key], 40)
      }
    }
  }

  return out
}

function prepareSnapshotRow(ticker, body) {
  const plainData = toPlainJson(body.data && typeof body.data === 'object' ? body.data : {}) || {}
  const plainRaw =
    toPlainJson(
      body.rawJson && typeof body.rawJson === 'object'
        ? body.rawJson
        : body.raw_json && typeof body.raw_json === 'object'
          ? body.raw_json
          : {},
    ) || {}
  const moduleStatus =
    toPlainJson(
      body.moduleStatus && typeof body.moduleStatus === 'object'
        ? body.moduleStatus
        : body.module_status && typeof body.module_status === 'object'
          ? body.module_status
          : {},
    ) || {}
  const sourceMetadata =
    toPlainJson(
      body.sourceMetadata && typeof body.sourceMetadata === 'object'
        ? body.sourceMetadata
        : body.source_metadata && typeof body.source_metadata === 'object'
          ? body.source_metadata
          : { source: 'yahoo-finance', fetchedAt: new Date().toISOString() },
    ) || { source: 'yahoo-finance', fetchedAt: new Date().toISOString() }

  const data = slimHeavyObject(plainData)
  const rawJson = slimHeavyObject(plainRaw)

  return {
    ticker,
    data,
    raw_json: rawJson,
    module_status: moduleStatus,
    source_metadata: {
      ...sourceMetadata,
      source: 'yahoo-finance',
      slimmedForSave: true,
      chartOmitted: true,
    },
    updated_at: new Date().toISOString(),
  }
}

// After upsert, only return lightweight columns (returning 2MB jsonb doubles work / timeout risk).
const SNAPSHOT_SELECT_LIGHT = 'ticker, module_status, source_metadata, created_at, updated_at'

router.get('/modules', (_request, response) => {
  response.json({
    source: 'yahoo-finance',
    units: listModuleCatalogue(),
    quoteSummaryModules: FETCH_UNITS.flatMap((unit) => unit.quoteSummary || unit.rawQuoteSummary || []),
  })
})

// Must be registered before /:ticker routes so path segments are not treated as tickers.
// Batch check which tickers exist in yahoo_finance_snapshots (avoids N×404 console noise).
router.get('/saved-status', async (request, response) => {
  try {
    const tickers = String(request.query.tickers || '')
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 80)

    if (!tickers.length) {
      response.json({ saved: {} })
      return
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('yahoo_finance_snapshots')
      .select('ticker')
      .in('ticker', tickers)

    if (error) throw error

    const found = new Set((data || []).map((row) => String(row.ticker || '').toUpperCase()))
    const saved = Object.fromEntries(tickers.map((ticker) => [ticker, found.has(ticker)]))
    response.json({ saved })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to check saved Yahoo Finance tickers') })
  }
})

/**
 * Yahoo predefined screener (Day Gainers / Day Losers).
 * Uses Yahoo HTTP directly — yahoo-finance2 schema validation rejects
 * day_gainers payloads even with validateResult:false.
 */
function yahooScreenerNumeric(value) {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'object' && value.raw != null) {
    const n = Number(value.raw)
    return Number.isFinite(n) ? n : null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const YAHOO_SCREENER_HEADERS = {
  Accept: 'application/json,text/plain,*/*',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchYahooPredefinedScreener(scrIds, count = 100) {
  const params = new URLSearchParams({
    scrIds: String(scrIds),
    count: String(count),
    start: '0',
    lang: 'en-US',
    region: 'US',
    formatted: 'false',
  })
  // query2 first; query1 often 429s under load.
  const hosts = [
    'https://query2.finance.yahoo.com',
    'https://query1.finance.yahoo.com',
  ]
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const host of hosts) {
      try {
        const response = await fetch(
          `${host}/v1/finance/screener/predefined/saved?${params}`,
          { headers: YAHOO_SCREENER_HEADERS },
        )
        if (response.status === 429) {
          lastError = new Error(`Yahoo screener ${scrIds} rate-limited (429)`)
          await sleepMs(400 + attempt * 600)
          continue
        }
        if (!response.ok) {
          lastError = new Error(`Yahoo screener ${scrIds} failed (${response.status})`)
          continue
        }
        const body = await response.json()
        if (body?.finance?.error) {
          lastError = new Error(
            body.finance.error.description ||
              body.finance.error.code ||
              `Yahoo screener ${scrIds} error`,
          )
          continue
        }
        const quotes = body?.finance?.result?.[0]?.quotes
        if (Array.isArray(quotes) && quotes.length) return quotes
        lastError = new Error(`Yahoo screener ${scrIds} returned 0 quotes`)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }
    await sleepMs(350 * (attempt + 1))
  }
  throw lastError || new Error(`Yahoo screener ${scrIds} failed`)
}

/**
 * Fallback when predefined day_gainers is rate-limited:
 * custom equity screener sorted by percentchange (gainers or losers).
 */
async function fetchYahooPercentChangeScreener({
  direction = 'up',
  minPercent = 10,
  count = 100,
} = {}) {
  const size = Math.min(250, Math.max(5, count))
  const sortType = direction === 'down' ? 'ASC' : 'DESC'
  const op = direction === 'down' ? 'lt' : 'gt'
  const threshold = direction === 'down' ? -Math.abs(minPercent) : Math.abs(minPercent)
  const payload = {
    size,
    offset: 0,
    sortField: 'percentchange',
    sortType,
    quoteType: 'EQUITY',
    query: {
      operator: 'AND',
      operands: [
        { operator: op, operands: ['percentchange', threshold] },
        { operator: 'eq', operands: ['region', 'us'] },
      ],
    },
  }
  const hosts = [
    'https://query2.finance.yahoo.com',
    'https://query1.finance.yahoo.com',
  ]
  let lastError = null
  for (const host of hosts) {
    try {
      const response = await fetch(`${host}/v1/finance/screener?lang=en-US&region=US`, {
        method: 'POST',
        headers: {
          ...YAHOO_SCREENER_HEADERS,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        lastError = new Error(`Yahoo custom screener failed (${response.status})`)
        continue
      }
      const body = await response.json()
      const quotes = body?.finance?.result?.[0]?.quotes
      if (Array.isArray(quotes) && quotes.length) return quotes
      lastError = new Error('Yahoo custom screener returned 0 quotes')
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError || new Error('Yahoo custom screener failed')
}

/**
 * Extreme daily movers = Yahoo Day Gainers + Day Losers, abs % ≥ minPercent.
 * Positive tab ← gainers · Negative tab ← losers (client splits by sign).
 *
 * Query:
 *   minPercent   — abs regularMarketChangePercent floor (default 10)
 *   minMarketCap — optional USD floor (default 0 = show full Yahoo top lists)
 *   count        — per screener (default 100, max 250)
 */
router.get('/extreme-movers', async (request, response) => {
  try {
    const minPercent = Math.max(
      0,
      Number.parseFloat(String(request.query.minPercent ?? '10')) || 10,
    )
    // Default 0: user wants real Yahoo top gainers/losers ≥10%, not only mega-caps.
    const minMarketCapRaw = request.query.minMarketCap
    const minMarketCap =
      minMarketCapRaw == null || minMarketCapRaw === ''
        ? 0
        : Math.max(0, Number.parseFloat(String(minMarketCapRaw)) || 0)
    const count = Math.min(
      250,
      Math.max(5, Number.parseInt(String(request.query.count ?? '100'), 10) || 100),
    )

    const fetchScreener = async (scrIds, direction) => {
      // 1) yahoo-finance2 first (handles cookies/crumb). day_gainers often
      //    throws FailedYahooValidationError but still attaches full result.quotes.
      try {
        const result = await yahooFinance.screener(
          { scrIds, count },
          { validateResult: false },
        )
        if (Array.isArray(result?.quotes) && result.quotes.length) return result.quotes
      } catch (error) {
        const recovered = error?.result?.quotes
        if (Array.isArray(recovered) && recovered.length) {
          console.warn(
            `[yahoo] package ${scrIds}: schema warn, recovered ${recovered.length} quotes`,
          )
          return recovered
        }
        console.warn(
          `[yahoo] package ${scrIds} failed:`,
          errorMessage(error, 'screener failed'),
        )
      }

      // 2) Raw predefined Day Gainers / Day Losers HTTP
      try {
        return await fetchYahooPredefinedScreener(scrIds, count)
      } catch (error) {
        console.warn(
          `[yahoo] predefined ${scrIds} failed:`,
          errorMessage(error, 'screener failed'),
        )
      }

      // 3) Custom percent-change screener (needs crumb; may 401)
      try {
        return await fetchYahooPercentChangeScreener({
          direction,
          minPercent,
          count,
        })
      } catch (error) {
        console.warn(
          `[yahoo] custom ${direction} screener failed:`,
          errorMessage(error, 'screener failed'),
        )
        return []
      }
    }

    // Sequential — parallel Yahoo calls often 429 one of the two lists.
    const gainers = await fetchScreener('day_gainers', 'up')
    await sleepMs(200)
    const losers = await fetchScreener('day_losers', 'down')

    const bySymbol = new Map()
    const ingest = (quotes, expectedDirection) => {
      for (const quote of quotes) {
        const symbol = String(quote?.symbol || '')
          .trim()
          .toUpperCase()
        if (!symbol) continue
        const quoteType = String(quote?.quoteType || '').toUpperCase()
        // Equities + ETFs from Yahoo top lists; skip options/crypto.
        if (
          quoteType &&
          quoteType !== 'EQUITY' &&
          quoteType !== 'ETF' &&
          quoteType !== 'MUTUALFUND'
        ) {
          continue
        }
        const exchange = String(
          quote?.fullExchangeName || quote?.exchange || quote?.market || '',
        ).toLowerCase()
        if (exchange.includes('otc') || exchange.includes('pink')) continue

        const percent = yahooScreenerNumeric(quote?.regularMarketChangePercent)
        const marketCap = yahooScreenerNumeric(quote?.marketCap)
        const price = yahooScreenerNumeric(quote?.regularMarketPrice)
        const change = yahooScreenerNumeric(quote?.regularMarketChange)
        if (!Number.isFinite(percent) || Math.abs(percent) < minPercent) continue
        if (minMarketCap > 0 && Number.isFinite(marketCap) && marketCap > 0 && marketCap < minMarketCap) {
          continue
        }
        // Direction guard so gainers list never pollutes Negative tab.
        if (expectedDirection === 'up' && percent <= 0) continue
        if (expectedDirection === 'down' && percent >= 0) continue

        const prev = bySymbol.get(symbol)
        if (prev && Math.abs(prev.regularMarketChangePercent) >= Math.abs(percent)) continue

        bySymbol.set(symbol, {
          ticker: symbol,
          symbol,
          company_name:
            String(quote?.shortName || quote?.longName || symbol).trim() || symbol,
          long_name: quote?.longName ? String(quote.longName) : null,
          regularMarketPrice: price,
          regularMarketChange: change,
          regularMarketChangePercent: percent,
          marketCap: Number.isFinite(marketCap) && marketCap > 0 ? marketCap : null,
          currency: quote?.currency || 'USD',
          exchange: quote?.fullExchangeName || quote?.exchange || null,
          marketState: quote?.marketState || null,
          quoteType: quoteType || 'EQUITY',
          direction: percent < 0 ? 'down' : percent > 0 ? 'up' : 'flat',
          screener: expectedDirection === 'up' ? 'day_gainers' : 'day_losers',
        })
      }
    }

    ingest(gainers, 'up')
    ingest(losers, 'down')

    const movers = [...bySymbol.values()].sort(
      (a, b) =>
        Math.abs(b.regularMarketChangePercent) - Math.abs(a.regularMarketChangePercent) ||
        a.ticker.localeCompare(b.ticker),
    )
    const positive = movers.filter((m) => m.regularMarketChangePercent > 0)
    const negative = movers.filter((m) => m.regularMarketChangePercent < 0)

    response.setHeader('Cache-Control', 'public, max-age=45')
    response.json({
      ok: true,
      source: 'yahoo-finance',
      screener: ['day_gainers', 'day_losers'],
      minPercent,
      minMarketCap,
      gainerCount: gainers.length,
      loserCount: losers.length,
      positiveCount: positive.length,
      negativeCount: negative.length,
      fetchedAt: new Date().toISOString(),
      count: movers.length,
      movers,
    })
  } catch (error) {
    response.status(500).json({
      error: errorMessage(error, 'Failed to fetch Yahoo extreme movers'),
    })
  }
})

const MOST_ACTIVE_UNIVERSES = {
  equity: [
    ['AAPL', 'Apple'],
    ['MSFT', 'Microsoft'],
    ['NVDA', 'NVIDIA'],
    ['TSLA', 'Tesla'],
    ['AMZN', 'Amazon'],
    ['META', 'Meta'],
    ['GOOGL', 'Alphabet'],
    ['AMD', 'AMD'],
    ['INTC', 'Intel'],
    ['BAC', 'Bank of America'],
    ['F', 'Ford'],
    ['PLTR', 'Palantir'],
    ['SOFI', 'SoFi'],
    ['NIO', 'NIO'],
    ['SNAP', 'Snap'],
    ['AAL', 'American Airlines'],
    ['CCL', 'Carnival'],
    ['NU', 'Nu Holdings'],
    ['PFE', 'Pfizer'],
    ['T', 'AT&T'],
    ['WBD', 'Warner Bros'],
    ['KVUE', 'Kenvue'],
    ['SMCI', 'Super Micro'],
    ['COIN', 'Coinbase'],
  ],
  index: [
    ['^GSPC', 'S&P 500'],
    ['^DJI', 'Dow Jones'],
    ['^IXIC', 'Nasdaq'],
    ['^RUT', 'Russell 2000'],
    ['^VIX', 'VIX'],
    ['^FTSE', 'FTSE 100'],
    ['^GDAXI', 'DAX'],
    ['^FCHI', 'CAC 40'],
    ['^STOXX50E', 'Euro Stoxx 50'],
    ['^N225', 'Nikkei 225'],
    ['^HSI', 'Hang Seng'],
    ['^AXJO', 'ASX 200'],
    ['^BVSP', 'Bovespa'],
    ['^KS11', 'KOSPI'],
    ['^TWII', 'Taiwan'],
    ['^GSPTSE', 'TSX'],
    ['^SSMI', 'SMI'],
    ['^BSESN', 'Sensex'],
  ],
  forex: [
    ['EURUSD=X', 'EUR/USD'],
    ['JPY=X', 'USD/JPY'],
    ['GBPUSD=X', 'GBP/USD'],
    ['AUDUSD=X', 'AUD/USD'],
    ['NZDUSD=X', 'NZD/USD'],
    ['EURJPY=X', 'EUR/JPY'],
    ['GBPJPY=X', 'GBP/JPY'],
    ['EURGBP=X', 'EUR/GBP'],
    ['EURCAD=X', 'EUR/CAD'],
    ['EURSEK=X', 'EUR/SEK'],
    ['EURCHF=X', 'EUR/CHF'],
    ['EURHUF=X', 'EUR/HUF'],
    ['EURCNY=X', 'EUR/CNY'],
    ['USDCNY=X', 'USD/CNY'],
    ['USDHKD=X', 'USD/HKD'],
    ['USDSGD=X', 'USD/SGD'],
    ['USDINR=X', 'USD/INR'],
    ['USDMXN=X', 'USD/MXN'],
    ['USDPHP=X', 'USD/PHP'],
    ['USDIDR=X', 'USD/IDR'],
    ['USDTHB=X', 'USD/THB'],
    ['USDMYR=X', 'USD/MYR'],
    ['USDZAR=X', 'USD/ZAR'],
    ['USDRUB=X', 'USD/RUB'],
  ],
  commodity: [
    ['ES=F', 'S&P 500 Fut'],
    ['YM=F', 'Dow Fut'],
    ['NQ=F', 'Nasdaq Fut'],
    ['RTY=F', 'Russell Fut'],
    ['ZB=F', 'US Bond Fut'],
    ['ZN=F', '10Y Note'],
    ['ZF=F', '5Y Note'],
    ['ZT=F', '2Y Note'],
    ['GC=F', 'Gold'],
    ['SI=F', 'Silver'],
    ['PL=F', 'Platinum'],
    ['HG=F', 'Copper'],
    ['PA=F', 'Palladium'],
    ['CL=F', 'Crude Oil'],
    ['BZ=F', 'Brent'],
    ['HO=F', 'Heating Oil'],
    ['NG=F', 'Natural Gas'],
    ['RB=F', 'RBOB Gasoline'],
    ['ZC=F', 'Corn'],
    ['ZW=F', 'Wheat'],
    ['KE=F', 'KC Wheat'],
    ['ZS=F', 'Soybeans'],
    ['ZM=F', 'Soy Meal'],
    ['ZL=F', 'Soy Oil'],
    ['KC=F', 'Coffee'],
    ['CT=F', 'Cotton'],
    ['SB=F', 'Sugar'],
    ['CC=F', 'Cocoa'],
    ['LE=F', 'Live Cattle'],
    ['HE=F', 'Lean Hogs'],
    ['GF=F', 'Feeder Cattle'],
  ],
  crypto: [
    ['BTC-USD', 'Bitcoin'],
    ['ETH-USD', 'Ethereum'],
    ['SOL-USD', 'Solana'],
    ['XRP-USD', 'XRP'],
    ['DOGE-USD', 'Dogecoin'],
    ['ADA-USD', 'Cardano'],
    ['AVAX-USD', 'Avalanche'],
    ['LINK-USD', 'Chainlink'],
    ['DOT-USD', 'Polkadot'],
    ['LTC-USD', 'Litecoin'],
    ['BCH-USD', 'Bitcoin Cash'],
    ['SHIB-USD', 'Shiba Inu'],
    ['NEAR-USD', 'NEAR'],
    ['UNI-USD', 'Uniswap'],
    ['ATOM-USD', 'Cosmos'],
  ],
}

const mostActivesCache = new Map()

function mostActiveAssetClass(raw) {
  const c = String(raw || 'equity').trim().toLowerCase()
  if (c === 'index' || c === 'indices' || c === 'indexes') return 'index'
  if (c === 'forex' || c === 'fx' || c === 'currency') return 'forex'
  if (c === 'crypto' || c === 'cryptocurrency') return 'crypto'
  if (c === 'commodity' || c === 'commodities' || c === 'future') return 'commodity'
  return 'equity'
}

function mapMostActiveRow(quote, assetClass, fallbackTicker, fallbackLabel) {
  const symbol = String(quote?.symbol || fallbackTicker || '')
    .trim()
    .toUpperCase()
  if (!symbol) return null
  const volume =
    yahooScreenerNumeric(quote?.regularMarketVolume) ??
    yahooScreenerNumeric(quote?.averageDailyVolume3Month) ??
    0
  const percent = yahooScreenerNumeric(quote?.regularMarketChangePercent)
  const price = yahooScreenerNumeric(quote?.regularMarketPrice)
  const change = yahooScreenerNumeric(quote?.regularMarketChange)
  return {
    ticker: symbol,
    symbol,
    label:
      String(quote?.shortName || quote?.longName || fallbackLabel || symbol).trim() ||
      symbol,
    longName: quote?.longName ? String(quote.longName) : null,
    assetClass,
    volume: Number.isFinite(volume) ? volume : 0,
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: Number.isFinite(percent) ? percent : null,
    currency: quote?.currency || null,
    exchange: quote?.fullExchangeName || quote?.exchange || null,
    marketState: quote?.marketState || null,
    quoteType: quote?.quoteType || null,
  }
}

async function quoteMostActiveUniverse(assetClass) {
  const universe = MOST_ACTIVE_UNIVERSES[assetClass] || []
  if (!universe.length) return []
  const symbols = universe.map(([ticker]) => toYahooSymbol(ticker) || ticker)
  const labels = new Map(universe.map(([ticker, label]) => [ticker.toUpperCase(), label]))
  const raw = await yahooFinance.quote(symbols, {}, { validateResult: false })
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : []
  const bySymbol = new Map(
    rows.map((quote) => [String(quote?.symbol || '').toUpperCase(), quote]),
  )
  const items = []
  for (const [ticker, label] of universe) {
    const key = (toYahooSymbol(ticker) || ticker).toUpperCase()
    const quote = bySymbol.get(key) || bySymbol.get(ticker.toUpperCase()) || {}
    const mapped = mapMostActiveRow(quote, assetClass, ticker, label)
    if (mapped) {
      if (!mapped.label || mapped.label === mapped.ticker) {
        mapped.label = labels.get(ticker.toUpperCase()) || mapped.label
      }
      items.push(mapped)
    }
  }
  return items
}

const CRYPTO_STABLES = new Set([
  'USDT-USD',
  'USDC-USD',
  'FDUSD-USD',
  'DAI-USD',
  'TUSD-USD',
  'USDP-USD',
  'USDS33039-USD',
  'USDS-USD',
  'BUSD-USD',
])

function marketListId(raw, assetClass) {
  const list = String(raw || '').trim().toLowerCase().replace(/-/g, '_')
  if (
    list === 'trending' ||
    list === 'most_actives' ||
    list === 'gainers' ||
    list === 'losers' ||
    list === 'markets'
  ) {
    return list
  }
  if (assetClass === 'equity') return 'most_actives'
  return 'markets'
}

async function fetchYahooTrendingSymbols(count = 20) {
  const hosts = [
    'https://query2.finance.yahoo.com',
    'https://query1.finance.yahoo.com',
  ]
  let lastError = null
  for (const host of hosts) {
    try {
      const response = await fetch(
        `${host}/v1/finance/trending/US?count=${Math.min(50, Math.max(5, count))}`,
        { headers: YAHOO_SCREENER_HEADERS },
      )
      if (!response.ok) {
        lastError = new Error(`Yahoo trending failed (${response.status})`)
        continue
      }
      const body = await response.json()
      const quotes = body?.finance?.result?.[0]?.quotes
      if (Array.isArray(quotes) && quotes.length) {
        return quotes
          .map((row) => String(row?.symbol || '').trim())
          .filter(Boolean)
      }
      lastError = new Error('Yahoo trending returned 0 quotes')
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError || new Error('Yahoo trending failed')
}

async function quoteSymbolsAsItems(symbols, assetClass) {
  const clean = [...new Set(symbols.map((s) => String(s || '').trim()).filter(Boolean))]
  if (!clean.length) return []
  const yahooSymbols = clean.map((ticker) => toYahooSymbol(ticker) || ticker)
  const raw = await yahooFinance.quote(yahooSymbols, {}, { validateResult: false })
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : []
  const bySymbol = new Map(
    rows.map((quote) => [String(quote?.symbol || '').toUpperCase(), quote]),
  )
  const items = []
  for (const ticker of clean) {
    const key = (toYahooSymbol(ticker) || ticker).toUpperCase()
    const quote = bySymbol.get(key) || bySymbol.get(ticker.toUpperCase()) || {}
    const mapped = mapMostActiveRow(quote, assetClass, ticker)
    if (mapped) items.push(mapped)
  }
  return items
}

async function loadYahooMarketList(assetClass, list, count) {
  if (assetClass === 'equity' && list === 'trending') {
    try {
      const symbols = await fetchYahooTrendingSymbols(count)
      const equityOnly = symbols.filter((s) => {
        const u = s.toUpperCase()
        return !u.includes('-USD') && !u.endsWith('=X') && !u.endsWith('=F')
      })
      return {
        screener: 'trending_US',
        items: await quoteSymbolsAsItems(equityOnly.slice(0, count), 'equity'),
      }
    } catch {
      try {
        const quotes = await fetchYahooPredefinedScreener('most_actives', count)
        return {
          screener: 'most_actives',
          items: quotes
            .map((quote) => mapMostActiveRow(quote, 'equity'))
            .filter(Boolean),
        }
      } catch {
        return {
          screener: 'quoted-universe',
          items: await quoteMostActiveUniverse('equity'),
        }
      }
    }
  }

  if (assetClass === 'equity' && (list === 'gainers' || list === 'losers')) {
    const scrId = list === 'gainers' ? 'day_gainers' : 'day_losers'
    try {
      const quotes = await fetchYahooPredefinedScreener(scrId, count)
      return {
        screener: scrId,
        items: quotes
          .map((quote) => mapMostActiveRow(quote, 'equity'))
          .filter(Boolean),
      }
    } catch {
      const fallback = await quoteMostActiveUniverse('equity')
      fallback.sort((a, b) =>
        list === 'losers'
          ? (a.regularMarketChangePercent || 0) - (b.regularMarketChangePercent || 0)
          : (b.regularMarketChangePercent || 0) - (a.regularMarketChangePercent || 0),
      )
      return { screener: 'quoted-universe', items: fallback }
    }
  }

  if (assetClass === 'equity' && list === 'most_actives') {
    try {
      const quotes = await fetchYahooPredefinedScreener('most_actives', count)
      return {
        screener: 'most_actives',
        items: quotes
          .map((quote) => mapMostActiveRow(quote, 'equity'))
          .filter(Boolean),
      }
    } catch {
      return {
        screener: 'quoted-universe',
        items: await quoteMostActiveUniverse('equity'),
      }
    }
  }

  if (assetClass === 'crypto') {
    try {
      const quotes = await fetchYahooPredefinedScreener(
        'all_cryptocurrencies_us',
        Math.max(count * 3, 40),
      )
      const items = quotes
        .map((quote) => mapMostActiveRow(quote, 'crypto'))
        .filter(Boolean)
        .filter((row) => !CRYPTO_STABLES.has(String(row.ticker || '').toUpperCase()))
        .filter((row) => !/^\d/.test(String(row.ticker || '')))
      items.sort(
        (a, b) =>
          (b.volume || 0) - (a.volume || 0) ||
          Math.abs(b.regularMarketChangePercent || 0) -
            Math.abs(a.regularMarketChangePercent || 0),
      )
      return { screener: 'all_cryptocurrencies_us', items }
    } catch {
      return {
        screener: 'quoted-universe',
        items: await quoteMostActiveUniverse('crypto'),
      }
    }
  }

  return {
    screener: 'yahoo-markets',
    items: await quoteMostActiveUniverse(assetClass),
  }
}

/**
 * Yahoo Markets lists for the momentum left rail.
 *   GET /api/yahoo/market-lists?class=equity&list=most_actives|trending|gainers|losers|markets
 *   GET /api/yahoo/most-actives?class=equity  (alias → most_actives / markets)
 */
async function handleYahooMarketList(request, response) {
  try {
    const assetClass = mostActiveAssetClass(request.query.class)
    const list = marketListId(request.query.list, assetClass)
    const count = Math.min(40, Math.max(5, Number(request.query.count) || 20))
    const cacheKey = `${assetClass}:${list}:${count}`
    const cached = mostActivesCache.get(cacheKey)
    if (cached && Date.now() - cached.at < 60_000) {
      response.setHeader('Cache-Control', 'public, max-age=30')
      response.json(cached.payload)
      return
    }

    const loaded = await loadYahooMarketList(assetClass, list, count)
    let items = loaded.items || []
    const rankByVolume =
      list === 'most_actives' ||
      (assetClass === 'crypto' && list === 'markets')
    if (rankByVolume) {
      items.sort(
        (a, b) =>
          (b.volume || 0) - (a.volume || 0) ||
          Math.abs(b.regularMarketChangePercent || 0) -
            Math.abs(a.regularMarketChangePercent || 0),
      )
    }
    items = items.slice(0, count)

    const payload = {
      ok: true,
      source: 'yahoo-finance',
      class: assetClass,
      list,
      screener: loaded.screener,
      fetchedAt: new Date().toISOString(),
      count: items.length,
      items,
    }
    mostActivesCache.set(cacheKey, { at: Date.now(), payload })
    response.setHeader('Cache-Control', 'public, max-age=30')
    response.json(payload)
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: errorMessage(error, 'Failed to fetch Yahoo market list'),
    })
  }
}

router.get('/market-lists', handleYahooMarketList)
router.get('/most-actives', handleYahooMarketList)

/** Tickers the user has saved into yahoo_finance_snapshots (Watchlist first tab). */
router.get('/saved-tickers', async (_request, response) => {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('yahoo_finance_snapshots')
      .select('ticker, updated_at, source_metadata')
      .order('updated_at', { ascending: false })
      .limit(80)
    if (error) throw error
    const items = (data || []).map((row) => {
      const ticker = String(row.ticker || '').trim().toUpperCase()
      const meta =
        row.source_metadata && typeof row.source_metadata === 'object'
          ? row.source_metadata
          : {}
      return {
        ticker,
        label:
          String(meta.shortName || meta.longName || meta.companyName || ticker).trim() ||
          ticker,
        assetClass: detectSavedAssetClass(ticker),
        updatedAt: row.updated_at || null,
        source: 'supabase',
      }
    }).filter((row) => row.ticker)
    response.json({
      ok: true,
      source: 'supabase',
      table: 'yahoo_finance_snapshots',
      count: items.length,
      items,
    })
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: errorMessage(error, 'Failed to load saved Yahoo tickers'),
    })
  }
})

function detectSavedAssetClass(ticker) {
  const t = String(ticker || '').toUpperCase()
  if (t.startsWith('^')) return 'index'
  if (t.endsWith('=X')) return 'forex'
  if (t.endsWith('=F')) return 'commodity'
  if (t.endsWith('-USD') || t.endsWith('-USDT')) return 'crypto'
  return 'equity'
}

// Lightweight Yahoo-only batch used by live dashboard ticker chips.
router.get('/quotes', async (request, response) => {
  try {
    const tickers = [...new Set(
      String(request.query.tickers || '')
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    )].slice(0, 80)

    if (!tickers.length) {
      response.json({
        source: 'yahoo-finance',
        fetchedAt: new Date().toISOString(),
        quotes: {},
      })
      return
    }

    const tickerSymbols = tickers.map((ticker) => ({ ticker, symbol: toYahooSymbol(ticker) }))
    const yahooSymbols = tickerSymbols.map((item) => item.symbol)
    const [raw, streamedQuotes] = await Promise.all([
      yahooFinance.quote(yahooSymbols, {}, { validateResult: false }),
      getYahooLiveQuotes(yahooSymbols),
    ])
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : []
    const bySymbol = new Map(
      rows.map((quote) => [String(quote?.symbol || '').toUpperCase(), quote]),
    )
    const quotes = {}

    for (const { ticker, symbol } of tickerSymbols) {
      const streamed = streamedQuotes[symbol.toUpperCase()] || null
      const q = bySymbol.get(symbol.toUpperCase()) || {}
      if (!streamed && !q.symbol) continue
      const marketState = resolveQuoteMarketState(streamed, q.marketState)

      // Always expose all three session change fields from REST (when present)
      const regularMarketChangeVal = numOrNull(q.regularMarketChange)
      const regularMarketChangePercentVal = numOrNull(q.regularMarketChangePercent)
      const preMarketChangeVal = numOrNull(q.preMarketChange)
      const preMarketChangePercentVal = numOrNull(q.preMarketChangePercent)
      const postMarketChangeVal = numOrNull(q.postMarketChange)
      const postMarketChangePercentVal = numOrNull(q.postMarketChangePercent)

      const quote = {
        symbol: q.symbol || symbol,
        shortName: streamed?.shortName || q.shortName || q.longName || null,
        longName: q.longName || streamed?.longName || null,
        regularMarketPrice: numOrNull(q.regularMarketPrice),
        regularMarketChange: regularMarketChangeVal,
        regularMarketChangePercent: regularMarketChangePercentVal,
        regularMarketPreviousClose: numOrNull(q.regularMarketPreviousClose),
        regularMarketTime: marketTimeToIso(q.regularMarketTime),
        preMarketPrice: numOrNull(q.preMarketPrice),
        preMarketChange: preMarketChangeVal,
        preMarketChangePercent: preMarketChangePercentVal,
        preMarketTime: marketTimeToIso(q.preMarketTime),
        postMarketPrice: numOrNull(q.postMarketPrice),
        postMarketChange: postMarketChangeVal,
        postMarketChangePercent: postMarketChangePercentVal,
        postMarketTime: marketTimeToIso(q.postMarketTime),
        hasPrePostMarketData: q.hasPrePostMarketData ?? null,
        currency: q.currency || null,
        marketState,
        exchange: streamed?.exchange || q.fullExchangeName || q.exchange || null,
        liveSource: streamed ? 'yahoo-streamer' : 'yahoo-quote',
        streamReceivedAt: streamed?.receivedAt || null,
      }

      // Overlay live stream tick into Yahoo’s matching price fields for marketState.
      // Never invent regularMarketPreviousClose from stream (change can be session-local
      // or stale) — keep REST previous close and recompute change % from that basis.
      if (streamed && Number.isFinite(streamed.price)) {
        const bucket = priceBucketForMarketState(marketState)
        if (bucket === 'regular' && marketState === 'REGULAR') {
          quote.regularMarketPrice = streamed.price
          quote.regularMarketTime = marketTimeToIso(streamed.time)
          const prev = quote.regularMarketPreviousClose
          if (prev != null && Number.isFinite(prev) && prev !== 0) {
            quote.regularMarketChange = streamed.price - prev
            quote.regularMarketChangePercent =
              ((streamed.price - prev) / prev) * 100
          } else {
            quote.regularMarketChange = numOrNull(
              streamed.change,
              quote.regularMarketChange,
            )
            quote.regularMarketChangePercent = numOrNull(
              streamed.changePercent,
              quote.regularMarketChangePercent,
            )
          }
        } else if (bucket === 'pre') {
          quote.preMarketPrice = streamed.price
          quote.preMarketTime = marketTimeToIso(streamed.time)
          // Pre % is vs last RTH close (frozen regularMarketPrice in PRE)
          const basis = quote.regularMarketPrice
          if (basis != null && Number.isFinite(basis) && basis !== 0) {
            quote.preMarketChange = streamed.price - basis
            quote.preMarketChangePercent =
              ((streamed.price - basis) / basis) * 100
          } else {
            quote.preMarketChange = numOrNull(
              streamed.change,
              quote.preMarketChange,
            )
            quote.preMarketChangePercent = numOrNull(
              streamed.changePercent,
              quote.preMarketChangePercent,
            )
          }
        } else if (bucket === 'post') {
          // PREPRE Overnight + POST/POSTPOST After Hours → postMarket*
          quote.postMarketPrice = streamed.price
          quote.postMarketTime = marketTimeToIso(streamed.time)
          const basis = quote.regularMarketPrice
          if (basis != null && Number.isFinite(basis) && basis !== 0) {
            quote.postMarketChange = streamed.price - basis
            quote.postMarketChangePercent =
              ((streamed.price - basis) / basis) * 100
          } else {
            quote.postMarketChange = numOrNull(
              streamed.change,
              quote.postMarketChange,
            )
            quote.postMarketChangePercent = numOrNull(
              streamed.changePercent,
              quote.postMarketChangePercent,
            )
          }
        }
      }

      quotes[ticker] = quote
    }

    response.setHeader('Cache-Control', 'no-store')
    response.json({
      source: 'yahoo-finance',
      fetchedAt: new Date().toISOString(),
      quotes,
    })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to fetch Yahoo Finance quotes') })
  }
})

/**
 * Latest Yahoo Finance news for a watchlist of tickers.
 *
 * GET /api/yahoo/watchlist-news?tickers=AAPL,MSFT,NVDA&max_age_days=14&per_ticker=8&limit=48
 *
 * Uses yahoo-finance2 search (same feed as finance.yahoo.com), not stale Supabase rows.
 */
router.get('/watchlist-news', async (request, response) => {
  try {
    response.set('Cache-Control', 'no-store, max-age=0')
    const rawTickers = String(request.query.tickers || request.query.q || '')
      .split(/[,\s]+/)
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t && t.length <= 16)
    // Dedupe, cap batch size
    const seenSym = new Set()
    const tickers = []
    for (const t of rawTickers) {
      if (seenSym.has(t)) continue
      seenSym.add(t)
      tickers.push(t)
      if (tickers.length >= 24) break
    }

    if (!tickers.length) {
      response.status(400).json({
        ok: false,
        error: 'Provide tickers=AAPL,MSFT (comma-separated watchlist symbols)',
        articles: [],
      })
      return
    }

    const maxAgeDays = Math.min(
      Math.max(Number(request.query.max_age_days ?? 14) || 14, 1),
      90,
    )
    const perTicker = Math.min(
      Math.max(Number(request.query.per_ticker ?? 8) || 8, 2),
      20,
    )
    const limit = Math.min(
      Math.max(Number(request.query.limit ?? 48) || 48, 1),
      100,
    )
    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000

    function thumbUrl(item) {
      const resList = item?.thumbnail?.resolutions
      if (!Array.isArray(resList) || !resList.length) return null
      const sorted = [...resList].sort(
        (a, b) => (Number(b.width) || 0) - (Number(a.width) || 0),
      )
      // Prefer a mid-size image for list cards
      const mid =
        sorted.find((r) => (Number(r.width) || 0) >= 140 && (Number(r.width) || 0) <= 400) ||
        sorted[sorted.length - 1] ||
        sorted[0]
      return mid?.url || null
    }

    function publishMs(item) {
      const raw = item?.providerPublishTime
      if (raw == null) return 0
      if (raw instanceof Date) return raw.getTime()
      if (typeof raw === 'number') {
        return raw < 1_000_000_000_000 ? raw * 1000 : raw
      }
      const t = Date.parse(String(raw))
      return Number.isFinite(t) ? t : 0
    }

    /** Simple concurrency pool */
    async function mapPool(items, concurrency, fn) {
      const out = new Array(items.length)
      let i = 0
      async function worker() {
        while (i < items.length) {
          const idx = i
          i += 1
          out[idx] = await fn(items[idx], idx)
        }
      }
      const n = Math.min(concurrency, items.length)
      await Promise.all(Array.from({ length: n }, () => worker()))
      return out
    }

    const perResults = await mapPool(tickers, 4, async (symbol) => {
      try {
        const yahooSym = toYahooSymbol(symbol) || symbol
        const result = await yahooFinance.search(
          yahooSym,
          { newsCount: perTicker, quotesCount: 0 },
          { validateResult: false },
        )
        const news = Array.isArray(result?.news) ? result.news : []
        return {
          ticker: symbol,
          ok: true,
          news,
          error: null,
        }
      } catch (err) {
        return {
          ticker: symbol,
          ok: false,
          news: [],
          error: err instanceof Error ? err.message : String(err),
        }
      }
    })

    const articles = []
    const seen = new Set()
    for (const batch of perResults) {
      for (const item of batch.news || []) {
        const ms = publishMs(item)
        if (ms > 0 && ms < cutoffMs) continue
        const title = String(item?.title || '').trim()
        const link = String(item?.link || item?.url || '').trim()
        const key = link || item?.uuid || title
        if (!key || seen.has(key)) continue
        seen.add(key)

        const related = Array.isArray(item?.relatedTickers)
          ? item.relatedTickers.map((t) => String(t).toUpperCase())
          : []
        // Ensure the queried ticker is listed when missing
        if (batch.ticker && !related.includes(batch.ticker)) {
          related.unshift(batch.ticker)
        }

        const publishedAt =
          ms > 0 ? new Date(ms).toISOString() : null

        articles.push({
          id: String(item?.uuid || `yahoo-${key}`).slice(0, 120),
          provider: 'yahoo-finance',
          title: title || 'Untitled',
          summary: '',
          url: link || '',
          image_url: thumbUrl(item),
          source_name: item?.publisher || 'Yahoo Finance',
          author: null,
          published_at: publishedAt,
          tickers: related,
          topics: item?.type ? [String(item.type)] : [],
          // For news-alert push header
          impact_body: related.slice(0, 4).join(' · ') || batch.ticker,
          ticker_sides: related.slice(0, 6).map((t) => ({
            ticker: t,
            side: 'neutral',
          })),
        })
      }
    }

    articles.sort((a, b) => {
      const ta = Date.parse(a.published_at || '') || 0
      const tb = Date.parse(b.published_at || '') || 0
      return tb - ta
    })

    const sliced = articles.slice(0, limit)
    const errors = perResults
      .filter((r) => !r.ok)
      .map((r) => ({ ticker: r.ticker, error: r.error }))

    response.json({
      ok: true,
      source: 'yahoo-finance',
      tickers,
      max_age_days: maxAgeDays,
      count: sliced.length,
      total: sliced.length,
      has_more: false,
      errors: errors.length ? errors : undefined,
      articles: sliced,
    })
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: errorMessage(error, 'Failed to fetch Yahoo watchlist news'),
      articles: [],
    })
  }
})

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
          { quotesCount: 16, newsCount: 0 },
          { validateResult: false },
        )
        const quotes = Array.isArray(result?.quotes) ? result.quotes : []
        live = quotes
          .filter((quote) => quote?.symbol && !savedSet.has(String(quote.symbol).toUpperCase()))
          // Prefer equities/ETFs/funds/crypto/FX/futures over options chains.
          .filter((quote) => {
            const type = String(quote.quoteType || quote.typeDisp || '').toUpperCase()
            return !type.includes('OPTION')
          })
          .slice(0, 16)
          .map((quote) => {
            const symbol = String(quote.symbol).toUpperCase()
            const shortName = quote.shortname || quote.shortName || null
            const longName = quote.longname || quote.longName || null
            const quoteType = quote.typeDisp || quote.quoteType || null
            const exchange = quote.exchDisp || quote.exchange || quote.fullExchangeName || null
            return {
              ticker: symbol,
              label: symbol,
              companyName: longName || shortName || null,
              shortName,
              longName,
              savedAt: null,
              exchange,
              quoteType,
              sector: quote.sector || null,
              industry: quote.industry || null,
              // Yahoo search score when present (higher = better match)
              score: Number.isFinite(Number(quote.score)) ? Number(quote.score) : null,
              isYahooFinance: quote.isYahooFinance !== false,
              source: 'yahoo-finance',
            }
          })
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
  // Yahoo allows ~7 calendar days of 1m/2m; share cards need dense multi-day lines.
  '5d': { days: 7, interval: '15m', allowed: ['1m', '2m', '5m', '15m', '30m', '60m', '1h'] },
  '1mo': { days: 31, interval: '1h', allowed: ['15m', '30m', '60m', '1h', '1d'] },
  '3mo': { days: 93, interval: '1d', allowed: ['1h', '1d'] },
  '6mo': { days: 186, interval: '1d', allowed: ['1d', '1wk'] },
  ytd: { ytd: true, interval: '1d', allowed: ['1d', '1wk'] },
  '1y': { days: 365, interval: '1d', allowed: ['1d', '1wk'] },
  '5y': { days: 365 * 5, interval: '1wk', allowed: ['1d', '1wk', '1mo'] },
  '10y': { days: 365 * 10, interval: '1wk', allowed: ['1d', '1wk', '1mo'] },
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

/** Try fetch an image URL; return { buf, contentType } or null. */
async function tryFetchImage(url, timeoutMs = 7000) {
  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (compatible; NewsLabsDashboard/1.0; +https://9am.site)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!upstream.ok) return null
    const contentType = (upstream.headers.get('content-type') || 'image/png').split(';')[0].trim()
    if (!contentType.startsWith('image/')) return null
    const buf = Buffer.from(await upstream.arrayBuffer())
    // Tiny / empty / placeholder GIFs often < ~100 bytes
    if (buf.length < 100) return null
    return { buf, contentType }
  } catch {
    return null
  }
}

function hostFromWebsite(website) {
  if (!website || typeof website !== 'string') return null
  try {
    let raw = website.trim()
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`
    const host = new URL(raw).hostname.replace(/^www\./i, '')
    return host || null
  } catch {
    return null
  }
}

/**
 * Same-origin logo proxy (list UI + canvas share-cards).
 * Cascades several public sources until one returns a real image:
 *   IEX → FMP → Parqet → Synth → Yahoo website favicon (Google / DuckDuckGo)
 */
/**
 * Lightweight company fundamentals for the notifications detail header:
 * market cap, sector, industry, about blurb, HQ, employees, website.
 */
router.get('/:ticker/profile', async (request, response) => {
  try {
    const ticker = String(request.params.ticker || '')
      .trim()
      .toUpperCase()
    if (!ticker) {
      response.status(400).json({ error: 'Ticker is required' })
      return
    }
    const symbol = toYahooSymbol(ticker)
    let summary = null
    try {
      summary = await yahooFinance.quoteSummary(
        symbol,
        {
          modules: [
            'assetProfile',
            'summaryProfile',
            'summaryDetail',
            'price',
            'quoteType',
          ],
        },
        { validateResult: false },
      )
    } catch (error) {
      // Recovery: FailedYahooValidationError often still has .result
      summary = error?.result || null
      if (!summary) throw error
    }

    const asset = summary?.assetProfile || {}
    const profile = summary?.summaryProfile || {}
    const detail = summary?.summaryDetail || {}
    const price = summary?.price || {}
    const quoteType = summary?.quoteType || {}

    const pick = (...vals) => {
      for (const v of vals) {
        if (v == null || v === '') continue
        return v
      }
      return null
    }

    const marketCapRaw = pick(detail.marketCap, price.marketCap, price.enterpriseValue)
    const marketCap =
      marketCapRaw != null && Number.isFinite(Number(marketCapRaw))
        ? Number(marketCapRaw)
        : null

    const employeesRaw = pick(asset.fullTimeEmployees, profile.fullTimeEmployees)
    const employees =
      employeesRaw != null && Number.isFinite(Number(employeesRaw))
        ? Number(employeesRaw)
        : null

    // Some Yahoo profiles expose founding-ish dates as epoch seconds/ms.
    const foundedCandidates = [
      asset.startDate,
      profile.startDate,
      asset.founded,
      profile.founded,
      quoteType?.startDate,
    ]
    let founded = null
    for (const raw of foundedCandidates) {
      if (raw == null || raw === '') continue
      if (typeof raw === 'string' && /^\d{4}/.test(raw)) {
        founded = raw.slice(0, 10)
        break
      }
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0) continue
      const ms = n < 1e12 ? n * 1000 : n
      const d = new Date(ms)
      if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() > 1800 && d.getUTCFullYear() < 2100) {
        founded = String(d.getUTCFullYear())
        break
      }
    }

    const officers = Array.isArray(asset.companyOfficers) ? asset.companyOfficers : []
    const ceo =
      officers.find((o) => /chief executive|ceo/i.test(String(o?.title || ''))) ||
      officers[0] ||
      null

    const about = String(
      pick(asset.longBusinessSummary, profile.longBusinessSummary) || '',
    ).trim()

    response.setHeader('Cache-Control', 'public, max-age=300')
    response.json({
      ok: true,
      ticker,
      symbol,
      source: 'yahoo-finance',
      profile: {
        shortName: pick(price.shortName, quoteType.shortName) || null,
        longName: pick(price.longName, quoteType.longName) || null,
        marketCap,
        currency: pick(price.currency, detail.currency) || 'USD',
        sector: pick(asset.sector, profile.sector, asset.sectorDisp) || null,
        industry: pick(asset.industry, profile.industry, asset.industryDisp) || null,
        website: pick(asset.website, profile.website) || null,
        fullTimeEmployees: employees,
        city: pick(asset.city, profile.city) || null,
        state: pick(asset.state, profile.state) || null,
        country: pick(asset.country, profile.country) || null,
        founded,
        ceo: ceo?.name ? String(ceo.name) : null,
        ceoTitle: ceo?.title ? String(ceo.title) : null,
        about: about || null,
        exchange: pick(price.exchange, quoteType.exchange) || null,
      },
    })
  } catch (error) {
    response.status(500).json({
      error: errorMessage(error, 'Failed to fetch Yahoo company profile'),
    })
  }
})

router.get('/:ticker/logo', async (request, response) => {
  try {
    const ticker = String(request.params.ticker || '').toUpperCase()
    const logoSymbol = ticker.replace(/[^A-Z0-9.-]/g, '')
    if (!logoSymbol) {
      response.status(400).json({ error: 'Invalid ticker' })
      return
    }

    const yahooSymbol = toYahooSymbol(logoSymbol)
    const candidates = []

    // 1) Direct ticker logo CDNs (no auth)
    candidates.push(`https://storage.googleapis.com/iex/api/logos/${logoSymbol}.png`)
    candidates.push(`https://financialmodelingprep.com/image-stock/${logoSymbol}.png`)
    candidates.push(`https://assets.parqet.com/logos/symbol/${logoSymbol}`)
    candidates.push(`https://logo.synthfinance.com/ticker/${logoSymbol}`)

    // 2) Optional website from query
    let website =
      typeof request.query.website === 'string' ? request.query.website.trim() : ''

    // 3) Resolve website from Yahoo quoteSummary when missing
    if (!website) {
      try {
        const summary = await yahooFinance.quoteSummary(
          yahooSymbol,
          { modules: ['assetProfile', 'summaryProfile'] },
          { validateResult: false },
        )
        website =
          summary?.assetProfile?.website ||
          summary?.summaryProfile?.website ||
          ''
      } catch {
        website = ''
      }
    }

    // 4) Also try shortName-based nothing — domain favicons instead
    const host = hostFromWebsite(website)
    if (host) {
      candidates.push(
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
      )
      candidates.push(`https://icons.duckduckgo.com/ip3/${host}.ico`)
      // Logo.dev public domain path (works for many brands without token for basic use)
      candidates.push(`https://img.logo.dev/${host}?size=128&format=png`)
    }

    // 5) Last-ditch: Google favicon using ticker.com-style guesses is weak — skip

    for (const url of candidates) {
      const hit = await tryFetchImage(url)
      if (!hit) continue
      response.setHeader('Content-Type', hit.contentType)
      response.setHeader('Cache-Control', 'public, max-age=86400')
      response.setHeader('X-Logo-Source', new URL(url).hostname)
      response.send(hit.buf)
      return
    }

    response.status(404).json({ error: 'Logo not found' })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to fetch logo') })
  }
})

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
        longName: q.longName || null,
        regularMarketPrice: numOrNull(q.regularMarketPrice),
        regularMarketChange: numOrNull(q.regularMarketChange),
        regularMarketChangePercent: numOrNull(q.regularMarketChangePercent),
        regularMarketPreviousClose: numOrNull(q.regularMarketPreviousClose),
        regularMarketTime: marketTimeToIso(q.regularMarketTime),
        preMarketPrice: numOrNull(q.preMarketPrice),
        preMarketChange: numOrNull(q.preMarketChange),
        preMarketChangePercent: numOrNull(q.preMarketChangePercent),
        preMarketTime: marketTimeToIso(q.preMarketTime),
        postMarketPrice: numOrNull(q.postMarketPrice),
        postMarketChange: numOrNull(q.postMarketChange),
        postMarketChangePercent: numOrNull(q.postMarketChangePercent),
        postMarketTime: marketTimeToIso(q.postMarketTime),
        hasPrePostMarketData: q.hasPrePostMarketData ?? null,
        currency: q.currency || null,
        // Yahoo marketState as-is (PRE / PREPRE / REGULAR / POST / POSTPOST / CLOSED)
        marketState: resolveQuoteMarketState(null, q.marketState),
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
        includePrePost: isIntraday,
        events: 'div|split|earn',
      },
      { validateResult: false },
    )

    response.json({
      ticker,
      symbol,
      range: resolvedRange,
      interval,
      includePrePost: isIntraday,
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
      // 200 + null (not 404) so browsers don't log expected "not saved yet" as failed requests.
      response.status(200).json(null)
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
    const row = prepareSnapshotRow(ticker, body)

    const supabase = getSupabase()
    const { data: saved, error } = await supabase
      .from('yahoo_finance_snapshots')
      .upsert(row, { onConflict: 'ticker' })
      .select(SNAPSHOT_SELECT_LIGHT)
      .single()

    if (error) throw error
    // Echo slimmed payloads so the client still has full UI data without a re-read of jsonb.
    response.json({
      ok: true,
      snapshot: normalizeSnapshot({
        ...saved,
        data: row.data,
        raw_json: row.raw_json,
      }),
    })
  } catch (error) {
    console.error('[yahoo/save]', request.params.ticker, errorMessage(error, 'save failed'), error)
    response.status(500).json({ error: errorMessage(error, 'Failed to save Yahoo Finance snapshot') })
  }
})

// Live-fetch every module then upsert — used by "Refresh from Yahoo Finance".
router.post('/:ticker/refresh', async (request, response) => {
  try {
    const ticker = request.params.ticker.toUpperCase()
    const bundle = await fetchAllYahooModules(ticker)
    const row = prepareSnapshotRow(ticker, {
      data: bundle.data,
      rawJson: bundle.raw_json,
      moduleStatus: bundle.module_status,
      sourceMetadata: {
        source: 'yahoo-finance',
        fetchedAt: bundle.fetchedAt,
        units: bundle.units,
      },
    })
    const supabase = getSupabase()
    const { data: saved, error } = await supabase
      .from('yahoo_finance_snapshots')
      .upsert(row, { onConflict: 'ticker' })
      .select(SNAPSHOT_SELECT_LIGHT)
      .single()
    if (error) throw error
    response.json({
      ok: true,
      bundle,
      snapshot: normalizeSnapshot({
        ...saved,
        data: row.data,
        raw_json: row.raw_json,
      }),
    })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to refresh Yahoo Finance snapshot') })
  }
})

export default router
