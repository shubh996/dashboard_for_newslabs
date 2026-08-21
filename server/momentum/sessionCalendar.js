/**
 * Session calendar — expected market state only (spec §2 / §4–§9).
 * Never infers freshness. ET (America/New_York) is canonical.
 */
import {
  etPartsAt,
  isUsEquityTriggerOpen,
  usEquitySessionId,
} from './usEquitySession.js'
import { SESSION_POLICY } from './marketProfile.js'
import { nasdaqBlocksOvernightPrelude, nasdaqHolidayOn } from './holidays.js'

const LIVE = new Set(['OPEN'])

export function isLiveCalendarState(state) {
  return LIVE.has(String(state || ''))
}

function weeklyFxOpen(ms) {
  const { weekday, minutes } = etPartsAt(ms)
  if (weekday === 'Sat') return false
  if (weekday === 'Sun') return minutes >= 17 * 60
  if (weekday === 'Fri') return minutes < 17 * 60
  return true
}

function weeklyCmeOpen(ms) {
  const { weekday, minutes } = etPartsAt(ms)
  if (weekday === 'Sat') return false
  if (weekday === 'Sun') return minutes >= 18 * 60
  if (weekday === 'Fri') return minutes < 17 * 60
  // Mon–Thu daily maintenance 17:00–18:00 ET
  if (minutes >= 17 * 60 && minutes < 18 * 60) return 'MAINTENANCE'
  return true
}

function cashIndexOpen(ms) {
  const { weekday, minutes } = etPartsAt(ms)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60
}

function equitySessionName(ms) {
  const id = usEquitySessionId(ms)
  if (id === 'overnight') return 'OVERNIGHT'
  if (id === 'pre-market') return 'PRE'
  if (id === 'regular') return 'REGULAR'
  if (id === 'after-hours') return 'POST'
  return null
}

/**
 * Calendar state only — never calls nextExpectedOpen (avoids recursion).
 * @param {object|null} profile
 * @param {number} [ms]
 */
export function resolveSessionState(profile, ms = Date.now()) {
  const now = Number(ms) || Date.now()
  if (!profile) {
    return {
      state: 'UNKNOWN',
      sessionName: null,
      reason: 'No market profile for symbol',
    }
  }

  const policy = profile.sessionPolicyId
  const holiday =
    profile.holidayCalendarId === 'NASDAQ' ? nasdaqHolidayOn(now) : null

  if (holiday?.kind === 'HOLIDAY') {
    return {
      state: 'HOLIDAY',
      sessionName: null,
      reason: `Exchange holiday ${holiday.date}`,
    }
  }

  if (holiday?.kind === 'EARLY_CLOSE') {
    const { minutes } = etPartsAt(now)
    const closeMin = holiday.closeHour * 60 + holiday.closeMinute
    if (minutes >= closeMin) {
      return {
        state: 'EARLY_CLOSE',
        sessionName: null,
        reason: `Early close ${String(holiday.closeHour).padStart(2, '0')}:${String(holiday.closeMinute).padStart(2, '0')} ET`,
      }
    }
  }

  if (
    policy === SESSION_POLICY.US_EQUITY_YAHOO_24X5 &&
    nasdaqBlocksOvernightPrelude(now)
  ) {
    return {
      state: 'HOLIDAY',
      sessionName: null,
      reason: 'Overnight blocked — Monday holiday',
    }
  }

  if (policy === SESSION_POLICY.CRYPTO_24X7) {
    return {
      state: 'OPEN',
      sessionName: 'CONTINUOUS',
      reason: 'Crypto spot 24/7',
    }
  }

  if (policy === SESSION_POLICY.US_EQUITY_YAHOO_24X5) {
    // Calendar = Yahoo 24×5 poll window (Sun 20:00–Fri 20:00 ET) so we still
    // fetch quotes for non-US listings (e.g. India morning overlaps this).
    // Actual momentum RUN vs stop is decided by Yahoo marketState===REGULAR
    // in the engine tick — not by hard-coded cash-bell hours per country.
    const open = isUsEquityTriggerOpen(now)
    return {
      state: open ? 'OPEN' : 'CLOSED',
      sessionName: open ? equitySessionName(now) : null,
      reason: open
        ? `Equity poll window · ${equitySessionName(now) || 'session'} (Yahoo REGULAR gate applies)`
        : 'Outside Yahoo equity 24×5 poll window',
    }
  }

  if (policy === SESSION_POLICY.FX_SPOT_24X5) {
    const open = weeklyFxOpen(now)
    return {
      state: open ? 'OPEN' : 'CLOSED',
      sessionName: open ? 'CONTINUOUS' : null,
      reason: open ? 'FX spot session' : 'FX weekend',
    }
  }

  if (policy === SESSION_POLICY.US_CASH_INDEX_RTH) {
    const open = cashIndexOpen(now)
    return {
      state: open ? 'OPEN' : 'CLOSED',
      sessionName: open ? 'REGULAR' : null,
      reason: open ? 'US cash index RTH' : 'Outside cash-index calculation window',
    }
  }

  if (
    policy === SESSION_POLICY.CME_FUTURE_23X5 ||
    policy === SESSION_POLICY.CME_INDEX_FUTURE_23X5
  ) {
    const cme = weeklyCmeOpen(now)
    if (cme === 'MAINTENANCE') {
      return {
        state: 'MAINTENANCE',
        sessionName: null,
        reason: 'CME daily maintenance 17:00–18:00 ET',
      }
    }
    return {
      state: cme ? 'OPEN' : 'CLOSED',
      sessionName: cme ? 'FUTURES' : null,
      reason: cme ? 'CME 23x5 session' : 'CME weekend',
    }
  }

  return {
    state: 'UNKNOWN',
    sessionName: null,
    reason: `Unknown session policy ${policy}`,
  }
}

