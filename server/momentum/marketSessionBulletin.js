/**
 * Market open / close bulletin — portfolio-aware multi-market.
 *
 * Markets: US, India, China (HK/A-shares), Australia.
 * Fire signal: Yahoo `marketState` edges on probe symbols.
 *
 * Title: "The <Market> market has opened|closed"
 * Body:  2–3 short Perplexity sentences (Yahoo fallback if research fails)
 *
 * Targeting (subscriber holdings):
 *   .NS / .BO              → India
 *   .HK / .SS / .SZ        → China
 *   .AX                    → Australia
 *   US equity/index        → US
 *
 * Persist: public.market_session_bulletins (unique market+slot+session_date)
 * Disable: MOMENTUM_MARKET_BULLETIN_ENABLED=0
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'
import {
  loadExpoRecipientsForTicker,
  sendExpoPush,
  callPerplexityResearch,
  recordPerplexityUsageLedger,
  fetchDeviceMonitorRows,
} from '../notifications.js'
import { resolvePushRecipients } from './recipientPolicy.js'
import { alertDisplayName, formatDashesToCommas } from './notifyCopy.js'
import {
  ensurePerplexityPromptsFromSupabase,
  getMarketBulletinPromptTemplate,
  fillMarketBulletinPrompt,
} from './perplexityPrompts.js'
import {
  isDigestEligibleTicker,
  dayMovePercent,
  fetchQuoteForDigest,
  sessionDateFromMs,
  isWeekendEt,
  isUsMarketHoliday,
} from './dailyDigest.js'
import { classifyMomentumAsset } from './candles.js'
import * as store from './store.js'

const EXCHANGE_TZ = 'America/New_York'
const INDIA_TZ = 'Asia/Kolkata'
const CHINA_TZ = 'Asia/Hong_Kong'
const AUSTRALIA_TZ = 'Australia/Sydney'
const BULLETIN_FIRE_GRACE_MIN = 25

const CLAIM_STORE_PATH = path.resolve(
  process.cwd(),
  'data/momentum-market-bulletin-claims.json',
)
const STATE_STORE_PATH = path.resolve(
  process.cwd(),
  'data/momentum-market-bulletin-yahoo-state.json',
)

/** @type {Set<string>} sessionDate claims: MARKET|{market}|{date}|{slot} */
const claimedBulletins = new Set()
let claimsHydrated = false

/** @type {Map<string, string>} market_id → last Yahoo marketState */
const lastYahooState = new Map()
let yahooStateHydrated = false

let cycleRunning = false

const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
})

/** @typedef {'us'|'india'|'china'|'australia'} BulletinMarket */
/** @typedef {'OPEN'|'CLOSE'} BulletinSlot */

export const MARKET_BULLETIN_CONFIG = {
  us: {
    id: 'us',
    label: 'US',
    shortLabel: 'US market',
    timezone: EXCHANGE_TZ,
    probes: ['SPY', 'QQQ'],
    titleOpen: 'The US market has opened',
    titleClose: 'The US market has closed',
  },
  india: {
    id: 'india',
    label: 'Indian',
    shortLabel: 'Indian market',
    timezone: INDIA_TZ,
    probes: ['^NSEI', 'RELIANCE.NS'],
    titleOpen: 'The Indian market has opened',
    titleClose: 'The Indian market has closed',
  },
  china: {
    id: 'china',
    label: 'Chinese / Hong Kong',
    shortLabel: 'Chinese market',
    timezone: CHINA_TZ,
    probes: ['^HSI', '0700.HK'],
    titleOpen: 'The Chinese market has opened',
    titleClose: 'The Chinese market has closed',
  },
  australia: {
    id: 'australia',
    label: 'Australian',
    shortLabel: 'Australian market',
    timezone: AUSTRALIA_TZ,
    probes: ['^AXJO', 'BHP.AX'],
    titleOpen: 'The Australian market has opened',
    titleClose: 'The Australian market has closed',
  },
}

/** @returns {BulletinMarket[]} */
export function listBulletinMarkets() {
  return /** @type {BulletinMarket[]} */ (Object.keys(MARKET_BULLETIN_CONFIG))
}

/** @param {string|null|undefined} market */
export function resolveBulletinMarketId(market) {
  const id = String(market || '')
    .trim()
    .toLowerCase()
  if (MARKET_BULLETIN_CONFIG[id]) return /** @type {BulletinMarket} */ (id)
  return 'us'
}

export function isMarketBulletinEnabled() {
  return process.env.MOMENTUM_MARKET_BULLETIN_ENABLED !== '0'
}

