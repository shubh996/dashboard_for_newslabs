/**
 * Market open / close bulletin for US equities RTH only.
 *
 * Timing (America/New_York cash session only — not pre/post):
 *   OPEN  = 9:30 ET + 5m, fire window open only until +20m after that
 *   CLOSE = 16:00 ET + 5m, fire window open only until +20m after that
 *
 * Never fires mid-session, on weekends, on US market holidays, or outside the
 * short post-open / post-close grace window. Durable claim file survives restarts
 * so “The US market has opened” cannot re-send all day when the API reloads.
 *
 * Title:  "The US market has opened" / "The US market has closed"
 * Body:   short copy — no full watchlist dump
 *
 * Disable: MOMENTUM_MARKET_BULLETIN_ENABLED=0
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  loadExpoRecipientsForTicker,
  sendExpoPush,
} from '../notifications.js'
import { resolvePushRecipients } from './testMode.js'
import { alertDisplayName, formatDashesToCommas } from './notifyCopy.js'
import {
  isDigestEligibleTicker,
  dayMovePercent,
  fetchQuoteForDigest,
  digestSlotTimes,
  sessionDateFromMs,
  isWeekendEt,
  isUsMarketHoliday,
} from './dailyDigest.js'
import * as store from './store.js'

const EXCHANGE_TZ = 'America/New_York'
const US_RTH_OPEN_MIN = 9 * 60 + 30
const US_RTH_CLOSE_MIN = 16 * 60
/** Fire a few minutes after open/close so prints exist. */
const OPEN_BULLETIN_OFFSET_MIN = 5
const CLOSE_BULLETIN_OFFSET_MIN = 5
/**
 * Only fire while now is inside [fireAt, fireAt + grace).
 * Prevents “market opened” from re-sending all day after a server restart.
 */
const BULLETIN_FIRE_GRACE_MIN = 20

/** Survives process restarts (API --watch reloads used to re-blast OPEN all day). */
const CLAIM_STORE_PATH = path.resolve(
  process.cwd(),
  'data/momentum-market-bulletin-claims.json',
)

/** sessionDate|OPEN or sessionDate|CLOSE — memory + disk */
const claimedBulletins = new Set()
let claimsHydrated = false

let cycleRunning = false

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
    /* ignore corrupt claim file */
  }
}

