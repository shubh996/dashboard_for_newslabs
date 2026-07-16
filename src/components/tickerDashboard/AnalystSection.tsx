import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import type { AnalystData } from '@/types/edgar'
import { GainText, SectionEmpty, SimpleTable, StatGrid, formatCurrency, formatPercent } from './shared'

const RECOMMENDATION_LABELS: Record<string, string> = {
  strong_buy: 'Strong Buy',
  buy: 'Buy',
  hold: 'Hold',
  sell: 'Sell',
  strong_sell: 'Strong Sell',
  underperform: 'Underperform',
  outperform: 'Outperform',
}

function recommendationLabel(key: string | null) {
  if (!key) return 'N/A'
  return RECOMMENDATION_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function recommendationVariant(key: string | null): 'default' | 'secondary' | 'destructive' {
  if (!key) return 'secondary'
  if (key.includes('buy') || key === 'outperform') return 'default'
  if (key.includes('sell') || key === 'underperform') return 'destructive'
  return 'secondary'
}

// A plain 3-segment bar (bullish/neutral/bearish) -- reuses the app's
// existing emerald/red gain-loss color convention (see GainText in
// shared.tsx) rather than introducing a separate palette for one chart.
function SentimentBar({ bullishPercent, neutralPercent, bearishPercent }: { bullishPercent: number; neutralPercent: number; bearishPercent: number }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="bg-emerald-500" style={{ width: `${bullishPercent}%` }} />
      <div className="bg-muted-foreground/40" style={{ width: `${neutralPercent}%` }} />
      <div className="bg-red-500" style={{ width: `${bearishPercent}%` }} />
    </div>
  )
}

function periodLabel(period: string | null | undefined) {
  if (!period) return '—'
  if (period === '0m') return 'Current'
  if (period === '-1m') return '1 month ago'
  if (period === '-2m') return '2 months ago'
  if (period === '-3m') return '3 months ago'
  return period
}

