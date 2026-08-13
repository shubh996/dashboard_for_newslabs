/**
 * Threshold detection — pure functions over returns + config.
 */
import { MOMENTUM_THRESHOLDS, MOMENTUM_WINDOWS } from './config.js'

/**
 * All windows (incl. day) that currently clear their absolute threshold.
 * @param {Record<string, number|null>} returns
 * @returns {Array<{ window: string, movePercent: number, direction: 'UP'|'DOWN', threshold: number }>}
 */
export function findThresholdCrosses(returns) {
  /** @type {Array<{ window: string, movePercent: number, direction: 'UP'|'DOWN', threshold: number }>} */
  const hits = []

  for (const w of MOMENTUM_WINDOWS) {
    if (w.threshold == null) continue // 1m etc. diagnostic only
    const v = returns[w.key]
    if (v == null || !Number.isFinite(v)) continue
    if (Math.abs(v) >= w.threshold) {
      hits.push({
        window: w.key,
        movePercent: v,
        direction: v >= 0 ? 'UP' : 'DOWN',
        threshold: w.threshold,
      })
    }
  }

  const day = returns.day
  if (day != null && Number.isFinite(day) && Math.abs(day) >= MOMENTUM_THRESHOLDS.day) {
    hits.push({
      window: 'day',
      movePercent: day,
      direction: day >= 0 ? 'UP' : 'DOWN',
      threshold: MOMENTUM_THRESHOLDS.day,
    })
  }

  hits.sort((a, b) => Math.abs(b.movePercent) - Math.abs(a.movePercent))
  return hits
}

/**
 * True if any monitored threshold window is still hot in `direction`.
 * @param {Record<string, number|null>} returns
 * @param {'UP'|'DOWN'} direction
 */
export function anyThresholdActive(returns, direction) {
  const hits = findThresholdCrosses(returns)
  return hits.some((h) => h.direction === direction)
}

/**
 * Opposite-direction threshold hit (for reverse).
 * @param {Record<string, number|null>} returns
 * @param {'UP'|'DOWN'} currentDirection
 */
export function oppositeThresholdHit(returns, currentDirection) {
  const hits = findThresholdCrosses(returns)
  return hits.find((h) => h.direction !== currentDirection) || null
}
