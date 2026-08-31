import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { SectionCard, SectionEmpty, formatDecimal } from '@/components/yahoo/section-ui'
import {
  CHART_INTERVAL_BY_RANGE,
  fetchYahooChart,
  type YahooChartInterval,
  type YahooChartRange,
} from '@/services/yahooApi'
import { cn } from '@/lib/utils'
import {
  EXCHANGE_TZ_FALLBACK,
  resolveExchangeTimeZone,
  withExchangeTimeZone,
} from '@/lib/exchangeTimeZone'

const RANGES: { id: YahooChartRange; label: string }[] = [
  { id: '1d', label: '1D' },
  { id: '5d', label: '5D' },
  { id: '1mo', label: '1M' },
  { id: '3mo', label: '3M' },
  { id: '6mo', label: '6M' },
  { id: 'ytd', label: 'YTD' },
  { id: '1y', label: '1Y' },
  { id: '5y', label: '5Y' },
  { id: '10y', label: '10Y' },
  { id: 'max', label: 'MAX' },
]

const INTERVAL_LABELS: Record<string, string> = {
  '1m': '1 min',
  '2m': '2 min',
  '5m': '5 min',
  '15m': '15 min',
  '30m': '30 min',
  '60m': '1 hour',
  '90m': '90 min',
  '1h': '1 hour',
  '1d': '1 day',
  '5d': '5 day',
  '1wk': '1 week',
  '1mo': '1 month',
  '3mo': '3 month',
}

const INTRADAY_INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'])

type ChartPoint = {
  t: number
  date: string
  label: string
  close: number
  open?: number | null
  high?: number | null
  low?: number | null
  volume?: number | null
}

function rawNum(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'object' && value !== null && 'raw' in value) {
    const raw = (value as { raw: unknown }).raw
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  }
  return null
}

function isIntradayInterval(interval: string) {
  return INTRADAY_INTERVALS.has(interval)
}

function cacheKey(range: YahooChartRange, interval: string) {
  return `${range}:${interval}`
}

function chartMetaTimeZone(chart: unknown): string | null {
  const meta =
    (chart as { meta?: Record<string, unknown> } | null)?.meta ||
    (chart as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } } | null)
      ?.chart?.result?.[0]?.meta
  if (!meta) return null
  const named = String(meta.exchangeTimezoneName || '').trim()
  if (named) return named
  return null
}

function formatInZone(
  d: Date,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
  withZone: boolean,
): string {
  const value = d.toLocaleString('en-US', { ...opts, timeZone })
  return withZone ? withExchangeTimeZone(value, d, timeZone) : value
}

function parseQuotes(
  chart: unknown,
  interval: string,
  timeZone: string,
  withZoneLabel: boolean,
): ChartPoint[] {
  const quotes = (chart as { quotes?: Record<string, unknown>[] } | null)?.quotes
  if (!Array.isArray(quotes)) return []

  const points: ChartPoint[] = []
  const intraday = isIntradayInterval(interval)
  for (const row of quotes) {
    const close = rawNum(row.close ?? row.adjclose)
    if (close == null) continue
    const rawDate = row.date
    const d = rawDate ? new Date(String(rawDate)) : null
    if (!d || Number.isNaN(d.getTime())) continue

    points.push({
      t: d.getTime(),
      date: d.toISOString(),
      label: intraday
        ? formatInZone(
            d,
            timeZone,
            {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            },
            withZoneLabel,
          )
        : d.toLocaleDateString('en-US', {
            timeZone,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }),
      close,
      open: rawNum(row.open),
      high: rawNum(row.high),
      low: rawNum(row.low),
      volume: rawNum(row.volume),
    })
  }
  return points
}

function downsample(points: ChartPoint[], maxPoints: number): ChartPoint[] {
  if (points.length <= maxPoints) return points
  const step = Math.ceil(points.length / maxPoints)
  const sampled = points.filter((_, index) => index % step === 0)
  const last = points[points.length - 1]
  if (sampled[sampled.length - 1] !== last) sampled.push(last)
  return sampled
}

