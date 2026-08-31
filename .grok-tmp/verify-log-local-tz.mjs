import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  locale: 'en-GB',
  timezoneId: 'Europe/London',
})
page.setDefaultTimeout(15000)

await page.goto('http://localhost:5173/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})

if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(1000)
}

await page.waitForSelector('button[aria-label="Settings"]', { timeout: 30000 })
await page.waitForTimeout(800)

await page.getByRole('button', { name: 'Crypto', exact: true }).click()
await page.waitForTimeout(800)
await page.locator('text=BTC-USD').first().click({ force: true })
await page.waitForTimeout(2500)

// Expand collapsed log rail.
const expand = page.getByRole('button', { name: 'Expand activity log' })
console.log('expand count', await expand.count())
if (await expand.count()) {
  await expand.click()
  await page.waitForTimeout(800)
}

// If rail opened on yahoo/subscribers/etc, flip to logs via header control if any.
// The Terminal/Logs collapsed control already opens logs; if open on another mode,
// look for a logs icon button near the rail header.
const modes = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('aside button, aside [title], aside [aria-label]'))
    .map((el) => ({
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      title: el.getAttribute('title'),
      aria: el.getAttribute('aria-label'),
    }))
    .filter((x) => x.text || x.title || x.aria)
    .slice(0, 40)
})
console.log('rail controls', JSON.stringify(modes, null, 2))

// Force logs mode by clicking any control that mentions log/terminal.
for (const label of ['Activity log', 'Back to activity log', 'Logs']) {
  const el = page.getByRole('button', { name: new RegExp(label, 'i') })
  if (await el.count()) {
    await el.first().click().catch(() => {})
    await page.waitForTimeout(400)
  }
}

await page.waitForTimeout(1000)
const dump = await page.evaluate(() => {
  const body = document.body.innerText
  const idx = body.search(/Activity log|Logs ·/i)
  const slice = idx >= 0 ? body.slice(idx, idx + 1000) : 'NO_ACTIVITY_SLICE'
  const withSeconds =
    body.match(/\d{1,2}:\d{2}:\d{2}\s*[AP]M\s+(?:BST|GMT|EDT|EST)/gi) || []
  return { slice, withSeconds: withSeconds.slice(0, 12), idx }
})
console.log(JSON.stringify(dump, null, 2))
await page.screenshot({ path: '.grok-tmp/log-local-uk-tz.png', fullPage: false })

const stamps = dump.withSeconds || []
const ukOk = stamps.length > 0 && stamps.every((t) => /BST|GMT/i.test(t))
const hasEt = stamps.some((t) => /EDT|EST/i.test(t))
console.log({ stampCount: stamps.length, ukOk, hasEt, sample: stamps })

if (stamps.length && ukOk && !hasEt) {
  const detail = page.locator('button').filter({ hasText: /Details/ }).first()
  if (await detail.count()) {
    await detail.click()
    await page.waitForTimeout(600)
    const dialog = await page.locator('[role="dialog"]').innerText()
    console.log({
      dialogHasUk: /BST|GMT/i.test(dialog),
      dialogHasEt: /EDT|EST/i.test(dialog),
      head: dialog.split('\n').slice(0, 5),
    })
    await page.screenshot({ path: '.grok-tmp/log-detail-local-uk-tz.png' })
  }
  await browser.close()
  process.exit(0)
}

await browser.close()
process.exit(1)
