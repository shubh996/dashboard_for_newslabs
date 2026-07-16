import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { useSavedEntities } from '@/hooks/useSavedEntities'
import type { CongressTradingData } from '@/types/edgar'
import { GainText, SavedBadge, SectionCard, SimpleTable, StatGrid, compactDollarAmountsInText, formatCurrency, formatPercent } from './shared'

const PARTY_LABELS: Record<string, string> = { R: 'Republican', D: 'Democrat', I: 'Independent', L: 'Libertarian' }

export function CongressTradingSection({ data }: { data: CongressTradingData }) {
  const { isPoliticianSaved } = useSavedEntities()
  const purchases = data.trades.filter((t) => (t.transactionType || '').toLowerCase().includes('purchase')).length
  const sales = data.trades.filter((t) => (t.transactionType || '').toLowerCase().includes('sale')).length
  const uniqueMembers = new Set(data.trades.map((t) => t.filerName).filter(Boolean)).size

  return (
    <SectionCard title="Congressional Trading Activity" description="STOCK Act disclosures (local dataset, congress-trading-monitor)">
      <StatGrid
        stats={[
          { label: 'Total Disclosed Trades', value: data.trades.length },
          { label: 'Unique Members of Congress', value: uniqueMembers },
          { label: 'Purchases', value: purchases },
          { label: 'Sales', value: sales },
          ...(data.latestPrice
            ? [{ label: 'Latest Tracked Price', value: formatCurrency(data.latestPrice.close), sub: `as of ${data.latestPrice.date}` }]
            : []),
        ]}
      />
      <div className="mt-4">
        <SimpleTable
          columns={[
            { key: 'date', label: 'Transaction Date' },
            { key: 'member', label: 'Member' },
            { key: 'party', label: 'Party' },
            { key: 'chamber', label: 'Chamber' },
            { key: 'state', label: 'State' },
            { key: 'type', label: 'Type' },
            { key: 'amount', label: 'Amount' },
            { key: 'days', label: 'Days to File', align: 'right' },
            { key: 'return', label: 'Return Since', align: 'right' },
          ]}
          rows={data.trades.slice(0, 25).map((t) => ({
            date: t.transactionDate || 'N/A',
            member: t.filerId ? (
              <Link
                className="flex items-center gap-1.5 text-primary underline underline-offset-2"
                to={`/dashboard/ticker/politician/${t.filerId}${isPoliticianSaved(t.filerId) ? '?source=saved' : ''}`}
              >
                {isPoliticianSaved(t.filerId) ? <SavedBadge /> : null}
                {t.filerName || 'N/A'}
              </Link>
            ) : (
              t.filerName || 'N/A'
            ),
            party: t.party ? <Badge variant="secondary">{PARTY_LABELS[t.party] || t.party}</Badge> : 'N/A',
            chamber: t.chamber || 'N/A',
            state: t.state || 'N/A',
            type: t.transactionType || 'N/A',
            amount: t.amountRangeLabel ? compactDollarAmountsInText(t.amountRangeLabel) : 'N/A',
            days: t.daysToFile ?? 'N/A',
            return: <GainText value={t.retSince}>{formatPercent(t.retSince, 1)}</GainText>,
          }))}
          emptyMessage="No congressional trading disclosures found for this ticker."
        />
      </div>
    </SectionCard>
  )
}
