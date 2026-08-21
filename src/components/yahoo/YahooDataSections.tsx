import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { YahooStructuredData } from '@/types/yahoo'
import {
  KeyValueList,
  SectionCard,
  SectionEmpty,
  SectionError,
  SimpleTable,
  StatGrid,
  formatCurrency,
  formatDecimal,
  formatNumber,
  formatPercent,
  formatTimestamp,
} from '@/components/tickerDashboard/shared'
import { YahooInteractiveChart } from '@/components/yahoo/YahooInteractiveChart'
import { fetchYahooQuote, type YahooLiveQuote } from '@/services/yahooApi'
import { resolveExchangeTimeZone } from '@/lib/exchangeTimeZone'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  YahooFinanceWithMarketState,
  YahooMarketStateLabel,
} from '@/components/yahoo/YahooMarketStateLabel'
import { SourceBadge } from '@/components/tickerDashboard/SourceBadge'

function rawNum(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'object' && value !== null && 'raw' in value) {
    const raw = (value as { raw: unknown }).raw
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return null
}

const DISPLAY_PRIORITY_KEYS = [
  'fmt',
  'longFmt',
  'description',
  'scoreDescription',
  'stateDescription',
  'direction',
  'rating',
  'title',
  'name',
  'headline',
  'text',
  'summary',
  'value',
  'label',
  'symbol',
  'period',
]

/**
 * Safe display for any Yahoo field. Never returns "[object Object]".
 * Handles primitives, {raw,fmt}, dates, arrays, and nested plain objects.
 */
function rawStr(value: unknown, depth = 0): string {
  if (value == null) return 'N/A'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 'N/A'
    // ISO timestamps → short date (keep time only if not midnight)
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      try {
        const d = new Date(trimmed)
        if (!Number.isNaN(d.getTime())) {
          const hasTime = !trimmed.includes('T00:00:00')
          return hasTime ? formatTimestamp(d.toISOString()) : trimmed.slice(0, 10)
        }
      } catch {
        /* keep original */
      }
    }
    const asNum = Number(trimmed.replace(/,/g, ''))
    if (Number.isFinite(asNum) && /^-?[\d,.]+$/.test(trimmed)) {
      return formatDecimal(asNum)
    }
    return trimmed
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'N/A'
    // Calendar years (e.g. financialsChart yearly date: 2022) — not decimals.
    if (Number.isInteger(value) && value >= 1900 && value <= 2100) return String(value)
    // Only treat as Unix epoch when it looks like a timestamp, not money
    // (revenue 3.94e11 was wrongly shown as a date before).
    // Epoch seconds ~1e9–2e9 (2001–2033); ms ~1e12–2e12.
    if (Number.isInteger(value) && value >= 1_000_000_000 && value <= 2_200_000_000) {
      return formatTimestamp(new Date(value * 1000).toISOString())
    }
    if (Number.isInteger(value) && value >= 1_000_000_000_000 && value <= 2_200_000_000_000) {
      return formatTimestamp(new Date(value).toISOString())
    }
    // Large magnitudes (share counts, $ revenue) → compact currency-style number
    if (Math.abs(value) >= 1_000_000) return formatNumber(value)
    return formatDecimal(value)
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'N/A' : formatTimestamp(value.toISOString())
  }
  if (Array.isArray(value)) {
    if (!value.length) return '—'
    return value
      .map((item) => rawStr(item, depth + 1))
      .filter((s) => s && s !== 'N/A' && s !== '—')
      .join(', ')
  }
  if (typeof value === 'object') {
    if (depth > 3) return '—'
    const obj = value as Record<string, unknown>

    // Yahoo numeric wrapper { raw, fmt, longFmt }
    const n = rawNum(obj)
    if (n != null) {
      // Prefer formatted string when present for large share counts etc.
      if (typeof obj.fmt === 'string' && obj.fmt.trim()) return obj.fmt.trim()
      if (typeof obj.longFmt === 'string' && obj.longFmt.trim()) return obj.longFmt.trim()
      return formatDecimal(n)
    }
    if (typeof obj.fmt === 'string' && obj.fmt.trim()) return obj.fmt.trim()
    if (typeof obj.longFmt === 'string' && obj.longFmt.trim()) return obj.longFmt.trim()
    if (typeof obj.raw === 'string') return rawStr(obj.raw, depth + 1)
    if (typeof obj.raw === 'boolean') return obj.raw ? 'Yes' : 'No'

    // Prefer human-readable fields on nested insight/outlook objects
    for (const key of DISPLAY_PRIORITY_KEYS) {
      if (key in obj && obj[key] != null && typeof obj[key] !== 'object') {
        return rawStr(obj[key], depth + 1)
      }
    }
    // Combine direction + scoreDescription when both exist (technical outlooks)
    if (obj.direction != null || obj.scoreDescription != null) {
      const parts = [obj.direction, obj.scoreDescription, obj.stateDescription]
        .filter((part) => part != null && typeof part !== 'object')
        .map((part) => rawStr(part, depth + 1))
      if (parts.length) return parts.join(' · ')
    }

    // Flatten shallow primitive/nested-display fields into "Label: value" pairs
    const pairs: string[] = []
    for (const [key, nested] of Object.entries(obj)) {
      if (key === 'maxAge' || key === 'provider' || key === 'color') continue
      if (nested == null) continue
      if (typeof nested === 'object' && !Array.isArray(nested) && nested !== null) {
        // One level of nested display for outlook-style objects
        const nestedStr = rawStr(nested, depth + 1)
        if (nestedStr && nestedStr !== 'N/A' && nestedStr !== '—' && nestedStr !== '[object Object]') {
          pairs.push(`${humanizeLabel(key)}: ${nestedStr}`)
        }
        continue
      }
      const nestedStr = rawStr(nested, depth + 1)
      if (nestedStr && nestedStr !== 'N/A' && nestedStr !== '—') {
        pairs.push(`${humanizeLabel(key)}: ${nestedStr}`)
      }
    }
    if (pairs.length) return pairs.join(' · ')
    return '—'
  }
  // Never String(object) — that becomes "[object Object]"
  return '—'
}

function epochToDate(value: unknown): string {
  const n = rawNum(value)
  if (n == null) return 'N/A'
  // Yahoo uses seconds for many epoch fields.
  const ms = n > 1e12 ? n : n * 1000
  return formatTimestamp(new Date(ms).toISOString())
}

function SectionShell({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  // No source badge — tab context is enough; badge was noisy in Market.
  return (
    <SectionCard title={title} description={description}>
      {children}
    </SectionCard>
  )
}

/** camelCase / PascalCase / snake_case → "Title Case" labels for display. */
function humanizeLabel(key: string): string {
  if (!key) return ''
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Common finance acronyms
  const acronyms = new Set(['eps', 'ebit', 'ebitda', 'ppe', 'ttm', 'yoy', 'roa', 'roe', 'pe', 'ps', 'pb', 'sga', 'rd', 'ni', 'cogs'])
  return spaced
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase()
      if (acronyms.has(lower)) return lower.toUpperCase()
      if (lower === 'and') return 'and'
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

function formatStatementValue(value: unknown): string {
  const n = rawNum(value)
  if (n == null) {
    if (value == null) return '—'
    return rawStr(value)
  }
  // Ratios / EPS-like small numbers: 1 decimal. Large $ amounts: compact currency.
  if (Math.abs(n) < 1000) return formatDecimal(n)
  return formatCurrency(n)
}

function isPlainYahooWrapper(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && ('raw' in (value as object) || 'fmt' in (value as object)))
}

function isDisplayPrimitive(value: unknown): boolean {
  return (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    isPlainYahooWrapper(value)
  )
}

function ObjectTable({ title, data, description }: { title: string; data: unknown; description?: string }) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return null
  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([key]) => key !== 'maxAge' && key !== 'uuid' && key !== 'messageBoardId',
  )
  if (!entries.length) return null

  // Only show clean human-readable rows — never dump nested object trees into labels/values.
  const pairs: { label: string; value: ReactNode }[] = []
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      if (!value.length) continue
      if (value.every(isDisplayPrimitive)) {
        pairs.push({ label: humanizeLabel(key), value: rawStr(value) })
      } else {
        pairs.push({ label: humanizeLabel(key), value: `${value.length} items` })
      }
      continue
    }

    if (value != null && typeof value === 'object' && !(value instanceof Date) && !isPlainYahooWrapper(value)) {
      const nested = Object.entries(value as Record<string, unknown>).filter(
        ([k]) => k !== 'maxAge' && k !== 'provider' && k !== 'uuid',
      )
      const primitiveNested = nested.filter(([, v]) => isDisplayPrimitive(v))
      // Expand only shallow primitive fields; skip deep object graphs entirely.
      if (primitiveNested.length) {
        for (const [nestedKey, nestedValue] of primitiveNested) {
          const display = rawStr(nestedValue)
          if (display === 'N/A' || display === '—' || display.includes('[object')) continue
          pairs.push({
            label: `${humanizeLabel(key)} · ${humanizeLabel(nestedKey)}`,
            value: display,
          })
        }
      }
      continue
    }

    if (value == null) continue
    const display = rawStr(value)
    if (display === 'N/A' || display === '—' || display.includes('[object')) continue
    pairs.push({ label: humanizeLabel(key), value: display })
  }

  if (!pairs.length) return null
  return (
    <SectionShell title={title} description={description}>
      <KeyValueList pairs={pairs} columns={2} />
    </SectionShell>
  )
}

// Preferred line items (order matters) for each statement, mapped from Yahoo fundamentalsTimeSeries keys.
const INCOME_FIELDS = [
  'totalRevenue',
  'operatingRevenue',
  'costOfRevenue',
  'reconciledCostOfRevenue',
  'grossProfit',
  'researchAndDevelopment',
  'sellingGeneralAndAdministration',
  'operatingExpense',
  'operatingIncome',
  'totalOperatingIncomeAsReported',
  'EBIT',
  'EBITDA',
  'normalizedEBITDA',
  'interestExpense',
  'interestExpenseNonOperating',
  'interestIncome',
  'interestIncomeNonOperating',
  'netInterestIncome',
  'netNonOperatingInterestIncomeExpense',
  'otherIncomeExpense',
  'otherNonOperatingIncomeExpenses',
  'pretaxIncome',
  'taxProvision',
  'netIncome',
  'netIncomeCommonStockholders',
  'netIncomeContinuousOperations',
  'netIncomeFromContinuingOperationNetMinorityInterest',
  'dilutedNIAvailtoComStockholders',
  'normalizedIncome',
  'basicEPS',
  'dilutedEPS',
  'basicAverageShares',
  'dilutedAverageShares',
  'totalExpenses',
]

const BALANCE_FIELDS = [
  'totalAssets',
  'currentAssets',
  'cashAndCashEquivalents',
  'cashCashEquivalentsAndShortTermInvestments',
  'cashEquivalents',
  'otherShortTermInvestments',
  'accountsReceivable',
  'receivables',
  'inventory',
  'otherCurrentAssets',
  'totalNonCurrentAssets',
  'netPPE',
  'grossPPE',
  'accumulatedDepreciation',
  'otherNonCurrentAssets',
  'totalLiabilitiesNetMinorityInterest',
  'currentLiabilities',
  'accountsPayable',
  'payables',
  'currentDebt',
  'currentDebtAndCapitalLeaseObligation',
  'currentDeferredRevenue',
  'currentAccruedExpenses',
  'otherCurrentLiabilities',
  'totalNonCurrentLiabilitiesNetMinorityInterest',
  'longTermDebt',
  'longTermDebtAndCapitalLeaseObligation',
  'capitalLeaseObligations',
  'totalDebt',
  'netDebt',
  'stockholdersEquity',
  'commonStockEquity',
  'commonStock',
  'capitalStock',
  'retainedEarnings',
  'totalEquityGrossMinorityInterest',
  'tangibleBookValue',
  'netTangibleAssets',
  'workingCapital',
  'investedCapital',
  'totalCapitalization',
  'ordinarySharesNumber',
  'shareIssued',
]

const CASHFLOW_FIELDS = [
  'operatingCashFlow',
  'cashFlowFromContinuingOperatingActivities',
  'netIncomeFromContinuingOperations',
  'depreciationAndAmortization',
  'depreciationAmortizationDepletion',
  'stockBasedCompensation',
  'changeInWorkingCapital',
  'changeInReceivables',
  'changeInInventory',
  'changeInAccountPayable',
  'otherNonCashItems',
  'investingCashFlow',
  'cashFlowFromContinuingInvestingActivities',
  'capitalExpenditure',
  'purchaseOfPPE',
  'netPPEPurchaseAndSale',
  'purchaseOfInvestment',
  'saleOfInvestment',
  'netInvestmentPurchaseAndSale',
  'purchaseOfBusiness',
  'netBusinessPurchaseAndSale',
  'financingCashFlow',
  'cashFlowFromContinuingFinancingActivities',
  'repurchaseOfCapitalStock',
  'commonStockPayments',
  'commonStockIssuance',
  'issuanceOfCapitalStock',
  'netCommonStockIssuance',
  'cashDividendsPaid',
  'commonStockDividendPaid',
  'issuanceOfDebt',
  'repaymentOfDebt',
  'netIssuancePaymentsOfDebt',
  'longTermDebtIssuance',
  'longTermDebtPayments',
  'netLongTermDebtIssuance',
  'freeCashFlow',
  'beginningCashPosition',
  'endCashPosition',
  'changesInCash',
]

const META_KEYS = new Set(['TYPE', 'date', 'asOfDate', 'periodType', 'currencyCode', 'maxAge', 'endDate'])

function periodLabelFromRow(row: Record<string, unknown>): string {
  const raw = row.date ?? row.asOfDate ?? row.endDate
  if (raw == null) return '—'
  if (typeof raw === 'string') return raw.slice(0, 10)
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { fmt?: string; raw?: number }
    if (obj.fmt) return obj.fmt
    if (typeof obj.raw === 'number') return new Date(obj.raw * 1000).toISOString().slice(0, 10)
  }
  return String(raw).slice(0, 10)
}

function buildStatementTable(
  series: unknown,
  preferredFields: string[],
): { periods: string[]; rows: Record<string, ReactNode>[]; fieldCount: number } | null {
  if (!Array.isArray(series) || !series.length) return null
  const periodsData = series as Record<string, unknown>[]
  // Most-recent period first (Yahoo usually returns oldest→newest).
  const ordered = [...periodsData].sort((a, b) => periodLabelFromRow(b).localeCompare(periodLabelFromRow(a)))
  const periods = ordered.map(periodLabelFromRow)

  const allKeys = new Set<string>()
  for (const row of ordered) {
    for (const key of Object.keys(row)) {
      if (!META_KEYS.has(key)) allKeys.add(key)
    }
  }

  const preferred = preferredFields.filter((field) => allKeys.has(field))
  const preferredSet = new Set(preferred)
  const extras = Array.from(allKeys)
    .filter((field) => !preferredSet.has(field))
    .sort((a, b) => humanizeLabel(a).localeCompare(humanizeLabel(b)))

  // Prefer known statement lines; append any remaining populated keys so nothing is lost.
  const fields = [...preferred, ...extras]

  const rows: Record<string, ReactNode>[] = []
  for (const field of fields) {
    const values = ordered.map((item) => item[field])
    // Skip rows that are entirely empty across all periods.
    if (values.every((v) => v == null)) continue
    const row: Record<string, ReactNode> = { field: humanizeLabel(field) }
    values.forEach((value, index) => {
      row[`p${index}`] = formatStatementValue(value)
    })
    rows.push(row)
  }

  if (!rows.length) return null
  return { periods, rows, fieldCount: rows.length }
}

function StatementTable({
  title,
  series,
  fields,
  description,
}: {
  title: string
  series: unknown
  fields: string[]
  description?: string
}) {
  const parsed = buildStatementTable(series, fields)
  if (!parsed) {
    return (
      <SectionShell title={title} description={description}>
        <SectionEmpty message="No data returned for this statement." />
      </SectionShell>
    )
  }
  const columns = [
    { key: 'field', label: 'Line item' },
    ...parsed.periods.map((period, index) => ({ key: `p${index}`, label: period, align: 'right' as const })),
  ]
  return (
    <SectionShell title={title} description={description || `${parsed.fieldCount} line items · most recent period first`}>
      <SimpleTable columns={columns} rows={parsed.rows} emptyMessage="No line items available." />
    </SectionShell>
  )
}