/** Axis tick label for a chart point, tuned to range + bar size. */
function formatAxisTick(
  point: ChartPoint,
  range: YahooChartRange,
  interval: string,
  timeZone: string,
  opts?: { includeYear?: boolean; withZoneLabel?: boolean },
): string {
  const d = new Date(point.t)
  const withZone = Boolean(opts?.withZoneLabel)
  if (interval === '1m' || interval === '2m' || interval === '5m' || range === '1d') {
    return formatInZone(
      d,
      timeZone,
      { hour: 'numeric', minute: '2-digit', hour12: true },
      withZone,
    )
  }
  if (isIntradayInterval(interval) || range === '5d') {
    return formatInZone(
      d,
      timeZone,
      { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true },
      withZone,
    )
  }
  if (range === '1mo' || range === '3mo') {
    return d.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric' })
  }
  if (range === '6mo' || range === 'ytd' || range === '1y') {
    return d.toLocaleDateString('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      year: opts?.includeYear ? '2-digit' : undefined,
    })
  }
  return d.toLocaleDateString('en-US', { timeZone, month: 'short', year: '2-digit' })
}

/**
 * Build evenly spaced x-axis ticks (by index) so the time scale is readable
 * across the full plot width — not just start/end.
 */
function buildTimeAxisTicks(
  points: ChartPoint[],
  range: YahooChartRange,
  interval: string,
  timeZone: string,
  maxTicks = 7,
  withZoneLabel = false,
): { index: number; label: string }[] {
  if (points.length === 0) return []
  if (points.length === 1) {
    return [{
      index: 0,
      label: formatAxisTick(points[0], range, interval, timeZone, {
        includeYear: true,
        withZoneLabel,
      }),
    }]
  }

  const count = Math.min(maxTicks, points.length)
  const ticks: { index: number; label: string }[] = []
  const seen = new Set<string>()

  for (let i = 0; i < count; i++) {
    const index = count === 1 ? 0 : Math.round((i / (count - 1)) * (points.length - 1))
    const point = points[index]
    const includeYear = i === 0 || i === count - 1 || range === '1y' || range === '6mo' || range === 'ytd'
    const label = formatAxisTick(point, range, interval, timeZone, {
      includeYear,
      withZoneLabel,
    })
    if (seen.has(label) && i !== 0 && i !== count - 1) continue
    seen.add(label)
    ticks.push({ index, label })
  }

  if (ticks[0]?.index !== 0) {
    ticks.unshift({
      index: 0,
      label: formatAxisTick(points[0], range, interval, timeZone, {
        includeYear: true,
        withZoneLabel,
      }),
    })
  }
  const lastIdx = points.length - 1
  if (ticks[ticks.length - 1]?.index !== lastIdx) {
    ticks.push({
      index: lastIdx,
      label: formatAxisTick(points[lastIdx], range, interval, timeZone, {
        includeYear: true,
        withZoneLabel,
      }),
    })
  }

  return ticks
}

function defaultIntervalFor(range: YahooChartRange): YahooChartInterval {
  return CHART_INTERVAL_BY_RANGE[range].default
}

function intervalOptionsFor(range: YahooChartRange): YahooChartInterval[] {
  return CHART_INTERVAL_BY_RANGE[range].options
}

export type YahooChartFeedStatus = {
  ticker: string
  loading: boolean
  /** True when we have a plottable series (≥2 points). */
  ok: boolean
  empty: boolean
  error: string | null
}

