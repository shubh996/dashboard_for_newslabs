import { Activity, Bitcoin, LineChart, ListChecks, TrendingUp } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { MomentumStudioState } from './useMomentumStudio'

export function MetricGrid({
  studio,
}: {
  studio: MomentumStudioState
}) {
  const byClass = studio.byClass
  const watchCount = studio.tickers.length
  const activeCount = studio.activeEpisodes.length
  const stockCount = byClass.equity ?? 0
  const altCount =
    (byClass.crypto ?? 0) + (byClass.forex ?? 0) + (byClass.commodity ?? 0)
  const indexCount = byClass.index ?? 0

  const upCount = studio.activeEpisodes.filter((e) => e.direction !== 'DOWN')
    .length
  const downCount = activeCount - upCount
  const activeShare =
    watchCount > 0 ? Math.round((activeCount / watchCount) * 1000) / 10 : 0

  if (studio.listLoading && !watchCount) {
    return (
      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="@container/card">
            <CardHeader>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </CardHeader>
            <CardFooter className="flex-col items-start gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-32" />
            </CardFooter>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Watchlist</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {watchCount}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <ListChecks />
              {stockCount} eq
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Monitored across asset classes
            <ListChecks className="size-4" />
          </div>
          <div className="text-muted-foreground">
            {indexCount} indices · {altCount} crypto / FX / commodities
          </div>
        </CardFooter>
      </Card>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Active episodes</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {activeCount}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              {activeCount > 0 ? <TrendingUp /> : <Activity />}
              {activeShare}%
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {activeCount > 0
              ? `${upCount} up · ${downCount} down live now`
              : 'No live momentum episodes'}
            {activeCount > 0 ? (
              <TrendingUp className="size-4" />
            ) : (
              <Activity className="size-4" />
            )}
          </div>
          <div className="text-muted-foreground">
            Live share of watchlist tickers
          </div>
        </CardFooter>
      </Card>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Stocks</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stockCount}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <LineChart />
              Equity
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Primary equity coverage
            <LineChart className="size-4" />
          </div>
          <div className="text-muted-foreground">
            US and listed stock symbols on the desk
          </div>
        </CardFooter>
      </Card>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Crypto + FX + commodities</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {altCount}
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <Bitcoin />
              Alts
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {(byClass.crypto ?? 0) + ' crypto · '}
            {(byClass.forex ?? 0) + ' FX · '}
            {(byClass.commodity ?? 0) + ' commodities'}
          </div>
          <div className="text-muted-foreground">
            Non-equity asset classes on watch
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
