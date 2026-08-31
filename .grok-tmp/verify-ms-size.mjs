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
await new Promise((r) => setTimeout(r, 600))
const info = await page.$eval('[data-market-sessions-panel]', (el) => {
  const r = el.getBoundingClientRect()
  const flag = el.querySelector('a span[aria-hidden]')
  const fs = flag ? parseFloat(getComputedStyle(flag).fontSize) : 0
  return {
    widthPct: Math.round((r.width / window.innerWidth) * 100),
    flagPx: Math.round(fs),
  }
})
console.log(info)
const ok = info.widthPct >= 18 && info.widthPct <= 22 && info.flagPx >= 40
console.log(ok ? 'PASS' : 'FAIL')
await browser.close()
process.exit(ok ? 0 : 1)
