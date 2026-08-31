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

async function openSettings() {
  const buttons = page.locator('button[aria-label="Settings"]')
  for (let i = 0; i < await buttons.count(); i++) {
    if (await buttons.nth(i).isVisible()) {
      await buttons.nth(i).click()
      break
    }
  }
  await page.waitForTimeout(400)
}

await openSettings()
const platforms = page.getByRole('menuitem', { name: /Platforms/i })
console.log('platforms count', await platforms.count())
await platforms.first().hover({ force: true })
await page.waitForTimeout(600)
await page.screenshot({ path: '.grok-tmp/platforms-icons.png' })

const supabase = page.getByRole('menuitem', { name: /Supabase/i })
console.log('supabase count', await supabase.count())
await supabase.first().hover({ force: true })
await page.waitForTimeout(700)
await page.screenshot({ path: '.grok-tmp/platforms-supabase-sub.png' })

const need = ['SQL Editor', 'Table Editor', 'Database', 'Details']
const miss = []
for (const t of need) {
  const ok = await page.getByRole('menuitem', { name: new RegExp(t, 'i') }).first().isVisible().catch(() => false)
  if (!ok) miss.push(t)
}

const details = page.getByRole('menuitem', { name: /Details/i }).first()
await details.hover({ force: true })
await page.waitForTimeout(700)
const urlVisible = await page.locator('text=bsammfevuefowmpvsnju.supabase.co').first().isVisible().catch(() => false)
await page.screenshot({ path: '.grok-tmp/platforms-supabase-details.png' })

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await openSettings()
await page.getByRole('menuitem', { name: /Platforms/i }).first().hover({ force: true })
await page.waitForTimeout(500)
await page.getByRole('menuitem', { name: /Supabase/i }).first().hover({ force: true })
await page.waitForTimeout(600)
await page.getByRole('menuitem', { name: /SQL Editor/i }).first().click()
await page.waitForTimeout(300)
const urls = await page.evaluate(() => window.__opened || [])
console.log(JSON.stringify({ miss, urlVisible, urls }, null, 2))
await browser.close()
process.exit(miss.length === 0 && urlVisible && urls.some(u => u.includes('/sql')) ? 0 : 1)
