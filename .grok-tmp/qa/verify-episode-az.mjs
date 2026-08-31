import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5173'
const OUT = '.grok-tmp/qa'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
page.setDefaultTimeout(60000)

async function unlockIfNeeded() {
  const input = await page.$('#site-passcode')
  if (!input) return
  await input.type('6565')
  for (const b of await page.$$('button')) {
    const t = await page.evaluate((el) => el.textContent || '', b)
    if (/Unlock/i.test(t)) {
      await b.click()
      break
    }
  }
  await page
    .waitForFunction(() => !document.querySelector('#site-passcode'), {
      timeout: 15000,
    })
    .catch(() => {})
}

async function dismissDialogs() {
  for (let i = 0; i < 4; i++) {
    const closed = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      if (!dialogs.length) return false
      for (const d of dialogs) {
        const btns = [...d.querySelectorAll('button')]
        const prefer = btns.find((b) =>
          /dismiss all|close|got it|ok/i.test(b.textContent || ''),
        )
        ;(prefer || btns[btns.length - 1])?.click()
      }
      return true
    })
    if (!closed) break
    await new Promise((r) => setTimeout(r, 400))
  }
}

try {
  await page.goto(`${BASE}/notifications`, { waitUntil: 'domcontentloaded' })
  await unlockIfNeeded()
  await new Promise((r) => setTimeout(r, 1500))
  await dismissDialogs()
  await new Promise((r) => setTimeout(r, 1000))
  await dismissDialogs()

  // Wait for All episodes table or click Refresh
  const loaded = await page
    .waitForFunction(
      () => {
        const rows = document.querySelectorAll('table tbody tr')
        if (rows.length > 0) return true
        const body = document.body.innerText || ''
        return /No episodes yet/i.test(body)
      },
      { timeout: 25000 },
    )
    .then(() => true)
    .catch(() => false)

  if (!loaded) {
    // Click Refresh
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const refresh = btns.find((b) => /Refresh/i.test(b.textContent || ''))
      refresh?.click()
    })
    await page
      .waitForFunction(
        () => document.querySelectorAll('table tbody tr').length > 0,
        { timeout: 30000 },
      )
      .catch(() => {})
  }

  await dismissDialogs()
  await page.screenshot({ path: `${OUT}/episode-az-list.png` })

  const rowCount = await page.evaluate(
    () => document.querySelectorAll('table tbody tr').length,
  )
  console.log('rowCount:', rowCount)

  const clicked = await page.evaluate(() => {
    const row = document.querySelector('table tbody tr')
    if (!row) return null
    const ticker = (row.querySelector('td')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return ticker
  })
  console.log('clickedRow:', clicked)

  await new Promise((r) => setTimeout(r, 4500))
  await dismissDialogs()
  await page.screenshot({ path: `${OUT}/episode-az-after-click.png` })

  const probe = await page.evaluate(() => {
    const asides = [...document.querySelectorAll('aside')]
    // Prefer the right-most wide aside (not the left rail)
    let aside = asides[asides.length - 1]
    for (const a of asides) {
      const t = a.innerText || ''
      if (/Interactive chart|Current move|How this episode built/i.test(t)) {
        aside = a
        break
      }
    }
    const asideText = aside?.innerText || ''
    const text = document.body.innerText || ''
    return {
      hasFocusBanner: /Focused ·/i.test(text),
      hasEpisodeHeader: /Episode ·/i.test(asideText),
      hasCurrentMove: /Current move/i.test(asideText),
      hasPeakMove: /Peak move/i.test(asideText),
      hasChart: /Interactive chart/i.test(asideText),
      hasAz: /How this episode built|A→Z|How this move built/i.test(
        asideText,
      ),
      hasInlineDetail:
        /Formula|Numbers|Likely driver|Full reason|Alert sent|Delivery/i.test(
          asideText,
        ),
      hasHideHow: /Hide how this move built/i.test(asideText),
      selectStill: /Select an episode/i.test(asideText),
      asideSnippet: asideText.slice(0, 1400),
      bodyHasShowAll: /Show all episodes/i.test(text),
    }
  })
  console.log(JSON.stringify(probe, null, 2))

  await page.evaluate(() => {
    const asides = [...document.querySelectorAll('aside')]
    let aside = asides[asides.length - 1]
    for (const a of asides) {
      if (/How this episode built|Interactive chart/i.test(a.innerText || '')) {
        aside = a
        break
      }
    }
    const scroller =
      aside?.querySelector('[data-radix-scroll-area-viewport]') || aside
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await new Promise((r) => setTimeout(r, 600))
  await page.screenshot({ path: `${OUT}/episode-az-scrolled.png` })

  const ok =
    Boolean(clicked) &&
    probe.hasCurrentMove &&
    probe.hasPeakMove &&
    probe.hasChart &&
    probe.hasAz &&
    !probe.selectStill
  console.log(ok ? 'VERIFY_OK' : 'VERIFY_FAIL')
  process.exit(ok ? 0 : 2)
} catch (err) {
  console.error('VERIFY_ERROR', err)
  await page.screenshot({ path: `${OUT}/episode-az-error.png` }).catch(() => {})
  process.exit(1)
} finally {
  await browser.close()
}
