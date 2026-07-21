import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Bell,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  Terminal,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type MonitoredTicker = {
  ticker: string
  company_name: string
  created_at?: string | null
  updated_at?: string | null
  has_saved_movements?: boolean
  saved_event_count?: number
  last_saved_at?: string | null
}

type MovementSource = {
  title?: string | null
  domain?: string | null
  url?: string | null
}

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
}

type ScrapeLog = {
  at: string
  level: string
  message: string
  detail?: unknown
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
}

type TabScrapeState = {
  loading: boolean
  saving: boolean
  error: string
  result: ScrapeResult | null
  saveMessage: string
  saveIsNoop: boolean
  /** Accumulated logs for this tab (scrape + save) shown in the right rail. */
  logs: ScrapeLog[]
}

const emptyTabState = (): TabScrapeState => ({
  loading: false,
  saving: false,
  error: '',
  result: null,
  saveMessage: '',
  saveIsNoop: false,
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

export default function NotificationsPage() {
  const [tickers, setTickers] = useState<MonitoredTicker[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [activeTicker, setActiveTicker] = useState<string>('')
  const [tabState, setTabState] = useState<Record<string, TabScrapeState>>({})
  const [creditHint, setCreditHint] = useState<string>('')

  const activeState = activeTicker ? tabState[activeTicker] || emptyTabState() : emptyTabState()

  const loadTickers = useCallback(async () => {
    setListLoading(true)
    setListError('')
    try {
      const response = await fetch('/api/notifications/monitored-tickers')
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
  }, [])

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
  }, [loadTickers, loadCreditsHint])

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
      const response = await fetch(`/api/notifications/scrape/${encodeURIComponent(ticker)}`, {
        method: 'POST',
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `Scrape failed (${response.status})`)
      }
      const result = body as ScrapeResult
      setTabState((current) => {
        const prev = current[ticker] || emptyTabState()
        return {
          ...current,
          [ticker]: {
            ...prev,
            loading: false,
            result,
            error: '',
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

  async function handleSave(ticker: string) {
    const state = tabState[ticker] || emptyTabState()
    const events = state.result?.events || []
    if (!events.length) {
      patchTab(ticker, { error: 'Nothing to save. Click Refresh first.' })
      appendLocalLog(ticker, 'warn', 'Save blocked — no scraped events')
      return
    }
    patchTab(ticker, { saving: true, error: '', saveMessage: '', saveIsNoop: false })
    appendLocalLog(ticker, 'info', `Save clicked for ${ticker}`, { event_count: events.length })
    try {
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
          : `Saved ${body.upserted} date(s) for ${ticker}.`)
      patchTab(ticker, {
        saving: false,
        saveMessage: message,
        saveIsNoop: noop,
      })
      appendLocalLog(ticker, noop ? 'info' : 'success', message, {
        upserted: body.upserted,
        unchanged: body.unchanged,
        inserted: body.inserted,
        total_saved_events: body.total_saved_events,
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
  const logs = activeState.logs || []

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
            <p className="truncate text-sm font-semibold tracking-tight">9AM</p>
            <p className="truncate text-xs text-muted-foreground">Notification dashboard</p>
          </div>
          {creditHint ? (
            <p className="hidden text-xs text-muted-foreground md:block">{creditHint}</p>
          ) : null}
          <Bell className="size-4 shrink-0 text-muted-foreground" />
        </div>
      </header>

      {/* Full-width workspace: 70% dashboard / 30% logs */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* LEFT 70% — main notification dashboard */}
        <main className="flex min-h-0 min-w-0 flex-[7] flex-col overflow-hidden border-b lg:border-b-0 lg:border-r">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Notifications</h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Monitored stocks from Supabase · Refresh scrapes Perplexity via Firecrawl · past 30
                  days notable price movement
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
                      disabled={activeState.saving || activeState.loading || !events.length}
                      onClick={() => void handleSave(activeTicker)}
                    >
                      {activeState.saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      Save
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

                {activeState.result ? (
                  <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 text-sm sm:grid-cols-3">
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
                      <div className="text-xs uppercase text-muted-foreground">Events (30d)</div>
                      <div className="font-medium">{events.length}</div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                    Click <strong>Refresh</strong> to scrape Notable Price Movement for{' '}
                    {activeTicker}.
                  </div>
                )}

                {/* Vertical timeline */}
                {events.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Notable price movement · past 30 days
                    </h3>
                    <ol className="relative ml-2 space-y-0 border-l border-border pl-6">
                      {events.map((event) => {
                        const change = formatChange(event.price_change || event.momentum)
                        const sources = event.sources || []
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
                            <div className="rounded-xl border bg-background/60 p-4 shadow-sm">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="text-sm font-semibold">
                                    {formatEventHeading(event)}
                                  </div>
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    {event.event_date}
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
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
                ) : activeState.result && !activeState.loading ? (
                  <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    {activeState.result.section_found
                      ? 'No notable movements found in the past 30 days from this scrape.'
                      : 'Could not find the Notable Price Movement section on the page.'}
                  </div>
                ) : null}

                <p className="text-center text-[11px] text-muted-foreground">
                  Save upserts by date — re-clicking Save with the same content will not create
                  duplicates.
                </p>
              </section>
            ) : null}
          </div>
        </main>

        {/* RIGHT 30% — logs rail */}
        <aside className="flex min-h-[40vh] min-w-0 flex-[3] flex-col overflow-hidden bg-neutral-950 text-neutral-100 lg:min-h-0">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Terminal className="size-4 text-neutral-400" />
              Logs
              {activeTicker ? (
                <span className="font-mono text-xs font-normal text-neutral-500">{activeTicker}</span>
              ) : null}
            </div>
            <span className="text-[11px] text-neutral-500">{logs.length} entries</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 font-mono text-[11px] leading-relaxed sm:text-xs">
            {activeState.loading ? (
              <div className="mb-3 flex items-center gap-2 text-sky-300">
                <Loader2 className="size-3.5 animate-spin" />
                Scraping… credits + parse details will stream here when the request finishes.
              </div>
            ) : null}
            {logs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 px-3 py-8 text-center text-neutral-500">
                Logs appear here after Refresh / Save.
                <div className="mt-2 text-[11px]">
                  Includes Firecrawl credit usage, balance remaining, and exact sources per event.
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
  )
}
