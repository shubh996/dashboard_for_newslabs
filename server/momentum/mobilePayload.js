/**
 * Canonical mobile-facing payloads for momentum episodes + timeline events.
 * Everything the app needs to render: status, calc, notification copy, push.
 */
import { sessionDisplayLabel } from './notifyCopy.js'

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s || null
}

function iso(v) {
  if (!v) return null
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * Episode move % from frozen reference (same formula as engine).
 * @param {number|null} live
 * @param {number|null} ref
 */
export function calcMovePercent(live, ref) {
  const p = num(live)
  const r = num(ref)
  if (p == null || r == null || r === 0) return null
  return ((p - r) / r) * 100
}

/**
 * Giveback 0–1 from prices (UP: peak vs ref; DOWN: trough vs ref).
 */
export function calcGivebackRatio(ep, livePrice) {
  const ref = num(ep?.referencePrice ?? ep?.reference_price)
  const live = num(livePrice ?? ep?.currentPrice ?? ep?.current_price)
  const dir = String(ep?.direction || 'UP').toUpperCase()
  if (ref == null || live == null) return null
  if (dir === 'DOWN') {
    const trough = num(ep?.troughPrice ?? ep?.trough_price ?? live)
    const drop = ref - trough
    if (!(drop > 0)) return 0
    return Math.max(0, (live - trough) / drop)
  }
  const peak = num(ep?.peakPrice ?? ep?.peak_price ?? live)
  const gain = peak - ref
  if (!(gain > 0)) return 0
  return Math.max(0, (peak - live) / gain)
}

/**
 * Human calc explanation for mobile.
 */
export function buildMeasureExplain(ep, livePrice, movePercent) {
  const dir = String(ep?.direction || 'UP').toUpperCase()
  const ref = num(ep?.referencePrice ?? ep?.reference_price)
  const live = num(livePrice ?? ep?.currentPrice)
  const peak = num(ep?.peakPrice)
  const trough = num(ep?.troughPrice)
  const move = num(movePercent ?? ep?.currentMovePercent)
  const gb = calcGivebackRatio(ep, live)
  const exactLabel = str(ep?.exactLabel || ep?.exact_label)
  const windowKey = str(ep?.detectedWindow || ep?.windowType || ep?.detected_window)

  const lines = []
  if (ref != null && live != null && move != null) {
    lines.push(
      `Move % = ((live ${live} − reference ${ref}) / reference ${ref}) × 100 ≈ ${move.toFixed(2)}%`,
    )
  }
  if (dir === 'UP' && peak != null && ref != null && live != null && gb != null) {
    lines.push(
      `Giveback % = ((peak ${peak} − live ${live}) / (peak ${peak} − reference ${ref})) × 100 ≈ ${(gb * 100).toFixed(1)}%`,
    )
  }
  if (dir === 'DOWN' && trough != null && ref != null && live != null && gb != null) {
    lines.push(
      `Giveback % = ((live ${live} − trough ${trough}) / (reference ${ref} − trough ${trough})) × 100 ≈ ${(gb * 100).toFixed(1)}%`,
    )
  }
  if (windowKey) {
    lines.push(
      exactLabel
        ? `Window key “${windowKey}” · exact span ${exactLabel}`
        : `Window key “${windowKey}”`,
    )
  }
  return {
    formulaLines: lines,
    movePercent: move,
    givebackPercent: gb != null ? gb * 100 : null,
    givebackRatio: gb,
    windowKey,
    exactLabel,
    exactMinutes: num(ep?.exactMinutes ?? ep?.exact_minutes),
    referencePrice: ref,
    referenceTime: iso(ep?.referenceTime ?? ep?.reference_time),
    livePrice: live,
    peakPrice: peak,
    troughPrice: trough,
    peakMovePercent: num(ep?.peakMovePercent),
    direction: dir,
  }
}

/**
 * Full episode snapshot for mobile (stored in momentum_episodes.payload).
 */
export function buildMobileEpisodePayload(ep) {
  if (!ep || typeof ep !== 'object') return {}
  const live = num(ep.currentPrice)
  const measure = buildMeasureExplain(ep, live, ep.currentMovePercent)
  const status = str(ep.status) || 'ACTIVE'
  const state = str(ep.state) || null

  return {
    // Identity (immutable after STARTED)
    schemaVersion: 2,
    episodeId: str(ep.episodeId || ep.episode_id),
    episodeNo: num(ep.episodeNo ?? ep.episode_no),
    ticker: str(ep.ticker)?.toUpperCase() || null,
    direction: str(ep.direction) || 'UP',
    windowType: str(ep.windowType || ep.detectedWindow || ep.detected_window),
    detectedWindow: str(ep.detectedWindow || ep.windowType || ep.detected_window),
    windowMinutes: num(ep.windowMinutes ?? ep.window_minutes),
    exactMinutes: num(ep.exactMinutes ?? ep.exact_minutes),
    exactLabel: str(ep.exactLabel || ep.exact_label),
    referencePrice: num(ep.referencePrice ?? ep.reference_price),
    referenceTime: iso(ep.referenceTime ?? ep.reference_time),
    triggerPrice: num(ep.triggerPrice ?? ep.trigger_price),
    triggerTime: iso(ep.triggerTime || ep.episodeStartedAt),
    triggerMovePct: num(
      ep.triggerMovePct ?? ep.initialMovePercent ?? ep.initial_move_percent,
    ),
    episodeStartedAt: iso(ep.episodeStartedAt || ep.triggerTime),
    episodeStartPrice: num(ep.episodeStartPrice ?? ep.triggerPrice),

    // Live / last known
    status,
    state,
    currentPrice: live,
    currentTime: iso(ep.currentTime),
    currentMovePercent: num(ep.currentMovePercent ?? ep.current_move_percent),
    peakMovePercent: num(ep.peakMovePercent ?? ep.peak_move_percent),
    peakPrice: num(ep.peakPrice ?? ep.peak_price),
    peakTime: iso(ep.peakTime),
    troughPrice: num(ep.troughPrice ?? ep.trough_price),
    troughTime: iso(ep.troughTime),
    initialMovePercent: num(ep.initialMovePercent ?? ep.initial_move_percent),
    endedAt: iso(ep.endedAt || ep.ended_at),
    endReason: str(ep.endReason || ep.end_reason),

    // Notify anchors
    lastAlertMovePercent: num(ep.lastAlertMovePercent),
    lastAlertAt: iso(ep.lastAlertAt),
    lastNotifiedEpisodeMovePct: num(ep.lastNotifiedEpisodeMovePct),
    lastNotifiedPrice: num(ep.lastNotifiedPrice),
    lastNotifiedTime: iso(ep.lastNotifiedTime),
    lastMaterialProgressAt: iso(ep.lastMaterialProgressAt),

    // Cycle flags (for debugging / mobile advanced)
    strongWeakeningPushSentInCycle: Boolean(ep.strongWeakeningPushSentInCycle),
    awaitingReAcceleration: Boolean(ep.awaitingReAcceleration),
    hadReAcceleration: Boolean(ep.hadReAcceleration),

    // Last user-facing alert (filled when push completes)
    lastNotification: ep.lastNotification || null,

    // How to render the numbers
    measure,
    display: {
      headlineMove: num(ep.currentMovePercent ?? ep.peakMovePercent),
      headlinePeak: num(ep.peakMovePercent),
      headlineGivebackPct: measure.givebackPercent,
      // Day episodes: exactLabel is "pre-market" / "after-hours" / "today"
      windowLabel: str(ep.exactLabel || ep.detectedWindow),
      sessionLabel: sessionDisplayLabel(ep.marketSession),
      statusLabel: status,
      stateLabel: state,
    },

    // Keep any extra engine fields
    marketSession: str(ep.marketSession),
    assetClass: str(ep.assetClass),
  }
}

/**
 * Full timeline event for mobile (stored in momentum_episode_events.payload).
 * @param {Record<string, unknown>} ev
 * @param {Record<string, unknown>|null} [episode]
 */
export function buildMobileEventPayload(ev, episode = null) {
  if (!ev || typeof ev !== 'object') return {}
  const ep = episode && typeof episode === 'object' ? episode : null
  const dir = str(ev.direction || ep?.direction) || 'UP'
  const move = num(ev.movePercent ?? ev.move_percent)
  const price = num(ev.price)
  const windowKey = str(ev.detectedWindow || ev.detected_window || ep?.detectedWindow)
  const measure = buildMeasureExplain(
    {
      direction: dir,
      referencePrice: ev.referencePrice ?? ep?.referencePrice,
      referenceTime: ev.referenceTime ?? ep?.referenceTime,
      peakPrice: ev.peakPrice ?? ep?.peakPrice,
      troughPrice: ev.troughPrice ?? ep?.troughPrice,
      peakMovePercent: ev.peakMovePercent ?? ep?.peakMovePercent,
      currentMovePercent: move,
      exactMinutes: ev.exactMinutes ?? ep?.exactMinutes,
      exactLabel: ev.exactLabel ?? ep?.exactLabel,
      detectedWindow: windowKey,
      currentPrice: price,
    },
    price,
    move,
  )

  const notification =
    ev.notification && typeof ev.notification === 'object'
      ? {
          title: str(ev.notification.title),
          body: str(ev.notification.body),
        }
      : null

  const pushResult =
    ev.pushResult && typeof ev.pushResult === 'object' ? { ...ev.pushResult } : null

  const research =
    ev.research && typeof ev.research === 'object'
      ? {
          status: str(ev.research.status),
          mode: str(ev.research.mode),
          reason: str(ev.research.reason),
          likely_driver: str(ev.research.likely_driver),
          provider: str(ev.research.provider),
          model: str(ev.research.model),
          startedAt: iso(ev.research.startedAt),
          completedAt: iso(ev.research.completedAt),
          citations: Array.isArray(ev.research.citations)
            ? ev.research.citations
            : [],
          search_results: Array.isArray(ev.research.search_results)
            ? ev.research.search_results
            : [],
        }
      : null

  return {
    schemaVersion: 2,
    // Core event
    eventType: str(ev.eventType || ev.event_type),
    state: str(ev.state || ev.reason),
    previousState: str(ev.previousState),
    reason: str(ev.reason),
    shouldNotify: Boolean(ev.shouldNotify),
    direction: dir,
    ticker: str(ev.ticker || ep?.ticker)?.toUpperCase() || null,
    episodeId: str(ev.episodeId || ev.episode_id || ep?.episodeId),
    episodeNo: num(ev.episodeNo ?? ev.episode_no ?? ep?.episodeNo),
    detectedAt: iso(ev.detectedAt || ev.detected_at),
    notifiedAt: iso(ev.notifiedAt),
    marketSession: str(ev.marketSession || ep?.marketSession),
    sessionLabel: sessionDisplayLabel(ev.marketSession || ep?.marketSession),

    // Movement (episode-basis)
    movePercent: move,
    price,
    peakMovePercent: num(ev.peakMovePercent ?? ep?.peakMovePercent),
    peakPrice: num(ev.peakPrice ?? ep?.peakPrice),
    troughPrice: num(ev.troughPrice ?? ep?.troughPrice),
    initialMovePercent: num(ev.initialMovePercent ?? ep?.initialMovePercent),
    triggerMovePct: num(ev.triggerMovePct ?? ep?.triggerMovePct ?? ep?.initialMovePercent),
    triggerPrice: num(ev.triggerPrice ?? ep?.triggerPrice),
    extensionPp: num(ev.extensionPp),
    givebackRatio: num(ev.givebackRatio ?? measure.givebackRatio),
    givebackPct: num(ev.givebackPct ?? measure.givebackPercent),

    // Window / span
    detectedWindow: windowKey,
    windowType: windowKey,
    windowMinutes: num(ev.windowMinutes ?? ep?.windowMinutes),
    exactMinutes: num(ev.exactMinutes ?? ep?.exactMinutes),
    exactLabel: str(ev.exactLabel || ep?.exactLabel),
    startExactMinutes: num(ev.startExactMinutes),
    startExactLabel: str(ev.startExactLabel),
    referencePrice: num(ev.referencePrice ?? ep?.referencePrice),
    referenceTime: iso(ev.referenceTime ?? ep?.referenceTime),

    // Notify anchors on event
    lastNotifiedPrice: num(ev.lastNotifiedPrice),
    lastNotifiedTime: iso(ev.lastNotifiedTime),
    lastNotifiedEpisodeMovePct: num(ev.lastNotifiedEpisodeMovePct),
    previousAlertMovePercent: num(ev.previousAlertMovePercent),
    recoveryAnchorMovePercent: num(ev.recoveryAnchorMovePercent),
    remainingMovePercent: num(ev.remainingMovePercent),

    // User-facing alert
    notification,
    notificationTitle: notification?.title || null,
    notificationBody: notification?.body || null,
    pushResult,
    eligibleDeviceCount: num(ev.eligibleDeviceCount),
    eligibleDevices: Array.isArray(ev.eligibleDevices) ? ev.eligibleDevices : [],

    // Research
    research,
    likely_driver: str(ev.likely_driver || research?.likely_driver),

    // Calc dump for mobile “how was this calculated?”
    measure,
    measureNote: str(ev.measureNote),
    terminal: Boolean(ev.terminal),
    accelKind: str(ev.accelKind),

    // Episode status snapshot at event time (if available)
    episodeStatus: str(ep?.status),
    episodeState: str(ep?.state || ev.state),
  }
}

/**
 * Merge engine episode with mobile DTO for payload column.
 */
export function episodePayloadForSupabase(ep) {
  const mobile = buildMobileEpisodePayload(ep)
  // Spread engine fields first, then mobile overwrites with canonical keys
  return {
    ...(ep && typeof ep === 'object' ? ep : {}),
    ...mobile,
    mobile,
  }
}

/**
 * Merge engine event with mobile DTO for payload column.
 */
export function eventPayloadForSupabase(ev, episode = null) {
  const mobile = buildMobileEventPayload(ev, episode)
  return {
    ...(ev && typeof ev === 'object' ? ev : {}),
    ...mobile,
    mobile,
  }
}
