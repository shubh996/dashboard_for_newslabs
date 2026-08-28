import { useMemo, useState } from 'react'
import {
  BellRing,
  ChevronDown,
  ChevronRight,
  Loader2,
  ScanSearch,
  Zap,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  eventLabel,
  fmtDateTime,
  fmtEpisodeNo,
  fmtPct,
  formatEpisodeState,
  pctTone,
} from './format'
import type { StudioEpisode, StudioEvent, StudioStatus } from './types'

type TimelineKind = 'backend' | 'perplexity' | 'alert'

type TimelineStep = {
  id: string
  kind: TimelineKind
  at?: string | null
  label: string
  movePercent?: number | null
  window?: string | null
  detail?: string | null
  direction?: string | null
  push?: boolean
}

type EpisodeGroup = {
  id: string
  episodeId?: string | null
  episodeNo?: number | null
  direction?: string | null
  status: string
  startedAt?: string | null
  endedAt?: string | null
  peakMovePercent?: number | null
  window?: string | null
  liveState?: string | null
  events: StudioEvent[]
}

function isStartType(type: string) {
  const t = type.toUpperCase()
  return t.includes('STARTED') || t.includes('EPISODE_START') || t === 'START'
}

function isEndType(type: string) {
  const t = type.toUpperCase()
  return (
    t.includes('ENDED') ||
    t.includes('EXPIRED') ||
    t.includes('CLOSED') ||
    t.includes('EXIT')
  )
}

function eventTime(ev: StudioEvent): number {
  const t = Date.parse(String(ev.detectedAt || ev.notifiedAt || ''))
  return Number.isFinite(t) ? t : 0
}

function buildGroups(
  episodes: StudioEpisode[] | null | undefined,
  events: StudioEvent[] | null | undefined,
  live: StudioEpisode | null | undefined,
): EpisodeGroup[] {
  const byId = new Map<string, EpisodeGroup>()
  const ordered: EpisodeGroup[] = []

  const ensure = (key: string, seed: Partial<EpisodeGroup>): EpisodeGroup => {
    let g = byId.get(key)
    if (!g) {
      g = {
        id: key,
        episodeId: seed.episodeId ?? null,
        episodeNo: seed.episodeNo ?? null,
        direction: seed.direction ?? null,
        status: seed.status || 'ACTIVE',
        startedAt: seed.startedAt ?? null,
        endedAt: seed.endedAt ?? null,
        peakMovePercent: seed.peakMovePercent ?? null,
        window: seed.window ?? null,
        liveState: seed.liveState ?? null,
        events: [],
      }
      byId.set(key, g)
      ordered.push(g)
    }
    return g
  }

  for (const ep of episodes || []) {
    const key =
      (ep.episodeId && `id:${ep.episodeId}`) ||
      (ep.episodeStartedAt && `start:${ep.episodeStartedAt}`) ||
      `ep:${ep.episodeNo || Math.random()}`
    const g = ensure(key, {
      episodeId: ep.episodeId,
      episodeNo: ep.episodeNo,
      direction: ep.direction,
      status: String(ep.status || 'ACTIVE').toUpperCase(),
      startedAt: ep.episodeStartedAt,
      peakMovePercent: ep.peakMovePercent,
      window: ep.detectedWindow,
      liveState: ep.state,
    })
    g.direction = g.direction || ep.direction
    g.episodeNo = g.episodeNo ?? ep.episodeNo
    g.peakMovePercent =
      g.peakMovePercent == null ? ep.peakMovePercent : g.peakMovePercent
    g.window = g.window || ep.detectedWindow
    if (String(ep.status || '').toUpperCase() === 'ACTIVE') {
      g.status = 'ACTIVE'
      g.liveState = ep.state || g.liveState
    }
  }

  const sortedEvents = [...(events || [])].sort(
    (a, b) => eventTime(a) - eventTime(b),
  )

  let current: EpisodeGroup | null = null
  for (const ev of sortedEvents) {
    const type = String(ev.eventType || '')
    const eid = ev.episodeId ? String(ev.episodeId) : ''
    if (eid && byId.has(`id:${eid}`)) {
      current = byId.get(`id:${eid}`) || null
    } else if (isStartType(type)) {
      const key = eid
        ? `id:${eid}`
        : `start:${ev.detectedAt || ev.notifiedAt || ordered.length}`
      current = ensure(key, {
        episodeId: eid || null,
        episodeNo: ev.episodeNo,
        direction: ev.direction,
        status: 'ACTIVE',
        startedAt: ev.detectedAt,
        window: ev.detectedWindow,
        liveState: ev.state,
      })
    } else if (!current && ordered.length) {
      current = ordered[ordered.length - 1]
    }
    if (!current) {
      current = ensure(`orphan:${ordered.length}`, {
        direction: ev.direction,
        status: 'ACTIVE',
        startedAt: ev.detectedAt,
        window: ev.detectedWindow,
      })
    }
    current.events.push(ev)
    if (ev.direction) current.direction = current.direction || ev.direction
    if (ev.episodeNo != null) current.episodeNo = current.episodeNo ?? ev.episodeNo
    if (ev.movePercent != null && Number.isFinite(Number(ev.movePercent))) {
      const abs = Math.abs(Number(ev.movePercent))
      const peak = Math.abs(Number(current.peakMovePercent || 0))
      if (abs >= peak) current.peakMovePercent = Number(ev.movePercent)
    }
    if (isEndType(type)) {
      current.status = 'ENDED'
      current.endedAt = ev.detectedAt || ev.notifiedAt || current.endedAt
    }
  }

  if (live) {
    const liveKey =
      (live.episodeId && `id:${live.episodeId}`) ||
      (live.episodeStartedAt && `start:${live.episodeStartedAt}`) ||
      'live'
    const existing =
      (live.episodeId && byId.get(`id:${live.episodeId}`)) ||
      ordered.find((g) => g.status === 'ACTIVE')
    if (existing) {
      existing.status = 'ACTIVE'
      existing.liveState = live.state || existing.liveState
      existing.peakMovePercent =
        live.peakMovePercent ?? existing.peakMovePercent
      existing.direction = live.direction || existing.direction
      existing.episodeNo = existing.episodeNo ?? live.episodeNo
    } else {
      ensure(liveKey, {
        episodeId: live.episodeId,
        episodeNo: live.episodeNo,
        direction: live.direction,
        status: 'ACTIVE',
        startedAt: live.episodeStartedAt,
        peakMovePercent: live.peakMovePercent,
        window: live.detectedWindow,
        liveState: live.state,
      })
    }
  }

  return ordered.sort((a, b) => {
    if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1
    if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1
    return eventTime({ detectedAt: b.startedAt || '' } as StudioEvent) -
      eventTime({ detectedAt: a.startedAt || '' } as StudioEvent)
  })
}

