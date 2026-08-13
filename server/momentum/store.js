/**
 * In-memory per-ticker episode + event store (dev). Lost on process restart.
 */
import { MOMENTUM_MAX_EVENTS, MOMENTUM_TICKER } from './config.js'
import { toYahooSymbol } from '../yahooClient.js'

const MAX_ACTIVITY_LOGS = 200

/**
 * @typedef {{
 *   activeEpisode: Record<string, unknown>|null,
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

/** @returns {TickerState} */
function emptyState() {
  return {
    activeEpisode: null,
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
 * Known UI watchlist (tabs). NOT all are polled — only `focusTicker` is
 * polled aggressively by the background loop.
 * @type {Set<string>}
 */
const watched = new Set()

/**
 * Active tab in the Home UI — the only symbol the poll loop fetches.
 * @type {string}
 */
let focusTicker = MOMENTUM_TICKER

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

/** Active tab — the only ticker the background loop polls. */
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
  bucket(ticker).activeEpisode = episode ? { ...episode } : null
}

export function pushEvent(ticker, event) {
  const s = bucket(ticker)
  s.events.unshift(event)
  if (s.events.length > MOMENTUM_MAX_EVENTS) s.events.length = MOMENTUM_MAX_EVENTS
  return event
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

export function listEvents(ticker, limit = 40) {
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
    snapshot: s.lastSnapshot,
    events: listEvents(key, 40),
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
    return
  }
  states.clear()
  // Re-seed empty buckets for currently watched so loop keeps working
  for (const key of watched) {
    states.set(key, emptyState())
  }
}

// Bootstrap default ticker so first poll has something to do
ensureTicker(MOMENTUM_TICKER)
