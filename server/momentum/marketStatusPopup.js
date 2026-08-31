/**
 * Dashboard-load market summary (spec §14 / §16B).
 * One lightweight Yahoo probe per headline class. Does not start/stop the engine.
 */
import YahooFinance from 'yahoo-finance2'
import { toPlainJson } from '../yahoo/modules.js'
import { HEADLINE_PROBES, resolveMarketProfile } from './marketProfile.js'
import { evaluateSymbolGate } from './engineGate.js'
import { extractQuoteTimestampMs } from './freshness.js'
import { resolveLifecycle, LIFECYCLE } from './lifecycle.js'
import { formatHmInTimeZone, UK_ZONE, ET_ZONE } from './usEquitySession.js'

/** Fallback IANA zone per headline probe when Yahoo omits exchangeTimezoneName. */
const PROBE_LOCAL_TIME_ZONE = {
  'us-stocks': ET_ZONE,
  'us-nasdaq': ET_ZONE,
  'cash-index': ET_ZONE,
  canada: 'America/Toronto',
  brazil: 'America/Sao_Paulo',
  'uk-stocks': UK_ZONE,
  'uk-ftse': UK_ZONE,
  germany: 'Europe/Berlin',
  france: 'Europe/Paris',
  switzerland: 'Europe/Zurich',
  'india-nse': 'Asia/Kolkata',
  'india-bse': 'Asia/Kolkata',
  japan: 'Asia/Tokyo',
  china: 'Asia/Shanghai',
  'hong-kong': 'Asia/Hong_Kong',
  korea: 'Asia/Seoul',
  singapore: 'Asia/Singapore',
  australia: 'Australia/Sydney',
  dubai: 'Asia/Dubai',
  'south-africa': 'Africa/Johannesburg',
  forex: ET_ZONE,
  crypto: 'UTC',
  commodities: ET_ZONE,
  indices: ET_ZONE,
}

function resolveProbeTimeZone(entry, quote) {
  const fromYahoo = String(
    quote?.exchangeTimezoneName || quote?.timezone || '',
  ).trim()
  if (fromYahoo) return fromYahoo
  const id = String(entry?.id || '')
    .trim()
    .toLowerCase()
  if (PROBE_LOCAL_TIME_ZONE[id]) return PROBE_LOCAL_TIME_ZONE[id]
  return UK_ZONE
}

/** Locale that yields recognisable short zone names (EDT, BST, IST…). */
function localeForMarketZone(timeZone) {
  const zone = String(timeZone || '').trim()
  if (zone === UK_ZONE) return 'en-GB'
  if (zone === 'Asia/Kolkata' || zone === 'Asia/Calcutta') return 'en-IN'
  if (zone === 'Asia/Tokyo') return 'ja-JP'
  if (zone.startsWith('America/')) return 'en-US'
  if (zone.startsWith('Australia/')) return 'en-AU'
  return 'en-US'
}