export function AnalystSection({ analyst }: { analyst: AnalystData }) {
  const { consensus, sentiment, ratings, trend = [] } = analyst

  const targetStats = [
    { label: 'Low Target', value: formatCurrency(consensus.targetLow), upside: consensus.upsideToLow },
    { label: 'Mean Target', value: formatCurrency(consensus.targetMean), upside: consensus.upsideToMean },
    ...(consensus.targetMedian != null ? [{ label: 'Median Target', value: formatCurrency(consensus.targetMedian), upside: null }] : []),
    { label: 'High Target', value: formatCurrency(consensus.targetHigh), upside: consensus.upsideToHigh },
  ]

  // Per "don't fabricate missing data" -- a ratings-table column only
  // appears if at least one row actually has that field; an
  // entirely-unavailable field disappears instead of showing a column of dashes.
  const hasAction = ratings.some((rating) => rating.actionLabel)
  const hasFromGrade = ratings.some((rating) => rating.fromGrade)
  const hasPriceTarget = ratings.some((rating) => rating.priceTarget != null)
  const hasPriorTarget = ratings.some((rating) => rating.priorPriceTarget != null)

  const ratingsColumns = [
    { key: 'date', label: 'Date' },
    { key: 'firm', label: 'Firm' },
    ...(hasAction ? [{ key: 'action', label: 'Action' }] : []),
    { key: 'grade', label: hasFromGrade ? 'Rating Change' : 'Rating' },
    ...(hasPriceTarget ? [{ key: 'priceTarget', label: 'Price Target', align: 'right' as const }] : []),
    ...(hasPriorTarget ? [{ key: 'priorPriceTarget', label: 'Prior Target', align: 'right' as const }] : []),
  ]

  const ratingsRows = ratings.map((rating) => ({
    date: rating.date || 'N/A',
    firm: rating.firm || 'N/A',
    action: rating.actionLabel ? <Badge variant="outline">{rating.actionLabel}</Badge> : 'N/A',
    grade:
      hasFromGrade && rating.fromGrade && rating.toGrade && rating.fromGrade !== rating.toGrade
        ? `${rating.fromGrade} → ${rating.toGrade}`
        : rating.toGrade || 'N/A',
    priceTarget: rating.priceTarget != null ? formatCurrency(rating.priceTarget) : 'N/A',
    priorPriceTarget: rating.priorPriceTarget != null ? formatCurrency(rating.priorPriceTarget) : 'N/A',
  }))

  const trendRows = trend.map((point) => ({
    period: periodLabel(point.period),
    strongBuy: point.strongBuy,
    buy: point.buy,
    hold: point.hold,
    sell: point.sell,
    strongSell: point.strongSell,
    total: point.strongBuy + point.buy + point.hold + point.sell + point.strongSell,
  }))

  return (
    <div className="flex flex-col gap-6">
      <SectionCardShell title="Analyst Consensus" description={consensus.numberOfAnalystOpinions ? `${consensus.numberOfAnalystOpinions} analysts` : undefined}>
        <StatGrid
          stats={[
            {
              label: 'Consensus',
              value: <Badge variant={recommendationVariant(consensus.recommendationKey)}>{recommendationLabel(consensus.recommendationKey)}</Badge>,
              sub: consensus.recommendationMean != null ? `Mean score ${consensus.recommendationMean.toFixed(1)} (1=Strong Buy, 5=Strong Sell)` : undefined,
            },
            { label: 'Current Price', value: formatCurrency(consensus.currentPrice) },
            {
              label: '52-Week Range',
              value:
                consensus.fiftyTwoWeekLow != null && consensus.fiftyTwoWeekHigh != null
                  ? `${formatCurrency(consensus.fiftyTwoWeekLow)} – ${formatCurrency(consensus.fiftyTwoWeekHigh)}`
                  : 'N/A',
            },
          ]}
        />

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {targetStats.map((stat) => (
            <div key={stat.label} className="rounded-lg border bg-muted/30 px-3 py-2">
              <div className="text-xs font-medium text-muted-foreground">{stat.label}</div>
              <div className="mt-0.5 text-base font-semibold">{stat.value}</div>
              {stat.upside != null ? (
                <div className="mt-0.5 text-xs">
                  <GainText value={stat.upside}>{formatPercent(stat.upside)} vs current</GainText>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </SectionCardShell>

      <SectionCardShell
        title="Recommendation Trend History"
        description={trend.length ? `${trend.length} periods from Yahoo Finance` : undefined}
      >
        {trendRows.length ? (
          <SimpleTable
            columns={[
              { key: 'period', label: 'Period' },
              { key: 'strongBuy', label: 'Strong buy', align: 'right' },
              { key: 'buy', label: 'Buy', align: 'right' },
              { key: 'hold', label: 'Hold', align: 'right' },
              { key: 'sell', label: 'Sell', align: 'right' },
              { key: 'strongSell', label: 'Strong sell', align: 'right' },
              { key: 'total', label: 'Total', align: 'right' },
            ]}
            rows={trendRows}
          />
        ) : (
          <SectionEmpty message="No recommendation trend history available for this ticker." />
        )}
      </SectionCardShell>

      {sentiment ? (
        <SectionCardShell title="Bullish / Neutral / Bearish" description={`Based on ${sentiment.total} analyst ratings`}>
          <SentimentBar
            bullishPercent={sentiment.bullishPercent ?? 0}
            neutralPercent={sentiment.neutralPercent ?? 0}
            bearishPercent={sentiment.bearishPercent ?? 0}
          />
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <span className="inline-block size-2 rounded-full bg-emerald-500" /> Bullish{' '}
              <span className="font-medium">
                {sentiment.bullish} ({sentiment.bullishPercent != null ? sentiment.bullishPercent.toFixed(1) : 0.0}%)
              </span>
            </div>
            <div>
              <span className="inline-block size-2 rounded-full bg-muted-foreground/40" /> Neutral{' '}
              <span className="font-medium">
                {sentiment.neutral} ({sentiment.neutralPercent != null ? sentiment.neutralPercent.toFixed(1) : 0.0}%)
              </span>
            </div>
            <div>
              <span className="inline-block size-2 rounded-full bg-red-500" /> Bearish{' '}
              <span className="font-medium">
                {sentiment.bearish} ({sentiment.bearishPercent != null ? sentiment.bearishPercent.toFixed(1) : 0.0}%)
              </span>
            </div>
          </div>
        </SectionCardShell>
      ) : null}

      <SectionCardShell title="Firm-by-Firm Ratings" description={`${ratings.length} recent rating actions`}>
        {ratings.length ? (
          <SimpleTable columns={ratingsColumns} rows={ratingsRows} />
        ) : (
          <SectionEmpty message="No firm-by-firm rating history available for this ticker." />
        )}
      </SectionCardShell>
    </div>
  )
}

// A lighter card than SectionCard (no outer border) since AnalystSection
// stacks three of these in one tab -- three full bordered SectionCards back
// to back read as three separate pages instead of one cohesive view.
function SectionCardShell({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}
