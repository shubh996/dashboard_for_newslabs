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

const passInput = await page.$('#site-passcode')
if (passInput) {
  await passInput.type('6565')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('#site-passcode'), { timeout: 10000 })
}

// Wait for timezone trigger
await page.waitForFunction(
  () => Array.from(document.querySelectorAll('button')).some((b) => (b.getAttribute('aria-label') || '').includes('Market sessions')),
  { timeout: 45000 },
)

const trigger = await page.$('button[aria-label*="Market sessions"]')
if (!trigger) throw new Error('trigger missing')

const box = await trigger.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await new Promise((r) => setTimeout(r, 800))

const open = await page.$('[aria-label="Market sessions"][role="dialog"]')
console.log('overlayOpen', Boolean(open))

const labels = open
  ? await open.$$eval('p.truncate, p', (els) =>
      els.map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 40),
    )
  : []
console.log('sampleLabels', labels.filter((t) => /US Stocks|India NSE|Japan|Dubai|Forex|Crypto|Hong Kong|Australia|Germany/.test(t || '')))

const yahooStates = open
  ? await open.$$eval('p', (els) =>
      els.map((e) => e.textContent?.trim()).filter((t) => t && t.startsWith('Yahoo ')).slice(0, 8),
    )
  : []
console.log('yahooStates', yahooStates)

const cardCount = open
  ? await open.$$eval('.grid > div', (els) => els.length)
  : 0
console.log('cards', cardCount)

// Leave trigger — should close
await page.mouse.move(10, 10)
await new Promise((r) => setTimeout(r, 200))
const still = await page.$('[aria-label="Market sessions"][role="dialog"]')
console.log('closedAfterLeave', !still)

const ok = Boolean(open) && cardCount >= 15 && !still
console.log(ok ? 'PASS' : 'FAIL')
await browser.close()
process.exit(ok ? 0 : 1)
