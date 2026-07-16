import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { buildProfile } from './profile.js'
import { getLatestReports, getRecentFilings } from './filings.js'
import { getFinancials } from './financials.js'
import { getInsiderTransactions } from './insiderTransactions.js'
import {
  getInstitutionalHoldings,
  getManagerPortfolio,
  getManagerCategory,
  HEDGE_FUNDS_AND_INSTITUTIONS,
  INVESTMENT_FUND_MANAGERS,
} from './institutionalHoldings.js'
import { resolveTicker, getSubmissions, getTickerMap, limit as rateLimit } from './secClient.js'
import { getCongressTrading, getPoliticianPortfolio } from './congressTrading.js'
import { getProxyStatement } from './proxyStatement.js'
import { getAnalystData } from './analyst.js'
import { searchFilersByName, getRecentFilers } from './politicianSearch.js'
import { withSteps, getSteps } from './stepTracer.js'

const router = express.Router()

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY to .env.local')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function upsertSnapshot(table, conflictColumn, row) {
  const supabase = getSupabase()
  const { data, error } = await supabase.from(table).upsert(row, { onConflict: conflictColumn }).select().single()
  if (error) throw error
  return data
}

async function getSavedSnapshot(table, matchColumn, value) {
  const supabase = getSupabase()
  const { data, error } = await supabase.from(table).select('*').eq(matchColumn, value).maybeSingle()
  if (error) throw error
  return data
}

// Supabase/PostgREST errors are plain objects with a `.message`, not real
// Error instances, so `error instanceof Error` misses them and falls back to
// a generic message that hides the actual reason.
function errorMessage(error, fallback) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
  return fallback
}

// Supabase rows are snake_case; the rest of this API is camelCase. `table` is
// passed through explicitly (rather than guessed client-side) so the UI can
// say exactly where a saved snapshot came from.
function normalizeSnapshot(row, table) {
  if (!row) return null
  return {
    ticker: row.ticker,
    cik: row.cik,
    filerId: row.filer_id,
    managerName: row.manager_name,
    data: row.data,
    sourceMetadata: row.source_metadata,
    createdAt: row.created_at,
    sourceTable: table,
  }
}

function parseSaveBody(request, response) {
  const { data, sourceMetadata } = request.body || {}
  if (!data || typeof data !== 'object') {
    response.status(400).json({ error: 'Request body must include a "data" object.' })
    return null
  }
  return { data, sourceMetadata: sourceMetadata && typeof sourceMetadata === 'object' ? sourceMetadata : {} }
}

