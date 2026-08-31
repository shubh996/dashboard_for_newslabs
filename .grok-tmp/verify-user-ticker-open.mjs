import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(25000)

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
if (await page.locator('#site-passcode').count()) {
  await page.locator('#site-passcode').fill('6565')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1800)
}

// Ensure home (active episodes) so Users icon is available
await page.locator('aside').first().getByRole('button', { name: 'Users' }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: '.grok-tmp/user-ticker-01-users.png' })

// Click first user button in the users list (middle/left content)
const list = page.locator('button').filter({ has: page.locator('img, svg') })
// Prefer DeskUserListButton style entries — look for "Enabled tickers" after click
const candidates = page.locator('[class*="rounded"]').filter({ hasText: /\d+\s*ticker|enabled|iPhone|Android/i })
const userButtons = page.locator('button').filter({ hasText: /./ })
// From EpisodeDashboard users list: DeskUserListButton
const deskUserBtns = page.locator('button').filter({ has: page.locator('.size-8, .size-9, img') })
let clickedUser = false
const count = await page.getByRole('button').count()
for (let i = 0; i < Math.min(count, 80); i++) {
  const btn = page.getByRole('button').nth(i)
  const label = ((await btn.getAttribute('aria-label')) || (await btn.innerText().catch(() => '')) || '').trim()
  if (!label) continue
  if (/Users|Settings|Stocks|Crypto|Episodes|Bulletins|Refresh|Clear|Add/i.test(label)) continue
  // device list buttons often have model names
  const box = await btn.boundingBox()
  if (!box || box.width < 80) continue
  if (box.x < 60) continue // skip icon rail
  await btn.click()
  await page.waitForTimeout(800)
  if (await page.getByText('Enabled tickers').count()) {
    clickedUser = true
    console.log('opened user via', label.slice(0, 80))
    break
  }
}
await page.screenshot({ path: '.grok-tmp/user-ticker-02-profile.png' })
if (!clickedUser) {
  console.log('FAILED_OPEN_USER')
  await browser.close()
  process.exit(1)
}

const tickerBtns = page.locator('button[title^="Open "]')
const n = await tickerBtns.count()
console.log('enabled ticker buttons', n)
if (!n) {
  console.log('NO_TICKERS_ON_USER')
  await browser.close()
  process.exit(0)
}
const title = await tickerBtns.first().getAttribute('title')
const symbol = String(title || '').replace(/^Open\s+/, '').replace(/\s+in desk$/, '')
await tickerBtns.first().click()
await page.waitForTimeout(1800)
await page.screenshot({ path: '.grok-tmp/user-ticker-03-opened.png' })

const stillEnabled = await page.getByText('Enabled tickers').count()
const assetActive = await page.locator('aside').first().locator('[aria-pressed="true"]').allTextContents()
console.log(JSON.stringify({
  symbol,
  stillEnabledSection: stillEnabled > 0,
  pressedAside: assetActive.map((t) => t.trim()).filter(Boolean).slice(0, 8),
  bodyHasSymbol: (await page.locator(`text=${symbol}`).count()) > 0,
}))
await browser.close()
