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
  await page.waitForTimeout(900)
}
await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
async function openPlatforms() {
  const buttons = page.locator('button[aria-label="Settings"]')
  for (let i = 0; i < await buttons.count(); i++) {
    if (await buttons.nth(i).isVisible()) {
      await buttons.nth(i).hover()
      await page.waitForTimeout(250)
      await buttons.nth(i).click()
      break
    }
  }
  await page.waitForTimeout(400)
  const platforms = page.getByText('Platforms', { exact: true })
  await platforms.first().waitFor({ state: 'visible', timeout: 10000 })
  await platforms.first().hover({ force: true })
  await page.waitForTimeout(500)
}

await openPlatforms()
await page.screenshot({ path: '.grok-tmp/platforms-icons.png' })
// Confirm brand-ish labels still there
for (const t of ['GitHub','Railway','Cloudflare','Supabase','Gemini','Grok / xAI']) {
  const ok = await page.getByText(t, { exact: true }).first().isVisible().catch(()=>false)
  console.log('label', t, ok)
}
await page.getByText('Supabase', { exact: true }).first().hover({ force: true })
await page.waitForTimeout(600)
const need = ['SQL Editor', 'Table Editor', 'Database', 'Details']
const miss = []
for (const t of need) {
  if (!(await page.getByText(t, { exact: true }).first().isVisible().catch(()=>false))) miss.push(t)
}
await page.screenshot({ path: '.grok-tmp/platforms-supabase-sub.png' })
await page.getByText('Details', { exact: true }).first().hover({ force: true })
await page.waitForTimeout(600)
const urlVisible = await page.getByText(/bsammfevuefowmpvsnju\.supabase\.co/).first().isVisible().catch(()=>false)
await page.screenshot({ path: '.grok-tmp/platforms-supabase-details.png' })
// Escape and open again for SQL
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await openPlatforms()
await page.getByText('Supabase', { exact: true }).first().hover({ force: true })
await page.waitForTimeout(500)
await page.getByText('SQL Editor', { exact: true }).first().click()
await page.waitForTimeout(300)
const urls = await page.evaluate(() => window.__opened || [])
console.log(JSON.stringify({ miss, urlVisible, urls }, null, 2))
await browser.close()
process.exit(miss.length===0 && urlVisible && urls.some(u=>u.includes('/sql')) ? 0 : 1)
