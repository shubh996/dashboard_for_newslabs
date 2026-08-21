export type AssetClassId =
  | 'equity'
  | 'index'
  | 'forex'
  | 'crypto'
  | 'commodity'

export type StudioView =
  | 'overview'
  | 'watchlist'
  | 'episodes'
  | 'activity'
  | 'users'
  | 'perplexity'

export type StudioTicker = {
  ticker: string
  label: string
  assetClass: AssetClassId
  subscriberCount: number | null
}

export type ReturnsMap = Record<string, number | null | undefined>

export type StudioEpisode = {
  direction?: 'UP' | 'DOWN' | string
  episodeStartedAt?: string
  detectedWindow?: string
  initialMovePercent?: number | null
  peakMovePercent?: number | null
  currentMovePercent?: number | null
  currentPrice?: number | null
  status?: string
  state?: string | null
  episodeId?: string
  episodeNo?: number | null
  endReason?: string | null
  referencePrice?: number | null
  peakPrice?: number | null
  troughPrice?: number | null
  ticker?: string
}

export type StudioEvent = {
  eventType?: string
  direction?: string
  movePercent?: number | null
  detectedWindow?: string
  detectedAt?: string
  notifiedAt?: string | null
  price?: number
  shouldNotify?: boolean
  state?: string
  episodeNo?: number | null
  notification?: { title?: string; body?: string } | null
}

export type StudioLog = {
  at?: string
  level?: string
  source?: string
  message?: string
}

export type StudioStatus = {
  ticker?: string
  lastFetchAt?: string | null
  lastError?: string | null
  tickCount?: number
  pollIntervalMs?: number
  engineEnabled?: boolean
  loopRunning?: boolean
  pollMode?: string
  watchedTickers?: string[]
  watchedCount?: number
  pollPerCycle?: number
  maxWatched?: number
  lastCycleTickers?: string[]
  episode?: StudioEpisode | null
  episodes?: StudioEpisode[] | null
  events?: StudioEvent[]
  logs?: StudioLog[]
  snapshot?: {
    currentPrice?: number
    previousClose?: number | null
    previousCloseTime?: string | null
    assetClass?: string | null
    marketState?: string | null
    marketStateLabel?: string | null
    marketSession?: string
    returns?: ReturnsMap
    references?: Record<string, number | null | undefined>
    referenceTimes?: Record<string, string | null | undefined>
    visibleReturnKeys?: string[]
    asOfTime?: string | null
    strongestMomentum?: {
      window: string
      movePercent: number
      direction: string
    } | null
    sessionQuote?: {
      live?: { price?: number | null; changePercent?: number | null }
      regular?: {
        price?: number | null
        changePercent?: number | null
        time?: string | null
      }
    } | null
  } | null
  config?: {
    thresholdSnapshot?: {
      windows: Record<string, number | null>
      day: number
    }
    episodePolicy?: Record<string, number | boolean | null | undefined>
    testMode?: {
      enabled?: boolean
      dummyResearch?: boolean
      summary?: string
      alwaysNotify?: {
        device_id?: string
        expo_push_token?: string
        label?: string
      }
      alwaysNotifyDevices?: Array<{
        id?: string
        label?: string
        device_id?: string
        expo_push_token?: string
        aliases?: string[]
      }>
      selectedAllowlist?: {
        selectedDeviceIds?: string[]
        selectedTokens?: string[]
      }
    }
  }
}

export type ActiveEpisodeRow = {
  ticker: string
  episodeId?: string | null
  episodeNo?: number | null
  direction?: string
  state?: string | null
  status?: string
  endReason?: string | null
  detectedWindow?: string | null
  currentMovePercent?: number | null
  peakMovePercent?: number | null
  initialMovePercent?: number | null
  currentPrice?: number | null
  episodeStartedAt?: string | null
  endedAt?: string | null
  exactLabel?: string | null
  marketSession?: string | null
}
