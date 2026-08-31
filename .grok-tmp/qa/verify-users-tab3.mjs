import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-sandbox', '--disable-cache'],
})
const page = await browser.newPage()
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || /desk|device|Users|loadDesk/i.test(m.text())) {
    logs.push(`[${m.type()}] ${m.text()}`)
  }
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5173/notifications?cb=' + Date.now(), {
  waitUntil: 'networkidle2',
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
await new Promise((r) => setTimeout(r, 1500))
await page.evaluate(() => {
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    const btns = [...d.querySelectorAll('button')]
    const b = btns.find((x) => /dismiss all|close/i.test(x.textContent || ''))
    ;(b || btns[btns.length - 1])?.click()
  }
})

// Click Users and wait for device buttons / no loading
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  tabs.find((t) => /^Users$/i.test((t.textContent || '').trim()))?.click()
})

const appeared = await page
  .waitForFunction(
    () => {
      const aside = document.querySelectorAll('aside')[0]
      if (!aside) return false
      const t = aside.innerText || ''
      if (/No users yet|device error|Failed/i.test(t)) return 'empty'
      // device rows: buttons beyond tab+refresh
      const btns = [...aside.querySelectorAll('button')].filter((b) => {
        const x = b.textContent || ''
        return !/Active episodes|^Users$|Refresh/i.test(x) && x.length > 10
      })
      return btns.length > 0 ? 'ok' : false
    },
    { timeout: 15000 },
  )
  .then((h) => h.jsonValue())
  .catch(() => 'timeout')

console.log('appeared:', appeared)
await page.screenshot({ path: '.grok-tmp/qa/users-tab3.png' })
const left = await page.evaluate(
  () => document.querySelectorAll('aside')[0]?.innerText?.slice(0, 700) || '',
)
console.log('left:', left)
console.log('logs:', logs.slice(0, 20).join('\n'))

if (appeared === 'ok') {
  await page.evaluate(() => {
    const aside = document.querySelectorAll('aside')[0]
    const btn = [...aside.querySelectorAll('button')].find((b) => {
      const x = b.textContent || ''
      return !/Active episodes|^Users$|Refresh/i.test(x) && x.length > 10
    })
    btn?.click()
  })
  await new Promise((r) => setTimeout(r, 2500))
  await page.screenshot({ path: '.grok-tmp/qa/users-tab3-selected.png' })
  const probe = await page.evaluate(() => {
    const text = document.body.innerText || ''
    const asides = [...document.querySelectorAll('aside')]
    const right = asides[asides.length - 1]?.innerText || ''
    return {
      activity: /Activity/i.test(text),
      watching: /Watching /i.test(text),
      profile: /platform|build_number|device_id|Profile ·/i.test(right),
      rightHead: right.slice(0, 400),
    }
  })
  console.log('probe', probe)
  console.log(
    probe.activity && probe.watching && probe.profile
      ? 'VERIFY_OK'
      : 'VERIFY_FAIL',
  )
  process.exit(probe.activity && probe.watching && probe.profile ? 0 : 2)
}
process.exit(2)
