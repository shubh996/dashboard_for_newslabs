// Shared Yahoo Finance quoteSummary client -- extracted so both the general
// market dashboard (server/index.js) and the ticker-research tool
// (server/edgar/analyst.js) hit Yahoo's undocumented endpoints through one
// session/crumb cache instead of duplicating auth logic in two places.

let yahooSession = null

export async function getYahooSession(forceRefresh = false) {
  if (yahooSession && !forceRefresh) return yahooSession

  const cookieResponse = await fetch('https://fc.yahoo.com', {
    headers: { 'user-agent': 'Mozilla/5.0' },
    redirect: 'manual',
  })
  const setCookie = cookieResponse.headers.get('set-cookie') || ''
  const cookie = setCookie.split(';')[0]

  const crumbResponse = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'user-agent': 'Mozilla/5.0', cookie },
  })
  const crumb = (await crumbResponse.text()).trim()

  yahooSession = { cookie, crumb }
  return yahooSession
}

export async function fetchYahooQuoteSummary(symbol, modules) {
  let session = await getYahooSession()

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const url = new URL(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`)
    url.searchParams.set('modules', modules.join(','))
    url.searchParams.set('crumb', session.crumb)

    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json', cookie: session.cookie },
    })
    const body = await response.json().catch(() => ({}))

    if (body?.finance?.error?.code === 'Unauthorized' && attempt === 0) {
      session = await getYahooSession(true)
      continue
    }
    if (body?.finance?.error) throw new Error(body.finance.error.description || 'Yahoo Finance request failed')

    return body?.quoteSummary?.result?.[0] || {}
  }

  throw new Error('Yahoo Finance request failed')
}

// Yahoo wraps most numeric fields as `{ raw, fmt, longFmt }` -- this pulls the
// raw number back out (or passes a bare number through), returning null for
// anything missing/non-finite so callers never fabricate a fallback value.
export function yahooRaw(value) {
  if (value == null) return null
  const raw = typeof value === 'object' ? value.raw : value
  return Number.isFinite(raw) ? raw : null
}

// Map common index aliases / exchange-prefixed symbols to Yahoo chart symbols.
// e.g. GSPC -> ^GSPC, NASDAQ:AAPL -> AAPL, BRK.B -> BRK-B
const YAHOO_SYMBOL_ALIASES = {
  DJI: '^DJI',
  GSPC: '^GSPC',
  IXIC: '^IXIC',
  NDX: '^NDX',
  NYA: '^NYA',
  RUT: '^RUT',
  SPX: '^GSPC',
  COMP: '^IXIC',
}

/**
 * Yahoo keeps a *dot* for listed exchange suffixes (DXL2.MU, SAP.DE, VOD.L).
 * Blindly turning every "." into "-" produces fake crypto pairs like DXL2-MU
 * which Yahoo rejects as "symbol may be delisted".
 *
 * US share-classes still use a hyphen: BRK.B → BRK-B, BF.B → BF-B.
 */
const YAHOO_EXCHANGE_SUFFIXES = new Set([
  'L',
  'DE',
  'F',
  'MU',
  'PA',
  'AS',
  'SW',
  'T',
  'HK',
  'TO',
  'V',
  'AX',
  'SI',
  'MI',
  'MC',
  'ST',
  'CO',
  'OL',
  'VI',
  'BR',
  'LS',
  'IR',
  'HE',
  'MX',
  'KS',
  'KQ',
  'NS',
  'BO',
  'SA',
  'TW',
  'SS',
  'SZ',
  'NZ',
  'JK',
  'KL',
  'TA',
  'AT',
  'IS',
  'QA',
  'SR',
  'CA',
  'JO',
  'VN',
  'BK',
  'BE',
  'HM',
  'DU',
  'HA',
  'SG',
  'NY',
  'IL',
])

/** TradingView / broker prefixes — only these lose the left side. */
const EXCHANGE_PREFIXES = new Set([
  'NASDAQ',
  'NYSE',
  'AMEX',
  'ARCA',
  'BATS',
  'OTC',
  'PINK',
  'TVC',
  'BINANCE',
  'COINBASE',
  'BITSTAMP',
  'XETRA',
  'FWB',
  'SWX',
  'LSE',
  'TSE',
  'TSX',
  'ASX',
  'HKEX',
])

/** Trading Economics / app metal pairs → Yahoo futures. */
const YAHOO_METAL_PAIRS = {
  XAGUSD: 'SI=F',
  XAUUSD: 'GC=F',
  XPTUSD: 'PL=F',
  XPDUSD: 'PA=F',
}

export function toYahooSymbol(ticker) {
  let clean = String(ticker || '').trim()
  if (!clean) return ''
  if (clean.includes('://')) return ''

  // NASDAQ:AAPL → AAPL
  // XAGUSD:CUR (Trading Economics silver) is NOT an exchange prefix — do not
  // take ":CUR" and poll Yahoo for the garbage symbol "CUR".
  if (clean.includes(':')) {
    const [leftRaw, rightRaw] = clean.split(':')
    const left = String(leftRaw || '').toUpperCase()
    const right = String(rightRaw || '').toUpperCase()
    if (right === 'CUR' || right === 'FOREX' || right === 'CURNCY') {
      clean = left
    } else if (EXCHANGE_PREFIXES.has(left)) {
      clean = right || left
    } else {
      clean = left
    }
  }
  clean = clean.toUpperCase().replace(/\s+/g, '')

  if (clean.startsWith('^')) return YAHOO_SYMBOL_ALIASES[clean.slice(1)] || clean
  if (YAHOO_SYMBOL_ALIASES[clean]) return YAHOO_SYMBOL_ALIASES[clean]
  if (YAHOO_METAL_PAIRS[clean]) return YAHOO_METAL_PAIRS[clean]
  // Leftover from old ":CUR" split (XAGUSD:CUR → CUR)
  if (clean === 'CUR') return 'SI=F'

  // Bare ISO FX pair (EURUSD) → EURUSD=X — not 6-letter names like NVIDIA
  if (/^[A-Z]{6}$/.test(clean) && !clean.includes('=')) {
    const fx = new Set([
      'USD',
      'EUR',
      'GBP',
      'JPY',
      'AUD',
      'CAD',
      'CHF',
      'NZD',
      'CNY',
      'HKD',
      'INR',
      'KRW',
      'SGD',
      'MXN',
      'BRL',
      'ZAR',
      'SEK',
      'NOK',
      'DKK',
      'TRY',
      'RUB',
      'PLN',
    ])
    const a = clean.slice(0, 3)
    const b = clean.slice(3)
    if (fx.has(a) && fx.has(b)) return `${clean}=X`
  }

  // Futures / FX already in Yahoo form (GC=F, EURUSD=X)
  if (clean.includes('=')) return clean

  const dotted = clean.match(/^([A-Z0-9]+)\.([A-Z]{1,3})$/)
  if (dotted) {
    if (YAHOO_EXCHANGE_SUFFIXES.has(dotted[2])) {
      return `${dotted[1]}.${dotted[2]}`
    }
    // US share class: BRK.B → BRK-B
    return `${dotted[1]}-${dotted[2]}`
  }

  // Previously over-normalized exchange suffix (DXL2-MU → DXL2.MU)
  const dashed = clean.match(/^([A-Z0-9]+)-([A-Z]{1,3})$/)
  if (dashed && YAHOO_EXCHANGE_SUFFIXES.has(dashed[2])) {
    return `${dashed[1]}.${dashed[2]}`
  }

  return clean
}
