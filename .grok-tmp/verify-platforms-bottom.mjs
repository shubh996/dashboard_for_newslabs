import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch({ headless: true })

async function unlock(page) {
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  const pass = page.locator('#site-passcode')
  if (await pass.count()) {
    await pass.fill('6565')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await page.waitForTimeout(800)
  }
  await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
}

async function openPlatformsFromNthSettings(page, index) {
  const buttons = page.locator('button[aria-label="Settings"]')
  const count = await buttons.count()
  console.log('settings_buttons:', count, 'using_index:', index)
  const btn = buttons.nth(index)
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
  await page.waitForTimeout(400)
  const platforms = page.getByText('Platforms', { exact: true })
  const pcount = await platforms.count()
  console.log('platforms_visible_count:', pcount)
  if (!pcount) throw new Error('Platforms missing in settings #' + index)
  await platforms.first().hover({ force: true })
  await page.waitForTimeout(450)
  const labels = ['GitHub','Railway','Cloudflare','Cloudflare Pages (live)','Supabase','Perplexity','Gemini','Grok / xAI','Firecrawl','Expo']
  const missing = []
  for (const l of labels) {
    const ok = await page.getByText(l, { exact: true }).first().isVisible().catch(() => false)
    if (!ok) missing.push(l)
  }
  return missing
}

// Desktop bottom settings (if 2 buttons)
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.__openedUrls = []
    const orig = window.open.bind(window)
    window.open = (url, ...rest) => { window.__openedUrls.push(String(url)); return orig('about:blank', ...rest) }
  })
  await unlock(page)
  const n = await page.locator('button[aria-label="Settings"]').count()
  const idx = n > 1 ? n - 1 : 0
  const missing = await openPlatformsFromNthSettings(page, idx)
  console.log('BOTTOM_MISSING:', missing.length ? missing.join(', ') : 'none')
  await page.getByText('Supabase', { exact: true }).first().click()
  await page.waitForTimeout(200)
  const urls = await page.evaluate(() => window.__openedUrls || [])
  console.log('SUPABASE_OPEN:', urls)
  await page.screenshot({ path: path.join(__dirname, 'platforms-bottom.png') })
  await context.close()
}

// Mobile left settings
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await unlock(page)
  const missing = await openPlatformsFromNthSettings(page, 0)
  console.log('MOBILE_MISSING:', missing.length ? missing.join(', ') : 'none')
  await page.screenshot({ path: path.join(__dirname, 'platforms-mobile.png') })
  await context.close()
}

await browser.close()
console.log('DONE')
