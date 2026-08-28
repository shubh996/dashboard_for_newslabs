import { apiUrl } from '@/lib/apiBase'
import type {
  YahooSavedSnapshot,
  YahooSearchResults,
  YahooTickerBundle,
  YahooUnitCatalogueItem,
  YahooUnitProgress,
} from '@/types/yahoo'

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const msg =
      (body && typeof body === 'object' && typeof (body as { error?: string }).error === 'string'
        ? (body as { error: string }).error
        : null) || `Request failed: ${response.status} ${response.statusText || ''}`.trim()
    const err = new Error(`${msg} · ${url}`)
    // Attach extra fields for callers that inspect the error object
    Object.assign(err, {
      status: response.status,
      statusText: response.statusText,
      url,
      body,
    })
    throw err
  }
  return body as T
}

async function getJsonOrNull<T>(url: string): Promise<T | null> {
  const response = await fetch(url)
  // Missing snapshot: server returns 200 + null (preferred) or legacy 404.
  if (response.status === 404 || response.status === 204) return null
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const errBody = body && typeof body === 'object' ? (body as { error?: string }) : null
    throw new Error(errBody?.error || `Request failed: ${url}`)
  }
  if (body == null) return null
  return body as T
}

export function listYahooModules() {
  return getJson<{ source: string; units: YahooUnitCatalogueItem[] }>('/api/yahoo/modules')
}

export function fetchYahooUnit(ticker: string, unitId: string) {
  return getJson<{ ticker: string; symbol: string; source: string; unit: YahooUnitProgress & { raw: Record<string, unknown> } }>(
    `/api/yahoo/${encodeURIComponent(ticker)}/unit/${encodeURIComponent(unitId)}`,
  )
}

export function fetchYahooFull(ticker: string) {
  return getJson<YahooTickerBundle>(`/api/yahoo/${encodeURIComponent(ticker)}/full`)
}

export type YahooChartRange =
  | '1d'
  | '5d'
  | '1mo'
  | '3mo'
  | '6mo'
  | 'ytd'
  | '1y'
  | '5y'
  | '10y'
  | 'max'

/** Yahoo Finance bar sizes supported by chart(). */
export type YahooChartInterval =
  | '1m'
  | '2m'
  | '5m'
  | '15m'
  | '30m'
  | '60m'
  | '90m'
  | '1h'
  | '1d'
  | '5d'
  | '1wk'
  | '1mo'
  | '3mo'

/** Default + selectable bar sizes per range (Yahoo-style). */
export const CHART_INTERVAL_BY_RANGE: Record<
  YahooChartRange,
  { default: YahooChartInterval; options: YahooChartInterval[] }
> = {
  '1d': { default: '1m', options: ['1m', '2m', '5m'] },
  '5d': { default: '15m', options: ['1m', '2m', '5m', '15m', '30m', '60m', '1h'] },
  '1mo': { default: '1h', options: ['15m', '30m', '60m', '1h', '1d'] },
  '3mo': { default: '1d', options: ['1h', '1d'] },
  '6mo': { default: '1d', options: ['1d', '1wk'] },
  ytd: { default: '1d', options: ['1d', '1wk'] },
  '1y': { default: '1d', options: ['1d', '1wk'] },
  '5y': { default: '1wk', options: ['1d', '1wk', '1mo'] },
  '10y': { default: '1wk', options: ['1d', '1wk', '1mo'] },
  max: { default: '1mo', options: ['1wk', '1mo'] },
}

export function fetchYahooChart(
  ticker: string,
  range: YahooChartRange = '1y',
  interval?: YahooChartInterval | string,
) {
  const params = new URLSearchParams({ range })
  if (interval) params.set('interval', interval)
  return getJson<{
    ticker: string
    symbol: string
    range: YahooChartRange
    interval: string
    includePrePost?: boolean
    allowedIntervals?: string[]
    chart: unknown
    source: 'yahoo-finance'
  }>(`/api/yahoo/${encodeURIComponent(ticker)}/chart?${params.toString()}`)
}

