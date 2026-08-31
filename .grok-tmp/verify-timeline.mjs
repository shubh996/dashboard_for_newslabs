import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 })
// Passcode gate
const pass = page.locator('#site-passcode')
if (await pass.count()) {
  await pass.fill('6565')
  await page.locator('button[type="submit"]').click()
  await page.waitForTimeout(800)
}
await page.screenshot({ path: '.grok-tmp/browser/home.png', fullPage: false })

// Try open AAPL or first ticker / episode
// Look for episode list or search
const search = page.locator('input[placeholder*="Search"], input[type="search"]').first()
if (await search.count()) {
  await search.fill('AAPL')
  await page.waitForTimeout(600)
}
// Click AAPL if visible
const aapl = page.getByText('AAPL', { exact: true }).first()
if (await aapl.count()) {
  await aapl.click()
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: '.grok-tmp/browser/after-ticker.png', fullPage: false })

// Expand How this move built if collapsed
const how = page.getByText('How this move built').first()
if (await how.count()) {
  await how.click()
  await page.waitForTimeout(500)
  // Scroll it into view
  await how.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
}
await page.screenshot({ path: '.grok-tmp/browser/timeline.png', fullPage: true })

// Also crop-ish by screenshotting the how-built card
const card = page.locator('text=How this move built').locator('xpath=ancestor::div[contains(@class,"rounded-xl")]').first()
if (await card.count()) {
  await card.screenshot({ path: '.grok-tmp/browser/how-built-card.png' })
}

console.log('done')
await browser.close()
