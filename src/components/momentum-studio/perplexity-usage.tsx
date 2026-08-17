import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, Search } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type Totals = {
  total_cost_usd: number
  total_cost_usd_display: string
  total_credits: number
  total_calls: number
}

type DayRow = {
  day: string
  cost_usd?: number | null
  cost_usd_display?: string | null
  credits_used?: number | null
  total_tokens?: number | null
  calls?: number | null
}

export function PerplexityUsagePanel() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [totals, setTotals] = useState<Totals | null>(null)
  const [daily, setDaily] = useState<DayRow[]>([])
  const [consoleUrl, setConsoleUrl] = useState(
    'https://www.perplexity.ai/account/api/billing',
  )
  const [balanceNote, setBalanceNote] = useState(
    'Remaining prepaid balance is only on Perplexity console — not available via API.',
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void fetch('/api/notifications/usage/perplexity?days=90')
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
        if (cancelled) return
        setTotals({
          total_cost_usd: Number(body.total_cost_usd) || 0,
          total_cost_usd_display:
            body.total_cost_usd_display ||
            (Number(body.total_cost_usd)
              ? `$${Number(body.total_cost_usd).toFixed(6)}`
              : '$0.000000'),
          total_credits: Number(body.total_credits) || 0,
          total_calls: Number(body.total_calls) || 0,
        })
        setDaily(Array.isArray(body.daily) ? body.daily : [])
        if (body.console_url) setConsoleUrl(String(body.console_url))
        if (body.balance_note) setBalanceNote(String(body.balance_note))
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load Perplexity usage',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-12 text-sm text-muted-foreground lg:px-6">
        <Loader2 className="size-4 animate-spin" />
        Loading usage…
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 lg:px-6">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 lg:px-6">
      <div className="flex items-start gap-2">
        <Search className="mt-0.5 size-4 shrink-0" />
        <div>
          <h2 className="text-base font-medium">Perplexity credits & cost</h2>
          <p className="text-sm text-muted-foreground">
            App-tracked spend from each momentum research call (last 90 days
            ET). Token credits = total tokens. Prepaid remaining balance is
            only on Perplexity’s console.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Total cost</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {totals?.total_cost_usd_display || '$0.000000'}
            </CardTitle>
            <CardDescription>All tracked research calls</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Token credits used</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {(totals?.total_credits || 0).toLocaleString()}
            </CardTitle>
            <CardDescription>Sum of total tokens per call</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Research calls</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {(totals?.total_calls || 0).toLocaleString()}
            </CardTitle>
            <CardDescription>Last 90 days (ET)</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Alert>
        <AlertDescription className="flex flex-col gap-2">
          <span>{balanceNote}</span>
          <Button asChild variant="link" className="h-auto justify-start p-0">
            <a href={consoleUrl} target="_blank" rel="noreferrer">
              Open Perplexity API billing
              <ExternalLink />
            </a>
          </Button>
        </AlertDescription>
      </Alert>

      {!daily.length ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No Perplexity usage logged yet. Run research once to start tracking.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day (ET)</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Token credits</TableHead>
                <TableHead>Calls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {daily.map((row) => (
                <TableRow key={row.day}>
                  <TableCell className="font-medium tabular-nums">
                    {row.day}
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">
                    {row.cost_usd_display ||
                      (row.cost_usd != null
                        ? `$${Number(row.cost_usd).toFixed(6)}`
                        : '—')}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {(row.credits_used || row.total_tokens || 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {row.calls ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
