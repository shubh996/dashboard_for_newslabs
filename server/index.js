import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import edgarRouter from './edgar/index.js'
import yahooRouter from './yahoo/index.js'
import { getYahooSession, fetchYahooQuoteSummary, yahooRaw } from './yahooClient.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env.local') })
dotenv.config({ path: path.join(projectRoot, '.env') })

const app = express()
const port = Number(process.env.API_PORT || 3001)

// A politician's full disclosed-trades bundle (e.g. a prolific filer with
// thousands of trades) can comfortably exceed a few MB of JSON once saved to
// Supabase -- 4mb was rejecting real save payloads with a 413.
app.use(express.json({ limit: '25mb' }))

const providerConfigs = {
  'alpha-vantage': {
    label: 'Alpha Vantage',
    keyName: 'ALPHA_VANTAGE_API_KEY',
  },
  finnhub: {
    label: 'Finnhub',
    keyName: 'FINNHUB_API_KEY',
  },
  polygon: {
    label: 'Polygon',
    keyName: 'POLYGON_API_KEY',
  },
  newsapi: {
    label: 'NewsAPI',
    keyName: 'NEWSAPI_API_KEY',
  },
  'yahoo-finance': {
    label: 'Yahoo Finance',
  },
}

const yahooSymbolAliases = {
  DJI: '^DJI',
  GSPC: '^GSPC',
  IXIC: '^IXIC',
  NDX: '^NDX',
  NYA: '^NYA',
  RUT: '^RUT',
  SPX: '^GSPC',
}

function requiredKey(providerId) {
  const keyName = providerConfigs[providerId]?.keyName
  if (!keyName) return null
  const value = process.env[keyName]
  if (!value) {
    const label = providerConfigs[providerId].label
    throw new Error(`${label} needs ${keyName} in .env.local`)
  }
  return value
}

function yahooChartSymbol(query) {
  const cleanQuery = compactText(query).trim().toUpperCase()
  if (!cleanQuery) return ''
  const symbol = cleanQuery.includes(':') ? cleanQuery.split(':').pop() : cleanQuery
  return yahooSymbolAliases[symbol] || symbol.replace('_', '-')
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'dashboard_for_newslabs/1.0',
    },
  })

  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { message: text }
  }

  if (!response.ok) {
    const message = body?.error?.message || body?.message || response.statusText
    throw new Error(message)
  }

  return body
}

