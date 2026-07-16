import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  DataSourceNote,
  GainText,
  RawJsonViewer,
  SectionCard,
  SectionError,
  SectionLoading,
  SimpleTable,
  StatGrid,
  TickerLink,
  compactDollarAmountsInText,
  formatCurrency,
  formatPercent,
  formatTimestamp,
} from '@/components/tickerDashboard/shared'
import { SaveToSupabaseButton } from '@/components/tickerDashboard/SaveToSupabaseButton'
import { TickerDashboardHeader } from '@/components/tickerDashboard/TickerDashboardHeader'
import { useEdgarSection } from '@/hooks/useEdgarSection'
import { getPoliticianPortfolio, getSavedPolitician } from '@/services/edgarApi'
import type { WithSteps } from '@/services/edgarApi'
import type { PoliticianPageData } from '@/types/edgar'

const PARTY_LABELS: Record<string, string> = { R: 'Republican', D: 'Democrat', I: 'Independent', L: 'Libertarian' }

export default function PoliticianPortfolioPage() {
  const { filerId = '' } = useParams<{ filerId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const savedMode = searchParams.get('source') === 'saved'
  const [savedAtOverride, setSavedAtOverride] = useState<string | null>(null)

  const saved = useEdgarSection(`saved-politician:${filerId}`, () => getSavedPolitician(filerId), 'Failed to check saved snapshot')
  const live = useEdgarSection(
    `politician:${filerId}:${savedMode}`,
    () =>
      savedMode
        ? Promise.resolve<WithSteps<PoliticianPageData | null>>({ data: null, steps: [] })
        : getPoliticianPortfolio(filerId),
    'Failed to load politician portfolio',
  )

  const data = savedMode ? saved.data?.data ?? null : live.data?.data ?? null
  const steps = savedMode ? [] : live.data?.steps ?? []
  const loading = savedMode ? saved.loading : live.loading
  const error = savedMode ? saved.error : live.error

  const sourceNote = savedMode
    ? {
        endpoint: `GET /api/edgar/politician/${filerId}/saved`,
        sources: [
          `Supabase table \`${saved.data?.sourceTable || 'politician_snapshots'}\`, row for filer_id="${filerId}" (saved ${formatTimestamp(savedAtOverride ?? saved.data?.createdAt)})`,
          'Rendering that saved snapshot as-is -- NOT re-reading the local congress dataset. Use "Refresh from SEC" in the header above to force a live re-fetch.',
        ],
        loadingLabel: `Fetching saved politician snapshot from Supabase (table: ${saved.data?.sourceTable || 'politician_snapshots'})…`,
      }
    : {
        endpoint: `GET /api/edgar/politician/${filerId}`,
        sources: [
          `Local dataset: server/data/congress/filer/${filerId}.json — copied from the congressional-trading-monitor project's public STOCK Act data, not a live SEC feed`,
          'Portfolio value/gain is computed from each disclosed buy priced against that same local dataset\'s latest bundled close price, not a live/real-time price feed',
        ],
        loadingLabel: `Loading local STOCK Act filer data for ${filerId} and computing live portfolio…`,
      }

  const filer = data?.filer
  const role = filer
    ? filer.branch === 'executive'
      ? `${filer.office || 'Executive branch official'} — ${filer.agency || 'N/A'}`
      : `${filer.chamber === 'senate' ? 'Senate' : 'House'} — ${PARTY_LABELS[filer.party || ''] || filer.party || 'N/A'} — ${filer.state || 'N/A'}`
    : undefined

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 md:px-8">
      <TickerDashboardHeader
        ticker={filer?.fullName || filerId}
        companyName={role}
        savedAt={savedAtOverride ?? saved.data?.createdAt}
        onRefresh={savedMode ? () => setSearchParams({}) : undefined}
        actions={
          data ? (
            <SaveToSupabaseButton
              kind="politician"
              identifier={filerId}
              bundle={data}
              sourceMetadata={{ fetchedAt: new Date().toISOString() }}
              alreadySaved={Boolean(saved.data)}
              onSaved={setSavedAtOverride}
            />
          ) : undefined
        }
      />

      <DataSourceNote endpoint={sourceNote.endpoint} sources={sourceNote.sources} />
      {loading ? <SectionLoading label={sourceNote.loadingLabel} /> : null}
      {error ? <SectionError message={error} /> : null}

      {data ? (
        <div className="flex flex-col gap-6">
          <SectionCard
            title="Live Portfolio (Buy-and-Hold Positions)"
            description="Every disclosed BUY priced at today's close, assuming nothing was ever sold, vs. a same-dollar SPY investment over the same holding period."
          >
            {data.portfolio ? (
              <>
                <StatGrid
                  stats={[
                    { label: 'Portfolio Value', value: formatCurrency(data.portfolio.value), sub: `from ${formatCurrency(data.portfolio.cost)} cost` },
                    {
                      label: 'Unrealized Gain',
                      value: <GainText value={data.portfolio.gain}>{formatCurrency(data.portfolio.gain)}</GainText>,
                      sub: <GainText value={data.portfolio.gainPct}>{formatPercent(data.portfolio.gainPct)}</GainText>,
                    },
                    {
                      label: 'vs Same-$ SPY',
                      value: <GainText value={data.portfolio.vsSpy}>{formatCurrency(data.portfolio.vsSpy)}</GainText>,
                      sub: `SPY would hold ${formatCurrency(data.portfolio.spyValue)}`,
                    },
                    { label: 'Positions', value: data.portfolio.holdings.length, sub: `${data.portfolio.scoredBuys} buys scored` },
                  ]}
                />
                <div className="mt-4">
                  <SimpleTable
                    columns={[
                      { key: 'ticker', label: 'Ticker' },
                      { key: 'asset', label: 'Asset' },
                      { key: 'since', label: 'Since' },
                      { key: 'cost', label: 'Cost Basis', align: 'right' },
                      { key: 'value', label: 'Value Today', align: 'right' },
                      { key: 'gain', label: 'Gain', align: 'right' },
                      { key: 'weight', label: 'Share of Portfolio', align: 'right' },
                    ]}
                    rows={data.portfolio.holdings.slice(0, 50).map((p) => ({
                      ticker: <TickerLink ticker={p.ticker} />,
                      asset: p.assetName || 'N/A',
                      since: p.firstDate || 'N/A',
                      cost: formatCurrency(p.cost),
                      value: formatCurrency(p.value),
                      gain: <GainText value={p.gainPct}>{formatPercent(p.gainPct, 0)}</GainText>,
                      weight: formatPercent(p.weight, 1),
                    }))}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Not enough priced buy transactions to build a live portfolio for this filer.</p>
            )}
          </SectionCard>

          <SectionCard title={`All Disclosed Trades (latest 100 of ${data.trades.length})`}>
            <SimpleTable
              columns={[
                { key: 'date', label: 'Transaction Date' },
                { key: 'ticker', label: 'Ticker' },
                { key: 'type', label: 'Type' },
                { key: 'amount', label: 'Amount' },
                { key: 'days', label: 'Days to File', align: 'right' },
                { key: 'return', label: 'Return Since', align: 'right' },
              ]}
              rows={data.trades.slice(0, 100).map((t) => ({
                date: t.transactionDate || 'N/A',
                ticker: <TickerLink ticker={t.ticker} />,
                type: t.transactionType || 'N/A',
                amount: t.amountRangeLabel ? compactDollarAmountsInText(t.amountRangeLabel) : 'N/A',
                days: t.daysToFile ?? 'N/A',
                return: <GainText value={t.retSince}>{formatPercent(t.retSince, 2)}</GainText>,
              }))}
            />
          </SectionCard>
        </div>
      ) : null}
      <RawJsonViewer data={data} endpoint={sourceNote.endpoint} steps={steps} />
    </div>
  )
}