function statementListFromHistory(history: unknown): Record<string, unknown>[] {
  if (!history || typeof history !== 'object') return []
  const obj = history as Record<string, unknown>
  const candidates = [
    obj.incomeStatementHistory,
    obj.balanceSheetStatements,
    obj.cashflowStatements,
    obj.incomeStatements,
    obj.balanceSheets,
    obj.cashflows,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate as Record<string, unknown>[]
  }
  return []
}

/** Fallback tables from quoteSummary statement history modules (often sparse). */
function QuoteSummaryStatementTable({ title, history }: { title: string; history: unknown }) {
  const list = statementListFromHistory(history)
  if (!list.length) return null
  // Drop statements that only have endDate/maxAge (Yahoo often returns empty shells).
  const useful = list.filter((item) => Object.keys(item).some((key) => !META_KEYS.has(key) && item[key] != null))
  if (!useful.length) return null

  const periods = useful.map((item, index) => periodLabelFromRow(item) || `Period ${index + 1}`)
  const fieldSet = new Set<string>()
  for (const item of useful) {
    for (const key of Object.keys(item)) {
      if (!META_KEYS.has(key)) fieldSet.add(key)
    }
  }
  const rows = Array.from(fieldSet).map((field) => {
    const row: Record<string, ReactNode> = { field: humanizeLabel(field) }
    useful.forEach((item, index) => {
      row[`p${index}`] = formatStatementValue(item[field])
    })
    return row
  })
  const columns = [
    { key: 'field', label: 'Line item' },
    ...periods.map((period, index) => ({ key: `p${index}`, label: period, align: 'right' as const })),
  ]
  return (
    <SectionShell title={title} description="Yahoo quoteSummary history">
      <SimpleTable columns={columns} rows={rows} />
    </SectionShell>
  )
}

/** High-level overview: company, price, chart, then identity + stats side by side. */
export function YahooOverviewSection({ data }: { data: YahooStructuredData }) {
  const q = data.quote || ({} as YahooStructuredData['quote'])
  const p = data.profile || ({} as YahooStructuredData['profile'])
  const targets = data.priceTargets || ({} as YahooStructuredData['priceTargets'])
  const financial = (data.financialData || {}) as Record<string, unknown>
  const valuation = data.valuation || {}
  const profitability = data.profitability || {}
  const breakdown = (data.ownership?.majorHoldersBreakdown || {}) as Record<string, unknown>
  const fund = data.fund
  const isFund = isYahooFundInstrument(data)
  const keyStats = (data.defaultKeyStatistics || {}) as Record<string, unknown>

  const symbol = String(data.symbol || '').toUpperCase()
  const [liveQuote, setLiveQuote] = useState<YahooLiveQuote | null>(null)
  const [liveLoading, setLiveLoading] = useState(Boolean(symbol))
  const [liveError, setLiveError] = useState(false)

  // Always pull a fresh Yahoo Finance quote for the share-price header (saved snapshot can be stale).
  useEffect(() => {
    if (!symbol) {
      setLiveQuote(null)
      setLiveLoading(false)
      setLiveError(false)
      return
    }

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | undefined

    async function loadLive() {
      try {
        const body = await fetchYahooQuote(symbol)
        if (cancelled) return
        setLiveQuote(body.quote || null)
        setLiveError(false)
      } catch {
        if (cancelled) return
        setLiveError(true)
      } finally {
        if (!cancelled) setLiveLoading(false)
      }
    }

    setLiveLoading(true)
    setLiveError(false)
    void loadLive()
    // Soft refresh every 30s while Overview is open.
    intervalId = setInterval(() => {
      void loadLive()
    }, 30_000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [symbol])

  const price = liveQuote?.regularMarketPrice ?? q.regularMarketPrice
  const change = liveQuote?.regularMarketChange ?? q.regularMarketChange
  const changePct = liveQuote?.regularMarketChangePercent ?? q.regularMarketChangePercent
  const priceIsLive = liveQuote?.regularMarketPrice != null
  const recommendationKey = targets.recommendationKey || (financial.recommendationKey as string) || null
  const targetMean = targets.targetMean ?? rawNum(financial.targetMeanPrice)
  const targetLow = targets.targetLow ?? rawNum(financial.targetLowPrice)
  const targetHigh = targets.targetHigh ?? rawNum(financial.targetHighPrice)
  const numAnalysts = targets.numberOfAnalystOpinions ?? rawNum(financial.numberOfAnalystOpinions)

  const asOwnershipPct = (n: number | null) => {
    if (n == null) return 'N/A'
    const pct = Math.abs(n) <= 1 ? n * 100 : n
    return `${formatDecimal(pct)}%`
  }

  const fundProfile = (fund?.profile || null) as Record<string, unknown> | null
  const fundFees = (fundProfile?.feesExpensesInvestment || null) as Record<string, unknown> | null
  const expenseRatio = fundFees ? rawNum(fundFees.annualReportExpenseRatio) : null

  const companyName = rawStr(data.companyName) !== 'N/A' ? rawStr(data.companyName) : rawStr(data.symbol)

  const identityPairs = [
    { label: 'Symbol', value: rawStr(data.symbol) },
    { label: 'Exchange', value: rawStr(data.exchange) },
    { label: 'Currency', value: rawStr(data.currency) },
    {
      label: 'Type',
      value: rawStr(typeof data.quoteType === 'string' ? data.quoteType : data.quoteTypeDetail),
    },
    ...(isFund
      ? [
          { label: 'Category', value: rawStr(fund?.category) },
          { label: 'Family', value: rawStr(fund?.family) },
        ]
      : [
          { label: 'Sector', value: p.sector || 'N/A' },
          { label: 'Industry', value: p.industry || 'N/A' },
        ]),
  ]

  const snapshotStats = isFund && fund
    ? [
        {
          label: 'AUM',
          value: fund.totalAssets != null ? formatCurrency(fund.totalAssets) : 'N/A',
        },
        { label: 'NAV', value: fund.navPrice != null ? `$${formatDecimal(fund.navPrice)}` : 'N/A' },
        { label: 'Yield', value: fund.yield != null ? asFractionPercent(fund.yield) : 'N/A' },
        {
          label: 'Expense ratio',
          value: expenseRatio != null ? asFractionPercent(expenseRatio, 3) : 'N/A',
        },
        { label: 'Volume', value: formatNumber(q.regularMarketVolume) },
        {
          label: 'Day range',
          value:
            q.regularMarketDayLow != null && q.regularMarketDayHigh != null
              ? `${formatDecimal(q.regularMarketDayLow)} – ${formatDecimal(q.regularMarketDayHigh)}`
              : 'N/A',
        },
      ]
    : [
        { label: 'Market cap', value: formatCurrency(q.marketCap) },
        { label: 'Volume', value: formatNumber(q.regularMarketVolume) },
        {
          label: 'Trailing P/E',
          value:
            q.trailingPE != null
              ? formatDecimal(q.trailingPE)
              : valuation.trailingPE != null
                ? formatDecimal(valuation.trailingPE as number)
                : 'N/A',
        },
        {
          label: 'Forward P/E',
          value:
            q.forwardPE != null
              ? formatDecimal(q.forwardPE)
              : valuation.forwardPE != null
                ? formatDecimal(valuation.forwardPE as number)
                : 'N/A',
        },
        {
          label: 'Dividend yield',
          value: q.dividendYield != null ? `${formatDecimal(q.dividendYield)}%` : 'N/A',
        },
        {
          label: 'EPS (TTM)',
          value: rawNum(keyStats.trailingEps) != null ? formatDecimal(rawNum(keyStats.trailingEps)) : 'N/A',
        },
        {
          label: 'Day range',
          value:
            q.regularMarketDayLow != null && q.regularMarketDayHigh != null
              ? `${formatDecimal(q.regularMarketDayLow)} – ${formatDecimal(q.regularMarketDayHigh)}`
              : 'N/A',
        },
        {
          label: '52W range',
          value:
            q.fiftyTwoWeekLow != null && q.fiftyTwoWeekHigh != null
              ? `${formatDecimal(q.fiftyTwoWeekLow)} – ${formatDecimal(q.fiftyTwoWeekHigh)}`
              : 'N/A',
        },
      ]

  const metaLine = [rawStr(data.symbol), rawStr(data.exchange), rawStr(data.currency)]
    .filter((part) => part && part !== 'N/A')
    .join(' · ')

  return (
    <div className="space-y-6">
      {/* Header: company name + live Yahoo market state above Yahoo Finance */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{companyName}</h2>
          {isFund ? (
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {data.isEtf || String(data.quoteType || '').toUpperCase() === 'ETF' ? 'ETF' : 'Fund'}
            </span>
          ) : null}
          <YahooFinanceWithMarketState marketState={liveQuote?.marketState}>
            <SourceBadge source="yahoo-finance" />
          </YahooFinanceWithMarketState>
        </div>
        {metaLine ? <p className="text-sm text-muted-foreground">{metaLine}</p> : null}
        <div className="pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Share price</div>
            {liveLoading && !priceIsLive ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Live quote…
              </span>
            ) : priceIsLive ? (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                Live
              </span>
            ) : liveError ? (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">Snapshot price</span>
            ) : null}
            <YahooMarketStateLabel marketState={liveQuote?.marketState} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-end gap-x-3 gap-y-1">
            <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground sm:text-4xl">
              {price != null ? `$${formatDecimal(price)}` : liveLoading ? '…' : 'N/A'}
            </div>
            {change != null ? (
              <div
                className={
                  change >= 0
                    ? 'pb-1 text-lg font-medium tabular-nums text-emerald-600 dark:text-emerald-400'
                    : 'pb-1 text-lg font-medium tabular-nums text-red-600 dark:text-red-400'
                }
              >
                {change >= 0 ? '+' : ''}
                {formatDecimal(change)}
                {changePct != null ? ` (${formatPercent(changePct, 1)})` : ''}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Chart — borderless, no Yahoo Finance tag / card chrome */}
      <YahooInteractiveChart
        ticker={data.symbol || ''}
        initialChart={data.chart}
        title=""
        defaultRange="1y"
        height={360}
        borderless
        timeZone={resolveExchangeTimeZone({
          exchangeTimezoneName: liveQuote?.exchangeTimezoneName,
          exchange: liveQuote?.exchange || data.exchange,
          symbol,
        })}
      />

      {/* Identity (multi-col) + Key snapshot beside it */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-2 lg:col-span-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Identity</h3>
          <KeyValueList pairs={identityPairs} columns={2} />
        </div>
        <div className="space-y-2 lg:col-span-3">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Key snapshot</h3>
          <StatGrid stats={snapshotStats} />
        </div>
      </div>

      {!isFund ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Analyst & ownership</h3>
          <StatGrid
            stats={[
              {
                label: 'Consensus',
                value: recommendationKey
                  ? humanizeLabel(String(recommendationKey).replace(/_/g, ' '))
                  : 'N/A',
              },
              { label: 'Analysts', value: formatNumber(numAnalysts) },
              {
                label: 'Target mean',
                value: targetMean != null ? `$${formatDecimal(targetMean)}` : 'N/A',
              },
              {
                label: 'Target range',
                value:
                  targetLow != null && targetHigh != null
                    ? `$${formatDecimal(targetLow)} – $${formatDecimal(targetHigh)}`
                    : 'N/A',
              },
              {
                label: 'Insider ownership',
                value: asOwnershipPct(rawNum(breakdown.insidersPercentHeld)),
              },
              {
                label: 'Institutional ownership',
                value: asOwnershipPct(rawNum(breakdown.institutionsPercentHeld)),
              },
              {
                label: '# Institutions',
                value:
                  rawNum(breakdown.institutionsCount) != null
                    ? Math.round(rawNum(breakdown.institutionsCount)!).toLocaleString('en-US')
                    : 'N/A',
              },
              {
                label: 'Profit margin',
                value:
                  profitability.profitMargins != null
                    ? formatPercent(
                        Math.abs(profitability.profitMargins as number) <= 1
                          ? (profitability.profitMargins as number) * 100
                          : (profitability.profitMargins as number),
                        1,
                      )
                    : 'N/A',
              },
            ]}
          />
        </div>
      ) : null}

      {!isFund && p.longBusinessSummary ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">About</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{p.longBusinessSummary}</p>
        </div>
      ) : null}
    </div>
  )
}

export function YahooQuoteSection({ data }: { data: YahooStructuredData }) {
  const q = data.quote || ({} as YahooStructuredData['quote'])
  const change = q.regularMarketChange
  const changePct = q.regularMarketChangePercent
  return (
    <div className="space-y-4">
      <SectionShell
        title="Real-time quote"
        description={[data.exchange, data.currency].filter(Boolean).join(' · ') || 'Yahoo Finance quote'}
      >
        <StatGrid
          stats={[
            { label: 'Price', value: q.regularMarketPrice != null ? `$${formatDecimal(q.regularMarketPrice)}` : 'N/A' },
            {
              label: 'Change',
              // Yahoo quote.regularMarketChangePercent is already a percent (e.g. -0.28), not a 0–1 fraction.
              value:
                change != null
                  ? `${change >= 0 ? '+' : ''}${formatDecimal(change)}${changePct != null ? ` (${formatPercent(changePct, 1)})` : ''}`
                  : 'N/A',
            },
            { label: 'Market Cap', value: formatCurrency(q.marketCap) },
            { label: 'Volume', value: formatNumber(q.regularMarketVolume) },
            {
              label: 'Day Range',
              value:
                q.regularMarketDayLow != null && q.regularMarketDayHigh != null
                  ? `${formatDecimal(q.regularMarketDayLow)} – ${formatDecimal(q.regularMarketDayHigh)}`
                  : 'N/A',
            },
            { label: 'Open', value: q.regularMarketOpen != null ? formatDecimal(q.regularMarketOpen) : 'N/A' },
            { label: 'Prev Close', value: q.regularMarketPreviousClose != null ? formatDecimal(q.regularMarketPreviousClose) : 'N/A' },
            {
              label: '52W Range',
              value:
                q.fiftyTwoWeekLow != null && q.fiftyTwoWeekHigh != null
                  ? `${formatDecimal(q.fiftyTwoWeekLow)} – ${formatDecimal(q.fiftyTwoWeekHigh)}`
                  : 'N/A',
            },
            { label: 'Avg Volume', value: formatNumber(q.averageDailyVolume3Month) },
            {
              label: 'Bid / Ask',
              value: `${q.bid != null ? formatDecimal(q.bid) : '—'} / ${q.ask != null ? formatDecimal(q.ask) : '—'}`,
            },
            { label: 'Trailing P/E', value: q.trailingPE != null ? formatDecimal(q.trailingPE) : 'N/A' },
            { label: 'Forward P/E', value: q.forwardPE != null ? formatDecimal(q.forwardPE) : 'N/A' },
            {
              label: 'Dividend Yield',
              // Quote endpoint often returns yield already in percent points (0.34 → 0.3%).
              value: q.dividendYield != null ? `${formatDecimal(q.dividendYield)}%` : 'N/A',
            },
          ]}
        />
      </SectionShell>
      <YahooInteractiveChart
        ticker={data.symbol || ''}
        initialChart={data.chart}
        title="Price chart"
        defaultRange="1y"
        timeZone={resolveExchangeTimeZone({
          exchange: data.exchange,
          symbol: data.symbol,
        })}
      />
    </div>
  )
}

export function YahooProfileSection({ data }: { data: YahooStructuredData }) {
  const p = data.profile || ({} as YahooStructuredData['profile'])
  const address = [p.address1, p.city, p.state, p.zip, p.country].filter(Boolean).join(', ')
  return (
    <div className="space-y-4">
      <SectionShell title="Company profile" description={data.companyName || data.symbol}>
        {p.longBusinessSummary ? <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{p.longBusinessSummary}</p> : null}
        <KeyValueList
          pairs={[
            { label: 'Sector', value: p.sector || 'N/A' },
            { label: 'Industry', value: p.industry || 'N/A' },
            {
              label: 'Website',
              value: p.website ? (
                <a className="text-primary underline underline-offset-2" href={p.website} rel="noreferrer" target="_blank">
                  {p.website}
                </a>
              ) : (
                'N/A'
              ),
            },
            { label: 'Employees', value: formatNumber(p.fullTimeEmployees) },
            { label: 'Phone', value: p.phone || 'N/A' },
            { label: 'Address', value: address || 'N/A' },
          ]}
        />
      </SectionShell>

      {p.companyOfficers?.length ? (
        <SectionShell title="Company officers" description={`${p.companyOfficers.length} officers`}>
          <SimpleTable
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'title', label: 'Title' },
              { key: 'age', label: 'Age', align: 'right' },
              { key: 'pay', label: 'Total pay', align: 'right' },
            ]}
            rows={p.companyOfficers.map((officer) => ({
              name: officer.name || '—',
              title: officer.title || '—',
              age: officer.age ?? '—',
              pay: formatCurrency(rawNum(officer.totalPay)),
            }))}
          />
        </SectionShell>
      ) : null}
    </div>
  )
}

