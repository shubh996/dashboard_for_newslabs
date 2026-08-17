/**
 * In-memory per-ticker episode + event store.
 * History is hydrated from / persisted to Supabase (momentum_episodes).
 * Rearm gates + threshold edge snapshots also persist to local disk so restarts
 * do not invent STARTs from already-elevated windows.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  EPISODE_REARM_BUFFER_PP,
  MOMENTUM_MAX_EVENTS,
  MOMENTUM_TICKER,
} from './config.js'
import { toYahooSymbol } from '../yahooClient.js'

const EDGE_STORE_PATH = path.resolve(
  process.cwd(),
  'data/momentum-edge-state.json',
)

const MAX_ACTIVITY_LOGS = 200

/**
 * @typedef {{
 *   activeEpisode: Record<string, unknown>|null,
 *   historyEpisodes: Array<Record<string, unknown>>,
 *   digests: Array<Record<string, unknown>>,
 *   events: Array<Record<string, unknown>>,
 *   activityLogs: Array<{ at: string, level: string, source: string, message: string, detail?: unknown }>,
 *   lastSnapshot: Record<string, unknown>|null,
 *   lastFetchAt: string|null,
 *   lastError: ErrorDetail|string|null,
 *   tickCount: number,
 * }} TickerState
 */

/**
 * @typedef {{
 *   message: string,
 *   at: string,
 *   source?: string,
 *   name?: string,
 *   code?: string|number|null,
 *   stack?: string|null,
 *   cause?: string|null,
 *   httpStatus?: number|null,
 *   endpoint?: string|null,
 *   raw?: unknown,
 * }} ErrorDetail
 */

const MAX_HISTORY_EPISODES = 80
const MAX_DIGESTS = 90

/** @returns {TickerState} */
function emptyState() {
  return {
    activeEpisode: null,
    historyEpisodes: [],
    digests: [],
    events: [],
    activityLogs: [],
    lastSnapshot: null,
    lastFetchAt: null,
    lastError: null,
    tickCount: 0,
  }
}

/** @type {Map<string, TickerState>} */
const states = new Map()

/**
 * Known watchlist universe (Supabase monitored + UI tabs).
 * Background loop round-robins this list each cycle (see MOMENTUM_POLL_PER_CYCLE).
 * @type {Set<string>}
 */
const watched = new Set()

/**
 * Active tab in the Home UI — polled first each cycle (priority slot).
 * @type {string}
 */
let focusTicker = MOMENTUM_TICKER

/**
 * Per-ticker episode number (mirrors Supabase episode_no per ticker).
 * SNDK → #001, #002… independent of AAPL → #001, #002…
 * @type {Map<string, number>}
 */
const episodeNoByTicker = new Map()

/** Tickers already hydrated from Supabase. */
const hydratedTickers = new Set()

/**
 * After a manual End, do not start a new episode until ≤24h/1D goes quiet.
 * @type {Map<string, { episodeId?: string, at: string }>}
 */
const restartGate = new Map()

/**
 * Direction re-arm after terminal episodes.
 *
 * policy:
 *   FULL    — EXPIRED / ENDED / REVERSAL of same dir: every eligible window must
 *             cool below its own (thr − buffer) before direction re-arms.
 *   SESSION — MARKET_CLOSE only: no multi-window cool-off; next session relies
 *             on threshold *crossing* detection so stale 24h cannot START alone,
 *             but a fresh 5m jump after the open is allowed.
 *
 * @type {Map<string, {
 *   direction: 'UP'|'DOWN',
 *   armed: boolean,
 *   policy: 'FULL'|'SESSION',
 *   bufferPp: number,
 *   episodeId?: string|null,
 *   endReason?: string|null,
 *   at: string,
 * }>}
 */
const rearmGate = new Map()

/**
 * Prior threshold edge snapshot per ticker (for crossing detection).
 * @type {Map<string, {
 *   assetClass?: string,
 *   windows: Record<string, { above: boolean, direction: string|null, move: number|null, thr: number }>,
 *   at: string,
 * }>}
 */
const thresholdEdges = new Map()

let edgePersistTimer = null
function scheduleEdgePersist() {
  if (edgePersistTimer) return
  edgePersistTimer = setTimeout(() => {
    edgePersistTimer = null
    persistEdgeStateToDisk()
  }, 250)
  if (typeof edgePersistTimer.unref === 'function') edgePersistTimer.unref()
}

