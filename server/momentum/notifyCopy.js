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
 * Human alert labels for futures / FX / crypto roots.
 * Alert titles must never show raw Yahoo codes like NG=F / CL=F.
 */
const ALERT_DISPLAY_NAMES = {
  // Energy
  'CL=F': 'Crude Oil',
  CL: 'Crude Oil',
  'BZ=F': 'Brent Crude',
  BZ: 'Brent Crude',
  'NG=F': 'Natural Gas',
  NG: 'Natural Gas',
  'HO=F': 'Heating Oil',
  HO: 'Heating Oil',
  'RB=F': 'Gasoline',
  RB: 'Gasoline',
  // Metals
  'GC=F': 'Gold',
  GC: 'Gold',
  'SI=F': 'Silver',
  SI: 'Silver',
  'PL=F': 'Platinum',
  PL: 'Platinum',
  'HG=F': 'Copper',
  HG: 'Copper',
  'PA=F': 'Palladium',
  PA: 'Palladium',
  // Ags
  'ZC=F': 'Corn',
  ZC: 'Corn',
  'ZW=F': 'Wheat',
  ZW: 'Wheat',
  'KE=F': 'KC Wheat',
  KE: 'KC Wheat',
  'ZS=F': 'Soybeans',
  ZS: 'Soybeans',
  'ZM=F': 'Soy Meal',
  ZM: 'Soy Meal',
  'ZL=F': 'Soy Oil',
  ZL: 'Soy Oil',
  'KC=F': 'Coffee',
  KC: 'Coffee',
  'CT=F': 'Cotton',
  CT: 'Cotton',
  'SB=F': 'Sugar',
  SB: 'Sugar',
  'CC=F': 'Cocoa',
  CC: 'Cocoa',
  'LE=F': 'Live Cattle',
  LE: 'Live Cattle',
  'HE=F': 'Lean Hogs',
  HE: 'Lean Hogs',
  'GF=F': 'Feeder Cattle',
  GF: 'Feeder Cattle',
  // Index / rate futures
  'ES=F': 'S&P 500 Futures',
  ES: 'S&P 500 Futures',
  'NQ=F': 'Nasdaq Futures',
  NQ: 'Nasdaq Futures',
  'YM=F': 'Dow Futures',
  YM: 'Dow Futures',
  'RTY=F': 'Russell Futures',
  RTY: 'Russell Futures',
  'ZB=F': 'US Bond Futures',
  ZB: 'US Bond Futures',
  'ZN=F': '10Y Note Futures',
  ZN: '10Y Note Futures',
  // Crypto (common)
  'BTC-USD': 'Bitcoin',
  BTC: 'Bitcoin',
  'ETH-USD': 'Ethereum',
  ETH: 'Ethereum',
  'SOL-USD': 'Solana',
  SOL: 'Solana',
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Stocks / ordinary equities (AAPL, SNDK, BRK.B).
 * Futures, FX, crypto pairs, and mapped commodity roots are not stocks.
 *
 * @param {string|null|undefined} ticker
 * @returns {boolean}
 */
export function isStockAlertTicker(ticker) {
  const sym = String(ticker || '').trim().toUpperCase()
  if (!sym) return false
  if (ALERT_DISPLAY_NAMES[sym]) return false
  if (sym.endsWith('=F') || sym.endsWith('=X')) return false
  if (/-(USD|USDT|BTC)$/.test(sym)) return false
  if (sym.startsWith('^')) return false
  if (ALERT_DISPLAY_NAMES[`${sym}=F`]) return false
  return true
}

/**
 * Friendly name for alert headings.
 * Stocks always use the ticker (SNDK, AAPL) — never the company name.
 * Futures / crypto map to names (Natural Gas, Crude Oil, Gold, Bitcoin).
 *
 * `companyName` is accepted for call-site compatibility and ignored for stocks.
 *
 * @param {string|null|undefined} ticker
 * @param {string|null|undefined} [_companyName]
 * @returns {string}
 */
export function alertDisplayName(ticker, _companyName = null) {
  const raw = String(ticker || '').trim()
  const sym = raw.toUpperCase()
  if (!sym) return 'Market'

  // Mapped futures first so CL=F / NG=F never appear even if label is messy
  if (ALERT_DISPLAY_NAMES[sym]) return ALERT_DISPLAY_NAMES[sym]
  if (sym.endsWith('=F')) {
    const root = sym.slice(0, -2)
    if (ALERT_DISPLAY_NAMES[root]) return ALERT_DISPLAY_NAMES[root]
    if (ALERT_DISPLAY_NAMES[`${root}=F`]) return ALERT_DISPLAY_NAMES[`${root}=F`]
  } else if (ALERT_DISPLAY_NAMES[`${sym}=F`]) {
    return ALERT_DISPLAY_NAMES[`${sym}=F`]
  }

  // Forex: EURUSD=X → EUR/USD
  if (sym.endsWith('=X') && sym.length >= 7) {
    const pair = sym.slice(0, -2)
    if (pair.length === 6) return `${pair.slice(0, 3)}/${pair.slice(3)}`
  }

  // Unknown futures: never show =F in the title
  if (sym.endsWith('=F')) {
    return sym.slice(0, -2)
  }

  // Equities / unknowns: uppercase ticker (SNDK, AAPL) — never company name
  return sym
}

/**
 * Rewrite a generated headline so a stock notification leads with the ticker.
 * "Sandisk rose 4.2% so far…" → "SNDK rose 4.2% so far…"
 * Leaves non-matching / custom titles alone.
 *
 * @param {string|null|undefined} headline
 * @param {string|null|undefined} ticker
 * @param {string|null|undefined} [companyName]
 * @returns {string}
 */
export function rewriteStockHeadlineToTicker(headline, ticker, companyName = '') {
  const sym = String(ticker || '').trim().toUpperCase()
  const text = String(headline || '')
  const trimmed = text.trim()
  if (!sym || !trimmed) return text

  const emojiMatch = trimmed.match(
    /^((?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]+|\uFE0F|\u200D)+)\s*/u,
  )
  const emojiPrefix = emojiMatch ? emojiMatch[0] : ''
  const rest = emojiPrefix ? trimmed.slice(emojiPrefix.length).trim() : trimmed
  if (!rest) return trimmed

  if (new RegExp(`^${escapeRegExp(sym)}\\b`, 'i').test(rest)) {
    return trimmed
  }

  const corpSuffix =
    String.raw`(?:\s*,?\s*(?:incorporated|inc|corporation|corp|company|co|ltd|limited|plc|holdings|group)\.?)*`
  const names = []
  const rawName = String(companyName || '').trim()
  if (rawName && rawName.toUpperCase() !== sym) {
    names.push(rawName)
    const shortName = rawName
      .replace(
        /,?\s*\b(incorporated|inc|corporation|corp|company|co|ltd|limited|plc|holdings|group|class [a-z])\.?$/i,
        '',
      )
      .trim()
    if (shortName && shortName.toUpperCase() !== sym && shortName !== rawName) {
      names.push(shortName)
    }
  }

  const nameLeadRe = (name) =>
    new RegExp(`^${escapeRegExp(name)}${corpSuffix}(?=\\s|[+\-−]|$)`, 'i')

  for (const name of names) {
    const nameRe = nameLeadRe(name)
    if (nameRe.test(rest)) {
      return `${emojiPrefix}${rest.replace(nameRe, sym)}`.replace(/\s+/g, ' ').trim()
    }
  }

  const sharesLead = rest.match(
    /^(?:shares|stock|the shares|the stock)(?:\s+of)?\s+/i,
  )
  const afterShares = sharesLead ? rest.slice(sharesLead[0].length) : rest
  for (const name of names) {
    const nameRe = nameLeadRe(name)
    if (nameRe.test(afterShares)) {
      return `${emojiPrefix}${afterShares.replace(nameRe, sym)}`
        .replace(/\s+/g, ' ')
        .trim()
    }
  }

  const moveRe =
    /([+\-−]?\d+(?:\.\d+)?\s*%|\b(?:rose|fell|gained|declined|jumped|dropped|slid|surged|rallied|tumbled|slipped|climbed|sank|advanced|retreated|added|lost|soared|plunged|dipped)\b)/i
  const move = rest.match(moveRe)
  if (move && move.index > 0) {
    const before = rest.slice(0, move.index).trim()
    const looksLikeCompany =
      /^[A-Za-z][A-Za-z0-9.&'’\-\s]{0,47}$/.test(before) &&
      !/^(the|a|an|in|on|after|during|over)\b/i.test(before)
    if (looksLikeCompany || /^(?:shares|stock)\b/i.test(before)) {
      return `${emojiPrefix}${sym} ${rest.slice(move.index)}`
        .replace(/\s+/g, ' ')
        .trim()
    }
  }

  return trimmed
}

/**
 * Rewrite the first Gemini/Perplexity headline line of a structured reason
 * so stocks use the ticker, not the company name.
 *
 * @param {string|null|undefined} summary
 * @param {string|null|undefined} ticker
 * @param {string|null|undefined} [companyName]
 * @param {string|null|undefined} [assetClass]
 * @returns {string}
 */
export function sanitizeStockHeadlineInSummary(
  summary,
  ticker,
  companyName = '',
  assetClass = '',
) {
  const raw = String(summary || '')
  if (!raw.trim()) return raw
  const cls = String(assetClass || '').toLowerCase()
  const isStock =
    cls === 'equity' ||
    cls === 'stock' ||
    cls === 'stocks' ||
    (!cls && isStockAlertTicker(ticker))
  if (!isStock) return raw

  const lines = raw.split(/\r?\n/)
  let firstIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim()
    if (!t) continue
    if (/^likely\s*driver\s*:/i.test(t)) break
    firstIdx = i
    break
  }
  if (firstIdx < 0) return raw
  lines[firstIdx] = rewriteStockHeadlineToTicker(
    lines[firstIdx],
    ticker,
    companyName,
  )
  return lines.join('\n')
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
 * Prefix push title with 🟢 / 🔴 on the left (all alert kinds).
 * Skips if title already starts with a circle emoji.
 * @param {string|null|undefined} title
 * @param {'UP'|'DOWN'|string|null|undefined} direction
 * @param {number|null|undefined} [movePercent]
 */
export function withDirectionCircle(title, direction, movePercent) {
  const t = String(title || '').trim()
  if (!t) {
    return directionCircleEmoji(direction, movePercent)
  }
  if (/^[🟢🔴]/.test(t)) return t
  return `${directionCircleEmoji(direction, movePercent)} ${t}`
}

/**
 * Yahoo / engine session → short display label (UI dates, exact_label, mobile).
 * @param {string|null|undefined} marketSession
 * @returns {string|null}
 */
export function sessionDisplayLabel(marketSession) {
  const s = String(marketSession || '').trim().toUpperCase()
  if (s === 'PRE') return 'pre-market'
  if (s === 'PREPRE') return 'overnight'
  if (s === 'POST' || s === 'POSTPOST') return 'after-hours'
  if (s === 'REGULAR' || s === 'OPEN') return 'regular'
  if (s === 'CLOSED' || s === 'CLOSE') return 'closed'
  return null
}

/**
 * Day-window exact_label for Supabase / timeline (not wall-clock “3 days”).
 * Day is always vs previous regular close — name the session, not the calendar span.
 * @param {string|null|undefined} marketSession
 * @returns {string}
 */
export function daySessionExactLabel(marketSession) {
  const s = String(marketSession || '').trim().toUpperCase()
  if (s === 'PRE') return 'pre-market'
  if (s === 'PREPRE') return 'overnight'
  if (s === 'POST' || s === 'POSTPOST') return 'after-hours'
  if (s === 'CLOSED' || s === 'CLOSE') return 'at the close'
  return 'today'
}

/**
 * Alert-title “when” phrase for day / session cards.
 * Returns null when the normal lookback duration phrase should be used instead.
 *
 * @param {string|null|undefined} marketSession
 * @param {string|null|undefined} windowKey
 * @returns {string|null}
 */
export function sessionTitlePhrase(marketSession, windowKey) {
  const wk = String(windowKey || '').trim()
  const s = String(marketSession || '').trim().toUpperCase()
  // Day card = vs previous close — ongoing sessions get “so far”
  if (wk === 'day') {
    if (s === 'PRE') return 'in pre-market so far'
    if (s === 'PREPRE') return 'overnight so far'
    if (s === 'POST' || s === 'POSTPOST') return 'in after-hours so far'
    if (s === 'CLOSED' || s === 'CLOSE') return 'at the close'
    return 'so far today'
  }
  return null
}

/**
 * Human lookback for titles — never telegraph codes like "1H31M".
 * Examples: "in last 42 minutes" · "in last 1 hour 31 mins" · "in last 3 hours"
 *
 * @param {number} minutes
 * @param {{ useTradingWording?: boolean }} [opts]
 * @returns {string}
 */
export function formatHumanLookbackDuration(minutes, opts = {}) {
  const trading = Boolean(opts.useTradingWording)
  const m = Math.max(1, Math.round(Number(minutes)))
  const hourWord = trading ? 'trading hour' : 'hour'
  const hoursWord = trading ? 'trading hours' : 'hours'
  const dayWord = trading ? 'trading day' : 'day'
  const daysWord = trading ? 'trading days' : 'days'

  if (m < 60) {
    return m === 1 ? 'in last 1 minute' : `in last ${m} minutes`
  }
  if (m < 120) {
    const rem = m - 60
    if (rem <= 0) return `in last 1 ${hourWord}`
    return `in last 1 ${hourWord} ${rem} min${rem === 1 ? '' : 's'}`
  }
  // Prefer exact hours+mins when not a clean hour and under ~6h
  if (m < 360 && m % 60 !== 0) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    const hLabel = h === 1 ? `1 ${hourWord}` : `${h} ${hoursWord}`
    return `in last ${hLabel} ${rem} min${rem === 1 ? '' : 's'}`
  }
  const hours = Math.max(2, Math.round(m / 60))
  // ~24h window: keep as hours (not “1 day”) so it matches the card label
  if (hours >= 24 && hours < 40) {
    return `in last ${hours} ${hoursWord}`
  }
  if (hours >= 40) {
    const days = Math.max(1, Math.round(hours / 24))
    return days === 1 ? `in last 1 ${dayWord}` : `in last ${days} ${daysWord}`
  }
  return hours === 1 ? `in last 1 ${hourWord}` : `in last ${hours} ${hoursWord}`
}

