import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Moon, RefreshCw, Search, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SavedBadge, SectionCard, SectionError, SectionLoading, formatTimestamp } from '@/components/tickerDashboard/shared'
import { SourceBadge } from '@/components/tickerDashboard/SourceBadge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSavedEntities } from '@/hooks/useSavedEntities'
import { getManagerList, refreshAllManagers, searchSaved } from '@/services/edgarApi'
import { searchYahooSaved } from '@/services/yahooApi'
import { cn } from '@/lib/utils'
import type { ManagerList, ManagerListItem, ManagerRefreshSummary, SearchResultItem, SearchResults } from '@/types/edgar'
import type { YahooSearchResult } from '@/types/yahoo'

const emptyResults: SearchResults = { tickers: [], institutions: [], etfs: [], politicians: [] }

type DataSource = 'sec' | 'yahoo'

// The curated manager universe never changes mid-session -- fetch once and
// share across remounts instead of re-requesting a static list every visit.
let managerListCache: ManagerList | null = null

function useManagerList() {
  const [list, setList] = useState<ManagerList | null>(managerListCache)
  useEffect(() => {
    if (managerListCache) return
    getManagerList().then((data) => {
      managerListCache = data
      setList(data)
    })
  }, [])
  return list
}

function isAllDigits(value: string) {
  return /^\d+$/.test(value)
}

function looksLikeTicker(value: string) {
  return /^[A-Za-z.-]{1,6}$/.test(value)
}

// Same localStorage key the main news dashboard (App.tsx) uses, so the theme
// stays consistent no matter which page you land on first.
function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    window.localStorage.getItem('newslabs-theme') === 'dark' ? 'dark' : 'light',
  )
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('newslabs-theme', theme)
  }, [theme])
  return [theme, setTheme] as const
}