function persistEdgeStateToDisk() {
  try {
    const dir = path.dirname(EDGE_STORE_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const rearm = {}
    for (const [k, v] of rearmGate.entries()) rearm[k] = { ...v }
    const edges = {}
    for (const [k, v] of thresholdEdges.entries()) {
      edges[k] = {
        assetClass: v.assetClass || 'equity',
        windows: v.windows || {},
        at: v.at || new Date().toISOString(),
      }
    }
    fs.writeFileSync(
      EDGE_STORE_PATH,
      JSON.stringify(
        { updatedAt: new Date().toISOString(), rearm, edges },
        null,
        2,
      ),
      'utf8',
    )
  } catch (err) {
    console.warn(
      '[momentum store] edge-state persist failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

function loadEdgeStateFromDisk() {
  try {
    if (!fs.existsSync(EDGE_STORE_PATH)) return
    const raw = JSON.parse(fs.readFileSync(EDGE_STORE_PATH, 'utf8'))
    if (raw?.rearm && typeof raw.rearm === 'object') {
      for (const [k, v] of Object.entries(raw.rearm)) {
        if (!v || typeof v !== 'object') continue
        rearmGate.set(k, {
          direction: v.direction === 'DOWN' ? 'DOWN' : 'UP',
          armed: Boolean(v.armed),
          policy: v.policy === 'SESSION' ? 'SESSION' : 'FULL',
          bufferPp:
            Number.isFinite(Number(v.bufferPp))
              ? Number(v.bufferPp)
              : EPISODE_REARM_BUFFER_PP,
          episodeId: v.episodeId || null,
          endReason: v.endReason || null,
          at: v.at || new Date().toISOString(),
          // legacy fields ignored
        })
      }
    }
    if (raw?.edges && typeof raw.edges === 'object') {
      for (const [k, v] of Object.entries(raw.edges)) {
        if (!v || typeof v !== 'object') continue
        thresholdEdges.set(k, {
          assetClass: v.assetClass || 'equity',
          windows:
            v.windows && typeof v.windows === 'object' ? { ...v.windows } : {},
          at: v.at || new Date().toISOString(),
        })
      }
    }
  } catch (err) {
    console.warn(
      '[momentum store] edge-state load failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

loadEdgeStateFromDisk()

export function normalizeMomentumTicker(raw) {
  const viaYahoo = toYahooSymbol(raw)
  if (viaYahoo) return viaYahoo
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

/** @returns {TickerState} */
function bucket(ticker) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) throw new Error('ticker required')
  if (!states.has(key)) states.set(key, emptyState())
  return /** @type {TickerState} */ (states.get(key))
}

/**
 * Ensure state exists. Does NOT change focus / poll target by itself.
 * Pass `{ watch: true }` to also register on the known watchlist.
 */
export function ensureTicker(ticker, opts = {}) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return ''
  bucket(key)
  if (opts.watch) watched.add(key)
  return key
}

export function listWatchedTickers() {
  return [...watched]
}

export function listKnownTickers() {
  return [...new Set([...states.keys(), ...watched])]
}

/**
 * Replace the known watchlist (UI tabs). Does not change focus unless
 * current focus is no longer in the list.
 * @param {string[]} tickers
 */
export function setWatchedTickers(tickers) {
  const next = []
  for (const t of tickers || []) {
    const key = normalizeMomentumTicker(t)
    if (!key) continue
    bucket(key)
    if (!next.includes(key)) next.push(key)
  }
  if (!next.length) {
    const fallback = normalizeMomentumTicker(MOMENTUM_TICKER) || 'SNDK'
    bucket(fallback)
    next.push(fallback)
  }
  watched.clear()
  for (const k of next) watched.add(k)
  // Keep focus valid
  if (!watched.has(focusTicker)) {
    focusTicker = next[0]
  }
  return listWatchedTickers()
}

/** Active tab — polled first each cycle (full watchlist still polled 24×7). */
export function setFocusTicker(ticker) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return getFocusTicker()
  bucket(key)
  watched.add(key)
  focusTicker = key
  return focusTicker
}

export function getFocusTicker() {
  if (focusTicker) {
    bucket(focusTicker)
    return focusTicker
  }
  const w = listWatchedTickers()
  if (w.length) {
    focusTicker = w[0]
    return focusTicker
  }
  focusTicker = normalizeMomentumTicker(MOMENTUM_TICKER) || 'SNDK'
  bucket(focusTicker)
  return focusTicker
}

export function getActiveEpisode(ticker) {
  const s = bucket(ticker)
  return s.activeEpisode ? { ...s.activeEpisode } : null
}

export function setActiveEpisode(ticker, episode) {
  // Live engine state only — never inject into the episodes rail.
  // Rail always comes from Supabase via refreshEpisodesFromSupabase.
  bucket(ticker).activeEpisode = episode ? { ...episode } : null
}

/**
 * All in-memory ACTIVE episodes (one per ticker max by invariant).
 * Used by the dashboard “Active episodes” right-rail list.
 * @returns {Array<Record<string, unknown>>}
 */
export function listActiveEpisodes() {
  /** @type {Array<Record<string, unknown>>} */
  const out = []
  for (const key of states.keys()) {
    const ep = getActiveEpisode(key)
    if (!ep) continue
    if (String(ep.status || '').toUpperCase() !== 'ACTIVE') continue
    out.push({
      ...ep,
      ticker: key,
    })
  }
  out.sort((a, b) => {
    const tb =
      Date.parse(String(b.episodeStartedAt || b.triggerTime || b.started_at || '')) ||
      0
    const ta =
      Date.parse(String(a.episodeStartedAt || a.triggerTime || a.started_at || '')) ||
      0
    return tb - ta
  })
  return out
}

/**
 * Atomically claim the single ACTIVE slot for a ticker.
 * Prevents two in-process workers from both opening STARTs in the same tick.
 * Same episodeId may refresh the slot; a different id is rejected while ACTIVE.
 *
 * @param {string} ticker
 * @param {Record<string, unknown>} episode
 * @returns {{ ok: true, claimed: boolean, episode: Record<string, unknown> } | { ok: false, reason: string, existing: Record<string, unknown> }}
 */
export function claimActiveEpisode(ticker, episode) {
  if (!episode?.episodeId) {
    return { ok: false, reason: 'missing_episode_id', existing: getActiveEpisode(ticker) }
  }
  const s = bucket(ticker)
  const existing = s.activeEpisode
  const existingStatus = String(existing?.status || '').toUpperCase()
  const wantId = String(episode.episodeId)
  if (existing && existingStatus === 'ACTIVE') {
    const haveId = String(existing.episodeId || existing.episode_id || '')
    if (haveId && haveId === wantId) {
      s.activeEpisode = { ...existing, ...episode, status: 'ACTIVE' }
      return { ok: true, claimed: false, episode: { ...s.activeEpisode } }
    }
    return {
      ok: false,
      reason: 'already_active',
      existing: { ...existing },
    }
  }
  s.activeEpisode = { ...episode, status: 'ACTIVE' }
  return { ok: true, claimed: true, episode: { ...s.activeEpisode } }
}

/** Push / notify idempotency keys: episodeId + eventType + cycle */
const pushIdempotencyKeys = new Map()
const MAX_PUSH_IDEMPOTENCY = 2000

/**
 * Claim a one-shot push key. Second claim returns false (suppress duplicate send).
 * @param {string} key
 * @returns {boolean} true if first claim
 */
export function tryClaimPushIdempotency(key) {
  const k = String(key || '').trim()
  if (!k) return true
  if (pushIdempotencyKeys.has(k)) return false
  pushIdempotencyKeys.set(k, Date.now())
  if (pushIdempotencyKeys.size > MAX_PUSH_IDEMPOTENCY) {
    const first = pushIdempotencyKeys.keys().next().value
    pushIdempotencyKeys.delete(first)
  }
  return true
}

/** @param {string} [key] clear one key or all */
export function clearPushIdempotency(key) {
  if (key) pushIdempotencyKeys.delete(String(key))
  else pushIdempotencyKeys.clear()
}

/**
 * Replace history list (hydrate from Supabase). Newest-first by started_at.
 * @param {string} ticker
 * @param {Array<Record<string, unknown>>} episodes
 */
export function setHistoryEpisodes(ticker, episodes) {
  const s = bucket(ticker)
  const list = (episodes || []).filter((ep) => ep && ep.episodeId)
  list.sort((a, b) => {
    const tb = Date.parse(String(b.episodeStartedAt || b.started_at || '')) || 0
    const ta = Date.parse(String(a.episodeStartedAt || a.started_at || '')) || 0
    return tb - ta
  })
  s.historyEpisodes = list.slice(0, MAX_HISTORY_EPISODES)
}

/**
 * Insert or update one episode in the history rail source.
 * @param {string} ticker
 * @param {Record<string, unknown>} episode
 */
export function upsertHistoryEpisode(ticker, episode) {
  if (!episode?.episodeId) return
  const s = bucket(ticker)
  const id = String(episode.episodeId)
  const idx = s.historyEpisodes.findIndex(
    (ep) => String(ep?.episodeId || '') === id,
  )
  const next = { ...(idx >= 0 ? s.historyEpisodes[idx] : {}), ...episode }
  if (idx >= 0) s.historyEpisodes[idx] = next
  else s.historyEpisodes.unshift(next)
  s.historyEpisodes.sort((a, b) => {
    const tb = Date.parse(String(b.episodeStartedAt || b.started_at || '')) || 0
    const ta = Date.parse(String(a.episodeStartedAt || a.started_at || '')) || 0
    return tb - ta
  })
  if (s.historyEpisodes.length > MAX_HISTORY_EPISODES) {
    s.historyEpisodes.length = MAX_HISTORY_EPISODES
  }
}

/** @param {string} ticker @param {number} [limit] */
export function listHistoryEpisodes(ticker, limit = 40) {
  const n = Math.min(80, Math.max(1, Number(limit) || 40))
  return bucket(ticker).historyEpisodes.slice(0, n).map((ep) => ({ ...ep }))
}

/**
 * Replace Daily Digest list (hydrate). Newest-first by detected_at.
 * @param {string} ticker
 * @param {Array<Record<string, unknown>>} digests
 */
export function setDigests(ticker, digests) {
  const s = bucket(ticker)
  const list = (digests || []).filter(Boolean)
  list.sort((a, b) => {
    const tb = Date.parse(String(b.detectedAt || b.detected_at || '')) || 0
    const ta = Date.parse(String(a.detectedAt || a.detected_at || '')) || 0
    return tb - ta
  })
  s.digests = list.slice(0, MAX_DIGESTS)
}

/**
 * Insert or update one Daily Digest row in memory.
 * @param {string} ticker
 * @param {Record<string, unknown>} digest
 */
export function upsertDigest(ticker, digest) {
  if (!digest) return
  const s = bucket(ticker)
  const id = digest.id != null ? String(digest.id) : ''
  const slotKey = `${digest.sessionDate || digest.session_date || ''}|${digest.slot || ''}`
  const idx = s.digests.findIndex((d) => {
    if (id && d?.id != null && String(d.id) === id) return true
    const k = `${d?.sessionDate || d?.session_date || ''}|${d?.slot || ''}`
    return slotKey && k === slotKey
  })
  const next = { ...(idx >= 0 ? s.digests[idx] : {}), ...digest }
  if (idx >= 0) s.digests[idx] = next
  else s.digests.unshift(next)
  s.digests.sort((a, b) => {
    const tb = Date.parse(String(b.detectedAt || b.detected_at || '')) || 0
    const ta = Date.parse(String(a.detectedAt || a.detected_at || '')) || 0
    return tb - ta
  })
  if (s.digests.length > MAX_DIGESTS) s.digests.length = MAX_DIGESTS
}

/** @param {string} ticker @param {number} [limit] */
export function listDigests(ticker, limit = 60) {
  const n = Math.min(90, Math.max(1, Number(limit) || 60))
  return bucket(ticker).digests.slice(0, n).map((d) => ({ ...d }))
}

/**
 * Raise the high-water mark for a ticker's episode numbers.
 * @param {string} ticker
 * @param {number} n
 */
export function noteEpisodeNo(ticker, n) {
  // Back-compat: noteEpisodeNo(5) was global — treat as no-op without ticker
  if (n === undefined && (typeof ticker === 'number' || Number.isFinite(Number(ticker)))) {
    return
  }
  const key = normalizeMomentumTicker(ticker)
  const v = Number(n)
  if (!key || !Number.isFinite(v) || v <= 0) return
  const cur = episodeNoByTicker.get(key) || 0
  if (v > cur) episodeNoByTicker.set(key, Math.floor(v))
}

/**
 * Next episode number for this ticker only (#001, #002, …).
 * @param {string} ticker
 */
export function allocateEpisodeNo(ticker) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return 1
  const next = (episodeNoByTicker.get(key) || 0) + 1
  episodeNoByTicker.set(key, next)
  return next
}

/** Max allocated number for a ticker (0 if none). */
export function currentEpisodeNoSeq(ticker) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return 0
  return episodeNoByTicker.get(key) || 0
}

export function markRestartGate(ticker, episodeId) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return
  restartGate.set(key, {
    episodeId: episodeId || null,
    at: new Date().toISOString(),
  })
}

export function hasRestartGate(ticker) {
  const key = normalizeMomentumTicker(ticker)
  return Boolean(key && restartGate.has(key))
}

export function clearRestartGate(ticker) {
  const key = normalizeMomentumTicker(ticker)
  if (key) restartGate.delete(key)
}

/**
 * Disarm same-direction restarts after a terminal episode.
 * @param {string} ticker
 * @param {{
 *   direction: 'UP'|'DOWN',
 *   policy?: 'FULL'|'SESSION',
 *   rearmBufferPp?: number,
 *   episodeId?: string|null,
 *   endReason?: string|null,
 *   startThresholdAbs?: number, // legacy ignored
 * }} opts
 */
export function markDirectionDisarmed(ticker, opts = {}) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return
  const dir = opts.direction === 'DOWN' ? 'DOWN' : 'UP'
  const policy = opts.policy === 'SESSION' ? 'SESSION' : 'FULL'
  // MARKET_CLOSE: do not install a FULL cool-off gate — next session may
  // START on a fresh intraday cross even if 24h is still elevated.
  if (policy === 'SESSION') {
    rearmGate.delete(key)
    scheduleEdgePersist()
    return
  }
  const buffer = Math.max(
    0,
    Number(opts.rearmBufferPp ?? EPISODE_REARM_BUFFER_PP) || 0,
  )
  rearmGate.set(key, {
    direction: dir,
    armed: false,
    policy: 'FULL',
    bufferPp: buffer,
    episodeId: opts.episodeId || null,
    endReason: opts.endReason || null,
    at: new Date().toISOString(),
  })
  scheduleEdgePersist()
}

