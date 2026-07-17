import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Database, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CongressTradingSection } from '@/components/tickerDashboard/CongressTradingSection'
import { ProxyStatementSection } from '@/components/tickerDashboard/ProxyStatementSection'
import {
  formatTimestamp,
  SavedBadge,
  SectionError,
  SectionLoading,
} from '@/components/tickerDashboard/shared'
import { SourceBadge } from '@/components/tickerDashboard/SourceBadge'
import { YahooModuleProgress } from '@/components/yahoo/YahooModuleProgress'
import {
  isYahooFundInstrument,
  YahooAnalystSection,
  YahooDividendSection,
  YahooEarningsSection,
  YahooEtfSection,
  YahooFilingsNewsSection,
  YahooFinancialsSection,
  YahooHistoricalSection,
  YahooInsightsSection,
  YahooInsiderSection,
  YahooOptionsSection,
  YahooOverviewSection,
  YahooOwnershipSection,
  YahooProfileSection,
  YahooQuoteSection,
  YahooRawJsonSection,
  YahooValuationSection,
} from '@/components/yahoo/YahooDataSections'
import { useBottomToast } from '@/components/ui/bottom-toast'
import { useEdgarSection } from '@/hooks/useEdgarSection'
import { getCongressTrading, getProxyStatement } from '@/services/edgarApi'
import {
  getSavedYahooTicker,
  listYahooModules,
  refreshYahooSnapshot,
  saveYahooSnapshot,
  streamYahooTicker,
} from '@/services/yahooApi'
import type {
  YahooStructuredData,
  YahooTickerBundle,
  YahooUnitCatalogueItem,
  YahooUnitProgress,
} from '@/types/yahoo'
import { cn } from '@/lib/utils'

export type YahooTickerDashboardProps = {
  /** When set (e.g. Market panel), overrides the route param. */
  symbol?: string
  /** Compact layout for embedding inside the news app Market column. */
  embedded?: boolean
  /**
   * Prefer Supabase snapshot when present, else live-stream Yahoo modules.
   * Defaults to true when embedded; on the route page follows `?source=saved`.
   */
  preferSaved?: boolean
  className?: string
  /**
   * Notify parent (news Market / ticker chips) so green “saved in Supabase”
   * indicators update in the same session right after Save / Refresh.
   */
  onSavedChange?: (ticker: string, saved: boolean) => void
}

