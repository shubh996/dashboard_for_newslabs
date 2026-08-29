/**
 * Episode Dashboard — multi-ticker momentum / episode desk.
 * Home-tab only · left status + collapsible right activity log.
 * Every watchlist tab gets live quote, chart, rolling returns, episode, logs.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  BellRing,
  Bitcoin,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  DollarSign,
  ArrowUpRight,
  Info,
  LineChart,
  ListFilter,
  Loader2,
  PieChart,
  Moon,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Settings,
  Sun,
  Terminal,
  Trash2,
  Users,
  Wheat,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  formatEtWallInTimeZone,
  UK_ZONE,
  usEquitySessionFromEtClock,
} from '@/lib/usEquitySession'
import { YahooInteractiveChart } from '@/components/yahoo/YahooInteractiveChart'
import { PerplexityPromptsDialog } from '@/components/hub/PerplexityPromptsDialog'
import {
  DeskUserListButton,
  DeskUserProfilePanel,
  deskDeviceKey,
  type DeskDevice,
  type DeskUserActivity,
} from '@/components/hub/desk-users'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  fetchMomentumMonitoredTickers,
  fetchYahooQuote,
  fetchYahooQuotes,
  fetchYahooSavedTickers,
  searchYahooSaved,
  type YahooLiveQuote,
} from '@/services/yahooApi'
import type { YahooSearchResult } from '@/types/yahoo'
import { resolveYahooActiveSession } from '@/lib/yahooMarketSession'
import {
  YahooFinanceWithMarketState,
} from '@/components/yahoo/YahooMarketStateLabel'
import { CompanyLogo } from '@/components/hub/company-logo'
import { SubscriberHoverCard } from '@/components/hub/subscriber-hover-card'
import { timeZoneSuffix } from '@/lib/localTimeZone'
import {
  formatExchangeTime,
  resolveExchangeTimeZone,
} from '@/lib/exchangeTimeZone'

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
  episodeNo?: number | null
  endedAt?: string | null
  endReason?: string | null
  lastNotifiedEpisodeMovePct?: number
  referencePrice?: number | null
  referenceTime?: string | null
  triggerPrice?: number | null
  peakPrice?: number | null
  troughPrice?: number | null
  exactMinutes?: number | null
  exactLabel?: string | null
  marketSession?: string | null
  lastMaterialProgressAt?: string | null
  ticker?: string
  supabaseSaved?: boolean
  supabasePersist?: {
    ok?: boolean
    action?: 'saved' | 'updated' | string
    at?: string | null
    id?: string | null
  } | null
}

/** Compact ACTIVE episode row for the right-rail “Active episodes” list. */
type ActiveEpisodeRow = {
  ticker: string
  episodeId?: string | null
  episodeNo?: number | null
  /** Exact Supabase origin for the episode row. */
  sourceTable?: string | null
  sourceRowId?: string | null
  direction: 'UP' | 'DOWN' | string
  status?: string
  state?: string | null
  detectedWindow?: string | null
  currentMovePercent?: number | null
  peakMovePercent?: number | null
  initialMovePercent?: number | null
  lastNotifiedEpisodeMovePct?: number | null
  currentPrice?: number | null
  referencePrice?: number | null
  referenceTime?: string | null
  peakPrice?: number | null
  troughPrice?: number | null
  episodeStartedAt?: string | null
  /** Actual recorded push audience when available; otherwise UI falls back to current subscribers. */
  notificationRecipientCount?: number | null
  exactMinutes?: number | null
  exactLabel?: string | null
  lastMaterialProgressAt?: string | null
  marketSession?: string | null
  endReason?: string | null
  endedAt?: string | null
  supabaseSaved?: boolean
  supabasePersist?: {
    ok?: boolean
    action?: 'saved' | 'updated' | string
    at?: string | null
    id?: string | null
  } | null
}

type AllEpisodesSortKey =
  | 'started'
  | 'peak'
  | 'now'
  | 'soFar'
  | 'status'
  | 'ticker'

const ALL_EPISODES_SORT_OPTIONS: Array<{
  key: AllEpisodesSortKey
  label: string
}> = [
  { key: 'soFar', label: 'So Far %' },
  { key: 'peak', label: 'Peak %' },
  { key: 'now', label: 'Now %' },
  { key: 'started', label: 'Started time' },
  { key: 'status', label: 'Status (Live)' },
  { key: 'ticker', label: 'Ticker' },
]

/** Stable key for desk episode list focus / keyboard nav. */
function deskEpisodeNavKey(row: ActiveEpisodeRow | null | undefined): string {
  if (!row) return ''
  const eid = row.episodeId != null ? String(row.episodeId).trim() : ''
  if (eid) return `id:${eid}`
  const ticker = String(row.ticker || '')
    .trim()
    .toUpperCase()
  return `t:${ticker}|s:${row.episodeStartedAt || ''}|n:${row.episodeNo ?? ''}`
}

function deskEpisodeRowsMatch(
  a: ActiveEpisodeRow | null | undefined,
  b: ActiveEpisodeRow | null | undefined,
): boolean {
  if (!a || !b) return false
  const aId = a.episodeId != null ? String(a.episodeId).trim() : ''
  const bId = b.episodeId != null ? String(b.episodeId).trim() : ''
  if (aId && bId) return aId === bId
  return (
    String(a.ticker || '')
      .trim()
      .toUpperCase() ===
      String(b.ticker || '')
        .trim()
        .toUpperCase() &&
    a.episodeStartedAt === b.episodeStartedAt &&
    (a.episodeNo ?? null) === (b.episodeNo ?? null)
  )
}

/** Scheduled OPEN / MIDDAY / CLOSE market summary (not an episode). */
/** Perplexity research payload attached to a timeline event */
type EventResearch = {
  researchId?: string | null
  episodeId?: string | null
  status?: 'running' | 'done' | 'error' | string | null
  reason?: string | null
  likely_driver?: string | null
  secondary_driver?: string | null
  move_classification?: string | null
  confidence?: string | null
  alert?: { title?: string | null; body?: string | null } | null
  provider?: string | null
  model?: string | null
  model_version?: string | null
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
  shortReason?: string | null
  likely_driver?: string | null
  researchId?: string | null
  research?: EventResearch | null
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
  episodeNo?: number | null
  supabaseSaved?: boolean
  supabasePersist?: {
    ok?: boolean
    action?: 'saved' | 'updated' | string
    at?: string | null
    id?: string | null
  } | null
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
    always_notify_included?: boolean
    recipients?: Array<{
      device_id?: string | null
      expo_push_token?: string
      expo_push_token_masked?: string
      always_notify?: boolean
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
  episodeId?: string | null
  episodeNo?: number | null
  endReason?: string | null
  /** Session at STARTED (pre-market / after-hours / …) for date labels */
  marketSession?: string | null
}

function formatEpisodeNo(n: number | null | undefined): string | null {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return null
  return `#${String(Math.floor(v)).padStart(3, '0')}`
}

/** ISO → value for <input type="datetime-local"> (local wall clock). */
function isoToDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.parse(String(iso))
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local value → ISO (or null if empty). */
function datetimeLocalToIso(local: string | null | undefined): string | null {
  const s = String(local || '').trim()
  if (!s) return null
  const ms = Date.parse(s)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

const EPISODE_STATUS_OPTIONS = [
  'ACTIVE',
  'ENDED',
  'EXPIRED',
  'REVERSED',
  'CLOSED_AT_MARKET_CLOSE',
] as const

const EPISODE_STATE_OPTIONS = [
  'STARTED',
  'HOLDING',
  'ACCELERATING',
  'WEAKENING',
  'STRONGLY_WEAKENING',
  'RE_ACCELERATING',
  'REVERSAL',
  'EXPIRED',
  'ENDED',
] as const

type EpisodeEditDraft = {
  episodeId: string
  episodeNo: string
  direction: 'UP' | 'DOWN'
  status: string
  state: string
  detectedWindow: string
  episodeStartedAt: string
  endedAt: string
  endReason: string
  referencePrice: string
  referenceTime: string
  triggerPrice: string
  currentPrice: string
  peakPrice: string
  troughPrice: string
  initialMovePercent: string
  peakMovePercent: string
  currentMovePercent: string
  lastNotifiedEpisodeMovePct: string
  lastMaterialProgressAt: string
  exactMinutes: string
  exactLabel: string
  events: Array<{
    id: string
    originalDetectedAt: string
    eventType: string
    state: string
    direction: string
    detectedAt: string
    movePercent: string
    price: string
    reason: string
    detectedWindow: string
  }>
}

function buildEpisodeEditDraft(
  group: EpisodeEventGroup,
  live: Episode | null | undefined,
  historyRows: Episode[] | null | undefined,
): EpisodeEditDraft {
  const eid = String(group.episodeId || '').trim()
  const fromHist =
    (historyRows || []).find((e) => String(e.episodeId || '') === eid) || null
  const fromLive =
    live && String(live.episodeId || '') === eid ? live : null
  const ep = fromLive || fromHist
  const started =
    ep?.episodeStartedAt || group.startedAt || ''
  const startEv = group.events.find(
    (e) =>
      e.eventType === 'MOMENTUM_STARTED' ||
      String(e.eventType || '').endsWith('_STARTED'),
  )
  return {
    episodeId: eid,
    episodeNo:
      ep?.episodeNo != null
        ? String(ep.episodeNo)
        : group.episodeNo != null
          ? String(group.episodeNo)
          : '',
    direction: (ep?.direction || group.direction || 'UP') === 'DOWN' ? 'DOWN' : 'UP',
    status: String(ep?.status || group.status || 'ENDED').toUpperCase(),
    state: String(
      ep?.state || group.liveState || group.endReason || '',
    ).toUpperCase(),
    detectedWindow: String(
      ep?.detectedWindow || group.window || startEv?.detectedWindow || '',
    ),
    episodeStartedAt: isoToDatetimeLocalValue(started),
    endedAt: isoToDatetimeLocalValue(ep?.endedAt || group.endedAt),
    endReason: String(ep?.endReason || group.endReason || ''),
    referencePrice:
      ep?.referencePrice != null
        ? String(ep.referencePrice)
        : startEv?.referencePrice != null
          ? String(startEv.referencePrice)
          : '',
    referenceTime: isoToDatetimeLocalValue(
      ep?.referenceTime || startEv?.referenceTime,
    ),
    triggerPrice:
      ep?.triggerPrice != null
        ? String(ep.triggerPrice)
        : startEv?.triggerPrice != null
          ? String(startEv.triggerPrice)
          : startEv?.price != null
            ? String(startEv.price)
            : '',
    currentPrice:
      ep?.currentPrice != null
        ? String(ep.currentPrice)
        : '',
    peakPrice: ep?.peakPrice != null ? String(ep.peakPrice) : '',
    troughPrice: ep?.troughPrice != null ? String(ep.troughPrice) : '',
    initialMovePercent:
      ep?.initialMovePercent != null
        ? String(ep.initialMovePercent)
        : startEv?.movePercent != null
          ? String(startEv.movePercent)
          : '',
    peakMovePercent:
      ep?.peakMovePercent != null
        ? String(ep.peakMovePercent)
        : group.peakMovePercent != null
          ? String(group.peakMovePercent)
          : '',
    currentMovePercent:
      ep?.currentMovePercent != null ? String(ep.currentMovePercent) : '',
    lastNotifiedEpisodeMovePct:
      ep?.lastNotifiedEpisodeMovePct != null
        ? String(ep.lastNotifiedEpisodeMovePct)
        : '',
    lastMaterialProgressAt: isoToDatetimeLocalValue(ep?.lastMaterialProgressAt),
    exactMinutes: ep?.exactMinutes != null ? String(ep.exactMinutes) : '',
    exactLabel: ep?.exactLabel != null ? String(ep.exactLabel) : '',
    events: (group.events || []).map((ev) => ({
      id: String(ev.supabasePersist?.id || ''),
      originalDetectedAt: String(ev.detectedAt || ''),
      eventType: String(ev.eventType || ''),
      state: String(ev.state || ''),
      direction: String(ev.direction || group.direction || 'UP'),
      detectedAt: isoToDatetimeLocalValue(ev.detectedAt),
      movePercent:
        ev.movePercent != null && Number.isFinite(Number(ev.movePercent))
          ? String(ev.movePercent)
          : '',
      price:
        ev.price != null && Number.isFinite(Number(ev.price))
          ? String(ev.price)
          : '',
      reason: String(ev.reason || ''),
      detectedWindow: String(ev.detectedWindow || ''),
    })),
  }
}

/** Giveback of the episode move from peak (UP) or trough (DOWN). 0–100. */
function computeEpisodeGivebackPercent(ep: {
  direction?: string | null
  referencePrice?: number | null
  peakPrice?: number | null
  troughPrice?: number | null
  currentPrice?: number | null
  peakMovePercent?: number | null
  currentMovePercent?: number | null
}): number | null {
  const live = Number(ep.currentPrice)
  const ref = Number(ep.referencePrice)
  if (Number.isFinite(ref) && Number.isFinite(live)) {
    if (String(ep.direction || '').toUpperCase() === 'DOWN') {
      const trough = Number(ep.troughPrice ?? live)
      const drop = ref - trough
      if (drop > 0) return Math.max(0, ((live - trough) / drop) * 100)
    } else {
      const peak = Number(ep.peakPrice ?? live)
      const gain = peak - ref
      if (gain > 0) return Math.max(0, ((peak - live) / gain) * 100)
    }
  }
  const peakM = Number(ep.peakMovePercent)
  const curM = Number(ep.currentMovePercent)
  if (Number.isFinite(peakM) && peakM !== 0 && Number.isFinite(curM)) {
    return Math.max(0, ((Math.abs(peakM) - Math.abs(curM)) / Math.abs(peakM)) * 100)
  }
  return null
}

function fmtGivebackPct(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null
  return `${n.toFixed(1)}%`
}

/** Shared dark calc tooltip shell (matches rolling-return / Stat tooltips). */
function CalcTooltipContent({
  children,
  className,
  side = 'top',
}: {
  children: ReactNode
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <TooltipContent
      side={side}
      sideOffset={8}
      className={cn(
        '!inline-flex !w-auto max-w-[min(22rem,92vw)] flex-col !items-stretch !gap-0 border border-white/10 bg-[#0F1C19] px-4 py-3.5 text-left text-background shadow-xl',
        className,
      )}
    >
      {children}
    </TooltipContent>
  )
}

/**
 * All-episodes Move column hover: how the shown % was calculated + Supabase source.
 */
function EpisodeListMoveCalcBody({
  row,
  shownMove,
  shownKind,
}: {
  row: ActiveEpisodeRow
  shownMove: number
  shownKind: 'current' | 'peak' | 'initial'
}) {
  const dir = String(row.direction || 'UP').toUpperCase() === 'DOWN' ? 'DOWN' : 'UP'
  const ref = Number(row.referencePrice)
  const live = Number(row.currentPrice)
  const peak = Number(row.peakPrice)
  const trough = Number(row.troughPrice)
  const extreme =
    shownKind === 'peak'
      ? dir === 'DOWN'
        ? trough
        : peak
      : live
  const fmtP = (n: number | null | undefined) =>
    n != null && Number.isFinite(Number(n)) ? fmtPrice(Number(n)) : '—'

  let formula: string | null = null
  let computed: number | null = null
  if (Number.isFinite(ref) && ref !== 0 && Number.isFinite(extreme)) {
    computed = ((extreme - ref) / ref) * 100
    formula = `((${fmtP(extreme)} − ${fmtP(ref)}) ÷ ${fmtP(ref)}) × 100 ≈ ${fmtPct(computed)}`
  }

  const fromSupabase = Boolean(
    row.supabaseSaved || row.supabasePersist?.ok || row.episodeId,
  )
  const persistAction = String(row.supabasePersist?.action || '').toLowerCase()
  const kindLabel =
    shownKind === 'peak'
      ? 'Peak move'
      : shownKind === 'initial'
        ? 'Initial move'
        : 'Current move'

  return (
    <div className="flex w-[min(20rem,88vw)] flex-col gap-2.5 text-left text-[13px] leading-relaxed">
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-background/65">
          {kindLabel} · how calculated
        </p>
        <p className="text-[14px] font-semibold leading-snug text-background">
          Episode move vs reference price from when this episode opened (
          {dir === 'DOWN' ? 'DOWN' : 'UP'}).
        </p>
      </div>
      <p className="text-[12px] leading-snug text-background/75">
        {shownKind === 'peak'
          ? dir === 'DOWN'
            ? 'Peak move uses the trough (lowest live) vs reference.'
            : 'Peak move uses the peak (highest live) vs reference.'
          : 'Current move uses the latest live / event price vs reference.'}{' '}
        Window: {row.detectedWindow || '—'}.
      </p>
      {formula ? (
        <div className="rounded-lg bg-background/10 px-3 py-2.5 font-mono text-[12px] leading-snug text-background">
          {formula}
        </div>
      ) : (
        <div className="rounded-lg bg-background/10 px-3 py-2.5 text-[12px] leading-snug text-background/80">
          Shown:{' '}
          <span className="font-semibold tabular-nums text-background">
            {fmtPct(shownMove)}
          </span>
          . Prices for the formula are not on this row.
        </div>
      )}
      <div className="space-y-1 border-t border-background/15 pt-2 text-[12px] text-background/70">
        <p>
          Reference:{' '}
          <span className="font-semibold tabular-nums text-background">
            {fmtP(Number.isFinite(ref) ? ref : null)}
          </span>
          {row.referenceTime
            ? ` · ${fmtDateTime(row.referenceTime) || ''}`
            : ''}
        </p>
        <p>
          {shownKind === 'peak'
            ? dir === 'DOWN'
              ? 'Trough'
              : 'Peak'
            : 'Live / event'}
          :{' '}
          <span className="font-semibold tabular-nums text-background">
            {fmtP(Number.isFinite(extreme) ? extreme : null)}
          </span>
        </p>
        <p>
          Move:{' '}
          <span className="font-semibold tabular-nums text-background">
            {fmtPct(shownMove)}
          </span>
          {computed != null && Number.isFinite(computed)
            ? ` · recomputed ${fmtPct(computed)}`
            : ''}
        </p>
      </div>
      <div className="border-t border-background/15 pt-2 text-[12px] leading-snug text-background/75">
        {fromSupabase ? (
          <p>
            <span className="font-semibold text-emerald-300">Supabase</span>
            {' · '}
            {persistAction === 'updated'
              ? 'updated / saved row loaded from Supabase'
              : 'saved episode row (loaded from or written to Supabase)'}
            {row.supabasePersist?.at
              ? ` · ${fmtDateTime(row.supabasePersist.at) || row.supabasePersist.at}`
              : ''}
            {row.episodeId ? (
              <span className="mt-0.5 block font-mono text-[10px] text-background/55">
                {String(row.episodeId)}
              </span>
            ) : null}
          </p>
        ) : (
          <p>
            <span className="font-semibold text-sky-300">Live engine</span>
            {' · '}
            calculated in-memory; not yet confirmed on a Supabase episode row.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Peak move = extreme episode move since open, always vs episode reference price.
 * UP uses peak price; DOWN uses trough price.
 */
function PeakMoveCalcBody({
  direction,
  peakMovePercent,
  peakPrice,
  troughPrice,
  referencePrice,
  peakTime,
  troughTime,
  assetClass,
  currency,
}: {
  direction?: string | null
  peakMovePercent?: number | null
  peakPrice?: number | null
  troughPrice?: number | null
  referencePrice?: number | null
  peakTime?: string | null
  troughTime?: string | null
  assetClass?: string | null
  currency?: string | null
}) {
  const dir = String(direction || 'UP').toUpperCase() === 'DOWN' ? 'DOWN' : 'UP'
  const ref = Number(referencePrice)
  const extreme =
    dir === 'DOWN' ? Number(troughPrice) : Number(peakPrice)
  const peakM = Number(peakMovePercent)
  const extremeTime = dir === 'DOWN' ? troughTime : peakTime
  const fmtP = (n: number | null | undefined) =>
    n != null && Number.isFinite(Number(n))
      ? fmtPrice(Number(n), assetClass, currency)
      : '—'

  let formula: string | null = null
  let computed: number | null = null
  if (Number.isFinite(ref) && ref !== 0 && Number.isFinite(extreme)) {
    computed = ((extreme - ref) / ref) * 100
    formula = `((${fmtP(extreme)} − ${fmtP(ref)}) ÷ ${fmtP(ref)}) × 100 ≈ ${fmtPct(computed)}`
  }

  return (
    <div className="flex w-[min(20rem,88vw)] flex-col gap-2.5 text-left text-[13px] leading-relaxed">
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-background/65">
          Peak move · how calculated
        </p>
        <p className="text-[14px] font-semibold leading-snug text-background">
          Largest |episode move| since this episode opened (high-water mark).
        </p>
      </div>
      <p className="text-[12px] leading-snug text-background/75">
        Episode move always uses the{' '}
        <span className="font-medium text-background">reference price</span> from
        when the episode started
        {dir === 'DOWN'
          ? ' — trough (lowest live) for DOWN'
          : ' — peak (highest live) for UP'}
        , not the rolling-window lookback.
      </p>
      {formula ? (
        <div className="rounded-lg bg-background/10 px-3 py-2.5 font-mono text-[12px] leading-snug text-background">
          {formula}
        </div>
      ) : (
        <div className="rounded-lg bg-background/10 px-3 py-2.5 text-[12px] leading-snug text-background/80">
          Peak move shown:{' '}
          <span className="font-semibold tabular-nums text-background">
            {fmtPct(peakM)}
          </span>
          . Prices for the formula are not available on this row.
        </div>
      )}
      <div className="space-y-1 border-t border-background/15 pt-2 text-[12px] text-background/70">
        <p>
          Reference:{' '}
          <span className="font-semibold tabular-nums text-background">
            {fmtP(Number.isFinite(ref) ? ref : null)}
          </span>
        </p>
        <p>
          {dir === 'DOWN' ? 'Trough' : 'Peak'} price:{' '}
          <span className="font-semibold tabular-nums text-background">
            {fmtP(Number.isFinite(extreme) ? extreme : null)}
          </span>
        </p>
        <p>
          Peak move:{' '}
          <span
            className={cn(
              'font-semibold tabular-nums',
              Number.isFinite(peakM)
                ? peakM > 0
                  ? 'text-emerald-300'
                  : peakM < 0
                    ? 'text-rose-300'
                    : 'text-background'
                : 'text-background',
            )}
          >
            {fmtPct(peakM)}
          </span>
        </p>
        {extremeTime ? (
          <p>
            Extreme at{' '}
            <span className="font-medium text-background">
              {fmtDateTime(extremeTime) || fmtTime(extremeTime)}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Giveback % = how much of the peak (UP) / trough (DOWN) move from reference
 * has faded back toward reference.
 */
function GivebackCalcBody({
  direction,
  givebackPercent,
  peakPrice,
  troughPrice,
  referencePrice,
  currentPrice,
  peakMovePercent,
  currentMovePercent,
  weakThreshold = 0.25,
  holdThreshold = 0.2,
  strongThreshold = 0.6,
  assetClass,
  currency,
}: {
  direction?: string | null
  givebackPercent?: number | null
  peakPrice?: number | null
  troughPrice?: number | null
  referencePrice?: number | null
  currentPrice?: number | null
  peakMovePercent?: number | null
  currentMovePercent?: number | null
  weakThreshold?: number
  holdThreshold?: number
  strongThreshold?: number
  assetClass?: string | null
  currency?: string | null
}) {
  const dir = String(direction || 'UP').toUpperCase() === 'DOWN' ? 'DOWN' : 'UP'
  const ref = Number(referencePrice)
  const live = Number(currentPrice)
  const peak = Number(peakPrice)
  const trough = Number(troughPrice)
  const gb = Number(givebackPercent)
  const fmtP = (n: number | null | undefined) =>
    n != null && Number.isFinite(Number(n))
      ? fmtPrice(Number(n), assetClass, currency)
      : '—'
  const pctBand = (r: number) => `${(r * 100).toFixed(0)}%`

  let formula: string | null = null
  if (dir === 'UP' && Number.isFinite(peak) && Number.isFinite(live) && Number.isFinite(ref) && peak !== ref) {
    const calc = ((peak - live) / (peak - ref)) * 100
    formula = `((${fmtP(peak)} − ${fmtP(live)}) ÷ (${fmtP(peak)} − ${fmtP(ref)})) × 100 ≈ ${Number.isFinite(calc) ? `${calc.toFixed(1)}%` : '—'}`
  } else if (
    dir === 'DOWN' &&
    Number.isFinite(trough) &&
    Number.isFinite(live) &&
    Number.isFinite(ref) &&
    trough !== ref
  ) {
    const calc = ((live - trough) / (ref - trough)) * 100
    formula = `((${fmtP(live)} − ${fmtP(trough)}) ÷ (${fmtP(ref)} − ${fmtP(trough)})) × 100 ≈ ${Number.isFinite(calc) ? `${calc.toFixed(1)}%` : '—'}`
  } else if (
    Number.isFinite(Number(peakMovePercent)) &&
    Number(peakMovePercent) !== 0 &&
    Number.isFinite(Number(currentMovePercent))
  ) {
    const peakM = Math.abs(Number(peakMovePercent))
    const curM = Math.abs(Number(currentMovePercent))
    const calc = Math.max(0, ((peakM - curM) / peakM) * 100)
    formula = `((|peak move| − |current move|) ÷ |peak move|) × 100 ≈ ${calc.toFixed(1)}%`
  }

  return (
    <div className="flex w-[min(20rem,88vw)] flex-col gap-2.5 text-left text-[13px] leading-relaxed">
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-background/65">
          Giveback % · how calculated
        </p>
        <p className="text-[16px] font-semibold tabular-nums text-background">
          {Number.isFinite(gb) ? `${gb.toFixed(1)}%` : '—'}
        </p>
      </div>
      <p className="text-[12px] leading-snug text-background/75">
        Share of the {dir === 'DOWN' ? 'trough' : 'peak'} move (from reference)
        that has faded back. Live numbers refresh every poll (~60s).
      </p>
      {formula ? (
        <div className="rounded-lg bg-background/10 px-3 py-2.5 font-mono text-[12px] leading-snug text-background">
          {formula}
        </div>
      ) : (
        <div className="rounded-lg bg-background/10 px-3 py-2.5 text-[12px] leading-snug text-background/80">
          Prices for the formula are not available on this row.
        </div>
      )}
      <div className="space-y-1 border-t border-background/15 pt-2 text-[12px] text-background/70">
        <p>
          Reference:{' '}
          <span className="font-semibold tabular-nums text-background">
            {fmtP(Number.isFinite(ref) ? ref : null)}
          </span>
        </p>
        <p>
          {dir === 'DOWN' ? 'Trough' : 'Peak'}:{' '}
          <span className="font-semibold tabular-nums text-background">
            {fmtP(
              dir === 'DOWN'
                ? Number.isFinite(trough)
                  ? trough
                  : null
                : Number.isFinite(peak)
                  ? peak
                  : null,
            )}
          </span>
        </p>
        <p>
          Live:{' '}
          <span className="font-semibold tabular-nums text-background">
            {fmtP(Number.isFinite(live) ? live : null)}
          </span>
        </p>
        <p className="pt-1 text-background/65">
          Holding below {pctBand(weakThreshold)} · Weakening ≥{' '}
          {pctBand(weakThreshold)} (back to Holding ≤ {pctBand(holdThreshold)})
          · Strongly weakening ≥ {pctBand(strongThreshold)}
        </p>
      </div>
    </div>
  )
}

/** Hover body for timeline UP/DOWN move % (event snapshot). */
function EventMoveCalcBody({
  ev,
  liveEpisode,
  assetClass,
  currency,
}: {
  ev: MomentumEvent
  liveEpisode?: Episode | null
  assetClass?: string | null
  currency?: string | null
}) {
  const explain = buildEventMeasureExplain(ev, {
    assetClass,
    currency,
    liveEpisode,
  })
  const dir = ev.direction === 'DOWN' ? 'DOWN' : 'UP'
  const move = Number(ev.movePercent)

  return (
    <div className="flex w-[min(20rem,88vw)] flex-col gap-2.5 text-left text-[13px] leading-relaxed">
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-background/65">
          {explain.title} · move % · how calculated
        </p>
        <p
          className={cn(
            'text-[16px] font-semibold tabular-nums',
            dir === 'UP' ? 'text-emerald-300' : 'text-rose-300',
          )}
        >
          {dir} {fmtPct(move)}
        </p>
      </div>
      <p className="text-[12px] leading-snug text-background/75">
        Snapshot at this timeline row — episode move vs the episode reference
        price (not re-computed every poll).
      </p>
      {explain.formula ? (
        <div className="rounded-lg bg-background/10 px-3 py-2.5 font-mono text-[12px] leading-snug text-background">
          {explain.formula}
        </div>
      ) : null}
      <div className="space-y-1 border-t border-background/15 pt-2 text-[12px] text-background/70">
        {explain.rows.slice(0, 5).map((row) => (
          <p key={row.label}>
            {row.label}:{' '}
            <span className="font-medium text-background">{row.value}</span>
          </p>
        ))}
      </div>
    </div>
  )
}

function lastGivebackFromEvents(events: MomentumEvent[] | null | undefined): number | null {
  if (!events?.length) return null
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const g = Number(events[i]?.givebackRatio)
    if (Number.isFinite(g)) return Math.max(0, g * 100)
  }
  return null
}

function eventPersistStamp(ev: MomentumEvent | null | undefined) {
  if (ev?.supabasePersist?.ok) return ev.supabasePersist
  if (ev?.supabaseSaved) return { ok: true, action: 'saved' as const, at: null }
  return null
}

function SupabasePersistBadge({
  persist,
}: {
  persist?: {
    ok?: boolean
    action?: string
    at?: string | null
  } | null
}) {
  if (!persist?.ok) return null
  const updated = persist.action === 'updated'
  return (
    <span
      className={cn(
        'rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
        updated
          ? 'bg-sky-500/15 text-sky-800 dark:text-sky-300'
          : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
      )}
      title={
        persist.at
          ? `${updated ? 'Updated' : 'Saved'} in Supabase · ${persist.at}`
          : `${updated ? 'Updated' : 'Saved'} in Supabase`
      }
    >
      {updated ? 'Updated' : 'Saved'}
    </span>
  )
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
    MANUAL: 'Ended',
    USER_EXIT: 'Ended',
    MARKET_CLOSE: 'Market close',
    CLOSED_AT_MARKET_CLOSE: 'Market close',
    WINDOW_OUT_OF_SCOPE: 'Out of scope',
    SUPERSEDED: 'Ended',
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
  const lower = k.toLowerCase()
  if (k === '24h' || k === 'day' || lower === '1d' || lower === '1day') return true
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
  const d = k.match(/^(\d+)d$/i)
  if (d) return Number(d[1]) <= 1
  return false
}

/**
 * Which events belong on the episode story rail.
 * Core lifecycle rows always stay (even if detectedWindow is missing after hydrate).
 * Multi-day-only windows (1w / 1M …) stay out of the ≤24h rail.
 */
function isTimelineEventIncluded(ev: MomentumEvent): boolean {
  const type = String(ev.eventType || '')
  if (
    type === 'MOMENTUM_STARTED' ||
    type.endsWith('_STARTED') ||
    type === 'MOMENTUM_ENDED' ||
    type.endsWith('_ENDED') ||
    type === 'MOMENTUM_REVERSED' ||
    type === 'MOMENTUM_ACCELERATING' ||
    type.includes('ACCELERAT') ||
    type === 'MOMENTUM_STATE' ||
    type === 'MOMENTUM_STATE_CHANGED' ||
    type.endsWith('_STATE') ||
    type === 'MOMENTUM_STRONG_WEAKENING' ||
    type === 'MOMENTUM_STRONG_GIVEBACK' ||
    type === 'MOMENTUM_STRONG_REVERSAL' ||
    type === 'MOMENTUM_MAJOR_FADE' ||
    type === 'MOMENTUM_RESEARCH_DONE' ||
    type === 'MOMENTUM_RESEARCH_RUNNING' ||
    type.includes('RESEARCH') ||
    type === 'MOMENTUM_ALERT_SENT' ||
    type.endsWith('_ALERT_SENT')
  ) {
    return true
  }
  // No window key but still an episode row → keep (don't drop mid-story)
  if (!ev.detectedWindow || ev.detectedWindow === '—') {
    return Boolean(ev.episodeId || ev.state || ev.reason)
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
    summary = `Move extended further ${dir === 'UP' ? 'up' : 'down'} past the last notified level (material acceleration, usually ≥2 pp). That is when another push can fire.`
  } else if (
    type === 'MOMENTUM_STRONG_WEAKENING' ||
    type === 'MOMENTUM_STRONG_GIVEBACK' ||
    type === 'MOMENTUM_STRONG_REVERSAL' ||
    type === 'MOMENTUM_MAJOR_FADE' ||
    type === 'STRONG_REVERSAL' ||
    type === 'STRONG_WEAKENING' ||
    type === 'STRONG_GIVEBACK'
  ) {
    summary =
      'About 60% or more of the peak/trough move from reference has faded. One-shot strong-giveback push for this episode — not a full direction reverse.'
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
        'Accelerating means the move is extending from Holding/Started without needing a prior fade. Push still needs ~+2 pp beyond the last alert.'
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
 * display steps chronological (oldest top → newest bottom) for full story.
 */
function isEndEventType(eventType: string | null | undefined): boolean {
  const type = String(eventType || '')
  return (
    type === 'MOMENTUM_ENDED' ||
    type === 'MOMENTUM_REVERSED' ||
    type.endsWith('_ENDED')
  )
}

function applyEventToGroup(g: EpisodeEventGroup, ev: MomentumEvent) {
  g.events.push(ev)
  if (
    Number.isFinite(ev.movePercent) &&
    Math.abs(ev.movePercent) > Math.abs(g.peakMovePercent)
  ) {
    g.peakMovePercent = ev.movePercent
  }
  if (ev.detectedWindow && ev.detectedWindow !== '—') {
    g.window = ev.detectedWindow
  }
  if (ev.episodeNo != null && Number.isFinite(Number(ev.episodeNo))) {
    g.episodeNo = Number(ev.episodeNo)
  }
  if (isEndEventType(ev.eventType)) {
    g.endedAt = ev.detectedAt
    g.status = 'ENDED'
    g.endReason = ev.reason || g.endReason || null
  }
}

function groupEventsByEpisode(events: MomentumEvent[] | null | undefined): EpisodeEventGroup[] {
  if (!events?.length) return []
  const filtered = events.filter(isTimelineEventIncluded)
  if (!filtered.length) return []
  const chronological = [...filtered].sort(
    (a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt),
  )
  const groups: EpisodeEventGroup[] = []
  const byId = new Map<string, EpisodeEventGroup>()
  let current: EpisodeEventGroup | null = null

  const startGroup = (ev: MomentumEvent): EpisodeEventGroup => {
    const ended = isEndEventType(ev.eventType)
    const g: EpisodeEventGroup = {
      id: ev.episodeId || `${ev.detectedAt}-${ev.direction}-${groups.length}`,
      direction: ev.direction || 'UP',
      startedAt: ev.detectedAt,
      endedAt: ended ? ev.detectedAt : null,
      status: ended ? 'ENDED' : 'ACTIVE',
      peakMovePercent: Number(ev.movePercent) || 0,
      window: ev.detectedWindow || '—',
      events: [ev],
      episodeId: ev.episodeId || null,
      episodeNo: ev.episodeNo ?? null,
      endReason: ended ? ev.reason || null : null,
      marketSession: ev.marketSession || null,
    }
    groups.push(g)
    if (ev.episodeId) byId.set(ev.episodeId, g)
    return g
  }

  for (const ev of chronological) {
    const type = String(ev.eventType || '')
    const eid = ev.episodeId || null
    if (eid && byId.has(eid)) {
      applyEventToGroup(byId.get(eid)!, ev)
      continue
    }

    const isMarker =
      type === 'MOMENTUM_RESEARCH_DONE' ||
      type === 'MOMENTUM_RESEARCH_RUNNING' ||
      type.includes('RESEARCH') ||
      type === 'MOMENTUM_ALERT_SENT' ||
      type.endsWith('_ALERT_SENT')
    const isStart = type === 'MOMENTUM_STARTED' || type.endsWith('_STARTED')

    if (isMarker) {
      if (current && current.status === 'ACTIVE') {
        applyEventToGroup(current, ev)
      } else if (groups.length > 0) {
        applyEventToGroup(groups[groups.length - 1], ev)
      } else {
        current = startGroup(ev)
      }
      continue
    }

    if (isStart || !current || current.status === 'ENDED') {
      current = startGroup(ev)
      continue
    }

    applyEventToGroup(current, ev)
  }

  // Newest episode first; keep events chronological (oldest first) inside
  return groups.reverse()
}

function isEpisodeRowActive(status: string | null | undefined): boolean {
  return String(status || '').toUpperCase() === 'ACTIVE'
}

function isEpisodeEligibleForRail(ep: {
  detectedWindow?: string | null
  status?: string | null
}): boolean {
  const w = ep.detectedWindow
  if (!w || w === '—') return true
  return isIntradayOr24hEventWindow(w)
}

/**
 * Build the Episodes rail from durable episode rows + timeline events.
 * Past episodes always appear (collapsed stubs) even when their events
 * were pruned from the ring buffer.
 */
function buildEpisodeGroups(
  episodes: Episode[] | null | undefined,
  events: MomentumEvent[] | null | undefined,
  liveEpisode: Episode | null | undefined,
  opts?: { includeAllWindows?: boolean },
): EpisodeEventGroup[] {
  const eventGroups = groupEventsByEpisode(events)
  const byEpisodeId = new Map<string, EpisodeEventGroup>()
  for (const g of eventGroups) {
    if (g.episodeId) byEpisodeId.set(String(g.episodeId), g)
  }

  const seen = new Set<string>()
  const merged: EpisodeEventGroup[] = []
  const includeAllWindows = Boolean(opts?.includeAllWindows)

  const rows = [...(episodes || [])]
  if (
    liveEpisode?.episodeId &&
    !rows.some((r) => String(r.episodeId) === String(liveEpisode.episodeId))
  ) {
    rows.unshift(liveEpisode)
  }

  for (const ep of rows) {
    const eid = ep.episodeId ? String(ep.episodeId) : ''
    if (!eid || seen.has(eid)) continue
    if (!includeAllWindows && !isEpisodeEligibleForRail(ep)) continue
    seen.add(eid)

    const fromEvents = byEpisodeId.get(eid)
    const active = isEpisodeRowActive(ep.status)
    if (fromEvents) {
      merged.push({
        ...fromEvents,
        id: eid,
        direction: fromEvents.direction || ep.direction || 'UP',
        startedAt: fromEvents.startedAt || ep.episodeStartedAt || '',
        endedAt: fromEvents.endedAt || ep.endedAt || null,
        status: active ? 'ACTIVE' : 'ENDED',
        peakMovePercent:
          Math.abs(fromEvents.peakMovePercent) >=
          Math.abs(Number(ep.peakMovePercent) || 0)
            ? fromEvents.peakMovePercent
            : Number(ep.peakMovePercent) || 0,
        window:
          fromEvents.window && fromEvents.window !== '—'
            ? fromEvents.window
            : ep.detectedWindow || '—',
        episodeId: eid,
        episodeNo: fromEvents.episodeNo ?? ep.episodeNo ?? null,
        endReason: fromEvents.endReason || ep.endReason || null,
        liveState: active ? ep.state || fromEvents.liveState || null : null,
        marketSession:
          fromEvents.marketSession || ep.marketSession || null,
      })
    } else {
      merged.push({
        id: eid,
        direction: ep.direction || 'UP',
        startedAt: ep.episodeStartedAt || '',
        endedAt: ep.endedAt || null,
        status: active ? 'ACTIVE' : 'ENDED',
        peakMovePercent: Number(ep.peakMovePercent) || 0,
        window: ep.detectedWindow || '—',
        events: [],
        episodeId: eid,
        episodeNo: ep.episodeNo ?? null,
        endReason: ep.endReason || null,
        liveState: active ? ep.state || null : null,
        marketSession: ep.marketSession || null,
      })
    }
  }

  // Event-only groups (not yet in episodes table / missing episodeId)
  for (const g of eventGroups) {
    const eid = g.episodeId ? String(g.episodeId) : ''
    if (eid && seen.has(eid)) continue
    if (eid) seen.add(eid)
    merged.push(g)
  }

  merged.sort((a, b) => {
    const tb = Date.parse(b.startedAt || '') || 0
    const ta = Date.parse(a.startedAt || '') || 0
    return tb - ta
  })
  return merged
}

function ensureGroupHasStartedEvent(group: EpisodeEventGroup): EpisodeEventGroup {
  const hasStart = group.events.some(
    (e) =>
      e.eventType === 'MOMENTUM_STARTED' ||
      String(e.eventType || '').endsWith('_STARTED'),
  )
  if (hasStart) return group
  const seed = group.events[0]
  const started: MomentumEvent = {
    eventType: 'MOMENTUM_STARTED',
    direction: group.direction,
    movePercent: group.peakMovePercent,
    detectedWindow: group.window,
    detectedAt: group.startedAt,
    state: 'STARTED',
    episodeId: group.episodeId || seed?.episodeId || null,
    episodeNo: group.episodeNo ?? seed?.episodeNo ?? null,
    price: seed?.price,
  }
  return { ...group, events: [started, ...group.events] }
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
  if (type === 'MOMENTUM_RALLY_BEGIN' || type.endsWith('_RALLY_BEGIN')) {
    return 'Rally begin'
  }
  if (type === 'MOMENTUM_STARTED' || type.endsWith('_STARTED')) return 'Started'
  if (type === 'MOMENTUM_ACCELERATING' || type.includes('ACCELERAT')) {
    const st = String(event?.state || '').toUpperCase()
    if (st === 'RE_ACCELERATING') return 'Re-accelerating'
    return 'Accelerating'
  }
  if (
    type === 'MOMENTUM_STRONG_WEAKENING' ||
    type === 'MOMENTUM_STRONG_GIVEBACK' ||
    type === 'MOMENTUM_STRONG_REVERSAL' ||
    type === 'MOMENTUM_MAJOR_FADE' ||
    type === 'STRONG_REVERSAL' ||
    type === 'STRONG_WEAKENING' ||
    type === 'STRONG_GIVEBACK'
  ) {
    return 'Strong giveback'
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

function mapApiResearchRow(row: Record<string, unknown> | null | undefined): EventResearch | null {
  if (!row || typeof row !== 'object') return null
  const citations = Array.isArray(row.citations)
    ? (row.citations as string[])
    : undefined
  const costUsd =
    typeof row.cost_usd === 'number' && Number.isFinite(row.cost_usd)
      ? row.cost_usd
      : null
  const alertRaw = row.alert
  const alert =
    alertRaw && typeof alertRaw === 'object' && !Array.isArray(alertRaw)
      ? {
          title: String((alertRaw as { title?: string }).title || '') || null,
          body: String((alertRaw as { body?: string }).body || '') || null,
        }
      : null
  return {
    researchId: row.id != null ? String(row.id) : null,
    episodeId: row.episode_id != null ? String(row.episode_id) : null,
    likely_driver: (row.likely_driver as string) || null,
    secondary_driver: (row.secondary_driver as string) || null,
    move_classification: (row.move_classification as string) || null,
    confidence: (row.confidence as string) || null,
    alert,
    model_version: (row.model_version as string) || (row.model as string) || null,
    citations,
    completedAt: (row.created_at as string) || null,
    cost_usd_display:
      (row.cost_usd_display as string) ||
      (costUsd != null ? `$${costUsd}` : null),
  }
}

function mergeEventResearch(
  base: EventResearch,
  full: EventResearch | null,
): EventResearch {
  if (!full) return base
  return {
    ...base,
    ...full,
    status: full.status || base.status,
    reason: full.reason || base.reason,
    likely_driver: full.likely_driver || base.likely_driver,
    secondary_driver: full.secondary_driver || base.secondary_driver,
    move_classification:
      full.move_classification || base.move_classification,
    confidence: full.confidence || base.confidence,
    alert: full.alert || base.alert,
    model_version: full.model_version || base.model_version || full.model || base.model,
    citations: full.citations?.length ? full.citations : base.citations,
    researchId: full.researchId || base.researchId,
    episodeId: full.episodeId || base.episodeId,
  }
}

const onDemandResearchCache = new Map<string, EventResearch>()

function clearOnDemandResearchCache() {
  onDemandResearchCache.clear()
}

function useOnDemandResearch(
  ev: MomentumEvent | undefined,
  enabled: boolean,
): { full: EventResearch | null; loading: boolean } {
  const rid = ev?.researchId || ev?.research?.researchId || null
  const eid = ev?.episodeId || null
  const cacheKey = rid ? `r:${rid}` : eid ? `e:${eid}` : ''
  const [full, setFull] = useState<EventResearch | null>(() =>
    cacheKey ? onDemandResearchCache.get(cacheKey) || null : null,
  )
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!enabled) return
    if (cacheKey && onDemandResearchCache.has(cacheKey)) {
      setFull(onDemandResearchCache.get(cacheKey) || null)
      return
    }
    const url = rid
      ? `/api/momentum/research/${encodeURIComponent(String(rid))}`
      : eid
        ? `/api/momentum/episodes/${encodeURIComponent(String(eid))}/research`
        : null
    if (!url) return
    let cancelled = false
    setLoading(true)
    void deskFetch(url)
      .then((res) => res.json().catch(() => ({})))
      .then((body: { research?: unknown }) => {
        if (cancelled) return
        const raw = body?.research
        const row = Array.isArray(raw) ? raw[0] : raw
        const mapped = mapApiResearchRow(row as Record<string, unknown>)
        if (mapped && cacheKey) onDemandResearchCache.set(cacheKey, mapped)
        if (mapped?.researchId) {
          onDemandResearchCache.set(`r:${mapped.researchId}`, mapped)
        }
        setFull(mapped)
      })
      .catch(() => {
        if (!cancelled) setFull(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, rid, eid, cacheKey])
  return { full, loading }
}

function extractLikelyDriverFromReason(reason: string | null | undefined): string | null {
  const text = String(reason || '').trim()
  if (!text) return null
  const m = text.match(/Likely driver:\s*(.+?)(?:\.\s*Secondary driver:|$)/i)
  if (m?.[1]) return m[1].trim().replace(/\.\s*$/, '')
  return null
}

function extractEventResearch(ev: MomentumEvent): EventResearch | null {
  const type = String(ev.eventType || '')
  const shortFromEv =
    (ev as { shortReason?: string | null }).shortReason ||
    ev.likely_driver ||
    null
  if (ev.research && (ev.research.reason || ev.research.likely_driver || shortFromEv)) {
    const reason = ev.research.reason || ev.reason || null
    return {
      ...ev.research,
      researchId: ev.research.researchId || ev.researchId || null,
      episodeId: ev.research.episodeId || ev.episodeId || null,
      reason,
      likely_driver:
        ev.research.likely_driver ||
        shortFromEv ||
        extractLikelyDriverFromReason(reason) ||
        null,
    }
  }
  if (
    (type.includes('RESEARCH') || shortFromEv || ev.reason) &&
    (ev.reason || shortFromEv)
  ) {
    const reason = ev.reason || null
    return {
      researchId: ev.researchId || null,
      episodeId: ev.episodeId || null,
      reason,
      likely_driver:
        shortFromEv || extractLikelyDriverFromReason(reason) || null,
      provider: 'perplexity',
      status: type.includes('RUNNING') ? 'running' : 'done',
      completedAt: ev.detectedAt,
    }
  }
  return null
}

/**
 * Expand stored events into display steps.
 * Full lifecycle: Rally begin → Started → Holding / Weakening / Accel →
 * Perplexity → Alert → Ended. Perplexity only attaches on STARTED.
 * Output is chronological (oldest → newest) so “how this move built”
 * reads top-to-bottom end-to-end — nothing mid-story dropped for recency.
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

/** Secondary line under a timeline step: time · $price · window. */
function timelineStepWhenLine(
  at: string | null | undefined,
  ev: MomentumEvent | null | undefined,
  marketSession: string | null | undefined,
  assetClass?: string | null,
  currency?: string | null,
  extra?: string | null,
): string {
  const when = fmtEpisodeWhen(at, ev?.marketSession || marketSession)
  const bits: string[] = [when]
  const price =
    ev?.price != null && Number.isFinite(Number(ev.price))
      ? fmtPrice(Number(ev.price), assetClass, currency)
      : null
  if (price) bits.push(price)
  const win = ev?.detectedWindow && ev.detectedWindow !== '—' ? ev.detectedWindow : null
  if (win) bits.push(win)
  if (extra) bits.push(extra)
  return bits.join(' · ')
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
  // If research already finished for an episode, never keep a "running" step
  // (stale MOMENTUM_RESEARCH_RUNNING rows can linger after hydrate).
  const researchDoneEpisodeIds = new Set<string>()
  let anyResearchDone = false
  for (const ev of events || []) {
    const type = String(ev.eventType || '')
    const st = String(ev.research?.status || '').toLowerCase()
    const done =
      type === 'MOMENTUM_RESEARCH_DONE' ||
      st === 'done' ||
      st === 'error' ||
      (type.includes('RESEARCH') &&
        type !== 'MOMENTUM_RESEARCH_RUNNING' &&
        st !== 'running')
    if (!done) continue
    anyResearchDone = true
    if (ev.episodeId) researchDoneEpisodeIds.add(String(ev.episodeId))
  }

  const steps: TimelineStep[] = []

  // Synthetic "Rally begin" = reference bar (before Started crossed the threshold).
  const startEv = (events || []).find((e) => isStartEventType(e.eventType))
  const refTime =
    startEv?.referenceTime ||
    (events || []).find((e) => e.referenceTime)?.referenceTime ||
    null
  const refPriceRaw =
    startEv?.referencePrice ??
    (events || []).find(
      (e) => e.referencePrice != null && Number(e.referencePrice) > 0,
    )?.referencePrice
  const refPrice =
    refPriceRaw != null &&
    Number.isFinite(Number(refPriceRaw)) &&
    Number(refPriceRaw) > 0
      ? Number(refPriceRaw)
      : null
  const startMs = startEv?.detectedAt
    ? Date.parse(String(startEv.detectedAt))
    : NaN
  const refMs = refTime ? Date.parse(String(refTime)) : NaN
  if (
    startEv &&
    refTime &&
    Number.isFinite(refMs) &&
    (!Number.isFinite(startMs) || refMs < startMs - 1000)
  ) {
    steps.push({
      id: `rally-begin-${refTime}`,
      kind: 'backend',
      ev: {
        ...startEv,
        eventType: 'MOMENTUM_RALLY_BEGIN',
        state: 'RALLY_BEGIN',
        detectedAt: String(refTime),
        price: refPrice ?? startEv.price,
        movePercent: 0,
        shouldNotify: false,
        reason: 'Reference bar · move measured from here',
      },
      label: 'Rally begin',
      isStateOnly: true,
    })
  }

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
      // Hide stuck "Perplexity running" once a done/error row exists.
      if (isResearchRunning) {
        const eid = ev.episodeId ? String(ev.episodeId) : ''
        if (eid && researchDoneEpisodeIds.has(eid)) continue
        if (!eid && anyResearchDone) continue
      }
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
        // Never render extractEventResearch payload as "running" when event is DONE
        const statusNorm =
          isResearchRunning &&
          String(research.status || '').toLowerCase() !== 'done' &&
          String(research.status || '').toLowerCase() !== 'error'
            ? 'running'
            : research.status || (isResearchRunning ? 'running' : 'done')
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
            status: statusNorm,
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

    // Full lifecycle on the rail: Started / Holding / Weakening / Ended + prices.
    const isStateOnly =
      type === 'MOMENTUM_STATE' ||
      type === 'MOMENTUM_STATE_CHANGED' ||
      type.endsWith('_STATE')
    const isStart = isStartEventType(type)

    // Skip redundant MOMENTUM_STATE when a typed row (ACCELERATING / …) already
    // covers the same timestamp + state — keep Holding / Weakening state rows.
    if (isStateOnly) {
      const st = String(ev.state || '').toUpperCase()
      const sameBeat = (events || []).some((other, j) => {
        if (j === i || !other) return false
        const ot = String(other.eventType || '')
        if (
          ot === 'MOMENTUM_STATE' ||
          ot === 'MOMENTUM_STATE_CHANGED' ||
          ot.endsWith('_STATE')
        ) {
          return false
        }
        if (other.detectedAt !== ev.detectedAt) return false
        const ost = String(other.state || '').toUpperCase()
        if (st && ost && st === ost) return true
        if (st.includes('ACCELERAT') && ot.includes('ACCELERAT')) return true
        if (st === 'STARTED' && isStartEventType(ot)) return true
        if (
          (st === 'ENDED' || st === 'EXPIRED' || st === 'REVERSED') &&
          (ot === 'MOMENTUM_ENDED' || ot.endsWith('_ENDED') || ot === 'MOMENTUM_REVERSED')
        ) {
          return true
        }
        return false
      })
      if (sameBeat) {
        // Still attach alert if this state row alone carried shouldNotify.
        if (ev.shouldNotify) {
          steps.push({
            id: `alert-from-${ev.notifiedAt || ev.detectedAt}-${i}`,
            kind: 'alert',
            ev,
            at: ev.notifiedAt || ev.pushResult?.at || ev.detectedAt,
            notification: ev.notification || null,
          })
        }
        continue
      }
    }

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

  // Oldest → newest (how the move built). Same-timestamp: backend → research → alert.
  steps.sort((a, b) => {
    const ta = timelineStepTimeMs(a)
    const tb = timelineStepTimeMs(b)
    if (ta !== tb) return ta - tb
    return (
      timelineStepPipelineRank(a.kind) - timelineStepPipelineRank(b.kind)
    )
  })
  return steps
}

/** One human line per timeline step for the full story list. */
function timelineStepStoryLine(step: TimelineStep): string {
  if (step.kind === 'perplexity') {
    const st = String(step.research.status || '').toLowerCase()
    if (st === 'running') return 'Perplexity research running…'
    if (st === 'error') return 'Perplexity research failed'
    const driver =
      step.research.likely_driver ||
      String(step.research.reason || '').split('\n')[0] ||
      ''
    const short =
      driver.length > 120 ? `${driver.slice(0, 117)}…` : driver
    return short
      ? `Perplexity done · ${short}`
      : 'Perplexity research done'
  }
  if (step.kind === 'alert') {
    const title = String(step.notification?.title || '').trim()
    return title ? `Alert sent · ${title}` : 'Alert sent'
  }
  const { ev, label } = step
  const move =
    Number.isFinite(ev.movePercent) ? ` ${fmtPct(ev.movePercent)}` : ''
  const win = ev.detectedWindow ? ` · ${ev.detectedWindow}` : ''
  return `${label}${move}${win}`
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
  /** Full step-by-step lines (oldest → newest) — never skip middle states */
  buildSteps: Array<{ at: string; line: string }>
  isActive: boolean
}

function buildEpisodeExplainSections(
  group: EpisodeEventGroup,
  opts?: { accelPoints?: number | null; inactivityMinutes?: number | null },
): EpisodeExplainSections {
  const chronological = [...group.events].sort(
    (a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt),
  )
  const storySteps = buildTimelineSteps(group.events).map((step) => {
    const at =
      step.kind === 'backend' ? step.ev.detectedAt : step.at
    return {
      at: String(at || ''),
      line: timelineStepStoryLine(step),
    }
  })
  const isActive = group.status === 'ACTIVE'
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
      : 180
  const peak = group.peakMovePercent
  const nextAccelTarget = Number.isFinite(peak)
    ? peak + (group.direction === 'UP' ? accel : -accel)
    : null

  const start = startPct
    ? `The stock began an ${group.direction} episode after it moved ${dirWord} by ${startPct} on the ${startWin} rolling window (enough to cross the alert threshold).`
    : `The stock began an ${group.direction} episode on the ${startWin} rolling window after a threshold cross.`

  // Intermediate state changes (Holding / Weakening / …) — full chain, not skipped
  const stateRows = chronological.filter((e) => {
    const t = String(e.eventType || '')
    return (
      t === 'MOMENTUM_STATE' ||
      t === 'MOMENTUM_STATE_CHANGED' ||
      t.endsWith('_STATE')
    )
  })
  const stateChain = stateRows
    .map((e) => formatEpisodeState(e.state || e.reason) || 'State')
    .filter(Boolean)

  let during: string | null = null
  const midBits: string[] = []
  if (accelEvents.length > 0) {
    midBits.push(
      `accelerated ${accelEvents.length} time${accelEvents.length === 1 ? '' : 's'}`,
    )
  }
  if (stateChain.length > 0) {
    midBits.push(`states: ${stateChain.join(' → ')}`)
  }
  if (midBits.length > 0) {
    during = `While open — ${midBits.join('; ')}. Peak so far: ${fmtPct(group.peakMovePercent)}.`
  } else if (isActive) {
    during =
      'No acceleration alert yet — the move has not stepped far enough beyond the last alert level.'
  }

  let end: string
  if (isActive) {
    const liveLabel =
      formatEpisodeState(group.liveState) ||
      (stateChain.length ? stateChain[stateChain.length - 1] : null) ||
      'Active'
    end = `Status: ACTIVE · ${liveLabel}. The episode is still open (not cooled off or reversed).`
  } else if (endEv) {
    const endDir = endEv.direction === 'UP' ? 'up' : 'down'
    const endPct = Number.isFinite(endEv.movePercent)
      ? fmtPct(endEv.movePercent)
      : '—'
    end = `Status: ENDED. It closed when the move cooled or flipped (${endDir} ${endPct} on ${endEv.detectedWindow || '—'} at ${fmtEpisodeWhen(endEv.detectedAt, endEv.marketSession || group.marketSession)}).`
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
      numbers = `Around ${fmtEpisodeWhen(startEv?.detectedAt || group.startedAt, startEv?.marketSession || group.marketSession)}: price ~$${lookback.toFixed(2)} (${startWin} earlier) → ~$${price.toFixed(2)} (then). That ${fmtPct(move)} move on ${startWin} is what opened this ${group.direction} episode.`
    }
  }
  if (!numbers) {
    numbers = `If ${startWin} return is large enough while price is moving ${dirWord}, the engine starts an ${group.direction} episode and keeps tracking it.`
  }

  const lookingFor: { title: string; body: string }[] = isActive
    ? [
        {
          title: '1 · Acceleration',
          body: nextAccelTarget != null
            ? `Peak needs to move about +${accel} percentage points further ${dirWord} (past ~${fmtPct(nextAccelTarget)}) to fire another accelerate alert.`
            : `Peak needs about +${accel} percentage points further ${dirWord} vs the last alert to fire accelerate.`,
        },
        {
          title: '2 · Session end',
          body:
            'During regular cash hours the episode stays open until the market closes (silent archive). Outside regular hours (or for 24/7 assets), ~' +
            `${inactivity} minutes without a new extreme can quiet-expire it.`,
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

  const statusNote = isActive
    ? `Status ACTIVE — still in this ${group.direction} move (window ${group.window}, peak ${fmtPct(group.peakMovePercent)}).`
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
    buildSteps: storySteps,
    isActive,
  }
}

type TimelineDetailState =
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

/** Inline body for timeline popup content (alert / Perplexity / measure). */
function TimelineDetailInlineBody({
  detail,
  assetClass,
  currency,
  liveEpisode,
}: {
  detail: TimelineDetailState
  assetClass?: string | null
  currency?: string | null
  liveEpisode?: Episode | null
}) {
  if (detail.kind === 'event') {
    const explain = buildEventMeasureExplain(detail.ev, {
      assetClass,
      currency,
      liveEpisode,
    })
    return (
      <div className="space-y-2">
        <p className="text-[13px] font-semibold text-foreground">{explain.title}</p>
        <p className="text-[12px] leading-relaxed text-foreground/90">
          {explain.summary}
        </p>
        {explain.formula ? (
          <div className="rounded-lg border border-border bg-muted/30 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Formula
            </p>
            <p className="mt-1 font-mono text-[12px] leading-snug text-foreground">
              {explain.formula}
            </p>
          </div>
        ) : null}
        <div className="rounded-lg border border-border bg-background px-2.5 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Numbers
          </p>
          <dl className="space-y-1">
            {explain.rows.map((row) => (
              <div
                key={row.label}
                className="flex min-w-0 items-start justify-between gap-2 text-[11px]"
              >
                <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
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
      </div>
    )
  }

  if (detail.kind === 'alert') {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Title
          </p>
          <p className="mt-0.5 text-[13px] font-semibold leading-snug text-foreground">
            {detail.notification?.title || '—'}
          </p>
          <p className="mt-2 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Body
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/90">
            {detail.notification?.body || '—'}
          </p>
        </div>
        {detail.ev.pushResult ? (
          <div className="rounded-lg border border-border bg-background px-2.5 py-2 text-[10px] text-muted-foreground">
            <p className="font-semibold text-foreground">Delivery</p>
            <p className="mt-0.5 tabular-nums">
              {detail.ev.pushResult.skipped
                ? `Skipped · ${detail.ev.pushResult.reason || 'n/a'}`
                : `ok ${detail.ev.pushResult.sent_ok ?? '—'} / ${detail.ev.pushResult.recipient_count ?? '—'} devices`}
              {detail.ev.pushResult.sent_failed
                ? ` · failed ${detail.ev.pushResult.sent_failed}`
                : ''}
              {detail.ev.pushResult.source
                ? ` · ${detail.ev.pushResult.source}`
                : ''}
            </p>
          </div>
        ) : null}
      </div>
    )
  }

  // perplexity
  return (
    <div className="space-y-2">
      {detail.research.likely_driver ? (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-300">
            Likely driver
          </p>
          <p className="mt-0.5 text-[12px] font-medium leading-snug text-foreground">
            {detail.research.likely_driver}
          </p>
        </div>
      ) : null}
      {detail.research.reason ? (
        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Reason
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90">
            {detail.research.reason}
          </p>
        </div>
      ) : null}
      {detail.research.secondary_driver ? (
        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Secondary driver
          </p>
          <p className="mt-0.5 text-[12px] font-medium leading-snug text-foreground">
            {detail.research.secondary_driver}
          </p>
        </div>
      ) : null}
      {detail.research.move_classification ? (
        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Move classification
          </p>
          <p className="mt-0.5 text-[12px] font-medium leading-snug text-foreground">
            {detail.research.move_classification}
          </p>
        </div>
      ) : null}
      {detail.research.confidence ? (
        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Confidence
          </p>
          <p className="mt-0.5 text-[12px] font-medium leading-snug text-foreground">
            {detail.research.confidence}
          </p>
        </div>
      ) : null}
      {detail.research.alert?.title || detail.research.alert?.body ? (
        <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-300">
            Alert
          </p>
          {detail.research.alert?.title ? (
            <p className="mt-0.5 text-[12px] font-semibold leading-snug text-foreground">
              {detail.research.alert.title}
            </p>
          ) : null}
          {detail.research.alert?.body ? (
            <p className="mt-1 text-[11px] leading-relaxed text-foreground/90">
              {detail.research.alert.body}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        {detail.research.model_version || detail.research.model ? (
          <span className="font-mono text-[9px]">
            {detail.research.model_version || detail.research.model}
          </span>
        ) : null}
        {detail.research.cost_usd_display ? (
          <span>{detail.research.cost_usd_display}</span>
        ) : null}
      </div>
      {detail.research.citations?.length ? (
        <div className="rounded-lg border border-border px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sources
          </p>
          <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-[10px]">
            {(detail.research.citations || []).slice(0, 8).map((url, i) => (
              <li key={i} className="truncate">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!detail.research.likely_driver &&
      !detail.research.reason &&
      !detail.research.alert?.body ? (
        <p className="text-[11px] text-muted-foreground">
          No Perplexity reason stored on this event yet.
        </p>
      ) : null}
    </div>
  )
}

/** Dialog body that fetches the full research row only when opened. */
function PerplexityDialogPanel({
  ev,
  research,
  at,
}: {
  ev: MomentumEvent
  research: EventResearch
  at?: string
}) {
  const { full, loading } = useOnDemandResearch(ev, true)
  const merged = mergeEventResearch(research, full)
  return (
    <>
      <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
        <DialogTitle className="flex items-center gap-2 text-base">
          <PerplexityLogo className="size-4" />
          Perplexity reason
        </DialogTitle>
        <DialogDescription className="text-[12px] text-muted-foreground">
          Exact research output used for this step
          {at ? ` · ${fmtDateTime(at) || fmtTime(at)}` : ''}
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {loading ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Updating from Supabase…
          </p>
        ) : null}
        {merged.likely_driver ? (
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-300">
              Likely driver
            </p>
            <p className="mt-1 text-[13px] font-medium leading-snug text-foreground">
              {merged.likely_driver}
            </p>
          </div>
        ) : null}
        {merged.reason ? (
          <div className="rounded-xl border border-border bg-muted/30 p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Reason
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
              {merged.reason}
            </p>
          </div>
        ) : null}
        {merged.secondary_driver ? (
          <div className="rounded-xl border border-border bg-muted/30 p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Secondary driver
            </p>
            <p className="mt-1 text-[13px] font-medium leading-snug text-foreground">
              {merged.secondary_driver}
            </p>
          </div>
        ) : null}
        {merged.move_classification ? (
          <div className="rounded-xl border border-border bg-muted/30 p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Move classification
            </p>
            <p className="mt-1 text-[13px] font-medium leading-snug text-foreground">
              {merged.move_classification}
            </p>
          </div>
        ) : null}
        {merged.confidence ? (
          <div className="rounded-xl border border-border bg-muted/30 p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Confidence
            </p>
            <p className="mt-1 text-[13px] font-medium leading-snug text-foreground">
              {merged.confidence}
            </p>
          </div>
        ) : null}
        {merged.alert?.title || merged.alert?.body ? (
          <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-300">
              Alert
            </p>
            {merged.alert?.title ? (
              <p className="mt-1 text-[15px] font-semibold leading-snug text-foreground">
                {merged.alert.title}
              </p>
            ) : null}
            {merged.alert?.body ? (
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                {merged.alert.body}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {merged.model_version || merged.model ? (
            <span className="font-mono text-[10px]">
              {merged.model_version || merged.model}
            </span>
          ) : null}
          {merged.cost_usd_display ? (
            <span>{merged.cost_usd_display}</span>
          ) : null}
        </div>
        {merged.citations?.length ? (
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Sources
            </p>
            <ul className="mt-1 max-h-28 space-y-1 overflow-y-auto text-[11px]">
              {(merged.citations || []).slice(0, 8).map((url, i) => (
                <li key={i} className="truncate">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!loading &&
        !merged.likely_driver &&
        !merged.reason &&
        !merged.alert?.body ? (
          <p className="text-[12px] text-muted-foreground">
            No Perplexity reason found on this event
            {ev.researchId || ev.episodeId
              ? ' (and no matching row in Supabase research).'
              : '.'}
          </p>
        ) : null}
      </div>
    </>
  )
}

/** Status pill tones for the numbered episode timeline (screenshot-style). */
function timelineStepPillClass(kind: 'backend' | 'perplexity' | 'alert', label: string): string {
  const l = label.toLowerCase()
  if (kind === 'alert') {
    return 'bg-sky-500/15 text-sky-800 dark:text-sky-200'
  }
  if (kind === 'perplexity') {
    if (l.includes('fail') || l.includes('error')) {
      return 'bg-rose-500/15 text-rose-800 dark:text-rose-200'
    }
    if (l.includes('run')) {
      return 'bg-violet-500/20 text-violet-900 dark:text-violet-200'
    }
    return 'bg-violet-500/15 text-violet-800 dark:text-violet-200'
  }
  if (l.includes('rally') || l.includes('begin')) {
    return 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
  }
  if (l.includes('start')) {
    return 'bg-sky-500/15 text-sky-800 dark:text-sky-200'
  }
  if (l.includes('hold')) {
    return 'bg-muted text-muted-foreground'
  }
  if (l.includes('strong') && l.includes('weak')) {
    return 'bg-amber-500/20 text-amber-900 dark:text-amber-200'
  }
  if (l.includes('weak')) {
    return 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
  }
  if (l.includes('accelerat') || l.includes('re-accelerat')) {
    return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
  }
  if (l.includes('end') || l.includes('revers') || l.includes('expir')) {
    return 'bg-rose-500/15 text-rose-800 dark:text-rose-200'
  }
  return 'bg-muted text-muted-foreground'
}


/** Compact clock for timeline rail markers — e.g. "8:57 AM EDT". */
function fmtTimelineRailClock(iso: string | null | undefined): string {
  if (!iso) return '—'
  return (
    formatExchangeTime(iso, momentumDisplayTimeZone, {
      hour12: true,
      withZone: true,
    }) || '—'
  )
}

/** Split "8:57 AM EDT" for stacked rail badges without dropping the zone. */
function splitTimelineRailClock(iso: string | null | undefined): {
  clock: string
  meridiem: string
} {
  const full = fmtTimelineRailClock(iso)
  const m = full.match(/^(\d{1,2}:\d{2})\s*(AM|PM)(?:\s+(.+))?$/i)
  if (m) {
    return {
      clock: m[1],
      meridiem: [m[2].toUpperCase(), m[3]].filter(Boolean).join(' '),
    }
  }
  return { clock: full, meridiem: '' }
}

/** One timeline step: 2-row header + right chevron toggles formula/numbers card. */
function EpisodeTimelineStepRow({
  step,
  isLast,
  group,
  assetClass,
  currency,
  liveEpisode,
  matchesLive,
}: {
  step: TimelineStep
  isLast: boolean
  group: EpisodeEventGroup
  assetClass?: string | null
  currency?: string | null
  liveEpisode?: Episode | null
  matchesLive?: boolean
}) {
  const [open, setOpen] = useState(false)
  const perplexityEv = step.kind === 'perplexity' ? step.ev : undefined
  const perplexityRunning =
    step.kind === 'perplexity' &&
    String(step.research.status || '').toLowerCase() === 'running'
  const { full: onDemandResearch, loading: onDemandLoading } =
    useOnDemandResearch(
      perplexityEv,
      Boolean(open && perplexityEv && !perplexityRunning),
    )
  const stepAt = step.kind === 'backend' ? step.ev.detectedAt : step.at
  const railClock = fmtTimelineRailClock(stepAt)
  const railParts = splitTimelineRailClock(stepAt)

  let title: ReactNode = null
  let pill: ReactNode = null
  let whenLine: ReactNode = null
  let detail: ReactNode = null
  let canExpand = true

  if (step.kind === 'backend') {
    const { ev, label } = step
    const moveLabel =
      !step.isStateOnly || Number.isFinite(ev.movePercent)
        ? `${ev.direction} ${fmtPct(ev.movePercent)}`
        : null
    title = (
      <>
        <span className="text-[15px] font-semibold leading-tight text-foreground">
          {label}
        </span>
        {moveLabel ? (
          <span
            className={cn(
              'text-[13px] font-semibold tabular-nums',
              ev.direction === 'UP' ? 'text-emerald-600' : 'text-rose-600',
            )}
          >
            {moveLabel}
          </span>
        ) : null}
      </>
    )
    // Only Research + Push pills — no duplicate Started / Holding / Accel tags.
    pill = null
    whenLine = timelineStepWhenLine(
      ev.detectedAt,
      ev,
      group.marketSession,
      assetClass,
      currency,
    )
    detail = (
      <div className="mt-2.5 rounded-xl border border-border/70 bg-muted/20 px-2.5 py-2">
        <TimelineDetailInlineBody
          detail={{ kind: 'event', at: ev.detectedAt, ev }}
          assetClass={assetClass}
          currency={currency}
          liveEpisode={matchesLive ? liveEpisode : null}
        />
      </div>
    )
  } else if (step.kind === 'perplexity') {
    const running =
      String(step.research.status || '').toLowerCase() === 'running'
    const failed =
      String(step.research.status || '').toLowerCase() === 'error' ||
      Boolean(step.research.error)
    const label = running
      ? 'Perplexity running'
      : failed
        ? 'Perplexity failed'
        : 'Perplexity done'
    title = (
      <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold leading-tight text-foreground">
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-violet-700 dark:text-violet-300" />
        ) : (
          <PerplexityLogo className="size-3.5 shrink-0" />
        )}
        {label}
      </span>
    )
    pill = (
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize',
          timelineStepPillClass('perplexity', label),
        )}
      >
        {running ? 'live' : failed ? 'error' : 'research'}
      </span>
    )
    whenLine = timelineStepWhenLine(
      step.at,
      step.ev,
      group.marketSession,
      assetClass,
      currency,
    )
    if (running) {
      canExpand = false
      detail = (
        <p className="mt-2 text-[12px] text-violet-800/80 dark:text-violet-300/80">
          Researching likely driver…
        </p>
      )
    } else {
      const research = mergeEventResearch(step.research, onDemandResearch)
      detail = (
        <div className="mt-2.5 rounded-xl border border-violet-500/25 bg-violet-500/5 px-2.5 py-2">
          {onDemandLoading ? (
            <p className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Updating from Supabase…
            </p>
          ) : null}
          <TimelineDetailInlineBody
            detail={{
              kind: 'perplexity',
              at: step.at,
              research,
              ev: step.ev,
            }}
          />
        </div>
      )
    }
  } else {
    const titleText = step.notification?.title || 'Push notification'
    title = (
      <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold leading-tight text-foreground">
        <BellRing className="size-3.5 shrink-0 text-sky-600" />
        Alert sent
      </span>
    )
    pill = (
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
          timelineStepPillClass('alert', 'Alert sent'),
        )}
      >
        push
      </span>
    )
    whenLine = timelineStepWhenLine(
      step.at,
      step.ev,
      group.marketSession,
      assetClass,
      currency,
      titleText || null,
    )
    detail = (
      <div className="mt-2.5 rounded-xl border border-sky-500/25 bg-sky-500/5 px-2.5 py-2">
        <TimelineDetailInlineBody
          detail={{
            kind: 'alert',
            at: step.at,
            notification: step.notification,
            ev: step.ev,
          }}
        />
      </div>
    )
  }

  const showDetail = canExpand ? open : true

  return (
    <li className="flex gap-3">
      {/* Time + dot + connector — stacked clock so “2:19 / PM EDT” fits cleanly */}
      <div className="relative flex w-[3.25rem] shrink-0 flex-col items-center self-stretch">
        <div
          className="z-10 flex w-full flex-col items-center px-0.5 text-center"
          title={railClock}
          aria-label={railClock}
        >
          <span className="text-[12px] font-bold leading-none tabular-nums text-foreground">
            {railParts.clock}
          </span>
          {railParts.meridiem ? (
            <span className="mt-0.5 text-[9px] font-semibold leading-tight tracking-wide text-muted-foreground">
              {railParts.meridiem}
            </span>
          ) : null}
        </div>
        <span
          className="relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full bg-foreground ring-[3px] ring-card"
          aria-hidden
        />
        {!isLast ? (
          <span className="w-px flex-1 bg-border" aria-hidden />
        ) : null}
      </div>
      <div className={cn('min-w-0 flex-1 pt-0.5', !isLast && 'pb-6')}>
        <div className="flex min-w-0 items-stretch gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {title}
              {pill}
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">{whenLine}</p>
          </div>
          {canExpand ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex shrink-0 items-center self-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={open ? 'Hide formula & numbers' : 'Show formula & numbers'}
              aria-expanded={open}
              aria-label={
                open ? 'Collapse step details' : 'Expand step details'
              }
            >
              {open ? (
                <ChevronUp className="size-4" strokeWidth={2} />
              ) : (
                <ChevronDown className="size-4" strokeWidth={2} />
              )}
            </button>
          ) : null}
        </div>
        {showDetail ? detail : null}
      </div>
    </li>
  )
}

// Keep helpers referenced so noUnusedLocals stays clean (detail tooltips / explain).
void EventMoveCalcBody
void buildEpisodeExplainSections

/** Price from → to, window, peak, giveback under “How this move built”. */
function EpisodeMoveSummaryStrip({
  group,
  liveEpisode,
  matchesLive,
  assetClass,
  currency,
}: {
  group: EpisodeEventGroup
  liveEpisode?: Episode | null
  matchesLive?: boolean
  assetClass?: string | null
  currency?: string | null
}) {
  const startEv =
    group.events.find(
      (e) =>
        e.eventType === 'MOMENTUM_STARTED' ||
        String(e.eventType || '').endsWith('_STARTED'),
    ) || group.events[0]
  const endEv = [...group.events]
    .reverse()
    .find(
      (e) =>
        e.eventType === 'MOMENTUM_ENDED' ||
        e.eventType === 'MOMENTUM_REVERSED' ||
        String(e.eventType || '').endsWith('_ENDED'),
    )
  const ep = matchesLive ? liveEpisode : null
  const fromPrice =
    ep?.referencePrice ??
    startEv?.referencePrice ??
    startEv?.price ??
    null
  const toPrice =
    ep?.currentPrice ??
    endEv?.price ??
    [...group.events].reverse().find((e) => e.price != null)?.price ??
    null
  const windowLabel = group.window || startEv?.detectedWindow || '—'
  const peakMove =
    ep?.peakMovePercent ??
    (Number.isFinite(group.peakMovePercent) ? group.peakMovePercent : null)
  const givebackPct = matchesLive && ep
    ? computeEpisodeGivebackPercent(ep)
    : lastGivebackFromEvents(group.events)
  const givebackLabel = fmtGivebackPct(givebackPct)
  const fmtP = (n: number | null | undefined) =>
    n != null && Number.isFinite(Number(n))
      ? fmtPrice(Number(n), assetClass, currency)
      : '—'

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
      <span className="tabular-nums text-foreground">
        <span className="text-muted-foreground">Price </span>
        <span className="font-semibold">{fmtP(fromPrice)}</span>
        <span className="mx-1 text-muted-foreground">→</span>
        <span className="font-semibold">{fmtP(toPrice)}</span>
      </span>
      <span className="text-muted-foreground/50" aria-hidden>
        ·
      </span>
      <span>
        <span className="text-muted-foreground">Window </span>
        <span className="font-semibold text-foreground">{windowLabel}</span>
      </span>
      <span className="text-muted-foreground/50" aria-hidden>
        ·
      </span>
      <span className="tabular-nums">
        <span className="text-muted-foreground">Peak </span>
        <span
          className={cn('font-semibold', pctColor(peakMove))}
        >
          {peakMove != null && Number.isFinite(Number(peakMove))
            ? fmtPct(Number(peakMove))
            : '—'}
        </span>
      </span>
      <span className="text-muted-foreground/50" aria-hidden>
        ·
      </span>
      <span className="tabular-nums">
        <span className="text-muted-foreground">Giveback </span>
        <span className="font-semibold text-foreground">
          {givebackLabel || '—'}
        </span>
      </span>
    </div>
  )
}

/**
 * Time-stamped vertical timeline (rail shows clock). No A→Z header —
 * parent “How this move built” heading owns the title.
 */
function EpisodeAzTimelineInline({
  group,
  assetClass,
  currency,
  liveEpisode,
  matchesLive,
}: {
  group: EpisodeEventGroup
  assetClass?: string | null
  currency?: string | null
  liveEpisode?: Episode | null
  matchesLive?: boolean
}) {
  const storySteps = buildTimelineSteps(group.events)
  if (!storySteps.length) {
    return (
      <p className="px-1 py-2 text-[11px] text-muted-foreground">
        No timeline steps yet for this episode.
      </p>
    )
  }

  return (
    <ol className="m-0 list-none space-y-0 p-0">
      {storySteps.map((step, index) => (
        <EpisodeTimelineStepRow
          key={step.id}
          step={step}
          isLast={index === storySteps.length - 1}
          group={group}
          assetClass={assetClass}
          currency={currency}
          liveEpisode={liveEpisode}
          matchesLive={matchesLive}
        />
      ))}
    </ol>
  )
}

/** Main “How this move built” block: heading + summary + step timeline. */
function EpisodeHowBuiltBlock({
  group,
  assetClass,
  currency,
  liveEpisode,
  matchesLive,
  defaultOpen = true,
}: {
  group: EpisodeEventGroup
  assetClass?: string | null
  currency?: string | null
  liveEpisode?: Episode | null
  matchesLive?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const storySteps = buildTimelineSteps(group.events)
  const isActive = group.status === 'ACTIVE'
  const stepCount = storySteps.length
  const tickerFromId = String(group.episodeId || '').split('-')[0] || ''
  const supabaseTicker =
    String(liveEpisode?.ticker || tickerFromId || '')
      .trim()
      .toUpperCase() || null
  const supabaseUrl = supabaseEpisodeRecordUrl(group.episodeId, {
    ticker: supabaseTicker,
    assetClass:
      assetClass ||
      (supabaseTicker ? detectAssetClass(supabaseTicker) : null),
  })

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-0.5 py-0.5 text-left transition-colors hover:bg-muted/40"
          aria-expanded={open}
        >
          {open ? (
            <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          )}
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            How this move built
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              isActive
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {isActive ? 'Active' : 'Ended'}
            {stepCount > 0 ? ` · ${stepCount} steps` : ''}
          </span>
        </button>
        {supabaseUrl ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
            title="Open Supabase SQL: episode + events + research"
            aria-label="Open episode bundle in Supabase SQL editor"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              void openEpisodeInSupabaseDashboard({
                episodeId: group.episodeId,
                ticker: supabaseTicker,
                assetClass:
                  assetClass ||
                  (supabaseTicker ? detectAssetClass(supabaseTicker) : null),
              })
            }}
          >
            Supabase
            <ArrowUpRight className="size-3.5" strokeWidth={2} />
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-3">
          <EpisodeMoveSummaryStrip
            group={group}
            liveEpisode={liveEpisode}
            matchesLive={matchesLive}
            assetClass={assetClass}
            currency={currency}
          />
          <EpisodeAzTimelineInline
            group={group}
            assetClass={assetClass}
            currency={currency}
            liveEpisode={liveEpisode}
            matchesLive={matchesLive}
          />
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
  crossedClosure?: boolean
  closureDurationSec?: number
  sessionBoundaryType?: string | null
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
  /** Past + active episodes from Supabase hydrate (rail source of truth). */
  episodes?: Episode[] | null
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
    /** First 1m print at/after pre 4:00 AM / AH 4:00 PM / overnight 8:00 PM ET */
    sessionOpen?: {
      price?: number | null
      time?: string | null
      openMs?: number | null
      label?: string | null
      shortLabel?: string | null
      session?: string | null
      lagMinutes?: number | null
    } | null
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
    episodePolicy?: {
      accelerationAlertDeltaPp?: number
      materialProgressDeltaPp?: number
      holdingToWeakeningGiveback?: number
      weakeningToHoldingGiveback?: number
      strongWeakeningGiveback?: number
      episodeInactivityExpiryMin?: number
      rearmBufferPp?: number
      majorFadeAlertEnabled?: boolean
      startPushMaxAgeMs?: number
      startedStateMinDwellMs?: number
      byClass?: Record<
        string,
        Record<string, number | boolean | null | undefined>
      >
    }
    notificationRecipients?: {
      mode?: string
      description?: string
      alwaysNotify?: {
        id?: string
        label?: string
        device_id?: string
        expo_push_token?: string
      }
    }
  }
}

/** UI rolling cards — short windows (incl. 10m / 45m) + multi-horizon + day. */
const RETURN_KEYS_ALL = [
  'day',
  '1m',
  '5m',
  '10m',
  '15m',
  '30m',
  '45m',
  '60m',
  '90m',
  '2h',
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
  '2h',
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

const THRESHOLD_PREF_KEY = 'momentum-thresholds-v1'
const THRESHOLD_PREF_BY_CLASS_KEY = 'momentum-thresholds-by-class-v1'

function thresholdClassKey(assetClass?: string | null): string {
  const c = String(assetClass || 'equity').toLowerCase()
  if (c === 'indexes' || c === 'indices') return 'index'
  if (c === 'stock' || c === 'stocks') return 'equity'
  // ETFs share equity episode / threshold bands
  if (c === 'etf' || c === 'etfs' || c === 'fund') return 'equity'
  return c || 'equity'
}

function loadLocalThresholdDraft(
  assetClass?: string | null,
): Record<string, string> {
  try {
    const cls = thresholdClassKey(assetClass)
    // Prefer per-class store
    const byClassRaw = localStorage.getItem(THRESHOLD_PREF_BY_CLASS_KEY)
    if (byClassRaw) {
      const byClass = JSON.parse(byClassRaw) as Record<string, Record<string, unknown>>
      const parsed = byClass?.[cls]
      if (parsed && typeof parsed === 'object') {
        const draft: Record<string, string> = {}
        for (const k of THRESHOLD_EDIT_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(parsed, k)) continue
          if (parsed[k] === null || parsed[k] === '') {
            draft[k] = ''
            continue
          }
          const n = Number(parsed[k])
          if (Number.isFinite(n) && n > 0) draft[k] = String(n)
          else if (Number.isFinite(n) && n <= 0) draft[k] = ''
        }
        return draft
      }
    }
    // Legacy flat key → treat as equity
    if (cls !== 'equity') return {}
    const raw = localStorage.getItem(THRESHOLD_PREF_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    const draft: Record<string, string> = {}
    for (const k of THRESHOLD_EDIT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(parsed, k)) continue
      if (parsed[k] === null || parsed[k] === '') {
        draft[k] = ''
        continue
      }
      const n = Number(parsed[k])
      if (Number.isFinite(n) && n > 0) draft[k] = String(n)
      else if (Number.isFinite(n) && n <= 0) draft[k] = ''
    }
    return draft
  } catch {
    return {}
  }
}

/** Parse draft inputs: empty / 0 → null (off — not used for episodes), else >0. */
function thresholdsFromDraft(
  draft: Record<string, string>,
): Record<string, number | null> {
  const thresholds: Record<string, number | null> = {}
  for (const k of THRESHOLD_EDIT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(draft, k)) continue
    const trimmed = String(draft[k] ?? '').trim()
    if (trimmed === '') {
      // Day blank → leave server value; other blanks clear the band
      if (k === 'day') continue
      thresholds[k] = null
      continue
    }
    const n = Number(trimmed)
    // 0 means “not set” — never treat as always-on (|move| ≥ 0)
    if (Number.isFinite(n) && n > 0) thresholds[k] = n
    else if (Number.isFinite(n) && n <= 0) thresholds[k] = k === 'day' ? 0 : null
  }
  return thresholds
}

function saveLocalThresholdDraft(
  draft: Record<string, string>,
  assetClass?: string | null,
) {
  try {
    const cls = thresholdClassKey(assetClass)
    const out = thresholdsFromDraft(draft)
    let byClass: Record<string, Record<string, number | null>> = {}
    try {
      const raw = localStorage.getItem(THRESHOLD_PREF_BY_CLASS_KEY)
      if (raw) byClass = JSON.parse(raw) as typeof byClass
    } catch {
      byClass = {}
    }
    byClass[cls] = out
    localStorage.setItem(THRESHOLD_PREF_BY_CLASS_KEY, JSON.stringify(byClass))
    // Keep legacy flat key as equity mirror
    if (cls === 'equity') {
      localStorage.setItem(THRESHOLD_PREF_KEY, JSON.stringify(out))
    }
  } catch {
    /* ignore */
  }
}

const LOG_COLLAPSE_KEY = 'sndk-momentum-log-collapsed'
const RIGHT_RAIL_WIDTH_KEY = 'momentum-right-rail-width-v2'
/** Floor so the rail stays usable while dragging. */
const RIGHT_RAIL_MIN_WIDTH = 200
const NAV_COL_WIDTH_KEY = 'momentum-nav-col-width-v1'
const LIST_COL_WIDTH_KEY = 'momentum-list-col-width-v1'
const NAV_COL_MIN_WIDTH = 56
const NAV_COL_MAX_WIDTH = 120
const NAV_COL_DEFAULT_WIDTH = 64
const LIST_COL_MIN_WIDTH = 180
const LIST_COL_MAX_WIDTH = 480
const LIST_COL_DEFAULT_WIDTH = 256
/**
 * Keep the email-style middle list comfortably wide while resizing detail.
 */
function rightRailMaxWidth(): number {
  if (typeof window === 'undefined') return 1200
  return Math.max(RIGHT_RAIL_MIN_WIDTH, window.innerWidth - 620)
}

function loadRightRailWidth(): number {
  try {
    const n = Number(localStorage.getItem(RIGHT_RAIL_WIDTH_KEY))
    if (Number.isFinite(n) && n >= RIGHT_RAIL_MIN_WIDTH) {
      return Math.round(Math.min(n, rightRailMaxWidth()))
    }
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

function loadNavColWidth(): number {
  try {
    const n = Number(localStorage.getItem(NAV_COL_WIDTH_KEY))
    if (Number.isFinite(n) && n >= NAV_COL_MIN_WIDTH) {
      return Math.round(Math.min(n, NAV_COL_MAX_WIDTH))
    }
  } catch {
    /* ignore */
  }
  return NAV_COL_DEFAULT_WIDTH
}

function saveNavColWidth(px: number) {
  try {
    localStorage.setItem(NAV_COL_WIDTH_KEY, String(Math.round(px)))
  } catch {
    /* ignore */
  }
}

function loadListColWidth(): number {
  try {
    const n = Number(localStorage.getItem(LIST_COL_WIDTH_KEY))
    if (Number.isFinite(n) && n >= LIST_COL_MIN_WIDTH) {
      return Math.round(Math.min(n, LIST_COL_MAX_WIDTH))
    }
  } catch {
    /* ignore */
  }
  return LIST_COL_DEFAULT_WIDTH
}

function saveListColWidth(px: number) {
  try {
    localStorage.setItem(LIST_COL_WIDTH_KEY, String(Math.round(px)))
  } catch {
    /* ignore */
  }
}

/** Bump when Supabase episode/research rows change so stale browser caches are ignored. */
const ALL_EPISODES_CACHE_KEY = 'sndk-momentum-all-episodes-v4'
const TICKER_STATUS_CACHE_PREFIX = 'sndk-momentum-status-v3:'
const TICKER_STATUS_CACHE_INDEX_KEY = 'sndk-momentum-status-index-v3'
const ALL_EPISODES_PAGE_SIZE = 40
const TICKER_STATUS_CACHE_MAX = 24

type EpisodeListCachePayload = {
  episodes: ActiveEpisodeRow[]
  activeEpisodes: ActiveEpisodeRow[]
  total: number
  hasMore: boolean
  nextOffset: number | null
  at: string
}

function readJsonCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJsonCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode */
  }
}

function readEpisodeListCache(): EpisodeListCachePayload | null {
  const cached = readJsonCache<EpisodeListCachePayload>(ALL_EPISODES_CACHE_KEY)
  if (!cached || !Array.isArray(cached.episodes)) return null
  return cached
}

function writeEpisodeListCache(payload: EpisodeListCachePayload) {
  writeJsonCache(ALL_EPISODES_CACHE_KEY, payload)
}

function tickerStatusCacheKey(ticker: string): string {
  return `${TICKER_STATUS_CACHE_PREFIX}${String(ticker || '').trim().toUpperCase()}`
}

function readTickerStatusCache(ticker: string): MomentumStatus | null {
  const symbol = String(ticker || '').trim().toUpperCase()
  if (!symbol) return null
  const cached = readJsonCache<MomentumStatus>(tickerStatusCacheKey(symbol))
  if (!cached || typeof cached !== 'object') return null
  return cached
}

function writeTickerStatusCache(ticker: string, status: MomentumStatus) {
  const symbol = String(ticker || '').trim().toUpperCase()
  if (!symbol) return
  writeJsonCache(tickerStatusCacheKey(symbol), status)
  try {
    const index = readJsonCache<string[]>(TICKER_STATUS_CACHE_INDEX_KEY) || []
    const next = [symbol, ...index.filter((t) => t !== symbol)]
    const overflow = next.slice(TICKER_STATUS_CACHE_MAX)
    for (const old of overflow) {
      localStorage.removeItem(tickerStatusCacheKey(old))
    }
    writeJsonCache(
      TICKER_STATUS_CACHE_INDEX_KEY,
      next.slice(0, TICKER_STATUS_CACHE_MAX),
    )
  } catch {
    /* ignore */
  }
}

function clearDeskLocalCaches() {
  try {
    localStorage.removeItem(ALL_EPISODES_CACHE_KEY)
    const index = readJsonCache<string[]>(TICKER_STATUS_CACHE_INDEX_KEY) || []
    for (const t of index) {
      localStorage.removeItem(tickerStatusCacheKey(t))
    }
    localStorage.removeItem(TICKER_STATUS_CACHE_INDEX_KEY)
    // Best-effort sweep of any leftover status keys
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith(TICKER_STATUS_CACHE_PREFIX)) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    /* ignore */
  }
  clearOnDemandResearchCache()
}

function UpdatingFromSupabaseNote({
  show,
  className,
}: {
  show: boolean
  className?: string
}) {
  if (!show) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] text-muted-foreground',
        className,
      )}
    >
      <Loader2 className="size-3 animate-spin" />
      Updating from Supabase
    </span>
  )
}

/** Desk network helper — always bypass HTTP + browser caches. */
function deskFetch(input: string, init?: RequestInit): Promise<Response> {
  const method = String(init?.method || 'GET').toUpperCase()
  let url = input
  if (method === 'GET' || method === 'HEAD') {
    const sep = url.includes('?') ? '&' : '?'
    url = `${url}${sep}_=${Date.now()}`
  }
  return fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.headers || {}),
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })
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
  /** Enabled Trigger subscribers (device_monitor) */
  subscriberCount?: number | null
}

/** Seed list only for equities / crypto / indexes. */
const DEFAULT_WATCHLIST: WatchTab[] = [
  { ticker: 'SNDK', label: 'SNDK', assetClass: 'equity' },
  { ticker: 'TSLA', label: 'SpaceX', assetClass: 'equity' },
  { ticker: 'AAPL', label: 'Apple', assetClass: 'equity' },
  { ticker: 'NVDA', label: 'NVIDIA', assetClass: 'equity' },
  { ticker: 'BTC-USD', label: 'Bitcoin', assetClass: 'crypto' },
  { ticker: 'ETH-USD', label: 'Ethereum', assetClass: 'crypto' },
  { ticker: '^GSPC', label: 'S&P 500', assetClass: 'index' },
  { ticker: '^DJI', label: 'Dow Jones', assetClass: 'index' },
  { ticker: '^IXIC', label: 'Nasdaq', assetClass: 'index' },
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

/** Common US ETF tickers — Yahoo quoteType is better when available. */
const KNOWN_ETF_TICKERS = new Set([
  'SPY',
  'QQQ',
  'IWM',
  'DIA',
  'VOO',
  'VTI',
  'VEA',
  'VWO',
  'EFA',
  'EEM',
  'ARKK',
  'XLF',
  'XLE',
  'XLK',
  'XLV',
  'XLI',
  'XLY',
  'XLP',
  'XLU',
  'XLB',
  'XLRE',
  'GLD',
  'SLV',
  'TLT',
  'IEF',
  'HYG',
  'LQD',
  'AGG',
  'BND',
  'UNG',
  'USO',
  'SMH',
  'SOXX',
  'BOTZ',
  'JETS',
  'KWEB',
  'FXI',
  'INDA',
  'EWJ',
  'EWZ',
  'MCHI',
])

function detectAssetClass(ticker: string): string {
  const t = ticker.toUpperCase()
  if (t.endsWith('-USD') || t.endsWith('-USDT') || /^(BTC|ETH|SOL|XRP|DOGE|ADA)/.test(t)) {
    return 'crypto'
  }
  if (t.endsWith('=X') || /^[A-Z]{6}=X$/.test(t)) return 'forex'
  if (t.endsWith('=F') || /^(GC|CL|SI|NG|HG|ZC|ZW)=F$/.test(t)) return 'commodity'
  if (t.startsWith('^')) return 'index'
  if (KNOWN_ETF_TICKERS.has(t)) return 'etf'
  return 'equity'
}

function expectedEpisodeSourceTable(ticker: string): string {
  const assetClass = detectAssetClass(ticker)
  if (assetClass === 'etf') return 'episodes_etfs'
  if (assetClass === 'index') return 'episodes_indexes'
  if (assetClass === 'forex') return 'episodes_forex'
  if (assetClass === 'crypto') return 'episodes_crypto'
  if (assetClass === 'commodity') return 'episodes_commodities'
  return 'episodes_stocks'
}

/** Left-rail filter: icon-only pills */
const ASSET_CLASS_TABS: {
  id: 'equity' | 'etf' | 'index' | 'forex' | 'crypto' | 'commodity'
  label: string
  Icon: LucideIcon
}[] = [
  { id: 'equity', label: 'Stocks', Icon: LineChart },
  { id: 'etf', label: 'ETFs', Icon: PieChart },
  { id: 'index', label: 'Indices', Icon: BarChart3 },
  { id: 'forex', label: 'Forex', Icon: DollarSign },
  { id: 'crypto', label: 'Crypto', Icon: Bitcoin },
  { id: 'commodity', label: 'Commodities', Icon: Wheat },
]

type AssetClassTabId = (typeof ASSET_CLASS_TABS)[number]['id']

const ASSET_CLASS_FILTER_KEY = 'momentum-asset-class-filter-v1'
const ENTITY_LIST_PREFS_KEY = 'momentum-entity-list-prefs-v1'
const READ_MARKET_BULLETINS_KEY = 'momentum-read-market-bulletins-v1'

function loadReadMarketBulletinIds(): Set<string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(READ_MARKET_BULLETINS_KEY) || '[]',
    ) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed
        .map((id) => String(id || '').trim())
        .filter(Boolean)
        .slice(-500),
    )
  } catch {
    return new Set()
  }
}

function saveReadMarketBulletinIds(ids: Set<string>) {
  try {
    localStorage.setItem(
      READ_MARKET_BULLETINS_KEY,
      JSON.stringify([...ids].slice(-500)),
    )
  } catch {
    /* ignore unavailable local storage */
  }
}

/** Left-rail entity list: who to show. */
type EntityShowMode = 'subscribers' | 'all'
/** Left-rail entity list: active-momentum gate. */
type EntityMomentumFilter = 'any' | 'active' | 'inactive'
/** Left-rail entity list: sort order. */
type EntitySortMode = 'name' | 'subscribers_desc' | 'subscribers_asc'

type EntityListPrefs = {
  show: EntityShowMode
  momentum: EntityMomentumFilter
  sort: EntitySortMode
}

const DEFAULT_ENTITY_LIST_PREFS: EntityListPrefs = {
  show: 'subscribers',
  momentum: 'any',
  sort: 'name',
}

function loadEntityListPrefs(): EntityListPrefs {
  try {
    const raw = localStorage.getItem(ENTITY_LIST_PREFS_KEY)
    if (!raw) return { ...DEFAULT_ENTITY_LIST_PREFS }
    const parsed = JSON.parse(raw) as Partial<EntityListPrefs>
    return {
      show:
        parsed.show === 'all' || parsed.show === 'subscribers'
          ? parsed.show
          : DEFAULT_ENTITY_LIST_PREFS.show,
      momentum:
        parsed.momentum === 'active' ||
        parsed.momentum === 'inactive' ||
        parsed.momentum === 'any'
          ? parsed.momentum
          : DEFAULT_ENTITY_LIST_PREFS.momentum,
      sort:
        parsed.sort === 'subscribers_desc' ||
        parsed.sort === 'subscribers_asc' ||
        parsed.sort === 'name'
          ? parsed.sort
          : DEFAULT_ENTITY_LIST_PREFS.sort,
    }
  } catch {
    return { ...DEFAULT_ENTITY_LIST_PREFS }
  }
}

function saveEntityListPrefs(prefs: EntityListPrefs) {
  try {
    localStorage.setItem(ENTITY_LIST_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}

const MONITORED_BY_CLASS_CACHE_KEY = 'momentum-monitored-by-class-v1'

type MonitoredByClassCache = {
  byClass: Partial<Record<AssetClassTabId, WatchTab[]>>
  table?: string | null
  counts?: Partial<Record<string, number>>
  savedAt?: string
}

function loadMonitoredByClassCache(): MonitoredByClassCache | null {
  try {
    const raw = localStorage.getItem(MONITORED_BY_CLASS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MonitoredByClassCache
    if (!parsed || typeof parsed !== 'object' || !parsed.byClass) return null
    return parsed
  } catch {
    return null
  }
}

function saveMonitoredByClassCache(payload: MonitoredByClassCache) {
  try {
    localStorage.setItem(
      MONITORED_BY_CLASS_CACHE_KEY,
      JSON.stringify({
        ...payload,
        savedAt: new Date().toISOString(),
      }),
    )
  } catch {
    /* ignore */
  }
}

function loadAssetClassFilter(): AssetClassTabId | null {
  // Desk opens with no bottom tab selected (active-episodes left rail).
  // Persisted class is only restored when the user explicitly picks a tab.
  void ASSET_CLASS_FILTER_KEY
  return null
}

function saveAssetClassFilter(id: AssetClassTabId | null) {
  try {
    if (!id) {
      localStorage.removeItem(ASSET_CLASS_FILTER_KEY)
      return
    }
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
  if (raw === 'index' || raw === 'indices' || raw === 'indexes') return 'index'
  if (raw === 'etf' || raw === 'etfs' || raw === 'fund') return 'etf'
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

/** Quick-add chips — no commodity/forex hardcodes (those lists = research tables). */
const QUICK_ADDS: WatchTab[] = [
  { ticker: 'BTC-USD', label: 'Bitcoin', assetClass: 'crypto' },
  { ticker: 'ETH-USD', label: 'Ethereum', assetClass: 'crypto' },
  { ticker: 'SOL-USD', label: 'Solana', assetClass: 'crypto' },
  { ticker: 'AAPL', label: 'Apple', assetClass: 'equity' },
  { ticker: 'NVDA', label: 'NVIDIA', assetClass: 'equity' },
  { ticker: 'TSLA', label: 'Tesla', assetClass: 'equity' },
]

function loadWatchlist(): WatchTab[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    if (!raw) return DEFAULT_WATCHLIST
    const parsed = JSON.parse(raw) as WatchTab[]
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_WATCHLIST
    const out: WatchTab[] = []
    for (const row of parsed) {
      const ticker = normalizeWatchTicker(String(row?.ticker || ''))
      if (!ticker) continue
      out.push({
        ticker,
        label: String(row?.label || ticker).trim() || ticker,
        assetClass: row?.assetClass || detectAssetClass(ticker),
      })
    }
    return out.length ? out : DEFAULT_WATCHLIST
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
    const saved = String(localStorage.getItem(ACTIVE_TICKER_KEY) || '')
      .trim()
      .toUpperCase()
    if (saved && list.some((t) => t.ticker === saved)) return saved
    // Persist only an explicit prior pick — never invent a default ticker.
    if (saved) return saved
  } catch {
    /* ignore */
  }
  return ''
}

function saveActiveTicker(ticker: string) {
  try {
    const t = String(ticker || '')
      .trim()
      .toUpperCase()
    if (!t) {
      localStorage.removeItem(ACTIVE_TICKER_KEY)
      return
    }
    localStorage.setItem(ACTIVE_TICKER_KEY, t)
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

/** Live episode class tables in Supabase (post rename_strip_prefixes). */
const SUPABASE_EPISODE_CLASS_TABLES = [
  'episodes_stocks',
  'episodes_etfs',
  'episodes_indexes',
  'episodes_forex',
  'episodes_crypto',
  'episodes_commodities',
  'episodes',
] as const

/**
 * Pre-filled SQL: one episode_id → episode row (any class table) + all events
 * + all Perplexity research rows (by episode_id and by events.research_id).
 */
function buildEpisodeBundleSql(episodeId: string): string {
  const safeId = String(episodeId || '').trim().replace(/'/g, "''")
  const unionEpisode = SUPABASE_EPISODE_CLASS_TABLES.map(
    (table) =>
      `  select '${table}'::text as source_table, to_jsonb(t) as row\n  from public.${table} as t\n  where t.episode_id = '${safeId}'`,
  ).join('\n  union all\n')

  return `-- Everything related to episode_id = ${safeId}
-- Tables: episodes_* · events_episodes · research (Perplexity)
with episode_hits as (
${unionEpisode}
),
episode_pick as (
  select *
  from episode_hits
  order by
    case source_table
      when 'episodes_stocks' then 1
      when 'episodes_etfs' then 2
      when 'episodes_indexes' then 3
      when 'episodes_forex' then 4
      when 'episodes_crypto' then 5
      when 'episodes_commodities' then 6
      else 9
    end
  limit 1
),
event_rows as (
  select e.*
  from public.events_episodes as e
  where e.episode_id = '${safeId}'
  order by e.detected_at asc nulls last
),
research_rows as (
  select distinct on (r.id) r.*
  from public.research as r
  where r.episode_id = '${safeId}'
     or r.id in (
       select ev.research_id
       from public.events_episodes as ev
       where ev.episode_id = '${safeId}'
         and ev.research_id is not null
     )
  order by r.id, r.created_at desc nulls last
)
select
  (select source_table from episode_pick) as episode_source_table,
  (select row from episode_pick) as episode,
  (
    select coalesce(
      jsonb_agg(to_jsonb(ev) order by ev.detected_at asc nulls last),
      '[]'::jsonb
    )
    from event_rows as ev
  ) as events,
  (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at asc nulls last), '[]'::jsonb)
    from research_rows as r
  ) as research,
  (select count(*)::int from event_rows) as event_count,
  (select count(*)::int from research_rows) as research_count;`
}

/** Sync URL → Supabase SQL editor with full episode bundle pre-filled. */
function supabaseEpisodeRecordUrl(
  episodeId: string | null | undefined,
  _opts?: { ticker?: string | null; assetClass?: string | null },
): string | null {
  const id = String(episodeId || '').trim()
  const base = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
  if (!id || !base) return null
  let projectRef = ''
  try {
    projectRef = new URL(base).hostname.split('.')[0] || ''
  } catch {
    return null
  }
  if (!projectRef) return null
  const sql = buildEpisodeBundleSql(id)
  return `https://supabase.com/dashboard/project/${encodeURIComponent(projectRef)}/sql/new?skip=true&content=${encodeURIComponent(sql)}`
}

/** Open SQL editor with episode + events + research pre-filled (also copies SQL). */
async function openEpisodeInSupabaseDashboard(opts: {
  episodeId: string | null | undefined
  ticker?: string | null
  assetClass?: string | null
}): Promise<void> {
  const episodeId = String(opts.episodeId || '').trim()
  if (!episodeId) {
    window.alert('No episode_id on this row — cannot open Supabase.')
    return
  }
  const ticker = String(opts.ticker || '').trim().toUpperCase()
  const assetClass = String(opts.assetClass || '').trim()
  const fallback = supabaseEpisodeRecordUrl(episodeId, { ticker, assetClass })
  const localSql = buildEpisodeBundleSql(episodeId)

  try {
    const qs = new URLSearchParams({ episode_id: episodeId })
    if (ticker) qs.set('ticker', ticker)
    if (assetClass) qs.set('asset_class', assetClass)
    const res = await fetch(`/api/desk/supabase-episode-link?${qs}`, {
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      url?: string
      sql?: string
      error?: string
    }
    const sql = body.sql || localSql
    try {
      await navigator.clipboard?.writeText(sql)
    } catch {
      /* clipboard optional */
    }
    const url = body.url || fallback
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    window.alert(body.error || 'Could not open Supabase SQL editor.')
  } catch (err) {
    try {
      await navigator.clipboard?.writeText(localSql)
    } catch {
      /* ignore */
    }
    if (fallback) {
      window.open(fallback, '_blank', 'noopener,noreferrer')
      return
    }
    window.alert(
      err instanceof Error
        ? err.message
        : 'Failed to open Supabase episode link',
    )
  }
}

function perplexityFinanceQuoteUrl(symbol: string): string {
  const s = String(symbol || '').trim()
  if (!s) return 'https://www.perplexity.ai/finance'
  return `https://www.perplexity.ai/finance/${encodeURIComponent(s)}`
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
  assetClass?: string | null,
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

/** Active listing timezone for Momentum quote stamps (exchange, not browser local). */
let momentumDisplayTimeZone = 'America/New_York'

function setMomentumDisplayTimeZone(tz: string | null | undefined) {
  if (tz && String(tz).trim()) momentumDisplayTimeZone = String(tz).trim()
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return (
    formatExchangeTime(iso, momentumDisplayTimeZone, {
      hour12: true,
      withZone: true,
    }) || iso
  )
}

/** Date + time for previous close / session prints (exchange zone). */
function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return null
  return (
    formatExchangeTime(iso, momentumDisplayTimeZone, {
      date: true,
      year: true,
      seconds: true,
      hour12: true,
      withZone: true,
    }) || String(iso)
  )
}

/** Time first, then date — used by compact table cells such as Started. */
function fmtTimeDate(iso: string | null | undefined) {
  if (!iso) return null
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return String(iso)
  const clock = formatExchangeTime(instant, momentumDisplayTimeZone, {
    seconds: true,
    hour12: true,
    withZone: true,
  })
  try {
    const date = instant.toLocaleDateString('en-US', {
      timeZone: momentumDisplayTimeZone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    return clock ? `${clock} · ${date}` : date
  } catch {
    return clock || String(iso)
  }
}

/** Short clock only — e.g. 4:00 PM EDT (no full date) */
function fmtClock(iso: string | null | undefined) {
  if (!iso) return null
  return formatExchangeTime(iso, momentumDisplayTimeZone, {
    hour12: true,
    withZone: true,
  })
}

/** Compact date + time — e.g. Mar 11, 4:00 PM EDT */
function fmtDateClock(iso: string | null | undefined) {
  if (!iso) return null
  return formatExchangeTime(iso, momentumDisplayTimeZone, {
    date: true,
    hour12: true,
    withZone: true,
  })
}

/** Session tag for dates / headings (matches alert + Supabase wording). */
function sessionDateLabel(
  marketSession?: string | null,
): string | null {
  const s = String(marketSession || '').trim().toUpperCase()
  if (s === 'PRE') return 'pre-market'
  if (s === 'PREPRE') return 'overnight'
  if (s === 'POST' || s === 'POSTPOST') return 'after-hours'
  if (s === 'REGULAR' || s === 'OPEN') return 'regular'
  if (s === 'CLOSED' || s === 'CLOSE') return 'closed'
  return null
}

/**
 * Episodes rail: always include the calendar date, not clock-only.
 * When marketSession is known, append pre-market / after-hours / overnight.
 */
function fmtEpisodeWhen(
  iso: string | null | undefined,
  marketSession?: string | null,
) {
  if (!iso) return '—'
  let base: string
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) base = String(iso)
    else {
      const sameYear = d.getFullYear() === new Date().getFullYear()
      base =
        formatExchangeTime(iso, momentumDisplayTimeZone, {
          date: true,
          year: !sameYear,
          hour12: true,
          withZone: true,
        }) || String(iso)
    }
  } catch {
    base = String(iso)
  }
  const sess = sessionDateLabel(marketSession)
  // Skip "regular" on every RTH timestamp — only tag extended / closed sessions
  if (sess && sess !== 'regular') return `${base} · ${sess}`
  return base
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

function pctColor(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return 'text-muted-foreground'
  if (n > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (n < 0) return 'text-rose-600 dark:text-rose-400'
  return 'text-muted-foreground'
}

/**
 * Blink only when this window’s configured episode threshold is crossed.
 * null / 0 / missing thr = diagnostic only → never blink.
 */
function isActiveThreshold(threshold: number | null | undefined): boolean {
  const n = Number(threshold)
  return Number.isFinite(n) && n > 0
}

function isHotMove(
  n: number | null | undefined,
  threshold: number | null | undefined,
) {
  if (!isActiveThreshold(threshold)) return false
  if (n == null || !Number.isFinite(n)) return false
  return Math.abs(n) >= Number(threshold)
}

/** True for rolling windows ≤24h (incl. 24h) — continuous pulse when hot. */
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

/**
 * Hot blink only when |move| ≥ that window’s configured threshold.
 * Windows with thr off (null/0) never blink.
 */
function hotBlinkClass(
  n: number | null | undefined,
  threshold: number | null | undefined,
  windowKey?: string | null,
) {
  if (!isHotMove(n, threshold)) return undefined
  const base = n! > 0 ? 'sndk-hot-up-blink' : 'sndk-hot-down-blink'
  if (isSub24hOr24hWindow(windowKey)) {
    return `${base} sndk-hot-blink-loop`
  }
  return base
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
  // One slot: PRE ↔ Regular ↔ Overnight ↔ After-hours. Value is always vs previous close.
  const s = String(marketSession || '').toUpperCase()
  if (s === 'PRE') return 'PRE'
  if (s === 'PREPRE') return 'Overnight'
  if (s === 'POST' || s === 'POSTPOST') return 'After-hours'
  if (s === 'REGULAR') return 'Regular'
  return 'Prev close'
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
        ? `in the last ${exact?.exactLabel || exactLabel} (since previous close)`
        : 'vs previous regular close'
  } else if (exactMins != null) {
    timePhrase = `in the last ${exact?.exactLabel || exactLabel}${bucketNote}`
  } else {
    timePhrase = `over the ${windowLabel} lookback`
  }

  const body = `${name} ${dirWord} ${pctStr} ${timePhrase}.`

  return { title, body, exactLabel, exactMinutes: exactMins ?? null, windowLabel }
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

/** Compact HH:mm + zone abbreviation (BST/GMT, EDT/EST) for the footer. */
function formatZoneHm(ms: number, timeZone: string) {
  try {
    const date = new Date(ms)
    const value = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date)
    const suffix = timeZoneSuffix(date, timeZone)
    return suffix ? `${value} ${suffix}` : value
  } catch {
    return '—'
  }
}

type MarketStatusRow = {
  id: string
  label: string
  symbol: string
  region?: string | null
  exchange?: string | null
  uiStatus: string
  engineLabel: string
  engineGate?: string
  calendarState: string
  freshnessState: string
  /** Raw Yahoo quote.marketState (PRE / PREPRE / REGULAR / POST / …). */
  marketState?: string | null
  currentSession?: string
  status?: string
  lastUpdateLondon?: string | null
  resumeAtLondon?: string | null
  quoteTimestampUtc?: string | null
  quoteAgeSec?: number | null
  nextExpectedOpenUtc?: string | null
  reason?: string
  price?: number | null
  child?: MarketStatusRow | null
}

function marketSessionToneClass(session: string | undefined | null): string {
  const s = String(session || '').trim().toUpperCase()
  if (s === 'REGULAR' || s === 'OPEN') {
    return 'text-emerald-600 dark:text-emerald-400'
  }
  if (
    s === 'PRE' ||
    s === 'PREPRE' ||
    s === 'POST' ||
    s === 'POSTPOST'
  ) {
    return 'text-amber-600 dark:text-amber-400'
  }
  if (s === 'CLOSED' || s === 'CLOSE' || s === '—' || !s) {
    return 'text-muted-foreground'
  }
  return 'text-foreground'
}

/** Flag / mark for market-sessions cards (probe id → emoji). */
function marketSessionFlag(row: {
  id?: string
  region?: string | null
  symbol?: string
}): string {
  const id = String(row.id || '').toLowerCase()
  const byId: Record<string, string> = {
    'us-stocks': '🇺🇸',
    'us-nasdaq': '🇺🇸',
    'cash-index': '🇺🇸',
    canada: '🇨🇦',
    brazil: '🇧🇷',
    'uk-stocks': '🇬🇧',
    'uk-ftse': '🇬🇧',
    germany: '🇩🇪',
    france: '🇫🇷',
    switzerland: '🇨🇭',
    'india-nse': '🇮🇳',
    'india-bse': '🇮🇳',
    japan: '🇯🇵',
    china: '🇨🇳',
    'hong-kong': '🇭🇰',
    korea: '🇰🇷',
    singapore: '🇸🇬',
    australia: '🇦🇺',
    dubai: '🇦🇪',
    'south-africa': '🇿🇦',
    forex: '💱',
    crypto: '🪙',
    commodities: '🥇',
    indices: '📈',
  }
  if (byId[id]) return byId[id]
  const region = String(row.region || '').toLowerCase()
  if (region.includes('america')) return '🌎'
  if (region.includes('europe')) return '🇪🇺'
  if (region.includes('asia')) return '🌏'
  if (region.includes('africa')) return '🌍'
  if (region.includes('middle')) return '🌍'
  return '🏳️'
}

/** Footer session label — exact Yahoo marketState when known (else ET clock). */
function MarketStatusBadge({
  nowMs,
  className,
  yahooMarketState,
}: {
  nowMs: number
  className?: string
  /** Raw Yahoo marketState for US probe (SPY), e.g. POST / REGULAR / CLOSED */
  yahooMarketState?: string | null
}) {
  const market = usEquitySessionFromEtClock(nowMs)
  const yahoo = String(yahooMarketState || '')
    .trim()
    .toUpperCase()
  const label = yahoo || market.label
  const isRegular = yahoo
    ? yahoo === 'REGULAR' || yahoo === 'OPEN'
    : market.tone === 'open'
  const londonOpen = formatEtWallInTimeZone(9, 30, UK_ZONE, nowMs)
  const londonClose = formatEtWallInTimeZone(16, 0, UK_ZONE, nowMs)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap text-[11px] tabular-nums leading-none',
        className,
      )}
      title={
        yahoo
          ? `Yahoo marketState · ${yahoo} (US SPY probe). Regular cash in London today: ${londonOpen}–${londonClose}.`
          : `US equities · ${market.label} · hours are America/New_York. Regular in London today: ${londonOpen}–${londonClose}.`
      }
    >
      <span
        className={cn(
          'font-mono font-semibold tracking-tight',
          yahoo
            ? marketSessionToneClass(yahoo)
            : marketStatusToneClass(market.tone),
          isRegular && 'sndk-market-live-blink',
        )}
      >
        {label}
      </span>
    </span>
  )
}

/** Parse "15m" / "2h" / "day" → human lookback description */
function lookbackDescription(
  key: string,
  opts?: { eligibleTrading?: boolean; wallSpanMinutes?: number | null },
): string {
  if (key === 'day')
    return 'vs previous regular close — same slot labeled PRE / Regular / Overnight by session (not a 1D rolling window)'
  const h = key.match(/^(\d+(?:\.\d+)?)h$/i)
  const m = key.match(/^(\d+)m$/i)
  const nominal = h
    ? `${Number(h[1])} hour${Number(h[1]) === 1 ? '' : 's'}`
    : m
      ? `${Number(m[1])} minute${Number(m[1]) === 1 ? '' : 's'}`
      : key
  if (opts?.eligibleTrading) {
    return `Eligible trading lookback of ${nominal} on 1‑minute Yahoo candles (closed / weekend / maintenance time is skipped — so wall-clock span can be longer than ${nominal})`
  }
  if (h || m) {
    return `Wall-clock lookback of ${nominal} on 1‑minute Yahoo candles`
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

function formatWallSpan(exactMinutes: number | null | undefined): string | null {
  if (exactMinutes == null || !Number.isFinite(exactMinutes) || exactMinutes <= 0) {
    return null
  }
  const m = Math.round(exactMinutes)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  if (m < 24 * 60) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    return rem === 0 ? `${h} hour${h === 1 ? '' : 's'}` : `${h}h ${rem}m`
  }
  const d = Math.floor(m / (24 * 60))
  const remH = Math.round((m - d * 24 * 60) / 60)
  if (remH === 0) return `${d} day${d === 1 ? '' : 's'}`
  return `${d}d ${remH}h`
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
  /** Nominal window size (e.g. 1440 for 24h) */
  windowMinutes: number | null
  /** Actual wall-clock minutes between reference and now */
  wallSpanMinutes: number | null
  wallSpanLabel: string | null
  usedEligibleTrading: boolean
  crossedClosure: boolean
  sessionOpen: {
    price: number | null
    time: string | null
    shortLabel: string | null
    label: string | null
  } | null
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
  exact?: ExactLookback | null
  sessionOpen?: {
    price: number | null
    time: string | null
    shortLabel: string | null
    label: string | null
  } | null
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
    exact,
    sessionOpen = null,
  } = opts
  const isDay = key === 'day'
  const session = String(marketSession || '').toUpperCase()
  const notes: string[] = []
  const mins = minutesFromReturnKey(key)

  let wallSpanMinutes: number | null =
    exact?.exactMinutes != null && Number.isFinite(exact.exactMinutes)
      ? Math.round(Number(exact.exactMinutes))
      : null
  if (
    wallSpanMinutes == null &&
    referenceTime &&
    asOfTime
  ) {
    const refMs = Date.parse(referenceTime)
    const asOfMs = Date.parse(asOfTime)
    if (Number.isFinite(refMs) && Number.isFinite(asOfMs) && asOfMs >= refMs) {
      wallSpanMinutes = Math.max(1, Math.round((asOfMs - refMs) / 60_000))
    }
  }
  const wallSpanLabel = formatWallSpan(wallSpanMinutes)
  const windowMinutes =
    exact?.windowMinutes != null && Number.isFinite(exact.windowMinutes)
      ? Number(exact.windowMinutes)
      : mins
  // Eligible trading if server flagged a closure, or wall span is clearly longer
  // than the nominal window (e.g. Mon “24h” anchored Friday ≈ 72h wall).
  const spanSkew =
    wallSpanMinutes != null &&
    windowMinutes != null &&
    wallSpanMinutes >= windowMinutes + 90
  const usedEligibleTrading = Boolean(
    exact?.crossedClosure || exact?.sessionBoundaryType || spanSkew,
  )
  const crossedClosure = Boolean(exact?.crossedClosure || spanSkew)

  let method: string
  let formula: string
  if (isDay) {
    method =
      session === 'PRE'
        ? 'PRE card — live pre-market price vs previous regular close'
        : session === 'PREPRE'
          ? 'Overnight card — live overnight price vs previous regular close'
          : session === 'POST' || session === 'POSTPOST'
            ? 'After-hours card — live after-hours price vs previous regular close'
            : session === 'REGULAR'
              ? 'Regular card — live regular-hours price vs previous regular close'
              : 'vs previous regular close (not a 1D / 24h rolling window)'
    formula = '((livePrice − previousClose) / previousClose) × 100'
    notes.push('Same card slot swaps PRE → Regular → Overnight / After-hours with the session')
    notes.push('previousClose = Yahoo’s last completed regular-session close')
    notes.push('This is not a 24-hour rolling lookback. 24h is a separate card with its own clock window.')
    if (wallSpanLabel) {
      notes.push(
        `Calendar time since previous close: ${wallSpanLabel}. That often includes overnight / weekend / closed hours — it is not “last ${wallSpanLabel} of continuous trading.”`,
      )
    }
    if (
      session === 'PRE' ||
      session === 'PREPRE' ||
      session === 'POST' ||
      session === 'POSTPOST'
    ) {
      notes.push(
        'Live print uses Yahoo preMarket* (PRE) or postMarket* (POST / Overnight)',
      )
      notes.push(
        'Lookback column shows the first 1m print when this session opened (pre ≈ 4:00 AM ET, AH ≈ 4:00 PM ET) — not the previous close time.',
      )
      notes.push(
        'Move % is still vs previous regular close (Yahoo day / soft-start thr). Session-open price is display-only.',
      )
    }
  } else {
    method = isBridge
      ? `Weekend-bridge rolling return (${key})`
      : usedEligibleTrading
        ? `Rolling return (${key}) · eligible trading time`
        : `Rolling return (${key})`
    formula = '((currentPrice − priceAtLookback) / priceAtLookback) × 100'
    notes.push(
      lookbackDescription(key, {
        eligibleTrading: usedEligibleTrading,
        wallSpanMinutes,
      }),
    )
    notes.push(
      'priceAtLookback = last 1m candle at or before the lookback target time',
    )
    if (windowMinutes != null && wallSpanLabel) {
      const nominal =
        windowMinutes >= 60 && windowMinutes % 60 === 0
          ? `${windowMinutes / 60}h`
          : `${windowMinutes}m`
      if (crossedClosure || spanSkew) {
        notes.push(
          `Not ${nominal} on the wall clock — actual span between the two prices is ${wallSpanLabel} (closed-market time was skipped while walking ${nominal} of tradable session).`,
        )
      } else {
        notes.push(`Actual wall-clock span: ${wallSpanLabel}.`)
      }
    }
    if (isBridge) {
      notes.push('Bridge window: shown Mon pre-open / weekend to reach Friday prints')
    }
    if (crossedClosure) {
      notes.push(
        'Lookback crossed a session close / weekend — reference is the last tradable print before / across that gap (often Friday for US equities on Monday).',
      )
    }
    notes.push(
      'Short windows (1m–90m) usually stay inside the live tape; long windows can bridge overnight / weekend.',
    )
  }

  if (value == null) {
    notes.push(
      isDay
        ? 'No value: missing live price or previous close from Yahoo'
        : 'No value: not enough 1m history near this lookback (or gap too large)',
    )
  }

  if (threshold != null && Number(threshold) > 0) {
    notes.push(
      value != null && Math.abs(value) >= threshold
        ? `Threshold |move| ≥ ${threshold}% — HOT (blink + can start/continue episode)`
        : `Threshold |move| ≥ ${threshold}% — below threshold (no blink)`,
    )
  } else {
    notes.push(
      'No active threshold on this window — display only (never blinks until thr is set > 0)',
    )
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
    lookback: lookbackDescription(key, {
      eligibleTrading: usedEligibleTrading,
      wallSpanMinutes,
    }),
    notes,
    windowMinutes: windowMinutes ?? null,
    wallSpanMinutes,
    wallSpanLabel,
    usedEligibleTrading,
    crossedClosure,
    sessionOpen: sessionOpen ?? null,
  }
}

function ReturnCalcTooltipBody({
  detail,
  assetClass,
  currency,
  onStartEpisode,
  startEpisodeBusy,
  canStartEpisode,
}: {
  detail: ReturnCalcDetail
  assetClass?: string
  currency?: string | null
  onStartEpisode?: () => void
  startEpisodeBusy?: boolean
  canStartEpisode?: boolean
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
    <div className="relative flex w-[min(22rem,88vw)] flex-col gap-3 text-left text-[13px] leading-relaxed">
      <div className="flex min-w-0 items-start justify-between gap-2 pr-0">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-background/65">
            {detail.label} · how calculated
          </p>
          <p className="text-[14px] font-semibold leading-snug text-background">
            {detail.method}
          </p>
        </div>
        {onStartEpisode ? (
          <Button
            type="button"
            size="sm"
            data-start-episode
            disabled={!canStartEpisode || startEpisodeBusy}
            className="pointer-events-auto shrink-0 gap-1 rounded-full bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-background/90 disabled:opacity-50"
            title={
              canStartEpisode
                ? 'Start a full momentum episode on this window (research + alerts)'
                : 'Need a live return on this window to start'
            }
            onPointerDown={(e) => {
              // Keep tooltip open long enough for the click
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onStartEpisode()
            }}
          >
            {startEpisodeBusy ? (
              <Loader2 className="size-3 animate-spin" strokeWidth={2} />
            ) : (
              <Zap className="size-3" strokeWidth={2} />
            )}
            Start episode
          </Button>
        ) : null}
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

        {detail.sessionOpen?.price != null || detail.sessionOpen?.time ? (
          <div className="min-w-0 space-y-0.5 border-t border-background/15 pt-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
              {detail.sessionOpen.shortLabel || 'Session open'}
            </p>
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
              <span className="text-[15px] font-semibold text-background">
                {price(detail.sessionOpen.price)}
              </span>
              <span className="text-[12px] text-background/70">
                {detail.sessionOpen.time
                  ? ts(detail.sessionOpen.time)
                  : '—'}
              </span>
            </p>
            {detail.sessionOpen.label ? (
              <p className="text-[11px] leading-snug text-background/55">
                {detail.sessionOpen.label} — first 1m print on the tape for this
                session (Lookback column).
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="min-w-0 space-y-0.5 border-t border-background/15 pt-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
            {detail.key === 'day' ? 'Previous close (move %)' : 'Lookback price'}
          </p>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
            <span className="text-[15px] font-semibold text-background">
              {price(detail.referencePrice)}
            </span>
            <span className="text-[12px] text-background/70">{refTs}</span>
          </p>
        </div>

        {detail.wallSpanLabel ? (
          <div className="min-w-0 space-y-0.5 border-t border-background/15 pt-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
              {detail.key === 'day'
                ? 'Time since previous close'
                : 'Actual wall-clock span'}
            </p>
            <p className="text-[15px] font-semibold tabular-nums text-background">
              {detail.wallSpanLabel}
              {detail.key === 'day' ? (
                <span className="ml-2 text-[12px] font-medium text-background/55">
                  (calendar, not trading hours)
                </span>
              ) : detail.windowMinutes != null ? (
                <span className="ml-2 text-[12px] font-medium text-background/55">
                  {detail.crossedClosure || detail.usedEligibleTrading
                    ? `(not ${
                        detail.windowMinutes >= 60 &&
                        detail.windowMinutes % 60 === 0
                          ? `${detail.windowMinutes / 60}h`
                          : `${detail.windowMinutes}m`
                      } on the clock)`
                    : '≈ window size'}
                </span>
              ) : null}
            </p>
            {detail.key === 'day' ? (
              <p className="text-[11px] leading-snug text-amber-200/90">
                PRE / session card is live vs previous regular close — not “in
                the last {detail.wallSpanLabel} of trading.” Weekend and closed
                hours sit inside this calendar gap (often ~Fri close → Mon
                pre-market).
              </p>
            ) : detail.crossedClosure || detail.usedEligibleTrading ? (
              <p className="text-[11px] leading-snug text-amber-200/90">
                Label “{detail.label}” is a clock window. When Yahoo has no
                print at the exact lookback, the span can look longer — or the
                row shows — instead of inventing a price.
              </p>
            ) : null}
          </div>
        ) : null}

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

type EpisodeGuidePolicy = {
  accelerationAlertDeltaPp?: number
  materialProgressDeltaPp?: number
  holdingToWeakeningGiveback?: number
  weakeningToHoldingGiveback?: number
  strongWeakeningGiveback?: number
  episodeInactivityExpiryMin?: number
}

function pctPoints(n: number, digits = 1) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

function EpisodeStatusGuideButton({
  policy,
}: {
  policy?: EpisodeGuidePolicy | null
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>('STARTED')
  const weak = policy?.holdingToWeakeningGiveback ?? 0.25
  const hold = policy?.weakeningToHoldingGiveback ?? 0.2
  const strong = policy?.strongWeakeningGiveback ?? 0.6
  const accelPp = policy?.accelerationAlertDeltaPp ?? 2
  const progressPp = policy?.materialProgressDeltaPp ?? 0.5
  const expireMin = policy?.episodeInactivityExpiryMin ?? 180

  const items: Array<{
    id: string
    kind: 'live' | 'close'
    label: string
    meaning: string
    calc: string
    example: string
    /** When (if ever) a push notification fires for this status */
    alerts: string
    pushes: boolean
    /** Example Expo / phone notification, or null when silent */
    alertExample: { title: string; body: string } | null
  }> = [
    {
      id: 'STARTED',
      kind: 'live',
      label: 'Started',
      meaning:
        'A ≤24h or 1D (vs previous close) window just crossed its |move %| threshold. This opens the episode.',
      calc: '|window return| ≥ that window’s threshold. Live state stays Started for about one poll, then becomes Holding unless the move accelerates or reverses first.',
      example:
        'NVDA 5m = +3.4% and the 5m threshold is 3%. Engine opens UP episode #041. Reference $100.00, live $103.40. Status = Started.',
      alerts:
        'Yes — after Perplexity research finishes (not on the raw start tick). Body is the likely driver only. Silent starts after a reversal (AFTER_REVERSAL) do not push again.',
      pushes: true,
      alertExample: {
        title: '🟢 NVDA +3.4% in last 5 minutes',
        body: 'Options flow and AI server demand headlines after the print.',
      },
    },
    {
      id: 'HOLDING',
      kind: 'live',
      label: 'Holding',
      meaning:
        'The episode is still on. Price has not faded enough from the peak (UP) or trough (DOWN) to call Weakening. Tiny ticks stay Holding.',
      calc: `Giveback = (peak − live) / (peak − reference) for UP, or (live − trough) / (reference − trough) for DOWN. Holding while giveback < ${pctPoints(weak)} (return to Holding only after it falls back to ≤ ${pctPoints(hold)}).`,
      example:
        'UP episode. Reference $100, peak $105.20, live $104.80. Giveback = ($105.20 − $104.80) / ($105.20 − $100) = 7.7%. 7.7% < 25% → Holding · 7.7%.',
      alerts: 'No push. Dashboard-only status while the move stays intact.',
      pushes: false,
      alertExample: null,
    },
    {
      id: 'WEAKENING',
      kind: 'live',
      label: 'Weakening',
      meaning:
        'A meaningful slice of the peak/trough move has been given back. Still the same episode — no push, no close.',
      calc: `Giveback ≥ ${pctPoints(weak)}. Stays Weakening until giveback ≤ ${pctPoints(hold)} (hysteresis) or it hits Strongly weakening / accel / reverse.`,
      example:
        'Same UP episode. Peak still $105.20, live now $103.64. Giveback = $1.56 / $5.20 = 30%. 30% ≥ 25% → Weakening · 30%.',
      alerts: 'No push. Fade is tracked on the dashboard only.',
      pushes: false,
      alertExample: null,
    },
    {
      id: 'STRONGLY_WEAKENING',
      kind: 'live',
      label: 'Strongly weakening',
      meaning:
        'Most of the original episode move has faded (≥60% giveback). Still open. This is the “surge faded badly” chapter — not a full reverse.',
      calc: `Giveback ≥ ${pctPoints(strong)}. Remaining move becomes the recovery anchor for the comeback leg.`,
      example:
        'Peak +10% → live +4% remains. Giveback = 60% → Strongly weakening · 60%. Timeline: “Strong giveback” + Alert sent.',
      alerts: `Yes — push in the current weakening cycle. Small green ticks after this stay silent until +${accelPp.toFixed(1)} pp vs the anchor.`,
      pushes: true,
      alertExample: {
        title: 'SNDK has given back 60% of its surge',
        body: 'The earlier +10.0% move has faded sharply, with about +4.0% remaining.',
      },
    },
    {
      id: 'RE_ACCELERATING',
      kind: 'live',
      label: 'Re-accelerating (comeback)',
      meaning:
        `Comeback after a real fade. After strong giveback, recovery is silent until the move is ≥ ${accelPp.toFixed(1)} pp above the recovery anchor. That first material recovery is Re-accelerating — not every small green tick.`,
      calc: `awaitingReAcceleration after ≥60% giveback, then |episode move| ≥ anchor + ${accelPp.toFixed(1)} pp. Cycle flags then reset so a later fade can alert again.`,
      example:
        'Peak +10% → fade to +4% (strong push, anchor +4%). +4.5% / +5.2% silent on timeline. +6.0% → Re-accelerating + Alert sent (“is accelerating again”).',
      alerts: `Yes — only the first +${accelPp.toFixed(1)} pp recovery after strong giveback (or after a real fade). Tiny ticks do not push.`,
      pushes: true,
      alertExample: {
        title: 'SNDK is accelerating again',
        body: 'The move has recovered from +4.0% to +6.0% after the earlier fade.',
      },
    },
    {
      id: 'ACCELERATING',
      kind: 'live',
      label: 'Accelerating',
      meaning:
        'The episode move extended far enough beyond the last notified level. First-leg surge extension, or further extension after a comeback.',
      calc: `|episode move| is ≥ ${accelPp.toFixed(1)} percentage points beyond last notified episode move.`,
      example:
        `After re-accel at +6%, live reaches +8% (+2 pp) → Accelerating. Timeline: “Accelerating” + Alert sent (“extends its recovery”).`,
      alerts: `Yes — ≥ ${accelPp.toFixed(1)} pp past last notified. After a recovery, copy is “extends its recovery”.`,
      pushes: true,
      alertExample: {
        title: 'SNDK extends its recovery',
        body: 'The surge now stands at +8.0%.',
      },
    },
    {
      id: 'REVERSAL',
      kind: 'live',
      label: 'Reversal',
      meaning:
        'The original move is gone and the other direction has its own threshold hit. Old episode closes; a new opposite episode can start.',
      calc: 'UP erased when live ≤ reference. DOWN erased when live ≥ reference. Plus an opposite ≤24h / 1D threshold hit.',
      example:
        'UP episode, reference $100. Live $99.20 (erased) and 5m = −3.4%. Old episode → Reversed. New DOWN episode starts.',
      alerts:
        'Yes — one push for the reverse. The new opposite episode may open silently (no second start push on AFTER_REVERSAL).',
      pushes: true,
      alertExample: {
        title: 'NVDA reverses lower',
        body: 'Earlier gains have been erased as downside momentum builds.',
      },
    },
    {
      id: 'ENDED',
      kind: 'close',
      label: 'Ended',
      meaning:
        'You (or the operator) pressed End. No push. A new episode cannot start until ≤24h / 1D windows go quiet first.',
      calc: 'Manual close. Restart gate stays on while any eligible window is still hot.',
      example:
        'Holding · 8% on NVDA. You click End. Rail shows Ended. Next tick does not open a new episode even if 5m is still +4%.',
      alerts: 'No push. Manual End is silent.',
      pushes: false,
      alertExample: null,
    },
    {
      id: 'EXPIRED',
      kind: 'close',
      label: 'Expired',
      meaning:
        'No meaningful new extreme for too long outside regular cash hours (pre/post, or 24/7 assets). During regular hours equities stay open until Market close instead.',
      calc: `No new extreme of ≥ ${progressPp.toFixed(1)} pp for ${expireMin} minutes — skipped while equities are in REGULAR session.`,
      example:
        'After-hours: peak was +5.2% at 16:30. By 17:35 the live move is still +5.3% (only +0.1 pp). Clock ran out → Expired. Mid-day REGULAR would not expire this way.',
      alerts: 'No push. Quiet cool-off only.',
      pushes: false,
      alertExample: null,
    },
    {
      id: 'REVERSED',
      kind: 'close',
      label: 'Reversed',
      meaning: 'Close reason for the old episode after a reversal (see Reversal above).',
      calc: 'Same erase + opposite-threshold rule. Old row is Reversed; new row is Started the other way.',
      example:
        'UP #041 → Reversed at $99.20. DOWN #042 → Started on the same tick.',
      alerts:
        'The push already fired on Reversal (live). This close label itself does not send a second alert.',
      pushes: false,
      alertExample: {
        title: 'NVDA reverses lower',
        body: 'Earlier gains have been erased as downside momentum builds.',
      },
    },
    {
      id: 'CLOSED_AT_MARKET_CLOSE',
      kind: 'close',
      label: 'Market close',
      meaning:
        'Primary end for equity/index episodes that ran through regular hours: cash session closes → silent archive. Crypto / FX / commodities do not hard-close on the US equity close.',
      calc: 'marketSession = CLOSED (or force close) and asset class = equity.',
      example:
        'AAPL UP Holding all afternoon with no new extreme. At 16:00 ET cash tape closes → Market close (not Expired). Gold or BTC stays open.',
      alerts: 'No push. Session housekeeping only.',
      pushes: false,
      alertExample: null,
    },
    {
      id: 'WINDOW_OUT_OF_SCOPE',
      kind: 'close',
      label: 'Out of scope',
      meaning:
        'Active events only use ≤24h windows and 1D (vs previous close). Longer cards (30h, 1w, 10d, …) still blink, but they cannot keep an episode.',
      calc: 'detectedWindow is not ≤24h and not day / 1D.',
      example:
        'A leftover episode tagged 1w is closed as Out of scope. The 1w card can still blink if the move is hot.',
      alerts: 'No push. Cleanup only.',
      pushes: false,
      alertExample: null,
    },
  ]

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
        title="Episode status guide"
        aria-label="Episode status guide"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        <Info className="size-3.5" strokeWidth={1.75} />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(88svh,44rem)] max-h-[88svh] max-w-lg flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-3 pr-12 text-left">
            <DialogTitle>Episode status guide</DialogTitle>
            <DialogDescription>
              Full surge → fade → comeback story, when we push, and what shows
              on the Recent events timeline.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <div className="space-y-4">
              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">
                  Full lifecycle (surge → fade → comeback)
                </p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                  <li>
                    <span className="font-medium text-foreground">Started</span>{' '}
                    → research + start push
                  </li>
                  <li>
                    <span className="font-medium text-foreground">
                      Accelerating
                    </span>{' '}
                    → +{accelPp.toFixed(1)} pp past last notified (first-leg
                    surge)
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Holding</span> /{' '}
                    <span className="font-medium text-foreground">Weakening</span>{' '}
                    → silent (timeline state only)
                  </li>
                  <li>
                    <span className="font-medium text-foreground">
                      Strongly weakening
                    </span>{' '}
                    at ≥{pctPoints(strong)} giveback →{' '}
                    <span className="font-medium text-foreground">push</span>{' '}
                    (“has given back 60%…”). Remaining move becomes the{' '}
                    <span className="font-medium text-foreground">
                      recovery anchor
                    </span>
                    .
                  </li>
                  <li>
                    Small green ticks after that (e.g. +4.0% → +4.5% → +5.2%) →{' '}
                    <span className="font-medium text-foreground">
                      silent recovery
                    </span>
                    . No Re-accelerating push.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">
                      Re-accelerating
                    </span>{' '}
                    only when move is ≥{accelPp.toFixed(1)} pp above the
                    recovery anchor (e.g. +4% → +6%) →{' '}
                    <span className="font-medium text-foreground">push</span>{' '}
                    (“is accelerating again”). Cycle resets so a later 60% fade
                    can alert again.
                  </li>
                  <li>
                    Further +{accelPp.toFixed(1)} pp →{' '}
                    <span className="font-medium text-foreground">
                      Accelerating
                    </span>{' '}
                    (“extends its recovery”).
                  </li>
                </ol>
                <p className="mt-2 text-[11px] leading-snug">
                  Timeline (Recent events) shows each of these as its own row:
                  Started, Accelerating, Holding / Weakening, Strong giveback,
                  Re-accelerating, Alert sent, etc. Silent recovery ticks do not
                  spam new rows.
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">When we alert you</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  <li>
                    <span className="font-medium text-foreground">Started</span>{' '}
                    — after Perplexity finds a likely driver.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">
                      Accelerating
                    </span>{' '}
                    — ≥ {accelPp.toFixed(1)} pp past last notified (first-leg or
                    “extends recovery” after a comeback).
                  </li>
                  <li>
                    <span className="font-medium text-foreground">
                      Strong giveback
                    </span>{' '}
                    — giveback first hits ≥ {pctPoints(strong)} in the current
                    weakening cycle (not permanent for the whole episode).
                  </li>
                  <li>
                    <span className="font-medium text-foreground">
                      Re-accelerating (comeback)
                    </span>{' '}
                    — only the first +{accelPp.toFixed(1)} pp recovery after a
                    strong fade. Small ticks stay silent.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">Reversal</span>{' '}
                    — original move erased + opposite threshold hit.
                  </li>
                  <li>
                    Holding, Weakening, silent recovery, End, Expire, market
                    close →{' '}
                    <span className="font-medium text-foreground">no push</span>.
                  </li>
                </ul>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
                <p className="font-medium text-foreground">Giveback %</p>
                <p className="mt-1">
                  UP: (peak − live) ÷ (peak − reference) × 100. DOWN: (live −
                  trough) ÷ (reference − trough) × 100. Holding below{' '}
                  {pctPoints(weak)}, Weakening at {pctPoints(weak)}, Strongly
                  weakening at {pctPoints(strong)}.
                </p>
              </div>
              {(['live', 'close'] as const).map((kind) => (
                <div key={kind} className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {kind === 'live' ? 'Live states' : 'Close statuses'}
                  </p>
                  {items
                    .filter((item) => item.kind === kind)
                    .map((item) => {
                      const isOpen = expanded === item.id
                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-border/70 bg-background"
                        >
                          <button
                            type="button"
                            className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left"
                            onClick={() =>
                              setExpanded((cur) =>
                                cur === item.id ? null : item.id,
                              )
                            }
                            aria-expanded={isOpen}
                          >
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[13px] font-semibold">
                                  {item.label}
                                </span>
                                <span
                                  className={cn(
                                    'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                                    item.pushes
                                      ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                                      : 'bg-muted text-muted-foreground',
                                  )}
                                >
                                  {item.pushes ? 'Pushes' : 'Silent'}
                                </span>
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                                {item.meaning}
                              </span>
                            </span>
                            {isOpen ? (
                              <ChevronUp className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                            )}
                          </button>
                          {isOpen ? (
                            <div className="space-y-2.5 border-t border-border/60 px-3 py-2.5 text-[12px] leading-relaxed">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  How it is calculated
                                </p>
                                <p className="mt-0.5 text-foreground/90">
                                  {item.calc}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  When we alert
                                </p>
                                <p className="mt-0.5 text-foreground/90">
                                  {item.alerts}
                                </p>
                              </div>
                              {item.alertExample ? (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Example alert
                                  </p>
                                  <div className="mt-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2">
                                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Title
                                    </p>
                                    <p className="mt-0.5 text-[12px] font-semibold leading-snug text-foreground">
                                      {item.alertExample.title}
                                    </p>
                                    <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Body
                                    </p>
                                    <p className="mt-0.5 text-[12px] leading-snug text-foreground/90">
                                      {item.alertExample.body}
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Example alert
                                  </p>
                                  <p className="mt-0.5 text-[11px] italic text-muted-foreground">
                                    No notification for this status.
                                  </p>
                                </div>
                              )}
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Price / state example
                                </p>
                                <p className="mt-0.5 rounded-lg bg-muted/50 px-2.5 py-2 font-mono text-[11px] leading-snug text-foreground/90">
                                  {item.example}
                                </p>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function EpisodeDashboard({
  appSwitcher: _appSwitcher,
  onOpenInTrigger,
  onOpenTriggerApp,
  onOpenNineAmApp: _onOpenNineAmApp,
  theme = 'light',
  onToggleTheme,
}: {
  /** @deprecated center app pills removed — use settings menu props */
  appSwitcher?: ReactNode
  /** Open this ticker inside Trigger share desk (parent navigates + selects stock) */
  onOpenInTrigger?: (
    ticker: string,
    opts?: {
      label?: string
      share?: boolean
      /** scrape = Firecrawl+Gemini then share; direct = share only; research = Perplexity composer */
      mode?: 'scrape' | 'direct' | 'research'
      move?: number | null
      /** End / peak (or live) price for share-card price line */
      price?: number | null
      /** Reference / start price — share card shows from → to */
      priceFrom?: number | null
      window?: string | null
      exactLabel?: string | null
      exactMinutes?: number | null
      direction?: string | null
      kind?: 'peak' | 'now' | 'sofar' | string
      /** Alert heading for direct / sofar share session line */
      headline?: string | null
      /** Likely driver for direct share reason body */
      likelyDriver?: string | null
    },
  ) => void
  /** Switch to Trigger desk */
  onOpenTriggerApp?: () => void
  /** Switch to 9AM desk (optional; used when Episode Dashboard is embedded) */
  onOpenNineAmApp?: () => void
  theme?: string
  onToggleTheme?: () => void
} = {}) {
  void _appSwitcher
  void _onOpenNineAmApp
  const [watchlist, setWatchlist] = useState<WatchTab[]>(() => loadWatchlist())
  const [assetClassTab, setAssetClassTab] = useState<AssetClassTabId | null>(
    () => loadAssetClassFilter(),
  )
  const [, setSavedTickers] = useState<WatchTab[]>([])
  /**
   * App-monitored tickers from device_monitor (enabled subscribers).
   * Categorized client-side into Stocks / ETFs / Indices / Forex / Crypto / Commodities.
   * Hydrate from local cache first so asset lists paint immediately.
   */
  const [monitoredByClass, setMonitoredByClass] = useState<
    Partial<Record<AssetClassTabId, WatchTab[]>>
  >(() => loadMonitoredByClassCache()?.byClass || {})
  const [monitoredLoading, setMonitoredLoading] = useState(false)
  const monitoredLoadGenRef = useRef(0)
  const [monitoredSourceTable, setMonitoredSourceTable] = useState<string | null>(
    () => loadMonitoredByClassCache()?.table || null,
  )
  const [, setMonitoredCounts] = useState<Partial<Record<string, number>>>(
    () => loadMonitoredByClassCache()?.counts || {},
  )
  const [activeTicker, setActiveTicker] = useState(() => {
    const list = loadWatchlist()
    return loadActiveTicker(list)
  })
  /** Select a watch tab and remember it (Silver / SpaceX / … survive refresh). */
  const selectTicker = useCallback((ticker: string) => {
    const t = String(ticker || '').trim().toUpperCase()
    setActiveTicker((prev) => {
      if (String(prev || '').toUpperCase() !== t) {
        setDeskEpisodeFocus(null)
      }
      return t
    })
    saveActiveTicker(t)
  }, [])

  const clearTickerSelection = useCallback(() => {
    setActiveTicker('')
    saveActiveTicker('')
    setStatus(null)
    setDeskEpisodeFocus(null)
  }, [])

  /** Home desk is selected until an asset-class tab is chosen. */
  const leftShowsActiveEpisodes = assetClassTab == null
  /** Asset-class selections use the middle column as their ticker list. */
  const showLegacyLeftRail = !leftShowsActiveEpisodes
  /** The ticker list now has its own column, so the duplicate top strip stays off. */
  const showCompactMarketStrip = false

  useEffect(() => {
    let cancelled = false
    const ac = new AbortController()
    void fetchYahooSavedTickers(ac.signal)
      .then((body) => {
        if (cancelled) return
        const items = (body.items || [])
          .map((row) => {
            const ticker = normalizeWatchTicker(row.ticker)
            if (!ticker) return null
            return {
              ticker,
              label: String(row.label || ticker).trim() || ticker,
              assetClass: row.assetClass || detectAssetClass(ticker),
            } as WatchTab
          })
          .filter((row): row is WatchTab => Boolean(row))
        setSavedTickers(items)
      })
      .catch(() => {
        if (!cancelled) setSavedTickers([])
      })
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [])

  const loadMonitoredTickers = useCallback(async (signal?: AbortSignal) => {
    const gen = ++monitoredLoadGenRef.current
    setMonitoredLoading(true)
    try {
      const body = await fetchMomentumMonitoredTickers({
        app: 'trigger',
        signal,
      })
      if (signal?.aborted || gen !== monitoredLoadGenRef.current) return
      setMonitoredSourceTable(body.table || 'device_monitor')
      if (body.byClass) setMonitoredCounts(body.byClass)
      const buckets: Partial<Record<AssetClassTabId, WatchTab[]>> = {
        equity: [],
        etf: [],
        index: [],
        forex: [],
        crypto: [],
        commodity: [],
      }
      for (const row of body.items || []) {
        const ticker = normalizeWatchTicker(row.ticker)
        if (!ticker) continue
        const rawCls = String(row.assetClass || detectAssetClass(ticker))
          .trim()
          .toLowerCase()
        const cls = (
          rawCls === 'etf' || rawCls === 'etfs' || rawCls === 'fund'
            ? 'etf'
            : buckets[rawCls as AssetClassTabId]
              ? rawCls
              : detectAssetClass(ticker)
        ) as AssetClassTabId
        const key: AssetClassTabId = buckets[cls] ? cls : 'equity'
        const list = buckets[key] || (buckets[key] = [])
        list.push({
          ticker,
          label: String(row.label || ticker).trim() || ticker,
          assetClass: key,
          subscriberCount:
            row.subscriberCount != null &&
            Number.isFinite(Number(row.subscriberCount))
              ? Number(row.subscriberCount)
              : null,
        })
      }
      setMonitoredByClass(buckets)
      saveMonitoredByClassCache({
        byClass: buckets,
        table: body.table || 'device_monitor',
        counts: body.byClass || {},
      })
    } catch {
      /* aborted or network — keep previous / cached buckets */
    } finally {
      if (gen === monitoredLoadGenRef.current) setMonitoredLoading(false)
    }
  }, [])

  // Desk + asset tabs: load monitored tickers (device_monitor)
  useEffect(() => {
    const ac = new AbortController()
    void loadMonitoredTickers(ac.signal)
    return () => {
      ac.abort()
    }
  }, [assetClassTab, loadMonitoredTickers])

  const [entityListPrefs, setEntityListPrefs] = useState<EntityListPrefs>(
    () => loadEntityListPrefs(),
  )
  const [entityListSearchOpen, setEntityListSearchOpen] = useState(false)
  const [entityListQuery, setEntityListQuery] = useState('')
  const entityListSearchRef = useRef<HTMLInputElement | null>(null)
  /** Live Yahoo matches shown directly below the active asset-class search. */
  const [entityYahooResults, setEntityYahooResults] = useState<
    YahooSearchResult[]
  >([])
  const [entityYahooLoading, setEntityYahooLoading] = useState(false)
  const [entityYahooError, setEntityYahooError] = useState<string | null>(null)
  const [entityYahooHighlight, setEntityYahooHighlight] = useState(0)

  const updateEntityListPrefs = useCallback(
    (patch: Partial<EntityListPrefs>) => {
      setEntityListPrefs((prev) => {
        const next = { ...prev, ...patch }
        saveEntityListPrefs(next)
        return next
      })
    },
    [],
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
  /** 3rd-column mini chart → expanded chart under the quote card */
  const [railChartExpanded, setRailChartExpanded] = useState(false)
  // Three-column desk always starts with its detail column visible.
  const [logCollapsed, setLogCollapsed] = useState(false)
  const logTopRef = useRef<HTMLDivElement | null>(null)
  const prevLogLen = useRef(0)
  /** Local clock for next-poll countdown (engine default 60s). */
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [thresholdDraft, setThresholdDraft] = useState<Record<string, string>>(
    () => loadLocalThresholdDraft('equity'),
  )
  /**
   * Asset class being edited inside Thresholds & Episode rules.
   * Independent of the left-rail market filter so home (Active episodes)
   * can still open settings and switch Stocks / Crypto / … tabs.
   */
  const [settingsAssetClass, setSettingsAssetClass] =
    useState<AssetClassTabId>('equity')
  /** Episode rules draft (accel / giveback % / inactivity) — separate from window thresholds */
  const [policyDraft, setPolicyDraft] = useState<Record<string, string>>({})
  const policyDraftRef = useRef(policyDraft)
  policyDraftRef.current = policyDraft
  const policyAutosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [policySaveState, setPolicySaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [policySaving, setPolicySaving] = useState(false)
  const [thresholdSaving, setThresholdSaving] = useState(false)
  /** Edit episode popup (Recent events rail) */
  const [episodeEditOpen, setEpisodeEditOpen] = useState(false)
  const [episodeEditDraft, setEpisodeEditDraft] =
    useState<EpisodeEditDraft | null>(null)
  const [episodeEditSaving, setEpisodeEditSaving] = useState(false)
  const [episodeEditError, setEpisodeEditError] = useState('')
  const [episodeEventDeletingIdx, setEpisodeEventDeletingIdx] = useState<
    number | null
  >(null)
  /** idle | saving | saved | error — auto-save feedback in settings rail */
  const [thresholdSaveState, setThresholdSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const thresholdAutosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const thresholdDraftRef = useRef(thresholdDraft)
  thresholdDraftRef.current = thresholdDraft
  /** Episode card expand state (default: active open, others closed) */
  const [episodeExpanded, setEpisodeExpanded] = useState<
    Record<string, boolean>
  >({})
  /** Activity log detail dialog */
  const [logDetail, setLogDetail] = useState<ActivityLog | null>(null)
  /** Which log message rows are expanded past 2 lines */
  const [logMsgExpanded, setLogMsgExpanded] = useState<Record<string, boolean>>(
    {},
  )
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
  /** Right rail content: activity log, subscribers, recent events, thresholds, all active episodes, or Yahoo chart */
  const [rightRailMode, setRightRailMode] = useState<
    'logs' | 'subscribers' | 'events' | 'settings' | 'activeEpisodes' | 'yahoo'
  >('yahoo')
  /** Main panel under chart: rolling-return table vs active-episode story */
  const [mainPanelTab, setMainPanelTab] = useState<'returns' | 'episode'>(
    'episode',
  )
  /** All ACTIVE episodes across tickers (settings → Active episodes rail) */
  const [activeEpisodesList, setActiveEpisodesList] = useState<
    ActiveEpisodeRow[]
  >(() => readEpisodeListCache()?.activeEpisodes || [])
  const [activeEpisodesLoading, setActiveEpisodesLoading] = useState(false)
  const [, setActiveEpisodesUpdatingFromSupabase] =
    useState(false)
  const [activeEpisodesError, setActiveEpisodesError] = useState('')
  /** Expanded cards in the Active episodes rail (by episodeId or ticker) */
  const [activeEpisodeExpanded, setActiveEpisodeExpanded] = useState<
    Record<string, boolean>
  >({})
  /**
   * Episodes-first desk: null = center shows all episode history;
   * set when user clicks a left-rail active episode → center detail + Yahoo rail.
   */
  const [deskEpisodeFocus, setDeskEpisodeFocus] =
    useState<ActiveEpisodeRow | null>(null)
  /** Left desk tab while on Active-episodes home (assetClassTab == null). */
  const [deskLeftTab, setDeskLeftTab] = useState<
    'episodes' | 'users' | 'bulletins'
  >('episodes')
  const [deskDevices, setDeskDevices] = useState<DeskDevice[]>([])
  const [deskDevicesLoading, setDeskDevicesLoading] = useState(false)
  const [deskDevicesError, setDeskDevicesError] = useState('')
  const [deskUserFocus, setDeskUserFocus] = useState<DeskDevice | null>(null)
  const [, setDeskUserActivities] = useState<DeskUserActivity[]>([])
  const [, setDeskUserActivitiesLoading] = useState(false)
  type DeskMarketBulletin = {
    id: string
    market: 'us' | 'india' | string
    slot: 'OPEN' | 'CLOSE' | string
    session_date: string
    timezone?: string | null
    title: string
    body: string
    body_source?: string | null
    yahoo_market_state?: string | null
    probe_symbol?: string | null
    open_price?: number | null
    close_or_last_price?: number | null
    day_change_percent?: number | null
    previous_close?: number | null
    quote_snapshot?: Record<string, unknown> | null
    perplexity_meta?: Record<string, unknown> | null
    push_sent_ok?: number | null
    push_sent_failed?: number | null
    recipient_count?: number | null
    claimed_at?: string | null
    sent_at?: string | null
    created_at?: string | null
  }
  const [deskBulletins, setDeskBulletins] = useState<DeskMarketBulletin[]>([])
  const [readDeskBulletinIds, setReadDeskBulletinIds] = useState<Set<string>>(
    () => loadReadMarketBulletinIds(),
  )
  const [deskBulletinsLoading, setDeskBulletinsLoading] = useState(false)
  const [deskBulletinsError, setDeskBulletinsError] = useState('')
  const [deskBulletinFocus, setDeskBulletinFocus] =
    useState<DeskMarketBulletin | null>(null)
  const [deskBulletinPromptOpen, setDeskBulletinPromptOpen] = useState(false)
  const [allEpisodesList, setAllEpisodesList] = useState<ActiveEpisodeRow[]>(
    () => readEpisodeListCache()?.episodes || [],
  )
  const [allEpisodesLoading, setAllEpisodesLoading] = useState(
    () => !(readEpisodeListCache()?.episodes || []).length,
  )
  const [allEpisodesUpdatingFromSupabase, setAllEpisodesUpdatingFromSupabase] =
    useState(false)
  const [tickerUpdatingFromSupabase, setTickerUpdatingFromSupabase] =
    useState(false)
  const [allEpisodesLoadingMore, setAllEpisodesLoadingMore] = useState(false)
  const [allEpisodesError, setAllEpisodesError] = useState('')
  const [allEpisodesHasMore, setAllEpisodesHasMore] = useState(
    () => Boolean(readEpisodeListCache()?.hasMore),
  )
  const [allEpisodesTotal, setAllEpisodesTotal] = useState(
    () => readEpisodeListCache()?.total || 0,
  )
  const [allEpisodesNextOffset, setAllEpisodesNextOffset] = useState<
    number | null
  >(() => readEpisodeListCache()?.nextOffset ?? null)
  const [, setAllEpisodesFetchedAt] = useState(
    () => readEpisodeListCache()?.at || '',
  )
  /** All episodes ticker filter (client-side). */
  const [allEpisodesSearchOpen, setAllEpisodesSearchOpen] = useState(false)
  const [allEpisodesQuery, setAllEpisodesQuery] = useState('')
  /** All-episodes list sort + filters (near search / refresh). */
  const [allEpisodesSortKey, setAllEpisodesSortKey] =
    useState<AllEpisodesSortKey>('started')
  const [allEpisodesSortDir, setAllEpisodesSortDir] = useState<'asc' | 'desc'>(
    'desc',
  )
  const [allEpisodesLiveOnly, setAllEpisodesLiveOnly] = useState(false)
  const [allEpisodesEndedOnly, setAllEpisodesEndedOnly] = useState(false)
  /** Detail popup for timeline Alert / Perplexity / state measure explain */
  const [timelineDetail, setTimelineDetail] =
    useState<TimelineDetailState | null>(null)
  const [marketStatusOpen, setMarketStatusOpen] = useState(false)
  const [marketStatusLoading, setMarketStatusLoading] = useState(false)
  const [marketStatusError, setMarketStatusError] = useState('')
  const [marketStatusRows, setMarketStatusRows] = useState<MarketStatusRow[]>(
    [],
  )
  const [marketStatusFooter, setMarketStatusFooter] = useState('')
  const marketStatusHoverCloseRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const [navSettingsOpen, setNavSettingsOpen] = useState(false)
  const [perplexityPromptsOpen, setPerplexityPromptsOpen] = useState(false)
  const navSettingsCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openNavSettings = useCallback(() => {
    if (navSettingsCloseRef.current) {
      clearTimeout(navSettingsCloseRef.current)
      navSettingsCloseRef.current = null
    }
    setNavSettingsOpen(true)
  }, [])

  const scheduleNavSettingsClose = useCallback(() => {
    if (navSettingsCloseRef.current) {
      clearTimeout(navSettingsCloseRef.current)
    }
    navSettingsCloseRef.current = setTimeout(() => {
      setNavSettingsOpen(false)
      navSettingsCloseRef.current = null
    }, 300)
  }, [])

  useEffect(() => {
    return () => {
      if (navSettingsCloseRef.current) {
        clearTimeout(navSettingsCloseRef.current)
      }
    }
  }, [])

  const loadMarketStatusPopup = useCallback(async (opts?: { open?: boolean }) => {
    setMarketStatusLoading(true)
    setMarketStatusError('')
    try {
      const res = await deskFetch('/api/momentum/market-status')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setMarketStatusRows(Array.isArray(body.markets) ? body.markets : [])
      setMarketStatusFooter(String(body.footer || ''))
      if (opts?.open) setMarketStatusOpen(true)
    } catch (err) {
      setMarketStatusError(
        err instanceof Error ? err.message : 'Market status failed',
      )
      if (opts?.open) setMarketStatusOpen(true)
    } finally {
      setMarketStatusLoading(false)
    }
  }, [])

  const cancelMarketStatusHoverClose = useCallback(() => {
    if (marketStatusHoverCloseRef.current) {
      clearTimeout(marketStatusHoverCloseRef.current)
      marketStatusHoverCloseRef.current = null
    }
  }, [])

  const openMarketStatusFromHover = useCallback(() => {
    cancelMarketStatusHoverClose()
    setMarketStatusOpen(true)
    // Refresh quietly when opening (or if we have no rows yet)
    void loadMarketStatusPopup({ open: false })
  }, [cancelMarketStatusHoverClose, loadMarketStatusPopup])

  /** Leave trigger/panel → close shortly (gap so pointer can enter the panel). */
  const scheduleMarketStatusHoverClose = useCallback(() => {
    cancelMarketStatusHoverClose()
    marketStatusHoverCloseRef.current = setTimeout(() => {
      setMarketStatusOpen(false)
      marketStatusHoverCloseRef.current = null
    }, 500)
  }, [cancelMarketStatusHoverClose])

  // Prefetch session data on load — do NOT auto-open the popup
  useEffect(() => {
    void loadMarketStatusPopup({ open: false })
  }, [loadMarketStatusPopup])

  useEffect(() => {
    return () => {
      if (marketStatusHoverCloseRef.current) {
        clearTimeout(marketStatusHoverCloseRef.current)
      }
    }
  }, [])
  /** Manual end / exit of the live episode from Recent Events */
  const [endingEpisode, setEndingEpisode] = useState(false)
  /** When ending from the Active episodes rail — which ticker is in-flight. */
  const [endingEpisodeTicker, setEndingEpisodeTicker] = useState<string | null>(
    null,
  )
  const [deletingEpisodeId, setDeletingEpisodeId] = useState<string | null>(
    null,
  )
  /** Resizable right column width (px) — restored from last user drag */
  const [rightRailWidth, setRightRailWidth] = useState(loadRightRailWidth)
  const [navColWidth, setNavColWidth] = useState(loadNavColWidth)
  const [listColWidth, setListColWidth] = useState(loadListColWidth)
  const navColDragRef = useRef<{ startX: number; startW: number } | null>(null)
  const listColDragRef = useRef<{ startX: number; startW: number } | null>(null)
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
  const [, setAlertPromptOpen] = useState(false)
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
  const [, setAlertResearchSteps] = useState<ResearchStep[]>([])
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
      episode_id: status?.episode?.episodeId || deskEpisodeFocus?.episodeId || null,
    }
  }

  /**
   * Left-rail entity list for an asset class:
   * device_monitor ∪ momentum episodes / episode events.
   * No Yahoo Most Active / Gainers / research-history lists.
   */
  const displayedEntities = useMemo(() => {
    if (assetClassTab == null) return []
    const byTicker = new Map<string, WatchTab>()

    const upsert = (tab: WatchTab) => {
      const ticker = normalizeWatchTicker(tab.ticker)
      if (!ticker) return
      if (tabAssetClass({ ...tab, ticker }) !== assetClassTab) return
      const prev = byTicker.get(ticker)
      if (!prev) {
        byTicker.set(ticker, {
          ...tab,
          ticker,
          label: String(tab.label || ticker).trim() || ticker,
          assetClass: assetClassTab,
        })
        return
      }
      const nextCount =
        tab.subscriberCount != null && Number.isFinite(Number(tab.subscriberCount))
          ? Number(tab.subscriberCount)
          : null
      const prevCount =
        prev.subscriberCount != null && Number.isFinite(Number(prev.subscriberCount))
          ? Number(prev.subscriberCount)
          : null
      byTicker.set(ticker, {
        ...prev,
        label:
          (tab.label && tab.label !== ticker ? tab.label : prev.label) || ticker,
        subscriberCount:
          nextCount != null
            ? prevCount != null
              ? Math.max(prevCount, nextCount)
              : nextCount
            : prevCount,
        assetClass: assetClassTab,
      })
    }

    for (const row of monitoredByClass[assetClassTab] || []) upsert(row)

    for (const row of activeEpisodesList) {
      const ticker = normalizeWatchTicker(row.ticker)
      if (!ticker) continue
      upsert({
        ticker,
        label: ticker,
        assetClass: detectAssetClass(ticker),
      })
    }
    for (const row of allEpisodesList) {
      const ticker = normalizeWatchTicker(row.ticker)
      if (!ticker) continue
      upsert({
        ticker,
        label: ticker,
        assetClass: detectAssetClass(ticker),
      })
    }

    return [...byTicker.values()].sort((a, b) =>
      a.ticker.localeCompare(b.ticker),
    )
  }, [
    assetClassTab,
    monitoredByClass,
    activeEpisodesList,
    allEpisodesList,
  ])

  const tickerHasActiveEpisode = useCallback(
    (ticker: string) => {
      const t = String(ticker || '')
        .trim()
        .toUpperCase()
      if (!t) return false
      if (episodeByTicker[t] || episodeByTicker[ticker]) return true
      return activeEpisodesList.some(
        (row) =>
          String(row.ticker || '')
            .trim()
            .toUpperCase() === t,
      )
    },
    [episodeByTicker, activeEpisodesList],
  )

  /** Apply show / momentum / search / sort prefs on the asset-class entity list. */
  const filteredDisplayedEntities = useMemo(() => {
    let list = displayedEntities

    if (entityListPrefs.show === 'subscribers') {
      list = list.filter((tab) => {
        const n =
          tab.subscriberCount != null &&
          Number.isFinite(Number(tab.subscriberCount))
            ? Math.max(0, Math.floor(Number(tab.subscriberCount)))
            : 0
        return n > 0
      })
    }

    if (entityListPrefs.momentum === 'active') {
      list = list.filter((tab) => tickerHasActiveEpisode(tab.ticker))
    } else if (entityListPrefs.momentum === 'inactive') {
      list = list.filter((tab) => !tickerHasActiveEpisode(tab.ticker))
    }

    const q = entityListQuery.trim().toUpperCase()
    if (q) {
      list = list.filter((tab) => {
        const ticker = String(tab.ticker || '')
          .trim()
          .toUpperCase()
        const label = String(tab.label || '')
          .trim()
          .toUpperCase()
        return ticker.includes(q) || label.includes(q)
      })
    }

    const ranked = [...list]
    if (entityListPrefs.sort === 'subscribers_desc') {
      ranked.sort((a, b) => {
        const ac =
          a.subscriberCount != null && Number.isFinite(Number(a.subscriberCount))
            ? Number(a.subscriberCount)
            : 0
        const bc =
          b.subscriberCount != null && Number.isFinite(Number(b.subscriberCount))
            ? Number(b.subscriberCount)
            : 0
        return bc - ac || a.ticker.localeCompare(b.ticker)
      })
    } else if (entityListPrefs.sort === 'subscribers_asc') {
      ranked.sort((a, b) => {
        const ac =
          a.subscriberCount != null && Number.isFinite(Number(a.subscriberCount))
            ? Number(a.subscriberCount)
            : 0
        const bc =
          b.subscriberCount != null && Number.isFinite(Number(b.subscriberCount))
            ? Number(b.subscriberCount)
            : 0
        return ac - bc || a.ticker.localeCompare(b.ticker)
      })
    } else {
      ranked.sort((a, b) => a.ticker.localeCompare(b.ticker))
    }
    return ranked
  }, [
    displayedEntities,
    entityListPrefs,
    entityListQuery,
    tickerHasActiveEpisode,
  ])

  /** Asset-class list hydrate from Supabase (device monitor). */
  const entityListUpdatingFromSupabase =
    assetClassTab != null && monitoredLoading

  const assetClassLabel =
    ASSET_CLASS_TABS.find((t) => t.id === assetClassTab)?.label || 'Stocks'
  const entityFilterActive =
    entityListPrefs.show !== DEFAULT_ENTITY_LIST_PREFS.show ||
    entityListPrefs.momentum !== DEFAULT_ENTITY_LIST_PREFS.momentum ||
    entityListPrefs.sort !== DEFAULT_ENTITY_LIST_PREFS.sort ||
    entityListQuery.trim().length > 0

  useEffect(() => {
    if (!entityListSearchOpen) return
    const id = window.setTimeout(() => {
      entityListSearchRef.current?.focus()
      entityListSearchRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [entityListSearchOpen])

  // The sidebar search used to filter only monitored/local rows. Search Yahoo
  // as well, then keep only results belonging to the selected asset class.
  useEffect(() => {
    const q = entityListQuery.trim()
    if (!entityListSearchOpen || !assetClassTab || !q) {
      setEntityYahooResults([])
      setEntityYahooLoading(false)
      setEntityYahooError(null)
      setEntityYahooHighlight(0)
      return
    }

    let cancelled = false
    setEntityYahooResults([])
    setEntityYahooLoading(true)
    setEntityYahooError(null)

    const timer = window.setTimeout(() => {
      searchYahooSaved(q)
        .then((body) => {
          if (cancelled) return
          const seen = new Set<string>()
          const rows = (body.tickers || [])
            .filter((row) => {
              const ticker = normalizeWatchTicker(row.ticker)
              if (!ticker || seen.has(ticker)) return false
              if (assetClassFromSearch(row) !== assetClassTab) return false
              seen.add(ticker)
              return true
            })
            .slice(0, 10)
          setEntityYahooResults(rows)
          setEntityYahooHighlight(0)
          setEntityYahooError(null)
        })
        .catch((err) => {
          if (cancelled) return
          setEntityYahooResults([])
          setEntityYahooError(
            err instanceof Error
              ? err.message
              : typeof err === 'string'
                ? err
                : 'Yahoo Finance search failed',
          )
        })
        .finally(() => {
          if (!cancelled) setEntityYahooLoading(false)
        })
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [assetClassTab, entityListQuery, entityListSearchOpen])

  const episodeFallbackTab = useMemo((): WatchTab | null => {
    const t = String(activeTicker || '')
      .trim()
      .toUpperCase()
    if (!t) return null
    const fromEp = activeEpisodesList.find(
      (row) => String(row.ticker || '').toUpperCase() === t,
    )
    const label =
      watchlist.find((w) => w.ticker.toUpperCase() === t)?.label ||
      fromEp?.ticker ||
      t
    return {
      ticker: t,
      label: String(label || t),
      assetClass: detectAssetClass(t),
    }
  }, [activeTicker, activeEpisodesList, watchlist])

  /** Explicit pick only — never invent a default stock for the detail column. */
  const activeTab = useMemo((): WatchTab | null => {
    const t = String(activeTicker || '')
      .trim()
      .toUpperCase()
    if (!t) return null
    return (
      displayedEntities.find((row) => row.ticker.toUpperCase() === t) ||
      watchlist.find((row) => row.ticker.toUpperCase() === t) ||
      episodeFallbackTab ||
      null
    )
  }, [activeTicker, displayedEntities, watchlist, episodeFallbackTab])
  const displayTicker = activeTab?.ticker || ''
  const hasSelectedTicker = Boolean(displayTicker)
  /** Right detail rail: home desk always; asset tabs only after an episode is clicked. */
  const showDetailRightRail =
    leftShowsActiveEpisodes ||
    (showLegacyLeftRail && deskEpisodeFocus != null)

  // Collapse expanded chart when switching entities
  useEffect(() => {
    setChartExpanded(false)
  }, [displayTicker])

  /**
   * Ticker pick → Rolling returns by default; flip to Episodes once we know
   * this ticker has a live ≤24h/1D active episode (once per selection).
   */
  const autoMainTabTickerRef = useRef('')
  useEffect(() => {
    if (!displayTicker) {
      autoMainTabTickerRef.current = ''
      return
    }
    // Optimistic default while status hydrates for the new ticker.
    autoMainTabTickerRef.current = ''
    setMainPanelTab('returns')
  }, [displayTicker])

  useEffect(() => {
    if (!displayTicker || !status) return
    const t = displayTicker.toUpperCase()
    if (String(status.ticker || '').toUpperCase() !== t) return
    if (autoMainTabTickerRef.current === t) return
    const ep = status.episode
    const st = String(ep?.status || 'ACTIVE').toUpperCase()
    const hasActive =
      Boolean(ep) &&
      st !== 'ENDED' &&
      st !== 'EXPIRED' &&
      st !== 'REVERSED' &&
      isIntradayOr24hEventWindow(ep?.detectedWindow)
    autoMainTabTickerRef.current = t
    setMainPanelTab(hasActive ? 'episode' : 'returns')
  }, [
    displayTicker,
    status?.ticker,
    status?.episode?.episodeId,
    status?.episode?.status,
    status?.episode?.detectedWindow,
  ])

  /**
   * Load Trigger devices subscribed to `ticker` (push-ready / enabled).
   * Same app + eligibility as watchlist subscriberCount (not Trigger+9AM merge).
   */
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
      // Match /api/momentum/monitored-tickers?app=trigger audience definition
      const app = 'trigger' as const
      const res = await deskFetch(
        `/api/notifications/devices?app=${encodeURIComponent(app)}&_=${Date.now()}`,
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || `Devices failed (${res.status})`)
      }
      const devices = (body.devices || []) as AlertDevice[]
      const seen = new Set<string>()
      const matched: AlertDevice[] = []
      for (const d of devices) {
        // Push-ready only: notifications on for this ticker (not off / stopped)
        if (d.enabled === false || d.subscription_status === 'off') continue
        const list = [
          ...(d.enabled_tickers || []),
          ...(d.tickers || []),
        ]
          .map((t) => String(t || '').toUpperCase())
          .filter(Boolean)
        if (!list.includes(sym)) continue
        // Dedupe by Expo token (same phone listed twice), else device_id
        const key = String(d.expo_push_token || d.device_id || '').trim()
        if (!key || seen.has(key)) continue
        seen.add(key)
        matched.push({ ...d, app_key: app })
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
    if (!displayTicker) return
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

  const selectAssetClassTab = useCallback(
    (id: string) => {
      if (!ASSET_CLASS_TABS.some((t) => t.id === id)) return
      const next = id as AssetClassTabId
      // Re-tap active tab → clear selection → back to all active episodes
      if (assetClassTab === next) {
        setAssetClassTab(null)
        saveAssetClassFilter(null)
        setDeskEpisodeFocus(null)
        setMainPanelTab('episode')
        setLogCollapsedPersist(false)
        return
      }
      setAssetClassTab(next)
      saveAssetClassFilter(next)
      setDeskEpisodeFocus(null)
      const inClass = [
        ...(monitoredByClass[next] || []),
        ...watchlist.filter((tab) => tabAssetClass(tab) === next),
      ]
      const stillActive =
        Boolean(activeTicker) &&
        inClass.some(
          (tab) => tab.ticker.toUpperCase() === activeTicker.toUpperCase(),
        )
      // Asset tabs never auto-pick a ticker — 3rd column stays empty until click.
      if (!stillActive) clearTickerSelection()
    },
    [
      assetClassTab,
      watchlist,
      monitoredByClass,
      activeTicker,
      clearTickerSelection,
      setLogCollapsedPersist,
    ],
  )

  const selectActiveEpisodeFromLeft = useCallback(
    (row: ActiveEpisodeRow) => {
      const ticker = String(row.ticker || '')
        .trim()
        .toUpperCase()
      if (!ticker) return
      setDeskLeftTab('episodes')
      setDeskUserFocus(null)
      setDeskBulletinFocus(null)
      selectTicker(ticker)
      setDeskEpisodeFocus(row)
      setRightRailMode('yahoo')
      setLogCollapsedPersist(false)
      setRailChartExpanded(false)
    },
    [selectTicker, setLogCollapsedPersist],
  )

  /** 4th-column symbol click → open that ticker inside Stocks/Crypto/… desk. */
  const openTickerInMarketSection = useCallback(
    (ticker: string) => {
      const t = String(ticker || '')
        .trim()
        .toUpperCase()
      if (!t) return
      const raw = detectAssetClass(t)
      const cls = (
        ASSET_CLASS_TABS.some((tab) => tab.id === raw)
          ? raw
          : tabAssetClass({ ticker: t, label: t, assetClass: raw })
      ) as AssetClassTabId
      const resolved = (
        ASSET_CLASS_TABS.some((tab) => tab.id === cls) ? cls : 'equity'
      ) as AssetClassTabId
      setDeskLeftTab('episodes')
      setDeskUserFocus(null)
      setDeskBulletinFocus(null)
      setDeskEpisodeFocus(null)
      setAssetClassTab(resolved)
      saveAssetClassFilter(resolved)
      selectTicker(t)
      setMainPanelTab('returns')
      setRightRailMode('yahoo')
      setLogCollapsedPersist(false)
      setRailChartExpanded(false)
      setChartExpanded(false)
    },
    [selectTicker, setLogCollapsedPersist],
  )

  const clearDeskEpisodeFocus = useCallback(() => {
    setDeskEpisodeFocus(null)
  }, [])

  const loadDeskDevices = useCallback(async () => {
    setDeskDevicesLoading(true)
    setDeskDevicesError('')
    try {
      const res = await deskFetch(
        `/api/notifications/devices?app=trigger&_=${Date.now()}`,
      )
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        devices?: DeskDevice[]
        error?: string
      }
      if (!res.ok) throw new Error(body.error || `Status ${res.status}`)
      const list = Array.isArray(body.devices) ? body.devices : []
      setDeskDevices(list)
      setDeskUserFocus((prev) => {
        if (!prev) return prev
        const key = deskDeviceKey(prev)
        return list.find((d) => deskDeviceKey(d) === key) || prev
      })
    } catch (err) {
      setDeskDevices([])
      setDeskDevicesError(
        err instanceof Error ? err.message : 'Failed to load users',
      )
    } finally {
      setDeskDevicesLoading(false)
    }
  }, [])

  const selectDeskUser = useCallback(
    (device: DeskDevice) => {
      setDeskUserFocus(device)
      setDeskEpisodeFocus(null)
      setDeskBulletinFocus(null)
      setRightRailMode('yahoo')
      setLogCollapsedPersist(false)
    },
    [setLogCollapsedPersist],
  )

  const loadDeskBulletins = useCallback(async () => {
    setDeskBulletinsLoading(true)
    setDeskBulletinsError('')
    try {
      const res = await deskFetch(
        `/api/momentum/market-bulletins?limit=40&_=${Date.now()}`,
      )
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        bulletins?: DeskMarketBulletin[]
        error?: string
      }
      if (!res.ok) throw new Error(body.error || `Status ${res.status}`)
      const list = Array.isArray(body.bulletins) ? body.bulletins : []
      setDeskBulletins(list)
      setDeskBulletinFocus((prev) => {
        if (!prev) return prev
        return list.find((b) => b.id === prev.id) || prev
      })
    } catch (err) {
      setDeskBulletins([])
      setDeskBulletinsError(
        err instanceof Error ? err.message : 'Failed to load market bulletins',
      )
    } finally {
      setDeskBulletinsLoading(false)
    }
  }, [])

  const selectDeskBulletin = useCallback(
    (row: DeskMarketBulletin) => {
      const id = String(row.id || '').trim()
      if (id) {
        setReadDeskBulletinIds((prev) => {
          if (prev.has(id)) return prev
          const next = new Set(prev)
          next.add(id)
          saveReadMarketBulletinIds(next)
          return next
        })
      }
      setDeskBulletinFocus(row)
      setDeskUserFocus(null)
      setDeskEpisodeFocus(null)
      setRightRailMode('yahoo')
      setLogCollapsedPersist(false)
    },
    [setLogCollapsedPersist],
  )

  const unreadDeskBulletinCount = useMemo(
    () =>
      deskBulletins.reduce((count, row) => {
        const id = String(row.id || '').trim()
        return id && !readDeskBulletinIds.has(id) ? count + 1 : count
      }, 0),
    [deskBulletins, readDeskBulletinIds],
  )

  const loadDeskUserActivities = useCallback(async (device: DeskDevice) => {
    setDeskUserActivitiesLoading(true)
    try {
      const q = new URLSearchParams({ limit: '80' })
      if (device.device_id) q.set('device_id', String(device.device_id))
      if (device.expo_push_token) {
        q.set('expo_push_token', String(device.expo_push_token))
      }
      const res = await deskFetch(
        `/api/notifications/devices/activity?${q}&_=${Date.now()}`,
      )
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        activities?: DeskUserActivity[]
      }
      setDeskUserActivities(
        res.ok && Array.isArray(body.activities) ? body.activities : [],
      )
    } catch {
      setDeskUserActivities([])
    } finally {
      setDeskUserActivitiesLoading(false)
    }
  }, [])

  const loadAllEpisodesHistory = useCallback(
    async (opts?: { refresh?: boolean; offset?: number }) => {
      const offset = Math.max(0, Number(opts?.offset) || 0)
      const append = offset > 0
      const fromSupabase = Boolean(opts?.refresh)
      if (append) setAllEpisodesLoadingMore(true)
      else {
        setAllEpisodesError('')
        if (fromSupabase) setAllEpisodesUpdatingFromSupabase(true)
      }
      try {
        const q = new URLSearchParams({
          limit: String(ALL_EPISODES_PAGE_SIZE),
          offset: String(offset),
        })
        if (opts?.refresh) q.set('refresh', '1')
        const res = await deskFetch(`/api/momentum/episodes-history?${q}`)
        const body = await res.json().catch(() => ({}))
        if (!res.ok || !body?.ok) {
          throw new Error(
            body?.error || `Failed to load episodes (${res.status})`,
          )
        }
        const list = Array.isArray(body.episodes)
          ? (body.episodes as ActiveEpisodeRow[])
          : []
        const actives = Array.isArray(body.activeEpisodes)
          ? (body.activeEpisodes as ActiveEpisodeRow[])
          : []
        if (append) {
          setAllEpisodesList((prev) => {
            const seen = new Set(
              prev.map(
                (row) =>
                  `${row.episodeId || row.ticker}-${row.episodeNo || row.episodeStartedAt}`,
              ),
            )
            const extra = list.filter(
              (row) =>
                !seen.has(
                  `${row.episodeId || row.ticker}-${row.episodeNo || row.episodeStartedAt}`,
                ),
            )
            return extra.length ? [...prev, ...extra] : prev
          })
        } else {
          setAllEpisodesList(list)
        }
        setActiveEpisodesList(actives)
        setAllEpisodesHasMore(Boolean(body.hasMore))
        setAllEpisodesTotal(
          Number.isFinite(Number(body.total))
            ? Number(body.total)
            : offset + list.length,
        )
        setAllEpisodesNextOffset(
          body.nextOffset != null && Number.isFinite(Number(body.nextOffset))
            ? Number(body.nextOffset)
            : body.hasMore
              ? offset + ALL_EPISODES_PAGE_SIZE
              : null,
        )
        setAllEpisodesFetchedAt(
          String(body.at || new Date().toISOString()),
        )
        setAllEpisodesError('')
        if (!append) {
          writeEpisodeListCache({
            episodes: list,
            activeEpisodes: actives,
            total: Number.isFinite(Number(body.total))
              ? Number(body.total)
              : list.length,
            hasMore: Boolean(body.hasMore),
            nextOffset:
              body.nextOffset != null && Number.isFinite(Number(body.nextOffset))
                ? Number(body.nextOffset)
                : body.hasMore
                  ? offset + ALL_EPISODES_PAGE_SIZE
                  : null,
            at: String(body.at || new Date().toISOString()),
          })
        }
      } catch (err) {
        if (!append) {
          setAllEpisodesError(
            err instanceof Error ? err.message : 'Failed to load episodes',
          )
        }
      } finally {
        if (append) setAllEpisodesLoadingMore(false)
        else {
          setAllEpisodesLoading(false)
          setAllEpisodesUpdatingFromSupabase(false)
        }
      }
    },
    [],
  )

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

  function policyDraftFromSnapshot(
    pol:
      | {
          accelerationAlertDeltaPp?: number
          materialProgressDeltaPp?: number
          holdingToWeakeningGiveback?: number
          weakeningToHoldingGiveback?: number
          strongWeakeningGiveback?: number
          episodeInactivityExpiryMin?: number
          rearmBufferPp?: number
          majorFadeAlertEnabled?: boolean
          startPushMaxAgeMs?: number
        }
      | null
      | undefined,
  ): Record<string, string> {
    const p = pol || {}
    const pct = (r: number | undefined, fallback: number) => {
      const v = r != null && Number.isFinite(Number(r)) ? Number(r) : fallback
      // store as ratio; show as percent in UI
      const asPct = v <= 1 ? v * 100 : v
      return String(Math.round(asPct * 10) / 10)
    }
    return {
      accelerationAlertDeltaPp: String(
        p.accelerationAlertDeltaPp ?? status?.config?.accelerationPoints ?? 2,
      ),
      materialProgressDeltaPp: String(p.materialProgressDeltaPp ?? 0.5),
      holdingToWeakeningGivebackPct: pct(p.holdingToWeakeningGiveback, 0.25),
      weakeningToHoldingGivebackPct: pct(p.weakeningToHoldingGiveback, 0.2),
      strongWeakeningGivebackPct: pct(p.strongWeakeningGiveback, 0.6),
      episodeInactivityExpiryMin: String(
        p.episodeInactivityExpiryMin ??
          status?.config?.inactivityMinutes ??
          180,
      ),
      rearmBufferPp: String(p.rearmBufferPp ?? 1),
      majorFadeAlertEnabled:
        p.majorFadeAlertEnabled === false ? '0' : '1',
      startPushMaxAgeMin: String(
        Math.round((p.startPushMaxAgeMs ?? 5 * 60_000) / 60_000),
      ),
    }
  }

  const loadSettingsDraftsForClass = useCallback(
    (classId: AssetClassTabId | string | null | undefined) => {
      const cls = thresholdClassKey(classId || 'equity')
      const snapByClass = (
        status?.config?.thresholdSnapshot as
          | { byClass?: Record<string, Record<string, number | null>> }
          | undefined
      )?.byClass?.[cls]
      if (snapByClass && typeof snapByClass === 'object') {
        const draft: Record<string, string> = {}
        for (const k of THRESHOLD_EDIT_KEYS) {
          const v = snapByClass[k]
          draft[k] = v != null && Number(v) > 0 ? String(v) : ''
        }
        setThresholdDraft(draft)
        thresholdDraftRef.current = draft
      } else {
        const local = loadLocalThresholdDraft(cls)
        setThresholdDraft(local)
        thresholdDraftRef.current = local
      }
      const epSnap = status?.config?.episodePolicy as
        | {
            byClass?: Record<
              string,
              Record<string, number | boolean | null | undefined>
            >
            accelerationAlertDeltaPp?: number
            materialProgressDeltaPp?: number
            holdingToWeakeningGiveback?: number
            weakeningToHoldingGiveback?: number
            strongWeakeningGiveback?: number
            episodeInactivityExpiryMin?: number
            rearmBufferPp?: number
            majorFadeAlertEnabled?: boolean
            startPushMaxAgeMs?: number
          }
        | undefined
      const polForClass =
        (epSnap?.byClass?.[cls] as typeof epSnap | undefined) || epSnap
      const polDraft = policyDraftFromSnapshot(polForClass)
      setPolicyDraft(polDraft)
      policyDraftRef.current = polDraft
      setPolicySaveState('idle')
      setThresholdSaveState('idle')
    },
    [status?.config?.thresholdSnapshot, status?.config?.episodePolicy],
  )

  /** Rolling-return thresholds open in the right (3rd) column — not a floating popover. */
  const openThresholdSettings = useCallback(() => {
    const initial =
      (assetClassTab &&
      ASSET_CLASS_TABS.some((t) => t.id === assetClassTab)
        ? assetClassTab
        : 'equity') as AssetClassTabId
    setSettingsAssetClass(initial)
    loadSettingsDraftsForClass(initial)
    setRightRailMode('settings')
    setLogCollapsedPersist(false)
  }, [
    setLogCollapsedPersist,
    assetClassTab,
    loadSettingsDraftsForClass,
  ])

  const selectSettingsAssetClass = useCallback(
    (next: AssetClassTabId) => {
      if (next === settingsAssetClass) return
      // Manual Save only — switching class drops unsaved draft for the previous class.
      if (thresholdAutosaveTimer.current) {
        clearTimeout(thresholdAutosaveTimer.current)
        thresholdAutosaveTimer.current = null
      }
      if (policyAutosaveTimer.current) {
        clearTimeout(policyAutosaveTimer.current)
        policyAutosaveTimer.current = null
      }
      setSettingsAssetClass(next)
    },
    [settingsAssetClass],
  )

  const closeThresholdSettings = useCallback(() => {
    setRightRailMode('events')
  }, [])

  const loadActiveEpisodesList = useCallback(async (opts?: { refresh?: boolean }) => {
    const fromSupabase = Boolean(opts?.refresh)
    setActiveEpisodesError('')
    if (fromSupabase) setActiveEpisodesUpdatingFromSupabase(true)
    try {
      const q = opts?.refresh ? '?refresh=1' : ''
      const res = await deskFetch(`/api/momentum/active-episodes${q}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) {
        throw new Error(
          body?.error || `Failed to load active episodes (${res.status})`,
        )
      }
      const list = Array.isArray(body.activeEpisodes)
        ? (body.activeEpisodes as ActiveEpisodeRow[])
        : []
      setActiveEpisodesList(list)
      // Keep sidebar dots in sync
      setEpisodeByTicker((prev) => {
        const next = { ...prev }
        for (const row of list) {
          const t = String(row.ticker || '')
            .trim()
            .toUpperCase()
          if (!t) continue
          next[t] = {
            direction: row.direction === 'DOWN' ? 'DOWN' : 'UP',
            window: row.detectedWindow || null,
          }
        }
        return next
      })
    } catch (err) {
      setActiveEpisodesError(
        err instanceof Error ? err.message : 'Failed to load active episodes',
      )
    } finally {
      setActiveEpisodesLoading(false)
      setActiveEpisodesUpdatingFromSupabase(false)
    }
  }, [])

  // Desk: paint cache immediately, then refresh history from Supabase.
  useEffect(() => {
    void loadActiveEpisodesList()
    void loadAllEpisodesHistory({ refresh: true })
  }, [loadActiveEpisodesList, loadAllEpisodesHistory])

  // Entering / leaving episodes-first mode resets center to the full history list
  const prevLeftEpisodesRef = useRef(leftShowsActiveEpisodes)
  useEffect(() => {
    const was = prevLeftEpisodesRef.current
    prevLeftEpisodesRef.current = leftShowsActiveEpisodes
    if (!leftShowsActiveEpisodes) {
      setDeskEpisodeFocus(null)
      setDeskUserFocus(null)
      return
    }
    if (!was && leftShowsActiveEpisodes) {
      setDeskEpisodeFocus(null)
      setDeskUserFocus(null)
      setDeskLeftTab('episodes')
      setRightRailMode('yahoo')
      setLogCollapsedPersist(false)
      setMainPanelTab('episode')
      // Memory/cache only — Supabase pull is boot + manual Refresh.
      void loadAllEpisodesHistory()
    }
  }, [leftShowsActiveEpisodes, setLogCollapsedPersist, loadAllEpisodesHistory])

  const deskUsersMode = leftShowsActiveEpisodes && deskLeftTab === 'users'
  const deskBulletinsMode =
    leftShowsActiveEpisodes && deskLeftTab === 'bulletins'

  /** Center stays on All episodes while desk is open — focus only updates the 3rd column. */
  const showAllEpisodesCenter =
    leftShowsActiveEpisodes && !deskUsersMode && !deskBulletinsMode

  /** Ticker → enabled Trigger subscriber count (from device_monitor). */
  const subscriberCountByTicker = useMemo(() => {
    const map = new Map<string, number>()
    for (const list of Object.values(monitoredByClass)) {
      for (const tab of list || []) {
        const t = String(tab.ticker || '')
          .trim()
          .toUpperCase()
        if (!t) continue
        const n =
          tab.subscriberCount != null && Number.isFinite(Number(tab.subscriberCount))
            ? Math.max(0, Math.floor(Number(tab.subscriberCount)))
            : null
        if (n == null) continue
        map.set(t, n)
      }
    }
    return map
  }, [monitoredByClass])

  const filteredAllEpisodesList = useMemo(() => {
    const q = allEpisodesQuery.trim().toUpperCase()
    let list = allEpisodesList
    if (q) {
      list = list.filter((row) =>
        String(row.ticker || '')
          .trim()
          .toUpperCase()
          .includes(q),
      )
    }
    if (allEpisodesLiveOnly && !allEpisodesEndedOnly) {
      list = list.filter(
        (row) => String(row.status || '').toUpperCase() === 'ACTIVE',
      )
    } else if (allEpisodesEndedOnly && !allEpisodesLiveOnly) {
      list = list.filter(
        (row) => String(row.status || '').toUpperCase() !== 'ACTIVE',
      )
    } else if (allEpisodesLiveOnly && allEpisodesEndedOnly) {
      // both on = no status filter (show all)
    }

    const soFarOf = (row: ActiveEpisodeRow): number | null => {
      const t = String(row.ticker || '')
        .trim()
        .toUpperCase()
      const quote =
        watchQuotes[t] || watchQuotes[String(row.ticker || '').trim()] || null
      return quoteChangePercent(quote)
    }
    const peakOf = (row: ActiveEpisodeRow): number | null => {
      const n = Number(row.peakMovePercent)
      return Number.isFinite(n) ? n : null
    }
    const nowOf = (row: ActiveEpisodeRow): number | null => {
      const cur = Number(row.currentMovePercent)
      if (Number.isFinite(cur)) return cur
      return peakOf(row)
    }
    const startedMs = (row: ActiveEpisodeRow): number => {
      const t = Date.parse(String(row.episodeStartedAt || ''))
      return Number.isFinite(t) ? t : 0
    }
    const statusRank = (row: ActiveEpisodeRow): number => {
      const live = String(row.status || '').toUpperCase() === 'ACTIVE'
      return live ? 1 : 0
    }
    const dir = allEpisodesSortDir === 'asc' ? 1 : -1
    const cmpNullLast = (a: number | null, b: number | null): number => {
      if (a == null && b == null) return 0
      if (a == null) return 1
      if (b == null) return -1
      return (a - b) * dir
    }

    return [...list].sort((a, b) => {
      let primary = 0
      switch (allEpisodesSortKey) {
        case 'peak':
          primary = cmpNullLast(peakOf(a), peakOf(b))
          break
        case 'now':
          primary = cmpNullLast(nowOf(a), nowOf(b))
          break
        case 'soFar':
          primary = cmpNullLast(soFarOf(a), soFarOf(b))
          break
        case 'status':
          primary = (statusRank(a) - statusRank(b)) * dir
          break
        case 'ticker':
          primary =
            String(a.ticker || '')
              .localeCompare(String(b.ticker || ''), undefined, {
                sensitivity: 'base',
              }) * dir
          break
        case 'started':
        default:
          primary = (startedMs(a) - startedMs(b)) * dir
          break
      }
      if (primary !== 0) return primary
      // Stable tie-break: newer started first
      return startedMs(b) - startedMs(a)
    })
  }, [
    allEpisodesList,
    allEpisodesQuery,
    allEpisodesLiveOnly,
    allEpisodesEndedOnly,
    allEpisodesSortKey,
    allEpisodesSortDir,
    watchQuotes,
  ])

  /** Arrow Up/Down → previous/next row in the All episodes center list. */
  const navigateDeskEpisodeByArrow = useCallback(
    (delta: 1 | -1) => {
      if (!showAllEpisodesCenter || !filteredAllEpisodesList.length) return
      const list = filteredAllEpisodesList
      const currentIdx = deskEpisodeFocus
        ? list.findIndex((row) => deskEpisodeRowsMatch(row, deskEpisodeFocus))
        : -1
      const nextIdx =
        currentIdx < 0
          ? delta > 0
            ? 0
            : list.length - 1
          : Math.max(0, Math.min(list.length - 1, currentIdx + delta))
      if (nextIdx === currentIdx) return
      const next = list[nextIdx]
      if (!next) return
      selectActiveEpisodeFromLeft(next)
    },
    [
      showAllEpisodesCenter,
      filteredAllEpisodesList,
      deskEpisodeFocus,
      selectActiveEpisodeFromLeft,
    ],
  )

  useEffect(() => {
    if (!showAllEpisodesCenter || !deskEpisodeFocus) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return
        }
      }
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      e.preventDefault()
      navigateDeskEpisodeByArrow(e.key === 'ArrowDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showAllEpisodesCenter, deskEpisodeFocus, navigateDeskEpisodeByArrow])

  // Keep the focused center-list row visible while arrowing through episodes
  useEffect(() => {
    if (!showAllEpisodesCenter || !deskEpisodeFocus) return
    const key = deskEpisodeNavKey(deskEpisodeFocus)
    if (!key) return
    const safe =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(key)
        : key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const el = document.querySelector(
      `[data-episode-nav-key="${safe}"]`,
    ) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [showAllEpisodesCenter, deskEpisodeFocus])

  // Prefetch Trigger devices for Users tab count (and when Users tab is open)
  useEffect(() => {
    if (!leftShowsActiveEpisodes && !deskUsersMode) return
    void loadDeskDevices()
  }, [leftShowsActiveEpisodes, deskUsersMode, loadDeskDevices])

  // Prefetch market bulletins for nav badge + when Market tab is open
  useEffect(() => {
    if (!leftShowsActiveEpisodes && !deskBulletinsMode) return
    void loadDeskBulletins()
  }, [leftShowsActiveEpisodes, deskBulletinsMode, loadDeskBulletins])

  // Load push activity for the focused desk user
  useEffect(() => {
    if (!deskUsersMode || !deskUserFocus) {
      setDeskUserActivities([])
      return
    }
    void loadDeskUserActivities(deskUserFocus)
  }, [deskUsersMode, deskUserFocus, loadDeskUserActivities])

  // Yahoo / user-profile detail rail after focus from the center lists
  useEffect(() => {
    if (!leftShowsActiveEpisodes) return
    if (deskEpisodeFocus || deskUserFocus) {
      setRightRailMode('yahoo')
      setLogCollapsedPersist(false)
    }
  }, [
    leftShowsActiveEpisodes,
    deskEpisodeFocus,
    deskUserFocus,
    setLogCollapsedPersist,
  ])

  // Reload drafts when the settings asset-class pill changes.
  useEffect(() => {
    if (rightRailMode !== 'settings') return
    loadSettingsDraftsForClass(settingsAssetClass)
    // Intentionally not depending on loadSettingsDraftsForClass — status polls
    // must not wipe in-progress edits for the open class.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsAssetClass, rightRailMode])

  // Active episode on this ticker → Recent Events rail (skip when desk is in
  // episodes-first mode with Yahoo chart in the third column).
  useEffect(() => {
    if (leftShowsActiveEpisodes || rightRailMode === 'yahoo') return
    const ep = status?.episode
    if (!ep) return
    const st = String(ep.status || 'ACTIVE').toUpperCase()
    if (st === 'ENDED' || st === 'EXPIRED' || st === 'REVERSED') return
    if (!isIntradayOr24hEventWindow(ep.detectedWindow)) return
    openEventsInLogColumn()
  }, [
    leftShowsActiveEpisodes,
    rightRailMode,
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
        const maxW = rightRailMaxWidth()
        lastW = Math.min(
          maxW,
          Math.max(
            RIGHT_RAIL_MIN_WIDTH,
            drag.startW + (drag.startX - ev.clientX),
          ),
        )
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

  const onNavColResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      navColDragRef.current = { startX: e.clientX, startW: navColWidth }
      let lastW = navColWidth
      const onMove = (ev: MouseEvent) => {
        const drag = navColDragRef.current
        if (!drag) return
        lastW = Math.min(
          NAV_COL_MAX_WIDTH,
          Math.max(
            NAV_COL_MIN_WIDTH,
            drag.startW + (ev.clientX - drag.startX),
          ),
        )
        setNavColWidth(lastW)
      }
      const onUp = () => {
        navColDragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        saveNavColWidth(lastW)
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [navColWidth],
  )

  const onListColResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      listColDragRef.current = { startX: e.clientX, startW: listColWidth }
      let lastW = listColWidth
      const onMove = (ev: MouseEvent) => {
        const drag = listColDragRef.current
        if (!drag) return
        lastW = Math.min(
          LIST_COL_MAX_WIDTH,
          Math.max(
            LIST_COL_MIN_WIDTH,
            drag.startW + (ev.clientX - drag.startX),
          ),
        )
        setListColWidth(lastW)
      }
      const onUp = () => {
        listColDragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        saveListColWidth(lastW)
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [listColWidth],
  )

  const loadLive = useCallback(async () => {
    if (!displayTicker) return
    const path = `${momentumApiPath(displayTicker)}/live`
    try {
      const res = await deskFetch(path)
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok || body?.ok === false) return
      setStatus((prev) => {
        if (!prev) return prev
        const episode = (body.episode as MomentumStatus['episode']) || null
        return {
          ...prev,
          lastFetchAt:
            typeof body.lastFetchAt === 'string'
              ? body.lastFetchAt
              : prev.lastFetchAt,
          snapshot: {
            ...(prev.snapshot || {}),
            currentPrice:
              body.livePrice != null
                ? Number(body.livePrice)
                : prev.snapshot?.currentPrice,
            marketSession:
              (body.marketSession as string) || prev.snapshot?.marketSession,
            returns: {
              ...(prev.snapshot?.returns || {}),
              day:
                body.dayReturn != null
                  ? Number(body.dayReturn)
                  : prev.snapshot?.returns?.day,
            },
          },
          episode: episode || prev.episode,
        }
      })
    } catch {
      /* keep last status */
    }
  }, [displayTicker])

  const load = useCallback(async () => {
    if (!displayTicker) {
      setStatus(null)
      setLoading(false)
      setTickerUpdatingFromSupabase(false)
      return
    }
    // Ticker switch: hydrate this ticker's latest episodes/events from Supabase.
    const path = `${momentumApiPath(displayTicker)}?refresh=1`
    setTickerUpdatingFromSupabase(true)
    try {
      const res = await deskFetch(path)
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError(await toUiError('Failed to load status', res, body, 'Failed to load', path))
        return
      }
      const next = body as unknown as MomentumStatus
      setStatus(next)
      writeTickerStatusCache(displayTicker, next)
      setError(null)
      // Sync threshold inputs when panel closed (avoid fighting while typing)
      setThresholdDraft((prev) => {
        // Don't clobber while user is editing thresholds in the right rail
        if (rightRailMode === 'settings' && Object.keys(prev).length) return prev
        const snap = next.config?.thresholdSnapshot
        if (!snap) return prev
        const draft: Record<string, string> = {}
        for (const k of THRESHOLD_EDIT_KEYS) {
          if (k === 'day') {
            draft.day =
              snap.day != null && Number(snap.day) > 0 ? String(snap.day) : ''
          } else {
            const w = snap.windows?.[k]
            draft[k] = w != null && Number(w) > 0 ? String(w) : ''
          }
        }
        const local = loadLocalThresholdDraft()
        // Local only overlays positive values; never re-apply 0
        const cleanLocal: Record<string, string> = {}
        for (const [k, v] of Object.entries(local)) {
          const n = Number(v)
          if (Number.isFinite(n) && n > 0) cleanLocal[k] = String(n)
        }
        const merged = Object.keys(cleanLocal).length
          ? { ...draft, ...cleanLocal }
          : draft
        return merged
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
      setTickerUpdatingFromSupabase(false)
    }
  }, [displayTicker, rightRailMode])

  /** Settings → Clear Cache: wipe client + server RAM, then rehydrate from Supabase. */
  const clearDeskCache = useCallback(async () => {
    const ok = window.confirm(
      'Clear desk cache?\n\nThis wipes local cache + server RAM (episodes/events/logs), then reloads fresh history from Supabase.',
    )
    if (!ok) return
    clearDeskLocalCaches()
    setAllEpisodesList([])
    setActiveEpisodesList([])
    setAllEpisodesTotal(0)
    setAllEpisodesHasMore(false)
    setAllEpisodesNextOffset(null)
    setAllEpisodesFetchedAt('')
    setAllEpisodesError('')
    setActiveEpisodesError('')
    setEpisodeByTicker({})
    setStatus(null)
    setLoading(true)
    setAllEpisodesUpdatingFromSupabase(true)
    setTickerUpdatingFromSupabase(true)
    try {
      const res = await deskFetch('/api/momentum/clear-cache', {
        method: 'POST',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `Clear cache failed (${res.status})`)
      }
      await Promise.all([
        loadAllEpisodesHistory({ refresh: true }),
        loadActiveEpisodesList({ refresh: true }),
        load(),
      ])
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'Failed to clear cache',
      )
      setLoading(false)
      setAllEpisodesUpdatingFromSupabase(false)
      setTickerUpdatingFromSupabase(false)
    }
  }, [load, loadActiveEpisodesList, loadAllEpisodesHistory])

  // Re-apply last saved thresholds after reload so the engine matches the UI.
  useEffect(() => {
    const local = loadLocalThresholdDraft()
    if (!Object.keys(local).length) return
    const thresholds = thresholdsFromDraft(local)
    if (!Object.keys(thresholds).length) return
    void deskFetch('/api/momentum/thresholds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thresholds }),
    }).catch(() => {
      /* disk persist still applies on next server boot */
    })
  }, [])

  const loadPerplexityUsage = useCallback(async (opts?: { open?: boolean }) => {
    if (opts?.open) {
      setPplxUsageOpen(true)
      setPplxUsageLoading(true)
      setPplxUsageError('')
    }
    try {
      const res = await deskFetch('/api/notifications/usage/perplexity?days=90')
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

  // Register full monitor list + focus (server polls entire watchlist 24×7)
  useEffect(() => {
    const fromLocal = watchlist.map((t) => t.ticker).filter(Boolean)
    const fromMonitored = Object.values(monitoredByClass)
      .flat()
      .map((t) => t?.ticker)
      .filter(Boolean) as string[]
    const tickers = [...new Set([...fromLocal, ...fromMonitored, displayTicker].filter(Boolean))]
    if (!tickers.length) return
    void deskFetch('/api/momentum/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tickers,
        active: displayTicker,
      }),
    }).catch(() => {
      /* non-fatal — manual tick still works */
    })
  }, [watchlist, displayTicker, monitoredByClass])

  // Overview poll — active episode flags for every watched ticker (sidebar dots)
  useEffect(() => {
    let cancelled = false
    const loadOverview = () => {
      void deskFetch(`/api/momentum?_=${Date.now()}`)
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
          if (Array.isArray(body.activeEpisodes)) {
            setActiveEpisodesList(body.activeEpisodes as ActiveEpisodeRow[])
          }
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

  // While Active episodes rail is open, refresh a bit more often
  useEffect(() => {
    if (rightRailMode !== 'activeEpisodes' || logCollapsed) return
    void loadActiveEpisodesList()
    const id = window.setInterval(() => {
      void loadActiveEpisodesList()
    }, 5_000)
    return () => window.clearInterval(id)
  }, [rightRailMode, logCollapsed, loadActiveEpisodesList])

  // Keep active ticker's episode flag in sync with full status payload
  useEffect(() => {
    const t = displayTicker.toUpperCase()
    if (!t) return
    const ep = status?.episode
    const active =
      ep &&
      String(ep.status || 'ACTIVE').toUpperCase() !== 'ENDED' &&
      isIntradayOr24hEventWindow(ep.detectedWindow)
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

  // Prefer cached ticker status immediately; avoid blank flash while Supabase hydrates.
  useEffect(() => {
    if (!displayTicker) {
      setStatus(null)
      setLoading(false)
      setError(null)
      prevLogLen.current = 0
      return
    }
    const cached = readTickerStatusCache(displayTicker)
    if (cached) {
      setStatus(cached)
      setLoading(false)
    } else {
      setStatus(null)
      setLoading(true)
    }
    setError(null)
    prevLogLen.current = 0
  }, [displayTicker])

  useEffect(() => {
    if (!displayTicker) return
    void load()
    const id = setInterval(() => void loadLive(), 3_000)
    return () => clearInterval(id)
  }, [displayTicker, load, loadLive])

  // Kick a Yahoo tick when landing on a tab so returns/episode populate quickly
  // (background loop covers the full watchlist on its own cadence)
  useEffect(() => {
    if (!displayTicker) return
    let cancelled = false
    void deskFetch(momentumApiPath(displayTicker, 'tick'), { method: 'POST' })
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
      if (!displayTicker) return
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
    if (!displayTicker) {
      setTabQuote(null)
      setTabQuoteLoading(false)
      return
    }
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

  // Lightweight batch quotes for every tab + All episodes So Far % (Yahoo session move)
  useEffect(() => {
    const tickers = [
      ...new Set([
        ...watchlist.map((t) => t.ticker),
        ...displayedEntities.map((t) => t.ticker),
        ...allEpisodesList.map((r) => String(r.ticker || '').trim()),
      ]),
    ].filter(Boolean)
    if (!tickers.length) return
    let cancelled = false
    const loadQuotes = () => {
      void fetchYahooQuotes(tickers)
        .then((body) => {
          if (cancelled) return
          const next: Record<string, YahooLiveQuote> = {}
          for (const [key, q] of Object.entries(body.quotes || {})) {
            const quote = q as YahooLiveQuote
            next[key] = quote
            next[key.toUpperCase()] = quote
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
  }, [watchlist, displayedEntities, allEpisodesList])

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
      const res = await deskFetch(path, { method: 'POST' })
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

  /**
   * Persist thresholds to server (disk + Supabase). Manual Save only.
   */
  async function persistThresholdsNow(
    draft: Record<string, string>,
    opts?: { closeAfter?: boolean },
  ) {
    const path = '/api/momentum/thresholds'
    const assetClass = thresholdClassKey(settingsAssetClass)
    // Always send a full map for every edit key so blanks clear server bands
    const thresholds: Record<string, number | null> = {}
    for (const k of THRESHOLD_EDIT_KEYS) {
      const trimmed = String(draft[k] ?? '').trim()
      if (trimmed === '') {
        if (k === 'day') continue
        thresholds[k] = null
        continue
      }
      const n = Number(trimmed)
      if (Number.isFinite(n) && n > 0) thresholds[k] = n
      else if (Number.isFinite(n) && n <= 0) thresholds[k] = k === 'day' ? 0 : null
    }
    setThresholdSaving(true)
    setThresholdSaveState('saving')
    try {
      saveLocalThresholdDraft(draft, assetClass)
      const res = await deskFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thresholds,
          ticker: displayTicker,
          assetClass,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok || body.ok === false) {
        setThresholdSaveState('error')
        setError(
          await toUiError('Threshold save failed', res, body, 'Threshold save failed', path),
        )
        return
      }
      setError(null)
      setThresholdSaveState('saved')
      if (body.status) setStatus(body.status as MomentumStatus)
      if (opts?.closeAfter) {
        setRightRailMode('events')
        setLogCollapsedPersist(false)
      }
    } catch (err) {
      setThresholdSaveState('error')
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

  function onThresholdDraftChange(key: string, value: string) {
    setThresholdDraft((d) => {
      const next = { ...d, [key]: value }
      thresholdDraftRef.current = next
      return next
    })
    setThresholdSaveState('idle')
  }

  async function persistPolicyNow(draft: Record<string, string>) {
    const path = '/api/momentum/episode-policy'
    const assetClass = thresholdClassKey(settingsAssetClass)
    const toRatio = (pctStr: string, fallback: number) => {
      const n = Number(pctStr)
      if (!Number.isFinite(n)) return fallback
      return n > 1 ? n / 100 : n
    }
    const policy = {
      accelerationAlertDeltaPp: Number(draft.accelerationAlertDeltaPp) || 2,
      materialProgressDeltaPp: Number(draft.materialProgressDeltaPp) || 0.5,
      holdingToWeakeningGiveback: toRatio(
        draft.holdingToWeakeningGivebackPct,
        0.25,
      ),
      weakeningToHoldingGiveback: toRatio(
        draft.weakeningToHoldingGivebackPct,
        0.2,
      ),
      strongWeakeningGiveback: toRatio(draft.strongWeakeningGivebackPct, 0.6),
      episodeInactivityExpiryMin:
        Number(draft.episodeInactivityExpiryMin) || 180,
      rearmBufferPp: Number(draft.rearmBufferPp) || 1,
      majorFadeAlertEnabled: draft.majorFadeAlertEnabled !== '0',
      startPushMaxAgeMin: Number(draft.startPushMaxAgeMin) || 5,
    }
    setPolicySaving(true)
    setPolicySaveState('saving')
    try {
      const res = await deskFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy,
          ticker: displayTicker,
          assetClass,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      if (!res.ok || body.ok === false) {
        setPolicySaveState('error')
        return
      }
      setPolicySaveState('saved')
      if (body.status) setStatus(body.status as MomentumStatus)
      if (body.policy && typeof body.policy === 'object') {
        const pol = body.policy as {
          byClass?: Record<string, Record<string, unknown>>
        } & Parameters<typeof policyDraftFromSnapshot>[0]
        const forClass =
          (pol?.byClass?.[assetClass] as Parameters<
            typeof policyDraftFromSnapshot
          >[0]) || pol
        const next = policyDraftFromSnapshot(forClass)
        setPolicyDraft(next)
        policyDraftRef.current = next
      }
    } catch {
      setPolicySaveState('error')
    } finally {
      setPolicySaving(false)
    }
  }

  function onPolicyDraftChange(key: string, value: string) {
    setPolicyDraft((d) => {
      const next = { ...d, [key]: value }
      policyDraftRef.current = next
      return next
    })
    setPolicySaveState('idle')
  }

  async function saveSettingsNow() {
    await Promise.all([
      persistThresholdsNow(thresholdDraftRef.current),
      persistPolicyNow(policyDraftRef.current),
    ])
  }

  const snap = status?.snapshot ?? null
  const returns = snap?.returns
  const refTimes = snap?.referenceTimes
  const refPrices = snap?.references
  const episodeRaw = status?.episode ?? null
  // Active episode is ≤24h / 1D only. Longer windows keep blinking on cards.
  const episode =
    episodeRaw && isIntradayOr24hEventWindow(episodeRaw.detectedWindow)
      ? episodeRaw
      : null
  /** All durable + live episodes for the selected ticker (2nd main tab). */
  const tickerEpisodeGroups = useMemo(() => {
    return buildEpisodeGroups(
      status?.episodes,
      status?.events,
      episodeRaw,
      { includeAllWindows: true },
    ).map((g) => {
      const next = ensureGroupHasStartedEvent(g)
      if (
        next.status === 'ACTIVE' &&
        episodeRaw?.state &&
        (!next.episodeId || next.episodeId === episodeRaw.episodeId)
      ) {
        return {
          ...next,
          liveState: episodeRaw.state,
          marketSession:
            next.marketSession || status?.snapshot?.marketSession || null,
          episodeNo: next.episodeNo ?? episodeRaw.episodeNo ?? null,
        }
      }
      return next
    })
  }, [
    status?.episodes,
    status?.events,
    status?.snapshot?.marketSession,
    episodeRaw,
  ])
  const logs = status?.logs || []
  const sq = snap?.sessionQuote

  // Yahoo marketState only (PREPRE = overnight via postMarket*)
  const sessionFromQuote = resolveClientMarketSession(
    tabQuote?.marketState,
    snap?.marketSession || sq?.session,
    nowMs,
  )
  const yahooActive = resolveYahooActiveSession(tabQuote)

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

  // Quote / chart stamps use the listing exchange zone (never browser local).
  const exchangeDisplayTz = resolveExchangeTimeZone({
    exchangeTimezoneName: tabQuote?.exchangeTimezoneName,
    exchange: tabQuote?.exchange,
    symbol: displayTicker,
    assetClass: activeTab?.assetClass || snap?.assetClass || null,
  })
  // Sync module helper zone before JSX fmt* calls in this render.
  setMomentumDisplayTimeZone(exchangeDisplayTz)

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
  /** Equity/index/etc. off REGULAR — rolling returns are not being calculated. */
  const rollingReturnsClosed = (() => {
    const cls = String(activeAssetClass || 'equity').toLowerCase()
    if (cls === 'crypto' || cls === 'forex') return false
    const sess = String(sessionFromQuote || snap?.marketSession || '')
      .trim()
      .toUpperCase()
    return (
      sess === 'CLOSED' ||
      sess === 'CLOSE' ||
      sess === 'PRE' ||
      sess === 'PREPRE' ||
      sess === 'POST' ||
      sess === 'POSTPOST' ||
      !sess
    )
  })()
  const rollingReturnsClosedReason = (() => {
    if (!rollingReturnsClosed) return null
    const sess = String(sessionFromQuote || snap?.marketSession || '')
      .trim()
      .toUpperCase()
    if (sess === 'PRE' || sess === 'PREPRE') {
      return 'Pre-market / overnight — momentum rolling returns only run in regular cash hours for this asset class, so short windows stay blank until the open.'
    }
    if (sess === 'POST' || sess === 'POSTPOST') {
      return 'After-hours — momentum rolling returns only run in regular cash hours for this asset class, so short windows stay blank until the next session.'
    }
    return 'Market closed — momentum is not calculating rolling returns for this asset class until the regular session is open again.'
  })()
  // Asset-aware last session (stocks ≠ gold ≠ bitcoin)
  const lastSessionMeta = resolveLastSessionMetaClient(displayTicker, activeAssetClass)
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
  /** Session card (PRE / Regular / Overnight / AH) always first, then 1m…1y. */
  const visibleReturnKeys: string[] = [...RETURN_KEYS_ALL]

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

  function pickEntityYahooResult(row: YahooSearchResult) {
    pickSearchResult(row)
    setEntityListQuery('')
    setEntityListSearchOpen(false)
    setEntityYahooResults([])
    setEntityYahooError(null)
    setEntityYahooHighlight(0)
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
      const res = await deskFetch(
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

  const [startEpisodeBusyKey, setStartEpisodeBusyKey] = useState<string | null>(
    null,
  )
  const [startEpisodeError, setStartEpisodeError] = useState('')

  /**
   * Hover-popup “Start episode”: force-open ACTIVE on this rolling window,
   * then open the research / push composer (full story).
   */
  async function startEpisodeFromWindow(windowKey: string) {
    if (!windowKey || startEpisodeBusyKey) return
    setStartEpisodeBusyKey(windowKey)
    setStartEpisodeError('')
    const path = momentumApiPath(displayTicker, 'start-episode')
    try {
      const res = await deskFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windowKey }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      if (body.status) setStatus(body.status as MomentumStatus)
      else await load()
      if (!res.ok || body.ok === false) {
        const msg =
          (typeof body.error === 'string' && body.error) ||
          'Could not start episode'
        setStartEpisodeError(msg)
        setError({
          title: 'Start episode failed',
          message: msg,
          detail: {
            message: msg,
            at: new Date().toISOString(),
            source: 'client',
            path,
            endpoint: path,
            code: typeof body.code === 'string' ? body.code : null,
          },
        })
        return
      }
      setError(null)
      // Full operator story: research composer for this window
      openReturnAlert(windowKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Start episode failed'
      setStartEpisodeError(msg)
      setError({
        title: 'Start episode failed',
        message: msg,
        detail: {
          message: msg,
          at: new Date().toISOString(),
          source: 'client',
          stack: err instanceof Error ? err.stack || null : null,
          path,
          endpoint: path,
        },
      })
    } finally {
      setStartEpisodeBusyKey(null)
    }
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
        const res = await deskFetch('/api/notifications/momentum-research', {
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
            episode_id: status?.episode?.episodeId || deskEpisodeFocus?.episodeId || null,
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
      const prepRes = await deskFetch('/api/notifications/momentum-research', {
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
      const res = await deskFetch('/api/notifications/momentum-research', {
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
          `Research OK, but Supabase save failed: ${body.supabase_save.error || 'unknown'}.`,
        )
      }
      // Refresh spend chip after each research call
      void loadPerplexityUsage()

      // Record "Perplexity done" on the Recent Events timeline (after backend event)
      try {
        const tlRes = await deskFetch(
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

  /**
   * Resolve existing Perplexity alert heading + likely driver for an episode
   * (no new crawl — only stored research).
   */
  async function resolveStoredShareCopy(row: ActiveEpisodeRow): Promise<{
    headline: string
    likelyDriver: string
  }> {
    const symbol = String(row.ticker || '')
      .trim()
      .toUpperCase()
    const eid = row.episodeId != null ? String(row.episodeId).trim() : ''
    let headline = ''
    let likelyDriver = ''

    const consider = (r: EventResearch | null | undefined) => {
      if (!r) return
      if (!headline) {
        headline = String(r.alert?.title || r.reason || '').trim()
      }
      if (!likelyDriver) {
        likelyDriver = String(
          r.likely_driver || r.alert?.body || '',
        ).trim()
      }
    }

    // Prefer research already attached to in-memory events for this ticker
    const sameTicker =
      String(displayTicker || '')
        .trim()
        .toUpperCase() === symbol
    if (sameTicker && status?.events?.length) {
      for (const ev of status.events) {
        if (eid && ev.episodeId && String(ev.episodeId) !== eid) continue
        consider(extractEventResearch(ev))
        if (headline && likelyDriver) break
      }
    }

    if ((!headline || !likelyDriver) && eid) {
      try {
        const ac = new AbortController()
        const timer = window.setTimeout(() => ac.abort(), 2500)
        const res = await deskFetch(
          `/api/momentum/episodes/${encodeURIComponent(eid)}/research`,
          { signal: ac.signal },
        )
        window.clearTimeout(timer)
        const body = await res.json().catch(() => ({}))
        const raw = body?.research
        const rowRaw = Array.isArray(raw) ? raw[0] : raw
        consider(mapApiResearchRow(rowRaw as Record<string, unknown>))
      } catch {
        /* best-effort — still open share with move % */
      }
    }

    return { headline, likelyDriver }
  }

  /**
   * Peak → Trigger research composer (like So Far), but pre-fill likely driver
   * from the episode’s STARTED Perplexity research (no need to re-run first).
   * Now → direct share with stored copy (unchanged).
   */
  async function openEpisodeShareInTrigger(
    row: ActiveEpisodeRow,
    kind: 'peak' | 'now',
  ) {
    const symbol = String(row.ticker || '')
      .trim()
      .toUpperCase()
    if (!symbol || !onOpenInTrigger) {
      if (onOpenTriggerApp) onOpenTriggerApp()
      return
    }
    const quote =
      watchQuotes[symbol] || watchQuotes[symbol.toUpperCase()] || null
    const label =
      quote?.shortName || quote?.longName || symbol
    const moveRaw =
      kind === 'peak'
        ? row.peakMovePercent
        : row.currentMovePercent ?? row.peakMovePercent
    const move =
      moveRaw != null && Number.isFinite(Number(moveRaw))
        ? Number(moveRaw)
        : null
    const copy = await resolveStoredShareCopy(row)
    const dir =
      row.direction || (move != null && move < 0 ? 'DOWN' : 'UP')

    if (kind === 'peak') {
      const pctLabel =
        move != null
          ? `${move > 0 ? '+' : ''}${move.toFixed(2)}%`
          : null
      const exactLabel =
        String(row.exactLabel || '').trim() ||
        formatWallSpan(row.exactMinutes) ||
        null
      const timePhrase = exactLabel
        ? `in the last ${exactLabel}`
        : row.detectedWindow &&
            String(row.detectedWindow).toLowerCase() !== 'day'
          ? `in the last ${returnKeyDisplayLabel(String(row.detectedWindow), row.marketSession)}`
          : 'since episode start'
      const headline = pctLabel
        ? `$${symbol} ${pctLabel} ${timePhrase}`
        : `$${symbol} peak move ${timePhrase}`
      const peakPriceRaw =
        row.peakPrice != null && Number.isFinite(Number(row.peakPrice))
          ? Number(row.peakPrice)
          : dir === 'DOWN' &&
              row.troughPrice != null &&
              Number.isFinite(Number(row.troughPrice))
            ? Number(row.troughPrice)
            : null
      const refPriceRaw =
        row.referencePrice != null && Number.isFinite(Number(row.referencePrice))
          ? Number(row.referencePrice)
          : null
      const livePriceRaw =
        quoteLivePrice(quote) ?? quote?.regularMarketPrice ?? null
      const price =
        peakPriceRaw != null
          ? peakPriceRaw
          : livePriceRaw != null && Number.isFinite(Number(livePriceRaw))
            ? Number(livePriceRaw)
            : null
      onOpenInTrigger(symbol, {
        label,
        share: true,
        mode: 'research',
        move,
        price,
        priceFrom: refPriceRaw,
        window: row.detectedWindow || null,
        exactLabel: row.exactLabel || exactLabel || null,
        exactMinutes:
          row.exactMinutes != null && Number.isFinite(Number(row.exactMinutes))
            ? Number(row.exactMinutes)
            : null,
        direction: dir,
        kind: 'peak',
        headline,
        // STARTED research likely driver — composer / notify / share pre-fill
        likelyDriver: copy.likelyDriver || null,
      })
      return
    }

    // Now % — direct share with stored research copy
    onOpenInTrigger(symbol, {
      label,
      share: true,
      mode: 'direct',
      move,
      price:
        quoteLivePrice(quote) ??
        (quote?.regularMarketPrice != null &&
        Number.isFinite(Number(quote.regularMarketPrice))
          ? Number(quote.regularMarketPrice)
          : null),
      window: row.detectedWindow || null,
      direction: dir,
      kind: 'now',
      headline: copy.headline || null,
      likelyDriver: copy.likelyDriver || null,
    })
  }

  /** So Far % → Trigger new tab · Perplexity research composer → notify / share. */
  function openSofarShareInTrigger(row: ActiveEpisodeRow, soFarPct: number | null) {
    const symbol = String(row.ticker || '')
      .trim()
      .toUpperCase()
    if (!symbol || !onOpenInTrigger) return
    const quote =
      watchQuotes[symbol] || watchQuotes[symbol.toUpperCase()] || null
    const label =
      quote?.shortName || quote?.longName || symbol
    const move =
      soFarPct != null && Number.isFinite(soFarPct) ? soFarPct : null
    const pctLabel =
      move != null
        ? `${move > 0 ? '+' : ''}${move.toFixed(2)}%`
        : null
    const dir =
      row.direction ||
      (move != null && move < 0 ? 'DOWN' : 'UP')
    const headline = pctLabel
      ? `$${symbol} ${pctLabel} so far in regular trading`
      : `$${symbol} so far in regular trading`
    // Prefer session-aware last print (same number shown on the desk)
    const priceRaw =
      quoteLivePrice(quote) ?? quote?.regularMarketPrice ?? null
    const price =
      priceRaw != null && Number.isFinite(Number(priceRaw))
        ? Number(priceRaw)
        : null
    onOpenInTrigger(symbol, {
      label,
      share: true,
      mode: 'research',
      move,
      price,
      window: row.detectedWindow || 'day',
      direction: dir,
      kind: 'sofar',
      headline,
    })
  }

  /**
   * Manually end / exit a live momentum episode (no push).
   * Defaults to the focused ticker; pass `ticker` from the Active episodes rail.
   * Pass `skipConfirm` when bulk-ending from “End all”.
   */
  async function endActiveEpisode(opts?: {
    ticker?: string
    direction?: string | null
    peakMovePercent?: number | null
    skipConfirm?: boolean
    skipRefreshList?: boolean
  }): Promise<boolean> {
    if (endingEpisode && !opts?.skipConfirm) return false
    const symbol = String(opts?.ticker || displayTicker || '')
      .trim()
      .toUpperCase()
    if (!symbol) return false
    const dir =
      opts?.direction ||
      (symbol === displayTicker.toUpperCase() ? episode?.direction : null) ||
      'episode'
    const peakRaw =
      opts?.peakMovePercent != null && Number.isFinite(Number(opts.peakMovePercent))
        ? Number(opts.peakMovePercent)
        : symbol === displayTicker.toUpperCase() &&
            episode &&
            Number.isFinite(episode.peakMovePercent)
          ? Number(episode.peakMovePercent)
          : null
    const peak = peakRaw != null ? fmtPct(peakRaw) : ''
    if (!opts?.skipConfirm) {
      const ok = window.confirm(
        `End the active ${dir} episode for ${symbol}?${
          peak ? `\nPeak so far: ${peak}` : ''
        }\n\nThis only closes tracking — no push is sent. A new episode can start on the next threshold cross.`,
      )
      if (!ok) return false
    }

    setEndingEpisode(true)
    setEndingEpisodeTicker(symbol)
    try {
      const res = await deskFetch(momentumApiPath(symbol, 'end-episode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'MANUAL' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || `End failed (${res.status})`)
      }
      if (symbol === displayTicker.toUpperCase()) {
        if (body?.status) setStatus(body.status as MomentumStatus)
        else void load()
      }
      setEpisodeByTicker((prev) => ({
        ...prev,
        [symbol]: null,
      }))
      setActiveEpisodesList((prev) =>
        prev.filter(
          (row) => String(row.ticker || '').toUpperCase() !== symbol,
        ),
      )
      setAllEpisodesList((prev) =>
        prev.map((row) => {
          if (String(row.ticker || '').toUpperCase() !== symbol) return row
          const st = String(row.status || row.state || '').toUpperCase()
          if (st !== 'ACTIVE') return row
          return {
            ...row,
            status: 'ENDED',
            state: 'ENDED',
            endReason: 'MANUAL',
            endedAt: new Date().toISOString(),
          }
        }),
      )
      if (rightRailMode === 'activeEpisodes' && !opts?.skipRefreshList) {
        void loadActiveEpisodesList()
      }
      return true
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'Failed to end episode',
      )
      return false
    } finally {
      setEndingEpisode(false)
      setEndingEpisodeTicker(null)
    }
  }

  /** End every live episode shown in the Active episodes rail (one confirm, no pushes). */
  async function endAllActiveEpisodes() {
    if (endingEpisode) return
    const rows = activeEpisodesList.filter((row) => {
      const st = String(row.status || row.state || 'ACTIVE').toUpperCase()
      return st === 'ACTIVE' && String(row.ticker || '').trim()
    })
    if (!rows.length) return
    const ok = window.confirm(
      `End all ${rows.length} active episode${rows.length === 1 ? '' : 's'}?\n\nThis only closes tracking — no push is sent. New episodes can start on the next threshold cross.`,
    )
    if (!ok) return

    setEndingEpisode(true)
    const failed: string[] = []
    try {
      for (const row of rows) {
        const symbol = String(row.ticker || '').trim().toUpperCase()
        if (!symbol) continue
        setEndingEpisodeTicker(symbol)
        try {
          const res = await deskFetch(momentumApiPath(symbol, 'end-episode'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'MANUAL' }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) {
            throw new Error(body.error || `End failed (${res.status})`)
          }
          if (symbol === displayTicker.toUpperCase()) {
            if (body?.status) setStatus(body.status as MomentumStatus)
            else void load()
          }
          setEpisodeByTicker((prev) => ({
            ...prev,
            [symbol]: null,
          }))
          setActiveEpisodesList((prev) =>
            prev.filter(
              (r) => String(r.ticker || '').toUpperCase() !== symbol,
            ),
          )
          setAllEpisodesList((prev) =>
            prev.map((row) => {
              if (String(row.ticker || '').toUpperCase() !== symbol) return row
              const st = String(row.status || row.state || '').toUpperCase()
              if (st !== 'ACTIVE') return row
              return {
                ...row,
                status: 'ENDED',
                state: 'ENDED',
                endReason: 'MANUAL',
                endedAt: new Date().toISOString(),
              }
            }),
          )
        } catch (err) {
          failed.push(
            `${symbol}: ${err instanceof Error ? err.message : 'failed'}`,
          )
        }
      }
      await loadActiveEpisodesList()
      void loadAllEpisodesHistory({ refresh: true })
      if (failed.length) {
        window.alert(
          `Ended with ${failed.length} error${failed.length === 1 ? '' : 's'}:\n\n${failed.slice(0, 8).join('\n')}${failed.length > 8 ? '\n…' : ''}`,
        )
      }
    } finally {
      setEndingEpisode(false)
      setEndingEpisodeTicker(null)
    }
  }

  function openEpisodeEdit(group: EpisodeEventGroup) {
    if (!group.episodeId) {
      window.alert('This row has no episode id yet — cannot edit.')
      return
    }
    const draft = buildEpisodeEditDraft(group, episode, status?.episodes)
    setEpisodeEditDraft(draft)
    setEpisodeEditError('')
    setEpisodeEditOpen(true)
  }

  async function deleteTimelineEventFromEdit(idx: number) {
    if (!episodeEditDraft?.episodeId || episodeEventDeletingIdx != null) return
    const ev = episodeEditDraft.events[idx]
    if (!ev) return
    const label = ev.eventType || 'event'
    const when = ev.detectedAt || ev.originalDetectedAt || 'unknown time'
    const typeU = String(ev.eventType || '').toUpperCase()
    const isEndLine =
      typeU.includes('ENDED') ||
      typeU.includes('REVERS') ||
      String(ev.reason || '').toUpperCase() === 'MARKET_CLOSE' ||
      String(ev.state || '').toUpperCase() === 'EXPIRED' ||
      String(ev.state || '').toUpperCase() === 'ENDED'
    const ok = window.confirm(
      isEndLine
        ? `Delete this END event?\n\n${label}\n${when}\n\nThe episode will reopen as ACTIVE (ended time + end reason cleared). Cannot be undone.`
        : `Delete this timeline event completely?\n\n${label}\n${when}\n\nThis removes it from memory and Supabase. Cannot be undone.`,
    )
    if (!ok) return

    setEpisodeEventDeletingIdx(idx)
    setEpisodeEditError('')
    try {
      const res = await deskFetch(
        momentumApiPath(displayTicker, 'delete-episode-event'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: ev.id || undefined,
            episodeId: episodeEditDraft.episodeId,
            eventType: ev.eventType,
            detectedAt:
              datetimeLocalToIso(ev.detectedAt) ||
              ev.originalDetectedAt ||
              undefined,
          }),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.ok === false) {
        throw new Error(body.error || `Delete failed (${res.status})`)
      }
      if (body?.status) setStatus(body.status as MomentumStatus)
      else void load()

      const reopened = Boolean(body?.episodeReopened)
      const reEp = body?.episode
      // Drop event from draft; if end line removed, clear end fields too
      setEpisodeEditDraft((d) => {
        if (!d) return d
        const next: EpisodeEditDraft = {
          ...d,
          events: d.events.filter((_, i) => i !== idx),
        }
        if (reopened || isEndLine) {
          next.status = 'ACTIVE'
          next.state = String(reEp?.state || next.state || 'HOLDING').toUpperCase()
          next.endedAt = ''
          next.endReason = ''
        }
        return next
      })
      if (reopened && reEp) {
        setEpisodeByTicker((prev) => ({
          ...prev,
          [displayTicker.toUpperCase()]: {
            direction: reEp.direction === 'DOWN' ? 'DOWN' : 'UP',
            window: reEp.detectedWindow || null,
          },
        }))
      }
    } catch (err) {
      setEpisodeEditError(
        err instanceof Error ? err.message : 'Failed to delete event',
      )
    } finally {
      setEpisodeEventDeletingIdx(null)
    }
  }

  async function saveEpisodeEdit() {
    if (!episodeEditDraft?.episodeId || episodeEditSaving) return
    setEpisodeEditSaving(true)
    setEpisodeEditError('')
    try {
      const d = episodeEditDraft
      const patch = {
        direction: d.direction,
        status: d.status,
        state: d.state || null,
        detectedWindow: d.detectedWindow || null,
        episodeStartedAt: datetimeLocalToIso(d.episodeStartedAt),
        endedAt: datetimeLocalToIso(d.endedAt),
        endReason: d.endReason || null,
        referencePrice: d.referencePrice === '' ? null : Number(d.referencePrice),
        referenceTime: datetimeLocalToIso(d.referenceTime),
        triggerPrice: d.triggerPrice === '' ? null : Number(d.triggerPrice),
        currentPrice: d.currentPrice === '' ? null : Number(d.currentPrice),
        peakPrice: d.peakPrice === '' ? null : Number(d.peakPrice),
        troughPrice: d.troughPrice === '' ? null : Number(d.troughPrice),
        initialMovePercent:
          d.initialMovePercent === '' ? null : Number(d.initialMovePercent),
        peakMovePercent:
          d.peakMovePercent === '' ? null : Number(d.peakMovePercent),
        currentMovePercent:
          d.currentMovePercent === '' ? null : Number(d.currentMovePercent),
        lastNotifiedEpisodeMovePct:
          d.lastNotifiedEpisodeMovePct === ''
            ? null
            : Number(d.lastNotifiedEpisodeMovePct),
        lastMaterialProgressAt: datetimeLocalToIso(d.lastMaterialProgressAt),
        exactMinutes: d.exactMinutes === '' ? null : Number(d.exactMinutes),
        exactLabel: d.exactLabel || null,
      }
      const events = (d.events || []).map((ev) => ({
        id: ev.id || undefined,
        originalDetectedAt: ev.originalDetectedAt || undefined,
        eventType: ev.eventType,
        state: ev.state || null,
        direction: ev.direction || d.direction,
        detectedAt: datetimeLocalToIso(ev.detectedAt) || ev.originalDetectedAt,
        movePercent:
          ev.movePercent === '' ? null : Number(ev.movePercent),
        price: ev.price === '' ? null : Number(ev.price),
        reason: ev.reason || null,
        detectedWindow: ev.detectedWindow || null,
      }))
      const res = await deskFetch(
        momentumApiPath(displayTicker, 'edit-episode'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            episodeId: d.episodeId,
            patch,
            events,
          }),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.ok === false) {
        throw new Error(body.error || `Save failed (${res.status})`)
      }
      if (body?.status) setStatus(body.status as MomentumStatus)
      else void load()
      // Keep sidebar active flag in sync
      const saved = body?.episode
      if (saved && String(saved.status || '').toUpperCase() === 'ACTIVE') {
        setEpisodeByTicker((prev) => ({
          ...prev,
          [displayTicker.toUpperCase()]: {
            direction: saved.direction === 'DOWN' ? 'DOWN' : 'UP',
            window: saved.detectedWindow || null,
          },
        }))
      } else if (
        episode?.episodeId &&
        String(episode.episodeId) === d.episodeId
      ) {
        setEpisodeByTicker((prev) => ({
          ...prev,
          [displayTicker.toUpperCase()]: null,
        }))
      }
      setEpisodeEditOpen(false)
      setEpisodeEditDraft(null)
    } catch (err) {
      setEpisodeEditError(
        err instanceof Error ? err.message : 'Failed to save episode',
      )
    } finally {
      setEpisodeEditSaving(false)
    }
  }

  /**
   * Permanently delete an episode from Supabase (episode row + timeline events).
   * Always confirms with the user first.
   */
  async function deleteEpisodeFromSupabaseUi(group: {
    episodeId?: string | null
    episodeNo?: number | null
    direction?: string
    status?: string
  }) {
    const episodeId = String(group.episodeId || '').trim()
    if (!episodeId || deletingEpisodeId) return

    const label = formatEpisodeNo(group.episodeNo) || episodeId.slice(0, 16)
    const dir = group.direction || '?'
    const st = group.status || '?'
    const ok = window.confirm(
      `Delete episode ${label} (${dir}, ${st}) for ${displayTicker}?\n\n` +
        `This permanently removes it from Supabase:\n` +
        `• episodes (class table)\n` +
        `• events_episodes\n\n` +
        `episode_id: ${episodeId}\n\n` +
        `This cannot be undone.`,
    )
    if (!ok) return

    setDeletingEpisodeId(episodeId)
    try {
      const res = await deskFetch(
        momentumApiPath(displayTicker, 'delete-episode'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeId }),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || `Delete failed (${res.status})`)
      }
      if (body?.status) setStatus(body.status as MomentumStatus)
      else void load()
      if (
        episode?.episodeId &&
        String(episode.episodeId) === episodeId
      ) {
        setEpisodeByTicker((prev) => ({
          ...prev,
          [displayTicker.toUpperCase()]: null,
        }))
      }
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'Failed to delete episode',
      )
    } finally {
      setDeletingEpisodeId(null)
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
      const res = await deskFetch('/api/notifications/alert-news', {
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
        const tlRes = await deskFetch(
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

  const deskAllEpisodesCount = Math.max(
    Number(allEpisodesTotal) || 0,
    allEpisodesList.length,
  )
  const deskHomeTabs = (
    <div
      className="flex w-fit max-w-full items-center gap-0.5 rounded-full border border-border bg-muted p-0.5"
      role="tablist"
      aria-label="Episode desk views"
    >
      <button
        type="button"
        role="tab"
        aria-selected={showAllEpisodesCenter}
        onClick={() => {
          setDeskLeftTab('episodes')
          setDeskUserFocus(null)
          setDeskBulletinFocus(null)
          void loadAllEpisodesHistory()
        }}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors',
          showAllEpisodesCenter
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span>All episodes</span>
        <span className="tabular-nums opacity-70">
          {deskAllEpisodesCount}
        </span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={deskUsersMode}
        onClick={() => {
          setDeskLeftTab('users')
          setDeskEpisodeFocus(null)
          setDeskUserFocus(null)
          setDeskBulletinFocus(null)
          setRightRailMode('yahoo')
          setLogCollapsedPersist(false)
          void loadDeskDevices()
        }}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors',
          deskUsersMode
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span>All users</span>
        <span className="tabular-nums opacity-70">{deskDevices.length}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={deskBulletinsMode}
        onClick={() => {
          setDeskLeftTab('bulletins')
          setDeskEpisodeFocus(null)
          setDeskUserFocus(null)
          setDeskBulletinFocus(null)
          setRightRailMode('yahoo')
          setLogCollapsedPersist(false)
          void loadDeskBulletins()
        }}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors',
          deskBulletinsMode
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span>Market</span>
        <span className="tabular-nums opacity-70">{deskBulletins.length}</span>
      </button>
    </div>
  )

  return (
    <div
      data-momentum-dashboard
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      {/* ── Three-column desk: navigation | list | detail ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className="relative flex shrink-0 flex-col items-center border-r border-border bg-muted/25 py-2"
          style={{
            width: navColWidth,
            minWidth: NAV_COL_MIN_WIDTH,
            maxWidth: NAV_COL_MAX_WIDTH,
          }}
          aria-label="Dashboard navigation"
        >
          <button
            type="button"
            aria-label="Resize navigation column"
            title="Drag to resize"
            onMouseDown={onNavColResizeStart}
            className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize border-0 bg-transparent p-0 hover:bg-foreground/15 active:bg-foreground/20"
          />
          <TooltipProvider delayDuration={150}>
            <div className="flex w-full flex-col items-center gap-1 px-1.5">
              {ASSET_CLASS_TABS.map((tab) => {
                const active = assetClassTab === tab.id
                const Icon = tab.Icon
                return (
                  <Tooltip key={tab.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={tab.label}
                        aria-pressed={active}
                        onClick={() => selectAssetClassTab(tab.id)}
                        className={cn(
                          'inline-flex size-10 items-center justify-center rounded-xl border border-transparent transition-colors',
                          active
                            ? 'border-border bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-background hover:text-foreground',
                        )}
                      >
                        <Icon className="size-4" strokeWidth={1.75} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {tab.label}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>

            <div className="my-2 h-px w-7 shrink-0 bg-border" />

            <div className="flex w-full flex-col items-center gap-1 px-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Active episodes"
                    aria-pressed={
                      leftShowsActiveEpisodes &&
                      !deskUsersMode &&
                      !deskBulletinsMode
                    }
                    onClick={() => {
                      setAssetClassTab(null)
                      saveAssetClassFilter(null)
                      setDeskLeftTab('episodes')
                      setDeskUserFocus(null)
                      setDeskEpisodeFocus(null)
                      setDeskBulletinFocus(null)
                      setMainPanelTab('episode')
                      setRightRailMode('yahoo')
                      setLogCollapsedPersist(false)
                      void loadActiveEpisodesList()
                      void loadAllEpisodesHistory()
                    }}
                    className={cn(
                      'relative inline-flex size-10 items-center justify-center rounded-xl border border-transparent transition-colors',
                      leftShowsActiveEpisodes &&
                        !deskUsersMode &&
                        !deskBulletinsMode
                        ? 'border-border bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background hover:text-foreground',
                    )}
                  >
                    <Activity className="size-4" strokeWidth={1.75} />
                    {activeEpisodesList.length > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-0.5 text-[9px] font-bold leading-none text-background">
                        {activeEpisodesList.length > 99
                          ? '99+'
                          : activeEpisodesList.length}
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Active episodes
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Users"
                    aria-pressed={deskUsersMode}
                    onClick={() => {
                      setAssetClassTab(null)
                      saveAssetClassFilter(null)
                      setDeskLeftTab('users')
                      setDeskEpisodeFocus(null)
                      setDeskUserFocus(null)
                      setDeskBulletinFocus(null)
                      setRightRailMode('yahoo')
                      setLogCollapsedPersist(false)
                      void loadDeskDevices()
                    }}
                    className={cn(
                      'relative inline-flex size-10 items-center justify-center rounded-xl border border-transparent transition-colors',
                      deskUsersMode
                        ? 'border-border bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background hover:text-foreground',
                    )}
                  >
                    <Users className="size-4" strokeWidth={1.75} />
                    {deskDevices.length > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-muted-foreground px-0.5 text-[9px] font-bold leading-none text-background">
                        {deskDevices.length > 99 ? '99+' : deskDevices.length}
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Users
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={
                      unreadDeskBulletinCount > 0
                        ? `Market bulletins, ${unreadDeskBulletinCount} unread`
                        : 'Market bulletins'
                    }
                    aria-pressed={deskBulletinsMode}
                    onClick={() => {
                      setAssetClassTab(null)
                      saveAssetClassFilter(null)
                      setDeskLeftTab('bulletins')
                      setDeskEpisodeFocus(null)
                      setDeskUserFocus(null)
                      setDeskBulletinFocus(null)
                      setRightRailMode('yahoo')
                      setLogCollapsedPersist(false)
                      void loadDeskBulletins()
                    }}
                    className={cn(
                      'relative inline-flex size-10 items-center justify-center rounded-xl border border-transparent transition-colors',
                      deskBulletinsMode
                        ? 'border-border bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background hover:text-foreground',
                    )}
                  >
                    <Newspaper className="size-4" strokeWidth={1.75} />
                    {unreadDeskBulletinCount > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-muted-foreground px-0.5 text-[9px] font-bold leading-none text-background">
                        {unreadDeskBulletinCount > 99
                          ? '99+'
                          : unreadDeskBulletinCount}
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {unreadDeskBulletinCount > 0
                    ? `Market bulletins · ${unreadDeskBulletinCount} unread`
                    : 'Market bulletins'}
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="mt-auto flex w-full flex-col items-center px-1.5">
              <DropdownMenu
                open={navSettingsOpen}
                onOpenChange={setNavSettingsOpen}
                modal={false}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Settings"
                    aria-pressed={
                      navSettingsOpen ||
                      (leftShowsActiveEpisodes && rightRailMode === 'settings')
                    }
                    onPointerEnter={openNavSettings}
                    onPointerLeave={scheduleNavSettingsClose}
                    onFocus={openNavSettings}
                    className={cn(
                      'inline-flex size-10 items-center justify-center rounded-xl border border-transparent transition-colors',
                      navSettingsOpen ||
                        (leftShowsActiveEpisodes && rightRailMode === 'settings')
                        ? 'border-border bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background hover:text-foreground',
                    )}
                  >
                    <Settings className="size-4" strokeWidth={1.75} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="end"
                  sideOffset={8}
                  className="min-w-[17rem] max-w-[20rem]"
                  onPointerEnter={openNavSettings}
                  onPointerLeave={scheduleNavSettingsClose}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Settings
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2"
                    onSelect={() => {
                      setAssetClassTab(null)
                      saveAssetClassFilter(null)
                      setDeskLeftTab('episodes')
                      setDeskUserFocus(null)
                      setDeskEpisodeFocus(null)
                      setDeskBulletinFocus(null)
                      openThresholdSettings()
                    }}
                  >
                    <Settings className="size-3.5" strokeWidth={1.75} />
                    Thresholds & episode rules
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2"
                    onSelect={() => setPerplexityPromptsOpen(true)}
                  >
                    <ScrollText className="size-3.5" strokeWidth={1.75} />
                    Perplexity prompts
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-rose-700 focus:text-rose-700 dark:text-rose-300 dark:focus:text-rose-300"
                    onSelect={() => void clearDeskCache()}
                  >
                    <RotateCcw className="size-3.5" strokeWidth={1.75} />
                    Clear Cache
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2"
                    onSelect={() => {
                      if (onOpenTriggerApp) onOpenTriggerApp()
                      else if (onOpenInTrigger) {
                        onOpenInTrigger(displayTicker, {
                          label: activeTab?.label || displayTicker,
                        })
                      }
                    }}
                  >
                    <Zap className="size-3.5" strokeWidth={1.75} />
                    Trigger dashboard
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2"
                    onSelect={(event) => {
                      event.preventDefault()
                      onToggleTheme?.()
                    }}
                  >
                    {theme === 'dark' ? (
                      <Sun className="size-3.5" strokeWidth={1.75} />
                    ) : (
                      <Moon className="size-3.5" strokeWidth={1.75} />
                    )}
                    <span className="flex-1">
                      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {theme === 'dark' ? 'On' : 'Off'}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </TooltipProvider>
        </aside>

        {/* Asset mode: the middle column is the selected market's ticker list. */}
        {showLegacyLeftRail ? (
        <aside
          className="relative flex shrink-0 flex-col border-r border-border bg-background"
          style={{
            width: listColWidth,
            minWidth: LIST_COL_MIN_WIDTH,
            maxWidth: LIST_COL_MAX_WIDTH,
          }}
        >
          <button
            type="button"
            aria-label="Resize ticker list column"
            title="Drag to resize"
            onMouseDown={onListColResizeStart}
            className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize border-0 bg-transparent p-0 hover:bg-foreground/15 active:bg-foreground/20"
          />
          <div className="flex shrink-0 flex-col px-2 pt-2">
            {leftShowsActiveEpisodes ? (
              <div
                className="mb-1 flex w-full items-center gap-0.5 rounded-full border border-border bg-muted p-0.5"
                role="tablist"
                aria-label="Desk left tabs"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={!deskUsersMode}
                  onClick={() => {
                    setDeskLeftTab('episodes')
                    setDeskUserFocus(null)
                  }}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-semibold transition-colors',
                    !deskUsersMode
                      ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span>Active episodes</span>
                  <span className="tabular-nums opacity-70">
                    {activeEpisodesList.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={deskUsersMode}
                  onClick={() => {
                    setDeskLeftTab('users')
                    setDeskEpisodeFocus(null)
                    setRightRailMode('yahoo')
                    setLogCollapsedPersist(false)
                    void loadDeskDevices()
                  }}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-semibold transition-colors',
                    deskUsersMode
                      ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span>Users</span>
                  <span className="tabular-nums opacity-70">
                    {deskDevices.length}
                  </span>
                </button>
              </div>
            ) : (
              <div className="space-y-1.5 px-1 pb-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-tight">
                      {assetClassLabel}
                    </p>
                    <p
                      className="truncate text-[11px] tabular-nums text-muted-foreground"
                      title={
                        monitoredSourceTable
                          ? `Source · ${monitoredSourceTable} + momentum episodes`
                          : undefined
                      }
                    >
                      {entityListUpdatingFromSupabase ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="size-3 animate-spin" />
                          Updating from Supabase
                        </span>
                      ) : (
                        `${filteredDisplayedEntities.length} ticker${
                          filteredDisplayedEntities.length === 1 ? '' : 's'
                        }${
                          entityListPrefs.show === 'subscribers' &&
                          entityListPrefs.momentum === 'any' &&
                          entityListPrefs.sort === 'name' &&
                          !entityListQuery.trim()
                            ? ' · with subscribers'
                            : entityListPrefs.show === 'all' &&
                                entityListPrefs.momentum === 'any' &&
                                entityListPrefs.sort === 'name' &&
                                !entityListQuery.trim()
                              ? ' · all'
                              : entityFilterActive
                                ? ' · filtered'
                                : monitoredSourceTable
                                  ? ' · monitored'
                                  : ''
                        }`
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant={entityListSearchOpen ? 'secondary' : 'outline'}
                      size="icon-sm"
                      onClick={() =>
                        setEntityListSearchOpen((open) => {
                          const next = !open
                          if (!next) setEntityListQuery('')
                          return next
                        })
                      }
                      title="Search tickers"
                      aria-label="Search tickers"
                      aria-pressed={entityListSearchOpen}
                    >
                      <Search className="size-3.5" strokeWidth={2.25} />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={monitoredLoading}
                      onClick={() => void loadMonitoredTickers()}
                      title="Refresh monitored tickers"
                      aria-label="Refresh monitored tickers"
                    >
                      {monitoredLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" strokeWidth={2.25} />
                      )}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant={entityFilterActive ? 'secondary' : 'outline'}
                          size="icon-sm"
                          title="Filter tickers"
                          aria-label="Filter tickers"
                        >
                          <ListFilter
                            className="size-3.5"
                            strokeWidth={2.25}
                          />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel>Show</DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                          checked={entityListPrefs.show === 'subscribers'}
                          onCheckedChange={() =>
                            updateEntityListPrefs({ show: 'subscribers' })
                          }
                        >
                          Subscribers only
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={entityListPrefs.show === 'all'}
                          onCheckedChange={() =>
                            updateEntityListPrefs({ show: 'all' })
                          }
                        >
                          All {assetClassLabel}
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Momentum</DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                          checked={entityListPrefs.momentum === 'any'}
                          onCheckedChange={() =>
                            updateEntityListPrefs({ momentum: 'any' })
                          }
                        >
                          Any
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={entityListPrefs.momentum === 'active'}
                          onCheckedChange={() =>
                            updateEntityListPrefs({ momentum: 'active' })
                          }
                        >
                          Active episode only
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={entityListPrefs.momentum === 'inactive'}
                          onCheckedChange={() =>
                            updateEntityListPrefs({ momentum: 'inactive' })
                          }
                        >
                          No active episode
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Sort</DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                          checked={entityListPrefs.sort === 'name'}
                          onCheckedChange={() =>
                            updateEntityListPrefs({ sort: 'name' })
                          }
                        >
                          Alphabetical A–Z
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={
                            entityListPrefs.sort === 'subscribers_desc'
                          }
                          onCheckedChange={() =>
                            updateEntityListPrefs({
                              sort: 'subscribers_desc',
                            })
                          }
                        >
                          High subscribers first
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={
                            entityListPrefs.sort === 'subscribers_asc'
                          }
                          onCheckedChange={() =>
                            updateEntityListPrefs({
                              sort: 'subscribers_asc',
                            })
                          }
                        >
                          Low subscribers first
                        </DropdownMenuCheckboxItem>
                        {entityFilterActive ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                updateEntityListPrefs({
                                  ...DEFAULT_ENTITY_LIST_PREFS,
                                })
                                setEntityListQuery('')
                                setEntityListSearchOpen(false)
                              }}
                            >
                              Reset filters
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                {entityListSearchOpen ? (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={entityListSearchRef}
                      value={entityListQuery}
                      onChange={(e) => {
                        setEntityListQuery(e.target.value)
                        setEntityYahooHighlight(0)
                      }}
                      placeholder={`Search ${assetClassLabel.toLowerCase()}…`}
                      className="h-8 pl-8 pr-8 text-[12px]"
                      aria-label={`Search ${assetClassLabel}`}
                      role="combobox"
                      aria-expanded={Boolean(entityListQuery.trim())}
                      aria-controls="entity-yahoo-search-results"
                      aria-autocomplete="list"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setEntityListQuery('')
                          setEntityListSearchOpen(false)
                          return
                        }
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          setEntityYahooHighlight((index) =>
                            entityYahooResults.length
                              ? Math.min(
                                  index + 1,
                                  entityYahooResults.length - 1,
                                )
                              : 0,
                          )
                          return
                        }
                        if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          setEntityYahooHighlight((index) =>
                            Math.max(index - 1, 0),
                          )
                          return
                        }
                        if (
                          event.key === 'Enter' &&
                          entityYahooResults[entityYahooHighlight]
                        ) {
                          event.preventDefault()
                          pickEntityYahooResult(
                            entityYahooResults[entityYahooHighlight],
                          )
                        }
                      }}
                    />
                    {entityListQuery ? (
                      <button
                        type="button"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                        aria-label="Clear search"
                        onClick={() => setEntityListQuery('')}
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}

                    {entityListQuery.trim() ? (
                      <div
                        id="entity-yahoo-search-results"
                        role="listbox"
                        aria-label={`Yahoo Finance ${assetClassLabel} results`}
                        className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-2.5 py-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Yahoo Finance · {assetClassLabel}
                          </span>
                          {entityYahooLoading ? (
                            <Loader2 className="size-3 animate-spin text-muted-foreground" />
                          ) : null}
                        </div>

                        {!entityYahooLoading && entityYahooError ? (
                          <div className="px-2.5 py-2 text-[11px] leading-snug text-destructive">
                            {entityYahooError}
                          </div>
                        ) : null}

                        {!entityYahooLoading &&
                        !entityYahooError &&
                        !entityYahooResults.length ? (
                          <div className="px-2.5 py-2.5">
                            <p className="text-[11px] font-medium text-foreground">
                              No {assetClassLabel.toLowerCase()} found
                            </p>
                            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                              Try a company, fund, currency, coin or Yahoo symbol.
                            </p>
                          </div>
                        ) : null}

                        {entityYahooResults.map((row, index) => {
                          const ticker = normalizeWatchTicker(row.ticker)
                          const name =
                            row.companyName ||
                            row.longName ||
                            row.shortName ||
                            row.label ||
                            ticker
                          const inList =
                            displayedEntities.some(
                              (tab) =>
                                tab.ticker.toUpperCase() ===
                                ticker.toUpperCase(),
                            ) ||
                            watchlist.some(
                              (tab) =>
                                tab.ticker.toUpperCase() ===
                                ticker.toUpperCase(),
                            )
                          const active = index === entityYahooHighlight
                          return (
                            <button
                              key={`${ticker}-${row.exchange || ''}-${index}`}
                              type="button"
                              role="option"
                              aria-selected={active}
                              onMouseEnter={() =>
                                setEntityYahooHighlight(index)
                              }
                              onClick={() => pickEntityYahooResult(row)}
                              className={cn(
                                'flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors',
                                active ? 'bg-muted' : 'hover:bg-muted/70',
                              )}
                            >
                              <CompanyLogo
                                ticker={ticker}
                                companyName={name}
                                size="sm"
                                className="size-7 bg-background"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="truncate font-mono text-[12px] font-semibold">
                                    {ticker}
                                  </span>
                                  <span className="shrink-0 rounded bg-muted px-1 py-px text-[8px] font-semibold uppercase text-muted-foreground">
                                    {quoteTypeLabel(row)}
                                  </span>
                                </span>
                                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                  {[name, row.exchange]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </span>
                              <span className="mt-1 shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {inList ? 'Open' : 'Add'}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-0.5 px-2 pb-2 pt-1">
              {deskUsersMode ? (
                deskDevicesError ? (
                  <p className="px-2 py-6 text-center text-xs text-destructive">
                    {deskDevicesError}
                  </p>
                ) : deskDevicesLoading && !deskDevices.length ? (
                  <div className="flex items-center justify-center gap-2 px-2 py-8 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading users…
                  </div>
                ) : !deskDevices.length ? (
                  <div className="space-y-1 px-2 py-8 text-center">
                    <Users
                      className="mx-auto size-5 text-muted-foreground/70"
                      strokeWidth={1.5}
                    />
                    <p className="text-xs font-medium text-foreground">
                      No users yet
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Trigger devices with monitored tickers appear here.
                    </p>
                  </div>
                ) : (
                  deskDevices.map((device) => {
                    const key = deskDeviceKey(device)
                    const active =
                      deskUserFocus != null &&
                      deskDeviceKey(deskUserFocus) === key
                    return (
                      <DeskUserListButton
                        key={key || String(device.expo_push_token)}
                        device={device}
                        active={active}
                        onClick={() => selectDeskUser(device)}
                      />
                    )
                  })
                )
              ) : leftShowsActiveEpisodes ? (
                activeEpisodesError ? (
                  <p className="px-2 py-6 text-center text-xs text-destructive">
                    {activeEpisodesError}
                  </p>
                ) : activeEpisodesLoading && !activeEpisodesList.length ? (
                  <div className="flex items-center justify-center gap-2 px-2 py-8 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading active episodes…
                  </div>
                ) : !activeEpisodesList.length ? (
                  <div className="space-y-1 px-2 py-8 text-center">
                    <Activity
                      className="mx-auto size-5 text-muted-foreground/70"
                      strokeWidth={1.5}
                    />
                    <p className="text-xs font-medium text-foreground">
                      No active episodes
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Live momentum episodes across all asset classes appear
                      here. Pick Stocks / Crypto / … below to browse markets.
                    </p>
                  </div>
                ) : (
                  activeEpisodesList.map((row) => {
                    const ticker = String(row.ticker || '')
                      .trim()
                      .toUpperCase()
                    const active =
                      ticker === String(displayTicker || '').toUpperCase()
                    const dirUp = row.direction !== 'DOWN'
                    const move =
                      row.currentMovePercent ?? row.peakMovePercent ?? null
                    const no = formatEpisodeNo(row.episodeNo)
                    return (
                      <Button
                        key={String(
                          row.episodeId ||
                            `${ticker}-${row.episodeStartedAt || ''}`,
                        )}
                        type="button"
                        variant="ghost"
                        data-pill="false"
                        onClick={() => selectActiveEpisodeFromLeft(row)}
                        className={cn(
                          'h-auto min-h-10 w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left',
                          active && 'bg-muted hover:bg-muted',
                        )}
                      >
                        <CompanyLogo
                          ticker={ticker}
                          companyName={
                            watchQuotes[ticker]?.longName ||
                            watchQuotes[ticker]?.shortName ||
                            ticker
                          }
                          quote={
                            watchQuotes[ticker] ||
                            watchQuotes[ticker.toUpperCase()] ||
                            null
                          }
                          size="sm"
                          className="self-center"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[12px] font-semibold tracking-tight">
                              {ticker}
                            </span>
                            {no ? (
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {no}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {String(row.direction || '—')} ·{' '}
                            {row.detectedWindow || '—'}
                            {row.state
                              ? ` · ${String(row.state).replace(/^MOMENTUM_/, '')}`
                              : ''}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 text-[11px] font-semibold tabular-nums',
                            dirUp
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400',
                          )}
                        >
                          {move == null || !Number.isFinite(Number(move))
                            ? '—'
                            : `${Number(move) > 0 ? '+' : ''}${Number(move).toFixed(2)}%`}
                        </span>
                      </Button>
                    )
                  })
                )
              ) : displayedEntities.length === 0 ? (
                <div className="space-y-1 px-2 py-8 text-center">
                  <p className="text-xs font-medium text-foreground">
                    No {assetClassLabel.toLowerCase()} yet
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Showing device-monitored tickers and momentum episodes only.
                  </p>
                </div>
              ) : filteredDisplayedEntities.length === 0 ? (
                <div className="space-y-1 px-2 py-8 text-center">
                  <p className="text-xs font-medium text-foreground">
                    No matching {assetClassLabel.toLowerCase()}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {entityListPrefs.show === 'subscribers'
                      ? 'Default list hides tickers with 0 subscribers. Open Filter → All ' +
                        assetClassLabel +
                        ' to see everything.'
                      : 'Try clearing search or resetting filters.'}
                  </p>
                </div>
              ) : (
                filteredDisplayedEntities.map((tab) => {
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
                  const subCount =
                    tab.subscriberCount != null &&
                    Number.isFinite(Number(tab.subscriberCount))
                      ? Math.max(0, Math.floor(Number(tab.subscriberCount)))
                      : null
                  return (
                    <div
                      key={tab.ticker}
                      className={cn(
                        'w-full rounded-md',
                        active && 'bg-muted',
                      )}
                      onContextMenu={(e) => {
                        const isUser =
                          watchlist.some(
                            (row) =>
                              row.ticker.toUpperCase() ===
                              tab.ticker.toUpperCase(),
                          ) && watchlist.length > 1
                        if (!isUser) return
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
                          if (
                            !watchlist.some(
                              (row) =>
                                row.ticker.toUpperCase() ===
                                tab.ticker.toUpperCase(),
                            )
                          ) {
                            addWatchTicker(tab)
                          } else {
                            selectTicker(tab.ticker)
                          }
                        }}
                        className={cn(
                          'h-auto min-h-10 w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left',
                          active && 'bg-transparent hover:bg-transparent',
                          // Blink only when day % crosses configured day threshold
                          hotBlinkClass(dayPct, thrSnap?.day ?? null, 'day'),
                        )}
                        title={
                          [
                            tab.ticker,
                            fullName && fullName !== tab.ticker ? fullName : '',
                            subCount != null
                              ? `${subCount} subscriber${subCount === 1 ? '' : 's'}`
                              : '0 subscribers',
                            hasActiveEp
                              ? `active ${epHint!.direction} episode${epHint!.window ? ` (${epHint!.window})` : ''}`
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')
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
                              <SubscriberHoverCard
                                ticker={tab.ticker}
                                count={subCount ?? 0}
                              >
                                <span
                                  className="inline-flex shrink-0 cursor-help items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground ring-1 ring-border/60"
                                  aria-label={`${subCount ?? 0} subscriber${(subCount ?? 0) === 1 ? '' : 's'}`}
                                >
                                  <Users
                                    className="size-2.5 shrink-0"
                                    strokeWidth={1.75}
                                  />
                                  <span className="font-mono text-[10px] font-semibold tabular-nums leading-none">
                                    {subCount ?? 0}
                                  </span>
                                </span>
                              </SubscriberHoverCard>
                            </span>
                            <span
                              className={cn(
                                'inline-flex min-w-9 shrink-0 items-center justify-end tabular-nums text-[14px] font-semibold',
                                dayPct != null
                                  ? pctColor(dayPct)
                                  : 'text-muted-foreground',
                              )}
                            >
                              {dayPct != null ? (
                                fmtPct(dayPct)
                              ) : (
                                <Loader2
                                  className="size-3.5 animate-spin"
                                  aria-label={`Loading ${tab.ticker} daily change`}
                                />
                              )}
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
        ) : null}

        {/* Right stack: detail · optional log */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Column 2 — users activity · all episodes · or focused episode detail */}
        <div
          className={cn(
            'mom-hide-scrollbar min-h-0 min-w-0 overflow-y-auto',
            'flex-1',
          )}
        >
          {deskUsersMode ? (
            <div className="flex h-full min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
              <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">{deskHomeTabs}</div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="size-7"
                    onClick={() => void loadDeskDevices()}
                    disabled={deskDevicesLoading}
                    title="Refresh all users"
                    aria-label="Refresh all users"
                  >
                    <RefreshCw
                      className={cn(
                        'size-3.5',
                        deskDevicesLoading && 'animate-spin',
                      )}
                    />
                  </Button>
                </div>
              </div>

              <div className="mom-hide-scrollbar min-h-0 flex-1 overflow-y-auto">
                  {deskDevicesError ? (
                    <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-8 text-center text-xs text-destructive">
                      {deskDevicesError}
                    </p>
                  ) : deskDevicesLoading && !deskDevices.length ? (
                    <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-16 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Loading users…
                    </div>
                  ) : !deskDevices.length ? (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-16 text-center">
                      <Users
                        className="size-6 text-muted-foreground/70"
                        strokeWidth={1.5}
                      />
                      <p className="text-sm font-medium">No users yet</p>
                      <p className="max-w-sm text-[12px] text-muted-foreground">
                        Trigger devices with monitored tickers appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-1">
                      {deskDevices.map((device) => {
                        const key = deskDeviceKey(device)
                        const active =
                          deskUserFocus != null &&
                          deskDeviceKey(deskUserFocus) === key
                        return (
                          <DeskUserListButton
                            key={key || String(device.expo_push_token)}
                            device={device}
                            active={active}
                            onClick={() => selectDeskUser(device)}
                          />
                        )
                      })}
                    </div>
                  )}
              </div>
            </div>
          ) : deskBulletinsMode ? (
            <div className="flex h-full min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
              <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">{deskHomeTabs}</div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-[11px]"
                    disabled={!deskBulletinFocus && !deskBulletins.length}
                    onClick={() => {
                      if (!deskBulletinFocus && deskBulletins[0]) {
                        setDeskBulletinFocus(deskBulletins[0])
                      }
                      setDeskBulletinPromptOpen(true)
                    }}
                    title="Show the exact Perplexity market-research prompt"
                    aria-label="Show Perplexity market research prompt"
                  >
                    <Info className="size-3.5" strokeWidth={1.9} />
                    Prompt
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="size-7"
                    onClick={() => void loadDeskBulletins()}
                    disabled={deskBulletinsLoading}
                    title="Refresh market bulletins"
                    aria-label="Refresh market bulletins"
                  >
                    <RefreshCw
                      className={cn(
                        'size-3.5',
                        deskBulletinsLoading && 'animate-spin',
                      )}
                    />
                  </Button>
                </div>
              </div>

              <div className="mom-hide-scrollbar min-h-0 flex-1 overflow-y-auto">
                {deskBulletinsError ? (
                  <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-8 text-center text-xs text-destructive">
                    {deskBulletinsError}
                  </p>
                ) : deskBulletinsLoading && !deskBulletins.length ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-16 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading market bulletins…
                  </div>
                ) : !deskBulletins.length ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-16 text-center">
                    <Newspaper
                      className="size-6 text-muted-foreground/70"
                      strokeWidth={1.5}
                    />
                    <p className="text-sm font-medium">No market bulletins yet</p>
                    <p className="max-w-sm text-[12px] text-muted-foreground">
                      US and India OPEN / CLOSE pushes with Perplexity research
                      appear here after they fire.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1">
                    {deskBulletins.map((row) => {
                      const active = deskBulletinFocus?.id === row.id
                      const marketLabel =
                        String(row.market || '').toLowerCase() === 'india'
                          ? 'India'
                          : 'US'
                      const slotLabel = String(row.slot || '').toUpperCase()
                      const dayPct =
                        row.day_change_percent != null &&
                        Number.isFinite(Number(row.day_change_percent))
                          ? Number(row.day_change_percent)
                          : null
                      return (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => selectDeskBulletin(row)}
                          className={cn(
                            'flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors',
                            active
                              ? 'border-border bg-muted'
                              : 'border-transparent hover:bg-muted/60',
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-semibold leading-tight">
                              {row.title || `${marketLabel} market ${slotLabel}`}
                            </span>
                            <Badge
                              variant="outline"
                              className="ml-auto shrink-0 text-[10px] font-semibold uppercase"
                            >
                              {marketLabel} · {slotLabel}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span className="tabular-nums">
                              {row.session_date || '—'}
                            </span>
                            {dayPct != null ? (
                              <span
                                className={cn(
                                  'tabular-nums font-medium',
                                  dayPct > 0
                                    ? 'text-emerald-600'
                                    : dayPct < 0
                                      ? 'text-rose-600'
                                      : '',
                                )}
                              >
                                {dayPct > 0 ? '+' : ''}
                                {dayPct.toFixed(2)}%
                              </span>
                            ) : null}
                            <span className="truncate">
                              {row.body_source === 'perplexity'
                                ? 'Perplexity'
                                : row.body_source || 'body'}
                            </span>
                            <span className="tabular-nums">
                              push {Number(row.push_sent_ok) || 0}/
                              {Number(row.recipient_count) || 0}
                            </span>
                          </div>
                          {row.body ? (
                            <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                              {row.body}
                            </p>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : showAllEpisodesCenter ? (
            <div className="flex h-full min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
              <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  {deskHomeTabs}
                  <UpdatingFromSupabaseNote
                    show={allEpisodesUpdatingFromSupabase}
                    className="mt-1"
                  />
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {allEpisodesSearchOpen ? (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={allEpisodesQuery}
                        onChange={(e) => setAllEpisodesQuery(e.target.value)}
                        placeholder="Ticker…"
                        aria-label="Search All episodes by ticker"
                        className="h-7 w-[8.5rem] pl-7 pr-7 text-[12px]"
                        autoFocus
                      />
                      {allEpisodesQuery ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="absolute right-0.5 top-1/2 size-6 -translate-y-1/2"
                          aria-label="Clear ticker search"
                          onClick={() => setAllEpisodesQuery('')}
                        >
                          <X className="size-3" />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="absolute right-0.5 top-1/2 size-6 -translate-y-1/2"
                          aria-label="Close ticker search"
                          onClick={() => {
                            setAllEpisodesSearchOpen(false)
                            setAllEpisodesQuery('')
                          }}
                        >
                          <X className="size-3" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className="size-7"
                      title="Search by ticker"
                      aria-label="Search All episodes by ticker"
                      onClick={() => setAllEpisodesSearchOpen(true)}
                    >
                      <Search className="size-3.5" />
                    </Button>
                  )}
                  {activeEpisodesList.length > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 gap-1.5 text-rose-700 hover:border-rose-300 hover:bg-rose-500/10 hover:text-rose-800 dark:text-rose-400"
                      disabled={
                        endingEpisode ||
                        allEpisodesLoading ||
                        allEpisodesUpdatingFromSupabase
                      }
                      title="End all active episodes (no push)"
                      aria-label="End all active episodes"
                      onClick={() => void endAllActiveEpisodes()}
                    >
                      {endingEpisode ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          Ending…
                        </>
                      ) : (
                        <>
                          <X className="size-3.5" strokeWidth={2} />
                          End all
                          {activeEpisodesList.length
                            ? ` · ${activeEpisodesList.length}`
                            : ''}
                        </>
                      )}
                    </Button>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 gap-1.5"
                        title="Sort and filter All episodes"
                      >
                        <ArrowUpDown className="size-3.5" />
                        Sort
                        {allEpisodesLiveOnly || allEpisodesEndedOnly ? (
                          <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                            {(allEpisodesLiveOnly ? 1 : 0) +
                              (allEpisodesEndedOnly ? 1 : 0)}
                          </span>
                        ) : null}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                      {ALL_EPISODES_SORT_OPTIONS.map((opt) => (
                        <DropdownMenuCheckboxItem
                          key={opt.key}
                          checked={allEpisodesSortKey === opt.key}
                          onCheckedChange={() =>
                            setAllEpisodesSortKey(opt.key)
                          }
                        >
                          {opt.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Direction</DropdownMenuLabel>
                      <DropdownMenuCheckboxItem
                        checked={allEpisodesSortDir === 'desc'}
                        onCheckedChange={() => setAllEpisodesSortDir('desc')}
                      >
                        <ArrowDown className="mr-1.5 size-3.5" />
                        High → low / newest
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={allEpisodesSortDir === 'asc'}
                        onCheckedChange={() => setAllEpisodesSortDir('asc')}
                      >
                        <ArrowUp className="mr-1.5 size-3.5" />
                        Low → high / oldest
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Filters</DropdownMenuLabel>
                      <DropdownMenuCheckboxItem
                        checked={allEpisodesLiveOnly}
                        onCheckedChange={(v) =>
                          setAllEpisodesLiveOnly(Boolean(v))
                        }
                      >
                        Live only
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={allEpisodesEndedOnly}
                        onCheckedChange={(v) =>
                          setAllEpisodesEndedOnly(Boolean(v))
                        }
                      >
                        Ended only
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1.5"
                    disabled={
                      allEpisodesLoading || allEpisodesUpdatingFromSupabase
                    }
                    title="Force refresh from Supabase"
                    onClick={() => void loadAllEpisodesHistory({ refresh: true })}
                  >
                    {allEpisodesLoading || allEpisodesUpdatingFromSupabase ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Refresh
                  </Button>
                </div>
              </div>

              {allEpisodesError ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">
                  {allEpisodesError}
                </p>
              ) : null}

              {allEpisodesLoading &&
              !allEpisodesList.length &&
              !allEpisodesUpdatingFromSupabase ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading episodes…
                </div>
              ) : allEpisodesUpdatingFromSupabase && !allEpisodesList.length ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Updating from Supabase…
                </div>
              ) : !allEpisodesList.length ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-16 text-center">
                  <Activity
                    className="size-6 text-muted-foreground/70"
                    strokeWidth={1.5}
                  />
                  <p className="text-sm font-medium">No episodes yet</p>
                  <p className="max-w-sm text-[12px] text-muted-foreground">
                    When momentum episodes open or close, they appear here. Live
                    actives also show in the left column.
                  </p>
                </div>
              ) : (
                <>
              {!filteredAllEpisodesList.length ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-16 text-center">
                  <Search
                    className="size-6 text-muted-foreground/70"
                    strokeWidth={1.5}
                  />
                  <p className="text-sm font-medium">No matching tickers</p>
                  <p className="max-w-sm text-[12px] text-muted-foreground">
                    No episodes match “{allEpisodesQuery.trim()}”. Clear search
                    to see the full list.
                  </p>
                </div>
              ) : (
                <TooltipProvider delayDuration={200}>
                <div className="hidden">
                  {filteredAllEpisodesList.map((row) => {
                    const ticker = String(row.ticker || '')
                      .trim()
                      .toUpperCase()
                    const isLive =
                      String(row.status || '').toUpperCase() === 'ACTIVE'
                    const up = row.direction !== 'DOWN'
                    const peakMove =
                      row.peakMovePercent ?? row.currentMovePercent ?? null
                    const nowMove = row.currentMovePercent ?? null
                    const no = formatEpisodeNo(row.episodeNo)
                    const navKey = deskEpisodeNavKey(row)
                    const selected =
                      deskEpisodeFocus != null &&
                      deskEpisodeNavKey(deskEpisodeFocus) === navKey
                    return (
                      <Button
                        key={navKey || `${ticker}-${row.episodeStartedAt || ''}`}
                        type="button"
                        variant="ghost"
                        data-pill="false"
                        data-episode-nav-key={navKey}
                        onClick={() => selectActiveEpisodeFromLeft(row)}
                        className={cn(
                          'h-auto min-h-[4.5rem] w-full items-start justify-start gap-2 rounded-xl border border-transparent px-2.5 py-2 text-left',
                          selected
                            ? 'border-border bg-muted shadow-sm hover:bg-muted'
                            : 'hover:border-border hover:bg-muted/60',
                        )}
                      >
                        <CompanyLogo
                          ticker={ticker}
                          companyName={
                            watchQuotes[ticker]?.longName ||
                            watchQuotes[ticker]?.shortName ||
                            ticker
                          }
                          quote={watchQuotes[ticker] || null}
                          size="sm"
                          className="mt-0.5 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-mono text-[13px] font-semibold tracking-tight">
                              {ticker || '—'}
                            </span>
                            {no ? (
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                {no}
                              </span>
                            ) : null}
                            <Badge
                              variant={isLive ? 'default' : 'outline'}
                              className="ml-auto h-5 shrink-0 px-1.5 text-[9px]"
                            >
                              {isLive ? 'Live' : 'Ended'}
                            </Badge>
                          </span>
                          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span
                              className={cn(
                                'size-1.5 shrink-0 rounded-full',
                                up ? 'bg-emerald-500' : 'bg-rose-500',
                              )}
                            />
                            <span className="truncate">
                              {String(row.direction || '—')} ·{' '}
                              {row.detectedWindow || 'No window'}
                            </span>
                            <span className="ml-auto shrink-0 tabular-nums">
                              {fmtDateTime(row.episodeStartedAt) || '—'}
                            </span>
                          </span>
                          <span className="mt-1.5 flex items-center justify-between gap-3 text-[11px]">
                            <span className="text-muted-foreground">
                              Peak{' '}
                              <span className={cn('font-semibold tabular-nums', pctColor(peakMove))}>
                                {peakMove == null ? '—' : fmtPct(peakMove)}
                              </span>
                            </span>
                            <span className="text-muted-foreground">
                              Now{' '}
                              <span className={cn('font-semibold tabular-nums', pctColor(nowMove))}>
                                {nowMove == null ? '—' : fmtPct(nowMove)}
                              </span>
                            </span>
                          </span>
                        </span>
                      </Button>
                    )
                  })}
                </div>
                <div className="mom-hide-scrollbar min-h-0 flex-1 overflow-auto rounded-xl border border-border">
                  <table className="w-full table-fixed text-[12px]">
                    <colgroup>
                      <col className="w-[20%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[11%]" />
                      <col className="w-[12%]" />
                      <col className="w-[9%]" />
                      <col className="w-[20%]" />
                      <col className="w-[8%]" />
                    </colgroup>
                    <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                      <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th
                          className="px-4 py-2.5 text-left font-semibold"
                          title="Ticker · Yahoo session move so far (vs previous close)"
                        >
                          Ticker
                        </th>
                        <th
                          className="px-2 py-2.5 text-center font-semibold"
                          title="Actual alert recipients when recorded; otherwise current enabled ticker subscribers"
                        >
                          Subscribers
                        </th>
                        <th className="px-3 py-2.5 text-center font-semibold">
                          Status
                        </th>
                        <th className="px-3 py-2.5 text-center font-semibold">
                          Peak
                        </th>
                        <th className="px-3 py-2.5 text-center font-semibold">
                          Now
                        </th>
                        <th className="px-3 py-2.5 text-center font-semibold">
                          Window
                        </th>
                        <th className="px-3 py-2.5 text-center font-semibold">
                          Started
                        </th>
                        <th className="px-3 py-2.5 text-center font-semibold">
                          Episode
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAllEpisodesList.map((row) => {
                        const ticker = String(row.ticker || '')
                          .trim()
                          .toUpperCase()
                        const isLive =
                          String(row.status || '').toUpperCase() === 'ACTIVE'
                        const up = row.direction !== 'DOWN'
                        const peakMove =
                          row.peakMovePercent != null &&
                          Number.isFinite(Number(row.peakMovePercent))
                            ? Number(row.peakMovePercent)
                            : null
                        const nowMove =
                          row.currentMovePercent != null &&
                          Number.isFinite(Number(row.currentMovePercent))
                            ? Number(row.currentMovePercent)
                            : peakMove != null
                              ? peakMove
                              : row.initialMovePercent != null &&
                                  Number.isFinite(Number(row.initialMovePercent))
                                ? Number(row.initialMovePercent)
                                : null
                        const no = formatEpisodeNo(row.episodeNo)
                        const sourceTable =
                          String(row.sourceTable || '').trim() ||
                          expectedEpisodeSourceTable(ticker)
                        const sourceTableResolved = Boolean(row.sourceTable)
                        const sourceRowId =
                          String(row.sourceRowId || row.episodeId || '').trim() ||
                          'Unavailable'
                        const stateLabel = formatEpisodeState(
                          isLive ? row.state || row.status : row.status || row.state,
                        )
                        const liveStateLabel = isLive
                          ? formatEpisodeState(row.state) || 'Live'
                          : null
                        const subCount =
                          subscriberCountByTicker.get(ticker) ?? null
                        const recordedRecipientCount =
                          row.notificationRecipientCount != null &&
                          Number.isFinite(
                            Number(row.notificationRecipientCount),
                          )
                            ? Math.max(
                                0,
                                Math.floor(
                                  Number(row.notificationRecipientCount),
                                ),
                              )
                            : null
                        const displayedSubscriberCount =
                          recordedRecipientCount ?? subCount ?? 0
                        const quote =
                          watchQuotes[ticker] ||
                          watchQuotes[ticker.toUpperCase()] ||
                          null
                        const soFarPct = tabDayPct(ticker)
                        const rowSelected = deskEpisodeRowsMatch(
                          row,
                          deskEpisodeFocus,
                        )
                        const peakLabel =
                          peakMove == null
                            ? '—'
                            : `${peakMove > 0 ? '+' : ''}${peakMove.toFixed(2)}%`
                        const nowLabel =
                          nowMove == null
                            ? '—'
                            : `${nowMove > 0 ? '+' : ''}${nowMove.toFixed(2)}%`
                        return (
                          <tr
                            key={`${row.episodeId || ticker}-${row.episodeNo || row.episodeStartedAt}`}
                            data-episode-nav-key={deskEpisodeNavKey(row)}
                            className={cn(
                              'cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50',
                              rowSelected && 'bg-muted/70',
                            )}
                            onClick={() => selectActiveEpisodeFromLeft(row)}
                          >
                            <td className="px-4 py-2.5 text-left align-middle font-medium">
                              <span className="inline-flex max-w-full flex-wrap items-center justify-start gap-x-1.5 gap-y-0.5">
                                <CompanyLogo
                                  ticker={ticker}
                                  companyName={
                                    quote?.longName ||
                                    quote?.shortName ||
                                    ticker
                                  }
                                  quote={quote}
                                  size="sm"
                                />
                                <span className="truncate text-[13px] font-semibold tracking-tight">
                                  {ticker}
                                </span>
                                <span
                                  className={cn(
                                    'size-1.5 shrink-0 rounded-full',
                                    up ? 'bg-emerald-500' : 'bg-rose-500',
                                  )}
                                  title={up ? 'UP' : 'DOWN'}
                                  aria-label={up ? 'UP' : 'DOWN'}
                                />
                                <button
                                  type="button"
                                  className={cn(
                                    'border-0 bg-transparent p-0 text-[12px] font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-2',
                                    soFarPct != null
                                      ? pctColor(soFarPct)
                                      : 'text-muted-foreground',
                                  )}
                                  title="So Far · Yahoo session % · click opens Trigger share"
                                  aria-label={`Share ${ticker} So Far on Trigger`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    openSofarShareInTrigger(row, soFarPct)
                                  }}
                                >
                                  {soFarPct != null ? fmtPct(soFarPct) : '—'}
                                </button>
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-center align-middle">
                              <SubscriberHoverCard
                                ticker={ticker}
                                count={subCount ?? displayedSubscriberCount}
                              >
                                <span
                                  className="inline-flex cursor-help items-center justify-center gap-1 rounded-full bg-muted px-2 py-1 font-mono text-[11px] font-semibold tabular-nums text-foreground"
                                  aria-label={`${displayedSubscriberCount} subscribers for ${ticker}`}
                                >
                                  <Users className="size-3 text-muted-foreground" strokeWidth={1.9} />
                                  {displayedSubscriberCount}
                                </span>
                              </SubscriberHoverCard>
                            </td>
                            <td className="px-3 py-2.5 text-center align-middle">
                              <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
                                <Badge
                                  variant={isLive ? 'default' : 'outline'}
                                  className="text-[10px]"
                                >
                                  {isLive
                                    ? 'Live'
                                    : stateLabel || '—'}
                                </Badge>
                                {isLive ? (
                                  <button
                                    type="button"
                                    disabled={
                                      endingEpisode ||
                                      endingEpisodeTicker === ticker
                                    }
                                    title={`End active episode for ${ticker} (no push)`}
                                    aria-label={`End active episode for ${ticker}`}
                                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-rose-700 transition-colors hover:bg-rose-500/10 hover:text-rose-800 disabled:opacity-50 dark:text-rose-400"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      e.preventDefault()
                                      void endActiveEpisode({
                                        ticker,
                                        direction: row.direction,
                                        peakMovePercent:
                                          row.peakMovePercent ??
                                          row.currentMovePercent ??
                                          null,
                                      })
                                    }}
                                  >
                                    {endingEpisodeTicker === ticker ? (
                                      <Loader2 className="size-3 animate-spin" />
                                    ) : (
                                      <X className="size-3" strokeWidth={2.25} />
                                    )}
                                  </button>
                                ) : null}
                              </span>
                            </td>
                            <td
                              className={cn(
                                'px-3 py-2.5 text-center align-middle font-semibold tabular-nums',
                                pctColor(peakMove),
                              )}
                            >
                              {peakMove == null ? (
                                '—'
                              ) : (
                                <button
                                  type="button"
                                  className={cn(
                                    'cursor-pointer border-0 bg-transparent p-0 font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-2',
                                    pctColor(peakMove),
                                  )}
                                  title="Click: Trigger Peak research (calc details are on the timeline Peak chip)"
                                  aria-label={`${peakLabel} peak — click for Trigger research`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    void openEpisodeShareInTrigger(row, 'peak')
                                  }}
                                >
                                  {peakLabel}
                                </button>
                              )}
                            </td>
                            <td
                              className={cn(
                                'px-3 py-2.5 text-center align-middle font-semibold tabular-nums',
                                pctColor(nowMove),
                              )}
                            >
                              <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
                                {nowMove == null ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <button
                                    type="button"
                                    className={cn(
                                      'cursor-pointer border-0 bg-transparent p-0 font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-2',
                                      pctColor(nowMove),
                                    )}
                                    title="Click: open Trigger share (calc details are on the timeline)"
                                    aria-label={`${nowLabel} now — click to share`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      e.preventDefault()
                                      void openEpisodeShareInTrigger(row, 'now')
                                    }}
                                  >
                                    {nowLabel}
                                  </button>
                                )}
                                {liveStateLabel ? (
                                  <span
                                    className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-wide text-muted-foreground"
                                    title="Live episode state"
                                  >
                                    {liveStateLabel}
                                  </span>
                                ) : null}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center align-middle text-muted-foreground">
                              {row.detectedWindow || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-center align-middle tabular-nums text-muted-foreground">
                              {fmtTimeDate(row.episodeStartedAt) || '—'}
                            </td>
                            <td className="px-3 py-2.5 text-center align-middle tabular-nums text-muted-foreground">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex cursor-help items-center rounded-md px-1.5 py-0.5 font-medium underline decoration-dotted decoration-muted-foreground/60 underline-offset-2">
                                    {no || '—'}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="left"
                                  align="center"
                                  className="w-[22rem] max-w-[calc(100vw-2rem)] p-3 text-left"
                                >
                                  <p className="text-[12px] font-semibold">
                                    Supabase source row
                                  </p>
                                  <div className="mt-2 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[11px]">
                                    <span className="opacity-70">Table</span>
                                    <code className="break-all font-mono font-semibold">
                                      public.{sourceTable}
                                    </code>
                                    <span className="opacity-70">Row key</span>
                                    <code className="break-all font-mono">
                                      episode_id = {sourceRowId}
                                    </code>
                                    <span className="opacity-70">Ticker</span>
                                    <code className="font-mono">{ticker}</code>
                                    <span className="opacity-70">Episode</span>
                                    <code className="font-mono">
                                      {no || 'No episode_no'}
                                    </code>
                                  </div>
                                  {!sourceTableResolved ? (
                                    <p className="mt-2 border-t border-current/20 pt-2 text-[10px] opacity-70">
                                      Table asset class se inferred hai; next Supabase
                                      refresh exact source metadata confirm karega.
                                    </p>
                                  ) : null}
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                </TooltipProvider>
              )}
              {allEpisodesHasMore ? (
                <div className="mt-2 flex shrink-0 justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={allEpisodesLoadingMore}
                    onClick={() =>
                      void loadAllEpisodesHistory({
                        offset:
                          allEpisodesNextOffset ?? allEpisodesList.length,
                      })
                    }
                  >
                    {allEpisodesLoadingMore ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Load more
                    {allEpisodesTotal
                      ? ` · ${allEpisodesList.length} of ${allEpisodesTotal}`
                      : ''}
                  </Button>
                </div>
              ) : allEpisodesList.length > 0 && allEpisodesTotal > 0 ? (
                <p className="mt-2 shrink-0 text-center text-[11px] text-muted-foreground">
                  {allEpisodesList.length} of {allEpisodesTotal} episodes
                </p>
              ) : null}
                </>
              )}
            </div>
          ) : !hasSelectedTicker ? (
            <div className="flex h-full min-h-[24rem] flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <LineChart
                className="size-8 text-muted-foreground/45"
                strokeWidth={1.5}
              />
              <p className="text-sm font-semibold text-foreground">
                Select a ticker
              </p>
              <p className="max-w-sm text-[12px] leading-relaxed text-muted-foreground">
                Choose one from the {assetClassLabel.toLowerCase()} list to open
                rolling returns and episodes here.
              </p>
            </div>
          ) : (
          <div className="w-full space-y-4 px-3 py-3 sm:px-4 sm:py-4">
          {showCompactMarketStrip && !leftShowsActiveEpisodes ? (
            <div className="rounded-xl border border-border bg-muted/20 p-2">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">
                    {assetClassLabel}
                  </p>
                  <p className="text-[10px] tabular-nums text-muted-foreground">
                    {entityListUpdatingFromSupabase ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="size-2.5 animate-spin" />
                        Updating from Supabase
                      </span>
                    ) : (
                      `${filteredDisplayedEntities.length} ticker${
                        filteredDisplayedEntities.length === 1 ? '' : 's'
                      }`
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant={entityListSearchOpen ? 'secondary' : 'outline'}
                    size="icon-sm"
                    className="h-7 w-7"
                    onClick={() =>
                      setEntityListSearchOpen((open) => {
                        const next = !open
                        if (!next) setEntityListQuery('')
                        return next
                      })
                    }
                    title="Search tickers"
                    aria-label="Search tickers"
                  >
                    <Search className="size-3.5" strokeWidth={2.25} />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="h-7 w-7"
                    disabled={monitoredLoading}
                    onClick={() => void loadMonitoredTickers()}
                    title="Refresh monitored tickers"
                    aria-label="Refresh monitored tickers"
                  >
                    {monitoredLoading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" strokeWidth={2.25} />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1.5 px-2.5 text-[11px]"
                    onClick={() => setAddOpen((open) => !open)}
                  >
                    <Plus className="size-3.5" strokeWidth={2.25} />
                    Add
                  </Button>
                </div>
              </div>

              <div className="mom-hide-scrollbar flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
                {filteredDisplayedEntities.length === 0 ? (
                  <p className="px-2 py-2.5 text-[11px] text-muted-foreground">
                    No tickers match this filter.
                  </p>
                ) : (
                  filteredDisplayedEntities.map((tab) => {
                    const ticker = tab.ticker.toUpperCase()
                    const active = ticker === displayTicker.toUpperCase()
                    const dayPct = tabDayPct(ticker)
                    const rowQuote =
                      watchQuotes[ticker] ||
                      watchQuotes[tab.ticker] ||
                      (active ? tabQuote : null)
                    const subscriberCount =
                      tab.subscriberCount != null &&
                      Number.isFinite(Number(tab.subscriberCount))
                        ? Math.max(0, Math.floor(Number(tab.subscriberCount)))
                        : null
                    return (
                      <button
                        key={ticker}
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => {
                          setWatchContextMenu(null)
                          if (
                            !watchlist.some(
                              (row) => row.ticker.toUpperCase() === ticker,
                            )
                          ) {
                            addWatchTicker(tab)
                          } else {
                            selectTicker(ticker)
                          }
                        }}
                        onContextMenu={(event) => {
                          const canRemove =
                            watchlist.some(
                              (row) => row.ticker.toUpperCase() === ticker,
                            ) && watchlist.length > 1
                          if (!canRemove) return
                          event.preventDefault()
                          event.stopPropagation()
                          setWatchContextMenu({
                            ticker,
                            label: String(tab.label || ticker),
                            x: event.clientX,
                            y: event.clientY,
                          })
                        }}
                        className={cn(
                          'flex h-10 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-left transition-colors',
                          active
                            ? 'border-foreground/20 bg-background text-foreground shadow-sm'
                            : 'border-border bg-background/60 text-foreground hover:bg-background',
                          hotBlinkClass(dayPct, thrSnap?.day ?? null, 'day'),
                        )}
                        title={`${ticker} · ${subscriberCount ?? 0} subscribers`}
                      >
                        <CompanyLogo
                          ticker={ticker}
                          companyName={tab.label || ticker}
                          quote={rowQuote}
                          size="sm"
                        />
                        <span className="font-mono text-[12px] font-semibold">
                          {ticker}
                        </span>
                        <SubscriberHoverCard
                          ticker={ticker}
                          count={subscriberCount ?? 0}
                        >
                          <span className="inline-flex cursor-help items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground ring-1 ring-border/60">
                            <Users className="size-2.5" strokeWidth={1.75} />
                            {subscriberCount ?? 0}
                          </span>
                        </SubscriberHoverCard>
                        <span
                          className={cn(
                            'inline-flex min-w-8 items-center justify-end text-[11px] font-semibold tabular-nums',
                            dayPct != null
                              ? pctColor(dayPct)
                              : 'text-muted-foreground',
                          )}
                        >
                          {dayPct != null ? (
                            fmtPct(dayPct)
                          ) : (
                            <Loader2
                              className="size-3 animate-spin"
                              aria-label={`Loading ${ticker} daily change`}
                            />
                          )}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>

              {watchContextMenu ? (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-[60] cursor-default bg-transparent"
                    aria-label="Close menu"
                    onClick={() => setWatchContextMenu(null)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setWatchContextMenu(null)
                    }}
                  />
                  <div
                    role="menu"
                    className="fixed z-[70] min-w-[10.5rem] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
                    style={{
                      left: Math.min(
                        watchContextMenu.x,
                        window.innerWidth - 180,
                      ),
                      top: Math.min(
                        watchContextMenu.y,
                        window.innerHeight - 56,
                      ),
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
                      <Trash2
                        className="size-3.5 shrink-0"
                        strokeWidth={1.75}
                      />
                      Remove
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {leftShowsActiveEpisodes && deskEpisodeFocus ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
              <p className="truncate text-[12px] text-muted-foreground">
                Focused ·{' '}
                <span className="font-semibold text-foreground">
                  {String(deskEpisodeFocus.ticker || '').toUpperCase()}
                </span>
                {formatEpisodeNo(deskEpisodeFocus.episodeNo)
                  ? ` ${formatEpisodeNo(deskEpisodeFocus.episodeNo)}`
                  : ''}
                {' · '}
                {deskEpisodeFocus.detectedWindow || 'episode'}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={clearDeskEpisodeFocus}
              >
                Show all episodes
              </Button>
            </div>
          ) : null}
          {/* Row 1: left = logo + name + pricing · right = chart · top-right = subscribers */}
          {(() => {
            const companyName =
              activeTab?.label ||
              tabQuote?.longName ||
              tabQuote?.shortName ||
              displayTicker
            // Prefer watchlist API count (same source as left rail · N).
            // Fall back to loaded device list once detail fetch finishes.
            const tabSub =
              activeTab?.subscriberCount != null &&
              Number.isFinite(Number(activeTab.subscriberCount))
                ? Math.max(0, Math.floor(Number(activeTab.subscriberCount)))
                : null
            const subCount =
              tabSub != null
                ? tabSub
                : subsLoading
                  ? null
                  : tickerSubscribers.length
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
                      href={perplexityFinanceQuoteUrl(displayTicker)}
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
                    <YahooFinanceWithMarketState
                      marketState={tabQuote?.marketState}
                      className="self-center"
                    >
                      <a
                        href={yahooFinanceQuoteUrl(displayTicker)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        title={`Open ${displayTicker} on Yahoo Finance`}
                      >
                        Yahoo Finance
                      </a>
                    </YahooFinanceWithMarketState>
                    <SubscriberHoverCard
                      ticker={displayTicker}
                      count={subCount}
                    >
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
                        title={`${subCount ?? '…'} Trigger subscriber${subCount === 1 ? '' : 's'} for ${displayTicker}`}
                        aria-label={`View ${subCount ?? 0} subscribers for ${displayTicker}`}
                        aria-pressed={
                          !logCollapsed && rightRailMode === 'subscribers'
                        }
                      >
                        {subsLoading && subCount == null ? (
                          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <Users
                            className="size-3.5 text-muted-foreground"
                            strokeWidth={1.75}
                          />
                        )}
                        <span className="tabular-nums font-semibold">
                          {subCount != null ? subCount : '—'}
                        </span>
                      </button>
                    </SubscriberHoverCard>
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
                      timeZone={exchangeDisplayTz}
                      showTimeZone
                      disableCache
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
                timeZone={exchangeDisplayTz}
                showTimeZone
                disableCache
              />
            </div>
          ) : null}

          {/* Off-hours note sits above the whole Rolling returns / Episodes card */}
          {rollingReturnsClosedReason ? (
            <p className="!my-5 rounded-xl border border-rose-500/70 bg-rose-500/10 px-4 py-3 text-[11px] leading-relaxed text-rose-800 dark:border-rose-400/60 dark:bg-rose-500/10 dark:text-rose-200 sm:!my-6 sm:px-4 sm:py-3.5">
              {rollingReturnsClosedReason}
            </p>
          ) : null}

          {/* Row 2: Rolling returns | Episodes — shared Tabs (cn) */}
          <div className="mb-4 w-full space-y-3 rounded-2xl border border-border bg-muted/20 p-3 sm:space-y-3.5 sm:p-4">
            <Tabs
              value={mainPanelTab}
              onValueChange={(v) =>
                setMainPanelTab(v === 'episode' ? 'episode' : 'returns')
              }
              className="w-full gap-3"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <TabsList className="h-9 gap-1 p-1">
                  <TabsTrigger
                    value="returns"
                    className="gap-2 px-3 text-[13px]"
                  >
                    <span>Rolling returns</span>
                    {rollingReturnsClosed ? (
                      <Badge
                        variant="outline"
                        className="ml-0.5 h-5 shrink-0 rounded-full px-2 text-[10px] font-semibold tracking-wide text-muted-foreground"
                      >
                        Closed
                      </Badge>
                    ) : null}
                  </TabsTrigger>
                  <TabsTrigger
                    value="episode"
                    className="gap-2 px-3 text-[13px]"
                  >
                    <span>Episodes</span>
                    <Badge
                      variant={
                        tickerEpisodeGroups.length ? 'secondary' : 'outline'
                      }
                      className="h-5 shrink-0 rounded-full px-2 text-[10px] font-semibold tabular-nums"
                    >
                      {tickerEpisodeGroups.length || '—'}
                    </Badge>
                  </TabsTrigger>
                </TabsList>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {nextPollRemainingSec != null ? (
                    <PollTimerBadge
                      remainingSec={nextPollRemainingSec}
                      pollMs={pollMs}
                      pollProgress={pollProgress}
                    />
                  ) : null}
                  <UpdatingFromSupabaseNote show={tickerUpdatingFromSupabase} />
                  {busy ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      Running…
                    </span>
                  ) : null}
                </div>
              </div>

              <TabsContent value="returns" className="mt-0 outline-none">
            <TooltipProvider delayDuration={200}>
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="grid grid-cols-[4.25rem_minmax(0,1.2fr)_minmax(0,0.9fr)_4.5rem_3.25rem] gap-x-2 border-b border-border bg-muted/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[5rem_minmax(0,1.35fr)_minmax(0,1fr)_5rem_3.75rem] sm:gap-x-3">
                  <span>Window</span>
                  <span>Lookback</span>
                  <span>Live</span>
                  <span className="text-right">Move</span>
                  <span className="text-right">Thr</span>
                </div>
                <ul className="divide-y divide-border">
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
                    const isMaxLastHourCard =
                      snap?.strongestLastHourWindows?.window === key
                    const isBestOverall =
                      snap?.strongestMomentum?.window === key
                    const sessionCode =
                      snap?.marketSession || sessionFromQuote || null
                    const label = returnKeyDisplayLabel(key, sessionCode)
                    const livePx = livePrice ?? snap?.currentPrice ?? null
                    const sessUpper = String(sessionCode || '').toUpperCase()
                    const isExtendedDay =
                      key === 'day' &&
                      (sessUpper === 'PRE' ||
                        sessUpper === 'PREPRE' ||
                        sessUpper === 'POST' ||
                        sessUpper === 'POSTPOST')
                    // PRE/POST day card LOOKBACK: first print when that session started
                    // (e.g. pre-market ~4:00 AM ET). Move % still uses previous close.
                    const sessionOpen = snap?.sessionOpen
                    const sessionOpenPx =
                      sessionOpen?.price != null &&
                      Number.isFinite(Number(sessionOpen.price))
                        ? Number(sessionOpen.price)
                        : null
                    const sessionOpenWhen = sessionOpen?.time || null
                    const prevClosePx =
                      prevClose ?? snap?.previousClose ?? refPx ?? null
                    const prevCloseWhenIso =
                      prevCloseTime || when || exact?.referenceTime || null
                    const lookbackPx =
                      key === 'day'
                        ? isExtendedDay && sessionOpenPx != null
                          ? sessionOpenPx
                          : prevClosePx
                        : refPx ?? exact?.referencePrice ?? null
                    const lookbackWhenIso =
                      key === 'day'
                        ? isExtendedDay && sessionOpenWhen
                          ? sessionOpenWhen
                          : prevCloseWhenIso
                        : when || exact?.referenceTime
                    const calc = buildReturnCalcDetail({
                      key,
                      label,
                      value: val,
                      // Formula always vs previous close for day (Yahoo / thr)
                      referencePrice:
                        key === 'day' ? prevClosePx : refPx,
                      referenceTime:
                        key === 'day'
                          ? prevCloseWhenIso
                          : lookbackWhenIso || when,
                      currentPrice: livePx,
                      asOfTime: snap?.asOfTime || status?.lastFetchAt,
                      previousClose: prevClosePx,
                      marketSession: sessionCode,
                      threshold: thr,
                      isBridge,
                      exact: exact ?? null,
                      sessionOpen:
                        isExtendedDay && sessionOpenPx != null
                          ? {
                              price: sessionOpenPx,
                              time: sessionOpenWhen,
                              shortLabel: sessionOpen?.shortLabel || null,
                              label: sessionOpen?.label || null,
                            }
                          : null,
                    })
                    const hasValue = val != null && Number.isFinite(val)
                    const lookbackPriceText =
                      lookbackPx != null && Number.isFinite(Number(lookbackPx))
                        ? fmtPrice(
                            Number(lookbackPx),
                            activeAssetClass,
                            quoteCurrency,
                          )
                        : '—'
                    const lookbackWhenText = (() => {
                      if (!hasValue) return '—'
                      if (isExtendedDay && sessionOpenWhen) {
                        const t =
                          fmtDateClock(sessionOpenWhen) ||
                          fmtClock(sessionOpenWhen) ||
                          fmtTime(sessionOpenWhen) ||
                          ''
                        const tag =
                          sessionOpen?.shortLabel ||
                          (sessUpper === 'PRE'
                            ? 'Pre open'
                            : sessUpper === 'PREPRE'
                              ? 'Overnight open'
                              : 'AH open')
                        return t ? `${tag} · ${t}` : tag
                      }
                      if (key === 'day' && lookbackWhenIso) {
                        const t =
                          fmtDateClock(lookbackWhenIso) ||
                          fmtClock(lookbackWhenIso) ||
                          fmtTime(lookbackWhenIso) ||
                          '—'
                        return `Prev close · ${t}`
                      }
                      return lookbackWhenIso
                        ? fmtDateClock(lookbackWhenIso) ||
                            fmtClock(lookbackWhenIso) ||
                            fmtTime(lookbackWhenIso) ||
                            '—'
                        : '—'
                    })()
                    const livePriceText =
                      livePx != null && Number.isFinite(Number(livePx))
                        ? fmtPrice(
                            Number(livePx),
                            activeAssetClass,
                            quoteCurrency,
                          )
                        : '—'
                    const liveWhenText =
                      snap?.asOfTime || status?.lastFetchAt
                        ? fmtDateClock(
                            snap?.asOfTime || status?.lastFetchAt || null,
                          ) || 'Live'
                        : 'Live'
                    return (
                      <li key={key}>
                        <Tooltip delayDuration={200}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={!hasValue}
                              onClick={() => {
                                if (hasValue) openReturnAlert(key)
                              }}
                              className={cn(
                                'grid w-full grid-cols-[4.25rem_minmax(0,1.2fr)_minmax(0,0.9fr)_4.5rem_3.25rem] items-center gap-x-2 px-3 py-2 text-left transition-colors sm:grid-cols-[5rem_minmax(0,1.35fr)_minmax(0,1fr)_5rem_3.75rem] sm:gap-x-3',
                                hasValue
                                  ? 'cursor-pointer hover:bg-muted/50'
                                  : 'cursor-not-allowed opacity-50',
                                hasValue &&
                                  val != null &&
                                  val > 0 &&
                                  'bg-emerald-500/[0.04]',
                                hasValue &&
                                  val != null &&
                                  val < 0 &&
                                  'bg-rose-500/[0.04]',
                                isBridge && 'bg-violet-500/[0.05]',
                                isMaxLastHourCard &&
                                  !isBestOverall &&
                                  'bg-amber-500/[0.06]',
                                isBestOverall &&
                                  (snap?.strongestMomentum?.direction === 'DOWN'
                                    ? 'bg-rose-500/10'
                                    : 'bg-emerald-500/10'),
                                hotBlinkClass(val, thr, key),
                              )}
                            >
                              <span className="min-w-0 truncate text-[12px] font-medium text-foreground sm:text-[13px]">
                                {label}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-[12px] font-semibold tabular-nums text-foreground sm:text-[13px]">
                                  {hasValue ? lookbackPriceText : '—'}
                                </span>
                                <span className="block truncate text-[10px] tabular-nums text-muted-foreground">
                                  {hasValue ? lookbackWhenText : '—'}
                                </span>
                                {hasValue &&
                                isExtendedDay &&
                                sessionOpenPx != null &&
                                prevClosePx != null &&
                                Number.isFinite(Number(prevClosePx)) ? (
                                  <span className="block truncate text-[9px] tabular-nums text-muted-foreground/80">
                                    Move vs prev close{' '}
                                    {fmtPrice(
                                      Number(prevClosePx),
                                      activeAssetClass,
                                      quoteCurrency,
                                    )}
                                  </span>
                                ) : null}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-[12px] font-semibold tabular-nums text-foreground sm:text-[13px]">
                                  {hasValue ? livePriceText : '—'}
                                </span>
                                <span className="block truncate text-[10px] tabular-nums text-muted-foreground">
                                  {hasValue ? liveWhenText : '—'}
                                </span>
                              </span>
                              <span
                                className={cn(
                                  'text-right text-[13px] font-semibold tabular-nums sm:text-sm',
                                  hasValue
                                    ? pctColor(val)
                                    : 'text-muted-foreground',
                                )}
                              >
                                {hasValue ? fmtPct(val) : '—'}
                              </span>
                              <span className="text-right text-[10px] tabular-nums text-muted-foreground sm:text-[11px]">
                                {thr != null ? `≥${thr}%` : '—'}
                              </span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="left"
                            sideOffset={8}
                            className="!inline-flex !w-auto max-w-[min(26rem,92vw)] flex-col !items-stretch !gap-0 border border-white/10 bg-[#0F1C19] px-4 py-3.5 text-left text-background shadow-xl"
                            onPointerDownOutside={(e) => {
                              const t = e.target as HTMLElement | null
                              if (t?.closest?.('[data-start-episode]')) {
                                e.preventDefault()
                              }
                            }}
                          >
                            <ReturnCalcTooltipBody
                              detail={calc}
                              assetClass={activeAssetClass}
                              currency={quoteCurrency}
                              canStartEpisode={hasValue}
                              startEpisodeBusy={startEpisodeBusyKey === key}
                              onStartEpisode={
                                hasValue
                                  ? () => {
                                      void startEpisodeFromWindow(key)
                                    }
                                  : undefined
                              }
                            />
                            {hasValue ? (
                              <p className="mt-3 w-full border-t border-background/20 pt-2.5 text-[12px] leading-snug text-background/70">
                                <span className="font-semibold text-background/85">
                                  Start episode
                                </span>{' '}
                                opens the full story (ACTIVE + research +
                                alert). Row click composes a push only.
                                {key === 'day' && calc.wallSpanLabel
                                  ? ` · ${calc.wallSpanLabel} since previous close (calendar gap, not continuous trading hours)`
                                  : exact?.exactLabel
                                    ? ` · wall span ${exact.exactLabel}`
                                    : calc.wallSpanLabel
                                      ? ` · wall span ${calc.wallSpanLabel}`
                                      : ''}
                              </p>
                            ) : (
                              <p className="mt-3 w-full border-t border-background/20 pt-2.5 text-[12px] leading-snug text-background/70">
                                No exact clock lookback for this window (data
                                hole / not enough Yahoo 1m history).
                              </p>
                            )}
                            {startEpisodeError &&
                            startEpisodeBusyKey === key ? (
                              <p className="mt-1 text-[11px] text-rose-300">
                                {startEpisodeError}
                              </p>
                            ) : null}
                          </TooltipContent>
                        </Tooltip>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </TooltipProvider>
              </TabsContent>

              <TabsContent value="episode" className="mt-0 outline-none">
            <div className="space-y-3">
              {tickerUpdatingFromSupabase && !tickerEpisodeGroups.length ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/60 px-4 py-8 text-center">
                  <UpdatingFromSupabaseNote show />
                  <p className="text-[12px] text-muted-foreground">
                    Loading episodes for {displayTicker}…
                  </p>
                </div>
              ) : !tickerEpisodeGroups.length ? (
                <p className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
                  No episodes yet for {displayTicker}
                </p>
              ) : (
                <TooltipProvider delayDuration={200}>
                  <div className="space-y-3">
                    {tickerEpisodeGroups.map((group) => {
                      const matchesLive = Boolean(
                        episodeRaw &&
                          group.episodeId &&
                          episodeRaw.episodeId === group.episodeId,
                      )
                      const isActive = group.status === 'ACTIVE'
                      const isExpanded =
                        episodeExpanded[group.id] ?? false
                      const dirUp = group.direction !== 'DOWN'
                      const no = formatEpisodeNo(group.episodeNo)
                      const focusThisEpisode = () => {
                        const row: ActiveEpisodeRow = {
                          ticker: displayTicker,
                          episodeId: group.episodeId || null,
                          episodeNo: group.episodeNo ?? null,
                          direction: group.direction === 'DOWN' ? 'DOWN' : 'UP',
                          detectedWindow: group.window || null,
                          peakMovePercent: group.peakMovePercent ?? null,
                          currentMovePercent: matchesLive
                            ? episodeRaw?.currentMovePercent ?? null
                            : null,
                          episodeStartedAt: group.startedAt || null,
                          status: group.status,
                          state: group.liveState || null,
                          marketSession: group.marketSession || null,
                        }
                        setDeskEpisodeFocus(row)
                        setRightRailMode('yahoo')
                        setLogCollapsedPersist(false)
                        setRailChartExpanded(false)
                      }
                      return (
                        <div
                          key={group.id}
                          className={cn(
                            'overflow-hidden rounded-xl border bg-background',
                            deskEpisodeFocus?.episodeId &&
                              group.episodeId &&
                              String(deskEpisodeFocus.episodeId) ===
                                String(group.episodeId)
                              ? 'border-foreground/30 ring-1 ring-foreground/15'
                              : 'border-border',
                          )}
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
                            onClick={focusThisEpisode}
                          >
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                dirUp
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
                              )}
                            >
                              {group.direction}
                            </span>
                            {no ? (
                              <span className="font-mono text-[11px] font-semibold tabular-nums">
                                {no}
                              </span>
                            ) : null}
                            <span className="truncate text-[12px] text-muted-foreground">
                              {group.window || '—'}
                            </span>
                            <span
                              className={cn(
                                'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                isActive
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {isActive
                                ? formatEpisodeState(group.liveState) ||
                                  'Active'
                                : 'Ended'}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 text-[12px] font-semibold tabular-nums',
                                pctColor(group.peakMovePercent),
                              )}
                            >
                              {fmtPct(group.peakMovePercent)}
                            </span>
                            <span
                              role="button"
                              tabIndex={0}
                              title={isExpanded ? 'Collapse' : 'Expand inline'}
                              aria-label={
                                isExpanded ? 'Collapse episode' : 'Expand episode'
                              }
                              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setEpisodeExpanded((prev) => ({
                                  ...prev,
                                  [group.id]: !isExpanded,
                                }))
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter' && e.key !== ' ') return
                                e.preventDefault()
                                e.stopPropagation()
                                setEpisodeExpanded((prev) => ({
                                  ...prev,
                                  [group.id]: !isExpanded,
                                }))
                              }}
                            >
                              {isExpanded ? (
                                <ChevronUp className="size-3.5" />
                              ) : (
                                <ChevronDown className="size-3.5" />
                              )}
                            </span>
                          </button>
                          {isExpanded ? (
                            <div className="border-t border-border px-3 py-2">
                              <EpisodeHowBuiltBlock
                                group={group}
                                assetClass={activeAssetClass}
                                currency={quoteCurrency}
                                liveEpisode={matchesLive ? episodeRaw : null}
                                matchesLive={matchesLive}
                                defaultOpen={false}
                              />
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </TooltipProvider>
              )}
            </div>
              </TabsContent>
            </Tabs>
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
          )}
        </div>

        {/* Column 3/4 — detail rail: home desk always; asset tabs after ticker pick. */}
        {showDetailRightRail ? (logCollapsed ? (
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
            style={{
              width: rightRailWidth,
              minWidth: RIGHT_RAIL_MIN_WIDTH,
              maxWidth: rightRailMaxWidth(),
            }}
          >
            {/* Drag handle — resize right column */}
            <button
              type="button"
              aria-label="Resize panel"
              title="Drag to resize"
              onMouseDown={onRightRailResizeStart}
              className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize border-0 bg-transparent p-0 hover:bg-foreground/15 active:bg-foreground/20"
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
                ) : rightRailMode === 'settings' ? (
                  <Settings
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                ) : rightRailMode === 'activeEpisodes' ? (
                  <Activity
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                ) : rightRailMode === 'yahoo' ? (
                  <LineChart
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                ) : (
                  <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="flex min-w-0 items-center gap-1 truncate text-[13px] font-medium">
                      {rightRailMode === 'settings' ? (
                        <span className="truncate">Rolling-return thresholds</span>
                      ) : rightRailMode === 'activeEpisodes' ? (
                        <span className="truncate">
                          Active episodes · {activeEpisodesList.length}
                        </span>
                      ) : rightRailMode === 'yahoo' && deskUsersMode ? (
                        <span className="truncate">
                          {deskUserFocus
                            ? `Profile · ${
                                deskUserFocus.device_model ||
                                deskUserFocus.platform ||
                                'Device'
                              }`
                            : 'User profile'}
                        </span>
                      ) : displayTicker ? (
                        <>
                          <span className="shrink-0 text-muted-foreground">
                            {rightRailMode === 'subscribers'
                              ? 'Subscribers ·'
                              : rightRailMode === 'events'
                                ? 'Recent events ·'
                                : rightRailMode === 'yahoo' && deskEpisodeFocus
                                  ? 'Episode ·'
                                  : rightRailMode === 'yahoo'
                                    ? 'Yahoo ·'
                                    : 'Activity log ·'}
                          </span>
                          <button
                            type="button"
                            className="truncate font-semibold text-foreground underline-offset-2 hover:underline"
                            title={`Open ${displayTicker} in ${
                              ASSET_CLASS_TABS.find(
                                (tab) =>
                                  tab.id ===
                                  tabAssetClass({
                                    ticker: displayTicker,
                                    label: displayTicker,
                                    assetClass: detectAssetClass(displayTicker),
                                  }),
                              )?.label || 'Markets'
                            }`}
                            onClick={() =>
                              openTickerInMarketSection(displayTicker)
                            }
                          >
                            {displayTicker}
                          </button>
                          {rightRailMode === 'yahoo' &&
                          deskEpisodeFocus &&
                          formatEpisodeNo(deskEpisodeFocus.episodeNo) ? (
                            <span className="shrink-0 text-muted-foreground">
                              {formatEpisodeNo(deskEpisodeFocus.episodeNo)}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="truncate text-muted-foreground">
                          Detail
                        </span>
                      )}
                    </p>
                    {rightRailMode === 'events' ? (
                      <EpisodeStatusGuideButton
                        policy={status?.config?.episodePolicy}
                      />
                    ) : null}
                    {rightRailMode === 'settings' ? (
                      <Button
                        type="button"
                        size="sm"
                        className="ml-auto h-7 shrink-0 gap-1.5 px-2.5 text-[11px]"
                        disabled={thresholdSaving || policySaving}
                        onClick={() => void saveSettingsNow()}
                        title="Save threshold and episode-rule changes"
                        aria-label="Save settings"
                      >
                        {thresholdSaving || policySaving ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Check className="size-3.5" strokeWidth={2.5} />
                        )}
                        Save
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {rightRailMode === 'activeEpisodes' ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px] text-rose-700 hover:bg-rose-500/10 hover:text-rose-800 dark:text-rose-400"
                      onClick={() => void endAllActiveEpisodes()}
                      title="End all active episodes"
                      aria-label="End all active episodes"
                      disabled={
                        endingEpisode ||
                        activeEpisodesLoading ||
                        activeEpisodesList.length === 0
                      }
                    >
                      {endingEpisode ? (
                        <>
                          <Loader2 className="size-3 animate-spin" />
                          Ending…
                        </>
                      ) : (
                        'End all'
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void loadActiveEpisodesList({ refresh: true })}
                      title="Refresh active episodes"
                      aria-label="Refresh active episodes"
                      disabled={activeEpisodesLoading || endingEpisode}
                    >
                      <RefreshCw
                        className={cn(
                          'size-3.5',
                          activeEpisodesLoading && 'animate-spin',
                        )}
                      />
                    </Button>
                  </>
                ) : null}
                {rightRailMode === 'subscribers' ||
                rightRailMode === 'events' ||
                rightRailMode === 'settings' ||
                rightRailMode === 'activeEpisodes' ? (
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
            {rightRailMode === 'yahoo' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="mom-hide-scrollbar min-h-0 flex-1 overflow-y-auto">
                  {deskUsersMode ? (
                    deskUserFocus ? (
                      <DeskUserProfilePanel
                        device={deskUserFocus}
                        onOpenTicker={openTickerInMarketSection}
                        onTickersChanged={async () => {
                          const focused = deskUserFocus
                          await loadDeskDevices()
                          if (focused) await loadDeskUserActivities(focused)
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                        <Users
                          className="size-6 text-muted-foreground/70"
                          strokeWidth={1.5}
                        />
                        <p className="text-sm font-medium">Select a user</p>
                        <p className="max-w-[16rem] text-[12px] text-muted-foreground">
                          Click a device in All users to see iOS / build / photo
                          and profile fields here.
                        </p>
                      </div>
                    )
                  ) : deskBulletinsMode ? (
                    deskBulletinFocus ? (
                      <div className="space-y-3 px-3 py-3">
                        <div className="rounded-xl border border-border bg-card p-3">
                          <div className="flex flex-wrap items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold leading-snug">
                                {deskBulletinFocus.title}
                              </p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {String(deskBulletinFocus.market || '')
                                  .toLowerCase() === 'india'
                                  ? 'India'
                                  : 'US'}{' '}
                                · {String(deskBulletinFocus.slot || '').toUpperCase()}{' '}
                                · {deskBulletinFocus.session_date || '—'}
                                {deskBulletinFocus.yahoo_market_state
                                  ? ` · Yahoo ${deskBulletinFocus.yahoo_market_state}`
                                  : ''}
                              </p>
                            </div>
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {deskBulletinFocus.body_source === 'perplexity'
                                ? 'Perplexity'
                                : deskBulletinFocus.body_source || 'body'}
                            </Badge>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                            <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                              <p className="text-muted-foreground">Probe</p>
                              <p className="font-medium tabular-nums">
                                {deskBulletinFocus.probe_symbol || '—'}
                              </p>
                            </div>
                            <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                              <p className="text-muted-foreground">Day %</p>
                              <p
                                className={cn(
                                  'font-medium tabular-nums',
                                  Number(deskBulletinFocus.day_change_percent) >
                                    0
                                    ? 'text-emerald-600'
                                    : Number(
                                          deskBulletinFocus.day_change_percent,
                                        ) < 0
                                      ? 'text-rose-600'
                                      : '',
                                )}
                              >
                                {deskBulletinFocus.day_change_percent != null &&
                                Number.isFinite(
                                  Number(deskBulletinFocus.day_change_percent),
                                )
                                  ? `${Number(deskBulletinFocus.day_change_percent) > 0 ? '+' : ''}${Number(deskBulletinFocus.day_change_percent).toFixed(2)}%`
                                  : '—'}
                              </p>
                            </div>
                            <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                              <p className="text-muted-foreground">Open</p>
                              <p className="font-medium tabular-nums">
                                {deskBulletinFocus.open_price != null
                                  ? Number(
                                      deskBulletinFocus.open_price,
                                    ).toFixed(2)
                                  : '—'}
                              </p>
                            </div>
                            <div className="rounded-lg bg-muted/50 px-2 py-1.5">
                              <p className="text-muted-foreground">
                                Close / last
                              </p>
                              <p className="font-medium tabular-nums">
                                {deskBulletinFocus.close_or_last_price != null
                                  ? Number(
                                      deskBulletinFocus.close_or_last_price,
                                    ).toFixed(2)
                                  : '—'}
                              </p>
                            </div>
                          </div>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Push {Number(deskBulletinFocus.push_sent_ok) || 0}/
                            {Number(deskBulletinFocus.recipient_count) || 0}
                            {deskBulletinFocus.sent_at
                              ? ` · sent ${
                                  formatExchangeTime(
                                    deskBulletinFocus.sent_at,
                                    deskBulletinFocus.timezone || momentumDisplayTimeZone,
                                    { date: true, year: true, withZone: true },
                                  ) || '—'
                                }`
                              : ''}
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <Newspaper
                              className="size-3.5 text-muted-foreground"
                              strokeWidth={1.75}
                            />
                            <p className="text-[12px] font-semibold">
                              Lock-screen body
                            </p>
                          </div>
                          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                            {deskBulletinFocus.body || '—'}
                          </p>
                        </div>

                        {deskBulletinFocus.perplexity_meta &&
                        typeof deskBulletinFocus.perplexity_meta ===
                          'object' ? (
                          <div className="rounded-xl border border-border bg-card p-3">
                            <p className="mb-2 text-[12px] font-semibold">
                              Perplexity meta
                            </p>
                            <div className="space-y-1 text-[11px] text-muted-foreground">
                              {deskBulletinFocus.perplexity_meta.model ? (
                                <p>
                                  Model:{' '}
                                  <span className="text-foreground">
                                    {String(
                                      deskBulletinFocus.perplexity_meta.model,
                                    )}
                                  </span>
                                </p>
                              ) : null}
                              {deskBulletinFocus.perplexity_meta
                                .total_tokens != null ? (
                                <p>
                                  Tokens:{' '}
                                  <span className="tabular-nums text-foreground">
                                    {String(
                                      deskBulletinFocus.perplexity_meta
                                        .total_tokens,
                                    )}
                                  </span>
                                </p>
                              ) : null}
                              {deskBulletinFocus.perplexity_meta.cost_usd !=
                              null ? (
                                <p>
                                  Cost:{' '}
                                  <span className="tabular-nums text-foreground">
                                    $
                                    {Number(
                                      deskBulletinFocus.perplexity_meta
                                        .cost_usd,
                                    ).toFixed(4)}
                                  </span>
                                </p>
                              ) : null}
                              {deskBulletinFocus.perplexity_meta.reason ? (
                                <p>
                                  Note:{' '}
                                  <span className="text-foreground">
                                    {String(
                                      deskBulletinFocus.perplexity_meta.reason,
                                    )}
                                  </span>
                                </p>
                              ) : null}
                              {Array.isArray(
                                deskBulletinFocus.perplexity_meta.citations,
                              ) &&
                              (
                                deskBulletinFocus.perplexity_meta
                                  .citations as unknown[]
                              ).length > 0 ? (
                                <div className="pt-1">
                                  <p className="mb-1 font-medium text-foreground">
                                    Citations
                                  </p>
                                  <ul className="list-disc space-y-0.5 pl-4">
                                    {(
                                      deskBulletinFocus.perplexity_meta
                                        .citations as unknown[]
                                    )
                                      .slice(0, 8)
                                      .map((c, i) => (
                                        <li key={i} className="break-all">
                                          {typeof c === 'string'
                                            ? c
                                            : JSON.stringify(c)}
                                        </li>
                                      ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                        <Newspaper
                          className="size-6 text-muted-foreground/70"
                          strokeWidth={1.5}
                        />
                        <p className="text-sm font-medium">
                          Select a market bulletin
                        </p>
                        <p className="max-w-[16rem] text-[12px] text-muted-foreground">
                          Click a US / India OPEN or CLOSE row to see the
                          Perplexity research body and Yahoo snapshot here.
                        </p>
                      </div>
                    )
                  ) : (
                  <div className="space-y-3 px-3 py-3">
                    {!deskEpisodeFocus ? (
                      showLegacyLeftRail && hasSelectedTicker ? (
                        <div className="space-y-3">
                          <div className="overflow-hidden rounded-xl border border-border bg-card">
                            <YahooInteractiveChart
                              key={`${displayTicker}-rail-idle`}
                              ticker={displayTicker}
                              title={`${displayTicker} · Yahoo`}
                              height={220}
                              defaultRange="1d"
                              borderless
                              timeZone={exchangeDisplayTz}
                              showTimeZone
                              disableCache
                            />
                          </div>
                          <p className="px-1 text-center text-[11px] text-muted-foreground">
                            Click any episode in the Episodes tab to open its
                            detail here.
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-12 text-center">
                          <LineChart
                            className="size-6 text-muted-foreground/70"
                            strokeWidth={1.5}
                          />
                          <p className="text-sm font-medium">
                            Select an episode
                          </p>
                          <p className="max-w-[16rem] text-[12px] text-muted-foreground">
                            Click a row in All episodes — the list stays put and
                            its detail opens here.
                          </p>
                        </div>
                      )
                    ) : null}
                    {deskEpisodeFocus ? (
                    <>
                    {/* Quote + mini chart (click → expand full chart below) */}
                    <div className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="min-w-0">
                            <button
                              type="button"
                              className="block max-w-full truncate text-left text-sm font-semibold tracking-tight underline-offset-2 hover:underline"
                              title={`Open ${displayTicker} in markets`}
                              onClick={() =>
                                openTickerInMarketSection(displayTicker)
                              }
                            >
                              {activeTab?.label &&
                              activeTab.label !== displayTicker
                                ? activeTab.label
                                : displayTicker}
                            </button>
                            <p className="truncate text-[11px] text-muted-foreground">
                              <button
                                type="button"
                                className="font-medium text-foreground underline-offset-2 hover:underline"
                                title={`Open ${displayTicker} in markets`}
                                onClick={() =>
                                  openTickerInMarketSection(displayTicker)
                                }
                              >
                                {displayTicker}
                              </button>
                              {formatEpisodeNo(deskEpisodeFocus.episodeNo)
                                ? ` · ${formatEpisodeNo(deskEpisodeFocus.episodeNo)}`
                                : ''}
                              {deskEpisodeFocus.detectedWindow
                                ? ` · ${deskEpisodeFocus.detectedWindow}`
                                : ''}
                            </p>
                          </div>
                          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                            <p className="text-xl font-semibold tabular-nums tracking-tight">
                              {fmtPrice(
                                livePrice,
                                activeAssetClass,
                                quoteCurrency,
                              )}
                            </p>
                            <p
                              className={cn(
                                'pb-0.5 text-sm font-semibold tabular-nums',
                                livePct != null
                                  ? pctColor(livePct)
                                  : 'text-muted-foreground',
                              )}
                            >
                              {livePct != null ? fmtPct(livePct) : '—'}
                            </p>
                          </div>
                          {prevClose != null ? (
                            <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                              Prev close{' '}
                              {fmtPrice(
                                prevClose,
                                activeAssetClass,
                                quoteCurrency,
                              )}
                              {prevClosePct != null
                                ? ` · ${fmtPct(prevClosePct)}`
                                : ''}
                            </p>
                          ) : null}
                          {/* Session above Yahoo (clickable → Yahoo) */}
                          <YahooFinanceWithMarketState
                            marketState={tabQuote?.marketState}
                            className="mt-1.5"
                          >
                            <a
                              href={yahooFinanceQuoteUrl(displayTicker)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-full items-center gap-x-1 text-[11px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                              title={`Open ${displayTicker} on Yahoo Finance`}
                            >
                              <span>Yahoo Finance</span>
                              <ArrowUpRight className="size-3 shrink-0 opacity-70" />
                            </a>
                          </YahooFinanceWithMarketState>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setRailChartExpanded((v) => !v)
                          }
                          className="group relative h-[4.5rem] w-[7.5rem] shrink-0 overflow-hidden rounded-none bg-transparent p-0 text-left transition-opacity hover:opacity-90"
                          title={
                            railChartExpanded
                              ? 'Collapse chart'
                              : 'Expand chart below'
                          }
                          aria-expanded={railChartExpanded}
                        >
                          <div className="pointer-events-none h-full w-full select-none">
                            <YahooInteractiveChart
                              key={`${displayTicker}-rail-mini`}
                              ticker={displayTicker}
                              title={`${displayTicker} · Yahoo`}
                              height={72}
                              defaultRange="1d"
                              compact
                              borderless
                              timeZone={exchangeDisplayTz}
                              disableCache
                            />
                          </div>
                          <span className="pointer-events-none absolute bottom-0.5 right-0.5 z-10 inline-flex items-center gap-0.5 rounded bg-background/80 px-1 text-[8px] font-medium text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                            {railChartExpanded ? (
                              <>
                                Hide
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
                    </div>

                    {railChartExpanded ? (
                      <div className="overflow-hidden rounded-xl border border-border bg-card">
                        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium">
                              Interactive chart
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Hover for price · ranges from Yahoo Finance
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                            onClick={() => setRailChartExpanded(false)}
                          >
                            <ChevronUp className="size-3.5" />
                            Collapse
                          </Button>
                        </div>
                        <div className="p-2">
                          <YahooInteractiveChart
                            key={`${displayTicker}-rail-full`}
                            ticker={displayTicker}
                            title={`${displayTicker} · Yahoo`}
                            height={280}
                            defaultRange="1d"
                            borderless
                            timeZone={exchangeDisplayTz}
                            showTimeZone
                            disableCache
                          />
                        </div>
                        <div className="border-t border-border px-3 py-2">
                          <YahooFinanceWithMarketState
                            marketState={tabQuote?.marketState}
                          >
                            <a
                              href={yahooFinanceQuoteUrl(displayTicker)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              title={`Open ${displayTicker} on Yahoo Finance`}
                            >
                              <span>Yahoo Finance</span>
                              <ArrowUpRight className="size-3 shrink-0 opacity-70" />
                            </a>
                          </YahooFinanceWithMarketState>
                        </div>
                      </div>
                    ) : null}

                    {/* How this move built — summary + step timeline */}
                      <div className="rounded-xl border border-border bg-card p-3">
                        {(() => {
                          const focusTicker = String(
                            deskEpisodeFocus.ticker || displayTicker || '',
                          )
                            .trim()
                            .toUpperCase()
                          const statusTicker = String(status?.ticker || '')
                            .trim()
                            .toUpperCase()
                          const timelineLoading =
                            loading ||
                            !status ||
                            (focusTicker
                              ? statusTicker !== focusTicker
                              : false)

                          if (timelineLoading) {
                            return (
                              <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-3 py-8 text-[12px] text-muted-foreground">
                                <Loader2 className="size-4 shrink-0 animate-spin" />
                                Loading episode timeline…
                              </div>
                            )
                          }

                          const focusId = deskEpisodeFocus.episodeId
                            ? String(deskEpisodeFocus.episodeId)
                            : ''
                          const groups = buildEpisodeGroups(
                            status?.episodes,
                            status?.events,
                            episode,
                          ).map((g) => ensureGroupHasStartedEvent(g))
                          let group =
                            (focusId
                              ? groups.find(
                                  (g) => String(g.episodeId) === focusId,
                                )
                              : null) ||
                            groups.find(
                              (g) =>
                                g.startedAt &&
                                deskEpisodeFocus.episodeStartedAt &&
                                g.startedAt ===
                                  deskEpisodeFocus.episodeStartedAt,
                            ) ||
                            null
                          if (!group) {
                            group = ensureGroupHasStartedEvent({
                              id:
                                focusId ||
                                `focus-${deskEpisodeFocus.ticker}-${deskEpisodeFocus.episodeStartedAt || ''}`,
                              direction:
                                deskEpisodeFocus.direction === 'DOWN'
                                  ? 'DOWN'
                                  : 'UP',
                              startedAt:
                                deskEpisodeFocus.episodeStartedAt || '',
                              endedAt: null,
                              status:
                                String(deskEpisodeFocus.status || '')
                                  .toUpperCase() === 'ACTIVE'
                                  ? 'ACTIVE'
                                  : 'ENDED',
                              peakMovePercent: Number(
                                deskEpisodeFocus.peakMovePercent || 0,
                              ),
                              window:
                                deskEpisodeFocus.detectedWindow || '—',
                              events: [],
                              liveState: deskEpisodeFocus.state || null,
                              episodeId: focusId || null,
                              episodeNo: deskEpisodeFocus.episodeNo ?? null,
                              marketSession:
                                deskEpisodeFocus.marketSession || null,
                            })
                          } else if (
                            group.status === 'ACTIVE' &&
                            episode?.state &&
                            (!group.episodeId ||
                              group.episodeId === episode.episodeId)
                          ) {
                            group = {
                              ...group,
                              liveState: episode.state,
                              episodeNo:
                                group.episodeNo ?? episode.episodeNo ?? null,
                            }
                          }
                          const matchesLive = Boolean(
                            episode &&
                              group.episodeId &&
                              episode.episodeId === group.episodeId,
                          )
                          return (
                            <EpisodeHowBuiltBlock
                              key={`how-${group.id}`}
                              group={group}
                              assetClass={activeAssetClass}
                              currency={quoteCurrency}
                              liveEpisode={episode}
                              matchesLive={matchesLive}
                              defaultOpen
                            />
                          )
                        })()}
                      </div>
                    </>
                    ) : null}
                  </div>
                  )}
                </div>
              </div>
            ) : rightRailMode === 'activeEpisodes' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-2 px-2.5 py-2.5">
                    {activeEpisodesError ? (
                      <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
                        {activeEpisodesError}
                      </p>
                    ) : null}
                    {activeEpisodesLoading && !activeEpisodesList.length ? (
                      <div className="flex items-center gap-2 px-1 py-6 text-[12px] text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        Loading active episodes…
                      </div>
                    ) : null}
                    {!activeEpisodesLoading &&
                    !activeEpisodesError &&
                    !activeEpisodesList.length ? (
                      <div className="space-y-1 rounded-xl border border-dashed border-border px-3 py-8 text-center">
                        <Activity
                          className="mx-auto size-5 text-muted-foreground/70"
                          strokeWidth={1.5}
                        />
                        <p className="text-[13px] font-medium text-foreground">
                          No active episodes
                        </p>
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          When a ≤24h / day window crosses threshold, live
                          episodes appear here collapsed. Click a row to expand.
                        </p>
                      </div>
                    ) : null}
                    {activeEpisodesList.map((row) => {
                      const key = String(
                        row.episodeId ||
                          `${row.ticker}-${row.episodeStartedAt || ''}`,
                      )
                      const expanded = Boolean(activeEpisodeExpanded[key])
                      const dirUp = row.direction !== 'DOWN'
                      const label =
                        watchlist.find(
                          (t) =>
                            t.ticker.toUpperCase() ===
                            String(row.ticker || '').toUpperCase(),
                        )?.label || row.ticker
                      const no = formatEpisodeNo(row.episodeNo)
                      const giveback = computeEpisodeGivebackPercent({
                        direction: row.direction,
                        referencePrice: row.referencePrice,
                        peakPrice: row.peakPrice,
                        troughPrice: row.troughPrice,
                        currentPrice: row.currentPrice,
                        peakMovePercent: row.peakMovePercent,
                        currentMovePercent: row.currentMovePercent,
                      })
                      return (
                        <div
                          key={key}
                          className={cn(
                            'overflow-hidden rounded-xl border border-border/80 bg-background',
                            expanded && 'ring-1 ring-border',
                          )}
                        >
                          <div className="flex w-full items-start gap-2 px-2.5 py-2 transition-colors hover:bg-muted/50">
                            <button
                              type="button"
                              onClick={() =>
                                setActiveEpisodeExpanded((prev) => ({
                                  ...prev,
                                  [key]: !prev[key],
                                }))
                              }
                              className="flex min-w-0 flex-1 items-start gap-2 text-left"
                              aria-expanded={expanded}
                            >
                              <span className="mt-0.5 shrink-0 text-muted-foreground">
                                {expanded ? (
                                  <ChevronUp
                                    className="size-3.5"
                                    strokeWidth={2}
                                  />
                                ) : (
                                  <ChevronDown
                                    className="size-3.5"
                                    strokeWidth={2}
                                  />
                                )}
                              </span>
                              <span
                                className={cn(
                                  'mt-1 size-1.5 shrink-0 rounded-full',
                                  dirUp ? 'bg-emerald-500' : 'bg-rose-500',
                                )}
                                aria-hidden
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-[12px] font-semibold tracking-tight">
                                    {row.ticker}
                                  </span>
                                  {no ? (
                                    <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                                      {no}
                                    </span>
                                  ) : null}
                                  <span
                                    className={cn(
                                      'ml-auto shrink-0 text-[12px] font-semibold tabular-nums',
                                      pctColor(row.currentMovePercent),
                                    )}
                                  >
                                    {fmtPct(row.currentMovePercent)}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
                                  <span className="truncate font-medium text-foreground/80">
                                    {label !== row.ticker ? label : null}
                                  </span>
                                  <span
                                    className={cn(
                                      'font-semibold uppercase',
                                      dirUp
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-rose-600 dark:text-rose-400',
                                    )}
                                  >
                                    {dirUp ? 'UP' : 'DOWN'}
                                  </span>
                                  <span>·</span>
                                  <span>
                                    {formatEpisodeState(row.state) || 'Active'}
                                  </span>
                                  {row.detectedWindow ? (
                                    <>
                                      <span>·</span>
                                      <span>{row.detectedWindow}</span>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={
                                endingEpisode ||
                                endingEpisodeTicker ===
                                  String(row.ticker || '').toUpperCase()
                              }
                              title={`End active episode for ${row.ticker} (no push)`}
                              className="mt-0.5 h-7 shrink-0 gap-1 rounded-full px-2.5 text-[11px] font-semibold text-rose-700 hover:border-rose-300 hover:bg-rose-500/10 hover:text-rose-800 dark:text-rose-400"
                              onClick={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                void endActiveEpisode({
                                  ticker: row.ticker,
                                  direction: row.direction,
                                  peakMovePercent: row.peakMovePercent,
                                })
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              {endingEpisodeTicker ===
                              String(row.ticker || '').toUpperCase() ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <X className="size-3" strokeWidth={2} />
                              )}
                              End
                            </Button>
                          </div>
                          {expanded ? (
                            <div className="space-y-2 border-t border-border/60 bg-muted/20 px-2.5 py-2.5 text-[11px]">
                              <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Peak
                                  </p>
                                  <p
                                    className={cn(
                                      'font-semibold tabular-nums',
                                      pctColor(row.peakMovePercent),
                                    )}
                                  >
                                    {fmtPct(row.peakMovePercent)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Last notified
                                  </p>
                                  <p className="font-semibold tabular-nums">
                                    {fmtPct(row.lastNotifiedEpisodeMovePct)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Start move
                                  </p>
                                  <p className="font-semibold tabular-nums">
                                    {fmtPct(row.initialMovePercent)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Giveback
                                  </p>
                                  <p className="font-semibold tabular-nums">
                                    {giveback != null
                                      ? `${giveback.toFixed(0)}%`
                                      : '—'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Live
                                  </p>
                                  <p className="font-semibold tabular-nums">
                                    {fmtPrice(row.currentPrice)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Reference
                                  </p>
                                  <p className="font-semibold tabular-nums">
                                    {fmtPrice(row.referencePrice)}
                                  </p>
                                </div>
                              </div>
                              <div className="space-y-0.5 text-[10px] leading-snug text-muted-foreground">
                                {row.exactLabel || row.detectedWindow ? (
                                  <p>
                                    Window{' '}
                                    <span className="font-medium text-foreground">
                                      {row.exactLabel || row.detectedWindow}
                                    </span>
                                    {row.episodeStartedAt
                                      ? ` · started ${fmtEpisodeWhen(row.episodeStartedAt, row.marketSession)}`
                                      : null}
                                  </p>
                                ) : null}
                                {row.referenceTime ? (
                                  <p>
                                    Ref time{' '}
                                    <span className="font-medium text-foreground">
                                      {fmtEpisodeWhen(
                                        row.referenceTime,
                                        row.marketSession,
                                      )}
                                    </span>
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-1.5 pt-0.5">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 gap-1.5 px-2 text-[11px]"
                                  onClick={() => {
                                    const t = String(row.ticker || '')
                                      .trim()
                                      .toUpperCase()
                                    if (t) selectTicker(t)
                                    setRightRailMode('events')
                                  }}
                                >
                                  <Zap className="size-3" strokeWidth={2} />
                                  Open {row.ticker}
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              </div>
            ) : rightRailMode === 'settings' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-3 px-3 py-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Asset class
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        Har class ke thresholds aur episode rules alag save
                        hote hain. ETFs Stocks ke bands share karti hain.
                      </p>
                      <div
                        className="mt-2 flex w-full flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1"
                        role="tablist"
                        aria-label="Settings asset class"
                      >
                        {ASSET_CLASS_TABS.map((tab) => {
                          const active = settingsAssetClass === tab.id
                          const Icon = tab.Icon
                          return (
                            <button
                              key={tab.id}
                              type="button"
                              role="tab"
                              aria-selected={active}
                              onClick={() => selectSettingsAssetClass(tab.id)}
                              className={cn(
                                'inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors',
                                active
                                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                              <span className="truncate">{tab.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <Separator />

                    {/* Section 1 — window thresholds */}
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        1 · Rolling-return thresholds ·{' '}
                        {ASSET_CLASS_TABS.find((t) => t.id === settingsAssetClass)
                          ?.label || 'Stocks'}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        |move %| needed to start / keep an episode on each
                        window. Click Save to apply. Blank / 0 = off.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {THRESHOLD_EDIT_KEYS.map((key) => (
                        <label key={key} className="block">
                          <span className="text-[10px] font-medium uppercase text-muted-foreground">
                            {key === 'day' ? 'vs prev close' : key}
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            placeholder="off"
                            value={thresholdDraft[key] ?? ''}
                            onChange={(e) =>
                              onThresholdDraftChange(key, e.target.value)
                            }
                            className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] font-semibold tabular-nums text-foreground"
                          />
                        </label>
                      ))}
                    </div>

                    <Separator />

                    {/* Section 2 — episode rules (accel / giveback / inactivity) */}
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        2 · Episode rules ·{' '}
                        {ASSET_CLASS_TABS.find((t) => t.id === settingsAssetClass)
                          ?.label || 'Stocks'}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        Acceleration, giveback (weakening), inactivity, re-arm.
                        Click Save to apply (stocks ≠ commodities ≠ crypto).
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          Accel alert (pp)
                        </span>
                        <input
                          type="number"
                          min={0.1}
                          step={0.1}
                          value={policyDraft.accelerationAlertDeltaPp ?? '2'}
                          onChange={(e) =>
                            onPolicyDraftChange(
                              'accelerationAlertDeltaPp',
                              e.target.value,
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] font-semibold tabular-nums"
                          title="Extra percentage points beyond last notified move to fire ACCEL push"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          Material progress (pp)
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={policyDraft.materialProgressDeltaPp ?? '0.5'}
                          onChange={(e) =>
                            onPolicyDraftChange(
                              'materialProgressDeltaPp',
                              e.target.value,
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] font-semibold tabular-nums"
                          title="New extreme pp that resets the inactivity clock"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          → Weakening (%)
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={
                            policyDraft.holdingToWeakeningGivebackPct ?? '25'
                          }
                          onChange={(e) =>
                            onPolicyDraftChange(
                              'holdingToWeakeningGivebackPct',
                              e.target.value,
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] font-semibold tabular-nums"
                          title="Giveback % of peak move to enter WEAKENING"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          ← Holding again (%)
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={
                            policyDraft.weakeningToHoldingGivebackPct ?? '20'
                          }
                          onChange={(e) =>
                            onPolicyDraftChange(
                              'weakeningToHoldingGivebackPct',
                              e.target.value,
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] font-semibold tabular-nums"
                          title="Giveback must fall back to this % to return to HOLDING (hysteresis)"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          Strong weakening (%)
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={
                            policyDraft.strongWeakeningGivebackPct ?? '60'
                          }
                          onChange={(e) =>
                            onPolicyDraftChange(
                              'strongWeakeningGivebackPct',
                              e.target.value,
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] font-semibold tabular-nums"
                          title="Giveback % for STRONGLY_WEAKENING push"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          Inactivity expire (eligible min)
                        </span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={
                            policyDraft.episodeInactivityExpiryMin ?? '180'
                          }
                          onChange={(e) =>
                            onPolicyDraftChange(
                              'episodeInactivityExpiryMin',
                              e.target.value,
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] font-semibold tabular-nums"
                          title="Expire after this many eligible trading minutes with no material momentum (default 180 = 3 hours). Maintenance, stale data, and weekly close do not count."
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          Re-arm buffer (pp)
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={policyDraft.rearmBufferPp ?? '1'}
                          onChange={(e) =>
                            onPolicyDraftChange('rearmBufferPp', e.target.value)
                          }
                          className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] font-semibold tabular-nums"
                          title="After FULL end: cool below thr−buffer to re-arm direction"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-medium text-muted-foreground">
                          START push max age (min)
                        </span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={policyDraft.startPushMaxAgeMin ?? '5'}
                          onChange={(e) =>
                            onPolicyDraftChange(
                              'startPushMaxAgeMin',
                              e.target.value,
                            )
                          }
                          className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] font-semibold tabular-nums"
                          title="Drop late START pushes if research takes longer than this"
                        />
                      </label>
                      <label className="col-span-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                        <span className="min-w-0">
                          <span className="block text-[11px] font-semibold text-foreground">
                            Strong fade push
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Push when giveback hits strong-weakening band
                          </span>
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={
                            policyDraft.majorFadeAlertEnabled !== '0'
                          }
                          onClick={() =>
                            onPolicyDraftChange(
                              'majorFadeAlertEnabled',
                              policyDraft.majorFadeAlertEnabled === '0'
                                ? '1'
                                : '0',
                            )
                          }
                          className={cn(
                            'relative h-7 w-12 shrink-0 rounded-full transition-colors',
                            policyDraft.majorFadeAlertEnabled !== '0'
                              ? 'bg-emerald-500'
                              : 'bg-muted-foreground/30',
                          )}
                        >
                          <span
                            className={cn(
                              'absolute top-0.5 size-6 rounded-full bg-background shadow transition-transform',
                              policyDraft.majorFadeAlertEnabled !== '0'
                                ? 'left-5'
                                : 'left-0.5',
                            )}
                          />
                        </button>
                      </label>
                    </div>
                    <p
                      className={cn(
                        'text-[10px] font-medium',
                        policySaveState === 'error'
                          ? 'text-rose-600'
                          : policySaveState === 'saved'
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-muted-foreground',
                      )}
                    >
                      {policySaving || policySaveState === 'saving'
                        ? `Saving ${ASSET_CLASS_TABS.find((t) => t.id === assetClassTab)?.label || 'episode'} rules…`
                        : policySaveState === 'saved'
                          ? `Episode rules saved · ${ASSET_CLASS_TABS.find((t) => t.id === assetClassTab)?.label || assetClassTab} · Supabase`
                          : policySaveState === 'error'
                            ? 'Episode rules save failed'
                            : 'Episode rules auto-save per asset class'}
                    </p>

                    {onOpenInTrigger ? (
                      <>
                        <Separator />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-full justify-start gap-2 px-2"
                          onClick={() => {
                            closeThresholdSettings()
                            onOpenInTrigger(displayTicker, {
                              label: activeTab?.label || displayTicker,
                            })
                          }}
                        >
                          <ArrowUpRight className="size-3.5" />
                          Open {displayTicker} in Trigger
                        </Button>
                      </>
                    ) : null}
                  </div>
                </ScrollArea>
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/60 px-3 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 text-[11px] font-medium',
                      thresholdSaveState === 'error'
                        ? 'text-rose-600'
                        : thresholdSaveState === 'saved'
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-muted-foreground',
                    )}
                  >
                    {thresholdSaving ||
                    policySaving ||
                    thresholdSaveState === 'saving' ||
                    policySaveState === 'saving' ? (
                      <>
                        <Loader2 className="size-3 animate-spin" />
                        Saving…
                      </>
                    ) : thresholdSaveState === 'error' ||
                      policySaveState === 'error' ? (
                      'Save failed — try again'
                    ) : thresholdSaveState === 'saved' ||
                      policySaveState === 'saved' ? (
                      <>
                        <Check className="size-3" strokeWidth={2.5} />
                        Saved to Supabase
                      </>
                    ) : (
                      'Unsaved — click Save'
                    )}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    className="ml-auto gap-1.5"
                    disabled={thresholdSaving || policySaving}
                    onClick={() => void saveSettingsNow()}
                  >
                    {thresholdSaving || policySaving ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={closeThresholdSettings}
                  >
                    Close
                  </Button>
                </div>
              </div>
            ) : rightRailMode === 'events' ? (
              <ScrollArea className="min-h-0 flex-1">
                <TooltipProvider delayDuration={250}>
                <div className="px-2.5 py-3">
                  <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                    Episodes
                  </p>

                  {(() => {
                    const groups = buildEpisodeGroups(
                      status?.episodes,
                      status?.events,
                      episode,
                    ).map((g) => {
                      const next = ensureGroupHasStartedEvent(g)
                      // Attach live V1 state (Holding / Weakening / …) to the active group
                      if (
                        next.status === 'ACTIVE' &&
                        episode &&
                        episode.state &&
                        (!next.episodeId ||
                          next.episodeId === episode.episodeId)
                      ) {
                        return {
                          ...next,
                          liveState: episode.state,
                          episodeNo:
                            next.episodeNo ?? episode.episodeNo ?? null,
                        }
                      }
                      return next
                    })
                    if (!groups.length && !episode) {
                      return (
                        <p className="px-3 py-8 text-[12px] text-muted-foreground">
                          No episode activity yet
                        </p>
                      )
                    }

                    // Live episode only if its window is ≤24h and not already listed
                    const liveOnly =
                      episode &&
                      isIntradayOr24hEventWindow(episode.detectedWindow) &&
                      !groups.some(
                        (g) =>
                          g.status === 'ACTIVE' ||
                          (episode.episodeId &&
                            g.episodeId === episode.episodeId),
                      )
                        ? ([
                            ensureGroupHasStartedEvent({
                              id: `live-${episode.episodeId || episode.episodeStartedAt}`,
                              direction: episode.direction,
                              startedAt: episode.episodeStartedAt,
                              endedAt: null,
                              status: 'ACTIVE' as const,
                              peakMovePercent: episode.peakMovePercent,
                              window: episode.detectedWindow || '—',
                              events: [] as MomentumEvent[],
                              liveState: episode.state || 'STARTED',
                              episodeId: episode.episodeId || null,
                              episodeNo: episode.episodeNo ?? null,
                            }),
                          ] as EpisodeEventGroup[])
                        : []

                    const allGroups = [...liveOnly, ...groups]

                    return (
                      <div className="space-y-3">
                        {allGroups.map((group, gi) => {
                          const matchesLive =
                            episode != null &&
                            (group.episodeId
                              ? group.episodeId === episode.episodeId
                              : group.startedAt === episode.episodeStartedAt ||
                                (gi === 0 && group.status === 'ACTIVE'))
                          // Status Active = episode row is open — never hide behind matchesLive
                          const isActive = group.status === 'ACTIVE'
                          const isLiveFocus =
                            isActive && episode != null && matchesLive
                          // Always offer End on ACTIVE episode cards (settings / events rail)
                          const canEndEpisode = isActive
                          const lastStateFromEvents = [...group.events]
                            .reverse()
                            .find(
                              (e) =>
                                e.state ||
                                String(e.eventType || '').includes('STATE') ||
                                e.reason,
                            )
                          const liveStateLabel = isActive
                            ? formatEpisodeState(
                                group.liveState ||
                                  (matchesLive ? episode?.state : null) ||
                                  lastStateFromEvents?.state ||
                                  lastStateFromEvents?.reason ||
                                  'STARTED',
                              )
                            : formatEpisodeState(group.endReason) || 'Ended'
                          const episodeLabel = formatEpisodeNo(group.episodeNo)
                          const givebackPct = isLiveFocus
                            ? computeEpisodeGivebackPercent(episode || {})
                            : lastGivebackFromEvents(group.events)
                          const givebackLabel = fmtGivebackPct(givebackPct)
                          const groupPersist =
                            group.events
                              .map((e) => eventPersistStamp(e))
                              .find((p) => p?.ok) ||
                            (matchesLive ? episode?.supabasePersist : null) ||
                            null
                          // Active = expanded by default; past episodes collapsed.
                          const isExpanded =
                            episodeExpanded[group.id] ?? isActive
                          const supabaseUrl = supabaseEpisodeRecordUrl(
                            group.episodeId ||
                              (matchesLive ? episode?.episodeId : null),
                            {
                              ticker: displayTicker,
                              assetClass: activeAssetClass,
                            },
                          )
                          return (
                            <div key={group.id} className="relative min-w-0">
                              {/* Episode parent pill — direction + live V1 state */}
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  setEpisodeExpanded((prev) => ({
                                    ...prev,
                                    [group.id]: !isExpanded,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    setEpisodeExpanded((prev) => ({
                                      ...prev,
                                      [group.id]: !isExpanded,
                                    }))
                                  }
                                }}
                                className={cn(
                                  'relative flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 pr-9 transition-colors',
                                  isActive
                                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                                    : 'text-foreground/90 hover:bg-muted/40',
                                  !isExpanded && !isActive && 'opacity-90',
                                )}
                              >
                                {supabaseUrl ? (
                                  <button
                                    type="button"
                                    className="absolute right-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                    title="Open Supabase SQL: episode + events + research"
                                    aria-label="Open episode bundle in Supabase SQL editor"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      e.preventDefault()
                                      void openEpisodeInSupabaseDashboard({
                                        episodeId:
                                          group.episodeId ||
                                          (matchesLive
                                            ? episode?.episodeId
                                            : null),
                                        ticker: displayTicker,
                                        assetClass: activeAssetClass,
                                      })
                                    }}
                                  >
                                    <ArrowUpRight
                                      className="size-3.5"
                                      strokeWidth={2}
                                    />
                                  </button>
                                ) : null}
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
                                    {episodeLabel ? (
                                      <span
                                        className="font-mono text-[12px] font-semibold tabular-nums text-foreground"
                                        title="Episode number"
                                      >
                                        {episodeLabel}
                                      </span>
                                    ) : null}
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
                                          liveStateLabel === 'Started'
                                            ? 'bg-sky-500/15 text-sky-800 dark:text-sky-200'
                                            : liveStateLabel === 'Holding'
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
                                        {givebackLabel ? (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span
                                                className="ml-1 cursor-help font-semibold normal-case tracking-normal tabular-nums opacity-90 underline decoration-dotted decoration-muted-foreground/50 underline-offset-2"
                                                onClick={(e) =>
                                                  e.stopPropagation()
                                                }
                                              >
                                                · {givebackLabel} GB
                                              </span>
                                            </TooltipTrigger>
                                            <CalcTooltipContent side="bottom">
                                              <GivebackCalcBody
                                                direction={group.direction}
                                                givebackPercent={givebackPct}
                                                peakPrice={
                                                  matchesLive
                                                    ? episode?.peakPrice
                                                    : group.events.find(
                                                        (e) =>
                                                          e.peakPrice != null,
                                                      )?.peakPrice
                                                }
                                                troughPrice={
                                                  matchesLive
                                                    ? episode?.troughPrice
                                                    : group.events.find(
                                                        (e) =>
                                                          e.troughPrice != null,
                                                      )?.troughPrice
                                                }
                                                referencePrice={
                                                  matchesLive
                                                    ? episode?.referencePrice
                                                    : group.events.find(
                                                        (e) =>
                                                          e.referencePrice !=
                                                          null,
                                                      )?.referencePrice
                                                }
                                                currentPrice={
                                                  matchesLive
                                                    ? episode?.currentPrice
                                                    : group.events.find(
                                                        (e) => e.price != null,
                                                      )?.price
                                                }
                                                peakMovePercent={
                                                  matchesLive
                                                    ? episode?.peakMovePercent
                                                    : group.peakMovePercent
                                                }
                                                currentMovePercent={
                                                  matchesLive
                                                    ? episode?.currentMovePercent
                                                    : null
                                                }
                                                weakThreshold={
                                                  status?.config?.episodePolicy
                                                    ?.holdingToWeakeningGiveback ??
                                                  0.25
                                                }
                                                holdThreshold={
                                                  status?.config?.episodePolicy
                                                    ?.weakeningToHoldingGiveback ??
                                                  0.2
                                                }
                                                strongThreshold={
                                                  status?.config?.episodePolicy
                                                    ?.strongWeakeningGiveback ??
                                                  0.6
                                                }
                                                assetClass={activeAssetClass}
                                                currency={quoteCurrency}
                                              />
                                            </CalcTooltipContent>
                                          </Tooltip>
                                        ) : null}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                        {liveStateLabel || 'Ended'}
                                        {givebackLabel ? (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span
                                                className="cursor-help font-medium tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-2"
                                                onClick={(e) =>
                                                  e.stopPropagation()
                                                }
                                              >
                                                {' '}
                                                · {givebackLabel} GB
                                              </span>
                                            </TooltipTrigger>
                                            <CalcTooltipContent side="bottom">
                                              <GivebackCalcBody
                                                direction={group.direction}
                                                givebackPercent={givebackPct}
                                                peakPrice={
                                                  matchesLive
                                                    ? episode?.peakPrice
                                                    : group.events.find(
                                                        (e) =>
                                                          e.peakPrice != null,
                                                      )?.peakPrice
                                                }
                                                troughPrice={
                                                  matchesLive
                                                    ? episode?.troughPrice
                                                    : group.events.find(
                                                        (e) =>
                                                          e.troughPrice != null,
                                                      )?.troughPrice
                                                }
                                                referencePrice={
                                                  matchesLive
                                                    ? episode?.referencePrice
                                                    : group.events.find(
                                                        (e) =>
                                                          e.referencePrice !=
                                                          null,
                                                      )?.referencePrice
                                                }
                                                currentPrice={
                                                  matchesLive
                                                    ? episode?.currentPrice
                                                    : group.events.find(
                                                        (e) => e.price != null,
                                                      )?.price
                                                }
                                                peakMovePercent={
                                                  matchesLive
                                                    ? episode?.peakMovePercent
                                                    : group.peakMovePercent
                                                }
                                                currentMovePercent={
                                                  matchesLive
                                                    ? episode?.currentMovePercent
                                                    : null
                                                }
                                                weakThreshold={
                                                  status?.config?.episodePolicy
                                                    ?.holdingToWeakeningGiveback ??
                                                  0.25
                                                }
                                                holdThreshold={
                                                  status?.config?.episodePolicy
                                                    ?.weakeningToHoldingGiveback ??
                                                  0.2
                                                }
                                                strongThreshold={
                                                  status?.config?.episodePolicy
                                                    ?.strongWeakeningGiveback ??
                                                  0.6
                                                }
                                                assetClass={activeAssetClass}
                                                currency={quoteCurrency}
                                              />
                                            </CalcTooltipContent>
                                          </Tooltip>
                                        ) : null}
                                      </span>
                                    )}
                                    {canEndEpisode ? (
                                      <button
                                        type="button"
                                        disabled={
                                          endingEpisode || !!deletingEpisodeId
                                        }
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          e.preventDefault()
                                          void endActiveEpisode({
                                            ticker: displayTicker,
                                            direction: group.direction,
                                            peakMovePercent:
                                              group.peakMovePercent ??
                                              (matchesLive
                                                ? episode?.peakMovePercent
                                                : null),
                                          })
                                        }}
                                        onPointerDown={(e) =>
                                          e.stopPropagation()
                                        }
                                        title="Manually end this episode (no push)"
                                        aria-label="End episode"
                                        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-rose-700 transition-colors hover:bg-rose-500/10 hover:text-rose-800 disabled:opacity-50 dark:text-rose-400"
                                      >
                                        {endingEpisode ? (
                                          <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                          <X
                                            className="size-3"
                                            strokeWidth={2.25}
                                          />
                                        )}
                                      </button>
                                    ) : null}
                                    {groupPersist ? (
                                      <SupabasePersistBadge persist={groupPersist} />
                                    ) : null}
                                    <span className="ml-auto flex shrink-0 items-center gap-1">
                                      {group.episodeId ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          disabled={
                                            episodeEditSaving ||
                                            endingEpisode ||
                                            !!deletingEpisodeId
                                          }
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            e.preventDefault()
                                            openEpisodeEdit(group)
                                          }}
                                          onPointerDown={(e) =>
                                            e.stopPropagation()
                                          }
                                          title="Edit episode status, times, prices, and timeline rows"
                                          className="h-6 shrink-0 gap-1 rounded-full px-2 text-[10px] font-semibold text-muted-foreground hover:border-sky-300 hover:bg-sky-500/10 hover:text-sky-800"
                                        >
                                          <Pencil
                                            className="size-3"
                                            strokeWidth={2}
                                          />
                                          Edit
                                        </Button>
                                      ) : null}
                                      {group.episodeId ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          disabled={
                                            !!deletingEpisodeId || endingEpisode
                                          }
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            e.preventDefault()
                                            void deleteEpisodeFromSupabaseUi(
                                              group,
                                            )
                                          }}
                                          onPointerDown={(e) =>
                                            e.stopPropagation()
                                          }
                                          title="Permanently delete this episode from Supabase"
                                          className="h-6 shrink-0 gap-1 rounded-full px-2 text-[10px] font-semibold text-rose-700 hover:border-rose-400 hover:bg-rose-500/15 dark:text-rose-300"
                                        >
                                          {deletingEpisodeId &&
                                          deletingEpisodeId ===
                                            group.episodeId ? (
                                            <Loader2 className="size-3 animate-spin" />
                                          ) : (
                                            <Trash2
                                              className="size-3"
                                              strokeWidth={2}
                                            />
                                          )}
                                          Delete
                                        </Button>
                                      ) : null}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    <span className="font-medium">
                                      {group.window || '—'}
                                    </span>
                                    {sessionDateLabel(group.marketSession) &&
                                    sessionDateLabel(group.marketSession) !==
                                      'regular'
                                      ? ` · ${sessionDateLabel(group.marketSession)}`
                                      : ''}
                                    {' · '}
                                    {fmtEpisodeWhen(
                                      group.startedAt,
                                      group.marketSession,
                                    )}
                                    {group.endedAt
                                      ? ` → ${fmtEpisodeWhen(group.endedAt, group.marketSession)}`
                                      : ''}
                                    {' · Peak '}
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span
                                          className={cn(
                                            'cursor-help font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-2',
                                            pctColor(group.peakMovePercent),
                                          )}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {fmtPct(group.peakMovePercent)}
                                        </span>
                                      </TooltipTrigger>
                                      <CalcTooltipContent side="bottom">
                                        <PeakMoveCalcBody
                                          direction={group.direction}
                                          peakMovePercent={group.peakMovePercent}
                                          peakPrice={
                                            matchesLive
                                              ? episode?.peakPrice
                                              : group.events.find(
                                                  (e) => e.peakPrice != null,
                                                )?.peakPrice
                                          }
                                          troughPrice={
                                            matchesLive
                                              ? episode?.troughPrice
                                              : group.events.find(
                                                  (e) => e.troughPrice != null,
                                                )?.troughPrice
                                          }
                                          referencePrice={
                                            matchesLive
                                              ? episode?.referencePrice
                                              : group.events.find(
                                                  (e) =>
                                                    e.referencePrice != null,
                                                )?.referencePrice
                                          }
                                          assetClass={activeAssetClass}
                                          currency={quoteCurrency}
                                        />
                                      </CalcTooltipContent>
                                    </Tooltip>
                                    {isLiveFocus &&
                                    episode?.currentMovePercent != null ? (
                                      <>
                                        {' · Now '}
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <span
                                              className={cn(
                                                'cursor-help font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-2',
                                                pctColor(
                                                  episode.currentMovePercent,
                                                ),
                                              )}
                                              onClick={(e) =>
                                                e.stopPropagation()
                                              }
                                            >
                                              {fmtPct(
                                                episode.currentMovePercent,
                                              )}
                                            </span>
                                          </TooltipTrigger>
                                          <CalcTooltipContent side="bottom">
                                            <EpisodeListMoveCalcBody
                                              row={{
                                                ticker: displayTicker,
                                                direction: group.direction,
                                                referencePrice:
                                                  episode.referencePrice ??
                                                  null,
                                                peakPrice:
                                                  episode.peakPrice ?? null,
                                                troughPrice:
                                                  episode.troughPrice ?? null,
                                                currentPrice:
                                                  episode.currentPrice ?? null,
                                                peakMovePercent:
                                                  episode.peakMovePercent ??
                                                  group.peakMovePercent,
                                                currentMovePercent:
                                                  episode.currentMovePercent,
                                              }}
                                              shownMove={
                                                episode.currentMovePercent
                                              }
                                              shownKind="current"
                                            />
                                          </CalcTooltipContent>
                                        </Tooltip>
                                      </>
                                    ) : null}
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
                                            {fmtEpisodeWhen(String(fromEvents))}
                                          </span>
                                        </>
                                      )
                                    })()}
                                  </p>
                                </div>
                                <span className="mt-1.5 flex shrink-0 flex-col items-center gap-1">
                                  {isActive ? (
                                    <span className="size-1.5 rounded-full bg-foreground" />
                                  ) : null}
                                  {isExpanded ? (
                                    <ChevronUp className="size-3.5 text-muted-foreground" />
                                  ) : (
                                    <ChevronDown className="size-3.5 text-muted-foreground" />
                                  )}
                                </span>
                              </div>

                              {isExpanded && group.events.length > 0 ? (
                                <div className="mt-2 rounded-xl border border-border/70 bg-background/60 px-2.5 py-2">
                                  <EpisodeHowBuiltBlock
                                    group={group}
                                    assetClass={activeAssetClass}
                                    currency={quoteCurrency}
                                    liveEpisode={matchesLive ? episode : null}
                                    matchesLive={matchesLive}
                                    defaultOpen
                                  />
                                </div>
                              ) : isActive ? (
                                <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
                                  Expand for how this move built
                                  {liveStateLabel ? ` · ${liveStateLabel}` : ''}
                                  {group.events.length
                                    ? ` · ${buildTimelineSteps(group.events).length} steps`
                                    : ''}
                                </p>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
                </TooltipProvider>
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
                <div className="space-y-0 p-2">
                  <div ref={logTopRef} />
                  {!logs.length ? (
                    <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                      No activity yet. Wait for the poll loop or press Run tick.
                    </p>
                  ) : (
                    logs.map((log, i) => {
                      const logKey = `${log.at}-${i}-${log.message?.slice(0, 24) || ''}`
                      const msgExpanded = Boolean(logMsgExpanded[logKey])
                      const longMsg =
                        String(log.message || '').split('\n').length > 2 ||
                        String(log.message || '').length > 140
                      return (
                        <button
                          key={logKey}
                          type="button"
                          onClick={() => setLogDetail(log)}
                          className="flex w-full flex-col gap-0.5 border-b border-border/50 px-2 py-2 text-left transition-colors hover:bg-muted/50"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                              {fmtTime(log.at)}
                            </span>
                            <span
                              className={cn(
                                'text-[9px] font-semibold uppercase tracking-wide',
                                sourceBadge(log.source),
                                'rounded px-1 py-px',
                              )}
                            >
                              {log.source}
                            </span>
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
                            <span className="ml-auto text-[9px] text-muted-foreground">
                              Details →
                            </span>
                          </div>
                          <p
                            className={cn(
                              'text-[11px] leading-snug',
                              levelClass(log.level),
                              !msgExpanded && longMsg && 'line-clamp-2',
                            )}
                          >
                            {log.message}
                          </p>
                          {longMsg ? (
                            <span
                              role="button"
                              tabIndex={0}
                              className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation()
                                setLogMsgExpanded((prev) => ({
                                  ...prev,
                                  [logKey]: !msgExpanded,
                                }))
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setLogMsgExpanded((prev) => ({
                                    ...prev,
                                    [logKey]: !msgExpanded,
                                  }))
                                }
                              }}
                            >
                              {msgExpanded ? 'Show less' : 'Show more'}
                            </span>
                          ) : null}
                        </button>
                      )
                    })
                  )}
                </div>
              </ScrollArea>
            )}
          </aside>
        )) : null}
          </div>
          {/* end detail + log row */}
        </div>
        {/* end right stack */}
      </div>
      {/* end full-height left | right split */}

      {/* ── Bottom bar: Perplexity | asset tabs + settings | market + clocks ── */}
      <div className="grid h-12 shrink-0 grid-cols-3 items-center gap-2 border-t border-border bg-background px-3 py-1.5 sm:px-4">
        <div className="inline-flex min-w-0 items-center justify-start gap-2">
          <button
            type="button"
            onClick={() => void loadPerplexityUsage({ open: true })}
            title="Perplexity cost — click for breakdown"
            className="inline-flex min-w-0 items-center justify-start gap-1.5 text-left transition-opacity hover:opacity-80"
          >
            <PerplexityLogo className="size-3.5" />
            <span className="font-mono text-[12px] font-medium tabular-nums tracking-tight text-foreground sm:text-[13px]">
              $
              {(Number(pplxTotals?.total_cost_usd) || 0).toFixed(2)}
            </span>
          </button>
        </div>

        <div className="order-3 hidden items-center justify-end gap-2">
          <TooltipProvider delayDuration={200}>
          {/* Asset-class navigator pill */}
          <div
            className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted p-0.5"
            role="tablist"
            aria-label="Asset class"
          >
            {ASSET_CLASS_TABS.map((tab) => {
              const active = assetClassTab === tab.id
              const Icon = tab.Icon
              return (
                <Tooltip key={tab.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={tab.label}
                      onClick={() => selectAssetClassTab(tab.id)}
                      className={cn(
                        'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                        active
                          ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="px-2 py-1">
                    <p className="text-[12px] font-semibold">{tab.label}</p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          {/* Active episodes pill — desk view with all live episodes */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Active episodes"
                aria-pressed={leftShowsActiveEpisodes}
                title="Show all active episodes"
                onClick={() => {
                  setAssetClassTab(null)
                  saveAssetClassFilter(null)
                  setDeskEpisodeFocus(null)
                  setMainPanelTab('episode')
                  setRightRailMode('yahoo')
                  setLogCollapsedPersist(false)
                  void loadActiveEpisodesList()
                  void loadAllEpisodesHistory()
                }}
                className={cn(
                  'relative inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted transition-colors hover:bg-background hover:text-foreground hover:shadow-sm',
                  leftShowsActiveEpisodes
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground',
                )}
              >
                <Activity className="size-3.5" strokeWidth={1.75} />
                {activeEpisodesList.length > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground px-0.5 text-[9px] font-bold leading-none text-background">
                    {activeEpisodesList.length > 99
                      ? '99+'
                      : activeEpisodesList.length}
                  </span>
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="px-2 py-1">
              <p className="text-[12px] font-semibold">Active episodes</p>
              <p className="text-[11px] text-background/80">
                {activeEpisodesList.length
                  ? `${activeEpisodesList.length} live now`
                  : 'All live momentum episodes'}
              </p>
            </TooltipContent>
          </Tooltip>

          {/* Settings pill */}
          <div className="inline-flex items-center rounded-full border border-border bg-muted p-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Settings"
                  aria-label="Settings"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground hover:shadow-sm"
                >
                  <Settings className="size-3.5" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="center"
                side="top"
                sideOffset={10}
                className="min-w-[16.5rem] max-w-[20rem]"
              >
                <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Settings
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => {
                    openThresholdSettings()
                  }}
                >
                  <Settings className="size-3.5" strokeWidth={1.75} />
                  Thresholds & episode rules
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => setPerplexityPromptsOpen(true)}
                >
                  <ScrollText className="size-3.5" strokeWidth={1.75} />
                  Perplexity prompts
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 text-rose-700 focus:text-rose-700 dark:text-rose-300 dark:focus:text-rose-300"
                  onSelect={() => {
                    void clearDeskCache()
                  }}
                >
                  <RotateCcw className="size-3.5" strokeWidth={1.75} />
                  Clear Cache
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => {
                    if (onOpenTriggerApp) onOpenTriggerApp()
                    else if (onOpenInTrigger) {
                      onOpenInTrigger(displayTicker, {
                        label: activeTab?.label || displayTicker,
                      })
                    }
                  }}
                >
                  <Zap className="size-3.5" strokeWidth={1.75} />
                  Trigger dashboard
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={(e) => {
                    e.preventDefault()
                    onToggleTheme?.()
                  }}
                >
                  {theme === 'dark' ? (
                    <Sun className="size-3.5" strokeWidth={1.75} />
                  ) : (
                    <Moon className="size-3.5" strokeWidth={1.75} />
                  )}
                  <span className="flex-1">
                    {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {theme === 'dark' ? 'On' : 'Off'}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          </TooltipProvider>
        </div>

        <button
          type="button"
          className={cn(
            'order-2 flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-0 rounded-md px-2 py-1 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
            marketStatusOpen && 'bg-muted/50 ring-1 ring-border',
          )}
          aria-label="Market sessions — hover for global exchange sessions"
          aria-expanded={marketStatusOpen}
          onPointerEnter={openMarketStatusFromHover}
          onPointerLeave={scheduleMarketStatusHoverClose}
          onFocus={openMarketStatusFromHover}
          onBlur={scheduleMarketStatusHoverClose}
          onClick={() => openMarketStatusFromHover()}
        >
          <div
            className="flex min-w-0 items-center gap-x-1.5 whitespace-nowrap text-[12px] tabular-nums leading-none"
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
          <span
            className="h-4 w-px shrink-0 bg-border"
            aria-hidden
          />
          <MarketStatusBadge
            nowMs={nowMs}
            className="gap-1.5 text-[12px]"
            yahooMarketState={
              marketStatusRows.find((r) => r.id === 'us-stocks')?.marketState ??
              null
            }
          />
        </button>

        {/* Centered market sessions over a full-screen blurred backdrop. */}
        {marketStatusOpen ? (
          <div
            className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
            role="presentation"
          >
            <div
              className="absolute inset-0 bg-background/35 backdrop-blur-md"
              aria-hidden
            />
            <div
              data-market-sessions-panel
              role="dialog"
              aria-modal="false"
              aria-label="Market sessions"
              className="pointer-events-auto relative flex max-h-[min(82svh,48rem)] w-[min(94vw,68rem)] flex-col overflow-hidden rounded-2xl border border-border bg-popover/95 text-popover-foreground shadow-2xl ring-1 ring-foreground/10"
              onPointerEnter={cancelMarketStatusHoverClose}
              onPointerLeave={scheduleMarketStatusHoverClose}
            >
              <div className="shrink-0 border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold tracking-tight">
                      Market sessions
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Global session status · click a card for Yahoo Finance
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] tabular-nums text-muted-foreground">
                      {marketStatusRows.length} markets
                      {marketStatusLoading ? ' · refreshing…' : ''}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setMarketStatusOpen(false)}
                      title="Close market sessions"
                      aria-label="Close market sessions"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
                {marketStatusLoading && !marketStatusRows.length ? (
                  <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Probing global markets via Yahoo…
                  </p>
                ) : null}
                {marketStatusError ? (
                  <p className="mb-3 text-[13px] text-rose-600">
                    {marketStatusError}
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  {marketStatusRows.map((row) => {
                    // Exact Yahoo marketState only (PREPRE / POST / CLOSED / …).
                    const session = row.marketState
                      ? String(row.marketState).trim().toUpperCase()
                      : row.currentSession && row.currentSession !== '—'
                        ? String(row.currentSession).trim().toUpperCase()
                        : '—'
                    const latestLabel =
                      row.lastUpdateLondon ||
                      (row.quoteAgeSec != null
                        ? `${Math.round(row.quoteAgeSec)}s ago`
                        : '—')
                    const flag = marketSessionFlag(row)
                    const href = yahooFinanceQuoteUrl(row.symbol)
                    return (
                      <a
                        key={row.id}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open ${row.symbol} on Yahoo Finance`}
                        className="flex w-full flex-col gap-1 rounded-xl border border-border/80 bg-card/80 p-3 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span
                            className="shrink-0 text-[2.75rem] leading-none"
                            aria-hidden
                          >
                            {flag}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                              {row.label}
                            </p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground">
                              {row.exchange ? `${row.exchange} · ` : ''}
                              {row.symbol}
                            </p>
                            {row.region ? (
                              <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/80">
                                {row.region}
                              </p>
                            ) : null}
                          </div>
                          <ArrowUpRight
                            className="mt-0.5 size-3 shrink-0 text-muted-foreground/70"
                            strokeWidth={1.75}
                          />
                        </div>
                        <p
                          className={cn(
                            'font-mono text-sm font-semibold tracking-tight',
                            marketSessionToneClass(session),
                          )}
                        >
                          {session}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {row.status || row.engineLabel || '—'}
                          {' · '}
                          {latestLabel}
                        </p>
                        {row.child ? (
                          <p className="mt-0.5 border-t border-border/60 pt-1 text-[10px] text-muted-foreground">
                            <span
                              aria-hidden
                              className="mr-1.5 inline-block align-middle text-[1.35rem] leading-none"
                            >
                              {marketSessionFlag(row.child)}
                            </span>
                            <span className="font-medium text-foreground/80">
                              {row.child.label}
                            </span>
                            {' · '}
                            <span
                              className={cn(
                                'font-mono',
                                marketSessionToneClass(
                                  row.child.marketState ||
                                    row.child.currentSession,
                                ),
                              )}
                            >
                              {row.child.marketState
                                ? String(row.child.marketState)
                                    .trim()
                                    .toUpperCase()
                                : row.child.currentSession &&
                                    row.child.currentSession !== '—'
                                  ? String(row.child.currentSession)
                                      .trim()
                                      .toUpperCase()
                                  : '—'}
                            </span>
                          </p>
                        ) : null}
                      </a>
                    )
                  })}
                </div>
                {marketStatusFooter ? (
                  <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
                    {marketStatusFooter}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Activity log detail dialog */}
      <Dialog
        open={logDetail != null}
        onOpenChange={(open) => {
          if (!open) setLogDetail(null)
        }}
      >
        <DialogContent className="flex max-h-[min(88svh,40rem)] max-w-lg flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-3 pr-12 text-left">
            <DialogTitle className="text-base">Activity log detail</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              {logDetail
                ? `${fmtDateTime(logDetail.at) || logDetail.at} · ${logDetail.source} · ${logDetail.level}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {logDetail ? (
              <>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Message
                  </p>
                  <p
                    className={cn(
                      'mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed',
                      levelClass(logDetail.level),
                    )}
                  >
                    {logDetail.message}
                  </p>
                </div>
                {logDetail.detail != null ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Detail
                    </p>
                    <pre className="mt-1 max-h-[min(40vh,20rem)] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-snug text-foreground/90">
                      {typeof logDetail.detail === 'string'
                        ? logDetail.detail
                        : JSON.stringify(logDetail.detail, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    No extra detail payload on this log entry.
                  </p>
                )}
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <PerplexityPromptsDialog
        open={perplexityPromptsOpen}
        onOpenChange={setPerplexityPromptsOpen}
      />

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
                              {'snippet' in src && src.snippet ? (
                                <p className="mt-0.5 line-clamp-2 text-muted-foreground">
                                  {String(src.snippet)}
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
                          <CompanyLogo
                            ticker={symbol}
                            companyName={name}
                            size="sm"
                            className="mt-0.5 size-8 bg-background"
                          />
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
                    <ArrowUpRight className="size-3.5 opacity-70" />
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

      {/* Edit episode — full field editor for Recent Events */}
      <Dialog
        open={episodeEditOpen}
        onOpenChange={(open) => {
          if (!open && !episodeEditSaving) {
            setEpisodeEditOpen(false)
            setEpisodeEditDraft(null)
            setEpisodeEditError('')
          }
        }}
      >
        <DialogContent
          showCloseButton
          data-momentum-dashboard
          className="flex max-h-[min(92dvh,48rem)] w-[min(100vw-1rem,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <DialogHeader className="shrink-0 border-b border-border px-5 py-3 pr-12 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="size-4" strokeWidth={2} />
              Edit episode
              {episodeEditDraft?.episodeNo
                ? ` ${formatEpisodeNo(Number(episodeEditDraft.episodeNo)) || ''}`
                : ''}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">
              Change status, times, prices, and timeline rows. Deleting the
              END event reopens the episode (no separate end reason).
              {episodeEditDraft?.episodeId ? (
                <span className="mt-0.5 block font-mono text-[10px] opacity-80">
                  {episodeEditDraft.episodeId}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {episodeEditDraft ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {episodeEditError ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-800 dark:text-rose-200">
                  {episodeEditError}
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Direction
                  </span>
                  <select
                    className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[12px] font-semibold"
                    value={episodeEditDraft.direction}
                    onChange={(e) =>
                      setEpisodeEditDraft((d) =>
                        d
                          ? {
                              ...d,
                              direction:
                                e.target.value === 'DOWN' ? 'DOWN' : 'UP',
                            }
                          : d,
                      )
                    }
                  >
                    <option value="UP">UP</option>
                    <option value="DOWN">DOWN</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Status
                  </span>
                  <select
                    className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[12px] font-semibold"
                    value={episodeEditDraft.status}
                    onChange={(e) =>
                      setEpisodeEditDraft((d) =>
                        d ? { ...d, status: e.target.value } : d,
                      )
                    }
                  >
                    {EPISODE_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    {!EPISODE_STATUS_OPTIONS.includes(
                      episodeEditDraft.status as (typeof EPISODE_STATUS_OPTIONS)[number],
                    ) && episodeEditDraft.status ? (
                      <option value={episodeEditDraft.status}>
                        {episodeEditDraft.status}
                      </option>
                    ) : null}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                    State
                  </span>
                  <select
                    className="h-9 w-full rounded-lg border border-border bg-background px-2 text-[12px] font-semibold"
                    value={episodeEditDraft.state}
                    onChange={(e) =>
                      setEpisodeEditDraft((d) =>
                        d ? { ...d, state: e.target.value } : d,
                      )
                    }
                  >
                    <option value="">—</option>
                    {EPISODE_STATE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    {episodeEditDraft.state &&
                    !EPISODE_STATE_OPTIONS.includes(
                      episodeEditDraft.state as (typeof EPISODE_STATE_OPTIONS)[number],
                    ) ? (
                      <option value={episodeEditDraft.state}>
                        {episodeEditDraft.state}
                      </option>
                    ) : null}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Window
                  </span>
                  <Input
                    value={episodeEditDraft.detectedWindow}
                    onChange={(e) =>
                      setEpisodeEditDraft((d) =>
                        d ? { ...d, detectedWindow: e.target.value } : d,
                      )
                    }
                    className="h-9 text-[12px] font-mono"
                    placeholder="5m"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Exact minutes
                  </span>
                  <Input
                    type="number"
                    value={episodeEditDraft.exactMinutes}
                    onChange={(e) =>
                      setEpisodeEditDraft((d) =>
                        d ? { ...d, exactMinutes: e.target.value } : d,
                      )
                    }
                    className="h-9 text-[12px] font-mono tabular-nums"
                  />
                </label>
              </div>

              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Times
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(
                    [
                      ['episodeStartedAt', 'Started at'],
                      ['endedAt', 'Ended at'],
                      ['referenceTime', 'Reference time'],
                      ['lastMaterialProgressAt', 'Last material progress'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block space-y-1">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {label}
                      </span>
                      <Input
                        type="datetime-local"
                        value={episodeEditDraft[key]}
                        onChange={(e) =>
                          setEpisodeEditDraft((d) =>
                            d ? { ...d, [key]: e.target.value } : d,
                          )
                        }
                        className="h-9 text-[12px] font-mono"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Prices
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(
                    [
                      ['referencePrice', 'Reference'],
                      ['triggerPrice', 'Trigger'],
                      ['currentPrice', 'Current'],
                      ['peakPrice', 'Peak'],
                      ['troughPrice', 'Trough'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block space-y-1">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {label}
                      </span>
                      <Input
                        type="number"
                        step="any"
                        value={episodeEditDraft[key]}
                        onChange={(e) =>
                          setEpisodeEditDraft((d) =>
                            d ? { ...d, [key]: e.target.value } : d,
                          )
                        }
                        className="h-9 text-[12px] font-mono tabular-nums"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Move %
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ['initialMovePercent', 'Initial'],
                      ['peakMovePercent', 'Peak'],
                      ['currentMovePercent', 'Current'],
                      ['lastNotifiedEpisodeMovePct', 'Last notified'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block space-y-1">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {label}
                      </span>
                      <Input
                        type="number"
                        step="any"
                        value={episodeEditDraft[key]}
                        onChange={(e) =>
                          setEpisodeEditDraft((d) =>
                            d ? { ...d, [key]: e.target.value } : d,
                          )
                        }
                        className="h-9 text-[12px] font-mono tabular-nums"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Exact label
                </span>
                <Input
                  value={episodeEditDraft.exactLabel}
                  onChange={(e) =>
                    setEpisodeEditDraft((d) =>
                      d ? { ...d, exactLabel: e.target.value } : d,
                    )
                  }
                  className="h-9 text-[12px]"
                  placeholder="48 minutes"
                />
              </label>

              {episodeEditDraft.events.length ? (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Timeline events ({episodeEditDraft.events.length})
                  </p>
                  <div className="space-y-2">
                    {episodeEditDraft.events.map((ev, idx) => (
                      <div
                        key={`${ev.originalDetectedAt}-${ev.eventType}-${idx}`}
                        className="rounded-xl border border-border/70 bg-muted/20 px-2.5 py-2"
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[10px] text-muted-foreground">
                            {ev.eventType || 'event'}
                            {ev.id ? ` · ${ev.id.slice(0, 8)}…` : ''}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={
                              episodeEventDeletingIdx != null ||
                              episodeEditSaving
                            }
                            onClick={() => void deleteTimelineEventFromEdit(idx)}
                            title="Delete this timeline event completely"
                            className="h-6 shrink-0 gap-1 rounded-full px-2 text-[10px] font-semibold text-rose-700 hover:border-rose-400 hover:bg-rose-500/15 dark:text-rose-300"
                          >
                            {episodeEventDeletingIdx === idx ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Trash2 className="size-3" strokeWidth={2} />
                            )}
                            Delete event
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                          <label className="col-span-2 block space-y-0.5 sm:col-span-1">
                            <span className="text-[9px] font-medium text-muted-foreground">
                              Type
                            </span>
                            <Input
                              value={ev.eventType}
                              onChange={(e) =>
                                setEpisodeEditDraft((d) => {
                                  if (!d) return d
                                  const events = [...d.events]
                                  events[idx] = {
                                    ...events[idx],
                                    eventType: e.target.value,
                                  }
                                  return { ...d, events }
                                })
                              }
                              className="h-8 text-[11px] font-mono"
                            />
                          </label>
                          <label className="block space-y-0.5">
                            <span className="text-[9px] font-medium text-muted-foreground">
                              State
                            </span>
                            <Input
                              value={ev.state}
                              onChange={(e) =>
                                setEpisodeEditDraft((d) => {
                                  if (!d) return d
                                  const events = [...d.events]
                                  events[idx] = {
                                    ...events[idx],
                                    state: e.target.value,
                                  }
                                  return { ...d, events }
                                })
                              }
                              className="h-8 text-[11px]"
                            />
                          </label>
                          <label className="block space-y-0.5">
                            <span className="text-[9px] font-medium text-muted-foreground">
                              Time
                            </span>
                            <Input
                              type="datetime-local"
                              value={ev.detectedAt}
                              onChange={(e) =>
                                setEpisodeEditDraft((d) => {
                                  if (!d) return d
                                  const events = [...d.events]
                                  events[idx] = {
                                    ...events[idx],
                                    detectedAt: e.target.value,
                                  }
                                  return { ...d, events }
                                })
                              }
                              className="h-8 text-[11px] font-mono"
                            />
                          </label>
                          <label className="block space-y-0.5">
                            <span className="text-[9px] font-medium text-muted-foreground">
                              Move %
                            </span>
                            <Input
                              type="number"
                              step="any"
                              value={ev.movePercent}
                              onChange={(e) =>
                                setEpisodeEditDraft((d) => {
                                  if (!d) return d
                                  const events = [...d.events]
                                  events[idx] = {
                                    ...events[idx],
                                    movePercent: e.target.value,
                                  }
                                  return { ...d, events }
                                })
                              }
                              className="h-8 text-[11px] font-mono tabular-nums"
                            />
                          </label>
                          <label className="block space-y-0.5">
                            <span className="text-[9px] font-medium text-muted-foreground">
                              Price
                            </span>
                            <Input
                              type="number"
                              step="any"
                              value={ev.price}
                              onChange={(e) =>
                                setEpisodeEditDraft((d) => {
                                  if (!d) return d
                                  const events = [...d.events]
                                  events[idx] = {
                                    ...events[idx],
                                    price: e.target.value,
                                  }
                                  return { ...d, events }
                                })
                              }
                              className="h-8 text-[11px] font-mono tabular-nums"
                            />
                          </label>
                          <label className="col-span-2 block space-y-0.5 sm:col-span-1">
                            <span className="text-[9px] font-medium text-muted-foreground">
                              Reason
                            </span>
                            <Input
                              value={ev.reason}
                              onChange={(e) =>
                                setEpisodeEditDraft((d) => {
                                  if (!d) return d
                                  const events = [...d.events]
                                  events[idx] = {
                                    ...events[idx],
                                    reason: e.target.value,
                                  }
                                  return { ...d, events }
                                })
                              }
                              className="h-8 text-[11px]"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  No timeline events loaded for this episode in memory (status /
                  times above still save).
                </p>
              )}
            </div>
          ) : null}
          <DialogFooter className="shrink-0 border-t border-border px-5 py-3">
            <Button
              type="button"
              variant="outline"
              disabled={episodeEditSaving}
              onClick={() => {
                setEpisodeEditOpen(false)
                setEpisodeEditDraft(null)
                setEpisodeEditError('')
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={episodeEditSaving || !episodeEditDraft}
              onClick={() => void saveEpisodeEdit()}
            >
              {episodeEditSaving ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exact Perplexity prompt used by the selected market bulletin. */}
      <Dialog
        open={deskBulletinPromptOpen}
        onOpenChange={setDeskBulletinPromptOpen}
      >
        <DialogContent
          showCloseButton
          data-momentum-dashboard
          className="max-h-[min(90dvh,46rem)] w-[min(100vw-1.5rem,48rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        >
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Info className="size-4 text-violet-600 dark:text-violet-300" />
              Perplexity market-research prompt
            </DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">
              {(() => {
                const row = deskBulletinFocus || deskBulletins[0]
                if (!row) return 'Exact prompt used for market research'
                const market =
                  String(row.market || '').toLowerCase() === 'india'
                    ? 'India'
                    : 'US'
                return `${market} · ${String(row.slot || '').toUpperCase()} · ${row.session_date || '—'}`
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <pre className="whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/35 p-4 font-mono text-[12px] leading-relaxed text-foreground">
              {String(
                (deskBulletinFocus || deskBulletins[0])?.perplexity_meta
                  ?.prompt || 'Prompt unavailable for this bulletin.',
              )}
            </pre>
          </div>
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
                      {timelineDetail.ev.pushResult.always_notify_included
                        ? ' · always recipient included'
                        : ''}
                    </p>
                    {(() => {
                      type RecipRow = {
                        device_id?: string | null
                        expo_push_token?: string
                        expo_push_token_masked?: string
                        always_notify?: boolean
                        status?: string
                        error?: string | null
                      }
                      const recips: RecipRow[] =
                        timelineDetail.ev.pushResult.recipients?.length
                          ? (timelineDetail.ev.pushResult
                              .recipients as RecipRow[])
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
                                  {r.always_notify ? ' · always' : ''}
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
            <PerplexityDialogPanel
              ev={timelineDetail.ev}
              research={timelineDetail.research}
              at={timelineDetail.at}
            />
          ) : null}
          <DialogFooter className="shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <YahooFinanceWithMarketState marketState={tabQuote?.marketState}>
                <a
                  href={yahooFinanceQuoteUrl(displayTicker)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground underline-offset-2 hover:underline"
                  title={`Open ${displayTicker} on Yahoo Finance`}
                >
                  Yahoo Finance
                </a>
              </YahooFinanceWithMarketState>
            </div>
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

/** Episode-card metric chip (exported for reuse / keeps tsc noUnusedLocals happy). */
export function Stat({
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