async function fetchYahooTimeseries(symbol, types) {
  let session = await getYahooSession()
  const period2 = Math.floor(Date.now() / 1000)
  const period1 = period2 - 60 * 60 * 24 * 365 * 12

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const url = new URL(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`)
    url.searchParams.set('symbol', symbol)
    url.searchParams.set('type', types.join(','))
    url.searchParams.set('period1', String(period1))
    url.searchParams.set('period2', String(period2))
    url.searchParams.set('crumb', session.crumb)

    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json', cookie: session.cookie },
    })
    const body = await response.json().catch(() => ({}))

    if (body?.finance?.error?.code === 'Unauthorized' && attempt === 0) {
      session = await getYahooSession(true)
      continue
    }
    if (body?.finance?.error) throw new Error(body.finance.error.description || 'Yahoo Finance request failed')

    return Array.isArray(body?.timeseries?.result) ? body.timeseries.result : []
  }

  throw new Error('Yahoo Finance request failed')
}

function alignTimeseries(result, prefix) {
  const seriesByField = {}
  const dateSet = new Set()

  for (const entry of result) {
    const key = Object.keys(entry).find((candidate) => candidate.startsWith(prefix) && candidate !== 'meta' && candidate !== 'timestamp')
    if (!key) continue
    const field = key.slice(prefix.length).replace(/^./, (char) => char.toLowerCase())
    const points = Array.isArray(entry[key]) ? entry[key] : []
    const byDate = {}
    for (const point of points) {
      if (!point?.asOfDate) continue
      dateSet.add(point.asOfDate)
      byDate[point.asOfDate] = yahooRaw(point.reportedValue)
    }
    seriesByField[field] = byDate
  }

  const dates = Array.from(dateSet).sort()
  const series = {}
  for (const [field, byDate] of Object.entries(seriesByField)) {
    series[field] = dates.map((date) => (date in byDate ? byDate[date] : null))
  }

  return { dates, series }
}

async function fetchXJson(url) {
  const token = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN
  if (!token) {
    return {
      configured: false,
      posts: [],
      message: 'Add X_BEARER_TOKEN to .env.local to show live X posts.',
    }
  }

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': 'dashboard_for_newslabs/1.0',
    },
  })

  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { message: text }
  }

  if (!response.ok) {
    const message = body?.title || body?.detail || body?.message || response.statusText
    throw new Error(message)
  }

  return {
    configured: true,
    ...body,
  }
}

function toIsoDate(value) {
  if (!value) return null
  if (typeof value === 'number') return new Date(value * 1000).toISOString()
  if (/^\d{8}T\d{6}$/.test(value)) {
    const year = value.slice(0, 4)
    const month = value.slice(4, 6)
    const day = value.slice(6, 8)
    const hour = value.slice(9, 11)
    const minute = value.slice(11, 13)
    const second = value.slice(13, 15)
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString()
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function compactText(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''
}

function firstImageFromYahoo(raw) {
  const resolutions = raw?.thumbnail?.resolutions
  if (Array.isArray(resolutions) && resolutions.length > 0) {
    return resolutions[resolutions.length - 1]?.url || resolutions[0]?.url || ''
  }
  return ''
}

function cleanArticleImageUrl(value) {
  const imageUrl = compactText(value)
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

  if (fillerPatterns.some((pattern) => lowerUrl.includes(pattern))) {
    return ''
  }

  return imageUrl
}

function articleId(provider, raw, fallback) {
  return (
    raw.id ||
    raw.uuid ||
    raw.article_url ||
    raw.url ||
    raw.link ||
    raw.title ||
    `${provider}-${fallback}`
  )
}

function normalizeAlpha(raw, index) {
  const tickerSentiment = Array.isArray(raw.ticker_sentiment) ? raw.ticker_sentiment : []
  const topics = Array.isArray(raw.topics) ? raw.topics.map((item) => item.topic).filter(Boolean) : []
  return {
    id: String(articleId('alpha-vantage', raw, index)),
    provider: 'alpha-vantage',
    providerLabel: 'Alpha Vantage',
    title: compactText(raw.title, 'Untitled Alpha Vantage article'),
    summary: compactText(raw.summary),
    url: compactText(raw.url),
    imageUrl: cleanArticleImageUrl(raw.banner_image),
    source: compactText(raw.source, raw.source_domain),
    author: Array.isArray(raw.authors) ? raw.authors.join(', ') : '',
    publishedAt: toIsoDate(raw.time_published),
    tickers: tickerSentiment.map((item) => item.ticker).filter(Boolean),
    topics,
    sentimentScore: raw.overall_sentiment_score ?? null,
    sentimentLabel: raw.overall_sentiment_label ?? '',
    raw,
  }
}

function normalizePolygon(raw, index) {
  return {
    id: String(articleId('polygon', raw, index)),
    provider: 'polygon',
    providerLabel: 'Polygon',
    title: compactText(raw.title, 'Untitled Polygon article'),
    summary: compactText(raw.description),
    url: compactText(raw.article_url, raw.amp_url),
    imageUrl: cleanArticleImageUrl(raw.image_url),
    source: compactText(raw.publisher?.name),
    author: compactText(raw.author),
    publishedAt: toIsoDate(raw.published_utc),
    tickers: Array.isArray(raw.tickers) ? raw.tickers : [],
    topics: Array.isArray(raw.keywords) ? raw.keywords : [],
    sentimentScore: null,
    sentimentLabel: '',
    raw,
  }
}

function normalizeNewsApi(raw, index) {
  return {
    id: String(articleId('newsapi', raw, index)),
    provider: 'newsapi',
    providerLabel: 'NewsAPI',
    title: compactText(raw.title, 'Untitled NewsAPI article'),
    summary: compactText(raw.description, raw.content),
    url: compactText(raw.url),
    imageUrl: cleanArticleImageUrl(raw.urlToImage),
    source: compactText(raw.source?.name),
    author: compactText(raw.author),
    publishedAt: toIsoDate(raw.publishedAt),
    tickers: [],
    topics: [],
    sentimentScore: null,
    sentimentLabel: '',
    raw,
  }
}

function normalizeFinnhub(raw, index, query) {
  const related = raw.related || query || ''
  const tickers = related
    .split(',')
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean)

  return {
    id: String(articleId('finnhub', raw, index)),
    provider: 'finnhub',
    providerLabel: 'Finnhub',
    title: compactText(raw.headline, raw.title, 'Untitled Finnhub article'),
    summary: compactText(raw.summary),
    url: compactText(raw.url),
    imageUrl: cleanArticleImageUrl(raw.image),
    source: compactText(raw.source),
    author: '',
    publishedAt: toIsoDate(raw.datetime),
    tickers,
    topics: raw.category ? [raw.category] : [],
    sentimentScore: null,
    sentimentLabel: '',
    raw,
  }
}

function normalizeYahoo(raw, index) {
  const content = raw?.content && typeof raw.content === 'object' ? raw.content : raw
  const idSource = { ...raw, ...content }
  return {
    id: String(articleId('yahoo-finance', idSource, index)),
    provider: 'yahoo-finance',
    providerLabel: 'Yahoo Finance',
    title: compactText(content.title, 'Untitled Yahoo Finance article'),
    summary: compactText(content.summary, content.description),
    url: compactText(content.link, content.url, content.canonicalUrl?.url, content.clickThroughUrl?.url),
    imageUrl: cleanArticleImageUrl(firstImageFromYahoo(content)),
    source: compactText(content.publisher, content.provider?.displayName),
    author: compactText(content.author, content.byline),
    publishedAt: toIsoDate(content.providerPublishTime || compactText(content.pubDate, content.displayTime)),
    tickers: Array.isArray(content.relatedTickers) ? content.relatedTickers : [],
    topics: compactText(content.type, content.contentType) ? [compactText(content.type, content.contentType)] : [],
    sentimentScore: null,
    sentimentLabel: '',
    raw,
  }
}

function normalizeXPosts(body) {
  if (body.configured === false) return body

  const users = new Map()
  const includedUsers = Array.isArray(body.includes?.users) ? body.includes.users : []
  includedUsers.forEach((user) => {
    users.set(String(user.id), user)
  })

  const posts = Array.isArray(body.data) ? body.data : []

  return {
    configured: true,
    posts: posts.map((post) => {
      const user = users.get(String(post.author_id)) || {}
      const username = compactText(user.username)
      return {
        id: String(post.id),
        text: compactText(post.text),
        url: username && post.id ? `https://x.com/${username}/status/${post.id}` : '',
        createdAt: toIsoDate(post.created_at),
        authorName: compactText(user.name),
        username,
        metrics: {
          likeCount: post.public_metrics?.like_count,
          repostCount: post.public_metrics?.retweet_count,
          replyCount: post.public_metrics?.reply_count,
        },
        raw: post,
      }
    }),
    raw: body,
  }
}

