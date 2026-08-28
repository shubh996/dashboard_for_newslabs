/**
 * HTTP API for multi-ticker momentum debug + manual tick.
 *
 *   GET  /api/momentum                 → watched list + brief statuses
 *   POST /api/momentum/watch           → register UI watchlist + active focus tab
 *   POST /api/momentum/thresholds      → global threshold overrides
 *   GET  /api/momentum/:ticker         → full debug snapshot
 *   POST /api/momentum/:ticker/tick
 *   POST /api/momentum/:ticker/simulate
 *   POST /api/momentum/:ticker/reset
 *   POST /api/momentum/:ticker/thresholds  (same as global; kept for UI path)
 *
 * Legacy SNDK paths still work: /sndk, /sndk/tick, …
 */
import express from 'express'
import { listWatchlistSubscribers } from '../notifications.js'
import {
  MOMENTUM_POLL_MS,
  MOMENTUM_THRESHOLDS,
  MOMENTUM_TICKER,
  MOMENTUM_WINDOWS,
  persistThresholdOverrides,
  persistEpisodePolicy,
  getEpisodePolicySnapshot,
  getThresholdSnapshot,
  getVisibleReturnKeys,
  getWindowMetaList,
  shouldShowBridgeWindows,
} from './config.js'
import {
  getMomentumStatus,
  runMomentumTick,
  runForceStartEpisode,
  setMomentumFocus,
  setMomentumWatchlist,
} from './engine.js'
import { evaluateMomentumFromCandles } from './engine.js'
import { isEpisodeEligibleWindow } from './detector.js'
import {
  hydrateTicker,
  refreshEpisodesFromSupabase,
  persistTick,
  deleteEpisodeFromSupabase,
  applyEpisodeEdit,
  deleteEpisodeEvent,
  loadResearchById,
  loadResearchByEpisodeId,
} from './persist.js'
import * as store from './store.js'
import {
  EPISODE_REARM_BUFFER_PP,
  getThresholdForKey,
  isMomentumDummyResearchMode,
} from './config.js'
import { getTestModeSnapshot, setTestModeEnabled } from './testMode.js'
import { createClient } from '@supabase/supabase-js'
import { buildMarketStatusPopup } from './marketStatusPopup.js'
import { evaluateSymbolGate } from './engineGate.js'

function getSupabaseForMonitoredTickers() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  } catch {
    return null
  }
}

function configPayload(statusLike = null) {
  const session = statusLike?.snapshot?.marketSession || null
  const assetClass = statusLike?.snapshot?.assetClass || 'equity'
  const asOf = Date.now()
  const episodePolicy = getEpisodePolicySnapshot(assetClass)
  return {
    thresholds: MOMENTUM_THRESHOLDS,
    thresholdSnapshot: getThresholdSnapshot(assetClass),
    windows: MOMENTUM_WINDOWS,
    windowMeta: getWindowMetaList(),
    // Flat fields = this ticker’s asset-class rules (not always equity)
    accelerationPoints: episodePolicy.accelerationAlertDeltaPp,
    accelerationAlertDeltaPp: episodePolicy.accelerationAlertDeltaPp,
    materialProgressDeltaPp: episodePolicy.materialProgressDeltaPp,
    inactivityMinutes: episodePolicy.episodeInactivityExpiryMin,
    episodeInactivityExpiryMin: episodePolicy.episodeInactivityExpiryMin,
    episodePolicy,
    pollIntervalMs: MOMENTUM_POLL_MS,
    showBridgeWindows: shouldShowBridgeWindows(asOf, session),
    visibleReturnKeys: getVisibleReturnKeys(asOf, session),
    testMode: getTestModeSnapshot(),
    dummyResearch: isMomentumDummyResearchMode(),
  }
}

function statusWithConfig(ticker) {
  const status = getMomentumStatus(ticker)
  return {
    ...status,
    config: configPayload(status),
  }
}

/** Status from RAM only — no automatic Supabase hydrate. */
async function statusWithConfigFresh(ticker) {
  return statusWithConfig(ticker)
}

/**
 * Simulate a price path for one ticker (walks detector tick-by-tick).
 */
function runSimulateForTicker(ticker, body) {
  const symbol = store.ensureTicker(ticker)
  const prices = Array.isArray(body?.prices) ? body.prices : []
  const nums = prices.map(Number).filter((n) => Number.isFinite(n))
  if (nums.length < 2) {
    return { error: 'Provide prices: number[] with ≥2 points', status: 400 }
  }
  const intervalMs = Math.max(60_000, Number(body?.intervalMs) || 60_000)
  const reset = body?.reset !== false
  store.pushLog(
    symbol,
    'info',
    `API simulate · ${nums.length} prices · intervalMs=${intervalMs} · reset=${reset}`,
    'simulate',
    { prices: nums },
  )
  if (reset) {
    store.resetStore(symbol)
    store.pushLog(symbol, 'warn', 'State reset before simulation', 'simulate')
  }

  const end = Date.now()
  const candles = nums.map((close, i) => ({
    t: end - (nums.length - 1 - i) * intervalMs,
    close,
  }))
  const previousClose = Number(body?.previousClose) || nums[0]

  const allEvents = []
  for (let i = 1; i < candles.length; i += 1) {
    const slice = candles.slice(0, i + 1)
    const asOfMs = slice[slice.length - 1].t
    const px = slice[slice.length - 1].close
    store.pushLog(
      symbol,
      'info',
      `Sim step ${i}/${candles.length - 1} · price=${px}`,
      'simulate',
    )
    const result = evaluateMomentumFromCandles({
      ticker: symbol,
      candles: slice,
      currentPrice: px,
      previousClose,
      asOfMs,
      marketSession: 'REGULAR',
      episode: store.getActiveEpisode(symbol),
      nowIso: new Date(asOfMs).toISOString(),
    })
    if (result.ok) {
      store.setLastSnapshot(symbol, result.snapshot)
      store.setActiveEpisode(symbol, result.episode)
      if (result.closedEpisode?.episodeId) {
        store.upsertHistoryEpisode(symbol, result.closedEpisode)
      }
      for (const ev of result.events) {
        store.pushEvent(symbol, ev)
        allEvents.push(ev)
        store.pushLog(
          symbol,
          'success',
          `Sim event ${ev.eventType} · ${ev.direction} ${ev.movePercent?.toFixed?.(2) ?? ev.movePercent}%`,
          'simulate',
          ev,
        )
      }
      for (const l of result.logs) {
        store.pushLog(symbol, 'info', l.replace(/^\[[^\]]+\]\s*/, ''), 'simulate')
      }
    }
  }

  store.pushLog(
    symbol,
    'success',
    `Simulation done · ${allEvents.length} event(s) · ${nums.length} prices`,
    'simulate',
  )
  return {
    ok: true,
    ticker: symbol,
    simulatedPoints: nums.length,
    events: allEvents,
    status: statusWithConfig(symbol),
  }
}

