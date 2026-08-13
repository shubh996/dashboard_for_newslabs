/**
 * Developer debug panel for multi-ticker momentum engine.
 * Home-tab only · left status + collapsible right activity log.
 * Every watchlist tab gets live quote, chart, rolling returns, episode, logs.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import {
  BellRing,
  Bitcoin,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  DollarSign,
  ExternalLink,
  LineChart,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  Trash2,
  Users,
  Wheat,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { YahooInteractiveChart } from '@/components/yahoo/YahooInteractiveChart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  fetchYahooQuote,
  fetchYahooQuotes,
  resolveYahooLogoUrl,
  searchYahooSaved,
  type YahooLiveQuote,
} from '@/services/yahooApi'
import type { YahooSearchResult } from '@/types/yahoo'
import {
  normalizeYahooMarketState,
  resolveYahooActiveSession,
  yahooSessionKey,
  yahooSessionLabel,
} from '@/lib/yahooMarketSession'

type ReturnsMap = {
  '1m'?: number | null
  '5m'?: number | null
  '10m'?: number | null
  '15m'?: number | null
  '30m'?: number | null
  '45m'?: number | null
  '60m'?: number | null
  '90m'?: number | null
  '2h'?: number | null
  '3h'?: number | null
  '5h'?: number | null
  '6h'?: number | null
  '8h'?: number | null
  '10h'?: number | null
  '12h'?: number | null
  '15h'?: number | null
  '16h'?: number | null
  '18h'?: number | null
  '20h'?: number | null
  '24h'?: number | null
  '1w'?: number | null
  '10d'?: number | null
  '15d'?: number | null
  '1M'?: number | null
  '3M'?: number | null
  '6M'?: number | null
  YTD?: number | null
  '1y'?: number | null
  '30h'?: number | null
  '40h'?: number | null
  '50h'?: number | null
  day?: number | null
  [key: string]: number | null | undefined
}

type Episode = {
  direction: 'UP' | 'DOWN'
  episodeStartedAt: string
  detectedWindow: string
  initialMovePercent: number
  peakMovePercent: number
  currentMovePercent: number
  lastAlertMovePercent: number
  lastAlertAt: string
  currentPrice: number
  status: string
  belowThresholdSince?: string | null
  /** V1 state machine: STARTED | ACCELERATING | HOLDING | WEAKENING | … */
  state?: string
  episodeId?: string
  lastNotifiedEpisodeMovePct?: number
  referencePrice?: number | null
  referenceTime?: string | null
  triggerPrice?: number | null
}

/** Perplexity research payload attached to a timeline event */
type EventResearch = {
  status?: 'running' | 'done' | 'error' | string | null
  reason?: string | null
  likely_driver?: string | null
  secondary_driver?: string | null
  provider?: string | null
  model?: string | null
  citations?: string[]
  search_results?: Array<{
    title?: string | null
    url?: string | null
    source?: string | null
    snippet?: string | null
  }>
  startedAt?: string | null
  completedAt?: string | null
  cost_usd_display?: string | null
  error?: boolean
}

type MomentumEvent = {
  eventType: string
  direction: string
  movePercent: number
  detectedWindow?: string
  detectedAt: string
  /** When push was actually attempted/sent (after backend event) */
  notifiedAt?: string | null
  price?: number
  marketSession?: string
  shouldNotify?: boolean
  reason?: string
  /** Backend V1 state label on MOMENTUM_STATE / accel rows */
  state?: string
  previousState?: string
  /** Measure context (from episode engine) */
  referencePrice?: number | null
  referenceTime?: string | null
  peakPrice?: number | null
  peakMovePercent?: number | null
  troughPrice?: number | null
  lastNotifiedPrice?: number | null
  lastNotifiedEpisodeMovePct?: number | null
  lastNotifiedTime?: string | null
  initialMovePercent?: number | null
  episodeStartPrice?: number | null
  triggerPrice?: number | null
  givebackRatio?: number | null
  extensionPp?: number | null
  measureNote?: string | null
  episodeId?: string | null
  notification?: { title?: string; body?: string } | null
  pushResult?: {
    ok?: boolean
    skipped?: boolean
    reason?: string | null
    sent_ok?: number
    sent_failed?: number
    recipient_count?: number
    at?: string
    source?: string
    errors?: unknown[]
    dry_run?: boolean
    device_ids?: string[]
    forced_allowlist?: boolean
    recipients?: Array<{
      device_id?: string | null
      expo_push_token?: string
      expo_push_token_masked?: string
      forced?: boolean
      status?: string
      ticket_id?: string | null
      error?: string | null
    }>
    tickets?: Array<{
      status?: string
      device_id?: string | null
      to?: string | null
      message?: string | null
    }>
  } | null
  /** Perplexity research findings (manual research or attached) */
  research?: EventResearch | null
  likely_driver?: string | null
}

/** One momentum episode with its events nested under it. */
type EpisodeEventGroup = {
  id: string
  direction: string
  startedAt: string
  endedAt: string | null
  status: 'ACTIVE' | 'ENDED'
  peakMovePercent: number
  window: string
  events: MomentumEvent[]
  /** Live V1 state when this group is the active episode */
  liveState?: string | null
}

/** Human labels for episode state machine (Recent Events rail). */
function formatEpisodeState(state: string | null | undefined): string {
  const s = String(state || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
  const map: Record<string, string> = {
    STARTED: 'Started',
    ACCELERATING: 'Accelerating',
    RE_ACCELERATING: 'Re-accelerating',
    HOLDING: 'Holding',
    WEAKENING: 'Weakening',
    STRONGLY_WEAKENING: 'Strongly weakening',
    REVERSAL: 'Reversal',
    REVERSED: 'Reversed',
    EXPIRED: 'Expired',
    ACTIVE: 'Active',
    ENDED: 'Ended',
  }
  if (map[s]) return map[s]
  if (!s) return ''
  return s
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Recent-events rail only cares about ≤24h windows (incl. 24h + day/PRE).
 * Multi-day (1w, 10d, 1M, …) is excluded.
 */
function isIntradayOr24hEventWindow(key: string | null | undefined): boolean {
  const k = String(key || '').trim()
  if (!k || k === '—') return false
  if (k === '24h' || k === 'day') return true
  if (
    k === '1w' ||
    k === '10d' ||
    k === '15d' ||
    k === '1M' ||
    k === '3M' ||
    k === '6M' ||
    k === 'YTD' ||
    k === '1y' ||
    k === '30h' ||
    k === '40h' ||
    k === '50h'
  ) {
    return false
  }
  const h = k.match(/^(\d+(?:\.\d+)?)h$/i)
  if (h) return Number(h[1]) <= 24
  const m = k.match(/^(\d+)m$/i)
  if (m) return Number(m[1]) > 0 && Number(m[1]) <= 24 * 60
  return false
}

/** Research / alert markers always belong on the rail (even without a window). */
function isTimelineEventIncluded(ev: MomentumEvent): boolean {
  const type = String(ev.eventType || '')
  if (
    type === 'MOMENTUM_RESEARCH_DONE' ||
    type === 'MOMENTUM_RESEARCH_RUNNING' ||
    type.includes('RESEARCH') ||
    type === 'MOMENTUM_ALERT_SENT' ||
    type.endsWith('_ALERT_SENT')
  ) {
    return true
  }
  return isIntradayOr24hEventWindow(ev.detectedWindow)
}

/** Plain-English explain for a single timeline event (prices + % math). */
function buildEventMeasureExplain(
  ev: MomentumEvent,
  opts?: {
    assetClass?: string | null
    currency?: string | null
    liveEpisode?: Episode | null
  },
): {
  title: string
  summary: string
  rows: Array<{ label: string; value: string }>
  formula: string | null
  note: string | null
} {
  const type = String(ev.eventType || '')
  const ep = opts?.liveEpisode
  const refP =
    ev.referencePrice ??
    ep?.referencePrice ??
    null
  const liveP = ev.price ?? ep?.currentPrice ?? null
  const move = Number(ev.movePercent)
  const dir = ev.direction === 'DOWN' ? 'DOWN' : 'UP'
  const window = ev.detectedWindow || ep?.detectedWindow || '—'
  const label = shortEventType(type, ev)
  const fmtP = (n: number | null | undefined) =>
    n != null && Number.isFinite(Number(n))
      ? fmtPrice(Number(n), opts?.assetClass, opts?.currency)
      : '—'

  const rows: Array<{ label: string; value: string }> = [
    { label: 'When', value: fmtDateTime(ev.detectedAt) || fmtTime(ev.detectedAt) },
    { label: 'Window', value: String(window) },
    { label: 'Direction', value: dir },
    { label: 'Live / event price', value: fmtP(liveP) },
  ]

  if (refP != null && Number.isFinite(Number(refP))) {
    rows.push({
      label: 'Compared to (reference)',
      value: `${fmtP(refP)}${
        ev.referenceTime || ep?.referenceTime
          ? ` · ${fmtDateTime(ev.referenceTime || ep?.referenceTime) || ''}`
          : ''
      }`,
    })
  }
  if (ev.triggerPrice != null) {
    rows.push({ label: 'Trigger price', value: fmtP(ev.triggerPrice) })
  }
  if (ev.episodeStartPrice != null) {
    rows.push({ label: 'Episode start price', value: fmtP(ev.episodeStartPrice) })
  }
  if (Number.isFinite(move)) {
    rows.push({ label: 'Episode move %', value: fmtPct(move) })
  }
  const peakP =
    ev.peakPrice != null && Number.isFinite(Number(ev.peakPrice))
      ? Number(ev.peakPrice)
      : null
  const troughP =
    ev.troughPrice != null && Number.isFinite(Number(ev.troughPrice))
      ? Number(ev.troughPrice)
      : null
  if (ev.peakMovePercent != null && Number.isFinite(Number(ev.peakMovePercent))) {
    rows.push({
      label: 'Peak move (episode)',
      value: `${fmtPct(Number(ev.peakMovePercent))}${
        peakP != null ? ` · ${fmtP(peakP)}` : ''
      }`,
    })
  }
  if (ev.lastNotifiedEpisodeMovePct != null && Number.isFinite(Number(ev.lastNotifiedEpisodeMovePct))) {
    rows.push({
      label: 'Last alert move',
      value: `${fmtPct(Number(ev.lastNotifiedEpisodeMovePct))}${
        ev.lastNotifiedPrice != null ? ` · ${fmtP(ev.lastNotifiedPrice)}` : ''
      }`,
    })
  }
  if (ev.extensionPp != null && Number.isFinite(Number(ev.extensionPp))) {
    rows.push({
      label: 'Extension vs last alert',
      value: `${Number(ev.extensionPp) >= 0 ? '+' : ''}${Number(ev.extensionPp).toFixed(2)} pp`,
    })
  }
  if (ev.givebackRatio != null && Number.isFinite(Number(ev.givebackRatio))) {
    rows.push({
      label: 'Giveback',
      value: `${(Number(ev.givebackRatio) * 100).toFixed(1)}% of peak/trough move from reference`,
    })
  }
  if (ev.previousState || ev.state) {
    rows.push({
      label: 'State change',
      value: `${formatEpisodeState(ev.previousState) || '—'} → ${formatEpisodeState(ev.state || ev.reason) || label}`,
    })
  }

  const stRaw = String(ev.state || ev.reason || '').toUpperCase()
  const isGivebackState =
    (type === 'MOMENTUM_STATE' || type.endsWith('_STATE')) &&
    (stRaw === 'HOLDING' ||
      stRaw === 'WEAKENING' ||
      stRaw === 'STRONGLY_WEAKENING' ||
      label === 'Holding' ||
      label === 'Weakening' ||
      label === 'Strongly weakening')

  let formula: string | null = null
  if (
    isGivebackState &&
    liveP != null &&
    Number.isFinite(Number(liveP)) &&
    refP != null &&
    Number.isFinite(Number(refP))
  ) {
    // UP: (peak − live) / (peak − ref); DOWN: (live − trough) / (ref − trough)
    if (dir === 'UP' && peakP != null && peakP !== Number(refP)) {
      const gb = ((peakP - Number(liveP)) / (peakP - Number(refP))) * 100
      formula = `((${fmtP(peakP)} − ${fmtP(liveP)}) ÷ (${fmtP(peakP)} − ${fmtP(refP)})) × 100 ≈ ${Number.isFinite(gb) ? `${gb.toFixed(1)}% giveback` : '—'}`
    } else if (dir === 'DOWN' && troughP != null && troughP !== Number(refP)) {
      const gb = ((Number(liveP) - troughP) / (Number(refP) - troughP)) * 100
      formula = `((${fmtP(liveP)} − ${fmtP(troughP)}) ÷ (${fmtP(refP)} − ${fmtP(troughP)})) × 100 ≈ ${Number.isFinite(gb) ? `${gb.toFixed(1)}% giveback` : '—'}`
    } else if (ev.givebackRatio != null && Number.isFinite(Number(ev.givebackRatio))) {
      formula = `Giveback ≈ ${(Number(ev.givebackRatio) * 100).toFixed(1)}% (peak/trough vs reference)`
    }
  } else if (
    liveP != null &&
    Number.isFinite(Number(liveP)) &&
    refP != null &&
    Number.isFinite(Number(refP)) &&
    Number(refP) !== 0
  ) {
    const calc = ((Number(liveP) - Number(refP)) / Number(refP)) * 100
    formula = `((${fmtP(liveP)} − ${fmtP(refP)}) ÷ ${fmtP(refP)}) × 100 ≈ ${fmtPct(calc)}`
  }

  let summary = ''
  if (type.includes('STARTED')) {
    summary = `Episode opened ${dir} because the ${window} rolling move hit its threshold. We compare the live price to the price ~${window} ago (reference), not necessarily yesterday’s close (unless window is “day”).`
  } else if (type.includes('ACCELERAT') && !type.includes('STATE')) {
    summary = `Move extended further ${dir === 'UP' ? 'up' : 'down'} past the last notified level (material acceleration, usually ≥1.5 pp). That is when another push can fire.`
  } else if (type === 'MOMENTUM_STATE' || type.endsWith('_STATE')) {
    const st = formatEpisodeState(ev.state || ev.reason) || label
    if (st === 'Holding') {
      summary =
        'Holding means the episode is still open and giveback from the peak (UP) or trough (DOWN) is small — the move has not faded enough to call Weakening. Tiny price ticks (+0.03 pp) stay Holding; they are not Re-accelerating.'
    } else if (st === 'Weakening' || st === 'Strongly weakening') {
      summary =
        'Weakening means a meaningful share of the peak move (from reference to peak) has been given back. Only after this fade can a later bounce be called Re-accelerating.'
    } else if (st === 'Re-accelerating') {
      summary =
        'Re-accelerating means strength is returning after Weakening (a real fade). It is not used for small new highs while still Holding.'
    } else if (st === 'Accelerating') {
      summary =
        'Accelerating means the move is extending from Holding/Started without needing a prior fade. Push still needs ~+1.5 pp beyond the last alert.'
    } else {
      summary = `Internal state became “${st}”. This is dashboard-only (no push).`
    }
  } else if (type.includes('REVER')) {
    summary = `Original move was erased (price back through reference) and the opposite direction crossed a threshold — episode reversed.`
  } else if (type.includes('ENDED') || type.includes('EXPIR')) {
    summary = `Episode closed (${formatEpisodeState(ev.reason) || 'ended'}). No longer tracking this leg for accelerate alerts.`
  } else {
    summary = `Event “${label}” recorded on the episode timeline.`
  }

  return {
    title: label,
    summary,
    rows,
    formula,
    note: ev.measureNote || null,
  }
}

/**
 * Group flat momentum events into episodes (STARTED → … → ENDED).
 * Newest episode first. Events stay chronological inside; the rail
 * re-sorts display steps newest-first (latest top, oldest bottom).
 */
function groupEventsByEpisode(events: MomentumEvent[] | null | undefined): EpisodeEventGroup[] {
  if (!events?.length) return []
  const filtered = events.filter(isTimelineEventIncluded)
  if (!filtered.length) return []
  const chronological = [...filtered].sort(
    (a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt),
  )
  const groups: EpisodeEventGroup[] = []
  let current: EpisodeEventGroup | null = null

  for (const ev of chronological) {
    const type = String(ev.eventType || '')
    const isMarker =
      type === 'MOMENTUM_RESEARCH_DONE' ||
      type === 'MOMENTUM_RESEARCH_RUNNING' ||
      type.includes('RESEARCH') ||
      type === 'MOMENTUM_ALERT_SENT' ||
      type.endsWith('_ALERT_SENT')
    const isStart = type === 'MOMENTUM_STARTED' || type.endsWith('_STARTED')
    const isEnd =
      type === 'MOMENTUM_ENDED' ||
      type === 'MOMENTUM_REVERSED' ||
      type.endsWith('_ENDED')

    // Markers attach to the open episode; never open a new group alone
    if (isMarker) {
      if (current) {
        current.events.push(ev)
      } else if (groups.length > 0) {
        // Attach to most recently closed episode if no open one
        groups[groups.length - 1].events.push(ev)
      } else {
        // Orphan marker — still show under a synthetic shell
        current = {
          id: `marker-${ev.detectedAt}-${groups.length}`,
          direction: ev.direction || 'UP',
          startedAt: ev.detectedAt,
          endedAt: null,
          status: 'ACTIVE',
          peakMovePercent: Number(ev.movePercent) || 0,
          window: ev.detectedWindow || '—',
          events: [ev],
        }
      }
      continue
    }

    if (isStart || !current) {
      if (current) {
        groups.push(current)
      }
      current = {
        id: `${ev.detectedAt}-${ev.direction}-${groups.length}`,
        direction: ev.direction,
        startedAt: ev.detectedAt,
        endedAt: null,
        status: 'ACTIVE',
        peakMovePercent: Number(ev.movePercent) || 0,
        window: ev.detectedWindow || '—',
        events: [ev],
      }
      if (isEnd) {
        current.endedAt = ev.detectedAt
        current.status = 'ENDED'
        groups.push(current)
        current = null
      }
      continue
    }

    current.events.push(ev)
    if (
      Number.isFinite(ev.movePercent) &&
      Math.abs(ev.movePercent) > Math.abs(current.peakMovePercent)
    ) {
      current.peakMovePercent = ev.movePercent
    }
    if (ev.detectedWindow && ev.detectedWindow !== '—') {
      current.window = ev.detectedWindow
    }
    if (isEnd) {
      current.endedAt = ev.detectedAt
      current.status = 'ENDED'
      groups.push(current)
      current = null
    }
  }
  if (current) groups.push(current)

  // Newest episode first; keep events chronological (oldest first) inside
  return groups.reverse()
}

function shortEventType(
  eventType: string | null | undefined,
  event?: MomentumEvent | null,
): string {
  const type = String(eventType || '')
  // Silent state-machine rows (Holding / Weakening / Re-accelerating …)
  if (
    type === 'MOMENTUM_STATE' ||
    type === 'MOMENTUM_STATE_CHANGED' ||
    type.endsWith('_STATE')
  ) {
    return (
      formatEpisodeState(event?.state || event?.reason) || 'State'
    )
  }
  if (type === 'MOMENTUM_STARTED' || type.endsWith('_STARTED')) return 'Started'
  if (type === 'MOMENTUM_ACCELERATING' || type.includes('ACCELERAT')) {
    const st = String(event?.state || '').toUpperCase()
    if (st === 'RE_ACCELERATING') return 'Re-accelerating'
    return 'Accelerating'
  }
  if (type === 'MOMENTUM_REVERSED') return 'Reversal'
  if (type === 'MOMENTUM_RESEARCH_RUNNING') return 'Perplexity running'
  if (type === 'MOMENTUM_RESEARCH_DONE' || type.includes('RESEARCH')) {
    const st = String(event?.research?.status || '').toLowerCase()
    if (st === 'running') return 'Perplexity running'
    if (st === 'error') return 'Perplexity failed'
    return 'Perplexity done'
  }
  if (type === 'MOMENTUM_ALERT_SENT' || type.endsWith('_ALERT_SENT')) {
    return 'Alert sent'
  }
  if (type === 'MOMENTUM_ENDED' || type.endsWith('_ENDED')) {
    const reason = String(event?.reason || '').toUpperCase()
    if (reason === 'EXPIRED') return 'Expired'
    if (reason === 'MARKET_CLOSE') return 'Market close'
    if (reason === 'REVERSAL') return 'Ended (reversal)'
    if (reason === 'INACTIVITY') return 'Ended (cool-off)'
    if (reason === 'MANUAL' || reason === 'USER_EXIT') return 'Ended (manual)'
    return 'Ended'
  }
  return type.replace(/^MOMENTUM_/, '').replace(/_/g, ' ')
}

function extractEventResearch(ev: MomentumEvent): EventResearch | null {
  if (ev.research && (ev.research.reason || ev.research.likely_driver)) {
    return {
      ...ev.research,
      reason: ev.research.reason || ev.reason || null,
      likely_driver:
        ev.research.likely_driver || ev.likely_driver || null,
    }
  }
  const type = String(ev.eventType || '')
  if (
    (type.includes('RESEARCH') || ev.likely_driver) &&
    (ev.reason || ev.likely_driver)
  ) {
    return {
      reason: ev.reason || null,
      likely_driver: ev.likely_driver || null,
      provider: 'perplexity',
      completedAt: ev.detectedAt,
    }
  }
  return null
}

/**
 * Expand stored events into display steps.
 * Perplexity only matters for STARTED (reason before start alert).
 * Accel / holding / state rows never get a research step.
 * Output is newest-first (latest at top, oldest at bottom).
 */
type TimelineStep =
  | {
      id: string
      kind: 'backend'
      ev: MomentumEvent
      label: string
      isStateOnly: boolean
    }
  | {
      id: string
      kind: 'perplexity'
      ev: MomentumEvent
      at: string
      research: EventResearch
    }
  | {
      id: string
      kind: 'alert'
      ev: MomentumEvent
      at: string
      notification: { title?: string; body?: string } | null
    }

function isStartEventType(eventType: string | null | undefined): boolean {
  const type = String(eventType || '')
  return type === 'MOMENTUM_STARTED' || type.endsWith('_STARTED')
}

/** Later in the pipeline ranks higher for same-timestamp newest-first sort. */
function timelineStepPipelineRank(kind: TimelineStep['kind']): number {
  if (kind === 'alert') return 2
  if (kind === 'perplexity') return 1
  return 0
}

function timelineStepTimeMs(step: TimelineStep): number {
  const iso =
    step.kind === 'backend' ? step.ev.detectedAt : step.at
  const t = Date.parse(String(iso || ''))
  return Number.isFinite(t) ? t : 0
}

function buildTimelineSteps(events: MomentumEvent[]): TimelineStep[] {
  const steps: TimelineStep[] = []
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]
    const type = String(ev.eventType || '')
    const isResearchRunning =
      type === 'MOMENTUM_RESEARCH_RUNNING' ||
      String(ev.research?.status || '').toLowerCase() === 'running'
    const isResearch =
      type === 'MOMENTUM_RESEARCH_DONE' ||
      type === 'MOMENTUM_RESEARCH_RUNNING' ||
      type.includes('RESEARCH')
    const isAlertMarker =
      type === 'MOMENTUM_ALERT_SENT' || type.endsWith('_ALERT_SENT')

    if (isResearch) {
      const research =
        extractEventResearch(ev) ||
        (isResearchRunning
          ? {
              status: 'running' as const,
              reason: 'Researching likely driver…',
              provider: 'perplexity',
              startedAt: ev.detectedAt,
            }
          : null)
      if (research) {
        steps.push({
          id: `pplx-${ev.detectedAt}-${i}`,
          kind: 'perplexity',
          ev,
          at:
            research.completedAt ||
            research.startedAt ||
            ev.detectedAt,
          research: {
            ...research,
            status:
              research.status ||
              (isResearchRunning ? 'running' : 'done'),
          },
        })
      }
      continue
    }

    if (isAlertMarker) {
      steps.push({
        id: `alert-${ev.notifiedAt || ev.detectedAt}-${i}`,
        kind: 'alert',
        ev,
        at: ev.notifiedAt || ev.pushResult?.at || ev.detectedAt,
        notification: ev.notification || null,
      })
      continue
    }

    const isStateOnly =
      type === 'MOMENTUM_STATE' ||
      type === 'MOMENTUM_STATE_CHANGED' ||
      type.endsWith('_STATE')
    const isStart = isStartEventType(type)

    steps.push({
      id: `ev-${ev.detectedAt}-${type}-${i}`,
      kind: 'backend',
      ev,
      label: shortEventType(type, ev),
      isStateOnly,
    })

    // STARTED only: attach research when present (reason for the start)
    if (isStart) {
      const research = extractEventResearch(ev)
      if (research) {
        steps.push({
          id: `pplx-from-${ev.detectedAt}-${i}`,
          kind: 'perplexity',
          ev,
          at: research.completedAt || ev.detectedAt,
          research,
        })
      }
    }

    // Push-worthy → Alert row (accel / reverse / manual start alert).
    // Never invent Perplexity for accelerating / holding / state.
    if (ev.shouldNotify) {
      steps.push({
        id: `alert-from-${ev.notifiedAt || ev.detectedAt}-${i}`,
        kind: 'alert',
        ev,
        at: ev.notifiedAt || ev.pushResult?.at || ev.detectedAt,
        notification: ev.notification || null,
      })
    }
  }

  // Latest at top, oldest at bottom
  steps.sort((a, b) => {
    const tb = timelineStepTimeMs(b)
    const ta = timelineStepTimeMs(a)
    if (tb !== ta) return tb - ta
    return (
      timelineStepPipelineRank(b.kind) - timelineStepPipelineRank(a.kind)
    )
  })
  return steps
}

type EpisodeExplainSections = {
  start: string
  during: string | null
  end: string
  howMeasured: string
  formula: string | null
  numbers: string | null
  lookingFor: { title: string; body: string }[]
  statusNote: string
}

