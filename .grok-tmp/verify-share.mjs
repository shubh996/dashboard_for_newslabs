import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://localhost:5173/trigger', { waitUntil: 'domcontentloaded', timeout: 60000 })
const pass = page.locator('#site-passcode')
if (await pass.count()) {
  await pass.fill('6565')
  await pass.press('Enter')
  await page.waitForTimeout(2000)
}
// Wait for extremes
for (let i = 0; i < 25; i++) {
  const t = await page.locator('body').innerText()
  if (/Positive\s*[1-9]/i.test(t)) break
  await page.waitForTimeout(1000)
}
// Click first extreme row share button (ticker button in watchlist)
const rowBtn = page.locator('[aria-label="Extreme positive movers"] button[role="tab"], [aria-label="Extreme Positive movers"] button[role="tab"], aside button[role="tab"]').first()
const count = await page.locator('aside button[role="tab"]').count()
console.log('aside tab buttons:', count)
if (count > 0) {
  const firstLabel = await page.locator('aside button[role="tab"]').first().getAttribute('title')
  console.log('clicking:', firstLabel)
  await page.locator('aside button[role="tab"]').first().click()
  await page.waitForTimeout(3000)
}
const bodyText = await page.locator('body').innerText()
console.log('---after click (first 2000)---')
console.log(bodyText.slice(0, 2000))
const dialogs = await page.locator('[role="dialog"]').count()
console.log('dialogs open:', dialogs)
await page.screenshot({ path: '.grok-tmp/trigger-after-click.png', fullPage: false })
await browser.close()
