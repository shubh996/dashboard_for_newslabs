import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { YahooMarketStateLabel } from '@/components/yahoo/YahooMarketStateLabel'
import { ChartAreaInteractive } from './chart-area-interactive'
import { fmtEpisodeNo, fmtPct, fmtPrice } from './format'
import type { MomentumStudioState } from './useMomentumStudio'

export function SectionCards({
  studio,
  onExpandChart,
}: {
  studio: MomentumStudioState
  onExpandChart: () => void
}) {
  const ep = studio.status?.episode
  const day = studio.dayPct
  const up = day != null && day >= 0
  const Trend = up ? IconTrendingUp : IconTrendingDown
  const epUp = ep?.direction !== 'DOWN'

  return (
    <div className="grid grid-cols-2 gap-2 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-6 dark:*:data-[slot=card]:bg-card">
      <Card size="sm" className="@container/card">
        <CardHeader>
          <CardDescription className="space-y-0.5">
            <span className="block">
              {studio.selected?.label || studio.activeTicker || 'Quote'}
            </span>
            <YahooMarketStateLabel
              marketState={studio.quote?.marketState}
              className="normal-case tracking-normal"
            />
          </CardDescription>
          <CardTitle className="text-base font-semibold tabular-nums">
            {fmtPrice(studio.livePrice, studio.quote?.currency)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <Trend />
              {fmtPct(day)}
            </Badge>
          </CardAction>
        </CardHeader>
      </Card>

      <Card size="sm" className="@container/card">
        <CardHeader>
          <CardDescription>Day move</CardDescription>
          <CardTitle className="text-base font-semibold tabular-nums">
            {fmtPct(day)}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              {studio.selected?.assetClass &&
              studio.selected.assetClass !== 'equity'
                ? studio.selected.assetClass
                : 'Yahoo Finance'}
            </Badge>
          </CardAction>
        </CardHeader>
      </Card>

      <Card size="sm" className="@container/card">
        <CardHeader>
          <CardDescription>Episode</CardDescription>
          <CardTitle className="text-base font-semibold tabular-nums">
            {ep
              ? `${ep.direction || '—'} ${fmtEpisodeNo(ep.episodeNo) || ''}`.trim()
              : 'None'}
          </CardTitle>
          <CardAction>
            {ep ? (
              <Badge variant="outline">
                {epUp ? <IconTrendingUp /> : <IconTrendingDown />}
                {fmtPct(ep.currentMovePercent)}
              </Badge>
            ) : (
              <Badge variant="outline">Idle</Badge>
            )}
          </CardAction>
        </CardHeader>
      </Card>

      <Card size="sm" className="@container/card">
        <CardHeader>
          <CardDescription>Engine</CardDescription>
          <CardTitle className="text-base font-semibold tabular-nums">
            {studio.status?.loopRunning ? 'Live' : 'Idle'}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              {Math.round((studio.status?.pollIntervalMs || 60_000) / 1000)}s
            </Badge>
          </CardAction>
        </CardHeader>
      </Card>

      {studio.activeTicker ? (
        <ChartAreaInteractive
          ticker={studio.activeTicker}
          compact
          onExpand={onExpandChart}
          marketState={studio.quote?.marketState}
        />
      ) : (
        <Card className="@5xl/main:col-span-2">
          <CardHeader>
            <CardDescription>Chart</CardDescription>
            <CardTitle className="text-sm font-medium">No ticker</CardTitle>
          </CardHeader>
        </Card>
      )}
    </div>
  )
}