export function clearRearmGate(ticker) {
  const key = normalizeMomentumTicker(ticker)
  if (key) {
    rearmGate.delete(key)
    scheduleEdgePersist()
  }
}

export function getRearmGate(ticker) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return null
  const g = rearmGate.get(key)
  return g ? { ...g } : null
}

/**
 * Check/update FULL re-arm for a potential new START in `direction`.
 * Pass `perWindow` from detector.evaluatePerWindowRearm (cool + blockers).
 * Legacy callers may still pass absMove as 2nd number — treated as always-cool if no object.
 *
 * @param {string} ticker
 * @param {'UP'|'DOWN'} direction
 * @param {{ cool?: boolean, blockers?: Array<{window:string,move:number,floor:number}> }|number|null} [perWindowOrAbs]
 * @returns {{ allowed: boolean, armed: boolean, reason?: string, gate?: object, justArmed?: boolean, blockers?: unknown[] }}
 */
export function evaluateRearmForStart(ticker, direction, perWindowOrAbs = null) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return { allowed: true, armed: true }
  const g = rearmGate.get(key)
  if (!g) return { allowed: true, armed: true }
  const dir = direction === 'DOWN' ? 'DOWN' : 'UP'
  if (g.direction !== dir) return { allowed: true, armed: true }

  // SESSION gates are not stored (deleted on mark) — defensive
  if (g.policy === 'SESSION') {
    if (!g.armed) {
      g.armed = true
      rearmGate.set(key, g)
      scheduleEdgePersist()
      return { allowed: true, armed: true, justArmed: true, gate: { ...g } }
    }
    return { allowed: true, armed: true, gate: { ...g } }
  }

  if (g.armed) {
    return { allowed: true, armed: true, gate: { ...g } }
  }

  // FULL policy: every window must be below its own thr−buffer
  let cool = false
  /** @type {unknown[]} */
  let blockers = []
  if (perWindowOrAbs && typeof perWindowOrAbs === 'object') {
    cool = Boolean(perWindowOrAbs.cool)
    blockers = Array.isArray(perWindowOrAbs.blockers)
      ? perWindowOrAbs.blockers
      : []
  } else {
    // Legacy numeric max-|move|: never auto-arm from that alone
    cool = false
    blockers = [{ window: '?', move: Number(perWindowOrAbs) || 0, floor: null }]
  }

  if (cool) {
    g.armed = true
    rearmGate.set(key, g)
    scheduleEdgePersist()
    return {
      allowed: true,
      armed: true,
      justArmed: true,
      gate: { ...g },
      blockers: [],
    }
  }

  const sample = blockers
    .slice(0, 4)
    .map((b) => {
      const x = /** @type {{window?:string,move?:number,floor?:number}} */ (b)
      return `${x.window}=${Number(x.move).toFixed(2)}%≥${Number(x.floor).toFixed(2)}%`
    })
    .join(', ')
  return {
    allowed: false,
    armed: false,
    reason: `disarmed until every same-dir window is below its own thr−${g.bufferPp}pp (${sample || 'still elevated'})`,
    gate: { ...g },
    blockers,
  }
}

