import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const hits = []
await page.route('**/*', async (route) => {
  const u = route.request().url()
  if (/yahoo/i.test(u) && route.request().resourceType() === 'fetch' || /\/api\/yahoo/i.test(u)) {
    hits.push(u)
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'yahoo down' }) })
  }
  return route.continue()
})
page.on('console', m => { if (/yahoo|Yahoo|feed/i.test(m.text())) console.log('CONS', m.text()) })
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(1200)
}
await page.waitForSelector('text=Rolling returns', { timeout: 45000 })
await page.waitForTimeout(5000)
console.log('HITS', hits.slice(0, 10))
const bodyText = await page.locator('body').innerText()
const hasYahooBanner = /Yahoo Finance/i.test(bodyText)
const hasClosed = /Market closed|Pre-market|After-hours/i.test(bodyText)
console.log({ hasYahooBanner, hasClosed, snippet: bodyText.match(/Yahoo[\s\S]{0,120}|Market closed[\s\S]{0,80}|Rolling returns[\s\S]{0,40}/)?.[0] })
await page.screenshot({ path: '.grok-tmp/yahoo-feed-banner2.png', fullPage: false })
await browser.close()
process.exit(hasYahooBanner ? 0 : 2)
