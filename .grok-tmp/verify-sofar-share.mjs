import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.setDefaultTimeout(35000)

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1800)
}
// Seed unlock for new tabs
await page.evaluate(() => localStorage.setItem('9am-site-unlocked', '1'))

const sofarBtn = page.locator('button[aria-label^="Share "][aria-label*="So Far"]').first()
await sofarBtn.waitFor({ timeout: 25000 })
console.log('clicking', await sofarBtn.getAttribute('aria-label'))

const [popup] = await Promise.all([
  context.waitForEvent('page', { timeout: 15000 }),
  sofarBtn.click(),
])
await popup.waitForLoadState('domcontentloaded')
// Unlock if needed
if (await popup.locator('#site-passcode').count()) {
  await popup.locator('#site-passcode').fill('6565')
  await popup.keyboard.press('Enter')
}
await popup.waitForTimeout(4000)
await popup.screenshot({ path: '.grok-tmp/sofar-01-trigger-tab.png' })

const title = await popup.getByText(/So Far research/i).count()
const runBtn = await popup.getByRole('button', { name: /Run research/i }).count()
const notifyBtn = await popup.getByRole('button', { name: /Notify users/i }).count()
const shareBtn = await popup.getByRole('button', { name: /Share on social/i }).count()
let promptLen = 0
try {
  await popup.locator('textarea').first().waitFor({ timeout: 15000 })
  promptLen = (await popup.locator('textarea').first().inputValue()).length
} catch {}

console.log(JSON.stringify({ title, runBtn, notifyBtn, shareBtn, promptLen, url: popup.url() }))
await popup.screenshot({ path: '.grok-tmp/sofar-02-composer.png' })
await browser.close()
if (!title || !runBtn) process.exit(1)
