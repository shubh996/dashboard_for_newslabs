/**
 * Run: node --test server/momentum/engine.test.js
 *
 * Includes V1 acceptance tests AT-01…AT-15 from
 * Trigger_Episode_Alert_Notification_Logic_v1.docx
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  activeEpisodePredatesRegularSession,
  evaluateMomentumFromCandles,
  requiresYahooRegularSession,
} from './engine.js'
import {
  computeRollingReturns,
  movePercent,
  resolveLookbackHist,
} from './returns.js'
import { candleAtOrBefore } from './candles.js'
import {
  findEpisodeThresholdCrosses,
  findThresholdCrosses,
  isEpisodeEligibleWindow,
  pickShortestStartHit,
  episodeWindowRankMinutes,
} from './detector.js'
import {
  advanceEpisode,
  classifyGivebackState,
  computeGivebackRatio,
  originalMoveErased,
} from './episode.js'
import {
  alertDisplayName,
  buildNotificationCopy,
  isPushWorthy,
  rewriteStockHeadlineToTicker,
  sanitizeStockHeadlineInSummary,
} from './notifyCopy.js'
import { handleAutoStartResearchAlerts } from './autoStartAlert.js'
import * as store from './store.js'
import {
  ACCELERATION_ALERT_DELTA_PP,
  EPISODE_INACTIVITY_EXPIRY_MIN,
  MATERIAL_PROGRESS_DELTA_PP,
  START_PUSH_MAX_AGE_MS,
  applyThresholdOverrides,
  applyEpisodePolicyOverrides,
  getEpisodePolicyForClass,
} from './config.js'

function series(prices, intervalMs = 60_000, endMs = Date.now()) {
  return prices.map((close, i) => ({
    t: endMs - (prices.length - 1 - i) * intervalMs,
    close,
  }))
}

describe('strict Yahoo regular gate policy', () => {
  it('exempts crypto from session stops but gates every other asset', () => {
    assert.equal(requiresYahooRegularSession('BTC-USD'), false)
    assert.equal(requiresYahooRegularSession('ETH-USD'), false)
    assert.equal(requiresYahooRegularSession('TSLA'), true)
    assert.equal(requiresYahooRegularSession('^GSPC'), true)
    assert.equal(requiresYahooRegularSession('GC=F'), true)
    assert.equal(requiresYahooRegularSession('EURUSD=X'), true)
  })

  it('closes hydrated ACTIVE episodes that predate the current regular open', () => {
    const open = Date.parse('2026-08-24T13:30:00.000Z')
    assert.equal(
      activeEpisodePredatesRegularSession(
        {
          status: 'ACTIVE',
          episodeStartedAt: '2026-08-24T12:45:00.000Z',
        },
        open,
      ),
      true,
    )
    assert.equal(
      activeEpisodePredatesRegularSession(
        {
          status: 'ACTIVE',
          episodeStartedAt: '2026-08-24T13:35:00.000Z',
        },
        open,
      ),
      false,
    )
    assert.equal(
      activeEpisodePredatesRegularSession(
        {
          status: 'ENDED',
          episodeStartedAt: '2026-08-24T12:45:00.000Z',
        },
        open,
      ),
      false,
    )
  })
})

/** Prime edge state so the next hot returns count as a fresh thr cross. */
function primeStart(ticker = 'SNDK') {
  store.primeThresholdEdgesBelow(ticker)
}

