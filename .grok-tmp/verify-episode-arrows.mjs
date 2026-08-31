import puppeteer from 'puppeteer-core'

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
})

const page = await browser.newPage()
page.setDefaultTimeout(30000)
await page.goto('http://localhost:5173/notifications', { waitUntil: 'networkidle2', timeout: 60000 })

const passInput = await page.$('#site-passcode')
if (passInput) {
  await passInput.click({ clickCount: 3 })
  await passInput.type('6565')
  const submit = await page.$('button[type="submit"]')
  if (submit) await submit.click()
  else await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('#site-passcode'), { timeout: 10000 })
}

await page.waitForFunction(
  () => document.querySelectorAll('[data-episode-nav-key]').length > 2,
  { timeout: 45000 },
)

const selectedKey = () =>
  page.$$eval('[data-episode-nav-key]', (els) => {
    const sel = els.find((el) =>
      el.classList.contains('bg-muted/70') ||
      /\bbg-muted\/70\b/.test(el.className),
    )
    return sel ? sel.getAttribute('data-episode-nav-key') : null
  })

const allKeys = () =>
  page.$$eval('[data-episode-nav-key]', (els) =>
    els.slice(0, 5).map((el) => el.getAttribute('data-episode-nav-key')),
  )

const keys = await allKeys()
console.log('firstKeys', keys)

// Click first row explicitly by key
await page.click(`[data-episode-nav-key="${keys[0]}"]`)
await new Promise((r) => setTimeout(r, 500))
let k0 = await selectedKey()
console.log('afterClick', k0)

// Blur any inputs so global key handler runs
await page.evaluate(() => {
  const a = document.activeElement
  if (a && a instanceof HTMLElement) a.blur()
  document.body.focus()
})

await page.keyboard.press('ArrowDown')
await new Promise((r) => setTimeout(r, 500))
let k1 = await selectedKey()
console.log('afterDown1', k1)

await page.keyboard.press('ArrowDown')
await new Promise((r) => setTimeout(r, 500))
let k2 = await selectedKey()
console.log('afterDown2', k2)

await page.keyboard.press('ArrowUp')
await new Promise((r) => setTimeout(r, 500))
let k3 = await selectedKey()
console.log('afterUp', k3)

const ok = k0 === keys[0] && k1 === keys[1] && k2 === keys[2] && k3 === keys[1]
console.log(ok ? 'PASS' : 'FAIL')

// Right rail detail should mention ticker of selected
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2500))
const tickerFromKey = (k) => (k || '').replace(/^id:/, '').split('-')[0]
console.log('expectTickers', [k0, k1, k2, k3].map(tickerFromKey))
console.log('hasLastTicker', bodyText.includes(tickerFromKey(k3)))

await browser.close()
process.exit(ok ? 0 : 1)
