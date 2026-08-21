/**
 * Multi-ticker momentum engine configuration.
 * Tune thresholds / poll interval here (or via env).
 */

import fs from 'node:fs'
import path from 'node:path'
import { toYahooSymbol } from '../yahooClient.js'
import { isTestModeEnabled } from './testMode.js'

const THRESHOLD_STORE_PATH = path.resolve(
  process.cwd(),
  'data/momentum-thresholds.json',
)

/** Primary / bootstrap ticker (env MOMENTUM_TICKER). */
export const MOMENTUM_TICKER = toYahooSymbol(
  String(process.env.MOMENTUM_TICKER || 'SNDK').trim(),
) || 'SNDK'

/**
 * Optional comma-separated bootstrap watchlist:
 *   MOMENTUM_TICKERS=SNDK,TSLA,BTC-USD,GC=F,EURUSD=X
 * Falls back to MOMENTUM_TICKER alone.
 */
export const MOMENTUM_BOOTSTRAP_TICKERS = (() => {
  const raw = String(process.env.MOMENTUM_TICKERS || '').trim()
  if (!raw) return [MOMENTUM_TICKER]
  const list = raw
    .split(/[,|\s]+/)
    .map((t) => toYahooSymbol(t) || String(t).trim().toUpperCase())
    .filter(Boolean)
  return list.length ? [...new Set(list)] : [MOMENTUM_TICKER]
})()

/** Default 60s. Override with MOMENTUM_POLL_MS (milliseconds). */
export const MOMENTUM_POLL_MS = Math.max(
  5_000,
  Number(process.env.MOMENTUM_POLL_MS || 60_000) || 60_000,
)

/** Pause between tickers inside one poll cycle (rate-limit friendly). */
export const MOMENTUM_TICKER_GAP_MS = Math.max(
  0,
  Number(process.env.MOMENTUM_TICKER_GAP_MS || 350) || 350,
)

/**
 * Max tickers kept on the engine watchlist (Supabase universe).
 * This is NOT “only poll these forever” — see MOMENTUM_POLL_PER_CYCLE.
 * Default 200 so all Trigger-monitored symbols fit.
 */
export const MOMENTUM_MAX_WATCHED = Math.max(
  1,
  Number(process.env.MOMENTUM_MAX_WATCHED || 200) || 200,
)

/**
 * How many symbols to Yahoo-fetch in a single poll cycle.
 * Focus + active episodes always included; remaining slots rotate (round-robin)
 * across the full watchlist so every ticker is covered over a few cycles.
 * Default 20 keeps Yahoo load similar to the old hard cap of 20.
 */
export const MOMENTUM_POLL_PER_CYCLE = Math.max(
  1,
  Number(process.env.MOMENTUM_POLL_PER_CYCLE || 20) || 20,
)

/** Set MOMENTUM_ENGINE_ENABLED=0 to disable the auto loop. */
export const MOMENTUM_ENGINE_ENABLED = process.env.MOMENTUM_ENGINE_ENABLED !== '0'

/**
 * On MOMENTUM_STARTED: auto-run Perplexity for the reason, then Expo push.
 * Set MOMENTUM_AUTO_START_RESEARCH=0 to disable (silent start again).
 */
export const MOMENTUM_AUTO_START_RESEARCH =
  process.env.MOMENTUM_AUTO_START_RESEARCH !== '0'

/**
 * Skip real Perplexity API; use dummy likely-driver for testing.
 * Priority:
 *  1. Dashboard Test Mode ON → always dummy (no Perplexity spend)
 *  2. MOMENTUM_DUMMY_RESEARCH=1 → force dummy
 *  3. MOMENTUM_DUMMY_RESEARCH=0 → force real API
 *  4. default → real Perplexity (do NOT auto-dummy from PUSH_ALLOWLIST)
 */
export function isMomentumDummyResearchMode() {
  if (isTestModeEnabled()) return true
  const flag = String(process.env.MOMENTUM_DUMMY_RESEARCH || '').trim()
  if (flag === '1' || flag.toLowerCase() === 'true') return true
  if (flag === '0' || flag.toLowerCase() === 'false') return false
  return false
}

