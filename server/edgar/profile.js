import { resolveTicker, getSubmissions, getCompanyFacts } from './secClient.js'
import { step } from './stepTracer.js'

function mapAddress(addr) {
  if (!addr) return null
  return {
    street1: addr.street1 || null,
    street2: addr.street2 || null,
    city: addr.city || null,
    stateOrCountry: addr.stateOrCountryDescription || addr.stateOrCountry || null,
    zipCode: addr.zipCode || null,
  }
}

function latestDeiValue(facts, concept) {
  const node = facts?.facts?.dei?.[concept]
  if (!node?.units) return null
  const values = Object.values(node.units).flat()
  if (!values.length) return null
  const latest = [...values].sort((a, b) => (a.end || a.filed || '').localeCompare(b.end || b.filed || '')).pop()
  return latest?.val ?? null
}

export async function buildProfile(ticker) {
  step(`Building company profile for "${ticker}"`)
  const { cik, title } = await resolveTicker(ticker)
  const submissions = await getSubmissions(cik)
  step(`Submissions loaded: entityType="${submissions.entityType}", ${submissions.filings?.recent?.form?.length || 0} recent filings on record`)

  let sharesOutstanding = null
  let publicFloat = null
  try {
    const facts = await getCompanyFacts(cik)
    sharesOutstanding = latestDeiValue(facts, 'EntityCommonStockSharesOutstanding')
    publicFloat = latestDeiValue(facts, 'EntityPublicFloat')
    step(`Extracted from XBRL company facts: sharesOutstanding=${sharesOutstanding ?? 'N/A'}, publicFloat=${publicFloat ?? 'N/A'}`)
  } catch (error) {
    // XBRL company facts aren't published for every filer (e.g. some foreign private issuers) -- non-fatal.
    step(`No XBRL company facts available (${error.message}) — shares outstanding/public float will be N/A`)
  }

  const category = submissions.category || ''
  step('Assembling final profile object from submissions + XBRL facts')

  return {
    ticker: ticker.toUpperCase(),
    cik: submissions.cik || cik,
    name: submissions.name || title,
    sic: submissions.sic || null,
    sicDescription: submissions.sicDescription || null,
    fiscalYearEnd: submissions.fiscalYearEnd || null,
    filerCategory: category || null,
    entityType: submissions.entityType || null,
    stateOfIncorporation: submissions.stateOfIncorporationDescription || submissions.stateOfIncorporation || null,
    exchanges: Array.isArray(submissions.exchanges) ? submissions.exchanges.filter(Boolean) : [],
    tickers: Array.isArray(submissions.tickers) ? submissions.tickers : [ticker.toUpperCase()],
    ein: submissions.ein || null,
    website: submissions.website || null,
    investorWebsite: submissions.investorWebsite || null,
    phone: submissions.phone || null,
    businessAddress: mapAddress(submissions.addresses?.business),
    mailingAddress: mapAddress(submissions.addresses?.mailing),
    sharesOutstanding,
    publicFloat,
    isLargeAcceleratedFiler: /large accelerated/i.test(category),
    isEmergingGrowthCompany: /emerging growth/i.test(category),
    formerNames: Array.isArray(submissions.formerNames)
      ? submissions.formerNames.map((entry) => ({ name: entry.name, from: entry.from || null, to: entry.to || null }))
      : [],
  }
}
