import { useEffect, useState, type CSSProperties } from 'react'
import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
import { ActiveEpisodesRail } from './active-episodes-rail'
import { AppSidebar } from './app-sidebar'
import { AssetClassRail } from './asset-class-rail'
import { ChartAreaInteractive } from './chart-area-interactive'
import { EventsTable } from './events-table'
import { MomentumSettingsDialog } from './MomentumSettingsDialog'
import { PerplexityUsagePanel } from './perplexity-usage'
import { SectionCards } from './section-cards'
import { SiteHeader } from './site-header'
import { fmtDateTime, fmtEpisodeNo, fmtPct, formatEpisodeState } from './format'
import { cn } from '@/lib/utils'
import { useMomentumStudio } from './useMomentumStudio'
import type { ActiveEpisodeRow } from './types'

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
                <EpisodesList studio={studio} />
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
                      <ChartAreaInteractive
                        ticker={studio.activeTicker}
                        marketState={studio.quote?.marketState}
                      />
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
        ) : studio.view === 'episodes' || studio.view === 'overview' ? (
          <ActiveEpisodesRail studio={studio} />
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
        onConfirmTestMode={(payload) => void studio.confirmTestMode(payload)}
        status={studio.status}
      />
    </SidebarProvider>
  )
}

/** Center column — all episodes so far (history + live). */
function EpisodesList({
  studio,
}: {
  studio: ReturnType<typeof useMomentumStudio>
}) {
  const rows = studio.episodeHistory

  if (studio.episodeHistoryLoading && !rows.length) {
    return (
      <div className="px-4 lg:px-6">
        <div className="flex aspect-video w-full flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
          Loading episodes…
        </div>
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="px-4 lg:px-6">
        <div className="flex aspect-video w-full flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
          No episodes yet
        </div>
      </div>
    )
  }
  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>All episodes</CardTitle>
          <CardDescription>
            History across tickers · click a row — right column shows if that
            ticker has a live ACTIVE episode
            {studio.activeEpisodes.length
              ? ` · ${studio.activeEpisodes.length} active now`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardFooter className="block p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Episode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Window</TableHead>
                <TableHead className="text-right">Move</TableHead>
                <TableHead className="text-right">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const selected =
                  String(row.ticker || '').toUpperCase() ===
                  String(studio.activeTicker || '').toUpperCase()
                const isLive =
                  String(row.status || '').toUpperCase() === 'ACTIVE'
                const up = row.direction !== 'DOWN'
                const Trend = up ? IconTrendingUp : IconTrendingDown
                return (
                  <TableRow
                    key={`${row.episodeId || row.ticker}-${row.episodeNo || row.episodeStartedAt}`}
                    className={cn(
                      'cursor-pointer',
                      selected && 'bg-muted/60',
                    )}
                    onClick={() => studio.selectActiveEpisode(row)}
                  >
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <Trend className="size-3.5 text-muted-foreground" />
                        {row.ticker}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {fmtEpisodeNo(row.episodeNo) || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isLive ? 'default' : 'outline'}>
                        {formatEpisodeState(row.status || row.state)}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.detectedWindow || '—'}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        row.direction === 'DOWN'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      {fmtPct(row.currentMovePercent ?? row.peakMovePercent)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {fmtDateTime(row.episodeStartedAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardFooter>
      </Card>
    </div>
  )
}

function EpisodesGrid({
  studio,
}: {
  studio: ReturnType<typeof useMomentumStudio>
}) {
  const rows = studio.episodeHistory.length
    ? studio.episodeHistory.slice(0, 12)
    : studio.activeEpisodes
  if (!rows.length) {
    return (
      <div className="px-4 lg:px-6">
        <div className="flex aspect-video w-full flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
          No episodes yet
        </div>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-3 dark:*:data-[slot=card]:bg-card">
      {rows.map((row) => {
        const up = row.direction !== 'DOWN'
        const Trend = up ? IconTrendingUp : IconTrendingDown
        const isLive = String(row.status || '').toUpperCase() === 'ACTIVE'
        return (
          <Card
            key={`${row.episodeId || row.ticker}-${row.episodeNo || row.episodeStartedAt}`}
            className="@container/card cursor-pointer transition-colors hover:bg-muted/30"
            onClick={() => studio.selectActiveEpisode(row as ActiveEpisodeRow)}
          >
            <CardHeader>
              <CardDescription>{row.ticker}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {fmtPct(row.currentMovePercent ?? row.peakMovePercent)}
              </CardTitle>
              <CardAction>
                <Badge variant={isLive ? 'default' : 'outline'}>
                  <Trend />
                  {isLive
                    ? fmtEpisodeNo(row.episodeNo) || 'live'
                    : formatEpisodeState(row.status)}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                {row.direction} · {formatEpisodeState(row.state || row.status)}
                <Trend className="size-4" />
              </div>
              <div className="text-muted-foreground">
                {row.detectedWindow || '—'} · {fmtDateTime(row.episodeStartedAt)}
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