function envThr(name, fallback) {
  if (process.env[name] === undefined || process.env[name] === '') return fallback
  const n = Number(process.env[name])
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * Rolling windows to compute (wall-clock lookback on 1m candles).
 * - `threshold: null` → diagnostic only (shown in UI, cannot start an episode)
 * - `threshold: number` → |move %| must be ≥ this to count as a hit
 * - `bridge: true` → weekend-gap windows (30/40/50h). UI shows them Mon pre-open only.
 * - `extended: true` → 10h–24h always shown after the classic ≤8h set
 *
 * Plus separate **day** (see MOMENTUM_THRESHOLDS.day) = vs Yahoo previous close.
 *
 * Why 30/40/50 on Monday?
 * Fri 4pm ET → Mon 9:30am is ~65.5 calendar hours of gap for equities.
 * Short windows only see Mon open; bridge windows reach back into Friday’s last prints.
 */
export const MOMENTUM_WINDOWS = [
  { key: '1m', minutes: 1, threshold: null },
  { key: '5m', minutes: 5, threshold: Number(process.env.MOMENTUM_THR_5M || 3) },
  { key: '10m', minutes: 10, threshold: Number(process.env.MOMENTUM_THR_10M || 3) },
  { key: '15m', minutes: 15, threshold: Number(process.env.MOMENTUM_THR_15M || 3) },
  { key: '30m', minutes: 30, threshold: Number(process.env.MOMENTUM_THR_30M || 4) },
  { key: '45m', minutes: 45, threshold: Number(process.env.MOMENTUM_THR_45M || 4) },
  { key: '60m', minutes: 60, threshold: Number(process.env.MOMENTUM_THR_60M || 5) },
  { key: '90m', minutes: 90, threshold: Number(process.env.MOMENTUM_THR_90M || 5) },
  { key: '2h', minutes: 120, threshold: Number(process.env.MOMENTUM_THR_2H || 6) },
  { key: '3h', minutes: 180, threshold: Number(process.env.MOMENTUM_THR_3H || 6) },
  { key: '5h', minutes: 300, threshold: Number(process.env.MOMENTUM_THR_5H || 7) },
  { key: '6h', minutes: 360, threshold: Number(process.env.MOMENTUM_THR_6H || 7) },
  { key: '8h', minutes: 480, threshold: Number(process.env.MOMENTUM_THR_8H || 8) },
  // Extended always-on (after 8h)
  {
    key: '10h',
    minutes: 600,
    threshold: envThr('MOMENTUM_THR_10H', null),
    extended: true,
  },
  {
    key: '12h',
    minutes: 720,
    threshold: envThr('MOMENTUM_THR_12H', null),
    extended: true,
  },
  {
    key: '15h',
    minutes: 900,
    threshold: envThr('MOMENTUM_THR_15H', null),
    extended: true,
  },
  {
    key: '16h',
    minutes: 960,
    threshold: envThr('MOMENTUM_THR_16H', null),
    extended: true,
  },
  {
    key: '18h',
    minutes: 1080,
    threshold: envThr('MOMENTUM_THR_18H', null),
    extended: true,
  },
  {
    key: '20h',
    minutes: 1200,
    threshold: envThr('MOMENTUM_THR_20H', null),
    extended: true,
  },
  {
    key: '24h',
    minutes: 1440,
    threshold: envThr('MOMENTUM_THR_24H', null),
    extended: true,
  },
  // Multi-day (1d candles) — diagnostic by default
  {
    key: '1w',
    minutes: 7 * 24 * 60,
    threshold: envThr('MOMENTUM_THR_1W', null),
    multiDay: true,
  },
  {
    key: '10d',
    minutes: 10 * 24 * 60,
    threshold: envThr('MOMENTUM_THR_10D', null),
    multiDay: true,
  },
  {
    key: '15d',
    minutes: 15 * 24 * 60,
    threshold: envThr('MOMENTUM_THR_15D', null),
    multiDay: true,
  },
  {
    key: '1M',
    minutes: 30 * 24 * 60,
    threshold: envThr('MOMENTUM_THR_1M', null),
    multiDay: true,
  },
  {
    key: '3M',
    minutes: 90 * 24 * 60,
    threshold: envThr('MOMENTUM_THR_3M', null),
    multiDay: true,
  },
  {
    key: '6M',
    minutes: 180 * 24 * 60,
    threshold: envThr('MOMENTUM_THR_6M', null),
    multiDay: true,
  },
  {
    key: 'YTD',
    // minutes filled at compute time from Jan 1 → now
    minutes: 365 * 24 * 60,
    threshold: envThr('MOMENTUM_THR_YTD', null),
    multiDay: true,
    ytd: true,
  },
  {
    key: '1y',
    minutes: 365 * 24 * 60,
    threshold: envThr('MOMENTUM_THR_1Y', null),
    multiDay: true,
  },
  // Monday / weekend bridge (UI-gated) — diagnostic by default
  {
    key: '30h',
    minutes: 1800,
    threshold: envThr('MOMENTUM_THR_30H', null),
    bridge: true,
  },
  {
    key: '40h',
    minutes: 2400,
    threshold: envThr('MOMENTUM_THR_40H', null),
    bridge: true,
  },
  {
    key: '50h',
    minutes: 3000,
    threshold: envThr('MOMENTUM_THR_50H', null),
    bridge: true,
  },
]

/** @deprecated use MOMENTUM_WINDOWS — kept for any older imports */
export const MOMENTUM_RETURN_WINDOWS = MOMENTUM_WINDOWS.map((w) => w.minutes)

/**
 * Absolute % thresholds (both UP and DOWN).
 * windows: keyed by minutes (legacy shape for tests/env display)
 * day: change from previous regular close (not a rolling window)
 *
 * Per asset-class maps live in thresholdsByClass; MOMENTUM_WINDOWS /
 * MOMENTUM_THRESHOLDS mirror the *equity* map for older callers.
 */
export const MOMENTUM_THRESHOLDS = {
  windows: Object.fromEntries(
    MOMENTUM_WINDOWS.filter((w) => w.threshold != null).map((w) => [w.minutes, w.threshold]),
  ),
  day: Number(process.env.MOMENTUM_THR_DAY || 5),
}

/** Asset classes with independent threshold bands */
export const THRESHOLD_ASSET_CLASSES = [
  'equity',
  'commodity',
  'forex',
  'crypto',
  'index',
]

/**
 * @param {string|null|undefined} assetClass
 * @returns {string}
 */
export function normalizeThresholdAssetClass(assetClass) {
  const c = String(assetClass || 'equity').toLowerCase().trim()
  if (c === 'indexes' || c === 'indices') return 'index'
  if (c === 'stock' || c === 'stocks' || c === 'equity') return 'equity'
  if (THRESHOLD_ASSET_CLASSES.includes(c)) return c
  return 'equity'
}

/** Factory: defaults from MOMENTUM_WINDOWS + day env. */
function buildDefaultThresholdMap() {
  /** @type {Record<string, number|null>} */
  const out = { day: Number(process.env.MOMENTUM_THR_DAY || 5) }
  for (const w of MOMENTUM_WINDOWS) {
    out[w.key] = w.threshold != null && Number(w.threshold) > 0 ? w.threshold : null
  }
  return out
}

/** @type {Record<string, Record<string, number|null>>} */
const thresholdsByClass = Object.fromEntries(
  THRESHOLD_ASSET_CLASSES.map((c) => [c, buildDefaultThresholdMap()]),
)

function cloneMap(map) {
  return { ...(map || {}) }
}

/**
 * Resolve threshold for a window key under an asset class.
 * @param {string} key
 * @param {string|null|undefined} [assetClass]
 */
export function getThresholdForKey(key, assetClass = 'equity') {
  const cls = normalizeThresholdAssetClass(assetClass)
  const map = thresholdsByClass[cls] || thresholdsByClass.equity
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key]
  return null
}

