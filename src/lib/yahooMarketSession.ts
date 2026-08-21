/**
 * Yahoo Finance extended-hours model (quote / quoteSummary.price).
 *
 * There are NO overnightMarket* fields. Overnight prints live in postMarket*
 * when marketState is PREPRE. Always pair marketState with the correct field
 * group — never invent sessions from the wall clock alone.
 *
 * @see Yahoo quote page labels (Pre-Market / Overnight / After Hours / At close)
 */

/** Official Yahoo marketState values we handle. */
export type YahooMarketState =
  /**
   * Pre-market before regular pre-market hours.
   * postMarket* fields are the overnight session
   * (e.g. Blue Ocean ATS ~8 PM–4 AM ET, Sun–Thu when regular markets are closed).
   */
  | 'PREPRE'
  /** Pre-market — use preMarket* */
  | 'PRE'
  /** Regular session open — use regularMarket* */
  | 'REGULAR'
  /** After-hours / post-market — use postMarket* */
  | 'POST'
  /** After after-hours ended; postMarket* still holds last AH print */
  | 'POSTPOST'
  /**
   * Fully closed for the symbol’s main session.
   * Primary display = regularMarket* (At close).
   * postMarket* may still hold residual after-hours / overnight print.
   */
  | 'CLOSED'

export type YahooSessionKey =
  | 'overnight'
  | 'premarket'
  | 'regular'
  | 'after-hours'
  | 'closed'
  | 'unknown'

/** Minimal quote shape used for session pricing (Yahoo live quote). */
export type YahooSessionQuoteFields = {
  marketState?: string | null
  regularMarketPrice?: number | null
  regularMarketChange?: number | null
  regularMarketChangePercent?: number | null
  regularMarketTime?: string | null
  preMarketPrice?: number | null
  preMarketChange?: number | null
  preMarketChangePercent?: number | null
  preMarketTime?: string | null
  postMarketPrice?: number | null
  postMarketChange?: number | null
  postMarketChangePercent?: number | null
  postMarketTime?: string | null
}

export function normalizeYahooMarketState(
  raw?: string | null,
): YahooMarketState | null {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
  if (s === 'PREPRE') return 'PREPRE'
  if (s === 'PRE') return 'PRE'
  if (s === 'REGULAR' || s === 'OPEN') return 'REGULAR'
  if (s === 'POST') return 'POST'
  if (s === 'POSTPOST') return 'POSTPOST'
  if (s === 'CLOSED' || s === 'CLOSE') return 'CLOSED'
  return null
}

/**
 * Which Yahoo price group is “live” for this marketState.
 * - pre → preMarket*
 * - post → postMarket* (after-hours OR overnight when PREPRE)
 * - regular → regularMarket*
 */
export function yahooPriceBucket(
  state: YahooMarketState | null,
): 'pre' | 'post' | 'regular' | null {
  if (!state) return null
  if (state === 'PRE') return 'pre'
  if (state === 'PREPRE' || state === 'POST' || state === 'POSTPOST') return 'post'
  if (state === 'REGULAR') return 'regular'
  // CLOSED: primary is last regular close
  if (state === 'CLOSED') return 'regular'
  return null
}

export function yahooSessionKey(state: YahooMarketState | null): YahooSessionKey {
  if (!state) return 'unknown'
  if (state === 'PREPRE') return 'overnight'
  if (state === 'PRE') return 'premarket'
  if (state === 'POST' || state === 'POSTPOST') return 'after-hours'
  if (state === 'REGULAR') return 'regular'
  if (state === 'CLOSED') return 'closed'
  return 'unknown'
}

/** UI short label matching Yahoo’s quote page wording. */
export function yahooSessionLabel(state: YahooMarketState | null): string | null {
  if (!state) return null
  if (state === 'PREPRE') return 'Overnight'
  if (state === 'PRE') return 'Pre-market'
  if (state === 'POST' || state === 'POSTPOST') return 'After-hours'
  if (state === 'REGULAR') return 'Open'
  if (state === 'CLOSED') return 'Closed'
  return null
}

/**
 * Display string for UI next to Yahoo Finance — real Yahoo marketState only.
 * Never invents a session from the wall clock.
 */
export function yahooMarketStateDisplay(raw?: string | null): {
  state: YahooMarketState | null
  /** Human label, or “Market state unavailable” when Yahoo did not return a known state */
  label: string
  available: boolean
} {
  const state = normalizeYahooMarketState(raw)
  if (!state) {
    return {
      state: null,
      label: 'Market state unavailable',
      available: false,
    }
  }
  const label =
    yahooSessionLabelLong(state) || yahooSessionLabel(state) || state
  return { state, label, available: true }
}

/** Longer label for pills / tooltips. */
export function yahooSessionLabelLong(state: YahooMarketState | null): string | null {
  if (!state) return null
  if (state === 'PREPRE') return 'Overnight'
  if (state === 'PRE') return 'Pre-market'
  if (state === 'POST') return 'After-hours'
  if (state === 'POSTPOST') return 'After-hours'
  if (state === 'REGULAR') return 'Regular session'
  if (state === 'CLOSED') return 'At close'
  return null
}

export type YahooActiveSessionQuote = {
  marketState: YahooMarketState
  sessionKey: YahooSessionKey
  label: string
  labelLong: string
  /** pre | post | regular field group in use */
  bucket: 'pre' | 'post' | 'regular'
  price: number | null
  change: number | null
  changePercent: number | null
  time: string | null
  /** True for PRE / PREPRE / POST / REGULAR (session actively trading or overnight print) */
  isExtendedOrLive: boolean
}

/**
 * Active price for the current Yahoo marketState.
 * PREPRE → postMarket* (overnight). POST/POSTPOST → postMarket* (AH).
 * PRE → preMarket*. REGULAR/CLOSED → regularMarket*.
 */
export function resolveYahooActiveSession(
  quote?: YahooSessionQuoteFields | null,
): YahooActiveSessionQuote | null {
  const marketState = normalizeYahooMarketState(quote?.marketState)
  if (!marketState || !quote) return null

  const sessionKey = yahooSessionKey(marketState)
  const label = yahooSessionLabel(marketState) || 'Market'
  const labelLong = yahooSessionLabelLong(marketState) || label
  const bucket = yahooPriceBucket(marketState) || 'regular'

  let price: number | null = null
  let change: number | null = null
  let changePercent: number | null = null
  let time: string | null = null

  if (bucket === 'pre') {
    price = num(quote.preMarketPrice)
    change = num(quote.preMarketChange)
    changePercent = num(quote.preMarketChangePercent)
    time = quote.preMarketTime ?? null
  } else if (bucket === 'post') {
    // After-hours AND overnight (PREPRE) — same postMarket* fields
    price = num(quote.postMarketPrice)
    change = num(quote.postMarketChange)
    changePercent = num(quote.postMarketChangePercent)
    time = quote.postMarketTime ?? null
  } else {
    price = num(quote.regularMarketPrice)
    change = num(quote.regularMarketChange)
    changePercent = num(quote.regularMarketChangePercent)
    time = quote.regularMarketTime ?? null
  }

  const isExtendedOrLive =
    marketState === 'PRE' ||
    marketState === 'PREPRE' ||
    marketState === 'POST' ||
    marketState === 'REGULAR'

  return {
    marketState,
    sessionKey,
    label,
    labelLong,
    bucket,
    price,
    change,
    changePercent,
    time,
    isExtendedOrLive,
  }
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
