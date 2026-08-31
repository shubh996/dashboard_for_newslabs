import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.route('**/api/yahoo/**', (route) => {
  const u = route.request().url()
  if (u.includes('/quote') || u.includes('/quotes')) {
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
await page.waitForTimeout(3500)
const banner = page.locator('p').filter({ hasText: /Yahoo Finance/i })
const badge = page.getByText('Yahoo', { exact: true })
const bannerOk = await banner.first().isVisible().catch(() => false)
const badgeOk = await badge.first().isVisible().catch(() => false)
const text = bannerOk ? await banner.first().innerText() : ''
await page.screenshot({ path: '.grok-tmp/yahoo-feed-banner.png' })
console.log(JSON.stringify({ bannerOk, badgeOk, text: text.slice(0, 180) }, null, 2))
await browser.close()
process.exit(bannerOk && badgeOk ? 0 : 1)
