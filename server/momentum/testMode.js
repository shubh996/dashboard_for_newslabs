/**
 * Dashboard Test Mode + always-notify tester devices.
 *
 * Test mode ON  → Expo pushes go only to the selected allowlist
 *                 (picker in Momentum Studio settings); Perplexity dummy.
 * Test mode OFF → real subscribers receive pushes, and both always-notify
 *                 testers are always included whether or not they subscribe.
 *
 * Persist: data/momentum-test-mode.json (survives restarts on disk hosts).
 * Env MOMENTUM_TEST_MODE=1 forces on at boot (file still wins after UI toggle).
 */
import fs from 'node:fs'
import path from 'node:path'

const STORE_PATH = path.resolve(process.cwd(), 'data/momentum-test-mode.json')

/**
 * Hard-coded always-notify testers — always receive in prod;
 * pinned at top of the Test Mode recipient picker.
 * @type {ReadonlyArray<{
 *   id: string,
 *   label: string,
 *   device_id: string,
 *   expo_push_token: string,
 *   aliases: string[],
 *   permission: string,
 *   enabled: boolean,
 * }>}
 */
export const ALWAYS_NOTIFY_DEVICES = Object.freeze([
  Object.freeze({
    id: 'trigger-iphone16',
    label: 'Trigger app · iPhone 16',
    device_id: 'ios-0c793db2-c3a0-4ee7-b742-4270d81e20f7',
    expo_push_token: 'ExponentPushToken[FmqQg-OgjuWt8hLmcQDJCF]',
    /** Older device_id that shared this Expo token */
    aliases: ['ios-d003c3d5-2c11-4766-866e-8bf8e511929c'],
    permission: 'granted',
    enabled: true,
  }),
  Object.freeze({
    id: 'expo-app',
    label: 'Expo app',
    device_id: 'ios-1ddd5b0c-5ff8-401f-b0a6-ae9beaac8ea1',
    expo_push_token: 'ExponentPushToken[Q4Q4xqGpb9fyE9kpMPdUYZ]',
    aliases: [],
    permission: 'granted',
    enabled: true,
  }),
])

/** @deprecated use ALWAYS_NOTIFY_DEVICES[0] — kept for older imports */
export const ALWAYS_NOTIFY_DEVICE = ALWAYS_NOTIFY_DEVICES[0]

/** @type {boolean} */
let testModeEnabled = false

/** @type {string[]} */
let selectedDeviceIds = ALWAYS_NOTIFY_DEVICES.map((d) => d.device_id)

/** @type {string[]} */
let selectedTokens = ALWAYS_NOTIFY_DEVICES.map((d) => d.expo_push_token)

