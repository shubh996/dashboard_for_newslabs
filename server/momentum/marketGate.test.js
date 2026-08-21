/**
 * Spec §18 acceptance tests T01–T15.
 * Run: node --test server/momentum/marketGate.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { etWallToUtcMs, formatHmInTimeZone, UK_ZONE } from './usEquitySession.js'
import { resolveMarketProfile, HEADLINE_PROBES } from './marketProfile.js'
import { resolveSession } from './sessionCalendar.js'
import { evaluateFreshness } from './freshness.js'
import { evaluateSymbolGate } from './engineGate.js'
import { walkBackEligibleTradingMinutes } from './tradingTime.js'
import { aggregatePopupRows } from './marketStatusPopup.js'

function et(y, mo, d, hour, minute) {
  const ms = etWallToUtcMs(y, mo, d, hour, minute)
  assert.ok(ms != null, `bad ET ${y}-${mo}-${d} ${hour}:${minute}`)
  return ms
}

function gate(symbol, ms, quoteTs = null) {
  return evaluateSymbolGate({
    symbol,
    nowUtc: ms,
    quoteTimestampUtc: quoteTs,
  })
}

describe('market session calendar + freshness gate', () => {
  it('T01: US stock Sunday afternoon London — CLOSED, SLEEP, no 8h calc', () => {
    // 21 Jun 2026 Sunday 15:00 BST = 10:00 ET
    const now = et('2026', '06', '21', 10, 0)
    const g = gate('SNDK', now, now - 38 * 3600 * 1000)
    assert.equal(g.calendarState, 'CLOSED')
    assert.equal(g.engineGate, 'SLEEP')
    assert.notEqual(g.engineGate, 'RUN')
  })

  it('T02: US stock Monday 1:02am BST summer — calendar OPEN overnight (poll window)', () => {
    // 22 Jun 2026 Mon 01:02 BST = 21 Jun 20:02 ET
    // Calendar allows poll; Yahoo marketState REGULAR gate decides evaluate.
    const now = et('2026', '06', '21', 20, 2)
    const g = gate('AAPL', now, now - 30 * 1000)
    assert.equal(g.calendarState, 'OPEN')
    assert.equal(g.sessionName, 'OVERNIGHT')
    assert.equal(g.freshnessState, 'FRESH')
    assert.equal(g.engineGate, 'RUN')
  })

  it('T03: Tuesday regular, quote 20 min old — OPEN + STALE → PAUSE_DATA not CLOSED', () => {
    const now = et('2026', '06', '23', 11, 0)
    const g = gate('SPY', now, now - 20 * 60 * 1000)
    assert.equal(g.calendarState, 'OPEN')
    assert.equal(g.freshnessState, 'STALE')
    assert.equal(g.engineGate, 'PAUSE_DATA')
    assert.notEqual(g.calendarState, 'CLOSED')
  })

  it('T04: BTC-USD Sunday fresh — OPEN 24/7 RUN', () => {
    const now = et('2026', '06', '21', 12, 0)
    const g = gate('BTC-USD', now, now - 20 * 1000)
    assert.equal(g.calendarState, 'OPEN')
    assert.equal(g.freshnessState, 'FRESH')
    assert.equal(g.engineGate, 'RUN')
  })

  it('T05: BTC-USD Sunday quote 15 min old — OPEN + STALE → PAUSE_DATA', () => {
    const now = et('2026', '06', '21', 12, 0)
    const g = gate('BTC-USD', now, now - 15 * 60 * 1000)
    assert.equal(g.calendarState, 'OPEN')
    assert.equal(g.freshnessState, 'STALE')
    assert.equal(g.engineGate, 'PAUSE_DATA')
    assert.notEqual(g.calendarState, 'CLOSED')
  })

  it('T06: GC=F 5:30pm ET — MAINTENANCE SLEEP', () => {
    const now = et('2026', '06', '23', 17, 30)
    const g = gate('GC=F', now)
    assert.equal(g.calendarState, 'MAINTENANCE')
    assert.equal(g.engineGate, 'SLEEP')
  })

  it('T07: GC=F 6:02pm ET fresh — OPEN RUN', () => {
    const now = et('2026', '06', '23', 18, 2)
    const g = gate('GC=F', now, now - 15 * 1000)
    assert.equal(g.calendarState, 'OPEN')
    assert.equal(g.engineGate, 'RUN')
  })

  it('T08: ES=F Sunday 7pm ET — OPEN futures', () => {
    const now = et('2026', '06', '21', 19, 0)
    const sess = resolveSession(resolveMarketProfile('ES=F'), now)
    assert.equal(sess.state, 'OPEN')
  })

  it('T09: ^GSPC Sunday 7pm ET — CLOSED cash index', () => {
    const now = et('2026', '06', '21', 19, 0)
    const sess = resolveSession(resolveMarketProfile('^GSPC'), now)
    assert.equal(sess.state, 'CLOSED')
  })

  it('T10: Indices popup mixed when futures open and cash closed', () => {
    const rows = aggregatePopupRows([
      {
        calendarState: 'OPEN',
        engineGate: 'RUN',
        uiStatus: 'Open / Live',
        reason: 'futures',
        child: {
          calendarState: 'CLOSED',
          engineGate: 'SLEEP',
          uiStatus: 'Closed',
        },
      },
    ])
    assert.equal(rows[0].uiStatus, 'Mixed')
    assert.equal(rows[0].engineLabel, 'Partial')
  })

  it('T11: March DST mismatch 9:30 ET displays 1:30pm London, not 2:30', () => {
    const open = et('2026', '03', '16', 9, 30)
    assert.equal(formatHmInTimeZone(open, UK_ZONE), '13:30')
    assert.notEqual(formatHmInTimeZone(open, UK_ZONE), '14:30')
  })

  it('T12: dashboard headline is five probes; popup is informational', () => {
    assert.equal(HEADLINE_PROBES.length, 5)
    assert.equal(HEADLINE_PROBES[0].symbol, 'SPY')
    assert.equal(HEADLINE_PROBES[4].symbol, 'ES=F')
    assert.equal(HEADLINE_PROBES[4].child.symbol, '^GSPC')
  })

  it('T13: weekend reopen walkback is a gap, not continuous 8h', () => {
    const monOpen = et('2026', '06', '22', 9, 35)
    // 8h of trading still fits in Sun 20:00→Mon 9:35; 16h must cross Fri 20:00.
    const walk = walkBackEligibleTradingMinutes('SNDK', monOpen, 16 * 60)
    assert.equal(walk.crossedClosure, true)
    assert.ok(walk.closureDurationSec >= 12 * 3600)
    assert.equal(walk.sessionBoundaryType, 'REOPEN_GAP')
    assert.ok(walk.referenceTs < monOpen - 8 * 3600 * 1000)
  })

  it('T14: Thanksgiving Friday 2026 early close 1pm ET — sleeps after 13:00', () => {
    const after = et('2026', '11', '27', 13, 30)
    const before = et('2026', '11', '27', 11, 0)
    assert.equal(resolveSession(resolveMarketProfile('SNDK'), after).state, 'EARLY_CLOSE')
    assert.equal(gate('SNDK', after).engineGate, 'SLEEP')
    assert.equal(resolveSession(resolveMarketProfile('SNDK'), before).state, 'OPEN')
  })

  it('T15: empty symbol is CONFLICT / UNKNOWN', () => {
    const g = evaluateSymbolGate({ symbol: '', nowUtc: Date.now() })
    assert.equal(g.calendarState, 'UNKNOWN')
    assert.equal(g.engineGate, 'CONFLICT')
  })

  it('never treats stale as closed', () => {
    const now = et('2026', '06', '23', 11, 0)
    const fresh = evaluateFreshness({
      quoteTimestampUtc: now - 20 * 60 * 1000,
      nowUtc: now,
      profile: resolveMarketProfile('SPY'),
    })
    assert.equal(fresh.state, 'STALE')
    const g = gate('SPY', now, now - 20 * 60 * 1000)
    assert.notEqual(g.calendarState, 'CLOSED')
  })
})
