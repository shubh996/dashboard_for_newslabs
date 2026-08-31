import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://localhost:5173/trigger', { waitUntil: 'networkidle', timeout: 60000 })
const pass = page.locator('#site-passcode')
if (await pass.count()) {
  await pass.fill('6565')
  const btn = page.getByRole('button').filter({ hasText: /unlock|enter|continue|go|submit/i })
  if (await btn.count()) await btn.first().click()
  else await pass.press('Enter')
  await page.waitForTimeout(2000)
}
await page.waitForTimeout(2500)
const bodyText = await page.locator('body').innerText()
const checks = {
  hasPositive: /Positive/i.test(bodyText),
  hasNegative: /Negative/i.test(bodyText),
  hasWatchlist: /Watchlist/i.test(bodyText),
  hasGemini: /Gemini/i.test(bodyText),
  hasPerplexity: /Perplexity/i.test(bodyText),
  has9AM: /\b9AM\b/.test(bodyText),
  hasAudience: /Audience/i.test(bodyText),
  hasUsersAndPinned: /\bUsers\b/.test(bodyText) && /\bPinned\b/.test(bodyText),
  hasFetchSaveAll: /Fetch & save all/i.test(bodyText),
  has9PM: /9 PM ET alert/i.test(bodyText),
  hasExtreme: /Extreme/i.test(bodyText),
  hasSettings: /\bSettings\b/.test(bodyText),
}
console.log(JSON.stringify(checks, null, 2))
console.log('---snippet---')
console.log(bodyText.slice(0, 1500))
await browser.close()
