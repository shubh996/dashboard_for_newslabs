import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto('http://localhost:5173/trigger', { waitUntil: 'domcontentloaded', timeout: 60000 })
const pass = page.locator('#site-passcode')
if (await pass.count()) {
  await pass.fill('6565')
  await pass.press('Enter')
  await page.waitForTimeout(2000)
}
for (let i = 0; i < 30; i++) {
  const t = await page.locator('body').innerText()
  if (/Positive\s*[1-9]/i.test(t)) break
  await page.waitForTimeout(1000)
}
const bodyText = await page.locator('body').innerText()
const checks = {
  hasPositive: /Positive/i.test(bodyText),
  hasNegative: /Negative/i.test(bodyText),
  positiveCount: (bodyText.match(/Positive\s*(\d+)/)||[])[1] || '0',
  negativeCount: (bodyText.match(/Negative\s*(\d+)/)||[])[1] || '0',
  has9AM: /\b9AM\b/.test(bodyText),
  hasAudience: /Audience/i.test(bodyText),
  hasUsersTab: /Users\s*$/m.test(bodyText) || /Stocks list mode/i.test(bodyText),
  hasPinnedTab: /\bPinned\b/.test(bodyText),
  hasFetchSaveAll: /Fetch & save all/i.test(bodyText),
  has9PM: /9 PM ET/i.test(bodyText),
  hasSettings: /\bSettings\b/.test(bodyText),
  hasShareHint: /click a row to Share/i.test(bodyText),
  hasGemini: /Gemini/i.test(bodyText),
  hasPerplexity: /Perplexity/i.test(bodyText),
}
console.log('CHECKS', JSON.stringify(checks, null, 2))
// Click first extreme
const tabs = page.locator('aside.desk-watchlist button[role="tab"]')
const count = await tabs.count()
console.log('extreme rows:', count)
if (count > 0) {
  console.log('clicking', await tabs.first().getAttribute('title'))
  await tabs.first().click()
  await page.waitForTimeout(5000)
  console.log('dialogs after click:', await page.locator('[role="dialog"]').count())
  const t2 = await page.locator('body').innerText()
  console.log('after click snippet:', t2.slice(0, 1800))
}
await page.screenshot({ path: '.grok-tmp/trigger-final.png', fullPage: false })
console.log('screenshot ok')
await browser.close()
