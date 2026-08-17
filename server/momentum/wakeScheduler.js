/**
 * Dedicated market wake scheduler (P0).
 *
 * Independent of the 60s monitoring loop, dashboard loads, and popup probes.
 * Sleeping symbols are not heavy-polled. A single timeout fires at the
 * earliest nextExpectedOpenUtc (or PAUSE_DATA backoff).
 */
import YahooFinance from 'yahoo-finance2'
import { toPlainJson } from '../yahoo/modules.js'
import { resolveMarketProfile } from './marketProfile.js'
import { nextFullCloseUtc, resolveSession } from './sessionCalendar.js'
import { evaluateFreshness, extractQuoteTimestampMs } from './freshness.js'
import { resolveLifecycle, isFullClosedLifecycle, LIFECYCLE } from './lifecycle.js'
import { closeActiveEpisodeFullMarketClose } from './episode.js'
import * as store from './store.js'

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
})

// Longer first delays after Yahoo 429 storms (was 30/60/120).
const PAUSE_BACKOFF_MS = [60_000, 120_000, 300_000, 600_000]

/** @type {Map<string, {
 *   ticker: string,
 *   sessionPolicyId: string|null,
 *   nextExpectedOpenUtc: string,
 *   sleepStartedAt: string,
 *   kind: 'FULL_CLOSED'|'MAINTENANCE'|'HOLIDAY'|'PAUSE_DATA'|'PENDING_CLOSE',
 *   retryAttempt: number,
 * }>} */
const sleepRecords = new Map()

/** @type {ReturnType<typeof setTimeout>|null} */
let wakeTimer = null
let schedulerStarted = false

export function getSleepRecord(ticker) {
  const k = store.normalizeMomentumTicker(ticker)
  return k ? sleepRecords.get(k) || null : null
}

export function listSleepRecords() {
  return [...sleepRecords.values()].map((r) => ({ ...r }))
}

export function isEngineAsleep(ticker) {
  const k = store.normalizeMomentumTicker(ticker)
  if (!k) return false
  const rec = sleepRecords.get(k)
  if (!rec) return false
  // PENDING_CLOSE is a future close alarm while the market is still open.
  if (rec.kind === 'PENDING_CLOSE') return false
  // Overdue PAUSE_DATA: lost timer / Yahoo 429 storm must not block forever.
  // Let the 60s poll retry; successful RUN clears the sleep record.
  if (rec.kind === 'PAUSE_DATA') {
    const t = Date.parse(rec.nextExpectedOpenUtc)
    if (Number.isFinite(t) && t <= Date.now() - 5_000) return false
  }
  return true
}

function armTimer() {
  if (wakeTimer) {
    clearTimeout(wakeTimer)
    wakeTimer = null
  }
  if (!schedulerStarted || !sleepRecords.size) return
  let earliest = Infinity
  for (const rec of sleepRecords.values()) {
    const t = Date.parse(rec.nextExpectedOpenUtc)
    if (Number.isFinite(t) && t < earliest) earliest = t
  }
  if (!Number.isFinite(earliest)) return
  const delay = Math.max(25, earliest - Date.now())
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    void fireDueWakes()
  }, Math.min(delay, 60 * 60_000))
  if (typeof wakeTimer.unref === 'function') wakeTimer.unref()
}

export function registerSleep(ticker, kind, nextExpectedOpenUtc, extra = {}) {
  const k = store.normalizeMomentumTicker(ticker)
  if (!k) return null
  const profile = resolveMarketProfile(k)
  const nextIso =
    nextExpectedOpenUtc ||
    resolveSession(profile).nextOpenUtc ||
    new Date(Date.now() + 60_000).toISOString()
  const rec = {
    ticker: k,
    sessionPolicyId: profile?.sessionPolicyId || null,
    nextExpectedOpenUtc: nextIso,
    sleepStartedAt: extra.sleepStartedAt || new Date().toISOString(),
    kind,
    retryAttempt: extra.retryAttempt || 0,
  }
  sleepRecords.set(k, rec)
  store.pushLog(
    k,
    'info',
    `Wake scheduler · SLEEP ${kind} until ${rec.nextExpectedOpenUtc}`,
    'wake',
    rec,
  )
  armTimer()
  return rec
}