export default function YahooTickerDashboard({
  symbol: symbolProp,
  embedded = false,
  preferSaved,
  className,
  onSavedChange,
}: YahooTickerDashboardProps = {}) {
  const { symbol: routeSymbol = '' } = useParams<{ symbol: string }>()
  const ticker = (symbolProp || routeSymbol || '').toUpperCase()
  const navigate = useNavigate()
  const { toast } = useBottomToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlSavedOnly = searchParams.get('source') === 'saved'
  // Embedded Market: load saved snapshot first when available (database dashboard UX).
  // Route page: only when ?source=saved; otherwise live stream.
  const wantSavedFirst =
    preferSaved !== undefined ? preferSaved : embedded ? true : urlSavedOnly

  const [catalogue, setCatalogue] = useState<YahooUnitCatalogueItem[]>([])
  const [progress, setProgress] = useState<Record<string, YahooUnitProgress>>({})
  const [bundle, setBundle] = useState<YahooTickerBundle | null>(null)
  const [structured, setStructured] = useState<YahooStructuredData | null>(null)
  const [rawJson, setRawJson] = useState<Record<string, unknown>>({})
  const [moduleStatus, setModuleStatus] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  /** Transparent load stages for the user-facing status banner. */
  const [loadPhase, setLoadPhase] = useState<'idle' | 'supabase' | 'yahoo'>('idle')
  const [loadDetail, setLoadDetail] = useState('')
  const unitOrderRef = useRef<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [fromSaved, setFromSaved] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  /** Saved snapshots always land on Overview; live first-time fetch may use Citation for progress. */
  const [activeTab, setActiveTab] = useState('overview')

  // Same SEC/local sections as the EDGAR ticker page — loaded independently
  // so Yahoo module failures never block them (and vice versa).
  const congress = useEdgarSection(
    `yahoo-page-congress:${ticker}`,
    () => getCongressTrading(ticker),
    'Failed to load congressional trading data',
  )
  const congressData = congress.data?.data ?? null

  const proxy = useEdgarSection(
    `yahoo-page-proxy:${ticker}`,
    () => getProxyStatement(ticker),
    'Failed to load proxy statement',
  )
  const proxyData = proxy.data?.data ?? null

  // Catalogue once — drives the progress grid labels.
  useEffect(() => {
    listYahooModules()
      .then((body) => setCatalogue(body.units || []))
      .catch(() => setCatalogue([]))
  }, [])

  useEffect(() => {
    if (!ticker) {
      setLoading(false)
      setError('No ticker selected')
      return
    }

    let cancelled = false
    let stopStream: (() => void) | undefined

    setLoading(true)
    setError(null)
    setProgress({})
    setBundle(null)
    setStructured(null)
    setRawJson({})
    setModuleStatus({})
    setFromSaved(false)
    setSavedAt(null)
    unitOrderRef.current = []
    // Live stream starts on Citation so user sees module blink; saved path stays Overview.
    setActiveTab(wantSavedFirst ? 'overview' : 'citation')

    function startStream(opts?: { afterSupabaseMiss?: boolean }) {
      setLoadPhase('yahoo')
      setLoadDetail(
        opts?.afterSupabaseMiss
          ? `Not in Supabase — starting Yahoo Finance fetch for ${ticker}…`
          : `Fetching Yahoo Finance modules for ${ticker}…`,
      )

      // Also check whether a prior save exists (for button label) without switching mode.
      if (!opts?.afterSupabaseMiss) {
        getSavedYahooTicker(ticker)
          .then((saved) => {
            if (cancelled) return
            if (saved) {
              setSavedAt(saved.updatedAt || saved.createdAt)
              onSavedChange?.(ticker, true)
            }
          })
          .catch(() => {
            /* ignore */
          })
      }

      stopStream = streamYahooTicker(ticker, {
        onStart: (payload) => {
          if (cancelled) return
          const units = payload.units || []
          if (units.length) setCatalogue(units)
          unitOrderRef.current = units.map((unit) => unit.id)
          const pending: Record<string, YahooUnitProgress> = {}
          units.forEach((unit, index) => {
            pending[unit.id] = {
              unitId: unit.id,
              label: unit.label,
              group: unit.group,
              status: index === 0 ? 'loading' : 'pending',
            }
          })
          setProgress(pending)
          const first = units[0]
          setLoadDetail(
            first
              ? `Yahoo Finance — now fetching: ${first.label}`
              : `Fetching Yahoo Finance modules for ${ticker}…`,
          )
        },
        onUnit: (unit) => {
          if (cancelled) return
          let activeLabel = unit.label
          setProgress((prev) => {
            const next: Record<string, YahooUnitProgress> = {
              ...prev,
              [unit.unitId]: {
                unitId: unit.unitId,
                label: unit.label,
                group: unit.group,
                status: unit.status === 'pending' ? 'loading' : unit.status,
                error: unit.error,
                moduleStatus: unit.moduleStatus,
              },
            }
            // Next pending unit becomes the active “now fetching” blink target.
            const ordered = unitOrderRef.current
            const nextPendingId = ordered.find((id) => {
              const status = next[id]?.status
              return id !== unit.unitId && (status === 'pending' || !status)
            })
            if (nextPendingId && next[nextPendingId]) {
              next[nextPendingId] = { ...next[nextPendingId], status: 'loading' }
              activeLabel = next[nextPendingId].label || activeLabel
            } else if (unit.status === 'loading' || unit.status === 'pending') {
              activeLabel = unit.label
            } else {
              // This unit finished and nothing pending — keep last label until complete.
              const stillLoading = ordered
                .map((id) => next[id])
                .find((row) => row?.status === 'loading')
              if (stillLoading?.label) activeLabel = stillLoading.label
            }
            return next
          })

          const finished =
            unit.status === 'success' || unit.status === 'empty' || unit.status === 'error'
          if (unit.status === 'loading' || unit.status === 'pending') {
            setLoadDetail(`Yahoo Finance — now fetching: ${unit.label}`)
          } else if (finished) {
            const resultWord =
              unit.status === 'success' ? 'done' : unit.status === 'empty' ? 'no data' : 'failed'
            if (activeLabel && activeLabel !== unit.label) {
              setLoadDetail(
                `Yahoo Finance — ${unit.label} ${resultWord}. Now fetching: ${activeLabel}`,
              )
            } else {
              setLoadDetail(
                `Yahoo Finance — ${unit.label} ${resultWord}. Wrapping up remaining modules…`,
              )
            }
          }

          if (unit.raw) {
            setRawJson((prev) => ({ ...prev, ...unit.raw }))
          }
        },
        onComplete: (full) => {
          if (cancelled) return
          setBundle(full)
          setStructured(full.data)
          setRawJson(full.raw_json || {})
          setModuleStatus(full.module_status || {})
          setFromSaved(false)
          setLoadPhase('idle')
          setLoadDetail('')
          // After a successful live fetch, open Overview (progress was on Citation during load).
          setActiveTab('overview')
          setLoading(false)
        },
        onError: (message) => {
          if (cancelled) return
          setError(message)
          setLoadPhase('idle')
          setLoadDetail('')
          setLoading(false)
        },
      })
    }

    if (wantSavedFirst) {
      setLoadPhase('supabase')
      setLoadDetail(`Searching for ${ticker} on Supabase…`)
      getSavedYahooTicker(ticker)
        .then((saved) => {
          if (cancelled) return
          if (saved?.data) {
            setStructured(saved.data)
            setRawJson(saved.rawJson || {})
            setModuleStatus(saved.moduleStatus || {})
            setSavedAt(saved.updatedAt || saved.createdAt)
            setFromSaved(true)
            setActiveTab('overview')
            setLoadPhase('idle')
            setLoadDetail('')
            setLoading(false)
            onSavedChange?.(ticker, true)
            return
          }
          // Route page with ?source=saved and nothing stored → hard error.
          // Embedded / preferSaved soft-fallback: live stream instead.
          if (urlSavedOnly && !embedded) {
            setError('No saved Yahoo Finance snapshot for this ticker. Refresh to fetch live data.')
            setLoadPhase('idle')
            setLoadDetail('')
            setLoading(false)
            return
          }
          startStream({ afterSupabaseMiss: true })
        })
        .catch((err: unknown) => {
          if (cancelled) return
          if (urlSavedOnly && !embedded) {
            setError(err instanceof Error ? err.message : 'Failed to load saved Yahoo Finance snapshot')
            setLoadPhase('idle')
            setLoadDetail('')
            setLoading(false)
            return
          }
          startStream({ afterSupabaseMiss: true })
        })
    } else {
      startStream()
    }

    return () => {
      cancelled = true
      stopStream?.()
    }
  }, [ticker, wantSavedFirst, urlSavedOnly, embedded])

  // When catalogue arrives after a saved load, fill progress labels.
  useEffect(() => {
    if (!fromSaved || !catalogue.length) return
    setProgress((prev) => {
      if (Object.keys(prev).length) return prev
      const reconstructed: Record<string, YahooUnitProgress> = {}
      for (const unit of catalogue) {
        reconstructed[unit.id] = {
          unitId: unit.id,
          label: unit.label,
          group: unit.group,
          status: 'success',
        }
      }
      return reconstructed
    })
  }, [catalogue, fromSaved])

  const companyName = structured?.companyName || undefined
  const isFund = useMemo(() => isYahooFundInstrument(structured), [structured])
  const etfTabLabel =
    structured?.isEtf || String(structured?.quoteType || '').toUpperCase() === 'ETF'
      ? 'ETF / Fund'
      : 'Fund'

  const canSave = useMemo(() => Boolean(structured && Object.keys(rawJson).length), [structured, rawJson])

  async function handleSave() {
    if (!structured) return
    setSaveState('saving')
    setSaveError('')
    try {
      const snapshot = await saveYahooSnapshot(ticker, {
        data: structured,
        rawJson,
        moduleStatus,
        sourceMetadata: {
          source: 'yahoo-finance',
          fetchedAt: bundle?.fetchedAt || new Date().toISOString(),
          units: bundle?.units,
        },
      })
      setSavedAt(snapshot.updatedAt || snapshot.createdAt)
      setFromSaved(true)
      setSaveState('saved')
      onSavedChange?.(ticker, true)
      toast({
        title: `${ticker} saved`,
        description: 'Yahoo Finance snapshot stored in Supabase (yahoo_finance_snapshots).',
      })
      setTimeout(() => setSaveState('idle'), 3000)
    } catch (err) {
      setSaveState('error')
      const message = err instanceof Error ? err.message : 'Failed to save'
      setSaveError(message)
      toast({ title: `${ticker} save failed`, description: message, variant: 'destructive' })
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    setError(null)
    setLoading(true)
    setProgress({})
    setLoadPhase('yahoo')
    setLoadDetail(`Yahoo Finance — refreshing all modules for ${ticker}…`)
    toast({
      title: `Refreshing ${ticker}`,
      description: 'Fetching all Yahoo Finance modules, then saving to Supabase…',
    })
    try {
      // Clear saved mode so we show live progress after refresh.
      if (urlSavedOnly) setSearchParams({})
      const result = await refreshYahooSnapshot(ticker)
      setBundle(result.bundle)
      setStructured(result.bundle.data)
      setRawJson(result.bundle.raw_json || {})
      setModuleStatus(result.bundle.module_status || {})
      setSavedAt(result.snapshot.updatedAt || result.snapshot.createdAt)
      setFromSaved(true)
      setActiveTab('overview')
      onSavedChange?.(ticker, true)
      toast({
        title: `${ticker} refreshed`,
        description: 'Live Yahoo data loaded and snapshot updated in Supabase.',
      })
      const nextProgress: Record<string, YahooUnitProgress> = {}
      for (const unit of result.bundle.units || []) {
        nextProgress[unit.unitId] = unit
      }
      setProgress(nextProgress)
      setLoadPhase('idle')
      setLoadDetail('')
      setLoading(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh from Yahoo Finance'
      setError(message)
      toast({ title: `${ticker} refresh failed`, description: message, variant: 'destructive' })
      setLoadPhase('idle')
      setLoadDetail('')
      setLoading(false)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div
      className={cn(
        embedded
          ? 'flex min-h-0 flex-1 flex-col'
          : 'mx-auto max-w-screen-2xl px-4 py-8 md:px-8',
        className,
      )}
    >
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
          embedded
            ? 'sticky top-0 z-20 shrink-0 px-3 py-2.5'
            : 'sticky top-0 z-30 -mx-4 mb-6 px-4 py-4 md:-mx-8 md:px-8',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {!embedded ? (
            <Button variant="outline" size="icon" onClick={() => navigate(-1)} title="Back">
              <ArrowLeft className="size-4" />
            </Button>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={cn('font-semibold tracking-tight', embedded ? 'text-base' : 'text-xl')}>
                {ticker || '—'}
              </h1>
              {savedAt ? <SavedBadge title="Saved Yahoo Finance snapshot" /> : null}
              {fromSaved ? <SourceBadge source="supabase" /> : <SourceBadge source="yahoo-finance" />}
            </div>
            {companyName ? (
              <p className={cn('truncate text-muted-foreground', embedded ? 'text-xs' : 'text-sm')}>
                {companyName}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {savedAt ? (
            <div className={cn('text-right text-muted-foreground', embedded ? 'text-[10px]' : 'text-xs')}>
              Saved on
              <br />
              {formatTimestamp(savedAt)}
            </div>
          ) : null}
          <Button
            disabled={refreshing || loading || !ticker}
            onClick={handleRefresh}
            size="sm"
            variant="outline"
          >
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {embedded ? 'Refresh' : 'Refresh from Yahoo Finance'}
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button
              disabled={!canSave || saveState === 'saving' || loading}
              onClick={handleSave}
              size="sm"
              variant="outline"
            >
              {saveState === 'saving' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : saveState === 'saved' ? (
                <Check className="size-4" />
              ) : (
                <Database className="size-4" />
              )}
              {saveState === 'saved' ? 'Saved' : savedAt ? (embedded ? 'Update' : 'Update Yahoo snapshot') : embedded ? 'Save' : 'Save to Supabase'}
            </Button>
            {saveError ? <span className="text-xs text-destructive">{saveError}</span> : null}
          </div>
        </div>
      </div>

      <div className={cn(embedded ? 'min-h-0 flex-1 overflow-auto px-3 pb-4 pt-3' : '')}>
        {error ? (
          <div className={cn(embedded ? 'mb-3' : 'mb-6')}>
            <SectionError message={error} />
          </div>
        ) : null}

        {/* Surface SEC/local side-channel failures even while viewing Yahoo tabs */}
        {!congress.loading && congress.error ? (
          <div className="mb-3">
            <SectionError message={`Congress (local STOCK Act / SEC side data): ${congress.error}`} />
          </div>
        ) : null}
        {!proxy.loading && proxy.error ? (
          <div className="mb-3">
            <SectionError message={`Proxy (SEC EDGAR DEF 14A): ${proxy.error}`} />
          </div>
        ) : null}

        {loading && !structured ? (
          <div className="mb-4 space-y-3">
            <div
              className={cn(
                'flex items-start gap-3 rounded-lg border px-3 py-3',
                loadPhase === 'supabase'
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-violet-500/30 bg-violet-500/10',
              )}
            >
              <Loader2
                className={cn(
                  'mt-0.5 size-4 shrink-0 animate-spin',
                  loadPhase === 'supabase' ? 'text-emerald-600 dark:text-emerald-400' : 'text-violet-500',
                )}
              />
              <div className="min-w-0 space-y-1">
                <p className="animate-pulse text-sm font-medium text-foreground">
                  {loadDetail ||
                    (loadPhase === 'supabase'
                      ? `Searching for ${ticker} on Supabase…`
                      : `Fetching Yahoo Finance modules for ${ticker}…`)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {loadPhase === 'supabase'
                    ? 'Looking up yahoo_finance_snapshots for a saved A–Z dashboard.'
                    : loadPhase === 'yahoo'
                      ? 'Live Yahoo Finance modules — each unit updates here as it finishes.'
                      : 'Loading…'}
                </p>
              </div>
            </div>
            {loadPhase === 'yahoo' && catalogue.length > 0 ? (
              <YahooModuleProgress
                catalogue={catalogue}
                progress={progress}
                loading
                embedded
              />
            ) : null}
          </div>
        ) : null}

        {/* Saved data → stay on Overview (progress lives there). Live first-time fetch → Citation for progress. */}
        {structured || loading || catalogue.length > 0 ? (
          <Tabs
            key={ticker}
            value={activeTab}
            onValueChange={setActiveTab}
            className={cn(embedded ? 'gap-4' : 'gap-6')}
          >
            <div
              className={cn(
                embedded &&
                  'sticky top-0 z-10 -mx-3 border-b bg-background/95 px-3 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80',
              )}
            >
              <TabsList variant="line" className="h-auto w-full flex-wrap justify-start">
                <TabsTrigger value="overview" disabled={!structured}>
                  Overview
                </TabsTrigger>
                <TabsTrigger value="quote" disabled={!structured}>
                  Quote
                </TabsTrigger>
                {isFund ? (
                  <TabsTrigger value="etf" disabled={!structured}>
                    {etfTabLabel}
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="research" disabled={!structured}>
                  Research & Outlook
                </TabsTrigger>
                <TabsTrigger value="profile" disabled={!structured}>
                  Profile
                </TabsTrigger>
                <TabsTrigger value="valuation" disabled={!structured}>
                  Valuation
                </TabsTrigger>
                {!isFund ? (
                  <TabsTrigger value="financials" disabled={!structured}>
                    Financials
                  </TabsTrigger>
                ) : null}
                {!isFund ? (
                  <TabsTrigger value="earnings" disabled={!structured}>
                    Earnings
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="dividend" disabled={!structured}>
                  Dividend
                </TabsTrigger>
                {!isFund ? (
                  <TabsTrigger value="analyst" disabled={!structured}>
                    Analyst
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="ownership" disabled={!structured}>
                  Ownership
                </TabsTrigger>
                {!isFund ? (
                  <TabsTrigger value="insider" disabled={!structured}>
                    Insider
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="congress" disabled={!structured}>
                  Congress
                </TabsTrigger>
                {!isFund ? (
                  <TabsTrigger value="proxy" disabled={!structured}>
                    Proxy
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="historical" disabled={!structured}>
                  Historical
                </TabsTrigger>
                <TabsTrigger value="options" disabled={!structured}>
                  Options
                </TabsTrigger>
                <TabsTrigger value="filings" disabled={!structured}>
                  Filings & News
                </TabsTrigger>
                <TabsTrigger value="citation">Citation</TabsTrigger>
              </TabsList>
            </div>

            {structured ? (
              <>
                <TabsContent value="overview" className="space-y-6">
                  <YahooOverviewSection data={structured} />
                  {/*
                    Module status on Overview when data is (or was) in Supabase, or after load finishes.
                    Pure live first-time fetch while still running stays on Citation only.
                  */}
                  {(fromSaved || savedAt || !loading) && catalogue.length > 0 ? (
                    <section className="space-y-3">
                      <div>
                        <h2 className="text-base font-semibold tracking-tight">Module fetch progress</h2>
                        <p className="text-sm text-muted-foreground">
                          {fromSaved || savedAt
                            ? `Yahoo Finance units stored for ${ticker}${savedAt ? ` · saved ${formatTimestamp(savedAt)}` : ''}.`
                            : `Yahoo Finance units loaded for ${ticker}.`}
                        </p>
                      </div>
                      <YahooModuleProgress
                        catalogue={catalogue}
                        progress={progress}
                        loading={false}
                        embedded
                      />
                    </section>
                  ) : null}
                </TabsContent>
                <TabsContent value="quote">
                  <YahooQuoteSection data={structured} />
                </TabsContent>
                {isFund ? (
                  <TabsContent value="etf">
                    <YahooEtfSection data={structured} />
                  </TabsContent>
                ) : null}
                <TabsContent value="research">
                  <YahooInsightsSection data={structured} />
                </TabsContent>
                <TabsContent value="profile">
                  <YahooProfileSection data={structured} />
                </TabsContent>
                <TabsContent value="valuation">
                  <YahooValuationSection data={structured} />
                </TabsContent>
                {!isFund ? (
                  <TabsContent value="financials">
                    <YahooFinancialsSection data={structured} />
                  </TabsContent>
                ) : null}
                {!isFund ? (
                  <TabsContent value="earnings">
                    <YahooEarningsSection data={structured} />
                  </TabsContent>
                ) : null}
                <TabsContent value="dividend">
                  <YahooDividendSection data={structured} />
                </TabsContent>
                {!isFund ? (
                  <TabsContent value="analyst">
                    <YahooAnalystSection data={structured} />
                  </TabsContent>
                ) : null}
                <TabsContent value="ownership">
                  <YahooOwnershipSection data={structured} />
                </TabsContent>
                {!isFund ? (
                  <TabsContent value="insider">
                    <YahooInsiderSection data={structured} />
                  </TabsContent>
                ) : null}
                <TabsContent value="congress" className="min-w-0 flex-1 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceBadge source="local" />
                    <span className="text-xs text-muted-foreground">
                      Same STOCK Act dataset as the SEC ticker page — not from Yahoo Finance.
                    </span>
                  </div>
                  {congress.loading ? (
                    <SectionLoading label={`Loading local STOCK Act congressional trade data for ${ticker}…`} />
                  ) : null}
                  {congress.error ? (
                    <SectionError message={`SEC / local Congress error: ${congress.error}`} />
                  ) : null}
                  {!congress.loading && !congress.error && congressData ? (
                    <CongressTradingSection data={congressData} />
                  ) : null}
                  {!congress.loading && !congress.error && !congressData ? (
                    <SectionError message={`No congressional trading data returned for ${ticker}.`} />
                  ) : null}
                </TabsContent>
                {!isFund ? (
                  <TabsContent value="proxy" className="min-w-0 flex-1 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceBadge source="sec" />
                      <span className="text-xs text-muted-foreground">
                        Same SEC EDGAR proxy (DEF 14A) as the SEC ticker page — not from Yahoo Finance.
                      </span>
                    </div>
                    {proxy.loading ? (
                      <SectionLoading
                        label={`Finding ${ticker}'s latest DEF 14A and parsing compensation tables…`}
                      />
                    ) : null}
                    {proxy.error ? <SectionError message={`SEC EDGAR proxy error: ${proxy.error}`} /> : null}
                    {!proxy.loading && !proxy.error && proxyData ? (
                      <ProxyStatementSection data={proxyData} />
                    ) : null}
                    {!proxy.loading && !proxy.error && !proxyData ? (
                      <SectionError message={`No proxy statement data returned for ${ticker}.`} />
                    ) : null}
                  </TabsContent>
                ) : null}
                <TabsContent value="historical">
                  <YahooHistoricalSection data={structured} />
                </TabsContent>
                <TabsContent value="options">
                  <YahooOptionsSection data={structured} />
                </TabsContent>
                <TabsContent value="filings">
                  <YahooFilingsNewsSection data={structured} />
                </TabsContent>
              </>
            ) : null}

            {/* Citation: live-fetch progress when not saved yet; sources + raw always */}
            <TabsContent value="citation" className="space-y-8">
              {/* Live first-time fetch only — saved snapshots show this block on Overview instead. */}
              {!fromSaved && !savedAt ? (
                <section className="space-y-3">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">Module fetch progress</h2>
                    <p className="text-sm text-muted-foreground">
                      Live status of each Yahoo Finance unit fetched for {ticker}.
                    </p>
                  </div>
                  <YahooModuleProgress
                    catalogue={catalogue}
                    progress={progress}
                    loading={loading}
                    embedded
                  />
                </section>
              ) : null}

              <section className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Where this data comes from</h2>
                  <p className="text-sm text-muted-foreground">
                    {fromSaved
                      ? 'Yahoo snapshot from Supabase (yahoo_finance_snapshots). Congress + Proxy still load from local STOCK Act / SEC EDGAR. SEC ticker snapshots are never modified.'
                      : 'Most sections are live Yahoo Finance via yahoo-finance2. Congress uses the local STOCK Act dataset; Proxy uses SEC EDGAR DEF 14A (same as the SEC ticker page).'}
                  </p>
                </div>
                <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                          Section
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                          Source
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                          Details
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          [
                            'Overview',
                            'yahoo-finance',
                            isFund
                              ? 'quote + fund snapshot (AUM, NAV, yield, expense) + chart'
                              : 'quote + profile + targets + ownership snapshot + chart',
                          ],
                          ['Quote', 'yahoo-finance', 'quote, summaryDetail, price'],
                          ...(isFund
                            ? ([
                                [
                                  'ETF / Fund',
                                  'yahoo-finance',
                                  'fundProfile, topHoldings, fundPerformance',
                                ],
                              ] as const)
                            : ([] as const)),
                          [
                            'Research & Outlook',
                            'yahoo-finance',
                            'insights (technicals, research reports, bullish/bearish, sigDevs)',
                          ],
                          ['Profile', 'yahoo-finance', 'assetProfile, summaryProfile'],
                          [
                            'Valuation & ratios',
                            'yahoo-finance',
                            'defaultKeyStatistics, financialData, summaryDetail',
                          ],
                          ...(!isFund
                            ? ([
                                [
                                  'Financials',
                                  'yahoo-finance',
                                  'fundamentalsTimeSeries + statement history modules',
                                ],
                                [
                                  'Earnings',
                                  'yahoo-finance',
                                  'next earnings, earningsHistory, earningsTrend',
                                ],
                                [
                                  'Analyst',
                                  'yahoo-finance',
                                  'recommendationTrend, upgradeDowngradeHistory, financialData targets',
                                ],
                              ] as const)
                            : ([] as const)),
                          [
                            'Dividend',
                            'yahoo-finance',
                            'summaryDetail yield/rate/payout · calendar ex/payment dates · chart dividend events',
                          ],
                          [
                            'Ownership',
                            'yahoo-finance',
                            'majorHoldersBreakdown, institutionOwnership, fundOwnership',
                          ],
                          ...(!isFund
                            ? ([
                                [
                                  'Insider',
                                  'yahoo-finance',
                                  'insiderHolders, insiderTransactions, netSharePurchaseActivity',
                                ],
                              ] as const)
                            : ([] as const)),
                          [
                            'Congress',
                            'local',
                            `GET /api/edgar/${ticker}/congress-trades · server/data/congress/ticker/${ticker}.json`,
                          ],
                          ...(!isFund
                            ? ([
                                [
                                  'Proxy',
                                  'sec',
                                  `GET /api/edgar/${ticker}/proxy-statement · latest DEF 14A from SEC EDGAR`,
                                ],
                              ] as const)
                            : ([] as const)),
                          ['Historical', 'yahoo-finance', 'chart (prices, dividends, splits)'],
                          ['Options', 'yahoo-finance', 'options'],
                          [
                            'Filings & news',
                            'yahoo-finance',
                            'secFilings, search, recommendationsBySymbol',
                          ],
                        ] as const
                      ).map(([section, source, details]) => (
                        <tr key={section} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{section}</td>
                          <td className="px-3 py-2">
                            {source === 'local' ? (
                              <SourceBadge source="local" />
                            ) : source === 'sec' ? (
                              <SourceBadge source="sec" />
                            ) : fromSaved ? (
                              <SourceBadge source="supabase" />
                            ) : (
                              <SourceBadge source="yahoo-finance" />
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {source === 'local' || source === 'sec'
                              ? details
                              : fromSaved
                                ? `yahoo_finance_snapshots · ${formatTimestamp(savedAt)}`
                                : details}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Raw JSON</h2>
                  <p className="text-sm text-muted-foreground">
                    Complete Yahoo response, module status map, and structured UI projection.
                  </p>
                </div>
                {Object.keys(rawJson).length || structured ? (
                  <YahooRawJsonSection
                    rawJson={rawJson}
                    moduleStatus={moduleStatus}
                    structured={structured}
                  />
                ) : (
                  <SectionLoading
                    label={
                      loading
                        ? 'Raw JSON will appear here as modules finish fetching…'
                        : 'No raw JSON available for this ticker yet.'
                    }
                  />
                )}
              </section>
            </TabsContent>
          </Tabs>
        ) : null}
      </div>
    </div>
  )
}