function hydrateClaimsFromDisk() {
  if (claimsHydrated) return
  claimsHydrated = true
  try {
    if (!fs.existsSync(CLAIM_STORE_PATH)) return
    const raw = JSON.parse(fs.readFileSync(CLAIM_STORE_PATH, 'utf8'))
    const keys = Array.isArray(raw?.keys)
      ? raw.keys
      : Array.isArray(raw)
        ? raw
        : []
    for (const k of keys) {
      if (typeof k === 'string' && k) claimedBulletins.add(k)
    }
  } catch {
    /* ignore */
  }
}

function persistClaimsToDisk() {
  try {
    const dir = path.dirname(CLAIM_STORE_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    let keys = [...claimedBulletins]
    if (keys.length > 120) keys = keys.slice(-120)
    fs.writeFileSync(
      CLAIM_STORE_PATH,
      JSON.stringify({ keys, updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    )
  } catch (err) {
    console.warn(
      '[market bulletin] claim persist failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

function hydrateYahooStateFromDisk() {
  if (yahooStateHydrated) return
  yahooStateHydrated = true
  try {
    if (!fs.existsSync(STATE_STORE_PATH)) return
    const raw = JSON.parse(fs.readFileSync(STATE_STORE_PATH, 'utf8'))
    const states = raw?.states && typeof raw.states === 'object' ? raw.states : {}
    for (const [k, v] of Object.entries(states)) {
      if (typeof v === 'string' && v) lastYahooState.set(k, v.toUpperCase())
    }
  } catch {
    /* ignore */
  }
}

function persistYahooStateToDisk() {
  try {
    const dir = path.dirname(STATE_STORE_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const states = Object.fromEntries(lastYahooState.entries())
    fs.writeFileSync(
      STATE_STORE_PATH,
      JSON.stringify({ states, updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    )
  } catch {
    /* ignore */
  }
}

function isClaimed(key) {
  hydrateClaimsFromDisk()
  return claimedBulletins.has(key)
}

function markClaimed(key) {
  hydrateClaimsFromDisk()
  if (claimedBulletins.has(key)) return
  claimedBulletins.add(key)
  if (claimedBulletins.size > 120) {
    const first = claimedBulletins.keys().next().value
    claimedBulletins.delete(first)
  }
  persistClaimsToDisk()
}

function getSupabaseOrNull() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  } catch {
    return null
  }
}

/**
 * Format one stock line: SNDK (+1.23%)
 * @param {string} ticker
 * @param {number|null|undefined} movePercent
 */
export function formatStockBracketPct(ticker, movePercent) {
  const name = alertDisplayName(ticker)
  if (!name) return ''
  if (movePercent == null || movePercent === '') return `${name} (n/a)`
  const n = Number(movePercent)
  if (!Number.isFinite(n)) return `${name} (n/a)`
  const abs = Math.abs(n).toFixed(1)
  const signed = n > 0 ? `+${abs}` : n < 0 ? `-${abs}` : abs
  return `${name} (${signed}%)`
}

/**
 * @deprecated watchlist body no longer used on lock-screen push.
 */
export function buildMarketBulletinBody(rows) {
  const parts = (rows || [])
    .map((r) => formatStockBracketPct(r.ticker, r.movePercent))
    .filter(Boolean)
  return parts.join(' · ')
}

/**
 * Yahoo-only fallback body when Perplexity fails (short 2 lines).
 * @param {BulletinSlot} slot
 * @param {BulletinMarket} [market='us']
 * @param {{ probeSymbol?: string|null, dayChangePercent?: number|null }} [snap]
 */
export function buildMarketBulletinPushBody(slot, market = 'us', snap = {}) {
  const m = resolveBulletinMarketId(market)
  const cfg = MARKET_BULLETIN_CONFIG[m]
  const label = cfg.shortLabel || `${cfg.label} market`
  const sym = String(snap.probeSymbol || cfg.probes[0])
  const pct = Number(snap.dayChangePercent)
  const pctTxt = Number.isFinite(pct)
    ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
    : null
  const tone = Number.isFinite(pct)
    ? pct > 0.15
      ? 'higher'
      : pct < -0.15
        ? 'lower'
        : 'roughly flat'
    : 'mixed'
  if (slot === 'CLOSE') {
    return pctTxt
      ? `${label} has closed ${tone}. ${sym} finished ${pctTxt} on the day. Trigger keeps watching your watchlist for unusual moves.`
      : `${label} has closed. Trigger keeps watching your watchlist for unusual momentum.`
  }
  return pctTxt
    ? `${label} is open and trading ${tone}. ${sym} is ${pctTxt} so far. Trigger is watching your watchlist for unusual momentum.`
    : `${label} is open. Trigger is watching your watchlist for unusual momentum.`
}

/**
 * @param {BulletinSlot} slot
 * @param {string} [_sessionDate]
 * @param {BulletinMarket} [market='us']
 */
export function buildMarketBulletinTitle(slot, _sessionDate = '', market = 'us') {
  const m = resolveBulletinMarketId(market)
  const cfg = MARKET_BULLETIN_CONFIG[m]
  if (slot === 'CLOSE') return cfg.titleClose
  return cfg.titleOpen
}

function isWeekendInZone(ms, timeZone) {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(ms))
  return wd === 'Sat' || wd === 'Sun'
}

/**
 * True when now is inside the short fire window after fireAt.
 */
export function isWithinBulletinFireWindow(
  nowMs,
  fireAtMs,
  graceMin = BULLETIN_FIRE_GRACE_MIN,
) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(fireAtMs)) return false
  const graceMs = Math.max(1, graceMin) * 60_000
  return nowMs >= fireAtMs && nowMs < fireAtMs + graceMs
}

/**
 * Legacy US-only clock due helper (tests + back-compat).
 * Prefer Yahoo-edge detection via detectDueMarketBulletinSlots().
 */
export function dueMarketBulletinSlots(nowMs = Date.now()) {
  // Keep test behaviour: weekends empty; OPEN/CLOSE only near ET RTH edges.
  if (isWeekendEt(nowMs)) return []
  const sessionDate = sessionDateFromMs(nowMs)
  if (isUsMarketHoliday(sessionDate)) return []

  // Approximate ET fire times: open+5 / close+5 using UTC offsets for known EDT fixtures in tests
  // Re-use digest-style windows via a light check on minutes in ET.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EXCHANGE_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(nowMs))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  const mins = (hour === 24 ? 0 : hour) * 60 + minute
  const openFire = 9 * 60 + 35
  const closeFire = 16 * 60 + 5
  /** @type {Array<{ sessionDate: string, slot: 'OPEN'|'CLOSE', fireAt: number }>} */
  const due = []
  if (mins >= openFire && mins < openFire + BULLETIN_FIRE_GRACE_MIN) {
    due.push({ sessionDate, slot: 'OPEN', fireAt: nowMs })
  }
  if (mins >= closeFire && mins < closeFire + BULLETIN_FIRE_GRACE_MIN) {
    due.push({ sessionDate, slot: 'CLOSE', fireAt: nowMs })
  }
  return due
}

function claimKey(market, sessionDate, slot) {
  return `MARKET|${market}|${sessionDate}|${slot}`
}

function sessionDateInZone(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (t) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function normalizeYahooState(state) {
  return String(state || '')
    .trim()
    .toUpperCase()
}

function isRegularState(state) {
  return normalizeYahooState(state) === 'REGULAR'
}

function isClosedishState(state) {
  const s = normalizeYahooState(state)
  return s === 'CLOSED' || s === 'POST' || s === 'POSTPOST' || s === ''
}

/**
 * Classify a watchlist / monitor ticker into bulletin markets from holdings.
 * @returns {Set<BulletinMarket>}
 */
export function classifyTickerMarkets(ticker) {
  const symbol =
    store.normalizeMomentumTicker(ticker) || String(ticker || '').toUpperCase()
  /** @type {Set<BulletinMarket>} */
  const out = new Set()
  if (!symbol) return out
  // India cash listings
  if (/\.(NS|BO)$/i.test(symbol) || symbol === '^NSEI' || symbol === '^BSESN') {
    out.add('india')
    return out
  }
  // China / Hong Kong
  if (
    /\.(HK|SS|SZ)$/i.test(symbol) ||
    symbol === '^HSI' ||
    symbol === '^SSEC' ||
    symbol === '000001.SS'
  ) {
    out.add('china')
    return out
  }
  // Australia
  if (/\.AX$/i.test(symbol) || symbol === '^AXJO' || symbol === '^AORD') {
    out.add('australia')
    return out
  }
  // Other foreign listings — do not treat as US cash bulletin
  if (/\.(L|DE|PA|TO|T|SA|SW|MX|KS|KQ)$/i.test(symbol)) return out
  // Crypto / FX / commodities are not cash equity session bulletins
  const cls = classifyMomentumAsset(symbol)
  if (cls === 'crypto' || cls === 'forex' || cls === 'commodity') return out
  if (cls === 'equity' || cls === 'index' || cls === 'etf') out.add('us')
  return out
}

/**
 * @param {string} ticker
 * @returns {boolean}
 */
export function isMarketBulletinEligibleTicker(ticker) {
  const markets = classifyTickerMarkets(ticker)
  if (!markets.size) return false
  // Non-US regional listings are always bulletin-eligible when classified.
  if (
    markets.has('india') ||
    markets.has('china') ||
    markets.has('australia')
  ) {
    return true
  }
  return isDigestEligibleTicker(ticker)
}

async function fetchProbeQuote(symbols) {
  const list = (symbols || []).map((s) => String(s).trim()).filter(Boolean)
  if (!list.length) return null
  try {
    const raw = await yahooFinance.quote(list, {}, { validateResult: false })
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : []
    for (const want of list) {
      const key = want.toUpperCase()
      const hit =
        rows.find((q) => String(q?.symbol || '').toUpperCase() === key) ||
        rows.find((q) =>
          String(q?.symbol || '')
            .toUpperCase()
            .replace(/^\^/, '') === key.replace(/^\^/, ''),
        )
      if (hit) return hit
    }
    return rows[0] || null
  } catch {
    return null
  }
}

/**
 * Snapshot + Yahoo state for one market.
 * @param {BulletinMarket} market
 */
export async function snapshotMarketProbe(market) {
  const cfg = MARKET_BULLETIN_CONFIG[market]
  if (!cfg) return null
  const quote = await fetchProbeQuote(cfg.probes)
  if (!quote) {
    return {
      market,
      probeSymbol: cfg.probes[0],
      marketState: null,
      last: null,
      previousClose: null,
      open: null,
      dayChangePercent: null,
      sessionDate: sessionDateInZone(Date.now(), cfg.timezone),
      timezone: cfg.timezone,
      quote: null,
    }
  }
  const state = normalizeYahooState(quote.marketState)
  const last =
    Number(quote.regularMarketPrice) ||
    Number(quote.postMarketPrice) ||
    Number(quote.preMarketPrice) ||
    null
  const previousClose = Number(quote.regularMarketPreviousClose) || null
  const open = Number(quote.regularMarketOpen) || null
  let dayChangePercent = Number(quote.regularMarketChangePercent)
  if (!Number.isFinite(dayChangePercent)) {
    dayChangePercent = dayMovePercent(last, previousClose)
  }
  return {
    market,
    probeSymbol: String(quote.symbol || cfg.probes[0]),
    marketState: state || null,
    last: Number.isFinite(last) ? last : null,
    previousClose: Number.isFinite(previousClose) ? previousClose : null,
    open: Number.isFinite(open) ? open : null,
    dayChangePercent: Number.isFinite(dayChangePercent) ? dayChangePercent : null,
    sessionDate: sessionDateInZone(Date.now(), cfg.timezone),
    timezone: cfg.timezone,
    quote: {
      symbol: quote.symbol || null,
      marketState: quote.marketState || null,
      regularMarketPrice: quote.regularMarketPrice ?? null,
      regularMarketPreviousClose: quote.regularMarketPreviousClose ?? null,
      regularMarketOpen: quote.regularMarketOpen ?? null,
      regularMarketChangePercent: quote.regularMarketChangePercent ?? null,
      shortName: quote.shortName || null,
    },
  }
}

/**
 * Detect OPEN/CLOSE edges from Yahoo state transitions.
 * @returns {Array<{ market: BulletinMarket, slot: BulletinSlot, sessionDate: string, snap: object }>}
 */
export async function detectDueMarketBulletinSlots(nowMs = Date.now()) {
  hydrateYahooStateFromDisk()
  /** @type {Array<{ market: BulletinMarket, slot: BulletinSlot, sessionDate: string, snap: object }>} */
  const due = []
  for (const market of listBulletinMarkets()) {
    const cfg = MARKET_BULLETIN_CONFIG[market]
    const snap = await snapshotMarketProbe(market)
    if (!snap) continue
    const prev = lastYahooState.get(market) || ''
    const next = normalizeYahooState(snap.marketState)
    if (next) {
      lastYahooState.set(market, next)
      persistYahooStateToDisk()
    }
    // Need a previous observation to detect an edge (avoid boot blast).
    if (!prev) continue

    const sessionDate =
      snap.sessionDate || sessionDateInZone(nowMs, snap.timezone || cfg.timezone)
    // Skip local weekends; US also respects exchange holidays.
    if (isWeekendInZone(nowMs, cfg.timezone)) continue
    if (market === 'us' && isUsMarketHoliday(sessionDate)) continue

    const opened = !isRegularState(prev) && isRegularState(next)
    const closed =
      isRegularState(prev) && isClosedishState(next) && !isRegularState(next)

    if (opened) {
      due.push({ market, slot: 'OPEN', sessionDate, snap })
    } else if (closed) {
      due.push({ market, slot: 'CLOSE', sessionDate, snap })
    }
  }
  return due
}

/**
 * Load Expo recipients watching at least one ticker in `market`.
 * @param {import('@supabase/supabase-js').SupabaseClient|null} supabase
 * @param {BulletinMarket} market
 */
export async function loadRecipientsForMarket(supabase, market) {
  const byToken = new Map()
  const watched = store.listWatchedTickers().filter(isMarketBulletinEligibleTicker)
  const marketTickers = watched.filter((t) => classifyTickerMarkets(t).has(market))

  if (supabase) {
    // Prefer assets_monitor_based_on_device via loadExpoRecipientsForTicker (already fallback-aware)
    for (const t of marketTickers) {
      try {
        const list = await loadExpoRecipientsForTicker(supabase, t, 'trigger')
        for (const r of list || []) {
          const token = r.expo_push_token || r.to
          if (!token) continue
          if (!byToken.has(token)) {
            byToken.set(token, {
              device_id: r.device_id || null,
              expo_push_token: token,
              enabled: true,
              app_key: 'trigger',
            })
          }
        }
      } catch {
        /* skip */
      }
    }

    // Full monitor table: subscriber holdings decide which market bulletins they get.
    try {
      const fetched = await fetchDeviceMonitorRows(supabase, 'ticker, subscribers')
      const list = Array.isArray(fetched?.data) ? fetched.data : []
      for (const row of list) {
        const ticker = String(row.ticker || '').toUpperCase()
        if (!ticker) continue
        if (!classifyTickerMarkets(ticker).has(market)) continue
        if (!isMarketBulletinEligibleTicker(ticker)) continue
        for (const sub of row.subscribers || []) {
          if (!sub || sub.enabled === false) continue
          const token = String(sub.expo_push_token || '').trim()
          if (!token) continue
          if (!byToken.has(token)) {
            byToken.set(token, {
              device_id: sub.device_id || null,
              expo_push_token: token,
              enabled: true,
              app_key: 'trigger',
            })
          }
        }
      }
    } catch {
      /* table may differ in some envs — watchlist path above still applies */
    }
  }

  return resolvePushRecipients([...byToken.values()], 'trigger')
}

/**
 * Exact Perplexity prompt for a market OPEN/CLOSE bulletin (short push body).
 * Uses the editable `market_bulletin` template when saved; otherwise built-in default.
 */
export function buildMarketSessionResearchPrompt({
  market,
  slot,
  sessionDate,
  snap,
}) {
  const marketId = resolveBulletinMarketId(market)
  const slotUp = String(slot || '').toUpperCase() === 'CLOSE' ? 'CLOSE' : 'OPEN'
  const cfg = MARKET_BULLETIN_CONFIG[marketId]
  const openOrClose = slotUp === 'CLOSE' ? 'closed' : 'opened'

  const pct =
    snap?.dayChangePercent != null && Number.isFinite(Number(snap.dayChangePercent))
      ? `${Number(snap.dayChangePercent) > 0 ? '+' : ''}${Number(snap.dayChangePercent).toFixed(2)}%`
      : 'n/a'
  const last = snap?.last != null ? String(snap.last) : 'n/a'
  const prev = snap?.previousClose != null ? String(snap.previousClose) : 'n/a'
  const open = snap?.open != null ? String(snap.open) : 'n/a'
  const state = snap?.marketState || 'n/a'
  const probe = snap?.probeSymbol || cfg.probes[0]

  return fillMarketBulletinPrompt(getMarketBulletinPromptTemplate(), {
    SHORT_LABEL: cfg.shortLabel,
    OPENED_OR_CLOSED: openOrClose,
    SESSION_DATE: sessionDate,
    TIMEZONE: cfg.timezone,
    MARKET_ID: marketId,
    SLOT: slotUp,
    YAHOO_PROBE: probe,
    YAHOO_MARKET_STATE: state,
    YAHOO_LAST: last,
    YAHOO_OPEN: open,
    YAHOO_PREVIOUS_CLOSE: prev,
    YAHOO_DAY_CHANGE_PERCENT: pct,
  })
}

/**
 * Perplexity short 2–3 sentence body for market open/close performance.
 */
export async function researchMarketSessionBody({
  market,
  slot,
  sessionDate,
  snap,
}) {
  const apiKey = String(process.env.PERPLEXITY_API_KEY || '').trim()
  const fallback = buildMarketBulletinPushBody(slot, market, {
    probeSymbol: snap?.probeSymbol,
    dayChangePercent: snap?.dayChangePercent,
  })
  // Always refresh bulletin prompt from Supabase → memory before calling Perplexity.
  await ensurePerplexityPromptsFromSupabase({ force: true })
  const prompt = buildMarketSessionResearchPrompt({
    market,
    slot,
    sessionDate,
    snap,
  })

  if (!apiKey) {
    return {
      body: fallback,
      bodySource: 'yahoo_fallback',
      meta: { reason: 'no_api_key', prompt },
    }
  }

  try {
    const result = await callPerplexityResearch({
      apiKey,
      prompt,
      maxTokens: 512,
    })
    let body = String(result?.summary || '').replace(/\s+/g, ' ').trim()
    // Soft trim overlong replies for lock-screen readability.
    if (body.length > 420) body = `${body.slice(0, 417).trim()}…`
    if (!body || body.length < 24) {
      return {
        body: fallback,
        bodySource: 'yahoo_fallback',
        meta: { reason: 'empty_or_short', raw: result, prompt },
      }
    }
    return {
      body,
      bodySource: 'perplexity',
      meta: {
        prompt,
        model: result?.model || null,
        total_tokens: result?.usage?.total_tokens || result?.total_tokens || null,
        prompt_tokens: result?.usage?.prompt_tokens || null,
        completion_tokens: result?.usage?.completion_tokens || null,
        cost_usd: result?.usage?.cost?.total_cost || result?.cost_usd || null,
        request_id: result?.request_id || null,
        citations: result?.citations || [],
      },
    }
  } catch (err) {
    return {
      body: fallback,
      bodySource: 'yahoo_fallback',
      meta: {
        reason: err instanceof Error ? err.message : String(err),
        prompt,
      },
    }
  }
}

async function upsertBulletinRow(supabase, row) {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('market_session_bulletins')
    .upsert(row, { onConflict: 'market,slot,session_date' })
    .select('id')
    .maybeSingle()
  if (error) {
    console.warn('[market bulletin] upsert failed:', error.message)
    return null
  }
  return data?.id || null
}

/**
 * List recent market OPEN/CLOSE bulletins for the Episode desk.
 * @param {{ limit?: number, market?: string|null }} [opts]
 */
export async function listMarketSessionBulletins(opts = {}) {
  const supabase = getSupabaseOrNull()
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured', bulletins: [] }
  }
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 40))
  let q = supabase
    .from('market_session_bulletins')
    .select(
      'id, market, slot, session_date, timezone, title, body, body_source, yahoo_market_state, probe_symbol, open_price, close_or_last_price, day_change_percent, previous_close, quote_snapshot, perplexity_meta, push_sent_ok, push_sent_failed, recipient_count, claimed_at, sent_at, created_at',
    )
    .order('session_date', { ascending: false })
    .order('claimed_at', { ascending: false })
    .limit(limit)
  const market = String(opts.market || '')
    .trim()
    .toLowerCase()
  if (MARKET_BULLETIN_CONFIG[market]) {
    q = q.eq('market', market)
  }
  const { data, error } = await q
  if (error) {
    return { ok: false, error: error.message, bulletins: [] }
  }
  const bulletins = (data || []).map((row) => {
    const existingMeta =
      row?.perplexity_meta && typeof row.perplexity_meta === 'object'
        ? row.perplexity_meta
        : {}
    const prompt =
      typeof existingMeta.prompt === 'string' && existingMeta.prompt.trim()
        ? existingMeta.prompt
        : buildMarketSessionResearchPrompt({
            market: row.market,
            slot: row.slot,
            sessionDate: row.session_date,
            snap: {
              probeSymbol: row.probe_symbol,
              marketState: row.yahoo_market_state,
              last: row.close_or_last_price,
              open: row.open_price,
              previousClose: row.previous_close,
              dayChangePercent: row.day_change_percent,
            },
          })
    return {
      ...row,
      perplexity_meta: { ...existingMeta, prompt },
    }
  })
  return { ok: true, bulletins }
}

/**
 * Collect day-% rows for watched equities/indexes (debug / optional).
 */
export async function collectWatchlistDayMoves(tickers, gapMs = 200) {
  /** @type {Array<{ ticker: string, movePercent: number|null, currentPrice: number|null, previousClose: number|null }>} */
  const rows = []
  for (const t of tickers) {
    try {
      const q = await fetchQuoteForDigest(t)
      const move = dayMovePercent(q.currentPrice, q.previousClose)
      rows.push({
        ticker: q.symbol || t,
        movePercent: move,
        currentPrice: q.currentPrice,
        previousClose: q.previousClose,
      })
    } catch {
      rows.push({
        ticker: t,
        movePercent: null,
        currentPrice: null,
        previousClose: null,
      })
    }
    if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs))
  }
  rows.sort(
    (a, b) =>
      Math.abs(Number(b.movePercent) || 0) - Math.abs(Number(a.movePercent) || 0),
  )
  return rows
}

