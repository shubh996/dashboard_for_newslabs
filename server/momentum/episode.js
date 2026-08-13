/**
 * Trigger episode state machine (V1).
 *
 * One active episode per ticker. Backend states change often; pushes only on
 * START, material ACCELERATION (≥1.5 pp beyond last notified), and REVERSAL.
 * HOLDING / WEAKENING / tiny re-accel / expiry / market-close are silent.
 *
 * @see Trigger_Episode_Alert_Notification_Logic_v1.docx
 */
import {
  ACCELERATION_ALERT_DELTA_PP,
  EPISODE_INACTIVITY_EXPIRY_MIN,
  HOLDING_TO_WEAKENING_GIVEBACK,
  MAJOR_FADE_ALERT_ENABLED,
  MATERIAL_PROGRESS_DELTA_PP,
  MOMENTUM_TICKER,
  STARTED_STATE_MIN_DWELL_MS,
  STRONG_WEAKENING_GIVEBACK,
  WEAKENING_TO_HOLDING_GIVEBACK,
} from './config.js'
import {
  anyThresholdActive,
  findThresholdCrosses,
  oppositeThresholdHit,
} from './detector.js'
import { classifyMomentumAsset } from './candles.js'
import { movePercent } from './returns.js'
import { buildNotificationCopy, isPushWorthy } from './notifyCopy.js'

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

/**
 * Classify HOLDING / WEAKENING / STRONGLY_WEAKENING with hysteresis.
 * @param {number} givebackRatio
 * @param {EpisodeState|null} prevState
 */