/** @param {string} ticker */
export function getThresholdEdgeState(ticker) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return null
  const g = thresholdEdges.get(key)
  return g
    ? {
        assetClass: g.assetClass || 'equity',
        windows: { ...(g.windows || {}) },
        at: g.at,
      }
    : null
}

/**
 * @param {string} ticker
 * @param {Record<string, { above: boolean, direction: string|null, move: number|null, thr: number }>} windows
 * @param {string} [assetClass]
 */
export function setThresholdEdgeState(ticker, windows, assetClass = 'equity') {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return
  thresholdEdges.set(key, {
    assetClass: assetClass || 'equity',
    windows: windows && typeof windows === 'object' ? { ...windows } : {},
    at: new Date().toISOString(),
  })
  scheduleEdgePersist()
}

/**
 * Prime all active thr windows as *below* so the next hot poll is a fresh cross.
 * Used by unit tests (and optional bootstrap for synthetic sims).
 * @param {string} ticker
 * @param {string} [assetClass]
 * @param {string[]} [windowKeys]
 */
export function primeThresholdEdgesBelow(ticker, assetClass = 'equity', windowKeys = null) {
  const key = normalizeMomentumTicker(ticker)
  if (!key) return
  /** @type {Record<string, { above: boolean, direction: null, move: number, thr: number }>} */
  const windows = {}
  const keys = Array.isArray(windowKeys) && windowKeys.length
    ? windowKeys
    : ['1m', '5m', '10m', '15m', '30m', '45m', '60m', '90m', '2h', '3h', '5h', '6h', '8h', '10h', '12h', '16h', '18h', '20h', '24h', 'day']
  for (const wk of keys) {
    windows[wk] = { above: false, direction: null, move: 0, thr: 0 }
  }
  thresholdEdges.set(key, {
    assetClass,
    windows,
    at: new Date().toISOString(),
  })
  scheduleEdgePersist()
}

