/**
 * Multi-ticker momentum engine configuration.
 * Tune thresholds / poll interval here (or via env).
 */

import { toYahooSymbol } from '../yahooClient.js'

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

/** Cap how many symbols the background loop will poll. */
export const MOMENTUM_MAX_WATCHED = Math.max(
  1,
  Number(process.env.MOMENTUM_MAX_WATCHED || 20) || 20,
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
 * - MOMENTUM_DUMMY_RESEARCH=1 → always dummy
 * - MOMENTUM_DUMMY_RESEARCH=0 → always real API
 * - unset → dummy when PUSH_ALLOWLIST_* is set (single-tester mode)
 */
export function isMomentumDummyResearchMode() {
  const flag = String(process.env.MOMENTUM_DUMMY_RESEARCH || '').trim()
  if (flag === '1' || flag.toLowerCase() === 'true') return true
  if (flag === '0' || flag.toLowerCase() === 'false') return false
  const allow =
    String(process.env.PUSH_ALLOWLIST_DEVICE_IDS || '').trim() ||
    String(process.env.PUSH_ALLOWLIST_TOKENS || '').trim()
  return Boolean(allow)
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
 * Mutable at runtime via applyThresholdOverrides() for the Home UI.
 * Shared across all tickers (global policy for now).
 */
export const MOMENTUM_THRESHOLDS = {
  windows: Object.fromEntries(
    MOMENTUM_WINDOWS.filter((w) => w.threshold != null).map((w) => [w.minutes, w.threshold]),
  ),
  /**
   * Day % = ((currentPrice - previousClose) / previousClose) * 100
   * previousClose = Yahoo's last completed regular session close.
   * This is NOT “last 24 hours of candles” — it's the classic day P/L vs prior close.
   */
  day: Number(process.env.MOMENTUM_THR_DAY || 5),
}

function rebuildThresholdWindowsMap() {
  MOMENTUM_THRESHOLDS.windows = Object.fromEntries(
    MOMENTUM_WINDOWS.filter((w) => w.threshold != null).map((w) => [w.minutes, w.threshold]),
  )
}

/**
 * Apply UI / API threshold edits. Keys: window keys ('5m','2h',…) or 'day'.
 * @param {Record<string, number|null|undefined>} overrides
 */
export function applyThresholdOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object') return getThresholdSnapshot()
  for (const w of MOMENTUM_WINDOWS) {
    if (Object.prototype.hasOwnProperty.call(overrides, w.key)) {
      const raw = overrides[w.key]
      if (raw === null || raw === '' || raw === undefined) {
        w.threshold = null
      } else {
        const n = Number(raw)
        if (Number.isFinite(n) && n >= 0) w.threshold = n
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'day')) {
    const n = Number(overrides.day)
    if (Number.isFinite(n) && n >= 0) MOMENTUM_THRESHOLDS.day = n
  }
  rebuildThresholdWindowsMap()
  return getThresholdSnapshot()
}

export function getThresholdSnapshot() {
  return {
    windows: Object.fromEntries(MOMENTUM_WINDOWS.map((w) => [w.key, w.threshold])),
    day: MOMENTUM_THRESHOLDS.day,
    list: MOMENTUM_WINDOWS.map((w) => ({
      key: w.key,
      minutes: w.minutes,
      threshold: w.threshold,
    })),
  }
}

/**
 * V1 episode / notification constants (Trigger Episode Alert Logic).
 * All tunable; do not hard-code elsewhere.
 * @see Trigger_Episode_Alert_Notification_Logic_v1.docx
 */

/** Min absolute extension (pp) beyond last_notified_episode_move_pct to push again */
export const ACCELERATION_ALERT_DELTA_PP = Number(
  process.env.MOMENTUM_ACCEL_POINTS ||
    process.env.MOMENTUM_ACCEL_DELTA_PP ||
    1.5,
)

/** @deprecated use ACCELERATION_ALERT_DELTA_PP */
export const MOMENTUM_ACCELERATION_POINTS = ACCELERATION_ALERT_DELTA_PP

/**
 * Min new extreme (pp) beyond meaningful_extreme_move_pct to reset expiry clock.
 * Intentionally independent of acceleration push threshold.
 */
export const MATERIAL_PROGRESS_DELTA_PP = Number(
  process.env.MOMENTUM_MATERIAL_PROGRESS_PP || 0.5,
)

/** Expire if no meaningful progress for this many minutes */
export const EPISODE_INACTIVITY_EXPIRY_MIN = Number(
  process.env.MOMENTUM_INACTIVITY_MIN || 60,
)

/**
 * Min time to remain in STARTED before silent reclassify → HOLDING.
 * Default = poll interval so a ~60s loop cannot show STARTED→HOLDING in ~14s
 * just because the UI also fired a focus tick.
 * Material acceleration / reversal / expiry still leave STARTED immediately.
 * Override: MOMENTUM_STARTED_DWELL_MS (milliseconds).
 */
export const STARTED_STATE_MIN_DWELL_MS = Math.max(
  0,
  Number(
    process.env.MOMENTUM_STARTED_DWELL_MS != null &&
      process.env.MOMENTUM_STARTED_DWELL_MS !== ''
      ? process.env.MOMENTUM_STARTED_DWELL_MS
      : MOMENTUM_POLL_MS,
  ) || MOMENTUM_POLL_MS,
)

/** @deprecated use EPISODE_INACTIVITY_EXPIRY_MIN */
export const MOMENTUM_INACTIVITY_MINUTES = EPISODE_INACTIVITY_EXPIRY_MIN

/**
 * Giveback of episode move (peak→current / peak→reference) for state labels.
 * HOLDING if giveback < HOLDING_TO_WEAKENING; enter WEAKENING at ≥ that.
 * Return to HOLDING only after ≤ WEAKENING_TO_HOLDING (hysteresis).
 */
export const HOLDING_TO_WEAKENING_GIVEBACK = Number(
  process.env.MOMENTUM_GIVEBACK_WEAK || 0.25,
)
export const WEAKENING_TO_HOLDING_GIVEBACK = Number(
  process.env.MOMENTUM_GIVEBACK_HOLD || 0.2,
)
export const STRONG_WEAKENING_GIVEBACK = Number(
  process.env.MOMENTUM_GIVEBACK_STRONG || 0.6,
)

/** Future optional major-fade push; off in V1 */
export const MAJOR_FADE_ALERT_ENABLED =
  process.env.MOMENTUM_MAJOR_FADE_ALERT === '1' ||
  process.env.MOMENTUM_MAJOR_FADE_ALERT === 'true'

/**
 * Snapshot of V1 episode constants for API / UI settings.
 */
export function getEpisodePolicySnapshot() {
  return {
    pricePollIntervalSec: Math.round(MOMENTUM_POLL_MS / 1000),
    accelerationAlertDeltaPp: ACCELERATION_ALERT_DELTA_PP,
    materialProgressDeltaPp: MATERIAL_PROGRESS_DELTA_PP,
    holdingToWeakeningGiveback: HOLDING_TO_WEAKENING_GIVEBACK,
    weakeningToHoldingGiveback: WEAKENING_TO_HOLDING_GIVEBACK,
    strongWeakeningGiveback: STRONG_WEAKENING_GIVEBACK,
    episodeInactivityExpiryMin: EPISODE_INACTIVITY_EXPIRY_MIN,
    majorFadeAlertEnabled: MAJOR_FADE_ALERT_ENABLED,
  }
}

/** Ring buffer size for emitted events */
export const MOMENTUM_MAX_EVENTS = 80

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
 * UI: short windows → day-ish → multi-day (1w/10d/15d/1M) → day.
 * Server still *computes* full MOMENTUM_WINDOWS for detector/logs.
 *
 * @param {number} [asOfMs]
 * @param {string|null} [marketSession]
 * @returns {string[]}
 */
export function getVisibleReturnKeys(asOfMs = Date.now(), marketSession = null) {
  // 2 rows — short windows (incl. 10m / 45m) + multi-horizon + day
  const keys = [
    '1m',
    '5m',
    '10m',
    '15m',
    '30m',
    '45m',
    '60m',
    '90m',
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
    'day',
  ]

  // Premarket / after-hours / overnight: put day first (“up 3.5% pre”)
  const session = String(marketSession || '').toUpperCase()
  if (
    (session === 'PRE' ||
      session === 'PREPRE' ||
      session === 'POST' ||
      session === 'POSTPOST' ||
      session === 'CLOSED') &&
    keys.includes('day')
  ) {
    return ['day', ...keys.filter((k) => k !== 'day')]
  }
  return keys
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