function providerLabel(provider) {
  return providerConfigs[provider]?.label || provider
}

function normalizeSupabaseRow(row) {
  return {
    id: String(row.id),
    savedRowId: String(row.id),
    providerArticleId: row.provider_article_id || null,
    provider: row.provider,
    providerLabel: providerLabel(row.provider),
    title: compactText(row.title, 'Untitled saved article'),
    summary: compactText(row.summary),
    url: compactText(row.url),
    imageUrl: cleanArticleImageUrl(row.image_url),
    source: compactText(row.source_name),
    author: compactText(row.author),
    publishedAt: toIsoDate(row.published_at),
    tickers: Array.isArray(row.tickers) ? row.tickers : [],
    topics: Array.isArray(row.topics) ? row.topics : [],
    sentimentScore: row.sentiment_score ?? null,
    sentimentLabel: row.sentiment_label || '',
    raw: row.raw_json || {},
    savedAt: row.created_at || null,
  }
}

function runYahooSearch(query, limit) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'yahoo_news.py')
    const child = spawn('python3', [scriptPath, query, String(limit)], {
      env: {
        ...process.env,
        YFINANCE_SOURCE_PATH: process.env.YFINANCE_SOURCE_PATH || '/Users/shubh./Downloads/yfinance-main',
      },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Yahoo Finance Python bridge exited with ${code}`))
        return
      }

      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(new Error(`Yahoo Finance bridge returned invalid JSON: ${error.message}`))
      }
    })
  })
}

function tickerListFromQuery(query) {
  if (!query) return []

  return query
    .split(',')
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker))
    .slice(0, 8)
}

function sortArticlesByPublishedAt(left, right) {
  return new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime()
}

function uniqueArticles(articles) {
  const seen = new Set()

  return articles.filter((article) => {
    const key = article.url || article.id || article.title
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function dateRange(daysBack) {
  const to = new Date()
  const from = new Date(to)
  from.setDate(to.getDate() - daysBack)

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

function newsApiQuery(query) {
  const tickers = tickerListFromQuery(query)
  const marketContext = '(stock OR stocks OR shares OR earnings OR market OR "Wall Street" OR NASDAQ OR NYSE)'
  const coreQuery = tickers.length
    ? tickers.map((ticker) => `("${ticker}" AND ${marketContext})`).join(' OR ')
    : compactText(query, '"US stocks" OR "Wall Street" OR NASDAQ OR NYSE OR "S&P 500"')

  return `(${coreQuery}) AND ("United States" OR US OR "Wall Street" OR NASDAQ OR NYSE OR "S&P 500")`
}

async function getProviderNews(providerId, query, limit) {
  if (providerId === 'alpha-vantage') {
    const key = requiredKey(providerId)
    const url = new URL('https://www.alphavantage.co/query')
    url.searchParams.set('function', 'NEWS_SENTIMENT')
    url.searchParams.set('apikey', key)
    url.searchParams.set('limit', String(limit))
    if (query) url.searchParams.set('tickers', query)
    const body = await fetchJson(url)
    const feed = Array.isArray(body.feed) ? body.feed : []
    return { raw: body, articles: feed.slice(0, limit).map(normalizeAlpha) }
  }

  if (providerId === 'polygon') {
    const key = requiredKey(providerId)
    const tickers = tickerListFromQuery(query)
    const redact = (url) => {
      const copy = new URL(url.toString())
      if (copy.searchParams.has('apiKey')) copy.searchParams.set('apiKey', '***')
      return copy.toString()
    }

    // Multi-ticker: one Polygon request per ticker (can look like "many calls").
    // Prefer single-ticker or empty query for a true 1-shot refresh from the UI.
    if (tickers.length > 1) {
      const perTickerLimit = Math.max(4, Math.ceil(limit / tickers.length) + 2)
      const responses = await Promise.all(
        tickers.map(async (ticker) => {
          const url = new URL('https://api.polygon.io/v2/reference/news')
          url.searchParams.set('apiKey', key)
          url.searchParams.set('limit', String(perTickerLimit))
          url.searchParams.set('order', 'desc')
          url.searchParams.set('sort', 'published_utc')
          url.searchParams.set('ticker', ticker)

          return { ticker, upstreamUrl: redact(url), body: await fetchJson(url) }
        }),
      )
      const articles = uniqueArticles(
        responses.flatMap(({ body }) => {
          const results = Array.isArray(body.results) ? body.results : []
          return results.map(normalizePolygon)
        }),
      ).sort(sortArticlesByPublishedAt)

      return {
        raw: { query, responses: responses.map(({ ticker, upstreamUrl, body }) => ({ ticker, upstreamUrl, body })) },
        articles: articles.slice(0, limit),
        upstream: {
          provider: 'polygon',
          mode: 'multi-ticker',
          count: responses.length,
          urls: responses.map((item) => item.upstreamUrl),
        },
      }
    }

    const url = new URL('https://api.polygon.io/v2/reference/news')
    url.searchParams.set('apiKey', key)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('order', 'desc')
    url.searchParams.set('sort', 'published_utc')
    if (tickers[0]) url.searchParams.set('ticker', tickers[0])
    const body = await fetchJson(url)
    const results = Array.isArray(body.results) ? body.results : []
    return {
      raw: body,
      articles: results.slice(0, limit).map(normalizePolygon),
      upstream: {
        provider: 'polygon',
        mode: tickers[0] ? 'single-ticker' : 'latest-all',
        count: 1,
        urls: [redact(url)],
      },
    }
  }

  if (providerId === 'finnhub') {
    const key = requiredKey(providerId)
    const tickers = tickerListFromQuery(query)

    if (tickers.length > 1) {
      const perTickerLimit = Math.max(4, Math.ceil(limit / tickers.length) + 2)
      const range = dateRange(30)
      const responses = await Promise.all(
        tickers.map(async (ticker) => {
          const url = new URL('https://finnhub.io/api/v1/company-news')
          url.searchParams.set('token', key)
          url.searchParams.set('symbol', ticker)
          url.searchParams.set('from', range.from)
          url.searchParams.set('to', range.to)

          return { ticker, body: await fetchJson(url) }
        }),
      )
      const articles = uniqueArticles(
        responses.flatMap(({ ticker, body }) => {
          const items = Array.isArray(body) ? body : []
          return items.slice(0, perTickerLimit).map((item, index) => normalizeFinnhub(item, index, ticker))
        }),
      ).sort(sortArticlesByPublishedAt)

      return { raw: { query, responses }, articles: articles.slice(0, limit) }
    }

    const cleanQuery = tickers[0] || ''
    const url = new URL(cleanQuery ? 'https://finnhub.io/api/v1/company-news' : 'https://finnhub.io/api/v1/news')
    url.searchParams.set('token', key)

    if (cleanQuery) {
      const range = dateRange(30)
      url.searchParams.set('symbol', cleanQuery)
      url.searchParams.set('from', range.from)
      url.searchParams.set('to', range.to)
    } else {
      url.searchParams.set('category', 'general')
    }

    const body = await fetchJson(url)
    const articles = Array.isArray(body) ? body : []
    return {
      raw: body,
      articles: articles.slice(0, limit).map((item, index) => normalizeFinnhub(item, index, cleanQuery)),
    }
  }

  if (providerId === 'newsapi') {
    const key = requiredKey(providerId)
    const url = new URL('https://newsapi.org/v2/everything')
    url.searchParams.set('apiKey', key)
    url.searchParams.set('q', newsApiQuery(query))
    url.searchParams.set('language', 'en')
    url.searchParams.set('sortBy', 'publishedAt')
    url.searchParams.set('pageSize', String(limit))
    const body = await fetchJson(url)
    const articles = Array.isArray(body.articles) ? body.articles : []
    return { raw: body, articles: articles.slice(0, limit).map(normalizeNewsApi) }
  }

  if (providerId === 'yahoo-finance') {
    const tickers = tickerListFromQuery(query)

    if (tickers.length > 1) {
      const perTickerLimit = Math.max(4, Math.ceil(limit / tickers.length) + 2)
      const responses = await Promise.all(
        tickers.map(async (ticker) => ({ ticker, body: await runYahooSearch(ticker, perTickerLimit) })),
      )
      const articles = uniqueArticles(
        responses.flatMap(({ body }) => {
          const news = Array.isArray(body.news) ? body.news : []
          const tickerNews = Array.isArray(body.ticker_news) ? body.ticker_news : []
          return [...news, ...tickerNews].map(normalizeYahoo)
        }),
      ).sort(sortArticlesByPublishedAt)

      return { raw: { query, responses }, articles: articles.slice(0, limit) }
    }

    const body = await runYahooSearch(query || 'US stock market Wall Street S&P 500 Nasdaq', limit)
    const news = Array.isArray(body.news) ? body.news : []
    const tickerNews = Array.isArray(body.ticker_news) ? body.ticker_news : []
    const articles = uniqueArticles([...news, ...tickerNews].map(normalizeYahoo)).sort(sortArticlesByPublishedAt)
    return { raw: body, articles: articles.slice(0, limit) }
  }

  throw new Error(`Unsupported provider: ${providerId}`)
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY to .env.local')
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    providers: Object.keys(providerConfigs),
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)),
  })
})

app.get('/api/providers/:providerId/news', async (request, response) => {
  try {
    const providerId = request.params.providerId
    const query = String(request.query.query || '').trim()
    const limit = Math.min(Math.max(Number(request.query.limit || 12), 1), 100)
    if (providerId === 'yahoo-finance') {
      response.set('Cache-Control', 'no-store, max-age=0')
      response.set('Pragma', 'no-cache')
      response.set('Expires', '0')
    }
    const result = await getProviderNews(providerId, query, limit)

    response.json({
      provider: providerId,
      query,
      limit,
      count: result.articles.length,
      articles: result.articles,
      raw: result.raw,
      // Exact upstream hit(s) for transparent UI (apiKey redacted).
      upstream: result.upstream || null,
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected provider error',
    })
  }
})

app.get('/api/market/momentum', async (request, response) => {
  try {
    const query = String(request.query.query || '').trim()
    const days = Math.min(Math.max(Number(request.query.days || 30), 5), 90)
    const symbol = yahooChartSymbol(query)

    if (!symbol) {
      response.json({ query, symbol, days, points: [] })
      return
    }

    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
    url.searchParams.set('range', `${Math.max(days + 10, 35)}d`)
    url.searchParams.set('interval', '1d')
    url.searchParams.set('includePrePost', 'false')
    url.searchParams.set('events', 'history')

    const body = await fetchJson(url)
    const result = body?.chart?.result?.[0] || {}
    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : []
    const quote = result.indicators?.quote?.[0] || {}
    const closes = Array.isArray(quote.close) ? quote.close : []

    const points = timestamps
      .map((timestamp, index) => {
        const close = Number(closes[index])
        const previousClose = index > 0 ? Number(closes[index - 1]) : null
        if (!Number.isFinite(close)) return null

        return {
          date: new Date(Number(timestamp) * 1000).toISOString().slice(0, 10),
          close,
          previousClose: Number.isFinite(previousClose) ? previousClose : null,
          changePercent: Number.isFinite(previousClose) && previousClose
            ? ((close - previousClose) / previousClose) * 100
            : null,
        }
      })
      .filter(Boolean)
      .filter((point) => point.changePercent !== null)
      .slice(-days)

    response.json({ query, symbol, days, points })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to fetch market momentum',
    })
  }
})

app.get('/api/market/fundamentals', async (request, response) => {
  try {
    const query = String(request.query.query || '').trim()
    const symbol = yahooChartSymbol(query)
    if (!symbol) {
      response.json({ query, symbol, profile: null, stats: null })
      return
    }

    const result = await fetchYahooQuoteSummary(symbol, ['assetProfile', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'price'])
    const profileModule = result.assetProfile || {}
    const summary = result.summaryDetail || {}
    const stats = result.defaultKeyStatistics || {}
    const financial = result.financialData || {}
    const price = result.price || {}

    response.json({
      query,
      symbol,
      profile: {
        sector: profileModule.sector || null,
        industry: profileModule.industry || null,
        longBusinessSummary: profileModule.longBusinessSummary || null,
        fullTimeEmployees: yahooRaw(profileModule.fullTimeEmployees),
        website: profileModule.website || null,
        city: profileModule.city || null,
        state: profileModule.state || null,
        country: profileModule.country || null,
      },
      stats: {
        currentPrice: yahooRaw(financial.currentPrice) ?? yahooRaw(price.regularMarketPrice),
        marketCap: yahooRaw(summary.marketCap) ?? yahooRaw(price.marketCap),
        trailingPE: yahooRaw(summary.trailingPE),
        forwardPE: yahooRaw(summary.forwardPE),
        trailingEps: yahooRaw(stats.trailingEps),
        forwardEps: yahooRaw(stats.forwardEps),
        dividendYield: yahooRaw(summary.dividendYield),
        beta: yahooRaw(summary.beta),
        fiftyTwoWeekLow: yahooRaw(summary.fiftyTwoWeekLow),
        fiftyTwoWeekHigh: yahooRaw(summary.fiftyTwoWeekHigh),
        fiftyDayAverage: yahooRaw(summary.fiftyDayAverage),
        twoHundredDayAverage: yahooRaw(summary.twoHundredDayAverage),
        priceToBook: yahooRaw(stats.priceToBook),
        pegRatio: yahooRaw(stats.pegRatio),
        bookValue: yahooRaw(stats.bookValue),
        sharesOutstanding: yahooRaw(stats.sharesOutstanding),
        averageVolume: yahooRaw(summary.averageVolume),
        profitMargins: yahooRaw(stats.profitMargins),
      },
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to fetch fundamentals',
    })
  }
})

app.get('/api/market/analyst', async (request, response) => {
  try {
    const query = String(request.query.query || '').trim()
    const symbol = yahooChartSymbol(query)
    if (!symbol) {
      response.json({ query, symbol, consensus: null, trend: [], ratings: [] })
      return
    }

    const result = await fetchYahooQuoteSummary(symbol, ['financialData', 'recommendationTrend', 'upgradeDowngradeHistory'])
    const financial = result.financialData || {}
    const trend = Array.isArray(result.recommendationTrend?.trend) ? result.recommendationTrend.trend : []
    const history = Array.isArray(result.upgradeDowngradeHistory?.history) ? result.upgradeDowngradeHistory.history : []

    const currentPrice = yahooRaw(financial.currentPrice)

    response.json({
      query,
      symbol,
      consensus: {
        currentPrice,
        targetLow: yahooRaw(financial.targetLowPrice),
        targetMean: yahooRaw(financial.targetMeanPrice),
        targetMedian: yahooRaw(financial.targetMedianPrice),
        targetHigh: yahooRaw(financial.targetHighPrice),
        recommendationKey: financial.recommendationKey || null,
        recommendationMean: yahooRaw(financial.recommendationMean),
        numberOfAnalystOpinions: yahooRaw(financial.numberOfAnalystOpinions),
      },
      trend: trend.map((point) => ({
        period: point.period,
        strongBuy: yahooRaw(point.strongBuy) || 0,
        buy: yahooRaw(point.buy) || 0,
        hold: yahooRaw(point.hold) || 0,
        sell: yahooRaw(point.sell) || 0,
        strongSell: yahooRaw(point.strongSell) || 0,
      })),
      ratings: history
        .map((entry) => {
          const priceTarget = Number.isFinite(entry.currentPriceTarget) && entry.currentPriceTarget > 0 ? entry.currentPriceTarget : null
          const priorTarget = Number.isFinite(entry.priorPriceTarget) && entry.priorPriceTarget > 0 ? entry.priorPriceTarget : null
          return {
            firm: entry.firm || 'Unknown',
            toGrade: entry.toGrade || null,
            fromGrade: entry.fromGrade || null,
            action: entry.action || null,
            priceTarget,
            priorPriceTarget: priorTarget,
            upsidePercent: priceTarget && currentPrice ? ((priceTarget - currentPrice) / currentPrice) * 100 : null,
            date: Number.isFinite(entry.epochGradeDate) ? new Date(entry.epochGradeDate * 1000).toISOString().slice(0, 10) : null,
          }
        })
        .sort((a, b) => (a.date && b.date ? b.date.localeCompare(a.date) : 0)),
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to fetch analyst data',
    })
  }
})

app.get('/api/market/holders', async (request, response) => {
  try {
    const query = String(request.query.query || '').trim()
    const symbol = yahooChartSymbol(query)
    if (!symbol) {
      response.json({ query, symbol, breakdown: null, institutional: [], insiders: [] })
      return
    }

    const result = await fetchYahooQuoteSummary(symbol, ['majorHoldersBreakdown', 'institutionOwnership', 'insiderHolders'])
    const breakdown = result.majorHoldersBreakdown || {}
    const institutional = Array.isArray(result.institutionOwnership?.ownershipList) ? result.institutionOwnership.ownershipList : []
    const insiders = Array.isArray(result.insiderHolders?.holders) ? result.insiderHolders.holders : []

    response.json({
      query,
      symbol,
      breakdown: {
        insidersPercentHeld: yahooRaw(breakdown.insidersPercentHeld),
        institutionsPercentHeld: yahooRaw(breakdown.institutionsPercentHeld),
        institutionsCount: yahooRaw(breakdown.institutionsCount),
      },
      institutional: institutional.map((holder) => ({
        organization: holder.organization || 'Unknown',
        reportDate: holder.reportDate?.fmt || null,
        position: yahooRaw(holder.position),
        value: yahooRaw(holder.value),
        pctHeld: yahooRaw(holder.pctHeld),
        pctChange: yahooRaw(holder.pctChange),
      })),
      insiders: insiders.map((holder) => ({
        name: holder.name || 'Unknown',
        relation: holder.relation || null,
        transactionDescription: holder.transactionDescription || null,
        latestTransDate: holder.latestTransDate?.fmt || null,
        positionDirect: yahooRaw(holder.positionDirect),
        positionIndirect: yahooRaw(holder.positionIndirect),
      })),
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to fetch holders data',
    })
  }
})

const financialsTimeseriesTypes = {
  income: [
    'TotalRevenue',
    'CostOfRevenue',
    'GrossProfit',
    'SellingGeneralAndAdministration',
    'ResearchAndDevelopment',
    'OperatingExpense',
    'OperatingIncome',
    'InterestExpense',
    'PretaxIncome',
    'TaxProvision',
    'NetIncome',
    'BasicEPS',
    'DilutedEPS',
    'EBITDA',
  ],
  balance: [
    'TotalAssets',
    'CurrentAssets',
    'TotalLiabilitiesNetMinorityInterest',
    'CurrentLiabilities',
    'TotalDebt',
    'CommonStockEquity',
    'TotalEquityGrossMinorityInterest',
    'RetainedEarnings',
    'WorkingCapital',
  ],
  cashflow: [
    'OperatingCashFlow',
    'InvestingCashFlow',
    'FinancingCashFlow',
    'CapitalExpenditure',
    'FreeCashFlow',
    'DepreciationAndAmortization',
  ],
}

app.get('/api/market/financials', async (request, response) => {
  try {
    const query = String(request.query.query || '').trim()
    const period = request.query.period === 'quarterly' ? 'quarterly' : 'annual'
    const symbol = yahooChartSymbol(query)
    if (!symbol) {
      response.json({ query, symbol, period, dates: [], income: {}, balance: {}, cashflow: {} })
      return
    }

    const prefix = period === 'quarterly' ? 'quarterly' : 'annual'
    const allTypes = [...financialsTimeseriesTypes.income, ...financialsTimeseriesTypes.balance, ...financialsTimeseriesTypes.cashflow]
      .map((type) => `${prefix}${type}`)

    const result = await fetchYahooTimeseries(symbol, allTypes)
    const { dates, series } = alignTimeseries(result, prefix)

    const pick = (types) => {
      const picked = {}
      for (const type of types) {
        const field = `${type.charAt(0).toLowerCase()}${type.slice(1)}`
        picked[field] = series[field] || dates.map(() => null)
      }
      return picked
    }

    response.json({
      query,
      symbol,
      period,
      dates,
      income: pick(financialsTimeseriesTypes.income),
      balance: pick(financialsTimeseriesTypes.balance),
      cashflow: pick(financialsTimeseriesTypes.cashflow),
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to fetch financials',
    })
  }
})

app.get('/api/market/earnings', async (request, response) => {
  try {
    const query = String(request.query.query || '').trim()
    const period = request.query.period === 'quarterly' ? 'quarterly' : 'annual'
    const symbol = yahooChartSymbol(query)
    if (!symbol) {
      response.json({ query, symbol, period, eps: [], revenue: [] })
      return
    }

    if (period === 'annual') {
      const result = await fetchYahooTimeseries(symbol, ['annualBasicEPS', 'annualDilutedEPS', 'annualTotalRevenue'])
      const { dates, series } = alignTimeseries(result, 'annual')
      const epsSeries = series.dilutedEPS || series.basicEPS || dates.map(() => null)

      response.json({
        query,
        symbol,
        period,
        eps: dates.map((date, index) => ({ date, estimate: null, actual: epsSeries[index] ?? null })),
        revenue: dates.map((date, index) => ({ date, estimate: null, actual: (series.totalRevenue || [])[index] ?? null })),
      })
      return
    }

    const [quoteResult, timeseriesResult] = await Promise.all([
      fetchYahooQuoteSummary(symbol, ['earningsHistory', 'earningsTrend']),
      fetchYahooTimeseries(symbol, ['quarterlyTotalRevenue']),
    ])

    const history = Array.isArray(quoteResult.earningsHistory?.history) ? quoteResult.earningsHistory.history : []
    const trend = Array.isArray(quoteResult.earningsTrend?.trend) ? quoteResult.earningsTrend.trend : []
    const upcoming = trend.find((point) => point.period === '0q')

    const { dates: revenueDates, series: revenueSeries } = alignTimeseries(timeseriesResult, 'quarterly')
    const revenueByDate = {}
    revenueDates.forEach((date, index) => {
      revenueByDate[date] = (revenueSeries.totalRevenue || [])[index] ?? null
    })

    const eps = history.map((entry) => ({
      date: entry.quarter?.fmt || null,
      estimate: yahooRaw(entry.epsEstimate),
      actual: yahooRaw(entry.epsActual),
    }))
    const revenue = history.map((entry) => ({
      date: entry.quarter?.fmt || null,
      estimate: null,
      actual: entry.quarter?.fmt ? revenueByDate[entry.quarter.fmt] ?? null : null,
    }))

    if (upcoming?.endDate) {
      const alreadyCovered = eps.some((point) => point.date === upcoming.endDate)
      if (!alreadyCovered) {
        eps.push({ date: upcoming.endDate, estimate: yahooRaw(upcoming.earningsEstimate?.avg), actual: null })
        revenue.push({ date: upcoming.endDate, estimate: yahooRaw(upcoming.revenueEstimate?.avg), actual: null })
      }
    }

    response.json({ query, symbol, period, eps, revenue })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to fetch earnings',
    })
  }
})

app.get('/api/social/x', async (request, response) => {
  try {
    const query = compactText(String(request.query.query || 'stocks OR markets')).slice(0, 420)
    const limit = Math.min(Math.max(Number(request.query.limit || 20), 1), 50)

    const token = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN
    if (!token) {
      response.json({
        configured: false,
        query,
        count: 0,
        posts: [],
        message: 'Add X_BEARER_TOKEN to .env.local to show live X posts.',
      })
      return
    }

    const url = new URL('https://api.twitter.com/2/tweets/search/recent')
    url.searchParams.set('query', `(${query}) lang:en -is:retweet`)
    url.searchParams.set('max_results', String(Math.max(limit, 10)))
    url.searchParams.set('expansions', 'author_id')
    url.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id,lang')
    url.searchParams.set('user.fields', 'name,username,profile_image_url,verified')

    const body = await fetchXJson(url)
    const result = normalizeXPosts(body)

    response.json({
      configured: result.configured,
      query,
      count: result.posts.length,
      posts: result.posts.slice(0, limit),
      raw: result.raw,
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected X social error',
    })
  }
})

app.get('/api/articles/saved', async (request, response) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit || 10), 1), 200)
    const offset = Math.max(Number(request.query.offset || 0), 0)
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('market_news_articles')
      .select('*')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    const articles = Array.isArray(data) ? data.map(normalizeSupabaseRow) : []
    response.json({
      provider: 'supabase',
      query: '',
      limit,
      offset,
      hasMore: articles.length === limit,
      count: articles.length,
      articles,
      raw: data || [],
    })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to fetch saved Supabase articles',
    })
  }
})

app.put('/api/articles/saved/:id', async (request, response) => {
  try {
    const id = request.params.id
    const article = request.body?.article

    if (!id || !article?.title || !article?.url) {
      response.status(400).json({ error: 'Saved article update needs id, title, and url.' })
      return
    }

    const supabase = getSupabase()
    const row = {
      title: article.title,
      summary: article.summary || null,
      url: article.url,
      image_url: article.imageUrl || null,
      source_name: article.source || null,
      author: article.author || null,
      published_at: article.publishedAt || null,
      tickers: Array.isArray(article.tickers) ? article.tickers : [],
      topics: Array.isArray(article.topics) ? article.topics : [],
      sentiment_score: article.sentimentScore,
      sentiment_label: article.sentimentLabel || null,
      raw_json: article.raw || article,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('market_news_articles')
      .update(row)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    response.json({ ok: true, article: normalizeSupabaseRow(data) })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Supabase update failed',
    })
  }
})

app.delete('/api/articles/saved/:id', async (request, response) => {
  try {
    const id = request.params.id
    if (!id) {
      response.status(400).json({ error: 'Saved article delete needs id.' })
      return
    }

    const supabase = getSupabase()
    const { error } = await supabase
      .from('market_news_articles')
      .delete()
      .eq('id', id)

    if (error) throw error

    response.json({ ok: true, id })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Supabase delete failed',
    })
  }
})

app.post('/api/articles/save', async (request, response) => {
  try {
    const article = request.body?.article
    if (!article?.provider || !article?.title || !article?.url) {
      response.status(400).json({ error: 'Article must include provider, title, and url.' })
      return
    }

    const supabase = getSupabase()
    const row = {
      provider: article.provider,
      provider_article_id: article.id || null,
      title: article.title,
      summary: article.summary || null,
      url: article.url,
      image_url: article.imageUrl || null,
      source_name: article.source || null,
      author: article.author || null,
      published_at: article.publishedAt || null,
      tickers: Array.isArray(article.tickers) ? article.tickers : [],
      topics: Array.isArray(article.topics) ? article.topics : [],
      sentiment_score: article.sentimentScore,
      sentiment_label: article.sentimentLabel || null,
      raw_json: article.raw || article,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('market_news_articles')
      .upsert(row, { onConflict: 'provider,url' })
      .select()
      .single()

    if (error) throw error

    response.json({ ok: true, article: data })
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Supabase save failed',
    })
  }
})

app.use('/api/edgar', edgarRouter)
// Yahoo Finance ticker data — separate router + Supabase table from SEC EDGAR.
app.use('/api/yahoo', yahooRouter)

app.listen(port, () => {
  console.log(`News dashboard API listening on http://localhost:${port}`)
})