/**
 * Live quote from /api/yahoo. Extended hours:
 * - No overnightMarket* fields — overnight is postMarket* when marketState=PREPRE
 * - PRE → preMarket*; POST/POSTPOST → postMarket* (after-hours); REGULAR → regularMarket*
 */
export type YahooLiveQuote = {
  symbol: string
  shortName: string | null
  longName?: string | null
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  regularMarketPreviousClose: number | null
  regularMarketTime?: string | null
  preMarketPrice?: number | null
  preMarketChange?: number | null
  preMarketChangePercent?: number | null
  preMarketTime?: string | null
  /** After-hours AND overnight (when marketState is PREPRE) */
  postMarketPrice?: number | null
  postMarketChange?: number | null
  postMarketChangePercent?: number | null
  postMarketTime?: string | null
  hasPrePostMarketData?: boolean | null
  currency: string | null
  /**
   * PREPRE=Overnight(post*), PRE=pre*, REGULAR=reg*, POST/POSTPOST=AH(post*), CLOSED=at close
   */
  marketState: string | null
  exchange: string | null
  /** Yahoo IANA zone for the listing (e.g. America/New_York, Europe/London). */
  exchangeTimezoneName?: string | null
  liveSource?: 'yahoo-streamer' | 'yahoo-quote' | string | null
  streamReceivedAt?: string | null
  website?: string | null
  logoUrl?: string | null
}

/** Resolve a display logo even if the API omits logoUrl (stale server / missing field). */
export function resolveYahooLogoUrl(quote: YahooLiveQuote | null | undefined, symbol: string): string | null {
  if (quote?.logoUrl) return quote.logoUrl
  if (quote?.website) {
    try {
      const host = new URL(quote.website).hostname.replace(/^www\./, '')
      if (host) return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`
    } catch {
      /* ignore */
    }
  }
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '')
  return clean ? `https://storage.googleapis.com/iex/api/logos/${clean}.png` : null
}

export function fetchYahooQuote(ticker: string) {
  return getJson<{
    ticker: string
    symbol: string
    source: 'yahoo-finance'
    quote: YahooLiveQuote
  }>(`/api/yahoo/${encodeURIComponent(ticker)}/quote`)
}

/** Company fundamentals for detail header (market cap, about, sector, …). */
export type YahooCompanyProfile = {
  shortName?: string | null
  longName?: string | null
  marketCap: number | null
  currency?: string | null
  sector?: string | null
  industry?: string | null
  website?: string | null
  fullTimeEmployees?: number | null
  city?: string | null
  state?: string | null
  country?: string | null
  founded?: string | null
  ceo?: string | null
  ceoTitle?: string | null
  about?: string | null
  exchange?: string | null
}

export function fetchYahooCompanyProfile(ticker: string, signal?: AbortSignal) {
  return getJson<{
    ok?: boolean
    ticker: string
    symbol: string
    source: 'yahoo-finance'
    profile: YahooCompanyProfile
  }>(`/api/yahoo/${encodeURIComponent(ticker)}/profile`, {
    cache: 'no-store',
    signal,
  })
}

/** One lightweight Yahoo request for live prices across a ticker list. */
export async function fetchYahooQuotes(tickers: string[], signal?: AbortSignal) {
  const clean = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))]
  if (!clean.length) {
    return {
      source: 'yahoo-finance' as const,
      fetchedAt: new Date().toISOString(),
      quotes: {} as Record<string, YahooLiveQuote>,
    }
  }

  type YahooQuotesBatch = {
    source: 'yahoo-finance'
    fetchedAt: string
    quotes: Record<string, YahooLiveQuote>
  }

  const batches: string[][] = []
  for (let index = 0; index < clean.length; index += 80) {
    batches.push(clean.slice(index, index + 80))
  }

  const results = await Promise.all(
    batches.map((batch) => {
      const params = new URLSearchParams({ tickers: batch.join(',') })
      return getJson<YahooQuotesBatch>(`/api/yahoo/quotes?${params}`, {
        cache: 'no-store',
        signal,
      })
    }),
  )

  return {
    source: 'yahoo-finance' as const,
    fetchedAt: results.reduce(
      (latest, result) => (result.fetchedAt > latest ? result.fetchedAt : latest),
      results[0]?.fetchedAt || new Date().toISOString(),
    ),
    quotes: Object.assign({}, ...results.map((result) => result.quotes)),
  }
}

