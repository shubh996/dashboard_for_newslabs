/**
 * Orchestrates: fetch Yahoo 1m candles → returns → episode advance → store.
 * Multi-ticker: each watched symbol has its own episode / events / logs.
 */
import YahooFinance from 'yahoo-finance2'
import { toYahooSymbol } from '../yahooClient.js'
import { toPlainJson } from '../yahoo/modules.js'
import {
  MOMENTUM_BOOTSTRAP_TICKERS,
  MOMENTUM_ENGINE_ENABLED,
  MOMENTUM_MAX_WATCHED,
  MOMENTUM_POLL_MS,
  MOMENTUM_TICKER,
  getVisibleReturnKeys,
  shouldShowBridgeWindows,
} from './config.js'
import {
  buildSessionQuote,
  inferMarketSession,
  normalizeYahooChart,
  resolveMarketSession,
} from './candles.js'
import {
  computeRollingReturns,
  findMaxMoveInLookbackWindow,
  strongestInLastHourWindows,
  strongestMomentum,
} from './returns.js'
import { findThresholdCrosses } from './detector.js'
import { advanceEpisode } from './episode.js'
import { deliverEpisodeEvents } from './delivery.js'
import { handleAutoStartResearchAlerts } from './autoStartAlert.js'
import * as store from './store.js'

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
})

let timer = null
/** @type {Set<string>} */
const inFlight = new Set()
let cycleRunning = false

/**
 * Fetch recent 1-minute candles + live quote (pre / regular / post).
 * @param {string} ticker
 */
export async function fetchIntradayCandles(ticker) {
  const symbol = toYahooSymbol(ticker) || store.normalizeMomentumTicker(ticker)
  // ~7 calendar days of 1m bars — covers 24h + Mon weekend bridge (30–50h)
  // across Fri→Mon (Yahoo allows ~7d of 1m data)
  const period2 = new Date()
  const period1m = new Date(period2.getTime() - 7 * 24 * 60 * 60 * 1000)
  // Daily bars for multi-day windows (1w → 1y / YTD)
  const period1d = new Date(period2.getTime() - 400 * 24 * 60 * 60 * 1000)

  const [chartRaw, chartDailyRaw, quoteRaw] = await Promise.all([
    yahooFinance.chart(
      symbol,
      {
        period1: period1m,
        period2,
        interval: '1m',
        includePrePost: true,
      },
      { validateResult: false },
    ),
    yahooFinance
      .chart(
        symbol,
        {
          period1: period1d,
          period2,
          interval: '1d',
        },
        { validateResult: false },
      )
      .catch(() => null),
    yahooFinance.quote(symbol, {}, { validateResult: false }).catch(() => null),
  ])

  const chart = toPlainJson(chartRaw)
  const quote = quoteRaw ? toPlainJson(quoteRaw) : null
  const normalized = normalizeYahooChart(chart)
  const dailyCandles = chartDailyRaw
    ? normalizeYahooChart(toPlainJson(chartDailyRaw)).candles || []
    : []
  const sessionQuote = buildSessionQuote(quote, normalized.meta)

  // Prefer quote live price (pre/post aware) over chart meta alone
  const currentPrice =
    sessionQuote.live.price ??
    normalized.currentPrice ??
    (normalized.candles.length
      ? normalized.candles[normalized.candles.length - 1].close
      : null)
  const previousClose =
    sessionQuote.previousClose ?? normalized.previousClose

  return {
    ...normalized,
    symbol,
    currentPrice,
    previousClose,
    quote,
    sessionQuote,
    dailyCandles,
  }
}

/** @deprecated use fetchIntradayCandles */
export async function fetchSndkIntradayCandles() {
  return fetchIntradayCandles(MOMENTUM_TICKER)
}

/**
 * Pure evaluation from already-normalized candles (also used by tests).
 */
