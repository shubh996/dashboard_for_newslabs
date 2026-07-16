import { errorResponse, json, normalizeSupabaseRow, supabaseFetch } from '../../../_shared/supabase.js'

export async function onRequestGet({ env, request }) {
  try {
    const url = new URL(request.url)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 10), 1), 200)
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0)
    const params = new URLSearchParams({
      select: '*',
      order: 'published_at.desc.nullslast,created_at.desc',
      limit: String(limit),
      offset: String(offset),
    })
    const data = await supabaseFetch(env, `market_news_articles?${params}`)
    const articles = Array.isArray(data) ? data.map(normalizeSupabaseRow) : []

    return json({
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
    return errorResponse(error, 'Unable to fetch saved Supabase articles')
  }
}