/**
 * Intensity word for START titles (surge / plunge / …).
 * Empty string when the move is too small to name.
 *
 * @param {string|null|undefined} direction
 * @param {number|null|undefined} movePercent
 * @returns {string}
 */
export function moveIntensityWord(direction, movePercent) {
  const move = Number(movePercent)
  if (!Number.isFinite(move) || move === 0) return ''
  const abs = Math.abs(move)
  const down =
    String(direction || '').toUpperCase() === 'DOWN' || move < 0
  // Mild moves: no extra word (title stays clean)
  if (abs < 2) return ''
  if (down) {
    if (abs >= 8) return 'plunge'
    if (abs >= 4) return 'drop'
    return 'slide'
  }
  if (abs >= 8) return 'surge'
  if (abs >= 4) return 'surge'
  return 'rally'
}

/**
 * Lookback phrase for alert titles.
 *
 * Day / session card:  "in pre-market so far" / "in after-hours so far" / "so far today"
 * Normal (wall-clock ≈ window):  "in last 3 hours" / "in last 1 hour 31 mins"
 * Mismatch only (closed gap):    "in last 3 trading hours" / "in last 24 trading hours"
 * Extended hours + rolling window: append " · pre-market" etc.
 *
 * @param {number|null|undefined} minutes  minutes to name in the phrase
 * @param {{
 *   useTradingWording?: boolean,
 *   marketSession?: string|null,
 *   windowKey?: string|null,
 * }} [opts]
 * @returns {string}
 */
