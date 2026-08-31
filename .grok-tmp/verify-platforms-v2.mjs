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

async function openVisibleSettings(page) {
  const buttons = page.locator('button[aria-label="Settings"]')
  const n = await buttons.count()
  let used = -1
  for (let i = 0; i < n; i++) {
    if (await buttons.nth(i).isVisible()) {
      used = i
      await buttons.nth(i).click()
      break
    }
  }
  console.log('visible_settings_index:', used, 'of', n)
  if (used < 0) throw new Error('no visible settings')
  await page.waitForTimeout(350)
  return used
}

async function checkPlatforms(page, tag) {
  await openVisibleSettings(page)
  const platforms = page.getByText('Platforms', { exact: true })
  if (!(await platforms.count())) throw new Error(tag + ': Platforms missing')
  await platforms.first().hover({ force: true })
  await page.waitForTimeout(450)
  const labels = ['GitHub','Railway','Cloudflare','Cloudflare Pages (live)','Supabase','Perplexity','Gemini','Grok / xAI','Firecrawl','Expo']
  const missing = []
  for (const l of labels) {
    if (!(await page.getByText(l, { exact: true }).first().isVisible().catch(() => false))) missing.push(l)
  }
  console.log(tag + '_MISSING:', missing.length ? missing.join(', ') : 'none')
  await page.screenshot({ path: path.join(__dirname, `platforms-${tag}.png`) })
  return missing
}

// Desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    window.__openedUrls = []
    const orig = window.open.bind(window)
    window.open = (url, ...rest) => { window.__openedUrls.push(String(url)); return orig('about:blank', ...rest) }
  })
  await unlock(page)
  const missing = await checkPlatforms(page, 'desktop')
  await page.getByText('Cloudflare Pages (live)', { exact: true }).first().click()
  await page.waitForTimeout(200)
  const urls = await page.evaluate(() => window.__openedUrls || [])
  console.log('PAGES_OPEN:', urls)
  // reopen for supabase
  await openVisibleSettings(page)
  await page.getByText('Platforms', { exact: true }).first().hover({ force: true })
  await page.waitForTimeout(400)
  await page.getByText('Supabase', { exact: true }).first().click()
  await page.waitForTimeout(200)
  const urls2 = await page.evaluate(() => window.__openedUrls || [])
  console.log('SUPABASE_OPEN:', urls2)
  await ctx.close()
  if (missing.length) throw new Error('desktop missing')
}

// Mobile
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await unlock(page)
  const missing = await checkPlatforms(page, 'mobile')
  await ctx.close()
  if (missing.length) throw new Error('mobile missing')
}

await browser.close()
console.log('ALL_OK')
