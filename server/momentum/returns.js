/**
 * Rolling-return calculation from 1m candles.
 *
 * **day** is special: % change vs Yahoo `previousClose` (prior regular session close),
 * not a rolling N-hour window of candles.
 *
 * Overnight / weekend: Yahoo has no equity 1m bars while closed. A lookback that
 * lands in that quiet region uses the **last print before the gap** (usually Friday).
 * We must not null those windows just because wall-clock age > lookback.
 */
import { candleAtOrBefore, firstCandleAfter } from './candles.js'
import { MOMENTUM_WINDOWS, allReturnKeys } from './config.js'

/** Fri close → Mon open is ~65.5h; allow 72h for gap-tolerant anchors. */
const SESSION_GAP_MAX_EXTRA_MS = 72 * 60 * 60_000

/**
 * @param {number} current
 * @param {number} historical
 * @returns {number|null}
 */
export function movePercent(current, historical) {
  if (!Number.isFinite(current) || !Number.isFinite(historical) || historical === 0) {
    return null
  }
  return ((current - historical) / historical) * 100
}

/**
 * Base slack when prints are continuous (intraday / crypto).
 * @param {number} mins
 * @param {{ bridge?: boolean, extended?: boolean }} [meta]
 */
function maxAgeSlackMs(mins, meta = {}) {
  if (meta.multiDay) return 2 * 24 * 60 * 60_000 // daily bars: ±2 calendar days
  if (mins <= 60) return 3 * 60_000
  if (mins < 600 && !meta.bridge && !meta.extended) {
    return Math.max(5 * 60_000, Math.round(mins * 60_000 * 0.05))
  }
  if (meta.bridge) return SESSION_GAP_MAX_EXTRA_MS
  // extended 10h–24h
  return 36 * 60 * 60_000
}

/**
 * True when `targetMs` sits in a no-trade stretch after `hist`
 * (overnight / weekend for equities — no 1m bars between hist and target).
 *
 * @param {import('./candles.js').Candle[]} candles
 * @param {import('./candles.js').Candle} hist
 * @param {number} targetMs
 */
function targetInSessionGap(candles, hist, targetMs) {
  if (!hist || hist.t >= targetMs) return false
  const next = firstCandleAfter(candles, hist.t)
  // No print between hist and target ⇒ lookback fell into closed/quiet market
  return !next || next.t > targetMs
}

/**
 * Accept hist bar for this window?
 * @param {import('./candles.js').Candle[]} candles
 * @param {import('./candles.js').Candle} hist
 * @param {number} asOfMs
 * @param {number} targetMs
 * @param {number} mins
 * @param {{ bridge?: boolean, extended?: boolean }} meta
 */
function histAcceptable(candles, hist, asOfMs, targetMs, mins, meta) {
  const ageMs = asOfMs - hist.t
  const baseMax = mins * 60_000 + maxAgeSlackMs(mins, meta)
  if (ageMs <= baseMax) return true

  // Multi-day daily bars: accept within lookback + slack (more for long horizons)
  if (meta.multiDay) {
    const daySlack =
      mins >= 180 * 24 * 60
        ? 7 * 24 * 60 * 60_000 // 6M / 1y
        : mins >= 60 * 24 * 60
          ? 5 * 24 * 60 * 60_000 // 3M
          : 3 * 24 * 60 * 60_000
    return ageMs <= mins * 60_000 + daySlack
  }

  // Short windows stay strict (avoid using stale bars when 1m data is simply missing)
  if (mins < 120) return false

  // Lookback target is in a closed-market hole after the last print (Fri → Mon).
  // Allow up to lookback + weekend buffer so 5h…20h match 24h’s Friday anchor.
  if (
    targetInSessionGap(candles, hist, targetMs) &&
    ageMs <= mins * 60_000 + SESSION_GAP_MAX_EXTRA_MS
  ) {
    return true
  }
  return false
}

