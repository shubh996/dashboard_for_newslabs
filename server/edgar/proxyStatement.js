// DEF 14A proxy statement -- best-effort HTML table extraction.
//
// Unlike the other sections, there's no structured XBRL feed for compensation
// tables, director pay, or beneficial ownership (Pay-vs-Performance XBRL
// tagging exists but isn't exposed via the companyfacts API), so this parses
// the filing's own HTML: find a heading whose text matches a target section,
// then take the next <table> that follows it in document order. This works
// well for filings that follow SEC's conventional heading-then-table layout,
// but proxy statement formatting varies a lot between filers -- when a
// section can't be located, it comes back empty rather than guessed at.
import * as cheerio from 'cheerio'
import { resolveTicker, getSubmissions, fetchSec, filingDocUrl } from './secClient.js'
import { step } from './stepTracer.js'

// `headingPattern` finds candidate headings, but the same phrase often shows
// up more than once (table of contents, cross-references inside unrelated
// tables) -- `headerKeywords` validates the *table* actually found, and a
// candidate that doesn't validate is skipped in favor of the next match.
const SECTIONS = {
  summaryCompensationTable: {
    headingPattern: /summary compensation table/i,
    headerKeywords: ['name', 'salary'],
  },
  directorCompensationTable: {
    headingPattern: /director compensation/i,
    headerKeywords: ['name', 'fees'],
  },
  beneficialOwnership: {
    headingPattern: /security ownership of (certain )?beneficial owners/i,
    headerKeywords: ['name', 'shares'],
  },
}

function elementOwnText($, el) {
  return $(el)
    .contents()
    .filter(function filterTextNodes() {
      return this.type === 'text'
    })
    .text()
    .replace(/\s+/g, ' ')
    .trim()
}

function tableToRows($, tableEl) {
  const rows = []
  $(tableEl)
    .find('tr')
    .each((_, tr) => {
      const cells = []
      $(tr)
        .find('td,th')
        .each((__, cell) => {
          cells.push($(cell).text().replace(/\s+/g, ' ').trim())
        })
      if (cells.some(Boolean)) rows.push(cells)
    })
  return rows
}

function rowsToRecords(rows) {
  if (rows.length < 2) return []
  const header = rows[0].map((label, i) => label || `Column ${i + 1}`)
  return rows.slice(1).map((row) => {
    const record = {}
    header.forEach((label, i) => {
      record[label] = row[i] ?? null
    })
    return record
  })
}

function headerMatchesKeywords(headerRow, keywords) {
  const headerText = headerRow.join(' ').toLowerCase()
  return keywords.every((keyword) => headerText.includes(keyword))
}

function findTableAfterHeading($, { headingPattern, headerKeywords }, sectionName) {
  const nodes = $('body *').toArray()
  let headingsSeen = 0
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i].tagName === 'table') continue
    const text = elementOwnText($, nodes[i])
    if (!text || text.length > 120 || !headingPattern.test(text)) continue
    headingsSeen += 1

    for (let j = i + 1; j < Math.min(i + 80, nodes.length); j += 1) {
      if (nodes[j].tagName !== 'table') continue
      const rows = tableToRows($, nodes[j])
      if (rows.length >= 2 && headerMatchesKeywords(rows[0], headerKeywords)) {
        step(`${sectionName}: matched heading #${headingsSeen} ("${text.slice(0, 60)}") — extracted ${rows.length - 1} data row(s)`)
        return rowsToRecords(rows)
      }
      step(`${sectionName}: heading #${headingsSeen} ("${text.slice(0, 60)}") found, but its nearest table didn't match expected columns [${headerKeywords.join(', ')}] — trying next heading match`)
      break // this heading's nearest table didn't validate -- try the next heading match, not the next table
    }
  }
  step(`${sectionName}: no matching table found after ${headingsSeen} candidate heading(s)`)
  return []
}

function emptyProxyStatement() {
  return {
    found: false,
    filingDate: null,
    accessionNumber: null,
    filingUrl: null,
    peoName: null,
    peoTotalComp: null,
    peoActuallyPaidComp: null,
    summaryCompensationTable: [],
    directorCompensationTable: [],
    beneficialOwnership: [],
    insiderTradingPolicyAdopted: null,
  }
}

export async function getProxyStatement(ticker) {
  step(`Finding latest DEF 14A proxy statement for "${ticker}"`)
  const { cik } = await resolveTicker(ticker)
  const submissions = await getSubmissions(cik)
  const recent = submissions.filings?.recent
  const formCount = recent?.form?.length || 0

  let latestIndex = -1
  for (let i = 0; i < formCount; i += 1) {
    if (recent.form[i] === 'DEF 14A' && (latestIndex === -1 || recent.filingDate[i] > recent.filingDate[latestIndex])) {
      latestIndex = i
    }
  }
  if (latestIndex === -1) {
    step('No DEF 14A found among recent filings')
    return emptyProxyStatement()
  }

  const accessionNumber = recent.accessionNumber[latestIndex]
  const primaryDocument = recent.primaryDocument[latestIndex]
  if (!primaryDocument) return emptyProxyStatement()

  const filingUrl = filingDocUrl(cik, accessionNumber, primaryDocument)
  step(`Found DEF 14A: accession ${accessionNumber}, filed ${recent.filingDate[latestIndex]} — fetching and parsing its HTML`)
  const html = await fetchSec(filingUrl, { json: false, timeoutMs: 20000 })
  const $ = cheerio.load(html)
  step(`Loaded HTML into cheerio (${html.length.toLocaleString('en-US')} chars) — searching for compensation & ownership tables by heading text`)

  return {
    ...emptyProxyStatement(),
    found: true,
    filingDate: recent.filingDate[latestIndex],
    accessionNumber,
    filingUrl,
    summaryCompensationTable: findTableAfterHeading($, SECTIONS.summaryCompensationTable, 'Summary compensation table'),
    directorCompensationTable: findTableAfterHeading($, SECTIONS.directorCompensationTable, 'Director compensation'),
    beneficialOwnership: findTableAfterHeading($, SECTIONS.beneficialOwnership, 'Beneficial ownership'),
  }
}