/** Sync equity map onto MOMENTUM_WINDOWS + MOMENTUM_THRESHOLDS (legacy). */
function syncLegacyEquityMirror() {
  const equity = thresholdsByClass.equity
  for (const w of MOMENTUM_WINDOWS) {
    w.threshold = equity[w.key] != null ? equity[w.key] : null
  }
  MOMENTUM_THRESHOLDS.day =
    equity.day != null && Number(equity.day) > 0 ? Number(equity.day) : 0
  MOMENTUM_THRESHOLDS.windows = Object.fromEntries(
    MOMENTUM_WINDOWS.filter((w) => w.threshold != null).map((w) => [w.minutes, w.threshold]),
  )
}

/**
 * Apply UI / API threshold edits for one asset class.
 * @param {Record<string, number|null|undefined>} overrides
 * @param {string|null|undefined} [assetClass]
 */
export function applyThresholdOverrides(overrides, assetClass = 'equity') {
  if (!overrides || typeof overrides !== 'object') {
    return getThresholdSnapshot(assetClass)
  }
  // Full byClass blob?
  if (overrides.byClass && typeof overrides.byClass === 'object') {
    for (const cls of THRESHOLD_ASSET_CLASSES) {
      const src = overrides.byClass[cls]
      if (src && typeof src === 'object') applyMapToClass(cls, src)
    }
    syncLegacyEquityMirror()
    return getThresholdSnapshot(assetClass)
  }
  const cls = normalizeThresholdAssetClass(assetClass)
  applyMapToClass(cls, overrides)
  syncLegacyEquityMirror()
  return getThresholdSnapshot(cls)
}

/**
 * @param {string} cls
 * @param {Record<string, number|null|undefined>} overrides
 */
function applyMapToClass(cls, overrides) {
  const map = thresholdsByClass[cls] || (thresholdsByClass[cls] = buildDefaultThresholdMap())
  for (const w of MOMENTUM_WINDOWS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, w.key)) continue
    const raw = overrides[w.key]
    if (raw === null || raw === '' || raw === undefined) {
      map[w.key] = null
    } else {
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) map[w.key] = n
      else if (Number.isFinite(n) && n <= 0) map[w.key] = null
    }
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'day')) {
    const raw = overrides.day
    if (raw !== null && raw !== '' && raw !== undefined) {
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) map.day = n
      else if (Number.isFinite(n) && n <= 0) map.day = 0
    }
  }
}

function thresholdMapForDisk() {
  /** @type {Record<string, Record<string, number|null>>} */
  const byClass = {}
  for (const cls of THRESHOLD_ASSET_CLASSES) {
    byClass[cls] = cloneMap(thresholdsByClass[cls])
  }
  return {
    byClass,
    // flat equity copy for older readers
    ...cloneMap(thresholdsByClass.equity),
  }
}

