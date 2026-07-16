// Shapes returned by the /api/edgar/* backend routes (server/edgar/*.js).
// Ported from edgar-ticker-explorer's report_builder.py / institutional_holdings.py /
// congress_trading.py data shapes, adapted to plain JSON for the browser.

export interface EdgarFiling {
  form: string
  filingDate: string
  reportDate: string | null
  accessionNumber: string
  primaryDocument: string | null
  primaryDocDescription: string | null
  filingUrl: string
  isXBRL: boolean
  isInlineXBRL: boolean
}

export interface CompanyAddress {
  street1: string | null
  street2: string | null
  city: string | null
  stateOrCountry: string | null
  zipCode: string | null
}

export interface CompanyProfile {
  ticker: string
  cik: string
  name: string
  sic: string | null
  sicDescription: string | null
  fiscalYearEnd: string | null
  filerCategory: string | null
  entityType: string | null
  stateOfIncorporation: string | null
  exchanges: string[]
  tickers: string[]
  ein: string | null
  website: string | null
  investorWebsite: string | null
  phone: string | null
  businessAddress: CompanyAddress | null
  mailingAddress: CompanyAddress | null
  sharesOutstanding: number | null
  publicFloat: number | null
  isLargeAcceleratedFiler: boolean
  isEmergingGrowthCompany: boolean
  formerNames: { name: string; from: string | null; to: string | null }[]
}

export interface FinancialStatementRow {
  label: string
  concept: string
  unit: string
  values: Record<string, number | null> // keyed by period end date (or "FY2024" style key)
}

export interface FinancialStatement {
  periods: string[] // ordered column labels, most recent first
  rows: FinancialStatementRow[]
}

export interface FinancialsData {
  incomeStatement: FinancialStatement | null
  balanceSheet: FinancialStatement | null
  cashFlowStatement: FinancialStatement | null
}

export interface LatestReportSnapshot {
  label: '10-K' | '10-Q'
  found: boolean
  periodOfReport: string | null
  filingDate: string | null
  accessionNumber: string | null
  filingUrl: string | null
  businessDescription: string | null
  riskFactors: string | null
}

export interface InsiderTransaction {
  formType: '3' | '4' | '5'
  filingDate: string
  insiderName: string | null
  insiderTitle: string | null
  isDirector: boolean
  isOfficer: boolean
  isTenPercentOwner: boolean
  transactionDate: string | null
  transactionCode: string | null
  transactionCodeLabel: string | null
  isDerivative: boolean
  securityTitle: string | null
  shares: number | null
  pricePerShare: number | null
  value: number | null
  acquiredDisposedCode: 'A' | 'D' | null
  sharesOwnedAfter: number | null
  sourceUrl: string
}

export interface InstitutionalHolder {
  managerName: string
  cik: number | null
  shares: number | null
  valueUsd: number | null
  filingDate: string | null
  filingUrl: string | null
}

export interface InstitutionalHoldingsData {
  kind: 'hedge-fund' | 'investment-fund'
  holders: InstitutionalHolder[]
  managersChecked: number
  managersFailed: number
}

export interface ManagerPosition {
  issuer: string
  ticker: string
  cusip: string
  shares: number | null
  valueUsd: number
  weight: number
}

export interface ManagerPortfolio {
  managerName: string
  cik: number
  filingDate: string | null
  filingUrl: string | null
  totalValue: number
  positions: ManagerPosition[]
  error?: string
}

export interface ProxyStatementData {
  found: boolean
  filingDate: string | null
  accessionNumber: string | null
  filingUrl: string | null
  peoName: string | null
  peoTotalComp: number | null
  peoActuallyPaidComp: number | null
  summaryCompensationTable: Record<string, string | number | null>[]
  directorCompensationTable: Record<string, string | number | null>[]
  beneficialOwnership: Record<string, string | number | null>[]
  insiderTradingPolicyAdopted: boolean | null
}

export interface CongressTrade {
  id: string
  ticker: string
  assetName: string | null
  transactionDate: string | null
  filingDate: string | null
  notificationDate: string | null
  transactionType: string | null
  amountRangeLow: number | null
  amountRangeHigh: number | null
  amountRangeLabel: string | null
  daysToFile: number | null
  retSince: number | null
  excessSince: number | null
  filerId: string | null
  filerName: string | null
  party: string | null
  chamber: string | null
  state: string | null
  docUrl: string | null
}

