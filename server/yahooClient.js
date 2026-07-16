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

export function toYahooSymbol(ticker) {
  let clean = String(ticker || '').trim()
  if (!clean) return ''
  // Strip TradingView-style exchange prefixes (NASDAQ:AAPL, TVC:SPX)
  if (clean.includes(':')) {
    clean = clean.split(':').pop() || clean
  }
  clean = clean.toUpperCase().replace(/\./g, '-')
  // Already a Yahoo index caret symbol
  if (clean.startsWith('^')) return clean
  return YAHOO_SYMBOL_ALIASES[clean] || clean
}
