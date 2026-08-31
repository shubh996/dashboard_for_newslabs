import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.goto('http://localhost:5173/notifications?v=' + Date.now(), {
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
    .find((t) => /^Users$/i.test((t.textContent || '').trim()))
    ?.click()
})

await page.waitForFunction(() => {
  const aside = document.querySelectorAll('aside')[0]
  const btns = [...(aside?.querySelectorAll('button') || [])].filter((b) => {
    const x = b.textContent || ''
    return !/Active episodes|^Users$|Refresh/i.test(x) && x.length > 10
  })
  return btns.length > 0
}, { timeout: 15000 })

await page.evaluate(() => {
  const aside = document.querySelectorAll('aside')[0]
  const btn = [...aside.querySelectorAll('button')].find((b) => {
    const x = b.textContent || ''
    return !/Active episodes|^Users$|Refresh/i.test(x) && x.length > 10
  })
  btn?.click()
})
await new Promise((r) => setTimeout(r, 3000))
await page.screenshot({ path: '.grok-tmp/qa/users-final.png' })

const probe = await page.evaluate(() => {
  const text = document.body.innerText || ''
  return {
    hasTabs: /Active episodes/i.test(text) && /\bUsers\b/.test(text),
    hasActivity: /Activity/i.test(text),
    hasWatching: /Watching [A-Z]/i.test(text),
    hasLifecycle: /Device registered|Last seen|Push token/i.test(text),
    hasPlatformField: /platform/i.test(text) && /ios/i.test(text),
    hasDeviceId: /device_id/i.test(text),
    hasProfileTitle: /Profile ·|iOS · build · photo/i.test(text),
    hasSelectGone: !/Select a user/i.test(text),
  }
})
console.log(JSON.stringify(probe, null, 2))
const ok = Object.values(probe).every(Boolean)
console.log(ok ? 'VERIFY_OK' : 'VERIFY_FAIL')

// Switch back
await page.evaluate(() => {
  [...document.querySelectorAll('[role="tab"]')]
    .find((t) => /Active episodes/i.test(t.textContent || ''))
    ?.click()
})
await new Promise((r) => setTimeout(r, 1000))
const back = await page.evaluate(() => /All episodes/i.test(document.body.innerText))
console.log('backToEpisodes', back)
await page.screenshot({ path: '.grok-tmp/qa/users-final-back.png' })

process.exit(ok && back ? 0 : 2)
await browser.close()