export function registerPauseData(ticker) {
  const k = store.normalizeMomentumTicker(ticker)
  const prev = k ? sleepRecords.get(k) : null
  const attempt = prev?.kind === 'PAUSE_DATA' ? (prev.retryAttempt || 0) + 1 : 0
  const delay = PAUSE_BACKOFF_MS[Math.min(attempt, PAUSE_BACKOFF_MS.length - 1)]
  return registerSleep(
    ticker,
    'PAUSE_DATA',
    new Date(Date.now() + delay).toISOString(),
    { retryAttempt: attempt },
  )
}

export function clearSleep(ticker) {
  const k = store.normalizeMomentumTicker(ticker)
  if (!k) return
  if (sleepRecords.delete(k)) armTimer()
}

/**
 * Enter FULL_CLOSED: terminate active episodes, stop heavy work, schedule wake.
 * Idempotent.
 */
export function enterFullMarketClose(ticker, nowIso = new Date().toISOString()) {
  const k = store.normalizeMomentumTicker(ticker)
  if (!k) return { closed: null, rec: null }
  const nowMs = Date.parse(nowIso) || Date.now()
  const profile = resolveMarketProfile(k)
  const session = resolveSession(profile, nowMs)
  const existing = sleepRecords.get(k)
  const closed = closeActiveEpisodeFullMarketClose(k, {
    nowIso,
    marketSession: 'CLOSED',
  })
  if (closed?.closedEpisode) {
    void import('./persist.js')
      .then((p) =>
        p.persistTick(k, null, closed.events || [], closed.closedEpisode),
      )
      .catch(() => {})
  }
  if (existing?.kind === 'FULL_CLOSED' || existing?.kind === 'HOLIDAY') {
    return { closed, rec: existing }
  }
  const rec = registerSleep(
    k,
    session.state === 'HOLIDAY' ? 'HOLIDAY' : 'FULL_CLOSED',
    session.nextOpenUtc,
  )
  return { closed, rec }
}

/** While OPEN, arm a dedicated close alarm (not the 60s poll). */
export function schedulePendingClose(ticker, nowMs = Date.now()) {
  const k = store.normalizeMomentumTicker(ticker)
  if (!k) return null
  const existing = sleepRecords.get(k)
  if (
    existing &&
    (existing.kind === 'FULL_CLOSED' ||
      existing.kind === 'HOLIDAY' ||
      existing.kind === 'MAINTENANCE' ||
      existing.kind === 'PAUSE_DATA')
  ) {
    return existing
  }
  const profile = resolveMarketProfile(k)
  const at = nextFullCloseUtc(profile, nowMs)
  if (!at) return null
  return registerSleep(k, 'PENDING_CLOSE', at)
}

export function enterMaintenanceSleep(ticker) {
  const k = store.normalizeMomentumTicker(ticker)
  if (!k) return null
  const existing = sleepRecords.get(k)
  if (existing?.kind === 'MAINTENANCE') return existing
  const session = resolveSession(resolveMarketProfile(k))
  return registerSleep(k, 'MAINTENANCE', session.nextOpenUtc)
}

async function verifyYahooFresh(ticker) {
  const symbol = store.normalizeMomentumTicker(ticker)
  const profile = resolveMarketProfile(symbol)
  let quote = null
  try {
    const raw = await yahooFinance.quote(symbol, {}, { validateResult: false })
    quote = raw ? toPlainJson(raw) : null
  } catch {
    quote = null
  }
  const ts = extractQuoteTimestampMs(quote, null, null)
  const fresh = evaluateFreshness({
    quoteTimestampUtc: ts,
    nowUtc: Date.now(),
    profile,
  })
  return { quote, fresh }
}

