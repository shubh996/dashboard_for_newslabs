import type {
  YahooSavedSnapshot,
  YahooSearchResults,
  YahooTickerBundle,
  YahooUnitCatalogueItem,
  YahooUnitProgress,
} from '@/types/yahoo'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error || `Request failed: ${url}`)
  }
  return body as T
}

async function getJsonOrNull<T>(url: string): Promise<T | null> {
  const response = await fetch(url)
  if (response.status === 404) return null
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error || `Request failed: ${url}`)
  }
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

export type YahooChartRange = '1d' | '5d' | '1mo' | '3mo' | '6mo' | 'ytd' | '1y' | '5y' | 'max'

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
  '5d': { default: '15m', options: ['5m', '15m', '30m', '60m', '1h'] },
  '1mo': { default: '1h', options: ['15m', '30m', '60m', '1h', '1d'] },
  '3mo': { default: '1d', options: ['1h', '1d'] },
  '6mo': { default: '1d', options: ['1d', '1wk'] },
  ytd: { default: '1d', options: ['1d', '1wk'] },
  '1y': { default: '1d', options: ['1d', '1wk'] },
  '5y': { default: '1wk', options: ['1d', '1wk', '1mo'] },
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
    allowedIntervals?: string[]
    chart: unknown
    source: 'yahoo-finance'
  }>(`/api/yahoo/${encodeURIComponent(ticker)}/chart?${params.toString()}`)
}

export type YahooLiveQuote = {
  symbol: string
  shortName: string | null
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  regularMarketPreviousClose: number | null
  currency: string | null
  marketState: string | null
  exchange: string | null
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

export function getSavedYahooTicker(ticker: string) {
  return getJsonOrNull<YahooSavedSnapshot>(`/api/yahoo/${encodeURIComponent(ticker)}/saved`)
}

export function searchYahooSaved(query: string) {
  return getJson<YahooSearchResults>(`/api/yahoo/search?q=${encodeURIComponent(query)}`)
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
export function streamYahooTicker(ticker: string, handlers: YahooStreamHandlers): () => void {
  const source = new EventSource(`/api/yahoo/${encodeURIComponent(ticker)}/stream`)

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
