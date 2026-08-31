import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.route('**/api/yahoo/**/quote', async (route) => {
  return route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'yahoo quote down' }),
  })
})
// let batch quotes through so ServiceErrorGate may still pass
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(1000)
}
await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
await page.waitForTimeout(3000)
// Dismiss service error if present
for (const name of ['Close', 'Dismiss', 'Continue', 'Ignore']) {
  const b = page.getByRole('button', { name })
  if (await b.count()) {
    await b.first().click().catch(()=>{})
    await page.waitForTimeout(500)
  }
}
// Escape dialogs
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await page.keyboard.press('Escape')
await page.waitForTimeout(2000)
const body = await page.locator('body').innerText()
console.log({
  hasRolling: /Rolling returns/i.test(body),
  banner: (body.match(/Yahoo Finance[^\n]*/)?.[0] || 'NONE').slice(0, 240),
  hasServiceError: /Service error|Yahoo Finance \(quotes\)/i.test(body),
})
await page.screenshot({ path: '.grok-tmp/yahoo-feed-banner6.png' })
await browser.close()
process.exit(/Yahoo Finance data|Yahoo Finance quote|Yahoo Finance refresh|Yahoo Finance returned/i.test(body) ? 0 : 1)
