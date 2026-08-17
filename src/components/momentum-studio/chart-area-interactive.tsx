import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'

import { useIsMobile } from '@/hooks/use-mobile'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group'
import {
  CHART_INTERVAL_BY_RANGE,
  fetchYahooChart,
  type YahooChartRange,
} from '@/services/yahooApi'

const chartConfig = {
  price: { label: 'Price' },
  close: {
    label: 'Close',
    color: 'var(--primary)',
  },
} satisfies ChartConfig

function rawNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value === 'object' && 'raw' in value) {
    const raw = (value as { raw: unknown }).raw
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  }
  return null
}

export function ChartAreaInteractive({
  ticker,
  compact = false,
  onExpand,
}: {
  ticker: string
  compact?: boolean
  onExpand?: () => void
}) {
  const isMobile = useIsMobile()
  const [range, setRange] = useState<YahooChartRange>('1d')
  const [data, setData] = useState<{ date: string; close: number }[]>([])
  const gradientId = compact ? `fillCloseMini-${ticker}` : `fillClose-${ticker}`

  useEffect(() => {
    if (isMobile && range === '1y') setRange('5d')
  }, [isMobile, range])

  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    const interval = CHART_INTERVAL_BY_RANGE[range]?.default
    void fetchYahooChart(ticker, range, interval)
      .then((body) => {
        if (cancelled) return
        const quotes = (
          body.chart as { quotes?: Record<string, unknown>[] } | null
        )?.quotes
        if (!Array.isArray(quotes)) {
          setData([])
          return
        }
        const pts: { date: string; close: number }[] = []
        for (const row of quotes) {
          const close = rawNum(row.close ?? row.adjclose)
          const d = row.date ? new Date(String(row.date)) : null
          if (close == null || !d || Number.isNaN(d.getTime())) continue
          pts.push({ date: d.toISOString(), close })
        }
        if (pts.length > 240) {
          const step = Math.ceil(pts.length / 240)
          const sampled = pts.filter((_, i) => i % step === 0)
          const last = pts[pts.length - 1]
          if (sampled[sampled.length - 1] !== last) sampled.push(last)
          setData(sampled)
        } else {
          setData(pts)
        }
      })
      .catch(() => {
        if (!cancelled) setData([])
      })
    return () => {
      cancelled = true
    }
  }, [ticker, range])

  const title = useMemo(() => ticker || 'Price', [ticker])

  const plot = (
    <ChartContainer
      config={chartConfig}
      className={
        compact
          ? 'aspect-auto h-[52px] w-full'
          : 'aspect-auto h-[250px] w-full'
      }
    >
      <AreaChart data={data}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-close)"
              stopOpacity={1}
            />
            <stop
              offset="95%"
              stopColor="var(--color-close)"
              stopOpacity={0.1}
            />
          </linearGradient>
        </defs>
        {compact ? null : <CartesianGrid vertical={false} />}
        {compact ? null : (
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={(value) => {
              const date = new Date(value)
              if (range === '1d' || range === '5d') {
                return date.toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })
              }
              return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })
            }}
          />
        )}
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => {
                return new Date(String(value)).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })
              }}
              indicator="dot"
            />
          }
        />
        <Area
          dataKey="close"
          type="natural"
          fill={`url(#${gradientId})`}
          stroke="var(--color-close)"
        />
      </AreaChart>
    </ChartContainer>
  )

  if (compact) {
    return (
      <Card
        size="sm"
        className="@container/card cursor-pointer @xl/main:col-span-2"
        onClick={onExpand}
      >
        <CardHeader>
          <CardDescription>Chart</CardDescription>
          <CardTitle className="text-sm font-medium">1D · click to expand</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-2 pt-0">{plot}</CardContent>
      </Card>
    )
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Yahoo Finance · shadcn Chart
          </span>
          <span className="@[540px]/card:hidden">Yahoo · Chart</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(v) => {
              if (v) setRange(v as YahooChartRange)
            }}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="1d">1D</ToggleGroupItem>
            <ToggleGroupItem value="5d">5D</ToggleGroupItem>
            <ToggleGroupItem value="1mo">1M</ToggleGroupItem>
            <ToggleGroupItem value="3mo">3M</ToggleGroupItem>
            <ToggleGroupItem value="1y">1Y</ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={range}
            onValueChange={(v) => setRange(v as YahooChartRange)}
          >
            <SelectTrigger
              className="flex w-28 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a range"
            >
              <SelectValue placeholder="1D" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="1d" className="rounded-lg">
                1D
              </SelectItem>
              <SelectItem value="5d" className="rounded-lg">
                5D
              </SelectItem>
              <SelectItem value="1mo" className="rounded-lg">
                1M
              </SelectItem>
              <SelectItem value="3mo" className="rounded-lg">
                3M
              </SelectItem>
              <SelectItem value="1y" className="rounded-lg">
                1Y
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">{plot}</CardContent>
    </Card>
  )
}
