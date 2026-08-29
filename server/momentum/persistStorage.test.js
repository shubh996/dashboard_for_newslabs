import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMeasureExplain,
  measureForPersist,
  canonicalEventState,
  eventPayloadForSupabase,
} from './mobilePayload.js'
import { shouldPersistTimelineEvent } from './persist.js'

describe('canonicalEventState', () => {
  it('never falls back to research prose reason', () => {
    const st = canonicalEventState({
      eventType: 'MOMENTUM_RESEARCH_DONE',
      reason: 'Tesla, Inc. -3.01% in the last 3h. Likely driver: Simulated pressure…',
      state: undefined,
    })
    assert.equal(st, null)
  })

  it('keeps real momentum labels', () => {
    assert.equal(
      canonicalEventState({ eventType: 'MOMENTUM_STATE', state: 'HOLDING' }),
      'HOLDING',
    )
    assert.equal(
      canonicalEventState({ eventType: 'MOMENTUM_STARTED' }),
      'STARTED',
    )
  })

  it('ignores ALERT reason RESEARCH as state', () => {
    assert.equal(
      canonicalEventState({
        eventType: 'MOMENTUM_ALERT_SENT',
        state: 'RESEARCH',
        reason: 'RESEARCH',
      }),
      null,
    )
    assert.equal(
      canonicalEventState(
        { eventType: 'MOMENTUM_ALERT_SENT', state: 'RESEARCH' },
        { state: 'HOLDING' },
      ),
      'HOLDING',
    )
  })
})

describe('measureForPersist', () => {
  it('strips formulaLines and duplicated scalars', () => {
    const fat = buildMeasureExplain(
      {
        direction: 'UP',
        referencePrice: 100,
        peakPrice: 110,
        peakMovePercent: 10,
        currentPrice: 108,
        detectedWindow: '1h',
        exactMinutes: 48,
        exactLabel: '48m',
      },
      108,
      8,
    )
    assert.ok(Array.isArray(fat.formulaLines) && fat.formulaLines.length > 0)
    const slim = measureForPersist(fat, { eventType: 'MOMENTUM_STATE', direction: 'UP' })
    assert.deepEqual(Object.keys(slim || {}).sort(), [
      'peakMovePercent',
      'peakPrice',
      'troughPrice',
    ])
    assert.equal(slim.peakPrice, 110)
    assert.equal(slim.troughPrice, null)
    assert.equal(slim.formulaLines, undefined)
    assert.equal(slim.livePrice, undefined)
    assert.equal(slim.movePercent, undefined)
  })

  it('returns null for RESEARCH_DONE and ALERT_SENT', () => {
    const fat = buildMeasureExplain(
      { direction: 'DOWN', troughPrice: 90, referencePrice: 100, currentPrice: 92 },
      92,
      -8,
    )
    assert.equal(
      measureForPersist(fat, { eventType: 'MOMENTUM_RESEARCH_DONE' }),
      null,
    )
    assert.equal(
      measureForPersist(fat, { eventType: 'MOMENTUM_ALERT_SENT' }),
      null,
    )
  })

  it('does not persist peakPrice 0 / unused extreme on DOWN', () => {
    const fat = buildMeasureExplain(
      {
        direction: 'DOWN',
        troughPrice: 90,
        peakPrice: 0,
        referencePrice: 100,
        peakMovePercent: -10,
      },
      92,
      -8,
    )
    assert.equal(fat.peakPrice, null)
    const slim = measureForPersist(fat, {
      eventType: 'MOMENTUM_STATE',
      direction: 'DOWN',
    })
    assert.equal(slim.peakPrice, null)
    assert.equal(slim.troughPrice, 90)
  })
})

describe('eventPayloadForSupabase state', () => {
  it('does not put reason into state for RESEARCH_DONE', () => {
    const payload = eventPayloadForSupabase({
      eventType: 'MOMENTUM_RESEARCH_DONE',
      reason: 'Full research paragraph with Likely driver…',
      price: 10,
      movePercent: -3,
      direction: 'DOWN',
    })
    assert.equal(payload.state, null)
    assert.ok(payload.reason)
  })
})

describe('shouldPersistTimelineEvent same-state guard', () => {
  it('allows first HOLDING then skips duplicate HOLDING for same episode', () => {
    const ep = `ep-test-same-state-${Date.now()}`
    const holding = {
      eventType: 'MOMENTUM_STATE',
      state: 'HOLDING',
      episodeId: ep,
      detectedAt: new Date().toISOString(),
    }
    assert.equal(shouldPersistTimelineEvent(holding), true)
    assert.equal(shouldPersistTimelineEvent({ ...holding }), false)
    assert.equal(
      shouldPersistTimelineEvent({
        ...holding,
        state: 'WEAKENING',
      }),
      true,
    )
    assert.equal(
      shouldPersistTimelineEvent({
        eventType: 'MOMENTUM_ALERT_SENT',
        episodeId: ep,
      }),
      true,
    )
  })
})