/**
 * Run one market OPEN/CLOSE bulletin.
 * @param {BulletinMarket} market
 * @param {BulletinSlot} slot
 * @param {string} sessionDate
 * @param {{ force?: boolean, snap?: object|null }} [opts]
 */
export async function runMarketSessionBulletin(market, slot, sessionDate, opts = {}) {
  if (!isMarketBulletinEnabled()) {
    return { ok: true, skipped: true, reason: 'disabled' }
  }
  const marketId = resolveBulletinMarketId(market)
  const slotUp = String(slot || '').toUpperCase()
  if (slotUp !== 'OPEN' && slotUp !== 'CLOSE') {
    return { ok: true, skipped: true, reason: 'invalid_slot' }
  }
  const cfg = MARKET_BULLETIN_CONFIG[marketId]
  const key = claimKey(marketId, sessionDate, slotUp)
  if (!opts.force && isClaimed(key)) {
    return { ok: true, skipped: true, reason: 'already_claimed', market: marketId, slot: slotUp }
  }
  markClaimed(key)

  const snap = opts.snap || (await snapshotMarketProbe(marketId))
  const title = formatDashesToCommas(
    buildMarketBulletinTitle(slotUp, sessionDate, marketId),
  )

  const researched = await researchMarketSessionBody({
    market: marketId,
    slot: slotUp,
    sessionDate,
    snap,
  })
  const body = formatDashesToCommas(researched.body)

  const supabase = getSupabaseOrNull()
  if (researched.bodySource === 'perplexity' && researched.meta) {
    void recordPerplexityUsageLedger(supabase, {
      ticker: `${marketId}_market_${slotUp.toLowerCase()}`,
      total_tokens: researched.meta.total_tokens || 0,
      prompt_tokens: researched.meta.prompt_tokens || 0,
      completion_tokens: researched.meta.completion_tokens || 0,
      cost_usd: researched.meta.cost_usd || 0,
      meta: {
        kind: 'market_session_bulletin',
        market: marketId,
        slot: slotUp,
        session_date: sessionDate,
        model: researched.meta.model,
      },
    })
  }

  const bulletinId = await upsertBulletinRow(supabase, {
    market: marketId,
    slot: slotUp,
    session_date: sessionDate,
    timezone: cfg.timezone,
    title,
    body,
    body_source: researched.bodySource,
    yahoo_market_state: snap?.marketState || null,
    probe_symbol: snap?.probeSymbol || cfg.probes[0],
    open_price: snap?.open ?? null,
    close_or_last_price: snap?.last ?? null,
    day_change_percent: snap?.dayChangePercent ?? null,
    previous_close: snap?.previousClose ?? null,
    quote_snapshot: snap?.quote || null,
    perplexity_meta: researched.meta || null,
    claimed_at: new Date().toISOString(),
  })

  const dryRun = process.env.MOMENTUM_PUSH_DRY_RUN === '1'
  const recipients = await loadRecipientsForMarket(supabase, marketId)

  let pushResult = {
    ok: true,
    skipped: false,
    reason: null,
    sent_ok: 0,
    sent_failed: 0,
    recipient_count: recipients.length,
  }

  if (dryRun) {
    pushResult = { ...pushResult, skipped: true, reason: 'dry_run' }
  } else if (!recipients.length) {
    pushResult = { ...pushResult, skipped: true, reason: 'no_recipients' }
  } else {
    const messages = recipients.map((r) => ({
      to: r.expo_push_token,
      sound: 'default',
      title,
      body,
      data: {
        type: 'market_session_bulletin',
        notification_type: `trigger_market_${marketId}_${slotUp.toLowerCase()}`,
        kind: 'market_bulletin',
        event_type: `MARKET_${slotUp}`,
        market: marketId,
        slot: slotUp,
        session_date: String(sessionDate),
        bulletin_id: bulletinId || '',
        app_key: 'trigger',
        notification_title: title,
        notification_body: body,
        path: '/',
      },
      _device_id: r.device_id || null,
    }))
    try {
      const sent = await sendExpoPush(messages)
      pushResult = {
        ok: true,
        skipped: false,
        reason: null,
        sent_ok: sent?.ok || 0,
        sent_failed: sent?.failed || 0,
        recipient_count: recipients.length,
        tickets: sent?.tickets || [],
        errors: sent?.errors || [],
      }
    } catch (err) {
      pushResult = {
        ok: false,
        skipped: false,
        reason: err instanceof Error ? err.message : String(err),
        sent_ok: 0,
        sent_failed: recipients.length,
        recipient_count: recipients.length,
      }
    }
  }

  if (supabase && bulletinId) {
    await supabase
      .from('market_session_bulletins')
      .update({
        push_sent_ok: pushResult.sent_ok || 0,
        push_sent_failed: pushResult.sent_failed || 0,
        recipient_count: pushResult.recipient_count || 0,
        sent_at: new Date().toISOString(),
      })
      .eq('id', bulletinId)
  }

  const logTicker =
    store.listWatchedTickers().find((t) => classifyTickerMarkets(t).has(marketId)) ||
    cfg.probes[0]
  store.pushLog(
    logTicker,
    pushResult.skipped ? 'warn' : pushResult.ok ? 'success' : 'error',
    `Market bulletin ${marketId} ${slotUp} · ${title} · Expo ${pushResult.sent_ok || 0}/${pushResult.recipient_count || 0} · ${researched.bodySource}`,
    'digest',
    {
      market: marketId,
      slot: slotUp,
      sessionDate,
      title,
      body,
      bodySource: researched.bodySource,
      bulletinId,
      pushResult,
    },
  )

  return {
    ok: Boolean(pushResult.ok),
    market: marketId,
    slot: slotUp,
    sessionDate,
    title,
    body,
    bodySource: researched.bodySource,
    bulletinId,
    pushResult,
  }
}

