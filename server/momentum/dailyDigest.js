/**
 * Daily Digest — scheduled OPEN / MIDDAY / CLOSE summaries for equities + indexes.
 *
 * Separate from the episode system: does not create, modify, expire, or reset episodes.
 *
 * Timing (exchange-local regular session):
 *   OPEN   = regular open + 10 minutes
 *   MIDDAY = midpoint of regular session
 *   CLOSE  = regular close + 5 minutes
 *
 * Dedup: unique (ticker, session_date, slot) in Supabase + in-memory claim set.
 * Push: same watchlist-gated Expo path as episode alerts.
 */
import yahooFinance from 'yahoo-finance2'
import { createClient } from '@supabase/supabase-js'
import {
  buildSessionQuote,
  classifyMomentumAsset,
  resolveMarketSession,
} from './candles.js'
import { researchStartMove } from './autoStartAlert.js'
import { sendTriggerEpisodePush } from '../notifications.js'
import * as store from './store.js'
import { toYahooSymbol } from '../yahooClient.js'

const EXCHANGE_TZ = 'America/New_York'
/** US cash RTH defaults (minutes from midnight ET). */
const US_RTH_OPEN_MIN = 9 * 60 + 30
const US_RTH_CLOSE_MIN = 16 * 60
const OPEN_OFFSET_MIN = 10
const CLOSE_OFFSET_MIN = 5

/** Skip known US equity market holidays (YYYY-MM-DD, America/New_York date). */
const US_MARKET_HOLIDAYS = new Set([
  '2025-01-01',
  '2025-01-20',
  '2025-02-17',
  '2025-04-18',
  '2025-05-26',
  '2025-06-19',
  '2025-07-04',
  '2025-09-01',
  '2025-11-27',
  '2025-12-25',
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
])

/** In-flight claims this process already owns (restart-safe via Supabase unique). */
const inFlightClaims = new Set()

let client = null
let clientTried = false
let cycleRunning = false

function getSupabaseOrNull() {
  if (clientTried) return client
  clientTried = true
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  } catch {
    client = null
  }
  return client
}

/**
 * Per-ticker OPEN/MIDDAY/CLOSE digests are retired from the product.
 * Market open/close watchlist bulletins (marketSessionBulletin) replace them.
 * Set MOMENTUM_DAILY_DIGEST_ENABLED=1 only for legacy/debug re-enable.
 */
export function isDailyDigestEnabled() {
  return (
    process.env.MOMENTUM_DAILY_DIGEST_ENABLED === '1' ||
    process.env.MOMENTUM_DAILY_DIGEST_ENABLED === 'true'
  )
}

/**
 * Equities + indexes only (skip commodity / crypto / forex).
 * @param {string} ticker
 */
export function isDigestEligibleTicker(ticker) {
  const symbol = store.normalizeMomentumTicker(ticker)
  if (!symbol) return false
  const cls = classifyMomentumAsset(symbol)
  // classifyMomentumAsset maps ^indexes → equity
  return cls === 'equity' || cls === 'index'
}

function claimKey(ticker, sessionDate, slot) {
  return `${ticker}|${sessionDate}|${slot}`
}

function etPartsAt(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EXCHANGE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ms))
  const get = (type) => parts.find((p) => p.type === type)?.value
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  return {
    weekday: get('weekday') || '',
    year: get('year') || '',
    month: get('month') || '',
    day: get('day') || '',
    hour,
    minute: Number(get('minute')) || 0,
    second: Number(get('second')) || 0,
  }
}

