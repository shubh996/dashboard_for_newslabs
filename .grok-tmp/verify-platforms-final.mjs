import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch({ headless: true })

async function run(viewport, tag) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    window.__openedUrls = []
    const orig = window.open.bind(window)
    window.open = (url, ...rest) => { window.__openedUrls.push(String(url)); return orig('about:blank', ...rest) }
  })
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (await page.locator('#site-passcode').count()) {
    await page.locator('#site-passcode').fill('6565')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await page.waitForTimeout(700)
  }
  await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
  const buttons = page.locator('button[aria-label="Settings"]')
  for (let i = 0; i < await buttons.count(); i++) {
    if (await buttons.nth(i).isVisible()) { await buttons.nth(i).click(); break }
  }
  await page.waitForTimeout(400)
  await page.getByText('Platforms', { exact: true }).first().hover({ force: true })
  await page.waitForTimeout(500)
  const need = ['GitHub','Railway','Cloudflare','Cloudflare Pages (live)','Supabase','Perplexity','Gemini','Grok / xAI','Firecrawl','Expo']
  const missing = need.filter(async () => false) // placeholder
  const miss = []
  for (const l of need) {
    if (!(await page.getByText(l, { exact: true }).first().isVisible().catch(() => false))) miss.push(l)
  }
  await page.getByText('Supabase', { exact: true }).first().click()
  await page.waitForTimeout(250)
  const urls = await page.evaluate(() => window.__openedUrls || [])
  await page.screenshot({ path: path.join(__dirname, `platforms-final-${tag}.png`) })
  console.log(JSON.stringify({ tag, miss, urls }, null, 2))
  await ctx.close()
  return miss.length === 0 && urls.some(u => u.includes('supabase.com'))
}

const d = await run({ width: 1440, height: 900 }, 'desktop')
const m = await run({ width: 390, height: 844 }, 'mobile')
await browser.close()
console.log('PASS', d && m)
process.exit(d && m ? 0 : 1)
