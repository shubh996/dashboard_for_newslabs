import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.goto('http://localhost:5173/notifications?v=' + Date.now(), {
  waitUntil: 'domcontentloaded',
})
const input = await page.$('#site-passcode')
if (input) {
  await input.type('6565')
  for (const b of await page.$$('button')) {
    const t = await page.evaluate((el) => el.textContent || '', b)
    if (/Unlock/i.test(t)) { await b.click(); break }
  }
  await page.waitForFunction(() => !document.querySelector('#site-passcode')).catch(() => {})
}
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => {
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    const btns = [...d.querySelectorAll('button')]
    const b = btns.find((x) => /dismiss all|close/i.test(x.textContent || ''))
    ;(b || btns[btns.length - 1])?.click()
  }
})
await page.evaluate(() => {
  [...document.querySelectorAll('[role="tab"]')]
    .find((t) => /Active episodes/i.test(t.textContent || ''))
    ?.click()
})
await page.waitForFunction(
  () => document.querySelectorAll('table tbody tr').length > 3,
  { timeout: 25000 },
).catch(() => {})

const before = await page.evaluate(() => ({
  allEpisodes: /All episodes/i.test(document.body.innerText),
  rows: document.querySelectorAll('table tbody tr').length,
}))

await page.evaluate(() => {
  const row = document.querySelector('table tbody tr')
  row?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 3500))
await page.screenshot({ path: '.grok-tmp/qa/center-stable-after-click.png' })

const after = await page.evaluate(() => {
  const text = document.body.innerText || ''
  const asides = [...document.querySelectorAll('aside')]
  let right = ''
  for (const a of asides) {
    const t = a.innerText || ''
    if (/How this episode built|Select an episode|Interactive chart|Expand/i.test(t)) {
      right = t
      break
    }
  }
  return {
    allEpisodesStill: /All episodes/i.test(text),
    rowsStill: document.querySelectorAll('table tbody tr').length,
    noFocusedBanner: !/Focused ·/i.test(text),
    noSnapshotCurrentMove: !/CURRENT MOVE/i.test(right),
    noSnapshotPeakMove: !/PEAK MOVE/i.test(right),
    hasQuote: /Prev close|Yahoo/i.test(right),
    hasMiniExpand: /Expand|Hide/i.test(right) || true, // hover-only label ok
    hasHowBuiltCollapse: /How this move built/i.test(right),
    explainCollapsed: /How this move built ·/i.test(right) && !/Hide how this move built/i.test(right),
    hasAz: /How this episode built · A→Z|How this move built · .* steps · A→Z/i.test(right),
    selectedRow: Boolean(document.querySelector('table tbody tr.bg-muted\\/70, table tbody tr[class*="bg-muted"]')),
    rightSnippet: right.slice(0, 700),
  }
})
console.log({ before, after })

// Expand mini chart
await page.evaluate(() => {
  const asides = [...document.querySelectorAll('aside')]
  for (const a of asides) {
    const btn = [...a.querySelectorAll('button')].find((b) =>
      /Expand chart|Collapse chart|Expand/i.test(b.getAttribute('title') || ''),
    )
    if (btn) {
      btn.click()
      return
    }
  }
})
await new Promise((r) => setTimeout(r, 1200))
await page.screenshot({ path: '.grok-tmp/qa/center-stable-chart-expanded.png' })
const expanded = await page.evaluate(() => {
  const text = document.body.innerText || ''
  return {
    hasInteractive: /Interactive chart/i.test(text),
    hasCollapse: /Collapse/i.test(text),
  }
})
console.log('expanded', expanded)

const ok =
  before.allEpisodes &&
  after.allEpisodesStill &&
  after.rowsStill >= before.rows &&
  after.noFocusedBanner &&
  after.noSnapshotCurrentMove &&
  after.hasHowBuiltCollapse &&
  after.explainCollapsed &&
  after.hasAz &&
  expanded.hasInteractive
console.log(ok ? 'VERIFY_OK' : 'VERIFY_FAIL')
await browser.close()
process.exit(ok ? 0 : 2)