function shortZoneName(ms, timeZone) {
  const zone = String(timeZone || '').trim() || UK_ZONE
  if (zone === 'Asia/Kolkata' || zone === 'Asia/Calcutta') return 'IST'
  if (zone === 'Asia/Tokyo') return 'JST'
  if (zone === 'Asia/Seoul') return 'KST'
  if (zone === 'Asia/Shanghai' || zone === 'Asia/Chongqing') return 'CST'
  if (zone === 'Asia/Hong_Kong') return 'HKT'
  if (zone === 'Asia/Singapore') return 'SGT'
  if (zone === 'Asia/Dubai') return 'GST'
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC'
  try {
    const raw =
      new Intl.DateTimeFormat(localeForMarketZone(zone), {
        timeZone: zone,
        timeZoneName: 'short',
      })
        .formatToParts(new Date(ms))
        .find((part) => part.type === 'timeZoneName')
        ?.value?.trim() || ''
    if (raw && !/^GMT[+-]/i.test(raw) && !/^UTC[+-]/i.test(raw)) return raw
    // Fallback recognisable labels when Intl only gives GMT±N
    if (zone === ET_ZONE || zone === 'America/Toronto') {
      // Rough DST window; good enough for desk stamps.
      const m = new Date(ms).getUTCMonth()
      return m >= 2 && m <= 9 ? 'EDT' : 'EST'
    }
    if (zone === UK_ZONE) {
      const m = new Date(ms).getUTCMonth()
      return m >= 2 && m <= 9 ? 'BST' : 'GMT'
    }
    if (
      zone === 'Europe/Berlin' ||
      zone === 'Europe/Paris' ||
      zone === 'Europe/Zurich'
    ) {
      const m = new Date(ms).getUTCMonth()
      return m >= 2 && m <= 9 ? 'CEST' : 'CET'
    }
    if (zone === 'Australia/Sydney' || zone === 'Australia/Melbourne') {
      const m = new Date(ms).getUTCMonth()
      // Southern hemisphere: DST roughly Oct–Apr
      return m >= 9 || m <= 3 ? 'AEDT' : 'AEST'
    }
    if (zone === 'America/Sao_Paulo') return 'BRT'
    if (zone === 'Africa/Johannesburg') return 'SAST'
    return raw || zone
  } catch {
    return zone
  }
}

/** Stamp an instant in that market's local zone (EDT / BST / IST / JST…), never force London. */
function formatMarketLocalStamp(iso, timeZone) {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const zone = String(timeZone || '').trim() || UK_ZONE
  try {
    // Always English clock digits; zone abbrev comes from shortZoneName.
    const clock = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(ms))
    const suffix = shortZoneName(ms, zone)
    return suffix ? `${clock} ${suffix}` : clock
  } catch {
    const hm = formatHmInTimeZone(ms, zone)
    return hm || null
  }
}

/**
 * Session column = exact Yahoo quote.marketState (PREPRE / PRE / REGULAR /
 * POST / POSTPOST / CLOSED / …). Do not rewrite to Overnight / After-hours.
 */
function yahooMarketStateSessionLabel(marketState) {
  const s = String(marketState || '')
    .trim()
    .toUpperCase()
  return s || null
}

function currentSessionLabel(_life, _assetId, marketState = null) {
  // Only Yahoo’s marketState — never invent Pre-market / Overnight / Closed.
  return yahooMarketStateSessionLabel(marketState) || '—'
}

function statusLabel(life, fresh, probeError = null) {
  if (life.lifecycle === LIFECYCLE.MAINTENANCE) return 'Maintenance'
  if (life.isFullClosed) return 'Closed'
  if (probeError === 'RATE_LIMIT') return 'Rate limited'
  if (probeError === 'ERROR') return 'Unavailable'
  if (fresh === 'STALE') return 'Delayed'
  if (fresh && fresh !== 'FRESH') return 'Delayed'
  return 'Live'
}

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
})

function isRateLimitError(err) {
  const msg = String(err?.message || err || '')
  const code = err?.code ?? err?.status ?? err?.statusCode
  return (
    code === 429 ||
    /too many requests/i.test(msg) ||
    /\b429\b/.test(msg) ||
    /rate.?limit/i.test(msg)
  )
}

function uiStatus(gate, probeError = null) {
  const cal = gate.calendarState
  const fresh = gate.freshnessState
  const eng = gate.engineGate
  if (probeError === 'RATE_LIMIT') return 'Open - Yahoo rate limited'
  if (probeError === 'ERROR') return 'Open - probe failed'
  if (eng === 'CONFLICT' || cal === 'UNKNOWN') return 'Unknown'
  if (cal === 'HOLIDAY') return 'Closed - holiday'
  if (cal === 'MAINTENANCE') return 'Maintenance'
  if (cal === 'CLOSED' || cal === 'EARLY_CLOSE') return 'Closed'
  if (cal === 'OPEN' && fresh === 'FRESH' && eng === 'RUN') return 'Open / Live'
  if (cal === 'OPEN' && fresh === 'STALE') return 'Open - data delayed'
  if (cal === 'OPEN') return 'Open - data unavailable'
  return 'Unknown'
}