/**
 * Back-compat wrapper: US-only by sessionDate/slot (clock due path / old callers).
 */
export async function runMarketSessionBulletinUsCompat(slot, sessionDate, opts = {}) {
  return runMarketSessionBulletin('us', slot, sessionDate, opts)
}

/**
 * Scan Yahoo edges for all configured markets and fire once each.
 */
export async function runMarketSessionBulletinCycle(opts = {}) {
  if (!isMarketBulletinEnabled()) {
    return { ok: true, skipped: true, reason: 'disabled' }
  }
  if (cycleRunning) {
    return { ok: false, skipped: true, reason: 'cycle already running' }
  }
  cycleRunning = true
  try {
    const force = Boolean(opts.force)
    /** @type {Array<{ market: BulletinMarket, slot: BulletinSlot, sessionDate: string, snap?: object }>} */
    let due = []
    if (force && opts.market && opts.slot && opts.sessionDate) {
      due = [
        {
          market: opts.market,
          slot: opts.slot,
          sessionDate: opts.sessionDate,
          snap: opts.snap || null,
        },
      ]
    } else {
      due = await detectDueMarketBulletinSlots(Date.now())
      // Also keep legacy US clock window as a secondary signal when Yahoo state
      // didn't flip this poll but we're inside the ET grace (helps flaky quotes).
      for (const d of dueMarketBulletinSlots(Date.now())) {
        if (!due.some((x) => x.market === 'us' && x.slot === d.slot && x.sessionDate === d.sessionDate)) {
          due.push({
            market: 'us',
            slot: d.slot,
            sessionDate: d.sessionDate,
          })
        }
      }
    }

    if (!due.length) {
      return { ok: true, due: 0, results: [], source: opts.source || null }
    }
    const results = []
    for (const item of due) {
      const r = await runMarketSessionBulletin(
        item.market,
        item.slot,
        item.sessionDate,
        { force, snap: item.snap || null },
      )
      if (r && !r.skipped) results.push(r)
    }
    return {
      ok: true,
      due: due.length,
      results,
      source: opts.source || null,
    }
  } finally {
    cycleRunning = false
  }
}

/** Test helper — clears memory + disk claims */
export function _resetMarketBulletinClaimsForTests() {
  claimedBulletins.clear()
  claimsHydrated = true
  cycleRunning = false
  lastYahooState.clear()
  yahooStateHydrated = true
  try {
    if (fs.existsSync(CLAIM_STORE_PATH)) fs.unlinkSync(CLAIM_STORE_PATH)
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(STATE_STORE_PATH)) fs.unlinkSync(STATE_STORE_PATH)
  } catch {
    /* ignore */
  }
}
