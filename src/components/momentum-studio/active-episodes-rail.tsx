import { IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  fmtDateTime,
  fmtEpisodeNo,
  fmtPct,
  fmtPrice,
  formatEpisodeState,
  pctTone,
} from './format'
import { TickerLogo } from './ticker-logo'
import type { ActiveEpisodeRow } from './types'
import type { MomentumStudioState } from './useMomentumStudio'

/**
 * 3rd column:
 *  - Default / no focus: all live ACTIVE episodes app-wide
 *  - Entity selected: that ticker’s episodes (active + history)
 */
export function ActiveEpisodesRail({
  studio,
}: {
  studio: MomentumStudioState
}) {
  const ticker = String(studio.activeTicker || '').toUpperCase()
  const focused = Boolean(studio.railEntityFocus && ticker)

  const assetName =
    studio.selected?.label ||
    studio.quote?.shortName ||
    studio.quote?.longName ||
    ticker
  const quote =
    studio.quote ||
    (ticker
      ? studio.quotes[ticker] || studio.quotes[ticker.toUpperCase()]
      : null)

  const entityEpisodes: ActiveEpisodeRow[] = focused
    ? studio.episodeHistory.filter(
        (e) => String(e.ticker || '').toUpperCase() === ticker,
      )
    : []

  // If history hasn't hydrated for this ticker yet, still show live ACTIVE
  const liveForTicker = studio.activeEpisodeForTicker
  const entityList =
    focused && entityEpisodes.length
      ? entityEpisodes
      : focused && liveForTicker
        ? [liveForTicker]
        : focused
          ? []
          : studio.activeEpisodes

  const showAllActives = !focused

  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-l bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">
            {showAllActives ? 'Active episodes' : 'Episodes'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {showAllActives
              ? `${studio.activeEpisodes.length} live`
              : `${entityList.length} for ${ticker || '—'}`}
          </p>
          {focused ? (
            <button
              type="button"
              className="mt-0.5 text-[10px] font-medium text-sky-600 hover:underline dark:text-sky-400"
              onClick={() => studio.clearRailEntityFocus()}
            >
              Show all active
            </button>
          ) : null}
        </div>
        {focused && ticker ? (
          <div className="flex min-w-0 max-w-[58%] items-center gap-2">
            <div className="min-w-0 text-right">
              <p className="truncate text-sm font-semibold leading-tight">
                {ticker}
              </p>
              {assetName && assetName !== ticker ? (
                <p className="truncate text-[10px] leading-tight text-muted-foreground">
                  {assetName}
                </p>
              ) : null}
            </div>
            <TickerLogo
              ticker={ticker}
              quote={quote}
              companyName={assetName}
            />
          </div>
        ) : (
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {studio.activeEpisodes.length}
          </Badge>
        )}
      </div>
      <Separator />

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {showAllActives ? (
            !studio.activeEpisodes.length ? (
              <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                No active episodes
              </p>
            ) : (
              studio.activeEpisodes.map((row) => (
                <EpisodeRowCard
                  key={`${row.ticker}-${row.episodeId || row.episodeNo}`}
                  row={row}
                  selected={
                    String(row.ticker || '').toUpperCase() === ticker
                  }
                  onSelect={() => studio.selectActiveEpisode(row)}
                />
              ))
            )
          ) : !entityList.length ? (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
              <p className="text-sm font-medium">No active episode</p>
              <p className="text-xs text-muted-foreground">
                {ticker} has no live or history episodes loaded yet.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void studio.loadEpisodeHistory({ refresh: true })
                }}
              >
                Refresh history
              </Button>
            </div>
          ) : (
            <>
              {!liveForTicker ? (
                <p className="rounded-md border border-dashed px-2 py-2 text-center text-[11px] text-muted-foreground">
                  No live ACTIVE episode for {ticker}
                </p>
              ) : null}
              {entityList.map((row) => (
                <EpisodeRowCard
                  key={`${row.episodeId || row.ticker}-${row.episodeNo || row.episodeStartedAt}`}
                  row={row}
                  selected={
                    String(row.status || '').toUpperCase() === 'ACTIVE'
                  }
                  onSelect={() => studio.selectActiveEpisode(row)}
                  showStatus
                />
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={() => {
                  const item = studio.tickers.find(
                    (t) => t.ticker.toUpperCase() === ticker,
                  )
                  if (item) studio.setAssetClass(item.assetClass)
                  studio.setView('watchlist')
                }}
              >
                Open {ticker} in watchlist
              </Button>
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

function EpisodeRowCard({
  row,
  selected,
  onSelect,
  showStatus,
}: {
  row: ActiveEpisodeRow
  selected?: boolean
  onSelect: () => void
  showStatus?: boolean
}) {
  const up = row.direction !== 'DOWN'
  const Trend = up ? IconTrendingUp : IconTrendingDown
  const isLive = String(row.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
  const move = row.currentMovePercent ?? row.peakMovePercent ?? null

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-foreground/20 bg-muted/50'
          : 'bg-background hover:bg-muted/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {row.ticker}
            <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
              {fmtEpisodeNo(row.episodeNo) || ''}
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {row.detectedWindow || '—'} · {fmtDateTime(row.episodeStartedAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {showStatus ? (
            <Badge variant={isLive ? 'default' : 'outline'} className="text-[10px]">
              {formatEpisodeState(row.status || row.state)}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 tabular-nums">
              <Trend className="size-3" />
              {fmtPct(move)}
            </Badge>
          )}
          {showStatus ? (
            <span className={cn('text-xs font-semibold tabular-nums', pctTone(move))}>
              {fmtPct(move)}
            </span>
          ) : null}
        </div>
      </div>
      {!showStatus ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {String(row.direction || '—')} · {formatEpisodeState(row.state || row.status)}
          {row.currentPrice != null ? ` · ${fmtPrice(row.currentPrice)}` : ''}
        </p>
      ) : null}
    </button>
  )
}
