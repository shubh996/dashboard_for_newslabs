import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import {
  ArrowUpDown,
  AlertTriangle,
  Bell,
  BellRing,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  ExternalLink,
  Copy,
  Download,
  LayoutGrid,
  Loader2,
  Moon,
  Newspaper,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Maximize2,
  Minimize2,
  Share2,
  Sparkles,
  Sun,
  Terminal,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useBottomToast } from '@/components/ui/bottom-toast'
import { SndkMomentumPanel } from '@/components/hub/SndkMomentumPanel'
import { readPref, writePref } from '@/lib/prefs'
import {
  fetchYahooQuote,
  fetchYahooQuotes,
  fetchYahooChart,
  fetchYahooExtremeMovers,
  fetchYahooCompanyProfile,
  searchYahooSaved,
  type YahooCompanyProfile,
  type YahooExtremeMover,
  type YahooLiveQuote,
} from '@/services/yahooApi'
import type { YahooSearchResult } from '@/types/yahoo'
import {
  normalizeYahooMarketState,
  resolveYahooActiveSession,
  type YahooSessionKey,
} from '@/lib/yahooMarketSession'
import {
  EXCHANGE_TZ_FALLBACK,
  resolveExchangeTimeZone,
} from '@/lib/exchangeTimeZone'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

function tickerExchangeTimeZone(
  ticker: string,
  quote?: Pick<YahooLiveQuote, 'exchangeTimezoneName' | 'exchange'> | null,
  assetClass?: string | null,
): string {
  return resolveExchangeTimeZone({
    exchangeTimezoneName: quote?.exchangeTimezoneName,
    exchange: quote?.exchange,
    symbol: ticker,
    assetClass,
  })
}

type DashboardSection = 'tickers' | 'news' | 'custom' | 'users' | 'settings'
type TickerSortMode =
  | 'subscribers'
  | 'movement'
  | 'movement_pos_to_neg'
  | 'movement_neg_to_pos'
  | 'name'
  | 'ticker'
  | 'saved'
/**
 * Sidebar list mode:
 * - users   = subscriber-monitored stocks (never mixed with Extreme)
 * - extreme = Yahoo big % movers today (view only — never add to Users)
 * - pinned  = Extreme picks one-click bookmarked (no dialog / no Users add)
 */
type StocksListTab = 'users' | 'extreme' | 'pinned'
/** Extreme sub-tabs: gainers first, then losers (by abs % size). */
type ExtremeDirectionTab = 'positive' | 'negative'
type NotificationApp = 'nineam' | 'trigger'
/** Top app switcher: Home hub (default) · Trigger · 9AM */
type AppSwitcherTab = 'hub' | NotificationApp

/** Extreme → Pinned: one-click bookmark, separate from Users/subscribers. */
type ExtremePinnedItem = {
  ticker: string
  company_name: string
  pinned_at: string
  /** Snapshot % when pinned (optional display) */
  change_percent?: number | null
  currency?: string | null
  saved_events?: PriceMovementEvent[]
  saved_event_count?: number
  last_saved_at?: string | null
  has_saved_movements?: boolean
  monitor_scope?: 'pinned'
}
type MovementAlertTarget = {
  ticker: string
  event: PriceMovementEvent | null
  /**
   * Extreme / Pinned: show every app device (not only ticker subscribers).
   * Default selection is empty so you Select all / pick manually before send.
   */
  allRecipients?: boolean
}

type AssetClass = 'equity' | 'commodity' | 'forex' | 'crypto' | 'index' | string
type ScrapeSource = 'perplexity' | 'trading_economics' | string

type GeminiUsageTotals = {
  dates_with_gemini?: number
  prompt_tokens?: number
  output_tokens?: number
  thoughts_tokens?: number
  total_tokens?: number
  credits_used?: number
  cost_usd?: number
  cost_usd_display?: string
}

type MonitoredTicker = {
  ticker: string
  company_name: string
  created_at?: string | null
  updated_at?: string | null
  has_saved_movements?: boolean
  saved_event_count?: number
  last_saved_at?: string | null
  subscriber_count?: number
  device_ids?: string[]
  saved_events?: PriceMovementEvent[]
  /** equity | commodity | forex | crypto | index */
  asset_class?: AssetClass
  /** perplexity (equity) | trading_economics (non-equity) */
  scrape_source?: ScrapeSource
  source_url?: string | null
  gemini_usage?: GeminiUsageTotals | null
  gemini_total_tokens?: number | null
  gemini_credits_used?: number | null
  gemini_cost_usd?: number | null
  gemini_cost_usd_display?: string | null
}

type NewsArticle = {
  id: string
  provider?: string | null
  title: string
  summary?: string
  url?: string
  image_url?: string | null
  source_name?: string | null
  author?: string | null
  published_at?: string | null
  tickers?: string[]
  topics?: string[]
  created_at?: string | null
  /** Push body preview: "NVDA (bullish) · AAPL (bearish)" */
  impact_body?: string
  ticker_sides?: Array<{ ticker: string; side: string; arrow?: string }>
}

type EnabledDevice = {
  device_id: string | null
  expo_push_token: string
  /** Currently enabled stock tickers (alertable). */
  tickers: string[]
  enabled_tickers?: string[]
  /** Tickers this device stopped / disabled. */
  disabled_tickers?: string[]
  /** True when ≥1 ticker still enabled for push. */
  enabled?: boolean
  /** on = all active, partial = some stopped, off = fully stopped. */
  subscription_status?: 'on' | 'partial' | 'off'
  enabled_count?: number
  disabled_count?: number
  /** True when this token subscribed to crypto (pro access signal). */
  pro_crypto?: boolean
  crypto_tickers?: string[]
  app_key?: string
}

type MovementSource = {
  title?: string | null
  domain?: string | null
  url?: string | null
}

type SaveStatus = 'new' | 'changed' | 'saved' | 'invalid'

type PriceMovementEvent = {
  event_date: string
  display_date?: string | null
  time_label?: string | null
  price?: string | null
  price_change?: string | null
  momentum?: string | null
  direction?: 'up' | 'down' | string | null
  premarket_change?: string | null
  pre_market_change?: string | null
  premarket_price_change?: string | null
  pre_market_price_change?: string | null
  premarket_change_percent?: string | null
  pre_market_change_percent?: string | null
  preMarketChangePercent?: string | null
  preMarketChange?: string | null
  premarket_movement?: string | null
  premarket_direction?: 'up' | 'down' | string | null
  premarket_reason?: string | string[] | null
  pre_market_reason?: string | string[] | null
  premarket_summary?: string | null
  pre_market_summary?: string | null
  premarket_reasons?: string[] | null
  pre_market_reasons?: string[] | null
  /** After-hours session quote from Perplexity. */
  after_hours_price?: string | null
  after_hours_change?: string | null
  afterhours_change?: string | null
  after_hours_direction?: 'up' | 'down' | string | null
  summary?: string
  /** Original scrape reason before Gemini classification. */
  original_summary?: string | null
  reasons?: string[]
  sources?: MovementSource[]
  source_count?: number
  claimed_source_count?: number | null
  gemini_classified_at?: string | null
  gemini_model?: string | null
  /** Supabase tag: reason was Gemini-formatted. */
  gemini_formating?: boolean | null
  /** Cumulative Gemini usage for this date (persisted in Supabase JSON). */
  gemini_prompt_tokens?: number | null
  gemini_output_tokens?: number | null
  gemini_thoughts_tokens?: number | null
  gemini_total_tokens?: number | null
  gemini_credits_used?: number | null
  gemini_cost_usd?: number | null
  gemini_cost_usd_display?: string | null
  gemini_last_prompt_tokens?: number | null
  gemini_last_output_tokens?: number | null
  gemini_last_total_tokens?: number | null
  gemini_last_credits_used?: number | null
  gemini_last_cost_usd?: number | null
  gemini_last_cost_usd_display?: string | null
  gemini_usage_updated_at?: string | null
  /** Set after scrape compares against Supabase date map. */
  save_status?: SaveStatus
  previously_saved_at?: string | null
}

type ScrapeLog = {
  at: string
  level: string
  message: string
  detail?: unknown
}

type CompareSummary = {
  total: number
  new: number
  changed: number
  already_saved: number
}

type AutoSaveResult = {
  ok: boolean
  mode?: string
  inserted?: number
  updated?: number
  inserted_dates?: string[]
  updated_dates?: string[]
  total_saved_events?: number
  message?: string
  rows_updated?: number
}

type ScrapeResult = {
  ticker: string
  url: string
  scraped_at: string
  events: PriceMovementEvent[]
  section_found: boolean
  asset_class?: AssetClass
  scrape_source?: ScrapeSource
  source_provider?: ScrapeSource
  credits: {
    before: { remaining_credits: number | null; plan_credits: number | null } | null
    after: { remaining_credits: number | null; plan_credits: number | null } | null
    used: number | null
  }
  logs: ScrapeLog[]
  compare?: CompareSummary
  auto_save?: AutoSaveResult | null
}

/** Momentum dashboard is stocks-only (equity). */
function isEquityTicker(item: Pick<MonitoredTicker, 'asset_class' | 'scrape_source'> | null | undefined) {
  const asset = String(item?.asset_class || 'equity').toLowerCase()
  if (asset === 'commodity' || asset === 'crypto' || asset === 'forex' || asset === 'index') {
    return false
  }
  if (item?.scrape_source === 'trading_economics') return false
  return true
}

/** Detect crypto symbols on a device (pro access signal for Audience). */
function looksLikeCryptoTicker(ticker: string) {
  const t = String(ticker || '')
    .trim()
    .toUpperCase()
  if (!t) return false
  if (t.includes('BITCOIN') || t.includes('ETHEREUM') || t.includes('CRYPTO')) return true
  if (
    /^(BTC|ETH|SOL|DOGE|XRP|ADA|BNB|AVAX|DOT|MATIC|LINK|LTC|BCH|UNI|ATOM|NEAR|APT|ARB|OP)(-USD|:USD|:CUR)?$/.test(
      t,
    )
  ) {
    return true
  }
  // Yahoo-style crypto pairs, e.g. BTC-USD, ETH-USD
  if (/^[A-Z0-9]{2,10}-USD$/.test(t)) return true
  return false
}

function stockTickersOnly(tickers: string[] | undefined | null) {
  return (tickers || []).filter((ticker) => !looksLikeNonEquityTicker(ticker))
}

function looksLikeNonEquityTicker(ticker: string) {
  const t = String(ticker || '')
    .trim()
    .toUpperCase()
  if (!t) return false
  if (looksLikeCryptoTicker(t)) return true
  if (t.startsWith('^')) return true
  if (t.includes('=X')) return true
  if (t.endsWith('=F')) return true
  if (t.endsWith(':CUR')) return true
  return false
}

function sourceLabelForTicker(item?: Pick<MonitoredTicker, 'scrape_source' | 'source_url' | 'ticker'> | null) {
  if (item?.scrape_source === 'trading_economics') {
    return {
      kind: 'trading_economics' as const,
      label: 'Trading Economics',
      href:
        item.source_url ||
        `https://tradingeconomics.com/`,
      short: item.source_url
        ? item.source_url.replace(/^https?:\/\/(www\.)?/, '')
        : 'tradingeconomics.com',
    }
  }
  const ticker = item?.ticker || ''
  return {
    kind: 'perplexity' as const,
    label: 'Perplexity Finance',
    href: `https://www.perplexity.ai/finance/${encodeURIComponent(ticker)}`,
    short: `perplexity.ai/finance/${ticker}`,
  }
}

type FetchErrorPopup = {
  ticker: string
  stage: 'fetch' | 'auto-save'
  message: string
}

type TabScrapeState = {
  loading: boolean
  saving: boolean
  alerting: boolean
  error: string
  result: ScrapeResult | null
  saveMessage: string
  saveIsNoop: boolean
  alertMessage: string
  alertIsError: boolean
  /** Accumulated logs for this tab (scrape + save + alert) shown in the right rail. */
  logs: ScrapeLog[]
}

const emptyTabState = (): TabScrapeState => ({
  loading: false,
  saving: false,
  alerting: false,
  error: '',
  result: null,
  saveMessage: '',
  saveIsNoop: false,
  alertMessage: '',
  alertIsError: false,
  logs: [],
})

/**
 * Display price change with correct sign coloring.
 * Does NOT invent a leading + when the value is unsigned.
 */
function formatChange(change?: string | null) {
  if (!change) return null
  const trimmed = String(change).trim()
  if (!trimmed) return null
  const negative = trimmed.startsWith('-')
  const positive = trimmed.startsWith('+')
  return {
    text: trimmed,
    negative,
    positive,
    neutral: !negative && !positive,
  }
}

function formatLivePercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function formatMarketCap(value?: number | null, currency = 'USD') {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  const abs = Math.abs(value)
  const prefix = currency === 'USD' ? '$' : `${currency} `
  if (abs >= 1e12) return `${prefix}${(value / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${prefix}${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${prefix}${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${prefix}${(value / 1e3).toFixed(1)}K`
  return `${prefix}${Math.round(value).toLocaleString()}`
}

function formatEmployeeCount(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  return value.toLocaleString()
}

function formatMarketTimestamp(value: string | null | undefined, timeZone: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

/**
 * Yahoo marketState → session key.
 * PREPRE overnight uses postMarket* (no overnightMarket* fields).
 * Missing state → closed (do not invent pre/post from the clock for pricing).
 */
type YahooMarketSession = Exclude<YahooSessionKey, 'unknown'>

function yahooMarketSession(yahoo?: YahooLiveQuote | null): YahooMarketSession {
  const active = resolveYahooActiveSession(yahoo)
  if (active && active.sessionKey !== 'unknown') return active.sessionKey
  // No Yahoo marketState yet — keep closed; UI may still show At close prices
  return 'closed'
}

/**
 * Active price/label as Yahoo pairs marketState → fields.
 * PREPRE → Overnight via postMarket*; POST → After-hours via postMarket*.
 */
function currentMarketQuoteValues(
  yahoo?: YahooLiveQuote | null,
) {
  const active = resolveYahooActiveSession(yahoo)
  if (active && active.price != null) {
    return {
      price: active.price,
      percent: active.changePercent,
      timestamp: active.time,
      session: active.labelLong,
      sessionKey: active.sessionKey as YahooMarketSession,
      isLive: active.isExtendedOrLive,
      provider: 'Yahoo' as const,
    }
  }

  // State known but session bucket empty → fall through to regular close
  const state = normalizeYahooMarketState(yahoo?.marketState)
  if (yahoo?.regularMarketPrice != null) {
    const sessionKey: YahooMarketSession =
      state === 'PRE'
        ? 'premarket'
        : state === 'PREPRE'
          ? 'overnight'
          : state === 'POST' || state === 'POSTPOST'
            ? 'after-hours'
            : state === 'REGULAR'
              ? 'regular'
              : 'closed'
    return {
      price: yahoo.regularMarketPrice,
      percent: yahoo.regularMarketChangePercent ?? null,
      timestamp: yahoo.regularMarketTime ?? null,
      session:
        sessionKey === 'closed' || !state
          ? 'At close'
          : 'Regular · at close',
      sessionKey,
      isLive: false,
      provider: 'Yahoo' as const,
    }
  }

  return {
    price: null,
    percent: null,
    timestamp: null,
    session: 'Market closed',
    sessionKey: 'closed' as const,
    isLive: false,
    provider: null,
  }
}

function yahooQuoteUrl(ticker: string) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker.toUpperCase())}`
}

function perplexityFinanceUrl(ticker: string) {
  const t = String(ticker || '').trim().toUpperCase()
  return t
    ? `https://www.perplexity.ai/finance/${encodeURIComponent(t)}`
    : 'https://www.perplexity.ai/finance'
}


function formatProviderPrice(value?: number | null, currency = 'USD') {
  if (value == null || !Number.isFinite(value)) return null
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: value < 1 ? 4 : 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value)
  } catch {
    return `${value.toFixed(value < 1 ? 4 : 2)} ${currency}`.trim()
  }
}

type MarketDataPillItem = {
  label: string
  price: number | null
  percent: number | null
  source: 'Yahoo'
  href: string
  sourceRefreshSeconds: number
  lastRefreshAt?: string | null
  nextRefreshAt?: string | null
  updatedAt?: string | null
  priceTimeLabel?: string | null
  priceTimestamp?: string | null
  /** Listing exchange IANA zone for tooltip fetch clocks */
  displayTimeZone?: string | null
  stale?: boolean
  note?: string | null
  statusOnly?: boolean
}

function MarketDataPill({
  items,
  lastCheckedAt,
  currency = 'USD',
  stacked = false,
}: {
  items: MarketDataPillItem[]
  lastCheckedAt: number | null
  currency?: string
  stacked?: boolean
}) {
  const [tooltipClock, setTooltipClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setTooltipClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div
      className={cn(
        'flex overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm',
        stacked
          ? 'min-w-[min(100%,13.5rem)] flex-col divide-y divide-border/70'
          : 'flex-wrap items-stretch divide-x divide-border/70',
      )}
    >
      {items.map((item) => {
        const price = formatProviderPrice(item.price, currency)
        const percent = formatLivePercent(item.percent)
        const lastSourceRefreshAt = item.lastRefreshAt
          ? Date.parse(item.lastRefreshAt)
          : lastCheckedAt
        const explicitNextRefreshAt = item.nextRefreshAt
          ? Date.parse(item.nextRefreshAt)
          : null
        const nextSourceRefreshAt = explicitNextRefreshAt ||
          (lastSourceRefreshAt
            ? lastSourceRefreshAt + item.sourceRefreshSeconds * 1_000
            : null)
        const secondsToNext = nextSourceRefreshAt
          ? Math.max(0, Math.ceil((nextSourceRefreshAt - tooltipClock) / 1_000))
          : null
        const fetchedTimeLabel = lastSourceRefreshAt
          ? formatMarketTimestamp(
              new Date(lastSourceRefreshAt).toISOString(),
              item.displayTimeZone || EXCHANGE_TZ_FALLBACK,
            )
          : null
        const isLiveSession =
          /pre-market|after-hours|overnight|regular session/i.test(item.label) &&
          !item.statusOnly
        return (
          <Tooltip key={`${item.label}-${item.source}`}>
            <TooltipTrigger asChild>
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'inline-flex min-w-0 flex-col items-start justify-center px-3 py-2 text-xs transition-colors hover:bg-muted/60',
                  stacked ? 'w-full' : 'min-w-[8.5rem]',
                  isLiveSession && 'bg-sky-500/[0.06]',
                )}
                aria-label={`Open ${item.source} source`}
              >
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium leading-none text-muted-foreground">
                  {isLiveSession ? (
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-60" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-sky-500" />
                    </span>
                  ) : null}
                  {item.label}
                </span>
                <span className="mt-1.5 inline-flex items-baseline gap-1.5">
                  {!item.statusOnly ? (
                    <>
                      <span className="font-mono text-[15px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
                        {price || '—'}
                      </span>
                      {percent ? (
                        <span
                          className={cn(
                            'font-mono text-[13px] font-semibold leading-none tabular-nums',
                            (item.percent ?? 0) < 0
                              ? 'text-red-600 dark:text-red-400'
                              : (item.percent ?? 0) > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-muted-foreground',
                          )}
                        >
                          {percent}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-[13px] font-medium text-muted-foreground">Closed</span>
                  )}
                </span>
              </a>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={8}
              collisionPadding={12}
              className="w-64 max-w-[calc(100vw-1.5rem)] flex-col items-stretch gap-0 overflow-hidden p-0 text-xs"
            >
              <div className="border-b border-background/15 px-3 py-2">
                <p className="text-xs font-semibold">{item.label}</p>
                <p className="mt-0.5 text-[10px] opacity-65">Yahoo Finance live quote</p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-3 py-2.5 leading-snug">
                <span className="opacity-65">Price as of</span>
                <span className="text-right font-medium tabular-nums">
                  {item.priceTimeLabel ? `${item.priceTimeLabel} ET` : 'Unavailable'}
                </span>
                <span className="opacity-65">Last fetched</span>
                <span className="text-right font-medium tabular-nums">
                  {fetchedTimeLabel ? `${fetchedTimeLabel} ET` : 'Waiting…'}
                </span>
                <span className="opacity-65">Next refresh</span>
                <span className="text-right font-medium tabular-nums">
                  {nextSourceRefreshAt ? `${secondsToNext}s` : 'Waiting…'}
                </span>
              </div>
              {item.note ? (
                <p className="border-t border-background/15 bg-amber-400/10 px-3.5 py-2 text-[11px] leading-snug text-amber-200">
                  {item.note}
                </p>
              ) : null}
              {item.stale ? (
                <p className="border-t border-background/15 bg-amber-400/10 px-3.5 py-2 text-[11px] leading-snug text-amber-200">
                  This is an older reported trade, not a reliable current-session price.
                </p>
              ) : null}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

/** Absolute percent magnitude from strings like "+4.2%", "4%", "-5.1". */
function absPercentFromChange(change?: string | null): number | null {
  if (change == null) return null
  const m = String(change).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Math.abs(Number(m[0]))
  return Number.isFinite(n) ? n : null
}

type FetchAllHit = {
  ticker: string
  company_name: string
  event: PriceMovementEvent
  /** Regular / close session move */
  close_text: string | null
  close_abs: number | null
  close_negative: boolean
  /** Pre-market move (after-hours ignored) */
  premarket_text: string | null
  premarket_abs: number | null
  premarket_negative: boolean
  /** max(close, premarket) — used for ≥4% filter + sort */
  abs_percent: number
  subscriber_count: number
  save_status?: SaveStatus
  gemini_status?: 'idle' | 'running' | 'done' | 'error'
  gemini_error?: string
}

/** Live row in the Fetch & save all progress popup. */
type FetchAllTickerRow = {
  ticker: string
  company_name: string
  subscriber_count: number
  status: 'queued' | 'loading' | 'done' | 'error' | 'skipped'
  error?: string
  hits: FetchAllHit[]
  new_dates?: number
}

function getPremarketChange(event: PriceMovementEvent) {
  return (
    event.premarket_change ??
    event.pre_market_change ??
    event.premarket_price_change ??
    event.pre_market_price_change ??
    event.premarket_change_percent ??
    event.pre_market_change_percent ??
    event.preMarketChangePercent ??
    event.preMarketChange ??
    event.premarket_movement ??
    null
  )
}

/** Close + pre-market only (after-hours intentionally ignored for notable filter/UI). */
function eventSessionMoves(event: PriceMovementEvent) {
  const closeRaw = event.price_change || event.momentum || null
  const pmRaw = getPremarketChange(event)
  const closeFmt = formatChange(closeRaw)
  const pmFmt = formatChange(pmRaw)
  const closeAbs = absPercentFromChange(closeRaw)
  const pmAbs = absPercentFromChange(pmRaw)
  const abs_percent = Math.max(closeAbs ?? 0, pmAbs ?? 0)
  return {
    close_text: closeFmt?.text || null,
    close_abs: closeAbs,
    close_negative: Boolean(closeFmt?.negative),
    premarket_text: pmFmt?.text || null,
    premarket_abs: pmAbs,
    premarket_negative: Boolean(pmFmt?.negative),
    abs_percent,
  }
}

function getPremarketReason(event: PriceMovementEvent) {
  const value =
    event.premarket_reason ??
    event.pre_market_reason ??
    event.premarket_summary ??
    event.pre_market_summary ??
    event.premarket_reasons ??
    event.pre_market_reasons ??
    null
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean).join(' ')
  return value?.trim() || ''
}

/**
 * Reason is narrative only. Session move % already shows on Close / Pre-market
 * badges — strip residual leading "6.03%" / "6.03% at Close" from scrape text.
 * Leave Gemini-structured reasons alone.
 */
function stripRedundantMovePercentFromReason(
  summary: string,
  event?: Pick<
    PriceMovementEvent,
    | 'price_change'
    | 'momentum'
    | 'premarket_change'
    | 'pre_market_change'
    | 'premarket_price_change'
    | 'after_hours_change'
    | 'gemini_formating'
    | 'summary'
  > | null,
) {
  const raw = String(summary || '')
  if (!raw.trim()) return ''

  // Gemini structured output — keep real newlines so Likely / Secondary stay
  // on separate lines (do NOT collapse \n into spaces).
  const isGeminiStructured =
    Boolean(event?.gemini_formating) ||
    /likely\s*driver\s*:/i.test(raw) ||
    /secondary\s*driver\s*:/i.test(raw) ||
    /move\s*classification\s*:/i.test(raw)

  if (isGeminiStructured) {
    return raw
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  let text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return text
  // Headline-only Gemini line ($TICKER …) without labels — still intentional copy.
  if (/^\$[A-Z]/.test(text)) {
    return text
  }

  const normalizePct = (value?: string | null) => {
    if (value == null || value === '') return null
    const match = String(value)
      .replace(/,/g, '')
      .replace(/^−/, '-')
      .match(/[+\-]?\d+(?:\.\d+)?/)
    if (!match) return null
    return match[0].replace(/^\+/, '').replace(/^-/, '')
  }

  const known = new Set(
    [
      event?.price_change,
      event?.momentum,
      event?.premarket_change,
      event?.pre_market_change,
      event?.premarket_price_change,
      event?.after_hours_change,
      event ? getPremarketChange(event as PriceMovementEvent) : null,
    ]
      .map((v) => normalizePct(v == null ? null : String(v)))
      .filter(Boolean) as string[],
  )

  let guard = 0
  while (guard < 6) {
    guard += 1
    const lead = text.match(
      /^([+\-−]?\d+(?:\.\d+)?)%\s*(?:(?:at\s*)?close|after[\s-]?hours?|(?:in\s+)?pre[\s-]?market)?\s*[:·–—,|\-]*\s*/i,
    )
    if (!lead) break
    const n = normalizePct(lead[1])
    const hasSessionLabel = /(?:close|after|pre)/i.test(lead[0])
    if (n && (known.has(n) || hasSessionLabel)) {
      text = text.slice(lead[0].length).trim()
      continue
    }
    if (n && known.size === 0 && hasSessionLabel) {
      text = text.slice(lead[0].length).trim()
      continue
    }
    // Bare leading % that equals the event move.
    if (n && known.has(n)) {
      text = text.slice(lead[0].length).trim()
      continue
    }
    break
  }

  const onlyPct = text.match(/^([+\-−]?\d+(?:\.\d+)?)%\s*$/)
  if (onlyPct) {
    const n = normalizePct(onlyPct[1])
    if (n && (known.has(n) || known.size === 0)) return ''
  }

  return text
}

/** Peel scrape chrome that often pollutes legacy Reason text in the DB. */
function cleanLegacyScrapeReason(summary: string, event?: PriceMovementEvent | null) {
  let text = stripRedundantMovePercentFromReason(summary, event)
  if (!text) return text
  // Leave Gemini structured copy alone (multi-line labels preserved above).
  if (
    event?.gemini_formating ||
    /likely\s*driver\s*:/i.test(text) ||
    /secondary\s*driver\s*:/i.test(text) ||
    /move\s*classification\s*:/i.test(text)
  ) {
    return text
  }
  // Single-line cashtag headline without structure
  if (/^\$[A-Z]/.test(text) && !text.includes('\n')) {
    return text
  }
  for (let i = 0; i < 6; i += 1) {
    const before = text
    text = text
      .replace(/^\d{4}-\d{2}-\d{2}\b[\s,·|:—-]*/i, '')
      .replace(
        /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{4})?\b[\s,·|:—-]*/i,
        '',
      )
      .replace(/^\d{1,2}:\d{2}\s*(?:AM|PM)?\s*(?:ET|EST|EDT)?\b[\s,·|:—-]*/i, '')
      .replace(/^\$[\d,]+(?:\.\d+)?\b[\s,·|:—-]*/i, '')
      .replace(/^[+\-−]?\d+(?:\.\d+)?%\b[\s,·|:—-]*/i, '')
      .replace(/^\d+\s+sources?\b[\s,·|:—-]*/i, '')
      .replace(/\[[^\]]*\]\(https?:\/\/[^)\s]+\)/gi, ' ')
      .replace(/https?:\/\/[^\s)\]>"']+/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,·|:—-]+|[\s,·|:—-]+$/g, '')
      .trim()
    if (text === before) break
  }
  // Drop trailing standalone publisher chips if they match extracted sources.
  for (const source of event?.sources || []) {
    const domain = String(source?.domain || '').replace(/^www\./i, '').trim()
    const title = String(source?.title || '').trim()
    if (domain) {
      const re = new RegExp(
        `(?:^|[\\s·|,;—-])(?:https?:\\/\\/)?(?:www\\.)?${domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s·|,;—-])`,
        'gi',
      )
      text = text.replace(re, ' ').replace(/\s+/g, ' ').trim()
    }
    if (title && title.length >= 3 && title.length <= 40) {
      const re = new RegExp(
        `(?:^|[\\s·|,;—-])${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s·|,;—-])`,
        'gi',
      )
      text = text.replace(re, ' ').replace(/\s+/g, ' ').trim()
    }
  }
  return text.replace(/^[\s,·|:—-]+|[\s,·|:—-]+$/g, '').trim()
}

/** Display value for the Reason textarea (scrape-clean; Gemini untouched). */
function reasonDisplayText(event: PriceMovementEvent, draft?: string | null) {
  // Once the user edits, show their draft as-is (don't rewrite under them).
  if (draft != null) return String(draft)
  return cleanLegacyScrapeReason(String(event.summary || ''), event)
}

function formatDigestMomentum(raw?: string | null) {
  const value = String(raw || '').trim().replace(/^−/, '-')
  if (!value) return ''
  if (value.startsWith('+') || value.startsWith('-')) return value
  const numeric = Number.parseFloat(value.replace(/%/g, '').replace(/,/g, ''))
  if (!Number.isFinite(numeric)) return value
  const magnitude = value.includes('%') ? value : `${Math.abs(numeric)}%`
  return numeric < 0 ? `-${magnitude.replace(/^-/, '')}` : `+${magnitude}`
}

/** Compact X (Twitter) mark for buttons. */
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  )
}

function clipTweet(text: string, max = 280): string {
  const t = String(text || '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

function ensureTickerCashtag(line: string, ticker: string): string {
  const symbol = String(ticker || '').toUpperCase()
  const raw = String(line || '').trim()
  if (!raw) return `$${symbol}`
  if (new RegExp(`\\$${symbol}\\b`, 'i').test(raw)) return raw
  // "TSLA rose 4%…" → "$TSLA rose 4%…"
  if (new RegExp(`^${symbol}\\b`, 'i').test(raw)) {
    return raw.replace(new RegExp(`^${symbol}\\b`, 'i'), `$${symbol}`)
  }
  // "NVDA (company) …" already cashtag-less → prefix
  return `$${symbol} ${raw}`
}

/** Parse Gemini structured summary into headline + sections. */
function parseGeminiTweetSections(summary: string) {
  const raw = String(summary || '').trim()
  const likelyMatch = raw.match(
    /likely\s*driver\s*:\s*([\s\S]*?)(?=\n\s*secondary\s*driver\s*:|$)/i,
  )
  const secondaryMatch = raw.match(
    /secondary\s*driver\s*:\s*([\s\S]*?)(?=\n\s*move\s*classification\s*:|$)/i,
  )
  const moveMatch = raw.match(
    /move\s*classification\s*:\s*([\s\S]*?)(?=\n\s*confidence\s*:|$)/i,
  )
  const confMatch = raw.match(/confidence\s*:\s*([\s\S]*?)$/i)

  let headline = ''
  const likelyIdx = raw.search(/likely\s*driver\s*:/i)
  if (likelyIdx > 0) {
    headline = raw.slice(0, likelyIdx).trim()
  }

  const clean = (s?: string) => (s || '').replace(/\s+/g, ' ').trim()

  return {
    headline,
    likely: clean(likelyMatch?.[1]),
    secondary: clean(secondaryMatch?.[1]),
    move: clean(moveMatch?.[1]),
    confidence: clean(confMatch?.[1]),
  }
}

type MomentumTweetThread = {
  tweet1: string
  tweet2: string
}

/**
 * 2-post thread:
 * 1) Gemini headline ($TICKER) + likely reason (no label) + breakdown cue
 * 2) Trigger app promo (start tracking this stock + disclaimer)
 */
function buildMomentumTweetThread(
  ticker: string,
  event: PriceMovementEvent,
  companyName?: string | null,
): MomentumTweetThread {
  const symbol = String(ticker || '').toUpperCase()
  const sections = parseGeminiTweetSections(event.summary || '')
  const close = formatChange(event.price_change || event.momentum)
  const premarket = formatChange(getPremarketChange(event))
  const displayName =
    companyName && companyName !== symbol
      ? companyName.trim()
      : symbol

  // --- Tweet 1: headline only (no reason body, no "Full move breakdown") ---
  let headline = sections.headline
  if (!headline) {
    const bits: string[] = []
    if (close?.text) bits.push(`${close.text} at close`)
    if (premarket?.text) bits.push(`pre-market ${premarket.text}`)
    headline = bits.length
      ? `${symbol} ${bits.join(' · ')}`
      : `${symbol} notable price momentum`
  }
  headline = ensureTickerCashtag(headline, symbol)
  const tweet1 = clipTweet(headline)

  // --- Tweet 2: Trigger app promo (exact copy) ---
  // Swap this URL when the final App Store / Play Store link is ready.
  const TRIGGER_APP_DOWNLOAD_URL = 'https://9am.site'
  const tweet2 = clipTweet(
    [
      `Start tracking ${displayName} on Trigger app`,
      'Trigger monitors stocks on your watchlist for notable price movement and alerts when it matters.',
      `Download: ${TRIGGER_APP_DOWNLOAD_URL}`,
      'Market information only. Not investment advice.',
    ].join('\n'),
  )

  return { tweet1, tweet2 }
}

/** Split text into wrapped lines (does not draw). */
function measureWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  // Honor hard newlines first (Gemini Likely / Secondary on separate lines),
  // then word-wrap each paragraph.
  const paragraphs = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
  const out: string[] = []

  const ellipsize = (s: string) => {
    let last = s
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1)
    }
    return `${last}…`
  }

  for (let p = 0; p < paragraphs.length; p += 1) {
    if (out.length >= maxLines) break
    const para = paragraphs[p]
    // Blank line between sections (e.g. after Likely driver)
    if (!para.trim()) {
      if (out.length > 0 && out[out.length - 1] !== '') {
        out.push('')
      }
      continue
    }
    const words = para.split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line)
        line = word
        if (out.length >= maxLines) {
          out[out.length - 1] = ellipsize(out[out.length - 1])
          return out
        }
      } else {
        line = test
      }
    }
    if (line) {
      if (out.length >= maxLines) {
        out[out.length - 1] = ellipsize(out[out.length - 1])
        return out
      }
      out.push(line)
    }
  }
  return out.slice(0, maxLines)
}

/** One bar for the share-card line chart (regular session only). */
type ShareChartBar = { t: number; close: number }

/** Session cache so slider re-renders do not re-hit Yahoo every frame. */
const shareChartSeriesCache = new Map<string, ShareChartBar[]>()

function etPartsFromMs(ms: number): {
  dateKey: string
  hour: number
  minute: number
  minutesFromMidnight: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '0'
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const minute = Number(get('minute'))
  const month = get('month')
  const day = get('day')
  const year = get('year')
  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
    minute,
    minutesFromMidnight: hour * 60 + minute,
  }
}

/**
 * Parse session heading timestamp → minutes from midnight ET.
 * Accepts: "Today · 3:33 PM", "3:33PM", "15:33", "9:46 AM ET", event.time_label, etc.
 */
function parseShareStampCutoffMinutes(
  event: Pick<PriceMovementEvent, 'time_label'> | null | undefined,
  stampText?: string | null,
): number | null {
  const candidates = [stampText, event?.time_label]
  for (const raw of candidates) {
    const s = String(raw || '').trim()
    if (!s) continue
    // 12h: 3:33 PM / 3:33PM / 12:04 am
    const m12 = s.match(/(\d{1,2}):(\d{2})\s*([AaPp][Mm])/)
    if (m12) {
      let h = Number(m12[1])
      const min = Number(m12[2])
      if (!Number.isFinite(h) || !Number.isFinite(min)) continue
      const ap = m12[3].toUpperCase()
      if (ap === 'PM' && h < 12) h += 12
      if (ap === 'AM' && h === 12) h = 0
      return Math.min(24 * 60 - 1, Math.max(0, h * 60 + min))
    }
    // 24h: 15:33
    const m24 = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
    if (m24) {
      const h = Number(m24[1])
      const min = Number(m24[2])
      if (!Number.isFinite(h) || !Number.isFinite(min)) continue
      return h * 60 + min
    }
  }
  return null
}

/** How many trading sessions to plot on the share chart (ending on the event day). */
type ShareChartSessionDays = 1 | 2 | 3 | 5

/** Yahoo bar size for share-card chart pricing. */
type ShareChartInterval = '1m' | '2m' | '5m' | '15m' | '30m' | '60m' | '1h'

const SHARE_CHART_INTERVALS: Array<{ id: ShareChartInterval; label: string }> = [
  { id: '1m', label: '1m' },
  { id: '2m', label: '2m' },
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '30m', label: '30m' },
  { id: '60m', label: '1h' },
  { id: '1h', label: '1h·alt' },
]

function clampShareChartSessionDays(raw: unknown): ShareChartSessionDays {
  const n = Math.round(Number(raw))
  if (n === 1 || n === 2 || n === 3 || n === 5) return n
  return 2
}

function clampShareChartInterval(raw: unknown): ShareChartInterval {
  const s = String(raw || '')
  if (
    s === '1m' ||
    s === '2m' ||
    s === '5m' ||
    s === '15m' ||
    s === '30m' ||
    s === '60m' ||
    s === '1h'
  ) {
    return s
  }
  return '1m'
}

/**
 * Day label under multi-day charts:
 * - today-long / today-short = Today + calendar dates
 * - date-long / date-short = always calendar dates
 * - relative / relative-short = Today · Yesterday · Back / 2d back…
 */
type ShareChartDayLabelMode =
  | 'today-short'
  | 'today-long'
  | 'date-short'
  | 'date-long'
  | 'relative'
  | 'relative-short'

function clampShareChartDayLabelMode(raw: unknown): ShareChartDayLabelMode {
  const s = String(raw || '')
  if (
    s === 'today-short' ||
    s === 'today-long' ||
    s === 'date-short' ||
    s === 'date-long' ||
    s === 'relative' ||
    s === 'relative-short'
  ) {
    return s
  }
  return 'today-long'
}

function formatShareChartCalendarDay(
  dateKey: string,
  longMonth: boolean,
): string {
  const m = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return dateKey
  const day = Number(m[3])
  const month = Number(m[2])
  const monthsShort = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const monthsLong = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  const months = longMonth ? monthsLong : monthsShort
  return `${day} ${months[Math.max(0, month - 1)] || ''}`
}

/**
 * @param daysFromEnd 0 = last (event) session on the chart, 1 = previous, …
 */
function formatShareChartDayLabel(
  dateKey: string,
  todayKey: string,
  mode: ShareChartDayLabelMode = 'today-long',
  daysFromEnd = 0,
): string {
  // Relative: Today · Yesterday · Back · 2 back · …
  if (mode === 'relative' || mode === 'relative-short') {
    const n = Math.max(0, Math.round(Number(daysFromEnd) || 0))
    const short = mode === 'relative-short'
    if (n === 0) return 'Today'
    if (n === 1) return short ? 'Yday' : 'Yesterday'
    if (n === 2) return 'Back'
    return short ? `${n} back` : `${n} days back`
  }

  const useTodayWord = mode === 'today-short' || mode === 'today-long'
  const longMonth = mode === 'today-long' || mode === 'date-long'
  if (useTodayWord && dateKey === todayKey) return 'Today'
  return formatShareChartCalendarDay(dateKey, longMonth)
}

/**
 * Zoom the chart from the left: end stays at the event stamp / last bar,
 * start moves forward by `startPct` of session-compressed span (0–90).
 */
function trimShareChartSeriesByStartPct(
  series: ShareChartBar[],
  startPctRaw: unknown,
): ShareChartBar[] {
  if (!series || series.length < 2) return series || []
  const startPct = Math.min(90, Math.max(0, Math.round(Number(startPctRaw) || 0)))
  if (startPct <= 0) return series
  const timeline = buildShareSessionTimeline(series)
  const cut = timeline.p0 + (timeline.span * startPct) / 100
  const trimmed = series.filter((b) => timeline.posAt(b.t) >= cut - 1e-6)
  if (trimmed.length >= 2) return trimmed
  // Keep last two bars so the line still draws
  return series.slice(-2)
}

/**
 * Real Yahoo intraday closes for the share card.
 * Plots N trading sessions (1 / 2 / 3 / 5), ending on the event day:
 *  - Earlier days: full regular hours 9:30–16:00 ET
 *  - Last day: 9:30 → stamp time (or 16:00)
 * Continuous chronological line; x-axis compresses overnight gaps.
 */
async function loadShareRegularSessionSeries(
  ticker: string,
  eventDate?: string | null,
  opts?: {
    /** Session heading stamp, e.g. “Today · 3:33 PM” */
    stampText?: string | null
    timeLabel?: string | null
    /** Trading days to include (1, 2, 3, or 5). Default 2. */
    sessionDays?: ShareChartSessionDays
    /** Bar size for Yahoo pricing series. */
    interval?: ShareChartInterval
  },
): Promise<ShareChartBar[]> {
  const symbol = String(ticker || '')
    .toUpperCase()
    .replace(/[^A-Z0-9.^_=\-]/g, '')
  if (!symbol) return []

  const dayKey = String(eventDate || '').slice(0, 10) || etDateKey()
  const sessionDays = clampShareChartSessionDays(opts?.sessionDays ?? 2)
  const interval = clampShareChartInterval(opts?.interval ?? '1m')
  const cutoffFromStamp = parseShareStampCutoffMinutes(
    { time_label: opts?.timeLabel ?? null },
    opts?.stampText,
  )
  const todayKey = etDateKey()
  const isToday = dayKey === todayKey
  const REG_OPEN = 9 * 60 + 30 // 9:30 ET
  const REG_CLOSE = 16 * 60 // 16:00 ET

  // End of chart window on the event day: stamp time → else now (today) → else regular close
  let cutoffMinutes: number
  if (cutoffFromStamp != null) {
    cutoffMinutes = cutoffFromStamp
  } else if (isToday) {
    const nowEt = etPartsFromMs(Date.now())
    cutoffMinutes = nowEt.minutesFromMidnight
  } else {
    cutoffMinutes = REG_CLOSE
  }
  // Keep within regular session bounds
  cutoffMinutes = Math.min(REG_CLOSE, Math.max(REG_OPEN, cutoffMinutes))

  // v2: server now allows 1m/2m on 5d (old cache stored sparse 15m under 1m keys)
  const cacheKey = `v2|${symbol}|${dayKey}|to-${cutoffMinutes}|${sessionDays}d|${interval}`
  if (shareChartSeriesCache.has(cacheKey)) {
    return shareChartSeriesCache.get(cacheKey) || []
  }

  // 5d lookback covers multi-session views; interval is user-selectable.
  const range = '5d'

  try {
    const body = await fetchYahooChart(symbol, range, interval)
    const chart = body?.chart as {
      quotes?: Array<Record<string, unknown>>
      meta?: Record<string, unknown>
      chart?: { result?: Array<{ meta?: Record<string, unknown> }> }
    } | null
    const quotes = Array.isArray(chart?.quotes) ? chart.quotes : []

    const parseClose = (row: Record<string, unknown>): number | null => {
      const closeRaw = row.close ?? row.adjclose
      let close: number
      if (typeof closeRaw === 'number') close = closeRaw
      else if (closeRaw && typeof closeRaw === 'object' && 'raw' in (closeRaw as object)) {
        close = Number((closeRaw as { raw: unknown }).raw)
      } else close = Number(closeRaw)
      return Number.isFinite(close) ? close : null
    }

    // Group regular-session bars by ET calendar day
    const byDay = new Map<string, ShareChartBar[]>()
    for (const row of quotes) {
      const rawDate = row.date
      if (!rawDate) continue
      const t = new Date(String(rawDate)).getTime()
      if (!Number.isFinite(t)) continue
      const close = parseClose(row)
      if (close == null) continue

      const et = etPartsFromMs(t)
      if (et.minutesFromMidnight < REG_OPEN) continue
      if (et.minutesFromMidnight > REG_CLOSE) continue

      const list = byDay.get(et.dateKey) || []
      list.push({ t, close })
      byDay.set(et.dateKey, list)
    }

    // Sort bars within each day + de-dupe timestamps
    for (const [key, list] of byDay) {
      list.sort((a, b) => a.t - b.t)
      const deduped: ShareChartBar[] = []
      for (const b of list) {
        if (deduped.length && deduped[deduped.length - 1].t === b.t) {
          deduped[deduped.length - 1] = b
        } else {
          deduped.push(b)
        }
      }
      byDay.set(key, deduped)
    }

    // Trading days ending on / before event day
    const allDays = [...byDay.keys()].filter((d) => d <= dayKey).sort()
    let selectedDays = allDays.slice(-sessionDays)
    if (selectedDays.length === 0 && dayKey) selectedDays = [dayKey]

    const merged: ShareChartBar[] = []
    const lastDay = selectedDays[selectedDays.length - 1] || dayKey

    for (const d of selectedDays) {
      const dayBars = byDay.get(d) || []
      for (const b of dayBars) {
        const et = etPartsFromMs(b.t)
        if (et.minutesFromMidnight < REG_OPEN) continue
        if (d === lastDay || d === dayKey) {
          // Event / last day: only through stamp cutoff
          if (et.minutesFromMidnight > cutoffMinutes) continue
        } else {
          // Full prior sessions
          if (et.minutesFromMidnight > REG_CLOSE) continue
        }
        merged.push(b)
      }
    }

    merged.sort((a, b) => a.t - b.t)
    const out: ShareChartBar[] = []
    for (const b of merged) {
      if (out.length && out[out.length - 1].t === b.t) {
        out[out.length - 1] = b
      } else {
        out.push(b)
      }
    }

    shareChartSeriesCache.set(cacheKey, out)
    return out
  } catch (err) {
    console.warn('[share] Yahoo chart fetch failed', symbol, err)
    shareChartSeriesCache.set(cacheKey, [])
    return []
  }
}

/** Regular session length in minutes (9:30–16:00 ET). */
const SHARE_SESSION_MINS = 16 * 60 - (9 * 60 + 30) // 390

/**
 * Map wall-clock timestamps onto continuous *market* time so overnight gaps
 * don't stretch the chart into a long flat diagonal (which kills waviness).
 * Day0 9:30 → 0, Day0 16:00 → 390, Day1 9:30 → 390, Day1 16:00 → 780, …
 */
function buildShareSessionTimeline(series: ShareChartBar[]): {
  posAt: (t: number) => number
  p0: number
  p1: number
  span: number
  days: string[]
} {
  const REG_OPEN = 9 * 60 + 30
  const REG_CLOSE = 16 * 60
  const days: string[] = []
  for (const b of series) {
    const d = etPartsFromMs(b.t).dateKey
    if (!days.includes(d)) days.push(d)
  }
  days.sort()
  const posAt = (t: number) => {
    const et = etPartsFromMs(t)
    let dayIdx = days.indexOf(et.dateKey)
    if (dayIdx < 0) {
      if (!days.length) return 0
      dayIdx = et.dateKey < days[0] ? 0 : days.length - 1
    }
    const m =
      Math.min(REG_CLOSE, Math.max(REG_OPEN, et.minutesFromMidnight)) - REG_OPEN
    return dayIdx * SHARE_SESSION_MINS + m
  }
  const positions = series.map((b) => posAt(b.t))
  const p0 = Math.min(...positions)
  const p1 = Math.max(...positions)
  return { posAt, p0, p1, span: Math.max(1e-6, p1 - p0), days }
}

/** Map real closes into canvas points — x uses session-compressed time (no overnight stretch). */
function buildChartPointsFromSeries(
  width: number,
  height: number,
  series: ShareChartBar[],
): Array<{ x: number; y: number; t: number; close: number }> {
  if (!series.length || width <= 0 || height <= 0) return []
  const padY = Math.max(4, height * 0.08)
  const plotH = Math.max(8, height - padY * 2)
  let min = Infinity
  let max = -Infinity
  for (const b of series) {
    if (b.close < min) min = b.close
    if (b.close > max) max = b.close
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (max <= min) {
    max = min + 1
    min = min - 1
  }
  // Slight vertical pad so peaks aren't clipped
  const range = max - min
  min -= range * 0.06
  max += range * 0.06

  const timeline = buildShareSessionTimeline(series)

  // Keep almost every bar — 1m multi-day can be ~2k points; canvas handles it.
  // Downsample only past 2500 so 1m still looks dense (not a 15m-looking polyline).
  const maxPts = 2500
  const step = series.length > maxPts ? Math.ceil(series.length / maxPts) : 1
  const sampled: ShareChartBar[] = []
  for (let i = 0; i < series.length; i += step) sampled.push(series[i])
  const last = series[series.length - 1]
  if (sampled[sampled.length - 1]?.t !== last.t) sampled.push(last)

  return sampled.map((b) => {
    const pos = timeline.posAt(b.t)
    const x = ((pos - timeline.p0) / timeline.span) * width
    const y = padY + (1 - (b.close - min) / (max - min)) * plotH
    return { x, y, t: b.t, close: b.close }
  })
}

/** Compact $ label for chart price markers. */
function formatShareChartPrice(n: number): string {
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  if (abs >= 10000) return `$${Math.round(n).toLocaleString('en-US')}`
  if (abs >= 1000) return `$${n.toFixed(1)}`
  if (abs >= 100) return `$${n.toFixed(2)}`
  if (abs >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(3)}`
}

/** % change from series open (first close). */
function formatShareChartPercent(close: number, firstClose: number): string {
  if (!Number.isFinite(close) || !Number.isFinite(firstClose) || firstClose === 0) return ''
  const pct = ((close - firstClose) / Math.abs(firstClose)) * 100
  const abs = Math.abs(pct)
  const body = abs >= 10 ? pct.toFixed(1) : pct.toFixed(2)
  if (pct > 0.005) return `+${body}%`
  if (pct < -0.005) return `${body}%` // already has minus
  return `0%`
}

/** Split custom chart label textarea (one label per line). */
function splitShareChartCustomLines(raw: string | undefined | null): string[] {
  return String(raw || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

type ShareChartPointLabelMode = 'off' | 'price' | 'percent' | 'both'

/**
 * Pick `count` evenly spaced indices along a series (includes start + end).
 * count clamped 3…8.
 */
function pickEvenSeriesIndices(length: number, count: number): number[] {
  if (length <= 0) return []
  if (length === 1) return [0]
  const n = Math.min(8, Math.max(3, Math.round(count)))
  if (n >= length) {
    return Array.from({ length }, (_, i) => i)
  }
  const out: number[] = []
  for (let i = 0; i < n; i += 1) {
    out.push(Math.round((i / (n - 1)) * (length - 1)))
  }
  // Dedupe if rounding collided
  return [...new Set(out)].sort((a, b) => a - b)
}

/** Fallback synthetic path when Yahoo is offline. */
function buildMiniChartPoints(
  width: number,
  height: number,
  isDown: boolean,
  seed: string,
): Array<{ x: number; y: number }> {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const rand = () => {
    h = (h * 1664525 + 1013904223) >>> 0
    return h / 0xffffffff
  }

  const n = 28
  const points: Array<{ x: number; y: number }> = []
  let v = 0.45 + rand() * 0.15
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1)
    const drift = isDown ? -0.35 * t : 0.35 * t
    const noise = (rand() - 0.5) * 0.18
    v = Math.max(0.08, Math.min(0.92, v + noise + drift * 0.08))
    if (i > n * 0.7) {
      v += isDown ? -0.04 : 0.04
      v = Math.max(0.06, Math.min(0.94, v))
    }
    points.push({
      x: t * width,
      y: (1 - v) * height,
    })
  }
  return points
}

const CUSTOM_LOGO_PREF_KEY = 'ticker-custom-logos'

function loadCustomLogoMap(): Record<string, string> {
  try {
    const raw = readPref(CUSTOM_LOGO_PREF_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveCustomLogoMap(map: Record<string, string>) {
  try {
    writePref(CUSTOM_LOGO_PREF_KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode */
  }
}

/**
 * Same-origin multi-source logo proxy:
 * IEX → FMP → Parqet → Synth → Yahoo website → Google/DDG favicon → logo.dev
 */
function tickerLogoProxyUrl(symbol: string) {
  const clean = String(symbol || '')
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, '')
  return clean ? `/api/yahoo/${encodeURIComponent(clean)}/logo` : null
}

function googleImagesSearchUrl(ticker: string, companyName?: string | null) {
  const symbol = String(ticker || '').toUpperCase()
  const name = companyName && companyName !== symbol ? companyName : ''
  const q = [symbol, name, 'stock', 'logo'].filter(Boolean).join(' ')
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement | null> {
  if (!url || typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    // data: URLs don't need CORS; remote may need anonymous (can fail — ok)
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      try {
        img.crossOrigin = 'anonymous'
      } catch {
        /* ignore */
      }
    }
    img.decoding = 'async'
    img.onload = () => {
      // Ensure naturalWidth is ready for canvas cover-fit draws
      if (typeof img.decode === 'function') {
        void img
          .decode()
          .then(() => resolve(img))
          .catch(() => resolve(img))
      } else {
        resolve(img)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** Prefer custom pasted logo, else multi-source proxy. */
async function loadShareLogo(
  symbol: string,
  customDataUrl?: string | null,
): Promise<HTMLImageElement | null> {
  if (customDataUrl) {
    const custom = await loadImageFromUrl(customDataUrl)
    if (custom) return custom
  }
  const url = tickerLogoProxyUrl(symbol)
  if (!url) return null
  return loadImageFromUrl(`${url}?v=2`)
}

/** Resize pasted image → compact data URL for localStorage / share card. */
async function blobToLogoDataUrl(blob: Blob, maxPx = 160): Promise<string> {
  // Prefer createImageBitmap; fall back to <img> + canvas for picky clipboard types.
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob)
      const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
      const w = Math.max(1, Math.round(bitmap.width * scale))
      const h = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')
      ctx.drawImage(bitmap, 0, 0, w, h)
      bitmap.close()
      return canvas.toDataURL('image/png')
    }
  } catch {
    /* fall through */
  }
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = await loadImageFromUrl(objectUrl)
    if (!img) throw new Error('Could not decode image')
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  } finally {
    try {
      URL.revokeObjectURL(objectUrl)
    } catch {
      /* ignore */
    }
  }
}

/** Extract image blob or image URL from a paste event (Google Images, Finder, etc.). */
function extractImageFromClipboard(data: DataTransfer | null): {
  blob: Blob | null
  url: string | null
} {
  if (!data) return { blob: null, url: null }

  // 1) Real image items
  const items = data.items ? Array.from(data.items) : []
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return { blob: file, url: null }
    }
  }

  // 2) File list (some browsers)
  const files = data.files ? Array.from(data.files) : []
  for (const file of files) {
    if (file.type.startsWith('image/')) return { blob: file, url: null }
  }

  // 3) HTML with <img src="..."> (Google Images “copy image” sometimes)
  const html = data.getData('text/html') || ''
  if (html) {
    const srcMatch =
      html.match(/<img[^>]+src=["']([^"']+)["']/i) ||
      html.match(/src=["'](data:image\/[^"']+)["']/i) ||
      html.match(/src=["'](https?:\/\/[^"']+)["']/i)
    if (srcMatch?.[1]) {
      const src = srcMatch[1].replace(/&amp;/g, '&')
      if (src.startsWith('data:image/') || /^https?:\/\//i.test(src)) {
        return { blob: null, url: src }
      }
    }
  }

  // 4) Plain text URL or data URL
  const text = (data.getData('text/plain') || data.getData('text') || '').trim()
  if (text.startsWith('data:image/') || /^https?:\/\/.+\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(text)) {
    return { blob: null, url: text }
  }
  if (/^https?:\/\//i.test(text) && /(?:ggpht|gstatic|googleusercontent|imgur|unsplash|cdn)/i.test(text)) {
    return { blob: null, url: text }
  }

  return { blob: null, url: null }
}

async function dataUrlOrBlobFromPasteSource(source: {
  blob: Blob | null
  url: string | null
}, maxPx = 900): Promise<string> {
  if (source.blob) return blobToLogoDataUrl(source.blob, maxPx)
  const url = source.url
  if (!url) throw new Error('No image in clipboard')
  if (url.startsWith('data:image/')) {
    // Already a data URL — optionally re-encode via image load for consistency
    const img = await loadImageFromUrl(url)
    if (!img) return url
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return url
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  }
  // Remote URL: try fetch, then Image element
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (res.ok) {
      const blob = await res.blob()
      if (blob.type.startsWith('image/') || blob.size > 0) {
        return blobToLogoDataUrl(blob, maxPx)
      }
    }
  } catch {
    /* CORS — fall through */
  }
  const img = await loadImageFromUrl(url)
  if (!img) throw new Error('Could not load image URL (CORS). Copy the image itself, not the link.')
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/png')
}

/** Circular logo for stocks list — left of symbol. */
function TickerLogoMark({
  symbol,
  selected,
  size = 22,
  customSrc,
  onClick,
  className,
}: {
  symbol: string
  selected?: boolean
  size?: number
  customSrc?: string | null
  onClick?: (e: ReactMouseEvent) => void
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const proxy = tickerLogoProxyUrl(symbol)
  const url = customSrc || (proxy ? `${proxy}?v=2` : null)
  const initials = String(symbol || '?')
    .slice(0, 2)
    .toUpperCase()

  // Reset fail state when src changes
  useEffect(() => {
    setFailed(false)
  }, [url])

  const shell = cn(
    'inline-flex shrink-0 items-center justify-center rounded-full',
    onClick && 'cursor-pointer ring-offset-background transition hover:ring-2 hover:ring-foreground/30',
    className,
  )

  if (!url || failed) {
    return (
      <button
        type="button"
        className={cn(
          shell,
          'text-[9px] font-bold',
          selected
            ? 'bg-background/20 text-background'
            : 'bg-muted text-muted-foreground',
        )}
        style={{ width: size, height: size }}
        onClick={onClick}
        title={onClick ? 'Replace logo' : undefined}
        aria-label={onClick ? `Replace ${symbol} logo` : undefined}
      >
        {initials}
      </button>
    )
  }

  if (onClick) {
    return (
      <button
        type="button"
        className={shell}
        style={{ width: size, height: size }}
        onClick={onClick}
        title="Replace logo"
        aria-label={`Replace ${symbol} logo`}
      >
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full rounded-full bg-white object-cover"
        />
      </button>
    )
  }

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-full bg-white object-cover', className)}
      style={{ width: size, height: size }}
    />
  )
}

function drawCircularLogo(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  diameter: number,
) {
  const r = diameter / 2
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(cx - r, cy - r, diameter, diameter)
  ctx.drawImage(img, cx - r, cy - r, diameter, diameter)
  ctx.restore()
  // Thin ring
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.lineWidth = 2
  ctx.stroke()
}

/** Logo load fail → circular monogram (AppFont-Bold · ~0.36 × logo size). */
function drawLogoMonogram(
  ctx: CanvasRenderingContext2D,
  letter: string,
  cx: number,
  cy: number,
  diameter: number,
) {
  const r = diameter / 2
  const ch = String(letter || '?').trim().charAt(0).toUpperCase() || '?'
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fillStyle = 'rgba(17,17,17,0.08)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.lineWidth = 2
  ctx.stroke()
  const fontPx = Math.max(12, Math.round(diameter * 0.36))
  ctx.font = shareFont(700, fontPx) // Bold ≈ AppFont-Bold
  ctx.fillStyle = SHARE_INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(ch, cx, cy + 1)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.restore()
}

/** Clamp bipolar photo axis (−100 … +100). */
function clampShareBgAxis(value: unknown, fallback = 0): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(-100, Math.round(n)))
}

/**
 * Full-card photo backdrop (user-pasted image).
 * Cover-fit + optional blur, then bipolar Black / White axes (−100 … +100).
 *
 * Black:  −100 = lift shadows (less black) · 0 = neutral · +100 = heavy black
 * White:  −100 = crush highlights · 0 = neutral · +100 = bright / white wash
 * blurPx: 0 = crisp/sharp · higher = soft / faded glass look
 */
function drawShareBlurredPhotoBackground(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  {
    blurPx = 0,
    imageOpacity = 1,
    /** −100 … +100 black axis */
    blackAxis = 0,
    /** −100 … +100 white axis */
    whiteAxis = 0,
  }: {
    blurPx?: number
    /** 0–1 opacity of the background image itself */
    imageOpacity?: number
    blackAxis?: number
    whiteAxis?: number
  } = {},
) {
  if (w <= 0 || h <= 0) return
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return

  const blur = Math.max(0, Math.min(80, blurPx))
  const imgA = Math.min(1, Math.max(0, imageOpacity))
  const black = clampShareBgAxis(blackAxis, 0)
  const white = clampShareBgAxis(whiteAxis, 0)
  // Oversample so blur doesn’t reveal empty edges (no pad when crisp)
  const pad = blur > 0 ? Math.ceil(blur * 2.5) : 0
  const scale = Math.max((w + pad * 2) / iw, (h + pad * 2) / ih)
  const dw = iw * scale
  const dh = ih * scale
  const dx = (w - dw) / 2
  const dy = (h - dh) / 2

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.clip()

  // Image brightness nudged slightly by axes so −/+ feels natural
  // black+ darkens · black− lightens · white+ brightens · white− dims
  const brightMul =
    1 -
    (black > 0 ? black / 100 : 0) * 0.22 +
    (black < 0 ? Math.abs(black) / 100 : 0) * 0.18 +
    (white > 0 ? white / 100 : 0) * 0.2 -
    (white < 0 ? Math.abs(white) / 100 : 0) * 0.16
  const brightness = Math.min(1.45, Math.max(0.55, brightMul))
  // Crisp (low blur): full/punchy color · heavy blur: slight desat for “glass”
  const saturate =
    blur <= 2 ? 1.06 : blur < 18 ? 1.0 : 0.92
  const contrast = blur <= 2 ? 1.04 : 1.0

  if (imgA > 0.01) {
    ctx.globalAlpha = imgA
    if ('filter' in ctx) {
      const parts = [
        blur > 0 ? `blur(${blur}px)` : '',
        `brightness(${brightness.toFixed(3)})`,
        `saturate(${saturate.toFixed(3)})`,
        contrast !== 1 ? `contrast(${contrast.toFixed(3)})` : '',
      ].filter(Boolean)
      ctx.filter = parts.join(' ')
    }
    // Prefer high-quality scaling for sharp exports
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, dx, dy, dw, dh)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
  }

  // —— Black axis overlays ——
  if (black > 0) {
    const t = black / 100
    // Solid soft-black veil
    ctx.fillStyle = `rgba(12,12,14,${(0.88 * t).toFixed(3)})`
    ctx.fillRect(0, 0, w, h)
    // Edge vignette for depth (scales with +black)
    const cx = w * 0.5
    const cy = h * 0.42
    const rMax = Math.hypot(w, h) * 0.62
    const rad = ctx.createRadialGradient(cx, cy, rMax * 0.15, cx, cy, rMax)
    rad.addColorStop(0, `rgba(0,0,0,${(0.06 * t).toFixed(3)})`)
    rad.addColorStop(0.55, `rgba(0,0,0,${(0.28 * t).toFixed(3)})`)
    rad.addColorStop(1, `rgba(0,0,0,${(0.55 * t).toFixed(3)})`)
    ctx.fillStyle = rad
    ctx.fillRect(0, 0, w, h)
  } else if (black < 0) {
    // Lift blacks / open shadows — soft light veil
    const t = Math.abs(black) / 100
    ctx.fillStyle = `rgba(255,255,255,${(0.28 * t).toFixed(3)})`
    ctx.fillRect(0, 0, w, h)
  }

  // —— White axis overlays ——
  if (white > 0) {
    const t = white / 100
    // Bright / white wash
    ctx.fillStyle = `rgba(255,255,255,${(0.42 * t).toFixed(3)})`
    ctx.fillRect(0, 0, w, h)
  } else if (white < 0) {
    // Crush highlights — pull whites down toward grey/black
    const t = Math.abs(white) / 100
    ctx.fillStyle = `rgba(0,0,0,${(0.38 * t).toFixed(3)})`
    ctx.fillRect(0, 0, w, h)
  }

  ctx.restore()
}

/**
 * Hero photo in place of the chart slot: cover-fit, optional radius, border,
 * and an inset frosted edge so it sits cleanly on the card.
 */
function drawShareHeroPhoto(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  {
    radius = 28,
    borderWidth = 3,
    borderColor = 'rgba(255,255,255,0.55)',
    frost = 0.45,
  }: {
    radius?: number
    borderWidth?: number
    borderColor?: string
    /** 0–1 strength of inset frosted rim */
    frost?: number
  } = {},
) {
  if (w <= 0 || h <= 0) return
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  const bw = Math.max(0, borderWidth)
  const frostA = Math.min(1, Math.max(0, frost))

  const scale = Math.max(w / iw, h / ih)
  const dw = iw * scale
  const dh = ih * scale
  const dx = x + (w - dw) / 2
  const dy = y + (h - dh) / 2

  // Soft drop shadow under the photo frame
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.18)'
  ctx.shadowBlur = 28
  ctx.shadowOffsetY = 10
  roundRect(ctx, x, y, w, h, r)
  ctx.fillStyle = '#000'
  ctx.fill()
  ctx.restore()

  // Photo
  ctx.save()
  roundRect(ctx, x, y, w, h, r)
  ctx.clip()
  ctx.drawImage(img, dx, dy, dw, dh)

  // Inset frosted rim (light edge + soft dark inner fade)
  if (frostA > 0.01) {
    const rim = Math.max(10, Math.min(w, h) * 0.08)
    const g = ctx.createLinearGradient(x, y, x, y + rim)
    g.addColorStop(0, `rgba(255,255,255,${0.35 * frostA})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, rim)

    const g2 = ctx.createLinearGradient(x, y + h - rim, x, y + h)
    g2.addColorStop(0, 'rgba(0,0,0,0)')
    g2.addColorStop(1, `rgba(0,0,0,${0.22 * frostA})`)
    ctx.fillStyle = g2
    ctx.fillRect(x, y + h - rim, w, rim)

    // Side vignette for “integrated” feel
    const gx = ctx.createLinearGradient(x, y, x + rim, y)
    gx.addColorStop(0, `rgba(0,0,0,${0.12 * frostA})`)
    gx.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gx
    ctx.fillRect(x, y, rim, h)
    const gx2 = ctx.createLinearGradient(x + w - rim, y, x + w, y)
    gx2.addColorStop(0, 'rgba(0,0,0,0)')
    gx2.addColorStop(1, `rgba(0,0,0,${0.12 * frostA})`)
    ctx.fillStyle = gx2
    ctx.fillRect(x + w - rim, y, rim, h)
  }
  ctx.restore()

  // Border
  if (bw > 0) {
    ctx.save()
    roundRect(ctx, x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(0, r - bw / 2))
    ctx.strokeStyle = borderColor
    ctx.lineWidth = bw
    ctx.stroke()
    // Second hairline for frosted glass edge
    roundRect(ctx, x + bw + 0.5, y + bw + 0.5, w - (bw + 0.5) * 2, h - (bw + 0.5) * 2, Math.max(0, r - bw - 1))
    ctx.strokeStyle = `rgba(255,255,255,${0.22 * frostA})`
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }
}

/** Design system greens/reds (mobile share card) — default middle shades. */
const SHARE_UP_GREEN = '#228B22'
const SHARE_DOWN_RED = '#DC2626'
const SHARE_INK = '#111111'
const SHARE_INK_SOFT = 'rgba(17,17,17,0.82)'
const SHARE_BRAND_LIGHT = 'rgba(255,255,255,0.92)'

type ShareMoveShadeFamily = 'green' | 'red' | 'white'

/** Positive move shades (chart line + %) — greens + white variety. Ids 0–4 keep legacy prefs. */
const SHARE_UP_GREEN_SHADES: Array<{
  id: number
  label: string
  hex: string
  family: ShareMoveShadeFamily
}> = [
  // —— Greens (0–4 legacy) ——
  { id: 0, label: 'Forest', hex: '#14532D', family: 'green' },
  { id: 1, label: 'Deep', hex: '#166534', family: 'green' },
  { id: 2, label: 'Classic', hex: '#228B22', family: 'green' }, // default design token
  { id: 3, label: 'Bright', hex: '#16A34A', family: 'green' },
  { id: 4, label: 'Lime', hex: '#4ADE80', family: 'green' },
  // —— More greens ——
  { id: 5, label: 'Pine', hex: '#052E16', family: 'green' },
  { id: 6, label: 'Hunter', hex: '#1B4332', family: 'green' },
  { id: 7, label: 'Emerald', hex: '#059669', family: 'green' },
  { id: 8, label: 'Teal', hex: '#0D9488', family: 'green' },
  { id: 9, label: 'Mint', hex: '#34D399', family: 'green' },
  { id: 10, label: 'Spring', hex: '#22C55E', family: 'green' },
  { id: 11, label: 'Neon', hex: '#A3E635', family: 'green' },
  { id: 12, label: 'Olive', hex: '#65A30D', family: 'green' },
  { id: 13, label: 'Jade', hex: '#10B981', family: 'green' },
  // —— White / light (for dark cards) ——
  { id: 14, label: 'White', hex: '#FFFFFF', family: 'white' },
  { id: 15, label: 'Snow', hex: '#FAFAFA', family: 'white' },
  { id: 16, label: 'Off-white', hex: '#F8FAFC', family: 'white' },
  { id: 17, label: 'Ivory', hex: '#FFFBEB', family: 'white' },
  { id: 18, label: 'Cream', hex: '#FEF3C7', family: 'white' },
  { id: 19, label: 'Soft mint', hex: '#ECFDF5', family: 'white' },
]

/** Negative move shades (chart line + %) — reds + white variety. Ids 0–4 keep legacy prefs. */
const SHARE_DOWN_RED_SHADES: Array<{
  id: number
  label: string
  hex: string
  family: ShareMoveShadeFamily
}> = [
  // —— Reds (0–4 legacy) ——
  { id: 0, label: 'Burgundy', hex: '#7F1D1D', family: 'red' },
  { id: 1, label: 'Crimson', hex: '#991B1B', family: 'red' },
  { id: 2, label: 'Classic', hex: '#DC2626', family: 'red' }, // default design token
  { id: 3, label: 'Coral', hex: '#F43F5E', family: 'red' },
  { id: 4, label: 'Rose', hex: '#FB7185', family: 'red' },
  // —— More reds ——
  { id: 5, label: 'Wine', hex: '#4C0519', family: 'red' },
  { id: 6, label: 'Maroon', hex: '#9F1239', family: 'red' },
  { id: 7, label: 'Scarlet', hex: '#EF4444', family: 'red' },
  { id: 8, label: 'Fire', hex: '#F97316', family: 'red' },
  { id: 9, label: 'Tomato', hex: '#E11D48', family: 'red' },
  { id: 10, label: 'Pink', hex: '#EC4899', family: 'red' },
  { id: 11, label: 'Blush', hex: '#FDA4AF', family: 'red' },
  { id: 12, label: 'Brick', hex: '#B91C1C', family: 'red' },
  { id: 13, label: 'Ruby', hex: '#BE123C', family: 'red' },
  // —— White / light (for dark cards) ——
  { id: 14, label: 'White', hex: '#FFFFFF', family: 'white' },
  { id: 15, label: 'Snow', hex: '#FAFAFA', family: 'white' },
  { id: 16, label: 'Off-white', hex: '#F8FAFC', family: 'white' },
  { id: 17, label: 'Ivory', hex: '#FFFBEB', family: 'white' },
  { id: 18, label: 'Cream', hex: '#FEF3C7', family: 'white' },
  { id: 19, label: 'Soft rose', hex: '#FFF1F2', family: 'white' },
]

type ShareMoveShadeId = number

function clampShareMoveShade(
  raw: unknown,
  fallback: number = 2,
  maxId: number = 30,
): ShareMoveShadeId {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  const r = Math.round(n)
  if (r < 0 || r > maxId) return fallback
  return r
}

function shareUpColorHex(shade?: number | null): string {
  const maxId = Math.max(...SHARE_UP_GREEN_SHADES.map((s) => s.id), 4)
  const id = clampShareMoveShade(shade, 2, maxId)
  return SHARE_UP_GREEN_SHADES.find((s) => s.id === id)?.hex || SHARE_UP_GREEN
}

function shareDownColorHex(shade?: number | null): string {
  const maxId = Math.max(...SHARE_DOWN_RED_SHADES.map((s) => s.id), 4)
  const id = clampShareMoveShade(shade, 2, maxId)
  return SHARE_DOWN_RED_SHADES.find((s) => s.id === id)?.hex || SHARE_DOWN_RED
}

/**
 * Stamp ink palette — families with multiple shades (red / black / gold / blue / green / purple).
 * Legacy ids `red` · `black` · `gold` · `auto` still resolve.
 */
type ShareNewsStampInkFamily =
  | 'red'
  | 'black'
  | 'gold'
  | 'blue'
  | 'green'
  | 'purple'
  | 'auto'

const SHARE_NEWS_STAMP_INK_PRESETS: Array<{
  id: string
  label: string
  hex: string
  family: ShareNewsStampInkFamily
}> = [
  // —— Red ——
  { id: 'red', label: 'Classic', hex: '#C41E3A', family: 'red' }, // legacy default
  { id: 'red-wine', label: 'Wine', hex: '#7F1D1D', family: 'red' },
  { id: 'red-crimson', label: 'Crimson', hex: '#DC2626', family: 'red' },
  { id: 'red-scarlet', label: 'Scarlet', hex: '#EF4444', family: 'red' },
  { id: 'red-coral', label: 'Coral', hex: '#F43F5E', family: 'red' },
  { id: 'red-rose', label: 'Rose', hex: '#FB7185', family: 'red' },
  // —— Black / grey ——
  { id: 'black', label: 'Classic', hex: '#1A1A1A', family: 'black' }, // legacy
  { id: 'black-ink', label: 'Ink', hex: '#0A0A0A', family: 'black' },
  { id: 'black-charcoal', label: 'Charcoal', hex: '#27272A', family: 'black' },
  { id: 'black-slate', label: 'Slate', hex: '#334155', family: 'black' },
  { id: 'black-graphite', label: 'Graphite', hex: '#4B5563', family: 'black' },
  // —— Gold / warm ——
  { id: 'gold', label: 'Classic', hex: '#B8860B', family: 'gold' }, // legacy
  { id: 'gold-amber', label: 'Amber', hex: '#D97706', family: 'gold' },
  { id: 'gold-bronze', label: 'Bronze', hex: '#92400E', family: 'gold' },
  { id: 'gold-honey', label: 'Honey', hex: '#EAB308', family: 'gold' },
  { id: 'gold-sand', label: 'Sand', hex: '#CA8A04', family: 'gold' },
  // —— Blue ——
  { id: 'blue-navy', label: 'Navy', hex: '#1E3A8A', family: 'blue' },
  { id: 'blue-royal', label: 'Royal', hex: '#2563EB', family: 'blue' },
  { id: 'blue-classic', label: 'Classic', hex: '#3B82F6', family: 'blue' },
  { id: 'blue-sky', label: 'Sky', hex: '#0EA5E9', family: 'blue' },
  { id: 'blue-steel', label: 'Steel', hex: '#475569', family: 'blue' },
  // —— Green ——
  { id: 'green-forest', label: 'Forest', hex: '#14532D', family: 'green' },
  { id: 'green-classic', label: 'Classic', hex: '#228B22', family: 'green' },
  { id: 'green-emerald', label: 'Emerald', hex: '#059669', family: 'green' },
  { id: 'green-teal', label: 'Teal', hex: '#0D9488', family: 'green' },
  { id: 'green-lime', label: 'Lime', hex: '#65A30D', family: 'green' },
  // —— Purple ——
  { id: 'purple-plum', label: 'Plum', hex: '#581C87', family: 'purple' },
  { id: 'purple-violet', label: 'Violet', hex: '#7C3AED', family: 'purple' },
  { id: 'purple-classic', label: 'Classic', hex: '#A855F7', family: 'purple' },
  { id: 'purple-lilac', label: 'Lilac', hex: '#C084FC', family: 'purple' },
  { id: 'purple-magenta', label: 'Magenta', hex: '#C026D3', family: 'purple' },
  // —— Auto (resolved at draw time) ——
  { id: 'auto', label: 'Auto', hex: '#888888', family: 'auto' },
]

const SHARE_NEWS_STAMP_INK_FAMILIES: Array<{ id: ShareNewsStampInkFamily; label: string }> = [
  { id: 'red', label: 'Red' },
  { id: 'black', label: 'Black' },
  { id: 'gold', label: 'Gold' },
  { id: 'blue', label: 'Blue' },
  { id: 'green', label: 'Green' },
  { id: 'purple', label: 'Purple' },
  { id: 'auto', label: 'Auto' },
]

/** Legacy map kept for defaults / auto. */
const SHARE_NEWS_STAMP_COLORS = {
  red: '#C41E3A',
  black: '#1A1A1A',
  gold: '#B8860B',
} as const

function resolveShareNewsStampInkHex(
  colorId: string | undefined,
  isDown: boolean,
): string {
  const id = colorId || 'red'
  if (id === 'auto') {
    return isDown ? SHARE_NEWS_STAMP_COLORS.red : SHARE_NEWS_STAMP_COLORS.gold
  }
  const found = SHARE_NEWS_STAMP_INK_PRESETS.find((p) => p.id === id)
  return found?.hex || SHARE_NEWS_STAMP_COLORS.red
}

type ShareNewsStampKind = 'breaking' | 'exploding' | 'surge' | 'crash' | 'alert'

function resolveShareNewsStampKind(
  kind: 'auto' | ShareNewsStampKind | undefined,
  isDown: boolean,
  absPct: number | null,
): ShareNewsStampKind {
  if (kind && kind !== 'auto') return kind
  if (absPct != null && absPct >= 25) return isDown ? 'crash' : 'exploding'
  if (absPct != null && absPct >= 15) return isDown ? 'crash' : 'surge'
  if (isDown) return 'crash'
  return 'breaking'
}

function shareNewsStampCopy(kind: ShareNewsStampKind): {
  center: string[]
  ring: string
} {
  switch (kind) {
    case 'exploding':
      return { center: ['EXPLODING'], ring: 'HUGE MOVE' }
    case 'surge':
      return { center: ['SURGING'], ring: 'MARKET MOVE' }
    case 'crash':
      return { center: ['CRASHING'], ring: 'MARKET MOVE' }
    case 'alert':
      return { center: ['ALERT'], ring: 'TRIGGER ALERT' }
    case 'breaking':
    default:
      return { center: ['BREAKING', 'NEWS'], ring: 'FLASH ALERT' }
  }
}

function shouldDrawShareNewsStamp(
  mode: 'off' | 'auto' | 'on' | undefined,
  sessionLineTone: string | undefined,
  sessionLine: string,
  absPct: number | null,
): boolean {
  const m = mode || 'auto'
  if (m === 'off') return false
  if (m === 'on') return true
  // auto: big moves, breaking tone, or session line already says breaking
  if ((sessionLineTone || 'classic') === 'breaking') return true
  if (absPct != null && absPct >= 10) return true
  if (/breaking|🚨|exploding|market alert/i.test(sessionLine || '')) return true
  return false
}

/** Density 0–100 → multiplier for stamp dots (sparse → dense). */
function stampDensityMult(density?: number): number {
  const d = Number.isFinite(Number(density)) ? Number(density) : 55
  // 0 → ~0.35×, 55 → 1×, 100 → ~1.85×
  return 0.35 + (Math.min(100, Math.max(0, d)) / 100) * 1.5
}

/** Draw a dotted circumference (rubber-stamp ring). densityMult scales count. */
function strokeDottedCircle(
  ctx: CanvasRenderingContext2D,
  radius: number,
  dotRadius: number,
  count: number,
  densityMult = 1,
) {
  const n = Math.max(8, Math.round(count * densityMult))
  const dr = Math.max(0.7, dotRadius)
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2
    // Slight radius jitter = inked “thappa” grain
    const jitter = 1 + (Math.sin(i * 12.9898) * 0.012)
    ctx.beginPath()
    ctx.arc(Math.cos(a) * radius * jitter, Math.sin(a) * radius * jitter, dr, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Grunge stroke along a rect — alpha is relative to baseOpacity (full-stamp fade). */
function strokeGrungeRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lineW: number,
  densityMult: number,
  baseOpacity = 1,
) {
  const segs = Math.max(40, Math.round((w + h) * 0.35 * densityMult))
  const path = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  ctx.lineWidth = lineW
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let s = 0; s < 4; s += 1) {
    const a = path[s]
    const b = path[(s + 1) % 4]
    for (let i = 0; i < segs / 4; i += 1) {
      const t0 = i / (segs / 4)
      const t1 = Math.min(1, (i + 0.7) / (segs / 4))
      // Skip some segments for broken ink
      if (Math.sin(i * 7.1 + s * 3) > 0.72) continue
      const alpha = 0.55 + 0.45 * Math.abs(Math.sin(i * 3.3 + s))
      ctx.globalAlpha = baseOpacity * alpha
      ctx.beginPath()
      ctx.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0)
      ctx.lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = baseOpacity
}

/** Grunge circular stroke (ink breaks) — alpha relative to baseOpacity. */
function strokeGrungeCircle(
  ctx: CanvasRenderingContext2D,
  radius: number,
  lineW: number,
  densityMult: number,
  baseOpacity = 1,
) {
  const segs = Math.max(48, Math.round(radius * 1.4 * densityMult))
  ctx.lineWidth = lineW
  ctx.lineCap = 'round'
  for (let i = 0; i < segs; i += 1) {
    if (Math.sin(i * 5.7) > 0.78) continue
    const t0 = (i / segs) * Math.PI * 2
    const t1 = ((i + 0.65) / segs) * Math.PI * 2
    const j = 1 + Math.sin(i * 9.1) * 0.008
    ctx.globalAlpha = baseOpacity * (0.5 + 0.5 * Math.abs(Math.cos(i * 2.1)))
    ctx.beginPath()
    ctx.arc(0, 0, radius * j, t0, t1)
    ctx.stroke()
  }
  ctx.globalAlpha = baseOpacity
}

/**
 * News stamp — two switchable looks:
 *  - circle: double ring + top/bottom arc text + center banner (CERTIFIED seal ref)
 *  - rect: rectangular grunge stamp (CERTIFIED box ref)
 *
 * Drawn at full ink on an offscreen canvas, then composited with a single
 * globalAlpha so fade/opacity applies to the ENTIRE stamp (rings + text + grain).
 */
function drawShareNewsStamp(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  diameter: number,
  opts: {
    centerLines: string[]
    ringText: string
    color: string
    rotationDeg?: number
    opacity?: number
    /** circle = seal · rect = rectangular CERTIFIED box */
    style?: 'circle' | 'rect'
    /** 0–100 dotted / grain density */
    density?: number
  },
) {
  const fontStack =
    '"Google Sans Flex", "Google Sans", "Inter", "SF Pro Display", "Segoe UI", system-ui, sans-serif'
  const stampStyle = opts.style === 'rect' ? 'rect' : 'circle'
  const r = Math.max(40, diameter / 2)
  const color = opts.color || SHARE_NEWS_STAMP_COLORS.red
  const opacity = Math.min(1, Math.max(0.05, (opts.opacity ?? 88) / 100))
  const rot = ((opts.rotationDeg ?? -14) * Math.PI) / 180
  const dens = stampDensityMult(opts.density)

  const lines = (opts.centerLines || ['BREAKING'])
    .map((l) =>
      String(l || '')
        .toUpperCase()
        .trim(),
    )
    .filter(Boolean)
  if (!lines.length) return

  // Offscreen: full-opacity stamp; main canvas only fades the whole layer
  const pad = Math.ceil(diameter * 0.2)
  const offSize = Math.ceil(diameter + pad * 2)
  const off = document.createElement('canvas')
  off.width = offSize
  off.height = offSize
  const octx = off.getContext('2d')
  if (!octx) return

  octx.save()
  octx.translate(offSize / 2, offSize / 2)
  octx.rotate(rot)
  octx.strokeStyle = color
  octx.fillStyle = color
  octx.lineCap = 'round'
  octx.lineJoin = 'round'
  octx.globalAlpha = 1

  if (stampStyle === 'rect') {
    // —— Rectangular CERTIFIED-style stamp ——
    const text = lines.join(' ')
    const fontSize = Math.max(18, Math.round(r * 0.28))
    octx.font = `800 ${fontSize}px ${fontStack}`
    const tw = octx.measureText(text).width
    const padX = fontSize * 0.55
    const padY = fontSize * 0.45
    const boxW = Math.max(r * 1.55, tw + padX * 2)
    const boxH = Math.max(fontSize + padY * 2, r * 0.55)
    const bx = -boxW / 2
    const by = -boxH / 2

    strokeGrungeRect(octx, bx, by, boxW, boxH, Math.max(2.5, r * 0.035), dens, 1)
    strokeGrungeRect(
      octx,
      bx + r * 0.04,
      by + r * 0.04,
      boxW - r * 0.08,
      boxH - r * 0.08,
      Math.max(1.5, r * 0.02),
      dens * 0.85,
      1,
    )
    const speckles = Math.round(80 * dens)
    for (let i = 0; i < speckles; i += 1) {
      const px = bx + (Math.sin(i * 12.3) * 0.5 + 0.5) * boxW
      const py = by + (Math.cos(i * 9.7) * 0.5 + 0.5) * boxH
      if (Math.sin(i * 3.1) > 0.3) continue
      octx.globalAlpha = 0.15 + 0.35 * Math.abs(Math.sin(i))
      octx.beginPath()
      octx.arc(px, py, 0.6 + (i % 3) * 0.3, 0, Math.PI * 2)
      octx.fill()
    }
    octx.globalAlpha = 1
    octx.fillStyle = color
    octx.textAlign = 'center'
    octx.textBaseline = 'middle'
    octx.font = `800 ${fontSize}px ${fontStack}`
    octx.fillText(text, 0, 1)
    octx.restore()

    ctx.save()
    ctx.globalAlpha = opacity
    ctx.drawImage(off, cx - offSize / 2, cy - offSize / 2)
    ctx.restore()
    return
  }

  // —— Circular seal ——
  strokeGrungeCircle(octx, r, Math.max(3, r * 0.045), dens, 1)
  strokeGrungeCircle(octx, r * 0.88, Math.max(2, r * 0.028), dens * 0.9, 1)

  octx.globalAlpha = 1
  octx.fillStyle = color
  const outerDotR = Math.max(1.2, r * 0.022)
  strokeDottedCircle(octx, r * 0.965, outerDotR, Math.round(r * 0.95), dens)
  strokeDottedCircle(octx, r * 0.84, Math.max(1, r * 0.014), Math.round(r * 0.8), dens)

  const rArc = r * 0.72
  const ring = String(opts.ringText || 'TRIGGER ALERT')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
  const topArc = ring ? `• ${ring} •` : ''
  const botArc = topArc ? topArc.split('').reverse().join('') : ''

  const drawArcLabel = (
    text: string,
    radius: number,
    startAngle: number,
    endAngle: number,
    flip: boolean,
  ) => {
    const chars = text.split('')
    if (!chars.length) return
    const fontSize = Math.max(10, Math.round(r * 0.1))
    octx.font = `700 ${fontSize}px ${fontStack}`
    octx.textAlign = 'center'
    octx.textBaseline = 'middle'
    octx.fillStyle = color
    octx.globalAlpha = 1
    let total = 0
    const widths = chars.map((ch) => {
      const w = octx.measureText(ch).width
      total += w
      return w
    })
    const arcLen = Math.abs(endAngle - startAngle) * radius
    const scale = total > 0 ? Math.min(1.15, (arcLen * 0.92) / total) : 1
    let angle = startAngle
    const dir = endAngle >= startAngle ? 1 : -1
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i]
      const w = widths[i] * scale
      const half = w / 2 / radius
      angle += dir * half
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      octx.save()
      octx.translate(x, y)
      octx.rotate(angle + (flip ? -Math.PI / 2 : Math.PI / 2))
      octx.fillText(ch, 0, 0)
      octx.restore()
      angle += dir * half
    }
  }

  if (topArc) {
    drawArcLabel(topArc, rArc, -Math.PI * 0.78, -Math.PI * 0.22, false)
    drawArcLabel(botArc, rArc, Math.PI * 0.78, Math.PI * 0.22, true)
  }

  const starY1 = -r * 0.22
  const starY2 = r * 0.22
  const starCount = Math.max(3, Math.round(3 + dens * 2))
  octx.fillStyle = color
  octx.globalAlpha = 0.9
  octx.font = `${Math.max(8, Math.round(r * 0.08))}px ${fontStack}`
  octx.textAlign = 'center'
  octx.textBaseline = 'middle'
  const starSpan = r * 0.42
  for (let i = 0; i < starCount; i += 1) {
    const t = starCount === 1 ? 0.5 : i / (starCount - 1)
    const sx = -starSpan / 2 + t * starSpan
    octx.fillText('★', sx, starY1)
    octx.fillText('★', sx, starY2)
  }

  const text = lines.join(lines.length > 1 ? ' ' : '')
  const centerFont = Math.max(14, Math.round(r * (lines.length > 1 ? 0.16 : 0.2)))
  octx.font = `800 ${centerFont}px ${fontStack}`
  const tw = octx.measureText(text).width
  const banW = Math.min(r * 1.55, Math.max(r * 0.95, tw + centerFont * 0.7))
  const banH = centerFont * 1.45
  const banX = -banW / 2
  const banY = -banH / 2
  octx.globalAlpha = 1
  octx.strokeStyle = color
  strokeGrungeRect(octx, banX, banY, banW, banH, Math.max(2, r * 0.028), dens * 0.9, 1)
  octx.globalAlpha = 0.08
  octx.fillStyle = color
  roundRect(octx, banX, banY, banW, banH, banH * 0.15)
  octx.fill()
  octx.globalAlpha = 1
  octx.fillStyle = color
  octx.textAlign = 'center'
  octx.textBaseline = 'middle'
  octx.font = `800 ${centerFont}px ${fontStack}`
  octx.fillText(text, 0, 1)
  octx.restore()

  // Single fade for entire stamp layer (behind content when drawn early)
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.drawImage(off, cx - offSize / 2, cy - offSize / 2)
  ctx.restore()
}

/** Resolve stamp center + ring copy: custom fields win, else kind preset. */
function resolveShareNewsStampCopy(
  style: {
    newsStampKind?: 'auto' | ShareNewsStampKind
    newsStampCenterText?: string
    newsStampRingText?: string
  },
  isDown: boolean,
  absPct: number | null,
): { center: string[]; ring: string } {
  const kind = resolveShareNewsStampKind(style.newsStampKind, isDown, absPct)
  const preset = shareNewsStampCopy(kind)
  const customCenter = String(style.newsStampCenterText ?? '').trim()
  const customRing = String(style.newsStampRingText ?? '').trim()
  const center = customCenter
    ? customCenter
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 4)
    : preset.center
  const ring = customRing || preset.ring
  return { center: center.length ? center : preset.center, ring }
}

/** Mini sparkline only — no panel background, no grid, no border. */
/** Time labels under the share chart (market session). */
type ShareChartSession = 'regular' | 'premarket' | 'after-hours'

function inferShareChartSession(
  event: PriceMovementEvent,
  sessionLine = '',
): ShareChartSession {
  const blob = `${sessionLine} ${event.summary || ''} ${event.time_label || ''}`.toLowerCase()
  if (
    /\bpre[-\s]?market\b/.test(blob) ||
    /\bpremarket\b/.test(blob) ||
    /\bbefore\s+the\s+open\b/.test(blob)
  ) {
    return 'premarket'
  }
  if (
    /\bafter[-\s]?hours?\b/.test(blob) ||
    /\bpost[-\s]?market\b/.test(blob) ||
    /\bafter\s+the\s+close\b/.test(blob)
  ) {
    return 'after-hours'
  }
  return 'regular'
}

/** Labels evenly spaced under the chart axis. */
function shareChartTimeLabels(session: ShareChartSession): string[] {
  if (session === 'premarket') {
    return ['4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM']
  }
  if (session === 'after-hours') {
    return ['4 PM', '5 PM', '6 PM', '7 PM', '8 PM']
  }
  // Regular session 9:30 → 4:00
  return ['9:30', '11 AM', '12:30', '2 PM', '4 PM']
}

/**
 * Share-card chart: real Yahoo regular-session line when `series` is provided,
 * otherwise synthetic fallback. Time axis uses real bar timestamps when possible.
 * `height` = full block (plot + optional time axis + optional day labels).
 */
function drawMiniChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  isDown: boolean,
  seed: string,
  cardBgHex = '#F5B800',
  options?: {
    showTimeAxis?: boolean
    /** Calendar day labels under the axis (Today · 5 Aug). */
    showDayLabels?: boolean
    session?: ShareChartSession
    axisTextColor?: string
    /** Real regular-session closes from Yahoo (preferred). */
    series?: ShareChartBar[] | null
    /** elapsed = 0m / 15m · timestamp = 9:30 AM wall clock */
    axisMode?: 'elapsed' | 'timestamp'
    /** IANA zone for timestamp mode (listing exchange; not browser local) */
    axisTimezone?: string
    /** Max x-axis labels (3–10), including start + end */
    maxAxisLabels?: number
    /** Override stroke/fill accent (green/red shade from layout). */
    lineColor?: string
    /** Point markers on the line: price · % · both · off */
    pointLabelMode?: ShareChartPointLabelMode
    /** @deprecated use pointLabelMode */
    showPriceLabels?: boolean
    /** How many points (3–8), including first + last. */
    priceLabelCount?: number
    /** Price / % label fill (defaults to axis text). */
    priceLabelColor?: string
    /** Custom point labels (one per line) — top / primary when both. */
    pointLabelsCustom?: string[]
    /** Custom sub labels under points when mode is both (one per line). */
    pointSubLabelsCustom?: string[]
    /** Override time-axis labels (one per line / index). */
    axisLabelsCustom?: string[]
    /** Time-axis label font size (canvas px). */
    axisFontSize?: number
    /** Point price/% label font size (canvas px). */
    pointFontSize?: number
    /** Day-label font size (canvas px). */
    dayLabelFontSize?: number
    /** Extra px between time ticks row and day labels row. */
    timeDayGap?: number
    /** Today · 5 Aug · 6 August formatting. */
    dayLabelMode?: ShareChartDayLabelMode
    /** Stroke width of the price line (canvas px). */
    lineWidth?: number
  },
) {
  const showTimeAxis = options?.showTimeAxis !== false
  const showDayLabels = options?.showDayLabels === true
  const timeDayGap = Math.min(
    100,
    Math.max(0, Math.round(Number(options?.timeDayGap) || 14)),
  )
  // Budget under plot: pad + time row + optional gap + day row
  const timeAxisH = showTimeAxis ? 28 : 0
  const dayAxisH = showDayLabels ? 22 + (showTimeAxis ? timeDayGap : 4) : 0
  const axisH = timeAxisH + dayAxisH
  const plotH = Math.max(40, height - axisH)
  const dayLabelMode = clampShareChartDayLabelMode(options?.dayLabelMode)
  const series = options?.series && options.series.length >= 2 ? options.series : null
  const axisMode = options?.axisMode === 'timestamp' ? 'timestamp' : 'elapsed'
  const axisTz = String(options?.axisTimezone || '').trim() || EXCHANGE_TZ_FALLBACK
  // User setting: 3…10 labels (was hard-capped at 8 — that broke higher counts)
  const MAX_LABELS = Math.min(
    10,
    Math.max(3, Math.round(Number(options?.maxAxisLabels) || 5)),
  )
  const pointLabelMode: ShareChartPointLabelMode =
    options?.pointLabelMode === 'price' ||
    options?.pointLabelMode === 'percent' ||
    options?.pointLabelMode === 'both' ||
    options?.pointLabelMode === 'off'
      ? options.pointLabelMode
      : options?.showPriceLabels === true
        ? 'price'
        : 'off'
  const showPointLabels = pointLabelMode !== 'off'
  const priceLabelCount = Math.min(
    8,
    Math.max(3, Math.round(Number(options?.priceLabelCount) || 4)),
  )
  const customPointLabels = options?.pointLabelsCustom || []
  const customPointSubs = options?.pointSubLabelsCustom || []
  const customAxisLabels = options?.axisLabelsCustom || []

  let pts: Array<{ x: number; y: number; t?: number; close?: number }>
  let lineIsDown = isDown
  if (series) {
    pts = buildChartPointsFromSeries(width, plotH, series)
    const first = series[0].close
    const lastClose = series[series.length - 1].close
    lineIsDown = lastClose < first
  } else {
    pts = buildMiniChartPoints(width, plotH, isDown, seed)
  }
  if (!pts.length) return

  const lineColor =
    options?.lineColor || (lineIsDown ? SHARE_DOWN_RED : SHARE_UP_GREEN)
  const fillTop = hexToRgba(lineColor, lineIsDown ? 0.28 : 0.3)
  const fillBot = hexToRgba(cardBgHex, 0)

  // Area under the line
  const area = ctx.createLinearGradient(0, y, 0, y + plotH)
  area.addColorStop(0, fillTop)
  area.addColorStop(1, fillBot)
  ctx.beginPath()
  ctx.moveTo(x + pts[0].x, y + pts[0].y)
  for (let i = 1; i < pts.length; i += 1) {
    ctx.lineTo(x + pts[i].x, y + pts[i].y)
  }
  ctx.lineTo(x + pts[pts.length - 1].x, y + plotH)
  ctx.lineTo(x + pts[0].x, y + plotH)
  ctx.closePath()
  ctx.fillStyle = area
  ctx.fill()

  // Main line — user-controlled thickness (auto fallback by density)
  ctx.beginPath()
  ctx.moveTo(x + pts[0].x, y + pts[0].y)
  for (let i = 1; i < pts.length; i += 1) {
    ctx.lineTo(x + pts[i].x, y + pts[i].y)
  }
  ctx.strokeStyle = lineColor
  const dense = Boolean(series && series.length >= 120)
  const veryDense = Boolean(series && series.length >= 300)
  const rawLineW = Number(options?.lineWidth)
  const autoLineW = veryDense ? 3.2 : dense ? 4.2 : 6.5
  const lineW =
    Number.isFinite(rawLineW) && rawLineW > 0
      ? Math.min(24, Math.max(1, rawLineW))
      : autoLineW
  ctx.lineWidth = lineW
  // miter keeps sharp micro-moves on dense series; thick lines prefer round
  ctx.lineJoin = veryDense && lineW <= 5 ? 'miter' : 'round'
  ctx.lineCap = 'round'
  ctx.miterLimit = 2
  ctx.stroke()

  // End dot scales with stroke so it stays proportional
  const last = pts[pts.length - 1]
  const endDotR = Math.min(16, Math.max(5, lineW * 1.55 + 2))
  ctx.beginPath()
  ctx.arc(x + last.x, y + last.y, endDotR, 0, Math.PI * 2)
  ctx.fillStyle = lineColor
  ctx.fill()
  ctx.strokeStyle = cardBgHex
  ctx.lineWidth = Math.min(4, Math.max(1.5, lineW * 0.45))
  ctx.stroke()

  // Point markers: price · % · both (real series only)
  if (showPointLabels && series && pts.some((p) => p.close != null)) {
    const idxs = pickEvenSeriesIndices(pts.length, priceLabelCount)
    const firstClose = series[0].close
    const rawPointFs = Number(options?.pointFontSize)
    const fontSize = Math.max(
      10,
      Math.round(
        Number.isFinite(rawPointFs) && rawPointFs > 0
          ? rawPointFs
          : Math.max(13, plotH * 0.08),
      ),
    )
    const fontStack =
      '"Google Sans Flex", "Google Sans", "Inter", "SF Pro Display", system-ui, sans-serif'
    ctx.font = `600 ${fontSize}px ${fontStack}`
    ctx.textBaseline = 'middle'
    const labelColor = options?.priceLabelColor || options?.axisTextColor || SHARE_INK
    const dual = pointLabelMode === 'both'
    for (let k = 0; k < idxs.length; k += 1) {
      const p = pts[idxs[k]]
      if (!p || p.close == null || !Number.isFinite(p.close)) continue
      const autoPrice = formatShareChartPrice(p.close)
      const autoPct = formatShareChartPercent(p.close, firstClose)
      let topText = ''
      let botText = ''
      if (customPointLabels[k]) {
        topText = customPointLabels[k]
        if (dual) {
          botText = customPointSubs[k] || autoPrice
        }
      } else if (pointLabelMode === 'price') {
        topText = autoPrice
      } else if (pointLabelMode === 'percent') {
        topText = autoPct
      } else if (dual) {
        topText = autoPct
        botText = autoPrice
      }
      if (!topText && !botText) continue
      const px = x + p.x
      const py = y + p.y
      // Small anchor dot (end already has a big one)
      if (k < idxs.length - 1 || idxs[k] !== pts.length - 1) {
        ctx.beginPath()
        ctx.arc(px, py, 5, 0, Math.PI * 2)
        ctx.fillStyle = lineColor
        ctx.fill()
        ctx.strokeStyle = cardBgHex
        ctx.lineWidth = 2
        ctx.stroke()
      }
      const measureMain = topText || botText
      ctx.font = `600 ${fontSize}px ${fontStack}`
      const tw = ctx.measureText(measureMain).width
      let lx = px
      let align: CanvasTextAlign = 'center'
      if (px - tw / 2 < x + 4) {
        lx = x + 4
        align = 'left'
      } else if (px + tw / 2 > x + width - 4) {
        lx = x + width - 4
        align = 'right'
      }
      const drawHaloText = (text: string, ty: number, size = fontSize) => {
        if (!text) return
        ctx.font = `600 ${size}px ${fontStack}`
        ctx.textAlign = align
        ctx.save()
        ctx.shadowColor = hexToRgba(cardBgHex, 0.95)
        ctx.shadowBlur = 6
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
        ctx.fillStyle = labelColor
        ctx.fillText(text, lx, ty)
        ctx.restore()
      }
      if (dual && topText && botText) {
        const topY = Math.max(y + fontSize * 0.6, py - fontSize - 6)
        const botY = Math.min(y + plotH - fontSize * 0.4, py + fontSize + 8)
        drawHaloText(topText, topY, fontSize)
        drawHaloText(botText, botY, Math.max(12, Math.round(fontSize * 0.9)))
      } else {
        const single = topText || botText
        const above = py - fontSize - 10
        const below = py + fontSize + 8
        const ty = above >= y + 4 ? above : Math.min(y + plotH - 4, below)
        drawHaloText(single, ty, fontSize)
      }
    }
    ctx.textAlign = 'left'
  }

  if (!showTimeAxis && !showDayLabels) return

  // Floating labels under the plot (time ticks, then optional day labels)
  const axisY = y + plotH + 6
  // Day row sits below time row + user-controlled gap
  const dayLabelY = showTimeAxis
    ? y + plotH + timeAxisH + timeDayGap
    : y + plotH + 6

  type AxisTick = { tFrac: number; label: string }
  const ticks: AxisTick[] = []

  const formatElapsedLabel = (elapsedMin: number): string => {
    const m = Math.max(0, Math.round(elapsedMin))
    if (m === 0) return '0m'
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    const rem = m % 60
    if (rem === 0) return `${h}h`
    return `${h}h ${rem}m`
  }

  // Chart axis: "2:30 PM EDT" / "4:30 PM BST" / "1:00 AM IST" (zone for that instant)
  const formatTimestampLabel = (ms: number): string => {
    const clock = new Date(ms).toLocaleTimeString('en-US', {
      timeZone: axisTz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    return withTimezoneSuffix(clock, shareTimezoneAbbrev(axisTz, ms))
  }

  // Day labels need the session timeline even when time ticks are off
  let dayTimeline: ReturnType<typeof buildShareSessionTimeline> | null = null
  if (series && series.length >= 2 && showDayLabels) {
    dayTimeline = buildShareSessionTimeline(series)
  }

  if (series && series.length >= 2 && showTimeAxis) {
    // Axis uses the same session-compressed timeline as the line (no overnight stretch)
    const timeline = buildShareSessionTimeline(series)
    const endMin = Math.max(1, Math.round(timeline.span))

    /**
     * Label count is the user setting (3–10). Evenly sample along *market* minutes
     * so labels line up with the wavy session-compressed plot.
     */
    const NICE_STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 390, 480, 780]
    const preferredMin = endMin <= 75 ? 15 : endMin <= 200 ? 30 : endMin <= 450 ? 60 : 120

    const buildElapsedMarks = (step: number): number[] => {
      const marks: number[] = [0]
      if (endMin <= 0) return marks
      let cursor = step
      const endGuard = Math.max(step * 0.3, 1.5)
      while (cursor < endMin - endGuard) {
        marks.push(Math.round(cursor))
        cursor += step
      }
      const last = Math.round(endMin)
      if (last - marks[marks.length - 1] >= 1) marks.push(last)
      else marks[marks.length - 1] = last
      return marks
    }

    type Cand = { step: number; marks: number[] }
    const cands: Cand[] = NICE_STEPS.map((step) => ({
      step,
      marks: buildElapsedMarks(step),
    })).filter((c) => c.marks.length >= 2 && c.marks.length <= MAX_LABELS)

    let best: Cand | null = null
    for (const c of cands) {
      if (!best) {
        best = c
        continue
      }
      if (c.marks.length > best.marks.length) best = c
      else if (
        c.marks.length === best.marks.length &&
        Math.abs(c.step - preferredMin) < Math.abs(best.step - preferredMin)
      ) {
        best = c
      }
    }

    let elapsedMarks =
      best?.marks ??
      Array.from({ length: MAX_LABELS }, (_, i) =>
        Math.round((i / Math.max(1, MAX_LABELS - 1)) * endMin),
      )

    if (elapsedMarks.length < MAX_LABELS && endMin > 0) {
      elapsedMarks = Array.from({ length: MAX_LABELS }, (_, i) =>
        Math.round((i / (MAX_LABELS - 1)) * endMin),
      )
      elapsedMarks = elapsedMarks.filter((v, i, arr) => i === 0 || v !== arr[i - 1])
      if (elapsedMarks[elapsedMarks.length - 1] !== endMin) {
        elapsedMarks.push(endMin)
      }
    }

    if (elapsedMarks.length > MAX_LABELS) {
      const kept: number[] = [elapsedMarks[0]]
      for (let i = 1; i <= MAX_LABELS - 2; i += 1) {
        const j = Math.round((i * (elapsedMarks.length - 1)) / (MAX_LABELS - 1))
        const v = elapsedMarks[j]
        if (v !== kept[kept.length - 1]) kept.push(v)
      }
      const lastM = elapsedMarks[elapsedMarks.length - 1]
      if (kept[kept.length - 1] !== lastM) kept.push(lastM)
      elapsedMarks = kept
    }

    // Map session-minute offset → nearest series bar timestamp (for absolute labels)
    const nearestBarT = (sessOffset: number): number => {
      const target = timeline.p0 + sessOffset
      let bestT = series[0].t
      let bestD = Infinity
      for (const b of series) {
        const d = Math.abs(timeline.posAt(b.t) - target)
        if (d < bestD) {
          bestD = d
          bestT = b.t
        }
      }
      return bestT
    }

    for (const elapsed of elapsedMarks) {
      const tFrac = Math.min(1, Math.max(0, elapsed / endMin))
      if (axisMode === 'elapsed') {
        ticks.push({ tFrac, label: formatElapsedLabel(elapsed) })
      } else {
        ticks.push({
          tFrac,
          label: formatTimestampLabel(nearestBarT(elapsed)),
        })
      }
    }
    for (let i = ticks.length - 1; i > 0; i -= 1) {
      if (ticks[i].label === ticks[i - 1].label) ticks.splice(i, 1)
    }
  } else if (showTimeAxis) {
    const labels =
      axisMode === 'timestamp'
        ? shareChartTimeLabels(options?.session || 'regular').slice(0, 6)
        : ['0m', '15m', '30m', '45m', '1h']
    labels.forEach((label, i) => {
      ticks.push({ tFrac: labels.length <= 1 ? 0 : i / (labels.length - 1), label })
    })
  }

  // User overrides for time-axis text (one label per line in settings)
  if (showTimeAxis && customAxisLabels.length > 0 && ticks.length > 0) {
    for (let i = 0; i < ticks.length; i += 1) {
      if (customAxisLabels[i]) ticks[i].label = customAxisLabels[i]
    }
  }

  ctx.fillStyle = options?.axisTextColor || 'rgba(17,17,17,0.62)'
  const rawAxisFs = Number(options?.axisFontSize)
  const axisFs = Math.max(
    10,
    Math.round(Number.isFinite(rawAxisFs) && rawAxisFs > 0 ? rawAxisFs : 18),
  )
  if (showTimeAxis) {
    ctx.font = shareFont(500, axisFs)
    ctx.textBaseline = 'top'
    for (let i = 0; i < ticks.length; i += 1) {
      const tFrac = Math.min(1, Math.max(0, ticks[i].tFrac))
      const tx = x + tFrac * width
      const label = ticks[i].label
      const tw = ctx.measureText(label).width
      let lx = tx - tw / 2
      if (i === 0) lx = tx
      if (i === ticks.length - 1) lx = tx - tw
      ctx.fillText(label, lx, axisY)
    }
  }

  // Calendar day labels (Today · 5 Aug) — centered under each session block
  if (showDayLabels && dayTimeline && dayTimeline.days.length > 0) {
    const todayKey = etDateKey()
    const dayFs = Math.max(
      10,
      Math.round(
        Number.isFinite(Number(options?.dayLabelFontSize)) &&
          Number(options?.dayLabelFontSize) > 0
          ? Number(options?.dayLabelFontSize)
          : Math.max(12, axisFs - 2),
      ),
    )
    ctx.font = shareFont(600, dayFs)
    ctx.textBaseline = 'top'
    ctx.fillStyle = options?.axisTextColor || 'rgba(17,17,17,0.62)'
    const REG_OPEN = 9 * 60 + 30
    for (let di = 0; di < dayTimeline.days.length; di += 1) {
      const dayKey = dayTimeline.days[di]
      // Mid of day used via visStart/visEnd below
      // Clamp to visible span for partial last day
      const dayStartAbs = di * SHARE_SESSION_MINS
      const dayEndAbs = (di + 1) * SHARE_SESSION_MINS
      const visStart = Math.max(dayTimeline.p0, dayStartAbs)
      const visEnd = Math.min(dayTimeline.p1, dayEndAbs)
      if (visEnd <= visStart) continue
      const mid = (visStart + visEnd) / 2
      const tFrac = Math.min(1, Math.max(0, (mid - dayTimeline.p0) / dayTimeline.span))
      const daysFromEnd = dayTimeline.days.length - 1 - di
      const label = formatShareChartDayLabel(
        dayKey,
        todayKey,
        dayLabelMode,
        daysFromEnd,
      )
      const tw = ctx.measureText(label).width
      let lx = x + tFrac * width - tw / 2
      lx = Math.min(x + width - tw, Math.max(x, lx))
      ctx.fillText(label, lx, dayLabelY)
    }
    void REG_OPEN
  }
  ctx.textBaseline = 'alphabetic'
}


/** Card fill id — many family shades; unknown legacy ids fall back via presets map. */
type ShareCardColorId = string

/** Body / price text id — black/grey/white families + extras. */
type ShareTextColorId = string

type ShareCardColorFamily =
  | 'yellow'
  | 'orange'
  | 'red'
  | 'pink'
  | 'green'
  | 'blue'
  | 'purple'
  | 'brown'
  | 'grey'
  | 'black'
  | 'white'

const SHARE_CARD_COLOR_PRESETS: Array<{
  id: ShareCardColorId
  label: string
  bg: string
  family: ShareCardColorFamily
  /** Suggested body text when this card color is picked */
  defaultText: ShareTextColorId
}> = [
  // —— Yellow (classic share-card family) ——
  // #F5B800 = original mobile / Yahoo-style share card yellow (default)
  { id: 'yellow', label: 'Original', bg: '#F5B800', family: 'yellow', defaultText: 'black' },
  { id: 'yellow-pale', label: 'Pale', bg: '#FFF8E1', family: 'yellow', defaultText: 'black' },
  { id: 'yellow-cream', label: 'Cream', bg: '#FFF4D6', family: 'yellow', defaultText: 'black' },
  { id: 'yellow-butter', label: 'Butter', bg: '#FFE566', family: 'yellow', defaultText: 'black' },
  { id: 'yellow-bright', label: 'Bright', bg: '#FFC107', family: 'yellow', defaultText: 'black' },
  { id: 'gold', label: 'Gold', bg: '#EAB308', family: 'yellow', defaultText: 'black' },
  { id: 'amber', label: 'Amber', bg: '#F59E0B', family: 'yellow', defaultText: 'black' },
  { id: 'yellow-deep', label: 'Deep', bg: '#D97706', family: 'yellow', defaultText: 'black' },
  { id: 'yellow-bronze', label: 'Bronze', bg: '#B45309', family: 'yellow', defaultText: 'white' },

  // —— Orange ——
  { id: 'orange-peach', label: 'Peach', bg: '#FFEDD5', family: 'orange', defaultText: 'black' },
  { id: 'orange-soft', label: 'Soft', bg: '#FDBA74', family: 'orange', defaultText: 'black' },
  { id: 'orange', label: 'Classic', bg: '#F97316', family: 'orange', defaultText: 'black' },
  { id: 'orange-vivid', label: 'Vivid', bg: '#EA580C', family: 'orange', defaultText: 'white' },
  { id: 'orange-deep', label: 'Deep', bg: '#C2410C', family: 'orange', defaultText: 'white' },
  { id: 'orange-rust', label: 'Rust', bg: '#9A3412', family: 'orange', defaultText: 'white' },

  // —— Red ——
  { id: 'red-blush', label: 'Blush', bg: '#FEE2E2', family: 'red', defaultText: 'black' },
  { id: 'coral', label: 'Coral', bg: '#FB7185', family: 'red', defaultText: 'black' },
  { id: 'rose', label: 'Rose', bg: '#F43F5E', family: 'red', defaultText: 'white' },
  { id: 'red', label: 'Classic', bg: '#EF4444', family: 'red', defaultText: 'white' },
  { id: 'red-crimson', label: 'Crimson', bg: '#DC2626', family: 'red', defaultText: 'white' },
  { id: 'red-deep', label: 'Deep', bg: '#B91C1C', family: 'red', defaultText: 'white' },
  { id: 'red-wine', label: 'Wine', bg: '#7F1D1D', family: 'red', defaultText: 'white' },

  // —— Pink / magenta ——
  { id: 'pink-blush', label: 'Blush', bg: '#FCE7F3', family: 'pink', defaultText: 'black' },
  { id: 'pink-soft', label: 'Soft', bg: '#F9A8D4', family: 'pink', defaultText: 'black' },
  { id: 'pink', label: 'Classic', bg: '#EC4899', family: 'pink', defaultText: 'white' },
  { id: 'pink-hot', label: 'Hot', bg: '#DB2777', family: 'pink', defaultText: 'white' },
  { id: 'pink-fuchsia', label: 'Fuchsia', bg: '#C026D3', family: 'pink', defaultText: 'white' },
  { id: 'pink-deep', label: 'Deep', bg: '#9D174D', family: 'pink', defaultText: 'white' },

  // —— Green ——
  { id: 'green-mint', label: 'Mint', bg: '#D1FAE5', family: 'green', defaultText: 'black' },
  { id: 'mint', label: 'Soft mint', bg: '#6EE7B7', family: 'green', defaultText: 'black' },
  { id: 'green-lime', label: 'Lime', bg: '#84CC16', family: 'green', defaultText: 'black' },
  { id: 'green', label: 'Classic', bg: '#22C55E', family: 'green', defaultText: 'black' },
  { id: 'green-emerald', label: 'Emerald', bg: '#059669', family: 'green', defaultText: 'white' },
  { id: 'green-teal', label: 'Teal', bg: '#0D9488', family: 'green', defaultText: 'white' },
  { id: 'forest', label: 'Forest', bg: '#14532D', family: 'green', defaultText: 'white' },
  { id: 'green-pine', label: 'Pine', bg: '#052E16', family: 'green', defaultText: 'white' },

  // —— Blue ——
  { id: 'blue-ice', label: 'Ice', bg: '#E0F2FE', family: 'blue', defaultText: 'black' },
  { id: 'sky', label: 'Sky', bg: '#38BDF8', family: 'blue', defaultText: 'black' },
  { id: 'blue-soft', label: 'Soft', bg: '#60A5FA', family: 'blue', defaultText: 'black' },
  { id: 'blue', label: 'Classic', bg: '#3B82F6', family: 'blue', defaultText: 'white' },
  { id: 'blue-royal', label: 'Royal', bg: '#2563EB', family: 'blue', defaultText: 'white' },
  { id: 'indigo', label: 'Indigo', bg: '#6366F1', family: 'blue', defaultText: 'white' },
  { id: 'blue-navy', label: 'Navy blue', bg: '#1E3A8A', family: 'blue', defaultText: 'white' },
  { id: 'navy', label: 'Navy', bg: '#0F172A', family: 'blue', defaultText: 'white' },

  // —— Purple / violet ——
  { id: 'purple-lilac', label: 'Lilac', bg: '#F3E8FF', family: 'purple', defaultText: 'black' },
  { id: 'purple-soft', label: 'Soft', bg: '#C4B5FD', family: 'purple', defaultText: 'black' },
  { id: 'violet', label: 'Violet', bg: '#8B5CF6', family: 'purple', defaultText: 'white' },
  { id: 'purple', label: 'Classic', bg: '#A855F7', family: 'purple', defaultText: 'white' },
  { id: 'purple-deep', label: 'Deep', bg: '#7C3AED', family: 'purple', defaultText: 'white' },
  { id: 'purple-plum', label: 'Plum', bg: '#581C87', family: 'purple', defaultText: 'white' },

  // —— Brown / sand / warm neutrals ——
  { id: 'sand', label: 'Sand', bg: '#F5E6C8', family: 'brown', defaultText: 'black' },
  { id: 'brown-tan', label: 'Tan', bg: '#D6B88C', family: 'brown', defaultText: 'black' },
  { id: 'brown-khaki', label: 'Khaki', bg: '#C4A574', family: 'brown', defaultText: 'black' },
  { id: 'brown', label: 'Classic', bg: '#A16207', family: 'brown', defaultText: 'white' },
  { id: 'brown-coffee', label: 'Coffee', bg: '#78350F', family: 'brown', defaultText: 'white' },
  { id: 'brown-espresso', label: 'Espresso', bg: '#451A03', family: 'brown', defaultText: 'white' },

  // —— Grey ——
  { id: 'grey-cloud', label: 'Cloud', bg: '#F3F4F6', family: 'grey', defaultText: 'black' },
  { id: 'grey-silver', label: 'Silver', bg: '#D1D5DB', family: 'grey', defaultText: 'black' },
  { id: 'grey', label: 'Classic', bg: '#9CA3AF', family: 'grey', defaultText: 'black' },
  { id: 'slate', label: 'Slate', bg: '#334155', family: 'grey', defaultText: 'white' },
  { id: 'charcoal', label: 'Charcoal', bg: '#1E293B', family: 'grey', defaultText: 'white' },
  { id: 'grey-graphite', label: 'Graphite', bg: '#111827', family: 'grey', defaultText: 'white' },

  // —— Black (faded / soft first — best with digital photo backgrounds) ——
  { id: 'black-faded', label: 'Faded', bg: '#1A1A1E', family: 'black', defaultText: 'white' },
  { id: 'black-soft', label: 'Soft black', bg: '#27272A', family: 'black', defaultText: 'white' },
  { id: 'black-smoke', label: 'Smoke', bg: '#16161A', family: 'black', defaultText: 'white' },
  { id: 'black', label: 'Classic', bg: '#111111', family: 'black', defaultText: 'white' },
  { id: 'black-ink', label: 'Ink', bg: '#0A0A0A', family: 'black', defaultText: 'white' },
  { id: 'black-void', label: 'Void', bg: '#000000', family: 'black', defaultText: 'white' },

  // —— White / paper ——
  { id: 'white', label: 'White', bg: '#FFFFFF', family: 'white', defaultText: 'black' },
  { id: 'white-snow', label: 'Snow', bg: '#FAFAFA', family: 'white', defaultText: 'black' },
  { id: 'cream', label: 'Paper cream', bg: '#FFFBF0', family: 'white', defaultText: 'black' },
  { id: 'white-ivory', label: 'Ivory', bg: '#FFFFF0', family: 'white', defaultText: 'black' },
  { id: 'white-linen', label: 'Linen', bg: '#FAF7F2', family: 'white', defaultText: 'black' },
]

const SHARE_CARD_COLOR_FAMILIES: Array<{ id: ShareCardColorFamily; label: string }> = [
  { id: 'yellow', label: 'Yellow' },
  { id: 'orange', label: 'Orange' },
  { id: 'red', label: 'Red' },
  { id: 'pink', label: 'Pink' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'purple', label: 'Purple' },
  { id: 'brown', label: 'Brown' },
  { id: 'grey', label: 'Grey' },
  { id: 'black', label: 'Black' },
  { id: 'white', label: 'White' },
]

/** Text / price ink — families with multiple shades. */
const SHARE_TEXT_COLOR_PRESETS: Array<{
  id: ShareTextColorId
  label: string
  hex: string
  muted: string
  soft: string
  family: 'black' | 'grey' | 'white' | 'warm' | 'cool'
}> = [
  // Black family
  { id: 'black', label: 'Black', hex: '#111111', muted: 'rgba(17,17,17,0.62)', soft: 'rgba(17,17,17,0.82)', family: 'black' },
  { id: 'ink', label: 'Ink', hex: '#0A0A0A', muted: 'rgba(10,10,10,0.62)', soft: 'rgba(10,10,10,0.85)', family: 'black' },
  { id: 'charcoal-text', label: 'Charcoal', hex: '#1F2937', muted: 'rgba(31,41,55,0.65)', soft: 'rgba(31,41,55,0.88)', family: 'black' },
  { id: 'near-black', label: 'Near black', hex: '#171717', muted: 'rgba(23,23,23,0.62)', soft: 'rgba(23,23,23,0.84)', family: 'black' },

  // Grey family
  { id: 'grey-dark', label: 'Dark grey', hex: '#374151', muted: 'rgba(55,65,81,0.7)', soft: 'rgba(55,65,81,0.9)', family: 'grey' },
  { id: 'grey', label: 'Grey', hex: '#6B7280', muted: 'rgba(107,114,128,0.85)', soft: 'rgba(107,114,128,0.95)', family: 'grey' },
  { id: 'grey-mid', label: 'Mid grey', hex: '#9CA3AF', muted: 'rgba(156,163,175,0.85)', soft: 'rgba(156,163,175,0.95)', family: 'grey' },
  { id: 'grey-light', label: 'Light grey', hex: '#D1D5DB', muted: 'rgba(209,213,219,0.8)', soft: 'rgba(209,213,219,0.95)', family: 'grey' },
  { id: 'slate-text', label: 'Slate', hex: '#475569', muted: 'rgba(71,85,105,0.72)', soft: 'rgba(71,85,105,0.9)', family: 'grey' },

  // White family
  { id: 'white', label: 'White', hex: '#FFFFFF', muted: 'rgba(255,255,255,0.72)', soft: 'rgba(255,255,255,0.88)', family: 'white' },
  { id: 'off-white', label: 'Off-white', hex: '#F8FAFC', muted: 'rgba(248,250,252,0.72)', soft: 'rgba(248,250,252,0.9)', family: 'white' },
  { id: 'snow', label: 'Snow', hex: '#FAFAFA', muted: 'rgba(250,250,250,0.7)', soft: 'rgba(250,250,250,0.88)', family: 'white' },
  { id: 'ivory-text', label: 'Ivory', hex: '#FFFBEB', muted: 'rgba(255,251,235,0.72)', soft: 'rgba(255,251,235,0.9)', family: 'white' },

  // Warm inks (on light cards)
  { id: 'brown-text', label: 'Brown', hex: '#78350F', muted: 'rgba(120,53,15,0.7)', soft: 'rgba(120,53,15,0.88)', family: 'warm' },
  { id: 'coffee-text', label: 'Coffee', hex: '#451A03', muted: 'rgba(69,26,3,0.68)', soft: 'rgba(69,26,3,0.88)', family: 'warm' },
  { id: 'maroon-text', label: 'Maroon', hex: '#7F1D1D', muted: 'rgba(127,29,29,0.7)', soft: 'rgba(127,29,29,0.88)', family: 'warm' },

  // Cool inks
  { id: 'navy-text', label: 'Navy', hex: '#0F172A', muted: 'rgba(15,23,42,0.65)', soft: 'rgba(15,23,42,0.88)', family: 'cool' },
  { id: 'indigo-text', label: 'Indigo', hex: '#312E81', muted: 'rgba(49,46,129,0.7)', soft: 'rgba(49,46,129,0.9)', family: 'cool' },
  { id: 'teal-text', label: 'Teal', hex: '#134E4A', muted: 'rgba(19,78,74,0.7)', soft: 'rgba(19,78,74,0.9)', family: 'cool' },
]

const SHARE_TEXT_COLOR_FAMILIES: Array<{
  id: 'black' | 'grey' | 'white' | 'warm' | 'cool'
  label: string
}> = [
  { id: 'black', label: 'Black' },
  { id: 'grey', label: 'Grey' },
  { id: 'white', label: 'White' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
]

function shareCardBgHex(id: ShareCardColorId | undefined): string {
  const found = SHARE_CARD_COLOR_PRESETS.find((p) => p.id === id)
  return found?.bg || SHARE_CARD_COLOR_PRESETS.find((p) => p.id === 'yellow')?.bg || '#F5B800'
}

function shareCardPreset(id: ShareCardColorId | undefined) {
  return (
    SHARE_CARD_COLOR_PRESETS.find((p) => p.id === id) ||
    SHARE_CARD_COLOR_PRESETS.find((p) => p.id === 'yellow') ||
    SHARE_CARD_COLOR_PRESETS[0]
  )
}

function shareTextPreset(color: ShareTextColorId | undefined) {
  return (
    SHARE_TEXT_COLOR_PRESETS.find((p) => p.id === color) ||
    SHARE_TEXT_COLOR_PRESETS.find((p) => p.id === 'black') ||
    SHARE_TEXT_COLOR_PRESETS[0]
  )
}

function shareTextFillColor(color: ShareTextColorId | undefined): string {
  return shareTextPreset(color).hex
}

function shareTextMutedColor(color: ShareTextColorId | undefined): string {
  return shareTextPreset(color).muted
}

function shareTextSoftColor(color: ShareTextColorId | undefined): string {
  return shareTextPreset(color).soft
}

/** Parse #RGB / #RRGGBB → [r,g,b] or null. */
function parseHexRgb(hex: string): [number, number, number] | null {
  const raw = String(hex || '').replace('#', '').trim()
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  if (full.length !== 6) return null
  const n = parseInt(full, 16)
  if (!Number.isFinite(n)) return null
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.min(255, Math.max(0, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Lift a hex toward white by `amount` (0–1). */
function lightenHex(hex: string, amount: number): string {
  const rgb = parseHexRgb(hex)
  if (!rgb) return hex
  const a = Math.min(1, Math.max(0, amount))
  return rgbToHex(
    rgb[0] + (255 - rgb[0]) * a,
    rgb[1] + (255 - rgb[1]) * a,
    rgb[2] + (255 - rgb[2]) * a,
  )
}

/** Push a hex toward black by `amount` (0–1). */
function darkenHex(hex: string, amount: number): string {
  const rgb = parseHexRgb(hex)
  if (!rgb) return hex
  const a = Math.min(1, Math.max(0, amount))
  return rgbToHex(rgb[0] * (1 - a), rgb[1] * (1 - a), rgb[2] * (1 - a))
}

/**
 * Soften pure void / ink blacks into a faded charcoal for digital-bg overlays.
 * Keeps a little color so the veil isn’t a flat pure-black plate.
 */
function softenBlackCardHex(hex: string): string {
  const rgb = parseHexRgb(hex)
  if (!rgb) return '#141418'
  const [r, g, b] = rgb
  // Already soft enough
  if (r + g + b > 60) return hex
  // Lift pure blacks toward a warm-neutral faded black
  return rgbToHex(Math.max(r, 18), Math.max(g, 18), Math.max(b, 22))
}

/** Relative luminance — true when bg needs light text / light chrome. */
function isDarkHex(hex: string): boolean {
  const rgb = parseHexRgb(hex)
  if (!rgb) return false
  const [r, g, b] = rgb
  // sRGB relative luminance
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L < 0.42
}

/** WCAG-ish contrast ratio between two hex colors (1–21). */
function hexContrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const rgb = parseHexRgb(hex)
    if (!rgb) return 0
    const lin = (c: number) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  }
  const L1 = lum(hexA)
  const L2 = lum(hexB)
  const lighter = Math.max(L1, L2)
  const darker = Math.min(L1, L2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Only for *corrupt* prefs on load: true white-on-white / black-on-black.
 * Never override an explicit user pick at render time (Coffee / White / etc.).
 */
function ensureShareTextColorId(
  cardColor: ShareCardColorId | undefined,
  textColor: ShareTextColorId | undefined,
): ShareTextColorId {
  const card = shareCardPreset(cardColor)
  const candidate =
    SHARE_TEXT_COLOR_PRESETS.some((p) => p.id === textColor)
      ? (String(textColor) as ShareTextColorId)
      : card.defaultText
  const bg = shareCardBgHex(card.id)
  const fg = shareTextFillColor(candidate)
  // ~1.0–1.3 = effectively invisible; leave intentional low-contrast picks alone
  if (hexContrastRatio(bg, fg) < 1.25) {
    return card.defaultText
  }
  return candidate
}

function hexToRgba(hex: string, alpha: number): string {
  const rgb = parseHexRgb(hex)
  if (!rgb) return `rgba(0,0,0,${alpha})`
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`
}

/** Named faces for share-card type (maps to CSS / Google Sans Flex weights). */
type ShareFontWeight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold'

/** Live-editable share-card layout (tweet preview sliders). */
type ShareCardStyle = {
  /** Space between company/logo header and chart */
  gapBeforeChart: number
  /** Space between chart and reason */
  gapAfterChart: number
  logoSize: number
  nameFontSize: number
  pctFontSize: number
  priceFontSize: number
  /** CSS font-weight for share price (100–900). Default 600. */
  priceFontWeight: number
  /** Share price text color */
  priceColor: ShareTextColorId
  /** Main card background */
  cardColor: ShareCardColorId
  /** Title, reason, brand, stamp body text */
  textColor: ShareTextColorId
  /**
   * Green shade for positive % + chart line (0–4).
   * Forest · Deep · Classic · Bright · Lime
   */
  upColorShade: ShareMoveShadeId
  /**
   * Red shade for negative % + chart line (0–4).
   * Burgundy · Crimson · Classic · Coral · Rose
   */
  downColorShade: ShareMoveShadeId
  /** Left/right content padding (px at 1080 width) */
  imagePadding: number
  /** Top padding above logo / title band */
  headerPadding: number
  /** Bottom padding below footer (date + Track at Trigger) */
  footerPadding: number
  stampFontSize: number
  reasonFontSize: number
  /**
   * Font weights (Google Sans Flex): light 300 · regular 400 · medium 500 ·
   * semibold 600 · bold 700 · extrabold 800
   * Legacy nameBold / reasonBold / sessionBold / brandBold still migrate on load.
   */
  nameWeight: ShareFontWeight
  reasonWeight: ShareFontWeight
  sessionWeight: ShareFontWeight
  brandWeight: ShareFontWeight
  /** @deprecated use nameWeight */
  nameBold?: boolean
  /** @deprecated use reasonWeight */
  reasonBold?: boolean
  /** @deprecated use sessionWeight */
  sessionBold?: boolean
  /** @deprecated use brandWeight */
  brandBold?: boolean
  /** Session first-line font size (px @ 1080w; scales with canvas width). */
  sessionFontSize: number
  /** Space above the session line (after chart / before headline). */
  sessionMarginTop: number
  /** Space below session block (after stamp if any → before reason). */
  sessionMarginBottom: number
  /** Gap between session line and the “Today · time” stamp under it. */
  sessionStampGap: number
  /**
   * Gap between the timestamp (under session) and the reason body.
   * Only used when session headline is on and stamp sits under it.
   */
  stampReasonGap: number
  /** Line-height multiplier for multi-line session text (1.0–1.6). */
  sessionLineHeight: number
  /** Space below reason body → before “Track at Trigger” footer. */
  reasonMarginBottom: number
  /** Extra space above the Track at Trigger row (added on top of reason gap). */
  brandMarginTop: number
  /** Space below Track at Trigger row before the card bottom edge. */
  brandMarginBottom: number
  /** “Track at Trigger” brand text size (px @ 1080w). */
  brandFontSize: number
  /**
   * Vertical scale for “Track at Trigger” text (1 = natural font height).
   * 0.6–2.0; stretches only height so width stays from brandFontSize.
   */
  brandHeightScale: number
  /** Show / hide the “Track at Trigger” footer text. */
  showBrand: boolean
  /**
   * Footer brand position on the card:
   * - left = bottom-left
   * - right = bottom-right (default)
   * - center = bottom-center
   */
  brandPlacement: 'left' | 'right' | 'center'
  /** Show company name vs ticker symbol as the title */
  titleMode: 'company' | 'ticker'
  /**
   * Share price under the big % change (header right).
   * On by default; turn off to drop $price from the image.
   */
  showSharePrice: boolean
  /**
   * First Gemini headline line (“… so far in regular trading” / “in pre-market…”):
   * on by default; turn off to drop it from the image.
   */
  showSessionHeadline: boolean
  /**
   * Session first-line tone (magnitude-aware variants):
   * classic · intensity · breaking · punchy
   */
  sessionLineTone: 'classic' | 'intensity' | 'breaking' | 'punchy'
  /**
   * “Track at Trigger” brand COLOR (not weight):
   * - auto = follow body text color
   * - dark / light = force black or white brand
   */
  brandTone: 'auto' | 'dark' | 'light'
  /**
   * Prefer a squarish card (compress vertical gaps when the layout would be very tall).
   * On by default. Combined with aspectRatio target.
   */
  preferSquare: boolean
  /**
   * Canvas width in px (export size). Default 1920 (Full HD).
   * Design tokens are authored @ 1080 and scale with width.
   */
  canvasWidth: number
  /**
   * Target height ÷ width.
   * 1.0 = square · lower = wider · higher = taller.
   * Used when preferSquare is on (layout pads/compresses toward this).
   */
  aspectRatio: number
  /** Where the date + time is drawn when session headline is off. */
  timestampPlacement: 'footer-left' | 'price-right'
  /**
   * Date + time stamp on the card (under session, footer, or beside price).
   * On by default; turn off to drop it from the image.
   */
  showTimestamp: boolean
  /** Legacy preference retained only so older saved settings can be migrated. */
  dateInFooter?: boolean
  /** Hero photo (replaces chart slot; chart draws below). Height in px @ 1080w. */
  photoHeight: number
  /** Corner radius of the hero photo frame */
  photoRadius: number
  /** Outer border width on the photo */
  photoBorderWidth: number
  /** Horizontal inset of photo from content edges (extra padding L/R) */
  photoMarginX: number
  /** Space above the photo (after header → photo gap) */
  photoMarginTop: number
  /** Space between photo bottom and the line chart */
  photoMarginBottom: number
  /** 0–100 frosted inset rim strength */
  photoFrost: number
  /**
   * How opaque the digital background image is (0 = invisible · 100 = full).
   * Full-bleed under content.
   */
  bgImageOpacity: number
  /**
   * Background photo blur in px (0 = crisp / sharp · 80 = heavy soft fade).
   * Lower = clearer image for social posts.
   */
  bgBlur: number
  /**
   * Black axis over the background image (−100 … +100).
   * −100 = lift shadows / less black · 0 = neutral · +100 = heavy black veil.
   * @deprecated use bgBlack (migrated on load)
   */
  bgBlackFade?: number
  /** Black axis (−100 … +100) — see above. */
  bgBlack: number
  /**
   * White axis over the background image (−100 … +100).
   * −100 = crush highlights · 0 = neutral · +100 = white / bright wash.
   */
  bgWhite: number
  /** @deprecated frame plate removed; kept for old prefs */
  bgFrameEnabled?: boolean
  /** @deprecated */
  bgFrameMargin?: number
  /** @deprecated */
  bgFrameRadius?: number
  /** @deprecated */
  bgFrameFill?: number
  /**
   * How the pasted image is used on the card:
   * - background: full-card digital backdrop only (default — no hero above/below header)
   * - above-header / below-header / below-chart: framed hero slot (legacy)
   */
  photoPlacement: 'background' | 'above-header' | 'below-header' | 'below-chart'
  /**
   * How many trading sessions to show on the line chart (ending on event day).
   * 1 = today only · 2 = yesterday+today · 3 · 5
   */
  chartSessionDays: ShareChartSessionDays
  /** Yahoo bar interval for chart pricing (1m · 2m · 5m · …). */
  chartInterval: ShareChartInterval
  /** Price-line stroke width on the share chart (canvas px, 1–24). */
  chartLineWidth: number
  /**
   * Plot area height for the line chart (design px @ 1080, before axis labels).
   * Taller = more “zoomed” vertical moves / longer chart block.
   */
  chartPlotHeight: number
  /**
   * Trim chart from the left (0–90%). End is always event/stamp time.
   * 0 = full selected session range · 50 = start halfway through · …
   */
  chartVisibleStartPct: number
  /** Show time ticks under the chart (0m / 9:30 AM…). */
  showChartTimeAxis: boolean
  /**
   * Show calendar day labels under the chart (Today · 5 Aug).
   * Useful for multi-day session ranges.
   */
  showChartDayLabels: boolean
  /** Extra space (px) between time ticks and day labels. */
  chartTimeDayGap: number
  /**
   * Day label wording:
   * today-long / today-short = Today + calendar dates
   * date-long / date-short = always calendar dates
   * relative / relative-short = Today · Yesterday · Back · …
   */
  chartDayLabelMode: ShareChartDayLabelMode
  /**
   * Chart x-axis labels:
   * - elapsed = “0m · 15m · 1h …” from session open
   * - timestamp = wall clock “9:30 AM · 10:00 AM …”
   */
  chartAxisMode: 'elapsed' | 'timestamp'
  /** Timezone for timestamp-mode axis (and stamp display when absolute). */
  chartAxisTimezone: ShareChartTimezone
  /**
   * How many x-axis labels under the chart (including start + end).
   * Range 3–10; default 5.
   */
  chartAxisLabelCount: number
  /**
   * Markers on the line chart:
   * off · price · percent · both (% above, price below)
   */
  chartPointLabelMode: ShareChartPointLabelMode
  /** @deprecated use chartPointLabelMode */
  showChartPriceLabels?: boolean
  /**
   * How many points on the chart (3–8), including first + last.
   * Only used when chartPointLabelMode is not off.
   */
  chartPriceLabelCount: number
  /**
   * Custom time-axis labels under the chart (one per line).
   * Empty = auto (elapsed / clock). Extra lines ignored; missing = keep auto for that slot.
   */
  chartAxisLabelsCustom: string
  /**
   * Custom labels on the line (one per line, top / primary).
   * Empty = auto price or % from data.
   */
  chartPointLabelsCustom: string
  /**
   * When mode is both: custom bottom labels (prices), one per line.
   * Empty = auto $ price under each %.
   */
  chartPointSubLabelsCustom: string
  /** Font size for time-axis labels under the chart (px @ 1080w). */
  chartAxisFontSize: number
  /** Font size for price / % labels on the line (px @ 1080w). */
  chartPointFontSize: number
  /** App Store + Play icons next to “Track at Trigger”. */
  showStoreBadges: boolean
  /** circle = both store icons · badge = App Store badge only */
  storeBadgeStyle: 'circle' | 'badge'
  /** Store icon / badge height (px @ 1080w). */
  storeIconSize: number
  /**
   * Horizontal scale for store icons / badge (1 = natural width from height × aspect).
   * 0.5–2.0; lets width be tuned independently of height.
   */
  storeIconWidthScale: number
  /**
   * Rubber “thappa” stamp over the card (breaking / exploding feel).
   * off · auto (≥10% or breaking tone) · on
   */
  newsStampMode: 'off' | 'auto' | 'on'
  /** Stamp wording preset; auto picks from move direction + size. */
  newsStampKind: 'auto' | 'breaking' | 'exploding' | 'surge' | 'crash' | 'alert'
  /**
   * Custom center lines (newline-separated). Empty = use kind preset.
   * e.g. "BREAKING\nNEWS" or "EXPLODING"
   */
  newsStampCenterText: string
  /** Custom ring arc text. Empty = use kind preset (e.g. FLASH ALERT). */
  newsStampRingText: string
  /** Ink color id (family shade, e.g. red-crimson · black-ink · gold · auto). */
  newsStampColor: string
  /**
   * Stamp look:
   * - circle = double-ring seal (top/bottom arc text + center banner)
   * - rect = rectangular CERTIFIED-style box stamp
   */
  newsStampStyle: 'circle' | 'rect'
  /** Horizontal position 0–100 (% of card width). 50 = center. */
  newsStampX: number
  /** Vertical position 0–100 (% of card height). 42 ≈ upper-mid. */
  newsStampY: number
  /** Dotted / grain density 0–100 (sparse → dense). */
  newsStampDotDensity: number
  /** Stamp diameter in px @ 1080w (size / scale). */
  newsStampSize: number
  /** Rotation in degrees (negative = classic rubber-stamp tilt). */
  newsStampRotation: number
  /** 0–100 overall opacity / fade. */
  newsStampOpacity: number
}

/** Zones offered for absolute chart timestamps. */
type ShareChartTimezone =
  | 'America/New_York'
  | 'Europe/London'
  | 'Asia/Kolkata'
  | 'UTC'

const SHARE_CHART_TIMEZONES: Array<{
  id: ShareChartTimezone
  label: string
  short: string
}> = [
  { id: 'America/New_York', label: 'US Eastern (ET)', short: 'ET' },
  { id: 'Europe/London', label: 'UK (London)', short: 'UK' },
  { id: 'Asia/Kolkata', label: 'India (IST)', short: 'IST' },
  { id: 'UTC', label: 'UTC', short: 'UTC' },
]

/** Short zone label for stamps / axis: EDT, EST, GMT, BST, IST, UTC, … */
function shareTimezoneAbbrev(
  tz: string | undefined,
  atMs: number = Date.now(),
): string {
  const zone = String(tz || '').trim() || EXCHANGE_TZ_FALLBACK
  if (zone === 'Asia/Kolkata' || zone === 'Asia/Calcutta') return 'IST'
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC'
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(new Date(atMs))
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    if (zone === 'America/New_York') {
      if (raw === 'EDT' || raw === 'EST') return raw
      if (/GMT-4|UTC-4|UTC−4/i.test(raw)) return 'EDT'
      if (/GMT-5|UTC-5|UTC−5/i.test(raw)) return 'EST'
      const m = new Date(atMs).getUTCMonth()
      return m >= 2 && m <= 9 ? 'EDT' : 'EST'
    }
    if (zone === 'Europe/London') {
      if (raw === 'BST' || raw === 'GMT') return raw
      if (/GMT\+1|UTC\+1|UTC\+01/i.test(raw)) return 'BST'
      if (/GMT\+0|UTC\+0|UTC$|GMT$/i.test(raw)) return 'GMT'
      const m = new Date(atMs).getUTCMonth()
      return m >= 2 && m <= 9 ? 'BST' : 'GMT'
    }
    if (raw && !/^GMT[+-]/i.test(raw) && !/^UTC[+-]/i.test(raw)) return raw
    if (raw) return raw
  } catch {
    /* fall through */
  }
  return SHARE_CHART_TIMEZONES.find((z) => z.id === zone)?.short || 'ET'
}

/** Append / replace trailing zone token so “3:33 PM” → “3:33 PM ET”. */
function withTimezoneSuffix(text: string, abbrev: string): string {
  const s = String(text || '').trim()
  if (!s || !abbrev) return s
  const stripped = s
    .replace(
      /\s+\b(ET|EST|EDT|GMT|BST|IST|UTC|UK|GMT[+-][\d:]+|UTC[+-][\d:]+)\b\s*$/i,
      '',
    )
    .trim()
  return `${stripped} ${abbrev}`
}

/**
 * Parse event.time_label as US/Eastern wall time on event_date → UTC ms.
 * Used to re-show the clock in another zone.
 */
function eventEasternWallTimeToUtcMs(
  event: Pick<PriceMovementEvent, 'event_date' | 'time_label'>,
): number | null {
  const dateKey = String(event.event_date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  const mins = parseShareStampCutoffMinutes(event, event.time_label)
  if (mins == null) return null
  const h = Math.floor(mins / 60)
  const m = mins % 60
  // Guess UTC then refine so America/New_York wall matches (handles EDT/EST).
  let utc = Date.parse(
    `${dateKey}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`,
  )
  if (!Number.isFinite(utc)) return null
  for (let i = 0; i < 4; i += 1) {
    const et = etPartsFromMs(utc)
    // etParts dateKey uses en-US month/day; normalize
    const wantDate = dateKey
    const gotDate = et.dateKey
    // et.dateKey is YYYY-MM-DD from our helper
    const deltaMin = (h * 60 + m) - et.minutesFromMidnight
    // Also correct day slip
    let dayDelta = 0
    if (gotDate !== wantDate) {
      const wantT = Date.parse(`${wantDate}T12:00:00Z`)
      const gotT = Date.parse(`${gotDate}T12:00:00Z`)
      dayDelta = Math.round((wantT - gotT) / 86400000) * 24 * 60
    }
    const adj = (deltaMin + dayDelta) * 60 * 1000
    if (adj === 0) break
    utc += adj
  }
  return utc
}

const SHARE_FONT_WEIGHT_OPTIONS: Array<{ id: ShareFontWeight; label: string; css: number }> = [
  { id: 'light', label: 'Light', css: 300 },
  { id: 'regular', label: 'Regular', css: 400 },
  { id: 'medium', label: 'Medium', css: 500 },
  { id: 'semibold', label: 'SemiBold', css: 600 },
  { id: 'bold', label: 'Bold', css: 700 },
  { id: 'extrabold', label: 'ExtraBold', css: 800 },
]

function shareFontWeightCss(w: ShareFontWeight | undefined, fallback: ShareFontWeight): number {
  const id = w && SHARE_FONT_WEIGHT_OPTIONS.some((o) => o.id === w) ? w : fallback
  return SHARE_FONT_WEIGHT_OPTIONS.find((o) => o.id === id)?.css ?? 400
}

function parseShareFontWeight(
  value: unknown,
  legacyBold: boolean | undefined,
  whenTrue: ShareFontWeight,
  whenFalse: ShareFontWeight,
): ShareFontWeight {
  if (typeof value === 'string' && SHARE_FONT_WEIGHT_OPTIONS.some((o) => o.id === value)) {
    return value as ShareFontWeight
  }
  if (legacyBold === true) return whenTrue
  if (legacyBold === false) return whenFalse
  return whenFalse
}

/**
 * Defaults mirror mobile share-card design tokens
 * (Google Sans Flex / AppFont · 1080-wide canvas).
 */
const DEFAULT_SHARE_CARD_STYLE: ShareCardStyle = {
  gapBeforeChart: 8,
  gapAfterChart: 40,
  logoSize: 86,
  nameFontSize: 56, // company ExtraBold
  pctFontSize: 80, // % Bold
  priceFontSize: 36, // price SemiBold
  priceFontWeight: 600,
  priceColor: 'black',
  cardColor: 'yellow',
  textColor: 'black',
  upColorShade: 2,
  downColorShade: 2,
  imagePadding: 44,
  headerPadding: 56,
  footerPadding: 40,
  stampFontSize: 34, // reasonWhen Medium
  reasonFontSize: 40, // reasonDriver Regular
  nameWeight: 'extrabold',
  reasonWeight: 'regular',
  sessionWeight: 'semibold',
  brandWeight: 'medium',
  sessionFontSize: 52, // reasonTitle SemiBold
  sessionMarginTop: 8,
  sessionMarginBottom: 28,
  sessionStampGap: 14,
  stampReasonGap: 28,
  sessionLineHeight: 66 / 52, // 66 line-height @ 52 size
  reasonMarginBottom: 56, // gap reason → Track at Trigger
  brandMarginTop: 0,
  brandMarginBottom: 40,
  brandFontSize: 28, // footerBrand
  brandHeightScale: 1,
  showBrand: true,
  brandPlacement: 'right',
  titleMode: 'company',
  showSharePrice: true,
  showSessionHeadline: true,
  sessionLineTone: 'classic',
  brandTone: 'auto',
  preferSquare: true,
  canvasWidth: 1920, // Full HD export width (design tokens scale from 1080)
  aspectRatio: 1.05,
  timestampPlacement: 'footer-left',
  showTimestamp: true,
  photoHeight: 360,
  photoRadius: 28,
  photoBorderWidth: 3,
  photoMarginX: 0,
  photoMarginTop: 0,
  photoMarginBottom: 20,
  photoFrost: 55,
  bgImageOpacity: 100,
  /** 0 = sharp social-ready image (default); raise only for soft glass look */
  bgBlur: 0,
  /** Neutral black axis so photo is not pre-faded */
  bgBlack: 0,
  bgWhite: 0,
  photoPlacement: 'background',
  chartSessionDays: 2,
  chartInterval: '1m',
  chartLineWidth: 4,
  chartPlotHeight: 300,
  chartVisibleStartPct: 0,
  showChartTimeAxis: true,
  showChartDayLabels: true,
  chartTimeDayGap: 14,
  chartDayLabelMode: 'today-long',
  chartAxisMode: 'elapsed',
  chartAxisTimezone: 'America/New_York',
  chartAxisLabelCount: 5,
  chartPointLabelMode: 'off',
  chartPriceLabelCount: 4,
  chartAxisLabelsCustom: '',
  chartPointLabelsCustom: '',
  chartPointSubLabelsCustom: '',
  chartAxisFontSize: 18,
  chartPointFontSize: 16,
  showStoreBadges: true,
  storeBadgeStyle: 'circle',
  storeIconSize: 36,
  storeIconWidthScale: 1,
  newsStampMode: 'auto',
  newsStampKind: 'auto',
  newsStampCenterText: '',
  newsStampRingText: '',
  newsStampColor: 'red',
  newsStampStyle: 'circle',
  newsStampX: 50,
  newsStampY: 42,
  newsStampDotDensity: 55,
  newsStampSize: 280,
  newsStampRotation: -14,
  newsStampOpacity: 88,
}

/**
 * Typeface: local Google Sans Flex (public/fonts/GoogleSansFlex/*_36pt-*.ttf)
 * — same family as the mobile AppFont / Google Sans Flex design system.
 */
const SHARE_FONT_FAMILY =
  '"Google Sans Flex", "Google Sans", "Inter", "SF Pro Display", "Segoe UI", system-ui, sans-serif'

/** Weight → static file under /fonts/GoogleSansFlex/ (36pt optical size). */
const SHARE_GSF_FILES: Array<{ weight: number; file: string }> = [
  { weight: 100, file: 'GoogleSansFlex_36pt-Thin.ttf' },
  { weight: 200, file: 'GoogleSansFlex_36pt-ExtraLight.ttf' },
  { weight: 300, file: 'GoogleSansFlex_36pt-Light.ttf' },
  { weight: 400, file: 'GoogleSansFlex_36pt-Regular.ttf' },
  { weight: 500, file: 'GoogleSansFlex_36pt-Medium.ttf' },
  { weight: 600, file: 'GoogleSansFlex_36pt-SemiBold.ttf' },
  { weight: 700, file: 'GoogleSansFlex_36pt-Bold.ttf' },
  { weight: 800, file: 'GoogleSansFlex_36pt-ExtraBold.ttf' },
  { weight: 900, file: 'GoogleSansFlex_36pt-Black.ttf' },
]

let shareFontsLoadPromise: Promise<void> | null = null

async function ensureShareFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined') return
  if (shareFontsLoadPromise) return shareFontsLoadPromise

  shareFontsLoadPromise = (async () => {
    try {
      // Explicit FontFace load so canvas does not paint with a fallback mid-frame
      if (typeof FontFace !== 'undefined') {
        await Promise.all(
          SHARE_GSF_FILES.map(async ({ weight, file }) => {
            const face = new FontFace(
              'Google Sans Flex',
              `url(/fonts/GoogleSansFlex/${file})`,
              { weight: String(weight), style: 'normal' },
            )
            const loaded = await face.load()
            document.fonts.add(loaded)
          }),
        )
      }
      if (document.fonts?.load) {
        await Promise.all([
          document.fonts.load(`300 40px "Google Sans Flex"`),
          document.fonts.load(`400 40px "Google Sans Flex"`),
          document.fonts.load(`500 28px "Google Sans Flex"`),
          document.fonts.load(`500 34px "Google Sans Flex"`),
          document.fonts.load(`600 36px "Google Sans Flex"`),
          document.fonts.load(`600 52px "Google Sans Flex"`),
          document.fonts.load(`700 32px "Google Sans Flex"`),
          document.fonts.load(`800 56px "Google Sans Flex"`),
          document.fonts.load(`800 80px "Google Sans Flex"`),
          document.fonts.load(`900 56px "Google Sans Flex"`),
        ])
        await document.fonts.ready
      }
    } catch (err) {
      console.warn('[share] Google Sans Flex load failed; falling back', err)
    }
  })()

  return shareFontsLoadPromise
}

function shareFont(weight: number, sizePx: number, extra = ''): string {
  const w = Math.min(900, Math.max(100, Math.round(weight)))
  const extras = extra ? ` ${extra}` : ''
  return `${w}${extras} ${sizePx}px ${SHARE_FONT_FAMILY}`
}

/** Apply RN-style letterSpacing (px) on canvas when supported. */
function setShareLetterSpacing(ctx: CanvasRenderingContext2D, px: number) {
  try {
    // Canvas letterSpacing is CSS length; RN tokens are px
    ;(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${px}px`
  } catch {
    /* older engines ignore */
  }
}

function clearShareLetterSpacing(ctx: CanvasRenderingContext2D) {
  setShareLetterSpacing(ctx, 0)
}

const SHARE_CARD_STYLE_PREF_KEY = 'share-card-style-v1'
/** One-time bump of legacy 1080 exports → Full HD 1920. */
const SHARE_CARD_FHD_MIGRATION_KEY = 'share-card-fhd-migrated-v1'

function loadShareCardStyle(): ShareCardStyle {
  try {
    const raw = readPref(SHARE_CARD_STYLE_PREF_KEY)
    if (!raw) return { ...DEFAULT_SHARE_CARD_STYLE }
    const parsed = JSON.parse(raw) as Partial<ShareCardStyle>
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SHARE_CARD_STYLE }
    const priceColor = SHARE_TEXT_COLOR_PRESETS.some((p) => p.id === parsed.priceColor)
      ? String(parsed.priceColor)
      : DEFAULT_SHARE_CARD_STYLE.priceColor
    const cardColor = SHARE_CARD_COLOR_PRESETS.some((p) => p.id === parsed.cardColor)
      ? String(parsed.cardColor)
      : DEFAULT_SHARE_CARD_STYLE.cardColor
    const textColor = ensureShareTextColorId(
      cardColor,
      SHARE_TEXT_COLOR_PRESETS.some((p) => p.id === parsed.textColor)
        ? String(parsed.textColor)
        : DEFAULT_SHARE_CARD_STYLE.textColor,
    )
    const titleMode = parsed.titleMode === 'ticker' ? 'ticker' : 'company'
    const brandTone =
      parsed.brandTone === 'dark' || parsed.brandTone === 'light' ? parsed.brandTone : 'auto'
    const showSessionHeadline =
      parsed.showSessionHeadline === undefined ? true : Boolean(parsed.showSessionHeadline)
    const showSharePrice =
      parsed.showSharePrice === undefined ? true : Boolean(parsed.showSharePrice)
    const showBrand = parsed.showBrand === undefined ? true : Boolean(parsed.showBrand)
    const showTimestamp =
      parsed.showTimestamp === undefined ? true : Boolean(parsed.showTimestamp)
    const sessionLineTone: ShareSessionLineTone =
      parsed.sessionLineTone === 'intensity' ||
      parsed.sessionLineTone === 'breaking' ||
      parsed.sessionLineTone === 'punchy' ||
      parsed.sessionLineTone === 'classic'
        ? parsed.sessionLineTone
        : DEFAULT_SHARE_CARD_STYLE.sessionLineTone
    const preferSquare =
      parsed.preferSquare === undefined ? true : Boolean(parsed.preferSquare)
    const nameWeight = parseShareFontWeight(
      parsed.nameWeight,
      parsed.nameBold,
      'extrabold',
      'extrabold',
    )
    const reasonWeight = parseShareFontWeight(
      parsed.reasonWeight,
      parsed.reasonBold,
      'bold',
      'regular',
    )
    const sessionWeight = parseShareFontWeight(
      parsed.sessionWeight,
      parsed.sessionBold,
      'extrabold',
      'semibold',
    )
    const brandWeight = parseShareFontWeight(
      parsed.brandWeight,
      parsed.brandBold,
      'bold',
      'medium',
    )
    const clampSessionPx = (raw: number, min: number, max: number, fallback: number) =>
      Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.round(raw))) : fallback
    const sessionFontSize = clampSessionPx(
      Number(parsed.sessionFontSize),
      18,
      160,
      DEFAULT_SHARE_CARD_STYLE.sessionFontSize,
    )
    const sessionMarginTop = clampSessionPx(
      Number(parsed.sessionMarginTop),
      0,
      120,
      DEFAULT_SHARE_CARD_STYLE.sessionMarginTop,
    )
    const sessionMarginBottom = clampSessionPx(
      Number(parsed.sessionMarginBottom),
      0,
      160,
      DEFAULT_SHARE_CARD_STYLE.sessionMarginBottom,
    )
    const sessionStampGap = clampSessionPx(
      Number(parsed.sessionStampGap),
      0,
      80,
      DEFAULT_SHARE_CARD_STYLE.sessionStampGap,
    )
    const stampReasonGap = clampSessionPx(
      Number(parsed.stampReasonGap),
      0,
      160,
      DEFAULT_SHARE_CARD_STYLE.stampReasonGap,
    )
    const reasonMarginBottom = clampSessionPx(
      Number(parsed.reasonMarginBottom),
      0,
      200,
      DEFAULT_SHARE_CARD_STYLE.reasonMarginBottom,
    )
    const brandMarginTop = clampSessionPx(
      Number(parsed.brandMarginTop),
      0,
      120,
      DEFAULT_SHARE_CARD_STYLE.brandMarginTop,
    )
    const brandMarginBottom = clampSessionPx(
      Number(parsed.brandMarginBottom),
      0,
      160,
      DEFAULT_SHARE_CARD_STYLE.brandMarginBottom,
    )
    const brandFontSize = clampSessionPx(
      Number(parsed.brandFontSize),
      14,
      64,
      DEFAULT_SHARE_CARD_STYLE.brandFontSize,
    )
    const rawBrandHScale = Number(parsed.brandHeightScale)
    const brandHeightScale =
      Number.isFinite(rawBrandHScale) && rawBrandHScale >= 0.5 && rawBrandHScale <= 2.5
        ? Math.round(rawBrandHScale * 100) / 100
        : DEFAULT_SHARE_CARD_STYLE.brandHeightScale
    const brandPlacement =
      parsed.brandPlacement === 'left' ||
      parsed.brandPlacement === 'right' ||
      parsed.brandPlacement === 'center'
        ? parsed.brandPlacement
        : DEFAULT_SHARE_CARD_STYLE.brandPlacement
    const chartSessionDays = clampShareChartSessionDays(
      parsed.chartSessionDays ?? DEFAULT_SHARE_CARD_STYLE.chartSessionDays,
    )
    const chartInterval = clampShareChartInterval(
      parsed.chartInterval ?? DEFAULT_SHARE_CARD_STYLE.chartInterval,
    )
    const rawLineW = Number(parsed.chartLineWidth)
    const chartLineWidth =
      Number.isFinite(rawLineW) && rawLineW > 0
        ? Math.min(24, Math.max(1, Math.round(rawLineW * 10) / 10))
        : DEFAULT_SHARE_CARD_STYLE.chartLineWidth
    const rawPlotH = Number(parsed.chartPlotHeight)
    const chartPlotHeight =
      Number.isFinite(rawPlotH) && rawPlotH > 0
        ? Math.min(700, Math.max(140, Math.round(rawPlotH)))
        : DEFAULT_SHARE_CARD_STYLE.chartPlotHeight
    const rawStartPct = Number(parsed.chartVisibleStartPct)
    const chartVisibleStartPct =
      Number.isFinite(rawStartPct) && rawStartPct >= 0
        ? Math.min(90, Math.max(0, Math.round(rawStartPct)))
        : DEFAULT_SHARE_CARD_STYLE.chartVisibleStartPct
    const showChartTimeAxis =
      parsed.showChartTimeAxis === undefined
        ? DEFAULT_SHARE_CARD_STYLE.showChartTimeAxis
        : Boolean(parsed.showChartTimeAxis)
    const showChartDayLabels =
      parsed.showChartDayLabels === undefined
        ? DEFAULT_SHARE_CARD_STYLE.showChartDayLabels
        : Boolean(parsed.showChartDayLabels)
    const rawTimeDayGap = Number(parsed.chartTimeDayGap)
    const chartTimeDayGap =
      Number.isFinite(rawTimeDayGap) && rawTimeDayGap >= 0
        ? Math.min(100, Math.max(0, Math.round(rawTimeDayGap)))
        : DEFAULT_SHARE_CARD_STYLE.chartTimeDayGap
    const chartDayLabelMode = clampShareChartDayLabelMode(
      parsed.chartDayLabelMode ?? DEFAULT_SHARE_CARD_STYLE.chartDayLabelMode,
    )
    const chartAxisMode =
      parsed.chartAxisMode === 'timestamp' || parsed.chartAxisMode === 'elapsed'
        ? parsed.chartAxisMode
        : DEFAULT_SHARE_CARD_STYLE.chartAxisMode
    const chartAxisTimezone = SHARE_CHART_TIMEZONES.some(
      (z) => z.id === parsed.chartAxisTimezone,
    )
      ? (parsed.chartAxisTimezone as ShareChartTimezone)
      : DEFAULT_SHARE_CARD_STYLE.chartAxisTimezone
    const rawLabelCount = Number(parsed.chartAxisLabelCount)
    const chartAxisLabelCount =
      Number.isFinite(rawLabelCount) && rawLabelCount >= 3 && rawLabelCount <= 10
        ? Math.round(rawLabelCount)
        : DEFAULT_SHARE_CARD_STYLE.chartAxisLabelCount
    let chartPointLabelMode: ShareChartPointLabelMode =
      parsed.chartPointLabelMode === 'price' ||
      parsed.chartPointLabelMode === 'percent' ||
      parsed.chartPointLabelMode === 'both' ||
      parsed.chartPointLabelMode === 'off'
        ? parsed.chartPointLabelMode
        : DEFAULT_SHARE_CARD_STYLE.chartPointLabelMode
    // Migrate legacy boolean
    if (
      parsed.chartPointLabelMode === undefined &&
      parsed.showChartPriceLabels !== undefined
    ) {
      chartPointLabelMode = parsed.showChartPriceLabels ? 'price' : 'off'
    }
    const rawPriceLabelCount = Number(parsed.chartPriceLabelCount)
    const chartPriceLabelCount =
      Number.isFinite(rawPriceLabelCount) &&
      rawPriceLabelCount >= 3 &&
      rawPriceLabelCount <= 8
        ? Math.round(rawPriceLabelCount)
        : DEFAULT_SHARE_CARD_STYLE.chartPriceLabelCount
    const chartAxisLabelsCustom =
      typeof parsed.chartAxisLabelsCustom === 'string'
        ? parsed.chartAxisLabelsCustom.slice(0, 500)
        : ''
    const chartPointLabelsCustom =
      typeof parsed.chartPointLabelsCustom === 'string'
        ? parsed.chartPointLabelsCustom.slice(0, 500)
        : ''
    const chartPointSubLabelsCustom =
      typeof parsed.chartPointSubLabelsCustom === 'string'
        ? parsed.chartPointSubLabelsCustom.slice(0, 500)
        : ''
    const chartAxisFontSize = clampSessionPx(
      Number(parsed.chartAxisFontSize),
      10,
      48,
      DEFAULT_SHARE_CARD_STYLE.chartAxisFontSize,
    )
    const chartPointFontSize = clampSessionPx(
      Number(parsed.chartPointFontSize),
      10,
      48,
      DEFAULT_SHARE_CARD_STYLE.chartPointFontSize,
    )
    const showStoreBadges =
      parsed.showStoreBadges === undefined ? true : Boolean(parsed.showStoreBadges)
    const storeBadgeStyle =
      parsed.storeBadgeStyle === 'badge' || parsed.storeBadgeStyle === 'circle'
        ? parsed.storeBadgeStyle
        : DEFAULT_SHARE_CARD_STYLE.storeBadgeStyle
    const rawStoreSize = Number(parsed.storeIconSize)
    const storeIconSize =
      Number.isFinite(rawStoreSize) && rawStoreSize >= 16 && rawStoreSize <= 96
        ? Math.round(rawStoreSize)
        : DEFAULT_SHARE_CARD_STYLE.storeIconSize
    const rawStoreWScale = Number(parsed.storeIconWidthScale)
    const storeIconWidthScale =
      Number.isFinite(rawStoreWScale) && rawStoreWScale >= 0.5 && rawStoreWScale <= 2.5
        ? Math.round(rawStoreWScale * 100) / 100
        : DEFAULT_SHARE_CARD_STYLE.storeIconWidthScale
    const upColorShade = clampShareMoveShade(
      parsed.upColorShade,
      DEFAULT_SHARE_CARD_STYLE.upColorShade,
    )
    const downColorShade = clampShareMoveShade(
      parsed.downColorShade,
      DEFAULT_SHARE_CARD_STYLE.downColorShade,
    )
    const newsStampMode =
      parsed.newsStampMode === 'off' ||
      parsed.newsStampMode === 'on' ||
      parsed.newsStampMode === 'auto'
        ? parsed.newsStampMode
        : DEFAULT_SHARE_CARD_STYLE.newsStampMode
    const newsStampKind =
      parsed.newsStampKind === 'auto' ||
      parsed.newsStampKind === 'breaking' ||
      parsed.newsStampKind === 'exploding' ||
      parsed.newsStampKind === 'surge' ||
      parsed.newsStampKind === 'crash' ||
      parsed.newsStampKind === 'alert'
        ? parsed.newsStampKind
        : DEFAULT_SHARE_CARD_STYLE.newsStampKind
    const newsStampColor = SHARE_NEWS_STAMP_INK_PRESETS.some(
      (p) => p.id === parsed.newsStampColor,
    )
      ? String(parsed.newsStampColor)
      : DEFAULT_SHARE_CARD_STYLE.newsStampColor
    const newsStampCenterText =
      typeof parsed.newsStampCenterText === 'string'
        ? parsed.newsStampCenterText.slice(0, 120)
        : DEFAULT_SHARE_CARD_STYLE.newsStampCenterText
    const newsStampRingText =
      typeof parsed.newsStampRingText === 'string'
        ? parsed.newsStampRingText.slice(0, 48)
        : DEFAULT_SHARE_CARD_STYLE.newsStampRingText
    const rawStampSize = Number(parsed.newsStampSize)
    const newsStampSize =
      Number.isFinite(rawStampSize) && rawStampSize >= 100 && rawStampSize <= 1000
        ? Math.round(rawStampSize)
        : DEFAULT_SHARE_CARD_STYLE.newsStampSize
    const rawStampRot = Number(parsed.newsStampRotation)
    const newsStampRotation =
      Number.isFinite(rawStampRot) && rawStampRot >= -45 && rawStampRot <= 45
        ? Math.round(rawStampRot)
        : DEFAULT_SHARE_CARD_STYLE.newsStampRotation
    const rawStampOp = Number(parsed.newsStampOpacity)
    const newsStampOpacity =
      Number.isFinite(rawStampOp) && rawStampOp >= 8 && rawStampOp <= 100
        ? Math.round(rawStampOp)
        : DEFAULT_SHARE_CARD_STYLE.newsStampOpacity
    const newsStampStyle =
      parsed.newsStampStyle === 'rect' || parsed.newsStampStyle === 'circle'
        ? parsed.newsStampStyle
        : DEFAULT_SHARE_CARD_STYLE.newsStampStyle
    const rawStampX = Number(parsed.newsStampX)
    const newsStampX =
      Number.isFinite(rawStampX) && rawStampX >= 0 && rawStampX <= 100
        ? Math.round(rawStampX)
        : DEFAULT_SHARE_CARD_STYLE.newsStampX
    const rawStampY = Number(parsed.newsStampY)
    const newsStampY =
      Number.isFinite(rawStampY) && rawStampY >= 0 && rawStampY <= 100
        ? Math.round(rawStampY)
        : DEFAULT_SHARE_CARD_STYLE.newsStampY
    const rawDotDens = Number(parsed.newsStampDotDensity)
    const newsStampDotDensity =
      Number.isFinite(rawDotDens) && rawDotDens >= 0 && rawDotDens <= 100
        ? Math.round(rawDotDens)
        : DEFAULT_SHARE_CARD_STYLE.newsStampDotDensity
    const rawSessionLh = Number(parsed.sessionLineHeight)
    const sessionLineHeight =
      Number.isFinite(rawSessionLh) && rawSessionLh >= 1 && rawSessionLh <= 1.8
        ? Math.round(rawSessionLh * 100) / 100
        : DEFAULT_SHARE_CARD_STYLE.sessionLineHeight
    const rawCanvasW = Number(parsed.canvasWidth)
    const canvasWidth =
      Number.isFinite(rawCanvasW) && rawCanvasW >= 800
        ? Math.min(3840, Math.round(rawCanvasW))
        : DEFAULT_SHARE_CARD_STYLE.canvasWidth
    const rawAspect = Number(parsed.aspectRatio)
    const aspectRatio =
      Number.isFinite(rawAspect) && rawAspect >= 0.75 && rawAspect <= 1.8
        ? Math.round(rawAspect * 100) / 100
        : DEFAULT_SHARE_CARD_STYLE.aspectRatio
    const imagePadding = Number(parsed.imagePadding)
    const sidePad =
      Number.isFinite(imagePadding) && imagePadding >= 16
        ? Math.min(120, Math.round(imagePadding))
        : DEFAULT_SHARE_CARD_STYLE.imagePadding
    // Older saves only had imagePadding (sides + derived top/bottom) — migrate once
    const rawHeader = Number(parsed.headerPadding)
    const rawFooter = Number(parsed.footerPadding)
    const headerPadding =
      Number.isFinite(rawHeader) && rawHeader >= 0
        ? Math.min(200, Math.round(rawHeader))
        : Math.min(200, sidePad + 40)
    const footerPadding =
      Number.isFinite(rawFooter) && rawFooter >= 0
        ? Math.min(200, Math.round(rawFooter))
        : sidePad
    const timestampPlacement =
      parsed.timestampPlacement === 'price-right' ||
      parsed.timestampPlacement === 'footer-left'
        ? parsed.timestampPlacement
        : parsed.dateInFooter === false
          ? 'price-right'
          : 'footer-left'
    let result: ShareCardStyle = {
      ...DEFAULT_SHARE_CARD_STYLE,
      ...parsed,
      priceColor,
      textColor,
      cardColor,
      titleMode,
      brandTone,
      showSessionHeadline,
      showSharePrice,
      showBrand,
      showTimestamp,
      sessionLineTone,
      preferSquare,
      nameWeight,
      reasonWeight,
      sessionWeight,
      brandWeight,
      sessionFontSize,
      sessionMarginTop,
      sessionMarginBottom,
      sessionStampGap,
      stampReasonGap,
      sessionLineHeight,
      reasonMarginBottom,
      brandMarginTop,
      brandMarginBottom,
      brandFontSize,
      brandHeightScale,
      brandPlacement,
      chartSessionDays,
      chartInterval,
      chartLineWidth,
      chartPlotHeight,
      chartVisibleStartPct,
      showChartTimeAxis,
      showChartDayLabels,
      chartTimeDayGap,
      chartDayLabelMode,
      chartAxisMode,
      chartAxisTimezone,
      chartAxisLabelCount,
      chartPointLabelMode,
      chartPriceLabelCount,
      chartAxisLabelsCustom,
      chartPointLabelsCustom,
      chartPointSubLabelsCustom,
      chartAxisFontSize,
      chartPointFontSize,
      showStoreBadges,
      storeBadgeStyle,
      storeIconSize,
      storeIconWidthScale,
      upColorShade,
      downColorShade,
      newsStampMode,
      newsStampKind,
      newsStampCenterText,
      newsStampRingText,
      newsStampColor,
      newsStampStyle,
      newsStampX,
      newsStampY,
      newsStampDotDensity,
      newsStampSize,
      newsStampRotation,
      newsStampOpacity,
      canvasWidth,
      aspectRatio,
      // Booleans / numbers may come partial — re-assert critical fields
      gapBeforeChart: Number(parsed.gapBeforeChart) || DEFAULT_SHARE_CARD_STYLE.gapBeforeChart,
      gapAfterChart: Number(parsed.gapAfterChart) || DEFAULT_SHARE_CARD_STYLE.gapAfterChart,
      logoSize: Number(parsed.logoSize) || DEFAULT_SHARE_CARD_STYLE.logoSize,
      nameFontSize: Number(parsed.nameFontSize) || DEFAULT_SHARE_CARD_STYLE.nameFontSize,
      pctFontSize: Number(parsed.pctFontSize) || DEFAULT_SHARE_CARD_STYLE.pctFontSize,
      priceFontSize: Number(parsed.priceFontSize) || DEFAULT_SHARE_CARD_STYLE.priceFontSize,
      priceFontWeight: Number(parsed.priceFontWeight) || DEFAULT_SHARE_CARD_STYLE.priceFontWeight,
      imagePadding: sidePad,
      headerPadding,
      footerPadding,
      stampFontSize: Number(parsed.stampFontSize) || DEFAULT_SHARE_CARD_STYLE.stampFontSize,
      reasonFontSize: Number(parsed.reasonFontSize) || DEFAULT_SHARE_CARD_STYLE.reasonFontSize,
      timestampPlacement,
      photoHeight: Math.min(
        900,
        Math.max(120, Number(parsed.photoHeight) || DEFAULT_SHARE_CARD_STYLE.photoHeight),
      ),
      photoRadius: Math.min(
        120,
        Math.max(0, Number(parsed.photoRadius) ?? DEFAULT_SHARE_CARD_STYLE.photoRadius),
      ),
      photoBorderWidth: Math.min(
        16,
        Math.max(0, Number(parsed.photoBorderWidth) ?? DEFAULT_SHARE_CARD_STYLE.photoBorderWidth),
      ),
      photoMarginX: Math.min(
        80,
        Math.max(0, Number(parsed.photoMarginX) ?? DEFAULT_SHARE_CARD_STYLE.photoMarginX),
      ),
      photoMarginTop: Math.min(
        120,
        Math.max(0, Number(parsed.photoMarginTop) ?? DEFAULT_SHARE_CARD_STYLE.photoMarginTop),
      ),
      photoMarginBottom: Math.min(
        160,
        Math.max(0, Number(parsed.photoMarginBottom) ?? DEFAULT_SHARE_CARD_STYLE.photoMarginBottom),
      ),
      photoFrost: Math.min(
        100,
        Math.max(0, Number(parsed.photoFrost) ?? DEFAULT_SHARE_CARD_STYLE.photoFrost),
      ),
      bgImageOpacity: Math.min(
        100,
        Math.max(
          0,
          Number.isFinite(Number(parsed.bgImageOpacity))
            ? Math.round(Number(parsed.bgImageOpacity))
            : DEFAULT_SHARE_CARD_STYLE.bgImageOpacity,
        ),
      ),
      bgBlur: Math.min(
        80,
        Math.max(
          0,
          Number.isFinite(Number(parsed.bgBlur))
            ? Math.round(Number(parsed.bgBlur))
            : DEFAULT_SHARE_CARD_STYLE.bgBlur,
        ),
      ),
      // Bipolar axes −100…+100; migrate legacy 0–100 bgBlackFade → +bgBlack
      bgBlack: (() => {
        if (Number.isFinite(Number(parsed.bgBlack))) {
          return clampShareBgAxis(parsed.bgBlack, DEFAULT_SHARE_CARD_STYLE.bgBlack)
        }
        if (Number.isFinite(Number(parsed.bgBlackFade))) {
          return clampShareBgAxis(Number(parsed.bgBlackFade), DEFAULT_SHARE_CARD_STYLE.bgBlack)
        }
        return DEFAULT_SHARE_CARD_STYLE.bgBlack
      })(),
      bgWhite: clampShareBgAxis(
        Number.isFinite(Number(parsed.bgWhite)) ? parsed.bgWhite : DEFAULT_SHARE_CARD_STYLE.bgWhite,
        DEFAULT_SHARE_CARD_STYLE.bgWhite,
      ),
      photoPlacement:
        parsed.photoPlacement === 'background' ||
        parsed.photoPlacement === 'above-header' ||
        parsed.photoPlacement === 'below-header' ||
        parsed.photoPlacement === 'below-chart'
          ? parsed.photoPlacement
          : 'background',
    }
    // One-time: old default was 1080px — lift to Full HD so Copy/Download are sharp
    if (!readPref(SHARE_CARD_FHD_MIGRATION_KEY)) {
      try {
        writePref(SHARE_CARD_FHD_MIGRATION_KEY, '1')
      } catch {
        /* ignore */
      }
      if (result.canvasWidth > 0 && result.canvasWidth < 1920) {
        result = { ...result, canvasWidth: 1920 }
        try {
          writePref(SHARE_CARD_STYLE_PREF_KEY, JSON.stringify(result))
        } catch {
          /* ignore */
        }
      }
    }
    return result
  } catch {
    return { ...DEFAULT_SHARE_CARD_STYLE }
  }
}

function saveShareCardStyle(style: ShareCardStyle) {
  try {
    writePref(SHARE_CARD_STYLE_PREF_KEY, JSON.stringify(style))
  } catch {
    /* quota / private mode */
  }
}

function sharePriceFillColor(color: ShareCardStyle['priceColor'] | undefined): string {
  return shareTextFillColor(color)
}

/** Session cache so slider re-renders do not re-hit Yahoo every time. */
const shareCompanyNameCache = new Map<string, string>()

/**
 * Prefer a real company name for share-card title.
 * If DB only has ticker (or blank), pull shortName/longName from Yahoo Finance.
 */
async function resolveShareCompanyName(
  ticker: string,
  provided?: string | null,
): Promise<string> {
  const symbol = String(ticker || '')
    .toUpperCase()
    .replace(/[^A-Z0-9.^_=\-]/g, '')
  const given = String(provided || '').trim()
  // Meaningful company name (not empty / not just the ticker)
  if (given && given.toUpperCase() !== symbol) {
    // Still warm the cache in background for later ticker toggles.
    if (symbol && !shareCompanyNameCache.has(symbol)) {
      void fetchYahooQuote(symbol)
        .then((body) => {
          const name = String(body?.quote?.shortName || body?.quote?.longName || '').trim()
          if (name) shareCompanyNameCache.set(symbol, name)
        })
        .catch(() => {
          /* ignore */
        })
    }
    return given
  }

  if (symbol && shareCompanyNameCache.has(symbol)) {
    return shareCompanyNameCache.get(symbol) || given || symbol
  }

  if (!symbol) return given || ticker || ''

  try {
    const body = await fetchYahooQuote(symbol)
    const q = body?.quote
    const name = String(q?.shortName || q?.longName || '').trim()
    if (name) {
      shareCompanyNameCache.set(symbol, name)
      return name
    }
  } catch {
    /* keep fallback */
  }

  return given || symbol
}

/** Calendar day key in America/New_York for share stamps. */
function etDateKey(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/**
 * Share stamp under the session headline — always the listing exchange zone.
 * Market event times are stored as US Eastern wall-clock for US equities; we
 * project into the exchange IANA zone (normally America/New_York for MSFT).
 * Examples: “Today · 3:33 PM EDT” · “Today · 4:30 PM BST” (LSE)
 */
function formatShareStampLabel(
  event: PriceMovementEvent,
  tz: string = EXCHANGE_TZ_FALLBACK,
): string {
  const eventDate = String(event.event_date || '').slice(0, 10)
  const zone = String(tz || '').trim() || EXCHANGE_TZ_FALLBACK

  // Prefer true instant from ET wall time so clocks re-project into UK / IST / UTC
  let utcMs = eventEasternWallTimeToUtcMs(event)
  if (utcMs == null && eventDate === etDateKey()) {
    // Today, no parseable time_label → “now”
    utcMs = Date.now()
  }

  const at = utcMs ?? Date.now()
  const abbrev = shareTimezoneAbbrev(zone, at)

  const formatClock = (ms: number) =>
    new Date(ms).toLocaleTimeString('en-US', {
      timeZone: zone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

  // Calendar day of the event in the *display* zone (after conversion)
  let eventDayInZone = eventDate
  let todayInZone = etDateKey()
  try {
    if (utcMs != null) {
      eventDayInZone = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(utcMs))
    }
    todayInZone = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    /* keep defaults */
  }

  const isToday = eventDayInZone === todayInZone || eventDate === etDateKey()

  if (isToday && utcMs != null) {
    return withTimezoneSuffix(`Today · ${formatClock(utcMs)}`, abbrev)
  }

  // Older day — date in display zone + converted clock
  try {
    const datePart = new Date(utcMs ?? `${eventDate}T12:00:00Z`).toLocaleDateString(
      'en-GB',
      {
        day: 'numeric',
        month: 'long',
        timeZone: zone,
      },
    )
    if (utcMs != null) {
      return withTimezoneSuffix(`${datePart} · ${formatClock(utcMs)}`, abbrev)
    }
    return datePart
  } catch {
    /* fall through */
  }

  if (event.display_date) return String(event.display_date).trim()
  if (eventDate) return eventDate
  return withTimezoneSuffix(formatClock(at), abbrev)
}

/** True when stamp is empty or still an auto-generated timezone label. */
function isGeneratedShareStamp(
  event: PriceMovementEvent,
  stamp: string,
  displayTimeZone: string = EXCHANGE_TZ_FALLBACK,
): boolean {
  const custom = String(stamp || '').trim()
  if (!custom) return true
  if (formatShareStampLabel(event, displayTimeZone) === custom) return true
  // Legacy auto stamps from the old UK/IST/UTC convert picker
  return SHARE_CHART_TIMEZONES.some((z) => formatShareStampLabel(event, z.id) === custom)
}

/**
 * Live-editable stamp. Hidden when style.showTimestamp is off or the user
 * cleared the field. Always regenerates in the listing exchange timezone.
 */
function resolveShareStampLabel(
  event: PriceMovementEvent,
  style: ShareCardStyle,
  textContent?: ShareCardTextContent | null,
  displayTimeZone: string = EXCHANGE_TZ_FALLBACK,
): string {
  if (style.showTimestamp === false) return ''
  const auto = formatShareStampLabel(event, displayTimeZone)
  if (!textContent || textContent.stamp === undefined) return auto
  const custom = String(textContent.stamp).trim()
  if (!custom) return ''
  return isGeneratedShareStamp(event, custom, displayTimeZone) ? auto : custom
}

/**
 * Gemini first headline line (… so far in regular trading / in pre-market…).
 * Everything before “Likely driver:”.
 */
function extractShareSessionHeadline(summary: string): string {
  const sections = parseGeminiTweetSections(summary || '')
  if (sections.headline) return sections.headline.replace(/\s+/g, ' ').trim()
  // No structured sections — first non-empty line if it isn't a driver label
  const first = String(summary || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean)
  if (!first) return ''
  if (/^likely\s*driver\s*:/i.test(first)) return ''
  if (/^secondary\s*driver\s*:/i.test(first)) return ''
  return first.replace(/\s+/g, ' ').trim()
}

/** |%| bands for session-line wording (thresholds: 5 / 10 / 15 / 25). */
type ShareMoveBand = 'mild' | 'solid' | 'strong' | 'huge' | 'extreme'

/** Session-line tone presets — classic = default “…so far in regular trading”. */
type ShareSessionLineTone = 'classic' | 'intensity' | 'breaking' | 'punchy'

type ShareSessionLineOption = {
  id: string
  /** Short chip label in the UI */
  label: string
  line: string
}

function parseShareMovePercent(moveText: string): {
  abs: number
  signed: number
  isUp: boolean
  isDown: boolean
  display: string
} | null {
  const raw = String(moveText || '').trim()
  if (!raw) return null
  const m = raw.replace(/,/g, '').match(/([+\-−–])?\s*(\d+(?:\.\d+)?)\s*%?/)
  if (!m) return null
  const n = Number(m[2])
  if (!Number.isFinite(n)) return null
  const signChar = m[1] || ''
  const neg =
    signChar === '-' ||
    signChar === '−' ||
    signChar === '–' ||
    /^[-−(]/.test(raw) ||
    /\bdown\b/i.test(raw)
  const pos = !neg && (signChar === '+' || /^\+/.test(raw) || /\bup\b/i.test(raw) || n > 0)
  // If bare number without sign, treat as up when positive
  const isDown = neg
  const isUp = !isDown && (pos || n > 0)
  const abs = Math.abs(n)
  const signed = isDown ? -abs : abs
  const display = isDown ? `-${formatSharePctNumber(abs)}%` : `+${formatSharePctNumber(abs)}%`
  return { abs, signed, isUp, isDown, display }
}

function formatSharePctNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  // Keep one decimal when needed (4.2), drop trailing .0
  const t = Math.round(n * 10) / 10
  return Number.isInteger(t) ? String(t) : t.toFixed(1)
}

function shareMoveBand(abs: number): ShareMoveBand {
  if (abs >= 25) return 'extreme'
  if (abs >= 15) return 'huge'
  if (abs >= 10) return 'strong'
  if (abs >= 5) return 'solid'
  return 'mild'
}

function shareSessionPhrase(session: ShareChartSession): {
  classic: string
  short: string
  today: string
} {
  if (session === 'premarket') {
    return {
      classic: 'in pre-market',
      short: 'pre-market',
      today: 'before the open',
    }
  }
  if (session === 'after-hours') {
    return {
      classic: 'after hours',
      short: 'after-hours',
      today: 'after the close',
    }
  }
  return {
    classic: 'so far in regular trading',
    short: 'in regular trading',
    today: 'so far today',
  }
}

/**
 * Magnitude-aware session lines.
 * Default/classic keeps “…so far in regular trading” (or pre/AH).
 * Other tones scale wording + emoji with 5% / 10% / 15% / 25% bands.
 */
function buildShareSessionLineOptions(args: {
  ticker: string
  moveText: string
  session: ShareChartSession
  /** Gemini / original headline when available */
  geminiLine?: string
}): ShareSessionLineOption[] {
  const symbol = String(args.ticker || '')
    .toUpperCase()
    .replace(/[^A-Z0-9.^_=\-]/g, '') || 'TICKER'
  const parsed = parseShareMovePercent(args.moveText)
  const session = args.session
  const phrases = shareSessionPhrase(session)
  const gemini = String(args.geminiLine || '')
    .replace(/\s+/g, ' ')
    .trim()

  const options: ShareSessionLineOption[] = []
  const push = (id: string, label: string, line: string) => {
    const cleaned = line.replace(/\s+/g, ' ').trim()
    if (!cleaned) return
    if (options.some((o) => o.line === cleaned)) return
    options.push({ id, label, line: cleaned })
  }

  // Always offer classic default
  if (parsed) {
    push(
      'classic',
      'Classic',
      `$${symbol} ${parsed.display} ${phrases.classic}`,
    )
  } else if (gemini) {
    push('classic', 'Classic', gemini)
  } else {
    push('classic', 'Classic', `$${symbol} ${phrases.classic}`)
  }

  if (gemini && (!parsed || gemini !== options[0]?.line)) {
    push('gemini', 'From Gemini', gemini)
  }

  if (!parsed) return options

  const { abs, display, isDown } = parsed
  const band = shareMoveBand(abs)
  const tick = `$${symbol}`
  const up = !isDown

  // --- Intensity (band verbs, light emoji) ---
  if (band === 'mild') {
    push(
      'intensity',
      'Intensity',
      up
        ? `${tick} ${display} ${phrases.classic}`
        : `${tick} ${display} ${phrases.classic}`,
    )
    push(
      'intensity-soft',
      'Soft',
      up
        ? `${tick} edging ${display} ${phrases.today}`
        : `${tick} slipping ${display} ${phrases.today}`,
    )
  } else if (band === 'solid') {
    // ~5–10%
    push(
      'intensity',
      'Intensity',
      up
        ? `${tick} climbing ${display} ${phrases.classic} 📈`
        : `${tick} sliding ${display} ${phrases.classic} 📉`,
    )
    push(
      'intensity-alt',
      'Alt',
      up
        ? `📈 ${tick} up ${display} ${phrases.short}`
        : `📉 ${tick} down ${display} ${phrases.short}`,
    )
  } else if (band === 'strong') {
    // ~10–15%
    push(
      'intensity',
      'Intensity',
      up
        ? `${tick} surging ${display} ${phrases.classic} 📈`
        : `${tick} tumbling ${display} ${phrases.classic} 📉`,
    )
    push(
      'intensity-alt',
      'Hot move',
      up
        ? `🔥 ${tick} ripping ${display} ${phrases.today}`
        : `❄️ ${tick} dumping ${display} ${phrases.today}`,
    )
  } else if (band === 'huge') {
    // ~15–25%
    push(
      'intensity',
      'Intensity',
      up
        ? `🚀 ${tick} soaring ${display} ${phrases.classic}`
        : `🔻 ${tick} plunging ${display} ${phrases.classic}`,
    )
    push(
      'intensity-alt',
      'Huge',
      up
        ? `${tick} ${display} — massive move ${phrases.today} 🚀`
        : `${tick} ${display} — heavy selloff ${phrases.today} 📉`,
    )
  } else {
    // 25%+
    push(
      'intensity',
      'Intensity',
      up
        ? `🚀 ${tick} exploding ${display} ${phrases.classic}`
        : `💥 ${tick} crashing ${display} ${phrases.classic}`,
    )
    push(
      'intensity-alt',
      'Extreme',
      up
        ? `${tick} ${display} — historic spike ${phrases.today} 🚨`
        : `${tick} ${display} — historic drop ${phrases.today} 🚨`,
    )
  }

  // --- Breaking (news desk; kicks in harder from 10%+) ---
  if (band === 'mild' || band === 'solid') {
    push(
      'breaking-soft',
      'Watch',
      up
        ? `👀 ${tick} ${display} ${phrases.classic}`
        : `👀 ${tick} ${display} ${phrases.classic}`,
    )
  } else if (band === 'strong') {
    push(
      'breaking',
      'Breaking',
      up
        ? `🚨 BREAKING: ${tick} ${display} ${phrases.classic}`
        : `🚨 BREAKING: ${tick} ${display} ${phrases.classic}`,
    )
    push(
      'breaking-alt',
      'Flash',
      up
        ? `BREAKING 📈 ${tick} jumps ${display} ${phrases.today}`
        : `BREAKING 📉 ${tick} drops ${display} ${phrases.today}`,
    )
  } else {
    push(
      'breaking',
      'Breaking',
      up
        ? `🚨 BREAKING: ${tick} ${display} ${phrases.classic}`
        : `🚨 BREAKING: ${tick} ${display} ${phrases.classic}`,
    )
    push(
      'breaking-alt',
      'Alert',
      up
        ? `🚨 MARKET ALERT: ${tick} rockets ${display} ${phrases.today}`
        : `🚨 MARKET ALERT: ${tick} collapses ${display} ${phrases.today}`,
    )
  }

  // --- Punchy (short social) ---
  if (band === 'mild') {
    push('punchy', 'Punchy', `${tick} ${display} ${phrases.today}`)
  } else if (band === 'solid') {
    push(
      'punchy',
      'Punchy',
      up ? `${tick} ${display} and climbing 📈` : `${tick} ${display} under pressure 📉`,
    )
  } else if (band === 'strong') {
    push(
      'punchy',
      'Punchy',
      up ? `${tick} ${display} 🔥 big move ${phrases.short}` : `${tick} ${display} 📉 sharp drop ${phrases.short}`,
    )
  } else if (band === 'huge') {
    push(
      'punchy',
      'Punchy',
      up ? `🚀 ${tick} ${display} moonshot ${phrases.today}` : `🔻 ${tick} ${display} freefall ${phrases.today}`,
    )
  } else {
    push(
      'punchy',
      'Punchy',
      up
        ? `🚨 ${tick} ${display} — insane move ${phrases.today}`
        : `🚨 ${tick} ${display} — brutal selloff ${phrases.today}`,
    )
  }

  // Clean band-tag line (no verb spam) for all sizes ≥5%
  if (band !== 'mild') {
    const tag =
      band === 'solid'
        ? up
          ? 'notable gain'
          : 'notable drop'
        : band === 'strong'
          ? up
            ? 'double-digit surge'
            : 'double-digit drop'
          : band === 'huge'
            ? up
              ? 'huge rally'
              : 'huge selloff'
            : up
              ? 'extreme rally'
              : 'extreme crash'
    push('tagged', 'Tagged', `${tick} ${display} — ${tag} ${phrases.classic}`)
  }

  return options
}

/** Pick one session line for a tone (falls back to classic). */
function pickShareSessionLineByTone(
  options: ShareSessionLineOption[],
  tone: ShareSessionLineTone,
): string {
  if (!options.length) return ''
  if (tone === 'classic') {
    return (
      options.find((o) => o.id === 'classic')?.line ||
      options.find((o) => o.id === 'gemini')?.line ||
      options[0].line
    )
  }
  if (tone === 'intensity') {
    return (
      options.find((o) => o.id === 'intensity')?.line ||
      options.find((o) => o.id.startsWith('intensity'))?.line ||
      options[0].line
    )
  }
  if (tone === 'breaking') {
    return (
      options.find((o) => o.id === 'breaking')?.line ||
      options.find((o) => o.id.startsWith('breaking'))?.line ||
      options.find((o) => o.id === 'intensity')?.line ||
      options[0].line
    )
  }
  // punchy
  return options.find((o) => o.id === 'punchy')?.line || options[0].line
}

/**
 * Reason body for the share image — Likely driver content only.
 * No “Likely driver:” label, no secondary / move / confidence.
 * (Session headline is drawn separately.)
 */
function extractShareReasonBody(
  summary: string,
  titleFallback: string,
  event: PriceMovementEvent,
): string {
  const sections = parseGeminiTweetSections(summary || '')
  let quote =
    sections.likely ||
    String(summary || '')
      .replace(/^likely\s*driver\s*:\s*/i, '')
      .trim()

  // If still looks like full blob including headline, drop first line when likely was empty
  if (!sections.likely && sections.headline && quote.startsWith(sections.headline)) {
    quote = quote.slice(sections.headline.length).trim()
    quote = quote.replace(/^likely\s*driver\s*:\s*/i, '').trim()
  }

  // Drop secondary / move / confidence tails; single paragraph for the card
  quote = quote
    .replace(/\n\s*secondary\s*driver\s*:[\s\S]*$/i, '')
    .replace(/\n\s*move\s*classification\s*:[\s\S]*$/i, '')
    .replace(/\n\s*confidence\s*:[\s\S]*$/i, '')
    .replace(/^likely\s*driver\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!quote) {
    const close = formatChange(event.price_change || event.momentum)
    const premarket = formatChange(getPremarketChange(event))
    const bits: string[] = []
    if (close?.text) bits.push(`${close.text} at close`)
    if (premarket?.text) bits.push(`pre-market ${premarket.text}`)
    quote = bits.length
      ? `${titleFallback} moved ${bits.join(' · ')}`
      : `${titleFallback} notable price momentum`
  }
  return quote
}

/** Editable copy drawn on the share image (session-only; not in layout prefs). */
type ShareCardTextContent = {
  title: string
  percent: string
  price: string
  /** First session line (so far in regular trading / pre-market…). */
  sessionLine: string
  reason: string
  stamp: string
  brand: string
}

/** Pick title from style + optional manual edit (keeps custom edits). */
function resolveShareTitleText(
  style: ShareCardStyle,
  textContent: ShareCardTextContent | null | undefined,
  symbol: string,
  companyLabel: string,
): string {
  const autoTicker = symbol
  const autoCompany = String(companyLabel || '').trim() || symbol
  const custom = String(textContent?.title || '').trim()
  if (!custom) {
    return style.titleMode === 'ticker' ? autoTicker : autoCompany
  }
  // Still one of the auto values → style toggle wins (fixes “title stuck” bug).
  if (
    custom === autoTicker ||
    custom === autoCompany ||
    custom.toUpperCase() === autoTicker
  ) {
    return style.titleMode === 'ticker' ? autoTicker : autoCompany
  }
  return custom
}

/** Build default image text from event + style (company name already resolved when possible). */
function buildShareCardTextContent(
  ticker: string,
  event: PriceMovementEvent,
  companyName?: string | null,
  style: ShareCardStyle = DEFAULT_SHARE_CARD_STYLE,
  displayTimeZone: string = EXCHANGE_TZ_FALLBACK,
): ShareCardTextContent {
  const symbol = String(ticker || '').toUpperCase()
  const close = formatChange(event.price_change || event.momentum)
  const premarket = formatChange(getPremarketChange(event))
  const companyLabel = String(companyName || '').trim() || symbol
  const titleText = resolveShareTitleText(style, null, symbol, companyLabel)
  const rawSummary = String(event.summary || '')
  const geminiLine = extractShareSessionHeadline(rawSummary)
  const moveText = close?.text || premarket?.text || ''
  const chartSession = inferShareChartSession(event, geminiLine)
  const tone = style.sessionLineTone || 'classic'
  const sessionOptions = buildShareSessionLineOptions({
    ticker: symbol,
    moveText,
    session: chartSession,
    geminiLine,
  })
  // Classic tone prefers Gemini wording when present; other tones use magnitude templates
  const sessionLine =
    tone === 'classic' && geminiLine
      ? geminiLine
      : pickShareSessionLineByTone(sessionOptions, tone) || geminiLine
  const reason = extractShareReasonBody(rawSummary, titleText, event)
  const zone =
    String(displayTimeZone || '').trim() ||
    resolveExchangeTimeZone({ symbol }) ||
    EXCHANGE_TZ_FALLBACK

  return {
    title: titleText,
    percent: moveText,
    price: formatSharePriceLabel(event.price),
    sessionLine,
    reason,
    stamp: formatShareStampLabel(event, zone),
    brand: 'Track at Trigger',
  }
}

/** Infer up/down coloring from edited % text, else fall back to event flags. */
function shareMoveFlagsFromText(
  moveText: string,
  fallbackIsDown: boolean,
  fallbackIsUp: boolean,
): { isDown: boolean; isUp: boolean } {
  const t = String(moveText || '').trim()
  if (/^[-−(]/.test(t) || /\bdown\b/i.test(t)) return { isDown: true, isUp: false }
  if (/^\+/.test(t) || /\bup\b/i.test(t)) return { isDown: false, isUp: true }
  return { isDown: fallbackIsDown, isUp: fallbackIsUp }
}

/**
 * Share-card (Yahoo-style yellow):
 * company name · large % · mini chart · full likely-driver reason · Track at Trigger.
 * Height follows content (aspect ratio flexes). Style knobs from preview sliders.
 * `textContent` overrides drawn strings when provided (live-editable in layout panel).
 */
async function renderMomentumTweetImage(
  ticker: string,
  event: PriceMovementEvent,
  companyName?: string | null,
  style: ShareCardStyle = DEFAULT_SHARE_CARD_STYLE,
  textContent?: ShareCardTextContent | null,
  /**
   * Optional user photo (data URL):
   * - full-card **blurred background**
   * - sharp hero frame in the photo slot (above/below header or chart)
   */
  sideImageDataUrl?: string | null,
  displayTimeZone: string = EXCHANGE_TZ_FALLBACK,
): Promise<{ blob: Blob; objectUrl: string; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null
  await ensureShareFontsLoaded()
  const symbol = String(ticker || '').toUpperCase()
  const close = formatChange(event.price_change || event.momentum)
  const premarket = formatChange(getPremarketChange(event))
  let isDown = Boolean(close?.negative || (!close?.positive && premarket?.negative))
  let isUp = Boolean(close?.positive || premarket?.positive) && !isDown
  const zone =
    String(displayTimeZone || '').trim() ||
    resolveExchangeTimeZone({ symbol }) ||
    EXCHANGE_TZ_FALLBACK

  // Session stamp: listing exchange zone (never browser-local BST conversion).
  // Hidden when showTimestamp is off or the user cleared the field.
  const stampLabel = resolveShareStampLabel(event, style, textContent, zone)

  // Company name + Yahoo line (9:30 ET → stamp’s ET minute) in parallel
  const [companyLabel, chartSeriesFull] = await Promise.all([
    resolveShareCompanyName(symbol, companyName),
    loadShareRegularSessionSeries(symbol, event.event_date, {
      // Cutoff must stay in market ET, not the converted display stamp
      stampText: event.time_label,
      timeLabel: event.time_label,
      sessionDays: clampShareChartSessionDays(style.chartSessionDays),
      interval: clampShareChartInterval(style.chartInterval),
    }),
  ])
  // End fixed at stamp; startPct trims from the left of the loaded sessions
  const chartSeries = trimShareChartSeriesByStartPct(
    chartSeriesFull,
    style.chartVisibleStartPct,
  )
  if (chartSeries.length >= 2) {
    const first = chartSeries[0].close
    const lastClose = chartSeries[chartSeries.length - 1].close
    if (lastClose < first) {
      isDown = true
      isUp = false
    } else if (lastClose > first) {
      isDown = false
      isUp = true
    }
  }
  const defaultTitle = resolveShareTitleText(style, null, symbol, companyLabel)
  const showSessionHeadline = style.showSessionHeadline !== false
  // When session headline is on, stamp sits under that line (not footer / not price-right).
  const timestampPlacement =
    showSessionHeadline
      ? 'under-session'
      : style.timestampPlacement === 'price-right'
        ? 'price-right'
        : 'footer-left'

  const rawSummary = String(event.summary || '')
  const defaultSessionLine = extractShareSessionHeadline(rawSummary)
  const defaultQuote = extractShareReasonBody(rawSummary, defaultTitle, event)

  const titleText = resolveShareTitleText(style, textContent, symbol, companyLabel)
  const moveText = (textContent?.percent ?? close?.text ?? premarket?.text ?? '').trim()
  const showSharePrice = style.showSharePrice !== false
  const priceLabelRaw = (textContent?.price ?? formatSharePriceLabel(event.price)).trim()
  const priceLabel = showSharePrice ? priceLabelRaw : ''
  const sessionLineRaw =
    textContent?.sessionLine !== undefined
      ? String(textContent.sessionLine)
      : defaultSessionLine
  const sessionLine = showSessionHeadline ? sessionLineRaw.replace(/\s+/g, ' ').trim() : ''
  const quote = (textContent?.reason ?? defaultQuote).replace(/\s+/g, ' ').trim() || defaultQuote
  const showBrand = style.showBrand !== false
  const brandLabelRaw = (textContent?.brand ?? 'Track at Trigger').trim() || 'Track at Trigger'
  const brandLabel = showBrand ? brandLabelRaw : ''
  const brandTone =
    style.brandTone === 'dark' || style.brandTone === 'light' ? style.brandTone : 'auto'
  const rawBrandHScale = Number(style.brandHeightScale)
  const brandHeightScale =
    Number.isFinite(rawBrandHScale) && rawBrandHScale >= 0.5 && rawBrandHScale <= 2.5
      ? rawBrandHScale
      : 1

  const moveFlags = shareMoveFlagsFromText(moveText, isDown, isUp)
  isDown = moveFlags.isDown
  isUp = moveFlags.isUp

  const rawW = Number(style.canvasWidth)
  const w =
    Number.isFinite(rawW) && rawW >= 800
      ? Math.min(3840, Math.round(rawW))
      : DEFAULT_SHARE_CARD_STYLE.canvasWidth
  const rawAspect = Number(style.aspectRatio)
  const aspectRatio =
    Number.isFinite(rawAspect) && rawAspect >= 0.75 && rawAspect <= 1.8
      ? rawAspect
      : DEFAULT_SHARE_CARD_STYLE.aspectRatio
  // Design tokens are authored @ 1080w — scale fully so Full HD / 2K / 4K stay sharp & proportional
  const typeScale = Math.min(4, Math.max(0.5, w / 1080))
  const designPadX = Math.min(
    120,
    Math.max(16, Math.round(Number(style.imagePadding) || DEFAULT_SHARE_CARD_STYLE.imagePadding)),
  )
  const designTopPad = Math.min(
    200,
    Math.max(
      0,
      Math.round(
        Number.isFinite(Number(style.headerPadding))
          ? Number(style.headerPadding)
          : DEFAULT_SHARE_CARD_STYLE.headerPadding,
      ),
    ),
  )
  const designBottomPad = Math.min(
    200,
    Math.max(
      0,
      Math.round(
        Number.isFinite(Number(style.footerPadding))
          ? Number(style.footerPadding)
          : DEFAULT_SHARE_CARD_STYLE.footerPadding,
      ),
    ),
  )
  // Full-bleed only: image wall-to-wall + black veil. No inset black content plate.
  const padX = Math.round(designPadX * typeScale)
  const topPad = Math.round(designTopPad * typeScale)
  const bottomPad = Math.round(designBottomPad * typeScale)
  const textMaxW = w - padX * 2
  const logoSize = Math.round((style.logoSize || 86) * typeScale)
  const logoGap = Math.round(18 * typeScale)
  // --- Design tokens (1080 canvas) · Google Sans Flex / AppFont table ---
  const nameSize = Math.round((style.nameFontSize || 56) * typeScale) // company ExtraBold 56
  const pctSize = Math.round((style.pctFontSize || 80) * typeScale) // pct Bold 80
  const priceFontSize = Math.round((style.priceFontSize || 36) * typeScale) // price SemiBold 36
  const rawPriceWeight = Number(style.priceFontWeight)
  const priceFontWeight = Number.isFinite(rawPriceWeight)
    ? Math.min(900, Math.max(100, Math.round(rawPriceWeight / 100) * 100))
    : 600
  const stampFontSize = Math.round((style.stampFontSize || 34) * typeScale) // reasonWhen 34
  const reasonSize = Math.round((style.reasonFontSize || 40) * typeScale) // reasonDriver 40
  const nameWeight = shareFontWeightCss(style.nameWeight, 'extrabold')
  const reasonWeight = shareFontWeightCss(style.reasonWeight, 'regular')
  const sessionWeightCss = shareFontWeightCss(style.sessionWeight, 'semibold')
  const brandWeightCss = shareFontWeightCss(style.brandWeight, 'medium')
  const nameFont = shareFont(nameWeight, nameSize)
  // company lineHeight 64 @ size 56
  const nameLineH = Math.round(nameSize * (64 / 56))
  const pctFont = shareFont(800, pctSize) // Bold + weight 800
  const reasonFont = shareFont(reasonWeight, reasonSize)
  // reasonDriver lineHeight 54 @ size 40
  const reasonLineH = Math.round(reasonSize * (54 / 40))
  // Plot + time axis
  // Extra room under plot for time ticks and/or day labels (Today · 6 August)
  const timeDayGapPx = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        Number.isFinite(Number(style.chartTimeDayGap))
          ? Number(style.chartTimeDayGap)
          : DEFAULT_SHARE_CARD_STYLE.chartTimeDayGap,
      ),
    ),
  )
  const chartAxisExtra =
    (style.showChartTimeAxis !== false ? 28 : 0) +
    (style.showChartDayLabels === true
      ? 22 + (style.showChartTimeAxis !== false ? timeDayGapPx : 4)
      : 0)
  const chartPlotBase = Math.min(
    700,
    Math.max(
      140,
      Math.round(
        Number.isFinite(Number(style.chartPlotHeight)) && Number(style.chartPlotHeight) > 0
          ? Number(style.chartPlotHeight)
          : DEFAULT_SHARE_CARD_STYLE.chartPlotHeight,
      ),
    ),
  )
  // Full chart block = plot + time/day axes; taller plot = more vertical “zoom”
  let chartH = Math.round((chartPlotBase + chartAxisExtra) * typeScale)
  let gapBeforeChart = Math.round(style.gapBeforeChart * typeScale)
  let gapAfterChart = Math.round(style.gapAfterChart * typeScale)
  // Reason → Track at Trigger: reasonMarginBottom + brandMarginTop
  // Collapse brand spacing when both brand text and store icons are hidden
  const brandRowVisible =
    showBrand || style.showStoreBadges !== false
  const reasonGap = Number.isFinite(Number(style.reasonMarginBottom))
    ? Math.min(200, Math.max(0, Number(style.reasonMarginBottom)))
    : DEFAULT_SHARE_CARD_STYLE.reasonMarginBottom
  const brandTopGap = Number.isFinite(Number(style.brandMarginTop))
    ? Math.min(120, Math.max(0, Number(style.brandMarginTop)))
    : DEFAULT_SHARE_CARD_STYLE.brandMarginTop
  let gapBeforeBrand = brandRowVisible
    ? Math.round((reasonGap + brandTopGap) * typeScale)
    : Math.round(12 * typeScale) // small breathing room before bottom edge / footer date
  // Space below Track at Trigger row
  const brandBottomGap = Number.isFinite(Number(style.brandMarginBottom))
    ? Math.min(160, Math.max(0, Number(style.brandMarginBottom)))
    : DEFAULT_SHARE_CARD_STYLE.brandMarginBottom
  // brandMarginBottom replaces/adds to bottom pad for the brand row breathing room
  const brandBottomPad = brandRowVisible
    ? Math.round(brandBottomGap * typeScale)
    : Math.round(bottomPad * 0.5)
  const rawBrandFs = Number(style.brandFontSize)
  const brandFontSize = Math.round(
    (Number.isFinite(rawBrandFs) && rawBrandFs >= 14
      ? Math.min(64, rawBrandFs)
      : DEFAULT_SHARE_CARD_STYLE.brandFontSize) * typeScale,
  )
  const brandFont = shareFont(brandWeightCss, brandFontSize)
  const priceFont = shareFont(priceFontWeight, priceFontSize)
  const stampFont = shareFont(500, stampFontSize) // Medium 500
  // Absolute design line-heights (scaled)
  const pctLineH = Math.round(pctSize * (86 / 80))
  const priceLineH = Math.round(priceFontSize * (42 / 36))
  const stampLineH = Math.round(stampFontSize * (42 / 34))
  // brand height scale stretches vertical metrics (draw uses ctx.scale Y)
  const brandLineH = Math.round(brandFontSize * (34 / 28) * brandHeightScale)
  const cardBg = shareCardBgHex(style.cardColor)
  // Honor user’s text ink pick (Coffee / White / Navy …). Do not re-force on render.
  const textId =
    SHARE_TEXT_COLOR_PRESETS.some((p) => p.id === style.textColor)
      ? String(style.textColor)
      : 'black'
  const bodyText = shareTextFillColor(textId)
  const mutedText = shareTextMutedColor(textId)
  const reasonFill = shareTextSoftColor(textId)
  const brandFill =
    brandTone === 'light'
      ? SHARE_BRAND_LIGHT
      : brandTone === 'dark'
        ? SHARE_INK_SOFT
        : shareTextSoftColor(textId)
  const preferSquare = style.preferSquare !== false
  const chartSession = inferShareChartSession(event, sessionLine)

  // Custom pasted logos win over CDN/proxy
  const customMap = loadCustomLogoMap()
  const logoImg = await loadShareLogo(symbol, customMap[symbol] || null)
  const sideImg =
    sideImageDataUrl && String(sideImageDataUrl).trim()
      ? await loadImageFromUrl(String(sideImageDataUrl).trim())
      : null

  // Offscreen measure canvas (fonts only)
  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) return null

  const stampBesidePrice = Boolean(stampLabel) && timestampPlacement === 'price-right'
  const stampUnderSession =
    Boolean(stampLabel) && timestampPlacement === 'under-session' && Boolean(sessionLine)
  const footerDate = timestampPlacement === 'footer-left' ? stampLabel : ''

  measure.font = pctFont
  setShareLetterSpacing(measure, -1.5 * typeScale)
  const pctW = moveText ? measure.measureText(moveText).width : 0
  clearShareLetterSpacing(measure)

  // Header row: logo + title left, % right only
  // Logo always reserves space (image or monogram fallback)
  const nameLeft = padX + logoSize + logoGap
  const nameMaxW = Math.max(
    180,
    textMaxW - logoSize - logoGap - (pctW ? pctW + 28 : 0),
  )

  measure.font = nameFont
  setShareLetterSpacing(measure, -0.7 * typeScale)
  // Max 2 lines + ellipsis (mobile styles.company)
  const nameLines = measureWrappedText(measure, titleText, nameMaxW, 2)
  clearShareLetterSpacing(measure)

  // Session / section title — reasonTitle SemiBold 52 / lh 66
  const rawSessionFs = Number(style.sessionFontSize)
  const sessionFontSize = Math.round(
    (Number.isFinite(rawSessionFs) && rawSessionFs > 0
      ? Math.min(160, Math.max(18, rawSessionFs))
      : DEFAULT_SHARE_CARD_STYLE.sessionFontSize) * typeScale,
  )
  const rawSessionLh = Number(style.sessionLineHeight)
  const sessionLhMult =
    Number.isFinite(rawSessionLh) && rawSessionLh >= 1 && rawSessionLh <= 1.8
      ? rawSessionLh
      : 66 / 52
  const sessionLineH = Math.round(sessionFontSize * sessionLhMult)
  const sessionFont = shareFont(sessionWeightCss, sessionFontSize)
  measure.font = sessionFont
  setShareLetterSpacing(measure, -0.4 * typeScale)
  const sessionLines = sessionLine
    ? measureWrappedText(measure, sessionLine, textMaxW, 4)
    : []
  clearShareLetterSpacing(measure)

  // Full reason — high line cap so likely driver is never cut short
  measure.font = reasonFont
  setShareLetterSpacing(measure, -0.25 * typeScale)
  const reasonLines = measureWrappedText(measure, quote, textMaxW, 24)
  clearShareLetterSpacing(measure)

  const nameBlockH =
    nameLines.length <= 1 ? nameSize + 8 : nameLines.length * nameLineH - 12
  // Logo slot always present (image or monogram)
  const identityBlockH = Math.max(logoSize, nameBlockH)
  const rightPctH = moveText ? pctLineH : 0
  const bandH = Math.max(identityBlockH, rightPctH, 40)

  // Under header on the RIGHT (under %): share price (+ optional timestamp)
  const priceDrawH = priceLabel ? priceLineH + 8 : 0
  const metaRowH =
    priceLabel || stampBesidePrice
      ? Math.max(priceDrawH, stampBesidePrice ? stampLineH + 8 : 0) + 12
      : 0

  // Session block: marginTop → headline → stamp gap → stamp → (stampReasonGap | marginBottom) → reason
  const rawSessMt = Number(style.sessionMarginTop)
  const rawSessMb = Number(style.sessionMarginBottom)
  const rawSessStampGap = Number(style.sessionStampGap)
  const rawStampReasonGap = Number(style.stampReasonGap)
  const sessionBlockGapTop = sessionLines.length
    ? Math.round(
        (Number.isFinite(rawSessMt)
          ? Math.min(120, Math.max(0, rawSessMt))
          : DEFAULT_SHARE_CARD_STYLE.sessionMarginTop) * typeScale,
      )
    : 0
  const sessionStampGapPx = stampUnderSession
    ? Math.round(
        (Number.isFinite(rawSessStampGap)
          ? Math.min(80, Math.max(0, rawSessStampGap))
          : DEFAULT_SHARE_CARD_STYLE.sessionStampGap) * typeScale,
      )
    : 0
  // When stamp sits under session: gap after stamp → reason uses stampReasonGap.
  // When no stamp under session: sessionMarginBottom is session → reason.
  const sessionToReasonGap = Math.round(
    (Number.isFinite(rawSessMb)
      ? Math.min(160, Math.max(0, rawSessMb))
      : DEFAULT_SHARE_CARD_STYLE.sessionMarginBottom) * typeScale,
  )
  const stampToReasonGapPx = stampUnderSession
    ? Math.round(
        (Number.isFinite(rawStampReasonGap)
          ? Math.min(160, Math.max(0, rawStampReasonGap))
          : DEFAULT_SHARE_CARD_STYLE.stampReasonGap) * typeScale,
      )
    : 0
  let sessionAfterGap = sessionLines.length
    ? stampUnderSession
      ? stampToReasonGapPx
      : sessionToReasonGap
    : 0
  let sessionBlockH = sessionLines.length
    ? sessionBlockGapTop +
      sessionLines.length * sessionLineH +
      (stampUnderSession ? sessionStampGapPx + stampFontSize + 6 : 0) +
      sessionAfterGap
    : 0

  // Pasted image is ONLY the full-card digital background — never a framed hero above/below header.
  // Keep full union so legacy layout branches type-check (runtime always background).
  const photoPlacement = (style.photoPlacement ||
    'background') as ShareCardStyle['photoPlacement']
  const hasPhoto = false
  // Photo metrics are design-px @ 1080 — scale to export width (only used for legacy hero slots)
  let photoHeight = Math.round(
    Math.min(
      900,
      Math.max(120, Math.round(Number(style.photoHeight) || DEFAULT_SHARE_CARD_STYLE.photoHeight)),
    ) * typeScale,
  )
  const photoRadius = Math.round(
    Math.min(
      120,
      Math.max(0, Math.round(Number(style.photoRadius) ?? DEFAULT_SHARE_CARD_STYLE.photoRadius)),
    ) * typeScale,
  )
  const photoBorderWidth = Math.round(
    Math.min(
      16,
      Math.max(
        0,
        Math.round(Number(style.photoBorderWidth) ?? DEFAULT_SHARE_CARD_STYLE.photoBorderWidth),
      ),
    ) * typeScale,
  )
  const photoMarginX = Math.round(
    Math.min(
      80,
      Math.max(0, Math.round(Number(style.photoMarginX) ?? DEFAULT_SHARE_CARD_STYLE.photoMarginX)),
    ) * typeScale,
  )
  let photoMarginTop = Math.round(
    Math.min(
      120,
      Math.max(0, Math.round(Number(style.photoMarginTop) ?? DEFAULT_SHARE_CARD_STYLE.photoMarginTop)),
    ) * typeScale,
  )
  let photoMarginBottom = Math.round(
    Math.min(
      160,
      Math.max(
        0,
        Math.round(Number(style.photoMarginBottom) ?? DEFAULT_SHARE_CARD_STYLE.photoMarginBottom),
      ),
    ) * typeScale,
  )
  const photoFrost =
    Math.min(100, Math.max(0, Number(style.photoFrost) ?? DEFAULT_SHARE_CARD_STYLE.photoFrost)) /
    100

  // Floors used when locking to IG 1:1 / story ratios (preferSquare)
  const chartMinH = Math.max(
    120,
    Math.round((chartPlotBase * 0.45 + chartAxisExtra) * typeScale),
  )
  const photoMinH = hasPhoto ? Math.round(100 * typeScale) : 0

  /**
   * Stack: header+% → price → chart → session → reason → brand
   * (Hero photo slots only when photoPlacement ≠ background.)
   * Mutates sessionBlockH when sessionAfterGap changes.
   */
  const stackShareLayout = () => {
    sessionBlockH = sessionLines.length
      ? sessionBlockGapTop +
        sessionLines.length * sessionLineH +
        (stampUnderSession ? sessionStampGapPx + stampFontSize + 6 : 0) +
        sessionAfterGap
      : 0

    let cursorY = topPad
    let photoTop = 0
    let bandTop = topPad
    let metaTop = topPad
    let chartTop = topPad

    if (hasPhoto && photoPlacement === 'above-header') {
      photoTop = cursorY + photoMarginTop
      cursorY = photoTop + photoHeight + photoMarginBottom
      bandTop = cursorY
    } else {
      bandTop = cursorY
    }

    const bandMidY = bandTop + bandH / 2
    const headerBottom = bandTop + bandH
    metaTop = headerBottom + (metaRowH ? 8 : 0)
    const blockBottom = metaTop + metaRowH
    cursorY = blockBottom + gapBeforeChart

    if (hasPhoto && photoPlacement === 'below-header') {
      photoTop = cursorY + photoMarginTop
      cursorY = photoTop + photoHeight + photoMarginBottom
    }

    chartTop = cursorY
    cursorY = chartTop + chartH

    if (hasPhoto && photoPlacement === 'below-chart') {
      photoTop = cursorY + photoMarginTop
      cursorY = photoTop + photoHeight + photoMarginBottom
    }

    const reasonBlockH =
      reasonLines.length > 0
        ? Math.max(reasonSize, reasonLines.length * reasonLineH - (reasonLineH - reasonSize))
        : 0
    const naturalH =
      cursorY + gapAfterChart + sessionBlockH + reasonBlockH + gapBeforeBrand + bottomPad

    const chartBottomLive = chartTop + chartH
    const afterChartY =
      hasPhoto && photoPlacement === 'below-chart'
        ? photoTop + photoHeight + photoMarginBottom
        : chartBottomLive
    const contentBlockTop = afterChartY + gapAfterChart
    const sessionFirstY = contentBlockTop + (sessionLines.length ? sessionBlockGapTop : 0)
    const sessionLastY =
      sessionFirstY + Math.max(0, sessionLines.length - 1) * sessionLineH
    const sessionStampY = stampUnderSession
      ? sessionLastY + sessionStampGapPx + stampFontSize
      : 0
    const reasonFirstY = sessionLines.length
      ? contentBlockTop + sessionBlockH
      : contentBlockTop
    const reasonLastY =
      reasonFirstY + Math.max(0, reasonLines.length - 1) * reasonLineH
    const brandY = reasonLastY + gapBeforeBrand
    const contentH = Math.ceil(brandY + Math.max(bottomPad, brandBottomPad) + 8)

    return {
      photoTop,
      bandTop,
      bandMidY,
      metaTop,
      chartTop,
      naturalH,
      contentH,
      contentBlockTop,
      sessionFirstY,
      sessionLastY,
      sessionStampY,
      reasonFirstY,
      reasonLastY,
      brandY,
      reasonBlockH,
    }
  }

  // aspectRatio is height/width (1 = IG square, 1.25 ≈ 4:5 story)
  const targetH = Math.round(w * aspectRatio)
  let layout = stackShareLayout()

  // Lock shape: compress until content fits target, then force exact canvas height.
  // (Old logic only trimmed ~partial excess → 1:1 often stayed taller than wide.)
  if (preferSquare && layout.naturalH > targetH + 2) {
    for (let step = 0; step < 48 && layout.naturalH > targetH + 2; step += 1) {
      const need = layout.naturalH - targetH
      let reduced = 0

      // 1) Gaps
      const shrinkAfter = Math.min(Math.max(0, gapAfterChart - 8), Math.ceil(need * 0.2))
      const shrinkBeforeChart = Math.min(Math.max(0, gapBeforeChart - 8), Math.ceil(need * 0.12))
      const shrinkBrand = Math.min(Math.max(0, gapBeforeBrand - 12), Math.ceil(need * 0.15))
      const shrinkSessionGap = Math.min(Math.max(0, sessionAfterGap - 6), Math.ceil(need * 0.08))
      gapAfterChart -= shrinkAfter
      gapBeforeChart -= shrinkBeforeChart
      gapBeforeBrand -= shrinkBrand
      sessionAfterGap -= shrinkSessionGap
      reduced += shrinkAfter + shrinkBeforeChart + shrinkBrand + shrinkSessionGap

      // 2) Hero photo (biggest leftover when 1:1 fails)
      if (hasPhoto && photoHeight > photoMinH) {
        const shrinkPhoto = Math.min(
          photoHeight - photoMinH,
          Math.max(4, Math.ceil(need * 0.35)),
        )
        photoHeight -= shrinkPhoto
        reduced += shrinkPhoto
        const shrinkPmt = Math.min(Math.max(0, photoMarginTop - 0), Math.ceil(need * 0.05))
        const shrinkPmb = Math.min(Math.max(0, photoMarginBottom - 0), Math.ceil(need * 0.05))
        photoMarginTop -= shrinkPmt
        photoMarginBottom -= shrinkPmb
        reduced += shrinkPmt + shrinkPmb
      }

      // 3) Chart
      if (chartH > chartMinH) {
        const shrinkChart = Math.min(
          chartH - chartMinH,
          Math.max(4, Math.ceil(need * 0.28)),
        )
        chartH -= shrinkChart
        reduced += shrinkChart
      }

      layout = stackShareLayout()
      if (reduced <= 0) break
    }
  }

  const {
    photoTop,
    bandMidY,
    metaTop,
    chartTop,
    sessionFirstY,
    sessionStampY,
    reasonFirstY,
    brandY,
  } = layout

  // Exact export size when locked (IG 1:1 = 1080×1080 when canvasWidth=1080)
  let h = layout.contentH
  if (preferSquare) {
    h = targetH
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Layers when digital bg + frame:
  // 1) base · 2) full-bleed background image · 3) black content frame · 4) stamp · 5) content
  const isDarkCard = isDarkHex(cardBg)
  const rawImgOp = Number(style.bgImageOpacity)
  const bgImageOpacity =
    Number.isFinite(rawImgOp) && rawImgOp >= 0
      ? Math.min(100, Math.max(0, Math.round(rawImgOp))) / 100
      : DEFAULT_SHARE_CARD_STYLE.bgImageOpacity / 100

  // Full-bleed only: image wall-to-wall + bipolar Black / White axes (−100…+100)
  if (sideImg) {
    // Base under image (shows if image opacity < 100%)
    ctx.fillStyle = isDarkCard ? softenBlackCardHex(cardBg) : cardBg
    ctx.fillRect(0, 0, w, h)
    const bgBlack = clampShareBgAxis(style.bgBlack, DEFAULT_SHARE_CARD_STYLE.bgBlack)
    const bgWhite = clampShareBgAxis(style.bgWhite, DEFAULT_SHARE_CARD_STYLE.bgWhite)
    const rawBlur = Number(style.bgBlur)
    const bgBlurPx = Number.isFinite(rawBlur)
      ? Math.min(80, Math.max(0, Math.round(rawBlur)))
      : DEFAULT_SHARE_CARD_STYLE.bgBlur
    drawShareBlurredPhotoBackground(ctx, sideImg, w, h, {
      blurPx: bgBlurPx,
      imageOpacity: bgImageOpacity,
      blackAxis: bgBlack,
      whiteAxis: bgWhite,
    })
  } else if (isDarkCard) {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, lightenHex(cardBg, 0.06))
    g.addColorStop(0.45, cardBg)
    g.addColorStop(1, darkenHex(cardBg, 0.12))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    const lift = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, Math.max(w, h) * 0.55)
    lift.addColorStop(0, 'rgba(255,255,255,0.04)')
    lift.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = lift
    ctx.fillRect(0, 0, w, h)
  } else {
    ctx.fillStyle = cardBg
    ctx.fillRect(0, 0, w, h)
  }

  // News stamp BEHIND all content (bg → stamp → header/chart/text)
  // Whole-layer fade via drawShareNewsStamp offscreen composite
  {
    const movePctParsedEarly = parseShareMovePercent(moveText)
    const absMovePctEarly = movePctParsedEarly?.abs ?? null
    if (
      shouldDrawShareNewsStamp(
        style.newsStampMode,
        style.sessionLineTone,
        sessionLine,
        absMovePctEarly,
      )
    ) {
      const copy = resolveShareNewsStampCopy(style, isDown, absMovePctEarly)
      const ink = resolveShareNewsStampInkHex(style.newsStampColor, isDown)
      const rawStampD = Number(style.newsStampSize)
      const stampD = Math.round(
        (Number.isFinite(rawStampD) && rawStampD >= 100
          ? Math.min(1000, rawStampD)
          : DEFAULT_SHARE_CARD_STYLE.newsStampSize) * typeScale,
      )
      const px = Number(style.newsStampX)
      const py = Number(style.newsStampY)
      const stampCx =
        (w * (Number.isFinite(px) ? Math.min(100, Math.max(0, px)) : 50)) / 100
      const stampCy =
        (h * (Number.isFinite(py) ? Math.min(100, Math.max(0, py)) : 42)) / 100
      drawShareNewsStamp(ctx, stampCx, stampCy, stampD, {
        centerLines: copy.center,
        ringText: copy.ring,
        color: ink,
        rotationDeg: Number.isFinite(Number(style.newsStampRotation))
          ? Number(style.newsStampRotation)
          : -14,
        opacity: Number.isFinite(Number(style.newsStampOpacity))
          ? Number(style.newsStampOpacity)
          : 88,
        style: style.newsStampStyle === 'rect' ? 'rect' : 'circle',
        density: Number.isFinite(Number(style.newsStampDotDensity))
          ? Number(style.newsStampDotDensity)
          : 55,
      })
    }
  }

  const rightEdge = w - padX

  // --- Header row: logo + company ExtraBold left, % Bold right ---
  ctx.textBaseline = 'alphabetic'
  if (logoImg) {
    drawCircularLogo(ctx, logoImg, padX + logoSize / 2, bandMidY, logoSize)
  } else {
    drawLogoMonogram(ctx, symbol || titleText, padX + logoSize / 2, bandMidY, logoSize)
  }
  // styles.company — ExtraBold 56 / lh 64 / #111 / tracking -0.7 / max 2 lines
  ctx.fillStyle = bodyText
  ctx.font = nameFont
  setShareLetterSpacing(ctx, -0.7 * typeScale)
  let nameY =
    bandMidY - ((nameLines.length - 1) * nameLineH) / 2 + nameSize * 0.35
  for (const line of nameLines) {
    ctx.fillText(line, nameLeft, nameY)
    nameY += nameLineH
  }
  clearShareLetterSpacing(ctx)
  // One accent for BOTH the big % and the line chart (same up/down shade pickers).
  // Direction: % move flags first; if flat, fall back to series first→last slope.
  const chartLineDownFallback =
    chartSeries.length >= 2
      ? chartSeries[chartSeries.length - 1].close < chartSeries[0].close
      : false
  const accentIsDown = isDown ? true : isUp ? false : chartLineDownFallback
  const moveAccentHex = accentIsDown
    ? shareDownColorHex(style.downColorShade)
    : shareUpColorHex(style.upColorShade)

  if (moveText) {
    // styles.pct — Bold 80 · identical hex to chart line
    ctx.fillStyle = isDown || isUp || chartSeries.length >= 2 ? moveAccentHex : bodyText
    ctx.font = pctFont
    setShareLetterSpacing(ctx, -1.5 * typeScale)
    const tw = ctx.measureText(moveText).width
    ctx.fillText(moveText, rightEdge - tw, bandMidY + pctSize * 0.32)
    clearShareLetterSpacing(ctx)
  }

  // --- Under %: styles.price SemiBold 36 / lh 42 / #111 · tabular right ---
  const metaY = metaTop + Math.max(priceLineH, stampBesidePrice ? stampLineH : 0) * 0.85
  const separator = priceLabel && stampBesidePrice ? ' · ' : ''
  ctx.font = stampFont
  setShareLetterSpacing(ctx, -0.2 * typeScale)
  const stampText = stampBesidePrice ? `${separator}${stampLabel}` : ''
  const stampW = stampText ? ctx.measureText(stampText).width : 0
  clearShareLetterSpacing(ctx)
  ctx.font = priceFont
  const priceW = priceLabel ? ctx.measureText(priceLabel).width : 0
  const metaLeft = rightEdge - priceW - stampW
  if (priceLabel) {
    ctx.fillStyle = sharePriceFillColor(style.priceColor || 'black')
    ctx.font = priceFont
    ctx.fillText(priceLabel, metaLeft, metaY)
  }
  if (stampText) {
    ctx.fillStyle = mutedText
    ctx.font = stampFont
    setShareLetterSpacing(ctx, -0.2 * typeScale)
    ctx.fillText(stampText, metaLeft + priceW, metaY)
    clearShareLetterSpacing(ctx)
  }

  // Framed hero only for legacy placements — default is background-only (no image above/below header).
  if (sideImg && hasPhoto) {
    const photoW = Math.max(80, textMaxW - photoMarginX * 2)
    const photoX = padX + photoMarginX
    drawShareHeroPhoto(ctx, sideImg, photoX, photoTop, photoW, photoHeight, {
      radius: photoRadius,
      borderWidth: photoBorderWidth,
      borderColor: isDarkCard ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.72)',
      frost: photoFrost,
    })
  }
  // Chart line = same hex as the big % (moveAccentHex from up/down shade pickers)
  drawMiniChart(
    ctx,
    padX,
    chartTop,
    textMaxW,
    chartH,
    accentIsDown,
    `${symbol}-${event.event_date || ''}`,
    cardBg,
    {
      showTimeAxis: style.showChartTimeAxis !== false,
      showDayLabels: style.showChartDayLabels === true,
      session: chartSession,
      axisTextColor: mutedText,
      series: chartSeries.length >= 2 ? chartSeries : null,
      axisMode: style.chartAxisMode === 'timestamp' ? 'timestamp' : 'elapsed',
      axisTimezone: zone,
      maxAxisLabels: style.chartAxisLabelCount ?? 5,
      lineColor: moveAccentHex,
      pointLabelMode: style.chartPointLabelMode || 'off',
      priceLabelCount: style.chartPriceLabelCount ?? 4,
      priceLabelColor: mutedText,
      pointLabelsCustom: splitShareChartCustomLines(style.chartPointLabelsCustom),
      pointSubLabelsCustom: splitShareChartCustomLines(style.chartPointSubLabelsCustom),
      axisLabelsCustom: splitShareChartCustomLines(style.chartAxisLabelsCustom),
      axisFontSize: Math.round(
        (Number.isFinite(Number(style.chartAxisFontSize))
          ? Math.min(48, Math.max(10, Number(style.chartAxisFontSize)))
          : 18) * typeScale,
      ),
      pointFontSize: Math.round(
        (Number.isFinite(Number(style.chartPointFontSize))
          ? Math.min(48, Math.max(10, Number(style.chartPointFontSize)))
          : 16) * typeScale,
      ),
      dayLabelFontSize: Math.round(
        (Number.isFinite(Number(style.chartAxisFontSize))
          ? Math.min(40, Math.max(10, Number(style.chartAxisFontSize) - 2))
          : 14) * typeScale,
      ),
      timeDayGap: Math.round(timeDayGapPx * typeScale),
      dayLabelMode: clampShareChartDayLabelMode(style.chartDayLabelMode),
      lineWidth: Math.round(
        (Number.isFinite(Number(style.chartLineWidth)) && Number(style.chartLineWidth) > 0
          ? Math.min(24, Math.max(1, Number(style.chartLineWidth)))
          : DEFAULT_SHARE_CARD_STYLE.chartLineWidth) * typeScale,
      ),
    },
  )

  // styles.reasonTitle — SemiBold 52 / lh 66 / #111 / tracking -0.4
  if (sessionLines.length) {
    ctx.fillStyle = bodyText
    ctx.font = sessionFont
    setShareLetterSpacing(ctx, -0.4 * typeScale)
    let sy = sessionFirstY
    for (let i = 0; i < sessionLines.length; i += 1) {
      ctx.fillText(sessionLines[i], padX, sy)
      if (i < sessionLines.length - 1) sy += sessionLineH
    }
    clearShareLetterSpacing(ctx)
    // styles.reasonWhen — Medium 34 · “Today · 3:33 PM ET”
    if (stampUnderSession && stampLabel) {
      ctx.fillStyle = mutedText
      ctx.font = stampFont
      setShareLetterSpacing(ctx, -0.2 * typeScale)
      ctx.fillText(stampLabel, padX, sessionStampY)
      clearShareLetterSpacing(ctx)
    }
  }

  // styles.reasonDriver — Regular 40 / lh 54 / rgba(17,17,17,0.82) / tracking -0.25
  ctx.fillStyle = reasonFill
  ctx.font = reasonFont
  setShareLetterSpacing(ctx, -0.25 * typeScale)
  let ry = reasonFirstY
  for (let i = 0; i < reasonLines.length; i += 1) {
    ctx.fillText(reasonLines[i], padX, ry)
    if (i < reasonLines.length - 1) ry += reasonLineH
  }
  clearShareLetterSpacing(ctx)

  // Footer: Track at Trigger + store marks — placement left / right / center
  // Store modes: circle = both icons · badge = App Store badge only · hide = off
  // Brand text can be hidden independently via showBrand
  ctx.font = brandFont
  const brandW = brandLabel ? ctx.measureText(brandLabel).width : 0
  const storeBadgeOn = style.showStoreBadges !== false
  const storeStyle = style.storeBadgeStyle === 'badge' ? 'badge' : 'circle'
  const brandPlacement =
    style.brandPlacement === 'left' || style.brandPlacement === 'center'
      ? style.brandPlacement
      : 'right'
  const rawStoreIcon = Number(style.storeIconSize)
  const storeSize = Math.round(
    (Number.isFinite(rawStoreIcon) && rawStoreIcon >= 16
      ? Math.min(96, rawStoreIcon)
      : 36) * typeScale,
  )
  const rawStoreWScale = Number(style.storeIconWidthScale)
  const storeWidthScale =
    Number.isFinite(rawStoreWScale) && rawStoreWScale >= 0.5 && rawStoreWScale <= 2.5
      ? rawStoreWScale
      : 1
  const storeGap = Math.round(8 * typeScale)
  const storeToTextGap =
    brandLabel && storeBadgeOn ? Math.round(10 * typeScale) : 0

  let appStoreImg: HTMLImageElement | null = null
  let playStoreImg: HTMLImageElement | null = null
  if (storeBadgeOn) {
    if (storeStyle === 'badge') {
      appStoreImg = await loadShareStoreIcon('/share-icons/app-store-badge.svg')
    } else {
      ;[appStoreImg, playStoreImg] = await Promise.all([
        loadShareStoreIcon('/share-icons/app-store.webp'),
        loadShareStoreIcon('/share-icons/google-play.webp'),
      ])
    }
  }

  let storeBlockW = 0
  let badgeAppW = 0
  let circleIconW = storeSize
  if (storeBadgeOn) {
    if (storeStyle === 'badge') {
      // Official badge only — content-aware aspect (SVG / padded assets) × width scale
      const aspect = appStoreImg ? getImageOpaqueAspect(appStoreImg) : 3.37
      badgeAppW = storeSize * aspect * storeWidthScale
      storeBlockW = storeToTextGap + badgeAppW
    } else {
      circleIconW = storeSize * storeWidthScale
      storeBlockW = storeToTextGap + circleIconW * 2 + storeGap
    }
  }
  const brandBlockW = brandW + storeBlockW
  // If both brand text and store icons are hidden, still keep footer date placement
  const hasBrandRow = Boolean(brandLabel) || storeBadgeOn
  let brandX = w - padX - Math.max(brandBlockW, 1) // right (default)
  if (brandPlacement === 'left') {
    brandX = padX
  } else if (brandPlacement === 'center') {
    brandX = (w - Math.max(brandBlockW, 1)) / 2
  }

  // Date sits on the opposite side when brand is left/right; left when brand is center
  if (footerDate) {
    ctx.fillStyle = mutedText
    ctx.font = stampFont
    setShareLetterSpacing(ctx, -0.2 * typeScale)
    const dateW = ctx.measureText(footerDate).width
    let dateX = padX
    if (hasBrandRow && brandPlacement === 'left') {
      dateX = w - padX - dateW
    } else if (brandPlacement === 'center') {
      dateX = padX
    }
    ctx.fillText(footerDate, dateX, brandY)
    clearShareLetterSpacing(ctx)
  }

  if (brandLabel) {
    ctx.fillStyle = brandFill
    ctx.font = brandFont
    void brandLineH
    if (Math.abs(brandHeightScale - 1) > 0.01) {
      // Non-uniform height: scale Y around the text baseline
      ctx.save()
      ctx.translate(brandX, brandY)
      ctx.scale(1, brandHeightScale)
      ctx.fillText(brandLabel, 0, 0)
      ctx.restore()
    } else {
      ctx.fillText(brandLabel, brandX, brandY)
    }
  }

  if (storeBadgeOn) {
    const iconTop = brandY - storeSize * 0.78
    let ix = brandX + brandW + storeToTextGap
    if (storeStyle === 'badge') {
      // App Store badge only
      if (appStoreImg) {
        drawShareStoreBadge(ctx, appStoreImg, ix, iconTop, badgeAppW, storeSize)
      }
    } else {
      // Both circular icons — natural colors, optional width scale (non-square when ≠1)
      if (appStoreImg) {
        drawShareStoreIcon(ctx, appStoreImg, ix, iconTop, circleIconW, storeSize)
      }
      ix += circleIconW + storeGap
      if (playStoreImg) {
        drawShareStoreIcon(ctx, playStoreImg, ix, iconTop, circleIconW, storeSize)
      }
    }
  }

  // PNG at native canvas pixels (lossless Full HD / 2K / 4K — no downscale)
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png')
  })
  if (!blob) return null
  return {
    blob,
    objectUrl: URL.createObjectURL(blob),
    width: w,
    height: h,
  }
}

/** Cached App Store / Play badge images for the share footer. */
const shareStoreIconCache = new Map<string, HTMLImageElement | null>()
/** Opaque content aspect ratio (width/height) cache — for padded badge PNGs. */
const shareImageOpaqueAspectCache = new WeakMap<HTMLImageElement, number>()
/** Opaque content source rect cache for trimmed draw. */
const shareImageOpaqueRectCache = new WeakMap<
  HTMLImageElement,
  { sx: number; sy: number; sw: number; sh: number }
>()

async function loadShareStoreIcon(src: string): Promise<HTMLImageElement | null> {
  if (shareStoreIconCache.has(src)) return shareStoreIconCache.get(src) || null
  try {
    const img = await loadImageFromUrl(src)
    shareStoreIconCache.set(src, img)
    return img
  } catch {
    shareStoreIconCache.set(src, null)
    return null
  }
}

/** Find non-transparent bounding box of an image (for square badge assets with padding). */
function getImageOpaqueRect(img: HTMLImageElement): {
  sx: number
  sy: number
  sw: number
  sh: number
} {
  const cached = shareImageOpaqueRectCache.get(img)
  if (cached) return cached
  const iw = img.naturalWidth || img.width || 1
  const ih = img.naturalHeight || img.height || 1
  const full = { sx: 0, sy: 0, sw: iw, sh: ih }
  try {
    const c = document.createElement('canvas')
    c.width = iw
    c.height = ih
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) {
      shareImageOpaqueRectCache.set(img, full)
      return full
    }
    g.drawImage(img, 0, 0)
    const data = g.getImageData(0, 0, iw, ih).data
    let minX = iw
    let minY = ih
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < ih; y += 1) {
      for (let x = 0; x < iw; x += 1) {
        const a = data[(y * iw + x) * 4 + 3]
        if (a > 12) {
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < minX || maxY < minY) {
      shareImageOpaqueRectCache.set(img, full)
      return full
    }
    // Small pad so edges aren’t clipped
    const pad = 2
    const rect = {
      sx: Math.max(0, minX - pad),
      sy: Math.max(0, minY - pad),
      sw: Math.min(iw, maxX + pad + 1) - Math.max(0, minX - pad),
      sh: Math.min(ih, maxY + pad + 1) - Math.max(0, minY - pad),
    }
    shareImageOpaqueRectCache.set(img, rect)
    return rect
  } catch {
    shareImageOpaqueRectCache.set(img, full)
    return full
  }
}

function getImageOpaqueAspect(img: HTMLImageElement): number {
  const cached = shareImageOpaqueAspectCache.get(img)
  if (cached) return cached
  const rect = getImageOpaqueRect(img)
  const aspect = rect.sh > 0 ? rect.sw / rect.sh : 1
  // Clamp to sane store-badge range (avoid tiny/huge if detect fails)
  const clamped = Math.min(4.5, Math.max(0.8, aspect))
  shareImageOpaqueAspectCache.set(img, clamped)
  return clamped
}

/** Wide “Available on the App Store” style badge — natural colors, no recolor. */
function drawShareStoreBadge(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.save()
  // Draw only the opaque content rect so padded square PNGs fill the pill correctly
  const rect = getImageOpaqueRect(img)
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, x, y, w, h)
  ctx.restore()
}

/**
 * Store mark — natural asset colors only, no recolor, no forced background.
 * Soft circular clip so square assets read as round icons.
 */
function drawShareStoreIcon(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  /** Width (and height when height omitted) in canvas px. */
  width: number,
  /** Optional height — when omitted, icon is square (width × width). */
  height?: number,
) {
  const w = Math.max(1, width)
  const h = Math.max(1, height ?? width)
  const cx = x + w / 2
  const cy = y + h / 2
  // Ellipse clip so non-square width scales stay rounded
  const rx = w / 2
  const ry = h / 2

  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()

  const iw = img.naturalWidth || img.width || w
  const ih = img.naturalHeight || img.height || h
  const scale = Math.max(w / iw, h / ih)
  const dw = iw * scale
  const dh = ih * scale
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh)
  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function formatLogTime(iso: string) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatUsdCompact(cost?: number | null, display?: string | null) {
  if (display && String(display).trim()) return String(display).trim()
  const n = Number(cost) || 0
  if (n > 0 && n < 0.000001) return `~$${n.toExponential(2)}`
  return `$${n.toFixed(6)}`
}

function sumEventsGeminiUsage(events?: PriceMovementEvent[] | null): GeminiUsageTotals {
  let prompt = 0
  let output = 0
  let thoughts = 0
  let total = 0
  let credits = 0
  let cost = 0
  let dated = 0
  for (const event of events || []) {
    const t = Number(event.gemini_total_tokens) || 0
    const c = Number(event.gemini_cost_usd) || 0
    if (t > 0 || c > 0 || event.gemini_formating || event.gemini_classified_at) dated += 1
    prompt += Number(event.gemini_prompt_tokens) || 0
    output += Number(event.gemini_output_tokens) || 0
    thoughts += Number(event.gemini_thoughts_tokens) || 0
    total += t
    credits += Number(event.gemini_credits_used) || 0
    cost += c
  }
  cost = Math.round(cost * 1e8) / 1e8
  return {
    dates_with_gemini: dated,
    prompt_tokens: prompt,
    output_tokens: output,
    thoughts_tokens: thoughts,
    total_tokens: total,
    credits_used: credits,
    cost_usd: cost,
    cost_usd_display: formatUsdCompact(cost),
  }
}

function eventGeminiTagCost(event: PriceMovementEvent) {
  const last = Number(event.gemini_last_cost_usd) || 0
  if (last > 0 || event.gemini_last_cost_usd_display) {
    return formatUsdCompact(last, event.gemini_last_cost_usd_display)
  }
  const cum = Number(event.gemini_cost_usd) || 0
  if (cum > 0 || event.gemini_cost_usd_display) {
    return formatUsdCompact(cum, event.gemini_cost_usd_display)
  }
  return null
}

/**
 * Short label for Gemini model ids, e.g.
 * "models/gemini-2.5-flash" → "2.5 Flash"
 * "gemini-3.0-flash-preview" → "3.0 Flash"
 */
function formatGeminiModelLabel(model?: string | null) {
  if (!model) return null
  let raw = String(model).trim()
  if (!raw) return null
  raw = raw.replace(/^models\//i, '')
  raw = raw.replace(/^gemini[-_]?/i, '')
  raw = raw.replace(/[-_]?preview$/i, '')
  raw = raw.replace(/[-_]?latest$/i, '')
  raw = raw.replace(/[-_]+/g, ' ').trim()
  if (!raw) return null
  const pretty = raw
    .split(/\s+/)
    .map((part) => {
      if (/^\d+(\.\d+)*$/.test(part)) return part
      if (part.length <= 3) return part.toUpperCase()
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join(' ')
  return pretty
}

/** e.g. "8 May 2026" (+ optional time label) */
function formatEventHeading(event: PriceMovementEvent) {
  try {
    const d = new Date(`${event.event_date}T12:00:00Z`)
    if (!Number.isNaN(d.getTime())) {
      const base = d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
      return event.time_label ? `${base} · ${event.time_label}` : base
    }
  } catch {
    /* fall through */
  }
  if (event.display_date) {
    return event.time_label ? `${event.display_date} · ${event.time_label}` : event.display_date
  }
  return event.event_date
}

const TICKER_SORT_OPTIONS: Array<{ id: TickerSortMode; label: string }> = [
  { id: 'subscribers', label: 'Subscribers (high → low)' },
  { id: 'movement', label: 'Absolute % movement (largest first)' },
  { id: 'movement_pos_to_neg', label: 'Movement: positive → negative' },
  { id: 'movement_neg_to_pos', label: 'Movement: negative → positive' },
  { id: 'name', label: 'Company name (A → Z)' },
  { id: 'ticker', label: 'Ticker (A → Z)' },
  { id: 'saved', label: 'Saved dates (high → low)' },
]

const TICKER_SORT_PREF_KEY = 'notifications-ticker-sort'
const EXTREME_PINNED_PREF_KEY = 'notifications-extreme-pinned-v1'

/** Local cache only — source of truth is pinned_monitored_tickers via API. */
function cacheExtremePinned(items: ExtremePinnedItem[]) {
  try {
    writePref(
      EXTREME_PINNED_PREF_KEY,
      JSON.stringify(
        items.map((row) => ({
          ticker: row.ticker,
          company_name: row.company_name,
          pinned_at: row.pinned_at,
          change_percent: row.change_percent ?? null,
          currency: row.currency ?? null,
        })),
      ),
    )
  } catch {
    /* localStorage unavailable */
  }
}

function loadExtremePinnedCache(): ExtremePinnedItem[] {
  try {
    const raw = readPref(EXTREME_PINNED_PREF_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((row): ExtremePinnedItem | null => {
        const ticker = String(row?.ticker || '')
          .trim()
          .toUpperCase()
        if (!ticker) return null
        return {
          ticker,
          company_name: String(row?.company_name || ticker).trim() || ticker,
          pinned_at: String(row?.pinned_at || new Date().toISOString()),
          change_percent:
            row?.change_percent == null || !Number.isFinite(Number(row.change_percent))
              ? null
              : Number(row.change_percent),
          currency: row?.currency ? String(row.currency) : null,
          monitor_scope: 'pinned',
        }
      })
      .filter((row): row is ExtremePinnedItem => Boolean(row))
  } catch {
    return []
  }
}

function loadTickerSortPreference(): TickerSortMode {
  try {
    const saved = readPref(TICKER_SORT_PREF_KEY) as TickerSortMode | null
    return TICKER_SORT_OPTIONS.some((option) => option.id === saved)
      ? saved as TickerSortMode
      : 'subscribers'
  } catch {
    return 'subscribers'
  }
}

/** Display/edit sources as names on one row (no multi-line list). */
function serializeSourcesDraft(sources?: MovementSource[] | null): string {
  return (sources || [])
    .map((s) => String(s.title || s.domain || '').trim())
    .filter(Boolean)
    .join(' · ')
}

/**
 * Parse a single-row source string back to sources.
 * Accepts: "Bloomberg · Reuters · CNBC", commas, newlines, or legacy `Title | url`.
 * Keeps URL/domain from previous sources when the name still matches.
 */
function parseSourcesDraft(
  text: string,
  previousSources?: MovementSource[] | null,
): MovementSource[] {
  const prev = previousSources || []
  // Split one row: middot / bullet / pipe-as-separator / comma / newlines.
  // Do not split on `|` when it's `Title | https://…` (handled per token below).
  const tokens = String(text || '')
    .split(/\r?\n|·|•|,(?!\s*Inc\.?\b)|(?<=\S)\s+[|]\s+(?=[A-Za-z0-9])/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      // Legacy multi-line paste still works; also "A | B | C" name lists without URLs.
      if (/https?:\/\//i.test(line) && line.includes('|')) return [line]
      if (line.includes('|') && !/^https?:\/\//i.test(line.split('|').pop() || '')) {
        return line.split('|').map((p) => p.trim()).filter(Boolean)
      }
      return [line]
    })

  return tokens.map((line, index) => {
    const parts = line.split('|').map((p) => p.trim())
    if (parts.length >= 2) {
      const urlPart = parts[parts.length - 1]
      const title = parts.slice(0, -1).join(' | ').trim()
      const looksUrl = /^https?:\/\//i.test(urlPart)
      let domain: string | null = null
      if (looksUrl) {
        try {
          domain = new URL(urlPart).hostname.replace(/^www\./i, '')
        } catch {
          domain = null
        }
      }
      return {
        title: title || domain || urlPart,
        url: looksUrl ? urlPart : null,
        domain,
      }
    }
    if (/^https?:\/\//i.test(line)) {
      try {
        const host = new URL(line).hostname.replace(/^www\./i, '')
        return { title: host, url: line, domain: host }
      } catch {
        return { title: line, url: line, domain: null }
      }
    }
    const nameKey = line.toLowerCase()
    const byName = prev.find((p) => {
      const t = String(p.title || '').trim().toLowerCase()
      const d = String(p.domain || '').trim().toLowerCase()
      return t === nameKey || d === nameKey
    })
    const byIndex = prev[index]
    const keep = byName || byIndex
    return {
      title: line,
      url: keep?.url || null,
      domain: keep?.domain || null,
    }
  })
}

/** Compact one-row source chips (links when URL known). */
function EventSourcesRow({
  sources,
  draft,
  onDraftChange,
  onBlur,
  disabled,
}: {
  sources: MovementSource[]
  draft?: string
  onDraftChange: (value: string) => void
  onBlur: () => void
  disabled?: boolean
}) {
  const display =
    draft != null ? draft : serializeSourcesDraft(sources)
  const parsed = parseSourcesDraft(display, sources)
  const [editing, setEditing] = useState(false)

  if (editing || !parsed.length) {
    return (
      <Input
        value={display}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={() => {
          setEditing(false)
          onBlur()
        }}
        onFocus={() => setEditing(true)}
        placeholder="Bloomberg · Reuters · CNBC"
        disabled={disabled}
        className="h-8 text-xs"
        aria-label="Sources"
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {parsed.map((source, index) => {
        const label = source.title || source.domain || 'Source'
        const href =
          source.url ||
          (source.domain ? `https://${source.domain}` : null)
        const chipClass =
          'inline-flex max-w-[12rem] items-center truncate rounded-full border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted'
        if (href) {
          return (
            <a
              key={`${label}-${index}`}
              href={href}
              target="_blank"
              rel="noreferrer"
              className={cn(chipClass, 'text-sky-700 hover:underline dark:text-sky-300')}
              title={href}
            >
              {label}
            </a>
          )
        }
        return (
          <span key={`${label}-${index}`} className={chipClass} title={label}>
            {label}
          </span>
        )
      })}
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={disabled}
        className="inline-flex size-6 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        title="Edit sources"
        aria-label="Edit sources"
      >
        <PenLine className="size-3" />
      </button>
    </div>
  )
}

/** Format price for share card (keep $ if present). */
function formatSharePriceLabel(price?: string | null): string {
  const raw = String(price || '').trim()
  if (!raw) return ''
  if (raw.startsWith('$')) return raw
  if (/^\d/.test(raw)) return `$${raw}`
  return raw
}

type SocialPlatformId = 'x' | 'stocktwits' | 'whatsapp' | 'instagram'

function SocialBrandIcon({
  id,
  className,
}: {
  id: SocialPlatformId
  className?: string
}) {
  const cn = className || 'size-5'
  switch (id) {
    case 'x':
      return (
        <svg viewBox="0 0 24 24" className={cn} fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
        </svg>
      )
    case 'stocktwits':
      // Simple-icons style StockTwits mark
      return (
        <svg viewBox="0 0 24 24" className={cn} fill="currentColor" aria-hidden>
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 14.114c-.265.586-.86 1.052-1.626 1.052-.22 0-.444-.038-.662-.12-.461-.171-.826-.469-1.051-.843a1.82 1.82 0 0 1-.248-.95v-.08H12.48l-.288 3.11h1.592V24h3.414v-8.886h3.992l.288-3.11h-3.84l.042-.42c.096-.97.41-1.51 1.415-1.51.256 0 .552.038.793.104l.477-3.08a6.11 6.11 0 0 0-1.433-.187c-2.372 0-3.756 1.406-3.756 3.906v.48H13.1l-.288 3.11h1.592v1.597c0 .72.288 1.12.91 1.12.36 0 .648-.16.838-.58l.742 1.06zM5.54 19.34H1.656L4.32 4.91H.786L1.13 1.78h8.036L5.54 19.34z" />
        </svg>
      )
    case 'whatsapp':
      return (
        <svg viewBox="0 0 24 24" className={cn} fill="currentColor" aria-hidden>
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" className={cn} fill="currentColor" aria-hidden>
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
        </svg>
      )
    default:
      return null
  }
}

const SOCIAL_PLATFORMS: Array<{
  id: SocialPlatformId
  label: string
  hint: string
}> = [
  { id: 'x', label: 'X', hint: 'Open X with tweet 1 prefilled; image copied' },
  {
    id: 'stocktwits',
    label: 'StockTwits',
    hint: 'Open StockTwits symbol page; image copied — paste + use Copy Tweet 1 for caption',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    hint: 'Open WhatsApp Desktop with tweet 1; image copied (paste ⌘V)',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    hint: 'Open Instagram; image copied — web cannot auto-open Create post with media',
  },
]

/** Section body inside a layout tab (hint only — title lives on the tab). */
function ShareLayoutSection({
  title: _title,
  hint,
  children,
  first: _first,
}: {
  title: string
  hint?: string
  children: ReactNode
  first?: boolean
}) {
  void _title
  void _first
  return (
    <section className="space-y-2.5 pt-0.5">
      {hint ? (
        <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

/** Tab ids for image layout settings (sorted). */
type ShareLayoutTabId =
  | 'photo'
  | 'text'
  | 'session'
  | 'colors'
  | 'spacing'
  | 'type'
  | 'canvas'
  | 'timestamp'
  | 'brand'
  | 'chart'
  | 'store'
  | 'seal'
  | 'weight'

/** Shared image layout sliders (tweet composer + social share). */
function ShareCardLayoutControls({
  style,
  onChange,
  idPrefix,
  textContent,
  onTextChange,
  onTextReset,
  sideImageDataUrl,
  onSideImageChange,
  googleSearchQuery,
  titleIdentity,
  shareEvent: _shareEvent,
  exchangeTimeZone,
  exchangeTimeZoneLabel,
}: {
  style: ShareCardStyle
  onChange: (next: ShareCardStyle | ((prev: ShareCardStyle) => ShareCardStyle)) => void
  idPrefix: string
  /** Live-editable strings drawn on the share image */
  textContent?: ShareCardTextContent | null
  onTextChange?: (next: ShareCardTextContent) => void
  onTextReset?: () => void
  /** Side photo (data URL) drawn at ~30% width next to the chart */
  sideImageDataUrl?: string | null
  onSideImageChange?: (dataUrl: string | null) => void
  /** Opens Google Images — usually company name */
  googleSearchQuery?: string
  /** Used when toggling company name ↔ ticker on the image */
  titleIdentity?: { ticker: string; companyName?: string | null }
  /** Event used to rebuild the auto timestamp when exchange zone is known */
  shareEvent?: PriceMovementEvent
  /** Listing exchange IANA zone (e.g. America/New_York) — stamps always use this */
  exchangeTimeZone?: string | null
  exchangeTimeZoneLabel?: string | null
}) {
  const set = (patch: Partial<ShareCardStyle>) =>
    onChange((s) => {
      const next = { ...s, ...patch }
      saveShareCardStyle(next)
      return next
    })
  const setText = (patch: Partial<ShareCardTextContent>) => {
    if (!textContent || !onTextChange) return
    onTextChange({ ...textContent, sessionLine: textContent.sessionLine ?? '', ...patch })
  }
  const applyTitleMode = (mode: 'company' | 'ticker') => {
    set({ titleMode: mode })
    if (!textContent || !onTextChange) return
    const symbol = String(titleIdentity?.ticker || '')
      .toUpperCase()
      .replace(/[^A-Z0-9.^_=\-]/g, '')
    const company =
      String(titleIdentity?.companyName || '').trim() ||
      (symbol ? shareCompanyNameCache.get(symbol) : '') ||
      symbol
    const nextTitle = mode === 'ticker' ? symbol || textContent.title : company || textContent.title
    onTextChange({ ...textContent, sessionLine: textContent.sessionLine ?? '', title: nextTitle })
  }
  const pasteSideRef = useRef<HTMLDivElement | null>(null)

  const [sidePasteBusy, setSidePasteBusy] = useState(false)
  const [sidePasteHint, setSidePasteHint] = useState('')
  const [layoutTab, setLayoutTab] = useState<ShareLayoutTabId>(() =>
    textContent && onTextChange ? 'text' : onSideImageChange ? 'photo' : 'colors',
  )

  const layoutTabs = useMemo(() => {
    const all: Array<{ id: ShareLayoutTabId; label: string; show?: boolean }> = [
      { id: 'photo', label: 'Background', show: Boolean(onSideImageChange) },
      { id: 'text', label: 'Text', show: Boolean(textContent && onTextChange) },
      { id: 'session', label: 'Session' },
      { id: 'colors', label: 'Colors' },
      { id: 'spacing', label: 'Spacing' },
      { id: 'type', label: 'Type' },
      { id: 'canvas', label: 'Canvas' },
      { id: 'timestamp', label: 'Timestamp' },
      { id: 'brand', label: 'Brand' },
      { id: 'chart', label: 'Chart' },
      { id: 'store', label: 'Store' },
      { id: 'seal', label: 'Stamp' },
      { id: 'weight', label: 'Weight' },
    ]
    return all.filter((t) => t.show !== false)
  }, [onSideImageChange, textContent, onTextChange])

  // If current tab is hidden (e.g. no photo controls), fall back
  useEffect(() => {
    if (!layoutTabs.some((t) => t.id === layoutTab) && layoutTabs[0]) {
      setLayoutTab(layoutTabs[0].id)
    }
  }, [layoutTabs, layoutTab])

  async function handleSidePaste(e: ReactClipboardEvent<HTMLDivElement | HTMLInputElement>) {
    if (!onSideImageChange) return
    const source = extractImageFromClipboard(e.clipboardData)
    if (!source.blob && !source.url) {
      setSidePasteHint('No image found — use “Copy image” (not copy link) on Google Images.')
      return
    }
    e.preventDefault()
    e.stopPropagation()
    setSidePasteBusy(true)
    setSidePasteHint('')
    try {
      const dataUrl = await dataUrlOrBlobFromPasteSource(source, 1200)
      onSideImageChange(dataUrl)
      set({ photoPlacement: 'background' })
      setSidePasteHint('Full-bleed background — Black / White axes −100…+100.')
    } catch (err) {
      setSidePasteHint(
        err instanceof Error
          ? err.message
          : 'Paste failed. Copy the image itself, then paste here.',
      )
    } finally {
      setSidePasteBusy(false)
    }
  }

  function openGoogleImages() {
    const q = String(googleSearchQuery || textContent?.title || '').trim() || 'stock'
    const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-0.5">
      <div className="mb-0 flex shrink-0 items-center justify-between gap-2 border-b border-border/60 pb-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Image layout
          </p>
          <p className="text-[10px] text-muted-foreground">
            Tabs · click a section · preview updates live
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => {
            const next = { ...DEFAULT_SHARE_CARD_STYLE }
            saveShareCardStyle(next)
            onChange(next)
          }}
        >
          Reset defaults
        </Button>
      </div>

      {/* Tab bar */}
      <div
        className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border/50 py-1.5 scrollbar-thin"
        role="tablist"
        aria-label="Layout setting sections"
      >
        {layoutTabs.map((t) => {
          const active = layoutTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setLayoutTab(t.id)}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                active
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Active tab panel */}
      <div className="min-h-0 flex-1 overflow-y-auto py-2.5 pr-0.5" role="tabpanel">
      {onSideImageChange && layoutTab === 'photo' ? (
        <ShareLayoutSection
          first
          title="1 · Digital background"
          hint="Full-bleed image. Black and White axes both −100…+100 (0 = neutral)."
        >
          <div className="flex items-center justify-end gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 min-w-7 px-2 text-xs font-bold"
                title={
                  googleSearchQuery
                    ? `Google Images: “${googleSearchQuery}”`
                    : 'Open Google Images'
                }
                onClick={openGoogleImages}
              >
                G
              </Button>
              {sideImageDataUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => onSideImageChange(null)}
                >
                  Clear
                </Button>
              ) : null}
          </div>
          <div
            ref={pasteSideRef}
            tabIndex={0}
            onPaste={handleSidePaste}
            onClick={() => pasteSideRef.current?.focus()}
            className={cn(
              'flex min-h-[5rem] cursor-text flex-col items-center justify-center gap-2 border-2 border-dashed px-3 py-3 text-center transition-colors',
              'border-sky-500/45 bg-sky-500/5 hover:border-sky-500/70 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-500/30',
            )}
            role="textbox"
            aria-label="Paste digital background image"
          >
            {sidePasteBusy ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Reading clipboard…
              </span>
            ) : sideImageDataUrl ? (
              <img
                src={sideImageDataUrl}
                alt="Background preview"
                className="max-h-32 w-auto max-w-full rounded-md object-cover opacity-90"
              />
            ) : (
              <p className="text-[11px] font-medium text-foreground/85">
                Click here, then paste background image (⌘V / Ctrl+V)
              </p>
            )}
          </div>
          {sidePasteHint ? (
            <p
              className={cn(
                'text-[10px] leading-snug',
                sideImageDataUrl
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-amber-700 dark:text-amber-300',
              )}
            >
              {sidePasteHint}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`${idPrefix}-side-paste`}
              type="text"
              className="h-8 min-w-0 flex-1 text-xs"
              placeholder="Or focus here and paste image…"
              onPaste={handleSidePaste}
              value=""
              onChange={() => {
                /* keep empty — paste only */
              }}
              aria-label="Paste background image input"
            />
            <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted">
              Choose file
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file || !onSideImageChange) return
                  setSidePasteBusy(true)
                  setSidePasteHint('')
                  void blobToLogoDataUrl(file, 1200)
                    .then((dataUrl) => {
                      onSideImageChange(dataUrl)
                      set({ photoPlacement: 'background' })
                      setSidePasteHint(
                        'Full-bleed background. Use “Crisp clear” for sharp social posts (blur 0, no veil).',
                      )
                    })
                    .catch((err) => {
                      setSidePasteHint(
                        err instanceof Error ? err.message : 'Could not read image file',
                      )
                    })
                    .finally(() => setSidePasteBusy(false))
                }}
              />
            </label>
          </div>

          {sideImageDataUrl ? (
            <div className="space-y-2.5 border-t border-border/40 pt-2">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-2">
                <p className="text-[11px] font-semibold text-foreground">
                  Full-bleed photo · clarity
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                  For sharp social posts: use <strong>Crisp clear</strong> (blur 0, no black/white
                  veil). Raise blur or black only if you want a soft / faded look.
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Label htmlFor={`${idPrefix}-bg-img-op`} className="text-xs font-medium">
                    Background image opacity
                  </Label>
                  <span className="tabular-nums text-muted-foreground">
                    {style.bgImageOpacity ?? 100}%
                  </span>
                </div>
                <input
                  id={`${idPrefix}-bg-img-op`}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={style.bgImageOpacity ?? 100}
                  onChange={(e) => set({ bgImageOpacity: Number(e.target.value) })}
                  className="w-full accent-foreground"
                />
                <p className="text-[10px] text-muted-foreground">
                  100% = full photo · lower = more solid card color showing through (looks faded)
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Label htmlFor={`${idPrefix}-bg-blur`} className="text-xs font-medium">
                    Background blur (clarity)
                  </Label>
                  <span className="tabular-nums text-muted-foreground">
                    {style.bgBlur ?? 0}px
                    {(style.bgBlur ?? 0) <= 0 ? ' · crisp' : ''}
                  </span>
                </div>
                <input
                  id={`${idPrefix}-bg-blur`}
                  type="range"
                  min={0}
                  max={80}
                  step={1}
                  value={style.bgBlur ?? 0}
                  onChange={(e) => set({ bgBlur: Number(e.target.value) })}
                  className="w-full accent-foreground"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0 sharp / clear</span>
                  <span>soft glass</span>
                  <span>80 heavy blur</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Label htmlFor={`${idPrefix}-bg-black`} className="text-xs font-medium">
                    Black veil
                  </Label>
                  <span className="tabular-nums text-muted-foreground">
                    {(style.bgBlack ?? 0) > 0 ? '+' : ''}
                    {style.bgBlack ?? 0}
                  </span>
                </div>
                <input
                  id={`${idPrefix}-bg-black`}
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={style.bgBlack ?? 0}
                  onChange={(e) => set({ bgBlack: Number(e.target.value) })}
                  className="w-full accent-foreground"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>−100 lift / less black</span>
                  <span>0 none</span>
                  <span>+100 heavy fade</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Label htmlFor={`${idPrefix}-bg-white`} className="text-xs font-medium">
                    White wash
                  </Label>
                  <span className="tabular-nums text-muted-foreground">
                    {(style.bgWhite ?? 0) > 0 ? '+' : ''}
                    {style.bgWhite ?? 0}
                  </span>
                </div>
                <input
                  id={`${idPrefix}-bg-white`}
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={style.bgWhite ?? 0}
                  onChange={(e) => set({ bgWhite: Number(e.target.value) })}
                  className="w-full accent-foreground"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>−100 crush highlights</span>
                  <span>0 none</span>
                  <span>+100 bright wash</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="h-7 text-[11px]"
                  onClick={() =>
                    set({
                      bgImageOpacity: 100,
                      bgBlur: 0,
                      bgBlack: 0,
                      bgWhite: 0,
                    })
                  }
                >
                  Crisp clear
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() =>
                    set({ bgImageOpacity: 100, bgBlur: 0, bgBlack: 0, bgWhite: 0 })
                  }
                >
                  Neutral 0 / 0
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() =>
                    set({ bgImageOpacity: 100, bgBlur: 18, bgBlack: 20, bgWhite: 0 })
                  }
                >
                  Soft glass
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() =>
                    set({ bgImageOpacity: 100, bgBlur: 28, bgBlack: 35, bgWhite: 0 })
                  }
                >
                  Soft black
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() =>
                    set({ bgImageOpacity: 100, bgBlur: 36, bgBlack: 70, bgWhite: -15 })
                  }
                >
                  Dark mood
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() =>
                    set({ bgImageOpacity: 100, bgBlur: 8, bgBlack: -20, bgWhite: 40 })
                  }
                >
                  Bright
                </Button>
              </div>
            </div>
          ) : null}
        </ShareLayoutSection>
      ) : null}

      {textContent && onTextChange && layoutTab === 'text' ? (
        <ShareLayoutSection
          first
          title="2 · Text on image"
          hint="Only these strings are drawn. Reason = Likely driver only (no Secondary)."
        >
          <div className="flex items-center justify-end">
            {onTextReset ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={onTextReset}
              >
                Reset text
              </Button>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-txt-title`} className="text-xs font-medium">
              Title
            </Label>
            <Input
              id={`${idPrefix}-txt-title`}
              value={textContent.title}
              onChange={(e) => setText({ title: e.target.value })}
              className="h-8 text-sm"
              placeholder="Company or ticker"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-txt-pct`} className="text-xs font-medium">
                Percentage
              </Label>
              <Input
                id={`${idPrefix}-txt-pct`}
                value={textContent.percent}
                onChange={(e) => setText({ percent: e.target.value })}
                className="h-8 text-sm tabular-nums"
                placeholder="+4.2%"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-txt-price`} className="text-xs font-medium">
                Price
              </Label>
              <Input
                id={`${idPrefix}-txt-price`}
                value={textContent.price}
                onChange={(e) => setText({ price: e.target.value })}
                className="h-8 text-sm tabular-nums"
                placeholder="$189.50"
              />
            </div>
          </div>
          <div className="space-y-1.5 border-t border-border/40 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs font-medium">
                Session first line
              </Label>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={style.showSessionHeadline !== false ? 'default' : 'outline'}
                  className="h-7 text-[11px]"
                  onClick={() => set({ showSessionHeadline: true })}
                >
                  Inserted
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={style.showSessionHeadline === false ? 'default' : 'outline'}
                  className="h-7 text-[11px]"
                  onClick={() => set({ showSessionHeadline: false })}
                >
                  Remove
                </Button>
              </div>
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Default: “…so far in regular trading”. Timestamp sits under it when on.
            </p>
            {style.showSessionHeadline !== false ? (
              <>
                <Input
                  id={`${idPrefix}-txt-session`}
                  value={textContent.sessionLine ?? ''}
                  onChange={(e) => setText({ sessionLine: e.target.value })}
                  className="h-8 text-sm"
                  placeholder="$NVDA +4.2% so far in regular trading"
                />
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Line tone (by move size)
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { id: 'classic' as const, label: 'Classic' },
                        { id: 'intensity' as const, label: 'Intensity' },
                        { id: 'breaking' as const, label: 'Breaking' },
                        { id: 'punchy' as const, label: 'Punchy' },
                      ] as const
                    ).map((tone) => (
                      <Button
                        key={tone.id}
                        type="button"
                        size="sm"
                        variant={
                          (style.sessionLineTone || 'classic') === tone.id
                            ? 'default'
                            : 'outline'
                        }
                        className="h-7 text-[11px]"
                        onClick={() => {
                          set({ sessionLineTone: tone.id })
                          const symbol = String(titleIdentity?.ticker || '')
                            .toUpperCase()
                            .replace(/[^A-Z0-9.^_=\-]/g, '')
                          const session = inferShareChartSession(
                            {
                              summary: textContent.sessionLine || textContent.reason || '',
                              time_label: textContent.stamp || '',
                            } as PriceMovementEvent,
                            textContent.sessionLine || '',
                          )
                          const opts = buildShareSessionLineOptions({
                            ticker: symbol || textContent.title || 'TICKER',
                            moveText: textContent.percent || '',
                            session,
                            geminiLine: textContent.sessionLine,
                          })
                          const line = pickShareSessionLineByTone(opts, tone.id)
                          if (line) setText({ sessionLine: line })
                        }}
                      >
                        {tone.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Bands: &lt;5% mild · 5–10% solid · 10–15% strong · 15–25% huge · 25%+ extreme.
                    Classic keeps “…so far in regular trading”.
                  </p>
                  {(() => {
                    const symbol = String(titleIdentity?.ticker || '')
                      .toUpperCase()
                      .replace(/[^A-Z0-9.^_=\-]/g, '')
                    const session = inferShareChartSession(
                      {
                        summary: textContent.sessionLine || textContent.reason || '',
                        time_label: textContent.stamp || '',
                      } as PriceMovementEvent,
                      textContent.sessionLine || '',
                    )
                    const opts = buildShareSessionLineOptions({
                      ticker: symbol || textContent.title || 'TICKER',
                      moveText: textContent.percent || '',
                      session,
                      geminiLine: textContent.sessionLine,
                    })
                    if (opts.length <= 1) return null
                    return (
                      <div className="space-y-1">
                        <p className="text-[10px] font-medium text-muted-foreground">
                          Try a line
                        </p>
                        <div className="flex flex-col gap-1">
                          {opts.map((opt) => {
                            const active =
                              (textContent.sessionLine || '').trim() === opt.line
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => setText({ sessionLine: opt.line })}
                                className={
                                  active
                                    ? 'rounded-md border border-foreground bg-foreground/5 px-2 py-1.5 text-left text-[11px] leading-snug'
                                    : 'rounded-md border border-border/60 px-2 py-1.5 text-left text-[11px] leading-snug hover:bg-muted/50'
                                }
                              >
                                <span className="mr-1.5 font-semibold text-muted-foreground">
                                  {opt.label}
                                </span>
                                <span>{opt.line}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}
                </div>
                <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-2">
                  Font size · weight · margins (above/below) → open the{' '}
                  <strong>Session</strong> tab.
                </p>
              </>
            ) : null}
          </div>
          <div className="space-y-1 border-t border-border/40 pt-2">
            <Label htmlFor={`${idPrefix}-txt-reason`} className="text-xs font-medium">
              Reason (Likely driver only)
            </Label>
            <Textarea
              id={`${idPrefix}-txt-reason`}
              value={textContent.reason}
              onChange={(e) => setText({ reason: e.target.value })}
              rows={4}
              className="min-h-[5.5rem] resize-y text-sm leading-relaxed"
              placeholder="Likely driver text only — no Secondary / classification…"
            />
            <p className="text-[10px] text-muted-foreground">
              Share image shows only the Likely driver body (label stripped). Secondary stays in
              the event Reason field, not on the card.
            </p>
          </div>
          <div className="space-y-1.5 border-t border-border/40 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor={`${idPrefix}-txt-stamp`} className="text-xs font-medium">
                Timestamp
              </Label>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={style.showTimestamp !== false ? 'default' : 'outline'}
                  className="h-7 text-[11px]"
                  onClick={() => set({ showTimestamp: true })}
                >
                  Inserted
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={style.showTimestamp === false ? 'default' : 'outline'}
                  className="h-7 text-[11px]"
                  onClick={() => set({ showTimestamp: false })}
                >
                  Remove
                </Button>
              </div>
            </div>
            {style.showTimestamp !== false ? (
              <>
                <Input
                  id={`${idPrefix}-txt-stamp`}
                  value={textContent.stamp}
                  onChange={(e) => setText({ stamp: e.target.value })}
                  className="h-8 text-sm"
                  placeholder="Today · 3:03 PM ET"
                />
                <p className="text-[10px] text-muted-foreground">
                  Edit freely. Clear the field to drop it from this image. Timezone (Chart tab)
                  still converts until you type a custom string.
                </p>
              </>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Hidden on the image. Placement and font stay under the{' '}
                <strong>Timestamp</strong> tab.
              </p>
            )}
          </div>
          <div className="space-y-1 border-t border-border/40 pt-2">
            <Label htmlFor={`${idPrefix}-txt-brand`} className="text-xs font-medium">
              Track at Trigger
            </Label>
            <Input
              id={`${idPrefix}-txt-brand`}
              value={textContent.brand}
              onChange={(e) => setText({ brand: e.target.value })}
              className="h-8 text-sm"
              placeholder="Track at Trigger"
            />
          </div>
        </ShareLayoutSection>
      ) : null}

      {layoutTab === 'session' ? (
        <ShareLayoutSection
          first
          title="Session line"
          hint="“…so far in regular trading” — font size, weight, line height, margins."
        >
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={style.showSessionHeadline !== false ? 'default' : 'outline'}
              className="h-7 text-[11px]"
              onClick={() => set({ showSessionHeadline: true })}
            >
              Show on card
            </Button>
            <Button
              type="button"
              size="sm"
              variant={style.showSessionHeadline === false ? 'default' : 'outline'}
              className="h-7 text-[11px]"
              onClick={() => set({ showSessionHeadline: false })}
            >
              Hide
            </Button>
          </div>

          {style.showSessionHeadline !== false ? (
            <>
              {(
                [
                  {
                    id: 'sess-fs',
                    label: 'Font size',
                    key: 'sessionFontSize' as const,
                    min: 22,
                    max: 140,
                    step: 1,
                    unit: 'px',
                    hint: '',
                  },
                  {
                    id: 'sess-lh',
                    label: 'Line height',
                    key: 'sessionLineHeight' as const,
                    min: 1,
                    max: 1.8,
                    step: 0.05,
                    unit: '×',
                    hint: '',
                  },
                  {
                    id: 'sess-mt',
                    label: 'Margin above session',
                    key: 'sessionMarginTop' as const,
                    min: 0,
                    max: 120,
                    step: 1,
                    unit: 'px',
                    hint: 'Space above the session line.',
                  },
                  {
                    id: 'sess-mb',
                    label: 'Session ↔ reason gap',
                    key: 'sessionMarginBottom' as const,
                    min: 0,
                    max: 160,
                    step: 1,
                    unit: 'px',
                    hint: 'When timestamp is not under session. With timestamp under session, use “Timestamp ↔ reason” below.',
                  },
                  {
                    id: 'sess-stamp-gap',
                    label: 'Session ↔ timestamp gap',
                    key: 'sessionStampGap' as const,
                    min: 0,
                    max: 80,
                    step: 1,
                    unit: 'px',
                    hint: 'Space between session line and “Today · time” under it.',
                  },
                  {
                    id: 'stamp-reason-gap',
                    label: 'Timestamp ↔ reason gap',
                    key: 'stampReasonGap' as const,
                    min: 0,
                    max: 160,
                    step: 1,
                    unit: 'px',
                    hint: 'Space under the timestamp → before reason body (when stamp sits under session).',
                  },
                ] as const
              ).map((row) => (
                <div key={row.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <Label htmlFor={`${idPrefix}-${row.id}`} className="text-xs font-medium">
                      {row.label}
                    </Label>
                    <span className="tabular-nums text-muted-foreground">
                      {row.key === 'sessionLineHeight'
                        ? Number(style[row.key] ?? 1.2).toFixed(2)
                        : style[row.key] ?? 0}
                      {row.unit}
                    </span>
                  </div>
                  <input
                    id={`${idPrefix}-${row.id}`}
                    type="range"
                    min={row.min}
                    max={row.max}
                    step={row.step}
                    value={
                      row.key === 'sessionLineHeight'
                        ? Number(style.sessionLineHeight ?? 1.2)
                        : Number(style[row.key] ?? 0)
                    }
                    onChange={(e) =>
                      set({
                        [row.key]: Number(e.target.value),
                      })
                    }
                    className="w-full accent-foreground"
                  />
                  {row.hint ? (
                    <p className="text-[10px] text-muted-foreground">{row.hint}</p>
                  ) : null}
                </div>
              ))}

              <div className="space-y-1.5 border-t border-border/40 pt-2">
                <p className="text-xs font-medium">Font weight</p>
                <div className="flex flex-wrap gap-1">
                  {SHARE_FONT_WEIGHT_OPTIONS.map((opt) => (
                    <Button
                      key={opt.id}
                      type="button"
                      size="sm"
                      variant={
                        (style.sessionWeight || 'semibold') === opt.id ? 'default' : 'outline'
                      }
                      className="h-7 px-2 text-[11px]"
                      onClick={() => set({ sessionWeight: opt.id })}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>

              {textContent && onTextChange ? (
                <div className="space-y-1 border-t border-border/40 pt-2">
                  <Label htmlFor={`${idPrefix}-sess-line-edit`} className="text-xs font-medium">
                    Session line text
                  </Label>
                  <Input
                    id={`${idPrefix}-sess-line-edit`}
                    value={textContent.sessionLine ?? ''}
                    onChange={(e) => setText({ sessionLine: e.target.value })}
                    className="h-8 text-sm"
                    placeholder="$NVDA +4.2% so far in regular trading"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Tone / try-lines also live under the <strong>Text</strong> tab.
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Session line is hidden. Turn “Show on card” to edit size and spacing.
            </p>
          )}
        </ShareLayoutSection>
      ) : null}

      {layoutTab === 'colors' ? (
      <ShareLayoutSection
        title="3 · Colors"
        hint="Card bg by family + shades · text/price inks · move % greens/reds."
      >
        <p className="text-[10px] font-medium text-muted-foreground">
          Card color — pick a family, then a shade
        </p>
        <div className="space-y-2.5">
          {SHARE_CARD_COLOR_FAMILIES.map((fam) => {
            const shades = SHARE_CARD_COLOR_PRESETS.filter((p) => p.family === fam.id)
            if (!shades.length) return null
            return (
              <div key={fam.id} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {fam.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {shades.map((opt) => {
                    const isOriginal = opt.id === 'yellow' // #F5B800 original share yellow
                    const selected = (style.cardColor || 'yellow') === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        title={
                          isOriginal
                            ? `Original share card yellow #F5B800`
                            : `${fam.label} · ${opt.label} ${opt.bg}`
                        }
                        aria-label={`Card ${fam.label} ${opt.label}`}
                        aria-pressed={selected}
                        onClick={() =>
                          set({
                            cardColor: opt.id,
                            textColor: opt.defaultText,
                            priceColor: opt.defaultText,
                          })
                        }
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors',
                          selected
                            ? 'border-2 border-foreground shadow-sm'
                            : isOriginal
                              ? 'border-amber-500/70 bg-amber-500/10 hover:bg-amber-500/15'
                              : 'border-border/70 hover:bg-muted/50',
                        )}
                      >
                        <span
                          className="size-4 shrink-0 rounded-full border border-black/15 shadow-inner"
                          style={{ backgroundColor: opt.bg }}
                        />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="space-y-2.5 border-t border-border/40 pt-2">
          <p className="text-[10px] font-medium text-muted-foreground">
            Text color — title, reason, timestamp, brand
          </p>
          {SHARE_TEXT_COLOR_FAMILIES.map((fam) => {
            const shades = SHARE_TEXT_COLOR_PRESETS.filter((p) => p.family === fam.id)
            if (!shades.length) return null
            return (
              <div key={fam.id} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {fam.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {shades.map((opt) => {
                    const selected = (style.textColor || 'black') === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        title={`${opt.label} ${opt.hex}`}
                        aria-label={`Text ${opt.label}`}
                        aria-pressed={selected}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          // Explicit ink for title / session / reason / stamp / brand
                          set({ textColor: opt.id })
                        }}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors',
                          selected
                            ? 'border-2 border-foreground bg-muted/40 shadow-sm'
                            : 'border-border/70 hover:bg-muted/50',
                        )}
                      >
                        <span
                          className="size-4 shrink-0 rounded-full border border-black/20 shadow-inner"
                          style={{ backgroundColor: opt.hex }}
                        />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="space-y-2.5 border-t border-border/40 pt-2">
          <p className="text-[10px] font-medium text-muted-foreground">
            Price color (under %)
          </p>
          {SHARE_TEXT_COLOR_FAMILIES.map((fam) => {
            const shades = SHARE_TEXT_COLOR_PRESETS.filter((p) => p.family === fam.id)
            if (!shades.length) return null
            return (
              <div key={`price-${fam.id}`} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {fam.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {shades.map((opt) => {
                    const selected = (style.priceColor || 'black') === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        title={`Price ${opt.label} ${opt.hex}`}
                        aria-label={`Price ${opt.label}`}
                        aria-pressed={selected}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          set({ priceColor: opt.id })
                        }}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors',
                          selected
                            ? 'border-2 border-foreground bg-muted/40 shadow-sm'
                            : 'border-border/70 hover:bg-muted/50',
                        )}
                      >
                        <span
                          className="size-4 shrink-0 rounded-full border border-black/20 shadow-inner"
                          style={{ backgroundColor: opt.hex }}
                        />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="space-y-2 border-t border-border/40 pt-2">
          <p className="text-[10px] font-medium text-muted-foreground">
            Up color — % + chart line when rising (greens · whites)
          </p>
          {(
            [
              { fam: 'green' as const, title: 'Green shades' },
              { fam: 'white' as const, title: 'White / light' },
            ] as const
          ).map((group) => {
            const list = SHARE_UP_GREEN_SHADES.filter((s) => s.family === group.fam)
            if (!list.length) return null
            return (
              <div key={`up-${group.fam}`} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </p>
                <div
                  className="flex flex-wrap gap-1.5"
                  role="radiogroup"
                  aria-label={`Up ${group.title}`}
                >
                  {list.map((s) => {
                    const maxId = Math.max(...SHARE_UP_GREEN_SHADES.map((x) => x.id))
                    const selected =
                      clampShareMoveShade(style.upColorShade, 2, maxId) === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        title={`${s.label} ${s.hex}`}
                        aria-label={`Up ${s.label}`}
                        onClick={() => set({ upColorShade: s.id })}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors',
                          selected
                            ? 'border-2 border-foreground shadow-sm'
                            : 'border-border/70 hover:bg-muted/50',
                        )}
                      >
                        <span
                          className={cn(
                            'size-4 shrink-0 rounded-full border shadow-inner',
                            s.family === 'white' ? 'border-black/25' : 'border-black/15',
                          )}
                          style={{ backgroundColor: s.hex }}
                        />
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="space-y-2 border-t border-border/40 pt-2">
          <p className="text-[10px] font-medium text-muted-foreground">
            Down color — % + chart line when falling (reds · whites)
          </p>
          {(
            [
              { fam: 'red' as const, title: 'Red shades' },
              { fam: 'white' as const, title: 'White / light' },
            ] as const
          ).map((group) => {
            const list = SHARE_DOWN_RED_SHADES.filter((s) => s.family === group.fam)
            if (!list.length) return null
            return (
              <div key={`down-${group.fam}`} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </p>
                <div
                  className="flex flex-wrap gap-1.5"
                  role="radiogroup"
                  aria-label={`Down ${group.title}`}
                >
                  {list.map((s) => {
                    const maxId = Math.max(...SHARE_DOWN_RED_SHADES.map((x) => x.id))
                    const selected =
                      clampShareMoveShade(style.downColorShade, 2, maxId) === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        title={`${s.label} ${s.hex}`}
                        aria-label={`Down ${s.label}`}
                        onClick={() => set({ downColorShade: s.id })}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors',
                          selected
                            ? 'border-2 border-foreground shadow-sm'
                            : 'border-border/70 hover:bg-muted/50',
                        )}
                      >
                        <span
                          className={cn(
                            'size-4 shrink-0 rounded-full border shadow-inner',
                            s.family === 'white' ? 'border-black/25' : 'border-black/15',
                          )}
                          style={{ backgroundColor: s.hex }}
                        />
                        {s.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <p className="text-[10px] text-muted-foreground">
            Same shade = big % + chart line. Classic green/red = original. White works best on
            dark card colors.
          </p>
        </div>
      </ShareLayoutSection>
      ) : null}

      {layoutTab === 'spacing' ? (
      <ShareLayoutSection
        title="4 · Spacing"
        hint="Padding and gaps — including session · timestamp · reason."
      >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <Label htmlFor={`${idPrefix}-image-pad`} className="text-xs font-medium">
            Side padding
          </Label>
          <span className="tabular-nums text-muted-foreground">
            {style.imagePadding ?? 48}px
          </span>
        </div>
        <input
          id={`${idPrefix}-image-pad`}
          type="range"
          min={16}
          max={120}
          step={2}
          value={style.imagePadding ?? 48}
          onChange={(e) => set({ imagePadding: Number(e.target.value) })}
          className="w-full accent-foreground"
        />
        <p className="text-[10px] text-muted-foreground">Left & right margin.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-header-pad`} className="text-xs font-medium">
              Header padding
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {style.headerPadding ?? 88}px
            </span>
          </div>
          <input
            id={`${idPrefix}-header-pad`}
            type="range"
            min={0}
            max={200}
            step={2}
            value={style.headerPadding ?? 88}
            onChange={(e) => set({ headerPadding: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <p className="text-[10px] text-muted-foreground">Space above logo / title.</p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-footer-pad`} className="text-xs font-medium">
              Footer padding
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {style.footerPadding ?? 48}px
            </span>
          </div>
          <input
            id={`${idPrefix}-footer-pad`}
            type="range"
            min={0}
            max={200}
            step={2}
            value={style.footerPadding ?? 48}
            onChange={(e) => set({ footerPadding: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <p className="text-[10px] text-muted-foreground">Space below footer row.</p>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <Label htmlFor={`${idPrefix}-gap-header`} className="text-xs font-medium">
            Header → chart gap
          </Label>
          <span className="tabular-nums text-muted-foreground">{style.gapBeforeChart}px</span>
        </div>
        <input
          id={`${idPrefix}-gap-header`}
          type="range"
          min={-100}
          max={280}
          step={2}
          value={style.gapBeforeChart}
          onChange={(e) => set({ gapBeforeChart: Number(e.target.value) })}
          className="w-full accent-foreground"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <Label htmlFor={`${idPrefix}-gap-reason`} className="text-xs font-medium">
            Chart → reason gap
          </Label>
          <span className="tabular-nums text-muted-foreground">{style.gapAfterChart}px</span>
        </div>
        <input
          id={`${idPrefix}-gap-reason`}
          type="range"
          min={0}
          max={320}
          step={2}
          value={style.gapAfterChart}
          onChange={(e) => set({ gapAfterChart: Number(e.target.value) })}
          className="w-full accent-foreground"
        />
      </div>

      <div className="space-y-2 border-t border-border/40 pt-2">
        <p className="text-[10px] font-medium text-muted-foreground">
          Session · timestamp · reason gaps
        </p>
        <p className="text-[10px] text-muted-foreground">
          Same controls as Session tab — scaled here for quick access.
        </p>
        {(
          [
            {
              id: 'sp-sess-reason',
              label: 'Session ↔ reason',
              key: 'sessionMarginBottom' as const,
              min: 0,
              max: 160,
              hint: 'When timestamp is not under the session line.',
            },
            {
              id: 'sp-sess-stamp',
              label: 'Session ↔ timestamp',
              key: 'sessionStampGap' as const,
              min: 0,
              max: 80,
              hint: 'Between session line and “Today · time”.',
            },
            {
              id: 'sp-stamp-reason',
              label: 'Timestamp ↔ reason',
              key: 'stampReasonGap' as const,
              min: 0,
              max: 160,
              hint: 'Under timestamp → before reason (stamp under session).',
            },
          ] as const
        ).map((row) => (
          <div key={row.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <Label htmlFor={`${idPrefix}-${row.id}`} className="text-xs font-medium">
                {row.label}
              </Label>
              <span className="tabular-nums text-muted-foreground">
                {style[row.key] ?? 0}px
              </span>
            </div>
            <input
              id={`${idPrefix}-${row.id}`}
              type="range"
              min={row.min}
              max={row.max}
              step={1}
              value={Number(style[row.key] ?? 0)}
              onChange={(e) => set({ [row.key]: Number(e.target.value) })}
              className="w-full accent-foreground"
            />
            <p className="text-[10px] text-muted-foreground">{row.hint}</p>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <Label htmlFor={`${idPrefix}-logo`} className="text-xs font-medium">
            Logo size
          </Label>
          <span className="tabular-nums text-muted-foreground">{style.logoSize}px</span>
        </div>
        <input
          id={`${idPrefix}-logo`}
          type="range"
          min={24}
          max={200}
          step={2}
          value={style.logoSize}
          onChange={(e) => set({ logoSize: Number(e.target.value) })}
          className="w-full accent-foreground"
        />
      </div>
      </ShareLayoutSection>
      ) : null}

      {layoutTab === 'type' ? (
      <ShareLayoutSection title="5 · Type sizes" hint="Fonts for title, %, price, stamp, reason.">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-name`} className="text-xs font-medium">
              Title font
            </Label>
            <span className="tabular-nums text-muted-foreground">{style.nameFontSize}px</span>
          </div>
          <input
            id={`${idPrefix}-name`}
            type="range"
            min={18}
            max={110}
            step={1}
            value={style.nameFontSize}
            onChange={(e) => set({ nameFontSize: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-pct`} className="text-xs font-medium">
              % font
            </Label>
            <span className="tabular-nums text-muted-foreground">{style.pctFontSize}px</span>
          </div>
          <input
            id={`${idPrefix}-pct`}
            type="range"
            min={18}
            max={200}
            step={1}
            value={Math.min(200, Math.max(18, Number(style.pctFontSize) || 80))}
            onChange={(e) => set({ pctFontSize: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
        </div>
      </div>

      <div className="space-y-1.5 border-t border-border/40 pt-2">
        <p className="text-[10px] font-medium text-muted-foreground">
          Share price (under % change)
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={style.showSharePrice !== false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showSharePrice: true })}
          >
            Show price
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.showSharePrice === false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showSharePrice: false })}
          >
            Hide price
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          $share price under the big % on the right. Hide to show only the move %.
        </p>
      </div>

      {style.showSharePrice !== false ? (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-price`} className="text-xs font-medium">
              Price font size
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {style.priceFontSize ?? 32}px
            </span>
          </div>
          <input
            id={`${idPrefix}-price`}
            type="range"
            min={12}
            max={72}
            step={1}
            value={style.priceFontSize ?? 32}
            onChange={(e) => set({ priceFontSize: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-price-weight`} className="text-xs font-medium">
              Price thickness
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {style.priceFontWeight ?? 600}
            </span>
          </div>
          <input
            id={`${idPrefix}-price-weight`}
            type="range"
            min={100}
            max={900}
            step={100}
            value={style.priceFontWeight ?? 600}
            onChange={(e) => set({ priceFontWeight: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <p className="text-[10px] text-muted-foreground">
            100 = thinnest · 400 regular · 600 default · 700 bold · 900 black
          </p>
        </div>
      </div>
      ) : null}

      {style.showSharePrice !== false ? (
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Price color
        </p>
        <p className="text-[10px] text-muted-foreground">
          Full shade picker is under <strong>3 · Colors</strong> (same inks as text).
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SHARE_TEXT_COLOR_PRESETS.filter((p) =>
            ['black', 'grey', 'white', 'ink', 'navy-text', 'off-white'].includes(p.id),
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => set({ priceColor: opt.id })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium',
                (style.priceColor || 'black') === opt.id
                  ? 'border-2 border-foreground shadow-sm'
                  : 'border-border/70 hover:bg-muted/50',
              )}
            >
              <span
                className="size-3.5 shrink-0 rounded-full border border-black/15"
                style={{ backgroundColor: opt.hex }}
              />
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      ) : null}

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <Label htmlFor={`${idPrefix}-stamp`} className="text-xs font-medium">
            Timestamp font
          </Label>
          <span className="tabular-nums text-muted-foreground">
            {style.stampFontSize ?? 30}px
          </span>
        </div>
        <input
          id={`${idPrefix}-stamp`}
          type="range"
          min={10}
          max={48}
          step={1}
          value={style.stampFontSize ?? 30}
          onChange={(e) => set({ stampFontSize: Number(e.target.value) })}
          className="w-full accent-foreground"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <Label htmlFor={`${idPrefix}-reason`} className="text-xs font-medium">
            Reason font
          </Label>
          <span className="tabular-nums text-muted-foreground">{style.reasonFontSize}px</span>
        </div>
        <input
          id={`${idPrefix}-reason`}
          type="range"
          min={20}
          max={120}
          step={1}
          value={style.reasonFontSize}
          onChange={(e) => set({ reasonFontSize: Number(e.target.value) })}
          className="w-full accent-foreground"
        />
      </div>

      <div className="space-y-1.5 border-t border-border/40 pt-2">
        <p className="text-[10px] font-medium text-muted-foreground">Title text mode</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={style.titleMode !== 'ticker' ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => applyTitleMode('company')}
          >
            Company name
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.titleMode === 'ticker' ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => applyTitleMode('ticker')}
          >
            Ticker symbol
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Company name comes from Yahoo Finance when the DB label is missing or just the ticker.
        </p>
      </div>

      <div className="space-y-1.5 border-t border-border/40 pt-2">
        <p className="text-[10px] font-medium text-muted-foreground">Track at Trigger color</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'auto' as const, label: 'Match text' },
              { id: 'dark' as const, label: 'Dark color' },
              { id: 'light' as const, label: 'Light color' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={(style.brandTone || 'auto') === opt.id ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => set({ brandTone: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Color only (black / white). Weight is in Font weight section.
        </p>
      </div>
      </ShareLayoutSection>
      ) : null}

      {layoutTab === 'canvas' ? (
      <ShareLayoutSection
        title="6 · Canvas size"
        hint="Export is a full-resolution PNG. Default Full HD (1920px wide)."
      >
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-canvas-w`} className="text-xs font-medium">
              Width (export)
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {style.canvasWidth ?? 1920}px
              {(style.canvasWidth ?? 1920) >= 1920 ? ' · Full HD+' : ''}
            </span>
          </div>
          <input
            id={`${idPrefix}-canvas-w`}
            type="range"
            min={800}
            max={3840}
            step={10}
            value={style.canvasWidth ?? 1920}
            onChange={(e) => set({ canvasWidth: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>800</span>
            <span>1920 Full HD</span>
            <span>3840 4K</span>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-aspect`} className="text-xs font-medium">
              Height ratio (shape)
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {(style.aspectRatio ?? 1.05).toFixed(2)} · ~{Math.round(
                (style.canvasWidth ?? 1920) * (style.aspectRatio ?? 1.05),
              )}
              px tall
            </span>
          </div>
          <input
            id={`${idPrefix}-aspect`}
            type="range"
            min={0.85}
            max={1.55}
            step={0.01}
            value={style.aspectRatio ?? 1.05}
            onChange={(e) => set({ aspectRatio: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Wider / squarish</span>
            <span>Taller</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button
            type="button"
            size="sm"
            variant={style.preferSquare !== false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ preferSquare: true })}
          >
            Lock to ratio
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.preferSquare === false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ preferSquare: false })}
          >
            Free height
          </Button>
          <Button
            type="button"
            size="sm"
            variant={
              (style.canvasWidth ?? 1920) === 1920 && (style.aspectRatio ?? 1.05) === 1.05
                ? 'default'
                : 'outline'
            }
            className="h-7 text-[11px]"
            onClick={() => set({ canvasWidth: 1920, aspectRatio: 1.05, preferSquare: true })}
          >
            Full HD 1920
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => set({ aspectRatio: 1, preferSquare: true, canvasWidth: 1920 })}
          >
            1:1 HD square
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => set({ aspectRatio: 1.25, preferSquare: true, canvasWidth: 1920 })}
          >
            Story 4:5 HD
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => set({ canvasWidth: 1080, aspectRatio: 1, preferSquare: true })}
          >
            1080 square
          </Button>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Copy / Download save this exact pixel size as a lossless PNG. Preview is only scaled down
          for the dialog — the file is full resolution. Lock pads or compresses gaps to the ratio;
          Free height = content decides height.
        </p>
      </ShareLayoutSection>
      ) : null}

      {layoutTab === 'timestamp' ? (
      <ShareLayoutSection
        title="7 · Timestamp"
        hint="Edit the date/time string, hide it, or move it when the session line is off."
      >
        <p className="text-[10px] font-medium text-muted-foreground">Visibility</p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={style.showTimestamp !== false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showTimestamp: true })}
          >
            Show timestamp
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.showTimestamp === false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showTimestamp: false })}
          >
            Hide timestamp
          </Button>
        </div>

        {style.showTimestamp !== false && textContent && onTextChange ? (
          <div className="space-y-1 border-t border-border/40 pt-2">
            <Label htmlFor={`${idPrefix}-ts-stamp`} className="text-xs font-medium">
              Timestamp text
            </Label>
            <Input
              id={`${idPrefix}-ts-stamp`}
              value={textContent.stamp}
              onChange={(e) => setText({ stamp: e.target.value })}
              className="h-8 text-sm"
              placeholder="Today · 3:03 PM ET"
            />
            <p className="text-[10px] text-muted-foreground">
              Edit freely. Clear to hide on this image only. Timezone still converts until you
              type a custom string. Reset text restores the auto clock.
            </p>
          </div>
        ) : null}

        {style.showTimestamp === false ? (
          <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-2">
            Timestamp is hidden. Turn “Show” to edit the text and placement.
          </p>
        ) : (
          <>
            <p className="text-[10px] font-medium text-muted-foreground border-t border-border/40 pt-2">
              Placement
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={style.timestampPlacement !== 'price-right' ? 'default' : 'outline'}
                className="h-8 text-xs"
                disabled={style.showSessionHeadline !== false}
                onClick={() => set({ timestampPlacement: 'footer-left' })}
              >
                Footer left
              </Button>
              <Button
                type="button"
                size="sm"
                variant={style.timestampPlacement === 'price-right' ? 'default' : 'outline'}
                className="h-8 text-xs"
                disabled={style.showSessionHeadline !== false}
                onClick={() => set({ timestampPlacement: 'price-right' })}
              >
                Right of share price
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {style.showSessionHeadline !== false
                ? 'Session line is on → stamp always sits under that line.'
                : 'Choose bottom-left, or next to the share price. Font = Timestamp slider.'}
            </p>
          </>
        )}
      </ShareLayoutSection>
      ) : null}

      {layoutTab === 'brand' ? (
      <ShareLayoutSection
        title="8 · Track at Trigger"
        hint="Show/hide brand text · scale size & height · position · margins. Store icons → Store tab."
      >
        <p className="text-[10px] font-medium text-muted-foreground">Brand text visibility</p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={style.showBrand !== false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showBrand: true })}
          >
            Show “Track at Trigger”
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.showBrand === false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showBrand: false })}
          >
            Hide brand text
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Hides only the footer label. Store icons have their own show/hide under{' '}
          <strong>Store</strong>.
        </p>

        {style.showBrand !== false ? (
          <>
            <div className="space-y-1 border-t border-border/40 pt-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <Label htmlFor={`${idPrefix}-brand-fs`} className="text-xs font-medium">
                  Brand text scale (size)
                </Label>
                <span className="tabular-nums text-muted-foreground">
                  {style.brandFontSize ?? 28}px
                </span>
              </div>
              <input
                id={`${idPrefix}-brand-fs`}
                type="range"
                min={14}
                max={48}
                step={1}
                value={style.brandFontSize ?? 28}
                onChange={(e) => set({ brandFontSize: Number(e.target.value) })}
                className="w-full accent-foreground"
              />
              <p className="text-[10px] text-muted-foreground">
                Overall font size (width + natural height).
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <Label htmlFor={`${idPrefix}-brand-hscale`} className="text-xs font-medium">
                  Brand text height
                </Label>
                <span className="tabular-nums text-muted-foreground">
                  {(style.brandHeightScale ?? 1).toFixed(2)}×
                </span>
              </div>
              <input
                id={`${idPrefix}-brand-hscale`}
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={style.brandHeightScale ?? 1}
                onChange={(e) => set({ brandHeightScale: Number(e.target.value) })}
                className="w-full accent-foreground"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Shorter</span>
                <span>Taller (stretch)</span>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-2">
            Brand text is hidden. Turn “Show” to edit scale and height.
          </p>
        )}

        <p className="text-[10px] font-medium text-muted-foreground border-t border-border/40 pt-2">
          Position on card
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'left' as const, label: 'Bottom left' },
              { id: 'center' as const, label: 'Bottom center' },
              { id: 'right' as const, label: 'Bottom right' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={(style.brandPlacement || 'right') === opt.id ? 'default' : 'outline'}
              className="h-7 text-[11px]"
              onClick={() => set({ brandPlacement: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Track at Trigger (+ store icons) at the bottom. Date sits on the opposite side when
          left/right.
        </p>
        <div className="space-y-1 border-t border-border/40 pt-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-reason-mb`} className="text-xs font-medium">
              Margin above (from reason)
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {(style.reasonMarginBottom ?? 56) + (style.brandMarginTop ?? 0)}px
            </span>
          </div>
          <input
            id={`${idPrefix}-reason-mb`}
            type="range"
            min={0}
            max={180}
            step={2}
            value={style.reasonMarginBottom ?? 56}
            onChange={(e) => set({ reasonMarginBottom: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <p className="text-[10px] text-muted-foreground">
            Gap under reason body → before “Track at Trigger”.
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-brand-mt`} className="text-xs font-medium">
              Extra margin above
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {style.brandMarginTop ?? 0}px
            </span>
          </div>
          <input
            id={`${idPrefix}-brand-mt`}
            type="range"
            min={0}
            max={100}
            step={2}
            value={style.brandMarginTop ?? 0}
            onChange={(e) => set({ brandMarginTop: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-brand-mb`} className="text-xs font-medium">
              Margin below
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {style.brandMarginBottom ?? 40}px
            </span>
          </div>
          <input
            id={`${idPrefix}-brand-mb`}
            type="range"
            min={0}
            max={120}
            step={2}
            value={style.brandMarginBottom ?? 40}
            onChange={(e) => set({ brandMarginBottom: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <p className="text-[10px] text-muted-foreground">
            Space under “Track at Trigger” (+ store icons) to the card edge.
          </p>
        </div>
      </ShareLayoutSection>
      ) : null}

      {layoutTab === 'chart' ? (
      <ShareLayoutSection
        title="9 · Chart x-axis"
        hint="Session range · time axis · optional $ / % on the line."
      >
        <p className="text-[10px] font-medium text-muted-foreground">Session range</p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 1 as const, label: '1 day' },
              { id: 2 as const, label: '2 days' },
              { id: 3 as const, label: '3 days' },
              { id: 5 as const, label: '5 days' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={
                clampShareChartSessionDays(style.chartSessionDays) === opt.id
                  ? 'default'
                  : 'outline'
              }
              className="h-7 text-[11px]"
              onClick={() => set({ chartSessionDays: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Trading sessions ending on the event day. Changing range or interval reloads Yahoo
          data on next preview refresh.
        </p>

        <p className="text-[10px] font-medium text-muted-foreground border-t border-border/40 pt-2">
          Bar interval (pricing)
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SHARE_CHART_INTERVALS.filter((opt) => opt.id !== '1h').map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={
                clampShareChartInterval(style.chartInterval) === opt.id ? 'default' : 'outline'
              }
              className="h-7 min-w-10 px-2 text-[11px]"
              onClick={() => set({ chartInterval: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          How fine the price line is sampled (1m = densest / wavy). Needs real Yahoo 1m data.
        </p>

        <div className="space-y-1 border-t border-border/40 pt-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-chart-plot-h`} className="text-xs font-medium">
              Chart height
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {Math.min(
                700,
                Math.max(
                  140,
                  Number.isFinite(Number(style.chartPlotHeight)) && Number(style.chartPlotHeight) > 0
                    ? Math.round(Number(style.chartPlotHeight))
                    : 300,
                ),
              )}
              px
            </span>
          </div>
          <input
            id={`${idPrefix}-chart-plot-h`}
            type="range"
            min={140}
            max={650}
            step={10}
            value={Math.min(
              700,
              Math.max(
                140,
                Number.isFinite(Number(style.chartPlotHeight)) && Number(style.chartPlotHeight) > 0
                  ? Number(style.chartPlotHeight)
                  : 300,
              ),
            )}
            onChange={(e) => set({ chartPlotHeight: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <p className="text-[10px] text-muted-foreground">
            How tall the line plot is. Higher = longer chart / more vertical “zoom” on the move.
          </p>
        </div>

        <div className="space-y-1 border-t border-border/40 pt-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-chart-line-w`} className="text-xs font-medium">
              Line thickness
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {Math.min(
                24,
                Math.max(
                  1,
                  Number.isFinite(Number(style.chartLineWidth)) && Number(style.chartLineWidth) > 0
                    ? Number(style.chartLineWidth)
                    : 4,
                ),
              )}
              px
            </span>
          </div>
          <input
            id={`${idPrefix}-chart-line-w`}
            type="range"
            min={1}
            max={16}
            step={0.5}
            value={Math.min(
              24,
              Math.max(
                1,
                Number.isFinite(Number(style.chartLineWidth)) && Number(style.chartLineWidth) > 0
                  ? Number(style.chartLineWidth)
                  : 4,
              ),
            )}
            onChange={(e) => set({ chartLineWidth: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <p className="text-[10px] text-muted-foreground">
            Stroke width of the price line (1 = hairline · 16 = bold). End dot scales with it.
          </p>
        </div>

        <div className="space-y-1 border-t border-border/40 pt-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-chart-start-pct`} className="text-xs font-medium">
              Chart start (trim left)
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {Math.min(90, Math.max(0, Math.round(Number(style.chartVisibleStartPct) || 0)))}%
            </span>
          </div>
          <input
            id={`${idPrefix}-chart-start-pct`}
            type="range"
            min={0}
            max={90}
            step={1}
            value={Math.min(90, Math.max(0, Math.round(Number(style.chartVisibleStartPct) || 0)))}
            onChange={(e) => set({ chartVisibleStartPct: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <p className="text-[10px] text-muted-foreground">
            End is always the event / stamp time. 0% = full session range · higher =
            start later (zoom into the right side of 1d / 2d / 5d).
          </p>
        </div>

        <p className="text-[10px] font-medium text-muted-foreground border-t border-border/40 pt-2">
          Axis visibility
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={style.showChartTimeAxis !== false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showChartTimeAxis: true })}
          >
            Time on
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.showChartTimeAxis === false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showChartTimeAxis: false })}
          >
            Time off
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.showChartDayLabels === true ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showChartDayLabels: true })}
          >
            Dates on
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.showChartDayLabels !== true ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showChartDayLabels: false })}
          >
            Dates off
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Time = 0m / 9:30 AM ticks. Dates = day labels under multi-day charts.
        </p>

        {style.showChartDayLabels === true ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-muted-foreground">Day label style</p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'today-long' as const, label: 'Today · 6 August' },
                  { id: 'today-short' as const, label: 'Today · 6 Aug' },
                  { id: 'date-long' as const, label: '7 August · 6 August' },
                  { id: 'date-short' as const, label: '7 Aug · 6 Aug' },
                  { id: 'relative' as const, label: 'Today · Yesterday · Back' },
                  { id: 'relative-short' as const, label: 'Today · Yday · Back' },
                ] as const
              ).map((opt) => (
                <Button
                  key={opt.id}
                  type="button"
                  size="sm"
                  variant={
                    clampShareChartDayLabelMode(style.chartDayLabelMode) === opt.id
                      ? 'default'
                      : 'outline'
                  }
                  className="h-7 text-[11px]"
                  onClick={() => set({ chartDayLabelMode: opt.id })}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Calendar styles use real dates. Relative = Today (last session) · Yesterday ·
              Back · 3 days back… for older sessions.
            </p>
          </div>
        ) : null}

        {style.showChartTimeAxis !== false && style.showChartDayLabels === true ? (
          <div className="space-y-1 border-t border-border/40 pt-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <Label htmlFor={`${idPrefix}-chart-time-day-gap`} className="text-xs font-medium">
                Gap: time ↔ dates
              </Label>
              <span className="tabular-nums text-muted-foreground">
                {Math.min(
                  100,
                  Math.max(
                    0,
                    Math.round(
                      Number.isFinite(Number(style.chartTimeDayGap))
                        ? Number(style.chartTimeDayGap)
                        : 14,
                    ),
                  ),
                )}
                px
              </span>
            </div>
            <input
              id={`${idPrefix}-chart-time-day-gap`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.min(
                100,
                Math.max(
                  0,
                  Math.round(
                    Number.isFinite(Number(style.chartTimeDayGap))
                      ? Number(style.chartTimeDayGap)
                      : 14,
                  ),
                ),
              )}
              onChange={(e) => set({ chartTimeDayGap: Number(e.target.value) })}
              className="w-full accent-foreground"
            />
            <p className="text-[10px] text-muted-foreground">
              Vertical space between the time row and day labels (0–100px).
            </p>
          </div>
        ) : null}

        <p className="text-[10px] font-medium text-muted-foreground border-t border-border/40 pt-2">
          Time axis mode
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={(style.chartAxisMode || 'elapsed') === 'elapsed' ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ chartAxisMode: 'elapsed' })}
          >
            Elapsed (0m · 15m…)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.chartAxisMode === 'timestamp' ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ chartAxisMode: 'timestamp' })}
          >
            Absolute time (9:30 AM…)
          </Button>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label className="text-xs font-medium">Time label count</Label>
            <span className="tabular-nums text-muted-foreground">
              {style.chartAxisLabelCount ?? 5}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                variant={(style.chartAxisLabelCount ?? 5) === n ? 'default' : 'outline'}
                className="h-7 min-w-8 px-2 text-[11px]"
                onClick={() => set({ chartAxisLabelCount: n })}
              >
                {n}
              </Button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Exact time labels under the chart (3–10). Absolute time is clearest for multi-day.
          </p>
        </div>

        <div className="space-y-1 border-t border-border/40 pt-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <Label htmlFor={`${idPrefix}-chart-axis-fs`} className="text-xs font-medium">
              Time label font size
            </Label>
            <span className="tabular-nums text-muted-foreground">
              {style.chartAxisFontSize ?? 18}px
            </span>
          </div>
          <input
            id={`${idPrefix}-chart-axis-fs`}
            type="range"
            min={10}
            max={40}
            step={1}
            value={style.chartAxisFontSize ?? 18}
            onChange={(e) => set({ chartAxisFontSize: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
          <p className="text-[10px] text-muted-foreground">
            Font for 0m / 15m / 1h or absolute clock under the chart.
          </p>
        </div>

        <div className="space-y-1.5 border-t border-border/40 pt-2">
          <p className="text-[10px] font-medium text-muted-foreground">
            Labels on the line
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'off' as const, label: 'Hide' },
                { id: 'price' as const, label: 'Price' },
                { id: 'percent' as const, label: '%' },
                { id: 'both' as const, label: 'Both' },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                variant={
                  (style.chartPointLabelMode || 'off') === opt.id ? 'default' : 'outline'
                }
                className="h-7 text-[11px]"
                onClick={() => set({ chartPointLabelMode: opt.id })}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Both = % above the point, $ price below. Needs real chart data.
          </p>
          {(style.chartPointLabelMode || 'off') !== 'off' ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Label className="text-xs font-medium">Point count (3–8)</Label>
                  <span className="tabular-nums text-muted-foreground">
                    {style.chartPriceLabelCount ?? 4}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {[3, 4, 5, 6, 7, 8].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      size="sm"
                      variant={(style.chartPriceLabelCount ?? 4) === n ? 'default' : 'outline'}
                      className="h-7 min-w-8 px-2 text-[11px]"
                      onClick={() => set({ chartPriceLabelCount: n })}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor={`${idPrefix}-chart-point-labels`}
                  className="text-xs font-medium"
                >
                  Custom line labels (optional)
                </Label>
                <Textarea
                  id={`${idPrefix}-chart-point-labels`}
                  value={style.chartPointLabelsCustom ?? ''}
                  onChange={(e) => set({ chartPointLabelsCustom: e.target.value })}
                  rows={3}
                  className="min-h-[4rem] resize-y font-mono text-xs"
                  placeholder={
                    (style.chartPointLabelMode || 'off') === 'percent' ||
                    (style.chartPointLabelMode || 'off') === 'both'
                      ? '+0%\n+1.2%\n+2.5%\n+3.1%'
                      : '$100.00\n$101.20\n$102.50'
                  }
                />
                <p className="text-[10px] text-muted-foreground">
                  One label per line (same order as points). Empty = auto from data.
                  {(style.chartPointLabelMode || 'off') === 'both'
                    ? ' These are the top (%) lines.'
                    : ''}
                </p>
              </div>
              {(style.chartPointLabelMode || 'off') === 'both' ? (
                <div className="space-y-1">
                  <Label
                    htmlFor={`${idPrefix}-chart-point-subs`}
                    className="text-xs font-medium"
                  >
                    Custom bottom prices (optional)
                  </Label>
                  <Textarea
                    id={`${idPrefix}-chart-point-subs`}
                    value={style.chartPointSubLabelsCustom ?? ''}
                    onChange={(e) => set({ chartPointSubLabelsCustom: e.target.value })}
                    rows={3}
                    className="min-h-[4rem] resize-y font-mono text-xs"
                    placeholder={'$100.00\n$101.20\n$102.50\n$103.10'}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    One $ per line under each %. Empty = auto prices.
                  </p>
                </div>
              ) : null}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Label htmlFor={`${idPrefix}-chart-point-fs`} className="text-xs font-medium">
                    Line label font size (price / %)
                  </Label>
                  <span className="tabular-nums text-muted-foreground">
                    {style.chartPointFontSize ?? 16}px
                  </span>
                </div>
                <input
                  id={`${idPrefix}-chart-point-fs`}
                  type="range"
                  min={10}
                  max={40}
                  step={1}
                  value={style.chartPointFontSize ?? 16}
                  onChange={(e) => set({ chartPointFontSize: Number(e.target.value) })}
                  className="w-full accent-foreground"
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5 border-t border-border/40 pt-2">
          <Label htmlFor={`${idPrefix}-chart-axis-labels`} className="text-xs font-medium">
            Custom time labels (under chart)
          </Label>
          <Textarea
            id={`${idPrefix}-chart-axis-labels`}
            value={style.chartAxisLabelsCustom ?? ''}
            onChange={(e) => set({ chartAxisLabelsCustom: e.target.value })}
            rows={3}
            className="min-h-[4rem] resize-y font-mono text-xs"
            placeholder={'0m\n15m\n30m\n45m\n1h'}
          />
          <p className="text-[10px] text-muted-foreground">
            One label per line, left → right. Empty = auto elapsed / clock. Matches your label
            count when possible.
          </p>
        </div>
        <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2">
          <p className="text-[10px] font-medium text-foreground">
            Timestamps = listing exchange
          </p>
          <p className="text-[10px] text-muted-foreground">
            {exchangeTimeZoneLabel
              ? `${exchangeTimeZoneLabel} · ${exchangeTimeZone || EXCHANGE_TZ_FALLBACK}`
              : exchangeTimeZone || EXCHANGE_TZ_FALLBACK}
            {' · '}
            no browser/local convert (MSFT stays EDT/EST, not BST).
          </p>
        </div>
      </ShareLayoutSection>
      ) : null}

      {layoutTab === 'store' ? (
      <ShareLayoutSection
        title="10 · Store labels"
        hint="Brand icons after Track at Trigger: show/hide · height · width scale."
      >
        <p className="text-[10px] font-medium text-muted-foreground">Visibility</p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={
              style.showStoreBadges !== false && (style.storeBadgeStyle || 'circle') === 'circle'
                ? 'default'
                : 'outline'
            }
            className="h-7 text-[11px]"
            onClick={() => set({ showStoreBadges: true, storeBadgeStyle: 'circle' })}
          >
            Circular icons
          </Button>
          <Button
            type="button"
            size="sm"
            variant={
              style.showStoreBadges !== false && style.storeBadgeStyle === 'badge'
                ? 'default'
                : 'outline'
            }
            className="h-7 text-[11px]"
            onClick={() => set({ showStoreBadges: true, storeBadgeStyle: 'badge' })}
          >
            App Store badge
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.showStoreBadges === false ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ showStoreBadges: false })}
          >
            Hide icons
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Independent of brand text hide (Brand tab). Circular = App Store + Play · Badge =
          App Store only.
        </p>
        {style.showStoreBadges !== false ? (
          <>
            <div className="space-y-1 border-t border-border/40 pt-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <Label htmlFor={`${idPrefix}-store-h`} className="text-xs font-medium">
                  Icon / badge height
                </Label>
                <span className="tabular-nums text-muted-foreground">
                  {style.storeIconSize ?? 36}px
                </span>
              </div>
              <input
                id={`${idPrefix}-store-h`}
                type="range"
                min={18}
                max={72}
                step={1}
                value={style.storeIconSize ?? 36}
                onChange={(e) => set({ storeIconSize: Number(e.target.value) })}
                className="w-full accent-foreground"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <Label htmlFor={`${idPrefix}-store-wscale`} className="text-xs font-medium">
                  Icon width scale
                </Label>
                <span className="tabular-nums text-muted-foreground">
                  {(style.storeIconWidthScale ?? 1).toFixed(2)}×
                </span>
              </div>
              <input
                id={`${idPrefix}-store-wscale`}
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={style.storeIconWidthScale ?? 1}
                onChange={(e) => set({ storeIconWidthScale: Number(e.target.value) })}
                className="w-full accent-foreground"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Narrower</span>
                <span>Wider</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Width independent of height. 1× = natural proportion.
              </p>
            </div>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Store icons are hidden. Pick Circular or Badge to show and scale them.
          </p>
        )}
      </ShareLayoutSection>
      ) : null}

      {layoutTab === 'seal' ? (
      <ShareLayoutSection
        title="11 · News stamp"
        hint="Circle seal or rectangular CERTIFIED stamp · drag position · dotted density."
      >
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'auto' as const, label: 'Auto' },
              { id: 'on' as const, label: 'Always on' },
              { id: 'off' as const, label: 'Off' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={(style.newsStampMode || 'auto') === opt.id ? 'default' : 'outline'}
              className="h-7 text-[11px]"
              onClick={() => set({ newsStampMode: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Auto = show when move ≥10%, Breaking tone, or session line says BREAKING.
        </p>

        <p className="text-[10px] font-medium text-muted-foreground">Stamp look (switch)</p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={(style.newsStampStyle || 'circle') === 'circle' ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ newsStampStyle: 'circle' })}
          >
            Circle seal
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.newsStampStyle === 'rect' ? 'default' : 'outline'}
            className="h-7 text-[11px]"
            onClick={() => set({ newsStampStyle: 'rect' })}
          >
            Rect stamp
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Circle = double ring + top/bottom arc (TRIGGER ALERT) + center banner. Rect =
          rectangular CERTIFIED-style box.
        </p>

        <p className="text-[10px] font-medium text-muted-foreground">Preset (fills edit boxes)</p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'auto' as const, label: 'Auto' },
              { id: 'breaking' as const, label: 'Breaking' },
              { id: 'exploding' as const, label: 'Exploding' },
              { id: 'surge' as const, label: 'Surging' },
              { id: 'crash' as const, label: 'Crashing' },
              { id: 'alert' as const, label: 'Alert' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={(style.newsStampKind || 'auto') === opt.id ? 'default' : 'outline'}
              className="h-7 text-[11px]"
              onClick={() => {
                if (opt.id === 'auto') {
                  set({
                    newsStampKind: 'auto',
                    newsStampCenterText: '',
                    newsStampRingText: '',
                  })
                  return
                }
                const copy = shareNewsStampCopy(opt.id)
                set({
                  newsStampKind: opt.id,
                  newsStampCenterText: copy.center.join('\n'),
                  newsStampRingText: copy.ring,
                  newsStampMode:
                    style.newsStampMode === 'off' ? 'on' : style.newsStampMode || 'on',
                })
              }}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        <div className="space-y-1.5 border-t border-border/40 pt-2">
          <Label htmlFor={`${idPrefix}-stamp-center`} className="text-xs font-medium">
            Center wording
          </Label>
          <Textarea
            id={`${idPrefix}-stamp-center`}
            value={style.newsStampCenterText ?? ''}
            onChange={(e) => set({ newsStampCenterText: e.target.value })}
            rows={2}
            className="min-h-[3.5rem] resize-y text-sm"
            placeholder={'BREAKING\nNEWS'}
          />
          <p className="text-[10px] text-muted-foreground">
            One word per line (max ~4). Empty = follow preset / auto.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-stamp-ring`} className="text-xs font-medium">
            Ring wording (top & bottom of circle)
          </Label>
          <Input
            id={`${idPrefix}-stamp-ring`}
            value={style.newsStampRingText ?? ''}
            onChange={(e) => set({ newsStampRingText: e.target.value })}
            className="h-8 text-sm"
            placeholder="TRIGGER ALERT"
            disabled={style.newsStampStyle === 'rect'}
          />
          <p className="text-[10px] text-muted-foreground">
            Circle only — arc text top & bottom. Empty = preset (e.g. TRIGGER ALERT).
          </p>
        </div>

        <p className="text-[10px] font-medium text-muted-foreground">
          Ink color — family, then shade
        </p>
        <div className="space-y-2">
          {SHARE_NEWS_STAMP_INK_FAMILIES.map((fam) => {
            const shades = SHARE_NEWS_STAMP_INK_PRESETS.filter((p) => p.family === fam.id)
            if (!shades.length) return null
            return (
              <div key={fam.id} className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {fam.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {shades.map((opt) => {
                    const selected = (style.newsStampColor || 'red') === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        title={`${fam.label} · ${opt.label} ${opt.hex}`}
                        aria-label={`Ink ${fam.label} ${opt.label}`}
                        aria-pressed={selected}
                        onClick={() => set({ newsStampColor: opt.id })}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium',
                          selected
                            ? 'border-2 border-foreground shadow-sm'
                            : 'border-border/70 hover:bg-muted/50',
                        )}
                      >
                        <span
                          className="size-3.5 shrink-0 rounded-full border border-black/15 shadow-inner"
                          style={{ backgroundColor: opt.hex }}
                        />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Auto = red on down moves, gold on up. Classic red matches the original CERTIFIED look.
        </p>

        <p className="text-[10px] font-medium text-muted-foreground border-t border-border/40 pt-2">
          Position on card
        </p>
        <div className="flex flex-wrap gap-1">
          {(
            [
              { label: 'TL', x: 18, y: 18 },
              { label: 'Top', x: 50, y: 18 },
              { label: 'TR', x: 82, y: 18 },
              { label: 'Left', x: 18, y: 45 },
              { label: 'Center', x: 50, y: 42 },
              { label: 'Right', x: 82, y: 45 },
              { label: 'BL', x: 18, y: 78 },
              { label: 'Bottom', x: 50, y: 78 },
              { label: 'BR', x: 82, y: 78 },
            ] as const
          ).map((p) => (
            <Button
              key={p.label}
              type="button"
              size="sm"
              variant={
                (style.newsStampX ?? 50) === p.x && (style.newsStampY ?? 42) === p.y
                  ? 'default'
                  : 'outline'
              }
              className="h-7 min-w-10 px-2 text-[11px]"
              onClick={() => set({ newsStampX: p.x, newsStampY: p.y })}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {(
          [
            {
              id: 'stamp-x',
              label: 'Left ↔ right',
              key: 'newsStampX' as const,
              min: 0,
              max: 100,
              step: 1,
              unit: '%',
            },
            {
              id: 'stamp-y',
              label: 'Top ↕ bottom',
              key: 'newsStampY' as const,
              min: 0,
              max: 100,
              step: 1,
              unit: '%',
            },
            {
              id: 'stamp-dens',
              label: 'Dotted density',
              key: 'newsStampDotDensity' as const,
              min: 0,
              max: 100,
              step: 1,
              unit: '',
            },
            {
              id: 'stamp-size',
              label: 'Size / scale',
              key: 'newsStampSize' as const,
              min: 100,
              max: 1000,
              step: 5,
              unit: 'px',
            },
            {
              id: 'stamp-rot',
              label: 'Rotation',
              key: 'newsStampRotation' as const,
              min: -35,
              max: 35,
              step: 1,
              unit: '°',
            },
            {
              id: 'stamp-op',
              label: 'Fade / opacity (whole stamp)',
              key: 'newsStampOpacity' as const,
              min: 8,
              max: 100,
              step: 1,
              unit: '%',
            },
          ] as const
        ).map((row) => (
          <div key={row.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <Label htmlFor={`${idPrefix}-${row.id}`} className="text-xs font-medium">
                {row.label}
              </Label>
              <span className="tabular-nums text-muted-foreground">
                {style[row.key] ?? DEFAULT_SHARE_CARD_STYLE[row.key]}
                {row.unit}
              </span>
            </div>
            <input
              id={`${idPrefix}-${row.id}`}
              type="range"
              min={row.min}
              max={row.max}
              step={row.step}
              value={Number(style[row.key] ?? DEFAULT_SHARE_CARD_STYLE[row.key])}
              onChange={(e) => set({ [row.key]: Number(e.target.value) })}
              className="w-full accent-foreground"
            />
          </div>
        ))}
      </ShareLayoutSection>
      ) : null}

      {layoutTab === 'weight' ? (
      <ShareLayoutSection
        title="12 · Font weight"
        hint="Light · Regular · Medium · SemiBold · Bold · ExtraBold (Google Sans Flex)."
      >
        {(
          [
            {
              key: 'nameWeight' as const,
              label: 'Company',
              value: style.nameWeight || 'extrabold',
            },
            {
              key: 'sessionWeight' as const,
              label: 'Session line',
              value: style.sessionWeight || 'semibold',
            },
            {
              key: 'reasonWeight' as const,
              label: 'Reason body',
              value: style.reasonWeight || 'regular',
            },
            {
              key: 'brandWeight' as const,
              label: 'Track at Trigger',
              value: style.brandWeight || 'medium',
            },
          ] as const
        ).map((row) => (
          <div key={row.key} className="space-y-1">
            <span className="text-xs font-medium">{row.label}</span>
            <div className="flex flex-wrap gap-1">
              {SHARE_FONT_WEIGHT_OPTIONS.map((opt) => (
                <Button
                  key={opt.id}
                  type="button"
                  size="sm"
                  variant={row.value === opt.id ? 'default' : 'outline'}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => set({ [row.key]: opt.id })}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </ShareLayoutSection>
      ) : null}
      </div>
    </div>
  )
}

function deviceKey(device: EnabledDevice) {
  return device.device_id || device.expo_push_token
}

export default function NotificationsPage() {
  const { theme, toggleTheme } = useTheme()
  const { toast } = useBottomToast()
  /** Header tabs: Home first (default) · Trigger · 9AM */
  const [appTab, setAppTab] = useState<AppSwitcherTab>(() => {
    try {
      const app = new URLSearchParams(window.location.search).get('app')
      if (app === 'nineam' || app === 'trigger') return app
    } catch {
      /* ignore */
    }
    return 'hub'
  })
  /** Active push product when not on Home hub */
  const notificationApp: NotificationApp =
    appTab === 'nineam' || appTab === 'trigger' ? appTab : 'trigger'
  const [section, setSection] = useState<DashboardSection>('tickers')
  const [tickers, setTickers] = useState<MonitoredTicker[]>([])
  const [liveQuotes, setLiveQuotes] = useState<Record<string, YahooLiveQuote>>({})
  const [liveQuotesLastCheckedAt, setLiveQuotesLastCheckedAt] = useState<number | null>(null)
  const [liveQuotesForTickerKey, setLiveQuotesForTickerKey] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [tickersLoadedForApp, setTickersLoadedForApp] = useState<NotificationApp | null>(null)
  const [activeTicker, setActiveTicker] = useState<string>('')
  const [tickerSort, setTickerSort] = useState<TickerSortMode>(() =>
    loadTickerSortPreference(),
  )
  const initialMoverSelectionRef = useRef<string | null>(null)
  const userSelectedTickerRef = useRef(false)
  const updateTickerSort = useCallback((next: TickerSortMode) => {
    setTickerSort(next)
    try {
      writePref(TICKER_SORT_PREF_KEY, next)
    } catch {
      /* localStorage unavailable */
    }
  }, [])
  const selectTickerByUser = useCallback((ticker: string) => {
    userSelectedTickerRef.current = true
    setActiveTicker(String(ticker || '').trim().toUpperCase())
  }, [])
  /** Sidebar Yahoo search — filter list + add missing equities */
  const [tickerSearchQuery, setTickerSearchQuery] = useState('')
  const [tickerSearchOpen, setTickerSearchOpen] = useState(false)
  const [tickerSearchResults, setTickerSearchResults] = useState<YahooSearchResult[]>([])
  const [tickerSearchLoading, setTickerSearchLoading] = useState(false)
  const [tickerAddBusy, setTickerAddBusy] = useState<string | null>(null)
  const tickerSearchRef = useRef<HTMLDivElement | null>(null)
  /** Stocks sidebar: Users | Extreme (view-only) | Pinned (time-labeled, never Users) */
  const [stocksListTab, setStocksListTab] = useState<StocksListTab>('users')
  const stocksListTabRef = useRef<StocksListTab>(stocksListTab)
  stocksListTabRef.current = stocksListTab
  const [extremeMovers, setExtremeMovers] = useState<YahooExtremeMover[]>([])
  const [extremeMoversLoading, setExtremeMoversLoading] = useState(false)
  const [extremeMoversError, setExtremeMoversError] = useState('')
  const [extremeMoversFetchedAt, setExtremeMoversFetchedAt] = useState<string | null>(null)
  const [extremeDirectionTab, setExtremeDirectionTab] =
    useState<ExtremeDirectionTab>('positive')
  const [companyProfile, setCompanyProfile] = useState<YahooCompanyProfile | null>(null)
  const [companyProfileLoading, setCompanyProfileLoading] = useState(false)
  const [extremePinned, setExtremePinned] = useState<ExtremePinnedItem[]>(() =>
    loadExtremePinnedCache(),
  )
  const extremePinnedSet = useMemo(
    () => new Set(extremePinned.map((item) => item.ticker.toUpperCase())),
    [extremePinned],
  )
  const [tabState, setTabState] = useState<Record<string, TabScrapeState>>({})
  const [creditHint, setCreditHint] = useState<string>('')
  const [firecrawlCredits, setFirecrawlCredits] = useState<{
    remaining: number | null
    plan: number | null
  } | null>(null)
  const [geminiTotals, setGeminiTotals] = useState<GeminiUsageTotals | null>(null)
  const [allTickersLoading, setAllTickersLoading] = useState(false)
  const [allTickersProgress, setAllTickersProgress] = useState({ completed: 0, total: 0 })
  const [fetchErrorPopup, setFetchErrorPopup] = useState<FetchErrorPopup | null>(null)
  /** After Fetch & save all / 9 PM alert: live per-company progress + hits. */
  const [fetchAllHitsOpen, setFetchAllHitsOpen] = useState(false)
  /** fetch_all = ≥4% filter; nine_pm = all new/changed + digest at the end */
  const [fetchAllMode, setFetchAllMode] = useState<'fetch_all' | 'nine_pm'>('fetch_all')
  const [fetchAllRows, setFetchAllRows] = useState<FetchAllTickerRow[]>([])
  const [fetchAllAlertMsg, setFetchAllAlertMsg] = useState<Record<string, string>>({})
  const [fetchAllAlertAllBusy, setFetchAllAlertAllBusy] = useState(false)
  const [fetchAllDigestMsg, setFetchAllDigestMsg] = useState('')
  const [usagePopup, setUsagePopup] = useState<
    null | 'gemini' | 'firecrawl' | 'perplexity'
  >(null)
  const [perplexityTotals, setPerplexityTotals] = useState<{
    total_cost_usd?: number
    total_cost_usd_display?: string
    total_credits?: number
    total_tokens?: number
    total_calls?: number
  } | null>(null)
  /** X / Twitter thread composer (review → Start opens new tab with tweet 1) */
  const [tweetComposerOpen, setTweetComposerOpen] = useState(false)
  const [tweetThread, setTweetThread] = useState<MomentumTweetThread | null>(null)
  const [tweetImageUrl, setTweetImageUrl] = useState<string | null>(null)
  const [tweetImageBlob, setTweetImageBlob] = useState<Blob | null>(null)
  const [tweetComposerBusy] = useState(false)
  const [tweetStartBusy, setTweetStartBusy] = useState(false)
  /** Context needed to re-render share image when sliders / text edits change. */
  const [tweetRenderCtx, setTweetRenderCtx] = useState<{
    ticker: string
    event: PriceMovementEvent
    companyName?: string | null
    cardText: ShareCardTextContent
  } | null>(null)
  const [shareCardStyle, setShareCardStyle] = useState<ShareCardStyle>(() =>
    loadShareCardStyle(),
  )
  /** Side photo on share card (session-only; chart 70% / photo 30%). */
  const [shareSideImageDataUrl, setShareSideImageDataUrl] = useState<string | null>(null)

  /** Persist every layout change so the next Share open keeps the user’s settings. */
  const updateShareCardStyle = useCallback(
    (next: ShareCardStyle | ((prev: ShareCardStyle) => ShareCardStyle)) => {
      setShareCardStyle((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        saveShareCardStyle(resolved)
        return resolved
      })
    },
    [],
  )
  const [shareImageRerendering, setShareImageRerendering] = useState(false)
  /** Custom pasted logos (data URLs) keyed by ticker — localStorage-backed. */
  const [customLogos, setCustomLogos] = useState<Record<string, string>>(() =>
    loadCustomLogoMap(),
  )
  const [logoReplaceOpen, setLogoReplaceOpen] = useState(false)
  const [logoReplaceTicker, setLogoReplaceTicker] = useState('')
  const [logoReplaceCompany, setLogoReplaceCompany] = useState<string | null>(null)
  const [logoPasteBusy, setLogoPasteBusy] = useState(false)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState('')
  const [geminiDailyUsage, setGeminiDailyUsage] = useState<
    Array<{
      day: string
      cost_usd?: number
      cost_usd_display?: string
      total_tokens?: number
      credits_used?: number
      calls?: number
      ticker_count?: number
    }>
  >([])
  const [geminiUsageTotals, setGeminiUsageTotals] = useState<{
    total_cost_usd_display?: string
    total_tokens?: number
  } | null>(null)
  const [firecrawlDailyUsage, setFirecrawlDailyUsage] = useState<
    Array<{ day: string; credits_used?: number; scrapes?: number }>
  >([])
  const [firecrawlUsageTotals, setFirecrawlUsageTotals] = useState<{
    total_credits?: number
    balance?: { remaining_credits?: number | null; plan_credits?: number | null } | null
    note?: string
  } | null>(null)
  const [perplexityDailyUsage, setPerplexityDailyUsage] = useState<
    Array<{
      day: string
      cost_usd?: number
      cost_usd_display?: string
      credits_used?: number
      total_tokens?: number
      calls?: number
    }>
  >([])
  const [perplexityUsageTotals, setPerplexityUsageTotals] = useState<{
    total_cost_usd_display?: string
    total_credits?: number
    total_tokens?: number
    total_calls?: number
    balance_note?: string
    console_url?: string
  } | null>(null)
  /** Left workspace rail (collapsible) — collapsed by default for more main space. */
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(true)
  /** Right-side activity log rail (collapsible) — collapsed by default. */
  const [logsCollapsed, setLogsCollapsed] = useState(true)
  /** Expanded log card keys (default: all collapsed — main line only). */
  const [expandedLogKeys, setExpandedLogKeys] = useState<Record<string, boolean>>({})

  // News alert tab
  const [news, setNews] = useState<NewsArticle[]>([])
  const [newsTotal, setNewsTotal] = useState<number | null>(null)
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsLoadingMore, setNewsLoadingMore] = useState(false)
  const [newsError, setNewsError] = useState('')
  const [newsHasMore, setNewsHasMore] = useState(false)
  const [newsSending, setNewsSending] = useState(false)
  const [newsAlertMessage, setNewsAlertMessage] = useState('')
  const [newsAlertIsError, setNewsAlertIsError] = useState(false)
  const [newsLogs, setNewsLogs] = useState<ScrapeLog[]>([])
  const [devices, setDevices] = useState<EnabledDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState('')
  /** Settings: public.app_releases (ios | android | all). */
  type AppReleaseRow = {
    id: string
    min_version: string
    min_build: number
    latest_version: string
    latest_build: number
    force_update: boolean
    title?: string | null
    message?: string | null
    store_url?: string | null
    check_eas_update?: boolean
    enabled?: boolean
    updated_at?: string | null
  }
  type AppReleasePlatform = 'ios' | 'android' | 'all'
  const [appReleases, setAppReleases] = useState<AppReleaseRow[]>([])
  const [appReleasePlatform, setAppReleasePlatform] = useState<AppReleasePlatform>('ios')
  const [appLatestVersion, setAppLatestVersion] = useState('')
  const [appLatestBuild, setAppLatestBuild] = useState('')
  const [appMinVersion, setAppMinVersion] = useState('')
  const [appMinBuild, setAppMinBuild] = useState('')
  const [appForceUpdate, setAppForceUpdate] = useState(false)
  const [appCheckEasUpdate, setAppCheckEasUpdate] = useState(true)
  const [appReleaseEnabled, setAppReleaseEnabled] = useState(true)
  const [appReleaseTitle, setAppReleaseTitle] = useState('')
  const [appReleaseMessage, setAppReleaseMessage] = useState('')
  const [appStoreUrl, setAppStoreUrl] = useState('')
  const [appSettingsLoading, setAppSettingsLoading] = useState(false)
  const [appSettingsSaving, setAppSettingsSaving] = useState(false)
  const [appSettingsError, setAppSettingsError] = useState('')
  const [appSettingsMessage, setAppSettingsMessage] = useState('')
  const [appSettingsUpdatedAt, setAppSettingsUpdatedAt] = useState<string | null>(null)
  const [appSettingsNeedsSchema, setAppSettingsNeedsSchema] = useState(false)
  const [appSettingsNeedsServiceRole, setAppSettingsNeedsServiceRole] = useState(false)
  /** Selected news article id (single). */
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null)
  /** Selected device keys: device_id if present, else expo_push_token. */
  const [selectedDeviceKeys, setSelectedDeviceKeys] = useState<string[]>([])

  // Custom notification tab
  const [customTitle, setCustomTitle] = useState('')
  const [customBody, setCustomBody] = useState('')
  const [customSending, setCustomSending] = useState(false)
  const [customMessage, setCustomMessage] = useState('')
  const [customIsError, setCustomIsError] = useState(false)
  const [customLogs, setCustomLogs] = useState<ScrapeLog[]>([])
  const [usersLogs, setUsersLogs] = useState<ScrapeLog[]>([])
  const [customSelectedDeviceKeys, setCustomSelectedDeviceKeys] = useState<string[]>([])
  const [movementAlertOpen, setMovementAlertOpen] = useState(false)
  const [movementAlertTarget, setMovementAlertTarget] = useState<MovementAlertTarget | null>(null)
  const [movementAlertDeviceKeys, setMovementAlertDeviceKeys] = useState<string[]>([])
  const [movementPreviewTitle, setMovementPreviewTitle] = useState('')
  const [movementPreviewBody, setMovementPreviewBody] = useState('')
  const [movementPreviewLoading, setMovementPreviewLoading] = useState(false)
  const [movementPreviewError, setMovementPreviewError] = useState('')
  const [digestOpen, setDigestOpen] = useState(false)
  const [digestScopeDeviceKeys, setDigestScopeDeviceKeys] = useState<string[]>([])
  const [digestSelectedDeviceKeys, setDigestSelectedDeviceKeys] = useState<string[]>([])
  const [digestTitle, setDigestTitle] = useState("Today's notable price momentum")
  const [digestSending, setDigestSending] = useState(false)
  const [digestMessage, setDigestMessage] = useState('')
  const [digestIsError, setDigestIsError] = useState(false)
  /** Gemini classify loading / errors keyed by ticker|event_date|field */
  const [geminiBusyKey, setGeminiBusyKey] = useState<string | null>(null)
  const [geminiErrorByKey, setGeminiErrorByKey] = useState<Record<string, string>>({})
  /**
   * Monotonic id so a slow Gemini response for date A cannot overwrite the
   * review dialog opened for date B (felt like “always the date below”).
   */
  const geminiRequestSeqRef = useRef(0)
  /** Edit Gemini output before saving to Supabase. */
  const [geminiEditOpen, setGeminiEditOpen] = useState(false)
  const [geminiEditDraft, setGeminiEditDraft] = useState('')
  const [geminiEditOriginal, setGeminiEditOriginal] = useState('')
  const [geminiEditModel, setGeminiEditModel] = useState<string | null>(null)
  const [geminiEditUsage, setGeminiEditUsage] = useState<{
    prompt_tokens: number
    output_tokens: number
    thoughts_tokens: number
    total_tokens: number
    credits_used: number
    cost_usd: number
    cost_usd_display: string
    message: string
  } | null>(null)
  const [geminiEditTarget, setGeminiEditTarget] = useState<{
    ticker: string
    event: PriceMovementEvent
  } | null>(null)
  const [geminiEditSaving, setGeminiEditSaving] = useState(false)
  const [geminiEditError, setGeminiEditError] = useState('')
  /** Bulk Gemini over all pending (unsaved) scrape events for a ticker. */
  const [geminiBulkBusy, setGeminiBulkBusy] = useState(false)
  const [geminiBulkProgress, setGeminiBulkProgress] = useState({ done: 0, total: 0 })
  /** Gemini + auto-save: editable prompt → run on active ticker dates missing gemini_formating. */
  const [geminiPromptOpen, setGeminiPromptOpen] = useState(false)
  const [geminiPromptText, setGeminiPromptText] = useState('')
  const [geminiPromptLoading, setGeminiPromptLoading] = useState(false)
  const [geminiPromptRunning, setGeminiPromptRunning] = useState(false)
  const [geminiPromptError, setGeminiPromptError] = useState('')
  /** Inline reason editors keyed by event date|time */
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({})
  /** Editable sources text (one line: Title | URL) keyed like reason drafts */
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, string>>({})
  const [reasonSavingKey, setReasonSavingKey] = useState<string | null>(null)
  /** Multi-platform share sheet for a date card */
  const [socialShareOpen, setSocialShareOpen] = useState(false)
  /** Full-viewport lightbox for the share-card preview image */
  const [socialSharePreviewFullscreen, setSocialSharePreviewFullscreen] =
    useState(false)
  const [socialShareBusy, setSocialShareBusy] = useState(false)
  const [socialSharePlatformBusy, setSocialSharePlatformBusy] = useState<string | null>(
    null,
  )
  const [socialShareCtx, setSocialShareCtx] = useState<{
    ticker: string
    event: PriceMovementEvent
    companyName?: string | null
    thread: MomentumTweetThread
    imageBlob: Blob | null
    imageUrl: string | null
    /** Native PNG pixel size (export is Full HD by default: 1920×…). */
    imageWidth: number | null
    imageHeight: number | null
    cardText: ShareCardTextContent
  } | null>(null)
  /** Last Gemini usage (tokens/credits/cost) keyed by event; also session last for log header. */
  const [geminiUsageByKey, setGeminiUsageByKey] = useState<
    Record<
      string,
      {
        prompt_tokens: number
        output_tokens: number
        thoughts_tokens: number
        total_tokens: number
        credits_used: number
        cost_usd_display: string
        message: string
        model?: string | null
        retries?: number
        models_tried?: string[]
      }
    >
  >({})
  const [lastGeminiUsage, setLastGeminiUsage] = useState<{
    prompt_tokens: number
    output_tokens: number
    thoughts_tokens: number
    total_tokens: number
    credits_used: number
    cost_usd_display: string
    message: string
    model?: string | null
    retries?: number
    models_tried?: string[]
  } | null>(null)

  const activeState = activeTicker ? tabState[activeTicker] || emptyTabState() : emptyTabState()
  /** Push-ready devices only — stopped users never enter alert pools. */
  const isDeviceAlertable = useCallback((device: EnabledDevice) => {
    if (device.subscription_status === 'off') return false
    if (device.enabled === false) return false
    return true
  }, [])
  const alertableDevices = useMemo(
    () => devices.filter(isDeviceAlertable),
    [devices, isDeviceAlertable],
  )
  const movementAlertDevices = useMemo(() => {
    if (!movementAlertTarget) return []
    // Extreme / Pinned blasts: every notifications-on device, even if not on this ticker.
    if (movementAlertTarget.allRecipients) return alertableDevices
    const ticker = movementAlertTarget.ticker.toUpperCase()
    return alertableDevices.filter((device) =>
      (device.tickers || []).some((item) => item.toUpperCase() === ticker),
    )
  }, [alertableDevices, movementAlertTarget])
  const movementAlertSelectedCount = useMemo(() => {
    const selected = new Set(movementAlertDeviceKeys)
    return movementAlertDevices.filter((device) => selected.has(deviceKey(device))).length
  }, [movementAlertDeviceKeys, movementAlertDevices])
  const digestDevices = useMemo(() => {
    const scope = new Set(digestScopeDeviceKeys)
    return alertableDevices.filter((device) => scope.has(deviceKey(device)))
  }, [alertableDevices, digestScopeDeviceKeys])
  const digestSelectedCount = useMemo(() => {
    const selected = new Set(digestSelectedDeviceKeys)
    return digestDevices.filter((device) => selected.has(deviceKey(device))).length
  }, [digestDevices, digestSelectedDeviceKeys])

  const appendNewsLog = useCallback((level: string, message: string, detail?: unknown) => {
    setNewsLogs((prev) => [
      ...prev,
      {
        at: new Date().toISOString(),
        level,
        message,
        detail: detail ?? null,
      },
    ])
  }, [])

  const appendCustomLog = useCallback((level: string, message: string, detail?: unknown) => {
    setCustomLogs((prev) => [
      ...prev,
      {
        at: new Date().toISOString(),
        level,
        message,
        detail: detail ?? null,
      },
    ])
  }, [])

  const appendUsersLog = useCallback((level: string, message: string, detail?: unknown) => {
    setUsersLogs((prev) => [
      ...prev,
      {
        at: new Date().toISOString(),
        level,
        message,
        detail: detail ?? null,
      },
    ])
  }, [])

  const loadTickers = useCallback(async () => {
    setListLoading(true)
    setListError('')
    try {
      const response = await fetch(
        `/api/notifications/monitored-tickers?app=${encodeURIComponent(notificationApp)}`,
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Failed to load tickers (${response.status})`)
      }
      // Momentum is stocks-only — drop commodity / crypto / forex / index.
      const next = ((body.tickers || []) as MonitoredTicker[]).filter(isEquityTicker)
      setTickers(next)
      setTickersLoadedForApp(notificationApp)
      const totalsFromApi = body.gemini_totals as GeminiUsageTotals | undefined
      if (totalsFromApi && typeof totalsFromApi === 'object') {
        setGeminiTotals({
          ...totalsFromApi,
          cost_usd_display:
            totalsFromApi.cost_usd_display ||
            formatUsdCompact(totalsFromApi.cost_usd),
        })
      } else {
        setGeminiTotals(
          sumEventsGeminiUsage(next.flatMap((item) => item.saved_events || [])),
        )
      }
      // Never steal focus from Extreme / Pinned into the Users list.
      setActiveTicker((current) => {
        const cur = String(current || '').trim().toUpperCase()
        const tab = stocksListTabRef.current
        if (tab === 'extreme' || tab === 'pinned') {
          return cur || current || ''
        }
        if (cur && next.some((item) => item.ticker.toUpperCase() === cur)) return cur
        return next[0]?.ticker || ''
      })
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Failed to load monitored tickers')
    } finally {
      setListLoading(false)
    }
  }, [notificationApp])

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true)
    setDevicesError('')
    try {
      // Cache-bust so Audience always reflects latest subscribe/stop from Supabase.
      const response = await fetch(
        `/api/notifications/devices?app=${encodeURIComponent(notificationApp)}&_=${Date.now()}`,
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Failed to load devices (${response.status})`)
      }
      const next = ((body.devices || []) as EnabledDevice[]).map((device) => {
        const enabledList = device.enabled_tickers || device.tickers || []
        const cryptoTickers = Array.from(
          new Set([
            ...((device.crypto_tickers || []) as string[]),
            ...enabledList.filter(looksLikeCryptoTicker),
          ]),
        ).sort()
        const stockTickers = stockTickersOnly(enabledList)
        const disabledTickers = stockTickersOnly(device.disabled_tickers || [])
        const enabled =
          device.enabled != null
            ? Boolean(device.enabled)
            : stockTickers.length > 0 || cryptoTickers.length > 0
        const subscription_status: EnabledDevice['subscription_status'] =
          device.subscription_status ||
          (enabled && disabledTickers.length > 0
            ? 'partial'
            : enabled
              ? 'on'
              : 'off')
        return {
          ...device,
          enabled,
          subscription_status,
          enabled_tickers: stockTickers,
          disabled_tickers: disabledTickers,
          enabled_count: stockTickers.length,
          disabled_count: disabledTickers.length,
          // Audience chips stay stocks-only; pro signal uses crypto list.
          crypto_tickers: cryptoTickers,
          pro_crypto: Boolean(device.pro_crypto) || cryptoTickers.length > 0,
          tickers: stockTickers,
        }
      })
      setDevices(next)
      // Selection only among alertable (enabled) devices for sends.
      const alertableKeys = next.filter((d) => d.enabled).map(deviceKey)
      setSelectedDeviceKeys((prev) => {
        if (prev.length === 0 && alertableKeys.length > 0) return alertableKeys
        const keys = new Set(alertableKeys)
        const kept = prev.filter((k) => keys.has(k))
        return kept.length ? kept : alertableKeys
      })
      setCustomSelectedDeviceKeys((prev) => {
        if (prev.length === 0 && alertableKeys.length > 0) return alertableKeys
        const keys = new Set(alertableKeys)
        const kept = prev.filter((k) => keys.has(k))
        return kept.length ? kept : alertableKeys
      })
      const onCount = next.filter((d) => d.enabled).length
      const offCount = next.filter((d) => !d.enabled).length
      appendNewsLog(
        'info',
        `Loaded ${next.length} device(s) · ${onCount} notifications on · ${offCount} stopped`,
        { device_ids: next.map((d) => d.device_id) },
      )
      appendCustomLog(
        'info',
        `Loaded ${next.length} device(s) · ${onCount} notifications on · ${offCount} stopped`,
        { device_ids: next.map((d) => d.device_id) },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load devices'
      setDevicesError(message)
      appendNewsLog('error', message)
      appendCustomLog('error', message)
    } finally {
      setDevicesLoading(false)
    }
  }, [appendNewsLog, appendCustomLog, notificationApp])

  const applyAppReleaseToForm = useCallback((row: AppReleaseRow | null | undefined) => {
    if (!row) {
      setAppLatestVersion('')
      setAppLatestBuild('')
      setAppMinVersion('')
      setAppMinBuild('')
      setAppForceUpdate(false)
      setAppCheckEasUpdate(true)
      setAppReleaseEnabled(true)
      setAppReleaseTitle('')
      setAppReleaseMessage('')
      setAppStoreUrl('')
      setAppSettingsUpdatedAt(null)
      return
    }
    setAppLatestVersion(String(row.latest_version || ''))
    setAppLatestBuild(
      row.latest_build == null || Number.isNaN(Number(row.latest_build))
        ? ''
        : String(row.latest_build),
    )
    setAppMinVersion(String(row.min_version || ''))
    setAppMinBuild(
      row.min_build == null || Number.isNaN(Number(row.min_build))
        ? ''
        : String(row.min_build),
    )
    setAppForceUpdate(Boolean(row.force_update))
    setAppCheckEasUpdate(row.check_eas_update !== false)
    setAppReleaseEnabled(row.enabled !== false)
    setAppReleaseTitle(String(row.title || ''))
    setAppReleaseMessage(String(row.message || ''))
    setAppStoreUrl(String(row.store_url || ''))
    setAppSettingsUpdatedAt(row.updated_at || null)
  }, [])

  const loadAppSettings = useCallback(async () => {
    setAppSettingsLoading(true)
    setAppSettingsError('')
    setAppSettingsMessage('')
    setAppSettingsNeedsSchema(false)
    setAppSettingsNeedsServiceRole(false)
    try {
      const response = await fetch(
        `/api/notifications/app-settings?_=${Date.now()}`,
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (body.needs_schema) setAppSettingsNeedsSchema(true)
        if (body.needs_service_role) setAppSettingsNeedsServiceRole(true)
        throw new Error(body.error || `Failed to load settings (${response.status})`)
      }
      // Load succeeded → table is readable; clear any prior schema warning.
      setAppSettingsNeedsSchema(false)
      const releases = (body.releases || []) as AppReleaseRow[]
      setAppReleases(releases)
      const current =
        releases.find((r) => r.id === appReleasePlatform) ||
        releases[0] ||
        null
      if (current && current.id !== appReleasePlatform) {
        const nextId = current.id as AppReleasePlatform
        if (nextId === 'ios' || nextId === 'android' || nextId === 'all') {
          setAppReleasePlatform(nextId)
        }
      }
      applyAppReleaseToForm(current)
    } catch (error) {
      setAppSettingsError(
        error instanceof Error ? error.message : 'Failed to load app settings',
      )
    } finally {
      setAppSettingsLoading(false)
    }
  }, [appReleasePlatform, applyAppReleaseToForm])

  const saveAppSettings = useCallback(async () => {
    setAppSettingsSaving(true)
    setAppSettingsError('')
    setAppSettingsMessage('')
    setAppSettingsNeedsSchema(false)
    setAppSettingsNeedsServiceRole(false)
    try {
      const response = await fetch('/api/notifications/app-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: appReleasePlatform,
          latest_version: appLatestVersion.trim(),
          latest_build: appLatestBuild.trim(),
          min_version: appMinVersion.trim(),
          min_build: appMinBuild.trim(),
          force_update: appForceUpdate,
          check_eas_update: appCheckEasUpdate,
          enabled: appReleaseEnabled,
          title: appReleaseTitle.trim() || null,
          message: appReleaseMessage.trim() || null,
          store_url: appStoreUrl.trim() || null,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (body.needs_schema) setAppSettingsNeedsSchema(true)
        if (body.needs_service_role || body.code === 'RLS_WRITE_DENIED') {
          setAppSettingsNeedsServiceRole(true)
        }
        throw new Error(body.error || `Save failed (${response.status})`)
      }
      const settings = body.settings as AppReleaseRow
      setAppReleases((prev) => {
        const next = prev.filter((r) => r.id !== settings.id)
        next.push(settings)
        return next.sort((a, b) => a.id.localeCompare(b.id))
      })
      applyAppReleaseToForm(settings)
      setAppSettingsMessage(
        body.message ||
          `Saved ${settings.id} · v${settings.latest_version} · build ${settings.latest_build}`,
      )
      toast({
        title: 'App release saved',
        description: `${settings.id} · v${settings.latest_version} · build ${settings.latest_build}`,
      })
    } catch (error) {
      setAppSettingsError(
        error instanceof Error ? error.message : 'Failed to save app settings',
      )
    } finally {
      setAppSettingsSaving(false)
    }
  }, [
    appCheckEasUpdate,
    appForceUpdate,
    appLatestBuild,
    appLatestVersion,
    appMinBuild,
    appMinVersion,
    appReleaseEnabled,
    appReleaseMessage,
    appReleasePlatform,
    appReleaseTitle,
    appStoreUrl,
    applyAppReleaseToForm,
    toast,
  ])

  // When platform tab changes, fill form from cached releases (no extra fetch).
  useEffect(() => {
    if (section !== 'settings') return
    const row = appReleases.find((r) => r.id === appReleasePlatform)
    if (row) applyAppReleaseToForm(row)
    else applyAppReleaseToForm(null)
  }, [appReleasePlatform, appReleases, applyAppReleaseToForm, section])

  /**
   * Latest Yahoo Finance news for the user's monitored watchlist tickers
   * (not stale Supabase market_news_articles).
   */
  const loadNews = useCallback(
    async (_opts?: { append?: boolean }) => {
      // Yahoo feed is a fresh full replace — no Supabase pagination.
      setNewsLoading(true)
      setNewsLoadingMore(false)
      setNewsError('')
      try {
        // Prefer monitored tickers already in state; if empty, fetch once.
        let symbols = tickers
          .map((t) => String(t.ticker || '').trim().toUpperCase())
          .filter(Boolean)
        if (!symbols.length) {
          try {
            const tRes = await fetch(
              `/api/notifications/monitored-tickers?app=${encodeURIComponent(notificationApp)}`,
            )
            const tBody = await tRes.json().catch(() => ({}))
            if (tRes.ok && Array.isArray(tBody.tickers)) {
              const equity = (tBody.tickers as MonitoredTicker[]).filter(
                isEquityTicker,
              )
              symbols = equity
                .map((t) => String(t.ticker || '').trim().toUpperCase())
                .filter(Boolean)
              setTickers(equity)
            }
          } catch {
            /* optional */
          }
        }

        // Dedupe + cap (API allows up to 24)
        const seen = new Set<string>()
        const unique: string[] = []
        for (const s of symbols) {
          if (seen.has(s)) continue
          seen.add(s)
          unique.push(s)
          if (unique.length >= 24) break
        }

        if (!unique.length) {
          setNews([])
          setNewsTotal(0)
          setNewsHasMore(false)
          setSelectedArticleId(null)
          setNewsError(
            'No watchlist tickers yet — add monitored stocks under Tickers, then reload news.',
          )
          appendNewsLog('warn', 'News skipped — empty watchlist')
          return
        }

        const params = new URLSearchParams({
          tickers: unique.join(','),
          max_age_days: '14',
          per_ticker: '8',
          limit: '48',
        })
        const response = await fetch(
          `/api/yahoo/watchlist-news?${params.toString()}`,
        )
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(
            body.error || `Failed to load Yahoo news (${response.status})`,
          )
        }
        const batch = (body.articles || []) as NewsArticle[]
        setNews(batch)
        setNewsTotal(
          typeof body.count === 'number' ? body.count : batch.length,
        )
        setNewsHasMore(false)
        if (batch.length > 0) {
          setSelectedArticleId((current) =>
            current && batch.some((a) => a.id === current)
              ? current
              : batch[0].id,
          )
        } else {
          setSelectedArticleId(null)
        }
        appendNewsLog(
          'info',
          `Loaded ${batch.length} latest Yahoo Finance articles for ${unique.length} watchlist ticker(s) (≤14 days)`,
          {
            tickers: unique,
            errors: body.errors,
            max_age_days: body.max_age_days,
          },
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load news'
        setNewsError(message)
        appendNewsLog('error', message)
      } finally {
        setNewsLoading(false)
        setNewsLoadingMore(false)
      }
    },
    [appendNewsLog, notificationApp, tickers],
  )

  const loadCreditsHint = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/firecrawl/credits')
      const body = await response.json().catch(() => ({}))
      if (!response.ok) return
      const remaining =
        body.credits?.remaining_credits != null
          ? Number(body.credits.remaining_credits)
          : null
      const plan =
        body.credits?.plan_credits != null ? Number(body.credits.plan_credits) : null
      setFirecrawlCredits({
        remaining: Number.isFinite(remaining as number) ? remaining : null,
        plan: Number.isFinite(plan as number) ? plan : null,
      })
      if (remaining != null && Number.isFinite(remaining)) {
        setCreditHint(
          plan != null && Number.isFinite(plan)
            ? `Firecrawl balance: ${remaining} / ${plan} credits`
            : `Firecrawl remaining: ${remaining} credits`,
        )
      }
    } catch {
      // optional
    }
  }, [])

  const loadPerplexityTotals = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/usage/perplexity?days=90')
      const body = await response.json().catch(() => ({}))
      if (!response.ok) return
      setPerplexityTotals({
        total_cost_usd: Number(body.total_cost_usd) || 0,
        total_cost_usd_display:
          body.total_cost_usd_display ||
          formatUsdCompact(body.total_cost_usd) ||
          '$0.000000',
        total_credits: Number(body.total_credits) || 0,
        total_tokens: Number(body.total_tokens) || 0,
        total_calls: Number(body.total_calls) || 0,
      })
    } catch {
      // optional
    }
  }, [])

  useEffect(() => {
    // Always refresh Perplexity spend totals (shown in top bar / hub)
    void loadPerplexityTotals()
    // Home hub: light landing only — load product data when Trigger / 9AM is open
    if (appTab === 'hub') return
    void loadTickers()
    void loadCreditsHint()
    void loadDevices()
  }, [appTab, loadTickers, loadCreditsHint, loadPerplexityTotals, loadDevices])

  useEffect(() => {
    if (appTab === 'hub') return
    setDevices([])
    if (notificationApp === 'trigger') {
      setSection((current) =>
        current === 'news' || current === 'custom' ? 'tickers' : current,
      )
    }
    setMovementAlertOpen(false)
    setMovementAlertTarget(null)
    setMovementAlertDeviceKeys([])
    setMovementPreviewTitle('')
    setMovementPreviewBody('')
    setMovementPreviewError('')
    setDigestOpen(false)
    setDigestScopeDeviceKeys([])
    setDigestSelectedDeviceKeys([])
    setDigestMessage('')
  }, [appTab, notificationApp])

  // When entering News or Custom, refresh devices (and news for News tab).
  useEffect(() => {
    if (section === 'news') {
      void loadDevices()
      void loadNews()
      return
    }
    if (section === 'custom' || section === 'users') {
      void loadDevices()
      return
    }
    if (section === 'settings') {
      void loadAppSettings()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on section enter
  }, [section])

  function patchTab(ticker: string, patch: Partial<TabScrapeState>) {
    setTabState((current) => ({
      ...current,
      [ticker]: {
        ...(current[ticker] || emptyTabState()),
        ...patch,
      },
    }))
  }

  function appendLocalLog(ticker: string, level: string, message: string, detail?: unknown) {
    const entry: ScrapeLog = {
      at: new Date().toISOString(),
      level,
      message,
      detail: detail ?? null,
    }
    setTabState((current) => {
      const prev = current[ticker] || emptyTabState()
      return {
        ...current,
        [ticker]: {
          ...prev,
          logs: [...prev.logs, entry],
        },
      }
    })
  }

  async function handleRefresh(
    ticker: string,
    options?: { reloadAfterSave?: boolean },
  ): Promise<ScrapeResult | null> {
    const shouldAutoSave = notificationApp === 'trigger'
    let failureStage: FetchErrorPopup['stage'] = 'fetch'
    setFetchErrorPopup((current) => (current?.ticker === ticker ? null : current))
    patchTab(ticker, { loading: true, error: '', saveMessage: '', saveIsNoop: false })
    appendLocalLog(
      ticker,
      'info',
      shouldAutoSave
        ? `Fetch + auto-save started for ${ticker}`
        : `Refresh clicked for ${ticker}`,
    )
    try {
      const monitorScope = activeMonitorScope(ticker)
      const symbol = String(ticker || '')
        .trim()
        .toUpperCase()
      // Only create pinned_monitored_tickers rows when already bookmarked / on Pinned tab.
      // Extreme view-only scrapes must not auto-pin or touch Users.
      const createIfMissing =
        monitorScope === 'pinned' &&
        (stocksListTab === 'pinned' || extremePinnedSet.has(symbol))
      const response = await fetch(
        `/api/notifications/scrape/${encodeURIComponent(ticker)}?auto_save=${
          shouldAutoSave ? '1' : '0'
        }&monitor_scope=${encodeURIComponent(monitorScope)}${
          createIfMissing ? '&create_if_missing=1' : ''
        }`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            monitor_scope: monitorScope,
            create_if_missing: createIfMissing,
            company_name:
              tickers.find((row) => row.ticker === ticker)?.company_name ||
              extremePinned.find((row) => row.ticker === ticker)?.company_name ||
              extremeMovers.find((row) => row.ticker === ticker)?.company_name ||
              undefined,
          }),
        },
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Scrape failed (${response.status})`)
      }
      const result = body as ScrapeResult
      const compare = result.compare
      const autoSave = result.auto_save
      const saveMessage = shouldAutoSave
        ? autoSave?.message || 'Fetch completed, but the backend did not confirm auto-save.'
        : compare
          ? compare.new === 0 && compare.changed === 0
            ? `All ${compare.already_saved} refreshed date(s) are already stored in Supabase.`
            : `${compare.new + compare.changed} refreshed date(s) are not yet saved — review and click Save.`
          : ''

      setTabState((current) => {
        const prev = current[ticker] || emptyTabState()
        return {
          ...current,
          [ticker]: {
            ...prev,
            loading: false,
            result,
            error: '',
            saveMessage,
            saveIsNoop: shouldAutoSave
              ? (autoSave?.inserted || 0) + (autoSave?.updated || 0) === 0
              : Boolean(compare && compare.new === 0 && compare.changed === 0),
            // Prefer server scrape logs; keep a short local preamble if empty.
            logs: result.logs?.length ? result.logs : prev.logs,
          },
        }
      })
      if (shouldAutoSave && (!autoSave || !autoSave.ok)) {
        failureStage = 'auto-save'
        throw new Error(autoSave?.message || 'Backend did not confirm that the data was saved.')
      }
      // Extreme/Pinned → only refresh pinned store. Never reload Users list for that path
      // (Users is subscriber-backed device_monitored_tickers only).
      if (monitorScope === 'pinned') {
        void loadPinnedTickers()
      }
      if (body.credits?.after?.remaining_credits != null) {
        const used = body.credits.used
        setCreditHint(
          used != null
            ? `Firecrawl balance: ${body.credits.after.remaining_credits} remaining · last scrape used ${used}`
            : `Firecrawl balance: ${body.credits.after.remaining_credits} remaining`,
        )
        setFirecrawlCredits((prev) => ({
          remaining: Number(body.credits.after.remaining_credits),
          plan:
            body.credits.after.plan_credits != null
              ? Number(body.credits.after.plan_credits)
              : prev?.plan ?? null,
        }))
      } else {
        void loadCreditsHint()
      }
      if (
        shouldAutoSave &&
        ((autoSave?.inserted || 0) > 0 || (autoSave?.updated || 0) > 0) &&
        options?.reloadAfterSave !== false &&
        monitorScope === 'device'
      ) {
        // Only reload Users list when we actually wrote device_monitored_tickers.
        void loadTickers()
      }
      return result
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : failureStage === 'auto-save'
            ? 'Auto-save failed'
            : 'Fetch failed'
      patchTab(ticker, { loading: false, error: message })
      appendLocalLog(ticker, 'error', message)
      setActiveTicker(ticker)
      setFetchErrorPopup({ ticker, stage: failureStage, message })
      return null
    }
  }

  function collectFetchAllHits(
    ticker: string,
    result: ScrapeResult,
    meta?: MonitoredTicker | null,
    options?: { minAbsPercent?: number },
  ): FetchAllHit[] {
    const minAbs = options?.minAbsPercent
    const inserted = new Set(
      (result.auto_save?.inserted_dates || []).map((d) => String(d).slice(0, 10)),
    )
    const updated = new Set(
      (result.auto_save?.updated_dates || []).map((d) => String(d).slice(0, 10)),
    )
    const hits: FetchAllHit[] = []
    for (const event of result.events || []) {
      const dateKey = String(event.event_date || '').slice(0, 10)
      // New dates, or today re-written (time_label diff → changed / updated).
      const isPending =
        event.save_status === 'new' ||
        event.save_status === 'changed' ||
        inserted.has(dateKey) ||
        updated.has(dateKey)
      if (!isPending) continue
      // Regular + pre-market only (no after-hours).
      const moves = eventSessionMoves(event)
      // fetch_all: ≥4%; nine_pm: all new/changed (minAbsPercent = 0 / omit)
      if (minAbs != null && minAbs > 0 && moves.abs_percent < minAbs) continue
      const alreadyGemini = hasGeminiFormating(event)
      hits.push({
        ticker,
        company_name: meta?.company_name || ticker,
        event,
        close_text: moves.close_text,
        close_abs: moves.close_abs,
        close_negative: moves.close_negative,
        premarket_text: moves.premarket_text,
        premarket_abs: moves.premarket_abs,
        premarket_negative: moves.premarket_negative,
        abs_percent: moves.abs_percent,
        subscriber_count: meta?.subscriber_count ?? 0,
        save_status: event.save_status,
        gemini_status: alreadyGemini ? 'done' : 'idle',
      })
    }
    return hits
  }

  function patchFetchAllHit(
    ticker: string,
    eventDate: string,
    patch: Partial<FetchAllHit>,
  ) {
    setFetchAllRows((rows) =>
      rows.map((row) =>
        row.ticker !== ticker
          ? row
          : {
              ...row,
              hits: row.hits.map((hit) =>
                hit.event.event_date === eventDate ? { ...hit, ...patch } : hit,
              ),
            },
      ),
    )
  }

  /**
   * Auto Gemini for a popup hit: structure + save to Supabase (no review popup).
   * Skips if already Gemini-tagged (unless force).
   */
  async function runFetchAllAutoGemini(hit: FetchAllHit, options?: { force?: boolean }) {
    const ticker = hit.ticker
    const event = hit.event
    const eventDate = event.event_date
    if (!options?.force && (hit.gemini_status === 'done' || hasGeminiFormating(event))) {
      patchFetchAllHit(ticker, eventDate, { gemini_status: 'done', gemini_error: undefined })
      return
    }
    const sourceText =
      String(event.original_summary || '').trim() ||
      reasonTextForGemini(event) ||
      String(event.summary || '').trim()

    if (!sourceText) {
      patchFetchAllHit(ticker, eventDate, {
        gemini_status: 'error',
        gemini_error: 'No reason text to structure',
      })
      return
    }

    patchFetchAllHit(ticker, eventDate, {
      gemini_status: 'running',
      gemini_error: undefined,
    })

    const companyName =
      tickers.find((item) => item.ticker === ticker)?.company_name ||
      hit.company_name ||
      ticker

    try {
      const response = await fetch('/api/notifications/gemini-summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sourceText,
          ticker,
          company_name: companyName,
          event_date: event.event_date,
          price: event.price,
          price_change: event.price_change || event.momentum,
          event,
          auto_save: true,
          monitor_scope: activeMonitorScope(ticker),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Gemini failed (${response.status})`)
      }
      const summary = String(body.summary || '').trim()
      if (!summary) throw new Error('Empty Gemini notification')
      if (!body.auto_save?.saved) {
        throw new Error(body.auto_save?.error || 'Gemini ran but save failed')
      }

      const usageLog = formatGeminiUsageForLog(body)
      applyGeminiSummaryToEvent(
        ticker,
        event.event_date,
        event.time_label,
        summary,
        sourceText,
        {
          markGemini: true,
          model:
            (body.model_version ? String(body.model_version) : null) ||
            (body.model ? String(body.model) : null) ||
            null,
          usage: {
            prompt_tokens: usageLog.prompt_tokens,
            output_tokens: usageLog.output_tokens,
            thoughts_tokens: usageLog.thoughts_tokens,
            total_tokens: usageLog.total_tokens,
            credits_used: usageLog.credits_used,
            cost_usd: usageLog.cost_usd,
            cost_usd_display: usageLog.cost_usd_display,
          },
        },
      )

      // Keep hit card summary fresh in the popup.
      patchFetchAllHit(ticker, eventDate, {
        gemini_status: 'done',
        gemini_error: undefined,
        event: {
          ...event,
          summary,
          original_summary: event.original_summary || sourceText,
          gemini_formating: true,
          gemini_model:
            body.model_version || body.model || event.gemini_model || null,
        },
      })
      appendLocalLog(ticker, 'success', `Auto-Gemini saved for ${eventDate}`, {
        model: body.model,
        cost: usageLog.cost_usd_display,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gemini failed'
      patchFetchAllHit(ticker, eventDate, {
        gemini_status: 'error',
        gemini_error: message,
      })
      appendLocalLog(ticker, 'error', `Auto-Gemini failed · ${eventDate}: ${message}`)
    }
  }

  /**
   * @param mode fetch_all = ≥4% filter + per-ticker alerts
   *             nine_pm  = all new/changed + Gemini all + Today's digest
   */
  async function handleRefreshAll(
    scope: MonitoredTicker[] = tickers,
    mode: 'fetch_all' | 'nine_pm' = 'fetch_all',
  ) {
    const list = scope.filter((item) => (item.subscriber_count ?? 0) > 0)
    if (!list.length || allTickersLoading) return

    const initialRows: FetchAllTickerRow[] = list.map((item) => ({
      ticker: item.ticker,
      company_name: item.company_name || item.ticker,
      subscriber_count: item.subscriber_count ?? 0,
      status: 'queued',
      hits: [],
    }))

    // Open popup immediately with the company list + loaders.
    setFetchAllMode(mode)
    setFetchAllRows(initialRows)
    setFetchAllAlertMsg({})
    setFetchAllDigestMsg('')
    setFetchAllHitsOpen(true)
    setAllTickersLoading(true)
    setAllTickersProgress({ completed: 0, total: list.length })

    const minAbs = mode === 'nine_pm' ? 0 : 4
    let hitCount = 0
    try {
      for (let index = 0; index < list.length; index += 1) {
        const meta = list[index]
        const symbol = meta.ticker

        setFetchAllRows((rows) =>
          rows.map((row, i) =>
            i === index
              ? { ...row, status: 'loading', error: undefined }
              : row,
          ),
        )

        const result = await handleRefresh(symbol, {
          reloadAfterSave: false,
        })

        if (!result) {
          setFetchAllRows((rows) =>
            rows.map((row, i) =>
              i === index
                ? {
                    ...row,
                    status: 'error',
                    error: 'Fetch or auto-save failed',
                    hits: [],
                  }
                : row.status === 'queued'
                  ? { ...row, status: 'skipped' as const }
                  : row,
            ),
          )
          break
        }

        const hits = collectFetchAllHits(symbol, result, meta, {
          minAbsPercent: minAbs,
        }).sort((a, b) => b.abs_percent - a.abs_percent)
        hitCount += hits.length
        const newDates = (result.events || []).filter(
          (e) =>
            e.save_status === 'new' ||
            e.save_status === 'changed' ||
            (result.auto_save?.inserted_dates || []).includes(
              String(e.event_date).slice(0, 10),
            ) ||
            (result.auto_save?.updated_dates || []).includes(
              String(e.event_date).slice(0, 10),
            ),
        ).length

        setFetchAllRows((rows) =>
          rows.map((row, i) =>
            i === index
              ? {
                  ...row,
                  status: 'done',
                  hits,
                  new_dates: newDates,
                  error: undefined,
                }
              : row,
          ),
        )
        setAllTickersProgress({
          completed: index + 1,
          total: list.length,
        })

        // Gemini: fetch_all = only ≥4% hits; nine_pm = every new/changed date.
        // Already-tagged Gemini hits are skipped inside runFetchAllAutoGemini.
        for (const hit of hits) {
          void runFetchAllAutoGemini(hit)
        }
      }
    } finally {
      setAllTickersLoading(false)
      void loadTickers()
      appendLocalLog(
        list[0]?.ticker || 'ALL',
        hitCount ? 'success' : 'info',
        mode === 'nine_pm'
          ? hitCount
            ? `9 PM alert fetch done · ${hitCount} new/updated date(s) · Gemini running`
            : '9 PM alert fetch done · no new/updated dates'
          : hitCount
            ? `Fetch & save all done · ${hitCount} date(s) with ≥4% move`
            : 'Fetch & save all done · no new dates with ≥4% move',
        { hits: hitCount, scanned: list.length, mode },
      )
    }
  }

  /** One-click alert to every device subscribed to this ticker for a specific date. */
  async function handleFetchAllQuickAlert(hit: FetchAllHit) {
    const ticker = hit.ticker.toUpperCase()
    const hitKey = `${ticker}|${hit.event.event_date}`
    const eligible = alertableDevices.filter((device) =>
      (device.tickers || []).some((item) => item.toUpperCase() === ticker),
    )
    if (!eligible.length) {
      setFetchAllAlertMsg((prev) => ({
        ...prev,
        [hitKey]: 'No subscribers for this ticker',
      }))
      return
    }

    setFetchAllAlertMsg((prev) => {
      const next = { ...prev }
      delete next[hitKey]
      return next
    })
    appendLocalLog(ticker, 'info', `Fetch-all hits: alerting all subscribers for ${hit.event.event_date}`, {
      recipients: eligible.length,
    })

    try {
      const response = await fetch(`/api/notifications/alert/${encodeURIComponent(ticker)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_key: notificationApp,
          event: hit.event,
          device_ids: eligible.map((device) => device.device_id).filter(Boolean),
          expo_push_tokens: eligible.map((device) => device.expo_push_token),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Alert failed (${response.status})`)
      }
      const message =
        body.message ||
        `Alert sent to ${body.sent_ok ?? eligible.length} device(s)` +
          (body.sent_failed ? ` · ${body.sent_failed} failed` : '')
      setFetchAllAlertMsg((prev) => ({ ...prev, [hitKey]: message }))
      appendLocalLog(ticker, body.sent_failed ? 'warn' : 'success', message, body)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Alert failed'
      setFetchAllAlertMsg((prev) => ({ ...prev, [hitKey]: message }))
      appendLocalLog(ticker, 'error', message)
    }
  }

  function handleFetchAllOpenAlertPicker(hit: FetchAllHit) {
    setActiveTicker(hit.ticker)
    setSection('tickers')
    void openMovementAlert(hit.ticker, hit.event)
  }

  /**
   * Top-right Alert all:
   * - fetch_all mode → per-hit push to each ticker's subscribers
   * - nine_pm mode → Today's momentum digest to all Trigger devices
   */
  async function handleFetchAllAlertAll() {
    if (fetchAllAlertAllBusy) return

    if (fetchAllMode === 'nine_pm') {
      setFetchAllAlertAllBusy(true)
      setFetchAllDigestMsg('')
      appendLocalLog('ALL', 'info', '9 PM alert: sending Today’s digest to all Trigger users')
      try {
        const response = await fetch('/api/notifications/alert-trigger-digest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: "Today's notable price momentum",
          }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(body.error || `Digest failed (${response.status})`)
        }
        const message =
          body.message ||
          `Today’s digest sent to ${body.sent_ok ?? body.recipient_count ?? 0} user(s)` +
            (body.sent_failed ? ` · ${body.sent_failed} failed` : '')
        setFetchAllDigestMsg(message)
        appendLocalLog('ALL', body.sent_failed ? 'warn' : 'success', message, body)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Digest failed'
        setFetchAllDigestMsg(message)
        appendLocalLog('ALL', 'error', message)
      } finally {
        setFetchAllAlertAllBusy(false)
      }
      return
    }

    const allHits = fetchAllRows.flatMap((row) => row.hits)
    if (!allHits.length) return
    setFetchAllAlertAllBusy(true)
    try {
      for (const hit of allHits) {
        await handleFetchAllQuickAlert(hit)
      }
    } finally {
      setFetchAllAlertAllBusy(false)
    }
  }

  function openLogoReplaceDialog(ticker: string, companyName?: string | null) {
    const symbol = String(ticker || '').toUpperCase()
    setLogoReplaceTicker(symbol)
    setLogoReplaceCompany(companyName || null)
    setLogoReplaceOpen(true)
    // Immediately open Google Images so user can copy a logo, then paste in the popup.
    if (symbol) {
      const href = googleImagesSearchUrl(symbol, companyName)
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }

  function applyCustomLogo(ticker: string, dataUrl: string) {
    const key = String(ticker || '').toUpperCase()
    if (!key || !dataUrl) return
    setCustomLogos((prev) => {
      const next = { ...prev, [key]: dataUrl }
      saveCustomLogoMap(next)
      return next
    })
    toast({
      title: 'Logo replaced',
      description: `${key} logo updated. List + share cards will use it.`,
      durationMs: 3500,
    })
    setLogoReplaceOpen(false)
  }

  function clearCustomLogo(ticker: string) {
    const key = String(ticker || '').toUpperCase()
    setCustomLogos((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      saveCustomLogoMap(next)
      return next
    })
    toast({
      title: 'Custom logo cleared',
      description: `${key} will use the auto-fetched logo again.`,
      durationMs: 3000,
    })
  }

  async function handleLogoPaste(
    e: ReactClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (!logoReplaceTicker) return
    const items = e.clipboardData?.items
    if (!items?.length) return

    let imageBlob: Blob | null = null
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        imageBlob = item.getAsFile()
        break
      }
    }

    // Also accept a pasted image URL as text
    const text = e.clipboardData?.getData('text')?.trim() || ''
    if (!imageBlob && /^https?:\/\//i.test(text)) {
      e.preventDefault()
      setLogoPasteBusy(true)
      try {
        // Prefer same-origin proxy when possible; else try direct fetch (may fail CORS)
        const res = await fetch(text).catch(() => null)
        if (res?.ok) {
          const blob = await res.blob()
          if (blob.type.startsWith('image/')) {
            const dataUrl = await blobToLogoDataUrl(blob)
            applyCustomLogo(logoReplaceTicker, dataUrl)
            return
          }
        }
        // Fallback: load via Image + canvas (works for some CORS-friendly hosts)
        const img = await loadImageFromUrl(text)
        if (img) {
          const c = document.createElement('canvas')
          const maxPx = 160
          const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
          c.width = Math.max(1, Math.round(img.naturalWidth * scale))
          c.height = Math.max(1, Math.round(img.naturalHeight * scale))
          const cx = c.getContext('2d')
          if (cx) {
            cx.drawImage(img, 0, 0, c.width, c.height)
            applyCustomLogo(logoReplaceTicker, c.toDataURL('image/png'))
            return
          }
        }
        toast({
          title: 'Could not load image URL',
          description: 'Copy the image itself (not the link) and paste here.',
          durationMs: 4000,
        })
      } finally {
        setLogoPasteBusy(false)
      }
      return
    }

    if (!imageBlob) return
    e.preventDefault()
    setLogoPasteBusy(true)
    try {
      const dataUrl = await blobToLogoDataUrl(imageBlob)
      applyCustomLogo(logoReplaceTicker, dataUrl)
    } catch {
      toast({
        title: 'Paste failed',
        description: 'Could not read the pasted image. Try another copy.',
        durationMs: 4000,
      })
    } finally {
      setLogoPasteBusy(false)
    }
  }

  /** Debounced re-render when preview sliders / text edits change. */
  useEffect(() => {
    if (!tweetComposerOpen || !tweetRenderCtx) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        setShareImageRerendering(true)
        try {
          const exchangeTz = tickerExchangeTimeZone(
            tweetRenderCtx.ticker,
            liveQuotes[String(tweetRenderCtx.ticker || '').toUpperCase()] || null,
          )
          const image = await renderMomentumTweetImage(
            tweetRenderCtx.ticker,
            tweetRenderCtx.event,
            tweetRenderCtx.companyName,
            shareCardStyle,
            tweetRenderCtx.cardText,
            shareSideImageDataUrl,
            exchangeTz,
          )
          if (cancelled) {
            if (image?.objectUrl) {
              try {
                URL.revokeObjectURL(image.objectUrl)
              } catch {
                /* ignore */
              }
            }
            return
          }
          if (!image) {
            console.warn('[share] tweet preview render returned null')
            return
          }
          setTweetImageUrl((prev) => {
            if (prev) {
              try {
                URL.revokeObjectURL(prev)
              } catch {
                /* ignore */
              }
            }
            return image.objectUrl
          })
          setTweetImageBlob(image.blob)
        } catch (err) {
          console.warn('[share] tweet preview re-render failed', err)
        } finally {
          if (!cancelled) setShareImageRerendering(false)
        }
      })()
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // Intentionally depend on style + open + ctx (incl. cardText) + side photo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareCardStyle, tweetComposerOpen, tweetRenderCtx, shareSideImageDataUrl])

  /** Same layout sliders / text edits live-update the Share-on-social-media image. */
  useEffect(() => {
    if (!socialShareOpen || !socialShareCtx) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        setShareImageRerendering(true)
        try {
          const exchangeTz = tickerExchangeTimeZone(
            socialShareCtx.ticker,
            liveQuotes[String(socialShareCtx.ticker || '').toUpperCase()] || null,
          )
          const image = await renderMomentumTweetImage(
            socialShareCtx.ticker,
            socialShareCtx.event,
            socialShareCtx.companyName,
            shareCardStyle,
            socialShareCtx.cardText,
            shareSideImageDataUrl,
            exchangeTz,
          )
          if (cancelled) {
            if (image?.objectUrl) {
              try {
                URL.revokeObjectURL(image.objectUrl)
              } catch {
                /* ignore */
              }
            }
            return
          }
          if (!image) {
            console.warn('[share] renderMomentumTweetImage returned null')
            return
          }
          setSocialShareCtx((prev) => {
            if (!prev) return prev
            if (prev.imageUrl) {
              try {
                URL.revokeObjectURL(prev.imageUrl)
              } catch {
                /* ignore */
              }
            }
            return {
              ...prev,
              imageBlob: image.blob,
              imageUrl: image.objectUrl,
              imageWidth: image.width,
              imageHeight: image.height,
            }
          })
        } catch (err) {
          console.warn('[share] preview re-render failed', err)
        } finally {
          if (!cancelled) setShareImageRerendering(false)
        }
      })()
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shareCardStyle,
    socialShareOpen,
    socialShareCtx?.ticker,
    socialShareCtx?.event?.event_date,
    socialShareCtx?.cardText,
    shareSideImageDataUrl,
  ])

  // Full-screen share preview: Esc closes lightbox (keeps share editor open)
  useEffect(() => {
    if (!socialSharePreviewFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setSocialSharePreviewFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [socialSharePreviewFullscreen])

  async function copyTweetText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast({
        title: `${label} copied`,
        description: 'Paste into X after tapping + on the thread.',
        durationMs: 3500,
      })
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Select the text manually and copy.',
        durationMs: 4000,
      })
    }
  }

  async function handleTweetComposerStart() {
    if (!tweetThread) return
    setTweetStartBusy(true)
    let imageCopied = false
    try {
      // Always try to put the latest share image on the clipboard before opening X.
      // Some browsers want a Promise-wrapped blob for ClipboardItem.
      let blobToCopy = tweetImageBlob
      if (!blobToCopy && tweetRenderCtx) {
        try {
          const fresh = await renderMomentumTweetImage(
            tweetRenderCtx.ticker,
            tweetRenderCtx.event,
            tweetRenderCtx.companyName,
            shareCardStyle,
            tweetRenderCtx.cardText,
            shareSideImageDataUrl,
          )
          blobToCopy = fresh?.blob || null
          if (fresh?.objectUrl) {
            setTweetImageUrl((prev) => {
              if (prev) {
                try {
                  URL.revokeObjectURL(prev)
                } catch {
                  /* ignore */
                }
              }
              return fresh.objectUrl
            })
            setTweetImageBlob(fresh.blob)
          }
        } catch {
          /* ignore rebuild failure */
        }
      }

      if (blobToCopy && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try {
          const pngBlob =
            blobToCopy.type === 'image/png'
              ? blobToCopy
              : new Blob([await blobToCopy.arrayBuffer()], { type: 'image/png' })
          await navigator.clipboard.write([
            new ClipboardItem({
              'image/png': Promise.resolve(pngBlob),
            }),
          ])
          imageCopied = true
        } catch {
          // Fallback: non-promise ClipboardItem
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blobToCopy }),
            ])
            imageCopied = true
          } catch {
            imageCopied = false
          }
        }
      }

      // New browser tab with tweet 1 prefilled (X cannot auto-fill multi-post threads).
      const url = `https://x.com/intent/tweet?text=${encodeURIComponent(tweetThread.tweet1)}`
      window.open(url, '_blank', 'noopener,noreferrer')
      toast({
        title: imageCopied
          ? 'Image copied · Tweet 1 opened'
          : 'Tweet 1 opened (image not copied)',
        description: imageCopied
          ? 'Paste the image on X with ⌘/Ctrl+V, then tap + and paste tweet 2 from this popup.'
          : 'Use Copy image in the popup, then paste on X. Allow clipboard permission if the browser blocked it.',
        durationMs: 8000,
      })
    } finally {
      setTweetStartBusy(false)
    }
  }

  async function openUsagePopup(kind: 'gemini' | 'firecrawl' | 'perplexity') {
    setUsagePopup(kind)
    setUsageLoading(true)
    setUsageError('')
    try {
      if (kind === 'gemini') {
        const response = await fetch('/api/notifications/usage/gemini?days=30')
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || `Failed (${response.status})`)
        setGeminiDailyUsage(Array.isArray(body.daily) ? body.daily : [])
        setGeminiUsageTotals({
          total_cost_usd_display: body.total_cost_usd_display,
          total_tokens: body.total_tokens,
        })
      } else if (kind === 'perplexity') {
        const response = await fetch('/api/notifications/usage/perplexity?days=90')
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || `Failed (${response.status})`)
        setPerplexityDailyUsage(Array.isArray(body.daily) ? body.daily : [])
        setPerplexityUsageTotals({
          total_cost_usd_display: body.total_cost_usd_display,
          total_credits: body.total_credits,
          total_tokens: body.total_tokens,
          total_calls: body.total_calls,
          balance_note: body.balance?.note,
          console_url: body.balance?.console_url,
        })
        setPerplexityTotals({
          total_cost_usd: Number(body.total_cost_usd) || 0,
          total_cost_usd_display: body.total_cost_usd_display,
          total_credits: Number(body.total_credits) || 0,
          total_tokens: Number(body.total_tokens) || 0,
          total_calls: Number(body.total_calls) || 0,
        })
      } else {
        const response = await fetch('/api/notifications/usage/firecrawl?days=30')
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || `Failed (${response.status})`)
        setFirecrawlDailyUsage(Array.isArray(body.daily) ? body.daily : [])
        setFirecrawlUsageTotals({
          total_credits: body.total_credits,
          balance: body.balance || null,
          note: body.note,
        })
      }
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : 'Failed to load usage')
    } finally {
      setUsageLoading(false)
    }
  }

  async function handleRetryFetchError() {
    if (!fetchErrorPopup) return
    const ticker = fetchErrorPopup.ticker
    setSection('tickers')
    setActiveTicker(ticker)
    const result = await handleRefresh(ticker)
    if (result) setFetchErrorPopup(null)
  }

  function resolveSelectedDevices(keys: string[]) {
    const keySet = new Set(keys)
    return devices.filter((d) => keySet.has(deviceKey(d)))
  }

  function toggleDeviceKey(
    key: string,
    current: string[],
    setKeys: (next: string[]) => void,
  ) {
    if (current.includes(key)) {
      setKeys(current.filter((k) => k !== key))
    } else {
      setKeys([...current, key])
    }
  }

  function selectAllDevices(setKeys: (next: string[]) => void) {
    setKeys(devices.map(deviceKey))
  }

  function clearDeviceSelection(setKeys: (next: string[]) => void) {
    setKeys([])
  }

  function geminiEventKey(
    ticker: string,
    event: Pick<PriceMovementEvent, 'event_date' | 'time_label'>,
    field: 'summary' | 'premarket' = 'summary',
  ) {
    return `${ticker}|${event.event_date}|${event.time_label || ''}|${field}`
  }

  function reasonDraftKey(
    ticker: string,
    event: Pick<PriceMovementEvent, 'event_date' | 'time_label'>,
  ) {
    return `${ticker}|${event.event_date}|${event.time_label || ''}`
  }

  function hasGeminiFormating(event: PriceMovementEvent | null | undefined) {
    if (!event) return false
    if (event.gemini_formating || event.gemini_classified_at) return true
    // Fallback: structured Gemini body already in summary (legacy rows / flag lag)
    const summary = String(event.summary || '')
    return /likely\s*driver\s*:/i.test(summary)
  }

  function reasonTextForGemini(event: PriceMovementEvent) {
    const summary = String(event.summary || '').trim()
    const premarket = getPremarketReason(event)
    if (summary && premarket && premarket !== summary) {
      return `${summary}\n\nPre-market: ${premarket}`
    }
    return summary || premarket
  }

  function applyGeminiSummaryToEvent(
    ticker: string,
    eventDate: string,
    timeLabel: string | null | undefined,
    summary: string,
    originalSummary?: string | null,
    options?: {
      markGemini?: boolean
      model?: string | null
      sources?: MovementSource[] | null
      usage?: {
        prompt_tokens?: number
        output_tokens?: number
        thoughts_tokens?: number
        total_tokens?: number
        credits_used?: number
        cost_usd?: number
        cost_usd_display?: string
      } | null
    },
  ) {
    const markGemini = options?.markGemini !== false
    const modelName = options?.model ? String(options.model).trim() : ''
    const usage = options?.usage || null
    const nextSources = options?.sources
    const addPrompt = Number(usage?.prompt_tokens) || 0
    const addOutput = Number(usage?.output_tokens) || 0
    const addThoughts = Number(usage?.thoughts_tokens) || 0
    const addTotal = Number(usage?.total_tokens) || addPrompt + addOutput + addThoughts
    const addCredits = Number(usage?.credits_used) || addTotal
    const addCost = Number(usage?.cost_usd) || 0
    const addDisplay = usage?.cost_usd_display || formatUsdCompact(addCost)
    const hasUsage = Boolean(usage && (addTotal > 0 || addCost > 0 || addPrompt > 0))
    const matches = (event: PriceMovementEvent) =>
      event.event_date === eventDate && (event.time_label || '') === (timeLabel || '')

    const patchEvent = (event: PriceMovementEvent): PriceMovementEvent => {
      if (!matches(event)) return event
      const nextCost = hasUsage
        ? Math.round(((Number(event.gemini_cost_usd) || 0) + addCost) * 1e8) / 1e8
        : Number(event.gemini_cost_usd) || 0
      return {
        ...event,
        original_summary:
          event.original_summary || originalSummary || event.summary || null,
        summary,
        reasons: summary
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean),
        ...(nextSources
          ? { sources: nextSources, source_count: nextSources.length }
          : {}),
        gemini_classified_at: markGemini
          ? new Date().toISOString()
          : event.gemini_classified_at || null,
        gemini_formating: markGemini ? true : Boolean(event.gemini_formating),
        gemini_model: modelName ? modelName : event.gemini_model || null,
        gemini_prompt_tokens: hasUsage
          ? (Number(event.gemini_prompt_tokens) || 0) + addPrompt
          : Number(event.gemini_prompt_tokens) || 0,
        gemini_output_tokens: hasUsage
          ? (Number(event.gemini_output_tokens) || 0) + addOutput
          : Number(event.gemini_output_tokens) || 0,
        gemini_thoughts_tokens: hasUsage
          ? (Number(event.gemini_thoughts_tokens) || 0) + addThoughts
          : Number(event.gemini_thoughts_tokens) || 0,
        gemini_total_tokens: hasUsage
          ? (Number(event.gemini_total_tokens) || 0) + addTotal
          : Number(event.gemini_total_tokens) || 0,
        gemini_credits_used: hasUsage
          ? (Number(event.gemini_credits_used) || 0) + addCredits
          : Number(event.gemini_credits_used) || 0,
        gemini_cost_usd: nextCost,
        gemini_cost_usd_display: formatUsdCompact(nextCost),
        gemini_last_prompt_tokens: hasUsage
          ? addPrompt
          : Number(event.gemini_last_prompt_tokens) || 0,
        gemini_last_output_tokens: hasUsage
          ? addOutput
          : Number(event.gemini_last_output_tokens) || 0,
        gemini_last_total_tokens: hasUsage
          ? addTotal
          : Number(event.gemini_last_total_tokens) || 0,
        gemini_last_credits_used: hasUsage
          ? addCredits
          : Number(event.gemini_last_credits_used) || 0,
        gemini_last_cost_usd: hasUsage
          ? addCost
          : Number(event.gemini_last_cost_usd) || 0,
        gemini_last_cost_usd_display: hasUsage
          ? addDisplay
          : event.gemini_last_cost_usd_display || null,
        gemini_usage_updated_at: hasUsage
          ? new Date().toISOString()
          : event.gemini_usage_updated_at || null,
        save_status: 'saved',
      }
    }

    setTabState((current) => {
      const prev = current[ticker]
      if (!prev?.result?.events?.length) return current
      return {
        ...current,
        [ticker]: {
          ...prev,
          result: {
            ...prev.result,
            events: prev.result.events.map(patchEvent),
          },
        },
      }
    })

    setTickers((current) => {
      const next = current.map((item) => {
        if (item.ticker !== ticker || !item.saved_events?.length) return item
        const saved_events = item.saved_events.map(patchEvent)
        const gemini_usage = sumEventsGeminiUsage(saved_events)
        return {
          ...item,
          saved_events,
          gemini_usage,
          gemini_total_tokens: gemini_usage.total_tokens,
          gemini_credits_used: gemini_usage.credits_used,
          gemini_cost_usd: gemini_usage.cost_usd,
          gemini_cost_usd_display: gemini_usage.cost_usd_display,
        }
      })
      setGeminiTotals(
        sumEventsGeminiUsage(next.flatMap((item) => item.saved_events || [])),
      )
      return next
    })
  }

  function closeGeminiEdit() {
    if (geminiEditSaving) return
    setGeminiEditOpen(false)
    setGeminiEditDraft('')
    setGeminiEditOriginal('')
    setGeminiEditModel(null)
    setGeminiEditUsage(null)
    setGeminiEditTarget(null)
    setGeminiEditError('')
  }

  function formatGeminiUsageForLog(body: {
    model?: string | null
    model_version?: string | null
    usage?: Record<string, unknown> | null
    tokens?: {
      prompt?: number
      output?: number
      thoughts?: number
      total?: number
    } | null
    credits_used?: number
    cost_usd?: number
    cost_usd_display?: string
  }) {
    const usage = (body.usage || {}) as {
      prompt_tokens?: number
      candidates_tokens?: number
      thoughts_tokens?: number
      output_tokens?: number
      total_tokens?: number
      credits_used?: number
      cost_usd_total?: number
      cost_usd_display?: string
      cost_usd?: { input?: number; output?: number; total?: number }
      price_per_1m?: { input_usd?: number; output_usd?: number; source?: string }
      billing_tier?: string
      service_tier?: string
      note?: string
    }
    const prompt =
      body.tokens?.prompt ?? usage.prompt_tokens ?? 0
    const output =
      body.tokens?.output ?? usage.output_tokens ?? usage.candidates_tokens ?? 0
    const thoughts = body.tokens?.thoughts ?? usage.thoughts_tokens ?? 0
    const total = body.tokens?.total ?? usage.total_tokens ?? prompt + output
    const credits = body.credits_used ?? usage.credits_used ?? total
    const costDisplay =
      body.cost_usd_display ||
      usage.cost_usd_display ||
      (typeof body.cost_usd === 'number' ? `$${body.cost_usd.toFixed(6)}` : '$0.000000')

    return {
      model: body.model_version || body.model || null,
      prompt_tokens: prompt,
      output_tokens: output,
      thoughts_tokens: thoughts,
      total_tokens: total,
      credits_used: credits,
      cost_usd: body.cost_usd ?? usage.cost_usd_total ?? usage.cost_usd?.total ?? 0,
      cost_usd_display: costDisplay,
      cost_input_usd: usage.cost_usd?.input ?? null,
      cost_output_usd: usage.cost_usd?.output ?? null,
      price_per_1m: usage.price_per_1m || null,
      billing_tier: usage.billing_tier || null,
      service_tier: usage.service_tier || null,
      note: usage.note || null,
      message: `Gemini usage · ${total} tokens (in ${prompt} / out ${output}${
        thoughts ? ` / think ${thoughts}` : ''
      }) · ${credits} credits · ${costDisplay}`,
    }
  }

  function rememberGeminiUsage(
    eventKey: string,
    body: {
      model?: string | null
      model_version?: string | null
      models_tried?: string[]
      usage?: Record<string, unknown> | null
      tokens?: {
        prompt?: number
        output?: number
        thoughts?: number
        total?: number
      } | null
      credits_used?: number
      cost_usd?: number
      cost_usd_display?: string
      validation?: { has_likely_driver?: boolean; retries?: number }
    },
  ) {
    const usageLog = formatGeminiUsageForLog(body)
    const retriesRaw = body.validation?.retries
    const retries = typeof retriesRaw === 'number' ? retriesRaw : 0
    const tried = Array.isArray(body.models_tried) ? body.models_tried.filter(Boolean) : []
    const cascadeNote =
      tried.length > 1 ? ` · cascade ${tried.join(' → ')}` : ''
    const payload = {
      prompt_tokens: usageLog.prompt_tokens,
      output_tokens: usageLog.output_tokens,
      thoughts_tokens: usageLog.thoughts_tokens,
      total_tokens: usageLog.total_tokens,
      credits_used: usageLog.credits_used,
      cost_usd_display: usageLog.cost_usd_display,
      message: `${usageLog.message}${cascadeNote}`,
      model: usageLog.model || body.model || null,
      retries,
      models_tried: tried,
    }
    setGeminiUsageByKey((prev) => ({ ...prev, [eventKey]: payload }))
    setLastGeminiUsage(payload)
    setGeminiEditUsage({
      prompt_tokens: payload.prompt_tokens,
      output_tokens: payload.output_tokens,
      thoughts_tokens: payload.thoughts_tokens,
      total_tokens: payload.total_tokens,
      credits_used: payload.credits_used,
      cost_usd: usageLog.cost_usd,
      cost_usd_display: payload.cost_usd_display,
      message: payload.message,
    })
    return payload
  }

  function renderGeminiUsageStrip(eventKey: string) {
    const usage = geminiUsageByKey[eventKey]
    if (!usage) return null
    return (
      <div className="rounded-lg border border-violet-500/25 bg-violet-500/5 px-2.5 py-2 text-[11px] text-violet-950 dark:text-violet-100">
        <span className="font-medium">Gemini usage</span>
        {' · '}
        <span className="tabular-nums">
          {usage.total_tokens} tokens (in {usage.prompt_tokens} / out {usage.output_tokens}
          {usage.thoughts_tokens ? ` / think ${usage.thoughts_tokens}` : ''})
        </span>
        {' · '}
        <span className="tabular-nums">{usage.credits_used} credits</span>
        {' · '}
        <span className="tabular-nums">{usage.cost_usd_display}</span>
        {usage.model ? ` · used ${usage.model}` : ''}
        {usage.retries ? ` · structure-retry ${usage.retries}` : ''}
        {usage.models_tried && usage.models_tried.length > 1
          ? ` · tried ${usage.models_tried.join(' → ')}`
          : ''}
      </div>
    )
  }

  function toastGeminiModelSwitch(body: {
    model?: string | null
    model_switched?: boolean
    model_switch_from?: string | null
    model_switch_to?: string | null
    model_switch_reason?: string | null
    models_tried?: string[]
    model_errors?: Array<{
      model?: string
      error?: string
      quota?: boolean
      capacity?: boolean
    }>
  }) {
    const switched = Boolean(body.model_switched) || (body.models_tried?.length || 0) > 1
    if (!switched) return

    const from = body.model_switch_from || body.models_tried?.[0] || 'previous model'
    const to = body.model_switch_to || body.model || 'next model'
    const reason = body.model_switch_reason
    const reasonLabel =
      reason === 'high_demand'
        ? 'high demand on previous model'
        : reason === 'quota'
          ? 'quota / rate limit'
          : reason === 'unavailable'
            ? 'model unavailable'
            : 'failover'

    const failed = (body.model_errors || [])
      .filter((e) => e.quota || e.capacity || e.error)
      .slice(0, 4)
      .map((e) => e.model)
      .filter(Boolean)

    toast({
      title: `Gemini switched to ${to}`,
      description: [
        `${from} → ${to} (${reasonLabel})`,
        failed.length ? `Skipped: ${failed.join(', ')}` : null,
        body.models_tried && body.models_tried.length > 2
          ? `Path: ${body.models_tried.join(' → ')}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      durationMs: 7000,
    })
  }

  /**
   * Structure a scrape reason via Gemini (Likely/Secondary driver format).
   * Opens review dialog — does NOT send push. Save writes structured reason to Supabase.
   *
   * Important: bind to the *clicked card’s* date only. Snapshot event fields + use the
   * visible reason draft so we never structure the date below by accident (stale refs /
   * overlapping async responses).
   */
  async function handleGeminiSummarize(
    ticker: string,
    event: PriceMovementEvent,
    field: 'summary' | 'premarket' = 'summary',
  ) {
    // Snapshot at click time — do not read from live list later (reorder / re-fetch safe).
    const eventSnapshot: PriceMovementEvent = {
      ...event,
      event_date: String(event.event_date || '').slice(0, 10),
      time_label: event.time_label || null,
      summary: event.summary,
      original_summary: event.original_summary,
      price: event.price,
      price_change: event.price_change || event.momentum,
      momentum: event.momentum || event.price_change,
    }
    const eventDate = eventSnapshot.event_date
    const key = geminiEventKey(ticker, eventSnapshot, field)
    const draftKey = reasonDraftKey(ticker, eventSnapshot)
    const displayedReason = String(reasonDrafts[draftKey] ?? eventSnapshot.summary ?? '').trim()
    const alreadyGemini = hasGeminiFormating(eventSnapshot)

    // Prefer what the user sees on *this* card.
    // Re-run on already-Gemini cards: use original scrape if present, else visible text.
    let sourceText = ''
    if (field === 'premarket') {
      sourceText = getPremarketReason(eventSnapshot)
    } else if (alreadyGemini) {
      sourceText =
        String(eventSnapshot.original_summary || '').trim() ||
        displayedReason ||
        reasonTextForGemini(eventSnapshot) ||
        String(eventSnapshot.summary || '').trim()
    } else {
      sourceText =
        displayedReason ||
        String(eventSnapshot.original_summary || '').trim() ||
        reasonTextForGemini(eventSnapshot) ||
        String(eventSnapshot.summary || '').trim()
    }

    if (!sourceText) {
      setGeminiErrorByKey((prev) => ({
        ...prev,
        [key]: 'No reason/summary text to structure',
      }))
      return
    }

    const companyName =
      tickers.find((item) => item.ticker === ticker)?.company_name || ticker

    const requestId = ++geminiRequestSeqRef.current
    setGeminiBusyKey(key)
    setGeminiErrorByKey((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    // Never open push-alert UI from this path.
    setMovementAlertOpen(false)
    appendLocalLog(
      ticker,
      'info',
      `Gemini: structuring reason for ${eventDate}${eventSnapshot.time_label ? ` · ${eventSnapshot.time_label}` : ''}…`,
      { event_date: eventDate, source_preview: sourceText.slice(0, 160) },
    )

    try {
      // Generate only — review dialog, then user saves (not a push).
      const response = await fetch('/api/notifications/gemini-summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sourceText,
          ticker,
          company_name: companyName,
          event_date: eventDate,
          price: eventSnapshot.price,
          price_change: eventSnapshot.price_change || eventSnapshot.momentum,
          event: eventSnapshot,
          auto_save: false,
          monitor_scope: activeMonitorScope(ticker),
        }),
      })
      const body = await response.json().catch(() => ({}))
      // Drop stale responses (user clicked another date while this one was in flight).
      if (requestId !== geminiRequestSeqRef.current) {
        appendLocalLog(
          ticker,
          'info',
          `Gemini response ignored (stale) · was for ${eventDate}`,
        )
        return
      }
      // Always surface usage when API returned it (even on validation failure).
      if (body.usage || body.tokens || body.credits_used != null) {
        const usagePayload = rememberGeminiUsage(key, body)
        appendLocalLog(ticker, 'info', usagePayload.message, {
          ...usagePayload,
          usage: body.usage,
          tokens: body.tokens,
          max_output_tokens: body.max_output_tokens,
          validation: body.validation,
          event_date: eventDate,
        })
      }
      if (!response.ok) {
        const hint = body.hint ? ` ${body.hint}` : ''
        throw new Error((body.error || `Gemini failed (${response.status})`) + hint)
      }
      const summary = String(body.summary || '').trim()
      if (!summary) throw new Error('Gemini returned an empty structured reason')

      if (body.validation && body.validation.has_likely_driver === false) {
        throw new Error(
          body.error ||
            'Structured reason missing "Likely driver:" after retry',
        )
      }

      // Preview in review dialog + card draft (save on confirm) — always the clicked date.
      setGeminiEditTarget({ ticker, event: eventSnapshot })
      setGeminiEditOriginal(sourceText)
      setGeminiEditDraft(summary)
      setGeminiEditModel(
        body.model_version
          ? String(body.model_version)
          : body.model
            ? String(body.model)
            : null,
      )
      setGeminiEditError('')
      setGeminiEditOpen(true)
      setReasonDrafts((prev) => ({
        ...prev,
        [draftKey]: summary,
      }))

      const usagePayload = rememberGeminiUsage(key, body)
      toastGeminiModelSwitch(body)
      appendLocalLog(
        ticker,
        'success',
        `Gemini structured reason · ${eventDate} — review & save (not a push)`,
        {
          event_date: eventDate,
          model: body.model,
          model_version: body.model_version,
          models_tried: body.models_tried,
          model_switched: body.model_switched,
          summary,
          validation: body.validation,
          max_output_tokens: body.max_output_tokens,
        },
      )
      appendLocalLog(ticker, 'info', usagePayload.message, usagePayload)
    } catch (error) {
      if (requestId !== geminiRequestSeqRef.current) return
      const message = error instanceof Error ? error.message : 'Gemini structure failed'
      setGeminiErrorByKey((prev) => ({ ...prev, [key]: message }))
      appendLocalLog(ticker, 'error', `${message} · ${eventDate}`)
    } finally {
      // Clear busy for this key even if a newer request is running (that one has its own key).
      setGeminiBusyKey((current) => (current === key ? null : current))
    }
  }

  async function handleGeminiEditSave() {
    if (!geminiEditTarget) return
    const { ticker, event } = geminiEditTarget
    const summary = geminiEditDraft.trim()
    if (!summary) {
      setGeminiEditError('Reason text cannot be empty')
      return
    }

    const companyName =
      tickers.find((item) => item.ticker === ticker)?.company_name || ticker
    const originalSource =
      geminiEditOriginal ||
      String(event.original_summary || '').trim() ||
      String(event.summary || '').trim()

    setGeminiEditSaving(true)
    setGeminiEditError('')
    appendLocalLog(ticker, 'info', `Saving edited structured reason for ${event.event_date}…`)

    try {
      const usageOverride = geminiEditUsage
        ? {
            prompt_tokens: geminiEditUsage.prompt_tokens,
            output_tokens: geminiEditUsage.output_tokens,
            thoughts_tokens: geminiEditUsage.thoughts_tokens,
            total_tokens: geminiEditUsage.total_tokens,
            credits_used: geminiEditUsage.credits_used,
            cost_usd_total: geminiEditUsage.cost_usd,
            cost_usd: geminiEditUsage.cost_usd,
            cost_usd_display: geminiEditUsage.cost_usd_display,
            model: geminiEditModel,
          }
        : null

      // Save without re-running Gemini — pass the edited text as summary.
      const response = await fetch('/api/notifications/gemini-summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: originalSource || summary,
          summary_override: summary,
          skip_generate: true,
          ticker,
          company_name: companyName,
          event_date: event.event_date,
          price: event.price,
          price_change: event.price_change || event.momentum,
          event: {
            ...event,
            original_summary: event.original_summary || originalSource || null,
            summary,
            gemini_formating: true,
            gemini_model:
              geminiEditModel || event.gemini_model || null,
          },
          usage_override: usageOverride,
          auto_save: true,
          monitor_scope: activeMonitorScope(ticker),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Save failed (${response.status})`)
      }

      const savedSummary = String(body.summary || summary).trim()
      const autoSave = body.auto_save as
        | { ok?: boolean; saved?: boolean; message?: string; error?: string }
        | null
        | undefined

      if (autoSave?.saved) {
        // Prefer the generate-call usage from the review dialog (skip_generate returns $0).
        const usageForLocal = usageOverride
          ? {
              prompt_tokens: usageOverride.prompt_tokens,
              output_tokens: usageOverride.output_tokens,
              thoughts_tokens: usageOverride.thoughts_tokens,
              total_tokens: usageOverride.total_tokens,
              credits_used: usageOverride.credits_used,
              cost_usd: usageOverride.cost_usd,
              cost_usd_display: usageOverride.cost_usd_display,
            }
          : null
        applyGeminiSummaryToEvent(
          ticker,
          event.event_date,
          event.time_label,
          savedSummary,
          originalSource,
          {
            markGemini: true,
            model:
              geminiEditModel ||
              (body.model_version ? String(body.model_version) : null) ||
              (body.model ? String(body.model) : null) ||
              event.gemini_model ||
              null,
            usage: usageForLocal,
          },
        )
        setReasonDrafts((prev) => ({
          ...prev,
          [reasonDraftKey(ticker, event)]: savedSummary,
        }))
        patchTab(ticker, {
          saveMessage:
            autoSave.message ||
            `Saved structured reason for dates[${event.event_date}]`,
          saveIsNoop: false,
        })
        appendLocalLog(
          ticker,
          'success',
          autoSave.message ||
            `Structured reason saved to Supabase for ${event.event_date}`,
          {
            summary: savedSummary,
            gemini_formating: true,
          },
        )
        reloadAfterWrite(ticker)
        setGeminiEditOpen(false)
        setGeminiEditDraft('')
        setGeminiEditOriginal('')
        setGeminiEditModel(null)
        setGeminiEditUsage(null)
        setGeminiEditTarget(null)
      } else {
        throw new Error(
          autoSave?.error || body.error || 'Save did not write to Supabase',
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed'
      setGeminiEditError(message)
      appendLocalLog(ticker, 'error', message)
    } finally {
      setGeminiEditSaving(false)
    }
  }

  /**
   * After Perplexity/Firecrawl scrape: run Gemini on every pending (unsaved) event.
   * If all classifications succeed, save all to Supabase automatically.
   */
  async function openGeminiAutoSavePrompt() {
    if (!activeTicker) return
    setGeminiPromptOpen(true)
    setGeminiPromptError('')
    setGeminiPromptLoading(true)
    try {
      const response = await fetch('/api/notifications/gemini-prompt')
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Failed to load prompt (${response.status})`)
      }
      setGeminiPromptText(String(body.prompt_template || '').trim())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load Gemini prompt'
      setGeminiPromptError(message)
      appendLocalLog(activeTicker, 'error', message)
    } finally {
      setGeminiPromptLoading(false)
    }
  }

  /**
   * Gemini + auto-save for the active ticker:
   * runs only on Supabase dates that do not yet have gemini_formating.
   */
  async function handleGeminiAutoSaveConfirm() {
    const ticker = activeTicker
    if (!ticker) return
    const promptTemplate = geminiPromptText.trim()
    if (!promptTemplate) {
      setGeminiPromptError('Prompt cannot be empty')
      return
    }

    const companyName =
      tickers.find((item) => item.ticker === ticker)?.company_name || ticker
    const meta = tickers.find((item) => item.ticker === ticker)
    const fromDb = meta?.saved_events || []
    const fromScrape = (tabState[ticker] || emptyTabState()).result?.events || []
    // Prefer DB events; merge scrape-only dates too.
    const byDate = new Map<string, PriceMovementEvent>()
    for (const event of fromDb) {
      byDate.set(`${event.event_date}|${event.time_label || ''}`, event)
    }
    for (const event of fromScrape) {
      const key = `${event.event_date}|${event.time_label || ''}`
      if (!byDate.has(key)) byDate.set(key, event)
    }

    const candidates = [...byDate.values()].filter((event) => {
      if (hasGeminiFormating(event)) return false
      const source =
        String(event.original_summary || '').trim() ||
        reasonTextForGemini(event) ||
        String(event.summary || '').trim()
      return Boolean(source)
    })

    if (!candidates.length) {
      const message = 'No dates without gemini_formating tag (or no reason text) for this ticker'
      setGeminiPromptError(message)
      appendLocalLog(ticker, 'info', message)
      return
    }

    setGeminiPromptRunning(true)
    setGeminiPromptError('')
    setGeminiBulkBusy(true)
    setGeminiBulkProgress({ done: 0, total: candidates.length })
    appendLocalLog(
      ticker,
      'info',
      `Gemini + auto-save: ${candidates.length} date(s) without gemini_formating…`,
    )

    let okCount = 0
    let failCount = 0
    let totalCredits = 0
    let totalCost = 0

    try {
      for (let i = 0; i < candidates.length; i += 1) {
        const event = candidates[i]
        setGeminiBulkProgress({ done: i, total: candidates.length })
        const sourceText =
          String(event.original_summary || '').trim() ||
          reasonTextForGemini(event) ||
          String(event.summary || '').trim()

        try {
          const response = await fetch('/api/notifications/gemini-summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: sourceText,
              ticker,
              company_name: companyName,
              event_date: event.event_date,
              price: event.price,
              price_change: event.price_change || event.momentum,
              event,
              prompt_template: promptTemplate,
              auto_save: true,
          monitor_scope: activeMonitorScope(ticker),
            }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) {
            throw new Error(body.error || `Gemini failed (${response.status})`)
          }
          const summary = String(body.summary || '').trim()
          if (!summary) throw new Error('Empty Gemini notification')
          if (!body.auto_save?.saved) {
            throw new Error(body.auto_save?.error || 'Gemini ran but save failed')
          }

          const usageLog = formatGeminiUsageForLog(body)
          applyGeminiSummaryToEvent(
            ticker,
            event.event_date,
            event.time_label,
            summary,
            sourceText,
            {
              markGemini: true,
              model:
                (body.model_version ? String(body.model_version) : null) ||
                (body.model ? String(body.model) : null) ||
                null,
              usage: {
                prompt_tokens: usageLog.prompt_tokens,
                output_tokens: usageLog.output_tokens,
                thoughts_tokens: usageLog.thoughts_tokens,
                total_tokens: usageLog.total_tokens,
                credits_used: usageLog.credits_used,
                cost_usd: usageLog.cost_usd,
                cost_usd_display: usageLog.cost_usd_display,
              },
            },
          )
          // Ensure gemini_formating flag is reflected in local drafts map too.
          setReasonDrafts((prev) => {
            const key = reasonDraftKey(ticker, event)
            return { ...prev, [key]: summary }
          })

          rememberGeminiUsage(geminiEventKey(ticker, event, 'summary'), body)
          toastGeminiModelSwitch(body)
          totalCredits += usageLog.credits_used || 0
          totalCost += Number(usageLog.cost_usd) || 0
          okCount += 1
          appendLocalLog(ticker, 'success', `Gemini formatted & saved ${event.event_date}`, {
            gemini_formating: true,
            model: body.model,
            models_tried: body.models_tried,
            model_switched: body.model_switched,
            summary,
          })
          appendLocalLog(ticker, 'info', usageLog.message, usageLog)
        } catch (error) {
          failCount += 1
          const message = error instanceof Error ? error.message : 'Gemini failed'
          appendLocalLog(ticker, 'error', `${event.event_date}: ${message}`)
        }
        setGeminiBulkProgress({ done: i + 1, total: candidates.length })
      }

      const message =
        failCount === 0
          ? `Gemini + auto-save done: ${okCount} date(s) · ${totalCredits} credits · $${totalCost.toFixed(6)}`
          : `Gemini + auto-save finished with errors: ${okCount} saved, ${failCount} failed`

      patchTab(ticker, {
        saveMessage: message,
        saveIsNoop: failCount > 0 && okCount === 0,
        error: failCount ? `${failCount} date(s) failed Gemini` : '',
      })
      appendLocalLog(ticker, failCount ? 'warn' : 'success', message)
      reloadAfterWrite(ticker)
      if (failCount === 0) {
        setGeminiPromptOpen(false)
      }
    } finally {
      setGeminiPromptRunning(false)
      setGeminiBulkBusy(false)
      setGeminiBulkProgress({ done: 0, total: 0 })
    }
  }

  async function handleSaveReasonEdit(ticker: string, event: PriceMovementEvent) {
    const key = reasonDraftKey(ticker, event)
    // Prefer explicit user draft; otherwise show cleaned scrape reason (no move %).
    const draft = reasonDisplayText(event, reasonDrafts[key]).trim()
    const sourcesText =
      sourceDrafts[key] ?? serializeSourcesDraft(event.sources || [])
    const nextSources = parseSourcesDraft(sourcesText, event.sources || [])
    const prevSourcesText = serializeSourcesDraft(event.sources || [])
    const storedClean = stripRedundantMovePercentFromReason(
      String(event.summary || ''),
      event,
    ).trim()
    // Skip save when only residual move-% was display-stripped (nothing user changed).
    const reasonUnchanged =
      draft === String(event.summary || '').trim() || draft === storedClean
    const sourcesUnchanged = sourcesText.trim() === prevSourcesText.trim()
    if (!draft) {
      appendLocalLog(ticker, 'warn', `Empty reason not saved for ${event.event_date}`)
      return
    }
    if (reasonUnchanged && sourcesUnchanged) return

    const companyName =
      tickers.find((item) => item.ticker === ticker)?.company_name || ticker
    setReasonSavingKey(key)
    appendLocalLog(
      ticker,
      'info',
      `Saving edited reason${sourcesUnchanged ? '' : ' + sources'} for ${event.event_date}…`,
    )

    try {
      const response = await fetch('/api/notifications/gemini-summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: event.original_summary || event.summary || draft,
          summary_override: draft,
          skip_generate: true,
          ticker,
          company_name: companyName,
          event_date: event.event_date,
          price: event.price,
          price_change: event.price_change || event.momentum,
          event: {
            ...event,
            summary: draft,
            sources: nextSources,
            source_count: nextSources.length,
            gemini_formating: event.gemini_formating || Boolean(event.gemini_classified_at),
          },
          auto_save: true,
          monitor_scope: activeMonitorScope(ticker),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Save failed (${response.status})`)
      }
      if (!body.auto_save?.saved) {
        throw new Error(body.auto_save?.error || 'Reason not written to Supabase')
      }

      applyGeminiSummaryToEvent(
        ticker,
        event.event_date,
        event.time_label,
        draft,
        event.original_summary || event.summary,
        {
          markGemini: hasGeminiFormating(event),
          sources: nextSources,
        },
      )
      appendLocalLog(ticker, 'success', `Reason saved for ${event.event_date}`)
      reloadAfterWrite(ticker)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reason save failed'
      appendLocalLog(ticker, 'error', message)
    } finally {
      setReasonSavingKey(null)
    }
  }

  async function copyImageBlobToClipboard(blob: Blob | null): Promise<boolean> {
    if (!blob || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      return false
    }
    try {
      const pngBlob =
        blob.type === 'image/png'
          ? blob
          : new Blob([await blob.arrayBuffer()], { type: 'image/png' })
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': Promise.resolve(pngBlob) }),
      ])
      return true
    } catch {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        return true
      } catch {
        return false
      }
    }
  }

  async function openSocialShare(
    ticker: string,
    event: PriceMovementEvent,
    companyName?: string | null,
  ) {
    setSocialShareBusy(true)
    setSocialShareOpen(true)
    // Always reuse last saved layout settings
    const style = loadShareCardStyle()
    setShareCardStyle(style)
    try {
      // Prefer in-card draft reason if user edited but not blurred yet
      const key = reasonDraftKey(ticker, event)
      const draftSummary = (reasonDrafts[key] ?? event.summary ?? '').trim()
      const draftSources = parseSourcesDraft(
        sourceDrafts[key] ?? serializeSourcesDraft(event.sources || []),
        event.sources || [],
      )
      const eventForShare: PriceMovementEvent = {
        ...event,
        summary: draftSummary || event.summary,
        sources: draftSources.length ? draftSources : event.sources,
      }
      // Ensure company name for titleMode=company (Yahoo fallback if DB blank)
      const resolvedCompany = await resolveShareCompanyName(ticker, companyName)
      const thread = buildMomentumTweetThread(
        ticker,
        eventForShare,
        resolvedCompany,
      )
      const exchangeTz = tickerExchangeTimeZone(
        ticker,
        liveQuotes[String(ticker || '').toUpperCase()] || null,
      )
      const cardText = buildShareCardTextContent(
        ticker,
        eventForShare,
        resolvedCompany,
        style,
        exchangeTz,
      )
      const image = await renderMomentumTweetImage(
        ticker,
        eventForShare,
        resolvedCompany,
        style,
        cardText,
        shareSideImageDataUrl,
        exchangeTz,
      )
      setSocialShareCtx((prev) => {
        if (prev?.imageUrl) {
          try {
            URL.revokeObjectURL(prev.imageUrl)
          } catch {
            /* ignore */
          }
        }
        return {
          ticker,
          event: eventForShare,
          companyName: resolvedCompany,
          thread,
          imageBlob: image?.blob || null,
          imageUrl: image?.objectUrl || null,
          imageWidth: image?.width ?? null,
          imageHeight: image?.height ?? null,
          cardText,
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Share prep failed'
      toast({ title: 'Share failed', description: message, durationMs: 4000 })
      setSocialShareOpen(false)
    } finally {
      setSocialShareBusy(false)
    }
  }

  function downloadShareImage(
    blob: Blob | null,
    ticker?: string,
    dims?: { width?: number | null; height?: number | null },
  ) {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const dimPart =
      dims?.width && dims?.height ? `-${dims.width}x${dims.height}` : ''
    a.download = `trigger-${(ticker || 'share').toLowerCase()}-momentum${dimPart}.png`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }, 2500)
    const sizeLabel =
      dims?.width && dims?.height
        ? `${dims.width}×${dims.height} PNG`
        : 'Full-resolution PNG'
    toast({
      title: 'Image downloaded',
      description: `${sizeLabel} — open the file (not the in-app preview) for Full HD quality.`,
      durationMs: 4000,
    })
  }

  /**
   * Open a custom URL scheme (e.g. whatsapp://) without leaving this page permanently.
   * Hidden iframe first; falls back to location.assign if needed.
   */
  function openAppScheme(url: string) {
    try {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'display:none;width:0;height:0;border:0'
      iframe.setAttribute('aria-hidden', 'true')
      iframe.src = url
      document.body.appendChild(iframe)
      window.setTimeout(() => {
        try {
          document.body.removeChild(iframe)
        } catch {
          /* ignore */
        }
      }, 2500)
    } catch {
      /* ignore */
    }
    // Fallback: many desktop browsers only honor custom schemes via top-level navigation
    try {
      window.location.assign(url)
    } catch {
      /* ignore */
    }
  }

  async function handleSocialPlatform(platform: SocialPlatformId) {
    if (!socialShareCtx) return
    setSocialSharePlatformBusy(platform)
    const { thread, imageBlob, ticker } = socialShareCtx
    const text = thread.tweet1
    try {
      // Always put image on clipboard first (user gesture = this click).
      // Browsers cannot auto-inject media into WhatsApp / Instagram composers.
      const imageCopied = await copyImageBlobToClipboard(imageBlob)

      if (platform === 'whatsapp') {
        // Direct desktop/mobile app open with tweet 1 prefilled.
        // NO system share sheet. Image cannot be attached via URL — paste after open.
        const appUrl = `whatsapp://send?text=${encodeURIComponent(text)}`
        openAppScheme(appUrl)
        toast({
          title: imageCopied ? 'WhatsApp opened · image + text ready' : 'WhatsApp opened',
          description: imageCopied
            ? 'Tweet 1 is prefilled. Press ⌘/Ctrl+V once to paste the image into the chat (WhatsApp does not allow websites to auto-attach images).'
            : 'Tweet 1 should be prefilled. Use Copy on the preview, then paste in WhatsApp.',
          durationMs: 9000,
        })
        return
      }

      if (platform === 'x') {
        const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
        window.open(url, '_blank', 'noopener,noreferrer')
        toast({
          title: imageCopied ? 'X opened · image copied' : 'X opened',
          description: imageCopied
            ? 'Tweet 1 is prefilled. Paste the image with ⌘/Ctrl+V.'
            : 'Tweet 1 is prefilled. Copy the image from the preview if needed.',
          durationMs: 6500,
        })
        return
      }

      if (platform === 'stocktwits') {
        // Old /widgets/share?body=… endpoint is dead (404). Open symbol stream instead.
        // Do not writeText after image copy — that wipes the image from the clipboard.
        const symbol = String(ticker || '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9.^_=\-]/g, '')
        const symbolUrl = symbol
          ? `https://stocktwits.com/symbol/${encodeURIComponent(symbol)}`
          : 'https://stocktwits.com/'
        window.open(symbolUrl, '_blank', 'noopener,noreferrer')
        toast({
          title: imageCopied ? 'StockTwits opened · image copied' : 'StockTwits opened',
          description: imageCopied
            ? `On $${symbol || 'TICKER'}: paste image with ⌘/Ctrl+V, then paste caption (Copy Tweet 1 from this panel).`
            : 'Open the composer on the symbol page. Copy Tweet 1 + image from this panel.',
          durationMs: 8000,
        })
        return
      }

      if (platform === 'instagram') {
        // Instagram has no public web deep-link that opens Create post with a pre-attached image.
        // Mobile may open the app; desktop opens the site. Image is on clipboard for paste/upload.
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
        if (isMobile) {
          // Best-effort app open (create flow still requires user to pick media)
          openAppScheme('instagram://app')
          window.setTimeout(() => {
            window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer')
          }, 600)
        } else {
          window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer')
        }
        toast({
          title: imageCopied ? 'Instagram · image copied' : 'Instagram opened',
          description: imageCopied
            ? 'Instagram does not allow websites to open Create post with your image already attached. Image is copied — start a new post and paste/upload it. Caption: copy Tweet 1 from this popup.'
            : 'Open Create on Instagram, then use Copy image + Copy tweet 1 here.',
          durationMs: 10000,
        })
      }
    } finally {
      setSocialSharePlatformBusy(null)
    }
  }

  async function handleGeminiPendingAll(ticker: string) {
    const state = tabState[ticker] || emptyTabState()
    const allEvents = state.result?.events || []
    const pending = allEvents.filter(
      (event) => event.save_status === 'new' || event.save_status === 'changed',
    )

    type ClassifiedItem = {
      event: PriceMovementEvent
      original: string
      summary: string
      usage?: ReturnType<typeof formatGeminiUsageForLog>
    }

    const workItems = pending
      .map((event) => {
        const original =
          String(event.original_summary || '').trim() ||
          reasonTextForGemini(event) ||
          String(event.summary || '').trim()
        return { event, original }
      })
      .filter((item) => item.original.length > 0)

    if (!workItems.length) {
      const message = pending.length
        ? 'No reason/summary text on pending events to classify'
        : 'No pending unsaved events to classify'
      patchTab(ticker, { error: message })
      appendLocalLog(ticker, 'warn', message)
      return
    }

    const companyName =
      tickers.find((item) => item.ticker === ticker)?.company_name || ticker

    setGeminiBulkBusy(true)
    setGeminiBulkProgress({ done: 0, total: workItems.length })
    patchTab(ticker, { error: '', saveMessage: '', saveIsNoop: false })
    appendLocalLog(
      ticker,
      'info',
      `Gemini bulk: classifying ${workItems.length} pending event(s)…`,
    )

    const classified: ClassifiedItem[] = []
    const errors: Array<{ event_date: string; error: string }> = []
    let totalCredits = 0
    let totalCost = 0

    try {
      for (let i = 0; i < workItems.length; i += 1) {
        const { event, original } = workItems[i]
        setGeminiBulkProgress({ done: i, total: workItems.length })
        appendLocalLog(
          ticker,
          'info',
          `Gemini bulk ${i + 1}/${workItems.length}: ${event.event_date}…`,
        )

        try {
          const response = await fetch('/api/notifications/gemini-summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: original,
              ticker,
              company_name: companyName,
              event_date: event.event_date,
              price: event.price,
              price_change: event.price_change || event.momentum,
              event,
              auto_save: false,
          monitor_scope: activeMonitorScope(ticker),
            }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) {
            throw new Error(body.error || `Gemini failed (${response.status})`)
          }
          const summary = String(body.summary || '').trim()
          if (!summary) throw new Error('Gemini returned an empty notification')

          const usageLog = formatGeminiUsageForLog(body)
          rememberGeminiUsage(geminiEventKey(ticker, event, 'summary'), body)
          toastGeminiModelSwitch(body)
          totalCredits += usageLog.credits_used || 0
          totalCost += Number(usageLog.cost_usd) || 0
          classified.push({ event, original, summary, usage: usageLog })
          appendLocalLog(ticker, 'success', `Gemini bulk OK · ${event.event_date}`, {
            summary,
            model: body.model_version || body.model,
            models_tried: body.models_tried,
            model_switched: body.model_switched,
          })
          appendLocalLog(ticker, 'info', usageLog.message, usageLog)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Gemini failed'
          errors.push({ event_date: event.event_date, error: message })
          appendLocalLog(ticker, 'error', `Gemini bulk failed · ${event.event_date}: ${message}`)
        }

        setGeminiBulkProgress({ done: i + 1, total: workItems.length })
      }

      if (errors.length > 0) {
        // Apply successful classifications locally only — do not auto-save when any failed.
        for (const item of classified) {
          applyGeminiSummaryToEvent(
            ticker,
            item.event.event_date,
            item.event.time_label,
            item.summary,
            item.original,
          )
        }
        const message = `Gemini bulk stopped save: ${errors.length} error(s), ${classified.length} classified. Fix errors, then save manually.`
        patchTab(ticker, {
          error: message,
          saveMessage: classified.length
            ? `Classified ${classified.length}/${workItems.length} locally (not saved — errors present)`
            : '',
          saveIsNoop: true,
        })
        appendLocalLog(ticker, 'warn', message, {
          errors,
          classified_dates: classified.map((c) => c.event.event_date),
          total_credits: totalCredits,
          total_cost_usd: totalCost,
        })
        return
      }

      // All classifications succeeded → update local events and save to Supabase.
      const byDate = new Map(
        classified.map((item) => [
          `${item.event.event_date}|${item.event.time_label || ''}`,
          item,
        ]),
      )

      const eventsToSave = allEvents.map((event) => {
        const key = `${event.event_date}|${event.time_label || ''}`
        const hit = byDate.get(key)
        if (!hit) return event
        return {
          ...event,
          original_summary: event.original_summary || hit.original || event.summary || null,
          summary: hit.summary,
          reasons: hit.summary
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean),
          gemini_classified_at: new Date().toISOString(),
          // Force write path as new/changed content.
          save_status:
            event.save_status === 'new' || event.save_status === 'changed'
              ? event.save_status
              : ('changed' as const),
        }
      })

      // Reflect classified text in UI immediately.
      setTabState((current) => {
        const prev = current[ticker] || emptyTabState()
        if (!prev.result) return current
        return {
          ...current,
          [ticker]: {
            ...prev,
            result: {
              ...prev.result,
              events: eventsToSave,
            },
          },
        }
      })

      appendLocalLog(
        ticker,
        'info',
        `Gemini bulk: all ${classified.length} OK — saving to Supabase…`,
        {
          total_credits: totalCredits,
          total_cost_usd: Math.round(totalCost * 1e8) / 1e8,
          total_cost_display: `$${totalCost.toFixed(6)}`,
        },
      )

      patchTab(ticker, { saving: true, error: '', saveMessage: '', saveIsNoop: false })
      const saveScope = activeMonitorScope(ticker)
      const saveSymbol = String(ticker || '')
        .trim()
        .toUpperCase()
      const saveResponse = await fetch(
        `/api/notifications/save/${encodeURIComponent(ticker)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            events: eventsToSave,
            source_url: state.result?.url,
            scraped_at: state.result?.scraped_at,
            source_provider: state.result?.scrape_source || state.result?.source_provider,
            asset_class: state.result?.asset_class,
            monitor_scope: saveScope,
            create_if_missing:
              saveScope === 'pinned' &&
              (stocksListTab === 'pinned' || extremePinnedSet.has(saveSymbol)),
            company_name:
              tickers.find((row) => row.ticker === ticker)?.company_name ||
              extremePinned.find((row) => row.ticker === ticker)?.company_name ||
              undefined,
          }),
        },
      )
      const saveBody = await saveResponse.json().catch(() => ({}))
      if (!saveResponse.ok) {
        throw new Error(saveBody.error || `Save failed (${saveResponse.status})`)
      }
      if (activeMonitorScope(ticker) === 'pinned') {
        void loadPinnedTickers()
      }

      const noop = saveBody.changed === false
      const message =
        saveBody.message ||
        (noop
          ? 'Gemini classified, but Supabase already had the same content.'
          : `Gemini classified & saved ${classified.length} event(s) · ${totalCredits} credits · $${totalCost.toFixed(6)}`)

      const written = new Set<string>([
        ...((saveBody.inserted_dates as string[]) || []),
        ...((saveBody.updated_dates as string[]) || []),
        ...((saveBody.written_dates as string[]) || []),
      ])

      setTabState((current) => {
        const prev = current[ticker] || emptyTabState()
        if (!prev.result) {
          return {
            ...current,
            [ticker]: {
              ...prev,
              saving: false,
              saveMessage: message,
              saveIsNoop: noop,
            },
          }
        }
        return {
          ...current,
          [ticker]: {
            ...prev,
            saving: false,
            saveMessage: message,
            saveIsNoop: noop,
            error: '',
            result: {
              ...prev.result,
              events: prev.result.events.map((event) =>
                written.has(event.event_date) || byDate.has(`${event.event_date}|${event.time_label || ''}`)
                  ? { ...event, save_status: 'saved' as const }
                  : event,
              ),
            },
          },
        }
      })

      appendLocalLog(ticker, noop ? 'info' : 'success', message, {
        inserted: saveBody.inserted,
        updated: saveBody.updated,
        written_dates: [...written],
        total_credits: totalCredits,
        total_cost_usd: Math.round(totalCost * 1e8) / 1e8,
      })
      reloadAfterWrite(ticker)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Gemini bulk failed'
      patchTab(ticker, { saving: false, error: message })
      appendLocalLog(ticker, 'error', message)
    } finally {
      setGeminiBulkBusy(false)
      setGeminiBulkProgress({ done: 0, total: 0 })
    }
  }

  function triggerDigestBody(device: EnabledDevice) {
    const items = (device.tickers || [])
      .map((symbol) => {
        const tickerMeta = tickers.find(
          (item) => item.ticker.toUpperCase() === symbol.toUpperCase(),
        )
        const latest = tickerMeta?.saved_events?.[0]
        const momentum = formatDigestMomentum(latest?.price_change || latest?.momentum)
        const premarketMomentum = formatDigestMomentum(
          latest ? getPremarketChange(latest) : null,
        )
        const changes = [
          momentum,
          premarketMomentum ? `pre-market ${premarketMomentum}` : '',
        ].filter(Boolean)
        return changes.length
          ? `${symbol.toUpperCase()} (${changes.join(', ')})`
          : symbol.toUpperCase()
      })
      .sort()
    return items.length
      ? items.join(' · ')
      : 'No subscribed ticker momentum is available yet.'
  }

  function openTriggerDigest(device?: EnabledDevice) {
    const candidates = device
      ? isDeviceAlertable(device)
        ? [device]
        : []
      : alertableDevices
    const keys = candidates.map(deviceKey)
    setDigestScopeDeviceKeys(keys)
    setDigestSelectedDeviceKeys(keys)
    setDigestTitle("Today's notable price momentum")
    setDigestMessage('')
    setDigestIsError(false)
    setDigestOpen(true)
    appendUsersLog('info', device ? 'Individual Trigger alert opened' : 'Alert all opened', {
      recipient_count: candidates.length,
      device_ids: candidates.map((item) => item.device_id),
    })
  }

  async function handleTriggerDigestSend() {
    const selectedKeys = new Set(digestSelectedDeviceKeys)
    const selected = digestDevices.filter((device) => selectedKeys.has(deviceKey(device)))
    if (!selected.length || !digestTitle.trim()) return

    setDigestSending(true)
    setDigestMessage('')
    setDigestIsError(false)
    appendUsersLog('info', 'Sending personalized Trigger momentum digest', {
      title: digestTitle.trim(),
      recipient_count: selected.length,
      device_ids: selected.map((device) => device.device_id),
      previews: selected.map((device) => ({
        device_id: device.device_id,
        body: triggerDigestBody(device),
      })),
    })
    try {
      const response = await fetch('/api/notifications/alert-trigger-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: digestTitle.trim(),
          device_ids: selected.map((device) => device.device_id).filter(Boolean),
          expo_push_tokens: selected.map((device) => device.expo_push_token),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Trigger digest failed (${response.status})`)
      }
      const message =
        body.message || `Momentum digest sent to ${body.sent_ok ?? 0} Trigger user(s)`
      const isError = Boolean(body.sent_failed || body.ok === false)
      setDigestMessage(message)
      setDigestIsError(isError)
      appendUsersLog(isError ? 'warn' : 'success', message, {
        sent_ok: body.sent_ok,
        sent_failed: body.sent_failed,
        device_ids: body.device_ids,
        previews: body.previews,
        tickets: body.tickets,
        errors: body.errors,
      })
      if (!isError) setDigestOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Trigger digest failed'
      setDigestMessage(message)
      setDigestIsError(true)
      appendUsersLog('error', message)
    } finally {
      setDigestSending(false)
    }
  }

  async function handleCustomSend() {
    const title = customTitle.trim()
    const body = customBody.trim()
    if (!title) {
      setCustomMessage('Title is required for the notification header.')
      setCustomIsError(true)
      appendCustomLog('warn', 'Custom send blocked — empty title')
      return
    }
    if (!body) {
      setCustomMessage('Body is required for the second line.')
      setCustomIsError(true)
      appendCustomLog('warn', 'Custom send blocked — empty body')
      return
    }
    const selected = resolveSelectedDevices(customSelectedDeviceKeys)
    if (selected.length <= 0) {
      setCustomMessage('Select at least one device.')
      setCustomIsError(true)
      appendCustomLog('warn', 'Custom send blocked — no devices selected')
      return
    }

    const ok = window.confirm(
      `Send this custom notification to ${selected.length} selected device(s)?\n\n${title}\n${body.slice(0, 160)}${body.length > 160 ? '…' : ''}`,
    )
    if (!ok) {
      appendCustomLog('info', 'Custom send cancelled')
      return
    }

    setCustomSending(true)
    setCustomMessage('')
    setCustomIsError(false)
    appendCustomLog('info', 'Sending custom notification', {
      title,
      body,
      device_count: selected.length,
      device_ids: selected.map((d) => d.device_id),
    })

    try {
      const response = await fetch('/api/notifications/alert-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'custom_alert',
          app_key: notificationApp,
          title,
          body,
          device_ids: selected.map((d) => d.device_id).filter(Boolean),
          expo_push_tokens: selected.map((d) => d.expo_push_token),
        }),
      })
      const resBody = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(resBody.error || `Custom alert failed (${response.status})`)
      }
      const message =
        resBody.message || `Custom alert sent to ${resBody.sent_ok ?? 0} device(s)`
      const isError = Boolean(resBody.sent_failed || resBody.ok === false)
      setCustomMessage(message)
      setCustomIsError(isError)
      appendCustomLog(isError ? 'warn' : 'success', message, {
        title: resBody.title,
        body: resBody.body,
        sent_ok: resBody.sent_ok,
        sent_failed: resBody.sent_failed,
        device_ids: resBody.device_ids,
        tickets: resBody.tickets,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Custom alert failed'
      setCustomMessage(message)
      setCustomIsError(true)
      appendCustomLog('error', message)
    } finally {
      setCustomSending(false)
    }
  }

  async function handleNewsSend() {
    const article = news.find((a) => a.id === selectedArticleId) || null
    if (!article) {
      setNewsAlertMessage('Select a news article first.')
      setNewsAlertIsError(true)
      appendNewsLog('warn', 'News send blocked — no article selected')
      return
    }
    const selected = resolveSelectedDevices(selectedDeviceKeys)
    if (selected.length <= 0) {
      setNewsAlertMessage('Select at least one device.')
      setNewsAlertIsError(true)
      appendNewsLog('warn', 'News send blocked — no devices selected')
      return
    }

    const ok = window.confirm(
      `Send this news to ${selected.length} selected device(s)?\n\n"${article.title}"`,
    )
    if (!ok) {
      appendNewsLog('info', 'News alert cancelled')
      return
    }

    setNewsSending(true)
    setNewsAlertMessage('')
    setNewsAlertIsError(false)
    appendNewsLog('info', `News alert for article ${article.id}`, {
      title: article.title,
      device_count: selected.length,
      device_ids: selected.map((d) => d.device_id),
    })

    try {
      // Yahoo watchlist articles are not Supabase rows — send headline + url directly.
      const isYahoo =
        article.provider === 'yahoo-finance' ||
        String(article.id || '').startsWith('yahoo-') ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(article.id || ''))
      const headerTickers = (article.tickers || [])
        .slice(0, 4)
        .map((t) => String(t).toUpperCase())
        .filter(Boolean)
      const pushPayload = isYahoo
        ? {
            app_key: notificationApp,
            type: 'news_alert',
            title:
              article.impact_body ||
              (headerTickers.length
                ? headerTickers.join(' · ')
                : 'Yahoo Finance'),
            body: article.title,
            headline: article.title,
            url: article.url || null,
            device_ids: selected.map((d) => d.device_id).filter(Boolean),
            expo_push_tokens: selected.map((d) => d.expo_push_token),
          }
        : {
            app_key: notificationApp,
            article_id: article.id,
            device_ids: selected.map((d) => d.device_id).filter(Boolean),
            expo_push_tokens: selected.map((d) => d.expo_push_token),
          }
      const response = await fetch('/api/notifications/alert-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pushPayload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `News alert failed (${response.status})`)
      }
      const message =
        body.message || `News alert sent to ${body.sent_ok ?? 0} device(s)`
      const isError = Boolean(body.sent_failed || body.ok === false)
      setNewsAlertMessage(message)
      setNewsAlertIsError(isError)
      appendNewsLog(isError ? 'warn' : 'success', message, {
        title: body.title,
        title_length: body.title_length,
        title_is_full_headline: body.title_is_full_headline,
        body: body.body,
        sent_ok: body.sent_ok,
        sent_failed: body.sent_failed,
        device_ids: body.device_ids,
        expo_errors: body.errors,
        expo_tickets: body.tickets,
        notification_format: 'text-only',
        channel_id: body.channel_id,
        channel_note: body.channel_note,
        sample_expo_payload: body.sample_expo_payload,
        ios_nse_required: body.ios_nse_required,
        source: isYahoo ? 'yahoo-finance' : 'supabase',
      })
      appendNewsLog('info', 'Text-only notification payload', body.sample_expo_payload || null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'News alert failed'
      setNewsAlertMessage(message)
      setNewsAlertIsError(true)
      appendNewsLog('error', message)
    } finally {
      setNewsSending(false)
    }
  }

  async function openMovementAlert(ticker: string, event: PriceMovementEvent | null = null) {
    const normalizedTicker = ticker.toUpperCase()
    // Extreme / Pinned stocks usually have zero subscribers for that ticker — still list everyone.
    const allRecipients =
      stocksListTab === 'extreme' ||
      stocksListTab === 'pinned' ||
      extremePinnedSet.has(normalizedTicker)
    const eligible = allRecipients
      ? alertableDevices
      : alertableDevices.filter((device) =>
          (device.tickers || []).some((item) => item.toUpperCase() === normalizedTicker),
        )
    // All-recipients mode: nothing pre-selected (Select all / pick manually).
    // Subscriber mode: pre-select everyone watching this ticker (existing behaviour).
    const defaultKeys = allRecipients ? [] : eligible.map(deviceKey)
    const companyName =
      tickers.find((row) => row.ticker === normalizedTicker)?.company_name ||
      extremePinned.find((row) => row.ticker === normalizedTicker)?.company_name ||
      extremeMovers.find((row) => row.ticker === normalizedTicker)?.company_name ||
      normalizedTicker

    setMovementAlertTarget({ ticker: normalizedTicker, event, allRecipients })
    setMovementAlertDeviceKeys(defaultKeys)
    setMovementAlertOpen(true)
    setMovementPreviewTitle('')
    setMovementPreviewBody('')
    setMovementPreviewError('')
    setMovementPreviewLoading(true)
    appendLocalLog(ticker, 'info', 'Alert recipient picker opened', {
      app_key: notificationApp,
      event_date: event?.event_date || 'latest saved',
      all_recipients: allRecipients,
      pool_size: eligible.length,
      default_selected: defaultKeys.length,
      device_ids: eligible.map((device) => device.device_id),
    })
    try {
      const response = await fetch(
        `/api/notifications/preview/${encodeURIComponent(normalizedTicker)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app_key: notificationApp,
            event,
            company_name: companyName,
            all_recipients: allRecipients,
          }),
        },
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Preview failed (${response.status})`)
      }
      setMovementPreviewTitle(String(body.title || ''))
      setMovementPreviewBody(String(body.body || ''))
      appendLocalLog(ticker, 'info', 'Notification preview loaded', {
        app_key: body.app_key,
        notification_type: body.notification_type,
        movement_type: body.movement_type,
        event_date: body.event_date,
        title: body.title,
        body: body.body,
        deep_link: body.deep_link,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Notification preview failed'
      setMovementPreviewError(message)
      appendLocalLog(ticker, 'error', message)
    } finally {
      setMovementPreviewLoading(false)
    }
  }

  async function handleAlertUsers() {
    if (!movementAlertTarget) return
    const ticker = movementAlertTarget.ticker
    const selectedKeys = new Set(movementAlertDeviceKeys)
    const selected = movementAlertDevices.filter((device) =>
      selectedKeys.has(deviceKey(device)),
    )
    if (!selected.length) return

    patchTab(ticker, {
      alerting: true,
      error: '',
      alertMessage: '',
      alertIsError: false,
    })
    const companyName =
      tickers.find((row) => row.ticker === ticker)?.company_name ||
      extremePinned.find((row) => row.ticker === ticker)?.company_name ||
      extremeMovers.find((row) => row.ticker === ticker)?.company_name ||
      ticker

    appendLocalLog(ticker, 'info', `Sending selected movement alert for ${ticker}`, {
      app_key: notificationApp,
      event_date: movementAlertTarget.event?.event_date || 'latest saved',
      all_recipients: Boolean(movementAlertTarget.allRecipients),
      recipient_count: selected.length,
      device_ids: selected.map((device) => device.device_id),
    })

    try {
      const response = await fetch(`/api/notifications/alert/${encodeURIComponent(ticker)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_key: notificationApp,
          event: movementAlertTarget.event,
          title: movementPreviewTitle.trim() || undefined,
          body: movementPreviewBody.trim() || undefined,
          company_name: companyName,
          all_recipients: Boolean(movementAlertTarget.allRecipients),
          device_ids: selected.map((device) => device.device_id).filter(Boolean),
          expo_push_tokens: selected.map((device) => device.expo_push_token),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Alert failed (${response.status})`)
      }

      const message =
        body.message ||
        `Alert sent to ${body.sent_ok ?? 0} device(s) for ${ticker}` +
          (body.sent_failed ? ` · ${body.sent_failed} failed` : '')
      const isError = Boolean(body.sent_failed || body.ok === false)

      patchTab(ticker, {
        alerting: false,
        alertMessage: message,
        alertIsError: isError,
      })
      appendLocalLog(ticker, isError ? 'warn' : 'success', message, {
        title: body.title,
        body: body.body,
        event_date: body.event_date,
        recipient_count: body.recipient_count,
        sent_ok: body.sent_ok,
        sent_failed: body.sent_failed,
        device_ids: body.device_ids,
        tickets: body.tickets,
        errors: body.errors,
      })
      if (!isError) {
        setMovementAlertOpen(false)
        setMovementAlertTarget(null)
        setMovementAlertDeviceKeys([])
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Alert failed'
      patchTab(ticker, {
        alerting: false,
        alertMessage: message,
        alertIsError: true,
      })
      appendLocalLog(ticker, 'error', message)
    }
  }

  async function handleSave(ticker: string) {
    const state = tabState[ticker] || emptyTabState()
    const events = state.result?.events || []
    if (!events.length) {
      patchTab(ticker, { error: 'Nothing to save. Click Refresh first.' })
      appendLocalLog(ticker, 'warn', 'Save blocked — no scraped events')
      return
    }
    const pending = events.filter(
      (event) => event.save_status === 'new' || event.save_status === 'changed',
    )
    if (!pending.length) {
      const message = 'Nothing to write — every scraped date is already saved with the same content.'
      patchTab(ticker, { saveMessage: message, saveIsNoop: true, error: '' })
      appendLocalLog(ticker, 'info', message)
      return
    }
    patchTab(ticker, { saving: true, error: '', saveMessage: '', saveIsNoop: false })
    appendLocalLog(ticker, 'info', `Save clicked for ${ticker}`, {
      pending_dates: pending.map((e) => e.event_date),
      pending_count: pending.length,
    })
    try {
      // Only new + content-changed dates are written; already-saved dates are skipped server-side.
      const monitorScope = activeMonitorScope(ticker)
      const symbol = String(ticker || '')
        .trim()
        .toUpperCase()
      const createIfMissing =
        monitorScope === 'pinned' &&
        (stocksListTab === 'pinned' || extremePinnedSet.has(symbol))
      const response = await fetch(`/api/notifications/save/${encodeURIComponent(ticker)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events,
          source_url: state.result?.url,
          scraped_at: state.result?.scraped_at,
          monitor_scope: monitorScope,
          create_if_missing: createIfMissing,
          company_name:
            tickers.find((row) => row.ticker === ticker)?.company_name ||
            extremePinned.find((row) => row.ticker === ticker)?.company_name ||
            undefined,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Save failed (${response.status})`)
      }
      const noop = body.changed === false
      const message =
        body.message ||
        (noop
          ? 'No changes — same content already saved.'
          : `Saved ${body.inserted || 0} new / ${body.updated || 0} updated date(s).`)

      if (monitorScope === 'pinned') {
        void loadPinnedTickers()
      }

      // Mark written events as saved in the local timeline.
      const written = new Set<string>([
        ...((body.inserted_dates as string[]) || []),
        ...((body.updated_dates as string[]) || []),
        ...((body.written_dates as string[]) || []),
      ])
      setTabState((current) => {
        const prev = current[ticker] || emptyTabState()
        const prevResult = prev.result
        if (!prevResult) {
          return {
            ...current,
            [ticker]: { ...prev, saving: false, saveMessage: message, saveIsNoop: noop },
          }
        }
        return {
          ...current,
          [ticker]: {
            ...prev,
            saving: false,
            saveMessage: message,
            saveIsNoop: noop,
            result: {
              ...prevResult,
              events: prevResult.events.map((event) =>
                written.has(event.event_date)
                  ? { ...event, save_status: 'saved' as const }
                  : event,
              ),
              compare: {
                total: prevResult.events.length,
                new: 0,
                changed: prevResult.events.filter(
                  (e) => !written.has(e.event_date) && e.save_status === 'changed',
                ).length,
                already_saved: prevResult.events.filter(
                  (e) => written.has(e.event_date) || e.save_status === 'saved',
                ).length,
              },
            },
          },
        }
      })
      appendLocalLog(ticker, noop ? 'info' : 'success', message, {
        inserted: body.inserted,
        updated: body.updated,
        inserted_dates: body.inserted_dates,
        updated_dates: body.updated_dates,
        skipped_already_saved: body.skipped_already_saved,
        total_saved_events: body.total_saved_events,
        structure: body.structure,
      })
      if (!noop) reloadAfterWrite(ticker)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed'
      patchTab(ticker, { saving: false, error: message })
      appendLocalLog(ticker, 'error', message)
    }
  }

  const monitoredTickerSet = useMemo(
    () => new Set(tickers.map((item) => item.ticker.toUpperCase())),
    [tickers],
  )

  /**
   * Users → device_monitored_tickers (real app subscribers only)
   * Extreme/Pinned → pinned_monitored_tickers (never writes into Users)
   */
  const activeMonitorScope = useCallback(
    (ticker?: string): 'device' | 'pinned' => {
      const symbol = String(ticker || activeTicker || '')
        .trim()
        .toUpperCase()
      // Explicit Extreme / Pinned tabs always use the pinned store.
      if (stocksListTab === 'extreme' || stocksListTab === 'pinned') return 'pinned'
      // Pinned bookmark that is not a real subscriber stock stays pinned even if
      // the sidebar briefly sits on Users (e.g. after a background reload).
      if (symbol && extremePinnedSet.has(symbol)) {
        const userRow = tickers.find((row) => row.ticker.toUpperCase() === symbol)
        const realSubs = (userRow?.subscriber_count ?? 0) > 0
        if (!realSubs) return 'pinned'
      }
      return 'device'
    },
    [stocksListTab, activeTicker, extremePinnedSet, tickers],
  )

  // Company fundamentals under logo (market cap, about, sector, …)
  useEffect(() => {
    if (!activeTicker) {
      setCompanyProfile(null)
      setCompanyProfileLoading(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setCompanyProfileLoading(true)
    setCompanyProfile(null)
    fetchYahooCompanyProfile(activeTicker, controller.signal)
      .then((body) => {
        if (cancelled) return
        setCompanyProfile(body.profile || null)
      })
      .catch(() => {
        if (!cancelled) setCompanyProfile(null)
      })
      .finally(() => {
        if (!cancelled) setCompanyProfileLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [activeTicker])

  const activeMeta = useMemo((): MonitoredTicker | null => {
    if (!activeTicker) return null
    const symbol = String(activeTicker).trim().toUpperCase()
    const isPinnedBookmark = extremePinnedSet.has(symbol)
    const userRow =
      tickers.find((item) => item.ticker.toUpperCase() === symbol) || null
    const realSubs = (userRow?.subscriber_count ?? 0) > 0

    // Extreme / Pinned tabs never pull Users/device meta (no fake subscribers / unsubscribe UI).
    const usePinnedMeta =
      stocksListTab === 'extreme' ||
      stocksListTab === 'pinned' ||
      (isPinnedBookmark && !realSubs)

    if (usePinnedMeta) {
      const pinned = extremePinned.find((row) => row.ticker.toUpperCase() === symbol)
      if (pinned) {
        return {
          ticker: pinned.ticker,
          company_name: pinned.company_name || pinned.ticker,
          created_at: pinned.pinned_at,
          updated_at: pinned.last_saved_at || pinned.pinned_at,
          has_saved_movements: Boolean(
            pinned.has_saved_movements || (pinned.saved_event_count ?? 0) > 0,
          ),
          saved_event_count: pinned.saved_event_count ?? pinned.saved_events?.length ?? 0,
          last_saved_at: pinned.last_saved_at || null,
          // Pinned store has no app subscribers — never surface Users unsubscribe state.
          subscriber_count: 0,
          device_ids: [],
          saved_events: pinned.saved_events || [],
          asset_class: 'equity',
          scrape_source: 'perplexity',
        }
      }
      // Extreme view-only (not bookmarked yet)
      if (stocksListTab === 'extreme') {
        const mover = extremeMovers.find((row) => row.ticker.toUpperCase() === symbol)
        return {
          ticker: symbol,
          company_name: mover?.company_name || symbol,
          subscriber_count: 0,
          device_ids: [],
          saved_event_count: 0,
          saved_events: [],
          asset_class: 'equity',
          scrape_source: 'perplexity',
        }
      }
      // Pinned tab but row not loaded yet — do NOT fall through to Users.
      if (stocksListTab === 'pinned' || isPinnedBookmark) {
        return {
          ticker: symbol,
          company_name: symbol,
          subscriber_count: 0,
          device_ids: [],
          saved_event_count: 0,
          saved_events: [],
          asset_class: 'equity',
          scrape_source: 'perplexity',
        }
      }
    }

    // Users tab only: real subscriber-backed rows
    return userRow
  }, [
    activeTicker,
    stocksListTab,
    extremePinned,
    extremePinnedSet,
    extremeMovers,
    tickers,
  ])

  const liveTickerKey = useMemo(() => {
    const set = new Set(tickers.map((item) => item.ticker.toUpperCase()).filter(Boolean))
    for (const item of extremePinned) {
      if (item.ticker) set.add(item.ticker.toUpperCase())
    }
    if (activeTicker) set.add(activeTicker.toUpperCase())
    return [...set].sort().join(',')
  }, [tickers, extremePinned, activeTicker])

  // Keep list percentages and the selected ticker price fresh from Yahoo every 5 seconds.
  useEffect(() => {
    const symbols = liveTickerKey.split(',').filter(Boolean)
    if (!symbols.length) {
      setLiveQuotes({})
      setLiveQuotesForTickerKey('')
      return
    }

    let cancelled = false
    let requestRunning = false
    let activeController: AbortController | null = null
    const refresh = async () => {
      if (requestRunning) return
      requestRunning = true
      activeController = new AbortController()
      try {
        const body = await fetchYahooQuotes(symbols, activeController.signal)
        if (!cancelled) {
          setLiveQuotes(body.quotes || {})
          setLiveQuotesForTickerKey(symbols.join(','))
          const fetchedAt = Date.parse(body.fetchedAt)
          setLiveQuotesLastCheckedAt(Number.isFinite(fetchedAt) ? fetchedAt : Date.now())
        }
      } catch {
        // Preserve the last successful values during a temporary Yahoo/network failure.
      } finally {
        requestRunning = false
        activeController = null
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 5_000)
    return () => {
      cancelled = true
      activeController?.abort()
      window.clearInterval(timer)
    }
  }, [liveTickerKey])

  const activeLiveQuote = activeTicker ? liveQuotes[activeTicker.toUpperCase()] : null
  const activeMarketSession = yahooMarketSession(activeLiveQuote)
  const extremeActiveMeta = useMemo(() => {
    if (!activeTicker) return null
    const symbol = activeTicker.toUpperCase()
    const pinned = extremePinned.find((row) => row.ticker === symbol)
    if (pinned) return pinned
    const mover = extremeMovers.find((row) => row.ticker === symbol)
    if (mover) {
      return {
        ticker: mover.ticker,
        company_name: mover.company_name,
        pinned_at: '',
        change_percent: mover.regularMarketChangePercent,
        currency: mover.currency || null,
      } satisfies ExtremePinnedItem
    }
    return null
  }, [activeTicker, extremePinned, extremeMovers])

  const activeCompanyName =
    activeMeta?.company_name && activeMeta.company_name !== activeTicker
      ? activeMeta.company_name
      : extremeActiveMeta?.company_name && extremeActiveMeta.company_name !== activeTicker
        ? extremeActiveMeta.company_name
        : activeLiveQuote?.shortName || activeTicker
  const activeMarketPillItems: MarketDataPillItem[] = (() => {
    if (!activeLiveQuote) return []

    const item = (
      label: string,
      price: number | null | undefined,
      percent: number | null | undefined,
      sourceTimestamp: string | null | undefined,
      statusOnly = false,
    ): MarketDataPillItem => {
      const priceTimestamp =
        sourceTimestamp ||
        (liveQuotesLastCheckedAt ? new Date(liveQuotesLastCheckedAt).toISOString() : null)
      const displayTimeZone = tickerExchangeTimeZone(activeTicker, activeLiveQuote)
      return {
        label,
        price: price ?? null,
        percent: percent ?? null,
        source: 'Yahoo',
        href: yahooQuoteUrl(activeTicker),
        sourceRefreshSeconds: 5,
        updatedAt: sourceTimestamp,
        priceTimeLabel: statusOnly
          ? null
          : formatMarketTimestamp(priceTimestamp, displayTimeZone),
        priceTimestamp: statusOnly ? null : priceTimestamp,
        displayTimeZone,
        statusOnly,
      }
    }

    if (activeMarketSession === 'regular') {
      return [
        item(
          'Regular session',
          activeLiveQuote.regularMarketPrice,
          activeLiveQuote.regularMarketChangePercent,
          activeLiveQuote.regularMarketTime,
        ),
      ]
    }

    // Labels + fields match Yahoo Finance quote page + API marketState
    const items: MarketDataPillItem[] = []
    if (activeMarketSession === 'premarket') {
      // marketState PRE → preMarket*
      items.push(
        item(
          'Pre-market',
          activeLiveQuote.preMarketPrice,
          activeLiveQuote.preMarketChangePercent,
          activeLiveQuote.preMarketTime,
          activeLiveQuote.preMarketPrice == null,
        ),
      )
    } else if (activeMarketSession === 'after-hours') {
      // marketState POST | POSTPOST → postMarket*
      items.push(
        item(
          'After-hours',
          activeLiveQuote.postMarketPrice,
          activeLiveQuote.postMarketChangePercent,
          activeLiveQuote.postMarketTime,
          activeLiveQuote.postMarketPrice == null,
        ),
      )
    } else if (activeMarketSession === 'overnight') {
      // marketState PREPRE → Overnight (Yahoo API still uses postMarket* fields)
      items.push(
        item(
          'Overnight',
          activeLiveQuote.postMarketPrice,
          activeLiveQuote.postMarketChangePercent,
          activeLiveQuote.postMarketTime,
          activeLiveQuote.postMarketPrice == null,
        ),
      )
    } else if (activeMarketSession === 'closed') {
      // marketState CLOSED → At close only (no fake Pre-market / Overnight)
      items.push(item('Market', null, null, null, true))
    }

    // Always show regular session close for reference (Yahoo “At close”)
    // (regular session early-return above — we are never 'regular' here)
    items.push(
      item(
        'At close',
        activeLiveQuote.regularMarketPrice,
        activeLiveQuote.regularMarketChangePercent,
        activeLiveQuote.regularMarketTime,
      ),
    )
    return items
  })()

  useEffect(() => {
    initialMoverSelectionRef.current = null
    userSelectedTickerRef.current = false
  }, [notificationApp])

  // Once the first Yahoo batch arrives, open the stock with the largest
  // absolute percentage move. This runs once per app and never overrides a
  // ticker the user has already selected themselves.
  useEffect(() => {
    if (!liveQuotesLastCheckedAt || !tickers.length) return
    if (tickersLoadedForApp !== notificationApp) return
    if (liveQuotesForTickerKey !== liveTickerKey) return
    if (initialMoverSelectionRef.current === notificationApp) return
    if (userSelectedTickerRef.current) {
      initialMoverSelectionRef.current = notificationApp
      return
    }

    let largestTicker = ''
    let largestAbsoluteMove = -1
    for (const item of tickers) {
      const percent = currentMarketQuoteValues(
        liveQuotes[item.ticker.toUpperCase()],
      ).percent
      if (percent == null || !Number.isFinite(percent)) continue
      const absoluteMove = Math.abs(percent)
      if (absoluteMove > largestAbsoluteMove) {
        largestTicker = item.ticker
        largestAbsoluteMove = absoluteMove
      }
    }

    if (!largestTicker) return
    initialMoverSelectionRef.current = notificationApp
    setActiveTicker(largestTicker)
  }, [
    liveQuotes,
    liveQuotesForTickerKey,
    liveQuotesLastCheckedAt,
    liveTickerKey,
    notificationApp,
    tickers,
    tickersLoadedForApp,
  ])

  /**
   * Users list only: equities with ≥1 real subscriber for this app.
   * Extreme → Pinned bookmarks never appear here unless real devices also
   * subscribed to that ticker (then both lists can show it for different reasons).
   */
  const filteredTickers = useMemo(() => {
    const q = tickerSearchQuery.trim().toLowerCase()
    let list = tickers.filter((item) => (item.subscriber_count ?? 0) > 0)
    if (q) {
      list = list.filter((item) => {
        const t = item.ticker.toLowerCase()
        const n = (item.company_name || '').toLowerCase()
        return t.includes(q) || n.includes(q)
      })
    }
    list.sort((a, b) => {
      if (
        tickerSort === 'movement' ||
        tickerSort === 'movement_pos_to_neg' ||
        tickerSort === 'movement_neg_to_pos'
      ) {
        const aMove = currentMarketQuoteValues(liveQuotes[a.ticker.toUpperCase()]).percent
        const bMove = currentMarketQuoteValues(liveQuotes[b.ticker.toUpperCase()]).percent
        // Missing quotes always sink to the bottom for any movement sort.
        if (aMove == null && bMove == null) return a.ticker.localeCompare(b.ticker)
        if (aMove == null) return 1
        if (bMove == null) return -1

        let diff = 0
        if (tickerSort === 'movement') {
          // Absolute % movement: largest swing first (e.g. -8% before +3%)
          diff = Math.abs(bMove) - Math.abs(aMove)
        } else if (tickerSort === 'movement_pos_to_neg') {
          // Signed: highest gainers → biggest losers (e.g. +12%, +5%, -1%, -9%)
          diff = bMove - aMove
        } else {
          // Signed: biggest losers → highest gainers (e.g. -9%, -1%, +5%, +12%)
          diff = aMove - bMove
        }
        if (diff !== 0) return diff
        return a.ticker.localeCompare(b.ticker)
      }
      if (tickerSort === 'subscribers') {
        const diff = (b.subscriber_count ?? 0) - (a.subscriber_count ?? 0)
        if (diff !== 0) return diff
        return a.ticker.localeCompare(b.ticker)
      }
      if (tickerSort === 'saved') {
        const diff = (b.saved_event_count ?? 0) - (a.saved_event_count ?? 0)
        if (diff !== 0) return diff
        return a.ticker.localeCompare(b.ticker)
      }
      if (tickerSort === 'name') {
        const an = (a.company_name || a.ticker).toLowerCase()
        const bn = (b.company_name || b.ticker).toLowerCase()
        const diff = an.localeCompare(bn)
        if (diff !== 0) return diff
        return a.ticker.localeCompare(b.ticker)
      }
      // ticker
      return a.ticker.localeCompare(b.ticker)
    })
    return list
  }, [
    tickers,
    tickerSort,
    tickerSearchQuery,
    liveQuotes,
  ])

  // Debounced Yahoo Finance search for the sidebar add/search box
  useEffect(() => {
    const q = tickerSearchQuery.trim()
    if (q.length < 1) {
      setTickerSearchResults([])
      setTickerSearchLoading(false)
      return
    }
    let cancelled = false
    setTickerSearchLoading(true)
    const timer = window.setTimeout(() => {
      searchYahooSaved(q)
        .then((body) => {
          if (cancelled) return
          const rows = (body.tickers || []).filter((row) => {
            const type = String(row.quoteType || '').toUpperCase()
            // Prefer equities / ETFs; drop options & crypto-ish symbols
            if (type.includes('OPTION')) return false
            if (looksLikeNonEquityTicker(row.ticker)) return false
            return Boolean(row.ticker)
          })
          setTickerSearchResults(rows)
        })
        .catch(() => {
          if (!cancelled) setTickerSearchResults([])
        })
        .finally(() => {
          if (!cancelled) setTickerSearchLoading(false)
        })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [tickerSearchQuery])

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!tickerSearchRef.current) return
      if (!tickerSearchRef.current.contains(event.target as Node)) {
        setTickerSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const addMonitoredTicker = useCallback(
    async (symbol: string, companyName?: string | null) => {
      const ticker = String(symbol || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9.^_=\-]/g, '')
      if (!ticker) return
      if (monitoredTickerSet.has(ticker)) {
        selectTickerByUser(ticker)
        setTickerSearchQuery('')
        setTickerSearchOpen(false)
        toast({ title: `${ticker} already in list`, description: 'Selected in the sidebar.' })
        return
      }
      setTickerAddBusy(ticker)
      try {
        const response = await fetch('/api/notifications/monitored-tickers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker,
            company_name: companyName || ticker,
          }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(body.error || `Failed to add ${ticker}`)
        }
        await loadTickers()
        selectTickerByUser(ticker)
        setTickerSearchQuery('')
        setTickerSearchOpen(false)
        toast({
          title: body.created === false ? `${ticker} already monitored` : `Added ${ticker}`,
          description: companyName && companyName !== ticker ? companyName : 'Ready to scrape & save.',
        })
      } catch (error) {
        toast({
          title: `Could not add ${ticker}`,
          description: error instanceof Error ? error.message : 'Add failed',
          variant: 'destructive',
        })
      } finally {
        setTickerAddBusy(null)
      }
    },
    [loadTickers, monitoredTickerSet, selectTickerByUser, toast],
  )

  const loadExtremeMovers = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setExtremeMoversLoading(true)
    setExtremeMoversError('')
    try {
      // Yahoo Day Gainers + Day Losers, abs ≥10% (no $1B filter — full top lists).
      const body = await fetchYahooExtremeMovers({
        minPercent: 10,
        minMarketCap: 0,
        count: 100,
      })
      setExtremeMovers(Array.isArray(body.movers) ? body.movers : [])
      setExtremeMoversFetchedAt(body.fetchedAt || new Date().toISOString())
    } catch (error) {
      setExtremeMoversError(
        error instanceof Error ? error.message : 'Failed to load extreme movers',
      )
    } finally {
      if (!opts?.silent) setExtremeMoversLoading(false)
    }
  }, [])

  /** Extreme: split by sign, largest absolute % first within each tab. */
  const filteredExtremeMovers = useMemo(() => {
    const list = extremeMovers.filter((item) => {
      const pct = Number(item.regularMarketChangePercent)
      if (!Number.isFinite(pct) || pct === 0) return false
      return extremeDirectionTab === 'positive' ? pct > 0 : pct < 0
    })
    list.sort(
      (a, b) =>
        Math.abs(Number(b.regularMarketChangePercent) || 0) -
          Math.abs(Number(a.regularMarketChangePercent) || 0) ||
        a.ticker.localeCompare(b.ticker),
    )
    return list
  }, [extremeMovers, extremeDirectionTab])

  const extremePositiveCount = useMemo(
    () =>
      extremeMovers.filter((item) => Number(item.regularMarketChangePercent) > 0).length,
    [extremeMovers],
  )
  const extremeNegativeCount = useMemo(
    () =>
      extremeMovers.filter((item) => Number(item.regularMarketChangePercent) < 0).length,
    [extremeMovers],
  )

  // Load Extreme tab from Yahoo when opened (and refresh while it stays open).
  useEffect(() => {
    if (stocksListTab !== 'extreme' || section !== 'tickers') return
    void loadExtremeMovers()
    const timer = window.setInterval(() => {
      void loadExtremeMovers({ silent: true })
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [stocksListTab, section, loadExtremeMovers])

  const loadPinnedTickers = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/pinned-tickers')
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        // Table may not exist yet — keep local cache, surface once.
        if (response.status === 503 || body.code === 'pinned_table_missing') {
          console.warn(body.error || 'pinned_monitored_tickers missing')
          return
        }
        throw new Error(body.error || `Failed to load pinned (${response.status})`)
      }
      const rows = Array.isArray(body.tickers) ? (body.tickers as ExtremePinnedItem[]) : []
      const next = rows.map((row) => ({
        ...row,
        ticker: String(row.ticker || '').toUpperCase(),
        company_name: row.company_name || row.ticker,
        pinned_at: row.pinned_at || new Date().toISOString(),
        monitor_scope: 'pinned' as const,
      }))
      setExtremePinned(next)
      cacheExtremePinned(next)
    } catch (error) {
      console.warn('loadPinnedTickers', error)
    }
  }, [])

  useEffect(() => {
    void loadPinnedTickers()
  }, [loadPinnedTickers])

  /** After scrape/save/Gemini, refresh the correct list — never dump pinned into Users. */
  const reloadAfterWrite = useCallback(
    (ticker?: string) => {
      if (activeMonitorScope(ticker) === 'pinned') void loadPinnedTickers()
      else void loadTickers()
    },
    [activeMonitorScope, loadPinnedTickers, loadTickers],
  )

  /** One-click pin / unpin — writes pinned_monitored_tickers, never Users list. */
  const togglePinExtreme = useCallback(
    async (item: {
      ticker: string
      company_name?: string | null
      regularMarketChangePercent?: number | null
      change_percent?: number | null
      currency?: string | null
    }) => {
      const ticker = String(item.ticker || '')
        .trim()
        .toUpperCase()
      if (!ticker) return
      const companyName = String(item.company_name || ticker).trim() || ticker
      const pct =
        item.regularMarketChangePercent != null &&
        Number.isFinite(item.regularMarketChangePercent)
          ? item.regularMarketChangePercent
          : item.change_percent != null && Number.isFinite(item.change_percent)
            ? item.change_percent
            : null

      if (extremePinnedSet.has(ticker)) {
        try {
          const response = await fetch(
            `/api/notifications/pinned-tickers/${encodeURIComponent(ticker)}`,
            { method: 'DELETE' },
          )
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error || 'Unpin failed')
          setExtremePinned((prev) => {
            const next = prev.filter((row) => row.ticker !== ticker)
            cacheExtremePinned(next)
            return next
          })
          toast({ title: `Unpinned ${ticker}` })
        } catch (error) {
          toast({
            title: `Could not unpin ${ticker}`,
            description: error instanceof Error ? error.message : 'Unpin failed',
            variant: 'destructive',
          })
        }
        return
      }

      try {
        const response = await fetch('/api/notifications/pinned-tickers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker, company_name: companyName }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || 'Pin failed')
        const nextItem: ExtremePinnedItem = {
          ticker,
          company_name: companyName,
          pinned_at: new Date().toISOString(),
          change_percent: pct,
          currency: item.currency || 'USD',
          monitor_scope: 'pinned',
          saved_event_count: 0,
          saved_events: [],
        }
        setExtremePinned((prev) => {
          const without = prev.filter((row) => row.ticker !== ticker)
          const next = [nextItem, ...without]
          cacheExtremePinned(next)
          return next
        })
        setStocksListTab('pinned')
        selectTickerByUser(ticker)
        toast({
          title: `Pinned ${ticker}`,
          description: 'Stored in pinned_monitored_tickers · not Users',
        })
        void loadPinnedTickers()
      } catch (error) {
        toast({
          title: `Could not pin ${ticker}`,
          description:
            error instanceof Error
              ? error.message
              : 'Pin failed — run schema_pinned_monitored_tickers.sql?',
          variant: 'destructive',
        })
      }
    },
    [extremePinnedSet, loadPinnedTickers, selectTickerByUser, toast],
  )

  // Keep the active ticker inside the Users stocks list (don't clobber Extreme/Pinned picks).
  useEffect(() => {
    if (stocksListTab !== 'users') return
    if (!filteredTickers.length) {
      if (activeTicker) setActiveTicker('')
      return
    }
    if (!filteredTickers.some((item) => item.ticker === activeTicker)) {
      setActiveTicker(filteredTickers[0].ticker)
    }
  }, [filteredTickers, activeTicker, stocksListTab])

  const events = activeState.result?.events || []
  const storedEvents = activeMeta?.saved_events || []
  const pendingEvents = events.filter(
    (event) => event.save_status === 'new' || event.save_status === 'changed',
  )
  const logs =
    section === 'news'
      ? newsLogs
      : section === 'custom'
        ? customLogs
        : section === 'users'
          ? usersLogs
        : activeState.logs || []
  const pendingSaveCount = events.filter(
    (event) => event.save_status === 'new' || event.save_status === 'changed',
  ).length
  const compare = activeState.result?.compare
  const previewTitle = customTitle.trim() || 'Notification title'
  const previewBody = customBody.trim() || 'Notification body will appear here…'
  const previewTitleEmpty = !customTitle.trim()
  const previewBodyEmpty = !customBody.trim()
  const isHub = appTab === 'hub'
  const isTrigger = appTab === 'trigger'
  const isNineAm = appTab === 'nineam'

  return (
    <div
      data-desk={isTrigger ? 'trigger' : isHub ? 'hub' : undefined}
      className={cn(
        'flex h-svh flex-col overflow-hidden text-foreground',
        isHub ? 'bg-background' : isTrigger ? 'desk-shell' : 'bg-background',
      )}
    >
      {/* Home: ticker tabs (line) + app switcher · momentum panel */}
      {isHub ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <SndkMomentumPanel
            onOpenInTrigger={(ticker, label) => {
              const symbol = String(ticker || '')
                .trim()
                .toUpperCase()
              if (!symbol) return
              // Switch into Trigger, then select/add this stock in the sidebar
              setAppTab('trigger')
              setStocksListTab('users')
              if (monitoredTickerSet.has(symbol)) {
                selectTickerByUser(symbol)
              } else {
                void addMonitoredTicker(symbol, label || symbol)
              }
            }}
            onOpenTriggerApp={() => setAppTab('trigger')}
            onOpenNineAmApp={() => setAppTab('nineam')}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        </div>
      ) : null}

      <header
        className={cn(
          'relative z-20 shrink-0',
          isHub && 'hidden',
          isTrigger
            ? 'desk-topbar'
            : 'border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        )}
      >
        <div
          className={cn(
            'flex w-full items-center gap-3 px-4 sm:px-6',
            isTrigger ? 'h-16' : 'h-14',
          )}
        >
          {isHub ? (
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5">
              <div className="mr-1 min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight">NewsLabs</p>
                <p className="truncate text-xs text-muted-foreground">Notifications home</p>
              </div>
              <button
                type="button"
                onClick={() => void openUsagePopup('perplexity')}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#0B2E26]/15 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0B2E26] shadow-sm hover:bg-[#F4F7F6]"
                title="Perplexity spend & token credits — click for daily breakdown"
              >
                <Search className="size-3 shrink-0 opacity-80" />
                Perplexity{' '}
                <strong className="tabular-nums">
                  {perplexityTotals?.total_cost_usd_display ||
                    formatUsdCompact(perplexityTotals?.total_cost_usd) ||
                    '$0.000000'}
                </strong>
                <span className="font-medium text-[#6B7C76]">
                  · {(perplexityTotals?.total_credits || 0).toLocaleString()} tok
                </span>
              </button>
            </div>
          ) : isTrigger ? (
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5">
              <div className="mr-1 hidden min-w-0 sm:block">
                <p className="text-[11px] font-semibold tracking-tight text-foreground">
                  Trigger
                </p>
                <p className="text-[10px] text-muted-foreground">Momentum desk</p>
              </div>
              <span className="desk-stat" title="Monitored instruments">
                Instruments <strong>{tickers.length}</strong>
              </span>
              <span
                className="desk-stat"
                title={`${devices.filter((d) => d.enabled).length} notifications on · ${devices.filter((d) => !d.enabled).length} stopped`}
              >
                Devices{' '}
                <strong>{devices.filter((d) => d.enabled).length}</strong>
              </span>
              <button
                type="button"
                onClick={() => void openUsagePopup('gemini')}
                className="desk-stat desk-stat--accent"
                title={
                  geminiTotals
                    ? `Gemini total · ${geminiTotals.total_tokens || 0} tokens — click for daily breakdown`
                    : 'Gemini spend — click for daily breakdown'
                }
              >
                <Sparkles className="size-3 shrink-0 opacity-80" />
                Gemini{' '}
                <strong>
                  {geminiTotals?.cost_usd_display ||
                    formatUsdCompact(geminiTotals?.cost_usd) ||
                    '$0.000000'}
                </strong>
              </button>
              <button
                type="button"
                onClick={() => void openUsagePopup('perplexity')}
                className="desk-stat desk-stat--accent"
                title={
                  perplexityTotals
                    ? `Perplexity · ${perplexityTotals.total_cost_usd_display || '$0'} · ${(perplexityTotals.total_credits || 0).toLocaleString()} token credits — click for daily breakdown`
                    : 'Perplexity spend & credits — click for daily breakdown'
                }
              >
                <Search className="size-3 shrink-0 opacity-80" />
                Perplexity{' '}
                <strong>
                  {perplexityTotals?.total_cost_usd_display ||
                    formatUsdCompact(perplexityTotals?.total_cost_usd) ||
                    '$0.000000'}
                </strong>
                <span className="ml-1 opacity-80">
                  · {(perplexityTotals?.total_credits || 0).toLocaleString()} tok
                </span>
              </button>
              <button
                type="button"
                onClick={() => void openUsagePopup('firecrawl')}
                className="desk-stat"
                title={creditHint || 'Firecrawl remaining — click for daily credits'}
              >
                Firecrawl{' '}
                <strong>
                  {firecrawlCredits?.remaining != null
                    ? firecrawlCredits.plan != null
                      ? `${firecrawlCredits.remaining}/${firecrawlCredits.plan}`
                      : String(firecrawlCredits.remaining)
                    : creditHint
                      ? creditHint
                          .replace(/^Firecrawl balance:\s*/i, '')
                          .replace(/^Firecrawl remaining:\s*/i, '')
                          .replace(/\s*credits\.?$/i, '')
                          .trim()
                      : '—'}
                </strong>
              </button>
            </div>
          ) : (
            <div className="min-w-0 shrink">
              <p className="truncate text-sm font-semibold tracking-tight">9AM</p>
              <p className="truncate text-xs text-muted-foreground">Notification dashboard</p>
            </div>
          )}

          {/* App switcher — Home · Trigger · 9AM (Home default) */}
          <div
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5"
            role="tablist"
            aria-label="App"
          >
            <button
              type="button"
              role="tab"
              aria-selected={isHub}
              aria-label="Home"
              title="Home"
              onClick={() => setAppTab('hub')}
              className={cn(
                isTrigger
                  ? cn('desk-icon-btn', isHub && 'is-active')
                  : cn(
                      'inline-flex size-10 items-center justify-center rounded-full border transition-colors',
                      isHub
                        ? 'border-foreground/15 bg-foreground text-background shadow-sm'
                        : 'border-border/70 bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    ),
              )}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isTrigger}
              aria-label="Trigger"
              title="Trigger"
              onClick={() => setAppTab('trigger')}
              className={cn(
                isTrigger
                  ? cn('desk-icon-btn', isTrigger && 'is-active')
                  : cn(
                      'inline-flex size-10 items-center justify-center rounded-full border transition-colors',
                      'border-border/70 bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    ),
              )}
            >
              <Zap className="size-4" />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isNineAm}
              aria-label="9AM"
              title="9AM"
              onClick={() => setAppTab('nineam')}
              className={cn(
                isTrigger
                  ? 'desk-icon-btn text-sm font-bold'
                  : cn(
                      'inline-flex size-10 items-center justify-center rounded-full border text-sm font-bold transition-colors',
                      isNineAm
                        ? 'border-foreground/15 bg-foreground text-background shadow-sm'
                        : 'border-border/70 bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    ),
              )}
            >
              9
            </button>
          </div>

          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            {isHub ? null : section === 'tickers' ? (
              <>
                {isTrigger ? (
                  <>
                    <button
                      type="button"
                      disabled={
                        listLoading ||
                        allTickersLoading ||
                        !filteredTickers.some((item) => (item.subscriber_count ?? 0) > 0) ||
                        filteredTickers.some((item) => tabState[item.ticker]?.loading)
                      }
                      onClick={() =>
                        void handleRefreshAll(
                          filteredTickers.filter((item) => (item.subscriber_count ?? 0) > 0),
                          'fetch_all',
                        )
                      }
                      title="Fetch & auto-save only tickers with at least 1 subscriber (≥4% Gemini)"
                      className="desk-action"
                    >
                      {allTickersLoading && fetchAllMode === 'fetch_all' ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      {allTickersLoading && fetchAllMode === 'fetch_all'
                        ? `${allTickersProgress.completed}/${allTickersProgress.total}`
                        : 'Fetch & save all'}
                      {!(allTickersLoading && fetchAllMode === 'fetch_all') ? (
                        <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                          {
                            filteredTickers.filter((item) => (item.subscriber_count ?? 0) > 0)
                              .length
                          }
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      disabled={
                        listLoading ||
                        allTickersLoading ||
                        !filteredTickers.some((item) => (item.subscriber_count ?? 0) > 0) ||
                        filteredTickers.some((item) => tabState[item.ticker]?.loading)
                      }
                      onClick={() =>
                        void handleRefreshAll(
                          filteredTickers.filter((item) => (item.subscriber_count ?? 0) > 0),
                          'nine_pm',
                        )
                      }
                      title="9 PM alert: fetch all → Gemini on every new/updated date → review → send Today’s digest"
                      className="desk-action desk-action--warn"
                    >
                      {allTickersLoading && fetchAllMode === 'nine_pm' ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <BellRing className="size-3.5" />
                      )}
                      {allTickersLoading && fetchAllMode === 'nine_pm'
                        ? `${allTickersProgress.completed}/${allTickersProgress.total}`
                        : '9 PM alert'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={listLoading || allTickersLoading}
                    onClick={() => void loadTickers()}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                  >
                    {listLoading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Reload
                  </button>
                )}
              </>
            ) : null}
            {section === 'news' || section === 'custom' || section === 'users' ? (
              <p className="hidden text-xs text-muted-foreground md:block">
                {devicesLoading
                  ? 'Loading devices…'
                  : `${devices.length} device${devices.length === 1 ? '' : 's'} with notifications on`}
              </p>
            ) : null}
            <button
              type="button"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className={cn(
                'inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                isTrigger
                  ? 'desk-icon-btn'
                  : 'size-9 rounded-md border border-border bg-card',
              )}
            >
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Workspace: left section tabs | main | logs (hidden on Home hub mock) */}
      <div className={cn('flex min-h-0 flex-1', isHub && 'hidden')}>
        {/* LEFT vertical section tabs — collapsed by default */}
        <nav
          className={cn(
            'flex shrink-0 flex-col border-r transition-[width] duration-200 ease-out',
            isTrigger && 'desk-sidenav border-[color:var(--desk-hairline)]',
            workspaceCollapsed
              ? isTrigger
                ? 'w-12'
                : 'w-12 bg-muted/20'
              : isTrigger
                ? 'w-52 p-3 sm:w-56 sm:p-4'
                : 'w-[9.5rem] bg-muted/20 p-2 sm:w-44 sm:p-3',
          )}
          aria-label="Notification sections"
        >
          {workspaceCollapsed ? (
            <div className="flex h-full flex-col items-center gap-2 px-1.5 py-3">
              <button
                type="button"
                onClick={() => setWorkspaceCollapsed(false)}
                className={cn(
                  'inline-flex size-9 items-center justify-center rounded-xl border transition-colors',
                  isTrigger
                    ? 'border-border/70 bg-background text-foreground shadow-sm hover:bg-muted'
                    : 'border-border bg-card text-foreground hover:bg-muted',
                )}
                title="Expand workspace"
                aria-label="Expand workspace"
                aria-expanded={false}
              >
                <ChevronRight className="size-4" />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === 'tickers'}
                aria-label={isTrigger ? 'Momentum' : 'Tickers'}
                title={isTrigger ? 'Momentum' : 'Tickers'}
                onClick={() => setSection('tickers')}
                className={cn(
                  'inline-flex size-9 items-center justify-center rounded-xl transition-colors',
                  section === 'tickers'
                    ? isTrigger
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <TrendingUp className="size-4" />
              </button>
              {notificationApp === 'nineam' ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === 'news'}
                  aria-label="News"
                  title="News"
                  onClick={() => setSection('news')}
                  className={cn(
                    'inline-flex size-9 items-center justify-center rounded-xl transition-colors',
                    section === 'news'
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Newspaper className="size-4" />
                </button>
              ) : null}
              {notificationApp === 'nineam' ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === 'custom'}
                  aria-label="Custom"
                  title="Custom"
                  onClick={() => setSection('custom')}
                  className={cn(
                    'inline-flex size-9 items-center justify-center rounded-xl transition-colors',
                    section === 'custom'
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <PenLine className="size-4" />
                </button>
              ) : null}
              <button
                type="button"
                role="tab"
                aria-selected={section === 'users'}
                aria-label={isTrigger ? 'Audience' : 'All users'}
                title={isTrigger ? 'Audience' : 'All users'}
                onClick={() => setSection('users')}
                className={cn(
                  'inline-flex size-9 items-center justify-center rounded-xl transition-colors',
                  section === 'users'
                    ? isTrigger
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Users className="size-4" />
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === 'settings'}
                aria-label="Settings"
                title="Settings"
                onClick={() => setSection('settings')}
                className={cn(
                  'inline-flex size-9 items-center justify-center rounded-xl transition-colors',
                  section === 'settings'
                    ? isTrigger
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Settings className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between gap-1 px-2">
                <p
                  className={cn(
                    isTrigger
                      ? 'desk-section-label px-1'
                      : 'text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground',
                  )}
                >
                  {isTrigger ? 'Workspace' : 'Sections'}
                </p>
                <button
                  type="button"
                  onClick={() => setWorkspaceCollapsed(true)}
                  className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Collapse workspace"
                  aria-label="Collapse workspace"
                  aria-expanded={true}
                >
                  <ChevronLeft className="size-4" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-1">
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === 'tickers'}
                  onClick={() => setSection('tickers')}
                  className={cn(
                    isTrigger
                      ? 'desk-nav-item'
                      : cn(
                          'flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors',
                          section === 'tickers'
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-transparent bg-transparent text-foreground hover:bg-muted',
                        ),
                  )}
                >
                  <TrendingUp className="size-4 shrink-0" />
                  <span className="leading-tight">
                    {isTrigger ? 'Momentum' : 'Tickers'}
                    <span
                      className={cn(
                        isTrigger ? 'desk-nav-sub' : 'block text-[11px] font-normal opacity-80',
                      )}
                    >
                      {isTrigger ? 'notable moves' : 'alert'}
                    </span>
                  </span>
                </button>
                {notificationApp === 'nineam' ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={section === 'news'}
                    onClick={() => setSection('news')}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors',
                      section === 'news'
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-transparent bg-transparent text-foreground hover:bg-muted',
                    )}
                  >
                    <Newspaper className="size-4 shrink-0" />
                    <span className="leading-tight">
                      News
                      <span className="block text-[11px] font-normal opacity-80">alert</span>
                    </span>
                  </button>
                ) : null}
                {notificationApp === 'nineam' ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={section === 'custom'}
                    onClick={() => setSection('custom')}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors',
                      section === 'custom'
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-transparent bg-transparent text-foreground hover:bg-muted',
                    )}
                  >
                    <PenLine className="size-4 shrink-0" />
                    <span className="leading-tight">
                      Custom
                      <span className="block text-[11px] font-normal opacity-80">alert</span>
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === 'users'}
                  onClick={() => setSection('users')}
                  className={cn(
                    isTrigger
                      ? 'desk-nav-item'
                      : cn(
                          'flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors',
                          section === 'users'
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-transparent bg-transparent text-foreground hover:bg-muted',
                        ),
                  )}
                >
                  <Users className="size-4 shrink-0" />
                  <span className="leading-tight">
                    {isTrigger ? 'Audience' : 'All users'}
                    <span
                      className={cn(
                        isTrigger ? 'desk-nav-sub' : 'block text-[11px] font-normal opacity-80',
                      )}
                    >
                      {isTrigger ? 'devices' : 'alertable devices'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === 'settings'}
                  onClick={() => setSection('settings')}
                  className={cn(
                    isTrigger
                      ? 'desk-nav-item'
                      : cn(
                          'flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors',
                          section === 'settings'
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-transparent bg-transparent text-foreground hover:bg-muted',
                        ),
                  )}
                >
                  <Settings className="size-4 shrink-0" />
                  <span className="leading-tight">
                    Settings
                    <span
                      className={cn(
                        isTrigger ? 'desk-nav-sub' : 'block text-[11px] font-normal opacity-80',
                      )}
                    >
                      version · build
                    </span>
                  </span>
                </button>

                {isTrigger ? (
                  <div className="mt-auto space-y-3 pt-6">
                    <div className="desk-panel p-3.5">
                      <p className="desk-section-label">Snapshot</p>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Instruments</span>
                          <span className="font-semibold tabular-nums">{tickers.length}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Devices on</span>
                          <span className="font-semibold tabular-nums">
                            {devices.filter((d) => d.enabled).length}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Universe</span>
                          <span className="font-semibold">Stocks</span>
                        </div>
                        <div className="border-t border-border/50 pt-2 space-y-2">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Gemini usage
                          </p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Spend</span>
                            <span className="font-semibold tabular-nums text-primary">
                              {geminiTotals?.cost_usd_display ||
                                formatUsdCompact(geminiTotals?.cost_usd) ||
                                '$0.000000'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Tokens</span>
                            <span className="font-semibold tabular-nums">
                              {(geminiTotals?.total_tokens || 0).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">In / out</span>
                            <span className="text-xs font-semibold tabular-nums">
                              {(geminiTotals?.prompt_tokens || 0).toLocaleString()} /{' '}
                              {(geminiTotals?.output_tokens || 0).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Dates tagged</span>
                            <span className="font-semibold tabular-nums">
                              {geminiTotals?.dates_with_gemini || 0}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void openUsagePopup('perplexity')}
                          className="w-full border-t border-border/50 pt-2 space-y-2 text-left transition hover:opacity-90"
                          title="Open Perplexity daily spend"
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Perplexity usage
                          </p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Spend</span>
                            <span className="font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                              {perplexityTotals?.total_cost_usd_display ||
                                formatUsdCompact(perplexityTotals?.total_cost_usd) ||
                                '$0.000000'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Token credits</span>
                            <span className="font-semibold tabular-nums">
                              {(perplexityTotals?.total_credits || 0).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Calls</span>
                            <span className="font-semibold tabular-nums">
                              {(perplexityTotals?.total_calls || 0).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-[10px] leading-snug text-muted-foreground">
                            Click for day-by-day breakdown
                          </p>
                        </button>
                        <div className="border-t border-border/50 pt-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Firecrawl</span>
                            <span
                              className="max-w-[7.5rem] truncate text-right text-xs font-semibold tabular-nums"
                              title={creditHint || undefined}
                            >
                              {firecrawlCredits?.remaining != null
                                ? firecrawlCredits.plan != null
                                  ? `${firecrawlCredits.remaining} / ${firecrawlCredits.plan}`
                                  : String(firecrawlCredits.remaining)
                                : creditHint
                                  ? creditHint
                                      .replace(/^Firecrawl balance:\s*/i, '')
                                      .replace(/^Firecrawl remaining:\s*/i, '')
                                      .replace(/\s*credits\.?$/i, '')
                                      .trim() || '—'
                                  : '—'}
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                            Remaining credits
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        {/* MAIN — tickers / news / custom */}
        <main
          className={cn(
            'flex min-h-0 min-w-0 flex-[7] flex-col overflow-hidden border-b lg:border-b-0 lg:border-r',
            isTrigger && 'border-border/50',
          )}
        >
          <div
            className={cn(
              'min-h-0 flex-1',
              section === 'tickers'
                ? 'flex flex-col overflow-hidden'
                : cn(
                    'overflow-y-auto',
                    isTrigger ? 'px-5 py-6 sm:px-8 sm:py-8' : 'px-4 py-5 sm:px-6 sm:py-6',
                  ),
            )}
          >
            {section === 'settings' ? (
              <>
                {/* Settings form → public.app_releases (ios | android | all) */}
                <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-1.5">
                    {isTrigger ? <p className="desk-section-label">Release</p> : null}
                    <h1
                      className={cn(
                        'font-semibold tracking-tight',
                        isTrigger ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl',
                      )}
                    >
                      Settings
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Manage force-update and latest version/build for each platform. Saves to
                      Supabase{' '}
                      <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                        public.app_releases
                      </code>{' '}
                      (<span className="font-mono">ios</span> ·{' '}
                      <span className="font-mono">android</span> ·{' '}
                      <span className="font-mono">all</span>).
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      disabled={appSettingsLoading || appSettingsSaving}
                      onClick={() => void loadAppSettings()}
                      className={isTrigger ? 'desk-action h-auto border-0' : undefined}
                    >
                      {appSettingsLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Reload
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      disabled={appSettingsLoading || appSettingsSaving}
                      onClick={() => void saveAppSettings()}
                      className={
                        isTrigger ? 'desk-action desk-action--primary h-auto border-0' : undefined
                      }
                    >
                      {appSettingsSaving ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      Save to Supabase
                    </Button>
                  </div>
                </div>

                {appSettingsNeedsSchema ? (
                  <div className="mb-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
                    Table <code className="rounded bg-background/60 px-1 py-0.5 text-xs">app_releases</code>{' '}
                    is missing or not readable. Confirm the table exists and RLS allows your
                    server key, then Reload.
                  </div>
                ) : null}
                {appSettingsNeedsServiceRole ? (
                  <div className="mb-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
                    <p className="font-medium">Save blocked by Supabase RLS</p>
                    <p className="mt-1 leading-6">
                      Your API is using the publishable/anon key (reads work; writes do not).
                      Add the <strong>service_role</strong> secret to{' '}
                      <code className="rounded bg-background/60 px-1 py-0.5 text-xs">.env.local</code>
                      :
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-background/70 px-3 py-2 text-[11px] leading-5">
{`SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here`}
                    </pre>
                    <p className="mt-2 text-xs leading-5 opacity-90">
                      Supabase Dashboard → Project Settings → API →{' '}
                      <code className="rounded bg-background/60 px-1">service_role</code> (secret).
                      Restart the API (<code className="rounded bg-background/60 px-1">npm run dev</code>),
                      then Save again. Never expose this key in the browser.
                    </p>
                  </div>
                ) : null}
                {appSettingsError ? (
                  <div className="mb-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {appSettingsError}
                  </div>
                ) : null}
                {appSettingsMessage ? (
                  <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
                    {appSettingsMessage}
                  </div>
                ) : null}

                <div
                  className={cn(
                    'max-w-2xl space-y-5 rounded-2xl border border-border/70 bg-card p-5 shadow-sm',
                    isTrigger && 'desk-panel border-0',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold tracking-tight">Platform release</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Editing row <span className="font-mono">id = {appReleasePlatform}</span>
                        {appReleases.length > 0 ? (
                          <>
                            {' '}
                            · {appReleases.length} row{appReleases.length === 1 ? '' : 's'} loaded
                          </>
                        ) : null}
                      </p>
                    </div>
                    {appSettingsLoading ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(['ios', 'android', 'all'] as const).map((platform) => {
                      const hasRow = appReleases.some((r) => r.id === platform)
                      const active = appReleasePlatform === platform
                      return (
                        <button
                          key={platform}
                          type="button"
                          disabled={appSettingsLoading || appSettingsSaving}
                          onClick={() => setAppReleasePlatform(platform)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                            active
                              ? 'border-foreground bg-foreground text-background'
                              : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                          )}
                        >
                          <span className="capitalize">{platform}</span>
                          {hasRow ? (
                            <span
                              className={cn(
                                'size-1.5 rounded-full',
                                active ? 'bg-background/80' : 'bg-emerald-500',
                              )}
                              title="Row exists"
                            />
                          ) : null}
                        </button>
                      )
                    })}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="app-latest-version">Latest version</Label>
                      <Input
                        id="app-latest-version"
                        value={appLatestVersion}
                        onChange={(e) => setAppLatestVersion(e.target.value)}
                        placeholder="e.g. 1.4.2"
                        disabled={appSettingsLoading || appSettingsSaving}
                        className="font-mono"
                        autoComplete="off"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Current store / binary version (latest_version).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="app-latest-build">Latest build</Label>
                      <Input
                        id="app-latest-build"
                        value={appLatestBuild}
                        onChange={(e) => setAppLatestBuild(e.target.value)}
                        placeholder="e.g. 184"
                        disabled={appSettingsLoading || appSettingsSaving}
                        className="font-mono"
                        autoComplete="off"
                        inputMode="numeric"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Build number / versionCode (latest_build).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="app-min-version">Minimum version</Label>
                      <Input
                        id="app-min-version"
                        value={appMinVersion}
                        onChange={(e) => setAppMinVersion(e.target.value)}
                        placeholder="e.g. 1.3.0"
                        disabled={appSettingsLoading || appSettingsSaving}
                        className="font-mono"
                        autoComplete="off"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Clients below this may be forced to update (min_version).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="app-min-build">Minimum build</Label>
                      <Input
                        id="app-min-build"
                        value={appMinBuild}
                        onChange={(e) => setAppMinBuild(e.target.value)}
                        placeholder="e.g. 150"
                        disabled={appSettingsLoading || appSettingsSaving}
                        className="font-mono"
                        autoComplete="off"
                        inputMode="numeric"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Minimum build integer (min_build).
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label htmlFor="app-force-update" className="text-sm">
                          Force update
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          Require clients below min version/build to update.
                        </p>
                      </div>
                      <Switch
                        id="app-force-update"
                        checked={appForceUpdate}
                        onCheckedChange={setAppForceUpdate}
                        disabled={appSettingsLoading || appSettingsSaving}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label htmlFor="app-check-eas" className="text-sm">
                          Check EAS update
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          Allow OTA / EAS update checks (check_eas_update).
                        </p>
                      </div>
                      <Switch
                        id="app-check-eas"
                        checked={appCheckEasUpdate}
                        onCheckedChange={setAppCheckEasUpdate}
                        disabled={appSettingsLoading || appSettingsSaving}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label htmlFor="app-release-enabled" className="text-sm">
                          Enabled
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          Whether this release row is active for the app.
                        </p>
                      </div>
                      <Switch
                        id="app-release-enabled"
                        checked={appReleaseEnabled}
                        onCheckedChange={setAppReleaseEnabled}
                        disabled={appSettingsLoading || appSettingsSaving}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="app-release-title">Update title</Label>
                    <Input
                      id="app-release-title"
                      value={appReleaseTitle}
                      onChange={(e) => setAppReleaseTitle(e.target.value)}
                      placeholder="Optional prompt title"
                      disabled={appSettingsLoading || appSettingsSaving}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="app-release-message">Update message</Label>
                    <Textarea
                      id="app-release-message"
                      value={appReleaseMessage}
                      onChange={(e) => setAppReleaseMessage(e.target.value)}
                      placeholder="Optional message shown when an update is required"
                      disabled={appSettingsLoading || appSettingsSaving}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="app-store-url">Store URL</Label>
                    <Input
                      id="app-store-url"
                      value={appStoreUrl}
                      onChange={(e) => setAppStoreUrl(e.target.value)}
                      placeholder="https://apps.apple.com/… or Play Store link"
                      disabled={appSettingsLoading || appSettingsSaving}
                      className="font-mono text-xs sm:text-sm"
                      autoComplete="off"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
                    <p className="text-xs text-muted-foreground">
                      {appSettingsUpdatedAt
                        ? `Last saved ${new Date(appSettingsUpdatedAt).toLocaleString()}`
                        : appReleases.some((r) => r.id === appReleasePlatform)
                          ? 'Loaded · not edited yet'
                          : 'No row yet — Save will create it'}
                    </p>
                    <Button
                      type="button"
                      disabled={appSettingsLoading || appSettingsSaving}
                      onClick={() => void saveAppSettings()}
                    >
                      {appSettingsSaving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      Update {appReleasePlatform}
                    </Button>
                  </div>
                </div>
              </>
            ) : section === 'users' ? (
              <>
                <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-1.5">
                    {isTrigger ? (
                      <p className="desk-section-label">Devices</p>
                    ) : null}
                    <h1
                      className={cn(
                        'font-semibold tracking-tight',
                        isTrigger ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl',
                      )}
                    >
                      {isTrigger ? 'Audience' : 'All alertable users'}
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Spreadsheet view of{' '}
                      <strong>{notificationApp === 'trigger' ? 'Trigger' : '9AM'}</strong>{' '}
                      devices. Columns: status, subscribed stocks, stopped stocks. Alerts only
                      go to devices still On / Partial.
                    </p>
                  </div>
                  <div className={cn('flex flex-wrap gap-2', isTrigger && 'gap-2.5')}>
                    {notificationApp === 'trigger' ? (
                      <Button
                        size="sm"
                        type="button"
                        disabled={
                          !devices.some((d) => d.enabled) || devicesLoading
                        }
                        onClick={() => openTriggerDigest()}
                        className={isTrigger ? 'desk-action desk-action--primary h-auto border-0' : undefined}
                      >
                        <BellRing className="size-3.5" />
                        Alert all Trigger users
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      disabled={devicesLoading}
                      onClick={() => void loadDevices()}
                      className={isTrigger ? 'desk-action h-auto border-0' : undefined}
                    >
                      {devicesLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Reload users
                    </Button>
                  </div>
                </div>

                {devicesError ? (
                  <div className="mb-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Users failed to load: {devicesError}
                  </div>
                ) : null}
                {digestMessage ? (
                  <div
                    className={cn(
                      'mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
                      digestIsError
                        ? 'border-destructive/35 bg-destructive/10 text-destructive'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
                    )}
                  >
                    <BellRing className="mt-0.5 size-4 shrink-0" />
                    <span>{digestMessage}</span>
                  </div>
                ) : null}

                <div className={cn('mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4', isTrigger && 'gap-4')}>
                  <div
                    className={cn(
                      'rounded-xl border bg-card p-4 shadow-sm',
                      isTrigger && 'desk-panel !rounded-2xl border-0 p-5 shadow-none',
                    )}
                  >
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Notifications on
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {devices.filter((d) => d.enabled).length}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'rounded-xl border bg-card p-4 shadow-sm',
                      isTrigger && 'desk-panel !rounded-2xl border-0 p-5 shadow-none',
                    )}
                  >
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Stopped
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-muted-foreground">
                      {devices.filter((d) => !d.enabled).length}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'rounded-xl border bg-card p-4 shadow-sm',
                      isTrigger && 'desk-panel !rounded-2xl border-0 p-5 shadow-none',
                    )}
                  >
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Pro · Crypto
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {devices.filter((device) => device.pro_crypto).length}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'rounded-xl border bg-card p-4 shadow-sm',
                      isTrigger && 'desk-panel !rounded-2xl border-0 p-5 shadow-none',
                    )}
                  >
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Active stock tickers
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {
                        new Set(
                          devices.flatMap((device) =>
                            (device.tickers || []).map((ticker) => ticker.toUpperCase()),
                          ),
                        ).size
                      }
                    </p>
                  </div>
                </div>

                {devicesLoading && !devices.length ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-12 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading audience…
                  </div>
                ) : null}

                {!devicesLoading && !devices.length ? (
                  <div className="rounded-xl border border-dashed px-4 py-12 text-center">
                    <Users className="mx-auto size-6 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">No devices found</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No {notificationApp === 'trigger' ? 'Trigger' : '9AM'} push tokens in
                      monitored tickers.
                    </p>
                  </div>
                ) : null}

                {devices.length > 0 ? (
                  <div
                    className={cn(
                      'overflow-hidden rounded-xl border border-border/70 bg-card',
                      isTrigger && 'desk-panel border-0',
                    )}
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-border/70 bg-muted/40 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                            <th className="sticky left-0 z-10 bg-muted/95 px-3 py-2.5 font-semibold backdrop-blur">
                              Device
                            </th>
                            <th className="px-3 py-2.5 font-semibold">Status</th>
                            <th className="px-3 py-2.5 font-semibold">
                              Subscribed
                              <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/80">
                                stocks
                              </span>
                            </th>
                            <th className="px-3 py-2.5 font-semibold">
                              Stopped
                              <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/80">
                                stocks
                              </span>
                            </th>
                            <th className="px-3 py-2.5 font-semibold">Pro</th>
                            {notificationApp === 'trigger' ? (
                              <th className="px-3 py-2.5 text-right font-semibold">Action</th>
                            ) : null}
                          </tr>
                        </thead>
                        <tbody>
                          {devices.map((device, rowIndex) => {
                            const token = device.expo_push_token
                            const maskedToken =
                              token.length > 28
                                ? `${token.slice(0, 16)}…${token.slice(-6)}`
                                : token
                            const status =
                              device.subscription_status || (device.enabled ? 'on' : 'off')
                            const isOn = status === 'on'
                            const isPartial = status === 'partial'
                            const isOff = status === 'off' || !device.enabled
                            const subscribed = device.tickers || []
                            const stopped = device.disabled_tickers || []
                            const rowBg =
                              rowIndex % 2 === 0 ? 'bg-background/40' : 'bg-muted/20'
                            return (
                              <tr
                                key={deviceKey(device)}
                                className={cn(
                                  'border-b border-border/50 transition-colors hover:bg-muted/40',
                                  rowBg,
                                  isOff && 'opacity-75',
                                )}
                              >
                                <td
                                  className={cn(
                                    'sticky left-0 z-10 max-w-[14rem] px-3 py-2.5 align-top backdrop-blur',
                                    rowBg,
                                  )}
                                >
                                  <p className="truncate font-mono text-[13px] font-semibold tracking-tight">
                                    {device.device_id || 'Unknown device'}
                                  </p>
                                  <p
                                    className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground"
                                    title={token}
                                  >
                                    {maskedToken}
                                  </p>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 align-top">
                                  {isOn ? (
                                    <Badge className="bg-emerald-500/12 text-emerald-800 dark:text-emerald-200">
                                      On
                                    </Badge>
                                  ) : isPartial ? (
                                    <Badge className="bg-amber-500/15 text-amber-900 dark:text-amber-100">
                                      Partial
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200"
                                    >
                                      Off
                                    </Badge>
                                  )}
                                </td>
                                <td className="max-w-[18rem] px-3 py-2.5 align-top">
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="tabular-nums text-xs font-semibold text-foreground">
                                      {subscribed.length}
                                    </span>
                                    {subscribed.length ? (
                                      <span
                                        className="min-w-0 truncate font-mono text-[11px] leading-5 text-foreground/85"
                                        title={subscribed.join(', ')}
                                      >
                                        {subscribed.join(' · ')}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-muted-foreground">—</span>
                                    )}
                                  </div>
                                </td>
                                <td className="max-w-[16rem] px-3 py-2.5 align-top">
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="tabular-nums text-xs font-semibold text-muted-foreground">
                                      {stopped.length}
                                    </span>
                                    {stopped.length ? (
                                      <span
                                        className="min-w-0 truncate font-mono text-[11px] leading-5 text-muted-foreground line-through"
                                        title={stopped.join(', ')}
                                      >
                                        {stopped.join(' · ')}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-muted-foreground">—</span>
                                    )}
                                  </div>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 align-top">
                                  {device.pro_crypto ? (
                                    <Badge
                                      className="gap-1 bg-violet-500/15 text-violet-900 dark:text-violet-100"
                                      title={
                                        device.crypto_tickers?.length
                                          ? device.crypto_tickers.join(', ')
                                          : 'Crypto pro'
                                      }
                                    >
                                      <Crown className="size-3" />
                                      Crypto
                                    </Badge>
                                  ) : (
                                    <span className="text-[11px] text-muted-foreground">—</span>
                                  )}
                                </td>
                                {notificationApp === 'trigger' ? (
                                  <td className="px-3 py-2.5 text-right align-top">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2.5 text-xs"
                                      disabled={isOff}
                                      onClick={() => openTriggerDigest(device)}
                                      title={
                                        isOff
                                          ? 'Device stopped notifications — cannot alert'
                                          : 'Send momentum digest to this device'
                                      }
                                    >
                                      <BellRing className="size-3.5" />
                                      Alert
                                    </Button>
                                  </td>
                                ) : null}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                      {devices.length} device{devices.length === 1 ? '' : 's'} ·{' '}
                      {devices.filter((d) => d.enabled).length} on ·{' '}
                      {devices.filter((d) => d.subscription_status === 'partial').length}{' '}
                      partial · {devices.filter((d) => !d.enabled).length} off
                    </div>
                  </div>
                ) : null}
              </>
            ) : section === 'custom' ? (
              <>
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                      Custom alert
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Write title + body, pick devices (select all or manual), then Send.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    disabled={devicesLoading}
                    onClick={() => void loadDevices()}
                  >
                    {devicesLoading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Reload devices
                  </Button>
                </div>

                {customMessage ? (
                  <div
                    className={cn(
                      'mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
                      customIsError
                        ? 'border-destructive/35 bg-destructive/10 text-destructive'
                        : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100',
                    )}
                  >
                    {customIsError ? (
                      <Bell className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <Check className="mt-0.5 size-4 shrink-0" />
                    )}
                    <span>{customMessage}</span>
                  </div>
                ) : null}

                {devicesError ? (
                  <div className="mb-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Devices failed to load: {devicesError}. Click Reload devices (API must be
                    running).
                  </div>
                ) : null}

                <div className="grid gap-4 xl:grid-cols-[1fr_1fr_16rem]">
                  {/* Editor */}
                  <section className="space-y-4 rounded-2xl border bg-card p-4 text-card-foreground shadow-sm sm:p-5">
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold tracking-tight">Compose</h2>
                      <p className="text-xs text-muted-foreground">
                        Line 1 = title · Line 2 = body
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="custom-title">Title (first line)</Label>
                      <Input
                        id="custom-title"
                        value={customTitle}
                        onChange={(e) => setCustomTitle(e.target.value)}
                        placeholder="e.g. AAPL +1.2% · Notable move"
                        maxLength={120}
                        className="font-medium"
                      />
                      <p className="text-[11px] text-muted-foreground">{customTitle.length}/120</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="custom-body">Body (second line)</Label>
                      <Textarea
                        id="custom-body"
                        value={customBody}
                        onChange={(e) => setCustomBody(e.target.value)}
                        placeholder="Full reason / message…"
                        rows={6}
                        maxLength={400}
                        className="min-h-[8rem] resize-y"
                      />
                      <p className="text-[11px] text-muted-foreground">{customBody.length}/400</p>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        disabled={
                          customSending ||
                          customSelectedDeviceKeys.length === 0 ||
                          !customTitle.trim() ||
                          !customBody.trim()
                        }
                        onClick={() => void handleCustomSend()}
                      >
                        {customSending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <BellRing className="size-4" />
                        )}
                        Send ({customSelectedDeviceKeys.length})
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={customSending || (!customTitle && !customBody)}
                        onClick={() => {
                          setCustomTitle('')
                          setCustomBody('')
                          setCustomMessage('')
                          setCustomIsError(false)
                          appendCustomLog('info', 'Composer cleared')
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </section>

                  {/* Live phone preview */}
                  <section className="space-y-3">
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold tracking-tight">Live preview</h2>
                      <p className="text-xs text-muted-foreground">Lock-screen style</p>
                    </div>
                    <div className="mx-auto w-full max-w-[320px]">
                      <div className="rounded-[2rem] border-[6px] border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950 p-3 shadow-2xl">
                        <div className="mb-8 flex items-center justify-between px-3 pt-1 text-[10px] font-medium text-white/80">
                          <span>9:41</span>
                          <span className="opacity-70">LTE</span>
                        </div>
                        <div className="rounded-2xl bg-white/95 p-3 text-neutral-900 shadow-lg dark:bg-neutral-800/95 dark:text-neutral-50">
                          <div className="mb-2 flex items-center gap-2">
                            <div className="flex size-6 items-center justify-center rounded-md bg-neutral-900 text-[10px] font-bold text-white dark:bg-white dark:text-neutral-900">
                              9
                            </div>
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                              9AM
                            </span>
                            <span className="ml-auto text-[10px] text-neutral-400">now</span>
                          </div>
                          <p
                            className={cn(
                              'text-[15px] font-semibold leading-snug',
                              previewTitleEmpty && 'italic text-neutral-400',
                            )}
                          >
                            {previewTitle}
                          </p>
                          <p
                            className={cn(
                              'mt-0.5 text-[13px] leading-snug text-neutral-600 dark:text-neutral-300',
                              previewBodyEmpty && 'italic text-neutral-400',
                            )}
                          >
                            {previewBody}
                          </p>
                        </div>
                        <p className="mt-6 pb-4 text-center text-[10px] text-white/40">
                          Preview only
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Devices column */}
                  <section className="flex max-h-[70vh] flex-col rounded-2xl border bg-card p-3 shadow-sm sm:p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold">Devices</h2>
                        <p className="text-[11px] text-muted-foreground">
                          {customSelectedDeviceKeys.length}/{devices.length} selected
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!devices.length}
                          onClick={() => selectAllDevices(setCustomSelectedDeviceKeys)}
                        >
                          Select all
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!customSelectedDeviceKeys.length}
                          onClick={() => clearDeviceSelection(setCustomSelectedDeviceKeys)}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                      {devicesLoading ? (
                        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Loading…
                        </div>
                      ) : null}
                      {!devicesLoading && !devices.length ? (
                        <p className="py-6 text-center text-xs text-muted-foreground">
                          No devices. Reload devices.
                        </p>
                      ) : null}
                      {devices.map((device) => {
                        const key = deviceKey(device)
                        const checked = customSelectedDeviceKeys.includes(key)
                        return (
                          <label
                            key={key}
                            className={cn(
                              'flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-sm transition-colors',
                              checked
                                ? 'border-foreground bg-muted/50'
                                : 'border-border hover:bg-muted/30',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-4 accent-foreground"
                              checked={checked}
                              onChange={() =>
                                toggleDeviceKey(
                                  key,
                                  customSelectedDeviceKeys,
                                  setCustomSelectedDeviceKeys,
                                )
                              }
                            />
                            <span className="min-w-0">
                              <span className="block font-medium font-mono text-xs">
                                {device.device_id || 'unknown'}
                              </span>
                              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                {device.tickers?.slice(0, 6).join(', ') || 'no tickers'}
                                {(device.tickers?.length || 0) > 6 ? '…' : ''}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </section>
                </div>
              </>
            ) : section === 'news' ? (
              <>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                      News alert
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Latest Yahoo Finance news for your watchlist tickers · pick a
                      story · pick devices · Send
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {newsTotal != null
                        ? `${newsTotal} latest articles · Yahoo Finance · ≤14 days · `
                        : null}
                      {tickers.length
                        ? `${tickers.length} watchlist ticker${tickers.length === 1 ? '' : 's'} · `
                        : null}
                      {selectedDeviceKeys.length}/{devices.length} devices selected
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      disabled={devicesLoading}
                      onClick={() => void loadDevices()}
                    >
                      {devicesLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Reload devices
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      disabled={newsLoading}
                      onClick={() => void loadNews()}
                    >
                      {newsLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Reload news
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      disabled={
                        newsSending ||
                        !selectedArticleId ||
                        selectedDeviceKeys.length === 0
                      }
                      onClick={() => void handleNewsSend()}
                    >
                      {newsSending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <BellRing className="size-3.5" />
                      )}
                      Send ({selectedDeviceKeys.length})
                    </Button>
                  </div>
                </div>

                {newsAlertMessage ? (
                  <div
                    className={cn(
                      'mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
                      newsAlertIsError
                        ? 'border-destructive/35 bg-destructive/10 text-destructive'
                        : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100',
                    )}
                  >
                    <BellRing className="mt-0.5 size-4 shrink-0" />
                    <span>{newsAlertMessage}</span>
                  </div>
                ) : null}

                {newsError ? (
                  <div className="mb-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    News failed to load: {newsError}
                  </div>
                ) : null}
                {devicesError ? (
                  <div className="mb-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Devices failed to load: {devicesError}
                  </div>
                ) : null}

                <div className="grid min-h-0 gap-4 lg:grid-cols-[1fr_18rem]">
                  {/* NEWS column */}
                  <section className="flex min-h-0 flex-col rounded-2xl border bg-card shadow-sm">
                    <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
                      <h2 className="text-sm font-semibold">
                        Yahoo Finance · watchlist
                      </h2>
                      <span className="text-xs text-muted-foreground">
                        {news.length}
                        {newsTotal != null ? ` / ${newsTotal}` : ''} latest
                      </span>
                    </div>
                    <div className="min-h-0 max-h-[calc(100svh-16rem)] flex-1 space-y-2 overflow-y-auto p-3">
                      {newsLoading && !news.length ? (
                        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Fetching latest Yahoo Finance news for watchlist…
                        </div>
                      ) : null}
                      {!newsLoading && !news.length && !newsError ? (
                        <div className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                          No recent Yahoo news for your watchlist (last 14 days).
                          Click Reload news, or add more tickers.
                        </div>
                      ) : null}
                      {news.map((article) => {
                        const selected = selectedArticleId === article.id
                        const impact =
                          article.impact_body ||
                          (article.ticker_sides || [])
                            .map((s) => {
                              const arrow =
                                s.arrow ??
                                (s.side === 'bullish'
                                  ? '↑'
                                  : s.side === 'bearish'
                                    ? '↓'
                                    : '')
                              return arrow ? `${s.ticker} ${arrow}` : s.ticker
                            })
                            .join(' · ')
                        return (
                          <button
                            key={article.id}
                            type="button"
                            onClick={() => setSelectedArticleId(article.id)}
                            className={cn(
                              'flex w-full gap-3 rounded-xl border p-3 text-left transition-colors',
                              selected
                                ? 'border-foreground bg-muted/60 ring-1 ring-foreground/20'
                                : 'border-border bg-background/40 hover:bg-muted/40',
                            )}
                          >
                            {article.image_url ? (
                              <img
                                src={article.image_url}
                                alt=""
                                className="size-14 shrink-0 rounded-lg object-cover bg-muted"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
                                no img
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                {article.source_name ? (
                                  <Badge variant="secondary" className="text-[10px]">
                                    {article.source_name}
                                  </Badge>
                                ) : null}
                                {article.published_at ? (
                                  <span>
                                    {new Date(article.published_at).toLocaleString()}
                                  </span>
                                ) : null}
                              </div>
                              {impact ? (
                                <p className="mt-1 font-mono text-[11px] font-semibold leading-snug">
                                  {impact}
                                </p>
                              ) : null}
                              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                                {article.title}
                              </p>
                            </div>
                          </button>
                        )
                      })}
                      {newsHasMore ? (
                        <div className="flex justify-center py-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={newsLoadingMore}
                            onClick={() => void loadNews({ append: true })}
                          >
                            {newsLoadingMore ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : null}
                            Load more
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {/* DEVICES column */}
                  <section className="flex max-h-[calc(100svh-16rem)] flex-col rounded-2xl border bg-card shadow-sm">
                    <div className="shrink-0 space-y-2 border-b px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold">Devices</h2>
                        <span className="text-[11px] text-muted-foreground">
                          {selectedDeviceKeys.length}/{devices.length}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          disabled={!devices.length}
                          onClick={() => selectAllDevices(setSelectedDeviceKeys)}
                        >
                          Select all
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs"
                          disabled={!selectedDeviceKeys.length}
                          onClick={() => clearDeviceSelection(setSelectedDeviceKeys)}
                        >
                          Clear
                        </Button>
                      </div>
                      <Button
                        type="button"
                        className="w-full"
                        disabled={
                          newsSending ||
                          !selectedArticleId ||
                          selectedDeviceKeys.length === 0
                        }
                        onClick={() => void handleNewsSend()}
                      >
                        {newsSending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <BellRing className="size-4" />
                        )}
                        Send to {selectedDeviceKeys.length || 0}
                      </Button>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                      {devicesLoading ? (
                        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Loading devices…
                        </div>
                      ) : null}
                      {!devicesLoading && !devices.length ? (
                        <p className="py-8 text-center text-xs text-muted-foreground">
                          No devices with notifications on.
                        </p>
                      ) : null}
                      {devices.map((device) => {
                        const key = deviceKey(device)
                        const checked = selectedDeviceKeys.includes(key)
                        return (
                          <label
                            key={key}
                            className={cn(
                              'flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-sm transition-colors',
                              checked
                                ? 'border-foreground bg-muted/50'
                                : 'border-border hover:bg-muted/30',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-4 accent-foreground"
                              checked={checked}
                              onChange={() =>
                                toggleDeviceKey(key, selectedDeviceKeys, setSelectedDeviceKeys)
                              }
                            />
                            <span className="min-w-0">
                              <span className="block font-mono text-xs font-medium">
                                {device.device_id || 'unknown'}
                              </span>
                              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                {device.tickers?.length
                                  ? device.tickers.slice(0, 8).join(', ')
                                  : 'no tickers'}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </section>
                </div>
              </>
            ) : (
              <>
            {listError ? (
              <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:px-5">
                {listError}
              </div>
            ) : null}

            {/* 2-column: vertical ticker list | detail data */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Column 1 — vertical ticker list */}
              <aside
                className={cn(
                  'flex w-56 shrink-0 flex-col overflow-hidden border-r sm:w-64 md:w-72 lg:w-80',
                  isTrigger ? 'desk-watchlist' : 'border-border bg-muted/15',
                )}
              >
                <div
                  className={cn(
                    'shrink-0 px-3 py-3',
                    isTrigger ? 'border-b border-[color:var(--desk-hairline)]' : 'border-b border-border/60',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className={cn(
                          isTrigger
                            ? 'desk-section-label'
                            : 'text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground',
                        )}
                      >
                        Watchlist
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {stocksListTab === 'extreme'
                          ? extremeMoversLoading && !extremeMovers.length
                            ? 'Loading Yahoo…'
                            : `${filteredExtremeMovers.length} ${extremeDirectionTab}`
                          : stocksListTab === 'pinned'
                            ? `${extremePinned.length} pinned`
                            : listLoading && !filteredTickers.length
                              ? 'Loading…'
                              : `${filteredTickers.length} ticker${filteredTickers.length === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {stocksListTab === 'extreme' ? (
                        <button
                          type="button"
                          title="Refresh extreme movers from Yahoo"
                          aria-label="Refresh extreme movers"
                          disabled={extremeMoversLoading}
                          onClick={() => void loadExtremeMovers()}
                          className="inline-flex size-8 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          {extremeMoversLoading ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="size-3.5" />
                          )}
                        </button>
                      ) : stocksListTab === 'users' ? (
                        <>
                          <button
                            type="button"
                            title="Sort by largest live percentage movement"
                            aria-label="Sort by percentage movement"
                            aria-pressed={
                              tickerSort === 'movement' ||
                              tickerSort === 'movement_pos_to_neg' ||
                              tickerSort === 'movement_neg_to_pos'
                            }
                            onClick={() => updateTickerSort('movement')}
                            className={cn(
                              'inline-flex size-8 items-center justify-center rounded-lg border transition-colors',
                              tickerSort === 'movement' ||
                                tickerSort === 'movement_pos_to_neg' ||
                                tickerSort === 'movement_neg_to_pos'
                                ? isTrigger
                                  ? 'border-primary/30 bg-primary text-primary-foreground'
                                  : 'border-foreground bg-foreground text-background'
                                : 'border-border/70 bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                          >
                            <TrendingUp className="size-3.5" />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              title={`Sort: ${TICKER_SORT_OPTIONS.find((o) => o.id === tickerSort)?.label || 'Sort'}`}
                              aria-label="Sort tickers"
                              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <ArrowUpDown className="size-3.5" />
                            </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                            {TICKER_SORT_OPTIONS.map((option) => (
                              <DropdownMenuItem
                                key={option.id}
                                onClick={() => updateTickerSort(option.id)}
                                className={cn(tickerSort === option.id && 'bg-muted font-medium')}
                              >
                                {option.label}
                              </DropdownMenuItem>
                            ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Users · Extreme · Pinned — Extreme never writes to Users */}
                  <div
                    className={cn(
                      'mt-2.5',
                      isTrigger
                        ? 'desk-segment'
                        : 'grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-background/70 p-0.5',
                    )}
                    role="tablist"
                    aria-label="Stocks list mode"
                  >
                    {(
                      [
                        { id: 'users' as const, label: 'Users' },
                        { id: 'extreme' as const, label: 'Extreme' },
                        { id: 'pinned' as const, label: 'Pinned' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={stocksListTab === tab.id}
                        onClick={() => setStocksListTab(tab.id)}
                        className={
                          isTrigger
                            ? undefined
                            : cn(
                                'rounded-md px-1.5 py-1.5 text-[10px] font-semibold transition-colors sm:text-[11px]',
                                stocksListTab === tab.id
                                  ? 'bg-foreground text-background shadow-sm'
                                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                              )
                        }
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {stocksListTab === 'extreme' ? (
                    <div className="mt-1.5 space-y-1.5">
                      <div
                        className="grid grid-cols-2 gap-1 rounded-lg border border-border/60 bg-background/70 p-0.5"
                        role="tablist"
                        aria-label="Extreme direction"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={extremeDirectionTab === 'positive'}
                          onClick={() => setExtremeDirectionTab('positive')}
                          className={cn(
                            'rounded-md px-1.5 py-1.5 text-[10px] font-semibold transition-colors',
                            extremeDirectionTab === 'positive'
                              ? isTrigger
                                ? 'bg-[color:var(--desk-up-soft)] text-[color:var(--desk-up)] shadow-sm'
                                : 'bg-emerald-600 text-white shadow-sm dark:bg-emerald-500'
                              : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                          )}
                        >
                          Positive
                          <span className="ml-1 tabular-nums opacity-80">
                            {extremePositiveCount}
                          </span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={extremeDirectionTab === 'negative'}
                          onClick={() => setExtremeDirectionTab('negative')}
                          className={cn(
                            'rounded-md px-1.5 py-1.5 text-[10px] font-semibold transition-colors',
                            extremeDirectionTab === 'negative'
                              ? isTrigger
                                ? 'bg-[color:var(--desk-down-soft)] text-[color:var(--desk-down)] shadow-sm'
                                : 'bg-red-600 text-white shadow-sm dark:bg-red-500'
                              : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                          )}
                        >
                          Negative
                          <span className="ml-1 tabular-nums opacity-80">
                            {extremeNegativeCount}
                          </span>
                        </button>
                      </div>
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        Yahoo top {extremeDirectionTab === 'positive' ? 'gainers' : 'losers'} ·
                        ≥10%
                        {extremeMoversFetchedAt
                          ? ` · ${new Date(extremeMoversFetchedAt).toLocaleTimeString()}`
                          : ''}
                      </p>
                    </div>
                  ) : null}
                  {stocksListTab === 'pinned' ? (
                    <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                      From Extreme · not Users
                    </p>
                  ) : null}
                </div>
                <div
                  className={cn(
                    'min-h-0 flex-1 overflow-y-auto',
                    isTrigger ? 'space-y-0.5 p-2' : 'space-y-0.5 p-1.5',
                  )}
                  role="tablist"
                  aria-label={
                    stocksListTab === 'extreme'
                      ? `Extreme ${extremeDirectionTab} movers`
                      : stocksListTab === 'pinned'
                        ? 'Pinned extreme'
                        : 'Stock tickers'
                  }
                  aria-orientation="vertical"
                >
                  {stocksListTab === 'extreme' ? (
                    <>
                      {extremeMoversLoading && !extremeMovers.length ? (
                        <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Loading Yahoo…
                        </div>
                      ) : null}
                      {extremeMoversError ? (
                        <div className="space-y-2 px-2 py-3">
                          <p className="text-xs text-destructive">{extremeMoversError}</p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 w-full text-[11px]"
                            onClick={() => void loadExtremeMovers()}
                          >
                            Retry
                          </Button>
                        </div>
                      ) : null}
                      {!extremeMoversLoading &&
                      !extremeMoversError &&
                      extremeMovers.length > 0 &&
                      !filteredExtremeMovers.length ? (
                        <p className="px-2 py-6 text-xs text-muted-foreground">
                          No Yahoo top {extremeDirectionTab === 'positive' ? 'gainers' : 'losers'}{' '}
                          with ≥10% right now.
                        </p>
                      ) : null}
                      {!extremeMoversLoading && !extremeMoversError && !extremeMovers.length ? (
                        <p className="px-2 py-6 text-xs text-muted-foreground">
                          No Yahoo Day Gainers / Day Losers with ≥10% right now. Retry later in
                          the session.
                        </p>
                      ) : null}
                      {filteredExtremeMovers.map((item) => {
                        const symbol = item.ticker
                        const selected = symbol === activeTicker
                        const isPinned = extremePinnedSet.has(symbol)
                        const livePercent = formatLivePercent(item.regularMarketChangePercent)
                        const livePrice = formatProviderPrice(
                          item.regularMarketPrice,
                          item.currency || 'USD',
                        )
                        const liveDown = item.regularMarketChangePercent < 0
                        const liveUp = item.regularMarketChangePercent > 0
                        return (
                          <div
                            key={symbol}
                            className={cn(
                              'flex w-full items-start gap-1 transition-colors',
                              isTrigger
                                ? cn('desk-row px-1 py-0.5', selected && 'is-selected')
                                : cn(
                                    'rounded-xl px-1 py-1',
                                    selected
                                      ? 'bg-foreground text-background'
                                      : 'text-foreground hover:bg-muted/80',
                                  ),
                            )}
                          >
                            <button
                              type="button"
                              role="tab"
                              aria-selected={selected}
                              onClick={() => {
                                selectTickerByUser(symbol)
                                // Seed quote from Yahoo screener so detail shows immediately (no Users add).
                                setLiveQuotes((prev) => ({
                                  ...prev,
                                  [symbol]: {
                                    ...(prev[symbol] || {}),
                                    symbol,
                                    shortName: item.company_name || symbol,
                                    regularMarketPrice: item.regularMarketPrice,
                                    regularMarketChange: item.regularMarketChange,
                                    regularMarketChangePercent: item.regularMarketChangePercent,
                                    regularMarketPreviousClose: null,
                                    currency: item.currency || 'USD',
                                    marketState: item.marketState || null,
                                    exchange: item.exchange || null,
                                  },
                                }))
                              }}
                              title={`${symbol} · ${livePercent || ''} · ${item.company_name} · view only`}
                              className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm"
                            >
                              <TickerLogoMark
                                symbol={symbol}
                                selected={isTrigger ? false : selected}
                                size={isTrigger ? 28 : 22}
                                customSrc={customLogos[symbol] || null}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className={cn('tracking-tight', isTrigger ? 'desk-sym' : 'font-semibold')}>{symbol}</span>
                                  {livePrice ? (
                                    <span
                                      className={cn(
                                        isTrigger
                                          ? 'desk-price'
                                          : cn(
                                              'text-[13px] font-semibold tabular-nums leading-none',
                                              selected ? 'text-background/85' : 'text-foreground/80',
                                            ),
                                      )}
                                    >
                                      {livePrice}
                                    </span>
                                  ) : null}
                                  {livePercent ? (
                                    <span
                                      className={cn(
                                        isTrigger
                                          ? cn(
                                              'desk-pct',
                                              liveDown && 'desk-down',
                                              liveUp && 'desk-up',
                                              !liveDown && !liveUp && 'text-muted-foreground',
                                            )
                                          : cn(
                                              'text-[13px] font-semibold tabular-nums leading-none',
                                              selected
                                                ? liveDown
                                                  ? 'text-red-200'
                                                  : liveUp
                                                    ? 'text-emerald-200'
                                                    : 'text-background/75'
                                                : liveDown
                                                  ? 'text-red-600 dark:text-red-400'
                                                  : liveUp
                                                    ? 'text-emerald-700 dark:text-emerald-400'
                                                    : 'text-muted-foreground',
                                            ),
                                      )}
                                    >
                                      {livePercent}
                                    </span>
                                  ) : null}
                                </div>
                                <p
                                  className={cn(
                                    'mt-0.5 truncate text-[10px]',
                                    isTrigger
                                      ? 'text-muted-foreground'
                                      : selected
                                        ? 'text-background/65'
                                        : 'text-muted-foreground',
                                  )}
                                >
                                  {item.company_name}
                                </p>
                              </div>
                            </button>
                            <button
                              type="button"
                              title={isPinned ? 'Unpin' : 'Pin (goes to Pinned · not Users)'}
                              aria-label={isPinned ? `Unpin ${symbol}` : `Pin ${symbol}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                togglePinExtreme(item)
                              }}
                              className={cn(
                                'mt-1.5 mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
                                isTrigger
                                  ? isPinned
                                    ? 'text-primary hover:bg-primary/10'
                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                  : selected
                                    ? 'text-background/80 hover:bg-background/15 hover:text-background'
                                    : isPinned
                                      ? 'text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'
                                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                              )}
                            >
                              <Bookmark
                                className={cn('size-3.5', isPinned && 'fill-current')}
                              />
                            </button>
                          </div>
                        )
                      })}
                    </>
                  ) : stocksListTab === 'pinned' ? (
                    <>
                      {!extremePinned.length ? (
                        <p className="px-2 py-6 text-xs text-muted-foreground">
                          Nothing pinned yet. On Extreme, tap the bookmark — one click. Never goes
                          to Users.
                        </p>
                      ) : null}
                      {extremePinned.map((item) => {
                        const symbol = item.ticker
                        const selected = symbol === activeTicker
                        const liveQuote = liveQuotes[symbol]
                        const liveValues = currentMarketQuoteValues(liveQuote)
                        const livePercent =
                          formatLivePercent(liveValues.percent) ||
                          formatLivePercent(item.change_percent ?? null)
                        const livePrice = formatProviderPrice(
                          liveValues.price,
                          liveQuote?.currency || item.currency || 'USD',
                        )
                        const pct =
                          liveValues.percent ??
                          (item.change_percent != null ? item.change_percent : null)
                        const liveDown = (pct ?? 0) < 0
                        const liveUp = (pct ?? 0) > 0
                        return (
                          <div
                            key={`${symbol}-${item.pinned_at}`}
                            className={cn(
                              'flex w-full items-start gap-1 transition-colors',
                              isTrigger
                                ? cn('desk-row px-1 py-0.5', selected && 'is-selected')
                                : cn(
                                    'rounded-xl px-1 py-1',
                                    selected
                                      ? 'bg-foreground text-background'
                                      : 'text-foreground hover:bg-muted/80',
                                  ),
                            )}
                          >
                            <button
                              type="button"
                              role="tab"
                              aria-selected={selected}
                              onClick={() => selectTickerByUser(symbol)}
                              title={`${symbol} · pinned`}
                              className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm"
                            >
                              <TickerLogoMark
                                symbol={symbol}
                                selected={isTrigger ? false : selected}
                                size={isTrigger ? 28 : 22}
                                customSrc={customLogos[symbol] || null}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className={cn('tracking-tight', isTrigger ? 'desk-sym' : 'font-semibold')}>{symbol}</span>
                                  {livePrice ? (
                                    <span
                                      className={cn(
                                        isTrigger
                                          ? 'desk-price'
                                          : cn(
                                              'text-[13px] font-semibold tabular-nums leading-none',
                                              selected ? 'text-background/85' : 'text-foreground/80',
                                            ),
                                      )}
                                    >
                                      {livePrice}
                                    </span>
                                  ) : null}
                                  {livePercent ? (
                                    <span
                                      className={cn(
                                        isTrigger
                                          ? cn(
                                              'desk-pct',
                                              liveDown && 'desk-down',
                                              liveUp && 'desk-up',
                                              !liveDown && !liveUp && 'text-muted-foreground',
                                            )
                                          : cn(
                                              'text-[13px] font-semibold tabular-nums leading-none',
                                              selected
                                                ? liveDown
                                                  ? 'text-red-200'
                                                  : liveUp
                                                    ? 'text-emerald-200'
                                                    : 'text-background/75'
                                                : liveDown
                                                  ? 'text-red-600 dark:text-red-400'
                                                  : liveUp
                                                    ? 'text-emerald-700 dark:text-emerald-400'
                                                    : 'text-muted-foreground',
                                            ),
                                      )}
                                    >
                                      {livePercent}
                                    </span>
                                  ) : null}
                                </div>
                                <p
                                  className={cn(
                                    'mt-0.5 truncate text-[10px]',
                                    isTrigger
                                      ? 'text-muted-foreground'
                                      : selected
                                        ? 'text-background/55'
                                        : 'text-muted-foreground',
                                  )}
                                >
                                  {item.company_name}
                                </p>
                              </div>
                            </button>
                            <button
                              type="button"
                              title="Unpin"
                              aria-label={`Unpin ${symbol}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                togglePinExtreme(item)
                              }}
                              className={cn(
                                'mt-1.5 mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
                                isTrigger
                                  ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                  : selected
                                    ? 'text-background/80 hover:bg-background/15 hover:text-background'
                                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                              )}
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        )
                      })}
                    </>
                  ) : (
                    <>
                  {listLoading && !tickers.length ? (
                    <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Loading…
                    </div>
                  ) : null}
                  {!listLoading && !tickers.length ? (
                    <p className="px-2 py-6 text-xs text-muted-foreground">
                      No equity rows in monitored tickers. Search below to add from Yahoo.
                    </p>
                  ) : null}
                  {!listLoading && tickers.length > 0 && !filteredTickers.length ? (
                    <p className="px-2 py-4 text-xs text-muted-foreground">
                      No match in your list. Use Yahoo results below to add.
                    </p>
                  ) : null}
                  {filteredTickers.map((item) => {
                    const selected = item.ticker === activeTicker
                    const busy = Boolean(tabState[item.ticker]?.loading)
                    const watchers = item.subscriber_count ?? 0
                    const liveQuote = liveQuotes[item.ticker.toUpperCase()]
                    const liveValues = currentMarketQuoteValues(liveQuote)
                    const livePrice = formatProviderPrice(
                      liveValues.price,
                      liveQuote?.currency || 'USD',
                    )
                    const livePercent = formatLivePercent(liveValues.percent)
                    const liveDown = (liveValues.percent ?? 0) < 0
                    const liveUp = (liveValues.percent ?? 0) > 0
                    return (
                      <button
                        key={item.ticker}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => selectTickerByUser(item.ticker)}
                        title={`${item.ticker} · ${watchers} watching`}
                        className={cn(
                          isTrigger
                            ? cn('desk-row overflow-hidden', selected && 'is-selected')
                            : cn(
                                'flex w-full min-w-0 items-start gap-2 overflow-hidden rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors',
                                selected
                                  ? 'bg-foreground text-background'
                                  : 'text-foreground hover:bg-muted/80',
                              ),
                        )}
                      >
                        <TickerLogoMark
                          symbol={item.ticker}
                          selected={isTrigger ? false : selected}
                          size={isTrigger ? 28 : 22}
                          customSrc={customLogos[item.ticker] || null}
                        />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className={cn('shrink-0 tracking-tight', isTrigger ? 'desk-sym' : 'font-semibold')}>
                              {item.ticker}
                            </span>
                            {livePrice ? (
                              <span
                                className={cn(
                                  isTrigger
                                    ? 'desk-price'
                                    : cn(
                                        'text-[13px] font-semibold tabular-nums leading-none',
                                        selected ? 'text-background/85' : 'text-foreground/80',
                                      ),
                                )}
                                title={`${liveValues.session} price from Yahoo · refreshes every 5 seconds`}
                              >
                                {livePrice}
                              </span>
                            ) : null}
                            {livePercent ? (
                              <span
                                className={cn(
                                  isTrigger
                                    ? cn(
                                        'desk-pct',
                                        liveDown && 'desk-down',
                                        liveUp && 'desk-up',
                                        !liveDown && !liveUp && 'text-muted-foreground',
                                      )
                                    : cn(
                                        'text-[13px] font-semibold tabular-nums leading-none',
                                        selected
                                          ? liveDown
                                            ? 'text-red-200'
                                            : liveUp
                                              ? 'text-emerald-200'
                                              : 'text-background/75'
                                          : liveDown
                                            ? 'text-red-600 dark:text-red-400'
                                            : liveUp
                                              ? 'text-emerald-700 dark:text-emerald-400'
                                              : 'text-muted-foreground',
                                      ),
                                )}
                                title={`${liveValues.session} change from Yahoo · refreshes every 5 seconds`}
                              >
                                {livePercent}
                              </span>
                            ) : null}
                            {busy ? (
                              <Loader2 className="size-3 animate-spin opacity-80" />
                            ) : null}
                          </div>
                          {isTrigger && item.company_name && item.company_name !== item.ticker ? (
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {item.company_name}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={cn(
                            isTrigger
                              ? 'desk-count'
                              : cn(
                                  'mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                                  selected
                                    ? 'bg-background/15 text-background'
                                    : 'bg-muted text-muted-foreground',
                                ),
                          )}
                          title={`${watchers} user(s) monitoring`}
                        >
                          {watchers}
                        </span>
                      </button>
                    )
                  })}
                    </>
                  )}
                </div>

                {/* Yahoo search + add — Users list only (real subscribers / never Extreme pin) */}
                {stocksListTab === 'users' ? (
                <div
                  ref={tickerSearchRef}
                  className={cn(
                    'relative shrink-0 p-2.5',
                    isTrigger
                      ? 'border-t border-[color:var(--desk-hairline)] bg-card/80'
                      : 'border-t border-border/60 bg-background/80',
                  )}
                >
                  {tickerSearchOpen && tickerSearchQuery.trim() ? (
                    <div className="absolute inset-x-2 bottom-full z-30 mb-1 max-h-56 overflow-y-auto rounded-xl border border-border/70 bg-popover p-1 shadow-lg">
                      {tickerSearchLoading ? (
                        <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          Searching Yahoo…
                        </div>
                      ) : null}
                      {!tickerSearchLoading && !tickerSearchResults.length ? (
                        <p className="px-2.5 py-2 text-xs text-muted-foreground">
                          No Yahoo matches. Try another symbol or name.
                        </p>
                      ) : null}
                      {tickerSearchResults.map((row) => {
                        const symbol = String(row.ticker || '').toUpperCase()
                        const inList = monitoredTickerSet.has(symbol)
                        const adding = tickerAddBusy === symbol
                        return (
                          <div
                            key={`${symbol}-${row.exchange || ''}-${row.companyName || ''}`}
                            className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-muted/70"
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 rounded-md px-1 py-1 text-left"
                              onClick={() => {
                                if (inList) {
                                  selectTickerByUser(symbol)
                                  setTickerSearchQuery('')
                                  setTickerSearchOpen(false)
                                } else {
                                  void addMonitoredTicker(symbol, row.companyName)
                                }
                              }}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold tracking-tight">
                                  {symbol}
                                </span>
                                {inList ? (
                                  <span className="rounded bg-emerald-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                    In list
                                  </span>
                                ) : null}
                              </div>
                              <p className="truncate text-[10px] text-muted-foreground">
                                {[row.companyName, row.exchange, row.quoteType]
                                  .filter(Boolean)
                                  .join(' · ') || 'Yahoo Finance'}
                              </p>
                            </button>
                            {inList ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 shrink-0 px-2 text-[10px]"
                                onClick={() => {
                                  selectTickerByUser(symbol)
                                  setTickerSearchQuery('')
                                  setTickerSearchOpen(false)
                                }}
                              >
                                Open
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="outline"
                                className="size-7 shrink-0"
                                disabled={adding || Boolean(tickerAddBusy)}
                                title={`Add ${symbol} to monitored stocks`}
                                aria-label={`Add ${symbol}`}
                                onClick={() => void addMonitoredTicker(symbol, row.companyName)}
                              >
                                {adding ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Plus className="size-3.5" />
                                )}
                              </Button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={tickerSearchQuery}
                      onChange={(e) => {
                        setTickerSearchQuery(e.target.value)
                        setTickerSearchOpen(true)
                      }}
                      onFocus={() => setTickerSearchOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setTickerSearchOpen(false)
                          ;(e.target as HTMLInputElement).blur()
                        }
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const q = tickerSearchQuery.trim()
                          if (!q) return
                          const exact = tickerSearchResults.find(
                            (r) => r.ticker.toUpperCase() === q.toUpperCase(),
                          )
                          const first = exact || tickerSearchResults[0]
                          if (first) {
                            void addMonitoredTicker(first.ticker, first.companyName)
                          } else if (/^[A-Za-z0-9.^=_-]{1,12}$/.test(q)) {
                            void addMonitoredTicker(q.toUpperCase(), q.toUpperCase())
                          }
                        }
                      }}
                      placeholder="Search Yahoo…"
                      className="h-8 pl-7 pr-2 text-xs"
                      aria-label="Search Yahoo Finance and add ticker"
                    />
                  </div>
                </div>
                ) : null}
              </aside>

              {/* Column 2 — selected ticker data */}
              <div
                className={cn(
                  'min-h-0 min-w-0 flex-1 overflow-y-auto',
                  isTrigger ? 'px-5 py-5 sm:px-6 sm:py-6' : 'px-4 py-4 sm:px-5 sm:py-5',
                )}
              >
            {activeTicker ? (
              <section className={cn(isTrigger ? 'space-y-4' : 'space-y-5')}>
                {/* Ticker header card */}
                <div className={cn(isTrigger ? 'desk-panel p-4 sm:p-5' : 'rounded-2xl border border-border/70 bg-card/40 p-4 shadow-sm sm:p-5')}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    {/* Identity + quote */}
                    <div className="min-w-0 flex-1 space-y-3.5">
                      <div className="flex min-w-0 flex-wrap items-start gap-3 sm:gap-4">
                        <TickerLogoMark
                          symbol={activeTicker}
                          size={isTrigger ? 48 : 40}
                          customSrc={customLogos[activeTicker] || null}
                          onClick={(e) => {
                            e.stopPropagation()
                            openLogoReplaceDialog(
                              activeTicker,
                              activeMeta?.company_name || null,
                            )
                          }}
                          className="mt-0.5 shrink-0 shadow-sm ring-1 ring-border/60"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h2
                              className={cn(
                                'shrink-0 font-semibold tracking-tight text-foreground',
                                isTrigger ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl',
                              )}
                            >
                              {activeTicker}
                            </h2>
                            {extremePinnedSet.has(activeTicker.toUpperCase()) ? (
                              <Badge
                                variant="outline"
                                className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100"
                                title={
                                  stocksListTab === 'users' &&
                                  (activeMeta?.subscriber_count ?? 0) > 0
                                    ? 'Also bookmarked in Pinned · Users shows it only because real devices subscribed'
                                    : 'Pinned from Extreme · stored in pinned_monitored_tickers · not Users'
                                }
                              >
                                {stocksListTab === 'users' &&
                                (activeMeta?.subscriber_count ?? 0) > 0
                                  ? 'Also pinned'
                                  : 'Pinned'}
                              </Badge>
                            ) : stocksListTab === 'extreme' ? (
                              <Badge
                                variant="outline"
                                className="shrink-0 text-muted-foreground"
                              >
                                Extreme · view only
                              </Badge>
                            ) : null}
                          </div>
                          {activeCompanyName && activeCompanyName !== activeTicker ? (
                            <p
                              className="max-w-xl truncate text-sm text-muted-foreground"
                              title={activeCompanyName}
                            >
                              {activeCompanyName}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                            <a
                              href={yahooQuoteUrl(activeTicker)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground underline-offset-2 hover:underline"
                              title={`Open ${activeTicker} on Yahoo Finance`}
                            >
                              Yahoo Finance
                              <ExternalLink className="size-3 opacity-60" />
                            </a>
                            <a
                              href={perplexityFinanceUrl(activeTicker)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground underline-offset-2 hover:underline"
                              title={`Open ${activeTicker} on Perplexity Finance`}
                            >
                              Perplexity Finance
                              <ExternalLink className="size-3 opacity-60" />
                            </a>
                          </div>
                        </div>
                        {activeMarketPillItems.length ? (
                          <div className="w-full shrink-0 sm:ml-auto sm:w-auto">
                            <MarketDataPill
                              items={activeMarketPillItems}
                              lastCheckedAt={liveQuotesLastCheckedAt}
                              currency={activeLiveQuote?.currency || 'USD'}
                              stacked={activeMarketSession !== 'regular'}
                            />
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" />
                            Yahoo quote
                          </span>
                        )}
                      </div>

                      {/* Fundamentals */}
                      {(() => {
                        const pillClass =
                          'inline-flex max-w-[15rem] items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] leading-none'
                        const labelClass =
                          'shrink-0 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80'
                        const valueClass = 'min-w-0 truncate font-medium text-foreground'
                        type FundPill = {
                          key: string
                          label: string
                          title?: string
                          node: React.ReactNode
                        }
                        const pills: FundPill[] = []

                        const mcap = formatMarketCap(
                          companyProfile?.marketCap,
                          companyProfile?.currency || 'USD',
                        )
                        if (mcap) {
                          pills.push({
                            key: 'mcap',
                            label: 'Mkt cap',
                            title: 'Market capitalization',
                            node: (
                              <span className={cn(valueClass, 'tabular-nums')}>{mcap}</span>
                            ),
                          })
                        }
                        if (companyProfile?.sector) {
                          pills.push({
                            key: 'sector',
                            label: 'Sector',
                            title: companyProfile.sector,
                            node: (
                              <span className={valueClass}>{companyProfile.sector}</span>
                            ),
                          })
                        }
                        if (companyProfile?.industry) {
                          pills.push({
                            key: 'industry',
                            label: 'Industry',
                            title: companyProfile.industry,
                            node: (
                              <span className={valueClass}>{companyProfile.industry}</span>
                            ),
                          })
                        }
                        if (companyProfile?.about) {
                          pills.push({
                            key: 'about',
                            label: 'About',
                            title: 'Hover for company description',
                            node: (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="font-semibold text-sky-700 underline decoration-sky-700/35 underline-offset-2 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200"
                                  >
                                    View
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="bottom"
                                  align="start"
                                  sideOffset={8}
                                  collisionPadding={16}
                                  className="max-w-md whitespace-pre-wrap p-3 text-left text-xs leading-relaxed"
                                >
                                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                                    About {activeCompanyName || activeTicker}
                                  </p>
                                  <p className="max-h-72 overflow-y-auto">
                                    {companyProfile.about}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            ),
                          })
                        }
                        if (companyProfile?.founded) {
                          pills.push({
                            key: 'founded',
                            label: 'Founded',
                            title: 'Founded',
                            node: (
                              <span className={valueClass}>{companyProfile.founded}</span>
                            ),
                          })
                        }
                        const emp = formatEmployeeCount(companyProfile?.fullTimeEmployees)
                        if (emp) {
                          pills.push({
                            key: 'employees',
                            label: 'Employees',
                            title: 'Full-time employees',
                            node: (
                              <span className={cn(valueClass, 'tabular-nums')}>{emp}</span>
                            ),
                          })
                        }
                        const hq = [companyProfile?.city, companyProfile?.country]
                          .filter(Boolean)
                          .join(', ')
                        if (hq) {
                          pills.push({
                            key: 'hq',
                            label: 'HQ',
                            title: 'Headquarters',
                            node: <span className={valueClass}>{hq}</span>,
                          })
                        }
                        if (companyProfile?.ceo) {
                          const ceoName = companyProfile.ceo.replace(
                            /^Mr\.\s+|^Ms\.\s+|^Mrs\.\s+/i,
                            '',
                          )
                          pills.push({
                            key: 'ceo',
                            label: companyProfile.ceoTitle?.toLowerCase().includes('ceo')
                              ? 'CEO'
                              : 'Lead',
                            title: companyProfile.ceoTitle || 'CEO',
                            node: <span className={valueClass}>{ceoName}</span>,
                          })
                        }
                        if (companyProfile?.website) {
                          const href = companyProfile.website.startsWith('http')
                            ? companyProfile.website
                            : `https://${companyProfile.website}`
                          pills.push({
                            key: 'website',
                            label: 'Web',
                            title: companyProfile.website,
                            node: (
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-w-0 items-center gap-0.5 font-semibold text-sky-700 hover:underline dark:text-sky-300"
                              >
                                <span className="truncate">Open</span>
                                <ExternalLink className="size-2.5 shrink-0 opacity-70" />
                              </a>
                            ),
                          })
                        }

                        if (companyProfileLoading && !companyProfile) {
                          return (
                            <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
                              <Loader2 className="size-3 animate-spin" />
                              Loading profile…
                            </div>
                          )
                        }
                        if (!pills.length) return null

                        return (
                          <div
                            className="flex min-w-0 flex-wrap items-center gap-1.5"
                            role="list"
                            aria-label="Company fundamentals"
                          >
                            {pills.map((pill) => (
                              <span
                                key={pill.key}
                                className={pillClass}
                                title={pill.title}
                                role="listitem"
                              >
                                <span className={labelClass}>{pill.label}</span>
                                {pill.node}
                              </span>
                            ))}
                          </div>
                        )
                      })()}

                      {/* Compact meta chips */}
                      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5 text-[11px] text-muted-foreground sm:text-xs">
                        <span className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1">
                          <span className="text-muted-foreground/80">Saved</span>
                          <span className="font-medium text-foreground">
                            {activeMeta?.saved_event_count ?? 0}
                          </span>
                          <span>
                            date{(activeMeta?.saved_event_count ?? 0) === 1 ? '' : 's'}
                          </span>
                          {activeMeta?.last_saved_at ? (
                            <span
                              className="hidden text-muted-foreground/70 sm:inline"
                              title={new Date(activeMeta.last_saved_at).toLocaleString()}
                            >
                              · {new Date(activeMeta.last_saved_at).toLocaleDateString()}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-border">·</span>
                        <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted/50 px-2 py-1">
                          <span className="shrink-0 text-muted-foreground/80">Source</span>
                          {(() => {
                            const source = sourceLabelForTicker({
                              ticker: activeTicker,
                              scrape_source:
                                activeState.result?.scrape_source || activeMeta?.scrape_source,
                              source_url: activeState.result?.url || activeMeta?.source_url,
                            })
                            return (
                              <a
                                className="inline-flex min-w-0 items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
                                href={source.href}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <span className="truncate">{source.short}</span>
                                <ExternalLink className="size-2.5 shrink-0 opacity-60" />
                              </a>
                            )
                          })()}
                        </span>
                        <span className="text-border">·</span>
                        {(() => {
                          const count = activeMeta?.subscriber_count ?? 0
                          const devices = activeMeta?.device_ids || []
                          const label =
                            notificationApp === 'trigger' ? 'Devices' : 'Devices'
                          const chip = (
                            <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted/50 px-2 py-1">
                              <Users className="size-3 shrink-0 opacity-60" />
                              <span className="font-medium tabular-nums text-foreground">
                                {count}
                              </span>
                              <span className="text-muted-foreground/80">{label}</span>
                              {devices.length > 0 ? (
                                <span className="hidden max-w-[12rem] truncate text-muted-foreground/70 sm:inline">
                                  · {devices[0]}
                                  {devices.length > 1 ? ` +${devices.length - 1}` : ''}
                                </span>
                              ) : null}
                            </span>
                          )
                          if (!devices.length) return chip
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="max-w-full text-left">
                                  {chip}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="bottom"
                                align="start"
                                className="max-w-sm p-2.5 text-left text-xs"
                              >
                                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                                  {notificationApp === 'trigger'
                                    ? 'Trigger devices'
                                    : 'Subscribed devices'}
                                </p>
                                <ul className="max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] leading-snug">
                                  {devices.map((id) => (
                                    <li key={id} className="break-all">
                                      {id}
                                    </li>
                                  ))}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          )
                        })()}
                        <span className="text-border">·</span>
                        {(() => {
                          const tickerUsage =
                            activeMeta?.gemini_usage || sumEventsGeminiUsage(storedEvents)
                          const cost =
                            activeMeta?.gemini_cost_usd_display ||
                            tickerUsage.cost_usd_display ||
                            formatUsdCompact(
                              activeMeta?.gemini_cost_usd ?? tickerUsage.cost_usd,
                            )
                          const tokens =
                            activeMeta?.gemini_total_tokens ?? tickerUsage.total_tokens ?? 0
                          const credits =
                            activeMeta?.gemini_credits_used ?? tickerUsage.credits_used ?? 0
                          const dates = tickerUsage.dates_with_gemini
                          return (
                            <span
                              className="desk-stat desk-stat--accent !rounded-md"
                              title={`${Number(tokens).toLocaleString()} tokens · ${Number(credits).toLocaleString()} credits${
                                dates
                                  ? ` · ${dates} date${dates === 1 ? '' : 's'}`
                                  : ''
                              }`}
                            >
                              <Sparkles className="size-3 shrink-0 opacity-70" />
                              <strong>{cost}</strong>
                              <span className="hidden sm:inline opacity-80">
                                Gemini
                                {dates
                                  ? ` · ${dates}d`
                                  : ''}
                              </span>
                            </span>
                          )
                        })()}
                      </div>
                    </div>

                    {/* Actions */}
                    <div
                      className={cn(
                        'flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-stretch',
                        isTrigger && 'gap-2.5',
                      )}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          activeState.loading || allTickersLoading || geminiPromptRunning
                        }
                        onClick={() => void handleRefresh(activeTicker)}
                        className={cn(
                          'justify-start',
                          isTrigger && 'desk-action h-auto border-0 shadow-none',
                        )}
                      >
                        {activeState.loading ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                        {notificationApp === 'trigger' ? 'Fetch & auto-save' : 'Refresh'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          !activeTicker ||
                          activeState.loading ||
                          geminiPromptRunning ||
                          geminiBulkBusy ||
                          Boolean(geminiBusyKey)
                        }
                        onClick={() => void openGeminiAutoSavePrompt()}
                        title="Open Gemini prompt, then format & save all dates without gemini_formating"
                        className={cn(
                          isTrigger
                            ? 'desk-action desk-action--soft h-auto justify-start gap-1.5 border-0 shadow-none'
                            : 'justify-start gap-1.5 border-violet-500/40 bg-violet-500/10 text-violet-950 hover:bg-violet-500/15 dark:text-violet-100',
                        )}
                      >
                        {geminiPromptRunning ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Sparkles className={cn('size-4', isTrigger ? 'text-primary' : 'text-violet-600')} />
                        )}
                        {geminiPromptRunning
                          ? `Gemini ${geminiBulkProgress.done}/${geminiBulkProgress.total}`
                          : 'Gemini & auto-save'}
                      </Button>
                      {notificationApp === 'nineam' ? (
                        <Button
                          type="button"
                          disabled={
                            activeState.saving ||
                            activeState.loading ||
                            !events.length ||
                            pendingSaveCount === 0
                          }
                          onClick={() => void handleSave(activeTicker)}
                          className="justify-start"
                        >
                          {activeState.saving ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Save className="size-4" />
                          )}
                          {pendingSaveCount > 0
                            ? `Save ${pendingSaveCount} pending`
                            : 'Save'}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="default"
                        disabled={
                          activeState.alerting ||
                          activeState.loading ||
                          (activeMeta?.subscriber_count ?? 0) === 0
                        }
                        onClick={() => void openMovementAlert(activeTicker)}
                        title="Send Expo push to all enabled devices subscribed to this ticker"
                        className={cn(
                          'justify-start',
                          isTrigger && 'desk-action desk-action--primary h-auto border-0 shadow-none',
                        )}
                      >
                        {activeState.alerting ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <BellRing className="size-4" />
                        )}
                        Alert users
                        {(activeMeta?.subscriber_count ?? 0) > 0
                          ? ` (${activeMeta?.subscriber_count})`
                          : ''}
                      </Button>
                    </div>
                  </div>
                </div>

                {activeState.error ? (
                  <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {activeState.error}
                  </div>
                ) : null}
                {activeState.saveMessage ? (
                  <div
                    className={cn(
                      'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                      activeState.saveIsNoop
                        ? 'border-border bg-muted/40 text-muted-foreground'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
                    )}
                  >
                    <Check className="mt-0.5 size-4 shrink-0" />
                    <span>{activeState.saveMessage}</span>
                  </div>
                ) : null}
                {activeState.alertMessage ? (
                  <div
                    className={cn(
                      'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                      activeState.alertIsError
                        ? 'border-destructive/35 bg-destructive/10 text-destructive'
                        : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100',
                    )}
                  >
                    <BellRing className="mt-0.5 size-4 shrink-0" />
                    <span>{activeState.alertMessage}</span>
                  </div>
                ) : null}

                {activeState.result ? (
                  <div
                    className={cn(
                      'grid gap-2 p-3 text-sm sm:grid-cols-2 lg:grid-cols-5',
                      isTrigger
                        ? 'desk-panel'
                        : 'rounded-xl border bg-muted/30',
                    )}
                  >
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Credits used</div>
                      <div className="font-medium">
                        {activeState.result.credits.used != null
                          ? activeState.result.credits.used
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Balance after</div>
                      <div className="font-medium">
                        {activeState.result.credits.after?.remaining_credits != null
                          ? `${activeState.result.credits.after.remaining_credits}${
                              activeState.result.credits.after.plan_credits != null
                                ? ` / ${activeState.result.credits.after.plan_credits}`
                                : ''
                            }`
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Scraped (30d)</div>
                      <div className="font-medium">{events.length}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">New dates</div>
                      <div className="font-medium text-emerald-700 dark:text-emerald-300">
                        {compare?.new ?? events.filter((e) => e.save_status === 'new').length}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Already in DB</div>
                      <div className="font-medium text-muted-foreground">
                        {compare?.already_saved ??
                          events.filter((e) => e.save_status === 'saved').length}
                      </div>
                    </div>
                  </div>
                ) : null}

                {pendingEvents.length > 0 ? (
                  <section
                    className={cn(
                      'space-y-3 p-4',
                      isTrigger
                        ? 'desk-event desk-event-pending'
                        : 'rounded-2xl border border-amber-500/35 bg-amber-500/5',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3
                          className={cn(
                            isTrigger
                              ? 'desk-section-label text-foreground normal-case tracking-normal text-sm font-semibold'
                              : 'text-sm font-semibold uppercase tracking-[0.12em] text-amber-900 dark:text-amber-200',
                          )}
                        >
                          New data · not yet saved
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Run Gemini on all pending events. If every classification succeeds, they
                          save to Supabase automatically.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-amber-500/15 text-amber-900 dark:text-amber-200">
                          {pendingEvents.length} pending
                        </Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1.5 border-violet-500/40 bg-violet-500/10 text-violet-950 hover:bg-violet-500/15 dark:text-violet-100"
                          disabled={
                            geminiBulkBusy ||
                            activeState.loading ||
                            activeState.saving ||
                            Boolean(geminiBusyKey)
                          }
                          onClick={() => void handleGeminiPendingAll(activeTicker)}
                          title="Classify all unsaved events with Gemini, then auto-save if no errors"
                        >
                          {geminiBulkBusy ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="size-3.5 text-violet-600" />
                          )}
                          {geminiBulkBusy
                            ? `Gemini ${geminiBulkProgress.done}/${geminiBulkProgress.total}`
                            : `Gemini all pending (${pendingEvents.length})`}
                        </Button>
                      </div>
                    </div>
                    <div className={cn(isTrigger ? 'space-y-3' : 'space-y-12')}>
                      {pendingEvents.map((event) => {
                        const change = formatChange(event.price_change || event.momentum)
                        const premarketChange = formatChange(getPremarketChange(event))
                        const premarketReason = getPremarketReason(event)
                        const sources = event.sources || []
                        const geminiKey = geminiEventKey(activeTicker, event, 'summary')
                        const geminiBusy = geminiBusyKey === geminiKey
                        return (
                          <article
                            key={`pending-${event.event_date}-${event.time_label || ''}`}
                            className={cn('space-y-3', isTrigger && 'desk-event')}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold">{formatEventHeading(event)}</p>
                                <Badge
                                  className={cn(
                                    event.save_status === 'changed'
                                      ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
                                      : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
                                  )}
                                >
                                  {event.save_status === 'changed'
                                    ? 'Changed · not yet saved'
                                    : 'New · not yet saved'}
                                </Badge>
                                <button
                                  type="button"
                                  data-event-date={event.event_date}
                                  disabled={Boolean(geminiBusyKey) || geminiBulkBusy}
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    void handleGeminiSummarize(activeTicker, event, 'summary')
                                  }}
                                  title={`Structure ${formatEventHeading(event)} (${event.event_date}) with Gemini`}
                                  className="disabled:pointer-events-none disabled:opacity-60"
                                >
                                  {geminiBusy ? (
                                    <Badge
                                      variant="outline"
                                      className="gap-1 border-violet-500/40 text-violet-900 dark:text-violet-100"
                                    >
                                      <Loader2 className="size-3 animate-spin" />
                                      …
                                    </Badge>
                                  ) : hasGeminiFormating(event) ? (
                                    <Badge
                                      className="gap-1 bg-violet-500/15 text-violet-900 hover:bg-violet-500/25 dark:text-violet-100"
                                      title={
                                        event.gemini_model
                                          ? `Structured with ${event.gemini_model}${
                                              eventGeminiTagCost(event)
                                                ? ` · ${eventGeminiTagCost(event)}`
                                                : ''
                                            }`
                                          : 'Structured with Gemini'
                                      }
                                    >
                                      <Sparkles className="size-3" />
                                      {formatGeminiModelLabel(event.gemini_model) || 'Done'}
                                      {eventGeminiTagCost(event)
                                        ? ` (${eventGeminiTagCost(event)})`
                                        : ''}
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="outline"
                                      className="gap-1 text-muted-foreground hover:border-violet-500/40 hover:text-violet-900 dark:hover:text-violet-100"
                                    >
                                      No Gemini
                                    </Badge>
                                  )}
                                </button>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={activeState.alerting}
                                  onClick={() => void openMovementAlert(activeTicker, event)}
                                >
                                  <BellRing className="size-3.5" />
                                  Alert
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5"
                                  onClick={() =>
                                    void openSocialShare(
                                      activeTicker,
                                      event,
                                      activeMeta?.company_name,
                                    )
                                  }
                                  title="Share on social media"
                                >
                                  <Share2 className="size-3.5" />
                                  Share
                                </Button>
                                {event.price ? (
                                  <Badge variant="outline" className="font-mono">
                                    Close {event.price}
                                  </Badge>
                                ) : null}
                                {change ? (
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      'font-mono',
                                      change.negative &&
                                        'bg-red-500/10 text-red-700 dark:text-red-300',
                                      change.positive &&
                                        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                                    )}
                                  >
                                    {change.text} at Close
                                  </Badge>
                                ) : null}
                                {premarketChange ? (
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      'font-mono',
                                      premarketChange.negative &&
                                        'bg-red-500/10 text-red-700 dark:text-red-300',
                                      premarketChange.positive &&
                                        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                                    )}
                                  >
                                    Pre-market {premarketChange.text}
                                  </Badge>
                                ) : null}
                                {(() => {
                                  const afterHoursChange = formatChange(
                                    event.after_hours_change ?? null,
                                  )
                                  if (!afterHoursChange && !event.after_hours_price) return null
                                  return (
                                    <Badge
                                      variant="secondary"
                                      className={cn(
                                        'font-mono',
                                        afterHoursChange?.negative &&
                                          'bg-red-500/10 text-red-700 dark:text-red-300',
                                        afterHoursChange?.positive &&
                                          'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                                      )}
                                    >
                                      {event.after_hours_price
                                        ? `AH ${event.after_hours_price}`
                                        : 'After-hours'}
                                      {afterHoursChange ? ` ${afterHoursChange.text}` : ''}
                                    </Badge>
                                  )
                                })()}
                              </div>
                            </div>
                            <div className={cn(
                              'mt-3 space-y-3 p-3',
                              isTrigger
                                ? 'rounded-xl border border-[color:var(--desk-hairline)] bg-muted/30'
                                : 'rounded-xl border border-border/60 bg-card/40',
                            )}>
                              <div className="space-y-1.5">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Reason
                                </p>
                                <Textarea
                                  value={reasonDisplayText(
                                    event,
                                    reasonDrafts[reasonDraftKey(activeTicker, event)],
                                  )}
                                  onChange={(e) =>
                                    setReasonDrafts((prev) => ({
                                      ...prev,
                                      [reasonDraftKey(activeTicker, event)]: e.target.value,
                                    }))
                                  }
                                  onBlur={() => void handleSaveReasonEdit(activeTicker, event)}
                                  rows={8}
                                  className="min-h-[8rem] resize-y whitespace-pre-wrap text-sm leading-relaxed"
                                  placeholder={"$TICKER +x% so far in regular trading\nLikely driver: …\nSecondary driver: …"}
                                  disabled={
                                    reasonSavingKey === reasonDraftKey(activeTicker, event)
                                  }
                                />
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Sources
                                  {sources.length ? ` (${sources.length})` : ''}
                                </p>
                                <EventSourcesRow
                                  sources={sources}
                                  draft={sourceDrafts[reasonDraftKey(activeTicker, event)]}
                                  onDraftChange={(value) =>
                                    setSourceDrafts((prev) => ({
                                      ...prev,
                                      [reasonDraftKey(activeTicker, event)]: value,
                                    }))
                                  }
                                  onBlur={() => void handleSaveReasonEdit(activeTicker, event)}
                                  disabled={
                                    reasonSavingKey === reasonDraftKey(activeTicker, event)
                                  }
                                />
                              </div>
                              {renderGeminiUsageStrip(geminiKey)}
                              {geminiErrorByKey[geminiKey] ? (
                                <p className="text-xs text-destructive">
                                  {geminiErrorByKey[geminiKey]}
                                </p>
                              ) : null}
                            </div>
                            {premarketReason && premarketReason !== event.summary ? (
                              <div className="mt-3 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-sm">
                                <span className="font-medium text-foreground">
                                  Pre-market reason:
                                </span>{' '}
                                <span className="whitespace-pre-line text-muted-foreground">
                                  {premarketReason}
                                </span>
                              </div>
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ) : null}

                {activeState.result &&
                !activeState.loading &&
                !pendingEvents.length &&
                events.length === 0 ? (
                  <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    {activeState.result.section_found
                      ? 'Refresh found no notable movements in the past 30 days.'
                      : 'Could not find the Notable Price Movement section on the page.'}
                  </div>
                ) : null}

                {/* Saved dates timeline */}
                {storedEvents.length > 0 ? (
                  <div className={cn(isTrigger ? 'space-y-3' : 'space-y-14')}>
                    {isTrigger ? (
                      <div className="flex items-center justify-between gap-2 px-0.5">
                        <p className="desk-section-label">Timeline</p>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {storedEvents.length} saved
                        </span>
                      </div>
                    ) : null}
                    {storedEvents.map((event) => {
                      const change = formatChange(event.price_change || event.momentum)
                      const premarketChange = formatChange(getPremarketChange(event))
                      const premarketReason = getPremarketReason(event)
                      const sources = event.sources || []
                      const status = event.save_status
                      const geminiKey = geminiEventKey(activeTicker, event, 'summary')
                      const geminiBusy = geminiBusyKey === geminiKey
                      return (
                        <article
                          key={event.event_date + (event.time_label || '')}
                          className={cn('space-y-3', isTrigger && 'desk-event')}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold">
                                {formatEventHeading(event)}
                              </div>
                              {status === 'new' ? (
                                <Badge className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-200">
                                  New
                                </Badge>
                              ) : null}
                              {status === 'changed' ? (
                                <Badge className="bg-amber-500/15 text-amber-900 dark:text-amber-200">
                                  Updated content
                                </Badge>
                              ) : null}
                              {status === 'saved' || !status ? (
                                <Badge variant="secondary" className="text-muted-foreground">
                                  Already saved
                                </Badge>
                              ) : null}
                              <button
                                type="button"
                                data-event-date={event.event_date}
                                disabled={Boolean(geminiBusyKey) || geminiBulkBusy}
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  void handleGeminiSummarize(activeTicker, event, 'summary')
                                }}
                                title={`Structure ${formatEventHeading(event)} (${event.event_date}) with Gemini`}
                                className="disabled:pointer-events-none disabled:opacity-60"
                              >
                                {geminiBusy ? (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 border-violet-500/40 text-violet-900 dark:text-violet-100"
                                  >
                                    <Loader2 className="size-3 animate-spin" />
                                    …
                                  </Badge>
                                ) : hasGeminiFormating(event) ? (
                                  <Badge
                                    className="gap-1 bg-violet-500/15 text-violet-900 hover:bg-violet-500/25 dark:text-violet-100"
                                    title={
                                      event.gemini_model
                                        ? `Structured with ${event.gemini_model}${
                                            eventGeminiTagCost(event)
                                              ? ` · ${eventGeminiTagCost(event)}`
                                              : ''
                                          }`
                                        : 'Structured with Gemini'
                                    }
                                  >
                                    <Sparkles className="size-3" />
                                    {formatGeminiModelLabel(event.gemini_model) || 'Done'}
                                    {eventGeminiTagCost(event)
                                      ? ` (${eventGeminiTagCost(event)})`
                                      : ''}
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 text-muted-foreground hover:border-violet-500/40 hover:text-violet-900 dark:hover:text-violet-100"
                                  >
                                    No Gemini
                                  </Badge>
                                )}
                              </button>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={activeState.alerting}
                                onClick={() => void openMovementAlert(activeTicker, event)}
                                title={`Send only the ${event.event_date} movement`}
                              >
                                <BellRing className="size-3.5" />
                                Alert
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() =>
                                  void openSocialShare(
                                    activeTicker,
                                    event,
                                    activeMeta?.company_name,
                                  )
                                }
                                title="Share on social media"
                              >
                                <Share2 className="size-3.5" />
                                Share
                              </Button>
                              {event.price ? (
                                <Badge variant="outline" className="font-mono">
                                  Close {event.price}
                                </Badge>
                              ) : null}
                              {change ? (
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    'font-mono',
                                    change.negative &&
                                      'bg-red-500/10 text-red-700 dark:text-red-300',
                                    change.positive &&
                                      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                                  )}
                                >
                                  {change.text} at Close
                                </Badge>
                              ) : null}
                              {premarketChange ? (
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    'font-mono',
                                    premarketChange.negative &&
                                      'bg-red-500/10 text-red-700 dark:text-red-300',
                                    premarketChange.positive &&
                                      'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                                  )}
                                >
                                  Pre-market {premarketChange.text}
                                </Badge>
                              ) : null}
                              {(() => {
                                const afterHoursChange = formatChange(
                                  event.after_hours_change ?? null,
                                )
                                if (!afterHoursChange && !event.after_hours_price) return null
                                return (
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      'font-mono',
                                      afterHoursChange?.negative &&
                                        'bg-red-500/10 text-red-700 dark:text-red-300',
                                      afterHoursChange?.positive &&
                                        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                                    )}
                                  >
                                    {event.after_hours_price
                                      ? `AH ${event.after_hours_price}`
                                      : 'After-hours'}
                                    {afterHoursChange ? ` ${afterHoursChange.text}` : ''}
                                  </Badge>
                                )
                              })()}
                            </div>
                          </div>

                          <div className={cn(
                              'mt-3 space-y-3 p-3',
                              isTrigger
                                ? 'rounded-xl border border-[color:var(--desk-hairline)] bg-muted/30'
                                : 'rounded-xl border border-border/60 bg-card/40',
                            )}>
                            <div className="space-y-1.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Reason
                              </p>
                              <Textarea
                                value={reasonDisplayText(
                                  event,
                                  reasonDrafts[reasonDraftKey(activeTicker, event)],
                                )}
                                onChange={(e) =>
                                  setReasonDrafts((prev) => ({
                                    ...prev,
                                    [reasonDraftKey(activeTicker, event)]: e.target.value,
                                  }))
                                }
                                onBlur={() => void handleSaveReasonEdit(activeTicker, event)}
                                rows={5}
                                className="min-h-[6rem] resize-y text-sm leading-relaxed"
                                placeholder="Reason / Gemini notification text…"
                                disabled={
                                  reasonSavingKey === reasonDraftKey(activeTicker, event)
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Sources
                                {sources.length ? ` (${sources.length})` : ''}
                              </p>
                              <EventSourcesRow
                                sources={sources}
                                draft={sourceDrafts[reasonDraftKey(activeTicker, event)]}
                                onDraftChange={(value) =>
                                  setSourceDrafts((prev) => ({
                                    ...prev,
                                    [reasonDraftKey(activeTicker, event)]: value,
                                  }))
                                }
                                onBlur={() => void handleSaveReasonEdit(activeTicker, event)}
                                disabled={
                                  reasonSavingKey === reasonDraftKey(activeTicker, event)
                                }
                              />
                            </div>
                            {renderGeminiUsageStrip(geminiKey)}
                            {geminiErrorByKey[geminiKey] ? (
                              <p className="text-xs text-destructive">
                                {geminiErrorByKey[geminiKey]}
                              </p>
                            ) : null}
                          </div>
                          {premarketReason && premarketReason !== event.summary ? (
                            <div className="mt-3 rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-sm">
                              <span className="font-medium text-foreground">
                                Pre-market reason:
                              </span>{' '}
                              <span className="whitespace-pre-line text-muted-foreground">
                                {premarketReason}
                              </span>
                            </div>
                          ) : null}
                        </article>
                      )
                    })}
                  </div>
                ) : null}
              </section>
            ) : (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center">
                <TrendingUp className="size-8 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">Select a stock</p>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Choose a ticker from the list on the left to view notable moves, fetch, classify,
                  and alert.
                </p>
              </div>
            )}
              </div>
            </div>
              </>
            )}
          </div>
        </main>

        {/* RIGHT rail — collapsible activity log */}
        <aside
          className={cn(
            'flex min-h-[40vh] flex-col overflow-hidden transition-[width,flex-basis] duration-200 ease-out lg:min-h-0',
            logsCollapsed
              ? 'w-12 shrink-0 flex-none border-l'
              : 'min-w-0 flex-[3]',
            isTrigger
              ? 'border-l border-border/50 bg-card/50'
              : logsCollapsed
                ? 'border-white/10 bg-neutral-950 text-neutral-100'
                : 'bg-neutral-950 text-neutral-100',
          )}
        >
          {logsCollapsed ? (
            <div className="flex h-full flex-col items-center gap-3 px-1.5 py-3">
              <button
                type="button"
                onClick={() => setLogsCollapsed(false)}
                className={cn(
                  'inline-flex size-9 items-center justify-center rounded-xl border transition-colors',
                  isTrigger
                    ? 'border-border/70 bg-background text-foreground shadow-sm hover:bg-muted'
                    : 'border-white/15 bg-white/5 text-neutral-100 hover:bg-white/10',
                )}
                title="Expand activity log"
                aria-label="Expand activity log"
                aria-expanded={false}
              >
                <ChevronLeft className="size-4" />
              </button>
              <div
                className={cn(
                  'flex size-8 items-center justify-center rounded-lg',
                  isTrigger ? 'bg-muted text-muted-foreground' : 'bg-white/10 text-neutral-300',
                )}
              >
                <Terminal className="size-3.5" />
              </div>
              <span
                className={cn(
                  'mt-1 text-[10px] font-semibold tabular-nums',
                  isTrigger ? 'text-muted-foreground' : 'text-neutral-500',
                )}
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                Logs · {logs.length}
              </span>
            </div>
          ) : isTrigger ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-4 px-5 py-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Context
                    </p>
                    <h3 className="mt-1 text-lg font-semibold tracking-tight">
                      {section === 'users'
                        ? 'Audience'
                        : activeTicker || 'Activity'}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {section === 'users'
                        ? `${devices.length} alertable device${devices.length === 1 ? '' : 's'}`
                        : activeMeta?.company_name && activeMeta.company_name !== activeTicker
                          ? activeMeta.company_name
                          : 'Live scrape & save status'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLogsCollapsed(true)}
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
                    title="Collapse activity log"
                    aria-label="Collapse activity log"
                    aria-expanded={true}
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>

                {section === 'tickers' && activeMeta ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Saved
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">
                        {activeMeta.saved_event_count ?? 0}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-background/80 px-3 py-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Devices
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">
                        {activeMeta.subscriber_count ?? 0}
                      </p>
                    </div>
                  </div>
                ) : null}

                {section === 'tickers' && activeMeta ? (
                  <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {activeTicker}
                    </span>
                    {' · '}
                    <a
                      href={yahooQuoteUrl(activeTicker)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      Yahoo Finance
                    </a>
                    {' · '}
                    <a
                      href={perplexityFinanceUrl(activeTicker)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      Perplexity Finance
                    </a>
                    {activeMeta.last_saved_at
                      ? ` · last save ${new Date(activeMeta.last_saved_at).toLocaleString()}`
                      : ''}
                  </div>
                ) : null}

                <div className="flex flex-col gap-1 border-t border-border/50 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Terminal className="size-4 text-muted-foreground" />
                      Activity
                      {activeTicker && section === 'tickers' ? (
                        <span className="font-mono text-xs font-normal text-muted-foreground">
                          {activeTicker}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[11px] text-muted-foreground">{logs.length}</span>
                  </div>
                  {lastGeminiUsage ? (
                    <p className="truncate text-[11px] text-violet-800 dark:text-violet-200">
                      {lastGeminiUsage.message}
                      {lastGeminiUsage.model ? ` · ${lastGeminiUsage.model}` : ''}
                      {lastGeminiUsage.retries
                        ? ` · retry ${lastGeminiUsage.retries}`
                        : ''}
                    </p>
                  ) : null}
                </div>

                {section === 'tickers' && activeState.loading ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
                    <Loader2 className="size-3.5 animate-spin" />
                    Fetching… details appear when the request finishes.
                  </div>
                ) : null}
                {logs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                    {section === 'users'
                      ? 'Audience actions and digests will show here.'
                      : 'Fetch, save, and alert activity will stream here.'}
                    <div className="mt-2 text-xs">
                      Includes Firecrawl credits, sources, and auto-save results.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 pb-2">
                    {logs.map((log, index) => {
                      const logKey = `${log.at}-${index}`
                      const expanded = Boolean(expandedLogKeys[logKey])
                      const hasDetail = log.detail != null
                      return (
                        <button
                          key={logKey}
                          type="button"
                          onClick={() => {
                            if (!hasDetail) return
                            setExpandedLogKeys((prev) => ({
                              ...prev,
                              [logKey]: !prev[logKey],
                            }))
                          }}
                          className={cn(
                            'w-full rounded-2xl border border-border/60 bg-background/80 px-3 py-2.5 text-left shadow-sm transition-colors',
                            hasDetail && 'hover:bg-muted/40',
                          )}
                          aria-expanded={hasDetail ? expanded : undefined}
                        >
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span className="text-muted-foreground">
                                  {formatLogTime(log.at)}
                                </span>
                                <span
                                  className={cn(
                                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                                    log.level === 'error' &&
                                      'bg-red-500/10 text-red-700 dark:text-red-300',
                                    log.level === 'warn' &&
                                      'bg-amber-500/10 text-amber-800 dark:text-amber-200',
                                    log.level === 'success' &&
                                      'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
                                    log.level === 'info' &&
                                      'bg-sky-500/10 text-sky-800 dark:text-sky-200',
                                    !['error', 'warn', 'success', 'info'].includes(log.level) &&
                                      'bg-muted text-muted-foreground',
                                  )}
                                >
                                  {log.level}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-sm leading-snug text-foreground">
                                {log.message}
                              </p>
                            </div>
                            {hasDetail ? (
                              <ChevronDown
                                className={cn(
                                  'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                                  expanded && 'rotate-180',
                                )}
                              />
                            ) : null}
                          </div>
                          {hasDetail && expanded ? (
                            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted/50 p-2 font-mono text-[10px] text-muted-foreground">
                              {typeof log.detail === 'string'
                                ? log.detail
                                : JSON.stringify(log.detail, null, 2)}
                            </pre>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Terminal className="size-4 text-neutral-400" />
                  Logs
                  {section === 'news' ? (
                    <span className="text-xs font-normal text-neutral-500">news</span>
                  ) : section === 'custom' ? (
                    <span className="text-xs font-normal text-neutral-500">custom</span>
                  ) : section === 'users' ? (
                    <span className="text-xs font-normal text-neutral-500">9am users</span>
                  ) : activeTicker ? (
                    <span className="font-mono text-xs font-normal text-neutral-500">
                      {activeTicker}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-neutral-500">{logs.length} entries</span>
                  <button
                    type="button"
                    onClick={() => setLogsCollapsed(true)}
                    className="inline-flex size-8 items-center justify-center rounded-lg border border-white/15 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                    title="Collapse logs"
                    aria-label="Collapse logs"
                    aria-expanded={true}
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
              <div className="px-3 py-3 font-mono text-[11px] leading-relaxed sm:text-xs">
                {section === 'tickers' && activeState.loading ? (
                  <div className="mb-3 flex items-center gap-2 text-sky-300">
                    <Loader2 className="size-3.5 animate-spin" />
                    Scraping… credits + parse details will stream here when the request finishes.
                  </div>
                ) : null}
                {logs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 px-3 py-8 text-center text-neutral-500">
                    {section === 'news'
                      ? 'Logs appear here after Reload news / Alert.'
                      : section === 'custom'
                        ? 'Logs appear here after Send custom alert.'
                        : section === 'users'
                          ? 'This view lists every currently alertable device.'
                          : 'Logs appear here after Refresh / Save / Alert.'}
                    <div className="mt-2 text-[11px]">
                      {section === 'news'
                        ? 'Includes device counts and Expo push tickets for news alerts.'
                        : section === 'custom'
                          ? 'Includes title/body payload and Expo push tickets.'
                          : section === 'users'
                            ? 'Switch the app tab to see its separate push-token audience.'
                            : 'Includes Firecrawl credit usage, balance remaining, and exact sources per event.'}
                    </div>
                  </div>
                ) : (
                  logs.map((log, index) => {
                    const logKey = `nineam-${log.at}-${index}`
                    const expanded = Boolean(expandedLogKeys[logKey])
                    const hasDetail = log.detail != null
                    return (
                      <button
                        key={logKey}
                        type="button"
                        onClick={() => {
                          if (!hasDetail) return
                          setExpandedLogKeys((prev) => ({
                            ...prev,
                            [logKey]: !prev[logKey],
                          }))
                        }}
                        className={cn(
                          'w-full border-b border-white/5 py-2 text-left last:border-0',
                          hasDetail && 'hover:bg-white/5',
                        )}
                        aria-expanded={hasDetail ? expanded : undefined}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <span className="text-neutral-500">[{formatLogTime(log.at)}]</span>{' '}
                            <span
                              className={cn(
                                'uppercase',
                                log.level === 'error' && 'text-red-400',
                                log.level === 'warn' && 'text-amber-300',
                                log.level === 'success' && 'text-emerald-400',
                                log.level === 'info' && 'text-sky-300',
                              )}
                            >
                              {log.level}
                            </span>{' '}
                            <span className="text-neutral-100">{log.message}</span>
                          </div>
                          {hasDetail ? (
                            <ChevronDown
                              className={cn(
                                'mt-0.5 size-3.5 shrink-0 text-neutral-500 transition-transform',
                                expanded && 'rotate-180',
                              )}
                            />
                          ) : null}
                        </div>
                        {hasDetail && expanded ? (
                          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] text-neutral-400 sm:text-[11px]">
                            {typeof log.detail === 'string'
                              ? log.detail
                              : JSON.stringify(log.detail, null, 2)}
                          </pre>
                        ) : null}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </aside>
        </div>
      </div>

      <Dialog
        open={geminiPromptOpen}
        onOpenChange={(open) => {
          if (!open && !geminiPromptRunning) {
            setGeminiPromptOpen(false)
            setGeminiPromptError('')
          }
        }}
      >
        <DialogContent className="max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-violet-600" />
              Gemini &amp; auto-save
            </DialogTitle>
            <DialogDescription>
              {activeTicker
                ? `Edit the classification prompt, then confirm. Runs Gemini only on ${activeTicker} dates missing gemini_formating, then saves to Supabase.`
                : 'Select a ticker first.'}
            </DialogDescription>
          </DialogHeader>

          {geminiPromptLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading prompt template…
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="gemini-prompt-template">Prompt template (editable)</Label>
              <Textarea
                id="gemini-prompt-template"
                value={geminiPromptText}
                onChange={(e) => setGeminiPromptText(e.target.value)}
                rows={18}
                disabled={geminiPromptRunning}
                className="min-h-[20rem] resize-y font-mono text-xs leading-relaxed"
              />
              <p className="text-[11px] text-muted-foreground">
                Event text is appended automatically under &quot;Information to classify&quot;.
              </p>
            </div>
          )}

          {geminiPromptRunning ? (
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm text-violet-950 dark:text-violet-100">
              Running Gemini {geminiBulkProgress.done}/{geminiBulkProgress.total}…
            </div>
          ) : null}

          {geminiPromptError ? (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {geminiPromptError}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={geminiPromptRunning}
              onClick={() => {
                setGeminiPromptOpen(false)
                setGeminiPromptError('')
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                geminiPromptLoading ||
                geminiPromptRunning ||
                !geminiPromptText.trim() ||
                !activeTicker
              }
              onClick={() => void handleGeminiAutoSaveConfirm()}
            >
              {geminiPromptRunning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Confirm · run &amp; save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={geminiEditOpen}
        onOpenChange={(open) => {
          if (!open) closeGeminiEdit()
        }}
      >
        <DialogContent className="max-w-2xl overflow-y-auto">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-6">
            <DialogHeader className="min-w-0 flex-1 space-y-1.5 pr-0">
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-violet-600" />
                Review structured reason
              </DialogTitle>
              <DialogDescription>
                {geminiEditTarget
                  ? `${geminiEditTarget.ticker} · ${formatEventHeading(geminiEditTarget.event)} (${geminiEditTarget.event.event_date}) · edit Likely/Secondary structure, then save to Supabase (not a push)`
                  : 'Edit structured reason, then save (not a push)'}
                {geminiEditModel ? ` · ${geminiEditModel}` : ''}
              </DialogDescription>
            </DialogHeader>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={geminiEditSaving}
                onClick={closeGeminiEdit}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={geminiEditSaving || !geminiEditDraft.trim()}
                onClick={() => void handleGeminiEditSave()}
              >
                {geminiEditSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save to Supabase
              </Button>
            </div>
          </div>

          {geminiEditUsage || geminiEditModel ? (
            <div className="grid gap-2 rounded-xl border border-violet-500/25 bg-violet-500/5 p-3 text-xs sm:grid-cols-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Model
                </p>
                <p className="mt-0.5 font-medium text-foreground">
                  {geminiEditModel || '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Tokens
                </p>
                <p className="mt-0.5 font-medium tabular-nums text-foreground">
                  {geminiEditUsage
                    ? `${geminiEditUsage.total_tokens} (in ${geminiEditUsage.prompt_tokens} / out ${geminiEditUsage.output_tokens})`
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Credits
                </p>
                <p className="mt-0.5 font-medium tabular-nums text-foreground">
                  {geminiEditUsage ? geminiEditUsage.credits_used : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Est. cost
                </p>
                <p className="mt-0.5 font-medium tabular-nums text-foreground">
                  {geminiEditUsage?.cost_usd_display || '—'}
                </p>
              </div>
            </div>
          ) : null}

          {geminiEditOriginal ? (
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Source text sent to Gemini
                {geminiEditTarget
                  ? ` · ${formatEventHeading(geminiEditTarget.event)} (${geminiEditTarget.event.event_date})`
                  : ''}
              </p>
              <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                {geminiEditOriginal}
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="gemini-edit-draft">Structured reason (editable)</Label>
            <Textarea
              id="gemini-edit-draft"
              value={geminiEditDraft}
              onChange={(e) => setGeminiEditDraft(e.target.value)}
              rows={14}
              disabled={geminiEditSaving}
              className="min-h-[18rem] resize-y font-mono text-sm leading-relaxed"
              placeholder="Likely driver / Secondary driver structured reason…"
            />
            <p className="text-right text-[11px] text-muted-foreground">
              {geminiEditDraft.length} chars
            </p>
          </div>

          {geminiEditError ? (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {geminiEditError}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={socialShareOpen}
        onOpenChange={(open) => {
          setSocialShareOpen(open)
          if (!open) {
            setSocialSharePreviewFullscreen(false)
            setSocialShareCtx((prev) => {
              if (prev?.imageUrl) {
                try {
                  URL.revokeObjectURL(prev.imageUrl)
                } catch {
                  /* ignore */
                }
              }
              return null
            })
            setSocialShareBusy(false)
            setSocialSharePlatformBusy(null)
          }
        }}
      >
        <DialogContent
          className={cn(
            // True full-screen: override Dialog defaults (sm:max-w-sm, top-1/2 translate, rounded)
            'fixed inset-0 top-0 left-0 z-50 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none',
            'translate-x-0 translate-y-0 flex-col gap-2 overflow-hidden rounded-none border-0 p-0',
            'bg-background shadow-none ring-0 sm:max-w-none',
            'data-open:zoom-in-100 data-closed:zoom-out-100',
          )}
        >
          <DialogHeader className="shrink-0 space-y-0.5 border-b border-border/60 px-4 py-3 pr-12 sm:px-5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Share2 className="size-4" />
              Share on social media
              {socialShareCtx?.ticker ? ` · ${socialShareCtx.ticker}` : ''}
              <Badge
                variant="secondary"
                className="h-5 rounded-full px-1.5 text-[10px] font-semibold"
              >
                Full screen
              </Badge>
              {shareImageRerendering ? (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Updating…
                </span>
              ) : null}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Full-screen editor — preview · layout · share. WhatsApp: opens with tweet 1; paste the
              image if needed.
            </DialogDescription>
          </DialogHeader>

          {socialShareBusy || !socialShareCtx ? (
            <div className="flex min-h-0 flex-1 items-center justify-center gap-2 px-4 text-sm text-muted-foreground sm:px-5">
              <Loader2 className="size-4 animate-spin" />
              Building image + text…
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 gap-3 overflow-hidden p-3 sm:p-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              {/* COL 1 — large live preview + Share to */}
              <div className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-xl border border-border/50 bg-muted/20 p-3">
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Preview
                    </p>
                    {socialShareCtx.imageWidth && socialShareCtx.imageHeight ? (
                      <p className="text-[10px] tabular-nums text-muted-foreground">
                        Export {socialShareCtx.imageWidth}×{socialShareCtx.imageHeight}px PNG
                        {socialShareCtx.imageWidth >= 1920 ? ' · Full HD' : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 px-2 text-xs"
                      disabled={!socialShareCtx.imageUrl}
                      onClick={() => setSocialSharePreviewFullscreen(true)}
                      title="View preview full screen"
                    >
                      <Maximize2 className="size-3.5" />
                      Full screen
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 px-2 text-xs"
                      disabled={!socialShareCtx.imageBlob}
                      onClick={async () => {
                        const ok = await copyImageBlobToClipboard(socialShareCtx.imageBlob)
                        const dim =
                          socialShareCtx.imageWidth && socialShareCtx.imageHeight
                            ? `${socialShareCtx.imageWidth}×${socialShareCtx.imageHeight} PNG`
                            : 'full-resolution PNG'
                        toast({
                          title: ok ? 'Full-res image copied' : 'Copy failed',
                          description: ok
                            ? `${dim} on clipboard — paste with ⌘/Ctrl+V (not the small preview).`
                            : 'Try Download instead for a Full HD PNG file.',
                          durationMs: 4000,
                        })
                      }}
                    >
                      <Copy className="size-3.5" />
                      Copy
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      className="h-8 gap-1 px-2 text-xs"
                      disabled={!socialShareCtx.imageBlob}
                      onClick={() =>
                        downloadShareImage(socialShareCtx.imageBlob, socialShareCtx.ticker, {
                          width: socialShareCtx.imageWidth,
                          height: socialShareCtx.imageHeight,
                        })
                      }
                    >
                      <Download className="size-3.5" />
                      Download HD
                    </Button>
                  </div>
                </div>
                {socialShareCtx.imageUrl ? (
                  <button
                    type="button"
                    onClick={() => setSocialSharePreviewFullscreen(true)}
                    className="relative flex min-h-[min(52vh,560px)] flex-1 cursor-zoom-in items-center justify-center overflow-auto rounded-lg p-3 text-left"
                    style={{
                      // Checker so white / pale cards don't disappear into a white panel
                      backgroundImage:
                        'linear-gradient(45deg, #e4e4e7 25%, transparent 25%), linear-gradient(-45deg, #e4e4e7 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e4e4e7 75%), linear-gradient(-45deg, transparent 75%, #e4e4e7 75%)',
                      backgroundSize: '16px 16px',
                      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
                      backgroundColor: '#f4f4f5',
                    }}
                    title="Click for full screen"
                  >
                    <img
                      src={socialShareCtx.imageUrl}
                      alt="Share preview"
                      // Do NOT set HTML width/height to export pixels (1920×…) —
                      // that collapses flex layout and leaves a tiny card in empty space.
                      className="pointer-events-none h-auto max-h-[min(62vh,720px)] w-auto max-w-full rounded-xl border border-black/10 object-contain shadow-lg"
                      style={{ maxWidth: '100%', height: 'auto' }}
                    />
                    <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
                      <Maximize2 className="size-3" />
                      Full screen
                    </span>
                  </button>
                ) : (
                  <div className="flex min-h-[240px] flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                    No image
                  </div>
                )}

                {/* Share to — directly under the image */}
                <div className="shrink-0 space-y-2 border-t border-border/40 pt-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Share to
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {SOCIAL_PLATFORMS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={Boolean(socialSharePlatformBusy)}
                        onClick={() => void handleSocialPlatform(p.id)}
                        title={p.hint}
                        aria-label={p.label}
                        className={cn(
                          'inline-flex size-11 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-sm transition',
                          'hover:bg-muted disabled:pointer-events-none disabled:opacity-50',
                          socialSharePlatformBusy === p.id && 'ring-2 ring-foreground/30',
                        )}
                      >
                        {socialSharePlatformBusy === p.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <SocialBrandIcon id={p.id} className="size-5" />
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <button
                      type="button"
                      title="Copy tweet 1"
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      onClick={() =>
                        void copyTweetText(socialShareCtx.thread.tweet1, 'Tweet 1')
                      }
                    >
                      <Copy className="size-3" />
                      Tweet 1
                    </button>
                    <button
                      type="button"
                      title="Copy tweet 2"
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      onClick={() =>
                        void copyTweetText(socialShareCtx.thread.tweet2, 'Tweet 2')
                      }
                    >
                      <Copy className="size-3" />
                      Tweet 2
                    </button>
                  </div>
                </div>
              </div>

              {/* COL 2 — image layout settings ~60% with section tabs */}
              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-background p-2 sm:p-3">
                <ShareCardLayoutControls
                  style={shareCardStyle}
                  onChange={updateShareCardStyle}
                  idPrefix="social-share"
                  textContent={socialShareCtx.cardText}
                  onTextChange={(next) =>
                    setSocialShareCtx((prev) => (prev ? { ...prev, cardText: next } : prev))
                  }
                  onTextReset={() => {
                    if (!socialShareCtx) return
                    const exchangeTz = tickerExchangeTimeZone(
                      socialShareCtx.ticker,
                      liveQuotes[String(socialShareCtx.ticker || '').toUpperCase()] || null,
                    )
                    const defaults = buildShareCardTextContent(
                      socialShareCtx.ticker,
                      socialShareCtx.event,
                      socialShareCtx.companyName,
                      shareCardStyle,
                      exchangeTz,
                    )
                    setSocialShareCtx((prev) =>
                      prev ? { ...prev, cardText: defaults } : prev,
                    )
                  }}
                  sideImageDataUrl={shareSideImageDataUrl}
                  onSideImageChange={setShareSideImageDataUrl}
                  googleSearchQuery={
                    socialShareCtx.companyName &&
                    socialShareCtx.companyName !== socialShareCtx.ticker
                      ? socialShareCtx.companyName
                      : socialShareCtx.ticker
                  }
                  titleIdentity={{
                    ticker: socialShareCtx.ticker,
                    companyName: socialShareCtx.companyName,
                  }}
                  shareEvent={socialShareCtx.event}
                  exchangeTimeZone={tickerExchangeTimeZone(
                    socialShareCtx.ticker,
                    liveQuotes[String(socialShareCtx.ticker || '').toUpperCase()] || null,
                  )}
                  exchangeTimeZoneLabel={
                    liveQuotes[String(socialShareCtx.ticker || '').toUpperCase()]
                      ?.exchange ||
                    socialShareCtx.ticker
                  }
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Share-card preview — true full-screen lightbox (above editor) */}
      {socialShareOpen &&
      socialSharePreviewFullscreen &&
      socialShareCtx?.imageUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Share card full screen preview"
          className="fixed inset-0 z-[200] flex flex-col bg-black/92 text-white"
          onClick={() => setSocialSharePreviewFullscreen(false)}
        >
          <div
            className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">
                Full screen preview
                {socialShareCtx.ticker ? ` · ${socialShareCtx.ticker}` : ''}
              </p>
              {socialShareCtx.imageWidth && socialShareCtx.imageHeight ? (
                <p className="text-[11px] tabular-nums text-white/60">
                  Export {socialShareCtx.imageWidth}×
                  {socialShareCtx.imageHeight}px
                  {socialShareCtx.imageWidth >= 1920 ? ' · Full HD' : ''}
                  {' · Esc or click outside to close'}
                </p>
              ) : (
                <p className="text-[11px] text-white/60">
                  Esc or click outside to close
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 border-white/20 bg-white/10 px-2 text-xs text-white hover:bg-white/20 hover:text-white"
                disabled={!socialShareCtx.imageBlob}
                onClick={async () => {
                  const ok = await copyImageBlobToClipboard(
                    socialShareCtx.imageBlob,
                  )
                  toast({
                    title: ok ? 'Full-res image copied' : 'Copy failed',
                    description: ok
                      ? 'Paste with ⌘/Ctrl+V'
                      : 'Try Download HD instead',
                    durationMs: 3500,
                  })
                }}
              >
                <Copy className="size-3.5" />
                Copy
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1 px-2 text-xs"
                disabled={!socialShareCtx.imageBlob}
                onClick={() =>
                  downloadShareImage(
                    socialShareCtx.imageBlob,
                    socialShareCtx.ticker,
                    {
                      width: socialShareCtx.imageWidth,
                      height: socialShareCtx.imageHeight,
                    },
                  )
                }
              >
                <Download className="size-3.5" />
                Download HD
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 border-white/20 bg-white/10 px-2 text-xs text-white hover:bg-white/20 hover:text-white"
                onClick={() => setSocialSharePreviewFullscreen(false)}
              >
                <Minimize2 className="size-3.5" />
                Exit
              </Button>
            </div>
          </div>
          <div
            className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 sm:p-6"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #2a2a2e 25%, transparent 25%), linear-gradient(-45deg, #2a2a2e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2e 75%), linear-gradient(-45deg, transparent 75%, #2a2a2e 75%)',
              backgroundSize: '20px 20px',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
              backgroundColor: '#18181b',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={socialShareCtx.imageUrl}
              alt="Share card full screen"
              className="h-auto max-h-[calc(100svh-5.5rem)] w-auto max-w-[min(100%,96vw)] rounded-2xl border border-white/10 object-contain shadow-2xl"
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          </div>
        </div>
      ) : null}

      <Dialog
        open={logoReplaceOpen}
        onOpenChange={(open) => {
          setLogoReplaceOpen(open)
          if (!open) {
            setLogoReplaceTicker('')
            setLogoReplaceCompany(null)
            setLogoPasteBusy(false)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace logo · {logoReplaceTicker || '—'}</DialogTitle>
            <DialogDescription>
              Google Images just opened in a new tab. Copy a logo there, come back, and paste it
              below — it updates the list + X share card for this ticker.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
            <TickerLogoMark
              symbol={logoReplaceTicker || '??'}
              size={48}
              customSrc={
                logoReplaceTicker ? customLogos[logoReplaceTicker] || null : null
              }
            />
            <div className="min-w-0 text-sm">
              <p className="font-semibold tracking-tight">{logoReplaceTicker}</p>
              {logoReplaceCompany ? (
                <p className="truncate text-muted-foreground">{logoReplaceCompany}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="logo-paste-input">Paste image here</Label>
            <Input
              id="logo-paste-input"
              placeholder="Click here, then ⌘/Ctrl+V to paste the logo image…"
              onPaste={(e) => void handleLogoPaste(e)}
              disabled={logoPasteBusy || !logoReplaceTicker}
              autoComplete="off"
              className="h-11"
            />
            <p className="text-[11px] text-muted-foreground">
              Right-click → Copy image on Google, then paste. Image URLs also work when the host
              allows it.
            </p>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {logoReplaceTicker && customLogos[logoReplaceTicker] ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => clearCustomLogo(logoReplaceTicker)}
                >
                  Clear custom
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                disabled={!logoReplaceTicker}
                onClick={() => {
                  const href = googleImagesSearchUrl(
                    logoReplaceTicker,
                    logoReplaceCompany,
                  )
                  window.open(href, '_blank', 'noopener,noreferrer')
                }}
              >
                Replace Image
              </Button>
            </div>
          </DialogFooter>
          {logoPasteBusy ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Saving logo…
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={tweetComposerOpen}
        onOpenChange={(open) => {
          setTweetComposerOpen(open)
          if (!open) {
            if (tweetImageUrl) {
              try {
                URL.revokeObjectURL(tweetImageUrl)
              } catch {
                /* ignore */
              }
            }
            setTweetImageUrl(null)
            setTweetImageBlob(null)
            setTweetThread(null)
            setTweetRenderCtx(null)
            setShareImageRerendering(false)
          }
        }}
      >
        <DialogContent className="flex max-h-[90svh] max-w-2xl flex-col gap-4 overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XIcon className="size-4" />
              X thread preview
            </DialogTitle>
            <DialogDescription>
              Review both posts. <strong>Start</strong> opens X in a <strong>new tab</strong> with
              tweet 1 (headline only) prefilled. Paste the image into tweet 1 if needed, then tap{' '}
              <strong>+</strong> and paste tweet 2 (Trigger app).
            </DialogDescription>
          </DialogHeader>

          {tweetComposerBusy || !tweetThread ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Building thread…
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {tweetImageUrl ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Tweet 1 image
                    </p>
                    {shareImageRerendering ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        Updating…
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="flex justify-center rounded-xl p-3"
                    style={{
                      backgroundImage:
                        'linear-gradient(45deg, #e4e4e7 25%, transparent 25%), linear-gradient(-45deg, #e4e4e7 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e4e4e7 75%), linear-gradient(-45deg, transparent 75%, #e4e4e7 75%)',
                      backgroundSize: '16px 16px',
                      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
                      backgroundColor: '#f4f4f5',
                    }}
                  >
                    <img
                      src={tweetImageUrl}
                      alt="Tweet share card"
                      className="mx-auto h-auto max-h-[min(52vh,520px)] w-auto max-w-full rounded-xl border border-black/10 object-contain shadow-lg"
                      style={{ maxWidth: '100%', height: 'auto' }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        if (!tweetImageBlob) return
                        const ok = await copyImageBlobToClipboard(tweetImageBlob)
                        toast({
                          title: ok ? 'Full-res image copied' : 'Could not copy image',
                          description: ok
                            ? 'Lossless PNG on clipboard — paste (⌘/Ctrl+V) into the first tweet on X.'
                            : 'Download the Full HD PNG and attach it on X instead.',
                          durationMs: 4000,
                        })
                      }}
                    >
                      Copy image
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      asChild={false}
                      onClick={() => {
                        downloadShareImage(tweetImageBlob, tweetRenderCtx?.ticker || 'momentum', {
                          width: shareCardStyle.canvasWidth ?? 1920,
                          height: Math.round(
                            (shareCardStyle.canvasWidth ?? 1920) *
                              (shareCardStyle.aspectRatio ?? 1.05),
                          ),
                        })
                      }}
                    >
                      Download HD
                    </Button>
                  </div>

                  <ShareCardLayoutControls
                    style={shareCardStyle}
                    onChange={updateShareCardStyle}
                    idPrefix="tweet-share"
                    textContent={tweetRenderCtx?.cardText}
                    onTextChange={(next) =>
                      setTweetRenderCtx((prev) =>
                        prev ? { ...prev, cardText: next } : prev,
                      )
                    }
                    onTextReset={() => {
                      if (!tweetRenderCtx) return
                      const exchangeTz = tickerExchangeTimeZone(
                        tweetRenderCtx.ticker,
                        liveQuotes[String(tweetRenderCtx.ticker || '').toUpperCase()] ||
                          null,
                      )
                      const defaults = buildShareCardTextContent(
                        tweetRenderCtx.ticker,
                        tweetRenderCtx.event,
                        tweetRenderCtx.companyName,
                        shareCardStyle,
                        exchangeTz,
                      )
                      setTweetRenderCtx((prev) =>
                        prev ? { ...prev, cardText: defaults } : prev,
                      )
                    }}
                    sideImageDataUrl={shareSideImageDataUrl}
                    onSideImageChange={setShareSideImageDataUrl}
                    googleSearchQuery={
                      tweetRenderCtx?.companyName &&
                      tweetRenderCtx.companyName !== tweetRenderCtx.ticker
                        ? tweetRenderCtx.companyName
                        : tweetRenderCtx?.ticker
                    }
                    titleIdentity={
                      tweetRenderCtx
                        ? {
                            ticker: tweetRenderCtx.ticker,
                            companyName: tweetRenderCtx.companyName,
                          }
                        : undefined
                    }
                    shareEvent={tweetRenderCtx?.event}
                    exchangeTimeZone={
                      tweetRenderCtx
                        ? tickerExchangeTimeZone(
                            tweetRenderCtx.ticker,
                            liveQuotes[
                              String(tweetRenderCtx.ticker || '').toUpperCase()
                            ] || null,
                          )
                        : EXCHANGE_TZ_FALLBACK
                    }
                    exchangeTimeZoneLabel={
                      tweetRenderCtx
                        ? liveQuotes[String(tweetRenderCtx.ticker || '').toUpperCase()]
                            ?.exchange || tweetRenderCtx.ticker
                        : null
                    }
                  />
                </div>
              ) : null}

              {(
                [
                  { key: '1', label: 'Tweet 1 · momentum', text: tweetThread.tweet1 },
                  { key: '2', label: 'Tweet 2 · Trigger app (+)', text: tweetThread.tweet2 },
                ] as const
              ).map((item) => (
                <div
                  key={item.key}
                  className="rounded-xl border border-border/60 bg-muted/20 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {item.label}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() =>
                        void copyTweetText(item.text, item.label.split(' · ')[0])
                      }
                    >
                      Copy
                    </Button>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                    {item.text}
                  </pre>
                  <p className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground">
                    {item.text.length}/280
                  </p>
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="shrink-0 gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTweetComposerOpen(false)}
            >
              Close
            </Button>
            <Button
              type="button"
              disabled={!tweetThread || tweetStartBusy || tweetComposerBusy}
              onClick={() => void handleTweetComposerStart()}
              className="gap-1.5"
            >
              {tweetStartBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <XIcon className="size-4" />
              )}
              Start · copy image + open X
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(usagePopup)}
        onOpenChange={(open) => {
          if (!open) {
            setUsagePopup(null)
            setUsageError('')
          }
        }}
      >
        <DialogContent
          className={cn(
            'overflow-y-auto',
            usagePopup === 'perplexity'
              ? 'fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 p-0 sm:max-w-none'
              : 'max-h-[85svh] max-w-lg',
          )}
        >
          <DialogHeader
            className={cn(
              usagePopup === 'perplexity' &&
                'shrink-0 border-b border-border px-5 py-4 sm:px-8',
            )}
          >
            <DialogTitle className="flex items-center gap-2">
              {usagePopup === 'gemini' ? (
                <>
                  <Sparkles className="size-4 text-violet-600" />
                  Gemini spend by day
                </>
              ) : usagePopup === 'perplexity' ? (
                <>
                  <Search className="size-4 text-sky-600" />
                  Perplexity credits & cost by day
                </>
              ) : (
                'Firecrawl credits by day'
              )}
            </DialogTitle>
            <DialogDescription>
              {usagePopup === 'gemini'
                ? 'Estimated USD + tokens from structured dates in Supabase (last 30 days ET).'
                : usagePopup === 'perplexity'
                  ? 'App-tracked spend from each momentum research call (last 90 days ET). Token credits = total tokens. Prepaid remaining balance is only on Perplexity’s console (API does not expose it).'
                  : 'Credits used per day from scrape ledger (last 30 days). Remaining balance is live from Firecrawl.'}
            </DialogDescription>
          </DialogHeader>

          {usageLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : null}
          {usageError ? (
            <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {usageError}
            </div>
          ) : null}

          <div
            className={cn(
              usagePopup === 'perplexity' &&
                'min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8 sm:py-6',
            )}
          >
          {!usageLoading && !usageError && usagePopup === 'gemini' ? (
            <div className="space-y-3">
              <div className="rounded-xl border bg-violet-500/5 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total · 30d </span>
                <span className="font-semibold tabular-nums text-violet-900 dark:text-violet-100">
                  {geminiUsageTotals?.total_cost_usd_display || '$0.000000'}
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  · {(geminiUsageTotals?.total_tokens || 0).toLocaleString()} tokens
                </span>
              </div>
              {geminiDailyUsage.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No Gemini usage logged yet.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Day (ET)</th>
                        <th className="px-3 py-2 font-medium">Cost</th>
                        <th className="px-3 py-2 font-medium">Tokens</th>
                        <th className="px-3 py-2 font-medium">Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {geminiDailyUsage.map((row) => (
                        <tr key={row.day} className="border-t border-border/60">
                          <td className="px-3 py-2 tabular-nums">{row.day}</td>
                          <td className="px-3 py-2 font-medium tabular-nums">
                            {row.cost_usd_display || formatUsdCompact(row.cost_usd)}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
                            {(row.total_tokens || 0).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
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

          {!usageLoading && !usageError && usagePopup === 'perplexity' ? (
            <div className="mx-auto w-full max-w-5xl space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Total cost
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-sky-900 dark:text-sky-100">
                    {perplexityUsageTotals?.total_cost_usd_display ||
                      perplexityTotals?.total_cost_usd_display ||
                      '$0.000000'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    All tracked research calls
                  </p>
                </div>
                <div className="rounded-2xl border bg-muted/30 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Token credits used
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {(
                      perplexityUsageTotals?.total_credits ??
                      perplexityTotals?.total_credits ??
                      0
                    ).toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Sum of total tokens per call
                  </p>
                </div>
                <div className="rounded-2xl border bg-muted/30 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Research calls
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {(
                      perplexityUsageTotals?.total_calls ??
                      perplexityTotals?.total_calls ??
                      0
                    ).toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Last 90 days (ET)
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
                <p>
                  {perplexityUsageTotals?.balance_note ||
                    'Remaining prepaid balance is only on Perplexity console — not available via API.'}
                </p>
                <a
                  href={
                    perplexityUsageTotals?.console_url ||
                    'https://www.perplexity.ai/account/api/billing'
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 font-semibold text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
                >
                  Open Perplexity API billing
                  <ExternalLink className="size-3.5 opacity-70" />
                </a>
              </div>

              {perplexityDailyUsage.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No Perplexity usage logged yet. Run momentum research once to start tracking.
                </p>
              ) : (
                <div className="overflow-hidden rounded-2xl border shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Day (ET)</th>
                        <th className="px-4 py-3 font-medium">Cost</th>
                        <th className="px-4 py-3 font-medium">Token credits</th>
                        <th className="px-4 py-3 font-medium">Calls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perplexityDailyUsage.map((row) => (
                        <tr
                          key={row.day}
                          className="border-t border-border/60 hover:bg-muted/20"
                        >
                          <td className="px-4 py-3 font-medium tabular-nums">
                            {row.day}
                          </td>
                          <td className="px-4 py-3 font-semibold tabular-nums text-sky-900 dark:text-sky-100">
                            {row.cost_usd_display || formatUsdCompact(row.cost_usd)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">
                            {(row.credits_used || row.total_tokens || 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">
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

          {!usageLoading && !usageError && usagePopup === 'firecrawl' ? (
            <div className="space-y-3">
              <div className="rounded-xl border bg-muted/30 px-3 py-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Used · 30d </span>
                  <span className="font-semibold tabular-nums">
                    {(firecrawlUsageTotals?.total_credits || 0).toLocaleString()} credits
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Live remaining:{' '}
                  <span className="font-medium text-foreground">
                    {firecrawlUsageTotals?.balance?.remaining_credits != null
                      ? firecrawlUsageTotals.balance.plan_credits != null
                        ? `${firecrawlUsageTotals.balance.remaining_credits} / ${firecrawlUsageTotals.balance.plan_credits}`
                        : String(firecrawlUsageTotals.balance.remaining_credits)
                      : firecrawlCredits?.remaining != null
                        ? String(firecrawlCredits.remaining)
                        : '—'}
                  </span>
                </div>
                {firecrawlUsageTotals?.note ? (
                  <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-200">
                    {firecrawlUsageTotals.note}
                  </p>
                ) : null}
              </div>
              {firecrawlDailyUsage.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No Firecrawl credit rows yet. Run scrapes after applying{' '}
                  <code className="text-xs">schema_usage_and_jobs.sql</code>.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Day</th>
                        <th className="px-3 py-2 font-medium">Credits</th>
                        <th className="px-3 py-2 font-medium">Scrapes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {firecrawlDailyUsage.map((row) => (
                        <tr key={row.day} className="border-t border-border/60">
                          <td className="px-3 py-2 tabular-nums">{row.day}</td>
                          <td className="px-3 py-2 font-medium tabular-nums">
                            {(row.credits_used || 0).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
                            {row.scrapes ?? '—'}
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

          <DialogFooter
            className={cn(
              usagePopup === 'perplexity' &&
                'shrink-0 border-t border-border px-5 py-3 sm:px-8',
            )}
          >
            <Button type="button" variant="outline" onClick={() => setUsagePopup(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={fetchAllHitsOpen}
        onOpenChange={(open) => {
          // Don't dismiss mid-run by accident — only allow close when idle.
          if (allTickersLoading) return
          setFetchAllHitsOpen(open)
        }}
      >
        <DialogContent className="flex max-h-[90svh] max-w-4xl flex-col gap-4 overflow-hidden">
          <div className="flex shrink-0 items-start justify-between gap-3 pr-6">
            <DialogHeader className="min-w-0 flex-1 space-y-1.5 pr-0">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {fetchAllMode === 'nine_pm' ? '9 PM alert' : 'Fetch & save all'}
                {allTickersLoading ? (
                  <Badge variant="secondary" className="gap-1.5 tabular-nums">
                    <Loader2 className="size-3 animate-spin" />
                    {allTickersProgress.completed}/{allTickersProgress.total}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="tabular-nums">
                    {allTickersProgress.completed}/
                    {allTickersProgress.total || fetchAllRows.length} done
                  </Badge>
                )}
                <Badge className="bg-emerald-500/15 tabular-nums text-emerald-800 dark:text-emerald-200">
                  {fetchAllRows.reduce((n, r) => n + r.hits.length, 0)}
                  {fetchAllMode === 'nine_pm' ? ' · new/updated' : ' · ≥4%'}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                {fetchAllMode === 'nine_pm'
                  ? 'Fetch all subscribed stocks → Gemini on every new/updated date (no 4% filter). Review, then Alert all sends Today’s digest to all Trigger users.'
                  : 'Live fetch list. ≥4% uses regular close and pre-market only. Gemini auto-runs on those hits; Alert all pushes each hit to its subscribers.'}
              </DialogDescription>
              {fetchAllDigestMsg ? (
                <p className="text-xs text-sky-800 dark:text-sky-200">{fetchAllDigestMsg}</p>
              ) : null}
            </DialogHeader>
            <Button
              type="button"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={
                fetchAllAlertAllBusy ||
                allTickersLoading ||
                (fetchAllMode !== 'nine_pm' &&
                  fetchAllRows.every((r) => !r.hits.length))
              }
              onClick={() => void handleFetchAllAlertAll()}
              title={
                fetchAllMode === 'nine_pm'
                  ? "Send Today’s notable momentum digest to all Trigger users"
                  : 'Alert all subscribers for every ≥4% hit in this run'
              }
            >
              {fetchAllAlertAllBusy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <BellRing className="size-3.5" />
              )}
              {fetchAllMode === 'nine_pm' ? 'Alert all · digest' : 'Alert all'}
              {fetchAllMode !== 'nine_pm' && fetchAllRows.some((r) => r.hits.length) ? (
                <span className="tabular-nums opacity-80">
                  ({fetchAllRows.reduce((n, r) => n + r.hits.length, 0)})
                </span>
              ) : null}
            </Button>
          </div>

          {allTickersLoading ? (
            <div className="h-1.5 w-full shrink-0 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-300"
                style={{
                  width: `${
                    allTickersProgress.total
                      ? Math.round(
                          (allTickersProgress.completed / allTickersProgress.total) * 100,
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
          ) : null}

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {fetchAllRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                No subscribed tickers to fetch.
              </div>
            ) : (
              fetchAllRows.map((row) => {
                const isLoading = row.status === 'loading'
                const isQueued = row.status === 'queued'
                const isError = row.status === 'error'
                const isSkipped = row.status === 'skipped'
                const isDone = row.status === 'done'
                return (
                  <div
                    key={row.ticker}
                    className={cn(
                      'rounded-2xl border px-4 py-3 shadow-sm transition-colors',
                      isLoading
                        ? 'border-sky-500/40 bg-sky-500/5'
                        : isError
                          ? 'border-destructive/35 bg-destructive/5'
                          : row.hits.length
                            ? 'border-emerald-500/30 bg-card'
                            : 'border-border/70 bg-card',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-base font-semibold tracking-tight">
                          {row.ticker}
                        </span>
                        {row.company_name && row.company_name !== row.ticker ? (
                          <Badge variant="secondary" className="rounded-full">
                            {row.company_name}
                          </Badge>
                        ) : null}
                        <span className="text-[11px] text-muted-foreground">
                          {row.subscriber_count} subscriber
                          {row.subscriber_count === 1 ? '' : 's'}
                        </span>
                        {isLoading ? (
                          <Badge
                            variant="outline"
                            className="gap-1 border-sky-500/40 text-sky-800 dark:text-sky-200"
                          >
                            <Loader2 className="size-3 animate-spin" />
                            Fetching…
                          </Badge>
                        ) : null}
                        {isQueued ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            Queued
                          </Badge>
                        ) : null}
                        {isSkipped ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            Skipped
                          </Badge>
                        ) : null}
                        {isError ? (
                          <Badge className="bg-destructive/15 text-destructive">
                            Failed
                          </Badge>
                        ) : null}
                        {isDone && !row.hits.length ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            {fetchAllMode === 'nine_pm'
                              ? row.new_dates
                                ? `${row.new_dates} pending · none listed`
                                : 'No new/updated dates'
                              : row.new_dates
                                ? `${row.new_dates} new · no ≥4%`
                                : 'No new ≥4% moves'}
                          </Badge>
                        ) : null}
                        {isDone && row.hits.length ? (
                          <Badge className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-200">
                            {row.hits.length}
                            {fetchAllMode === 'nine_pm' ? ' · new/updated' : ' · ≥4%'}
                          </Badge>
                        ) : null}
                      </div>
                      {isLoading ? (
                        <Loader2 className="size-5 animate-spin text-sky-600" />
                      ) : null}
                    </div>

                    {isError && row.error ? (
                      <p className="mt-2 text-xs text-destructive">{row.error}</p>
                    ) : null}

                    {isLoading ? (
                      <p className="mt-2 text-xs text-sky-800 dark:text-sky-200">
                        Scraping &amp; auto-saving… details appear when this ticker finishes.
                      </p>
                    ) : null}

                    {isDone && row.hits.length > 0 ? (
                      <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
                        {row.hits.map((hit) => {
                          const hitKey = `${hit.ticker}|${hit.event.event_date}`
                          const alertMsg = fetchAllAlertMsg[hitKey]
                          const geminiRunning =
                            hit.gemini_status === 'running' ||
                            geminiBusyKey ===
                              geminiEventKey(hit.ticker, hit.event, 'summary')
                          return (
                            <div
                              key={hitKey}
                              className="rounded-xl border border-border/60 bg-background/80 px-3 py-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className="text-muted-foreground"
                                  >
                                    {formatEventHeading(hit.event)}
                                  </Badge>
                                  {hit.event.price ? (
                                    <span className="font-mono text-[11px] text-muted-foreground">
                                      Close price {hit.event.price}
                                    </span>
                                  ) : null}
                                  {hit.gemini_status === 'done' ? (
                                    <Badge className="gap-1 bg-violet-500/15 text-violet-900 dark:text-violet-100">
                                      <Sparkles className="size-3" />
                                      Gemini done
                                    </Badge>
                                  ) : null}
                                  {hit.gemini_status === 'running' || geminiRunning ? (
                                    <Badge
                                      variant="outline"
                                      className="gap-1 border-violet-500/40 text-violet-900 dark:text-violet-100"
                                    >
                                      <Loader2 className="size-3 animate-spin" />
                                      Gemini…
                                    </Badge>
                                  ) : null}
                                  {hit.gemini_status === 'error' ? (
                                    <Badge className="bg-destructive/15 text-destructive">
                                      Gemini failed
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5 border-violet-500/40 bg-violet-500/10 text-violet-950 hover:bg-violet-500/15 dark:text-violet-100"
                                    disabled={
                                      geminiRunning ||
                                      geminiEditSaving ||
                                      geminiPromptRunning
                                    }
                                    onClick={() => void runFetchAllAutoGemini(hit)}
                                    title="Re-run Gemini structure + save"
                                  >
                                    {geminiRunning ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Sparkles className="size-3.5 text-violet-600" />
                                    )}
                                    {hit.gemini_status === 'done' ? 'Re-run Gemini' : 'Gemini'}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={hit.subscriber_count === 0}
                                    onClick={() => handleFetchAllOpenAlertPicker(hit)}
                                    title="Preview notification, choose recipients, then send"
                                  >
                                    <BellRing className="size-3.5" />
                                    Preview &amp; send
                                    {hit.subscriber_count > 0
                                      ? ` (${hit.subscriber_count})`
                                      : ''}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5"
                                    onClick={() =>
                                      void openSocialShare(
                                        hit.ticker,
                                        hit.event,
                                        hit.company_name,
                                      )
                                    }
                                    title="Share on social media"
                                  >
                                    <Share2 className="size-3.5" />
                                    Share
                                  </Button>
                                </div>
                              </div>

                              {/* Separate regular vs pre-market sections (no after-hours) */}
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Regular / close
                                  </p>
                                  {hit.close_text ? (
                                    <p
                                      className={cn(
                                        'mt-1 font-mono text-sm font-semibold tabular-nums',
                                        hit.close_negative
                                          ? 'text-red-700 dark:text-red-300'
                                          : 'text-emerald-800 dark:text-emerald-200',
                                      )}
                                    >
                                      {hit.close_text}
                                      {hit.close_abs != null ? (
                                        <span className="ml-1.5 text-xs font-normal opacity-70">
                                          · abs {hit.close_abs.toFixed(1)}%
                                        </span>
                                      ) : null}
                                    </p>
                                  ) : (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      No close move
                                    </p>
                                  )}
                                </div>
                                <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Pre-market
                                  </p>
                                  {hit.premarket_text ? (
                                    <p
                                      className={cn(
                                        'mt-1 font-mono text-sm font-semibold tabular-nums',
                                        hit.premarket_negative
                                          ? 'text-red-700 dark:text-red-300'
                                          : 'text-emerald-800 dark:text-emerald-200',
                                      )}
                                    >
                                      {hit.premarket_text}
                                      {hit.premarket_abs != null ? (
                                        <span className="ml-1.5 text-xs font-normal opacity-70">
                                          · abs {hit.premarket_abs.toFixed(1)}%
                                        </span>
                                      ) : null}
                                    </p>
                                  ) : (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      No pre-market move
                                    </p>
                                  )}
                                </div>
                              </div>

                              <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                                {String(hit.event.summary || '').trim() ||
                                  'No reason text yet'}
                              </p>
                              {hit.gemini_error ? (
                                <p className="mt-1 text-xs text-destructive">
                                  {hit.gemini_error}
                                </p>
                              ) : null}
                              {alertMsg ? (
                                <p className="mt-1 text-xs text-sky-800 dark:text-sky-200">
                                  {alertMsg}
                                </p>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>

          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              disabled={allTickersLoading}
              onClick={() => setFetchAllHitsOpen(false)}
            >
              {allTickersLoading ? 'Running…' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(fetchErrorPopup)}
        onOpenChange={(open) => {
          if (!open) setFetchErrorPopup(null)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-5" />
            </div>
            <DialogTitle>
              {fetchErrorPopup?.stage === 'auto-save'
                ? `Auto-save failed for ${fetchErrorPopup?.ticker || 'ticker'}`
                : `Fetch failed for ${fetchErrorPopup?.ticker || 'ticker'}`}
            </DialogTitle>
            <DialogDescription>
              {fetchErrorPopup?.stage === 'auto-save'
                ? 'The scrape completed, but its new or changed movement data was not confirmed as saved. Nothing is being silently ignored.'
                : 'The ticker could not be scraped, so no save was attempted.'}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
              Error detail
            </p>
            <p className="mt-1 break-words text-sm text-foreground">
              {fetchErrorPopup?.message}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(
                fetchErrorPopup && tabState[fetchErrorPopup.ticker]?.loading,
              )}
              onClick={() => setFetchErrorPopup(null)}
            >
              Dismiss
            </Button>
            <Button
              type="button"
              disabled={Boolean(
                fetchErrorPopup && tabState[fetchErrorPopup.ticker]?.loading,
              )}
              onClick={() => void handleRetryFetchError()}
            >
              {fetchErrorPopup && tabState[fetchErrorPopup.ticker]?.loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Retry fetch & auto-save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={movementAlertOpen}
        onOpenChange={(open) => {
          setMovementAlertOpen(open)
          if (!open) {
            setMovementAlertTarget(null)
            setMovementAlertDeviceKeys([])
            setMovementPreviewTitle('')
            setMovementPreviewBody('')
            setMovementPreviewError('')
          }
        }}
      >
        <DialogContent className="max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Send {movementAlertTarget?.ticker || ''} alert
            </DialogTitle>
            <DialogDescription>
              {notificationApp === 'trigger' ? 'Trigger' : '9AM'} app ·{' '}
              {movementAlertTarget?.event
                ? `${formatEventHeading(movementAlertTarget.event)} movement only`
                : 'latest saved movement'}
            </DialogDescription>
          </DialogHeader>

          <section className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_0.9fr]">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Editable notification</p>
                  <p className="text-[11px] text-muted-foreground">
                    Changes apply only to this send.
                  </p>
                </div>
                {movementPreviewLoading ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : null}
              </div>
              {movementPreviewError ? (
                <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {movementPreviewError}
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="movement-alert-title">Title</Label>
                <Input
                  id="movement-alert-title"
                  value={movementPreviewTitle}
                  disabled={movementPreviewLoading}
                  maxLength={120}
                  placeholder="Notification title"
                  onChange={(event) => setMovementPreviewTitle(event.target.value)}
                />
                <p className="text-right text-[10px] text-muted-foreground">
                  {movementPreviewTitle.length}/120
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="movement-alert-body">Body</Label>
                <Textarea
                  id="movement-alert-body"
                  value={movementPreviewBody}
                  disabled={movementPreviewLoading}
                  maxLength={400}
                  rows={4}
                  className="min-h-24 resize-y"
                  placeholder="Notification body"
                  onChange={(event) => setMovementPreviewBody(event.target.value)}
                />
                <p className="text-right text-[10px] text-muted-foreground">
                  {movementPreviewBody.length}/400
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-neutral-950 p-3 text-white">
              <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">
                Live preview
              </p>
              <div className="rounded-2xl bg-white/95 p-3 text-neutral-900 shadow-xl">
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex size-6 items-center justify-center rounded-md bg-neutral-900 text-[10px] font-bold text-white">
                    {notificationApp === 'trigger' ? <Zap className="size-3" /> : '9'}
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {notificationApp === 'trigger' ? 'Trigger' : '9AM'}
                  </span>
                  <span className="ml-auto text-[10px] text-neutral-400">now</span>
                </div>
                <p className="break-words text-[14px] font-semibold leading-snug">
                  {movementPreviewTitle || 'Notification title'}
                </p>
                <p className="mt-1 break-words text-[12px] leading-snug text-neutral-600">
                  {movementPreviewBody || 'Notification body'}
                </p>
              </div>
              <p className="mt-3 text-center text-[10px] text-white/40">
                Text-only push · opens {notificationApp === 'trigger' ? 'Trigger' : '9AM'}
              </p>
            </div>
          </section>

          <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Recipients</p>
              <p className="text-xs text-muted-foreground">
                {movementAlertSelectedCount} of {movementAlertDevices.length} selected
                {movementAlertTarget?.allRecipients
                  ? ' · all app devices (not only ticker subscribers)'
                  : ''}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!movementAlertDevices.length}
                onClick={() =>
                  setMovementAlertDeviceKeys(movementAlertDevices.map(deviceKey))
                }
              >
                Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!movementAlertSelectedCount}
                onClick={() => setMovementAlertDeviceKeys([])}
              >
                Clear
              </Button>
            </div>
          </div>

          {movementAlertTarget?.allRecipients ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-950 dark:text-amber-100">
              Extreme / Pinned alert: list shows every{' '}
              {notificationApp === 'trigger' ? 'Trigger' : '9AM'} device, even if they never
              subscribed to {movementAlertTarget.ticker}. Nothing is pre-selected — use Select all
              or pick devices, then send.
            </div>
          ) : null}

          <div className="min-h-0 max-h-[30svh] space-y-2 overflow-y-auto pr-1">
            {!movementAlertDevices.length ? (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center">
                <p className="text-sm font-medium">
                  {movementAlertTarget?.allRecipients
                    ? 'No alertable devices'
                    : 'No subscribed devices'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {movementAlertTarget?.allRecipients
                    ? `No enabled ${notificationApp === 'trigger' ? 'Trigger' : '9AM'} devices with push tokens.`
                    : `No ${notificationApp === 'trigger' ? 'Trigger' : '9AM'} users are subscribed to ${movementAlertTarget?.ticker}.`}
                </p>
              </div>
            ) : null}
            {movementAlertDevices.map((device) => {
              const key = deviceKey(device)
              const checked = movementAlertDeviceKeys.includes(key)
              const token = device.expo_push_token
              const maskedToken =
                token.length > 30 ? `${token.slice(0, 20)}…${token.slice(-8)}` : token
              const watchesTarget =
                movementAlertTarget?.ticker &&
                (device.tickers || []).some(
                  (item) => item.toUpperCase() === movementAlertTarget.ticker.toUpperCase(),
                )
              return (
                <label
                  key={key}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                    checked
                      ? 'border-foreground bg-muted/50'
                      : 'border-border hover:bg-muted/30',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-foreground"
                    checked={checked}
                    onChange={() =>
                      toggleDeviceKey(
                        key,
                        movementAlertDeviceKeys,
                        setMovementAlertDeviceKeys,
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {device.device_id || 'Unknown device'}
                      </span>
                      <Badge variant="secondary" className="text-[10px]">
                        {notificationApp === 'trigger' ? 'Trigger' : '9AM'}
                      </Badge>
                      {movementAlertTarget?.allRecipients ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            watchesTarget
                              ? 'border-emerald-500/40 text-emerald-800 dark:text-emerald-200'
                              : 'text-muted-foreground',
                          )}
                        >
                          {watchesTarget ? 'Subscribed' : 'Not subscribed'}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                      {maskedToken}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      Tickers: {device.tickers?.join(', ') || 'none'}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={activeState.alerting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={
                !movementAlertSelectedCount ||
                activeState.alerting ||
                movementPreviewLoading ||
                !movementPreviewTitle.trim() ||
                !movementPreviewBody.trim()
              }
              onClick={() => void handleAlertUsers()}
            >
              {activeState.alerting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BellRing className="size-4" />
              )}
              Send to {movementAlertSelectedCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={digestOpen}
        onOpenChange={(open) => {
          setDigestOpen(open)
          if (!open) {
            setDigestScopeDeviceKeys([])
            setDigestSelectedDeviceKeys([])
          }
        }}
      >
        <DialogContent className="max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Trigger momentum alert</DialogTitle>
            <DialogDescription>
              Each selected user receives a personalized body containing only their subscribed
              tickers and latest saved momentum.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="digest-title">Notification header</Label>
            <Input
              id="digest-title"
              value={digestTitle}
              maxLength={120}
              disabled={digestSending}
              onChange={(event) => setDigestTitle(event.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Trigger recipients</p>
              <p className="text-xs text-muted-foreground">
                {digestSelectedCount} of {digestDevices.length} selected
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!digestDevices.length || digestSending}
                onClick={() => setDigestSelectedDeviceKeys(digestDevices.map(deviceKey))}
              >
                Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!digestSelectedCount || digestSending}
                onClick={() => setDigestSelectedDeviceKeys([])}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="max-h-[50svh] space-y-2 overflow-y-auto pr-1">
            {digestDevices.map((device) => {
              const key = deviceKey(device)
              const checked = digestSelectedDeviceKeys.includes(key)
              const body = triggerDigestBody(device)
              return (
                <label
                  key={key}
                  className={cn(
                    'block cursor-pointer rounded-xl border p-3 transition-colors',
                    checked
                      ? 'border-foreground bg-muted/40'
                      : 'border-border opacity-65 hover:opacity-100',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-foreground"
                      checked={checked}
                      disabled={digestSending}
                      onChange={() =>
                        toggleDeviceKey(
                          key,
                          digestSelectedDeviceKeys,
                          setDigestSelectedDeviceKeys,
                        )
                      }
                    />
                    <span className="font-mono text-sm font-semibold">
                      {device.device_id || 'Unknown device'}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {device.tickers?.length || 0} tickers
                    </Badge>
                  </span>
                  <span className="mt-3 block rounded-xl bg-neutral-950 p-3 text-white shadow-sm">
                    <span className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/55">
                      <Zap className="size-3" />
                      Trigger · now
                    </span>
                    <span className="mt-2 block text-sm font-semibold">
                      {digestTitle || "Today's notable price momentum"}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-white/70">
                      {body}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={digestSending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={!digestSelectedCount || !digestTitle.trim() || digestSending}
              onClick={() => void handleTriggerDigestSend()}
            >
              {digestSending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BellRing className="size-4" />
              )}
              Send to {digestSelectedCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
