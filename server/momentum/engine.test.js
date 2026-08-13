/**
 * Run: node --test server/momentum/engine.test.js
 *
 * Includes V1 acceptance tests AT-01…AT-15 from
 * Trigger_Episode_Alert_Notification_Logic_v1.docx
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateMomentumFromCandles } from './engine.js'
import { computeRollingReturns, movePercent } from './returns.js'
import { findThresholdCrosses } from './detector.js'
import {
  advanceEpisode,
  classifyGivebackState,
  computeGivebackRatio,
  originalMoveErased,
} from './episode.js'
import { buildNotificationCopy, isPushWorthy } from './notifyCopy.js'
import * as store from './store.js'
import { candleAtOrBefore } from './candles.js'
import {
  ACCELERATION_ALERT_DELTA_PP,
  EPISODE_INACTIVITY_EXPIRY_MIN,
  MATERIAL_PROGRESS_DELTA_PP,
} from './config.js'

function series(prices, intervalMs = 60_000, endMs = Date.now()) {
  return prices.map((close, i) => ({
    t: endMs - (prices.length - 1 - i) * intervalMs,
    close,
  }))
}

/** Helper: open an UP episode at given price/move via synthetic returns */
function startUp(opts = {}) {
  const price = opts.currentPrice ?? 103.1
  const ref = opts.referencePrice ?? 100
  const move = movePercent(price, ref)
  return advanceEpisode({
    ticker: opts.ticker || 'SNDK',
    episode: null,
    returns: { '5m': move, '15m': 1, '30m': 1, '60m': 1, day: 2 },
    strongest: { window: '5m', movePercent: move, direction: 'UP' },
    currentPrice: price,
    referencePrice: ref,
    referenceTime: opts.referenceTime || '2026-01-01T13:00:00.000Z',
    references: { '5m': ref },
    referenceTimes: { '5m': opts.referenceTime || '2026-01-01T13:00:00.000Z' },
    marketSession: 'REGULAR',
    nowIso: opts.nowIso || '2026-01-01T13:10:00.000Z',
  })
}

describe('movePercent / candles', () => {
  it('computes percent', () => {
    assert.equal(movePercent(103, 100), 3)
    assert.equal(movePercent(97, 100), -3)
    assert.equal(movePercent(100, 0), null)
  })

  it('candleAtOrBefore picks floor', () => {
    const c = series([1, 2, 3], 60_000, 1_000_000)
    assert.equal(candleAtOrBefore(c, 1_000_000 - 60_000)?.close, 2)
    assert.equal(candleAtOrBefore(c, 0), null)
  })
})

describe('rolling returns', () => {
  it('5m return from synthetic 1m bars', () => {
    const end = Date.UTC(2026, 0, 15, 16, 0, 0)
    const prices = [100, 100.5, 101, 101.5, 102, 103]
    const candles = series(prices, 60_000, end)
    const { returns } = computeRollingReturns(candles, 103, end, 95)
    assert.ok(returns['5m'] != null)
    assert.ok(Math.abs(returns['5m'] - 3) < 0.01)
    assert.ok(returns.day != null)
    assert.ok(Math.abs(returns.day - ((103 - 95) / 95) * 100) < 0.01)
  })

  it('returns null when lookback has no candle', () => {
    const end = Date.now()
    const candles = series([100, 101], 60_000, end)
    const { returns } = computeRollingReturns(candles, 101, end, null)
    assert.equal(returns['60m'], null)
  })
})

describe('threshold detector', () => {
  it('hits 5m and day', () => {
    const hits = findThresholdCrosses({
      '1m': 0.2,
      '5m': 3.2,
      '15m': 1,
      '30m': 1,
      '60m': 1,
      day: 5.5,
    })
    assert.ok(hits.some((h) => h.window === '5m'))
    assert.ok(hits.some((h) => h.window === 'day'))
  })

  it('no hit below threshold', () => {
    const hits = findThresholdCrosses({
      '5m': 2.9,
      '15m': 2.9,
      '30m': 3.9,
      '60m': 4.9,
      day: 4.9,
    })
    assert.equal(hits.length, 0)
  })
})

