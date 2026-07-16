import type {
  AnalystData,
  CompanyProfile,
  CongressTradingData,
  EdgarFiling,
  FinancialsData,
  InsiderTransaction,
  InstitutionalHoldingsData,
  LatestReportSnapshot,
  ManagerList,
  ManagerPortfolio,
  ManagerRefreshSummary,
  PoliticianPageData,
  ProxyStatementData,
  SavedSnapshot,
  SearchResults,
  TickerDashboardBundle,
} from '@/types/edgar'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error || `Request failed: ${url}`)
  }
  return body as T
}

// "Not saved yet" is a normal state, not an error -- treat 404 as null
// instead of throwing, so callers can just check truthiness.
async function getJsonOrNull<T>(url: string): Promise<T | null> {
  const response = await fetch(url)
  if (response.status === 404) return null
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error || `Request failed: ${url}`)
  }
  return body as T
}

// Live-fetch routes wrap their payload as `{ data, steps }` -- `steps` is the
// exact backend sequence (every SEC request, every parsing decision) for that
// call, shown next to the raw JSON instead of leaving it a black box.
export interface WithSteps<T> {
  data: T
  steps: string[]
}

async function getJsonWithSteps<T>(url: string): Promise<WithSteps<T>> {
  const response = await fetch(url)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed: ${url}`) as Error & { steps?: string[] }
    error.steps = Array.isArray(body?.steps) ? body.steps : []
    throw error
  }
  return { data: body.data as T, steps: Array.isArray(body.steps) ? body.steps : [] }
}

export function getCompanyProfile(ticker: string) {
  return getJsonWithSteps<CompanyProfile>(`/api/edgar/${encodeURIComponent(ticker)}/profile`)
}

export function getFinancials(ticker: string, period: 'annual' | 'quarterly') {
  return getJsonWithSteps<FinancialsData>(`/api/edgar/${encodeURIComponent(ticker)}/financials?period=${period}`)
}

export function getLatestReports(ticker: string) {
  return getJsonWithSteps<LatestReportSnapshot[]>(`/api/edgar/${encodeURIComponent(ticker)}/latest-reports`)
}

export function getRecentFilings(ticker: string) {
  return getJsonWithSteps<EdgarFiling[]>(`/api/edgar/${encodeURIComponent(ticker)}/filings`)
}

export function getInsiderTransactions(ticker: string) {
  return getJsonWithSteps<InsiderTransaction[]>(`/api/edgar/${encodeURIComponent(ticker)}/insider-transactions`)
}

export function getInstitutionalHoldings(ticker: string, kind: 'hedge-fund' | 'investment-fund') {
  return getJsonWithSteps<InstitutionalHoldingsData>(`/api/edgar/${encodeURIComponent(ticker)}/institutional-holdings?kind=${kind}`)
}

export function getManagerPortfolio(cik: string, force = false) {
  return getJsonWithSteps<ManagerPortfolio>(`/api/edgar/manager/${encodeURIComponent(cik)}${force ? '?force=true' : ''}`)
}

export function getManagerList() {
  return getJson<ManagerList>('/api/edgar/managers')
}

// Fetches every manager in the category fresh from SEC and upserts each into
// Supabase -- slow (up to ~16-28 full 13F downloads), so callers should show
// a "this may take a while" loading state, not a quick spinner.
export async function refreshAllManagers(category: 'hedge-fund' | 'investment-fund') {
  const response = await fetch(`/api/edgar/managers/refresh-all?category=${category}`, { method: 'POST' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error || 'Failed to refresh managers')
  }
  return body.data as ManagerRefreshSummary
}

export function getAnalystData(ticker: string) {
  return getJsonWithSteps<AnalystData>(`/api/edgar/${encodeURIComponent(ticker)}/analyst`)
}

export function getProxyStatement(ticker: string) {
  return getJsonWithSteps<ProxyStatementData>(`/api/edgar/${encodeURIComponent(ticker)}/proxy-statement`)
}

export function getCongressTrading(ticker: string) {
  return getJsonWithSteps<CongressTradingData>(`/api/edgar/${encodeURIComponent(ticker)}/congress-trades`)
}

export function getPoliticianPortfolio(filerId: string) {
  return getJsonWithSteps<PoliticianPageData>(`/api/edgar/politician/${encodeURIComponent(filerId)}`)
}

export function getSavedTicker(ticker: string) {
  return getJsonOrNull<SavedSnapshot<TickerDashboardBundle>>(`/api/edgar/${encodeURIComponent(ticker)}/saved`)
}

export function getSavedManager(cik: string | number) {
  return getJsonOrNull<SavedSnapshot<ManagerPortfolio>>(`/api/edgar/manager/${encodeURIComponent(cik)}/saved`)
}

export function getSavedPolitician(filerId: string) {
  return getJsonOrNull<SavedSnapshot<PoliticianPageData>>(`/api/edgar/politician/${encodeURIComponent(filerId)}/saved`)
}

export function searchSaved(query: string) {
  return getJson<SearchResults>(`/api/edgar/search?q=${encodeURIComponent(query)}`)
}