/** Write thresholds (all classes) to disk + Supabase. */
export function persistThresholdOverrides(overrides, assetClass = 'equity') {
  const snapshot = applyThresholdOverrides(overrides, assetClass)
  const map = thresholdMapForDisk()
  try {
    fs.mkdirSync(path.dirname(THRESHOLD_STORE_PATH), { recursive: true })
    fs.writeFileSync(
      THRESHOLD_STORE_PATH,
      `${JSON.stringify(
        { updatedAt: new Date().toISOString(), thresholds: map },
        null,
        2,
      )}\n`,
    )
  } catch (err) {
    console.warn(
      '[momentum] could not persist thresholds to disk:',
      err instanceof Error ? err.message : err,
    )
  }
  void import('./persist.js')
    .then((p) => p.saveThresholdsToSupabase(map))
    .catch((err) => {
      console.warn(
        '[momentum] supabase threshold save skipped:',
        err instanceof Error ? err.message : err,
      )
    })
  return snapshot
}

function loadThresholdBlob(map) {
  if (!map || typeof map !== 'object') return getThresholdSnapshot()
  if (map.byClass && typeof map.byClass === 'object') {
    return applyThresholdOverrides({ byClass: map.byClass }, 'equity')
  }
  // Flat legacy map → seed every class (then each class can diverge via UI)
  for (const cls of THRESHOLD_ASSET_CLASSES) {
    applyMapToClass(cls, map)
  }
  syncLegacyEquityMirror()
  return getThresholdSnapshot('equity')
}

/** Restore last saved thresholds from disk (no-op if file missing). */
export function loadPersistedThresholds() {
  try {
    if (!fs.existsSync(THRESHOLD_STORE_PATH)) return getThresholdSnapshot()
    const raw = JSON.parse(fs.readFileSync(THRESHOLD_STORE_PATH, 'utf8'))
    const map =
      raw && typeof raw === 'object' && raw.thresholds && typeof raw.thresholds === 'object'
        ? raw.thresholds
        : raw
    return loadThresholdBlob(map)
  } catch (err) {
    console.warn(
      '[momentum] could not load persisted thresholds:',
      err instanceof Error ? err.message : err,
    )
    return getThresholdSnapshot()
  }
}

/**
 * Prefer Supabase over local disk (call once at engine boot).
 */
export async function hydrateThresholdsFromSupabase() {
  try {
    const { loadThresholdsFromSupabase } = await import('./persist.js')
    const map = await loadThresholdsFromSupabase()
    if (map && typeof map === 'object' && Object.keys(map).length) {
      const snapshot = loadThresholdBlob(map)
      try {
        fs.mkdirSync(path.dirname(THRESHOLD_STORE_PATH), { recursive: true })
        fs.writeFileSync(
          THRESHOLD_STORE_PATH,
          `${JSON.stringify(
            {
              updatedAt: new Date().toISOString(),
              thresholds: thresholdMapForDisk(),
              source: 'supabase',
            },
            null,
            2,
          )}\n`,
        )
      } catch {
        /* ignore */
      }
      console.log('[momentum] thresholds hydrated from Supabase (per asset class)')
      return snapshot
    }
  } catch (err) {
    console.warn(
      '[momentum] supabase threshold hydrate failed:',
      err instanceof Error ? err.message : err,
    )
  }
  return loadPersistedThresholds()
}

loadPersistedThresholds()

/**
 * @param {string|null|undefined} [assetClass]
 */
export function getThresholdSnapshot(assetClass = 'equity') {
  const cls = normalizeThresholdAssetClass(assetClass)
  const map = thresholdsByClass[cls] || thresholdsByClass.equity
  return {
    assetClass: cls,
    windows: Object.fromEntries(MOMENTUM_WINDOWS.map((w) => [w.key, map[w.key] ?? null])),
    day: map.day ?? null,
    list: MOMENTUM_WINDOWS.map((w) => ({
      key: w.key,
      minutes: w.minutes,
      threshold: map[w.key] ?? null,
    })),
    byClass: Object.fromEntries(
      THRESHOLD_ASSET_CLASSES.map((c) => [c, cloneMap(thresholdsByClass[c])]),
    ),
  }
}

/**
 * V1 episode / notification policy (Trigger Episode Alert Logic).
 * Per asset class (equity / commodity / forex / crypto / index) — same pattern
 * as rolling-return thresholds. Mutable via Settings UI → disk + Supabase.
 *
 * Legacy `export let` globals mirror the *equity* map so older importers and
 * tests keep working; engine code should use getEpisodePolicyForClass(cls).
 *
 * @see Trigger_Episode_Alert_Notification_Logic_v1.docx
 */

const EPISODE_POLICY_STORE_PATH = path.resolve(
  process.cwd(),
  'data/momentum-episode-policy.json',
)

function finiteNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp01(n) {
  if (n == null) return null
  return Math.min(1, Math.max(0, n))
}

/**
 * Env / bootstrap defaults (seed every class until UI diverges).
 * Equity / crypto / forex / commodity default inactivity = 6h (360 eligible min);
 * index stays at 3h (180) unless overridden.
 * @param {string} [assetClass]
 */