function buildSteps(events: StudioEvent[]): TimelineStep[] {
  const steps: TimelineStep[] = []
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]
    const type = String(ev.eventType || '')
    const upper = type.toUpperCase()

    if (upper.includes('RESEARCH')) {
      const running = upper.includes('RUNNING')
      const reason =
        (ev as { research?: { reason?: string; likely_driver?: string } })
          .research?.likely_driver ||
        (ev as { research?: { reason?: string } }).research?.reason ||
        ev.notification?.body ||
        null
      steps.push({
        id: `pplx-${i}-${ev.detectedAt}`,
        kind: 'perplexity',
        at: ev.detectedAt || ev.notifiedAt,
        label: running ? 'Perplexity researching…' : 'Perplexity research',
        detail: reason,
      })
      continue
    }

    if (upper.includes('ALERT_SENT') || ev.shouldNotify) {
      steps.push({
        id: `alert-${i}-${ev.notifiedAt || ev.detectedAt}`,
        kind: 'alert',
        at: ev.notifiedAt || ev.detectedAt,
        label: ev.notification?.title || 'Alert sent',
        detail: ev.notification?.body || null,
        push: true,
        movePercent: ev.movePercent,
        window: ev.detectedWindow,
        direction: ev.direction,
      })
      if (upper.includes('ALERT_SENT')) continue
    }

    steps.push({
      id: `ev-${i}-${ev.detectedAt}-${type}`,
      kind: 'backend',
      at: ev.detectedAt || ev.notifiedAt,
      label: eventLabel(ev.eventType) || type || 'Event',
      movePercent: ev.movePercent,
      window: ev.detectedWindow,
      direction: ev.direction,
      detail: ev.state ? formatEpisodeState(ev.state) : null,
      push: Boolean(ev.shouldNotify),
    })
  }
  return steps
}

function StepIcon({ kind }: { kind: TimelineKind }) {
  if (kind === 'perplexity') return <ScanSearch className="size-3.5" />
  if (kind === 'alert') return <BellRing className="size-3.5" />
  return <Zap className="size-3.5" />
}

