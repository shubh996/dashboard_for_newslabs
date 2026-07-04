import { articleRow, errorResponse, json, readRequestJson, supabaseFetch } from '../../_shared/supabase.js'

export async function onRequestPost({ env, request }) {
  try {
    const body = await readRequestJson(request)
    const article = body?.article

    if (!article?.provider || !article?.title || !article?.url) {
      return json({ error: 'Article must include provider, title, and url.' }, { status: 400 })
    }

    const query = new URLSearchParams({
      on_conflict: 'provider,url',
      select: '*',
    })
    const data = await supabaseFetch(env, `market_news_articles?${query}`, {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(articleRow(article, true)),
    })
    const row = Array.isArray(data) ? data[0] : data

    return json({ ok: true, article: row })
  } catch (error) {
    return errorResponse(error, 'Supabase save failed')
  }
}
