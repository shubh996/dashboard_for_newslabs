import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  ArrowUpDown,
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  ExternalLink,
  Copy,
  Download,
  Loader2,
  Moon,
  Newspaper,
  PenLine,
  RefreshCw,
  Save,
  Share2,
  Sparkles,
  Sun,
  Terminal,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useBottomToast } from '@/components/ui/bottom-toast'
import { readPref, writePref } from '@/lib/prefs'
import { fetchYahooQuote } from '@/services/yahooApi'

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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type DashboardSection = 'tickers' | 'news' | 'custom' | 'users'
type TickerSortMode = 'subscribers' | 'name' | 'ticker' | 'saved'
type NotificationApp = 'nineam' | 'trigger'
type MovementAlertTarget = {
  ticker: string
  event: PriceMovementEvent | null
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
  tickers: string[]
  /** True when this token subscribed to crypto (pro access signal). */
  pro_crypto?: boolean
  crypto_tickers?: string[]
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
  const words = String(text || '')
    .split(/\s+/)
    .filter(Boolean)
  const out: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      out.push(line)
      line = word
      if (out.length >= maxLines) {
        // Ellipsize the last committed line if more content remains
        let last = out[out.length - 1]
        while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
          last = last.slice(0, -1)
        }
        out[out.length - 1] = `${last}…`
        return out
      }
    } else {
      line = test
    }
  }
  if (line) {
    if (out.length >= maxLines) {
      let last = out[out.length - 1]
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1)
      }
      out[out.length - 1] = `${last}…`
    } else {
      out.push(line)
    }
  }
  return out.slice(0, maxLines)
}

/** Draw wrapped text; returns y of the last line baseline. */
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): number {
  const lines = measureWrappedText(ctx, text, maxWidth, maxLines)
  let cy = y
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i], x, cy)
    if (i < lines.length - 1) cy += lineHeight
  }
  return cy
}

/**
 * Build a simple mini sparkline path (synthetic, direction-aware).
 * Not real OHLC — visual only for the share card.
 */
function buildMiniChartPoints(
  width: number,
  height: number,
  isDown: boolean,
  seed: string,
): Array<{ x: number; y: number }> {
  // Deterministic wobble from ticker string
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
    // Drift up or down overall
    const drift = isDown ? -0.35 * t : 0.35 * t
    const noise = (rand() - 0.5) * 0.18
    v = Math.max(0.08, Math.min(0.92, v + noise + drift * 0.08))
    // Final push toward end direction
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
    // data: URLs don't need CORS; proxy is same-origin
    if (!url.startsWith('data:')) {
      /* same-origin proxy or data url */
    }
    img.onload = () => resolve(img)
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

/** Resize pasted image → compact data URL for localStorage. */
async function blobToLogoDataUrl(blob: Blob, maxPx = 160): Promise<string> {
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

/** Positive % / up-chart — dark green that reads clean on brand yellow (not washed emerald). */
const SHARE_UP_GREEN = '#15803d'
const SHARE_DOWN_RED = '#DC2626'

/** Mini sparkline only — no panel background, no grid, no border. */
function drawMiniChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  isDown: boolean,
  seed: string,
  cardBgHex = '#F5B800',
) {
  const pts = buildMiniChartPoints(width, height, isDown, seed)
  if (!pts.length) return

  // Stronger colors so the line reads on card bg
  const lineColor = isDown ? SHARE_DOWN_RED : SHARE_UP_GREEN
  const fillTop = isDown ? 'rgba(220,38,38,0.28)' : 'rgba(21,128,61,0.30)'
  const fillBot = hexToRgba(cardBgHex, 0)

  // Soft area under the sparkline (no solid panel behind chart)
  const area = ctx.createLinearGradient(0, y, 0, y + height)
  area.addColorStop(0, fillTop)
  area.addColorStop(1, fillBot)
  ctx.beginPath()
  ctx.moveTo(x + pts[0].x, y + pts[0].y)
  for (let i = 1; i < pts.length; i += 1) {
    ctx.lineTo(x + pts[i].x, y + pts[i].y)
  }
  ctx.lineTo(x + pts[pts.length - 1].x, y + height)
  ctx.lineTo(x + pts[0].x, y + height)
  ctx.closePath()
  ctx.fillStyle = area
  ctx.fill()

  // Main sparkline — thicker for share card
  ctx.beginPath()
  ctx.moveTo(x + pts[0].x, y + pts[0].y)
  for (let i = 1; i < pts.length; i += 1) {
    ctx.lineTo(x + pts[i].x, y + pts[i].y)
  }
  ctx.strokeStyle = lineColor
  ctx.lineWidth = 9
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()

  // End dot — ring matches card so it pops on any bg
  const last = pts[pts.length - 1]
  ctx.beginPath()
  ctx.arc(x + last.x, y + last.y, 12, 0, Math.PI * 2)
  ctx.fillStyle = lineColor
  ctx.fill()
  ctx.strokeStyle = cardBgHex
  ctx.lineWidth = 3
  ctx.stroke()
}

type ShareCardColorId =
  | 'yellow'
  | 'white'
  | 'black'
  | 'cream'
  | 'navy'
  | 'orange'
  | 'slate'

type ShareTextColorId = 'black' | 'grey' | 'white'

const SHARE_CARD_COLOR_PRESETS: Array<{
  id: ShareCardColorId
  label: string
  bg: string
  /** Suggested body text when this card color is picked */
  defaultText: ShareTextColorId
}> = [
  { id: 'yellow', label: 'Yellow', bg: '#F5B800', defaultText: 'black' },
  { id: 'cream', label: 'Cream', bg: '#FFF4D6', defaultText: 'black' },
  { id: 'white', label: 'White', bg: '#FFFFFF', defaultText: 'black' },
  { id: 'orange', label: 'Orange', bg: '#F97316', defaultText: 'black' },
  { id: 'slate', label: 'Slate', bg: '#334155', defaultText: 'white' },
  { id: 'navy', label: 'Navy', bg: '#0F172A', defaultText: 'white' },
  { id: 'black', label: 'Black', bg: '#111111', defaultText: 'white' },
]

function shareCardBgHex(id: ShareCardColorId | undefined): string {
  const found = SHARE_CARD_COLOR_PRESETS.find((p) => p.id === id)
  return found?.bg || SHARE_CARD_COLOR_PRESETS[0].bg
}

function shareTextFillColor(color: ShareTextColorId | undefined): string {
  if (color === 'white') return '#FFFFFF'
  if (color === 'grey') return '#6B7280'
  return '#111111'
}

function shareTextMutedColor(color: ShareTextColorId | undefined): string {
  if (color === 'white') return 'rgba(255, 255, 255, 0.72)'
  if (color === 'grey') return 'rgba(107, 114, 128, 0.85)'
  return 'rgba(17, 17, 17, 0.62)'
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = String(hex || '').replace('#', '').trim()
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  if (full.length !== 6) return `rgba(0,0,0,${alpha})`
  const n = parseInt(full, 16)
  if (!Number.isFinite(n)) return `rgba(0,0,0,${alpha})`
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

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
  /** Outer content padding (px at 1080 width) */
  imagePadding: number
  stampFontSize: number
  reasonFontSize: number
  /** Company name weight */
  nameBold: boolean
  /** Reason / likely-driver weight */
  reasonBold: boolean
  /** Show company name vs ticker symbol as the title */
  titleMode: 'company' | 'ticker'
  /**
   * When true (default), date · timestamp is on the footer row (left of “Track at Trigger”).
   * When false, date stamp sits under the share price (right, under %).
   */
  dateInFooter: boolean
}

const DEFAULT_SHARE_CARD_STYLE: ShareCardStyle = {
  gapBeforeChart: 10,
  gapAfterChart: 142,
  logoSize: 106,
  nameFontSize: 60,
  pctFontSize: 90,
  priceFontSize: 32,
  priceFontWeight: 600,
  priceColor: 'black',
  cardColor: 'yellow',
  textColor: 'black',
  imagePadding: 48,
  stampFontSize: 30,
  reasonFontSize: 60,
  nameBold: true,
  reasonBold: false,
  titleMode: 'company',
  dateInFooter: true,
}

const SHARE_CARD_STYLE_PREF_KEY = 'share-card-style-v1'

function loadShareCardStyle(): ShareCardStyle {
  try {
    const raw = readPref(SHARE_CARD_STYLE_PREF_KEY)
    if (!raw) return { ...DEFAULT_SHARE_CARD_STYLE }
    const parsed = JSON.parse(raw) as Partial<ShareCardStyle>
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SHARE_CARD_STYLE }
    const priceColor =
      parsed.priceColor === 'white' || parsed.priceColor === 'grey'
        ? parsed.priceColor
        : 'black'
    const textColor =
      parsed.textColor === 'white' || parsed.textColor === 'grey'
        ? parsed.textColor
        : 'black'
    const cardColor = SHARE_CARD_COLOR_PRESETS.some((p) => p.id === parsed.cardColor)
      ? (parsed.cardColor as ShareCardColorId)
      : 'yellow'
    const titleMode = parsed.titleMode === 'ticker' ? 'ticker' : 'company'
    const imagePadding = Number(parsed.imagePadding)
    return {
      ...DEFAULT_SHARE_CARD_STYLE,
      ...parsed,
      priceColor,
      textColor,
      cardColor,
      titleMode,
      // Booleans / numbers may come partial — re-assert critical fields
      gapBeforeChart: Number(parsed.gapBeforeChart) || DEFAULT_SHARE_CARD_STYLE.gapBeforeChart,
      gapAfterChart: Number(parsed.gapAfterChart) || DEFAULT_SHARE_CARD_STYLE.gapAfterChart,
      logoSize: Number(parsed.logoSize) || DEFAULT_SHARE_CARD_STYLE.logoSize,
      nameFontSize: Number(parsed.nameFontSize) || DEFAULT_SHARE_CARD_STYLE.nameFontSize,
      pctFontSize: Number(parsed.pctFontSize) || DEFAULT_SHARE_CARD_STYLE.pctFontSize,
      priceFontSize: Number(parsed.priceFontSize) || DEFAULT_SHARE_CARD_STYLE.priceFontSize,
      priceFontWeight: Number(parsed.priceFontWeight) || DEFAULT_SHARE_CARD_STYLE.priceFontWeight,
      imagePadding:
        Number.isFinite(imagePadding) && imagePadding >= 16
          ? Math.min(120, Math.round(imagePadding))
          : DEFAULT_SHARE_CARD_STYLE.imagePadding,
      stampFontSize: Number(parsed.stampFontSize) || DEFAULT_SHARE_CARD_STYLE.stampFontSize,
      reasonFontSize: Number(parsed.reasonFontSize) || DEFAULT_SHARE_CARD_STYLE.reasonFontSize,
      nameBold: parsed.nameBold !== undefined ? Boolean(parsed.nameBold) : true,
      reasonBold: parsed.reasonBold !== undefined ? Boolean(parsed.reasonBold) : false,
      dateInFooter: parsed.dateInFooter !== undefined ? Boolean(parsed.dateInFooter) : true,
    }
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
 * If DB only has ticker (or blank), pull shortName from Yahoo Finance quote.
 */
async function resolveShareCompanyName(
  ticker: string,
  provided?: string | null,
): Promise<string> {
  const symbol = String(ticker || '')
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, '')
  const given = String(provided || '').trim()
  // Meaningful company name (not empty / not just the ticker)
  if (given && given.toUpperCase() !== symbol) return given

  if (symbol && shareCompanyNameCache.has(symbol)) {
    return shareCompanyNameCache.get(symbol) || given || symbol
  }

  if (!symbol) return given || ticker || ''

  try {
    const body = await fetchYahooQuote(symbol)
    const name = String(body?.quote?.shortName || '').trim()
    if (name) {
      shareCompanyNameCache.set(symbol, name)
      return name
    }
  } catch {
    /* keep fallback */
  }

  return given || symbol
}

/** “5 August · 9:46 AM ET” style stamp for share card. */
function formatShareStampLabel(event: PriceMovementEvent): string {
  let dayMonth = ''
  try {
    const d = new Date(`${event.event_date}T12:00:00Z`)
    if (!Number.isNaN(d.getTime())) {
      dayMonth = d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      })
    }
  } catch {
    /* fall through */
  }
  if (!dayMonth) {
    dayMonth = event.display_date || event.event_date || ''
  }
  const time = String(event.time_label || '').trim()
  if (dayMonth && time) return `${dayMonth} · ${time}`
  return dayMonth || time
}

