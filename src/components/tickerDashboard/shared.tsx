import type { ReactNode } from 'react'
import { AlertCircle, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSavedEntities } from '@/hooks/useSavedEntities'
import { cn } from '@/lib/utils'

// A filled green tick -- shown next to any ticker/manager/politician that's
// already saved to Supabase, so it's obvious at a glance without opening the
// entity itself.
export function SavedBadge({ title = 'Saved to Supabase' }: { title?: string }) {
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500" title={title}>
      <Check className="size-2.5 text-white" strokeWidth={3} />
    </span>
  )
}

// A ticker mentioned inside some other entity's page (a politician's trades,
// a fund manager's positions) -- shows the green tick when that ticker is
// already saved, and always routes to saved/live mode accordingly so
// clicking a saved ticker never re-triggers a live SEC fetch. `issuerName` is
// an optional fallback: 13F rows often have no resolvable ticker symbol at
// all (only the issuer's name), so if `ticker` is empty this still finds a
// match by comparing that name against every saved ticker's company name.
export function TickerLink({ ticker, issuerName }: { ticker?: string | null; issuerName?: string | null }) {
  const { isTickerSaved, resolveSavedTicker } = useSavedEntities()
  const savedTicker = resolveSavedTicker(ticker, issuerName)
  const resolvedTicker = ticker || savedTicker
  if (!resolvedTicker) return null
  const saved = ticker ? isTickerSaved(ticker) : Boolean(savedTicker)
  return (
    <Link
      className="flex items-center gap-1.5 text-primary underline underline-offset-2"
      to={`/dashboard/ticker/${saved ? savedTicker : resolvedTicker}${saved ? '?source=saved' : ''}`}
    >
      {saved ? <SavedBadge /> : null}
      {resolvedTicker}
    </Link>
  )
}

