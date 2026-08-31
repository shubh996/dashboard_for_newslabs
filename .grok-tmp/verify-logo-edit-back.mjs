import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
}
await page.evaluate(() => {
  localStorage.setItem('9am-site-unlocked', '1')
  localStorage.setItem('trigger-share-payload-local-v1', JSON.stringify({
    ticker: 'TSLA', mode: 'research', kind: 'peak', label: 'Tesla, Inc.',
    move: 2.5, price: 250, priceFrom: 244, direction: 'UP',
    exactLabel: '5 minutes',
    headline: '$TSLA +2.50% in the last 5 minutes',
    likelyDriver: 'Robotaxi narrative and delivery beat.',
    createdAt: Date.now(),
  }))
})
const popup = await context.newPage()
await popup.goto('http://localhost:5173/trigger?ticker=TSLA&share=1&mode=research&kind=peak&move=2.5&price=250&priceFrom=244&label=Tesla%2C%20Inc.', { waitUntil: 'domcontentloaded' })
await popup.waitForTimeout(7000)
await popup.screenshot({ path: '.grok-tmp/tsla-logo-preview.png' })

const toastCount = await popup.getByText(/Research composer opened|Peak · TSLA|So Far · TSLA/i).count()
const peakTitle = await popup.getByText(/Peak research/i).count()
const imgCount = await popup.locator('img[alt*="share preview"]').count()

await popup.getByRole('button', { name: /^Edit$/i }).click()
await popup.waitForTimeout(4500)
const editorOpen = await popup.getByText(/Share on social media/i).count()
await popup.screenshot({ path: '.grok-tmp/tsla-edit-open.png' })

// Close the topmost share editor with Escape
await popup.keyboard.press('Escape')
await popup.waitForTimeout(2000)
const backToPeak = await popup.getByText(/Peak research/i).count()
const stillOnTrigger = popup.url().includes('/trigger')
await popup.screenshot({ path: '.grok-tmp/tsla-back-peak.png' })

console.log(JSON.stringify({ toastCount, peakTitle, imgCount, editorOpen, backToPeak, stillOnTrigger, url: popup.url() }))
await browser.close()
if (toastCount > 0) process.exit(2)
if (!peakTitle || !backToPeak || !stillOnTrigger) process.exit(1)
