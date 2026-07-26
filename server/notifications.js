/**
 * Notifications dashboard APIs:
 * - list monitored tickers from device_monitored_tickers
 * - scrape Perplexity finance via Firecrawl for "Notable Price Movement"
 * - save ONLY new/changed dates under a ticker-scoped date map:
 *     notable_price_movements.dates["YYYY-MM-DD"] = { event… }
 *
 * Shape (v2):
 * {
 *   version: 2,
 *   ticker: "AAPL",
 *   updated_at, last_scraped_at, source_url,
 *   dates: { "2026-07-21": { event_date, price, summary, sources, saved_at, … } }
 * }
 */

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1'
const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
}

function firecrawlKey() {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) {
    throw new Error('Add FIRECRAWL_API_KEY to .env.local')
  }
  return key
}

function normalizeTicker(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.^_-]/g, '')
}

function perplexityFinanceUrl(ticker) {
  return `https://www.perplexity.ai/finance/${encodeURIComponent(ticker)}`
}

async function firecrawlFetch(path, init = {}) {
  const response = await fetch(`${FIRECRAWL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${firecrawlKey()}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }
  if (!response.ok) {
    const message =
      body?.error ||
      body?.message ||
      `Firecrawl ${path} failed (${response.status})`
    const error = new Error(message)
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

export async function getFirecrawlCreditUsage() {
  const body = await firecrawlFetch('/team/credit-usage')
  const data = body?.data || body || {}
  const remaining =
    data.remaining_credits ?? data.remainingCredits ?? null
  const plan = data.plan_credits ?? data.planCredits ?? null
  return {
    remaining_credits: remaining,
    plan_credits: plan,
    billing_period_start:
      data.billing_period_start ?? data.billingPeriodStart ?? null,
    billing_period_end:
      data.billing_period_end ?? data.billingPeriodEnd ?? null,
    raw: data,
  }
}

function parseDisplayDateToIso(displayDate, now = new Date()) {
  const match = String(displayDate || '').match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i,
  )
  if (!match) return null
  const monthName = match[1][0].toUpperCase() + match[1].slice(1, 3).toLowerCase()
  const month = MONTHS[monthName]
  const day = Number(match[2])
  if (month == null || !Number.isFinite(day)) return null

  let year = now.getFullYear()
  let candidate = new Date(Date.UTC(year, month, day))
  // If the date is more than ~2 days in the future, it belongs to last year.
  const maxFutureMs = 2 * 24 * 60 * 60 * 1000
  if (candidate.getTime() - now.getTime() > maxFutureMs) {
    year -= 1
    candidate = new Date(Date.UTC(year, month, day))
  }
  const yyyy = candidate.getUTCFullYear()
  const mm = String(candidate.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(candidate.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function titleFromDomain(domain) {
  const host = String(domain || '')
    .replace(/^www\./i, '')
    .trim()
  if (!host) return ''
  const base = host.split('.')[0] || host
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Collect every concrete source we can see in the event block:
 * favicon domains, markdown links, bare https URLs.
 * We never invent sources that are not present in the scraped text.
 */
function extractSources(block) {
  const sources = []
  const seen = new Set()

  function addSource({ domain, url, title }) {
    const cleanDomain = String(domain || '')
      .toLowerCase()
      .replace(/^www\./, '')
      .trim()
    const cleanUrl = String(url || (cleanDomain ? `https://${cleanDomain}` : '')).trim()
    if (!cleanDomain && !cleanUrl) return
    // Not an external news source — skip Perplexity chrome / self links.
    if (cleanDomain === 'perplexity.ai' || /\.perplexity\.ai$/i.test(cleanDomain)) return
    const key = cleanUrl || cleanDomain
    if (seen.has(key) || (cleanDomain && seen.has(cleanDomain))) return
    seen.add(key)
    if (cleanDomain) seen.add(cleanDomain)
    sources.push({
      title: title || titleFromDomain(cleanDomain) || cleanDomain || cleanUrl,
      domain: cleanDomain || null,
      url: cleanUrl || null,
    })
  }

  const text = String(block || '')

  // Google favicon chips: domain=example.com
  const faviconRe = /domain=([a-z0-9.-]+\.[a-z]{2,})/gi
  let match
  while ((match = faviconRe.exec(text)) !== null) {
    addSource({ domain: match[1], url: `https://${match[1]}` })
  }

  // Markdown links [title](url)
  const mdLinkRe = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi
  while ((match = mdLinkRe.exec(text)) !== null) {
    try {
      const u = new URL(match[2])
      if (/google\.com\/s2\/favicons/i.test(u.href)) continue
      if (/perplexity\.ai$/i.test(u.hostname.replace(/^www\./, ''))) continue
      addSource({
        title: match[1]?.trim() || titleFromDomain(u.hostname),
        domain: u.hostname.replace(/^www\./, ''),
        url: u.href,
      })
    } catch {
      // ignore bad urls
    }
  }

  // Bare URLs
  const bareRe = /https?:\/\/[^\s)\]>"']+/gi
  while ((match = bareRe.exec(text)) !== null) {
    try {
      const u = new URL(match[0].replace(/[.,;:]+$/, ''))
      if (/google\.com\/s2\/favicons/i.test(u.href)) continue
      if (/perplexity\.ai$/i.test(u.hostname.replace(/^www\./, ''))) continue
      addSource({
        domain: u.hostname.replace(/^www\./, ''),
        url: u.href,
      })
    } catch {
      // ignore
    }
  }

  return sources
}

/**
 * Infer up/down from the day's narrative. Prefer the opening sentence so a
 * past-week "selloff" mention does not flip a rebound day to negative.
 */
function inferMoveDirection(summary) {
  const text = String(summary || '')
  const head = text.slice(0, 200)

  const downHead =
    /\b(declined|fell|dropped|slid|slipped|tumbled|plunged|retreat(?:ed)?|sold off|closed (?:modestly |slightly |somewhat )?lower|shares fell|is falling|traded lower|moved lower)\b/i.test(
      head,
    )
  const upHead =
    /\b(rose|rising|surged|rallied|gained|climbed|jumped|advanced|rebounded|bounced|edged higher|closed (?:modestly |slightly |somewhat )?higher|shares rose|is rising|traded higher|moved higher|outperformed)\b/i.test(
      head,
    )

  if (downHead && !upHead) return 'down'
  if (upHead && !downHead) return 'up'

  if (
    /\b(shares fell|declined alongside|closed lower|fell roughly|fell over|fell amid|dropped roughly|sold off as)\b/i.test(
      text,
    )
  ) {
    return 'down'
  }
  if (
    /\b(shares rose|surged over|rallied strongly|closed higher|edged higher|is rising|gained nearly|rose modestly|closed modestly higher)\b/i.test(
      text,
    )
  ) {
    return 'up'
  }
  return null
}

/**
 * Perplexity often prints unsigned "2.21%" even on down days.
 * Prefer an explicit +/- from the page; otherwise infer from the summary language.
 * Never force everything to positive.
 */
function normalizeSignedChange(priceChange, summary) {
  if (priceChange == null || priceChange === '') return null
  const raw = String(priceChange).trim()
  const numeric = raw.replace(/^[+\-]/, '').trim()
  if (!numeric) return raw

  if (raw.startsWith('-')) return `-${numeric}`
  if (raw.startsWith('+')) return `+${numeric}`

  const direction = inferMoveDirection(summary)
  if (direction === 'down') return `-${numeric}`
  if (direction === 'up') return `+${numeric}`
  // Ambiguous / flat — keep unsigned rather than inventing a sign
  return numeric
}

function eventContentFingerprint(event) {
  const sources = Array.isArray(event?.sources)
    ? event.sources
        .map((s) => `${s?.domain || ''}|${s?.url || ''}|${s?.title || ''}`)
        .sort()
        .join(';')
    : ''
  const reasons = Array.isArray(event?.reasons) ? event.reasons.join('|') : ''
  return JSON.stringify({
    event_date: event?.event_date || '',
    price: event?.price || '',
    price_change: event?.price_change || event?.momentum || '',
    summary: (event?.summary || '').trim(),
    reasons,
    sources,
  })
}

/**
 * Normalize any historical shape of notable_price_movements into a flat
 * date → event map. Supports:
 *   v2: { dates: { "YYYY-MM-DD": event } }
 *   v1: { events_by_date: { … } }
 *   legacy: { "YYYY-MM-DD": event, … }
 */
function extractDatesMap(notable) {
  if (!notable || typeof notable !== 'object' || Array.isArray(notable)) return {}

  if (notable.dates && typeof notable.dates === 'object' && !Array.isArray(notable.dates)) {
    return Object.fromEntries(
      Object.entries(notable.dates).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)),
    )
  }

  if (
    notable.events_by_date &&
    typeof notable.events_by_date === 'object' &&
    !Array.isArray(notable.events_by_date)
  ) {
    return Object.fromEntries(
      Object.entries(notable.events_by_date).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)),
    )
  }

  return Object.fromEntries(
    Object.entries(notable).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)),
  )
}

