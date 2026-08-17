/**
 * Developer debug panel for multi-ticker momentum engine.
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
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
  Bitcoin,
  Bookmark,
  Check,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  DollarSign,
  ExternalLink,
  Info,
  LineChart,
  Loader2,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Terminal,
  Trash2,
  Users,
  TrendingUp,
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
  fetchYahooMostActives,
  fetchMomentumMonitoredTickers,
  fetchYahooQuote,
  fetchYahooQuotes,
  fetchYahooSavedTickers,
  resolveYahooLogoUrl,
  searchYahooSaved,
  type YahooLiveQuote,
  type YahooMostActiveItem,
} from '@/services/yahooApi'
import type { YahooSearchResult } from '@/types/yahoo'
import { resolveYahooActiveSession } from '@/lib/yahooMarketSession'

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
  exactMinutes?: number | null
  exactLabel?: string | null
  lastMaterialProgressAt?: string | null
}

/** Scheduled OPEN / MIDDAY / CLOSE market summary (not an episode). */
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
): EpisodeEventGroup[] {
  const eventGroups = groupEventsByEpisode(events)
  const byEpisodeId = new Map<string, EpisodeEventGroup>()
  for (const g of eventGroups) {
    if (g.episodeId) byEpisodeId.set(String(g.episodeId), g)
  }

  const seen = new Set<string>()
  const merged: EpisodeEventGroup[] = []

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
    if (!isEpisodeEligibleForRail(ep)) continue
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

/** Collapsible plain-English explanation + full step-by-step build under episode. */
function EpisodeExplainCollapse({
  group,
  accelPoints,
  inactivityMinutes,
}: {
  group: EpisodeEventGroup
  accelPoints?: number | null
  inactivityMinutes?: number | null
}) {
  // Always start collapsed — “How this move built · N steps · ACTIVE”
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
        {open
          ? 'Hide how this move built'
          : `How this move built · ${sections.buildSteps.length} steps${
              sections.isActive ? ' · ACTIVE' : ''
            }`}
      </button>
      {open ? (
        <div className="mt-1.5 space-y-0 overflow-hidden rounded-xl border border-border/70 bg-background/80 text-[11px] leading-snug">
          <div className="space-y-1.5 border-b border-border/60 px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                1 · How this move built (step by step)
              </p>
              {sections.isActive ? (
                <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  Active
                </span>
              ) : (
                <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Ended
                </span>
              )}
            </div>
            {sections.buildSteps.length > 0 ? (
              <ol className="mt-1 space-y-1.5">
                {sections.buildSteps.map((step, i) => (
                  <li
                    key={`${step.at}-${i}-${step.line.slice(0, 24)}`}
                    className="flex min-w-0 gap-2"
                  >
                    <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                      {i + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground/90">{step.line}</p>
                      {step.at ? (
                        <p className="text-[10px] tabular-nums text-muted-foreground">
                          {fmtEpisodeWhen(step.at, group.marketSession)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground">No timeline steps yet.</p>
            )}
            <p className="pt-1 text-muted-foreground">{sections.statusNote}</p>
          </div>

          <div className="space-y-1.5 border-b border-border/60 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              2 · Story
            </p>
            <p className="text-foreground/90">{sections.start}</p>
            {sections.during ? (
              <p className="text-foreground/85">{sections.during}</p>
            ) : null}
            <p className="text-foreground/85">{sections.end}</p>
          </div>

          <div className="space-y-1.5 border-b border-border/60 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              3 · How we measure it
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
              4 · Example with numbers
            </p>
            <p className="text-foreground/85">{sections.numbers}</p>
          </div>

          <div className="space-y-2 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              5 · What we look for next
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
    }
    accelerationPoints?: number
    inactivityMinutes?: number
    testMode?: {
      enabled?: boolean
      dummyResearch?: boolean
      summary?: string
      alwaysNotify?: {
        device_id?: string
        expo_push_token?: string
      }
    }
    dummyResearch?: boolean
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
  /** Enabled Trigger subscribers (device_monitored_tickers) */
  subscriberCount?: number | null
}

/** Seed list only for equities / crypto / indexes.
 *  Commodity + forex come from momentum_research_commodities / _forex (no hardcodes). */
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
  id: 'equity' | 'index' | 'forex' | 'crypto' | 'commodity'
  label: string
  Icon: LucideIcon
}[] = [
  { id: 'equity', label: 'Stocks', Icon: LineChart },
  { id: 'index', label: 'Indices', Icon: BarChart3 },
  { id: 'forex', label: 'Forex', Icon: DollarSign },
  { id: 'crypto', label: 'Crypto', Icon: Bitcoin },
  { id: 'commodity', label: 'Commodities', Icon: Wheat },
]

type AssetClassTabId = (typeof ASSET_CLASS_TABS)[number]['id']

type MarketListId =
  | 'watchlist'
  | 'most_actives'
  | 'trending'
  | 'gainers'
  | 'losers'
  | 'markets'

const EQUITY_LIST_TABS: { id: MarketListId; label: string; Icon: LucideIcon }[] = [
  { id: 'watchlist', label: 'Watchlist', Icon: Bookmark },
  { id: 'most_actives', label: 'Most active', Icon: Activity },
  { id: 'trending', label: 'Trending', Icon: TrendingUp },
  { id: 'gainers', label: 'Gainers', Icon: ArrowUpRight },
  { id: 'losers', label: 'Losers', Icon: ArrowDownRight },
]

const OTHER_LIST_TABS: { id: MarketListId; label: string; Icon: LucideIcon }[] = [
  { id: 'watchlist', label: 'Watchlist', Icon: Bookmark },
  { id: 'markets', label: 'Markets', Icon: Activity },
]

type MarketListHoverRow = {
  /** Distinct mark for each momentum / research / list source */
  kind: 'bookmark' | 'push' | 'momentum' | 'research' | 'events' | 'yahoo'
  label: string
  detail: string
}

/** Hover copy for column-1 market list tabs (icon-only UI). */
function marketListTabHover(tab: {
  id: MarketListId
  label: string
}): { title: string; blurb?: string; rows: MarketListHoverRow[] } {
  switch (tab.id) {
    case 'watchlist':
      return {
        title: 'Watchlist',
        blurb:
          'Tickers users consciously monitor in the Trigger app — categorized by asset class.',
        rows: [
          {
            kind: 'push',
            label: 'App subscribers (source of truth)',
            detail: 'Supabase · device_monitored_tickers · enabled subscribers',
          },
          {
            kind: 'momentum',
            label: 'Momentum engine (per ticker)',
            detail: 'Supabase · momentum_episodes + momentum_episode_events',
          },
          {
            kind: 'research',
            label: 'Research history (not the list)',
            detail:
              'Supabase · momentum_research_* — research work only, not watchlist',
          },
        ],
      }
    case 'most_actives':
      return {
        title: 'Most active',
        rows: [
          {
            kind: 'yahoo',
            label: 'Yahoo Finance',
            detail: 'Most-active list for this asset class',
          },
        ],
      }
    case 'trending':
      return {
        title: 'Trending',
        rows: [
          {
            kind: 'yahoo',
            label: 'Yahoo Finance',
            detail: 'Trending tickers for this asset class',
          },
        ],
      }
    case 'gainers':
      return {
        title: 'Gainers',
        rows: [
          {
            kind: 'yahoo',
            label: 'Yahoo Finance',
            detail: 'Day gainers for this asset class',
          },
        ],
      }
    case 'losers':
      return {
        title: 'Losers',
        rows: [
          {
            kind: 'yahoo',
            label: 'Yahoo Finance',
            detail: 'Day losers for this asset class',
          },
        ],
      }
    case 'markets':
      return {
        title: 'Markets',
        rows: [
          {
            kind: 'yahoo',
            label: 'Yahoo Finance',
            detail: 'Markets overview for this asset class',
          },
        ],
      }
    default:
      return { title: tab.label, rows: [] }
  }
}

function MarketListHoverKindIcon({
  kind,
  className,
}: {
  kind: MarketListHoverRow['kind']
  className?: string
}) {
  const cls = cn('size-3 shrink-0', className)
  switch (kind) {
    case 'bookmark':
      return <Bookmark className={cls} strokeWidth={2} />
    case 'push':
      return <BellRing className={cls} strokeWidth={2} />
    case 'momentum':
      return <Zap className={cls} strokeWidth={2} />
    case 'events':
      return <Activity className={cls} strokeWidth={2} />
    case 'research':
      return (
        <PerplexityLogo className={cn('size-3 shrink-0 dark:invert-0 invert', className)} />
      )
    case 'yahoo':
      return <LineChart className={cls} strokeWidth={2} />
    default:
      return <Info className={cls} strokeWidth={2} />
  }
}

function listTabsForClass(assetClass: AssetClassTabId) {
  return assetClass === 'equity' ? EQUITY_LIST_TABS : OTHER_LIST_TABS
}

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
  if (raw === 'index' || raw === 'indices' || raw === 'indexes') return 'index'
  if (raw === 'etf') return 'equity'
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

function perplexityFinanceQuoteUrl(symbol: string): string {
  const s = String(symbol || '').trim()
  if (!s) return 'https://www.perplexity.ai/finance'
  return `https://www.perplexity.ai/finance/${encodeURIComponent(s)}`
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
      base = d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: sameYear ? undefined : 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
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

type MarketStatusRow = {
  id: string
  label: string
  symbol: string
  uiStatus: string
  engineLabel: string
  engineGate?: string
  calendarState: string
  freshnessState: string
  currentSession?: string
  status?: string
  lastUpdateLondon?: string | null
  resumeAtLondon?: string | null
  quoteTimestampUtc?: string | null
  quoteAgeSec?: number | null
  nextExpectedOpenUtc?: string | null
  reason?: string
  child?: MarketStatusRow | null
}

/** Hover tip for Market sessions popup cells (Dialog needs z above modal). */
function MarketSessionHoverTip({
  title,
  lines,
  children,
  side = 'top',
}: {
  title: string
  lines: string[]
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  const body = lines.filter(Boolean)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="inline-block max-w-full cursor-help rounded-sm outline-none decoration-muted-foreground/50 underline-offset-2 hover:underline focus-visible:ring-1 focus-visible:ring-ring/50"
        >
          {children}
        </div>
      </TooltipTrigger>
      <CalcTooltipContent side={side} className="!z-[200]">
        <p className="text-[11px] font-semibold leading-snug text-white">
          {title}
        </p>
        {body.map((line, i) => (
          <p
            key={i}
            className="mt-1 text-[11px] leading-relaxed text-white/75"
          >
            {line}
          </p>
        ))}
      </CalcTooltipContent>
    </Tooltip>
  )
}

const MARKET_PROBE_INFO: Record<
  string,
  { title: string; lines: string[] }
> = {
  stocks: {
    title: 'US Stocks (SPY)',
    lines: [
      'Headline probe for US equities. Session policy: Yahoo 24×5 (Sun 8:00pm – Fri 8:00pm ET).',
      'Calendar hours are America/New_York. This row never starts or stops the engine.',
    ],
  },
  forex: {
    title: 'Forex (EURUSD=X)',
    lines: [
      'Headline FX spot probe. Session policy: 24×5 (Sun ~5:00pm – Fri ~5:00pm ET).',
      'Used only for the market-status summary — independent of equity engines.',
    ],
  },
  crypto: {
    title: 'Crypto (BTC-USD)',
    lines: [
      'Headline crypto probe. Session policy: 24×7 — no weekly full close.',
      'If data is delayed, Trigger pauses calculations until a fresh quote returns.',
    ],
  },
  commodities: {
    title: 'Commodities (GC=F)',
    lines: [
      'Headline gold futures probe (CME). Session policy: ~23×5 with daily maintenance 5–6pm ET.',
      'Maintenance is not a weekly full close — the episode clock pauses, the episode stays open.',
    ],
  },
  indices: {
    title: 'Indices (ES=F + cash)',
    lines: [
      'Futures probe ES=F (CME ~23×5) plus cash index ^GSPC (RTH only).',
      'Futures and cash can disagree (e.g. futures open, cash closed) — that is shown as Mixed / child status.',
    ],
  },
}

function sessionHoverInfo(
  session: string | undefined,
  row: MarketStatusRow,
): { title: string; lines: string[] } {
  const s = String(session || row.uiStatus || '').trim()
  const cal = String(row.calendarState || '').toUpperCase()
  const base = {
    Overnight: {
      title: 'Session · Overnight',
      lines: [
        'US equity overnight session (after 8:00pm ET until pre-market).',
        'Tradable on Yahoo extended hours — not a full market close.',
      ],
    },
    'Pre-market': {
      title: 'Session · Pre-market',
      lines: [
        'US equity pre-market (about 4:00am–9:30am ET).',
        'Expected open for monitoring; delayed data is still not “closed”.',
      ],
    },
    Regular: {
      title: 'Session · Regular',
      lines: [
        'US cash regular hours (9:30am–4:00pm ET).',
        'Primary cash equity session.',
      ],
    },
    'Post-market': {
      title: 'Session · Post-market',
      lines: [
        'US equity after-hours (about 4:00pm–8:00pm ET).',
        'Still tradable on Yahoo — Friday 8:00pm ET is the weekly full close.',
      ],
    },
    Open: {
      title: 'Session · Open',
      lines: [
        'Calendar expects this market to be live right now.',
        row.reason || 'Check Status for whether Yahoo data is fresh or delayed.',
      ],
    },
    '24/7': {
      title: 'Session · 24/7',
      lines: [
        'Crypto has no weekly full-close window.',
        'Monitoring continues whenever Yahoo prints are fresh.',
      ],
    },
    Maintenance: {
      title: 'Session · Maintenance',
      lines: [
        'Daily CME maintenance (typically 5:00–6:00pm ET Mon–Thu).',
        'Not FULL_CLOSED — heavy work pauses; open episodes are kept.',
      ],
    },
    Closed: {
      title: 'Session · Closed',
      lines: [
        cal === 'HOLIDAY'
          ? 'Exchange holiday — market is fully closed.'
          : cal === 'EARLY_CLOSE'
            ? 'Early-close day — session has ended for the day.'
            : 'Weekly / weekend full close for this instrument’s session policy.',
        row.resumeAtLondon
          ? `Next expected open (London): ${row.resumeAtLondon}.`
          : 'Monitoring resumes automatically at the next expected open.',
      ],
    },
    Futures: {
      title: 'Session · Futures',
      lines: [
        'Index futures are in their continuous CME session.',
        'Cash index hours are separate (see child row).',
      ],
    },
  } as Record<string, { title: string; lines: string[] }>

  if (base[s]) return base[s]
  return {
    title: `Session · ${s || 'Unknown'}`,
    lines: [
      row.reason ||
        'Expected session name from the calendar (not inferred from delayed data).',
      cal ? `Calendar state: ${cal}.` : '',
    ].filter(Boolean),
  }
}

function statusHoverInfo(row: MarketStatusRow): {
  title: string
  lines: string[]
} {
  const status = String(row.status || row.engineLabel || '').trim()
  const fresh = String(row.freshnessState || '').toUpperCase()
  const gate = String(row.engineGate || '').toUpperCase()
  const lines: string[] = []

  if (status === 'Live') {
    lines.push(
      'Calendar is open and the Yahoo quote is fresh enough to use.',
      'Engine gate would be RUN for this instrument class.',
    )
  } else if (status === 'Rate limited') {
    lines.push(
      'Yahoo returned HTTP 429 (too many requests). Trigger is backing off — not a market close.',
      'Wait ~1 minute and hit Refresh. Reduce concurrent polls if this keeps happening.',
    )
  } else if (status === 'Unavailable') {
    lines.push(
      'Yahoo probe failed (network/error). Calendar may still be open.',
      'Retry with Refresh. This is not treated as a weekly full close.',
    )
  } else if (status === 'Delayed') {
    lines.push(
      'Market is expected to be open, but the latest Yahoo print is stale or missing.',
      'This is not a market close — Trigger pauses calculations until fresh data returns.',
    )
  } else if (status === 'Closed') {
    lines.push(
      'Market is fully closed for this session policy (weekend, holiday, or early close).',
      'Heavy polling / episode eval sleeps until the next expected open.',
    )
  } else if (status === 'Maintenance') {
    lines.push(
      'CME daily maintenance window — temporary pause, not a weekly full close.',
    )
  } else {
    lines.push(
      row.reason ||
        'Combined calendar + data freshness label for this probe.',
    )
  }

  if (fresh) lines.push(`Freshness: ${fresh}.`)
  if (gate) lines.push(`Engine gate: ${gate} (${row.engineLabel || gate}).`)
  if (row.uiStatus && row.uiStatus !== status) {
    lines.push(`UI status detail: ${row.uiStatus}.`)
  }

  return { title: `Status · ${status || 'Unknown'}`, lines }
}

function latestDataHoverInfo(row: MarketStatusRow): {
  title: string
  lines: string[]
} {
  const london = row.lastUpdateLondon
  const age =
    row.quoteAgeSec != null && Number.isFinite(row.quoteAgeSec)
      ? Math.round(row.quoteAgeSec)
      : null
  const lines: string[] = []

  if (london) {
    lines.push(
      `Last Yahoo quote time shown in Europe/London: ${london}.`,
      'London is display-only — session policy always uses America/New_York.',
    )
  } else if (age != null) {
    lines.push(`Last quote age: about ${age}s (no London stamp available).`)
  } else {
    lines.push(
      'No usable quote timestamp from Yahoo for this probe right now (shown as —).',
      'Missing data is treated as delayed / unavailable, not as a market close.',
    )
  }

  if (row.quoteTimestampUtc) {
    lines.push(`UTC: ${row.quoteTimestampUtc}.`)
  }
  if (row.resumeAtLondon) {
    lines.push(`Next expected open (London): ${row.resumeAtLondon}.`)
  } else if (
    String(row.calendarState || '').toUpperCase() === 'OPEN' ||
    String(row.currentSession || '') === '24/7'
  ) {
    lines.push('No “resumes” time — calendar already expects the market open.')
  }

  return {
    title: london || age != null ? 'Latest data' : 'Latest data · unavailable',
    lines,
  }
}

/** Footer session label — device clock in America/New_York (not Yahoo). */
function MarketStatusBadge({
  nowMs,
  className,
  onClick,
}: {
  nowMs: number
  className?: string
  onClick?: () => void
}) {
  const market = usEquitySessionFromEtClock(nowMs)
  const isRegular = market.tone === 'open'
  const londonOpen = formatEtWallInTimeZone(9, 30, UK_ZONE, nowMs)
  const londonClose = formatEtWallInTimeZone(16, 0, UK_ZONE, nowMs)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap text-[11px] tabular-nums leading-none',
        onClick && 'cursor-pointer hover:opacity-80',
        className,
      )}
      title={`US equities · ${market.label} · hours are America/New_York. Regular in London today: ${londonOpen}–${londonClose} (converted, not ET+5). Click for all markets.`}
    >
      <span
        className={cn(
          'font-semibold tracking-tight',
          marketStatusToneClass(market.tone),
          isRegular && 'sndk-market-live-blink',
        )}
      >
        {market.label}
      </span>
    </button>
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

export function SndkMomentumPanel({
  appSwitcher: _appSwitcher,
  onOpenInTrigger,
  onOpenTriggerApp,
  onOpenNineAmApp,
  theme = 'light',
  onToggleTheme,
}: {
  /** @deprecated center app pills removed — use settings menu props */
  appSwitcher?: ReactNode
  /** Open this ticker inside Trigger (parent switches app tab + selects stock) */
  onOpenInTrigger?: (ticker: string, label?: string) => void
  /** Switch parent shell to Trigger app */
  onOpenTriggerApp?: () => void
  /** Switch parent shell to 9AM app */
  onOpenNineAmApp?: () => void
  theme?: string
  onToggleTheme?: () => void
} = {}) {
  void _appSwitcher
  const [watchlist, setWatchlist] = useState<WatchTab[]>(() => loadWatchlist())
  const [assetClassTab, setAssetClassTab] = useState<AssetClassTabId>(() =>
    loadAssetClassFilter(),
  )
  const [mostActivesByClass, setMostActivesByClass] = useState<
    Partial<Record<string, WatchTab[]>>
  >({})
  const [mostActivesLoading, setMostActivesLoading] = useState(false)
  const [mostActivesError, setMostActivesError] = useState<string | null>(null)
  const [marketListTab, setMarketListTab] = useState<MarketListId>('watchlist')
  const [savedTickers, setSavedTickers] = useState<WatchTab[]>([])
  /**
   * App-monitored tickers from device_monitored_tickers (enabled subscribers).
   * Categorized client-side into Stocks / Indices / Forex / Crypto / Commodities.
   */
  const [monitoredByClass, setMonitoredByClass] = useState<
    Partial<Record<AssetClassTabId, WatchTab[]>>
  >({})
  const [monitoredLoading, setMonitoredLoading] = useState(false)
  const [monitoredSourceTable, setMonitoredSourceTable] = useState<string | null>(
    null,
  )
  const [monitoredCounts, setMonitoredCounts] = useState<
    Partial<Record<string, number>>
  >({})
  const [activeTicker, setActiveTicker] = useState(() => {
    const list = loadWatchlist()
    return loadActiveTicker(list)
  })
  /** Select a watch tab and remember it (Silver / SpaceX / … survive refresh). */
  const selectTicker = useCallback((ticker: string) => {
    const t = String(ticker || '').trim().toUpperCase()
    if (!t) return
    setActiveTicker(t)
    saveActiveTicker(t)
  }, [])

  const userClassWatchlist = watchlist.filter(
    (tab) => tabAssetClass(tab) === assetClassTab,
  )

  const availableListTabs = listTabsForClass(assetClassTab)
  const activeListTab = availableListTabs.some((t) => t.id === marketListTab)
    ? marketListTab
    : 'watchlist'

  const displayedEntities = useMemo(() => {
    if (activeListTab === 'watchlist') {
      // Source of truth: device_monitored_tickers (conscious Trigger subscribers)
      const monitored = monitoredByClass[assetClassTab] || []
      if (monitored.length) return monitored
      // Fallback while loading / empty Supabase: local dashboard list only
      return userClassWatchlist
    }
    const key = `${assetClassTab}:${activeListTab}`
    return mostActivesByClass[key] || []
  }, [
    activeListTab,
    assetClassTab,
    mostActivesByClass,
    monitoredByClass,
    userClassWatchlist,
  ])

  const selectAssetClassTab = useCallback(
    (id: string) => {
      if (!ASSET_CLASS_TABS.some((t) => t.id === id)) return
      const next = id as AssetClassTabId
      setAssetClassTab(next)
      saveAssetClassFilter(next)
      setMarketListTab('watchlist')
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

  // Watchlist: load all consciously monitored tickers, split by asset class
  useEffect(() => {
    if (activeListTab !== 'watchlist') return
    let cancelled = false
    const ac = new AbortController()
    setMonitoredLoading(true)
    void fetchMomentumMonitoredTickers({
      app: 'trigger',
      signal: ac.signal,
    })
      .then((body) => {
        if (cancelled) return
        setMonitoredSourceTable(body.table || 'device_monitored_tickers')
        if (body.byClass) setMonitoredCounts(body.byClass)
        const buckets: Partial<Record<AssetClassTabId, WatchTab[]>> = {
          equity: [],
          index: [],
          forex: [],
          crypto: [],
          commodity: [],
        }
        for (const row of body.items || []) {
          const ticker = normalizeWatchTicker(row.ticker)
          if (!ticker) continue
          const cls = (row.assetClass || detectAssetClass(ticker)) as AssetClassTabId
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
      })
      .catch(() => {
        if (!cancelled) {
          /* keep previous buckets */
        }
      })
      .finally(() => {
        if (!cancelled) setMonitoredLoading(false)
      })
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [activeListTab])

  useEffect(() => {
    if (activeListTab === 'watchlist') {
      setMostActivesLoading(false)
      setMostActivesError(null)
      return
    }
    let cancelled = false
    const ac = new AbortController()
    const listKey = `${assetClassTab}:${activeListTab}`
    setMostActivesLoading(true)
    setMostActivesError(null)
    void fetchYahooMostActives(assetClassTab, {
      count: 20,
      list: activeListTab,
      signal: ac.signal,
    })
      .then((body) => {
        if (cancelled) return
        const items = (body.items || [])
          .map((row: YahooMostActiveItem) => {
            const ticker = normalizeWatchTicker(row.ticker || row.symbol)
            if (!ticker) return null
            return {
              ticker,
              label: String(row.label || ticker).trim() || ticker,
              assetClass: row.assetClass || assetClassTab,
            } as WatchTab
          })
          .filter((row): row is WatchTab => Boolean(row))
        setMostActivesByClass((prev) => ({ ...prev, [listKey]: items }))
        const quotesPatch: Record<string, YahooLiveQuote> = {}
        for (const row of body.items || []) {
          const ticker = normalizeWatchTicker(row.ticker || row.symbol)
          if (!ticker) continue
          quotesPatch[ticker] = {
            symbol: ticker,
            shortName: row.label || null,
            longName: row.longName || null,
            regularMarketPrice: row.regularMarketPrice,
            regularMarketChange: row.regularMarketChange,
            regularMarketChangePercent: row.regularMarketChangePercent,
            regularMarketPreviousClose: null,
            currency: row.currency || null,
            marketState: row.marketState || null,
            exchange: row.exchange || null,
          }
          quotesPatch[ticker.toUpperCase()] = quotesPatch[ticker]
        }
        if (Object.keys(quotesPatch).length) {
          setWatchQuotes((prev) => ({ ...prev, ...quotesPatch }))
        }
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setMostActivesError(
          err instanceof Error ? err.message : 'Failed to load Yahoo list',
        )
      })
      .finally(() => {
        if (!cancelled) setMostActivesLoading(false)
      })
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [assetClassTab, activeListTab])

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
  const [thresholdDraft, setThresholdDraft] = useState<Record<string, string>>(
    () => loadLocalThresholdDraft('equity'),
  )
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
  const [testModeEnabled, setTestModeEnabledUi] = useState(false)
  const [testModeSaving, setTestModeSaving] = useState(false)
  const [testModeSummary, setTestModeSummary] = useState('')
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
  /** Right rail content: activity log, subscribers, recent events, thresholds, or all active episodes */
  const [rightRailMode, setRightRailMode] = useState<
    'logs' | 'subscribers' | 'events' | 'settings' | 'activeEpisodes'
  >('logs')
  /** Main panel under chart: rolling-return table vs active-episode story */
  const [mainPanelTab, setMainPanelTab] = useState<'returns' | 'episode'>(
    'returns',
  )
  /** All ACTIVE episodes across tickers (settings → Active episodes rail) */
  const [activeEpisodesList, setActiveEpisodesList] = useState<
    ActiveEpisodeRow[]
  >([])
  const [activeEpisodesLoading, setActiveEpisodesLoading] = useState(false)
  const [activeEpisodesError, setActiveEpisodesError] = useState('')
  /** Expanded cards in the Active episodes rail (by episodeId or ticker) */
  const [activeEpisodeExpanded, setActiveEpisodeExpanded] = useState<
    Record<string, boolean>
  >({})
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
  const [marketStatusOpen, setMarketStatusOpen] = useState(false)
  const [marketStatusLoading, setMarketStatusLoading] = useState(false)
  const [marketStatusError, setMarketStatusError] = useState('')
  const [marketStatusRows, setMarketStatusRows] = useState<MarketStatusRow[]>(
    [],
  )
  const [marketStatusFooter, setMarketStatusFooter] = useState('')
  const [marketStatusDebug, setMarketStatusDebug] = useState<string | null>(
    null,
  )

  const loadMarketStatusPopup = useCallback(async (opts?: { open?: boolean }) => {
    setMarketStatusLoading(true)
    setMarketStatusError('')
    try {
      const res = await fetch('/api/momentum/market-status')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setMarketStatusRows(Array.isArray(body.markets) ? body.markets : [])
      setMarketStatusFooter(String(body.footer || ''))
      if (opts?.open !== false) setMarketStatusOpen(true)
    } catch (err) {
      setMarketStatusError(
        err instanceof Error ? err.message : 'Market status failed',
      )
      if (opts?.open !== false) setMarketStatusOpen(true)
    } finally {
      setMarketStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMarketStatusPopup({ open: true })
  }, [loadMarketStatusPopup])
  /** Manual end / exit of the live episode from Recent Events */
  const [endingEpisode, setEndingEpisode] = useState(false)
  const [deletingEpisodeId, setDeletingEpisodeId] = useState<string | null>(
    null,
  )
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
    displayedEntities.find((t) => t.ticker === activeTicker) ||
    watchlist.find((t) => t.ticker === activeTicker) ||
    displayedEntities[0] ||
    watchlist[0] ||
    DEFAULT_WATCHLIST[0]
  const displayTicker = activeTab?.ticker || 'SNDK'

  // Collapse expanded chart when switching entities
  useEffect(() => {
    setChartExpanded(false)
  }, [displayTicker])

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
      const res = await fetch(
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

  /** Rolling-return thresholds open in the right (3rd) column — not a floating popover. */
  const openThresholdSettings = useCallback(() => {
    // Load draft for the currently selected asset class
    const cls = thresholdClassKey(assetClassTab)
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
    // Episode rules draft — same asset class as the threshold tab
    const epSnap = status?.config?.episodePolicy as
      | {
          byClass?: Record<string, Record<string, number | boolean | null | undefined>>
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
    // Sync test-mode toggle from live config / API
    const tm = status?.config?.testMode
    if (tm && typeof tm.enabled === 'boolean') {
      setTestModeEnabledUi(tm.enabled)
      setTestModeSummary(String(tm.summary || ''))
    } else {
      void fetch(`/api/momentum/test-mode?_=${Date.now()}`)
        .then((r) => r.json().catch(() => ({})))
        .then((body) => {
          if (body?.ok) {
            setTestModeEnabledUi(Boolean(body.enabled))
            setTestModeSummary(String(body.summary || ''))
          }
        })
        .catch(() => {})
    }
    setThresholdSaveState('idle')
    setRightRailMode('settings')
    setLogCollapsedPersist(false)
  }, [setLogCollapsedPersist, assetClassTab, status?.config?.thresholdSnapshot, status?.config?.testMode, status?.config?.episodePolicy, status?.config?.accelerationPoints, status?.config?.inactivityMinutes])

  const toggleTestMode = useCallback(async (next: boolean) => {
    setTestModeSaving(true)
    setTestModeEnabledUi(next) // optimistic
    try {
      const res = await fetch('/api/momentum/test-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      setTestModeEnabledUi(Boolean(body.enabled))
      setTestModeSummary(String(body.summary || ''))
    } catch (err) {
      setTestModeEnabledUi(!next) // revert
      console.warn(
        '[testMode] toggle failed',
        err instanceof Error ? err.message : err,
      )
    } finally {
      setTestModeSaving(false)
    }
  }, [])

  // Keep bottom Settings menu in sync with server test-mode (even before opening thresholds rail)
  useEffect(() => {
    let cancelled = false
    void fetch(`/api/momentum/test-mode?_=${Date.now()}`)
      .then((r) => r.json().catch(() => ({})))
      .then((body) => {
        if (cancelled || !body?.ok) return
        setTestModeEnabledUi(Boolean(body.enabled))
        setTestModeSummary(String(body.summary || ''))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Also mirror from live momentum status config when it arrives
  useEffect(() => {
    const tm = status?.config?.testMode
    if (tm && typeof tm.enabled === 'boolean') {
      setTestModeEnabledUi(tm.enabled)
      if (tm.summary) setTestModeSummary(String(tm.summary))
    }
  }, [status?.config?.testMode])

  const closeThresholdSettings = useCallback(() => {
    setRightRailMode('events')
  }, [])

  const loadActiveEpisodesList = useCallback(async (opts?: { refresh?: boolean }) => {
    setActiveEpisodesLoading(true)
    setActiveEpisodesError('')
    try {
      const q = opts?.refresh ? '?refresh=1' : ''
      const res = await fetch(`/api/momentum/active-episodes${q}`)
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
    }
  }, [])

  /** Settings → Active episodes: all live episodes in the right column. */
  const openActiveEpisodesRail = useCallback(() => {
    setRightRailMode('activeEpisodes')
    setLogCollapsedPersist(false)
    void loadActiveEpisodesList({ refresh: true })
  }, [setLogCollapsedPersist, loadActiveEpisodesList])

  // When asset class changes while settings are open, swap threshold + episode-rule drafts
  useEffect(() => {
    if (rightRailMode !== 'settings') return
    const cls = thresholdClassKey(assetClassTab)
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
    setThresholdSaveState('idle')

    const epSnap = status?.config?.episodePolicy as
      | {
          byClass?: Record<string, Record<string, number | boolean | null | undefined>>
        }
      | undefined
    const polForClass =
      (epSnap?.byClass?.[cls] as Parameters<typeof policyDraftFromSnapshot>[0]) ||
      (status?.config?.episodePolicy as Parameters<
        typeof policyDraftFromSnapshot
      >[0])
    const polDraft = policyDraftFromSnapshot(polForClass)
    setPolicyDraft(polDraft)
    policyDraftRef.current = polDraft
    setPolicySaveState('idle')
  }, [assetClassTab, rightRailMode, status?.config?.thresholdSnapshot, status?.config?.episodePolicy])

  // Active episode on this ticker → jump straight to Recent Events (keep saved width)
  useEffect(() => {
    const ep = status?.episode
    if (!ep) return
    const st = String(ep.status || 'ACTIVE').toUpperCase()
    if (st === 'ENDED' || st === 'EXPIRED' || st === 'REVERSED') return
    if (!isIntradayOr24hEventWindow(ep.detectedWindow)) return
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
    }
  }, [displayTicker, rightRailMode])

  // Re-apply last saved thresholds after reload so the engine matches the UI.
  useEffect(() => {
    const local = loadLocalThresholdDraft()
    if (!Object.keys(local).length) return
    const thresholds = thresholdsFromDraft(local)
    if (!Object.keys(thresholds).length) return
    void fetch('/api/momentum/thresholds', {
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

  // Register full monitor list + focus (server polls entire watchlist 24×7)
  useEffect(() => {
    const fromLocal = watchlist.map((t) => t.ticker).filter(Boolean)
    const fromMonitored = Object.values(monitoredByClass)
      .flat()
      .map((t) => t?.ticker)
      .filter(Boolean) as string[]
    const tickers = [...new Set([...fromLocal, ...fromMonitored, displayTicker].filter(Boolean))]
    if (!tickers.length) return
    void fetch('/api/momentum/watch', {
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
    const tickers = [
      ...new Set([
        ...watchlist.map((t) => t.ticker),
        ...displayedEntities.map((t) => t.ticker),
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
  }, [watchlist, displayedEntities])

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

  /**
   * Persist thresholds to server (disk + Supabase). Used by auto-save on each
   * settings keystroke (debounced) and the optional Save button.
   */
  async function persistThresholdsNow(
    draft: Record<string, string>,
    opts?: { closeAfter?: boolean },
  ) {
    const path = '/api/momentum/thresholds'
    const assetClass = thresholdClassKey(assetClassTab || activeAssetClass)
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
      const res = await fetch(path, {
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

  function scheduleThresholdAutosave(nextDraft: Record<string, string>) {
    saveLocalThresholdDraft(nextDraft, assetClassTab || activeAssetClass)
    setThresholdSaveState('saving')
    if (thresholdAutosaveTimer.current) {
      clearTimeout(thresholdAutosaveTimer.current)
    }
    thresholdAutosaveTimer.current = setTimeout(() => {
      void persistThresholdsNow(thresholdDraftRef.current)
    }, 450)
  }

  function onThresholdDraftChange(key: string, value: string) {
    setThresholdDraft((d) => {
      const next = { ...d, [key]: value }
      thresholdDraftRef.current = next
      scheduleThresholdAutosave(next)
      return next
    })
  }

  async function saveThresholds() {
    if (thresholdAutosaveTimer.current) {
      clearTimeout(thresholdAutosaveTimer.current)
      thresholdAutosaveTimer.current = null
    }
    await persistThresholdsNow(thresholdDraftRef.current, { closeAfter: true })
  }

  async function persistPolicyNow(draft: Record<string, string>) {
    const path = '/api/momentum/episode-policy'
    const assetClass = thresholdClassKey(assetClassTab || activeAssetClass)
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
      const res = await fetch(path, {
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

  function schedulePolicyAutosave(nextDraft: Record<string, string>) {
    setPolicySaveState('saving')
    if (policyAutosaveTimer.current) clearTimeout(policyAutosaveTimer.current)
    policyAutosaveTimer.current = setTimeout(() => {
      void persistPolicyNow(policyDraftRef.current)
    }, 450)
  }

  function onPolicyDraftChange(key: string, value: string) {
    setPolicyDraft((d) => {
      const next = { ...d, [key]: value }
      policyDraftRef.current = next
      schedulePolicyAutosave(next)
      return next
    })
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
  /** Session card (PRE / Regular / Overnight / AH) always first, then 1m…1y. */
  const visibleReturnKeys: string[] = [...RETURN_KEYS_ALL]
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
      const res = await fetch(path, {
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
      const res = await fetch(
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
      const res = await fetch(
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
        `• momentum_episodes\n` +
        `• momentum_episode_events\n\n` +
        `episode_id: ${episodeId}\n\n` +
        `This cannot be undone.`,
    )
    if (!ok) return

    setDeletingEpisodeId(episodeId)
    try {
      const res = await fetch(
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
            {/* Class label + list tabs + entities (asset switcher is bottom-center) */}
            <div className="flex items-start justify-between gap-2 px-1 pb-1">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">
                  {ASSET_CLASS_TABS.find((t) => t.id === assetClassTab)?.label ||
                    'Stocks'}
                </p>
                <p
                  className="truncate text-[11px] tabular-nums text-muted-foreground"
                  title={
                    activeListTab === 'watchlist' && monitoredSourceTable
                      ? `Source · ${monitoredSourceTable} (enabled subscribers)`
                      : undefined
                  }
                >
                  {activeListTab === 'watchlist' &&
                  monitoredLoading &&
                  !displayedEntities.length
                    ? 'Loading subscribers…'
                    : mostActivesLoading && !displayedEntities.length
                      ? 'Loading Yahoo…'
                      : `${displayedEntities.length} ${
                          availableListTabs.find((t) => t.id === activeListTab)
                            ?.label
                            .toLowerCase() || 'entities'
                        }${
                          activeListTab === 'watchlist' && monitoredSourceTable
                            ? ` · monitored`
                            : ''
                        }`}
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
            <TooltipProvider delayDuration={200}>
              <div
                className="mb-1 flex w-full items-center justify-between gap-0.5 rounded-full border border-border bg-muted p-0.5"
                role="tablist"
                aria-label="Market list"
              >
                {availableListTabs.map((tab) => {
                  const active = activeListTab === tab.id
                  const Icon = tab.Icon
                  const hover = marketListTabHover(tab)
                  return (
                    <Tooltip key={tab.id}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={active}
                          aria-label={tab.label}
                          onClick={() => setMarketListTab(tab.id)}
                          className={cn(
                            'inline-flex size-7 flex-1 items-center justify-center rounded-full transition-colors',
                            active
                              ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <Icon className="size-3.5" strokeWidth={1.75} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        align="center"
                        className="flex max-w-[18rem] flex-col items-stretch gap-1.5 px-2.5 py-2"
                      >
                        <p className="text-[12px] font-semibold leading-tight text-background">
                          {hover.title}
                        </p>
                        {hover.blurb ? (
                          <p className="text-[10px] leading-snug text-background/75">
                            {hover.blurb}
                          </p>
                        ) : null}
                        {hover.rows.length ? (
                          <ul className="flex flex-col gap-1.5 border-t border-background/15 pt-1.5">
                            {hover.rows.map((row) => (
                              <li
                                key={`${row.kind}-${row.label}`}
                                className="flex min-w-0 items-start gap-1.5"
                              >
                                <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-background">
                                  <MarketListHoverKindIcon kind={row.kind} />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[11px] font-semibold leading-tight text-background">
                                    {row.label}
                                  </span>
                                  <span className="mt-0.5 block font-mono text-[9px] leading-snug text-background/65">
                                    {row.detail}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </TooltipProvider>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-0.5 px-2 pb-2 pt-1">
              {mostActivesError && !displayedEntities.length ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {mostActivesError}
                </p>
              ) : displayedEntities.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {mostActivesLoading
                    ? 'Loading Yahoo most active…'
                    : `No ${(
                        ASSET_CLASS_TABS.find((t) => t.id === assetClassTab)
                          ?.label || 'items'
                      ).toLowerCase()} yet. Tap + to add.`}
                </p>
              ) : (
                displayedEntities.map((tab) => {
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
                              : '',
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
                            <span className="flex min-w-0 items-center gap-1">
                              <span className="truncate font-mono text-[13px] font-semibold tracking-tight">
                                {tab.ticker}
                              </span>
                              {subCount != null ? (
                                <>
                                  <span
                                    className="shrink-0 text-[11px] text-muted-foreground/70"
                                    aria-hidden
                                  >
                                    ·
                                  </span>
                                  <span
                                    className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground"
                                    title={`${subCount} subscriber${subCount === 1 ? '' : 's'}`}
                                    aria-label={`${subCount} subscriber${subCount === 1 ? '' : 's'}`}
                                  >
                                    <Users
                                      className="size-3 shrink-0"
                                      strokeWidth={1.75}
                                    />
                                    <span className="font-mono text-[11px] font-semibold tabular-nums">
                                      {subCount}
                                    </span>
                                  </span>
                                </>
                              ) : null}
                              {hasActiveEp ? (
                                <span
                                  className={cn(
                                    'relative ml-0.5 inline-flex size-2 shrink-0',
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
                    <a
                      href={yahooFinanceQuoteUrl(displayTicker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      title={`Open ${displayTicker} on Yahoo Finance`}
                    >
                      Yahoo Finance
                    </a>
                    <a
                      href={perplexityFinanceQuoteUrl(displayTicker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      title={`Open ${displayTicker} on Perplexity Finance`}
                    >
                      Perplexity Finance
                    </a>
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

          {/* Row 2: Rolling returns | Active episode — shared Tabs (cn) */}
          <div className="mb-4 mt-2 w-full space-y-2.5 rounded-2xl border border-border bg-muted/20 p-3 sm:p-4">
            <Tabs
              value={mainPanelTab}
              onValueChange={(v) =>
                setMainPanelTab(v === 'episode' ? 'episode' : 'returns')
              }
              className="w-full gap-2.5"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <TabsList className="h-8">
                  <TabsTrigger value="returns" className="px-2.5 text-[13px]">
                    Rolling returns
                  </TabsTrigger>
                  <TabsTrigger
                    value="episode"
                    className="gap-1.5 px-2.5 text-[13px]"
                  >
                    Active episode
                    {episode ? (
                      <Badge
                        variant="secondary"
                        className="h-5 rounded-full px-1.5 text-[10px] font-semibold"
                      >
                        {formatEpisodeState(episode.state) || 'Active'}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="h-5 rounded-full px-1.5 text-[10px] font-medium text-muted-foreground"
                      >
                        —
                      </Badge>
                    )}
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
                  {mainPanelTab === 'returns' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        if (!logCollapsed && rightRailMode === 'settings') {
                          closeThresholdSettings()
                          return
                        }
                        openThresholdSettings()
                      }}
                      title="Rolling-return threshold settings"
                      aria-label="Rolling-return threshold settings"
                      aria-expanded={
                        !logCollapsed && rightRailMode === 'settings'
                      }
                      aria-pressed={
                        !logCollapsed && rightRailMode === 'settings'
                      }
                    >
                      <Settings
                        className={cn(
                          'size-3.5',
                          !logCollapsed &&
                            rightRailMode === 'settings' &&
                            'text-foreground',
                        )}
                        strokeWidth={2}
                      />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEventsInLogColumn()}
                      title="Open full episode rail"
                      aria-label="Open full episode rail"
                    >
                      <Zap className="size-3.5" strokeWidth={2} />
                    </Button>
                  )}
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
            {!episode ? (
              <p className="rounded-xl border border-dashed border-border bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
                No active momentum episode for {displayTicker}
              </p>
            ) : (
              <TooltipProvider delayDuration={200}>
                <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      episode.direction === 'UP'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
                    )}
                  >
                    {episode.direction}
                  </span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    Active · {formatEpisodeState(episode.state) || 'Live'}
                  </span>
                  {episode.episodeNo != null ? (
                    <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {formatEpisodeNo(episode.episodeNo)}
                    </span>
                  ) : null}
                  <span className="text-[11px] text-muted-foreground">
                    {episode.detectedWindow || '—'}
                    {' · '}
                    {fmtPct(episode.currentMovePercent)} now · peak{' '}
                    {fmtPct(episode.peakMovePercent)}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                    value={
                      formatEpisodeState(episode.state) || episode.status || '—'
                    }
                    sub={
                      (() => {
                        const gb = fmtGivebackPct(
                          computeEpisodeGivebackPercent(episode),
                        )
                        return gb ? `Giveback ${gb}` : null
                      })()
                    }
                    detail={
                      <div className="space-y-2 text-left">
                        <div className="space-y-1">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
                            Status
                          </p>
                          <p className="text-[14px] font-semibold">
                            {formatEpisodeState(episode.state) || episode.status}
                            {episode.status === 'ACTIVE' ? ' · ACTIVE' : ''}
                          </p>
                        </div>
                        <GivebackCalcBody
                          direction={episode.direction}
                          givebackPercent={computeEpisodeGivebackPercent(
                            episode,
                          )}
                          peakPrice={episode.peakPrice}
                          troughPrice={episode.troughPrice}
                          referencePrice={episode.referencePrice}
                          currentPrice={episode.currentPrice}
                          peakMovePercent={episode.peakMovePercent}
                          currentMovePercent={episode.currentMovePercent}
                          weakThreshold={
                            status?.config?.episodePolicy
                              ?.holdingToWeakeningGiveback ?? 0.25
                          }
                          holdThreshold={
                            status?.config?.episodePolicy
                              ?.weakeningToHoldingGiveback ?? 0.2
                          }
                          strongThreshold={
                            status?.config?.episodePolicy
                              ?.strongWeakeningGiveback ?? 0.6
                          }
                          assetClass={activeAssetClass}
                          currency={quoteCurrency}
                        />
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
                    value={fmtEpisodeWhen(
                      episode.episodeStartedAt,
                      episode.marketSession,
                    )}
                    detail={
                      <div className="space-y-1.5 text-left">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-background/60">
                          Episode started
                        </p>
                        <p className="text-[14px] font-semibold tabular-nums">
                          {fmtDateTime(episode.episodeStartedAt) ||
                            episode.episodeStartedAt}
                          {sessionDateLabel(episode.marketSession) &&
                          sessionDateLabel(episode.marketSession) !== 'regular'
                            ? ` · ${sessionDateLabel(episode.marketSession)}`
                            : ''}
                        </p>
                        <p className="text-[12px] leading-snug text-background/75">
                          Wall-clock time when{' '}
                          <span className="font-semibold">MOMENTUM_STARTED</span>{' '}
                          fired for this ticker after a threshold cross.
                        </p>
                        <p className="text-[12px] text-background/70">
                          Direction {episode.direction} · window{' '}
                          {episode.exactLabel || episode.detectedWindow}
                        </p>
                      </div>
                    }
                  />
                  <Stat
                    label="Peak move"
                    value={fmtPct(episode.peakMovePercent)}
                    valueClass={pctColor(episode.peakMovePercent)}
                    detail={
                      <div className="space-y-2 text-left">
                        <PeakMoveCalcBody
                          direction={episode.direction}
                          peakMovePercent={episode.peakMovePercent}
                          peakPrice={episode.peakPrice}
                          troughPrice={episode.troughPrice}
                          referencePrice={episode.referencePrice}
                          assetClass={activeAssetClass}
                          currency={quoteCurrency}
                        />
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

                {/* How this move built — live episode story (same chain as right rail) */}
                {(() => {
                  const groups = buildEpisodeGroups(
                    status?.episodes,
                    status?.events,
                    episode,
                  ).map((g) => {
                    const next = ensureGroupHasStartedEvent(g)
                    if (
                      next.status === 'ACTIVE' &&
                      episode?.state &&
                      (!next.episodeId ||
                        next.episodeId === episode.episodeId)
                    ) {
                      return {
                        ...next,
                        liveState: episode.state,
                        marketSession:
                          next.marketSession ||
                          status?.snapshot?.marketSession ||
                          null,
                        episodeNo:
                          next.episodeNo ?? episode.episodeNo ?? null,
                      }
                    }
                    return next
                  })
                  const activeGroup =
                    groups.find(
                      (g) =>
                        g.status === 'ACTIVE' &&
                        (!episode.episodeId ||
                          g.episodeId === episode.episodeId),
                    ) ||
                    groups.find((g) => g.status === 'ACTIVE') ||
                    null
                  if (!activeGroup) {
                    return (
                      <p className="mt-2 text-[12px] text-muted-foreground">
                        Episode is live — open the full rail for past history.
                      </p>
                    )
                  }
                  return (
                    <div className="mt-3 rounded-xl border border-border bg-background px-3 py-2">
                      <EpisodeExplainCollapse
                        group={activeGroup}
                        accelPoints={status?.config?.accelerationPoints}
                        inactivityMinutes={
                          status?.config?.inactivityMinutes
                        }
                      />
                    </div>
                  )
                })()}
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
                ) : (
                  <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-0.5">
                    <p className="truncate text-[13px] font-medium">
                      {rightRailMode === 'subscribers'
                        ? `Subscribers · ${displayTicker}`
                        : rightRailMode === 'events'
                          ? `Recent events · ${displayTicker}`
                          : rightRailMode === 'settings'
                            ? 'Rolling-return thresholds'
                            : rightRailMode === 'activeEpisodes'
                              ? `Active episodes · ${activeEpisodesList.length}`
                              : `Activity log · ${displayTicker}`}
                    </p>
                    {rightRailMode === 'events' ? (
                      <EpisodeStatusGuideButton
                        policy={status?.config?.episodePolicy}
                      />
                    ) : null}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {rightRailMode === 'subscribers'
                      ? `${tickerSubscribers.length} device${tickerSubscribers.length === 1 ? '' : 's'} · Trigger (push-ready)`
                      : rightRailMode === 'events'
                        ? '≤24h windows only'
                        : rightRailMode === 'settings'
                          ? `${ASSET_CLASS_TABS.find((t) => t.id === assetClassTab)?.label || 'Stocks'} · blank/0 = off`
                          : rightRailMode === 'activeEpisodes'
                            ? 'All live episodes · click to expand'
                            : 'API · Yahoo · momentum'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {rightRailMode === 'activeEpisodes' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void loadActiveEpisodesList({ refresh: true })}
                    title="Refresh active episodes"
                    aria-label="Refresh active episodes"
                    disabled={activeEpisodesLoading}
                  >
                    <RefreshCw
                      className={cn(
                        'size-3.5',
                        activeEpisodesLoading && 'animate-spin',
                      )}
                    />
                  </Button>
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
            {rightRailMode === 'activeEpisodes' ? (
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
                          <button
                            type="button"
                            onClick={() =>
                              setActiveEpisodeExpanded((prev) => ({
                                ...prev,
                                [key]: !prev[key],
                              }))
                            }
                            className="flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
                            aria-expanded={expanded}
                          >
                            <span className="mt-0.5 shrink-0 text-muted-foreground">
                              {expanded ? (
                                <ChevronUp className="size-3.5" strokeWidth={2} />
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
                                dirUp
                                  ? 'bg-emerald-500'
                                  : 'bg-rose-500',
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
                    {/* Test mode — push + Perplexity gate */}
                    <div
                      className={cn(
                        'rounded-xl border px-3 py-2.5',
                        testModeEnabled
                          ? 'border-amber-500/40 bg-amber-500/10'
                          : 'border-border bg-muted/30',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Test mode
                          </p>
                          <p className="mt-1 text-[11px] leading-snug text-foreground/90">
                            {testModeEnabled
                              ? 'ON — only the tester device gets notifications. Perplexity is dummy (no API).'
                              : 'OFF — all ticker subscribers + always-notify tester. Real Perplexity API.'}
                          </p>
                          <p className="mt-1.5 text-[10px] font-medium text-muted-foreground">
                            {testModeEnabled
                              ? 'Pushes only to:'
                              : 'Always included (plus subscribers):'}
                          </p>
                          <p className="mt-0.5 break-all font-mono text-[9px] leading-snug text-muted-foreground">
                            {status?.config?.testMode?.alwaysNotify?.device_id ||
                              'ios-d003c3d5-2c11-4766-866e-8bf8e511929c'}
                          </p>
                          <p className="break-all font-mono text-[9px] leading-snug text-muted-foreground">
                            {status?.config?.testMode?.alwaysNotify
                              ?.expo_push_token ||
                              'ExponentPushToken[FmqQg-OgjuWt8hLmcQDJCF]'}
                          </p>
                          {testModeSummary ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {testModeSummary}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={testModeEnabled}
                          disabled={testModeSaving}
                          onClick={() => void toggleTestMode(!testModeEnabled)}
                          className={cn(
                            'relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors',
                            testModeEnabled
                              ? 'bg-amber-500'
                              : 'bg-muted-foreground/30',
                            testModeSaving && 'opacity-60',
                          )}
                          title={
                            testModeEnabled
                              ? 'Turn test mode off'
                              : 'Turn test mode on'
                          }
                        >
                          <span
                            className={cn(
                              'absolute top-0.5 size-6 rounded-full bg-background shadow transition-transform',
                              testModeEnabled ? 'left-5' : 'left-0.5',
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    <Separator />

                    {/* Section 1 — window thresholds */}
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        1 · Rolling-return thresholds ·{' '}
                        {ASSET_CLASS_TABS.find((t) => t.id === assetClassTab)
                          ?.label || 'Stocks'}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        |move %| needed to start / keep an episode on each
                        window. Auto-saves per asset class. Blank / 0 = off.
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
                        {ASSET_CLASS_TABS.find((t) => t.id === assetClassTab)
                          ?.label || 'Stocks'}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        Acceleration, giveback (weakening), inactivity, re-arm.
                        Auto-saves per asset class (stocks ≠ commodities ≠ crypto).
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
                    {thresholdSaving || thresholdSaveState === 'saving' ? (
                      <>
                        <Loader2 className="size-3 animate-spin" />
                        Saving…
                      </>
                    ) : thresholdSaveState === 'saved' ? (
                      <>
                        <Check className="size-3" strokeWidth={2.5} />
                        Saved to Supabase
                      </>
                    ) : thresholdSaveState === 'error' ? (
                      'Save failed — try again'
                    ) : (
                      'Changes save automatically'
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
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
                          const canEndEpisode = Boolean(isLiveFocus)
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
                          return (
                            <div key={group.id} className="min-w-0">
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
                                  'flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors',
                                  isActive
                                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                                    : 'text-foreground/90 hover:bg-muted/40',
                                  !isExpanded && !isActive && 'opacity-90',
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
                                      {canEndEpisode ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          disabled={endingEpisode || !!deletingEpisodeId}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            e.preventDefault()
                                            void endActiveEpisode()
                                          }}
                                          onPointerDown={(e) =>
                                            e.stopPropagation()
                                          }
                                          title="Manually end this episode (no push)"
                                          className="h-6 shrink-0 gap-1 rounded-full px-2 text-[10px] font-semibold text-muted-foreground hover:border-rose-300 hover:bg-rose-500/10 hover:text-rose-800"
                                        >
                                          {endingEpisode ? (
                                            <Loader2 className="size-3 animate-spin" />
                                          ) : (
                                            <X
                                              className="size-3"
                                              strokeWidth={2}
                                            />
                                          )}
                                          End
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
                                    {episodeLabel ? `${episodeLabel} · ` : ''}
                                    <span
                                      className={cn(
                                        'font-semibold',
                                        isActive
                                          ? 'text-emerald-700 dark:text-emerald-400'
                                          : 'text-muted-foreground',
                                      )}
                                    >
                                      {isActive ? 'Active' : 'Ended'}
                                    </span>
                                    {isActive && liveStateLabel
                                      ? ` · ${liveStateLabel}`
                                      : !isActive &&
                                          liveStateLabel &&
                                          liveStateLabel !== 'Ended'
                                        ? ` · ${liveStateLabel}`
                                        : ''}
                                    {' · '}
                                    {group.window}
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
                                    {' · peak '}
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
                                  {isExpanded ? (
                                    <EpisodeExplainCollapse
                                      group={group}
                                      accelPoints={
                                        status?.config?.accelerationPoints
                                      }
                                      inactivityMinutes={
                                        status?.config?.inactivityMinutes
                                      }
                                    />
                                  ) : null}
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

                              {/* Story timeline oldest→newest — full step-by-step when expanded */}
                              {isExpanded && group.events.length > 0 ? (
                                <ul className="relative ml-5 mt-0.5 border-l border-border/80">
                                  {(() => {
                                    const storySteps = buildTimelineSteps(
                                      group.events,
                                    )
                                    return (
                                      <>
                                  <li className="relative py-0.5">
                                    <span
                                      className={cn(
                                        'absolute -left-px top-[0.85rem] h-px w-3',
                                        isActive
                                          ? 'bg-emerald-500/50'
                                          : 'bg-border/80',
                                      )}
                                      aria-hidden
                                    />
                                    <p
                                      className={cn(
                                        'ml-3 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
                                        isActive
                                          ? 'text-emerald-700 dark:text-emerald-400'
                                          : 'text-muted-foreground',
                                      )}
                                    >
                                      How this move built ·{' '}
                                      {isActive ? 'Active' : 'Ended'} ·{' '}
                                      {storySteps.length} steps
                                    </p>
                                  </li>
                                  {storySteps.map((step) => {
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
                                              title="Event detail"
                                            >
                                              <div className="flex min-w-0 items-baseline gap-x-1.5 gap-y-0.5">
                                                <span
                                                  className={cn(
                                                    'min-w-0 text-[12px] font-medium leading-snug',
                                                    isStateOnly
                                                      ? 'text-muted-foreground'
                                                      : 'text-foreground/90',
                                                  )}
                                                >
                                                  {label}
                                                </span>
                                                <SupabasePersistBadge
                                                  persist={eventPersistStamp(ev)}
                                                />
                                                {!isStateOnly ||
                                                Number.isFinite(
                                                  ev.movePercent,
                                                ) ? (
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <span
                                                        className={cn(
                                                          'ml-auto shrink-0 cursor-help text-[12px] font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/40 underline-offset-2',
                                                          ev.direction === 'UP'
                                                            ? 'text-emerald-600'
                                                            : 'text-rose-600',
                                                        )}
                                                        onClick={(e) =>
                                                          e.stopPropagation()
                                                        }
                                                      >
                                                        {ev.direction}{' '}
                                                        {fmtPct(ev.movePercent)}
                                                      </span>
                                                    </TooltipTrigger>
                                                    <CalcTooltipContent side="left">
                                                      <EventMoveCalcBody
                                                        ev={ev}
                                                        liveEpisode={
                                                          matchesLive
                                                            ? episode
                                                            : null
                                                        }
                                                        assetClass={
                                                          activeAssetClass
                                                        }
                                                        currency={quoteCurrency}
                                                      />
                                                    </CalcTooltipContent>
                                                  </Tooltip>
                                                ) : null}
                                              </div>
                                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                                {fmtEpisodeWhen(
                                                  ev.detectedAt,
                                                  ev.marketSession ||
                                                    group.marketSession,
                                                )}
                                                {ev.price != null
                                                  ? ` · ${fmtPrice(ev.price, activeAssetClass, quoteCurrency)}`
                                                  : ''}
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
                                                <SupabasePersistBadge
                                                  persist={eventPersistStamp(step.ev)}
                                                />
                                              </div>
                                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                                <span className="tabular-nums">
                                                  {fmtEpisodeWhen(
                                                    step.at,
                                                    step.ev?.marketSession ||
                                                      group.marketSession,
                                                  )}
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
                                              <SupabasePersistBadge
                                                persist={eventPersistStamp(step.ev)}
                                              />
                                            </div>
                                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                                              <span className="tabular-nums">
                                                {fmtEpisodeWhen(
                                                  step.at,
                                                  step.ev?.marketSession ||
                                                    group.marketSession,
                                                )}
                                              </span>
                                              {titlePreview
                                                ? ` · ${titlePreview}`
                                                : ' · click for copy'}
                                            </p>
                                          </button>
                                        </li>
                                      )
                                    })}
                                      </>
                                    )
                                  })()}
                                </ul>
                              ) : isActive ? (
                                <ul className="relative ml-5 mt-0.5 border-l border-emerald-500/30">
                                  <li className="relative py-0.5">
                                    <span
                                      className="absolute -left-px top-[1.05rem] h-px w-3 bg-emerald-500/50"
                                      aria-hidden
                                    />
                                    <div className="ml-3 min-w-0 px-2 py-1.5">
                                      <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                                        Active
                                        {liveStateLabel
                                          ? ` · ${liveStateLabel}`
                                          : ''}
                                        {group.events.length
                                          ? ` · ${buildTimelineSteps(group.events).length} steps`
                                          : ''}
                                      </p>
                                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                                        Expand for full “how this move built”
                                        step-by-step
                                        {group.startedAt
                                          ? ` · started ${fmtEpisodeWhen(group.startedAt, group.marketSession)}`
                                          : ''}
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
        )}
          </div>
          {/* end detail + log row */}
        </div>
        {/* end right stack */}
      </div>
      {/* end full-height left | right split */}

      {/* ── Bottom bar: Perplexity | asset tabs + settings | market + clocks ── */}
      <div className="grid h-10 shrink-0 grid-cols-3 items-center gap-1.5 border-t border-border bg-background px-2.5 py-1 sm:px-3">
        <div className="inline-flex min-w-0 items-center justify-start gap-2">
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
        </div>

        <div className="flex items-center justify-center">
          <TooltipProvider delayDuration={200}>
          <div
            className="inline-flex items-center gap-px rounded-full border border-border bg-muted p-px"
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
                        'inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors',
                        active
                          ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon className="size-2.5" strokeWidth={1.75} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="px-2 py-1">
                    <p className="text-[11px] font-semibold">{tab.label}</p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Settings"
                  aria-label="Settings"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground hover:shadow-sm"
                >
                  <Settings className="size-2.5" strokeWidth={1.75} />
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
                <DropdownMenuCheckboxItem
                  className="items-start gap-2 py-2"
                  checked={testModeEnabled}
                  disabled={testModeSaving}
                  onCheckedChange={(checked) => {
                    void toggleTestMode(Boolean(checked))
                  }}
                  onSelect={(e) => {
                    // Keep menu open so user can see the toggle flip
                    e.preventDefault()
                  }}
                  title={
                    testModeEnabled
                      ? `TEST ON\nPushes only to:\n${status?.config?.testMode?.alwaysNotify?.device_id || 'ios-d003c3d5-2c11-4766-866e-8bf8e511929c'}\n${status?.config?.testMode?.alwaysNotify?.expo_push_token || 'ExponentPushToken[FmqQg-OgjuWt8hLmcQDJCF]'}\nPerplexity: dummy`
                      : `TEST OFF\nPushes to: all ticker subscribers\n+ always:\n${status?.config?.testMode?.alwaysNotify?.device_id || 'ios-d003c3d5-2c11-4766-866e-8bf8e511929c'}\n${status?.config?.testMode?.alwaysNotify?.expo_push_token || 'ExponentPushToken[FmqQg-OgjuWt8hLmcQDJCF]'}\nPerplexity: real API`
                  }
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1 pr-1">
                    <span className="text-[13px] font-medium">
                      Test mode{testModeSaving ? '…' : ''}{' '}
                      <span
                        className={
                          testModeEnabled
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }
                      >
                        {testModeEnabled ? 'ON' : 'OFF'}
                      </span>
                    </span>
                    {testModeEnabled ? (
                      <>
                        <span className="text-[10px] font-normal leading-snug text-muted-foreground">
                          Pushes only to tester · Perplexity dummy
                        </span>
                        <span className="break-all font-mono text-[9px] leading-snug text-muted-foreground">
                          {status?.config?.testMode?.alwaysNotify?.device_id ||
                            'ios-d003c3d5-2c11-4766-866e-8bf8e511929c'}
                        </span>
                        <span className="break-all font-mono text-[9px] leading-snug text-muted-foreground">
                          {status?.config?.testMode?.alwaysNotify
                            ?.expo_push_token ||
                            'ExponentPushToken[FmqQg-OgjuWt8hLmcQDJCF]'}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] font-normal leading-snug text-muted-foreground">
                          Pushes to all subscribers + always-notify · real
                          Perplexity
                        </span>
                        <span className="text-[9px] font-medium text-muted-foreground">
                          Always included:
                        </span>
                        <span className="break-all font-mono text-[9px] leading-snug text-muted-foreground">
                          {status?.config?.testMode?.alwaysNotify?.device_id ||
                            'ios-d003c3d5-2c11-4766-866e-8bf8e511929c'}
                        </span>
                        <span className="break-all font-mono text-[9px] leading-snug text-muted-foreground">
                          {status?.config?.testMode?.alwaysNotify
                            ?.expo_push_token ||
                            'ExponentPushToken[FmqQg-OgjuWt8hLmcQDJCF]'}
                        </span>
                      </>
                    )}
                  </span>
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => {
                    openActiveEpisodesRail()
                  }}
                >
                  <Activity className="size-3.5" strokeWidth={1.75} />
                  <span className="flex-1">Active episodes</span>
                  {activeEpisodesList.length > 0 ? (
                    <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {activeEpisodesList.length}
                    </span>
                  ) : null}
                </DropdownMenuItem>
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
                  onSelect={() => {
                    window.open(
                      '/docs/Trigger_Weekly_Market_Session_Cheat_Sheet_A4_Landscape.pdf',
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }}
                >
                  <Clock className="size-3.5" strokeWidth={1.75} />
                  Market sessions
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => {
                    if (onOpenTriggerApp) onOpenTriggerApp()
                    else if (onOpenInTrigger) {
                      onOpenInTrigger(
                        displayTicker,
                        activeTab?.label || displayTicker,
                      )
                    }
                  }}
                >
                  <Zap className="size-3.5" strokeWidth={1.75} />
                  Trigger
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => onOpenNineAmApp?.()}
                >
                  <span className="inline-flex size-3.5 items-center justify-center text-[11px] font-bold leading-none">
                    9
                  </span>
                  9AM
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

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-0">
          <MarketStatusBadge
            nowMs={nowMs}
            className="text-[10px] gap-1"
            onClick={() => void loadMarketStatusPopup({ open: true })}
          />
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
          <DialogFooter className="shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <a
                href={yahooFinanceQuoteUrl(displayTicker)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground underline-offset-2 hover:underline"
                title={`Open ${displayTicker} on Yahoo Finance`}
              >
                Yahoo Finance
              </a>
              <a
                href={perplexityFinanceQuoteUrl(displayTicker)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground underline-offset-2 hover:underline"
                title={`Open ${displayTicker} on Perplexity Finance`}
              >
                Perplexity Finance
              </a>
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

      <Dialog open={marketStatusOpen} onOpenChange={setMarketStatusOpen}>
        <DialogContent
          showCloseButton
          className="max-h-[min(90dvh,36rem)] w-[min(100vw-1.5rem,36rem)] gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="text-base">Market sessions</DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground">
              Calendar is expected hours. Delayed Yahoo data is not a market
              close. This popup does not start or stop the backend engine.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {marketStatusLoading ? (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Probing headline markets…
              </p>
            ) : null}
            {marketStatusError ? (
              <p className="text-[13px] text-rose-600">{marketStatusError}</p>
            ) : null}
            <TooltipProvider delayDuration={180}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 pr-2 font-semibold">
                        <MarketSessionHoverTip
                          title="Column · Market"
                          lines={[
                            'Headline Yahoo probe for this asset class.',
                            'One lightweight quote only — does not wake or stop the backend engine.',
                          ]}
                        >
                          Market
                        </MarketSessionHoverTip>
                      </th>
                      <th className="py-1.5 pr-2 font-semibold">
                        <MarketSessionHoverTip
                          title="Column · Session"
                          lines={[
                            'Expected calendar session right now (Overnight, Pre-market, Regular, Post-market, Open, Maintenance, Closed, 24/7).',
                            'Based on America/New_York policy hours — not inferred from delayed Yahoo prints.',
                          ]}
                        >
                          Session
                        </MarketSessionHoverTip>
                      </th>
                      <th className="py-1.5 pr-2 font-semibold">
                        <MarketSessionHoverTip
                          title="Column · Status"
                          lines={[
                            'Live = open + fresh data. Delayed = should be open but Yahoo is stale/missing. Closed = full session close. Maintenance = CME daily break.',
                            'Delayed is never treated as a market close.',
                          ]}
                        >
                          Status
                        </MarketSessionHoverTip>
                      </th>
                      <th className="py-1.5 font-semibold">
                        <MarketSessionHoverTip
                          title="Column · Latest data"
                          lines={[
                            'Time of the last usable Yahoo print, shown in Europe/London for display.',
                            '“—” means no quote timestamp. “Resumes …” is the next expected open when the market is closed.',
                          ]}
                        >
                          Latest data
                        </MarketSessionHoverTip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketStatusRows.map((row) => {
                      const marketInfo =
                        MARKET_PROBE_INFO[row.id] || {
                          title: row.label,
                          lines: [
                            `Probe symbol ${row.symbol}.`,
                            row.reason ||
                              'Headline market probe for the session popup.',
                          ],
                        }
                      const sessionInfo = sessionHoverInfo(
                        row.currentSession || row.uiStatus,
                        row,
                      )
                      const statusInfo = statusHoverInfo(row)
                      const latestInfo = latestDataHoverInfo(row)
                      const latestLabel =
                        row.lastUpdateLondon ||
                        (row.quoteAgeSec != null
                          ? `${Math.round(row.quoteAgeSec)}s ago`
                          : '—')
                      const childSession = row.child
                        ? row.child.currentSession || row.child.uiStatus
                        : null
                      const childSessionInfo =
                        row.child && childSession
                          ? sessionHoverInfo(childSession, row.child)
                          : null
                      return (
                        <tr key={row.id} className="border-b border-border/60">
                          <td className="py-2 pr-2 align-top">
                            <MarketSessionHoverTip
                              title={marketInfo.title}
                              lines={marketInfo.lines}
                            >
                              <div className="font-medium text-foreground">
                                {row.label}
                              </div>
                              <div className="font-mono text-[10px] text-muted-foreground">
                                {row.symbol}
                              </div>
                            </MarketSessionHoverTip>
                            {row.child ? (
                              <div className="mt-0.5">
                                <MarketSessionHoverTip
                                  title={`${row.child.label} (${row.child.symbol})`}
                                  lines={[
                                    'Cash index child probe under Indices (RTH only).',
                                    `UI status: ${row.child.uiStatus}.`,
                                    row.child.reason ||
                                      'Futures and cash can differ outside cash hours.',
                                  ]}
                                >
                                  <span className="text-[10px] text-muted-foreground">
                                    {row.child.label}: {row.child.uiStatus}
                                  </span>
                                </MarketSessionHoverTip>
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2 pr-2 align-top">
                            <MarketSessionHoverTip
                              title={sessionInfo.title}
                              lines={sessionInfo.lines}
                            >
                              <span>{row.currentSession || row.uiStatus}</span>
                            </MarketSessionHoverTip>
                            {childSessionInfo ? (
                              <div className="mt-0.5">
                                <MarketSessionHoverTip
                                  title={childSessionInfo.title}
                                  lines={childSessionInfo.lines}
                                >
                                  <span className="text-[10px] text-muted-foreground">
                                    Cash: {childSession}
                                  </span>
                                </MarketSessionHoverTip>
                              </div>
                            ) : null}
                          </td>
                          <td className="py-2 pr-2 align-top">
                            <MarketSessionHoverTip
                              title={statusInfo.title}
                              lines={statusInfo.lines}
                            >
                              <span>{row.status || row.engineLabel}</span>
                            </MarketSessionHoverTip>
                          </td>
                          <td className="py-2 align-top text-muted-foreground">
                            <MarketSessionHoverTip
                              title={latestInfo.title}
                              lines={latestInfo.lines}
                            >
                              <span>{latestLabel}</span>
                            </MarketSessionHoverTip>
                            {row.resumeAtLondon ? (
                              <div className="mt-0.5">
                                <MarketSessionHoverTip
                                  title="Next expected open"
                                  lines={[
                                    `Shown in Europe/London: ${row.resumeAtLondon}.`,
                                    'Canonical open time is computed in America/New_York from this market’s session policy.',
                                    row.nextExpectedOpenUtc
                                      ? `UTC: ${row.nextExpectedOpenUtc}.`
                                      : '',
                                  ].filter(Boolean)}
                                >
                                  <span className="text-[10px]">
                                    Resumes {row.resumeAtLondon}
                                  </span>
                                </MarketSessionHoverTip>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </TooltipProvider>
            {marketStatusFooter ? (
              <MarketSessionHoverTip
                title="What this means"
                lines={[
                  marketStatusFooter,
                  'This summary is informational only — it never starts or stops ticker engines.',
                ]}
              >
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {marketStatusFooter}
                </p>
              </MarketSessionHoverTip>
            ) : null}
            {marketStatusDebug ? (
              <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-muted/30 p-2 font-mono text-[10px]">
                {marketStatusDebug}
              </pre>
            ) : null}
          </div>
          <DialogFooter className="shrink-0 flex-wrap gap-2 border-t border-border px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              className="mr-auto"
              onClick={() => {
                const first = marketStatusRows[0]
                if (!first) return
                setMarketStatusDebug(
                  JSON.stringify(
                    {
                      symbol: first.symbol,
                      calendarState: first.calendarState,
                      freshnessState: first.freshnessState,
                      quoteTimestampUtc: first.quoteTimestampUtc,
                      nowUtc: new Date().toISOString(),
                      quoteAgeSec: first.quoteAgeSec,
                      engineGate: first.engineLabel,
                      nextExpectedOpenUtc: first.nextExpectedOpenUtc,
                    },
                    null,
                    2,
                  ),
                )
              }}
            >
              Debug
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={marketStatusLoading}
              onClick={() => void loadMarketStatusPopup({ open: true })}
            >
              Refresh
            </Button>
            <Button type="button" onClick={() => setMarketStatusOpen(false)}>
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
