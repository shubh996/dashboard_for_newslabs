import { type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowUpRight,
  Bookmark,
  Camera,
  CalendarClock,
  Check,
  Database,
  Flag,
  GripVertical,
  Heart,
  LogIn,
  LogOut,
  Loader2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  Sparkles,
  Trash2,
  Undo2,
  User,
  X,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useBottomToast } from '@/components/ui/bottom-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { readPref, writePref } from '@/lib/prefs'
import { supabase, supabaseAuthConfigured } from '@/lib/supabaseClient'
import {
  fetchYahooQuote,
  getSavedYahooTickerMap,
  resolveYahooLogoUrl,
  type YahooLiveQuote,
} from '@/services/yahooApi'
import YahooTickerDashboard from '@/pages/YahooTickerDashboard'
import type { User as SupabaseUser } from '@supabase/supabase-js'

type ProviderId = 'alpha-vantage' | 'finnhub' | 'polygon' | 'yahoo-finance' | 'newsapi'
type SourceTabId = ProviderId | 'supabase'

type NewsArticle = {
  id: string
  savedRowId?: string
  providerArticleId?: string | null
  provider: ProviderId
  providerLabel: string
  title: string
  summary: string
  url: string
  imageUrl: string
  source: string
  author: string
  publishedAt: string | null
  tickers: string[]
  topics: string[]
  sentimentScore: number | null
  sentimentLabel: string
  raw: unknown
}

type NewsResponse = {
  provider: SourceTabId
  query: string
  count: number
  articles: NewsArticle[]
  raw: unknown
}

type EnrichedTicker = {
  ticker: string
  exchange?: string
  relevance?: string
  sentimentScore?: string
  sentimentLabel?: string
  reason?: string
}

type EnrichedTopic = {
  topic: string
  relevance?: string
  sentimentScore?: string
  sentimentLabel?: string
}

type EditTickerForm = {
  ticker: string
  exchange: string
  relevance: string
  sentimentScore: string
  sentimentLabel: string
  reason: string
}

type EditArticleForm = {
  title: string
  summary: string
  url: string
  imageUrl: string
  source: string
  author: string
  publishedAt: string
  tickers: EditTickerForm[]
  topics: string[]
  sentimentLabel: string
  sentimentScore: string
}

type ClientCategoryId = 'all' | 'bookmarks' | 'liked' | 'ai' | 'business' | 'crypto' | 'markets' | 'us'
type ClientRailView = 'latest' | 'search' | 'bookmarks' | 'liked' | 'reported'
type DashboardCategoryId = 'all-us' | 'ai-infra' | 'digital-assets' | 'power-grid' | 'mega-cap' | 'wall-street' | 'health-innovation'
type AiDestination = 'perplexity' | 'chatgpt' | 'grok' | 'gemini'
type StockOpenDestination = 'tradingview' | 'yahoo-finance'
type ApiCallStatus = 'pending' | 'success' | 'error'

type ApiCallLog = {
  id: string
  method: string
  url: string
  status: ApiCallStatus
  startedAt: string
  durationMs?: number
  httpStatus?: number
  ok?: boolean
  requestBodyPreview?: string
  responsePreview?: string
  error?: string
}

const providers: Array<{ id: ProviderId; label: string; hint: string }> = [
  { id: 'polygon', label: 'Polygon', hint: 'Reference news feed' },
]

const SAVED_PAGE_SIZE = 10
const POLYGON_FETCH_LIMIT = 100

function sortArticlesByTimestamp(articles: NewsArticle[]) {
  return [...articles].sort((left, right) => {
    const leftTime = Date.parse(left.publishedAt || '') || 0
    const rightTime = Date.parse(right.publishedAt || '') || 0
    if (rightTime !== leftTime) return rightTime - leftTime
    return String(right.id).localeCompare(String(left.id))
  })
}

const clientCategories: Array<{ id: ClientCategoryId; label: string; terms: string[] }> = [
  { id: 'all', label: 'All', terms: [] },
  { id: 'bookmarks', label: 'Saved', terms: [] },
  { id: 'liked', label: 'Liked', terms: [] },
  { id: 'ai', label: 'AI', terms: ['ai', 'artificial intelligence', 'machine learning', 'nvidia', 'semiconductor'] },
  { id: 'business', label: 'Business', terms: ['business', 'earnings', 'revenue', 'profit', 'sales', 'company'] },
  { id: 'crypto', label: 'Crypto', terms: ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'coinbase'] },
  { id: 'markets', label: 'Markets', terms: ['markets', 'stocks', 'nasdaq', 's&p', 'dow', 'etf', 'treasury'] },
  { id: 'us', label: 'US', terms: ['us', 'u.s.', 'united states', 'america', 'fed', 'washington'] },
]

const clientTopCategories = clientCategories.filter((category) => category.id !== 'bookmarks' && category.id !== 'liked')

const dashboardCategories: Array<{ id: DashboardCategoryId; label: string; query: string }> = [
  { id: 'all-us', label: 'All US', query: '^GSPC,^IXIC,^DJI,^RUT,^NYA' },
  { id: 'ai-infra', label: 'AI Infra', query: 'NVDA,MSFT,AMD,AVGO,GOOGL,META' },
  { id: 'digital-assets', label: 'Digital Assets', query: 'COIN,MSTR,HOOD,RIOT,MARA,IBIT' },
  { id: 'power-grid', label: 'Power Grid', query: 'XOM,CVX,COP,SLB,NEE,GEV' },
  { id: 'mega-cap', label: 'Mega Cap', query: 'AAPL,MSFT,GOOGL,AMZN,META,NVDA,TSLA' },
  { id: 'wall-street', label: 'Wall Street', query: 'JPM,BAC,WFC,GS,MS,BLK' },
  { id: 'health-innovation', label: 'Health Innovation', query: 'LLY,UNH,JNJ,MRK,PFE,ISRG' },
]

const aiDestinations: Array<{ id: AiDestination; label: string }> = [
  { id: 'perplexity', label: 'Perplexity' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'grok', label: 'Grok' },
  { id: 'gemini', label: 'Gemini' },
]

const stockOpenDestinations: Array<{ id: StockOpenDestination; label: string }> = [
  { id: 'tradingview', label: 'TradingView' },
  { id: 'yahoo-finance', label: 'Yahoo Finance' },
]

