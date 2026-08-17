export { createMomentumRouter } from './routes.js'
export {
  startMomentumLoop,
  stopMomentumLoop,
  runMomentumTick,
  runMomentumTickAll,
  getMomentumStatus,
  setMomentumWatchlist,
  setMomentumFocus,
  selectTickersForPollCycle,
  syncWatchlistFromMonitoredTickers,
  fetchIntradayCandles,
  fetchSndkIntradayCandles,
  evaluateMomentumFromCandles,
  runForceStartEpisode,
} from './engine.js'
export * as momentumConfig from './config.js'
export { advanceEpisode, forceStartEpisodeFromWindow } from './episode.js'
export {
  isUsEquityTriggerOpen,
  shouldRunUsEquityTrigger,
  usEquitySessionId,
} from './usEquitySession.js'
export { resolveMarketProfile } from './marketProfile.js'
export { resolveSession } from './sessionCalendar.js'
export { evaluateFreshness } from './freshness.js'
export { evaluateSymbolGate, calendarAllowsHeavyWork } from './engineGate.js'
export { walkBackEligibleTradingMinutes } from './tradingTime.js'
export { buildMarketStatusPopup } from './marketStatusPopup.js'
export {
  enterFullMarketClose,
  isEngineAsleep,
  listSleepRecords,
  startWakeScheduler,
  stopWakeScheduler,
} from './wakeScheduler.js'
export { resolveLifecycle } from './lifecycle.js'
export { buildNotificationCopy, isPushWorthy } from './notifyCopy.js'
export {
  deliverEpisodeEvents,
  loadWatchlistEligibleDevices,
  filterEligibleAtDeliveryTime,
} from './delivery.js'
export {
  handleAutoStartResearchAlerts,
  researchStartMove,
} from './autoStartAlert.js'
export {
  runDailyDigestCycle,
  processDigestForTicker,
  isDailyDigestEnabled,
  isDigestEligibleTicker,
  buildDigestTitle,
  buildDigestLead,
  dayMovePercent,
  userFacingResearchText,
  dueDigestSlots,
} from './dailyDigest.js'
export {
  runMarketSessionBulletinCycle,
  runMarketSessionBulletin,
  isMarketBulletinEnabled,
  buildMarketBulletinTitle,
  buildMarketBulletinBody,
  formatStockBracketPct,
  dueMarketBulletinSlots,
} from './marketSessionBulletin.js'
export {
  isTestModeEnabled,
  setTestModeEnabled,
  getTestModeSnapshot,
  ALWAYS_NOTIFY_DEVICE,
  resolvePushRecipients,
} from './testMode.js'