export function EpisodeTimeline({
  status,
  loading,
  focusEpisodeId,
  onEndActive,
  ending,
}: {
  status: StudioStatus | null
  loading?: boolean
  focusEpisodeId?: string | null
  onEndActive?: () => void
  ending?: boolean
}) {
  const groups = useMemo(
    () => buildGroups(status?.episodes, status?.events, status?.episode),
    [status?.episodes, status?.events, status?.episode],
  )

  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})

  if (loading && !groups.length) {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-10 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading timeline…
      </div>
    )
  }

  if (!groups.length) {
    return (
      <p className="px-3 py-10 text-center text-xs text-muted-foreground">
        No episode timeline yet for this ticker.
      </p>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-3 p-2">
        <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Episode timeline
        </p>
        {groups.map((group) => {
          const isActive = group.status === 'ACTIVE'
          const defaultOpen =
            focusEpisodeId && group.episodeId
              ? group.episodeId === focusEpisodeId
              : isActive
          const open = openMap[group.id] ?? defaultOpen
          const steps = buildSteps(group.events)
          const epLabel = fmtEpisodeNo(group.episodeNo)
          const stateLabel = isActive
            ? formatEpisodeState(group.liveState || 'STARTED')
            : 'Ended'

          return (
            <Collapsible
              key={group.id}
              open={open}
              onOpenChange={(next) =>
                setOpenMap((prev) => ({ ...prev, [group.id]: next }))
              }
            >
              <div
                className={cn(
                  'rounded-xl border bg-card text-card-foreground shadow-sm',
                  isActive && 'ring-1 ring-border',
                )}
              >
                <div className="flex items-start gap-2 p-2.5">
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mt-0.5 size-7 shrink-0"
                      aria-label={open ? 'Collapse episode' : 'Expand episode'}
                    >
                      {open ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {epLabel ? (
                        <span className="font-mono text-xs font-semibold tabular-nums">
                          {epLabel}
                        </span>
                      ) : null}
                      <Badge
                        variant="outline"
                        className={cn(
                          'px-1.5 text-[10px]',
                          group.direction === 'UP'
                            ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                            : 'border-rose-500/30 text-rose-700 dark:text-rose-400',
                        )}
                      >
                        {group.direction || '—'}
                      </Badge>
                      <Badge
                        variant={isActive ? 'default' : 'secondary'}
                        className="px-1.5 text-[10px]"
                      >
                        {stateLabel}
                      </Badge>
                      <span
                        className={cn(
                          'ml-auto text-xs font-semibold tabular-nums',
                          pctTone(group.peakMovePercent),
                        )}
                      >
                        {fmtPct(group.peakMovePercent)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {group.window || '—'} · {fmtDateTime(group.startedAt)}
                      {group.endedAt ? ` → ${fmtDateTime(group.endedAt)}` : ''}
                    </p>
                  </div>
                  {isActive && onEndActive ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={ending}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onEndActive()
                      }}
                    >
                      {ending ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        'End'
                      )}
                    </Button>
                  ) : null}
                </div>

                <CollapsibleContent>
                  <Separator />
                  <div className="relative space-y-0 px-3 py-3">
                    {!steps.length ? (
                      <p className="px-1 py-4 text-center text-[11px] text-muted-foreground">
                        No timeline steps yet.
                      </p>
                    ) : (
                      steps.map((step, idx) => (
                        <div key={step.id} className="relative flex gap-3 pb-4 last:pb-0">
                          {idx < steps.length - 1 ? (
                            <span className="absolute top-7 bottom-0 left-[13px] w-px bg-border" />
                          ) : null}
                          <span
                            className={cn(
                              'relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
                              step.kind === 'perplexity'
                                ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                                : step.kind === 'alert'
                                  ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                                  : step.direction === 'UP'
                                    ? 'bg-emerald-500/15 text-emerald-700'
                                    : step.direction === 'DOWN'
                                      ? 'bg-rose-500/15 text-rose-700'
                                      : 'bg-muted text-muted-foreground',
                            )}
                          >
                            <StepIcon kind={step.kind} />
                          </span>
                          <div className="min-w-0 flex-1 pt-0.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <p className="text-[12px] font-medium leading-tight">
                                {step.label}
                              </p>
                              {step.movePercent != null ? (
                                <span
                                  className={cn(
                                    'text-[11px] font-semibold tabular-nums',
                                    pctTone(step.movePercent),
                                  )}
                                >
                                  {fmtPct(step.movePercent)}
                                </span>
                              ) : null}
                              {step.push ? (
                                <Badge variant="outline" className="px-1 text-[9px]">
                                  Push
                                </Badge>
                              ) : null}
                              <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                                {fmtDateTime(step.at)}
                              </span>
                            </div>
                            {step.window ? (
                              <p className="text-[10px] text-muted-foreground">
                                Window {step.window}
                              </p>
                            ) : null}
                            {step.detail ? (
                              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                                {step.detail}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )
        })}
      </div>
    </ScrollArea>
  )
}
