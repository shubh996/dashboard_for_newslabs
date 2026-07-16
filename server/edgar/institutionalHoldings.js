// Reverse lookup ("who holds this ticker") across a curated set of well-known
// 13F filers, ported from edgar-ticker-explorer's institutional_holdings.py.
// SEC gets 8,000+ 13F-HR filings/quarter with no stock -> holder index, so
// scanning every filer per request isn't practical -- this checks a fixed
// list of large, well-known managers instead (CIKs verified against SEC's
// full-index, same as the Python original).
import { createClient } from '@supabase/supabase-js'
import { getSubmissions, fetchSec, heavyLimit, limit as rateLimit, getTickerMap, accessionNoDashes } from './secClient.js'
import { step } from './stepTracer.js'

const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000 // 13F data only refreshes quarterly

export const HEDGE_FUNDS_AND_INSTITUTIONS = {
  'Berkshire Hathaway': 1067983,
  BlackRock: 2012383,
  'Renaissance Technologies': 1037389,
  'Bridgewater Associates': 1350694,
  'Citadel Advisors': 1423053,
  'Millennium Management': 1273087,
  'Two Sigma Investments': 1179392,
  'D. E. Shaw & Co.': 1009207,
  'Point72 Asset Management': 1603466,
  'Tiger Global Management': 1167483,
  'Soros Fund Management': 1029160,
  'AQR Capital Management': 1167557,
  'JPMorgan Chase & Co': 19617,
  'Goldman Sachs Group': 886982,
  'Morgan Stanley': 895421,
  'State Street Corp': 93751,
  // Added via SEC EDGAR-verified research (each cross-checked for an active,
  // recent 13F-HR filer -- several names have stale duplicate CIKs on EDGAR
  // that were deliberately excluded, see institutionalHoldings research notes).
  'Elliott Investment Management': 1791786,
  'Viking Global Investors': 1103804,
  'Coatue Management': 1135730,
  'Baupost Group': 1061768,
  'Lone Pine Capital': 1061165,
  'Third Point': 1040273,
  'Pershing Square Capital Management': 1336528,
  Appaloosa: 1656456,
  'Marshall Wace': 1318757,
  'ValueAct Capital': 1418814,
  'Paulson & Co': 1035674,
  'York Capital Management': 1480532,
  'Farallon Capital Management': 909661,
  'Baker Bros Advisors': 1263508,
  'Bank of America Corp': 70858,
  'Wells Fargo & Company': 72971,
  // Added from a user-supplied, SEC-EDGAR-verified "Top 100 institutional
  // investors by AUM" (2026Q1 13F data) list — banks, broker-dealers, pension
  // funds, and central banks go here; traditional mutual/index fund
  // complexes go in INVESTMENT_FUND_MANAGERS below, mirroring the existing split.
  'Bank of New York Mellon Corp': 1390777,
  'Royal Bank of Canada': 1000275,
  'UBS Group AG': 1610520,
  'Norges Bank': 1374170,
  'Ameriprise Financial': 820027,
  'LPL Financial': 1403438,
  'Envestnet Asset Management': 1407543,
  'Raymond James Financial': 720005,
  'Deutsche Bank AG': 948046,
  'Barclays PLC': 312069,
  'Bank of Montreal': 927971,
  'Jones Financial Companies (Edward Jones)': 815917,
  'Arrowstreet Capital': 1164508,
  'PNC Financial Services Group': 713676,
  'HSBC Holdings': 873630,
  'Swiss National Bank': 1582202,
  'California Public Employees Retirement System (CalPERS)': 919079,
  'Sumitomo Mitsui Trust Group': 1475365,
  // Moved here from INVESTMENT_FUND_MANAGERS — these are asset-management
  // firms (13F-filing companies), not ETF products, so they belong with the
  // other institutional 13F filers. INVESTMENT_FUND_MANAGERS is now reserved
  // for actual ETF tickers only.
  'Vanguard Advisers': 947529,
  'FMR LLC (Fidelity)': 315066,
  'T. Rowe Price Investment Management': 1897612,
  'Capital Research Global Investors': 1422848,
  'Capital World Investors': 1422849,
  'Wellington Management Group': 902219,
  'Invesco Ltd': 914208,
  'Franklin Resources': 38777,
  'ARK Investment Management': 1697748,
  'Dimensional Fund Advisors': 354204,
  'Geode Capital Management': 1214717,
  'Northern Trust Corp': 73124,
  'Vanguard Capital Management': 2100119,
  'Vanguard Portfolio Management': 2100121,
  'T. Rowe Price Associates': 80255,
  'Charles Schwab Investment Management': 884546,
  'Capital International Investors': 1562230,
  'UBS Asset Management Americas': 861177,
  'Legal & General Group': 764068,
  Nuveen: 1871926,
  Amundi: 1330387,
  AllianceBernstein: 1109448,
  'MFS Investment Management': 912938,
  'Fisher Asset Management': 850529,
  'Janus Henderson Group': 1274173,
  'Vanguard Fiduciary Trust Co': 933478,
  'American Century Companies': 748054,
  'Principal Financial Group': 1126328,
  'Dodge & Cox': 200217,
  'Mirae Asset Global Investments': 1569395,
  'Victory Capital Management': 1040188,
  'Jennison Associates': 53417,
  'Mitsubishi UFJ Asset Management': 1466546,
  'Creative Planning': 1540235,
  'First Trust Advisors': 1125816,
  'Neuberger Berman Group': 1465109,
  'FIL Limited (Fidelity International)': 318989,
  'Primecap Management': 763212,
  'Schroder Investment Management Group': 1086619,
  'Van Eck Associates Corp': 869178,
  'TD Asset Management': 1056053,
  'Rhumbline Advisers': 1115418,
  'Clearbridge Investments': 1348883,
  'Manulife (Manufacturers Life Insurance Company)': 928047,
  'Nordea Investment Management': 1218210,
  'Baillie Gifford & Co': 1088875,
  'SEI Investments': 350894,
  'Pictet Asset Management': 1993888,
  'Boston Partners': 1386060,
  'Vanguard Global Advisers': 1811242,
}