function envWantsTestModeOn() {
  const v = String(process.env.MOMENTUM_TEST_MODE || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

function defaultAllowlist() {
  return {
    selectedDeviceIds: ALWAYS_NOTIFY_DEVICES.map((d) => d.device_id),
    selectedTokens: ALWAYS_NOTIFY_DEVICES.map((d) => d.expo_push_token),
  }
}

function normalizeIdList(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const id = String(item || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function normalizeTokenList(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const tok = String(item || '').trim()
    if (!tok || seen.has(tok)) continue
    seen.add(tok)
    out.push(tok)
  }
  return out
}

/**
 * Apply selection; if both lists empty, fall back to both always-notify devices.
 * @param {string[]|undefined|null} deviceIds
 * @param {string[]|undefined|null} tokens
 */
function applyAllowlist(deviceIds, tokens) {
  const ids = normalizeIdList(deviceIds)
  const toks = normalizeTokenList(tokens)
  if (ids.length === 0 && toks.length === 0) {
    const d = defaultAllowlist()
    selectedDeviceIds = d.selectedDeviceIds
    selectedTokens = d.selectedTokens
    return
  }
  selectedDeviceIds = ids
  selectedTokens = toks
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      testModeEnabled = envWantsTestModeOn()
      const d = defaultAllowlist()
      selectedDeviceIds = d.selectedDeviceIds
      selectedTokens = d.selectedTokens
      return
    }
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
    if (raw && typeof raw === 'object') {
      if ('enabled' in raw) testModeEnabled = Boolean(raw.enabled)
      else testModeEnabled = envWantsTestModeOn()
      applyAllowlist(raw.selectedDeviceIds, raw.selectedTokens)
      return
    }
  } catch (err) {
    console.warn(
      '[testMode] load failed:',
      err instanceof Error ? err.message : err,
    )
  }
  testModeEnabled = envWantsTestModeOn()
  const d = defaultAllowlist()
  selectedDeviceIds = d.selectedDeviceIds
  selectedTokens = d.selectedTokens
}

function persistToDisk() {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
    fs.writeFileSync(
      STORE_PATH,
      `${JSON.stringify(
        {
          enabled: testModeEnabled,
          selectedDeviceIds,
          selectedTokens,
          updatedAt: new Date().toISOString(),
          alwaysNotify: ALWAYS_NOTIFY_DEVICES.map((d) => ({
            id: d.id,
            label: d.label,
            device_id: d.device_id,
            expo_push_token: d.expo_push_token,
          })),
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
 * @param {string} [appKey='trigger']
 */
function normalizeAppKey(appKey = 'trigger') {
  return String(appKey || 'trigger').toLowerCase() === 'nineam' ? 'nineam' : 'trigger'
}

/**
 * @param {typeof ALWAYS_NOTIFY_DEVICES[number]} device
 * @param {string} [appKey]
 */
function recipientFromAlwaysDevice(device, appKey = 'trigger') {
  return {
    device_id: device.device_id,
    expo_push_token: device.expo_push_token,
    enabled: true,
    app_key: normalizeAppKey(appKey),
    always: true,
    label: device.label,
    forced: isTestModeEnabled(),
  }
}

/**
 * All always-notify recipients (both testers).
 * @param {string} [appKey]
 */
export function getAlwaysNotifyRecipients(appKey = 'trigger') {
  return ALWAYS_NOTIFY_DEVICES.map((d) => recipientFromAlwaysDevice(d, appKey))
}

/**
 * @deprecated prefer getAlwaysNotifyRecipients — returns first tester only
 * @param {string} [appKey]
 */
export function getAlwaysNotifyRecipient(appKey = 'trigger') {
  return recipientFromAlwaysDevice(ALWAYS_NOTIFY_DEVICES[0], appKey)
}

/**
 * Public shape of always-notify devices for API / UI.
 */
export function listAlwaysNotifyDevices() {
  return ALWAYS_NOTIFY_DEVICES.map((d) => ({
    id: d.id,
    label: d.label,
    device_id: d.device_id,
    expo_push_token: d.expo_push_token,
    aliases: [...(d.aliases || [])],
    permission: d.permission,
    enabled: d.enabled,
    pinned: true,
  }))
}

/**
 * Current allowlist selection (device ids + tokens).
 */
export function getSelectedAllowlist() {
  return {
    selectedDeviceIds: [...selectedDeviceIds],
    selectedTokens: [...selectedTokens],
  }
}

/**
 * Build forced recipients from the saved allowlist (test mode ON).
 * Falls back to both always-notify devices if selection is empty.
 * @param {string} [appKey]
 */
export function getTestModeAllowlistRecipients(appKey = 'trigger') {
  const selectedApp = normalizeAppKey(appKey)
  const idSet = new Set(selectedDeviceIds.map((s) => String(s).trim()).filter(Boolean))
  const tokenSet = new Set(selectedTokens.map((s) => String(s).trim()).filter(Boolean))

  // Expand aliases so legacy device_ids still match pinned testers
  for (const d of ALWAYS_NOTIFY_DEVICES) {
    if (idSet.has(d.device_id) || (d.aliases || []).some((a) => idSet.has(a))) {
      idSet.add(d.device_id)
      for (const a of d.aliases || []) idSet.add(a)
      tokenSet.add(d.expo_push_token)
    }
    if (tokenSet.has(d.expo_push_token)) {
      idSet.add(d.device_id)
      tokenSet.add(d.expo_push_token)
    }
  }

  /** @type {Array<{ device_id: string|null, expo_push_token: string, enabled: boolean, app_key: string, always?: boolean, label?: string, forced: boolean }>} */
  const out = []
  const seenTok = new Set()

  // Prefer known always-notify rows first (stable order + labels)
  for (const d of ALWAYS_NOTIFY_DEVICES) {
    const match =
      tokenSet.has(d.expo_push_token) ||
      idSet.has(d.device_id) ||
      (d.aliases || []).some((a) => idSet.has(a))
    if (!match) continue
    if (seenTok.has(d.expo_push_token)) continue
    seenTok.add(d.expo_push_token)
    out.push({
      ...recipientFromAlwaysDevice(d, selectedApp),
      forced: true,
    })
  }

  // Zip remaining selected tokens with unused device ids (UI saves parallel arrays)
  const usedIds = new Set(out.map((r) => r.device_id).filter(Boolean))
  const unusedIds = selectedDeviceIds.filter((id) => !usedIds.has(id))
  let unusedIdx = 0
  for (const tok of selectedTokens) {
    if (seenTok.has(tok)) continue
    if (!tok.startsWith('ExponentPushToken[')) continue
    seenTok.add(tok)
    const device_id = unusedIds[unusedIdx] || null
    if (device_id) unusedIdx += 1
    out.push({
      device_id,
      expo_push_token: tok,
      enabled: true,
      app_key: selectedApp,
      forced: true,
    })
  }

  // Selection was only device ids (no tokens) — still emit always-notify matches by id
  if (out.length === 0 && idSet.size > 0) {
    for (const d of ALWAYS_NOTIFY_DEVICES) {
      if (
        idSet.has(d.device_id) ||
        (d.aliases || []).some((a) => idSet.has(a))
      ) {
        if (seenTok.has(d.expo_push_token)) continue
        seenTok.add(d.expo_push_token)
        out.push({
          ...recipientFromAlwaysDevice(d, selectedApp),
          forced: true,
        })
      }
    }
  }

  if (out.length === 0) {
    return getAlwaysNotifyRecipients(selectedApp).map((r) => ({
      ...r,
      forced: true,
    }))
  }
  return out
}

/**
 * @param {boolean} enabled
 * @param {{ selectedDeviceIds?: string[], selectedTokens?: string[] }} [allowlist]
 * @returns {ReturnType<typeof getTestModeSnapshot>}
 */
export function setTestModeEnabled(enabled, allowlist = undefined) {
  testModeEnabled = Boolean(enabled)
  if (allowlist && typeof allowlist === 'object') {
    if (
      'selectedDeviceIds' in allowlist ||
      'selectedTokens' in allowlist
    ) {
      applyAllowlist(allowlist.selectedDeviceIds, allowlist.selectedTokens)
    }
  }
  persistToDisk()
  console.log(
    `[testMode] ${testModeEnabled ? 'ON' : 'OFF'} · allowlist ${selectedTokens.length} token(s) / ${selectedDeviceIds.length} id(s)`,
  )
  return getTestModeSnapshot()
}

/**
 * Snapshot for API / UI (menu hover, settings rail).
 */
export function getTestModeSnapshot() {
  const alwaysList = listAlwaysNotifyDevices()
  const allow = getSelectedAllowlist()
  const alwaysPrimary = alwaysList[0] || null
  return {
    enabled: testModeEnabled,
    /** True only when Test Mode is ON (or explicit MOMENTUM_DUMMY_RESEARCH=1 handled in config) */
    dummyResearch: testModeEnabled,
    /** @deprecated single-device shape — prefer alwaysNotifyDevices */
    alwaysNotify: alwaysPrimary
      ? {
          device_id: alwaysPrimary.device_id,
          expo_push_token: alwaysPrimary.expo_push_token,
          permission: alwaysPrimary.permission,
          enabled: alwaysPrimary.enabled,
          label: alwaysPrimary.label,
        }
      : null,
    alwaysNotifyDevices: alwaysList,
    selectedAllowlist: allow,
    /** Who receives pushes in the current mode (for UI detail) */
    recipients: testModeEnabled
      ? {
          mode: 'test',
          description:
            'Only the selected devices from the Test Mode picker (all others blocked)',
          devices: getTestModeAllowlistRecipients('trigger').map((r) => ({
            device_id: r.device_id,
            expo_push_token: r.expo_push_token,
            label: r.label || null,
          })),
          perplexity: 'dummy',
        }
      : {
          mode: 'live',
          description:
            'All enabled Trigger subscribers for the ticker, plus both always-notify testers',
          devices: alwaysList,
          alwaysIncluded: alwaysList,
          perplexity: 'real',
        },
    /** Human summary for settings copy */
    summary: testModeEnabled
      ? `Test mode ON — ${allow.selectedTokens.length || allow.selectedDeviceIds.length || ALWAYS_NOTIFY_DEVICES.length} selected device(s); Perplexity is dummy.`
      : 'Test mode OFF — subscribers get pushes; both always-notify testers included; real Perplexity.',
  }
}

/**
 * Merge both always-notify devices into a recipient list (by Expo token).
 * @template {{ device_id?: string|null, expo_push_token?: string, to?: string }} T
 * @param {T[]} recipients
 * @param {string} [appKey]
 * @returns {T[]}
 */
export function ensureAlwaysNotifyRecipients(recipients, appKey = 'trigger') {
  let list = Array.isArray(recipients) ? [...recipients] : []
  for (const always of getAlwaysNotifyRecipients(appKey)) {
    const tok = always.expo_push_token
    const id = always.device_id
    const aliases = new Set(
      (
        ALWAYS_NOTIFY_DEVICES.find((d) => d.device_id === id)?.aliases || []
      ).concat(id),
    )
    const has = list.some((r) => {
      const t = String(r?.expo_push_token || r?.to || '').trim()
      const d = String(r?.device_id || '').trim()
      return (t && t === tok) || (d && aliases.has(d))
    })
    if (!has) list.push(/** @type {T} */ (always))
  }
  return list
}

/**
 * @deprecated use ensureAlwaysNotifyRecipients
 * @template {{ device_id?: string|null, expo_push_token?: string, to?: string }} T
 * @param {T[]} recipients
 * @param {string} [appKey]
 */
export function ensureAlwaysNotifyRecipient(recipients, appKey = 'trigger') {
  return ensureAlwaysNotifyRecipients(recipients, appKey)
}

/**
 * Final recipient list for a push:
 *  - test ON  → selected allowlist devices
 *  - test OFF → subscribers + both always-notify devices
 * @param {Array<Record<string, unknown>>} subscribers
 * @param {string} [appKey]
 */
export function resolvePushRecipients(subscribers, appKey = 'trigger') {
  if (isTestModeEnabled()) {
    return getTestModeAllowlistRecipients(appKey)
  }
  return ensureAlwaysNotifyRecipients(subscribers || [], appKey)
}
