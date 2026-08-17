/**
 * Dashboard Test Mode + always-notify tester device.
 *
 * Test mode ON  → every Expo push goes only to the tester device;
 *                 Perplexity is always dummy (no API spend).
 * Test mode OFF → real subscribers receive pushes, and the tester device
 *                 is always included whether or not they subscribe.
 *
 * Persist: data/momentum-test-mode.json (survives restarts).
 * Env MOMENTUM_TEST_MODE=1 forces on at boot (file still wins after UI toggle).
 */
import fs from 'node:fs'
import path from 'node:path'

const STORE_PATH = path.resolve(process.cwd(), 'data/momentum-test-mode.json')

/** Hard-coded tester — always receives pushes in prod; sole recipient in test mode. */
export const ALWAYS_NOTIFY_DEVICE = Object.freeze({
  device_id: 'ios-d003c3d5-2c11-4766-866e-8bf8e511929c',
  expo_push_token: 'ExponentPushToken[FmqQg-OgjuWt8hLmcQDJCF]',
  permission: 'granted',
  enabled: true,
})

/** @type {boolean} */
let testModeEnabled = false

function envWantsTestModeOn() {
  const v = String(process.env.MOMENTUM_TEST_MODE || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      // First boot: env can seed, otherwise default OFF (real subscribers)
      testModeEnabled = envWantsTestModeOn()
      return
    }
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
    if (raw && typeof raw === 'object' && 'enabled' in raw) {
      testModeEnabled = Boolean(raw.enabled)
      return
    }
  } catch (err) {
    console.warn(
      '[testMode] load failed:',
      err instanceof Error ? err.message : err,
    )
  }
  testModeEnabled = envWantsTestModeOn()
}

function persistToDisk() {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
    fs.writeFileSync(
      STORE_PATH,
      `${JSON.stringify(
        {
          enabled: testModeEnabled,
          updatedAt: new Date().toISOString(),
          alwaysNotify: {
            device_id: ALWAYS_NOTIFY_DEVICE.device_id,
            expo_push_token: ALWAYS_NOTIFY_DEVICE.expo_push_token,
          },
        },
        null,
        2,
      )}\n`,
    )
  } catch (err) {
    console.warn(
      '[testMode] persist failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

loadFromDisk()

export function isTestModeEnabled() {
  return testModeEnabled
}

/**
 * @param {boolean} enabled
 * @returns {{ enabled: boolean, alwaysNotify: object }}
 */
export function setTestModeEnabled(enabled) {
  testModeEnabled = Boolean(enabled)
  persistToDisk()
  console.log(
    `[testMode] ${testModeEnabled ? 'ON' : 'OFF'} · tester ${ALWAYS_NOTIFY_DEVICE.device_id}`,
  )
  return getTestModeSnapshot()
}

export function getAlwaysNotifyRecipient(appKey = 'trigger') {
  return {
    device_id: ALWAYS_NOTIFY_DEVICE.device_id,
    expo_push_token: ALWAYS_NOTIFY_DEVICE.expo_push_token,
    enabled: true,
    app_key: String(appKey || 'trigger').toLowerCase() === 'nineam' ? 'nineam' : 'trigger',
    always: true,
    forced: isTestModeEnabled(),
  }
}

/**
 * Snapshot for API / UI (menu hover, settings rail).
 */
export function getTestModeSnapshot() {
  const always = {
    device_id: ALWAYS_NOTIFY_DEVICE.device_id,
    expo_push_token: ALWAYS_NOTIFY_DEVICE.expo_push_token,
    permission: ALWAYS_NOTIFY_DEVICE.permission,
    enabled: ALWAYS_NOTIFY_DEVICE.enabled,
  }
  return {
    enabled: testModeEnabled,
    /** True only when Test Mode is ON (or explicit MOMENTUM_DUMMY_RESEARCH=1 handled in config) */
    dummyResearch: testModeEnabled,
    alwaysNotify: always,
    /** Who receives pushes in the current mode (for UI detail) */
    recipients: testModeEnabled
      ? {
          mode: 'test',
          description: 'Only the tester device (all other devices blocked)',
          devices: [always],
          perplexity: 'dummy',
        }
      : {
          mode: 'live',
          description:
            'All enabled Trigger subscribers for the ticker, plus the always-notify tester',
          devices: [always],
          alwaysIncluded: always,
          perplexity: 'real',
        },
    /** Human summary for settings copy */
    summary: testModeEnabled
      ? 'Test mode ON — only the tester device gets pushes; Perplexity is dummy.'
      : 'Test mode OFF — subscribers get pushes; tester device always included; real Perplexity.',
  }
}

/**
 * Merge always-notify device into a recipient list (by Expo token).
 * @template {{ device_id?: string|null, expo_push_token?: string, to?: string }} T
 * @param {T[]} recipients
 * @param {string} [appKey]
 * @returns {T[]}
 */
export function ensureAlwaysNotifyRecipient(recipients, appKey = 'trigger') {
  const list = Array.isArray(recipients) ? [...recipients] : []
  const always = getAlwaysNotifyRecipient(appKey)
  const tok = always.expo_push_token
  const id = always.device_id
  const has = list.some((r) => {
    const t = String(r?.expo_push_token || r?.to || '').trim()
    const d = String(r?.device_id || '').trim()
    return (t && t === tok) || (d && d === id)
  })
  if (!has) list.push(/** @type {T} */ (always))
  return list
}

/**
 * Final recipient list for a push:
 *  - test ON  → only always device
 *  - test OFF → subscribers + always device
 * @param {Array<Record<string, unknown>>} subscribers
 * @param {string} [appKey]
 */
export function resolvePushRecipients(subscribers, appKey = 'trigger') {
  if (isTestModeEnabled()) {
    return [getAlwaysNotifyRecipient(appKey)]
  }
  return ensureAlwaysNotifyRecipient(subscribers || [], appKey)
}
