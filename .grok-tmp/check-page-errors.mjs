import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
page.on('pageerror', e => console.log('PAGEERROR', e.message))
page.on('console', m => { if (m.type()==='error') console.log('CONSERR', m.text().slice(0,300)) })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{})
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(1500)
}
await page.waitForTimeout(4000)
const html = await page.content()
console.log('hasRollingHTML', html.includes('Rolling returns'))
console.log('hasBannerKind', html.includes('rollingReturnsBanner') || html.includes('Yahoo'))
console.log('bodyLen', (await page.locator('body').innerText()).length)
console.log('sample', (await page.locator('body').innerText()).slice(0, 500))
await browser.close()