export function formatLookbackTitlePhrase(minutes, opts = {}) {
  const sessionWhen = sessionTitlePhrase(opts.marketSession, opts.windowKey)
  if (sessionWhen) return sessionWhen

  let base
  if (minutes == null || !Number.isFinite(Number(minutes)) || Number(minutes) <= 0) {
    base = 'in last session'
  } else {
    base = formatHumanLookbackDuration(minutes, {
      useTradingWording: Boolean(opts.useTradingWording),
    })
  }

  // Rolling windows during pre/post: keep duration, tag the session
  const sess = sessionDisplayLabel(opts.marketSession)
  if (
    sess &&
    sess !== 'regular' &&
    sess !== 'closed' &&
    String(opts.windowKey || '').trim() !== 'day'
  ) {
    return `${base} · ${sess}`
  }
  return base
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
    const kd = key.match(/^(\d+(?:\.\d+)?)d$/i)
    if (kd) return Number(kd[1]) * 24 * 60
    if (key === '1w') return 7 * 24 * 60
    if (key === '1M') return 30 * 24 * 60
    if (key === '3M') return 90 * 24 * 60
    if (key === '6M') return 180 * 24 * 60
    if (key === '1y' || key === 'YTD') return 365 * 24 * 60
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
 * Minutes named in the push title + whether to say “trading hours”.
 *
 * - Normal: wall-clock span ≈ window → “in last 3 hours”
 * - Gap: wall span ≫ window (weekend / no overnight prints) → use window
 *   size and “trading hours” so users know it is not pure wall-clock
 *
 * @param {{
 *   exactMinutes?: number|null,
 *   exactLabel?: string|null,
 *   windowKey?: string|null,
 *   referenceTime?: string|null,
 *   nowIso?: string|null,
 *   lookbackMinutes?: number|null,
 * }} opts
 * @returns {{ minutes: number|null, useTradingWording: boolean }}
 */
export function resolveTitleLookback(opts = {}) {
  let exact = null
  if (
    opts.lookbackMinutes != null &&
    Number.isFinite(Number(opts.lookbackMinutes)) &&
    Number(opts.lookbackMinutes) > 0
  ) {
    exact = Math.round(Number(opts.lookbackMinutes))
  } else {
    exact = resolveLookbackMinutes(opts)
  }
  const windowOnly = opts.windowKey
    ? resolveLookbackMinutes({ windowKey: opts.windowKey })
    : null

  // Wall-clock exact much longer than nominal window → closed gap / missing bars
  const mismatched =
    windowOnly != null &&
    windowOnly >= 60 &&
    exact != null &&
    exact >= windowOnly + 90

  if (mismatched) {
    return { minutes: windowOnly, useTradingWording: true }
  }
  return {
    minutes: exact ?? windowOnly,
    useTradingWording: false,
  }
}

/** @deprecated use resolveTitleLookback — kept for any older imports */
export function resolveTitleLookbackMinutes(opts = {}) {
  return resolveTitleLookback(opts).minutes
}

/**
 * Alert title: 🟢 SNDK +7.6% surge in last 42 minutes
 *              🔴 Natural Gas -3.2% drop in last 1 hour 30 mins
 *              🟢 Crude Oil +4.1% surge in last 3 hours
 *              🟢 SNDK +8.0% surge in last 24 trading hours  (only when wall ≠ window)
 *              🟢 SNDK +5.1% surge in pre-market so far
 *              🟢 SNDK +2.0% rally in after-hours so far
 *              🟢 SNDK +1.5% overnight so far
 *
 * @param {{
 *   ticker: string,
 *   companyName?: string|null,
 *   displayName?: string|null,
 *   direction?: string,
 *   movePercent?: number|null,
 *   lookbackMinutes?: number|null,
 *   exactMinutes?: number|null,
 *   exactLabel?: string|null,
 *   windowKey?: string|null,
 *   referenceTime?: string|null,
 *   nowIso?: string|null,
 *   marketSession?: string|null,
 * }} opts
 */
export function buildMomentumAlertTitle(opts = {}) {
  // Prefer explicit human label, else resolve ticker → Natural Gas / Crude Oil / …
  const heading = alertDisplayName(
    opts.ticker,
    opts.companyName || opts.displayName || null,
  )
  const move = Number(opts.movePercent)
  const emoji = directionCircleEmoji(opts.direction, move)
  const pct = Number.isFinite(move) ? fmtDisplayPct(move) : ''
  const intensity = moveIntensityWord(opts.direction, move)
  const { minutes, useTradingWording } = resolveTitleLookback(opts)
  const when = formatLookbackTitlePhrase(minutes, {
    useTradingWording,
    marketSession: opts.marketSession,
    windowKey: opts.windowKey,
  })
  return [emoji, heading, pct, intensity, when]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  if (h >= 24) {
    const d = Math.max(1, Math.round(h / 24))
    return d === 1 ? '1 day' : `${d} days`
  }
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
    if (h >= 24) {
      const d = Math.max(1, Math.round(h / 24))
      return d === 1 ? '1 day' : `${d} days`
    }
    return h === 1 ? '1 hour' : `${h} hours`
  }
  const h = Math.floor(mins / 60)
  if (h >= 24) {
    const d = Math.max(1, Math.round(h / 24))
    return d === 1 ? '1 day' : `${d} days`
  }
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
 *   marketSession?: string|null,
 *   likelyDriver?: string|null,
 * }} ev
 * @returns {{ title: string, body: string }|null}
 */