/**
 * @param {import('./candles.js').Candle[]} candles sorted asc
 * @param {number} currentPrice
 * @param {number} asOfMs
 * @param {number|null} previousClose
 * @param {string|null} [previousCloseTimeIso]
 * @returns {{
 *   returns: Record<string, number|null>,
 *   references: Record<string, number|null>,
 *   referenceTimes: Record<string, string|null>,
 *   asOfTime: string|null,
 * }}
 */
/**
 * Human label for exact elapsed minutes (e.g. 82 → "82 minutes", 125 → "2h 5m").
 * @param {number} minutes
 */
export function formatExactLookbackLabel(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  if (m >= 24 * 60) {
    const d = Math.floor(m / (24 * 60))
    const remH = Math.floor((m % (24 * 60)) / 60)
    if (remH === 0) return `${d} day${d === 1 ? '' : 's'}`
    return `${d}d ${remH}h`
  }
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (rem === 0) return `${h} hour${h === 1 ? '' : 's'}`
  return `${h}h ${rem}m`
}

/**
 * @param {number} asOfMs
 * @param {number} refMs
 */
function exactMinutesBetween(asOfMs, refMs) {
  if (!Number.isFinite(asOfMs) || !Number.isFinite(refMs) || asOfMs < refMs) return null
  return Math.max(1, Math.round((asOfMs - refMs) / 60_000))
}

/** Calendar year start ≈ Jan 1 00:00 America/New_York (EST) — fine for daily YTD. */
function yearStartEtMs(asOfMs) {
  try {
    const year = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
      }).format(new Date(asOfMs)),
    )
    if (!Number.isFinite(year)) return null
    // Jan 1 is always EST (UTC−5) — good enough for 1d bar anchors
    return Date.UTC(year, 0, 1, 5, 0, 0)
  } catch {
    const y = new Date(asOfMs).getUTCFullYear()
    return Date.UTC(y, 0, 1, 5, 0, 0)
  }
}

/**
 * @param {import('./candles.js').Candle[]} candles sorted asc (1m preferred)
 * @param {number} currentPrice
 * @param {number} asOfMs
 * @param {number|null} previousClose
 * @param {string|null} [previousCloseTimeIso]
 * @param {import('./candles.js').Candle[]|null} [dailyCandles] optional 1d bars for multi-day windows
 */
