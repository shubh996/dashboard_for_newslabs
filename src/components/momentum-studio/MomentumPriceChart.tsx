import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Loader2 } from 'lucide-react'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  CHART_INTERVAL_BY_RANGE,
  fetchYahooChart,
  type YahooChartRange,
} from '@/services/yahooApi'

const RANGES: { id: YahooChartRange; label: string }[] = [
  { id: '1d', label: '1D' },
  { id: '5d', label: '5D' },
  { id: '1mo', label: '1M' },
  { id: '3mo', label: '3M' },
  { id: '1y', label: '1Y' },
  { id: '5y', label: '5Y' },
]

const chartConfig = {
  close: {
    label: 'Price',
    color: 'var(--foreground)',
  },
} satisfies ChartConfig

function rawNum(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'object' && value !== null && 'raw' in value) {
    const raw = (value as { raw: unknown }).raw
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  }
  return null
}

type Point = { t: number; label: string; close: number }

function parseQuotes(chart: unknown, range: YahooChartRange): Point[] {
  const quotes = (chart as { quotes?: Record<string, unknown>[] } | null)?.quotes
  if (!Array.isArray(quotes)) return []
  const out: Point[] = []
  for (const row of quotes) {
    const close = rawNum(row.close ?? row.adjclose)
    if (close == null) continue
    const d = row.date ? new Date(String(row.date)) : null
    if (!d || Number.isNaN(d.getTime())) continue
    out.push({
      t: d.getTime(),
      label:
        range === '1d' || range === '5d'
          ? d.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })
          : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      close,
    })
  }
  if (out.length <= 240) return out
  const step = Math.ceil(out.length / 240)
  const sampled = out.filter((_, i) => i % step === 0)
  const last = out[out.length - 1]
  if (sampled[sampled.length - 1] !== last) sampled.push(last)
  return sampled
}

export function MomentumPriceChart({
  ticker,
  className,
}: {
  ticker: string
  className?: string
}) {
  const [range, setRange] = useState<YahooChartRange>('1d')
  const [points, setPoints] = useState<Point[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const interval = CHART_INTERVAL_BY_RANGE[range]?.default
    setLoading(true)
    setError(null)
    void fetchYahooChart(ticker, range, interval)
      .then((body) => {
        if (cancelled) return
        setPoints(parseQuotes(body.chart, range))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPoints([])
        setError(err instanceof Error ? err.message : 'Chart failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticker, range])

  const data = useMemo(
    () => points.map((p, i) => ({ ...p, i })),
    [points],
  )

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Tabs
          value={range}
          onValueChange={(v) => setRange(v as YahooChartRange)}
        >
          <TabsList variant="line">
            {RANGES.map((r) => (
              <TabsTrigger key={r.id} value={r.id}>
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {loading ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {loading && !data.length ? (
        <Skeleton className="h-[240px] w-full" />
      ) : error ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{error}</p>
      ) : !data.length ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No chart data
        </p>
      ) : (
        <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full">
          <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="fillClose" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-close)"
                  stopOpacity={0.18}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-close)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              tickMargin={8}
            />
            <YAxis
              dataKey="close"
              tickLine={false}
              axisLine={false}
              width={56}
              domain={['auto', 'auto']}
              tickFormatter={(v) =>
                Number(v).toLocaleString('en-US', {
                  maximumFractionDigits: 2,
                })
              }
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="line"
                  labelKey="label"
                  nameKey="close"
                />
              }
            />
            <Area
              dataKey="close"
              type="monotone"
              fill="url(#fillClose)"
              stroke="var(--color-close)"
              strokeWidth={1.5}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  )
}