export const INVESTMENT_FUND_MANAGERS = {
  // Top-100-ETFs-by-AUM (user-supplied, SEC-EDGAR-verified list) — these are
  // ETF product tickers, not 13F-filing firms. Their registrant CIK is the
  // fund/trust's own CIK, which does NOT file 13F-HRs, so "Refresh from SEC"
  // will show "No 13F-HR filing found" for every one of these — kept anyway
  // per explicit request. Several tickers also share one sponsor-trust CIK
  // (e.g. dozens of iShares ETFs all use CIK 1100663), so clicking any of
  // those will land on the same manager page and show whichever ETF name
  // happened to be listed last for that CIK — also accepted per request.
  'VOO — Vanguard S&P 500 ETF': 36405,
  'IVV — iShares Core S&P 500 ETF': 1100663,
  'SPY — State Street SPDR S&P 500 ETF': 884394,
  'VTI — Vanguard Total Stock Market ETF': 36405,
  'QQQ — Invesco QQQ Trust Series I': 1067839,
  'VEA — Vanguard FTSE Developed Markets ETF': 923202,
  'VUG — Vanguard Growth ETF': 36405,
  'VTV — Vanguard Value ETF': 36405,
  'IEFA — iShares Core MSCI EAFE ETF': 1100663,
  'BND — Vanguard Total Bond Market ETF': 794105,
  'VXUS — Vanguard Total International Stock ETF': 736054,
  'SPYM — State Street SPDR Portfolio S&P 500 ETF': 1064642,
  'IEMG — iShares Core MSCI Emerging Markets ETF': 930667,
  'VGT — Vanguard Information Technology ETF': 52848,
  'AGG — iShares Core U.S. Aggregate Bond ETF': 1100663,
  'GLD — SPDR Gold Shares': 1222333,
  'IWF — iShares Russell 1000 Growth ETF': 1100663,
  'VWO — Vanguard FTSE Emerging Markets ETF': 857489,
  'IJH — iShares Core S&P Mid-Cap ETF': 1100663,
  'XLK — State Street Technology Select Sector SPDR ETF': 1064641,
  'VIG — Vanguard Dividend Appreciation ETF': 734383,
  'IJR — iShares Core S&P Small-Cap ETF': 1100663,
  'VO — Vanguard Mid-Cap ETF': 36405,
  'QQQM — Invesco NASDAQ 100 ETF': 1378872,
  'SCHD — Schwab US Dividend Equity ETF': 1454889,
  'SGOV — iShares 0-3 Month Treasury Bond ETF': 1100663,
  'RSP — Invesco S&P 500® Equal Weight ETF': 1209466,
  'ITOT — iShares Core S&P Total U.S. Stock Market ETF': 1100663,
  'BNDX — Vanguard Total International Bond ETF': 1532203,
  'IWM — iShares Russell 2000 ETF': 1100663,
  'VB — Vanguard Small Cap ETF': 36405,
  'IWD — iShares Russell 1000 Value ETF': 1100663,
  'VYM — Vanguard High Dividend Yield Index ETF': 1004655,
  'VT — Vanguard Total World Stock ETF': 857489,
  'EFA — iShares MSCI EAFE ETF': 1100663,
  'IVW — iShares S&P 500 Growth ETF': 1100663,
  'SMH — VanEck Semiconductor ETF': 1137360,
  'SCHX — Schwab U.S. Large-Cap ETF': 1454889,
  'VEU — Vanguard FTSE All-World ex-US Index Fund': 857489,
  'VCIT — Vanguard Intermediate-Term Corporate Bond ETF': 1021882,
  'SCHF — Schwab International Equity ETF': 1454889,
  'IAU — iShares Gold Trust': 1278680,
  'SCHG — Schwab U.S. Large-Cap Growth ETF': 1454889,
  'IXUS — iShares Core MSCI Total International Stock ETF': 1100663,
  'IWR — iShares Russell Midcap ETF': 1100663,
  'XLF — State Street Financial Select Sector SPDR ETF': 1064641,
  'VV — Vanguard Large Cap ETF': 36405,
  'SPYG — State Street SPDR Portfolio S&P 500 Growth ETF': 1064642,
  'IVE — iShares S&P 500 Value ETF': 1100663,
  'IWB — iShares Russell 1000 ETF': 1100663,
  'DFAC — Dimensional U.S. Core Equity 2 ETF': 1816125,
  'IEF — iShares 7-10 Year Treasury Bond ETF': 1100663,
  'SOXX — iShares Semiconductor ETF': 1100663,
  'BIL — State Street SPDR Bloomberg 1-3 Month T-Bill ETF': 1064642,
  'VTEB — Vanguard Tax-Exempt Bond ETF': 225997,
  'QUAL — iShares MSCI USA Quality Factor ETF': 1100663,
  'MUB — iShares National Muni Bond ETF': 1100663,
  'IBIT — iShares Bitcoin Trust ETF': 1980994,
  'DIA — State Street SPDR Dow Jones Industrial Average ETF Trust': 1041130,
  'JEPI — JPMorgan Equity Premium Income Fund': 1485894,
  'VCSH — Vanguard Short-Term Corporate Bond ETF': 1021882,
  'VONG — Vanguard Russell 1000 Growth ETF': 1021882,
  'BSV — Vanguard Short-Term Bond ETF': 794105,
  'GOVT — iShares U.S. Treasury Bond ETF': 1100663,
  'SCHB — Schwab U.S. Broad Market ETF': 1454889,
  'IUSB — iShares Core Total USD Bond Market ETF': 1100663,
  'VGIT — Vanguard Intermediate-Term Treasury ETF': 1021882,
  'TLT — iShares 20+ Year Treasury Bond ETF': 1100663,
  'DGRO — iShares Core Dividend Growth ETF': 1100663,
  'XLV — State Street Health Care Select Sector SPDR ETF': 1064641,
  'JEPQ — JPMorgan NASDAQ Equity Premium Income ETF': 1485894,
  'JPST — JPMorgan Ultra-Short Income ETF': 1485894,
  'SPDW — State Street SPDR Portfolio Developed World ex-US ETF': 1168164,
  'MBB — iShares MBS ETF': 1100663,
  'VNQ — Vanguard Real Estate ETF': 734383,
  'DYNF — iShares U.S. Equity Factor Rotation Active ETF': 1761055,
  'VBR — Vanguard Small Cap Value ETF': 36405,
  'XLE — State Street Energy Select Sector SPDR ETF': 1064641,
  'CGDV — Capital Group Dividend Value ETF': 1870128,
  'SPYV — State Street SPDR Portfolio S&P 500 Value ETF': 1064642,
  'LQD — iShares iBoxx $ Investment Grade Corporate Bond ETF': 1100663,
  'TQQQ — ProShares UltraPro QQQ': 1174610,
  'XLI — State Street Industrial Select Sector SPDR ETF': 1064641,
  'MGK — Vanguard Mega Cap Growth ETF': 52848,
  'ACWI — iShares MSCI ACWI ETF': 1100663,
  'IUSG — iShares Core S&P U.S. Growth ETF': 1100663,
  'VXF — Vanguard Extended Market ETF': 36405,
  'IDEV — iShares Core MSCI International Developed Markets ETF': 1100663,
  'VGK — Vanguard FTSE Europe ETF': 857489,
  'VGSH — Vanguard Short-Term Treasury ETF': 1021882,
  'BIV — Vanguard Intermediate-Term Bond ETF': 794105,
  'EEM — iShares MSCI Emerging Markets ETF': 930667,
  'JAAA — Janus Henderson AAA CLO ETF': 1500604,
  'AVUV — Avantis U.S. Small Cap Value ETF': 1710607,
  'USHY — iShares Broad USD High Yield Corporate Bond ETF': 1100663,
  'SLV — iShares Silver Trust': 1330568,
  'GLDM — SPDR Gold Minishares Trust': 1618181,
  'FBND — Fidelity Total Bond ETF': 1562565,
  'MDY — State Street SPDR S&P MIDCAP 400 ETF Trust': 936958,
  'MTUM — iShares MSCI USA Momentum Factor ETF': 1100663,
}

