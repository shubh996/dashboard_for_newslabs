/**
 * Threshold detection — pure functions over returns + config.
 */
import { getThresholdForKey, MOMENTUM_WINDOWS } from './config.js'

/**
 * Windows that may start / keep / reverse an ACTIVE episode.
 * ≤24h rolling + 1D/day only. Longer horizons (30h, 1w, 10d, …) still
 * compute returns and blink in the dashboard, but never open events.
 * @param {string|null|undefined} key
 */
export function isEpisodeEligibleWindow(key) {
  const k = String(key || '').trim()
  if (!k || k === '—') return false
  const lower = k.toLowerCase()
  if (k === 'day' || lower === '1d' || lower === '1day') return true
  if (
    k === '1w' ||
    k === '10d' ||
    k === '15d' ||
    k === '1M' ||
    k === '3M' ||
    k === '6M' ||
    k === 'YTD' ||
    k === '1y' ||
    k === '30h' ||
    k === '40h' ||
    k === '50h'
  ) {
    return false
  }
  const h = k.match(/^(\d+(?:\.\d+)?)h$/i)
  if (h) return Number(h[1]) <= 24
  const m = k.match(/^(\d+)m$/i)
  if (m) return Number(m[1]) > 0 && Number(m[1]) <= 24 * 60
  const d = k.match(/^(\d+)d$/i)
  if (d) return Number(d[1]) <= 1
  return false
}

/**
 * All windows (incl. day) that currently clear their absolute threshold.
 * @param {Record<string, number|null>} returns
 * @param {string|null|undefined} [assetClass] equity|commodity|forex|crypto|index
 * @returns {Array<{ window: string, movePercent: number, direction: 'UP'|'DOWN', threshold: number }>}
 */
/** Active |move %| band only when threshold is a positive number. 0 / null / blank = off. */
function isActiveThreshold(thr) {
  const n = Number(thr)
  return Number.isFinite(n) && n > 0
}

export function findThresholdCrosses(returns, assetClass = 'equity') {
  /** @type {Array<{ window: string, movePercent: number, direction: 'UP'|'DOWN', threshold: number }>} */
  const hits = []

  for (const w of MOMENTUM_WINDOWS) {
    const thr = getThresholdForKey(w.key, assetClass)
    // null / 0 / negative = diagnostic only — never start or feed episodes
    if (!isActiveThreshold(thr)) continue
    const v = returns[w.key]
    if (v == null || !Number.isFinite(v)) continue
    if (Math.abs(v) >= thr) {
      hits.push({
        window: w.key,
        movePercent: v,
        direction: v >= 0 ? 'UP' : 'DOWN',
        threshold: thr,
      })
    }
  }

  const day = returns.day
  const dayThr = getThresholdForKey('day', assetClass)
  if (
    day != null &&
    Number.isFinite(day) &&
    isActiveThreshold(dayThr) &&
    Math.abs(day) >= dayThr
  ) {
    hits.push({
      window: 'day',
      movePercent: day,
      direction: day >= 0 ? 'UP' : 'DOWN',
      threshold: dayThr,
    })
  }

  hits.sort((a, b) => Math.abs(b.movePercent) - Math.abs(a.movePercent))
  return hits
}

/**
 * Threshold hits that may drive the episode state machine (≤24h + 1D).
 * @param {Record<string, number|null>} returns
 * @param {string|null|undefined} [assetClass]
 */
export function findEpisodeThresholdCrosses(returns, assetClass = 'equity') {
  return findThresholdCrosses(returns, assetClass).filter((h) =>
    isEpisodeEligibleWindow(h.window),
  )
}

/**
 * Nominal duration rank for START selection (shortest wins).
 * day ≈ full session / calendar day proxy so it loses to intraday windows.
 * @param {string} windowKey
 * @returns {number}
 */
export function episodeWindowRankMinutes(windowKey) {
  const k = String(windowKey || '').trim()
  if (!k) return Number.POSITIVE_INFINITY
  const lower = k.toLowerCase()
  if (k === 'day' || lower === '1d' || lower === '1day') return 24 * 60
  const m = k.match(/^(\d+(?:\.\d+)?)m$/i)
  if (m) return Number(m[1])
  const h = k.match(/^(\d+(?:\.\d+)?)h$/i)
  if (h) return Number(h[1]) * 60
  const d = k.match(/^(\d+(?:\.\d+)?)d$/i)
  if (d) return Number(d[1]) * 24 * 60
  if (k === '1w') return 7 * 24 * 60
  if (k === '1M') return 30 * 24 * 60
  return Number.POSITIVE_INFINITY
}