describe('giveback / hysteresis helpers', () => {
  it('computes giveback for UP episode', () => {
    const ep = {
      direction: 'UP',
      referencePrice: 100,
      peakPrice: 105.2,
    }
    const g = computeGivebackRatio(ep, 104.2)
    assert.ok(Math.abs(g - 1 / 5.2) < 0.001)
  })

  it('hysteresis band keeps WEAKENING', () => {
    assert.equal(classifyGivebackState(0.1, 'HOLDING'), 'HOLDING')
    assert.equal(classifyGivebackState(0.25, 'HOLDING'), 'WEAKENING')
    assert.equal(classifyGivebackState(0.22, 'WEAKENING'), 'WEAKENING')
    assert.equal(classifyGivebackState(0.19, 'WEAKENING'), 'HOLDING')
    assert.equal(classifyGivebackState(0.65, null), 'STRONGLY_WEAKENING')
  })

  it('original move erased only at/past reference', () => {
    assert.equal(originalMoveErased('UP', 99, 100), true)
    assert.equal(originalMoveErased('UP', 101, 100), false)
    assert.equal(originalMoveErased('DOWN', 101, 100), true)
    assert.equal(originalMoveErased('DOWN', 99, 100), false)
  })
})

describe('notification copy', () => {
  it('START upward copy', () => {
    const copy = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 3.1,
      detectedAt: '2026-01-01T13:10:00.000Z',
      episode: {
        referenceTime: '2026-01-01T13:00:00.000Z',
      },
    })
    // 🟢 SNDK +3.1% in last 10 minutes
    assert.ok(copy?.title.includes('🟢'))
    assert.ok(copy?.title.includes('SNDK'))
    assert.ok(copy?.title.includes('+3.1%'))
    assert.ok(copy?.title.includes('in last 10 minutes'))
    assert.ok(!copy?.title.toLowerCase().includes('sandisk'))
  })

  it('START title lookback bands + body is likely driver only', () => {
    const m42 = buildNotificationCopy({
      ticker: 'AAPL',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 2.5,
      exactMinutes: 42,
    })
    assert.ok(m42?.title.includes('in last 42 minutes'))

    const m90 = buildNotificationCopy({
      ticker: 'AAPL',
      eventType: 'MOMENTUM_STARTED',
      direction: 'DOWN',
      movePercent: -1.5,
      exactMinutes: 90,
    })
    assert.ok(m90?.title.includes('🔴'))
    assert.ok(m90?.title.includes('1H30M'))
    assert.ok(!m90?.title.includes('in last 1H'))

    const m180 = buildNotificationCopy({
      ticker: 'AAPL',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 4,
      exactMinutes: 180,
    })
    assert.ok(m180?.title.includes('in last 3 hours'))

    const withDriver = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 5,
      exactMinutes: 20,
      likelyDriver: 'Strong bid after guidance raise.',
    })
    assert.equal(withDriver?.body, 'Strong bid after guidance raise.')
  })

  it('acceleration uses since-last and total', () => {
    const copy = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_ACCELERATING',
      direction: 'UP',
      movePercent: 5.2,
      price: 105.2,
      detectedAt: '2026-01-01T13:18:00.000Z',
      episode: {
        referencePrice: 100,
        referenceTime: '2026-01-01T13:00:00.000Z',
        lastNotifiedPrice: 103.1,
        lastNotifiedTime: '2026-01-01T13:10:00.000Z',
        lastNotifiedEpisodeMovePct: 3.1,
      },
    })
    assert.ok(copy?.title.toLowerCase().includes('adds another'))
    assert.ok(copy?.body.toLowerCase().includes('surge'))
    assert.ok(copy?.body.includes('+5.2%') || copy?.body.includes('5.2%'))
  })

  it('push policy', () => {
    // STARTED needs Perplexity reason first → no auto-push
    assert.equal(isPushWorthy('MOMENTUM_STARTED'), false)
    assert.equal(isPushWorthy('MOMENTUM_ACCELERATING'), true)
    assert.equal(isPushWorthy('MOMENTUM_REVERSED'), true)
    assert.equal(isPushWorthy('MOMENTUM_ENDED', 'EXPIRED'), false)
    assert.equal(isPushWorthy('MOMENTUM_ENDED', 'MARKET_CLOSE'), false)
    assert.equal(isPushWorthy('MOMENTUM_ENDED', 'REVERSAL'), true)
  })
})