function normalizeEventRow(event) {
  const eventDate = String(event?.event_date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null

  const sources = Array.isArray(event?.sources) ? event.sources : []
  const reasons = Array.isArray(event?.reasons)
    ? event.reasons
    : event?.summary
      ? [event.summary]
      : []

  return {
    event_date: eventDate,
    display_date: event?.display_date || null,
    time_label: event?.time_label || null,
    price: event?.price || null,
    price_change: event?.price_change || event?.momentum || null,
    momentum: event?.momentum || event?.price_change || null,
    summary: event?.summary || '',
    reasons,
    sources,
    source_count: sources.length,
    claimed_source_count: event?.claimed_source_count ?? null,
    content_fingerprint: eventContentFingerprint({
      event_date: eventDate,
      price: event?.price || null,
      price_change: event?.price_change || event?.momentum || null,
      summary: event?.summary || '',
      reasons,
      sources,
    }),
  }
}

/**
 * Classify scraped events against already-saved dates for a ticker.
 * status: "new" | "changed" | "saved"
 */
function classifyEventsAgainstSaved(events, existingDates) {
  const saved = existingDates && typeof existingDates === 'object' ? existingDates : {}
  let newCount = 0
  let changedCount = 0
  let savedCount = 0

  const classified = (Array.isArray(events) ? events : []).map((raw) => {
    const row = normalizeEventRow(raw)
    if (!row) {
      return { ...raw, save_status: 'invalid' }
    }
    const previous = saved[row.event_date]
    if (!previous) {
      newCount += 1
      return { ...raw, ...row, save_status: 'new' }
    }
    const prevFp =
      previous.content_fingerprint || eventContentFingerprint(previous)
    if (prevFp === row.content_fingerprint) {
      savedCount += 1
      return {
        ...raw,
        ...row,
        save_status: 'saved',
        previously_saved_at: previous.saved_at || null,
      }
    }
    changedCount += 1
    return {
      ...raw,
      ...row,
      save_status: 'changed',
      previously_saved_at: previous.saved_at || null,
    }
  })

  return {
    events: classified,
    summary: {
      total: classified.length,
      new: newCount,
      changed: changedCount,
      already_saved: savedCount,
    },
  }
}

function buildNotablePayload({ ticker, dates, sourceUrl, scrapedAt, nowIso }) {
  const stamp = nowIso || new Date().toISOString()
  // Primary structure is `dates` (ticker → date-wise segregation).
  // Keep `events_by_date` as a mirror for any older readers.
  return {
    version: 2,
    ticker,
    updated_at: stamp,
    last_scraped_at: scrapedAt || stamp,
    source_url: sourceUrl || perplexityFinanceUrl(ticker),
    dates,
    events_by_date: dates,
  }
}

/**
 * Merge only the given events into the existing dates map.
 * Unrelated dates are left untouched — never a full replace of history.
 */
function mergeDatesIntoMap(existingDates, eventsToWrite, nowIso) {
  const next = { ...(existingDates || {}) }
  const written = []
  const skipped = []

  for (const event of eventsToWrite) {
    const row = normalizeEventRow(event)
    if (!row) {
      skipped.push({ reason: 'invalid_date', event })
      continue
    }
    next[row.event_date] = {
      ...row,
      saved_at: nowIso,
    }
    written.push(row.event_date)
  }

  return { dates: next, written, skipped }
}

async function loadTickerDates(supabase, ticker) {
  const { data, error } = await supabase
    .from('device_monitored_tickers')
    .select('ticker, notable_price_movements')
    .eq('ticker', ticker)

  if (error) throw error
  if (!data?.length) return { rows: [], dates: {}, found: false }

  // Multiple device rows may share a ticker — merge all date maps (union).
  const dates = {}
  for (const row of data) {
    Object.assign(dates, extractDatesMap(row.notable_price_movements))
  }
  return { rows: data, dates, found: true }
}

async function persistTickerDates(supabase, ticker, payload) {
  const nowIso = payload.updated_at || new Date().toISOString()

  // Prefer exact ticker match first.
  let { data, error } = await supabase
    .from('device_monitored_tickers')
    .update({
      notable_price_movements: payload,
      updated_at: nowIso,
    })
    .eq('ticker', ticker)
    .select('ticker, company_name, notable_price_movements, updated_at')

  if (error) throw error

  // Case-insensitive fallback (e.g. row stored as "aapl").
  if (!data?.length) {
    ;({ data, error } = await supabase
      .from('device_monitored_tickers')
      .update({
        notable_price_movements: payload,
        updated_at: nowIso,
      })
      .ilike('ticker', ticker)
      .select('ticker, company_name, notable_price_movements, updated_at'))
    if (error) throw error
  }

  if (!data?.length) {
    throw new Error(
      `Supabase update matched 0 rows for ticker ${ticker}. ` +
        'Check the ticker exists in device_monitored_tickers and that the service role can UPDATE (RLS).',
    )
  }
  return data
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
// Expo rejects a batch when its tokens belong to different projects.
// Sending one message per request keeps mixed dev/preview/production tokens isolated.
const EXPO_PUSH_BATCH = 1

function isExpoPushToken(token) {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(token.trim())
}

function normalizeNotificationApp(value) {
  const app = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
  return app === 'trigger' || app === 'triggerapp' ? 'trigger' : 'nineam'
}

function subscriberNotificationApp(subscriber) {
  const explicit =
    subscriber?.app_key ??
    subscriber?.app ??
    subscriber?.app_id ??
    subscriber?.app_name ??
    subscriber?.project ??
    subscriber?.project_id
  // Existing subscriber records predate app tagging and belong to 9AM.
  return explicit == null || explicit === ''
    ? 'nineam'
    : normalizeNotificationApp(explicit)
}

/**
 * Collect enabled subscribers with valid Expo tokens from ticker row(s).
 * Dedupes by token (same phone subscribed once even if listed twice).
 */
function collectPushRecipients(rows, appKey = 'nineam') {
  const selectedApp = normalizeNotificationApp(appKey)
  const byToken = new Map()
  for (const row of rows || []) {
    const subs = Array.isArray(row?.subscribers) ? row.subscribers : []
    for (const sub of subs) {
      if (!sub || sub.enabled === false) continue
      if (subscriberNotificationApp(sub) !== selectedApp) continue
      const token = String(sub.expo_push_token || '').trim()
      if (!isExpoPushToken(token)) continue
      if (byToken.has(token)) continue
      byToken.set(token, {
        device_id: sub.device_id || null,
        expo_push_token: token,
        enabled: sub.enabled !== false,
        app_key: selectedApp,
      })
    }
  }
  return [...byToken.values()]
}

function latestMovementEvent(notable) {
  const dates = extractDatesMap(notable)
  const keys = Object.keys(dates).sort().reverse()
  if (!keys.length) return null
  return dates[keys[0]] || null
}

/**
 * Normalize momentum for the notification title, e.g. "+1.2%" / "-0.8%".
 */
function formatMomentumForTitle(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  // Already signed
  if (s.startsWith('+') || s.startsWith('-') || s.startsWith('−')) return s.replace(/^−/, '-')
  // Bare percent / number → treat as positive if non-zero
  const n = Number.parseFloat(s.replace(/%/g, '').replace(/,/g, ''))
  if (!Number.isFinite(n) || n === 0) {
    return s.includes('%') ? s : `${s}%`
  }
  const withPct = s.includes('%') ? s.replace(/^[+-]?/, '') : `${Math.abs(n)}%`
  return n < 0 ? `-${withPct.replace(/^-/, '')}` : `+${withPct.replace(/^\+/, '')}`
}

/**
 * Strip date / time / price / % / "N sources" noise so the push body is
 * only the narrative reason — nothing else on line 2.
 */
function reasonTextOnly(event) {
  const parts = []
  if (Array.isArray(event?.reasons)) {
    for (const r of event.reasons) {
      const t = String(r || '').trim()
      if (t) parts.push(t)
    }
  }
  const summary = String(event?.summary || '').trim()
  if (summary && !parts.includes(summary)) parts.unshift(summary)

  let text = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (!text) return ''

  // Peel off leading metadata fragments that sometimes leak into summary.
  // Repeat a few times in case several tokens are stacked at the start.
  for (let i = 0; i < 8; i += 1) {
    const before = text
    text = text
      // ISO date
      .replace(/^\d{4}-\d{2}-\d{2}\b[\s,·|:—-]*/i, '')
      // "Jul 21" / "July 21, 2026"
      .replace(
        /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{4})?\b[\s,·|:—-]*/i,
        '',
      )
      // time "10:32 AM ET"
      .replace(/^\d{1,2}:\d{2}\s*(?:AM|PM)?\s*(?:ET|EST|EDT|PT|UTC)?\b[\s,·|:—-]*/i, '')
      // price "$210.12" / "$1,234"
      .replace(/^\$[\d,]+(?:\.\d+)?\b[\s,·|:—-]*/i, '')
      // momentum "+1.2%" / "-0.8%" / "1.2%"
      .replace(/^[+\-−]?\d+(?:\.\d+)?%\b[\s,·|:—-]*/i, '')
      // "3 sources"
      .replace(/^\d+\s+sources?\b[\s,·|:—-]*/i, '')
      // leading separators
      .replace(/^[\s,·|:—-]+/, '')
      .trim()
    if (text === before) break
  }

  return text
}

/**
 * Push copy for a notable move:
 *   title (line 1):  "AAPL +1.2% · Notable move"
 *   body  (line 2):  reason only — no date, price, time, or %
 */
function buildAlertMessage({
  ticker,
  companyName,
  event,
  titleOverride,
  bodyOverride,
  appKey = 'nineam',
}) {
  const changeRaw = event?.price_change || event?.momentum || ''
  const change = formatMomentumForTitle(changeRaw)
  const reason = reasonTextOnly(event)

  const sym = String(ticker || '').trim().toUpperCase() || 'TICKER'
  const company = companyName || sym
  const notificationApp = normalizeNotificationApp(appKey)
  const deepLinkScheme = notificationApp === 'trigger' ? 'trigger' : 'nineam'
  const eventDate = event?.event_date || null
  const price = event?.price || null
  const priceChange = event?.price_change || event?.momentum || null
  const deepLink = eventDate
    ? `${deepLinkScheme}://ticker/${encodeURIComponent(sym)}?kind=notable_move&event_date=${encodeURIComponent(eventDate)}`
    : `${deepLinkScheme}://ticker/${encodeURIComponent(sym)}?kind=notable_move`

  // Line 1 — symbol + signed momentum · Notable move
  const title =
    (titleOverride && String(titleOverride).trim()) ||
    (change ? `${sym} ${change} · Notable move` : `${sym} · Notable move`)

  // Line 2 — reason text only (never date / price / momentum)
  let body = bodyOverride && String(bodyOverride).trim()
  if (!body) {
    body = reason || `New notable price movement for ${sym}.`
    if (body.length > 400) body = `${body.slice(0, 397)}…`
  }

  // Deep-link metadata for the mobile app (tap → Monitor with this ticker).
  // Expo/FCM on Android requires string key-values — never send nulls/objects
  // or the entire `data` bag can be dropped and the client only sees title/body.
  const str = (v) => (v == null || v === '' ? '' : String(v));
  const data = {
    // Routing
    type: 'notable_price_movement',
    kind: 'notable_move',
    screen: 'notable_move',
    path: `/ticker/${encodeURIComponent(sym)}`,
    app_key: notificationApp,
    deep_link: deepLink,
    url: deepLink,
    app_url: deepLink,

    // Identity
    ticker: sym,
    company_name: str(company) || sym,

    // Event snapshot (all strings)
    event_date: str(eventDate),
    display_date: str(event?.display_date),
    time_label: str(event?.time_label),
    price: str(price),
    price_change: str(priceChange),
    momentum: str(event?.momentum || priceChange),
    reason: str(reason),
    summary: str(reason),

    // What the user saw on the notification
    notification_title: str(title),
    notification_body: str(body),
  }

  return {
    title,
    body,
    data,
  }
}

/** Strip exchange prefixes like "NASDAQ:NVDA" → "NVDA". */
function normalizeTickerSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9]+:/, '')
    .replace(/[^A-Z0-9.^_-]/g, '')
}

