/**
 * Normalize Yahoo chart payloads into sorted 1m candles.
 */

/**
 * @typedef {{ t: number, close: number, open?: number|null, high?: number|null, low?: number|null, volume?: number|null }} Candle
 */

import {
  etPartsAt,
  etWallToUtcMs,
  inferUsEquityMarketSession,
} from './usEquitySession.js'

function num(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Infer session from America/New_York wall-clock (fallback if Yahoo marketState missing).
 * Overnight Sun 20:00 ET is PRE; Fri 20:00 ET → Sun 20:00 ET is CLOSED.
 * @param {number} ms
 * @returns {'PRE'|'REGULAR'|'POST'|'CLOSED'}
 */
export function inferMarketSession(ms) {
  return inferUsEquityMarketSession(ms)
}

/**
 * True when Yahoo says the main/regular session is live.
 * This is the cross-exchange engine run signal (US RTH, NSE cash, LSE, …)
 * without hard-coding each country's clock.
 *
 * PRE / PREPRE / POST / POSTPOST / CLOSED → not regular → do not run momentum.
 *
 * @param {string|null|undefined} marketState
 */
export function isYahooRegularMarketState(marketState) {
  const s = String(marketState || '')
    .trim()
    .toUpperCase()
  return s === 'REGULAR' || s === 'OPEN'
}

/**
 * Map Yahoo `marketState` (+ ET clock fallback) to a short session code.
 * @param {string|null|undefined} marketState
 * @param {number} [asOfMs]
 * @returns {'PRE'|'REGULAR'|'POST'|'CLOSED'}
 */
export function resolveMarketSession(marketState, asOfMs = Date.now()) {
  const s = String(marketState || '')
    .trim()
    .toUpperCase()
  if (s === 'PRE' || s === 'PREPRE') return 'PRE'
  if (s === 'REGULAR' || s === 'OPEN') return 'REGULAR'
  if (s === 'POST' || s === 'POSTPOST') return 'POST'
  if (s === 'CLOSED' || s === 'CLOSE') {
    // After close Yahoo often stays CLOSED while postMarketPrice is still updating
    const clock = inferMarketSession(asOfMs)
    if (clock === 'POST' || clock === 'PRE') return clock
    return 'CLOSED'
  }
  return inferMarketSession(asOfMs)
}

export function sessionLabel(session) {
  if (session === 'PRE') return 'Pre-market'
  if (session === 'POST') return 'After-hours'
  if (session === 'REGULAR') return 'Regular hours'
  return 'Market closed'
}

/**
 * Classify Yahoo symbol for last-session rules.
 * Equities have full US RTH; commodities/futures have Globex day breaks;
 * crypto is 24/7 calendar-day; FX is week-long with weekend gap.
 * @param {string|null|undefined} symbol
 * @returns {'equity'|'commodity'|'crypto'|'forex'|'other'}
 */
export function classifyMomentumAsset(symbol) {
  const t = String(symbol || '').toUpperCase().trim()
  if (!t) return 'other'
  if (t.endsWith('=F') || /^(GC|SI|CL|NG|HG|ZC|ZW|ZS|KE|PA|PL)=F$/.test(t)) {
    return 'commodity'
  }
  if (t.endsWith('-USD') || t.endsWith('-USDT') || t.endsWith('-EUR') || t === 'BTC' || t === 'ETH') {
    return 'crypto'
  }
  if (t.endsWith('=X') || /^[A-Z]{6}$/.test(t)) return 'forex'
  if (t.startsWith('^')) return 'equity'
  return 'equity'
}

/**
 * Most recent completed America/New_York wall-clock H:M on a weekday (Mon–Fri).
 * @param {number} hourEt
 * @param {number} minuteEt
 * @param {number} [nowMs]
 * @returns {string|null} ISO
 */
export function estimateLastWeekdayEtCloseIso(hourEt, minuteEt, nowMs = Date.now()) {
  const targetMins = hourEt * 60 + minuteEt
  for (let back = 0; back < 12; back += 1) {
    const probe = nowMs - back * 24 * 60 * 60 * 1000
    const p = etPartsAt(probe)
    if (p.weekday === 'Sat' || p.weekday === 'Sun') continue
    if (back === 0) {
      const mins = p.hour * 60 + p.minute
      // Today only counts once the boundary is strictly in the past
      if (mins < targetMins) continue
    }
    const closeMs = etWallToUtcMs(p.year, p.month, p.day, hourEt, minuteEt)
    if (closeMs != null && closeMs < nowMs - 30_000) {
      return new Date(closeMs).toISOString()
    }
  }
  return null
}

/**
 * Last completed US cash RTH close (16:00 America/New_York weekday).
 * @param {number} [nowMs]
 */
export function estimateLastRthCloseIso(nowMs = Date.now()) {
  return estimateLastWeekdayEtCloseIso(16, 0, nowMs)
}

/**
 * CME Globex daily maintenance break ≈ 17:00 ET (Metals / energy / many futures).
 * “Last session” for gold/silver/oil ≈ last completed 17:00 ET weekday boundary.
 * @param {number} [nowMs]
 */
export function estimateLastFuturesSessionIso(nowMs = Date.now()) {
  return estimateLastWeekdayEtCloseIso(17, 0, nowMs)
}

/**
 * Crypto daily reference: prior UTC midnight (Yahoo’s prior-day close convention).
 * @param {number} [nowMs]
 */
export function estimateCryptoPriorCloseIso(nowMs = Date.now()) {
  const d = new Date(nowMs)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString()
}

/**
 * FX “New York close” convention ≈ 17:00 ET prior weekday.
 * @param {number} [nowMs]
 */
export function estimateLastFxSessionIso(nowMs = Date.now()) {
  return estimateLastWeekdayEtCloseIso(17, 0, nowMs)
}

/**
 * Resolve last-session clock + human label by asset class.
 * Price still comes from Yahoo previousClose; this only anchors the DATE/TIME
 * and the UI wording (stocks ≠ gold ≠ bitcoin).
 *
 * @param {string|null|undefined} symbol
 * @param {number} [nowMs]
 * @returns {{
 *   timeIso: string|null,
 *   kind: 'rth'|'futures_daily'|'crypto_day'|'fx_day'|'other',
 *   label: string,
 *   shortLabel: string,
 *   assetClass: string,
 * }}
 */
export function resolveLastSessionMeta(symbol, nowMs = Date.now()) {
  const assetClass = classifyMomentumAsset(symbol)
  if (assetClass === 'crypto') {
    return {
      timeIso: estimateCryptoPriorCloseIso(nowMs),
      kind: 'crypto_day',
      label: 'Prior UTC day close',
      shortLabel: 'Prior day',
      assetClass,
    }
  }
  if (assetClass === 'commodity') {
    return {
      timeIso: estimateLastFuturesSessionIso(nowMs),
      kind: 'futures_daily',
      // Globex daily break ~5pm ET — not the same as stock 4pm cash close
      label: 'Last futures session (≈5pm ET)',
      shortLabel: 'Last session',
      assetClass,
    }
  }
  if (assetClass === 'forex') {
    return {
      timeIso: estimateLastFxSessionIso(nowMs),
      kind: 'fx_day',
      label: 'Prior NY FX close (≈5pm ET)',
      shortLabel: 'Prior day',
      assetClass,
    }
  }
  // Equity / index default: cash RTH 4pm ET
  return {
    timeIso: estimateLastRthCloseIso(nowMs),
    kind: 'rth',
    label: 'Prior regular close (4pm ET)',
    shortLabel: 'Previous close',
    assetClass,
  }
}

/**
 * @param {string|null|undefined} symbol
 * @param {number} [nowMs]
 */
export function estimatePreviousCloseTimeIso(symbol, nowMs = Date.now()) {
  return resolveLastSessionMeta(symbol, nowMs).timeIso
}

/**
 * Resolve the **last completed regular-session close** for display + day %.
 *
 * Yahoo field gotcha (equities in PRE/POST):
 * - `regularMarketPrice` is often **frozen at Friday’s RTH close**
 * - `regularMarketPreviousClose` is often **Thursday’s close** (one session further back)
 * Using previousClose alone shows the wrong “Previous close” on Mon premarket.
 *
 * Rule:
 * - PRE / POST / CLOSED+extended → prefer frozen `regularMarketPrice` as last RTH close
 * - REGULAR → `regularMarketPreviousClose` (prior session)
 *
 * When Yahoo omits a close timestamp (futures, crypto, REGULAR equities), we
 * estimate the prior session/day close clock so the UI can show a date.
 *
 * @param {Record<string, unknown>} q
 * @param {Record<string, unknown>} m
 * @param {'PRE'|'REGULAR'|'POST'|'CLOSED'} session
 * @param {string} [symbol]
 */
export function resolveLastRegularClose(q, m, session, symbol = '') {
  const n = num
  const regPrice = n(q.regularMarketPrice) ?? n(m.regularMarketPrice) ?? null
  const yahooPrev =
    n(q.regularMarketPreviousClose) ??
    n(q.previousClose) ??
    n(m.previousClose) ??
    n(m.chartPreviousClose) ??
    null

  const regTimeRaw = q.regularMarketTime ?? m.regularMarketTime ?? null
  let regTimeIso = null
  if (regTimeRaw != null) {
    try {
      regTimeIso = new Date(regTimeRaw).toISOString()
    } catch {
      regTimeIso = null
    }
  }

  const preTimeRaw = q.preMarketTime ?? m.preMarketTime ?? null
  const postTimeRaw = q.postMarketTime ?? m.postMarketTime ?? null
  let preTimeMs = null
  let postTimeMs = null
  let regTimeMs = null
  try {
    if (preTimeRaw != null) preTimeMs = new Date(preTimeRaw).getTime()
    if (postTimeRaw != null) postTimeMs = new Date(postTimeRaw).getTime()
    if (regTimeRaw != null) regTimeMs = new Date(regTimeRaw).getTime()
  } catch {
    /* ignore */
  }

  // Is regularMarketPrice a frozen last-RTH print (not a live regular print)?
  // True when pre/post exists and reg time is clearly before the extended print.
  const regLooksFrozen =
    regPrice != null &&
    regTimeMs != null &&
    ((preTimeMs != null && regTimeMs < preTimeMs - 60_000) ||
      (postTimeMs != null && regTimeMs < postTimeMs - 60_000) ||
      session === 'PRE' ||
      session === 'POST' ||
      session === 'CLOSED')

  const lastSession = resolveLastSessionMeta(symbol, Date.now())
  const estimatedTime = lastSession.timeIso

  if (
    (session === 'PRE' || session === 'POST' || session === 'CLOSED') &&
    regLooksFrozen &&
    regPrice != null
  ) {
    // Equities: frozen regularMarketTime is the real last RTH print clock.
    // Futures/crypto: prefer class session estimate (5pm Globex / UTC day).
    const useRegTime =
      lastSession.kind === 'rth' && regTimeIso ? regTimeIso : estimatedTime
    return {
      previousClose: regPrice,
      previousCloseTime: useRegTime || estimatedTime,
      previousCloseSource: 'regularMarketPrice',
      yahooPreviousClose: yahooPrev,
      lastSessionKind: lastSession.kind,
      lastSessionLabel: lastSession.label,
      lastSessionShortLabel: lastSession.shortLabel,
      assetClass: lastSession.assetClass,
    }
  }

  // Regular / continuous: Yahoo previousClose PRICE is authoritative for day %.
  // Time is estimated by asset class (RTH 4pm / futures 5pm / crypto UTC day / FX 5pm).
  // Never use live regularMarketTime here — that's the last trade, not prior session end.
  return {
    previousClose: yahooPrev ?? regPrice,
    previousCloseTime: estimatedTime,
    previousCloseSource: yahooPrev != null ? 'regularMarketPreviousClose' : 'regularMarketPrice',
    yahooPreviousClose: yahooPrev,
    lastSessionKind: lastSession.kind,
    lastSessionLabel: lastSession.label,
    lastSessionShortLabel: lastSession.shortLabel,
    assetClass: lastSession.assetClass,
  }
}

/**
 * Build extended-hours quote block from Yahoo quote + chart meta.
 * @param {Record<string, unknown>|null|undefined} quote
 * @param {Record<string, unknown>|null|undefined} chartMeta
 */
export function buildSessionQuote(quote, chartMeta) {
  const q = quote && typeof quote === 'object' ? quote : {}
  const m = chartMeta && typeof chartMeta === 'object' ? chartMeta : {}
  const n = (v) => {
    const x = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(x) ? x : null
  }

  const marketState = String(q.marketState || m.marketState || '').trim() || null
  const session = resolveMarketSession(marketState, Date.now())

  const regularPrice =
    n(q.regularMarketPrice) ?? n(m.regularMarketPrice) ?? null
  const regularChange = n(q.regularMarketChange)
  const regularChangePercent = n(q.regularMarketChangePercent)

  const symbol = String(q.symbol || m.symbol || '').toUpperCase()
  const {
    previousClose,
    previousCloseTime,
    previousCloseSource,
    yahooPreviousClose,
    lastSessionKind,
    lastSessionLabel,
    lastSessionShortLabel,
    assetClass,
  } = resolveLastRegularClose(q, m, session, symbol)

  const preMarketPrice = n(q.preMarketPrice) ?? n(m.preMarketPrice)
  const preMarketChange = n(q.preMarketChange) ?? n(m.preMarketChange)
  const preMarketChangePercent =
    n(q.preMarketChangePercent) ?? n(m.preMarketChangePercent)
  const preMarketTime = q.preMarketTime
    ? new Date(q.preMarketTime).toISOString()
    : m.preMarketTime
      ? new Date(m.preMarketTime).toISOString()
      : null

  const postMarketPrice = n(q.postMarketPrice) ?? n(m.postMarketPrice)
  const postMarketChange = n(q.postMarketChange) ?? n(m.postMarketChange)
  const postMarketChangePercent =
    n(q.postMarketChangePercent) ?? n(m.postMarketChangePercent)
  const postMarketTime = q.postMarketTime
    ? new Date(q.postMarketTime).toISOString()
    : m.postMarketTime
      ? new Date(m.postMarketTime).toISOString()
      : null

  // “Live” price for the active session (what Yahoo highlights)
  let livePrice = regularPrice
  let liveChange = regularChange
  let liveChangePercent = regularChangePercent
  /** Yahoo’s own pre/post % (usually vs last RTH close) */
  let yahooSessionChangePercent = regularChangePercent
  if (session === 'PRE' && preMarketPrice != null) {
    livePrice = preMarketPrice
    liveChange = preMarketChange
    liveChangePercent = preMarketChangePercent
    yahooSessionChangePercent = preMarketChangePercent
  } else if (session === 'POST' && postMarketPrice != null) {
    livePrice = postMarketPrice
    liveChange = postMarketChange
    liveChangePercent = postMarketChangePercent
    yahooSessionChangePercent = postMarketChangePercent
  } else if (session === 'CLOSED' && postMarketPrice != null) {
    // After bell many quotes still publish post prices while state is CLOSED
    livePrice = postMarketPrice
    liveChange = postMarketChange
    liveChangePercent = postMarketChangePercent
    yahooSessionChangePercent = postMarketChangePercent
  }

  // Day / session move = live print vs **last regular close** (resolved above)
  let dayChange = null
  let dayChangePercent = null
  if (
    livePrice != null &&
    previousClose != null &&
    Number.isFinite(livePrice) &&
    Number.isFinite(previousClose) &&
    previousClose !== 0
  ) {
    dayChange = livePrice - previousClose
    dayChangePercent = (dayChange / previousClose) * 100
  }

  // Prefer our day% in extended hours (matches Yahoo pre % when prev close is last RTH)
  if (
    (session === 'PRE' ||
      session === 'POST' ||
      (session === 'CLOSED' && (preMarketPrice != null || postMarketPrice != null))) &&
    dayChangePercent != null
  ) {
    liveChange = dayChange
    liveChangePercent = dayChangePercent
  }

  const isExtendedHours = session === 'PRE' || session === 'POST'
  // Blink when pre/post or when closed-but-post data exists
  const showExtendedBadge =
    isExtendedHours ||
    (session === 'CLOSED' && postMarketPrice != null) ||
    (session === 'CLOSED' && preMarketPrice != null)

  let badge = null
  if (session === 'PRE' || (session === 'CLOSED' && preMarketPrice != null && postMarketPrice == null)) {
    badge = { code: 'PRE', label: 'Pre-market hours' }
  } else if (
    session === 'POST' ||
    (session === 'CLOSED' && postMarketPrice != null)
  ) {
    badge = { code: 'POST', label: 'After-hours' }
  }

  /** Human Yahoo market state for UI (not raw CLOSED when post is live) */
  let marketStateLabel = 'Closed'
  if (session === 'PRE') marketStateLabel = 'Pre-market'
  else if (session === 'POST') marketStateLabel = 'Post-market'
  else if (session === 'REGULAR') marketStateLabel = 'Regular hours'
  else if (marketState) {
    const raw = String(marketState).toUpperCase()
    if (raw.includes('PRE')) marketStateLabel = 'Pre-market'
    else if (raw.includes('POST')) marketStateLabel = 'Post-market'
    else if (raw === 'REGULAR' || raw === 'OPEN') marketStateLabel = 'Regular hours'
    else marketStateLabel = 'Closed'
  }

  return {
    marketState,
    marketStateLabel,
    session,
    sessionLabel: sessionLabel(session),
    isExtendedHours,
    showExtendedBadge,
    badge,
    previousClose,
    previousCloseTime,
    previousCloseSource,
    yahooPreviousClose,
    /** Asset-aware last session (stocks 4pm · futures 5pm · crypto UTC day · FX 5pm) */
    lastSessionKind: lastSessionKind || null,
    lastSessionLabel: lastSessionLabel || null,
    lastSessionShortLabel: lastSessionShortLabel || null,
    assetClass: assetClass || null,
    regular: {
      price: regularPrice,
      change: regularChange,
      changePercent: regularChangePercent,
      time: previousCloseTime,
    },
    preMarket: {
      price: preMarketPrice,
      change: preMarketChange,
      changePercent: preMarketChangePercent,
      time: preMarketTime,
    },
    postMarket: {
      price: postMarketPrice,
      change: postMarketChange,
      changePercent: postMarketChangePercent,
      time: postMarketTime,
    },
    live: {
      price: livePrice,
      change: liveChange,
      changePercent: liveChangePercent,
    },
    /** Always vs previousClose when both known — the “day / premarket move” people quote */
    day: {
      price: livePrice,
      change: dayChange,
      changePercent: dayChangePercent,
    },
    /** Raw Yahoo session % (pre/post may be vs last regular, not prior close) */
    yahooSessionChangePercent,
  }
}

/**
 * Accept yahoo-finance2 chart shape `{ meta, quotes }` or raw v8 chart.
 * @returns {{ candles: Candle[], meta: Record<string, unknown>, previousClose: number|null, currentPrice: number|null }}
 */
export function normalizeYahooChart(chartBody) {
  const root = chartBody?.chart?.result?.[0]
    ? chartBody.chart.result[0]
    : chartBody?.quotes
      ? chartBody
      : chartBody?.chart || chartBody

  const meta = root?.meta || chartBody?.meta || {}
  const previousClose =
    num(meta.previousClose) ??
    num(meta.chartPreviousClose) ??
    num(meta.regularMarketPreviousClose) ??
    null
  // Prefer live extended price when Yahoo is in pre/post; fall back to regular / last bar
  const currentPrice =
    num(meta.postMarketPrice) ??
    num(meta.preMarketPrice) ??
    num(meta.regularMarketPrice) ??
    null

  /** @type {Candle[]} */
  const candles = []
  const seen = new Set()

  if (Array.isArray(root?.quotes)) {
    for (const row of root.quotes) {
      const t = new Date(row.date || row.timestamp || 0).getTime()
      const close = num(row.close ?? row.adjclose)
      if (!Number.isFinite(t) || close == null) continue
      if (seen.has(t)) continue
      seen.add(t)
      candles.push({
        t,
        close,
        open: num(row.open),
        high: num(row.high),
        low: num(row.low),
        volume: num(row.volume),
      })
    }
  } else if (Array.isArray(root?.timestamp)) {
    const q = root.indicators?.quote?.[0] || {}
    const closes = q.close || []
    for (let i = 0; i < root.timestamp.length; i += 1) {
      const t = Number(root.timestamp[i]) * 1000
      const close = num(closes[i])
      if (!Number.isFinite(t) || close == null) continue
      if (seen.has(t)) continue
      seen.add(t)
      candles.push({
        t,
        close,
        open: num(q.open?.[i]),
        high: num(q.high?.[i]),
        low: num(q.low?.[i]),
        volume: num(q.volume?.[i]),
      })
    }
  }

  candles.sort((a, b) => a.t - b.t)

  // Prefer last candle close if meta price missing
  const lastClose = candles.length ? candles[candles.length - 1].close : null
  return {
    candles,
    meta,
    previousClose,
    currentPrice: currentPrice ?? lastClose,
  }
}

/**
 * Drop Yahoo 1m outlier prints that poison reference prices.
 *
 * Recurring failure mode (esp. pre/post): tape shows a garbage print
 * (e.g. MSFT 467 while live/post ≈ 482) while the quote stream is correct.
 * Live price stays right; `candleAtOrBefore` then freezes that bad close as
 * `referencePrice` → absurd move %.
 *
 * A bar is removed only when it is far from the local rolling median **and**
 * far from every quote anchor (live / regular / previous close). Real spikes
 * that agree with the live quote are kept.
 *
 * @param {Candle[]} candles sorted asc
 * @param {{
 *   anchors?: Array<number|null|undefined>,
 *   neighborRadius?: number,
 *   medianDevPct?: number,
 *   anchorDevPct?: number,
 * }} [opts]
 * @returns {Candle[]}
 */
export function sanitizeMomentumCandles(candles, opts = {}) {
  if (!Array.isArray(candles) || candles.length < 3) {
    return Array.isArray(candles) ? candles : []
  }
  const neighborRadius = Math.max(2, Math.round(Number(opts.neighborRadius) || 4))
  const medianDevPct = Number(opts.medianDevPct)
  const medPct = Number.isFinite(medianDevPct) && medianDevPct > 0 ? medianDevPct : 1.5
  const anchorDevPct = Number(opts.anchorDevPct)
  const ancPct =
    Number.isFinite(anchorDevPct) && anchorDevPct > 0 ? anchorDevPct : 1.25
  const anchors = (opts.anchors || [])
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((n) => Number.isFinite(n) && n > 0)

  const closes = candles.map((c) =>
    c && Number.isFinite(c.close) && c.close > 0 ? c.close : null,
  )
  /** @type {Candle[]} */
  const out = []

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i]
    const close = closes[i]
    if (!c || close == null) continue

    const lo = Math.max(0, i - neighborRadius)
    const hi = Math.min(candles.length - 1, i + neighborRadius)
    /** @type {number[]} */
    const window = []
    for (let j = lo; j <= hi; j += 1) {
      if (j === i) continue
      const v = closes[j]
      if (v != null) window.push(v)
    }
    if (window.length < 3) {
      out.push(c)
      continue
    }
    window.sort((a, b) => a - b)
    const med = window[Math.floor(window.length / 2)]
    if (!Number.isFinite(med) || med <= 0) {
      out.push(c)
      continue
    }
    const vsMedPct = (Math.abs(close - med) / med) * 100
    if (vsMedPct <= medPct) {
      out.push(c)
      continue
    }

    // Far from local tape. Keep only if it still matches an official quote.
    if (anchors.length) {
      const nearAnchor = anchors.some(
        (a) => (Math.abs(close - a) / a) * 100 <= ancPct,
      )
      if (nearAnchor) {
        out.push(c)
        continue
      }
      continue // drop
    }

    // No quote anchors — only drop extreme median outliers
    if (vsMedPct > Math.max(medPct * 2, 3)) continue
    out.push(c)
  }

  return out
}