export function computeRollingReturns(
  candles,
  currentPrice,
  asOfMs,
  previousClose,
  previousCloseTimeIso = null,
  dailyCandles = null,
) {
  /** @type {Record<string, number|null>} */
  const returns = {}
  /** @type {Record<string, number|null>} */
  const references = {}
  /** @type {Record<string, string|null>} */
  const referenceTimes = {}
  /**
   * Exact wall-clock span from the reference print → as-of (not just the bucket key).
   * e.g. 90m window may resolve to an 82-minute-old bar after gaps.
   * @type {Record<string, {
   *   windowKey: string,
   *   windowMinutes: number|null,
   *   exactMinutes: number,
   *   exactLabel: string,
   *   referencePrice: number|null,
   *   referenceTime: string|null,
   *   asOfTime: string|null,
   *   movePercent: number|null,
   * }|null>}
   */
  const exactLookbacks = {}

  const asOfIso = Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null
  const daily =
    Array.isArray(dailyCandles) && dailyCandles.length ? dailyCandles : null

  for (const w of MOMENTUM_WINDOWS) {
    const key = w.key
    const multiDay = Boolean(w.multiDay)
    const isYtd = Boolean(w.ytd)
    // Multi-day / YTD windows use daily bars when available (1m Yahoo only ~7d)
    const series =
      multiDay && daily
        ? daily
        : candles

    let mins = w.minutes
    let target = asOfMs - mins * 60_000
    if (isYtd) {
      const y0 = yearStartEtMs(asOfMs)
      if (y0 != null && Number.isFinite(y0)) {
        target = y0
        mins = Math.max(1, Math.round((asOfMs - y0) / 60_000))
      }
    }

    const hist = candleAtOrBefore(series, target)
    const meta = {
      bridge: w.bridge,
      extended: w.extended,
      multiDay,
      ytd: isYtd,
    }

    // YTD: accept first daily bar on/after year start (or last before)
    const ytdOk =
      isYtd &&
      hist &&
      Number.isFinite(hist.t) &&
      hist.t <= asOfMs &&
      asOfMs - hist.t <= mins * 60_000 + 5 * 24 * 60 * 60_000

    if (
      !hist ||
      (!isYtd && !histAcceptable(series, hist, asOfMs, target, mins, meta)) ||
      (isYtd && !ytdOk)
    ) {
      returns[key] = null
      references[key] = null
      referenceTimes[key] = null
      exactLookbacks[key] = null
      continue
    }
    const refIso = new Date(hist.t).toISOString()
    const move = movePercent(currentPrice, hist.close)
    const exactMins = exactMinutesBetween(asOfMs, hist.t)
    references[key] = hist.close
    referenceTimes[key] = refIso
    returns[key] = move
    exactLookbacks[key] =
      exactMins != null
        ? {
            windowKey: key,
            windowMinutes: isYtd ? mins : w.minutes,
            exactMinutes: exactMins,
            exactLabel: isYtd
              ? `YTD · ${formatExactLookbackLabel(exactMins)}`
              : formatExactLookbackLabel(exactMins),
            referencePrice: hist.close,
            referenceTime: refIso,
            asOfTime: asOfIso,
            movePercent: move,
          }
        : null
  }

  // Day vs previous regular close (Yahoo meta) — not a candle lookback
  if (previousClose != null && Number.isFinite(previousClose) && previousClose !== 0) {
    returns.day = movePercent(currentPrice, previousClose)
    references.day = previousClose
    referenceTimes.day = previousCloseTimeIso || null
    let exactMins = null
    if (previousCloseTimeIso) {
      const refMs = Date.parse(previousCloseTimeIso)
      if (Number.isFinite(refMs)) exactMins = exactMinutesBetween(asOfMs, refMs)
    }
    exactLookbacks.day = {
      windowKey: 'day',
      windowMinutes: null,
      exactMinutes: exactMins ?? 0,
      exactLabel:
        exactMins != null
          ? formatExactLookbackLabel(exactMins)
          : 'since previous regular close',
      referencePrice: previousClose,
      referenceTime: previousCloseTimeIso || null,
      asOfTime: asOfIso,
      movePercent: returns.day,
    }
  } else {
    returns.day = null
    references.day = null
    referenceTimes.day = null
    exactLookbacks.day = null
  }

  return {
    returns,
    references,
    referenceTimes,
    exactLookbacks,
    asOfTime: asOfIso,
  }
}

/**
 * Strongest absolute move among all computed windows + day.
 * @param {Record<string, number|null>} returns
 * @returns {{ window: string, movePercent: number, direction: 'UP'|'DOWN' }|null}
 */
export function strongestMomentum(returns) {
  let best = null
  for (const key of allReturnKeys()) {
    const v = returns[key]
    if (v == null || !Number.isFinite(v)) continue
    if (!best || Math.abs(v) > Math.abs(best.movePercent)) {
      best = {
        window: key,
        movePercent: v,
        direction: v >= 0 ? 'UP' : 'DOWN',
      }
    }
  }
  return best
}

/** Rolling keys that look back at most 60 minutes (excluding day). */
const LAST_HOUR_WINDOW_KEYS = ['1m', '5m', '10m', '15m', '30m', '45m', '60m']

/**
 * Among fixed rolling cards ≤60m, which has the largest |%| right now?
 * @param {Record<string, number|null|undefined>} returns
 */
