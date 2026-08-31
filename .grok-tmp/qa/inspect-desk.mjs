import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.goto('http://localhost:5173/notifications', { waitUntil: 'networkidle2' })
const input = await page.$('#site-passcode')
if (input) {
  await input.type('6565')
  for (const b of await page.$$('button')) {
    const t = await page.evaluate((el) => el.textContent || '', b)
    if (/Unlock/i.test(t)) { await b.click(); break }
  }
  await page.waitForFunction(() => !document.querySelector('#site-passcode')).catch(() => {})
}
await new Promise((r) => setTimeout(r, 4000))
await page.screenshot({ path: '.grok-tmp/qa/inspect-desk.png' })
const info = await page.evaluate(() => {
  const tables = [...document.querySelectorAll('table')].map((t) => ({
    rows: t.querySelectorAll('tbody tr').length,
    head: (t.querySelector('thead')?.innerText || '').slice(0, 120),
    firstRow: (t.querySelector('tbody tr')?.innerText || '').slice(0, 120),
  }))
  const allTextHas = /All episodes/i.test(document.body.innerText)
  // find elements mentioning All episodes
  const allEp = [...document.querySelectorAll('*')].filter((el) => {
    const kids = el.children?.length || 0
    return kids < 8 && /^All episodes/i.test((el.textContent || '').trim().slice(0, 20))
  }).slice(0, 5).map((el) => ({
    tag: el.tagName,
    text: (el.textContent || '').slice(0, 80),
    parent: el.parentElement?.className?.toString?.()?.slice(0, 80),
  }))
  // find clickable rows with tickers
  const trs = [...document.querySelectorAll('tr')].slice(0, 8).map((tr) => ({
    text: (tr.innerText || '').replace(/\s+/g, ' ').slice(0, 100),
    cursor: getComputedStyle(tr).cursor,
  }))
  return {
    allTextHas,
    tables,
    allEp,
    trs,
    bodySlice: document.body.innerText.slice(0, 1500),
  }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()
