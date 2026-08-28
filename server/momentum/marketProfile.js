/**
 * Symbol-level market profiles (spec §15 / §19).
 * Asset class is UI grouping only — session policy is per Yahoo symbol.
 */
import { tickerFollowsUsEquityTriggerWindow } from './usEquitySession.js'

export const SESSION_POLICY = {
  US_EQUITY_YAHOO_24X5: 'US_EQUITY_YAHOO_24X5',
  FX_SPOT_24X5: 'FX_SPOT_24X5',
  CRYPTO_24X7: 'CRYPTO_24X7',
  CME_FUTURE_23X5: 'CME_FUTURE_23X5',
  CME_INDEX_FUTURE_23X5: 'CME_INDEX_FUTURE_23X5',
  US_CASH_INDEX_RTH: 'US_CASH_INDEX_RTH',
}

const DEFAULTS = {
  [SESSION_POLICY.US_EQUITY_YAHOO_24X5]: {
    assetClass: 'STOCK',
    instrumentType: 'EQUITY',
    venue: 'NASDAQ',
    canonicalTimeZone: 'America/New_York',
    holidayCalendarId: 'NASDAQ',
    freshnessGraceSec: 240,
    pollGraceMultiplier: 2,
    // Poll window is 24×5; evaluate only when Yahoo marketState is REGULAR.
    supportsExtendedHours: true,
  },
  [SESSION_POLICY.FX_SPOT_24X5]: {
    assetClass: 'FOREX',
    instrumentType: 'FX_SPOT',
    venue: 'CBOE_FX',
    canonicalTimeZone: 'America/New_York',
    freshnessGraceSec: 180,
    pollGraceMultiplier: 2,
    supportsExtendedHours: false,
  },
  [SESSION_POLICY.CRYPTO_24X7]: {
    assetClass: 'CRYPTO',
    instrumentType: 'CRYPTO_SPOT',
    venue: 'SPOT',
    canonicalTimeZone: 'UTC',
    freshnessGraceSec: 180,
    pollGraceMultiplier: 2,
    supportsExtendedHours: false,
  },
  [SESSION_POLICY.CME_FUTURE_23X5]: {
    assetClass: 'COMMODITY',
    instrumentType: 'FUTURE',
    venue: 'CME',
    canonicalTimeZone: 'America/New_York',
    // Yahoo futures quotes often update every ~5–15m — 3m grace always looks “Delayed”.
    freshnessGraceSec: 900,
    pollGraceMultiplier: 2,
    supportsExtendedHours: false,
  },
  [SESSION_POLICY.CME_INDEX_FUTURE_23X5]: {
    assetClass: 'INDEX',
    instrumentType: 'INDEX_FUTURE',
    venue: 'CME',
    canonicalTimeZone: 'America/New_York',
    freshnessGraceSec: 900,
    pollGraceMultiplier: 2,
    supportsExtendedHours: false,
  },
  [SESSION_POLICY.US_CASH_INDEX_RTH]: {
    assetClass: 'INDEX',
    instrumentType: 'CASH_INDEX',
    venue: 'S&P',
    canonicalTimeZone: 'America/New_York',
    holidayCalendarId: 'NASDAQ',
    freshnessGraceSec: 240,
    pollGraceMultiplier: 2,
    supportsExtendedHours: false,
  },
}

const INDEX_FUTURES = new Set(['ES=F', 'NQ=F', 'YM=F', 'RTY=F', 'MES=F', 'MNQ=F'])
const CASH_INDICES = new Set([
  '^GSPC',
  '^DJI',
  '^IXIC',
  '^RUT',
  '^NYA',
  '^VIX',
])
const CME_COMMODITIES = new Set([
  'GC=F',
  'SI=F',
  'CL=F',
  'NG=F',
  'HG=F',
  'PL=F',
  'PA=F',
  'BZ=F',
  'ZC=F',
  'ZW=F',
  'ZS=F',
  'KE=F',
  'HO=F',
  'RB=F',
])

/** Explicit overrides — never infer from display name alone. */
const SYMBOL_OVERRIDES = {
  SPY: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  QQQ: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  AAPL: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  'EURUSD=X': SESSION_POLICY.FX_SPOT_24X5,
  'GBPUSD=X': SESSION_POLICY.FX_SPOT_24X5,
  'USDJPY=X': SESSION_POLICY.FX_SPOT_24X5,
  'BTC-USD': SESSION_POLICY.CRYPTO_24X7,
  'ETH-USD': SESSION_POLICY.CRYPTO_24X7,
  'SOL-USD': SESSION_POLICY.CRYPTO_24X7,
}

function inferPolicyId(symbol) {
  const t = String(symbol || '').trim().toUpperCase()
  if (!t) return null
  if (SYMBOL_OVERRIDES[t]) return SYMBOL_OVERRIDES[t]
  if (CASH_INDICES.has(t) || (t.startsWith('^') && !t.endsWith('=F'))) {
    return SESSION_POLICY.US_CASH_INDEX_RTH
  }
  if (INDEX_FUTURES.has(t)) return SESSION_POLICY.CME_INDEX_FUTURE_23X5
  if (t.endsWith('=F')) {
    if (CME_COMMODITIES.has(t)) return SESSION_POLICY.CME_FUTURE_23X5
    return SESSION_POLICY.CME_FUTURE_23X5
  }
  if (
    t.endsWith('-USD') ||
    t.endsWith('-USDT') ||
    t.endsWith('-EUR') ||
    t === 'BTC' ||
    t === 'ETH'
  ) {
    return SESSION_POLICY.CRYPTO_24X7
  }
  if (t.endsWith('=X') || /^[A-Z]{6}$/.test(t)) return SESSION_POLICY.FX_SPOT_24X5
  if (tickerFollowsUsEquityTriggerWindow(t)) {
    return SESSION_POLICY.US_EQUITY_YAHOO_24X5
  }
  return SESSION_POLICY.US_EQUITY_YAHOO_24X5
}