router.get('/:ticker/profile', (request, response) =>
  withSteps(async () => {
    try {
      const profile = await buildProfile(request.params.ticker)
      response.json({ data: profile, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load company profile'), steps: getSteps() })
    }
  }),
)

router.get('/:ticker/filings', (request, response) =>
  withSteps(async () => {
    try {
      const limit = Math.min(Math.max(Number(request.query.limit || 25), 1), 100)
      const filings = await getRecentFilings(request.params.ticker, limit)
      response.json({ data: filings, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load recent filings'), steps: getSteps() })
    }
  }),
)

router.get('/:ticker/latest-reports', (request, response) =>
  withSteps(async () => {
    try {
      const snapshots = await getLatestReports(request.params.ticker)
      response.json({ data: snapshots, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load latest 10-K/10-Q snapshot'), steps: getSteps() })
    }
  }),
)

router.get('/:ticker/financials', (request, response) =>
  withSteps(async () => {
    try {
      const period = request.query.period === 'quarterly' ? 'quarterly' : 'annual'
      const financials = await getFinancials(request.params.ticker, period)
      response.json({ data: financials, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load financials'), steps: getSteps() })
    }
  }),
)

router.get('/:ticker/insider-transactions', (request, response) =>
  withSteps(async () => {
    try {
      const transactions = await getInsiderTransactions(request.params.ticker)
      response.json({ data: transactions, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load insider transactions'), steps: getSteps() })
    }
  }),
)

router.get('/:ticker/institutional-holdings', (request, response) =>
  withSteps(async () => {
    try {
      const kind = request.query.kind === 'investment-fund' ? 'investment-fund' : 'hedge-fund'
      const { cik } = await resolveTicker(request.params.ticker)
      const submissions = await getSubmissions(cik)
      const holdings = await getInstitutionalHoldings(submissions.name, kind)
      response.json({ data: holdings, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load institutional holdings'), steps: getSteps() })
    }
  }),
)

// The full curated universe of tracked managers, split by category -- lets
// the frontend show "all 28, tick the ones already saved" instead of only
// ever listing whichever subset happens to already be in Supabase.
router.get('/managers', (request, response) => {
  response.json({
    hedgeFunds: Object.entries(HEDGE_FUNDS_AND_INSTITUTIONS).map(([name, cik]) => ({ name, cik })),
    investmentFunds: Object.entries(INVESTMENT_FUND_MANAGERS).map(([name, cik]) => ({ name, cik })),
  })
})

// Bulk "refresh everything in this category from SEC and save it" -- for
// each manager, forces a genuine live SEC fetch (bypassing that manager's own
// saved snapshot, since the whole point here is to get fresh data) and
// upserts the result into Supabase. Slow by nature (up to 16-28 full 13F
// downloads) -- heavyLimit inside fetchManagerHoldings already serializes the
// big XML downloads to 1 at a time, and rateLimit below caps everything else
// to 6 concurrent, so this can't repeat the earlier SEC 429 rate-limit incident.
router.post('/managers/refresh-all', (request, response) =>
  withSteps(async () => {
    try {
      const category = request.query.category === 'investment-fund' ? 'investment-fund' : 'hedge-fund'
      const managers = category === 'investment-fund' ? INVESTMENT_FUND_MANAGERS : HEDGE_FUNDS_AND_INSTITUTIONS
      const table = category === 'investment-fund' ? 'etf_snapshots' : 'institution_snapshots'
      const entries = Object.entries(managers)

      const results = await Promise.all(
        entries.map(([name, cik]) =>
          rateLimit(async () => {
            try {
              const portfolio = await getManagerPortfolio(cik, { forceLive: true })
              if (!portfolio || portfolio.error) {
                return { name, cik, ok: false, error: portfolio?.error || 'No 13F-HR data returned' }
              }
              await upsertSnapshot(table, 'cik', {
                cik: Number(cik),
                manager_name: portfolio.managerName || name,
                data: portfolio,
                source_metadata: { fetchedAt: new Date().toISOString(), source: 'refresh-all' },
              })
              return { name: portfolio.managerName || name, cik, ok: true }
            } catch (error) {
              return { name, cik, ok: false, error: errorMessage(error, 'Failed to refresh') }
            }
          }),
        ),
      )

      const succeeded = results.filter((result) => result.ok).length
      response.json({
        data: { category, total: entries.length, succeeded, failed: entries.length - succeeded, results },
        steps: getSteps(),
      })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to refresh managers'), steps: getSteps() })
    }
  }),
)

router.get('/manager/:cik', (request, response) =>
  withSteps(async () => {
    try {
      const forceLive = request.query.force === 'true'
      const portfolio = await getManagerPortfolio(request.params.cik, { forceLive })
      if (!portfolio) {
        response.status(404).json({ error: 'No curated manager matches this CIK', steps: getSteps() })
        return
      }
      response.json({ data: portfolio, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load manager portfolio'), steps: getSteps() })
    }
  }),
)

router.get('/:ticker/congress-trades', (request, response) =>
  withSteps(async () => {
    try {
      const data = await getCongressTrading(request.params.ticker)
      response.json({ data, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load congressional trading data'), steps: getSteps() })
    }
  }),
)

router.get('/politician/:filerId', (request, response) =>
  withSteps(async () => {
    try {
      const data = await getPoliticianPortfolio(request.params.filerId)
      if (!data) {
        response.status(404).json({ error: 'No data for this filer id', steps: getSteps() })
        return
      }
      response.json({ data, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load politician portfolio'), steps: getSteps() })
    }
  }),
)

router.get('/:ticker/proxy-statement', (request, response) =>
  withSteps(async () => {
    try {
      const proxy = await getProxyStatement(request.params.ticker)
      response.json({ data: proxy, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load proxy statement'), steps: getSteps() })
    }
  }),
)

router.get('/:ticker/analyst', (request, response) =>
  withSteps(async () => {
    try {
      const analyst = await getAnalystData(request.params.ticker)
      response.json({ data: analyst, steps: getSteps() })
    } catch (error) {
      response.status(500).json({ error: errorMessage(error, 'Failed to load analyst data'), steps: getSteps() })
    }
  }),
)

router.get('/:ticker/saved', async (request, response) => {
  try {
    const ticker = request.params.ticker.toUpperCase()
    const saved = await getSavedSnapshot('ticker_dashboard_snapshots', 'ticker', ticker)
    if (!saved) {
      response.status(404).json({ error: 'No saved snapshot for this ticker' })
      return
    }
    response.json(normalizeSnapshot(saved, 'ticker_dashboard_snapshots'))
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to load saved ticker snapshot') })
  }
})

router.post('/:ticker/save', async (request, response) => {
  try {
    const ticker = request.params.ticker.toUpperCase()
    const body = parseSaveBody(request, response)
    if (!body) return

    const saved = await upsertSnapshot('ticker_dashboard_snapshots', 'ticker', {
      ticker,
      data: body.data,
      source_metadata: body.sourceMetadata,
    })
    response.json({ ok: true, snapshot: normalizeSnapshot(saved, 'ticker_dashboard_snapshots') })
  } catch (error) {
    const message = errorMessage(error, 'Failed to save ticker snapshot')
    response.status(500).json({ error: message })
  }
})

router.get('/manager/:cik/saved', async (request, response) => {
  try {
    const cik = Number(request.params.cik)
    const category = getManagerCategory(cik)
    if (!category) {
      response.status(404).json({ error: 'No curated manager matches this CIK' })
      return
    }
    const table = category === 'institution' ? 'institution_snapshots' : 'etf_snapshots'
    const saved = await getSavedSnapshot(table, 'cik', cik)
    if (!saved) {
      response.status(404).json({ error: 'No saved snapshot for this manager' })
      return
    }
    response.json(normalizeSnapshot(saved, table))
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to load saved manager snapshot') })
  }
})

router.post('/manager/:cik/save', async (request, response) => {
  try {
    const cik = Number(request.params.cik)
    const category = getManagerCategory(cik)
    if (!category) {
      response.status(404).json({ error: 'No curated manager matches this CIK' })
      return
    }
    const body = parseSaveBody(request, response)
    if (!body) return

    const managerName = body.data?.managerName || `CIK ${cik}`
    const table = category === 'institution' ? 'institution_snapshots' : 'etf_snapshots'
    const saved = await upsertSnapshot(table, 'cik', {
      cik,
      manager_name: managerName,
      data: body.data,
      source_metadata: body.sourceMetadata,
    })
    response.json({ ok: true, snapshot: normalizeSnapshot(saved, table) })
  } catch (error) {
    const message = errorMessage(error, 'Failed to save manager snapshot')
    response.status(500).json({ error: message })
  }
})

router.get('/politician/:filerId/saved', async (request, response) => {
  try {
    const saved = await getSavedSnapshot('politician_snapshots', 'filer_id', request.params.filerId)
    if (!saved) {
      response.status(404).json({ error: 'No saved snapshot for this filer' })
      return
    }
    response.json(normalizeSnapshot(saved, 'politician_snapshots'))
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Failed to load saved politician snapshot') })
  }
})

router.post('/politician/:filerId/save', async (request, response) => {
  try {
    const filerId = request.params.filerId
    const body = parseSaveBody(request, response)
    if (!body) return

    const saved = await upsertSnapshot('politician_snapshots', 'filer_id', {
      filer_id: filerId,
      data: body.data,
      source_metadata: body.sourceMetadata,
    })
    response.json({ ok: true, snapshot: normalizeSnapshot(saved, 'politician_snapshots') })
  } catch (error) {
    const message = errorMessage(error, 'Failed to save politician snapshot')
    response.status(500).json({ error: message })
  }
})

router.get('/search', async (request, response) => {
  try {
    const q = String(request.query.q || '').trim()
    const qUpper = q.toUpperCase()
    const supabase = getSupabase()

    // High enough to feel like "browse everything saved" for a personal list,
    // without an unbounded query if it ever grows very large.
    const BROWSE_LIMIT = 200

    async function searchTable(table, column, labelColumn) {
      let query = supabase.from(table).select('*').order('created_at', { ascending: false }).limit(BROWSE_LIMIT)
      if (q) query = query.ilike(labelColumn, `%${q}%`)
      const { data, error } = await query
      if (error) throw error
      return data || []
    }

    const [tickerRows, institutionRows, etfRows, savedPoliticians, unsavedPoliticians] = await Promise.all([
      searchTable('ticker_dashboard_snapshots', 'ticker', 'ticker'),
      searchTable('institution_snapshots', 'cik', 'manager_name'),
      searchTable('etf_snapshots', 'cik', 'manager_name'),
      searchTable('politician_snapshots', 'filer_id', 'data->filer->>fullName'),
      q ? searchFilersByName(q, BROWSE_LIMIT) : getRecentFilers(BROWSE_LIMIT),
    ])

    const savedFilerIds = new Set(savedPoliticians.map((row) => row.filer_id))
    const politicians = [
      ...savedPoliticians.map((row) => ({ filerId: row.filer_id, fullName: row.data?.filer?.fullName || row.filer_id, savedAt: row.created_at })),
      ...unsavedPoliticians.filter((filer) => !savedFilerIds.has(filer.filerId)).map((filer) => ({ ...filer, savedAt: null })),
    ].slice(0, BROWSE_LIMIT)

    // Saved tickers first (with savedAt), then live SEC company_tickers map
    // matches so typing "NVDA" still shows a suggestion even before it's saved.
    const savedTickers = tickerRows.map((row) => ({
      ticker: row.ticker,
      label: row.ticker,
      savedAt: row.created_at,
      companyName: row.data?.profile?.name || null,
    }))
    const savedTickerSet = new Set(savedTickers.map((item) => item.ticker?.toUpperCase()).filter(Boolean))

    let liveTickers = []
    if (qUpper.length >= 1) {
      try {
        const map = await getTickerMap()
        const matches = []
        for (const entry of map.values()) {
          const ticker = String(entry.ticker || '').toUpperCase()
          const title = String(entry.title || '')
          if (!ticker) continue
          if (savedTickerSet.has(ticker)) continue
          if (ticker.startsWith(qUpper) || title.toUpperCase().includes(qUpper)) {
            matches.push({
              ticker,
              label: ticker,
              savedAt: null,
              companyName: title || null,
            })
          }
        }
        // Prefer prefix matches on the symbol, then name hits.
        matches.sort((a, b) => {
          const aPrefix = a.ticker.startsWith(qUpper) ? 0 : 1
          const bPrefix = b.ticker.startsWith(qUpper) ? 0 : 1
          if (aPrefix !== bPrefix) return aPrefix - bPrefix
          return a.ticker.localeCompare(b.ticker)
        })
        liveTickers = matches.slice(0, 25)
      } catch {
        // Ticker map unavailable — still return saved results.
      }
    }

    response.json({
      // `companyName` lets the frontend match a saved ticker by issuer name
      // too (13F filings often don't carry a resolvable ticker symbol, only
      // the issuer's name) -- it's already in `data.profile.name` on every
      // saved row, no extra query needed.
      tickers: [...savedTickers, ...liveTickers].slice(0, BROWSE_LIMIT),
      institutions: institutionRows.map((row) => ({ cik: row.cik, label: row.manager_name, savedAt: row.created_at })),
      etfs: etfRows.map((row) => ({ cik: row.cik, label: row.manager_name, savedAt: row.created_at })),
      politicians,
    })
  } catch (error) {
    response.status(500).json({ error: errorMessage(error, 'Search failed') })
  }
})

export default router
