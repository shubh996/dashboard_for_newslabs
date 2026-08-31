import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const hits = []
await page.route('**/api/yahoo/**', async (route) => {
  hits.push(route.request().url())
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
// wait for quote attempts
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(500)
  if (hits.length) break
}
await page.waitForTimeout(2500)
const bodyText = await page.locator('body').innerText()
const hasYahooBanner = /Yahoo Finance/i.test(bodyText)
const hasYahooBadge = /\bYahoo\b/.test(bodyText) && /Rolling returns/i.test(bodyText)
await page.screenshot({ path: '.grok-tmp/yahoo-feed-banner3.png' })
console.log(JSON.stringify({
  hits: hits.slice(0, 5),
  hasYahooBanner,
  hasYahooBadge,
  closed: /Market closed|Pre-market|After-hours/i.test(bodyText),
  bannerLine: (bodyText.match(/Yahoo Finance[^\n]*/)?.[0] || '').slice(0, 200),
}, null, 2))
await browser.close()
process.exit(hasYahooBanner ? 0 : 1)