function persistClaimsToDisk() {
  try {
    const dir = path.dirname(CLAIM_STORE_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    // Keep last ~40 sessions of keys (OPEN+CLOSE × ~40)
    let keys = [...claimedBulletins]
    if (keys.length > 80) keys = keys.slice(-80)
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

function isClaimed(key) {
  hydrateClaimsFromDisk()
  return claimedBulletins.has(key)
}

function markClaimed(key) {
  hydrateClaimsFromDisk()
  if (claimedBulletins.has(key)) return
  claimedBulletins.add(key)
  if (claimedBulletins.size > 80) {
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
  // Headings use friendly names: Natural Gas (+1.2%), not NG=F
  const name = alertDisplayName(ticker)
  if (!name) return ''
  if (movePercent == null || movePercent === '') return `${name} (n/a)`
  const n = Number(movePercent)
  if (!Number.isFinite(n)) return `${name} (n/a)`
  // One decimal · ASCII sign only (em/en dashes rewritten by formatDashesToCommas)
  // e.g. SNDK (+5.1%) · Crude Oil (-0.4%)
  const abs = Math.abs(n).toFixed(1)
  const signed = n > 0 ? `+${abs}` : n < 0 ? `-${abs}` : abs
  return `${name} (${signed}%)`
}

/**
 * @deprecated watchlist body no longer used on lock-screen push.
 * Kept for tests / optional debug payloads.
 * @param {Array<{ ticker: string, movePercent: number|null }>} rows
 */
export function buildMarketBulletinBody(rows) {
  const parts = (rows || [])
    .map((r) => formatStockBracketPct(r.ticker, r.movePercent))
    .filter(Boolean)
  return parts.join(' · ')
}

/**
 * Lock-screen body — no ticker dump, no (n/a) watchlist spam.
 * @param {'OPEN'|'CLOSE'} slot
 */
export function buildMarketBulletinPushBody(slot) {
  if (slot === 'CLOSE') {
    // Punchy after-hours line — Trigger keeps watching overnight
    return 'Trigger never sleeps. We will alert you if unusual momentum is triggered on any of your watchlist assets.'
  }
  return "We will alert you if unusual momentum is detected in any of your watchlist assets. Tap to see what's moving."
}

/**
 * Title only — no date (date is noise on the lock screen).
 * @param {'OPEN'|'CLOSE'} slot
 * @param {string} [_sessionDate] ignored (kept for call-site compatibility)
 */
export function buildMarketBulletinTitle(slot, _sessionDate = '') {
  if (slot === 'CLOSE') return 'The US market has closed'
  return 'The US market has opened'
}

/**
 * True when now is inside the short fire window after fireAt.
 * @param {number} nowMs
 * @param {number} fireAtMs
 * @param {number} [graceMin]
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
 * Due bulletin slots for now (OPEN / CLOSE only — not midday, not all day).
 * Only returns a slot while now is within the post-open / post-close grace window.
 * @param {number} [nowMs]
 * @returns {Array<{ sessionDate: string, slot: 'OPEN'|'CLOSE', fireAt: number }>}
 */
export function dueMarketBulletinSlots(nowMs = Date.now()) {
  if (isWeekendEt(nowMs)) return []
  const sessionDate = sessionDateFromMs(nowMs)
  if (isUsMarketHoliday(sessionDate)) return []
  const times = digestSlotTimes(sessionDate, {
    openMin: US_RTH_OPEN_MIN,
    closeMin: US_RTH_CLOSE_MIN,
  })
  if (!times) return []

  // US equity RTH only: 9:30 + 5m / 16:00 + 5m
  const openFireAt =
    (times.openMs || 0) + OPEN_BULLETIN_OFFSET_MIN * 60_000
  const closeFireAt =
    (times.closeMs || 0) + CLOSE_BULLETIN_OFFSET_MIN * 60_000

  /** @type {Array<{ sessionDate: string, slot: 'OPEN'|'CLOSE', fireAt: number }>} */
  const due = []
  if (isWithinBulletinFireWindow(nowMs, openFireAt)) {
    due.push({ sessionDate, slot: 'OPEN', fireAt: openFireAt })
  }
  if (isWithinBulletinFireWindow(nowMs, closeFireAt)) {
    due.push({ sessionDate, slot: 'CLOSE', fireAt: closeFireAt })
  }
  return due
}

function claimKey(sessionDate, slot) {
  return `MARKET|${sessionDate}|${slot}`
}

/**
 * Union of Expo recipients watching any of the given tickers (Trigger app).
 */
async function loadRecipientsForTickers(supabase, tickers) {
  const byToken = new Map()
  if (supabase) {
    for (const t of tickers) {
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
        /* skip ticker */
      }
    }
  }
  // Test mode → only tester; prod → union of watchlist + always-notify
  return resolvePushRecipients([...byToken.values()], 'trigger')
}

/**
 * Collect day-% rows for watched equities/indexes.
 * @param {string[]} tickers
 * @param {number} [gapMs]
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
  // Sort: largest |move| first so body leads with movers
  rows.sort(
    (a, b) =>
      Math.abs(Number(b.movePercent) || 0) - Math.abs(Number(a.movePercent) || 0),
  )
  return rows
}

/**
 * Run one OPEN or CLOSE market bulletin if due and not already claimed.
 * By default refuses to send outside the short post-open / post-close fire window
 * (prevents mid-session “market opened” blasts after restarts).
 *
 * @param {'OPEN'|'CLOSE'} slot
 * @param {string} sessionDate
 * @param {{ force?: boolean, nowMs?: number }} [opts]
 */
export async function runMarketSessionBulletin(slot, sessionDate, opts = {}) {
  if (!isMarketBulletinEnabled()) {
    return { ok: true, skipped: true, reason: 'disabled' }
  }
  // Hard guard: only OPEN / CLOSE, never midday or free-form slots.
  const slotUp = String(slot || '').toUpperCase()
  if (slotUp !== 'OPEN' && slotUp !== 'CLOSE') {
    return { ok: true, skipped: true, reason: 'invalid_slot' }
  }
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now()
  if (!opts.force) {
    const due = dueMarketBulletinSlots(nowMs)
    const okNow = due.some(
      (d) => d.slot === slotUp && d.sessionDate === String(sessionDate),
    )
    if (!okNow) {
      return { ok: true, skipped: true, reason: 'outside_fire_window' }
    }
  }
  const key = claimKey(sessionDate, slotUp)
  if (isClaimed(key)) {
    return { ok: true, skipped: true, reason: 'already_claimed' }
  }
  // Claim before send so concurrent poll/boot + restarts cannot double-blast.
  markClaimed(key)

  const tickers = store
    .listWatchedTickers()
    .filter(isDigestEligibleTicker)
  if (!tickers.length) {
    return { ok: true, skipped: true, reason: 'no_eligible_tickers' }
  }

  // Lock-screen body is fixed short copy only — never dump the watchlist
  // (old path produced "IONQ (n/a) · TTD (n/a) · …" spam).
  const rows = []
  const title = formatDashesToCommas(
    buildMarketBulletinTitle(slotUp, sessionDate),
  )
  const body = formatDashesToCommas(buildMarketBulletinPushBody(slotUp))

  const supabase = getSupabaseOrNull()
  const dryRun = process.env.MOMENTUM_PUSH_DRY_RUN === '1'
  const recipients = await loadRecipientsForTickers(supabase, tickers)

  let pushResult = {
    ok: true,
    skipped: false,
    reason: null,
    sent_ok: 0,
    sent_failed: 0,
    recipient_count: recipients.length,
  }

  if (dryRun) {
    pushResult = {
      ...pushResult,
      skipped: true,
      reason: 'dry_run',
    }
  } else if (!recipients.length) {
    pushResult = {
      ...pushResult,
      skipped: true,
      reason: 'no_recipients',
    }
  } else {
    const messages = recipients.map((r) => ({
      to: r.expo_push_token,
      sound: 'default',
      title,
      body,
      data: {
        type: 'market_session_bulletin',
        notification_type: `trigger_market_${slotUp.toLowerCase()}`,
        kind: 'market_bulletin',
        event_type: `MARKET_${slotUp}`,
        slot: slotUp,
        session_date: String(sessionDate),
        app_key: 'trigger',
        notification_title: title,
        notification_body: body,
        // Open app home — not a single stock / watchlist dump
        ticker: tickers[0] || '',
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

  // Log on focus / first ticker
  const logTicker = tickers[0] || 'SNDK'
  store.pushLog(
    logTicker,
    pushResult.skipped ? 'warn' : pushResult.ok ? 'success' : 'error',
    `Market bulletin ${slotUp} · ${title} · Expo ${pushResult.sent_ok || 0}/${pushResult.recipient_count || 0}`,
    'digest',
    { slot: slotUp, sessionDate, title, body, pushResult },
  )

  return {
    ok: Boolean(pushResult.ok),
    slot: slotUp,
    sessionDate,
    title,
    body,
    rows,
    pushResult,
  }
}

/**
 * Scan for due OPEN/CLOSE bulletins and fire once each.
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
    const due = dueMarketBulletinSlots(Date.now())
    if (!due.length) {
      return { ok: true, due: 0, results: [], source: opts.source || null }
    }
    const results = []
    for (const { sessionDate, slot } of due) {
      const r = await runMarketSessionBulletin(slot, sessionDate)
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
  try {
    if (fs.existsSync(CLAIM_STORE_PATH)) fs.unlinkSync(CLAIM_STORE_PATH)
  } catch {
    /* ignore */
  }
}
