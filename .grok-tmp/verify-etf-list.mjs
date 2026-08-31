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

await page.waitForSelector('[aria-label="Asset class"]', { timeout: 45000 })
const tabLabels = await page.$$eval('[aria-label="Asset class"] button', (els) =>
  els.map((b) => b.getAttribute('aria-label')),
)
console.log('bottomTabs', tabLabels)

const hasEtf = tabLabels.includes('ETFs')
const etfBtn = await page.$('[aria-label="Asset class"] button[aria-label="ETFs"]')
const stocksBtn = await page.$('[aria-label="Asset class"] button[aria-label="Stocks"]')

await stocksBtn.click()
await new Promise((r) => setTimeout(r, 1200))

const marketList = await page.$('[aria-label="Market list"]')
console.log('marketListTabBarGone', !marketList)

const header = await page.evaluate(() => {
  const aside = document.querySelector('aside')
  const title = aside?.querySelector('p.text-sm')?.textContent?.trim()
  const sub = aside?.querySelector('p.text-\\[11px\\], p[class*="text-[11px]"]')?.textContent?.trim()
  return { title, sub }
})
console.log('stocksHeader', header)

// Timeline tags check: open an episode from center if possible
const firstRow = await page.$('[data-episode-nav-key]')
let timelineTags = null
if (firstRow) {
  await firstRow.click()
  await new Promise((r) => setTimeout(r, 1500))
  timelineTags = await page.evaluate(() => {
    const pills = Array.from(document.querySelectorAll('span.rounded-full'))
      .map((el) => el.textContent?.trim().toLowerCase())
      .filter(Boolean)
    const interesting = pills.filter((t) =>
      /started|holding|ended|research|push|live|error|accelerat|weaken/.test(t || ''),
    )
    return [...new Set(interesting)].slice(0, 30)
  })
}
console.log('timelineTagSample', timelineTags)

const backendOnlyGone =
  !timelineTags ||
  (!timelineTags.some((t) => t === 'started' || t === 'holding' || t === 'ended') &&
    timelineTags.every((t) => /research|push|live|error|perplexity/.test(t) || t.length > 20))

// softer: no started/holding/ended tags
const noStateTags = !timelineTags || !timelineTags.some((t) =>
  ['started', 'holding', 'ended', 'accelerating', 'weakening', 're-accelerating'].includes(t),
)

await etfBtn.click()
await new Promise((r) => setTimeout(r, 800))
const etfHeader = await page.evaluate(() => {
  const aside = document.querySelector('aside')
  return aside?.querySelector('p.text-sm')?.textContent?.trim()
})
console.log('etfHeader', etfHeader)

const ok = hasEtf && !marketList && etfHeader === 'ETFs' && noStateTags
console.log(ok ? 'PASS' : 'FAIL', { hasEtf, marketListGone: !marketList, etfHeader, noStateTags })
await browser.close()
process.exit(ok ? 0 : 1)