function buildDefaultEpisodePolicy(assetClass = 'equity') {
  const cls = normalizeThresholdAssetClass(assetClass)
  const accelDefault =
    cls === 'commodity' || cls === 'forex' || cls === 'crypto' ? 1 : 2
  const inactDefault = cls === 'index' ? 180 : 360
  const accel = Number(
    process.env.MOMENTUM_ACCEL_POINTS ||
      process.env.MOMENTUM_ACCEL_DELTA_PP ||
      accelDefault,
  )
  const material = Number(process.env.MOMENTUM_MATERIAL_PROGRESS_PP || 0.5)
  const inact = Number(
    process.env.MOMENTUM_INACTIVITY_MIN != null &&
      process.env.MOMENTUM_INACTIVITY_MIN !== ''
      ? process.env.MOMENTUM_INACTIVITY_MIN
      : inactDefault,
  )
  const rearm = Math.max(
    0,
    Number(process.env.MOMENTUM_REARM_BUFFER_PP ?? 1) || 1,
  )
  const dwell = Math.max(
    0,
    Number(
      process.env.MOMENTUM_STARTED_DWELL_MS != null &&
        process.env.MOMENTUM_STARTED_DWELL_MS !== ''
        ? process.env.MOMENTUM_STARTED_DWELL_MS
        : MOMENTUM_POLL_MS,
    ) || MOMENTUM_POLL_MS,
  )
  const toWeak = Number(process.env.MOMENTUM_GIVEBACK_WEAK || 0.25)
  const toHold = Number(process.env.MOMENTUM_GIVEBACK_HOLD || 0.2)
  const toStrong = Number(process.env.MOMENTUM_GIVEBACK_STRONG || 0.6)
  const majorFade =
    process.env.MOMENTUM_MAJOR_FADE_ALERT !== '0' &&
    process.env.MOMENTUM_MAJOR_FADE_ALERT !== 'false'
  const startAge = Math.max(
    30_000,
    Number(
      process.env.MOMENTUM_START_PUSH_MAX_AGE_MS != null &&
        process.env.MOMENTUM_START_PUSH_MAX_AGE_MS !== ''
        ? process.env.MOMENTUM_START_PUSH_MAX_AGE_MS
        : 5 * 60_000,
    ) || 5 * 60_000,
  )
  return {
    accelerationAlertDeltaPp: accel,
    materialProgressDeltaPp: material,
    holdingToWeakeningGiveback: toWeak,
    weakeningToHoldingGiveback: toHold,
    strongWeakeningGiveback: toStrong,
    episodeInactivityExpiryMin: inact,
    majorFadeAlertEnabled: majorFade,
    rearmBufferPp: rearm,
    startPushMaxAgeMs: startAge,
    startedStateMinDwellMs: dwell,
  }
}

/** @type {Record<string, ReturnType<typeof buildDefaultEpisodePolicy>>} */
const policyByClass = Object.fromEntries(
  THRESHOLD_ASSET_CLASSES.map((c) => [c, buildDefaultEpisodePolicy(c)]),
)

/**
 * Legacy globals — always mirror equity. Prefer getEpisodePolicyForClass.
 * @deprecated use getEpisodePolicyForClass(assetClass)
 */
export let ACCELERATION_ALERT_DELTA_PP =
  policyByClass.equity.accelerationAlertDeltaPp
/** @deprecated use getEpisodePolicyForClass */
export let MOMENTUM_ACCELERATION_POINTS = ACCELERATION_ALERT_DELTA_PP
/** @deprecated use getEpisodePolicyForClass */
export let MATERIAL_PROGRESS_DELTA_PP =
  policyByClass.equity.materialProgressDeltaPp
/** @deprecated use getEpisodePolicyForClass */
export let EPISODE_INACTIVITY_EXPIRY_MIN =
  policyByClass.equity.episodeInactivityExpiryMin
/** @deprecated use getEpisodePolicyForClass */
export let EPISODE_REARM_BUFFER_PP = policyByClass.equity.rearmBufferPp
/** @deprecated use getEpisodePolicyForClass */
export let STARTED_STATE_MIN_DWELL_MS =
  policyByClass.equity.startedStateMinDwellMs
/** @deprecated use EPISODE_INACTIVITY_EXPIRY_MIN / getEpisodePolicyForClass */
export let MOMENTUM_INACTIVITY_MINUTES = EPISODE_INACTIVITY_EXPIRY_MIN
/** @deprecated use getEpisodePolicyForClass */
export let HOLDING_TO_WEAKENING_GIVEBACK =
  policyByClass.equity.holdingToWeakeningGiveback
/** @deprecated use getEpisodePolicyForClass */
export let WEAKENING_TO_HOLDING_GIVEBACK =
  policyByClass.equity.weakeningToHoldingGiveback
/** @deprecated use getEpisodePolicyForClass */
export let STRONG_WEAKENING_GIVEBACK =
  policyByClass.equity.strongWeakeningGiveback
/** @deprecated use getEpisodePolicyForClass */
export let MAJOR_FADE_ALERT_ENABLED =
  policyByClass.equity.majorFadeAlertEnabled
/** @deprecated use getEpisodePolicyForClass */
export let START_PUSH_MAX_AGE_MS = policyByClass.equity.startPushMaxAgeMs

function clonePolicy(p) {
  return { ...(p || buildDefaultEpisodePolicy()) }
}

