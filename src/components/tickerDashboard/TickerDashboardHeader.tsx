import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatTimestamp, SavedBadge } from './shared'
import { TickerSearchBar } from './TickerSearchBar'

export function TickerDashboardHeader({
  ticker,
  companyName,
  actions,
  savedAt,
  onRefresh,
}: {
  ticker: string
  companyName?: string
  actions?: ReactNode
  savedAt?: string | null
  onRefresh?: () => void
}) {
  const navigate = useNavigate()

  return (
    <div className="sticky top-0 z-30 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-8 md:px-8">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => navigate(-1)} title="Back">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight">{ticker}</h1>
            {savedAt ? <SavedBadge /> : null}
          </div>
          {companyName ? <p className="text-sm text-muted-foreground">{companyName}</p> : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TickerSearchBar />
        {savedAt ? (
          <div className="text-right text-xs text-muted-foreground">
            Saved on
            <br />
            {formatTimestamp(savedAt)}
          </div>
        ) : null}
        {onRefresh ? (
          <Button onClick={onRefresh} size="sm" variant="outline">
            <RefreshCw className="size-4" />
            Refresh from SEC
          </Button>
        ) : null}
        {actions}
      </div>
    </div>
  )
}
