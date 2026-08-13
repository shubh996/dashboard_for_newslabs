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
import {
  ACCELERATION_ALERT_DELTA_PP,
  EPISODE_INACTIVITY_EXPIRY_MIN,
  MATERIAL_PROGRESS_DELTA_PP,
  MOMENTUM_ACCELERATION_POINTS,
  MOMENTUM_INACTIVITY_MINUTES,
  MOMENTUM_POLL_MS,
  MOMENTUM_THRESHOLDS,
  MOMENTUM_TICKER,
  MOMENTUM_WINDOWS,
  applyThresholdOverrides,
  getEpisodePolicySnapshot,
  getThresholdSnapshot,
  getVisibleReturnKeys,
  getWindowMetaList,
  shouldShowBridgeWindows,
} from './config.js'
import {
  getMomentumStatus,
  runMomentumTick,
  setMomentumFocus,
  setMomentumWatchlist,
} from './engine.js'
import { evaluateMomentumFromCandles } from './engine.js'
import * as store from './store.js'

function configPayload(statusLike = null) {
  const session = statusLike?.snapshot?.marketSession || null
  const asOf = Date.now()
  return {
    thresholds: MOMENTUM_THRESHOLDS,
    thresholdSnapshot: getThresholdSnapshot(),
    windows: MOMENTUM_WINDOWS,
    windowMeta: getWindowMetaList(),
    accelerationPoints: MOMENTUM_ACCELERATION_POINTS,
    accelerationAlertDeltaPp: ACCELERATION_ALERT_DELTA_PP,
    materialProgressDeltaPp: MATERIAL_PROGRESS_DELTA_PP,
    inactivityMinutes: MOMENTUM_INACTIVITY_MINUTES,
    episodeInactivityExpiryMin: EPISODE_INACTIVITY_EXPIRY_MIN,
    episodePolicy: getEpisodePolicySnapshot(),
    pollIntervalMs: MOMENTUM_POLL_MS,
    showBridgeWindows: shouldShowBridgeWindows(asOf, session),
    visibleReturnKeys: getVisibleReturnKeys(asOf, session),
  }
}

function statusWithConfig(ticker) {
  const status = getMomentumStatus(ticker)
  return {
    ...status,
    config: configPayload(status),
  }
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

  /** Overview: watched tickers + focus + last fetch / episode hint */
  router.get('/', (_request, response) => {
    const watched = store.listWatchedTickers()
    const focus = store.getFocusTicker()
    response.json({
      ok: true,
      pollIntervalMs: MOMENTUM_POLL_MS,
      pollMode: 'active-only',
      focusTicker: focus,
      watchedTickers: watched,
      tickers: watched.map((t) => {
        const s = store.getDebugState(t)
        const ep = s.episode
        const active =
          ep &&
          String(ep.status || 'ACTIVE').toUpperCase() !== 'ENDED'
        return {
          ticker: t,
          isFocus: t === focus,
          lastFetchAt: s.lastFetchAt,
          lastError: s.lastError,
          tickCount: s.tickCount,
          hasEpisode: Boolean(active),
          episodeDirection: active ? ep.direction || null : null,
          episodeWindow: active ? ep.detectedWindow || null : null,
          dayReturn: s.snapshot?.returns?.day ?? null,
          livePrice: s.snapshot?.currentPrice ?? null,
        }
      }),
      config: configPayload(),
    })
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
        pollMode: 'active-only',
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

  /** Global threshold overrides (apply to every ticker) */
  router.post('/thresholds', (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object' ? request.body : {}
      const snapshot = applyThresholdOverrides(body.thresholds || body)
      // Log on first watched ticker (or bootstrap)
      const logOn = store.listWatchedTickers()[0] || MOMENTUM_TICKER
      store.pushLog(logOn, 'info', 'Thresholds updated from UI (global)', 'api', snapshot)
      response.json({
        ok: true,
        thresholds: snapshot,
        status: statusWithConfig(body.ticker || logOn),
      })
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to update thresholds',
      })
    }
  })

  // ── Legacy SNDK aliases (unchanged paths for older clients) ────
  router.get('/sndk', (_request, response) => {
    response.json(statusWithConfig('SNDK'))
  })

  router.post('/sndk/thresholds', (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object' ? request.body : {}
      const snapshot = applyThresholdOverrides(body.thresholds || body)
      store.pushLog('SNDK', 'info', 'Thresholds updated from UI', 'api', snapshot)
      response.json({ ok: true, thresholds: snapshot, status: statusWithConfig('SNDK') })
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

  // ── Generic per-ticker routes ──────────────────────────────────
  // Express 5: :ticker matches path segments; client must encodeURIComponent (GC%3DF).

  router.get('/:ticker', (request, response) => {
    try {
      const ticker = decodeURIComponent(request.params.ticker || '')
      if (!ticker || ticker === 'watch' || ticker === 'thresholds') {
        response.status(404).json({ error: 'Not found' })
        return
      }
      store.ensureTicker(ticker)
      response.json(statusWithConfig(ticker))
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
      const snapshot = applyThresholdOverrides(body.thresholds || body)
      store.pushLog(ticker, 'info', 'Thresholds updated from UI (global)', 'api', snapshot)
      response.json({ ok: true, thresholds: snapshot, status: statusWithConfig(ticker) })
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
   * Manually end / exit the active episode (no push).
   * Operator can close any live episode from the Recent Events rail.
   *
   * Body (optional): { reason?: string }  default MANUAL
   */
  router.post('/:ticker/end-episode', (request, response) => {
    try {
      const ticker = decodeURIComponent(request.params.ticker || '')
      if (!ticker || ticker === 'watch' || ticker === 'thresholds') {
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
      }

      store.pushEvent(ticker, ev)
      store.setActiveEpisode(ticker, null)
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
        status: statusWithConfig(ticker),
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
      if (!ticker || ticker === 'watch' || ticker === 'thresholds') {
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
                search_results: body.search_results || [],
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
