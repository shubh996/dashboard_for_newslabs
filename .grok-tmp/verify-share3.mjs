import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.setDefaultTimeout(15000)
await page.goto('http://localhost:5173/trigger', { waitUntil: 'domcontentloaded', timeout: 60000 })
const pass = page.locator('#site-passcode')
if (await pass.count()) {
  await pass.fill('6565')
  await pass.press('Enter')
  await page.waitForTimeout(1500)
}
for (let i = 0; i < 30; i++) {
  const t = await page.locator('body').innerText()
  if (/Positive\s*[1-9]/i.test(t)) break
  await page.waitForTimeout(1000)
}
const tabs = page.locator('aside.desk-watchlist button[role="tab"], aside button[role="tab"]')
const count = await tabs.count()
console.log('extreme row buttons:', count)
if (count > 0) {
  const title = await tabs.first().getAttribute('title')
  console.log('first row:', title)
  await tabs.first().click()
  // share flow may scrape first — wait up to ~60s for dialog
  for (let i = 0; i < 40; i++) {
    const dialogs = await page.locator('[role="dialog"]').count()
    const t = await page.locator('body').innerText()
    if (dialogs > 0 || /share/i.test(t) && (/composer|tweet|social|so far|research/i.test(t))) {
      console.log('dialog/share UI appeared at', i, 's')
      break
    }
    if (i % 5 === 0) console.log('waiting for share/scrape...', i)
    await page.waitForTimeout(1000)
  }
}
const bodyText = await page.locator('body').innerText()
console.log('dialogs:', await page.locator('[role="dialog"]').count())
console.log('---text after click---')
console.log(bodyText.slice(0, 2500))
await page.screenshot({ path: '.grok-tmp/trigger-share-flow.png', fullPage: false })
await browser.close()
