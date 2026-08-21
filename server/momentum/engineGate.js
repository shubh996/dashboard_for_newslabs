/**
 * Engine gate: calendar + freshness → RUN / PAUSE_DATA / SLEEP / CONFLICT
 * (spec §2 / §12 / §16).
 */
import { resolveMarketProfile } from './marketProfile.js'
import { resolveSession } from './sessionCalendar.js'
import { evaluateFreshness } from './freshness.js'

const SLEEP_STATES = new Set(['CLOSED', 'HOLIDAY', 'MAINTENANCE', 'EARLY_CLOSE'])

export function isMarketGateEnabled() {
  return process.env.MOMENTUM_MARKET_GATE !== '0'
}

/**
 * Calendar-only: should we skip heavy polling?
 * @param {string} symbol
 * @param {number} [nowMs]
 */
export function calendarAllowsHeavyWork(symbol, nowMs = Date.now()) {
  if (!isMarketGateEnabled()) return true
  const profile = resolveMarketProfile(symbol)
  const session = resolveSession(profile, nowMs)
  return !SLEEP_STATES.has(session.state)
}

/**
 * Combine calendar + freshness (quote optional).
 * @param {{
 *   symbol: string,
 *   nowUtc?: number,
 *   quoteTimestampUtc?: string|number|null,
 *   pollIntervalSec?: number,
 * }} input
 */
export function evaluateSymbolGate(input) {
  const symbol = String(input?.symbol || '').trim().toUpperCase()
  const nowUtc = Number(input?.nowUtc) || Date.now()
  const profile = resolveMarketProfile(symbol)
  if (!profile) {
    return {
      symbol,
      profile: null,
      calendarState: 'UNKNOWN',
      sessionName: null,
      nextExpectedOpenUtc: null,
      freshnessState: 'MISSING',
      quoteTimestampUtc: null,
      quoteAgeSec: null,
      engineGate: 'CONFLICT',
      reason: 'No session policy mapping',
    }
  }

  const session = resolveSession(profile, nowUtc)
  const freshness = evaluateFreshness({
    quoteTimestampUtc: input?.quoteTimestampUtc ?? null,
    nowUtc,
    profile,
    pollIntervalSec: input?.pollIntervalSec,
  })

  let engineGate = 'PAUSE_DATA'
  let reason = session.reason

  if (SLEEP_STATES.has(session.state)) {
    // RTH-only equities still get fresh Yahoo pre/post prints after the cash
    // bell — that is expected, not a profile bug. Only escalate when the
    // profile claims extended hours are part of the trading calendar.
    if (freshness.state === 'FRESH' && profile.supportsExtendedHours) {
      engineGate = 'CONFLICT'
      reason = `Calendar ${session.state} but Yahoo print is fresh — check profile`
    } else {
      engineGate = 'SLEEP'
      reason = session.reason || 'Market is not expected to be live'
    }
  } else if (session.state === 'UNKNOWN') {
    engineGate = 'CONFLICT'
    reason = session.reason || 'Calendar resolution failed'
  } else if (freshness.state === 'FRESH') {
    engineGate = 'RUN'
    reason = 'Market open and quote is fresh'
  } else {
    engineGate = 'PAUSE_DATA'
    reason = 'Market should be open but usable live data is not available'
  }

  return {
    symbol,
    profile,
    calendarState: session.state,
    sessionName: session.sessionName || null,
    nextExpectedOpenUtc: session.nextOpenUtc || null,
    freshnessState: freshness.state,
    quoteTimestampUtc: freshness.quoteTimestampUtc,
    quoteAgeSec: freshness.quoteAgeSec,
    engineGate,
    reason,
    session,
    freshness,
  }
}

/** Calendar-only sleep (no quote yet). */
export function evaluateCalendarSleep(symbol, nowUtc = Date.now()) {
  const profile = resolveMarketProfile(symbol)
  const session = resolveSession(profile, nowUtc)
  const sleep = !profile || SLEEP_STATES.has(session.state)
  return {
    symbol: String(symbol || '').toUpperCase(),
    profile,
    session,
    sleep,
    engineGate: sleep ? (profile ? 'SLEEP' : 'CONFLICT') : 'RUN',
    nextExpectedOpenUtc: session.nextOpenUtc || null,
    reason: session.reason,
  }
}