function engineLabel(gate) {
  if (gate.engineGate === 'RUN') return 'Running'
  if (gate.engineGate === 'PAUSE_DATA') return 'Paused'
  if (gate.engineGate === 'SLEEP') return 'Sleeping'
  return 'Conflict'
}

function livePriceFromQuote(quote) {
  if (!quote || typeof quote !== 'object') return null
  const state = String(quote.marketState || '').toUpperCase()
  if (state === 'PRE' && quote.preMarketPrice != null) return quote.preMarketPrice
  if (
    (state === 'POST' || state === 'POSTPOST') &&
    quote.postMarketPrice != null
  ) {
    return quote.postMarketPrice
  }
  return (
    quote.regularMarketPrice ??
    quote.preMarketPrice ??
    quote.postMarketPrice ??
    null
  )
}

function normalizeQuoteList(raw) {
  const plain = raw ? toPlainJson(raw) : null
  if (!plain) return []
  if (Array.isArray(plain)) return plain
  return [plain]
}

/**
 * One Yahoo batch for all headline probes (avoids 6 serial calls → 429).
 * @returns {Promise<{ bySymbol: Map<string, object>, probeError: string|null }>}
 */
async function fetchProbeQuotes(symbols) {
  const bySymbol = new Map()
  try {
    const raw = await yahooFinance.quote(
      symbols,
      {},
      { validateResult: false },
    )
    for (const q of normalizeQuoteList(raw)) {
      const sym = String(q?.symbol || '').trim().toUpperCase()
      if (sym) bySymbol.set(sym, q)
    }
    // yahoo-finance2 sometimes omits ^ prefix normalization
    for (const want of symbols) {
      const key = String(want).toUpperCase()
      if (bySymbol.has(key)) continue
      const bare = key.startsWith('^') ? key.slice(1) : key
      for (const [k, q] of bySymbol) {
        if (k === bare || k.replace(/^\^/, '') === bare) {
          bySymbol.set(key, q)
          break
        }
      }
    }
    return { bySymbol, probeError: null }
  } catch (err) {
    return {
      bySymbol,
      probeError: isRateLimitError(err) ? 'RATE_LIMIT' : 'ERROR',
      probeErrorMessage:
        err instanceof Error ? err.message : String(err || 'Yahoo quote failed'),
    }
  }
}

function probeSymbolFromQuote(entry, nowUtc, quote, batchError = null) {
  const symbol = entry.symbol
  const profile = resolveMarketProfile(symbol)
  const quoteTs = extractQuoteTimestampMs(quote, null, null)
  const gate = evaluateSymbolGate({
    symbol,
    nowUtc,
    quoteTimestampUtc: quoteTs,
  })
  // Batch failed entirely (e.g. 429) → treat open markets as data unavailable
  const freshForLife =
    batchError && !quoteTs ? 'MISSING' : gate.freshnessState
  const life = resolveLifecycle(profile || symbol, nowUtc, freshForLife)
  const gateWithError =
    batchError && !quoteTs
      ? {
          ...gate,
          freshnessState: 'MISSING',
          engineGate: life.isFullClosed ? gate.engineGate : 'PAUSE_DATA',
          reason:
            batchError === 'RATE_LIMIT'
              ? 'Yahoo rate limited (HTTP 429) — probe skipped, not a market close'
              : 'Yahoo probe failed — no quote timestamp',
        }
      : gate
  const timeZone = resolveProbeTimeZone(entry, quote)
  const lastUpdateLocal = formatMarketLocalStamp(
    gateWithError.quoteTimestampUtc,
    timeZone,
  )
  const resumeAtLocal = formatMarketLocalStamp(
    gateWithError.nextExpectedOpenUtc,
    timeZone,
  )
  const marketStateRaw =
    quote?.marketState != null ? String(quote.marketState).trim() : null
  const marketState = marketStateRaw ? marketStateRaw.toUpperCase() : null
  const exchangeName =
    entry.exchange ||
    quote?.fullExchangeName ||
    quote?.exchange ||
    null
  return {
    id: entry.id,
    label: entry.label,
    symbol,
    region: entry.region || null,
    exchange: exchangeName,
    timeZone,
    profilePolicy: profile?.sessionPolicyId || null,
    calendarState: gateWithError.calendarState,
    sessionName: gateWithError.sessionName,
    marketState,
    currentSession: currentSessionLabel(life, entry.id, marketState),
    status: statusLabel(life, gateWithError.freshnessState, batchError),
    lastUpdateLocal,
    resumeAtLocal,
    /** @deprecated Use lastUpdateLocal — kept so older clients still render a stamp. */
    lastUpdateLondon: lastUpdateLocal,
    /** @deprecated Use resumeAtLocal */
    resumeAtLondon: resumeAtLocal,
    freshnessState: gateWithError.freshnessState,
    engineGate: gateWithError.engineGate,
    uiStatus: uiStatus(gateWithError, batchError),
    engineLabel: engineLabel(gateWithError),
    quoteTimestampUtc: gateWithError.quoteTimestampUtc,
    quoteAgeSec: gateWithError.quoteAgeSec,
    nextExpectedOpenUtc: gateWithError.nextExpectedOpenUtc,
    reason: gateWithError.reason,
    probeOnly: true,
    probeError: batchError,
    price: livePriceFromQuote(quote),
    /** Full Yahoo quote object used for this probe (for JSON download). */
    yahooQuote: quote && typeof quote === 'object' ? quote : null,
  }
}