export function clearThresholdEdgeState(ticker) {
  const key = normalizeMomentumTicker(ticker)
  if (key) {
    thresholdEdges.delete(key)
    scheduleEdgePersist()
  }
}

export function isHydrated(ticker) {
  const key = normalizeMomentumTicker(ticker)
  return Boolean(key && hydratedTickers.has(key))
}

export function markHydrated(ticker) {
  const key = normalizeMomentumTicker(ticker)
  if (key) hydratedTickers.add(key)
}

function eventDedupeKey(ev) {
  return [
    ev?.eventType || '',
    ev?.detectedAt || '',
    ev?.episodeId || '',
    ev?.state || '',
  ].join('|')
}

/** Merge older Supabase history under live in-memory events (newest first). */
export function mergeHistoryEvents(ticker, events) {
  if (!events?.length) return
  const s = bucket(ticker)
  const have = new Set(s.events.map(eventDedupeKey))
  const add = []
  for (const ev of events) {
    if (!ev || have.has(eventDedupeKey(ev))) continue
    have.add(eventDedupeKey(ev))
    add.push(ev)
  }
  if (!add.length) return
  s.events = [...s.events, ...add].sort((a, b) => {
    const tb = Date.parse(String(b?.detectedAt || '')) || 0
    const ta = Date.parse(String(a?.detectedAt || '')) || 0
    return tb - ta
  })
  if (s.events.length > MOMENTUM_MAX_EVENTS) s.events.length = MOMENTUM_MAX_EVENTS
}

