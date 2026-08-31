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
// Wait for extremes to load
for (let i = 0; i < 20; i++) {
  const t = await page.locator('body').innerText()
  if (!/Loading Yahoo/i.test(t) && (/Positive\s*[1-9]/i.test(t) || /No Yahoo/i.test(t))) break
  await page.waitForTimeout(1000)
}
const bodyText = await page.locator('body').innerText()
console.log('---full visible text (first 2500)---')
console.log(bodyText.slice(0, 2500))
console.log('---checks---')
console.log(JSON.stringify({
  hasPositive: /Positive/i.test(bodyText),
  hasNegative: /Negative/i.test(bodyText),
  positiveCount: (bodyText.match(/Positive\s*(\d+)/)||[])[1],
  negativeCount: (bodyText.match(/Negative\s*(\d+)/)||[])[1],
  has9AM: /\b9AM\b/.test(bodyText),
  hasAudience: /Audience/i.test(bodyText),
  hasUsersTab: /Stocks list mode[\s\S]{0,200}Users/i.test(bodyText),
  hasPinnedTab: /Stocks list mode[\s\S]{0,200}Pinned/i.test(bodyText),
  hasFetchSaveAll: /Fetch & save all/i.test(bodyText),
  has9PM: /9 PM ET/i.test(bodyText),
  hasShareHint: /click a row to Share/i.test(bodyText),
}, null, 2))
await page.screenshot({ path: '.grok-tmp/trigger-lean.png', fullPage: false })
console.log('screenshot saved')
await browser.close()
