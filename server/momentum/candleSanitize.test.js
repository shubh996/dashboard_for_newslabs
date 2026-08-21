/**
 * Run: node --test server/momentum/candleSanitize.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeMomentumCandles,
  candleAtOrBefore,
  isYahooRegularMarketState,
} from './candles.js'
import { computeRollingReturns } from './returns.js'

describe('sanitizeMomentumCandles', () => {
  it('drops Yahoo AH outlier prints that disagree with quote anchors', () => {
    const t0 = Date.parse('2026-08-21T20:00:00.000Z') // 4:00 PM EDT
    const candles = []
    // RTH close area
    for (let i = 0; i < 10; i += 1) {
      candles.push({ t: t0 + i * 60_000, close: 483.2 + i * 0.01 })
    }
    // After-hours: mostly ~482.6 with garbage 467 spikes (real MSFT shape)
    const ah = [
      482.7, 482.65, 482.6, 472.15, 482.5, 472.47, 482.4, 467.18, 467.18, 482.62,
    ]
    for (let i = 0; i < ah.length; i += 1) {
      candles.push({ t: t0 + (60 + i) * 60_000, close: ah[i] })
    }

    const live = 482.62
    const regular = 483.24
    const cleaned = sanitizeMomentumCandles(candles, {
      anchors: [live, regular],
    })
    const dropped = candles.length - cleaned.length
    assert.ok(dropped >= 3, `expected outliers dropped, got dropped=${dropped}`)
    assert.ok(cleaned.every((c) => c.close > 480), 'no 467-class prints remain')

    // Reference at last AH minute must not be the 467 spike
    const asOf = candles[candles.length - 1].t
    const hist = candleAtOrBefore(cleaned, asOf - 2 * 60_000)
    assert.ok(hist)
    assert.ok(hist.close > 480)

    const { returns, references } = computeRollingReturns(
      cleaned,
      live,
      asOf,
      regular,
      new Date(t0).toISOString(),
    )
    // Day vs regular close ≈ Yahoo post % (~-0.13%), not a fake multi-% move
    assert.ok(returns.day != null)
    assert.ok(Math.abs(returns.day) < 1, `day move absurd: ${returns.day}`)
    assert.equal(references.day, regular)
  })

  it('keeps a real spike that matches the live quote', () => {
    const t0 = Date.now() - 20 * 60_000
    const candles = []
    for (let i = 0; i < 15; i += 1) {
      candles.push({ t: t0 + i * 60_000, close: 100 })
    }
    // Last bar jumps to 108 and live quote agrees
    candles.push({ t: t0 + 15 * 60_000, close: 108 })
    const cleaned = sanitizeMomentumCandles(candles, { anchors: [108, 100] })
    assert.equal(cleaned[cleaned.length - 1].close, 108)
  })
})

describe('isYahooRegularMarketState', () => {
  it('runs only on Yahoo REGULAR / OPEN (US, India, LSE, …)', () => {
    assert.equal(isYahooRegularMarketState('REGULAR'), true)
    assert.equal(isYahooRegularMarketState('OPEN'), true)
    assert.equal(isYahooRegularMarketState('POST'), false)
    assert.equal(isYahooRegularMarketState('POSTPOST'), false)
    assert.equal(isYahooRegularMarketState('PRE'), false)
    assert.equal(isYahooRegularMarketState('PREPRE'), false)
    assert.equal(isYahooRegularMarketState('CLOSED'), false)
  })
})
