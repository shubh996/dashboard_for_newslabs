import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(1000)
}
await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
await page.waitForTimeout(5000)
const body = await page.locator('body').innerText()
console.log({
  hasRolling: /Rolling returns/i.test(body),
  hasClosed: /Market closed|Pre-market|After-hours/i.test(body),
  hasYahooBanner: /Yahoo Finance data|quote request failed|returned no quote/i.test(body),
  closedLine: (body.match(/(Market closed|Pre-market|After-hours)[^\n]*/)?.[0] || '').slice(0, 160),
})
await page.screenshot({ path: '.grok-tmp/desk-baseline.png' })
await browser.close()
