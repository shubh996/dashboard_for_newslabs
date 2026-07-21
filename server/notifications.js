/**
 * Notifications dashboard APIs:
 * - list monitored tickers from device_monitored_tickers
 * - scrape Perplexity finance via Firecrawl for "Notable Price Movement"
 * - save date-keyed events into device_monitored_tickers.notable_price_movements
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
    async listTickers(_request, response) {
      try {
        const supabase = getSupabase()
        let data = null
        let error = null

        ;({ data, error } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, company_name, created_at, updated_at, notable_price_movements')
          .order('ticker', { ascending: true }))

        // Column may not exist until schema_device_monitored_tickers.sql is applied.
        if (error && /notable_price_movements/i.test(error.message || '')) {
          ;({ data, error } = await supabase
            .from('device_monitored_tickers')
            .select('ticker, company_name, created_at, updated_at')
            .order('ticker', { ascending: true }))
        }

        if (error) throw error

        const tickers = (data || []).map((row) => ({
          ticker: row.ticker,
          company_name: row.company_name || row.ticker,
          created_at: row.created_at,
          updated_at: row.updated_at,
          has_saved_movements: countSavedEvents(row.notable_price_movements) > 0,
          saved_event_count: countSavedEvents(row.notable_price_movements),
          last_saved_at: row.notable_price_movements?.updated_at || null,
        }))

        response.json({ ok: true, count: tickers.length, tickers })
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
        const result = await scrapePerplexityNotableMovements(ticker)
        response.json({ ok: true, ...result })
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
        if (!ticker) {
          response.status(400).json({ error: 'Ticker is required' })
          return
        }
        if (!events.length) {
          response.status(400).json({ error: 'No events to save. Refresh/scrape first.' })
          return
        }

        const supabase = getSupabase()
        const { data: existing, error: readError } = await supabase
          .from('device_monitored_tickers')
          .select('ticker, notable_price_movements')
          .eq('ticker', ticker)
          .maybeSingle()

        if (readError) throw readError
        if (!existing) {
          response.status(404).json({ error: `Ticker ${ticker} not found in device_monitored_tickers` })
          return
        }

        const previous = existing.notable_price_movements || {}
        const eventsByDate = {
          ...(previous.events_by_date && typeof previous.events_by_date === 'object'
            ? previous.events_by_date
            : typeof previous === 'object' && !previous.events_by_date
              ? // legacy flat map of dates
                Object.fromEntries(
                  Object.entries(previous).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)),
                )
              : {}),
        }

        const nowIso = new Date().toISOString()
        let upserted = 0
        let unchanged = 0
        let inserted = 0
        for (const event of events) {
          const eventDate = String(event.event_date || '').slice(0, 10)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) continue

          const nextRow = {
            event_date: eventDate,
            display_date: event.display_date || null,
            time_label: event.time_label || null,
            price: event.price || null,
            price_change: event.price_change || event.momentum || null,
            momentum: event.momentum || event.price_change || null,
            summary: event.summary || '',
            reasons: Array.isArray(event.reasons)
              ? event.reasons
              : event.summary
                ? [event.summary]
                : [],
            sources: Array.isArray(event.sources) ? event.sources : [],
            source_count: Array.isArray(event.sources)
              ? event.sources.length
              : event.source_count ?? 0,
            claimed_source_count: event.claimed_source_count ?? null,
          }

          const previousRow = eventsByDate[eventDate]
          if (previousRow && eventContentFingerprint(previousRow) === eventContentFingerprint(nextRow)) {
            // Same content already stored for this date — do not rewrite / duplicate.
            unchanged += 1
            continue
          }

          eventsByDate[eventDate] = {
            ...nextRow,
            saved_at: nowIso,
          }
          upserted += 1
          if (previousRow) {
            // updated existing date key
          } else {
            inserted += 1
          }
        }

        // Nothing new to write — skip DB update so re-clicking Save is a no-op.
        if (upserted === 0) {
          response.json({
            ok: true,
            ticker,
            upserted: 0,
            unchanged,
            inserted: 0,
            changed: false,
            total_saved_events: Object.keys(eventsByDate).length,
            message:
              unchanged > 0
                ? `No changes — same content already saved for ${unchanged} date(s).`
                : 'No events to save.',
            row: existing,
          })
          return
        }

        const payload = {
          updated_at: nowIso,
          source_url: request.body?.source_url || perplexityFinanceUrl(ticker),
          last_scraped_at: request.body?.scraped_at || nowIso,
          events_by_date: eventsByDate,
        }

        const { data, error } = await supabase
          .from('device_monitored_tickers')
          .update({
            notable_price_movements: payload,
            updated_at: nowIso,
          })
          .eq('ticker', ticker)
          .select('ticker, company_name, notable_price_movements, updated_at')
          .single()

        if (error) throw error

        response.json({
          ok: true,
          ticker,
          upserted,
          unchanged,
          inserted,
          changed: true,
          total_saved_events: Object.keys(eventsByDate).length,
          message: `Saved ${upserted} date(s)${unchanged ? `, ${unchanged} unchanged` : ''}.`,
          row: data,
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
  }
}

function countSavedEvents(notable) {
  if (!notable || typeof notable !== 'object') return 0
  if (notable.events_by_date && typeof notable.events_by_date === 'object') {
    return Object.keys(notable.events_by_date).length
  }
  return Object.keys(notable).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)).length
}

export function mountNotificationsRoutes(app, { getSupabase }) {
  const handlers = createNotificationsRouter({ getSupabase })

  app.get('/api/notifications/monitored-tickers', (req, res) => handlers.listTickers(req, res))
  app.get('/api/notifications/firecrawl/credits', (req, res) => handlers.credits(req, res))
  app.post('/api/notifications/scrape/:ticker', (req, res) => handlers.scrape(req, res))
  app.post('/api/notifications/save/:ticker', (req, res) => handlers.save(req, res))
}