export function createMomentumRouter() {
  const router = express.Router()

  // Momentum desk: never let browsers / proxies cache API responses.
  router.use((_request, response, next) => {
    response.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private',
    )
    response.setHeader('Pragma', 'no-cache')
    response.setHeader('Expires', '0')
    next()
  })

  /** Compact ACTIVE episode payload for overview / Active Episodes rail */
  function activeEpisodeSummary(ep, ticker) {
    if (!ep || String(ep.status || '').toUpperCase() !== 'ACTIVE') return null
    if (ep.detectedWindow && !isEpisodeEligibleWindow(ep.detectedWindow)) {
      return null
    }
    return {
      ticker: String(ticker || ep.ticker || '').toUpperCase(),
      episodeId: ep.episodeId || ep.episode_id || null,
      episodeNo: ep.episodeNo ?? ep.episode_no ?? null,
      direction: ep.direction === 'DOWN' ? 'DOWN' : 'UP',
      status: 'ACTIVE',
      state: ep.state || null,
      detectedWindow: ep.detectedWindow || ep.windowType || null,
      currentMovePercent:
        ep.currentMovePercent != null ? Number(ep.currentMovePercent) : null,
      peakMovePercent:
        ep.peakMovePercent != null ? Number(ep.peakMovePercent) : null,
      initialMovePercent:
        ep.initialMovePercent != null
          ? Number(ep.initialMovePercent)
          : ep.triggerMovePct != null
            ? Number(ep.triggerMovePct)
            : null,
      lastNotifiedEpisodeMovePct:
        ep.lastNotifiedEpisodeMovePct != null
          ? Number(ep.lastNotifiedEpisodeMovePct)
          : null,
      currentPrice: ep.currentPrice != null ? Number(ep.currentPrice) : null,
      referencePrice:
        ep.referencePrice != null ? Number(ep.referencePrice) : null,
      referenceTime: ep.referenceTime || null,
      peakPrice: ep.peakPrice != null ? Number(ep.peakPrice) : null,
      troughPrice: ep.troughPrice != null ? Number(ep.troughPrice) : null,
      episodeStartedAt: ep.episodeStartedAt || ep.triggerTime || null,
      exactMinutes: ep.exactMinutes ?? null,
      exactLabel: ep.exactLabel || null,
      marketSession: ep.marketSession || null,
      lastMaterialProgressAt: ep.lastMaterialProgressAt || null,
      supabaseSaved: Boolean(ep.supabaseSaved || ep.supabasePersist?.ok),
      supabasePersist: ep.supabasePersist || null,
    }
  }

  /** Overview: watched tickers + focus + last fetch / episode hint */
  router.get('/', (_request, response) => {
    const watched = store.listWatchedTickers()
    const focus = store.getFocusTicker()
    const activeEpisodes = store
      .listActiveEpisodes()
      .map((ep) => activeEpisodeSummary(ep, ep.ticker))
      .filter(Boolean)
    response.json({
      ok: true,
      pollIntervalMs: MOMENTUM_POLL_MS,
      pollMode: 'watchlist-round-robin',
      focusTicker: focus,
      watchedTickers: watched,
      /** All ACTIVE episodes across tickers (right-rail “Active episodes”). */
      activeEpisodes,
      tickers: watched.map((t) => {
        const s = store.getDebugState(t)
        const ep = s.episode
        const summary = activeEpisodeSummary(ep, t)
        const active = Boolean(summary)
        return {
          ticker: t,
          isFocus: t === focus,
          lastFetchAt: s.lastFetchAt,
          lastError: s.lastError,
          tickCount: s.tickCount,
          hasEpisode: active,
          episodeDirection: summary?.direction || null,
          episodeWindow: summary?.detectedWindow || null,
          episodeState: summary?.state || null,
          episodeMovePercent: summary?.currentMovePercent ?? null,
          episodeId: summary?.episodeId || null,
          episode: summary,
          dayReturn: s.snapshot?.returns?.day ?? null,
          livePrice: s.snapshot?.currentPrice ?? null,
        }
      }),
      config: configPayload(),
    })
  })

  /**
   * GET /api/momentum/active-episodes
   * Flat list of every ACTIVE episode (for the settings → Active episodes rail).
   * Optionally re-hydrates from Supabase for watched tickers first.
   */
  router.get('/active-episodes', async (request, response) => {
    try {
      const refresh =
        String(request.query.refresh || '').trim() === '1' ||
        String(request.query.refresh || '').toLowerCase() === 'true'
      if (refresh) {
        const watched = store.listWatchedTickers()
        await Promise.all(
          watched.map((t) =>
            refreshEpisodesFromSupabase(t, { force: true }).catch(() => null),
          ),
        )
      }
      const list = store
        .listActiveEpisodes()
        .map((ep) => activeEpisodeSummary(ep, ep.ticker))
        .filter(Boolean)
      response.json({
        ok: true,
        count: list.length,
        activeEpisodes: list,
        fromSupabase: refresh,
        at: new Date().toISOString(),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to list active episodes',
      })
    }
  })

  /**
   * Compact row for history list (ACTIVE + closed/expired/ended).
   * @param {Record<string, unknown>} ep
   * @param {string} ticker
   */
  function episodeHistorySummary(ep, ticker) {
    if (!ep) return null
    const status = String(ep.status || '').toUpperCase() || 'UNKNOWN'
    const persist = ep.supabasePersist || null
    return {
      ticker: String(ticker || ep.ticker || '').toUpperCase(),
      episodeId: ep.episodeId || ep.episode_id || null,
      episodeNo: ep.episodeNo ?? ep.episode_no ?? null,
      direction: ep.direction === 'DOWN' ? 'DOWN' : 'UP',
      status,
      state: ep.state || null,
      endReason: ep.endReason || ep.end_reason || null,
      detectedWindow: ep.detectedWindow || ep.windowType || null,
      currentMovePercent:
        ep.currentMovePercent != null ? Number(ep.currentMovePercent) : null,
      peakMovePercent:
        ep.peakMovePercent != null ? Number(ep.peakMovePercent) : null,
      initialMovePercent:
        ep.initialMovePercent != null
          ? Number(ep.initialMovePercent)
          : ep.triggerMovePct != null
            ? Number(ep.triggerMovePct)
            : null,
      currentPrice: ep.currentPrice != null ? Number(ep.currentPrice) : null,
      referencePrice:
        ep.referencePrice != null ? Number(ep.referencePrice) : null,
      referenceTime: ep.referenceTime || null,
      peakPrice: ep.peakPrice != null ? Number(ep.peakPrice) : null,
      troughPrice: ep.troughPrice != null ? Number(ep.troughPrice) : null,
      episodeStartedAt: ep.episodeStartedAt || ep.triggerTime || null,
      endedAt: ep.endedAt || ep.ended_at || null,
      exactLabel: ep.exactLabel || null,
      marketSession: ep.marketSession || null,
      supabaseSaved: Boolean(ep.supabaseSaved || persist?.ok || ep.episodeId),
      supabasePersist: persist
        ? {
            ok: Boolean(persist.ok),
            action: persist.action || null,
            at: persist.at || null,
            id: persist.id || null,
          }
        : ep.supabaseSaved || ep.episodeId
          ? { ok: true, action: 'saved', at: null, id: ep.episodeId || null }
          : null,
    }
  }

  /**
   * GET /api/momentum/episodes-history
   * All episodes so far (history + live ACTIVE) across watched tickers.
   * Query: refresh=1 · limit=40 · offset=0 · perTicker=80
   */
  router.get('/episodes-history', async (request, response) => {
    try {
      const refresh =
        String(request.query.refresh || '').trim() === '1' ||
        String(request.query.refresh || '').toLowerCase() === 'true'
      const limit = Number(request.query.limit) || 40
      const offset = Number(request.query.offset) || 0
      const perTicker = Number(request.query.perTicker) || 80
      const watched = store.listWatchedTickers()
      if (refresh) {
        await Promise.all(
          watched.map((t) =>
            refreshEpisodesFromSupabase(t, { force: true }).catch(() => null),
          ),
        )
      }
      const page = store.listAllEpisodeHistory({
        tickers: watched,
        perTicker,
        limit,
        offset,
      })
      const episodes = (page.rows || [])
        .map((ep) => episodeHistorySummary(ep, ep.ticker))
        .filter(Boolean)
      const activeEpisodes = store
        .listActiveEpisodes()
        .map((ep) => activeEpisodeSummary(ep, ep.ticker))
        .filter(Boolean)
      response.json({
        ok: true,
        count: episodes.length,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
        hasMore: page.hasMore,
        nextOffset: page.hasMore ? page.offset + page.limit : null,
        episodes,
        activeEpisodes,
        activeCount: activeEpisodes.length,
        fromSupabase: refresh,
        at: new Date().toISOString(),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to list episode history',
      })
    }
  })

  /**
   * Register UI watchlist + active focus tab.
   * Background loop polls **only** `active` (or `focus`) aggressively.
   * Body: { tickers?: string[], active?: string, focus?: string }
   */
  router.post('/watch', (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object' ? request.body : {}
      const tickers = Array.isArray(body.tickers)
        ? body.tickers
        : typeof body.tickers === 'string'
          ? body.tickers.split(/[,|\s]+/)
          : []
      const active = body.active || body.focus || null
      const result =
        tickers.length || active
          ? setMomentumWatchlist(
              tickers.length ? tickers : store.listWatchedTickers(),
              active || undefined,
            )
          : {
              watchedTickers: store.listWatchedTickers(),
              focusTicker: store.getFocusTicker(),
            }
      if (active && !tickers.length) {
        setMomentumFocus(active)
        result.focusTicker = store.getFocusTicker()
      }
      response.json({
        ok: true,
        pollMode: 'watchlist-round-robin',
        watchedTickers: result.watchedTickers || store.listWatchedTickers(),
        focusTicker: result.focusTicker || store.getFocusTicker(),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to update watchlist',
      })
    }
  })

  /**
   * Watchlist source of truth: tickers users consciously monitor in the Trigger app.
   * From device_monitor where subscribers[] has enabled entries.
   * Categorized by asset class for Stocks / ETFs / Indices / Forex / Crypto / Commodities tabs.
   *
   * GET /api/momentum/monitored-tickers?assetClass=equity|etf|index|forex|crypto|commodity
   * GET /api/momentum/monitored-tickers  → all classes
   *
   * (`research` is history only — not watchlist.)
   */
  router.get('/monitored-tickers', async (request, response) => {
    try {
      const assetClassFilter = String(
        request.query.assetClass ||
          request.query.asset_class ||
          request.query.class ||
          '',
      )
        .trim()
        .toLowerCase()
      const appKey = String(request.query.app || 'trigger')
        .trim()
        .toLowerCase()
      const supabase = getSupabaseForMonitoredTickers()
      if (!supabase) {
        response.status(503).json({
          ok: false,
          error: 'Supabase not configured',
          table: 'device_monitor',
          items: [],
        })
        return
      }
      const { data, error } = await supabase
        .from('device_monitor')
        .select(
          'ticker, company_name, subscribers, updated_at, created_at, notable_price_movements',
        )
        .order('updated_at', { ascending: false })
        .limit(500)
      if (error) {
        response.status(500).json({
          ok: false,
          error: error.message,
          table: 'device_monitor',
          items: [],
        })
        return
      }

      const KNOWN_ETFS = new Set([
        'SPY',
        'QQQ',
        'IWM',
        'DIA',
        'VOO',
        'VTI',
        'VEA',
        'VWO',
        'EFA',
        'EEM',
        'ARKK',
        'XLF',
        'XLE',
        'XLK',
        'XLV',
        'GLD',
        'SLV',
        'TLT',
        'HYG',
        'LQD',
        'AGG',
        'SMH',
        'SOXX',
      ])
      const detectClass = (ticker, npm) => {
        const fromNpm =
          npm && typeof npm === 'object'
            ? String(npm.asset_class || npm.assetClass || '')
                .trim()
                .toLowerCase()
            : ''
        if (
          fromNpm === 'equity' ||
          fromNpm === 'stock' ||
          fromNpm === 'stocks'
        ) {
          return 'equity'
        }
        if (fromNpm === 'etf' || fromNpm === 'etfs' || fromNpm === 'fund') {
          return 'etf'
        }
        if (
          fromNpm === 'commodity' ||
          fromNpm === 'forex' ||
          fromNpm === 'crypto' ||
          fromNpm === 'index'
        ) {
          return fromNpm
        }
        const t = String(ticker || '').toUpperCase()
        if (t.startsWith('^')) return 'index'
        if (t.endsWith('=X') || /^[A-Z]{6}$/.test(t)) return 'forex'
        if (t.endsWith('=F')) return 'commodity'
        if (
          t.endsWith('-USD') ||
          t.endsWith('-USDT') ||
          t === 'BTC' ||
          t === 'ETH'
        ) {
          return 'crypto'
        }
        if (KNOWN_ETFS.has(t)) return 'etf'
        return 'equity'
      }

      const items = []
      // Unique push-ready devices (valid Expo token + enabled + app match).
      // Untagged legacy rows count as 9AM — not Trigger (matches delivery).
      // Does NOT apply PUSH_ALLOWLIST so dashboard shows true audience size.
      const countAppKey =
        !appKey || appKey === 'all' ? 'all' : appKey === 'nineam' ? 'nineam' : 'trigger'

      for (const row of data || []) {
        const ticker = String(row.ticker || '')
          .trim()
          .toUpperCase()
        if (!ticker) continue

        /** @type {Array<{ device_id: string|null, expo_push_token: string, enabled: boolean, app_key: string }>} */
        let recipients = []
        if (countAppKey === 'all') {
          const seenTok = new Set()
          for (const ak of ['trigger', 'nineam']) {
            for (const r of listWatchlistSubscribers([row], ak)) {
              const tok = String(r.expo_push_token || '').trim()
              if (!tok || seenTok.has(tok)) continue
              seenTok.add(tok)
              recipients.push(r)
            }
          }
        } else {
          recipients = listWatchlistSubscribers([row], countAppKey)
        }
        if (!recipients.length) continue

        const assetClass = detectClass(ticker, row.notable_price_movements)
        if (
          assetClassFilter &&
          assetClassFilter !== 'all' &&
          assetClass !== assetClassFilter
        ) {
          // allow stock / etf aliases
          const equityAlias =
            (assetClassFilter === 'equity' || assetClassFilter === 'stock') &&
            assetClass === 'equity'
          const etfAlias =
            (assetClassFilter === 'etf' || assetClassFilter === 'etfs') &&
            assetClass === 'etf'
          if (!(equityAlias || etfAlias)) {
            continue
          }
        }

        items.push({
          ticker,
          label: String(row.company_name || ticker).trim() || ticker,
          assetClass,
          subscriberCount: recipients.length,
          subscribers: recipients.map((r) => ({
            device_id: r.device_id || null,
            app: r.app_key || countAppKey,
            enabled: true,
            expo_push_token: r.expo_push_token || null,
          })),
          updatedAt: row.updated_at || row.created_at || null,
          source: 'device_monitor',
          table: 'device_monitor',
        })
      }

      // Group counts for UI headers
      const byClass = {
        equity: 0,
        etf: 0,
        index: 0,
        forex: 0,
        crypto: 0,
        commodity: 0,
      }
      for (const it of items) {
        if (byClass[it.assetClass] != null) byClass[it.assetClass] += 1
      }

      response.json({
        ok: true,
        table: 'device_monitor',
        app: appKey,
        assetClass: assetClassFilter || 'all',
        count: items.length,
        byClass,
        items,
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load monitored tickers',
        table: 'device_monitor',
        items: [],
      })
    }
  })

  /**
   * GET /api/momentum/test-mode
   * POST /api/momentum/test-mode
   *   body: {
   *     enabled: true|false,
   *     selectedDeviceIds?: string[],
   *     selectedTokens?: string[],
   *   }
   *
   * ON  → only picker-selected devices get Expo pushes; Perplexity dummy
   * OFF → real subscribers + both always-notify testers; real Perplexity
   */
  router.get('/market-status', async (_request, response) => {
    try {
      const body = await buildMarketStatusPopup()
      response.json(body)
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Market status failed',
      })
    }
  })

  router.get('/market-status/:ticker', (request, response) => {
    const ticker = String(request.params.ticker || '').toUpperCase()
    response.json({
      ok: true,
      ...evaluateSymbolGate({ symbol: ticker, nowUtc: Date.now() }),
    })
  })

  router.get('/test-mode', (_request, response) => {
    response.json({ ok: true, ...getTestModeSnapshot() })
  })
  router.post('/test-mode', (request, response) => {
    try {
      const body =
        request.body && typeof request.body === 'object' ? request.body : {}
      const raw = body.enabled ?? body.testMode ?? body.on
      if (raw === undefined) {
        response.status(400).json({
          ok: false,
          error: 'Body must include enabled: true|false',
          ...getTestModeSnapshot(),
        })
        return
      }
      const enabled =
        raw === true ||
        raw === 1 ||
        raw === '1' ||
        String(raw).toLowerCase() === 'true' ||
        String(raw).toLowerCase() === 'on'
      const allowlist = {
        selectedDeviceIds: Array.isArray(body.selectedDeviceIds)
          ? body.selectedDeviceIds
          : undefined,
        selectedTokens: Array.isArray(body.selectedTokens)
          ? body.selectedTokens
          : undefined,
      }
      const snap = setTestModeEnabled(enabled, allowlist)
      const logOn = store.listWatchedTickers()[0] || MOMENTUM_TICKER
      store.pushLog(
        logOn,
        'info',
        `Test mode ${snap.enabled ? 'ON' : 'OFF'} · ${snap.summary}`,
        'api',
        snap,
      )
      response.json({ ok: true, ...snap })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to set test mode',
      })
    }
  })

  /** Threshold overrides per asset class (equity / commodity / forex / crypto / index) */
  router.post('/thresholds', (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object' ? request.body : {}
      const assetClass = body.assetClass || body.asset_class || 'equity'
      const snapshot = persistThresholdOverrides(
        body.thresholds || body,
        assetClass,
      )
      // Log on first watched ticker (or bootstrap)
      const logOn = store.listWatchedTickers()[0] || MOMENTUM_TICKER
      store.pushLog(
        logOn,
        'info',
        `Thresholds updated from UI (${snapshot.assetClass || assetClass})`,
        'api',
        snapshot,
      )
      response.json({
        ok: true,
        thresholds: snapshot,
        assetClass: snapshot.assetClass || assetClass,
        status: statusWithConfig(body.ticker || logOn),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to update thresholds',
      })
    }
  })

  /**
   * Episode rules per asset class (equity / commodity / forex / crypto / index).
   * Same pattern as /thresholds.
   * GET  /api/momentum/episode-policy?assetClass=equity
   * POST /api/momentum/episode-policy  body: { assetClass, policy: { … } }
   */
  router.get('/episode-policy', (request, response) => {
    const assetClass =
      request.query.assetClass || request.query.asset_class || 'equity'
    response.json({
      ok: true,
      assetClass,
      policy: getEpisodePolicySnapshot(assetClass),
    })
  })
  router.post('/episode-policy', (request, response) => {
    try {
      const body =
        request.body && typeof request.body === 'object' ? request.body : {}
      const assetClass = body.assetClass || body.asset_class || 'equity'
      // Prefer nested policy; otherwise flat body minus routing keys
      let fields
      if (body.policy && typeof body.policy === 'object') {
        fields = body.policy
      } else {
        const {
          assetClass: _a,
          asset_class: _b,
          ticker: _t,
          policy: _p,
          ...rest
        } = body
        fields = rest
      }
      const snapshot = persistEpisodePolicy(fields, assetClass)
      const logOn = store.listWatchedTickers()[0] || body.ticker || MOMENTUM_TICKER
      store.pushLog(
        logOn,
        'info',
        `Episode policy updated (${snapshot.assetClass || assetClass}) · accel=${snapshot.accelerationAlertDeltaPp}pp · weak=${Math.round((snapshot.holdingToWeakeningGiveback || 0) * 100)}% · strong=${Math.round((snapshot.strongWeakeningGiveback || 0) * 100)}% · inactivity=${snapshot.episodeInactivityExpiryMin}m`,
        'api',
        snapshot,
      )
      response.json({
        ok: true,
        assetClass: snapshot.assetClass || assetClass,
        policy: snapshot,
        status: statusWithConfig(body.ticker || logOn),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to update episode policy',
      })
    }
  })

  // ── Legacy SNDK aliases (unchanged paths for older clients) ────
  router.get('/sndk', async (_request, response) => {
    try {
      response.json(await statusWithConfigFresh('SNDK'))
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load status',
      })
    }
  })

  router.post('/sndk/thresholds', (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object' ? request.body : {}
      const assetClass = body.assetClass || body.asset_class || 'equity'
      const snapshot = persistThresholdOverrides(
        body.thresholds || body,
        assetClass,
      )
      store.pushLog('SNDK', 'info', 'Thresholds updated from UI', 'api', snapshot)
      response.json({
        ok: true,
        thresholds: snapshot,
        assetClass: snapshot.assetClass || assetClass,
        status: statusWithConfig('SNDK'),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to update thresholds',
      })
    }
  })

  router.post('/sndk/tick', async (_request, response) => {
    try {
      store.pushLog('SNDK', 'info', 'API POST /sndk/tick — manual tick requested', 'api')
      const result = await runMomentumTick({ ticker: 'SNDK', source: 'api' })
      if (result && result.ok === false) {
        response.status(result.skipped ? 409 : 502).json({
          ok: false,
          error: result.error || result.reason || 'Tick failed',
          errorDetail: result.errorDetail || null,
          status: statusWithConfig('SNDK'),
        })
        return
      }
      response.json({ ok: true, ...result, status: statusWithConfig('SNDK') })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tick failed'
      const stack = error instanceof Error ? error.stack : null
      store.pushLog('SNDK', 'error', `API tick error: ${message}`, 'api', {
        message,
        stack,
      })
      response.status(500).json({
        ok: false,
        error: message,
        errorDetail: {
          message,
          stack,
          at: new Date().toISOString(),
          source: 'api',
          endpoint: 'POST /sndk/tick',
        },
      })
    }
  })

  router.post('/sndk/simulate', (request, response) => {
    try {
      const out = runSimulateForTicker('SNDK', request.body)
      if (out.error) {
        response.status(out.status || 400).json({ error: out.error })
        return
      }
      response.json(out)
    } catch (error) {
      store.pushLog(
        'SNDK',
        'error',
        `Simulate failed: ${error instanceof Error ? error.message : 'error'}`,
        'simulate',
      )
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Simulate failed',
      })
    }
  })

  router.post('/sndk/reset', (_request, response) => {
    store.resetStore('SNDK')
    store.pushLog('SNDK', 'warn', 'API reset — episode, events, logs cleared', 'api')
    response.json({ ok: true, status: statusWithConfig('SNDK') })
  })

  /**
   * POST /api/momentum/clear-cache
   * Wipe server RAM (episodes/events/logs) for all watched tickers, then
   * force-hydrate fresh history from Supabase.
   */
  router.post('/clear-cache', async (_request, response) => {
    try {
      store.resetStore()
      const watched = store.listWatchedTickers()
      const results = await Promise.all(
        watched.map(async (t) => {
          const r = await refreshEpisodesFromSupabase(t, { force: true }).catch(
            (err) => ({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          )
          return { ticker: t, ...(r && typeof r === 'object' ? r : {}) }
        }),
      )
      store.pushLog(
        watched[0] || 'SYSTEM',
        'warn',
        `Clear cache — RAM wiped · rehydrated ${watched.length} ticker(s) from Supabase`,
        'api',
      )
      response.json({
        ok: true,
        cleared: true,
        hydrated: watched.length,
        results,
        at: new Date().toISOString(),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error ? error.message : 'Failed to clear cache',
      })
    }
  })

  // ── Generic per-ticker routes ──────────────────────────────────
  // Express 5: :ticker matches path segments; client must encodeURIComponent (GC%3DF).

  router.get('/research/:id', async (request, response) => {
    try {
      const row = await loadResearchById(request.params.id)
      if (!row) {
        response.status(404).json({ ok: false, error: 'research not found' })
        return
      }
      response.json({ ok: true, research: row })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to load research',
      })
    }
  })

  router.get('/episodes/:episodeId/research', async (request, response) => {
    try {
      const list = await loadResearchByEpisodeId(request.params.episodeId)
      response.json({ ok: true, count: list.length, research: list })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to load research',
      })
    }
  })

  /**
   * Lightweight live poll — memory snapshot only (no Supabase history download).
   */
  router.get('/:ticker/live', (request, response) => {
    try {
      const ticker = decodeURIComponent(request.params.ticker || '')
      if (!ticker) {
        response.status(400).json({ ok: false, error: 'ticker required' })
        return
      }
      store.ensureTicker(ticker)
      const status = statusWithConfig(ticker)
      const ep = status?.episode || null
      const snap = status?.snapshot || null
      response.json({
        ok: true,
        ticker: store.normalizeMomentumTicker(ticker),
        livePrice: snap?.currentPrice ?? null,
        dayReturn: snap?.returns?.day ?? null,
        marketSession: snap?.marketSession || null,
        episode: ep
          ? {
              episodeId: ep.episodeId || null,
              status: ep.status || null,
              state: ep.state || null,
              direction: ep.direction || null,
              currentMovePercent: ep.currentMovePercent ?? null,
              peakMovePercent: ep.peakMovePercent ?? null,
              currentPrice: ep.currentPrice ?? null,
              detectedWindow: ep.detectedWindow || null,
            }
          : null,
        lastFetchAt: status?.lastFetchAt || null,
        loopRunning: status?.loopRunning ?? null,
        at: new Date().toISOString(),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to load live',
      })
    }
  })

  router.get('/:ticker', async (request, response) => {
    try {
      const ticker = decodeURIComponent(request.params.ticker || '')
      if (
        !ticker ||
        ticker === 'watch' ||
        ticker === 'thresholds' ||
        ticker === 'test-mode' ||
        ticker === 'episode-policy' ||
        ticker === 'research-tickers' ||
        ticker === 'monitored-tickers'
      ) {
        response.status(404).json({ error: 'Not found' })
        return
      }
      store.ensureTicker(ticker)
      const force =
        String(request.query.refresh || '').trim() === '1' ||
        String(request.query.refresh || '').toLowerCase() === 'true'
      // Hydrate from Supabase only on explicit refresh=1 (manual / boot UI).
      let hydrate = { skipped: true, reason: 'no-auto-hydrate' }
      if (force) {
        hydrate = await hydrateTicker(ticker, { force: true })
      }
      response.json({
        ...statusWithConfig(ticker),
        supabaseHydrate: {
          ran: !hydrate?.skipped,
          skipped: Boolean(hydrate?.skipped),
          reason: hydrate?.reason || null,
        },
      })
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load status',
      })
    }
  })

  router.post('/:ticker/thresholds', (request, response) => {
    try {
      const ticker = decodeURIComponent(request.params.ticker || '')
      store.ensureTicker(ticker)
      const body = request.body && typeof request.body === 'object' ? request.body : {}
      const assetClass = body.assetClass || body.asset_class || 'equity'
      const snapshot = persistThresholdOverrides(
        body.thresholds || body,
        assetClass,
      )
      store.pushLog(
        ticker,
        'info',
        `Thresholds updated from UI (${snapshot.assetClass || assetClass})`,
        'api',
        snapshot,
      )
      response.json({
        ok: true,
        thresholds: snapshot,
        assetClass: snapshot.assetClass || assetClass,
        status: statusWithConfig(ticker),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to update thresholds',
      })
    }
  })

  router.post('/:ticker/tick', async (request, response) => {
    const ticker = decodeURIComponent(request.params.ticker || '')
    try {
      store.ensureTicker(ticker)
      store.pushLog(ticker, 'info', `API POST /${ticker}/tick — manual tick requested`, 'api')
      const result = await runMomentumTick({ ticker, source: 'api' })
      if (result && result.ok === false) {
        response.status(result.skipped ? 409 : 502).json({
          ok: false,
          error: result.error || result.reason || 'Tick failed',
          errorDetail: result.errorDetail || null,
          status: statusWithConfig(ticker),
        })
        return
      }
      response.json({ ok: true, ...result, status: statusWithConfig(ticker) })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tick failed'
      const stack = error instanceof Error ? error.stack : null
      store.pushLog(ticker, 'error', `API tick error: ${message}`, 'api', {
        message,
        stack,
      })
      response.status(500).json({
        ok: false,
        error: message,
        errorDetail: {
          message,
          stack,
          at: new Date().toISOString(),
          source: 'api',
          endpoint: `POST /${ticker}/tick`,
          ticker,
        },
      })
    }
  })

  /**
   * POST /api/momentum/:ticker/start-episode
   * Body: { windowKey: "5m" | "2h" | "day" | … }
   * Manual Start from rolling-return card — opens ACTIVE episode + research pipeline.
   */
  router.post('/:ticker/start-episode', async (request, response) => {
    const ticker = decodeURIComponent(request.params.ticker || '')
    try {
      const body =
        request.body && typeof request.body === 'object' ? request.body : {}
      const windowKey = String(
        body.windowKey || body.window || body.key || '',
      ).trim()
      if (!windowKey) {
        response.status(400).json({ ok: false, error: 'windowKey required' })
        return
      }
      store.ensureTicker(ticker)
      store.pushLog(
        ticker,
        'info',
        `API POST /${ticker}/start-episode · window=${windowKey}`,
        'api',
      )
      const result = await runForceStartEpisode({ ticker, windowKey })
      if (!result?.ok) {
        const code = result?.code || ''
        const status =
          code === 'ALREADY_ACTIVE'
            ? 409
            : code === 'NO_SNAPSHOT' || code === 'NO_RETURN'
              ? 409
              : 400
        response.status(status).json({
          ok: false,
          error: result?.error || 'Start episode failed',
          code: result?.code || null,
          status: statusWithConfig(ticker),
        })
        return
      }
      response.json({
        ok: true,
        ...result,
        status: statusWithConfig(ticker),
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Start episode failed'
      store.pushLog(ticker, 'error', `API start-episode error: ${message}`, 'api')
      response.status(500).json({ ok: false, error: message })
    }
  })

  router.post('/:ticker/simulate', (request, response) => {
    const ticker = decodeURIComponent(request.params.ticker || '')
    try {
      const out = runSimulateForTicker(ticker, request.body)
      if (out.error) {
        response.status(out.status || 400).json({ error: out.error })
        return
      }
      response.json(out)
    } catch (error) {
      store.pushLog(
        ticker,
        'error',
        `Simulate failed: ${error instanceof Error ? error.message : 'error'}`,
        'simulate',
      )
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Simulate failed',
      })
    }
  })

  router.post('/:ticker/reset', (request, response) => {
    const ticker = decodeURIComponent(request.params.ticker || '')
    store.resetStore(ticker)
    store.pushLog(ticker, 'warn', 'API reset — episode, events, logs cleared', 'api')
    response.json({ ok: true, status: statusWithConfig(ticker) })
  })

  /**
   * Permanently delete one episode + timeline events from Supabase.
   * Body: { episodeId: string }
   * UI must confirm with the user before calling.
   */
  router.post('/:ticker/delete-episode', async (request, response) => {
    try {
      const ticker = decodeURIComponent(request.params.ticker || '')
      if (
        !ticker ||
        ticker === 'watch' ||
        ticker === 'thresholds' ||
        ticker === 'test-mode' ||
        ticker === 'episode-policy' ||
        ticker === 'monitored-tickers'
      ) {
        response.status(404).json({ error: 'Not found' })
        return
      }
      const body =
        request.body && typeof request.body === 'object' ? request.body : {}
      const episodeId = String(
        body.episodeId || body.episode_id || request.query.episodeId || '',
      ).trim()
      if (!episodeId) {
        response.status(400).json({
          ok: false,
          error: 'episodeId required',
        })
        return
      }

      const result = await deleteEpisodeFromSupabase(ticker, episodeId)
      if (!result.ok) {
        response.status(result.error === 'Episode not found in Supabase' ? 404 : 500).json({
          ok: false,
          error: result.error || 'Delete failed',
          status: await statusWithConfigFresh(ticker),
        })
        return
      }

      response.json({
        ok: true,
        deleted: true,
        episodeId,
        deletedEvents: result.deletedEvents || 0,
        status: await statusWithConfigFresh(ticker),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error ? error.message : 'Failed to delete episode',
      })
    }
  })

  /**
   * Delete one timeline event completely (memory + Supabase).
   * Body: { id? } OR { episodeId, eventType, detectedAt }
   */
  router.post('/:ticker/delete-episode-event', async (request, response) => {
    try {
      const ticker = decodeURIComponent(request.params.ticker || '')
      if (
        !ticker ||
        ticker === 'watch' ||
        ticker === 'thresholds' ||
        ticker === 'test-mode' ||
        ticker === 'episode-policy' ||
        ticker === 'monitored-tickers'
      ) {
        response.status(404).json({ error: 'Not found' })
        return
      }
      const body =
        request.body && typeof request.body === 'object' ? request.body : {}
      const result = await deleteEpisodeEvent(ticker, body)
      if (!result.ok) {
        response
          .status(result.error === 'Event not found' ? 404 : 400)
          .json({
            ok: false,
            error: result.error || 'Delete event failed',
            status: await statusWithConfigFresh(ticker),
          })
        return
      }
      response.json({
        ok: true,
        deleted: result.deleted || 0,
        memoryOnly: Boolean(result.memoryOnly),
        episodeReopened: Boolean(result.episodeReopened),
        episode: result.episode || null,
        status: await statusWithConfigFresh(ticker),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to delete episode event',
      })
    }
  })

  /**
   * Operator edit of any episode (active or history) + optional timeline rows.
   * Body: {
   *   episodeId: string,
   *   patch: { status, state, direction, times, prices, moves, … },
   *   events?: Array<{ id?, eventType, detectedAt, originalDetectedAt?, … }>
   * }
   */
  router.post('/:ticker/edit-episode', async (request, response) => {
    try {
      const ticker = decodeURIComponent(request.params.ticker || '')
      if (
        !ticker ||
        ticker === 'watch' ||
        ticker === 'thresholds' ||
        ticker === 'test-mode' ||
        ticker === 'episode-policy' ||
        ticker === 'monitored-tickers'
      ) {
        response.status(404).json({ error: 'Not found' })
        return
      }
      const body =
        request.body && typeof request.body === 'object' ? request.body : {}
      const episodeId = String(
        body.episodeId || body.episode_id || '',
      ).trim()
      if (!episodeId) {
        response.status(400).json({ ok: false, error: 'episodeId required' })
        return
      }
      const patch =
        body.patch && typeof body.patch === 'object'
          ? body.patch
          : { ...body }
      // Don't treat routing fields as episode fields
      delete patch.episodeId
      delete patch.episode_id
      delete patch.events
      delete patch.patch

      const events = Array.isArray(body.events) ? body.events : []
      const result = await applyEpisodeEdit(ticker, episodeId, patch, events)
      if (!result.ok) {
        response.status(result.error === 'Episode not found' ? 404 : 500).json({
          ok: false,
          error: result.error || 'Edit failed',
          status: await statusWithConfigFresh(ticker),
        })
        return
      }
      response.json({
        ok: true,
        episode: result.episode,
        eventsUpdated: result.eventsUpdated || 0,
        status: await statusWithConfigFresh(ticker),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error ? error.message : 'Failed to edit episode',
      })
    }
  })

  /**
   * Manually end / exit the active episode (no push).
   * Operator can close any live episode from the Recent Events rail.
   *
   * Body (optional): { reason?: string }  default MANUAL
   */
  router.post('/:ticker/end-episode', async (request, response) => {
    try {
      const ticker = decodeURIComponent(request.params.ticker || '')
      if (!ticker || ticker === 'watch' || ticker === 'thresholds' || ticker === 'test-mode' || ticker === 'episode-policy') {
        response.status(404).json({ error: 'Not found' })
        return
      }
      store.ensureTicker(ticker)
      const ep = store.getActiveEpisode(ticker)
      if (!ep) {
        response.status(404).json({
          ok: false,
          error: 'No active episode to end',
          status: statusWithConfig(ticker),
        })
        return
      }

      const body =
        request.body && typeof request.body === 'object' ? request.body : {}
      const reasonRaw = String(body.reason || 'MANUAL')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_')
      const reason =
        reasonRaw === 'USER_EXIT' || reasonRaw === 'MANUAL' || reasonRaw === 'OPERATOR'
          ? reasonRaw === 'OPERATOR'
            ? 'MANUAL'
            : reasonRaw
          : 'MANUAL'

      const nowIso = new Date().toISOString()
      const snap = store.getLastSnapshot(ticker)
      const symbol = store.normalizeMomentumTicker(ticker) || ticker
      const price =
        ep.currentPrice != null && Number.isFinite(Number(ep.currentPrice))
          ? Number(ep.currentPrice)
          : snap?.currentPrice != null && Number.isFinite(Number(snap.currentPrice))
            ? Number(snap.currentPrice)
            : undefined
      const movePercent = Number.isFinite(Number(ep.currentMovePercent))
        ? Number(ep.currentMovePercent)
        : Number(ep.peakMovePercent) || 0

      const endedEpisode = {
        ...ep,
        status: 'ENDED',
        state: 'ENDED',
        endedAt: nowIso,
        endReason: reason,
        currentTime: nowIso,
      }

      const ev = {
        ticker: symbol,
        direction: ep.direction || 'UP',
        eventType: 'MOMENTUM_ENDED',
        price,
        movePercent,
        detectedWindow: ep.detectedWindow || '—',
        detectedAt: nowIso,
        marketSession:
          ep.marketSession || snap?.marketSession || null,
        reason,
        shouldNotify: false,
        notification: null,
        state: 'ENDED',
        previousState: ep.state || null,
        episodeId: ep.episodeId || null,
        episodeNo: ep.episodeNo ?? null,
      }

      store.pushEvent(ticker, ev)
      store.setActiveEpisode(ticker, null)
      store.upsertHistoryEpisode(ticker, endedEpisode)
      store.markRestartGate(ticker, ep.episodeId)
      // FULL re-arm: every same-dir window must cool below its own thr−buffer
      store.markDirectionDisarmed(ticker, {
        direction: ep.direction === 'DOWN' ? 'DOWN' : 'UP',
        policy: 'FULL',
        rearmBufferPp: EPISODE_REARM_BUFFER_PP,
        episodeId: ep.episodeId || null,
        endReason: reason || 'MANUAL',
      })
      await persistTick(ticker, null, [ev], endedEpisode)
      store.pushLog(
        ticker,
        'warn',
        `Episode ended manually · ${ep.direction || '?'} · peak ${
          Number.isFinite(Number(ep.peakMovePercent))
            ? `${Number(ep.peakMovePercent) > 0 ? '+' : ''}${Number(ep.peakMovePercent).toFixed(2)}%`
            : 'n/a'
        } · reason=${reason}`,
        'api',
        { episode: endedEpisode, event: ev },
      )

      response.json({
        ok: true,
        ended: true,
        reason,
        event: ev,
        previousEpisode: endedEpisode,
        status: await statusWithConfigFresh(ticker),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to end episode',
      })
    }
  })

  /**
   * Record a manual timeline marker (Perplexity research done / alert sent)
   * so the Recent Events rail shows: Started → Perplexity done → Alert sent.
   *
   * Body: {
   *   kind: 'research' | 'alert',
   *   detectedWindow?, direction?, movePercent?, price?,
   *   notification?: { title, body },
   *   research?: { reason, likely_driver, provider, model, citations, ... },
   *   pushResult?: object,
   * }
   */
  router.post('/:ticker/timeline-event', (request, response) => {
    try {
      const ticker = decodeURIComponent(request.params.ticker || '')
      if (!ticker || ticker === 'watch' || ticker === 'thresholds' || ticker === 'test-mode' || ticker === 'episode-policy') {
        response.status(404).json({ error: 'Not found' })
        return
      }
      store.ensureTicker(ticker)
      const body =
        request.body && typeof request.body === 'object' ? request.body : {}
      const kind = String(body.kind || '').toLowerCase()
      if (kind !== 'research' && kind !== 'alert') {
        response.status(400).json({
          error: 'kind must be "research" or "alert"',
        })
        return
      }

      const nowIso = new Date().toISOString()
      const ep = store.getActiveEpisode(ticker)
      const direction =
        body.direction ||
        ep?.direction ||
        (Number(body.movePercent) < 0 ? 'DOWN' : 'UP')
      const detectedWindow =
        body.detectedWindow ||
        body.window_key ||
        ep?.detectedWindow ||
        '—'
      const movePercent =
        body.movePercent != null && Number.isFinite(Number(body.movePercent))
          ? Number(body.movePercent)
          : Number(ep?.currentMovePercent) || 0
      const price =
        body.price != null && Number.isFinite(Number(body.price))
          ? Number(body.price)
          : ep?.currentPrice != null
            ? Number(ep.currentPrice)
            : undefined

      if (kind === 'research') {
        const research =
          body.research && typeof body.research === 'object'
            ? body.research
            : {
                reason: body.reason || null,
                likely_driver: body.likely_driver || null,
                provider: body.provider || 'perplexity',
                model: body.model || null,
                citations: body.citations || [],
                completedAt: nowIso,
              }
        const reasonText =
          research.reason || body.reason || research.likely_driver || null
        const ev = {
          ticker: store.normalizeMomentumTicker(ticker) || ticker,
          direction,
          eventType: 'MOMENTUM_RESEARCH_DONE',
          price,
          movePercent,
          detectedWindow,
          detectedAt: nowIso,
          marketSession: body.marketSession || ep?.marketSession || null,
          reason: reasonText,
          shouldNotify: false,
          notification: null,
          research: {
            ...research,
            reason: reasonText,
            likely_driver:
              research.likely_driver || body.likely_driver || null,
            provider: research.provider || body.provider || 'perplexity',
            model: research.model || body.model || null,
            completedAt: research.completedAt || nowIso,
          },
          likely_driver:
            research.likely_driver || body.likely_driver || null,
        }
        store.pushEvent(ticker, ev)
        store.pushLog(
          ticker,
          'success',
          `Perplexity research done · ${String(reasonText || '').slice(0, 80)}`,
          'research',
          ev,
        )
        response.json({ ok: true, event: ev, status: statusWithConfig(ticker) })
        return
      }

      // kind === 'alert'
      const notification =
        body.notification && typeof body.notification === 'object'
          ? body.notification
          : {
              title: body.title || null,
              body: body.body || null,
            }
      const research =
        body.research && typeof body.research === 'object'
          ? body.research
          : null
      const ev = {
        ticker: store.normalizeMomentumTicker(ticker) || ticker,
        direction,
        eventType: 'MOMENTUM_ALERT_SENT',
        price,
        movePercent,
        detectedWindow,
        detectedAt: nowIso,
        notifiedAt: nowIso,
        marketSession: body.marketSession || ep?.marketSession || null,
        reason: body.reason || null,
        shouldNotify: true,
        notification: {
          title: notification.title || body.title || null,
          body: notification.body || body.body || null,
        },
        research: research || null,
        pushResult:
          body.pushResult && typeof body.pushResult === 'object'
            ? { ...body.pushResult, at: nowIso }
            : { ok: true, at: nowIso, source: 'manual' },
      }
      store.pushEvent(ticker, ev)
      store.pushLog(
        ticker,
        'success',
        `Alert sent · “${ev.notification?.title || ''}”`,
        'notify',
        ev,
      )
      response.json({ ok: true, event: ev, status: statusWithConfig(ticker) })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to record timeline event',
      })
    }
  })

  return router
}
