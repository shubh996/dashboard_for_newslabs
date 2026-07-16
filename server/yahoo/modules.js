// Catalogue of every Yahoo Finance data module we fetch via yahoo-finance2
// (plus a few raw quoteSummary extras the package schema no longer lists).
// Each module is fetched independently so one failure never aborts the ticker.

import YahooFinance from 'yahoo-finance2'
import { fetchYahooQuoteSummary, toYahooSymbol } from '../yahooClient.js'

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
})

// All quoteSummary submodules accepted by yahoo-finance2's schema.
export const QUOTE_SUMMARY_MODULES = [
  'assetProfile',
  'summaryProfile',
  'summaryDetail',
  'price',
  'quoteType',
  'defaultKeyStatistics',
  'financialData',
  'calendarEvents',
  'incomeStatementHistory',
  'incomeStatementHistoryQuarterly',
  'balanceSheetHistory',
  'balanceSheetHistoryQuarterly',
  'cashflowStatementHistory',
  'cashflowStatementHistoryQuarterly',
  'earnings',
  'earningsHistory',
  'earningsTrend',
  'recommendationTrend',
  'upgradeDowngradeHistory',
  'institutionOwnership',
  'fundOwnership',
  'majorDirectHolders',
  'majorHoldersBreakdown',
  'insiderHolders',
  'insiderTransactions',
  'netSharePurchaseActivity',
  'secFilings',
  'indexTrend',
  'sectorTrend',
  'industryTrend',
  // ETF / mutual fund modules (empty for equities — treated as expected empty).
  'fundProfile',
  'topHoldings',
  'fundPerformance',
]

// High-level fetch units shown in the UI progress list. quoteSummary modules
// are grouped into a few batches so we don't fire 30+ crumb requests at once,
// while still preserving every field in raw_json under its module name.
// ESG / pageViews stay omitted; fund modules are included so ETF tickers get
// holdings / fees / performance sections in the UI.
export const FETCH_UNITS = [
  {
    id: 'quote',
    label: 'Real-time quote',
    group: 'Quote & Profile',
  },
  {
    id: 'quoteSummary-profile',
    label: 'Company profile & summary',
    group: 'Quote & Profile',
    quoteSummary: ['assetProfile', 'summaryProfile', 'summaryDetail', 'price', 'quoteType'],
  },
  {
    id: 'quoteSummary-fund',
    label: 'ETF / fund profile, holdings & performance',
    group: 'ETF & Funds',
    quoteSummary: ['fundProfile', 'topHoldings', 'fundPerformance'],
  },
  {
    id: 'quoteSummary-stats',
    label: 'Key statistics & financial data',
    group: 'Valuation & Ratios',
    quoteSummary: ['defaultKeyStatistics', 'financialData'],
  },
  {
    id: 'quoteSummary-earnings',
    label: 'Earnings history & trends',
    group: 'Earnings',
    quoteSummary: ['earnings', 'earningsHistory', 'earningsTrend', 'calendarEvents'],
  },
  {
    id: 'quoteSummary-analyst',
    label: 'Analyst recommendations & upgrades',
    group: 'Analyst',
    quoteSummary: ['recommendationTrend', 'upgradeDowngradeHistory'],
  },
  {
    id: 'quoteSummary-ownership',
    label: 'Institutional & fund ownership',
    group: 'Ownership',
    quoteSummary: [
      'institutionOwnership',
      'fundOwnership',
      'majorDirectHolders',
      'majorHoldersBreakdown',
      'netSharePurchaseActivity',
    ],
  },
  {
    id: 'quoteSummary-insider',
    label: 'Insider holders & transactions',
    group: 'Insider',
    quoteSummary: ['insiderHolders', 'insiderTransactions'],
  },
  {
    id: 'quoteSummary-statements',
    label: 'Financial statement history (quoteSummary)',
    group: 'Financials',
    quoteSummary: [
      'incomeStatementHistory',
      'incomeStatementHistoryQuarterly',
      'balanceSheetHistory',
      'balanceSheetHistoryQuarterly',
      'cashflowStatementHistory',
      'cashflowStatementHistoryQuarterly',
    ],
  },
  {
    id: 'quoteSummary-filings',
    label: 'SEC filings & trends (Yahoo)',
    group: 'Filings & Trends',
    quoteSummary: ['secFilings', 'indexTrend', 'sectorTrend', 'industryTrend'],
  },
  {
    id: 'chart',
    label: 'Historical prices, dividends & splits',
    group: 'Historical',
  },
  {
    id: 'fundamentals-annual',
    label: 'Fundamentals time series (annual)',
    group: 'Financials',
  },
  {
    id: 'fundamentals-quarterly',
    label: 'Fundamentals time series (quarterly)',
    group: 'Financials',
  },
  {
    id: 'fundamentals-trailing',
    label: 'Fundamentals time series (trailing)',
    group: 'Financials',
  },
  {
    id: 'options',
    label: 'Options chain & expirations',
    group: 'Options',
  },
  {
    id: 'insights',
    label: 'Insights & reports',
    group: 'Insights',
  },
  {
    id: 'recommendationsBySymbol',
    label: 'Related / comparable tickers',
    group: 'Related',
  },
  {
    id: 'search',
    label: 'Search, news & research',
    group: 'News',
  },
]