export function RawJsonViewer({ data, endpoint, steps }: { data: unknown; endpoint?: string; steps?: string[] }) {
  if (data === null || data === undefined) return null
  const hasSteps = Boolean(steps?.length)
  return (
    <details className="group mt-6 rounded-lg border">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
        Raw JSON response{endpoint ? <> — <code className="rounded bg-muted px-1 py-0.5">{endpoint}</code></> : null}
      </summary>
      <div className={cn('border-t', hasSteps ? 'grid grid-cols-1 md:grid-cols-2' : '')}>
        {hasSteps ? (
          <div className="max-h-96 overflow-auto border-b bg-muted/20 p-3 md:border-b-0 md:border-r">
            <p className="mb-2 text-xs font-semibold text-foreground">Exactly what happened in the backend</p>
            <ol className="space-y-1.5">
              {steps!.map((entry, index) => (
                <li className="flex gap-2 text-xs text-muted-foreground" key={index}>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">{index + 1}.</span>
                  <span className="break-all">{entry}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <pre className="max-h-96 overflow-auto bg-muted/30 p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>
      </div>
    </details>
  )
}

// Provenance for a tab, collapsed by default (same pattern as RawJsonViewer)
// so it's available without permanently taking up space -- shows which
// backend route was called and which upstream SEC (or local) source it
// queried to build that data.
export function DataSourceNote({ endpoint, sources }: { endpoint: string; sources: string[] }) {
  return (
    <details className="group mb-4 rounded-lg border">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
        Data source — <code className="rounded bg-muted px-1 py-0.5">{endpoint}</code>
      </summary>
      <div className="border-t bg-muted/30 p-3 text-xs text-muted-foreground">
        <ul className="list-disc space-y-0.5 pl-4">
          {sources.map((source, index) => (
            <li key={index} className="break-all">
              {source}
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}

export function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="w-full">
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function SectionLoading({ label = 'Loading…' }: { label?: string }) {
  return <div className="animate-pulse py-6 text-sm text-muted-foreground">{label}</div>
}

export function SectionError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

export function SectionEmpty({ message }: { message: string }) {
  return <p className="py-4 text-sm text-muted-foreground">{message}</p>
}

function safeStatText(value: ReactNode): ReactNode {
  if (value == null || typeof value === 'boolean') return value == null ? '—' : value ? 'Yes' : 'No'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value
  if (typeof value === 'object' && !Array.isArray(value) && !('$$typeof' in (value as object))) {
    try {
      return JSON.stringify(value)
    } catch {
      return '—'
    }
  }
  return value
}

export function StatGrid({ stats }: { stats: { label: string; value: ReactNode; sub?: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-lg border bg-muted/30 px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground">{stat.label}</div>
          <div className="mt-0.5 truncate text-base font-semibold">{safeStatText(stat.value)}</div>
          {stat.sub ? <div className="mt-0.5 text-xs text-muted-foreground">{safeStatText(stat.sub)}</div> : null}
        </div>
      ))}
    </div>
  )
}

function safeReactText(value: ReactNode): ReactNode {
  // Never put plain objects into the DOM — Yahoo payloads often nest {raw,fmt} or quoteType blobs.
  if (value == null || typeof value === 'boolean') return value == null ? '—' : value ? 'Yes' : 'No'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value
  if (Array.isArray(value)) {
    if (!value.length) return '—'
    if (value.every((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return value.map(String).join(', ')
    }
    return `${value.length} items`
  }
  if (typeof value === 'object' && !('$$typeof' in (value as object))) {
    const obj = value as unknown as Record<string, unknown>
    if (typeof obj.fmt === 'string' && obj.fmt.trim()) return obj.fmt.trim()
    if (typeof obj.longFmt === 'string' && obj.longFmt.trim()) return obj.longFmt.trim()
    if (typeof obj.raw === 'number' && Number.isFinite(obj.raw)) return String(obj.raw)
    if (typeof obj.raw === 'string') return obj.raw
    // Prefer a short human field over dumping the whole object
    for (const key of ['shortName', 'longName', 'name', 'symbol', 'title', 'label', 'description', 'quoteType']) {
      if (typeof obj[key] === 'string' && obj[key]) return String(obj[key])
    }
    return '—'
  }
  return value
}

export function KeyValueList({
  pairs,
  columns = 1,
}: {
  pairs: { label: string; value: ReactNode }[]
  /** Multi-column layout for denser Market / Overview panels. */
  columns?: 1 | 2 | 3
}) {
  return (
    <dl
      className={cn(
        'divide-y',
        columns === 2 &&
          'sm:grid sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0 sm:[&>div]:border-b sm:[&>div]:border-border/60',
        columns === 3 &&
          'sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-x-6 sm:divide-y-0 sm:[&>div]:border-b sm:[&>div]:border-border/60',
      )}
    >
      {pairs.map((pair) => (
        <div key={pair.label} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
          <dt className="shrink-0 text-sm text-muted-foreground sm:w-28 lg:w-32">{pair.label}</dt>
          <dd className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">{safeReactText(pair.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SimpleTable({
  columns,
  rows,
  emptyMessage = 'No data available.',
}: {
  columns: { key: string; label: string; align?: 'left' | 'right' }[]
  rows: Record<string, ReactNode>[]
  emptyMessage?: string
}) {
  if (!rows.length) return <SectionEmpty message={emptyMessage} />
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground',
                  col.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b last:border-0 hover:bg-muted/30">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn('whitespace-nowrap px-3 py-2', col.align === 'right' ? 'text-right tabular-nums' : 'text-left')}
                >
                  {row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Large magnitudes (share counts, market values) read far faster abbreviated
// -- 1,928,629,174 as 1.9B -- than as a long digit string. Always 1 decimal.
function compactMagnitude(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000_000) return `${(abs / 1_000_000_000_000).toFixed(1)}T`
  if (abs >= 1_000_000_000) return `${(abs / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`
  return abs.toFixed(1)
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  const sign = value < 0 ? '-' : ''
  return `${sign}$${compactMagnitude(value)}`
}

export function GainText({ value, children }: { value: number | null | undefined; children: ReactNode }) {
  if (value === null || value === undefined || Number.isNaN(value) || value === 0) return <>{children}</>
  return <span className={value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{children}</span>
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  const sign = value < 0 ? '-' : ''
  return `${sign}${compactMagnitude(value)}`
}

/** Format any finite number to exactly 1 decimal place (e.g. 315.3). */
export function formatDecimal(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  return value.toFixed(1)
}

// Some numbers arrive as pre-formatted text scraped straight from a filing's
// HTML (proxy statement tables, STOCK Act amount-range labels) rather than as
// JS numbers -- formatCurrency/formatNumber can't touch those, so this finds
// every "$1,234,567"-style substring and abbreviates it in place.
export function compactDollarAmountsInText(text: string) {
  return text.replace(/\$[\d,]+(?:\.\d+)?/g, (match) => {
    const num = Number(match.replace(/[$,]/g, ''))
    return Number.isNaN(num) ? match : formatCurrency(num)
  })
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

export function formatTimestamp(iso: string | null | undefined) {
  if (!iso) return 'N/A'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'N/A'
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}
