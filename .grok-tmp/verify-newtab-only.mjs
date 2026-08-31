import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
}
await page.evaluate(() => localStorage.setItem('9am-site-unlocked', '1'))
await page.waitForTimeout(1500)

const before = page.url()
const sofar = page.locator('button[aria-label*="So Far"]').first()
await sofar.waitFor({ timeout: 20000 })

const [popup] = await Promise.all([
  context.waitForEvent('page', { timeout: 15000 }),
  sofar.click(),
])
await popup.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)

const after = page.url()
const popupUrl = popup.url()
console.log(JSON.stringify({ before, after, popupUrl, deskUnchanged: before.split('?')[0] === after.split('?')[0] && !after.includes('/trigger') }))
await browser.close()
if (after.includes('/trigger')) process.exit(1)
