/**
 * Yahoo data freshness — not a market calendar (spec §11).
 * STALE ≠ market closed.
 */
import { MOMENTUM_POLL_MS } from './config.js'

const CLOCK_SKEW_SEC = 120

/**
 * @param {{
 *   quoteTimestampUtc?: string|number|null,
 *   nowUtc?: number,
 *   profile?: { freshnessGraceSec?: number, pollGraceMultiplier?: number }|null,
 *   pollIntervalSec?: number,
 * }} opts
 */
export function evaluateFreshness(opts = {}) {
  const nowMs = Number(opts.nowUtc) || Date.now()
  const raw = opts.quoteTimestampUtc
  let quoteMs = null
  if (raw != null && raw !== '') {
    quoteMs = typeof raw === 'number' ? raw : Date.parse(String(raw))
  }
  if (!Number.isFinite(quoteMs)) {
    return {
      state: 'MISSING',
      quoteTimestampUtc: null,
      quoteAgeSec: null,
      limitSec: null,
      reason: 'No Yahoo quote timestamp',
    }
  }

  const ageSec = (nowMs - quoteMs) / 1000
  if (quoteMs > nowMs + CLOCK_SKEW_SEC * 1000) {
    return {
      state: 'FUTURE_TIMESTAMP',
      quoteTimestampUtc: new Date(quoteMs).toISOString(),
      quoteAgeSec: ageSec,
      limitSec: CLOCK_SKEW_SEC,
      reason: 'Quote timestamp is in the future',
    }
  }

  const pollSec =
    Number(opts.pollIntervalSec) > 0
      ? Number(opts.pollIntervalSec)
      : Math.max(1, Math.round(MOMENTUM_POLL_MS / 1000))
  const minGrace = Number(opts.profile?.freshnessGraceSec)
  const mult = Number(opts.profile?.pollGraceMultiplier)
  const limitSec = Math.max(
    Number.isFinite(minGrace) && minGrace > 0 ? minGrace : 180,
    pollSec * (Number.isFinite(mult) && mult > 0 ? mult : 2),
  )

  if (ageSec <= limitSec) {
    return {
      state: 'FRESH',
      quoteTimestampUtc: new Date(quoteMs).toISOString(),
      quoteAgeSec: ageSec,
      limitSec,
      reason: 'Quote within freshness grace',
    }
  }

  return {
    state: 'STALE',
    quoteTimestampUtc: new Date(quoteMs).toISOString(),
    quoteAgeSec: ageSec,
    limitSec,
    reason: `Quote age ${Math.round(ageSec)}s exceeds ${Math.round(limitSec)}s grace`,
  }
}

function toMs(value) {
  if (value == null || value === '') return null
  const ms =
    typeof value === 'number'
      ? value < 1e12
        ? value * 1000
        : value
      : Date.parse(String(value))
  return Number.isFinite(ms) ? ms : null
}

/**
 * Prefer the *newest* usable print time.
 * Pre-market: preMarketTime is live while regularMarketTime is often Friday’s close.
 * Post-market: postMarketTime can be newer than the regular close stamp.
 */
export function extractQuoteTimestampMs(quote, sessionQuote, lastCandleMs) {
  const candidates = [
    sessionQuote?.live?.time,
    sessionQuote?.regular?.time,
    sessionQuote?.preMarket?.time,
    sessionQuote?.postMarket?.time,
    quote?.preMarketTime,
    quote?.postMarketTime,
    quote?.regularMarketTime,
    lastCandleMs,
  ]
  let best = null
  for (const c of candidates) {
    const ms = toMs(c)
    if (ms == null) continue
    if (best == null || ms > best) best = ms
  }
  return best
}