function useYahooSavedTickers(enabled: boolean) {
  const [tickers, setTickers] = useState<YahooSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    searchYahooSaved('')
      .then((body) => {
        if (cancelled) return
        setTickers(body.tickers || [])
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load Yahoo Finance snapshots')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, reloadToken])

  return {
    tickers,
    loading,
    error,
    refresh: () => setReloadToken((token) => token + 1),
  }
}

export default function TickerDatabasePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const source: DataSource = searchParams.get('source') === 'yahoo' ? 'yahoo' : 'sec'

  // Shared with every other saved-entity checkmark in the app -- landing here
  // reuses whatever's already cached instead of re-fetching, and the Refresh
  // button below is the only thing that forces a fresh Supabase read.
  const browse = useSavedEntities()
  const yahooBrowse = useYahooSavedTickers(source === 'yahoo')
  const managerList = useManagerList()
  const [theme, setTheme] = useTheme()

  function setSource(next: DataSource) {
    const params = new URLSearchParams(searchParams)
    if (next === 'yahoo') params.set('source', 'yahoo')
    else params.delete('source')
    setSearchParams(params, { replace: true })
  }

  function handleRefresh() {
    if (source === 'yahoo') yahooBrowse.refresh()
    else browse.refresh()
  }

  const refreshing = source === 'yahoo' ? yahooBrowse.loading : browse.loading
  const pageError = source === 'yahoo' ? yahooBrowse.error : browse.error

  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-screen-2xl flex-col px-4 py-4 md:px-8">
      {/* One row: search · SEC/Yahoo toggle · theme */}
      <div className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-8 md:flex-nowrap md:gap-3 md:px-8">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <DatabaseSearchBox dataSource={source} onNavigate={(path) => navigate(path)} />
          <Button
            className="size-8 shrink-0"
            disabled={refreshing}
            onClick={handleRefresh}
            size="icon"
            title="Refresh from Supabase"
            variant="outline"
          >
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center">
          <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs font-medium sm:text-sm">
            <button
              className={cn(
                'rounded-md px-3 py-1.5 transition-colors sm:px-5',
                source === 'sec' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setSource('sec')}
              type="button"
            >
              SEC
            </button>
            <button
              className={cn(
                'rounded-md px-3 py-1.5 transition-colors sm:px-5',
                source === 'yahoo' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setSource('yahoo')}
              type="button"
            >
              Yahoo Finance
            </button>
          </div>
        </div>

        <Button
          className="size-8 shrink-0"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          size="icon"
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          variant="outline"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </div>

      <p className="py-3 text-center text-sm text-muted-foreground">
        {source === 'yahoo'
          ? 'Yahoo Finance snapshots saved to Supabase. Search a ticker to fetch live Yahoo data.'
          : 'SEC EDGAR data saved to Supabase. Search to fetch or view anything new.'}
      </p>

      {refreshing ? (
        <SectionLoading
          label={
            source === 'yahoo'
              ? 'Fetching Yahoo Finance snapshots from Supabase…'
              : 'Fetching everything saved so far from Supabase…'
          }
        />
      ) : null}
      {pageError ? <SectionError message={pageError} /> : null}

      {source === 'yahoo' && !refreshing && !pageError ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <SourceBadge source="yahoo-finance" />
            <span className="text-sm text-muted-foreground">
              Saved in <code className="rounded bg-muted px-1">yahoo_finance_snapshots</code> — never overwrites SEC data.
            </span>
          </div>
          <SavedListSection
            title="Yahoo Finance tickers"
            items={yahooBrowse.tickers.map((item) => ({
              ...item,
              label: item.companyName ? `${item.ticker} — ${item.companyName}` : item.ticker,
            }))}
            buildHref={(item) => `/dashboard/yahoo/${item.ticker}?source=saved`}
          />
        </div>
      ) : null}

      {source === 'sec' && !refreshing && !pageError ? (
        <Tabs defaultValue="tickers">
          <TabsList>
            <TabsTrigger value="tickers">Tickers</TabsTrigger>
            <TabsTrigger value="politicians">Politicians</TabsTrigger>
            <TabsTrigger value="institutions">Hedge Fund & Institutions</TabsTrigger>
            <TabsTrigger value="etfs">ETFs</TabsTrigger>
          </TabsList>

          <TabsContent value="tickers" className="mt-4">
            <SavedListSection title="Tickers" items={browse.data.tickers} buildHref={(item) => `/dashboard/ticker/${item.ticker}?source=saved`} />
          </TabsContent>

          <TabsContent value="politicians" className="mt-4">
            <SavedListSection
              title="Politicians"
              items={browse.data.politicians.filter((item) => item.savedAt)}
              buildHref={(item) => `/dashboard/ticker/politician/${item.filerId}?source=saved`}
              getLabel={(item) => item.fullName}
            />
          </TabsContent>

          <TabsContent value="institutions" className="mt-4">
            {managerList ? (
              <ManagerCoverageSection category="hedge-fund" title="Hedge Funds & Institutions" managers={managerList.hedgeFunds} />
            ) : (
              <SectionCard title="Hedge Funds & Institutions">
                <SectionLoading label="Loading tracked manager list…" />
              </SectionCard>
            )}
          </TabsContent>

          <TabsContent value="etfs" className="mt-4">
            {managerList ? (
              <ManagerCoverageSection category="investment-fund" title="ETFs" managers={managerList.investmentFunds} />
            ) : (
              <SectionCard title="ETFs">
                <SectionLoading label="Loading tracked manager list…" />
              </SectionCard>
            )}
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  )
}

// Unlike SavedListSection (which only ever lists whatever's already saved),
// this shows the FULL curated universe of tracked managers for this
// category -- tick for the ones already saved, an empty ring for the ones
// still needing a manual visit + "Save to Supabase" click. The refresh
// button bulk-fetches every manager in the category fresh from SEC and
// upserts each into Supabase, instead of visiting them one at a time.
function ManagerCoverageSection({
  title,
  managers,
  category,
}: {
  title: string
  managers: ManagerListItem[]
  category: 'hedge-fund' | 'investment-fund'
}) {
  const { isManagerSaved, getManagerSavedAt, refresh } = useSavedEntities()
  const [refreshState, setRefreshState] = useState<{ loading: boolean; summary: ManagerRefreshSummary | null; error: string | null }>({
    loading: false,
    summary: null,
    error: null,
  })
  const savedCount = managers.filter((manager) => isManagerSaved(manager.cik)).length

  function handleRefreshAll() {
    setRefreshState({ loading: true, summary: null, error: null })
    refreshAllManagers(category)
      .then((summary) => {
        setRefreshState({ loading: false, summary, error: null })
        refresh()
      })
      .catch((error: unknown) => {
        setRefreshState({ loading: false, summary: null, error: error instanceof Error ? error.message : 'Failed to refresh managers' })
      })
  }

  return (
    <SectionCard
      title={title}
      description={`${savedCount} of ${managers.length} saved`}
      action={
        <Button
          className="size-7"
          disabled={refreshState.loading}
          onClick={handleRefreshAll}
          size="icon"
          title={`Refresh all ${managers.length} from SEC and save to Supabase`}
          variant="outline"
        >
          <RefreshCw className={cn('size-3.5', refreshState.loading && 'animate-spin')} />
        </Button>
      }
    >
      {refreshState.loading ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Refreshing all {managers.length} managers from SEC and saving to Supabase — this can take a minute or two…
        </p>
      ) : null}
      {refreshState.summary ? (
        <div className="mb-3 rounded-lg border bg-muted/30 p-3 text-xs">
          <p className="font-medium text-foreground">
            Refreshed {refreshState.summary.succeeded} of {refreshState.summary.total} — {refreshState.summary.failed} failed.
          </p>
          {refreshState.summary.failed ? (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {refreshState.summary.results
                .filter((result) => !result.ok)
                .map((result) => (
                  <li key={result.cik}>
                    {result.name} (CIK {result.cik}): {result.error}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {refreshState.error ? <p className="mb-3 text-xs text-destructive">{refreshState.error}</p> : null}
      <div className="divide-y">
        {managers.map((manager) => {
          const saved = isManagerSaved(manager.cik)
          return (
            <Link
              className="flex items-center justify-between gap-3 py-2 text-sm hover:text-primary"
              key={manager.name}
              to={`/dashboard/ticker/manager/${manager.cik}${saved ? '?source=saved' : ''}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {saved ? <SavedBadge /> : <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />}
                <span className="truncate font-medium">{manager.name}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {saved ? formatTimestamp(getManagerSavedAt(manager.cik)) : 'Not saved yet'}
              </span>
            </Link>
          )
        })}
      </div>
    </SectionCard>
  )
}

function SavedListSection<T extends { savedAt: string | null }>({
  title,
  items,
  buildHref,
  getLabel = (item: T) => (item as unknown as SearchResultItem).label,
}: {
  title: string
  items: T[]
  buildHref: (item: T) => string
  getLabel?: (item: T) => string
}) {
  return (
    <SectionCard title={title} description={`${items.length} saved`}>
      {items.length ? (
        <div className="divide-y">
          {items.map((item, index) => (
            <Link
              className="flex items-center justify-between gap-3 py-2 text-sm hover:text-primary"
              key={index}
              to={buildHref(item)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <SavedBadge />
                <span className="truncate font-medium">{getLabel(item)}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatTimestamp(item.savedAt)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">Nothing saved yet.</p>
      )}
    </SectionCard>
  )
}

function DatabaseSearchBox({ dataSource, onNavigate }: { dataSource: DataSource; onNavigate: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(emptyResults)
  const [yahooResults, setYahooResults] = useState<YahooSearchResult[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!query) {
      setResults(emptyResults)
      setYahooResults([])
      return
    }
    const timer = setTimeout(() => {
      if (dataSource === 'yahoo') {
        searchYahooSaved(query)
          .then((body) => setYahooResults(body.tickers || []))
          .catch(() => setYahooResults([]))
      } else {
        searchSaved(query)
          .then(setResults)
          .catch(() => setResults(emptyResults))
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [query, dataSource])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function go(path: string) {
    setOpen(false)
    setQuery('')
    onNavigate(path)
  }

  function handleSubmit() {
    const trimmed = query.trim()
    if (!trimmed) return
    if (dataSource === 'yahoo') {
      if (looksLikeTicker(trimmed)) go(`/dashboard/yahoo/${trimmed.toUpperCase()}`)
      return
    }
    if (isAllDigits(trimmed)) go(`/dashboard/ticker/manager/${trimmed}`)
    else if (looksLikeTicker(trimmed)) go(`/dashboard/ticker/${trimmed.toUpperCase()}`)
    // A name needs a dropdown match to resolve to a filer id.
  }

  const hasSecResults = results.tickers.length || results.institutions.length || results.etfs.length || results.politicians.length
  const hasYahooResults = yahooResults.length > 0
  const hasResults = dataSource === 'yahoo' ? hasYahooResults : hasSecResults

  return (
    <div className="relative w-56 sm:w-64 md:w-72" ref={containerRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-8 text-sm"
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSubmit()
            if (event.key === 'Escape') setOpen(false)
          }}
          placeholder={dataSource === 'yahoo' ? 'Search ticker…' : 'Search ticker, CIK…'}
          value={query}
        />
      </div>

      {open && query ? (
        <div className="absolute left-0 z-40 mt-1 max-h-96 w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-lg border bg-popover p-1 shadow-lg">
          {!hasResults ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {dataSource === 'yahoo'
                ? 'No matches. Press Enter to fetch this ticker from Yahoo Finance.'
                : 'No matches. Press Enter to fetch a new ticker or CIK.'}
            </p>
          ) : null}

          {dataSource === 'yahoo'
            ? yahooResults.map((item) => (
                <ResultRow
                  key={`y-${item.ticker}`}
                  onClick={() => go(`/dashboard/yahoo/${item.ticker}${item.savedAt ? '?source=saved' : ''}`)}
                  // Line 1: company name · Line 2: symbol · exchange · type
                  primary={item.companyName || item.ticker}
                  secondary={[item.ticker, item.exchange, item.quoteType].filter(Boolean).join(' · ')}
                  savedAt={item.savedAt}
                />
              ))
            : null}

          {dataSource === 'sec' ? (
            <>
              {results.tickers.map((item) => (
                <ResultRow
                  key={`t-${item.ticker}`}
                  onClick={() => go(`/dashboard/ticker/${item.ticker}${item.savedAt ? '?source=saved' : ''}`)}
                  primary={item.companyName || item.label}
                  secondary={[item.ticker || item.label, 'SEC'].filter(Boolean).join(' · ')}
                  savedAt={item.savedAt}
                />
              ))}
              {results.institutions.map((item) => (
                <ResultRow
                  key={`i-${item.cik}`}
                  onClick={() => go(`/dashboard/ticker/manager/${item.cik}${item.savedAt ? '?source=saved' : ''}`)}
                  primary={item.label}
                  secondary={`CIK ${item.cik} · Institution`}
                  savedAt={item.savedAt}
                />
              ))}
              {results.etfs.map((item) => (
                <ResultRow
                  key={`e-${item.cik}`}
                  onClick={() => go(`/dashboard/ticker/manager/${item.cik}${item.savedAt ? '?source=saved' : ''}`)}
                  primary={item.label}
                  secondary={`CIK ${item.cik} · ETF / Fund`}
                  savedAt={item.savedAt}
                />
              ))}
              {results.politicians.map((item) => (
                <ResultRow
                  key={`p-${item.filerId}`}
                  onClick={() => go(`/dashboard/ticker/politician/${item.filerId}${item.savedAt ? '?source=saved' : ''}`)}
                  primary={item.fullName}
                  secondary="Politician"
                  savedAt={item.savedAt}
                />
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ResultRow({
  primary,
  secondary,
  savedAt,
  onClick,
}: {
  primary: string
  secondary?: string | null
  savedAt: string | null
  onClick: () => void
}) {
  return (
    <button className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={onClick} type="button">
      <span className="flex min-w-0 items-start gap-2">
        {savedAt ? (
          <SavedBadge />
        ) : (
          <span className="mt-0.5 size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/40" title="Not saved yet" />
        )}
        <span className="min-w-0">
          <span className="block truncate font-medium leading-snug">{primary}</span>
          {secondary ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span> : null}
        </span>
      </span>
      {savedAt ? <span className="shrink-0 self-center text-xs text-muted-foreground">{formatTimestamp(savedAt)}</span> : null}
    </button>
  )
}