const CIK_TO_NAME = new Map(
  Object.entries({ ...HEDGE_FUNDS_AND_INSTITUTIONS, ...INVESTMENT_FUND_MANAGERS }).map(([name, cik]) => [cik, name]),
)

const HEDGE_FUND_CIKS = new Set(Object.values(HEDGE_FUNDS_AND_INSTITUTIONS))

// Which Supabase table a manager's saved snapshot belongs in -- mirrors the
// existing "Hedge Funds & Institutions" vs "Investment / Mutual Funds" tabs.
export function getManagerCategory(cik) {
  const cikNum = Number(cik)
  if (!CIK_TO_NAME.has(cikNum)) return null
  return HEDGE_FUND_CIKS.has(cikNum) ? 'institution' : 'etf'
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function normalizeName(text) {
  let cleaned = String(text || '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toUpperCase()
    .trim()
  for (const suffix of [' INC', ' CORP', ' CO', ' LTD', ' PLC', ' LLC', ' LP']) {
    if (cleaned.endsWith(suffix)) cleaned = cleaned.slice(0, -suffix.length)
  }
  return cleaned.trim()
}

// 13F info tables have no ticker field (only issuer name + CUSIP) -- this
// inverts SEC's own ticker->company map into a normalized-name->ticker index
// so a manager's positions can show a real ticker (and therefore a Saved
// badge / link) for any issuer whose name matches a known public ticker.
// Best-effort: bonds, foreign private issuers, and name variants won't match.
let nameToTickerPromise = null
async function getNameToTickerIndex() {
  if (!nameToTickerPromise) {
    nameToTickerPromise = getTickerMap().then((map) => {
      const index = new Map()
      for (const entry of map.values()) {
        const key = normalizeName(entry.title)
        if (!index.has(key)) index.set(key, entry.ticker.toUpperCase())
      }
      return index
    })
  }
  return nameToTickerPromise
}

async function findInfoTableUrl(cik, accessionNumber) {
  const dir = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDashes(accessionNumber)}`
  const index = await fetchSec(`${dir}/index.json`)
  const items = index.directory?.item || []
  // The 13F cover page (primary_doc.xml) and the holdings "information table"
  // are separate XML documents in the same filing -- the info table is the
  // other (and by far larger) .xml file in the directory.
  const candidates = items.filter((item) => /\.xml$/i.test(item.name) && !/primary_doc/i.test(item.name))
  if (!candidates.length) return null
  candidates.sort((a, b) => Number(b.size || 0) - Number(a.size || 0))
  return `${dir}/${candidates[0].name}`
}

async function findLatest13F(cik) {
  const submissions = await getSubmissions(cik)
  const recent = submissions.filings?.recent
  if (!recent) return null
  let latestIndex = -1
  for (let i = 0; i < (recent.form?.length || 0); i += 1) {
    if (recent.form[i] === '13F-HR' && (latestIndex === -1 || recent.filingDate[i] > recent.filingDate[latestIndex])) {
      latestIndex = i
    }
  }
  if (latestIndex === -1) return null
  return { accessionNumber: recent.accessionNumber[latestIndex], filingDate: recent.filingDate[latestIndex] }
}

const FIELD_PATTERNS = {
  issuer: /<nameOfIssuer>([\s\S]*?)<\/nameOfIssuer>/,
  cusip: /<cusip>([\s\S]*?)<\/cusip>/,
  value: /<value>([\s\S]*?)<\/value>/,
  shares: /<sshPrnamt>([\s\S]*?)<\/sshPrnamt>/,
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXmlEntities(text) {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => XML_ENTITIES[entity])
}

function extractField(block, pattern) {
  const match = block.match(pattern)
  return match ? decodeXmlEntities(match[1].trim()) : null
}

// A single logical position is often split across several infoTable rows
// (e.g. one per sub-manager within a filer's consolidated 13F) -- aggregate
// by CUSIP so each holding is reported once. Large managers' info tables run
// 10-20k+ rows and tens of MB, so this uses a single-pass regex scan instead
// of building a full DOM tree (a general-purpose XML parser is dramatically
// slower here and can stall the event loop for the biggest filers).
async function parseInfoTable(url) {
  // Some managers' info tables run 50MB+ (thousands of positions x multiple
  // sub-manager rows) -- bound the wait so one huge/slow filer can't stall
  // the whole "who holds this ticker" fan-out; it's counted as a failed
  // manager rather than blocking the others. heavyLimit (not the general
  // limiter) caps concurrency to 2, since SEC stalls connections when several
  // of these multi-MB downloads run at once even though each is fast alone.
  const xml = await heavyLimit(() => fetchSec(url, { json: false, timeoutMs: 25000 }))
  const byCusip = new Map()

  const blockPattern = /<infoTable>([\s\S]*?)<\/infoTable>/g
  let match
  while ((match = blockPattern.exec(xml)) !== null) {
    const block = match[1]
    const issuer = extractField(block, FIELD_PATTERNS.issuer) || 'N/A'
    const cusip = extractField(block, FIELD_PATTERNS.cusip) || ''
    const value = Number(extractField(block, FIELD_PATTERNS.value)) || 0
    const shares = Number(extractField(block, FIELD_PATTERNS.shares)) || 0
    const key = cusip || issuer

    const existing = byCusip.get(key)
    if (existing) {
      existing.shares += shares
      existing.value += value
    } else {
      byCusip.set(key, { issuer, cusip, shares, value })
    }
  }

  return [...byCusip.values()]
}

// If the user has already manually saved this manager's full portfolio via
// "Save to Supabase" (institution_snapshots / etf_snapshots), reuse it
// directly -- it already has every position, so a brand-new ticker lookup
// doesn't need SEC at all for a manager that's already covered. Takes
// priority over the lazy edgar_holdings_cache below: it's explicit, has no
// TTL, and matches the "I already saved it, don't refetch" mental model.
async function readSavedManagerSnapshot(cik) {
  const supabase = getSupabase()
  if (!supabase) return null
  const category = getManagerCategory(cik)
  if (!category) return null
  const table = category === 'institution' ? 'institution_snapshots' : 'etf_snapshots'
  try {
    const { data, error } = await supabase.from(table).select('*').eq('cik', cik).maybeSingle()
    if (error || !data) return null
    const positions = data.data?.positions || []
    const holdings = positions.map((position) => ({
      issuer: position.issuer,
      cusip: position.cusip,
      shares: position.shares || 0,
      value: position.valueUsd || 0,
    }))
    step(`${data.manager_name} (CIK ${cik}): using manually-saved snapshot from Supabase table \`${table}\` (saved ${data.created_at}) — ${holdings.length} positions, no live SEC fetch needed`)
    return { managerName: data.manager_name, filingDate: data.data?.filingDate ?? null, filingUrl: data.data?.filingUrl ?? null, holdings }
  } catch {
    return null // table may not exist yet -- fall through to the lazy cache / live fetch
  }
}