function buildEpisodeExplainSections(
  group: EpisodeEventGroup,
  opts?: { accelPoints?: number | null; inactivityMinutes?: number | null },
): EpisodeExplainSections {
  const chronological = [...group.events].sort(
    (a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt),
  )
  const startEv =
    chronological.find(
      (e) =>
        e.eventType === 'MOMENTUM_STARTED' ||
        String(e.eventType).endsWith('_STARTED'),
    ) || chronological[0]
  const endEv = chronological.find(
    (e) =>
      e.eventType === 'MOMENTUM_ENDED' ||
      e.eventType === 'MOMENTUM_REVERSED' ||
      String(e.eventType).endsWith('_ENDED'),
  )
  const accelEvents = chronological.filter((e) =>
    String(e.eventType).includes('ACCELERAT'),
  )
  const dirWord = group.direction === 'UP' ? 'up' : 'down'
  const oppWord = group.direction === 'UP' ? 'down' : 'up'
  const startWin = startEv?.detectedWindow || group.window || '30m'
  const startPct =
    startEv != null && Number.isFinite(startEv.movePercent)
      ? fmtPct(startEv.movePercent)
      : null
  const move = startEv?.movePercent ?? group.peakMovePercent
  const price = startEv?.price
  const accel =
    opts?.accelPoints != null && Number.isFinite(opts.accelPoints)
      ? opts.accelPoints
      : 2
  const inactivity =
    opts?.inactivityMinutes != null && Number.isFinite(opts.inactivityMinutes)
      ? opts.inactivityMinutes
      : 30
  const peak = group.peakMovePercent
  const nextAccelTarget = Number.isFinite(peak)
    ? peak + (group.direction === 'UP' ? accel : -accel)
    : null

  const start = startPct
    ? `The stock began an ${group.direction} episode after it moved ${dirWord} by ${startPct} on the ${startWin} rolling window (enough to cross the alert threshold).`
    : `The stock began an ${group.direction} episode on the ${startWin} rolling window after a threshold cross.`

  let during: string | null = null
  if (accelEvents.length > 0) {
    during = `While open, the move got stronger ${accelEvents.length} more time${
      accelEvents.length === 1 ? '' : 's'
    } (acceleration). Peak so far: ${fmtPct(group.peakMovePercent)}.`
  } else if (group.status === 'ACTIVE') {
    during =
      'No acceleration alert yet — the move has not stepped far enough beyond the last alert level.'
  }

  let end: string
  if (group.status === 'ACTIVE') {
    end =
      'Status: still ACTIVE. The episode has not cooled off or reversed yet.'
  } else if (endEv) {
    const endDir = endEv.direction === 'UP' ? 'up' : 'down'
    const endPct = Number.isFinite(endEv.movePercent)
      ? fmtPct(endEv.movePercent)
      : '—'
    end = `Status: ENDED. It closed when the move cooled or flipped (${endDir} ${endPct} on ${endEv.detectedWindow || '—'} at ${fmtTime(endEv.detectedAt)}).`
  } else {
    end = 'Status: ENDED.'
  }

  const howMeasured = `Rolling return compares the live price to the price about ${startWin} ago (last matching candle), not to yesterday’s close (unless the window is “day”). Formula: ((now − price ${startWin} ago) ÷ price ${startWin} ago) × 100.`

  let formula: string | null = null
  let numbers: string | null = null
  if (
    price != null &&
    Number.isFinite(price) &&
    Number.isFinite(move) &&
    move !== 0
  ) {
    const lookback = price / (1 + move / 100)
    if (Number.isFinite(lookback) && lookback > 0) {
      formula = `(($${price.toFixed(2)} − $${lookback.toFixed(2)}) ÷ $${lookback.toFixed(2)}) × 100 ≈ ${fmtPct(move)}`
      numbers = `Around ${fmtTime(startEv?.detectedAt || group.startedAt)}: price ~$${lookback.toFixed(2)} (${startWin} earlier) → ~$${price.toFixed(2)} (then). That ${fmtPct(move)} move on ${startWin} is what opened this ${group.direction} episode.`
    }
  }
  if (!numbers) {
    numbers = `If ${startWin} return is large enough while price is moving ${dirWord}, the engine starts an ${group.direction} episode and keeps tracking it.`
  }

  const lookingFor: { title: string; body: string }[] =
    group.status === 'ACTIVE'
      ? [
          {
            title: '1 · Acceleration',
            body: nextAccelTarget != null
              ? `Peak needs to move about +${accel} percentage points further ${dirWord} (past ~${fmtPct(nextAccelTarget)}) to fire another accelerate alert.`
              : `Peak needs about +${accel} percentage points further ${dirWord} vs the last alert to fire accelerate.`,
          },
          {
            title: '2 · Cool-off (end)',
            body: `If all short (≤24h) windows stay below their thresholds for ~${inactivity} minutes, the episode ends as a quiet cool-off.`,
          },
          {
            title: '3 · Reverse (end + new)',
            body: `A strong ${oppWord} threshold hit ends this episode and can start a new ${oppWord === 'up' ? 'UP' : 'DOWN'} episode the other way.`,
          },
        ]
      : [
          {
            title: 'Nothing more on this episode',
            body: 'This episode is closed. The engine only starts a new one if a ≤24h window crosses threshold again.',
          },
        ]

  const statusNote =
    group.status === 'ACTIVE'
      ? `Right now we are still in this ${group.direction} move (window ${group.window}, peak ${fmtPct(group.peakMovePercent)}).`
      : `This ${group.direction} episode is finished (window ${group.window}, peak ${fmtPct(group.peakMovePercent)}).`

  return {
    start,
    during,
    end,
    howMeasured,
    formula,
    numbers,
    lookingFor,
    statusNote,
  }
}

/** Collapsible plain-English explanation + example under an episode heading. */
function EpisodeExplainCollapse({
  group,
  accelPoints,
  inactivityMinutes,
}: {
  group: EpisodeEventGroup
  accelPoints?: number | null
  inactivityMinutes?: number | null
}) {
  const [open, setOpen] = useState(false)
  const sections = buildEpisodeExplainSections(group, {
    accelPoints,
    inactivityMinutes,
  })
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-expanded={open}
      >
        {open ? (
          <ChevronUp className="size-3" strokeWidth={2} />
        ) : (
          <ChevronDown className="size-3" strokeWidth={2} />
        )}
        {open ? 'Hide explanation' : 'Explain · example'}
      </button>
      {open ? (
        <div className="mt-1.5 space-y-0 overflow-hidden rounded-xl border border-border/70 bg-background/80 text-[11px] leading-snug">
          <div className="space-y-1.5 border-b border-border/60 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              1 · Story
            </p>
            <p className="text-foreground/90">{sections.start}</p>
            {sections.during ? (
              <p className="text-foreground/85">{sections.during}</p>
            ) : null}
            <p className="text-foreground/85">{sections.end}</p>
            <p className="text-muted-foreground">{sections.statusNote}</p>
          </div>

          <div className="space-y-1.5 border-b border-border/60 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              2 · How we measure it
            </p>
            <p className="text-foreground/85">{sections.howMeasured}</p>
            {sections.formula ? (
              <p className="rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[10px] leading-snug text-foreground/90">
                {sections.formula}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5 border-b border-border/60 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              3 · Example with numbers
            </p>
            <p className="text-foreground/85">{sections.numbers}</p>
          </div>

          <div className="space-y-2 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              4 · What we look for next
            </p>
            <ul className="space-y-2">
              {sections.lookingFor.map((item) => (
                <li key={item.title} className="min-w-0">
                  <p className="font-semibold text-foreground/90">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-foreground/80">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  )
}

type ActivityLog = {
  at: string
  level: string
  source: string
  message: string
  detail?: unknown
}

type ErrorDetail = {
  message: string
  at?: string | null
  source?: string | null
  name?: string | null
  code?: string | number | null
  stack?: string | null
  cause?: string | null
  httpStatus?: number | null
  endpoint?: string | null
  raw?: unknown
  /** Client-side additions */
  path?: string | null
  statusText?: string | null
  bodyText?: string | null
}

type UiError = {
  title: string
  message: string
  detail?: ErrorDetail | null
}

type ExactLookback = {
  windowKey: string
  windowMinutes: number | null
  exactMinutes: number
  exactLabel: string
  referencePrice: number | null
  referenceTime: string | null
  asOfTime: string | null
  movePercent: number | null
}

type AlertDevice = {
  device_id: string | null
  expo_push_token: string
  tickers?: string[]
  enabled_tickers?: string[]
  disabled_tickers?: string[]
  enabled?: boolean
  subscription_status?: string
  /** Set when merging Trigger + 9AM audience lists */
  app_key?: 'trigger' | 'nineam'
}

type MomentumStatus = {
  ticker: string
  lastFetchAt: string | null
  lastError: string | null
  lastErrorDetail?: ErrorDetail | null
  tickCount: number
  pollIntervalMs: number
  engineEnabled: boolean
  loopRunning: boolean
  pollMode?: string
  focusTicker?: string
  isFocus?: boolean
  watchedTickers?: string[]
  episode: Episode | null
  snapshot: {
    marketSession?: string
    currentPrice?: number
    previousClose?: number | null
    previousCloseTime?: string | null
    lastSessionKind?: string | null
    lastSessionLabel?: string | null
    lastSessionShortLabel?: string | null
    assetClass?: string | null
    regularPrice?: number | null
    marketState?: string | null
    marketStateLabel?: string | null
    isExtendedHours?: boolean
    showExtendedBadge?: boolean
    sessionBadge?: { code: string; label: string } | null
    sessionQuote?: {
      session?: string
      sessionLabel?: string
      marketStateLabel?: string
      previousCloseTime?: string | null
      lastSessionKind?: string | null
      lastSessionLabel?: string | null
      lastSessionShortLabel?: string | null
      assetClass?: string | null
      regular?: {
        price?: number | null
        changePercent?: number | null
        time?: string | null
      }
      preMarket?: {
        price?: number | null
        changePercent?: number | null
        time?: string | null
      }
      postMarket?: {
        price?: number | null
        changePercent?: number | null
        time?: string | null
      }
      live?: { price?: number | null; changePercent?: number | null }
    } | null
    returns?: ReturnsMap
    references?: Record<string, number | null | undefined>
    referenceTimes?: Record<string, string | null | undefined>
    exactLookbacks?: Record<string, ExactLookback | null | undefined>
    asOfTime?: string | null
    visibleReturnKeys?: string[]
    showBridgeWindows?: boolean
    strongestMomentum?: {
      window: string
      movePercent: number
      direction: string
    } | null
    strongestLastHourWindows?: {
      window: string
      movePercent: number
      direction: string
    } | null
    maxMoveLastHour?: {
      movePercent: number
      direction: string
      lookbackMinutes: number
      lookbackLabel: string
      referencePrice: number
      referenceTime: string
      asOfTime: string
      barsScanned: number
    } | null
    thresholdCrossed?: boolean
  } | null
  events: MomentumEvent[]
  logs?: ActivityLog[]
  config?: {
    thresholds?: { windows?: Record<string, number>; day?: number }
    thresholdSnapshot?: {
      windows: Record<string, number | null>
      day: number
      list: Array<{ key: string; minutes: number; threshold: number | null }>
    }
    accelerationPoints?: number
    inactivityMinutes?: number
    showBridgeWindows?: boolean
    visibleReturnKeys?: string[]
  }
}

/** UI rolling cards — short windows (incl. 10m / 45m) + multi-horizon + day. */
const RETURN_KEYS_ALL = [
  '1m',
  '5m',
  '10m',
  '15m',
  '30m',
  '45m',
  '60m',
  '90m',
  '3h',
  '6h',
  '8h',
  '16h',
  '24h',
  '1w',
  '10d',
  '15d',
  '1M',
  '3M',
  '6M',
  'YTD',
  '1y',
  'day',
] as const

const BRIDGE_KEYS = new Set(['30h', '40h', '50h'])

const THRESHOLD_EDIT_KEYS = [
  '5m',
  '10m',
  '15m',
  '30m',
  '45m',
  '60m',
  '90m',
  '3h',
  '6h',
  '8h',
  '16h',
  '24h',
  '1w',
  '10d',
  '15d',
  '1M',
  '3M',
  '6M',
  'YTD',
  '1y',
  'day',
] as const

const LOG_COLLAPSE_KEY = 'sndk-momentum-log-collapsed'
const RIGHT_RAIL_WIDTH_KEY = 'momentum-right-rail-width-v1'

function loadRightRailWidth(): number {
  try {
    const n = Number(localStorage.getItem(RIGHT_RAIL_WIDTH_KEY))
    if (Number.isFinite(n) && n >= 240 && n <= 520) return Math.round(n)
  } catch {
    /* ignore */
  }
  return 300
}

function saveRightRailWidth(px: number) {
  try {
    localStorage.setItem(RIGHT_RAIL_WIDTH_KEY, String(Math.round(px)))
  } catch {
    /* ignore */
  }
}
const WATCHLIST_KEY = 'momentum-watchlist-v2'
/** Last selected watch tab (Silver, SpaceX, …) — restored on load */
const ACTIVE_TICKER_KEY = 'momentum-active-ticker-v1'
/**
 * User-edited research prompt templates (INSTRUCTIONS + OUTPUT knowledge).
 * Keyed by asset class so equity/commodity/crypto edits stay separate.
 * Placeholders {{USER_MOVEMENT}} / {{INPUT_FACTS}} are refilled per alert.
 */
const RESEARCH_PROMPT_TEMPLATES_KEY = 'momentum-research-prompt-templates-v1'

function normalizePromptAssetClass(raw: string | null | undefined): string {
  const c = String(raw || 'equity')
    .trim()
    .toLowerCase()
  if (c === 'commodity' || c === 'commodities') return 'commodity'
  if (c === 'crypto' || c === 'cryptocurrency') return 'crypto'
  if (c === 'forex' || c === 'fx' || c === 'currency') return 'forex'
  if (c === 'index' || c === 'indices' || c === 'etf') return 'index'
  return 'equity'
}

function loadResearchPromptTemplates(): Record<string, string> {
  try {
    const raw = localStorage.getItem(RESEARCH_PROMPT_TEMPLATES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim()) {
        out[normalizePromptAssetClass(k)] = v
      }
    }
    return out
  } catch {
    return {}
  }
}

function loadResearchPromptTemplate(assetClass: string | null | undefined): string | null {
  const key = normalizePromptAssetClass(assetClass)
  const t = loadResearchPromptTemplates()[key]
  return t && t.trim() ? t : null
}

function saveResearchPromptTemplate(
  assetClass: string | null | undefined,
  template: string,
) {
  const key = normalizePromptAssetClass(assetClass)
  const trimmed = String(template || '').trim()
  if (!trimmed) return
  try {
    const all = loadResearchPromptTemplates()
    all[key] = trimmed
    localStorage.setItem(RESEARCH_PROMPT_TEMPLATES_KEY, JSON.stringify(all))
  } catch {
    /* ignore quota */
  }
}

function clearResearchPromptTemplate(assetClass: string | null | undefined) {
  const key = normalizePromptAssetClass(assetClass)
  try {
    const all = loadResearchPromptTemplates()
    delete all[key]
    localStorage.setItem(RESEARCH_PROMPT_TEMPLATES_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

/**
 * Convert a filled (possibly user-edited) prompt back into a reusable template
 * by restoring {{USER_MOVEMENT}} / {{INPUT_FACTS}} placeholders.
 */
function editedResearchPromptToTemplate(
  editedPrompt: string,
  userMovement: string | null | undefined,
  inputFacts: string | null | undefined,
): string {
  let t = String(editedPrompt || '').trim()
  if (!t) return ''
  const um = String(userMovement || '').trim()
  const facts = String(inputFacts || '').trim()

  if (um && t.includes(um)) {
    t = t.split(um).join('{{USER_MOVEMENT}}')
  }
  if (facts && t.includes(facts)) {
    t = t.split(facts).join('{{INPUT_FACTS}}')
  }

  // If user rewrote INPUT and placeholders are gone, keep their
  // INSTRUCTIONS/OUTPUT and re-attach canonical INPUT placeholders.
  if (!t.includes('{{USER_MOVEMENT}}') || !t.includes('{{INPUT_FACTS}}')) {
    const inputIdx = t.search(/\n##\s*INPUT\b/i)
    const head =
      inputIdx >= 0 ? t.slice(0, inputIdx).trimEnd() : t.trimEnd()
    t = [
      head,
      '',
      '## INPUT',
      'USER MOVEMENT:',
      '{{USER_MOVEMENT}}',
      '',
      'INPUT FACTS:',
      '{{INPUT_FACTS}}',
    ].join('\n')
  }
  return t
}

type WatchTab = {
  ticker: string
  label: string
  /** equity | crypto | commodity | forex | other */
  assetClass?: string
}

const DEFAULT_WATCHLIST: WatchTab[] = [
  { ticker: 'SNDK', label: 'SNDK', assetClass: 'equity' },
  { ticker: 'TSLA', label: 'SpaceX', assetClass: 'equity' },
  { ticker: 'AAPL', label: 'Apple', assetClass: 'equity' },
  { ticker: 'NVDA', label: 'NVIDIA', assetClass: 'equity' },
  { ticker: 'BTC-USD', label: 'Bitcoin', assetClass: 'crypto' },
  { ticker: 'ETH-USD', label: 'Ethereum', assetClass: 'crypto' },
  { ticker: 'GC=F', label: 'Gold', assetClass: 'commodity' },
  { ticker: 'SI=F', label: 'Silver', assetClass: 'commodity' },
  { ticker: 'CL=F', label: 'Crude Oil', assetClass: 'commodity' },
  { ticker: 'EURUSD=X', label: 'EUR/USD', assetClass: 'forex' },
]

/** Yahoo-friendly symbol: stocks, crypto (BTC-USD), futures (GC=F), FX (EURUSD=X), indices (^GSPC) */
function normalizeWatchTicker(raw: string): string {
  let s = String(raw || '').trim()
  if (!s) return ''
  // TradingView-style prefix
  if (s.includes(':') && !s.endsWith('=X') && !s.includes('://')) {
    s = s.split(':').pop() || s
  }
  s = s.toUpperCase().replace(/\s+/g, '')
  // Allow A-Z 0-9 . ^ _ - =
  s = s.replace(/[^A-Z0-9.^_\-=]/g, '')
  // Common aliases → Yahoo
  const aliases: Record<string, string> = {
    BTC: 'BTC-USD',
    BITCOIN: 'BTC-USD',
    ETH: 'ETH-USD',
    ETHEREUM: 'ETH-USD',
    SOL: 'SOL-USD',
    GOLD: 'GC=F',
    GC: 'GC=F',
    OIL: 'CL=F',
    CL: 'CL=F',
    SILVER: 'SI=F',
    SI: 'SI=F',
    EURUSD: 'EURUSD=X',
    GBPUSD: 'GBPUSD=X',
    USDJPY: 'USDJPY=X',
    SPX: '^GSPC',
    SP500: '^GSPC',
  }
  if (aliases[s]) return aliases[s]
  // Bare 6-letter FX pair → Yahoo =X
  if (/^[A-Z]{6}$/.test(s) && !s.includes('-') && !s.includes('=')) {
    return `${s}=X`
  }
  return s
}

function detectAssetClass(ticker: string): string {
  const t = ticker.toUpperCase()
  if (t.endsWith('-USD') || t.endsWith('-USDT') || /^(BTC|ETH|SOL|XRP|DOGE|ADA)/.test(t)) {
    return 'crypto'
  }
  if (t.endsWith('=X') || /^[A-Z]{6}=X$/.test(t)) return 'forex'
  if (t.endsWith('=F') || /^(GC|CL|SI|NG|HG|ZC|ZW)=F$/.test(t)) return 'commodity'
  if (t.startsWith('^')) return 'index'
  return 'equity'
}

/** Left-rail filter: icon-only pills */
const ASSET_CLASS_TABS: {
  id: 'equity' | 'forex' | 'crypto' | 'commodity'
  label: string
  Icon: LucideIcon
}[] = [
  { id: 'equity', label: 'Stocks', Icon: LineChart },
  { id: 'forex', label: 'Forex', Icon: DollarSign },
  { id: 'crypto', label: 'Crypto', Icon: Bitcoin },
  { id: 'commodity', label: 'Commodities', Icon: Wheat },
]

type AssetClassTabId = (typeof ASSET_CLASS_TABS)[number]['id']

const ASSET_CLASS_FILTER_KEY = 'momentum-asset-class-filter-v1'

function loadAssetClassFilter(): AssetClassTabId {
  try {
    const raw = localStorage.getItem(ASSET_CLASS_FILTER_KEY)
    if (raw && ASSET_CLASS_TABS.some((t) => t.id === raw)) {
      return raw as AssetClassTabId
    }
  } catch {
    /* ignore */
  }
  return 'equity'
}

function saveAssetClassFilter(id: AssetClassTabId) {
  try {
    localStorage.setItem(ASSET_CLASS_FILTER_KEY, id)
  } catch {
    /* ignore */
  }
}

function tabAssetClass(tab: WatchTab): string {
  const raw = String(tab.assetClass || detectAssetClass(tab.ticker) || 'equity')
    .trim()
    .toLowerCase()
  if (raw === 'stock' || raw === 'stocks' || raw === 'equity') return 'equity'
  if (raw === 'forex' || raw === 'fx' || raw === 'currency') return 'forex'
  if (raw === 'crypto' || raw === 'cryptocurrency') return 'crypto'
  if (raw === 'commodity' || raw === 'commodities' || raw === 'future') {
    return 'commodity'
  }
  // Indexes/ETFs roll into Stocks tab for filter UI
  if (raw === 'index' || raw === 'indices' || raw === 'etf') return 'equity'
  return 'equity'
}

function assetClassBadge(assetClass?: string) {
  switch (assetClass) {
    case 'crypto':
      return 'bg-amber-500/15 text-amber-900'
    case 'commodity':
      return 'bg-yellow-600/15 text-yellow-900'
    case 'forex':
      return 'bg-sky-500/15 text-sky-900'
    case 'index':
      return 'bg-violet-500/15 text-violet-900'
    case 'etf':
      return 'bg-indigo-500/15 text-indigo-900'
    case 'future':
      return 'bg-orange-500/15 text-orange-900'
    default:
      return 'bg-emerald-500/10 text-emerald-900'
  }
}

/** Map Yahoo quoteType + symbol → UI asset class */
function assetClassFromSearch(row: YahooSearchResult): string {
  const type = String(row.quoteType || '').toUpperCase()
  const t = String(row.ticker || '').toUpperCase()
  if (type.includes('CRYPTO') || t.endsWith('-USD') || t.endsWith('-USDT')) return 'crypto'
  if (type.includes('CURRENCY') || type.includes('FX') || t.endsWith('=X')) return 'forex'
  if (type.includes('FUTURE') || t.endsWith('=F')) return 'commodity'
  if (type.includes('ETF') || type.includes('FUND') || type.includes('MUTUAL')) return 'etf'
  if (type.includes('INDEX') || t.startsWith('^')) return 'index'
  if (type.includes('EQUITY') || type.includes('STOCK')) return 'equity'
  return detectAssetClass(t)
}

function quoteTypeLabel(row: YahooSearchResult): string {
  const raw = String(row.quoteType || '').trim()
  if (raw) return raw
  const cls = assetClassFromSearch(row)
  if (cls === 'commodity') return 'Future'
  if (cls === 'forex') return 'Currency'
  if (cls === 'crypto') return 'Cryptocurrency'
  if (cls === 'etf') return 'ETF'
  if (cls === 'index') return 'Index'
  return 'Equity'
}

const QUICK_ADDS: WatchTab[] = [
  { ticker: 'BTC-USD', label: 'Bitcoin', assetClass: 'crypto' },
  { ticker: 'ETH-USD', label: 'Ethereum', assetClass: 'crypto' },
  { ticker: 'SOL-USD', label: 'Solana', assetClass: 'crypto' },
  { ticker: 'GC=F', label: 'Gold', assetClass: 'commodity' },
  { ticker: 'CL=F', label: 'Crude', assetClass: 'commodity' },
  { ticker: 'SI=F', label: 'Silver', assetClass: 'commodity' },
  { ticker: 'EURUSD=X', label: 'EUR/USD', assetClass: 'forex' },
  { ticker: 'GBPUSD=X', label: 'GBP/USD', assetClass: 'forex' },
  { ticker: 'USDJPY=X', label: 'USD/JPY', assetClass: 'forex' },
]

function loadWatchlist(): WatchTab[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    if (!raw) return DEFAULT_WATCHLIST
    const parsed = JSON.parse(raw) as WatchTab[]
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_WATCHLIST
    return parsed
      .map((row) => {
        const ticker = normalizeWatchTicker(String(row.ticker || ''))
        if (!ticker) return null
        return {
          ticker,
          label: String(row.label || ticker).trim() || ticker,
          assetClass: row.assetClass || detectAssetClass(ticker),
        }
      })
      .filter((row): row is WatchTab => Boolean(row))
  } catch {
    return DEFAULT_WATCHLIST
  }
}

function saveWatchlist(list: WatchTab[]) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

function loadActiveTicker(list: WatchTab[]): string {
  try {
    const saved = localStorage.getItem(ACTIVE_TICKER_KEY)
    if (saved && list.some((t) => t.ticker === saved)) return saved
  } catch {
    /* ignore */
  }
  return list[0]?.ticker || 'SNDK'
}

function saveActiveTicker(ticker: string) {
  try {
    localStorage.setItem(ACTIVE_TICKER_KEY, ticker)
  } catch {
    /* ignore */
  }
}

/** Yahoo Finance quote page for a symbol (GC=F → …/quote/GC%3DF). */
function yahooFinanceQuoteUrl(symbol: string): string {
  const s = String(symbol || '').trim()
  if (!s) return 'https://finance.yahoo.com/'
  return `https://finance.yahoo.com/quote/${encodeURIComponent(s)}`
}

/** Yahoo history page — best place to verify previous close prints. */
function yahooFinanceHistoryUrl(symbol: string): string {
  const s = String(symbol || '').trim()
  if (!s) return 'https://finance.yahoo.com/'
  return `https://finance.yahoo.com/quote/${encodeURIComponent(s)}/history`
}

/**
 * Last-session meta by asset class (mirrors server/momentum/candles.js).
 * Stocks: prior 4pm ET RTH · Futures: prior 5pm ET Globex day · Crypto: prior UTC day · FX: prior 5pm ET.
 */
function resolveLastSessionMetaClient(
  symbol: string,
  assetClass?: string | null,
  nowMs = Date.now(),
): {
  timeIso: string | null
  kind: string
  label: string
  shortLabel: string
} {
  const t = String(symbol || '').toUpperCase()
  const cls = assetClass || detectAssetClass(t)

  const weekdayEtBoundary = (hourEt: number): string | null => {
    try {
      for (let back = 0; back < 12; back += 1) {
        const probe = new Date(nowMs - back * 86400000)
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          weekday: 'short',
        }).formatToParts(probe)
        const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
        const wd = get('weekday')
        if (wd === 'Sat' || wd === 'Sun') continue
        let hour = Number(get('hour'))
        if (hour === 24) hour = 0
        const minute = Number(get('minute'))
        if (back === 0 && hour * 60 + minute < hourEt * 60) continue
        const y = get('year')
        const mo = get('month')
        const d = get('day')
        let utc = Date.parse(
          `${y}-${mo}-${d}T${String(hourEt + 5).padStart(2, '0')}:00:00.000Z`,
        )
        for (let i = 0; i < 4; i += 1) {
          const p2 = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).formatToParts(new Date(utc))
          const g2 = (type: string) => p2.find((p) => p.type === type)?.value || ''
          let h2 = Number(g2('hour'))
          if (h2 === 24) h2 = 0
          const m2 = Number(g2('minute'))
          const dayOk = g2('year') === y && g2('month') === mo && g2('day') === d
          if (!dayOk) {
            const want = Date.parse(`${y}-${mo}-${d}T12:00:00.000Z`)
            const got = Date.parse(
              `${g2('year')}-${g2('month')}-${g2('day')}T12:00:00.000Z`,
            )
            if (Number.isFinite(want) && Number.isFinite(got)) utc += want - got
          }
          const adj = (hourEt * 60 - (h2 * 60 + m2)) * 60 * 1000
          if (adj === 0 && dayOk) break
          utc += adj
        }
        if (utc < nowMs - 30_000) return new Date(utc).toISOString()
      }
    } catch {
      /* ignore */
    }
    return new Date(nowMs - 86400000).toISOString()
  }

  if (cls === 'crypto' || /-USD$/.test(t)) {
    const d = new Date(nowMs)
    d.setUTCHours(0, 0, 0, 0)
    d.setUTCDate(d.getUTCDate() - 1)
    return {
      timeIso: d.toISOString(),
      kind: 'crypto_day',
      label: 'Prior UTC day close',
      shortLabel: 'Prior day',
    }
  }
  if (cls === 'commodity') {
    return {
      timeIso: weekdayEtBoundary(17),
      kind: 'futures_daily',
      label: 'Last futures session (≈5pm ET)',
      shortLabel: 'Last session',
    }
  }
  if (cls === 'forex') {
    return {
      timeIso: weekdayEtBoundary(17),
      kind: 'fx_day',
      label: 'Prior NY FX close (≈5pm ET)',
      shortLabel: 'Prior day',
    }
  }
  return {
    timeIso: weekdayEtBoundary(16),
    kind: 'rth',
    label: 'Prior regular close (4pm ET)',
    shortLabel: 'Previous close',
  }
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

/** Format print by asset class (FX needs more decimals; no $ for pure pairs). */
function fmtPrice(
  n: number | null | undefined,
  assetClass?: string,
  currency?: string | null,
) {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  let decimals = 2
  if (assetClass === 'forex') decimals = abs < 10 ? 5 : 4
  else if (assetClass === 'crypto' && abs < 1) decimals = 4
  else if (assetClass === 'commodity' && abs < 10) decimals = 3
  const body = n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  if (assetClass === 'forex') return body
  const cur = (currency || 'USD').toUpperCase()
  if (cur === 'USD' || cur === 'USDW') return `$${body}`
  return `${body} ${cur}`
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return iso
  }
}

/** Date + time for previous close / session prints (ET-friendly local string). */
function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return String(iso)
  }
}

/** Short clock only — e.g. 9:42 PM (no full date) */
function fmtClock(iso: string | null | undefined) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return null
  }
}

/** Compact date + time — e.g. Mar 11 · 1:27 PM */
function fmtDateClock(iso: string | null | undefined) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return null
  }
}

/**
 * Yahoo Finance marketState (official) — source of truth for labels + price fields:
 *   PRE      → Pre-market  → preMarket*
 *   PREPRE   → Overnight   → postMarket*  (no separate overnight* in API)
 *   POST     → After-hours → postMarket*
 *   POSTPOST → After-hours → postMarket*
 *   REGULAR  → Regular     → regularMarket*
 *   CLOSED   → closed      → regularMarket* (At close)
 */
type YahooClientSession =
  | 'PRE'
  | 'PREPRE'
  | 'POST'
  | 'POSTPOST'
  | 'REGULAR'
  | 'CLOSED'

