import { cn } from '@/lib/utils'

export function SourceBadge({
  source,
  className,
}: {
  source: 'yahoo-finance' | 'sec' | 'supabase' | 'local'
  className?: string
}) {
  if (source === 'yahoo-finance') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400',
          className,
        )}
      >
        Yahoo Finance
      </span>
    )
  }
  if (source === 'sec') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400',
          className,
        )}
      >
        SEC EDGAR
      </span>
    )
  }
  if (source === 'supabase') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400',
          className,
        )}
      >
        Supabase
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      Local dataset
    </span>
  )
}
