import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => console.log('PAGEERROR', e.message))
page.on('console', m => { if (m.type()==='error') console.log('CONSERR', m.text()) })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 })
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(1200)
}
await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
const buttons = page.locator('button[aria-label="Settings"]')
for (let i=0;i<await buttons.count();i++){
  if (await buttons.nth(i).isVisible()){ await buttons.nth(i).click(); break }
}
await page.waitForTimeout(600)
const menus = await page.locator('[role="menu"]').allTextContents()
console.log('MENUS', JSON.stringify(menus, null, 2))
await page.screenshot({ path: '.grok-tmp/settings-dump.png' })
await browser.close()
