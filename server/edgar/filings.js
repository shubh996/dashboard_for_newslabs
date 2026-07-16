import * as cheerio from 'cheerio'
import { resolveTicker, getSubmissions, filingDocUrl, fetchSec } from './secClient.js'
import { step } from './stepTracer.js'

// SEC's submissions.json stores `filings.recent` as parallel column arrays --
// zip them into one row-per-filing shape.
function zipRecentFilings(recent, cik) {
  if (!recent) return []
  const count = recent.accessionNumber?.length || 0
  const rows = []
  for (let i = 0; i < count; i += 1) {
    const accessionNumber = recent.accessionNumber[i]
    const primaryDocument = recent.primaryDocument?.[i] || null
    rows.push({
      form: recent.form?.[i] || '',
      filingDate: recent.filingDate?.[i] || '',
      reportDate: recent.reportDate?.[i] || null,
      accessionNumber,
      primaryDocument,
      primaryDocDescription: recent.primaryDocDescription?.[i] || null,
      filingUrl: primaryDocument ? filingDocUrl(cik, accessionNumber, primaryDocument) : filingDocUrl(cik, accessionNumber, ''),
      isXBRL: Boolean(recent.isXBRL?.[i]),
      isInlineXBRL: Boolean(recent.isInlineXBRL?.[i]),
    })
  }
  return rows
}

export async function getRecentFilings(ticker, limit = 25) {
  const { cik } = await resolveTicker(ticker)
  const submissions = await getSubmissions(cik)
  const rows = zipRecentFilings(submissions.filings?.recent, cik).slice(0, limit)
  step(`Zipped ${rows.length} filing rows (of ${submissions.filings?.recent?.accessionNumber?.length || 0} total on record) from the parallel-array format SEC returns`)
  return rows
}

// SEC filing HTML frequently splits a heading's own text across multiple
// nested tags for formatting reasons (e.g. Microsoft's 10-K literally renders
// "ITEM 1. BUSINESS" as `<span>ITEM 1. B</span><span>USINESS</span>` inside a
// wrapping <p>) -- reading only an element's direct text nodes misses that
// entirely, since neither span alone contains the full heading. Using the
// element's full nested text instead catches these, while the length cap
// keeps it from also matching a large ancestor whose text happens to START
// with the same heading (a genuine heading is a few words; a section wrapper
// is the whole section).
function headingText($, el) {
  const text = $(el).text().replace(/\s+/g, ' ').trim()
  return text.length <= 200 ? text : ''
}

// A 10-K's table of contents repeats every "Item 1. Business" / "Item 1A.
// Risk Factors" heading as its own short row (often with a trailing page
// number, e.g. "Item 1. Business 3") -- that also matches `startPattern`, and
// since it's followed immediately by more ToC rows, it hits an `endPattern`
// almost instantly with next to nothing collected. A real section heading is
// followed by paragraphs of prose. So: require a minimum amount of collected
// content before accepting a match; if a candidate falls short, it was
// probably the ToC, so keep searching for the next occurrence of the heading.
const MIN_EXCERPT_LENGTH = 100

// Grabs the text between a heading matching `startPattern` and the next
// heading matching any of `endPatterns` (e.g. "Item 1. Business" up to
// "Item 1A. Risk Factors"), truncated to an excerpt -- mirrors what
// edgartools' `.business` / `.risk_factors` properties give the original
// Python tool, since there's no structured API for this prose text.
function extractSectionExcerpt($, startPattern, endPatterns, maxChars) {
  const nodes = $('body *').toArray()

  for (let startIndex = 0; startIndex < nodes.length; startIndex += 1) {
    if (!startPattern.test(headingText($, nodes[startIndex]))) continue

    let collected = ''
    for (let i = startIndex + 1; i < nodes.length; i += 1) {
      const text = headingText($, nodes[i])
      if (text && endPatterns.some((pattern) => pattern.test(text))) break
      if (['p', 'span', 'div'].includes(nodes[i].tagName)) {
        const blockText = $(nodes[i]).text().replace(/\s+/g, ' ').trim()
        if (blockText && !collected.includes(blockText)) collected += (collected ? ' ' : '') + blockText
      }
      if (collected.length > maxChars * 2) break
    }

    const trimmed = collected.trim()
    if (trimmed.length >= MIN_EXCERPT_LENGTH) return trimmed.slice(0, maxChars)
    // Too short -- almost certainly matched the table of contents, not the real section. Try the next heading match.
  }
  return null
}

async function extractExcerpts(filingUrl, form) {
  try {
    const html = await fetchSec(filingUrl, { json: false, timeoutMs: 20000 })
    const $ = cheerio.load(html)
    const riskFactors = extractSectionExcerpt($, /^item\s*1a\.\s*risk factors\b/i, [/^item\s*1b\b/i, /^item\s*2\b/i], 1200)
    if (form !== '10-K') {
      step(`Parsed ${form} HTML: risk factors excerpt ${riskFactors ? `found (${riskFactors.length} chars)` : 'not found'}`)
      return { business: null, riskFactors }
    }
    const business = extractSectionExcerpt($, /^item\s*1\.\s*business\b/i, [/^item\s*1a\.?\s*risk factors/i], 1200)
    step(`Parsed ${form} HTML: business description ${business ? `found (${business.length} chars)` : 'not found'}, risk factors ${riskFactors ? `found (${riskFactors.length} chars)` : 'not found'}`)
    return { business, riskFactors }
  } catch (error) {
    step(`Failed to fetch/parse ${form} document for excerpts: ${error.message}`)
    return { business: null, riskFactors: null }
  }
}

async function buildSnapshot(filings, label, form) {
  const match = filings.find((filing) => filing.form === form)
  if (!match) {
    step(`No ${form} found among recent filings`)
    return {
      label,
      found: false,
      periodOfReport: null,
      filingDate: null,
      accessionNumber: null,
      filingUrl: null,
      businessDescription: null,
      riskFactors: null,
    }
  }
  step(`Found latest ${form}: accession ${match.accessionNumber}, filed ${match.filingDate} — fetching its document for excerpts`)
  const { business, riskFactors } = await extractExcerpts(match.filingUrl, form)
  return {
    label,
    found: true,
    periodOfReport: match.reportDate,
    filingDate: match.filingDate,
    accessionNumber: match.accessionNumber,
    filingUrl: match.filingUrl,
    businessDescription: business,
    riskFactors,
  }
}

export async function getLatestReports(ticker) {
  step(`Finding latest 10-K and 10-Q for "${ticker}"`)
  const { cik } = await resolveTicker(ticker)
  const submissions = await getSubmissions(cik)
  const filings = zipRecentFilings(submissions.filings?.recent, cik)

  const [tenK, tenQ] = await Promise.all([
    buildSnapshot(filings, '10-K', '10-K'),
    buildSnapshot(filings, '10-Q', '10-Q'),
  ])
  return [tenK, tenQ]
}
