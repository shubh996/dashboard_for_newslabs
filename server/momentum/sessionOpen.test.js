/**
 * Run: node --test server/momentum/sessionOpen.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveSessionOpenClock,
  resolveSessionOpenPrint,
} from './candles.js'
import { etWallToUtcMs } from './usEquitySession.js'

describe('session open print (PRE / POST lookback)', () => {
  it('PRE open clock is 4:00 AM ET that day', () => {
    // Mon 2026-08-17 12:30 ET ≈ 16:30 UTC (EDT)
    const asOf = Date.parse('2026-08-17T16:30:00.000Z')
    const c = resolveSessionOpenClock('PRE', asOf)
    assert.ok(c)
    const expect = etWallToUtcMs('2026', '08', '17', 4, 0)
    assert.equal(c.openMs, expect)
    assert.match(c.shortLabel, /pre/i)
  })

  it('finds first 1m bar at/after pre open for LOOKBACK', () => {
    const open = etWallToUtcMs('2026', '08', '17', 4, 0)
    assert.ok(open != null)
    const candles = [
      { t: open - 60_000, close: 5.5 },
      { t: open + 60_000, close: 5.2 },
      { t: open + 30 * 60_000, close: 5.1 },
      { t: open + 8 * 60 * 60_000, close: 5.01 },
    ]
    const asOf = open + 8.5 * 60 * 60_000
    const p = resolveSessionOpenPrint(candles, 'PRE', asOf)
    assert.ok(p)
    assert.equal(p.price, 5.2)
    assert.equal(p.timeIso, new Date(open + 60_000).toISOString())
  })

  it('POST open is 4:00 PM ET', () => {
    const asOf = Date.parse('2026-08-17T21:00:00.000Z') // ~5pm ET
    const c = resolveSessionOpenClock('POST', asOf)
    assert.ok(c)
    assert.equal(c.openMs, etWallToUtcMs('2026', '08', '17', 16, 0))
  })

  it('ignores bars far after scheduled open (stale tape)', () => {
    const open = etWallToUtcMs('2026', '08', '17', 4, 0)
    const candles = [{ t: open + 10 * 60 * 60_000, close: 5.0 }]
    const p = resolveSessionOpenPrint(candles, 'PRE', open + 12 * 60 * 60_000)
    assert.equal(p, null)
  })
})
