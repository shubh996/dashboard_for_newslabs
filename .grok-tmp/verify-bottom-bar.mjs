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

await page.waitForSelector('[aria-label="Asset class"]', { timeout: 45000 })
// wait for market status prefetch
await page.waitForFunction(async () => {
  const r = await fetch('/api/momentum/market-status', { cache: 'no-store' })
  const j = await r.json()
  return Array.isArray(j.markets) && j.markets.length > 5
}, { timeout: 30000 })

const afterHoursInCenter = await page.evaluate(() => {
  const center = document.querySelector('[aria-label="Asset class"]')?.parentElement
  const text = center?.innerText || ''
  return /After hours|Pre-market|Overnight|Regular hours/i.test(text)
})
console.log('afterHoursPillGone', !afterHoursInCenter)

const bottomH = await page.evaluate(() => {
  const bar = document.querySelector('[aria-label="Asset class"]')?.closest('.grid')
  return bar ? Math.round(bar.getBoundingClientRect().height) : 0
})
console.log('bottomBarHeight', bottomH)

const trigger = await page.$('button[aria-label*="Market sessions"]')
const box = await trigger.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForSelector('[data-market-sessions-panel]', { timeout: 10000 })
await new Promise((r) => setTimeout(r, 800))

const geom = await page.$eval('[data-market-sessions-panel]', (el) => {
  const r = el.getBoundingClientRect()
  return {
    widthPct: Math.round((r.width / window.innerWidth) * 100),
    rightAligned: Math.abs(r.right - window.innerWidth) < 2,
    top: Math.round(r.top),
    height: Math.round(r.height),
  }
})
console.log('panelGeom', geom)

const cards = await page.$$eval('[data-market-sessions-panel] a[href*="finance.yahoo.com/quote/"]', (els) =>
  els.slice(0, 6).map((a) => ({
    href: a.getAttribute('href'),
    flag: a.querySelector('span[aria-hidden]')?.textContent?.trim(),
    label: a.querySelector('p')?.textContent?.trim(),
  })),
)
console.log('cards', cards)

const ok =
  !afterHoursInCenter &&
  bottomH >= 44 &&
  geom.widthPct >= 38 &&
  geom.widthPct <= 42 &&
  geom.rightAligned &&
  cards.length > 0 &&
  cards.every((c) => c.href && c.flag)

console.log(ok ? 'PASS' : 'FAIL')
await browser.close()
process.exit(ok ? 0 : 1)