export function buildNotificationCopy(ev) {
  if (!ev) return null
  const ticker = String(ev.ticker || 'TICKER').toUpperCase()
  const ep = ev.episode || null
  // Human heading — never NG=F / CL=F in the push title
  const name = alertDisplayName(
    ticker,
    ev.companyName ||
      ev.company_name ||
      ev.label ||
      ep?.companyName ||
      ep?.company_name ||
      ep?.label ||
      null,
  )
  const type = String(ev.eventType || '')
  const dir = ev.direction === 'DOWN' ? 'DOWN' : 'UP'
  const move = Number(ev.movePercent)
  const nowIso = ev.detectedAt || new Date().toISOString()
  const marketSession =
    ev.marketSession ||
    ev.market_session ||
    ep?.marketSession ||
    ep?.market_session ||
    null

  if (type === 'MOMENTUM_STARTED') {
    const refTime = ep?.referenceTime || ep?.reference_time || null
    const windowKey = ev.detectedWindow || ep?.detectedWindow || null
    const title = buildMomentumAlertTitle({
      ticker,
      companyName: name,
      displayName: name,
      direction: dir,
      movePercent: move,
      exactMinutes: ev.exactMinutes,
      exactLabel: ev.exactLabel,
      windowKey,
      referenceTime: refTime,
      nowIso,
      marketSession,
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
    const refTime = ep?.referenceTime || ep?.reference_time || null
    const price = Number(ev.price ?? ep?.currentPrice ?? NaN)
    const accelKind = String(
      ev.accelKind || ev.state || ev.reason || '',
    ).toUpperCase()
    const isReAccel =
      accelKind.includes('RE_ACCEL') ||
      String(ev.reason || '').toUpperCase() === 'RE_ACCELERATION'

    const prevMove = Number(
      ev.recoveryFromMovePercent ??
        ev.previousAlertMovePercent ??
        ep?.lastNotifiedEpisodeMovePct ??
        NaN,
    )

    let sinceLastPct = null
    if (Number.isFinite(price) && Number.isFinite(lastNotifiedPrice) && lastNotifiedPrice !== 0) {
      sinceLastPct = ((price - lastNotifiedPrice) / lastNotifiedPrice) * 100
    } else if (Number.isFinite(move) && Number.isFinite(prevMove)) {
      sinceLastPct = move - prevMove
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
    const fromMove = Number.isFinite(prevMove) ? fmtDisplayPct(prevMove) : null

    // Recovery after strong fade: "accelerating again"
    if (isReAccel) {
      if (dir === 'UP') {
        return {
          title: withDirectionCircle(
            `${name} is accelerating again`,
            dir,
            move,
          ),
          body: fromMove
            ? `The move has recovered from ${fromMove} to ${totalMove} after the earlier fade.`
            : `The move is building again after the earlier fade; it now stands at ${totalMove}.`,
        }
      }
      return {
        title: withDirectionCircle(
          `${name} is accelerating again`,
          dir,
          move,
        ),
        body: fromMove
          ? `The decline has extended from ${fromMove} to ${totalMove} after the earlier fade.`
          : `The decline is building again after the earlier fade; it now stands at ${totalMove}.`,
      }
    }

    // Further +2pp after a prior re-acceleration (not first-leg surge)
    if (ev.extendsRecovery) {
      if (dir === 'UP') {
        return {
          title: withDirectionCircle(
            `${name} extends its recovery`,
            dir,
            move,
          ),
          body: `The surge now stands at ${totalMove}.`,
        }
      }
      return {
        title: withDirectionCircle(
          `${name} extends its decline`,
          dir,
          move,
        ),
        body: `The decline now stands at ${totalMove}.`,
      }
    }

    if (dir === 'UP') {
      return {
        title: withDirectionCircle(
          `${name} adds another ${sinceLastDisplay} in ${shortElapsed}`,
          dir,
          move,
        ),
        body: `The surge now stands at ${totalMove} over ${totalElapsed}.`,
      }
    }
    return {
      title: withDirectionCircle(
        `${name} falls another ${sinceLastDisplay} in ${shortElapsed}`,
        dir,
        move,
      ),
      body: `The decline now stands at ${totalMove} over ${totalElapsed}.`,
    }
  }

  if (type === 'MOMENTUM_REVERSED' || (type === 'MOMENTUM_ENDED' && ev.reason === 'REVERSAL')) {
    if (dir === 'UP') {
      // UP episode reversing → market going lower → red
      return {
        title: withDirectionCircle(
          `${name} reverses lower`,
          'DOWN',
          -1,
        ),
        body: 'Earlier gains have been erased as downside momentum builds.',
      }
    }
    // DOWN episode rebounding → green
    return {
      title: withDirectionCircle(
        `${name} rebounds sharply`,
        'UP',
        1,
      ),
      body: 'Earlier losses are being recovered as upward momentum builds.',
    }
  }

  /**
   * Strong giveback (≥60% of peak/trough move faded) — one-shot fade alert.
   * Example: peak +8.0%, remaining +3.2% → 60% giveback
   *   "🟢 SNDK has given back 60% of its surge"
   * Named STRONG_WEAKENING / STRONG_GIVEBACK — not REVERSAL (true reverse is separate).
   * Legacy MOMENTUM_STRONG_REVERSAL still accepted for hydrated history.
   */
  if (
    type === 'MOMENTUM_STRONG_WEAKENING' ||
    type === 'MOMENTUM_STRONG_GIVEBACK' ||
    type === 'MOMENTUM_STRONG_REVERSAL' ||
    type === 'MOMENTUM_MAJOR_FADE' ||
    type === 'STRONG_REVERSAL' ||
    type === 'STRONG_WEAKENING' ||
    type === 'STRONG_GIVEBACK'
  ) {
    const peakMove = Number(
      ev.peakMovePercent ?? ep?.peakMovePercent ?? NaN,
    )
    const remaining = Number(
      ev.remainingMovePercent ??
        ev.movePercent ??
        ep?.currentMovePercent ??
        NaN,
    )
    let givebackPct = Number(ev.givebackPct)
    if (!Number.isFinite(givebackPct) && Number.isFinite(Number(ev.givebackRatio))) {
      givebackPct = Number(ev.givebackRatio) * 100
    }
    if (
      !Number.isFinite(givebackPct) &&
      Number.isFinite(peakMove) &&
      peakMove !== 0 &&
      Number.isFinite(remaining)
    ) {
      givebackPct =
        ((Math.abs(peakMove) - Math.abs(remaining)) / Math.abs(peakMove)) * 100
    }
    if (!Number.isFinite(givebackPct)) givebackPct = 60
    const gbRounded = Math.max(0, Math.round(givebackPct))
    const peakDisp = Number.isFinite(peakMove)
      ? fmtDisplayPct(peakMove)
      : 'the earlier'
    const remDisp = Number.isFinite(remaining)
      ? fmtDisplayPct(remaining)
      : 'a fraction'

    if (dir === 'UP') {
      return {
        title: withDirectionCircle(
          `${name} has given back ${gbRounded}% of its surge`,
          dir,
          move,
        ),
        body: `The earlier ${peakDisp} move has faded sharply, with about ${remDisp} remaining.`,
      }
    }
    return {
      title: withDirectionCircle(
        `${name} has given back ${gbRounded}% of its decline`,
        dir,
        move,
      ),
      body: `The earlier ${peakDisp} move has faded sharply, with about ${remDisp} remaining.`,
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
  if (
    t === 'MOMENTUM_STRONG_WEAKENING' ||
    t === 'MOMENTUM_STRONG_GIVEBACK' ||
    t === 'MOMENTUM_STRONG_REVERSAL' || // legacy hydrated rows
    t === 'MOMENTUM_MAJOR_FADE' ||
    t === 'STRONG_REVERSAL' ||
    t === 'STRONG_WEAKENING' ||
    t === 'STRONG_GIVEBACK'
  ) {
    return true
  }
  if (t === 'MOMENTUM_ENDED' && reason === 'REVERSAL') return true
  // EXPIRED, INACTIVITY, CLOSED_AT_MARKET_CLOSE, HOLDING, WEAKENING → no
  return false
}
