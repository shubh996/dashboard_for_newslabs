import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Bell,
  Bookmark,
  CalendarClock,
  Check,
  CircleUserRound,
  Database,
  ExternalLink,
  FileJson,
  Flag,
  GripVertical,
  Heart,
  Loader2,
  MessageCircle,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

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

type SocialPost = {
  id: string
  text: string
  url: string
  createdAt: string | null
  authorName: string
  username: string
  metrics?: {
    likeCount?: number
    repostCount?: number
    replyCount?: number
  }
}

type LocalComment = {
  id: string
  text: string
  createdAt: string
}

type MomentumPoint = {
  date: string
  close: number
  previousClose: number | null
  changePercent: number | null
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
type TradeDestination = 'trading212' | 'robinhood' | 'tradingview'
type AiDestination = 'perplexity' | 'chatgpt' | 'grok' | 'gemini'

const providers: Array<{ id: ProviderId; label: string; hint: string }> = [
  
    { id: 'yahoo-finance', label: 'Yahoo Finance', hint: 'Python yfinance Search' },
  { id: 'polygon', label: 'Polygon', hint: 'Reference news feed' },
  { id: 'alpha-vantage', label: 'Alpha Vantage', hint: 'NEWS_SENTIMENT feed' },
  { id: 'finnhub', label: 'Finnhub', hint: 'Company and market news feed' },

  { id: 'newsapi', label: 'NewsAPI', hint: 'Everything endpoint' },
]

const sourceTabs: Array<{ id: SourceTabId; label: string }> = [
  ...providers.map((item) => ({ id: item.id, label: item.label })),
]

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

const tradeDestinations: Array<{ id: TradeDestination; label: string }> = [
  { id: 'trading212', label: 'Trading 212' },
  { id: 'robinhood', label: 'Robinhood' },
  { id: 'tradingview', label: 'TradingView' },
]

const aiDestinations: Array<{ id: AiDestination; label: string }> = [
  { id: 'perplexity', label: 'Perplexity' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'grok', label: 'Grok' },
  { id: 'gemini', label: 'Gemini' },
]

const previewMinWidth = 380
const previewMaxWidth = 900

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

function formatRelativeTime(value: string | null) {
  if (!value) return 'No publish date'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No publish date'

  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000))

  if (diffMinutes < 1) return 'now'
  if (diffMinutes < 60) return `${diffMinutes} ${diffMinutes === 1 ? 'min' : 'mins'} ago`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hr' : 'hrs'} ago`

  const diffDays = Math.round(diffHours / 24)
  if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'day' : 'd'} ago`

  const diffWeeks = Math.round(diffDays / 7)
  if (diffDays < 30) return `${diffWeeks} ${diffWeeks === 1 ? 'wk' : 'wks'} ago`

  const diffMonths = Math.round(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths} ${diffMonths === 1 ? 'mo' : 'mos'} ago`

  const diffYears = Math.round(diffMonths / 12)
  return `${diffYears} ${diffYears === 1 ? 'yr' : 'yrs'} ago`
}

function publishedTime(article: Pick<NewsArticle, 'publishedAt'>) {
  if (!article.publishedAt) return 0
  const time = new Date(article.publishedAt).getTime()
  return Number.isNaN(time) ? 0 : time
}

function sortNewsByLatest(articles: NewsArticle[]) {
  return [...articles].sort((left, right) => publishedTime(right) - publishedTime(left))
}

function isWithinLastDays(article: NewsArticle, days: number) {
  const time = publishedTime(article)
  if (!time) return false
  return Date.now() - time <= days * 24 * 60 * 60 * 1000
}