/**
 * Replace timeline events entirely (Supabase-only rail — no memory merge).
 * @param {string} ticker
 * @param {Array<Record<string, unknown>>} events
 */
export function replaceEvents(ticker, events) {
  const s = bucket(ticker)
  const list = (events || []).filter(Boolean)
  list.sort((a, b) => {
    const tb = Date.parse(String(b?.detectedAt || '')) || 0
    const ta = Date.parse(String(a?.detectedAt || '')) || 0
    return tb - ta
  })
  s.events = list.slice(0, MOMENTUM_MAX_EVENTS)
}

export function pushEvent(ticker, event) {
  const s = bucket(ticker)
  s.events.unshift(event)
  if (s.events.length > MOMENTUM_MAX_EVENTS) s.events.length = MOMENTUM_MAX_EVENTS
  return event
}

function persistMatch(ev, row) {
  const evAt = String(ev?.detectedAt || '')
  const rowAt = String(row?.detected_at || row?.detectedAt || '')
  const evType = String(ev?.eventType || '')
  const rowType = String(row?.event_type || row?.eventType || '')
  const evId = String(ev?.episodeId || '')
  const rowId = String(row?.episode_id || row?.episodeId || '')
  if (evType !== rowType) return false
  if (evId && rowId && evId !== rowId) return false
  if (evAt && rowAt) {
    const a = Date.parse(evAt)
    const b = Date.parse(rowAt)
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) < 1500
    return evAt === rowAt
  }
  return false
}