function isEmptyPayload(value) {
  if (value == null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    if (!keys.length) return true
    // quoteSummary sometimes returns `{ maxAge: N }` with no real content
    if (keys.every((key) => value[key] == null || (typeof value[key] === 'object' && value[key] !== null && !Object.keys(value[key]).length))) {
      return keys.every((key) => {
        const v = value[key]
        if (v == null) return true
        if (typeof v === 'number' && key === 'maxAge') return true
        if (Array.isArray(v)) return v.length === 0
        if (typeof v === 'object') return Object.keys(v).length === 0
        return false
      })
    }
  }
  return false
}

function isExpectedUnavailable(error) {
  const message = String(error?.message || error || '').toLowerCase()
  // Equities don't have fund modules; Yahoo returns this as an error we treat as empty.
  return (
    message.includes('no fundamentals data found') ||
    message.includes('not found') ||
    message.includes('no data found') ||
    message.includes('quote not found')
  )
}

function statusFor(value, error) {
  if (error) {
    if (isExpectedUnavailable(error)) {
      return { status: 'empty', error: String(error.message || error), fetchedAt: new Date().toISOString() }
    }
    return { status: 'error', error: String(error.message || error), fetchedAt: new Date().toISOString() }
  }
  if (isEmptyPayload(value)) return { status: 'empty', fetchedAt: new Date().toISOString() }
  return { status: 'success', fetchedAt: new Date().toISOString() }
}

async function safeCall(label, fn) {
  try {
    const data = await fn()
    return { data, error: null }
  } catch (error) {
    return { data: null, error }
  }
}

async function fetchQuoteSummaryBatch(symbol, modules) {
  const { data, error } = await safeCall('quoteSummary', () =>
    yahooFinance.quoteSummary(symbol, { modules }, { validateResult: false }),
  )
  if (error) {
    // Fall back to per-module so one bad submodule doesn't kill the batch.
    const parts = {}
    const statuses = {}
    for (const module of modules) {
      const single = await safeCall(module, () =>
        yahooFinance.quoteSummary(symbol, { modules: [module] }, { validateResult: false }),
      )
      const payload = single.data?.[module] ?? single.data ?? null
      parts[module] = payload
      statuses[module] = statusFor(payload, single.error)
    }
    return { parts, statuses, batchError: error.message }
  }

  const parts = {}
  const statuses = {}
  for (const module of modules) {
    const payload = data?.[module] ?? null
    parts[module] = payload
    statuses[module] = statusFor(payload, null)
  }
  return { parts, statuses, batchError: null }
}

async function fetchRawQuoteSummaryModules(symbol, modules) {
  const parts = {}
  const statuses = {}
  // Shared crumb client accepts modules the yahoo-finance2 schema rejects.
  const { data, error } = await safeCall('rawQuoteSummary', () => fetchYahooQuoteSummary(symbol, modules))
  if (error) {
    for (const module of modules) {
      const single = await safeCall(module, () => fetchYahooQuoteSummary(symbol, [module]))
      parts[module] = single.data?.[module] ?? null
      statuses[module] = statusFor(parts[module], single.error)
    }
    return { parts, statuses }
  }
  for (const module of modules) {
    parts[module] = data?.[module] ?? null
    statuses[module] = statusFor(parts[module], null)
  }
  return { parts, statuses }
}