function etWallToUtcMs(y, mo, d, hour, minute) {
  let utc = Date.parse(
    `${y}-${mo}-${d}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
  )
  if (!Number.isFinite(utc)) return null
  for (let i = 0; i < 5; i += 1) {
    const p = etPartsAt(utc)
    if (p.year !== y || p.month !== mo || p.day !== d) {
      const want = Date.parse(`${y}-${mo}-${d}T12:00:00.000Z`)
      const got = Date.parse(`${p.year}-${p.month}-${p.day}T12:00:00.000Z`)
      if (Number.isFinite(want) && Number.isFinite(got)) utc += want - got
    }
    const wantMin = hour * 60 + minute
    const gotMin = p.hour * 60 + p.minute
    const adj = (wantMin - gotMin) * 60 * 1000
    if (adj === 0) break
    utc += adj
  }
  return utc
}

export function sessionDateFromMs(ms = Date.now()) {
  const p = etPartsAt(ms)
  return `${p.year}-${p.month}-${p.day}`
}

export function isWeekendEt(ms = Date.now()) {
  const wd = etPartsAt(ms).weekday
  return wd === 'Sat' || wd === 'Sun'
}

export function isUsMarketHoliday(sessionDate) {
  return US_MARKET_HOLIDAYS.has(String(sessionDate || ''))
}

/**
 * Slot fire times for a trading session date (ET calendar day).
 * @param {string} sessionDate YYYY-MM-DD
 * @param {{ openMin?: number, closeMin?: number }} [hours]
 */
export function digestSlotTimes(sessionDate, hours = {}) {
  const openMin = Number.isFinite(hours.openMin) ? hours.openMin : US_RTH_OPEN_MIN
  const closeMin = Number.isFinite(hours.closeMin) ? hours.closeMin : US_RTH_CLOSE_MIN
  const [y, mo, d] = String(sessionDate).split('-')
  if (!y || !mo || !d) return null
  const openFire = openMin + OPEN_OFFSET_MIN
  const midFire = Math.floor((openMin + closeMin) / 2)
  const closeFire = closeMin + CLOSE_OFFSET_MIN
  const toMs = (mins) =>
    etWallToUtcMs(y, mo, d, Math.floor(mins / 60), mins % 60)
  return {
    sessionDate,
    OPEN: toMs(openFire),
    MIDDAY: toMs(midFire),
    CLOSE: toMs(closeFire),
    openMs: toMs(openMin),
    closeMs: toMs(closeMin),
  }
}

/**
 * Which slots are due now and not past the catch-up horizon (end of session day + 4h).
 * @param {number} [nowMs]
 */
export function dueDigestSlots(nowMs = Date.now()) {
  if (isWeekendEt(nowMs)) return []
  const sessionDate = sessionDateFromMs(nowMs)
  if (isUsMarketHoliday(sessionDate)) return []
  const times = digestSlotTimes(sessionDate)
  if (!times) return []
  const horizon = (times.closeMs || 0) + 4 * 60 * 60 * 1000
  if (nowMs > horizon) return []
  /** @type {Array<'OPEN'|'MIDDAY'|'CLOSE'>} */
  const due = []
  for (const slot of /** @type {const} */ (['OPEN', 'MIDDAY', 'CLOSE'])) {
    const t = times[slot]
    if (t != null && nowMs >= t) due.push(slot)
  }
  return due.map((slot) => ({ sessionDate, slot, fireAt: times[slot] }))
}

function toPlainJson(value) {
  if (value == null) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

export async function fetchQuoteForDigest(ticker) {
  const symbol = toYahooSymbol(ticker) || store.normalizeMomentumTicker(ticker)
  if (!symbol) throw new Error('ticker required')
  const quoteRaw = await yahooFinance.quote(symbol, {}, { validateResult: false })
  const quote = quoteRaw ? toPlainJson(quoteRaw) : null
  const sessionQuote = buildSessionQuote(quote, null)
  const marketState = quote?.marketState || sessionQuote?.marketState || null
  const session = resolveMarketSession(marketState, Date.now())
  const currentPrice =
    sessionQuote?.live?.price ??
    sessionQuote?.regular?.price ??
    null
  const previousClose = sessionQuote?.previousClose ?? null
  const companyName =
    quote?.longName || quote?.shortName || quote?.displayName || null
  return {
    symbol,
    quote,
    sessionQuote,
    marketState,
    session,
    currentPrice: Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : null,
    previousClose: Number.isFinite(Number(previousClose))
      ? Number(previousClose)
      : null,
    companyName,
    assetClass: sessionQuote?.assetClass || classifyMomentumAsset(symbol),
  }
}

/**
 * Day % vs previous official session close (common reference for all slots).
 */
export function dayMovePercent(currentPrice, previousClose) {
  if (currentPrice == null || previousClose == null) return null
  const px = Number(currentPrice)
  const ref = Number(previousClose)
  if (!Number.isFinite(px) || !Number.isFinite(ref) || ref === 0) return null
  return ((px - ref) / ref) * 100
}

/**
 * @param {{ ticker: string, slot: 'OPEN'|'MIDDAY'|'CLOSE', movePercent: number }} p
 */
export function buildDigestTitle({ ticker, slot, movePercent }) {
  const symbol = String(ticker || '').toUpperCase()
  const n = Number(movePercent)
  const abs = Number.isFinite(n) ? Math.abs(n).toFixed(1) : '0.0'
  const up = !Number.isFinite(n) || n >= 0
  if (slot === 'OPEN') {
    return up
      ? `🟢 ${symbol} opens strong ↑ +${abs}%`
      : `🔴 ${symbol} opens lower ↓ ${abs}%`
  }
  if (slot === 'MIDDAY') {
    return up
      ? `🟢 ${symbol} holds higher ↑ +${abs}% at midday`
      : `🔴 ${symbol} slides ↓ ${abs}% at midday`
  }
  return up
    ? `🟢 ${symbol} closes higher ↑ +${abs}% today`
    : `🔴 ${symbol} closes lower ↓ ${abs}% today`
}

/**
 * @param {{ ticker: string, slot: 'OPEN'|'MIDDAY'|'CLOSE', movePercent: number }} p
 */
export function buildDigestLead({ ticker, slot, movePercent }) {
  const symbol = String(ticker || '').toUpperCase()
  const n = Number(movePercent)
  const abs = Number.isFinite(n) ? Math.abs(n).toFixed(1) : '0.0'
  const up = !Number.isFinite(n) || n >= 0
  if (slot === 'OPEN') {
    return up
      ? `Shares are trading ${abs}% above the previous session close after the opening move.`
      : `Shares are trading ${abs}% below the previous session close after the opening move.`
  }
  if (slot === 'MIDDAY') {
    return up
      ? `The stock now stands ${abs}% above the previous session close.`
      : `The stock now stands ${abs}% below the previous session close.`
  }
  return up
    ? `${symbol} finished the session ${abs}% above the previous session close.`
    : `${symbol} finished the session ${abs}% below the previous session close.`
}

/**
 * Strip research labels; never invent a catalyst.
 * @param {Record<string, unknown>|null|undefined} research
 */
export function userFacingResearchText(research) {
  if (!research || research.ok === false) {
    return 'No clear catalyst has been identified yet.'
  }
  let raw =
    String(research.likely_driver || research.push_body || '').trim() ||
    String(research.reason || '').trim()
  if (!raw) return 'No clear catalyst has been identified yet.'

  // Prefer structured likely driver when full reason blob is present
  const driverMatch = raw.match(/Likely driver:\s*([^\n]+)/i)
  if (driverMatch?.[1]?.trim()) {
    raw = driverMatch[1].trim()
  } else {
    raw = raw
      .replace(/^Likely driver:\s*/gim, '')
      .replace(/^Secondary driver:\s*.*$/gim, '')
      .replace(/^Move classification:\s*.*$/gim, '')
      .replace(/^Confidence:\s*.*$/gim, '')
      .replace(/\n{2,}/g, '\n')
      .trim()
  }

  // Drop leftover section labels the user forbade
  raw = raw
    .replace(/\b(Likely driver|Reason|Threshold|Episode|Trigger)\s*:?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!raw || raw.length < 8) {
    return 'No clear catalyst has been identified yet.'
  }
  return raw
}

function memoryDigestFromRow(row) {
  if (!row) return null
  const payload =
    row.payload && typeof row.payload === 'object' ? row.payload : {}
  return {
    id: row.id || payload.id || null,
    ticker: row.ticker || payload.ticker,
    sessionDate: row.session_date || payload.sessionDate,
    slot: row.slot || payload.slot,
    direction: row.direction || payload.direction,
    movePercent: num(row.move_percent ?? payload.movePercent),
    currentPrice: num(row.current_price ?? payload.currentPrice),
    previousClose: num(row.previous_close ?? payload.previousClose),
    title: row.title || payload.title || null,
    body: row.body || payload.body || null,
    researchText: row.research_text || payload.researchText || null,
    researchStatus: row.research_status || payload.researchStatus || null,
    status: row.status || payload.status || null,
    notifiedAt: row.notified_at || payload.notifiedAt || null,
    pushResult: row.push_result || payload.pushResult || null,
    detectedAt: row.detected_at || payload.detectedAt || null,
    exchangeTz: row.exchange_tz || payload.exchangeTz || EXCHANGE_TZ,
    assetClass: row.asset_class || payload.assetClass || null,
    ...payload,
    supabaseSaved: true,
  }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Claim a digest slot. Returns row if we own the work, null if already taken.
 */
async function claimDigestSlot({
  ticker,
  sessionDate,
  slot,
  movePercent,
  currentPrice,
  previousClose,
  direction,
  title,
  body,
  assetClass,
}) {
  const key = claimKey(ticker, sessionDate, slot)
  if (inFlightClaims.has(key)) return null
  inFlightClaims.add(key)

  const supabase = getSupabaseOrNull()
  const nowIso = new Date().toISOString()
  const draft = {
    ticker,
    session_date: sessionDate,
    slot,
    direction,
    move_percent: movePercent,
    current_price: currentPrice,
    previous_close: previousClose,
    title,
    body,
    research_text: null,
    research_status: 'pending',
    status: 'running',
    detected_at: nowIso,
    exchange_tz: EXCHANGE_TZ,
    asset_class: assetClass || 'equity',
    payload: {
      ticker,
      sessionDate,
      slot,
      direction,
      movePercent,
      currentPrice,
      previousClose,
      title,
      body,
    },
    updated_at: nowIso,
  }

  if (!supabase) {
    // No Supabase: in-memory only (still deduped via inFlightClaims this process)
    const mem = memoryDigestFromRow({
      ...draft,
      id: `local-${key}`,
    })
    store.upsertDigest(ticker, mem)
    return mem
  }

  const { data, error } = await supabase
    .from('momentum_daily_digests')
    .insert(draft)
    .select('*')
    .maybeSingle()

  if (error) {
    // Unique violation → already delivered / in progress elsewhere
    if (
      String(error.code) === '23505' ||
      /duplicate|unique/i.test(String(error.message || ''))
    ) {
      inFlightClaims.delete(key)
      return null
    }
    console.warn('[daily digest] claim insert failed:', error.message)
    inFlightClaims.delete(key)
    return null
  }

  const mem = memoryDigestFromRow(data)
  store.upsertDigest(ticker, mem)
  return mem
}

async function finalizeDigest(ticker, row, patch) {
  const supabase = getSupabaseOrNull()
  const nowIso = new Date().toISOString()
  const next = {
    ...row,
    ...patch,
    updated_at: nowIso,
  }
  store.upsertDigest(ticker, next)

  if (!supabase || !row?.id || String(row.id).startsWith('local-')) {
    return next
  }

  const dbPatch = {
    title: next.title,
    body: next.body,
    research_text: next.researchText ?? next.research_text,
    research_status: next.researchStatus ?? next.research_status,
    research_payload: next.researchPayload || next.research_payload || {},
    status: next.status,
    notified_at: next.notifiedAt ?? next.notified_at,
    push_result: next.pushResult ?? next.push_result,
    direction: next.direction,
    move_percent: next.movePercent ?? next.move_percent,
    current_price: next.currentPrice ?? next.current_price,
    previous_close: next.previousClose ?? next.previous_close,
    payload: {
      ...(typeof next.payload === 'object' && next.payload ? next.payload : {}),
      title: next.title,
      body: next.body,
      researchText: next.researchText,
      researchStatus: next.researchStatus,
      status: next.status,
      notifiedAt: next.notifiedAt,
      pushResult: next.pushResult,
    },
    updated_at: nowIso,
  }

  const { error } = await supabase
    .from('momentum_daily_digests')
    .update(dbPatch)
    .eq('id', row.id)
  if (error) {
    console.warn('[daily digest] finalize failed:', error.message)
  }
  return next
}

/**
 * Run one OPEN/MIDDAY/CLOSE digest for a ticker (research → push → persist).
 */
export async function runDigestSlot(ticker, slot, sessionDate, quoteSnap) {
  const symbol = store.normalizeMomentumTicker(ticker)
  if (!symbol || !isDigestEligibleTicker(symbol)) return null

  const currentPrice = quoteSnap.currentPrice
  const previousClose = quoteSnap.previousClose
  const movePercent = dayMovePercent(currentPrice, previousClose)
  if (movePercent == null) {
    store.pushLog(
      symbol,
      'warn',
      `Daily digest ${slot} skipped — missing price vs previous close`,
      'digest',
    )
    return null
  }

  const direction = movePercent >= 0 ? 'UP' : 'DOWN'
  const title = buildDigestTitle({ ticker: symbol, slot, movePercent })
  const lead = buildDigestLead({ ticker: symbol, slot, movePercent })

  const claimed = await claimDigestSlot({
    ticker: symbol,
    sessionDate,
    slot,
    movePercent,
    currentPrice,
    previousClose,
    direction,
    title,
    body: lead,
    assetClass: quoteSnap.assetClass,
  })
  if (!claimed) return null

  store.pushLog(
    symbol,
    'info',
    `Daily digest ${slot} claimed · day ${movePercent >= 0 ? '+' : ''}${movePercent.toFixed(2)}% vs prior close`,
    'digest',
    { sessionDate, slot, movePercent },
  )

  // Research (same pipeline as STARTED; wait before push)
  let research
  try {
    research = await researchStartMove({
      ticker: symbol,
      companyName: quoteSnap.companyName,
      windowKey: 'day',
      windowLabel: 'day',
      exactLabel: slot === 'OPEN' ? 'open' : slot === 'MIDDAY' ? 'midday' : 'session',
      movePercent,
      livePrice: currentPrice,
      referencePrice: previousClose,
      referenceTime: quoteSnap.sessionQuote?.previousCloseTime || null,
      marketSession:
        slot === 'CLOSE' ? 'CLOSED' : quoteSnap.session || 'REGULAR',
      assetClass: quoteSnap.assetClass || 'equity',
      direction,
    })
  } catch (err) {
    research = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const researchText = userFacingResearchText(research)
  const body = `${lead}\n\n${researchText}`.trim()
  const finalTitle = title

  // Push via existing Trigger watchlist path
  const supabase = getSupabaseOrNull()
  const dryRun = process.env.MOMENTUM_PUSH_DRY_RUN === '1'
  let pushResult
  try {
    pushResult = await sendTriggerEpisodePush({
      supabase,
      ticker: symbol,
      title: finalTitle,
      body,
      eventType: `DAILY_DIGEST_${slot}`,
      direction,
      movePercent,
      price: currentPrice,
      episodeId: null,
      detectedWindow: 'day',
      reason: `DIGEST_${slot}`,
      marketSession:
        slot === 'CLOSE' ? 'CLOSED' : quoteSnap.session || 'REGULAR',
      appKey: 'trigger',
      dryRun,
    })
  } catch (err) {
    pushResult = {
      ok: false,
      skipped: false,
      reason: err instanceof Error ? err.message : String(err),
      sent_ok: 0,
      sent_failed: 0,
      recipient_count: 0,
    }
  }

  const notifiedAt = new Date().toISOString()
  const done = await finalizeDigest(symbol, claimed, {
    title: finalTitle,
    body,
    researchText,
    researchStatus: research?.ok ? 'done' : 'error',
    researchPayload: research && typeof research === 'object' ? research : {},
    status: 'done',
    notifiedAt,
    pushResult: {
      ok: pushResult?.ok,
      skipped: pushResult?.skipped || false,
      reason: pushResult?.reason || null,
      sent_ok: pushResult?.sent_ok,
      sent_failed: pushResult?.sent_failed,
      recipient_count: pushResult?.recipient_count,
      device_ids: pushResult?.device_ids || [],
      at: notifiedAt,
      source: 'daily_digest',
      slot,
    },
    direction,
    movePercent,
    currentPrice,
    previousClose,
    detectedAt: claimed.detectedAt || notifiedAt,
    sessionDate,
    slot,
  })

  const sent = pushResult?.sent_ok || 0
  const count = pushResult?.recipient_count || 0
  let level = 'success'
  let msg = `Digest ${slot} · Expo ${sent}/${count} · “${finalTitle}”`
  if (pushResult?.skipped && count === 0) {
    level = 'warn'
    msg = `Digest ${slot} push skipped · ${pushResult?.reason || 'no watchlist devices'}`
  } else if (pushResult && pushResult.ok === false && !pushResult.skipped) {
    level = 'error'
    msg = `Digest ${slot} push failed · sent=${sent}`
  }
  store.pushLog(symbol, level, msg, 'digest', {
    title: finalTitle,
    body,
    pushResult: done.pushResult,
    research_ok: Boolean(research?.ok),
  })

  const key = claimKey(symbol, sessionDate, slot)
  inFlightClaims.delete(key)
  return done
}

/**
 * Load recent digests for a ticker into memory.
 */
export async function hydrateDigests(ticker, opts = {}) {
  const symbol = store.normalizeMomentumTicker(ticker)
  if (!symbol) return
  const supabase = getSupabaseOrNull()
  if (!supabase) return
  const limit = Math.min(90, Math.max(10, Number(opts.limit) || 60))
  try {
    const { data, error } = await supabase
      .from('momentum_daily_digests')
      .select('*')
      .eq('ticker', symbol)
      .order('detected_at', { ascending: false })
      .limit(limit)
    if (error) {
      // Table may not exist yet
      if (!/does not exist|schema cache/i.test(String(error.message || ''))) {
        console.warn('[daily digest] hydrate failed:', error.message)
      }
      return
    }
    const list = (data || []).map(memoryDigestFromRow).filter(Boolean)
    store.setDigests(symbol, list)
  } catch (err) {
    console.warn(
      '[daily digest] hydrate error:',
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Process due digests for one ticker (if equity/index and slot due).
 */
export async function processDigestForTicker(ticker, nowMs = Date.now()) {
  if (!isDailyDigestEnabled()) return []
  const symbol = store.normalizeMomentumTicker(ticker)
  if (!symbol || !isDigestEligibleTicker(symbol)) return []

  const due = dueDigestSlots(nowMs)
  if (!due.length) return []

  // Skip slots already in memory as done
  const existing = store.listDigests(symbol, 90)
  const have = new Set(
    existing
      .filter((d) => d && (d.status === 'done' || d.status === 'running'))
      .map((d) => `${d.sessionDate}|${d.slot}`),
  )

  const pending = due.filter((d) => !have.has(`${d.sessionDate}|${d.slot}`))
  if (!pending.length) return []

  let quoteSnap
  try {
    quoteSnap = await fetchQuoteForDigest(symbol)
  } catch (err) {
    store.pushLog(
      symbol,
      'error',
      `Daily digest quote failed: ${err instanceof Error ? err.message : err}`,
      'digest',
    )
    return []
  }

  // Only fire on a valid trading day: weekend/holiday already filtered.
  // If Yahoo says CLOSED long before CLOSE slot and we never opened, still allow
  // catch-up after close for OPEN/MIDDAY/CLOSE of that session date.
  const results = []
  for (const { sessionDate, slot } of pending) {
    try {
      const row = await runDigestSlot(symbol, slot, sessionDate, quoteSnap)
      if (row) results.push(row)
    } catch (err) {
      store.pushLog(
        symbol,
        'error',
        `Daily digest ${slot} failed: ${err instanceof Error ? err.message : err}`,
        'digest',
      )
    }
  }
  return results
}

/**
 * Scan watchlist (dashboard tabs) for due digests. Does not touch episodes.
 */
export async function runDailyDigestCycle(opts = {}) {
  if (!isDailyDigestEnabled()) {
    return { ok: true, skipped: true, reason: 'disabled' }
  }
  if (cycleRunning) {
    return { ok: false, skipped: true, reason: 'cycle already running' }
  }
  cycleRunning = true
  const gapMs = Math.max(200, Number(opts.gapMs) || 400)
  try {
    const tickers = store.listWatchedTickers().filter(isDigestEligibleTicker)
    const dueNow = dueDigestSlots(Date.now())
    if (!dueNow.length || !tickers.length) {
      return { ok: true, tickers: tickers.length, due: dueNow.length, results: [] }
    }
    const results = []
    for (const t of tickers) {
      const rows = await processDigestForTicker(t)
      if (rows?.length) results.push(...rows)
      if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs))
    }
    return { ok: true, tickers: tickers.length, due: dueNow.length, results }
  } finally {
    cycleRunning = false
  }
}
