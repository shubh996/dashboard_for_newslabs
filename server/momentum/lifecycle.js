/**
 * Distinct market / session states for Trigger (production requirements).
 * Do not collapse MAINTENANCE, DATA_STALE, and FULL_CLOSED.
 */
import { resolveMarketProfile } from './marketProfile.js'
import { resolveSession } from './sessionCalendar.js'

export const LIFECYCLE = {
  OVERNIGHT: 'OVERNIGHT',
  PRE_MARKET: 'PRE_MARKET',
  REGULAR: 'REGULAR',
  POST_MARKET: 'POST_MARKET',
  OPEN: 'OPEN',
  MAINTENANCE: 'MAINTENANCE',
  FULL_CLOSED: 'FULL_CLOSED',
  HOLIDAY_CLOSED: 'HOLIDAY_CLOSED',
  DATA_STALE: 'DATA_STALE',
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
}

const TRADING_SESSIONS = new Set([
  LIFECYCLE.OVERNIGHT,
  LIFECYCLE.PRE_MARKET,
  LIFECYCLE.REGULAR,
  LIFECYCLE.POST_MARKET,
  LIFECYCLE.OPEN,
])

export function sessionNameToLifecycle(sessionName) {
  const s = String(sessionName || '').toUpperCase()
  if (s === 'OVERNIGHT') return LIFECYCLE.OVERNIGHT
  if (s === 'PRE' || s === 'PRE_MARKET') return LIFECYCLE.PRE_MARKET
  if (s === 'REGULAR') return LIFECYCLE.REGULAR
  if (s === 'POST' || s === 'POST_MARKET') return LIFECYCLE.POST_MARKET
  if (s === 'FUTURES' || s === 'CONTINUOUS') return LIFECYCLE.OPEN
  return LIFECYCLE.OPEN
}

export function isFullClosedLifecycle(life) {
  return (
    life === LIFECYCLE.FULL_CLOSED || life === LIFECYCLE.HOLIDAY_CLOSED
  )
}

export function isTradingLifecycle(life) {
  return TRADING_SESSIONS.has(life)
}

export function isInactivityPausedLifecycle(life) {
  return (
    life === LIFECYCLE.MAINTENANCE ||
    life === LIFECYCLE.DATA_STALE ||
    life === LIFECYCLE.DATA_UNAVAILABLE
  )
}

/**
 * Calendar + optional freshness → lifecycle + engine gate.
 * Freshness never flips FULL_CLOSED.
 */
export function resolveLifecycle(symbolOrProfile, nowMs = Date.now(), freshnessState = null) {
  const profile =
    symbolOrProfile && typeof symbolOrProfile === 'object'
      ? symbolOrProfile
      : resolveMarketProfile(symbolOrProfile)
  const session = resolveSession(profile, nowMs)
  const cal = session.state

  if (cal === 'MAINTENANCE') {
    return {
      profile,
      session,
      lifecycle: LIFECYCLE.MAINTENANCE,
      isFullClosed: false,
      isMaintenance: true,
      engineGate: 'SLEEP_TEMPORARILY',
      currentSession: 'Maintenance',
    }
  }
  if (cal === 'HOLIDAY') {
    return {
      profile,
      session,
      lifecycle: LIFECYCLE.HOLIDAY_CLOSED,
      isFullClosed: true,
      isMaintenance: false,
      engineGate: 'SLEEP',
      currentSession: 'Closed',
    }
  }
  if (cal === 'CLOSED' || cal === 'EARLY_CLOSE') {
    return {
      profile,
      session,
      lifecycle: LIFECYCLE.FULL_CLOSED,
      isFullClosed: true,
      isMaintenance: false,
      engineGate: 'SLEEP',
      currentSession: 'Closed',
    }
  }
  if (cal !== 'OPEN') {
    return {
      profile,
      session,
      lifecycle: LIFECYCLE.FULL_CLOSED,
      isFullClosed: true,
      isMaintenance: false,
      engineGate: 'SLEEP',
      currentSession: 'Closed',
    }
  }

  const tradingLife = sessionNameToLifecycle(session.sessionName)
  const fresh = String(freshnessState || '').toUpperCase()
  if (fresh === 'STALE') {
    return {
      profile,
      session,
      lifecycle: LIFECYCLE.DATA_STALE,
      isFullClosed: false,
      isMaintenance: false,
      engineGate: 'PAUSE_DATA',
      currentSession: tradingLife,
      tradingSession: tradingLife,
    }
  }
  if (fresh && fresh !== 'FRESH') {
    return {
      profile,
      session,
      lifecycle: LIFECYCLE.DATA_UNAVAILABLE,
      isFullClosed: false,
      isMaintenance: false,
      engineGate: 'PAUSE_DATA',
      currentSession: tradingLife,
      tradingSession: tradingLife,
    }
  }
  return {
    profile,
    session,
    lifecycle: tradingLife,
    isFullClosed: false,
    isMaintenance: false,
    engineGate: 'RUN',
    currentSession: tradingLife,
    tradingSession: tradingLife,
  }
}
