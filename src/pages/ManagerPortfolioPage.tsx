import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  DataSourceNote,
  RawJsonViewer,
  SectionCard,
  SectionEmpty,
  SectionError,
  SectionLoading,
  StatGrid,
  TickerLink,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatTimestamp,
} from '@/components/tickerDashboard/shared'
import { SaveToSupabaseButton } from '@/components/tickerDashboard/SaveToSupabaseButton'
import { TickerDashboardHeader } from '@/components/tickerDashboard/TickerDashboardHeader'
import { useEdgarSection } from '@/hooks/useEdgarSection'
import { getManagerPortfolio, getSavedManager } from '@/services/edgarApi'
import type { WithSteps } from '@/services/edgarApi'
import type { ManagerPortfolio, ManagerPosition } from '@/types/edgar'
import { cn } from '@/lib/utils'

type SortKey = 'ticker' | 'issuer' | 'shares' | 'value' | 'weight'
type SortDir = 'asc' | 'desc'

const MIN_VALUE_OPTIONS = [
  { label: 'Any value', value: 0 },
  { label: '≥ $1M', value: 1_000_000 },
  { label: '≥ $10M', value: 10_000_000 },
  { label: '≥ $100M', value: 100_000_000 },
  { label: '≥ $1B', value: 1_000_000_000 },
]

