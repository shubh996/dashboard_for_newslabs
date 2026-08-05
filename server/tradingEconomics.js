/**
 * Trading Economics scrapes for non-equity instruments (commodities, forex,
 * indexes, crypto) used by the Trigger notifications dashboard.
 *
 * Equity tickers continue to use Perplexity finance; everything else is
 * resolved to a Trading Economics page and scraped via Firecrawl.
 *
 * For TE pages we ONLY use the Summary tab narrative (#historical), e.g.:
 *   "Crude oil fell to around $79 per barrel on Tuesday, touching its lowest
 *    level in more than a week, as renewed diplomatic efforts over the Strait
 *    of Hormuz improved the outlook for Middle East oil supplies. …"
 * That full paragraph is the single reason for the alert.
 *
 * We deliberately IGNORE:
 *  - Stats tab ("down 3.83% from the previous day. Over the past month…")
 *  - Forecast tab ("is expected to trade…")
 *  - Actual/Previous tables
 *  - Extra News Stream items (except as crypto fallback when no Summary exists)
 */

import { load as loadHtml } from 'cheerio'

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1'

const MONTHS_SHORT = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
}

/** Yahoo futures root / common aliases → TE commodity slug */
const COMMODITY_BY_SYMBOL = {
  CL: 'crude-oil',
  OIL: 'crude-oil',
  CRUDE: 'crude-oil',
  'CRUDE-OIL': 'crude-oil',
  WTI: 'crude-oil',
  BZ: 'brent-crude-oil',
  BRENT: 'brent-crude-oil',
  'BRENT-CRUDE': 'brent-crude-oil',
  'BRENT-CRUDE-OIL': 'brent-crude-oil',
  NG: 'natural-gas',
  NATGAS: 'natural-gas',
  'NATURAL-GAS': 'natural-gas',
  RB: 'gasoline',
  GASOLINE: 'gasoline',
  HO: 'heating-oil',
  'HEATING-OIL': 'heating-oil',
  GC: 'gold',
  GOLD: 'gold',
  XAU: 'gold',
  SI: 'silver',
  SILVER: 'silver',
  XAG: 'silver',
  HG: 'copper',
  COPPER: 'copper',
  PL: 'platinum',
  PLATINUM: 'platinum',
  PA: 'palladium',
  PALLADIUM: 'palladium',
  ALI: 'aluminum',
  ALU: 'aluminum',
  ALUMINUM: 'aluminum',
  ALUMINIUM: 'aluminum',
  ZC: 'corn',
  CORN: 'corn',
  ZW: 'wheat',
  WHEAT: 'wheat',
  ZS: 'soybeans',
  SOY: 'soybeans',
  SOYBEAN: 'soybeans',
  SOYBEANS: 'soybeans',
  KC: 'coffee',
  COFFEE: 'coffee',
  CT: 'cotton',
  COTTON: 'cotton',
  SB: 'sugar',
  SUGAR: 'sugar',
  CC: 'cocoa',
  COCOA: 'cocoa',
  LE: 'live-cattle',
  CATTLE: 'live-cattle',
  'LIVE-CATTLE': 'live-cattle',
  HE: 'lean-hogs',
  HOGS: 'lean-hogs',
  'LEAN-HOGS': 'lean-hogs',
  ZO: 'oat',
  OAT: 'oat',
  OATS: 'oat',
  ZR: 'rice',
  RICE: 'rice',
  LUMBER: 'lumber',
  LB: 'lumber',
  COAL: 'coal',
  URANIUM: 'uranium',
  LITHIUM: 'lithium',
  STEEL: 'steel',
  NICKEL: 'nickel',
  ZINC: 'zinc',
  TIN: 'tin',
  LEAD: 'lead',
  IRON: 'iron-ore',
  'IRON-ORE': 'iron-ore',
  ETHANOL: 'ethanol',
  PROPANE: 'propane',
  NAPHTHA: 'naphtha',
  BITUMEN: 'bitumen',
  RUBBER: 'rubber',
  OJ: 'orange-juice',
  'ORANGE-JUICE': 'orange-juice',
  PALM: 'palm-oil',
  'PALM-OIL': 'palm-oil',
  CANOLA: 'canola',
  MILK: 'milk',
  CHEESE: 'cheese',
  BEEF: 'beef',
  CRB: 'crb',
  GSCI: 'gsci',
}

/** ISO pair or Yahoo FX root → TE path (no leading slash) */
const FOREX_PATH_BY_PAIR = {
  EURUSD: 'euro-area/currency',
  GBPUSD: 'united-kingdom/currency',
  AUDUSD: 'australia/currency',
  NZDUSD: 'new-zealand/currency',
  USDJPY: 'japan/currency',
  USDCNY: 'china/currency',
  USDCHF: 'switzerland/currency',
  USDCAD: 'canada/currency',
  USDMXN: 'mexico/currency',
  USDINR: 'india/currency',
  USDBRL: 'brazil/currency',
  USDRUB: 'russia/currency',
  USDKRW: 'south-korea/currency',
  USDTRY: 'turkey/currency',
  USDSEK: 'sweden/currency',
  USDPLN: 'poland/currency',
  USDNOK: 'norway/currency',
  USDZAR: 'south-africa/currency',
  USDDKK: 'denmark/currency',
  USDSGD: 'singapore/currency',
  USDILS: 'israel/currency',
  USDHKD: 'hong-kong/currency',
  USDCLP: 'chile/currency',
  USDPKR: 'pakistan/currency',
  USDCZK: 'czech-republic/currency',
  USDHUF: 'hungary/currency',
  USDIDR: 'indonesia/currency',
  USDTHB: 'thailand/currency',
  USDMYR: 'malaysia/currency',
  USDPHP: 'philippines/currency',
  USDTWD: 'taiwan/currency',
  USDAED: 'united-arab-emirates/currency',
  USDSAR: 'saudi-arabia/currency',
  USDNGN: 'nigeria/currency',
  USDEGP: 'egypt/currency',
  USDARS: 'argentina/currency',
  USDCOP: 'colombia/currency',
  USDPEN: 'peru/currency',
  DXY: 'united-states/currency',
  DX: 'united-states/currency',
  DOLLAR: 'united-states/currency',
  'US-DOLLAR': 'united-states/currency',
  USDINDEX: 'united-states/currency',
  EURGBP: 'eurgbp:cur',
  EURAUD: 'euraud:cur',
  EURNZD: 'eurnzd:cur',
  EURJPY: 'eurjpy:cur',
  EURCHF: 'eurchf:cur',
  EURCAD: 'eurcad:cur',
  GBPJPY: 'gbpjpy:cur',
  GBPAUD: 'gbpaud:cur',
  AUDJPY: 'audjpy:cur',
  AUDNZD: 'audnzd:cur',
  CADJPY: 'cadjpy:cur',
  CHFJPY: 'chfjpy:cur',
  NZDJPY: 'nzdjpy:cur',
}

/**
 * Trading Economics crypto pages use: https://tradingeconomics.com/{pair}:cur
 * e.g. btcusd:cur, ethusd:cur, solusd:cur
 */
