/**
 * US equity session + Trigger weekend window.
 *
 * Canonical clock: America/New_York wall time.
 * Never add a fixed “ET + 5 = London” offset — the US and UK change DST
 * on different dates, so London is sometimes only 4 hours ahead of ET.
 * Display in the UK by converting the same UTC instant with Europe/London.
 *
 * Trigger is ON from Sunday 20:00 ET through Friday 20:00 ET
 * (overnight Sun night → after-hours Friday). OFF Friday 20:00 → Sunday 20:00.
 */

export const ET_ZONE = 'America/New_York'
export const UK_ZONE = 'Europe/London'

/** Minutes from midnight ET. */
export const US_EQUITY_MIN = {
  overnightStart: 20 * 60, // 20:00
  preStart: 4 * 60, // 04:00
  rthStart: 9 * 60 + 30, // 09:30
  rthEnd: 16 * 60, // 16:00
  ahEnd: 20 * 60, // 20:00
}

/**
 * @param {number} [ms]
 * @returns {{
 *   weekday: string,
 *   year: string,
 *   month: string,
 *   day: string,
 *   hour: number,
 *   minute: number,
 *   second: number,
 *   minutes: number,
 * }}
 */
export function etPartsAt(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ms))
  const get = (type) => parts.find((p) => p.type === type)?.value || ''
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const minute = Number(get('minute')) || 0
  return {
    weekday: get('weekday'),
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute,
    second: Number(get('second')) || 0,
    minutes: hour * 60 + minute,
  }
}

/**
 * America/New_York Y-M-D H:M → UTC ms (handles EST/EDT).
 * @param {string} y
 * @param {string} mo
 * @param {string} d
 * @param {number} hour
 * @param {number} minute
 */
