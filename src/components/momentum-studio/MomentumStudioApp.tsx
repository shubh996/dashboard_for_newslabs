import { useEffect, useState, type CSSProperties } from 'react'
import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTheme } from '@/hooks/useTheme'
import { AppSidebar } from './app-sidebar'
import { AssetClassRail } from './asset-class-rail'
import { ChartAreaInteractive } from './chart-area-interactive'
import { EventsTable } from './events-table'
import { MomentumSettingsDialog } from './MomentumSettingsDialog'
import { PerplexityUsagePanel } from './perplexity-usage'
import { SectionCards } from './section-cards'
import { SiteHeader } from './site-header'
import { fmtDateTime, fmtEpisodeNo, fmtPct, formatEpisodeState } from './format'
import { useMomentumStudio } from './useMomentumStudio'

export function MomentumStudioApp() {
  const { theme, toggleTheme } = useTheme()
  const studio = useMomentumStudio()
  const [chartExpanded, setChartExpanded] = useState(false)

  useEffect(() => {
    setChartExpanded(false)
  }, [studio.activeTicker])

  return (
    <SidebarProvider
      className="h-svh min-h-0! overflow-hidden"
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <AppSidebar variant="inset" studio={studio} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <SiteHeader
          studio={studio}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="@container/main flex flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              {studio.statusError ? (
                <div className="px-4 lg:px-6">
                  <Alert variant="destructive">
                    <AlertTitle>Could not load status</AlertTitle>
                    <AlertDescription>{studio.statusError}</AlertDescription>
                  </Alert>
                </div>
              ) : null}

              {studio.view === 'overview' ? (
                <OverviewDashboard studio={studio} />
              ) : studio.view === 'episodes' ? (
                <EpisodesGrid studio={studio} />
              ) : studio.view === 'users' ? (
                <UsersView studio={studio} />
              ) : studio.view === 'perplexity' ? (
                <PerplexityUsagePanel />
              ) : studio.view === 'activity' ? (
                <EventsTable studio={studio} />
              ) : (
                <>
                  <SectionCards
                    studio={studio}
                    onExpandChart={() => setChartExpanded((v) => !v)}
                  />
                  {chartExpanded && studio.activeTicker ? (
                    <div className="px-4 lg:px-6">
                      <ChartAreaInteractive ticker={studio.activeTicker} />
                    </div>
                  ) : null}
                  <EventsTable studio={studio} />
                </>
              )}
            </div>
          </div>
        </div>
        {studio.view === 'watchlist' ? (
          <AssetClassRail studio={studio} />
        ) : null}
        </div>
      </SidebarInset>

      <MomentumSettingsDialog
        open={studio.settingsOpen}
        onOpenChange={studio.setSettingsOpen}
        theme={theme}
        onToggleTheme={toggleTheme}
        testModeEnabled={studio.testModeEnabled}
        testModeSaving={studio.testModeSaving}
        onToggleTestMode={(v) => void studio.toggleTestMode(v)}
        status={studio.status}
      />
    </SidebarProvider>
  )
}

function EpisodesGrid({
  studio,
}: {
  studio: ReturnType<typeof useMomentumStudio>
}) {
  const rows = studio.activeEpisodes
  if (!rows.length) {
    return (
      <div className="px-4 lg:px-6">
        <div className="flex aspect-video w-full flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
          No active episodes
        </div>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-3 dark:*:data-[slot=card]:bg-card">
      {rows.map((row) => {
        const up = row.direction !== 'DOWN'
        const Trend = up ? IconTrendingUp : IconTrendingDown
        return (
          <Card
            key={`${row.ticker}-${row.episodeNo || row.episodeStartedAt}`}
            className="@container/card"
          >
            <CardHeader>
              <CardDescription>{row.ticker}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {fmtPct(row.currentMovePercent)}
              </CardTitle>
              <CardAction>
                <Badge variant="outline">
                  <Trend />
                  {fmtEpisodeNo(row.episodeNo) || 'live'}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                {row.direction} · {formatEpisodeState(row.state || row.status)}
                <Trend className="size-4" />
              </div>
              <div className="flex w-full items-center justify-between text-muted-foreground">
                <span>
                  {row.detectedWindow || '—'} · {fmtDateTime(row.episodeStartedAt)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const item = studio.tickers.find(
                      (t) => t.ticker === row.ticker,
                    )
                    if (item) studio.setAssetClass(item.assetClass)
                    studio.setActiveTicker(row.ticker)
                    studio.setView('watchlist')
                  }}
                >
                  Open
                </Button>
              </div>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}

function OverviewDashboard({
  studio,
}: {
  studio: ReturnType<typeof useMomentumStudio>
}) {
  const byClass = studio.byClass
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Watchlist</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {studio.tickers.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Active episodes</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {studio.activeEpisodes.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Stocks</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {byClass.equity ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Crypto + FX + commodities</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {(byClass.crypto ?? 0) +
                (byClass.forex ?? 0) +
                (byClass.commodity ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <EpisodesGrid studio={studio} />
    </div>
  )
}

function UsersView({
  studio,
}: {
  studio: ReturnType<typeof useMomentumStudio>
}) {
  const rows = [...studio.tickers].sort(
    (a, b) => (b.subscriberCount || 0) - (a.subscriberCount || 0),
  )
  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Trigger subscribers on monitored tickers
          </CardDescription>
        </CardHeader>
        <CardFooter className="block p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Subscribers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.ticker}>
                  <TableCell className="font-medium">{row.ticker}</TableCell>
                  <TableCell>{row.assetClass}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.subscriberCount ?? 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardFooter>
      </Card>
    </div>
  )
}


