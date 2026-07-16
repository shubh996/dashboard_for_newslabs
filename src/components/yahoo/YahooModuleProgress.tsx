import { Check, CircleDashed, Loader2, X } from 'lucide-react'
import type { YahooModuleStatusCode, YahooUnitCatalogueItem, YahooUnitProgress } from '@/types/yahoo'
import { SectionCard } from '@/components/tickerDashboard/shared'
import { SourceBadge } from '@/components/tickerDashboard/SourceBadge'
import { cn } from '@/lib/utils'

function StatusIcon({ status }: { status: YahooModuleStatusCode }) {
  if (status === 'loading') return <Loader2 className="size-3.5 animate-spin text-violet-500" />
  if (status === 'success') return <Check className="size-3.5 text-emerald-500" />
  if (status === 'empty') return <CircleDashed className="size-3.5 text-muted-foreground" />
  if (status === 'error') return <X className="size-3.5 text-destructive" />
  return <CircleDashed className="size-3.5 text-muted-foreground/50" />
}

function statusLabel(status: YahooModuleStatusCode) {
  if (status === 'loading') return 'Loading'
  if (status === 'success') return 'OK'
  if (status === 'empty') return 'No data'
  if (status === 'error') return 'Failed'
  return 'Pending'
}

export function YahooModuleProgress({
  catalogue,
  progress,
  loading,
  /** When true, skip outer SectionCard (parent already provides the heading). */
  embedded = false,
}: {
  catalogue: YahooUnitCatalogueItem[]
  progress: Record<string, YahooUnitProgress>
  loading: boolean
  embedded?: boolean
}) {
  const rows = catalogue.map((unit) => {
    const current = progress[unit.id]
    return {
      ...unit,
      status: (current?.status || (loading ? 'pending' : 'pending')) as YahooModuleStatusCode,
      error: current?.error,
    }
  })

  const succeeded = rows.filter((row) => row.status === 'success').length
  const failed = rows.filter((row) => row.status === 'error').length
  const empty = rows.filter((row) => row.status === 'empty').length
  const loadingRow = rows.find((row) => row.status === 'loading')
  const done = succeeded + failed + empty
  const total = rows.length || 1
  const percent = Math.round((done / total) * 100)

  const summary = loading
    ? loadingRow
      ? `Yahoo Finance — now fetching: ${loadingRow.label} · ${done}/${total} (${percent}%)`
      : `Fetching Yahoo Finance modules… ${done}/${total} (${percent}%)`
    : `${succeeded} succeeded · ${empty} empty · ${failed} failed`

  const body = (
    <>
      <p className={cn('text-sm text-muted-foreground', embedded ? 'mb-3' : 'sr-only')}>{summary}</p>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            failed && !loading ? 'bg-amber-500' : 'bg-violet-500',
          )}
          style={{ width: `${loading ? Math.max(percent, 4) : 100}%` }}
        />
      </div>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-start gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs"
            title={row.error || undefined}
          >
            <StatusIcon status={row.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">{row.label}</div>
              <div className="text-muted-foreground">
                {row.group} · {statusLabel(row.status)}
                {row.error ? ` — ${row.error}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )

  if (embedded) {
    return <div className="rounded-xl border bg-card p-4 shadow-sm">{body}</div>
  }

  return (
    <SectionCard
      title="Module fetch progress"
      description={summary}
      action={<SourceBadge source="yahoo-finance" />}
    >
      {body}
    </SectionCard>
  )
}
