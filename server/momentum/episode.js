/**
 * Trigger episode state machine (V1).
 *
 * One active episode per ticker. Backend states change often; pushes only on
 * START, material ACCELERATION (≥2 pp beyond last notified), and REVERSAL.
 * HOLDING / WEAKENING / tiny re-accel / expiry / market-close are silent.
 *
 * START selection: among all qualifying ≤24h/day windows in the same direction,
 * the **shortest** window wins; freeze that window’s reference / move / exact span.
 * While ACTIVE, a newly qualifying shorter window never opens a second START.
 *
 * Strong fade (≥60% giveback) emits MOMENTUM_STRONG_WEAKENING — not REVERSAL.
 * True REVERSAL = original move erased + opposite threshold hit.
 *
 * @see Trigger_Episode_Alert_Notification_Logic_v1.docx
 */
import {
  EPISODE_REARM_BUFFER_PP,
  HOLDING_TO_WEAKENING_GIVEBACK,
  MOMENTUM_TICKER,
  STRONG_WEAKENING_GIVEBACK,
  WEAKENING_TO_HOLDING_GIVEBACK,
  getEpisodePolicyForClass,
  getThresholdForKey,
} from './config.js'
import {
  anyThresholdActive,
  buildThresholdEdgeSnapshot,
  evaluatePerWindowRearm,
  filterFreshThresholdCrosses,
  findEpisodeThresholdCrosses,
  isEpisodeEligibleWindow,
  oppositeThresholdHit,
  pickShortestStartHit,
} from './detector.js'
import { classifyMomentumAsset } from './candles.js'
import { formatExactLookbackLabel, movePercent } from './returns.js'
import {
  buildNotificationCopy,
  daySessionExactLabel,
  isPushWorthy,
} from './notifyCopy.js'
import * as store from './store.js'
import { resolveMarketProfile } from './marketProfile.js'
import { eligibleTradingMsBetween } from './tradingTime.js'
import {
  isFullClosedLifecycle,
  isInactivityPausedLifecycle,
} from './lifecycle.js'

/**
 * After terminal end, disarm same direction until |move| re-arms.
 * @param {string} symbol
 * @param {Record<string, unknown>} ep
 * @param {string} assetClass
 */
function clearActiveIfSame(symbol, ep) {
  const live = store.getActiveEpisode(symbol)
  if (!live) return
  const liveId = String(live.episodeId || live.episode_id || '')
  const wantId = String(ep?.episodeId || ep?.episode_id || '')
  // Clear when same id, or when no id match but live is terminal/stale
  if (!wantId || !liveId || liveId === wantId) {
    store.setActiveEpisode(symbol, null)
  }
}

/**
 * @param {string} symbol
 * @param {Record<string, unknown>} ep
 * @param {string} assetClass
 * @param {'FULL'|'SESSION'} [policy]
 *   FULL — EXPIRED/ENDED: every same-dir window must cool below its own thr−buffer
 *   SESSION — MARKET_CLOSE: no full cool-off; next session uses threshold crossing only
 */
function disarmAfterTerminal(symbol, ep, assetClass, policy = 'FULL') {
  if (!ep) return
  clearActiveIfSame(symbol, ep)
  const dir = ep.direction === 'DOWN' ? 'DOWN' : 'UP'
  const endReason = String(ep.endReason || '')
  const resolvedPolicy =
    policy ||
    (endReason === 'MARKET_CLOSE' || endReason === 'CLOSED_AT_MARKET_CLOSE'
      ? 'SESSION'
      : 'FULL')
  const epPolicy = getEpisodePolicyForClass(assetClass)
  store.markDirectionDisarmed(symbol, {
    direction: dir,
    policy: resolvedPolicy,
    rearmBufferPp: epPolicy.rearmBufferPp ?? EPISODE_REARM_BUFFER_PP,
    episodeId: ep.episodeId || null,
    endReason: endReason || null,
  })
}

/**
 * Exact elapsed span for a detected window (true bar distance, not just "5m"/"24h").
 * Prefers rolling exactLookbacks; falls back to referenceTime → now.
 * @param {string} windowKey
 * @param {Record<string, { exactMinutes?: number, exactLabel?: string, windowMinutes?: number|null, asOfTime?: string|null }|null>|null|undefined} exactLookbacks
 * @param {string|null|undefined} referenceTime
 * @param {string} nowIso
 */
export function resolveExactSpan(
  windowKey,
  exactLookbacks,
  referenceTime,
  nowIso,
) {
  const key = String(windowKey || '')
  const fromMap =
    exactLookbacks && key && exactLookbacks[key] && typeof exactLookbacks[key] === 'object'
      ? exactLookbacks[key]
      : null
  if (fromMap && Number.isFinite(Number(fromMap.exactMinutes))) {
    const exactMinutes = Math.max(1, Math.round(Number(fromMap.exactMinutes)))
    return {
      exactMinutes,
      exactLabel:
        String(fromMap.exactLabel || '').trim() ||
        formatExactLookbackLabel(exactMinutes),
      windowMinutes:
        fromMap.windowMinutes != null && Number.isFinite(Number(fromMap.windowMinutes))
          ? Number(fromMap.windowMinutes)
          : windowMinutesFromKey(key),
      asOfTime: fromMap.asOfTime || nowIso || null,
    }
  }
  const refMs = Date.parse(String(referenceTime || ''))
  const nowMs = Date.parse(String(nowIso || '')) || Date.now()
  if (Number.isFinite(refMs) && Number.isFinite(nowMs) && nowMs >= refMs) {
    const exactMinutes = Math.max(1, Math.round((nowMs - refMs) / 60_000))
    return {
      exactMinutes,
      exactLabel: formatExactLookbackLabel(exactMinutes),
      windowMinutes: windowMinutesFromKey(key),
      asOfTime: nowIso || new Date(nowMs).toISOString(),
    }
  }
  const wm = windowMinutesFromKey(key)
  return {
    exactMinutes: wm != null && wm > 0 ? wm : null,
    exactLabel: wm != null && wm > 0 ? formatExactLookbackLabel(wm) : null,
    windowMinutes: wm,
    asOfTime: nowIso || null,
  }
}

/**
 * @typedef {'ACTIVE'|'EXPIRED'|'REVERSED'|'CLOSED_AT_MARKET_CLOSE'|'ENDED'} EpisodeStatus
 * @typedef {'STARTED'|'ACCELERATING'|'HOLDING'|'WEAKENING'|'STRONGLY_WEAKENING'|'RE_ACCELERATING'|'REVERSAL'} EpisodeState
 *
 * @typedef {{
 *   episodeId: string,
 *   ticker: string,
 *   direction: 'UP'|'DOWN',
 *   status: EpisodeStatus,
 *   state: EpisodeState,
 *   referencePrice: number,
 *   referenceTime: string|null,
 *   triggerPrice: number,
 *   triggerTime: string,
 *   episodeStartedAt: string,
 *   episodeStartPrice: number,
 *   detectedWindow: string,
 *   initialMovePercent: number,
 *   currentMovePercent: number,
 *   peakMovePercent: number,
 *   peakPrice: number|null,
 *   peakTime: string|null,
 *   troughPrice: number|null,
 *   troughTime: string|null,
 *   lastAlertMovePercent: number,
 *   lastAlertAt: string,
 *   lastNotifiedPrice: number,
 *   lastNotifiedTime: string,
 *   lastNotifiedEpisodeMovePct: number,
 *   currentPrice: number,
 *   currentTime: string,
 *   meaningfulExtremeMovePct: number,
 *   lastMaterialProgressAt: string,
 *   reversalNotified: boolean,
 *   belowThresholdSince: string|null,
 *   endedAt?: string|null,
 *   endReason?: string|null,
 * }} MomentumEpisode
 */

function windowMinutesFromKey(key) {
  if (key === 'day') return null
  const h = String(key).match(/^(\d+(?:\.\d+)?)h$/)
  if (h) return Math.round(Number(h[1]) * 60)
  const m = String(key).match(/^(\d+)m$/)
  return m ? Number(m[1]) : null
}

