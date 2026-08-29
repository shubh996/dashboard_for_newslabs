import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyPerplexityPromptOverrides,
  defaultMarketBulletinPromptTemplate,
  fillMarketBulletinPrompt,
  getDefaultPromptBody,
  getMarketBulletinPromptTemplate,
  getMomentumResearchPromptTemplate,
  getMomentumReversalOverride,
  listPerplexityPrompts,
  normalizeResearchPromptAssetClass,
} from './perplexityPrompts.js'
import { buildMarketSessionResearchPrompt } from './marketSessionBulletin.js'
import {
  extractMoveClassification,
  extractConfidence,
} from '../notifications.js'

describe('perplexityPrompts', () => {
  it('lists catalog with default bodies', () => {
    const list = listPerplexityPrompts()
    assert.ok(list.length >= 6)
    const equity = list.find((p) => p.id === 'momentum_research_equity')
    assert.ok(equity)
    assert.match(equity.body, /Likely driver:/i)
    assert.match(equity.body, /Move classification:/i)
    assert.match(equity.body, /Confidence:/i)
    assert.match(equity.body, /\{\{USER_MOVEMENT\}\}/)
    assert.match(equity.body, /\{\{INPUT_FACTS\}\}/)
  })

  it('normalizes asset classes for research templates', () => {
    assert.equal(normalizeResearchPromptAssetClass('ETF'), 'index')
    assert.equal(normalizeResearchPromptAssetClass('fx'), 'forex')
    assert.equal(
      getMomentumResearchPromptTemplate('commodity'),
      getDefaultPromptBody('momentum_research_commodity'),
    )
  })

  it('fills market bulletin placeholders', () => {
    const filled = fillMarketBulletinPrompt(defaultMarketBulletinPromptTemplate(), {
      SHORT_LABEL: 'US market',
      OPENED_OR_CLOSED: 'opened',
      SESSION_DATE: '2026-08-29',
      TIMEZONE: 'America/New_York',
      MARKET_ID: 'us',
      SLOT: 'OPEN',
      YAHOO_PROBE: '^GSPC',
      YAHOO_MARKET_STATE: 'REGULAR',
      YAHOO_LAST: '5000',
      YAHOO_OPEN: '4980',
      YAHOO_PREVIOUS_CLOSE: '4970',
      YAHOO_DAY_CHANGE_PERCENT: '+0.60%',
    })
    assert.match(filled, /US market opened on 2026-08-29/)
    assert.match(filled, /yahoo_day_change_percent=\+0\.60%/)
    assert.doesNotMatch(filled, /\{\{/)
  })

  it('buildMarketSessionResearchPrompt uses editable template', () => {
    const prompt = buildMarketSessionResearchPrompt({
      market: 'us',
      slot: 'OPEN',
      sessionDate: '2026-08-29',
      snap: {
        dayChangePercent: 1.25,
        last: 100,
        previousClose: 99,
        open: 99.5,
        marketState: 'REGULAR',
        probeSymbol: '^GSPC',
      },
    })
    assert.match(prompt, /opened on 2026-08-29/)
    assert.match(prompt, /\+1\.25%/)
  })

  it('applies and clears overrides in memory', () => {
    const custom = `${getMomentumReversalOverride()}\nCUSTOM_MARKER`
    applyPerplexityPromptOverrides({
      momentum_reversal_override: custom,
    })
    assert.match(getMomentumReversalOverride(), /CUSTOM_MARKER/)
    applyPerplexityPromptOverrides({
      momentum_reversal_override: '',
    })
    assert.equal(
      getMomentumReversalOverride(),
      getDefaultPromptBody('momentum_reversal_override'),
    )
    assert.equal(getMarketBulletinPromptTemplate(), defaultMarketBulletinPromptTemplate())
  })
})

describe('extractMoveClassification / extractConfidence', () => {
  it('parses structured Perplexity reason tails', () => {
    const sample = [
      'Likely driver: Deal announced.',
      'Secondary driver: Peers firm.',
      'Move classification: 65% company-specific, 35% sector/market/macro-related.',
      'Confidence: Medium — mixed sector bid.',
    ].join('\n')
    assert.equal(
      extractMoveClassification(sample),
      '65% company-specific, 35% sector/market/macro-related.',
    )
    assert.equal(extractConfidence(sample), 'Medium — mixed sector bid.')
  })
})
