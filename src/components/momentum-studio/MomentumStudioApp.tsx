import { useEffect, useState, type CSSProperties } from 'react'
import { PanelRight, TrendingDown, TrendingUp } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
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
import { cn } from '@/lib/utils'
import { ActiveEpisodesRail } from './active-episodes-rail'
import { AppSidebar } from './app-sidebar'
import { AssetClassRail } from './asset-class-rail'
import { ChartAreaInteractive } from './chart-area-interactive'
import { EpisodeGrid } from './episode-grid'
import { EventsTable } from './events-table'
import { MetricGrid } from './metric-grid'
import { MomentumSettingsDialog } from './MomentumSettingsDialog'
import { PerplexityUsagePanel } from './perplexity-usage'
import { SectionCards } from './section-cards'
import { SiteHeader } from './site-header'
import { UsersView } from './users-view'
import { fmtDateTime, fmtEpisodeNo, fmtPct, formatEpisodeState } from './format'
import { useMomentumStudio } from './useMomentumStudio'

export function MomentumStudioApp() {
  const { theme, toggleTheme } = useTheme()
  const studio = useMomentumStudio()
  const [chartExpanded, setChartExpanded] = useState(false)
  const [railOpen, setRailOpen] = useState(false)

  useEffect(() => {
    setChartExpanded(false)
  }, [studio.activeTicker])

  const showActiveRail =
    studio.view === 'episodes' || studio.view === 'overview'
  const showWatchlistRail = studio.view === 'watchlist'

  return (
    <SidebarProvider
      className="h-svh min-h-0! overflow-hidden"
      style={
        {
          '--sidebar-width': '16rem',
          '--header-height': '3rem',
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
        {studio.deskOnly ? (
          <div className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <Alert className="border-amber-500/30 bg-transparent">
              <AlertTitle>Momentum desk-only mode</AlertTitle>
              <AlertDescription>
                Studio polls and side services are paused (
                <span className="font-mono">MOMENTUM_DESK_ONLY=1</span>). Use
                the original Momentum desk on Notifications.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {studio.view === 'users' ? (
            <div className="@container/main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {studio.statusError ? (
                <div className="shrink-0 px-4 py-3 lg:px-6">
                  <Alert variant="destructive">
                    <AlertTitle>Could not load status</AlertTitle>
                    <AlertDescription>{studio.statusError}</AlertDescription>
                  </Alert>
                </div>
              ) : null}
              <UsersView />
            </div>
          ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="@container/main flex flex-col gap-2">
              <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
                {studio.statusError ? (
                  <div className="px-4 lg:px-6">
                    <Alert variant="destructive">
                      <AlertTitle>Could not load status</AlertTitle>
                      <AlertDescription>
                        {studio.statusError}
                      </AlertDescription>
                    </Alert>
                  </div>
                ) : null}

                {studio.view === 'overview' ? (
                  <OverviewDashboard studio={studio} />
                ) : studio.view === 'episodes' ? (
                  <EpisodesList studio={studio} />
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
          )}

          {showWatchlistRail ? (
            <AssetClassRail studio={studio} className="max-lg:hidden" />
          ) : null}

          {showActiveRail ? (
            <>
              <ActiveEpisodesRail
                studio={studio}
                className="max-md:hidden"
              />
              <Sheet open={railOpen} onOpenChange={setRailOpen}>
                <SheetTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="fixed right-4 bottom-4 z-40 size-10 rounded-full shadow-md md:hidden"
                    aria-label="Open active episodes"
                  >
                    <PanelRight />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="w-[min(100vw,24rem)] p-0 sm:max-w-md"
                >
                  <SheetHeader className="sr-only">
                    <SheetTitle>Active episodes</SheetTitle>
                  </SheetHeader>
                  <ActiveEpisodesRail
                    studio={studio}
                    className="h-full w-full border-l-0"
                  />
                </SheetContent>
              </Sheet>
            </>
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
                const Trend = up ? TrendingUp : TrendingDown
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
                    <TableCell className="text-right font-semibold tabular-nums">
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

function OverviewDashboard({
  studio,
}: {
  studio: ReturnType<typeof useMomentumStudio>
}) {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <MetricGrid studio={studio} />
      <EpisodeGrid studio={studio} />
    </div>
  )
}
