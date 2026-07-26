import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  ExternalLink,
  Loader2,
  Newspaper,
  PenLine,
  RefreshCw,
  Save,
  Terminal,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type DashboardSection = 'tickers' | 'news' | 'custom' | 'users'
type NotificationApp = 'nineam' | 'trigger'
type MovementAlertTarget = {
  ticker: string
  event: PriceMovementEvent | null
}

type MonitoredTicker = {
  ticker: string
  company_name: string
  created_at?: string | null
  updated_at?: string | null
  has_saved_movements?: boolean
  saved_event_count?: number
  last_saved_at?: string | null
  subscriber_count?: number
  device_ids?: string[]
  saved_events?: PriceMovementEvent[]
}

type NewsArticle = {
  id: string
  provider?: string | null
  title: string
  summary?: string
  url?: string
  image_url?: string | null
  source_name?: string | null
  author?: string | null
  published_at?: string | null
  tickers?: string[]
  topics?: string[]
  created_at?: string | null
  /** Push body preview: "NVDA (bullish) · AAPL (bearish)" */
  impact_body?: string
  ticker_sides?: Array<{ ticker: string; side: string; arrow?: string }>
}

type EnabledDevice = {
  device_id: string | null
  expo_push_token: string
  tickers: string[]
}

type MovementSource = {
  title?: string | null
  domain?: string | null
  url?: string | null
}

type SaveStatus = 'new' | 'changed' | 'saved' | 'invalid'

type PriceMovementEvent = {
  event_date: string
  display_date?: string | null
  time_label?: string | null
  price?: string | null
  price_change?: string | null
  momentum?: string | null
  summary?: string
  reasons?: string[]
  sources?: MovementSource[]
  source_count?: number
  claimed_source_count?: number | null
  /** Set after scrape compares against Supabase date map. */
  save_status?: SaveStatus
  previously_saved_at?: string | null
}

type ScrapeLog = {
  at: string
  level: string
  message: string
  detail?: unknown
}

type CompareSummary = {
  total: number
  new: number
  changed: number
  already_saved: number
}

type AutoSaveResult = {
  ok: boolean
  mode?: string
  inserted?: number
  inserted_dates?: string[]
  total_saved_events?: number
  message?: string
  rows_updated?: number
}

type ScrapeResult = {
  ticker: string
  url: string
  scraped_at: string
  events: PriceMovementEvent[]
  section_found: boolean
  credits: {
    before: { remaining_credits: number | null; plan_credits: number | null } | null
    after: { remaining_credits: number | null; plan_credits: number | null } | null
    used: number | null
  }
  logs: ScrapeLog[]
  compare?: CompareSummary
  auto_save?: AutoSaveResult | null
}

type TabScrapeState = {
  loading: boolean
  saving: boolean
  alerting: boolean
  error: string
  result: ScrapeResult | null
  saveMessage: string
  saveIsNoop: boolean
  alertMessage: string
  alertIsError: boolean
  /** Accumulated logs for this tab (scrape + save + alert) shown in the right rail. */
  logs: ScrapeLog[]
}

const emptyTabState = (): TabScrapeState => ({
  loading: false,
  saving: false,
  alerting: false,
  error: '',
  result: null,
  saveMessage: '',
  saveIsNoop: false,
  alertMessage: '',
  alertIsError: false,
  logs: [],
})

/**
 * Display price change with correct sign coloring.
 * Does NOT invent a leading + when the value is unsigned.
 */
function formatChange(change?: string | null) {
  if (!change) return null
  const trimmed = String(change).trim()
  if (!trimmed) return null
  const negative = trimmed.startsWith('-')
  const positive = trimmed.startsWith('+')
  return {
    text: trimmed,
    negative,
    positive,
    neutral: !negative && !positive,
  }
}

function formatDigestMomentum(raw?: string | null) {
  const value = String(raw || '').trim().replace(/^−/, '-')
  if (!value) return ''
  if (value.startsWith('+') || value.startsWith('-')) return value
  const numeric = Number.parseFloat(value.replace(/%/g, '').replace(/,/g, ''))
  if (!Number.isFinite(numeric)) return value
  const magnitude = value.includes('%') ? value : `${Math.abs(numeric)}%`
  return numeric < 0 ? `-${magnitude.replace(/^-/, '')}` : `+${magnitude}`
}