/**
 * Map various sentiment labels → bullish | bearish | neutral.
 */
function mapSentimentToSide(label) {
  const s = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
  if (!s) return null
  if (
    s === 'positive' ||
    s === 'bullish' ||
    s === 'somewhat-bullish' ||
    s === 'buy' ||
    s === 'strongly-bullish'
  ) {
    return 'bullish'
  }
  if (
    s === 'negative' ||
    s === 'bearish' ||
    s === 'somewhat-bearish' ||
    s === 'sell' ||
    s === 'strongly-bearish'
  ) {
    return 'bearish'
  }
  if (s === 'neutral' || s === 'mixed') return 'neutral'
  // numeric score if someone passes it as string
  const n = Number.parseFloat(s)
  if (Number.isFinite(n)) {
    if (n > 0.15) return 'bullish'
    if (n < -0.15) return 'bearish'
    return 'neutral'
  }
  return null
}

/** Arrow for push header: bullish ↑ · bearish ↓ · neutral = no arrow */
function sideArrow(side) {
  if (side === 'bullish') return '↑'
  if (side === 'bearish') return '↓'
  return ''
}

/**
 * Build news push header line:
 *   "NVDA ↑ · AAPL ↓ · MSFT →"
 * Sentiment from raw_json.insights / editor_ticker_details / ticker_sentiment.
 */
function buildNewsImpactBody(article) {
  const raw = article?.raw_json && typeof article.raw_json === 'object' ? article.raw_json : {}
  const sentimentByTicker = new Map()

  const absorb = (ticker, label) => {
    const sym = normalizeTickerSymbol(ticker)
    if (!sym || sentimentByTicker.has(sym)) return
    const side = mapSentimentToSide(label)
    if (side) sentimentByTicker.set(sym, side)
  }

  for (const item of Array.isArray(raw.insights) ? raw.insights : []) {
    absorb(item?.ticker, item?.sentiment || item?.sentiment_label)
  }
  for (const item of Array.isArray(raw.editor_ticker_details)
    ? raw.editor_ticker_details
    : []) {
    absorb(item?.ticker, item?.sentiment_label || item?.sentiment)
  }
  for (const item of Array.isArray(raw.ticker_sentiment) ? raw.ticker_sentiment : []) {
    absorb(
      item?.ticker,
      item?.ticker_sentiment_label || item?.sentiment_label || item?.sentiment,
    )
  }

  const overall =
    mapSentimentToSide(article?.sentiment_label) ||
    mapSentimentToSide(article?.sentiment_score) ||
    'neutral'

  const tickers = Array.isArray(article?.tickers) ? article.tickers : []
  const sides = []
  const seen = new Set()

  for (const t of tickers) {
    const sym = normalizeTickerSymbol(t)
    if (!sym || seen.has(sym)) continue
    seen.add(sym)
    // Prefer bullish/bearish; if only neutral known, still show it.
    const side = sentimentByTicker.get(sym) || overall
    sides.push({ ticker: sym, side, arrow: sideArrow(side) })
  }

  // If article.tickers empty but insights have tickers, use those.
  if (!sides.length) {
    for (const [sym, side] of sentimentByTicker) {
      sides.push({ ticker: sym, side, arrow: sideArrow(side) })
    }
  }

  // Header: "NVDA ↑ · AAPL ↓ · MSFT" (bullish ↑, bearish ↓, neutral = symbol only)
  const body = sides
    .map((s) => (s.arrow ? `${s.ticker} ${s.arrow}` : s.ticker))
    .join(' · ')
  return { body, sides }
}

/**
 * Full headline for push title: collapse whitespace / newlines, never ellipsis-truncate.
 * Keeps the complete article title so the notification shows the full headline.
 */
function normalizeNotificationHeadline(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function sendExpoPushMessages(messages) {
  const tickets = []
  const errors = []
  const expoAccessToken = String(process.env.EXPO_ACCESS_TOKEN || '').trim()

  for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH) {
    const batch = messages.slice(i, i + EXPO_PUSH_BATCH)
    // Never send internal bookkeeping fields to Expo.
    const payload = batch.map(({ _device_id, ...msg }) => {
      void _device_id
      return msg
    })
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        ...(expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { raw: text }
    }
    if (!response.ok) {
      errors.push({
        batch_start: i,
        failed_count: batch.length,
        device_ids: batch.map((message) => message._device_id).filter(Boolean),
        status: response.status,
        error: body?.errors || body?.error || body?.message || `Expo push failed (${response.status})`,
        response: body,
      })
      continue
    }
    const data = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : []
    for (let j = 0; j < data.length; j += 1) {
      const ticket = data[j] || {}
      const msg = batch[j] || {}
      tickets.push({
        status: ticket.status || 'unknown',
        id: ticket.id || null,
        message: ticket.message || null,
        details: ticket.details || null,
        to: msg.to || null,
        device_id: msg._device_id || null,
      })
    }
  }

  const ok = tickets.filter((t) => t.status === 'ok').length
  const failed =
    tickets.filter((t) => t.status !== 'ok').length +
    errors.reduce((total, error) => total + (error.failed_count || 1), 0)
  return { tickets, errors, ok, failed }
}

