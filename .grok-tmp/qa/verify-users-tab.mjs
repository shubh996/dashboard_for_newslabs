import puppeteer from 'puppeteer-core'

const OUT = '.grok-tmp/qa'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
page.setDefaultTimeout(60000)

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
  for (let i = 0; i < 4; i++) {
    const closed = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      if (!dialogs.length) return false
      for (const d of dialogs) {
        const btns = [...d.querySelectorAll('button')]
        const prefer = btns.find((b) => /dismiss all|close|got it|ok/i.test(b.textContent || ''))
        ;(prefer || btns[btns.length - 1])?.click()
      }
      return true
    })
    if (!closed) break
    await new Promise((r) => setTimeout(r, 350))
  }
}

try {
  await page.goto('http://localhost:5173/notifications', { waitUntil: 'domcontentloaded' })
  await unlock()
  await new Promise((r) => setTimeout(r, 1500))
  await dismiss()

  // Click Users tab
  const clickedUsers = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')]
    const users = tabs.find((t) => /^Users$/i.test((t.textContent || '').trim()))
    if (!users) return false
    users.click()
    return true
  })
  console.log('clickedUsersTab:', clickedUsers)
  await new Promise((r) => setTimeout(r, 2500))
  await dismiss()
  await page.screenshot({ path: `${OUT}/users-tab-list.png` })

  const listProbe = await page.evaluate(() => {
    const text = document.body.innerText || ''
    return {
      hasUsersHeader: /\bUsers\b/.test(text),
      hasSelectUser: /Select a user/i.test(text),
      hasDeviceButtons: [...document.querySelectorAll('button')].some((b) =>
        /iOS|Android|tickers|build/i.test(b.textContent || ''),
      ),
      leftSnippet: ([...document.querySelectorAll('aside')][0]?.innerText || '').slice(0, 500),
    }
  })
  console.log('listProbe', JSON.stringify(listProbe, null, 2))

  // Click first user in left rail
  const clickedUser = await page.evaluate(() => {
    const aside = document.querySelectorAll('aside')[0]
    if (!aside) return null
    const buttons = [...aside.querySelectorAll('button')].filter((b) => {
      const t = b.textContent || ''
      return t.length > 8 && /iOS|Android|tickers|on|partial/i.test(t) && !/Active episodes|Users|Refresh/i.test(t)
    })
    if (!buttons[0]) return null
    const label = (buttons[0].textContent || '').replace(/\s+/g, ' ').slice(0, 80)
    buttons[0].click()
    return label
  })
  console.log('clickedUser:', clickedUser)
  await new Promise((r) => setTimeout(r, 3000))
  await dismiss()
  await page.screenshot({ path: `${OUT}/users-tab-selected.png` })

  const selected = await page.evaluate(() => {
    const text = document.body.innerText || ''
    const asides = [...document.querySelectorAll('aside')]
    const right = asides[asides.length - 1]?.innerText || ''
    const centerHasActivity = /Activity/i.test(text) && (/Watching |Device registered|Push token|Last seen|Alert|falls|rises/i.test(text))
    return {
      hasActivityHeader: /Activity/i.test(text),
      hasWatchingOrLifecycle: /Watching |Device registered|Last seen|Push token/i.test(text),
      hasProfile: /Profile ·|platform|build_number|os_version|device_id|iOS · build/i.test(right + text),
      hasAvatarOrPhoto: /iOS|AND|Profile/i.test(right),
      rightSnippet: right.slice(0, 900),
      centerHasActivity,
    }
  })
  console.log('selected', JSON.stringify(selected, null, 2))

  // Switch back to Active episodes
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')]
    const ep = tabs.find((t) => /Active episodes/i.test(t.textContent || ''))
    ep?.click()
  })
  await new Promise((r) => setTimeout(r, 1500))
  await page.screenshot({ path: `${OUT}/users-tab-back-episodes.png` })

  const back = await page.evaluate(() => /All episodes/i.test(document.body.innerText || ''))
  console.log('backToEpisodes:', back)

  const ok =
    clickedUsers &&
    clickedUser &&
    selected.hasActivityHeader &&
    selected.hasWatchingOrLifecycle &&
    selected.hasProfile &&
    back
  console.log(ok ? 'VERIFY_OK' : 'VERIFY_FAIL')
  process.exit(ok ? 0 : 2)
} catch (err) {
  console.error('VERIFY_ERROR', err)
  await page.screenshot({ path: `${OUT}/users-tab-error.png` }).catch(() => {})
  process.exit(1)
} finally {
  await browser.close()
}
