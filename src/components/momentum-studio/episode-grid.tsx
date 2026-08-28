import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EpisodeCard } from './episode-card'
import type { ActiveEpisodeRow } from './types'
import type { MomentumStudioState } from './useMomentumStudio'

export function EpisodeGrid({
  studio,
  limit = 12,
}: {
  studio: MomentumStudioState
  limit?: number
}) {
  const loading =
    studio.episodeHistoryLoading &&
    !studio.episodeHistory.length &&
    !studio.activeEpisodes.length

  const rows = (
    studio.episodeHistory.length
      ? studio.episodeHistory.slice(0, limit)
      : studio.activeEpisodes
  ) as ActiveEpisodeRow[]

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="@container/card">
            <div className="space-y-3 p-4">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-48" />
            </div>
          </Card>
        ))}
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

  const activeTicker = String(studio.activeTicker || '').toUpperCase()

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-3 dark:*:data-[slot=card]:bg-card">
      {rows.map((row) => {
        const key = `${row.episodeId || row.ticker}-${row.episodeNo || row.episodeStartedAt}`
        const selected =
          String(row.ticker || '').toUpperCase() === activeTicker
        return (
          <EpisodeCard
            key={key}
            row={row}
            selected={selected}
            onSelect={() => studio.selectActiveEpisode(row)}
          />
        )
      })}
    </div>
  )
}
