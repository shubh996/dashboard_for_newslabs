/**
 * Market timestamps display in the instrument's exchange timezone —
 * never the browser local zone (e.g. do not show MSFT close as BST).
 *
 * Prefer Yahoo `exchangeTimezoneName`; fall back to exchange code / symbol
 * suffix / asset-class defaults.
 */
import { timeZoneSuffix } from '@/lib/localTimeZone'

export const EXCHANGE_TZ_FALLBACK = 'America/New_York'

/** Common Yahoo exchange / fullExchangeName → IANA zone. */
const EXCHANGE_CODE_TZ: Record<string, string> = {
  // United States
  NMS: 'America/New_York',
  NGM: 'America/New_York',
  NAS: 'America/New_York',
  NASDAQ: 'America/New_York',
  NASDAQGS: 'America/New_York',
  NYQ: 'America/New_York',
  NYSE: 'America/New_York',
  PCX: 'America/New_York',
  ASE: 'America/New_York',
  AMEX: 'America/New_York',
  BTS: 'America/New_York',
  YHD: 'America/New_York',
  OQB: 'America/New_York',
  OQX: 'America/New_York',
  CCY: 'America/New_York', // Yahoo FX often
  // United Kingdom / Ireland
  LSE: 'Europe/London',
  LON: 'Europe/London',
  AQS: 'Europe/London',
  IOB: 'Europe/London',
  // India
  NSI: 'Asia/Kolkata',
  NSE: 'Asia/Kolkata',
  BSE: 'Asia/Kolkata',
  BOM: 'Asia/Kolkata',
  // Europe
  GER: 'Europe/Berlin',
  FRA: 'Europe/Berlin',
  XETRA: 'Europe/Berlin',
  ETR: 'Europe/Berlin',
  PAR: 'Europe/Paris',
  EPA: 'Europe/Paris',
  AMS: 'Europe/Amsterdam',
  AEX: 'Europe/Amsterdam',
  BRU: 'Europe/Brussels',
  SWX: 'Europe/Zurich',
  VIE: 'Europe/Vienna',
  MCE: 'Europe/Madrid',
  MIL: 'Europe/Rome',
  HEL: 'Europe/Helsinki',
  CPH: 'Europe/Copenhagen',
  STO: 'Europe/Stockholm',
  OSL: 'Europe/Oslo',
  WSE: 'Europe/Warsaw',
  // Asia-Pacific
  JPX: 'Asia/Tokyo',
  TYO: 'Asia/Tokyo',
  OSA: 'Asia/Tokyo',
  HKG: 'Asia/Hong_Kong',
  HK: 'Asia/Hong_Kong',
  SHH: 'Asia/Shanghai',
  SHZ: 'Asia/Shanghai',
  SSA: 'Asia/Seoul',
  KSC: 'Asia/Seoul',
  SES: 'Asia/Singapore',
  SGX: 'Asia/Singapore',
  ASX: 'Australia/Sydney',
  AX: 'Australia/Sydney',
  NZE: 'Pacific/Auckland',
  // Americas (non-US)
  TOR: 'America/Toronto',
  TSE: 'America/Toronto',
  VAN: 'America/Vancouver',
  SAO: 'America/Sao_Paulo',
  MEX: 'America/Mexico_City',
  // Futures / CME group — US session convention
  CME: 'America/Chicago',
  CBT: 'America/Chicago',
  CMX: 'America/New_York',
  NYM: 'America/New_York',
}

/** Yahoo / listing suffix → IANA zone. */
const SYMBOL_SUFFIX_TZ: Array<{ re: RegExp; tz: string }> = [
  { re: /\.L$/i, tz: 'Europe/London' },
  { re: /\.IL$/i, tz: 'Europe/London' },
  { re: /\.NS$/i, tz: 'Asia/Kolkata' },
  { re: /\.BO$/i, tz: 'Asia/Kolkata' },
  { re: /\.T$/i, tz: 'Asia/Tokyo' },
  { re: /\.DE$/i, tz: 'Europe/Berlin' },
  { re: /\.F$/i, tz: 'Europe/Berlin' },
  { re: /\.PA$/i, tz: 'Europe/Paris' },
  { re: /\.AS$/i, tz: 'Europe/Amsterdam' },
  { re: /\.SW$/i, tz: 'Europe/Zurich' },
  { re: /\.HK$/i, tz: 'Asia/Hong_Kong' },
  { re: /\.SS$/i, tz: 'Asia/Shanghai' },
  { re: /\.SZ$/i, tz: 'Asia/Shanghai' },
  { re: /\.KS$/i, tz: 'Asia/Seoul' },
  { re: /\.KQ$/i, tz: 'Asia/Seoul' },
  { re: /\.SI$/i, tz: 'Asia/Singapore' },
  { re: /\.AX$/i, tz: 'Australia/Sydney' },
  { re: /\.NZ$/i, tz: 'Pacific/Auckland' },
  { re: /\.TO$/i, tz: 'America/Toronto' },
  { re: /\.V$/i, tz: 'America/Vancouver' },
  { re: /\.SA$/i, tz: 'America/Sao_Paulo' },
  { re: /\.MX$/i, tz: 'America/Mexico_City' },
]