export function YahooInteractiveChart({
  ticker,
  initialChart,
  title = 'Price chart',
  height = 320,
  defaultRange = '1y',
  borderless = false,
  compact = false,
  timeZone,
  showTimeZone = true,
  disableCache = false,
  onFeedStatusChange,
}: {
  ticker: string
  /** Optional already-fetched chart payload used as a daily seed for longer ranges. */
  initialChart?: unknown
  title?: string
  height?: number
  defaultRange?: YahooChartRange
  /** When true, no SectionCard chrome / outer border — for Overview embeds. */
  borderless?: boolean
  /**
   * Collapsed mini chart: 1D line only (title + spark area).
   * No range/interval controls, hover chrome, or period footer.
   */
  compact?: boolean
  /**
   * IANA exchange timezone for axis / hover labels (e.g. America/New_York).
   * Falls back to chart meta, then symbol heuristics — never browser local.
   */
  timeZone?: string | null
  /** Append short zone name (EDT/BST/IST…). Default true when timeZone resolves. */
  showTimeZone?: boolean
  /** Momentum desk: never reuse in-memory chart series — always refetch. */
  disableCache?: boolean
  /** Report chart load / empty / error so the desk can show a feed disclaimer. */
  onFeedStatusChange?: (status: YahooChartFeedStatus) => void
}) {
  const [range, setRange] = useState<YahooChartRange>(defaultRange)
  const [barInterval, setBarInterval] = useState<YahooChartInterval>(() => defaultIntervalFor(defaultRange))
  const [chart, setChart] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [activeInterval, setActiveInterval] = useState<string>(() => defaultIntervalFor(defaultRange))
  const svgRef = useRef<SVGSVGElement>(null)
  const cacheRef = useRef<Record<string, unknown>>({})
  const fetchedRef = useRef<Record<string, boolean>>({})

  const seedDailyCaches = useCallback(
    (seed: unknown) => {
      if (disableCache || !seed) return
      // Bulk-fetched series is typically daily — only seed daily (or coarser) slots.
      for (const r of ['3mo', '6mo', 'ytd', '1y'] as YahooChartRange[]) {
        const key = cacheKey(r, '1d')
        if (!cacheRef.current[key]) cacheRef.current[key] = seed
      }
    },
    [disableCache],
  )

  useEffect(() => {
    seedDailyCaches(initialChart)
  }, [initialChart, seedDailyCaches])

  const loadChart = useCallback(
    async (nextRange: YahooChartRange, nextInterval: YahooChartInterval) => {
      const key = cacheKey(nextRange, nextInterval)
      const cached = disableCache ? undefined : cacheRef.current[key]
      if (cached) {
        setChart(cached)
        setActiveInterval(nextInterval)
        setError(null)
      }

      // Always fetch when cache disabled; otherwise intraday always / daily once per key.
      const mustFetch =
        disableCache ||
        isIntradayInterval(nextInterval) ||
        !fetchedRef.current[key]
      if (!mustFetch && cached) return

      setLoading(!cached)
      setError(null)
      try {
        const body = await fetchYahooChart(ticker, nextRange, nextInterval)
        if (!disableCache) {
          cacheRef.current[key] = body.chart
          fetchedRef.current[key] = true
        }
        setChart(body.chart)
        setActiveInterval(body.interval || nextInterval)
      } catch (err) {
        if (!cached) {
          setError(err instanceof Error ? err.message : 'Failed to load chart')
        }
      } finally {
        setLoading(false)
      }
    },
    [ticker, disableCache],
  )

  // Reset when ticker changes.
  useEffect(() => {
    setHoverIndex(null)
    fetchedRef.current = {}
    cacheRef.current = {}
    seedDailyCaches(initialChart)
    const nextInterval = defaultIntervalFor(range)
    setBarInterval(nextInterval)
    void loadChart(range, nextInterval)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-bootstrap only on ticker change
  }, [ticker, disableCache])

  // Range or interval change.
  useEffect(() => {
    setHoverIndex(null)
    void loadChart(range, barInterval)
  }, [range, barInterval, loadChart])

  function handleRangeChange(nextRange: YahooChartRange) {
    setRange(nextRange)
    setBarInterval(defaultIntervalFor(nextRange))
  }

  const resolvedTimeZone = useMemo(() => {
    if (timeZone && String(timeZone).trim()) return String(timeZone).trim()
    const fromMeta = chartMetaTimeZone(chart)
    if (fromMeta) {
      return resolveExchangeTimeZone({
        exchangeTimezoneName: fromMeta,
        symbol: ticker,
      })
    }
    return resolveExchangeTimeZone({ symbol: ticker }) || EXCHANGE_TZ_FALLBACK
  }, [timeZone, chart, ticker])

  const allPoints = useMemo(
    () => parseQuotes(chart, activeInterval, resolvedTimeZone, showTimeZone),
    [chart, activeInterval, resolvedTimeZone, showTimeZone],
  )

  // For ranges served from the long daily seed, filter client-side so switching
  // feels instant even before a dedicated Yahoo call returns.
  const filteredPoints = useMemo(() => {
    if (!allPoints.length) return []

    // 1D: keep only the most recent trading day of bars (exchange calendar, not browser local).
    if (range === '1d') {
      const dayKeyFor = (ms: number) => {
        try {
          return new Intl.DateTimeFormat('en-CA', {
            timeZone: resolvedTimeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(ms))
        } catch {
          const d = new Date(ms)
          return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
        }
      }
      const dayKey = dayKeyFor(allPoints[allPoints.length - 1].t)
      const dayPoints = allPoints.filter((p) => dayKeyFor(p.t) === dayKey)
      return dayPoints.length >= 2 ? dayPoints : allPoints
    }

    const now = allPoints[allPoints.length - 1].t
    const startOfYear = new Date(new Date(now).getFullYear(), 0, 1).getTime()
    const cutoffs: Partial<Record<YahooChartRange, number>> = {
      '5d': now - 5 * 24 * 60 * 60 * 1000,
      '1mo': now - 30 * 24 * 60 * 60 * 1000,
      '3mo': now - 90 * 24 * 60 * 60 * 1000,
      '6mo': now - 180 * 24 * 60 * 60 * 1000,
      ytd: startOfYear,
      '1y': now - 365 * 24 * 60 * 60 * 1000,
      '5y': now - 5 * 365 * 24 * 60 * 60 * 1000,
      '10y': now - 10 * 365 * 24 * 60 * 60 * 1000,
    }
    const cutoff = cutoffs[range]
    if (cutoff == null) return allPoints
    const sliced = allPoints.filter((p) => p.t >= cutoff)
    return sliced.length >= 2 ? sliced : allPoints
  }, [allPoints, range, resolvedTimeZone])

  // Keep more points for 1m bars so the minute scale stays useful.
  const maxPlotPoints = activeInterval === '1m' || activeInterval === '2m' ? 600 : 400
  const points = useMemo(() => downsample(filteredPoints, maxPlotPoints), [filteredPoints, maxPlotPoints])

  const width = compact ? 720 : 900
  // Compact sparkline: edge-to-edge line, no axis chrome (tight vertical pad so line fills height)
  const padL = compact ? 2 : 52
  const padR = compact ? 4 : 20
  const padT = compact ? 4 : 16
  const padB = compact ? 4 : 44
  const plotW = width - padL - padR
  const plotH = Math.max(40, height - padT - padB)

  const geometry = useMemo(() => {
    if (points.length < 2) return null
    const closes = points.map((p) => p.close)
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const span = max - min || 1
    const coords = points.map((point, index) => {
      const x = padL + (index / (points.length - 1)) * plotW
      const y = padT + (1 - (point.close - min) / span) * plotH
      return { x, y, index, ...point }
    })
    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ')
    const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(2)},${(padT + plotH).toFixed(2)} L${coords[0].x.toFixed(2)},${(padT + plotH).toFixed(2)} Z`
    const first = points[0].close
    const last = points[points.length - 1].close
    const up = last >= first
    const tickCount = compact ? 5 : isIntradayInterval(activeInterval) ? 6 : 7
    const xTicks = buildTimeAxisTicks(
      points,
      range,
      activeInterval,
      resolvedTimeZone,
      tickCount,
      showTimeZone,
    ).map((tick) => ({
      ...tick,
      x: padL + (tick.index / (points.length - 1)) * plotW,
    }))
    // Compact view always uses soft mint green like the product mock (not red/green day direction)
    const stroke = compact ? '#1FA97A' : up ? '#10b981' : '#ef4444'
    const fill = compact
      ? 'rgba(31,169,122,0.12)'
      : up
        ? 'rgba(16,185,129,0.14)'
        : 'rgba(239,68,68,0.12)'
    return {
      min,
      max,
      coords,
      linePath,
      areaPath,
      xTicks,
      first,
      last,
      up,
      changePct: first !== 0 ? ((last - first) / first) * 100 : 0,
      stroke,
      fill,
    }
  }, [
    points,
    plotW,
    plotH,
    range,
    activeInterval,
    compact,
    padL,
    padT,
    resolvedTimeZone,
    showTimeZone,
  ])

  useEffect(() => {
    if (!onFeedStatusChange) return
    const ok = Boolean(geometry)
    onFeedStatusChange({
      ticker,
      loading,
      ok,
      empty: !loading && !ok && !error,
      error,
    })
  }, [onFeedStatusChange, ticker, loading, geometry, error])

  function handlePointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (!geometry || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * width
    if (x < padL || x > width - padR) {
      setHoverIndex(null)
      return
    }
    const ratio = (x - padL) / plotW
    const index = Math.round(ratio * (points.length - 1))
    setHoverIndex(Math.max(0, Math.min(points.length - 1, index)))
  }

  const active =
    hoverIndex != null && geometry ? geometry.coords[hoverIndex] : geometry?.coords[geometry.coords.length - 1]
  const displayClose = active?.close ?? geometry?.last
  const displayLabel = active?.label ?? points[points.length - 1]?.label
  // % always vs first bar of the selected range (period start → hovered/last point)
  const displayChangePct =
    geometry && displayClose != null && geometry.first !== 0
      ? ((displayClose - geometry.first) / geometry.first) * 100
      : null
  const displayUp = displayChangePct != null ? displayChangePct >= 0 : geometry?.up
  const intervalOptions = intervalOptionsFor(range)

  const rangeDescription = geometry
    ? `${points[0].label} → ${points[points.length - 1].label} · ${formatDecimal(geometry.first)} → ${formatDecimal(geometry.last)} (${geometry.changePct >= 0 ? '+' : ''}${formatDecimal(geometry.changePct)}%) · ${INTERVAL_LABELS[activeInterval] || activeInterval} bars`
    : null

  const controls = (
    <div className={cn('flex flex-wrap items-center justify-between gap-2', borderless ? 'mb-2' : 'mb-3')}>
      <div className="flex flex-col gap-2">
        <div
          className={cn(
            'inline-flex flex-wrap items-center gap-0.5 rounded-lg p-0.5',
            borderless ? 'bg-muted/50' : 'border bg-muted/40',
          )}
        >
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleRangeChange(item.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                range === item.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Interval
          </span>
          <div
            className={cn(
              'inline-flex flex-wrap items-center gap-0.5 rounded-lg p-0.5',
              borderless ? 'bg-muted/40' : 'border bg-muted/30',
            )}
          >
            {intervalOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setBarInterval(opt)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                  barInterval === opt
                    ? 'bg-violet-500/15 text-violet-700 shadow-sm dark:text-violet-300'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title={`${INTERVAL_LABELS[opt] || opt} bars`}
              >
                {INTERVAL_LABELS[opt] || opt}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="text-right">
        {displayClose != null ? (
          <>
            <div
              className={cn(
                'text-lg font-semibold tabular-nums',
                displayUp
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400',
              )}
            >
              ${formatDecimal(displayClose)}
            </div>
            <div className="text-xs text-muted-foreground">{displayLabel}</div>
            {geometry && displayChangePct != null ? (
              <div
                className={cn(
                  'text-[11px] tabular-nums',
                  displayUp
                    ? 'text-emerald-600/80 dark:text-emerald-400/80'
                    : 'text-red-600/80 dark:text-red-400/80',
                )}
                title={`Change from period start (${formatDecimal(geometry.first)}) to this point`}
              >
                {displayChangePct >= 0 ? '+' : ''}
                {formatDecimal(displayChangePct)}% from start · {range.toUpperCase()} ·{' '}
                {INTERVAL_LABELS[activeInterval] || activeInterval}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">
                {range.toUpperCase()} · {INTERVAL_LABELS[activeInterval] || activeInterval}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )

  const chartBody = (
    <>
      {loading ? (
        <div className="flex h-[200px] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading {range.toUpperCase()} · {INTERVAL_LABELS[barInterval] || barInterval}…
        </div>
      ) : null}

      {error && !geometry ? <SectionEmpty message={error} /> : null}

      {!loading && !error && !geometry ? (
        <SectionEmpty message="Not enough price history for this timeframe / interval." />
      ) : null}

      {geometry ? (
        <div
          className={cn(
            'relative w-full overflow-hidden text-muted-foreground',
            borderless
              ? 'rounded-none bg-transparent p-0'
              : 'rounded-lg border bg-muted/20 p-2',
          )}
        >
          {hoverIndex != null && active ? (
            <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border bg-popover/95 px-2.5 py-1.5 text-xs shadow-md">
              <div className="font-medium text-foreground">${formatDecimal(active.close)}</div>
              <div className="text-muted-foreground">{active.label}</div>
              {active.high != null && active.low != null ? (
                <div className="text-muted-foreground">
                  H {formatDecimal(active.high)} · L {formatDecimal(active.low)}
                </div>
              ) : null}
            </div>
          ) : null}

          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full touch-none"
            role="img"
            aria-label={`${ticker} price chart ${range} ${activeInterval}`}
            onPointerMove={handlePointer}
            onPointerLeave={() => setHoverIndex(null)}
            onPointerDown={handlePointer}
          >
            <text x={8} y={padT + 4} fill="currentColor" fontSize="11">
              {formatDecimal(geometry.max)}
            </text>
            <text x={8} y={padT + plotH / 2} fill="currentColor" fontSize="11">
              {formatDecimal((geometry.max + geometry.min) / 2)}
            </text>
            <text x={8} y={padT + plotH} fill="currentColor" fontSize="11">
              {formatDecimal(geometry.min)}
            </text>

            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <line
                key={`h-${t}`}
                x1={padL}
                x2={width - padR}
                y1={padT + t * plotH}
                y2={padT + t * plotH}
                stroke="currentColor"
                strokeOpacity={0.12}
              />
            ))}

            {geometry.xTicks.map((tick) => (
              <g key={`x-${tick.index}-${tick.label}`}>
                <line
                  x1={tick.x}
                  x2={tick.x}
                  y1={padT}
                  y2={padT + plotH}
                  stroke="currentColor"
                  strokeOpacity={0.08}
                />
                <line
                  x1={tick.x}
                  x2={tick.x}
                  y1={padT + plotH}
                  y2={padT + plotH + 5}
                  stroke="currentColor"
                  strokeOpacity={0.35}
                />
                <text
                  x={tick.x}
                  y={height - 12}
                  textAnchor={
                    tick.index === 0 ? 'start' : tick.index === points.length - 1 ? 'end' : 'middle'
                  }
                  fill="currentColor"
                  fontSize="10"
                >
                  {tick.label}
                </text>
              </g>
            ))}

            <line
              x1={padL}
              x2={width - padR}
              y1={padT + plotH}
              y2={padT + plotH}
              stroke="currentColor"
              strokeOpacity={0.25}
            />

            <path d={geometry.areaPath} fill={geometry.fill} />
            <path
              d={geometry.linePath}
              fill="none"
              stroke={geometry.stroke}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {active ? (
              <>
                <line
                  x1={active.x}
                  x2={active.x}
                  y1={padT}
                  y2={padT + plotH}
                  stroke="currentColor"
                  strokeOpacity={0.35}
                  strokeDasharray="4 3"
                />
                <line
                  x1={padL}
                  x2={width - padR}
                  y1={active.y}
                  y2={active.y}
                  stroke="currentColor"
                  strokeOpacity={0.2}
                  strokeDasharray="4 3"
                />
                <circle
                  cx={active.x}
                  cy={active.y}
                  r={4.5}
                  fill={geometry.stroke}
                  stroke="white"
                  strokeWidth={1.5}
                />
              </>
            ) : null}

            <rect x={padL} y={padT} width={plotW} height={plotH} fill="transparent" />
          </svg>

          {error ? (
            <p className="mt-1 px-1 text-xs text-amber-600 dark:text-amber-400">
              {error} (showing cached series)
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  )

  // Period change strip under the whole chart (range start → hovered/end point)
  const periodChangeFooter =
    geometry && displayChangePct != null && displayClose != null ? (
      <div
        className={cn(
          'mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2',
          borderless ? 'border-[#E2EBE8] bg-[#F4F7F6]' : 'border-border/60 bg-muted/30',
        )}
      >
        <div className="min-w-0 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Period change</span>
          <span className="mx-1.5 text-border">·</span>
          <span className="tabular-nums">
            ${formatDecimal(geometry.first)}
            {points[0]?.label ? ` (${points[0].label})` : ''}
          </span>
          <span className="mx-1">→</span>
          <span className="tabular-nums">
            ${formatDecimal(displayClose)}
            {displayLabel ? ` (${displayLabel})` : ''}
          </span>
        </div>
        <div
          className={cn(
            'shrink-0 text-sm font-semibold tabular-nums',
            displayUp
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400',
          )}
        >
          {displayChangePct >= 0 ? '+' : ''}
          {formatDecimal(displayChangePct)}%
          <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
            {range.toUpperCase()}
            {hoverIndex != null ? ' · at cursor' : ' · full range'}
          </span>
        </div>
      </div>
    ) : null

  // Compact collapsed preview — thick line only, no title / axes / border.
  // Fill parent height so the sparkline isn't a short strip with empty space below.
  if (compact) {
    const lastCoord = geometry?.coords[geometry.coords.length - 1]
    return (
      <div
        className="relative h-full w-full min-h-0 overflow-hidden bg-transparent"
        style={{ height: '100%', minHeight: height }}
        aria-label={`${ticker} 1D chart`}
      >
        {loading && !geometry ? (
          <div className="flex h-full min-h-[3rem] items-center justify-center">
            <Loader2 className="size-3.5 animate-spin text-emerald-600/70" />
          </div>
        ) : null}

        {error && !geometry ? (
          <p className="flex h-full items-center justify-center text-center text-[11px] text-muted-foreground">
            {error}
          </p>
        ) : null}

        {!loading && !error && !geometry ? (
          <p className="flex h-full items-center justify-center text-center text-[11px] text-muted-foreground">
            No chart data
          </p>
        ) : null}

        {geometry ? (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="block h-full w-full"
            role="img"
            aria-label={`${ticker} price`}
            preserveAspectRatio="none"
          >
            <path d={geometry.areaPath} fill={geometry.fill} />
            <path
              d={geometry.linePath}
              fill="none"
              stroke={geometry.stroke}
              strokeWidth={3.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {lastCoord ? (
              <circle
                cx={lastCoord.x}
                cy={lastCoord.y}
                r={4}
                fill={geometry.stroke}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
            ) : null}
          </svg>
        ) : null}
      </div>
    )
  }

  // Overview embed: no card chrome, no "Yahoo Finance" badge, no chart box border.
  if (borderless) {
    return (
      <div className="w-full space-y-1">
        {controls}
        {chartBody}
        {periodChangeFooter}
      </div>
    )
  }

  return (
    <SectionCard
      title={title}
      description={
        rangeDescription || 'Select a timeframe and bar size to load price history'
      }
    >
      {controls}
      {chartBody}
      {periodChangeFooter}
      <p className="mt-2 text-xs text-muted-foreground">
        Range picks the window; Interval picks bar size (e.g. 1D → 1 min, 5D → 15 min, 1M → 1 hour). Yahoo
        limits: 1‑minute bars ~last 7 days; intraday bars ~last 60 days.
      </p>
    </SectionCard>
  )
}