const CRYPTO_PATH_BY_SYMBOL = {
  BTC: 'btcusd:cur',
  BTCUSD: 'btcusd:cur',
  XBT: 'btcusd:cur',
  BITCOIN: 'btcusd:cur',
  ETH: 'ethusd:cur',
  ETHUSD: 'ethusd:cur',
  ETHEREUM: 'ethusd:cur',
  XRP: 'xrpusd:cur',
  XRPUSD: 'xrpusd:cur',
  SOL: 'solusd:cur',
  SOLUSD: 'solusd:cur',
  ADA: 'adausd:cur',
  ADAUSD: 'adausd:cur',
  DOGE: 'dogeusd:cur',
  DOGEUSD: 'dogeusd:cur',
  BNB: 'bnbusd:cur',
  BNBUSD: 'bnbusd:cur',
  LTC: 'ltcusd:cur',
  LTCUSD: 'ltcusd:cur',
  UNI: 'uniusd:cur',
  UNIUSD: 'uniusd:cur',
  MATIC: 'mtcusd:cur',
  MTC: 'mtcusd:cur',
  MTCUSD: 'mtcusd:cur',
  DAI: 'daiusd:cur',
  DAIUSD: 'daiusd:cur',
  ALGO: 'algusd:cur',
  ALGUSD: 'algusd:cur',
}

const INDEX_PATH_BY_SYMBOL = {
  GSPC: 'united-states/stock-market',
  SPX: 'united-states/stock-market',
  SP500: 'united-states/stock-market',
  'S&P500': 'united-states/stock-market',
  DJI: 'united-states/stock-market',
  DJIA: 'united-states/stock-market',
  IXIC: 'united-states/stock-market',
  NASDAQ: 'united-states/stock-market',
  RUT: 'united-states/stock-market',
  VIX: 'vix:ind',
  NDX: 'united-states/stock-market',
  FTSE: 'united-kingdom/stock-market',
  UKX: 'united-kingdom/stock-market',
  GDAXI: 'germany/stock-market',
  DAX: 'germany/stock-market',
  FCHI: 'france/stock-market',
  CAC: 'france/stock-market',
  N225: 'japan/stock-market',
  NKY: 'japan/stock-market',
  HSI: 'hong-kong/stock-market',
  SSEC: 'china/stock-market',
  AXJO: 'australia/stock-market',
}

function firecrawlKey() {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) {
    throw new Error('Add FIRECRAWL_API_KEY to .env.local')
  }
  return key
}

