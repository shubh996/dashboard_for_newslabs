import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  locale: 'en-GB',
  timezoneId: 'Europe/London',
})
page.setDefaultTimeout(20000)

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
await page.waitForTimeout(1500)

const trigger = page.getByRole('button', {
  name: /Market sessions/i,
})
await trigger.hover()
await page.waitForSelector('[data-market-sessions-panel]', { timeout: 15000 })
// Wait for cards to populate
await page.waitForFunction(
  () =>
    document.querySelectorAll('[data-market-sessions-panel] a[href*="yahoo"]').length >=
    8,
  { timeout: 20000 },
)
await page.waitForTimeout(800)

const info = await page.evaluate(() => {
  const panel = document.querySelector('[data-market-sessions-panel]')
  if (!panel) return { error: 'no panel' }
  const cards = Array.from(panel.querySelectorAll('a[href*="yahoo"]'))
  const rows = cards.map((a) => {
    const flag = a.querySelector('span[aria-hidden]')
    const flagPx = flag ? parseFloat(getComputedStyle(flag).fontSize) : 0
    const label =
      a.querySelector('p.truncate.text-\\[13px\\], p.font-semibold')?.textContent?.trim() ||
      a.querySelector('p')?.textContent?.trim() ||
      ''
    const body = (a.textContent || '').replace(/\s+/g, ' ')
    const stamp =
      body.match(
        /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^·]*?\b(?:EDT|EST|BST|GMT|IST|JST|CEST|CET|HKT|SGT|KST|CST|AEDT|AEST|BRT|SAST|GST|UTC)\b/i,
      )?.[0] ||
      body.match(
        /\d{1,2}:\d{2}\s*[AP]M\s+(?:EDT|EST|BST|GMT|IST|JST|CEST|CET|HKT|SGT|KST|CST|AEDT|AEST|BRT|SAST|GST|UTC)/i,
      )?.[0] ||
      null
    const you = /\bYou\b/i.test(body) || /You/i.test(label)
    return {
      label: label.slice(0, 40),
      flagPx: Math.round(flagPx),
      stamp,
      you,
      idGuess: /UK Stocks/i.test(body)
        ? 'uk'
        : /US Stocks/i.test(body)
          ? 'us'
          : /India NSE/i.test(body)
            ? 'india'
            : /Japan/i.test(body)
              ? 'japan'
              : /Germany/i.test(body)
                ? 'germany'
                : null,
    }
  })

  const uk = rows.find((r) => r.idGuess === 'uk')
  const us = rows.find((r) => r.idGuess === 'us')
  const india = rows.find((r) => r.idGuess === 'india')
  const japan = rows.find((r) => r.idGuess === 'japan')
  const germany = rows.find((r) => r.idGuess === 'germany')

  return {
    cardCount: rows.length,
    uk,
    us,
    india,
    japan,
    germany,
    stamps: rows.map((r) => r.stamp).filter(Boolean).slice(0, 12),
    allStampsAreBst: rows
      .map((r) => r.stamp)
      .filter(Boolean)
      .every((s) => /\bBST\b|\bGMT\b/.test(s) && !/\bEDT|EST|IST|JST|CEST/.test(s)),
  }
})

console.log(JSON.stringify(info, null, 2))
await page.screenshot({
  path: '.grok-tmp/market-sessions-local-tz.png',
  fullPage: false,
})

await browser.close()

const ok =
  info.cardCount >= 8 &&
  info.uk?.you === true &&
  info.uk?.flagPx >= 60 &&
  info.us?.flagPx < info.uk.flagPx &&
  info.us?.stamp &&
  /EDT|EST/i.test(info.us.stamp) &&
  info.uk?.stamp &&
  /BST|GMT/i.test(info.uk.stamp) &&
  info.allStampsAreBst === false

console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
