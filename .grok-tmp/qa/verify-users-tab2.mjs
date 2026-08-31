import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
const logs = []
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))
page.on('response', (res) => {
  const u = res.url()
  if (u.includes('/api/notifications/devices')) {
    logs.push(`[resp ${res.status()}] ${u}`)
  }
})

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
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => {
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    const btns = [...d.querySelectorAll('button')]
    const b = btns.find((x) => /dismiss all|close/i.test(x.textContent || ''))
    ;(b || btns[btns.length - 1])?.click()
  }
})

await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  tabs.find((t) => /^Users$/i.test((t.textContent || '').trim()))?.click()
})

await new Promise((r) => setTimeout(r, 6000))
await page.screenshot({ path: '.grok-tmp/qa/users-tab-debug.png' })

const state = await page.evaluate(() => {
  const aside = document.querySelectorAll('aside')[0]
  return {
    left: (aside?.innerText || '').slice(0, 800),
    buttonCount: aside ? aside.querySelectorAll('button').length : 0,
    bodyHasDevices: /ios-|ExponentPushToken|tickers/i.test(document.body.innerText),
  }
})
console.log(JSON.stringify(state, null, 2))
console.log('---logs---')
console.log(logs.filter((l) => /device|error|pageerror|Failed|TypeError/i.test(l)).slice(0, 40).join('\n'))
await browser.close()