export function evaluateMomentumFromCandles({
  ticker = MOMENTUM_TICKER,
  candles,
  currentPrice,
  previousClose,
  asOfMs = Date.now(),
  marketSession,
  sessionQuote = null,
  episode = null,
  nowIso = new Date().toISOString(),
  dailyCandles = null,
}) {
  const symbol = store.normalizeMomentumTicker(ticker) || MOMENTUM_TICKER
  const price =
    currentPrice ??
    (candles.length ? candles[candles.length - 1].close : null)
  if (price == null || !Number.isFinite(price)) {
    return {
      ok: false,
      error: 'No current price',
      snapshot: null,
      events: [],
      logs: [],
    }
  }

  const asOf = candles.length
    ? Math.max(asOfMs, candles[candles.length - 1].t)
    : asOfMs
  const session =
    marketSession ||
    sessionQuote?.session ||
    inferMarketSession(asOf)
  const prevCloseTime = sessionQuote?.previousCloseTime ?? null
  const { returns, references, referenceTimes, exactLookbacks, asOfTime } =
    computeRollingReturns(
      candles,
      price,
      asOf,
      previousClose,
      prevCloseTime,
      dailyCandles,
    )
  const strongest = strongestMomentum(returns)
  const strongestLastHourWindows = strongestInLastHourWindows(returns)
  const maxMoveLastHour = findMaxMoveInLookbackWindow(
    candles,
    price,
    asOf,
    60,
  )
  const hits = findThresholdCrosses(returns)

  const snapshot = {
    ticker: symbol,
    timestamp: nowIso,
    marketSession: session,
    currentPrice: price,
    previousClose,
    previousCloseTime: prevCloseTime,
    lastSessionKind: sessionQuote?.lastSessionKind ?? null,
    lastSessionLabel: sessionQuote?.lastSessionLabel ?? null,
    lastSessionShortLabel: sessionQuote?.lastSessionShortLabel ?? null,
    assetClass: sessionQuote?.assetClass ?? null,
    // Pre / regular / post from Yahoo quote (UI extended-hours display)
    sessionQuote: sessionQuote || null,
    regularPrice: sessionQuote?.regular?.price ?? null,
    marketState: sessionQuote?.marketState ?? null,
    marketStateLabel: sessionQuote?.marketStateLabel ?? null,
    isExtendedHours: Boolean(sessionQuote?.isExtendedHours),
    showExtendedBadge: Boolean(sessionQuote?.showExtendedBadge),
    sessionBadge: sessionQuote?.badge ?? null,
    // All rolling keys (1m…50h) + day (vs previous close) — see MOMENTUM_WINDOWS
    returns: { ...returns },
    references,
    referenceTimes,
    /** Per-window exact minute span from reference bar → now */
    exactLookbacks: exactLookbacks || {},
    asOfTime,
    visibleReturnKeys: getVisibleReturnKeys(asOf, session),
    showBridgeWindows: shouldShowBridgeWindows(asOf, session),
    strongestMomentum: strongest,
    /** Best among fixed cards 1m…60m */
    strongestLastHourWindows,
    /**
     * Full scan of last 60m of 1m bars: lookback minutes that max |%| to now.
     * “Which time difference had the max move in the last hour?”
     */
    maxMoveLastHour,
    thresholdCrossed: hits.length > 0,
    thresholdHits: hits,
  }

  const refPrice =
    strongest && references[strongest.window] != null
      ? references[strongest.window]
      : previousClose
  const refTime =
    strongest && referenceTimes?.[strongest.window] != null
      ? referenceTimes[strongest.window]
      : null

  // Explicit null = no episode (simulate / tests); omit → read store
  const activeEpisode =
    episode !== undefined ? episode : store.getActiveEpisode(symbol)

  const { episode: nextEpisode, events, logs } = advanceEpisode({
    ticker: symbol,
    episode: activeEpisode,
    returns,
    strongest,
    currentPrice: price,
    referencePrice: refPrice,
    referenceTime: refTime,
    references,
    referenceTimes,
    marketSession: session,
    nowIso,
    assetClass: sessionQuote?.assetClass ?? null,
  })

  return { ok: true, snapshot, events, logs, episode: nextEpisode }
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

/**
 * Build a rich error object for UI + logs (Yahoo often nests useful fields).
 * @param {unknown} error
 * @param {{ source?: string, endpoint?: string, ticker?: string }} [ctx]
 */
export function formatMomentumError(error, ctx = {}) {
  const at = new Date().toISOString()
  if (error == null) {
    return {
      message: 'Unknown error',
      at,
      source: ctx.source || 'momentum',
      endpoint: ctx.endpoint || null,
    }
  }
  if (typeof error === 'string') {
    return {
      message: error,
      at,
      source: ctx.source || 'momentum',
      endpoint: ctx.endpoint || null,
    }
  }

  const err = /** @type {Record<string, unknown>} */ (error)
  const name =
    (error instanceof Error && error.name) ||
    (typeof err.name === 'string' ? err.name : null)
  const message =
    (error instanceof Error && error.message) ||
    (typeof err.message === 'string' ? err.message : null) ||
    (typeof err.description === 'string' ? err.description : null) ||
    (typeof err.error === 'string' ? err.error : null) ||
    String(error)

  let cause = null
  if (error instanceof Error && error.cause) {
    cause =
      error.cause instanceof Error
        ? error.cause.message
        : typeof error.cause === 'string'
          ? error.cause
          : JSON.stringify(error.cause).slice(0, 500)
  } else if (err.cause != null) {
    cause = typeof err.cause === 'string' ? err.cause : JSON.stringify(err.cause).slice(0, 500)
  }

  const code =
    err.code ??
    err.status ??
    err.statusCode ??
    err.resultCode ??
    null

  // Pull nested Yahoo / HTTP bits when present
  const nested =
    err.result ||
    err.finance ||
    err.data ||
    err.response ||
    err.body ||
    null

  const extras = []
  if (name && name !== 'Error') extras.push(name)
  if (code != null && code !== '') extras.push(`code=${code}`)
  if (ctx.ticker) extras.push(`ticker=${ctx.ticker}`)
  if (ctx.endpoint) extras.push(ctx.endpoint)

  const fullMessage = extras.length ? `${message} · ${extras.join(' · ')}` : message

  let raw = null
  try {
    raw = JSON.parse(
      JSON.stringify(error, Object.getOwnPropertyNames(/** @type {object} */ (error))),
    )
  } catch {
    try {
      raw = {
        name,
        message,
        code,
        stack: error instanceof Error ? error.stack : null,
        nested: nested && typeof nested === 'object' ? nested : nested,
      }
    } catch {
      raw = { message: String(error) }
    }
  }

  return {
    message: fullMessage,
    at,
    source: ctx.source || 'momentum',
    name: name || null,
    code: code != null ? code : null,
    stack: error instanceof Error ? error.stack || null : null,
    cause,
    httpStatus:
      typeof err.status === 'number'
        ? err.status
        : typeof err.statusCode === 'number'
          ? err.statusCode
          : null,
    endpoint: ctx.endpoint || null,
    raw,
  }
}

/**
 * One poll cycle against live Yahoo for a single ticker.
 * @param {{ ticker?: string, source?: string }} [opts]
 */
export async function runMomentumTick(opts = {}) {
  const source = opts.source || 'poll'
  const symbol = store.ensureTicker(opts.ticker || MOMENTUM_TICKER)
  if (!symbol) {
    return { ok: false, error: 'ticker required' }
  }
  if (inFlight.has(symbol)) {
    store.pushLog(symbol, 'warn', 'Tick skipped — already running', source)
    return { ok: false, skipped: true, reason: 'tick already running', ticker: symbol }
  }
  inFlight.add(symbol)
  const tick = store.bumpTick(symbol)
  store.pushLog(
    symbol,
    'info',
    `Tick #${tick} started (${source}) · fetching Yahoo 1m candles for ${symbol}`,
    source,
  )
  try {
    store.pushLog(
      symbol,
      'info',
      `Yahoo chart request · ${symbol} · interval=1m · includePrePost`,
      'yahoo',
    )
    const {
      candles,
      previousClose,
      currentPrice,
      meta,
      sessionQuote,
      dailyCandles,
    } = await fetchIntradayCandles(symbol)
    store.setLastFetchAt(symbol, new Date().toISOString())
    store.setLastError(symbol, null)
    const session =
      sessionQuote?.session ||
      resolveMarketSession(sessionQuote?.marketState, Date.now())
    store.pushLog(
      symbol,
      'success',
      `Yahoo OK · ${candles.length} 1m · ${dailyCandles?.length || 0} 1d · live=${currentPrice ?? 'n/a'} · reg=${sessionQuote?.regular?.price ?? 'n/a'} · pre=${sessionQuote?.preMarket?.price ?? 'n/a'} · post=${sessionQuote?.postMarket?.price ?? 'n/a'} · session=${session}`,
      'yahoo',
      {
        candleCount: candles.length,
        dailyCandleCount: dailyCandles?.length || 0,
        currentPrice,
        previousClose,
        session,
        marketState: sessionQuote?.marketState,
        regular: sessionQuote?.regular,
        preMarket: sessionQuote?.preMarket,
        postMarket: sessionQuote?.postMarket,
        firstBar: candles[0]?.t ? new Date(candles[0].t).toISOString() : null,
        lastBar: candles.length
          ? new Date(candles[candles.length - 1].t).toISOString()
          : null,
        shortName: meta?.shortName || meta?.longName || null,
      },
    )

    const asOfMs = candles.length ? candles[candles.length - 1].t : Date.now()
    store.pushLog(
      symbol,
      'info',
      `Computing rolling returns · session=${session} · asOf=${new Date(asOfMs).toISOString()}`,
      'momentum',
    )
    const result = evaluateMomentumFromCandles({
      ticker: symbol,
      candles,
      currentPrice,
      previousClose,
      asOfMs,
      marketSession: session,
      sessionQuote,
      episode: store.getActiveEpisode(symbol),
      dailyCandles,
    })

    if (!result.ok) {
      const detail = formatMomentumError(result.error || 'evaluate failed', {
        source: 'momentum',
        ticker: symbol,
        endpoint: 'evaluateMomentumFromCandles',
      })
      store.setLastError(symbol, detail)
      store.pushLog(symbol, 'error', detail.message, 'momentum', detail)
      return { ...result, ticker: symbol, errorDetail: detail }
    }

    store.setLastSnapshot(symbol, result.snapshot)
    store.setActiveEpisode(symbol, result.episode)

    // Watchlist-gated notification enrichment (title/body + eligible devices)
    let deliveredEvents = result.events
    try {
      deliveredEvents = await deliverEpisodeEvents(
        symbol,
        result.events,
        result.episode,
      )
    } catch (notifyErr) {
      store.pushLog(
        symbol,
        'warn',
        `Notify enrich failed: ${notifyErr instanceof Error ? notifyErr.message : notifyErr}`,
        'notify',
      )
      deliveredEvents = result.events
    }
    result.events = deliveredEvents

    for (const ev of deliveredEvents) {
      store.pushEvent(symbol, ev)
      const n = ev.notification
      store.pushLog(
        symbol,
        'success',
        `Event ${ev.eventType} · ${ev.direction} ${fmtPct(ev.movePercent)} · ${ev.detectedWindow || ''}${
          n?.title ? ` · “${n.title}”` : ''
        }`,
        'event',
        ev,
      )
    }

    // STARTED → auto Perplexity + push (async so UI can poll "research running")
    let autoStart = null
    const hasStart = deliveredEvents.some((ev) => {
      const t = String(ev?.eventType || '')
      return (
        (t === 'MOMENTUM_STARTED' || t.endsWith('_STARTED')) &&
        String(ev?.reason || '').toUpperCase() !== 'AFTER_REVERSAL'
      )
    })
    if (hasStart) {
      // Fire-and-forget: RUNNING row appears on next status poll while Perplexity works
      void handleAutoStartResearchAlerts({
        ticker: symbol,
        events: deliveredEvents,
        episode: result.episode || store.getActiveEpisode(symbol),
        snapshot: result.snapshot,
        meta: {
          shortName: meta?.shortName || meta?.longName || null,
          longName: meta?.longName || meta?.shortName || null,
        },
      })
        .then((r) => {
          autoStart = r
        })
        .catch((autoErr) => {
          store.pushLog(
            symbol,
            'error',
            `Auto-start research/alert failed: ${
              autoErr instanceof Error ? autoErr.message : autoErr
            }`,
            'research',
          )
          console.warn(
            `[${symbol} MOMENTUM] auto-start pipeline failed:`,
            autoErr instanceof Error ? autoErr.message : autoErr,
          )
        })
    }

    const r = result.snapshot.returns
    const line = `5m=${fmtPct(r['5m'])} · 60m=${fmtPct(r['60m'])} · 8h=${fmtPct(r['8h'])} · 24h=${fmtPct(r['24h'])} · day=${fmtPct(r.day)}`
    store.pushLog(symbol, 'info', line, 'momentum')
    console.log(`[${symbol} MOMENTUM] ${line}`)
    for (const l of result.logs) {
      console.log(l)
      // episode.js lines already prefixed — store without double-prefix noise
      const level = l.includes('ignored')
        ? 'warn'
        : l.includes('started') || l.includes('acceleration') || l.includes('ended')
          ? 'success'
          : 'info'
      store.pushLog(symbol, level, l.replace(/^\[[^\]]+\]\s*/, ''), 'momentum')
    }

    // Re-read episode after auto-start may have updated lastNotified*
    const liveEpisode = store.getActiveEpisode(symbol) ?? result.episode
    if (liveEpisode) {
      store.pushLog(
        symbol,
        'info',
        `Episode ACTIVE · ${liveEpisode.direction} · state=${liveEpisode.state || '?'} · peak=${fmtPct(liveEpisode.peakMovePercent)} · lastNotified=${fmtPct(liveEpisode.lastNotifiedEpisodeMovePct ?? liveEpisode.lastAlertMovePercent)}`,
        'episode',
      )
    } else {
      store.pushLog(symbol, 'info', 'No active episode', 'episode')
    }

    store.pushLog(symbol, 'success', `Tick #${tick} complete`, source)
    return {
      ok: true,
      ticker: symbol,
      tick,
      snapshot: result.snapshot,
      events: result.events,
      episode: liveEpisode,
      autoStart,
      candleCount: candles.length,
      meta: {
        symbol: meta?.symbol,
        shortName: meta?.shortName,
        longName: meta?.longName,
      },
    }
  } catch (error) {
    // Failed Yahoo fetch must not destroy active episode
    const detail = formatMomentumError(error, {
      source: source || 'yahoo',
      ticker: symbol,
      endpoint: `yahoo.chart+quote(${symbol})`,
    })
    store.setLastError(symbol, detail)
    store.pushLog(symbol, 'error', `Tick failed: ${detail.message}`, source, detail)
    console.warn(`[${symbol} MOMENTUM] fetch/tick failed:`, detail.message, detail)
    return {
      ok: false,
      ticker: symbol,
      error: detail.message,
      errorDetail: detail,
      episode: store.getActiveEpisode(symbol),
    }
  } finally {
    inFlight.delete(symbol)
  }
}