function mergeIndicesRow(futures, cash) {
  if (!cash) return futures
  const mixed =
    futures.calendarState !== cash.calendarState ||
    futures.engineGate !== cash.engineGate ||
    futures.status !== cash.status
  return {
    ...futures,
    uiStatus: mixed ? 'Mixed' : futures.uiStatus,
    engineLabel: mixed ? 'Partial' : futures.engineLabel,
    child: cash,
    reason: mixed
      ? `Futures ${futures.uiStatus}; cash ${cash.uiStatus}`
      : futures.reason,
  }
}

function collectProbeEntries() {
  /** @type {Array<{ id: string, label: string, symbol: string }>} */
  const entries = []
  for (const probe of HEADLINE_PROBES) {
    entries.push(probe)
    if (probe.child) entries.push(probe.child)
  }
  return entries
}

export async function buildMarketStatusPopup(nowUtc = Date.now()) {
  const entries = collectProbeEntries()
  const symbols = [...new Set(entries.map((e) => e.symbol))]
  const { bySymbol, probeError, probeErrorMessage } =
    await fetchProbeQuotes(symbols)

  const built = new Map()
  for (const entry of entries) {
    const key = String(entry.symbol || '').toUpperCase()
    const quote = bySymbol.get(key) || null
    // Per-symbol miss after a successful batch is missing data, not rate limit
    const err = quote ? null : probeError
    built.set(entry.id, probeSymbolFromQuote(entry, nowUtc, quote, err))
  }

  const results = []
  for (const probe of HEADLINE_PROBES) {
    const main = built.get(probe.id)
    if (probe.child) {
      const child = built.get(probe.child.id)
      results.push(mergeIndicesRow(main, child))
    } else {
      results.push(main)
    }
  }

  const footerBase =
    'Monitoring is paused for closed markets and resumes automatically when the next session opens. Live markets continue to be monitored. If a market should be open but Yahoo data is delayed, Trigger pauses calculations until fresh data returns.'
  const footer =
    probeError === 'RATE_LIMIT'
      ? `${footerBase} Right now Yahoo returned HTTP 429 (too many requests) — wait a minute and hit Refresh. This is not a market close.`
      : footerBase

  return {
    ok: true,
    nowUtc: new Date(nowUtc).toISOString(),
    probeOnly: true,
    probeError: probeError || null,
    probeErrorMessage: probeErrorMessage || null,
    footer,
    markets: results,
  }
}

/** Pure aggregator for tests (no Yahoo). */
export function aggregatePopupRows(rows) {
  return rows.map((row) => {
    if (row.child) return mergeIndicesRow(row, row.child)
    return row
  })
}