/**
 * Share-card (Yahoo-style yellow):
 * company name · large % · mini chart · full likely-driver reason · Track at Trigger.
 * Height follows content (aspect ratio flexes). Style knobs from preview sliders.
 */
async function renderMomentumTweetImage(
  ticker: string,
  event: PriceMovementEvent,
  companyName?: string | null,
  style: ShareCardStyle = DEFAULT_SHARE_CARD_STYLE,
): Promise<{ blob: Blob; objectUrl: string } | null> {
  if (typeof document === 'undefined') return null
  const symbol = String(ticker || '').toUpperCase()
  const close = formatChange(event.price_change || event.momentum)
  const premarket = formatChange(getPremarketChange(event))
  const isDown = Boolean(close?.negative || (!close?.positive && premarket?.negative))
  const isUp = Boolean(close?.positive || premarket?.positive) && !isDown

  const titleMode = style.titleMode === 'ticker' ? 'ticker' : 'company'
  // Company mode: resolve real name (DB → Yahoo Finance) so title is never just blank
  const companyLabel =
    titleMode === 'company'
      ? await resolveShareCompanyName(symbol, companyName)
      : String(companyName || '').trim() || symbol
  const titleText = titleMode === 'ticker' ? symbol : companyLabel
  // Default: date · time on footer left next to Track at Trigger
  const dateInFooter = style.dateInFooter !== false

  // Always full likely driver — never truncate for “word budget”
  const sections = parseGeminiTweetSections(event.summary || '')
  let quote =
    sections.likely ||
    sections.headline ||
    String(event.summary || '').replace(/^likely\s*driver\s*:\s*/i, '').trim()
  quote = quote.replace(/\s+/g, ' ').trim()
  if (!quote) {
    const bits: string[] = []
    if (close?.text) bits.push(`${close.text} at close`)
    if (premarket?.text) bits.push(`pre-market ${premarket.text}`)
    quote = bits.length
      ? `${titleText} moved ${bits.join(' · ')}`
      : `${titleText} notable price momentum`
  }

  const w = 1080
  const imagePadding = Math.min(
    120,
    Math.max(16, Math.round(Number(style.imagePadding) || DEFAULT_SHARE_CARD_STYLE.imagePadding)),
  )
  const padX = imagePadding
  const textMaxW = w - padX * 2
  // Keep a bit more air on top than sides (was 88 when pad was 48)
  const topPad = imagePadding + 40
  const logoSize = Math.round(style.logoSize)
  const logoGap = 18
  const nameSize = Math.round(style.nameFontSize)
  const pctSize = Math.round(style.pctFontSize)
  const priceFontSize = Math.round(style.priceFontSize || 32)
  const rawPriceWeight = Number(style.priceFontWeight)
  const priceFontWeight = Number.isFinite(rawPriceWeight)
    ? Math.min(900, Math.max(100, Math.round(rawPriceWeight / 100) * 100))
    : 200
  const stampFontSize = Math.round(style.stampFontSize || 30)
  const reasonSize = Math.round(style.reasonFontSize)
  const nameWeight = style.nameBold ? 800 : 500
  const reasonWeight = style.reasonBold ? 800 : 500
  const nameFont = `${nameWeight} ${nameSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`
  const nameLineH = Math.round(nameSize * 1.35)
  const pctFont = `800 ${pctSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`
  const reasonFont = `${reasonWeight} ${reasonSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`
  const reasonLineH = Math.round(reasonSize * 1.22)
  const chartH = 360
  const gapBeforeChart = Math.round(style.gapBeforeChart)
  const gapAfterChart = Math.round(style.gapAfterChart)
  const gapBeforeBrand = 130
  const bottomPad = imagePadding
  const brandLabel = 'Track at Trigger'
  const brandFont = '500 28px ui-sans-serif, system-ui, -apple-system, sans-serif'
  // Adjustable weight; slightly tall letterforms via vertical scale when drawing
  const priceFont = `${priceFontWeight} ${priceFontSize}px "Avenir Next", "Helvetica Neue", "Segoe UI", ui-sans-serif, system-ui, sans-serif`
  const stampFont = `500 ${stampFontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`
  const priceTallScale = 1.18
  const cardBg = shareCardBgHex(style.cardColor)
  const bodyText = shareTextFillColor(style.textColor)
  const mutedText = shareTextMutedColor(style.textColor)

  // Custom pasted logos win over CDN/proxy
  const customMap = loadCustomLogoMap()
  const logoImg = await loadShareLogo(symbol, customMap[symbol] || null)

  // Offscreen measure canvas (fonts only)
  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) return null

  const moveText = close?.text || premarket?.text || ''
  const priceLabel = formatSharePriceLabel(event.price)
  const stampLabel = formatShareStampLabel(event)
  // Date stamp under price (left meta row) only when not on footer
  const stampUnderPrice = Boolean(stampLabel) && !dateInFooter
  const footerDate = dateInFooter ? stampLabel : ''

  measure.font = pctFont
  const pctW = moveText ? measure.measureText(moveText).width : 0

  // Header row: logo + title left, % right only
  const nameLeft = padX + (logoImg ? logoSize + logoGap : 0)
  const nameMaxW = Math.max(
    180,
    textMaxW - (logoImg ? logoSize + logoGap : 0) - (pctW ? pctW + 28 : 0),
  )

  measure.font = nameFont
  const nameLines = measureWrappedText(measure, titleText, nameMaxW, 3)

  // Full reason — high line cap so likely driver is never cut short
  measure.font = reasonFont
  const reasonLines = measureWrappedText(measure, quote, textMaxW, 24)

  const nameBlockH =
    nameLines.length <= 1 ? nameSize + 8 : nameLines.length * nameLineH - 12
  const identityBlockH = logoImg ? Math.max(logoSize, nameBlockH) : nameBlockH
  const rightPctH = moveText ? pctSize + 8 : 0
  const bandH = Math.max(identityBlockH, rightPctH, 40)

  // Under header on the RIGHT (under %): share price + optional stamp
  const priceDrawH = priceLabel ? Math.ceil(priceFontSize * priceTallScale) + 10 : 0
  const metaRowH =
    priceDrawH +
    (stampUnderPrice ? stampFontSize + 6 : 0) +
    (priceLabel || stampUnderPrice ? 16 : 0)

  const bandTop = topPad
  const bandMidY = bandTop + bandH / 2
  const headerBottom = bandTop + bandH
  const metaTop = headerBottom + (metaRowH ? 8 : 0)
  const blockBottom = metaTop + metaRowH
  const chartTop = blockBottom + gapBeforeChart
  const reasonFirstY = chartTop + chartH + gapAfterChart
  const reasonLastY =
    reasonFirstY + Math.max(0, reasonLines.length - 1) * reasonLineH
  const brandY = reasonLastY + gapBeforeBrand
  const h = Math.ceil(brandY + bottomPad)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = cardBg
  ctx.fillRect(0, 0, w, h)
  // Soft decorative wash (light on dark cards, dark-tint on light)
  const isDarkCard =
    style.cardColor === 'black' ||
    style.cardColor === 'navy' ||
    style.cardColor === 'slate'
  ctx.fillStyle = isDarkCard ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.08)'
  ctx.beginPath()
  ctx.arc(w * 0.9, h * 0.85, 200, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(w * 0.1, h * 0.95, 140, 0, Math.PI * 2)
  ctx.fill()

  const rightEdge = w - padX

  // --- Header row: logo + title left, % right ---
  if (logoImg) {
    drawCircularLogo(ctx, logoImg, padX + logoSize / 2, bandMidY, logoSize)
  }
  ctx.fillStyle = bodyText
  ctx.font = nameFont
  let nameY =
    bandMidY - ((nameLines.length - 1) * nameLineH) / 2 + nameSize * 0.35
  for (const line of nameLines) {
    ctx.fillText(line, nameLeft, nameY)
    nameY += nameLineH
  }
  if (moveText) {
    // Fixed up/down colors (no picker) — dark green for positive reads better on brand yellow
    ctx.fillStyle = isDown ? SHARE_DOWN_RED : isUp ? SHARE_UP_GREEN : bodyText
    ctx.font = pctFont
    const tw = ctx.measureText(moveText).width
    // Vertically center % with the logo/title band
    ctx.fillText(moveText, rightEdge - tw, bandMidY + pctSize * 0.32)
  }

  // --- Under full header row, RIGHT (under %): share price + optional stamp ---
  let metaY = metaTop + Math.ceil(priceFontSize * priceTallScale)
  if (priceLabel) {
    ctx.fillStyle = sharePriceFillColor(style.priceColor)
    ctx.font = priceFont
    const tw = ctx.measureText(priceLabel).width
    // Tall look via slight vertical stretch; weight from priceFontWeight slider
    ctx.save()
    ctx.translate(rightEdge - tw, metaY)
    ctx.scale(1, priceTallScale)
    ctx.fillText(priceLabel, 0, 0)
    ctx.restore()
    metaY += Math.ceil(priceFontSize * priceTallScale) + 10
  }
  if (stampUnderPrice) {
    ctx.fillStyle = mutedText
    ctx.font = stampFont
    const tw = ctx.measureText(stampLabel).width
    ctx.fillText(stampLabel, rightEdge - tw, metaY)
  }

  drawMiniChart(
    ctx,
    padX,
    chartTop,
    textMaxW,
    chartH,
    isDown,
    `${symbol}-${event.event_date || ''}`,
    cardBg,
  )

  ctx.fillStyle = bodyText
  ctx.font = reasonFont
  let ry = reasonFirstY
  for (let i = 0; i < reasonLines.length; i += 1) {
    ctx.fillText(reasonLines[i], padX, ry)
    if (i < reasonLines.length - 1) ry += reasonLineH
  }

  // Footer: date left (uses stampFontSize) · Track at Trigger right
  ctx.font = brandFont
  const brandW = ctx.measureText(brandLabel).width
  if (footerDate) {
    ctx.fillStyle = mutedText
    ctx.font = stampFont
    ctx.fillText(footerDate, padX, brandY)
  }
  ctx.fillStyle = bodyText
  ctx.font = brandFont
  ctx.fillText(brandLabel, w - padX - brandW, brandY)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png')
  })
  if (!blob) return null
  return { blob, objectUrl: URL.createObjectURL(blob) }
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
  { id: 'name', label: 'Company name (A → Z)' },
  { id: 'ticker', label: 'Ticker (A → Z)' },
  { id: 'saved', label: 'Saved dates (high → low)' },
]