export type ExchangeTimeZoneInput = {
  exchangeTimezoneName?: string | null
  exchange?: string | null
  symbol?: string | null
  assetClass?: string | null
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

function normalizeExchangeKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * Resolve IANA timezone for market timestamp display.
 */
export function resolveExchangeTimeZone(input?: ExchangeTimeZoneInput | null): string {
  const named = String(input?.exchangeTimezoneName || '').trim()
  if (named && isValidTimeZone(named)) return named

  const exchangeRaw = String(input?.exchange || '').trim()
  if (exchangeRaw) {
    const key = normalizeExchangeKey(exchangeRaw)
    if (EXCHANGE_CODE_TZ[key] && isValidTimeZone(EXCHANGE_CODE_TZ[key])) {
      return EXCHANGE_CODE_TZ[key]
    }
    // fullExchangeName often like "NasdaqGS" / "NYSE"
    for (const [code, tz] of Object.entries(EXCHANGE_CODE_TZ)) {
      if (key.includes(code) && isValidTimeZone(tz)) return tz
    }
  }

  const symbol = String(input?.symbol || '').trim().toUpperCase()
  if (symbol) {
    for (const { re, tz } of SYMBOL_SUFFIX_TZ) {
      if (re.test(symbol) && isValidTimeZone(tz)) return tz
    }
    if (symbol.endsWith('-USD') || symbol.endsWith('-USDT') || symbol.includes('-')) {
      const cls = String(input?.assetClass || '').toLowerCase()
      if (cls === 'crypto' || /^(BTC|ETH|SOL|XRP|DOGE|ADA|DOT|AVAX|MATIC|LINK)/.test(symbol)) {
        return 'UTC'
      }
    }
    if (symbol.endsWith('=X')) return EXCHANGE_TZ_FALLBACK
    if (symbol.endsWith('=F')) return EXCHANGE_TZ_FALLBACK
  }

  const assetClass = String(input?.assetClass || '').toLowerCase()
  if (assetClass === 'crypto') return 'UTC'
  if (
    assetClass === 'forex' ||
    assetClass === 'fx' ||
    assetClass === 'commodity' ||
    assetClass === 'future' ||
    assetClass === 'equity' ||
    assetClass === 'etf' ||
    assetClass === 'index'
  ) {
    return EXCHANGE_TZ_FALLBACK
  }

  return EXCHANGE_TZ_FALLBACK
}

export function exchangeTimeZoneSuffix(date: Date, timeZone: string): string {
  return timeZoneSuffix(date, timeZone)
}

/** Append exchange zone abbrev to an already-zoned clock string. */
export function withExchangeTimeZone(
  value: string,
  date: Date,
  timeZone: string,
): string {
  const suffix = exchangeTimeZoneSuffix(date, timeZone)
  if (!suffix) return value
  const stripped = String(value || '')
    .replace(
      /\s+\b(ET|EST|EDT|GMT|BST|IST|UTC|UK|CET|CEST|JST|HKT|SGT|AEST|AEDT|GMT[+-][\d:]+|UTC[+-][\d:]+)\b\s*$/i,
      '',
    )
    .trim()
  return `${stripped} ${suffix}`
}

export type FormatExchangeTimeOpts = {
  /** Include calendar date (month + day). */
  date?: boolean
  /** Include weekday short (Fri). */
  weekday?: boolean
  /** Include year. */
  year?: boolean
  /** Include seconds. */
  seconds?: boolean
  /** 12h clock (default true). */
  hour12?: boolean
  /** Append short zone name (default true). */
  withZone?: boolean
}

/**
 * Format an instant in the exchange timezone (clock + optional zone suffix).
 */
export function formatExchangeTime(
  msOrIso: string | number | Date | null | undefined,
  timeZone: string,
  opts: FormatExchangeTimeOpts = {},
): string | null {
  if (msOrIso == null || msOrIso === '') return null
  const date =
    msOrIso instanceof Date
      ? msOrIso
      : new Date(typeof msOrIso === 'number' ? msOrIso : String(msOrIso))
  if (Number.isNaN(date.getTime())) return null

  const hour12 = opts.hour12 !== false
  const withZone = opts.withZone !== false
  const parts: Intl.DateTimeFormatOptions = {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12,
  }
  if (opts.seconds) parts.second = '2-digit'
  if (opts.weekday) parts.weekday = 'short'
  if (opts.date) {
    parts.month = 'short'
    parts.day = 'numeric'
  }
  if (opts.year) parts.year = 'numeric'

  try {
    const clock = date.toLocaleString('en-US', parts)
    return withZone ? withExchangeTimeZone(clock, date, timeZone) : clock
  } catch {
    return null
  }
}
