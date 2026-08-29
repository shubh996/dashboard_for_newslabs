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
  buildMarketSessionResearchPrompt,
  dueMarketBulletinSlots,
  isWithinBulletinFireWindow,
  classifyTickerMarkets,
  isMarketBulletinEligibleTicker,
} from './marketSessionBulletin.js'

describe('marketSessionBulletin format', () => {
  it('formats stock with signed percent in brackets', () => {
    assert.equal(formatStockBracketPct('sndk', 1.234), 'SNDK (+1.2%)')
    assert.equal(formatStockBracketPct('AAPL', -0.5), 'AAPL (-0.5%)')
    assert.equal(formatStockBracketPct('TSLA', 0), 'TSLA (0.0%)')
    assert.equal(formatStockBracketPct('IBM', null), 'IBM (n/a)')
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

  it('yahoo fallback body has no watchlist dump', () => {
    const openBody = buildMarketBulletinPushBody('OPEN', 'us', {
      probeSymbol: 'SPY',
      dayChangePercent: 0.42,
    })
    const closeBody = buildMarketBulletinPushBody('CLOSE', 'us', {
      probeSymbol: 'SPY',
      dayChangePercent: -0.4,
    })
    assert.ok(/US market/i.test(openBody))
    assert.ok(/open/i.test(openBody))
    assert.ok(/SPY/i.test(openBody))
    assert.ok(/closed/i.test(closeBody))
    assert.ok(!/\(n\/a\)/i.test(openBody))
    assert.ok(!/ · /.test(openBody))

    const indiaClose = buildMarketBulletinPushBody('CLOSE', 'india', {
      probeSymbol: 'RELIANCE.NS',
      dayChangePercent: 1.1,
    })
    assert.ok(/Indian market/i.test(indiaClose))
    assert.ok(/RELIANCE\.NS/i.test(indiaClose))
  })

  it('titles open and close for US and India', () => {
    assert.equal(buildMarketBulletinTitle('OPEN'), 'The US market has opened')
    assert.equal(buildMarketBulletinTitle('CLOSE'), 'The US market has closed')
    assert.equal(
      buildMarketBulletinTitle('OPEN', '2026-08-14', 'india'),
      'The Indian market has opened',
    )
    assert.equal(
      buildMarketBulletinTitle('CLOSE', '', 'india'),
      'The Indian market has closed',
    )
  })

  it('builds a short Perplexity prompt from saved Yahoo facts', () => {
    const prompt = buildMarketSessionResearchPrompt({
      market: 'us',
      slot: 'OPEN',
      sessionDate: '2026-08-28',
      snap: {
        probeSymbol: 'SPY',
        marketState: 'REGULAR',
        last: 650.25,
        open: 648.5,
        previousClose: 647.1,
        dayChangePercent: 0.486,
      },
    })
    assert.match(prompt, /exactly 2 or 3 short sentences/i)
    assert.match(prompt, /US market opened on 2026-08-28/)
    assert.match(prompt, /yahoo_probe=SPY/)
    assert.match(prompt, /yahoo_market_state=REGULAR/)
    assert.match(prompt, /yahoo_day_change_percent=\+0\.49%/)
  })

  it('builds India / China / Australia titles', () => {
    assert.equal(
      buildMarketBulletinTitle('OPEN', '', 'china'),
      'The Chinese market has opened',
    )
    assert.equal(
      buildMarketBulletinTitle('CLOSE', '', 'australia'),
      'The Australian market has closed',
    )
  })

  it('dueMarketBulletinSlots empty on weekend', () => {
    const sat = Date.parse('2026-08-15T15:00:00.000Z')
    assert.deepEqual(dueMarketBulletinSlots(sat), [])
  })

  it('OPEN only due inside post-open grace — not all day', () => {
    const openFire = Date.parse('2026-08-17T13:35:00.000Z')
    assert.ok(isWithinBulletinFireWindow(openFire + 60_000, openFire))
    assert.equal(
      dueMarketBulletinSlots(openFire + 60_000)
        .map((d) => d.slot)
        .join(','),
      'OPEN',
    )
    const mid = Date.parse('2026-08-17T15:14:00.000Z')
    assert.equal(dueMarketBulletinSlots(mid).length, 0)
  })
})

describe('marketSessionBulletin targeting', () => {
  it('classifies India / China / Australia / US tickers from holdings', () => {
    assert.ok(classifyTickerMarkets('RELIANCE.NS').has('india'))
    assert.ok(classifyTickerMarkets('TCS.BO').has('india'))
    assert.ok(!classifyTickerMarkets('RELIANCE.NS').has('us'))
    assert.ok(classifyTickerMarkets('0700.HK').has('china'))
    assert.ok(classifyTickerMarkets('600519.SS').has('china'))
    assert.ok(classifyTickerMarkets('BHP.AX').has('australia'))
    assert.ok(classifyTickerMarkets('AAPL').has('us'))
    assert.ok(classifyTickerMarkets('SPY').has('us'))
    assert.equal(classifyTickerMarkets('BTC-USD').size, 0)
    assert.equal(classifyTickerMarkets('EURUSD=X').size, 0)
    assert.equal(classifyTickerMarkets('VOD.L').size, 0)
  })

  it('eligible helpers', () => {
    assert.equal(isMarketBulletinEligibleTicker('AAPL'), true)
    assert.equal(isMarketBulletinEligibleTicker('RELIANCE.NS'), true)
    assert.equal(isMarketBulletinEligibleTicker('0700.HK'), true)
    assert.equal(isMarketBulletinEligibleTicker('BHP.AX'), true)
    assert.equal(isMarketBulletinEligibleTicker('BTC-USD'), false)
  })
})