/** Stamp in-memory events after a successful Supabase upsert. */
export function markEventsPersisted(ticker, rows) {
  if (!rows?.length) return
  const s = bucket(ticker)
  const nowIso = new Date().toISOString()
  for (const row of rows) {
    const created = Date.parse(row.created_at || row.createdAt || '')
    const updated = Date.parse(row.updated_at || row.updatedAt || '')
    const action =
      Number.isFinite(created) &&
      Number.isFinite(updated) &&
      updated - created > 1500
        ? 'updated'
        : 'saved'
    const stamp = {
      ok: true,
      action,
      at: row.updated_at || row.created_at || nowIso,
      id: row.id || null,
    }
    const ev = s.events.find((item) => persistMatch(item, row))
    if (ev) {
      ev.supabaseSaved = true
      ev.supabasePersist = stamp
    }
  }
}

export function markEpisodePersisted(ticker, stamp) {
  const ep = bucket(ticker).activeEpisode
  if (!ep || !stamp) return
  ep.supabaseSaved = true
  ep.supabasePersist = stamp
}

/**
 * Patch the first matching event in-place (e.g. research running → done).
 * @param {string} ticker
 * @param {(ev: Record<string, unknown>) => boolean} matchFn
 * @param {Record<string, unknown>} patch
 */
export function updateEvent(ticker, matchFn, patch) {
  const s = bucket(ticker)
  const idx = s.events.findIndex((ev) => {
    try {
      return matchFn(ev)
    } catch {
      return false
    }
  })
  if (idx < 0) return null
  const prev = s.events[idx] || {}
  const nextResearch =
    patch.research && typeof patch.research === 'object'
      ? { ...(prev.research || {}), ...patch.research }
      : patch.research !== undefined
        ? patch.research
        : prev.research
  const next = {
    ...prev,
    ...patch,
    research: nextResearch,
  }
  s.events[idx] = next
  return next
}

/**
 * Remove all events matching the predicate (e.g. stale RESEARCH_RUNNING rows).
 * @param {string} ticker
 * @param {(ev: Record<string, unknown>) => boolean} matchFn
 * @returns {number} count removed
 */
export function removeEvents(ticker, matchFn) {
  const s = bucket(ticker)
  const before = s.events.length
  s.events = s.events.filter((ev) => {
    try {
      return !matchFn(ev)
    } catch {
      return true
    }
  })
  return before - s.events.length
}

export function listEvents(ticker, limit = 200) {
  return bucket(ticker).events.slice(0, limit)
}

export function setLastSnapshot(ticker, snapshot) {
  bucket(ticker).lastSnapshot = snapshot
}

export function getLastSnapshot(ticker) {
  return bucket(ticker).lastSnapshot
}

export function setLastFetchAt(ticker, iso) {
  bucket(ticker).lastFetchAt = iso
}

export function getLastFetchAt(ticker) {
  return bucket(ticker).lastFetchAt
}

/**
 * Store a structured error (or clear with null).
 * @param {string} ticker
 * @param {string|ErrorDetail|null} error
 * @param {Partial<ErrorDetail>} [extra]
 */