async function readCache(cik) {
  const supabase = getSupabase()
  if (!supabase) return null
  try {
    const { data, error } = await supabase.from('edgar_holdings_cache').select('*').eq('cik', cik).maybeSingle()
    if (error || !data) return null
    if (Date.now() - new Date(data.fetched_at).getTime() > CACHE_TTL_MS) {
      step(`${data.manager_name} (CIK ${cik}): cached 13F is older than 3 days — refetching live`)
      return null
    }
    step(`${data.manager_name} (CIK ${cik}): using cached 13F (filed ${data.filing_date}) from edgar_holdings_cache — no live fetch needed`)
    return { managerName: data.manager_name, filingDate: data.filing_date, filingUrl: data.filing_url, holdings: data.holdings }
  } catch {
    return null // table may not exist yet -- fall through to a live fetch
  }
}

async function writeCache(cik, result) {
  const supabase = getSupabase()
  if (!supabase) return
  try {
    await supabase.from('edgar_holdings_cache').upsert({
      cik,
      manager_name: result.managerName,
      filing_date: result.filingDate,
      filing_url: result.filingUrl,
      holdings: result.holdings,
      fetched_at: new Date().toISOString(),
    })
  } catch {
    // Non-fatal -- caching is a performance optimization, not required for correctness.
  }
}

