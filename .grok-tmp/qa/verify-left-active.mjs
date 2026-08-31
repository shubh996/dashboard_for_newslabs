import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.goto('http://localhost:5173/notifications', { waitUntil: 'domcontentloaded' })
const input = await page.$('#site-passcode')
if (input) {
  await input.type('6565')
  for (const b of await page.$$('button')) {
    const t = await page.evaluate((el) => el.textContent || '', b)
    if (/Unlock/i.test(t)) { await b.click(); break }
  }
  await page.waitForFunction(() => !document.querySelector('#site-passcode')).catch(() => {})
}
await new Promise((r) => setTimeout(r, 1500))
await page.evaluate(() => {
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    const btns = [...d.querySelectorAll('button')]
    const b = btns.find((x) => /dismiss all|close/i.test(x.textContent || ''))
    ;(b || btns[btns.length - 1])?.click()
  }
})
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 0, { timeout: 30000 }).catch(() => {})
// Prefer a Live row if any; else first row
const clicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('table tbody tr')]
  const live = rows.find((r) => /Live/i.test(r.innerText || ''))
  const row = live || rows[0]
  if (!row) return null
  row.click()
  return (row.innerText || '').replace(/\s+/g, ' ').slice(0, 100)
})
console.log('clicked:', clicked)
await new Promise((r) => setTimeout(r, 4000))
const probe = await page.evaluate(() => {
  const asides = [...document.querySelectorAll('aside')]
  let asideText = ''
  for (const a of asides) {
    const t = a.innerText || ''
    if (/Current move|How this episode built/i.test(t)) { asideText = t; break }
  }
  // scroll and collect more
  for (const a of asides) {
    if (/How this episode built/i.test(a.innerText || '')) {
      const scroller = a.querySelector('[data-radix-scroll-area-viewport]') || a
      scroller.scrollTop = scroller.scrollHeight
      asideText = a.innerText || asideText
    }
  }
  return {
    hasGains: /Current move/i.test(asideText) && /Peak move/i.test(asideText),
    hasChart: /Interactive chart/i.test(asideText),
    hasAz: /How this episode built · A→Z/i.test(asideText),
    hasStepDetail: /Formula|Numbers|Alert sent|Likely driver|What happened|Started \+/i.test(asideText),
    hasTimelineHeader: /How this move built · .* steps · A→Z/i.test(asideText),
    snippetTail: asideText.slice(-800),
  }
})
console.log(JSON.stringify(probe, null, 2))
await page.screenshot({ path: '.grok-tmp/qa/episode-az-left-or-list.png' })
console.log(probe.hasGains && probe.hasChart && probe.hasAz ? 'VERIFY_OK' : 'VERIFY_FAIL')
await browser.close()
process.exit(probe.hasGains && probe.hasChart && probe.hasAz ? 0 : 2)
