// Low-level SEC EDGAR client: compliant fetch, ticker->CIK lookup, and a small
// concurrency limiter (SEC's fair-access policy asks for well-behaved,
// low-concurrency traffic with an identifying User-Agent on every request).
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { step } from './stepTracer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TICKER_MAP_CACHE_PATH = path.join(__dirname, '..', 'data', 'cache', 'company_tickers.json')

const USER_AGENT = process.env.EDGAR_USER_AGENT || 'NewsLabs Dashboard shubh.helloworld@gmail.com'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchSecOnce(url, { json, timeoutMs }) {
  const controller = timeoutMs ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null

  step(`GET ${url}`)

  // The timeout must stay armed through the body read, not just until
  // headers arrive -- fetch() resolves as soon as headers are in, so a huge
  // filing (tens of MB) can still stall indefinitely inside response.text()
  // if SEC throttles the connection under concurrent load.
  try {
    const response = await fetch(url, {
      signal: controller?.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: json ? 'application/json' : 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate',
        Host: new URL(url).host,
      },
    })

    if (!response.ok) {
      step(`✗ ${response.status} from ${url}`)
      const error = new Error(`SEC request failed (${response.status}): ${url}`)
      error.status = response.status
      throw error
    }

    const body = json ? await response.json() : await response.text()
    const size = json ? JSON.stringify(body).length : body.length
    step(`✓ ${response.status} OK — ${size.toLocaleString('en-US')} bytes from ${url}`)
    return body
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// SEC's fair-access rate limit occasionally rejects a single request with 429
// even under normal usage, then clears within a second or two -- retry a
// couple of times with backoff before surfacing it as a real failure.
async function fetchSec(url, { json = true, timeoutMs, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchSecOnce(url, { json, timeoutMs })
    } catch (error) {
      if (error.status !== 429 || attempt >= retries) throw error
      step(`Rate-limited (429) on attempt ${attempt + 1} — backing off ${500 * 2 ** attempt}ms before retrying`)
      await sleep(500 * 2 ** attempt)
    }
  }
}

// Simple promise-pool limiter so 13F/insider fan-out calls don't hammer SEC.
function createLimiter(concurrency) {
  let active = 0
  const queue = []

  const runNext = () => {
    if (active >= concurrency || queue.length === 0) return
    active += 1
    const { fn, resolve, reject } = queue.shift()
    fn()
      .then(resolve, reject)
      .finally(() => {
        active -= 1
        runNext()
      })
  }

  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject })
      runNext()
    })
  }
}

const limit = createLimiter(6)
// SEC appears to intermittently stall connections when several multi-MB
// filings (13F info tables) download at the same time, even though each is
// fast in isolation -- serialize that workload entirely rather than risk an
// unbounded hang.
const heavyLimit = createLimiter(1)

let tickerMapPromise = null

function bodyToMap(body) {
  const map = new Map()
  for (const entry of Object.values(body)) {
    map.set(String(entry.ticker).toUpperCase(), {
      cik: String(entry.cik_str).padStart(10, '0'),
      ticker: entry.ticker,
      title: entry.title,
    })
  }
  return map
}

// This file is ~800KB and requested by every single ticker lookup, so it's
// the single hottest URL this app hits -- SEC appears to apply a tighter,
// separate rate limit to it specifically. Cache it to disk so a transient
// 429 (or a burst of local traffic) doesn't take down every endpoint, since
// the ticker->CIK mapping barely changes day to day.
async function loadTickerMap() {
  try {
    const body = await fetchSec('https://www.sec.gov/files/company_tickers.json')
    const map = bodyToMap(body)
    step(`Parsed ticker→CIK map: ${map.size.toLocaleString('en-US')} tickers`)
    mkdir(path.dirname(TICKER_MAP_CACHE_PATH), { recursive: true })
      .then(() => writeFile(TICKER_MAP_CACHE_PATH, JSON.stringify(body)))
      .catch(() => {})
    return map
  } catch (error) {
    step(`Live ticker map fetch failed (${error.message}) — falling back to on-disk cache`)
    try {
      const cached = await readFile(TICKER_MAP_CACHE_PATH, 'utf-8')
      const map = bodyToMap(JSON.parse(cached))
      step(`Loaded cached ticker→CIK map from disk: ${map.size.toLocaleString('en-US')} tickers`)
      return map
    } catch {
      throw error
    }
  }
}

async function getTickerMap() {
  if (!tickerMapPromise) {
    tickerMapPromise = loadTickerMap().catch((error) => {
      tickerMapPromise = null
      throw error
    })
  } else {
    step('Using ticker→CIK map already loaded in memory for this server process')
  }
  return tickerMapPromise
}

async function resolveTicker(ticker) {
  const map = await getTickerMap()
  const entry = map.get(String(ticker).toUpperCase())
  if (!entry) {
    step(`"${ticker}" not found in ticker→CIK map`)
    throw new Error(`Unknown ticker: ${ticker}`)
  }
  step(`Resolved ticker "${ticker}" → CIK ${entry.cik} ("${entry.title}")`)
  return entry
}

function cikPadded(cik) {
  return String(cik).replace(/\D/g, '').padStart(10, '0')
}

async function getSubmissions(cik) {
  return fetchSec(`https://data.sec.gov/submissions/CIK${cikPadded(cik)}.json`)
}

async function getCompanyFacts(cik) {
  return fetchSec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cikPadded(cik)}.json`)
}

function accessionNoDashes(accessionNumber) {
  return String(accessionNumber).replace(/-/g, '')
}

function filingIndexUrl(cik, accessionNumber) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDashes(accessionNumber)}/`
}

function filingDocUrl(cik, accessionNumber, document) {
  return `${filingIndexUrl(cik, accessionNumber)}${document}`
}

export {
  USER_AGENT,
  fetchSec,
  limit,
  heavyLimit,
  resolveTicker,
  cikPadded,
  getSubmissions,
  getCompanyFacts,
  getTickerMap,
  accessionNoDashes,
  filingIndexUrl,
  filingDocUrl,
}
