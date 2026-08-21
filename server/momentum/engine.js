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
  MOMENTUM_POLL_PER_CYCLE,
  MOMENTUM_TICKER,
  MOMENTUM_TICKER_GAP_MS,
  getVisibleReturnKeys,
  hydrateThresholdsFromSupabase,
  hydrateEpisodePolicyFromSupabase,
  shouldShowBridgeWindows,
} from './config.js'
import {
  buildSessionQuote,
  inferMarketSession,
  isYahooRegularMarketState,
  normalizeYahooChart,
  resolveMarketSession,
  resolveSessionOpenPrint,
  sanitizeMomentumCandles,
} from './candles.js'
import {
  isUsEquityTriggerOpen,
  usEquitySessionId,
} from './usEquitySession.js'
import {
  calendarAllowsHeavyWork,
  evaluateSymbolGate,
  isMarketGateEnabled,
} from './engineGate.js'
import { extractQuoteTimestampMs } from './freshness.js'
import { resolveLifecycle } from './lifecycle.js'
import {
  clearSleep,
  enterFullMarketClose,
  enterMaintenanceSleep,
  getSleepRecord,
  isEngineAsleep,
  kickWakeScheduler,
  registerPauseData,
  reconcileWatchlistSleep,
  schedulePendingClose,
  startWakeScheduler,
  stopWakeScheduler,
} from './wakeScheduler.js'
import {
  computeRollingReturns,
  findMaxMoveInLookbackWindow,
  strongestInLastHourWindows,
  strongestMomentum,
} from './returns.js'
import { findEpisodeThresholdCrosses, findThresholdCrosses } from './detector.js'
import {
  advanceEpisode,
  closeActiveEpisodeFullMarketClose,
  forceStartEpisodeFromWindow,
} from './episode.js'
import { deliverEpisodeEvents } from './delivery.js'
import { handleAutoStartResearchAlerts } from './autoStartAlert.js'
import { hydrateTicker, persistTick } from './persist.js'
import { runDailyDigestCycle, isDailyDigestEnabled } from './dailyDigest.js'
import {
  runMarketSessionBulletinCycle,
  isMarketBulletinEnabled,
} from './marketSessionBulletin.js'
import * as store from './store.js'

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
})

let timer = null
/** @type {Set<string>} */
const inFlight = new Set()
let cycleRunning = false
/** Yahoo "delisted / no data" cooldown so one bad symbol does not spam every cycle */
const UNRESOLVABLE_COOLDOWN_MS = 30 * 60_000
/** @type {Map<string, number>} */
const unresolvableUntil = new Map()

function isUnresolvableYahooError(error) {
  const msg = String(
    error instanceof Error ? error.message : error || '',
  ).toLowerCase()
  return (
    msg.includes('delisted') ||
    msg.includes('no data found') ||
    msg.includes('invalid symbol') ||
    msg.includes('quote not found')
  )
}

function markUnresolvable(symbol, ms = UNRESOLVABLE_COOLDOWN_MS) {
  const key = toYahooSymbol(symbol) || symbol
  unresolvableUntil.set(key, Date.now() + ms)
}

function isOnUnresolvableCooldown(symbol) {
  const key = toYahooSymbol(symbol) || symbol
  const until = unresolvableUntil.get(key)
  if (!until) return false
  if (Date.now() >= until) {
    unresolvableUntil.delete(key)
    return false
  }
  return true
}
/** Last time we refreshed watchlist from device_monitored_tickers */
let lastMonitoredSyncMs = 0
const MONITORED_SYNC_MIN_MS = 5 * 60_000
/** Round-robin cursor over non-priority watchlist tickers */
let pollCursor = 0
/** @type {string[]} */
let lastCycleTickers = []

/**
 * Build this cycle’s poll set:
 *  1) focus tab (if any)
 *  2) every ticker with an ACTIVE episode
 *  3) round-robin batch of the rest (up to MOMENTUM_POLL_PER_CYCLE total)
 *
 * Universe can be large (all Supabase monitored); per-cycle Yahoo load stays bounded.
 * @param {string[]} watched
 * @param {string|null|undefined} focus
 * @returns {string[]}
 */
