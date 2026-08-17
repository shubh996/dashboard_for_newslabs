/**
 * Production requirements A–G.
 * Run: node --test server/momentum/wakeClose.test.js
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { etWallToUtcMs } from './usEquitySession.js'
import { resolveMarketProfile } from './marketProfile.js'
import { resolveSession } from './sessionCalendar.js'
import { resolveLifecycle, LIFECYCLE } from './lifecycle.js'
import { applyEpisodePolicyOverrides } from './config.js'
import { advanceEpisode, closeActiveEpisodeFullMarketClose } from './episode.js'
import { movePercent } from './returns.js'
import * as store from './store.js'
import {
  enterFullMarketClose,
  enterMaintenanceSleep,
  getSleepRecord,
  isEngineAsleep,
  registerSleep,
  resetWakeSchedulerForTests,
  startWakeScheduler,
  stopWakeScheduler,
} from './wakeScheduler.js'

function et(y, mo, d, hour, minute) {
  const ms = etWallToUtcMs(y, mo, d, hour, minute)
  assert.ok(ms != null)
  return ms
}

function startUp(nowIso) {
  store.resetStore('SNDK')
  store.primeThresholdEdgesBelow('SNDK')
  return advanceEpisode({
    ticker: 'SNDK',
    episode: null,
    returns: { '5m': 3.1, day: 2 },
    strongest: { window: '5m', movePercent: 3.1, direction: 'UP' },
    currentPrice: 103.1,
    referencePrice: 100,
    references: { '5m': 100 },
    marketSession: 'POST',
    nowIso,
  })
}

describe('wake scheduler + full close + 3h inactivity', () => {
  beforeEach(() => {
    store.resetStore('SNDK')
    store.resetStore('GC=F')
    resetWakeSchedulerForTests()
    applyEpisodePolicyOverrides({ episodeInactivityExpiryMin: 180 })
  })

  it('A — Friday 8pm ET FULL_CLOSED closes episode and schedules wake', () => {
    startWakeScheduler()
    const fri759 = new Date(et('2026', '06', '26', 19, 59)).toISOString()
    const started = startUp(fri759)
    assert.equal(started.episode?.status, 'ACTIVE')
    const fri800 = et('2026', '06', '26', 20, 0)
    const life = resolveLifecycle('SNDK', fri800)
    assert.equal(life.lifecycle, LIFECYCLE.FULL_CLOSED)
    const closed = advanceEpisode({
      ticker: 'SNDK',
      episode: started.episode,
      returns: { '5m': 3, day: 2 },
      currentPrice: 103,
      marketSession: 'CLOSED',
      lifecycleState: life.lifecycle,
      nowIso: new Date(fri800).toISOString(),
    })
    assert.equal(closed.episode, null)
    assert.equal(closed.closedEpisode?.endReason, 'MARKET_FULL_CLOSE')
    const { rec } = enterFullMarketClose('SNDK', new Date(fri800).toISOString())
    assert.ok(rec?.nextExpectedOpenUtc)
    assert.equal(isEngineAsleep('SNDK'), true)
    const sun8 = et('2026', '06', '28', 20, 0)
    const openMs = Date.parse(rec.nextExpectedOpenUtc)
    assert.ok(Number.isFinite(openMs))
    assert.ok(openMs > fri800)
    const sunLife = resolveLifecycle('SNDK', openMs + 60_000)
    assert.equal(sunLife.isFullClosed, false)
    stopWakeScheduler()
  })

  it('B — dashboard probe does not clear sleep / wake engine', async () => {
    startWakeScheduler()
    registerSleep(
      'SPY',
      'FULL_CLOSED',
      new Date(et('2026', '06', '28', 20, 0)).toISOString(),
    )
    assert.equal(isEngineAsleep('SPY'), true)
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./marketStatusPopup.js', import.meta.url), 'utf8'),
    )
    assert.ok(!src.includes('wakeScheduler'))
    assert.ok(src.includes('probeOnly'))
    assert.equal(isEngineAsleep('SPY'), true)
    assert.equal(getSleepRecord('SPY')?.kind, 'FULL_CLOSED')
    stopWakeScheduler()
  })

  it('C — Sunday 8pm ET calendar is OPEN; old Friday episode stays closed', () => {
    const fri = startUp(new Date(et('2026', '06', '26', 19, 50)).toISOString())
    const closed = closeActiveEpisodeFullMarketClose('SNDK', {
      episode: fri.episode,
      nowIso: new Date(et('2026', '06', '26', 20, 0)).toISOString(),
    })
    const oldId = closed.closedEpisode?.episodeId
    assert.ok(oldId)
    const sun = resolveLifecycle('SNDK', et('2026', '06', '28', 20, 5))
    assert.equal(sun.lifecycle, LIFECYCLE.OVERNIGHT)
    assert.equal(sun.engineGate, 'RUN')
    assert.notEqual(store.getActiveEpisode('SNDK')?.episodeId, oldId)
    assert.equal(store.getActiveEpisode('SNDK'), null)
  })

  it('D — 3h eligible inactivity from last material momentum', () => {
    const started = startUp('2026-06-23T17:00:00.000Z') // Tue 1pm ET
    started.episode.lastMaterialMomentumAt = '2026-06-23T18:30:00.000Z'
    started.episode.lastMaterialProgressAt = '2026-06-23T18:30:00.000Z'
    started.episode.meaningfulExtremeMovePct = 5
    const mid = advanceEpisode({
      ticker: 'SNDK',
      episode: started.episode,
      returns: { '5m': 4, day: 4 },
      currentPrice: 104,
      marketSession: 'REGULAR',
      nowIso: '2026-06-23T20:00:00.000Z',
    })
    assert.equal(mid.episode?.status, 'ACTIVE')
    const exp = advanceEpisode({
      ticker: 'SNDK',
      episode: mid.episode,
      returns: { '5m': 4, day: 4 },
      currentPrice: 104,
      marketSession: 'REGULAR',
      nowIso: '2026-06-23T21:31:00.000Z',
    })
    assert.equal(exp.episode, null)
    assert.equal(exp.closedEpisode?.endReason, 'NO_MATERIAL_MOMENTUM_3H')
  })

  it('E — Friday 8pm full close wins over 3h inactivity', () => {
    const started = startUp(new Date(et('2026', '06', '26', 18, 30)).toISOString())
    started.episode.lastMaterialMomentumAt = new Date(
      et('2026', '06', '26', 18, 30),
    ).toISOString()
    const closed = advanceEpisode({
      ticker: 'SNDK',
      episode: started.episode,
      returns: { '5m': 3, day: 2 },
      currentPrice: 103,
      marketSession: 'CLOSED',
      lifecycleState: 'FULL_CLOSED',
      nowIso: new Date(et('2026', '06', '26', 20, 0)).toISOString(),
    })
    assert.equal(closed.closedEpisode?.endReason, 'MARKET_FULL_CLOSE')
    assert.notEqual(closed.closedEpisode?.endReason, 'NO_MATERIAL_MOMENTUM_3H')
  })

  it('F — CME maintenance is not FULL_CLOSED; episode stays active', () => {
    store.primeThresholdEdgesBelow('GC=F')
    const started = advanceEpisode({
      ticker: 'GC=F',
      episode: null,
      returns: { '5m': 3.5, day: 2 },
      strongest: { window: '5m', movePercent: 3.5, direction: 'UP' },
      currentPrice: 2350,
      referencePrice: 2270,
      marketSession: 'REGULAR',
      assetClass: 'commodity',
      nowIso: new Date(et('2026', '06', '23', 16, 50)).toISOString(),
    })
    assert.equal(started.episode?.status, 'ACTIVE')
    const maintAt = et('2026', '06', '23', 17, 30)
    const life = resolveLifecycle('GC=F', maintAt)
    assert.equal(life.lifecycle, LIFECYCLE.MAINTENANCE)
    assert.equal(life.isFullClosed, false)
    const paused = advanceEpisode({
      ticker: 'GC=F',
      episode: started.episode,
      returns: { '5m': 3.4, day: 2 },
      currentPrice: 2348,
      marketSession: 'CLOSED',
      lifecycleState: life.lifecycle,
      nowIso: new Date(maintAt).toISOString(),
    })
    assert.equal(paused.episode?.status, 'ACTIVE')
    const rec = enterMaintenanceSleep('GC=F')
    assert.equal(rec.kind, 'MAINTENANCE')
    assert.equal(isEngineAsleep('GC=F'), true)
  })

  it('G — stale data is DATA_STALE, not CLOSED; no inactivity expire', () => {
    const started = startUp('2026-06-23T17:00:00.000Z')
    started.episode.lastMaterialMomentumAt = '2026-06-23T17:00:00.000Z'
    const stale = advanceEpisode({
      ticker: 'SNDK',
      episode: started.episode,
      returns: { '5m': 3, day: 2 },
      currentPrice: 103,
      marketSession: 'REGULAR',
      lifecycleState: 'DATA_STALE',
      nowIso: '2026-06-23T21:00:00.000Z',
    })
    assert.equal(stale.episode?.status, 'ACTIVE')
    assert.equal(stale.closedEpisode, null)
    const life = resolveLifecycle(
      resolveMarketProfile('SNDK'),
      et('2026', '06', '23', 11, 0),
      'STALE',
    )
    assert.equal(life.lifecycle, LIFECYCLE.DATA_STALE)
    assert.equal(life.isFullClosed, false)
    assert.equal(life.engineGate, 'PAUSE_DATA')
  })
})
