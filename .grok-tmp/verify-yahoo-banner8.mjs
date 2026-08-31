import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
page.on('pageerror', e => console.log('PAGEERROR', e.message))

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(1000)
}
await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
await page.waitForTimeout(2000)

// Leave All episodes — click a watchlist tab if present, else open ticker via search/list
const tabBtn = page.locator('button, [role="tab"]').filter({ hasText: /^(SI=F|SNDK|TSLA|BTC-USD|AAPL)$/ })
console.log('tab candidates', await tabBtn.count())
if (await tabBtn.count()) {
  await tabBtn.first().click()
} else {
  // click "All episodes" row then? Prefer enabled tickers list
  const enabled = page.getByText('Enabled tickers')
  if (await enabled.count()) await enabled.first().click().catch(()=>{})
  await page.getByText('SNDK', { exact: true }).first().click({ force: true }).catch(()=>{})
}
await page.waitForTimeout(3000)
let body = await page.locator('body').innerText()
console.log('AFTER_TAB', {
  rolling: /Rolling returns/i.test(body),
  closed: /Market closed|Pre-market|After-hours/i.test(body),
  line: (body.match(/(Market closed|Pre-market|After-hours|Yahoo Finance)[^\n]*/)?.[0] || '').slice(0, 200),
})
await page.screenshot({ path: '.grok-tmp/banner-after-tab.png' })

// Now block quote and switch to BTC
await page.route('**/api/yahoo/**/quote', (route) =>
  route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) }),
)
const btcTab = page.locator('button, [role="tab"]').filter({ hasText: /^BTC-USD$/ })
if (await btcTab.count()) await btcTab.first().click()
else await page.getByText('BTC-USD', { exact: true }).first().click({ force: true }).catch(()=>{})
await page.waitForTimeout(4000)
body = await page.locator('body').innerText()
console.log('BTC', {
  rolling: /Rolling returns/i.test(body),
  yahoo: /Yahoo Finance (quote|refresh|returned|data)/i.test(body),
  line: (body.match(/Yahoo Finance[^\n]*/)?.[0] || body.match(/(Market closed|Pre-market|After-hours)[^\n]*/)?.[0] || 'NONE').slice(0, 240),
  badgeYahoo: await page.getByText('Yahoo', { exact: true }).count(),
})
await page.screenshot({ path: '.grok-tmp/banner-btc-final.png' })
await browser.close()
process.exit(/Yahoo Finance (quote request failed|refresh failed|returned no quote|data is not coming)/i.test(body) ? 0 : 1)
