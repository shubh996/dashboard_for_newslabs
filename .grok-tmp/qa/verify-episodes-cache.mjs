import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
})
const page = await browser.newPage()

async function unlock() {
  const input = await page.$('#site-passcode')
  if (!input) return
  await input.type('6565')
  for (const b of await page.$$('button')) {
    const t = await page.evaluate((el) => el.textContent || '', b)
    if (/Unlock/i.test(t)) { await b.click(); break }
  }
  await page.waitForFunction(() => !document.querySelector('#site-passcode')).catch(() => {})
}

async function dismiss() {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('[role="dialog"]')) {
      const btns = [...d.querySelectorAll('button')]
      const b = btns.find((x) => /dismiss all|close/i.test(x.textContent || ''))
      ;(b || btns[btns.length - 1])?.click()
    }
  })
}

await page.goto('http://localhost:5173/notifications?cache1=' + Date.now(), {
  waitUntil: 'domcontentloaded',
})
await unlock()
await new Promise((r) => setTimeout(r, 1200))
await dismiss()

// Ensure Active episodes desk
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  tabs.find((t) => /Active episodes/i.test(t.textContent || ''))?.click()
})

await page.waitForFunction(
  () => document.querySelectorAll('table tbody tr').length > 5,
  { timeout: 25000 },
).catch(() => {})

const first = await page.evaluate(() => {
  const raw = localStorage.getItem('sndk-momentum-all-episodes-v1')
  let cache = null
  try { cache = raw ? JSON.parse(raw) : null } catch {}
  return {
    rows: document.querySelectorAll('table tbody tr').length,
    hasCachedLabel: /cached \d{4}-\d{2}-\d{2} ET/i.test(document.body.innerText),
    cacheDate: cache?.dateKey || null,
    cacheCount: cache?.episodes?.length || 0,
  }
})
console.log('first', first)

// Reload — should paint from cache quickly
await page.reload({ waitUntil: 'domcontentloaded' })
await unlock()
await new Promise((r) => setTimeout(r, 800))
await dismiss()

const second = await page.evaluate(() => {
  const raw = localStorage.getItem('sndk-momentum-all-episodes-v1')
  let cache = null
  try { cache = raw ? JSON.parse(raw) : null } catch {}
  return {
    rowsSoon: document.querySelectorAll('table tbody tr').length,
    hasCachedLabel: /cached \d{4}-\d{2}-\d{2} ET/i.test(document.body.innerText || ''),
    cacheDate: cache?.dateKey || null,
    cacheCount: cache?.episodes?.length || 0,
    loadingVisible: /Loading episodes/i.test(document.body.innerText || ''),
  }
})
console.log('second', second)

await page.screenshot({ path: '.grok-tmp/qa/episodes-cache.png' })
const ok =
  first.cacheCount > 0 &&
  second.cacheCount > 0 &&
  second.rowsSoon > 0 &&
  !second.loadingVisible &&
  second.hasCachedLabel
console.log(ok ? 'VERIFY_OK' : 'VERIFY_FAIL')
await browser.close()
process.exit(ok ? 0 : 2)
