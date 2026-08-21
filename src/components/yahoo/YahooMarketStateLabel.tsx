import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  yahooMarketStateDisplay,
  type YahooMarketState,
} from '@/lib/yahooMarketSession'

/**
 * Shows the current Yahoo Finance marketState as a human label.
 * Never mocks a session — if Yahoo did not return a known state, shows
 * “Market state unavailable”.
 */
export function YahooMarketStateLabel({
  marketState,
  className,
  unavailableClassName,
}: {
  marketState?: string | null
  className?: string
  unavailableClassName?: string
}) {
  const { label, available, state } = yahooMarketStateDisplay(marketState)
  return (
    <span
      className={cn(
        'text-[10px] font-medium leading-tight tracking-wide',
        available
          ? 'text-muted-foreground'
          : cn('text-amber-700/90 dark:text-amber-400/90', unavailableClassName),
        className,
      )}
      title={
        available && state
          ? `Yahoo marketState: ${state}`
          : 'Yahoo did not return a marketState for this quote'
      }
      data-market-state={state || 'unavailable'}
    >
      {label}
    </span>
  )
}

/** Stack market state above a Yahoo Finance control (link / badge). */
export function YahooFinanceWithMarketState({
  marketState,
  children,
  className,
}: {
  marketState?: string | null
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 flex-col items-start gap-0.5 leading-tight',
        className,
      )}
    >
      <YahooMarketStateLabel marketState={marketState} />
      {children}
    </span>
  )
}

export type { YahooMarketState }