function comparePositions(a: ManagerPosition, b: ManagerPosition, key: SortKey) {
  switch (key) {
    case 'ticker':
      return (a.ticker || '').localeCompare(b.ticker || '')
    case 'issuer':
      return a.issuer.localeCompare(b.issuer)
    case 'shares':
      return (a.shares ?? 0) - (b.shares ?? 0)
    case 'weight':
      return a.weight - b.weight
    case 'value':
    default:
      return a.valueUsd - b.valueUsd
  }
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  align,
  onSort,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey
  dir: SortDir
  align?: 'left' | 'right'
  onSort: (key: SortKey) => void
}) {
  const isActive = activeKey === sortKey
  return (
    <th className={cn('whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground', align === 'right' ? 'text-right' : 'text-left')}>
      <button
        className={cn('inline-flex items-center gap-1 hover:text-foreground', align === 'right' && 'flex-row-reverse')}
        onClick={() => onSort(sortKey)}
        type="button"
      >
        {label}
        {isActive ? dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </th>
  )
}

export default function ManagerPortfolioPage() {
  const { cik = '' } = useParams<{ cik: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const savedMode = searchParams.get('source') === 'saved'
  const [savedAtOverride, setSavedAtOverride] = useState<string | null>(null)
  // Bumped by the "Refresh from SEC" click below -- included in the fetch key
  // so it triggers a genuinely fresh request, and passed as `force` so the
  // backend bypasses this manager's saved Supabase snapshot (which otherwise
  // takes priority for any ordinary live-mode load) and hits SEC for real.
  const [refreshCount, setRefreshCount] = useState(0)
  const [search, setSearch] = useState('')
  const [tickerOnly, setTickerOnly] = useState(false)
  const [minValue, setMinValue] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('value')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const saved = useEdgarSection(`saved-manager:${cik}`, () => getSavedManager(cik), 'Failed to check saved snapshot')
  const live = useEdgarSection(
    `manager:${cik}:${savedMode}:${refreshCount}`,
    () =>
      savedMode
        ? Promise.resolve<WithSteps<ManagerPortfolio | null>>({ data: null, steps: [] })
        : getManagerPortfolio(cik, refreshCount > 0),
    'Failed to load manager portfolio',
  )

  const data = savedMode ? saved.data?.data ?? null : live.data?.data ?? null
  const steps = savedMode ? [] : live.data?.steps ?? []
  const loading = savedMode ? saved.loading : live.loading
  const error = savedMode ? saved.error : live.error

  const visiblePositions = useMemo(() => {
    if (!data?.positions) return []
    const query = search.trim().toLowerCase()
    const filtered = data.positions.filter((position) => {
      if (tickerOnly && !position.ticker) return false
      if (position.valueUsd < minValue) return false
      if (query && !position.issuer.toLowerCase().includes(query) && !position.ticker.toLowerCase().includes(query)) return false
      return true
    })
    return filtered.sort((a, b) => (sortDir === 'asc' ? comparePositions(a, b, sortKey) : -comparePositions(a, b, sortKey)))
  }, [data?.positions, search, tickerOnly, minValue, sortKey, sortDir])

  const savedTable = saved.data?.sourceTable || 'institution_snapshots / etf_snapshots'
  const sourceNote = savedMode
    ? {
        endpoint: `GET /api/edgar/manager/${cik}/saved`,
        sources: [
          `Supabase table \`${savedTable}\`, row for cik=${cik} (saved ${formatTimestamp(savedAtOverride ?? saved.data?.createdAt)})`,
          'Rendering that saved snapshot as-is -- NOT re-querying SEC EDGAR. Use "Refresh from SEC" in the header above to force a live re-fetch.',
        ],
        loadingLabel: `Fetching saved manager snapshot from Supabase (table: ${savedTable})…`,
      }
    : {
        endpoint: `GET /api/edgar/manager/${cik}${refreshCount > 0 ? '?force=true' : ''}`,
        sources:
          refreshCount > 0
            ? [
                `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json (finds this manager's latest 13F-HR)`,
                `https://www.sec.gov/Archives/edgar/data/${cik}/{accession}/*.xml (that filing's info table)`,
                '"Refresh from SEC" was clicked -- this bypasses the manually-saved Supabase snapshot and any lazy cache, forcing a genuine live SEC fetch.',
              ]
            : [
                `If this manager was already saved via "Save to Supabase", reused directly from that saved snapshot -- no live SEC call. Otherwise: https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json (finds this manager's latest 13F-HR), then https://www.sec.gov/Archives/edgar/data/${cik}/{accession}/*.xml (that filing's info table).`,
              ],
        loadingLabel:
          refreshCount > 0
            ? `Forcing a fresh SEC fetch for CIK ${cik} (bypassing any saved snapshot) and parsing its 13F-HR info table…`
            : `Checking for a saved snapshot for CIK ${cik}, otherwise fetching its latest 13F-HR from SEC…`,
      }

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 md:px-8">
      <TickerDashboardHeader
        ticker={data?.managerName || `Manager ${cik}`}
        companyName={`13F-HR institutional holdings — CIK ${cik}`}
        savedAt={savedAtOverride ?? saved.data?.createdAt}
        onRefresh={
          savedMode
            ? () => {
                setRefreshCount((count) => count + 1)
                setSearchParams({})
              }
            : undefined
        }
        actions={
          data && !data.error ? (
            <SaveToSupabaseButton
              kind="manager"
              identifier={cik}
              bundle={data}
              sourceMetadata={{ fetchedAt: new Date().toISOString() }}
              alreadySaved={Boolean(saved.data)}
              onSaved={setSavedAtOverride}
            />
          ) : undefined
        }
      />

      <DataSourceNote endpoint={sourceNote.endpoint} sources={sourceNote.sources} />
      {loading ? <SectionLoading label={sourceNote.loadingLabel} /> : null}
      {error ? <SectionError message={error} /> : null}
      {data?.error ? <SectionError message={data.error} /> : null}

      {data && !data.error ? (
        <SectionCard title="Top Holdings by Value">
          <StatGrid
            stats={[
              { label: 'Total 13F Value', value: formatCurrency(data.totalValue) },
              { label: 'Positions', value: data.positions.length.toLocaleString('en-US') },
              { label: '13F Filed', value: data.filingDate || 'N/A' },
            ]}
          />
          {data.filingUrl ? (
            <a className="mt-3 inline-block text-sm text-primary underline underline-offset-2" href={data.filingUrl} rel="noreferrer" target="_blank">
              View source filing
            </a>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-7" onChange={(event) => setSearch(event.target.value)} placeholder="Search ticker or issuer…" value={search} />
            </div>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              onChange={(event) => setMinValue(Number(event.target.value))}
              value={minValue}
            >
              {MIN_VALUE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="flex h-8 items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm">
              <input checked={tickerOnly} onChange={(event) => setTickerOnly(event.target.checked)} type="checkbox" />
              Has ticker only
            </label>
            <span className="ml-auto text-xs text-muted-foreground">
              {visiblePositions.length.toLocaleString('en-US')} of {data.positions.length.toLocaleString('en-US')} positions shown
            </span>
          </div>

          <div className="mt-3">
            {visiblePositions.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <SortableHeader activeKey={sortKey} dir={sortDir} label="Ticker" onSort={handleSort} sortKey="ticker" />
                      <SortableHeader activeKey={sortKey} dir={sortDir} label="Issuer" onSort={handleSort} sortKey="issuer" />
                      <SortableHeader align="right" activeKey={sortKey} dir={sortDir} label="Shares" onSort={handleSort} sortKey="shares" />
                      <SortableHeader align="right" activeKey={sortKey} dir={sortDir} label="Value" onSort={handleSort} sortKey="value" />
                      <SortableHeader align="right" activeKey={sortKey} dir={sortDir} label="Share of 13F" onSort={handleSort} sortKey="weight" />
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePositions.map((position, index) => (
                      <tr className="border-b last:border-0 hover:bg-muted/30" key={`${position.cusip || position.issuer}-${index}`}>
                        <td className="whitespace-nowrap px-3 py-2">
                          <TickerLink issuerName={position.issuer} ticker={position.ticker} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{position.issuer}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatNumber(position.shares)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCurrency(position.valueUsd)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatPercent(position.weight)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <SectionEmpty message="No positions match the current search/filters." />
            )}
          </div>
        </SectionCard>
      ) : null}
      <RawJsonViewer data={data} endpoint={sourceNote.endpoint} steps={steps} />
    </div>
  )
}