function expoFailureSummary(pushResult) {
  const failedTicket = pushResult?.tickets?.find((ticket) => ticket.status !== 'ok')
  if (failedTicket?.message) {
    const code = failedTicket.details?.error
    return code ? `${code}: ${failedTicket.message}` : failedTicket.message
  }
  const gatewayError = pushResult?.errors?.[0]
  const detail = gatewayError?.error
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.message || item?.error || JSON.stringify(item))
      .filter(Boolean)
      .join('; ')
  }
  if (detail && typeof detail === 'object') {
    return detail.message || detail.error || JSON.stringify(detail)
  }
  return ''
}

/**
 * Parse Perplexity finance markdown "Notable Price Movement" section
 * into structured timeline events (past ~30 days when filtered).
 */
export function parseNotablePriceMovements(markdown, { days = 30 } = {}) {
  const text = String(markdown || '')
  // Note: JS has no \Z — use $ for end-of-string (do not use \Z or it matches literal "Z").
  const sectionMatch = text.match(
    /##\s*Notable Price Movement\s*\n([\s\S]*?)(?=\n##\s+|\nView more\b|$)/i,
  )
  const section = sectionMatch ? sectionMatch[1] : ''
  if (!section.trim()) {
    return { events: [], sectionFound: Boolean(sectionMatch), rawSection: section }
  }

  const chunks = section.split(
    /(?=^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s*$)/im,
  )
  const now = new Date()
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const events = []

  for (const chunk of chunks) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    const lines = trimmed.split(/\n/).map((line) => line.trim())
    const dateLine = lines[0] || ''
    if (!/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/i.test(dateLine)) {
      continue
    }

    const eventDate = parseDisplayDateToIso(dateLine, now)
    if (!eventDate) continue
    const eventTime = new Date(`${eventDate}T12:00:00.000Z`)
    if (eventTime < cutoff) continue

    let timeLabel = null
    let price = null
    let priceChange = null
    const bodyLines = []

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i]
      if (!line) continue
      if (/^\d{1,2}:\d{2}\s*(AM|PM)\s*ET$/i.test(line) && !timeLabel) {
        timeLabel = line
        continue
      }
      if (/^\$[\d,]+(?:\.\d+)?$/.test(line) && !price) {
        price = line
        continue
      }
      if (/^[+\-]?\d+(?:\.\d+)?%$/.test(line) && !priceChange) {
        priceChange = line
        continue
      }
      if (/^\d+\s+sources?$/i.test(line)) continue
      if (/^!\[/.test(line)) continue
      if (/^View more$/i.test(line)) continue
      bodyLines.push(line)
    }

    const summary = bodyLines.join(' ').replace(/\s+/g, ' ').trim()
    const sources = extractSources(trimmed)
    const claimedMatch = trimmed.match(/(\d+)\s+sources?/i)
    const claimedSourceCount = claimedMatch ? Number(claimedMatch[1]) : null
    const signedChange = normalizeSignedChange(priceChange, summary)

    events.push({
      event_date: eventDate,
      display_date: dateLine,
      time_label: timeLabel,
      price,
      price_change: signedChange,
      momentum: signedChange,
      summary,
      reasons: summary ? [summary] : [],
      sources,
      // Always reflect exact extracted sources — never pad / invent extras.
      source_count: sources.length,
      claimed_source_count: claimedSourceCount,
    })
  }

  // Newest first
  events.sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)))

  return { events, sectionFound: true, rawSection: section }
}