function newEpisodeId(ticker, nowIso) {
  const t = String(ticker || 'T').toUpperCase()
  const ms = Date.parse(nowIso) || Date.now()
  return `${t}-${ms.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function episodeMovePct(currentPrice, referencePrice) {
  return movePercent(currentPrice, referencePrice)
}

/**
 * Giveback ratio of episode move from peak (UP) or trough (DOWN).
 * @param {MomentumEpisode} ep
 * @param {number} currentPrice
 */
export function computeGivebackRatio(ep, currentPrice) {
  const ref = Number(ep.referencePrice)
  if (!Number.isFinite(ref) || !Number.isFinite(currentPrice)) return 0

  if (ep.direction === 'UP') {
    const peak = Number(ep.peakPrice ?? currentPrice)
    const gain = peak - ref
    if (gain <= 0) return 0
    const giveback = peak - currentPrice
    return Math.max(0, giveback / gain)
  }

  const trough = Number(ep.troughPrice ?? currentPrice)
  const drop = ref - trough
  if (drop <= 0) return 0
  const giveback = currentPrice - trough
  return Math.max(0, giveback / drop)
}

/** Float-safe compare for giveback ratios (0.6 * prices often lands at 0.599999…). */
function givebackAtLeast(givebackRatio, threshold) {
  const g = Number(givebackRatio) || 0
  const t = Number(threshold) || 0
  return g + 1e-9 >= t
}

/**
 * Classify HOLDING / WEAKENING / STRONGLY_WEAKENING with hysteresis.
 * @param {number} givebackRatio
 * @param {EpisodeState|null} prevState
 * @param {{
 *   holdingToWeakeningGiveback?: number,
 *   weakeningToHoldingGiveback?: number,
 *   strongWeakeningGiveback?: number,
 * }|null} [bands] asset-class episode rules (defaults = equity globals)
 */
export function classifyGivebackState(
  givebackRatio,
  prevState = null,
  bands = null,
) {
  const g = Number(givebackRatio) || 0
  const toWeak =
    bands?.holdingToWeakeningGiveback ?? HOLDING_TO_WEAKENING_GIVEBACK
  const toHold =
    bands?.weakeningToHoldingGiveback ?? WEAKENING_TO_HOLDING_GIVEBACK
  const toStrong = bands?.strongWeakeningGiveback ?? STRONG_WEAKENING_GIVEBACK

  if (givebackAtLeast(g, toStrong)) return 'STRONGLY_WEAKENING'
  if (givebackAtLeast(g, toWeak)) return 'WEAKENING'
  // Hysteresis band [toHold, toWeak): keep previous weakening if we were there
  if (givebackAtLeast(g, toHold)) {
    if (
      prevState === 'WEAKENING' ||
      prevState === 'STRONGLY_WEAKENING'
    ) {
      return 'WEAKENING'
    }
    return 'HOLDING'
  }
  return 'HOLDING'
}

/**
 * Original move erased / price at or past reference region.
 * UP: current ≤ reference; DOWN: current ≥ reference.
 * @param {'UP'|'DOWN'} direction
 * @param {number} currentPrice
 * @param {number} referencePrice
 */
export function originalMoveErased(direction, currentPrice, referencePrice) {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(referencePrice)) {
    return false
  }
  if (direction === 'UP') return currentPrice <= referencePrice
  return currentPrice >= referencePrice
}

/**
 * Immediately terminate the live episode at a weekly / holiday FULL_CLOSED.
 * Does not resume later — reopen must START a new episode.
 */
export function closeActiveEpisodeFullMarketClose(ticker, opts = {}) {
  const symbol = String(ticker || MOMENTUM_TICKER).toUpperCase()
  const nowIso = opts.nowIso || new Date().toISOString()
  const ep = opts.episode || store.getActiveEpisode(symbol)
  if (!ep || String(ep.status || '').toUpperCase() !== 'ACTIVE') {
    return { episode: null, events: [], logs: [], closedEpisode: null }
  }
  const next = {
    ...ep,
    status: 'CLOSED_AT_MARKET_CLOSE',
    state: 'ENDED',
    endedAt: nowIso,
    endReason: 'MARKET_FULL_CLOSE',
    currentTime: nowIso,
    inactivityClockRunningAt: null,
  }
  if (opts.currentPrice != null) next.currentPrice = opts.currentPrice
  const ev = makeEvent({
    ticker: symbol,
    direction: next.direction,
    eventType: 'MOMENTUM_ENDED',
    price: next.currentPrice,
    movePercent: next.currentMovePercent,
    detectedWindow: next.detectedWindow,
    nowIso,
    marketSession: opts.marketSession || 'CLOSED',
    reason: 'MARKET_FULL_CLOSE',
    shouldNotify: false,
    episode: next,
    extra: { terminal: true, state: 'ENDED' },
  })
  const logs = [
    `[${symbol} MOMENTUM] episode closed — MARKET_FULL_CLOSE (no carry across weekly close)`,
  ]
  const assetClass = classifyMomentumAsset(symbol)
  disarmAfterTerminal(symbol, next, assetClass, 'SESSION')
  store.upsertHistoryEpisode(symbol, next)
  store.pushEvent(symbol, ev)
  return { episode: null, events: [ev], logs, closedEpisode: next }
}

/**
 * Build a base event object.
 */
function makeEvent({
  ticker,
  direction,
  eventType,
  price,
  movePercent: move,
  detectedWindow,
  nowIso,
  marketSession,
  reason = null,
  shouldNotify = null,
  previousAlertMovePercent = null,
  episode = null,
  extra = {},
}) {
  const reasonFinal = reason
  const push =
    shouldNotify != null
      ? shouldNotify
      : isPushWorthy(eventType, reasonFinal, null)

  const spanFromEp =
    episode &&
    (episode.exactMinutes != null || episode.exactLabel || episode.referenceTime)
      ? {
          exactMinutes:
            episode.exactMinutes != null && Number.isFinite(Number(episode.exactMinutes))
              ? Number(episode.exactMinutes)
              : null,
          exactLabel: episode.exactLabel || null,
          windowMinutes:
            episode.windowMinutes != null
              ? episode.windowMinutes
              : windowMinutesFromKey(detectedWindow),
        }
      : null

  const base = {
    ticker,
    direction,
    eventType,
    price,
    movePercent: move,
    windowMinutes:
      extra.windowMinutes != null
        ? extra.windowMinutes
        : spanFromEp?.windowMinutes ?? windowMinutesFromKey(detectedWindow),
    detectedWindow,
    detectedAt: nowIso,
    marketSession,
    reason: reasonFinal,
    shouldNotify: push,
    previousAlertMovePercent,
    episodeId: episode?.episodeId || extra.episodeId || null,
    episodeNo: episode?.episodeNo ?? extra.episodeNo ?? null,
    // Prefer explicit extra (e.g. fresh accel span); else freeze episode start span
    exactMinutes:
      extra.exactMinutes != null
        ? extra.exactMinutes
        : spanFromEp?.exactMinutes ?? null,
    exactLabel:
      extra.exactLabel != null
        ? extra.exactLabel
        : spanFromEp?.exactLabel ?? null,
    referencePrice:
      extra.referencePrice !== undefined
        ? extra.referencePrice
        : episode?.referencePrice ?? null,
    referenceTime:
      extra.referenceTime !== undefined
        ? extra.referenceTime
        : episode?.referenceTime ?? null,
    ...extra,
  }

  // Ensure exact* not wiped if extra omitted them after spread order issues
  if (base.exactMinutes == null && spanFromEp?.exactMinutes != null) {
    base.exactMinutes = spanFromEp.exactMinutes
  }
  if (!base.exactLabel && spanFromEp?.exactLabel) {
    base.exactLabel = spanFromEp.exactLabel
  }

  // Stable push/event key: episodeId + eventType + cycle (retries must not double-send)
  if (!base.idempotencyKey && base.episodeId) {
    const cycle =
      extra.cycleNumber != null
        ? Number(extra.cycleNumber)
        : extra.idempotencyCycle != null
          ? Number(extra.idempotencyCycle)
          : 0
    base.idempotencyKey = `${base.episodeId}:${eventType}:${Number.isFinite(cycle) ? cycle : 0}`
    if (base.cycleNumber == null && Number.isFinite(cycle)) {
      base.cycleNumber = cycle
    }
  }

  if (push) {
    const copy = buildNotificationCopy({
      ...base,
      episode,
    })
    if (copy) base.notification = copy
  }

  // Always attach frozen identity + calc snapshot for Supabase / mobile
  if (episode) {
    base.triggerMovePct =
      base.triggerMovePct ??
      episode.triggerMovePct ??
      episode.initialMovePercent ??
      null
    base.triggerPrice = base.triggerPrice ?? episode.triggerPrice ?? null
    base.initialMovePercent =
      base.initialMovePercent ?? episode.initialMovePercent ?? null
    base.peakMovePercent =
      base.peakMovePercent ?? episode.peakMovePercent ?? null
    base.peakPrice = base.peakPrice ?? episode.peakPrice ?? null
    base.troughPrice = base.troughPrice ?? episode.troughPrice ?? null
    base.windowType =
      base.windowType || episode.windowType || episode.detectedWindow || null
    // Always attach giveback % for Supabase columns + mobile payload
    if (base.givebackRatio == null || base.givebackPct == null) {
      let ratio =
        base.givebackRatio != null && Number.isFinite(Number(base.givebackRatio))
          ? Number(base.givebackRatio)
          : null
      if (ratio == null && Number.isFinite(Number(base.price))) {
        const ref = Number(episode.referencePrice)
        const live = Number(base.price)
        if (Number.isFinite(ref) && Number.isFinite(live)) {
          if (String(episode.direction).toUpperCase() === 'DOWN') {
            const trough = Number(episode.troughPrice ?? live)
            const drop = ref - trough
            if (drop > 0) ratio = Math.max(0, (live - trough) / drop)
          } else {
            const peak = Number(episode.peakPrice ?? live)
            const gain = peak - ref
            if (gain > 0) ratio = Math.max(0, (peak - live) / gain)
          }
        }
      }
      if (ratio != null && Number.isFinite(ratio)) {
        base.givebackRatio = ratio
        if (base.givebackPct == null || !Number.isFinite(Number(base.givebackPct))) {
          base.givebackPct = ratio * 100
        }
      }
    }
  }

  return base
}

/**
 * Create a new ACTIVE episode from an entry hit.
 */
function createEpisodeFromHit({
  symbol,
  hit,
  currentPrice,
  referencePrice,
  referenceTime,
  marketSession,
  nowIso,
  exactLookbacks = null,
}) {
  const move = hit.movePercent
  const dir = hit.direction
  const ref =
    referencePrice != null && Number.isFinite(Number(referencePrice))
      ? Number(referencePrice)
      : Number.isFinite(currentPrice) && Number.isFinite(move) && move !== -100
        ? currentPrice / (1 + move / 100)
        : currentPrice

  const episodeMove =
    episodeMovePct(currentPrice, ref) ?? move

  const span = resolveExactSpan(
    hit.window,
    exactLookbacks,
    referenceTime || nowIso,
    nowIso,
  )
  // Day card is vs previous close — store session name (pre-market / after-hours),
  // not wall-clock “3 days”, so alert title, UI dates, and Supabase match.
  const dayLabel =
    String(hit.window || '') === 'day'
      ? daySessionExactLabel(marketSession)
      : null

  /** @type {MomentumEpisode} */
  const next = {
    episodeId: newEpisodeId(symbol, nowIso),
    ticker: symbol,
    direction: dir,
    status: 'ACTIVE',
    state: 'STARTED',
    referencePrice: ref,
    referenceTime: referenceTime || nowIso,
    triggerPrice: currentPrice,
    triggerTime: nowIso,
    episodeStartedAt: nowIso,
    episodeStartPrice: currentPrice,
    detectedWindow: hit.window,
    /** Frozen window type for this episode (never re-bound mid-life). */
    windowType: hit.window,
    /** Nominal bucket minutes (5, 1440, …) */
    windowMinutes: span.windowMinutes,
    /**
     * True elapsed minutes from reference bar → trigger (e.g. 48 not just "1h").
     * Durable for mobile: "UP +10% in 48 minutes".
     */
    exactMinutes: span.exactMinutes,
    exactLabel: dayLabel || span.exactLabel,
    marketSession: marketSession || null,
    /** Alias of initialMovePercent — immutable trigger move at STARTED. */
    triggerMovePct: episodeMove,
    initialMovePercent: episodeMove,
    currentMovePercent: episodeMove,
    peakMovePercent: episodeMove,
    peakPrice: dir === 'UP' ? currentPrice : null,
    peakTime: dir === 'UP' ? nowIso : null,
    troughPrice: dir === 'DOWN' ? currentPrice : null,
    troughTime: dir === 'DOWN' ? nowIso : null,
    lastAlertMovePercent: episodeMove,
    lastAlertAt: nowIso,
    lastNotifiedPrice: currentPrice,
    lastNotifiedTime: nowIso,
    lastNotifiedEpisodeMovePct: episodeMove,
    currentPrice,
    currentTime: nowIso,
    meaningfulExtremeMovePct: episodeMove,
    lastMaterialProgressAt: nowIso,
    lastMaterialMomentumAt: nowIso,
    inactivityEligibleMs: 0,
    inactivityClockRunningAt: nowIso,
    reversalNotified: false,
    /**
     * Weakening-cycle flags (NOT permanent for the whole episode):
     * - strongWeakeningPushSentInCycle: ≥60% giveback push already sent this cycle
     * - awaitingReAcceleration: after strong fade, wait for +2pp recovery push
     * Reset when a material RE_ACCELERATING push fires so a later fade can alert again.
     */
    strongWeakeningPushSentInCycle: false,
    awaitingReAcceleration: false,
    /** True after at least one RE_ACCELERATING push in this episode */
    hadReAcceleration: false,
    /** Increments each strong-weakening push (idempotency cycle) */
    strongWeakeningCycle: 0,
    /** Increments each acceleration / re-acceleration push */
    accelerationCycle: 0,
    /** @deprecated alias — kept for hydrated episodes */
    strongReversalAlertSent: false,
    belowThresholdSince: null,
    endedAt: null,
    endReason: null,
  }
  return next
}

/**
 * Update peak/trough and episode move from current price.
 * @param {MomentumEpisode} next
 * @param {number} currentPrice
 * @param {string} nowIso
 */
function updateExtremes(next, currentPrice, nowIso) {
  next.currentPrice = currentPrice
  next.currentTime = nowIso

  const move = episodeMovePct(currentPrice, next.referencePrice)
  if (move != null && Number.isFinite(move)) {
    next.currentMovePercent = move
  }

  if (next.direction === 'UP') {
    if (
      next.peakPrice == null ||
      currentPrice > Number(next.peakPrice)
    ) {
      next.peakPrice = currentPrice
      next.peakTime = nowIso
    }
    if (
      next.currentMovePercent != null &&
      Math.abs(next.currentMovePercent) > Math.abs(next.peakMovePercent || 0)
    ) {
      next.peakMovePercent = next.currentMovePercent
    }
  } else {
    if (
      next.troughPrice == null ||
      currentPrice < Number(next.troughPrice)
    ) {
      next.troughPrice = currentPrice
      next.troughTime = nowIso
    }
    if (
      next.currentMovePercent != null &&
      Math.abs(next.currentMovePercent) > Math.abs(next.peakMovePercent || 0)
    ) {
      next.peakMovePercent = next.currentMovePercent
    }
  }
}

/**
 * Meaningful progress: new extreme ≥ materialProgressDeltaPp beyond prior.
 * @param {MomentumEpisode} next
 * @param {string} nowIso
 * @param {string[]} logs
 * @param {number} [materialProgressDeltaPp]
 */
function maybeRecordMaterialProgress(
  next,
  nowIso,
  logs,
  materialProgressDeltaPp = 0.5,
) {
  const cur = Math.abs(Number(next.currentMovePercent) || 0)
  const prev = Math.abs(Number(next.meaningfulExtremeMovePct) || 0)
  const need = Number(materialProgressDeltaPp)
  const delta = Number.isFinite(need) && need >= 0 ? need : 0.5
  if (cur - prev >= delta) {
    next.meaningfulExtremeMovePct = next.currentMovePercent
    next.lastMaterialProgressAt = nowIso
    next.lastMaterialMomentumAt = nowIso
    next.inactivityEligibleMs = 0
    logs.push(
      `[${next.ticker} MOMENTUM] meaningful progress · extreme=${fmt(next.currentMovePercent)}`,
    )
    return true
  }
  return false
}

/**
 * @param {object} opts
 * @param {string} [opts.ticker]
 * @param {Record<string, number|null>} [opts.references]
 * @param {Record<string, string|null>} [opts.referenceTimes]
 * @param {boolean} [opts.forceMarketClose]
 * @param {boolean} [opts.suppressStart] block a new start (manual End until quiet)
 * @returns {{ episode: MomentumEpisode|null, events: object[], logs: string[] }}
 */
export function advanceEpisode({
  ticker = MOMENTUM_TICKER,
  episode,
  returns,
  strongest,
  currentPrice,
  referencePrice,
  referenceTime = null,
  references = null,
  referenceTimes = null,
  exactLookbacks = null,
  marketSession,
  nowIso = new Date().toISOString(),
  forceMarketClose = false,
  assetClass = null,
  suppressStart = false,
  /** FULL_CLOSED | HOLIDAY_CLOSED | MAINTENANCE | DATA_STALE | DATA_UNAVAILABLE | TRADING session */
  lifecycleState = null,
  marketProfile = null,
}) {
  const symbol = String(ticker || MOMENTUM_TICKER).toUpperCase()
  /** @type {object[]} */
  const events = []
  /** @type {string[]} */
  const logs = []
  const session = String(marketSession || '').toUpperCase()
  const resolvedAssetClass =
    assetClass || classifyMomentumAsset(symbol) || 'equity'
  // Per-class episode rules (stocks ≠ commodities ≠ crypto, …)
  const epPolicy = getEpisodePolicyForClass(resolvedAssetClass)
  const ACCELERATION_ALERT_DELTA_PP = epPolicy.accelerationAlertDeltaPp
  const MATERIAL_PROGRESS_DELTA_PP = epPolicy.materialProgressDeltaPp
  const EPISODE_INACTIVITY_EXPIRY_MIN = epPolicy.episodeInactivityExpiryMin
  const EPISODE_REARM_BUFFER_PP_CLS = epPolicy.rearmBufferPp
  const STARTED_STATE_MIN_DWELL_MS = epPolicy.startedStateMinDwellMs
  const MAJOR_FADE_ALERT_ENABLED = epPolicy.majorFadeAlertEnabled
  const STRONG_WEAKENING_GIVEBACK_CLS = epPolicy.strongWeakeningGiveback
  const hits = findEpisodeThresholdCrosses(returns || {}, resolvedAssetClass)
  const thresholdCrossed = hits.length > 0
  let next = episode ? { ...episode } : null
  /** Just-ended episode row to archive (active slot may already be null/new). */
  let closedEpisode = null

  // FULL_CLOSED / holiday / explicit force: terminate immediately.
  // POST / overnight are still tradable — they are NOT full close.
  // MAINTENANCE is not full close (pause clock only).
  const life = String(lifecycleState || '').toUpperCase()
  const shouldFullClose =
    Boolean(forceMarketClose) || isFullClosedLifecycle(life)

  if (next && next.status === 'ACTIVE' && shouldFullClose) {
    logs.push(
      `[${symbol} MOMENTUM] episode closed — MARKET_FULL_CLOSE`,
    )
    next = {
      ...next,
      status: 'CLOSED_AT_MARKET_CLOSE',
      state: 'ENDED',
      endedAt: nowIso,
      endReason: 'MARKET_FULL_CLOSE',
      currentPrice,
      currentTime: nowIso,
      inactivityClockRunningAt: null,
    }
    events.push(
      makeEvent({
        ticker: symbol,
        direction: next.direction,
        eventType: 'MOMENTUM_ENDED',
        price: currentPrice,
        movePercent: next.currentMovePercent,
        detectedWindow: next.detectedWindow,
        nowIso,
        marketSession: session,
        reason: 'MARKET_FULL_CLOSE',
        shouldNotify: false,
        episode: next,
        extra: { terminal: true },
      }),
    )
    disarmAfterTerminal(symbol, next, resolvedAssetClass, 'SESSION')
    return { episode: null, events, logs, closedEpisode: next }
  }

  if (isInactivityPausedLifecycle(life)) {
    if (next && next.status === 'ACTIVE') {
      next.inactivityClockRunningAt = null
    }
    return { episode: next, events, logs, closedEpisode }
  }

  // Stale terminal objects must not keep processing — drop to "no episode"
  // so a legitimate new STARTED can open on the next threshold cross.
  if (
    next &&
    ['EXPIRED', 'ENDED', 'REVERSED', 'CLOSED_AT_MARKET_CLOSE'].includes(
      String(next.status || '').toUpperCase(),
    )
  ) {
    if (!closedEpisode) closedEpisode = next
    next = null
  }

  // Long-horizon windows (30h / 1w / 10d / …) blink in the UI only.
  // They must not keep an ACTIVE episode alive.
  if (
    next &&
    next.status === 'ACTIVE' &&
    !isEpisodeEligibleWindow(next.detectedWindow)
  ) {
    logs.push(
      `[${symbol} MOMENTUM] episode ended — ${next.detectedWindow} is beyond ≤24h / 1D (blink-only)`,
    )
    next = {
      ...next,
      status: 'ENDED',
      endedAt: nowIso,
      endReason: 'WINDOW_OUT_OF_SCOPE',
      currentPrice,
      currentTime: nowIso,
    }
    events.push(
      makeEvent({
        ticker: symbol,
        direction: next.direction,
        eventType: 'MOMENTUM_ENDED',
        price: currentPrice,
        movePercent: next.currentMovePercent,
        detectedWindow: next.detectedWindow,
        nowIso,
        marketSession: session,
        reason: 'WINDOW_OUT_OF_SCOPE',
        shouldNotify: false,
        episode: next,
      }),
    )
    closedEpisode = next
    disarmAfterTerminal(symbol, next, resolvedAssetClass)
    next = null
  }

  // ── No active episode ──────────────────────────────────────────
  if (!next || next.status !== 'ACTIVE') {
    const edgeSnap = buildThresholdEdgeSnapshot(
      returns || {},
      resolvedAssetClass,
    )
    const prevEdges = store.getThresholdEdgeState(symbol)

    // Cold start / restart: first observation usually only seeds edges (no START
    // from already-elevated windows, e.g. RTH deploy at 13:00 with 3h already +7%).
    // Soft exception for PRE: day (vs prev close) already ≥ thr can START without
    // cool-then-re-cross — on first poll *and* after edges were seeded hot.
    const isPreLike = session === 'PRE' || session === 'PREPRE'
    const dayHit = hits.find((h) => h && h.window === 'day') || null
    /** Soft PRE day: allow day as a START candidate even when not a "fresh" edge cross */
    const softPreDayHit =
      isPreLike && dayHit && !suppressStart ? dayHit : null

    if (!prevEdges) {
      store.setThresholdEdgeState(symbol, edgeSnap, resolvedAssetClass)
      if (!softPreDayHit) {
        logs.push(
          `[${symbol} MOMENTUM] threshold edges seeded (cold start) — no START until a fresh thr cross`,
        )
        return { episode: null, events, logs, closedEpisode }
      }
      logs.push(
        `[${symbol} MOMENTUM] cold start · pre-market day already ${fmt(dayHit.movePercent)} ≥ thr — allowing START`,
      )
    }

    // FULL re-arm: every same-dir window must be below its own thr−buffer
    const gate = store.getRearmGate(symbol)
    if (gate && !gate.armed && gate.policy !== 'SESSION') {
      const pw = evaluatePerWindowRearm(
        returns || {},
        gate.direction,
        resolvedAssetClass,
        gate.bufferPp ?? EPISODE_REARM_BUFFER_PP_CLS,
      )
      const re = store.evaluateRearmForStart(symbol, gate.direction, pw)
      if (re.justArmed) {
        logs.push(
          `[${symbol} MOMENTUM] direction re-armed (${gate.direction}) — all same-dir windows below own thr−${gate.bufferPp ?? EPISODE_REARM_BUFFER_PP_CLS}pp`,
        )
      }
    }

    // Always advance edge snapshot (even when we don't start)
    const commitEdges = () =>
      store.setThresholdEdgeState(symbol, edgeSnap, resolvedAssetClass)

    if (suppressStart && thresholdCrossed) {
      commitEdges()
      logs.push(
        `[${symbol} MOMENTUM] start blocked — waiting for ≤24h / 1D to go quiet after manual end`,
      )
      return { episode: null, events, logs, closedEpisode }
    }
    if (!thresholdCrossed || !hits.length) {
      commitEdges()
      return { episode: null, events, logs, closedEpisode }
    }

    // START requires a *crossing* (was not above thr in this direction last poll),
    // except pre-market day already ≥ thr (no cool-then-re-cross for PRE day).
    let freshHits = prevEdges
      ? filterFreshThresholdCrosses(hits, prevEdges.windows)
      : softPreDayHit
        ? [softPreDayHit]
        : []
    if (
      softPreDayHit &&
      !freshHits.some((h) => h && h.window === 'day')
    ) {
      freshHits = [...freshHits, softPreDayHit]
      logs.push(
        `[${symbol} MOMENTUM] soft pre-market day ${fmt(softPreDayHit.movePercent)} ≥ thr — START without cool-then-re-cross`,
      )
    }
    if (!freshHits.length) {
      commitEdges()
      logs.push(
        `[${symbol} MOMENTUM] start blocked — no fresh threshold cross (already elevated windows need cool-then-re-cross)`,
      )
      return { episode: null, events, logs, closedEpisode }
    }

    // One START only: shortest *fresh* qualifying window overall
    // (soft PRE day may be the only candidate)
    const hit = pickShortestStartHit(freshHits)
    if (!hit) {
      commitEdges()
      return { episode: null, events, logs, closedEpisode }
    }
    // In-process concurrency: another worker may have claimed ACTIVE already
    const liveActive = store.getActiveEpisode(symbol)
    if (
      liveActive &&
      String(liveActive.status || '').toUpperCase() === 'ACTIVE'
    ) {
      commitEdges()
      logs.push(
        `[${symbol} MOMENTUM] start blocked — ACTIVE episode already exists (${liveActive.episodeId || '?'})`,
      )
      return {
        episode: { ...liveActive },
        events,
        logs,
        closedEpisode,
      }
    }
    // FULL re-arm gate for this direction (per-window cool-off)
    const pwStart = evaluatePerWindowRearm(
      returns || {},
      hit.direction,
      resolvedAssetClass,
      EPISODE_REARM_BUFFER_PP_CLS,
    )
    const rearm = store.evaluateRearmForStart(
      symbol,
      hit.direction,
      pwStart,
    )
    if (!rearm.allowed) {
      commitEdges()
      logs.push(
        `[${symbol} MOMENTUM] start blocked — ${rearm.reason || 'direction disarmed after prior episode'} (candidate ${hit.window})`,
      )
      return { episode: null, events, logs, closedEpisode }
    }

    // Freeze shortest window only — not a longer co-qualifying window’s ref/%
    const refP =
      (references && references[hit.window] != null
        ? references[hit.window]
        : null) ??
      referencePrice ??
      null
    const refT =
      (referenceTimes && referenceTimes[hit.window]
        ? referenceTimes[hit.window]
        : null) ??
      referenceTime ??
      null

    next = createEpisodeFromHit({
      symbol,
      hit,
      currentPrice,
      referencePrice: refP,
      referenceTime: refT,
      marketSession: session,
      nowIso,
      exactLookbacks,
    })
    // Atomic one-ACTIVE-per-ticker claim (second concurrent START loses)
    const claim = store.claimActiveEpisode(symbol, next)
    if (!claim.ok) {
      commitEdges()
      logs.push(
        `[${symbol} MOMENTUM] start blocked — concurrent ACTIVE claim (${claim.existing?.episodeId || claim.reason})`,
      )
      return {
        episode: claim.existing ? { ...claim.existing } : null,
        events,
        logs,
        closedEpisode,
      }
    }
    // Successful new START clears re-arm gate for this ticker
    store.clearRearmGate(symbol)
    commitEdges()

    const otherSameDir = hits.filter(
      (h) =>
        h.direction === hit.direction &&
        h.window !== hit.window,
    )
    const ev = makeEvent({
      ticker: symbol,
      direction: hit.direction,
      eventType: 'MOMENTUM_STARTED',
      price: currentPrice,
      // Frozen to shortest window's move (not a longer window's %)
      movePercent: next.currentMovePercent,
      detectedWindow: hit.window,
      nowIso,
      marketSession: session,
      // No auto-push on start — run Perplexity for the reason, then alert.
      // Single START only — longer co-qualifying windows do not get their own alerts.
      shouldNotify: false,
      episode: next,
      extra: {
        state: 'STARTED',
        cycleNumber: 0,
        referencePrice: next.referencePrice ?? null,
        referenceTime: next.referenceTime ?? null,
        triggerPrice: next.triggerPrice ?? null,
        episodeStartPrice: next.episodeStartPrice ?? null,
        initialMovePercent: next.initialMovePercent ?? null,
        triggerMovePct: next.triggerMovePct ?? next.initialMovePercent ?? null,
        exactMinutes: next.exactMinutes ?? null,
        exactLabel: next.exactLabel ?? null,
        windowMinutes: next.windowMinutes ?? null,
        windowType: hit.window,
        startSelection: {
          rule:
            softPreDayHit && hit.window === 'day'
              ? 'soft_pre_market_day_already_elevated'
              : 'shortest_qualifying_window_sets_direction',
          selectedWindow: hit.window,
          selectedMovePercent: hit.movePercent,
          selectedThreshold: hit.threshold,
          selectedDirection: hit.direction,
          alsoQualified: otherSameDir.map((h) => ({
            window: h.window,
            movePercent: h.movePercent,
            threshold: h.threshold,
          })),
        },
        measureNote:
          softPreDayHit && hit.window === 'day'
            ? next.exactLabel
              ? `Soft pre-market start on day (vs previous close) · exact span ${next.exactLabel}. Move % = ((live − previous close) / previous close) × 100.`
              : `Soft pre-market start on day (vs previous close). Move % = ((live − previous close) / previous close) × 100.`
            : next.exactLabel
              ? `Start on shortest qualifying window “${hit.window}” · exact span ${next.exactLabel}. Move % = ((live − that window’s reference) / reference) × 100. Direction comes from that window (not strongest |move|). Longer co-qualifying windows did not open extra episodes.`
              : `Start on shortest qualifying window “${hit.window}”. Move % = ((live − reference) / reference) × 100. Direction from that window.`,
      },
    })
    events.push(ev)
    logs.push(
      `[${symbol} MOMENTUM] ${
        softPreDayHit && hit.window === 'day'
          ? 'soft pre-market day'
          : 'threshold crossed'
      }: ${hit.window} ${fmt(hit.movePercent)}${
        next.exactLabel ? ` · exact ${next.exactLabel}` : ''
      }${
        otherSameDir.length
          ? ` · ignored longer windows: ${otherSameDir.map((h) => h.window).join(', ')}`
          : ''
      }`,
    )
    logs.push(
      `[${symbol} MOMENTUM] episode started: ${hit.direction} on ${hit.window} (auto Perplexity + alert next)`,
    )
    return { episode: next, events, logs, closedEpisode }
  }

  // While ACTIVE: newly qualifying shorter windows never create another START.
  // They only matter indirectly if price extension vs frozen reference hits +2pp accel.

  // ── Active episode ─────────────────────────────────────────────
  next.ticker = symbol
  // Immutable identity: never re-bind reference / window / direction after start
  // (updateExtremes only mutates price/peak/trough/currentMove from frozen referencePrice)

  updateExtremes(next, currentPrice, nowIso)
  maybeRecordMaterialProgress(
    next,
    nowIso,
    logs,
    MATERIAL_PROGRESS_DELTA_PP,
  )

  // ── Inactivity: 3 eligible trading hours since last material momentum ──
  // Wall-clock is not used. Maintenance / stale periods are not counted
  // (those lifecycles return before this block). FULL_CLOSED already closed.
  {
    const progressAt =
      next.lastMaterialProgressAt ||
      next.lastMaterialMomentumAt ||
      next.triggerTime ||
      next.episodeStartedAt
    const fromMs = Date.parse(progressAt)
    const toMs = Date.parse(nowIso)
    const profile = marketProfile || null
    let elapsedMs = 0
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
      elapsedMs = profile
        ? eligibleTradingMsBetween(profile, fromMs, toMs)
        : toMs - fromMs
    }
    const limitMs = EPISODE_INACTIVITY_EXPIRY_MIN * 60_000
    if (elapsedMs >= limitMs) {
      next.status = 'EXPIRED'
      next.state = 'EXPIRED'
      next.endedAt = nowIso
      next.endReason = 'NO_MATERIAL_MOMENTUM_3H'
      logs.push(
        `[${symbol} MOMENTUM] episode expired — no material momentum for ${EPISODE_INACTIVITY_EXPIRY_MIN} eligible trading minutes`,
      )
      events.push(
        makeEvent({
          ticker: symbol,
          direction: next.direction,
          eventType: 'MOMENTUM_ENDED',
          price: currentPrice,
          movePercent: next.currentMovePercent,
          detectedWindow: next.detectedWindow,
          nowIso,
          marketSession: session,
          reason: 'NO_MATERIAL_MOMENTUM_3H',
          shouldNotify: false,
          episode: next,
          extra: {
            state: 'EXPIRED',
            referencePrice: next.referencePrice ?? null,
            referenceTime: next.referenceTime ?? null,
            peakMovePercent: next.peakMovePercent ?? null,
            peakPrice: next.peakPrice ?? null,
            initialMovePercent: next.initialMovePercent ?? null,
            triggerMovePct: next.initialMovePercent ?? null,
            triggerPrice: next.triggerPrice ?? null,
            exactMinutes: next.exactMinutes ?? null,
            exactLabel: next.exactLabel ?? null,
            terminal: true,
          },
        }),
      )
      disarmAfterTerminal(symbol, next, resolvedAssetClass)
      return { episode: null, events, logs, closedEpisode: next }
    }
  }

  // Reversal: original move erased AND opposite entry detector fires.
  // oppositeThresholdHit already picks the shortest qualifying opposite window.
  const reverseHit = oppositeThresholdHit(
    returns || {},
    next.direction,
    resolvedAssetClass,
  )
  const erased = originalMoveErased(
    next.direction,
    currentPrice,
    Number(next.referencePrice),
  )

  if (reverseHit && erased && !next.reversalNotified) {
    const oldDir = next.direction
    // All opposite-direction hits that also qualify (for startSelection audit)
    const oppositeHits = findEpisodeThresholdCrosses(
      returns || {},
      resolvedAssetClass,
    ).filter((h) => h.direction === reverseHit.direction)
    const otherOpposite = oppositeHits.filter(
      (h) => h.window !== reverseHit.window,
    )
    logs.push(
      `[${symbol} MOMENTUM] episode reversed (${oldDir} → ${reverseHit.direction}) · new window ${reverseHit.window}${
        otherOpposite.length
          ? ` · ignored longer: ${otherOpposite.map((h) => h.window).join(', ')}`
          : ''
      }`,
    )
    next.reversalNotified = true
    next.status = 'REVERSED'
    next.state = 'REVERSAL'
    next.endedAt = nowIso
    next.endReason = 'REVERSAL'
    closedEpisode = { ...next }
    // Old direction disarmed + ACTIVE slot cleared for opposite claim
    disarmAfterTerminal(symbol, closedEpisode, resolvedAssetClass)

    events.push(
      makeEvent({
        ticker: symbol,
        direction: oldDir,
        eventType: 'MOMENTUM_REVERSED',
        price: currentPrice,
        movePercent: next.currentMovePercent,
        detectedWindow: next.detectedWindow,
        nowIso,
        marketSession: session,
        reason: 'REVERSAL',
        // Push only after Perplexity reverse-research (same pattern as STARTED)
        // Single combined reverse push — opposite STARTED is silent (AFTER_REVERSAL).
        shouldNotify: false,
        episode: closedEpisode,
        extra: { cycleNumber: 0 },
      }),
    )
    // Also emit ENDED for consumers that only listen for MOMENTUM_ENDED
    events.push(
      makeEvent({
        ticker: symbol,
        direction: oldDir,
        eventType: 'MOMENTUM_ENDED',
        price: currentPrice,
        movePercent: next.currentMovePercent,
        detectedWindow: next.detectedWindow,
        nowIso,
        marketSession: session,
        reason: 'REVERSAL',
        shouldNotify: false, // push already sent as REVERSED
        episode: closedEpisode,
        extra: { cycleNumber: 0 },
      }),
    )

    // Fresh opposite episode: shortest qualifying opposite window only
    const refP =
      (references && references[reverseHit.window] != null
        ? references[reverseHit.window]
        : null) ?? currentPrice
    const refT =
      (referenceTimes && referenceTimes[reverseHit.window]
        ? referenceTimes[reverseHit.window]
        : null) ?? nowIso

    const started = createEpisodeFromHit({
      symbol,
      hit: reverseHit,
      currentPrice,
      referencePrice: refP,
      referenceTime: refT,
      marketSession: session,
      nowIso,
      exactLookbacks,
    })
    const claimOpp = store.claimActiveEpisode(symbol, started)
    if (!claimOpp.ok) {
      logs.push(
        `[${symbol} MOMENTUM] reverse opposite START blocked — ACTIVE already (${claimOpp.existing?.episodeId || claimOpp.reason})`,
      )
      return { episode: null, events, logs, closedEpisode }
    }
    // New opposite episode is created internally, but only REVERSAL is pushed
    // (no second START notification for the same market moment).
    events.push(
      makeEvent({
        ticker: symbol,
        direction: reverseHit.direction,
        eventType: 'MOMENTUM_STARTED',
        price: currentPrice,
        movePercent: started.currentMovePercent,
        detectedWindow: reverseHit.window,
        nowIso,
        marketSession: session,
        shouldNotify: false,
        reason: 'AFTER_REVERSAL',
        episode: started,
        extra: {
          state: 'STARTED',
          cycleNumber: 0,
          exactMinutes: started.exactMinutes ?? null,
          exactLabel: started.exactLabel ?? null,
          windowMinutes: started.windowMinutes ?? null,
          referencePrice: started.referencePrice ?? null,
          referenceTime: started.referenceTime ?? null,
          triggerPrice: started.triggerPrice ?? null,
          triggerMovePct: started.triggerMovePct ?? null,
          initialMovePercent: started.initialMovePercent ?? null,
          startSelection: {
            rule: 'shortest_qualifying_window_sets_direction',
            selectedWindow: reverseHit.window,
            selectedMovePercent: reverseHit.movePercent,
            selectedThreshold: reverseHit.threshold,
            selectedDirection: reverseHit.direction,
            alsoQualified: otherOpposite.map((h) => ({
              window: h.window,
              movePercent: h.movePercent,
              threshold: h.threshold,
            })),
            afterReversal: true,
          },
        },
      }),
    )
    logs.push(
      `[${symbol} MOMENTUM] episode started: ${reverseHit.direction} on ${reverseHit.window} (silent after reverse)`,
    )
    // Opposite-leg start is intentional; clear re-arm so DOWN can run freely
    store.clearRearmGate(symbol)
    return { episode: started, events, logs, closedEpisode }
  }

  // Giveback-based internal state (no auto-reversal on 50% fade)
  const giveback = computeGivebackRatio(next, currentPrice)
  // Persist on the episode so Supabase episode row has live giveback %
  next.givebackRatio = giveback
  next.givebackPct =
    giveback != null && Number.isFinite(Number(giveback))
      ? Number(giveback) * 100
      : null
  const givebackState = classifyGivebackState(giveback, next.state, epPolicy)

  const lastNotifiedAbs = Math.abs(Number(next.lastNotifiedEpisodeMovePct) || 0)
  const currentAbs = Math.abs(Number(next.currentMovePercent) || 0)
  const extensionPp = currentAbs - lastNotifiedAbs
  const materialAccel = extensionPp >= ACCELERATION_ALERT_DELTA_PP

  /**
   * Lifecycle (pushes):
   *   STARTED → ACCELERATING (+2pp) → HOLDING → WEAKENING
   *   → STRONGLY_WEAKENING + push at ≥60% giveback (sets recovery anchor)
   *   → small recovery ticks SILENT (no RE_ACCEL on +0.5pp green ticks)
   *   → RE_ACCELERATING + push only at +2pp vs recovery anchor
   *   → cycle resets → further +2pp = ACCELERATING
   *   → second ≥60% fade can push again
   *
   * HOLDING must never jump to RE_ACCELERATING on tiny noise.
   */
  const prevState = next.state
  const fromFade =
    prevState === 'WEAKENING' ||
    prevState === 'STRONGLY_WEAKENING' ||
    prevState === 'RE_ACCELERATING'
  const awaitingReAccel = Boolean(
    next.awaitingReAcceleration ||
      next.strongWeakeningPushSentInCycle ||
      next.strongReversalAlertSent,
  )

  // Silent state labels only — material pushes handled below
  if (prevState === 'HOLDING' || prevState === 'STARTED' || prevState === 'ACCELERATING') {
    next.state = givebackState
  } else if (fromFade) {
    // Stay on giveback band while recovering slowly — do NOT flip to
    // RE_ACCELERATING on every small green tick (that was noisy).
    next.state = givebackState
  } else {
    next.state = givebackState
  }

  // STARTED dwell: keep STARTED for ~1 poll interval before silent HOLDING.
  if (
    prevState === 'STARTED' &&
    next.state !== 'ACCELERATING' &&
    next.state !== 'RE_ACCELERATING' &&
    next.state !== 'REVERSAL'
  ) {
    const startMs = Date.parse(
      String(next.episodeStartedAt || next.triggerTime || ''),
    )
    const nowMs = Date.parse(String(nowIso || ''))
    const ageMs =
      Number.isFinite(startMs) && Number.isFinite(nowMs) ? nowMs - startMs : 0
    if (ageMs < STARTED_STATE_MIN_DWELL_MS) {
      next.state = 'STARTED'
    }
  }

  /**
   * Silent state-timeline row for the Recent Events rail.
   * Only emit when the label actually changes (no per-tick spam).
   */
  const emitStateRow = (fromState, toState) => {
    if (!toState || fromState === toState) return
    events.push(
      makeEvent({
        ticker: symbol,
        direction: next.direction,
        eventType: 'MOMENTUM_STATE',
        price: currentPrice,
        movePercent: next.currentMovePercent,
        detectedWindow: next.detectedWindow,
        nowIso,
        marketSession: session,
        shouldNotify: false,
        reason: toState,
        episode: next,
        extra: {
          state: toState,
          previousState: fromState || null,
          givebackRatio: giveback,
          givebackPct:
            giveback != null && Number.isFinite(Number(giveback))
              ? Number(giveback) * 100
              : null,
          referencePrice: next.referencePrice ?? null,
          referenceTime: next.referenceTime ?? null,
          peakPrice: next.peakPrice ?? null,
          peakMovePercent: next.peakMovePercent ?? null,
          troughPrice: next.troughPrice ?? null,
          lastNotifiedPrice: next.lastNotifiedPrice ?? null,
          lastNotifiedEpisodeMovePct: next.lastNotifiedEpisodeMovePct ?? null,
          lastNotifiedTime: next.lastNotifiedTime ?? null,
          initialMovePercent: next.initialMovePercent ?? null,
          episodeStartPrice: next.episodeStartPrice ?? null,
          triggerPrice: next.triggerPrice ?? null,
          measureNote:
            toState === 'HOLDING' ||
            toState === 'WEAKENING' ||
            toState === 'STRONGLY_WEAKENING'
              ? next.direction === 'UP'
                ? 'Giveback % = (peak price − live) / (peak price − reference) × 100. HOLDING if giveback is small; WEAKENING if giveback ≥ ~25% of the peak move from reference.'
                : 'Giveback % = (live − trough price) / (reference − trough price) × 100. HOLDING if giveback is small; WEAKENING if giveback ≥ ~25% of the trough move from reference.'
              : 'Episode move % = ((live price − reference price) / reference price) × 100.',
        },
      }),
    )
    logs.push(
      `[${symbol} MOMENTUM] state ${fromState || '—'} → ${toState} (dashboard only, no push)`,
    )
  }

  // Material acceleration push (≥2 pp beyond last notified / recovery anchor)
  // Always use frozen episode reference for move % (updateExtremes already did).
  if (materialAccel) {
    const prevNotified = next.lastNotifiedEpisodeMovePct
    const prevPrice = next.lastNotifiedPrice
    const prevTime = next.lastNotifiedTime
    // First +2pp after a strong-fade cycle = RE_ACCELERATING; else ACCELERATING
    const isReAccel =
      awaitingReAccel ||
      (fromFade &&
        (prevState === 'WEAKENING' || prevState === 'STRONGLY_WEAKENING'))
    const accelState = isReAccel ? 'RE_ACCELERATING' : 'ACCELERATING'
    next.state = accelState
    // Live span from frozen referenceTime only (never swap window/reference)
    const liveSpan = resolveExactSpan(
      next.detectedWindow,
      exactLookbacks,
      next.referenceTime,
      nowIso,
    )
    if (liveSpan.exactMinutes != null) {
      next.currentExactMinutes = liveSpan.exactMinutes
      next.currentExactLabel = liveSpan.exactLabel
    }
    logs.push(
      `[${symbol} MOMENTUM] ${accelState} · ${fmt(prevNotified)} → ${fmt(next.currentMovePercent)} (+${extensionPp.toFixed(2)}pp)${
        liveSpan.exactLabel ? ` · ${liveSpan.exactLabel}` : ''
      }`,
    )
    emitStateRow(prevState, accelState)
    next.accelerationCycle = (Number(next.accelerationCycle) || 0) + 1
    events.push(
      makeEvent({
        ticker: symbol,
        direction: next.direction,
        eventType: 'MOMENTUM_ACCELERATING',
        price: currentPrice,
        // Always episode-basis move (same reference as STARTED)
        movePercent: next.currentMovePercent,
        detectedWindow: next.detectedWindow,
        nowIso,
        marketSession: session,
        shouldNotify: true,
        reason: isReAccel ? 'RE_ACCELERATION' : 'ACCELERATION',
        previousAlertMovePercent: prevNotified,
        episode: {
          ...next,
          lastNotifiedPrice: prevPrice,
          lastNotifiedTime: prevTime,
          lastNotifiedEpisodeMovePct: prevNotified,
        },
        extra: {
          state: accelState,
          cycleNumber: next.accelerationCycle,
          accelKind: isReAccel ? 'RE_ACCELERATING' : 'ACCELERATING',
          extendsRecovery: Boolean(!isReAccel && next.hadReAcceleration),
          referencePrice: next.referencePrice ?? null,
          referenceTime: next.referenceTime ?? null,
          lastNotifiedPrice: prevPrice ?? null,
          lastNotifiedTime: prevTime ?? null,
          lastNotifiedEpisodeMovePct: prevNotified ?? null,
          peakMovePercent: next.peakMovePercent ?? null,
          peakPrice: next.peakPrice ?? null,
          // Span from reference bar → this accel tick (true duration of the move)
          exactMinutes: liveSpan.exactMinutes ?? next.exactMinutes ?? null,
          exactLabel: liveSpan.exactLabel ?? next.exactLabel ?? null,
          windowMinutes: liveSpan.windowMinutes ?? next.windowMinutes ?? null,
          startExactMinutes: next.exactMinutes ?? null,
          startExactLabel: next.exactLabel ?? null,
          recoveryFromMovePercent: isReAccel
            ? Number(prevNotified)
            : null,
          extensionPp:
            Number.isFinite(Number(next.currentMovePercent)) &&
            Number.isFinite(Number(prevNotified))
              ? Math.abs(Number(next.currentMovePercent)) -
                Math.abs(Number(prevNotified))
              : null,
          measureNote: isReAccel
            ? `Re-acceleration when episode move recovers ≥${ACCELERATION_ALERT_DELTA_PP} pp past the recovery anchor set at strong giveback (not every small green tick).`
            : `Acceleration when |episode move| extends ≥${ACCELERATION_ALERT_DELTA_PP} pp beyond last notified move.`,
        },
      }),
    )
    next.lastAlertMovePercent = next.currentMovePercent
    next.lastAlertAt = nowIso
    next.lastNotifiedPrice = currentPrice
    next.lastNotifiedTime = nowIso
    next.lastNotifiedEpisodeMovePct = next.currentMovePercent
    next.belowThresholdSince = null
    // Cycle reset: future ≥60% giveback can push again
    if (isReAccel) {
      next.hadReAcceleration = true
      next.awaitingReAcceleration = false
      next.strongWeakeningPushSentInCycle = false
      next.strongReversalAlertSent = false
      next._majorFadeNotified = false
    }
    return { episode: next, events, logs, closedEpisode }
  }

  // Silent path: holding / weakening / tiny recovery — still record state for UI
  emitStateRow(prevState, next.state)

  /**
   * Strong giveback push (per weakening cycle, not permanent per episode):
   *   givebackPct ≥ 60% AND strongWeakeningPushSentInCycle = false
   *   → MOMENTUM_STRONG_WEAKENING (NOT true REVERSAL)
   *   → lastNotified = remaining move (recovery anchor)
   *   → awaitingReAcceleration = true
   * Small green ticks after this are SILENT until +2pp vs that anchor.
   */
  const strongAlreadyInCycle = Boolean(
    next.strongWeakeningPushSentInCycle ||
      next.strongReversalAlertSent ||
      next._majorFadeNotified,
  )
  if (
    MAJOR_FADE_ALERT_ENABLED &&
    givebackAtLeast(giveback, STRONG_WEAKENING_GIVEBACK_CLS) &&
    !strongAlreadyInCycle
  ) {
    next.strongWeakeningPushSentInCycle = true
    next.awaitingReAcceleration = true
    next.strongReversalAlertSent = true // legacy alias for this cycle only
    next._majorFadeNotified = true
    next.strongWeakeningCycle = (Number(next.strongWeakeningCycle) || 0) + 1
    next.state = 'STRONGLY_WEAKENING'
    const peakMove = Number(next.peakMovePercent)
    const remainingMove = Number(next.currentMovePercent)
    const givebackPct = giveback * 100
    logs.push(
      `[${symbol} MOMENTUM] strong giveback · ${givebackPct.toFixed(1)}% · peak=${fmt(peakMove)} remaining=${fmt(remainingMove)} · recovery anchor set`,
    )
    // Anchor last-notified at the faded level so re-accel needs +2pp from HERE
    next.lastNotifiedEpisodeMovePct = remainingMove
    next.lastNotifiedPrice = currentPrice
    next.lastNotifiedTime = nowIso
    next.lastAlertMovePercent = remainingMove
    next.lastAlertAt = nowIso
    events.push(
      makeEvent({
        ticker: symbol,
        direction: next.direction,
        // Named STRONG_WEAKENING so analytics never confuses with MOMENTUM_REVERSED
        eventType: 'MOMENTUM_STRONG_WEAKENING',
        price: currentPrice,
        movePercent: remainingMove,
        detectedWindow: next.detectedWindow,
        nowIso,
        marketSession: session,
        shouldNotify: true,
        reason: 'STRONG_GIVEBACK',
        episode: next,
        extra: {
          state: 'STRONGLY_WEAKENING',
          cycleNumber: next.strongWeakeningCycle,
          previousState: prevState || null,
          givebackRatio: giveback,
          givebackPct,
          peakMovePercent: Number.isFinite(peakMove) ? peakMove : null,
          peakPrice: next.peakPrice ?? null,
          troughPrice: next.troughPrice ?? null,
          referencePrice: next.referencePrice ?? null,
          referenceTime: next.referenceTime ?? null,
          remainingMovePercent: Number.isFinite(remainingMove)
            ? remainingMove
            : null,
          recoveryAnchorMovePercent: Number.isFinite(remainingMove)
            ? remainingMove
            : null,
          measureNote:
            next.direction === 'UP'
              ? 'Strong giveback when (peak − live) / (peak − reference) ≥ 60%. Remaining move becomes the recovery anchor; re-accel needs +2pp from that anchor. Cycle resets after re-accel so a later fade can alert again. Not a direction REVERSAL.'
              : 'Strong giveback when (live − trough) / (reference − trough) ≥ 60%. Remaining move becomes the recovery anchor; re-accel needs +2pp from that anchor. Cycle resets after re-accel so a later fade can alert again. Not a direction REVERSAL.',
        },
      }),
    )
  } else if (
    next.state === 'HOLDING' ||
    next.state === 'WEAKENING' ||
    next.state === 'STRONGLY_WEAKENING'
  ) {
    logs.push(
      `[${symbol} MOMENTUM] state=${next.state} giveback=${(giveback * 100).toFixed(1)}% · ext=${extensionPp.toFixed(2)}pp${
        strongAlreadyInCycle
          ? ' · awaiting +2pp re-accel (silent recovery)'
          : ' (no push)'
      }`,
    )
  } else if (next.state === 'RE_ACCELERATING' || next.state === 'ACCELERATING') {
    logs.push(
      `[${symbol} MOMENTUM] ignored sub-milestone move · ext=${extensionPp.toFixed(2)}pp`,
    )
  } else {
    logs.push(`[${symbol} MOMENTUM] ignored duplicate movement`)
  }

  // Expiry is checked at the top of the ACTIVE path (before state transitions).
  return { episode: next, events, logs, closedEpisode }
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

/**
 * Manual “Start episode” from a rolling-return card (dashboard).
 * Bypasses threshold / re-arm / fresh-cross gates. One ACTIVE per ticker.
 *
 * @param {{
 *   ticker?: string,
 *   windowKey: string,
 *   currentPrice: number,
 *   returns: Record<string, number|null|undefined>,
 *   references?: Record<string, number|null>|null,
 *   referenceTimes?: Record<string, string|null>|null,
 *   exactLookbacks?: Record<string, unknown>|null,
 *   marketSession?: string|null,
 *   assetClass?: string|null,
 *   nowIso?: string,
 * }} opts
 */
export function forceStartEpisodeFromWindow(opts = {}) {
  const symbol = String(opts.ticker || MOMENTUM_TICKER).toUpperCase()
  const key = String(opts.windowKey || '').trim()
  const nowIso = opts.nowIso || new Date().toISOString()
  const session = String(opts.marketSession || 'REGULAR').toUpperCase()
  const resolvedAssetClass =
    opts.assetClass || classifyMomentumAsset(symbol) || 'equity'
  /** @type {object[]} */
  const events = []
  /** @type {string[]} */
  const logs = []

  if (!key) {
    return { ok: false, error: 'windowKey required', episode: null, events, logs }
  }
  if (!isEpisodeEligibleWindow(key)) {
    return {
      ok: false,
      error: `Window “${key}” cannot start an episode (multi-day / blink-only)`,
      episode: null,
      events,
      logs,
      code: 'WINDOW_NOT_ELIGIBLE',
    }
  }

  const move = Number(opts.returns?.[key])
  const currentPrice = Number(opts.currentPrice)
  if (!Number.isFinite(move)) {
    return {
      ok: false,
      error: `No rolling return for window “${key}”`,
      episode: null,
      events,
      logs,
      code: 'NO_RETURN',
    }
  }
  if (!Number.isFinite(currentPrice)) {
    return {
      ok: false,
      error: 'No live price',
      episode: null,
      events,
      logs,
      code: 'NO_PRICE',
    }
  }

  const live = store.getActiveEpisode(symbol)
  if (live && String(live.status || '').toUpperCase() === 'ACTIVE') {
    return {
      ok: false,
      error: `ACTIVE episode already open (${live.episodeId || '?'}) — End it first`,
      episode: { ...live },
      events,
      logs,
      code: 'ALREADY_ACTIVE',
    }
  }

  const dir = move >= 0 ? 'UP' : 'DOWN'
  const thr = getThresholdForKey(key, resolvedAssetClass)
  const hit = {
    window: key,
    movePercent: move,
    direction: dir,
    threshold:
      thr != null && Number.isFinite(Number(thr)) && Number(thr) > 0
        ? Number(thr)
        : Math.abs(move),
  }

  const refP =
    opts.references && opts.references[key] != null
      ? opts.references[key]
      : null
  const refT =
    opts.referenceTimes && opts.referenceTimes[key]
      ? opts.referenceTimes[key]
      : null

  // Manual start clears re-arm / restart gates so the operator can open a story
  store.clearRearmGate(symbol)
  store.clearRestartGate(symbol)

  const next = createEpisodeFromHit({
    symbol,
    hit,
    currentPrice,
    referencePrice: refP,
    referenceTime: refT,
    marketSession: session,
    nowIso,
    exactLookbacks: opts.exactLookbacks || null,
  })

  const claim = store.claimActiveEpisode(symbol, next)
  if (!claim.ok) {
    logs.push(
      `[${symbol} MOMENTUM] manual start blocked — ${claim.reason || 'claim failed'}`,
    )
    return {
      ok: false,
      error: claim.reason || 'Could not claim ACTIVE episode',
      episode: claim.existing ? { ...claim.existing } : null,
      events,
      logs,
      code: 'CLAIM_FAILED',
    }
  }

  if (!next.episodeNo) {
    next.episodeNo = store.allocateEpisodeNo(symbol)
  }
  store.setActiveEpisode(symbol, next)
  store.clearRearmGate(symbol)

  // Seed edges so we do not immediately thr-cross again on the same levels
  try {
    const edgeSnap = buildThresholdEdgeSnapshot(
      opts.returns || {},
      resolvedAssetClass,
    )
    store.setThresholdEdgeState(symbol, edgeSnap, resolvedAssetClass)
  } catch {
    /* ignore */
  }

  const ev = makeEvent({
    ticker: symbol,
    direction: dir,
    eventType: 'MOMENTUM_STARTED',
    price: currentPrice,
    movePercent: next.currentMovePercent,
    detectedWindow: key,
    nowIso,
    marketSession: session,
    reason: 'MANUAL_START',
    shouldNotify: false,
    episode: next,
    extra: {
      state: 'STARTED',
      cycleNumber: 0,
      manualStart: true,
      referencePrice: next.referencePrice ?? null,
      referenceTime: next.referenceTime ?? null,
      triggerPrice: next.triggerPrice ?? null,
      episodeStartPrice: next.episodeStartPrice ?? null,
      initialMovePercent: next.initialMovePercent ?? null,
      triggerMovePct: next.triggerMovePct ?? next.initialMovePercent ?? null,
      exactMinutes: next.exactMinutes ?? null,
      exactLabel: next.exactLabel ?? null,
      windowMinutes: next.windowMinutes ?? null,
      windowType: key,
      startSelection: {
        rule: 'manual_start_from_rolling_return_card',
        selectedWindow: key,
        selectedMovePercent: move,
        selectedThreshold: hit.threshold,
        selectedDirection: dir,
      },
      measureNote: next.exactLabel
        ? `Manual start on window “${key}” · exact span ${next.exactLabel}. Move % = ((live − reference) / reference) × 100.`
        : `Manual start on window “${key}”. Move % = ((live − reference) / reference) × 100.`,
    },
  })
  events.push(ev)
  store.pushEvent(symbol, ev)
  store.upsertHistoryEpisode(symbol, next)
  logs.push(
    `[${symbol} MOMENTUM] manual episode start · ${dir} on ${key} ${fmt(move)}${
      next.exactLabel ? ` · exact ${next.exactLabel}` : ''
    }`,
  )
  store.pushLog(
    symbol,
    'success',
    `Manual START · ${dir} on ${key} ${fmt(move)}`,
    'episode',
  )

  return {
    ok: true,
    episode: next,
    events,
    logs,
    closedEpisode: null,
  }
}