function formatTimelineDate(value: string | null) {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No date'
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

function articleDateKey(article: NewsArticle) {
  return article.publishedAt ? article.publishedAt.slice(0, 10) : ''
}

function sourceDomain(article: NewsArticle) {
  try {
    return article.url ? new URL(article.url).hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

function sourceLogoUrl(article: NewsArticle) {
  const domain = sourceDomain(article)
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32` : ''
}

function uniqueSourcesForArticles(articles: NewsArticle[]) {
  const seen = new Set<string>()
  return articles
    .map((article) => ({
      name: article.source || sourceDomain(article) || 'Source',
      logoUrl: sourceLogoUrl(article),
    }))
    .filter((source) => {
      const key = source.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 4)
}

function movementLabel(changePercent: number | null) {
  if (changePercent === null) return 'Move unavailable'
  const direction = changePercent >= 0 ? 'up' : 'down'
  return `${Math.abs(changePercent).toFixed(1)}% ${direction}`
}

function momentumSummaryForArticles(articles: NewsArticle[], ticker: string) {
  if (!articles.length) {
    return `No linked headline was found for ${displayTicker(ticker)} on this session; the close-to-close move is shown for context.`
  }

  const titles = articles.slice(0, 3).map((article) => article.title.replace(/\s+/g, ' ').trim())
  return `Momentum was tied to ${titles.join('; ')}. Coverage suggests the move came from these catalysts rather than a single isolated print.`
}

function articleJson(article: NewsArticle | null, providerRaw: unknown) {
  if (!article) return JSON.stringify(providerRaw ?? {}, null, 2)
  return JSON.stringify(
    {
      normalized: article,
      raw: article.raw,
    },
    null,
    2,
  )
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
const marketFallbackTickers = ['IXIC', 'GSPC', 'NDX', 'DJI', 'RUT', 'NYA']
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
  '^IXIC': nasdaqCompositeSymbol,
  '^NDX': 'NASDAQ:NDX',
  '^NYA': 'TVC:NYA',
  '^RUT': 'TVC:RUT',
  '^SPX': 'TVC:SPX',
  DIA: 'AMEX:DIA',
  DJI: 'TVC:DJI',
  GSPC: 'TVC:SPX',
  IXIC: nasdaqCompositeSymbol,
  IWM: 'AMEX:IWM',
  NDX: 'NASDAQ:NDX',
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

function trading212InstrumentUrl(ticker: string) {
  const symbol = displayTicker(ticker).replace(/_/g, '.')
  return `https://www.trading212.com/trading-instruments/invest/${encodeURIComponent(symbol)}`
}

function robinhoodInstrumentUrl(ticker: string) {
  const symbol = displayTicker(ticker).replace(/_/g, '.')
  return `https://robinhood.com/stocks/${encodeURIComponent(symbol)}`
}

function tradeDestinationUrl(ticker: string, destination: TradeDestination) {
  if (destination === 'robinhood') return robinhoodInstrumentUrl(ticker)
  if (destination === 'tradingview') return tradingViewSymbolPageUrl(ticker)
  return trading212InstrumentUrl(ticker)
}

function destinationLabel<T extends string>(items: Array<{ id: T; label: string }>, id: T) {
  return items.find((item) => item.id === id)?.label ?? id
}

function xSearchUrl(query: string) {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`
}

function sentimentBadgeClass(label: string) {
  const cleanLabel = label.toLowerCase()

  if (cleanLabel.includes('positive') || cleanLabel.includes('bullish')) {
    return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300'
  }

  if (cleanLabel.includes('negative') || cleanLabel.includes('bearish')) {
    return 'border-red-500/40 bg-red-500/15 text-red-700 hover:bg-red-500/20 dark:text-red-300'
  }

  if (cleanLabel.includes('neutral')) {
    return 'border-sky-500/35 bg-sky-500/12 text-sky-700 hover:bg-sky-500/18 dark:text-sky-300'
  }

  return 'border-amber-500/35 bg-amber-500/12 text-amber-700 hover:bg-amber-500/18 dark:text-amber-300'
}

function SentimentBadge({ label }: { label: string }) {
  return (
    <Badge className={sentimentBadgeClass(label)} variant="outline">
      {label}
    </Badge>
  )
}

function displaySentimentLabel(label: string) {
  const cleanLabel = label.toLowerCase()
  if (cleanLabel.includes('positive') || cleanLabel.includes('bullish')) return 'Positive'
  if (cleanLabel.includes('negative') || cleanLabel.includes('bearish')) return 'Negative'
  if (cleanLabel.includes('neutral')) return 'Neutral'
  return label
}

function SentimentCornerBadge({ label }: { label: string }) {
  return (
    <Badge className={cn('px-2 py-0.5 text-[11px] font-semibold', sentimentBadgeClass(label))} title={label} variant="outline">
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

function tradingViewWidgetBackground(theme: 'light' | 'dark') {
  return theme === 'dark' ? '#09090b' : '#ffffff'
}

function tradingViewAdvancedChartUrl(ticker: string, theme: 'light' | 'dark', height: number, compareTickers: string[]) {
  const symbol = tradingViewSymbol(ticker)
  const background = tradingViewWidgetBackground(theme)
  const compareSymbols = uniqueTickerList(compareTickers)
    .filter((item) => item !== ticker)
    .map((item) => ({
      symbol: tradingViewSymbol(item),
      position: 'SameScale',
    }))
  const options = {

     allow_symbol_change: true,
  calendar: false,
  details: false,
  hide_side_toolbar: true,
  hide_top_toolbar: true,
  hide_legend: true,
  hide_volume: false,
  hotlist: false,

  save_image: true,
  style: 3,


  watchlist: [],
  withdateranges: true,
 


    symbol,
    locale: 'en',
    colorTheme: theme,
    isTransparent: true,
    backgroundColor: background,
    autosize: true,
    width: '100%',
    height,
  
    compareSymbols,
  
    disabled_features: ['border_around_the_chart'],
   
    interval: 'D',
    range: '12M',

    support_host: 'https://www.tradingview.com',
    theme,
    toolbar_bg: background,
    timezone: 'Etc/UTC',
   
    overrides: {
      'mainSeriesProperties.priceAxisProperties.percentage': true,
      'paneProperties.background': background,
      'paneProperties.backgroundType': 'solid',
      'paneProperties.backgroundGradientStartColor': background,
      'paneProperties.backgroundGradientEndColor': background,
      'paneProperties.vertGridProperties.color': theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      'paneProperties.horzGridProperties.color': theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      'scalesProperties.backgroundColor': background,
    },


  }

  return `https://s.tradingview.com/embed-widget/advanced-chart/?locale=en&symbol=${encodeURIComponent(symbol)}#${encodeURIComponent(JSON.stringify(options))}`
}

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
    <div className="overflow-hidden border-0 bg-background" style={{ height }}>
      <iframe
        allowTransparency
        className="block border-0"
        frameBorder="0"
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

function tradingViewSymbolOverviewSrcDoc(ticker: string, theme: 'light' | 'dark', compareTickers: string[] = []) {
  const symbols = uniqueTickerList(compareTickers.length ? compareTickers : [ticker]).map((item) => [`${tradingViewSymbol(item)}|1D`])
  const background = tradingViewWidgetBackground(theme)

  const options = {
    symbols,
    chartOnly: false,
    width: '100%',
    height: '100%',
    locale: 'en',
    colorTheme: theme,
    isTransparent: true,
    backgroundColor: background,
    autosize: true,
    showVolume: false,
    showMA: false,
    hideDateRanges: false,
    hideMarketStatus: true,
    hideSymbolLogo: false,
    scalePosition: 'right',
    scaleMode: 'Normal',
    fontFamily: '-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif',
    fontSize: '10',
    noTimeScale: false,
    valuesTracking: '1',
    changeMode: 'price-and-percent',
    chartType: 'area',
    lineWidth: 2,
    lineType: 0,
    dateRanges: ['1d|1', '1w|15', '1m|1D', '3m|60', '6m|1D', '12m|1D', '60m|1W', '120m|1W', 'ytd|1D', 'all|1M'],
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      *, *::before, *::after {
        border-color: transparent !important;
        box-shadow: none !important;
      }
      html, body, .tradingview-widget-container, .tradingview-widget-container__widget {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        overflow: hidden;
        background: ${background} !important;
      }
      iframe, div {
        border: 0 !important;
        outline: 0 !important;
        box-shadow: none !important;
      }
      .tradingview-widget-container__widget > iframe {
        width: calc(100% + 6px) !important;
        height: calc(100% + 6px) !important;
        margin: -3px !important;
      }
      .tradingview-widget-copyright {
        display: none;
      }
    </style>
  </head>
  <body>
    <div class="tradingview-widget-container">
      <div class="tradingview-widget-container__widget"></div>
      <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js" async>
${JSON.stringify(options, null, 2)}
      </script>
    </div>
  </body>
</html>`
}

function TradingViewSymbolOverview({
  ticker,
  theme,
  height,
  compareTickers = [],
}: {
  ticker: string
  theme: 'light' | 'dark'
  height: number
  compareTickers?: string[]
}) {
  const background = tradingViewWidgetBackground(theme)

  return (
    <div className="overflow-hidden border-0 bg-background" style={{ height }}>
      <iframe
        allowTransparency
        className="block border-0"
        frameBorder="0"
        style={{
          border: 0,
          background,
          height: height + 6,
          margin: -3,
          width: 'calc(100% + 6px)',
        }}
        height={height + 6}
        loading="lazy"
        srcDoc={tradingViewSymbolOverviewSrcDoc(ticker, theme, compareTickers)}
        title={`Ticker overview ${displayTicker(ticker)}`}
      />
    </div>
  )
}

function tradingViewTickerTagSrcDoc(ticker: string, theme: 'light' | 'dark') {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script type="module" src="https://widgets.tradingview-widget.com/w/en/tv-ticker-tag.js"></script>
    <style>
      *, *::before, *::after {
        box-sizing: border-box;
      }
      html, body {
        width: max-content;
        height: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        overflow: hidden;
        background: transparent !important;
        color-scheme: ${theme};
      }
      body {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
      }
      tv-ticker-tag {
        width: auto;
        max-width: 168px;
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }
    </style>
  </head>
  <body>
    <tv-ticker-tag symbol="${tradingViewSymbol(ticker)}"></tv-ticker-tag>
  </body>
</html>`
}

function TradingViewTickerTag({
  ticker,
  theme,
}: {
  ticker: string
  theme: 'light' | 'dark'
}) {
  return (
    <iframe
      allowTransparency
        className="block h-10 w-[168px] max-w-full border-0 bg-transparent"
        frameBorder="0"
        loading="lazy"
        srcDoc={tradingViewTickerTagSrcDoc(ticker, theme)}
        style={{ border: 0, background: 'transparent', colorScheme: theme }}
        title={`Ticker tag ${displayTicker(ticker)}`}
      />
  )
}

function TickerLinkBadge({
  ticker,
  strong = false,
  className,
}: {
  ticker: string
  strong?: boolean
  className?: string
}) {
  return (
    <Badge
      asChild
      className={cn(strong && 'bg-foreground text-background hover:bg-foreground/90', className)}
      variant={strong ? 'default' : 'secondary'}
    >
      <a
        href={tradingViewSymbolPageUrl(ticker)}
        onClick={(event) => event.stopPropagation()}
        rel="noreferrer"
        target="_blank"
        title={`Open ${displayTicker(ticker)} on TradingView`}
      >
        {displayTicker(ticker)}
      </a>
    </Badge>
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

function dashboardCategoryById(id: DashboardCategoryId) {
  return dashboardCategories.find((category) => category.id === id) ?? dashboardCategories[0]
}

function articleStorageKey(article: Pick<NewsArticle, 'url'> | null | undefined) {
  return article?.url?.trim().toLowerCase() || ''
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
  const [activeSource, setActiveSource] = useState<SourceTabId>('yahoo-finance')
  const [activeDashboardCategory, setActiveDashboardCategory] = useState<DashboardCategoryId>('all-us')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(12)
  const [data, setData] = useState<NewsResponse | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedMode, setSavedMode] = useState(false)
  const [savedArticleIndex, setSavedArticleIndex] = useState<Record<string, NewsArticle>>({})
  const [clientMode, setClientMode] = useState(clientModeFromPath)
  const [activeClientRailView, setActiveClientRailView] = useState<ClientRailView>('latest')
  const [clientProfilePanelOpen, setClientProfilePanelOpen] = useState(false)
  const [activeClientCategory, setActiveClientCategory] = useState<ClientCategoryId>('all')
  const [activeMarketTicker, setActiveMarketTicker] = useState('all')
  const [showNormalizedJson, setShowNormalizedJson] = useState(false)
  const [articleEditMode, setArticleEditMode] = useState(false)
  const [editingTickerIndex, setEditingTickerIndex] = useState<number | null>(null)
  const [marketNews, setMarketNews] = useState<NewsArticle[]>([])
  const [marketNewsLoading, setMarketNewsLoading] = useState(false)
  const [marketNewsError, setMarketNewsError] = useState('')
  const [momentumPoints, setMomentumPoints] = useState<MomentumPoint[]>([])
  const [momentumLoading, setMomentumLoading] = useState(false)
  const [momentumError, setMomentumError] = useState('')
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([])
  const [socialLoading, setSocialLoading] = useState(false)
  const [socialError, setSocialError] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [localCommentsByKey, setLocalCommentsByKey] = useState<Record<string, LocalComment[]>>({})
  const [bookmarkedArticleIds, setBookmarkedArticleIds] = useState<Set<string>>(() => new Set())
  const [likedArticleIds, setLikedArticleIds] = useState<Set<string>>(() => new Set())
  const [reportedArticleIds, setReportedArticleIds] = useState<Set<string>>(() => new Set())
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    return window.localStorage.getItem('newslabs-theme') === 'dark' ? 'dark' : 'light'
  })
  const [tradeDestination, setTradeDestination] = useState<TradeDestination>(() => {
    if (typeof window === 'undefined') return 'trading212'
    const stored = window.localStorage.getItem('newslabs-trade-destination')
    return tradeDestinations.some((item) => item.id === stored) ? stored as TradeDestination : 'trading212'
  })
  const [aiDestination, setAiDestination] = useState<AiDestination>(() => {
    if (typeof window === 'undefined') return 'perplexity'
    const stored = window.localStorage.getItem('newslabs-ai-destination')
    return aiDestinations.some((item) => item.id === stored) ? stored as AiDestination : 'perplexity'
  })
  const [previewWidth, setPreviewWidth] = useState(() => {
    if (typeof window === 'undefined') return 520
    return clamp(Number(window.localStorage.getItem('newslabs-preview-width') || 520), previewMinWidth, previewMaxWidth)
  })
  const [isResizingPreview, setIsResizingPreview] = useState(false)
  const [clientLatestWidth, setClientLatestWidth] = useState(() => {
    if (typeof window === 'undefined') return 360
    return clamp(Number(window.localStorage.getItem('newslabs-client-latest-width') || 360), 300, 560)
  })
  const [clientStoryWidth, setClientStoryWidth] = useState(() => {
    if (typeof window === 'undefined') return 520
    return clamp(Number(window.localStorage.getItem('newslabs-client-story-width') || 520), 380, 780)
  })
  const [clientTickerWidth, setClientTickerWidth] = useState(() => {
    if (typeof window === 'undefined') return 320
    return clamp(Number(window.localStorage.getItem('newslabs-client-ticker-width') || 320), 260, 460)
  })
  const [clientCommentsWidth, setClientCommentsWidth] = useState(() => {
    if (typeof window === 'undefined') return 360
    return clamp(Number(window.localStorage.getItem('newslabs-client-comments-width') || 360), 300, 520)
  })
  const [clientResizeTarget, setClientResizeTarget] = useState<'latest' | 'story' | 'tickers' | 'comments' | null>(null)
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
  const [newTicker, setNewTicker] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const queryRef = useRef(query)
  const activeDashboardCategoryRef = useRef(activeDashboardCategory)
  const limitRef = useRef(limit)
  const previewWidthRef = useRef(previewWidth)
  const resizeStartRef = useRef({ startX: 0, startWidth: previewWidth })
  const clientLatestWidthRef = useRef(clientLatestWidth)
  const clientStoryWidthRef = useRef(clientStoryWidth)
  const clientTickerWidthRef = useRef(clientTickerWidth)
  const clientCommentsWidthRef = useRef(clientCommentsWidth)
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

  const selectedArticle = useMemo(() => {
    return data?.articles.find((article) => article.id === selectedId) ?? data?.articles[0] ?? null
  }, [data, selectedId])

  const selectedRaw = useMemo(() => rawRecord(selectedArticle?.raw), [selectedArticle?.raw])
  const publisher = rawRecord(selectedRaw.publisher)
  const publisherLogoUrl = rawString(publisher.logo_url) || rawString(publisher.favicon_url)

  const selectedDetails = useMemo(() => {
    if (!selectedArticle) return []

    return [
      ['Alpha Source Domain', rawString(selectedRaw.source_domain)],
      ['Yahoo Type', rawString(selectedRaw.type)],
    ].filter(([, value]) => value !== '' && value !== null && value !== undefined)
  }, [selectedArticle, selectedRaw])

  const articleSentiment = useMemo(() => {
    if (!selectedArticle) return null

    return {
      label: selectedArticle.sentimentLabel,
      score: selectedArticle.sentimentScore,
      hasProviderSentiment: selectedArticle.sentimentLabel || selectedArticle.sentimentScore !== null,
    }
  }, [selectedArticle])

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

  const activeProviderId = activeSource === 'supabase' ? 'alpha-vantage' : activeSource
  const activeProvider = providers.find((item) => item.id === activeProviderId) ?? providers[0]
  const activeLabel = savedMode ? 'Supabase Saved News' : activeProvider.label
  const activeHint = savedMode ? 'Saved articles from market_news_articles' : activeProvider.hint
  const isSavedArticleSelected = savedMode && Boolean(selectedArticle?.savedRowId)
  const selectedSavedMatch = !isSavedArticleSelected && selectedArticle ? savedArticleIndex[articleStorageKey(selectedArticle)] ?? null : null
  const clientTickers = useMemo(() => {
    if (clientMode && !savedMode) return []
    return uniqueTickerList(selectedArticle?.tickers ?? [])
  }, [clientMode, savedMode, selectedArticle])
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
    const articles = savedMode ? data?.articles ?? [] : []
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
  }, [activeClientCategory, activeClientRailView, bookmarkedArticleIds, data, likedArticleIds, query, reportedArticleIds, savedMode])
  const navigableArticles = useMemo(() => {
    return clientMode ? clientArticles : data?.articles ?? []
  }, [clientArticles, clientMode, data])
  const activeMarketTickerValue =
    activeMarketTicker === 'all'
      ? marketTickers[0] ?? nasdaqCompositeTicker
      : resolveMarketTicker(activeMarketTicker) || marketTickers[0] || nasdaqCompositeTicker
  const showingAllMarketTickers = activeMarketTicker === 'all'
  const socialTickers = showingAllMarketTickers ? marketTickers : activeMarketTickerValue ? [activeMarketTickerValue] : []
  const socialQuery = socialQueryForTickers(socialTickers)
  const commentsKey = showingAllMarketTickers ? `all:${socialQuery}` : displayTicker(activeMarketTickerValue || socialQuery)
  const localComments = localCommentsByKey[commentsKey] ?? []
  const selectedArticleLiked = selectedArticle ? likedArticleIds.has(selectedArticle.id) : false
  const selectedArticleBookmarked = selectedArticle ? bookmarkedArticleIds.has(selectedArticle.id) : false
  const selectedArticleReported = selectedArticle ? reportedArticleIds.has(selectedArticle.id) : false
  const editDirty = useMemo(() => {
    if (!selectedArticle) return false

    return (
      editForm.title !== selectedArticle.title ||
      editForm.summary !== selectedArticle.summary ||
      editForm.url !== selectedArticle.url ||
      editForm.imageUrl !== selectedArticle.imageUrl ||
      editForm.source !== selectedArticle.source ||
      editForm.author !== selectedArticle.author ||
      (editForm.publishedAt || null) !== selectedArticle.publishedAt ||
      !sameList(editTickerSymbols(editForm.tickers), selectedArticle.tickers) ||
      !sameList(editForm.topics, selectedArticle.topics) ||
      editForm.sentimentLabel !== selectedArticle.sentimentLabel ||
      optionalNumber(editForm.sentimentScore) !== selectedArticle.sentimentScore
    )
  }, [editForm, selectedArticle])

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
    window.localStorage.setItem('newslabs-theme', theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem('newslabs-trade-destination', tradeDestination)
  }, [tradeDestination])

  useEffect(() => {
    window.localStorage.setItem('newslabs-ai-destination', aiDestination)
  }, [aiDestination])

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
    const newsTickers = showingAllMarketTickers ? marketTickers : activeMarketTickerValue ? [activeMarketTickerValue] : [nasdaqCompositeTicker]

    if (!newsTickers.length) {
      setMarketNews([])
      setMarketNewsError('')
      setMarketNewsLoading(false)
      return
    }

    const controller = new AbortController()
    setMarketNewsLoading(true)
    setMarketNewsError('')

    async function fetchMarketNews() {
      try {
        const results = await Promise.all(
          newsTickers.map(async (ticker) => {
            const params = new URLSearchParams({
              query: ticker,
              limit: showingAllMarketTickers ? '6' : '50',
            })
            const response = await fetch(`/api/providers/yahoo-finance/news?${params}`, {
              signal: controller.signal,
            })
            const body = await response.json()

            if (!response.ok) {
              throw new Error(body.error || 'Unable to fetch Yahoo Finance news.')
            }

            return Array.isArray(body.articles) ? body.articles : []
          }),
        )

        const seen = new Set<string>()
        const articles = results.flat().filter((article) => {
          const key = article.url || article.id
          if (!key || seen.has(key)) return false
          seen.add(key)
          return true
        })

        setMarketNews(articles)
      } catch (fetchError) {
        if (controller.signal.aborted) return
        setMarketNews([])
        setMarketNewsError(fetchError instanceof Error ? fetchError.message : 'Unable to fetch Yahoo Finance news.')
      } finally {
        if (!controller.signal.aborted) setMarketNewsLoading(false)
      }
    }

    void fetchMarketNews()

    return () => controller.abort()
  }, [activeMarketTickerValue, marketTickers, showingAllMarketTickers])

  useEffect(() => {
    if (showingAllMarketTickers || !activeMarketTickerValue) {
      setMomentumPoints([])
      setMomentumError('')
      setMomentumLoading(false)
      return
    }

    const controller = new AbortController()
    setMomentumLoading(true)
    setMomentumError('')

    async function fetchMomentum() {
      try {
        const params = new URLSearchParams({
          query: activeMarketTickerValue,
          days: '30',
        })
        const response = await fetch(`/api/market/momentum?${params}`, {
          signal: controller.signal,
        })
        const body = await response.json()

        if (!response.ok) {
          throw new Error(body.error || 'Unable to fetch momentum timeline.')
        }

        setMomentumPoints(Array.isArray(body.points) ? body.points : [])
      } catch (fetchError) {
        if (controller.signal.aborted) return
        setMomentumPoints([])
        setMomentumError(fetchError instanceof Error ? fetchError.message : 'Unable to fetch momentum timeline.')
      } finally {
        if (!controller.signal.aborted) setMomentumLoading(false)
      }
    }

    void fetchMomentum()

    return () => controller.abort()
  }, [activeMarketTickerValue, showingAllMarketTickers])

  useEffect(() => {
    const controller = new AbortController()
    setSocialLoading(true)
    setSocialError('')

    async function fetchSocialPosts() {
      try {
        const params = new URLSearchParams({
          query: socialQuery,
          limit: '20',
        })
        const response = await fetch(`/api/social/x?${params}`, {
          signal: controller.signal,
        })
        const body = await response.json()

        if (!response.ok) {
          throw new Error(body.error || 'Unable to fetch X posts.')
        }

        setSocialPosts(Array.isArray(body.posts) ? body.posts : [])
        if (body.configured === false) {
          setSocialError(body.message || 'Add X_BEARER_TOKEN to show live posts.')
        }
      } catch (fetchError) {
        if (controller.signal.aborted) return
        setSocialPosts([])
        setSocialError(fetchError instanceof Error ? fetchError.message : 'Unable to fetch X posts.')
      } finally {
        if (!controller.signal.aborted) setSocialLoading(false)
      }
    }

    void fetchSocialPosts()

    return () => controller.abort()
  }, [socialQuery])

  useEffect(() => {
    if (!clientMode) return

    setActiveSource('supabase')
    setSavedMode(true)
    setData(null)
    setSelectedId(null)
    void fetchSavedArticles()
  }, [clientMode])

  useEffect(() => {
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
    setNewTicker('')
    setNewTopic('')
    setEditingTickerIndex(null)
    setArticleEditMode(false)
  }, [enrichedTickers, selectedArticle])

  useEffect(() => {
    previewWidthRef.current = previewWidth
    window.localStorage.setItem('newslabs-preview-width', String(previewWidth))
  }, [previewWidth])

  useEffect(() => {
    clientLatestWidthRef.current = clientLatestWidth
    window.localStorage.setItem('newslabs-client-latest-width', String(clientLatestWidth))
  }, [clientLatestWidth])

  useEffect(() => {
    clientStoryWidthRef.current = clientStoryWidth
    window.localStorage.setItem('newslabs-client-story-width', String(clientStoryWidth))
  }, [clientStoryWidth])

  useEffect(() => {
    clientTickerWidthRef.current = clientTickerWidth
    window.localStorage.setItem('newslabs-client-ticker-width', String(clientTickerWidth))
  }, [clientTickerWidth])

  useEffect(() => {
    clientCommentsWidthRef.current = clientCommentsWidth
    window.localStorage.setItem('newslabs-client-comments-width', String(clientCommentsWidth))
  }, [clientCommentsWidth])

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

  function startPreviewResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    resizeStartRef.current = {
      startX: event.clientX,
      startWidth: previewWidthRef.current,
    }
    setIsResizingPreview(true)
  }

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

      if (clientResizeTarget === 'comments') {
        setClientCommentsWidth(clamp(clientResizeStartRef.current.startWidth - delta, 300, 520))
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

  function startClientColumnResize(target: 'latest' | 'story' | 'tickers' | 'comments', event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    clientResizeStartRef.current = {
      startX: event.clientX,
      startWidth:
        target === 'latest'
          ? clientLatestWidthRef.current
          : target === 'story'
            ? clientStoryWidthRef.current
            : target === 'tickers'
              ? clientTickerWidthRef.current
              : clientCommentsWidthRef.current,
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
    limitRef.current = limit
  }, [limit])

  useEffect(() => {
    void refreshSavedArticleIndex()
  }, [])

  const fetchNews = useCallback(async (nextProvider: ProviderId, queryOverride?: string) => {
    setLoading(true)
    setError('')
    setSaveMessage('')

    try {
      const effectiveQuery = (queryOverride ?? queryRef.current.trim()) || dashboardCategoryById(activeDashboardCategoryRef.current).query
      const params = new URLSearchParams({
        query: effectiveQuery,
        limit: String(limitRef.current),
      })
      const response = await fetch(`/api/providers/${nextProvider}/news?${params}`)
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body.error || 'Unable to fetch provider news.')
      }

      setActiveSource(nextProvider)
      setSavedMode(false)
      setData(body)
      setSelectedId(body.articles?.[0]?.id ?? null)
    } catch (fetchError) {
      setData(null)
      setSelectedId(null)
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to fetch provider news.')
    } finally {
      setLoading(false)
    }
  }, [])

  async function fetchSavedArticles() {
    setLoading(true)
    setError('')
    setSaveMessage('')

    try {
      const params = new URLSearchParams({
        limit: String(Math.max(limitRef.current, 50)),
      })
      const response = await fetch(`/api/articles/saved?${params}`)
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body.error || 'Unable to fetch saved Supabase articles.')
      }

      setActiveSource('supabase')
      setSavedMode(true)
      setData(body)
      setSelectedId(body.articles?.[0]?.id ?? null)
      const nextIndex: Record<string, NewsArticle> = {}
      if (Array.isArray(body.articles)) {
        body.articles.forEach((article: NewsArticle) => {
          const key = articleStorageKey(article)
          if (key) nextIndex[key] = article
        })
      }
      setSavedArticleIndex(nextIndex)
    } catch (fetchError) {
      setData(null)
      setSelectedId(null)
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to fetch saved Supabase articles.')
    } finally {
      setLoading(false)
    }
  }

  async function refreshSavedArticleIndex() {
    try {
      const params = new URLSearchParams({
        limit: '500',
      })
      const response = await fetch(`/api/articles/saved?${params}`)
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
    setSaveMessage('')

    try {
      const response = await fetch('/api/articles/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ article: editedArticleDraft(selectedArticle) }),
      })
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body.error || 'Unable to save article.')
      }

      setSaveMessage('Saved to Supabase.')
      await refreshSavedArticleIndex()
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : 'Unable to save article.')
    } finally {
      setSaving(false)
    }
  }

  async function updateSavedArticle() {
    if (!selectedArticle?.savedRowId) return
    if (!editDirty) return

    setSaving(true)
    setSaveMessage('')

    const article = editedArticleDraft(selectedArticle)

    try {
      const response = await fetch(`/api/articles/saved/${selectedArticle.savedRowId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ article }),
      })
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body.error || 'Unable to update saved article.')
      }

      setData((current) => {
        if (!current) return current
        return {
          ...current,
          articles: current.articles.map((item) => (item.id === body.article.id ? body.article : item)),
        }
      })
      setSelectedId(body.article.id)
      setSaveMessage('Saved changes to Supabase.')
      await refreshSavedArticleIndex()
    } catch (saveError) {
      setSaveMessage(saveError instanceof Error ? saveError.message : 'Unable to update saved article.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteSavedArticle(savedRowId = selectedArticle?.savedRowId) {
    if (!savedRowId) return
    const shouldDelete = window.confirm('Delete this saved Supabase article?')
    if (!shouldDelete) return

    setSaving(true)
    setSaveMessage('')

    try {
      const response = await fetch(`/api/articles/saved/${savedRowId}`, {
        method: 'DELETE',
      })
      const body = await response.json()

      if (!response.ok) {
        throw new Error(body.error || 'Unable to delete saved article.')
      }

      if (savedMode) {
        setData((current) => {
          if (!current) return current
          const articles = current.articles.filter((item) => item.savedRowId !== savedRowId)
          setSelectedId(articles[0]?.id ?? null)
          return {
            ...current,
            count: articles.length,
            articles,
          }
        })
      }
      setSaveMessage('Deleted from Supabase.')
      await refreshSavedArticleIndex()
    } catch (deleteError) {
      setSaveMessage(deleteError instanceof Error ? deleteError.message : 'Unable to delete saved article.')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (clientMode) return

    if (activeSource !== 'supabase') {
      void fetchNews(activeSource)
    }
  }, [activeSource, clientMode, fetchNews])

  function handleSourceChange(value: string) {
    const nextSource = value as SourceTabId
    if (nextSource === 'supabase') {
      void fetchSavedArticles()
      return
    }

    setActiveSource(nextSource)
  }

  function handleDashboardCategoryChange(id: DashboardCategoryId) {
    const category = dashboardCategoryById(id)
    const nextSource = activeSource === 'supabase' ? 'polygon' : activeSource

    setActiveDashboardCategory(id)
    setQuery('')
    setActiveSource(nextSource)
    void fetchNews(nextSource, category.query)
  }

  function addTicker() {
    const ticker = normalizeTicker(newTicker)
    if (!ticker) return

    setEditForm((current) => ({
      ...current,
      tickers: [...current.tickers, tickerFormFromSymbol(ticker)],
    }))
    setNewTicker('')
  }

  function updateTickerField(index: number, field: keyof EditTickerForm, value: string) {
    setEditForm((current) => ({
      ...current,
      tickers: current.tickers.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    }))
  }

  function commitTickerEdit() {
    setEditForm((current) => ({
      ...current,
      tickers: Array.from(
        new Map(current.tickers.filter((ticker) => composeTickerSymbol(ticker)).map((ticker) => [composeTickerSymbol(ticker), ticker])).values(),
      ),
    }))
    setEditingTickerIndex(null)
  }

  function removeTicker(index: number) {
    setEditForm((current) => ({
      ...current,
      tickers: current.tickers.filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  function addTopic() {
    const topic = newTopic.trim()
    if (!topic) return

    setEditForm((current) => ({
      ...current,
      topics: uniqueTextList([...current.topics, topic]),
    }))
    setNewTopic('')
  }

  function removeTopic(topic: string) {
    setEditForm((current) => ({
      ...current,
      topics: current.topics.filter((item) => item !== topic),
    }))
  }

  function toggleClientBookmark() {
    if (!selectedArticle) return

    setBookmarkedArticleIds((current) => {
      const next = new Set(current)
      if (next.has(selectedArticle.id)) {
        next.delete(selectedArticle.id)
        setSaveMessage('Removed from Saved.')
      } else {
        next.add(selectedArticle.id)
        setSaveMessage('Saved to your client bookmarks.')
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
        setSaveMessage('Removed from Liked.')
      } else {
        next.add(selectedArticle.id)
        setSaveMessage('Added to Liked.')
      }
      return next
    })
  }

  function reportClientArticle() {
    if (!selectedArticle) return

    setReportedArticleIds((current) => {
      const next = new Set(current)
      if (next.has(selectedArticle.id)) next.delete(selectedArticle.id)
      else next.add(selectedArticle.id)
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
      setSaveMessage('Article link copied.')
    } catch {
      setSaveMessage('Unable to share this article.')
    }
  }

  function submitLocalComment() {
    const text = commentDraft.trim()
    if (!text) return

    const comment: LocalComment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      createdAt: new Date().toISOString(),
    }

    setLocalCommentsByKey((current) => ({
      ...current,
      [commentsKey]: [comment, ...(current[commentsKey] ?? [])],
    }))
    setCommentDraft('')
  }

  function openSelectedArticleAi() {
    if (!selectedArticle) return
    window.open(articleAiUrl(selectedArticle, enrichedTickers, enrichedTopics, aiDestination), '_blank', 'noopener,noreferrer')
  }

  shortcutActionsRef.current = {
    bookmark: toggleClientBookmark,
    like: toggleClientLike,
    save: () => {
      void saveSelectedArticle()
    },
    update: () => {
      void updateSavedArticle()
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

        if (state.savedMode) {
          if (state.editDirty) actions.update()
          else setSaveMessage('No changes to save.')
          return
        }

        actions.save()
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

  function renderTickerCards({ compact = false }: { compact?: boolean } = {}) {
    return (
      <div className={cn('grid gap-2', !compact && 'md:grid-cols-2')}>
        {enrichedTickers.length ? (
          enrichedTickers.map((ticker) => {
            const metadata = tickerMetadata(ticker.ticker)
            const marketTicker = resolveMarketTicker(ticker.ticker)
            const isActiveTicker = activeMarketTicker !== 'all' && displayTicker(activeMarketTicker) === displayTicker(marketTicker)

            return (
            <div
              key={ticker.ticker}
              className={cn(
                'relative cursor-pointer rounded-md border bg-muted/20 p-2 transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActiveTicker && !showNormalizedJson && 'border-primary bg-muted/60',
              )}
              role="button"
              tabIndex={0}
              onClick={() => {
                setActiveMarketTicker(marketTicker)
                setShowNormalizedJson(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setActiveMarketTicker(marketTicker)
                  setShowNormalizedJson(false)
                }
              }}
            >
              <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
                <Button
                  asChild
                  aria-label={`Open ${displayTicker(ticker.ticker)} on X`}
                  className="bg-background/90 px-2 shadow-sm backdrop-blur hover:bg-background"
                  size="xs"
                  title={`Open ${displayTicker(ticker.ticker)} on X`}
                  variant="outline"
                >
                  <a
                    href={xSearchUrl(socialQueryForTickers([ticker.ticker]))}
                    onClick={(event) => event.stopPropagation()}
                    rel="noreferrer"
                    target="_blank"
                  >
                    X
                  </a>
                </Button>
                <Button
                  asChild
                  aria-label={`Trade ${displayTicker(ticker.ticker)} on ${destinationLabel(tradeDestinations, tradeDestination)}`}
                  className="bg-background/90 px-2 shadow-sm backdrop-blur hover:bg-background"
                  size="xs"
                  title={`Trade ${displayTicker(ticker.ticker)} on ${destinationLabel(tradeDestinations, tradeDestination)}`}
                  variant="outline"
                >
                  <a
                    href={tradeDestinationUrl(ticker.ticker, tradeDestination)}
                    onClick={(event) => event.stopPropagation()}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink />
                    Trade
                  </a>
                </Button>
              </div>
              <div className="pr-32">
                {metadata ? (
                  <div className="rounded-md bg-background/80 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold tracking-normal text-foreground">{displayTicker(ticker.ticker)}</div>
                      <Badge variant="outline">{metadata.type}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{metadata.name}</span>
                    </div>
                  </div>
                ) : (
                  <div className="[&_iframe]:pointer-events-none">
                    <TradingViewTickerTag theme={theme} ticker={ticker.ticker} />
                  </div>
                )}
              </div>
              <p className="mt-2 w-full text-sm leading-6 text-muted-foreground">
                {ticker.reason || 'No ticker reason supplied.'}
              </p>
              {(ticker.sentimentScore || ticker.relevance) ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {ticker.sentimentScore ? <Badge variant="outline">Score {ticker.sentimentScore}</Badge> : null}
                  {ticker.relevance ? <Badge variant="outline">Rel {ticker.relevance}</Badge> : null}
                </div>
              ) : null}
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
                  Intelligence by {selectedArticle?.providerLabel || 'provider'}
                </div>
                {ticker.sentimentLabel ? (
                  <SentimentCornerBadge label={ticker.sentimentLabel} />
                ) : null}
              </div>
            </div>
            )
          })
        ) : (
          <span className="text-sm text-muted-foreground">No tickers</span>
        )}
      </div>
    )
  }

  function renderSettingsMenu() {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Settings" size="icon" variant="outline">
            <Settings />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Settings</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="flex items-center justify-between gap-3 px-2 py-2">
            <Label htmlFor="theme-toggle" className="text-sm">
              Dark theme
            </Label>
            <Switch
              id="theme-toggle"
              checked={theme === 'dark'}
              onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
            />
          </div>
          <div className="flex items-center justify-between gap-3 px-2 py-2">
            <Label htmlFor="client-mode-toggle" className="text-sm">
              Client mode
            </Label>
            <Switch
              id="client-mode-toggle"
              checked={clientMode}
              onCheckedChange={setClientModeRoute}
            />
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void fetchSavedArticles()}>
            <Database />
            Open Supabase articles
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function renderMomentumTimeline() {
    const newsByDate = sortNewsByLatest(marketNews)
      .filter((article) => isWithinLastDays(article, 30))
      .reduce<Record<string, NewsArticle[]>>((groups, article) => {
        const key = articleDateKey(article)
        if (!key) return groups
        groups[key] = [...(groups[key] ?? []), article]
        return groups
      }, {})
    const timelineItems = [...momentumPoints]
      .filter((point) => point.changePercent !== null)
      .sort((left, right) => right.date.localeCompare(left.date))

    if (marketNewsLoading || momentumLoading) {
      return (
        <div className="space-y-4 px-4 pb-4 pt-6">
          <h3 className="px-1 text-base font-semibold tracking-normal">Momentum Timeline</h3>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-2 rounded-md bg-card/40 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (marketNewsError || momentumError) {
      return (
        <div className="space-y-4 px-4 pb-4 pt-6">
          <h3 className="px-1 text-base font-semibold tracking-normal">Momentum Timeline</h3>
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Momentum</AlertTitle>
            <AlertDescription>{momentumError || marketNewsError}</AlertDescription>
          </Alert>
        </div>
      )
    }

    if (showingAllMarketTickers) {
      return (
        <div className="space-y-4 px-4 pb-4 pt-6">
          <h3 className="px-1 text-base font-semibold tracking-normal">Momentum Timeline</h3>
          <div className="rounded-lg border bg-muted/10 p-4">
            <div className="text-sm font-medium text-foreground">Pick a ticker to open its 30-day catalyst trail.</div>
            <p className="mt-1 text-sm text-muted-foreground">
              The timeline will map daily close-to-close moves against the headlines and sources that explain momentum.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {marketTickers.slice(0, 8).map((ticker) => (
                <Button
                  key={ticker}
                  className="h-7 px-2 text-xs"
                  onClick={() => setActiveMarketTicker(ticker)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {displayTicker(ticker)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )
    }

    if (!timelineItems.length) {
      return (
        <div className="space-y-4 px-4 pb-4 pt-6">
          <h3 className="px-1 text-base font-semibold tracking-normal">Momentum Timeline</h3>
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">
            No 30-day close-to-close movement data found for this ticker yet.
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-4 px-4 pb-4 pt-6">
        <h3 className="px-1 text-base font-semibold tracking-normal">Momentum Timeline</h3>
        <div className="relative space-y-0 pl-3 before:absolute before:bottom-0 before:left-[4.8rem] before:top-0 before:w-px before:bg-border">
          {timelineItems.map((point) => {
            const articles = newsByDate[point.date] ?? []
            const sources = uniqueSourcesForArticles(articles)
            const isPositive = (point.changePercent ?? 0) >= 0

            return (
              <div key={point.date} className="relative grid grid-cols-[4.25rem_minmax(0,1fr)] gap-5 pb-5">
                <div className="pt-1 text-xs font-semibold text-muted-foreground">{formatTimelineDate(point.date)}</div>
                <div className="relative rounded-md bg-card/25 p-3">
                  <span className="absolute -left-[1.06rem] top-4 size-2.5 rounded-full border border-background bg-foreground" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={cn(
                      isPositive
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300',
                    )} variant="outline">
                      {movementLabel(point.changePercent)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">close-to-close</span>
                  </div>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">
                    {momentumSummaryForArticles(articles, activeMarketTickerValue)}
                  </p>
                  {sources.length ? (
                    <div className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2 py-1">
                      {sources.map((source) => (
                        source.logoUrl ? (
                          <img
                            key={source.name}
                            alt=""
                            className="size-4 rounded-full"
                            loading="lazy"
                            src={source.logoUrl}
                            title={source.name}
                          />
                        ) : (
                          <span key={source.name} className="text-[10px] font-semibold text-muted-foreground">
                            {source.name.slice(0, 2).toUpperCase()}
                          </span>
                        )
                      ))}
                      <span className="truncate text-[11px] font-medium text-muted-foreground">
                        summarized from {sources.map((source) => source.name).join(', ')}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderLinkedMarketNews() {
    const visibleNews = sortNewsByLatest(marketNews)

    return (
      <section className="space-y-3">
        <Separator className="mt-2" />
        <h3 className="text-base font-semibold tracking-normal">Linked News</h3>
        {marketNewsLoading ? (
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
        ) : marketNewsError ? (
          <div className="text-sm text-muted-foreground">{marketNewsError}</div>
        ) : visibleNews.length ? (
          <div className="space-y-3">
            {visibleNews.map((article) => (
              <a
                key={article.id}
                className="flex gap-3 rounded-md p-1 text-card-foreground transition hover:bg-muted/60"
                href={article.url}
                rel="noreferrer"
                target="_blank"
              >
                {cleanArticleImageUrl(article.imageUrl) ? (
                  <img
                    alt=""
                    className="size-10 shrink-0 rounded-full object-cover"
                    loading="lazy"
                    src={cleanArticleImageUrl(article.imageUrl)}
                  />
                ) : (
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                    {displayTicker(article.tickers[0] || activeMarketTickerValue || article.source || 'YF').slice(0, 3)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium leading-5 tracking-normal">{article.title}</div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{formatRelativeTime(article.publishedAt)}</span>
                    <span aria-hidden="true" className="text-muted-foreground/70">•</span>
                    <span className="min-w-0 truncate font-medium">{article.source || 'Yahoo Finance'}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No linked market news yet.</div>
        )}
      </section>
    )
  }

  function renderMarketPanel({
    className,
    scrollClassName,
  }: {
    className?: string
    scrollClassName?: string
  } = {}) {
    return (
      <Card className={cn('min-h-[520px] overflow-hidden border-0 bg-transparent shadow-none xl:h-full', className)}>
        <CardHeader className="gap-2 px-3 pt-0 sm:px-3">
          <CardTitle className="text-base">Market</CardTitle>
          <div className="flex flex-wrap gap-1">
            <Button
              className={cn(
                'h-7 bg-transparent px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground',
                activeMarketTicker === 'all' && 'font-semibold text-foreground',
              )}
              disabled={marketTickers.length < 2}
              onClick={() => setActiveMarketTicker('all')}
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
                  'h-7 bg-transparent px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground',
                  activeMarketTicker === ticker && 'font-semibold text-foreground',
                )}
                onClick={() => setActiveMarketTicker(ticker)}
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
        <CardContent className="p-0">
          <ScrollArea className={cn('min-h-[430px]', scrollClassName)}>
            <div className="space-y-4">
              {!activeMarketTickerValue ? (
                <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                  This article has no tickers.
                </div>
              ) : showingAllMarketTickers && marketTickers.length > 1 ? (
                <div className="relative px-4">
                  <Button
                    asChild
                    aria-label={`Open ${displayTicker(activeMarketTickerValue)} on TradingView`}
                    className="absolute right-6 top-2 z-10 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
                    size="icon-sm"
                    title={`Open ${displayTicker(activeMarketTickerValue)} on TradingView`}
                    variant="outline"
                  >
                    <a href={tradingViewSymbolPageUrl(activeMarketTickerValue)} rel="noreferrer" target="_blank">
                      <ExternalLink />
                    </a>
                  </Button>
                  <TradingViewComparisonChart
                    compareTickers={marketTickers}
                    height={480}
                    theme={theme}
                    ticker={activeMarketTickerValue}
                  />
                </div>
              ) : (
                <div className="relative px-4">
                  <Button
                    asChild
                    aria-label={`Open ${displayTicker(activeMarketTickerValue)} on TradingView`}
                    className="absolute right-6 top-2 z-10 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
                    size="icon-sm"
                    title={`Open ${displayTicker(activeMarketTickerValue)} on TradingView`}
                    variant="outline"
                  >
                    <a href={tradingViewSymbolPageUrl(activeMarketTickerValue)} rel="noreferrer" target="_blank">
                      <ExternalLink />
                    </a>
                  </Button>
                  <TradingViewSymbolOverview
                    height={390}
                    theme={theme}
                    ticker={activeMarketTickerValue}
                  />
                </div>
              )}
              {renderMomentumTimeline()}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    )
  }

  function renderSocialPanel() {
    return (
      <Card
        className="min-h-[520px] overflow-hidden xl:h-full xl:w-[var(--client-comments-width)] xl:flex-none"
        style={{ '--client-comments-width': `${clientCommentsWidth}px` } as CSSProperties}
      >
        <CardHeader className="gap-2 px-3 pt-0 sm:px-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Comments</CardTitle>
              <CardDescription>
                {showingAllMarketTickers ? 'All linked tickers' : displayTicker(activeMarketTickerValue || '')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="min-h-[430px] xl:h-[calc(100svh-208px)]">
            <div className="flex min-h-[430px] flex-col gap-3 p-4 pt-0 xl:min-h-[calc(100svh-208px)]">
              <div className="space-y-3">
                {localComments.map((comment) => (
                  <div key={comment.id} className="rounded-lg border bg-card p-3 text-card-foreground">
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">You</span>
                      <span>{formatRelativeTime(comment.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-sm leading-5">{comment.text}</p>
                  </div>
                ))}
              </div>

              {socialLoading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="space-y-2 rounded-lg border p-3">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                ))
              ) : socialPosts.length ? (
                <div className="space-y-3">
                  {socialPosts.map((post) => (
                    <a
                      key={post.id}
                      className="block rounded-lg border bg-card p-3 text-card-foreground transition hover:bg-muted/60"
                      href={post.url || xSearchUrl(socialQuery)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate font-medium text-foreground">
                          {post.authorName || post.username || 'Live comment'}
                        </span>
                        <span>{formatRelativeTime(post.createdAt)}</span>
                      </div>
                      {post.username ? <div className="mt-0.5 text-xs text-muted-foreground">@{post.username}</div> : null}
                      <p className="mt-2 line-clamp-5 text-sm leading-5">{post.text}</p>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border p-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <MessageCircle className="size-4" />
                    Live comments
                  </div>
                  <p>{socialError && !socialError.includes('X_BEARER_TOKEN') ? socialError : 'No live comments yet.'}</p>
                </div>
              )}
              <div className="mt-auto flex items-center gap-2 border-t pt-3">
                <Input
                  aria-label="Add comment"
                  placeholder="Add a comment"
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submitLocalComment()
                    }
                  }}
                />
                <Button disabled={!commentDraft.trim()} onClick={submitLocalComment} type="button">
                  Send
                </Button>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    )
  }

  if (clientMode) {
    return (
      <main className="min-h-svh overflow-x-hidden bg-background text-foreground">
        <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
          <div className="flex w-full flex-col gap-3 px-4 py-3 sm:px-6">
            <div className="grid gap-3 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-normal">NewsLabs</h1>
              </div>
              <nav aria-label="News categories" className="flex flex-wrap items-center justify-center gap-1 sm:gap-3">
                {clientTopCategories.map((category) => (
                  <Button
                    key={category.id}
                    className={cn(
                      'bg-transparent px-2 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground',
                      activeClientCategory === category.id && 'font-semibold text-foreground',
                    )}
                    onClick={() => {
                      setClientProfilePanelOpen(false)
                      setActiveClientCategory(category.id)
                      setActiveClientRailView('latest')
                      setQuery('')
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {category.label}
                  </Button>
                ))}
              </nav>
              <div />
            </div>
          </div>
        </header>

        <section className="flex w-full flex-col gap-4 px-4 py-4 pb-9 sm:px-6 xl:h-[calc(100svh-78px)] xl:flex-row xl:overflow-hidden">
          <aside className="relative z-50 min-h-[520px] w-16 shrink-0 xl:h-full">
            <div className="group absolute inset-y-0 left-0 flex w-16 flex-col gap-2 overflow-hidden rounded-lg border bg-card/95 p-2 text-card-foreground shadow-sm transition-all duration-200 hover:w-56">
              {[
                { id: 'latest' as const, label: 'Latest', icon: CalendarClock },
                { id: 'search' as const, label: 'Search', icon: Search },
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
                      activeClientRailView === item.id && 'bg-muted text-foreground',
                    )}
                    onClick={() => setClientRailView(item.id)}
                    title={item.label}
                    type="button"
                    variant="ghost"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span
                      className="w-0 overflow-hidden whitespace-nowrap text-sm opacity-0 transition-all group-hover:w-32 group-hover:opacity-100"
                    >
                      {item.label}
                    </span>
                  </Button>
                )
              })}

              <div className="mt-auto">
                <Button
                  aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                  className="h-10 w-full justify-start gap-3 overflow-hidden px-2"
                  title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
                  type="button"
                  variant="ghost"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
                  <span
                    className="w-0 overflow-hidden whitespace-nowrap text-sm opacity-0 transition-all group-hover:w-32 group-hover:opacity-100"
                  >
                    {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                  </span>
                </Button>
                <Button
                  aria-label="Profile"
                  className={cn(
                    'h-10 w-full justify-start gap-3 overflow-hidden px-2',
                    clientProfilePanelOpen && 'bg-muted text-foreground',
                  )}
                  title="Profile"
                  type="button"
                  variant="ghost"
                  onClick={() => setClientProfilePanelOpen(true)}
                >
                  <CircleUserRound className="size-4 shrink-0" />
                  <span
                    className="w-0 overflow-hidden whitespace-nowrap text-sm opacity-0 transition-all group-hover:w-32 group-hover:opacity-100"
                  >
                    Profile
                  </span>
                </Button>
              </div>
            </div>
          </aside>

          <Card
            className="min-h-[520px] overflow-hidden xl:h-full xl:w-[var(--client-latest-width)] xl:flex-none"
            style={{ '--client-latest-width': `${clientLatestWidth}px` } as CSSProperties}
          >
            <CardHeader className="gap-1">
              <CardTitle className="text-base">
                {clientProfilePanelOpen ? 'Profile' : activeClientRailView === 'search' ? 'Search' : activeClientRailView === 'bookmarks' ? 'Saved' : activeClientRailView === 'liked' ? 'Liked' : activeClientRailView === 'reported' ? 'Reported' : 'Latest'}
              </CardTitle>
              {!clientProfilePanelOpen && activeClientRailView === 'search' ? (
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
            <CardContent className="p-0">
              {clientProfilePanelOpen ? (
                <ScrollArea className="min-h-[430px] xl:h-[calc(100svh-208px)]">
                  <div className="space-y-5 p-4 pt-0">
                    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/15 p-3">
                      <div>
                        <div className="text-sm font-medium">Client mode</div>
                        <div className="text-xs text-muted-foreground">Show saved Supabase articles.</div>
                      </div>
                      <Switch
                        id="client-panel-mode-toggle"
                        checked={clientMode}
                        onCheckedChange={(checked) => {
                          setClientModeRoute(checked)
                          setClientProfilePanelOpen(false)
                        }}
                      />
                    </div>

                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">AI opens in</div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {aiDestinations.map((destination) => (
                          <Button
                            key={destination.id}
                            className="justify-between"
                            onClick={() => {
                              setAiDestination(destination.id)
                              setClientProfilePanelOpen(false)
                            }}
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

                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">Trade opens in</div>
                      <div className="mt-2 grid grid-cols-1 gap-2">
                        {tradeDestinations.map((destination) => (
                          <Button
                            key={destination.id}
                            className="justify-between"
                            onClick={() => {
                              setTradeDestination(destination.id)
                              setClientProfilePanelOpen(false)
                            }}
                            size="sm"
                            type="button"
                            variant={tradeDestination === destination.id ? 'secondary' : 'outline'}
                          >
                            <span>{destination.label}</span>
                            {tradeDestination === destination.id ? <Check className="size-4" /> : null}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <Button
                      className="w-full justify-start"
                      onClick={() => {
                        void fetchSavedArticles()
                        setClientProfilePanelOpen(false)
                      }}
                      type="button"
                      variant="outline"
                    >
                      <Database />
                      Open Supabase articles
                    </Button>
                    <Button className="w-full" onClick={() => setClientProfilePanelOpen(false)} type="button" variant="ghost">
                      Cancel
                    </Button>
                  </div>
                </ScrollArea>
              ) : (
                <ScrollArea className="min-h-[430px] xl:h-[calc(100svh-208px)]">
                  <div className="space-y-3 p-4 pt-0">
                    {loading ? (
                      Array.from({ length: 7 }).map((_, index) => (
                        <div key={index} className="space-y-2 rounded-lg border p-3">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-full" />
                          <Skeleton className="h-3 w-2/3" />
                        </div>
                      ))
                    ) : clientArticles.length ? (
                      clientArticles.map((article) => (
                        <div
                          key={article.id}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            'w-full cursor-pointer rounded-lg border bg-card p-3 text-left text-card-foreground transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            selectedArticle?.id === article.id && 'border-primary bg-muted',
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
                              <h2 className="line-clamp-2 text-sm font-medium tracking-normal">{article.title}</h2>
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{article.summary || article.source}</p>
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
                              {article.tickers.slice(0, 4).map((ticker) => (
                                <Badge key={ticker} variant="secondary">
                                  {displayTicker(ticker)}
                                </Badge>
                              ))}
                            </div>
                            <span className="shrink-0 text-right text-[11px] font-medium text-muted-foreground">
                              {formatRelativeTime(article.publishedAt)}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                        No articles match this category yet.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {loading ? (
            <div className="flex min-h-[520px] min-w-0 flex-1 items-center justify-center xl:h-full">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
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
                  <CardTitle className="text-base">Story</CardTitle>
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
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {error ? (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>Request failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : selectedArticle ? (
                <ScrollArea className="min-h-[408px] pr-3 xl:h-[calc(100svh-222px)]">
                  <article className="space-y-4 pb-10">
                    <div className="space-y-3">
                      <h2 className="text-2xl font-semibold leading-tight tracking-normal">{selectedArticle.title}</h2>
                      <Separator />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm text-muted-foreground">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2">
                          <CalendarClock className="size-4" />
                          <span>{formatRelativeTime(selectedArticle.publishedAt)}</span>
                        </span>
                        <span aria-hidden="true" className="text-muted-foreground/70">•</span>
                        {selectedArticle.url ? (
                          <a
                            className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                            href={selectedArticle.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {publisherLogoUrl ? (
                              <img alt="" className="size-5 rounded border bg-background object-contain" src={publisherLogoUrl} />
                            ) : null}
                            <span>{selectedArticle.source || activeLabel}</span>
                          </a>
                        ) : (
                          <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                            {publisherLogoUrl ? (
                              <img alt="" className="size-5 rounded border bg-background object-contain" src={publisherLogoUrl} />
                            ) : null}
                            <span>{selectedArticle.source || activeLabel}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    {cleanArticleImageUrl(selectedArticle.imageUrl) ? (
                      <img
                        alt=""
                        className="aspect-video w-full rounded-lg border object-cover"
                        src={cleanArticleImageUrl(selectedArticle.imageUrl)}
                      />
                    ) : null}
                    <p className="text-sm leading-6 text-muted-foreground">
                      {selectedArticle.summary || 'No summary was provided by this source.'}
                    </p>
                    <div className="text-xs font-medium text-muted-foreground">
                      By {selectedArticle.author || selectedArticle.source || activeLabel}
                    </div>
                    {renderLinkedMarketNews()}
                    {saveMessage ? (
                      <Alert>
                        <Bell />
                        <AlertTitle>Action</AlertTitle>
                        <AlertDescription>{saveMessage}</AlertDescription>
                      </Alert>
                    ) : null}
                  </article>
                </ScrollArea>
              ) : (
                <div className="rounded-lg border p-4 text-sm text-muted-foreground">
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
              <CardTitle className="text-base">Tickers</CardTitle>
              <CardDescription>{selectedArticle ? `${selectedArticle.tickers.length} linked symbols` : 'Select a story'}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="min-h-[430px] xl:h-[calc(100svh-208px)]">
                <div className="p-4 pt-0">
                  {renderTickerCards({ compact: true })}
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

          {renderMarketPanel({ className: 'min-w-0 xl:flex-1', scrollClassName: 'xl:h-[calc(100svh-208px)]' })}
          <Button
            aria-label="Resize comments column"
            className={cn(
              'hidden h-full w-5 cursor-col-resize rounded-md border border-dashed bg-muted/30 px-0 text-muted-foreground hover:bg-muted hover:text-foreground xl:flex',
              clientResizeTarget === 'comments' && 'border-primary bg-muted text-foreground',
            )}
            size="icon"
            title="Drag to resize comments"
            type="button"
            variant="ghost"
            onDoubleClick={() => setClientCommentsWidth(360)}
            onPointerDown={(event) => startClientColumnResize('comments', event)}
          >
            <GripVertical className="size-4" />
          </Button>
          {renderSocialPanel()}
            </>
          )}
        </section>
        <div className="fixed bottom-3 left-1/2 z-30 -translate-x-1/2 text-center text-[11px] text-muted-foreground">
          ↑/↓ or ←/→ move news
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-svh overflow-x-hidden bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="flex w-full flex-col gap-3 px-4 py-3 sm:px-6">
          <div className="grid gap-3 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-normal">NewsLabs</h1>
              <p className="text-sm text-muted-foreground">
                Market news dashboard
              </p>
            </div>

            <nav aria-label="Dashboard categories" className="flex flex-wrap items-center justify-center gap-1 sm:gap-2">
              {dashboardCategories.map((category) => (
                <Button
                  key={category.id}
                  className={cn(
                    'h-8 bg-transparent px-2 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground',
                    activeDashboardCategory === category.id && 'font-semibold text-foreground',
                  )}
                  onClick={() => handleDashboardCategoryChange(category.id)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {category.label}
                </Button>
              ))}
            </nav>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end">
              <Tabs value={activeSource} onValueChange={handleSourceChange}>
                <TabsList
                  variant="line"
                  className="flex h-auto w-full flex-wrap items-center gap-4 overflow-hidden rounded-none bg-transparent p-0 sm:w-auto"
                >
                  {sourceTabs.map((item) => (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      className="h-8 flex-none rounded-none bg-transparent px-0 py-1.5 text-center leading-none text-muted-foreground shadow-none after:hidden data-active:bg-transparent data-active:font-semibold data-active:text-foreground data-active:shadow-none dark:data-active:bg-transparent"
                    >
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <div className="flex items-center gap-2">
                {renderSettingsMenu()}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative w-full lg:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label="Ticker or query"
                className="pl-8"
                placeholder="Ticker or query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    if (activeSource === 'supabase') void fetchSavedArticles()
                    else void fetchNews(activeSource)
                  }
                }}
              />
            </div>

            <Input
              aria-label="Article limit"
              className="w-full lg:w-28"
              min={1}
              max={50}
              type="number"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            />

            <Button
              onClick={() => {
                if (activeSource === 'supabase') void fetchSavedArticles()
                else void fetchNews(activeSource)
              }}
              disabled={loading}
            >
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>

            <div className="text-sm text-muted-foreground">
              {activeHint}
              {data ? ` • ${data.count} articles` : ''}
            </div>
          </div>
        </div>
      </header>

      <section className="flex w-full flex-col gap-4 px-4 py-4 sm:px-6 xl:h-[calc(100svh-120px)] xl:flex-row xl:overflow-hidden">
        <Card className="min-h-[520px] overflow-hidden xl:h-full xl:w-[390px] xl:flex-none">
          <CardHeader className="gap-1">
            <CardTitle className="text-base">Fetched News</CardTitle>
            <CardDescription>{activeLabel}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="min-h-[430px] xl:h-[calc(100svh-212px)]">
              <div className="space-y-3 p-4 pt-0">
                {loading ? (
                  Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="space-y-2 rounded-lg border p-3">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  ))
                ) : data?.articles.length ? (
                  data.articles.map((article) => (
                    <div
                      key={article.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        'w-full cursor-pointer rounded-lg border bg-card p-3 text-left text-card-foreground transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selectedArticle?.id === article.id && 'border-primary bg-muted',
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
                          <h2 className="line-clamp-2 text-sm font-medium tracking-normal">{article.title}</h2>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{article.summary || article.source}</p>
                        </div>
                        {cleanArticleImageUrl(article.imageUrl) ? (
                          <img
                            alt=""
                            className="size-16 rounded-md border object-cover"
                            loading="lazy"
                            src={cleanArticleImageUrl(article.imageUrl)}
                          />
                        ) : (
                          <div className="flex size-16 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                            News
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap gap-1">
                          {article.tickers.slice(0, 4).map((ticker) => (
                            <TickerLinkBadge key={ticker} ticker={ticker} />
                          ))}
                          {article.sentimentLabel ? <SentimentBadge label={article.sentimentLabel} /> : null}
                        </div>
                        <span className="shrink-0 text-right text-[11px] font-medium text-muted-foreground">
                          {formatRelativeTime(article.publishedAt)}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                    No articles loaded yet.
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card
          className="min-h-[520px] min-w-0 overflow-hidden xl:h-full xl:w-[var(--preview-width)] xl:flex-none"
          style={{ '--preview-width': `${previewWidth}px` } as CSSProperties}
        >
          <CardHeader className="gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base">Article Preview</CardTitle>
              </div>
              {isSavedArticleSelected ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    onClick={openSelectedArticleAi}
                    disabled={!selectedArticle}
                    title={`Open story in ${destinationLabel(aiDestinations, aiDestination)}`}
                    variant="outline"
                  >
                    <Sparkles />
                    AI
                  </Button>
                  <Button
                    onClick={() => setArticleEditMode((current) => !current)}
                    variant={articleEditMode ? 'secondary' : 'outline'}
                  >
                    <Pencil />
                    {articleEditMode ? 'Preview' : 'Edit'}
                  </Button>
                  <Button onClick={() => setShowNormalizedJson((current) => !current)} variant="outline">
                    <FileJson />
                    {showNormalizedJson ? 'Market' : 'Normalized JSON'}
                  </Button>
                  <Button onClick={() => void updateSavedArticle()} disabled={saving || !editDirty}>
                    {saving ? <Loader2 className="animate-spin" /> : <Save />}
                    Save
                  </Button>
                  <Button variant="destructive" onClick={() => void deleteSavedArticle()} disabled={saving}>
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    onClick={openSelectedArticleAi}
                    disabled={!selectedArticle}
                    title={`Open story in ${destinationLabel(aiDestinations, aiDestination)}`}
                    variant="outline"
                  >
                    <Sparkles />
                    AI
                  </Button>
                  <Button
                    onClick={() => setArticleEditMode((current) => !current)}
                    disabled={!selectedArticle}
                    variant={articleEditMode ? 'secondary' : 'outline'}
                  >
                    <Pencil />
                    {articleEditMode ? 'Preview' : 'Edit'}
                  </Button>
                  <Button onClick={() => setShowNormalizedJson((current) => !current)} variant="outline">
                    <FileJson />
                    {showNormalizedJson ? 'Market' : 'Normalized JSON'}
                  </Button>
                  {selectedSavedMatch?.savedRowId ? (
                    <Button
                      onClick={() => void deleteSavedArticle(selectedSavedMatch.savedRowId)}
                      disabled={saving}
                      variant="destructive"
                    >
                      {saving ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      Delete from Supabase
                    </Button>
                  ) : (
                    <Button onClick={() => void saveSelectedArticle()} disabled={!selectedArticle || saving}>
                      {saving ? <Loader2 className="animate-spin" /> : <Database />}
                      Save to Supabase
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {error ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Provider request failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : selectedArticle ? (
              <ScrollArea className="min-h-[408px] pr-3 xl:h-[calc(100svh-234px)]">
                <article className="space-y-4 pb-10">
                  <div className="space-y-3">
                    <h2 className="text-2xl font-semibold leading-tight tracking-normal">{selectedArticle.title}</h2>
                    <Separator />
                  </div>
                  {cleanArticleImageUrl(selectedArticle.imageUrl) ? (
                    <img
                      alt=""
                      className="aspect-video w-full rounded-lg border object-cover"
                      src={cleanArticleImageUrl(selectedArticle.imageUrl)}
                    />
                  ) : null}

                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Article Sentiment</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {articleSentiment?.hasProviderSentiment ? (
                        <>
                          {articleSentiment.label ? <SentimentBadge label={articleSentiment.label} /> : null}
                          {articleSentiment.score !== null ? (
                            <Badge variant="outline">Score {articleSentiment.score}</Badge>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">Provider did not supply article-level sentiment.</span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm text-muted-foreground">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2">
                          <CalendarClock className="size-4" />
                          <span>{formatRelativeTime(selectedArticle.publishedAt)}</span>
                        </span>
                        <span aria-hidden="true" className="text-muted-foreground/70">•</span>
                        {selectedArticle.url ? (
                          <a
                            className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                            href={selectedArticle.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {publisherLogoUrl ? (
                              <img
                                alt=""
                                className="size-5 rounded border bg-background object-contain"
                                src={publisherLogoUrl}
                              />
                            ) : null}
                            <span>{selectedArticle.source || activeProvider.label}</span>
                          </a>
                        ) : (
                          <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                            {publisherLogoUrl ? (
                              <img
                                alt=""
                                className="size-5 rounded border bg-background object-contain"
                                src={publisherLogoUrl}
                              />
                            ) : null}
                            <span>{selectedArticle.source || activeProvider.label}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="text-sm leading-6 text-muted-foreground">
                    {selectedArticle.summary || 'No summary was provided by this source.'}
                  </p>
                  <div className="text-xs font-medium text-muted-foreground">
                    By {selectedArticle.author || selectedArticle.source || activeProvider.label}
                  </div>
                  {renderLinkedMarketNews()}
                  {articleEditMode ? (
                    <div className="space-y-3 rounded-lg border bg-muted/15 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium uppercase text-muted-foreground">
                            {isSavedArticleSelected ? 'Edit Saved Article' : 'Edit Article Before Saving'}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {isSavedArticleSelected ? 'Changes save back to Supabase.' : 'Edits are included when you save to Supabase.'}
                          </p>
                        </div>
                        {isSavedArticleSelected ? (
                          <Button size="sm" onClick={() => void updateSavedArticle()} disabled={saving || !editDirty}>
                            {saving ? <Loader2 className="animate-spin" /> : <Save />}
                            Save
                          </Button>
                        ) : selectedSavedMatch?.savedRowId ? (
                          <Button
                            size="sm"
                            onClick={() => void deleteSavedArticle(selectedSavedMatch.savedRowId)}
                            disabled={saving}
                            variant="destructive"
                          >
                            {saving ? <Loader2 className="animate-spin" /> : <Trash2 />}
                            Delete from Supabase
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => void saveSelectedArticle()} disabled={saving || !selectedArticle}>
                            {saving ? <Loader2 className="animate-spin" /> : <Database />}
                            Save to Supabase
                          </Button>
                        )}
                      </div>

                      <div className="grid gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="edit-title">Title</Label>
                          <Input
                            id="edit-title"
                            value={editForm.title}
                            onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor="edit-summary">Summary</Label>
                          <Textarea
                            id="edit-summary"
                            className="min-h-28"
                            value={editForm.summary}
                            onChange={(event) => setEditForm((current) => ({ ...current, summary: event.target.value }))}
                          />
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-source">Source</Label>
                            <Input
                              id="edit-source"
                              value={editForm.source}
                              onChange={(event) => setEditForm((current) => ({ ...current, source: event.target.value }))}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-author">Author</Label>
                            <Input
                              id="edit-author"
                              value={editForm.author}
                              onChange={(event) => setEditForm((current) => ({ ...current, author: event.target.value }))}
                            />
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-url">Article URL</Label>
                            <Input
                              id="edit-url"
                              value={editForm.url}
                              onChange={(event) => setEditForm((current) => ({ ...current, url: event.target.value }))}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-image">Image URL</Label>
                            <Input
                              id="edit-image"
                              value={editForm.imageUrl}
                              onChange={(event) => setEditForm((current) => ({ ...current, imageUrl: event.target.value }))}
                            />
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Tickers</Label>
                            <div className="min-h-9 rounded-lg border bg-background p-2">
                              {editForm.tickers.length ? (
                                <div className="flex flex-wrap gap-2">
                                  {editForm.tickers.map((ticker, index) => (
                                    <span
                                      key={index}
                                      className="inline-flex max-w-full items-start gap-2 rounded-md border bg-muted px-2 py-1 text-xs"
                                    >
                                      {editingTickerIndex === index ? (
                                        <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">
                                          <div className="space-y-1">
                                            <Label className="text-[11px]">Exchange</Label>
                                            <Input
                                              aria-label="Ticker exchange"
                                              className="h-8"
                                              placeholder="NASDAQ"
                                              value={ticker.exchange}
                                              onChange={(event) => updateTickerField(index, 'exchange', event.target.value.toUpperCase())}
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-[11px]">Ticker</Label>
                                            <Input
                                              aria-label="Ticker"
                                              className="h-8"
                                              placeholder="AAPL"
                                              value={ticker.ticker}
                                              onChange={(event) => updateTickerField(index, 'ticker', event.target.value.toUpperCase())}
                                              onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                  event.preventDefault()
                                                  commitTickerEdit()
                                                }
                                              }}
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-[11px]">Sentiment Label</Label>
                                            <Input
                                              className="h-8"
                                              placeholder="neutral"
                                              value={ticker.sentimentLabel}
                                              onChange={(event) => updateTickerField(index, 'sentimentLabel', event.target.value)}
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-[11px]">Sentiment Score</Label>
                                            <Input
                                              className="h-8"
                                              placeholder="0.12"
                                              value={ticker.sentimentScore}
                                              onChange={(event) => updateTickerField(index, 'sentimentScore', event.target.value)}
                                            />
                                          </div>
                                          <div className="space-y-1 md:col-span-2">
                                            <Label className="text-[11px]">Relevance</Label>
                                            <Input
                                              className="h-8"
                                              placeholder="0.87"
                                              value={ticker.relevance}
                                              onChange={(event) => updateTickerField(index, 'relevance', event.target.value)}
                                            />
                                          </div>
                                          <div className="space-y-1 md:col-span-2">
                                            <Label className="text-[11px]">Reason</Label>
                                            <Textarea
                                              className="min-h-20"
                                              placeholder="Why this ticker is connected to this article"
                                              value={ticker.reason}
                                              onChange={(event) => updateTickerField(index, 'reason', event.target.value)}
                                            />
                                          </div>
                                          <div className="md:col-span-2">
                                            <Button size="sm" onClick={commitTickerEdit} type="button" variant="outline">
                                              <Check />
                                              Done
                                            </Button>
                                          </div>
                                        </div>
                                      ) : (
                                        <>
                                          {tickerMetadata(composeTickerSymbol(ticker)) ? (
                                            <div className="w-44 rounded-md bg-background/80 px-2 py-1">
                                              <div className="text-xs font-semibold text-foreground">
                                                {ticker.exchange ? `${ticker.exchange}:` : ''}{displayTicker(ticker.ticker)}
                                              </div>
                                              <div className="line-clamp-1 text-[11px] text-muted-foreground">
                                                {tickerMetadata(composeTickerSymbol(ticker))?.name}
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="w-52">
                                              <div className="[&_iframe]:pointer-events-none">
                                                <TradingViewTickerTag theme={theme} ticker={composeTickerSymbol(ticker)} />
                                              </div>
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {ticker.exchange ? <Badge variant="outline">{ticker.exchange}</Badge> : null}
                                                {ticker.sentimentLabel ? <SentimentBadge label={ticker.sentimentLabel} /> : null}
                                                {ticker.sentimentScore ? <Badge variant="outline">Score {ticker.sentimentScore}</Badge> : null}
                                                {ticker.relevance ? <Badge variant="outline">Rel {ticker.relevance}</Badge> : null}
                                              </div>
                                              {ticker.reason ? (
                                                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{ticker.reason}</p>
                                              ) : null}
                                            </div>
                                          )}
                                          <Button
                                            aria-label={`Edit ${displayTicker(ticker.ticker)}`}
                                            className="size-6"
                                            onClick={() => setEditingTickerIndex(index)}
                                            size="icon-xs"
                                            type="button"
                                            variant="ghost"
                                          >
                                            <Pencil className="size-3" />
                                          </Button>
                                        </>
                                      )}
                                      <Button
                                        aria-label={`Remove ${displayTicker(ticker.ticker)}`}
                                        className="size-6"
                                        onClick={() => removeTicker(index)}
                                        size="icon-xs"
                                        type="button"
                                        variant="ghost"
                                      >
                                        <X className="size-3" />
                                      </Button>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">No tickers yet.</div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Input
                                id="edit-tickers"
                                placeholder="Add ticker"
                                value={newTicker}
                                onChange={(event) => setNewTicker(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    addTicker()
                                  }
                                }}
                              />
                              <Button onClick={addTicker} type="button" variant="outline">
                                <Plus />
                                Add
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Topics</Label>
                            <div className="min-h-9 rounded-lg border bg-background p-2">
                              {editForm.topics.length ? (
                                <div className="flex flex-wrap gap-2">
                                  {editForm.topics.map((topic) => (
                                    <span
                                      key={topic}
                                      className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
                                    >
                                      <Badge variant="outline">{topic}</Badge>
                                      <Button
                                        aria-label={`Remove ${topic}`}
                                        className="size-5"
                                        onClick={() => removeTopic(topic)}
                                        size="icon-xs"
                                        type="button"
                                        variant="ghost"
                                      >
                                        <X className="size-3" />
                                      </Button>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">No topics yet.</div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Input
                                id="edit-topics"
                                placeholder="Add topic"
                                value={newTopic}
                                onChange={(event) => setNewTopic(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    addTopic()
                                  }
                                }}
                              />
                              <Button onClick={addTopic} type="button" variant="outline">
                                <Plus />
                                Add
                              </Button>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-sentiment-label">Sentiment Label</Label>
                            <Input
                              id="edit-sentiment-label"
                              value={editForm.sentimentLabel}
                              onChange={(event) => setEditForm((current) => ({ ...current, sentimentLabel: event.target.value }))}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-sentiment-score">Sentiment Score</Label>
                            <Input
                              id="edit-sentiment-score"
                              type="number"
                              value={editForm.sentimentScore}
                              onChange={(event) => setEditForm((current) => ({ ...current, sentimentScore: event.target.value }))}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-published">Published At</Label>
                            <Input
                              id="edit-published"
                              value={editForm.publishedAt}
                              onChange={(event) => setEditForm((current) => ({ ...current, publishedAt: event.target.value }))}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {!articleEditMode && selectedDetails.length ? (
                    <>
                      <Separator />

                      <div className="grid gap-2 sm:grid-cols-2">
                        {selectedDetails.map(([label, value]) => (
                          <div key={label} className="rounded-md border bg-muted/25 p-3">
                            <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
                            <div className="mt-1 break-words text-sm">{String(value)}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}

                  {!articleEditMode ? (
                    <>
                      <Separator />

                      <div className="grid gap-3">
                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">Tickers</div>
                      <div className="mt-2">
                        {renderTickerCards()}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">Topics</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {enrichedTopics.length ? (
                          enrichedTopics.slice(0, 8).map((topic) => {
                            const hasTopicDetails = topic.relevance || topic.sentimentLabel || topic.sentimentScore

                            if (!hasTopicDetails) {
                              return (
                                <Badge key={topic.topic} variant="outline">
                                  {topic.topic}
                                </Badge>
                              )
                            }

                            return (
                              <div key={topic.topic} className="rounded-md border bg-muted/20 px-2 py-1.5">
                                <div>
                                  <Badge variant="outline">{topic.topic}</Badge>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1">
                                  {topic.relevance ? <Badge variant="secondary">Rel {topic.relevance}</Badge> : null}
                                  {topic.sentimentLabel ? <SentimentBadge label={topic.sentimentLabel} /> : null}
                                  {topic.sentimentScore ? <Badge variant="secondary">Score {topic.sentimentScore}</Badge> : null}
                                </div>
                              </div>
                            )
                          })
                        ) : (
                          <span className="text-sm text-muted-foreground">No topics</span>
                        )}
                      </div>
                    </div>
                      </div>
                    </>
                  ) : null}

                  {saveMessage ? (
                    <Alert>
                      <Database />
                      <AlertTitle>Supabase</AlertTitle>
                      <AlertDescription>{saveMessage}</AlertDescription>
                    </Alert>
                  ) : null}
                </article>
              </ScrollArea>
            ) : (
              <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                Select an article to preview it.
              </div>
            )}
          </CardContent>
        </Card>

        <Button
          aria-label="Resize article preview column"
          className={cn(
            'hidden h-full w-5 cursor-col-resize rounded-md border border-dashed bg-muted/30 px-0 text-muted-foreground hover:bg-muted hover:text-foreground xl:flex',
            isResizingPreview && 'border-primary bg-muted text-foreground',
          )}
          size="icon"
          title="Drag to resize Article Preview. Double-click to reset."
          type="button"
          variant="ghost"
          onDoubleClick={() => setPreviewWidth(520)}
          onPointerDown={startPreviewResize}
        >
          <GripVertical className="size-4" />
        </Button>

        {showNormalizedJson ? (
          <Card className="min-h-[520px] min-w-0 overflow-auto xl:h-full xl:flex-1">
            <CardHeader className="gap-1">
              <div className="flex items-center gap-2">
                <FileJson className="size-4" />
                <CardTitle className="text-base">Normalized JSON</CardTitle>
              </div>
              <CardDescription>Selected article plus original provider payload</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="min-h-[408px] rounded-lg border bg-muted/35 xl:h-[calc(100svh-234px)]">
                <pre className="whitespace-pre-wrap break-words p-4 text-xs leading-5">
                  <code>{articleJson(selectedArticle, data?.raw)}</code>
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        ) : (
          renderMarketPanel({
            className: 'min-w-0 xl:flex-1',
            scrollClassName: 'xl:h-[calc(100svh-234px)]',
          })
        )}
      </section>
    </main>
  )
}

export default App
