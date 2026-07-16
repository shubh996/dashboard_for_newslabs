import { XMLParser } from 'fast-xml-parser'
import { resolveTicker, getSubmissions, fetchSec, filingDocUrl, limit as rateLimit } from './secClient.js'
import { step } from './stepTracer.js'

const TRANSACTION_CODE_LABELS = {
  P: 'Open market purchase',
  S: 'Open market sale',
  A: 'Grant / award',
  D: 'Sale to issuer',
  F: 'Tax withholding',
  I: 'Discretionary transaction',
  M: 'Option exercise',
  C: 'Derivative conversion',
  E: 'Short position expiration',
  H: 'Long position expiration',
  O: 'Out-of-the-money exercise',
  X: 'In-the-money exercise',
  G: 'Gift',
  L: 'Small acquisition',
  W: 'Will / inheritance',
  Z: 'Voting trust deposit/withdrawal',
  J: 'Other acquisition/disposition',
}

const xmlParser = new XMLParser({ ignoreAttributes: true, trimValues: true })

function asArray(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function textValue(node) {
  if (node === undefined || node === null) return null
  if (typeof node === 'object') return node.value ?? null
  return node
}

function numberValue(node) {
  const value = textValue(node)
  if (value === null || value === '') return null
  const num = Number(value)
  return Number.isNaN(num) ? null : num
}

function extractTransactions(doc, sourceUrl, isDerivative) {
  const table = isDerivative ? doc.derivativeTable : doc.nonDerivativeTable
  const key = isDerivative ? 'derivativeTransaction' : 'nonDerivativeTransaction'
  const rows = asArray(table?.[key])

  const owners = asArray(doc.reportingOwner)
  const owner = owners[0]
  const insiderName = owner?.reportingOwnerId?.rptOwnerName || null
  const relationship = owner?.reportingOwnerRelationship || {}
  const isDirector = textValue(relationship.isDirector) === '1' || relationship.isDirector === true
  const isOfficer = textValue(relationship.isOfficer) === '1' || relationship.isOfficer === true
  const isTenPercentOwner = textValue(relationship.isTenPercentOwner) === '1' || relationship.isTenPercentOwner === true
  const insiderTitle = textValue(relationship.officerTitle) || null

  return rows.map((row) => {
    const code = textValue(row.transactionCoding?.transactionCode)
    return {
      filingDate: null, // filled in by caller
      insiderName,
      insiderTitle,
      isDirector,
      isOfficer,
      isTenPercentOwner,
      transactionDate: textValue(row.transactionDate),
      transactionCode: code,
      transactionCodeLabel: code ? TRANSACTION_CODE_LABELS[code] || code : null,
      isDerivative,
      securityTitle: textValue(row.securityTitle),
      shares: numberValue(row.transactionAmounts?.transactionShares),
      pricePerShare: numberValue(row.transactionAmounts?.transactionPricePerShare),
      value: (() => {
        const shares = numberValue(row.transactionAmounts?.transactionShares)
        const price = numberValue(row.transactionAmounts?.transactionPricePerShare)
        return shares !== null && price !== null ? shares * price : null
      })(),
      acquiredDisposedCode: textValue(row.transactionAmounts?.transactionAcquiredDisposedCode) || null,
      sharesOwnedAfter: numberValue(row.postTransactionAmounts?.sharesOwnedFollowingTransaction),
      sourceUrl,
    }
  })
}

async function parseFiling(filing) {
  // `primaryDocument` (e.g. "xslF345X06/form4.xml") is SEC's server-rendered
  // HTML view of the filing, not the raw ownership XML -- the actual XML
  // always lives at the filing root under its own basename.
  const xml = await rateLimit(() => fetchSec(filing.rawXmlUrl, { json: false }))
  const parsed = xmlParser.parse(xml)
  const doc = parsed.ownershipDocument
  if (!doc) {
    step(`Form ${filing.form} (${filing.filingDate}): no ownershipDocument in XML — skipped`)
    return []
  }

  const transactions = [
    ...extractTransactions(doc, filing.filingUrl, false),
    ...extractTransactions(doc, filing.filingUrl, true),
  ]
  step(`Form ${filing.form} (${filing.filingDate}): parsed ${transactions.length} transaction row(s)`)
  return transactions.map((tx) => ({ ...tx, formType: filing.form, filingDate: filing.filingDate }))
}

export async function getInsiderTransactions(ticker, limitFilings = 15) {
  step(`Finding Form 3/4/5 filings for "${ticker}" (up to ${limitFilings})`)
  const { cik } = await resolveTicker(ticker)
  const submissions = await getSubmissions(cik)
  const recent = submissions.filings?.recent
  if (!recent) return []

  const count = recent.accessionNumber?.length || 0
  const filings = []
  for (let i = 0; i < count && filings.length < limitFilings; i += 1) {
    const form = recent.form?.[i]
    if (form !== '3' && form !== '4' && form !== '5') continue
    const accessionNumber = recent.accessionNumber[i]
    const primaryDocument = recent.primaryDocument?.[i]
    if (!primaryDocument) continue
    const rawXmlBasename = primaryDocument.split('/').pop()
    filings.push({
      form,
      filingDate: recent.filingDate?.[i] || '',
      filingUrl: filingDocUrl(cik, accessionNumber, primaryDocument),
      rawXmlUrl: filingDocUrl(cik, accessionNumber, rawXmlBasename),
    })
  }
  step(`Found ${filings.length} Form 3/4/5 filing(s) among ${count} total filings on record — fetching each one's raw XML`)

  const results = await Promise.allSettled(filings.map(parseFiling))
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length) step(`${failed.length} of ${filings.length} filings failed to parse: ${failed.map((r) => r.reason?.message).join('; ')}`)
  const transactions = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value)
  step(`Combined ${transactions.length} transaction rows from ${filings.length - failed.length} successfully parsed filings, sorting by date`)

  return transactions.sort((a, b) => (b.transactionDate || b.filingDate || '').localeCompare(a.transactionDate || a.filingDate || ''))
}
