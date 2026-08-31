import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
await context.addInitScript(() => {
  localStorage.setItem('9am-site-unlocked', '1')
  localStorage.setItem('momentum-active-ticker-v1', 'BTC-USD')
  localStorage.setItem(
    'momentum-watchlist-v2',
    JSON.stringify([
      { ticker: 'BTC-USD', label: 'Bitcoin', assetClass: 'crypto' },
      { ticker: 'SNDK', label: 'SNDK', assetClass: 'equity' },
      { ticker: 'TSLA', label: 'SpaceX', assetClass: 'equity' },
    ]),
  )
})
const page = await context.newPage()
page.on('pageerror', e => console.log('PAGEERROR', e.message))

// First load with BTC selected, quotes working — expect no yahoo banner (crypto 24/7)
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
await page.waitForTimeout(4000)
let body = await page.locator('body').innerText()
console.log('BTC_OK', {
  rolling: /Rolling returns/i.test(body),
  closed: /Market closed|Pre-market|After-hours —/i.test(body),
  yahoo: /Yahoo Finance (quote|refresh|returned|data)/i.test(body),
  line: (body.match(/(Market closed|Pre-market|After-hours|Yahoo Finance)[^\n]*/)?.[0] || '').slice(0, 200),
})
await page.screenshot({ path: '.grok-tmp/banner-btc-ok.png' })

// Block quote endpoint and force refresh by switching tickers
await page.route('**/api/yahoo/**/quote', (route) =>
  route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) }),
)
await page.getByText('SNDK', { exact: true }).first().click({ force: true }).catch(()=>{})
await page.waitForTimeout(1500)
await page.getByText('BTC-USD', { exact: true }).first().click({ force: true }).catch(()=>{})
await page.waitForTimeout(3500)
body = await page.locator('body').innerText()
console.log('BTC_DOWN', {
  rolling: /Rolling returns/i.test(body),
  yahoo: /Yahoo Finance/i.test(body),
  line: (body.match(/Yahoo Finance[^\n]*/)?.[0] || 'NONE').slice(0, 240),
  badge: await page.getByText('Yahoo', { exact: true }).count(),
})
await page.screenshot({ path: '.grok-tmp/banner-btc-down.png' })

// Equity closed Sunday — SNDK with working quotes should show market closed (not yahoo)
await page.unroute('**/api/yahoo/**/quote')
await page.getByText('SNDK', { exact: true }).first().click({ force: true }).catch(()=>{})
await page.waitForTimeout(3500)
body = await page.locator('body').innerText()
console.log('SNDK_CLOSED', {
  rolling: /Rolling returns/i.test(body),
  closed: /Market closed|Pre-market|After-hours —/i.test(body),
  yahooBad: /Yahoo Finance (quote request failed|data is not coming)/i.test(body),
  line: (body.match(/(Market closed|Pre-market|After-hours|Yahoo Finance)[^\n]*/)?.[0] || 'NONE').slice(0, 200),
})
await page.screenshot({ path: '.grok-tmp/banner-sndk-closed.png' })
await browser.close()
const okDown = /Yahoo Finance (quote request failed|refresh failed|returned no quote|data is not coming)/i.test(
  // use last BTC_DOWN body - re-read from logs; instead track
  '' 
)
// recompute from stored
process.exit(0) // print-only; assert below
