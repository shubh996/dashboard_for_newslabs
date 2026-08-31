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
await new Promise((r) => setTimeout(r, 1000))
const result = await page.evaluate(async () => {
  try {
    const res = await fetch('/api/notifications/devices?app=trigger&_=' + Date.now())
    const body = await res.json()
    return { status: res.status, ok: body.ok, count: body.count, err: body.error, keys: body.devices?.[0] && Object.keys(body.devices[0]).slice(0,8) }
  } catch (e) {
    return { error: String(e) }
  }
})
console.log(result)
await browser.close()