/**
 * Closest candle at or immediately before `targetMs`.
 * @param {Candle[]} candles sorted asc
 * @param {number} targetMs
 * @returns {Candle|null}
 */
export function candleAtOrBefore(candles, targetMs) {
  if (!candles.length || !Number.isFinite(targetMs)) return null
  // binary search
  let lo = 0
  let hi = candles.length - 1
  let best = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = candles[mid]
    if (c.t <= targetMs) {
      best = c
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

/** First candle strictly after `afterMs` (binary search). */
export function firstCandleAfter(candles, afterMs) {
  if (!candles.length || !Number.isFinite(afterMs)) return null
  let lo = 0
  let hi = candles.length - 1
  let best = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = candles[mid]
    if (c.t > afterMs) {
      best = c
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  return best
}

/**
 * First candle at or after `targetMs` (binary search).
 * @param {Candle[]} candles sorted asc
 * @param {number} targetMs
 * @returns {Candle|null}
 */
export function firstCandleAtOrAfter(candles, targetMs) {
  if (!candles.length || !Number.isFinite(targetMs)) return null
  let lo = 0
  let hi = candles.length - 1
  let best = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = candles[mid]
    if (c.t >= targetMs) {
      best = c
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  return best
}

/**
 * Scheduled open of the current extended / regular session (ET wall clock).
 * Used so PRE lookback can show “when pre-market tape started”, not Friday close.
 *
 * @param {string|null|undefined} marketSession  PRE | PREPRE | POST | POSTPOST | REGULAR | CLOSED
 * @param {number} [asOfMs]
 * @returns {{
 *   openMs: number|null,
 *   label: string,
 *   shortLabel: string,
 *   session: string,
 * }|null}
 */
export function resolveSessionOpenClock(marketSession, asOfMs = Date.now()) {
  const sess = String(marketSession || '').trim().toUpperCase()
  const p = etPartsAt(asOfMs)
  if (!p.year || !p.month || !p.day) return null

  const y = p.year
  const mo = p.month
  const d = p.day
  /** @type {number} */
  let openMin
  /** @type {string} */
  let label
  /** @type {string} */
  let shortLabel

  if (sess === 'PRE') {
    openMin = 4 * 60 // 04:00 ET same calendar day
    label = 'Pre-market open (4:00 AM ET)'
    shortLabel = 'Pre open'
  } else if (sess === 'PREPRE') {
    openMin = 20 * 60 // 20:00 ET
    label = 'Overnight open (8:00 PM ET)'
    shortLabel = 'Overnight open'
  } else if (sess === 'POST' || sess === 'POSTPOST') {
    openMin = 16 * 60 // 16:00 ET
    label = 'After-hours open (4:00 PM ET)'
    shortLabel = 'AH open'
  } else if (sess === 'REGULAR' || sess === 'OPEN') {
    openMin = 9 * 60 + 30
    label = 'Regular open (9:30 AM ET)'
    shortLabel = 'RTH open'
  } else {
    return null
  }

  let openMs = etWallToUtcMs(y, mo, d, Math.floor(openMin / 60), openMin % 60)
  if (openMs == null || !Number.isFinite(openMs)) return null
  // Overnight before midnight: “today 20:00” is still in the future → use yesterday 20:00
  if (openMs > asOfMs + 60_000) {
    const prior = etPartsAt(asOfMs - 24 * 60 * 60_000)
    openMs = etWallToUtcMs(
      prior.year,
      prior.month,
      prior.day,
      Math.floor(openMin / 60),
      openMin % 60,
    )
  }
  if (openMs == null || !Number.isFinite(openMs)) return null
  return { openMs, label, shortLabel, session: sess }
}

/**
 * First 1m print at/after the current session’s scheduled open.
 * PRE: first bar from ~4:00 AM ET (not previous regular close).
 *
 * @param {Candle[]} candles sorted asc
 * @param {string|null|undefined} marketSession
 * @param {number} [asOfMs]
 * @param {number} [maxLagMs] reject print if far after scheduled open (default 6h)
 * @returns {{
 *   price: number,
 *   timeIso: string,
 *   openMs: number,
 *   label: string,
 *   shortLabel: string,
 *   session: string,
 *   lagMinutes: number,
 * }|null}
 */
export function resolveSessionOpenPrint(
  candles,
  marketSession,
  asOfMs = Date.now(),
  maxLagMs = 6 * 60 * 60_000,
) {
  const clock = resolveSessionOpenClock(marketSession, asOfMs)
  if (!clock?.openMs) return null
  // Prefer first print at/after open; if bar is exactly on open second, include it
  const bar =
    firstCandleAtOrAfter(candles, clock.openMs - 30_000) ||
    firstCandleAfter(candles, clock.openMs - 60_000)
  if (!bar || !Number.isFinite(bar.close)) return null
  // Must not be before scheduled open (minus 1m slack) or way after open with no pre tape
  if (bar.t < clock.openMs - 90_000) return null
  if (bar.t - clock.openMs > maxLagMs) return null
  // Session open print should not be after "now"
  if (bar.t > asOfMs + 60_000) return null
  return {
    price: Number(bar.close),
    timeIso: new Date(bar.t).toISOString(),
    openMs: clock.openMs,
    label: clock.label,
    shortLabel: clock.shortLabel,
    session: clock.session,
    lagMinutes: Math.max(0, Math.round((bar.t - clock.openMs) / 60_000)),
  }
}