async function firecrawlFetch(path, init = {}) {
  const response = await fetch(`${FIRECRAWL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${firecrawlKey()}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  if (!response.ok) {
    const message =
      body?.error ||
      body?.message ||
      `Firecrawl ${path} failed (${response.status})`
    const error = new Error(message)
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

async function getFirecrawlCreditUsage() {
  const body = await firecrawlFetch('/team/credit-usage')
  const data = body?.data || body || {}
  return {
    remaining_credits: data.remaining_credits ?? data.remainingCredits ?? null,
    plan_credits: data.plan_credits ?? data.planCredits ?? null,
    billing_period_start:
      data.billing_period_start ?? data.billingPeriodStart ?? null,
    billing_period_end:
      data.billing_period_end ?? data.billingPeriodEnd ?? null,
    raw: data,
  }
}

function cleanSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\//g, '')
}

function stripYahooSuffix(symbol) {
  return cleanSymbol(symbol)
    .replace(/=F$/i, '')
    .replace(/=X$/i, '')
    .replace(/-USD$/i, '')
    .replace(/-USDT$/i, '')
    .replace(/^\^/, '')
}

function slugifyName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isLikelyEquityTicker(symbol) {
  const s = cleanSymbol(symbol)
  if (!s) return false
  // Classic equity: 1–5 letters, optional class share (.B / -B)
  if (/^[A-Z]{1,5}([.\-][A-Z])?$/.test(s)) return true
  // Common ETF-like 3–4 letter roots still equity by default
  return false
}

function looksLikeForexPair(symbol) {
  const s = cleanSymbol(symbol)
  if (!s) return false
  if (/=X$/i.test(String(symbol || '').toUpperCase())) return true
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(String(symbol || '').trim().toUpperCase())) {
    return true
  }
  if (/^[A-Z]{6}$/.test(s) && FOREX_PATH_BY_PAIR[s]) return true
  if (/^[A-Z]{6}$/.test(s)) {
    // Heuristic: two ISO currency codes (letters only, length 6)
    const a = s.slice(0, 3)
    const b = s.slice(3)
    const known = new Set([
      'USD',
      'EUR',
      'GBP',
      'JPY',
      'AUD',
      'NZD',
      'CAD',
      'CHF',
      'CNY',
      'HKD',
      'SGD',
      'INR',
      'MXN',
      'BRL',
      'ZAR',
      'SEK',
      'NOK',
      'DKK',
      'TRY',
      'RUB',
      'KRW',
      'TWD',
      'THB',
      'PLN',
      'HUF',
      'CZK',
      'ILS',
      'CLP',
      'PHP',
      'IDR',
      'MYR',
      'AED',
      'SAR',
      'PKR',
      'ARS',
      'COP',
      'PEN',
      'NGN',
      'EGP',
    ])
    return known.has(a) && known.has(b)
  }
  return false
}

function looksLikeCommodity(symbol, companyName = '') {
  const s = stripYahooSuffix(symbol)
  if (COMMODITY_BY_SYMBOL[s]) return true
  if (/=F$/i.test(String(symbol || ''))) return true
  const name = slugifyName(companyName)
  if (!name) return false
  const commodityHints = [
    'gold',
    'silver',
    'crude',
    'oil',
    'copper',
    'wheat',
    'corn',
    'soy',
    'natural-gas',
    'commodity',
    'futures',
    'platinum',
    'palladium',
    'coffee',
    'cotton',
    'sugar',
    'cocoa',
    'lumber',
    'aluminum',
    'nickel',
    'zinc',
  ]
  return commodityHints.some((hint) => name.includes(hint))
}

function looksLikeCrypto(symbol, companyName = '') {
  const raw = cleanSymbol(symbol)
  const s = stripYahooSuffix(symbol)
  if (CRYPTO_PATH_BY_SYMBOL[s] || CRYPTO_PATH_BY_SYMBOL[raw]) return true
  if (/-(USD|USDT)$/i.test(String(symbol || ''))) return true
  const name = slugifyName(companyName)
  return Boolean(name && /(bitcoin|ethereum|crypto|solana|dogecoin)/.test(name))
}

function looksLikeIndex(symbol, companyName = '') {
  const raw = String(symbol || '').trim()
  if (raw.startsWith('^')) return true
  const s = stripYahooSuffix(symbol)
  if (INDEX_PATH_BY_SYMBOL[s]) return true
  const name = slugifyName(companyName)
  return Boolean(name && /(index|s-p-500|nasdaq|dow-jones|ftse|dax)/.test(name))
}

/**
 * Classify a monitored symbol for scrape routing.
 * Equity → Perplexity; commodity / forex / crypto / index → Trading Economics.
 */
export function classifyAsset(ticker, companyName = '') {
  const raw = String(ticker || '').trim()
  const symbol = cleanSymbol(raw)
  const name = String(companyName || '').trim()

  if (!symbol && !name) {
    return {
      asset_class: 'equity',
      scrape_source: 'perplexity',
      reason: 'empty',
    }
  }

  if (looksLikeCrypto(raw, name)) {
    return {
      asset_class: 'crypto',
      scrape_source: 'trading_economics',
      reason: 'crypto_symbol',
    }
  }
  if (looksLikeForexPair(raw) || /forex|currency|fx\b|exchange rate/i.test(name)) {
    return {
      asset_class: 'forex',
      scrape_source: 'trading_economics',
      reason: 'forex_pair',
    }
  }
  if (looksLikeCommodity(raw, name)) {
    return {
      asset_class: 'commodity',
      scrape_source: 'trading_economics',
      reason: 'commodity_symbol',
    }
  }
  if (looksLikeIndex(raw, name)) {
    return {
      asset_class: 'index',
      scrape_source: 'trading_economics',
      reason: 'index_symbol',
    }
  }

  // Name-only fallbacks when ticker is opaque
  const nameSlug = slugifyName(name)
  if (nameSlug && COMMODITY_BY_SYMBOL[nameSlug.toUpperCase().replace(/-/g, '')]) {
    return {
      asset_class: 'commodity',
      scrape_source: 'trading_economics',
      reason: 'company_name_commodity',
    }
  }

  if (isLikelyEquityTicker(symbol) || !symbol) {
    return {
      asset_class: 'equity',
      scrape_source: 'perplexity',
      reason: 'default_equity',
    }
  }

  // Unknown non-classic symbols: prefer TE search path via name slug if present
  if (nameSlug && !isLikelyEquityTicker(symbol)) {
    return {
      asset_class: 'commodity',
      scrape_source: 'trading_economics',
      reason: 'unknown_non_equity',
    }
  }

  return {
    asset_class: 'equity',
    scrape_source: 'perplexity',
    reason: 'fallback_equity',
  }
}

function resolveCommodityPath(ticker, companyName = '') {
  const raw = String(ticker || '').trim()
  const root = stripYahooSuffix(raw)
  if (COMMODITY_BY_SYMBOL[root]) return `commodity/${COMMODITY_BY_SYMBOL[root]}`

  const nameSlug = slugifyName(companyName)
  if (nameSlug) {
    // Try direct TE slug from company name
    const nameKey = nameSlug.toUpperCase().replace(/-/g, '')
    for (const [key, slug] of Object.entries(COMMODITY_BY_SYMBOL)) {
      if (key.replace(/-/g, '') === nameKey || nameSlug === slug) {
        return `commodity/${slug}`
      }
    }
    if (
      /gold|silver|crude|oil|copper|wheat|corn|soy|coffee|cotton|sugar|cocoa|gas|platinum|palladium|aluminum|nickel|zinc|lumber/.test(
        nameSlug,
      )
    ) {
      return `commodity/${nameSlug}`
    }
  }

  // Last resort: treat cleaned ticker as TE slug
  const tickerSlug = slugifyName(root)
  if (tickerSlug) return `commodity/${tickerSlug}`
  return null
}

function resolveForexPath(ticker, companyName = '') {
  const raw = String(ticker || '').trim().toUpperCase()
  let pair = cleanSymbol(raw)
    .replace(/=X$/i, '')
    .replace(/\//g, '')

  if (FOREX_PATH_BY_PAIR[pair]) return FOREX_PATH_BY_PAIR[pair]

  // Invert common USDXXX already covered; try XXXUSD
  if (pair.length === 6 && FOREX_PATH_BY_PAIR[pair]) {
    return FOREX_PATH_BY_PAIR[pair]
  }

  // Crosses use TE short form: eurgbp:cur
  if (pair.length === 6) {
    return `${pair.toLowerCase()}:cur`
  }

  const name = String(companyName || '')
  const pairFromName = name.match(/\b([A-Z]{3})\s*[\/-]\s*([A-Z]{3})\b/i)
  if (pairFromName) {
    const composed = `${pairFromName[1]}${pairFromName[2]}`.toUpperCase()
    if (FOREX_PATH_BY_PAIR[composed]) return FOREX_PATH_BY_PAIR[composed]
    return `${composed.toLowerCase()}:cur`
  }

  if (/dollar index|dxy|us dollar/i.test(name)) {
    return FOREX_PATH_BY_PAIR.DXY
  }

  return null
}

function resolveCryptoPath(ticker) {
  const root = stripYahooSuffix(ticker)
  const raw = cleanSymbol(ticker)
  const mapped = CRYPTO_PATH_BY_SYMBOL[root] || CRYPTO_PATH_BY_SYMBOL[raw]
  if (mapped) return mapped

  // Already a pair like BTCUSD / ETHUSD
  if (/^[A-Z]{2,10}USD$/.test(raw)) {
    return `${raw.toLowerCase()}:cur`
  }
  if (/^[A-Z]{2,10}USD$/.test(root)) {
    return `${root.toLowerCase()}:cur`
  }

  // Single-asset symbol → assume USD quote: BTC → btcusd:cur
  if (/^[A-Z]{2,10}$/.test(root)) {
    return `${root.toLowerCase()}usd:cur`
  }
  return null
}

function resolveIndexPath(ticker) {
  const root = stripYahooSuffix(ticker)
  return INDEX_PATH_BY_SYMBOL[root] || null
}

/**
 * Resolve the Trading Economics page for a non-equity instrument.
 */
export function resolveTradingEconomicsTarget(ticker, companyName = '') {
  const classification = classifyAsset(ticker, companyName)
  if (classification.scrape_source !== 'trading_economics') {
    return {
      ...classification,
      ticker: cleanSymbol(ticker) || String(ticker || '').trim().toUpperCase(),
      url: null,
      path: null,
      display_name: companyName || ticker,
    }
  }

  let path = null
  if (classification.asset_class === 'forex') {
    path = resolveForexPath(ticker, companyName)
  } else if (classification.asset_class === 'crypto') {
    path = resolveCryptoPath(ticker)
  } else if (classification.asset_class === 'index') {
    path = resolveIndexPath(ticker) || resolveCommodityPath(ticker, companyName)
  } else {
    path = resolveCommodityPath(ticker, companyName)
  }

  const url = path ? `https://tradingeconomics.com/${path}` : null
  return {
    ...classification,
    ticker: cleanSymbol(ticker) || String(ticker || '').trim().toUpperCase(),
    path,
    url,
    display_name: companyName || ticker,
  }
}

export function tradingEconomicsUrl(ticker, companyName = '') {
  return resolveTradingEconomicsTarget(ticker, companyName).url
}

function parseTeDateToIso(displayDate, now = new Date()) {
  const text = String(displayDate || '').trim()
  // 2026-07-28
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  // July 28, 2026 | Jul 28, 2026 | 28 July 2026
  let match = text.match(
    /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})$/i,
  )
  if (match) {
    const mon = match[1].slice(0, 3)
    const monthKey = mon[0].toUpperCase() + mon.slice(1, 3).toLowerCase()
    const month = MONTHS_SHORT[monthKey]
    const day = Number(match[2])
    const year = Number(match[3])
    if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) return null
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  match = text.match(
    /^(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})$/i,
  )
  if (match) {
    const mon = match[2].slice(0, 3)
    const monthKey = mon[0].toUpperCase() + mon.slice(1, 3).toLowerCase()
    const month = MONTHS_SHORT[monthKey]
    const day = Number(match[1])
    const year = Number(match[3])
    if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) return null
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  // Jul/28 (year inferred)
  match = text.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\/(\d{1,2})$/i,
  )
  if (match) {
    const monthKey =
      match[1][0].toUpperCase() + match[1].slice(1, 3).toLowerCase()
    const month = MONTHS_SHORT[monthKey]
    const day = Number(match[2])
    if (month == null || !Number.isFinite(day)) return null
    let year = now.getFullYear()
    let candidate = new Date(Date.UTC(year, month, day))
    if (candidate.getTime() - now.getTime() > 2 * 24 * 60 * 60 * 1000) {
      year -= 1
      candidate = new Date(Date.UTC(year, month, day))
    }
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

function formatDisplayDate(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function inferDirectionFromText(text, signedChange) {
  if (signedChange && String(signedChange).startsWith('-')) return 'down'
  if (signedChange && String(signedChange).startsWith('+')) return 'up'
  const s = String(text || '').toLowerCase()
  if (
    /\b(fell|fall|falling|down|drop|drops|dropped|dropping|slide|slides|slid|slip|slips|slipped|decline|declines|declined|weaken|weakens|weakened|lose|loses|lost|retreat|retreats|retreated|tumble|tumbles|tumbled|plunge|plunges|plunged|plunging|sink|sinks|sank)\b/.test(
      s,
    )
  ) {
    return 'down'
  }
  if (
    /\b(rose|rise|rises|up|gain|gains|gained|climb|climbs|climbed|advance|advances|advanced|rally|rallies|rallied|surge|surges|surged|jump|jumps|jumped|strengthen|strengthens|strengthened|rebound|rebounds|rebounded)\b/.test(
      s,
    )
  ) {
    return 'up'
  }
  return null
}

function extractLastUpdatedDate(text, now = new Date()) {
  const source = String(text || '')
  // "was last updated on July 28 of 2026"
  const match = source.match(
    /last updated on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\s+(\d{1,2})\s+of\s+(\d{4})/i,
  )
  if (match) {
    return parseTeDateToIso(`${match[1]} ${match[2]}, ${match[3]}`, now)
  }
  // "on July 28, 2026, down/up ..."
  const onDate = source.match(
    /\bon\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i,
  )
  if (onDate) return parseTeDateToIso(onDate[1], now)
  // Crypto style: "this Tuesday July 28th" (year inferred)
  const cryptoDate = source.match(
    /\b(?:this\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  )
  if (cryptoDate) {
    const year = now.getFullYear()
    return parseTeDateToIso(`${cryptoDate[1]} ${cryptoDate[2]}, ${year}`, now)
  }
  return null
}

function formatSignedPercent(signWordOrSign, numeric) {
  const abs = String(numeric || '')
    .replace(/^[+\-−]/, '')
    .trim()
  if (!abs) return null
  const raw = String(signWordOrSign || '').toLowerCase().replace('−', '-')
  const neg =
    raw === '-' ||
    raw === 'down' ||
    raw === 'fell' ||
    raw === 'dropped' ||
    raw === 'slid' ||
    raw === 'lost' ||
    raw === 'slipped' ||
    raw === 'tumbled' ||
    raw === 'plunged' ||
    raw === 'decreasing' ||
    raw === 'losing' ||
    raw === 'weakened' ||
    raw === 'decreased'
  const pos =
    raw === '+' ||
    raw === 'up' ||
    raw === 'rose' ||
    raw === 'climbed' ||
    raw === 'gained' ||
    raw === 'jumped' ||
    raw === 'surged' ||
    raw === 'increasing' ||
    raw === 'gaining' ||
    raw === 'increased' ||
    raw === 'risen'
  if (neg) return `-${abs}%`
  if (pos) return `+${abs}%`
  // numeric already signed
  if (String(numeric).trim().startsWith('-') || String(numeric).includes('−')) {
    return `-${abs}%`
  }
  if (String(numeric).trim().startsWith('+')) return `+${abs}%`
  return `${abs}%`
}

function extractDayChangeFromSummaryText(text) {
  const s = String(text || '')
  // "fell about 1%" / "dropped more than 3%" / "rose 1%" / "down 3.83%"
  const about = s.match(
    /\b(fell|rose|dropped|climbed|slid|gained|lost|slipped|jumped|tumbled|surged|plunged)\b(?:\s+\w+){0,4}\s+(?:about\s+|more than\s+|nearly\s+|around\s+|over\s+)?([+\-−]?\d+(?:\.\d+)?)\s*%/i,
  )
  if (about) return formatSignedPercent(about[1], about[2])
  const bare = s.match(/\b(up|down)\s+([+\-−]?\d+(?:\.\d+)?)\s*%/i)
  if (bare) return formatSignedPercent(bare[1], bare[2])
  // Crypto-ish residual: "decreasing 263 or 0.41 percent"
  const crypto = s.match(
    /\b(increasing|decreasing|gaining|losing)\s+[\d,]+(?:\.\d+)?\s+or\s+([+\-−]?\d+(?:\.\d+)?)\s+percent/i,
  )
  if (crypto) return formatSignedPercent(crypto[1], crypto[2])
  return null
}

function extractPriceFromSummaryText(text) {
  const s = String(text || '')
  // "fell to around $79 per barrel" / "slipped below $1.14" / "climbed toward $66,000"
  const dollar = s.match(
    /\b(?:fell|rose|climbed|dropped|slipped|traded|touched|held|moved|surged|plunged|rebounded)?\s*(?:to\s+|below\s+|above\s+|near\s+|around\s+|toward\s+|towards\s+)?\$\s*([\d,]+(?:\.\d+)?)/i,
  )
  if (dollar) return `$${dollar[1]}`

  const withUnit = s.match(
    /\b(?:fell|rose|climbed|dropped|slipped|traded|touched)\s+(?:to\s+)?(?:around\s+|near\s+|about\s+|below\s+|above\s+)?([\d,]+(?:\.\d+)?)\s*(USD\/Bbl|USD\/t\.?oz|EUR\/T|per barrel|an ounce)?/i,
  )
  if (withUnit) {
    const num = withUnit[1]
    const unit = withUnit[2] ? ` ${withUnit[2]}` : ''
    return `${num}${unit}`.trim()
  }

  const tradedAt = s.match(/\btraded at\s+(\$?[\d,]+(?:\.\d+)?)/i)
  if (tradedAt) return tradedAt[1]
  return null
}

/**
 * Pull price + day % from the Stats blurb (metrics only — never used as reason).
 * "Crude Oil fell to 79.45 USD/Bbl on July 28, 2026, down 3.83% from the previous day."
 * "EUR/USD exchange rate rose to 1.1390 on July 28, 2026, up 0.19% from the previous session."
 * "Bitcoin US Dollar traded at 63461 ... decreasing 263 or 0.41 percent since the previous trading session."
 */
export function extractMetricsFromStatsParagraph(text) {
  const s = normalizeParagraph(text)
  if (!s) return null

  let price = null
  let priceChange = null
  let eventDate = null

  // Prefer the exact Stats sentence that pairs price + day %:
  // "fell to 79.45 USD/Bbl on July 28, 2026, down 3.83% from the previous day"
  const paired = s.match(
    /\b(?:fell|rose|climbed|dropped|slipped|decreased|increased)\s+to\s+(\$?[\d,]+(?:\.\d+)?)\s*([A-Za-z][A-Za-z0-9/.\s]{0,20}?)?\s*on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\s*,\s*(up|down)\s+([+\-−]?\d+(?:\.\d+)?)\s*%\s+from the previous (?:day|session)/i,
  )
  if (paired) {
    const unit = String(paired[2] || '')
      .replace(/\s+on$/i, '')
      .trim()
    price =
      unit && /[A-Za-z$€£/]/.test(unit)
        ? `${paired[1]} ${unit}`.replace(/\s+/g, ' ').trim()
        : paired[1]
    priceChange = formatSignedPercent(paired[4], paired[5])
    eventDate = parseTeDateToIso(paired[3])
  }

  // Commodity/forex day change (standalone)
  if (!priceChange) {
    const day = s.match(
      /\b(up|down)\s+([+\-−]?\d+(?:\.\d+)?)\s*%\s+from the previous (?:day|session)\b/i,
    )
    if (day) priceChange = formatSignedPercent(day[1], day[2])
  }

  // Crypto day change + price
  if (!priceChange) {
    const crypto = s.match(
      /\btraded at\s+(\$?[\d,]+(?:\.\d+)?)\b[^.]*?\b(increasing|decreasing|gaining|losing|rose|fell)\s+[\d,]+(?:\.\d+)?\s+or\s+([+\-−]?\d+(?:\.\d+)?)\s+percent\s+since the previous trading session/i,
    )
    if (crypto) {
      price = crypto[1]
      priceChange = formatSignedPercent(crypto[2], crypto[3])
    }
  }
  if (!priceChange) {
    const crypto = s.match(
      /\b(increasing|decreasing|gaining|losing|rose|fell)\s+[\d,]+(?:\.\d+)?\s+or\s+([+\-−]?\d+(?:\.\d+)?)\s+percent\s+since the previous trading session/i,
    )
    if (crypto) priceChange = formatSignedPercent(crypto[1], crypto[2])
  }

  // Price fallback: prefer precise "to 79.45 USD/Bbl on DATE" over vague "around $79"
  if (!price) {
    const precise = s.match(
      /\b(?:fell|rose|climbed|dropped|slipped|decreased|increased)\s+to\s+(\$?[\d,]+(?:\.\d+)?)\s*([A-Za-z][A-Za-z0-9/.]{0,12})?\s*on\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
    )
    if (precise) {
      const unit = String(precise[2] || '').trim()
      price =
        unit && /[A-Za-z$€£/]/.test(unit)
          ? `${precise[1]} ${unit}`.replace(/\s+/g, ' ').trim()
          : precise[1]
    }
  }
  if (!price) {
    const tradedAt = s.match(/\btraded at\s+(\$?[\d,]+(?:\.\d+)?)/i)
    if (tradedAt) price = tradedAt[1]
  }

  if (!eventDate) eventDate = extractLastUpdatedDate(s)

  if (!price && !priceChange) return null
  return { price, price_change: priceChange, event_date: eventDate, source: 'stats_metrics' }
}

/**
 * Find the Stats paragraph on the page and extract price / day % only.
 */
export function extractMetricsFromStatsSection(markdown, html = '') {
  const text = String(markdown || '')
  const candidates = []

  // Markdown headings + blocks that look like Stats
  const cutMatch = text.search(/\n##?\s*News Stream\b|\nNews Stream\b/i)
  const head = cutMatch >= 0 ? text.slice(0, cutMatch) : text
  for (const block of head.split(/\n{2,}/)) {
    const para = normalizeParagraph(block.replace(/^#+\s*/gm, ''))
    if (isTradingEconomicsStatsParagraph(para)) candidates.push(para)
  }
  const headingRe = /^#{1,4}\s+(.+)$/gm
  let m
  while ((m = headingRe.exec(head)) !== null) {
    const para = normalizeParagraph(m[1])
    if (isTradingEconomicsStatsParagraph(para)) candidates.push(para)
  }

  // HTML: #stats panel paragraphs
  if (html) {
    try {
      const $ = loadHtml(html)
      $('#stats, [id*="stats" i], [class*="stats" i]').each((_, el) => {
        const para = normalizeParagraph($(el).text())
        if (para.length > 60) candidates.push(para)
      })
      $('p, h2, h3').each((_, el) => {
        const para = normalizeParagraph($(el).text())
        if (isTradingEconomicsStatsParagraph(para)) candidates.push(para)
      })
    } catch {
      // ignore html parse issues
    }
  }

  // Prefer the purest Stats blurb (shortest that still has day % + previous day/session)
  const scored = candidates
    .map((para) => {
      const metrics = extractMetricsFromStatsParagraph(para)
      if (!metrics?.price_change && !metrics?.price) return null
      let purity = 0
      if (/\bfrom the previous (?:day|session)\b/i.test(para)) purity += 3
      if (/\blast updated on\b/i.test(para)) purity += 2
      if (/\bcontract for difference\b/i.test(para)) purity += 2
      // Penalize paragraphs that also contain long narrative (merged summary+stats)
      if (/\bas\b.{30,}?\b(investors|markets|talks|conflict|federal|etf)\b/i.test(para)) {
        purity -= 4
      }
      // Prefer compact stats sentences
      purity += Math.max(0, 3 - Math.floor(para.length / 400))
      return { para, metrics, purity }
    })
    .filter(Boolean)
    .sort((a, b) => b.purity - a.purity)

  if (!scored.length) return null
  const best = scored[0]
  return { ...best.metrics, paragraph: best.para }
}

/**
 * Fallback: day % from TE quote tables
 * | Crude Oil | 79.17 | -3.442 | -4.17% | ... |
 * | BTCUSD | 63664 | -60 | -0.09% | ... |
 */
export function extractMetricsFromQuoteTable(markdown, ticker = '') {
  const text = String(markdown || '')
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))

  const parseCells = (line) =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.replace(/\*\*/g, '').trim())

  // Find a header with Day / %Day / Day%
  let headerIdx = -1
  let headers = []
  for (let i = 0; i < lines.length; i += 1) {
    const cells = parseCells(lines[i]).map((c) => c.toLowerCase())
    if (
      cells.some((c) => c === 'day' || c === '%day' || c === '% day' || c === 'day %') ||
      (cells.includes('price') && cells.some((c) => /%/.test(c) || c === 'chg'))
    ) {
      headerIdx = i
      headers = cells
      break
    }
  }
  if (headerIdx < 0) return null

  const dayIdx = headers.findIndex(
    (c) => c === 'day' || c === '%day' || c === '% day' || c === 'day %' || c === '%chg',
  )
  const priceIdx = headers.findIndex((c) => c === 'price' || c === 'last')
  // Also try last % column before date
  const pctIdx =
    dayIdx >= 0
      ? dayIdx
      : headers.findIndex((c, idx) => idx > 0 && /%/.test(c) && !/year|month|week|yoy|ytd/.test(c))

  const want = cleanSymbol(ticker).replace(/=F$|=X$|-USD$/g, '')
  const wantLoose = want.replace(/USD$/i, '')

  for (let i = headerIdx + 1; i < Math.min(lines.length, headerIdx + 40); i += 1) {
    const cells = parseCells(lines[i])
    if (!cells.length || cells.every((c) => !c || /^[-:\s]+$/.test(c))) continue
    const label = String(cells[0] || '')
    const labelClean = cleanSymbol(label)
    // Prefer a row matching this instrument; else take first data row of the primary table
    const matchesTicker =
      !want ||
      labelClean.includes(want) ||
      labelClean.includes(wantLoose) ||
      (wantLoose && label.toUpperCase().includes(wantLoose))
    if (!matchesTicker && want) {
      // still allow first commodity self-row if label is empty-ish — skip non-match
      continue
    }

    let price = priceIdx >= 0 ? cells[priceIdx] : cells[1]
    let dayPct = pctIdx >= 0 ? cells[pctIdx] : null
    // Scan cells for a % value if header mapping failed
    if (!dayPct) {
      dayPct = cells.find((c) => /^[+\-−]?\d+(?:\.\d+)?%$/.test(String(c).replace(/\s/g, '')))
    }
    if (!price && cells[1]) price = cells[1]

    if (dayPct || price) {
      let priceChange = null
      if (dayPct) {
        const raw = String(dayPct).replace(/\s/g, '').replace('−', '-')
        const num = raw.replace('%', '')
        if (num.startsWith('-')) priceChange = `-${num.replace(/^-/, '')}%`
        else if (num.startsWith('+')) priceChange = `+${num.replace(/^\+/, '')}%`
        else priceChange = `${num}%`
      }
      return {
        price: price ? String(price).trim() : null,
        price_change: priceChange,
        event_date: null,
        source: 'quote_table',
      }
    }
  }

  // If ticker match failed, retry first data row of first price table
  if (want) {
    for (let i = headerIdx + 1; i < Math.min(lines.length, headerIdx + 15); i += 1) {
      const cells = parseCells(lines[i])
      if (!cells.length || cells.every((c) => !c || /^[-:\s]+$/.test(c))) continue
      const dayPct = cells.find((c) => /^[+\-−]?\d+(?:\.\d+)?%$/.test(String(c).replace(/\s/g, '')))
      const price = cells[1] || null
      if (!dayPct && !price) continue
      let priceChange = null
      if (dayPct) {
        const raw = String(dayPct).replace(/\s/g, '').replace('−', '-')
        const num = raw.replace('%', '')
        priceChange = num.startsWith('-')
          ? `-${num.replace(/^-/, '')}%`
          : num.startsWith('+')
            ? `+${num.replace(/^\+/, '')}%`
            : `${num}%`
      }
      return {
        price: price ? String(price).trim() : null,
        price_change: priceChange,
        event_date: null,
        source: 'quote_table_first_row',
      }
    }
  }
  return null
}

/**
 * Crypto header block:
 * Exchange Rate 63664
 * Daily Change -60.2600 -0.09%
 */
export function extractMetricsFromCryptoHeader(markdown) {
  const text = String(markdown || '')
  const rate = text.match(/Exchange Rate\s*\n+\s*([\d,]+(?:\.\d+)?)/i)
  const daily = text.match(
    /Daily Change\s*\n+\s*[+\-−]?[\d,]+(?:\.\d+)?\s+([+\-−]?\d+(?:\.\d+)?)\s*%/i,
  )
  if (!rate && !daily) return null
  let priceChange = null
  if (daily) {
    const num = daily[1].replace('−', '-')
    const abs = num.replace(/^[+\-]/, '')
    priceChange = num.trim().startsWith('-') ? `-${abs}%` : `+${abs}%`
  }
  return {
    price: rate ? rate[1] : null,
    price_change: priceChange,
    event_date: null,
    source: 'crypto_header',
  }
}

function normalizeParagraph(raw) {
  return String(raw || '')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when the text is the TE Stats tab blurb — we must NOT use this as reason.
 */
export function isTradingEconomicsStatsParagraph(text) {
  const s = String(text || '')
  if (!s) return false
  const dayChange =
    /\b(up|down)\s+\d+(?:\.\d+)?\s*%\s+from the previous (?:day|session)\b/i.test(s)
  const month = /\bover the past month\b/i.test(s)
  const year =
    /\bsame time last year\b/i.test(s) ||
    /\bover the last 12 months\b/i.test(s) ||
    /\blast 12 months\b/i.test(s)
  const hist = /\bhistorically\b/i.test(s) && /\ball time high\b/i.test(s)
  const updated = /\blast updated on\b/i.test(s)
  const cfd = /\bcontract for difference\b/i.test(s)
  // Strong stats fingerprint: day-change formula + month/year performance language
  if (dayChange && (month || year || hist || updated || cfd)) return true
  if (dayChange && month && year) return true
  if (updated && cfd && (month || year)) return true
  // Crypto stats template
  if (
    /\btraded at\s+[\d,$]+\b/i.test(s) &&
    /\bsince the previous trading session\b/i.test(s) &&
    (/\blooking back\b/i.test(s) || /\bover the last (?:four weeks|12 months)\b/i.test(s))
  ) {
    return true
  }
  return false
}

function isTradingEconomicsForecastParagraph(text) {
  const s = String(text || '')
  if (!s) return false
  if (/\bis expected to trade\b/i.test(s) && /\blooking forward, we estimate\b/i.test(s)) {
    return true
  }
  // Forecast-only (no narrative drivers)
  if (
    /\bis expected to trade\b/i.test(s) &&
    !/\bas\b.{10,}/i.test(s) &&
    s.length < 500
  ) {
    return true
  }
  return false
}

/**
 * Score a candidate for the TE Summary tab narrative (#historical).
 * Summary = market-driver story (why price moved), NOT Stats, NOT Forecast.
 */
function scoreSummaryParagraph(text) {
  const s = String(text || '')
  if (!s || s.length < 80) return -1
  if (/^news stream\b/i.test(s)) return -1
  if (/\bask about da/i.test(s)) return -1
  if (isTradingEconomicsStatsParagraph(s)) return -1
  if (isTradingEconomicsForecastParagraph(s)) return -1
  // Product/about blurb, not daily summary
  if (
    /\bis one of the most widely followed\b/i.test(s) ||
    /\bspot exchange rate specifies\b/i.test(s) ||
    /\bprices displayed on Trading Economics\b/i.test(s)
  ) {
    return -1
  }

  let score = 0
  // Summary usually opens with price action + weekday
  if (
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(s)
  ) {
    score += 4
  }
  if (
    /\b(fell|rose|slipped|climbed|dropped|surged|plunged|rebounded|held|touched|traded)\b/i.test(
      s,
    )
  ) {
    score += 3
  }
  // Narrative drivers — why the market moved
  if (
    /\b(as|after|amid|because|while|despite|following|investors|markets|traders|federal reserve|fed|ecb|geopolit|conflict|talks|demand|supply|inflation|rate|dollar|etf)\b/i.test(
      s,
    )
  ) {
    score += 4
  }
  if (/\$\s*[\d,]+/.test(s) || /\b[\d,]+(?:\.\d+)?\s*(per barrel|an ounce)\b/i.test(s)) {
    score += 2
  }
  // Prefer first long analysis paragraphs
  if (s.length >= 200 && s.length <= 1200) score += 3
  if (s.length > 1600) score -= 2
  // Penalize residual stats phrases if any slipped through
  if (/\bfrom the previous (?:day|session)\b/i.test(s)) score -= 6
  if (/\blast updated on\b/i.test(s)) score -= 6
  if (/\bcontract for difference\b/i.test(s)) score -= 6
  return score
}

/**
 * Extract Summary-tab narrative from markdown.
 * TE links Summary → #historical; it is usually the first ## analysis paragraph.
 */
export function extractSummaryParagraphFromMarkdown(markdown) {
  const text = String(markdown || '')
  if (!text.trim()) return null

  const candidates = []

  // Prefer content before News Stream / related tables noise
  const cutMatch = text.search(
    /\n##?\s*News Stream\b|\nNews Stream\b|\n##?\s*Related\b|\n\|[\s\-:]+\|/i,
  )
  const head = cutMatch >= 0 ? text.slice(0, cutMatch) : text

  // 1) Markdown headings (## Summary body is often a full heading line on TE)
  const headingRe = /^#{1,3}\s+(.+)$/gm
  let m
  let headingIndex = 0
  while ((m = headingRe.exec(head)) !== null) {
    const para = normalizeParagraph(m[1])
    const score = scoreSummaryParagraph(para)
    // Prefer earlier headings (Summary appears before Stats/Forecast)
    const positionBoost = Math.max(0, 4 - headingIndex)
    if (score >= 6) {
      candidates.push({
        text: para,
        score: score + positionBoost,
        source: 'markdown_heading',
      })
    }
    headingIndex += 1
  }

  // 2) Plain blocks near the top
  let blockIndex = 0
  for (const block of head.split(/\n{2,}/)) {
    const para = normalizeParagraph(block)
    if (para.length < 80) {
      blockIndex += 1
      continue
    }
    const score = scoreSummaryParagraph(para)
    const positionBoost = blockIndex === 0 ? 3 : blockIndex === 1 ? 1 : 0
    if (score >= 6) {
      candidates.push({
        text: para,
        score: score + positionBoost,
        source: 'markdown_block',
      })
    }
    blockIndex += 1
  }

  // 3) Crypto pages often lack a Summary tab — use the latest News Stream story body
  const newsIdx = text.search(/\n##?\s*News Stream\b|\nNews Stream\b/i)
  if (newsIdx >= 0) {
    const newsSection = text.slice(newsIdx)
    // First news body after first markdown news link
    const newsMatch = newsSection.match(
      /(?:\*\*)?\[[^\]]+\]\((?:https?:\/\/tradingeconomics\.com)?\/[^)\s]+\)(?:\*\*)?\s*\n+([\s\S]{80,900}?)(?:\n\s*20\d{2}-\d{2}-\d{2}|\n\s*\*\*?\[)/i,
    )
    if (newsMatch) {
      const para = normalizeParagraph(newsMatch[1])
      const score = scoreSummaryParagraph(para)
      if (score >= 6) {
        candidates.push({
          text: para,
          score: score + 1,
          source: 'markdown_news_fallback',
        })
      }
    }
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length)
  return candidates[0]
}

/**
 * Extract Summary from HTML (#historical / summary panel).
 */
export function extractSummaryParagraphFromHtml(html) {
  const source = String(html || '')
  if (!source) return null
  const $ = loadHtml(source)
  const candidates = []

  const consider = (text, sourceLabel, boost = 0) => {
    const para = normalizeParagraph(text)
    const score = scoreSummaryParagraph(para)
    if (score >= 6) {
      candidates.push({ text: para, score: score + boost, source: sourceLabel })
    }
  }

  // Summary tab is anchored as #historical on TE commodity/forex pages
  $('#historical, [id="historical"], [id*="historical" i]').each((_, el) => {
    // Prefer direct paragraph children / nearby text, not entire page dump
    const $el = $(el)
    const direct = $el
      .find('p')
      .first()
      .text()
    if (direct && direct.length > 80) consider(direct, 'html_historical_p', 4)
    else consider($el.text(), 'html_historical', 2)
  })

  // Explicit summary-labelled regions
  $('[id*="summary" i], [class*="summary" i]').each((_, el) => {
    const $el = $(el)
    // Skip if this is clearly the stats panel
    const idClass = `${$el.attr('id') || ''} ${$el.attr('class') || ''}`
    if (/stats/i.test(idClass)) return
    const p = $el.find('p').first().text()
    if (p && p.length > 80) consider(p, 'html_summary_p', 3)
  })

  // Top-of-page analysis paragraphs
  $('p, h2, h3').each((idx, el) => {
    if (idx > 40) return
    const text = $(el).text()
    if (text.length < 100 || text.length > 1400) return
    if (isTradingEconomicsStatsParagraph(text)) return
    consider(text, 'html_node', idx < 5 ? 2 : 0)
  })

  if (!candidates.length) return null
  candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length)
  return candidates[0]
}

// Back-compat aliases (older call sites / tests)
export function extractStatsParagraphFromMarkdown(markdown) {
  return extractSummaryParagraphFromMarkdown(markdown)
}
export function extractStatsParagraphFromHtml(html) {
  return extractSummaryParagraphFromHtml(html)
}

/**
 * Parse Trading Economics page:
 *  - reason/summary text = Summary tab narrative ONLY
 *  - price + price_change (%) = Summary if present, else Stats metrics, else quote table
 *
 * Why % was missing before: Summary rarely includes "down 3.83%" — that lives on Stats.
 * We still refuse to use Stats as the reason body.
 */
export function parseTradingEconomicsMovements(
  markdown,
  { pageUrl = null, ticker = null, html = '' } = {},
) {
  const text = String(markdown || '')
  const now = new Date()

  const picked =
    extractSummaryParagraphFromHtml(html) ||
    extractSummaryParagraphFromMarkdown(text) ||
    null

  if (!picked?.text) {
    return {
      events: [],
      sectionFound: false,
      summary: null,
      reason: '',
    }
  }

  // Guard: never accept a Stats paragraph even if scoring slipped
  if (isTradingEconomicsStatsParagraph(picked.text)) {
    return {
      events: [],
      sectionFound: false,
      summary: null,
      reason: '',
    }
  }

  const reason = picked.text

  // 1) Try % / price inside Summary itself (sometimes present)
  let priceChange = extractDayChangeFromSummaryText(reason)
  let price = extractPriceFromSummaryText(reason)
  let metricsSource = priceChange || price ? 'summary' : null

  // 2) Stats section metrics (price + day %) — NOT used as reason text.
  // Prefer Stats % (and matching price) because Summary almost never has the day %.
  const statsMetrics = extractMetricsFromStatsSection(text, html)
  if (statsMetrics) {
    if (statsMetrics.price_change) {
      priceChange = statsMetrics.price_change
      metricsSource = 'stats'
      // Keep price aligned with the same Stats row when available
      if (statsMetrics.price) price = statsMetrics.price
    } else if (!price && statsMetrics.price) {
      price = statsMetrics.price
      if (!metricsSource) metricsSource = 'stats'
    }
  }

  // 3) Quote table / crypto header fallbacks
  if (!priceChange || !price) {
    const tableMetrics = extractMetricsFromQuoteTable(text, ticker)
    if (tableMetrics) {
      if (!priceChange && tableMetrics.price_change) {
        priceChange = tableMetrics.price_change
        metricsSource = metricsSource || 'quote_table'
      }
      if (!price && tableMetrics.price) {
        price = tableMetrics.price
        metricsSource = metricsSource || 'quote_table'
      }
    }
  }
  if (!priceChange || !price) {
    const cryptoHeader = extractMetricsFromCryptoHeader(text)
    if (cryptoHeader) {
      if (!priceChange && cryptoHeader.price_change) {
        priceChange = cryptoHeader.price_change
        metricsSource = metricsSource || 'crypto_header'
      }
      if (!price && cryptoHeader.price) {
        price = cryptoHeader.price
        metricsSource = metricsSource || 'crypto_header'
      }
    }
  }

  const direction = priceChange
    ? String(priceChange).startsWith('-')
      ? 'down'
      : String(priceChange).startsWith('+')
        ? 'up'
        : inferDirectionFromText(reason, priceChange)
    : inferDirectionFromText(reason, null)

  const eventDate =
    statsMetrics?.event_date ||
    extractLastUpdatedDate(reason, now) ||
    extractLastUpdatedDate(text, now) ||
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
      now.getUTCDate(),
    ).padStart(2, '0')}`

  const summaryMeta = {
    paragraph: reason,
    price,
    day_change: priceChange,
    source: picked.source,
    metrics_source: metricsSource,
    stats_metrics: statsMetrics
      ? {
          price: statsMetrics.price,
          price_change: statsMetrics.price_change,
          source: statsMetrics.source,
        }
      : null,
  }

  const event = {
    event_date: eventDate,
    display_date: formatDisplayDate(eventDate),
    time_label: null,
    price,
    price_change: priceChange,
    momentum: priceChange,
    direction,
    premarket_change: null,
    premarket_direction: null,
    // ONLY Summary-tab paragraph — single reason (Stats only fills price/%)
    summary: reason,
    reasons: [reason],
    stats: summaryMeta,
    sources: pageUrl
      ? [
          {
            title: ticker
              ? `${ticker} · Trading Economics Summary`
              : 'Trading Economics Summary',
            domain: 'tradingeconomics.com',
            url: pageUrl.includes('#') ? pageUrl : `${pageUrl}#historical`,
          },
        ]
      : [],
    source_count: pageUrl ? 1 : 0,
    claimed_source_count: pageUrl ? 1 : 0,
  }

  return {
    events: [event],
    sectionFound: true,
    summary: summaryMeta,
    stats: summaryMeta,
    reason,
  }
}