export async function fetchUnit(ticker, unitId) {
  const symbol = toYahooSymbol(ticker)
  const unit = FETCH_UNITS.find((entry) => entry.id === unitId)
  if (!unit) throw new Error(`Unknown Yahoo module unit: ${unitId}`)

  if (unit.quoteSummary) {
    const { parts, statuses } = await fetchQuoteSummaryBatch(symbol, unit.quoteSummary)
    return {
      unitId: unit.id,
      label: unit.label,
      group: unit.group,
      raw: parts,
      moduleStatus: statuses,
      status: Object.values(statuses).some((s) => s.status === 'success')
        ? 'success'
        : Object.values(statuses).every((s) => s.status === 'empty')
          ? 'empty'
          : 'error',
    }
  }

  if (unit.rawQuoteSummary) {
    const { parts, statuses } = await fetchRawQuoteSummaryModules(symbol, unit.rawQuoteSummary)
    return {
      unitId: unit.id,
      label: unit.label,
      group: unit.group,
      raw: parts,
      moduleStatus: statuses,
      status: Object.values(statuses).some((s) => s.status === 'success')
        ? 'success'
        : Object.values(statuses).every((s) => s.status === 'empty')
          ? 'empty'
          : 'error',
    }
  }

  if (unit.id === 'quote') {
    const { data, error } = await safeCall('quote', () =>
      yahooFinance.quote(symbol, {}, { validateResult: false }),
    )
    return {
      unitId: unit.id,
      label: unit.label,
      group: unit.group,
      raw: { quote: data },
      moduleStatus: { quote: statusFor(data, error) },
      status: error ? 'error' : isEmptyPayload(data) ? 'empty' : 'success',
      error: error ? String(error.message || error) : undefined,
    }
  }

  if (unit.id === 'chart') {
    // ~10y daily history with dividend + split events when Yahoo provides them.
    const period1 = new Date()
    period1.setFullYear(period1.getFullYear() - 10)
    const { data, error } = await safeCall('chart', () =>
      yahooFinance.chart(
        symbol,
        { period1, interval: '1d', events: 'div|split|earn' },
        { validateResult: false },
      ),
    )
    return {
      unitId: unit.id,
      label: unit.label,
      group: unit.group,
      raw: { chart: data },
      moduleStatus: { chart: statusFor(data, error) },
      status: error ? 'error' : isEmptyPayload(data) ? 'empty' : 'success',
      error: error ? String(error.message || error) : undefined,
    }
  }

  if (unit.id === 'fundamentals-annual' || unit.id === 'fundamentals-quarterly' || unit.id === 'fundamentals-trailing') {
    const type = unit.id.replace('fundamentals-', '')
    const period1 = type === 'trailing' ? '2018-01-01' : '2010-01-01'
    const key = `fundamentalsTimeSeries_${type}`
    const { data, error } = await safeCall(key, () =>
      yahooFinance.fundamentalsTimeSeries(
        symbol,
        { period1, type, module: 'all' },
        { validateResult: false },
      ),
    )
    return {
      unitId: unit.id,
      label: unit.label,
      group: unit.group,
      raw: { [key]: data },
      moduleStatus: { [key]: statusFor(data, error) },
      status: error ? 'error' : isEmptyPayload(data) ? 'empty' : 'success',
      error: error ? String(error.message || error) : undefined,
    }
  }

  if (unit.id === 'options') {
    const { data, error } = await safeCall('options', () =>
      yahooFinance.options(symbol, {}, { validateResult: false }),
    )
    return {
      unitId: unit.id,
      label: unit.label,
      group: unit.group,
      raw: { options: data },
      moduleStatus: { options: statusFor(data, error) },
      status: error ? 'error' : isEmptyPayload(data) ? 'empty' : 'success',
      error: error ? String(error.message || error) : undefined,
    }
  }

  if (unit.id === 'insights') {
    const { data, error } = await safeCall('insights', () =>
      yahooFinance.insights(symbol, {}, { validateResult: false }),
    )
    return {
      unitId: unit.id,
      label: unit.label,
      group: unit.group,
      raw: { insights: data },
      moduleStatus: { insights: statusFor(data, error) },
      status: error ? 'error' : isEmptyPayload(data) ? 'empty' : 'success',
      error: error ? String(error.message || error) : undefined,
    }
  }

  if (unit.id === 'recommendationsBySymbol') {
    const { data, error } = await safeCall('recommendationsBySymbol', () =>
      yahooFinance.recommendationsBySymbol(symbol, {}, { validateResult: false }),
    )
    return {
      unitId: unit.id,
      label: unit.label,
      group: unit.group,
      raw: { recommendationsBySymbol: data },
      moduleStatus: { recommendationsBySymbol: statusFor(data, error) },
      status: error ? 'error' : isEmptyPayload(data) ? 'empty' : 'success',
      error: error ? String(error.message || error) : undefined,
    }
  }

  if (unit.id === 'search') {
    const { data, error } = await safeCall('search', () =>
      yahooFinance.search(symbol, { newsCount: 25, quotesCount: 10 }, { validateResult: false }),
    )
    return {
      unitId: unit.id,
      label: unit.label,
      group: unit.group,
      raw: { search: data },
      moduleStatus: { search: statusFor(data, error) },
      status: error ? 'error' : isEmptyPayload(data) ? 'empty' : 'success',
      error: error ? String(error.message || error) : undefined,
    }
  }

  throw new Error(`Unhandled Yahoo module unit: ${unitId}`)
}

