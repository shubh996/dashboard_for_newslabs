import { useEffect, useState } from 'react'
import { searchSaved } from '@/services/edgarApi'
import type { SearchResults } from '@/types/edgar'

const emptyResults: SearchResults = { tickers: [], institutions: [], etfs: [], politicians: [] }

// A 13F filing's info table has no ticker field at all (only issuer name +
// CUSIP) -- when SEC's own ticker map can't resolve a name either, this is
// the fallback: match the issuer name directly against the company name
// already stored in each saved ticker's snapshot (`profile.name`). Mirrors
// the suffix-stripping normalizeName() on the backend (institutionalHoldings.js).
function normalizeCompanyName(text: string) {
  let cleaned = text
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toUpperCase()
    .trim()
  for (const suffix of [' INCORPORATED', ' CORPORATION', ' COMPANY', ' INC', ' CORP', ' CO', ' LTD', ' PLC', ' LLC', ' LP']) {
    if (cleaned.endsWith(suffix)) cleaned = cleaned.slice(0, -suffix.length)
  }
  return cleaned.trim()
}

// Module-level pub/sub cache -- every component that wants to know "is this
// ticker/manager/politician already saved to Supabase" shares ONE fetch and
// re-renders together when any of them calls `refresh()`, instead of each
// mounting its own request (or, worse, re-fetching every time the user
// navigates back to a page that happens to render this hook).
let cache: SearchResults | null = null
let inflight: Promise<SearchResults> | null = null
const listeners = new Set<(data: SearchResults) => void>()

function load(force: boolean) {
  if (!force && cache) return Promise.resolve(cache)
  if (!force && inflight) return inflight
  inflight = searchSaved('')
    .then((data) => {
      cache = data
      inflight = null
      listeners.forEach((listener) => listener(data))
      return data
    })
    .catch((error: unknown) => {
      inflight = null
      throw error
    })
  return inflight
}

export function useSavedEntities() {
  const [data, setData] = useState<SearchResults>(cache ?? emptyResults)
  const [loading, setLoading] = useState(!cache)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const listener = (next: SearchResults) => setData(next)
    listeners.add(listener)
    if (!cache) {
      setLoading(true)
      load(false)
        .then(() => setError(null))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load saved data'))
        .finally(() => setLoading(false))
    }
    return () => {
      listeners.delete(listener)
    }
  }, [])

  function refresh() {
    setLoading(true)
    return load(true)
      .then(() => setError(null))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load saved data'))
      .finally(() => setLoading(false))
  }

  const savedTickers = new Set(data.tickers.map((item) => item.ticker?.toUpperCase()).filter(Boolean))
  const savedManagerCiks = new Set([...data.institutions, ...data.etfs].map((item) => Number(item.cik)))
  const savedManagerTimestamps = new Map(
    [...data.institutions, ...data.etfs].map((item) => [Number(item.cik), item.savedAt]),
  )
  const savedFilerIds = new Set(data.politicians.filter((item) => item.savedAt).map((item) => item.filerId))

  const savedCompanyNameToTicker = new Map<string, string>()
  for (const item of data.tickers) {
    if (item.ticker && item.companyName) savedCompanyNameToTicker.set(normalizeCompanyName(item.companyName), item.ticker.toUpperCase())
  }

  // Resolves the real saved ticker for a position -- tries the ticker symbol
  // first (the normal case), then falls back to matching the issuer's name
  // against a saved ticker's company name (for 13F rows where SEC's own
  // ticker map couldn't resolve a symbol at all). Returns null if neither matches.
  function resolveSavedTicker(ticker: string | null | undefined, issuerName?: string | null) {
    if (ticker && savedTickers.has(ticker.toUpperCase())) return ticker.toUpperCase()
    if (!ticker && issuerName) {
      const match = savedCompanyNameToTicker.get(normalizeCompanyName(issuerName))
      if (match) return match
    }
    return null
  }

  return {
    data,
    loading,
    error,
    refresh,
    isTickerSaved: (ticker: string | null | undefined) => (ticker ? savedTickers.has(ticker.toUpperCase()) : false),
    isManagerSaved: (cik: number | string | null | undefined) => (cik != null ? savedManagerCiks.has(Number(cik)) : false),
    getManagerSavedAt: (cik: number | string | null | undefined) => (cik != null ? (savedManagerTimestamps.get(Number(cik)) ?? null) : null),
    isPoliticianSaved: (filerId: string | null | undefined) => (filerId ? savedFilerIds.has(filerId) : false),
    resolveSavedTicker,
  }
}