export function getSavedYahooTicker(ticker: string) {
  return getJsonOrNull<YahooSavedSnapshot>(`/api/yahoo/${encodeURIComponent(ticker)}/saved`)
}

/** Batch lookup — which tickers already have a yahoo_finance_snapshots row. */
export async function getSavedYahooTickerMap(tickers: string[]): Promise<Record<string, boolean>> {
  const clean = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 80)
  if (!clean.length) return {}
  const params = new URLSearchParams({ tickers: clean.join(',') })
  const body = await getJson<{ saved?: Record<string, boolean> }>(`/api/yahoo/saved-status?${params}`)
  return body.saved ?? {}
}

export function searchYahooSaved(query: string) {
  return getJson<YahooSearchResults>(`/api/yahoo/search?q=${encodeURIComponent(query)}`)
}

/** One row from Yahoo day_gainers / day_losers (filtered for large moves + size). */
export type YahooExtremeMover = {
  ticker: string
  symbol: string
  company_name: string
  long_name?: string | null
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number
  marketCap: number | null
  currency?: string | null
  exchange?: string | null
  marketState?: string | null
  quoteType?: string | null
  direction?: 'up' | 'down' | 'flat'
}

export type YahooExtremeMoversResponse = {
  ok?: boolean
  source: 'yahoo-finance'
  screener?: string[]
  minPercent: number
  minMarketCap: number
  fetchedAt: string
  count: number
  movers: YahooExtremeMover[]
}

export type YahooMostActiveItem = {
  ticker: string
  symbol: string
  label: string
  longName?: string | null
  assetClass: string
  volume: number
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  currency?: string | null
  exchange?: string | null
  marketState?: string | null
  quoteType?: string | null
}

export type YahooMostActivesResponse = {
  ok?: boolean
  source: 'yahoo-finance'
  class: string
  screener?: string | null
  fetchedAt: string
  count: number
  items: YahooMostActiveItem[]
}

/** Most-active names for a momentum asset-class tab. */
export function fetchYahooMostActives(
  assetClass: string,
  options?: { count?: number; list?: string; signal?: AbortSignal },
) {
  const params = new URLSearchParams({ class: assetClass })
  if (options?.count != null) params.set('count', String(options.count))
  if (options?.list) params.set('list', options.list)
  return getJson<YahooMostActivesResponse>(`/api/yahoo/market-lists?${params}`, {
    cache: 'no-store',
    signal: options?.signal,
  })
}

export type YahooSavedTickerItem = {
  ticker: string
  label: string
  assetClass: string
  updatedAt?: string | null
  source?: string
}

export function fetchYahooSavedTickers(signal?: AbortSignal) {
  return getJson<{
    ok?: boolean
    table?: string
    count?: number
    items: YahooSavedTickerItem[]
  }>('/api/yahoo/saved-tickers', { cache: 'no-store', signal })
}

/**
 * Trigger-app monitored tickers (device_monitor with enabled subscribers).
 * This is the dashboard Watchlist source of truth — not the research table.
 */
export type MomentumMonitoredTickerItem = {
  ticker: string
  label: string
  assetClass: string
  subscriberCount?: number
  updatedAt?: string | null
  source?: string
  table?: string
}

