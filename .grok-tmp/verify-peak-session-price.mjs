import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
}
await page.evaluate(() => {
  localStorage.setItem('9am-site-unlocked', '1')
  localStorage.setItem('trigger-share-payload-local-v1', JSON.stringify({
    ticker: 'AAPL', mode: 'research', kind: 'peak', label: 'Apple',
    move: 3.25, price: 198.4, priceFrom: 192.1, direction: 'UP',
    exactLabel: '5 minutes', exactMinutes: 5,
    headline: '$AAPL +3.25% in the last 5 minutes',
    likelyDriver: 'Strong iPhone demand and AI PC narrative.',
    createdAt: Date.now(),
  }))
})
const popup = await context.newPage()
await popup.goto('http://localhost:5173/trigger?ticker=AAPL&share=1&mode=research&kind=peak&move=3.25&price=198.4&priceFrom=192.1&exactLabel=5%20minutes', { waitUntil: 'domcontentloaded' })
await popup.waitForTimeout(4500)
await popup.screenshot({ path: '.grok-tmp/peak-session-price.png' })

const titleVal = await popup.locator('#sofar-title').inputValue()
const sharePriceText = await popup.getByText(/Share price/).first().textContent().catch(() => '')
const hasRange = /192\.10\s*→\s*\$?198\.40/.test(sharePriceText || '') || (sharePriceText||'').includes('→')
const hasSession = /in the last 5 minutes/i.test(titleVal)
const editBtn = await popup.getByRole('button', { name: /^Edit$/i }).count()

console.log(JSON.stringify({ titleVal, sharePriceText: (sharePriceText||'').trim().slice(0,80), hasRange, hasSession, editBtn }))
await browser.close()
if (!hasSession || !editBtn) process.exit(1)