/**
 * Pick the single START hit when many windows qualify.
 *
 * Rule: the **shortest qualifying window among all eligible hits** wins.
 * That window also determines direction — we do NOT pick direction from
 * strongest |move%| first (a stale 24h −8% must not beat a fresh 5m +3.5%).
 *
 * Within equal duration: larger |move| then lower threshold as tie-break.
 * Never emit multiple STARTs for longer co-qualifying windows.
 *
 * @param {Array<{ window: string, movePercent: number, direction: 'UP'|'DOWN', threshold: number }>} hits
 * @returns {typeof hits[0]|null}
 */
export function pickShortestStartHit(hits) {
  if (!hits?.length) return null
  const eligible = hits.filter((h) => h && isEpisodeEligibleWindow(h.window))
  if (!eligible.length) return null
  eligible.sort((a, b) => {
    const da = episodeWindowRankMinutes(a.window)
    const db = episodeWindowRankMinutes(b.window)
    if (da !== db) return da - db
    // same duration: larger |move| then lower threshold
    const ma = Math.abs(a.movePercent) - Math.abs(b.movePercent)
    if (ma !== 0) return -ma
    return (a.threshold || 0) - (b.threshold || 0)
  })
  return eligible[0] || null
}

/**
 * Max |move %| in `direction` across eligible windows (hits + raw returns).
 * @param {Record<string, number|null|undefined>|null|undefined} returns
 * @param {Array<{ window?: string, movePercent?: number, direction?: string }>|null|undefined} hits
 * @param {'UP'|'DOWN'} direction
 * @returns {number}
 */
export function maxAbsMoveInDirection(returns, hits, direction) {
  const dir = direction === 'DOWN' ? 'DOWN' : 'UP'
  let abs = 0
  for (const h of hits || []) {
    if (!h || (h.direction === 'DOWN' ? 'DOWN' : 'UP') !== dir) continue
    const n = Math.abs(Number(h.movePercent) || 0)
    if (n > abs) abs = n
  }
  if (returns && typeof returns === 'object') {
    for (const [wk, v] of Object.entries(returns)) {
      if (!isEpisodeEligibleWindow(wk)) continue
      const n = Number(v)
      if (!Number.isFinite(n)) continue
      const d = n >= 0 ? 'UP' : 'DOWN'
      if (d !== dir) continue
      const a = Math.abs(n)
      if (a > abs) abs = a
    }
  }
  return abs
}

/**
 * Episode-eligible window keys that currently have an active (positive) threshold.
 * @param {string|null|undefined} [assetClass]
 * @returns {string[]}
 */
export function listActiveEpisodeThresholdWindows(assetClass = 'equity') {
  /** @type {string[]} */
  const keys = []
  for (const w of MOMENTUM_WINDOWS) {
    if (!isEpisodeEligibleWindow(w.key)) continue
    if (!isActiveThreshold(getThresholdForKey(w.key, assetClass))) continue
    keys.push(w.key)
  }
  if (isActiveThreshold(getThresholdForKey('day', assetClass))) {
    keys.push('day')
  }
  return keys
}

/**
 * Per-window re-arm floor: startThreshold(window) − buffer.
 * @param {string} windowKey
 * @param {string|null|undefined} [assetClass]
 * @param {number} [bufferPp]
 * @returns {number|null} null if window thr is off
 */
export function rearmFloorForWindow(windowKey, assetClass = 'equity', bufferPp = 1) {
  const thr = Number(getThresholdForKey(windowKey, assetClass))
  if (!isActiveThreshold(thr)) return null
  const buf = Math.max(0, Number(bufferPp) || 0)
  return Math.max(0, thr - buf)
}

/**
 * Is this window cool enough for `direction` re-arm?
 * Cool if: no finite move, move opposite to direction, or |move| < thr−buffer.
 *
 * @param {string} windowKey
 * @param {number|null|undefined} movePercent
 * @param {'UP'|'DOWN'} direction
 * @param {string|null|undefined} [assetClass]
 * @param {number} [bufferPp]
 * @returns {boolean}
 */
export function isWindowCoolForDirection(
  windowKey,
  movePercent,
  direction,
  assetClass = 'equity',
  bufferPp = 1,
) {
  const floor = rearmFloorForWindow(windowKey, assetClass, bufferPp)
  if (floor == null) return true // thr off → ignore
  const n = Number(movePercent)
  if (!Number.isFinite(n)) return true
  const dir = direction === 'DOWN' ? 'DOWN' : 'UP'
  const moveDir = n >= 0 ? 'UP' : 'DOWN'
  if (moveDir !== dir) return true // opposite side does not block this direction
  return Math.abs(n) + 1e-9 < floor
}

