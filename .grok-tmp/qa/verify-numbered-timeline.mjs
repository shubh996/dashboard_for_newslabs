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

await page.evaluate(() => {
  document
    .querySelector('table tbody tr')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 4000))

// Scroll right rail to timeline
await page.evaluate(() => {
  const asides = [...document.querySelectorAll('aside')]
  for (const a of asides) {
    if (/Timeline · A→Z|How this episode built/i.test(a.innerText || '')) {
      const scroller =
        a.querySelector('[data-radix-scroll-area-viewport]') || a
      scroller.scrollTop = scroller.scrollHeight
    }
  }
})
await new Promise((r) => setTimeout(r, 600))
await page.screenshot({ path: '.grok-tmp/qa/numbered-timeline.png' })

const probe = await page.evaluate(() => {
  const text = document.body.innerText || ''
  const hasNumbered = /1 Started|1\s+Started/i.test(text)
  const hasTimelineHeader = /Timeline · A→Z/i.test(text)
  const hasFormula = /FORMULA|Formula/i.test(text)
  const hasNumbers = /NUMBERS|Numbers/i.test(text)
  const hasPill = /Started|Holding|Weakening|Accelerating|push|research/i.test(text)
  // numbered circles in DOM
  const circles = [...document.querySelectorAll('ol li span')].filter((el) =>
    /^\d+$/.test((el.textContent || '').trim()),
  ).length
  return {
    hasNumbered,
    hasTimelineHeader,
    hasFormula,
    hasNumbers,
    hasPill,
    circles,
    allEpisodesStill: /All episodes/i.test(text),
    snippet: text.includes('Timeline · A→Z')
      ? text.slice(text.indexOf('Timeline · A→Z'), text.indexOf('Timeline · A→Z') + 500)
      : text.slice(-400),
  }
})
console.log(JSON.stringify(probe, null, 2))
const ok =
  probe.hasTimelineHeader &&
  probe.hasFormula &&
  probe.hasNumbers &&
  probe.circles >= 1 &&
  probe.allEpisodesStill
console.log(ok ? 'VERIFY_OK' : 'VERIFY_FAIL')
await browser.close()
process.exit(ok ? 0 : 2)