/**
 * Background poll — **active tab only** (aggressive interval).
 * Other watchlist symbols are NOT fetched until the UI focuses them
 * (tab switch triggers a one-shot tick) or the user presses Run tick.
 * @param {{ source?: string }} [opts]
 */
export async function runMomentumTickAll(opts = {}) {
  const source = opts.source || 'poll'
  if (cycleRunning) {
    return { ok: false, skipped: true, reason: 'cycle already running' }
  }
  cycleRunning = true
  try {
    const t = store.getFocusTicker()
    const result = await runMomentumTick({ ticker: t, source })
    return {
      ok: true,
      source,
      mode: 'active-only',
      focusTicker: t,
      tickers: [t],
      results: [result],
    }
  } finally {
    cycleRunning = false
  }
}

/**
 * Register UI watchlist + optional active (focus) tab for the poll loop.
 * @param {string[]} tickers
 * @param {string} [active]
 */
export function setMomentumWatchlist(tickers, active) {
  const limited = (tickers || []).slice(0, MOMENTUM_MAX_WATCHED)
  const watched = store.setWatchedTickers(limited)
  if (active) {
    store.setFocusTicker(active)
  } else if (!store.getFocusTicker() && watched[0]) {
    store.setFocusTicker(watched[0])
  }
  return {
    watchedTickers: watched,
    focusTicker: store.getFocusTicker(),
  }
}

