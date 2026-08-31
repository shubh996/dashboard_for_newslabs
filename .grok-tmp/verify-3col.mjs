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
    ticker: 'AAPL', mode: 'research', kind: 'peak', label: 'Apple',
    move: 3.25, price: 198.4, direction: 'UP', headline: '$AAPL +3.25%',
    likelyDriver: 'Strong iPhone demand and AI PC narrative.',
    createdAt: Date.now(),
  }))
})
const popup = await context.newPage()
await popup.goto('http://localhost:5173/trigger?ticker=AAPL&share=1&mode=research&kind=peak&move=3.25&price=198.4', { waitUntil: 'domcontentloaded' })
await popup.waitForTimeout(5000)
await popup.screenshot({ path: '.grok-tmp/peak-3col.png' })

const col1 = await popup.getByText('1 · Perplexity research').count()
const col2 = await popup.getByText('2 · Notification').count()
const col3 = await popup.getByText('3 · Share image').count()
const likelyTop = await popup.getByText('Likely driver').count()
const editBtn = await popup.getByRole('button', { name: /^Edit$/i }).count()
const shareBtn = await popup.getByRole('button', { name: /Share on social media/i }).count()
const notifyBtn = await popup.getByRole('button', { name: /Notify users/i }).count()
const img = await popup.locator('img[alt*="share preview"]').count()

console.log(JSON.stringify({ col1, col2, col3, likelyTop, editBtn, shareBtn, notifyBtn, img }))
await browser.close()
if (!col1 || !col2 || !col3 || !editBtn || !shareBtn) process.exit(1)