/**
 * FULL re-arm: every same-direction eligible window must be below its own thr−buffer.
 * Returns { cool, blockers: [{window, move, floor, thr}] }.
 *
 * @param {Record<string, number|null|undefined>|null|undefined} returns
 * @param {'UP'|'DOWN'} direction
 * @param {string|null|undefined} [assetClass]
 * @param {number} [bufferPp]
 */
export function evaluatePerWindowRearm(
  returns,
  direction,
  assetClass = 'equity',
  bufferPp = 1,
) {
  const dir = direction === 'DOWN' ? 'DOWN' : 'UP'
  /** @type {Array<{ window: string, move: number, floor: number, thr: number }>} */
  const blockers = []
  for (const wk of listActiveEpisodeThresholdWindows(assetClass)) {
    const thr = Number(getThresholdForKey(wk, assetClass))
    const floor = rearmFloorForWindow(wk, assetClass, bufferPp)
    if (floor == null) continue
    const v = returns && typeof returns === 'object' ? returns[wk] : null
    if (!isWindowCoolForDirection(wk, v, dir, assetClass, bufferPp)) {
      blockers.push({
        window: wk,
        move: Number(v),
        floor,
        thr,
      })
    }
  }
  return { cool: blockers.length === 0, blockers, direction: dir }
}

/**
 * Snapshot of threshold edge state for crossing detection.
 * @param {Record<string, number|null|undefined>|null|undefined} returns
 * @param {string|null|undefined} [assetClass]
 * @returns {Record<string, { above: boolean, direction: 'UP'|'DOWN'|null, move: number|null, thr: number }>}
 */
export function buildThresholdEdgeSnapshot(returns, assetClass = 'equity') {
  /** @type {Record<string, { above: boolean, direction: 'UP'|'DOWN'|null, move: number|null, thr: number }>} */
  const snap = {}
  for (const wk of listActiveEpisodeThresholdWindows(assetClass)) {
    const thr = Number(getThresholdForKey(wk, assetClass))
    const v = returns && typeof returns === 'object' ? returns[wk] : null
    const n = Number(v)
    const finite = Number.isFinite(n)
    const above = finite && Math.abs(n) >= thr
    snap[wk] = {
      above,
      direction: above ? (n >= 0 ? 'UP' : 'DOWN') : finite ? (n >= 0 ? 'UP' : 'DOWN') : null,
      move: finite ? n : null,
      thr,
    }
  }
  return snap
}

/**
 * Keep only hits that are *fresh crosses*: previously not above thr in the same direction.
 * Cold start (no prev snapshot) → empty list (caller seeds state; no START).
 *
 * @param {Array<{ window: string, movePercent: number, direction: 'UP'|'DOWN', threshold: number }>} hits
 * @param {Record<string, { above?: boolean, direction?: string|null }>|null|undefined} prevSnapshot
 */
export function filterFreshThresholdCrosses(hits, prevSnapshot) {
  if (!prevSnapshot || typeof prevSnapshot !== 'object') return []
  return (hits || []).filter((h) => {
    if (!h?.window) return false
    const prev = prevSnapshot[h.window]
    if (!prev) {
      // Never observed this window → require a full cool observation first
      return false
    }
    const wasAboveSameDir =
      Boolean(prev.above) &&
      String(prev.direction || '').toUpperCase() === h.direction
    return !wasAboveSameDir
  })
}

/**
 * True if any ≤24h / 1D threshold window is still hot in `direction`.
 * @param {Record<string, number|null>} returns
 * @param {'UP'|'DOWN'} direction
 * @param {string|null|undefined} [assetClass]
 */
export function anyThresholdActive(returns, direction, assetClass = 'equity') {
  const hits = findEpisodeThresholdCrosses(returns, assetClass)
  return hits.some((h) => h.direction === direction)
}

/**
 * Opposite-direction threshold hit (for reverse). Ignores >24h windows.
 * @param {Record<string, number|null>} returns
 * @param {'UP'|'DOWN'} currentDirection
 * @param {string|null|undefined} [assetClass]
 */
export function oppositeThresholdHit(returns, currentDirection, assetClass = 'equity') {
  const hits = findEpisodeThresholdCrosses(returns, assetClass).filter(
    (h) => h.direction !== currentDirection,
  )
  // Prefer shortest opposite window for reverse (consistent with START selection)
  return pickShortestStartHit(hits)
}