/** Keep export-let globals in sync with equity (tests / legacy callers). */
function syncLegacyEpisodeGlobals() {
  const p = policyByClass.equity || buildDefaultEpisodePolicy()
  ACCELERATION_ALERT_DELTA_PP = p.accelerationAlertDeltaPp
  MOMENTUM_ACCELERATION_POINTS = p.accelerationAlertDeltaPp
  MATERIAL_PROGRESS_DELTA_PP = p.materialProgressDeltaPp
  EPISODE_INACTIVITY_EXPIRY_MIN = p.episodeInactivityExpiryMin
  MOMENTUM_INACTIVITY_MINUTES = p.episodeInactivityExpiryMin
  EPISODE_REARM_BUFFER_PP = p.rearmBufferPp
  STARTED_STATE_MIN_DWELL_MS = p.startedStateMinDwellMs
  HOLDING_TO_WEAKENING_GIVEBACK = p.holdingToWeakeningGiveback
  WEAKENING_TO_HOLDING_GIVEBACK = p.weakeningToHoldingGiveback
  STRONG_WEAKENING_GIVEBACK = p.strongWeakeningGiveback
  MAJOR_FADE_ALERT_ENABLED = p.majorFadeAlertEnabled
  START_PUSH_MAX_AGE_MS = p.startPushMaxAgeMs
}

/**
 * Resolve episode rules for an asset class (engine path).
 * @param {string|null|undefined} [assetClass]
 */
export function getEpisodePolicyForClass(assetClass = 'equity') {
  const cls = normalizeThresholdAssetClass(assetClass)
  const p = policyByClass[cls] || policyByClass.equity
  return {
    assetClass: cls,
    pricePollIntervalSec: Math.round(MOMENTUM_POLL_MS / 1000),
    ...clonePolicy(p),
  }
}

/**
 * Snapshot for API / UI. Includes byClass so settings can switch tabs.
 * @param {string|null|undefined} [assetClass]
 */
export function getEpisodePolicySnapshot(assetClass = 'equity') {
  const cls = normalizeThresholdAssetClass(assetClass)
  const forClass = getEpisodePolicyForClass(cls)
  return {
    ...forClass,
    assetClass: cls,
    byClass: Object.fromEntries(
      THRESHOLD_ASSET_CLASSES.map((c) => [c, clonePolicy(policyByClass[c])]),
    ),
  }
}

/** Old V1 default was 60 wall-clock minutes. Production is 3 eligible hours. */
function migrateLegacyInactivity(map) {
  if (!map || typeof map !== 'object') return map
  const v = finiteNum(
    map.episodeInactivityExpiryMin ?? map.inactivityMinutes ?? map.inactivityMin,
  )
  if (v !== 60) return map
  return {
    ...map,
    episodeInactivityExpiryMin: 180,
    inactivityMinutes: 180,
  }
}

/**
 * Apply flat field overrides onto one class map (mutates map).
 * @param {Record<string, unknown>} map
 * @param {Record<string, unknown>} o
 */
function applyFieldsToPolicyMap(map, o) {
  if (!map || !o || typeof o !== 'object') return map

  const accel = finiteNum(
    o.accelerationAlertDeltaPp ?? o.accelerationPoints ?? o.accelPp,
  )
  if (accel != null && accel > 0) map.accelerationAlertDeltaPp = accel

  const mat = finiteNum(o.materialProgressDeltaPp ?? o.materialProgressPp)
  if (mat != null && mat >= 0) map.materialProgressDeltaPp = mat

  const inact = finiteNum(
    o.episodeInactivityExpiryMin ?? o.inactivityMinutes ?? o.inactivityMin,
  )
  if (inact != null && inact > 0) map.episodeInactivityExpiryMin = inact

  const rearm = finiteNum(o.rearmBufferPp ?? o.rearmBuffer)
  if (rearm != null && rearm >= 0) map.rearmBufferPp = rearm

  const parseGiveback = (v) => {
    const n = finiteNum(v)
    if (n == null) return null
    if (n > 1) return clamp01(n / 100)
    return clamp01(n)
  }
  const toWeak = parseGiveback(
    o.holdingToWeakeningGiveback ?? o.givebackWeak ?? o.weakeningGiveback,
  )
  if (toWeak != null) map.holdingToWeakeningGiveback = toWeak

  const toHold = parseGiveback(
    o.weakeningToHoldingGiveback ?? o.givebackHold ?? o.holdingGiveback,
  )
  if (toHold != null) map.weakeningToHoldingGiveback = toHold

  const toStrong = parseGiveback(
    o.strongWeakeningGiveback ?? o.givebackStrong ?? o.strongGiveback,
  )
  if (toStrong != null) map.strongWeakeningGiveback = toStrong

  if (
    o.majorFadeAlertEnabled !== undefined &&
    o.majorFadeAlertEnabled !== null &&
    o.majorFadeAlertEnabled !== ''
  ) {
    const v = o.majorFadeAlertEnabled
    map.majorFadeAlertEnabled = !(
      v === false ||
      v === 0 ||
      v === '0' ||
      String(v).toLowerCase() === 'false' ||
      String(v).toLowerCase() === 'off'
    )
  }

  const startAge = finiteNum(o.startPushMaxAgeMs ?? o.startPushMaxAgeMin)
  if (startAge != null) {
    const ms =
      o.startPushMaxAgeMin != null && o.startPushMaxAgeMs == null
        ? startAge * 60_000
        : startAge < 1000
          ? startAge * 60_000
          : startAge
    map.startPushMaxAgeMs = Math.max(30_000, ms)
  }

  const dwell = finiteNum(o.startedStateMinDwellMs ?? o.startedDwellMs)
  if (dwell != null && dwell >= 0) map.startedStateMinDwellMs = dwell

  // Hysteresis: hold band ≤ weak band; strong ≥ weak
  if (map.weakeningToHoldingGiveback > map.holdingToWeakeningGiveback) {
    map.weakeningToHoldingGiveback = map.holdingToWeakeningGiveback
  }
  if (map.strongWeakeningGiveback < map.holdingToWeakeningGiveback) {
    map.strongWeakeningGiveback = map.holdingToWeakeningGiveback
  }
  return map
}