/** Helper: open an UP episode at given price/move via synthetic returns */
function startUp(opts = {}) {
  const price = opts.currentPrice ?? 103.1
  const ref = opts.referencePrice ?? 100
  const move = movePercent(price, ref)
  const ticker = opts.ticker || 'SNDK'
  primeStart(ticker)
  return advanceEpisode({
    ticker,
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

  it('exact clock hours: null when lookback target is in a Yahoo data hole', () => {
    // Fri last print → long hole → Mon 4:00 pre first bar (no overnight 1m)
    // asOf Mon 5:51 ET ≈ 2h into pre-market tape
    const friLast = Date.parse('2026-08-14T23:59:00.000Z')
    const mon4 = Date.parse('2026-08-17T08:00:00.000Z')
    const mon551 = Date.parse('2026-08-17T09:51:00.000Z')
    const candles = []
    for (let i = 0; i < 5; i += 1) {
      candles.push({ t: friLast - (4 - i) * 60_000, close: 1658 })
    }
    for (let t = mon4; t <= mon551; t += 60_000) {
      candles.push({ t, close: 1700 })
    }
    const target2h = mon551 - 2 * 60 * 60_000 // Mon ~3:51 — inside hole
    const raw = candleAtOrBefore(candles, target2h)
    assert.equal(raw?.t, friLast)
    const resolved = resolveLookbackHist(
      candles,
      raw,
      target2h,
      mon551,
      120,
      {},
    )
    assert.equal(resolved.rejected, true)
    assert.equal(resolved.hist, null)

    const live = 1726.46
    const { returns, referenceTimes, exactLookbacks } = computeRollingReturns(
      candles,
      live,
      mon551,
      1641,
      null,
      null,
      null,
    )
    // ≤ ~2h of continuous pre-market tape from Mon 4:00 → 5:51
    assert.ok(returns['5m'] != null)
    assert.ok(returns['60m'] != null)
    assert.ok(returns['90m'] != null)
    // 2h wall target is still before Mon 4:00 → no exact print → null
    assert.equal(returns['2h'], null)
    assert.equal(exactLookbacks['2h'], null)
    assert.equal(returns['3h'], null)
    assert.equal(returns['8h'], null)
    // 24h also null (not a bridge window) — no Friday substitution
    assert.equal(returns['24h'], null)
    assert.equal(referenceTimes['24h'], null)
    // day vs previous close still works
    assert.ok(returns.day != null)
  })

  it('exact clock hours: 2h shows when tape covers the full wall lookback', () => {
    const mon4 = Date.parse('2026-08-17T08:00:00.000Z')
    const mon7 = Date.parse('2026-08-17T11:00:00.000Z') // 3h of pre/regular tape
    const candles = []
    for (let t = mon4; t <= mon7; t += 60_000) {
      const mins = (t - mon4) / 60_000
      candles.push({ t, close: 1700 + mins * 0.05 })
    }
    const { returns, referenceTimes } = computeRollingReturns(
      candles,
      1709,
      mon7,
      1641,
      null,
      null,
      null,
    )
    assert.ok(returns['2h'] != null)
    assert.ok(returns['3h'] != null)
    // 2h lookback ~ Mon 5:00 — inside continuous tape
    assert.ok(Date.parse(referenceTimes['2h']) >= mon4)
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
    // Pin defaults so a prior UI save on disk cannot make this flaky
    applyThresholdOverrides({
      '5m': 3,
      '15m': 3,
      '30m': 4,
      '60m': 5,
      day: 5,
    })
    const hits = findThresholdCrosses({
      '5m': 2.9,
      '15m': 2.9,
      '30m': 3.9,
      '60m': 4.9,
      day: 4.9,
    })
    assert.equal(hits.length, 0)
  })

  it('threshold 0 / null never counts as a hit (not always-on)', () => {
    applyThresholdOverrides({ '5m': 0, '15m': null, '24h': 0, day: 0 })
    const hits = findThresholdCrosses({
      '5m': 9,
      '15m': 12,
      '24h': 20,
      day: 8,
    })
    assert.equal(hits.length, 0)
    // Restore common defaults used by other tests
    applyThresholdOverrides({
      '5m': 3,
      '15m': 3,
      '24h': null,
      day: 5,
    })
  })

  it('episode-eligible windows are ≤24h and 1D only', () => {
    assert.equal(isEpisodeEligibleWindow('5m'), true)
    assert.equal(isEpisodeEligibleWindow('8h'), true)
    assert.equal(isEpisodeEligibleWindow('24h'), true)
    assert.equal(isEpisodeEligibleWindow('day'), true)
    assert.equal(isEpisodeEligibleWindow('1D'), true)
    assert.equal(isEpisodeEligibleWindow('1d'), true)
    assert.equal(isEpisodeEligibleWindow('30h'), false)
    assert.equal(isEpisodeEligibleWindow('40h'), false)
    assert.equal(isEpisodeEligibleWindow('1w'), false)
    assert.equal(isEpisodeEligibleWindow('10d'), false)
    assert.equal(isEpisodeEligibleWindow('1M'), false)
  })

  it('episode crosses ignore 1w / 30h even when those thresholds are set', () => {
    applyThresholdOverrides({ '1w': 5, '30h': 5 })
    const hits = findEpisodeThresholdCrosses({
      '5m': 3.2,
      '1w': 18,
      '30h': 11,
      day: 6,
    })
    applyThresholdOverrides({ '1w': null, '30h': null })
    assert.ok(hits.some((h) => h.window === '5m'))
    assert.ok(hits.some((h) => h.window === 'day'))
    assert.ok(!hits.some((h) => h.window === '1w' || h.window === '30h'))
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

  it('giveback bands accept per-asset-class overrides', () => {
    // Commodity-style: enter weakening at 40% giveback
    assert.equal(
      classifyGivebackState(0.3, 'HOLDING', {
        holdingToWeakeningGiveback: 0.4,
        weakeningToHoldingGiveback: 0.3,
        strongWeakeningGiveback: 0.7,
      }),
      'HOLDING',
    )
    assert.equal(
      classifyGivebackState(0.45, 'HOLDING', {
        holdingToWeakeningGiveback: 0.4,
        weakeningToHoldingGiveback: 0.3,
        strongWeakeningGiveback: 0.7,
      }),
      'WEAKENING',
    )
  })

  it('episode rules diverge per asset class', () => {
    applyEpisodePolicyOverrides({ accelerationAlertDeltaPp: 2 }, 'equity')
    applyEpisodePolicyOverrides({ accelerationAlertDeltaPp: 4 }, 'commodity')
    assert.equal(getEpisodePolicyForClass('equity').accelerationAlertDeltaPp, 2)
    assert.equal(
      getEpisodePolicyForClass('commodity').accelerationAlertDeltaPp,
      4,
    )
    // stocks unchanged when commodities edited
    applyEpisodePolicyOverrides({ accelerationAlertDeltaPp: 5 }, 'commodity')
    assert.equal(getEpisodePolicyForClass('equity').accelerationAlertDeltaPp, 2)
    assert.equal(
      getEpisodePolicyForClass('commodity').accelerationAlertDeltaPp,
      5,
    )
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
    assert.equal(copy?.title, '🟢 SNDK +3.1% rally in last 10 mins')
    assert.ok(!copy?.title.toLowerCase().includes('sandisk'))
  })

  it('stocks never use company name even when it is provided', () => {
    assert.equal(alertDisplayName('SNDK', 'Sandisk'), 'SNDK')
    assert.equal(alertDisplayName('AAPL', 'Apple Inc.'), 'AAPL')
    assert.equal(alertDisplayName('NG=F', 'Natural Gas'), 'Natural Gas')

    const start = buildNotificationCopy({
      ticker: 'SNDK',
      companyName: 'Sandisk',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 7.6,
      exactMinutes: 42,
    })
    assert.ok(start?.title.includes('SNDK'))
    assert.ok(!start?.title.toLowerCase().includes('sandisk'))

    const accel = buildNotificationCopy({
      ticker: 'AAPL',
      companyName: 'Apple Inc.',
      eventType: 'MOMENTUM_ACCELERATING',
      direction: 'UP',
      movePercent: 5.2,
      price: 105.2,
      detectedAt: '2026-01-01T13:18:00.000Z',
      episode: {
        lastNotifiedPrice: 103.1,
        lastNotifiedTime: '2026-01-01T13:10:00.000Z',
        lastNotifiedEpisodeMovePct: 3.1,
        referenceTime: '2026-01-01T13:00:00.000Z',
      },
    })
    assert.ok(accel?.title.includes('AAPL'))
    assert.ok(!accel?.title.toLowerCase().includes('apple'))
  })

  it('rewrites stock headlines to ticker', () => {
    assert.equal(
      rewriteStockHeadlineToTicker(
        'Sandisk rose 4.2% so far in regular trading',
        'SNDK',
        'Sandisk',
      ),
      'SNDK rose 4.2% so far in regular trading',
    )
    assert.equal(
      rewriteStockHeadlineToTicker(
        '🟢 Apple Inc. -3.1% at the close',
        'AAPL',
        'Apple Inc.',
      ),
      '🟢 AAPL -3.1% at the close',
    )
    assert.equal(
      rewriteStockHeadlineToTicker('SNDK rose 4.2% so far', 'SNDK', 'Sandisk'),
      'SNDK rose 4.2% so far',
    )
    const summary = sanitizeStockHeadlineInSummary(
      'Sandisk rose 4.2% so far in regular trading\n\nLikely driver: Guidance raise.',
      'SNDK',
      'Sandisk',
      'equity',
    )
    assert.ok(summary.startsWith('SNDK rose'))
    assert.ok(!summary.toLowerCase().startsWith('sandisk'))
  })

  it('START title lookback bands + body is likely driver only', () => {
    const m42 = buildNotificationCopy({
      ticker: 'AAPL',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 2.5,
      exactMinutes: 42,
    })
    assert.ok(m42?.title.includes('in last 42 mins'))

    const m90 = buildNotificationCopy({
      ticker: 'AAPL',
      eventType: 'MOMENTUM_STARTED',
      direction: 'DOWN',
      movePercent: -1.5,
      exactMinutes: 90,
    })
    assert.ok(m90?.title.includes('🔴'))
    // Human duration — never telegraph "1H30M"
    assert.ok(m90?.title.includes('in last 1 hour 30 mins'), m90?.title)
    assert.ok(!/1H\d*M/i.test(m90?.title || ''))
    // |move| < 2 → no intensity word
    assert.ok(!m90?.title.includes('plunge'), m90?.title)
    assert.ok(!m90?.title.includes('drop'), m90?.title)

    // 60–119m + meaningful move → surge/plunge + human time
    const m91 = buildNotificationCopy({
      ticker: 'CBRS',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 5.6,
      exactMinutes: 91,
      detectedWindow: '90m',
    })
    assert.ok(m91?.title.includes('surge'), m91?.title)
    assert.ok(m91?.title.includes('in last 1 hour 31 mins'), m91?.title)
    assert.ok(!/1H\d*M/i.test(m91?.title || ''))

    // Normal: wall-clock matches window → plain wording (no “trading”)
    const m180 = buildNotificationCopy({
      ticker: 'AAPL',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 4,
      exactMinutes: 180,
      detectedWindow: '3h',
    })
    assert.ok(m180?.title.includes('in last 3 hours'))
    assert.ok(m180?.title.includes('surge'), m180?.title)
    assert.ok(!m180?.title.includes('trading hours'))

    const m24h = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 8,
      exactMinutes: 1440,
      detectedWindow: '24h',
    })
    assert.ok(m24h?.title.includes('in last 24 hours'))
    assert.ok(m24h?.title.includes('surge'), m24h?.title)
    assert.ok(!m24h?.title.includes('trading hours'))

    // Gap: wall span ~3 days but window is 24h → “24 trading hours”
    const m24hWeekend = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 8,
      exactMinutes: 72 * 60,
      detectedWindow: '24h',
    })
    assert.ok(m24hWeekend?.title.includes('in last 24 trading hours'))
    assert.ok(!m24hWeekend?.title.includes('trading days'))

    const m248h = buildNotificationCopy({
      ticker: 'GC=F',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 10.1,
      exactMinutes: 248 * 60,
    })
    assert.ok(m248h?.title.includes('in last 10 days'))
    assert.ok(!m248h?.title.includes('248 hours'))
    // Futures: human name, never GC=F
    assert.ok(m248h?.title.includes('Gold'))
    assert.ok(!m248h?.title.includes('GC=F'))
    assert.ok(m248h?.title.includes('surge'), m248h?.title)

    const ng = buildNotificationCopy({
      ticker: 'NG=F',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 3.2,
      exactMinutes: 15,
    })
    assert.ok(ng?.title.includes('Natural Gas'))
    assert.ok(!ng?.title.includes('NG=F'))
    assert.equal(
      ng?.title,
      '🟢 Natural Gas +3.2% rally in last 15 mins',
    )

    const plunge = buildNotificationCopy({
      ticker: 'SNAP',
      eventType: 'MOMENTUM_STARTED',
      direction: 'DOWN',
      movePercent: -9.2,
      exactMinutes: 45,
    })
    assert.ok(plunge?.title.includes('plunge'), plunge?.title)
    assert.ok(plunge?.title.includes('in last 45 mins'), plunge?.title)

    const cl = buildNotificationCopy({
      ticker: 'CL=F',
      eventType: 'MOMENTUM_ACCELERATING',
      direction: 'UP',
      movePercent: 5.2,
      price: 80,
      detectedAt: '2026-01-01T13:18:00.000Z',
      episode: {
        lastNotifiedPrice: 78,
        lastNotifiedTime: '2026-01-01T13:10:00.000Z',
        lastNotifiedEpisodeMovePct: 3.0,
        referenceTime: '2026-01-01T12:00:00.000Z',
      },
    })
    assert.ok(cl?.title.includes('Crude Oil'))
    assert.ok(!cl?.title.includes('CL=F'))

    const withDriver = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 5,
      exactMinutes: 20,
      likelyDriver: 'Strong bid after guidance raise.',
    })
    assert.equal(withDriver?.body, 'Strong bid after guidance raise.')

    // Day + session: ongoing sessions use “so far” (not wall-clock days)
    const preDay = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 5.1,
      exactMinutes: 72 * 60,
      detectedWindow: 'day',
      marketSession: 'PRE',
    })
    assert.ok(preDay?.title.includes('in pre-market so far'), preDay?.title)
    assert.ok(!preDay?.title.includes('3 days'), preDay?.title)

    const postDay = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 2.2,
      exactMinutes: 60,
      detectedWindow: 'day',
      marketSession: 'POST',
    })
    assert.ok(postDay?.title.includes('in after-hours so far'), postDay?.title)

    const overnightDay = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_STARTED',
      direction: 'DOWN',
      movePercent: -1.5,
      exactMinutes: 120,
      detectedWindow: 'day',
      marketSession: 'PREPRE',
    })
    assert.ok(overnightDay?.title.includes('overnight so far'), overnightDay?.title)

    // Rolling 60m/5m during PRE (e.g. ref 9:10 AM): duration, NOT “pre-market so far”
    // Example: 🟢 AAPL +3.1% rally in last 5 mins
    const pre5m = buildNotificationCopy({
      ticker: 'AAPL',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 3.1,
      exactMinutes: 5,
      detectedWindow: '5m',
      marketSession: 'PRE',
    })
    assert.equal(pre5m?.title, '🟢 AAPL +3.1% rally in last 5 mins')
    assert.ok(pre5m?.title.includes('in last 5 mins'), pre5m?.title)
    assert.ok(!pre5m?.title.includes('pre-market so far'), pre5m?.title)

    const pre60m = buildNotificationCopy({
      ticker: 'AMZN',
      eventType: 'MOMENTUM_STARTED',
      direction: 'UP',
      movePercent: 2.0,
      exactMinutes: 60,
      detectedWindow: '60m',
      marketSession: 'PRE',
    })
    assert.ok(pre60m?.title.includes('in last 1 hour'), pre60m?.title)
    assert.ok(!pre60m?.title.includes('pre-market so far'), pre60m?.title)
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
    assert.ok(copy?.title.startsWith('🟢'), copy?.title)
    assert.ok(copy?.title.toLowerCase().includes('adds another'))
    assert.ok(copy?.body.toLowerCase().includes('surge'))
    assert.ok(copy?.body.includes('+5.2%') || copy?.body.includes('5.2%'))
    assert.ok(!/\bminutes?\b/i.test(`${copy?.title} ${copy?.body}`))
  })

  it('push policy', () => {
    // STARTED needs Perplexity reason first → no auto-push
    assert.equal(isPushWorthy('MOMENTUM_STARTED'), false)
    assert.equal(isPushWorthy('MOMENTUM_ACCELERATING'), true)
    assert.equal(isPushWorthy('MOMENTUM_REVERSED'), true)
    assert.equal(isPushWorthy('MOMENTUM_STRONG_WEAKENING'), true)
    // Legacy hydrated event name still push-worthy
    assert.equal(isPushWorthy('MOMENTUM_STRONG_REVERSAL'), true)
    assert.equal(isPushWorthy('MOMENTUM_ENDED', 'EXPIRED'), false)
    assert.equal(isPushWorthy('MOMENTUM_ENDED', 'MARKET_CLOSE'), false)
    assert.equal(isPushWorthy('MOMENTUM_ENDED', 'REVERSAL'), true)
  })

  it('strong giveback copy matches product example', () => {
    const copy = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_STRONG_WEAKENING',
      direction: 'UP',
      movePercent: 4,
      peakMovePercent: 10,
      givebackPct: 60,
      remainingMovePercent: 4,
    })
    // UP episode fade → 🔴 (inverted vs original surge)
    assert.equal(copy?.title, '🔴 SNDK has given back 60% of its surge')
    assert.equal(
      copy?.body,
      'The move now stands at +4.0%, after reaching +10.0% earlier.',
    )

    const downFade = buildNotificationCopy({
      ticker: 'SNAP',
      eventType: 'MOMENTUM_STRONG_WEAKENING',
      direction: 'DOWN',
      movePercent: -4,
      peakMovePercent: -10,
      givebackPct: 60,
      remainingMovePercent: -4,
    })
    // DOWN episode fade → 🟢
    assert.equal(
      downFade?.title,
      '🟢 SNAP has given back 60% of its decline',
    )
    assert.equal(
      downFade?.body,
      'The decline now stands at -4.0%, after reaching -10.0% earlier.',
    )
  })

  it('re-accel copy uses recovery wording', () => {
    const copy = buildNotificationCopy({
      ticker: 'SNDK',
      eventType: 'MOMENTUM_ACCELERATING',
      direction: 'UP',
      movePercent: 6,
      reason: 'RE_ACCELERATION',
      accelKind: 'RE_ACCELERATING',
      recoveryFromMovePercent: 4,
      previousAlertMovePercent: 4,
    })
    assert.equal(copy?.title, '🟢 SNDK is accelerating again')
    assert.ok(copy?.body.includes('+4.0%') || copy?.body.includes('+4%'))
    assert.ok(copy?.body.includes('+6.0%') || copy?.body.includes('+6%'))
  })

  it('downward re-accel says the stock is dropping again', () => {
    const copy = buildNotificationCopy({
      ticker: 'TSLA',
      eventType: 'MOMENTUM_ACCELERATING',
      direction: 'DOWN',
      movePercent: -4.9,
      reason: 'RE_ACCELERATION',
      accelKind: 'RE_ACCELERATING',
      recoveryFromMovePercent: -2.8,
      previousAlertMovePercent: -2.8,
    })
    assert.equal(copy?.title, '🔴 TSLA is dropping again')
    assert.equal(
      copy?.body,
      'The decline has deepened from -2.8% to -4.9% after the earlier rebound.',
    )
  })

  it('reversal copy names the erased leg and new direction', () => {
    const lower = buildNotificationCopy({
      ticker: 'TSLA',
      eventType: 'MOMENTUM_REVERSED',
      direction: 'UP',
    })
    assert.equal(
      lower?.title,
      '🔴 TSLA erases its gains and reverses lower',
    )

    const higher = buildNotificationCopy({
      ticker: 'TSLA',
      eventType: 'MOMENTUM_REVERSED',
      direction: 'DOWN',
    })
    assert.equal(
      higher?.title,
      '🟢 TSLA erases its losses and reverses higher',
    )
  })
})