// Serialise Deep Date objects and BigInt-like edge cases so the payload is
// always plain JSON for Supabase + the browser.
export function toPlainJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, current) => {
      if (typeof current === 'bigint') return current.toString()
      if (current instanceof Date) return current.toISOString()
      if (typeof current === 'number' && !Number.isFinite(current)) return null
      return current
    }),
  )
}

export async function fetchAllYahooModules(ticker, { onUnit } = {}) {
  const symbol = toYahooSymbol(ticker)
  const raw = {}
  const moduleStatus = {}
  const unitResults = []

  // Keep concurrency modest to reduce Yahoo rate-limit risk.
  const concurrency = 3
  const queue = [...FETCH_UNITS]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const unit = queue.shift()
      if (!unit) return
      let result
      try {
        result = await fetchUnit(ticker, unit.id)
      } catch (error) {
        result = {
          unitId: unit.id,
          label: unit.label,
          group: unit.group,
          raw: {},
          moduleStatus: { [unit.id]: statusFor(null, error) },
          status: 'error',
          error: String(error.message || error),
        }
      }

      Object.assign(raw, result.raw || {})
      Object.assign(moduleStatus, result.moduleStatus || {})
      unitResults.push({
        unitId: result.unitId,
        label: result.label,
        group: result.group,
        status: result.status,
        error: result.error,
        modules: result.moduleStatus,
      })
      if (typeof onUnit === 'function') onUnit(result)
    }
  })

  await Promise.all(workers)

  const plainRaw = toPlainJson(raw)
  const structured = buildStructuredView(symbol, plainRaw)

  return {
    ticker: String(ticker || '').trim().toUpperCase(),
    symbol,
    source: 'yahoo-finance',
    fetchedAt: new Date().toISOString(),
    data: structured,
    raw_json: plainRaw,
    module_status: moduleStatus,
    units: unitResults.sort((a, b) => a.unitId.localeCompare(b.unitId)),
  }
}