const previewMinWidth = 280
const previewMaxWidth = 2400

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatDate(value: string | null) {
  if (!value) return 'No publish date'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatArticleDay(value: string | null) {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No date'
  // "Jul 12" style for consistent alignment in meta rows
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatArticleClock(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function articleDedupeKey(article: NewsArticle) {
  const url = article.url?.trim().toLowerCase()
  if (url) return `url:${url}`
  if (article.savedRowId) return `saved:${article.savedRowId}`
  return `id:${article.id}`
}

function dedupeArticles(articles: NewsArticle[]) {
  const seen = new Set<string>()
  return articles.filter((article) => {
    const key = articleDedupeKey(article)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function ArticleTimestamp({
  value,
  layout = 'stacked',
  className,
}: {
  value: string | null
  /** inline = single meta line (story header); stacked = date over time (news cards) */
  layout?: 'stacked' | 'inline'
  className?: string
}) {
  const day = formatArticleDay(value)
  const clock = formatArticleClock(value)

  if (layout === 'inline') {
    return (
      <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-sm leading-none', className)}>
        <span className="font-medium text-foreground">{day}</span>
        {clock ? (
          <>
            <span className="text-muted-foreground/50" aria-hidden="true">
              ·
            </span>
            <span className="tabular-nums text-muted-foreground">{clock}</span>
          </>
        ) : null}
      </span>
    )
  }

  return (
    <span className={cn('inline-flex shrink-0 flex-col items-end justify-center leading-tight', className)}>
      <span className="text-xs font-semibold text-foreground">{day}</span>
      {clock ? <span className="mt-0.5 text-[11px] font-medium text-muted-foreground">{clock}</span> : null}
    </span>
  )
}

function publishedTime(article: Pick<NewsArticle, 'publishedAt'>) {
  if (!article.publishedAt) return 0
  const time = new Date(article.publishedAt).getTime()
  return Number.isNaN(time) ? 0 : time
}

function sortNewsByLatest(articles: NewsArticle[]) {
  return [...articles].sort((left, right) => publishedTime(right) - publishedTime(left))
}

function localDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function articleGroupDateKey(value: string | null) {
  if (!value) return 'undated'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'undated'
  const day = localDayStart(date)
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function formatArticleDateHeading(value: string | null) {
  if (!value) return 'Undated'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Undated'

  const diffDays = Math.round((localDayStart(new Date()).getTime() - localDayStart(date).getTime()) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === -1) return 'Tomorrow'
  if (diffDays >= 1 && diffDays <= 6) return weekdayNames[date.getDay()]
  if (diffDays >= 7 && diffDays <= 30) return `${diffDays} days ago`

  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function groupArticlesByDate(articles: NewsArticle[]) {
  const groups: Array<{ key: string; heading: string; articles: NewsArticle[] }> = []
  const groupByKey = new Map<string, { key: string; heading: string; articles: NewsArticle[] }>()

  for (const article of articles) {
    const key = articleGroupDateKey(article.publishedAt)
    const existingGroup = groupByKey.get(key)
    if (existingGroup) {
      existingGroup.articles.push(article)
    } else {
      const newGroup = { key, heading: formatArticleDateHeading(article.publishedAt), articles: [article] }
      groupByKey.set(key, newGroup)
      groups.push(newGroup)
    }
  }

  return groups
}


function rawRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function rawArray(value: unknown) {
  return Array.isArray(value) ? value.map(rawRecord) : []
}

function rawString(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

const tradingViewExchangeMap: Record<string, string> = {
  AAPL: 'NASDAQ',
  AMD: 'NASDAQ',
  AMZN: 'NASDAQ',
  BRK_B: 'NYSE',
  BRK_A: 'NYSE',
  DIS: 'NYSE',
  DIA: 'AMEX',
  F: 'NYSE',
  GOOGL: 'NASDAQ',
  GOOG: 'NASDAQ',
  IWM: 'AMEX',
  JPM: 'NYSE',
  META: 'NASDAQ',
  MSFT: 'NASDAQ',
  NFLX: 'NASDAQ',
  NVDA: 'NASDAQ',
  PLTR: 'NASDAQ',
  QQQ: 'NASDAQ',
  SPY: 'AMEX',
  T: 'NYSE',
  TSLA: 'NASDAQ',
  V: 'NYSE',
  VGT: 'AMEX',
  XOM: 'NYSE',
}

const nasdaqCompositeTicker = 'IXIC'
const nasdaqCompositeSymbol = 'NASDAQ:IXIC'
// Liquid ETFs (not raw index symbols) so TradingView embeds resolve reliably.
const marketFallbackTickers = ['SPY', 'QQQ', 'DIA', 'IWM', 'MDY']
const indexTickerMetadata: Record<string, { name: string; type: string }> = {
  '^DJI': { name: 'Dow Jones Industrial Average', type: 'Index' },
  '^GSPC': { name: 'S&P 500', type: 'Index' },
  '^IXIC': { name: 'Nasdaq Composite', type: 'Composite index' },
  '^NDX': { name: 'Nasdaq 100', type: 'Index' },
  '^NYA': { name: 'NYSE Composite', type: 'Composite index' },
  '^RUT': { name: 'Russell 2000', type: 'Index' },
  '^SPX': { name: 'S&P 500', type: 'Index' },
  DJI: { name: 'Dow Jones Industrial Average', type: 'Index' },
  GSPC: { name: 'S&P 500', type: 'Index' },
  IXIC: { name: 'Nasdaq Composite', type: 'Composite index' },
  NDX: { name: 'Nasdaq 100', type: 'Index' },
  NYA: { name: 'NYSE Composite', type: 'Composite index' },
  RUT: { name: 'Russell 2000', type: 'Index' },
  SPX: { name: 'S&P 500', type: 'Index' },
}
const tradingViewSymbolOverrides: Record<string, string> = {
  '^DJI': 'TVC:DJI',
  '^GSPC': 'TVC:SPX',
  '^IXIC': 'TVC:IXIC',
  '^NDX': 'TVC:NDX',
  '^NYA': 'TVC:NYA',
  '^RUT': 'TVC:RUT',
  '^SPX': 'TVC:SPX',
  DIA: 'AMEX:DIA',
  DJI: 'TVC:DJI',
  GSPC: 'TVC:SPX',
  IXIC: 'TVC:IXIC',
  IWM: 'AMEX:IWM',
  MDY: 'AMEX:MDY',
  NDX: 'TVC:NDX',
  NYA: 'TVC:NYA',
  QQQ: 'NASDAQ:QQQ',
  RUT: 'TVC:RUT',
  SPX: 'TVC:SPX',
  SPY: 'AMEX:SPY',
}

function cleanArticleImageUrl(value: string) {
  const imageUrl = value.trim()
  if (!imageUrl) return ''

  const lowerUrl = imageUrl.toLowerCase()
  const fillerPatterns = [
    'yahoo_finance_en-us_h_p_finance',
    'investingcom_analysis_og',
    'placeholder',
    'no-image',
    'no_image',
    'default-image',
    'default_news',
  ]

  return fillerPatterns.some((pattern) => lowerUrl.includes(pattern)) ? '' : imageUrl
}

function tradingViewSymbol(ticker: string) {
  const cleanTicker = ticker.trim().toUpperCase()
  if (!cleanTicker) return nasdaqCompositeSymbol
  if (cleanTicker.includes(':')) return cleanTicker

  const normalizedTicker = cleanTicker.replace('.', '_').replace('-', '_')
  const overrideSymbol = tradingViewSymbolOverrides[normalizedTicker]
  if (overrideSymbol) return overrideSymbol

  const exchange = tradingViewExchangeMap[normalizedTicker]
  const tvTicker = cleanTicker.replace('.', '-')
  return exchange ? `${exchange}:${tvTicker}` : tvTicker
}

function tickerMetadata(ticker: string) {
  const cleanTicker = ticker.trim().toUpperCase()
  if (!cleanTicker) return null
  return indexTickerMetadata[cleanTicker] ?? null
}

function splitTickerSymbol(ticker: string) {
  const cleanTicker = ticker.trim().toUpperCase()
  if (!cleanTicker) return { exchange: '', ticker: '' }
  if (tickerMetadata(cleanTicker)) return { exchange: '', ticker: displayTicker(cleanTicker) }
  if (cleanTicker.includes(':')) {
    const [exchange, ...symbolParts] = cleanTicker.split(':')
    return { exchange, ticker: symbolParts.join(':') }
  }

  const tvSymbol = tradingViewSymbol(cleanTicker)
  if (tvSymbol.includes(':')) {
    const [exchange, ...symbolParts] = tvSymbol.split(':')
    return { exchange, ticker: displayTicker(symbolParts.join(':')) }
  }

  return { exchange: '', ticker: displayTicker(cleanTicker) }
}

function composeTickerSymbol(ticker: EditTickerForm) {
  const symbol = normalizeTicker(ticker.ticker)
  const exchange = ticker.exchange.trim().toUpperCase()
  if (!symbol) return ''
  return exchange ? `${exchange}:${symbol}` : symbol
}

function displayTicker(ticker: string) {
  const cleanTicker = ticker.trim().toUpperCase().replace(/^\^+/, '')
  return cleanTicker.includes(':') ? cleanTicker.split(':').slice(1).join(':') : cleanTicker
}

function tradingViewSymbolPageUrl(ticker: string) {
  return `https://www.tradingview.com/symbols/${tradingViewSymbol(ticker).replace(':', '-')}/`
}

function tradingViewWidgetBackground(theme: 'light' | 'dark') {
  return theme === 'dark' ? '#09090b' : '#ffffff'
}

function tradingViewAdvancedChartUrl(ticker: string, theme: 'light' | 'dark', height: number, compareTickers: string[]) {
  const symbol = tradingViewSymbol(ticker)
  const background = tradingViewWidgetBackground(theme)
  const compareSymbols = uniqueTickerList(compareTickers)
    .filter((item) => tradingViewSymbol(item) !== symbol)
    .slice(0, 8)
    .map((item) => ({
      symbol: tradingViewSymbol(item),
      position: 'SameScale',
    }))

  const options = {
    allow_symbol_change: false,
    calendar: false,
    details: false,
    hide_side_toolbar: true,
    hide_top_toolbar: false,
    hide_legend: false,
    hide_volume: false,
    hotlist: false,
    save_image: false,
    style: 3,
    withdateranges: true,
    symbol,
    locale: 'en',
    colorTheme: theme,
    autosize: true,
    height,
    compareSymbols,
    backgroundColor: background,
    gridColor: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    support_host: 'https://www.tradingview.com',
  }

  return `https://s.tradingview.com/embed-widget/advanced-chart/?locale=en&symbol=${encodeURIComponent(symbol)}#${encodeURIComponent(JSON.stringify(options))}`
}

/** Comparison chart for Market “All” only. */
function TradingViewComparisonChart({
  ticker,
  theme,
  height,
  compareTickers,
}: {
  ticker: string
  theme: 'light' | 'dark'
  height: number
  compareTickers: string[]
}) {
  const background = tradingViewWidgetBackground(theme)
  return (
    <div className="overflow-hidden rounded-lg border-0 bg-background" style={{ height }}>
      <iframe
        className="block border-0"
        height={height + 6}
        loading="lazy"
        src={tradingViewAdvancedChartUrl(ticker, theme, height + 6, compareTickers)}
        style={{
          border: 0,
          background,
          height: height + 6,
          margin: -3,
          width: 'calc(100% + 6px)',
        }}
        title={`Ticker comparison ${displayTicker(ticker)}`}
      />
    </div>
  )
}

const yahooFinanceIndexSymbols: Record<string, string> = {
  GSPC: '^GSPC',
  DJI: '^DJI',
  IXIC: '^IXIC',
  NDX: '^NDX',
  NYA: '^NYA',
  RUT: '^RUT',
  SPX: '^GSPC',
}

function yahooFinanceSymbol(ticker: string) {
  const cleanTicker = displayTicker(ticker)
  if (!cleanTicker) return ''
  return yahooFinanceIndexSymbols[cleanTicker] || cleanTicker.replace('.', '-')
}

function yahooFinanceSymbolUrl(ticker: string) {
  const symbol = yahooFinanceSymbol(ticker)
  return symbol ? `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}` : 'https://finance.yahoo.com/'
}

function stockOpenUrl(ticker: string, destination: StockOpenDestination) {
  return destination === 'yahoo-finance' ? yahooFinanceSymbolUrl(ticker) : tradingViewSymbolPageUrl(ticker)
}

function destinationLabel<T extends string>(items: Array<{ id: T; label: string }>, id: T) {
  return items.find((item) => item.id === id)?.label ?? id
}

function xSearchUrl(query: string) {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`
}

function sentimentBadgeClass(label: string) {
  const cleanLabel = label.toLowerCase()

  // Soft pill / tag style
  if (cleanLabel.includes('positive') || cleanLabel.includes('bullish')) {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300'
  }

  if (cleanLabel.includes('negative') || cleanLabel.includes('bearish')) {
    return 'border-red-500/20 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300'
  }

  if (cleanLabel.includes('neutral')) {
    return 'border-zinc-500/20 bg-zinc-500/10 text-zinc-600 hover:bg-zinc-500/15 dark:border-zinc-400/20 dark:bg-zinc-400/10 dark:text-zinc-300'
  }

  return 'border-zinc-500/20 bg-zinc-500/10 text-zinc-600 hover:bg-zinc-500/15 dark:border-zinc-400/20 dark:bg-zinc-400/10 dark:text-zinc-300'
}

function displaySentimentLabel(label: string) {
  const cleanLabel = label.toLowerCase()
  if (cleanLabel.includes('positive') || cleanLabel.includes('bullish')) return 'Positive'
  if (cleanLabel.includes('negative') || cleanLabel.includes('bearish')) return 'Negative'
  if (cleanLabel.includes('neutral')) return 'Neutral'
  return label
}

function SentimentCornerBadge({ label, className }: { label: string; className?: string }) {
  return (
    <Badge
      className={cn(
        'h-6 shrink-0 items-center rounded-full px-2.5 text-[11px] font-semibold leading-none tracking-wide',
        sentimentBadgeClass(label),
        className,
      )}
      title={label}
      variant="outline"
    >
      {displaySentimentLabel(label)}
    </Badge>
  )
}

function socialQueryForTickers(tickers: string[]) {
  const cleanTickers = uniqueTickerList(tickers)
    .map(displayTicker)
    .filter(Boolean)
    .slice(0, 8)

  if (!cleanTickers.length) return '$SPY'

  return cleanTickers
    .map((ticker) => {
      const cashtag = ticker.replace(/[^A-Z0-9]/g, '')
      return cashtag ? `$${cashtag}` : ticker
    })
    .join(' OR ')
}

function truncatePromptPart(value: string, maxLength = 1200) {
  return value.length > maxLength ? `${value.slice(0, maxLength).trim()}...` : value
}

function articleAiPrompt(article: NewsArticle, tickers: EnrichedTicker[], topics: EnrichedTopic[]) {
  const tickerLines = tickers.length
    ? tickers.map((ticker) => {
      return [
        displayTicker(ticker.ticker),
        ticker.exchange ? `exchange: ${ticker.exchange}` : '',
        ticker.sentimentLabel ? `sentiment: ${ticker.sentimentLabel}` : '',
        ticker.sentimentScore ? `score: ${ticker.sentimentScore}` : '',
        ticker.relevance ? `relevance: ${ticker.relevance}` : '',
        ticker.reason ? `reason: ${ticker.reason}` : '',
      ].filter(Boolean).join(' | ')
    }).join('\n')
    : 'No tickers provided.'

  const topicLines = topics.length
    ? topics.map((topic) => {
      return [
        topic.topic,
        topic.relevance ? `relevance: ${topic.relevance}` : '',
        topic.sentimentLabel ? `sentiment: ${topic.sentimentLabel}` : '',
        topic.sentimentScore ? `score: ${topic.sentimentScore}` : '',
      ].filter(Boolean).join(' | ')
    }).join('\n')
    : 'No topics provided.'

  return [
    'Analyze this market news article for a finance investment.',
    'Give a concise investor-focused breakdown, key facts to verify, ticker impact, risks, and follow-up questions.',
    '',
    `Headline: ${article.title}`,
    `Published: ${formatDate(article.publishedAt)}`,
    `Summary: ${truncatePromptPart(article.summary || 'No summary provided.')}`,
    `Source: ${article.source || article.providerLabel}`,
    article.author ? `Author: ${article.author}` : '',
    article.url ? `Original URL: ${article.url}` : '',
    '',
    `Tickers:\n${tickerLines}`,
    '',
    `Topics:\n${topicLines}`,
  ].filter(Boolean).join('\n')
}

function articleAiUrl(article: NewsArticle, tickers: EnrichedTicker[], topics: EnrichedTopic[], destination: AiDestination) {
  const prompt = articleAiPrompt(article, tickers, topics)
  const encodedPrompt = encodeURIComponent(prompt)

  if (destination === 'chatgpt') return `https://chatgpt.com/?q=${encodedPrompt}`
  if (destination === 'grok') return `https://grok.com/?q=${encodedPrompt}`
  if (destination === 'gemini') return `https://gemini.google.com/app?q=${encodedPrompt}`
  return `https://www.perplexity.ai/search/?q=${encodedPrompt}`
}

/** Prompt for discovering / improving linked tickers from full story context. Always opens Perplexity. */
function linkedTickersAiPrompt(article: NewsArticle, tickers: EnrichedTicker[], topics: EnrichedTopic[]) {
  const tickerLines = tickers.length
    ? tickers.map((ticker, index) => {
      return [
        `${index + 1}. ${displayTicker(ticker.ticker)}`,
        ticker.exchange || '—',
        ticker.sentimentLabel || '—',
        ticker.sentimentScore || '—',
        ticker.relevance || '—',
        ticker.reason || '—',
      ].join(' | ')
    }).join('\n')
    : '(none tagged yet)'

  const topicLines = topics.length
    ? topics.map((topic) => {
      return [
        topic.topic,
        topic.relevance ? `relevance ${topic.relevance}` : '',
        topic.sentimentLabel ? `sentiment ${topic.sentimentLabel}` : '',
        topic.sentimentScore ? `score ${topic.sentimentScore}` : '',
      ].filter(Boolean).join(' · ')
    }).join('\n')
    : '(none)'

  return [
    'You are a senior market-news desk editor at a finance newsroom.',
    'Task: recommend the BEST linked public-market tickers for the story below so an editor can tag the article.',
    '',
    'Rules:',
    '- Only US/major exchange listed stocks, ADRs, or liquid ETFs (NYSE, NASDAQ, AMEX, ARCA). No private companies, no OTC penny noise, no made-up symbols.',
    '- Prefer names explicitly mentioned or clearly material to the story (issuer, competitor, supplier, customer, sector proxy).',
    '- Cap at 6 tickers total. Order by relevance desc. Primary name first.',
    '- Be precise: if a company is private, map to the closest public parent/peer/ETF only if material, and say so in reason.',
    '- Do not invent financial facts. If unsure, lower relevance and say why.',
    '- Match our editor form fields exactly: Symbol, Exchange, Sentiment, Score, Relevance, Reason.',
    '',
    'Output format (use exactly these sections, nothing else before section 1):',
    '',
    '## 1) Final linked tickers (paste-ready)',
    'Markdown table with columns:',
    '| Symbol | Exchange | Sentiment | Score | Relevance | Reason |',
    'Where:',
    '- Symbol = Yahoo-style ticker only (e.g. AAPL, BRK-B, NVDA) — no company name in this cell',
    '- Exchange = NASDAQ / NYSE / AMEX / ARCA (best guess)',
    '- Sentiment = Bullish | Bearish | Neutral for THIS story’s impact on that ticker',
    '- Score = number from -1.00 to 1.00 (story impact; not stock rating)',
    '- Relevance = number from 0.00 to 1.00 (how tightly linked to this story)',
    '- Reason = one tight sentence, max 18 words, why it belongs on this story',
    '',
    '## 2) Keep / drop current tags',
    'For each currently linked ticker: KEEP or DROP + one short why.',
    'If none tagged, write: none tagged.',
    '',
    '## 3) One-line desk note',
    'Single sentence: what this story is really about for markets (max 25 words).',
    '',
    '--- STORY ---',
    `Headline: ${article.title}`,
    `Published: ${formatDate(article.publishedAt)}`,
    `Source: ${article.source || article.providerLabel}`,
    article.author ? `Author: ${article.author}` : '',
    article.url ? `URL: ${article.url}` : '',
    `Summary: ${truncatePromptPart(article.summary || 'No summary provided.', 1800)}`,
    '',
    'Currently linked tickers (Symbol | Exchange | Sentiment | Score | Relevance | Reason):',
    tickerLines,
    '',
    'Topics:',
    topicLines,
    '--- END ---',
  ].filter(Boolean).join('\n')
}

function linkedTickersPerplexityUrl(article: NewsArticle, tickers: EnrichedTicker[], topics: EnrichedTopic[]) {
  return `https://www.perplexity.ai/search/?q=${encodeURIComponent(linkedTickersAiPrompt(article, tickers, topics))}`
}

function formatLivePrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatLiveChangePercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

/** Live Yahoo Finance quote chip (unofficial API) + nav button flush to its right. */
function YahooLiveTickerWithLink({
  ticker,
  savedInSupabase = false,
  className,
}: {
  ticker: string
  savedInSupabase?: boolean
  className?: string
}) {
  const symbol = displayTicker(ticker)
  const [quote, setQuote] = useState<YahooLiveQuote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [logoFailed, setLogoFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setLogoFailed(false)
    void fetchYahooQuote(symbol)
      .then((body) => {
        if (!cancelled) {
          setQuote(body.quote || null)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuote(null)
          setError(true)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [symbol])

  const price = quote?.regularMarketPrice ?? null
  const change = quote?.regularMarketChange ?? null
  const changePct = quote?.regularMarketChangePercent ?? null
  const positive = (change ?? 0) >= 0
  const logoUrl = resolveYahooLogoUrl(quote, symbol)

  return (
    <div className={cn('inline-flex h-8 min-w-0 max-w-full shrink-0 items-center gap-1', className)}>
      <div
        className="inline-flex h-8 min-w-0 items-center gap-2 rounded-md bg-transparent px-0.5"
        title={quote?.shortName || symbol}
      >
        {logoUrl && !logoFailed ? (
          <img
            alt=""
            className="size-5 shrink-0 rounded-full bg-transparent object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            src={logoUrl}
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
            {symbol.slice(0, 2)}
          </span>
        )}
        <span className="shrink-0 text-base font-bold leading-none tracking-tight text-foreground">{symbol}</span>
        {loading ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : error || price == null ? (
          <span className="shrink-0 text-xs leading-none text-muted-foreground">—</span>
        ) : (
          <>
            <span className="shrink-0 text-[15px] font-semibold leading-none tabular-nums text-foreground">
              ${formatLivePrice(price)}
            </span>
            <span
              className={cn(
                'shrink-0 text-xs font-semibold leading-none tabular-nums',
                positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
              )}
            >
              {formatLiveChangePercent(changePct)}
            </span>
          </>
        )}
      </div>
      <TickerDashboardLinkButton
        className="size-5 shrink-0"
        savedInSupabase={savedInSupabase}
        ticker={ticker}
      />
    </div>
  )
}

function yahooTickerPath(ticker: string, savedInSupabase = false) {
  const symbol = displayTicker(ticker)
  return `/dashboard/yahoo/${encodeURIComponent(symbol)}${savedInSupabase ? '?source=saved' : ''}`
}

function TickerLinkBadge({
  ticker,
  strong = false,
  className,
  savedInSupabase = false,
}: {
  ticker: string
  strong?: boolean
  className?: string
  destination?: StockOpenDestination
  savedInSupabase?: boolean
}) {
  const navigate = useNavigate()
  const symbol = displayTicker(ticker)
  return (
    <Badge
      asChild
      className={cn(strong && 'bg-foreground text-background hover:bg-foreground/90', className)}
      variant={strong ? 'default' : 'secondary'}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          navigate(yahooTickerPath(symbol, savedInSupabase))
        }}
        title={
          savedInSupabase
            ? `Open ${symbol} from Supabase Yahoo snapshot`
            : `Open ${symbol} on Yahoo Finance dashboard`
        }
      >
        {symbol}
      </button>
    </Badge>
  )
}

/**
 * Small diagonal arrow next to the live ticker chip.
 * Filled green only when that ticker is already saved in Supabase — always shows the arrow icon.
 */
function TickerDashboardLinkButton({
  ticker,
  className,
  savedInSupabase = false,
}: {
  ticker: string
  className?: string
  savedInSupabase?: boolean
}) {
  const navigate = useNavigate()
  const symbol = displayTicker(ticker)
  return (
    <button
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full transition',
        savedInSupabase
          ? 'bg-emerald-500 text-white shadow-sm hover:bg-emerald-600'
          : 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation()
        navigate(yahooTickerPath(symbol, savedInSupabase))
      }}
      title={
        savedInSupabase
          ? `Open saved Yahoo Finance snapshot for ${symbol}`
          : `Open Yahoo Finance dashboard for ${symbol}`
      }
      type="button"
    >
      <ArrowUpRight className="size-3" strokeWidth={2.5} />
    </button>
  )
}

function normalizeTicker(value: string) {
  return value.trim().toUpperCase()
}

function normalizeTextList(items: string[]) {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
}

function uniqueTextList(items: string[]) {
  return Array.from(new Set(normalizeTextList(items)))
}

function uniqueTickerList(items: string[]) {
  return Array.from(new Set(items.map(normalizeTicker).filter(Boolean)))
}

function sameList(left: string[], right: string[]) {
  const cleanLeft = normalizeTextList(left)
  const cleanRight = normalizeTextList(right)
  return cleanLeft.length === cleanRight.length && cleanLeft.every((item, index) => item === cleanRight[index])
}

function optionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const nextValue = Number(trimmed)
  return Number.isFinite(nextValue) ? nextValue : null
}

function tickerFormFromEnriched(ticker: EnrichedTicker): EditTickerForm {
  const split = splitTickerSymbol(ticker.ticker)
  return {
    ticker: split.ticker,
    exchange: ticker.exchange || split.exchange,
    relevance: ticker.relevance || '',
    sentimentScore: ticker.sentimentScore || '',
    sentimentLabel: ticker.sentimentLabel || '',
    reason: ticker.reason || '',
  }
}

function tickerFormFromSymbol(ticker: string): EditTickerForm {
  return tickerFormFromEnriched({ ticker })
}

function editTickerSymbols(tickers: EditTickerForm[]) {
  return uniqueTickerList(tickers.map(composeTickerSymbol))
}

function articleMatchesCategory(article: NewsArticle, category: ClientCategoryId) {
  if (category === 'all' || category === 'bookmarks' || category === 'liked') return true

  const categoryConfig = clientCategories.find((item) => item.id === category)
  if (!categoryConfig) return true

  const searchableText = [
    article.title,
    article.summary,
    article.source,
    article.author,
    ...article.tickers,
    ...article.topics,
  ]
    .join(' ')
    .toLowerCase()

  return categoryConfig.terms.some((term) => searchableText.includes(term))
}

/** Google Images search for a story heading — open in a new tab to pick an alternate image. */
function googleImagesSearchUrl(query: string) {
  const q = query.trim()
  if (!q) return 'https://www.google.com/imghp'
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`
}

function articleStorageKey(article: Pick<NewsArticle, 'url'> | null | undefined) {
  return article?.url?.trim().toLowerCase() || ''
}

function tickerMatchKey(ticker: string) {
  return displayTicker(ticker).replace(/[^A-Z0-9]/g, '')
}

function articleMatchesLinkedTickers(article: NewsArticle, linkedTickerKeys: Set<string>) {
  return article.tickers.some((ticker) => linkedTickerKeys.has(tickerMatchKey(ticker)))
}

function truncateApiPreview(value: string) {
  return value.length > 2500 ? `${value.slice(0, 2500)}...` : value
}

function formatApiPreview(value: string) {
  if (!value.trim()) return ''

  try {
    return truncateApiPreview(JSON.stringify(JSON.parse(value), null, 2))
  } catch {
    return truncateApiPreview(value)
  }
}

function apiRequestBodyPreview(body: BodyInit | null | undefined) {
  if (!body) return ''
  if (typeof body === 'string') return truncateApiPreview(body)
  if (body instanceof URLSearchParams) return truncateApiPreview(body.toString())
  if (body instanceof FormData) return '[FormData]'
  if (body instanceof Blob) return `[Blob ${body.size} bytes]`
  return `[${body.constructor.name}]`
}

function apiUrlLabel(value: string) {
  try {
    const url = new URL(value, window.location.origin)
    return `${url.pathname}${url.search}`
  } catch {
    return value
  }
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable
}

const dashboardPath = '/dashboard'

function isDashboardPath(pathname: string) {
  return pathname.replace(/\/+$/, '') === dashboardPath
}

function clientModeFromPath() {
  if (typeof window === 'undefined') return true
  return !isDashboardPath(window.location.pathname)
}

function App() {
  const navigate = useNavigate()
  const { toast: showBottomToast } = useBottomToast()
  const [activeSource, setActiveSource] = useState<SourceTabId>('supabase')
  const [activeDashboardCategory, setActiveDashboardCategory] = useState<DashboardCategoryId>('all-us')
  const [query, setQuery] = useState('')
  const [data, setData] = useState<NewsResponse | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /** Live status line shown next to the header activity loader while Polygon (etc.) loads. */
  const [loadingStatus, setLoadingStatus] = useState('')
  /** Single-refresh transparency: only the main Polygon news request (not Market side-calls). */
  const [polygonFetchTrace, setPolygonFetchTrace] = useState<{
    startedAt: string
    finishedAt?: string
    durationMs?: number
    proxyUrl: string
    method: string
    query: string
    limit: number
    status: 'pending' | 'success' | 'error'
    httpStatus?: number
    articleCount?: number
    upstreamUrls?: string[]
    upstreamMode?: string
    responsePreview?: string
    error?: string
  } | null>(null)
  const [loadingMoreSaved, setLoadingMoreSaved] = useState(false)
  const [hasMoreSaved, setHasMoreSaved] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMode, setSavedMode] = useState(true)
  const [savedArticleIndex, setSavedArticleIndex] = useState<Record<string, NewsArticle>>({})
  const [clientMode, setClientMode] = useState(clientModeFromPath)
  const [activeClientRailView, setActiveClientRailView] = useState<ClientRailView>('latest')
  const [clientProfilePanelOpen, setClientProfilePanelOpen] = useState(false)
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null)
  const [authInitializing, setAuthInitializing] = useState(true)
  const [authStage, setAuthStage] = useState<'idle' | 'enter-email' | 'enter-otp'>('idle')
  const [authEmail, setAuthEmail] = useState('')
  const [authOtp, setAuthOtp] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [profileEditOpen, setProfileEditOpen] = useState(false)
  const [profileNameDraft, setProfileNameDraft] = useState('')
  const [profileAvatarDraft, setProfileAvatarDraft] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [activeClientCategory, setActiveClientCategory] = useState<ClientCategoryId>('all')
  const [activeMarketTicker, setActiveMarketTicker] = useState('all')
  const [showNormalizedJson, setShowNormalizedJson] = useState(false)
  const [apiDebugPanelOpen, setApiDebugPanelOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return readPref('api-debug-panel') === 'true'
  })
  const [apiCallLogs, setApiCallLogs] = useState<ApiCallLog[]>([])
  const [linkedStoryNewsStoryKey, setLinkedStoryNewsStoryKey] = useState('')
  const [linkedStoryNews, setLinkedStoryNews] = useState<NewsArticle[]>([])
  const [linkedStoryNewsLoading, setLinkedStoryNewsLoading] = useState(false)
  const [linkedStoryNewsError, setLinkedStoryNewsError] = useState('')
  const [bookmarkedArticleIds, setBookmarkedArticleIds] = useState<Set<string>>(() => new Set())
  const [likedArticleIds, setLikedArticleIds] = useState<Set<string>>(() => new Set())
  const [reportedArticleIds, setReportedArticleIds] = useState<Set<string>>(() => new Set())
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    return readPref('theme') === 'dark' ? 'dark' : 'light'
  })
  const [aiDestination, setAiDestination] = useState<AiDestination>(() => {
    if (typeof window === 'undefined') return 'perplexity'
    const stored = readPref('ai-destination')
    return aiDestinations.some((item) => item.id === stored) ? stored as AiDestination : 'perplexity'
  })
  const [stockOpenDestination, setStockOpenDestination] = useState<StockOpenDestination>(() => {
    if (typeof window === 'undefined') return 'tradingview'
    const stored = readPref('stock-open-destination')
    return stockOpenDestinations.some((item) => item.id === stored) ? stored as StockOpenDestination : 'tradingview'
  })
  const [previewWidth, setPreviewWidth] = useState(() => {
    if (typeof window === 'undefined') return 520
    return clamp(Number(readPref('preview-width') || 520), previewMinWidth, previewMaxWidth)
  })
  const [isResizingPreview, setIsResizingPreview] = useState(false)
  const [clientLatestWidth, setClientLatestWidth] = useState(() => {
    if (typeof window === 'undefined') return 360
    return clamp(Number(readPref('client-latest-width') || 360), 300, 560)
  })
  const [clientStoryWidth, setClientStoryWidth] = useState(() => {
    if (typeof window === 'undefined') return 520
    return clamp(Number(readPref('client-story-width') || 520), 380, 780)
  })
  const [clientTickerWidth, setClientTickerWidth] = useState(() => {
    if (typeof window === 'undefined') return 320
    return clamp(Number(readPref('client-ticker-width') || 320), 260, 460)
  })
  const [clientResizeTarget, setClientResizeTarget] = useState<'latest' | 'story' | 'tickers' | null>(null)
  const [editForm, setEditForm] = useState<EditArticleForm>({
    title: '',
    summary: '',
    url: '',
    imageUrl: '',
    source: '',
    author: '',
    publishedAt: '',
    tickers: [],
    topics: [],
    sentimentLabel: '',
    sentimentScore: '',
  })
  const [storyEditOpen, setStoryEditOpen] = useState(false)
  /** Inline edit index in the Tickers column (−1 = adding new, null = none). */
  const [tickerEditingIndex, setTickerEditingIndex] = useState<number | null>(null)
  const [tickerDraft, setTickerDraft] = useState<EditTickerForm | null>(null)
  /** Last deleted ticker — enables one-shot Undo without a confirm dialog. */
  const [tickerDeleteUndo, setTickerDeleteUndo] = useState<{
    articleId: string
    index: number
    ticker: EditTickerForm
  } | null>(null)
  const tickerDeleteUndoTimerRef = useRef<number | null>(null)
  const [tickerDragIndex, setTickerDragIndex] = useState<number | null>(null)
  const [tickerDragOverIndex, setTickerDragOverIndex] = useState<number | null>(null)
  const newsListScrollRef = useRef<HTMLDivElement | null>(null)
  /** When true, skip auto scroll-into-view on selectedId change (saves/updates must not jump the list). */
  const suppressNewsListAutoScrollRef = useRef(false)
  const queryRef = useRef(query)
  const activeDashboardCategoryRef = useRef(activeDashboardCategory)
  const savedOffsetRef = useRef(0)
  const hasMoreSavedRef = useRef(false)
  const loadingMoreSavedRef = useRef(false)
  const savedFetchGenerationRef = useRef(0)
  const initialSavedLoadRef = useRef(false)
  const previewWidthRef = useRef(previewWidth)
  const resizeStartRef = useRef({ startX: 0, startWidth: previewWidth })
  const clientLatestWidthRef = useRef(clientLatestWidth)
  const clientStoryWidthRef = useRef(clientStoryWidth)
  const clientTickerWidthRef = useRef(clientTickerWidth)
  const clientResizeStartRef = useRef({ startX: 0, startWidth: 0 })
  const shortcutStateRef = useRef({
    clientMode: false,
    editDirty: false,
    navigableArticles: [] as NewsArticle[],
    savedMode: false,
    selectedId: null as string | null,
  })

  const setClientModeRoute = useCallback((nextClientMode: boolean) => {
    setClientMode(nextClientMode)

    if (typeof window === 'undefined') return

    const nextPath = nextClientMode ? '/' : dashboardPath
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/'
    if (currentPath !== nextPath) {
      window.history.pushState(null, '', nextPath)
    }
  }, [])
  const shortcutActionsRef = useRef({
    bookmark: () => {},
    like: () => {},
    save: () => {},
    update: () => {},
  })

  const trackedFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAtMs = Date.now()
    const id = `${startedAtMs}-${Math.random().toString(36).slice(2)}`
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const requestBodyPreview = apiRequestBodyPreview(init?.body ?? null)

    setApiCallLogs((current) => [
      {
        id,
        method,
        url,
        status: 'pending' as const,
        startedAt: new Date(startedAtMs).toISOString(),
        requestBodyPreview,
      },
      ...current,
    ].slice(0, 80))

    try {
      const response = await fetch(input, init)
      let responsePreview = ''

      try {
        responsePreview = formatApiPreview(await response.clone().text())
      } catch {
        responsePreview = '[Unable to read response preview]'
      }

      setApiCallLogs((current) => current.map((item) => (
        item.id === id
          ? {
              ...item,
              status: response.ok ? 'success' : 'error',
              durationMs: Date.now() - startedAtMs,
              httpStatus: response.status,
              ok: response.ok,
              responsePreview,
            }
          : item
      )))

      return response
    } catch (fetchError) {
      setApiCallLogs((current) => current.map((item) => (
        item.id === id
          ? {
              ...item,
              status: 'error',
              durationMs: Date.now() - startedAtMs,
              error: fetchError instanceof Error ? fetchError.message : 'Request failed',
            }
          : item
      )))
      throw fetchError
    }
  }, [])

  const selectedArticle = useMemo(() => {
    return data?.articles.find((article) => article.id === selectedId) ?? data?.articles[0] ?? null
  }, [data, selectedId])

  const selectedRaw = useMemo(() => rawRecord(selectedArticle?.raw), [selectedArticle?.raw])
  const publisher = rawRecord(selectedRaw.publisher)
  const publisherLogoUrl = rawString(publisher.logo_url) || rawString(publisher.favicon_url)

  const enrichedTickers = useMemo<EnrichedTicker[]>(() => {
    if (!selectedArticle) return []

    const editorTickerDetails = rawArray(selectedRaw.editor_ticker_details)
    if (editorTickerDetails.length) {
      return editorTickerDetails
        .map((item) => ({
          ticker: rawString(item.ticker),
          exchange: rawString(item.exchange),
          relevance: rawString(item.relevance),
          sentimentScore: rawString(item.sentiment_score),
          sentimentLabel: rawString(item.sentiment_label),
          reason: rawString(item.reason),
        }))
        .filter((item) => item.ticker)
    }

    if (selectedArticle.provider === 'alpha-vantage') {
      const alphaTickerSentiments = rawArray(selectedRaw.ticker_sentiment)
      return alphaTickerSentiments
        .map((item) => ({
          ticker: rawString(item.ticker),
          exchange: splitTickerSymbol(rawString(item.ticker)).exchange,
          relevance: rawString(item.relevance_score),
          sentimentScore: rawString(item.ticker_sentiment_score),
          sentimentLabel: rawString(item.ticker_sentiment_label),
        }))
        .filter((item) => item.ticker)
    }

    if (selectedArticle.provider === 'polygon') {
      const insights = rawArray(selectedRaw.insights)
      return selectedArticle.tickers.map((ticker) => {
        const insight = insights.find((item) => rawString(item.ticker) === ticker)
        return {
          ticker,
          exchange: splitTickerSymbol(ticker).exchange,
          sentimentLabel: rawString(insight?.sentiment),
          reason: rawString(insight?.sentiment_reasoning),
        }
      })
    }

    return selectedArticle.tickers.map((ticker) => ({
      ticker,
      exchange: splitTickerSymbol(ticker).exchange,
    }))
  }, [selectedArticle, selectedRaw])

  const enrichedTopics = useMemo<EnrichedTopic[]>(() => {
    if (!selectedArticle) return []

    if (selectedArticle.provider === 'alpha-vantage') {
      return rawArray(selectedRaw.topics)
        .map((item) => ({
          topic: rawString(item.topic),
          relevance: rawString(item.relevance_score),
          sentimentScore: rawString(item.sentiment_score),
          sentimentLabel: rawString(item.sentiment_label),
        }))
        .filter((item) => item.topic)
    }

    return selectedArticle.topics.map((topic) => ({ topic }))
  }, [selectedArticle, selectedRaw])

  const activeProviderId = activeSource === 'supabase' ? 'polygon' : activeSource
  const activeProvider = providers.find((item) => item.id === activeProviderId) ?? providers[0]
  const activeLabel = savedMode ? 'Supabase Saved News' : activeProvider.label
  const isSavedArticleSelected = savedMode && Boolean(selectedArticle?.savedRowId)
  const selectedSavedMatch =
    !isSavedArticleSelected && selectedArticle
      ? savedArticleIndex[articleStorageKey(selectedArticle)] ?? null
      : null
  /** True when this story row exists in Supabase — drives Delete vs Save icon. */
  const articleIsInSupabase = Boolean(
    selectedArticle?.savedRowId || selectedSavedMatch?.savedRowId,
  )
  const selectedSupabaseRowId =
    selectedArticle?.savedRowId ?? selectedSavedMatch?.savedRowId ?? null
  const clientTickers = useMemo(() => {
    return uniqueTickerList(selectedArticle?.tickers ?? [])
  }, [selectedArticle])
  const [yahooSavedByTicker, setYahooSavedByTicker] = useState<Record<string, boolean>>({})
  /** Immediate green-arrow update when Market Yahoo dashboard saves/refreshes a snapshot. */
  const markYahooTickerSaved = useCallback((ticker: string, saved: boolean) => {
    const symbol = displayTicker(ticker)
    if (!symbol) return
    setYahooSavedByTicker((current) => {
      if (current[symbol] === saved) return current
      return { ...current, [symbol]: saved }
    })
  }, [])
  const yahooLookupTickers = useMemo(() => {
    // Include selected-article tickers + tickers shown on visible news cards.
    const fromFeed = (data?.articles ?? []).flatMap((article) => article.tickers)
    return uniqueTickerList([...clientTickers, ...fromFeed]).slice(0, 40)
  }, [clientTickers, data?.articles])

  useEffect(() => {
    const symbols = yahooLookupTickers.map((ticker) => displayTicker(ticker)).filter(Boolean)
    if (!symbols.length) {
      setYahooSavedByTicker({})
      return
    }

    let cancelled = false
    void getSavedYahooTickerMap(symbols)
      .then((savedMap) => {
        // Merge lookup results without clobbering optimistic true flags from an in-session save.
        if (cancelled) return
        setYahooSavedByTicker((current) => {
          const next = { ...current }
          for (const symbol of symbols) {
            const saved = Boolean(savedMap[symbol])
            if (saved) next[symbol] = true
            else if (current[symbol] !== true) next[symbol] = false
          }
          return next
        })
      })
      .catch(() => {
        /* ignore batch lookup failures — icons stay unchanged */
      })

    return () => {
      cancelled = true
    }
  }, [yahooLookupTickers])

  const linkedStoryTickers = useMemo(() => {
    if (!selectedArticle) return []

    return uniqueTickerList(selectedArticle.tickers)
  }, [selectedArticle])
  const linkedStoryRequestKey = selectedArticle
    ? [selectedArticle.id, selectedArticle.title, selectedArticle.tickers.join('|')].join('|')
    : ''
  const marketTickers = useMemo(() => {
    return clientTickers.length ? clientTickers : marketFallbackTickers
  }, [clientTickers])
  const resolveMarketTicker = useCallback((ticker: string) => {
    const cleanTicker = normalizeTicker(ticker)
    const displayValue = displayTicker(ticker)

    return (
      marketTickers.find((item) => normalizeTicker(item) === cleanTicker) ??
      marketTickers.find((item) => displayTicker(item) === displayValue) ??
      ticker
    )
  }, [marketTickers])
  const clientArticles = useMemo(() => {
    const articles = dedupeArticles(data?.articles ?? [])
    const searchQuery = query.trim().toLowerCase()

    return articles
      .filter((article) => {
        if (activeClientCategory === 'bookmarks') return bookmarkedArticleIds.has(article.id)
        if (activeClientCategory === 'liked') return likedArticleIds.has(article.id)
        if (activeClientRailView === 'bookmarks') return bookmarkedArticleIds.has(article.id)
        if (activeClientRailView === 'liked') return likedArticleIds.has(article.id)
        if (activeClientRailView === 'reported') return reportedArticleIds.has(article.id)
        return articleMatchesCategory(article, activeClientCategory)
      })
      .filter((article) => {
        if (!searchQuery) return true

        return [
          article.title,
          article.summary,
          article.source,
          article.author,
          ...article.tickers,
          ...article.topics,
        ]
          .join(' ')
          .toLowerCase()
          .includes(searchQuery)
      })
  }, [activeClientCategory, activeClientRailView, bookmarkedArticleIds, data, likedArticleIds, query, reportedArticleIds])
  const navigableArticles = useMemo(() => {
    return clientArticles
  }, [clientArticles])
  const activeMarketTickerValue =
    activeMarketTicker === 'all'
      ? marketTickers[0] ?? nasdaqCompositeTicker
      : resolveMarketTicker(activeMarketTicker) || marketTickers[0] || nasdaqCompositeTicker
  const showingAllMarketTickers = activeMarketTicker === 'all'
  const marketTradingViewTickers = showingAllMarketTickers
    ? marketTickers
    : activeMarketTickerValue
      ? [activeMarketTickerValue]
      : []

  const selectedArticleLiked = selectedArticle ? likedArticleIds.has(selectedArticle.id) : false
  const selectedArticleBookmarked = selectedArticle ? bookmarkedArticleIds.has(selectedArticle.id) : false
  const selectedArticleReported = selectedArticle ? reportedArticleIds.has(selectedArticle.id) : false
  const editDirty = useMemo(() => {
    if (!selectedArticle) return false

    const baselineTickers = (
      enrichedTickers.length
        ? enrichedTickers.map(tickerFormFromEnriched)
        : selectedArticle.tickers.map(tickerFormFromSymbol)
    ).map((item) => ({
      ticker: normalizeTicker(item.ticker),
      exchange: item.exchange.trim().toUpperCase(),
      relevance: item.relevance.trim(),
      sentimentScore: item.sentimentScore.trim(),
      sentimentLabel: item.sentimentLabel.trim(),
      reason: item.reason.trim(),
    }))
    const draftTickers = editForm.tickers
      .filter((item) => item.ticker.trim())
      .map((item) => ({
        ticker: normalizeTicker(item.ticker),
        exchange: item.exchange.trim().toUpperCase(),
        relevance: item.relevance.trim(),
        sentimentScore: item.sentimentScore.trim(),
        sentimentLabel: item.sentimentLabel.trim(),
        reason: item.reason.trim(),
      }))
    const tickersDirty = JSON.stringify(baselineTickers) !== JSON.stringify(draftTickers)

    return (
      editForm.title !== selectedArticle.title ||
      editForm.summary !== selectedArticle.summary ||
      editForm.url !== selectedArticle.url ||
      editForm.imageUrl !== selectedArticle.imageUrl ||
      editForm.source !== selectedArticle.source ||
      editForm.author !== selectedArticle.author ||
      (editForm.publishedAt || null) !== selectedArticle.publishedAt ||
      tickersDirty ||
      !sameList(editForm.topics, selectedArticle.topics) ||
      editForm.sentimentLabel !== selectedArticle.sentimentLabel ||
      optionalNumber(editForm.sentimentScore) !== selectedArticle.sentimentScore
    )
  }, [editForm, enrichedTickers, selectedArticle])

  useEffect(() => {
    shortcutStateRef.current = {
      clientMode,
      editDirty,
      navigableArticles,
      savedMode,
      selectedId,
    }
  }, [clientMode, editDirty, navigableArticles, savedMode, selectedId])

  useEffect(() => {
    function syncClientModeFromRoute() {
      setClientMode(clientModeFromPath())
    }

    window.addEventListener('popstate', syncClientModeFromRoute)
    return () => window.removeEventListener('popstate', syncClientModeFromRoute)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    writePref('theme', theme)
  }, [theme])

  useEffect(() => {
    writePref('ai-destination', aiDestination)
  }, [aiDestination])

  useEffect(() => {
    writePref('stock-open-destination', stockOpenDestination)
  }, [stockOpenDestination])

  useEffect(() => {
    if (!supabase) {
      setAuthInitializing(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setAuthUser(data.session?.user ?? null)
      setAuthInitializing(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!authUser) {
      setProfileEditOpen(false)
      return
    }
    if (!authUser.user_metadata?.full_name) {
      setProfileNameDraft('')
      setProfileAvatarDraft(String(authUser.user_metadata?.avatar_url ?? ''))
      setProfileEditOpen(true)
    }
  }, [authUser])

  useEffect(() => {
    writePref('api-debug-panel', String(apiDebugPanelOpen))
  }, [apiDebugPanelOpen])

  useEffect(() => {
    if (!clientMode || activeClientCategory === 'all') return
    if (!clientArticles.length) return
    if (selectedId && clientArticles.some((article) => article.id === selectedId)) return

    setSelectedId(clientArticles[0].id)
  }, [activeClientCategory, clientArticles, clientMode, selectedId])

  useEffect(() => {
    if (!marketTickers.length) return
    if (activeMarketTicker === 'all') return
    if (marketTickers.some((ticker) => normalizeTicker(ticker) === normalizeTicker(activeMarketTicker))) return
    if (marketTickers.some((ticker) => displayTicker(ticker) === displayTicker(activeMarketTicker))) return
    if (enrichedTickers.some((ticker) => displayTicker(ticker.ticker) === displayTicker(activeMarketTicker))) return

    setActiveMarketTicker('all')
  }, [activeMarketTicker, enrichedTickers, marketTickers])

  useEffect(() => {
    const requestKey = linkedStoryRequestKey

    if (!requestKey || !selectedArticle || !linkedStoryTickers.length) {
      setLinkedStoryNewsStoryKey('')
      setLinkedStoryNews([])
      setLinkedStoryNewsError('')
      setLinkedStoryNewsLoading(false)
      return
    }

    setLinkedStoryNewsStoryKey(requestKey)
    setLinkedStoryNewsLoading(false)
    setLinkedStoryNewsError('')

    const linkedTickerKeys = new Set(linkedStoryTickers.map(tickerMatchKey).filter(Boolean))
    const selectedUrlKey = articleStorageKey(selectedArticle)
    const seen = new Set<string>()
    const platformArticles = data?.articles ?? []
    const articles = platformArticles
      .filter((article) => article.id !== selectedArticle.id && articleStorageKey(article) !== selectedUrlKey)
      .filter((article) => articleMatchesLinkedTickers(article, linkedTickerKeys))
      .filter((article) => {
        const key = articleStorageKey(article) || article.id
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })

    setLinkedStoryNews(articles)
  }, [data, linkedStoryRequestKey, linkedStoryTickers, selectedArticle])

  useEffect(() => {
    if (!clientMode) return

    setActiveSource('supabase')
    setSavedMode(true)
    setData(null)
    setSelectedId(null)
    void fetchSavedArticles({ pageSize: 50 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when switching into client mode
  }, [clientMode])

  useEffect(() => {
    if (!selectedArticle) return
    // Don't clobber in-progress edits when only enriched tickers recompute.
    if (storyEditOpen) return

    setEditForm({
      title: selectedArticle.title,
      summary: selectedArticle.summary,
      url: selectedArticle.url,
      imageUrl: selectedArticle.imageUrl,
      source: selectedArticle.source,
      author: selectedArticle.author,
      publishedAt: selectedArticle.publishedAt || '',
      tickers: enrichedTickers.length
        ? enrichedTickers.map(tickerFormFromEnriched)
        : selectedArticle.tickers.map(tickerFormFromSymbol),
      topics: selectedArticle.topics,
      sentimentLabel: selectedArticle.sentimentLabel,
      sentimentScore: selectedArticle.sentimentScore === null ? '' : String(selectedArticle.sentimentScore),
    })
  }, [enrichedTickers, selectedArticle, storyEditOpen])

  useEffect(() => {
    setStoryEditOpen(false)
    setTickerEditingIndex(null)
    setTickerDraft(null)
    setTickerDeleteUndo(null)
    if (tickerDeleteUndoTimerRef.current != null) {
      window.clearTimeout(tickerDeleteUndoTimerRef.current)
      tickerDeleteUndoTimerRef.current = null
    }
  }, [selectedId])

  function preserveNewsListScroll(run: () => void) {
    const container = newsListScrollRef.current
    const scrollTop = container?.scrollTop ?? 0
    suppressNewsListAutoScrollRef.current = true
    run()
    requestAnimationFrame(() => {
      if (newsListScrollRef.current) {
        newsListScrollRef.current.scrollTop = scrollTop
      }
      // Second frame: list may reflow after React commit.
      requestAnimationFrame(() => {
        if (newsListScrollRef.current) {
          newsListScrollRef.current.scrollTop = scrollTop
        }
        // Allow future intentional navigations to auto-scroll again.
        window.setTimeout(() => {
          suppressNewsListAutoScrollRef.current = false
        }, 50)
      })
    })
  }

  // Keyboard / selection changes: keep the active card visible in the news list column.
  useEffect(() => {
    if (!selectedId) return
    if (suppressNewsListAutoScrollRef.current) return
    const container = newsListScrollRef.current
    if (!container) return

    const frame = window.requestAnimationFrame(() => {
      if (suppressNewsListAutoScrollRef.current) return
      const escape =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape
          : (value: string) => value.replace(/["\\]/g, '\\$&')
      const el = container.querySelector(`[data-article-id="${escape(selectedId)}"]`) as HTMLElement | null
      if (!el) return

      const containerRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const padding = 12
      const above = elRect.top < containerRect.top + padding
      const below = elRect.bottom > containerRect.bottom - padding
      if (!above && !below) return

      // Prefer nearest so we only nudge when off-screen; sticky date headers stay usable.
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [selectedId])

  useEffect(() => {
    previewWidthRef.current = previewWidth
    writePref('preview-width', String(previewWidth))
  }, [previewWidth])

  useEffect(() => {
    clientLatestWidthRef.current = clientLatestWidth
    writePref('client-latest-width', String(clientLatestWidth))
  }, [clientLatestWidth])

  useEffect(() => {
    clientStoryWidthRef.current = clientStoryWidth
    writePref('client-story-width', String(clientStoryWidth))
  }, [clientStoryWidth])

  useEffect(() => {
    clientTickerWidthRef.current = clientTickerWidth
    writePref('client-ticker-width', String(clientTickerWidth))
  }, [clientTickerWidth])


  useEffect(() => {
    if (!isResizingPreview) return

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onPointerMove(event: globalThis.PointerEvent) {
      const delta = event.clientX - resizeStartRef.current.startX
      setPreviewWidth(clamp(resizeStartRef.current.startWidth + delta, previewMinWidth, previewMaxWidth))
    }

    function onPointerUp() {
      setIsResizingPreview(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [isResizingPreview])

  useEffect(() => {
    if (!clientResizeTarget) return

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onPointerMove(event: globalThis.PointerEvent) {
      const delta = event.clientX - clientResizeStartRef.current.startX
      const nextWidth = clientResizeStartRef.current.startWidth + delta

      if (clientResizeTarget === 'latest') {
        setClientLatestWidth(clamp(nextWidth, 300, 560))
        return
      }

      if (clientResizeTarget === 'story') {
        setClientStoryWidth(clamp(nextWidth, 380, 780))
        return
      }

      setClientTickerWidth(clamp(nextWidth, 260, 460))
    }

    function onPointerUp() {
      setClientResizeTarget(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [clientResizeTarget])

  function startClientColumnResize(target: 'latest' | 'story' | 'tickers', event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    clientResizeStartRef.current = {
      startX: event.clientX,
      startWidth:
        target === 'latest'
          ? clientLatestWidthRef.current
          : target === 'story'
            ? clientStoryWidthRef.current
            : clientTickerWidthRef.current,
    }
    setClientResizeTarget(target)
  }

  useEffect(() => {
    queryRef.current = query
  }, [query])

  useEffect(() => {
    activeDashboardCategoryRef.current = activeDashboardCategory
  }, [activeDashboardCategory])

  useEffect(() => {
    void refreshSavedArticleIndex()
  }, [])

  const fetchNews = useCallback(async (nextProvider: ProviderId, queryOverride?: string) => {
    setLoading(true)
    setError('')
    setHasMoreSaved(false)
    hasMoreSavedRef.current = false
    savedOffsetRef.current = 0

    // Query = search box only (may be empty). Never inject category tickers — that made
    // the server fire N Polygon calls (one per ticker) and looked like "multiple requests".
    const effectiveQuery = (queryOverride ?? queryRef.current).trim()
    const params = new URLSearchParams({
      limit: String(POLYGON_FETCH_LIMIT),
    })
    if (effectiveQuery) params.set('query', effectiveQuery)
    const proxyUrl = `/api/providers/${nextProvider}/news?${params.toString()}`
    const startedAtMs = Date.now()
    const startedAt = new Date(startedAtMs).toISOString()

    setLoadingStatus(
      effectiveQuery
        ? `Fetching Polygon news for “${effectiveQuery.slice(0, 56)}${effectiveQuery.length > 56 ? '…' : ''}”…`
        : 'Fetching latest Polygon news…',
    )
    setPolygonFetchTrace({
      startedAt,
      proxyUrl,
      method: 'GET',
      query: effectiveQuery,
      limit: POLYGON_FETCH_LIMIT,
      status: 'pending',
    })

    try {
      const response = await trackedFetch(proxyUrl)
      const body = await response.json()
      const durationMs = Date.now() - startedAtMs

      if (!response.ok) {
        throw new Error(body.error || 'Unable to fetch provider news.')
      }

      const articles = dedupeArticles(sortArticlesByTimestamp(Array.isArray(body.articles) ? body.articles : []))
      const upstream = body.upstream as
        | { urls?: string[]; mode?: string; count?: number }
        | null
        | undefined

      setPolygonFetchTrace({
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs,
        proxyUrl,
        method: 'GET',
        query: effectiveQuery,
        limit: POLYGON_FETCH_LIMIT,
        status: 'success',
        httpStatus: response.status,
        articleCount: articles.length,
        upstreamUrls: Array.isArray(upstream?.urls) ? upstream.urls : undefined,
        upstreamMode: upstream?.mode,
        responsePreview: formatApiPreview(JSON.stringify({
          provider: body.provider,
          query: body.query,
          limit: body.limit,
          count: body.count ?? articles.length,
          upstream: body.upstream ?? null,
          articles: articles.slice(0, 3).map((article: NewsArticle) => ({
            id: article.id,
            title: article.title,
            publishedAt: article.publishedAt,
            tickers: article.tickers?.slice?.(0, 4) ?? article.tickers,
          })),
        })),
      })

      setActiveSource(nextProvider)
      setSavedMode(false)
      setData({
        ...body,
        provider: nextProvider,
        articles,
        count: articles.length,
      })
      setSelectedId(articles[0]?.id ?? null)
      setLoadingStatus('')
      showBottomToast({
        title: 'News refreshed',
        description: effectiveQuery
          ? `Loaded ${articles.length} Polygon articles for “${effectiveQuery.slice(0, 40)}${effectiveQuery.length > 40 ? '…' : ''}”.`
          : `Loaded ${articles.length} latest Polygon articles.`,
      })
    } catch (fetchError) {
      const durationMs = Date.now() - startedAtMs
      const message = fetchError instanceof Error ? fetchError.message : 'Unable to fetch provider news.'
      setPolygonFetchTrace((current) =>
        current
          ? {
              ...current,
              finishedAt: new Date().toISOString(),
              durationMs,
              status: 'error',
              error: message,
            }
          : current,
      )
      setData(null)
      setSelectedId(null)
      setError(message)
      showBottomToast({ title: 'Refresh failed', description: message, variant: 'destructive' })
      setLoadingStatus('')
    } finally {
      setLoading(false)
    }
  }, [trackedFetch, showBottomToast])

  function compressImageFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Could not read that image.'))
      reader.onload = () => {
        const img = new Image()
        img.onerror = () => reject(new Error('Could not read that image.'))
        img.onload = () => {
          const size = 160
          const canvas = document.createElement('canvas')
          canvas.width = size
          canvas.height = size
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Could not process that image.'))
            return
          }
          const scale = Math.max(size / img.width, size / img.height)
          const drawWidth = img.width * scale
          const drawHeight = img.height * scale
          ctx.drawImage(img, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight)
          resolve(canvas.toDataURL('image/jpeg', 0.7))
        }
        img.src = String(reader.result)
      }
      reader.readAsDataURL(file)
    })
  }

  async function handleProfilePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      setProfileAvatarDraft(await compressImageFile(file))
    } catch (photoError) {
      setProfileError(photoError instanceof Error ? photoError.message : 'Could not use that image.')
    }
  }

  async function sendAuthOtp() {
    if (!supabase) {
      setAuthError('Sign-in is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
      return
    }
    const cleanEmail = authEmail.trim().toLowerCase()
    if (!cleanEmail) {
      setAuthError('Enter an email address first.')
      return
    }

    setAuthLoading(true)
    setAuthError('')
    setAuthNotice('')
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({ email: cleanEmail })
      if (otpError) throw otpError
      setAuthStage('enter-otp')
      setAuthNotice(`We sent a 6-digit code to ${cleanEmail}.`)
    } catch (otpError) {
      setAuthError(otpError instanceof Error ? otpError.message : 'Could not send the sign-in code.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function confirmAuthOtp() {
    if (!supabase) return
    const cleanEmail = authEmail.trim().toLowerCase()
    const cleanOtp = authOtp.trim()
    if (!cleanOtp) {
      setAuthError('Enter the code we emailed you.')
      return
    }

    setAuthLoading(true)
    setAuthError('')
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email: cleanEmail, token: cleanOtp, type: 'email' })
      if (verifyError) throw verifyError
      setAuthStage('idle')
      setAuthOtp('')
      setAuthNotice('')
    } catch (verifyError) {
      setAuthError(verifyError instanceof Error ? verifyError.message : 'That code did not work. Try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function signOutUser() {
    if (!supabase) return
    await supabase.auth.signOut()
    setAuthStage('idle')
    setAuthEmail('')
    setAuthOtp('')
    setAuthNotice('')
    setAuthError('')
  }

  function startSignIn() {
    setAuthStage('enter-email')
    setAuthError('')
    setAuthNotice('')
  }

  function cancelSignIn() {
    setAuthStage('idle')
    setAuthEmail('')
    setAuthOtp('')
    setAuthError('')
    setAuthNotice('')
  }

  function startProfileEdit() {
    setProfileNameDraft(String(authUser?.user_metadata?.full_name ?? ''))
    setProfileAvatarDraft(String(authUser?.user_metadata?.avatar_url ?? ''))
    setProfileError('')
    setProfileEditOpen(true)
  }

  async function saveProfile() {
    if (!supabase) return
    const cleanName = profileNameDraft.trim()
    if (!cleanName) {
      setProfileError('Add a name to continue.')
      return
    }

    setProfileSaving(true)
    setProfileError('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        data: { full_name: cleanName, avatar_url: profileAvatarDraft || null },
      })
      if (updateError) throw updateError
      setProfileEditOpen(false)
      showBottomToast({ title: 'Profile updated', description: 'Your name and photo are saved.' })
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Could not save your profile.'
      setProfileError(message)
      showBottomToast({ title: 'Profile save failed', description: message, variant: 'destructive' })
    } finally {
      setProfileSaving(false)
    }
  }

  const fetchSavedArticles = useCallback(async (options?: { append?: boolean; pageSize?: number }) => {
    const append = options?.append ?? false
    const pageSize = options?.pageSize ?? SAVED_PAGE_SIZE

    if (append) {
      if (loadingMoreSavedRef.current || !hasMoreSavedRef.current) return
      loadingMoreSavedRef.current = true
      setLoadingMoreSaved(true)
    } else {
      setLoading(true)
      savedOffsetRef.current = 0
      hasMoreSavedRef.current = false
      setHasMoreSaved(false)
      savedFetchGenerationRef.current += 1
    }

    const generation = savedFetchGenerationRef.current
    setError('')

    try {
      const offset = append ? savedOffsetRef.current : 0
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
      })
      const response = await trackedFetch(`/api/articles/saved?${params}`)
      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        // 404 = API route missing on the host (e.g. CF Functions not deployed / env not set).
        const detail =
          body?.error ||
          (response.status === 404
            ? 'Saved-articles API not found (404). On Cloudflare Pages, ensure Functions are enabled and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are set.'
            : `Unable to fetch saved Supabase articles (${response.status}).`)
        throw new Error(detail)
      }

      // Drop stale non-append responses (e.g. React StrictMode double mount).
      if (!append && generation !== savedFetchGenerationRef.current) return

      const pageArticles = dedupeArticles(sortArticlesByTimestamp(Array.isArray(body.articles) ? body.articles : []))
      const nextHasMore = typeof body.hasMore === 'boolean' ? body.hasMore : pageArticles.length >= pageSize
      savedOffsetRef.current = offset + pageArticles.length
      hasMoreSavedRef.current = nextHasMore
      setHasMoreSaved(nextHasMore)

      setActiveSource('supabase')
      setSavedMode(true)

      if (append) {
        setData((current) => {
          const merged = dedupeArticles(sortArticlesByTimestamp([...(current?.articles ?? []), ...pageArticles]))
          return {
            provider: 'supabase',
            query: '',
            count: merged.length,
            articles: merged,
            raw: body.raw ?? null,
          }
        })
      } else {
        setData({
          provider: 'supabase',
          query: '',
          count: pageArticles.length,
          articles: pageArticles,
          raw: body.raw ?? null,
        })
        setSelectedId(pageArticles[0]?.id ?? null)
      }

      if (pageArticles.length) {
        setSavedArticleIndex((current) => {
          const nextIndex = { ...current }
          pageArticles.forEach((article: NewsArticle) => {
            const key = articleStorageKey(article)
            if (key) nextIndex[key] = article
          })
          return nextIndex
        })
      }

      // Only toast explicit loads/refreshes — not silent infinite-scroll appends.
      if (!append) {
        showBottomToast({
          title: 'Saved stories loaded',
          description:
            pageArticles.length > 0
              ? `Loaded ${pageArticles.length} stories from Supabase.`
              : 'No saved stories in Supabase yet.',
        })
      }
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : 'Unable to fetch saved Supabase articles.'
      if (!append && generation === savedFetchGenerationRef.current) {
        setData(null)
        setSelectedId(null)
        setError(message)
        showBottomToast({ title: 'Supabase load failed', description: message, variant: 'destructive' })
      } else if (append) {
        setError(message)
        showBottomToast({ title: 'Load more failed', description: message, variant: 'destructive' })
      }
    } finally {
      if (append) {
        loadingMoreSavedRef.current = false
        setLoadingMoreSaved(false)
      } else if (generation === savedFetchGenerationRef.current) {
        setLoading(false)
      }
    }
  }, [trackedFetch, showBottomToast])

  async function refreshSavedArticleIndex() {
    try {
      const params = new URLSearchParams({
        limit: '500',
      })
      const response = await trackedFetch(`/api/articles/saved?${params}`)
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body.error || 'Unable to check saved Supabase articles.')
      }

      const articles = Array.isArray(body.articles) ? body.articles as NewsArticle[] : []
      const nextIndex: Record<string, NewsArticle> = {}
      articles.forEach((article) => {
        const key = articleStorageKey(article)
        if (key) nextIndex[key] = article
      })
      setSavedArticleIndex(nextIndex)
    } catch {
      setSavedArticleIndex({})
    }
  }

  function editedArticleDraft(article: NewsArticle) {
    const editorTickerDetails = editForm.tickers
      .map((ticker) => ({
        ticker: normalizeTicker(ticker.ticker),
        exchange: ticker.exchange.trim().toUpperCase(),
        relevance: ticker.relevance.trim(),
        sentiment_score: ticker.sentimentScore.trim(),
        sentiment_label: ticker.sentimentLabel.trim(),
        reason: ticker.reason.trim(),
      }))
      .filter((ticker) => ticker.ticker)

    return {
      ...article,
      title: editForm.title,
      summary: editForm.summary,
      url: editForm.url,
      imageUrl: editForm.imageUrl,
      source: editForm.source,
      author: editForm.author,
      publishedAt: editForm.publishedAt || null,
      tickers: editTickerSymbols(editForm.tickers),
      topics: uniqueTextList(editForm.topics),
      sentimentLabel: editForm.sentimentLabel,
      sentimentScore: optionalNumber(editForm.sentimentScore),
      raw: {
        ...rawRecord(article.raw),
        editor_ticker_details: editorTickerDetails,
      },
    }
  }

  async function saveSelectedArticle() {
    if (!selectedArticle) return

    setSaving(true)

    try {
      const response = await trackedFetch('/api/articles/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ article: editedArticleDraft(selectedArticle) }),
      })
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body.error || 'Unable to save article.')
      }

      const savedArticle = body.article as NewsArticle | undefined
      if (savedArticle) {
        // Keep the feed item id stable so selectedId / list scroll position don't jump to top.
        preserveNewsListScroll(() => {
          setData((current) => {
            if (!current) return current
            return {
              ...current,
              articles: current.articles.map((item) =>
                item.id === selectedArticle.id ||
                articleStorageKey(item) === articleStorageKey(selectedArticle)
                  ? {
                      ...item,
                      ...savedArticle,
                      id: item.id,
                      savedRowId: savedArticle.savedRowId ?? item.savedRowId,
                    }
                  : item,
              ),
            }
          })
        })
      }
      await refreshSavedArticleIndex()
      showBottomToast({
        title: 'Story saved',
        description: 'Saved to Supabase. You can delete it anytime from the header.',
      })
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to save article.'
      showBottomToast({ title: 'Save failed', description: message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function updateSavedArticle(options?: { force?: boolean }) {
    const savedRowId = selectedArticle?.savedRowId ?? selectedSavedMatch?.savedRowId
    if (!selectedArticle || !savedRowId) return
    if (!options?.force && !editDirty) return

    setSaving(true)

    const article = editedArticleDraft(selectedArticle)
    const previousSelectedId = selectedArticle.id

    try {
      const response = await trackedFetch(`/api/articles/saved/${savedRowId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ article }),
      })
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body.error || 'Unable to update saved article.')
      }

      const updated = body.article as NewsArticle
      // Merge server payload but keep the current list item id so selection + scroll stay put.
      preserveNewsListScroll(() => {
        setData((current) => {
          if (!current) return current
          return {
            ...current,
            articles: current.articles.map((item) =>
              item.id === previousSelectedId || item.savedRowId === savedRowId
                ? {
                    ...item,
                    ...updated,
                    id: item.id,
                    // Prefer draft image if server omits/lags image fields.
                    imageUrl: article.imageUrl || updated.imageUrl || item.imageUrl,
                    title: article.title || updated.title || item.title,
                    summary: article.summary || updated.summary || item.summary,
                    savedRowId: updated.savedRowId ?? savedRowId,
                  }
                : item,
            ),
          }
        })
        // Do not reassign selectedId to a different server id — that made the list jump to #1.
        setSelectedId(previousSelectedId)
        setStoryEditOpen(false)
      })
      showBottomToast({
        title: 'Story updated',
        description: 'Changes (title, image, tickers, etc.) saved to Supabase.',
      })
      await refreshSavedArticleIndex()
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to update saved article.'
      showBottomToast({ title: 'Update failed', description: message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function deleteSavedArticle(savedRowId = selectedSupabaseRowId) {
    if (!savedRowId) return
    const shouldDelete = window.confirm('Delete this saved Supabase article?')
    if (!shouldDelete) return

    setSaving(true)

    const deletedArticle = selectedArticle
    const storageKey = deletedArticle ? articleStorageKey(deletedArticle) : ''

    // Pick next story at the same list index (or previous if this was last) — never jump to top.
    const currentList = data?.articles ?? []
    const deleteIndex = currentList.findIndex(
      (item) => item.savedRowId === savedRowId || item.id === selectedArticle?.id,
    )
    // In saved feed, remove the row. In live Polygon feed, keep the story but strip saved marker.
    const remaining = savedMode
      ? currentList.filter((item) => item.savedRowId !== savedRowId && item.id !== selectedArticle?.id)
      : currentList
    const nextArticle =
      (deleteIndex >= 0 ? remaining[deleteIndex] : null) ??
      (deleteIndex > 0 ? remaining[deleteIndex - 1] : null) ??
      remaining[0] ??
      null
    const preservedScrollTop = newsListScrollRef.current?.scrollTop ?? 0

    try {
      const response = await trackedFetch(`/api/articles/saved/${savedRowId}`, {
        method: 'DELETE',
      })
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body.error || 'Unable to delete saved article.')
      }

      // Optimistic: drop from saved index so Delete icon flips to Save immediately.
      setSavedArticleIndex((current) => {
        const next = { ...current }
        if (storageKey) delete next[storageKey]
        for (const key of Object.keys(next)) {
          if (next[key]?.savedRowId === savedRowId) delete next[key]
        }
        return next
      })

      if (savedMode) {
        setData((current) => {
          if (!current) return current
          const articles = current.articles.filter(
            (item) => item.savedRowId !== savedRowId && item.id !== deletedArticle?.id,
          )
          return {
            ...current,
            count: articles.length,
            articles,
          }
        })
        setSelectedId(nextArticle?.id ?? null)
        setStoryEditOpen(false)
      } else {
        // Live feed: keep story visible, clear Supabase linkage → Save icon shows.
        setData((current) => {
          if (!current) return current
          return {
            ...current,
            articles: current.articles.map((item) => {
              const sameRow =
                item.savedRowId === savedRowId ||
                item.id === deletedArticle?.id ||
                (storageKey && articleStorageKey(item) === storageKey)
              if (!sameRow) return item
              const { savedRowId: _drop, ...rest } = item
              return { ...rest, savedRowId: undefined }
            }),
          }
        })
      }

      requestAnimationFrame(() => {
        if (newsListScrollRef.current) {
          newsListScrollRef.current.scrollTop = preservedScrollTop
        }
      })

      showBottomToast({
        title: 'Story deleted',
        description: 'Removed from Supabase. Save again anytime to restore it.',
      })
      await refreshSavedArticleIndex()
      requestAnimationFrame(() => {
        if (newsListScrollRef.current) {
          newsListScrollRef.current.scrollTop = preservedScrollTop
        }
      })
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Unable to delete saved article.'
      showBottomToast({ title: 'Delete failed', description: message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  function openStoryEditor() {
    if (!selectedArticle) return
    setEditForm({
      title: selectedArticle.title,
      summary: selectedArticle.summary,
      url: selectedArticle.url,
      imageUrl: selectedArticle.imageUrl,
      source: selectedArticle.source,
      author: selectedArticle.author,
      publishedAt: selectedArticle.publishedAt || '',
      tickers: enrichedTickers.length
        ? enrichedTickers.map(tickerFormFromEnriched)
        : selectedArticle.tickers.map(tickerFormFromSymbol),
      topics: selectedArticle.topics,
      sentimentLabel: selectedArticle.sentimentLabel,
      sentimentScore: selectedArticle.sentimentScore === null ? '' : String(selectedArticle.sentimentScore),
    })
    setStoryEditOpen(true)
    showBottomToast({
      title: 'Editing story',
      description: 'Change title, image URL, or fields — then use the Save (database) icon.',
    })
  }

  function cancelStoryEditor() {
    setStoryEditOpen(false)
    if (!selectedArticle) return
    setEditForm({
      title: selectedArticle.title,
      summary: selectedArticle.summary,
      url: selectedArticle.url,
      imageUrl: selectedArticle.imageUrl,
      source: selectedArticle.source,
      author: selectedArticle.author,
      publishedAt: selectedArticle.publishedAt || '',
      tickers: enrichedTickers.length
        ? enrichedTickers.map(tickerFormFromEnriched)
        : selectedArticle.tickers.map(tickerFormFromSymbol),
      topics: selectedArticle.topics,
      sentimentLabel: selectedArticle.sentimentLabel,
      sentimentScore: selectedArticle.sentimentScore === null ? '' : String(selectedArticle.sentimentScore),
    })
    showBottomToast({
      title: 'Edit cancelled',
      description: 'Story fields restored. Nothing was saved.',
    })
  }

  /**
   * Single story save entry — always the header Database icon.
   * Uses edit form (title, image URL, tickers, …) so edit-mode changes persist.
   */
  async function saveStoryPrimary() {
    if (!selectedArticle) return
    const hasSavedRow = Boolean(selectedArticle.savedRowId ?? selectedSavedMatch?.savedRowId)
    if (hasSavedRow) {
      if (!editDirty && !storyEditOpen) {
        showBottomToast({
          title: 'Nothing to save',
          description: 'No edits on this story yet. Change fields first, then save.',
        })
        return
      }
      await updateSavedArticle({ force: true })
      return
    }
    await saveSelectedArticle()
    setStoryEditOpen(false)
  }

  useEffect(() => {
    if (clientMode) {
      initialSavedLoadRef.current = false
      return
    }
    if (initialSavedLoadRef.current) return
    initialSavedLoadRef.current = true
    void fetchSavedArticles({ pageSize: SAVED_PAGE_SIZE })
    // Load Supabase feed once when entering the dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid reloading over Polygon results
  }, [clientMode])

  function handleDashboardCategoryChange(id: DashboardCategoryId) {
    setActiveDashboardCategory(id)
    activeDashboardCategoryRef.current = id
    setQuery('')
    const label =
      dashboardCategories.find((item) => item.id === id)?.label ||
      id.replace(/-/g, ' ')
    showBottomToast({
      title: 'Category changed',
      description: `Filter set to “${label}”.`,
    })
  }

  function handleNewsListScroll(event: UIEvent<HTMLDivElement>) {
    if (!savedMode || loadingMoreSavedRef.current || !hasMoreSavedRef.current) return
    const target = event.currentTarget
    if (target.scrollHeight - target.scrollTop - target.clientHeight > 160) return
    void fetchSavedArticles({ append: true })
  }

  function toggleClientBookmark() {
    if (!selectedArticle) return

    setBookmarkedArticleIds((current) => {
      const next = new Set(current)
      if (next.has(selectedArticle.id)) {
        next.delete(selectedArticle.id)
        showBottomToast({
          title: 'Removed from Saved',
          description: 'Story removed from your client bookmarks.',
        })
      } else {
        next.add(selectedArticle.id)
        showBottomToast({
          title: 'Bookmarked',
          description: 'Story added to your client bookmarks.',
        })
      }
      return next
    })
  }

  function toggleClientLike() {
    if (!selectedArticle) return

    setLikedArticleIds((current) => {
      const next = new Set(current)
      if (next.has(selectedArticle.id)) {
        next.delete(selectedArticle.id)
        showBottomToast({
          title: 'Removed from Liked',
          description: 'Story removed from your likes.',
        })
      } else {
        next.add(selectedArticle.id)
        showBottomToast({ title: 'Liked', description: 'Story added to your likes.' })
      }
      return next
    })
  }

  function reportClientArticle() {
    if (!selectedArticle) return

    setReportedArticleIds((current) => {
      const next = new Set(current)
      if (next.has(selectedArticle.id)) {
        next.delete(selectedArticle.id)
        showBottomToast({
          title: 'Report cleared',
          description: 'This story is no longer marked as reported.',
        })
      } else {
        next.add(selectedArticle.id)
        showBottomToast({ title: 'Reported', description: 'This story is marked as reported.' })
      }
      return next
    })
  }

  function setClientRailView(view: ClientRailView) {
    setClientProfilePanelOpen(false)
    setActiveClientRailView(view)

    if (view === 'latest') {
      setActiveClientCategory('all')
      setQuery('')
      return
    }

    if (view === 'bookmarks' || view === 'liked') {
      setActiveClientCategory(view)
      setQuery('')
      return
    }

    if (view === 'reported') {
      setActiveClientCategory('all')
      setQuery('')
      return
    }

    setActiveClientCategory('all')
  }

  async function shareClientArticle() {
    if (!selectedArticle?.url) return

    const shareData = {
      title: selectedArticle.title,
      text: selectedArticle.summary || selectedArticle.title,
      url: selectedArticle.url,
    }

    try {
      if (navigator.share) {
        await navigator.share(shareData)
        return
      }

      await navigator.clipboard.writeText(selectedArticle.url)
      showBottomToast({ title: 'Link copied', description: 'Article URL copied to clipboard.' })
    } catch {
      showBottomToast({
        title: 'Share failed',
        description: 'Unable to share this article.',
        variant: 'destructive',
      })
    }
  }

  function openSelectedArticleAi() {
    if (!selectedArticle) return
    window.open(articleAiUrl(selectedArticle, enrichedTickers, enrichedTopics, aiDestination), '_blank', 'noopener,noreferrer')
  }

  /** Tickers column: open Perplexity with full story context and ask for linked tickers. */
  function openLinkedTickersAi() {
    if (!selectedArticle) return
    window.open(
      linkedTickersPerplexityUrl(selectedArticle, enrichedTickers, enrichedTopics),
      '_blank',
      'noopener,noreferrer',
    )
  }

  /** Inline story editor form — lives inside the Story column only. */
  function renderStoryEditorForm() {
    if (!selectedArticle) return null

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <div className="text-sm font-semibold tracking-tight">Editing story</div>
          <Button disabled={saving} size="sm" type="button" variant="outline" onClick={cancelStoryEditor}>
            Cancel
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="story-edit-title">Title</Label>
          <Input
            id="story-edit-title"
            value={editForm.title}
            onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="story-edit-summary">Summary</Label>
          <Textarea
            id="story-edit-summary"
            className="min-h-28"
            value={editForm.summary}
            onChange={(event) => setEditForm((current) => ({ ...current, summary: event.target.value }))}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="story-edit-source">Source</Label>
            <Input
              id="story-edit-source"
              value={editForm.source}
              onChange={(event) => setEditForm((current) => ({ ...current, source: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="story-edit-author">Author</Label>
            <Input
              id="story-edit-author"
              value={editForm.author}
              onChange={(event) => setEditForm((current) => ({ ...current, author: event.target.value }))}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="story-edit-url">Article URL</Label>
            <Input
              id="story-edit-url"
              placeholder="https://…"
              value={editForm.url}
              onChange={(event) => setEditForm((current) => ({ ...current, url: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="story-edit-published">Published at</Label>
            <Input
              id="story-edit-published"
              placeholder="ISO datetime"
              value={editForm.publishedAt}
              onChange={(event) =>
                setEditForm((current) => ({ ...current, publishedAt: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="story-edit-sentiment">Story sentiment</Label>
            <Input
              id="story-edit-sentiment"
              placeholder="Bullish / Bearish / Neutral"
              value={editForm.sentimentLabel}
              onChange={(event) =>
                setEditForm((current) => ({ ...current, sentimentLabel: event.target.value }))
              }
            />
          </div>
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="story-edit-image">Image URL</Label>
            <a
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 p-1.5 text-foreground transition hover:bg-muted"
              href={googleImagesSearchUrl(editForm.title || selectedArticle.title || '')}
              rel="noreferrer"
              target="_blank"
              title="Search this headline on Google Images"
              aria-label="Search Google Images for alternate image"
            >
              <img
                alt=""
                className="size-3.5 shrink-0 rounded-sm"
                src="https://www.google.com/s2/favicons?domain=google.com&sz=32"
              />
              <ArrowUpRight className="size-3.5 shrink-0 opacity-80" />
            </a>
          </div>
          <Input
            id="story-edit-image"
            placeholder="https://… paste story image URL"
            value={editForm.imageUrl}
            onChange={(event) => setEditForm((current) => ({ ...current, imageUrl: event.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            Paste a direct image URL, then press the header Save icon.
          </p>
          {cleanArticleImageUrl(editForm.imageUrl) ? (
            <img
              alt="Story image preview"
              className="mt-1 aspect-video w-full max-h-48 rounded-md border object-cover"
              src={cleanArticleImageUrl(editForm.imageUrl)}
            />
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="story-edit-topics">Topics (comma-separated)</Label>
          <Input
            id="story-edit-topics"
            value={editForm.topics.join(', ')}
            onChange={(event) =>
              setEditForm((current) => ({
                ...current,
                topics: event.target.value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
              }))
            }
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <Label>Tickers</Label>
              <p className="text-xs text-muted-foreground">
                Or use the Tickers column for drag-reorder / quick edit.
              </p>
            </div>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() =>
                setEditForm((current) => ({
                  ...current,
                  tickers: [
                    ...current.tickers,
                    {
                      ticker: '',
                      exchange: '',
                      relevance: '',
                      sentimentScore: '',
                      sentimentLabel: '',
                      reason: '',
                    },
                  ],
                }))
              }
            >
              <Plus className="size-3.5" />
              Add ticker
            </Button>
          </div>
          {editForm.tickers.length ? (
            <div className="space-y-3">
              {editForm.tickers.map((ticker, index) => {
                function patchTicker(patch: Partial<EditTickerForm>) {
                  setEditForm((current) => ({
                    ...current,
                    tickers: current.tickers.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, ...patch } : item,
                    ),
                  }))
                }

                return (
                  <div
                    key={`inline-ticker-${index}`}
                    className="space-y-2 rounded-lg border bg-muted/20 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Ticker {index + 1}
                        {ticker.ticker ? ` · ${displayTicker(ticker.ticker)}` : ''}
                      </span>
                      <Button
                        aria-label={`Remove ticker ${index + 1}`}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setEditForm((current) => ({
                            ...current,
                            tickers: current.tickers.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                    <div className="grid gap-2">
                      <Input
                        placeholder="Symbol e.g. AAPL"
                        value={ticker.ticker}
                        onChange={(event) => patchTicker({ ticker: event.target.value })}
                      />
                      <Input
                        placeholder="Exchange"
                        value={ticker.exchange}
                        onChange={(event) => patchTicker({ exchange: event.target.value })}
                      />
                      <Input
                        placeholder="Sentiment"
                        value={ticker.sentimentLabel}
                        onChange={(event) => patchTicker({ sentimentLabel: event.target.value })}
                      />
                      <Input
                        placeholder="Score"
                        value={ticker.sentimentScore}
                        onChange={(event) => patchTicker({ sentimentScore: event.target.value })}
                      />
                      <Input
                        placeholder="Relevance"
                        value={ticker.relevance}
                        onChange={(event) => patchTicker({ relevance: event.target.value })}
                      />
                      <Textarea
                        className="min-h-16"
                        placeholder="Reason"
                        value={ticker.reason}
                        onChange={(event) => patchTicker({ reason: event.target.value })}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No tickers yet. Add one above.</p>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Use the header <span className="font-medium text-foreground">Save</span> icon to save (including image URL).
        </p>
      </div>
    )
  }

  shortcutActionsRef.current = {
    bookmark: toggleClientBookmark,
    like: toggleClientLike,
    save: () => {
      void saveStoryPrimary()
    },
    update: () => {
      void saveStoryPrimary()
    },
  }

  useEffect(() => {
    function moveSelection(direction: 1 | -1) {
      const { navigableArticles: articles, selectedId: currentSelectedId } = shortcutStateRef.current
      if (!articles.length) return

      const currentIndex = Math.max(
        0,
        articles.findIndex((article) => article.id === currentSelectedId),
      )
      const nextIndex = clamp(currentIndex + direction, 0, articles.length - 1)
      setSelectedId(articles[nextIndex]?.id ?? null)
    }

    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      const state = shortcutStateRef.current
      const actions = shortcutActionsRef.current

      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        if (state.clientMode) {
          actions.bookmark()
          return
        }

        // One save path for story (Database icon + Ctrl/Cmd+S).
        void actions.save()
        return
      }

      if (isTextEntryTarget(event.target)) return

      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault()
        moveSelection(1)
        return
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault()
        moveSelection(-1)
        return
      }

      if (state.clientMode && event.code === 'Space') {
        event.preventDefault()
        actions.bookmark()
        return
      }

      if (state.clientMode && key === 'l') {
        event.preventDefault()
        actions.like()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function emptyTickerForm(): EditTickerForm {
    return {
      ticker: '',
      exchange: '',
      relevance: '',
      sentimentScore: '',
      sentimentLabel: '',
      reason: '',
    }
  }

  /** Working ticker list for the Tickers column (prefers in-form / edited details). */
  function getWorkingTickerForms(): EditTickerForm[] {
    if (editForm.tickers.length) return editForm.tickers
    if (enrichedTickers.length) return enrichedTickers.map(tickerFormFromEnriched)
    if (selectedArticle?.tickers?.length) return selectedArticle.tickers.map(tickerFormFromSymbol)
    return []
  }

  async function persistTickerForms(
    nextTickers: EditTickerForm[],
    options?: { keepEditing?: boolean; silent?: boolean },
  ) {
    if (!selectedArticle) return

    const cleaned = nextTickers
      .map((item) => ({
        ...item,
        ticker: item.ticker.trim().toUpperCase(),
        exchange: item.exchange.trim().toUpperCase(),
        relevance: item.relevance.trim(),
        sentimentScore: item.sentimentScore.trim(),
        sentimentLabel: item.sentimentLabel.trim(),
        reason: item.reason.trim(),
      }))
      .filter((item) => item.ticker)

    setEditForm((current) => ({ ...current, tickers: cleaned }))

    const editorTickerDetails = cleaned.map((ticker) => ({
      ticker: normalizeTicker(ticker.ticker),
      exchange: ticker.exchange,
      relevance: ticker.relevance,
      sentiment_score: ticker.sentimentScore,
      sentiment_label: ticker.sentimentLabel,
      reason: ticker.reason,
    }))
    const symbols = editTickerSymbols(cleaned)
    const nextArticle: NewsArticle = {
      ...selectedArticle,
      tickers: symbols,
      raw: {
        ...rawRecord(selectedArticle.raw),
        editor_ticker_details: editorTickerDetails,
      },
    }

    setData((current) => {
      if (!current) return current
      return {
        ...current,
        articles: current.articles.map((item) => (item.id === selectedArticle.id ? nextArticle : item)),
      }
    })

    if (!options?.keepEditing) {
      setTickerEditingIndex(null)
      setTickerDraft(null)
    }

    const savedRowId = selectedArticle.savedRowId ?? selectedSavedMatch?.savedRowId
    if (!savedRowId) {
      if (!options?.silent) {
        showBottomToast({
          title: 'Tickers updated',
          description: 'Saved on this story locally. Use the header Save icon to keep them in Supabase.',
        })
      }
      return
    }

    setSaving(true)
    try {
      const response = await trackedFetch(`/api/articles/saved/${savedRowId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ article: nextArticle }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to update tickers.')
      if (body.article) {
        const previousSelectedId = selectedArticle.id
        preserveNewsListScroll(() => {
          setData((current) => {
            if (!current) return current
            return {
              ...current,
              articles: current.articles.map((item) =>
                item.id === previousSelectedId || item.savedRowId === savedRowId
                  ? {
                      ...item,
                      ...body.article,
                      id: item.id,
                      savedRowId: body.article.savedRowId ?? savedRowId,
                    }
                  : item,
              ),
            }
          })
          setSelectedId(previousSelectedId)
        })
      }
      if (!options?.silent) {
        showBottomToast({
          title: 'Tickers saved',
          description: 'Ticker changes saved to Supabase on this story.',
        })
      }
      await refreshSavedArticleIndex()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save tickers.'
      showBottomToast({ title: 'Ticker save failed', description: message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  function startTickerEdit(index: number) {
    const rows = getWorkingTickerForms()
    const row = rows[index]
    if (!row) return
    setTickerEditingIndex(index)
    setTickerDraft({ ...row })
  }

  function startAddTicker() {
    if (!selectedArticle) return
    const rows = getWorkingTickerForms()
    const nextIndex = rows.length
    setEditForm((current) => ({
      ...current,
      tickers: current.tickers.length
        ? [...current.tickers, emptyTickerForm()]
        : [...rows, emptyTickerForm()],
    }))
    setTickerEditingIndex(nextIndex)
    setTickerDraft(emptyTickerForm())
    showBottomToast({
      title: 'Add ticker',
      description: 'Enter the symbol (and optional sentiment/reason), then Save on the row.',
    })
  }

  function cancelTickerEdit() {
    // If we were adding a blank row, drop empty trailing placeholders.
    if (tickerEditingIndex != null) {
      const rows = getWorkingTickerForms()
      const row = rows[tickerEditingIndex]
      if (row && !row.ticker.trim()) {
        const next = rows.filter((_, i) => i !== tickerEditingIndex)
        setEditForm((current) => ({ ...current, tickers: next }))
      }
    }
    setTickerEditingIndex(null)
    setTickerDraft(null)
  }

  async function saveTickerEdit() {
    if (tickerEditingIndex == null || !tickerDraft) return
    if (!tickerDraft.ticker.trim()) {
      showBottomToast({
        title: 'Ticker required',
        description: 'Enter a ticker symbol before saving.',
        variant: 'destructive',
      })
      return
    }
    const rows = getWorkingTickerForms()
    const next = rows.map((row, i) => (i === tickerEditingIndex ? { ...tickerDraft } : row))
    // If index is beyond (add race), append
    if (tickerEditingIndex >= rows.length) next.push({ ...tickerDraft })
    await persistTickerForms(next)
  }

  async function deleteTickerAt(index: number) {
    if (!selectedArticle) return
    const rows = getWorkingTickerForms()
    const row = rows[index]
    if (!row) return

    const snapshot = { ...row }
    const next = rows.filter((_, i) => i !== index)
    if (tickerEditingIndex === index) {
      setTickerEditingIndex(null)
      setTickerDraft(null)
    } else if (tickerEditingIndex != null && tickerEditingIndex > index) {
      setTickerEditingIndex(tickerEditingIndex - 1)
    }

    // No confirm — delete immediately; Undo restores for a short window.
    setTickerDeleteUndo({
      articleId: selectedArticle.id,
      index,
      ticker: snapshot,
    })
    if (tickerDeleteUndoTimerRef.current != null) {
      window.clearTimeout(tickerDeleteUndoTimerRef.current)
    }
    tickerDeleteUndoTimerRef.current = window.setTimeout(() => {
      setTickerDeleteUndo(null)
      tickerDeleteUndoTimerRef.current = null
    }, 8000)

    const label = displayTicker(snapshot.ticker) || 'Ticker'
    // Silent persist so the toast below is the only message (with Undo).
    await persistTickerForms(next, { silent: true })
    showBottomToast({
      title: 'Ticker deleted',
      description: `${label} removed from this story.`,
      action: {
        label: 'Undo',
        onClick: () => {
          void undoDeleteTicker()
        },
      },
    })
  }

  async function undoDeleteTicker() {
    if (!tickerDeleteUndo || !selectedArticle) return
    if (tickerDeleteUndo.articleId !== selectedArticle.id) {
      setTickerDeleteUndo(null)
      return
    }

    const rows = getWorkingTickerForms()
    const insertAt = Math.min(Math.max(tickerDeleteUndo.index, 0), rows.length)
    const next = [
      ...rows.slice(0, insertAt),
      { ...tickerDeleteUndo.ticker },
      ...rows.slice(insertAt),
    ]

    if (tickerDeleteUndoTimerRef.current != null) {
      window.clearTimeout(tickerDeleteUndoTimerRef.current)
      tickerDeleteUndoTimerRef.current = null
    }
    const label = displayTicker(tickerDeleteUndo.ticker.ticker) || 'Ticker'
    setTickerDeleteUndo(null)
    await persistTickerForms(next, { silent: true })
    showBottomToast({
      title: 'Ticker restored',
      description: `${label} is back on this story.`,
    })
  }

  async function reorderTickers(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const rows = getWorkingTickerForms()
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= rows.length || toIndex >= rows.length) return
    const next = [...rows]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)

    // Keep inline editor attached to the same ticker after reorder.
    if (tickerEditingIndex != null) {
      if (tickerEditingIndex === fromIndex) setTickerEditingIndex(toIndex)
      else if (fromIndex < tickerEditingIndex && toIndex >= tickerEditingIndex) {
        setTickerEditingIndex(tickerEditingIndex - 1)
      } else if (fromIndex > tickerEditingIndex && toIndex <= tickerEditingIndex) {
        setTickerEditingIndex(tickerEditingIndex + 1)
      }
    }

    await persistTickerForms(next, {
      keepEditing: tickerEditingIndex != null,
      silent: true,
    })
    const label = displayTicker(moved?.ticker) || 'Ticker'
    const inSupabase = Boolean(selectedArticle?.savedRowId || selectedSavedMatch?.savedRowId)
    showBottomToast({
      title: 'Tickers reordered',
      description: `${label} moved. Order is saved ${inSupabase ? 'to Supabase' : 'locally'}.`,
    })
  }

  function renderTickerCards({ compact = false }: { compact?: boolean } = {}) {
    const rows = getWorkingTickerForms()
    // While adding, ensure draft row is visible even if not yet in editForm.
    const displayRows =
      tickerEditingIndex != null && tickerEditingIndex >= rows.length && tickerDraft
        ? [...rows, tickerDraft]
        : rows

    return (
      <div className={cn('divide-y divide-border', !compact && 'md:grid md:grid-cols-2 md:divide-x md:divide-y-0')}>
        {displayRows.length ? (
          displayRows.map((ticker, index) => {
            const metadata = tickerMetadata(ticker.ticker)
            const marketTicker = resolveMarketTicker(ticker.ticker)
            const symbol = displayTicker(ticker.ticker)
            const savedInSupabase = Boolean(yahooSavedByTicker[symbol])
            const isActiveTicker =
              Boolean(symbol) &&
              activeMarketTicker !== 'all' &&
              displayTicker(activeMarketTicker) === displayTicker(marketTicker)
            const isEditing = tickerEditingIndex === index
            const canDrag = Boolean(selectedArticle) && !isEditing && !saving && Boolean(symbol)
            const isDragOver = tickerDragOverIndex === index && tickerDragIndex !== index

            return (
              <div
                key={`${ticker.ticker || 'new'}-${index}`}
                draggable={canDrag}
                onDragStart={(event) => {
                  if (!canDrag) return
                  setTickerDragIndex(index)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', String(index))
                }}
                onDragEnd={() => {
                  setTickerDragIndex(null)
                  setTickerDragOverIndex(null)
                }}
                onDragOver={(event) => {
                  if (tickerDragIndex == null || isEditing) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  if (tickerDragOverIndex !== index) setTickerDragOverIndex(index)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const from =
                    tickerDragIndex ??
                    Number(event.dataTransfer.getData('text/plain'))
                  setTickerDragIndex(null)
                  setTickerDragOverIndex(null)
                  if (!Number.isFinite(from)) return
                  void reorderTickers(from, index)
                }}
                className={cn(
                  'relative px-3 py-4 transition',
                  !isEditing && 'cursor-pointer hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActiveTicker && !showNormalizedJson && !isEditing && 'bg-muted/60',
                  isEditing && 'bg-muted/25',
                  tickerDragIndex === index && 'opacity-50',
                  isDragOver && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
                )}
                role={isEditing ? undefined : 'button'}
                tabIndex={isEditing ? undefined : 0}
                onClick={() => {
                  if (isEditing || !symbol) return
                  setActiveMarketTicker(marketTicker)
                  setShowNormalizedJson(false)
                }}
                onKeyDown={(event) => {
                  if (isEditing) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    if (!symbol) return
                    setActiveMarketTicker(marketTicker)
                    setShowNormalizedJson(false)
                  }
                }}
              >
                {isEditing && tickerDraft ? (
                  <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {symbol ? `Edit ${symbol}` : 'New ticker'}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Symbol</Label>
                        <Input
                          autoFocus
                          placeholder="AAPL"
                          value={tickerDraft.ticker}
                          onChange={(event) =>
                            setTickerDraft((current) =>
                              current ? { ...current, ticker: event.target.value } : current,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Exchange</Label>
                        <Input
                          placeholder="NASDAQ"
                          value={tickerDraft.exchange}
                          onChange={(event) =>
                            setTickerDraft((current) =>
                              current ? { ...current, exchange: event.target.value } : current,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Sentiment</Label>
                        <Input
                          placeholder="Bullish / Bearish / Neutral"
                          value={tickerDraft.sentimentLabel}
                          onChange={(event) =>
                            setTickerDraft((current) =>
                              current ? { ...current, sentimentLabel: event.target.value } : current,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Score</Label>
                        <Input
                          placeholder="0.72"
                          value={tickerDraft.sentimentScore}
                          onChange={(event) =>
                            setTickerDraft((current) =>
                              current ? { ...current, sentimentScore: event.target.value } : current,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs">Relevance</Label>
                        <Input
                          placeholder="How related is this ticker?"
                          value={tickerDraft.relevance}
                          onChange={(event) =>
                            setTickerDraft((current) =>
                              current ? { ...current, relevance: event.target.value } : current,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs">Reason</Label>
                        <Textarea
                          className="min-h-16"
                          placeholder="Why this ticker is linked"
                          value={tickerDraft.reason}
                          onChange={(event) =>
                            setTickerDraft((current) =>
                              current ? { ...current, reason: event.target.value } : current,
                            )
                          }
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button disabled={saving} size="sm" type="button" onClick={() => void saveTickerEdit()}>
                        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                        Save
                      </Button>
                      <Button disabled={saving} size="sm" type="button" variant="outline" onClick={cancelTickerEdit}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex min-w-0 items-center gap-2">
                      {canDrag ? (
                        <button
                          type="button"
                          className="inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                          title="Drag to reorder"
                          aria-label={`Drag to reorder ${symbol}`}
                          onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <GripVertical className="size-4" />
                        </button>
                      ) : null}
                      {symbol ? (
                        <YahooLiveTickerWithLink
                          className="min-w-0"
                          savedInSupabase={savedInSupabase}
                          ticker={ticker.ticker}
                        />
                      ) : (
                        <span className="text-sm font-medium text-muted-foreground">Untitled ticker</span>
                      )}
                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        {ticker.sentimentLabel ? (
                          <SentimentCornerBadge label={ticker.sentimentLabel} />
                        ) : null}
                        {metadata?.type ? (
                          <Badge
                            className="h-6 shrink-0 items-center rounded-full border-transparent bg-zinc-800 px-2.5 text-[11px] font-medium leading-none text-zinc-200"
                            variant="outline"
                          >
                            {metadata.type}
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    {metadata?.name ? (
                      <div className="mt-2 truncate text-sm font-medium text-foreground">{metadata.name}</div>
                    ) : null}

                    <p className="mt-2 line-clamp-3 w-full text-sm leading-5 text-muted-foreground">
                      {ticker.reason || 'No ticker reason supplied.'}
                    </p>

                    {(ticker.sentimentScore || ticker.relevance) ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ticker.sentimentScore ? (
                          <Badge className="h-6 rounded-md px-2 text-[11px]" variant="secondary">
                            Score {ticker.sentimentScore}
                          </Badge>
                        ) : null}
                        {ticker.relevance ? (
                          <Badge className="h-6 rounded-md px-2 text-[11px]" variant="secondary">
                            Rel {ticker.relevance}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-2 min-w-0 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Intelligence by {selectedArticle?.providerLabel || 'provider'}
                    </div>

                    {/* Per-card actions under the ticker card */}
                    <div
                      className="mt-3 flex flex-wrap items-center gap-2"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Button
                        disabled={!selectedArticle || saving}
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => startTickerEdit(index)}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                      <Button
                        disabled={!selectedArticle || saving}
                        size="sm"
                        type="button"
                        variant="destructive"
                        onClick={() => void deleteTickerAt(index)}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )
          })
        ) : (
          <div className="space-y-3 px-3 py-4">
            <p className="text-sm text-muted-foreground">No tickers linked to this story.</p>
            {selectedArticle ? (
              <Button size="sm" type="button" variant="outline" onClick={startAddTicker}>
                <Plus className="size-3.5" />
                Add ticker
              </Button>
            ) : null}
          </div>
        )}

        {/* Undo bar after a ticker delete (no confirm dialog) */}
        {tickerDeleteUndo && selectedArticle?.id === tickerDeleteUndo.articleId ? (
          <div className="sticky bottom-0 border-t bg-background/95 px-3 py-2 backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                Removed{' '}
                <span className="font-medium text-foreground">
                  {displayTicker(tickerDeleteUndo.ticker.ticker) || 'ticker'}
                </span>
              </p>
              <Button
                disabled={saving}
                size="sm"
                type="button"
                variant="secondary"
                onClick={() => void undoDeleteTicker()}
              >
                <Undo2 className="size-3.5" />
                Undo
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  function renderApiDebugPanel() {
    const pendingCount = apiCallLogs.filter((item) => item.status === 'pending').length
    const errorCount = apiCallLogs.filter((item) => item.status === 'error').length

    return (
      <Card className="min-h-[520px] overflow-hidden xl:h-full xl:w-[380px] xl:flex-none">
        <CardHeader className="gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-lg">API Calls</CardTitle>
              <CardDescription>
                {apiCallLogs.length} total · {pendingCount} pending · {errorCount} errors
              </CardDescription>
            </div>
            <Button
              disabled={!apiCallLogs.length}
              onClick={() => setApiCallLogs([])}
              size="sm"
              type="button"
              variant="outline"
            >
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 p-0">
          <ScrollArea className="min-h-[430px] xl:h-full">
            <div className="space-y-3 p-4 pt-0">
              {apiCallLogs.length ? (
                apiCallLogs.map((call) => (
                  <div key={call.id} className="rounded-md border bg-muted/10 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            className={cn(
                              call.status === 'success' && 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                              call.status === 'error' && 'border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300',
                            )}
                            variant="outline"
                          >
                            {call.status}
                          </Badge>
                          <Badge variant="secondary">{call.method}</Badge>
                          {call.httpStatus ? <Badge variant="outline">{call.httpStatus}</Badge> : null}
                        </div>
                        <div className="mt-2 break-all font-mono text-xs leading-4 text-foreground">
                          {apiUrlLabel(call.url)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-xs text-muted-foreground">
                        <div>{new Date(call.startedAt).toLocaleTimeString()}</div>
                        {typeof call.durationMs === 'number' ? <div>{call.durationMs} ms</div> : null}
                      </div>
                    </div>

                    {call.requestBodyPreview ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Request</summary>
                        <pre className="mt-2 max-h-44 overflow-auto rounded-md bg-background p-2 text-xs leading-4 text-muted-foreground">
                          {call.requestBodyPreview}
                        </pre>
                      </details>
                    ) : null}

                    {call.responsePreview ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Response</summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-background p-2 text-xs leading-4 text-muted-foreground">
                          {call.responsePreview}
                        </pre>
                      </details>
                    ) : null}

                    {call.error ? (
                      <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-300">
                        {call.error}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-md border p-4 text-base text-muted-foreground">
                  No API calls yet.
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    )
  }

  /** White, minimal single-request transparency panel for the main Polygon refresh. */
  function renderFetchActivityTerminal() {
    const trace = polygonFetchTrace
    const isLive = Boolean(loading && (loadingStatus || trace?.status === 'pending'))
    const isError = Boolean(error || trace?.status === 'error')

    if (!trace && !isLive && !isError) return null

    const startedLabel = trace?.startedAt
      ? new Date(trace.startedAt).toLocaleTimeString()
      : new Date().toLocaleTimeString()

    return (
      <div className="w-full shrink-0 rounded-xl border border-border bg-white text-zinc-900 shadow-sm dark:border-border dark:bg-card dark:text-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">Polygon fetch</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              One request · exact URL · timing · response
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium',
                isLive && 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
                !isLive && isError && 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
                !isLive && !isError && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
              )}
            >
              {isLive ? 'Loading' : isError ? 'Error' : 'Done'}
            </span>
            {isError ? (
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => {
                  setError('')
                  void fetchNews('polygon')
                }}
              >
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
            ) : null}
            {!isLive ? (
              <Button
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => {
                  setError('')
                  setLoadingStatus('')
                  setPolygonFetchTrace(null)
                }}
              >
                <X className="size-3.5" />
                Dismiss
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            {isLive ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
            <p className={cn('min-w-0 leading-snug text-foreground', isLive && 'animate-pulse')}>
              {isLive
                ? loadingStatus || 'Fetching Polygon news…'
                : isError
                  ? error || trace?.error || 'Request failed'
                  : `Loaded ${trace?.articleCount ?? 0} articles`}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Started</div>
              <div className="mt-0.5 font-mono text-xs tabular-nums">{startedLabel}</div>
            </div>
            <div className="rounded-lg border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Duration</div>
              <div className="mt-0.5 font-mono text-xs tabular-nums">
                {typeof trace?.durationMs === 'number' ? `${trace.durationMs} ms` : isLive ? '…' : '—'}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">HTTP</div>
              <div className="mt-0.5 font-mono text-xs tabular-nums">
                {trace?.httpStatus != null ? trace.httpStatus : isLive ? '…' : isError ? 'error' : '—'}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              App request (1 call)
            </div>
            <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-[12px] leading-5 text-foreground">
              {`${trace?.method || 'GET'} ${trace?.proxyUrl || '…'}`}
              {`\nquery: ${trace?.query ? JSON.stringify(trace.query) : '(empty — latest Polygon news)'}`}
              {`\nlimit: ${trace?.limit ?? POLYGON_FETCH_LIMIT}`}
            </pre>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Upstream Polygon URL
              {trace?.upstreamMode ? ` · ${trace.upstreamMode}` : ''}
            </div>
            {trace?.upstreamUrls?.length ? (
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/30 p-3 font-mono text-[12px] leading-5 text-foreground">
                {trace.upstreamUrls.join('\n')}
              </pre>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {isLive
                  ? 'Waiting for server response (upstream URL comes back with the JSON)…'
                  : 'No upstream URL returned.'}
              </div>
            )}
          </div>

          {trace?.responsePreview ? (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Response preview
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/30 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                {trace.responsePreview}
              </pre>
            </div>
          ) : null}

          {trace?.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {trace.error}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  function renderLinkedMarketNews() {
    const linkedStoryNewsCurrent = linkedStoryNewsStoryKey === linkedStoryRequestKey
    const visibleNews = linkedStoryNewsCurrent ? sortNewsByLatest(linkedStoryNews) : []
    const currentLinkedStoryNewsLoading = Boolean(linkedStoryRequestKey) && (!linkedStoryNewsCurrent || linkedStoryNewsLoading)
    const currentLinkedStoryNewsError = linkedStoryNewsCurrent ? linkedStoryNewsError : ''

    return (
      <section className="space-y-3">
        <Separator className="mt-2" />
        
        <CardTitle className="text-lg" style={{marginTop:20, marginBottom:20}}>Linked News</CardTitle>
        {currentLinkedStoryNewsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : currentLinkedStoryNewsError ? (
          <div className="text-base text-muted-foreground">{currentLinkedStoryNewsError}</div>
        ) : visibleNews.length ? (
          <div className="space-y-3">
            {visibleNews.map((article) => (
              <button
                key={article.id}
                className="flex w-full gap-3 rounded-md p-1 text-left text-card-foreground transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                type="button"
                onClick={() => setSelectedId(article.id)}
              >
                {cleanArticleImageUrl(article.imageUrl) ? (
                  <img
                    alt=""
                    className="size-10 shrink-0 rounded-full object-cover"
                    loading="lazy"
                    src={cleanArticleImageUrl(article.imageUrl)}
                  />
                ) : (
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                    {displayTicker(article.tickers[0] || activeMarketTickerValue || article.source || 'NEWS').slice(0, 3)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-base font-medium leading-5 tracking-normal">{article.title}</div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-none text-muted-foreground">
                    <ArticleTimestamp layout="inline" value={article.publishedAt} />
                    <span aria-hidden="true" className="text-muted-foreground/40">
                      ·
                    </span>
                    <span className="min-w-0 truncate font-medium">{article.source || article.providerLabel || 'Platform'}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-base text-muted-foreground">No linked market news yet.</div>
        )}
      </section>
    )
  }

  function renderMarketPanel({
    className,
  }: {
    className?: string
    scrollClassName?: string
  } = {}) {
    const marketXUrl = xSearchUrl(socialQueryForTickers(marketTradingViewTickers))

    function openMarketTradingView() {
      marketTradingViewTickers.forEach((ticker) => {
        window.open(stockOpenUrl(ticker, stockOpenDestination), '_blank', 'noopener,noreferrer')
      })
    }

    const selectedSymbol = showingAllMarketTickers
      ? ''
      : displayTicker(activeMarketTickerValue || '')

    return (
      <Card className={cn('min-h-[520px] overflow-hidden border-0 bg-transparent shadow-none xl:h-full', className)}>
        <CardHeader className="gap-2 px-3 pt-0 sm:px-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg">Market</CardTitle>
            <div className="flex items-center gap-1">
              <Button
                aria-label={
                  showingAllMarketTickers
                    ? `Open all linked tickers in ${destinationLabel(stockOpenDestinations, stockOpenDestination)}`
                    : `Open ${selectedSymbol} in ${destinationLabel(stockOpenDestinations, stockOpenDestination)}`
                }
                disabled={!marketTradingViewTickers.length}
                onClick={openMarketTradingView}
                size="sm"
                title={
                  showingAllMarketTickers
                    ? `Open all linked tickers in ${destinationLabel(stockOpenDestinations, stockOpenDestination)}`
                    : `Open ${selectedSymbol} in ${destinationLabel(stockOpenDestinations, stockOpenDestination)}`
                }
                type="button"
                variant="outline"
              >
                <img
                  alt=""
                  className="size-4 rounded-sm"
                  src={`https://www.google.com/s2/favicons?domain=${stockOpenDestination === 'yahoo-finance' ? 'finance.yahoo.com' : 'tradingview.com'}&sz=32`}
                />
                {destinationLabel(stockOpenDestinations, stockOpenDestination)}
              </Button>
              <Button asChild disabled={!marketTradingViewTickers.length} size="sm" type="button" variant="outline">
                <a
                  aria-label="Open related X search"
                  href={marketXUrl}
                  rel="noreferrer"
                  target="_blank"
                  title="Open related X search"
                >
                  <img
                    alt=""
                    className="size-4 rounded-sm"
                    src="https://www.google.com/s2/favicons?domain=x.com&sz=32"
                  />
                  X
                </a>
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button
              className={cn(
                'h-7 bg-transparent px-2 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground',
                activeMarketTicker === 'all' && 'font-semibold text-foreground',
              )}
              disabled={marketTickers.length < 2}
              onClick={() => {
                setActiveMarketTicker('all')
                showBottomToast({
                  title: 'Market filter',
                  description: 'Showing all story tickers in the market column.',
                })
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              All
            </Button>
            {marketTickers.map((ticker) => (
              <Button
                key={ticker}
                className={cn(
                  'h-7 bg-transparent px-2 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground',
                  activeMarketTicker === ticker && 'font-semibold text-foreground',
                )}
                onClick={() => {
                  setActiveMarketTicker(ticker)
                  showBottomToast({
                    title: 'Market filter',
                    description: `Focused market column on ${displayTicker(ticker)}.`,
                  })
                }}
                size="sm"
                title={
                  tickerMetadata(ticker)
                    ? `${tickerMetadata(ticker)?.name} · ${tickerMetadata(ticker)?.type}`
                    : displayTicker(ticker)
                }
                type="button"
                variant="ghost"
              >
                {displayTicker(ticker)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {loading ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 pb-4 pt-1">
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-7 w-14 rounded-md" />
                ))}
              </div>
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-[280px] w-full rounded-lg" />
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="space-y-2 rounded-lg border p-3">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                ))}
              </div>
            </div>
          ) : !marketTickers.length ? (
            <div className="p-4 text-base text-muted-foreground">This article has no tickers.</div>
          ) : showingAllMarketTickers ? (
            <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4">
              <p className="text-sm text-muted-foreground">
                Select a ticker for the full Yahoo Finance database dashboard.
              </p>
              <TradingViewComparisonChart
                compareTickers={marketTickers}
                height={480}
                theme={theme}
                ticker={marketTickers[0] || activeMarketTickerValue || nasdaqCompositeTicker}
              />
            </div>
          ) : selectedSymbol ? (
            <YahooTickerDashboard
              key={selectedSymbol}
              className="min-h-0 flex-1"
              embedded
              onSavedChange={markYahooTickerSaved}
              preferSaved
              symbol={selectedSymbol}
            />
          ) : null}
        </CardContent>
      </Card>
    )
  }

  function renderClientArticleCard(article: NewsArticle) {
    const isSelected = selectedArticle?.id === article.id
    return (
      <div
        key={articleDedupeKey(article)}
        data-article-id={article.id}
        role="button"
        tabIndex={0}
        className={cn(
          'w-full cursor-pointer rounded-lg border border-neutral-300 bg-transparent p-3 text-left text-card-foreground transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-neutral-700',
          isSelected && 'border-primary bg-primary/5',
        )}
        onClick={() => setSelectedId(article.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setSelectedId(article.id)
          }
        }}
      >
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 text-base font-medium tracking-normal">{article.title}</h2>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{article.summary || article.source}</p>
          </div>
          {cleanArticleImageUrl(article.imageUrl) ? (
            <img
              alt=""
              className="size-16 rounded-md border object-cover"
              loading="lazy"
              src={cleanArticleImageUrl(article.imageUrl)}
            />
          ) : null}
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-wrap gap-1">
            {article.tickers.slice(0, 4).map((ticker) => {
              const symbol = displayTicker(ticker)
              const savedInSupabase = Boolean(yahooSavedByTicker[symbol])
              return (
                <span key={ticker} className="inline-flex items-center gap-1">
                  <TickerLinkBadge savedInSupabase={savedInSupabase} ticker={ticker} />
                  <TickerDashboardLinkButton savedInSupabase={savedInSupabase} ticker={ticker} />
                </span>
              )
            })}
          </div>
          <ArticleTimestamp value={article.publishedAt} />
        </div>
      </div>
    )
  }

  function renderProfileCard() {
    const displayName = String(authUser?.user_metadata?.full_name ?? '')
    const avatarUrl = String(authUser?.user_metadata?.avatar_url ?? '')
    const initials = (displayName || authUser?.email || 'G').slice(0, 2).toUpperCase()

    if (authInitializing) {
      return (
        <div className="rounded-lg border bg-muted/15 p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </div>
      )
    }

    if (authUser && profileEditOpen) {
      const hasExistingName = Boolean(authUser.user_metadata?.full_name)
      return (
        <div className="rounded-lg border bg-muted/15 p-4">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              {profileAvatarDraft ? (
                <img alt="" className="size-16 rounded-full border object-cover" src={profileAvatarDraft} />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-full border bg-background text-xl font-semibold text-muted-foreground">
                  {initials}
                </div>
              )}
              <label
                className="absolute -bottom-1 -right-1 flex size-6 cursor-pointer items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground"
                title="Add profile photo"
              >
                <Camera className="size-3.5" />
                <input accept="image/*" className="hidden" onChange={(event) => void handleProfilePhotoChange(event)} type="file" />
              </label>
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label className="text-base" htmlFor="profile-name-input">Your name</Label>
              <Input
                id="profile-name-input"
                onChange={(event) => setProfileNameDraft(event.target.value)}
                placeholder="Add your name"
                value={profileNameDraft}
              />
            </div>
          </div>
          {profileError ? <div className="mt-3 text-sm text-destructive">{profileError}</div> : null}
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" disabled={profileSaving} onClick={() => void saveProfile()} type="button">
              {profileSaving ? <Loader2 className="animate-spin" /> : <Save />}
              Save profile
            </Button>
            {hasExistingName ? (
              <Button onClick={() => setProfileEditOpen(false)} type="button" variant="outline">
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      )
    }

    if (authUser) {
      return (
        <div className="rounded-lg border bg-muted/15 p-4">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <img alt="" className="size-16 shrink-0 rounded-full border object-cover" src={avatarUrl} />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-full border bg-background text-xl font-semibold text-muted-foreground">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{displayName || 'Signed in'}</div>
              <div className="truncate text-sm text-muted-foreground">{authUser.email}</div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button className="flex-1 justify-start" onClick={startProfileEdit} type="button" variant="outline">
              <Pencil />
              Edit profile
            </Button>
            <Button onClick={() => void signOutUser()} title="Sign out" type="button" variant="outline">
              <LogOut />
            </Button>
          </div>
        </div>
      )
    }

    if (authStage === 'enter-email') {
      return (
        <div className="rounded-lg border bg-muted/15 p-4">
          <div className="text-base font-semibold">Sign in</div>
          <div className="mt-1 text-sm text-muted-foreground">We&apos;ll email you a 6-digit code, no password needed.</div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-base" htmlFor="auth-email-input">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-8"
                id="auth-email-input"
                onChange={(event) => setAuthEmail(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void sendAuthOtp()}
                placeholder="you@example.com"
                type="email"
                value={authEmail}
              />
            </div>
          </div>
          {authError ? <div className="mt-2 text-sm text-destructive">{authError}</div> : null}
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" disabled={authLoading} onClick={() => void sendAuthOtp()} type="button">
              {authLoading ? <Loader2 className="animate-spin" /> : <Mail />}
              Send code
            </Button>
            <Button disabled={authLoading} onClick={cancelSignIn} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </div>
      )
    }

    if (authStage === 'enter-otp') {
      return (
        <div className="rounded-lg border bg-muted/15 p-4">
          <div className="text-base font-semibold">Enter your code</div>
          {authNotice ? <div className="mt-1 text-sm text-muted-foreground">{authNotice}</div> : null}
          <div className="mt-3 space-y-1.5">
            <Label className="text-base" htmlFor="auth-otp-input">6-digit code</Label>
            <Input
              autoFocus
              id="auth-otp-input"
              inputMode="numeric"
              onChange={(event) => setAuthOtp(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void confirmAuthOtp()}
              placeholder="123456"
              value={authOtp}
            />
          </div>
          {authError ? <div className="mt-2 text-sm text-destructive">{authError}</div> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="flex-1" disabled={authLoading} onClick={() => void confirmAuthOtp()} type="button">
              {authLoading ? <Loader2 className="animate-spin" /> : <Check />}
              Confirm
            </Button>
            <Button disabled={authLoading} onClick={() => void sendAuthOtp()} type="button" variant="outline">
              Resend
            </Button>
            <Button disabled={authLoading} onClick={cancelSignIn} type="button" variant="ghost">
              Use a different email
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div className="rounded-lg border bg-muted/15 p-4">
        <div className="flex items-center gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
            <User className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold">Guest profile</div>
            <div className="text-sm text-muted-foreground">Not signed in</div>
          </div>
        </div>
        <Button className="mt-4 w-full justify-center" onClick={startSignIn} type="button">
          <LogIn />
          Sign in
        </Button>
        {!supabaseAuthConfigured ? (
          <div className="mt-2 text-xs text-muted-foreground">Sign-in needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY configured.</div>
        ) : null}
      </div>
    )
  }

  function renderClientSettingsScreen() {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        onClick={(event) => { if (event.target === event.currentTarget) setClientProfilePanelOpen(false) }}
      >
        <Card className="max-h-[90vh] w-full max-w-4xl overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg">Settings</CardTitle>
                <CardDescription>Profile, display, destinations, and dashboard controls.</CardDescription>
              </div>
              <Button
                aria-label="Close settings"
                onClick={() => setClientProfilePanelOpen(false)}
                size="icon-sm"
                title="Close settings"
                type="button"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="max-h-[calc(90vh-73px)] overflow-y-auto p-0">
            <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
              <section className="space-y-4">
                {renderProfileCard()}

                <div className="rounded-lg border p-4">
                  <div className="text-sm font-medium uppercase text-muted-foreground">Workspace</div>
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label htmlFor="client-settings-mode-toggle" className="text-base">Client mode</Label>
                        <div className="text-sm text-muted-foreground">Show saved Supabase articles.</div>
                      </div>
                      <Switch
                        id="client-settings-mode-toggle"
                        checked={clientMode}
                        onCheckedChange={setClientModeRoute}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label htmlFor="client-settings-api-debug-toggle" className="text-base">API debug column</Label>
                        <div className="text-sm text-muted-foreground">Show recent request logs.</div>
                      </div>
                      <Switch
                        id="client-settings-api-debug-toggle"
                        checked={apiDebugPanelOpen}
                        onCheckedChange={setApiDebugPanelOpen}
                      />
                    </div>
                    <div className="grid gap-2 pt-1">
                      <Button
                        className="justify-start"
                        onClick={() => {
                          setClientProfilePanelOpen(false)
                          void fetchSavedArticles()
                        }}
                        type="button"
                        variant="outline"
                      >
                        <Database />
                        Open Supabase articles
                      </Button>
                      <Button
                        className="justify-start"
                        onClick={() => {
                          setClientProfilePanelOpen(false)
                          navigate('/dashboard/database')
                        }}
                        type="button"
                        variant="outline"
                      >
                        <Database />
                        Database
                      </Button>
                      {!clientMode ? (
                        <Button
                          className="justify-start"
                          disabled={loading}
                          onClick={() => {
                            setClientProfilePanelOpen(false)
                            void fetchNews('polygon')
                          }}
                          type="button"
                          variant="outline"
                        >
                          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                          Fetch Polygon (100)
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-5">
                <div className="rounded-lg border p-4">
                  <div className="text-sm font-medium uppercase text-muted-foreground">Appearance</div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor="client-settings-theme-toggle" className="text-base">Dark theme</Label>
                      <div className="text-sm text-muted-foreground">Use the darker client interface.</div>
                    </div>
                    <Switch
                      id="client-settings-theme-toggle"
                      checked={theme === 'dark'}
                      onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                    />
                  </div>
                </div>

            <div className="rounded-lg border p-4">
              <div className="text-sm font-medium uppercase text-muted-foreground">AI opens in</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {aiDestinations.map((destination) => (
                      <Button
                        key={destination.id}
                        className="justify-between"
                        onClick={() => setAiDestination(destination.id)}
                        size="sm"
                        type="button"
                        variant={aiDestination === destination.id ? 'secondary' : 'outline'}
                      >
                        <span>{destination.label}</span>
                        {aiDestination === destination.id ? <Check className="size-4" /> : null}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="text-sm font-medium uppercase text-muted-foreground">Stocks open in</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {stockOpenDestinations.map((destination) => (
                      <Button
                        key={destination.id}
                        className="justify-between"
                        onClick={() => setStockOpenDestination(destination.id)}
                        size="sm"
                        type="button"
                        variant={stockOpenDestination === destination.id ? 'secondary' : 'outline'}
                      >
                        <span>{destination.label}</span>
                        {stockOpenDestination === destination.id ? <Check className="size-4" /> : null}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="text-sm font-medium uppercase text-muted-foreground">Support & legal</div>
                  <div className="mt-3 grid gap-2">
                    <Button
                      className="justify-start"
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setClientProfilePanelOpen(false)
                        navigate('/support')
                      }}
                    >
                      Support
                    </Button>
                    <Button
                      className="justify-start"
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setClientProfilePanelOpen(false)
                        navigate('/privacy')
                      }}
                    >
                      Privacy Policy
                    </Button>
                    <Button
                      className="justify-start"
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setClientProfilePanelOpen(false)
                        navigate('/terms')
                      }}
                    >
                      Terms of Use
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          </CardContent>
          <div className="border-t px-4 py-2 text-center text-sm text-muted-foreground sm:px-6">
            9AM · ↑/↓ or ←/→ move news
          </div>
        </Card>
      </div>
    )
  }

  // Shared client-style shell for both `/` and `/dashboard`.
  // Bottom toast is rendered globally by <BottomToastProvider> in main.tsx.
  return (
      <main className="flex min-h-svh flex-col overflow-x-hidden bg-background text-foreground xl:h-svh xl:overflow-hidden">
        <header className="sticky top-0 z-20 shrink-0 border-b bg-background/95 backdrop-blur">
          <div className="flex w-full flex-col gap-3 px-4 py-3 sm:px-6">
            <div className="grid gap-3 xl:grid-cols-[1fr_minmax(240px,31.5rem)_1fr] xl:items-center">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-normal">9AM</h1>
              </div>
              <div className="flex min-h-10 items-center justify-start gap-2 xl:justify-center">
                {loading && !clientMode && loadingStatus ? (
                  <div
                    className="flex w-full max-w-[36rem] items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 shadow-sm"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="relative flex size-4 shrink-0 items-center justify-center">
                      <span className="absolute size-4 animate-ping rounded-full bg-emerald-400/30" />
                      <Loader2 className="relative size-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                    </span>
                    <span className="min-w-0 animate-pulse text-sm font-medium leading-snug text-foreground">
                      {loadingStatus}
                    </span>
                  </div>
                ) : error && !clientMode ? (
                  <div
                    className="flex w-full max-w-[36rem] items-center gap-2 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 shadow-sm"
                    role="alert"
                  >
                    <AlertCircle className="size-4 shrink-0 text-destructive" />
                    <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-destructive">
                      {error}
                    </span>
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setError('')
                        void fetchNews('polygon')
                      }}
                    >
                      Retry
                    </Button>
                    <Button
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                      title="Dismiss error"
                      onClick={() => setError('')}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="relative w-full sm:max-w-[27rem]">
                      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        aria-label="Search news"
                        className="pl-8"
                        placeholder="Search news"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onFocus={() => {
                          setClientProfilePanelOpen(false)
                          setActiveClientRailView('search')
                        }}
                      />
                    </div>
                    {!clientMode ? (
                      <Button
                        onClick={() => void fetchNews('polygon')}
                        disabled={loading}
                        size="icon"
                        title="Fetch latest from Polygon (100)"
                        type="button"
                        variant="outline"
                      >
                        <RefreshCw />
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => {
                        setClientProfilePanelOpen(false)
                        navigate('/dashboard/database')
                        showBottomToast({
                          title: 'Database',
                          description: 'Opening saved Yahoo / ticker snapshots.',
                        })
                      }}
                      size="icon"
                      title="Open Database"
                      type="button"
                      variant="outline"
                      aria-label="Open Database"
                    >
                      <Database />
                    </Button>
                  </>
                )}
              </div>
              <nav aria-label="News categories" className="flex flex-wrap items-center justify-start gap-1 sm:gap-3 xl:justify-end">
                {(clientMode ? clientTopCategories : dashboardCategories).map((category) => (
                  <Button
                    key={category.id}
                    className={cn(
                      'bg-transparent px-2 text-base text-muted-foreground hover:bg-transparent hover:text-foreground',
                      (clientMode
                        ? activeClientCategory === category.id
                        : activeDashboardCategory === category.id) && 'font-semibold text-foreground',
                    )}
                    onClick={() => {
                      setClientProfilePanelOpen(false)
                      if (clientMode) {
                        setActiveClientCategory(category.id as ClientCategoryId)
                        setActiveClientRailView('latest')
                        setQuery('')
                      } else {
                        handleDashboardCategoryChange(category.id as DashboardCategoryId)
                      }
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {category.label}
                  </Button>
                ))}
              </nav>
            </div>
          </div>
        </header>

        <section className="flex w-full flex-col gap-4 px-4 py-4 sm:px-6 xl:min-h-0 xl:flex-1 xl:flex-row xl:overflow-hidden">
          <aside className={cn('relative z-50 min-h-[520px] shrink-0 xl:h-full', clientProfilePanelOpen ? 'w-56' : 'w-16')}>
            <div
              className={cn(
                'group absolute inset-y-0 left-0 flex flex-col gap-2 overflow-hidden rounded-lg border bg-card/95 p-2 text-card-foreground shadow-sm transition-all duration-200',
                clientProfilePanelOpen ? 'w-56' : 'w-16 hover:w-56',
              )}
            >
              {[
                { id: 'latest' as const, label: 'Latest', icon: CalendarClock },
                { id: 'bookmarks' as const, label: 'Saved', icon: Bookmark },
                { id: 'liked' as const, label: 'Liked', icon: Heart },
                { id: 'reported' as const, label: 'Reported', icon: Flag },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <Button
                    key={item.id}
                    aria-label={item.label}
                    className={cn(
                      'h-10 w-full justify-start gap-3 overflow-hidden px-2',
                      !clientProfilePanelOpen && activeClientRailView === item.id && 'bg-muted text-foreground',
                    )}
                    onClick={() => setClientRailView(item.id)}
                    title={item.label}
                    type="button"
                    variant="ghost"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span
                      className={cn(
                        'overflow-hidden whitespace-nowrap text-base transition-all',
                        clientProfilePanelOpen ? 'w-32 opacity-100' : 'w-0 opacity-0 group-hover:w-32 group-hover:opacity-100',
                      )}
                    >
                      {item.label}
                    </span>
                  </Button>
                )
              })}

              <div className="mt-auto space-y-1">
                <Button
                  aria-label="Profile and settings"
                  className={cn(
                    'h-10 w-full justify-start gap-3 overflow-hidden px-2',
                    clientProfilePanelOpen && 'bg-muted text-foreground',
                  )}
                  title="Profile and settings"
                  type="button"
                  variant="ghost"
                  onClick={() => setClientProfilePanelOpen(true)}
                >
                  {authUser?.user_metadata?.avatar_url ? (
                    <img alt="" className="size-4 shrink-0 rounded-full object-cover" src={String(authUser.user_metadata.avatar_url)} />
                  ) : (
                    <Settings className="size-4 shrink-0" />
                  )}
                  <span
                    className={cn(
                      'overflow-hidden whitespace-nowrap text-base transition-all',
                      clientProfilePanelOpen ? 'w-32 opacity-100' : 'w-0 opacity-0 group-hover:w-32 group-hover:opacity-100',
                    )}
                  >
                    {authUser ? String(authUser.user_metadata?.full_name ?? 'Settings') : 'Settings'}
                  </span>
                </Button>
              </div>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 xl:h-full xl:overflow-hidden">
          {!clientMode && (Boolean(loadingStatus) || Boolean(error) || polygonFetchTrace) ? (
            renderFetchActivityTerminal()
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 xl:flex-row xl:overflow-hidden">
          <>
          <Card
            className="min-h-[520px] overflow-hidden bg-neutral-100 dark:bg-black xl:h-full xl:w-[var(--client-latest-width)] xl:flex-none"
            style={{ '--client-latest-width': `${clientLatestWidth}px` } as CSSProperties}
          >
            <CardHeader className="gap-1">
              <CardTitle className="text-lg">
                {activeClientRailView === 'search' ? 'Search' : activeClientRailView === 'bookmarks' ? 'Saved' : activeClientRailView === 'liked' ? 'Liked' : activeClientRailView === 'reported' ? 'Reported' : 'Latest'}
              </CardTitle>
              {activeClientRailView === 'search' ? (
                <div className="relative pt-2">
                  <Search className="pointer-events-none absolute left-2.5 top-4 size-4 text-muted-foreground" />
                  <Input
                    aria-label="Search saved news"
                    className="pl-8"
                    placeholder="Title, ticker, source"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
                <div
                  ref={newsListScrollRef}
                  className="min-h-[430px] overflow-y-auto xl:h-full"
                  onScroll={handleNewsListScroll}
                >
                  <div className="space-y-3 p-4 pt-0">
                    {loading ? (
                      Array.from({ length: 7 }).map((_, index) => (
                        <div key={index} className="space-y-2 rounded-lg border bg-card/40 p-3">
                          <div className="flex gap-3">
                            <div className="min-w-0 flex-1 space-y-2">
                              <Skeleton className="h-4 w-3/4" />
                              <Skeleton className="h-3 w-full" />
                              <Skeleton className="h-3 w-2/3" />
                            </div>
                            <Skeleton className="size-16 shrink-0 rounded-md" />
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Skeleton className="h-5 w-14 rounded-full" />
                            <Skeleton className="h-5 w-14 rounded-full" />
                            <Skeleton className="ml-auto h-3 w-16" />
                          </div>
                        </div>
                      ))
                    ) : clientArticles.length ? (
                      <>
                        {activeClientRailView === 'latest' ? (
                          groupArticlesByDate(clientArticles).map((group) => (
                            <div key={group.key} className="space-y-3">
                              <div className="sticky top-0 z-10 -mx-4 bg-neutral-100 px-4 py-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground dark:bg-black">
                                {group.heading}
                              </div>
                              {group.articles.map((article) => renderClientArticleCard(article))}
                            </div>
                          ))
                        ) : (
                          clientArticles.map((article) => renderClientArticleCard(article))
                        )}
                        {savedMode && loadingMoreSaved ? (
                          <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Loading more…
                          </div>
                        ) : null}
                        {savedMode && !hasMoreSaved && clientArticles.length > 0 ? (
                          <div className="py-2 text-center text-xs text-muted-foreground">End of news</div>
                        ) : null}
                      </>
                    ) : (
                      <div className="rounded-lg border p-4 text-base text-muted-foreground">
                        No articles match this category yet.
                      </div>
                    )}
                  </div>
                </div>
            </CardContent>
          </Card>

          <Button
            aria-label="Resize news list column"
            className={cn(
              'hidden h-full w-5 cursor-col-resize rounded-md border border-dashed bg-muted/30 px-0 text-muted-foreground hover:bg-muted hover:text-foreground xl:flex',
              clientResizeTarget === 'latest' && 'border-primary bg-muted text-foreground',
            )}
            size="icon"
            title="Drag to resize news list"
            type="button"
            variant="ghost"
            onDoubleClick={() => setClientLatestWidth(360)}
            onPointerDown={(event) => startClientColumnResize('latest', event)}
          >
            <GripVertical className="size-4" />
          </Button>

          <Card
            className="min-h-[520px] overflow-hidden xl:h-full xl:w-[var(--client-story-width)] xl:flex-none"
            style={{ '--client-story-width': `${clientStoryWidth}px` } as CSSProperties}
          >
            <CardHeader className="gap-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-lg">Story</CardTitle>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    aria-label={`Open story in ${destinationLabel(aiDestinations, aiDestination)}`}
                    disabled={!selectedArticle}
                    onClick={openSelectedArticleAi}
                    size="sm"
                    title={`Open story in ${destinationLabel(aiDestinations, aiDestination)}`}
                    type="button"
                    variant="outline"
                  >
                    <Sparkles />
                    AI
                  </Button>
                  {selectedArticle ? (
                    <Button
                      aria-label={storyEditOpen ? 'Close story editor' : 'Edit story'}
                      onClick={() => (storyEditOpen ? cancelStoryEditor() : openStoryEditor())}
                      size="icon-sm"
                      title={storyEditOpen ? 'Close editor' : 'Edit story in this column'}
                      type="button"
                      variant={storyEditOpen ? 'secondary' : 'outline'}
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                  {!clientMode && selectedArticle ? (
                    <>
                      <Button
                        disabled={saving}
                        onClick={() => void saveStoryPrimary()}
                        size="icon-sm"
                        title="Save to Supabase"
                        type="button"
                        variant="outline"
                      >
                        {saving ? <Loader2 className="animate-spin" /> : <Database />}
                      </Button>
                      {articleIsInSupabase ? (
                        <Button
                          disabled={saving}
                          onClick={() => void deleteSavedArticle(selectedSupabaseRowId ?? undefined)}
                          size="icon-sm"
                          title="Delete from Supabase"
                          type="button"
                          variant="destructive"
                        >
                          {saving ? <Loader2 className="animate-spin" /> : <Trash2 />}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  {/* Client mode keeps social actions; dashboard keeps only AI / Edit / Save. */}
                  {clientMode ? (
                    <>
                      <Button
                        aria-label="Save bookmark"
                        className={cn(selectedArticleBookmarked && 'text-primary')}
                        disabled={!selectedArticle}
                        onClick={toggleClientBookmark}
                        size="icon-sm"
                        title="Save bookmark"
                        type="button"
                        variant={selectedArticleBookmarked ? 'secondary' : 'outline'}
                      >
                        <Bookmark className={cn(selectedArticleBookmarked && 'fill-current')} />
                      </Button>
                      <Button
                        aria-label="Like article"
                        className={cn(selectedArticleLiked && 'text-primary')}
                        disabled={!selectedArticle}
                        onClick={toggleClientLike}
                        size="icon-sm"
                        title="Like"
                        type="button"
                        variant={selectedArticleLiked ? 'secondary' : 'outline'}
                      >
                        <Heart className={cn(selectedArticleLiked && 'fill-current')} />
                      </Button>
                      <Button
                        aria-label="Report article"
                        disabled={!selectedArticle}
                        onClick={reportClientArticle}
                        size="icon-sm"
                        title="Report"
                        type="button"
                        variant={selectedArticleReported ? 'destructive' : 'outline'}
                      >
                        <Flag />
                      </Button>
                      <Button
                        aria-label="Share article"
                        disabled={!selectedArticle?.url}
                        onClick={() => void shareClientArticle()}
                        size="icon-sm"
                        title="Share"
                        type="button"
                        variant="outline"
                      >
                        <Share2 />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              {loading ? (
                <div className="space-y-4 p-1">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="h-8 w-4/5" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <div className="space-y-2 pt-4">
                    <Skeleton className="h-5 w-28" />
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="flex gap-3">
                        <Skeleton className="size-10 rounded-full" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : error && !selectedArticle ? (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>Request failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : selectedArticle ? (
                <ScrollArea className="min-h-[408px] pr-3 xl:h-full">
                  <article className="space-y-4 pb-10">
                    {storyEditOpen ? (
                      renderStoryEditorForm()
                    ) : (
                      <>
                        {cleanArticleImageUrl(selectedArticle.imageUrl) ? (
                          <div className="relative overflow-hidden rounded-lg border">
                            <img
                              alt=""
                              className="aspect-video w-full object-cover"
                              src={cleanArticleImageUrl(selectedArticle.imageUrl)}
                            />
                            <a
                              className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full border border-white/30 bg-background/95 p-1.5 text-foreground shadow-md backdrop-blur transition hover:bg-background"
                              href={googleImagesSearchUrl(selectedArticle.title)}
                              rel="noreferrer"
                              target="_blank"
                              title="Search this headline on Google Images"
                              aria-label="Search Google Images for alternate image"
                            >
                              <img
                                alt=""
                                className="size-3.5 shrink-0 rounded-sm"
                                src="https://www.google.com/s2/favicons?domain=google.com&sz=32"
                              />
                              <ArrowUpRight className="size-3.5 shrink-0 opacity-80" />
                            </a>
                          </div>
                        ) : (
                          <a
                            className="inline-flex items-center gap-1 rounded-full border bg-muted/40 p-1.5 text-foreground transition hover:bg-muted"
                            href={googleImagesSearchUrl(selectedArticle.title)}
                            rel="noreferrer"
                            target="_blank"
                            title="Search this headline on Google Images"
                            aria-label="Search Google Images for alternate image"
                          >
                            <img
                              alt=""
                              className="size-3.5 shrink-0 rounded-sm"
                              src="https://www.google.com/s2/favicons?domain=google.com&sz=32"
                            />
                            <ArrowUpRight className="size-3.5 shrink-0 opacity-80" />
                          </a>
                        )}
                        <div className="space-y-3">
                          <h2 className="text-3xl font-semibold leading-tight tracking-normal">{selectedArticle.title}</h2>
                          <Separator />
                        </div>
                        <div className="flex min-w-0 items-center justify-between gap-3 text-sm leading-none text-muted-foreground">
                          <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5">
                            <CalendarClock className="size-3.5 shrink-0 opacity-70" />
                            <ArticleTimestamp layout="inline" value={selectedArticle.publishedAt} />
                          </span>
                          {selectedArticle.url ? (
                            <a
                              className="inline-flex min-w-0 max-w-[55%] items-center justify-end gap-1.5 font-medium text-muted-foreground transition hover:text-foreground"
                              href={selectedArticle.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {publisherLogoUrl ? (
                                <img
                                  alt=""
                                  className="size-4 shrink-0 rounded-sm border bg-background object-contain"
                                  src={publisherLogoUrl}
                                />
                              ) : null}
                              <span className="truncate">{selectedArticle.source || activeLabel}</span>
                            </a>
                          ) : (
                            <span className="inline-flex min-w-0 max-w-[55%] items-center justify-end gap-1.5 font-medium text-muted-foreground">
                              {publisherLogoUrl ? (
                                <img
                                  alt=""
                                  className="size-4 shrink-0 rounded-sm border bg-background object-contain"
                                  src={publisherLogoUrl}
                                />
                              ) : null}
                              <span className="truncate">{selectedArticle.source || activeLabel}</span>
                            </span>
                          )}
                        </div>
                        <p className="text-base leading-6 text-muted-foreground">
                          {selectedArticle.summary || 'No summary was provided by this source.'}
                        </p>
                        <div className="text-sm font-medium text-muted-foreground">
                          By {selectedArticle.author || selectedArticle.source || activeLabel}
                        </div>
                        {renderLinkedMarketNews()}
                      </>
                    )}

                  </article>
                </ScrollArea>
              ) : (
                <div className="rounded-lg border p-4 text-base text-muted-foreground">
                  Select an article to preview it.
                </div>
              )}
            </CardContent>
          </Card>

          <Button
            aria-label="Resize story column"
            className={cn(
              'hidden h-full w-5 cursor-col-resize rounded-md border border-dashed bg-muted/30 px-0 text-muted-foreground hover:bg-muted hover:text-foreground xl:flex',
              clientResizeTarget === 'story' && 'border-primary bg-muted text-foreground',
            )}
            size="icon"
            title="Drag to resize story"
            type="button"
            variant="ghost"
            onDoubleClick={() => setClientStoryWidth(520)}
            onPointerDown={(event) => startClientColumnResize('story', event)}
          >
            <GripVertical className="size-4" />
          </Button>

          <Card
            className="min-h-[520px] overflow-hidden xl:h-full xl:w-[var(--client-ticker-width)] xl:flex-none"
            style={{ '--client-ticker-width': `${clientTickerWidth}px` } as CSSProperties}
          >
            <CardHeader className="gap-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-lg">Tickers</CardTitle>
                  <CardDescription>
                    {loading
                      ? 'Loading symbols…'
                      : selectedArticle
                        ? `${getWorkingTickerForms().length} linked symbols`
                        : 'Select a story'}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    aria-label="Add ticker"
                    disabled={!selectedArticle || loading || saving}
                    size="icon-sm"
                    title="Add ticker"
                    type="button"
                    variant="outline"
                    onClick={startAddTicker}
                  >
                    <Plus className="size-4" />
                  </Button>
                  {!clientMode ? (
                    <Button
                      aria-label="Ask Perplexity for linked tickers"
                      disabled={!selectedArticle || loading}
                      size="icon-sm"
                      title="Ask Perplexity for linked tickers from this story"
                      type="button"
                      variant="outline"
                      onClick={openLinkedTickersAi}
                    >
                      <Sparkles className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 p-0">
              <ScrollArea className="min-h-[430px] xl:h-full">
                <div className="px-3 pb-2 pt-0">
                  {loading ? (
                    <div className="divide-y divide-border">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="space-y-3 px-1 py-4">
                          <div className="flex items-center gap-2">
                            <Skeleton className="size-5 rounded-full" />
                            <Skeleton className="h-4 w-14" />
                            <Skeleton className="h-4 w-16" />
                            <Skeleton className="ml-auto h-5 w-16 rounded-full" />
                          </div>
                          <Skeleton className="h-3 w-2/3" />
                          <Skeleton className="h-3 w-full" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    renderTickerCards({ compact: true })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Button
            aria-label="Resize ticker column"
            className={cn(
              'hidden h-full w-5 cursor-col-resize rounded-md border border-dashed bg-muted/30 px-0 text-muted-foreground hover:bg-muted hover:text-foreground xl:flex',
              clientResizeTarget === 'tickers' && 'border-primary bg-muted text-foreground',
            )}
            size="icon"
            title="Drag to resize tickers"
            type="button"
            variant="ghost"
            onDoubleClick={() => setClientTickerWidth(320)}
            onPointerDown={(event) => startClientColumnResize('tickers', event)}
          >
            <GripVertical className="size-4" />
          </Button>

          {renderMarketPanel({ className: 'min-w-0 xl:flex-1' })}
          {apiDebugPanelOpen ? renderApiDebugPanel() : null}
            </>
          </div>
          </div>
        </section>
        {clientProfilePanelOpen ? renderClientSettingsScreen() : null}
      </main>
  )
}

export default App
