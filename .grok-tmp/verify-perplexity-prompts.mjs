import { chromium } from 'playwright'
import fs from 'node:fs'

const outDir = '.grok-tmp'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(1500)

const pass = page.locator('#site-passcode')
if (await pass.count()) {
  await pass.fill('6565')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
}

await page.screenshot({ path: `${outDir}/prompts-01-home.png`, fullPage: false })

// Left-rail settings uses hover-open; keep pointer inside menu
const settingsBtn = page.locator('aside').first().getByRole('button', { name: 'Settings' })
await settingsBtn.scrollIntoViewIfNeeded()
const box = await settingsBtn.boundingBox()
if (!box) throw new Error('Settings button not found')
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(500)

// Menu should appear to the right of the button
const promptsItem = page.getByText('Perplexity prompts', { exact: true })
await promptsItem.waitFor({ state: 'visible', timeout: 8000 })
await page.screenshot({ path: `${outDir}/prompts-02-settings-menu.png`, fullPage: false })

const itemBox = await promptsItem.boundingBox()
if (!itemBox) throw new Error('Perplexity prompts item box missing')
await page.mouse.move(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2)
await page.waitForTimeout(150)
await page.mouse.click(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2)
await page.waitForTimeout(1200)

await page.getByRole('heading', { name: 'Perplexity prompts' }).waitFor({ timeout: 10000 })
await page.screenshot({ path: `${outDir}/prompts-03-dialog.png`, fullPage: false })

const equity = page.getByRole('button', { name: /Momentum research · Equity/i })
await equity.click()
await page.waitForTimeout(250)

const textarea = page.locator('textarea').first()
const original = await textarea.inputValue()
if (!original.includes('Likely driver')) {
  throw new Error('Expected default equity prompt with Likely driver')
}
const marker = `\n\n# VERIFY_MARKER_${Date.now()}`
await textarea.fill(original + marker)
await page.waitForTimeout(200)

await page.getByRole('button', { name: /Save all/i }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${outDir}/prompts-04-after-save.png`, fullPage: false })

const statusEl = page.locator('text=/Saved|Supabase failed|unsaved/i').first()
const saveStatus = (await statusEl.textContent().catch(() => '')) || ''
const bodyAfter = await textarea.inputValue()

await page.getByRole('button', { name: /Reset to default/i }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: /Save all/i }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: `${outDir}/prompts-05-reset.png`, fullPage: false })

await page.getByRole('button', { name: /Market open \/ close bulletin/i }).click()
await page.waitForTimeout(300)
const bulletinBody = await page.locator('textarea').first().inputValue()
await page.screenshot({ path: `${outDir}/prompts-06-bulletin.png`, fullPage: false })

// Mobile viewport smoke
await page.setViewportSize({ width: 390, height: 844 })
await page.screenshot({ path: `${outDir}/prompts-07-mobile.png`, fullPage: false })

const result = {
  dialogOpened: true,
  originalLen: original.length,
  bodyHadMarker: bodyAfter.includes('VERIFY_MARKER'),
  saveStatus,
  bulletinHasPlaceholder: bulletinBody.includes('{{SHORT_LABEL}}'),
  errors,
  screenshots: fs.readdirSync(outDir).filter((f) => f.startsWith('prompts-')),
}
console.log(JSON.stringify(result, null, 2))
await browser.close()
if (!result.bodyHadMarker) process.exitCode = 1
if (errors.length) process.exitCode = 1
