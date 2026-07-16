import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AnalystSection } from '@/components/tickerDashboard/AnalystSection'
import { CompanyProfileSection } from '@/components/tickerDashboard/CompanyProfileSection'
import { CongressTradingSection } from '@/components/tickerDashboard/CongressTradingSection'
import { FinancialsSection } from '@/components/tickerDashboard/FinancialsSection'
import { InsiderTransactionsSection } from '@/components/tickerDashboard/InsiderTransactionsSection'
import { InstitutionalHoldingsSection } from '@/components/tickerDashboard/InstitutionalHoldingsSection'
import { LatestReportsSection } from '@/components/tickerDashboard/LatestReportsSection'
import { ProxyStatementSection } from '@/components/tickerDashboard/ProxyStatementSection'
import { RecentFilingsSection } from '@/components/tickerDashboard/RecentFilingsSection'
import { SaveToSupabaseButton } from '@/components/tickerDashboard/SaveToSupabaseButton'
import { SectionCard, SectionError, SectionLoading, formatTimestamp } from '@/components/tickerDashboard/shared'
import { TickerDashboardHeader } from '@/components/tickerDashboard/TickerDashboardHeader'
import { useEdgarSection } from '@/hooks/useEdgarSection'
import {
  getAnalystData,
  getCompanyProfile,
  getCongressTrading,
  getFinancials,
  getInsiderTransactions,
  getInstitutionalHoldings,
  getLatestReports,
  getProxyStatement,
  getRecentFilings,
  getSavedTicker,
} from '@/services/edgarApi'
import type { WithSteps } from '@/services/edgarApi'
import type { TickerDashboardBundle } from '@/types/edgar'