function resolveClientMarketSession(
  marketState?: string | null,
  engineSession?: string | null,
  _nowMs = Date.now(),
): YahooClientSession {
  const state = String(marketState || '').trim().toUpperCase()
  if (state === 'PRE') return 'PRE'
  if (state === 'PREPRE') return 'PREPRE'
  if (state === 'POST') return 'POST'
  if (state === 'POSTPOST') return 'POSTPOST'
  if (state === 'REGULAR' || state === 'OPEN') return 'REGULAR'
  if (state === 'CLOSED' || state === 'CLOSE') return 'CLOSED'

  // Engine fallback only when Yahoo marketState missing
  const eng = String(engineSession || '').trim().toUpperCase()
  if (eng === 'PRE' || eng === 'PREPRE' || eng === 'POST' || eng === 'POSTPOST' || eng === 'REGULAR' || eng === 'CLOSED') {
    return eng as YahooClientSession
  }
  return 'CLOSED'
}

/** Label next to Live (…): matches Yahoo quote page wording */
function liveSessionBracket(
  badge: { code: string; label: string } | null | undefined,
  marketSession?: string | null,
  marketStateLabel?: string | null,
): string {
  const sess = String(marketSession || '').toUpperCase()
  if (sess === 'PRE') return 'pre-market'
  if (sess === 'PREPRE') return 'overnight'
  if (sess === 'POST' || sess === 'POSTPOST') return 'after-hours'
  if (sess === 'REGULAR') return 'regular'
  if (sess === 'CLOSED') return 'closed'
  if (badge?.code === 'PREPRE') return 'overnight'
  if (badge?.code === 'POST' || badge?.code === 'POSTPOST') return 'after-hours'
  if (badge?.code === 'PRE') return 'pre-market'
  if (badge?.code === 'CLOSED' || badge?.code === 'CLOSE') return 'closed'
  if (marketStateLabel) {
    const low = marketStateLabel.toLowerCase()
    if (/overnight|prepre/.test(low)) return 'overnight'
    if (/after|post/.test(low)) return 'after-hours'
    if (/pre-?market|^pre$/.test(low)) return 'pre-market'
    if (/closed|close/.test(low)) return 'closed'
    if (/regular/.test(low)) return 'regular'
    return low
  }
  return 'live'
}

function pctColor(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return 'text-muted-foreground'
  if (n > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (n < 0) return 'text-rose-600 dark:text-rose-400'
  return 'text-muted-foreground'
}

/** Continuous blink when absolute move is above this % */
const HOT_BLINK_PCT = 3

function isHotMove(n: number | null | undefined, threshold = HOT_BLINK_PCT) {
  return n != null && Number.isFinite(n) && Math.abs(n) >= threshold
}

/** True for rolling windows ≤24h (incl. 24h) — these blink non-stop when hot. */
function isSub24hOr24hWindow(key: string | null | undefined): boolean {
  if (!key) return true // live / watchlist day % — treat as continuous
  if (key === '24h') return true
  // Multi-day / long horizon: finite blink only
  if (
    key === '1w' ||
    key === '10d' ||
    key === '15d' ||
    key === '1M' ||
    key === '3M' ||
    key === '6M' ||
    key === 'YTD' ||
    key === '1y' ||
    key === '30h' ||
    key === '40h' ||
    key === '50h'
  ) {
    return false
  }
  // day / PRE etc. = session move → continuous
  if (key === 'day') return true
  const mins = minutesFromReturnKey(key)
  if (mins != null) return mins <= 1440
  return true
}

function hotBlinkClass(
  n: number | null | undefined,
  threshold = HOT_BLINK_PCT,
  windowKey?: string | null,
) {
  if (!isHotMove(n, threshold)) return undefined
  const base = n! > 0 ? 'sndk-hot-up-blink' : 'sndk-hot-down-blink'
  if (isSub24hOr24hWindow(windowKey)) {
    return `${base} sndk-hot-blink-loop`
  }
  return base
}

/** Tab strip only: first word of company/name label (full name stays on title + hover). */
function tabBarFirstWord(label: string | null | undefined, fallback = ''): string {
  const raw = String(label || fallback || '').trim()
  if (!raw) return fallback || '—'
  // Keep slash pairs like EUR/USD as one token
  const first = raw.split(/\s+/)[0] || raw
  return first
}

/** Watchlist secondary name — max 2 words (full name stays on title/hover). */
function companyNameTwoWords(label: string | null | undefined): string {
  const raw = String(label || '').trim()
  if (!raw) return ''
  const words = raw.split(/\s+/).filter(Boolean)
  return words.slice(0, 2).join(' ')
}

/**
 * Yahoo Finance “basis close” for session day % (what live change is measured vs).
 * PRE / POST / PREPRE / CLOSED: frozen regularMarketPrice = last RTH / at-close print
 *   (Yahoo preMarketChange* / postMarketChange* are vs this — not regularMarketPreviousClose).
 * REGULAR: regularMarketPreviousClose (Yahoo’s “Previous Close” key stat).
 */
function quotePreviousClose(q: YahooLiveQuote | null | undefined): number | null {
  if (!q) return null
  const state = String(q.marketState || '').toUpperCase()
  const reg = q.regularMarketPrice
  const prev = q.regularMarketPreviousClose
  const isExtended =
    state === 'PRE' ||
    state === 'PREPRE' ||
    state === 'POST' ||
    state === 'POSTPOST' ||
    state === 'CLOSED'
  if (isExtended && reg != null && Number.isFinite(Number(reg))) return Number(reg)
  if (prev != null && Number.isFinite(Number(prev))) return Number(prev)
  if (reg != null && Number.isFinite(Number(reg))) return Number(reg)
  return null
}

/**
 * Close *before* the displayed previous close (Yahoo: regularMarketPreviousClose
 * when previous close is the frozen last RTH print in PRE/POST/CLOSED).
 */
function quotePriorOfPreviousClose(
  q: YahooLiveQuote | null | undefined,
): number | null {
  if (!q) return null
  const state = String(q.marketState || '').toUpperCase()
  const reg = q.regularMarketPrice
  const prev = q.regularMarketPreviousClose
  const isExtended =
    state === 'PRE' ||
    state === 'PREPRE' ||
    state === 'POST' ||
    state === 'POSTPOST' ||
    state === 'CLOSED'
  // Extended: last close = reg (frozen), prior-of-that = regularMarketPreviousClose
  if (
    isExtended &&
    reg != null &&
    Number.isFinite(Number(reg)) &&
    prev != null &&
    Number.isFinite(Number(prev)) &&
    Number(prev) !== 0
  ) {
    return Number(prev)
  }
  return null
}

/**
 * % next to Previous Close = how that close moved vs the close before it
 * (not live vs previous close).
 * PRE example: last RTH 506.06 vs prior 499.99 → +1.21% (Yahoo regularMarketChange%).
 */
function quotePreviousCloseDayPercent(
  q: YahooLiveQuote | null | undefined,
): number | null {
  if (!q) return null
  const lastClose = quotePreviousClose(q)
  const priorClose = quotePriorOfPreviousClose(q)
  if (
    lastClose != null &&
    priorClose != null &&
    Number.isFinite(lastClose) &&
    Number.isFinite(priorClose) &&
    priorClose !== 0
  ) {
    return ((lastClose - priorClose) / priorClose) * 100
  }
  // Extended hours: Yahoo’s regular change % is exactly last-session move
  const state = String(q.marketState || '').toUpperCase()
  const isExtended =
    state === 'PRE' ||
    state === 'PREPRE' ||
    state === 'POST' ||
    state === 'POSTPOST' ||
    state === 'CLOSED'
  if (isExtended && q.regularMarketChangePercent != null) {
    const n = Number(q.regularMarketChangePercent)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Live print from Yahoo quote fields for current marketState. */
function quoteLivePrice(q: YahooLiveQuote | null | undefined): number | null {
  if (!q) return null
  const state = String(q.marketState || '').toUpperCase()
  if (state === 'PRE' && q.preMarketPrice != null && Number.isFinite(Number(q.preMarketPrice))) {
    return Number(q.preMarketPrice)
  }
  if (
    (state === 'POST' || state === 'POSTPOST' || state === 'PREPRE') &&
    q.postMarketPrice != null &&
    Number.isFinite(Number(q.postMarketPrice))
  ) {
    return Number(q.postMarketPrice)
  }
  // CLOSED with residual AH print
  if (
    state === 'CLOSED' &&
    q.postMarketPrice != null &&
    Number.isFinite(Number(q.postMarketPrice))
  ) {
    return Number(q.postMarketPrice)
  }
  if (q.regularMarketPrice != null && Number.isFinite(Number(q.regularMarketPrice))) {
    return Number(q.regularMarketPrice)
  }
  if (q.preMarketPrice != null && Number.isFinite(Number(q.preMarketPrice))) {
    return Number(q.preMarketPrice)
  }
  if (q.postMarketPrice != null && Number.isFinite(Number(q.postMarketPrice))) {
    return Number(q.postMarketPrice)
  }
  return null
}

/**
 * Yahoo Finance session change % fields only (same source as finance.yahoo.com).
 * PRE → preMarketChangePercent · POST/PREPRE → postMarketChangePercent · else regular.
 */
function quoteYahooSessionChangePercent(
  q: YahooLiveQuote | null | undefined,
): number | null {
  if (!q) return null
  const state = String(q.marketState || '').toUpperCase()
  if (state === 'PRE' && q.preMarketChangePercent != null) {
    const n = Number(q.preMarketChangePercent)
    return Number.isFinite(n) ? n : null
  }
  if (
    (state === 'POST' || state === 'POSTPOST' || state === 'PREPRE') &&
    q.postMarketChangePercent != null
  ) {
    const n = Number(q.postMarketChangePercent)
    return Number.isFinite(n) ? n : null
  }
  if (state === 'CLOSED' && q.postMarketChangePercent != null) {
    const n = Number(q.postMarketChangePercent)
    return Number.isFinite(n) ? n : null
  }
  if (q.regularMarketChangePercent != null) {
    const n = Number(q.regularMarketChangePercent)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function pctFromPrices(
  price: number | null | undefined,
  prev: number | null | undefined,
): number | null {
  if (
    price == null ||
    prev == null ||
    !Number.isFinite(price) ||
    !Number.isFinite(prev) ||
    prev === 0
  ) {
    return null
  }
  return ((price - prev) / prev) * 100
}

/** Day/session % — Yahoo fields first, then price math vs Yahoo previous close. */
function quoteChangePercent(q: YahooLiveQuote | null | undefined): number | null {
  if (!q) return null
  const yahooPct = quoteYahooSessionChangePercent(q)
  if (yahooPct != null) return yahooPct
  return pctFromPrices(quoteLivePrice(q), quotePreviousClose(q))
}

function returnKeyDisplayLabel(key: string, marketSession?: string | null) {
  if (key === '1w') return '1w'
  if (key === '10d') return '10d'
  if (key === '15d') return '15d'
  if (key === '1M') return '1M'
  if (key === '3M') return '3M'
  if (key === '6M') return '6M'
  if (key === 'YTD') return 'YTD'
  if (key === '1y') return '1y'
  if (key === '6h' || key === '8h' || key === '16h') return key
  if (key !== 'day') return key
  const s = String(marketSession || '').toUpperCase()
  if (s === 'PRE') return 'PRE'
  if (s === 'PREPRE') return 'OVERNIGHT'
  if (s === 'POST' || s === 'POSTPOST') return 'POST'
  // Day = live vs previous regular-session close (Yahoo previous close)
  return '1 day'
}

function deviceKey(d: AlertDevice) {
  return d.device_id || d.expo_push_token
}

/** Build default push title/body from a rolling-return window + exact minutes. */
function buildMomentumAlertCopy(opts: {
  companyName: string
  ticker: string
  windowKey: string
  movePercent: number | null | undefined
  exact: ExactLookback | null | undefined
  marketSession?: string | null
}) {
  const { companyName, ticker, windowKey, movePercent, exact, marketSession } = opts
  const name = (companyName || ticker || 'Stock').trim()
  const pct = movePercent != null && Number.isFinite(movePercent) ? movePercent : null
  const abs = pct != null ? Math.abs(pct) : null
  const dirWord =
    pct == null ? 'moved' : pct > 0 ? 'moved up' : pct < 0 ? 'moved down' : 'was flat'
  const pctStr = abs != null ? `${abs.toFixed(2)}%` : '—'
  const arrow = pct == null ? '' : pct > 0 ? '↑' : pct < 0 ? '↓' : ''

  const windowLabel = returnKeyDisplayLabel(windowKey, marketSession)
  const exactLabel =
    exact?.exactLabel ||
    (windowKey === 'day' ? 'since previous close' : `the ${windowLabel} window`)
  const exactMins = exact?.exactMinutes
  const bucketNote =
    exactMins != null &&
    exact?.windowMinutes != null &&
    Math.abs(exactMins - exact.windowMinutes) >= 2
      ? ` (bucket ${windowLabel}, exact ${exact.exactLabel})`
      : ''

  const title =
    pct != null
      ? `${name} ${arrow} ${pct > 0 ? '+' : pct < 0 ? '−' : ''}${abs!.toFixed(2)}%`.replace(
          '−−',
          '−',
        )
      : `${name} · ${windowLabel}`

  let timePhrase: string
  if (windowKey === 'day') {
    timePhrase =
      exactMins != null && exactMins > 0
        ? `in the last ${exact.exactLabel} (since previous close)`
        : 'vs previous regular close'
  } else if (exactMins != null) {
    timePhrase = `in the last ${exact.exactLabel}${bucketNote}`
  } else {
    timePhrase = `over the ${windowLabel} lookback`
  }

  const body = `${name} ${dirWord} ${pctStr} ${timePhrase}.`

  return { title, body, exactLabel, exactMinutes: exactMins ?? null, windowLabel }
}

/** Format live clock for a timezone (UK / US Eastern). */
/**
 * Yahoo marketState → center-clock status (null → show loader).
 * PREPRE = Overnight (postMarket*); no clock invent.
 */
function usEquityMarketStatusFromYahoo(
  marketState?: string | null,
): { label: string; short: string; tone: 'open' | 'pre' | 'post' | 'overnight' | 'closed' } | null {
  const state = normalizeYahooMarketState(marketState)
  if (!state) return null
  const short = yahooSessionLabel(state)
  if (!short) return null
  const key = yahooSessionKey(state)
  const tone =
    key === 'regular'
      ? 'open'
      : key === 'premarket'
        ? 'pre'
        : key === 'after-hours'
          ? 'post'
          : key === 'overnight'
            ? 'overnight'
            : 'closed'
  return { label: short, short, tone }
}

function marketStatusToneClass(tone: string) {
  switch (tone) {
    case 'open':
      return 'text-emerald-700 dark:text-emerald-400'
    case 'pre':
      return 'text-sky-700 dark:text-sky-400'
    case 'post':
      return 'text-amber-700 dark:text-amber-400'
    case 'overnight':
      return 'text-violet-700 dark:text-violet-400'
    default:
      return 'text-[#6B7280]'
  }
}

/** Perplexity brand mark (user-provided asset · black + alpha) */
function PerplexityLogo({ className }: { className?: string }) {
  return (
    <img
      src="/icons/perplexity.png"
      alt=""
      width={16}
      height={16}
      draggable={false}
      className={cn(
        'inline-block size-4 shrink-0 object-contain dark:invert',
        className,
      )}
      aria-hidden
    />
  )
}

/** TradingView monochrome mark (Simple Icons path) */
function TradingViewLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('inline-block size-4 shrink-0', className)}
      aria-hidden
    >
      <path d="M15.67 0H8.33a.6.6 0 0 0-.58.44L.01 21.54a.6.6 0 0 0 .58.76h7.35a.6.6 0 0 0 .58-.44l2.76-9.21 2.76 9.21a.6.6 0 0 0 .58.44h7.35a.6.6 0 0 0 .58-.76L16.25.44A.6.6 0 0 0 15.67 0z" />
    </svg>
  )
}

function tradingViewSymbolUrl(ticker: string) {
  const t = String(ticker || '')
    .trim()
    .toUpperCase()
  // Chart deep-link works for equities / most Yahoo symbols
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(t)}`
}

/** Best-effort company logo: TradingView CDN slug → Yahoo/IEX chain */
function companyLogoCandidates(
  ticker: string,
  companyName?: string | null,
  quote?: YahooLiveQuote | null,
): string[] {
  const out: string[] = []
  const name = String(companyName || quote?.longName || quote?.shortName || '')
    .trim()
    .toLowerCase()
  const slug = name
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-inc$|-corp$|-corporation$|-ltd$|-plc$|-co$/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug) {
    out.push(`https://s3-symbol-logo.tradingview.com/${slug}--big.svg`)
    out.push(`https://s3-symbol-logo.tradingview.com/${slug}.svg`)
  }
  const yahoo = resolveYahooLogoUrl(quote, ticker)
  if (yahoo) out.push(yahoo)
  const clean = String(ticker || '')
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, '')
  if (clean) {
    out.push(`https://storage.googleapis.com/iex/api/logos/${clean}.png`)
    out.push(`https://assets.parqet.com/logos/symbol/${clean}`)
  }
  return [...new Set(out.filter(Boolean))]
}

/** Circular company logo with multi-CDN fallback chain */
function CompanyLogo({
  ticker,
  companyName,
  quote,
  size = 'md',
  className,
  asLink = false,
}: {
  ticker: string
  companyName?: string | null
  quote?: YahooLiveQuote | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Wrap in TradingView chart link (detail header) */
  asLink?: boolean
}) {
  const [attempt, setAttempt] = useState(0)
  const candidates = companyLogoCandidates(ticker, companyName, quote)
  // Reset chain when ticker/name sources change
  useEffect(() => {
    setAttempt(0)
  }, [ticker, companyName, quote?.logoUrl, quote?.longName, quote?.shortName])
  const src = attempt < candidates.length ? candidates[attempt] : null
  const dim =
    size === 'sm' ? 'size-7' : size === 'lg' ? 'size-11' : 'size-9'
  const textSize =
    size === 'sm' ? 'text-[9px]' : size === 'lg' ? 'text-[11px]' : 'text-[10px]'
  const inner = (
    <>
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          className="size-full rounded-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() =>
            setAttempt((i) => (i + 1 < candidates.length ? i + 1 : i + 1))
          }
        />
      ) : (
        <span
          className={cn(
            'font-mono font-semibold text-muted-foreground',
            textSize,
          )}
        >
          {String(ticker || '??')
            .replace(/[^A-Za-z0-9]/g, '')
            .slice(0, 2)
            .toUpperCase() || '??'}
        </span>
      )}
    </>
  )
  const shellClass = cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted/40',
    dim,
    className,
  )
  if (asLink) {
    return (
      <a
        href={tradingViewSymbolUrl(ticker)}
        target="_blank"
        rel="noopener noreferrer"
        className={shellClass}
        title={`Open ${ticker} on TradingView`}
        aria-label={`${companyName || ticker} logo`}
      >
        {inner}
      </a>
    )
  }
  return (
    <span className={shellClass} aria-hidden={!src}>
      {inner}
    </span>
  )
}

