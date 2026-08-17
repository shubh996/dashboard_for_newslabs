/**
 * Run: node --test server/momentum/usEquitySession.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  etWallToUtcMs,
  formatEtWallInTimeZone,
  formatHmInTimeZone,
  inferUsEquityMarketSession,
  isUsEquityTriggerOpen,
  shouldRunUsEquityTrigger,
  tickerFollowsUsEquityTriggerWindow,
  usEquitySessionId,
  UK_ZONE,
} from './usEquitySession.js'

function et(y, mo, d, hour, minute) {
  const ms = etWallToUtcMs(y, mo, d, hour, minute)
  assert.ok(ms != null, `et wall ${y}-${mo}-${d} ${hour}:${minute}`)
  return ms
}

describe('US equity Trigger window (ET canonical)', () => {
  it('is open Sunday 20:00 ET through Friday 19:59 ET', () => {
    // June 2026 — both sides on DST (EDT / BST)
    assert.equal(isUsEquityTriggerOpen(et('2026', '06', '21', 19, 59)), false) // Sun 19:59
    assert.equal(isUsEquityTriggerOpen(et('2026', '06', '21', 20, 0)), true) // Sun 20:00
    assert.equal(isUsEquityTriggerOpen(et('2026', '06', '22', 3, 59)), true) // Mon overnight
    assert.equal(isUsEquityTriggerOpen(et('2026', '06', '22', 10, 0)), true) // Mon RTH
    assert.equal(isUsEquityTriggerOpen(et('2026', '06', '26', 19, 59)), true) // Fri 19:59
    assert.equal(isUsEquityTriggerOpen(et('2026', '06', '26', 20, 0)), false) // Fri 20:00
    assert.equal(isUsEquityTriggerOpen(et('2026', '06', '27', 12, 0)), false) // Sat noon
  })

  it('session buckets follow ET cutoffs, not London clock', () => {
    assert.equal(usEquitySessionId(et('2026', '06', '22', 20, 15)), 'overnight')
    assert.equal(usEquitySessionId(et('2026', '06', '23', 4, 0)), 'pre-market')
    assert.equal(usEquitySessionId(et('2026', '06', '23', 9, 30)), 'regular')
    assert.equal(usEquitySessionId(et('2026', '06', '23', 16, 0)), 'after-hours')
    assert.equal(usEquitySessionId(et('2026', '06', '26', 20, 0)), 'closed')
    assert.equal(usEquitySessionId(et('2026', '06', '27', 10, 0)), 'closed')
    assert.equal(inferUsEquityMarketSession(et('2026', '06', '21', 20, 5)), 'PRE')
    assert.equal(inferUsEquityMarketSession(et('2026', '06', '23', 15, 0)), 'REGULAR')
    assert.equal(inferUsEquityMarketSession(et('2026', '06', '23', 17, 0)), 'POST')
    assert.equal(inferUsEquityMarketSession(et('2026', '06', '27', 10, 0)), 'CLOSED')
  })

  it('does not use a fixed ET+5 London offset (DST mismatch week)', () => {
    // 2026-03-16: US already on EDT, UK still GMT → London is 4 hours ahead.
    const rthOpen = et('2026', '03', '16', 9, 30)
    const rthClose = et('2026', '03', '16', 16, 0)
    assert.equal(formatHmInTimeZone(rthOpen, UK_ZONE), '13:30')
    assert.equal(formatHmInTimeZone(rthClose, UK_ZONE), '20:00')
    assert.equal(formatEtWallInTimeZone(9, 30, UK_ZONE, rthOpen), '13:30')
    assert.equal(formatEtWallInTimeZone(16, 0, UK_ZONE, rthClose), '20:00')
    // Same ET hours in June (EDT + BST) are 2:30–9:00pm London, not 1:30–8:00.
    const summerOpen = et('2026', '06', '16', 9, 30)
    const summerClose = et('2026', '06', '16', 16, 0)
    assert.equal(formatHmInTimeZone(summerOpen, UK_ZONE), '14:30')
    assert.equal(formatHmInTimeZone(summerClose, UK_ZONE), '21:00')
  })

  it('pauses US equities on the weekend, not crypto or futures', () => {
    const sat = et('2026', '06', '27', 12, 0)
    assert.equal(tickerFollowsUsEquityTriggerWindow('SNDK'), true)
    assert.equal(tickerFollowsUsEquityTriggerWindow('BTC-USD'), false)
    assert.equal(tickerFollowsUsEquityTriggerWindow('GC=F'), false)
    assert.equal(shouldRunUsEquityTrigger('SNDK', sat), false)
    assert.equal(shouldRunUsEquityTrigger('BTC-USD', sat), true)
    assert.equal(shouldRunUsEquityTrigger('GC=F', sat), true)
    assert.equal(shouldRunUsEquityTrigger('SNDK', et('2026', '06', '23', 10, 0)), true)
  })
})