export default function TickerDashboard() {
  const { symbol = '' } = useParams<{ symbol: string }>()
  const ticker = symbol.toUpperCase()
  const [searchParams, setSearchParams] = useSearchParams()
  const savedMode = searchParams.get('source') === 'saved'
  const [savedAtOverride, setSavedAtOverride] = useState<string | null>(null)

  // Always checked (regardless of mode) so the Save/Update button label and
  // timestamp are correct even when arriving via a live fetch; in saved mode
  // this IS the page's data source, so the other section fetchers below stay
  // dormant (their key includes `savedMode` so flipping modes re-triggers them).
  const saved = useEdgarSection(`saved:${ticker}`, () => getSavedTicker(ticker), 'Failed to check saved snapshot')
  const savedBundle = saved.data?.data

  const liveFetch = <T,>(fetcher: () => Promise<WithSteps<T>>) =>
    savedMode ? Promise.resolve({ data: null as T, steps: [] }) : fetcher()

  const profile = useEdgarSection(`profile:${ticker}:${savedMode}`, () => liveFetch(() => getCompanyProfile(ticker)), 'Failed to load profile')
  const analyst = useEdgarSection(`analyst:${ticker}:${savedMode}`, () => liveFetch(() => getAnalystData(ticker)), 'Failed to load analyst data')
  const filings = useEdgarSection(`filings:${ticker}:${savedMode}`, () => liveFetch(() => getRecentFilings(ticker)), 'Failed to load filings')
  const latestReports = useEdgarSection(
    `latest-reports:${ticker}:${savedMode}`,
    () => liveFetch(() => getLatestReports(ticker)),
    'Failed to load latest reports',
  )
  const annualFinancials = useEdgarSection(
    `financials-annual:${ticker}:${savedMode}`,
    () => liveFetch(() => getFinancials(ticker, 'annual')),
    'Failed to load annual financials',
  )
  const quarterlyFinancials = useEdgarSection(
    `financials-quarterly:${ticker}:${savedMode}`,
    () => liveFetch(() => getFinancials(ticker, 'quarterly')),
    'Failed to load quarterly financials',
  )
  const insiderTransactions = useEdgarSection(
    `insider:${ticker}:${savedMode}`,
    () => liveFetch(() => getInsiderTransactions(ticker)),
    'Failed to load insider transactions',
  )
  const hedgeFundHoldings = useEdgarSection(
    `holdings-hedge-fund:${ticker}:${savedMode}`,
    () => liveFetch(() => getInstitutionalHoldings(ticker, 'hedge-fund')),
    'Failed to load hedge fund holdings',
  )
  const investmentFundHoldings = useEdgarSection(
    `holdings-investment-fund:${ticker}:${savedMode}`,
    () => liveFetch(() => getInstitutionalHoldings(ticker, 'investment-fund')),
    'Failed to load investment fund holdings',
  )
  const congressTrading = useEdgarSection(
    `congress:${ticker}:${savedMode}`,
    () => liveFetch(() => getCongressTrading(ticker)),
    'Failed to load congressional trading data',
  )
  const proxyStatement = useEdgarSection(
    `proxy:${ticker}:${savedMode}`,
    () => liveFetch(() => getProxyStatement(ticker)),
    'Failed to load proxy statement',
  )

  // Each section picks the saved-bundle field in saved mode, or its own live
  // fetch result otherwise -- same section components either way.
  const profileData = savedMode ? savedBundle?.profile ?? null : profile.data?.data ?? null
  const profileState = savedMode ? saved : profile
  const analystData = savedMode ? savedBundle?.analyst ?? null : analyst.data?.data ?? null
  const analystState = savedMode ? saved : analyst
  const filingsData = savedMode ? savedBundle?.filings ?? null : filings.data?.data ?? null
  const filingsState = savedMode ? saved : filings
  const latestReportsData = savedMode ? savedBundle?.latestReports ?? null : latestReports.data?.data ?? null
  const latestReportsState = savedMode ? saved : latestReports
  const annualFinancialsData = savedMode ? savedBundle?.financials ?? null : annualFinancials.data?.data ?? null
  const quarterlyFinancialsData = savedMode ? savedBundle?.quarterlyFinancials ?? null : quarterlyFinancials.data?.data ?? null
  const financialsLoading = savedMode ? saved.loading : annualFinancials.loading || quarterlyFinancials.loading
  const financialsError = savedMode ? saved.error : annualFinancials.error || quarterlyFinancials.error
  const insiderData = savedMode ? savedBundle?.insiderTransactions ?? null : insiderTransactions.data?.data ?? null
  const insiderState = savedMode ? saved : insiderTransactions
  const hedgeFundData = savedMode ? savedBundle?.hedgeFundHoldings ?? null : hedgeFundHoldings.data?.data ?? null
  const investmentFundData = savedMode ? savedBundle?.investmentFundHoldings ?? null : investmentFundHoldings.data?.data ?? null
  const institutionalLoading = savedMode ? saved.loading : hedgeFundHoldings.loading || investmentFundHoldings.loading
  const institutionalError = savedMode ? saved.error : hedgeFundHoldings.error || investmentFundHoldings.error
  const congressData = savedMode ? savedBundle?.congressTrading ?? null : congressTrading.data?.data ?? null
  const congressState = savedMode ? saved : congressTrading
  const proxyData = savedMode ? savedBundle?.proxyStatement ?? null : proxyStatement.data?.data ?? null
  const proxyState = savedMode ? saved : proxyStatement

  const sections: [string, keyof TickerDashboardBundle, unknown][] = [
    ['profile', 'profile', profileData],
    ['analyst', 'analyst', analystData],
    ['financials', 'financials', annualFinancialsData],
    ['quarterlyFinancials', 'quarterlyFinancials', quarterlyFinancialsData],
    ['latestReports', 'latestReports', latestReportsData],
    ['filings', 'filings', filingsData],
    ['insiderTransactions', 'insiderTransactions', insiderData],
    ['hedgeFundHoldings', 'hedgeFundHoldings', hedgeFundData],
    ['investmentFundHoldings', 'investmentFundHoldings', investmentFundData],
    ['proxyStatement', 'proxyStatement', proxyData],
    ['congressTrading', 'congressTrading', congressData],
  ]
  const loadedSections = sections.filter(([, , data]) => data != null).map(([label]) => label)
  const bundle: TickerDashboardBundle = {
    ticker,
    fetchedAt: new Date().toISOString(),
    ...Object.fromEntries(sections.filter(([, , data]) => data != null).map(([, key, data]) => [key, data])),
  }

  // In saved mode every tab renders from the SAME one Supabase row, not a
  // live SEC call -- the loading text says that plainly instead of
  // describing the live-fetch path that isn't actually happening.
  const savedAt = savedAtOverride ?? saved.data?.createdAt
  const savedTable = saved.data?.sourceTable || 'ticker_dashboard_snapshots'
  function loadingLabel(liveLabel: string) {
    return savedMode ? `Fetching saved ${ticker} snapshot from Supabase (table: ${savedTable})…` : liveLabel
  }

  // One row per section for the summary table at the bottom of the page --
  // exactly where each tab's data came from, without a per-tab accordion.
  // `source` defaults to 'sec' (SEC EDGAR); congress trading is a local
  // dataset and analyst data comes from Yahoo Finance, not a SEC filing.
  const sourceRows: { section: string; endpoint: string; source?: 'sec' | 'local' | 'yahoo' }[] = [
    { section: 'Profile', endpoint: `GET /api/edgar/${ticker}/profile` },
    { section: 'Analyst Ratings', endpoint: `GET /api/edgar/${ticker}/analyst`, source: 'yahoo' },
    { section: 'Financials', endpoint: `GET /api/edgar/${ticker}/financials` },
    { section: 'Filings', endpoint: `GET /api/edgar/${ticker}/filings` },
    { section: '10-K / 10-Q', endpoint: `GET /api/edgar/${ticker}/latest-reports` },
    { section: 'Insider Transactions', endpoint: `GET /api/edgar/${ticker}/insider-transactions` },
    { section: 'Institutional Holdings', endpoint: `GET /api/edgar/${ticker}/institutional-holdings` },
    { section: 'Congressional Trading', endpoint: `GET /api/edgar/${ticker}/congress-trades`, source: 'local' },
    { section: 'Proxy Statement', endpoint: `GET /api/edgar/${ticker}/proxy-statement` },
  ]

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 md:px-8">
      <TickerDashboardHeader
        ticker={ticker}
        companyName={profileData?.name}
        savedAt={savedAtOverride ?? saved.data?.createdAt}
        onRefresh={savedMode ? () => setSearchParams({}) : undefined}
        actions={
          <SaveToSupabaseButton
            kind="ticker"
            identifier={ticker}
            bundle={bundle}
            sourceMetadata={{ loadedSections, fetchedAt: bundle.fetchedAt }}
            alreadySaved={Boolean(saved.data)}
            onSaved={setSavedAtOverride}
          />
        }
      />

      <Tabs defaultValue="profile" className="gap-6">
        <TabsList variant="line" className="w-full flex-wrap justify-start">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="analyst">Analyst</TabsTrigger>
          <TabsTrigger value="financials">Financials</TabsTrigger>
          <TabsTrigger value="filings">Filings</TabsTrigger>
          <TabsTrigger value="latest-reports">10-K / 10-Q</TabsTrigger>
          <TabsTrigger value="insider">Insider</TabsTrigger>
          <TabsTrigger value="institutional">Institutional</TabsTrigger>
          <TabsTrigger value="congress">Congress</TabsTrigger>
          <TabsTrigger value="proxy">Proxy</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="min-w-0 flex-1">
          {profileState.loading ? <SectionLoading label={loadingLabel(`Resolving ${ticker} → CIK, then fetching SEC submissions & XBRL company facts…`)} /> : null}
          {profileState.error ? <SectionError message={profileState.error} /> : null}
          {profileData ? <CompanyProfileSection profile={profileData} /> : null}
        </TabsContent>

        <TabsContent value="analyst" className="min-w-0 flex-1">
          {analystState.loading ? <SectionLoading label={loadingLabel(`Fetching analyst consensus, price targets, and rating history for ${ticker} from Yahoo Finance…`)} /> : null}
          {analystState.error ? <SectionError message={analystState.error} /> : null}
          {analystData ? <AnalystSection analyst={analystData} /> : null}
          {!analystState.loading && !analystState.error && !analystData ? (
            <SectionError
              message={
                savedMode
                  ? `No analyst data in the saved snapshot for ${ticker}. Click “Refresh from SEC” (or open without ?source=saved) to fetch live analyst consensus and recommendation trends from Yahoo Finance, then Save to Supabase again.`
                  : `No analyst data returned for ${ticker}.`
              }
            />
          ) : null}
        </TabsContent>

        <TabsContent value="financials" className="min-w-0 flex-1">
          {financialsLoading ? <SectionLoading label={loadingLabel(`Fetching XBRL company facts for ${ticker} from SEC EDGAR…`)} /> : null}
          {financialsError ? <SectionError message={financialsError} /> : null}
          {annualFinancialsData && quarterlyFinancialsData ? (
            <FinancialsSection annual={annualFinancialsData} quarterly={quarterlyFinancialsData} />
          ) : null}
        </TabsContent>

        <TabsContent value="filings" className="min-w-0 flex-1">
          {filingsState.loading ? <SectionLoading label={loadingLabel(`Fetching recent filings for ${ticker} from SEC EDGAR submissions…`)} /> : null}
          {filingsState.error ? <SectionError message={filingsState.error} /> : null}
          {filingsData ? <RecentFilingsSection filings={filingsData} /> : null}
        </TabsContent>

        <TabsContent value="latest-reports" className="min-w-0 flex-1">
          {latestReportsState.loading ? (
            <SectionLoading label={loadingLabel(`Finding ${ticker}'s latest 10-K/10-Q and extracting business description & risk factors…`)} />
          ) : null}
          {latestReportsState.error ? <SectionError message={latestReportsState.error} /> : null}
          {latestReportsData ? <LatestReportsSection reports={latestReportsData} /> : null}
        </TabsContent>

        <TabsContent value="insider" className="min-w-0 flex-1">
          {insiderState.loading ? <SectionLoading label={loadingLabel(`Fetching Form 3/4/5 filings for ${ticker} and parsing ownership XML…`)} /> : null}
          {insiderState.error ? <SectionError message={insiderState.error} /> : null}
          {insiderData ? <InsiderTransactionsSection transactions={insiderData} /> : null}
        </TabsContent>

        <TabsContent value="institutional" className="min-w-0 flex-1">
          {institutionalLoading ? (
            <SectionLoading label={loadingLabel(`Checking tracked hedge funds & fund managers' latest 13F-HR filings for a ${ticker} position…`)} />
          ) : null}
          {institutionalError ? <SectionError message={institutionalError} /> : null}
          {hedgeFundData && investmentFundData ? (
            <InstitutionalHoldingsSection hedgeFund={hedgeFundData} investmentFund={investmentFundData} />
          ) : null}
        </TabsContent>

        <TabsContent value="congress" className="min-w-0 flex-1">
          {congressState.loading ? <SectionLoading label={loadingLabel(`Loading local STOCK Act congressional trade data for ${ticker}…`)} /> : null}
          {congressState.error ? <SectionError message={congressState.error} /> : null}
          {congressData ? <CongressTradingSection data={congressData} /> : null}
        </TabsContent>

        <TabsContent value="proxy" className="min-w-0 flex-1">
          {proxyState.loading ? <SectionLoading label={loadingLabel(`Finding ${ticker}'s latest DEF 14A and parsing compensation tables…`)} /> : null}
          {proxyState.error ? <SectionError message={proxyState.error} /> : null}
          {proxyData ? <ProxyStatementSection data={proxyData} /> : null}
        </TabsContent>
      </Tabs>

      <div className="mt-8">
        <SectionCard
          title="Where this data came from"
          description={savedMode ? `Everything below is read from Supabase, not fetched live.` : `Everything below is fetched live from SEC EDGAR (or a local dataset where noted).`}
        >
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground">Section</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground">Source</th>
                  <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground">Details</th>
                </tr>
              </thead>
              <tbody>
                {sourceRows.map((row) => {
                  const isLocalDataset = row.source === 'local' && !savedMode
                  const isYahoo = row.source === 'yahoo' && !savedMode
                  return (
                    <tr key={row.section} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{row.section}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {savedMode ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            Supabase
                          </span>
                        ) : isLocalDataset ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            Local dataset
                          </span>
                        ) : isYahoo ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400">
                            Yahoo Finance (API)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
                            SEC EDGAR (API)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {savedMode
                          ? `Supabase table \`${savedTable}\`, saved ${formatTimestamp(savedAt)}`
                          : isLocalDataset
                            ? `server/data/congress/ticker/${ticker}.json (not a live SEC feed)`
                            : row.endpoint}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
