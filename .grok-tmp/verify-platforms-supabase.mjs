import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  window.__opened = []
  const o = window.open.bind(window)
  window.open = (url, ...r) => { window.__opened.push(String(url)); return o('about:blank', ...r) }
})
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(800)
}
await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
const btn = page.locator('button[aria-label="Settings"]').first()
await btn.click()
await page.waitForTimeout(400)
await page.getByText('Platforms', { exact: true }).first().hover({ force: true })
await page.waitForTimeout(450)
// icons present for github etc - check supabase nested
await page.getByText('Supabase', { exact: true }).first().hover({ force: true })
await page.waitForTimeout(500)
const need = ['SQL Editor', 'Table Editor', 'Database', 'Details']
const miss = []
for (const t of need) {
  if (!(await page.getByText(t, { exact: true }).first().isVisible().catch(()=>false))) miss.push(t)
}
await page.screenshot({ path: '.grok-tmp/platforms-supabase-sub.png' })
await page.getByText('SQL Editor', { exact: true }).first().click()
await page.waitForTimeout(250)
const urls1 = await page.evaluate(() => window.__opened || [])
// reopen for details
await btn.click()
await page.waitForTimeout(300)
await page.getByText('Platforms', { exact: true }).first().hover({ force: true })
await page.waitForTimeout(400)
await page.getByText('Supabase', { exact: true }).first().hover({ force: true })
await page.waitForTimeout(450)
await page.getByText('Details', { exact: true }).first().hover({ force: true })
await page.waitForTimeout(500)
const urlVisible = await page.getByText(/bsammfevuefowmpvsnju\.supabase\.co/).first().isVisible().catch(()=>false)
await page.screenshot({ path: '.grok-tmp/platforms-supabase-details.png' })
console.log(JSON.stringify({ miss, urls1, urlVisible }, null, 2))
await browser.close()
process.exit(miss.length === 0 && urls1.some(u=>u.includes('/sql')) && urlVisible ? 0 : 1)