function sourceKey(source: MovementSource, index: number) {
  return source.url || source.domain || source.title || `source-${index}`
}

function sourceLabel(source: MovementSource) {
  return source.title || source.domain || source.url || 'Source'
}

/** Display/edit sources as names only (no website URL in the card). */
function serializeSourcesDraft(sources?: MovementSource[] | null): string {
  return (sources || [])
    .map((s) => String(s.title || s.domain || '').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Parse name-only lines back to sources.
 * Keeps URL/domain from previous sources when the name still matches (by name or index).
 * Still accepts legacy `Title | https://…` if someone pastes it.
 */
function parseSourcesDraft(
  text: string,
  previousSources?: MovementSource[] | null,
): MovementSource[] {
  const prev = previousSources || []
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
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

/** Format price for share card (keep $ if present). */
function formatSharePriceLabel(price?: string | null): string {
  const raw = String(price || '').trim()
  if (!raw) return ''
  if (raw.startsWith('$')) return raw
  if (/^\d/.test(raw)) return `$${raw}`
  return raw
}

type SocialPlatformId = 'x' | 'whatsapp' | 'instagram'

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

/** Shared image layout sliders (tweet composer + social share). */
function ShareCardLayoutControls({
  style,
  onChange,
  idPrefix,
}: {
  style: ShareCardStyle
  onChange: (next: ShareCardStyle | ((prev: ShareCardStyle) => ShareCardStyle)) => void
  idPrefix: string
}) {
  const set = (patch: Partial<ShareCardStyle>) =>
    onChange((s) => {
      const next = { ...s, ...patch }
      saveShareCardStyle(next)
      return next
    })
  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Image layout
        </p>
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

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Card color
        </p>
        <div className="flex flex-wrap gap-2">
          {SHARE_CARD_COLOR_PRESETS.map((opt) => {
            const selected = (style.cardColor || 'yellow') === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                title={opt.label}
                aria-label={`Card color ${opt.label}`}
                aria-pressed={selected}
                onClick={() =>
                  set({
                    cardColor: opt.id,
                    // Auto-match body + price text when switching bg; user can override after
                    textColor: opt.defaultText,
                    priceColor: opt.defaultText,
                  })
                }
                className={
                  selected
                    ? 'inline-flex items-center gap-1.5 rounded-full border-2 border-foreground px-2.5 py-1 text-xs font-medium shadow-sm'
                    : 'inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-xs font-medium hover:bg-muted/60'
                }
              >
                <span
                  className="size-3.5 shrink-0 rounded-full border border-black/15 shadow-inner"
                  style={{ backgroundColor: opt.bg }}
                />
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Text color
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'black' as const, label: 'Black' },
              { id: 'grey' as const, label: 'Grey' },
              { id: 'white' as const, label: 'White' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={(style.textColor || 'black') === opt.id ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => set({ textColor: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Title, reason, timestamp & “Track at Trigger”. Price has its own color below.
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs">
          <Label htmlFor={`${idPrefix}-image-pad`} className="text-xs font-medium">
            Image padding
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
        <p className="text-[10px] text-muted-foreground">
          Outer margin around logo, text & chart.
        </p>
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
          min={0}
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
            max={110}
            step={1}
            value={style.pctFontSize}
            onChange={(e) => set({ pctFontSize: Number(e.target.value) })}
            className="w-full accent-foreground"
          />
        </div>
      </div>

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

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Price color
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'black' as const, label: 'Black' },
              { id: 'grey' as const, label: 'Grey' },
              { id: 'white' as const, label: 'White' },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={(style.priceColor || 'black') === opt.id ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => set({ priceColor: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

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

      <div className="space-y-1.5 border-t border-border/50 pt-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Title text
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={style.titleMode !== 'ticker' ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => set({ titleMode: 'company' })}
          >
            Company name
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.titleMode === 'ticker' ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => set({ titleMode: 'ticker' })}
          >
            Ticker symbol
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Date · timestamp
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={style.dateInFooter !== false ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => set({ dateInFooter: true })}
          >
            Footer left (default)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={style.dateInFooter === false ? 'default' : 'outline'}
            className="h-8 text-xs"
            onClick={() => set({ dateInFooter: false })}
          >
            Under price
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Footer left: “5 August · time” left of Track at Trigger. Font size = Timestamp slider
          above.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant={style.nameBold ? 'default' : 'outline'}
          className="h-8 text-xs"
          onClick={() => set({ nameBold: !style.nameBold })}
        >
          Title {style.nameBold ? 'Bold' : 'Light'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={style.reasonBold ? 'default' : 'outline'}
          className="h-8 text-xs"
          onClick={() => set({ reasonBold: !style.reasonBold })}
        >
          Reason {style.reasonBold ? 'Bold' : 'Light'}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Likely driver text is always shown in full — no word limit.
      </p>
    </div>
  )
}

function deviceKey(device: EnabledDevice) {
  return device.device_id || device.expo_push_token
}

export default function NotificationsPage() {
  const { theme, toggleTheme } = useTheme()
  const { toast } = useBottomToast()
  const [notificationApp, setNotificationApp] = useState<NotificationApp>('trigger')
  const [section, setSection] = useState<DashboardSection>('tickers')
  const [tickers, setTickers] = useState<MonitoredTicker[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [activeTicker, setActiveTicker] = useState<string>('')
  const [tickerSort, setTickerSort] = useState<TickerSortMode>('subscribers')
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
  const [fetchAllAlertBusyKey, setFetchAllAlertBusyKey] = useState<string | null>(null)
  const [fetchAllAlertMsg, setFetchAllAlertMsg] = useState<Record<string, string>>({})
  const [fetchAllAlertAllBusy, setFetchAllAlertAllBusy] = useState(false)
  const [fetchAllDigestMsg, setFetchAllDigestMsg] = useState('')
  const [usagePopup, setUsagePopup] = useState<null | 'gemini' | 'firecrawl'>(null)
  /** X / Twitter thread composer (review → Start opens new tab with tweet 1) */
  const [tweetComposerOpen, setTweetComposerOpen] = useState(false)
  const [tweetThread, setTweetThread] = useState<MomentumTweetThread | null>(null)
  const [tweetImageUrl, setTweetImageUrl] = useState<string | null>(null)
  const [tweetImageBlob, setTweetImageBlob] = useState<Blob | null>(null)
  const [tweetComposerBusy, setTweetComposerBusy] = useState(false)
  const [tweetStartBusy, setTweetStartBusy] = useState(false)
  /** Context needed to re-render share image when sliders move. */
  const [tweetRenderCtx, setTweetRenderCtx] = useState<{
    ticker: string
    event: PriceMovementEvent
    companyName?: string | null
  } | null>(null)
  const [shareCardStyle, setShareCardStyle] = useState<ShareCardStyle>(() =>
    loadShareCardStyle(),
  )

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
  const movementAlertDevices = useMemo(() => {
    if (!movementAlertTarget) return []
    const ticker = movementAlertTarget.ticker.toUpperCase()
    return devices.filter((device) =>
      (device.tickers || []).some((item) => item.toUpperCase() === ticker),
    )
  }, [devices, movementAlertTarget])
  const movementAlertSelectedCount = useMemo(() => {
    const selected = new Set(movementAlertDeviceKeys)
    return movementAlertDevices.filter((device) => selected.has(deviceKey(device))).length
  }, [movementAlertDeviceKeys, movementAlertDevices])
  const digestDevices = useMemo(() => {
    const scope = new Set(digestScopeDeviceKeys)
    return devices.filter((device) => scope.has(deviceKey(device)))
  }, [devices, digestScopeDeviceKeys])
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
      setActiveTicker((current) => {
        if (current && next.some((item) => item.ticker === current)) return current
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
      const response = await fetch(
        `/api/notifications/devices?app=${encodeURIComponent(notificationApp)}`,
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Failed to load devices (${response.status})`)
      }
      const next = ((body.devices || []) as EnabledDevice[]).map((device) => {
        const cryptoTickers = Array.from(
          new Set([
            ...((device.crypto_tickers || []) as string[]),
            ...(device.tickers || []).filter(looksLikeCryptoTicker),
          ]),
        ).sort()
        return {
          ...device,
          // Audience chips stay stocks-only; pro signal uses crypto list.
          crypto_tickers: cryptoTickers,
          pro_crypto: Boolean(device.pro_crypto) || cryptoTickers.length > 0,
          tickers: stockTickersOnly(device.tickers),
        }
      })
      setDevices(next)
      // Default: select all when list first loads or was empty.
      setSelectedDeviceKeys((prev) => {
        if (prev.length === 0 && next.length > 0) {
          return next.map(deviceKey)
        }
        // Keep previous selections that still exist; if none remain, select all.
        const keys = new Set(next.map(deviceKey))
        const kept = prev.filter((k) => keys.has(k))
        return kept.length ? kept : next.map(deviceKey)
      })
      setCustomSelectedDeviceKeys((prev) => {
        if (prev.length === 0 && next.length > 0) {
          return next.map(deviceKey)
        }
        const keys = new Set(next.map(deviceKey))
        const kept = prev.filter((k) => keys.has(k))
        return kept.length ? kept : next.map(deviceKey)
      })
      appendNewsLog('info', `Loaded ${next.length} device(s) with notifications on`, {
        device_ids: next.map((d) => d.device_id),
      })
      appendCustomLog('info', `Loaded ${next.length} device(s) with notifications on`, {
        device_ids: next.map((d) => d.device_id),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load devices'
      setDevicesError(message)
      appendNewsLog('error', message)
      appendCustomLog('error', message)
    } finally {
      setDevicesLoading(false)
    }
  }, [appendNewsLog, appendCustomLog, notificationApp])

  const loadNews = useCallback(
    async (opts?: { append?: boolean }) => {
      const append = Boolean(opts?.append)
      if (append) setNewsLoadingMore(true)
      else {
        setNewsLoading(true)
        setNewsError('')
      }
      try {
        const offset = append ? news.length : 0
        const response = await fetch(
          `/api/notifications/news?limit=40&offset=${offset}`,
        )
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(body.error || `Failed to load news (${response.status})`)
        }
        const batch = (body.articles || []) as NewsArticle[]
        setNews((prev) => (append ? [...prev, ...batch] : batch))
        setNewsTotal(typeof body.total === 'number' ? body.total : null)
        setNewsHasMore(Boolean(body.has_more))
        if (!append && batch.length > 0) {
          setSelectedArticleId((current) =>
            current && batch.some((a) => a.id === current) ? current : batch[0].id,
          )
        }
        appendNewsLog(
          'info',
          append
            ? `Loaded ${batch.length} more articles (offset ${offset})`
            : `Loaded ${batch.length} news articles from Supabase`,
          { total: body.total, offset },
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load news'
        if (!append) setNewsError(message)
        appendNewsLog('error', message)
      } finally {
        setNewsLoading(false)
        setNewsLoadingMore(false)
      }
    },
    [appendNewsLog, news.length],
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

  useEffect(() => {
    void loadTickers()
    void loadCreditsHint()
    void loadDevices()
  }, [loadTickers, loadCreditsHint, loadDevices])

  useEffect(() => {
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
  }, [notificationApp])

  // When entering News or Custom, refresh devices (and news for News tab).
  useEffect(() => {
    if (section === 'news') {
      void loadDevices()
      void loadNews()
      return
    }
    if (section === 'custom' || section === 'users') {
      void loadDevices()
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
      const response = await fetch(
        `/api/notifications/scrape/${encodeURIComponent(ticker)}?auto_save=${
          shouldAutoSave ? '1' : '0'
        }`,
        { method: 'POST' },
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
        options?.reloadAfterSave !== false
      ) {
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
    setFetchAllAlertBusyKey(null)
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
    const eligible = devices.filter((device) =>
      (device.tickers || []).some((item) => item.toUpperCase() === ticker),
    )
    if (!eligible.length) {
      setFetchAllAlertMsg((prev) => ({
        ...prev,
        [hitKey]: 'No subscribers for this ticker',
      }))
      return
    }

    setFetchAllAlertBusyKey(hitKey)
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
    } finally {
      setFetchAllAlertBusyKey((current) => (current === hitKey ? null : current))
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

  async function openTweetComposer(
    ticker: string,
    event: PriceMovementEvent,
    companyName?: string | null,
  ) {
    setTweetComposerBusy(true)
    // Keep last saved layout settings (localStorage cache)
    const style = loadShareCardStyle()
    setShareCardStyle(style)
    try {
      const thread = buildMomentumTweetThread(ticker, event, companyName)
      setTweetThread(thread)
      setTweetRenderCtx({ ticker, event, companyName })
      // Revoke previous object URL
      if (tweetImageUrl) {
        try {
          URL.revokeObjectURL(tweetImageUrl)
        } catch {
          /* ignore */
        }
      }
      const image = await renderMomentumTweetImage(
        ticker,
        event,
        companyName,
        style,
      )
      setTweetImageBlob(image?.blob || null)
      setTweetImageUrl(image?.objectUrl || null)
      setTweetComposerOpen(true)
    } finally {
      setTweetComposerBusy(false)
    }
  }

  /** Debounced re-render when preview sliders / bold toggles change. */
  useEffect(() => {
    if (!tweetComposerOpen || !tweetRenderCtx) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        setShareImageRerendering(true)
        try {
          const image = await renderMomentumTweetImage(
            tweetRenderCtx.ticker,
            tweetRenderCtx.event,
            tweetRenderCtx.companyName,
            shareCardStyle,
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
          setTweetImageUrl((prev) => {
            if (prev) {
              try {
                URL.revokeObjectURL(prev)
              } catch {
                /* ignore */
              }
            }
            return image?.objectUrl || null
          })
          setTweetImageBlob(image?.blob || null)
        } finally {
          if (!cancelled) setShareImageRerendering(false)
        }
      })()
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // Intentionally depend on style + open + ctx
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareCardStyle, tweetComposerOpen, tweetRenderCtx])

  /** Same layout sliders live-update the Share-on-social-media image. */
  useEffect(() => {
    if (!socialShareOpen || !socialShareCtx) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        setShareImageRerendering(true)
        try {
          const image = await renderMomentumTweetImage(
            socialShareCtx.ticker,
            socialShareCtx.event,
            socialShareCtx.companyName,
            shareCardStyle,
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
              imageBlob: image?.blob || null,
              imageUrl: image?.objectUrl || null,
            }
          })
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
  }, [shareCardStyle, socialShareOpen, socialShareCtx?.ticker, socialShareCtx?.event?.event_date])

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

  async function openUsagePopup(kind: 'gemini' | 'firecrawl') {
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
   */
  async function handleGeminiSummarize(
    ticker: string,
    event: PriceMovementEvent,
    field: 'summary' | 'premarket' = 'summary',
  ) {
    const key = geminiEventKey(ticker, event, field)
    // Prefer the original scraped reason when re-running Gemini on an already-classified card.
    const sourceText =
      field === 'premarket'
        ? getPremarketReason(event)
        : String(event.original_summary || '').trim() ||
          reasonTextForGemini(event) ||
          String(event.summary || '').trim()

    if (!sourceText) {
      setGeminiErrorByKey((prev) => ({
        ...prev,
        [key]: 'No reason/summary text to structure',
      }))
      return
    }

    const companyName =
      tickers.find((item) => item.ticker === ticker)?.company_name || ticker

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
      `Gemini: structuring reason for ${event.event_date}…`,
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
          event_date: event.event_date,
          price: event.price,
          price_change: event.price_change || event.momentum,
          event,
          auto_save: false,
        }),
      })
      const body = await response.json().catch(() => ({}))
      // Always surface usage when API returned it (even on validation failure).
      if (body.usage || body.tokens || body.credits_used != null) {
        const usagePayload = rememberGeminiUsage(key, body)
        appendLocalLog(ticker, 'info', usagePayload.message, {
          ...usagePayload,
          usage: body.usage,
          tokens: body.tokens,
          max_output_tokens: body.max_output_tokens,
          validation: body.validation,
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

      // Preview in review dialog + card draft (save on confirm).
      setGeminiEditTarget({ ticker, event })
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
        [reasonDraftKey(ticker, event)]: summary,
      }))

      const usagePayload = rememberGeminiUsage(key, body)
      toastGeminiModelSwitch(body)
      appendLocalLog(
        ticker,
        'success',
        `Gemini structured reason · ${event.event_date} — review & save (not a push)`,
        {
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
      const message = error instanceof Error ? error.message : 'Gemini structure failed'
      setGeminiErrorByKey((prev) => ({ ...prev, [key]: message }))
      appendLocalLog(ticker, 'error', message)
    } finally {
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
        void loadTickers()
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
      void loadTickers()
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
    const draft = (reasonDrafts[key] ?? event.summary ?? '').trim()
    const sourcesText =
      sourceDrafts[key] ?? serializeSourcesDraft(event.sources || [])
    const nextSources = parseSourcesDraft(sourcesText, event.sources || [])
    const prevSourcesText = serializeSourcesDraft(event.sources || [])
    const reasonUnchanged = draft === String(event.summary || '').trim()
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
      void loadTickers()
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
      const image = await renderMomentumTweetImage(
        ticker,
        eventForShare,
        resolvedCompany,
        style,
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

  function downloadShareImage(blob: Blob | null, ticker?: string) {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trigger-${(ticker || 'share').toLowerCase()}-momentum.png`
    a.click()
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }, 1500)
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
          }),
        },
      )
      const saveBody = await saveResponse.json().catch(() => ({}))
      if (!saveResponse.ok) {
        throw new Error(saveBody.error || `Save failed (${saveResponse.status})`)
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
      void loadTickers()
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
    const candidates = device ? [device] : devices
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
      const response = await fetch('/api/notifications/alert-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_key: notificationApp,
          article_id: article.id,
          device_ids: selected.map((d) => d.device_id).filter(Boolean),
          expo_push_tokens: selected.map((d) => d.expo_push_token),
        }),
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
    const eligible = devices.filter((device) =>
      (device.tickers || []).some((item) => item.toUpperCase() === normalizedTicker),
    )
    setMovementAlertTarget({ ticker: normalizedTicker, event })
    setMovementAlertDeviceKeys(eligible.map(deviceKey))
    setMovementAlertOpen(true)
    setMovementPreviewTitle('')
    setMovementPreviewBody('')
    setMovementPreviewError('')
    setMovementPreviewLoading(true)
    appendLocalLog(ticker, 'info', 'Alert recipient picker opened', {
      app_key: notificationApp,
      event_date: event?.event_date || 'latest saved',
      default_selected: eligible.length,
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
    appendLocalLog(ticker, 'info', `Sending selected movement alert for ${ticker}`, {
      app_key: notificationApp,
      event_date: movementAlertTarget.event?.event_date || 'latest saved',
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
      const response = await fetch(`/api/notifications/save/${encodeURIComponent(ticker)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events,
          source_url: state.result?.url,
          scraped_at: state.result?.scraped_at,
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
      if (!noop) void loadTickers()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed'
      patchTab(ticker, { saving: false, error: message })
      appendLocalLog(ticker, 'error', message)
    }
  }

  const activeMeta = useMemo(
    () => tickers.find((item) => item.ticker === activeTicker) || null,
    [tickers, activeTicker],
  )

  /** Stocks-only list (categories removed — no commodity/crypto/forex/index). */
  const filteredTickers = useMemo(() => {
    const list = [...tickers]
    list.sort((a, b) => {
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
  }, [tickers, tickerSort])

  // Keep the active ticker inside the stocks list.
  useEffect(() => {
    if (!filteredTickers.length) {
      if (activeTicker) setActiveTicker('')
      return
    }
    if (!filteredTickers.some((item) => item.ticker === activeTicker)) {
      setActiveTicker(filteredTickers[0].ticker)
    }
  }, [filteredTickers, activeTicker])

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
  const isTrigger = notificationApp === 'trigger'

  return (
    <div
      className={cn(
        'flex h-svh flex-col overflow-hidden text-foreground',
        isTrigger
          ? 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-muted/80 via-background to-background'
          : 'bg-background',
      )}
    >
      <header
        className={cn(
          'relative z-20 shrink-0',
          isTrigger
            ? 'border-b border-border/50 bg-background/70 backdrop-blur-xl'
            : 'border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        )}
      >
        <div
          className={cn(
            'flex w-full items-center gap-3 px-4 sm:px-6',
            isTrigger ? 'h-16' : 'h-14',
          )}
        >
          {isTrigger ? (
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 text-xs sm:text-sm">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 shadow-sm"
                title="Monitored instruments"
              >
                <span className="text-muted-foreground">Instruments</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {tickers.length}
                </span>
              </span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 shadow-sm"
                title="Devices with notifications on"
              >
                <span className="text-muted-foreground">Devices</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {devices.length}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void openUsagePopup('gemini')}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-violet-950 shadow-sm transition-colors hover:bg-violet-500/15 dark:text-violet-100"
                title={
                  geminiTotals
                    ? `Gemini total · ${geminiTotals.total_tokens || 0} tokens — click for daily breakdown`
                    : 'Gemini spend — click for daily breakdown'
                }
              >
                <Sparkles className="size-3 shrink-0" />
                <span className="text-violet-900/80 dark:text-violet-100/80">Gemini</span>
                <span className="font-semibold tabular-nums">
                  {geminiTotals?.cost_usd_display ||
                    formatUsdCompact(geminiTotals?.cost_usd) ||
                    '$0.000000'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void openUsagePopup('firecrawl')}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 shadow-sm transition-colors hover:bg-muted/70"
                title={creditHint || 'Firecrawl remaining — click for daily credits'}
              >
                <span className="text-muted-foreground">Firecrawl</span>
                <span className="font-semibold tabular-nums text-foreground">
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
                </span>
              </button>
            </div>
          ) : (
            <div className="min-w-0 shrink">
              <p className="truncate text-sm font-semibold tracking-tight">9AM</p>
              <p className="truncate text-xs text-muted-foreground">Notification dashboard</p>
            </div>
          )}

          {/* App switcher — logos only, centered in main header */}
          <div
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5"
            role="tablist"
            aria-label="App"
          >
            <button
              type="button"
              role="tab"
              aria-selected={isTrigger}
              aria-label="Trigger"
              title="Trigger"
              onClick={() => setNotificationApp('trigger')}
              className={cn(
                'inline-flex size-10 items-center justify-center rounded-full border transition-colors',
                isTrigger
                  ? 'border-foreground/15 bg-foreground text-background shadow-sm'
                  : 'border-border/70 bg-card text-muted-foreground hover:bg-muted/70 hover:text-foreground',
              )}
            >
              <Zap className="size-4" />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isTrigger}
              aria-label="9AM"
              title="9AM"
              onClick={() => setNotificationApp('nineam')}
              className={cn(
                'inline-flex size-10 items-center justify-center rounded-full border text-sm font-bold transition-colors',
                !isTrigger
                  ? 'border-foreground/15 bg-foreground text-background shadow-sm'
                  : 'border-border/70 bg-card text-muted-foreground hover:bg-muted/70 hover:text-foreground',
              )}
            >
              9
            </button>
          </div>

          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            {section === 'tickers' ? (
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
                      className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3.5 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-50"
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
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
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
                      className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-sm font-medium text-amber-950 shadow-sm transition-colors hover:bg-amber-500/15 disabled:pointer-events-none disabled:opacity-50 dark:text-amber-100"
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
                  ? 'size-10 rounded-full border border-border/60 bg-card shadow-sm'
                  : 'size-9 rounded-md border border-border bg-card',
              )}
            >
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Workspace: left section tabs | main | logs */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT vertical section tabs — collapsed by default */}
        <nav
          className={cn(
            'flex shrink-0 flex-col border-r transition-[width] duration-200 ease-out',
            workspaceCollapsed
              ? isTrigger
                ? 'w-12 bg-card/40'
                : 'w-12 bg-muted/20'
              : isTrigger
                ? 'w-52 bg-card/40 p-3 sm:w-56 sm:p-4'
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
                    ? 'bg-foreground text-background shadow-sm'
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
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Users className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-center justify-between gap-1 px-2">
                <p
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground',
                    isTrigger && 'px-1',
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
                    'flex items-center gap-2 text-left text-sm font-medium transition-colors',
                    isTrigger
                      ? cn(
                          'rounded-2xl px-3 py-3',
                          section === 'tickers'
                            ? 'bg-foreground text-background shadow-sm'
                            : 'text-foreground hover:bg-muted/80',
                        )
                      : cn(
                          'rounded-xl border px-3 py-3',
                          section === 'tickers'
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-transparent bg-transparent text-foreground hover:bg-muted',
                        ),
                  )}
                >
                  <TrendingUp className="size-4 shrink-0" />
                  <span className="leading-tight">
                    {isTrigger ? 'Momentum' : 'Tickers'}
                    <span className="block text-[11px] font-normal opacity-80">
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
                    'flex items-center gap-2 text-left text-sm font-medium transition-colors',
                    isTrigger
                      ? cn(
                          'rounded-2xl px-3 py-3',
                          section === 'users'
                            ? 'bg-foreground text-background shadow-sm'
                            : 'text-foreground hover:bg-muted/80',
                        )
                      : cn(
                          'rounded-xl border px-3 py-3',
                          section === 'users'
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-transparent bg-transparent text-foreground hover:bg-muted',
                        ),
                  )}
                >
                  <Users className="size-4 shrink-0" />
                  <span className="leading-tight">
                    {isTrigger ? 'Audience' : 'All users'}
                    <span className="block text-[11px] font-normal opacity-80">
                      {isTrigger ? 'devices' : 'alertable devices'}
                    </span>
                  </span>
                </button>

                {isTrigger ? (
                  <div className="mt-auto space-y-3 pt-6">
                    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Snapshot
                      </p>
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Instruments</span>
                          <span className="font-semibold tabular-nums">{tickers.length}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Devices</span>
                          <span className="font-semibold tabular-nums">{devices.length}</span>
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
                            <span className="font-semibold tabular-nums text-violet-800 dark:text-violet-200">
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
            {section === 'users' ? (
              <>
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-1">
                    <h1
                      className={cn(
                        'font-semibold tracking-tight',
                        isTrigger ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl',
                      )}
                    >
                      {isTrigger ? 'Audience' : 'All alertable users'}
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Devices registered for{' '}
                      <strong>{notificationApp === 'trigger' ? 'Trigger' : '9AM'}</strong>.
                      Stocks only in the ticker list. Users who requested crypto pro access show a{' '}
                      <strong>Pro · Crypto</strong> badge above Notifications on.
                    </p>
                  </div>
                  <div className={cn('flex flex-wrap gap-2', isTrigger && 'gap-2.5')}>
                    {notificationApp === 'trigger' ? (
                      <Button
                        size="sm"
                        type="button"
                        disabled={!devices.length || devicesLoading}
                        onClick={() => openTriggerDigest()}
                        className={isTrigger ? 'rounded-full px-4 shadow-sm' : undefined}
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
                      className={isTrigger ? 'rounded-full px-4' : undefined}
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

                <div className={cn('mb-5 grid gap-3 sm:grid-cols-3', isTrigger && 'gap-4')}>
                  <div
                    className={cn(
                      'rounded-xl border bg-card p-4 shadow-sm',
                      isTrigger && 'rounded-3xl border-border/60 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
                    )}
                  >
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Alertable users
                    </p>
                    <p className="mt-1 text-2xl font-semibold">{devices.length}</p>
                  </div>
                  <div
                    className={cn(
                      'rounded-xl border bg-card p-4 shadow-sm',
                      isTrigger && 'rounded-3xl border-border/60 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
                    )}
                  >
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Pro · Crypto
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {devices.filter((device) => device.pro_crypto).length}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'rounded-xl border bg-card p-4 shadow-sm',
                      isTrigger && 'rounded-3xl border-border/60 p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
                    )}
                  >
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Stock tickers
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
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
                    Loading alertable users…
                  </div>
                ) : null}

                {!devicesLoading && !devices.length ? (
                  <div className="rounded-xl border border-dashed px-4 py-12 text-center">
                    <Users className="mx-auto size-6 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">No alertable users</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No enabled {notificationApp === 'trigger' ? 'Trigger' : '9AM'} push tokens
                      were found.
                    </p>
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {devices.map((device) => {
                    const token = device.expo_push_token
                    const maskedToken =
                      token.length > 30 ? `${token.slice(0, 20)}…${token.slice(-8)}` : token
                    return (
                      <article
                        key={deviceKey(device)}
                        className="rounded-2xl border bg-card p-4 text-card-foreground shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-sm font-semibold">
                              {device.device_id || 'Unknown device'}
                            </p>
                            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                              {maskedToken}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            {device.pro_crypto ? (
                              <Badge
                                className="gap-1 bg-violet-500/15 text-violet-900 dark:text-violet-100"
                                title={
                                  device.crypto_tickers?.length
                                    ? `Crypto pro access · ${device.crypto_tickers.join(', ')}`
                                    : 'Requested pro access for crypto'
                                }
                              >
                                <Crown className="size-3" />
                                Pro · Crypto
                              </Badge>
                            ) : null}
                            <Badge className="bg-emerald-500/12 text-emerald-800 dark:text-emerald-200">
                              Notifications on
                            </Badge>
                            {notificationApp === 'trigger' ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openTriggerDigest(device)}
                              >
                                <BellRing className="size-3.5" />
                                Alert user
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-4">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Subscribed stocks ({device.tickers?.length || 0})
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(device.tickers || []).map((ticker) => (
                              <Badge key={ticker} variant="secondary" className="font-mono text-[10px]">
                                {ticker}
                              </Badge>
                            ))}
                            {!device.tickers?.length ? (
                              <span className="text-xs text-muted-foreground">No stocks</span>
                            ) : null}
                          </div>
                          {device.pro_crypto && device.crypto_tickers?.length ? (
                            <p className="mt-2 text-[11px] text-violet-800 dark:text-violet-200">
                              Crypto pro request:{' '}
                              <span className="font-mono">{device.crypto_tickers.join(', ')}</span>
                            </p>
                          ) : null}
                        </div>
                      </article>
                    )
                  })}
                </div>
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
                      Left: pick one news story · Right: pick devices · then Send
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {newsTotal != null ? `${newsTotal} articles in Supabase · ` : null}
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
                      <h2 className="text-sm font-semibold">News</h2>
                      <span className="text-xs text-muted-foreground">
                        {news.length}
                        {newsTotal != null ? ` / ${newsTotal}` : ''} loaded
                      </span>
                    </div>
                    <div className="min-h-0 max-h-[calc(100svh-16rem)] flex-1 space-y-2 overflow-y-auto p-3">
                      {newsLoading && !news.length ? (
                        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Loading news from Supabase…
                        </div>
                      ) : null}
                      {!newsLoading && !news.length && !newsError ? (
                        <div className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                          No articles. Click Reload news.
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
                  'flex w-44 shrink-0 flex-col border-r sm:w-52 md:w-56',
                  isTrigger ? 'border-border/50 bg-card/40' : 'border-border bg-muted/15',
                )}
              >
                <div className="shrink-0 border-b border-border/60 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Stocks
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {listLoading && !filteredTickers.length
                          ? 'Loading…'
                          : `${filteredTickers.length} ticker${filteredTickers.length === 1 ? '' : 's'}`}
                      </p>
                    </div>
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
                            onClick={() => setTickerSort(option.id)}
                            className={cn(tickerSort === option.id && 'bg-muted font-medium')}
                          >
                            {option.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div
                  className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5"
                  role="tablist"
                  aria-label="Stock tickers"
                  aria-orientation="vertical"
                >
                  {listLoading && !tickers.length ? (
                    <div className="flex items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Loading…
                    </div>
                  ) : null}
                  {!listLoading && !tickers.length ? (
                    <p className="px-2 py-6 text-xs text-muted-foreground">
                      No equity rows in monitored tickers.
                    </p>
                  ) : null}
                  {filteredTickers.map((item) => {
                    const selected = item.ticker === activeTicker
                    const busy = Boolean(tabState[item.ticker]?.loading)
                    const watchers = item.subscriber_count ?? 0
                    return (
                      <button
                        key={item.ticker}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setActiveTicker(item.ticker)}
                        title={
                          item.company_name
                            ? `${item.company_name} · ${watchers} watching`
                            : `${item.ticker} · ${watchers} watching`
                        }
                        className={cn(
                          'flex w-full items-start gap-2 rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors',
                          selected
                            ? isTrigger
                              ? 'bg-foreground text-background shadow-sm'
                              : 'bg-foreground text-background'
                            : 'text-foreground hover:bg-muted/80',
                        )}
                      >
                        <TickerLogoMark
                          symbol={item.ticker}
                          selected={selected}
                          size={22}
                          customSrc={customLogos[item.ticker] || null}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold tracking-tight">{item.ticker}</span>
                            {busy ? (
                              <Loader2 className="size-3 animate-spin opacity-80" />
                            ) : null}
                          </div>
                          {item.company_name && item.company_name !== item.ticker ? (
                            <p
                              className={cn(
                                'mt-0.5 truncate text-[11px]',
                                selected ? 'text-background/75' : 'text-muted-foreground',
                              )}
                            >
                              {item.company_name}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={cn(
                            'mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                            selected
                              ? 'bg-background/15 text-background'
                              : 'bg-muted text-muted-foreground',
                          )}
                          title={`${watchers} user(s) monitoring`}
                        >
                          {watchers}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </aside>

              {/* Column 2 — selected ticker data */}
              <div
                className={cn(
                  'min-h-0 min-w-0 flex-1 overflow-y-auto',
                  isTrigger ? 'px-5 py-5 sm:px-6 sm:py-6' : 'px-4 py-4 sm:px-5 sm:py-5',
                )}
              >
            {activeTicker ? (
              <section className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <TickerLogoMark
                        symbol={activeTicker}
                        size={isTrigger ? 40 : 32}
                        customSrc={customLogos[activeTicker] || null}
                        onClick={(e) => {
                          e.stopPropagation()
                          openLogoReplaceDialog(
                            activeTicker,
                            activeMeta?.company_name || null,
                          )
                        }}
                        className="shadow-sm ring-1 ring-border/60"
                      />
                      <h2
                        className={cn(
                          'font-semibold tracking-tight',
                          isTrigger ? 'text-2xl sm:text-3xl' : 'text-xl',
                        )}
                      >
                        {activeTicker}
                      </h2>
                      {activeMeta?.saved_event_count ? (
                        <span className="text-xs text-muted-foreground sm:text-sm">
                          Saved in DB:{' '}
                          <span className="font-medium text-foreground">
                            {activeMeta.saved_event_count} date
                            {activeMeta.saved_event_count === 1 ? '' : 's'}
                          </span>
                          {activeMeta.last_saved_at
                            ? ` · last save ${new Date(activeMeta.last_saved_at).toLocaleString()}`
                            : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground sm:text-sm">
                          Saved in DB: <span className="font-medium text-foreground">0 dates</span>
                        </span>
                      )}
                      {activeMeta?.company_name && activeMeta.company_name !== activeTicker ? (
                        <Badge
                          variant="secondary"
                          className={isTrigger ? 'rounded-full px-3' : undefined}
                        >
                          {activeMeta.company_name}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Source:{' '}
                      {(() => {
                        const source = sourceLabelForTicker({
                          ticker: activeTicker,
                          scrape_source:
                            activeState.result?.scrape_source || activeMeta?.scrape_source,
                          source_url: activeState.result?.url || activeMeta?.source_url,
                        })
                        return (
                          <a
                            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                            href={source.href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.short}
                            <ExternalLink className="size-3" />
                          </a>
                        )
                      })()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {notificationApp === 'trigger' ? 'Trigger devices subscribed' : 'Devices subscribed'}:{' '}
                      <span className="font-medium text-foreground">
                        {activeMeta?.subscriber_count ?? 0}
                      </span>
                      {activeMeta?.device_ids?.length ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {activeMeta.device_ids.join(', ')}
                        </span>
                      ) : null}
                    </p>
                    {(() => {
                      const tickerUsage =
                        activeMeta?.gemini_usage ||
                        sumEventsGeminiUsage(storedEvents)
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
                      return (
                        <p className="text-xs text-muted-foreground">
                          Gemini spend:{' '}
                          <span className="font-medium tabular-nums text-violet-800 dark:text-violet-200">
                            {cost}
                          </span>
                          <span className="text-muted-foreground">
                            {' '}
                            · {Number(tokens).toLocaleString()} tokens ·{' '}
                            {Number(credits).toLocaleString()} credits
                            {tickerUsage.dates_with_gemini
                              ? ` · ${tickerUsage.dates_with_gemini} date${
                                  tickerUsage.dates_with_gemini === 1 ? '' : 's'
                                }`
                              : ''}
                          </span>
                        </p>
                      )
                    })()}
                  </div>

                  <div className={cn('flex flex-wrap items-center gap-2', isTrigger && 'gap-2.5')}>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={activeState.loading || allTickersLoading || geminiPromptRunning}
                      onClick={() => void handleRefresh(activeTicker)}
                      className={isTrigger ? 'rounded-full px-4' : undefined}
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
                        'gap-1.5 border-violet-500/40 bg-violet-500/10 text-violet-950 hover:bg-violet-500/15 dark:text-violet-100',
                        isTrigger && 'rounded-full px-4',
                      )}
                    >
                      {geminiPromptRunning ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4 text-violet-600" />
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
                      className={isTrigger ? 'rounded-full px-4 shadow-sm' : undefined}
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
                  <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
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
                  <section className="space-y-3 rounded-2xl border border-amber-500/35 bg-amber-500/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-900 dark:text-amber-200">
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
                    <div className="space-y-12">
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
                            className="space-y-3"
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
                                  disabled={geminiBusy}
                                  onClick={() =>
                                    void handleGeminiSummarize(activeTicker, event, 'summary')
                                  }
                                  title="Structure this date's reason with Gemini"
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
                              </div>
                            </div>
                            <div className="mt-3 space-y-3 rounded-xl border border-border/60 bg-card/40 p-3">
                              <div className="space-y-1.5">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Reason
                                </p>
                                <Textarea
                                  value={
                                    reasonDrafts[reasonDraftKey(activeTicker, event)] ??
                                    event.summary ??
                                    ''
                                  }
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
                                <Textarea
                                  value={
                                    sourceDrafts[reasonDraftKey(activeTicker, event)] ??
                                    serializeSourcesDraft(event.sources || [])
                                  }
                                  onChange={(e) =>
                                    setSourceDrafts((prev) => ({
                                      ...prev,
                                      [reasonDraftKey(activeTicker, event)]: e.target.value,
                                    }))
                                  }
                                  onBlur={() => void handleSaveReasonEdit(activeTicker, event)}
                                  rows={Math.min(6, Math.max(2, sources.length || 2))}
                                  className="min-h-[3.5rem] resize-y text-sm leading-relaxed"
                                  placeholder={'Bloomberg\nReuters\nCNBC'}
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

                {/* Saved dates — divider between each date (no card chrome) */}
                {storedEvents.length > 0 ? (
                  <div className="space-y-14">
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
                          className="space-y-3"
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
                                disabled={geminiBusy}
                                onClick={() =>
                                  void handleGeminiSummarize(activeTicker, event, 'summary')
                                }
                                title="Structure this date's reason with Gemini"
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
                            </div>
                          </div>

                          <div className="mt-3 space-y-3 rounded-xl border border-border/60 bg-card/40 p-3">
                            <div className="space-y-1.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Reason
                              </p>
                              <Textarea
                                value={
                                  reasonDrafts[reasonDraftKey(activeTicker, event)] ??
                                  event.summary ??
                                  ''
                                }
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
                              <Textarea
                                value={
                                  sourceDrafts[reasonDraftKey(activeTicker, event)] ??
                                  serializeSourcesDraft(event.sources || [])
                                }
                                onChange={(e) =>
                                  setSourceDrafts((prev) => ({
                                    ...prev,
                                    [reasonDraftKey(activeTicker, event)]: e.target.value,
                                  }))
                                }
                                onBlur={() => void handleSaveReasonEdit(activeTicker, event)}
                                rows={Math.min(6, Math.max(2, sources.length || 2))}
                                className="min-h-[3.5rem] resize-y text-sm leading-relaxed"
                                placeholder={'Bloomberg\nReuters\nCNBC'}
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
                    <span className="font-medium text-foreground">Stock</span>
                    {' · Perplexity Finance'}
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
                  ? `${geminiEditTarget.ticker} · ${formatEventHeading(geminiEditTarget.event)} · edit Likely/Secondary structure, then save to Supabase (not a push)`
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
                Original scrape reason
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
            // ~80–90% viewport, wide 3-column sheet
            'flex h-[82svh] max-h-[82svh] w-[min(92vw,1400px)] max-w-[92vw] flex-col gap-3 overflow-hidden p-4 sm:p-5',
          )}
        >
          <DialogHeader className="shrink-0 space-y-1">
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="size-4" />
              Share on social media
              {socialShareCtx?.ticker ? ` · ${socialShareCtx.ticker}` : ''}
              {shareImageRerendering ? (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Updating…
                </span>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              Col 1: preview · Col 2: layout · Col 3: share + tweets. WhatsApp opens the desktop app
              with tweet 1; paste the image if it does not auto-attach.
            </DialogDescription>
          </DialogHeader>

          {socialShareBusy || !socialShareCtx ? (
            <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Building image + text…
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-3">
              {/* COL 1 — image preview + copy/download on top-right */}
              <div className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-xl border border-border/50 bg-muted/15 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Preview
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 px-2 text-xs"
                      disabled={!socialShareCtx.imageBlob}
                      onClick={async () => {
                        const ok = await copyImageBlobToClipboard(socialShareCtx.imageBlob)
                        toast({
                          title: ok ? 'Image copied' : 'Copy failed',
                          description: ok
                            ? 'Paste with ⌘/Ctrl+V in the social app.'
                            : 'Try Download image instead.',
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
                      variant="outline"
                      className="h-8 gap-1 px-2 text-xs"
                      disabled={!socialShareCtx.imageBlob}
                      onClick={() =>
                        downloadShareImage(socialShareCtx.imageBlob, socialShareCtx.ticker)
                      }
                    >
                      <Download className="size-3.5" />
                      Download
                    </Button>
                  </div>
                </div>
                {socialShareCtx.imageUrl ? (
                  <img
                    src={socialShareCtx.imageUrl}
                    alt="Share preview"
                    className="mx-auto max-h-[min(58svh,640px)] w-auto max-w-full rounded-xl border border-border/60 bg-background object-contain shadow-sm"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                    No image
                  </div>
                )}
              </div>

              {/* COL 2 — image layout controls */}
              <div className="min-h-0 overflow-y-auto rounded-xl border border-border/50 bg-muted/10 p-1">
                <ShareCardLayoutControls
                  style={shareCardStyle}
                  onChange={updateShareCardStyle}
                  idPrefix="social-share"
                />
              </div>

              {/* COL 3 — platforms + tweets with copy icons */}
              <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                <div className="space-y-2">
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
                          'inline-flex size-12 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-sm transition',
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
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Tweet 1
                    </p>
                    <button
                      type="button"
                      title="Copy tweet 1"
                      aria-label="Copy tweet 1"
                      className="inline-flex size-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      onClick={() =>
                        void copyTweetText(socialShareCtx.thread.tweet1, 'Tweet 1')
                      }
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/30 p-3 font-sans text-sm leading-relaxed">
                    {socialShareCtx.thread.tweet1}
                  </pre>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Tweet 2
                    </p>
                    <button
                      type="button"
                      title="Copy tweet 2"
                      aria-label="Copy tweet 2"
                      className="inline-flex size-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      onClick={() =>
                        void copyTweetText(socialShareCtx.thread.tweet2, 'Tweet 2')
                      }
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-muted/20 p-3 font-sans text-xs leading-relaxed text-muted-foreground">
                    {socialShareCtx.thread.tweet2}
                  </pre>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0 border-t border-border/50 pt-3">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <img
                    src={tweetImageUrl}
                    alt="Tweet share card"
                    className="mx-auto max-h-[420px] w-auto max-w-full rounded-xl border border-border/60 shadow-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        if (!tweetImageBlob) return
                        try {
                          await navigator.clipboard.write([
                            new ClipboardItem({ 'image/png': tweetImageBlob }),
                          ])
                          toast({
                            title: 'Image copied',
                            description: 'Paste (⌘/Ctrl+V) into the first tweet on X.',
                            durationMs: 4000,
                          })
                        } catch {
                          toast({
                            title: 'Could not copy image',
                            description: 'Download the image and attach it on X instead.',
                            durationMs: 4000,
                          })
                        }
                      }}
                    >
                      Copy image
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      asChild={false}
                      onClick={() => {
                        if (!tweetImageUrl) return
                        const a = document.createElement('a')
                        a.href = tweetImageUrl
                        a.download = 'trigger-momentum.png'
                        a.click()
                      }}
                    >
                      Download image
                    </Button>
                  </div>

                  <ShareCardLayoutControls
                    style={shareCardStyle}
                    onChange={updateShareCardStyle}
                    idPrefix="tweet-share"
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
        <DialogContent className="max-h-[85svh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {usagePopup === 'gemini' ? (
                <>
                  <Sparkles className="size-4 text-violet-600" />
                  Gemini spend by day
                </>
              ) : (
                'Firecrawl credits by day'
              )}
            </DialogTitle>
            <DialogDescription>
              {usagePopup === 'gemini'
                ? 'Estimated USD + tokens from structured dates in Supabase (last 30 days ET).'
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

          <DialogFooter>
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
          if (!open) {
            setFetchAllAlertBusyKey(null)
          }
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
                          const alertBusy = fetchAllAlertBusyKey === hitKey
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
                                    disabled={alertBusy || hit.subscriber_count === 0}
                                    onClick={() => void handleFetchAllQuickAlert(hit)}
                                    title="Send push to all subscribers"
                                  >
                                    {alertBusy ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <BellRing className="size-3.5" />
                                    )}
                                    Alert
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
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={hit.subscriber_count === 0}
                                    onClick={() => handleFetchAllOpenAlertPicker(hit)}
                                    title="Open recipient picker + preview"
                                  >
                                    Alert…
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

          <div className="min-h-0 max-h-[30svh] space-y-2 overflow-y-auto pr-1">
            {!movementAlertDevices.length ? (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center">
                <p className="text-sm font-medium">No subscribed devices</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No {notificationApp === 'trigger' ? 'Trigger' : '9AM'} users are subscribed to{' '}
                  {movementAlertTarget?.ticker}.
                </p>
              </div>
            ) : null}
            {movementAlertDevices.map((device) => {
              const key = deviceKey(device)
              const checked = movementAlertDeviceKeys.includes(key)
              const token = device.expo_push_token
              const maskedToken =
                token.length > 30 ? `${token.slice(0, 20)}…${token.slice(-8)}` : token
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
