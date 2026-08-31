import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(35000)

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2000)
}
await page.evaluate(() => localStorage.setItem('9am-site-unlocked', '1'))

// Wait for all-episodes table; peak buttons
await page.waitForTimeout(2000)
const peakBtn = page.getByRole('button', { name: /peak/i }).filter({ hasText: /%/ }).first()
// Fallback: any button whose aria-label contains peak
const alt = page.locator('button[aria-label*="peak"]').first()
const btn = (await peakBtn.count()) ? peakBtn : alt
await btn.waitFor({ timeout: 25000 })
console.log('clicking', await btn.getAttribute('aria-label'))

const [popup] = await Promise.all([
  context.waitForEvent('page', { timeout: 20000 }),
  btn.click(),
])
await popup.waitForLoadState('domcontentloaded')
if (await popup.locator('#site-passcode').count()) {
  await popup.locator('#site-passcode').fill('6565')
  await popup.keyboard.press('Enter')
}
await popup.waitForTimeout(5000)
await popup.screenshot({ path: '.grok-tmp/peak-01-composer.png' })

const title = await popup.getByText(/Peak research/i).count()
const prefilled = await popup.getByText(/Prefilled from episode STARTED research/i).count()
const runBtn = await popup.getByRole('button', { name: /Run research/i }).count()
const notifyBtn = await popup.getByRole('button', { name: /Notify users/i }).count()
const shareBtn = await popup.getByRole('button', { name: /Share on social/i }).count()
const bodyVal = await popup.locator('#sofar-body').inputValue().catch(() => '')

console.log(JSON.stringify({
  title, prefilled, runBtn, notifyBtn, shareBtn,
  bodyLen: bodyVal.length,
  bodyPreview: bodyVal.slice(0, 160),
  url: popup.url(),
}))
await browser.close()
if (!title || !runBtn) process.exit(1)