/**
 * Apply UI / API episode-policy overrides (in-memory).
 * Giveback fields accept either ratio (0–1) or percent (0–100).
 * Pass assetClass so stocks / commodities / crypto keep independent rules.
 *
 * @param {Record<string, unknown>} overrides
 * @param {string|null|undefined} [assetClass]
 */
export function applyEpisodePolicyOverrides(overrides, assetClass = 'equity') {
  if (!overrides || typeof overrides !== 'object') {
    return getEpisodePolicySnapshot(assetClass)
  }
  // Full byClass blob (hydrate / disk restore)
  if (overrides.byClass && typeof overrides.byClass === 'object') {
    for (const cls of THRESHOLD_ASSET_CLASSES) {
      const src = overrides.byClass[cls]
      if (src && typeof src === 'object') {
        const map =
          policyByClass[cls] ||
          (policyByClass[cls] = buildDefaultEpisodePolicy())
        applyFieldsToPolicyMap(map, migrateLegacyInactivity(src))
      }
    }
    syncLegacyEpisodeGlobals()
    return getEpisodePolicySnapshot(assetClass)
  }
  const cls = normalizeThresholdAssetClass(assetClass)
  const map =
    policyByClass[cls] || (policyByClass[cls] = buildDefaultEpisodePolicy())
  applyFieldsToPolicyMap(map, migrateLegacyInactivity(overrides))
  syncLegacyEpisodeGlobals()
  return getEpisodePolicySnapshot(cls)
}

function episodePolicyMapForDisk() {
  return {
    byClass: Object.fromEntries(
      THRESHOLD_ASSET_CLASSES.map((c) => [c, clonePolicy(policyByClass[c])]),
    ),
    // flat equity copy for older readers
    ...clonePolicy(policyByClass.equity),
  }
}

/**
 * Persist episode policy to disk + Supabase.
 * @param {Record<string, unknown>} overrides
 * @param {string|null|undefined} [assetClass]
 */
export function persistEpisodePolicy(overrides, assetClass = 'equity') {
  const snapshot = applyEpisodePolicyOverrides(overrides || {}, assetClass)
  const diskMap = episodePolicyMapForDisk()
  try {
    fs.mkdirSync(path.dirname(EPISODE_POLICY_STORE_PATH), { recursive: true })
    fs.writeFileSync(
      EPISODE_POLICY_STORE_PATH,
      `${JSON.stringify(
        { updatedAt: new Date().toISOString(), policy: diskMap },
        null,
        2,
      )}\n`,
    )
  } catch (err) {
    console.warn(
      '[momentum] could not persist episode policy to disk:',
      err instanceof Error ? err.message : err,
    )
  }
  void import('./persist.js')
    .then((p) => p.saveEpisodePolicyToSupabase(diskMap))
    .catch((err) => {
      console.warn(
        '[momentum] supabase episode-policy save skipped:',
        err instanceof Error ? err.message : err,
      )
    })
  return snapshot
}

function loadEpisodePolicyBlob(map) {
  if (!map || typeof map !== 'object') return getEpisodePolicySnapshot()
  if (map.byClass && typeof map.byClass === 'object') {
    return applyEpisodePolicyOverrides({ byClass: map.byClass }, 'equity')
  }
  // Flat legacy map → seed every class (then each can diverge via UI)
  const migrated = migrateLegacyInactivity(map)
  for (const cls of THRESHOLD_ASSET_CLASSES) {
    applyFieldsToPolicyMap(
      policyByClass[cls] || (policyByClass[cls] = buildDefaultEpisodePolicy()),
      migrated,
    )
  }
  syncLegacyEpisodeGlobals()
  return getEpisodePolicySnapshot('equity')
}

