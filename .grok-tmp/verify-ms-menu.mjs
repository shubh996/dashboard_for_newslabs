import puppeteer from 'puppeteer-core'
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
await page.goto('http://localhost:5173/notifications', { waitUntil: 'networkidle2', timeout: 60000 })
const pass = await page.$('#site-passcode')
if (pass) {
  await pass.type('6565')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('#site-passcode'), { timeout: 10000 })
}
await page.waitForSelector('button[aria-label*="Market sessions"]', { timeout: 45000 })
const trigger = await page.$('button[aria-label*="Market sessions"]')
const box = await trigger.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForSelector('[data-market-sessions-panel]', { timeout: 10000 })
await new Promise((r) => setTimeout(r, 800))
// click first card
const card = await page.$('[data-market-sessions-panel] button[title*="choose Yahoo"]')
if (!card) throw new Error('card missing')
await card.click()
await new Promise((r) => setTimeout(r, 400))
const items = await page.$$eval('[role="menuitem"]', (els) =>
  els.map((e) => e.textContent?.replace(/\s+/g, ' ').trim()),
)
console.log('menuItems', items)
const ok =
  items.some((t) => /Yahoo Finance/i.test(t || '')) &&
  items.some((t) => /Download JSON/i.test(t || ''))
console.log(ok ? 'PASS' : 'FAIL')
await browser.close()
process.exit(ok ? 0 : 1)
