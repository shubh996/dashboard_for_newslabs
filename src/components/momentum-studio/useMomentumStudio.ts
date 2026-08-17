import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchMomentumMonitoredTickers,
  fetchYahooQuotes,
  resolveYahooLogoUrl,
  type YahooLiveQuote,
} from '@/services/yahooApi'
import { detectAssetClass } from './format'
import type {
  ActiveEpisodeRow,
  AssetClassId,
  StudioStatus,
  StudioTicker,
  StudioView,
} from './types'

export function useMomentumStudio() {
  const [view, setView] = useState<StudioView>('overview')
  const [assetClass, setAssetClass] = useState<AssetClassId>('equity')
  const [tickers, setTickers] = useState<StudioTicker[]>([])
  const [byClass, setByClass] = useState<Partial<Record<AssetClassId, number>>>(
    {},
  )
  const [listLoading, setListLoading] = useState(true)
  const [activeTicker, setActiveTicker] = useState('')
  const [status, setStatus] = useState<StudioStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [quotes, setQuotes] = useState<Record<string, YahooLiveQuote>>({})
  const [activeEpisodes, setActiveEpisodes] = useState<ActiveEpisodeRow[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [testModeEnabled, setTestModeEnabled] = useState(false)
  const [testModeSaving, setTestModeSaving] = useState(false)
  const [tickBusy, setTickBusy] = useState(false)

  const classTickers = useMemo(
    () => tickers.filter((t) => t.assetClass === assetClass),
    [tickers, assetClass],
  )

  const selected =
    classTickers.find(
      (t) => t.ticker.toUpperCase() === activeTicker.toUpperCase(),
    ) ||
    tickers.find(
      (t) => t.ticker.toUpperCase() === activeTicker.toUpperCase(),
    ) ||
    null

  const loadWatchlist = useCallback(async () => {
    setListLoading(true)
    try {
      const body = await fetchMomentumMonitoredTickers({ app: 'trigger' })
      const items: StudioTicker[] = (body.items || []).map((row) => {
        const ticker = String(row.ticker || '').trim().toUpperCase()
        const cls = (row.assetClass || detectAssetClass(ticker)) as AssetClassId
        return {
          ticker,
          label: String(row.label || ticker).trim() || ticker,
          assetClass: (
            ['equity', 'index', 'forex', 'crypto', 'commodity'] as const
          ).includes(cls)
            ? cls
            : 'equity',
          subscriberCount:
            row.subscriberCount != null &&
            Number.isFinite(Number(row.subscriberCount))
              ? Number(row.subscriberCount)
              : null,
        }
      })
      setTickers(items)
      setByClass(body.byClass || {})
      setActiveTicker((prev) => {
        if (prev && items.some((i) => i.ticker === prev)) return prev
        return items.find((i) => i.assetClass === 'equity')?.ticker ||
          items[0]?.ticker ||
          ''
      })
    } catch {
      setTickers([])
    } finally {
      setListLoading(false)
    }
  }, [])

  const loadStatus = useCallback(async (ticker: string) => {
    if (!ticker) return
    setStatusLoading(true)
    setStatusError(null)
    try {
      const res = await fetch(
        `/api/momentum/${encodeURIComponent(ticker)}?_=${Date.now()}`,
      )
      const body = (await res.json().catch(() => ({}))) as StudioStatus & {
        error?: string
      }
      if (!res.ok) throw new Error(body.error || `Status ${res.status}`)
      setStatus(body)
      if (typeof body.config?.testMode?.enabled === 'boolean') {
        setTestModeEnabled(body.config.testMode.enabled)
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const loadActiveEpisodes = useCallback(async () => {
    try {
      const res = await fetch(`/api/momentum/active-episodes?_=${Date.now()}`)
      const body = await res.json().catch(() => ({}))
      setActiveEpisodes(
        Array.isArray(body.activeEpisodes)
          ? (body.activeEpisodes as ActiveEpisodeRow[])
          : [],
      )
    } catch {
      /* keep */
    }
  }, [])

  useEffect(() => {
    void loadWatchlist()
    void fetch(`/api/momentum/test-mode?_=${Date.now()}`)
      .then((r) => r.json())
      .then((b) => {
        if (typeof b?.enabled === 'boolean') setTestModeEnabled(b.enabled)
      })
      .catch(() => {})
  }, [loadWatchlist])

  useEffect(() => {
    if (!activeTicker) return
    void loadStatus(activeTicker)
    const id = window.setInterval(() => void loadStatus(activeTicker), 20_000)
    return () => window.clearInterval(id)
  }, [activeTicker, loadStatus])

  useEffect(() => {
    void loadActiveEpisodes()
    const id = window.setInterval(() => void loadActiveEpisodes(), 30_000)
    return () => window.clearInterval(id)
  }, [loadActiveEpisodes])

  useEffect(() => {
    if (!classTickers.length) return
    const ac = new AbortController()
    void fetchYahooQuotes(
      classTickers.map((t) => t.ticker),
      ac.signal,
    )
      .then((body) => {
        const next: Record<string, YahooLiveQuote> = {}
        const map = (body.quotes || {}) as Record<string, YahooLiveQuote>
        for (const [k, q] of Object.entries(map)) {
          if (!q || typeof q !== 'object') continue
          next[k.toUpperCase()] = q
          const sym = String(q.symbol || '').toUpperCase()
          if (sym) next[sym] = q
        }
        setQuotes((prev) => ({ ...prev, ...next }))
      })
      .catch(() => {})
    return () => ac.abort()
  }, [classTickers])

  async function toggleTestMode(next: boolean) {
    setTestModeSaving(true)
    try {
      const res = await fetch('/api/momentum/test-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed')
      setTestModeEnabled(
        typeof body.enabled === 'boolean' ? body.enabled : next,
      )
    } catch {
      /* keep */
    } finally {
      setTestModeSaving(false)
    }
  }

  async function runTick() {
    if (!activeTicker) return
    setTickBusy(true)
    try {
      await fetch(`/api/momentum/${encodeURIComponent(activeTicker)}/tick`, {
        method: 'POST',
      })
      await loadStatus(activeTicker)
      await loadActiveEpisodes()
    } finally {
      setTickBusy(false)
    }
  }

  const quote = quotes[activeTicker] || quotes[activeTicker.toUpperCase()]
  const snap = status?.snapshot
  const livePrice =
    snap?.sessionQuote?.live?.price ??
    snap?.currentPrice ??
    quote?.regularMarketPrice ??
    null
  const dayPct =
    snap?.sessionQuote?.live?.changePercent ??
    quote?.regularMarketChangePercent ??
    snap?.returns?.day ??
    null
  const episodeByTicker = useMemo(() => {
    const map: Record<string, ActiveEpisodeRow> = {}
    for (const row of activeEpisodes) {
      const t = String(row.ticker || '').toUpperCase()
      if (t) map[t] = row
    }
    return map
  }, [activeEpisodes])

  return {
    view,
    setView,
    assetClass,
    setAssetClass,
    tickers,
    classTickers,
    byClass,
    listLoading,
    activeTicker,
    setActiveTicker,
    selected,
    status,
    statusLoading,
    statusError,
    quotes,
    quote,
    activeEpisodes,
    settingsOpen,
    setSettingsOpen,
    testModeEnabled,
    testModeSaving,
    tickBusy,
    loadWatchlist,
    loadStatus,
    loadActiveEpisodes,
    toggleTestMode,
    runTick,
    livePrice,
    dayPct,
    logo: resolveYahooLogoUrl(quote || null, activeTicker),
    episodeByTicker,
  }
}

export type MomentumStudioState = ReturnType<typeof useMomentumStudio>