describe('episode state machine (legacy smoke)', () => {
  beforeEach(() => {
    store.resetStore()
    primeStart('SNDK')
  })

  it('does not start from 1w / 30h — those windows blink only', () => {
    applyThresholdOverrides({ '1w': 5, '30h': 5 })
    const { episode, events } = advanceEpisode({
      episode: null,
      returns: { '5m': 1, '15m': 1, '1w': 18, '30h': 12, day: 1 },
      strongest: { window: '1w', movePercent: 18, direction: 'UP' },
      currentPrice: 118,
      referencePrice: 100,
      marketSession: 'REGULAR',
    })
    applyThresholdOverrides({ '1w': null, '30h': null })
    assert.equal(episode, null)
    assert.equal(
      events.filter((e) => e.eventType === 'MOMENTUM_STARTED').length,
      0,
    )
  })

  it('pickShortestStartHit prefers shortest window (sets direction; not strongest |move|)', () => {
    const hit = pickShortestStartHit([
      { window: '24h', movePercent: 12, direction: 'UP', threshold: 5 },
      { window: '5m', movePercent: 3.5, direction: 'UP', threshold: 3 },
      { window: '60m', movePercent: 8, direction: 'UP', threshold: 5 },
      { window: '15m', movePercent: -4, direction: 'DOWN', threshold: 3 },
    ])
    // Shortest qualifying is 5m UP — even though 24h |12| is stronger
    assert.equal(hit?.window, '5m')
    assert.equal(hit?.direction, 'UP')
    assert.ok(episodeWindowRankMinutes('5m') < episodeWindowRankMinutes('60m'))
  })

  it('pickShortestStartHit: fresh short UP beats stale long DOWN (not strongest |move|)', () => {
    const hit = pickShortestStartHit([
      { window: '24h', movePercent: -8, direction: 'DOWN', threshold: 5 },
      { window: '5m', movePercent: 3.5, direction: 'UP', threshold: 3 },
      { window: '60m', movePercent: -6, direction: 'DOWN', threshold: 5 },
    ])
    // |-8| > |3.5| but shortest window wins → UP 5m, not DOWN 24h
    assert.equal(hit?.window, '5m')
    assert.equal(hit?.direction, 'UP')
  })

  it('START uses shortest qualifying window; only one STARTED event', () => {
    // 24h is diagnostic (null thr) by default — enable it so multi-window START is exercised
    applyThresholdOverrides({ '24h': 5 })
    const { episode, events } = advanceEpisode({
      episode: null,
      // 5m, 60m, 24h all qualify UP — must pick 5m only
      returns: { '5m': 3.5, '15m': 2, '60m': 8, '24h': 12, day: 6 },
      strongest: { window: '24h', movePercent: 12, direction: 'UP' },
      currentPrice: 103.5,
      referencePrice: 100,
      referenceTime: '2026-01-01T13:05:00.000Z',
      references: {
        '5m': 100,
        '60m': 95.8,
        '24h': 92.4,
        day: 97.6,
      },
      referenceTimes: {
        '5m': '2026-01-01T13:05:00.000Z',
        '60m': '2026-01-01T12:10:00.000Z',
        '24h': '2025-12-31T13:10:00.000Z',
        day: '2025-12-31T21:00:00.000Z',
      },
      exactLookbacks: {
        '5m': {
          exactMinutes: 5,
          exactLabel: '5 minutes',
          windowMinutes: 5,
        },
      },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:10:00.000Z',
    })
    applyThresholdOverrides({ '24h': null })
    assert.equal(episode?.status, 'ACTIVE')
    assert.equal(episode?.detectedWindow, '5m')
    assert.equal(episode?.referencePrice, 100)
    // Move frozen to 5m reference, not 24h
    assert.ok(Math.abs(Number(episode?.initialMovePercent) - 3.5) < 0.05)
    assert.equal(episode?.exactMinutes, 5)
    const starts = events.filter((e) => e.eventType === 'MOMENTUM_STARTED')
    assert.equal(starts.length, 1)
    assert.equal(starts[0].detectedWindow, '5m')
    assert.ok(starts[0].startSelection?.alsoQualified?.some((w) => w.window === '24h'))
    assert.ok(starts[0].startSelection?.alsoQualified?.some((w) => w.window === '60m'))
    assert.equal(starts[0].startSelection?.selectedWindow, '5m')
  })

  it('while ACTIVE, shorter window does not create a second START', () => {
    const first = advanceEpisode({
      episode: null,
      returns: { '60m': 5.5, '5m': 1, day: 2 },
      strongest: { window: '60m', movePercent: 5.5, direction: 'UP' },
      currentPrice: 105.5,
      referencePrice: 100,
      referenceTime: '2026-01-01T12:10:00.000Z',
      references: { '60m': 100, '5m': 104 },
      referenceTimes: {
        '60m': '2026-01-01T12:10:00.000Z',
        '5m': '2026-01-01T13:05:00.000Z',
      },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:10:00.000Z',
    })
    assert.equal(first.episode?.detectedWindow, '60m')
    const epId = first.episode.episodeId
    // Later 5m also qualifies hard — still one episode, no second START
    const next = advanceEpisode({
      episode: first.episode,
      returns: { '60m': 6, '5m': 4.5, day: 3 },
      strongest: { window: '5m', movePercent: 4.5, direction: 'UP' },
      currentPrice: 106,
      referencePrice: 999, // must not rebind
      references: { '60m': 100, '5m': 101.4 },
      referenceTimes: {
        '60m': '2026-01-01T12:10:00.000Z',
        '5m': '2026-01-01T13:10:00.000Z',
      },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:15:00.000Z',
    })
    assert.equal(next.episode?.episodeId, epId)
    assert.equal(next.episode?.detectedWindow, '60m')
    assert.equal(next.episode?.referencePrice, 100)
    assert.equal(
      next.events.filter((e) => e.eventType === 'MOMENTUM_STARTED').length,
      0,
    )
  })

  it('starts on 1D even when a larger 1w move exists', () => {
    applyThresholdOverrides({ '1w': 5 })
    const { episode } = advanceEpisode({
      episode: null,
      returns: { '5m': 1, '15m': 1, '1w': 20, day: 6.2 },
      strongest: { window: '1w', movePercent: 20, direction: 'UP' },
      currentPrice: 106.2,
      referencePrice: 100,
      marketSession: 'REGULAR',
    })
    applyThresholdOverrides({ '1w': null })
    assert.equal(episode?.status, 'ACTIVE')
    assert.equal(episode?.detectedWindow, 'day')
  })

  it('prefers a ≤24h hit over a larger multi-day hit', () => {
    applyThresholdOverrides({ '1w': 5 })
    const { episode } = advanceEpisode({
      episode: null,
      returns: { '5m': 3.4, '15m': 1, '1w': 22, day: 2 },
      strongest: { window: '1w', movePercent: 22, direction: 'UP' },
      currentPrice: 103.4,
      referencePrice: 100,
      marketSession: 'REGULAR',
    })
    applyThresholdOverrides({ '1w': null })
    assert.equal(episode?.status, 'ACTIVE')
    assert.equal(episode?.detectedWindow, '5m')
  })

  it('ends an existing episode that was opened on a >24h window', () => {
    const prior = {
      episodeId: 'SNDK-long',
      ticker: 'SNDK',
      direction: 'UP',
      status: 'ACTIVE',
      state: 'HOLDING',
      referencePrice: 100,
      referenceTime: '2026-01-01T13:00:00.000Z',
      triggerPrice: 118,
      triggerTime: '2026-01-01T13:10:00.000Z',
      episodeStartedAt: '2026-01-01T13:10:00.000Z',
      episodeStartPrice: 118,
      detectedWindow: '1w',
      initialMovePercent: 18,
      currentMovePercent: 18,
      peakMovePercent: 18,
      peakPrice: 118,
      peakTime: '2026-01-01T13:10:00.000Z',
      troughPrice: null,
      troughTime: null,
      lastAlertMovePercent: 18,
      lastAlertAt: '2026-01-01T13:10:00.000Z',
      lastNotifiedPrice: 118,
      lastNotifiedTime: '2026-01-01T13:10:00.000Z',
      lastNotifiedEpisodeMovePct: 18,
      currentPrice: 118,
      currentTime: '2026-01-01T13:10:00.000Z',
      meaningfulExtremeMovePct: 18,
      lastMaterialProgressAt: '2026-01-01T13:10:00.000Z',
      reversalNotified: false,
      belowThresholdSince: null,
    }
    const { episode, events } = advanceEpisode({
      episode: prior,
      returns: { '5m': 1, '1w': 18, day: 1 },
      strongest: { window: '1w', movePercent: 18, direction: 'UP' },
      currentPrice: 118,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:20:00.000Z',
    })
    assert.equal(episode, null)
    assert.ok(events.some((e) => e.eventType === 'MOMENTUM_ENDED'))
  })

  it('manual-end suppressStart blocks a new start while still hot', () => {
    const { episode, events } = advanceEpisode({
      episode: null,
      returns: { '5m': 3.4, '15m': 1, '30m': 1, '60m': 1, day: 2 },
      strongest: { window: '5m', movePercent: 3.4, direction: 'UP' },
      currentPrice: 103.4,
      referencePrice: 100,
      marketSession: 'REGULAR',
      suppressStart: true,
    })
    assert.equal(episode, null)
    assert.equal(events.length, 0)
  })

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
    // +5.2% total from 100 → 105.2 (≥ 2 pp beyond 3.1)
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
  beforeEach(() => {
    store.resetStore()
    primeStart('SNDK')
    // Stable defaults per class (disk may have diverged from env defaults)
    const defaults = {
      accelerationAlertDeltaPp: 2,
      materialProgressDeltaPp: 0.5,
      holdingToWeakeningGiveback: 0.25,
      weakeningToHoldingGiveback: 0.2,
      strongWeakeningGiveback: 0.6,
      episodeInactivityExpiryMin: 180,
      rearmBufferPp: 1,
      majorFadeAlertEnabled: true,
      startPushMaxAgeMs: 5 * 60_000,
      startedStateMinDwellMs: 60_000,
    }
    applyEpisodePolicyOverrides(
      {
        byClass: {
          equity: { ...defaults },
          commodity: { ...defaults },
          forex: { ...defaults },
          crypto: { ...defaults },
          index: { ...defaults },
        },
      },
      'equity',
    )
  })

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

  it('AT-07: ≥2 pp beyond last notified → one acceleration push', () => {
    const started = startUp({ currentPrice: 105.2, referencePrice: 100 })
    started.episode.lastNotifiedEpisodeMovePct = 5.2
    started.episode.lastNotifiedPrice = 105.2
    started.episode.peakPrice = 105.2
    // +7.3% → +2.1 pp beyond last notified (threshold is 2 pp)
    const big = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 7.3, day: 6 },
      strongest: { window: '5m', movePercent: 7.3, direction: 'UP' },
      currentPrice: 107.3,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:30:00.000Z',
    })
    const accels = big.events.filter((e) => e.eventType === 'MOMENTUM_ACCELERATING')
    assert.equal(accels.length, 1)
    assert.equal(accels[0].shouldNotify, true)
    assert.ok(
      Math.abs(big.episode.lastNotifiedEpisodeMovePct - 7.3) < 0.05,
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
    // 50% is below the 60% strong-giveback band → no STRONG_WEAKENING push
    assert.equal(
      fade.events.filter(
        (e) =>
          e.eventType === 'MOMENTUM_STRONG_WEAKENING' ||
          e.eventType === 'MOMENTUM_STRONG_REVERSAL',
      ).length,
      0,
    )
  })

  it('AT-08b: ≥60% giveback → strong push + recovery anchor; small ticks silent; +2pp re-accel; cycle reset', () => {
    // Peak +10% at $110. Fade to +4% = 60% giveback
    const started = startUp({
      currentPrice: 110,
      referencePrice: 100,
      nowIso: '2026-01-01T13:10:00.000Z',
    })
    started.episode.lastNotifiedEpisodeMovePct = 10
    started.episode.peakPrice = 110
    started.episode.peakMovePercent = 10
    started.episode.lastMaterialProgressAt = '2026-01-01T13:10:00.000Z'

    const fade = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 4, day: 4 },
      strongest: { window: '5m', movePercent: 4, direction: 'UP' },
      currentPrice: 104,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:20:00.000Z',
    })
    assert.equal(fade.episode?.state, 'STRONGLY_WEAKENING')
    assert.equal(fade.episode?.strongWeakeningPushSentInCycle, true)
    assert.equal(fade.episode?.awaitingReAcceleration, true)
    // Recovery anchor = remaining +4%
    assert.ok(Math.abs(fade.episode.lastNotifiedEpisodeMovePct - 4) < 0.05)
    const strong = fade.events.filter(
      (e) => e.eventType === 'MOMENTUM_STRONG_WEAKENING',
    )
    assert.equal(strong.length, 1)
    assert.ok(strong[0].notification?.title.includes('given back'))
    assert.ok(strong[0].idempotencyKey?.includes('MOMENTUM_STRONG_WEAKENING'))
    assert.equal(strong[0].cycleNumber, 1)

    // +4 → +5.2: small recovery, SILENT (no RE_ACCEL push)
    const tick = advanceEpisode({
      episode: fade.episode,
      returns: { '5m': 5.2, day: 5 },
      strongest: { window: '5m', movePercent: 5.2, direction: 'UP' },
      currentPrice: 105.2,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:21:00.000Z',
    })
    assert.equal(
      tick.events.filter((e) => e.eventType === 'MOMENTUM_ACCELERATING').length,
      0,
    )
    assert.equal(
      tick.events.filter((e) => e.eventType === 'MOMENTUM_STRONG_WEAKENING')
        .length,
      0,
    )

    // +4 → +6: +2pp vs recovery anchor → RE_ACCELERATING push
    const re = advanceEpisode({
      episode: tick.episode,
      returns: { '5m': 6, day: 6 },
      strongest: { window: '5m', movePercent: 6, direction: 'UP' },
      currentPrice: 106,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:22:00.000Z',
    })
    const accels = re.events.filter(
      (e) => e.eventType === 'MOMENTUM_ACCELERATING',
    )
    assert.equal(accels.length, 1)
    assert.equal(accels[0].state, 'RE_ACCELERATING')
    assert.ok(accels[0].notification?.title.includes('accelerating again'))
    // Cycle reset so a later fade can alert again
    assert.equal(re.episode?.awaitingReAcceleration, false)
    assert.equal(re.episode?.strongWeakeningPushSentInCycle, false)
    assert.equal(re.episode?.hadReAcceleration, true)

    // Further +2pp → ACCELERATING (extends recovery), not another RE_ACCEL
    const ext = advanceEpisode({
      episode: re.episode,
      returns: { '5m': 8, day: 8 },
      strongest: { window: '5m', movePercent: 8, direction: 'UP' },
      currentPrice: 108,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:23:00.000Z',
    })
    const extEv = ext.events.find((e) => e.eventType === 'MOMENTUM_ACCELERATING')
    assert.ok(extEv)
    assert.equal(extEv.state, 'ACCELERATING')
    assert.ok(extEv.notification?.title.includes('extends its recovery'))

    // Second strong fade from new peak +8% → +3.2% (60%) can alert again
    ext.episode.peakPrice = 108
    ext.episode.peakMovePercent = 8
    ext.episode.lastMaterialProgressAt = '2026-01-01T13:23:00.000Z'
    const fade2 = advanceEpisode({
      episode: ext.episode,
      returns: { '5m': 3.2, day: 3 },
      strongest: { window: '5m', movePercent: 3.2, direction: 'UP' },
      currentPrice: 103.2,
      referencePrice: 100,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:30:00.000Z',
    })
    assert.equal(
      fade2.events.filter((e) => e.eventType === 'MOMENTUM_STRONG_WEAKENING')
        .length,
      1,
    )
    assert.equal(fade2.episode?.strongWeakeningCycle, 2)
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
    // Reverse opposite episode freezes shortest qualifying DOWN window
    assert.equal(flip.episode?.detectedWindow, '5m')
    const rev = flip.events.find((e) => e.eventType === 'MOMENTUM_REVERSED')
    // Reverse push waits for Perplexity reverse-research (same as STARTED)
    assert.equal(rev.shouldNotify, false)
    // Opposite START is internal only — no second research/push for that leg
    const startAfter = flip.events.find((e) => e.eventType === 'MOMENTUM_STARTED')
    assert.equal(startAfter.shouldNotify, false)
    assert.equal(startAfter.reason, 'AFTER_REVERSAL')
    assert.equal(startAfter.detectedWindow, '5m')
    assert.equal(
      startAfter.startSelection?.rule,
      'shortest_qualifying_window_sets_direction',
    )
    const pushWorthy = flip.events.filter((e) => e.shouldNotify)
    assert.equal(pushWorthy.length, 0)
  })

  it('reversal freezes shortest opposite window among multi-window hits', () => {
    const started = startUp({
      currentPrice: 105,
      referencePrice: 100,
      nowIso: '2026-01-01T13:10:00.000Z',
    })
    // Erase UP; multiple DOWN windows hot — 5m shortest wins for new episode
    const flip = advanceEpisode({
      episode: started.episode,
      returns: { '5m': -3.5, '15m': -4.5, '60m': -6, day: -2 },
      strongest: { window: '60m', movePercent: -6, direction: 'DOWN' },
      currentPrice: 99,
      referencePrice: 100,
      references: {
        '5m': 102.6,
        '15m': 103.7,
        '60m': 105.3,
      },
      referenceTimes: {
        '5m': '2026-01-01T14:00:00.000Z',
        '15m': '2026-01-01T13:50:00.000Z',
        '60m': '2026-01-01T13:05:00.000Z',
      },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:05:00.000Z',
    })
    assert.equal(flip.closedEpisode?.status, 'REVERSED')
    assert.equal(flip.episode?.direction, 'DOWN')
    assert.equal(flip.episode?.detectedWindow, '5m')
    assert.equal(flip.episode?.referencePrice, 102.6)
    const startAfter = flip.events.find(
      (e) => e.eventType === 'MOMENTUM_STARTED' && e.reason === 'AFTER_REVERSAL',
    )
    assert.equal(startAfter?.detectedWindow, '5m')
    assert.ok(
      startAfter?.startSelection?.alsoQualified?.some((w) => w.window === '60m'),
    )
  })

  it('AT-10: 3 eligible trading hours without material momentum expires', () => {
    const started = startUp({
      currentPrice: 105.2,
      referencePrice: 100,
      nowIso: '2026-01-01T13:10:00.000Z',
    })
    started.episode.lastNotifiedEpisodeMovePct = 5.2
    started.episode.meaningfulExtremeMovePct = 5.2
    started.episode.lastMaterialProgressAt = '2026-01-01T13:10:00.000Z'
    started.episode.lastMaterialMomentumAt = '2026-01-01T13:10:00.000Z'
    started.episode.peakPrice = 105.2

    const stillLive = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 4.0, day: 4 },
      strongest: { window: '5m', movePercent: 4.0, direction: 'UP' },
      currentPrice: 104.0,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T15:00:00.000Z',
    })
    assert.equal(stillLive.episode?.status, 'ACTIVE')

    const expired = advanceEpisode({
      episode: stillLive.episode,
      returns: { '5m': 4.0, day: 4 },
      strongest: { window: '5m', movePercent: 4.0, direction: 'UP' },
      currentPrice: 104.0,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T16:20:00.000Z',
    })
    assert.equal(expired.episode, null)
    assert.equal(expired.closedEpisode?.endReason, 'NO_MATERIAL_MOMENTUM_3H')
  })

  it('AT-10b: 3 eligible hours without material momentum → silent expire', () => {
    const started = startUp({
      currentPrice: 105.2,
      referencePrice: 100,
      nowIso: '2026-01-02T21:30:00.000Z', // after-hours start
    })
    started.episode.lastNotifiedEpisodeMovePct = 5.2
    started.episode.meaningfulExtremeMovePct = 5.2
    started.episode.lastMaterialProgressAt = '2026-01-02T21:30:00.000Z'
    started.episode.peakPrice = 105.2
    started.episode.episodeStartedAt = '2026-01-02T21:30:00.000Z'
    started.episode.triggerTime = '2026-01-02T21:30:00.000Z'

    // After-hours-started episode: POST inactivity still expires (not market-close)
    const ended = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 4.0, day: 4 },
      strongest: { window: '5m', movePercent: 4.0, direction: 'UP' },
      currentPrice: 104.0,
      marketSession: 'POST',
      nowIso: '2026-01-03T00:40:00.000Z', // 3h10m later
    })
    assert.equal(ended.episode, null)
    const endEv = ended.events.find((e) => e.eventType === 'MOMENTUM_ENDED')
    assert.ok(endEv)
    assert.equal(endEv.reason, 'NO_MATERIAL_MOMENTUM_3H')
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
    assert.ok(EPISODE_INACTIVITY_EXPIRY_MIN >= 180)
    assert.ok(MATERIAL_PROGRESS_DELTA_PP <= 0.5)
  })

  it('race: research for #001 after #002 is live → NO push', async () => {
    store.resetStore('SNDK')
    store.ensureTicker('SNDK')
    store.setActiveEpisode('SNDK', {
      episodeId: 'SNDK-ep-002',
      status: 'ACTIVE',
      direction: 'UP',
      detectedWindow: '5m',
    })
    const startEv = {
      eventType: 'MOMENTUM_STARTED',
      episodeId: 'SNDK-ep-001',
      detectedAt: new Date().toISOString(),
      detectedWindow: '5m',
      direction: 'UP',
      movePercent: 5.2,
      price: 105.2,
      exactMinutes: 5,
      exactLabel: '5 minutes',
      referencePrice: 100,
      referenceTime: '2026-01-01T12:55:00.000Z',
      triggerPrice: 105.2,
    }
    const r = await handleAutoStartResearchAlerts({
      ticker: 'SNDK',
      events: [startEv],
      episode: {
        episodeId: 'SNDK-ep-001',
        status: 'EXPIRED',
        direction: 'UP',
        initialMovePercent: 5.2,
        exactMinutes: 5,
        exactLabel: '5 minutes',
        referencePrice: 100,
        referenceTime: '2026-01-01T12:55:00.000Z',
        triggerPrice: 105.2,
      },
      snapshot: { marketSession: 'REGULAR' },
    })
    assert.equal(r.results?.[0]?.reason, 'episode_not_active')
    assert.equal(r.results?.[0]?.frozenTrigger?.episodeId, 'SNDK-ep-001')
    assert.equal(r.results?.[0]?.frozenTrigger?.triggerMovePct, 5.2)
    const alerts = store
      .listEvents('SNDK', 50)
      .filter((e) => e.eventType === 'MOMENTUM_ALERT_SENT')
    assert.equal(alerts.length, 0)
  })

  it('race: expire while research in flight → NO push when complete', async () => {
    store.resetStore('SNDK')
    store.ensureTicker('SNDK')
    // Live is gone (expired) — same as mid-research expire
    store.setActiveEpisode('SNDK', null)
    const startEv = {
      eventType: 'MOMENTUM_STARTED',
      episodeId: 'SNDK-ep-exp',
      detectedAt: new Date().toISOString(),
      detectedWindow: '5m',
      direction: 'UP',
      movePercent: 6.1,
      price: 106.1,
      exactMinutes: 12,
      exactLabel: '12 minutes',
      referencePrice: 100,
      referenceTime: '2026-01-01T12:48:00.000Z',
    }
    const r = await handleAutoStartResearchAlerts({
      ticker: 'SNDK',
      events: [startEv],
      episode: {
        episodeId: 'SNDK-ep-exp',
        status: 'EXPIRED',
        direction: 'UP',
        initialMovePercent: 6.1,
        exactMinutes: 12,
        exactLabel: '12 minutes',
        referencePrice: 100,
        referenceTime: '2026-01-01T12:48:00.000Z',
      },
      snapshot: { marketSession: 'REGULAR' },
    })
    assert.equal(r.results?.[0]?.reason, 'episode_not_active')
    assert.equal(
      store.listEvents('SNDK', 50).filter((e) => e.eventType === 'MOMENTUM_ALERT_SENT')
        .length,
      0,
    )
  })

  it('START push TTL: research late after max age → research ok, push suppressed', async () => {
    store.resetStore('SNDK')
    store.ensureTicker('SNDK')
    const episodeId = 'SNDK-ep-stale-start'
    store.setActiveEpisode('SNDK', {
      episodeId,
      status: 'ACTIVE',
      direction: 'UP',
      detectedWindow: '5m',
      triggerTime: new Date(Date.now() - START_PUSH_MAX_AGE_MS - 60_000).toISOString(),
    })
    // Trigger was more than START_PUSH_MAX_AGE ago (default 5m)
    const staleAt = new Date(Date.now() - START_PUSH_MAX_AGE_MS - 60_000).toISOString()
    const r = await handleAutoStartResearchAlerts({
      ticker: 'SNDK',
      events: [
        {
          eventType: 'MOMENTUM_STARTED',
          episodeId,
          detectedAt: staleAt,
          detectedWindow: '5m',
          direction: 'UP',
          movePercent: 3.5,
          price: 103.5,
          exactMinutes: 5,
          exactLabel: '5 minutes',
          referencePrice: 100,
          referenceTime: staleAt,
          triggerPrice: 103.5,
        },
      ],
      episode: {
        episodeId,
        status: 'ACTIVE',
        direction: 'UP',
        initialMovePercent: 3.5,
        triggerTime: staleAt,
        exactMinutes: 5,
        exactLabel: '5 minutes',
        referencePrice: 100,
      },
      snapshot: { marketSession: 'REGULAR' },
    })
    assert.equal(r.results?.[0]?.reason, 'start_push_stale')
    assert.ok(r.results?.[0]?.ageMs > START_PUSH_MAX_AGE_MS)
    // Research timeline may still show DONE; no ALERT_SENT push
    assert.equal(
      store.listEvents('SNDK', 50).filter((e) => e.eventType === 'MOMENTUM_ALERT_SENT')
        .length,
      0,
    )
    assert.ok(START_PUSH_MAX_AGE_MS >= 3 * 60_000)
    assert.ok(START_PUSH_MAX_AGE_MS <= 5 * 60_000)
  })

  it('claimActiveEpisode: second concurrent START loses', () => {
    store.resetStore('SNDK')
    const a = store.claimActiveEpisode('SNDK', {
      episodeId: 'ep-a',
      status: 'ACTIVE',
      direction: 'UP',
    })
    assert.equal(a.ok, true)
    const b = store.claimActiveEpisode('SNDK', {
      episodeId: 'ep-b',
      status: 'ACTIVE',
      direction: 'UP',
    })
    assert.equal(b.ok, false)
    assert.equal(b.reason, 'already_active')
    assert.equal(store.getActiveEpisode('SNDK')?.episodeId, 'ep-a')
  })

  it('cross-window: expired 3h UP must not re-START on still-hot 24h', () => {
    store.resetStore('SNDK')
    applyThresholdOverrides({ '3h': 6, '24h': 5, '5m': 3 })
    primeStart('SNDK')
    // 10:00 — 3h +7% and 24h +7.5% both qualify → START shortest (3h)
    const started = advanceEpisode({
      episode: null,
      returns: { '3h': 7, '24h': 7.5, '5m': 1, day: 2 },
      strongest: { window: '24h', movePercent: 7.5, direction: 'UP' },
      currentPrice: 107,
      referencePrice: 100,
      references: { '3h': 100, '24h': 99.3 },
      referenceTimes: {
        '3h': '2026-01-01T07:00:00.000Z',
        '24h': '2025-12-31T10:00:00.000Z',
      },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T10:00:00.000Z',
    })
    assert.equal(started.episode?.detectedWindow, '3h')
    assert.equal(started.episode?.status, 'ACTIVE')
    assert.equal(
      started.events.filter((e) => e.eventType === 'MOMENTUM_STARTED').length,
      1,
    )

    // Episode later EXPIRES (POST — REGULAR no longer quiet-expires) → UP DISARMED
    const exp = advanceEpisode({
      episode: {
        ...started.episode,
        // Pretend this leg continued into after-hours (started POST) so expire ≠ market-close
        episodeStartedAt: '2026-01-01T21:30:00.000Z',
        triggerTime: '2026-01-01T21:30:00.000Z',
        lastMaterialProgressAt: '2026-01-01T21:30:00.000Z',
        peakPrice: 107.5,
        peakMovePercent: 7.5,
      },
      returns: { '3h': 6.5, '24h': 7, '5m': 0.5 },
      strongest: { window: '24h', movePercent: 7, direction: 'UP' },
      currentPrice: 106.5,
      marketSession: 'POST',
      nowIso: '2026-01-02T00:40:00.000Z',
    })
    assert.equal(exp.episode, null)
    assert.equal(exp.closedEpisode?.status, 'EXPIRED')
    const gate = store.getRearmGate('SNDK')
    assert.ok(gate)
    assert.equal(gate.armed, false)
    assert.equal(gate.direction, 'UP')
    assert.equal(gate.policy, 'FULL')

    // 15:00 — 3h no longer qualifies; 24h still +6% → MUST NOT START / PUSH
    const later = advanceEpisode({
      episode: null,
      returns: { '3h': 2, '24h': 6, '5m': 0.5, day: 3 },
      strongest: { window: '24h', movePercent: 6, direction: 'UP' },
      currentPrice: 106,
      references: { '24h': 100, '3h': 104 },
      referenceTimes: {
        '24h': '2026-01-01T15:00:00.000Z',
        '3h': '2026-01-01T12:00:00.000Z',
      },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T15:00:00.000Z',
    })
    assert.equal(later.episode, null)
    assert.equal(
      later.events.filter((e) => e.eventType === 'MOMENTUM_STARTED').length,
      0,
    )
    assert.ok(later.logs.some((l) => /disarmed|start blocked|no fresh/i.test(l)))

    // Continuous polls while 24h stays qualified → still no UP episode
    for (let i = 0; i < 8; i += 1) {
      const poll = advanceEpisode({
        episode: null,
        returns: { '3h': 1.2, '24h': 5.5 + i * 0.01, '5m': 0.3 },
        strongest: { window: '24h', movePercent: 5.5, direction: 'UP' },
        currentPrice: 105.5,
        marketSession: 'REGULAR',
        nowIso: `2026-01-01T15:${String(i).padStart(2, '0')}:00.000Z`,
      })
      assert.equal(
        poll.episode,
        null,
        `poll ${i}: must not re-START on lingering 24h`,
      )
    }

    // P0: 5m already above its thr while 3h cool — still blocked if any window
    // is above its own thr−buffer (5m thr 3 → floor 2; 5m=4% blocks re-arm)
    const shortWhileHot = advanceEpisode({
      episode: null,
      returns: { '3h': 2, '24h': 1, '5m': 4, day: 1 },
      strongest: { window: '5m', movePercent: 4, direction: 'UP' },
      currentPrice: 104,
      references: { '5m': 100, '24h': 103 },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T15:30:00.000Z',
    })
    assert.equal(shortWhileHot.episode, null)
    assert.ok(
      shortWhileHot.logs.some((l) => /disarmed|start blocked|no fresh/i.test(l)),
    )
    assert.equal(store.getRearmGate('SNDK')?.armed, false)

    // Genuinely cool: every window below its own thr−1pp
    const cool = advanceEpisode({
      episode: null,
      returns: { '3h': 1, '24h': 1, '5m': 0.5, day: 1, '60m': 1 },
      strongest: { window: '24h', movePercent: 1, direction: 'UP' },
      currentPrice: 101,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T16:00:00.000Z',
    })
    assert.equal(cool.episode, null)
    assert.equal(store.getRearmGate('SNDK')?.armed, true)

    // Fresh short move after re-arm → NEW START allowed
    const again = advanceEpisode({
      episode: null,
      returns: { '3h': 1, '24h': 1.5, '5m': 3.1, day: 1.5 },
      strongest: { window: '5m', movePercent: 3.1, direction: 'UP' },
      currentPrice: 103.1,
      references: { '5m': 100 },
      referenceTimes: { '5m': '2026-01-01T16:00:00.000Z' },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T16:05:00.000Z',
    })
    assert.equal(again.episode?.status, 'ACTIVE')
    assert.equal(again.episode?.detectedWindow, '5m')
    assert.notEqual(again.episode?.episodeId, started.episode.episodeId)
    applyThresholdOverrides({ '3h': null, '24h': null })
  })

  it('P0: per-window re-arm — 5m +4% cannot arm after 3h expire while above 5m floor', () => {
    store.resetStore('SNDK')
    applyThresholdOverrides({ '3h': 6, '5m': 3, '60m': 5, '24h': null, day: 5 })
    primeStart('SNDK')
    const started = advanceEpisode({
      episode: null,
      returns: { '3h': 7, '5m': 1, '60m': 2, day: 2 },
      strongest: { window: '3h', movePercent: 7, direction: 'UP' },
      currentPrice: 107,
      references: { '3h': 100 },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T10:00:00.000Z',
    })
    assert.equal(started.episode?.detectedWindow, '3h')
    const exp = advanceEpisode({
      episode: {
        ...started.episode,
        episodeStartedAt: '2026-01-01T21:30:00.000Z',
        triggerTime: '2026-01-01T21:30:00.000Z',
        lastMaterialProgressAt: '2026-01-01T21:30:00.000Z',
      },
      returns: { '3h': 6, '5m': 1, day: 2 },
      currentPrice: 106,
      marketSession: 'POST',
      nowIso: '2026-01-02T00:40:00.000Z',
    })
    assert.equal(exp.closedEpisode?.status, 'EXPIRED')

    // 3h cooled to 2%, but 5m at +4% (above 5m thr 3 and floor 2) → stay DISARMED
    const mid = advanceEpisode({
      episode: null,
      returns: { '3h': 2, '5m': 4, '60m': 2, day: 2 },
      strongest: { window: '5m', movePercent: 4, direction: 'UP' },
      currentPrice: 104,
      references: { '5m': 100 },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T12:00:00.000Z',
    })
    assert.equal(mid.episode, null)
    assert.equal(store.getRearmGate('SNDK')?.armed, false)
    applyThresholdOverrides({ '3h': null, '24h': null })
  })

  it('P0: MARKET_CLOSE allows next-session fresh 5m START while 24h still elevated', () => {
    store.resetStore('SNDK')
    applyThresholdOverrides({ '5m': 3, '24h': 5, day: 5 })
    const started = startUp({ currentPrice: 110, referencePrice: 100 })
    const closed = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 5, '24h': 10, day: 10 },
      currentPrice: 110,
      marketSession: 'CLOSED',
      lifecycleState: 'FULL_CLOSED',
      assetClass: 'equity',
      nowIso: '2026-01-02T01:05:00.000Z',
    })
    assert.equal(closed.closedEpisode?.status, 'CLOSED_AT_MARKET_CLOSE')
    assert.equal(closed.closedEpisode?.endReason, 'MARKET_FULL_CLOSE')
    // No FULL re-arm gate after market close
    assert.equal(store.getRearmGate('SNDK'), null)

    // Seed "prior session" edges as elevated (no fresh cross yet)
    store.setThresholdEdgeState(
      'SNDK',
      {
        '5m': { above: false, direction: null, move: 0.5, thr: 3 },
        '24h': { above: true, direction: 'UP', move: 9, thr: 5 },
        day: { above: true, direction: 'UP', move: 9, thr: 5 },
      },
      'equity',
    )

    // Tuesday open: 24h still +9%, but 5m freshly jumps to +4% → START allowed
    const tue = advanceEpisode({
      episode: null,
      returns: { '5m': 4, '24h': 9, day: 9, '15m': 1 },
      strongest: { window: '5m', movePercent: 4, direction: 'UP' },
      currentPrice: 104,
      references: { '5m': 100 },
      marketSession: 'REGULAR',
      assetClass: 'equity',
      nowIso: '2026-01-02T14:35:00.000Z',
    })
    assert.equal(tue.episode?.status, 'ACTIVE')
    assert.equal(tue.episode?.detectedWindow, '5m')

    // Stale 24h alone (already above last poll) without fresh short cross → no START
    store.setActiveEpisode('SNDK', null)
    store.clearRearmGate('SNDK')
    store.setThresholdEdgeState(
      'SNDK',
      {
        '5m': { above: false, direction: null, move: 0.2, thr: 3 },
        '24h': { above: true, direction: 'UP', move: 9, thr: 5 },
        day: { above: true, direction: 'UP', move: 9, thr: 5 },
      },
      'equity',
    )
    const staleOnly = advanceEpisode({
      episode: null,
      returns: { '5m': 0.2, '24h': 9, day: 9 },
      strongest: { window: '24h', movePercent: 9, direction: 'UP' },
      currentPrice: 109,
      marketSession: 'REGULAR',
      nowIso: '2026-01-02T15:00:00.000Z',
    })
    assert.equal(staleOnly.episode, null)
    applyThresholdOverrides({ '24h': null })
  })

  it('P0: cold start / restart does not START from already-elevated windows', () => {
    store.resetStore('SNDK')
    // No prime — simulates deploy with empty edge state
    store.clearThresholdEdgeState('SNDK')
    applyThresholdOverrides({ '3h': 6, '5m': 3, day: 5 })
    const cold = advanceEpisode({
      episode: null,
      returns: { '5m': 0.5, '1h': 2, '3h': 7, day: 4 },
      strongest: { window: '3h', movePercent: 7, direction: 'UP' },
      currentPrice: 107,
      references: { '3h': 100 },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T18:00:00.000Z',
    })
    assert.equal(cold.episode, null)
    assert.ok(cold.logs.some((l) => /edges seeded|cold start/i.test(l)))
    // Second poll still elevated — still no START (not a fresh cross)
    const still = advanceEpisode({
      episode: null,
      returns: { '5m': 0.5, '1h': 2, '3h': 7.2, day: 4 },
      strongest: { window: '3h', movePercent: 7.2, direction: 'UP' },
      currentPrice: 107.2,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T18:01:00.000Z',
    })
    assert.equal(still.episode, null)
    assert.ok(still.logs.some((l) => /no fresh threshold cross/i.test(l)))
    // Cool then re-cross → START
    advanceEpisode({
      episode: null,
      returns: { '5m': 0.5, '3h': 1, day: 1 },
      currentPrice: 101,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T18:05:00.000Z',
    })
    const fresh = advanceEpisode({
      episode: null,
      returns: { '5m': 3.2, '3h': 1, day: 1 },
      strongest: { window: '5m', movePercent: 3.2, direction: 'UP' },
      currentPrice: 103.2,
      references: { '5m': 100 },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T18:06:00.000Z',
    })
    assert.equal(fresh.episode?.status, 'ACTIVE')
    assert.equal(fresh.episode?.detectedWindow, '5m')
    applyThresholdOverrides({ '3h': null })
  })

  it('soft pre-market day: already above thr → START (cold + after edges seeded hot)', () => {
    store.resetStore('SKHY')
    store.clearThresholdEdgeState('SKHY')
    applyThresholdOverrides({ day: 3, '5m': 3 })
    const cold = advanceEpisode({
      ticker: 'SKHY',
      episode: null,
      returns: { '5m': 0.05, day: 4.05 },
      strongest: { window: 'day', movePercent: 4.05, direction: 'UP' },
      currentPrice: 173.07,
      referencePrice: 166.33,
      references: { day: 166.33 },
      referenceTimes: { day: '2026-08-14T20:00:00.000Z' },
      marketSession: 'PRE',
      nowIso: '2026-08-17T10:12:00.000Z',
    })
    assert.equal(cold.episode?.status, 'ACTIVE')
    assert.equal(cold.episode?.detectedWindow, 'day')
    assert.equal(cold.episode?.direction, 'UP')
    assert.equal(cold.episode?.exactLabel, 'pre-market')
    assert.equal(cold.episode?.marketSession, 'PRE')
    assert.ok(
      cold.logs.some((l) => /pre-market day already|allowing START|soft pre-market/i.test(l)),
    )
    assert.ok(
      cold.events.some(
        (e) =>
          e.eventType === 'MOMENTUM_STARTED' &&
          e.detectedWindow === 'day' &&
          e.exactLabel === 'pre-market',
      ),
    )

    // Edges already seeded hot (no episode) — still START in PRE (SKHY stuck case)
    store.resetStore('SKHY3')
    store.clearThresholdEdgeState('SKHY3')
    // Seed edges with day already above (simulates earlier poll under old rule)
    store.setThresholdEdgeState(
      'SKHY3',
      {
        day: { above: true, direction: 'UP', move: 4.05, thr: 3 },
        '5m': { above: false, direction: 'UP', move: 0.05, thr: 3 },
      },
      'equity',
    )
    const stuck = advanceEpisode({
      ticker: 'SKHY3',
      episode: null,
      returns: { '5m': 0.05, day: 4.08 },
      currentPrice: 173.11,
      references: { day: 166.33 },
      referenceTimes: { day: '2026-08-14T20:00:00.000Z' },
      marketSession: 'PRE',
      nowIso: '2026-08-17T10:22:00.000Z',
    })
    assert.equal(stuck.episode?.status, 'ACTIVE')
    assert.equal(stuck.episode?.detectedWindow, 'day')
    assert.ok(
      stuck.logs.some((l) => /soft pre-market day|without cool-then-re-cross/i.test(l)),
    )

    // RTH cold start with day elevated still does NOT soft-start
    store.resetStore('SKHY2')
    store.clearThresholdEdgeState('SKHY2')
    const rth = advanceEpisode({
      ticker: 'SKHY2',
      episode: null,
      returns: { '5m': 0.05, day: 4.05 },
      currentPrice: 173.07,
      references: { day: 166.33 },
      marketSession: 'REGULAR',
      nowIso: '2026-08-17T15:00:00.000Z',
    })
    assert.equal(rth.episode, null)
    assert.ok(rth.logs.some((l) => /edges seeded|cold start/i.test(l)))
  })

  it('re-arm: after expire at high %, small dips do not START; only after cool + thr', () => {
    store.clearRearmGate('SNDK')
    store.clearRestartGate('SNDK')
    // thr for 5m is typically 3 in defaults — pin via hit.threshold path using returns
    const started = startUp({ currentPrice: 114, referencePrice: 100 }) // +14%
    assert.equal(started.episode?.status, 'ACTIVE')
    // Force expire via 3h+ of no material momentum (eligible / wall-clock in tests)
    const exp = advanceEpisode({
      episode: {
        ...started.episode,
        episodeStartedAt: '2026-01-01T21:30:00.000Z',
        triggerTime: '2026-01-01T21:30:00.000Z',
        lastMaterialProgressAt: '2026-01-01T21:30:00.000Z',
        peakPrice: 114,
        peakMovePercent: 14,
      },
      returns: { '5m': 14, day: 14 },
      strongest: { window: '5m', movePercent: 14, direction: 'UP' },
      currentPrice: 114,
      marketSession: 'POST',
      nowIso: '2026-01-02T00:40:00.000Z',
    })
    assert.equal(exp.episode, null)
    assert.equal(exp.closedEpisode?.status, 'EXPIRED')
    const gate = store.getRearmGate('SNDK')
    assert.ok(gate)
    assert.equal(gate.armed, false)
    assert.equal(gate.direction, 'UP')

    // Still elevated +8% — disarmed, no new START even if above thr
    const stillHigh = advanceEpisode({
      episode: null,
      returns: { '5m': 8, day: 8 },
      strongest: { window: '5m', movePercent: 8, direction: 'UP' },
      currentPrice: 108,
      referencePrice: 100,
      referenceTime: '2026-01-01T13:55:00.000Z',
      references: { '5m': 100 },
      referenceTimes: { '5m': '2026-01-01T13:55:00.000Z' },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:01:00.000Z',
    })
    assert.equal(stillHigh.episode, null)
    assert.ok(
      stillHigh.logs.some((l) => /disarmed|start blocked/i.test(l)),
    )

    // Cool below re-arm (thr~3, buffer 1 → rearm < 2) — use 1.5%
    const cool = advanceEpisode({
      episode: null,
      returns: { '5m': 1.5, day: 1.5 },
      strongest: { window: '5m', movePercent: 1.5, direction: 'UP' },
      currentPrice: 101.5,
      referencePrice: 100,
      referenceTime: '2026-01-01T13:55:00.000Z',
      references: { '5m': 100 },
      referenceTimes: { '5m': '2026-01-01T13:55:00.000Z' },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:02:00.000Z',
    })
    assert.equal(cool.episode, null) // below thr — no start
    assert.equal(store.getRearmGate('SNDK')?.armed, true)

    // Cross thr again → fresh START
    const again = advanceEpisode({
      episode: null,
      returns: { '5m': 3.5, day: 2 },
      strongest: { window: '5m', movePercent: 3.5, direction: 'UP' },
      currentPrice: 103.5,
      referencePrice: 100,
      referenceTime: '2026-01-01T14:00:00.000Z',
      references: { '5m': 100 },
      referenceTimes: { '5m': '2026-01-01T14:00:00.000Z' },
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:03:00.000Z',
    })
    assert.equal(again.episode?.status, 'ACTIVE')
    assert.notEqual(again.episode?.episodeId, started.episode.episodeId)
    assert.equal(store.getRearmGate('SNDK'), null) // cleared on start
  })

  it('terminal EXPIRED: no further Weakening / Accel / second expire', () => {
    const started = startUp({ currentPrice: 110, referencePrice: 100 })
    // Freeze progress clock then wait past inactivity window (POST session)
    const ep = {
      ...started.episode,
      episodeStartedAt: '2026-01-01T21:30:00.000Z',
      triggerTime: '2026-01-01T21:30:00.000Z',
      lastMaterialProgressAt: '2026-01-01T21:30:00.000Z',
      peakPrice: 110,
      peakMovePercent: 10,
      currentMovePercent: 10,
    }
    const expired = advanceEpisode({
      episode: ep,
      returns: { '5m': 4.0, day: 4 },
      strongest: { window: '5m', movePercent: 4.0, direction: 'UP' },
      currentPrice: 104,
      marketSession: 'POST',
      nowIso: '2026-01-02T00:40:00.000Z',
    })
    assert.equal(expired.episode, null)
    assert.equal(expired.closedEpisode?.status, 'EXPIRED')
    const ends = expired.events.filter((e) => e.eventType === 'MOMENTUM_ENDED')
    assert.equal(ends.length, 1)
    assert.equal(ends[0].reason, 'NO_MATERIAL_MOMENTUM_3H')
    // No Weakening/Accel after terminal decision (expiry runs first)
    assert.equal(
      expired.events.filter((e) => e.eventType === 'MOMENTUM_STATE').length,
      0,
    )

    // Terminal object is dropped (not re-weakened). May open a NEW episode if
    // thresholds still fire — but never mutate the old expired episode.
    const again = advanceEpisode({
      episode: expired.closedEpisode,
      returns: { '5m': 3.0, day: 3 },
      strongest: { window: '5m', movePercent: 3.0, direction: 'UP' },
      currentPrice: 103,
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T14:06:00.000Z',
    })
    const weakOnOld = (again.events || []).filter(
      (e) =>
        e.eventType === 'MOMENTUM_STATE' &&
        e.episodeId === expired.closedEpisode.episodeId,
    )
    assert.equal(weakOnOld.length, 0)
    if (again.episode) {
      assert.notEqual(again.episode.episodeId, expired.closedEpisode.episodeId)
      assert.equal(again.episode.status, 'ACTIVE')
    }
  })

  it('episode move % always uses frozen referencePrice (not day window)', () => {
    const started = startUp({ currentPrice: 110, referencePrice: 100 })
    // Live price moves; returns.day may disagree — episode must use referencePrice
    const mid = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 2.0, day: 13.8, '24h': 18.0 },
      strongest: { window: 'day', movePercent: 13.8, direction: 'UP' },
      currentPrice: 105,
      referencePrice: 999, // must NOT rebind
      marketSession: 'REGULAR',
      nowIso: '2026-01-01T13:05:00.000Z',
    })
    assert.equal(mid.episode?.referencePrice, 100)
    // (105-100)/100 = 5%
    assert.ok(Math.abs(Number(mid.episode?.currentMovePercent) - 5) < 1e-6)
    assert.equal(mid.episode?.detectedWindow, started.episode.detectedWindow)
  })

  it('AT-12: FULL_CLOSED archives episodes immediately', () => {
    const started = startUp({ currentPrice: 105.2, referencePrice: 100 })
    const closed = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 5.0, day: 5 },
      strongest: { window: '5m', movePercent: 5.0, direction: 'UP' },
      currentPrice: 105.0,
      marketSession: 'CLOSED',
      lifecycleState: 'FULL_CLOSED',
      assetClass: 'equity',
      nowIso: '2026-01-02T01:00:00.000Z',
    })
    assert.equal(closed.episode, null)
    const endEv = closed.events.find((e) => e.eventType === 'MOMENTUM_ENDED')
    assert.equal(endEv?.reason, 'MARKET_FULL_CLOSE')
    assert.equal(endEv?.shouldNotify, false)
  })

  it('AT-12c: POST after RTH does NOT end the episode (still tradable)', () => {
    const started = startUp({
      currentPrice: 105.2,
      referencePrice: 100,
      nowIso: '2026-01-02T15:00:00.000Z',
    })
    started.episode.lastMaterialMomentumAt = '2026-01-02T20:30:00.000Z'
    started.episode.lastMaterialProgressAt = '2026-01-02T20:30:00.000Z'
    const still = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 4.0, day: 5 },
      strongest: { window: '5m', movePercent: 4.0, direction: 'UP' },
      currentPrice: 104.0,
      marketSession: 'POST',
      lifecycleState: 'POST_MARKET',
      assetClass: 'equity',
      nowIso: '2026-01-02T21:05:00.000Z',
    })
    assert.equal(still.episode?.status, 'ACTIVE')
  })

  it('AT-12d: weekend FULL_CLOSED ends the episode', () => {
    // Episode started Saturday (CLOSED calendar) — must not hard-close on CLOSED
    const started = startUp({
      currentPrice: 105.2,
      referencePrice: 100,
      nowIso: '2026-01-03T18:00:00.000Z', // Sat 13:00 ET → CLOSED
    })
    started.episode.episodeStartedAt = '2026-01-03T18:00:00.000Z'
    started.episode.triggerTime = '2026-01-03T18:00:00.000Z'
    // Keep well inside inactivity window
    started.episode.lastMaterialProgressAt = '2026-01-03T18:00:00.000Z'
    const closed = advanceEpisode({
      episode: started.episode,
      returns: { '5m': 4.0, day: 5 },
      strongest: { window: '5m', movePercent: 4.0, direction: 'UP' },
      currentPrice: 104.5,
      marketSession: 'CLOSED',
      lifecycleState: 'FULL_CLOSED',
      assetClass: 'equity',
      nowIso: '2026-01-03T18:20:00.000Z',
    })
    assert.equal(closed.episode, null)
    assert.equal(closed.closedEpisode?.endReason, 'MARKET_FULL_CLOSE')
  })

  it('AT-12b: commodities do NOT hard-close on US equity session CLOSED', () => {
    primeStart('GC=F')
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
    // Eligibility uses device_monitor (in-app watchlist), not dashboard tabs.
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
  beforeEach(() => {
    store.resetStore()
    primeStart('SNDK')
  })

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