export function strongestInLastHourWindows(returns) {
  let best = null
  for (const key of LAST_HOUR_WINDOW_KEYS) {
    const v = returns?.[key]
    if (v == null || !Number.isFinite(v)) continue
    if (!best || Math.abs(v) > Math.abs(best.movePercent)) {
      best = {
        window: key,
        movePercent: v,
        direction: v >= 0 ? 'UP' : 'DOWN',
      }
    }
  }
  return best
}

/**
 * Scan every 1m bar in the last `windowMinutes` and find the lookback that
 * maximizes |move %| from that bar’s close → current price.
 *
 * Answers: “in the last hour, which time difference had the max % move?”
 *
 * @param {import('./candles.js').Candle[]} candles sorted asc
 * @param {number} currentPrice
 * @param {number} asOfMs
 * @param {number} [windowMinutes=60]
 * @returns {{
 *   movePercent: number,
 *   direction: 'UP'|'DOWN',
 *   lookbackMinutes: number,
 *   lookbackLabel: string,
 *   referencePrice: number,
 *   referenceTime: string,
 *   asOfTime: string,
 *   barsScanned: number,
 * }|null}
 */
export function findMaxMoveInLookbackWindow(
  candles,
  currentPrice,
  asOfMs,
  windowMinutes = 60,
) {
  if (
    !Array.isArray(candles) ||
    !candles.length ||
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(asOfMs)
  ) {
    return null
  }

  const windowMs = Math.max(1, windowMinutes) * 60_000
  const startMs = asOfMs - windowMs
  let best = null
  let barsScanned = 0

  for (const c of candles) {
    if (!c || !Number.isFinite(c.t) || !Number.isFinite(c.close)) continue
    if (c.t < startMs || c.t > asOfMs) continue
    // Skip the exact “now” bar (0 lookback)
    if (asOfMs - c.t < 30_000) continue
    barsScanned += 1
    const pct = movePercent(currentPrice, c.close)
    if (pct == null || !Number.isFinite(pct)) continue
    if (!best || Math.abs(pct) > Math.abs(best.movePercent)) {
      const lookbackMinutes = Math.max(1, Math.round((asOfMs - c.t) / 60_000))
      best = {
        movePercent: pct,
        direction: pct >= 0 ? 'UP' : 'DOWN',
        lookbackMinutes,
        lookbackLabel:
          lookbackMinutes >= 60 && lookbackMinutes % 60 === 0
            ? `${lookbackMinutes / 60}h`
            : lookbackMinutes >= 60
              ? `${(lookbackMinutes / 60).toFixed(1)}h`
              : `${lookbackMinutes}m`,
        referencePrice: c.close,
        referenceTime: new Date(c.t).toISOString(),
        asOfTime: new Date(asOfMs).toISOString(),
        barsScanned: 0, // filled below
      }
    }
  }

  if (!best) return null
  best.barsScanned = barsScanned
  return best
}

/**
 * Order keys so the meaningful “today” move is first in pre/post,
 * then short tape windows, then long bridges.
 *
 * @param {string[]} keys
 * @param {string|null|undefined} marketSession
 */
export function orderReturnKeysForDisplay(keys, marketSession) {
  const list = [...(keys || [])]
  const session = String(marketSession || '').toUpperCase()
  const isExtended =
    session === 'PRE' || session === 'POST' || session === 'CLOSED'

  if (!isExtended || !list.includes('day')) return list

  // Day first during pre/post — that’s the 3.5% premarket number
  return ['day', ...list.filter((k) => k !== 'day')]
}

/**
 * Human label for a return key in the grid.
 * @param {string} key
 * @param {string|null|undefined} marketSession
 */
export function returnKeyLabel(key, marketSession) {
  if (key !== 'day') return key
  const session = String(marketSession || '').toUpperCase()
  if (session === 'PRE') return 'pre'
  if (session === 'POST') return 'post'
  if (session === 'CLOSED') return 'day'
  return 'day'
}
