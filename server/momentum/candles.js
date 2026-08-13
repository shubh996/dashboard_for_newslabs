/**
 * Normalize Yahoo chart payloads into sorted 1m candles.
 */

/**
 * @typedef {{ t: number, close: number, open?: number|null, high?: number|null, low?: number|null, volume?: number|null }} Candle
 */

function num(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Infer session from US/Eastern wall-clock minutes (fallback if Yahoo marketState missing).
 * @param {number} ms
 * @returns {'PRE'|'REGULAR'|'POST'|'CLOSED'}
 */
export function inferMarketSession(ms) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(new Date(ms))
    const get = (type) => parts.find((p) => p.type === type)?.value
    const wd = get('weekday')
    if (wd === 'Sat' || wd === 'Sun') return 'CLOSED'
    const hour = Number(get('hour'))
    const minute = Number(get('minute'))
    const mins = hour * 60 + minute
    if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'PRE'
    if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'REGULAR'
    if (mins >= 16 * 60 && mins < 20 * 60) return 'POST'
    return 'CLOSED'
  } catch {
    return 'REGULAR'
  }
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
 * Parse America/New_York wall-clock parts for a UTC ms.
 * @param {number} ms
 */
function etPartsAt(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ms))
  const get = (type) => parts.find((p) => p.type === type)?.value
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  return {
    weekday: get('weekday') || '',
    year: get('year') || '',
    month: get('month') || '',
    day: get('day') || '',
    hour,
    minute: Number(get('minute')) || 0,
    second: Number(get('second')) || 0,
  }
}

/**
 * Convert America/New_York Y-M-D H:M to UTC ms (handles EDT/EST).
 * @param {string} y
 * @param {string} mo
 * @param {string} d
 * @param {number} hour
 * @param {number} minute
 */
function etWallToUtcMs(y, mo, d, hour, minute) {
  let utc = Date.parse(
    `${y}-${mo}-${d}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
  )
  if (!Number.isFinite(utc)) return null
  for (let i = 0; i < 5; i += 1) {
    const p = etPartsAt(utc)
    if (p.year !== y || p.month !== mo || p.day !== d) {
      // Day slip — nudge by full days
      const want = Date.parse(`${y}-${mo}-${d}T12:00:00.000Z`)
      const got = Date.parse(`${p.year}-${p.month}-${p.day}T12:00:00.000Z`)
      if (Number.isFinite(want) && Number.isFinite(got)) utc += want - got
    }
    const wantMin = hour * 60 + minute
    const gotMin = p.hour * 60 + p.minute
    const adj = (wantMin - gotMin) * 60 * 1000
    if (adj === 0) break
    utc += adj
  }
  return utc
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
