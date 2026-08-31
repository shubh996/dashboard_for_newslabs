import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const hits = []
await page.route('**/api/yahoo/**', async (route) => {
  const u = route.request().url()
  hits.push(u.replace('http://localhost:5173', ''))
  return route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'yahoo down' }),
  })
})
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(1000)
}
await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
await page.waitForTimeout(2000)
// Click a watchlist / ticker chip if needed
const candidates = [
  page.getByText('SNDK', { exact: true }),
  page.getByText('TSLA', { exact: true }),
  page.getByText('AAPL', { exact: true }),
]
for (const c of candidates) {
  if (await c.count()) {
    await c.first().click({ force: true }).catch(() => {})
    break
  }
}
await page.waitForTimeout(4000)
console.log('HITS', [...new Set(hits)].slice(0, 15))
const bodyText = await page.locator('body').innerText()
console.log('hasRolling', /Rolling returns/i.test(bodyText))
console.log('banner', (bodyText.match(/Yahoo Finance[^\n]*/)?.[0] || 'NONE').slice(0, 220))
console.log('hasClosedBanner', /Market closed|Pre-market \/ overnight|After-hours —/i.test(bodyText))
await page.screenshot({ path: '.grok-tmp/yahoo-feed-banner4.png' })
// Evaluate react state via DOM: is banner node present
const amber = await page.locator('p.border-amber-500\\/70, p[class*="amber"]').count()
console.log('amberParagraphs', amber)
await browser.close()
process.exit(/Yahoo Finance/i.test(bodyText) ? 0 : 1)