export async function scrapePerplexityNotableMovements(ticker) {
  const cleanTicker = normalizeTicker(ticker)
  if (!cleanTicker) throw new Error('Ticker is required')

  const url = perplexityFinanceUrl(cleanTicker)
  const logs = []
  const pushLog = (level, message, detail) => {
    logs.push({
      at: new Date().toISOString(),
      level,
      message,
      detail: detail ?? null,
    })
  }

  pushLog('info', `Starting Firecrawl scrape for ${cleanTicker}`, { url })

  let creditsBefore = null
  try {
    creditsBefore = await getFirecrawlCreditUsage()
    pushLog('info', 'Firecrawl balance (before scrape)', {
      remaining_credits: creditsBefore.remaining_credits,
      plan_credits: creditsBefore.plan_credits,
      billing_period_end: creditsBefore.billing_period_end,
    })
  } catch (error) {
    pushLog('warn', 'Could not fetch Firecrawl balance before scrape', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const scrapeStarted = Date.now()
  const scrapeBody = await firecrawlFetch('/scrape', {
    method: 'POST',
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: false,
      waitFor: 8000,
      timeout: 90000,
      // Fresh scrape for live finance pages
      maxAge: 0,
      actions: [{ type: 'wait', milliseconds: 4000 }],
    }),
  })
  const scrapeDurationMs = Date.now() - scrapeStarted

  const markdown = scrapeBody?.data?.markdown || ''
  pushLog('info', 'Firecrawl scrape completed', {
    duration_ms: scrapeDurationMs,
    markdown_chars: markdown.length,
    status_code: scrapeBody?.data?.metadata?.statusCode ?? null,
    title: scrapeBody?.data?.metadata?.title ?? null,
  })

  let creditsAfter = null
  let creditsUsed = null
  try {
    creditsAfter = await getFirecrawlCreditUsage()
    if (
      creditsBefore?.remaining_credits != null &&
      creditsAfter?.remaining_credits != null
    ) {
      creditsUsed = Math.max(
        0,
        Number(creditsBefore.remaining_credits) - Number(creditsAfter.remaining_credits),
      )
    }
    pushLog('info', 'Firecrawl balance (after scrape)', {
      remaining_credits: creditsAfter.remaining_credits,
      plan_credits: creditsAfter.plan_credits,
      credits_used_this_scrape: creditsUsed,
      billing_period_end: creditsAfter.billing_period_end,
    })
  } catch (error) {
    pushLog('warn', 'Could not fetch Firecrawl balance after scrape', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const parsed = parseNotablePriceMovements(markdown, { days: 30 })
  pushLog(
    parsed.events.length ? 'success' : 'warn',
    parsed.sectionFound
      ? `Parsed ${parsed.events.length} notable movement event(s) in past 30 days`
      : 'Notable Price Movement section not found in page markdown',
    { event_count: parsed.events.length },
  )

  // Log exact per-event sources + signed change for the right-side log panel.
  for (const event of parsed.events.slice(0, 40)) {
    pushLog('info', `${event.event_date} · change ${event.price_change || 'n/a'} · ${event.sources.length} source(s)`, {
      event_date: event.event_date,
      price: event.price,
      price_change: event.price_change,
      claimed_source_count: event.claimed_source_count,
      extracted_source_count: event.sources.length,
      sources: event.sources,
    })
  }

  return {
    ticker: cleanTicker,
    url,
    scraped_at: new Date().toISOString(),
    events: parsed.events,
    section_found: parsed.sectionFound,
    credits: {
      before: creditsBefore,
      after: creditsAfter,
      used: creditsUsed,
    },
    logs,
    markdown_preview: markdown.slice(0, 4000),
  }
}

export function createNotificationsRouter({ getSupabase }) {
  // Express 5-compatible router factory without depending on express import order
  return {
    async listTickers(request, response) {
      try {
        const appKey = normalizeNotificationApp(request.query?.app)
        const supabase = getSupabase()
        let data = null
        let error = null

        ;({ data, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, company_name, created_at, updated_at, notable_price_movements, subscribers')
          .order('ticker', { ascending: true }))

        // Column may not exist until schema_device_monitored_tickers.sql is applied.
        if (error && /notable_price_movements/i.test(error.message || '')) {
          ;({ data, error } = await supabase
            .from('device_monitored_tickers')
            .select('ticker, company_name, created_at, updated_at, subscribers')
            .order('ticker', { ascending: true }))
        }

        if (error) throw error

        // Deduplicate device rows by ticker; merge date maps so one tab = one ticker.
        const byTicker = new Map()
        for (const row of data || []) {
          const ticker = normalizeTicker(row.ticker)
          if (!ticker) continue
          const dates = extractDatesMap(row.notable_price_movements)
          const recipients = collectPushRecipients([row], appKey)
          const existing = byTicker.get(ticker)
          if (!existing) {
            byTicker.set(ticker, {
              ticker,
              company_name: row.company_name || ticker,
              created_at: row.created_at,
              updated_at: row.updated_at,
              dates: { ...dates },
              last_saved_at: row.notable_price_movements?.updated_at || null,
              recipients: recipients.slice(),
            })
            continue
          }
          Object.assign(existing.dates, dates)
          if (row.company_name && existing.company_name === ticker) {
            existing.company_name = row.company_name
          }
          const rowSavedAt = row.notable_price_movements?.updated_at || null
          if (
            rowSavedAt &&
            (!existing.last_saved_at || String(rowSavedAt) > String(existing.last_saved_at))
          ) {
            existing.last_saved_at = rowSavedAt
          }
          const seen = new Set(existing.recipients.map((r) => r.expo_push_token))
          for (const r of recipients) {
            if (!seen.has(r.expo_push_token)) {
              existing.recipients.push(r)
              seen.add(r.expo_push_token)
            }
          }
        }

        const tickers = [...byTicker.values()]
          .map((item) => {
            const saved_event_count = Object.keys(item.dates).length
            return {
              ticker: item.ticker,
              company_name: item.company_name,
              created_at: item.created_at,
              updated_at: item.updated_at,
              has_saved_movements: saved_event_count > 0,
              saved_event_count,
              last_saved_at: item.last_saved_at,
              saved_dates: Object.keys(item.dates).sort().reverse(),
              saved_events: Object.values(item.dates)
                .map((event) => normalizeEventRow(event))
                .filter(Boolean)
                .sort((left, right) =>
                  String(right.event_date).localeCompare(String(left.event_date)),
                )
                .map((event) => ({ ...event, save_status: 'saved' })),
              subscriber_count: item.recipients.length,
              device_ids: item.recipients.map((r) => r.device_id).filter(Boolean),
            }
          })
          .sort((a, b) => a.ticker.localeCompare(b.ticker))

        response.json({ ok: true, app_key: appKey, count: tickers.length, tickers })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to load monitored tickers',
        })
      }
    },

    async scrape(request, response) {
      try {
        const ticker = normalizeTicker(request.params.ticker || request.body?.ticker)
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }

        // ?auto_save=0 disables the default "save only new dates after scrape".
        const autoSaveRaw = request.query?.auto_save
        const autoSave =
          autoSaveRaw === undefined || autoSaveRaw === null || autoSaveRaw === ''
            ? true
            : !['0', 'false', 'no'].includes(String(autoSaveRaw).toLowerCase())

        const result = await scrapePerplexityNotableMovements(ticker)
        const supabase = getSupabase()
        const loaded = await loadTickerDates(supabase, ticker)
        const classified = classifyEventsAgainstSaved(result.events, loaded.dates)

        result.logs.push({
          at: new Date().toISOString(),
          level: 'info',
          message: `Compared scrape vs Supabase dates for ${ticker}`,
          detail: {
            already_in_db: Object.keys(loaded.dates).length,
            scrape_total: classified.summary.total,
            new: classified.summary.new,
            changed: classified.summary.changed,
            already_saved: classified.summary.already_saved,
          },
        })

        let autoSaveResult = null
        if (autoSave && classified.summary.new > 0) {
          if (!loaded.found) {
            autoSaveResult = {
              ok: false,
              mode: 'new_dates_only',
              inserted: 0,
              message: `Auto-save skipped — ${ticker} not found in device_monitored_tickers`,
            }
            result.logs.push({
              at: new Date().toISOString(),
              level: 'warn',
              message: autoSaveResult.message,
              detail: null,
            })
          } else {
            try {
              const nowIso = new Date().toISOString()
              const onlyNew = classified.events.filter((e) => e.save_status === 'new')
              const { dates, written } = mergeDatesIntoMap(loaded.dates, onlyNew, nowIso)
              const payload = buildNotablePayload({
                ticker,
                dates,
                sourceUrl: result.url,
                scrapedAt: result.scraped_at,
                nowIso,
              })
              const rows = await persistTickerDates(supabase, ticker, payload)
              autoSaveResult = {
                ok: true,
                mode: 'new_dates_only',
                inserted: written.length,
                inserted_dates: written,
                unchanged: classified.summary.already_saved,
                changed_not_auto_saved: classified.summary.changed,
                total_saved_events: Object.keys(dates).length,
                message:
                  written.length > 0
                    ? `Auto-saved ${written.length} new date(s) to Supabase: ${written.join(', ')}. Already-saved dates left untouched.`
                    : 'No new dates to auto-save.',
                rows_updated: rows.length,
              }
              result.logs.push({
                at: new Date().toISOString(),
                level: 'success',
                message: autoSaveResult.message,
                detail: {
                  inserted_dates: written,
                  total_saved_events: autoSaveResult.total_saved_events,
                  rows_updated: rows.length,
                  structure: 'notable_price_movements.dates[YYYY-MM-DD]',
                },
              })

              // Only mark as saved in UI after a real DB write succeeded.
              const after = classifyEventsAgainstSaved(result.events, dates)
              classified.events = after.events
              classified.summary = after.summary
            } catch (saveError) {
              // Scrape still succeeds — surface auto-save failure clearly.
              const message =
                saveError instanceof Error ? saveError.message : 'Auto-save to Supabase failed'
              autoSaveResult = {
                ok: false,
                mode: 'new_dates_only',
                inserted: 0,
                message,
              }
              result.logs.push({
                at: new Date().toISOString(),
                level: 'error',
                message: `Auto-save failed: ${message}`,
                detail: null,
              })
            }
          }
        } else if (autoSave && classified.summary.new === 0) {
          autoSaveResult = {
            ok: true,
            mode: 'new_dates_only',
            inserted: 0,
            inserted_dates: [],
            unchanged: classified.summary.already_saved,
            changed_not_auto_saved: classified.summary.changed,
            total_saved_events: Object.keys(loaded.dates).length,
            message:
              classified.summary.total === 0
                ? 'Nothing to save — no events in scrape.'
                : `No new dates to write — ${classified.summary.already_saved} already in Supabase` +
                  (classified.summary.changed
                    ? `, ${classified.summary.changed} content-changed (use Save to update those).`
                    : '.'),
          }
          result.logs.push({
            at: new Date().toISOString(),
            level: 'info',
            message: autoSaveResult.message,
            detail: classified.summary,
          })
        }

        response.json({
          ok: true,
          ...result,
          events: classified.events,
          compare: classified.summary,
          auto_save: autoSaveResult,
        })
      } catch (error) {
        response.status(error.status && error.status < 500 ? error.status : 500).json({
          error: error instanceof Error ? error.message : 'Scrape failed',
          detail: error.body || null,
        })
      }
    },

    async save(request, response) {
      try {
        const ticker = normalizeTicker(request.params.ticker || request.body?.ticker)
        const events = Array.isArray(request.body?.events) ? request.body.events : []
        // Default: only new + content-changed. Pass only_new=true to skip updates.
        const onlyNew = Boolean(request.body?.only_new)
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }
        if (!events.length) {
          response.status(400).json({ error: 'No events to save. Refresh/scrape first.' })
          return
        }

        const supabase = getSupabase()
        const loaded = await loadTickerDates(supabase, ticker)
        if (!loaded.found) {
          response.status(404).json({
            error: `Ticker ${ticker} not found in device_monitored_tickers`,
          })
          return
        }

        const classified = classifyEventsAgainstSaved(events, loaded.dates)
        const toWrite = classified.events.filter((event) =>
          onlyNew ? event.save_status === 'new' : event.save_status === 'new' || event.save_status === 'changed',
        )
        const skippedSaved = classified.events.filter((e) => e.save_status === 'saved')

        if (!toWrite.length) {
          response.json({
            ok: true,
            ticker,
            changed: false,
            mode: onlyNew ? 'new_dates_only' : 'new_and_changed',
            inserted: 0,
            updated: 0,
            skipped_already_saved: skippedSaved.length,
            inserted_dates: [],
            updated_dates: [],
            total_saved_events: Object.keys(loaded.dates).length,
            message:
              skippedSaved.length > 0
                ? `No writes — all ${skippedSaved.length} date(s) already saved with the same content.`
                : 'No events to save.',
            structure: 'notable_price_movements.dates[YYYY-MM-DD]',
            dates: Object.keys(loaded.dates).sort().reverse(),
          })
          return
        }

        const nowIso = new Date().toISOString()
        const insertedDates = toWrite
          .filter((e) => e.save_status === 'new')
          .map((e) => e.event_date)
        const updatedDates = toWrite
          .filter((e) => e.save_status === 'changed')
          .map((e) => e.event_date)

        const { dates, written } = mergeDatesIntoMap(loaded.dates, toWrite, nowIso)
        const payload = buildNotablePayload({
          ticker,
          dates,
          sourceUrl: request.body?.source_url || perplexityFinanceUrl(ticker),
          scrapedAt: request.body?.scraped_at || nowIso,
          nowIso,
        })
        const rows = await persistTickerDates(supabase, ticker, payload)

        response.json({
          ok: true,
          ticker,
          changed: true,
          mode: onlyNew ? 'new_dates_only' : 'new_and_changed',
          inserted: insertedDates.length,
          updated: updatedDates.length,
          skipped_already_saved: skippedSaved.length,
          inserted_dates: insertedDates,
          updated_dates: updatedDates,
          written_dates: written,
          total_saved_events: Object.keys(dates).length,
          message: [
            insertedDates.length
              ? `Inserted ${insertedDates.length} new date(s): ${insertedDates.join(', ')}`
              : null,
            updatedDates.length
              ? `Updated ${updatedDates.length} changed date(s): ${updatedDates.join(', ')}`
              : null,
            skippedSaved.length
              ? `Skipped ${skippedSaved.length} already-saved date(s)`
              : null,
          ]
            .filter(Boolean)
            .join('. ') + '.',
          structure: 'notable_price_movements.dates[YYYY-MM-DD]',
          dates: Object.keys(dates).sort().reverse(),
          rows_updated: rows.length,
          row: rows[0] || null,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Save failed',
        })
      }
    },

    async credits(_request, response) {
      try {
        const usage = await getFirecrawlCreditUsage()
        response.json({ ok: true, credits: usage })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Credit usage fetch failed',
        })
      }
    },

    /**
     * All unique devices that have notifications enabled (any monitored ticker).
     */
    async listDevices(request, response) {
      try {
        const appKey = normalizeNotificationApp(request.query?.app)
        const supabase = getSupabase()
        const { data, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, subscribers')

        if (error) throw error

        const recipients = collectPushRecipients(data || [], appKey)
        // Map token → which tickers they subscribe to
        const tickerByToken = new Map()
        for (const row of data || []) {
          const ticker = normalizeTicker(row.ticker)
          for (const sub of Array.isArray(row.subscribers) ? row.subscribers : []) {
            if (!sub || sub.enabled === false) continue
            if (subscriberNotificationApp(sub) !== appKey) continue
            const token = String(sub.expo_push_token || '').trim()
            if (!isExpoPushToken(token)) continue
            if (!tickerByToken.has(token)) tickerByToken.set(token, new Set())
            if (ticker) tickerByToken.get(token).add(ticker)
          }
        }

        response.json({
          ok: true,
          app_key: appKey,
          count: recipients.length,
          devices: recipients.map((r) => ({
            device_id: r.device_id,
            expo_push_token: r.expo_push_token,
            tickers: [...(tickerByToken.get(r.expo_push_token) || [])].sort(),
          })),
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to load devices',
        })
      }
    },

    /**
     * News articles from Supabase market_news_articles (newest first).
     */
    async listNews(request, response) {
      try {
        const limit = Math.min(Math.max(Number(request.query.limit || 50), 1), 100)
        const offset = Math.max(Number(request.query.offset || 0), 0)
        const supabase = getSupabase()

        const { data, error, count } = await supabase
          .from('market_news_articles')
          .select(
            'id, provider, title, summary, url, image_url, source_name, author, published_at, tickers, topics, sentiment_label, sentiment_score, raw_json, created_at',
            { count: 'exact' },
          )
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1)

        if (error) throw error

        const articles = (data || []).map((row) => {
          const base = {
            id: String(row.id),
            provider: row.provider || null,
            title: row.title || 'Untitled',
            summary: row.summary || '',
            url: row.url || '',
            image_url: row.image_url || null,
            source_name: row.source_name || null,
            author: row.author || null,
            published_at: row.published_at || null,
            tickers: Array.isArray(row.tickers) ? row.tickers : [],
            topics: Array.isArray(row.topics) ? row.topics : [],
            sentiment_label: row.sentiment_label || null,
            created_at: row.created_at || null,
            raw_json: row.raw_json || null,
          }
          // Preview of push body line for the dashboard.
          const impact = buildNewsImpactBody(base)
          return {
            ...base,
            impact_body: impact.body,
            ticker_sides: impact.sides,
            raw_json: undefined,
          }
        })

        response.json({
          ok: true,
          count: articles.length,
          total: count ?? null,
          limit,
          offset,
          has_more: articles.length === limit,
          articles,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to load news',
        })
      }
    },

        /**
     * Push a news article (or custom title/body) to enabled devices.
     * News format:
     *   title (header): NVDA (bullish) · AAPL (bearish) · …
     *   body  (line 2): full article headline
     *   no image payload (text-only notification)
     *
     * Body: { article_id } or { title, body, url, article_id?, device_ids?, expo_push_tokens? }
     */
    async alertNews(request, response) {
      try {
        const appKey = normalizeNotificationApp(request.body?.app_key || request.query?.app)
        const deepLinkScheme = appKey === 'trigger' ? 'trigger' : 'nineam'
        const supabase = getSupabase()
        const articleId = request.body?.article_id || request.body?.id || null

        let article = null
        if (articleId) {
          const { data, error } = await supabase
            .from('market_news_articles')
            .select(
              'id, title, summary, url, image_url, source_name, published_at, tickers, provider, sentiment_label, sentiment_score, raw_json',
            )
            .eq('id', articleId)
            .maybeSingle()
          if (error) throw error
          if (!data) {
            response.status(404).json({ error: `Article ${articleId} not found` })
            return
          }
          article = data
        }

        const pushType =
          (request.body?.type && String(request.body.type).trim()) ||
          (articleId || article?.id ? 'news_alert' : 'custom_alert')

        // Full article headline — never truncate (used as body for news alerts).
        const headline = normalizeNotificationHeadline(
          (article?.title && String(article.title)) ||
            (request.body?.headline && String(request.body.headline)) ||
            '',
        )

        let title = ''
        let bodyText = ''
        let tickerSides = []

        if (pushType === 'custom_alert') {
          // Custom: free-form title + body as the user typed them.
          title =
            (request.body?.title && String(request.body.title).trim()) || headline || ''
          bodyText =
            (request.body?.body && String(request.body.body).trim()) ||
            (article?.summary && String(article.summary).trim()) ||
            ''
          if (bodyText.length > 800) bodyText = `${bodyText.slice(0, 797)}…`
        } else {
          // News: header = tickers · (bullish|bearish); body = full headline.
          if (request.body?.title && String(request.body.title).trim()) {
            // Explicit title override (rare) — still treat as header line.
            title = String(request.body.title).trim()
          } else if (article) {
            const built = buildNewsImpactBody(article)
            title = built.body || 'News alert'
            tickerSides = built.sides
          } else {
            title = 'News alert'
          }

          if (request.body?.body && String(request.body.body).trim()) {
            bodyText = String(request.body.body).trim()
          } else {
            bodyText = headline
          }

          if (!title) title = 'News alert'
          // Ticker header is usually short; soft-cap only if pathologically long.
          if (title.length > 500) title = `${title.slice(0, 497)}…`
          // Never truncate the headline body.
        }

        if (pushType === 'custom_alert' && !title) {
          response.status(400).json({
            error: 'Provide article_id or title for the news alert',
          })
          return
        }
        if (pushType === 'news_alert' && !bodyText) {
          response.status(400).json({
            error: 'Article has no headline to send',
          })
          return
        }
        if (!bodyText && pushType === 'custom_alert') {
          bodyText = title
        }
        if (!bodyText) {
          bodyText = title || 'News alert'
        }

        const { data: rows, error: rowsError } = await supabase
          .from('device_monitored_tickers')
          .select('subscribers')
        if (rowsError) throw rowsError

        let recipients = collectPushRecipients(rows || [], appKey)

        // Optional filter: only send to selected devices.
        // Accept device_ids: string[] and/or expo_push_tokens: string[]
        const selectedIds = Array.isArray(request.body?.device_ids)
          ? request.body.device_ids.map((id) => String(id || '').trim()).filter(Boolean)
          : []
        const selectedTokens = Array.isArray(request.body?.expo_push_tokens)
          ? request.body.expo_push_tokens
              .map((t) => String(t || '').trim())
              .filter(Boolean)
          : []
        if (selectedIds.length || selectedTokens.length) {
          const idSet = new Set(selectedIds)
          const tokenSet = new Set(selectedTokens)
          recipients = recipients.filter(
            (r) =>
              (r.device_id && idSet.has(String(r.device_id))) ||
              tokenSet.has(r.expo_push_token),
          )
        }

        if (!recipients.length) {
          response.status(400).json({
            error:
              selectedIds.length || selectedTokens.length
                ? 'No matching enabled devices for the selected IDs/tokens'
                : 'No enabled devices with Expo push tokens found',
            recipient_count: 0,
          })
          return
        }

        const url =
          (request.body?.url && String(request.body.url).trim()) ||
          article?.url ||
          null
        const tickers = Array.isArray(article?.tickers) ? article.tickers : []
        // Soft channel: only send channelId if client opts in. Unknown channelIds
        // on Android can prevent the notification from showing.
        // Default = omit → Expo/Android "Default" channel.
        const forceChannel =
          request.body?.channel_id != null
            ? String(request.body.channel_id).trim()
            : request.body?.use_named_channel === true
              ? pushType === 'custom_alert'
                ? 'custom-alert'
                : 'news-alert'
              : ''
        const resolvedArticleId = article?.id
          ? String(article.id)
          : articleId
            ? String(articleId)
            : null

        // Deep-link payload for the mobile app (tap → Home feed first card).
        // Expo/FCM Android: all values must be strings (nulls can drop the whole bag).
        const str = (v) => (v == null || v === '' ? '' : String(v))
        const summaryText = str(article?.summary).slice(0, 800)
        const tickerList = Array.isArray(tickers)
          ? tickers.map((t) => String(t || '').trim()).filter(Boolean)
          : []
        const appDeepLink =
          pushType === 'news_alert'
            ? resolvedArticleId
              ? `${deepLinkScheme}://news/${encodeURIComponent(resolvedArticleId)}`
              : `${deepLinkScheme}://news`
            : `${deepLinkScheme}://home`
        const newsData =
          pushType === 'news_alert'
            ? {
                // Routing
                type: 'news_alert',
                app_key: appKey,
                kind: 'news',
                screen: 'news',
                path: resolvedArticleId
                  ? `/news/${encodeURIComponent(resolvedArticleId)}`
                  : '/news',
                deep_link: appDeepLink,
                url: appDeepLink,
                app_url: appDeepLink,

                // Identity — several aliases so the app can read any common key
                article_id: str(resolvedArticleId),
                news_id: str(resolvedArticleId),
                id: str(resolvedArticleId),

                // Content — enough for a full NewsFeedItem before Supabase fetch
                article_url: str(url),
                headline: str(bodyText),
                summary: summaryText,
                notification_title: str(title),
                notification_body: str(bodyText),
                source_name: str(article?.source_name),
                published_at: str(article?.published_at),
                provider: str(article?.provider),
                // JSON strings only (native bridges drop nested arrays/objects)
                tickers: JSON.stringify(tickerList),
                ticker_sides_json: JSON.stringify(tickerSides || []),
              }
            : {
                type: 'custom_alert',
                app_key: appKey,
                kind: 'custom',
                screen: 'home',
                path: '/',
                deep_link: appDeepLink,
                url: appDeepLink,
                app_url: appDeepLink,
                article_id: str(resolvedArticleId),
                news_id: str(resolvedArticleId),
                id: str(resolvedArticleId),
                article_url: str(url),
                headline: str(title),
                summary: summaryText,
                notification_title: str(title),
                notification_body: str(bodyText),
                source_name: str(article?.source_name),
                tickers: JSON.stringify(tickerList),
                ticker_sides_json: JSON.stringify(tickerSides || []),
              }

        const messages = recipients.map((r) => {
          const msg = {
            to: r.expo_push_token,
            sound: 'default',
            title,
            body: bodyText,
            data: newsData,
            priority: 'high',
            _device_id: r.device_id,
          }
          if (forceChannel) {
            msg.channelId = forceChannel
          }
          return msg
        })

        // Sample of what Expo actually receives (first recipient, no token).
        const samplePayload = messages[0]
          ? (() => {
              const { _device_id, to, ...rest } = messages[0]
              void _device_id
              return {
                ...rest,
                to: to ? `${String(to).slice(0, 28)}…` : null,
                channelId: rest.channelId ?? null,
              }
            })()
          : null

        const pushResult = await sendExpoPushMessages(messages)
        const label = pushType === 'custom_alert' ? 'Custom alert' : 'News alert'
        const failureSummary = expoFailureSummary(pushResult)
        const imageNote = 'Text-only notification; image payload disabled.'

        response.json({
          ok: pushResult.failed === 0 && pushResult.errors.length === 0,
          app_key: appKey,
          type: pushType,
          article_id: article?.id ? String(article.id) : articleId || null,
          title,
          title_length: title.length,
          title_is_full_headline: true,
          body: bodyText,
          deep_link: newsData.deep_link,
          image_url: null,
          rich_content_attached: false,
          image_probe: {
            ok: false,
            url: null,
            reason: 'Image payload disabled',
            content_type: null,
            status: null,
          },
          image_note: imageNote,
          ios_nse_required: false,
          ios_nse_docs: null,
          channel_id: forceChannel || null,
          channel_note: forceChannel
            ? `Using channelId "${forceChannel}" — app must create this Android channel.`
            : 'No channelId sent (Android Default channel) — more reliable for images.',
          ticker_sides: tickerSides,
          sample_expo_payload: samplePayload,
          recipient_count: recipients.length,
          device_ids: recipients.map((r) => r.device_id).filter(Boolean),
          sent_ok: pushResult.ok,
          sent_failed: pushResult.failed,
          tickets: pushResult.tickets,
          errors: pushResult.errors,
          message:
            pushResult.ok > 0
              ? `${label} sent to ${pushResult.ok} device(s)` +
                (pushResult.failed ? ` · ${pushResult.failed} failed` : '') +
                ' · text only'
              : `Failed to send ${label.toLowerCase()}` +
                (failureSummary ? ` · ${failureSummary}` : ''),
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'News alert push failed',
        })
      }
    },

    /**
     * Trigger-only personalized momentum digest.
     * Each recipient gets their own subscribed tickers with the latest saved momentum.
     */
    async alertTriggerDigest(request, response) {
      try {
        const supabase = getSupabase()
        const { data: rows, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, subscribers, notable_price_movements')
        if (error) throw error

        let recipients = collectPushRecipients(rows || [], 'trigger')
        const selectedIds = Array.isArray(request.body?.device_ids)
          ? request.body.device_ids.map((id) => String(id || '').trim()).filter(Boolean)
          : []
        const selectedTokens = Array.isArray(request.body?.expo_push_tokens)
          ? request.body.expo_push_tokens
              .map((token) => String(token || '').trim())
              .filter(Boolean)
          : []
        if (selectedIds.length || selectedTokens.length) {
          const idSet = new Set(selectedIds)
          const tokenSet = new Set(selectedTokens)
          recipients = recipients.filter(
            (recipient) =>
              (recipient.device_id && idSet.has(String(recipient.device_id))) ||
              tokenSet.has(recipient.expo_push_token),
          )
        }

        if (!recipients.length) {
          response.status(400).json({
            error: 'No matching enabled Trigger users with Expo push tokens',
            recipient_count: 0,
          })
          return
        }

        const title =
          String(request.body?.title || '').trim() || "Today's notable price momentum"
        const previews = recipients.map((recipient) => {
          const subscribed = new Map()
          for (const row of rows || []) {
            const ticker = normalizeTicker(row.ticker)
            if (!ticker || subscribed.has(ticker)) continue
            const hasSubscription = (Array.isArray(row.subscribers) ? row.subscribers : []).some(
              (subscriber) =>
                subscriber &&
                subscriber.enabled !== false &&
                subscriberNotificationApp(subscriber) === 'trigger' &&
                String(subscriber.expo_push_token || '').trim() === recipient.expo_push_token,
            )
            if (!hasSubscription) continue
            const movement = latestMovementEvent(row.notable_price_movements)
            const momentum = formatMomentumForTitle(
              movement?.price_change || movement?.momentum || '',
            )
            subscribed.set(ticker, {
              ticker,
              momentum,
              event_date: movement?.event_date || null,
            })
          }
          const tickerItems = [...subscribed.values()].sort((left, right) =>
            left.ticker.localeCompare(right.ticker),
          )
          const body = tickerItems.length
            ? tickerItems
                .map((item) =>
                  item.momentum ? `${item.ticker} (${item.momentum})` : item.ticker,
                )
                .join(' · ')
            : 'No subscribed ticker momentum is available yet.'
          return {
            device_id: recipient.device_id,
            expo_push_token: recipient.expo_push_token,
            title,
            body: body.length > 400 ? `${body.slice(0, 397)}…` : body,
            tickers: tickerItems,
          }
        })

        if (request.body?.preview_only === true) {
          response.json({
            ok: true,
            preview_only: true,
            app_key: 'trigger',
            title,
            recipient_count: previews.length,
            previews: previews.map(({ expo_push_token, ...preview }) => preview),
          })
          return
        }

        const messages = previews.map((preview) => ({
          to: preview.expo_push_token,
          sound: 'default',
          title: preview.title,
          body: preview.body,
          priority: 'high',
          data: {
            type: 'notable_momentum_digest',
            kind: 'momentum_digest',
            app_key: 'trigger',
            screen: 'momentum',
            path: '/momentum',
            deep_link: 'trigger://momentum',
            url: 'trigger://momentum',
            app_url: 'trigger://momentum',
            tickers: JSON.stringify(preview.tickers),
            notification_title: preview.title,
            notification_body: preview.body,
          },
          _device_id: preview.device_id,
        }))
        const pushResult = await sendExpoPushMessages(messages)
        const failureSummary = expoFailureSummary(pushResult)

        response.json({
          ok: pushResult.failed === 0 && pushResult.errors.length === 0,
          app_key: 'trigger',
          title,
          recipient_count: previews.length,
          device_ids: previews.map((preview) => preview.device_id).filter(Boolean),
          previews: previews.map(({ expo_push_token, ...preview }) => preview),
          sent_ok: pushResult.ok,
          sent_failed: pushResult.failed,
          tickets: pushResult.tickets,
          errors: pushResult.errors,
          message:
            pushResult.ok > 0
              ? `Momentum digest sent to ${pushResult.ok} Trigger user(s)` +
                (pushResult.failed ? ` · ${pushResult.failed} failed` : '')
              : 'Failed to send Trigger momentum digest' +
                (failureSummary ? ` · ${failureSummary}` : ''),
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Trigger momentum digest failed',
        })
      }
    },

    /**
     * Read-only preview of the exact notable-movement notification copy.
     * Accepts an optional event so a dashboard card can preview that card only.
     */
    async previewAlert(request, response) {
      try {
        const ticker = normalizeTicker(request.params.ticker || request.body?.ticker)
        const appKey = normalizeNotificationApp(request.body?.app_key || request.query?.app)
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }

        const supabase = getSupabase()
        let { data: rows, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, company_name, subscribers, notable_price_movements')
          .eq('ticker', ticker)

        if (error) throw error
        if (!rows?.length) {
          ;({ data: rows, error } = await supabase
            .from('device_monitored_tickers')
            .select('ticker, company_name, subscribers, notable_price_movements')
            .ilike('ticker', ticker))
          if (error) throw error
        }
        if (!rows?.length) {
          response.status(404).json({
            error: `Ticker ${ticker} not found in device_monitored_tickers`,
          })
          return
        }

        let event = null
        if (request.body?.event && typeof request.body.event === 'object') {
          event = normalizeEventRow(request.body.event) || request.body.event
        }
        if (!event) {
          const merged = {}
          for (const row of rows) {
            Object.assign(merged, extractDatesMap(row.notable_price_movements))
          }
          event = latestMovementEvent({ dates: merged })
        }

        const companyName = rows.find((row) => row.company_name)?.company_name || ticker
        const preview = buildAlertMessage({
          ticker,
          companyName,
          event,
          appKey,
        })
        const recipients = collectPushRecipients(rows, appKey)

        response.json({
          ok: true,
          app_key: appKey,
          ticker,
          title: preview.title,
          body: preview.body,
          event_date: event?.event_date || null,
          deep_link: preview.data.deep_link,
          recipient_count: recipients.length,
          device_ids: recipients.map((recipient) => recipient.device_id).filter(Boolean),
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Alert preview failed',
        })
      }
    },

    /**
     * Push an alert to every enabled Expo device subscribed to this ticker.
     * Uses the latest saved notable_price_movements.dates entry for title/body
     * (optional title/body overrides in request body).
     */
    async alert(request, response) {
      try {
        const ticker = normalizeTicker(request.params.ticker || request.body?.ticker)
        const appKey = normalizeNotificationApp(request.body?.app_key || request.query?.app)
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }

        const supabase = getSupabase()
        let { data: rows, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, company_name, subscribers, notable_price_movements')
          .eq('ticker', ticker)

        if (error) throw error
        if (!rows?.length) {
          ;({ data: rows, error } = await supabase
            .from('device_monitored_tickers')
            .select('ticker, company_name, subscribers, notable_price_movements')
            .ilike('ticker', ticker))
          if (error) throw error
        }
        if (!rows?.length) {
          response.status(404).json({
            error: `Ticker ${ticker} not found in device_monitored_tickers`,
          })
          return
        }

        let recipients = collectPushRecipients(rows, appKey)
        const selectedIds = Array.isArray(request.body?.device_ids)
          ? request.body.device_ids.map((id) => String(id || '').trim()).filter(Boolean)
          : []
        const selectedTokens = Array.isArray(request.body?.expo_push_tokens)
          ? request.body.expo_push_tokens
              .map((token) => String(token || '').trim())
              .filter(Boolean)
          : []
        if (selectedIds.length || selectedTokens.length) {
          const idSet = new Set(selectedIds)
          const tokenSet = new Set(selectedTokens)
          recipients = recipients.filter(
            (recipient) =>
              (recipient.device_id && idSet.has(String(recipient.device_id))) ||
              tokenSet.has(recipient.expo_push_token),
          )
        }
        if (!recipients.length) {
          response.status(400).json({
            error:
              selectedIds.length || selectedTokens.length
                ? `No matching selected ${appKey === 'trigger' ? 'Trigger' : '9AM'} devices for ${ticker}`
                : `No enabled ${appKey === 'trigger' ? 'Trigger' : '9AM'} devices with Expo push tokens for ${ticker}`,
            ticker,
            app_key: appKey,
            recipient_count: 0,
          })
          return
        }

        // Prefer latest saved movement; fall back to body.event if provided.
        let event = null
        if (request.body?.event && typeof request.body.event === 'object') {
          event = normalizeEventRow(request.body.event) || request.body.event
        }
        if (!event) {
          // Merge all rows' movement maps then pick newest date.
          const merged = {}
          for (const row of rows) {
            Object.assign(merged, extractDatesMap(row.notable_price_movements))
          }
          event = latestMovementEvent({ dates: merged })
        }

        const companyName = rows.find((r) => r.company_name)?.company_name || ticker
        const { title, body, data: pushData } = buildAlertMessage({
          ticker,
          companyName,
          event,
          titleOverride: request.body?.title,
          bodyOverride: request.body?.body,
          appKey,
        })

        // Soft channel: only if client opts in (unknown channelId can hide Android notifs).
        const forceChannel =
          request.body?.channel_id != null
            ? String(request.body.channel_id).trim()
            : request.body?.use_named_channel === true
              ? 'notable-price-movement'
              : ''

        const messages = recipients.map((r) => {
          const msg = {
            to: r.expo_push_token,
            sound: 'default',
            title,
            body,
            data: pushData,
            priority: 'high',
            _device_id: r.device_id,
          }
          if (forceChannel) msg.channelId = forceChannel
          return msg
        })

        const samplePayload = messages[0]
          ? (() => {
              const { _device_id, to, ...rest } = messages[0]
              void _device_id
              return {
                ...rest,
                to: to ? `${String(to).slice(0, 28)}…` : null,
                data: rest.data || null,
              }
            })()
          : null

        const pushResult = await sendExpoPushMessages(messages)

        response.json({
          ok: pushResult.failed === 0 && pushResult.errors.length === 0,
          app_key: appKey,
          ticker,
          title,
          body,
          event_date: event?.event_date || null,
          deep_link: pushData.deep_link || null,
          data: pushData,
          sample_expo_payload: samplePayload,
          recipient_count: recipients.length,
          device_ids: recipients.map((r) => r.device_id).filter(Boolean),
          sent_ok: pushResult.ok,
          sent_failed: pushResult.failed,
          tickets: pushResult.tickets,
          errors: pushResult.errors,
          message:
            pushResult.ok > 0
              ? `Alert sent to ${pushResult.ok} device(s) for ${ticker}` +
                (pushResult.failed ? ` · ${pushResult.failed} failed` : '')
              : `Failed to send alert for ${ticker}`,
        })
      } catch (error) {
        response.status(500).json({
          error: error instanceof Error ? error.message : 'Alert push failed',
        })
      }
    },
  }
}

function countSavedEvents(notable) {
  return Object.keys(extractDatesMap(notable)).length
}

export function mountNotificationsRoutes(app, { getSupabase }) {
  const handlers = createNotificationsRouter({ getSupabase })

  app.get('/api/notifications/monitored-tickers', (req, res) => handlers.listTickers(req, res))
  app.get('/api/notifications/firecrawl/credits', (req, res) => handlers.credits(req, res))
  app.get('/api/notifications/devices', (req, res) => handlers.listDevices(req, res))
  app.get('/api/notifications/news', (req, res) => handlers.listNews(req, res))
  app.post('/api/notifications/scrape/:ticker', (req, res) => handlers.scrape(req, res))
  app.post('/api/notifications/save/:ticker', (req, res) => handlers.save(req, res))
  app.post('/api/notifications/preview/:ticker', (req, res) => handlers.previewAlert(req, res))
  app.post('/api/notifications/alert/:ticker', (req, res) => handlers.alert(req, res))
  app.post('/api/notifications/alert-news', (req, res) => handlers.alertNews(req, res))
  app.post('/api/notifications/alert-trigger-digest', (req, res) =>
    handlers.alertTriggerDigest(req, res),
  )
}
