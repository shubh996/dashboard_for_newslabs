import { Loader2, TrendingDown, TrendingUp } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { EpisodeTimeline } from './episode-timeline'
import {
  fmtDateTime,
  fmtEpisodeNo,
  fmtPct,
  fmtPrice,
  formatEpisodeState,
} from './format'
import { TickerLogo } from './ticker-logo'
import type { ActiveEpisodeRow } from './types'
import type { MomentumStudioState } from './useMomentumStudio'

/**
 * 3rd column:
 *  - Default / no focus: all live ACTIVE episodes app-wide
 *  - Entity selected: desk-style episode timeline for that ticker
 */
export function ActiveEpisodesRail({
  studio,
  className,
}: {
  studio: MomentumStudioState
  className?: string
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

  const liveForTicker = studio.activeEpisodeForTicker
  const showAllActives = !focused
  const statusForTicker =
    String(studio.status?.ticker || '').toUpperCase() === ticker
      ? studio.status
      : null

  return (
    <aside
      className={cn(
        'flex w-[24rem] shrink-0 flex-col border-l bg-background',
        className,
      )}
    >
      <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 px-4">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">
            {showAllActives ? 'Active episodes' : `${ticker} timeline`}
          </p>
          <p className="text-xs text-muted-foreground">
            {showAllActives
              ? `${studio.activeEpisodes.length} live`
              : 'Desk-style episode story'}
          </p>
          {focused ? (
            <button
              type="button"
              className="mt-0.5 text-xs font-medium text-primary hover:underline"
              onClick={() => studio.clearRailEntityFocus()}
            >
              Show all active
            </button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {showAllActives && studio.activeEpisodes.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={Boolean(studio.endingEpisodeTicker)}
              title="End all active episodes"
              onClick={() => void studio.endAllActiveEpisodes()}
            >
              {studio.endingEpisodeTicker ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Ending…
                </>
              ) : (
                'End all'
              )}
            </Button>
          ) : null}
          {focused && ticker ? (
            <div className="flex min-w-0 max-w-[58%] items-center gap-2">
              <div className="min-w-0 text-right">
                <p className="truncate text-sm font-semibold leading-tight">
                  {ticker}
                </p>
                {assetName && assetName !== ticker ? (
                  <p className="truncate text-xs leading-tight text-muted-foreground">
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
      </div>
      <Separator />

      {showAllActives ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 p-3">
            {!studio.activeEpisodes.length ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No active episodes
              </p>
            ) : (
              studio.activeEpisodes.map((row) => (
                <ActiveEpisodeRowCard
                  key={`${row.ticker}-${row.episodeId || row.episodeNo}`}
                  row={row}
                  selected={
                    String(row.ticker || '').toUpperCase() === ticker
                  }
                  onSelect={() => studio.selectActiveEpisode(row)}
                  onEnd={() => void studio.endActiveEpisode(row.ticker, row)}
                  ending={
                    studio.endingEpisodeTicker ===
                    String(row.ticker || '').toUpperCase()
                  }
                />
              ))
            )}
          </div>
        </ScrollArea>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <EpisodeTimeline
            status={statusForTicker}
            loading={studio.statusLoading}
            focusEpisodeId={studio.focusedEpisodeId}
            onEndActive={
              liveForTicker
                ? () => void studio.endActiveEpisode(ticker, liveForTicker)
                : undefined
            }
            ending={studio.endingEpisodeTicker === ticker}
          />
          <div className="shrink-0 border-t p-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
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
          </div>
        </div>
      )}
    </aside>
  )
}

export function ActiveEpisodeRowCard({
  row,
  selected,
  onSelect,
  onEnd,
  ending,
  showStatus,
}: {
  row: ActiveEpisodeRow
  selected?: boolean
  onSelect: () => void
  /** Shown on the right for live ACTIVE rows — ends tracking (no push). */
  onEnd?: () => void
  ending?: boolean
  showStatus?: boolean
}) {
  const up = row.direction !== 'DOWN'
  const Trend = up ? TrendingUp : TrendingDown
  const isLive = String(row.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
  const move = row.currentMovePercent ?? row.peakMovePercent ?? null
  const canEnd = Boolean(onEnd) && isLive

  return (
    <div
      className={cn(
        'w-full rounded-xl border bg-card px-3 py-2.5 shadow-xs transition-colors',
        selected
          ? 'border-foreground/20 bg-muted/50'
          : 'hover:bg-muted/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-semibold">
            {row.ticker}
            <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
              {fmtEpisodeNo(row.episodeNo) || ''}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.detectedWindow || '—'} · {fmtDateTime(row.episodeStartedAt)}
          </p>
          {!showStatus ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {String(row.direction || '—')} ·{' '}
              {formatEpisodeState(row.state || row.status)}
              {row.currentPrice != null
                ? ` · ${fmtPrice(row.currentPrice)}`
                : ''}
            </p>
          ) : null}
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {showStatus ? (
            <Badge
              variant={isLive ? 'default' : 'outline'}
              className="text-[10px]"
            >
              {formatEpisodeState(row.status || row.state)}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 tabular-nums">
              <Trend className="size-3" />
              {fmtPct(move)}
            </Badge>
          )}
          {showStatus ? (
            <span className="text-xs font-semibold tabular-nums">
              {fmtPct(move)}
            </span>
          ) : null}
          {canEnd ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={ending}
              title={`End active episode for ${row.ticker}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onEnd?.()
              }}
            >
              {ending ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Ending…
                </>
              ) : (
                'End'
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
