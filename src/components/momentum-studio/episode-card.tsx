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
import { cn } from '@/lib/utils'
import {
  fmtDateTime,
  fmtEpisodeNo,
  fmtPct,
  fmtPrice,
  formatEpisodeState,
} from './format'
import type { ActiveEpisodeRow } from './types'

export function EpisodeCard({
  row,
  selected,
  onSelect,
}: {
  row: ActiveEpisodeRow
  selected?: boolean
  onSelect: () => void
}) {
  const up = row.direction !== 'DOWN'
  const Trend = up ? TrendingUp : TrendingDown
  const isLive = String(row.status || '').toUpperCase() === 'ACTIVE'
  const move = row.currentMovePercent ?? row.peakMovePercent ?? null
  const episodeLabel = fmtEpisodeNo(row.episodeNo)

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected || undefined}
      className={cn(
        '@container/card cursor-pointer transition-colors outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-muted/40 ring-1 ring-foreground/15',
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <span className="font-medium text-foreground">{row.ticker}</span>
          {episodeLabel ? (
            <span className="text-muted-foreground">{episodeLabel}</span>
          ) : null}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {fmtPct(move)}
        </CardTitle>
        <CardAction>
          <Badge variant={isLive ? 'default' : 'outline'}>
            <Trend />
            {isLive ? 'Live' : formatEpisodeState(row.status || row.state)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <div className="line-clamp-1 flex gap-2 font-medium">
          {row.direction || '—'} · {formatEpisodeState(row.state || row.status)}
          <Trend className="size-4" />
        </div>
        <div className="text-muted-foreground">
          {row.detectedWindow || '—'}
          {row.currentPrice != null ? ` · ${fmtPrice(row.currentPrice)}` : ''}
          {' · '}
          {fmtDateTime(row.episodeStartedAt)}
        </div>
      </CardFooter>
    </Card>
  )
}
