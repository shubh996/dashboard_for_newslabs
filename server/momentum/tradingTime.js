/**
 * Eligible-trading-time walkback (spec §13).
 * Window labels mean trading minutes, not raw wall-clock across closures.
 */
import { resolveMarketProfile } from './marketProfile.js'
import { isLiveCalendarState, resolveSessionState } from './sessionCalendar.js'

/**
 * Walk back `minutes` of OPEN/live calendar time from `fromMs`.
 * @param {string|object} symbolOrProfile
 * @param {number} fromMs
 * @param {number} minutes
 */
export function walkBackEligibleTradingMinutes(
  symbolOrProfile,
  fromMs,
  minutes,
) {
  const profile =
    symbolOrProfile && typeof symbolOrProfile === 'object'
      ? symbolOrProfile
      : resolveMarketProfile(symbolOrProfile)
  const target = Math.max(1, Math.round(Number(minutes) || 0))
  const start = Number(fromMs)
  if (!profile || !Number.isFinite(start) || target <= 0) {
    return {
      referenceTs: Number.isFinite(start) ? start : Date.now(),
      counted: 0,
      crossedClosure: false,
      closureDurationSec: 0,
      sessionBoundaryType: null,
    }
  }

  // Adaptive step: long lookbacks must not minute-scan (boot with 20 tickers
  // × many windows pegged the event loop at ~100% CPU and blocked the API).
  const stepMin = target > 24 * 60 ? 30 : target > 180 ? 5 : 1
  const step = stepMin * 60_000
  let t = start
  let counted = 0
  let closedSec = 0
  let crossed = false
  const maxSteps = Math.ceil((target / stepMin) * 8) + 2 * 24 * (60 / stepMin)
  for (let i = 0; i < maxSteps && counted < target; i += 1) {
    t -= step
    const sess = resolveSessionState(profile, t)
    if (isLiveCalendarState(sess.state)) {
      counted += stepMin
    } else {
      closedSec += 60 * stepMin
      crossed = true
    }
  }
  if (counted > target) {
    // Nudge back so reference is not past the requested eligible minutes
    t += (counted - target) * 60_000
    counted = target
  }

  return {
    referenceTs: t,
    counted,
    crossedClosure: crossed,
    closureDurationSec: closedSec,
    sessionBoundaryType: crossed
      ? closedSec >= 12 * 3600
        ? 'REOPEN_GAP'
        : 'SESSION_GAP'
      : null,
  }
}

/**
 * Eligible OPEN trading milliseconds between two instants (excludes
 * maintenance / full close / holiday). Does not know about DATA_STALE —
 * callers must pause the inactivity clock themselves during stale periods.
 */
export function eligibleTradingMsBetween(symbolOrProfile, fromMs, toMs) {
  const profile =
    symbolOrProfile && typeof symbolOrProfile === 'object'
      ? symbolOrProfile
      : resolveMarketProfile(symbolOrProfile)
  const a = Number(fromMs)
  const b = Number(toMs)
  if (!profile || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0
  const spanMin = (b - a) / 60_000
  const stepMin = spanMin > 24 * 60 ? 30 : spanMin > 180 ? 5 : 1
  const step = stepMin * 60_000
  let ms = 0
  for (let t = a + step; t <= b; t += step) {
    const sess = resolveSessionState(profile, t)
    if (isLiveCalendarState(sess.state)) ms += step
  }
  return ms
}