/**
 * @param {string|null|undefined} symbol
 * @returns {import('./sessionCalendar.js').SymbolMarketProfile|null}
 */
export function resolveMarketProfile(symbol) {
  const t = String(symbol || '').trim().toUpperCase()
  if (!t) return null
  const sessionPolicyId = inferPolicyId(t)
  const base = DEFAULTS[sessionPolicyId]
  if (!base) return null
  return {
    symbol: t,
    sessionPolicyId,
    ...base,
  }
}

export function registerSymbolPolicy(symbol, sessionPolicyId) {
  const t = String(symbol || '').trim().toUpperCase()
  if (!t || !DEFAULTS[sessionPolicyId]) return false
  SYMBOL_OVERRIDES[t] = sessionPolicyId
  return true
}

/**
 * Market-sessions popup probes (Yahoo quote.marketState per symbol).
 * Informational only — does not start/stop the engine.
 * Keep ids stable; UI groups by `region`.
 */
export const HEADLINE_PROBES = [
  {
    id: 'us-stocks',
    label: 'US Stocks',
    symbol: 'SPY',
    region: 'Americas',
    exchange: 'NYSE Arca',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
    child: {
      id: 'us-nasdaq',
      label: 'Nasdaq',
      symbol: 'QQQ',
      region: 'Americas',
      exchange: 'Nasdaq',
      policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
    },
  },
  {
    id: 'canada',
    label: 'Canada',
    symbol: 'SHOP.TO',
    region: 'Americas',
    exchange: 'Toronto',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'brazil',
    label: 'Brazil',
    symbol: 'VALE3.SA',
    region: 'Americas',
    exchange: 'São Paulo',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'uk-stocks',
    label: 'UK Stocks',
    symbol: 'VOD.L',
    region: 'Europe',
    exchange: 'LSE',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
    child: {
      id: 'uk-ftse',
      label: 'FTSE 100',
      symbol: '^FTSE',
      region: 'Europe',
      exchange: 'FTSE',
      policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
    },
  },
  {
    id: 'germany',
    label: 'Germany',
    symbol: 'SAP.DE',
    region: 'Europe',
    exchange: 'XETRA',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'france',
    label: 'France',
    symbol: 'MC.PA',
    region: 'Europe',
    exchange: 'Euronext Paris',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'switzerland',
    label: 'Switzerland',
    symbol: 'NESN.SW',
    region: 'Europe',
    exchange: 'SIX',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'india-nse',
    label: 'India NSE',
    symbol: 'RELIANCE.NS',
    region: 'Asia',
    exchange: 'NSE',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
    child: {
      id: 'india-bse',
      label: 'BSE',
      symbol: 'RELIANCE.BO',
      region: 'Asia',
      exchange: 'BSE',
      policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
    },
  },
  {
    id: 'japan',
    label: 'Japan',
    symbol: '7203.T',
    region: 'Asia',
    exchange: 'Tokyo',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'china',
    label: 'China',
    symbol: '600519.SS',
    region: 'Asia',
    exchange: 'Shanghai',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'hong-kong',
    label: 'Hong Kong',
    symbol: '0700.HK',
    region: 'Asia',
    exchange: 'HKSE',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'korea',
    label: 'South Korea',
    symbol: '005930.KS',
    region: 'Asia',
    exchange: 'KRX',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'singapore',
    label: 'Singapore',
    symbol: 'D05.SI',
    region: 'Asia',
    exchange: 'SGX',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'australia',
    label: 'Australia',
    symbol: 'BHP.AX',
    region: 'Asia-Pacific',
    exchange: 'ASX',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'dubai',
    label: 'Dubai',
    symbol: 'EMAAR.AE',
    region: 'Middle East',
    exchange: 'DFM',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'south-africa',
    label: 'South Africa',
    symbol: 'NPN.JO',
    region: 'Africa',
    exchange: 'JSE',
    policyId: SESSION_POLICY.US_EQUITY_YAHOO_24X5,
  },
  {
    id: 'forex',
    label: 'Forex',
    symbol: 'EURUSD=X',
    region: 'Global',
    exchange: 'FX',
    policyId: SESSION_POLICY.FX_SPOT_24X5,
  },
  {
    id: 'crypto',
    label: 'Crypto',
    symbol: 'BTC-USD',
    region: 'Global',
    exchange: 'Crypto',
    policyId: SESSION_POLICY.CRYPTO_24X7,
  },
  {
    id: 'commodities',
    label: 'Commodities',
    symbol: 'GC=F',
    region: 'Global',
    exchange: 'COMEX',
    policyId: SESSION_POLICY.CME_FUTURE_23X5,
  },
  {
    id: 'indices',
    label: 'US Index futures',
    symbol: 'ES=F',
    region: 'Global',
    exchange: 'CME',
    policyId: SESSION_POLICY.CME_INDEX_FUTURE_23X5,
    child: {
      id: 'cash-index',
      label: 'S&P 500 cash',
      symbol: '^GSPC',
      region: 'Americas',
      exchange: 'S&P',
      policyId: SESSION_POLICY.US_CASH_INDEX_RTH,
    },
  },
]
