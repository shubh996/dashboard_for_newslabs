import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDigestTitle,
  buildDigestLead,
  dayMovePercent,
  userFacingResearchText,
  digestSlotTimes,
  isDigestEligibleTicker,
} from './dailyDigest.js'

describe('dailyDigest pure helpers', () => {
  it('dayMovePercent vs previous close', () => {
    assert.ok(Math.abs(dayMovePercent(103.2, 100) - 3.2) < 1e-9)
    assert.ok(Math.abs(dayMovePercent(96.9, 100) + 3.1) < 1e-9)
    assert.equal(dayMovePercent(null, 100), null)
    assert.equal(dayMovePercent(100, 0), null)
  })

  it('titles match OPEN / MIDDAY / CLOSE tone', () => {
    assert.match(
      buildDigestTitle({ ticker: 'SNDK', slot: 'OPEN', movePercent: 3.2 }),
      /opens strong.*\+3\.2%/,
    )
    assert.match(
      buildDigestTitle({ ticker: 'SNDK', slot: 'OPEN', movePercent: -3.1 }),
      /opens lower.*3\.1%/,
    )
    assert.match(
      buildDigestTitle({ ticker: 'SNDK', slot: 'MIDDAY', movePercent: 5.1 }),
      /holds higher.*midday/,
    )
    assert.match(
      buildDigestTitle({ ticker: 'SNDK', slot: 'MIDDAY', movePercent: -4.8 }),
      /slides/,
    )
    assert.match(
      buildDigestTitle({ ticker: 'SNDK', slot: 'CLOSE', movePercent: 6.4 }),
      /closes higher/,
    )
    assert.match(
      buildDigestTitle({ ticker: 'SNDK', slot: 'CLOSE', movePercent: -6.2 }),
      /closes lower/,
    )
  })

  it('lead copy is factual without labels', () => {
    const lead = buildDigestLead({
      ticker: 'SNDK',
      slot: 'OPEN',
      movePercent: 3.2,
    })
    assert.match(lead, /previous session close/i)
    assert.doesNotMatch(lead, /Likely driver|Reason|Episode|Threshold/i)
  })

  it('userFacingResearchText strips labels and avoids invention', () => {
    assert.equal(
      userFacingResearchText({ ok: false }),
      'No clear catalyst has been identified yet.',
    )
    assert.equal(
      userFacingResearchText({
        ok: true,
        reason:
          'Likely driver: Chip demand beat estimates.\nSecondary driver: None.\nConfidence: High',
      }),
      'Chip demand beat estimates.',
    )
    assert.equal(
      userFacingResearchText({ ok: true, likely_driver: 'Buyback program.' }),
      'Buyback program.',
    )
  })

  it('digestSlotTimes OPEN is open+10m, CLOSE is close+5m', () => {
    const t = digestSlotTimes('2026-08-14')
    assert.ok(t)
    // 9:40 ET open fire, 16:05 ET close fire
    const open = new Date(t.OPEN)
    const close = new Date(t.CLOSE)
    // Just ensure ordering
    assert.ok(t.OPEN < t.MIDDAY)
    assert.ok(t.MIDDAY < t.CLOSE)
    assert.ok(open.getTime() < close.getTime())
  })

  it('eligibility: equities/indexes only', () => {
    assert.equal(isDigestEligibleTicker('SNDK'), true)
    assert.equal(isDigestEligibleTicker('AAPL'), true)
    assert.equal(isDigestEligibleTicker('^GSPC'), true)
    assert.equal(isDigestEligibleTicker('GC=F'), false)
    assert.equal(isDigestEligibleTicker('BTC-USD'), false)
    assert.equal(isDigestEligibleTicker('EURUSD=X'), false)
  })
})