/**
 * Firecrawl scrape of a Trading Economics page → notable movement events.
 */
export async function scrapeTradingEconomicsNotableMovements(
  ticker,
  { companyName = '', days = 30 } = {},
) {
  const cleanTicker = cleanSymbol(ticker)
  if (!cleanTicker) throw new Error('Ticker is required')

  const target = resolveTradingEconomicsTarget(ticker, companyName)
  if (!target.url) {
    const error = new Error(
      `No Trading Economics URL mapping for ${cleanTicker} (${target.asset_class}). Add a mapping or use an equity ticker.`,
    )
    error.status = 400
    throw error
  }

  const logs = []
  const pushLog = (level, message, detail) => {
    logs.push({
      at: new Date().toISOString(),
      level,
      message,
      detail: detail ?? null,
    })
  }

  pushLog('info', `Starting Trading Economics Firecrawl scrape for ${cleanTicker}`, {
    url: target.url,
    asset_class: target.asset_class,
    path: target.path,
    company_name: companyName || null,
  })

  let creditsBefore = null
  try {
    creditsBefore = await getFirecrawlCreditUsage()
    pushLog('info', 'Firecrawl balance (before scrape)', {
      remaining_credits: creditsBefore.remaining_credits,
      plan_credits: creditsBefore.plan_credits,
      billing_period_end: creditsBefore.billing_period_end,
    })
  } catch (error) {
    pushLog('warn', 'Could not fetch Firecrawl balance before scrape', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const scrapeStarted = Date.now()
  const scrapeBody = await firecrawlFetch('/scrape', {
    method: 'POST',
    body: JSON.stringify({
      url: target.url,
      formats: ['markdown', 'html'],
      onlyMainContent: true,
      waitFor: 5000,
      timeout: 90000,
      maxAge: 0,
      actions: [{ type: 'wait', milliseconds: 2500 }],
    }),
  })
  const scrapeDurationMs = Date.now() - scrapeStarted

  const markdown = scrapeBody?.data?.markdown || ''
  const html = scrapeBody?.data?.html || ''
  pushLog('info', 'Firecrawl scrape completed (Trading Economics)', {
    duration_ms: scrapeDurationMs,
    markdown_chars: markdown.length,
    html_chars: html.length,
    status_code: scrapeBody?.data?.metadata?.statusCode ?? null,
    title: scrapeBody?.data?.metadata?.title ?? null,
    source: 'trading_economics',
  })

  let creditsAfter = null
  let creditsUsed = null
  try {
    creditsAfter = await getFirecrawlCreditUsage()
    if (
      creditsBefore?.remaining_credits != null &&
      creditsAfter?.remaining_credits != null
    ) {
      creditsUsed = Math.max(
        0,
        Number(creditsBefore.remaining_credits) -
          Number(creditsAfter.remaining_credits),
      )
    }
    pushLog('info', 'Firecrawl balance (after scrape)', {
      remaining_credits: creditsAfter.remaining_credits,
      plan_credits: creditsAfter.plan_credits,
      credits_used_this_scrape: creditsUsed,
      billing_period_end: creditsAfter.billing_period_end,
    })
  } catch (error) {
    pushLog('warn', 'Could not fetch Firecrawl balance after scrape', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const parsed = parseTradingEconomicsMovements(markdown, {
    pageUrl: target.url,
    ticker: cleanTicker,
    html,
  })

  pushLog(
    parsed.events.length ? 'success' : 'warn',
    parsed.sectionFound
      ? `Parsed Trading Economics Summary for ${cleanTicker} (price/% from ${parsed.summary?.metrics_source || 'n/a'})`
      : 'Summary tab narrative not found on Trading Economics page (Stats/Forecast ignored as reason)',
    {
      event_count: parsed.events.length,
      asset_class: target.asset_class,
      summary_source: parsed.summary?.source || null,
      metrics_source: parsed.summary?.metrics_source || null,
      price: parsed.summary?.price || null,
      day_change: parsed.summary?.day_change || null,
      reason_preview: String(parsed.reason || '').slice(0, 280),
    },
  )

  for (const event of parsed.events.slice(0, 5)) {
    pushLog(
      'info',
      `${event.event_date} · change ${event.price_change || 'n/a'} · Summary reason`,
      {
        event_date: event.event_date,
        price: event.price,
        price_change: event.price_change,
        direction: event.direction,
        reason: event.summary,
        sources: event.sources,
      },
    )
  }

  return {
    ticker: cleanTicker,
    url: target.url,
    scraped_at: new Date().toISOString(),
    events: parsed.events,
    section_found: parsed.sectionFound,
    asset_class: target.asset_class,
    scrape_source: 'trading_economics',
    source_provider: 'trading_economics',
    credits: {
      before: creditsBefore,
      after: creditsAfter,
      used: creditsUsed,
    },
    logs,
    markdown_preview: markdown.slice(0, 4000),
  }
}

export {
  firecrawlFetch as teFirecrawlFetch,
  getFirecrawlCreditUsage as teGetFirecrawlCreditUsage,
}