async function fetchManagerHoldings(name, cik, { forceLive = false } = {}) {
  if (forceLive) {
    step(`${name} (CIK ${cik}): "Refresh from SEC" requested — bypassing saved snapshot and cache`)
  } else {
    const saved = await readSavedManagerSnapshot(cik)
    if (saved) return { ...saved, error: null }

    const cached = await readCache(cik)
    if (cached) return { ...cached, error: null }
  }

  step(`${name} (CIK ${cik}): checking for its latest 13F-HR`)
  try {
    const latest = await findLatest13F(cik)
    if (!latest) {
      step(`${name} (CIK ${cik}): no 13F-HR filing found on record`)
      return { managerName: name, error: 'No 13F-HR filing found', holdings: [] }
    }
    step(`${name} (CIK ${cik}): latest 13F-HR is accession ${latest.accessionNumber}, filed ${latest.filingDate} — locating its information table`)

    const infoTableUrl = await findInfoTableUrl(cik, latest.accessionNumber)
    if (!infoTableUrl) {
      step(`${name} (CIK ${cik}): could not locate an information table XML in that filing's directory`)
      return { managerName: name, error: 'Could not locate information table', holdings: [] }
    }

    const holdings = await parseInfoTable(infoTableUrl)
    step(`${name} (CIK ${cik}): parsed ${holdings.length.toLocaleString('en-US')} aggregated positions from the information table`)
    const filingUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDashes(latest.accessionNumber)}/`
    const result = { managerName: name, filingDate: latest.filingDate, filingUrl, holdings, error: null }
    await writeCache(cik, result)
    return result
  } catch (error) {
    step(`${name} (CIK ${cik}): failed — ${error instanceof Error ? error.message : 'unknown error'}`)
    return { managerName: name, error: error instanceof Error ? error.message : 'Failed to fetch 13F holdings', holdings: [] }
  }
}

// SEC's 13F schema has no ticker field (only issuer name + CUSIP) -- match by
// normalized issuer name against the company's own name. This mirrors the
// Python original's own fallback path for filers with no ticker enrichment.
export async function findHoldersOfTicker(companyName, managers) {
  const normalizedCompany = normalizeName(companyName)
  const holders = []
  let managersFailed = 0

  const entries = Object.entries(managers)
  step(`Checking all ${entries.length} tracked managers' latest 13F-HR for a position in "${companyName}" (normalized: "${normalizedCompany}"), up to 6 at a time`)
  await Promise.all(
    entries.map(([name, cik]) =>
      rateLimit(() => fetchManagerHoldings(name, cik)).then((data) => {
        if (data.error) {
          managersFailed += 1
          return
        }
        const match = data.holdings.find((row) => normalizeName(row.issuer) === normalizedCompany)
        if (match) {
          step(`${data.managerName}: holds ${companyName} — ${(match.shares || 0).toLocaleString('en-US')} shares worth $${(match.value || 0).toLocaleString('en-US')}`)
          holders.push({
            managerName: data.managerName,
            cik,
            shares: match.shares || null,
            valueUsd: match.value || null,
            filingDate: data.filingDate,
            filingUrl: data.filingUrl,
          })
        } else {
          step(`${data.managerName}: does not currently report holding ${companyName}`)
        }
      }),
    ),
  )

  holders.sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0))
  step(`Done: ${holders.length} of ${entries.length} managers hold ${companyName} (${managersFailed} failed to check)`)
  return { holders, managersChecked: entries.length, managersFailed }
}

