import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
let blockQuote = false
const hits = []
await page.route('**/api/yahoo/**', async (route) => {
  const u = route.request().url()
  hits.push(u)
  if (blockQuote && /\/api\/yahoo\/[^/]+\/quote(\?|$)/.test(u)) {
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'yahoo down' }) })
  }
  return route.continue()
})
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(1000)
}
await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
await page.waitForTimeout(4000)
let body = await page.locator('body').innerText()
console.log('before block hasRolling', /Rolling returns/i.test(body))
console.log('before closed', /Market closed|Pre-market|After-hours/i.test(body))
blockQuote = true
// force refresh by clicking another ticker then back
for (const t of ['TSLA', 'AAPL', 'SNDK', 'NVDA']) {
  const el = page.getByText(t, { exact: true })
  if (await el.count()) {
    await el.first().click({ force: true }).catch(()=>{})
    await page.waitForTimeout(1500)
  }
}
await page.waitForTimeout(3000)
body = await page.locator('body').innerText()
const quoteHits = hits.filter(u => /\/quote(\?|$)/.test(u))
console.log('quoteHits', quoteHits.slice(-5))
console.log('banner', (body.match(/Yahoo Finance[^\n]*/)?.[0] || 'NONE').slice(0, 240))
console.log('hasRolling', /Rolling returns/i.test(body))
await page.screenshot({ path: '.grok-tmp/yahoo-feed-banner5.png' })
await browser.close()
process.exit(/Yahoo Finance/i.test(body) ? 0 : 1)