export function setLastError(ticker, error, extra = {}) {
  if (error == null || error === '') {
    bucket(ticker).lastError = null
    return null
  }
  if (typeof error === 'object' && error.message) {
    bucket(ticker).lastError = {
      at: error.at || new Date().toISOString(),
      message: String(error.message),
      source: error.source || extra.source || 'momentum',
      name: error.name || extra.name || null,
      code: error.code ?? extra.code ?? null,
      stack: error.stack || extra.stack || null,
      cause: error.cause || extra.cause || null,
      httpStatus: error.httpStatus ?? extra.httpStatus ?? null,
      endpoint: error.endpoint || extra.endpoint || null,
      raw: error.raw !== undefined ? error.raw : extra.raw,
    }
    return bucket(ticker).lastError
  }
  bucket(ticker).lastError = {
    at: new Date().toISOString(),
    message: String(error),
    source: extra.source || 'momentum',
    name: extra.name || null,
    code: extra.code ?? null,
    stack: extra.stack || null,
    cause: extra.cause || null,
    httpStatus: extra.httpStatus ?? null,
    endpoint: extra.endpoint || null,
    raw: extra.raw,
  }
  return bucket(ticker).lastError
}

export function getLastError(ticker) {
  return bucket(ticker).lastError
}

/** Human one-liner for logs / console */
export function lastErrorMessage(ticker) {
  const e = getLastError(ticker)
  if (!e) return null
  if (typeof e === 'string') return e
  return e.message || null
}

export function bumpTick(ticker) {
  const s = bucket(ticker)
  s.tickCount += 1
  return s.tickCount
}

/**
 * @param {string} ticker
 * @param {'info'|'success'|'warn'|'error'} level
 * @param {string} message
 * @param {string} [source]
 * @param {unknown} [detail]
 */
export function pushLog(ticker, level, message, source = 'momentum', detail) {
  const entry = {
    at: new Date().toISOString(),
    level: level || 'info',
    source: source || 'momentum',
    message: String(message || ''),
    detail: detail === undefined ? null : detail,
  }
  const s = bucket(ticker)
  s.activityLogs.unshift(entry)
  if (s.activityLogs.length > MAX_ACTIVITY_LOGS) {
    s.activityLogs.length = MAX_ACTIVITY_LOGS
  }
  return entry
}

export function listLogs(ticker, limit = 120) {
  return bucket(ticker).activityLogs.slice(0, limit)
}

export function getDebugState(ticker) {
  const key = ensureTicker(ticker)
  const s = bucket(key)
  const err = s.lastError
  const lastErrorMessage =
    err == null
      ? null
      : typeof err === 'string'
        ? err
        : err.message || null
  return {
    ticker: key,
    lastFetchAt: s.lastFetchAt,
    /** One-line message (always string|null for simple UIs) */
    lastError: lastErrorMessage,
    /** Full structured error for detailed UI */
    lastErrorDetail: err && typeof err === 'object' ? err : err ? { message: err, at: null } : null,
    tickCount: s.tickCount,
    episode: getActiveEpisode(key),
    /** Past + active episodes for the Episodes rail (from Supabase hydrate + live). */
    episodes: listHistoryEpisodes(key, 40),
    /** Daily Digest OPEN / MIDDAY / CLOSE rows (separate from episodes). */
    digests: listDigests(key, 60),
    snapshot: s.lastSnapshot,
    events: listEvents(key, 200),
    logs: listLogs(key, 120),
  }
}

/**
 * Reset one ticker, or every ticker when omitted.
 * @param {string} [ticker]
 */
export function resetStore(ticker) {
  if (ticker) {
    const key = normalizeMomentumTicker(ticker)
    if (!key) return
    states.set(key, emptyState())
    restartGate.delete(key)
    rearmGate.delete(key)
    thresholdEdges.delete(key)
    hydratedTickers.delete(key)
    // Drop push keys for this ticker prefix (best-effort)
    for (const k of [...pushIdempotencyKeys.keys()]) {
      if (k.startsWith(`${key}:`) || k.includes(`:${key}:`)) {
        pushIdempotencyKeys.delete(k)
      }
    }
    scheduleEdgePersist()
    return
  }
  states.clear()
  restartGate.clear()
  rearmGate.clear()
  thresholdEdges.clear()
  hydratedTickers.clear()
  pushIdempotencyKeys.clear()
  // Re-seed empty buckets for currently watched so loop keeps working
  for (const key of watched) {
    states.set(key, emptyState())
  }
  scheduleEdgePersist()
}

// Bootstrap default ticker so first poll has something to do
ensureTicker(MOMENTUM_TICKER)