describe('episode state machine (legacy smoke)', () => {
  beforeEach(() => store.resetStore())

  it('starts on positive threshold', () => {
    const { episode, events } = startUp()
    assert.equal(episode?.direction, 'UP')
    assert.equal(episode?.status, 'ACTIVE')
    assert.equal(episode?.state, 'STARTED')
    assert.equal(events[0]?.eventType, 'MOMENTUM_STARTED')
    assert.equal(events[0]?.shouldNotify, false)
  })

  it('starts on negative threshold', () => {
    const { episode, events } = advanceEpisode({
      episode: null,
      returns: { '5m': -3.4, '15m': -1, '30m': -1, '60m': -1, day: -2 },
      strongest: { window: '5m', movePercent: -3.4, direction: 'DOWN' },
      currentPrice: 80,
      referencePrice: 83,
      marketSession: 'REGULAR',
    })
    assert.equal(episode?.direction, 'DOWN')
    assert.equal(events[0]?.eventType, 'MOMENTUM_STARTED')
  })

  it('suppresses small duplicate moves', () => {
    const started = startUp({ currentPrice: 103.1, referencePrice: 100 })
    const again = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 3.4, day: 2.1 },
      strongest: { window: '5m', movePercent: 3.4, direction: 'UP' },
      currentPrice: 103.4,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:12:00.000Z',
    })
    // Never a push on sub-threshold noise
    assert.equal(again.events.filter((e) => e.shouldNotify).length, 0)
    assert.equal(again.episode?.status, 'ACTIVE')
  })

  it('keeps STARTED for min dwell before silent HOLDING', () => {
    const started = startUp({
      currentPrice: 103.1,
      referencePrice: 100,
      nowIso: '2026-01-01T13:10:00.000Z',
    })
    assert.equal(started.episode?.state, 'STARTED')
    // ~14s later (UI focus tick) — still STARTED, not HOLDING
    const soon = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 3.1, day: 2.1 },
      strongest: { window: '5m', movePercent: 3.1, direction: 'UP' },
      currentPrice: 103.1,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:10:14.000Z',
    })
    assert.equal(soon.episode?.state, 'STARTED')
    assert.equal(
      soon.events.filter((e) => e.eventType === 'MOMENTUM_STATE' && e.state === 'HOLDING')
        .length,
      0,
    )
    // After ≥ poll-interval dwell → HOLDING allowed
    const later = advanceEpisode({
      episode: soon.episode,
      returns: { '5m': 3.05, day: 2.0 },
      strongest: { window: '5m', movePercent: 3.05, direction: 'UP' },
      currentPrice: 103.05,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:11:05.000Z',
    })
    assert.equal(later.episode?.state, 'HOLDING')
  })

  it(`emits acceleration after +${ACCELERATION_ALERT_DELTA_PP} pp`, () => {
    const started = startUp({ currentPrice: 103.1, referencePrice: 100 })
    // +5.2% total from 100 → 105.2 (≥ 1.5 pp beyond 3.1)
    const accel = advanceEpisode({
      episode: started.episode,
      returns: { '15m': 5.2, day: 4 },
      strongest: { window: '15m', movePercent: 5.2, direction: 'UP' },
      currentPrice: 105.2,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:18:00.000Z',
    })
    assert.ok(accel.events.some((e) => e.eventType === 'MOMENTUM_ACCELERATING'))
    assert.ok(accel.events.find((e) => e.eventType === 'MOMENTUM_ACCELERATING')?.shouldNotify)
  })
})

