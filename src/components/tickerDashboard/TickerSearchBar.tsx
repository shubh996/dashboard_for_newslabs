import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { searchSaved } from '@/services/edgarApi'
import type { PoliticianSearchResult, SearchResultItem, SearchResults } from '@/types/edgar'
import { formatTimestamp, SavedBadge } from './shared'

const emptyResults: SearchResults = { tickers: [], institutions: [], etfs: [], politicians: [] }

function isAllDigits(value: string) {
  return /^\d+$/.test(value)
}

function looksLikeTicker(value: string) {
  return /^[A-Za-z.-]{1,6}$/.test(value)
}

export function TickerSearchBar() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(emptyResults)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      searchSaved(query)
        .then(setResults)
        .catch(() => setResults(emptyResults))
    }, 200)
    return () => clearTimeout(timer)
  }, [query, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  function close() {
    setOpen(false)
    setQuery('')
  }

  function goToTicker(item: SearchResultItem) {
    close()
    // Only open saved mode when this ticker actually has a Supabase snapshot.
    navigate(`/dashboard/ticker/${item.ticker}${item.savedAt ? '?source=saved' : ''}`)
  }

  function goToManager(item: SearchResultItem) {
    close()
    navigate(`/dashboard/ticker/manager/${item.cik}${item.savedAt ? '?source=saved' : ''}`)
  }

  function goToPolitician(item: PoliticianSearchResult) {
    close()
    navigate(`/dashboard/ticker/politician/${item.filerId}${item.savedAt ? '?source=saved' : ''}`)
  }

  function handleSubmit() {
    const trimmed = query.trim()
    if (!trimmed) return
    if (isAllDigits(trimmed)) {
      close()
      navigate(`/dashboard/ticker/manager/${trimmed}`)
    } else if (looksLikeTicker(trimmed)) {
      close()
      navigate(`/dashboard/ticker/${trimmed.toUpperCase()}`)
    }
    // A name needs a dropdown match -- there's no way to "fresh fetch" a
    // politician without first resolving name -> filer id.
  }

  const hasResults =
    results.tickers.length || results.institutions.length || results.etfs.length || results.politicians.length

  return (
    <>
      <button
        className="flex h-8 w-56 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-sm text-muted-foreground transition-colors hover:border-ring"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search className="size-3.5" />
        Search saved data…
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/60 p-4 pt-[8vh] backdrop-blur-sm" onClick={close}>
          <div className="w-full max-w-4xl rounded-xl border bg-popover shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="relative border-b p-3">
              <Search className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 pl-9 text-base"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSubmit()
                }}
                placeholder="Search ticker, CIK, or politician name…"
                ref={inputRef}
                value={query}
              />
              <button
                className="absolute right-6 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted"
                onClick={close}
                title="Close"
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="grid max-h-[65vh] grid-cols-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2">
              <ResultGroup label="Tickers" items={results.tickers}>
                {results.tickers.map((item) => (
                  <ResultRow
                    key={item.ticker}
                    onClick={() => goToTicker(item)}
                    primary={item.companyName ? `${item.ticker} — ${item.companyName}` : item.label}
                    savedAt={item.savedAt}
                  />
                ))}
              </ResultGroup>

              <ResultGroup label="Institutions" items={results.institutions}>
                {results.institutions.map((item) => (
                  <ResultRow key={item.cik} onClick={() => goToManager(item)} primary={item.label} savedAt={item.savedAt} />
                ))}
              </ResultGroup>

              <ResultGroup label="ETFs / Fund Managers" items={results.etfs}>
                {results.etfs.map((item) => (
                  <ResultRow key={item.cik} onClick={() => goToManager(item)} primary={item.label} savedAt={item.savedAt} />
                ))}
              </ResultGroup>

              <ResultGroup label="Politicians" items={results.politicians}>
                {results.politicians.map((item) => (
                  <ResultRow key={item.filerId} onClick={() => goToPolitician(item)} primary={item.fullName} savedAt={item.savedAt} />
                ))}
              </ResultGroup>

              {!hasResults ? <p className="col-span-full py-6 text-center text-sm text-muted-foreground">No matches.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function ResultGroup({ label, items, children }: { label: string; items: unknown[]; children: React.ReactNode }) {
  if (!items.length) return null
  return (
    <div className="rounded-lg border">
      <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        {label} ({items.length})
      </div>
      <div className="max-h-64 overflow-y-auto p-1">{children}</div>
    </div>
  )
}

function ResultRow({ primary, savedAt, onClick }: { primary: string; savedAt: string | null; onClick: () => void }) {
  return (
    <button
      className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted"
      onClick={onClick}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {savedAt ? <SavedBadge /> : null}
        <span className="truncate">{primary}</span>
      </span>
      {savedAt ? <span className="shrink-0 text-xs text-muted-foreground">{formatTimestamp(savedAt)}</span> : null}
    </button>
  )
}