/** Restore episode policy from local disk (no-op if missing). */
export function loadPersistedEpisodePolicy() {
  try {
    if (!fs.existsSync(EPISODE_POLICY_STORE_PATH)) {
      return getEpisodePolicySnapshot()
    }
    const raw = JSON.parse(fs.readFileSync(EPISODE_POLICY_STORE_PATH, 'utf8'))
    const map =
      raw && typeof raw === 'object' && raw.policy && typeof raw.policy === 'object'
        ? raw.policy
        : raw
    return loadEpisodePolicyBlob(map)
  } catch (err) {
    console.warn(
      '[momentum] could not load persisted episode policy:',
      err instanceof Error ? err.message : err,
    )
    return getEpisodePolicySnapshot()
  }
}

/** Prefer Supabase over local disk (call once at engine boot). */
export async function hydrateEpisodePolicyFromSupabase() {
  try {
    const { loadEpisodePolicyFromSupabase } = await import('./persist.js')
    const map = await loadEpisodePolicyFromSupabase()
    if (map && typeof map === 'object' && Object.keys(map).length) {
      const snapshot = loadEpisodePolicyBlob(map)
      try {
        fs.mkdirSync(path.dirname(EPISODE_POLICY_STORE_PATH), { recursive: true })
        fs.writeFileSync(
          EPISODE_POLICY_STORE_PATH,
          `${JSON.stringify(
            {
              updatedAt: new Date().toISOString(),
              policy: episodePolicyMapForDisk(),
              source: 'supabase',
            },
            null,
            2,
          )}\n`,
        )
      } catch {
        /* ignore */
      }
      console.log(
        '[momentum] episode policy hydrated from Supabase (per asset class)',
      )
      return snapshot
    }
  } catch (err) {
    console.warn(
      '[momentum] supabase episode-policy hydrate failed:',
      err instanceof Error ? err.message : err,
    )
  }
  return loadPersistedEpisodePolicy()
}

// Disk restore at import (Supabase hydrate runs on engine start)
loadPersistedEpisodePolicy()

/** Ring buffer size for emitted events (includes hydrated history) */
export const MOMENTUM_MAX_EVENTS = 400

/** Human label for a window key or minutes value */
export function windowKey(minutes) {
  const hit = MOMENTUM_WINDOWS.find((w) => w.minutes === minutes)
  if (hit) return hit.key
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

/** Parse key → minutes (null for day) */
export function minutesFromWindowKey(key) {
  if (!key || key === 'day') return null
  const h = String(key).match(/^(\d+(?:\.\d+)?)h$/)
  if (h) return Math.round(Number(h[1]) * 60)
  const m = String(key).match(/^(\d+)m$/)
  if (m) return Number(m[1])
  return null
}

export function allReturnKeys() {
  return [...MOMENTUM_WINDOWS.map((w) => w.key), 'day']
}

/**
 * ET weekday short name: Mon, Tue, …
 * @param {number} [asOfMs]
 */
export function etWeekday(asOfMs = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
    }).formatToParts(new Date(asOfMs))
    return parts.find((p) => p.type === 'weekday')?.value || null
  } catch {
    return null
  }
}

/**
 * Show 30h / 40h / 50h weekend-bridge cards?
 * Rule (your request): Monday ET until regular market opens.
 * Also show Sun after ~4pm ET and all day Sat — same “gap to Friday” problem.
 *
 * @param {number} [asOfMs]
 * @param {string|null} [marketSession] PRE|REGULAR|POST|CLOSED
 */
export function shouldShowBridgeWindows(asOfMs = Date.now(), marketSession = null) {
  const wd = etWeekday(asOfMs)
  const session = String(marketSession || '').toUpperCase()

  // Once regular US cash session is open mid-week, hide bridge cards
  if (session === 'REGULAR' && wd !== 'Mon') return false
  if (session === 'REGULAR' && wd === 'Mon') return false

  if (wd === 'Sat') return true
  if (wd === 'Sun') return true
  if (wd === 'Mon') {
    // Monday until open: PRE / CLOSED / POST (unlikely) / unknown
    return session !== 'REGULAR'
  }
  return false
}

/**
 * Keys to render in the Home rolling-returns grid — max 2 rows × 7 = 14 cards.
 * UI: session/day first, then short windows → multi-day (1w/10d/15d/1M).
 * Server still *computes* full MOMENTUM_WINDOWS for detector/logs.
 *
 * @param {number} [asOfMs]
 * @param {string|null} [marketSession]
 * @returns {string[]}
 */
export function getVisibleReturnKeys(asOfMs = Date.now(), marketSession = null) {
  // Session card first (PRE / Regular / Overnight / AH / Prev close), then windows
  return [
    'day',
    '1m',
    '5m',
    '10m',
    '15m',
    '30m',
    '45m',
    '60m',
    '90m',
    '2h',
    '3h',
    '6h',
    '8h',
    '16h',
    '24h',
    '1w',
    '10d',
    '15d',
    '1M',
    '3M',
    '6M',
    'YTD',
    '1y',
  ]
}

export function getWindowMetaList() {
  return MOMENTUM_WINDOWS.map((w) => ({
    key: w.key,
    minutes: w.minutes,
    threshold: w.threshold,
    extended: Boolean(w.extended),
    bridge: Boolean(w.bridge),
    multiDay: Boolean(w.multiDay),
    ytd: Boolean(w.ytd),
  }))
}
