/**
 * Run: node --test server/momentum/marketSessionBulletin.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatStockBracketPct,
  buildMarketBulletinBody,
  buildMarketBulletinPushBody,
  buildMarketBulletinTitle,
  dueMarketBulletinSlots,
  isWithinBulletinFireWindow,
} from './marketSessionBulletin.js'

describe('marketSessionBulletin format', () => {
  it('formats stock with signed percent in brackets', () => {
    assert.equal(formatStockBracketPct('sndk', 1.234), 'SNDK (+1.2%)')
    assert.equal(formatStockBracketPct('AAPL', -0.5), 'AAPL (-0.5%)')
    assert.equal(formatStockBracketPct('TSLA', 0), 'TSLA (0.0%)')
    assert.equal(formatStockBracketPct('IBM', null), 'IBM (n/a)')
    // Futures → human names in headings
    assert.equal(formatStockBracketPct('NG=F', 2.5), 'Natural Gas (+2.5%)')
    assert.equal(formatStockBracketPct('CL=F', -1.2), 'Crude Oil (-1.2%)')
    assert.equal(formatStockBracketPct('GC=F', 0.8), 'Gold (+0.8%)')
  })

  it('joins stocks with mid-dot separators (debug helper only)', () => {
    const body = buildMarketBulletinBody([
      { ticker: 'SNDK', movePercent: 3.1 },
      { ticker: 'AAPL', movePercent: -0.45 },
      { ticker: 'TSLA', movePercent: 2.1 },
    ])
    assert.equal(body, 'SNDK (+3.1%) · AAPL (-0.5%) · TSLA (+2.1%)')
  })

  it('push body has no watchlist dump', () => {
    const openBody = buildMarketBulletinPushBody('OPEN')
    const closeBody = buildMarketBulletinPushBody('CLOSE')
    assert.ok(/unusual momentum/i.test(openBody))
    assert.ok(/watchlist assets/i.test(openBody))
    assert.ok(/tap to see what.?s moving/i.test(openBody))
    assert.ok(/trigger never sleeps/i.test(closeBody))
    assert.ok(/unusual momentum/i.test(closeBody))
    assert.ok(/watchlist assets/i.test(closeBody))
    // Must never look like the old lock-screen spam
    assert.ok(!/\(n\/a\)/i.test(openBody))
    assert.ok(!/\(n\/a\)/i.test(closeBody))
    assert.ok(!/SNDK \(\+/.test(openBody))
    assert.ok(!/IONQ/i.test(openBody))
    assert.ok(!/ · /.test(openBody))
  })

  it('titles open and close without dates', () => {
    assert.equal(buildMarketBulletinTitle('OPEN'), 'The US market has opened')
    assert.equal(buildMarketBulletinTitle('CLOSE'), 'The US market has closed')
    assert.equal(
      buildMarketBulletinTitle('OPEN', '2026-08-14'),
      'The US market has opened',
    )
  })

  it('dueMarketBulletinSlots empty on weekend', () => {
    // 2026-08-15 is Saturday
    const sat = Date.parse('2026-08-15T15:00:00.000Z')
    assert.deepEqual(dueMarketBulletinSlots(sat), [])
  })

  it('OPEN only due inside post-open grace — not all day', () => {
    // Mon 2026-08-17 open+5 = 13:35 UTC (9:35 ET EDT)
    const openFire = Date.parse('2026-08-17T13:35:00.000Z')
    assert.ok(isWithinBulletinFireWindow(openFire + 60_000, openFire))
    assert.equal(
      dueMarketBulletinSlots(openFire + 60_000)
        .map((d) => d.slot)
        .join(','),
      'OPEN',
    )

    // Mid-session 11:14 ET = 15:14 UTC — must NOT re-fire OPEN
    // (this is the bug from the lock-screen screenshot)
    const mid = Date.parse('2026-08-17T15:14:00.000Z')
    assert.deepEqual(dueMarketBulletinSlots(mid), [])

    // After open grace (openFire + 25m)
    assert.deepEqual(dueMarketBulletinSlots(openFire + 25 * 60_000), [])

    // Pre-open 9:20 ET — not yet
    const pre = Date.parse('2026-08-17T13:20:00.000Z')
    assert.deepEqual(dueMarketBulletinSlots(pre), [])
  })

  it('CLOSE only due inside post-close grace', () => {
    // Close+5 = 16:05 ET = 20:05 UTC (EDT)
    const closeFire = Date.parse('2026-08-17T20:05:00.000Z')
    const due = dueMarketBulletinSlots(closeFire + 30_000)
    assert.equal(due.length, 1)
    assert.equal(due[0].slot, 'CLOSE')
    assert.deepEqual(dueMarketBulletinSlots(closeFire + 30 * 60_000), [])
  })

  it('never due outside US equity RTH open/close windows', () => {
    // After close evening 18:00 ET
    const evening = Date.parse('2026-08-17T22:00:00.000Z')
    assert.deepEqual(dueMarketBulletinSlots(evening), [])
    // Overnight 2:00 ET
    const overnight = Date.parse('2026-08-18T06:00:00.000Z')
    assert.deepEqual(dueMarketBulletinSlots(overnight), [])
  })
})