export async function getInstitutionalHoldings(companyName, kind) {
  const managers = kind === 'investment-fund' ? INVESTMENT_FUND_MANAGERS : HEDGE_FUNDS_AND_INSTITUTIONS
  const { holders, managersChecked, managersFailed } = await findHoldersOfTicker(companyName, managers)
  return { kind, holders, managersChecked, managersFailed }
}

export async function getManagerPortfolio(cik, { forceLive = false } = {}) {
  const cikNum = Number(cik)
  const name = CIK_TO_NAME.get(cikNum)
  if (!name) {
    step(`CIK ${cik} is not in the curated manager list — no portfolio to build`)
    return null
  }

  const data = await fetchManagerHoldings(name, cikNum, { forceLive })
  if (data.error) {
    return { managerName: name, cik: cikNum, filingDate: null, filingUrl: null, totalValue: 0, positions: [], error: data.error }
  }

  const totalValue = data.holdings.reduce((sum, row) => sum + (row.value || 0), 0)
  step(`Building ${name}'s portfolio: ${data.holdings.length} positions, $${totalValue.toLocaleString('en-US')} total value — resolving tickers by issuer name`)
  const nameIndex = await getNameToTickerIndex()
  const positions = data.holdings
    .map((row) => ({
      issuer: row.issuer,
      ticker: nameIndex.get(normalizeName(row.issuer)) || '',
      cusip: row.cusip,
      shares: row.shares || null,
      valueUsd: row.value || 0,
      weight: totalValue > 0 ? ((row.value || 0) / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.valueUsd - a.valueUsd)
  step(`Resolved tickers for ${positions.filter((p) => p.ticker).length} of ${positions.length} positions by issuer name`)

  return { managerName: data.managerName, cik: cikNum, filingDate: data.filingDate, filingUrl: data.filingUrl, totalValue, positions }
}