describe('V1 acceptance tests', () => {
  beforeEach(() => store.resetStore())

  it('AT-01: START on +3.1% entry', () => {
    const { episode, events } = startUp({
      currentPrice: 103.1,
      referencePrice: 100,
    })
    assert.equal(episode?.direction, 'UP')
    assert.equal(events.filter((e) => e.eventType === 'MOMENTUM_STARTED').length, 1)
    // Start is silent until operator runs Perplexity + manual alert
    assert.equal(events[0].shouldNotify, false)
    assert.equal(events[0].notification ?? null, null)
  })

  it('AT-02: acceleration copy shows since-last + total', () => {
    const started = startUp({
      currentPrice: 103.1,
      referencePrice: 100,
      nowIso: '2026-01-01T13:10:00.000Z',
      referenceTime: '2026-01-01T13:00:00.000Z',
    })
    const accel = advanceEpisode({
      episode: started.episode,
      returns: { '15m': 5.2, day: 4 },
      strongest: { window: '15m', movePercent: 5.2, direction: 'UP' },
      currentPrice: 105.2,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:18:00.000Z',
    })
    const ev = accel.events.find((e) => e.eventType === 'MOMENTUM_ACCELERATING')
    assert.ok(ev)
    assert.ok(ev.notification?.title.toLowerCase().includes('adds another'))
    assert.ok(
      ev.notification?.body.includes('5.2') ||
        ev.notification?.body.includes('+5.2'),
    )
  })

  it('AT-03: HOLDING near peak, no push', () => {
    const started = startUp({ currentPrice: 105.2, referencePrice: 100 })
    // force last notified to peak so no accel
    started.episode.lastNotifiedEpisodeMovePct = started.episode.currentMovePercent
    started.episode.lastAlertMovePercent = started.episode.currentMovePercent
    started.episode.peakPrice = 105.2
    const hold = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 4.9, day: 4 },
      strongest: { window: '5m', movePercent: 4.9, direction: 'UP' },
      currentPrice: 104.9,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:30:00.000Z',
    })
    assert.equal(hold.events.filter((e) => e.shouldNotify).length, 0)
    // giveback from 105.2→104.9 = 0.3/5.2 ≈ 5.8% → HOLDING (+ silent state row ok)
    assert.equal(hold.episode?.state, 'HOLDING')
    assert.ok(
      hold.events.some(
        (e) => e.eventType === 'MOMENTUM_STATE' && e.state === 'HOLDING',
      ) || hold.episode?.state === 'HOLDING',
    )
  })

  it('AT-04: giveback ≥25% → WEAKENING, no push', () => {
    const started = startUp({ currentPrice: 105.2, referencePrice: 100 })
    started.episode.lastNotifiedEpisodeMovePct = 5.2
    started.episode.peakPrice = 105.2
    started.episode.peakMovePercent = 5.2
    // giveback 30%: 105.2 - x = 0.3 * 5.2 → x = 103.64
    const weak = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 3.5, day: 3 },
      strongest: { window: '5m', movePercent: 3.5, direction: 'UP' },
      currentPrice: 103.64,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:45:00.000Z',
    })
    assert.equal(weak.events.filter((e) => e.shouldNotify).length, 0)
    assert.equal(weak.episode?.state, 'WEAKENING')
    assert.ok(
      weak.events.some(
        (e) => e.eventType === 'MOMENTUM_STATE' && e.state === 'WEAKENING',
      ),
    )
  })

  it('HOLDING + tiny +0.03pp stays HOLDING (not RE_ACCELERATING)', () => {
    const started = startUp({
      currentPrice: 108.21,
      referencePrice: 100,
      nowIso: '2026-01-01T13:10:00.000Z',
    })
    // Settle into HOLDING after dwell
    started.episode.state = 'HOLDING'
    started.episode.lastNotifiedEpisodeMovePct = 8.21
    started.episode.lastNotifiedPrice = 108.21
    started.episode.peakPrice = 108.21
    started.episode.peakMovePercent = 8.21
    started.episode.currentMovePercent = 8.21
    const noise = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 8.24, day: 8.24 },
      strongest: { window: '5m', movePercent: 8.24, direction: 'UP' },
      currentPrice: 108.24,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:12:00.000Z',
    })
    assert.equal(noise.episode?.state, 'HOLDING')
    assert.equal(
      noise.events.filter(
        (e) =>
          e.eventType === 'MOMENTUM_STATE' && e.state === 'RE_ACCELERATING',
      ).length,
      0,
    )
    assert.equal(noise.events.filter((e) => e.shouldNotify).length, 0)
  })

  it('AT-05: re-accel below last notified → no push', () => {
    const started = startUp({ currentPrice: 105.2, referencePrice: 100 })
    started.episode.lastNotifiedEpisodeMovePct = 5.2
    started.episode.lastNotifiedPrice = 105.2
    started.episode.peakPrice = 105.2
    started.episode.state = 'WEAKENING'
    // rebound to +4.8% = 104.8 — still below 5.2 notified
    const re = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 4.8, day: 4 },
      strongest: { window: '5m', movePercent: 4.8, direction: 'UP' },
      currentPrice: 104.8,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:00:00.000Z',
    })
    assert.equal(re.events.filter((e) => e.shouldNotify).length, 0)
  })

  it('AT-06: only +0.2 pp beyond last notified → no push', () => {
    const started = startUp({ currentPrice: 105.2, referencePrice: 100 })
    started.episode.lastNotifiedEpisodeMovePct = 5.2
    started.episode.lastNotifiedPrice = 105.2
    started.episode.peakPrice = 105.2
    const tiny = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 5.4, day: 5 },
      strongest: { window: '5m', movePercent: 5.4, direction: 'UP' },
      currentPrice: 105.4,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:15:00.000Z',
    })
    assert.equal(
      tiny.events.filter((e) => e.eventType === 'MOMENTUM_ACCELERATING').length,
      0,
    )
  })

  it('AT-07: ≥1.5 pp beyond last notified → one acceleration push', () => {
    const started = startUp({ currentPrice: 105.2, referencePrice: 100 })
    started.episode.lastNotifiedEpisodeMovePct = 5.2
    started.episode.lastNotifiedPrice = 105.2
    started.episode.peakPrice = 105.2
    // +6.8%
    const big = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 6.8, day: 6 },
      strongest: { window: '5m', movePercent: 6.8, direction: 'UP' },
      currentPrice: 106.8,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:30:00.000Z',
    })
    const accels = big.events.filter((e) => e.eventType === 'MOMENTUM_ACCELERATING')
    assert.equal(accels.length, 1)
    assert.equal(accels[0].shouldNotify, true)
    assert.ok(
      Math.abs(big.episode.lastNotifiedEpisodeMovePct - 6.8) < 0.05,
    )
  })

  it('AT-08: 50% giveback is NOT reversal', () => {
    const started = startUp({ currentPrice: 105.2, referencePrice: 100 })
    started.episode.lastNotifiedEpisodeMovePct = 5.2
    started.episode.peakPrice = 105.2
    // 50% giveback → price 102.6; still above reference; no opposite threshold
    const fade = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 2.6, '15m': 2, day: 2 },
      strongest: { window: '5m', movePercent: 2.6, direction: 'UP' },
      currentPrice: 102.6,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:00:00.000Z',
    })
    assert.equal(fade.episode?.status, 'ACTIVE')
    assert.ok(!fade.events.some((e) => e.eventType === 'MOMENTUM_REVERSED'))
    assert.ok(
      fade.episode?.state === 'WEAKENING' ||
        fade.episode?.state === 'STRONGLY_WEAKENING',
    )
  })

  it('AT-09: erased + opposite detector → reverse once + new episode (no START push)', () => {
    const started = startUp({ currentPrice: 103.1, referencePrice: 100 })
    // Price at/below reference with opposite DOWN threshold
    const flip = advanceEpisode({
      episode: started.episode,
      returns: { '5m': -3.2, day: 0.5 },
      strongest: { window: '5m', movePercent: -3.2, direction: 'DOWN' },
      currentPrice: 99.5,
      referencePrice: 100,
      references: { '5m': 102.8 },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:00:00.000Z',
    })
    assert.ok(flip.events.some((e) => e.eventType === 'MOMENTUM_REVERSED'))
    assert.ok(flip.events.some((e) => e.eventType === 'MOMENTUM_STARTED'))
    assert.equal(flip.episode?.direction, 'DOWN')
    const rev = flip.events.find((e) => e.eventType === 'MOMENTUM_REVERSED')
    assert.equal(rev.shouldNotify, true)
    // Opposite START is internal only — no second push for the same moment
    const startAfter = flip.events.find((e) => e.eventType === 'MOMENTUM_STARTED')
    assert.equal(startAfter.shouldNotify, false)
    assert.equal(startAfter.reason, 'AFTER_REVERSAL')
    const pushWorthy = flip.events.filter((e) => e.shouldNotify)
    assert.equal(pushWorthy.length, 1)
    assert.equal(pushWorthy[0].eventType, 'MOMENTUM_REVERSED')
  })

  it('AT-10: 60 min without ≥0.5 pp new extreme → silent expire', () => {
    const started = startUp({
      currentPrice: 105.2,
      referencePrice: 100,
      nowIso: '2026-01-01T13:10:00.000Z',
    })
    started.episode.lastNotifiedEpisodeMovePct = 5.2
    started.episode.meaningfulExtremeMovePct = 5.2
    started.episode.lastMaterialProgressAt = '2026-01-01T13:10:00.000Z'
    started.episode.peakPrice = 105.2

    // bounce around without +0.5 pp extreme for 60+ min
    const ended = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 4.0, day: 4 },
      strongest: { window: '5m', movePercent: 4.0, direction: 'UP' },
      currentPrice: 104.0,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:11:00.000Z', // 61 min later
    })
    assert.equal(ended.episode, null)
    const endEv = ended.events.find((e) => e.eventType === 'MOMENTUM_ENDED')
    assert.ok(endEv)
    assert.equal(endEv.reason, 'EXPIRED')
    assert.equal(endEv.shouldNotify, false)
  })

  it('AT-11: ≥0.5 pp new extreme resets expiry clock', () => {
    const started = startUp({
      currentPrice: 105.2,
      referencePrice: 100,
      nowIso: '2026-01-01T13:10:00.000Z',
    })
    started.episode.lastNotifiedEpisodeMovePct = 5.2
    started.episode.meaningfulExtremeMovePct = 5.2
    started.episode.lastMaterialProgressAt = '2026-01-01T13:10:00.000Z'
    started.episode.peakPrice = 105.2

    // At T+50m: +5.7% = +0.5 pp meaningful
    const progress = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 5.7, day: 5 },
      strongest: { window: '5m', movePercent: 5.7, direction: 'UP' },
      currentPrice: 105.7,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:00:00.000Z',
    })
    assert.equal(progress.episode?.status, 'ACTIVE')
    assert.ok(
      Date.parse(progress.episode.lastMaterialProgressAt) >=
        Date.parse('2026-01-01T14:00:00.000Z'),
    )

    // Another 50m later without more progress — still alive (only 50m from reset)
    const still = advanceEpisode({
      episode: progress.episode,
      returns: { '5m': 5.5, day: 5 },
      strongest: { window: '5m', movePercent: 5.5, direction: 'UP' },
      currentPrice: 105.5,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:50:00.000Z',
    })
    assert.equal(still.episode?.status, 'ACTIVE')
    assert.ok(EPISODE_INACTIVITY_EXPIRY_MIN >= 60)
    assert.ok(MATERIAL_PROGRESS_DELTA_PP <= 0.5)
  })

  it('AT-12: market close archives equities silently', () => {
    const started = startUp({ currentPrice: 105.2, referencePrice: 100 })
    const closed = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 5.0, day: 5 },
      strongest: { window: '5m', movePercent: 5.0, direction: 'UP' },
      currentPrice: 105.0,
      marketSession: 'CLOSED',
      assetClass: 'equity',
      nowIso: '2026-01-01T21:00:00.000Z',
    })
    assert.equal(closed.episode, null)
    const endEv = closed.events.find((e) => e.eventType === 'MOMENTUM_ENDED')
    assert.equal(endEv?.reason, 'MARKET_CLOSE')
    assert.equal(endEv?.shouldNotify, false)
  })

  it('AT-12b: commodities do NOT hard-close on US equity session CLOSED', () => {
    const started = advanceEpisode({
      ticker: 'GC=F',
      episode: null,
      returns: { '5m': 3.5, day: 2 },
      strongest: { window: '5m', movePercent: 3.5, direction: 'UP' },
      currentPrice: 2350,
      referencePrice: 2270,
      marketSession: 'REGULAR',
      assetClass: 'commodity',
      nowIso: '2026-01-01T20:50:00.000Z',
    })
    assert.equal(started.episode?.status, 'ACTIVE')
    // Keep within 60m of material progress so only market-close logic is under test
    started.episode.lastMaterialProgressAt = '2026-01-01T20:50:00.000Z'
    started.episode.lastNotifiedEpisodeMovePct = started.episode.currentMovePercent
    const stillOpen = advanceEpisode({
      ticker: 'GC=F',
      episode: started.episode,
      returns: { '5m': 3.2, day: 2 },
      strongest: { window: '5m', movePercent: 3.2, direction: 'UP' },
      currentPrice: 2345,
      marketSession: 'CLOSED',
      assetClass: 'commodity',
      nowIso: '2026-01-01T21:00:00.000Z',
    })
    assert.equal(stillOpen.episode?.status, 'ACTIVE')
    assert.ok(!stillOpen.events.some((e) => e.reason === 'MARKET_CLOSE'))
  })

  it('AT-13/14: without Supabase, no broadcast to all devices', async () => {
    // Eligibility uses device_monitored_tickers (in-app watchlist), not dashboard tabs.
    // With no Supabase in unit tests, eligible set is empty — never fan-out to everyone.
    const { loadWatchlistEligibleDevices } = await import('./delivery.js')
    store.setWatchedTickers(['SNDK', 'AAPL'])
    const devices = await loadWatchlistEligibleDevices('SNDK')
    assert.equal(devices.length, 0)
  })

  it('AT-15: many state flips between milestones → no spam', () => {
    let { episode } = startUp({
      currentPrice: 105.2,
      referencePrice: 100,
      nowIso: '2026-01-01T13:10:00.000Z',
    })
    episode.lastNotifiedEpisodeMovePct = 5.2
    episode.lastNotifiedPrice = 105.2
    episode.peakPrice = 105.2
    episode.meaningfulExtremeMovePct = 5.2
    episode.lastMaterialProgressAt = '2026-01-01T13:10:00.000Z'

    const prices = [104.9, 104.0, 104.8, 105.4, 105.1, 105.3]
    let pushCount = 0
    let t = Date.parse('2026-01-01T13:20:00.000Z')
    for (const px of prices) {
      const move = movePercent(px, 100)
      const r = advanceEpisode({
        episode,
        returns: { '5m': move, day: move },
        strongest: {
          window: '5m',
          movePercent: move,
          direction: move >= 0 ? 'UP' : 'DOWN',
        },
        currentPrice: px,
        marketSession: 'REGULAR',
        nowIso: new Date(t).toISOString(),
      })
      episode = r.episode
      pushCount += r.events.filter((e) => e.shouldNotify).length
      t += 5 * 60_000
      if (!episode) break
    }
    assert.equal(pushCount, 0)
  })
})

describe('evaluateMomentumFromCandles integration', () => {
  beforeEach(() => store.resetStore())

  it('detects start from rising series', () => {
    const end = Date.UTC(2026, 0, 15, 18, 0, 0)
    const prices = [100, 100.5, 101, 102, 103, 103.5]
    const candles = series(prices, 60_000, end)
    const result = evaluateMomentumFromCandles({
      candles,
      currentPrice: 103.5,
      previousClose: 99,
      asOfMs: end,
      marketSession: 'REGULAR',
      episode: null,
      nowIso: new Date(end).toISOString(),
    })
    assert.equal(result.ok, true)
    assert.ok(result.snapshot.returns['5m'] != null)
    assert.ok(Math.abs(result.snapshot.returns['5m']) >= 3)
    assert.ok(result.events.some((e) => e.eventType === 'MOMENTUM_STARTED'))
  })
})
