const providerLabels = {
  'alpha-vantage': 'Alpha Vantage',
  finnhub: 'Finnhub',
  polygon: 'Polygon',
  'yahoo-finance': 'Yahoo Finance',
  newsapi: 'NewsAPI',
}

function compactText(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''
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

function toIsoDate(value) {
  if (!value) return null
  if (typeof value === 'number') return new Date(value * 1000).toISOString()

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  })
}

function supabaseConfig(env) {
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY to Cloudflare Pages environment variables.')
  }

  return {
    url: url.replace(/\/+$/, ''),
    key,
  }
}

async function supabaseFetch(env, path, init = {}) {
  const config = supabaseConfig(env)
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })

  const text = await response.text()
  let body = null

  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { message: text || response.statusText }
  }

  if (!response.ok) {
    const message = body?.message || body?.hint || body?.details || response.statusText
    throw new Error(message)
  }

  return body
}

function normalizeSupabaseRow(row) {
  return {
    id: String(row.id),
    savedRowId: String(row.id),
    providerArticleId: row.provider_article_id || null,
    provider: row.provider,
    providerLabel: providerLabels[row.provider] || row.provider,
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

function articleRow(article, includeProvider = false) {
  const row = {
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

  if (includeProvider) {
    row.provider = article.provider
  }

  return row
}

async function readRequestJson(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

function errorResponse(error, fallback) {
  return json({
    error: error instanceof Error ? error.message : fallback,
  }, { status: 500 })
}

export {
  articleRow,
  errorResponse,
  json,
  normalizeSupabaseRow,
  readRequestJson,
  supabaseFetch,
}