export function fetchMomentumMonitoredTickers(options?: {
  assetClass?: string
  app?: string
  signal?: AbortSignal
}) {
  const params = new URLSearchParams()
  if (options?.assetClass) params.set('assetClass', String(options.assetClass))
  if (options?.app) params.set('app', String(options.app))
  const qs = params.toString()
  return getJson<{
    ok?: boolean
    table?: string
    app?: string
    assetClass?: string
    count?: number
    byClass?: Record<string, number>
    items: MomentumMonitoredTickerItem[]
    error?: string
  }>(`/api/momentum/monitored-tickers${qs ? `?${qs}` : ''}`, {
    cache: 'no-store',
    signal: options?.signal,
  })
}

/** Big equities with extreme same-day % moves (default ≥10%, market cap ≥ $1B). */
export function fetchYahooExtremeMovers(options?: {
  minPercent?: number
  minMarketCap?: number
  count?: number
  signal?: AbortSignal
}) {
  const params = new URLSearchParams()
  if (options?.minPercent != null) params.set('minPercent', String(options.minPercent))
  if (options?.minMarketCap != null) params.set('minMarketCap', String(options.minMarketCap))
  if (options?.count != null) params.set('count', String(options.count))
  const qs = params.toString()
  return getJson<YahooExtremeMoversResponse>(
    `/api/yahoo/extreme-movers${qs ? `?${qs}` : ''}`,
    { cache: 'no-store', signal: options?.signal },
  )
}

export async function saveYahooSnapshot(
  ticker: string,
  payload: {
    data: unknown
    rawJson: unknown
    moduleStatus: unknown
    sourceMetadata?: Record<string, unknown>
  },
) {
  const response = await fetch(`/api/yahoo/${encodeURIComponent(ticker)}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error || 'Failed to save Yahoo Finance snapshot')
  }
  return body.snapshot as YahooSavedSnapshot
}

export async function refreshYahooSnapshot(ticker: string) {
  const response = await fetch(`/api/yahoo/${encodeURIComponent(ticker)}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error || 'Failed to refresh Yahoo Finance snapshot')
  }
  return body as { ok: boolean; bundle: YahooTickerBundle; snapshot: YahooSavedSnapshot }
}

export type YahooStreamHandlers = {
  onStart?: (payload: { ticker: string; symbol: string; units: YahooUnitCatalogueItem[]; source: string }) => void
  onUnit?: (payload: YahooUnitProgress & { raw?: Record<string, unknown> }) => void
  onComplete?: (bundle: YahooTickerBundle) => void
  onError?: (message: string) => void
}

// Server-Sent Events stream — one event per module unit for live progress.
// Use apiUrl() so Cloudflare Pages hits the Railway API (EventSource is not
// covered by the window.fetch rewrite in main.tsx).
export function streamYahooTicker(ticker: string, handlers: YahooStreamHandlers): () => void {
  const source = new EventSource(
    apiUrl(`/api/yahoo/${encodeURIComponent(ticker)}/stream`),
  )

  source.addEventListener('start', (event) => {
    try {
      handlers.onStart?.(JSON.parse((event as MessageEvent).data))
    } catch {
      /* ignore malformed */
    }
  })

  source.addEventListener('unit', (event) => {
    try {
      handlers.onUnit?.(JSON.parse((event as MessageEvent).data))
    } catch {
      /* ignore malformed */
    }
  })

  source.addEventListener('complete', (event) => {
    try {
      handlers.onComplete?.(JSON.parse((event as MessageEvent).data))
    } catch {
      /* ignore malformed */
    }
  })

  source.addEventListener('error', (event) => {
    // EventSource also fires a generic error on connection issues.
    if (event instanceof MessageEvent && event.data) {
      try {
        const body = JSON.parse(event.data)
        handlers.onError?.(body.error || 'Yahoo Finance stream failed')
      } catch {
        handlers.onError?.('Yahoo Finance stream failed')
      }
    }
  })

  source.addEventListener('done', () => {
    source.close()
  })

  source.onerror = () => {
    // Closed after done is normal; only surface if still OPEN failed.
    if (source.readyState === EventSource.CLOSED) return
    handlers.onError?.('Yahoo Finance stream connection error')
    source.close()
  }

  return () => source.close()
}
