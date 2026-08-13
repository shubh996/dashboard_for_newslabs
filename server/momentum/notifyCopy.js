/**
 * User-facing notification title/body for Trigger episode events.
 * Do not expose backend vocabulary (reference, trigger, episode state names).
 */

/**
 * Replace dashes with commas in alert / Perplexity copy before save or push.
 * Handles em/en dashes and spaced hyphens; collapses messy punctuation.
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function formatDashesToCommas(text) {
  if (text == null) return ''
  let s = String(text)
  if (!s) return ''
  // Unicode dashes → comma
  s = s.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, ',')
  // Spaced ASCII hyphen used as a clause separator: "foo - bar" → "foo, bar"
  s = s.replace(/\s+-\s+/g, ', ')
  // "word- word" / "word -word" light cases
  s = s.replace(/(\w)\s*-\s+(\w)/g, '$1, $2')
  // Cleanup: comma runs, spaces around commas
  s = s
    .replace(/,+/g, ',')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^,\s*/g, '')
    .replace(/,\s*$/g, '')
    .trim()
  return s
}

/**
 * Format signed percent for display (1 decimal by default).
 * @param {number} pct
 * @param {number} [digits=1]
 */
export function fmtDisplayPct(pct, digits = 1) {
  if (pct == null || !Number.isFinite(pct)) return 'n/a'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(digits)}%`
}

/**
 * Green / red circle emoji (same as notable-move alerts).
 * UP / positive → 🟢 · DOWN / negative → 🔴
 * @param {'UP'|'DOWN'|string|null|undefined} direction
 * @param {number|null|undefined} [movePercent]
 */
export function directionCircleEmoji(direction, movePercent) {
  const dir = String(direction || '').toUpperCase()
  if (dir === 'DOWN') return '🔴'
  if (dir === 'UP') return '🟢'
  if (Number.isFinite(Number(movePercent))) {
    return Number(movePercent) < 0 ? '🔴' : '🟢'
  }
  return '🟢'
}

/**
 * Lookback phrase for alert titles:
 *   < 60 min  → "in last 42 minutes"
 *   60–119 m  → "1H32M" compact
 *   ≥ 120 min → "in last 3 hours"
 *
 * @param {number|null|undefined} minutes
 * @returns {string}
 */
export function formatLookbackTitlePhrase(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes)) || Number(minutes) <= 0) {
    return 'in last session'
  }
  const m = Math.max(1, Math.round(Number(minutes)))
  if (m < 60) {
    return m === 1 ? 'in last 1 minute' : `in last ${m} minutes`
  }
  if (m < 120) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    if (rem <= 0) return `${h}H`
    return `${h}H${rem}M`
  }
  const hours = Math.max(2, Math.round(m / 60))
  return hours === 1 ? 'in last 1 hour' : `in last ${hours} hours`
}

/**
 * Resolve lookback minutes from exact fields, window key, or reference clock.
 * @param {{
 *   exactMinutes?: number|null,
 *   exactLabel?: string|null,
 *   windowKey?: string|null,
 *   referenceTime?: string|null,
 *   nowIso?: string|null,
 * }} opts
 * @returns {number|null}
 */
export function resolveLookbackMinutes(opts = {}) {
  const exact = Number(opts.exactMinutes)
  if (Number.isFinite(exact) && exact > 0) return exact

  const label = String(opts.exactLabel || '').trim().toLowerCase()
  if (label) {
    // "42 minutes", "42m", "1h 20m", "1 hour 5 min"
    const hm = label.match(
      /(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i,
    )
    if (hm) {
      const h = Number(hm[1]) || 0
      const min = Number(hm[2]) || 0
      return h * 60 + min
    }
    const onlyM = label.match(/^(\d+)\s*m(?:in(?:ute)?s?)?$/)
    if (onlyM) return Number(onlyM[1])
    const onlyH = label.match(/^(\d+)\s*h(?:ours?)?$/)
    if (onlyH) return Number(onlyH[1]) * 60
  }

  const key = String(opts.windowKey || '').trim()
  if (key) {
    const km = key.match(/^(\d+(?:\.\d+)?)m$/i)
    if (km) return Number(km[1])
    const kh = key.match(/^(\d+(?:\.\d+)?)h$/i)
    if (kh) return Number(kh[1]) * 60
    if (key === 'day') {
      // Prefer clock span when available; else ~session proxy
      const a = Date.parse(String(opts.referenceTime || ''))
      const b = Date.parse(String(opts.nowIso || new Date().toISOString()))
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
        return Math.max(1, Math.round((b - a) / 60_000))
      }
      return 6.5 * 60 // ~regular session length
    }
  }

  const a = Date.parse(String(opts.referenceTime || ''))
  const b = Date.parse(String(opts.nowIso || ''))
  if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
    return Math.max(1, Math.round((b - a) / 60_000))
  }
  return null
}

/**
 * Alert title: 🟢 SNDK +7.6% in last 42 minutes
 *              🔴 SNDK -3.2% 1H32M
 *              🟢 AAPL +4.1% in last 3 hours
 *
 * @param {{
 *   ticker: string,
 *   direction?: string,
 *   movePercent?: number|null,
 *   lookbackMinutes?: number|null,
 * }} opts
 */
export function buildMomentumAlertTitle(opts = {}) {
  const ticker = String(opts.ticker || 'TICKER').toUpperCase()
  const move = Number(opts.movePercent)
  const emoji = directionCircleEmoji(opts.direction, move)
  const pct = Number.isFinite(move) ? fmtDisplayPct(move) : ''
  const when = formatLookbackTitlePhrase(opts.lookbackMinutes)
  return [emoji, ticker, pct, when].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Human duration between two ISO timestamps or ms.
 * @param {string|number|null|undefined} from
 * @param {string|number|null|undefined} to
 * @returns {string} e.g. "10 minutes", "8 mins", "1 hour"
 */
export function formatElapsed(from, to) {
  const a = typeof from === 'number' ? from : Date.parse(String(from || ''))
  const b = typeof to === 'number' ? to : Date.parse(String(to || ''))
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  const mins = Math.max(1, Math.round((b - a) / 60_000))
  if (mins < 60) {
    return mins === 1 ? '1 minute' : `${mins} minutes`
  }
  if (mins < 120) {
    const m = mins - 60
    return m <= 0 ? '1 hour' : `1 hour ${m} min`
  }
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (m === 0) return `${h} hours`
  return `${h}h ${m}m`
}

/** Shorter form for titles: "10 minutes" → "10 minutes", "8 minutes" → "8 mins" */
export function formatElapsedShort(from, to) {
  const a = typeof from === 'number' ? from : Date.parse(String(from || ''))
  const b = typeof to === 'number' ? to : Date.parse(String(to || ''))
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  const mins = Math.max(1, Math.round((b - a) / 60_000))
  if (mins < 60) return mins === 1 ? '1 min' : `${mins} mins`
  if (mins % 60 === 0) {
    const h = mins / 60
    return h === 1 ? '1 hour' : `${h} hours`
  }
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

/**
 * Build push title/body for a notification-worthy episode event.
 * @param {{
 *   ticker: string,
 *   eventType: string,
 *   direction: 'UP'|'DOWN',
 *   movePercent: number,
 *   episode?: Record<string, unknown>|null,
 *   detectedAt?: string,
 *   detectedWindow?: string|null,
 *   previousAlertMovePercent?: number|null,
 *   price?: number|null,
 *   exactMinutes?: number|null,
 *   exactLabel?: string|null,
 *   likelyDriver?: string|null,
 * }} ev
 * @returns {{ title: string, body: string }|null}
 */
export function buildNotificationCopy(ev) {
  if (!ev) return null
  const ticker = String(ev.ticker || 'TICKER').toUpperCase()
  const type = String(ev.eventType || '')
  const dir = ev.direction === 'DOWN' ? 'DOWN' : 'UP'
  const ep = ev.episode || null
  const move = Number(ev.movePercent)
  const nowIso = ev.detectedAt || new Date().toISOString()

  if (type === 'MOMENTUM_STARTED') {
    const refTime = ep?.referenceTime || ep?.reference_time || null
    const lookbackMinutes = resolveLookbackMinutes({
      exactMinutes: ev.exactMinutes,
      exactLabel: ev.exactLabel,
      windowKey: ev.detectedWindow || ep?.detectedWindow,
      referenceTime: refTime,
      nowIso,
    })
    const title = buildMomentumAlertTitle({
      ticker,
      direction: dir,
      movePercent: move,
      lookbackMinutes,
    })
    // Prefer research likely-driver only; generic fallback if none
    const driver = String(ev.likelyDriver || '').trim()
    const body = driver || (
      dir === 'UP'
        ? 'Sharp upward momentum detected.'
        : 'Sharp downward momentum detected.'
    )
    return { title, body }
  }

  if (type === 'MOMENTUM_ACCELERATING') {
    const lastNotifiedPrice = Number(
      ep?.lastNotifiedPrice ?? ep?.last_notified_price ?? NaN,
    )
    const lastNotifiedTime =
      ep?.lastNotifiedTime || ep?.last_notified_time || ep?.lastAlertAt || null
    const refPrice = Number(ep?.referencePrice ?? ep?.reference_price ?? NaN)
    const refTime = ep?.referenceTime || ep?.reference_time || null
    const price = Number(ev.price ?? ep?.currentPrice ?? NaN)

    let sinceLastPct = null
    if (Number.isFinite(price) && Number.isFinite(lastNotifiedPrice) && lastNotifiedPrice !== 0) {
      sinceLastPct = ((price - lastNotifiedPrice) / lastNotifiedPrice) * 100
    } else if (
      Number.isFinite(move) &&
      Number.isFinite(Number(ev.previousAlertMovePercent ?? ep?.lastNotifiedEpisodeMovePct))
    ) {
      const prev = Number(
        ev.previousAlertMovePercent ?? ep?.lastNotifiedEpisodeMovePct,
      )
      sinceLastPct = move - prev
    }

    const sinceLastAbs = sinceLastPct != null ? Math.abs(sinceLastPct) : null
    const sinceLastDisplay =
      sinceLastAbs != null
        ? dir === 'UP'
          ? `+${sinceLastAbs.toFixed(1)}%`
          : `${sinceLastAbs.toFixed(1)}%`
        : fmtDisplayPct(move)

    const shortElapsed =
      formatElapsedShort(lastNotifiedTime, nowIso) || 'recent mins'
    const totalElapsed = formatElapsed(refTime, nowIso) || 'this session'
    const totalMove = fmtDisplayPct(move)

    if (dir === 'UP') {
      return {
        title: `${ticker} adds another ${sinceLastDisplay} in ${shortElapsed}`,
        body: `The surge now stands at ${totalMove} over ${totalElapsed}.`,
      }
    }
    return {
      title: `${ticker} falls another ${sinceLastDisplay} in ${shortElapsed}`,
      body: `The decline now stands at ${totalMove} over ${totalElapsed}.`,
    }
  }

  if (type === 'MOMENTUM_REVERSED' || (type === 'MOMENTUM_ENDED' && ev.reason === 'REVERSAL')) {
    if (dir === 'UP') {
      // UP episode reversing → market going lower
      return {
        title: `${ticker} reverses lower`,
        body: 'Earlier gains have been erased as downside momentum builds.',
      }
    }
    return {
      title: `${ticker} rebounds sharply`,
      body: 'Earlier losses are being recovered as upward momentum builds.',
    }
  }

  return null
}

/**
 * Whether this event type should generate a push in V1.
 * @param {string} eventType
 * @param {string} [reason]
 * @param {boolean} [shouldNotifyOverride]
 */
export function isPushWorthy(eventType, reason, shouldNotifyOverride) {
  if (shouldNotifyOverride === false) return false
  if (shouldNotifyOverride === true) return true
  const t = String(eventType || '')
  // STARTED is not push-worthy on the raw event — engine runs Perplexity first,
  // then sends via autoStartAlert (MOMENTUM_ALERT_SENT). Accel / reverse still auto-notify.
  if (t === 'MOMENTUM_STARTED' || t.endsWith('_STARTED')) return false
  if (t === 'MOMENTUM_ACCELERATING') return true
  if (t === 'MOMENTUM_REVERSED') return true
  if (t === 'MOMENTUM_ENDED' && reason === 'REVERSAL') return true
  // EXPIRED, INACTIVITY, CLOSED_AT_MARKET_CLOSE, HOLDING, WEAKENING → no
  return false
}
