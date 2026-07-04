import { articleRow, errorResponse, json, normalizeSupabaseRow, readRequestJson, supabaseFetch } from '../../../_shared/supabase.js'

export async function onRequestPut({ env, params, request }) {
  try {
    const id = params.id
    const body = await readRequestJson(request)
    const article = body?.article

    if (!id || !article?.title || !article?.url) {
      return json({ error: 'Saved article update needs id, title, and url.' }, { status: 400 })
    }

    const query = new URLSearchParams({
      id: `eq.${id}`,
      select: '*',
    })
    const data = await supabaseFetch(env, `market_news_articles?${query}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(articleRow(article)),
    })
    const row = Array.isArray(data) ? data[0] : data

    return json({ ok: true, article: normalizeSupabaseRow(row) })
  } catch (error) {
    return errorResponse(error, 'Supabase update failed')
  }
}

export async function onRequestDelete({ env, params }) {
  try {
    const id = params.id
    if (!id) {
      return json({ error: 'Saved article delete needs id.' }, { status: 400 })
    }

    const query = new URLSearchParams({
      id: `eq.${id}`,
    })
    await supabaseFetch(env, `market_news_articles?${query}`, {
      method: 'DELETE',
    })

    return json({ ok: true, id })
  } catch (error) {
    return errorResponse(error, 'Supabase delete failed')
  }
}
