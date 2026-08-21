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
  /** ACTIVE + closed/expired across tickers (center “all episodes so far” list) */
  const [episodeHistory, setEpisodeHistory] = useState<ActiveEpisodeRow[]>([])
  const [episodeHistoryLoading, setEpisodeHistoryLoading] = useState(false)
  /**
   * 3rd-column mode: false = list all live ACTIVE (app load / episodes tab).
   * true = filter to the selected entity’s episodes after a click.
   */
  const [railEntityFocus, setRailEntityFocus] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [testModeEnabled, setTestModeEnabled] = useState(false)
  const [testModeSaving, setTestModeSaving] = useState(false)
  const [tickBusy, setTickBusy] = useState(false)
  const [endingEpisodeTicker, setEndingEpisodeTicker] = useState<string | null>(
    null,
  )

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

  const loadEpisodeHistory = useCallback(async (opts?: { refresh?: boolean }) => {
    setEpisodeHistoryLoading(true)
    try {
      const q = new URLSearchParams({ _: String(Date.now()), limit: '120' })
      if (opts?.refresh) q.set('refresh', '1')
      const res = await fetch(`/api/momentum/episodes-history?${q}`)
      const body = await res.json().catch(() => ({}))
      setEpisodeHistory(
        Array.isArray(body.episodes)
          ? (body.episodes as ActiveEpisodeRow[])
          : [],
      )
      if (Array.isArray(body.activeEpisodes)) {
        setActiveEpisodes(body.activeEpisodes as ActiveEpisodeRow[])
      }
    } catch {
      /* keep */
    } finally {
      setEpisodeHistoryLoading(false)
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
    if (view !== 'episodes' && view !== 'overview') return
    void loadEpisodeHistory({ refresh: view === 'episodes' })
    const id = window.setInterval(
      () => void loadEpisodeHistory(),
      view === 'episodes' ? 20_000 : 45_000,
    )
    return () => window.clearInterval(id)
  }, [view, loadEpisodeHistory])

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

  async function confirmTestMode(payload: {
    enabled: boolean
    selectedDeviceIds?: string[]
    selectedTokens?: string[]
  }) {
    setTestModeSaving(true)
    try {
      const res = await fetch('/api/momentum/test-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: payload.enabled,
          selectedDeviceIds: payload.selectedDeviceIds,
          selectedTokens: payload.selectedTokens,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed')
      setTestModeEnabled(
        typeof body.enabled === 'boolean' ? body.enabled : payload.enabled,
      )
      // Refresh status so settings show updated allowlist / always-notify list
      if (activeTicker) await loadStatus(activeTicker)
    } catch {
      /* keep */
    } finally {
      setTestModeSaving(false)
    }
  }

  /** @deprecated use confirmTestMode — kept for simple on/off without picker */
  async function toggleTestMode(next: boolean) {
    await confirmTestMode({ enabled: next })
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

  /** Manually end a live episode from the Active episodes rail (no push). */
  const endActiveEpisode = useCallback(
    async (ticker: string, row?: ActiveEpisodeRow | null) => {
      const symbol = String(ticker || '').trim().toUpperCase()
      if (!symbol || endingEpisodeTicker) return false
      const dir = row?.direction || 'episode'
      const peak =
        row && Number.isFinite(Number(row.peakMovePercent))
          ? Number(row.peakMovePercent)
          : null
      const peakLabel =
        peak != null
          ? `${peak > 0 ? '+' : ''}${peak.toFixed(2)}%`
          : ''
      const ok = window.confirm(
        `End the active ${dir} episode for ${symbol}?${
          peakLabel ? `\nPeak so far: ${peakLabel}` : ''
        }\n\nThis only closes tracking — no push is sent. A new episode can start on the next threshold cross.`,
      )
      if (!ok) return false

      setEndingEpisodeTicker(symbol)
      try {
        const res = await fetch(
          `/api/momentum/${encodeURIComponent(symbol)}/end-episode`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'MANUAL' }),
          },
        )
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          status?: StudioStatus
        }
        if (!res.ok) {
          throw new Error(body.error || `End failed (${res.status})`)
        }
        if (
          activeTicker &&
          activeTicker.toUpperCase() === symbol &&
          body.status
        ) {
          setStatus(body.status)
        }
        await loadActiveEpisodes()
        if (railEntityFocus) {
          await loadEpisodeHistory({ refresh: true })
        }
        return true
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'Failed to end episode',
        )
        return false
      } finally {
        setEndingEpisodeTicker(null)
      }
    },
    [
      activeTicker,
      endingEpisodeTicker,
      loadActiveEpisodes,
      loadEpisodeHistory,
      railEntityFocus,
    ],
  )

  /**
   * Select a history/active row: stay on episodes view.
   * Right column switches to that entity’s episodes (active + history).
   */
  const selectActiveEpisode = useCallback(
    (row: ActiveEpisodeRow) => {
      const ticker = String(row.ticker || '').trim().toUpperCase()
      if (!ticker) return
      const item = tickers.find((t) => t.ticker.toUpperCase() === ticker)
      if (item) setAssetClass(item.assetClass)
      setActiveTicker(ticker)
      setRailEntityFocus(true)
      setView('episodes')
    },
    [tickers],
  )

  /** Reset 3rd column to all live ACTIVE episodes. */
  const clearRailEntityFocus = useCallback(() => {
    setRailEntityFocus(false)
  }, [])

  /** Live ACTIVE episode for the focused ticker (3rd column), if any. */
  const activeEpisodeForTicker = useMemo(() => {
    const t = String(activeTicker || '').toUpperCase()
    if (!t) return null
    return (
      activeEpisodes.find(
        (e) =>
          String(e.ticker || '').toUpperCase() === t &&
          String(e.status || 'ACTIVE').toUpperCase() === 'ACTIVE',
      ) || null
    )
  }, [activeEpisodes, activeTicker])

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
    episodeHistory,
    episodeHistoryLoading,
    activeEpisodeForTicker,
    railEntityFocus,
    setRailEntityFocus,
    clearRailEntityFocus,
    settingsOpen,
    setSettingsOpen,
    testModeEnabled,
    testModeSaving,
    tickBusy,
    endingEpisodeTicker,
    loadWatchlist,
    loadStatus,
    loadActiveEpisodes,
    loadEpisodeHistory,
    toggleTestMode,
    confirmTestMode,
    runTick,
    endActiveEpisode,
    selectActiveEpisode,
    livePrice,
    dayPct,
    logo: resolveYahooLogoUrl(quote || null, activeTicker),
    episodeByTicker,
  }
}

export type MomentumStudioState = ReturnType<typeof useMomentumStudio>