export function selectTickersForPollCycle(watched, focus) {
  const all = []
  for (const t of watched || []) {
    const k = store.normalizeMomentumTicker(t)
    if (
      k &&
      !all.includes(k) &&
      calendarAllowsHeavyWork(k) &&
      !isEngineAsleep(k)
    ) {
      all.push(k)
    }
  }

  /** @type {Set<string>} */
  const priority = new Set()
  const focusKey = focus ? store.normalizeMomentumTicker(focus) : ''
  if (
    focusKey &&
    calendarAllowsHeavyWork(focusKey) &&
    !isEngineAsleep(focusKey)
  ) {
    priority.add(focusKey)
  }
  for (const ep of store.listActiveEpisodes()) {
    const t = store.normalizeMomentumTicker(ep.ticker)
    if (t && calendarAllowsHeavyWork(t) && !isEngineAsleep(t)) priority.add(t)
  }
  // Active episodes always poll even if briefly missing from watched
  for (const t of priority) {
    if (!all.includes(t)) all.push(t)
  }
  if (!all.length) return []

  const priorityList = [...priority]
  const rest = all.filter((t) => !priority.has(t))
  const budget = Math.max(1, MOMENTUM_POLL_PER_CYCLE)
  const slotsForRest = Math.max(0, budget - priorityList.length)

  /** @type {string[]} */
  let batch = []
  if (rest.length && slotsForRest > 0) {
    if (rest.length <= slotsForRest) {
      batch = rest
    } else {
      for (let i = 0; i < slotsForRest; i += 1) {
        const idx = (pollCursor + i) % rest.length
        batch.push(rest[idx])
      }
      pollCursor = (pollCursor + slotsForRest) % rest.length
    }
  }

  /** @type {string[]} */
  const ordered = []
  const push = (t) => {
    if (t && !ordered.includes(t)) ordered.push(t)
  }
  if (focusKey) push(focusKey)
  for (const t of priorityList) push(t)
  for (const t of batch) push(t)
  return ordered
}

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
    yahooFinance
      .chart(
        symbol,
        {
          period1: period1m,
          period2,
          interval: '1m',
          includePrePost: true,
        },
        { validateResult: false },
      )
      .catch((err) => {
        if (isUnresolvableYahooError(err)) markUnresolvable(symbol)
        throw err
      }),
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

  // Strip Yahoo pre/post 1m garbage prints before any lookback/reference use.
  // Live quote stays authoritative; bad hist closes were freezing wrong refs.
  const rawCandles = normalized.candles || []
  const candles = sanitizeMomentumCandles(rawCandles, {
    anchors: [
      currentPrice,
      sessionQuote?.regular?.price,
      previousClose,
      sessionQuote?.postMarket?.price,
      sessionQuote?.preMarket?.price,
    ],
  })

  return {
    ...normalized,
    candles,
    symbol,
    currentPrice,
    previousClose,
    quote,
    sessionQuote,
    dailyCandles,
    candlesRawCount: rawCandles.length,
    candlesSanitizedCount: candles.length,
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
  useEligibleTradingTime = false,
  lifecycleState = null,
  marketProfile = null,
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
      useEligibleTradingTime ? symbol : null,
    )
  const strongest = strongestMomentum(returns)
  const strongestLastHourWindows = strongestInLastHourWindows(returns)
  const maxMoveLastHour = findMaxMoveInLookbackWindow(
    candles,
    price,
    asOf,
    60,
  )
  const assetClass = sessionQuote?.assetClass ?? 'equity'
  const hits = findThresholdCrosses(returns, assetClass)

  // First 1m print of this session (PRE 4:00 AM ET, POST 4:00 PM ET, …)
  // UI PRE lookback uses this time so users see “when pre-market started”, not Friday close.
  // Day % / soft-start still use previousClose above.
  const sessionOpen = resolveSessionOpenPrint(candles, session, asOf)

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
    assetClass,
    // Pre / regular / post from Yahoo quote (UI extended-hours display)
    sessionQuote: sessionQuote || null,
    regularPrice: sessionQuote?.regular?.price ?? null,
    marketState: sessionQuote?.marketState ?? null,
    marketStateLabel: sessionQuote?.marketStateLabel ?? null,
    isExtendedHours: Boolean(sessionQuote?.isExtendedHours),
    showExtendedBadge: Boolean(sessionQuote?.showExtendedBadge),
    sessionBadge: sessionQuote?.badge ?? null,
    /** First print at/after session open (pre 4am / AH 4pm / overnight 8pm) */
    sessionOpen: sessionOpen
      ? {
          price: sessionOpen.price,
          time: sessionOpen.timeIso,
          openMs: sessionOpen.openMs,
          label: sessionOpen.label,
          shortLabel: sessionOpen.shortLabel,
          session: sessionOpen.session,
          lagMinutes: sessionOpen.lagMinutes,
        }
      : null,
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

  const suppressStart = store.hasRestartGate(symbol)
  const {
    episode: nextEpisode,
    events,
    logs,
    closedEpisode = null,
  } = advanceEpisode({
    ticker: symbol,
    episode: activeEpisode,
    returns,
    strongest,
    currentPrice: price,
    referencePrice: refPrice,
    referenceTime: refTime,
    references,
    referenceTimes,
    exactLookbacks,
    marketSession: session,
    nowIso,
    assetClass,
    suppressStart,
    lifecycleState,
    marketProfile,
  })

  if (suppressStart && findEpisodeThresholdCrosses(returns, assetClass).length === 0) {
    store.clearRestartGate(symbol)
    logs.push(
      `[${symbol} MOMENTUM] restart gate cleared — ≤24h / 1D is quiet after manual end`,
    )
  }

  if (nextEpisode && !nextEpisode.episodeNo) {
    // Per-ticker sequence: SNDK #001 independent of AAPL #001
    nextEpisode.episodeNo = store.allocateEpisodeNo(symbol)
  }
  for (const ev of events || []) {
    // Never re-stamp events that already belong to a closed/prior episode.
    if (ev.episodeId) {
      if (ev.episodeNo == null && closedEpisode?.episodeId === ev.episodeId) {
        ev.episodeNo = closedEpisode.episodeNo ?? null
      } else if (ev.episodeNo == null && nextEpisode?.episodeId === ev.episodeId) {
        ev.episodeNo = nextEpisode.episodeNo ?? null
      }
      continue
    }
    if (nextEpisode) {
      ev.episodeId = nextEpisode.episodeId
      if (ev.episodeNo == null) ev.episodeNo = nextEpisode.episodeNo
    }
  }

  return {
    ok: true,
    snapshot,
    events,
    logs,
    episode: nextEpisode,
    closedEpisode: closedEpisode || null,
  }
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
  const preLife = resolveLifecycle(symbol, Date.now())
  if (isMarketGateEnabled() && preLife.isFullClosed) {
    const { closed, rec } = enterFullMarketClose(symbol)
    store.pushLog(
      symbol,
      'info',
      `FULL_CLOSED · episodes ended · sleep until ${rec?.nextExpectedOpenUtc || 'next open'}`,
      source,
    )
    return {
      ok: true,
      skipped: true,
      reason: 'market-full-close',
      ticker: symbol,
      closedEpisode: closed?.closedEpisode || null,
      sleep: rec,
    }
  }
  if (isMarketGateEnabled() && preLife.isMaintenance) {
    const rec = enterMaintenanceSleep(symbol)
    store.pushLog(
      symbol,
      'info',
      `MAINTENANCE · heavy work off · wake ${rec?.nextExpectedOpenUtc || ''}`,
      source,
    )
    return {
      ok: true,
      skipped: true,
      reason: 'market-maintenance',
      ticker: symbol,
      sleep: rec,
    }
  }
  if (source !== 'wake' && isEngineAsleep(symbol)) {
    return {
      ok: true,
      skipped: true,
      reason: 'engine-asleep',
      ticker: symbol,
      sleep: getSleepRecord(symbol),
    }
  }
  if (isOnUnresolvableCooldown(symbol)) {
    store.pushLog(
      symbol,
      'warn',
      `Tick skipped — Yahoo has no data for ${symbol} (cooldown)`,
      source,
    )
    return {
      ok: false,
      skipped: true,
      reason: 'unresolvable-cooldown',
      ticker: symbol,
    }
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
    // Restore past episodes + max episode_no before evaluate/start.
    await hydrateTicker(symbol)
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
      quote,
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

    const quoteTs = extractQuoteTimestampMs(
      quote,
      sessionQuote,
      candles.length ? candles[candles.length - 1].t : null,
    )

    // Cross-exchange run gate: Yahoo marketState only (US / India / UK / …).
    // REGULAR (or OPEN) → evaluate. Anything else → end episodes + skip.
    // Keeps polling so the next REGULAR print can wake the symbol naturally.
    const yahooMarketState = sessionQuote?.marketState ?? quote?.marketState ?? null
    if (
      yahooMarketState != null &&
      String(yahooMarketState).trim() !== '' &&
      !isYahooRegularMarketState(yahooMarketState)
    ) {
      const nowIso = new Date().toISOString()
      const closed = closeActiveEpisodeFullMarketClose(symbol, {
        nowIso,
        marketSession: resolveMarketSession(yahooMarketState, Date.now()),
      })
      if (closed?.closedEpisode) {
        void persistTick(symbol, null, closed.events || [], closed.closedEpisode).catch(
          () => {},
        )
      }
      store.pushLog(
        symbol,
        'info',
        `Yahoo marketState=${String(yahooMarketState).toUpperCase()} · not REGULAR · episodes ended · skip evaluate`,
        'momentum',
        { marketState: yahooMarketState },
      )
      store.setLastSnapshot(symbol, {
        ticker: symbol,
        timestamp: nowIso,
        marketSession: resolveMarketSession(yahooMarketState, Date.now()),
        currentPrice,
        previousClose,
        marketState: yahooMarketState,
        yahooRegularGate: false,
      })
      return {
        ok: true,
        skipped: true,
        reason: 'yahoo-not-regular',
        ticker: symbol,
        marketState: yahooMarketState,
        closedEpisode: closed?.closedEpisode || null,
        episode: null,
      }
    }

    const marketGate = evaluateSymbolGate({
      symbol,
      nowUtc: Date.now(),
      quoteTimestampUtc: quoteTs,
    })
    const life = resolveLifecycle(
      symbol,
      Date.now(),
      marketGate.freshnessState,
    )
    if (life.isFullClosed) {
      const { closed, rec } = enterFullMarketClose(symbol)
      return {
        ok: true,
        skipped: true,
        reason: 'market-full-close',
        ticker: symbol,
        closedEpisode: closed?.closedEpisode || null,
        sleep: rec,
        marketGate,
      }
    }
    if (life.isMaintenance) {
      return {
        ok: true,
        skipped: true,
        reason: 'market-maintenance',
        ticker: symbol,
        sleep: enterMaintenanceSleep(symbol),
        marketGate,
      }
    }
    if (marketGate.engineGate !== 'RUN') {
      store.pushLog(
        symbol,
        marketGate.engineGate === 'CONFLICT' ? 'warn' : 'info',
        `Engine ${marketGate.engineGate} · ${marketGate.calendarState}/${marketGate.freshnessState} · ${marketGate.reason}`,
        'momentum',
        marketGate,
      )
      if (marketGate.engineGate === 'PAUSE_DATA') {
        registerPauseData(symbol)
      }
      store.setLastSnapshot(symbol, {
        ticker: symbol,
        timestamp: new Date().toISOString(),
        marketSession: session,
        currentPrice,
        previousClose,
        marketGate,
        lifecycle: life.lifecycle,
      })
      return {
        ok: true,
        skipped: true,
        reason: `market-gate-${String(marketGate.engineGate).toLowerCase()}`,
        ticker: symbol,
        marketGate,
        episode: store.getActiveEpisode(symbol),
      }
    }
    // Successful live tick clears a prior PAUSE_DATA sleep
    const priorSleep = getSleepRecord(symbol)
    if (priorSleep?.kind === 'PAUSE_DATA') clearSleep(symbol)
    schedulePendingClose(symbol)

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
      // Rolling-return cards: exact clock hours (not eligible-trading walk).
      // Inactivity expiry still uses eligible trading time inside episode.js.
      useEligibleTradingTime: false,
      lifecycleState: life.lifecycle,
      marketProfile: life.profile,
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
    if (result.closedEpisode?.episodeId) {
      store.upsertHistoryEpisode(symbol, result.closedEpisode)
    }
    if (result.episode?.episodeNo) {
      store.noteEpisodeNo(symbol, result.episode.episodeNo)
    }
    if (result.closedEpisode?.episodeNo) {
      store.noteEpisodeNo(symbol, result.closedEpisode.episodeNo)
    }

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

    void persistTick(
      symbol,
      result.episode,
      deliveredEvents,
      result.closedEpisode || null,
    ).then((no) => {
      if (no && result.episode && result.episode.episodeNo !== no) {
        result.episode.episodeNo = no
        store.noteEpisodeNo(symbol, no)
        store.setActiveEpisode(symbol, result.episode)
      } else if (no) {
        store.noteEpisodeNo(symbol, no)
      }
    })

    // Perplexity only on STARTED (not AFTER_REVERSAL) or REVERSED — nowhere else
    let autoStart = null
    const hasResearchTrigger = deliveredEvents.some((ev) => {
      const t = String(ev?.eventType || '')
      if (t === 'MOMENTUM_REVERSED') return true
      if (t === 'MOMENTUM_STARTED' || t.endsWith('_STARTED')) {
        return String(ev?.reason || '').toUpperCase() !== 'AFTER_REVERSAL'
      }
      return false
    })
    if (hasResearchTrigger) {
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
            `Auto research/alert failed: ${
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
    if (isUnresolvableYahooError(detail.message)) {
      markUnresolvable(symbol)
    }
    // 429 storms: back off this symbol so the whole watchlist stops hammering Yahoo
    const msg = String(detail.message || '')
    if (
      /too many requests/i.test(msg) ||
      /\b429\b/.test(msg) ||
      /rate.?limit/i.test(msg)
    ) {
      registerPauseData(symbol)
    }
    store.setLastError(symbol, detail)
    store.pushLog(symbol, 'error', `Tick failed: ${detail.message}`, source, {
      message: detail.message,
      ticker: symbol,
    })
    console.warn(`[${symbol} MOMENTUM] fetch/tick failed: ${detail.message}`)
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
 * Background poll — watchlist universe.
 * US equities follow the Trigger window (Sun 20:00 ET → Fri 20:00 ET).
 * Crypto / FX / futures stay 24×7. Each cycle polls a bounded batch (round-robin).
 * Focus + ACTIVE episodes always included.
 * @param {{ source?: string }} [opts]
 */
export async function runMomentumTickAll(opts = {}) {
  const source = opts.source || 'poll'
  if (cycleRunning) {
    return { ok: false, skipped: true, reason: 'cycle already running' }
  }
  cycleRunning = true
  try {
    // Recover overdue PAUSE_DATA / lost wake timers before selecting the batch
    kickWakeScheduler()
    // Re-seed Trigger app watchlist occasionally (not every poll)
    const now = Date.now()
    if (
      source === 'boot' ||
      now - lastMonitoredSyncMs >= MONITORED_SYNC_MIN_MS
    ) {
      lastMonitoredSyncMs = now
      if (source === 'boot') {
        await syncWatchlistFromMonitoredTickers().catch(() => {})
      } else {
        void syncWatchlistFromMonitoredTickers().catch(() => {})
      }
    }
    const focus = store.getFocusTicker()
    const watched = store.listWatchedTickers()
    const ordered = selectTickersForPollCycle(watched, focus)
    lastCycleTickers = ordered.slice()

    /** @type {object[]} */
    const results = []
    for (let i = 0; i < ordered.length; i += 1) {
      const t = ordered[i]
      const result = await runMomentumTick({ ticker: t, source })
      results.push(result)
      if (i < ordered.length - 1 && MOMENTUM_TICKER_GAP_MS > 0) {
        await new Promise((r) => setTimeout(r, MOMENTUM_TICKER_GAP_MS))
      }
    }
    return {
      ok: true,
      source,
      mode: 'watchlist-round-robin',
      usEquityTriggerOpen: isUsEquityTriggerOpen(),
      usEquitySession: usEquitySessionId(),
      focusTicker: focus,
      watchedCount: watched.length,
      pollPerCycle: MOMENTUM_POLL_PER_CYCLE,
      maxWatched: MOMENTUM_MAX_WATCHED,
      tickers: ordered,
      results,
    }
  } finally {
    cycleRunning = false
  }
}

/**
 * Register / merge UI + app watchlist. Default **merge** so opening the
 * dashboard never drops other monitored symbols from the 24×7 loop.
 * @param {string[]} tickers
 * @param {string} [active]
 * @param {{ merge?: boolean }} [opts]
 */
export function setMomentumWatchlist(tickers, active, opts = {}) {
  const merge = opts.merge !== false
  const incoming = (tickers || []).map(String).filter(Boolean)
  const base = merge ? store.listWatchedTickers() : []
  const combined = []
  for (const t of [...base, ...incoming]) {
    const k = store.normalizeMomentumTicker(t)
    if (k && !combined.includes(k)) combined.push(k)
  }
  const limited = combined.slice(0, MOMENTUM_MAX_WATCHED)
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

/** Tell the engine which tab is currently open (polled first each cycle). */
export function setMomentumFocus(ticker) {
  return store.setFocusTicker(ticker)
}

/**
 * Pull Trigger-enabled tickers from device_monitored_tickers into the loop
 * so the engine keeps watching even when the dashboard is closed.
 * Replaces (does not merge) so unsubscribed symbols leave the universe.
 */
export async function syncWatchlistFromMonitoredTickers() {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY
    if (!url || !key) return store.listWatchedTickers()
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase
      .from('device_monitored_tickers')
      .select('ticker, subscribers')
      .limit(500)
    if (error || !data?.length) return store.listWatchedTickers()

    const { listWatchlistSubscribers } = await import('../notifications.js')
    const tickers = []
    for (const row of data) {
      const t = store.normalizeMomentumTicker(row.ticker)
      if (!t) continue
      const recips = listWatchlistSubscribers([row], 'trigger')
      if (recips.length) tickers.push(t)
    }
    if (tickers.length) {
      const focus = store.getFocusTicker()
      const focusStill =
        focus &&
        tickers.some(
          (t) => store.normalizeMomentumTicker(t) === store.normalizeMomentumTicker(focus),
        )
          ? focus
          : undefined
      // Replace with Supabase truth (full universe, capped by MOMENTUM_MAX_WATCHED)
      setMomentumWatchlist(tickers, focusStill, { merge: false })
    }
    return store.listWatchedTickers()
  } catch {
    return store.listWatchedTickers()
  }
}

/** @type {ReturnType<typeof setInterval>|null} */
let digestTimer = null

export function startMomentumLoop() {
  // Seed bootstrap watchlist once; focus defaults to first bootstrap ticker
  store.setWatchedTickers(MOMENTUM_BOOTSTRAP_TICKERS)
  store.setFocusTicker(MOMENTUM_BOOTSTRAP_TICKERS[0] || MOMENTUM_TICKER)

  // Prefer Supabase thresholds + episode policy over local disk
  void hydrateThresholdsFromSupabase()
  void hydrateEpisodePolicyFromSupabase()
  // Seed full Trigger app watchlist ASAP so we are not focus-only after restart
  void syncWatchlistFromMonitoredTickers().then((list) => {
    console.log(
      `[MOMENTUM] watchlist synced · ${list.length} ticker(s) · ≤${MOMENTUM_POLL_PER_CYCLE}/cycle round-robin`,
    )
    reconcileWatchlistSleep(list)
  })

  if (!MOMENTUM_ENGINE_ENABLED) {
    const focus = store.getFocusTicker()
    store.pushLog(focus, 'warn', 'Engine disabled (MOMENTUM_ENGINE_ENABLED=0)', 'loop')
    console.log('[MOMENTUM] engine disabled (MOMENTUM_ENGINE_ENABLED=0)')
    return
  }
  startWakeScheduler()
  reconcileWatchlistSleep(store.listWatchedTickers())
  if (timer) return
  const focus = store.getFocusTicker()
  console.log(
    `[MOMENTUM] poll loop every ${MOMENTUM_POLL_MS}ms · universe≤${MOMENTUM_MAX_WATCHED} · ${MOMENTUM_POLL_PER_CYCLE}/cycle round-robin · focus-first=${focus}`,
  )
  store.pushLog(
    focus,
    'info',
    `Poll loop starting · every ${MOMENTUM_POLL_MS}ms · ≤${MOMENTUM_POLL_PER_CYCLE}/cycle round-robin · universe≤${MOMENTUM_MAX_WATCHED} · focus-first=${focus}`,
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

  // Market open/close watchlist bulletin (replaces per-ticker daily digests).
  // Daily digest cycle only if explicitly re-enabled (legacy).
  if ((isDailyDigestEnabled() || isMarketBulletinEnabled()) && !digestTimer) {
    console.log(
      `[MOMENTUM] market open/close bulletin every 60s` +
        (isDailyDigestEnabled() ? ' · legacy daily digest also on' : ''),
    )
    setTimeout(() => {
      if (isDailyDigestEnabled()) void runDailyDigestCycle({ source: 'boot' })
      if (isMarketBulletinEnabled())
        void runMarketSessionBulletinCycle({ source: 'boot' })
    }, 12_000)
    digestTimer = setInterval(() => {
      if (isDailyDigestEnabled()) void runDailyDigestCycle({ source: 'poll' })
      if (isMarketBulletinEnabled())
        void runMarketSessionBulletinCycle({ source: 'poll' })
    }, 60_000)
    if (typeof digestTimer.unref === 'function') digestTimer.unref()
  }
}

export function stopMomentumLoop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (digestTimer) {
    clearInterval(digestTimer)
    digestTimer = null
  }
  stopWakeScheduler()
}

/**
 * Dashboard “Start episode” on a rolling-return card.
 * Refreshes Yahoo when possible, then force-opens ACTIVE on that window.
 * @param {{ ticker?: string, windowKey: string }} opts
 */
export async function runForceStartEpisode(opts = {}) {
  const symbol = store.ensureTicker(opts.ticker || MOMENTUM_TICKER)
  const windowKey = String(opts.windowKey || '').trim()
  if (!symbol || !windowKey) {
    return { ok: false, error: 'ticker and windowKey required' }
  }

  // Best-effort fresh tape (ignore skip/asleep — we still use last snapshot)
  let tickResult = null
  try {
    tickResult = await runMomentumTick({
      ticker: symbol,
      source: 'api-start-episode',
    })
  } catch (err) {
    store.pushLog(
      symbol,
      'warn',
      `Start-episode pre-tick failed: ${err instanceof Error ? err.message : err}`,
      'api',
    )
  }

  const snap =
    tickResult?.snapshot ||
    store.getLastSnapshot(symbol) ||
    null
  if (!snap || !snap.returns) {
    return {
      ok: false,
      error:
        'No rolling-return snapshot yet — wait for a successful Yahoo tick, then retry',
      code: 'NO_SNAPSHOT',
      tick: tickResult,
    }
  }

  const started = forceStartEpisodeFromWindow({
    ticker: symbol,
    windowKey,
    currentPrice: snap.currentPrice,
    returns: snap.returns,
    references: snap.references || null,
    referenceTimes: snap.referenceTimes || null,
    exactLookbacks: snap.exactLookbacks || null,
    marketSession: snap.marketSession || null,
    assetClass: snap.assetClass || null,
    nowIso: snap.timestamp || new Date().toISOString(),
  })

  if (!started.ok) {
    return { ...started, tick: tickResult, snapshot: snap }
  }

  let deliveredEvents = started.events || []
  try {
    deliveredEvents = await deliverEpisodeEvents(
      symbol,
      started.events,
      started.episode,
    )
  } catch (notifyErr) {
    store.pushLog(
      symbol,
      'warn',
      `Start-episode notify enrich failed: ${
        notifyErr instanceof Error ? notifyErr.message : notifyErr
      }`,
      'notify',
    )
  }

  for (const ev of deliveredEvents) {
    // already pushed in forceStart for raw events; re-push enriched if new
    if (ev && ev.notification) store.pushEvent(symbol, ev)
  }

  void persistTick(symbol, started.episode, deliveredEvents, null)

  void handleAutoStartResearchAlerts({
    ticker: symbol,
    events: deliveredEvents,
    episode: started.episode,
    snapshot: snap,
    meta: {
      shortName: snap?.sessionQuote?.shortName || null,
      longName: snap?.sessionQuote?.longName || null,
    },
  }).catch((err) => {
    store.pushLog(
      symbol,
      'error',
      `Start-episode research failed: ${err instanceof Error ? err.message : err}`,
      'research',
    )
  })

  return {
    ok: true,
    episode: started.episode,
    events: deliveredEvents,
    logs: started.logs,
    windowKey,
    tick: tickResult,
    snapshot: snap,
  }
}

export function getMomentumStatus(ticker = MOMENTUM_TICKER) {
  const symbol = store.ensureTicker(ticker)
  const focus = store.getFocusTicker()
  const watched = store.listWatchedTickers()
  return {
    ok: true,
    ticker: symbol,
    pollIntervalMs: MOMENTUM_POLL_MS,
    engineEnabled: MOMENTUM_ENGINE_ENABLED,
    loopRunning: Boolean(timer),
    pollMode: 'watchlist-round-robin',
    usEquityTriggerOpen: isUsEquityTriggerOpen(),
    usEquitySession: usEquitySessionId(),
    pollPerCycle: MOMENTUM_POLL_PER_CYCLE,
    maxWatched: MOMENTUM_MAX_WATCHED,
    watchedCount: watched.length,
    lastCycleTickers: lastCycleTickers.slice(),
    focusTicker: focus,
    isFocus: symbol === focus,
    watchedTickers: watched,
    ...store.getDebugState(symbol),
  }
}