export function classifyGivebackState(givebackRatio, prevState = null) {
  const g = Number(givebackRatio) || 0
  const toWeak = HOLDING_TO_WEAKENING_GIVEBACK
  const toHold = WEAKENING_TO_HOLDING_GIVEBACK
  const toStrong = STRONG_WEAKENING_GIVEBACK

  if (g >= toStrong) return 'STRONGLY_WEAKENING'
  if (g >= toWeak) return 'WEAKENING'
  // Hysteresis band [toHold, toWeak): keep previous weakening if we were there
  if (g >= toHold) {
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

  const base = {
    ticker,
    direction,
    eventType,
    price,
    movePercent: move,
    windowMinutes: windowMinutesFromKey(detectedWindow),
    detectedWindow,
    detectedAt: nowIso,
    marketSession,
    reason: reasonFinal,
    shouldNotify: push,
    previousAlertMovePercent,
    ...extra,
  }

  if (push) {
    const copy = buildNotificationCopy({
      ...base,
      episode,
    })
    if (copy) base.notification = copy
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
    reversalNotified: false,
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
 * Meaningful progress: new extreme ≥ MATERIAL_PROGRESS_DELTA_PP beyond prior.
 * @param {MomentumEpisode} next
 * @param {string} nowIso
 * @param {string[]} logs
 */
function maybeRecordMaterialProgress(next, nowIso, logs) {
  const cur = Math.abs(Number(next.currentMovePercent) || 0)
  const prev = Math.abs(Number(next.meaningfulExtremeMovePct) || 0)
  if (cur - prev >= MATERIAL_PROGRESS_DELTA_PP) {
    next.meaningfulExtremeMovePct = next.currentMovePercent
    next.lastMaterialProgressAt = nowIso
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
  marketSession,
  nowIso = new Date().toISOString(),
  forceMarketClose = false,
  assetClass = null,
}) {
  const symbol = String(ticker || MOMENTUM_TICKER).toUpperCase()
  /** @type {object[]} */
  const events = []
  /** @type {string[]} */
  const logs = []
  const hits = findThresholdCrosses(returns || {})
  const thresholdCrossed = hits.length > 0
  let next = episode ? { ...episode } : null

  // ── Market close hard archive (equities only) ──────────────────
  // Stocks/indexes: do not carry an intraday episode into the next session.
  // Commodities/futures, crypto, forex keep longer sessions — inactivity
  // expiry only (no hard close on US equity cash-session CLOSED).
  const session = String(marketSession || '').toUpperCase()
  const resolvedAssetClass =
    assetClass || classifyMomentumAsset(symbol) || 'equity'
  const isEquityForMarketClose = resolvedAssetClass === 'equity'

  if (
    next &&
    next.status === 'ACTIVE' &&
    (forceMarketClose || (session === 'CLOSED' && isEquityForMarketClose))
  ) {
    logs.push(
      `[${symbol} MOMENTUM] episode closed at market close (silent)`,
    )
    next = {
      ...next,
      status: 'CLOSED_AT_MARKET_CLOSE',
      endedAt: nowIso,
      endReason: 'MARKET_CLOSE',
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
        reason: 'MARKET_CLOSE',
        shouldNotify: false,
        episode: next,
      }),
    )
    return { episode: null, events, logs }
  }

  // ── No active episode ──────────────────────────────────────────
  if (!next || next.status !== 'ACTIVE') {
    if (!thresholdCrossed || !hits[0]) {
      return { episode: null, events, logs }
    }
    const hit = hits[0]
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
    })

    const ev = makeEvent({
      ticker: symbol,
      direction: hit.direction,
      eventType: 'MOMENTUM_STARTED',
      price: currentPrice,
      movePercent: next.currentMovePercent,
      detectedWindow: hit.window,
      nowIso,
      marketSession: session,
      // No auto-push on start — run Perplexity for the reason, then alert.
      shouldNotify: false,
      episode: next,
      extra: {
        state: 'STARTED',
        referencePrice: next.referencePrice ?? null,
        referenceTime: next.referenceTime ?? null,
        triggerPrice: next.triggerPrice ?? null,
        episodeStartPrice: next.episodeStartPrice ?? null,
        initialMovePercent: next.initialMovePercent ?? null,
        measureNote:
          'Start move % = ((trigger/live price − window reference price) / reference price) × 100 on the detected window.',
      },
    })
    events.push(ev)
    logs.push(
      `[${symbol} MOMENTUM] threshold crossed: ${hit.window} ${fmt(hit.movePercent)}`,
    )
    logs.push(
      `[${symbol} MOMENTUM] episode started: ${hit.direction} (auto Perplexity + alert next)`,
    )
    return { episode: next, events, logs }
  }

  // ── Active episode ─────────────────────────────────────────────
  next.ticker = symbol
  updateExtremes(next, currentPrice, nowIso)
  maybeRecordMaterialProgress(next, nowIso, logs)

  // Reversal: original move erased AND opposite entry detector fires
  const reverseHit = oppositeThresholdHit(returns || {}, next.direction)
  const erased = originalMoveErased(
    next.direction,
    currentPrice,
    Number(next.referencePrice),
  )

  if (reverseHit && erased && !next.reversalNotified) {
    const oldDir = next.direction
    logs.push(
      `[${symbol} MOMENTUM] episode reversed (${oldDir} → ${reverseHit.direction})`,
    )
    next.reversalNotified = true
    next.status = 'REVERSED'
    next.state = 'REVERSAL'
    next.endedAt = nowIso
    next.endReason = 'REVERSAL'

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
        shouldNotify: true,
        episode: next,
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
        episode: next,
      }),
    )

    // Fresh opposite episode from the reverse hit
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
    })
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
      }),
    )
    logs.push(
      `[${symbol} MOMENTUM] episode started: ${reverseHit.direction} (silent after reverse)`,
    )
    return { episode: started, events, logs }
  }

  // Giveback-based internal state (no auto-reversal on 50% fade)
  const giveback = computeGivebackRatio(next, currentPrice)
  const givebackState = classifyGivebackState(giveback, next.state)

  const lastNotifiedAbs = Math.abs(Number(next.lastNotifiedEpisodeMovePct) || 0)
  const currentAbs = Math.abs(Number(next.currentMovePercent) || 0)
  const extensionPp = currentAbs - lastNotifiedAbs
  const materialAccel = extensionPp >= ACCELERATION_ALERT_DELTA_PP

  // Prefer same-direction extreme for "accelerating" vs re-accel after fade
  const atOrNearExtreme =
    next.direction === 'UP'
      ? next.peakPrice != null &&
        currentPrice >= Number(next.peakPrice) * 0.999
      : next.troughPrice != null &&
        currentPrice <= Number(next.troughPrice) * 1.001

  /**
   * State lifecycle (dashboard labels; pushes only on material ACCEL / REVERSAL):
   *
   *   STARTED → (dwell) HOLDING
   *   HOLDING → WEAKENING (giveback) | ACCELERATING (material +1.5pp push path)
   *             small noise / tiny +0.0x pp stays HOLDING — never RE_ACCELERATING
   *   WEAKENING → RE_ACCELERATING when strength returns (not yet push)
   *   RE_ACCELERATING → push when materialAccel, or back to WEAKENING if fade resumes
   *
   * RE_ACCELERATING only after a real fade (WEAKENING / STRONG / already RE_ACCEL).
   * HOLDING must NOT jump to RE_ACCELERATING on +0.03pp noise.
   */
  const prevState = next.state
  const fromFade =
    prevState === 'WEAKENING' ||
    prevState === 'STRONGLY_WEAKENING' ||
    prevState === 'RE_ACCELERATING'

  if (materialAccel && atOrNearExtreme) {
    // Push-worthy extension: first-leg ACCELERATING, post-fade RE_ACCELERATING
    next.state = fromFade ? 'RE_ACCELERATING' : 'ACCELERATING'
  } else if (fromFade) {
    if (givebackState === 'WEAKENING' || givebackState === 'STRONGLY_WEAKENING') {
      next.state = givebackState
    } else {
      // Giveback healed and/or price ticking up from a fade — re-accel label
      // (still silent until materialAccel)
      next.state = 'RE_ACCELERATING'
    }
  } else if (prevState === 'HOLDING') {
    // Only leave HOLDING via fade (giveback) or material accel (above).
    // Tiny new highs (+0.03pp) stay HOLDING.
    next.state = givebackState
  } else if (prevState === 'STARTED') {
    // After open: settle to giveback label (usually HOLDING) once dwell allows
    next.state = givebackState
  } else if (prevState === 'ACCELERATING') {
    // After an accel push/label, quiet ticks settle via giveback
    next.state = givebackState
  } else {
    next.state = givebackState
  }

  // STARTED dwell: keep STARTED for ~1 poll interval before silent HOLDING.
  // Material ACCELERATING already applied above and is allowed immediately.
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

  // Optional major-fade alert (feature flag; off in V1)
  if (
    MAJOR_FADE_ALERT_ENABLED &&
    next.state === 'STRONGLY_WEAKENING' &&
    !next._majorFadeNotified
  ) {
    next._majorFadeNotified = true
    // reserved for future push
  }

  /**
   * Silent state-timeline row for the Recent Events rail.
   * HOLDING / WEAKENING / RE_ACCELERATING never push, but the UI must show them.
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
          // Measure context for the Recent Events explain panel
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

  // Material acceleration push (≥1.5 pp beyond last notified)
  if (materialAccel) {
    const prevNotified = next.lastNotifiedEpisodeMovePct
    logs.push(
      `[${symbol} MOMENTUM] acceleration detected: ${fmt(prevNotified)} -> ${fmt(next.currentMovePercent)}`,
    )
    const prevPrice = next.lastNotifiedPrice
    const prevTime = next.lastNotifiedTime
    // HOLDING/STARTED → ACCELERATING; only post-fade → RE_ACCELERATING
    const accelState = fromFade ? 'RE_ACCELERATING' : 'ACCELERATING'
    next.state = accelState
    // Timeline: show re-accel / accel transition before the push event
    emitStateRow(prevState, accelState)
    events.push(
      makeEvent({
        ticker: symbol,
        direction: next.direction,
        eventType: 'MOMENTUM_ACCELERATING',
        price: currentPrice,
        movePercent: next.currentMovePercent,
        detectedWindow: next.detectedWindow,
        nowIso,
        marketSession: session,
        shouldNotify: true,
        previousAlertMovePercent: prevNotified,
        episode: {
          ...next,
          // copy builder needs last-notified *before* update
          lastNotifiedPrice: prevPrice,
          lastNotifiedTime: prevTime,
          lastNotifiedEpisodeMovePct: prevNotified,
        },
        extra: {
          state: accelState,
          referencePrice: next.referencePrice ?? null,
          referenceTime: next.referenceTime ?? null,
          lastNotifiedPrice: prevPrice ?? null,
          lastNotifiedTime: prevTime ?? null,
          lastNotifiedEpisodeMovePct: prevNotified ?? null,
          peakMovePercent: next.peakMovePercent ?? null,
          peakPrice: next.peakPrice ?? null,
          extensionPp:
            Number.isFinite(Number(next.currentMovePercent)) &&
            Number.isFinite(Number(prevNotified))
              ? Math.abs(Number(next.currentMovePercent)) -
                Math.abs(Number(prevNotified))
              : null,
          measureNote:
            'Acceleration when |episode move| extends ≥1.5 pp beyond last notified move. Episode move still uses reference price; extension is vs last alert level.',
        },
      }),
    )
    next.lastAlertMovePercent = next.currentMovePercent
    next.lastAlertAt = nowIso
    next.lastNotifiedPrice = currentPrice
    next.lastNotifiedTime = nowIso
    next.lastNotifiedEpisodeMovePct = next.currentMovePercent
    next.belowThresholdSince = null
    return { episode: next, events, logs }
  }

  // Silent path: holding / weakening / tiny re-accel — still record state for UI
  emitStateRow(prevState, next.state)

  if (next.state === 'HOLDING' || next.state === 'WEAKENING' || next.state === 'STRONGLY_WEAKENING') {
    logs.push(
      `[${symbol} MOMENTUM] state=${next.state} giveback=${(giveback * 100).toFixed(1)}% (no push)`,
    )
  } else if (next.state === 'RE_ACCELERATING' || next.state === 'ACCELERATING') {
    logs.push(
      `[${symbol} MOMENTUM] ignored sub-milestone move · ext=${extensionPp.toFixed(2)}pp`,
    )
  } else {
    logs.push(`[${symbol} MOMENTUM] ignored duplicate movement`)
  }

  // 60-min expiry without meaningful progress (silent)
  const progressAt = next.lastMaterialProgressAt || next.triggerTime || next.episodeStartedAt
  const progressMs = Date.parse(nowIso) - Date.parse(progressAt)
  const limitMs = EPISODE_INACTIVITY_EXPIRY_MIN * 60_000
  if (Number.isFinite(progressMs) && progressMs >= limitMs) {
    next.status = 'EXPIRED'
    next.endedAt = nowIso
    next.endReason = 'EXPIRED'
    logs.push(
      `[${symbol} MOMENTUM] episode expired (no meaningful progress ${EPISODE_INACTIVITY_EXPIRY_MIN}m)`,
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
        reason: 'EXPIRED',
        shouldNotify: false,
        episode: next,
      }),
    )
    return { episode: null, events, logs }
  }

  return { episode: next, events, logs }
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return 'n/a'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}
