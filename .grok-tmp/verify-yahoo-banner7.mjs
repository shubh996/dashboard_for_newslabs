import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })

async function unlock() {
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (await page.locator('#site-passcode').count()) {
    await page.locator('#site-passcode').fill('6565')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await page.waitForTimeout(1000)
  }
  await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
  await page.waitForTimeout(2500)
}

// 1) Baseline: closed market banner on equity/futures Sunday
await unlock()
await page.evaluate(() => window.scrollTo(0, 800))
await page.waitForTimeout(500)
let body = await page.locator('body').innerText()
console.log('BASE', {
  rolling: /Rolling returns/i.test(body),
  closed: /Market closed|Pre-market|After-hours/i.test(body),
  line: (body.match(/(Market closed|Pre-market|After-hours|Yahoo Finance)[^\n]*/)?.[0] || '').slice(0, 180),
})
await page.screenshot({ path: '.grok-tmp/banner-baseline-scroll.png' })

// Click BTC-USD (24/7) then block subsequent quote fetches via page.evaluate monkeypatch? 
// Better: route only after load
await page.route('**/api/yahoo/**/quote', (route) =>
  route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) }),
)
const btc = page.getByText('BTC-USD', { exact: true })
if (await btc.count()) {
  await btc.first().click({ force: true })
} else {
  // try left list
  await page.getByText('BTC', { exact: false }).first().click({ force: true }).catch(()=>{})
}
await page.waitForTimeout(4000)
await page.evaluate(() => window.scrollTo(0, 900))
await page.waitForTimeout(500)
body = await page.locator('body').innerText()
console.log('BTC_BLOCKED', {
  rolling: /Rolling returns/i.test(body),
  yahoo: /Yahoo Finance/i.test(body),
  line: (body.match(/Yahoo Finance[^\n]*/)?.[0] || body.match(/(Market closed|Pre-market|After-hours)[^\n]*/)?.[0] || 'NONE').slice(0, 220),
})
await page.screenshot({ path: '.grok-tmp/banner-btc-yahoo-down.png' })
await browser.close()
const ok = /Yahoo Finance (quote request failed|refresh failed|returned no quote|data is not coming)/i.test(body)
process.exit(ok ? 0 : 1)