export function YahooValuationSection({ data }: { data: YahooStructuredData }) {
  return (
    <div className="space-y-4">
      <SectionShell title="Valuation" description="Key valuation multiples">
        <StatGrid
          stats={Object.entries(data.valuation || {}).map(([label, value]) => {
            const n = rawNum(value)
            return {
              label: humanizeLabel(label),
              value: n != null ? (Math.abs(n) >= 1000 ? formatNumber(n) : formatDecimal(n)) : rawStr(value),
            }
          })}
        />
      </SectionShell>
      <SectionShell title="Profitability & growth" description="Margins and growth rates">
        <StatGrid
          stats={Object.entries(data.profitability || {}).map(([label, value]) => {
            const n = rawNum(value)
            return {
              label: humanizeLabel(label),
              value:
                n != null
                  ? Math.abs(n) <= 10
                    ? formatPercent(n * (Math.abs(n) <= 1 ? 100 : 1), 1)
                    : formatDecimal(n)
                  : rawStr(value),
            }
          })}
        />
      </SectionShell>
      <ObjectTable title="Financial data (all fields)" data={data.financialData} description="Complete financialData module" />
      <ObjectTable title="Default key statistics (all fields)" data={data.defaultKeyStatistics} description="Complete defaultKeyStatistics module" />
      <ObjectTable title="Summary detail (all fields)" data={data.summaryDetail} description="Complete summaryDetail module" />
    </div>
  )
}

function recommendationPeriodLabel(period: unknown): string {
  const p = String(period ?? '')
  if (p === '0m') return 'Current'
  if (p === '-1m') return '1 month ago'
  if (p === '-2m') return '2 months ago'
  if (p === '-3m') return '3 months ago'
  return p || '—'
}

function extractTrendRows(recommendationTrend: unknown): Record<string, unknown>[] {
  if (!recommendationTrend) return []
  if (Array.isArray(recommendationTrend)) return recommendationTrend as Record<string, unknown>[]
  if (typeof recommendationTrend === 'object') {
    const trend = (recommendationTrend as { trend?: unknown }).trend
    if (Array.isArray(trend)) return trend as Record<string, unknown>[]
  }
  return []
}

function extractUpgradeHistory(upgradeDowngradeHistory: unknown): Record<string, unknown>[] {
  if (!upgradeDowngradeHistory) return []
  if (Array.isArray(upgradeDowngradeHistory)) return upgradeDowngradeHistory as Record<string, unknown>[]
  if (typeof upgradeDowngradeHistory === 'object') {
    const history = (upgradeDowngradeHistory as { history?: unknown }).history
    if (Array.isArray(history)) return history as Record<string, unknown>[]
  }
  return []
}

