import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = __dirname
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

const opened = []
page.on('popup', async (p) => {
  opened.push(p.url())
  await p.close().catch(() => {})
})

// Intercept window.open
await page.addInitScript(() => {
  window.__openedUrls = []
  const orig = window.open.bind(window)
  window.open = (url, ...rest) => {
    window.__openedUrls.push(String(url))
    return orig('about:blank', ...rest)
  }
})

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })

// Unlock if needed
const pass = page.locator('#site-passcode')
if (await pass.count()) {
  await pass.fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(800)
}

await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
await page.screenshot({ path: path.join(outDir, 'platforms-1-desk.png'), fullPage: false })

// Open left-rail settings (hover or click)
const settingsBtn = page.locator('button[aria-label="Settings"]').first()
await settingsBtn.hover()
await page.waitForTimeout(400)
// Ensure menu open
if (!(await page.getByText('Perplexity prompts').isVisible().catch(() => false))) {
  await settingsBtn.click()
  await page.waitForTimeout(400)
}

await page.screenshot({ path: path.join(outDir, 'platforms-2-settings.png'), fullPage: false })

const platformsTrigger = page.getByRole('menuitem', { name: /Platforms/i }).first()
  .or(page.locator('[data-slot="dropdown-menu-sub-trigger"]').filter({ hasText: 'Platforms' }).first())
  .or(page.getByText('Platforms', { exact: true }).first())

// Try multiple ways to find Platforms
let found = false
const candidates = [
  page.getByText('Platforms', { exact: true }),
  page.locator('div,button,span').filter({ hasText: /^Platforms$/ }),
]
for (const c of candidates) {
  if (await c.count()) {
    await c.first().hover({ force: true })
    found = true
    break
  }
}
if (!found) {
  // dump menu text
  const body = await page.locator('[role="menu"]').allTextContents().catch(() => [])
  console.log('MENUS:', JSON.stringify(body))
  await page.screenshot({ path: path.join(outDir, 'platforms-FAIL-no-trigger.png') })
  throw new Error('Platforms trigger not found')
}

await page.waitForTimeout(500)
await page.screenshot({ path: path.join(outDir, 'platforms-3-submenu.png'), fullPage: false })

const expected = [
  'GitHub',
  'Railway',
  'Cloudflare',
  'Supabase',
  'Perplexity',
  'Gemini',
  'Grok / xAI',
  'Firecrawl',
  'Expo',
]

const missing = []
for (const label of expected) {
  const vis = await page.getByText(label, { exact: true }).first().isVisible().catch(() => false)
  if (!vis) missing.push(label)
}

console.log('MISSING:', missing.length ? missing.join(', ') : 'none')

// Click GitHub and check open
const gh = page.getByText('GitHub', { exact: true }).first()
await gh.click()
await page.waitForTimeout(300)
const urls = await page.evaluate(() => window.__openedUrls || [])
console.log('OPENED:', urls)

const okGithub = urls.some((u) => u.includes('github.com/shubh996/dashboard_for_newslabs'))
console.log('GITHUB_OK:', okGithub)

// Re-open settings for Railway
await settingsBtn.hover()
await page.waitForTimeout(300)
if (!(await page.getByText('Platforms', { exact: true }).first().isVisible().catch(() => false))) {
  await settingsBtn.click()
  await page.waitForTimeout(300)
}
await page.getByText('Platforms', { exact: true }).first().hover({ force: true })
await page.waitForTimeout(400)
await page.getByText('Railway', { exact: true }).first().click()
await page.waitForTimeout(200)
const urls2 = await page.evaluate(() => window.__openedUrls || [])
console.log('OPENED2:', urls2)
const okRailway = urls2.some((u) => u.includes('railway.app'))
console.log('RAILWAY_OK:', okRailway)

await page.screenshot({ path: path.join(outDir, 'platforms-4-after-click.png') })

const result = {
  missing,
  urls: urls2,
  okGithub,
  okRailway,
  pass: missing.length === 0 && okGithub && okRailway,
}
console.log('RESULT:', JSON.stringify(result, null, 2))
await browser.close()
process.exit(result.pass ? 0 : 1)
