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
  await page.waitForTimeout(1000)
}
await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
await page.waitForTimeout(2500)
// network: supabase host should be new
const hits = []
page.on('request', (req) => {
  const u = req.url()
  if (u.includes('supabase.co')) hits.push(u.split('/')[2])
})
await page.reload({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForTimeout(2000)
const hosts = [...new Set(hits)]
console.log('SUPABASE_HOSTS', hosts)

const btn = page.locator('button[aria-label="Settings"]').first()
await btn.click()
await page.waitForTimeout(400)
await page.getByText('Platforms', { exact: true }).first().hover({ force: true })
await page.waitForTimeout(500)
await page.getByText('Supabase', { exact: true }).first().click()
await page.waitForTimeout(300)
const opened = await page.evaluate(() => window.__opened || [])
console.log('OPENED', opened)
await page.screenshot({ path: '/Users/shubh./Desktop/trigger_web/.grok-tmp/supabase-migrate-2026/verify-desk.png' })
const okHost = hosts.some(h => h.includes('bsammfevuefowmpvsnju'))
const okLink = opened.some(u => u.includes('bsammfevuefowmpvsnju'))
console.log('RESULT', { okHost, okLink, hosts, opened })
await browser.close()
process.exit(okHost && okLink ? 0 : 1)
