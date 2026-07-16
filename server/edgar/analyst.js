// Analyst consensus, price targets, and firm-by-firm ratings, sourced from
// Yahoo Finance's quoteSummary endpoint (financialData + recommendationTrend
// + upgradeDowngradeHistory + summaryDetail modules) -- there is no SEC
// filing for this, analysts' own ratings aren't public record, so unlike the
// rest of this tool this section is Yahoo Finance, not EDGAR.
import { fetchYahooQuoteSummary, yahooRaw, toYahooSymbol } from '../yahooClient.js'
import { step } from './stepTracer.js'

// Yahoo's own short codes for a rating change -- mapped to a readable label
// without inventing a category it didn't report. Unknown/future codes fall
// back to a title-cased version of the raw value instead of "Unknown".
const ACTION_LABELS = {
  up: 'Upgrade',
  down: 'Downgrade',
  main: 'Maintained',
  init: 'Initiated',
  reit: 'Reiterated',
}

function actionLabel(action) {
  if (!action) return null
  return ACTION_LABELS[action] || action.charAt(0).toUpperCase() + action.slice(1)
}

// (targetPrice - currentPrice) / currentPrice * 100 -- null if either input
// is missing, never a fabricated 0.
function upsidePercent(target, current) {
  if (target == null || current == null || current === 0) return null
  return ((target - current) / current) * 100
}

export async function getAnalystData(ticker) {
  const symbol = toYahooSymbol(ticker)
  step(`Fetching analyst data for "${ticker}" (Yahoo symbol "${symbol}") — financialData, recommendationTrend, upgradeDowngradeHistory, summaryDetail`)

  const result = await fetchYahooQuoteSummary(symbol, [
    'financialData',
    'recommendationTrend',
    'upgradeDowngradeHistory',
    'summaryDetail',
  ])

  const financial = result.financialData || {}
  const summary = result.summaryDetail || {}
  const trendPoints = Array.isArray(result.recommendationTrend?.trend) ? result.recommendationTrend.trend : []
  const history = Array.isArray(result.upgradeDowngradeHistory?.history) ? result.upgradeDowngradeHistory.history : []

  const currentPrice = yahooRaw(financial.currentPrice)
  const targetLow = yahooRaw(financial.targetLowPrice)
  const targetMean = yahooRaw(financial.targetMeanPrice)
  const targetMedian = yahooRaw(financial.targetMedianPrice)
  const targetHigh = yahooRaw(financial.targetHighPrice)

  const consensus = {
    currentPrice,
    recommendationKey: financial.recommendationKey || null,
    recommendationMean: yahooRaw(financial.recommendationMean),
    numberOfAnalystOpinions: yahooRaw(financial.numberOfAnalystOpinions),
    targetLow,
    targetMean,
    targetMedian,
    targetHigh,
    upsideToLow: upsidePercent(targetLow, currentPrice),
    upsideToMean: upsidePercent(targetMean, currentPrice),
    upsideToHigh: upsidePercent(targetHigh, currentPrice),
    fiftyTwoWeekLow: yahooRaw(summary.fiftyTwoWeekLow),
    fiftyTwoWeekHigh: yahooRaw(summary.fiftyTwoWeekHigh),
  }
  step(
    `Consensus: ${consensus.recommendationKey ?? 'N/A'} (mean ${consensus.recommendationMean ?? 'N/A'}), ` +
      `${consensus.numberOfAnalystOpinions ?? 0} analysts, targets ${targetLow ?? 'N/A'}/${targetMean ?? 'N/A'}/${targetHigh ?? 'N/A'} (low/mean/high)`,
  )

  const trend = trendPoints.map((point) => ({
    period: point.period,
    strongBuy: yahooRaw(point.strongBuy) || 0,
    buy: yahooRaw(point.buy) || 0,
    hold: yahooRaw(point.hold) || 0,
    sell: yahooRaw(point.sell) || 0,
    strongSell: yahooRaw(point.strongSell) || 0,
  }))

  // "0m" is Yahoo's own label for the current/latest period -- every other
  // entry is a prior month, so this is always the most recent snapshot.
  const latestTrend = trend.find((point) => point.period === '0m') || trend[0] || null
  let sentiment = null
  if (latestTrend) {
    const bullish = latestTrend.strongBuy + latestTrend.buy
    const neutral = latestTrend.hold
    const bearish = latestTrend.sell + latestTrend.strongSell
    const total = bullish + neutral + bearish
    sentiment = {
      period: latestTrend.period,
      bullish,
      neutral,
      bearish,
      total,
      bullishPercent: total > 0 ? (bullish / total) * 100 : null,
      neutralPercent: total > 0 ? (neutral / total) * 100 : null,
      bearishPercent: total > 0 ? (bearish / total) * 100 : null,
    }
  }

  const ratings = history
    .map((entry) => {
      const priceTarget = Number.isFinite(entry.currentPriceTarget) && entry.currentPriceTarget > 0 ? entry.currentPriceTarget : null
      const priorPriceTarget = Number.isFinite(entry.priorPriceTarget) && entry.priorPriceTarget > 0 ? entry.priorPriceTarget : null
      return {
        firm: entry.firm || null,
        fromGrade: entry.fromGrade || null,
        toGrade: entry.toGrade || null,
        action: entry.action || null,
        actionLabel: actionLabel(entry.action),
        priceTarget,
        priorPriceTarget,
        upsidePercent: upsidePercent(priceTarget, currentPrice),
        date: Number.isFinite(entry.epochGradeDate) ? new Date(entry.epochGradeDate * 1000).toISOString().slice(0, 10) : null,
      }
    })
    .sort((a, b) => (a.date && b.date ? b.date.localeCompare(a.date) : 0))
  step(`Firm-by-firm ratings: ${ratings.length} entries from upgradeDowngradeHistory`)

  return { symbol, consensus, sentiment, trend, ratings }
}
