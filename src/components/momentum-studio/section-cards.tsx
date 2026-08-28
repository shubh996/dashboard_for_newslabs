import { TrendingDown, TrendingUp } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { YahooMarketStateLabel } from '@/components/yahoo/YahooMarketStateLabel'
import { ChartAreaInteractive } from './chart-area-interactive'
import { fmtEpisodeNo, fmtPct, fmtPrice, formatEpisodeState } from './format'
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
  const Trend = up ? TrendingUp : TrendingDown
  const epUp = ep?.direction !== 'DOWN'
  const EpTrend = epUp ? TrendingUp : TrendingDown

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
        <Card className="@container/card">
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
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {fmtPrice(studio.livePrice, studio.quote?.currency)}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <Trend />
                {fmtPct(day)}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              Day move {fmtPct(day)}
              <Trend className="size-4" />
            </div>
            <div className="text-muted-foreground">
              Live quote for {studio.activeTicker || '—'}
            </div>
          </CardFooter>
        </Card>

        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Day move</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
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
          <CardFooter className="flex-col items-start gap-1 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {up ? 'Up on the session' : 'Down on the session'}
              <Trend className="size-4" />
            </div>
            <div className="text-muted-foreground">
              Regular / extended session change
            </div>
          </CardFooter>
        </Card>

        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Episode</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {ep
                ? `${ep.direction || '—'} ${fmtEpisodeNo(ep.episodeNo) || ''}`.trim()
                : 'None'}
            </CardTitle>
            <CardAction>
              {ep ? (
                <Badge variant="outline">
                  <EpTrend />
                  {fmtPct(ep.currentMovePercent)}
                </Badge>
              ) : (
                <Badge variant="outline">Idle</Badge>
              )}
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {ep
                ? formatEpisodeState(ep.state || ep.status)
                : 'No active episode'}
              {ep ? <EpTrend className="size-4" /> : null}
            </div>
            <div className="text-muted-foreground">
              {ep?.detectedWindow || 'Momentum detector idle for this ticker'}
            </div>
          </CardFooter>
        </Card>

        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Engine</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {studio.status?.loopRunning ? 'Live' : 'Idle'}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                {Math.round((studio.status?.pollIntervalMs || 60_000) / 1000)}s
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1 text-sm">
            <div className="line-clamp-1 flex gap-2 font-medium">
              {studio.status?.loopRunning
                ? 'Polling loop running'
                : 'Polling loop idle'}
            </div>
            <div className="text-muted-foreground">
              {studio.activeTicker
                ? `Status for ${studio.activeTicker}`
                : 'Select a ticker to inspect'}
            </div>
          </CardFooter>
        </Card>
      </div>

      {studio.activeTicker ? (
        <div className="px-4 lg:px-6">
          <ChartAreaInteractive
            ticker={studio.activeTicker}
            compact
            onExpand={onExpandChart}
            marketState={studio.quote?.marketState}
          />
        </div>
      ) : null}
    </div>
  )
}