async function fireDueWakes() {
  const now = Date.now()
  const due = [...sleepRecords.values()].filter((r) => {
    const t = Date.parse(r.nextExpectedOpenUtc)
    return Number.isFinite(t) && t <= now + 50
  })
  for (const rec of due) {
    await processWake(rec)
  }
  armTimer()
}

async function processWake(rec) {
  const ticker = rec.ticker
  if (rec.kind === 'PENDING_CLOSE') {
    const life = resolveLifecycle(ticker, Date.now())
    if (life.isFullClosed) {
      enterFullMarketClose(ticker)
      return
    }
    if (life.isMaintenance) {
      enterMaintenanceSleep(ticker)
      return
    }
    schedulePendingClose(ticker)
    return
  }
  const life = resolveLifecycle(ticker, Date.now())
  if (life.isFullClosed) {
    enterFullMarketClose(ticker)
    const next = life.session?.nextOpenUtc
    if (next && Date.parse(next) > Date.now() + 1000) {
      registerSleep(
        ticker,
        life.lifecycle === LIFECYCLE.HOLIDAY_CLOSED ? 'HOLIDAY' : 'FULL_CLOSED',
        next,
      )
    }
    store.pushLog(ticker, 'info', 'Wake · still FULL_CLOSED — remain asleep', 'wake')
    return
  }
  if (life.isMaintenance) {
    enterMaintenanceSleep(ticker)
    store.pushLog(ticker, 'info', 'Wake · still MAINTENANCE — remain asleep', 'wake')
    return
  }

  const { fresh } = await verifyYahooFresh(ticker)
  if (fresh.state === 'FRESH') {
    clearSleep(ticker)
    store.pushLog(
      ticker,
      'success',
      'Wake · calendar OPEN + quote FRESH → RUN',
      'wake',
    )
    schedulePendingClose(ticker)
    try {
      const engine = await import('./engine.js')
      await engine.runMomentumTick({ ticker, source: 'wake' })
    } catch (err) {
      store.pushLog(
        ticker,
        'warn',
        `Wake tick failed: ${err instanceof Error ? err.message : err}`,
        'wake',
      )
      registerPauseData(ticker)
    }
    return
  }

  store.pushLog(
    ticker,
    'info',
    `Wake · OPEN but ${fresh.state} → PAUSE_DATA retry`,
    'wake',
    fresh,
  )
  registerPauseData(ticker)
}

export function startWakeScheduler() {
  if (schedulerStarted) return
  schedulerStarted = true
  armTimer()
  console.log('[MOMENTUM] dedicated wake scheduler started')
}

/**
 * Safety kick from the 60s poll: fire any overdue sleeps and re-arm.
 * Prevents a lost setTimeout from leaving symbols PAUSE_DATA forever.
 */
export function kickWakeScheduler() {
  if (!schedulerStarted) return
  void fireDueWakes()
}

export function stopWakeScheduler() {
  schedulerStarted = false
  if (wakeTimer) {
    clearTimeout(wakeTimer)
    wakeTimer = null
  }
}

export function reconcileWatchlistSleep(tickers) {
  if (process.env.MOMENTUM_MARKET_GATE === '0') return
  for (const t of tickers || []) {
    const life = resolveLifecycle(t, Date.now())
    if (life.isFullClosed) enterFullMarketClose(t)
    else if (life.isMaintenance) enterMaintenanceSleep(t)
    else schedulePendingClose(t)
  }
}

export async function fireDueWakesForTests() {
  await fireDueWakes()
}

/** Test helper */
export function resetWakeSchedulerForTests() {
  sleepRecords.clear()
  if (wakeTimer) {
    clearTimeout(wakeTimer)
    wakeTimer = null
  }
  schedulerStarted = false
}
