import type { ManagerPortfolio, PoliticianPageData, TickerDashboardBundle } from '@/types/edgar'

async function postSave(url: string, data: unknown, sourceMetadata: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, sourceMetadata }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.error || 'Failed to save snapshot')
  }
  return body.snapshot
}

export function saveTickerSnapshot(ticker: string, bundle: TickerDashboardBundle, sourceMetadata: Record<string, unknown>) {
  return postSave(`/api/edgar/${encodeURIComponent(ticker)}/save`, bundle, sourceMetadata)
}

export function saveManagerSnapshot(cik: string | number, bundle: ManagerPortfolio, sourceMetadata: Record<string, unknown>) {
  return postSave(`/api/edgar/manager/${encodeURIComponent(cik)}/save`, bundle, sourceMetadata)
}

export function savePoliticianSnapshot(filerId: string, bundle: PoliticianPageData, sourceMetadata: Record<string, unknown>) {
  return postSave(`/api/edgar/politician/${encodeURIComponent(filerId)}/save`, bundle, sourceMetadata)
}
