import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1000)
}
await page.evaluate(() => {
  localStorage.setItem('9am-site-unlocked', '1')
  localStorage.setItem('trigger-share-payload-local-v1', JSON.stringify({
    ticker: 'AAPL',
    mode: 'research',
    kind: 'peak',
    label: 'Apple',
    move: 3.25,
    price: 198.4,
    direction: 'UP',
    headline: '$AAPL +3.25%',
    likelyDriver: 'Seeded STARTED driver: strong iPhone demand and AI PC narrative.',
    createdAt: Date.now(),
  }))
})

const popup = await context.newPage()
await popup.goto('http://localhost:5173/trigger?ticker=AAPL&share=1&mode=research&kind=peak&move=3.25&price=198.4', { waitUntil: 'domcontentloaded' })
await popup.waitForTimeout(4000)
await popup.screenshot({ path: '.grok-tmp/peak-02-prefilled.png' })

const title = await popup.getByText(/Peak research/i).count()
const prefilled = await popup.getByText(/Prefilled from episode STARTED research/i).count()
const bodyVal = await popup.locator('#sofar-body').inputValue().catch(() => '')
const shareEnabled = await popup.getByRole('button', { name: /Share on social/i }).isEnabled()

console.log(JSON.stringify({ title, prefilled, bodyVal, shareEnabled, url: popup.url() }))
await browser.close()
if (!title || !bodyVal.includes('Seeded STARTED driver')) process.exit(1)