/** Horizontal price-target range: Low · Mean · Median · High, with current price marker. */
function AnalystPriceTargetRange({
  current,
  low,
  mean,
  median,
  high,
}: {
  current: number | null
  low: number | null
  mean: number | null
  median: number | null
  high: number | null
}) {
  const points = [current, low, mean, median, high].filter((n): n is number => n != null && Number.isFinite(n))
  if (points.length < 2 || low == null || high == null || high <= low) {
    return <SectionEmpty message="Not enough price target data to draw a range." />
  }

  const pad = (high - low) * 0.06 || 1
  const min = Math.min(...points, low) - pad
  const max = Math.max(...points, high) + pad
  const span = max - min || 1
  const pct = (value: number) => ((value - min) / span) * 100

  const markers: { key: string; label: string; value: number; color: string; emphasis?: boolean }[] = []
  if (low != null) markers.push({ key: 'low', label: 'Low', value: low, color: 'bg-sky-500' })
  if (mean != null) markers.push({ key: 'mean', label: 'Mean', value: mean, color: 'bg-violet-500', emphasis: true })
  if (median != null && (mean == null || Math.abs(median - mean) / span > 0.01)) {
    markers.push({ key: 'median', label: 'Median', value: median, color: 'bg-indigo-400' })
  }
  if (high != null) markers.push({ key: 'high', label: 'High', value: high, color: 'bg-emerald-500' })
  if (current != null) markers.push({ key: 'current', label: 'Current', value: current, color: 'bg-foreground', emphasis: true })

  const upside =
    current != null && mean != null && current !== 0 ? ((mean - current) / current) * 100 : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Analyst price target range</p>
          <p className="text-lg font-semibold tabular-nums">
            ${formatDecimal(low)}
            <span className="mx-1.5 text-muted-foreground">→</span>
            ${formatDecimal(high)}
          </p>
        </div>
        {upside != null ? (
          <p className={`text-sm font-medium tabular-nums ${upside >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            Mean target {upside >= 0 ? '+' : ''}
            {formatDecimal(upside)}% vs current
          </p>
        ) : null}
      </div>

      {/* Timeline / range line */}
      <div className="relative mx-1 h-16 pt-6">
        <div className="absolute left-0 right-0 top-[2.15rem] h-1.5 rounded-full bg-gradient-to-r from-sky-500/70 via-violet-500/80 to-emerald-500/70" />
        {markers.map((marker) => (
          <div
            key={marker.key}
            className="absolute top-0 flex w-0 flex-col items-center"
            style={{ left: `${pct(marker.value)}%` }}
          >
            <span
              className={`mb-1 whitespace-nowrap text-[10px] font-medium ${marker.emphasis ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {marker.label}
              <span className="mt-0.5 block tabular-nums">${formatDecimal(marker.value)}</span>
            </span>
            <span
              className={`mt-auto size-3 shrink-0 rounded-full border-2 border-background shadow ${marker.color} ${marker.key === 'current' ? 'ring-2 ring-foreground/30' : ''}`}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: 'Current', value: current },
          { label: 'Low', value: low },
          { label: 'Mean', value: mean },
          { label: 'Median', value: median },
          { label: 'High', value: high },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border bg-muted/30 px-2.5 py-2">
            <div className="text-[11px] text-muted-foreground">{item.label}</div>
            <div className="text-sm font-semibold tabular-nums">
              {item.value != null ? `$${formatDecimal(item.value)}` : 'N/A'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function YahooAnalystSection({ data }: { data: YahooStructuredData }) {
  const targets = data.priceTargets || ({} as YahooStructuredData['priceTargets'])
  const financial = (data.financialData || {}) as Record<string, unknown>
  const trend = extractTrendRows(data.recommendationTrend)
  const history = extractUpgradeHistory(data.upgradeDowngradeHistory)

  // Yahoo exposes two different “analyst counts” — they are not always equal:
  // 1) numberOfAnalystOpinions → analysts who submitted a price target
  // 2) sum of recommendationTrend (0m) → analysts in the buy/hold/sell breakdown
  const recommendationKey = targets.recommendationKey || (financial.recommendationKey as string) || null
  const recommendationMean = targets.recommendationMean ?? rawNum(financial.recommendationMean)
  const analystsWithTargets = targets.numberOfAnalystOpinions ?? rawNum(financial.numberOfAnalystOpinions)
  const targetLow = targets.targetLow ?? rawNum(financial.targetLowPrice)
  const targetMean = targets.targetMean ?? rawNum(financial.targetMeanPrice)
  const targetMedian = targets.targetMedian ?? rawNum(financial.targetMedianPrice)
  const targetHigh = targets.targetHigh ?? rawNum(financial.targetHighPrice)
  const currentPrice = rawNum(financial.currentPrice) ?? data.quote?.regularMarketPrice ?? null

  const latest = trend.find((row) => row.period === '0m') || trend[0]
  const ratingBreakdown = latest
    ? {
        strongBuy: rawNum(latest.strongBuy) || 0,
        buy: rawNum(latest.buy) || 0,
        hold: rawNum(latest.hold) || 0,
        sell: rawNum(latest.sell) || 0,
        strongSell: rawNum(latest.strongSell) || 0,
      }
    : null
  const analystsInRatings = ratingBreakdown
    ? ratingBreakdown.strongBuy +
      ratingBreakdown.buy +
      ratingBreakdown.hold +
      ratingBreakdown.sell +
      ratingBreakdown.strongSell
    : null

  let sentiment: { bullish: number; neutral: number; bearish: number; total: number } | null = null
  if (ratingBreakdown && analystsInRatings && analystsInRatings > 0) {
    const bullish = ratingBreakdown.strongBuy + ratingBreakdown.buy
    const neutral = ratingBreakdown.hold
    const bearish = ratingBreakdown.sell + ratingBreakdown.strongSell
    sentiment = { bullish, neutral, bearish, total: analystsInRatings }
  }

  const scoreLabel =
    recommendationMean == null
      ? null
      : recommendationMean <= 1.5
        ? 'Strong Buy side'
        : recommendationMean <= 2.5
          ? 'Buy side'
          : recommendationMean <= 3.5
            ? 'Hold'
            : recommendationMean <= 4.5
              ? 'Sell side'
              : 'Strong Sell side'

  return (
    <div className="space-y-4">
      <SectionShell
        title="Analyst Consensus"
        description="Yahoo Finance · rating + price-target consensus (two different analyst counts — see below)"
      >
        <StatGrid
          stats={[
            {
              label: 'Consensus rating',
              value: recommendationKey ? humanizeLabel(String(recommendationKey).replace(/_/g, ' ')) : 'N/A',
              sub: scoreLabel ? `Mean score scale: 1 = Strong Buy … 5 = Strong Sell` : undefined,
            },
            {
              label: 'Mean score',
              value: recommendationMean != null ? formatDecimal(recommendationMean) : 'N/A',
              sub: scoreLabel || undefined,
            },
            {
              label: 'Analysts (price targets)',
              value: analystsWithTargets != null ? String(Math.round(analystsWithTargets)) : 'N/A',
              sub: 'numberOfAnalystOpinions · who set a $ target',
            },
            {
              label: 'Analysts (ratings)',
              value: analystsInRatings != null ? String(Math.round(analystsInRatings)) : 'N/A',
              sub: 'strongBuy+buy+hold+sell+strongSell (current period)',
            },
            {
              label: 'Current price',
              value: currentPrice != null ? `$${formatDecimal(currentPrice)}` : 'N/A',
            },
            {
              label: 'Mean target',
              value: targetMean != null ? `$${formatDecimal(targetMean)}` : 'N/A',
              sub:
                currentPrice != null && targetMean != null && currentPrice !== 0
                  ? `${((targetMean - currentPrice) / currentPrice) * 100 >= 0 ? '+' : ''}${formatDecimal(((targetMean - currentPrice) / currentPrice) * 100)}% upside`
                  : undefined,
            },
          ]}
        />

        {ratingBreakdown && analystsInRatings ? (
          <div className="mt-4 rounded-lg border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Current rating distribution ({analystsInRatings} analysts) — this total can differ from price-target
              analysts ({analystsWithTargets != null ? Math.round(analystsWithTargets) : 'N/A'}) because Yahoo
              tracks them separately.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(
                [
                  ['Strong buy', ratingBreakdown.strongBuy, 'text-emerald-600 dark:text-emerald-400'],
                  ['Buy', ratingBreakdown.buy, 'text-emerald-600/80 dark:text-emerald-400/80'],
                  ['Hold', ratingBreakdown.hold, 'text-muted-foreground'],
                  ['Sell', ratingBreakdown.sell, 'text-red-600/80 dark:text-red-400/80'],
                  ['Strong sell', ratingBreakdown.strongSell, 'text-red-600 dark:text-red-400'],
                ] as const
              ).map(([label, count, color]) => (
                <div key={label} className="rounded-md border bg-background px-2.5 py-2 text-center">
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <div className={`text-base font-semibold tabular-nums ${color}`}>{count}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </SectionShell>

      <SectionShell title="Analyst price targets" description="Low · mean · median · high on one range line">
        <AnalystPriceTargetRange
          current={currentPrice}
          low={targetLow}
          mean={targetMean}
          median={targetMedian}
          high={targetHigh}
        />
      </SectionShell>

      <SectionShell
        title="Recommendation Trend History"
        description={trend.length ? `${trend.length} periods · totals use rating counts, not price-target count` : undefined}
      >
        {trend.length ? (
          <SimpleTable
            columns={[
              { key: 'period', label: 'Period' },
              { key: 'strongBuy', label: 'Strong buy', align: 'right' },
              { key: 'buy', label: 'Buy', align: 'right' },
              { key: 'hold', label: 'Hold', align: 'right' },
              { key: 'sell', label: 'Sell', align: 'right' },
              { key: 'strongSell', label: 'Strong sell', align: 'right' },
              { key: 'total', label: 'Total ratings', align: 'right' },
            ]}
            rows={trend.map((point) => {
              const strongBuy = rawNum(point.strongBuy) || 0
              const buy = rawNum(point.buy) || 0
              const hold = rawNum(point.hold) || 0
              const sell = rawNum(point.sell) || 0
              const strongSell = rawNum(point.strongSell) || 0
              return {
                period: recommendationPeriodLabel(point.period),
                strongBuy: String(strongBuy),
                buy: String(buy),
                hold: String(hold),
                sell: String(sell),
                strongSell: String(strongSell),
                total: String(strongBuy + buy + hold + sell + strongSell),
              }
            })}
          />
        ) : (
          <SectionEmpty message="No recommendation trend history returned. Wait for the Analyst module to finish loading, or check module progress." />
        )}
      </SectionShell>

      {sentiment ? (
        <SectionShell title="Bullish / Neutral / Bearish" description={`Based on ${sentiment.total} current ratings (rating distribution)`}>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-emerald-500" style={{ width: `${(sentiment.bullish / sentiment.total) * 100}%` }} />
            <div className="bg-muted-foreground/40" style={{ width: `${(sentiment.neutral / sentiment.total) * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${(sentiment.bearish / sentiment.total) * 100}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              Bullish{' '}
              <span className="font-medium">
                {sentiment.bullish} ({formatDecimal((sentiment.bullish / sentiment.total) * 100)}%)
              </span>
            </div>
            <div>
              Neutral{' '}
              <span className="font-medium">
                {sentiment.neutral} ({formatDecimal((sentiment.neutral / sentiment.total) * 100)}%)
              </span>
            </div>
            <div>
              Bearish{' '}
              <span className="font-medium">
                {sentiment.bearish} ({formatDecimal((sentiment.bearish / sentiment.total) * 100)}%)
              </span>
            </div>
          </div>
        </SectionShell>
      ) : null}

      <SectionShell title="Upgrades & downgrades" description={history.length ? `${history.length} firm actions · date, prior & new targets` : undefined}>
        {history.length ? (
          <SimpleTable
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'firm', label: 'Firm' },
              { key: 'action', label: 'Action' },
              { key: 'from', label: 'From grade' },
              { key: 'to', label: 'To grade' },
              { key: 'ptAction', label: 'Target action' },
              { key: 'priorTarget', label: 'Prior target', align: 'right' },
              { key: 'newTarget', label: 'New target', align: 'right' },
            ]}
            rows={history.slice(0, 150).map((entry) => {
              const prior = rawNum(entry.priorPriceTarget)
              const next = rawNum(entry.currentPriceTarget)
              // Yahoo often sends 0 for “no prior” — treat as missing.
              const priorDisplay = prior != null && prior > 0 ? `$${formatDecimal(prior)}` : '—'
              const newDisplay = next != null && next > 0 ? `$${formatDecimal(next)}` : '—'
              const dateRaw = entry.epochGradeDate ?? entry.gradeDate
              const dateStr = dateRaw != null ? rawStr(dateRaw) : '—'
              // Prefer calendar date only when we have a full timestamp string.
              const dateOnly =
                typeof dateStr === 'string' && dateStr.includes(',')
                  ? dateStr.split(',')[0] // "Jun 25, 2026" from locale, or keep full
                  : dateStr
              return {
                date: dateOnly,
                firm: String(entry.firm ?? '—'),
                action: humanizeLabel(String(entry.action ?? '—')),
                from: String(entry.fromGrade || '—'),
                to: String(entry.toGrade || '—'),
                ptAction: entry.priceTargetAction ? humanizeLabel(String(entry.priceTargetAction)) : '—',
                priorTarget: priorDisplay,
                newTarget: newDisplay,
              }
            })}
          />
        ) : (
          <SectionEmpty message="No upgrade/downgrade history returned by Yahoo Finance." />
        )}
      </SectionShell>
    </div>
  )
}

function formatEps(value: unknown): string {
  const n = rawNum(value)
  if (n == null) {
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? formatDecimal(parsed) : value
    }
    return '—'
  }
  return formatDecimal(n)
}

function formatMarginPct(value: unknown): string {
  const n = rawNum(value)
  if (n == null) return '—'
  // Yahoo profitMargin is usually a fraction (0.25 = 25%)
  const pct = Math.abs(n) <= 1 ? n * 100 : n
  return `${formatDecimal(pct)}%`
}

export function YahooEarningsSection({ data }: { data: YahooStructuredData }) {
  const history = (data.earningsHistory as { history?: Record<string, unknown>[] })?.history || []
  const trend = (data.earningsTrend as { trend?: Record<string, unknown>[] })?.trend || []
  const calendar = data.calendarEvents as {
    earnings?: {
      earningsDate?: unknown[]
      earningsCallDate?: unknown[]
      earningsAverage?: unknown
      earningsLow?: unknown
      earningsHigh?: unknown
      revenueAverage?: unknown
      revenueLow?: unknown
      revenueHigh?: unknown
      isEarningsDateEstimate?: unknown
    }
  } | null

  const earningsModule = (data.earnings || {}) as Record<string, unknown>
  const earningsChart = (earningsModule.earningsChart || {}) as Record<string, unknown>
  const financialsChart = (earningsModule.financialsChart || {}) as Record<string, unknown>
  const quarterlyEps = Array.isArray(earningsChart.quarterly) ? (earningsChart.quarterly as Record<string, unknown>[]) : []
  const yearlyFinancials = Array.isArray(financialsChart.yearly) ? (financialsChart.yearly as Record<string, unknown>[]) : []
  const quarterlyFinancials = Array.isArray(financialsChart.quarterly)
    ? (financialsChart.quarterly as Record<string, unknown>[])
    : []

  return (
    <div className="space-y-4">
      <SectionShell title="Next earnings" description="Upcoming report & consensus estimates">
        {calendar?.earnings || earningsChart.earningsDate ? (
          <KeyValueList
            pairs={[
              {
                label: 'Next earnings date',
                value: Array.isArray(calendar?.earnings?.earningsDate)
                  ? calendar!.earnings!.earningsDate!.map((d) => rawStr(d)).join(', ')
                  : Array.isArray(earningsChart.earningsDate)
                    ? (earningsChart.earningsDate as unknown[]).map((d) => rawStr(d)).join(', ')
                    : rawStr(earningsChart.earningsDate),
              },
              {
                label: 'Earnings call',
                value: Array.isArray(calendar?.earnings?.earningsCallDate)
                  ? calendar!.earnings!.earningsCallDate!.map((d) => rawStr(d)).join(', ')
                  : 'N/A',
              },
              {
                label: 'Date is estimate',
                value:
                  calendar?.earnings?.isEarningsDateEstimate == null && earningsChart.isEarningsDateEstimate == null
                    ? 'N/A'
                    : calendar?.earnings?.isEarningsDateEstimate === true ||
                        earningsChart.isEarningsDateEstimate === true
                      ? 'Yes'
                      : 'No',
              },
              {
                label: 'EPS estimate (avg)',
                value: formatEps(calendar?.earnings?.earningsAverage ?? earningsChart.currentQuarterEstimate),
              },
              {
                label: 'EPS estimate range',
                value:
                  calendar?.earnings?.earningsLow != null || calendar?.earnings?.earningsHigh != null
                    ? `${formatEps(calendar?.earnings?.earningsLow)} – ${formatEps(calendar?.earnings?.earningsHigh)}`
                    : 'N/A',
              },
              {
                label: 'Revenue estimate (avg)',
                value: formatStatementValue(calendar?.earnings?.revenueAverage),
              },
              {
                label: 'Revenue estimate range',
                value:
                  calendar?.earnings?.revenueLow != null || calendar?.earnings?.revenueHigh != null
                    ? `${formatStatementValue(calendar?.earnings?.revenueLow)} – ${formatStatementValue(calendar?.earnings?.revenueHigh)}`
                    : 'N/A',
              },
            ]}
          />
        ) : (
          <SectionEmpty message="No upcoming earnings calendar data." />
        )}
      </SectionShell>

      {/* Proper tables instead of dumping nested chart objects as one garbled line */}
      {quarterlyEps.length ? (
        <SectionShell title="Earnings chart (quarterly EPS)" description="Actual vs estimate by quarter">
          <SimpleTable
            columns={[
              { key: 'period', label: 'Period' },
              { key: 'fiscal', label: 'Fiscal quarter' },
              { key: 'actual', label: 'EPS actual', align: 'right' },
              { key: 'estimate', label: 'EPS estimate', align: 'right' },
              { key: 'diff', label: 'Difference', align: 'right' },
              { key: 'surprise', label: 'Surprise %', align: 'right' },
              { key: 'periodEnd', label: 'Period end' },
              { key: 'reported', label: 'Reported' },
            ]}
            rows={quarterlyEps.map((row) => ({
              period: String(row.date ?? row.calendarQuarter ?? '—'),
              fiscal: String(row.fiscalQuarter ?? '—'),
              actual: formatEps(row.actual),
              estimate: formatEps(row.estimate),
              diff: formatEps(row.difference),
              surprise: formatEps(row.surprisePct),
              periodEnd: rawStr(row.periodEndDate),
              reported: rawStr(row.reportedDate),
            }))}
          />
          <div className="mt-3">
            <KeyValueList
              pairs={[
                {
                  label: 'Current quarter estimate',
                  value:
                    earningsChart.currentQuarterEstimate != null
                      ? `${formatEps(earningsChart.currentQuarterEstimate)} (${String(earningsChart.currentCalendarQuarter || earningsChart.currentQuarterEstimateDate || '')} ${earningsChart.currentQuarterEstimateYear ?? ''})`.trim()
                      : 'N/A',
                },
                { label: 'Current fiscal quarter', value: rawStr(earningsChart.currentFiscalQuarter) },
                { label: 'Current period end', value: rawStr(earningsChart.currentPeriodEndDate) },
                {
                  label: 'Next earnings date',
                  value: Array.isArray(earningsChart.earningsDate)
                    ? (earningsChart.earningsDate as unknown[]).map((d) => rawStr(d)).join(', ')
                    : rawStr(earningsChart.earningsDate),
                },
                {
                  label: 'Earnings date is estimate',
                  value:
                    earningsChart.isEarningsDateEstimate == null
                      ? 'N/A'
                      : earningsChart.isEarningsDateEstimate === true
                        ? 'Yes'
                        : 'No',
                },
              ]}
            />
          </div>
        </SectionShell>
      ) : null}

      {yearlyFinancials.length ? (
        <SectionShell title="Financials chart (yearly)" description="Revenue, earnings and profit margin">
          <SimpleTable
            columns={[
              { key: 'year', label: 'Year' },
              { key: 'revenue', label: 'Revenue', align: 'right' },
              { key: 'earnings', label: 'Earnings', align: 'right' },
              { key: 'margin', label: 'Profit margin', align: 'right' },
            ]}
            rows={yearlyFinancials.map((row) => ({
              year: rawStr(row.date),
              revenue: formatStatementValue(row.revenue),
              earnings: formatStatementValue(row.earnings),
              margin: formatMarginPct(row.profitMargin),
            }))}
          />
        </SectionShell>
      ) : null}

      {quarterlyFinancials.length ? (
        <SectionShell title="Financials chart (quarterly)" description="Revenue and earnings by quarter">
          <SimpleTable
            columns={[
              { key: 'period', label: 'Period' },
              { key: 'fiscal', label: 'Fiscal quarter' },
              { key: 'revenue', label: 'Revenue', align: 'right' },
              { key: 'earnings', label: 'Earnings', align: 'right' },
            ]}
            rows={quarterlyFinancials.map((row) => ({
              period: String(row.date ?? '—'),
              fiscal: String(row.fiscalQuarter ?? '—'),
              revenue: formatStatementValue(row.revenue),
              earnings: formatStatementValue(row.earnings),
            }))}
          />
        </SectionShell>
      ) : null}

      {history.length ? (
        <SectionShell title="Earnings history">
          <SimpleTable
            columns={[
              { key: 'period', label: 'Period' },
              { key: 'epsActual', label: 'EPS actual', align: 'right' },
              { key: 'epsEstimate', label: 'EPS estimate', align: 'right' },
              { key: 'surprise', label: 'Surprise %', align: 'right' },
            ]}
            rows={history.map((row) => ({
              period: rawStr(row.quarter) || rawStr(row.period),
              epsActual: formatEps(row.epsActual),
              epsEstimate: formatEps(row.epsEstimate),
              surprise: formatEps(row.surprisePercent),
            }))}
          />
        </SectionShell>
      ) : null}

      {trend.length ? (
        <SectionShell title="Earnings & revenue estimates / trends">
          <SimpleTable
            columns={[
              { key: 'period', label: 'Period' },
              { key: 'growth', label: 'Growth', align: 'right' },
              { key: 'earningsAvg', label: 'EPS avg', align: 'right' },
              { key: 'revenueAvg', label: 'Revenue avg', align: 'right' },
              { key: 'numAnalysts', label: 'Analysts', align: 'right' },
            ]}
            rows={trend.map((row) => {
              const earningsEstimate = (row.earningsEstimate || {}) as Record<string, unknown>
              const revenueEstimate = (row.revenueEstimate || {}) as Record<string, unknown>
              return {
                period: rawStr(row.period),
                growth: formatMarginPct(row.growth),
                earningsAvg: formatEps(earningsEstimate.avg),
                revenueAvg: formatStatementValue(revenueEstimate.avg),
                numAnalysts: rawStr(earningsEstimate.numberOfAnalysts ?? revenueEstimate.numberOfAnalysts),
              }
            })}
          />
        </SectionShell>
      ) : null}

      {/* Only simple scalar leftovers — not nested chart blobs */}
      {earningsModule.financialCurrency != null || earningsModule.defaultMethodology != null ? (
        <SectionShell title="Earnings module meta">
          <KeyValueList
            pairs={[
              { label: 'Financial currency', value: rawStr(earningsModule.financialCurrency) },
              { label: 'Default methodology', value: rawStr(earningsModule.defaultMethodology) },
            ]}
          />
        </SectionShell>
      ) : null}
    </div>
  )
}

/** All dividend fields — yield, payout, dates, and historical payment events from the chart. */
export function YahooDividendSection({ data }: { data: YahooStructuredData }) {
  const calendar = data.calendarEvents as {
    exDividendDate?: unknown
    dividendDate?: unknown
  } | null

  const summary = (data.summaryDetail || {}) as Record<string, unknown>
  const quote = data.quote || ({} as YahooStructuredData['quote'])
  const stats = (data.defaultKeyStatistics || {}) as Record<string, unknown>
  const chart = data.chart as { events?: { dividends?: unknown } } | null
  const dividendEvents = asEventList(chart?.events?.dividends)

  // Sort newest first when dates are available.
  const sortedEvents = [...dividendEvents].sort((a, b) => {
    const ta = a.date ? new Date(String(a.date)).getTime() : 0
    const tb = b.date ? new Date(String(b.date)).getTime() : 0
    return tb - ta
  })

  const dividendRate =
    rawNum(summary.dividendRate) ?? rawNum((quote as { dividendRate?: unknown }).dividendRate)
  const summaryYield = rawNum(summary.dividendYield)
  const dividendYieldDisplay =
    // quote.dividendYield is often already in percent points (0.34); summaryDetail is a fraction (0.0034)
    quote.dividendYield != null
      ? `${formatDecimal(quote.dividendYield)}%`
      : summaryYield != null
        ? `${formatDecimal(summaryYield * (Math.abs(summaryYield) <= 1 ? 100 : 1))}%`
        : 'N/A'
  const trailingDivRate =
    rawNum(summary.trailingAnnualDividendRate) ?? rawNum(stats.trailingAnnualDividendRate)
  const trailingDivYield = rawNum(summary.trailingAnnualDividendYield)
  const fiveYearYield = rawNum(summary.fiveYearAvgDividendYield)
  const payoutRatio = rawNum(summary.payoutRatio)
  const lastDivValue = rawNum(stats.lastDividendValue)
  const exDivDate = calendar?.exDividendDate ?? summary.exDividendDate
  const divDate =
    calendar?.dividendDate ??
    (quote as { dividendDate?: unknown }).dividendDate ??
    summary.dividendDate
  const lastDivDate = stats.lastDividendDate

  // ETF / fund yield often lives under fund.yield
  const fundYield = data.fund?.yield != null ? data.fund.yield : null

  const hasDividend =
    exDivDate != null ||
    divDate != null ||
    dividendRate != null ||
    quote.dividendYield != null ||
    summaryYield != null ||
    trailingDivRate != null ||
    lastDivValue != null ||
    fundYield != null ||
    sortedEvents.length > 0

  // Optional cash-flow dividend line items if present in statements
  const annualSeries = data.statements?.fundamentalsTimeSeries_annual
  const cashDivFromSeries = Array.isArray(annualSeries)
    ? (annualSeries as Record<string, unknown>[])
        .map((row) => ({
          date: row.asOfDate || row.periodEndDate || row.date,
          cashDividendsPaid: row.cashDividendsPaid ?? row.commonStockDividendPaid,
        }))
        .filter((row) => row.cashDividendsPaid != null)
        .slice(-12)
        .reverse()
    : []

  return (
    <div className="space-y-4">
      <SectionShell
        title="Dividend summary"
        description={[data.companyName || data.symbol, data.currency].filter(Boolean).join(' · ') || undefined}
      >
        {hasDividend ? (
          <StatGrid
            stats={[
              {
                label: 'Dividend rate (annual)',
                value: dividendRate != null ? `$${formatDecimal(dividendRate)}` : 'N/A',
              },
              { label: 'Dividend yield', value: dividendYieldDisplay },
              {
                label: 'Fund / trailing yield',
                value:
                  fundYield != null
                    ? asFractionPercent(fundYield)
                    : trailingDivYield != null
                      ? `${formatDecimal(trailingDivYield * (Math.abs(trailingDivYield) <= 1 ? 100 : 1))}%`
                      : 'N/A',
              },
              {
                label: 'Trailing annual rate',
                value: trailingDivRate != null ? `$${formatDecimal(trailingDivRate)}` : 'N/A',
              },
              {
                label: '5-year avg yield',
                value: fiveYearYield != null ? `${formatDecimal(fiveYearYield)}%` : 'N/A',
              },
              {
                label: 'Payout ratio',
                value:
                  payoutRatio != null
                    ? `${formatDecimal(payoutRatio * (Math.abs(payoutRatio) <= 1 ? 100 : 1))}%`
                    : 'N/A',
              },
              {
                label: 'Last dividend amount',
                value: lastDivValue != null ? `$${formatDecimal(lastDivValue)}` : 'N/A',
              },
              {
                label: 'Ex-dividend date',
                value: rawStr(exDivDate ?? lastDivDate),
              },
            ]}
          />
        ) : (
          <SectionEmpty message="No dividend data returned for this ticker (common for non-dividend payers)." />
        )}
      </SectionShell>

      {hasDividend ? (
        <SectionShell title="Dates & calendar" description="From calendarEvents + summaryDetail">
          <KeyValueList
            pairs={[
              { label: 'Ex-dividend date', value: rawStr(exDivDate) },
              { label: 'Dividend payment date', value: rawStr(divDate) },
              { label: 'Last dividend date', value: rawStr(lastDivDate) },
              {
                label: 'Last dividend value',
                value: lastDivValue != null ? `$${formatDecimal(lastDivValue)}` : 'N/A',
              },
              {
                label: 'Annual dividend rate',
                value:
                  dividendRate != null
                    ? `$${formatDecimal(dividendRate)}`
                    : rawStr(summary.dividendRate),
              },
              { label: 'Dividend yield (quote)', value: dividendYieldDisplay },
              {
                label: 'Trailing annual dividend rate',
                value: trailingDivRate != null ? `$${formatDecimal(trailingDivRate)}` : 'N/A',
              },
              {
                label: 'Trailing annual dividend yield',
                value:
                  trailingDivYield != null
                    ? `${formatDecimal(trailingDivYield * (Math.abs(trailingDivYield) <= 1 ? 100 : 1))}%`
                    : 'N/A',
              },
              {
                label: '5-year avg dividend yield',
                value: fiveYearYield != null ? `${formatDecimal(fiveYearYield)}%` : 'N/A',
              },
              {
                label: 'Payout ratio',
                value:
                  payoutRatio != null
                    ? `${formatDecimal(payoutRatio * (Math.abs(payoutRatio) <= 1 ? 100 : 1))}%`
                    : 'N/A',
              },
            ]}
          />
        </SectionShell>
      ) : null}

      <SectionShell
        title="Dividend history"
        description={
          sortedEvents.length
            ? `${sortedEvents.length} payment event(s) from Yahoo chart · newest first`
            : 'From chart events (dividends)'
        }
      >
        {sortedEvents.length ? (
          <SimpleTable
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'amount', label: 'Amount', align: 'right' },
            ]}
            rows={sortedEvents.map((div, i) => ({
              date: div.date ? String(div.date).slice(0, 10) : '—',
              amount:
                rawNum(div.amount) != null
                  ? `$${formatDecimal(rawNum(div.amount))}`
                  : rawStr(div.amount),
              _key: `${div.date}-${i}`,
            }))}
          />
        ) : (
          <SectionEmpty message="No historical dividend events in the chart payload yet. Load Historical / chart data or refresh from Yahoo." />
        )}
      </SectionShell>

      {cashDivFromSeries.length ? (
        <SectionShell
          title="Cash dividends paid (annual statements)"
          description="From fundamentalsTimeSeries · cashDividendsPaid / commonStockDividendPaid"
        >
          <SimpleTable
            columns={[
              { key: 'period', label: 'Period' },
              { key: 'amount', label: 'Cash dividends paid', align: 'right' },
            ]}
            rows={cashDivFromSeries.map((row, i) => ({
              period: rawStr(row.date),
              amount: formatStatementValue(row.cashDividendsPaid),
              _key: String(row.date ?? i),
            }))}
          />
        </SectionShell>
      ) : null}

      <ObjectTable
        title="Dividend-related summaryDetail fields"
        data={Object.fromEntries(
          Object.entries(summary).filter(([key]) => /dividend|payout|yield/i.test(key)),
        )}
        description="Raw summaryDetail keys matching dividend / payout / yield"
      />
      <ObjectTable
        title="Dividend-related key statistics"
        data={Object.fromEntries(
          Object.entries(stats).filter(([key]) => /dividend|payout|yield/i.test(key)),
        )}
        description="Raw defaultKeyStatistics keys matching dividend / payout / yield"
      />
    </div>
  )
}

export function YahooFinancialsSection({ data }: { data: YahooStructuredData }) {
  const s = data.statements || {}
  const annual = s.fundamentalsTimeSeries_annual
  const quarterly = s.fundamentalsTimeSeries_quarterly
  const trailing = s.fundamentalsTimeSeries_trailing
  const hasSeries = Boolean(
    (Array.isArray(annual) && annual.length) ||
      (Array.isArray(quarterly) && quarterly.length) ||
      (Array.isArray(trailing) && trailing.length),
  )

  return (
    <div className="space-y-6">
      {/* Primary: fundamentalsTimeSeries split into the three statements */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Annual</h3>
        <StatementTable title="Income statement" series={annual} fields={INCOME_FIELDS} description="Annual · Yahoo fundamentals time series" />
        <StatementTable title="Balance sheet" series={annual} fields={BALANCE_FIELDS} description="Annual · Yahoo fundamentals time series" />
        <StatementTable title="Cash flow statement" series={annual} fields={CASHFLOW_FIELDS} description="Annual · Yahoo fundamentals time series" />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Quarterly</h3>
        <StatementTable title="Income statement" series={quarterly} fields={INCOME_FIELDS} description="Quarterly · Yahoo fundamentals time series" />
        <StatementTable title="Balance sheet" series={quarterly} fields={BALANCE_FIELDS} description="Quarterly · Yahoo fundamentals time series" />
        <StatementTable title="Cash flow statement" series={quarterly} fields={CASHFLOW_FIELDS} description="Quarterly · Yahoo fundamentals time series" />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Trailing twelve months (TTM)</h3>
        <StatementTable title="Income statement" series={trailing} fields={INCOME_FIELDS} description="Trailing · Yahoo fundamentals time series" />
        <StatementTable title="Balance sheet" series={trailing} fields={BALANCE_FIELDS} description="Trailing · Yahoo fundamentals time series" />
        <StatementTable title="Cash flow statement" series={trailing} fields={CASHFLOW_FIELDS} description="Trailing · Yahoo fundamentals time series" />
      </div>

      {/* Secondary fallbacks from quoteSummary (often sparse after 2024) */}
      {!hasSeries ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">QuoteSummary history (fallback)</h3>
          <QuoteSummaryStatementTable title="Income statement (annual history)" history={s.incomeStatementHistory} />
          <QuoteSummaryStatementTable title="Income statement (quarterly history)" history={s.incomeStatementHistoryQuarterly} />
          <QuoteSummaryStatementTable title="Balance sheet (annual history)" history={s.balanceSheetHistory} />
          <QuoteSummaryStatementTable title="Balance sheet (quarterly history)" history={s.balanceSheetHistoryQuarterly} />
          <QuoteSummaryStatementTable title="Cash flow (annual history)" history={s.cashflowStatementHistory} />
          <QuoteSummaryStatementTable title="Cash flow (quarterly history)" history={s.cashflowStatementHistoryQuarterly} />
        </div>
      ) : null}
    </div>
  )
}

function formatShareCount(value: unknown): string {
  const n = rawNum(value)
  if (n == null) return 'N/A'
  return formatNumber(n)
}

function formatRatioAsPercent(value: unknown): string {
  const n = rawNum(value)
  if (n == null) return 'N/A'
  // Yahoo often returns 0.002 for 0.2% (fraction) or already-small percent points.
  const pct = Math.abs(n) <= 1 ? n * 100 : n
  return `${formatDecimal(pct)}%`
}

/** Yahoo netSharePurchaseActivity — shown on Insider (and Ownership) tabs. */
function NetSharePurchaseActivityCard({ activity }: { activity: unknown }) {
  if (!activity || typeof activity !== 'object') {
    return (
      <SectionShell title="Net Share Purchase Activity">
        <SectionEmpty message="No net share purchase activity returned for this ticker." />
      </SectionShell>
    )
  }

  const a = activity as Record<string, unknown>
  // Ignore empty shells that only have maxAge.
  const meaningful = Object.entries(a).filter(([key, value]) => key !== 'maxAge' && value != null)
  if (!meaningful.length) {
    return (
      <SectionShell title="Net Share Purchase Activity">
        <SectionEmpty message="No net share purchase activity returned for this ticker." />
      </SectionShell>
    )
  }

  const period = a.period != null ? String(a.period) : null
  const periodLabel = period === '6m' ? 'Last 6 months' : period === '3m' ? 'Last 3 months' : period ? humanizeLabel(period) : null

  return (
    <SectionShell
      title="Net Share Purchase Activity"
      description={periodLabel ? `${periodLabel} · Yahoo Finance` : 'Yahoo Finance netSharePurchaseActivity'}
    >
      <StatGrid
        stats={[
          { label: 'Buy transactions', value: formatShareCount(a.buyInfoCount) },
          { label: 'Shares bought', value: formatShareCount(a.buyInfoShares) },
          { label: 'Buy % of insider shares', value: formatRatioAsPercent(a.buyPercentInsiderShares) },
          { label: 'Sell transactions', value: formatShareCount(a.sellInfoCount) },
          { label: 'Shares sold', value: formatShareCount(a.sellInfoShares) },
          { label: 'Sell % of insider shares', value: formatRatioAsPercent(a.sellPercentInsiderShares) },
          { label: 'Net transactions', value: formatShareCount(a.netInfoCount) },
          { label: 'Net shares', value: formatShareCount(a.netInfoShares) },
          { label: 'Net % of insider shares', value: formatRatioAsPercent(a.netPercentInsiderShares) },
          { label: 'Total insider shares', value: formatShareCount(a.totalInsiderShares) },
          { label: 'Net institutional shares buying', value: formatShareCount(a.netInstSharesBuying) },
          { label: 'Net institutional buy %', value: formatRatioAsPercent(a.netInstBuyingPercent) },
        ]}
      />
    </SectionShell>
  )
}

function OwnershipSummaryCard({ breakdown }: { breakdown: unknown }) {
  if (!breakdown || typeof breakdown !== 'object') {
    return (
      <SectionShell title="Ownership">
        <SectionEmpty message="No ownership breakdown returned for this ticker." />
      </SectionShell>
    )
  }
  const b = breakdown as Record<string, unknown>
  const insider = rawNum(b.insidersPercentHeld)
  const institutional = rawNum(b.institutionsPercentHeld)
  const institutionalFloat = rawNum(b.institutionsFloatPercentHeld)
  const institutionsCount = rawNum(b.institutionsCount)

  // Yahoo returns fractions (0.01631 = 1.631%). Convert to percent for display.
  const asPct = (n: number | null) => {
    if (n == null) return 'N/A'
    const pct = Math.abs(n) <= 1 ? n * 100 : n
    return `${formatDecimal(pct)}%`
  }

  if (insider == null && institutional == null && institutionsCount == null) {
    return (
      <SectionShell title="Ownership">
        <SectionEmpty message="No ownership breakdown returned for this ticker." />
      </SectionShell>
    )
  }

  return (
    <SectionShell title="Ownership" description="Major holders breakdown · Yahoo Finance">
      <StatGrid
        stats={[
          { label: 'Insider Ownership', value: asPct(insider) },
          { label: 'Institutional Ownership', value: asPct(institutional) },
          { label: 'Institutional (Float)', value: asPct(institutionalFloat) },
          {
            label: '# Institutions',
            value: institutionsCount != null ? Math.round(institutionsCount).toLocaleString('en-US') : 'N/A',
          },
        ]}
      />
    </SectionShell>
  )
}

export function YahooOwnershipSection({ data }: { data: YahooStructuredData }) {
  const ownership = data.ownership || {}
  const institutional = (ownership.institutionOwnership as { ownershipList?: Record<string, unknown>[] })?.ownershipList || []
  const funds = (ownership.fundOwnership as { ownershipList?: Record<string, unknown>[] })?.ownershipList || []
  const breakdown = ownership.majorHoldersBreakdown

  return (
    <div className="space-y-4">
      <OwnershipSummaryCard breakdown={breakdown} />
      <NetSharePurchaseActivityCard activity={ownership.netSharePurchaseActivity} />

      {institutional.length ? (
        <SectionShell title="Institutional holdings" description={`${institutional.length} holders`}>
          <SimpleTable
            columns={[
              { key: 'org', label: 'Organization' },
              { key: 'pct', label: '% held', align: 'right' },
              { key: 'position', label: 'Position', align: 'right' },
              { key: 'value', label: 'Value', align: 'right' },
              { key: 'change', label: '% change', align: 'right' },
              { key: 'date', label: 'Report date' },
            ]}
            rows={institutional.map((holder) => ({
              org: String(holder.organization ?? '—'),
              pct: formatRatioAsPercent(holder.pctHeld),
              position: formatShareCount(holder.position),
              value: formatStatementValue(holder.value),
              change: formatRatioAsPercent(holder.pctChange),
              date: rawStr((holder.reportDate as { fmt?: string })?.fmt ?? holder.reportDate),
            }))}
          />
        </SectionShell>
      ) : null}

      {funds.length ? (
        <SectionShell title="Fund holdings" description={`${funds.length} funds`}>
          <SimpleTable
            columns={[
              { key: 'org', label: 'Fund' },
              { key: 'pct', label: '% held', align: 'right' },
              { key: 'position', label: 'Position', align: 'right' },
              { key: 'value', label: 'Value', align: 'right' },
              { key: 'change', label: '% change', align: 'right' },
            ]}
            rows={funds.map((holder) => ({
              org: String(holder.organization ?? '—'),
              pct: formatRatioAsPercent(holder.pctHeld),
              position: formatShareCount(holder.position),
              value: formatStatementValue(holder.value),
              change: formatRatioAsPercent(holder.pctChange),
            }))}
          />
        </SectionShell>
      ) : null}

      <ObjectTable title="Major direct holders" data={ownership.majorDirectHolders} />
    </div>
  )
}

export function YahooInsiderSection({ data }: { data: YahooStructuredData }) {
  const insider = data.insider || {}
  const ownership = data.ownership || {}
  // netSharePurchaseActivity is fetched with ownership modules but belongs
  // with insider activity — surface it here (and still on Ownership).
  const netActivity = ownership.netSharePurchaseActivity ?? (insider as { netSharePurchaseActivity?: unknown }).netSharePurchaseActivity
  const holders = (insider.insiderHolders as { holders?: Record<string, unknown>[] })?.holders || []
  const transactions =
    (insider.insiderTransactions as { transactions?: Record<string, unknown>[] })?.transactions || []

  return (
    <div className="space-y-4">
      <NetSharePurchaseActivityCard activity={netActivity} />

      {holders.length ? (
        <SectionShell title="Insider roster" description={`${holders.length} insiders`}>
          <SimpleTable
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'relation', label: 'Relation' },
              { key: 'desc', label: 'Latest transaction' },
              { key: 'date', label: 'Date' },
              { key: 'direct', label: 'Direct position', align: 'right' },
            ]}
            rows={holders.map((holder) => ({
              name: String(holder.name ?? '—'),
              relation: String(holder.relation ?? '—'),
              desc: String(holder.transactionDescription ?? '—'),
              date: rawStr((holder.latestTransDate as { fmt?: string })?.fmt ?? holder.latestTransDate),
              direct: rawStr(holder.positionDirect),
            }))}
          />
        </SectionShell>
      ) : (
        <SectionShell title="Insider roster">
          <SectionEmpty message="No insider roster returned." />
        </SectionShell>
      )}

      {transactions.length ? (
        <SectionShell title="Insider transactions" description={`${transactions.length} transactions`}>
          <SimpleTable
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'filer', label: 'Filer' },
              { key: 'text', label: 'Description' },
              { key: 'shares', label: 'Shares', align: 'right' },
              { key: 'value', label: 'Value', align: 'right' },
              { key: 'url', label: 'Link' },
            ]}
            rows={transactions.slice(0, 100).map((tx) => ({
              date: rawStr((tx.startDate as { fmt?: string })?.fmt ?? tx.startDate),
              filer: String(tx.filerName ?? '—'),
              text: String(tx.transactionText || tx.ownership || '—'),
              shares: rawStr(tx.shares),
              value: rawStr(tx.value),
              url: tx.url ? (
                <a className="text-primary underline" href={String(tx.url)} rel="noreferrer" target="_blank">
                  SEC
                </a>
              ) : (
                '—'
              ),
            }))}
          />
        </SectionShell>
      ) : null}
    </div>
  )
}

function asEventList(value: unknown): Record<string, unknown>[] {
  if (!value) return []
  if (Array.isArray(value)) return value as Record<string, unknown>[]
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>) as Record<string, unknown>[]
  return []
}

export function YahooHistoricalSection({ data }: { data: YahooStructuredData }) {
  const chart = data.chart as {
    meta?: Record<string, unknown>
    quotes?: Record<string, unknown>[]
    events?: { dividends?: unknown; splits?: unknown }
  } | null

  const quotes = Array.isArray(chart?.quotes) ? chart.quotes : []
  const recent = quotes.slice(-30).reverse()
  const dividends = asEventList(chart?.events?.dividends)
  const splits = asEventList(chart?.events?.splits)

  return (
    <div className="space-y-4">
      <YahooInteractiveChart
        ticker={data.symbol || ''}
        initialChart={chart}
        title="Price chart (historical)"
        defaultRange="1y"
        height={340}
        timeZone={resolveExchangeTimeZone({
          exchangeTimezoneName:
            typeof chart?.meta?.exchangeTimezoneName === 'string'
              ? chart.meta.exchangeTimezoneName
              : null,
          exchange: data.exchange,
          symbol: data.symbol,
        })}
      />
      {chart?.meta ? <ObjectTable title="Chart meta" data={chart.meta} description="Exchange, currency, ranges" /> : null}
      {!chart ? (
        <SectionShell title="Historical prices">
          <SectionEmpty message="Bulk historical module not loaded yet — use the timeframe buttons on the chart above to load live data." />
        </SectionShell>
      ) : null}
      <SectionShell title="Recent daily prices" description="Last 30 sessions (full series in Citation → Raw JSON)">
        <SimpleTable
          columns={[
            { key: 'date', label: 'Date' },
            { key: 'open', label: 'Open', align: 'right' },
            { key: 'high', label: 'High', align: 'right' },
            { key: 'low', label: 'Low', align: 'right' },
            { key: 'close', label: 'Close', align: 'right' },
            { key: 'volume', label: 'Volume', align: 'right' },
          ]}
          rows={recent.map((row) => ({
            date: row.date ? String(row.date).slice(0, 10) : '—',
            open: rawStr(row.open),
            high: rawStr(row.high),
            low: rawStr(row.low),
            close: rawStr(row.close),
            volume: rawStr(row.volume),
          }))}
        />
      </SectionShell>

      {/* Dividend history lives under the Dividend tab */}
      {dividends.length ? (
        <p className="text-xs text-muted-foreground">
          {dividends.length} dividend event(s) in chart history — see the{' '}
          <span className="font-medium text-foreground">Dividend</span> tab for the full list.
        </p>
      ) : null}

      {splits.length ? (
        <SectionShell title="Stock splits" description={`${splits.length} events`}>
          <SimpleTable
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'split', label: 'Ratio' },
            ]}
            rows={splits.map((split) => ({
              date: (split as { date?: unknown }).date ? String((split as { date: unknown }).date).slice(0, 10) : '—',
              split: `${rawStr((split as { numerator?: unknown }).numerator)}:${rawStr((split as { denominator?: unknown }).denominator)}`,
            }))}
          />
        </SectionShell>
      ) : null}
    </div>
  )
}

export function YahooOptionsSection({ data }: { data: YahooStructuredData }) {
  const options = data.options as {
    expirationDates?: Array<string | number | Date>
    strikes?: number[]
    options?: Array<{ expirationDate?: unknown; calls?: Record<string, unknown>[]; puts?: Record<string, unknown>[] }>
    quote?: Record<string, unknown>
  } | null

  if (!options) {
    return (
      <SectionShell title="Options">
        <SectionEmpty message="No options chain returned for this ticker." />
      </SectionShell>
    )
  }

  const expirations = options.expirationDates || []
  const chain = options.options?.[0]
  const calls = chain?.calls || []
  const puts = chain?.puts || []

  return (
    <div className="space-y-4">
      <SectionShell title="Options expirations" description={`${expirations.length} expiration dates`}>
        <p className="text-sm text-muted-foreground">
          {expirations
            .slice(0, 24)
            .map((d) => String(d).slice(0, 10))
            .join(' · ') || 'None'}
          {expirations.length > 24 ? ` · +${expirations.length - 24} more` : ''}
        </p>
      </SectionShell>

      {calls.length ? (
        <SectionShell title="Calls (nearest expiration)" description={`${calls.length} contracts`}>
          <SimpleTable
            columns={[
              { key: 'strike', label: 'Strike', align: 'right' },
              { key: 'last', label: 'Last', align: 'right' },
              { key: 'bid', label: 'Bid', align: 'right' },
              { key: 'ask', label: 'Ask', align: 'right' },
              { key: 'vol', label: 'Volume', align: 'right' },
              { key: 'oi', label: 'Open interest', align: 'right' },
              { key: 'iv', label: 'IV', align: 'right' },
            ]}
            rows={calls.slice(0, 40).map((row) => ({
              strike: rawStr(row.strike),
              last: rawStr(row.lastPrice),
              bid: rawStr(row.bid),
              ask: rawStr(row.ask),
              vol: rawStr(row.volume),
              oi: rawStr(row.openInterest),
              iv: rawStr(row.impliedVolatility),
            }))}
          />
        </SectionShell>
      ) : null}

      {puts.length ? (
        <SectionShell title="Puts (nearest expiration)" description={`${puts.length} contracts`}>
          <SimpleTable
            columns={[
              { key: 'strike', label: 'Strike', align: 'right' },
              { key: 'last', label: 'Last', align: 'right' },
              { key: 'bid', label: 'Bid', align: 'right' },
              { key: 'ask', label: 'Ask', align: 'right' },
              { key: 'vol', label: 'Volume', align: 'right' },
              { key: 'oi', label: 'Open interest', align: 'right' },
              { key: 'iv', label: 'IV', align: 'right' },
            ]}
            rows={puts.slice(0, 40).map((row) => ({
              strike: rawStr(row.strike),
              last: rawStr(row.lastPrice),
              bid: rawStr(row.bid),
              ask: rawStr(row.ask),
              vol: rawStr(row.volume),
              oi: rawStr(row.openInterest),
              iv: rawStr(row.impliedVolatility),
            }))}
          />
        </SectionShell>
      ) : null}
    </div>
  )
}

export function YahooFilingsNewsSection({ data }: { data: YahooStructuredData }) {
  const filings = (data.secFilings as { filings?: Record<string, unknown>[] })?.filings || []
  const news = (data.search as { news?: Record<string, unknown>[] })?.news || []
  const related = (data.recommendationsBySymbol as { recommendedSymbols?: Record<string, unknown>[] })?.recommendedSymbols || []

  return (
    <div className="space-y-4">
      {filings.length ? (
        <SectionShell title="SEC filings (via Yahoo)" description={`${filings.length} filings`}>
          <SimpleTable
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'type', label: 'Type' },
              { key: 'title', label: 'Title' },
              { key: 'link', label: 'Link' },
            ]}
            rows={filings.slice(0, 50).map((filing) => ({
              date: rawStr(filing.epochDate ? epochToDate(filing.epochDate) : filing.date),
              type: String(filing.type ?? '—'),
              title: String(filing.title ?? '—'),
              link: filing.edgarUrl || filing.url ? (
                <a
                  className="text-primary underline"
                  href={String(filing.edgarUrl || filing.url)}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open
                </a>
              ) : (
                '—'
              ),
            }))}
          />
        </SectionShell>
      ) : (
        <SectionShell title="SEC filings (via Yahoo)">
          <SectionEmpty message="No SEC filings returned by Yahoo for this ticker." />
        </SectionShell>
      )}

      {news.length ? (
        <SectionShell title="News" description={`${news.length} articles from Yahoo search`}>
          <SimpleTable
            columns={[
              { key: 'title', label: 'Title' },
              { key: 'publisher', label: 'Publisher' },
              { key: 'link', label: 'Link' },
            ]}
            rows={news.map((article) => ({
              title: String(article.title ?? '—'),
              publisher: String(article.publisher ?? '—'),
              link: article.link ? (
                <a className="text-primary underline" href={String(article.link)} rel="noreferrer" target="_blank">
                  Open
                </a>
              ) : (
                '—'
              ),
            }))}
          />
        </SectionShell>
      ) : null}

      {related.length ? (
        <SectionShell title="Related / comparable tickers">
          <SimpleTable
            columns={[
              { key: 'symbol', label: 'Symbol' },
              { key: 'score', label: 'Score', align: 'right' },
            ]}
            rows={related.map((item) => ({
              symbol: String(item.symbol ?? '—'),
              score: rawStr(item.score),
            }))}
          />
        </SectionShell>
      ) : null}

      <ObjectTable title="Index / sector / industry trends" data={data.trends} />
    </div>
  )
}

/** Normalize Yahoo list-or-map payloads into a plain array of row objects. */
function asObjectRows(value: unknown): Record<string, unknown>[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[]
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // Common wrappers: { researchReports: [...] } or a keyed map of report objects
    for (const key of ['researchReports', 'reports', 'items', 'result']) {
      if (Array.isArray(obj[key])) return asObjectRows(obj[key])
      // Single report object nested under researchReports
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        const nested = obj[key] as Record<string, unknown>
        if (nested.reportId != null || nested.provider != null || nested.title != null || nested.summary != null) {
          return [nested]
        }
      }
    }
    // Already a single report/event row
    if (obj.reportId != null || obj.provider != null || obj.headline != null || obj.eventType != null || obj.formType != null) {
      return [obj]
    }
    return Object.values(obj).filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<
      string,
      unknown
    >[]
  }
  return []
}

function asTextLines(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object') return rawStr(item)
        return item == null ? '' : String(item)
      })
      .filter((line) => line && line !== 'N/A' && line !== '—')
  }
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  return []
}

export function YahooInsightsSection({ data }: { data: YahooStructuredData }) {
  try {
    return <YahooInsightsSectionInner data={data} />
  } catch (error) {
    return (
      <SectionShell title="Research & Outlook">
        <SectionError
          message={
            error instanceof Error
              ? `Research & Outlook failed to render: ${error.message}`
              : 'Research & Outlook failed to render due to unexpected Yahoo data shape.'
          }
        />
      </SectionShell>
    )
  }
}

function providerFrom(...sources: unknown[]): string | null {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    const p = (source as { provider?: unknown }).provider
    if (typeof p === 'string' && p.trim()) return p.trim()
  }
  return null
}

/** One bordered box per data provider. */
function ProviderBox({
  provider,
  subtitle,
  children,
}: {
  provider: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Data provider</p>
          <h3 className="truncate text-base font-semibold tracking-tight text-foreground">{provider}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-600 dark:text-violet-400">
          {provider}
        </span>
      </div>
      <div className="space-y-5 p-4">{children}</div>
    </div>
  )
}

function ProviderSubSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}

/** Flatten a plain object into KeyValue pairs (no skipped nested scalars). */
function objectToPairs(obj: Record<string, unknown>, opts?: { exclude?: string[]; prefix?: string }) {
  const exclude = new Set(opts?.exclude || ['maxAge'])
  const pairs: { label: string; value: ReactNode }[] = []
  for (const [key, value] of Object.entries(obj)) {
    if (exclude.has(key)) continue
    if (value == null) continue
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !('raw' in (value as object))) {
      const nested = objectToPairs(value as Record<string, unknown>, {
        exclude: opts?.exclude,
        prefix: opts?.prefix ? `${opts.prefix} · ${humanizeLabel(key)}` : humanizeLabel(key),
      })
      pairs.push(...nested)
      continue
    }
    if (Array.isArray(value)) {
      pairs.push({
        label: opts?.prefix ? `${opts.prefix} · ${humanizeLabel(key)}` : humanizeLabel(key),
        value: rawStr(value),
      })
      continue
    }
    pairs.push({
      label: opts?.prefix ? `${opts.prefix} · ${humanizeLabel(key)}` : humanizeLabel(key),
      value: rawStr(value),
    })
  }
  return pairs.filter((p) => p.value !== 'N/A' && p.value !== '—' && p.value !== '[object Object]')
}

function scoreAsPercent(value: unknown): string {
  const n = rawNum(value)
  if (n == null) return 'N/A'
  if (n >= 0 && n <= 1) return `${formatDecimal(n * 100)}%`
  return formatDecimal(n)
}

function researchTitle(item: Record<string, unknown>): string {
  const title = rawStr(item.reportTitle || item.title || item.headHtml || item.headline)
  return title.replace(/<[^>]+>/g, '').trim() || 'Untitled research'
}

function researchId(item: Record<string, unknown>, index: number): string {
  const id = rawStr(item.reportId || item.id)
  if (id && id !== 'N/A' && id !== '—') return id
  return `research-${index}-${researchTitle(item).slice(0, 40)}`
}

function dedupeResearch(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  items.forEach((item, index) => {
    const key = researchId(item, index)
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  })
  return out
}

function ResearchDetailPanel({ item }: { item: Record<string, unknown> }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {item.provider != null ? (
            <span className="rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-400">
              Provider: {rawStr(item.provider)}
            </span>
          ) : null}
          {(item.reportDate != null || item.date != null) && (
            <span className="text-xs text-muted-foreground">{rawStr(item.reportDate || item.date)}</span>
          )}
        </div>
        <h3 className="text-lg font-semibold tracking-tight text-foreground">{researchTitle(item)}</h3>
      </div>

      {(item.summary != null || item.headHtml != null || item.description != null) && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">Summary / full text</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {rawStr(item.summary || item.headHtml || item.description).replace(/<[^>]+>/g, '')}
          </p>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">All fields from this research</p>
        <KeyValueList
          pairs={[
            { label: 'Provider', value: rawStr(item.provider) },
            { label: 'Title', value: researchTitle(item) },
            { label: 'Date', value: rawStr(item.reportDate || item.date) },
            { label: 'Report id', value: rawStr(item.reportId || item.id) },
            {
              label: 'Tickers',
              value: Array.isArray(item.tickers)
                ? (item.tickers as unknown[]).map((t) => rawStr(t)).join(', ')
                : rawStr(item.tickers),
            },
            ...objectToPairs(item, {
              exclude: [
                'maxAge',
                'provider',
                'title',
                'reportTitle',
                'headHtml',
                'reportDate',
                'date',
                'reportId',
                'id',
                'summary',
                'description',
                'tickers',
              ],
            }),
          ]}
        />
      </div>
    </div>
  )
}

function YahooInsightsSectionInner({ data }: { data: YahooStructuredData }) {
  const insights = data.insights as Record<string, unknown> | null
  const [selectedResearchId, setSelectedResearchId] = useState<string | null>(null)
  const [researchProviderTab, setResearchProviderTab] = useState<string>('')

  const parsed = useMemo(() => {
    if (!insights || typeof insights !== 'object') return null

    const instrumentInfo = (insights.instrumentInfo && typeof insights.instrumentInfo === 'object'
      ? insights.instrumentInfo
      : {}) as Record<string, unknown>
    const technicalEvents = (instrumentInfo.technicalEvents && typeof instrumentInfo.technicalEvents === 'object'
      ? instrumentInfo.technicalEvents
      : {}) as Record<string, unknown>
    const keyTechnicals = (instrumentInfo.keyTechnicals && typeof instrumentInfo.keyTechnicals === 'object'
      ? instrumentInfo.keyTechnicals
      : {}) as Record<string, unknown>
    const valuation = (instrumentInfo.valuation && typeof instrumentInfo.valuation === 'object'
      ? instrumentInfo.valuation
      : {}) as Record<string, unknown>
    const companySnapshot = (insights.companySnapshot && typeof insights.companySnapshot === 'object'
      ? insights.companySnapshot
      : {}) as Record<string, unknown>
    const company = (companySnapshot.company && typeof companySnapshot.company === 'object'
      ? companySnapshot.company
      : {}) as Record<string, unknown>
    const sector = (companySnapshot.sector && typeof companySnapshot.sector === 'object'
      ? companySnapshot.sector
      : {}) as Record<string, unknown>
    const recommendation = (insights.recommendation && typeof insights.recommendation === 'object'
      ? insights.recommendation
      : {}) as Record<string, unknown>
    const upsell = (insights.upsell && typeof insights.upsell === 'object' ? insights.upsell : {}) as Record<string, unknown>
    const upsellSearchDD =
      insights.upsellSearchDD && typeof insights.upsellSearchDD === 'object'
        ? (insights.upsellSearchDD as Record<string, unknown>)
        : {}

    const events = asObjectRows(insights.events)
    const reports = asObjectRows(insights.reports)
    const sigDevs = asObjectRows(insights.sigDevs)
    const secReports = asObjectRows(insights.secReports)
    const researchReports = asObjectRows(upsellSearchDD.researchReports ?? upsellSearchDD)
    const allResearch = dedupeResearch([...reports, ...researchReports])

    // Group research by provider for sub-tabs
    const byProvider = new Map<string, Record<string, unknown>[]>()
    for (const item of allResearch) {
      const p = rawStr(item.provider)
      const key = p && p !== 'N/A' && p !== '—' ? p : 'Other providers'
      if (!byProvider.has(key)) byProvider.set(key, [])
      byProvider.get(key)!.push(item)
    }
    const providerTabs = Array.from(byProvider.keys()).sort((a, b) => a.localeCompare(b))

    const bullish = asTextLines(upsell.msBullishSummary)
    const bearish = asTextLines(upsell.msBearishSummary)
    const recommendationProvider = providerFrom(recommendation)
    const technicalProvider = providerFrom(technicalEvents, keyTechnicals, valuation)

    const knownTopKeys = new Set([
      'symbol',
      'instrumentInfo',
      'companySnapshot',
      'recommendation',
      'upsell',
      'upsellSearchDD',
      'events',
      'reports',
      'sigDevs',
      'secReports',
    ])
    const extraTopLevel = Object.fromEntries(
      Object.entries(insights).filter(([key]) => !knownTopKeys.has(key) && key !== 'error'),
    )

    const companyMetricKeys = Array.from(
      new Set([
        ...Object.keys(company),
        ...Object.keys(sector),
        'innovativeness',
        'hiring',
        'sustainability',
        'insiderSentiments',
        'earningsReports',
        'dividends',
      ]),
    )

    return {
      technicalEvents,
      keyTechnicals,
      valuation,
      companySnapshot,
      company,
      sector,
      recommendation,
      upsell,
      events,
      sigDevs,
      secReports,
      allResearch,
      byProvider,
      providerTabs,
      bullish,
      bearish,
      recommendationProvider,
      technicalProvider,
      extraTopLevel,
      companyMetricKeys,
      sectorLabel: rawStr(companySnapshot.sectorInfo),
      targetPrice: rawNum(recommendation.targetPrice),
      tradingCentralName: technicalProvider || 'Trading Central',
      argusName: recommendationProvider || 'Argus Research',
    }
  }, [insights])

  if (!insights || typeof insights !== 'object' || !parsed) {
    return (
      <SectionShell title="Research & Outlook">
        <SectionEmpty message="No research/outlook data returned by Yahoo Finance for this ticker. Wait for the module to finish loading." />
      </SectionShell>
    )
  }

  const {
    technicalEvents,
    keyTechnicals,
    valuation,
    company,
    sector,
    recommendation,
    upsell,
    events,
    sigDevs,
    secReports,
    allResearch,
    byProvider,
    providerTabs,
    bullish,
    bearish,
    extraTopLevel,
    companyMetricKeys,
    sectorLabel,
    targetPrice,
    tradingCentralName,
    argusName,
  } = parsed

  return (
    <div className="space-y-4">
      <SectionShell
        title="Research & Outlook"
        description={`${rawStr(insights.symbol || data.symbol || '')} · Insights · Company research · Developments · Other`}
      >
        <Tabs defaultValue="insights" className="gap-4">
          <TabsList className="flex h-auto flex-wrap">
            <TabsTrigger value="insights">Insights</TabsTrigger>
            <TabsTrigger value="research">
              Company research & reports{allResearch.length ? ` (${allResearch.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="developments">
              Significant developments{sigDevs.length ? ` (${sigDevs.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="other">Other</TabsTrigger>
          </TabsList>

          {/* ═══════════════ 1) INSIGHTS — sub-tabs per data provider ═══════════════ */}
          <TabsContent value="insights" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Har data provider ka alag sub-tab — naam pe click karke uska content kholo.
            </p>

            {(() => {
              const hasArgus = Object.keys(recommendation).length > 0
              const hasTradingCentral =
                Object.keys(keyTechnicals).length > 0 ||
                Object.keys(valuation).length > 0 ||
                Object.keys(technicalEvents).length > 0
              const hasMorningstar = bullish.length > 0 || bearish.length > 0 || Object.keys(upsell).length > 0
              const hasYahoo =
                companyMetricKeys.some((k) => company[k] != null || sector[k] != null) ||
                Boolean(sectorLabel && sectorLabel !== '—' && sectorLabel !== 'N/A')

              type InsightProviderTab = {
                id: string
                label: string
                subtitle: string
                content: ReactNode
              }

              const insightProviders: InsightProviderTab[] = []

              if (hasArgus) {
                insightProviders.push({
                  id: 'argus',
                  label: argusName,
                  subtitle: 'Analyst rating & price target',
                  content: (
                    <ProviderSubSection title="Recommendation">
                      <StatGrid
                        stats={[
                          { label: 'Rating', value: rawStr(recommendation.rating) },
                          {
                            label: 'Target price',
                            value: targetPrice != null ? `$${formatDecimal(targetPrice)}` : 'N/A',
                          },
                          { label: 'Provider', value: argusName },
                        ]}
                      />
                      <div className="mt-3">
                        <KeyValueList
                          pairs={objectToPairs(recommendation, {
                            exclude: ['rating', 'targetPrice', 'provider'],
                          })}
                        />
                      </div>
                    </ProviderSubSection>
                  ),
                })
              }

              if (hasTradingCentral) {
                insightProviders.push({
                  id: 'trading-central',
                  label: tradingCentralName,
                  subtitle: 'Technicals, valuation & multi-horizon outlook',
                  content: (
                    <div className="space-y-5">
                      {Object.keys(keyTechnicals).length ? (
                        <ProviderSubSection title="Price levels">
                          <StatGrid
                            stats={[
                              {
                                label: 'Support',
                                value:
                                  rawNum(keyTechnicals.support) != null
                                    ? `$${formatDecimal(rawNum(keyTechnicals.support))}`
                                    : rawStr(keyTechnicals.support),
                              },
                              {
                                label: 'Resistance',
                                value:
                                  rawNum(keyTechnicals.resistance) != null
                                    ? `$${formatDecimal(rawNum(keyTechnicals.resistance))}`
                                    : rawStr(keyTechnicals.resistance),
                              },
                              {
                                label: 'Stop loss',
                                value:
                                  rawNum(keyTechnicals.stopLoss) != null
                                    ? `$${formatDecimal(rawNum(keyTechnicals.stopLoss))}`
                                    : rawStr(keyTechnicals.stopLoss),
                              },
                            ]}
                          />
                        </ProviderSubSection>
                      ) : null}

                      {Object.keys(valuation).length ? (
                        <ProviderSubSection title="Relative valuation">
                          <StatGrid
                            stats={[
                              { label: 'Assessment', value: rawStr(valuation.description) },
                              { label: 'Relative value', value: rawStr(valuation.relativeValue) },
                              { label: 'Discount / premium', value: rawStr(valuation.discount) },
                            ]}
                          />
                        </ProviderSubSection>
                      ) : null}

                      {technicalEvents.sector != null ? (
                        <ProviderSubSection title="Market context">
                          <KeyValueList pairs={[{ label: 'Sector', value: rawStr(technicalEvents.sector) }]} />
                        </ProviderSubSection>
                      ) : null}

                      {(['shortTermOutlook', 'intermediateTermOutlook', 'longTermOutlook'] as const).map(
                        (horizon) => {
                          const outlook = technicalEvents[horizon]
                          if (!outlook || typeof outlook !== 'object') return null
                          const o = outlook as Record<string, unknown>
                          const title =
                            horizon === 'shortTermOutlook'
                              ? 'Short-term outlook'
                              : horizon === 'intermediateTermOutlook'
                                ? 'Medium-term outlook'
                                : 'Long-term outlook'
                          return (
                            <ProviderSubSection key={horizon} title={title}>
                              <StatGrid
                                stats={[
                                  { label: 'Direction', value: rawStr(o.direction) },
                                  { label: 'Score', value: o.score != null ? rawStr(o.score) : 'N/A' },
                                  { label: 'Signal', value: rawStr(o.scoreDescription) },
                                  { label: 'Summary', value: rawStr(o.stateDescription) },
                                ]}
                              />
                              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <div className="rounded-lg border bg-muted/30 p-3">
                                  <p className="mb-2 text-xs font-semibold">Vs sector</p>
                                  <KeyValueList
                                    pairs={[
                                      { label: 'Direction', value: rawStr(o.sectorDirection) },
                                      { label: 'Score', value: rawStr(o.sectorScore) },
                                      { label: 'Signal', value: rawStr(o.sectorScoreDescription) },
                                    ]}
                                  />
                                </div>
                                <div className="rounded-lg border bg-muted/30 p-3">
                                  <p className="mb-2 text-xs font-semibold">Vs market index</p>
                                  <KeyValueList
                                    pairs={[
                                      { label: 'Direction', value: rawStr(o.indexDirection) },
                                      { label: 'Score', value: rawStr(o.indexScore) },
                                      { label: 'Signal', value: rawStr(o.indexScoreDescription) },
                                    ]}
                                  />
                                </div>
                              </div>
                            </ProviderSubSection>
                          )
                        },
                      )}
                    </div>
                  ),
                })
              }

              if (hasMorningstar) {
                insightProviders.push({
                  id: 'morningstar',
                  label: 'Morningstar',
                  subtitle: 'Bullish / bearish thesis points',
                  content: (
                    <div className="space-y-5">
                      {Object.keys(upsell).some(
                        (k) => !['msBullishSummary', 'msBearishSummary', 'maxAge'].includes(k),
                      ) ? (
                        <ProviderSubSection title="Report meta">
                          <KeyValueList
                            pairs={objectToPairs(upsell, {
                              exclude: ['maxAge', 'msBullishSummary', 'msBearishSummary'],
                            })}
                          />
                        </ProviderSubSection>
                      ) : null}
                      {bullish.length || bearish.length ? (
                        <ProviderSubSection title="Bullish vs bearish">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                              <p className="mb-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                Bullish ({bullish.length})
                              </p>
                              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                                {bullish.map((line, i) => (
                                  <li key={i}>{line}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                              <p className="mb-2 text-xs font-semibold text-red-600 dark:text-red-400">
                                Bearish ({bearish.length})
                              </p>
                              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                                {bearish.map((line, i) => (
                                  <li key={i}>{line}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </ProviderSubSection>
                      ) : null}
                    </div>
                  ),
                })
              }

              if (hasYahoo) {
                insightProviders.push({
                  id: 'yahoo',
                  label: 'Yahoo Finance',
                  subtitle: 'Company vs sector snapshot scores',
                  content: (
                    <ProviderSubSection title="Company vs sector snapshot" description="Percentile scores 0–100%">
                      {sectorLabel && sectorLabel !== '—' && sectorLabel !== 'N/A' ? (
                        <p className="mb-2 text-sm text-muted-foreground">
                          Sector: <span className="font-medium text-foreground">{sectorLabel}</span>
                        </p>
                      ) : null}
                      <SimpleTable
                        columns={[
                          { key: 'metric', label: 'Metric' },
                          { key: 'company', label: 'Company', align: 'right' },
                          { key: 'sector', label: 'Sector avg', align: 'right' },
                        ]}
                        rows={companyMetricKeys
                          .filter((key) => company[key] != null || sector[key] != null)
                          .map((key) => ({
                            metric: humanizeLabel(key),
                            company: scoreAsPercent(company[key]),
                            sector: scoreAsPercent(sector[key]),
                          }))}
                      />
                    </ProviderSubSection>
                  ),
                })
              }

              if (!insightProviders.length) {
                return <SectionEmpty message="No insights providers returned for this ticker yet." />
              }

              return (
                <Tabs defaultValue={insightProviders[0].id} className="gap-3">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Data providers</p>
                    <TabsList className="flex h-auto flex-wrap">
                      {insightProviders.map((p) => (
                        <TabsTrigger key={p.id} value={p.id}>
                          {p.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </div>

                  {insightProviders.map((p) => (
                    <TabsContent key={p.id} value={p.id} className="mt-0">
                      <ProviderBox provider={p.label} subtitle={p.subtitle}>
                        {p.content}
                      </ProviderBox>
                    </TabsContent>
                  ))}
                </Tabs>
              )
            })()}
          </TabsContent>

          {/* ═══════════════ 2) COMPANY RESEARCH & REPORTS ═══════════════ */}
          <TabsContent value="research" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Providers ke sub-tabs · har provider ke research titles · title pe click = full research detail.
            </p>

            {!allResearch.length ? (
              <SectionEmpty message="No company research reports returned by Yahoo for this ticker." />
            ) : (
              <Tabs
                value={
                  researchProviderTab && byProvider.has(researchProviderTab)
                    ? researchProviderTab
                    : providerTabs[0] || 'none'
                }
                onValueChange={(value) => {
                  setResearchProviderTab(value)
                  setSelectedResearchId(null)
                }}
                className="gap-3"
              >
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Data providers</p>
                  <TabsList className="flex h-auto flex-wrap">
                    {providerTabs.map((name) => (
                      <TabsTrigger key={name} value={name}>
                        {name}
                        <span className="ml-1 text-muted-foreground">({byProvider.get(name)?.length || 0})</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                {providerTabs.map((name) => {
                  const items = byProvider.get(name) || []
                  const selected =
                    items.find((item, index) => researchId(item, index) === selectedResearchId) || items[0] || null
                  const activeId = selected ? researchId(selected, Math.max(0, items.indexOf(selected))) : null

                  return (
                    <TabsContent key={name} value={name} className="mt-0">
                      <ProviderBox provider={name} subtitle={`${items.length} research report(s) · click a title for full detail`}>
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_1fr]">
                          <div className="rounded-lg border bg-muted/20">
                            <div className="border-b px-3 py-2">
                              <p className="text-xs font-semibold">Research titles</p>
                              <p className="text-[11px] text-muted-foreground">Provider: {name}</p>
                            </div>
                            <div className="max-h-[26rem] space-y-0.5 overflow-y-auto p-1.5">
                              {items.map((item, index) => {
                                const id = researchId(item, index)
                                const active = id === activeId
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    onClick={() => setSelectedResearchId(id)}
                                    className={cn(
                                      'flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                                      active
                                        ? 'bg-violet-500/15 text-foreground'
                                        : 'text-foreground hover:bg-muted/60',
                                    )}
                                  >
                                    <span className="line-clamp-2 font-medium leading-snug">{researchTitle(item)}</span>
                                    <span className="text-[11px] text-muted-foreground">
                                      {rawStr(item.reportDate || item.date)}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                          <div className="min-w-0 rounded-lg border bg-background p-4">
                            {selected ? (
                              <ResearchDetailPanel item={selected} />
                            ) : (
                              <SectionEmpty message="Select a research title." />
                            )}
                          </div>
                        </div>
                      </ProviderBox>
                    </TabsContent>
                  )
                })}
              </Tabs>
            )}
          </TabsContent>

          {/* ═══════════════ 3) SIGNIFICANT DEVELOPMENTS ═══════════════ */}
          <TabsContent value="developments" className="space-y-4">
            <ProviderBox provider="Yahoo Finance" subtitle="Significant company developments">
              {sigDevs.length ? (
                <ProviderSubSection title="Significant developments" description={`${sigDevs.length} items`}>
                  <SimpleTable
                    columns={[
                      { key: 'date', label: 'Date' },
                      { key: 'headline', label: 'Headline' },
                    ]}
                    rows={sigDevs.map((item) => ({
                      date: rawStr(item.date),
                      headline: rawStr(item.headline),
                    }))}
                  />
                </ProviderSubSection>
              ) : (
                <SectionEmpty message="No significant developments returned for this ticker." />
              )}
            </ProviderBox>
          </TabsContent>

          {/* ═══════════════ 4) OTHER ═══════════════ */}
          <TabsContent value="other" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Technical chart events, SEC filings via Yahoo, and any remaining fields — everything that is not Insights
              ratings, company research reports, or significant developments.
            </p>

            {events.length ? (
              <ProviderBox provider={tradingCentralName} subtitle="Technical / chart events">
                <ProviderSubSection title="Technical events" description={`${events.length} events`}>
                  <SimpleTable
                    columns={[
                      { key: 'type', label: 'Event type' },
                      { key: 'period', label: 'Period' },
                      { key: 'horizon', label: 'Horizon' },
                      { key: 'trade', label: 'Trade type' },
                      { key: 'start', label: 'Start' },
                      { key: 'end', label: 'End' },
                    ]}
                    rows={events.map((item) => ({
                      type: rawStr(item.eventType),
                      period: rawStr(item.pricePeriod),
                      horizon: rawStr(item.tradingHorizon),
                      trade: rawStr(item.tradeType),
                      start: rawStr(item.startDate),
                      end: rawStr(item.endDate),
                    }))}
                  />
                </ProviderSubSection>
              </ProviderBox>
            ) : null}

            {secReports.length ? (
              <ProviderBox provider="Yahoo Finance" subtitle="SEC filings linked through Yahoo insights">
                <ProviderSubSection title="SEC filings" description={`${secReports.length} filings`}>
                  <SimpleTable
                    columns={[
                      { key: 'date', label: 'Date' },
                      { key: 'form', label: 'Form' },
                      { key: 'title', label: 'Title' },
                      { key: 'description', label: 'Description' },
                      { key: 'links', label: 'Links' },
                    ]}
                    rows={secReports.map((item) => ({
                      date: rawStr(item.filingDate || item.date),
                      form: rawStr(item.formType || item.type),
                      title: rawStr(item.title),
                      description: rawStr(item.description),
                      links: (
                        <span className="flex flex-col gap-0.5">
                          {item.edgarUrl ? (
                            <a className="text-primary underline" href={String(item.edgarUrl)} rel="noreferrer" target="_blank">
                              EDGAR
                            </a>
                          ) : null}
                          {item.snapshotUrl ? (
                            <a
                              className="text-primary underline"
                              href={String(item.snapshotUrl)}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Snapshot
                            </a>
                          ) : null}
                          {!item.edgarUrl && !item.snapshotUrl ? '—' : null}
                        </span>
                      ),
                    }))}
                  />
                  {secReports.some((item) => Array.isArray(item.exhibits) && (item.exhibits as unknown[]).length) ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Exhibit links</p>
                      {secReports.slice(0, 8).map((item) => {
                        const exhibits = Array.isArray(item.exhibits) ? (item.exhibits as Record<string, unknown>[]) : []
                        if (!exhibits.length) return null
                        return (
                          <div key={rawStr(item.id || item.title)} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                            <p className="mb-1 font-medium">
                              {rawStr(item.formType || item.type)} · {rawStr(item.filingDate)}
                            </p>
                            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                              {exhibits.map((ex, i) => (
                                <li key={i}>
                                  {ex.url ? (
                                    <a className="text-primary underline" href={String(ex.url)} rel="noreferrer" target="_blank">
                                      {rawStr(ex.type || 'Exhibit')}
                                    </a>
                                  ) : (
                                    rawStr(ex.type || ex)
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </ProviderSubSection>
              </ProviderBox>
            ) : null}

            {Object.keys(extraTopLevel).length ? (
              <ProviderBox provider="Yahoo Finance" subtitle="Additional top-level fields">
                <ProviderSubSection title="Extra fields">
                  <KeyValueList pairs={objectToPairs(extraTopLevel)} />
                </ProviderSubSection>
              </ProviderBox>
            ) : null}

            {!events.length && !secReports.length && !Object.keys(extraTopLevel).length ? (
              <SectionEmpty message="No additional items in Other for this ticker." />
            ) : null}

            <SectionShell title="Complete insights payload" description="Full raw insights JSON · nothing filtered">
              <pre className="max-h-96 overflow-auto rounded-lg bg-muted/30 p-3 text-xs">{JSON.stringify(insights, null, 2)}</pre>
            </SectionShell>
          </TabsContent>
        </Tabs>
      </SectionShell>
    </div>
  )
}

export function YahooRawJsonSection({
  rawJson,
  moduleStatus,
  structured,
}: {
  rawJson: Record<string, unknown>
  moduleStatus: Record<string, unknown>
  structured: YahooStructuredData | null
}) {
  return (
    <div className="space-y-4">
      <SectionShell title="Complete raw Yahoo response" description="Every module payload preserved without field filtering">
        <pre className="max-h-[70vh] overflow-auto rounded-lg bg-muted/30 p-3 text-xs">{JSON.stringify(rawJson, null, 2)}</pre>
      </SectionShell>
      <SectionShell title="Module status map">
        <pre className="max-h-96 overflow-auto rounded-lg bg-muted/30 p-3 text-xs">{JSON.stringify(moduleStatus, null, 2)}</pre>
      </SectionShell>
      <SectionShell title="Structured view (UI projection)">
        <pre className="max-h-96 overflow-auto rounded-lg bg-muted/30 p-3 text-xs">{JSON.stringify(structured, null, 2)}</pre>
      </SectionShell>
    </div>
  )
}

/** True when Yahoo classifies the instrument as an ETF / mutual fund / money market. */
export function isYahooFundInstrument(data: YahooStructuredData | null | undefined): boolean {
  if (!data) return false
  if (data.isFund || data.isEtf) return true
  const qt = String(data.quoteType || '').toUpperCase()
  if (qt === 'ETF' || qt === 'MUTUALFUND' || qt === 'MONEYMARKET') return true
  const fund = data.fund
  if (!fund) return false
  if (fund.legalType || fund.family || fund.category) return true
  const holdings = fund.topHoldings as { holdings?: unknown[] } | null | undefined
  return Array.isArray(holdings?.holdings) && holdings.holdings.length > 0
}

function asFractionPercent(value: unknown, digits = 2): string {
  const n = rawNum(value)
  if (n == null) return 'N/A'
  // Yahoo fund ratios are usually 0–1 fractions (0.0749 → 7.49%).
  const pct = Math.abs(n) <= 1.5 ? n * 100 : n
  return `${pct.toFixed(digits)}%`
}

const DONUT_COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#ef4444', // red
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#64748b', // slate
  '#84cc16', // lime
]

function fractionToPctNumber(value: unknown): number | null {
  const n = rawNum(value)
  if (n == null) return null
  return Math.abs(n) <= 1.5 ? n * 100 : n
}

/** Small SVG donut / pie for asset & sector allocation. */
function AllocationDonut({
  slices,
  size = 160,
  hole = 0.58,
}: {
  slices: { label: string; value: number; color: string }[]
  size?: number
  hole?: number
}) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0)
  if (total <= 0) {
    return (
      <div className="flex h-[160px] items-center justify-center text-xs text-muted-foreground">
        No allocation data
      </div>
    )
  }

  const r = size / 2
  const innerR = r * hole
  let angle = -Math.PI / 2

  const paths = slices
    .filter((s) => s.value > 0)
    .map((slice) => {
      const sweep = (slice.value / total) * Math.PI * 2
      const start = angle
      const end = angle + sweep
      angle = end
      const large = sweep > Math.PI ? 1 : 0
      const x1 = r + r * Math.cos(start)
      const y1 = r + r * Math.sin(start)
      const x2 = r + r * Math.cos(end)
      const y2 = r + r * Math.sin(end)
      const ix1 = r + innerR * Math.cos(end)
      const iy1 = r + innerR * Math.sin(end)
      const ix2 = r + innerR * Math.cos(start)
      const iy2 = r + innerR * Math.sin(start)
      const d = [
        `M ${x1} ${y1}`,
        `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
        `L ${ix1} ${iy1}`,
        `A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2}`,
        'Z',
      ].join(' ')
      return <path key={slice.label} d={d} fill={slice.color} />
    })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto shrink-0">
      {paths}
    </svg>
  )
}

function FundCard({
  title,
  badge,
  children,
}: {
  title: string
  badge?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-[240px] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {badge ? <span className="text-[11px] text-muted-foreground">{badge}</span> : null}
      </div>
      <div className="flex flex-1 flex-col p-4">{children}</div>
    </div>
  )
}

function FundKvRow({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-right font-medium tabular-nums',
          muted ? 'font-normal italic text-muted-foreground' : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * ETF / mutual-fund dashboard matching the Fund Profile · Performance ·
 * Allocation · Holdings layout (Yahoo fundProfile / topHoldings / fundPerformance).
 */
export function YahooEtfSection({ data }: { data: YahooStructuredData }) {
  const [holdingsFilter, setHoldingsFilter] = useState('')
  const fund = data.fund || ({} as NonNullable<YahooStructuredData['fund']>)
  const profile = (fund.profile || {}) as Record<string, unknown>
  const topHoldings = (fund.topHoldings || {}) as Record<string, unknown>
  const performance = (fund.performance || {}) as Record<string, unknown>
  const fees = (profile.feesExpensesInvestment || {}) as Record<string, unknown>
  const holdings = Array.isArray(topHoldings.holdings)
    ? (topHoldings.holdings as Record<string, unknown>[])
    : []
  const sectorWeightings = Array.isArray(topHoldings.sectorWeightings)
    ? (topHoldings.sectorWeightings as Record<string, unknown>[])
    : []
  const trailing = (performance.trailingReturns || {}) as Record<string, unknown>
  const trailingCat = (performance.trailingReturnsCat || {}) as Record<string, unknown>
  const overview = (performance.performanceOverview || {}) as Record<string, unknown>
  const overviewCat = (performance.performanceOverviewCat || {}) as Record<string, unknown>

  const hasAnyFundData =
    Boolean(fund.family || fund.category || fund.legalType || fund.totalAssets != null) ||
    holdings.length > 0 ||
    Object.keys(profile).length > 1 ||
    Object.keys(performance).length > 1

  const assetSlices = [
    { label: 'cash', value: fractionToPctNumber(topHoldings.cashPosition) ?? 0, color: DONUT_COLORS[1] },
    { label: 'stocks', value: fractionToPctNumber(topHoldings.stockPosition) ?? 0, color: DONUT_COLORS[0] },
    { label: 'bonds', value: fractionToPctNumber(topHoldings.bondPosition) ?? 0, color: DONUT_COLORS[2] },
    { label: 'preferred', value: fractionToPctNumber(topHoldings.preferredPosition) ?? 0, color: DONUT_COLORS[3] },
    { label: 'convertible', value: fractionToPctNumber(topHoldings.convertiblePosition) ?? 0, color: DONUT_COLORS[4] },
    { label: 'other', value: fractionToPctNumber(topHoldings.otherPosition) ?? 0, color: DONUT_COLORS[5] },
  ].filter((s) => s.value > 0.001)

  const sectorSlices = sectorWeightings
    .map((row, i) => {
      const entries = Object.entries(row).filter(([k]) => k !== 'maxAge')
      const [sectorKey, weight] = entries[0] || ['—', 0]
      return {
        label: humanizeLabel(String(sectorKey)),
        value: fractionToPctNumber(weight) ?? 0,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }
    })
    .filter((s) => s.value > 0.001)
    .sort((a, b) => b.value - a.value)

  const filteredHoldings = useMemo(() => {
    const q = holdingsFilter.trim().toLowerCase()
    if (!q) return holdings
    return holdings.filter((h) => {
      const symbol = String(h.symbol || '').toLowerCase()
      const name = String(h.holdingName || '').toLowerCase()
      return symbol.includes(q) || name.includes(q)
    })
  }, [holdings, holdingsFilter])

  function exportHoldingsCsv() {
    const lines = [
      'symbol,holding,weight_pct',
      ...filteredHoldings.map((h) => {
        const pct = fractionToPctNumber(h.holdingPercent)
        const weight = pct != null ? pct.toFixed(4) : ''
        const name = String(h.holdingName || '').replace(/"/g, '""')
        return `${h.symbol || ''},"${name}",${weight}`
      }),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.symbol || 'fund'}-top-holdings.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!hasAnyFundData) {
    return (
      <SectionEmpty message="No ETF / fund modules returned yet. Click “Refresh from Yahoo Finance” to load fundProfile, topHoldings, and fundPerformance." />
    )
  }

  const ytd = trailing.ytd ?? overview.ytdReturnPct ?? fund.ytdReturn
  const oneY = trailing.oneYear ?? overview.oneYearTotalReturn
  const threeY = trailing.threeYear ?? overview.threeYearTotalReturn
  const fiveY = trailing.fiveYear ?? overview.fiveYrAvgReturnPct ?? fund.fiveYearAverageReturn
  const catYtd = trailingCat.ytd ?? overviewCat.ytdReturnPct
  const catOneY = trailingCat.oneYear ?? overviewCat.oneYearTotalReturn

  return (
    <div className="space-y-4">
      {/* Top row — 4 cards like the reference ETF dashboard */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FundCard title="Fund Profile">
          <div className="space-y-0.5">
            <FundKvRow label="Fund Family" value={fund.family || rawStr(profile.family)} />
            <FundKvRow label="Category" value={fund.category || rawStr(profile.categoryName)} />
            <FundKvRow label="Legal Type" value={fund.legalType || rawStr(profile.legalType)} />
            <FundKvRow
              label="Inception Date"
              value={fund.fundInceptionDate ? rawStr(fund.fundInceptionDate) : 'N/A'}
            />
            <FundKvRow
              label="Net Assets"
              value={fund.totalAssets != null ? formatCurrency(fund.totalAssets) : 'N/A'}
            />
            <FundKvRow
              label="Net Expense Ratio"
              value={
                rawNum(fees.annualReportExpenseRatio) != null
                  ? asFractionPercent(fees.annualReportExpenseRatio, 2)
                  : 'N/A'
              }
            />
            <FundKvRow
              label="Yield"
              value={fund.yield != null ? asFractionPercent(fund.yield) : 'N/A'}
            />
            <FundKvRow label="Morningstar Rating" value="Not available" muted />
          </div>
        </FundCard>

        <FundCard title="Fund Performance" badge="vs. category">
          <div className="space-y-0.5">
            <FundKvRow label="YTD Return" value={asFractionPercent(ytd)} />
            <FundKvRow label="1-Year Return" value={asFractionPercent(oneY)} />
            <FundKvRow label="3-Year Return" value={asFractionPercent(threeY)} />
            <FundKvRow label="5-Year Avg Return" value={asFractionPercent(fiveY)} />
            <div className="my-2 border-t" />
            <FundKvRow label="Category YTD" value={asFractionPercent(catYtd)} />
            <FundKvRow label="Category 1-Year" value={asFractionPercent(catOneY)} />
          </div>
        </FundCard>

        <FundCard title="Asset Allocation">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 sm:flex-row sm:items-center">
            <AllocationDonut slices={assetSlices} size={140} />
            <div className="w-full min-w-0 space-y-1.5 sm:w-auto">
              {assetSlices.length ? (
                assetSlices.map((s) => (
                  <div key={s.label} className="flex items-center gap-2 text-xs">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="ml-auto font-medium tabular-nums">{s.value.toFixed(1)}%</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No asset mix returned.</p>
              )}
            </div>
          </div>
        </FundCard>

        <FundCard title="Sector Allocation">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 sm:flex-row sm:items-start">
            <AllocationDonut slices={sectorSlices} size={140} hole={0.45} />
            <div className="max-h-[180px] w-full min-w-0 space-y-1 overflow-y-auto sm:w-auto">
              {sectorSlices.length ? (
                sectorSlices.map((s) => (
                  <div key={s.label} className="flex items-center gap-2 text-xs">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                    <span className="truncate text-muted-foreground" title={s.label}>
                      {s.label}
                    </span>
                    <span className="ml-auto shrink-0 font-medium tabular-nums">
                      {s.value.toFixed(1)}%
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No sector weights returned.</p>
              )}
            </div>
          </div>
        </FundCard>
      </div>

      {/* Top holdings table */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
          <h3 className="text-sm font-semibold tracking-tight">Top Holdings</h3>
          <p className="text-[11px] text-muted-foreground">
            Top holdings from Yahoo Finance — not the complete portfolio
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <input
            type="search"
            value={holdingsFilter}
            onChange={(e) => setHoldingsFilter(e.target.value)}
            placeholder="Filter rows…"
            className="min-w-[12rem] flex-1 rounded-md border bg-muted/30 px-3 py-1.5 text-sm outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400"
          />
          <button
            type="button"
            onClick={exportHoldingsCsv}
            disabled={!filteredHoldings.length}
            className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
        {!holdings.length ? (
          <div className="p-6">
            <SectionEmpty message="No top holdings returned for this fund." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b bg-muted/20 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Symbol</th>
                  <th className="px-4 py-2">Holding</th>
                  <th className="px-4 py-2 text-right">Weight</th>
                </tr>
              </thead>
              <tbody>
                {filteredHoldings.map((h, i) => (
                  <tr
                    key={String(h.symbol || i)}
                    className="border-b last:border-0 even:bg-muted/15 hover:bg-muted/30"
                  >
                    <td className="px-4 py-2 font-medium tabular-nums">{rawStr(h.symbol)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{rawStr(h.holdingName)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      {asFractionPercent(h.holdingPercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t px-4 py-2 text-right text-xs text-muted-foreground">
              {filteredHoldings.length} row{filteredHoldings.length === 1 ? '' : 's'}
              {holdingsFilter.trim() ? ` (filtered from ${holdings.length})` : ''}
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Source: Yahoo Finance modules <code className="rounded bg-muted px-1">fundProfile</code>,{' '}
        <code className="rounded bg-muted px-1">topHoldings</code>,{' '}
        <code className="rounded bg-muted px-1">fundPerformance</code>.
      </p>
    </div>
  )
}