// Pull a few commonly displayed scalars into a stable shape for the UI.
// The full payload always lives in raw_json — this never drops fields.
function yahooRaw(value) {
  if (value == null) return null
  if (typeof value === 'object' && 'raw' in value) {
    const raw = value.raw
    return Number.isFinite(raw) ? raw : value.fmt ?? null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return value
}

function buildStructuredView(symbol, raw) {
  const quote = raw.quote || {}
  const price = raw.price || {}
  const profile = raw.assetProfile || raw.summaryProfile || {}
  const summary = raw.summaryDetail || {}
  const stats = raw.defaultKeyStatistics || {}
  const financial = raw.financialData || {}
  const quoteType = raw.quoteType || {}
  const quoteTypeStr =
    quoteType.quoteType || price.quoteType || quote.quoteType || stats.quoteType || null
  const fundProfile = raw.fundProfile || null
  const topHoldings = raw.topHoldings || null
  const fundPerformance = raw.fundPerformance || null
  const isFund =
    ['ETF', 'MUTUALFUND', 'MONEYMARKET'].includes(String(quoteTypeStr || '').toUpperCase()) ||
    Boolean(fundProfile && (fundProfile.legalType || fundProfile.family || fundProfile.categoryName)) ||
    Boolean(topHoldings && Array.isArray(topHoldings.holdings) && topHoldings.holdings.length)

  return {
    symbol,
    companyName: price.longName || price.shortName || quote.longName || quote.shortName || quoteType.longName || null,
    exchange: price.exchangeName || quote.fullExchangeName || quote.exchange || quoteType.exchange || null,
    currency: price.currency || quote.currency || summary.currency || null,
    quoteType: quoteTypeStr,
    quoteTypeDetail: quoteType,
    isEtf: String(quoteTypeStr || '').toUpperCase() === 'ETF',
    isFund,
    quote: {
      regularMarketPrice: yahooRaw(quote.regularMarketPrice) ?? yahooRaw(price.regularMarketPrice),
      regularMarketChange: yahooRaw(quote.regularMarketChange) ?? yahooRaw(price.regularMarketChange),
      regularMarketChangePercent:
        yahooRaw(quote.regularMarketChangePercent) ?? yahooRaw(price.regularMarketChangePercent),
      regularMarketVolume: yahooRaw(quote.regularMarketVolume) ?? yahooRaw(price.regularMarketVolume),
      regularMarketDayHigh: yahooRaw(quote.regularMarketDayHigh) ?? yahooRaw(price.regularMarketDayHigh),
      regularMarketDayLow: yahooRaw(quote.regularMarketDayLow) ?? yahooRaw(price.regularMarketDayLow),
      regularMarketOpen: yahooRaw(quote.regularMarketOpen) ?? yahooRaw(price.regularMarketOpen),
      regularMarketPreviousClose:
        yahooRaw(quote.regularMarketPreviousClose) ?? yahooRaw(price.regularMarketPreviousClose),
      marketCap: yahooRaw(quote.marketCap) ?? yahooRaw(price.marketCap) ?? yahooRaw(summary.marketCap),
      fiftyTwoWeekLow: yahooRaw(quote.fiftyTwoWeekLow) ?? yahooRaw(summary.fiftyTwoWeekLow),
      fiftyTwoWeekHigh: yahooRaw(quote.fiftyTwoWeekHigh) ?? yahooRaw(summary.fiftyTwoWeekHigh),
      averageDailyVolume3Month: yahooRaw(quote.averageDailyVolume3Month) ?? yahooRaw(summary.averageVolume),
      bid: yahooRaw(quote.bid) ?? yahooRaw(summary.bid),
      ask: yahooRaw(quote.ask) ?? yahooRaw(summary.ask),
      trailingPE: yahooRaw(quote.trailingPE) ?? yahooRaw(summary.trailingPE),
      forwardPE: yahooRaw(quote.forwardPE) ?? yahooRaw(summary.forwardPE),
      dividendYield: yahooRaw(quote.dividendYield) ?? yahooRaw(summary.dividendYield),
    },
    profile: {
      sector: profile.sector || null,
      industry: profile.industry || null,
      website: profile.website || null,
      longBusinessSummary: profile.longBusinessSummary || null,
      fullTimeEmployees: yahooRaw(profile.fullTimeEmployees),
      city: profile.city || null,
      state: profile.state || null,
      country: profile.country || null,
      phone: profile.phone || null,
      address1: profile.address1 || null,
      zip: profile.zip || null,
      companyOfficers: Array.isArray(profile.companyOfficers) ? profile.companyOfficers : [],
    },
    valuation: {
      enterpriseValue: yahooRaw(stats.enterpriseValue),
      trailingPE: yahooRaw(summary.trailingPE) ?? yahooRaw(stats.trailingPE),
      forwardPE: yahooRaw(summary.forwardPE) ?? yahooRaw(stats.forwardPE),
      pegRatio: yahooRaw(stats.pegRatio),
      priceToBook: yahooRaw(stats.priceToBook),
      priceToSalesTrailing12Months: yahooRaw(summary.priceToSalesTrailing12Months),
      enterpriseToRevenue: yahooRaw(stats.enterpriseToRevenue),
      enterpriseToEbitda: yahooRaw(stats.enterpriseToEbitda),
      bookValue: yahooRaw(stats.bookValue),
    },
    profitability: {
      profitMargins: yahooRaw(stats.profitMargins) ?? yahooRaw(financial.profitMargins),
      operatingMargins: yahooRaw(financial.operatingMargins),
      grossMargins: yahooRaw(financial.grossMargins),
      ebitdaMargins: yahooRaw(financial.ebitdaMargins),
      returnOnAssets: yahooRaw(financial.returnOnAssets),
      returnOnEquity: yahooRaw(financial.returnOnEquity),
      revenueGrowth: yahooRaw(financial.revenueGrowth),
      earningsGrowth: yahooRaw(financial.earningsGrowth),
      earningsQuarterlyGrowth: yahooRaw(stats.earningsQuarterlyGrowth),
    },
    financialData: financial,
    defaultKeyStatistics: stats,
    summaryDetail: summary,
    calendarEvents: raw.calendarEvents || null,
    earnings: raw.earnings || null,
    earningsHistory: raw.earningsHistory || null,
    earningsTrend: raw.earningsTrend || null,
    recommendationTrend: raw.recommendationTrend || null,
    upgradeDowngradeHistory: raw.upgradeDowngradeHistory || null,
    priceTargets: {
      targetLow: yahooRaw(financial.targetLowPrice),
      targetMean: yahooRaw(financial.targetMeanPrice),
      targetMedian: yahooRaw(financial.targetMedianPrice),
      targetHigh: yahooRaw(financial.targetHighPrice),
      numberOfAnalystOpinions: yahooRaw(financial.numberOfAnalystOpinions),
      recommendationKey: financial.recommendationKey || null,
      recommendationMean: yahooRaw(financial.recommendationMean),
    },
    ownership: {
      majorHoldersBreakdown: raw.majorHoldersBreakdown || null,
      institutionOwnership: raw.institutionOwnership || null,
      fundOwnership: raw.fundOwnership || null,
      majorDirectHolders: raw.majorDirectHolders || null,
      netSharePurchaseActivity: raw.netSharePurchaseActivity || null,
    },
    insider: {
      insiderHolders: raw.insiderHolders || null,
      insiderTransactions: raw.insiderTransactions || null,
      // Also available under ownership — duplicated here so the Insider tab
      // can render Net Share Purchase Activity without hopping tabs.
      netSharePurchaseActivity: raw.netSharePurchaseActivity || null,
    },
    statements: {
      incomeStatementHistory: raw.incomeStatementHistory || null,
      incomeStatementHistoryQuarterly: raw.incomeStatementHistoryQuarterly || null,
      balanceSheetHistory: raw.balanceSheetHistory || null,
      balanceSheetHistoryQuarterly: raw.balanceSheetHistoryQuarterly || null,
      cashflowStatementHistory: raw.cashflowStatementHistory || null,
      cashflowStatementHistoryQuarterly: raw.cashflowStatementHistoryQuarterly || null,
      fundamentalsTimeSeries_annual: raw.fundamentalsTimeSeries_annual || null,
      fundamentalsTimeSeries_quarterly: raw.fundamentalsTimeSeries_quarterly || null,
      fundamentalsTimeSeries_trailing: raw.fundamentalsTimeSeries_trailing || null,
    },
    chart: raw.chart || null,
    options: raw.options || null,
    insights: raw.insights || null,
    recommendationsBySymbol: raw.recommendationsBySymbol || null,
    search: raw.search || null,
    secFilings: raw.secFilings || null,
    trends: {
      indexTrend: raw.indexTrend || null,
      sectorTrend: raw.sectorTrend || null,
      industryTrend: raw.industryTrend || null,
    },
    // ETF / mutual fund modules — null / empty for equities.
    fund: {
      profile: fundProfile,
      topHoldings,
      performance: fundPerformance,
      // Convenience scalars also present on stats / summary for ETFs.
      category: stats.category || fundProfile?.categoryName || null,
      family: stats.fundFamily || fundProfile?.family || null,
      legalType: stats.legalType || fundProfile?.legalType || null,
      totalAssets: yahooRaw(stats.totalAssets) ?? yahooRaw(summary.totalAssets),
      yield: yahooRaw(stats.yield) ?? yahooRaw(summary.yield),
      ytdReturn: yahooRaw(stats.ytdReturn),
      threeYearAverageReturn: yahooRaw(stats.threeYearAverageReturn),
      fiveYearAverageReturn: yahooRaw(stats.fiveYearAverageReturn),
      beta3Year: yahooRaw(stats.beta3Year),
      navPrice: yahooRaw(summary.navPrice),
      fundInceptionDate: stats.fundInceptionDate || null,
    },
  }
}

export function listModuleCatalogue() {
  return FETCH_UNITS.map((unit) => ({
    id: unit.id,
    label: unit.label,
    group: unit.group,
    quoteSummary: unit.quoteSummary || null,
    rawQuoteSummary: unit.rawQuoteSummary || null,
  }))
}