function formatLogTime(iso: string) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatEventHeading(event: PriceMovementEvent) {
  if (event.display_date) {
    return event.time_label ? `${event.display_date} · ${event.time_label}` : event.display_date
  }
  try {
    return new Date(`${event.event_date}T12:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return event.event_date
  }
}

function sourceKey(source: MovementSource, index: number) {
  return source.url || source.domain || source.title || `source-${index}`
}

function sourceLabel(source: MovementSource) {
  return source.title || source.domain || source.url || 'Source'
}

function deviceKey(device: EnabledDevice) {
  return device.device_id || device.expo_push_token
}

export default function NotificationsPage() {
  const [notificationApp, setNotificationApp] = useState<NotificationApp>('nineam')
  const [section, setSection] = useState<DashboardSection>('tickers')
  const [tickers, setTickers] = useState<MonitoredTicker[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [activeTicker, setActiveTicker] = useState<string>('')
  const [tabState, setTabState] = useState<Record<string, TabScrapeState>>({})
  const [creditHint, setCreditHint] = useState<string>('')

  // News alert tab
  const [news, setNews] = useState<NewsArticle[]>([])
  const [newsTotal, setNewsTotal] = useState<number | null>(null)
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsLoadingMore, setNewsLoadingMore] = useState(false)
  const [newsError, setNewsError] = useState('')
  const [newsHasMore, setNewsHasMore] = useState(false)
  const [newsSending, setNewsSending] = useState(false)
  const [newsAlertMessage, setNewsAlertMessage] = useState('')
  const [newsAlertIsError, setNewsAlertIsError] = useState(false)
  const [newsLogs, setNewsLogs] = useState<ScrapeLog[]>([])
  const [devices, setDevices] = useState<EnabledDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState('')
  /** Selected news article id (single). */
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null)
  /** Selected device keys: device_id if present, else expo_push_token. */
  const [selectedDeviceKeys, setSelectedDeviceKeys] = useState<string[]>([])

  // Custom notification tab
  const [customTitle, setCustomTitle] = useState('')
  const [customBody, setCustomBody] = useState('')
  const [customSending, setCustomSending] = useState(false)
  const [customMessage, setCustomMessage] = useState('')
  const [customIsError, setCustomIsError] = useState(false)
  const [customLogs, setCustomLogs] = useState<ScrapeLog[]>([])
  const [usersLogs, setUsersLogs] = useState<ScrapeLog[]>([])
  const [customSelectedDeviceKeys, setCustomSelectedDeviceKeys] = useState<string[]>([])
  const [movementAlertOpen, setMovementAlertOpen] = useState(false)
  const [movementAlertTarget, setMovementAlertTarget] = useState<MovementAlertTarget | null>(null)
  const [movementAlertDeviceKeys, setMovementAlertDeviceKeys] = useState<string[]>([])
  const [movementPreviewTitle, setMovementPreviewTitle] = useState('')
  const [movementPreviewBody, setMovementPreviewBody] = useState('')
  const [movementPreviewLoading, setMovementPreviewLoading] = useState(false)
  const [movementPreviewError, setMovementPreviewError] = useState('')
  const [digestOpen, setDigestOpen] = useState(false)
  const [digestScopeDeviceKeys, setDigestScopeDeviceKeys] = useState<string[]>([])
  const [digestSelectedDeviceKeys, setDigestSelectedDeviceKeys] = useState<string[]>([])
  const [digestTitle, setDigestTitle] = useState("Today's notable price momentum")
  const [digestSending, setDigestSending] = useState(false)
  const [digestMessage, setDigestMessage] = useState('')
  const [digestIsError, setDigestIsError] = useState(false)

  const activeState = activeTicker ? tabState[activeTicker] || emptyTabState() : emptyTabState()
  const movementAlertDevices = useMemo(() => {
    if (!movementAlertTarget) return []
    const ticker = movementAlertTarget.ticker.toUpperCase()
    return devices.filter((device) =>
      (device.tickers || []).some((item) => item.toUpperCase() === ticker),
    )
  }, [devices, movementAlertTarget])
  const movementAlertSelectedCount = useMemo(() => {
    const selected = new Set(movementAlertDeviceKeys)
    return movementAlertDevices.filter((device) => selected.has(deviceKey(device))).length
  }, [movementAlertDeviceKeys, movementAlertDevices])
  const digestDevices = useMemo(() => {
    const scope = new Set(digestScopeDeviceKeys)
    return devices.filter((device) => scope.has(deviceKey(device)))
  }, [devices, digestScopeDeviceKeys])
  const digestSelectedCount = useMemo(() => {
    const selected = new Set(digestSelectedDeviceKeys)
    return digestDevices.filter((device) => selected.has(deviceKey(device))).length
  }, [digestDevices, digestSelectedDeviceKeys])

  const appendNewsLog = useCallback((level: string, message: string, detail?: unknown) => {
    setNewsLogs((prev) => [
      ...prev,
      {
        at: new Date().toISOString(),
        level,
        message,
        detail: detail ?? null,
      },
    ])
  }, [])

  const appendCustomLog = useCallback((level: string, message: string, detail?: unknown) => {
    setCustomLogs((prev) => [
      ...prev,
      {
        at: new Date().toISOString(),
        level,
        message,
        detail: detail ?? null,
      },
    ])
  }, [])

  const appendUsersLog = useCallback((level: string, message: string, detail?: unknown) => {
    setUsersLogs((prev) => [
      ...prev,
      {
        at: new Date().toISOString(),
        level,
        message,
        detail: detail ?? null,
      },
    ])
  }, [])

  const loadTickers = useCallback(async () => {
    setListLoading(true)
    setListError('')
    try {
      const response = await fetch(
        `/api/notifications/monitored-tickers?app=${encodeURIComponent(notificationApp)}`,
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Failed to load tickers (${response.status})`)
      }
      const next = (body.tickers || []) as MonitoredTicker[]
      setTickers(next)
      setActiveTicker((current) => {
        if (current && next.some((item) => item.ticker === current)) return current
        return next[0]?.ticker || ''
      })
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Failed to load monitored tickers')
    } finally {
      setListLoading(false)
    }
  }, [notificationApp])

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true)
    setDevicesError('')
    try {
      const response = await fetch(
        `/api/notifications/devices?app=${encodeURIComponent(notificationApp)}`,
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Failed to load devices (${response.status})`)
      }
      const next = (body.devices || []) as EnabledDevice[]
      setDevices(next)
      // Default: select all when list first loads or was empty.
      setSelectedDeviceKeys((prev) => {
        if (prev.length === 0 && next.length > 0) {
          return next.map(deviceKey)
        }
        // Keep previous selections that still exist; if none remain, select all.
        const keys = new Set(next.map(deviceKey))
        const kept = prev.filter((k) => keys.has(k))
        return kept.length ? kept : next.map(deviceKey)
      })
      setCustomSelectedDeviceKeys((prev) => {
        if (prev.length === 0 && next.length > 0) {
          return next.map(deviceKey)
        }
        const keys = new Set(next.map(deviceKey))
        const kept = prev.filter((k) => keys.has(k))
        return kept.length ? kept : next.map(deviceKey)
      })
      appendNewsLog('info', `Loaded ${next.length} device(s) with notifications on`, {
        device_ids: next.map((d) => d.device_id),
      })
      appendCustomLog('info', `Loaded ${next.length} device(s) with notifications on`, {
        device_ids: next.map((d) => d.device_id),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load devices'
      setDevicesError(message)
      appendNewsLog('error', message)
      appendCustomLog('error', message)
    } finally {
      setDevicesLoading(false)
    }
  }, [appendNewsLog, appendCustomLog, notificationApp])

  const loadNews = useCallback(
    async (opts?: { append?: boolean }) => {
      const append = Boolean(opts?.append)
      if (append) setNewsLoadingMore(true)
      else {
        setNewsLoading(true)
        setNewsError('')
      }
      try {
        const offset = append ? news.length : 0
        const response = await fetch(
          `/api/notifications/news?limit=40&offset=${offset}`,
        )
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(body.error || `Failed to load news (${response.status})`)
        }
        const batch = (body.articles || []) as NewsArticle[]
        setNews((prev) => (append ? [...prev, ...batch] : batch))
        setNewsTotal(typeof body.total === 'number' ? body.total : null)
        setNewsHasMore(Boolean(body.has_more))
        if (!append && batch.length > 0) {
          setSelectedArticleId((current) =>
            current && batch.some((a) => a.id === current) ? current : batch[0].id,
          )
        }
        appendNewsLog(
          'info',
          append
            ? `Loaded ${batch.length} more articles (offset ${offset})`
            : `Loaded ${batch.length} news articles from Supabase`,
          { total: body.total, offset },
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load news'
        if (!append) setNewsError(message)
        appendNewsLog('error', message)
      } finally {
        setNewsLoading(false)
        setNewsLoadingMore(false)
      }
    },
    [appendNewsLog, news.length],
  )

  const loadCreditsHint = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications/firecrawl/credits')
      const body = await response.json().catch(() => ({}))
      if (!response.ok) return
      const remaining = body.credits?.remaining_credits
      const plan = body.credits?.plan_credits
      if (remaining != null) {
        setCreditHint(
          plan != null
            ? `Firecrawl balance: ${remaining} / ${plan} credits`
            : `Firecrawl remaining: ${remaining} credits`,
        )
      }
    } catch {
      // optional
    }
  }, [])

  useEffect(() => {
    void loadTickers()
    void loadCreditsHint()
    void loadDevices()
  }, [loadTickers, loadCreditsHint, loadDevices])

  useEffect(() => {
    setDevices([])
    if (notificationApp === 'trigger') {
      setSection((current) =>
        current === 'news' || current === 'custom' ? 'tickers' : current,
      )
    }
    setMovementAlertOpen(false)
    setMovementAlertTarget(null)
    setMovementAlertDeviceKeys([])
    setMovementPreviewTitle('')
    setMovementPreviewBody('')
    setMovementPreviewError('')
    setDigestOpen(false)
    setDigestScopeDeviceKeys([])
    setDigestSelectedDeviceKeys([])
    setDigestMessage('')
  }, [notificationApp])

  // When entering News or Custom, refresh devices (and news for News tab).
  useEffect(() => {
    if (section === 'news') {
      void loadDevices()
      void loadNews()
      return
    }
    if (section === 'custom' || section === 'users') {
      void loadDevices()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on section enter
  }, [section])

  function patchTab(ticker: string, patch: Partial<TabScrapeState>) {
    setTabState((current) => ({
      ...current,
      [ticker]: {
        ...(current[ticker] || emptyTabState()),
        ...patch,
      },
    }))
  }

  function appendLocalLog(ticker: string, level: string, message: string, detail?: unknown) {
    const entry: ScrapeLog = {
      at: new Date().toISOString(),
      level,
      message,
      detail: detail ?? null,
    }
    setTabState((current) => {
      const prev = current[ticker] || emptyTabState()
      return {
        ...current,
        [ticker]: {
          ...prev,
          logs: [...prev.logs, entry],
        },
      }
    })
  }

  async function handleRefresh(ticker: string) {
    patchTab(ticker, { loading: true, error: '', saveMessage: '', saveIsNoop: false })
    appendLocalLog(ticker, 'info', `Refresh clicked for ${ticker}`)
    try {
      // Refresh is read-only: compare against Supabase and leave new/changed data pending.
      const response = await fetch(
        `/api/notifications/scrape/${encodeURIComponent(ticker)}?auto_save=0`,
        { method: 'POST' },
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Scrape failed (${response.status})`)
      }
      const result = body as ScrapeResult
      const compare = result.compare
      const saveMessage =
        compare
          ? compare.new === 0 && compare.changed === 0
            ? `All ${compare.already_saved} refreshed date(s) are already stored in Supabase.`
            : `${compare.new + compare.changed} refreshed date(s) are not yet saved — review and click Save.`
          : ''

      setTabState((current) => {
        const prev = current[ticker] || emptyTabState()
        return {
          ...current,
          [ticker]: {
            ...prev,
            loading: false,
            result,
            error: '',
            saveMessage,
            saveIsNoop: Boolean(compare && compare.new === 0 && compare.changed === 0),
            // Prefer server scrape logs; keep a short local preamble if empty.
            logs: result.logs?.length ? result.logs : prev.logs,
          },
        }
      })
      if (body.credits?.after?.remaining_credits != null) {
        const used = body.credits.used
        setCreditHint(
          used != null
            ? `Firecrawl balance: ${body.credits.after.remaining_credits} remaining · last scrape used ${used}`
            : `Firecrawl balance: ${body.credits.after.remaining_credits} remaining`,
        )
      } else {
        void loadCreditsHint()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scrape failed'
      patchTab(ticker, { loading: false, error: message })
      appendLocalLog(ticker, 'error', message)
    }
  }

  function resolveSelectedDevices(keys: string[]) {
    const keySet = new Set(keys)
    return devices.filter((d) => keySet.has(deviceKey(d)))
  }

  function toggleDeviceKey(
    key: string,
    current: string[],
    setKeys: (next: string[]) => void,
  ) {
    if (current.includes(key)) {
      setKeys(current.filter((k) => k !== key))
    } else {
      setKeys([...current, key])
    }
  }

  function selectAllDevices(setKeys: (next: string[]) => void) {
    setKeys(devices.map(deviceKey))
  }

  function clearDeviceSelection(setKeys: (next: string[]) => void) {
    setKeys([])
  }

  function triggerDigestBody(device: EnabledDevice) {
    const items = (device.tickers || [])
      .map((symbol) => {
        const tickerMeta = tickers.find(
          (item) => item.ticker.toUpperCase() === symbol.toUpperCase(),
        )
        const latest = tickerMeta?.saved_events?.[0]
        const momentum = formatDigestMomentum(latest?.price_change || latest?.momentum)
        return momentum ? `${symbol.toUpperCase()} (${momentum})` : symbol.toUpperCase()
      })
      .sort()
    return items.length
      ? items.join(' · ')
      : 'No subscribed ticker momentum is available yet.'
  }

  function openTriggerDigest(device?: EnabledDevice) {
    const candidates = device ? [device] : devices
    const keys = candidates.map(deviceKey)
    setDigestScopeDeviceKeys(keys)
    setDigestSelectedDeviceKeys(keys)
    setDigestTitle("Today's notable price momentum")
    setDigestMessage('')
    setDigestIsError(false)
    setDigestOpen(true)
    appendUsersLog('info', device ? 'Individual Trigger alert opened' : 'Alert all opened', {
      recipient_count: candidates.length,
      device_ids: candidates.map((item) => item.device_id),
    })
  }

  async function handleTriggerDigestSend() {
    const selectedKeys = new Set(digestSelectedDeviceKeys)
    const selected = digestDevices.filter((device) => selectedKeys.has(deviceKey(device)))
    if (!selected.length || !digestTitle.trim()) return

    setDigestSending(true)
    setDigestMessage('')
    setDigestIsError(false)
    appendUsersLog('info', 'Sending personalized Trigger momentum digest', {
      title: digestTitle.trim(),
      recipient_count: selected.length,
      device_ids: selected.map((device) => device.device_id),
      previews: selected.map((device) => ({
        device_id: device.device_id,
        body: triggerDigestBody(device),
      })),
    })
    try {
      const response = await fetch('/api/notifications/alert-trigger-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: digestTitle.trim(),
          device_ids: selected.map((device) => device.device_id).filter(Boolean),
          expo_push_tokens: selected.map((device) => device.expo_push_token),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Trigger digest failed (${response.status})`)
      }
      const message =
        body.message || `Momentum digest sent to ${body.sent_ok ?? 0} Trigger user(s)`
      const isError = Boolean(body.sent_failed || body.ok === false)
      setDigestMessage(message)
      setDigestIsError(isError)
      appendUsersLog(isError ? 'warn' : 'success', message, {
        sent_ok: body.sent_ok,
        sent_failed: body.sent_failed,
        device_ids: body.device_ids,
        previews: body.previews,
        tickets: body.tickets,
        errors: body.errors,
      })
      if (!isError) setDigestOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Trigger digest failed'
      setDigestMessage(message)
      setDigestIsError(true)
      appendUsersLog('error', message)
    } finally {
      setDigestSending(false)
    }
  }

  async function handleCustomSend() {
    const title = customTitle.trim()
    const body = customBody.trim()
    if (!title) {
      setCustomMessage('Title is required for the notification header.')
      setCustomIsError(true)
      appendCustomLog('warn', 'Custom send blocked — empty title')
      return
    }
    if (!body) {
      setCustomMessage('Body is required for the second line.')
      setCustomIsError(true)
      appendCustomLog('warn', 'Custom send blocked — empty body')
      return
    }
    const selected = resolveSelectedDevices(customSelectedDeviceKeys)
    if (selected.length <= 0) {
      setCustomMessage('Select at least one device.')
      setCustomIsError(true)
      appendCustomLog('warn', 'Custom send blocked — no devices selected')
      return
    }

    const ok = window.confirm(
      `Send this custom notification to ${selected.length} selected device(s)?\n\n${title}\n${body.slice(0, 160)}${body.length > 160 ? '…' : ''}`,
    )
    if (!ok) {
      appendCustomLog('info', 'Custom send cancelled')
      return
    }

    setCustomSending(true)
    setCustomMessage('')
    setCustomIsError(false)
    appendCustomLog('info', 'Sending custom notification', {
      title,
      body,
      device_count: selected.length,
      device_ids: selected.map((d) => d.device_id),
    })

    try {
      const response = await fetch('/api/notifications/alert-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'custom_alert',
          app_key: notificationApp,
          title,
          body,
          device_ids: selected.map((d) => d.device_id).filter(Boolean),
          expo_push_tokens: selected.map((d) => d.expo_push_token),
        }),
      })
      const resBody = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(resBody.error || `Custom alert failed (${response.status})`)
      }
      const message =
        resBody.message || `Custom alert sent to ${resBody.sent_ok ?? 0} device(s)`
      const isError = Boolean(resBody.sent_failed || resBody.ok === false)
      setCustomMessage(message)
      setCustomIsError(isError)
      appendCustomLog(isError ? 'warn' : 'success', message, {
        title: resBody.title,
        body: resBody.body,
        sent_ok: resBody.sent_ok,
        sent_failed: resBody.sent_failed,
        device_ids: resBody.device_ids,
        tickets: resBody.tickets,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Custom alert failed'
      setCustomMessage(message)
      setCustomIsError(true)
      appendCustomLog('error', message)
    } finally {
      setCustomSending(false)
    }
  }

  async function handleNewsSend() {
    const article = news.find((a) => a.id === selectedArticleId) || null
    if (!article) {
      setNewsAlertMessage('Select a news article first.')
      setNewsAlertIsError(true)
      appendNewsLog('warn', 'News send blocked — no article selected')
      return
    }
    const selected = resolveSelectedDevices(selectedDeviceKeys)
    if (selected.length <= 0) {
      setNewsAlertMessage('Select at least one device.')
      setNewsAlertIsError(true)
      appendNewsLog('warn', 'News send blocked — no devices selected')
      return
    }

    const ok = window.confirm(
      `Send this news to ${selected.length} selected device(s)?\n\n"${article.title}"`,
    )
    if (!ok) {
      appendNewsLog('info', 'News alert cancelled')
      return
    }

    setNewsSending(true)
    setNewsAlertMessage('')
    setNewsAlertIsError(false)
    appendNewsLog('info', `News alert for article ${article.id}`, {
      title: article.title,
      device_count: selected.length,
      device_ids: selected.map((d) => d.device_id),
    })

    try {
      const response = await fetch('/api/notifications/alert-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_key: notificationApp,
          article_id: article.id,
          device_ids: selected.map((d) => d.device_id).filter(Boolean),
          expo_push_tokens: selected.map((d) => d.expo_push_token),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `News alert failed (${response.status})`)
      }
      const message =
        body.message || `News alert sent to ${body.sent_ok ?? 0} device(s)`
      const isError = Boolean(body.sent_failed || body.ok === false)
      setNewsAlertMessage(message)
      setNewsAlertIsError(isError)
      appendNewsLog(isError ? 'warn' : 'success', message, {
        title: body.title,
        title_length: body.title_length,
        title_is_full_headline: body.title_is_full_headline,
        body: body.body,
        sent_ok: body.sent_ok,
        sent_failed: body.sent_failed,
        device_ids: body.device_ids,
        expo_errors: body.errors,
        expo_tickets: body.tickets,
        notification_format: 'text-only',
        channel_id: body.channel_id,
        channel_note: body.channel_note,
        sample_expo_payload: body.sample_expo_payload,
        ios_nse_required: body.ios_nse_required,
      })
      appendNewsLog('info', 'Text-only notification payload', body.sample_expo_payload || null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'News alert failed'
      setNewsAlertMessage(message)
      setNewsAlertIsError(true)
      appendNewsLog('error', message)
    } finally {
      setNewsSending(false)
    }
  }

  async function openMovementAlert(ticker: string, event: PriceMovementEvent | null = null) {
    const normalizedTicker = ticker.toUpperCase()
    const eligible = devices.filter((device) =>
      (device.tickers || []).some((item) => item.toUpperCase() === normalizedTicker),
    )
    setMovementAlertTarget({ ticker: normalizedTicker, event })
    setMovementAlertDeviceKeys(eligible.map(deviceKey))
    setMovementAlertOpen(true)
    setMovementPreviewTitle('')
    setMovementPreviewBody('')
    setMovementPreviewError('')
    setMovementPreviewLoading(true)
    appendLocalLog(ticker, 'info', 'Alert recipient picker opened', {
      app_key: notificationApp,
      event_date: event?.event_date || 'latest saved',
      default_selected: eligible.length,
      device_ids: eligible.map((device) => device.device_id),
    })
    try {
      const response = await fetch(
        `/api/notifications/preview/${encodeURIComponent(normalizedTicker)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app_key: notificationApp,
            event,
          }),
        },
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Preview failed (${response.status})`)
      }
      setMovementPreviewTitle(String(body.title || ''))
      setMovementPreviewBody(String(body.body || ''))
      appendLocalLog(ticker, 'info', 'Notification preview loaded', {
        app_key: body.app_key,
        event_date: body.event_date,
        title: body.title,
        body: body.body,
        deep_link: body.deep_link,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Notification preview failed'
      setMovementPreviewError(message)
      appendLocalLog(ticker, 'error', message)
    } finally {
      setMovementPreviewLoading(false)
    }
  }

  async function handleAlertUsers() {
    if (!movementAlertTarget) return
    const ticker = movementAlertTarget.ticker
    const selectedKeys = new Set(movementAlertDeviceKeys)
    const selected = movementAlertDevices.filter((device) =>
      selectedKeys.has(deviceKey(device)),
    )
    if (!selected.length) return

    patchTab(ticker, {
      alerting: true,
      error: '',
      alertMessage: '',
      alertIsError: false,
    })
    appendLocalLog(ticker, 'info', `Sending selected movement alert for ${ticker}`, {
      app_key: notificationApp,
      event_date: movementAlertTarget.event?.event_date || 'latest saved',
      recipient_count: selected.length,
      device_ids: selected.map((device) => device.device_id),
    })

    try {
      const response = await fetch(`/api/notifications/alert/${encodeURIComponent(ticker)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_key: notificationApp,
          event: movementAlertTarget.event,
          title: movementPreviewTitle.trim() || undefined,
          body: movementPreviewBody.trim() || undefined,
          device_ids: selected.map((device) => device.device_id).filter(Boolean),
          expo_push_tokens: selected.map((device) => device.expo_push_token),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Alert failed (${response.status})`)
      }

      const message =
        body.message ||
        `Alert sent to ${body.sent_ok ?? 0} device(s) for ${ticker}` +
          (body.sent_failed ? ` · ${body.sent_failed} failed` : '')
      const isError = Boolean(body.sent_failed || body.ok === false)

      patchTab(ticker, {
        alerting: false,
        alertMessage: message,
        alertIsError: isError,
      })
      appendLocalLog(ticker, isError ? 'warn' : 'success', message, {
        title: body.title,
        body: body.body,
        event_date: body.event_date,
        recipient_count: body.recipient_count,
        sent_ok: body.sent_ok,
        sent_failed: body.sent_failed,
        device_ids: body.device_ids,
        tickets: body.tickets,
        errors: body.errors,
      })
      if (!isError) {
        setMovementAlertOpen(false)
        setMovementAlertTarget(null)
        setMovementAlertDeviceKeys([])
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Alert failed'
      patchTab(ticker, {
        alerting: false,
        alertMessage: message,
        alertIsError: true,
      })
      appendLocalLog(ticker, 'error', message)
    }
  }

  async function handleSave(ticker: string) {
    const state = tabState[ticker] || emptyTabState()
    const events = state.result?.events || []
    if (!events.length) {
      patchTab(ticker, { error: 'Nothing to save. Click Refresh first.' })
      appendLocalLog(ticker, 'warn', 'Save blocked — no scraped events')
      return
    }
    const pending = events.filter(
      (event) => event.save_status === 'new' || event.save_status === 'changed',
    )
    if (!pending.length) {
      const message = 'Nothing to write — every scraped date is already saved with the same content.'
      patchTab(ticker, { saveMessage: message, saveIsNoop: true, error: '' })
      appendLocalLog(ticker, 'info', message)
      return
    }
    patchTab(ticker, { saving: true, error: '', saveMessage: '', saveIsNoop: false })
    appendLocalLog(ticker, 'info', `Save clicked for ${ticker}`, {
      pending_dates: pending.map((e) => e.event_date),
      pending_count: pending.length,
    })
    try {
      // Only new + content-changed dates are written; already-saved dates are skipped server-side.
      const response = await fetch(`/api/notifications/save/${encodeURIComponent(ticker)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events,
          source_url: state.result?.url,
          scraped_at: state.result?.scraped_at,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Save failed (${response.status})`)
      }
      const noop = body.changed === false
      const message =
        body.message ||
        (noop
          ? 'No changes — same content already saved.'
          : `Saved ${body.inserted || 0} new / ${body.updated || 0} updated date(s).`)

      // Mark written events as saved in the local timeline.
      const written = new Set<string>([
        ...((body.inserted_dates as string[]) || []),
        ...((body.updated_dates as string[]) || []),
        ...((body.written_dates as string[]) || []),
      ])
      setTabState((current) => {
        const prev = current[ticker] || emptyTabState()
        const prevResult = prev.result
        if (!prevResult) {
          return {
            ...current,
            [ticker]: { ...prev, saving: false, saveMessage: message, saveIsNoop: noop },
          }
        }
        return {
          ...current,
          [ticker]: {
            ...prev,
            saving: false,
            saveMessage: message,
            saveIsNoop: noop,
            result: {
              ...prevResult,
              events: prevResult.events.map((event) =>
                written.has(event.event_date)
                  ? { ...event, save_status: 'saved' as const }
                  : event,
              ),
              compare: {
                total: prevResult.events.length,
                new: 0,
                changed: prevResult.events.filter(
                  (e) => !written.has(e.event_date) && e.save_status === 'changed',
                ).length,
                already_saved: prevResult.events.filter(
                  (e) => written.has(e.event_date) || e.save_status === 'saved',
                ).length,
              },
            },
          },
        }
      })
      appendLocalLog(ticker, noop ? 'info' : 'success', message, {
        inserted: body.inserted,
        updated: body.updated,
        inserted_dates: body.inserted_dates,
        updated_dates: body.updated_dates,
        skipped_already_saved: body.skipped_already_saved,
        total_saved_events: body.total_saved_events,
        structure: body.structure,
      })
      if (!noop) void loadTickers()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed'
      patchTab(ticker, { saving: false, error: message })
      appendLocalLog(ticker, 'error', message)
    }
  }

  const activeMeta = useMemo(
    () => tickers.find((item) => item.ticker === activeTicker) || null,
    [tickers, activeTicker],
  )

  const events = activeState.result?.events || []
  const storedEvents = activeMeta?.saved_events || []
  const pendingEvents = events.filter(
    (event) => event.save_status === 'new' || event.save_status === 'changed',
  )
  const logs =
    section === 'news'
      ? newsLogs
      : section === 'custom'
        ? customLogs
        : section === 'users'
          ? usersLogs
        : activeState.logs || []
  const pendingSaveCount = events.filter(
    (event) => event.save_status === 'new' || event.save_status === 'changed',
  ).length
  const compare = activeState.result?.compare
  const previewTitle = customTitle.trim() || 'Notification title'
  const previewBody = customBody.trim() || 'Notification body will appear here…'
  const previewTitleEmpty = !customTitle.trim()
  const previewBodyEmpty = !customBody.trim()

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      <header className="z-20 shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex h-14 w-full items-center gap-3 px-4 sm:px-6">
          <Link
            to="/"
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Back to home"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight">
              {notificationApp === 'nineam' ? '9AM' : 'Trigger'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {notificationApp === 'nineam'
                ? 'Notification dashboard'
                : 'Notable stock momentum notifications'}
            </p>
          </div>
          {section === 'tickers' && creditHint ? (
            <p className="hidden text-xs text-muted-foreground md:block">{creditHint}</p>
          ) : null}
          {section === 'news' || section === 'custom' || section === 'users' ? (
            <p className="hidden text-xs text-muted-foreground md:block">
              {devicesLoading
                ? 'Loading devices…'
                : `${devices.length} device${devices.length === 1 ? '' : 's'} with notifications on`}
            </p>
          ) : null}
          <Bell className="size-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="flex h-12 items-end gap-1 border-t border-border/60 px-4 sm:px-6">
          <button
            type="button"
            role="tab"
            aria-selected={notificationApp === 'nineam'}
            onClick={() => setNotificationApp('nineam')}
            className={cn(
              'relative flex h-11 min-w-32 items-center gap-2.5 border-b-2 px-3 text-left transition-colors',
              notificationApp === 'nineam'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="flex size-6 items-center justify-center rounded-md bg-foreground text-[11px] font-bold text-background">
              9
            </span>
            <span>
              <span className="block text-sm font-semibold leading-none">9AM</span>
              <span className="mt-1 block text-[10px] leading-none opacity-70">01 · primary app</span>
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={notificationApp === 'trigger'}
            onClick={() => setNotificationApp('trigger')}
            className={cn(
              'relative flex h-11 min-w-36 items-center gap-2.5 border-b-2 px-3 text-left transition-colors',
              notificationApp === 'trigger'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-md border',
                notificationApp === 'trigger'
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              <Zap className="size-3.5" />
            </span>
            <span>
              <span className="block text-sm font-semibold leading-none">Trigger</span>
              <span className="mt-1 block text-[10px] leading-none opacity-70">
                02 · momentum app
              </span>
            </span>
          </button>
        </div>
      </header>

      {/* Workspace: left section tabs | main | logs */}
      <div className="flex min-h-0 flex-1">
        {/* LEFT vertical section tabs */}
        <nav
          className="flex w-[9.5rem] shrink-0 flex-col gap-1 border-r bg-muted/20 p-2 sm:w-44 sm:p-3"
          aria-label="Notification sections"
        >
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {notificationApp === 'nineam' ? 'Sections' : 'Trigger flow'}
          </p>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'tickers'}
            onClick={() => setSection('tickers')}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors',
              section === 'tickers'
                ? 'border-foreground bg-foreground text-background'
                : 'border-transparent bg-transparent text-foreground hover:bg-muted',
            )}
          >
            <TrendingUp className="size-4 shrink-0" />
            <span className="leading-tight">
              {notificationApp === 'trigger' ? 'Stock momentum' : 'Tickers'}
              <span className="block text-[11px] font-normal opacity-80">
                {notificationApp === 'trigger' ? 'notable move' : 'alert'}
              </span>
            </span>
          </button>
          {notificationApp === 'nineam' ? <button
            type="button"
            role="tab"
            aria-selected={section === 'news'}
            onClick={() => setSection('news')}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors',
              section === 'news'
                ? 'border-foreground bg-foreground text-background'
                : 'border-transparent bg-transparent text-foreground hover:bg-muted',
            )}
          >
            <Newspaper className="size-4 shrink-0" />
            <span className="leading-tight">
              News
              <span className="block text-[11px] font-normal opacity-80">alert</span>
            </span>
          </button> : null}
          {notificationApp === 'nineam' ? <button
            type="button"
            role="tab"
            aria-selected={section === 'custom'}
            onClick={() => setSection('custom')}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors',
              section === 'custom'
                ? 'border-foreground bg-foreground text-background'
                : 'border-transparent bg-transparent text-foreground hover:bg-muted',
            )}
          >
            <PenLine className="size-4 shrink-0" />
            <span className="leading-tight">
              Custom
              <span className="block text-[11px] font-normal opacity-80">alert</span>
            </span>
          </button> : null}
          <button
            type="button"
            role="tab"
            aria-selected={section === 'users'}
            onClick={() => setSection('users')}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors',
              section === 'users'
                ? 'border-foreground bg-foreground text-background'
                : 'border-transparent bg-transparent text-foreground hover:bg-muted',
            )}
          >
            <Users className="size-4 shrink-0" />
            <span className="leading-tight">
              All users
              <span className="block text-[11px] font-normal opacity-80">alertable devices</span>
            </span>
          </button>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        {/* MAIN — tickers / news / custom */}
        <main className="flex min-h-0 min-w-0 flex-[7] flex-col overflow-hidden border-b lg:border-b-0 lg:border-r">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
            {section === 'users' ? (
              <>
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                      All alertable users
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Devices registered for{' '}
                      <strong>{notificationApp === 'trigger' ? 'Trigger' : '9AM'}</strong>.
                      Only these users can be selected from this app&apos;s alert popups.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {notificationApp === 'trigger' ? (
                      <Button
                        size="sm"
                        type="button"
                        disabled={!devices.length || devicesLoading}
                        onClick={() => openTriggerDigest()}
                      >
                        <BellRing className="size-3.5" />
                        Alert all Trigger users
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      disabled={devicesLoading}
                      onClick={() => void loadDevices()}
                    >
                      {devicesLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Reload users
                    </Button>
                  </div>
                </div>

                {devicesError ? (
                  <div className="mb-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Users failed to load: {devicesError}
                  </div>
                ) : null}
                {digestMessage ? (
                  <div
                    className={cn(
                      'mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
                      digestIsError
                        ? 'border-destructive/35 bg-destructive/10 text-destructive'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
                    )}
                  >
                    <BellRing className="mt-0.5 size-4 shrink-0" />
                    <span>{digestMessage}</span>
                  </div>
                ) : null}

                <div className="mb-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border bg-card p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Alertable users
                    </p>
                    <p className="mt-1 text-2xl font-semibold">{devices.length}</p>
                  </div>
                  <div className="rounded-xl border bg-card p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      App
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {notificationApp === 'trigger' ? 'Trigger' : '9AM'}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-card p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Monitored tickers
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {
                        new Set(
                          devices.flatMap((device) =>
                            (device.tickers || []).map((ticker) => ticker.toUpperCase()),
                          ),
                        ).size
                      }
                    </p>
                  </div>
                </div>

                {devicesLoading && !devices.length ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-12 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading alertable users…
                  </div>
                ) : null}

                {!devicesLoading && !devices.length ? (
                  <div className="rounded-xl border border-dashed px-4 py-12 text-center">
                    <Users className="mx-auto size-6 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">No alertable users</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No enabled {notificationApp === 'trigger' ? 'Trigger' : '9AM'} push tokens
                      were found.
                    </p>
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {devices.map((device) => {
                    const token = device.expo_push_token
                    const maskedToken =
                      token.length > 30 ? `${token.slice(0, 20)}…${token.slice(-8)}` : token
                    return (
                      <article
                        key={deviceKey(device)}
                        className="rounded-2xl border bg-card p-4 text-card-foreground shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-sm font-semibold">
                              {device.device_id || 'Unknown device'}
                            </p>
                            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                              {maskedToken}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <Badge className="bg-emerald-500/12 text-emerald-800 dark:text-emerald-200">
                              Notifications on
                            </Badge>
                            {notificationApp === 'trigger' ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openTriggerDigest(device)}
                              >
                                <BellRing className="size-3.5" />
                                Alert user
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-4">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Subscribed tickers ({device.tickers?.length || 0})
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {(device.tickers || []).map((ticker) => (
                              <Badge key={ticker} variant="secondary" className="font-mono text-[10px]">
                                {ticker}
                              </Badge>
                            ))}
                            {!device.tickers?.length ? (
                              <span className="text-xs text-muted-foreground">No tickers</span>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </>
            ) : section === 'custom' ? (
              <>
                <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                      Custom alert
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Write title + body, pick devices (select all or manual), then Send.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    disabled={devicesLoading}
                    onClick={() => void loadDevices()}
                  >
                    {devicesLoading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    Reload devices
                  </Button>
                </div>

                {customMessage ? (
                  <div
                    className={cn(
                      'mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
                      customIsError
                        ? 'border-destructive/35 bg-destructive/10 text-destructive'
                        : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100',
                    )}
                  >
                    {customIsError ? (
                      <Bell className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <Check className="mt-0.5 size-4 shrink-0" />
                    )}
                    <span>{customMessage}</span>
                  </div>
                ) : null}

                {devicesError ? (
                  <div className="mb-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Devices failed to load: {devicesError}. Click Reload devices (API must be
                    running).
                  </div>
                ) : null}

                <div className="grid gap-4 xl:grid-cols-[1fr_1fr_16rem]">
                  {/* Editor */}
                  <section className="space-y-4 rounded-2xl border bg-card p-4 text-card-foreground shadow-sm sm:p-5">
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold tracking-tight">Compose</h2>
                      <p className="text-xs text-muted-foreground">
                        Line 1 = title · Line 2 = body
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="custom-title">Title (first line)</Label>
                      <Input
                        id="custom-title"
                        value={customTitle}
                        onChange={(e) => setCustomTitle(e.target.value)}
                        placeholder="e.g. AAPL +1.2% · Notable move"
                        maxLength={120}
                        className="font-medium"
                      />
                      <p className="text-[11px] text-muted-foreground">{customTitle.length}/120</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="custom-body">Body (second line)</Label>
                      <Textarea
                        id="custom-body"
                        value={customBody}
                        onChange={(e) => setCustomBody(e.target.value)}
                        placeholder="Full reason / message…"
                        rows={6}
                        maxLength={400}
                        className="min-h-[8rem] resize-y"
                      />
                      <p className="text-[11px] text-muted-foreground">{customBody.length}/400</p>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        disabled={
                          customSending ||
                          customSelectedDeviceKeys.length === 0 ||
                          !customTitle.trim() ||
                          !customBody.trim()
                        }
                        onClick={() => void handleCustomSend()}
                      >
                        {customSending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <BellRing className="size-4" />
                        )}
                        Send ({customSelectedDeviceKeys.length})
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={customSending || (!customTitle && !customBody)}
                        onClick={() => {
                          setCustomTitle('')
                          setCustomBody('')
                          setCustomMessage('')
                          setCustomIsError(false)
                          appendCustomLog('info', 'Composer cleared')
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </section>

                  {/* Live phone preview */}
                  <section className="space-y-3">
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold tracking-tight">Live preview</h2>
                      <p className="text-xs text-muted-foreground">Lock-screen style</p>
                    </div>
                    <div className="mx-auto w-full max-w-[320px]">
                      <div className="rounded-[2rem] border-[6px] border-neutral-800 bg-gradient-to-b from-neutral-900 to-neutral-950 p-3 shadow-2xl">
                        <div className="mb-8 flex items-center justify-between px-3 pt-1 text-[10px] font-medium text-white/80">
                          <span>9:41</span>
                          <span className="opacity-70">LTE</span>
                        </div>
                        <div className="rounded-2xl bg-white/95 p-3 text-neutral-900 shadow-lg dark:bg-neutral-800/95 dark:text-neutral-50">
                          <div className="mb-2 flex items-center gap-2">
                            <div className="flex size-6 items-center justify-center rounded-md bg-neutral-900 text-[10px] font-bold text-white dark:bg-white dark:text-neutral-900">
                              9
                            </div>
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                              9AM
                            </span>
                            <span className="ml-auto text-[10px] text-neutral-400">now</span>
                          </div>
                          <p
                            className={cn(
                              'text-[15px] font-semibold leading-snug',
                              previewTitleEmpty && 'italic text-neutral-400',
                            )}
                          >
                            {previewTitle}
                          </p>
                          <p
                            className={cn(
                              'mt-0.5 text-[13px] leading-snug text-neutral-600 dark:text-neutral-300',
                              previewBodyEmpty && 'italic text-neutral-400',
                            )}
                          >
                            {previewBody}
                          </p>
                        </div>
                        <p className="mt-6 pb-4 text-center text-[10px] text-white/40">
                          Preview only
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Devices column */}
                  <section className="flex max-h-[70vh] flex-col rounded-2xl border bg-card p-3 shadow-sm sm:p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold">Devices</h2>
                        <p className="text-[11px] text-muted-foreground">
                          {customSelectedDeviceKeys.length}/{devices.length} selected
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!devices.length}
                          onClick={() => selectAllDevices(setCustomSelectedDeviceKeys)}
                        >
                          Select all
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!customSelectedDeviceKeys.length}
                          onClick={() => clearDeviceSelection(setCustomSelectedDeviceKeys)}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                      {devicesLoading ? (
                        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Loading…
                        </div>
                      ) : null}
                      {!devicesLoading && !devices.length ? (
                        <p className="py-6 text-center text-xs text-muted-foreground">
                          No devices. Reload devices.
                        </p>
                      ) : null}
                      {devices.map((device) => {
                        const key = deviceKey(device)
                        const checked = customSelectedDeviceKeys.includes(key)
                        return (
                          <label
                            key={key}
                            className={cn(
                              'flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-sm transition-colors',
                              checked
                                ? 'border-foreground bg-muted/50'
                                : 'border-border hover:bg-muted/30',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-4 accent-foreground"
                              checked={checked}
                              onChange={() =>
                                toggleDeviceKey(
                                  key,
                                  customSelectedDeviceKeys,
                                  setCustomSelectedDeviceKeys,
                                )
                              }
                            />
                            <span className="min-w-0">
                              <span className="block font-medium font-mono text-xs">
                                {device.device_id || 'unknown'}
                              </span>
                              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                {device.tickers?.slice(0, 6).join(', ') || 'no tickers'}
                                {(device.tickers?.length || 0) > 6 ? '…' : ''}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </section>
                </div>
              </>
            ) : section === 'news' ? (
              <>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                      News alert
                    </h1>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Left: pick one news story · Right: pick devices · then Send
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {newsTotal != null ? `${newsTotal} articles in Supabase · ` : null}
                      {selectedDeviceKeys.length}/{devices.length} devices selected
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      disabled={devicesLoading}
                      onClick={() => void loadDevices()}
                    >
                      {devicesLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Reload devices
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      disabled={newsLoading}
                      onClick={() => void loadNews()}
                    >
                      {newsLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Reload news
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      disabled={
                        newsSending ||
                        !selectedArticleId ||
                        selectedDeviceKeys.length === 0
                      }
                      onClick={() => void handleNewsSend()}
                    >
                      {newsSending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <BellRing className="size-3.5" />
                      )}
                      Send ({selectedDeviceKeys.length})
                    </Button>
                  </div>
                </div>

                {newsAlertMessage ? (
                  <div
                    className={cn(
                      'mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
                      newsAlertIsError
                        ? 'border-destructive/35 bg-destructive/10 text-destructive'
                        : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100',
                    )}
                  >
                    <BellRing className="mt-0.5 size-4 shrink-0" />
                    <span>{newsAlertMessage}</span>
                  </div>
                ) : null}

                {newsError ? (
                  <div className="mb-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    News failed to load: {newsError}
                  </div>
                ) : null}
                {devicesError ? (
                  <div className="mb-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Devices failed to load: {devicesError}
                  </div>
                ) : null}

                <div className="grid min-h-0 gap-4 lg:grid-cols-[1fr_18rem]">
                  {/* NEWS column */}
                  <section className="flex min-h-0 flex-col rounded-2xl border bg-card shadow-sm">
                    <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
                      <h2 className="text-sm font-semibold">News</h2>
                      <span className="text-xs text-muted-foreground">
                        {news.length}
                        {newsTotal != null ? ` / ${newsTotal}` : ''} loaded
                      </span>
                    </div>
                    <div className="min-h-0 max-h-[calc(100svh-16rem)] flex-1 space-y-2 overflow-y-auto p-3">
                      {newsLoading && !news.length ? (
                        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Loading news from Supabase…
                        </div>
                      ) : null}
                      {!newsLoading && !news.length && !newsError ? (
                        <div className="rounded-xl border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
                          No articles. Click Reload news.
                        </div>
                      ) : null}
                      {news.map((article) => {
                        const selected = selectedArticleId === article.id
                        const impact =
                          article.impact_body ||
                          (article.ticker_sides || [])
                            .map((s) => {
                              const arrow =
                                s.arrow ??
                                (s.side === 'bullish'
                                  ? '↑'
                                  : s.side === 'bearish'
                                    ? '↓'
                                    : '')
                              return arrow ? `${s.ticker} ${arrow}` : s.ticker
                            })
                            .join(' · ')
                        return (
                          <button
                            key={article.id}
                            type="button"
                            onClick={() => setSelectedArticleId(article.id)}
                            className={cn(
                              'flex w-full gap-3 rounded-xl border p-3 text-left transition-colors',
                              selected
                                ? 'border-foreground bg-muted/60 ring-1 ring-foreground/20'
                                : 'border-border bg-background/40 hover:bg-muted/40',
                            )}
                          >
                            {article.image_url ? (
                              <img
                                src={article.image_url}
                                alt=""
                                className="size-14 shrink-0 rounded-lg object-cover bg-muted"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
                                no img
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                {article.source_name ? (
                                  <Badge variant="secondary" className="text-[10px]">
                                    {article.source_name}
                                  </Badge>
                                ) : null}
                                {article.published_at ? (
                                  <span>
                                    {new Date(article.published_at).toLocaleString()}
                                  </span>
                                ) : null}
                              </div>
                              {impact ? (
                                <p className="mt-1 font-mono text-[11px] font-semibold leading-snug">
                                  {impact}
                                </p>
                              ) : null}
                              <p className="mt-1 text-sm leading-snug text-muted-foreground">
                                {article.title}
                              </p>
                            </div>
                          </button>
                        )
                      })}
                      {newsHasMore ? (
                        <div className="flex justify-center py-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={newsLoadingMore}
                            onClick={() => void loadNews({ append: true })}
                          >
                            {newsLoadingMore ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : null}
                            Load more
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {/* DEVICES column */}
                  <section className="flex max-h-[calc(100svh-16rem)] flex-col rounded-2xl border bg-card shadow-sm">
                    <div className="shrink-0 space-y-2 border-b px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold">Devices</h2>
                        <span className="text-[11px] text-muted-foreground">
                          {selectedDeviceKeys.length}/{devices.length}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          disabled={!devices.length}
                          onClick={() => selectAllDevices(setSelectedDeviceKeys)}
                        >
                          Select all
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs"
                          disabled={!selectedDeviceKeys.length}
                          onClick={() => clearDeviceSelection(setSelectedDeviceKeys)}
                        >
                          Clear
                        </Button>
                      </div>
                      <Button
                        type="button"
                        className="w-full"
                        disabled={
                          newsSending ||
                          !selectedArticleId ||
                          selectedDeviceKeys.length === 0
                        }
                        onClick={() => void handleNewsSend()}
                      >
                        {newsSending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <BellRing className="size-4" />
                        )}
                        Send to {selectedDeviceKeys.length || 0}
                      </Button>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                      {devicesLoading ? (
                        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Loading devices…
                        </div>
                      ) : null}
                      {!devicesLoading && !devices.length ? (
                        <p className="py-8 text-center text-xs text-muted-foreground">
                          No devices with notifications on.
                        </p>
                      ) : null}
                      {devices.map((device) => {
                        const key = deviceKey(device)
                        const checked = selectedDeviceKeys.includes(key)
                        return (
                          <label
                            key={key}
                            className={cn(
                              'flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-sm transition-colors',
                              checked
                                ? 'border-foreground bg-muted/50'
                                : 'border-border hover:bg-muted/30',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-4 accent-foreground"
                              checked={checked}
                              onChange={() =>
                                toggleDeviceKey(key, selectedDeviceKeys, setSelectedDeviceKeys)
                              }
                            />
                            <span className="min-w-0">
                              <span className="block font-mono text-xs font-medium">
                                {device.device_id || 'unknown'}
                              </span>
                              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                {device.tickers?.length
                                  ? device.tickers.slice(0, 8).join(', ')
                                  : 'no tickers'}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </section>
                </div>
              </>
            ) : (
              <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {notificationApp === 'trigger' ? 'Notable stock momentum' : 'Tickers alert'}
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  {notificationApp === 'trigger' ? (
                    <>
                      Select a stock, refresh its notable movement, then send the latest momentum
                      alert to subscribed <strong>Trigger</strong> devices.
                    </>
                  ) : (
                    <>
                      Stored movements load directly from Supabase. Refresh finds{' '}
                      <strong>new or changed data</strong> without saving it (
                      <code className="text-xs">dates[YYYY-MM-DD]</code>)
                    </>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={listLoading}
                onClick={() => void loadTickers()}
              >
                {listLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Reload tickers
              </Button>
            </div>

            {listError ? (
              <div className="mb-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {listError}
              </div>
            ) : null}

            {/* Horizontal ticker tab bar */}
            <section className="mb-5 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Monitored tickers
              </div>
              <div className="overflow-x-auto pb-1">
                <div
                  className="flex min-w-full items-center gap-2"
                  role="tablist"
                  aria-label="Monitored stocks"
                >
                  {listLoading && !tickers.length ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Loading from Supabase…
                    </div>
                  ) : null}
                  {!listLoading && !tickers.length ? (
                    <div className="py-2 text-sm text-muted-foreground">
                      No rows in <code>device_monitored_tickers</code>.
                    </div>
                  ) : null}
                  {tickers.map((item) => {
                    const selected = item.ticker === activeTicker
                    const busy = Boolean(tabState[item.ticker]?.loading)
                    return (
                      <button
                        key={item.ticker}
                        role="tab"
                        aria-selected={selected}
                        type="button"
                        onClick={() => setActiveTicker(item.ticker)}
                        className={cn(
                          'inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                          selected
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-border bg-card text-foreground hover:bg-muted',
                        )}
                      >
                        <span>{item.ticker}</span>
                        {item.company_name && item.company_name !== item.ticker ? (
                          <span
                            className={cn(
                              'hidden max-w-[8rem] truncate text-xs font-normal sm:inline',
                              selected ? 'text-background/80' : 'text-muted-foreground',
                            )}
                          >
                            {item.company_name}
                          </span>
                        ) : null}
                        {busy ? <Loader2 className="size-3.5 animate-spin opacity-80" /> : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>

            {activeTicker ? (
              <section className="space-y-5 rounded-2xl border bg-card p-4 text-card-foreground shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold tracking-tight">{activeTicker}</h2>
                      {activeMeta?.company_name && activeMeta.company_name !== activeTicker ? (
                        <Badge variant="secondary">{activeMeta.company_name}</Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Source:{' '}
                      <a
                        className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                        href={`https://www.perplexity.ai/finance/${encodeURIComponent(activeTicker)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        perplexity.ai/finance/{activeTicker}
                        <ExternalLink className="size-3" />
                      </a>
                    </p>
                    {activeMeta?.saved_event_count ? (
                      <p className="text-xs text-muted-foreground">
                        Saved in DB: {activeMeta.saved_event_count} date
                        {activeMeta.saved_event_count === 1 ? '' : 's'}
                        {activeMeta.last_saved_at
                          ? ` · last save ${new Date(activeMeta.last_saved_at).toLocaleString()}`
                          : ''}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {notificationApp === 'trigger' ? 'Trigger devices subscribed' : 'Devices subscribed'}:{' '}
                      <span className="font-medium text-foreground">
                        {activeMeta?.subscriber_count ?? 0}
                      </span>
                      {activeMeta?.device_ids?.length ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {activeMeta.device_ids.join(', ')}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={activeState.loading}
                      onClick={() => void handleRefresh(activeTicker)}
                    >
                      {activeState.loading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Refresh
                    </Button>
                    <Button
                      type="button"
                      disabled={
                        activeState.saving ||
                        activeState.loading ||
                        !events.length ||
                        pendingSaveCount === 0
                      }
                      onClick={() => void handleSave(activeTicker)}
                    >
                      {activeState.saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      {pendingSaveCount > 0
                        ? `Save ${pendingSaveCount} pending`
                        : 'Save'}
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      disabled={
                        activeState.alerting ||
                        activeState.loading ||
                        (activeMeta?.subscriber_count ?? 0) === 0
                      }
                      onClick={() => void openMovementAlert(activeTicker)}
                      title="Send Expo push to all enabled devices subscribed to this ticker"
                    >
                      {activeState.alerting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <BellRing className="size-4" />
                      )}
                      Alert users
                      {(activeMeta?.subscriber_count ?? 0) > 0
                        ? ` (${activeMeta?.subscriber_count})`
                        : ''}
                    </Button>
                  </div>
                </div>

                {activeState.error ? (
                  <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {activeState.error}
                  </div>
                ) : null}
                {activeState.saveMessage ? (
                  <div
                    className={cn(
                      'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                      activeState.saveIsNoop
                        ? 'border-border bg-muted/40 text-muted-foreground'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
                    )}
                  >
                    <Check className="mt-0.5 size-4 shrink-0" />
                    <span>{activeState.saveMessage}</span>
                  </div>
                ) : null}
                {activeState.alertMessage ? (
                  <div
                    className={cn(
                      'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
                      activeState.alertIsError
                        ? 'border-destructive/35 bg-destructive/10 text-destructive'
                        : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100',
                    )}
                  >
                    <BellRing className="mt-0.5 size-4 shrink-0" />
                    <span>{activeState.alertMessage}</span>
                  </div>
                ) : null}

                {activeState.result ? (
                  <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Credits used</div>
                      <div className="font-medium">
                        {activeState.result.credits.used != null
                          ? activeState.result.credits.used
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Balance after</div>
                      <div className="font-medium">
                        {activeState.result.credits.after?.remaining_credits != null
                          ? `${activeState.result.credits.after.remaining_credits}${
                              activeState.result.credits.after.plan_credits != null
                                ? ` / ${activeState.result.credits.after.plan_credits}`
                                : ''
                            }`
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Scraped (30d)</div>
                      <div className="font-medium">{events.length}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">New dates</div>
                      <div className="font-medium text-emerald-700 dark:text-emerald-300">
                        {compare?.new ?? events.filter((e) => e.save_status === 'new').length}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase text-muted-foreground">Already in DB</div>
                      <div className="font-medium text-muted-foreground">
                        {compare?.already_saved ??
                          events.filter((e) => e.save_status === 'saved').length}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                    Click <strong>Refresh</strong> to scrape Notable Price Movement for{' '}
                    {activeTicker}.
                  </div>
                )}

                {pendingEvents.length > 0 ? (
                  <section className="space-y-3 rounded-2xl border border-amber-500/35 bg-amber-500/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-900 dark:text-amber-200">
                          New data · not yet saved
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Refreshed from Perplexity. Review these cards, then click Save.
                        </p>
                      </div>
                      <Badge className="bg-amber-500/15 text-amber-900 dark:text-amber-200">
                        {pendingEvents.length} pending
                      </Badge>
                    </div>
                    <div className="space-y-3">
                      {pendingEvents.map((event) => {
                        const change = formatChange(event.price_change || event.momentum)
                        const sources = event.sources || []
                        return (
                          <article
                            key={`pending-${event.event_date}-${event.time_label || ''}`}
                            className="rounded-xl border border-amber-500/35 bg-background p-4 shadow-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold">{formatEventHeading(event)}</p>
                                  <Badge
                                    className={cn(
                                      event.save_status === 'changed'
                                        ? 'bg-amber-500/15 text-amber-900 dark:text-amber-200'
                                        : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
                                    )}
                                  >
                                    {event.save_status === 'changed'
                                      ? 'Changed · not yet saved'
                                      : 'New · not yet saved'}
                                  </Badge>
                                </div>
                                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                                  dates[{event.event_date}]
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={activeState.alerting}
                                  onClick={() => void openMovementAlert(activeTicker, event)}
                                >
                                  <BellRing className="size-3.5" />
                                  Alert
                                </Button>
                                {event.price ? (
                                  <Badge variant="outline" className="font-mono">
                                    {event.price}
                                  </Badge>
                                ) : null}
                                {change ? (
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      'font-mono',
                                      change.negative &&
                                        'bg-red-500/10 text-red-700 dark:text-red-300',
                                      change.positive &&
                                        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                                    )}
                                  >
                                    {change.text}
                                  </Badge>
                                ) : null}
                              </div>
                            </div>
                            {event.summary ? (
                              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                {event.summary}
                              </p>
                            ) : null}
                            {sources.length ? (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {sources.map((source, index) =>
                                  source.url ? (
                                    <a
                                      key={sourceKey(source, index)}
                                      href={source.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-full border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                                    >
                                      {sourceLabel(source)}
                                    </a>
                                  ) : (
                                    <span
                                      key={sourceKey(source, index)}
                                      className="rounded-full border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground"
                                    >
                                      {sourceLabel(source)}
                                    </span>
                                  ),
                                )}
                              </div>
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ) : null}

                {activeState.result &&
                !activeState.loading &&
                !pendingEvents.length &&
                events.length === 0 ? (
                  <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    {activeState.result.section_found
                      ? 'Refresh found no notable movements in the past 30 days.'
                      : 'Could not find the Notable Price Movement section on the page.'}
                  </div>
                ) : null}

                {/* Supabase timeline — always visible without requiring Refresh */}
                {storedEvents.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                      <div>
                        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
                          Supabase stored data
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Saved notable movements · available immediately
                        </p>
                      </div>
                      <Badge variant="secondary">{storedEvents.length} stored</Badge>
                    </div>
                    <ol className="relative ml-2 space-y-0 border-l border-border pl-6">
                      {storedEvents.map((event) => {
                        const change = formatChange(event.price_change || event.momentum)
                        const sources = event.sources || []
                        const status = event.save_status
                        return (
                          <li
                            key={event.event_date + (event.time_label || '')}
                            className="relative pb-8 last:pb-0"
                          >
                            <span
                              className={cn(
                                'absolute -left-[1.55rem] top-1.5 size-3 rounded-full border-2 border-background ring-1 ring-border',
                                change?.negative
                                  ? 'bg-red-500'
                                  : change?.positive
                                    ? 'bg-emerald-500'
                                    : 'bg-muted-foreground',
                              )}
                            />
                            <div
                              className={cn(
                                'rounded-xl border bg-background/60 p-4 shadow-sm',
                                status === 'new' &&
                                  'border-emerald-500/40 ring-1 ring-emerald-500/20',
                                status === 'changed' &&
                                  'border-amber-500/40 ring-1 ring-amber-500/20',
                              )}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-semibold">
                                      {formatEventHeading(event)}
                                    </div>
                                    {status === 'new' ? (
                                      <Badge className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-200">
                                        New
                                      </Badge>
                                    ) : null}
                                    {status === 'changed' ? (
                                      <Badge className="bg-amber-500/15 text-amber-900 dark:text-amber-200">
                                        Updated content
                                      </Badge>
                                    ) : null}
                                    {status === 'saved' ? (
                                      <Badge variant="secondary" className="text-muted-foreground">
                                        Already saved
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                                    dates[{event.event_date}]
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={activeState.alerting}
                                    onClick={() => void openMovementAlert(activeTicker, event)}
                                    title={`Send only the ${event.event_date} movement`}
                                  >
                                    <BellRing className="size-3.5" />
                                    Alert
                                  </Button>
                                  {event.price ? (
                                    <Badge variant="outline" className="font-mono">
                                      {event.price}
                                    </Badge>
                                  ) : null}
                                  {change ? (
                                    <Badge
                                      variant="secondary"
                                      className={cn(
                                        'font-mono',
                                        change.negative &&
                                          'bg-red-500/10 text-red-700 dark:text-red-300',
                                        change.positive &&
                                          'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                                      )}
                                    >
                                      {change.text}
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>

                              {event.summary ? (
                                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                  {event.summary}
                                </p>
                              ) : null}

                              {/* Exact sources from backend — every item, no "+N more" truncation */}
                              {sources.length > 0 ? (
                                <div className="mt-3 space-y-1.5">
                                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Sources ({sources.length}
                                    {event.claimed_source_count != null &&
                                    event.claimed_source_count !== sources.length
                                      ? ` · page listed ${event.claimed_source_count}`
                                      : ''}
                                    )
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {sources.map((source, index) => {
                                      const label = sourceLabel(source)
                                      const href = source.url || undefined
                                      const className =
                                        'inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground'
                                      if (href) {
                                        return (
                                          <a
                                            key={sourceKey(source, index)}
                                            href={href}
                                            target="_blank"
                                            rel="noreferrer"
                                            title={href}
                                            className={className}
                                          >
                                            <span className="truncate">{label}</span>
                                            {source.domain && source.title ? (
                                              <span className="truncate text-[10px] opacity-70">
                                                · {source.domain}
                                              </span>
                                            ) : null}
                                          </a>
                                        )
                                      }
                                      return (
                                        <span key={sourceKey(source, index)} className={className}>
                                          {label}
                                        </span>
                                      )
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Supabase stored data</p>
                    <p className="mt-1">No saved notable movements for {activeTicker} yet.</p>
                  </div>
                )}

                <p className="text-center text-[11px] text-muted-foreground">
                  Structure: <code>notable_price_movements.dates[&quot;YYYY-MM-DD&quot;]</code> per
                  ticker. Refresh is read-only. New or changed movements remain{' '}
                  <strong>not yet saved</strong> until you click Save.
                </p>
              </section>
            ) : null}
              </>
            )}
          </div>
        </main>

        {/* RIGHT 30% — logs rail */}
        <aside className="flex min-h-[40vh] min-w-0 flex-[3] flex-col overflow-hidden bg-neutral-950 text-neutral-100 lg:min-h-0">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Terminal className="size-4 text-neutral-400" />
              Logs
              {section === 'news' ? (
                <span className="text-xs font-normal text-neutral-500">news</span>
              ) : section === 'custom' ? (
                <span className="text-xs font-normal text-neutral-500">custom</span>
              ) : section === 'users' ? (
                <span className="text-xs font-normal text-neutral-500">
                  {notificationApp === 'trigger' ? 'trigger users' : '9am users'}
                </span>
              ) : activeTicker ? (
                <span className="font-mono text-xs font-normal text-neutral-500">{activeTicker}</span>
              ) : null}
            </div>
            <span className="text-[11px] text-neutral-500">{logs.length} entries</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 font-mono text-[11px] leading-relaxed sm:text-xs">
            {section === 'tickers' && activeState.loading ? (
              <div className="mb-3 flex items-center gap-2 text-sky-300">
                <Loader2 className="size-3.5 animate-spin" />
                Scraping… credits + parse details will stream here when the request finishes.
              </div>
            ) : null}
            {logs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-8 text-center text-neutral-500">
                {section === 'news'
                  ? 'Logs appear here after Reload news / Alert.'
                  : section === 'custom'
                    ? 'Logs appear here after Send custom alert.'
                    : section === 'users'
                      ? 'This view lists every currently alertable device.'
                    : 'Logs appear here after Refresh / Save / Alert.'}
                <div className="mt-2 text-[11px]">
                  {section === 'news'
                    ? 'Includes device counts and Expo push tickets for news alerts.'
                    : section === 'custom'
                      ? 'Includes title/body payload and Expo push tickets.'
                      : section === 'users'
                        ? 'Switch the app tab to see its separate push-token audience.'
                      : 'Includes Firecrawl credit usage, balance remaining, and exact sources per event.'}
                </div>
              </div>
            ) : (
              logs.map((log, index) => (
                <div
                  key={`${log.at}-${index}`}
                  className="border-b border-white/5 py-2 last:border-0"
                >
                  <div>
                    <span className="text-neutral-500">[{formatLogTime(log.at)}]</span>{' '}
                    <span
                      className={cn(
                        'uppercase',
                        log.level === 'error' && 'text-red-400',
                        log.level === 'warn' && 'text-amber-300',
                        log.level === 'success' && 'text-emerald-400',
                        log.level === 'info' && 'text-sky-300',
                      )}
                    >
                      {log.level}
                    </span>{' '}
                    <span className="text-neutral-100">{log.message}</span>
                  </div>
                  {log.detail != null ? (
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] text-neutral-400 sm:text-[11px]">
                      {typeof log.detail === 'string'
                        ? log.detail
                        : JSON.stringify(log.detail, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </aside>
        </div>
      </div>

      <Dialog
        open={movementAlertOpen}
        onOpenChange={(open) => {
          setMovementAlertOpen(open)
          if (!open) {
            setMovementAlertTarget(null)
            setMovementAlertDeviceKeys([])
            setMovementPreviewTitle('')
            setMovementPreviewBody('')
            setMovementPreviewError('')
          }
        }}
      >
        <DialogContent className="max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Send {movementAlertTarget?.ticker || ''} alert
            </DialogTitle>
            <DialogDescription>
              {notificationApp === 'trigger' ? 'Trigger' : '9AM'} app ·{' '}
              {movementAlertTarget?.event
                ? `${formatEventHeading(movementAlertTarget.event)} movement only`
                : 'latest saved movement'}
            </DialogDescription>
          </DialogHeader>

          <section className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_0.9fr]">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Editable notification</p>
                  <p className="text-[11px] text-muted-foreground">
                    Changes apply only to this send.
                  </p>
                </div>
                {movementPreviewLoading ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : null}
              </div>
              {movementPreviewError ? (
                <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {movementPreviewError}
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="movement-alert-title">Title</Label>
                <Input
                  id="movement-alert-title"
                  value={movementPreviewTitle}
                  disabled={movementPreviewLoading}
                  maxLength={120}
                  placeholder="Notification title"
                  onChange={(event) => setMovementPreviewTitle(event.target.value)}
                />
                <p className="text-right text-[10px] text-muted-foreground">
                  {movementPreviewTitle.length}/120
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="movement-alert-body">Body</Label>
                <Textarea
                  id="movement-alert-body"
                  value={movementPreviewBody}
                  disabled={movementPreviewLoading}
                  maxLength={400}
                  rows={4}
                  className="min-h-24 resize-y"
                  placeholder="Notification body"
                  onChange={(event) => setMovementPreviewBody(event.target.value)}
                />
                <p className="text-right text-[10px] text-muted-foreground">
                  {movementPreviewBody.length}/400
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-neutral-950 p-3 text-white">
              <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">
                Live preview
              </p>
              <div className="rounded-2xl bg-white/95 p-3 text-neutral-900 shadow-xl">
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex size-6 items-center justify-center rounded-md bg-neutral-900 text-[10px] font-bold text-white">
                    {notificationApp === 'trigger' ? <Zap className="size-3" /> : '9'}
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {notificationApp === 'trigger' ? 'Trigger' : '9AM'}
                  </span>
                  <span className="ml-auto text-[10px] text-neutral-400">now</span>
                </div>
                <p className="break-words text-[14px] font-semibold leading-snug">
                  {movementPreviewTitle || 'Notification title'}
                </p>
                <p className="mt-1 break-words text-[12px] leading-snug text-neutral-600">
                  {movementPreviewBody || 'Notification body'}
                </p>
              </div>
              <p className="mt-3 text-center text-[10px] text-white/40">
                Text-only push · opens {notificationApp === 'trigger' ? 'Trigger' : '9AM'}
              </p>
            </div>
          </section>

          <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Recipients</p>
              <p className="text-xs text-muted-foreground">
                {movementAlertSelectedCount} of {movementAlertDevices.length} selected
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!movementAlertDevices.length}
                onClick={() =>
                  setMovementAlertDeviceKeys(movementAlertDevices.map(deviceKey))
                }
              >
                Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!movementAlertSelectedCount}
                onClick={() => setMovementAlertDeviceKeys([])}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="min-h-0 max-h-[30svh] space-y-2 overflow-y-auto pr-1">
            {!movementAlertDevices.length ? (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center">
                <p className="text-sm font-medium">No subscribed devices</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No {notificationApp === 'trigger' ? 'Trigger' : '9AM'} users are subscribed to{' '}
                  {movementAlertTarget?.ticker}.
                </p>
              </div>
            ) : null}
            {movementAlertDevices.map((device) => {
              const key = deviceKey(device)
              const checked = movementAlertDeviceKeys.includes(key)
              const token = device.expo_push_token
              const maskedToken =
                token.length > 30 ? `${token.slice(0, 20)}…${token.slice(-8)}` : token
              return (
                <label
                  key={key}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                    checked
                      ? 'border-foreground bg-muted/50'
                      : 'border-border hover:bg-muted/30',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-foreground"
                    checked={checked}
                    onChange={() =>
                      toggleDeviceKey(
                        key,
                        movementAlertDeviceKeys,
                        setMovementAlertDeviceKeys,
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {device.device_id || 'Unknown device'}
                      </span>
                      <Badge variant="secondary" className="text-[10px]">
                        {notificationApp === 'trigger' ? 'Trigger' : '9AM'}
                      </Badge>
                    </span>
                    <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                      {maskedToken}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      Tickers: {device.tickers?.join(', ') || 'none'}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={activeState.alerting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={
                !movementAlertSelectedCount ||
                activeState.alerting ||
                movementPreviewLoading ||
                !movementPreviewTitle.trim() ||
                !movementPreviewBody.trim()
              }
              onClick={() => void handleAlertUsers()}
            >
              {activeState.alerting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BellRing className="size-4" />
              )}
              Send to {movementAlertSelectedCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={digestOpen}
        onOpenChange={(open) => {
          setDigestOpen(open)
          if (!open) {
            setDigestScopeDeviceKeys([])
            setDigestSelectedDeviceKeys([])
          }
        }}
      >
        <DialogContent className="max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Trigger momentum alert</DialogTitle>
            <DialogDescription>
              Each selected user receives a personalized body containing only their subscribed
              tickers and latest saved momentum.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="digest-title">Notification header</Label>
            <Input
              id="digest-title"
              value={digestTitle}
              maxLength={120}
              disabled={digestSending}
              onChange={(event) => setDigestTitle(event.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Trigger recipients</p>
              <p className="text-xs text-muted-foreground">
                {digestSelectedCount} of {digestDevices.length} selected
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!digestDevices.length || digestSending}
                onClick={() => setDigestSelectedDeviceKeys(digestDevices.map(deviceKey))}
              >
                Select all
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!digestSelectedCount || digestSending}
                onClick={() => setDigestSelectedDeviceKeys([])}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="max-h-[50svh] space-y-2 overflow-y-auto pr-1">
            {digestDevices.map((device) => {
              const key = deviceKey(device)
              const checked = digestSelectedDeviceKeys.includes(key)
              const body = triggerDigestBody(device)
              return (
                <label
                  key={key}
                  className={cn(
                    'block cursor-pointer rounded-xl border p-3 transition-colors',
                    checked
                      ? 'border-foreground bg-muted/40'
                      : 'border-border opacity-65 hover:opacity-100',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-foreground"
                      checked={checked}
                      disabled={digestSending}
                      onChange={() =>
                        toggleDeviceKey(
                          key,
                          digestSelectedDeviceKeys,
                          setDigestSelectedDeviceKeys,
                        )
                      }
                    />
                    <span className="font-mono text-sm font-semibold">
                      {device.device_id || 'Unknown device'}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {device.tickers?.length || 0} tickers
                    </Badge>
                  </span>
                  <span className="mt-3 block rounded-xl bg-neutral-950 p-3 text-white shadow-sm">
                    <span className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/55">
                      <Zap className="size-3" />
                      Trigger · now
                    </span>
                    <span className="mt-2 block text-sm font-semibold">
                      {digestTitle || "Today's notable price momentum"}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-white/70">
                      {body}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={digestSending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={!digestSelectedCount || !digestTitle.trim() || digestSending}
              onClick={() => void handleTriggerDigestSend()}
            >
              {digestSending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BellRing className="size-4" />
              )}
              Send to {digestSelectedCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
