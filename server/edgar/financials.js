import { resolveTicker, getCompanyFacts } from './secClient.js'
import { step } from './stepTracer.js'

// A curated set of common us-gaap concepts per statement, with fallback tags
// since different filers use slightly different XBRL tags for the same line
// item. This is a pragmatic approximation of edgartools' full statement
// reconstruction -- it won't catch every custom/extension tag a filer uses,
// but covers the line items most companies report under the standard taxonomy.
const INCOME_STATEMENT_CONCEPTS = [
  { label: 'Revenue', concepts: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'] },
  { label: 'Cost of Revenue', concepts: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'] },
  { label: 'Gross Profit', concepts: ['GrossProfit'] },
  { label: 'Research & Development', concepts: ['ResearchAndDevelopmentExpense'] },
  { label: 'Selling, General & Administrative', concepts: ['SellingGeneralAndAdministrativeExpense'] },
  { label: 'Operating Expenses', concepts: ['OperatingExpenses', 'CostsAndExpenses'] },
  { label: 'Operating Income', concepts: ['OperatingIncomeLoss'] },
  { label: 'Interest Expense', concepts: ['InterestExpense', 'InterestExpenseNet'] },
  { label: 'Income Tax Expense', concepts: ['IncomeTaxExpenseBenefit'] },
  { label: 'Net Income', concepts: ['NetIncomeLoss', 'ProfitLoss'] },
  { label: 'EPS (Basic)', concepts: ['EarningsPerShareBasic'] },
  { label: 'EPS (Diluted)', concepts: ['EarningsPerShareDiluted'] },
]

const BALANCE_SHEET_CONCEPTS = [
  { label: 'Cash & Equivalents', concepts: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'] },
  { label: 'Current Assets', concepts: ['AssetsCurrent'] },
  { label: 'Total Assets', concepts: ['Assets'] },
  { label: 'Current Liabilities', concepts: ['LiabilitiesCurrent'] },
  { label: 'Total Liabilities', concepts: ['Liabilities'] },
  { label: "Stockholders' Equity", concepts: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  { label: 'Liabilities & Equity', concepts: ['LiabilitiesAndStockholdersEquity'] },
]

const CASH_FLOW_CONCEPTS = [
  { label: 'Operating Activities', concepts: ['NetCashProvidedByUsedInOperatingActivities'] },
  { label: 'Investing Activities', concepts: ['NetCashProvidedByUsedInInvestingActivities'] },
  { label: 'Financing Activities', concepts: ['NetCashProvidedByUsedInFinancingActivities'] },
  { label: 'Net Change in Cash', concepts: ['CashAndCashEquivalentsPeriodIncreaseDecrease', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect'] },
]

function durationDays(entry) {
  if (!entry.start || !entry.end) return null
  return (new Date(entry.end) - new Date(entry.start)) / (1000 * 60 * 60 * 24)
}

// Pick the best entry among several sharing the same period end -- for
// duration items (revenue, expenses, cash flow) a single `end` date can carry
// both a discrete-quarter context and a cumulative year-to-date context tagged
// under the same form/fp, so prefer whichever duration is closest to the
// target (~91 days for a quarter, ~365 for a full year). Instant items
// (balance sheet) have no `start` and just fall back to most-recently-filed.
function pickBestEntry(entries, targetDurationDays) {
  if (entries.length === 1) return entries[0]
  const withDuration = entries.filter((entry) => durationDays(entry) !== null)
  if (targetDurationDays && withDuration.length) {
    return withDuration.reduce((best, entry) =>
      Math.abs(durationDays(entry) - targetDurationDays) < Math.abs(durationDays(best) - targetDurationDays) ? entry : best,
    )
  }
  return entries.reduce((best, entry) => ((entry.filed || '') > (best.filed || '') ? entry : best))
}

// A 10-K/10-Q's XBRL can carry many contexts for the same concept (e.g. a
// "selected quarterly financial data" footnote inside a 10-K), so filtering
// on `form` alone isn't enough -- also require `fp` (fiscal period) to match
// what we're building: 'FY' for annual statements, one of Q1-Q4 for quarterly.
function filterByForm(values, form, fpFilter, targetDurationDays) {
  const byEnd = new Map()
  for (const entry of values) {
    if (entry.form !== form) continue
    if (fpFilter && !fpFilter(entry.fp)) continue
    if (targetDurationDays) {
      // Duration items (revenue, expenses, cash flow): reject anything that
      // isn't a discrete period close to the target length -- a stray
      // year-to-date or prior-year comparative context can otherwise slip
      // through when it's the only entry for that period end.
      const days = durationDays(entry)
      if (days === null || Math.abs(days - targetDurationDays) > targetDurationDays * 0.25) continue
    }
    const existing = byEnd.get(entry.end)
    byEnd.set(entry.end, existing ? pickBestEntry([existing, entry], targetDurationDays) : entry)
  }
  return [...byEnd.values()].sort((a, b) => b.end.localeCompare(a.end))
}

// Different fallback concepts can each have SOME valid data for a filer that
// switched XBRL tags over time (e.g. Apple's pre-2019 "Revenues" vs. its
// current "RevenueFromContractWithCustomerExcludingAssessedTax") -- picking
// the first one with any data at all would silently surface stale periods, so
// evaluate every candidate and keep whichever one covers the most recent period.
function pickFilteredValues(gaapFacts, concepts, form, fpFilter, targetDurationDays, periodsLimit) {
  let best = null
  for (const concept of concepts) {
    const node = gaapFacts?.[concept]
    const raw = node?.units?.USD || node?.units?.['USD/shares']
    if (!raw?.length) continue
    const filtered = filterByForm(raw, form, fpFilter, targetDurationDays).slice(0, periodsLimit)
    if (!filtered.length) continue
    if (!best || filtered[0].end > best.filtered[0].end) {
      best = { concept, filtered }
    }
  }
  return best
}

function buildStatement(gaapFacts, conceptDefs, form, fpFilter, targetDurationDays, periodsLimit, statementName) {
  const rows = []
  const periodSet = new Set()

  for (const def of conceptDefs) {
    const picked = pickFilteredValues(gaapFacts, def.concepts, form, fpFilter, targetDurationDays, periodsLimit)
    if (!picked) continue
    const valuesByPeriod = {}
    for (const entry of picked.filtered) {
      valuesByPeriod[entry.end] = entry.val
      periodSet.add(entry.end)
    }
    rows.push({ label: def.label, concept: picked.concept, unit: 'USD', values: valuesByPeriod })
  }

  if (!rows.length) {
    step(`${statementName} (${form}): no matching XBRL concepts found`)
    return null
  }
  const periods = [...periodSet].sort((a, b) => b.localeCompare(a)).slice(0, periodsLimit)
  step(`${statementName} (${form}): built ${rows.length} line items across ${periods.length} periods (${rows.map((r) => r.concept).join(', ')})`)
  return { periods, rows }
}

const isFullYear = (fp) => fp === 'FY'
const isQuarter = (fp) => fp === 'Q1' || fp === 'Q2' || fp === 'Q3' || fp === 'Q4'

export async function getFinancials(ticker, period) {
  step(`Building ${period} financials for "${ticker}" from XBRL company facts`)
  const { cik } = await resolveTicker(ticker)
  const facts = await getCompanyFacts(cik)
  const gaapFacts = facts.facts?.['us-gaap'] || {}
  step(`${Object.keys(gaapFacts).length.toLocaleString('en-US')} us-gaap concepts available in company facts`)

  if (period === 'quarterly') {
    return {
      incomeStatement: buildStatement(gaapFacts, INCOME_STATEMENT_CONCEPTS, '10-Q', isQuarter, 91, 6, 'Income statement'),
      balanceSheet: buildStatement(gaapFacts, BALANCE_SHEET_CONCEPTS, '10-Q', isQuarter, null, 6, 'Balance sheet'),
      cashFlowStatement: buildStatement(gaapFacts, CASH_FLOW_CONCEPTS, '10-Q', isQuarter, 91, 6, 'Cash flow statement'),
    }
  }

  return {
    incomeStatement: buildStatement(gaapFacts, INCOME_STATEMENT_CONCEPTS, '10-K', isFullYear, 365, 5, 'Income statement'),
    balanceSheet: buildStatement(gaapFacts, BALANCE_SHEET_CONCEPTS, '10-K', isFullYear, null, 5, 'Balance sheet'),
    cashFlowStatement: buildStatement(gaapFacts, CASH_FLOW_CONCEPTS, '10-K', isFullYear, 365, 5, 'Cash flow statement'),
  }
}