/**
 * @param {object} profile
 * @param {number} [ms]
 */
export function resolveSession(profile, ms = Date.now()) {
  const now = Number(ms) || Date.now()
  const sess = resolveSessionState(profile, now)
  const sleeping = ['CLOSED', 'HOLIDAY', 'MAINTENANCE', 'EARLY_CLOSE'].includes(
    sess.state,
  )
  return {
    ...sess,
    nextOpenUtc: sleeping ? nextExpectedOpenUtc(profile, now) : null,
  }
}

/**
 * Next instant the instrument becomes FULL_CLOSED / HOLIDAY / EARLY_CLOSE.
 * Used by the dedicated close scheduler — not the 60s poll loop.
 */
const CLOSE_STATES = new Set(['CLOSED', 'HOLIDAY', 'EARLY_CLOSE'])

/**
 * Coarse → fine scan so boot reconcile over ~50 tickers does not peg the CPU.
 * 15m steps to find the boundary, then 1m refine in the last coarse step.
 */
function scanForward(profile, fromMs, pred, horizonMin, coarseMin = 15) {
  const start = Number(fromMs) || Date.now()
  const coarseMs = Math.max(1, coarseMin) * 60_000
  const fineMs = 60_000
  const coarseSteps = Math.ceil(horizonMin / coarseMin)
  for (let i = 1; i <= coarseSteps; i += 1) {
    const t = start + i * coarseMs
    if (!pred(resolveSessionState(profile, t))) continue
    // Refine to the first minute inside this coarse bucket that matches
    const bucketStart = start + (i - 1) * coarseMs
    for (let t2 = bucketStart + fineMs; t2 <= t; t2 += fineMs) {
      if (pred(resolveSessionState(profile, t2))) {
        return new Date(t2).toISOString()
      }
    }
    return new Date(t).toISOString()
  }
  return null
}

export function nextFullCloseUtc(profile, fromMs = Date.now()) {
  if (!profile) return null
  const start = Number(fromMs) || Date.now()
  const first = resolveSessionState(profile, start)
  if (CLOSE_STATES.has(first.state)) {
    return new Date(start).toISOString()
  }
  return scanForward(
    profile,
    start,
    (sess) => CLOSE_STATES.has(sess.state),
    10 * 24 * 60,
    15,
  )
}

export function nextExpectedOpenUtc(profile, fromMs = Date.now()) {
  if (!profile) return null
  return scanForward(
    profile,
    Number(fromMs) || Date.now(),
    (sess) => sess.state === 'OPEN',
    14 * 24 * 60,
    15,
  )
}