export function etWallToUtcMs(y, mo, d, hour, minute) {
  let utc = Date.parse(
    `${y}-${mo}-${d}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
  )
  if (!Number.isFinite(utc)) return null
  for (let i = 0; i < 5; i += 1) {
    const p = etPartsAt(utc)
    if (p.year !== String(y) || p.month !== String(mo) || p.day !== String(d)) {
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
 * Yahoo / ATS extended window: Sunday 20:00 ET inclusive → Friday 20:00 ET exclusive.
 * Used for display / tape labels — NOT for momentum engine run/sleep.
 * @param {number} [ms]
 */
export function isUsEquityTriggerOpen(ms = Date.now()) {
  const { weekday, minutes } = etPartsAt(ms)
  if (weekday === 'Sat') return false
  if (weekday === 'Sun') return minutes >= US_EQUITY_MIN.overnightStart
  if (weekday === 'Fri') return minutes < US_EQUITY_MIN.ahEnd
  return true
}

/**
 * Cash regular trading hours only: Mon–Fri 09:30 ≤ t < 16:00 America/New_York.
 * Momentum engine runs equities only inside this window; outside → sleep + end episodes.
 * @param {number} [ms]
 */
export function isUsEquityRthOpen(ms = Date.now()) {
  const { weekday, minutes } = etPartsAt(ms)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return (
    minutes >= US_EQUITY_MIN.rthStart && minutes < US_EQUITY_MIN.rthEnd
  )
}

/**
 * @typedef {'overnight'|'pre-market'|'regular'|'after-hours'|'closed'} UsEquitySessionId
 */

/**
 * Session bucket from the ET clock (Trigger-closed weekend is `closed`).
 * @param {number} [ms]
 * @returns {UsEquitySessionId}
 */
export function usEquitySessionId(ms = Date.now()) {
  if (!isUsEquityTriggerOpen(ms)) return 'closed'
  const { minutes } = etPartsAt(ms)
  if (minutes >= US_EQUITY_MIN.overnightStart || minutes < US_EQUITY_MIN.preStart) {
    return 'overnight'
  }
  if (minutes < US_EQUITY_MIN.rthStart) return 'pre-market'
  if (minutes < US_EQUITY_MIN.rthEnd) return 'regular'
  return 'after-hours'
}

/**
 * Engine session code used by episode / Yahoo fallback.
 * Overnight + pre-market → PRE (Yahoo PREPRE already maps to PRE).
 * @param {number} [ms]
 * @returns {'PRE'|'REGULAR'|'POST'|'CLOSED'}
 */
export function inferUsEquityMarketSession(ms = Date.now()) {
  const id = usEquitySessionId(ms)
  if (id === 'overnight' || id === 'pre-market') return 'PRE'
  if (id === 'regular') return 'REGULAR'
  if (id === 'after-hours') return 'POST'
  return 'CLOSED'
}

/**
 * Format an instant in a named IANA zone. Never apply a fixed hour offset.
 * @param {number} ms
 * @param {string} timeZone
 */
export function formatHmInTimeZone(ms, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms))
  } catch {
    return '—'
  }
}

/**
 * Convert an ET wall-clock on the ET calendar day of `ms` into another zone.
 * Use this for “what time is the US open in London today?” — not ET+5.
 * @param {number} hourEt
 * @param {number} minuteEt
 * @param {string} timeZone
 * @param {number} [ms]
 */
export function formatEtWallInTimeZone(
  hourEt,
  minuteEt,
  timeZone,
  ms = Date.now(),
) {
  const p = etPartsAt(ms)
  const utc = etWallToUtcMs(p.year, p.month, p.day, hourEt, minuteEt)
  if (utc == null) return '—'
  return formatHmInTimeZone(utc, timeZone)
}

export function usEquitySessionLabel(id) {
  if (id === 'overnight') return 'Overnight'
  if (id === 'pre-market') return 'Pre-market'
  if (id === 'regular') return 'Regular'
  if (id === 'after-hours') return 'After-hours'
  return 'Closed'
}

export function usEquitySessionTone(id) {
  if (id === 'regular') return 'open'
  if (id === 'pre-market') return 'pre'
  if (id === 'after-hours') return 'post'
  if (id === 'overnight') return 'overnight'
  return 'closed'
}

/**
 * Set MOMENTUM_US_EQUITY_SESSION_GATE=0 to keep polling equities 24×7 (tests / ops).
 */
export function isUsEquitySessionGateEnabled() {
  return process.env.MOMENTUM_US_EQUITY_SESSION_GATE !== '0'
}

/**
 * Equities / US indexes follow the Trigger weekend pause. Crypto / FX / futures do not.
 * @param {'equity'|'commodity'|'crypto'|'forex'|'other'|string|null|undefined} assetClass
 */
export function assetFollowsUsEquityTriggerWindow(assetClass) {
  const cls = String(assetClass || '').toLowerCase()
  return cls === 'equity' || cls === 'index' || cls === 'etf' || cls === 'stock'
}

/**
 * Symbol-level gate (same roots as classifyMomentumAsset — kept here to avoid import cycles).
 * @param {string|null|undefined} ticker
 */
export function tickerFollowsUsEquityTriggerWindow(ticker) {
  const t = String(ticker || '').toUpperCase().trim()
  if (!t) return false
  if (t.endsWith('=F')) return false
  if (
    t.endsWith('-USD') ||
    t.endsWith('-USDT') ||
    t.endsWith('-EUR') ||
    t === 'BTC' ||
    t === 'ETH'
  ) {
    return false
  }
  if (t.endsWith('=X') || /^[A-Z]{6}$/.test(t)) return false
  return true
}

/**
 * Whether this ticker should poll / calculate / alert right now.
 * Non-equities always run. Equities follow the Sunday 20:00–Friday 20:00 ET window.
 * @param {string|null|undefined} ticker
 * @param {number} [ms]
 */
export function shouldRunUsEquityTrigger(ticker, ms = Date.now()) {
  if (!tickerFollowsUsEquityTriggerWindow(ticker)) return true
  if (!isUsEquitySessionGateEnabled()) return true
  return isUsEquityTriggerOpen(ms)
}
