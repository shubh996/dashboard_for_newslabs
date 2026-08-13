// Shapes returned by /api/yahoo/* — separate from SEC EDGAR types.

export type YahooModuleStatusCode = 'success' | 'empty' | 'error' | 'pending' | 'loading'

export interface YahooModuleStatus {
  status: YahooModuleStatusCode
  error?: string
  fetchedAt?: string
}

export interface YahooUnitCatalogueItem {
  id: string
  label: string
  group: string
  quoteSummary?: string[] | null
  rawQuoteSummary?: string[] | null
}

export interface YahooUnitProgress {
  unitId: string
  label: string
  group: string
  status: YahooModuleStatusCode
  error?: string
  moduleStatus?: Record<string, YahooModuleStatus>
  raw?: Record<string, unknown>
}

export interface YahooQuoteSummary {
  regularMarketPrice: number | null
  regularMarketChange: number | null
  regularMarketChangePercent: number | null
  regularMarketVolume: number | null
  regularMarketDayHigh: number | null
  regularMarketDayLow: number | null
  regularMarketOpen: number | null
  regularMarketPreviousClose: number | null
  marketCap: number | null
  fiftyTwoWeekLow: number | null
  fiftyTwoWeekHigh: number | null
  averageDailyVolume3Month: number | null
  bid: number | null
  ask: number | null
  trailingPE: number | null
  forwardPE: number | null
  dividendYield: number | null
}

export interface YahooCompanyOfficer {
  name?: string
  title?: string
  age?: number
  yearBorn?: number
  totalPay?: { raw?: number; fmt?: string } | number
  exercisedValue?: { raw?: number; fmt?: string } | number
  unexercisedValue?: { raw?: number; fmt?: string } | number
  [key: string]: unknown
}

export interface YahooFundData {
  profile: Record<string, unknown> | null
  topHoldings: Record<string, unknown> | null
  performance: Record<string, unknown> | null
  category: string | null
  family: string | null
  legalType: string | null
  totalAssets: number | null
  yield: number | null
  ytdReturn: number | null
  threeYearAverageReturn: number | null
  fiveYearAverageReturn: number | null
  beta3Year: number | null
  navPrice: number | null
  fundInceptionDate: string | null
}

export interface YahooStructuredData {
  symbol: string
  companyName: string | null
  exchange: string | null
  currency: string | null
  /** Yahoo quoteType e.g. EQUITY | ETF | MUTUALFUND */
  quoteType?: string | null
  quoteTypeDetail?: Record<string, unknown> | null
  isEtf?: boolean
  isFund?: boolean
  quote: YahooQuoteSummary
  profile: {
    sector: string | null
    industry: string | null
    website: string | null
    longBusinessSummary: string | null
    fullTimeEmployees: number | null
    city: string | null
    state: string | null
    country: string | null
    phone: string | null
    address1: string | null
    zip: string | null
    companyOfficers: YahooCompanyOfficer[]
  }
  fund?: YahooFundData
  valuation: Record<string, number | null>
  profitability: Record<string, number | null>
  financialData: Record<string, unknown>
  defaultKeyStatistics: Record<string, unknown>
  summaryDetail: Record<string, unknown>
  calendarEvents: unknown
  earnings: unknown
  earningsHistory: unknown
  earningsTrend: unknown
  recommendationTrend: unknown
  upgradeDowngradeHistory: unknown
  priceTargets: {
    targetLow: number | null
    targetMean: number | null
    targetMedian: number | null
    targetHigh: number | null
    numberOfAnalystOpinions: number | null
    recommendationKey: string | null
    recommendationMean: number | null
  }
  ownership: Record<string, unknown>
  insider: Record<string, unknown>
  statements: Record<string, unknown>
  chart: unknown
  options: unknown
  insights: unknown
  recommendationsBySymbol: unknown
  search: unknown
  secFilings: unknown
  trends: Record<string, unknown>
  [key: string]: unknown
}

export interface YahooTickerBundle {
  ticker: string
  symbol: string
  source: 'yahoo-finance'
  fetchedAt: string
  data: YahooStructuredData
  raw_json: Record<string, unknown>
  module_status: Record<string, YahooModuleStatus>
  units: YahooUnitProgress[]
}

export interface YahooSavedSnapshot {
  ticker: string
  data: YahooStructuredData
  rawJson: Record<string, unknown>
  moduleStatus: Record<string, YahooModuleStatus>
  sourceMetadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  sourceTable: 'yahoo_finance_snapshots'
  source: 'yahoo-finance'
}

export interface YahooSearchResult {
  ticker: string
  label: string
  companyName: string | null
  shortName?: string | null
  longName?: string | null
  savedAt: string | null
  exchange?: string | null
  quoteType?: string | null
  sector?: string | null
  industry?: string | null
  score?: number | null
  isYahooFinance?: boolean
  source: 'yahoo-finance'
}

export interface YahooSearchResults {
  source: 'yahoo-finance'
  tickers: YahooSearchResult[]
}