export interface CongressTradingData {
  ticker: string
  trades: CongressTrade[]
  latestPrice: { close: number; date: string } | null
}

export interface PoliticianHolding {
  ticker: string
  assetName: string | null
  cost: number
  value: number
  gain: number
  gainPct: number
  weight: number
  count: number
  firstDate: string | null
}

export interface PoliticianPortfolio {
  scoredBuys: number
  cost: number
  value: number
  spyValue: number
  gain: number
  gainPct: number
  vsSpy: number
  holdings: PoliticianHolding[]
}

export interface PoliticianProfile {
  id: string
  fullName: string
  branch: string | null
  chamber: string | null
  party: string | null
  state: string | null
  office: string | null
  agency: string | null
  photoUrl: string | null
}

export interface PoliticianPageData {
  filer: PoliticianProfile
  trades: CongressTrade[]
  portfolio: PoliticianPortfolio | null
}

// Full A-to-Z bundle assembled client-side from whichever sections loaded
// successfully -- this is what "Save to Supabase" persists.
export interface TickerDashboardBundle {
  ticker: string
  fetchedAt: string
  profile?: CompanyProfile
  financials?: FinancialsData
  quarterlyFinancials?: FinancialsData
  latestReports?: LatestReportSnapshot[]
  filings?: EdgarFiling[]
  insiderTransactions?: InsiderTransaction[]
  hedgeFundHoldings?: InstitutionalHoldingsData
  investmentFundHoldings?: InstitutionalHoldingsData
  proxyStatement?: ProxyStatementData
  congressTrading?: CongressTradingData
  analyst?: AnalystData
}

// Analyst consensus, price targets, and firm-by-firm ratings (Yahoo Finance,
// not SEC EDGAR — analyst ratings aren't a public filing). Any field can be
// null if Yahoo doesn't report it for this ticker; the UI hides those
// fields/columns rather than showing a fabricated value.
export interface AnalystConsensus {
  currentPrice: number | null
  recommendationKey: string | null
  recommendationMean: number | null
  numberOfAnalystOpinions: number | null
  targetLow: number | null
  targetMean: number | null
  targetMedian: number | null
  targetHigh: number | null
  upsideToLow: number | null
  upsideToMean: number | null
  upsideToHigh: number | null
  fiftyTwoWeekLow: number | null
  fiftyTwoWeekHigh: number | null
}

export interface AnalystSentiment {
  period: string
  bullish: number
  neutral: number
  bearish: number
  total: number
  bullishPercent: number | null
  neutralPercent: number | null
  bearishPercent: number | null
}

export interface AnalystTrendPoint {
  period: string
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
}

export interface AnalystRating {
  firm: string | null
  fromGrade: string | null
  toGrade: string | null
  action: string | null
  actionLabel: string | null
  priceTarget: number | null
  priorPriceTarget: number | null
  upsidePercent: number | null
  date: string | null
}

export interface AnalystData {
  symbol: string
  consensus: AnalystConsensus
  sentiment: AnalystSentiment | null
  trend: AnalystTrendPoint[]
  ratings: AnalystRating[]
}

// Server response for GET .../saved (a previously persisted snapshot).
export interface SavedSnapshot<T> {
  ticker?: string
  cik?: number
  filerId?: string
  managerName?: string
  data: T
  sourceMetadata: Record<string, unknown>
  createdAt: string
  sourceTable: string
}

export interface SearchResultItem {
  ticker?: string
  cik?: number
  label: string
  savedAt: string | null
  companyName?: string | null
}

export interface PoliticianSearchResult {
  filerId: string
  fullName: string
  savedAt: string | null
}

export interface SearchResults {
  tickers: SearchResultItem[]
  institutions: SearchResultItem[]
  etfs: SearchResultItem[]
  politicians: PoliticianSearchResult[]
}

export interface ManagerListItem {
  name: string
  cik: number
}

export interface ManagerList {
  hedgeFunds: ManagerListItem[]
  investmentFunds: ManagerListItem[]
}

export interface ManagerRefreshResult {
  name: string
  cik: number
  ok: boolean
  error?: string
}

export interface ManagerRefreshSummary {
  category: 'hedge-fund' | 'investment-fund'
  total: number
  succeeded: number
  failed: number
  results: ManagerRefreshResult[]
}