/** Tell the engine which tab is currently open (only this symbol is polled). */
export function setMomentumFocus(ticker) {
  return store.setFocusTicker(ticker)
}

export function startMomentumLoop() {
  // Seed bootstrap watchlist once; focus defaults to first bootstrap ticker
  store.setWatchedTickers(MOMENTUM_BOOTSTRAP_TICKERS)
  store.setFocusTicker(MOMENTUM_BOOTSTRAP_TICKERS[0] || MOMENTUM_TICKER)

  if (!MOMENTUM_ENGINE_ENABLED) {
    const focus = store.getFocusTicker()
    store.pushLog(focus, 'warn', 'Engine disabled (MOMENTUM_ENGINE_ENABLED=0)', 'loop')
    console.log('[MOMENTUM] engine disabled (MOMENTUM_ENGINE_ENABLED=0)')
    return
  }
  if (timer) return
  const focus = store.getFocusTicker()
  console.log(
    `[MOMENTUM] poll loop every ${MOMENTUM_POLL_MS}ms · active-tab only · focus=${focus}`,
  )
  store.pushLog(
    focus,
    'info',
    `Poll loop starting · every ${MOMENTUM_POLL_MS}ms · active-tab only · focus=${focus}`,
    'loop',
  )
  // Fire once shortly after boot, then interval
  setTimeout(() => {
    void runMomentumTickAll({ source: 'boot' })
  }, 3_000)
  timer = setInterval(() => {
    void runMomentumTickAll({ source: 'poll' })
  }, MOMENTUM_POLL_MS)
  if (typeof timer.unref === 'function') timer.unref()
}

export function stopMomentumLoop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getMomentumStatus(ticker = MOMENTUM_TICKER) {
  const symbol = store.ensureTicker(ticker)
  const focus = store.getFocusTicker()
  return {
    ok: true,
    ticker: symbol,
    pollIntervalMs: MOMENTUM_POLL_MS,
    engineEnabled: MOMENTUM_ENGINE_ENABLED,
    loopRunning: Boolean(timer),
    pollMode: 'active-only',
    focusTicker: focus,
    isFocus: symbol === focus,
    watchedTickers: store.listWatchedTickers(),
    ...store.getDebugState(symbol),
  }
}
