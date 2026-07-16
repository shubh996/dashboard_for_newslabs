// Congressional trading disclosures (STOCK Act) -- direct port of
// edgar-ticker-explorer's congress_trading.py. Reads the local dataset copied
// into server/data/congress/ (itself a copy of the congress-trading-monitor
// project's public/data/, per that project's own README -- it does not
// auto-refresh).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { step } from './stepTracer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONGRESS_DATA_DIR = path.join(__dirname, '..', 'data', 'congress')
const TICKER_DIR = path.join(CONGRESS_DATA_DIR, 'ticker')
const FILER_DIR = path.join(CONGRESS_DATA_DIR, 'filer')

async function readJsonIfExists(filePath) {
  step(`Reading local file ${filePath}`)
  try {
    const text = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(text)
    step(`Found and parsed ${filePath} (${text.length.toLocaleString('en-US')} bytes)`)
    return parsed
  } catch (error) {
    step(`${filePath} not found or unreadable (${error.code || error.message}) — no local data for this entity`)
    return null
  }
}

export async function loadCongressTrades(ticker) {
  return readJsonIfExists(path.join(TICKER_DIR, `${ticker.toUpperCase()}.json`))
}

export async function loadFiler(filerId) {
  return readJsonIfExists(path.join(FILER_DIR, `${filerId}.json`))
}

// "If they never sold" portfolio: every disclosed BUY priced at today's
// close. Ported 1:1 from congress-trading-monitor's FilerPage.jsx --
// mid_amount * (1 + ret_since/100) per buy, aggregated by ticker, compared
// against a same-dollar SPY benchmark using excess_since.
export function computeLivePortfolio(trades) {
  const buys = trades.filter((t) => {
    const type = (t.transaction_type || '').toLowerCase()
    const isBuy = type.includes('urchase') || type === 'p'
    return (
      isBuy &&
      t.ret_since !== null &&
      t.ret_since !== undefined &&
      t.excess_since !== null &&
      t.excess_since !== undefined &&
      t.amount_range_low !== null &&
      t.amount_range_low !== undefined &&
      t.amount_range_high !== null &&
      t.amount_range_high !== undefined
    )
  })
  if (!buys.length) return null

  let cost = 0
  let value = 0
  let spyValue = 0
  const byTicker = new Map()

  for (const t of buys) {
    const mid = (t.amount_range_low + t.amount_range_high) / 2
    const v = mid * (1 + t.ret_since / 100)
    const sv = mid * (1 + (t.ret_since - t.excess_since) / 100)
    cost += mid
    value += v
    spyValue += sv

    const ticker = t.ticker || '?'
    const pos = byTicker.get(ticker) || {
      ticker,
      assetName: t.asset_name || null,
      cost: 0,
      value: 0,
      count: 0,
      firstDate: t.transaction_date || null,
    }
    pos.cost += mid
    pos.value += v
    pos.count += 1
    if (t.transaction_date && (!pos.firstDate || t.transaction_date < pos.firstDate)) {
      pos.firstDate = t.transaction_date
    }
    byTicker.set(ticker, pos)
  }

  const holdings = [...byTicker.values()]
    .map((pos) => ({
      ...pos,
      gain: pos.value - pos.cost,
      gainPct: pos.cost > 0 ? (pos.value / pos.cost - 1) * 100 : 0,
      weight: value > 0 ? (pos.value / value) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value)

  return {
    scoredBuys: buys.length,
    cost,
    value,
    spyValue,
    gain: value - cost,
    gainPct: cost > 0 ? (value / cost - 1) * 100 : 0,
    vsSpy: value - spyValue,
    holdings,
  }
}

function mapTrade(t) {
  return {
    id: t.id,
    ticker: t.ticker,
    assetName: t.asset_name ?? null,
    transactionDate: t.transaction_date ?? null,
    filingDate: t.filing_date ?? null,
    notificationDate: t.notification_date ?? null,
    transactionType: t.transaction_type ?? null,
    amountRangeLow: t.amount_range_low ?? null,
    amountRangeHigh: t.amount_range_high ?? null,
    amountRangeLabel: t.amount_range_label ?? null,
    daysToFile: t.days_to_file ?? null,
    retSince: t.ret_since ?? null,
    excessSince: t.excess_since ?? null,
    filerId: t.filer_id ?? null,
    filerName: t.filer_name ?? null,
    party: t.party ?? null,
    chamber: t.chamber ?? null,
    state: t.state ?? null,
    docUrl: t.doc_url ?? null,
  }
}

export async function getCongressTrading(ticker) {
  step(`Loading local STOCK Act dataset for "${ticker}"`)
  const data = await loadCongressTrades(ticker)
  if (!data) return { ticker: ticker.toUpperCase(), trades: [], latestPrice: null }

  const trades = (data.trades || []).map(mapTrade).sort((a, b) => (b.transactionDate || '').localeCompare(a.transactionDate || ''))
  step(`Mapped and sorted ${trades.length} disclosed trades by transaction date`)
  const latest = data.price?.latest
  return {
    ticker: ticker.toUpperCase(),
    trades,
    latestPrice: latest?.close != null ? { close: latest.close, date: latest.date } : null,
  }
}

export async function getPoliticianPortfolio(filerId) {
  step(`Loading local STOCK Act filer record for "${filerId}"`)
  const data = await loadFiler(filerId)
  if (!data) return null

  const filer = data.filer || {}
  const name = filer.full_name || filerId
  step(`Filer: ${name} (${filer.branch || 'unknown branch'}) — mapping ${(data.trades || []).length} disclosed trades`)
  const trades = (data.trades || []).map((t) =>
    mapTrade({ ...t, filer_name: name, chamber: filer.chamber, party: filer.party, state: filer.state }),
  )

  step('Computing live buy-and-hold portfolio (every disclosed BUY priced at its bundled latest close, vs. a same-dollar SPY benchmark)')
  const portfolio = computeLivePortfolio(data.trades || [])
  step(portfolio ? `Portfolio built: ${portfolio.scoredBuys} scored buys across ${portfolio.holdings.length} tickers` : 'Not enough priced buy transactions to build a live portfolio')

  return {
    filer: {
      id: filer.id || filerId,
      fullName: name,
      branch: filer.branch ?? null,
      chamber: filer.chamber ?? null,
      party: filer.party ?? null,
      state: filer.state ?? null,
      office: filer.office ?? null,
      agency: filer.agency ?? null,
      photoUrl: filer.photo_url ?? null,
    },
    trades,
    portfolio,
  }
}