/** Compact poll countdown chip */
function PollTimerBadge({
  remainingSec,
  pollMs,
  pollProgress,
}: {
  remainingSec: number
  pollMs: number
  pollProgress: number
}) {
  return (
    <Badge
      variant="secondary"
      className="h-6 gap-1 px-1.5 text-[10px] font-medium tabular-nums"
      title={`Engine poll every ${Math.round(pollMs / 1000)}s`}
    >
      <span className="relative inline-flex size-2.5 shrink-0" aria-hidden>
        <svg viewBox="0 0 36 36" className="size-2.5 -rotate-90">
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke="currentColor"
            className="opacity-25"
            strokeWidth="4"
          />
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${(pollProgress * 88).toFixed(1)} 88`}
          />
        </svg>
      </span>
      {remainingSec === 0 ? '…' : `${remainingSec}s`}
    </Badge>
  )
}

/** Compact HH:mm for a zone (no seconds — keeps UK+US on one row) */
function formatZoneHm(ms: number, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms))
  } catch {
    return '—'
  }
}

/** Market status — top-right; no "Market" label; Live blinks in regular hours */
function MarketStatusBadge({
  marketState,
  marketStateLoading = false,
  className,
}: {
  marketState?: string | null
  marketStateLoading?: boolean
  className?: string
}) {
  const market = usEquityMarketStatusFromYahoo(marketState)
  const showLoader = marketStateLoading || !market
  const isLive = market?.tone === 'open'
  const label = isLive ? 'Live' : market?.short
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap text-[11px] tabular-nums leading-none',
        className,
      )}
      title={
        showLoader
          ? 'Waiting for Yahoo marketState…'
          : `US equities · ${market!.label}`
      }
    >
      {showLoader ? (
        <Loader2
          className="size-3 shrink-0 animate-spin text-muted-foreground"
          aria-label="Loading market status"
        />
      ) : (
        <span
          className={cn(
            'font-semibold tracking-tight',
            marketStatusToneClass(market!.tone),
            isLive && 'sndk-market-live-blink',
          )}
        >
          {label}
        </span>
      )}
    </div>
  )
}

/** Parse "15m" / "2h" / "day" → human lookback description */
function lookbackDescription(key: string): string {
  if (key === 'day') return 'vs previous regular-session close (not a rolling clock window)'
  const h = key.match(/^(\d+(?:\.\d+)?)h$/i)
  if (h) {
    const n = Number(h[1])
    return `Wall-clock lookback of ${n} hour${n === 1 ? '' : 's'} on 1‑minute Yahoo candles`
  }
  const m = key.match(/^(\d+)m$/i)
  if (m) {
    const n = Number(m[1])
    return `Wall-clock lookback of ${n} minute${n === 1 ? '' : 's'} on 1‑minute Yahoo candles`
  }
  return `Rolling window “${key}” on 1‑minute Yahoo candles`
}

function minutesFromReturnKey(key: string): number | null {
  if (key === 'day') return null
  const h = key.match(/^(\d+(?:\.\d+)?)h$/i)
  if (h) return Math.round(Number(h[1]) * 60)
  const m = key.match(/^(\d+)m$/i)
  if (m) return Number(m[1])
  return null
}

type ReturnCalcDetail = {
  key: string
  label: string
  method: string
  formula: string
  currentPrice: number | null
  referencePrice: number | null
  referenceTime: string | null
  asOfTime: string | null
  result: number | null
  threshold: number | null
  lookback: string
  notes: string[]
}

function buildReturnCalcDetail(opts: {
  key: string
  label: string
  value: number | null | undefined
  referencePrice: number | null | undefined
  referenceTime: string | null | undefined
  currentPrice: number | null | undefined
  asOfTime: string | null | undefined
  previousClose: number | null | undefined
  marketSession: string | null | undefined
  threshold: number | null | undefined
  isBridge: boolean
}): ReturnCalcDetail {
  const {
    key,
    label,
    value,
    referencePrice,
    referenceTime,
    currentPrice,
    asOfTime,
    previousClose,
    marketSession,
    threshold,
    isBridge,
  } = opts
  const isDay = key === 'day'
  const session = String(marketSession || '').toUpperCase()
  const notes: string[] = []

  let method: string
  let formula: string
  if (isDay) {
    method =
      session === 'PRE'
        ? 'Premarket day move vs prior regular close'
        : session === 'PREPRE'
          ? 'Overnight day move vs prior regular close'
          : session === 'POST' || session === 'POSTPOST'
            ? 'After-hours day move vs prior regular close'
            : 'Day move vs prior regular close'
    formula = '((livePrice − previousClose) / previousClose) × 100'
    notes.push('previousClose = Yahoo’s last completed regular-session close')
    notes.push('This is what people mean by “up 3.5% in premarket”')
    if (
      session === 'PRE' ||
      session === 'PREPRE' ||
      session === 'POST' ||
      session === 'POSTPOST'
    ) {
      notes.push(
        'Uses Yahoo preMarket* (PRE) or postMarket* (POST/POSTPOST/PREPRE Overnight)',
      )
    }
  } else {
    method = isBridge
      ? `Weekend-bridge rolling return (${key})`
      : `Rolling return (${key})`
    formula = '((currentPrice − priceAtLookback) / priceAtLookback) × 100'
    notes.push(lookbackDescription(key))
    notes.push('priceAtLookback = last 1m candle at or before (now − lookback)')
    if (isBridge) {
      notes.push('Bridge window: shown Mon pre-open / weekend to reach Friday prints')
    }
    const mins = minutesFromReturnKey(key)
    if (
      referenceTime &&
      asOfTime &&
      mins != null &&
      mins >= 120
    ) {
      try {
        const refMs = Date.parse(referenceTime)
        const asOfMs = Date.parse(asOfTime)
        const targetMs = asOfMs - mins * 60_000
        if (
          Number.isFinite(refMs) &&
          Number.isFinite(asOfMs) &&
          refMs < targetMs - 30 * 60_000
        ) {
          notes.push(
            'Lookback fell in a closed-market gap — used last print before the gap (e.g. Friday)',
          )
        }
      } catch {
        /* ignore */
      }
    }
    notes.push('Short windows (1m–90m) stay inside the live tape; they are not the full day move')
  }

  if (value == null) {
    notes.push(
      isDay
        ? 'No value: missing live price or previous close from Yahoo'
        : 'No value: not enough 1m history near this lookback (or gap too large)',
    )
  }

  if (threshold != null) {
    notes.push(
      value != null && Math.abs(value) >= threshold
        ? `Threshold |move| ≥ ${threshold}% — HOT (can start/continue momentum episode)`
        : `Threshold |move| ≥ ${threshold}% — below threshold (diagnostic / quiet)`,
    )
  } else if (!isDay) {
    notes.push('No episode threshold on this window (display only)')
  }

  return {
    key,
    label,
    method,
    formula,
    currentPrice: currentPrice ?? null,
    referencePrice:
      (isDay ? previousClose : referencePrice) ?? referencePrice ?? null,
    referenceTime: referenceTime ?? null,
    asOfTime: asOfTime ?? null,
    result: value ?? null,
    threshold: threshold ?? null,
    lookback: lookbackDescription(key),
    notes,
  }
}

function ReturnCalcTooltipBody({
  detail,
  assetClass,
  currency,
}: {
  detail: ReturnCalcDetail
  assetClass?: string
  currency?: string | null
}) {
  const price = (n: number | null) =>
    n == null ? '—' : fmtPrice(n, assetClass, currency)
  const ts = (iso: string | null | undefined, fallback = '—') => {
    if (!iso) return fallback
    return fmtDateTime(iso) || iso
  }
  const nowTs = ts(detail.asOfTime)
  const refTs =
    detail.referenceTime
      ? ts(detail.referenceTime)
      : detail.key === 'day'
        ? 'Yahoo previous close'
        : '—'

  return (
    <div className="flex w-[min(22rem,88vw)] flex-col gap-3 text-left text-[13px] leading-relaxed">
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-background/65">
          {detail.label} · how calculated
        </p>
        <p className="text-[14px] font-semibold leading-snug text-background">
          {detail.method}
        </p>
      </div>

      <div className="rounded-lg bg-background/10 px-3 py-2.5 font-mono text-[12px] leading-snug text-background">
        {detail.formula}
      </div>

      <div className="min-w-0 space-y-2.5">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
            Now (live)
          </p>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
            <span className="text-[15px] font-semibold text-background">
              {price(detail.currentPrice)}
            </span>
            <span className="text-[12px] text-background/70">{nowTs}</span>
          </p>
        </div>

        <div className="min-w-0 space-y-0.5 border-t border-background/15 pt-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
            {detail.key === 'day' ? 'Previous close' : 'Lookback price'}
          </p>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
            <span className="text-[15px] font-semibold text-background">
              {price(detail.referencePrice)}
            </span>
            <span className="text-[12px] text-background/70">{refTs}</span>
          </p>
        </div>

        <div className="min-w-0 space-y-0.5 border-t border-background/15 pt-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
            Result
          </p>
          <p
            className={cn(
              'text-[16px] font-semibold tabular-nums',
              detail.result != null && detail.result > 0
                ? 'text-emerald-300'
                : detail.result != null && detail.result < 0
                  ? 'text-rose-300'
                  : 'text-background',
            )}
          >
            {fmtPct(detail.result)}
            {detail.threshold != null ? (
              <span className="ml-2 text-[12px] font-medium text-background/55">
                thr ≥{detail.threshold}%
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {detail.currentPrice != null &&
      detail.referencePrice != null &&
      detail.referencePrice !== 0 &&
      detail.result != null ? (
        <p className="min-w-0 whitespace-normal break-words border-t border-background/20 pt-2.5 font-mono text-[11px] leading-snug text-background/85">
          (({detail.currentPrice.toFixed(4)} − {detail.referencePrice.toFixed(4)})
          {' / '}
          {detail.referencePrice.toFixed(4)}) × 100 = {detail.result.toFixed(4)}%
        </p>
      ) : null}

      {detail.notes.length ? (
        <ul className="min-w-0 space-y-1.5 border-t border-background/20 pt-2.5 text-[12px] leading-snug text-background/75">
          {detail.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <span className="shrink-0 text-background/40">·</span>
              <span className="min-w-0">{n}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function levelClass(level: string) {
  switch (level) {
    case 'success':
      return 'text-emerald-700 dark:text-emerald-400'
    case 'warn':
      return 'text-amber-700 dark:text-amber-400'
    case 'error':
      return 'text-rose-700 dark:text-rose-400'
    default:
      return 'text-foreground/90'
  }
}

function sourceBadge(source: string) {
  const map: Record<string, string> = {
    yahoo: 'bg-sky-500/15 text-sky-800 dark:text-sky-200',
    momentum: 'bg-violet-500/15 text-violet-800 dark:text-violet-200',
    episode: 'bg-indigo-500/15 text-indigo-800 dark:text-indigo-200',
    event: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
    api: 'bg-slate-500/15 text-slate-800 dark:text-slate-200',
    poll: 'bg-teal-500/15 text-teal-800 dark:text-teal-200',
    boot: 'bg-teal-500/15 text-teal-800 dark:text-teal-200',
    loop: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-200',
    simulate: 'bg-orange-500/15 text-orange-900 dark:text-orange-200',
  }
  return map[source] || 'bg-muted text-muted-foreground'
}

function momentumApiPath(ticker: string, suffix = '') {
  const base = `/api/momentum/${encodeURIComponent(ticker)}`
  return suffix ? `${base}/${suffix}` : base
}

/** Parse fetch failures into a detailed UiError for the banner. */
async function toUiError(
  title: string,
  res: Response | null,
  body: Record<string, unknown> | null,
  fallback: string,
  path?: string,
): Promise<UiError> {
  const errField = body?.error
  const detailField = body?.errorDetail as ErrorDetail | undefined
  const message =
    (typeof errField === 'string' && errField) ||
    (detailField?.message && String(detailField.message)) ||
    (res ? `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}` : null) ||
    fallback

  const detail: ErrorDetail = {
    message,
    at: detailField?.at || new Date().toISOString(),
    source: detailField?.source || 'api',
    name: detailField?.name || null,
    code: detailField?.code ?? null,
    stack: detailField?.stack || null,
    cause: detailField?.cause || null,
    httpStatus: detailField?.httpStatus ?? res?.status ?? null,
    endpoint: detailField?.endpoint || path || null,
    path: path || null,
    statusText: res?.statusText || null,
    raw: detailField?.raw ?? (body && Object.keys(body).length ? body : null),
  }

  // If body wasn't JSON, try text for context
  if (!body && res) {
    try {
      const text = await res.clone().text()
      if (text) detail.bodyText = text.slice(0, 2000)
    } catch {
      /* ignore */
    }
  }

  return { title, message, detail }
}

function ErrorBanner({
  tone,
  title,
  message,
  detail,
  onDismiss,
}: {
  tone: 'rose' | 'amber'
  title: string
  message: string
  detail?: ErrorDetail | null
  onDismiss?: () => void
}) {
  const [open, setOpen] = useState(false)
  const border =
    tone === 'rose'
      ? 'border-rose-200 bg-rose-50 text-rose-950'
      : 'border-amber-200 bg-amber-50 text-amber-950'
  const muted = tone === 'rose' ? 'text-rose-800/80' : 'text-amber-900/80'
  const chip =
    tone === 'rose'
      ? 'bg-rose-500/15 text-rose-900'
      : 'bg-amber-500/15 text-amber-900'

  const metaBits = [
    detail?.httpStatus != null ? `HTTP ${detail.httpStatus}` : null,
    detail?.statusText || null,
    detail?.name || null,
    detail?.code != null && detail.code !== '' ? `code ${detail.code}` : null,
    detail?.source || null,
    detail?.endpoint || detail?.path || null,
  ].filter(Boolean) as string[]

  const fullDump = (() => {
    const payload: Record<string, unknown> = {
      title,
      message,
      ...(detail || {}),
    }
    try {
      return JSON.stringify(payload, null, 2)
    } catch {
      return String(message)
    }
  })()

  return (
    <div className={cn('rounded-xl border px-3 py-2.5 text-sm', border)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 text-left">
          <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
            {title}
          </p>
          <p className="mt-0.5 break-words font-medium leading-snug">{message}</p>
          {metaBits.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {metaBits.map((bit) => (
                <span
                  key={bit}
                  className={cn(
                    'rounded px-1.5 py-px text-[10px] font-semibold',
                    chip,
                  )}
                >
                  {bit}
                </span>
              ))}
            </div>
          ) : null}
          {detail?.cause ? (
            <p className={cn('mt-1.5 text-[11px] leading-snug', muted)}>
              Cause: {detail.cause}
            </p>
          ) : null}
          {detail?.at ? (
            <p className={cn('mt-1 text-[10px] tabular-nums', muted)}>
              {fmtDateTime(detail.at) || detail.at}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              'rounded-md border px-2 py-1 text-[10px] font-semibold',
              tone === 'rose'
                ? 'border-rose-200 bg-white/70 text-rose-900 hover:bg-white'
                : 'border-amber-200 bg-white/70 text-amber-950 hover:bg-white',
            )}
          >
            {open ? 'Hide detail' : 'Show detail'}
          </button>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className={cn(
                'rounded-md p-1',
                tone === 'rose' ? 'text-rose-800/70 hover:bg-white/60' : 'text-amber-900/70 hover:bg-white/60',
              )}
              aria-label="Dismiss error"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="mt-2 space-y-2 border-t border-black/5 pt-2">
          {detail?.stack ? (
            <div>
              <p className={cn('text-[10px] font-semibold uppercase', muted)}>Stack</p>
              <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/70 p-2 font-mono text-[10px] leading-snug text-[#111111]">
                {detail.stack}
              </pre>
            </div>
          ) : null}
          {detail?.bodyText ? (
            <div>
              <p className={cn('text-[10px] font-semibold uppercase', muted)}>
                Response body
              </p>
              <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/70 p-2 font-mono text-[10px] leading-snug text-[#111111]">
                {detail.bodyText}
              </pre>
            </div>
          ) : null}
          <div>
            <p className={cn('text-[10px] font-semibold uppercase', muted)}>
              Full error JSON
            </p>
            <pre className="mt-0.5 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/70 p-2 font-mono text-[10px] leading-snug text-[#111111]">
              {fullDump}
            </pre>
          </div>
          <button
            type="button"
            className={cn(
              'text-[10px] font-semibold underline-offset-2 hover:underline',
              muted,
            )}
            onClick={() => {
              void navigator.clipboard?.writeText(fullDump)
            }}
          >
            Copy details
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function SndkMomentumPanel({
  appSwitcher,
  onOpenInTrigger,
}: {
  /** Home / Trigger / 9AM switcher (parent-owned) */
  appSwitcher?: ReactNode
  /** Open this ticker inside Trigger (parent switches app tab + selects stock) */
  onOpenInTrigger?: (ticker: string, label?: string) => void
} = {}) {
  const [watchlist, setWatchlist] = useState<WatchTab[]>(() => loadWatchlist())
  const [assetClassTab, setAssetClassTab] = useState<AssetClassTabId>(() =>
    loadAssetClassFilter(),
  )
  const [activeTicker, setActiveTicker] = useState(() => {
    const list = loadWatchlist()
    return loadActiveTicker(list)
  })
  const [thresholdOpen, setThresholdOpen] = useState(false)

  /** Select a watch tab and remember it (Silver / SpaceX / … survive refresh). */
  const selectTicker = useCallback((ticker: string) => {
    const t = String(ticker || '').trim().toUpperCase()
    if (!t) return
    setActiveTicker(t)
    saveActiveTicker(t)
    setThresholdOpen(false)
  }, [])

  const filteredWatchlist = watchlist.filter(
    (tab) => tabAssetClass(tab) === assetClassTab,
  )

  const selectAssetClassTab = useCallback(
    (id: string) => {
      if (!ASSET_CLASS_TABS.some((t) => t.id === id)) return
      const next = id as AssetClassTabId
      setAssetClassTab(next)
      saveAssetClassFilter(next)
      const inClass = watchlist.filter((tab) => tabAssetClass(tab) === next)
      if (!inClass.length) return
      const stillActive = inClass.some(
        (tab) => tab.ticker.toUpperCase() === activeTicker.toUpperCase(),
      )
      if (!stillActive) {
        selectTicker(inClass[0].ticker)
      }
    },
    [watchlist, activeTicker, selectTicker],
  )
  const [addOpen, setAddOpen] = useState(false)
  const [addTicker, setAddTicker] = useState('')
  const [addLabel, setAddLabel] = useState('')
  /** Yahoo typeahead for the Add symbol field */
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<YahooSearchResult[]>([])
  const [searchHighlight, setSearchHighlight] = useState(0)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchBoxRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<MomentumStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UiError | null>(null)
  /** Expanded Yahoo chart strip under pricing (click mini chart / toggle) */
  const [chartExpanded, setChartExpanded] = useState(false)
  const [logCollapsed, setLogCollapsed] = useState(() => {
    try {
      return localStorage.getItem(LOG_COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const logTopRef = useRef<HTMLDivElement | null>(null)
  const prevLogLen = useRef(0)
  /** Local clock for next-poll countdown (engine default 60s). */
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [thresholdDraft, setThresholdDraft] = useState<Record<string, string>>({})
  const [thresholdSaving, setThresholdSaving] = useState(false)
  /** Live Yahoo quote for the selected tab (any ticker) */
  const [tabQuote, setTabQuote] = useState<YahooLiveQuote | null>(null)
  const [tabQuoteLoading, setTabQuoteLoading] = useState(false)
  /** Batch quotes for all watchlist tabs (label % + blink) */
  const [watchQuotes, setWatchQuotes] = useState<Record<string, YahooLiveQuote>>({})
  /** Active episode hint per watchlist ticker (from /api/momentum overview) */
  const [episodeByTicker, setEpisodeByTicker] = useState<
    Record<string, { direction: 'UP' | 'DOWN'; window?: string | null } | null>
  >({})
  /** Right-click remove menu for watchlist rows */
  const [watchContextMenu, setWatchContextMenu] = useState<{
    ticker: string
    label: string
    x: number
    y: number
  } | null>(null)
  /** Right rail content: activity log, subscribers, or recent events */
  const [rightRailMode, setRightRailMode] = useState<
    'logs' | 'subscribers' | 'events'
  >('logs')
  /** Detail popup for timeline Alert / Perplexity / state measure explain */
  const [timelineDetail, setTimelineDetail] = useState<
    | {
        kind: 'alert'
        at: string
        notification: { title?: string; body?: string } | null
        ev: MomentumEvent
      }
    | {
        kind: 'perplexity'
        at: string
        research: EventResearch
        ev: MomentumEvent
      }
    | {
        kind: 'event'
        at: string
        ev: MomentumEvent
      }
    | null
  >(null)
  /** Manual end / exit of the live episode from Recent Events */
  const [endingEpisode, setEndingEpisode] = useState(false)
  /** Resizable right column width (px) — restored from last user drag */
  const [rightRailWidth, setRightRailWidth] = useState(loadRightRailWidth)
  const rightRailDragRef = useRef<{ startX: number; startW: number } | null>(
    null,
  )
  const [subsLoading, setSubsLoading] = useState(false)
  const [subsError, setSubsError] = useState('')
  const [tickerSubscribers, setTickerSubscribers] = useState<AlertDevice[]>([])
  /** Rolling-return → push alert composer */
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertWindowKey, setAlertWindowKey] = useState<string | null>(null)
  const [alertTitle, setAlertTitle] = useState('')
  const [alertBody, setAlertBody] = useState('')
  const [alertDevices, setAlertDevices] = useState<AlertDevice[]>([])
  const [alertDeviceKeys, setAlertDeviceKeys] = useState<string[]>([])
  const [alertDevicesLoading, setAlertDevicesLoading] = useState(false)
  const [alertDevicesError, setAlertDevicesError] = useState('')
  const [alertSending, setAlertSending] = useState(false)
  const [alertSendMessage, setAlertSendMessage] = useState('')
  const [alertSendError, setAlertSendError] = useState(false)
  /** Perplexity research — steps, tokens, cost, sources */
  type ResearchStep = {
    id: string
    label: string
    status: 'pending' | 'running' | 'done' | 'error'
    detail?: string | null
    result?: unknown
  }
  const [alertResearchBusy, setAlertResearchBusy] = useState(false)
  const [alertResearchError, setAlertResearchError] = useState('')
  const [alertPromptOpen, setAlertPromptOpen] = useState(false)
  const [alertGeminiPrompt, setAlertGeminiPrompt] = useState('')
  /** Last prepare INPUT values — used to reverse-fill saved templates */
  const [alertUserMovement, setAlertUserMovement] = useState('')
  const [alertInputFacts, setAlertInputFacts] = useState('')
  const [alertPromptDirty, setAlertPromptDirty] = useState(false)
  const [alertUsingSavedPrompt, setAlertUsingSavedPrompt] = useState(false)
  /** Perplexity spend / token credits (app-tracked) */
  const [pplxTotals, setPplxTotals] = useState<{
    total_cost_usd?: number
    total_cost_usd_display?: string
    total_credits?: number
    total_tokens?: number
    total_calls?: number
  } | null>(null)
  const [pplxUsageOpen, setPplxUsageOpen] = useState(false)
  const [pplxUsageLoading, setPplxUsageLoading] = useState(false)
  const [pplxUsageError, setPplxUsageError] = useState('')
  const [pplxDaily, setPplxDaily] = useState<
    Array<{
      day: string
      cost_usd?: number
      cost_usd_display?: string
      credits_used?: number
      total_tokens?: number
      calls?: number
    }>
  >([])
  const [alertResearchSteps, setAlertResearchSteps] = useState<ResearchStep[]>(
    [],
  )
  const [alertResearchMeta, setAlertResearchMeta] = useState<{
    likely_driver?: string | null
    reason?: string | null
    cost_usd_display?: string | null
    user_movement?: string | null
    asset_class?: string | null
    model?: string | null
    provider?: string | null
    request_id?: string | null
    tokens?: {
      prompt?: number | null
      completion?: number | null
      total?: number | null
      search_context_size?: string | null
    } | null
    cost?: {
      input_tokens_cost?: number | null
      output_tokens_cost?: number | null
      request_cost?: number | null
      total_cost?: number | null
    } | null
    tools?: Array<{ name?: string; provider?: string; description?: string }>
    citations?: string[]
    search_results?: Array<{
      title?: string | null
      url?: string | null
      source?: string | null
      date?: string | null
      snippet?: string | null
    }>
    supabase_save?: {
      ok?: boolean
      table?: string | null
      id?: string | null
      error?: string | null
    } | null
  } | null>(null)

  function researchPayloadBase() {
    if (!alertWindowKey) return null
    const exact = status?.snapshot?.exactLookbacks?.[alertWindowKey]
    const val = status?.snapshot?.returns?.[alertWindowKey]
    const sessionCode =
      status?.snapshot?.marketSession || sessionFromQuote || null
    const company = activeTab?.label || displayTicker
    const windowLabel = returnKeyDisplayLabel(alertWindowKey, sessionCode)
    return {
      ticker: displayTicker,
      company_name: company,
      window_key: alertWindowKey,
      window_label: windowLabel,
      exact_label: exact?.exactLabel || null,
      exact_minutes: exact?.exactMinutes ?? null,
      move_percent: val,
      live_price: livePrice ?? status?.snapshot?.currentPrice ?? null,
      reference_price:
        exact?.referencePrice ??
        status?.snapshot?.references?.[alertWindowKey] ??
        prevClose ??
        null,
      reference_time:
        exact?.referenceTime ??
        status?.snapshot?.referenceTimes?.[alertWindowKey] ??
        prevCloseTime ??
        null,
      market_session: sessionCode,
      asset_class: activeAssetClass,
    }
  }

  const activeTab =
    watchlist.find((t) => t.ticker === activeTicker) || watchlist[0] || DEFAULT_WATCHLIST[0]
  const displayTicker = activeTab?.ticker || 'SNDK'

  // Collapse expanded chart when switching entities
  useEffect(() => {
    setChartExpanded(false)
  }, [displayTicker])

  /** Load Trigger + 9AM devices subscribed to `ticker` (enabled / partial). */
  const loadTickerSubscribers = useCallback(async (ticker: string) => {
    const sym = String(ticker || '')
      .trim()
      .toUpperCase()
    if (!sym) {
      setTickerSubscribers([])
      return
    }
    setSubsLoading(true)
    setSubsError('')
    try {
      const apps = ['trigger', 'nineam'] as const
      const results = await Promise.all(
        apps.map(async (app) => {
          const res = await fetch(
            `/api/notifications/devices?app=${encodeURIComponent(app)}&_=${Date.now()}`,
          )
          const body = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(body.error || `Devices failed (${res.status})`)
          }
          return {
            app,
            devices: (body.devices || []) as AlertDevice[],
          }
        }),
      )
      const seen = new Set<string>()
      const matched: AlertDevice[] = []
      for (const { app, devices } of results) {
        for (const d of devices) {
          if (d.enabled === false || d.subscription_status === 'off') continue
          const list = [
            ...(d.enabled_tickers || []),
            ...(d.tickers || []),
          ]
            .map((t) => String(t || '').toUpperCase())
            .filter(Boolean)
          if (!list.includes(sym)) continue
          const key = `${app}:${d.device_id || d.expo_push_token}`
          if (seen.has(key)) continue
          seen.add(key)
          matched.push({ ...d, app_key: app })
        }
      }
      matched.sort((a, b) =>
        String(a.device_id || a.expo_push_token).localeCompare(
          String(b.device_id || b.expo_push_token),
        ),
      )
      setTickerSubscribers(matched)
    } catch (err) {
      setTickerSubscribers([])
      setSubsError(
        err instanceof Error ? err.message : 'Failed to load subscribers',
      )
    } finally {
      setSubsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTickerSubscribers(displayTicker)
  }, [displayTicker, loadTickerSubscribers])

  const setLogCollapsedPersist = useCallback((collapsed: boolean) => {
    setLogCollapsed(collapsed)
    try {
      localStorage.setItem(LOG_COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const toggleLog = () => {
    setLogCollapsedPersist(!logCollapsed)
  }

  /** Open right rail on subscribers for the active ticker (expands if collapsed). */
  const openSubscribersInLogColumn = useCallback(() => {
    void loadTickerSubscribers(displayTicker)
    setRightRailMode('subscribers')
    setLogCollapsedPersist(false)
  }, [displayTicker, loadTickerSubscribers, setLogCollapsedPersist])

  /** Open right rail on recent momentum events (expands if collapsed). */
  const openEventsInLogColumn = useCallback(() => {
    setRightRailMode('events')
    setLogCollapsedPersist(false)
  }, [setLogCollapsedPersist])

  // Active episode on this ticker → jump straight to Recent Events (keep saved width)
  useEffect(() => {
    const ep = status?.episode
    if (!ep) return
    const st = String(ep.status || 'ACTIVE').toUpperCase()
    if (st === 'ENDED' || st === 'EXPIRED' || st === 'REVERSED') return
    openEventsInLogColumn()
  }, [
    displayTicker,
    status?.episode?.episodeId,
    status?.episode?.episodeStartedAt,
    status?.episode?.status,
    openEventsInLogColumn,
  ])

  const onRightRailResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      rightRailDragRef.current = {
        startX: e.clientX,
        startW: rightRailWidth,
      }
      let lastW = rightRailWidth
      const onMove = (ev: MouseEvent) => {
        const drag = rightRailDragRef.current
        if (!drag) return
        // Handle is on the left edge of the rail → drag left = wider
        lastW = Math.min(520, Math.max(240, drag.startW + (drag.startX - ev.clientX)))
        setRightRailWidth(lastW)
      }
      const onUp = () => {
        rightRailDragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        saveRightRailWidth(lastW)
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [rightRailWidth],
  )

  const load = useCallback(async () => {
    const path = momentumApiPath(displayTicker)
    try {
      const res = await fetch(path)
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError(await toUiError('Failed to load status', res, body, 'Failed to load', path))
        return
      }
      const next = body as unknown as MomentumStatus
      setStatus(next)
      setError(null)
      // Sync threshold inputs when panel closed (avoid fighting while typing)
      setThresholdDraft((prev) => {
        if (thresholdOpen && Object.keys(prev).length) return prev
        const snap = next.config?.thresholdSnapshot
        if (!snap) return prev
        const draft: Record<string, string> = {}
        for (const k of THRESHOLD_EDIT_KEYS) {
          if (k === 'day') draft.day = String(snap.day ?? '')
          else draft[k] = snap.windows?.[k] != null ? String(snap.windows[k]) : ''
        }
        return draft
      })
    } catch (err) {
      setError({
        title: 'Failed to load status',
        message: err instanceof Error ? err.message : 'Failed to load',
        detail: {
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
          source: 'client',
          stack: err instanceof Error ? err.stack || null : null,
          path,
          endpoint: path,
        },
      })
    } finally {
      setLoading(false)
    }
  }, [displayTicker, thresholdOpen])

  const loadPerplexityUsage = useCallback(async (opts?: { open?: boolean }) => {
    if (opts?.open) {
      setPplxUsageOpen(true)
      setPplxUsageLoading(true)
      setPplxUsageError('')
    }
    try {
      const res = await fetch('/api/notifications/usage/perplexity?days=90')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || `Failed (${res.status})`)
      }
      const totals = {
        total_cost_usd: Number(body.total_cost_usd) || 0,
        total_cost_usd_display:
          body.total_cost_usd_display ||
          (Number(body.total_cost_usd)
            ? `$${Number(body.total_cost_usd).toFixed(6)}`
            : '$0.000000'),
        total_credits: Number(body.total_credits) || 0,
        total_tokens: Number(body.total_tokens) || 0,
        total_calls: Number(body.total_calls) || 0,
      }
      setPplxTotals(totals)
      if (opts?.open) {
        setPplxDaily(Array.isArray(body.daily) ? body.daily : [])
      }
    } catch (err) {
      if (opts?.open) {
        setPplxUsageError(
          err instanceof Error ? err.message : 'Failed to load Perplexity usage',
        )
      }
    } finally {
      if (opts?.open) setPplxUsageLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPerplexityUsage()
  }, [loadPerplexityUsage])

  // Register watchlist + active focus tab (server polls focus only)
  useEffect(() => {
    const tickers = watchlist.map((t) => t.ticker).filter(Boolean)
    if (!tickers.length && !displayTicker) return
    void fetch('/api/momentum/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tickers: tickers.length ? tickers : [displayTicker],
        active: displayTicker,
      }),
    }).catch(() => {
      /* non-fatal — manual tick still works */
    })
  }, [watchlist, displayTicker])

  // Overview poll — active episode flags for every watched ticker (sidebar dots)
  useEffect(() => {
    let cancelled = false
    const loadOverview = () => {
      void fetch(`/api/momentum?_=${Date.now()}`)
        .then((res) => res.json().catch(() => ({})))
        .then((body) => {
          if (cancelled || !body?.ok) return
          const next: Record<
            string,
            { direction: 'UP' | 'DOWN'; window?: string | null } | null
          > = {}
          for (const row of body.tickers || []) {
            const t = String(row.ticker || '')
              .trim()
              .toUpperCase()
            if (!t) continue
            if (row.hasEpisode) {
              next[t] = {
                direction: row.episodeDirection === 'DOWN' ? 'DOWN' : 'UP',
                window: row.episodeWindow || null,
              }
            } else {
              next[t] = null
            }
          }
          setEpisodeByTicker((prev) => ({ ...prev, ...next }))
        })
        .catch(() => {
          /* non-fatal */
        })
    }
    loadOverview()
    const id = window.setInterval(loadOverview, 4_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [watchlist])

  // Keep active ticker's episode flag in sync with full status payload
  useEffect(() => {
    const t = displayTicker.toUpperCase()
    if (!t) return
    const ep = status?.episode
    const active =
      ep && String(ep.status || 'ACTIVE').toUpperCase() !== 'ENDED'
    setEpisodeByTicker((prev) => ({
      ...prev,
      [t]: active
        ? {
            direction: ep!.direction === 'DOWN' ? 'DOWN' : 'UP',
            window: ep!.detectedWindow || null,
          }
        : null,
    }))
  }, [displayTicker, status?.episode])

  // Clear status when switching tabs so we don't flash the previous ticker
  useEffect(() => {
    setStatus(null)
    setLoading(true)
    setError(null)
    prevLogLen.current = 0
  }, [displayTicker])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 3_000)
    return () => clearInterval(id)
  }, [load])

  // Kick a Yahoo tick when landing on a tab so returns/episode populate quickly
  // (background loop covers the full watchlist on its own cadence)
  useEffect(() => {
    let cancelled = false
    void fetch(momentumApiPath(displayTicker, 'tick'), { method: 'POST' })
      .then((res) => res.json().catch(() => ({})))
      .then((body) => {
        if (cancelled) return
        if (body?.status) {
          setStatus(body.status as MomentumStatus)
          setLoading(false)
        } else void load()
      })
      .catch(() => {
        /* poll loop / load will retry */
      })
    return () => {
      cancelled = true
    }
  }, [displayTicker, load])

  // Live Yahoo quote for any tab (poll ~30s so crypto/FX/cmdty stay fresh)
  const refreshTabQuote = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setTabQuoteLoading(true)
      try {
        const body = await fetchYahooQuote(displayTicker)
        const q = body.quote || null
        setTabQuote(q)
        if (q) {
          setWatchQuotes((prev) => ({
            ...prev,
            [displayTicker]: q,
            [displayTicker.toUpperCase()]: q,
          }))
        }
      } catch {
        if (!opts?.silent) setTabQuote(null)
      } finally {
        if (!opts?.silent) setTabQuoteLoading(false)
      }
    },
    [displayTicker],
  )

  useEffect(() => {
    let cancelled = false
    setTabQuote(null)
    setTabQuoteLoading(true)
    void fetchYahooQuote(displayTicker)
      .then((body) => {
        if (cancelled) return
        const q = body.quote || null
        setTabQuote(q)
        if (q) {
          setWatchQuotes((prev) => ({
            ...prev,
            [displayTicker]: q,
            [displayTicker.toUpperCase()]: q,
          }))
        }
      })
      .catch(() => {
        if (!cancelled) setTabQuote(null)
      })
      .finally(() => {
        if (!cancelled) setTabQuoteLoading(false)
      })
    const id = setInterval(() => {
      if (cancelled) return
      void fetchYahooQuote(displayTicker)
        .then((body) => {
          if (cancelled) return
          const q = body.quote || null
          setTabQuote(q)
          if (q) {
            setWatchQuotes((prev) => ({
              ...prev,
              [displayTicker]: q,
              [displayTicker.toUpperCase()]: q,
            }))
          }
        })
        .catch(() => {
          /* keep last good quote */
        })
    }, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [displayTicker])

  // Lightweight batch quotes for every tab — % under labels + ≥3% blink
  useEffect(() => {
    const tickers = watchlist.map((t) => t.ticker).filter(Boolean)
    if (!tickers.length) return
    let cancelled = false
    const loadQuotes = () => {
      void fetchYahooQuotes(tickers)
        .then((body) => {
          if (cancelled) return
          const next: Record<string, YahooLiveQuote> = {}
          for (const [key, q] of Object.entries(body.quotes || {})) {
            next[key] = q
            next[key.toUpperCase()] = q
          }
          setWatchQuotes((prev) => ({ ...prev, ...next }))
        })
        .catch(() => {
          /* keep last map */
        })
    }
    loadQuotes()
    const id = setInterval(loadQuotes, 20_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [watchlist])

  // Smooth 1s tick for the “next poll in Ns” countdown
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Latest is at top — scroll log panel to top when new lines arrive
  useEffect(() => {
    const n = status?.logs?.length ?? 0
    if (!logCollapsed && n > prevLogLen.current) {
      logTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    prevLogLen.current = n
  }, [status?.logs, logCollapsed])

  async function forceTick() {
    setBusy(true)
    const path = momentumApiPath(displayTicker, 'tick')
    try {
      const res = await fetch(path, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok || body.ok === false) {
        if (body.status) setStatus(body.status as MomentumStatus)
        setError(await toUiError('Tick failed', res, body, 'Tick failed', path))
        return
      }
      setError(null)
      if (body.status) setStatus(body.status as MomentumStatus)
      else await load()
    } catch (err) {
      setError({
        title: 'Tick failed',
        message: err instanceof Error ? err.message : 'Tick failed',
        detail: {
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
          source: 'client',
          stack: err instanceof Error ? err.stack || null : null,
          path,
          endpoint: path,
        },
      })
    } finally {
      setBusy(false)
    }
  }

  async function saveThresholds() {
    setThresholdSaving(true)
    const path = momentumApiPath(displayTicker, 'thresholds')
    try {
      const thresholds: Record<string, number> = {}
      for (const [k, v] of Object.entries(thresholdDraft)) {
        const n = Number(v)
        if (Number.isFinite(n) && n >= 0) thresholds[k] = n
      }
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thresholds }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok || body.ok === false) {
        setError(
          await toUiError('Threshold save failed', res, body, 'Threshold save failed', path),
        )
        return
      }
      setError(null)
      if (body.status) setStatus(body.status as MomentumStatus)
      else await load()
      setThresholdOpen(false)
    } catch (err) {
      setError({
        title: 'Threshold save failed',
        message: err instanceof Error ? err.message : 'Threshold save failed',
        detail: {
          message: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
          source: 'client',
          stack: err instanceof Error ? err.stack || null : null,
          path,
          endpoint: path,
        },
      })
    } finally {
      setThresholdSaving(false)
    }
  }

  const snap = status?.snapshot ?? null
  const returns = snap?.returns
  const refTimes = snap?.referenceTimes
  const refPrices = snap?.references
  const episode = status?.episode ?? null
  const logs = status?.logs || []
  const sq = snap?.sessionQuote
  const badge = snap?.sessionBadge

  const marketStateFromQuote = String(tabQuote?.marketState || '').toUpperCase()
  // Yahoo marketState only (PREPRE = overnight via postMarket*)
  const sessionFromQuote = resolveClientMarketSession(
    tabQuote?.marketState,
    snap?.marketSession || sq?.session,
    nowMs,
  )
  const yahooActive = resolveYahooActiveSession(tabQuote)
  const isExtended =
    sessionFromQuote === 'PRE' ||
    sessionFromQuote === 'PREPRE' ||
    sessionFromQuote === 'POST' ||
    sessionFromQuote === 'POSTPOST'

  // ── Previous close = last completed session close (Yahoo) ──
  const prevClose =
    quotePreviousClose(tabQuote) ??
    (tabQuote?.regularMarketPreviousClose != null
      ? Number(tabQuote.regularMarketPreviousClose)
      : null) ??
    null

  // Prior of previous close (one session further back) — for previous-close day %
  const priorOfPrevClose = (() => {
    const fromQuote = quotePriorOfPreviousClose(tabQuote)
    if (fromQuote != null) return fromQuote
    const yPrev = Number(
      (sq as { yahooPreviousClose?: number | null } | null)?.yahooPreviousClose,
    )
    if (Number.isFinite(yPrev) && yPrev !== 0) return yPrev
    return null
  })()

  // Live price: Yahoo field group for marketState (PRE → pre*, PREPRE/POST → post*)
  const livePrice =
    yahooActive?.price ??
    quoteLivePrice(tabQuote) ??
    tabQuote?.regularMarketPrice ??
    null

  // Live session % = live print vs previous close (pre/post/regular session fields)
  const livePct =
    yahooActive?.changePercent ??
    quoteYahooSessionChangePercent(tabQuote) ??
    quoteChangePercent(tabQuote) ??
    pctFromPrices(livePrice, prevClose) ??
    null

  // Previous-close % = last close vs the close *before* it (NOT live vs prev close)
  // e.g. PRE: (regularMarketPrice − regularMarketPreviousClose) / prior × 100
  const prevClosePct =
    quotePreviousCloseDayPercent(tabQuote) ??
    pctFromPrices(prevClose, priorOfPrevClose) ??
    null

  const activeAssetClass =
    activeTab?.assetClass ||
    snap?.assetClass ||
    sq?.assetClass ||
    detectAssetClass(displayTicker)
  // Asset-aware last session (stocks ≠ gold ≠ bitcoin)
  const lastSessionMeta = resolveLastSessionMetaClient(displayTicker, activeAssetClass)
  const lastSessionShortLabel =
    snap?.lastSessionShortLabel ||
    sq?.lastSessionShortLabel ||
    lastSessionMeta.shortLabel
  const lastSessionLabel =
    snap?.lastSessionLabel || sq?.lastSessionLabel || lastSessionMeta.label
  // Time: Yahoo regularMarketTime when it is the frozen last print; else class estimate
  const prevCloseTime = (() => {
    const state = String(tabQuote?.marketState || '').toUpperCase()
    const regT = tabQuote?.regularMarketTime || null
    if (
      regT &&
      (state === 'PRE' ||
        state === 'PREPRE' ||
        state === 'POST' ||
        state === 'POSTPOST' ||
        state === 'CLOSED')
    ) {
      return regT
    }
    return (
      snap?.previousCloseTime ||
      sq?.previousCloseTime ||
      (prevClose != null ? lastSessionMeta.timeIso : null)
    )
  })()
  const quoteCurrency = tabQuote?.currency || null
  const yahooLiveUrl = yahooFinanceQuoteUrl(displayTicker)
  const yahooPrevUrl = yahooFinanceHistoryUrl(displayTicker)
  /** Direction of the *previous session* move (last close vs prior close) */
  const prevCloseMoveDir =
    prevClosePct == null || !Number.isFinite(prevClosePct)
      ? null
      : prevClosePct > 0.005
        ? 'up'
        : prevClosePct < -0.005
          ? 'down'
          : 'flat'

  // Label from Yahoo marketState only
  const sessionBracket = liveSessionBracket(
    sessionFromQuote === 'PRE'
      ? { code: 'PRE', label: 'Pre-market' }
      : sessionFromQuote === 'PREPRE'
        ? { code: 'PREPRE', label: 'Overnight' }
        : sessionFromQuote === 'POST' || sessionFromQuote === 'POSTPOST'
          ? { code: sessionFromQuote, label: 'After-hours' }
          : sessionFromQuote === 'CLOSED'
            ? { code: 'CLOSED', label: 'Market closed' }
            : sessionFromQuote === 'REGULAR'
              ? { code: 'REGULAR', label: 'Regular session' }
              : badge,
    sessionFromQuote,
    sessionFromQuote === 'POST' || sessionFromQuote === 'POSTPOST'
      ? 'After-hours'
      : sessionFromQuote === 'PRE'
        ? 'Pre-market'
        : sessionFromQuote === 'PREPRE'
          ? 'overnight'
          : sessionFromQuote === 'CLOSED'
            ? 'closed'
            : sessionFromQuote === 'REGULAR'
              ? 'regular'
              : snap?.marketStateLabel || sq?.marketStateLabel || marketStateFromQuote || null,
  )

  const pollMs = Math.max(5_000, Number(status?.pollIntervalMs) || 60_000)
  const lastFetchMs = status?.lastFetchAt ? Date.parse(status.lastFetchAt) : NaN
  const nextPollRemainingSec =
    Number.isFinite(lastFetchMs) && status?.loopRunning
      ? Math.max(0, Math.ceil((lastFetchMs + pollMs - nowMs) / 1000))
      : null
  const pollProgress =
    nextPollRemainingSec != null
      ? Math.min(1, Math.max(0, 1 - nextPollRemainingSec / (pollMs / 1000)))
      : 0

  const thrSnap = status?.config?.thresholdSnapshot
  /** Prefer fixed 2×10 order; day-first only reorders within that set. */
  const visibleReturnKeys: string[] = (() => {
    const allowed = new Set<string>(RETURN_KEYS_ALL)
    const base = [...RETURN_KEYS_ALL]
    const fromServer =
      snap?.visibleReturnKeys || status?.config?.visibleReturnKeys || null
    // Premarket etc.: server may put day first — honor that if day is present
    if (Array.isArray(fromServer) && fromServer[0] === 'day' && allowed.has('day')) {
      return ['day', ...base.filter((k) => k !== 'day')]
    }
    return base
  })()
  const showBridgeWindows = Boolean(
    snap?.showBridgeWindows ?? status?.config?.showBridgeWindows,
  )

  /** Day / session % for a watchlist tab (batch quotes; active prefers live momentum %). */
  function tabDayPct(ticker: string): number | null {
    if (ticker === displayTicker) {
      if (livePct != null && Number.isFinite(livePct)) return livePct
      if (snap?.returns?.day != null && Number.isFinite(snap.returns.day)) {
        return snap.returns.day
      }
    }
    const q =
      watchQuotes[ticker] ||
      watchQuotes[ticker.toUpperCase()] ||
      (ticker === displayTicker ? tabQuote : null)
    return quoteChangePercent(q)
  }

  function addWatchTicker(preset?: WatchTab) {
    const ticker = normalizeWatchTicker(preset?.ticker || addTicker)
    if (!ticker) return
    const assetClass = preset?.assetClass || detectAssetClass(ticker)
    const label =
      (preset?.label || addLabel).trim() ||
      ticker.replace(/=X$/, '').replace(/=F$/, '').replace(/-USD$/, '')
    const filterClass = tabAssetClass({ ticker, label, assetClass })
    if (ASSET_CLASS_TABS.some((t) => t.id === filterClass)) {
      setAssetClassTab(filterClass as AssetClassTabId)
      saveAssetClassFilter(filterClass as AssetClassTabId)
    }
    setWatchlist((prev) => {
      if (prev.some((t) => t.ticker === ticker)) {
        selectTicker(ticker)
        return prev
      }
      const next = [...prev, { ticker, label, assetClass }]
      saveWatchlist(next)
      return next
    })
    selectTicker(ticker)
    setAddTicker('')
    setAddLabel('')
    setSearchResults([])
    setSearchOpen(false)
    setSearchHighlight(0)
    setAddOpen(false)
  }

  function pickSearchResult(row: YahooSearchResult) {
    const ticker = normalizeWatchTicker(row.ticker)
    if (!ticker) return
    const name =
      row.companyName ||
      row.longName ||
      row.shortName ||
      row.label ||
      ticker
    addWatchTicker({
      ticker,
      label: name,
      assetClass: assetClassFromSearch(row),
    })
  }

  // Debounced Yahoo Finance typeahead while typing in Add
  useEffect(() => {
    if (!addOpen) return
    const q = addTicker.trim()
    if (q.length < 1) {
      setSearchResults([])
      setSearchLoading(false)
      setSearchHighlight(0)
      setSearchError(null)
      return
    }
    let cancelled = false
    setSearchLoading(true)
    setSearchOpen(true)
    setSearchError(null)
    const timer = window.setTimeout(() => {
      searchYahooSaved(q)
        .then((body) => {
          if (cancelled) return
          const rows = (body.tickers || []).filter((row) => Boolean(row.ticker))
          setSearchResults(rows)
          setSearchHighlight(0)
          setSearchError(null)
        })
        .catch((err) => {
          if (cancelled) return
          setSearchResults([])
          setSearchError(
            err instanceof Error
              ? err.message
              : typeof err === 'string'
                ? err
                : 'Yahoo search failed',
          )
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [addTicker, addOpen])

  // Click outside closes the typeahead
  useEffect(() => {
    if (!searchOpen) return
    function onPointerDown(event: MouseEvent) {
      if (!searchBoxRef.current) return
      if (!searchBoxRef.current.contains(event.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [searchOpen])

  function removeWatchTicker(ticker: string) {
    setWatchlist((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((t) => t.ticker !== ticker)
      saveWatchlist(next)
      if (activeTicker === ticker) {
        selectTicker(next[0]?.ticker || 'SNDK')
      }
      return next
    })
  }

  async function loadAlertDevices() {
    setAlertDevicesLoading(true)
    setAlertDevicesError('')
    try {
      const res = await fetch(
        `/api/notifications/devices?app=trigger&_=${Date.now()}`,
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      const list = ((body.devices || []) as AlertDevice[]).filter((d) => {
        // Prefer alertable devices (enabled subscription)
        if (d.enabled === false) return false
        if (d.subscription_status === 'off') return false
        return Boolean(d.expo_push_token || d.device_id)
      })
      setAlertDevices(list)
      setAlertDeviceKeys(list.map(deviceKey))
    } catch (err) {
      setAlertDevices([])
      setAlertDeviceKeys([])
      setAlertDevicesError(
        err instanceof Error ? err.message : 'Failed to load devices',
      )
    } finally {
      setAlertDevicesLoading(false)
    }
  }

  /** Persist partner/user knowledge in the prompt (minus this alert’s INPUT). */
  function persistEditedResearchPrompt(
    filledPrompt: string,
    assetClass?: string | null,
    userMovement?: string | null,
    inputFacts?: string | null,
  ) {
    const cls = assetClass || activeAssetClass || 'equity'
    const um = userMovement ?? alertUserMovement
    const facts = inputFacts ?? alertInputFacts
    const template = editedResearchPromptToTemplate(filledPrompt, um, facts)
    if (!template.trim()) return false
    saveResearchPromptTemplate(cls, template)
    setAlertUsingSavedPrompt(true)
    setAlertPromptDirty(false)
    return true
  }

  function openReturnAlert(windowKey: string) {
    // Always refresh quote + force engine tick when a trigger card is opened
    void forceTick()
    void refreshTabQuote({ silent: true })
    const val = status?.snapshot?.returns?.[windowKey]
    const exact = status?.snapshot?.exactLookbacks?.[windowKey]
    const company = activeTab?.label || displayTicker
    const sessionCode =
      status?.snapshot?.marketSession || null
    const copy = buildMomentumAlertCopy({
      companyName: company,
      ticker: displayTicker,
      windowKey,
      movePercent: val,
      exact: exact ?? null,
      marketSession: sessionCode,
    })
    setAlertWindowKey(windowKey)
    setAlertTitle(copy.title)
    setAlertBody(copy.body)
    setAlertSendMessage('')
    setAlertSendError(false)
    setAlertResearchError('')
    setAlertResearchMeta(null)
    setAlertResearchSteps([])
    setAlertGeminiPrompt('')
    setAlertUserMovement('')
    setAlertInputFacts('')
    setAlertPromptDirty(false)
    const savedTemplate = loadResearchPromptTemplate(activeAssetClass)
    setAlertUsingSavedPrompt(Boolean(savedTemplate))
    setAlertPromptOpen(true)
    setAlertOpen(true)
    void loadAlertDevices()
    // Prefill editable prompt so user can review/edit before Run research
    void (async () => {
      try {
        setAlertResearchSteps([
          {
            id: 'build_prompt',
            label: 'Build research prompt',
            status: 'running',
            detail: savedTemplate
              ? 'Using your saved prompt template…'
              : 'Preparing USER MOVEMENT + asset-class template…',
          },
        ])
        const sessionCode2 =
          status?.snapshot?.marketSession || sessionFromQuote || null
        const windowLabel = returnKeyDisplayLabel(windowKey, sessionCode2)
        const res = await fetch('/api/notifications/momentum-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker: displayTicker,
            company_name: company,
            window_key: windowKey,
            window_label: windowLabel,
            exact_label: exact?.exactLabel || null,
            exact_minutes: exact?.exactMinutes ?? null,
            move_percent: val,
            live_price: livePrice ?? status?.snapshot?.currentPrice ?? null,
            reference_price:
              exact?.referencePrice ??
              status?.snapshot?.references?.[windowKey] ??
              prevClose ??
              null,
            reference_time:
              exact?.referenceTime ??
              status?.snapshot?.referenceTimes?.[windowKey] ??
              prevCloseTime ??
              null,
            market_session: sessionCode2,
            asset_class: activeAssetClass,
            phase: 'prepare',
            // Reuse partner/user edits for this asset class
            prompt_template: savedTemplate || undefined,
          }),
        })
        const body = await res.json().catch(() => ({}))
        if (res.ok && body.prompt) {
          setAlertGeminiPrompt(String(body.prompt))
          setAlertUserMovement(String(body.user_movement || ''))
          setAlertInputFacts(String(body.input_facts || ''))
          setAlertPromptDirty(false)
          setAlertUsingSavedPrompt(Boolean(savedTemplate))
        }
        if (Array.isArray(body.process_steps)) {
          const steps = body.process_steps as ResearchStep[]
          setAlertResearchSteps(
            savedTemplate
              ? steps.map((s) =>
                  s.id === 'build_prompt'
                    ? {
                        ...s,
                        detail: `${s.detail || ''} · saved custom template`.trim(),
                      }
                    : s,
                )
              : steps,
          )
        } else {
          setAlertResearchSteps([
            {
              id: 'build_prompt',
              label: 'Build research prompt',
              status: res.ok ? 'done' : 'error',
              detail: res.ok
                ? `${String(body.prompt || '').length.toLocaleString()} chars${
                    savedTemplate ? ' · saved template' : ''
                  }`
                : body.error || 'failed',
            },
          ])
        }
      } catch {
        setAlertResearchSteps([
          {
            id: 'build_prompt',
            label: 'Build research prompt',
            status: 'error',
            detail: 'Will rebuild on Run research',
          },
        ])
      }
    })()
  }

  /**
   * Run Perplexity Sonar (built-in web search). Updates live process steps,
   * tokens, cost, model, tools, and web sources in column 1.
   */
  async function runMomentumResearch() {
    const base = researchPayloadBase()
    if (!base) {
      setAlertResearchError('Pick a return window first.')
      return
    }

    setAlertResearchBusy(true)
    setAlertResearchError('')
    setAlertResearchMeta(null)
    setAlertPromptOpen(true)
    setAlertResearchSteps([
      {
        id: 'classify',
        label: 'Asset class + movement',
        status: 'running',
        detail: `${base.asset_class || 'equity'} · ${base.window_key}`,
      },
      {
        id: 'build_prompt',
        label: 'Build research prompt',
        status: 'pending',
      },
      {
        id: 'call_perplexity',
        label: 'Call Perplexity Sonar',
        status: 'pending',
        detail: 'Model + web_search tool',
      },
      {
        id: 'web_search',
        label: 'Web search / grounding',
        status: 'pending',
      },
      {
        id: 'parse_output',
        label: 'Parse Likely / Secondary driver',
        status: 'pending',
      },
      {
        id: 'fill_push',
        label: 'Fill push title + body',
        status: 'pending',
      },
    ])

    try {
      // 1) Build exact prompt
      setAlertResearchSteps((prev) =>
        prev.map((s) =>
          s.id === 'classify'
            ? { ...s, status: 'done', detail: `${base.asset_class} · ready` }
            : s.id === 'build_prompt'
              ? { ...s, status: 'running', detail: 'Building…' }
              : s,
        ),
      )
      const savedTemplate = loadResearchPromptTemplate(
        base.asset_class || activeAssetClass,
      )
      const prepRes = await fetch('/api/notifications/momentum-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...base,
          phase: 'prepare',
          // Prefer current editor text; else refill from saved template
          prompt: alertGeminiPrompt.trim() || undefined,
          prompt_template: alertGeminiPrompt.trim()
            ? undefined
            : savedTemplate || undefined,
        }),
      })
      const prep = await prepRes.json().catch(() => ({}))
      if (!prepRes.ok) {
        throw new Error(prep.error || `Prepare failed (${prepRes.status})`)
      }
      if (prep.user_movement) setAlertUserMovement(String(prep.user_movement))
      if (prep.input_facts) setAlertInputFacts(String(prep.input_facts))
      const builtPrompt = String(prep.prompt || alertGeminiPrompt || '').trim()
      if (builtPrompt) setAlertGeminiPrompt(builtPrompt)
      if (!builtPrompt) {
        throw new Error('Empty research prompt — missing USER MOVEMENT input')
      }
      // Save any edits to instructions/knowledge for next alert
      persistEditedResearchPrompt(
        builtPrompt,
        base.asset_class || activeAssetClass,
        String(prep.user_movement || alertUserMovement || ''),
        String(prep.input_facts || alertInputFacts || ''),
      )
      setAlertResearchSteps((prev) =>
        prev.map((s) =>
          s.id === 'build_prompt'
            ? {
                ...s,
                status: 'done',
                detail: `${builtPrompt.length.toLocaleString()} chars · ${prep.model || 'perplexity/deepseek-v4-flash-0731'}`,
              }
            : s.id === 'call_perplexity'
              ? {
                  ...s,
                  status: 'running',
                  detail: `POST /v1/agent · ${prep.model || 'perplexity/deepseek-v4-flash-0731'}`,
                }
              : s,
        ),
      )

      // 2) Perplexity Sonar
      const res = await fetch('/api/notifications/momentum-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...base,
          phase: 'run',
          prompt: builtPrompt,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (body.prompt) setAlertGeminiPrompt(String(body.prompt))

      if (Array.isArray(body.process_steps)) {
        setAlertResearchSteps(body.process_steps as ResearchStep[])
      }

      if (!res.ok) {
        setAlertResearchSteps((prev) =>
          prev.map((s) =>
            s.status === 'running' || s.status === 'pending'
              ? {
                  ...s,
                  status: s.id === 'call_perplexity' ? 'error' : s.status,
                  detail:
                    s.id === 'call_perplexity'
                      ? body.error || `HTTP ${res.status}`
                      : s.detail,
                }
              : s,
          ),
        )
        const msg =
          body.error ||
          `Perplexity research failed (${res.status}). Check PERPLEXITY_API_KEY.`
        setAlertResearchError(msg)
        window.alert(`Momentum research failed.\n\n${msg}`)
        return
      }

      if (body.push_title) setAlertTitle(String(body.push_title))
      if (body.push_body) setAlertBody(String(body.push_body))
      setAlertResearchMeta({
        likely_driver: body.likely_driver ?? null,
        reason: body.reason ?? null,
        cost_usd_display: body.cost_usd_display ?? null,
        user_movement: body.user_movement ?? null,
        asset_class: body.asset_class ?? base.asset_class ?? null,
        model:
          body.model_version ||
          body.model ||
          'perplexity/deepseek-v4-flash-0731',
        provider: body.provider || 'perplexity',
        request_id: body.request_id ?? null,
        tokens: body.tokens ?? {
          prompt: body.usage?.prompt_tokens ?? body.usage?.promptTokenCount,
          completion:
            body.usage?.completion_tokens ?? body.usage?.candidatesTokenCount,
          total: body.usage?.total_tokens ?? body.usage?.totalTokenCount,
          search_context_size: body.usage_raw?.search_context_size ?? null,
        },
        cost: body.cost ?? null,
        tools: Array.isArray(body.tools) ? body.tools : [],
        citations: Array.isArray(body.citations)
          ? body.citations
          : Array.isArray(body.sources)
            ? body.sources
            : [],
        search_results: Array.isArray(body.search_results)
          ? body.search_results
          : [],
        supabase_save: body.supabase_save ?? null,
      })
      if (body.supabase_save && body.supabase_save.ok === false) {
        setAlertResearchError(
          `Research OK, but Supabase save failed: ${body.supabase_save.error || 'unknown'}. Run schema_momentum_research_tables.sql if tables are missing.`,
        )
      }
      // Refresh spend chip after each research call
      void loadPerplexityUsage()

      // Record "Perplexity done" on the Recent Events timeline (after backend event)
      try {
        const tlRes = await fetch(
          momentumApiPath(displayTicker, 'timeline-event'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'research',
              detectedWindow: base.window_key || alertWindowKey,
              movePercent: base.move_percent,
              price: base.live_price,
              direction:
                Number(base.move_percent) < 0 ? 'DOWN' : 'UP',
              marketSession: base.market_session,
              research: {
                reason: body.reason ?? null,
                likely_driver: body.likely_driver ?? null,
                provider: body.provider || 'perplexity',
                model:
                  body.model_version ||
                  body.model ||
                  'perplexity/deepseek-v4-flash-0731',
                citations: Array.isArray(body.citations)
                  ? body.citations
                  : [],
                search_results: Array.isArray(body.search_results)
                  ? body.search_results
                  : [],
                cost_usd_display: body.cost_usd_display ?? null,
                completedAt: new Date().toISOString(),
              },
            }),
          },
        )
        const tlBody = await tlRes.json().catch(() => ({}))
        if (tlBody?.status) setStatus(tlBody.status as MomentumStatus)
        else void load()
      } catch {
        /* timeline marker is best-effort */
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Perplexity research failed'
      setAlertResearchError(msg)
      setAlertResearchSteps((prev) =>
        prev.map((s) =>
          s.status === 'running'
            ? { ...s, status: 'error', detail: msg }
            : s,
        ),
      )
      window.alert(`Momentum research failed.\n\n${msg}`)
    } finally {
      setAlertResearchBusy(false)
    }
  }

  /** Manually end / exit the live momentum episode (no push). */
  async function endActiveEpisode() {
    if (endingEpisode) return
    const dir = episode?.direction || 'episode'
    const peak =
      episode && Number.isFinite(episode.peakMovePercent)
        ? fmtPct(episode.peakMovePercent)
        : ''
    const ok = window.confirm(
      `End the active ${dir} episode for ${displayTicker}?${
        peak ? `\nPeak so far: ${peak}` : ''
      }\n\nThis only closes tracking — no push is sent. A new episode can start on the next threshold cross.`,
    )
    if (!ok) return

    setEndingEpisode(true)
    try {
      const res = await fetch(momentumApiPath(displayTicker, 'end-episode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'MANUAL' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || `End failed (${res.status})`)
      }
      if (body?.status) setStatus(body.status as MomentumStatus)
      else void load()
      setEpisodeByTicker((prev) => ({
        ...prev,
        [displayTicker.toUpperCase()]: null,
      }))
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'Failed to end episode',
      )
    } finally {
      setEndingEpisode(false)
    }
  }

  async function sendMomentumAlert() {
    const title = alertTitle.trim()
    const body = alertBody.trim()
    if (!title || !body) {
      setAlertSendMessage('Title and body are required.')
      setAlertSendError(true)
      return
    }
    const selected = alertDevices.filter((d) =>
      alertDeviceKeys.includes(deviceKey(d)),
    )
    if (!selected.length) {
      setAlertSendMessage('Select at least one device.')
      setAlertSendError(true)
      return
    }
    const ok = window.confirm(
      `Send this notification to ${selected.length} device(s)?\n\n${title}\n${body.slice(0, 180)}${body.length > 180 ? '…' : ''}`,
    )
    if (!ok) return

    setAlertSending(true)
    setAlertSendMessage('')
    setAlertSendError(false)
    try {
      const res = await fetch('/api/notifications/alert-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'custom_alert',
          app_key: 'trigger',
          title,
          body,
          device_ids: selected.map((d) => d.device_id).filter(Boolean),
          expo_push_tokens: selected.map((d) => d.expo_push_token),
        }),
      })
      const resBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(resBody.error || `Send failed (${res.status})`)
      }
      const msg =
        resBody.message ||
        `Sent to ${resBody.sent_ok ?? selected.length} device(s)`
      setAlertSendMessage(msg)
      setAlertSendError(Boolean(resBody.sent_failed))

      // Record "Alert sent" on the Recent Events timeline (after Perplexity)
      try {
        const base = researchPayloadBase()
        const tlRes = await fetch(
          momentumApiPath(displayTicker, 'timeline-event'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'alert',
              detectedWindow: base?.window_key || alertWindowKey,
              movePercent: base?.move_percent,
              price: base?.live_price,
              direction:
                Number(base?.move_percent) < 0 ? 'DOWN' : 'UP',
              marketSession: base?.market_session,
              notification: { title, body },
              research: alertResearchMeta
                ? {
                    reason: alertResearchMeta.reason,
                    likely_driver: alertResearchMeta.likely_driver,
                    provider: alertResearchMeta.provider || 'perplexity',
                    model: alertResearchMeta.model,
                    citations: alertResearchMeta.citations || [],
                    search_results:
                      alertResearchMeta.search_results || [],
                    cost_usd_display:
                      alertResearchMeta.cost_usd_display,
                  }
                : null,
              pushResult: {
                ok: !resBody.sent_failed,
                sent_ok: resBody.sent_ok ?? selected.length,
                sent_failed: resBody.sent_failed || 0,
                recipient_count: selected.length,
                source: 'manual',
              },
            }),
          },
        )
        const tlBody = await tlRes.json().catch(() => ({}))
        if (tlBody?.status) setStatus(tlBody.status as MomentumStatus)
        else void load()
      } catch {
        /* timeline marker is best-effort */
      }
    } catch (err) {
      setAlertSendMessage(
        err instanceof Error ? err.message : 'Failed to send notification',
      )
      setAlertSendError(true)
    } finally {
      setAlertSending(false)
    }
  }

  return (
    <div
      data-momentum-dashboard
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {/* ── Full-height split: left rail | detail (+ log) ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Column 1 — asset icons + label + count + entity list */}
        <aside className="flex w-[min(100%,16.5rem)] shrink-0 flex-col border-r border-border bg-background sm:w-64">
          <div className="flex shrink-0 flex-col px-2 pt-2">
            {/* Asset-class pill (Stocks / FX / Crypto / …) */}
            <div
              className="mb-6 flex w-full items-center justify-between gap-0.5 rounded-full border border-border bg-muted p-0.5"
              role="tablist"
              aria-label="Asset class"
            >
              {ASSET_CLASS_TABS.map((tab) => {
                const active = assetClassTab === tab.id
                const Icon = tab.Icon
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={tab.label}
                    aria-label={tab.label}
                    onClick={() => selectAssetClassTab(tab.id)}
                    className={cn(
                      'inline-flex size-8 flex-1 items-center justify-center rounded-full transition-colors',
                      active
                        ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-3.5" strokeWidth={1.75} />
                  </button>
                )
              })}
            </div>
            {/* Class label + entities */}
            <div className="flex items-start justify-between gap-2 px-1 pb-1">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">
                  {ASSET_CLASS_TABS.find((t) => t.id === assetClassTab)?.label ||
                    'Stocks'}
                </p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {filteredWatchlist.length} entit
                  {filteredWatchlist.length === 1 ? 'y' : 'ies'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => setAddOpen((o) => !o)}
                title="Add entity"
                aria-label="Add entity"
              >
                <Plus className="size-3.5" strokeWidth={2.25} />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-0.5 px-2 pb-2 pt-1">
              {filteredWatchlist.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  No{' '}
                  {(
                    ASSET_CLASS_TABS.find((t) => t.id === assetClassTab)
                      ?.label || 'items'
                  ).toLowerCase()}{' '}
                  yet. Tap + to add.
                </p>
              ) : (
                filteredWatchlist.map((tab) => {
                  const dayPct = tabDayPct(tab.ticker)
                  const active =
                    tab.ticker.toUpperCase() === displayTicker.toUpperCase()
                  const fullName = String(tab.label || '').trim()
                  const shortName = companyNameTwoWords(fullName)
                  const showName =
                    shortName.length > 0 &&
                    shortName.toUpperCase() !== tab.ticker.toUpperCase()
                  const rowQuote =
                    watchQuotes[tab.ticker] ||
                    watchQuotes[tab.ticker.toUpperCase()] ||
                    (active ? tabQuote : null)
                  const epHint =
                    episodeByTicker[tab.ticker.toUpperCase()] ||
                    episodeByTicker[tab.ticker] ||
                    null
                  const hasActiveEp = Boolean(epHint)
                  return (
                    <div
                      key={tab.ticker}
                      className={cn(
                        'w-full rounded-md',
                        active && 'bg-muted',
                      )}
                      onContextMenu={(e) => {
                        if (watchlist.length <= 1) return
                        e.preventDefault()
                        e.stopPropagation()
                        setWatchContextMenu({
                          ticker: tab.ticker,
                          label: fullName || tab.ticker,
                          x: e.clientX,
                          y: e.clientY,
                        })
                      }}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        data-pill="false"
                        onClick={() => {
                          setWatchContextMenu(null)
                          selectTicker(tab.ticker)
                        }}
                        className={cn(
                          'h-auto min-h-10 w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left',
                          active && 'bg-transparent hover:bg-transparent',
                          hotBlinkClass(dayPct),
                        )}
                        title={
                          hasActiveEp
                            ? `${tab.ticker}${fullName ? ` · ${fullName}` : ''} · active ${epHint!.direction} episode${epHint!.window ? ` (${epHint!.window})` : ''}`
                            : fullName
                              ? `${tab.ticker} · ${fullName}`
                              : tab.ticker
                        }
                      >
                        <CompanyLogo
                          ticker={tab.ticker}
                          companyName={fullName || tab.ticker}
                          quote={rowQuote}
                          size="sm"
                          className="self-center"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-baseline justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-mono text-[13px] font-semibold tracking-tight">
                                {tab.ticker}
                              </span>
                              {hasActiveEp ? (
                                <span
                                  className={cn(
                                    'relative inline-flex size-2 shrink-0',
                                  )}
                                  title={`Active ${epHint!.direction} episode`}
                                  aria-label={`Active ${epHint!.direction} episode`}
                                >
                                  <span
                                    className={cn(
                                      'absolute inline-flex size-full animate-ping rounded-full opacity-60',
                                      epHint!.direction === 'DOWN'
                                        ? 'bg-rose-500'
                                        : 'bg-emerald-500',
                                    )}
                                  />
                                  <span
                                    className={cn(
                                      'relative inline-flex size-2 rounded-full',
                                      epHint!.direction === 'DOWN'
                                        ? 'bg-rose-500'
                                        : 'bg-emerald-500',
                                    )}
                                  />
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 tabular-nums text-[14px] font-semibold',
                                dayPct != null
                                  ? pctColor(dayPct)
                                  : 'text-muted-foreground',
                              )}
                            >
                              {dayPct != null ? fmtPct(dayPct) : '—'}
                            </span>
                          </span>
                          {showName ? (
                            <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
                              {shortName}
                            </span>
                          ) : null}
                        </span>
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right-click context menu — remove stock */}
          {watchContextMenu ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-[60] cursor-default bg-transparent"
                aria-label="Close menu"
                onClick={() => setWatchContextMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setWatchContextMenu(null)
                }}
              />
              <div
                role="menu"
                className="fixed z-[70] min-w-[10.5rem] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
                style={{
                  left: Math.min(watchContextMenu.x, window.innerWidth - 180),
                  top: Math.min(watchContextMenu.y, window.innerHeight - 56),
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
                  onClick={() => {
                    removeWatchTicker(watchContextMenu.ticker)
                    setWatchContextMenu(null)
                  }}
                >
                  <Trash2 className="size-3.5 shrink-0" strokeWidth={1.75} />
                  Remove
                </button>
              </div>
            </>
          ) : null}

        </aside>

        {/* Right stack: detail · optional log */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Column 2 — selected entity detail */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="w-full space-y-4 px-3 py-3 sm:px-4 sm:py-4">
          {/* Row 1: left = logo + name + pricing · right = chart · top-right = subscribers */}
          {(() => {
            const companyName =
              activeTab?.label ||
              tabQuote?.longName ||
              tabQuote?.shortName ||
              displayTicker
            const subCount = tickerSubscribers.length
            return (
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <CompanyLogo
                  ticker={displayTicker}
                  companyName={companyName}
                  quote={tabQuote}
                  size="lg"
                  asLink
                />

                {/* Name + pricing (subscribers pill next to company name) */}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <a
                      href={`https://www.perplexity.ai/finance/${encodeURIComponent(displayTicker)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 max-w-full truncate text-xl font-semibold tracking-tight text-foreground transition-opacity hover:opacity-80 hover:underline sm:text-2xl"
                      title={`Open ${companyName} on Perplexity Finance`}
                    >
                      {companyName}
                    </a>
                    {activeAssetClass && activeAssetClass !== 'equity' ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 uppercase tracking-wide"
                      >
                        {activeAssetClass === 'commodity'
                          ? 'commodity'
                          : activeAssetClass}
                      </Badge>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          !logCollapsed &&
                          rightRailMode === 'subscribers'
                        ) {
                          setRightRailMode('logs')
                          return
                        }
                        openSubscribersInLogColumn()
                      }}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium transition-colors',
                        !logCollapsed && rightRailMode === 'subscribers'
                          ? 'border-foreground/20 bg-foreground text-background'
                          : 'border-border bg-muted/40 text-foreground hover:bg-muted',
                      )}
                      title={`${subCount} subscriber${subCount === 1 ? '' : 's'} for ${displayTicker}`}
                      aria-label={`View ${subCount} subscribers for ${displayTicker}`}
                      aria-pressed={
                        !logCollapsed && rightRailMode === 'subscribers'
                      }
                    >
                      {subsLoading ? (
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      ) : (
                        <Users
                          className="size-3.5 text-muted-foreground"
                          strokeWidth={1.75}
                        />
                      )}
                      <span className="tabular-nums font-semibold">
                        {subCount}
                      </span>
                    </button>
                  </div>
                  <a
                    href={yahooLiveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 transition-opacity hover:opacity-80"
                    title={`Open ${displayTicker} on Yahoo Finance`}
                  >
                    {livePct != null ? (
                      <span
                        className={cn(
                          'text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl',
                          pctColor(livePct),
                        )}
                      >
                        {fmtPct(livePct)}
                      </span>
                    ) : null}
                    <span className="text-xl font-normal tabular-nums tracking-tight text-foreground sm:text-2xl">
                      {fmtPrice(livePrice, activeAssetClass, quoteCurrency)}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground">
                      Live
                      {tabQuoteLoading ? ' · …' : ''}
                      {' · '}
                      {fmtDateClock(
                        tabQuote?.preMarketTime &&
                          String(tabQuote.marketState || '').toUpperCase() ===
                            'PRE'
                          ? tabQuote.preMarketTime
                          : tabQuote?.postMarketTime &&
                              ['POST', 'POSTPOST', 'PREPRE'].includes(
                                String(
                                  tabQuote.marketState || '',
                                ).toUpperCase(),
                              )
                            ? tabQuote.postMarketTime
                            : tabQuote?.regularMarketTime,
                      ) || '—'}
                    </span>
                  </a>
                  <a
                    href={yahooLiveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-muted-foreground transition-opacity hover:opacity-80"
                    title="Previous close"
                  >
                    <span>Prev close</span>
                    <span className="font-semibold tabular-nums text-foreground/80">
                      {fmtPrice(prevClose, activeAssetClass, quoteCurrency)}
                    </span>
                    <span
                      className={cn(
                        'font-semibold tabular-nums',
                        prevClosePct != null
                          ? pctColor(prevClosePct)
                          : 'text-muted-foreground',
                      )}
                    >
                      {prevClosePct != null ? fmtPct(prevClosePct) : '—'}
                    </span>
                    <span className="tabular-nums">
                      {fmtDateClock(prevCloseTime) || ''}
                    </span>
                  </a>
                </div>

                {/* Mini chart — extreme right of the row */}
                <button
                  type="button"
                  onClick={() => setChartExpanded((v) => !v)}
                  className="group relative ml-auto h-[5.25rem] w-[11rem] shrink-0 overflow-hidden border-0 bg-transparent p-0 text-left transition-opacity hover:opacity-90 sm:h-[6rem] sm:w-[14rem]"
                  title={
                    chartExpanded
                      ? 'Collapse expanded chart'
                      : 'Expand full interactive chart'
                  }
                  aria-expanded={chartExpanded}
                >
                  <div className="pointer-events-none h-full w-full select-none">
                    <YahooInteractiveChart
                      key={`${displayTicker}-mini`}
                      ticker={displayTicker}
                      title={`${displayTicker} · Yahoo`}
                      height={96}
                      defaultRange="1d"
                      compact
                    />
                  </div>
                  <span className="pointer-events-none absolute bottom-0.5 right-1 z-10 inline-flex items-center gap-0.5 rounded bg-background/70 px-1 text-[9px] font-medium text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                    {chartExpanded ? (
                      <>
                        Collapse
                        <ChevronUp className="size-2.5" />
                      </>
                    ) : (
                      <>
                        Expand
                        <ChevronDown className="size-2.5" />
                      </>
                    )}
                  </span>
                </button>
              </div>
            )
          })()}

          {error ? (
            <ErrorBanner
              tone="rose"
              title={error.title}
              message={error.message}
              detail={error.detail}
              onDismiss={() => setError(null)}
            />
          ) : null}
          {status?.lastError || status?.lastErrorDetail ? (
            <ErrorBanner
              tone="amber"
              title={`Last engine error · ${status.ticker || displayTicker}`}
              message={
                status.lastErrorDetail?.message ||
                status.lastError ||
                'Unknown Yahoo / engine error'
              }
              detail={
                status.lastErrorDetail || {
                  message: status.lastError || 'Unknown error',
                  at: status.lastFetchAt,
                  source: 'yahoo',
                  endpoint: `momentum:${status.ticker || displayTicker}`,
                }
              }
            />
          ) : null}

          {loading && !status ? (
            <div className="flex items-center gap-2 text-sm text-[#6B7280]">
              <Loader2 className="size-4 animate-spin" />
              Loading momentum status…
            </div>
          ) : null}

          {/* Expanded chart — between header/mini chart and rolling returns */}
          {chartExpanded ? (
            <div className="min-w-0 space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="text-sm font-medium">
                  Yahoo price chart · hover for share price
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 rounded-full px-3 text-[12px]"
                  onClick={() => setChartExpanded(false)}
                >
                  <ChevronUp className="size-3.5" />
                  Collapse
                </Button>
              </div>
              <YahooInteractiveChart
                key={`${displayTicker}-expanded`}
                ticker={displayTicker}
                title={`${displayTicker} · Yahoo`}
                height={320}
                defaultRange="1d"
                borderless
              />
            </div>
          ) : null}

          {/* Row 2: Rolling returns — rounded bordered panel */}
          <div className="mb-4 mt-2 w-full space-y-2.5 rounded-2xl border border-border bg-muted/20 p-3 sm:p-4">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <p className="text-base font-semibold tracking-tight">
                Rolling returns
              </p>
              {nextPollRemainingSec != null ? (
                <PollTimerBadge
                  remainingSec={nextPollRemainingSec}
                  pollMs={pollMs}
                  pollProgress={pollProgress}
                />
              ) : null}
              {/* Settings directly beside the poll counter */}
              <div className="relative shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setThresholdOpen((o) => !o)}
                  title={`${activeTab?.label || displayTicker} settings`}
                  aria-label={`${activeTab?.label || displayTicker} settings`}
                  aria-expanded={thresholdOpen}
                  aria-haspopup="dialog"
                >
                  <Settings className="size-3.5" strokeWidth={2} />
                </Button>
                {thresholdOpen ? (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-40 cursor-default bg-transparent"
                      aria-label="Close ticker settings"
                      onClick={() => setThresholdOpen(false)}
                    />
                    <div
                      role="dialog"
                      aria-label={`${displayTicker} settings`}
                      className="absolute left-0 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/5"
                    >
                      <div className="mb-2 min-w-0">
                        <p className="truncate text-sm font-semibold tracking-tight">
                          {activeTab?.label || displayTicker}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {displayTicker}
                          {activeAssetClass ? ` · ${activeAssetClass}` : ''}
                        </p>
                      </div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        |move %| thresholds
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Applied when this ticker is the active tab
                      </p>
                      <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {THRESHOLD_EDIT_KEYS.map((key) => (
                          <label key={key} className="block">
                            <span className="text-[10px] font-medium uppercase text-muted-foreground">
                              {key}
                            </span>
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={thresholdDraft[key] ?? ''}
                              onChange={(e) =>
                                setThresholdDraft((d) => ({
                                  ...d,
                                  [key]: e.target.value,
                                }))
                              }
                              className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1 text-[12px] font-semibold tabular-nums text-foreground"
                            />
                          </label>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={thresholdSaving}
                          onClick={() => void saveThresholds()}
                        >
                          {thresholdSaving ? 'Saving…' : 'Save'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setThresholdOpen(false)}
                        >
                          Close
                        </Button>
                      </div>
                      {onOpenInTrigger ? (
                        <>
                          <Separator className="my-3" />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-full justify-start gap-2 px-2"
                            onClick={() => {
                              setThresholdOpen(false)
                              onOpenInTrigger(
                                displayTicker,
                                activeTab?.label || displayTicker,
                              )
                            }}
                          >
                            <ExternalLink className="size-3.5" />
                            Open {displayTicker} in Trigger
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
              {busy ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Running…
                </span>
              ) : null}
            </div>
            <TooltipProvider delayDuration={200}>
              <div className="grid grid-cols-5 content-start gap-1.5 sm:grid-cols-11 sm:gap-2">
                {visibleReturnKeys.map((key) => {
                  const val = returns?.[key]
                  const when = refTimes?.[key]
                  const refPx = refPrices?.[key]
                  const exact = snap?.exactLookbacks?.[key]
                  const thr =
                    key === 'day'
                      ? thrSnap?.day
                      : thrSnap?.windows?.[key] != null
                        ? thrSnap.windows[key]
                        : null
                  const isBridge = BRIDGE_KEYS.has(key)
                  const isDay = key === 'day'
                  const isMaxLastHourCard =
                    snap?.strongestLastHourWindows?.window === key
                  const isBestOverall =
                    snap?.strongestMomentum?.window === key
                  const sessionCode =
                    snap?.marketSession || sessionFromQuote || null
                  const label = returnKeyDisplayLabel(key, sessionCode)
                  const calc = buildReturnCalcDetail({
                    key,
                    label,
                    value: val,
                    referencePrice: refPx,
                    referenceTime: when,
                    currentPrice: livePrice ?? snap?.currentPrice,
                    asOfTime: snap?.asOfTime || status?.lastFetchAt,
                    previousClose: prevClose ?? snap?.previousClose,
                    marketSession: sessionCode,
                    threshold: thr,
                    isBridge,
                  })
                  const hasValue = val != null && Number.isFinite(val)
                  // Footer: ref price or clock — never "exact Nm"
                  const footerText = (() => {
                    if (refPx != null && Number.isFinite(Number(refPx))) {
                      return `from ${fmtPrice(Number(refPx), activeAssetClass, quoteCurrency)}`
                    }
                    if (when) return fmtClock(when) || fmtTime(when) || '—'
                    if (key === 'day') return 'vs prior close'
                    return '—'
                  })()
                  return (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          data-pill="false"
                          disabled={!hasValue}
                          onClick={() => {
                            if (hasValue) openReturnAlert(key)
                          }}
                          className={cn(
                            'h-auto min-h-[3.25rem] flex-col items-start justify-center gap-0.5 rounded-xl border-0 bg-muted/40 px-1.5 py-1.5 text-left whitespace-normal shadow-none sm:min-h-[3.5rem] sm:px-2 sm:py-2',
                            hasValue
                              ? 'cursor-pointer'
                              : 'cursor-not-allowed opacity-55',
                            // Calm tint by sign: green up · red down
                            hasValue &&
                              val != null &&
                              val > 0 &&
                              'bg-emerald-500/12 hover:bg-emerald-500/18',
                            hasValue &&
                              val != null &&
                              val < 0 &&
                              'bg-rose-500/12 hover:bg-rose-500/18',
                            hasValue &&
                              val != null &&
                              val === 0 &&
                              'hover:bg-muted',
                            isBridge && 'bg-violet-500/10 hover:bg-violet-500/15',
                            isMaxLastHourCard &&
                              !isBestOverall &&
                              'bg-amber-500/12 hover:bg-amber-500/18',
                            isBestOverall &&
                              (snap?.strongestMomentum?.direction === 'DOWN'
                                ? 'bg-rose-500/22 hover:bg-rose-500/28'
                                : 'bg-emerald-500/22 hover:bg-emerald-500/28'),
                            hotBlinkClass(val, HOT_BLINK_PCT, key),
                          )}
                        >
                          <span className="w-full truncate text-[10px] font-medium text-muted-foreground sm:text-xs">
                            {label}
                            {thr != null ? (
                              <span className="ml-0.5 font-normal opacity-80">
                                ≥{thr}%
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={cn(
                              'text-sm font-semibold tabular-nums leading-none tracking-tight sm:text-base',
                              pctColor(val),
                            )}
                          >
                            {fmtPct(val)}
                          </span>
                          <span className="w-full truncate text-[9px] font-normal text-muted-foreground sm:text-[10px]">
                            {footerText}
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        sideOffset={8}
                        className="!inline-flex !w-auto max-w-[min(26rem,92vw)] flex-col !items-stretch !gap-0 border border-white/10 bg-[#0F1C19] px-4 py-3.5 text-left text-background shadow-xl"
                      >
                        <ReturnCalcTooltipBody
                          detail={calc}
                          assetClass={activeAssetClass}
                          currency={quoteCurrency}
                        />
                        {hasValue ? (
                          <p className="mt-3 w-full border-t border-background/20 pt-2.5 text-[12px] leading-snug text-background/70">
                            Click to compose push · auto-runs engine tick
                            {exact?.exactLabel
                              ? ` · lookback ${exact.exactLabel}`
                              : ''}
                          </p>
                        ) : null}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </TooltipProvider>
          </div>

          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => {
                if (!logCollapsed && rightRailMode === 'events') {
                  setRightRailMode('logs')
                  return
                }
                openEventsInLogColumn()
              }}
              className={cn(
                'group flex w-full items-center gap-2 bg-transparent px-0 py-0.5 text-left transition-colors',
                !logCollapsed &&
                  rightRailMode === 'events' &&
                  'text-foreground',
              )}
              title="Show recent events in the side panel"
              aria-pressed={!logCollapsed && rightRailMode === 'events'}
            >
              <span className="text-sm font-medium">
                Active episode · {displayTicker}
              </span>
              <Zap
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground',
                  !logCollapsed &&
                    rightRailMode === 'events' &&
                    'text-foreground',
                )}
                strokeWidth={1.75}
              />
              <span className="text-[11px] text-muted-foreground">
                {(() => {
                  const n = (status?.events || []).filter((e) =>
                    isIntradayOr24hEventWindow(e.detectedWindow),
                  ).length
                  return n > 0 ? `${n} · ≤24h` : '≤24h events'
                })()}
              </span>
            </button>
            <div>
            {!episode ? (
              <p className="mt-2 text-sm text-[#6B7280]">No active momentum episode</p>
            ) : (
              <TooltipProvider delayDuration={200}>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Stat
                    label="Direction"
                    value={episode.direction}
                    valueClass={
                      episode.direction === 'UP'
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    }
                    detail={
                      <div className="space-y-1.5 text-left">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
                          Direction
                        </p>
                        <p className="text-[14px] font-semibold">
                          Episode is moving{' '}
                          <span
                            className={
                              episode.direction === 'UP'
                                ? 'text-emerald-300'
                                : 'text-rose-300'
                            }
                          >
                            {episode.direction}
                          </span>
                        </p>
                        <p className="text-[12px] leading-snug text-background/75">
                          Set when the episode started from the strongest
                          threshold hit. Reversal (opposite threshold) ends this
                          episode and can start a new one the other way.
                        </p>
                        <p className="text-[12px] text-background/70">
                          Live price{' '}
                          <span className="font-semibold text-background">
                            {fmtPrice(
                              episode.currentPrice,
                              activeAssetClass,
                              quoteCurrency,
                            )}
                          </span>
                          {' · '}
                          current move{' '}
                          <span
                            className={cn(
                              'font-semibold tabular-nums',
                              pctColor(episode.currentMovePercent),
                            )}
                          >
                            {fmtPct(episode.currentMovePercent)}
                          </span>
                        </p>
                      </div>
                    }
                  />
                  <Stat
                    label="Status"
                    value={episode.status}
                    detail={
                      <div className="space-y-1.5 text-left">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
                          Status
                        </p>
                        <p className="text-[14px] font-semibold">
                          {episode.status}
                        </p>
                        <p className="text-[12px] leading-snug text-background/75">
                          {episode.status === 'ACTIVE'
                            ? 'Threshold still hot (or within inactivity grace). Engine is tracking this move for accelerate / reverse / end.'
                            : 'Episode finished — move cooled below thresholds past inactivity, or reversed direction.'}
                        </p>
                        {episode.belowThresholdSince ? (
                          <p className="text-[12px] text-background/70">
                            Below threshold since{' '}
                            {fmtDateTime(episode.belowThresholdSince) ||
                              fmtTime(episode.belowThresholdSince)}
                          </p>
                        ) : null}
                      </div>
                    }
                  />
                  <Stat
                    label="Window"
                    value={episode.detectedWindow}
                    detail={
                      <div className="space-y-1.5 text-left">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
                          Detected window
                        </p>
                        <p className="text-[14px] font-semibold">
                          {episode.detectedWindow}
                        </p>
                        <p className="text-[12px] leading-snug text-background/75">
                          Rolling-return card that first crossed its |move %|
                          threshold and opened this episode. Later accelerate
                          alerts may use other windows, but this label is the
                          origin trigger.
                        </p>
                        <p className="text-[12px] text-background/70">
                          Initial move at start:{' '}
                          <span
                            className={cn(
                              'font-semibold tabular-nums',
                              pctColor(episode.initialMovePercent),
                            )}
                          >
                            {fmtPct(episode.initialMovePercent)}
                          </span>
                        </p>
                      </div>
                    }
                  />
                  <Stat
                    label="Started"
                    value={fmtTime(episode.episodeStartedAt)}
                    detail={
                      <div className="space-y-1.5 text-left">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
                          Episode started
                        </p>
                        <p className="text-[14px] font-semibold tabular-nums">
                          {fmtDateTime(episode.episodeStartedAt) ||
                            episode.episodeStartedAt}
                        </p>
                        <p className="text-[12px] leading-snug text-background/75">
                          Wall-clock time when{' '}
                          <span className="font-semibold">MOMENTUM_STARTED</span>{' '}
                          fired for this ticker after a threshold cross.
                        </p>
                        <p className="text-[12px] text-background/70">
                          Direction {episode.direction} · window{' '}
                          {episode.detectedWindow}
                        </p>
                      </div>
                    }
                  />
                  <Stat
                    label="Peak move"
                    value={fmtPct(episode.peakMovePercent)}
                    valueClass={pctColor(episode.peakMovePercent)}
                    detail={
                      <div className="space-y-1.5 text-left">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
                          Peak move
                        </p>
                        <p
                          className={cn(
                            'text-[16px] font-semibold tabular-nums',
                            episode.peakMovePercent > 0
                              ? 'text-emerald-300'
                              : episode.peakMovePercent < 0
                                ? 'text-rose-300'
                                : 'text-background',
                          )}
                        >
                          {fmtPct(episode.peakMovePercent)}
                        </p>
                        <p className="text-[12px] leading-snug text-background/75">
                          Largest |move %| seen while this episode has been
                          ACTIVE (high-water mark). Used for acceleration checks
                          (+pp beyond last alert).
                        </p>
                        <div className="space-y-1 border-t border-background/15 pt-2 text-[12px] text-background/70">
                          <p>
                            Initial:{' '}
                            <span className="font-semibold tabular-nums text-background">
                              {fmtPct(episode.initialMovePercent)}
                            </span>
                          </p>
                          <p>
                            Current:{' '}
                            <span className="font-semibold tabular-nums text-background">
                              {fmtPct(episode.currentMovePercent)}
                            </span>
                          </p>
                          <p>
                            Last alert:{' '}
                            <span className="font-semibold tabular-nums text-background">
                              {fmtPct(episode.lastAlertMovePercent)}
                            </span>
                          </p>
                        </div>
                      </div>
                    }
                  />
                  <Stat
                    label="Last alert move"
                    value={fmtPct(episode.lastAlertMovePercent)}
                    valueClass={pctColor(episode.lastAlertMovePercent)}
                    detail={
                      <div className="space-y-1.5 text-left">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
                          Last alert move
                        </p>
                        <p
                          className={cn(
                            'text-[16px] font-semibold tabular-nums',
                            episode.lastAlertMovePercent > 0
                              ? 'text-emerald-300'
                              : episode.lastAlertMovePercent < 0
                                ? 'text-rose-300'
                                : 'text-background',
                          )}
                        >
                          {fmtPct(episode.lastAlertMovePercent)}
                        </p>
                        <p className="text-[12px] leading-snug text-background/75">
                          Move % at the last start/accelerate alert. Next
                          accelerate needs peak to beat this by the accel
                          threshold (config).
                        </p>
                        <p className="text-[12px] text-background/70">
                          Last alert at{' '}
                          {fmtDateTime(episode.lastAlertAt) ||
                            fmtTime(episode.lastAlertAt) ||
                            '—'}
                        </p>
                      </div>
                    }
                  />
                </div>
              </TooltipProvider>
            )}
            </div>
          </div>

          {status?.config ? (
            <p className="text-[11px] text-muted-foreground">
              Accel +{status.config.accelerationPoints}pp · inactivity{' '}
              {status.config.inactivityMinutes}m · ticks {status.tickCount ?? 0}
              {status.watchedTickers?.length
                ? ` · watching ${status.watchedTickers.length}`
                : ''}
            </p>
          ) : null}
          </div>
        </div>

        {/* Column 3 — collapsible activity log / subscribers */}
        {logCollapsed ? (
          <Button
            type="button"
            variant="ghost"
            data-pill="false"
            onClick={toggleLog}
            className="flex h-auto w-11 shrink-0 flex-col items-center gap-2 rounded-none border-l border-border bg-background py-4 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Expand activity log"
            aria-label="Expand activity log"
            aria-expanded={false}
          >
            <ChevronLeft className="size-4" />
            <Terminal className="size-3.5" />
            <span
              className="mt-1 text-[10px] font-semibold tabular-nums"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
              Logs · {logs.length}
            </span>
          </Button>
        ) : (
          <aside
            className={cn(
              'relative flex shrink-0 flex-col border-l border-border',
              rightRailMode === 'events' ? 'bg-muted/40' : 'bg-background',
            )}
            style={{ width: rightRailWidth, minWidth: 240, maxWidth: 520 }}
          >
            {/* Drag handle — resize right column */}
            <button
              type="button"
              aria-label="Resize panel"
              title="Drag to resize"
              onMouseDown={onRightRailResizeStart}
              className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize border-0 bg-transparent p-0 hover:bg-foreground/10 active:bg-foreground/15"
            />
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                {rightRailMode === 'subscribers' ? (
                  <Users
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                ) : rightRailMode === 'events' ? (
                  <Zap
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                ) : (
                  <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">
                    {rightRailMode === 'subscribers'
                      ? `Subscribers · ${displayTicker}`
                      : rightRailMode === 'events'
                        ? `Recent events · ${displayTicker}`
                        : `Activity log · ${displayTicker}`}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {rightRailMode === 'subscribers'
                      ? `${tickerSubscribers.length} device${tickerSubscribers.length === 1 ? '' : 's'} · Trigger + 9AM`
                      : rightRailMode === 'events'
                        ? '≤24h windows only'
                        : 'API · Yahoo · momentum'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {rightRailMode === 'subscribers' ||
                rightRailMode === 'events' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setRightRailMode('logs')}
                    title="Back to activity log"
                    aria-label="Back to activity log"
                  >
                    <Terminal className="size-3.5" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={toggleLog}
                  title="Collapse panel"
                  aria-label="Collapse right panel"
                  aria-expanded={true}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
            {rightRailMode === 'events' ? (
              <ScrollArea className="min-h-0 flex-1">
                <div className="px-2.5 py-3">
                  <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                    Episodes
                  </p>

                  {(() => {
                    const groups = groupEventsByEpisode(status?.events).map(
                      (g) => {
                        // Attach live V1 state (Holding / Weakening / …) to the active group
                        if (
                          g.status === 'ACTIVE' &&
                          episode &&
                          episode.state
                        ) {
                          return { ...g, liveState: episode.state }
                        }
                        return g
                      },
                    )
                    if (!groups.length && !episode) {
                      return (
                        <p className="px-3 py-8 text-[12px] text-muted-foreground">
                          No episode activity yet
                        </p>
                      )
                    }

                    // Live episode only if its window is ≤24h
                    const liveOnly =
                      episode &&
                      isIntradayOr24hEventWindow(episode.detectedWindow) &&
                      !groups.some((g) => g.status === 'ACTIVE')
                        ? ([
                            {
                              id: `live-${episode.episodeStartedAt}`,
                              direction: episode.direction,
                              startedAt: episode.episodeStartedAt,
                              endedAt: null,
                              status: 'ACTIVE' as const,
                              peakMovePercent: episode.peakMovePercent,
                              window: episode.detectedWindow || '—',
                              events: [] as MomentumEvent[],
                              liveState: episode.state || 'STARTED',
                            },
                          ] as EpisodeEventGroup[])
                        : []

                    const allGroups = [...liveOnly, ...groups]

                    return (
                      <div className="space-y-3">
                        {allGroups.map((group, gi) => {
                          const isActive =
                            group.status === 'ACTIVE' ||
                            (episode != null &&
                              gi === 0 &&
                              group.status === 'ACTIVE')
                          // Only the live backend episode can be force-ended
                          const canEndEpisode =
                            isActive &&
                            episode != null &&
                            (group.startedAt === episode.episodeStartedAt ||
                              !groups.some((g) => g.status === 'ACTIVE') ||
                              gi === 0)
                          const liveStateLabel = isActive
                            ? formatEpisodeState(
                                group.liveState ||
                                  episode?.state ||
                                  (group.events.find((e) => e.state)?.state ??
                                    null) ||
                                  'STARTED',
                              )
                            : null
                          return (
                            <div key={group.id} className="min-w-0">
                              {/* Episode parent pill — direction + live V1 state */}
                              <div
                                className={cn(
                                  'flex items-start gap-2.5 rounded-xl px-2.5 py-2',
                                  isActive
                                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                                    : 'text-foreground/90',
                                )}
                              >
                                <span
                                  className={cn(
                                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
                                    group.direction === 'UP'
                                      ? 'bg-emerald-500/15 text-emerald-700'
                                      : 'bg-rose-500/15 text-rose-700',
                                  )}
                                >
                                  <Zap className="size-3.5" strokeWidth={2} />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <p
                                      className={cn(
                                        'text-[13px] font-semibold leading-tight',
                                        group.direction === 'UP'
                                          ? 'text-emerald-700'
                                          : 'text-rose-700',
                                      )}
                                    >
                                      {group.direction}
                                    </p>
                                    {isActive && liveStateLabel ? (
                                      <span
                                        className={cn(
                                          'rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                          liveStateLabel === 'Holding'
                                            ? 'bg-muted text-muted-foreground'
                                            : liveStateLabel === 'Weakening' ||
                                                liveStateLabel ===
                                                  'Strongly weakening'
                                              ? 'bg-amber-500/15 text-amber-800'
                                              : liveStateLabel ===
                                                    'Accelerating' ||
                                                  liveStateLabel ===
                                                    'Re-accelerating'
                                                ? group.direction === 'UP'
                                                  ? 'bg-emerald-500/15 text-emerald-800'
                                                  : 'bg-rose-500/15 text-rose-800'
                                                : 'bg-foreground/10 text-foreground',
                                        )}
                                        title="Live episode state (backend V1)"
                                      >
                                        {liveStateLabel}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Ended
                                      </span>
                                    )}
                                    {canEndEpisode ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={endingEpisode}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          void endActiveEpisode()
                                        }}
                                        title="Manually end this episode (no push)"
                                        className="ml-auto h-6 shrink-0 gap-1 rounded-full px-2 text-[10px] font-semibold text-muted-foreground hover:border-rose-300 hover:bg-rose-500/10 hover:text-rose-800"
                                      >
                                        {endingEpisode ? (
                                          <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                          <X className="size-3" strokeWidth={2} />
                                        )}
                                        End
                                      </Button>
                                    ) : null}
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    {isActive ? 'Active' : 'Ended'}
                                    {isActive && liveStateLabel
                                      ? ` · ${liveStateLabel}`
                                      : ''}
                                    {' · '}
                                    {group.window}
                                    {' · '}
                                    {fmtTime(group.startedAt)}
                                    {group.endedAt
                                      ? ` → ${fmtTime(group.endedAt)}`
                                      : ''}
                                    {' · peak '}
                                    <span
                                      className={cn(
                                        'font-semibold tabular-nums',
                                        pctColor(group.peakMovePercent),
                                      )}
                                    >
                                      {fmtPct(group.peakMovePercent)}
                                    </span>
                                    {(() => {
                                      // Only real pushes (accel auto / manual start alert) — not episode start stamp
                                      const fromEvents = [...group.events]
                                        .filter(
                                          (e) =>
                                            e.shouldNotify ||
                                            String(e.eventType || '').includes(
                                              'ALERT_SENT',
                                            ),
                                        )
                                        .map(
                                          (e) =>
                                            e.notifiedAt ||
                                            e.pushResult?.at ||
                                            e.detectedAt,
                                        )
                                        .filter(Boolean)
                                        .sort(
                                          (a, b) =>
                                            Date.parse(String(b)) -
                                            Date.parse(String(a)),
                                        )[0]
                                      if (!fromEvents) return null
                                      return (
                                        <>
                                          {' · alert '}
                                          <span
                                            className="font-medium tabular-nums text-sky-800 dark:text-sky-300"
                                            title={
                                              fmtDateTime(fromEvents) ||
                                              String(fromEvents)
                                            }
                                          >
                                            {fmtTime(String(fromEvents))}
                                          </span>
                                        </>
                                      )
                                    })()}
                                  </p>
                                  <EpisodeExplainCollapse
                                    group={group}
                                    accelPoints={
                                      status?.config?.accelerationPoints
                                    }
                                    inactivityMinutes={
                                      status?.config?.inactivityMinutes
                                    }
                                  />
                                </div>
                                {isActive ? (
                                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground" />
                                ) : null}
                              </div>

                              {/* Story timeline: Started → Perplexity → Alert → states… */}
                              {group.events.length > 0 ? (
                                <ul className="relative ml-5 mt-0.5 border-l border-border/80">
                                  {buildTimelineSteps(group.events).map(
                                    (step) => {
                                      if (step.kind === 'backend') {
                                        const { ev, label, isStateOnly } = step
                                        return (
                                          <li
                                            key={step.id}
                                            className="relative py-0.5"
                                          >
                                            <span
                                              className="absolute -left-px top-[1.05rem] h-px w-3 bg-border/80"
                                              aria-hidden
                                            />
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setTimelineDetail({
                                                  kind: 'event',
                                                  at: ev.detectedAt,
                                                  ev,
                                                })
                                              }
                                              className="ml-3 w-[calc(100%-0.75rem)] min-w-0 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-background/80"
                                              title="What happened — prices & % math"
                                            >
                                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                                                <span
                                                  className={cn(
                                                    'text-[12px] font-medium leading-snug',
                                                    isStateOnly
                                                      ? 'text-muted-foreground'
                                                      : 'text-foreground/90',
                                                  )}
                                                >
                                                  {label}
                                                </span>
                                                {!isStateOnly ||
                                                Number.isFinite(
                                                  ev.movePercent,
                                                ) ? (
                                                  <span
                                                    className={cn(
                                                      'text-[12px] font-semibold tabular-nums',
                                                      ev.direction === 'UP'
                                                        ? 'text-emerald-600'
                                                        : 'text-rose-600',
                                                    )}
                                                  >
                                                    {ev.direction}{' '}
                                                    {fmtPct(ev.movePercent)}
                                                  </span>
                                                ) : null}
                                              </div>
                                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                                {ev.detectedWindow || '—'} ·{' '}
                                                {fmtTime(ev.detectedAt)}
                                                {ev.price != null
                                                  ? ` · ${fmtPrice(ev.price, activeAssetClass, quoteCurrency)}`
                                                  : ''}
                                                <span className="text-muted-foreground/70">
                                                  {' '}
                                                  · tap for math
                                                </span>
                                              </p>
                                            </button>
                                          </li>
                                        )
                                      }

                                      if (step.kind === 'perplexity') {
                                        const running =
                                          String(
                                            step.research.status || '',
                                          ).toLowerCase() === 'running'
                                        const failed =
                                          String(
                                            step.research.status || '',
                                          ).toLowerCase() === 'error' ||
                                          Boolean(step.research.error)
                                        const driver =
                                          step.research.likely_driver ||
                                          step.research.reason ||
                                          ''
                                        const preview = running
                                          ? 'Researching likely driver…'
                                          : String(driver).length > 72
                                            ? `${String(driver).slice(0, 72)}…`
                                            : driver
                                        return (
                                          <li
                                            key={step.id}
                                            className="relative py-0.5"
                                          >
                                            <span
                                              className={cn(
                                                'absolute -left-px top-[1.05rem] h-px w-3',
                                                running
                                                  ? 'bg-violet-500/70'
                                                  : 'bg-violet-500/45',
                                              )}
                                              aria-hidden
                                            />
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (running) return
                                                setTimelineDetail({
                                                  kind: 'perplexity',
                                                  at: step.at,
                                                  research: step.research,
                                                  ev: step.ev,
                                                })
                                              }}
                                              className={cn(
                                                'ml-3 w-[calc(100%-0.75rem)] min-w-0 rounded-lg px-2 py-1.5 text-left transition-colors',
                                                running
                                                  ? 'sndk-research-running ring-1 ring-violet-500/40'
                                                  : 'hover:bg-violet-500/10',
                                              )}
                                              title={
                                                running
                                                  ? 'Perplexity is running…'
                                                  : 'View full Perplexity reason'
                                              }
                                              disabled={running}
                                            >
                                              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                                {running ? (
                                                  <Loader2 className="size-3 shrink-0 animate-spin text-violet-700 dark:text-violet-300" />
                                                ) : (
                                                  <PerplexityLogo className="size-3 shrink-0" />
                                                )}
                                                <span className="text-[12px] font-medium leading-snug text-violet-800 dark:text-violet-300">
                                                  {running
                                                    ? 'Perplexity running'
                                                    : failed
                                                      ? 'Perplexity failed'
                                                      : 'Perplexity done'}
                                                </span>
                                                <span
                                                  className={cn(
                                                    'rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
                                                    running
                                                      ? 'bg-violet-500/25 text-violet-900 dark:text-violet-200'
                                                      : 'bg-violet-500/15 text-violet-800 dark:text-violet-300',
                                                  )}
                                                >
                                                  {running
                                                    ? 'live'
                                                    : failed
                                                      ? 'error'
                                                      : 'research'}
                                                </span>
                                              </div>
                                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                                <span className="tabular-nums">
                                                  {fmtTime(step.at)}
                                                </span>
                                                {preview
                                                  ? ` · ${preview}`
                                                  : ''}
                                              </p>
                                            </button>
                                          </li>
                                        )
                                      }

                                      // alert
                                      const title =
                                        step.notification?.title ||
                                        'Push notification'
                                      const titlePreview =
                                        title.length > 56
                                          ? `${title.slice(0, 56)}…`
                                          : title
                                      return (
                                        <li
                                          key={step.id}
                                          className="relative py-0.5"
                                        >
                                          <span
                                            className="absolute -left-px top-[1.05rem] h-px w-3 bg-sky-500/45"
                                            aria-hidden
                                          />
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setTimelineDetail({
                                                kind: 'alert',
                                                at: step.at,
                                                notification:
                                                  step.notification,
                                                ev: step.ev,
                                              })
                                            }
                                            className="ml-3 w-[calc(100%-0.75rem)] min-w-0 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sky-500/10"
                                            title="View exact alert that was sent"
                                          >
                                            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                              <span className="text-[12px] font-medium leading-snug text-sky-800 dark:text-sky-300">
                                                Alert sent
                                              </span>
                                              <span className="rounded bg-sky-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-300">
                                                push
                                              </span>
                                            </div>
                                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                                              <span className="tabular-nums">
                                                {fmtTime(step.at)}
                                              </span>
                                              {titlePreview
                                                ? ` · ${titlePreview}`
                                                : ' · click for copy'}
                                            </p>
                                          </button>
                                        </li>
                                      )
                                    },
                                  )}
                                </ul>
                              ) : isActive ? (
                                <ul className="relative ml-5 mt-0.5 border-l border-border/80">
                                  <li className="relative py-0.5">
                                    <span
                                      className="absolute -left-px top-[1.05rem] h-px w-3 bg-border/80"
                                      aria-hidden
                                    />
                                    <div className="ml-3 min-w-0 px-2 py-1.5">
                                      <p className="text-[11px] text-muted-foreground">
                                        Live
                                        {liveStateLabel
                                          ? ` · ${liveStateLabel}`
                                          : ''}{' '}
                                        · started {fmtTime(group.startedAt)}
                                      </p>
                                      <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                                        Run Perplexity for start reason, then
                                        send alert
                                      </p>
                                    </div>
                                  </li>
                                </ul>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              </ScrollArea>
            ) : rightRailMode === 'subscribers' ? (
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-2 p-2">
                  <div className="flex flex-wrap items-center gap-1.5 px-0.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 rounded-full px-2.5 text-[11px]"
                      disabled={subsLoading}
                      onClick={() => void loadTickerSubscribers(displayTicker)}
                    >
                      {subsLoading ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3" strokeWidth={1.75} />
                      )}
                      Refresh
                    </Button>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {activeTab?.label || displayTicker}
                    </span>
                  </div>

                  {subsError ? (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-900 dark:text-rose-100">
                      {subsError}
                    </div>
                  ) : null}

                  {subsLoading && !tickerSubscribers.length ? (
                    <div className="flex items-center gap-2 px-2 py-10 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      Loading…
                    </div>
                  ) : null}

                  {!subsLoading && !subsError && !tickerSubscribers.length ? (
                    <div className="rounded-lg border border-dashed px-3 py-10 text-center">
                      <Users className="mx-auto size-6 text-muted-foreground/50" />
                      <p className="mt-2 text-[12px] font-medium">No subscribers</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        No enabled devices watch {displayTicker}.
                      </p>
                    </div>
                  ) : null}

                  {tickerSubscribers.map((device) => {
                    const token = device.expo_push_token || ''
                    const maskedToken =
                      token.length > 28
                        ? `${token.slice(0, 16)}…${token.slice(-6)}`
                        : token || '—'
                    const allTickers = [
                      ...new Set([
                        ...(device.enabled_tickers || []),
                        ...(device.tickers || []),
                      ]),
                    ]
                    const appLabel =
                      device.app_key === 'nineam' ? '9AM' : 'Trigger'
                    return (
                      <div
                        key={`${device.app_key || 'trigger'}:${device.device_id || token}`}
                        className="rounded-lg border border-border bg-muted/30 px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[12px] font-semibold">
                            {device.device_id || 'Unknown device'}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[9px] uppercase tracking-wide"
                          >
                            {appLabel}
                          </Badge>
                          {device.subscription_status ? (
                            <Badge
                              variant="outline"
                              className="text-[9px] capitalize"
                            >
                              {device.subscription_status}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                          {maskedToken}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {allTickers.length
                            ? allTickers.slice(0, 8).join(', ') +
                              (allTickers.length > 8 ? '…' : '')
                            : 'no tickers'}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            ) : (
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-1.5 p-2 font-mono text-[11px] leading-snug">
                  <div ref={logTopRef} />
                  {!logs.length ? (
                    <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                      No activity yet. Wait for the poll loop or press Run tick.
                    </p>
                  ) : (
                    logs.map((log, i) => (
                      <div
                        key={`${log.at}-${i}`}
                        className="rounded-lg border border-border bg-muted/30 px-2 py-1.5"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="tabular-nums text-[10px] text-muted-foreground">
                            {fmtTime(log.at)}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              'h-auto px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
                              sourceBadge(log.source),
                            )}
                          >
                            {log.source}
                          </Badge>
                          <span
                            className={cn(
                              'text-[9px] font-semibold uppercase',
                              log.level === 'error'
                                ? 'text-rose-600'
                                : log.level === 'warn'
                                  ? 'text-amber-700'
                                  : log.level === 'success'
                                    ? 'text-emerald-700'
                                    : 'text-muted-foreground',
                            )}
                          >
                            {log.level}
                          </span>
                        </div>
                        <p
                          className={cn(
                            'mt-0.5 whitespace-pre-wrap break-words text-[11px]',
                            levelClass(log.level),
                          )}
                        >
                          {log.message}
                        </p>
                        {log.detail != null && typeof log.detail === 'object' ? (
                          <pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap break-all text-[9px] text-muted-foreground">
                            {JSON.stringify(log.detail, null, 0).slice(0, 280)}
                          </pre>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </aside>
        )}
          </div>
          {/* end detail + log row */}
        </div>
        {/* end right stack */}
      </div>
      {/* end full-height left | right split */}

      {/* ── Bottom bar: Perplexity · app pills · market + UK/US (compact) ── */}
      <div className="grid h-9 shrink-0 grid-cols-3 items-center gap-1.5 border-t border-border bg-background px-2.5 sm:px-3">
        <button
          type="button"
          onClick={() => void loadPerplexityUsage({ open: true })}
          title="Perplexity cost — click for breakdown"
          className="inline-flex min-w-0 items-center justify-start gap-1 text-left transition-opacity hover:opacity-80"
        >
          <PerplexityLogo className="size-3" />
          <span className="font-mono text-[11px] font-medium tabular-nums tracking-tight text-foreground">
            $
            {(Number(pplxTotals?.total_cost_usd) || 0).toFixed(2)}
          </span>
        </button>

        <div className="flex items-center justify-center">
          {appSwitcher ?? null}
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-0">
          <MarketStatusBadge
            marketState={tabQuote?.marketState ?? null}
            marketStateLoading={tabQuoteLoading || !tabQuote?.marketState}
            className="text-[10px] gap-1"
          />
          <span className="text-[10px] text-border" aria-hidden>
            ·
          </span>
          <div
            className="flex min-w-0 items-center gap-x-1 whitespace-nowrap text-[10px] tabular-nums leading-none"
            aria-label={`UK ${formatZoneHm(nowMs, 'Europe/London')}, US ${formatZoneHm(nowMs, 'America/New_York')}`}
          >
            <span className="font-medium text-muted-foreground">UK</span>
            <span className="font-mono font-bold tracking-tight text-foreground">
              {formatZoneHm(nowMs, 'Europe/London')}
            </span>
            <span className="text-muted-foreground/50" aria-hidden>
              ·
            </span>
            <span className="font-medium text-muted-foreground">US</span>
            <span className="font-mono font-bold tracking-tight text-foreground">
              {formatZoneHm(nowMs, 'America/New_York')}
            </span>
          </div>
        </div>
      </div>

      {/* ── Push composer · 3 columns: findings/prompt · preview · devices ── */}
      <Dialog
        open={alertOpen}
        onOpenChange={(open) => {
          if (
            !open &&
            alertPromptDirty &&
            alertGeminiPrompt.trim()
          ) {
            persistEditedResearchPrompt(alertGeminiPrompt)
          }
          setAlertOpen(open)
        }}
      >
        <DialogContent
          showCloseButton
          data-momentum-dashboard
          className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        >
          <DialogHeader className="shrink-0 border-b border-border px-5 py-3 pr-12 text-left">
            <DialogTitle className="text-lg">
              Momentum alert · {activeTab?.label || displayTicker}
              {alertWindowKey ? (
                <span className="ml-2 text-sm font-medium text-muted-foreground">
                  {returnKeyDisplayLabel(
                    alertWindowKey,
                    snap?.marketSession || sessionFromQuote,
                  )}
                </span>
              ) : null}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Momentum alert research and push composer for{' '}
              {activeTab?.label || displayTicker}
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-border overflow-hidden lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            {/* Column 1 — until findings: prompt fills full height; after: findings + prompt + Run */}
            <div className="flex min-h-0 flex-col overflow-hidden">
              {alertResearchMeta?.reason ? (
                /* ── After findings: steps + tokens + sources + findings · prompt · Run ── */
                <>
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        1 · Research findings
                      </p>
                      {alertResearchBusy ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                          <Loader2 className="size-3 animate-spin" />
                          Running…
                        </span>
                      ) : null}
                    </div>

                    {alertResearchError ? (
                      <p className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                        {alertResearchError}
                      </p>
                    ) : null}

                    {/* Model / tools / tokens / cost */}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg border border-border bg-background px-2.5 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Provider / model
                        </p>
                        <p className="mt-0.5 font-semibold text-foreground">
                          {alertResearchMeta.provider || 'perplexity'}
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {alertResearchMeta.model ||
                            'perplexity/deepseek-v4-flash-0731'}
                        </p>
                        {alertResearchMeta.request_id ? (
                          <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">
                            id {alertResearchMeta.request_id}
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-border bg-background px-2.5 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Cost
                        </p>
                        <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-foreground">
                          {alertResearchMeta.cost_usd_display || '—'}
                        </p>
                        {alertResearchMeta.cost ? (
                          <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground">
                            in $
                            {Number(
                              alertResearchMeta.cost.input_tokens_cost ?? 0,
                            ).toFixed(5)}{' '}
                            · out $
                            {Number(
                              alertResearchMeta.cost.output_tokens_cost ?? 0,
                            ).toFixed(5)}
                            {alertResearchMeta.cost.request_cost != null
                              ? ` · req $${Number(alertResearchMeta.cost.request_cost).toFixed(5)}`
                              : ''}
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-border bg-background px-2.5 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Tokens
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-foreground">
                          {alertResearchMeta.tokens?.total != null
                            ? alertResearchMeta.tokens.total.toLocaleString()
                            : '—'}{' '}
                          <span className="text-muted-foreground">total</span>
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          prompt{' '}
                          {alertResearchMeta.tokens?.prompt?.toLocaleString() ??
                            '—'}{' '}
                          · completion{' '}
                          {alertResearchMeta.tokens?.completion?.toLocaleString() ??
                            '—'}
                          {alertResearchMeta.tokens?.search_context_size
                            ? ` · ctx ${alertResearchMeta.tokens.search_context_size}`
                            : ''}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-background px-2.5 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Tools
                        </p>
                        <ul className="mt-0.5 space-y-0.5">
                          {(alertResearchMeta.tools?.length
                            ? alertResearchMeta.tools
                            : [
                                {
                                  name: 'web_search',
                                  provider: 'perplexity',
                                },
                              ]
                          ).map((t, i) => (
                            <li key={i} className="font-medium text-foreground">
                              {t.name || 'tool'}
                              <span className="font-normal text-muted-foreground">
                                {' '}
                                · {t.provider || 'perplexity'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      {alertResearchMeta.supabase_save ? (
                        <div
                          className={cn(
                            'col-span-2 rounded-lg border px-2.5 py-2',
                            alertResearchMeta.supabase_save.ok
                              ? 'border-emerald-500/40 bg-emerald-500/5'
                              : 'border-rose-500/40 bg-rose-500/5',
                          )}
                        >
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Supabase save
                          </p>
                          <p className="mt-0.5 text-[11px] font-semibold text-foreground">
                            {alertResearchMeta.supabase_save.ok
                              ? `Saved → ${alertResearchMeta.supabase_save.table}`
                              : `Failed → ${alertResearchMeta.supabase_save.error || 'error'}`}
                          </p>
                          {alertResearchMeta.supabase_save.id ? (
                            <p className="font-mono text-[9px] text-muted-foreground">
                              id {alertResearchMeta.supabase_save.id}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {alertResearchMeta.user_movement ? (
                      <p className="rounded-md bg-muted/50 px-2 py-1.5 text-[11px] leading-snug">
                        <span className="font-semibold text-muted-foreground">
                          Input:{' '}
                        </span>
                        {alertResearchMeta.user_movement}
                        {alertResearchMeta.asset_class ? (
                          <span className="ml-1 text-muted-foreground">
                            · {alertResearchMeta.asset_class}
                          </span>
                        ) : null}
                      </p>
                    ) : null}

                    <div className="space-y-2 rounded-xl border border-border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Full findings
                        </p>
                        {alertResearchMeta.cost_usd_display ||
                        alertResearchMeta.model ? (
                          <span className="text-[10px] text-muted-foreground">
                            {[
                              alertResearchMeta.model,
                              alertResearchMeta.cost_usd_display,
                              'Perplexity',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </div>
                      <pre className="max-h-[min(36vh,20rem)] overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-foreground">
                        {alertResearchMeta.reason}
                      </pre>
                      {alertResearchMeta.likely_driver ? (
                        <p className="border-t border-border/60 pt-2 text-[12px] leading-snug">
                          <span className="font-semibold">Likely driver: </span>
                          {alertResearchMeta.likely_driver}
                        </p>
                      ) : null}
                    </div>

                    {/* Web sources */}
                    {(alertResearchMeta.search_results?.length ||
                      alertResearchMeta.citations?.length) ? (
                      <div className="rounded-xl border border-border bg-muted/15 p-2.5">
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Web sources (
                          {alertResearchMeta.search_results?.length ||
                            alertResearchMeta.citations?.length ||
                            0}
                          )
                        </p>
                        <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                          {(alertResearchMeta.search_results?.length
                            ? alertResearchMeta.search_results
                            : (alertResearchMeta.citations || []).map(
                                (url) => ({
                                  url,
                                  title: url,
                                  source: 'web',
                                }),
                              )
                          ).map((src, i) => (
                            <li key={i} className="text-[10px] leading-snug">
                              <a
                                href={src.url || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-[#111111] underline-offset-2 hover:underline"
                              >
                                {i + 1}. {src.title || src.url || 'source'}
                              </a>
                              {src.source ? (
                                <span className="ml-1 text-muted-foreground">
                                  · {src.source}
                                </span>
                              ) : null}
                              {src.snippet ? (
                                <p className="mt-0.5 line-clamp-2 text-muted-foreground">
                                  {src.snippet}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>

                  <div className="shrink-0 space-y-2 border-t border-border bg-muted/20 p-4 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        Prompt (editable)
                        {alertUsingSavedPrompt ? (
                          <span className="ml-1.5 font-medium normal-case tracking-normal text-[#111111]/80">
                            · saved for next time
                          </span>
                        ) : null}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {alertGeminiPrompt
                            ? `${alertGeminiPrompt.length.toLocaleString()} chars`
                            : '—'}
                        </span>
                        {alertUsingSavedPrompt || alertPromptDirty ? (
                          <Button
                            type="button"
                            disabled={alertResearchBusy}
                            onClick={() => {
                              clearResearchPromptTemplate(activeAssetClass)
                              setAlertUsingSavedPrompt(false)
                              setAlertPromptDirty(false)
                              if (alertWindowKey) openReturnAlert(alertWindowKey)
                            }}
                            className="text-[10px] font-semibold text-[#111111] underline-offset-2 hover:underline disabled:opacity-50"
                          >
                            Reset default
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <Textarea
                      value={alertGeminiPrompt}
                      onChange={(e) => {
                        setAlertGeminiPrompt(e.target.value)
                        setAlertPromptDirty(true)
                      }}
                      onBlur={() => {
                        if (!alertPromptDirty || !alertGeminiPrompt.trim()) return
                        persistEditedResearchPrompt(alertGeminiPrompt)
                      }}
                      rows={5}
                      disabled={alertResearchBusy}
                      className="w-full resize-y font-mono text-[10px] leading-snug"
                    />
                    <Button
                      type="button"
                      className="w-full"
                      disabled={alertResearchBusy || !alertWindowKey}
                      onClick={() => void runMomentumResearch()}
                    >
                      {alertResearchBusy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Search className="size-4" />
                      )}
                      {alertResearchBusy
                        ? 'Running Perplexity…'
                        : 'Run research'}
                    </Button>
                  </div>
                </>
              ) : (
                /* ── Before findings: prompt fills height · live steps while running ── */
                <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      1 · Prompt (editable)
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      {alertResearchBusy ? (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                          <Loader2 className="size-3 animate-spin" />
                          {alertGeminiPrompt
                            ? 'Perplexity researching…'
                            : 'Building prompt…'}
                        </span>
                      ) : alertGeminiPrompt ? (
                        `${alertGeminiPrompt.length.toLocaleString()} chars`
                      ) : (
                        'loading…'
                      )}
                    </span>
                  </div>

                  {alertResearchError ? (
                    <p className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                      {alertResearchError}
                    </p>
                  ) : null}

                  <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                    {(alertUsingSavedPrompt || alertPromptDirty) && (
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          disabled={alertResearchBusy}
                          onClick={() => {
                            clearResearchPromptTemplate(activeAssetClass)
                            setAlertUsingSavedPrompt(false)
                            setAlertPromptDirty(false)
                            // Rebuild default for current window
                            if (alertWindowKey) openReturnAlert(alertWindowKey)
                          }}
                          className="text-[10px] font-semibold text-[#111111] underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          Reset to default
                        </Button>
                      </div>
                    )}
                    <Textarea
                      value={alertGeminiPrompt}
                      onChange={(e) => {
                        setAlertGeminiPrompt(e.target.value)
                        setAlertPromptDirty(true)
                      }}
                      onBlur={() => {
                        if (!alertPromptDirty || !alertGeminiPrompt.trim()) return
                        persistEditedResearchPrompt(alertGeminiPrompt)
                      }}
                      disabled={alertResearchBusy}
                      placeholder="Research prompt fills this column until findings arrive. Edit freely — your INSTRUCTIONS/OUTPUT knowledge is saved for next time."
                      className="min-h-0 w-full flex-1 resize-none font-mono text-[11px] leading-snug"
                    />
                  </div>

                  <Button
                    type="button"
                    disabled={alertResearchBusy || !alertWindowKey}
                    onClick={() => void runMomentumResearch()}
                    className="w-full"
                  >
                    {alertResearchBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Search className="size-4" />
                    )}
                    {alertResearchBusy
                      ? 'Running Perplexity…'
                      : 'Run research'}
                  </Button>
                </div>
              )}
            </div>

            {/* Column 2 — notification preview / note generation */}
            <div className="flex min-h-0 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 pb-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  2 · Preview
                </p>
                <div className="rounded-2xl border border-border bg-muted/30 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Title
                  </p>
                  <p className="mt-1 text-[15px] font-semibold leading-snug text-foreground">
                    {alertTitle || '—'}
                  </p>
                  <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Body
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">
                    {alertBody || '—'}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Edit title</Label>
                  <Input
                    value={alertTitle}
                    onChange={(e) => setAlertTitle(e.target.value)}
                    className="mt-1 h-10 text-sm font-semibold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Edit body</Label>
                  <Textarea
                    value={alertBody}
                    onChange={(e) => setAlertBody(e.target.value)}
                    rows={5}
                    className="mt-1 resize-y text-sm leading-relaxed"
                  />
                </div>
                {alertWindowKey && snap?.exactLookbacks?.[alertWindowKey] ? (
                  <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                    <p>
                      Move{' '}
                      <strong className="text-foreground">
                        {fmtPct(
                          snap.exactLookbacks[alertWindowKey]?.movePercent,
                        )}
                      </strong>
                      {' · '}
                      ref{' '}
                      {fmtPrice(
                        snap.exactLookbacks[alertWindowKey]?.referencePrice,
                        activeAssetClass,
                        quoteCurrency,
                      )}
                      {' → '}
                      {fmtPrice(
                        livePrice ?? snap?.currentPrice,
                        activeAssetClass,
                        quoteCurrency,
                      )}
                    </p>
                    <p className="mt-0.5">
                      From{' '}
                      {fmtDateTime(
                        snap.exactLookbacks[alertWindowKey]?.referenceTime,
                      ) || '—'}{' '}
                      →{' '}
                      {fmtDateTime(
                        snap.exactLookbacks[alertWindowKey]?.asOfTime,
                      ) || 'now'}
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 space-y-2 border-t border-border bg-muted/20 p-4 pt-3">
                {alertSendMessage ? (
                  <p
                    className={cn(
                      'text-[12px]',
                      alertSendError ? 'text-rose-600' : 'text-emerald-700',
                    )}
                  >
                    {alertSendMessage}
                  </p>
                ) : null}
                <Button
                  type="button"
                  className="w-full"
                  disabled={
                    alertSending ||
                    !alertTitle.trim() ||
                    !alertBody.trim() ||
                    alertDeviceKeys.length === 0
                  }
                  onClick={() => void sendMomentumAlert()}
                >
                  {alertSending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <BellRing className="size-3.5" />
                  )}
                  Send ({alertDeviceKeys.length})
                </Button>
              </div>
            </div>

            {/* Column 3 — devices */}
            <div className="flex min-h-0 flex-col overflow-hidden p-4">
              <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    3 · Devices
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {alertDeviceKeys.length}/{alertDevices.length} selected · Trigger
                  </p>
                </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void loadAlertDevices()}
                      className="inline-flex h-8 items-center gap-1 rounded-full border border-border px-3 text-[11px] font-medium"
                    >
                      {alertDevicesLoading ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3" />
                      )}
                      Reload
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAlertDeviceKeys(alertDevices.map(deviceKey))
                      }
                      className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[11px] font-medium"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setAlertDeviceKeys([])}
                      className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[11px] font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {alertDevicesError ? (
                  <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[12px] text-rose-800">
                    {alertDevicesError}
                  </p>
                ) : null}

                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl border border-border p-1.5">
                  {alertDevicesLoading && !alertDevices.length ? (
                    <p className="flex items-center gap-2 px-2 py-6 text-[12px] text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      Loading devices…
                    </p>
                  ) : null}
                  {!alertDevicesLoading && !alertDevices.length ? (
                    <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                      No Trigger devices found.
                    </p>
                  ) : null}
                  {alertDevices.map((device) => {
                    const key = deviceKey(device)
                    const checked = alertDeviceKeys.includes(key)
                    return (
                      <label
                        key={key}
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-[12px] hover:bg-muted/60',
                          checked && 'bg-muted/40',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0 rounded border-foreground accent-black dark:accent-white"
                          checked={checked}
                          onChange={() => {
                            setAlertDeviceKeys((prev) =>
                              prev.includes(key)
                                ? prev.filter((k) => k !== key)
                                : [...prev, key],
                            )
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block font-mono text-[11px] font-semibold">
                            {device.device_id || 'unknown'}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {device.tickers?.slice(0, 8).join(', ') || 'no tickers'}
                            {(device.tickers?.length || 0) > 8 ? '…' : ''}
                          </span>
                        </span>
                        {checked ? (
                          <Check className="ml-auto size-3.5 shrink-0 text-foreground" />
                        ) : null}
                      </label>
                    )
                  })}
                </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>


      {/* Add ticker · popup */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open)
          if (!open) {
            setSearchOpen(false)
            setSearchResults([])
            setSearchError(null)
            setSearchHighlight(0)
          }
        }}
      >
        <DialogContent
          data-momentum-dashboard
          showCloseButton
          className="flex max-h-[min(90svh,40rem)] w-[min(96vw,32rem)] max-w-[min(96vw,32rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,32rem)]"
        >
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="text-lg">Add ticker</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground">
              Quick add presets, or search Yahoo for any symbol.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-2">
              <Label>Quick add</Label>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_ADDS.map((q) => {
                  const already = watchlist.some((t) => t.ticker === q.ticker)
                  return (
                    <button
                      key={q.ticker}
                      type="button"
                      disabled={already}
                      onClick={() => addWatchTicker(q)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                        already
                          ? 'cursor-not-allowed border-border bg-muted text-muted-foreground'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                      title={q.ticker}
                    >
                      <span
                        className={cn(
                          'rounded px-1 py-px text-[9px] uppercase',
                          assetClassBadge(q.assetClass),
                        )}
                      >
                        {q.assetClass === 'commodity' ? 'cmdty' : q.assetClass}
                      </span>
                      {q.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div ref={searchBoxRef} className="relative w-full">
                <Label htmlFor="add-ticker-search">Search Yahoo</Label>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="add-ticker-search"
                    value={addTicker}
                    onChange={(e) => {
                      setAddTicker(e.target.value)
                      setSearchOpen(true)
                    }}
                    onFocus={() => {
                      if (addTicker.trim()) setSearchOpen(true)
                    }}
                    placeholder="Type symbol or company — AAPL, bitcoin, gold…"
                    className="pl-8 font-medium"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    role="combobox"
                    aria-expanded={searchOpen}
                    aria-controls="yahoo-ticker-search-list"
                    aria-autocomplete="list"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setSearchOpen(false)
                        return
                      }
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setSearchOpen(true)
                        setSearchHighlight((i) =>
                          searchResults.length
                            ? Math.min(i + 1, searchResults.length - 1)
                            : 0,
                        )
                        return
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setSearchHighlight((i) => Math.max(i - 1, 0))
                        return
                      }
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (searchOpen && searchResults[searchHighlight]) {
                          pickSearchResult(searchResults[searchHighlight])
                          return
                        }
                        const exact = searchResults.find(
                          (r) =>
                            r.ticker.toUpperCase() ===
                            addTicker.trim().toUpperCase(),
                        )
                        if (exact) {
                          pickSearchResult(exact)
                          return
                        }
                        if (searchResults[0]) {
                          pickSearchResult(searchResults[0])
                          return
                        }
                        addWatchTicker()
                      }
                    }}
                  />
                </div>

                {searchOpen && addTicker.trim() ? (
                  <div
                    id="yahoo-ticker-search-list"
                    role="listbox"
                    className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-lg"
                  >
                    {searchLoading ? (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        Searching Yahoo Finance…
                      </div>
                    ) : null}

                    {!searchLoading && searchError ? (
                      <div className="mx-1.5 mb-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 dark:border-rose-900 dark:bg-rose-950/40">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-900/80 dark:text-rose-200">
                          Search error
                        </p>
                        <p className="mt-0.5 break-words text-[12px] font-medium leading-snug text-rose-950 dark:text-rose-100">
                          {searchError}
                        </p>
                      </div>
                    ) : null}

                    {!searchLoading &&
                    !searchResults.length &&
                    !searchError ? (
                      <div className="px-3 py-2.5">
                        <p className="text-[12px] font-medium text-foreground">
                          No Yahoo matches
                        </p>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          Try another name, or press Enter to add{' '}
                          <code className="rounded bg-muted px-1 font-mono text-[10px]">
                            {normalizeWatchTicker(addTicker) ||
                              addTicker.trim()}
                          </code>{' '}
                          as typed.
                        </p>
                      </div>
                    ) : null}

                    {searchResults.map((row, index) => {
                      const symbol = String(row.ticker || '').toUpperCase()
                      const assetClass = assetClassFromSearch(row)
                      const inList = watchlist.some((t) => t.ticker === symbol)
                      const name =
                        row.companyName ||
                        row.longName ||
                        row.shortName ||
                        '—'
                      const meta = [
                        quoteTypeLabel(row),
                        row.exchange,
                        row.sector,
                        row.industry,
                      ].filter(Boolean)
                      const active = index === searchHighlight
                      return (
                        <button
                          key={`${symbol}-${row.exchange || ''}-${index}`}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setSearchHighlight(index)}
                          onClick={() => pickSearchResult(row)}
                          className={cn(
                            'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors',
                            active ? 'bg-muted' : 'hover:bg-muted/70',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[13px] font-semibold tracking-tight text-foreground">
                                {symbol}
                              </span>
                              <span
                                className={cn(
                                  'rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
                                  assetClassBadge(assetClass),
                                )}
                              >
                                {assetClass === 'commodity'
                                  ? 'cmdty'
                                  : assetClass}
                              </span>
                              {inList ? (
                                <span className="rounded bg-emerald-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                                  In list
                                </span>
                              ) : null}
                              {row.savedAt ? (
                                <span className="rounded bg-slate-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                                  Saved
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 truncate text-[12px] font-medium text-foreground/90">
                              {name}
                            </p>
                            {meta.length ? (
                              <p className="mt-0.5 truncate text-[10px] leading-snug text-muted-foreground">
                                {meta.join(' · ')}
                              </p>
                            ) : (
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                Yahoo Finance
                              </p>
                            )}
                          </div>
                          <span className="mt-0.5 shrink-0 text-[10px] font-semibold text-foreground">
                            {inList ? 'Open' : 'Add'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="block min-w-[8rem] flex-1">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Label (optional)
                  </span>
                  <Input
                    value={addLabel}
                    onChange={(e) => setAddLabel(e.target.value)}
                    placeholder="Display name"
                    className="mt-0.5"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addWatchTicker()
                    }}
                  />
                </label>
              </div>

              <p className="text-[10px] leading-snug text-muted-foreground">
                Live Yahoo search · equity, ETF, crypto, FX, futures. Or type a
                raw symbol:{' '}
                <code className="font-mono">BTC-USD</code> ·{' '}
                <code className="font-mono">GC=F</code> ·{' '}
                <code className="font-mono">EURUSD=X</code> ·{' '}
                <code className="font-mono">AAPL</code>.
              </p>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-5 py-3 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddOpen(false)
                setSearchOpen(false)
                setSearchResults([])
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (searchResults[searchHighlight]) {
                  pickSearchResult(searchResults[searchHighlight])
                } else {
                  addWatchTicker()
                }
              }}
            >
              Add tab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Perplexity usage · full-screen daily breakdown */}
      <Dialog
        open={pplxUsageOpen}
        onOpenChange={(open) => {
          setPplxUsageOpen(open)
          if (!open) setPplxUsageError('')
        }}
      >
        <DialogContent
          data-momentum-dashboard
          className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 p-0 sm:max-w-none"
        >
          <DialogHeader className="shrink-0 border-b border-[#E5E7EB] px-5 py-4 sm:px-8">
            <DialogTitle className="flex items-center gap-2 text-[1.125rem]">
              <Search className="size-4 text-sky-600" />
              Perplexity credits & cost
            </DialogTitle>
            <DialogDescription className="text-[13px] text-[#6B7280]">
              App-tracked spend from each momentum research call (last 90 days
              ET). Token credits = total tokens. Prepaid remaining balance is
              only on Perplexity’s console.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
            {pplxUsageLoading ? (
              <div className="flex items-center gap-2 py-12 text-sm text-[#6B7280]">
                <Loader2 className="size-4 animate-spin" />
                Loading usage…
              </div>
            ) : null}
            {pplxUsageError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {pplxUsageError}
              </div>
            ) : null}

            {!pplxUsageLoading && !pplxUsageError ? (
              <div className="mx-auto w-full max-w-5xl space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <div className="px-1 py-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Total cost
                      </p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">
                        {pplxTotals?.total_cost_usd_display || '$0.000000'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        All tracked research calls
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="px-1 py-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Token credits used
                      </p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">
                        {(pplxTotals?.total_credits || 0).toLocaleString()}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Sum of total tokens per call
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="px-1 py-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Research calls
                      </p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums">
                        {(pplxTotals?.total_calls || 0).toLocaleString()}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Last 90 days (ET)
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-[#6B7280]">
                  <p>
                    Remaining prepaid balance is only on Perplexity console —
                    not available via API.
                  </p>
                  <a
                    href="https://www.perplexity.ai/account/api/billing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 font-semibold text-sky-700 underline-offset-2 hover:underline"
                  >
                    Open Perplexity API billing
                    <ExternalLink className="size-3.5 opacity-70" />
                  </a>
                </div>

                {pplxDaily.length === 0 ? (
                  <p className="py-12 text-center text-sm text-[#6B7280]">
                    No Perplexity usage logged yet. Run research once to start
                    tracking.
                  </p>
                ) : (
                  <div className="overflow-hidden border-y border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3 font-medium">Day (ET)</th>
                          <th className="px-4 py-3 font-medium">Cost</th>
                          <th className="px-4 py-3 font-medium">
                            Token credits
                          </th>
                          <th className="px-4 py-3 font-medium">Calls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pplxDaily.map((row) => (
                          <tr
                            key={row.day}
                            className="border-t border-[#E5E7EB] hover:bg-[#F9FAFB]"
                          >
                            <td className="px-4 py-3 font-medium tabular-nums">
                              {row.day}
                            </td>
                            <td className="px-4 py-3 font-semibold tabular-nums">
                              {row.cost_usd_display ||
                                (row.cost_usd != null
                                  ? `$${Number(row.cost_usd).toFixed(6)}`
                                  : '—')}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-[#6B7280]">
                              {(
                                row.credits_used ||
                                row.total_tokens ||
                                0
                              ).toLocaleString()}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-[#6B7280]">
                              {row.calls ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 border-t border-[#E5E7EB] px-5 py-3 sm:px-8">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPplxUsageOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Timeline detail — exact alert copy or Perplexity reason */}
      <Dialog
        open={timelineDetail != null}
        onOpenChange={(open) => {
          if (!open) setTimelineDetail(null)
        }}
      >
        <DialogContent
          showCloseButton
          data-momentum-dashboard
          className="max-h-[min(90dvh,40rem)] w-[min(100vw-1.5rem,28rem)] gap-0 overflow-hidden p-0 sm:max-w-md"
        >
          {timelineDetail?.kind === 'event' ? (
            <>
              <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Zap className="size-4 text-foreground" />
                  {
                    buildEventMeasureExplain(timelineDetail.ev, {
                      assetClass: activeAssetClass,
                      currency: quoteCurrency,
                      liveEpisode: episode,
                    }).title
                  }
                </DialogTitle>
                <DialogDescription className="text-[12px] text-muted-foreground">
                  What happened · how the % was measured
                  {timelineDetail.at
                    ? ` · ${fmtDateTime(timelineDetail.at) || fmtTime(timelineDetail.at)}`
                    : ''}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {(() => {
                  const explain = buildEventMeasureExplain(timelineDetail.ev, {
                    assetClass: activeAssetClass,
                    currency: quoteCurrency,
                    liveEpisode: episode,
                  })
                  return (
                    <>
                      <p className="text-[13px] leading-relaxed text-foreground/90">
                        {explain.summary}
                      </p>
                      {explain.formula ? (
                        <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Formula
                          </p>
                          <p className="mt-1 font-mono text-[12px] leading-snug text-foreground">
                            {explain.formula}
                          </p>
                        </div>
                      ) : null}
                      <div className="rounded-xl border border-border bg-background px-3 py-2">
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Numbers
                        </p>
                        <dl className="space-y-1.5">
                          {explain.rows.map((row) => (
                            <div
                              key={row.label}
                              className="flex min-w-0 items-start justify-between gap-3 text-[11px]"
                            >
                              <dt className="shrink-0 text-muted-foreground">
                                {row.label}
                              </dt>
                              <dd className="min-w-0 text-right font-medium tabular-nums text-foreground">
                                {row.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                      {explain.note ? (
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          {explain.note}
                        </p>
                      ) : null}
                    </>
                  )
                })()}
              </div>
            </>
          ) : timelineDetail?.kind === 'alert' ? (
            <>
              <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <BellRing className="size-4 text-sky-600" />
                  Alert sent
                </DialogTitle>
                <DialogDescription className="text-[12px] text-muted-foreground">
                  Exact push notification that was sent
                  {timelineDetail.at
                    ? ` · ${fmtDateTime(timelineDetail.at) || fmtTime(timelineDetail.at)}`
                    : ''}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                <div className="rounded-xl border border-border bg-muted/30 p-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Title
                  </p>
                  <p className="mt-1 text-[15px] font-semibold leading-snug text-foreground">
                    {timelineDetail.notification?.title || '—'}
                  </p>
                  <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Body
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                    {timelineDetail.notification?.body || '—'}
                  </p>
                </div>
                {timelineDetail.ev.pushResult ? (
                  <div className="rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
                    <p className="font-semibold text-foreground">Delivery</p>
                    <p className="mt-0.5 tabular-nums">
                      {timelineDetail.ev.pushResult.skipped
                        ? `Skipped · ${timelineDetail.ev.pushResult.reason || 'n/a'}`
                        : `ok ${timelineDetail.ev.pushResult.sent_ok ?? '—'} / ${timelineDetail.ev.pushResult.recipient_count ?? '—'} devices`}
                      {timelineDetail.ev.pushResult.sent_failed
                        ? ` · failed ${timelineDetail.ev.pushResult.sent_failed}`
                        : ''}
                      {timelineDetail.ev.pushResult.source
                        ? ` · ${timelineDetail.ev.pushResult.source}`
                        : ''}
                      {timelineDetail.ev.pushResult.forced_allowlist
                        ? ' · allowlist'
                        : ''}
                    </p>
                    {(() => {
                      const recips =
                        timelineDetail.ev.pushResult.recipients?.length
                          ? timelineDetail.ev.pushResult.recipients
                          : (timelineDetail.ev.pushResult.device_ids || []).map(
                              (id) => ({
                                device_id: id,
                                expo_push_token_masked: '—',
                                status: undefined as string | undefined,
                              }),
                            )
                      if (!recips.length) {
                        return (
                          <p className="mt-2 text-[10px] text-muted-foreground">
                            No recipient devices recorded on this alert.
                          </p>
                        )
                      }
                      return (
                        <ul className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                          <li className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Sent to
                          </li>
                          {recips.map((r, i) => {
                            const id = r.device_id || 'unknown device'
                            const token =
                              r.expo_push_token_masked ||
                              (r.expo_push_token
                                ? `${String(r.expo_push_token).slice(0, 18)}…`
                                : '—')
                            const status = String(r.status || '').toLowerCase()
                            const statusLabel =
                              status === 'ok'
                                ? 'delivered'
                                : status === 'error'
                                  ? 'error'
                                  : status || 'sent'
                            return (
                              <li
                                key={`${id}-${i}`}
                                className="rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[10px] leading-snug text-foreground"
                              >
                                <span className="font-semibold">{id}</span>
                                <span className="mt-0.5 block truncate text-muted-foreground">
                                  {token}
                                </span>
                                <span
                                  className={cn(
                                    'mt-0.5 inline-block rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
                                    status === 'ok'
                                      ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                                      : status === 'error'
                                        ? 'bg-rose-500/15 text-rose-800 dark:text-rose-300'
                                        : 'bg-muted text-muted-foreground',
                                  )}
                                >
                                  {statusLabel}
                                  {r.forced ? ' · forced' : ''}
                                </span>
                                {r.error ? (
                                  <span className="mt-0.5 block text-rose-700 dark:text-rose-300">
                                    {r.error}
                                  </span>
                                ) : null}
                              </li>
                            )
                          })}
                        </ul>
                      )
                    })()}
                  </div>
                ) : null}
                <p className="text-[11px] text-muted-foreground">
                  {timelineDetail.ev.eventType
                    ? timelineDetail.ev.eventType.replace(/^MOMENTUM_/, '')
                    : 'alert'}
                  {timelineDetail.ev.detectedWindow
                    ? ` · ${timelineDetail.ev.detectedWindow}`
                    : ''}
                  {Number.isFinite(timelineDetail.ev.movePercent)
                    ? ` · ${fmtPct(timelineDetail.ev.movePercent)}`
                    : ''}
                </p>
              </div>
            </>
          ) : timelineDetail?.kind === 'perplexity' ? (
            <>
              <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <PerplexityLogo className="size-4" />
                  Perplexity reason
                </DialogTitle>
                <DialogDescription className="text-[12px] text-muted-foreground">
                  Exact research output used for this step
                  {timelineDetail.at
                    ? ` · ${fmtDateTime(timelineDetail.at) || fmtTime(timelineDetail.at)}`
                    : ''}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {timelineDetail.research.likely_driver ? (
                  <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-300">
                      Likely driver
                    </p>
                    <p className="mt-1 text-[13px] font-medium leading-snug text-foreground">
                      {timelineDetail.research.likely_driver}
                    </p>
                  </div>
                ) : null}
                <div className="rounded-xl border border-border bg-muted/30 p-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Full reason
                  </p>
                  <pre className="mt-1.5 max-h-[min(40vh,18rem)] overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-foreground">
                    {timelineDetail.research.reason || '—'}
                  </pre>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {timelineDetail.research.provider ? (
                    <span>{timelineDetail.research.provider}</span>
                  ) : null}
                  {timelineDetail.research.model ? (
                    <span className="font-mono text-[10px]">
                      {timelineDetail.research.model}
                    </span>
                  ) : null}
                  {timelineDetail.research.cost_usd_display ? (
                    <span>{timelineDetail.research.cost_usd_display}</span>
                  ) : null}
                </div>
                {timelineDetail.research.search_results?.length ||
                timelineDetail.research.citations?.length ? (
                  <div className="rounded-lg border border-border px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Sources
                    </p>
                    <ul className="mt-1 max-h-28 space-y-1 overflow-y-auto text-[11px]">
                      {(timelineDetail.research.search_results?.length
                        ? timelineDetail.research.search_results
                        : (timelineDetail.research.citations || []).map(
                            (url) => ({
                              url,
                              title: url,
                            }),
                          )
                      )
                        .slice(0, 8)
                        .map((src, i) => (
                          <li key={i} className="truncate">
                            {src.url ? (
                              <a
                                href={src.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
                              >
                                {src.title || src.url}
                              </a>
                            ) : (
                              <span>{src.title || 'source'}</span>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          <DialogFooter className="shrink-0 border-t border-border px-5 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTimelineDetail(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Stat({
  label,
  value,
  valueClass,
  sub,
  detail,
}: {
  label: string
  value: string
  valueClass?: string
  sub?: ReactNode
  /** Rich hover detail (episode cards) */
  detail?: ReactNode
}) {
  const body = (
    <div
      className={cn(
        'rounded-lg bg-muted/40 px-3 py-2.5',
        detail &&
          'cursor-help transition-colors hover:bg-muted/70 hover:ring-1 hover:ring-border',
      )}
    >
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-sm font-semibold tabular-nums', valueClass)}>
        {value}
      </p>
      {sub != null && sub !== '' ? (
        <div
          className={cn(
            'mt-0.5 text-[11px] font-medium tabular-nums',
            typeof sub === 'string'
              ? valueClass || 'text-muted-foreground'
              : 'text-muted-foreground',
          )}
        >
          {sub}
        </div>
      ) : null}
    </div>
  )

  if (!detail) return body

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="min-w-0">{body}</div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="!inline-flex !w-auto max-w-[min(22rem,92vw)] flex-col !items-stretch !gap-0 border border-white/10 bg-[#0F1C19] px-4 py-3.5 text-left text-background shadow-xl"
      >
        {detail}
      </TooltipContent>
    </Tooltip>
  )
}
