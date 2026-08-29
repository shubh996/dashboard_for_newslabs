/**
 * Notification recipient policy.
 *
 * Every push keeps its normal relevant subscribers and also includes the
 * Trigger owner's iPhone 16. Featured devices are exposed separately so the
 * dashboard can identify them without changing their subscription rules.
 */

export const ALWAYS_NOTIFY_DEVICE = Object.freeze({
  id: 'trigger-iphone16',
  label: 'Trigger app · iPhone 16',
  role: 'always_notify',
  device_id: 'ios-0c793db2-c3a0-4ee7-b742-4270d81e20f7',
  expo_push_token: 'ExponentPushToken[FmqQg-OgjuWt8hLmcQDJCF]',
  aliases: Object.freeze(['ios-d003c3d5-2c11-4766-866e-8bf8e511929c']),
  permission: 'granted',
  enabled: true,
})

export const FEATURED_DEVICES = Object.freeze([
  ALWAYS_NOTIFY_DEVICE,
  Object.freeze({
    id: 'expo-app',
    label: 'Expo app',
    role: 'featured',
    device_id: 'ios-1ddd5b0c-5ff8-401f-b0a6-ae9beaac8ea1',
    expo_push_token: 'ExponentPushToken[Q4Q4xqGpb9fyE9kpMPdUYZ]',
    aliases: Object.freeze([]),
    permission: 'granted',
    enabled: true,
  }),
])

function normalizeAppKey(appKey = 'trigger') {
  return String(appKey || 'trigger').toLowerCase() === 'nineam'
    ? 'nineam'
    : 'trigger'
}

function recipientFromAlwaysDevice(appKey = 'trigger') {
  return {
    device_id: ALWAYS_NOTIFY_DEVICE.device_id,
    expo_push_token: ALWAYS_NOTIFY_DEVICE.expo_push_token,
    enabled: true,
    app_key: normalizeAppKey(appKey),
    always: true,
    label: ALWAYS_NOTIFY_DEVICE.label,
  }
}

/** Return featured metadata when a device id/token belongs to a pinned device. */
export function findFeaturedDevice(deviceId, expoPushToken) {
  const id = String(deviceId || '').trim()
  const token = String(expoPushToken || '').trim()
  return (
    FEATURED_DEVICES.find(
      (device) =>
        (token && token === device.expo_push_token) ||
        (id &&
          (id === device.device_id ||
            (device.aliases || []).some((alias) => alias === id))),
    ) || null
  )
}

/**
 * Merge the always-notify Trigger iPhone into a recipient list, deduped by
 * Expo token, canonical device id, or its older device-id alias.
 *
 * @template {{ device_id?: string|null, expo_push_token?: string, to?: string }} T
 * @param {T[]} recipients
 * @param {string} [appKey]
 * @returns {T[]}
 */
export function ensureAlwaysNotifyRecipient(recipients, appKey = 'trigger') {
  const list = Array.isArray(recipients) ? [...recipients] : []
  const always = recipientFromAlwaysDevice(appKey)
  const ids = new Set([
    ALWAYS_NOTIFY_DEVICE.device_id,
    ...(ALWAYS_NOTIFY_DEVICE.aliases || []),
  ])
  const exists = list.some((recipient) => {
    const token = String(
      recipient?.expo_push_token || recipient?.to || '',
    ).trim()
    const deviceId = String(recipient?.device_id || '').trim()
    return (
      token === ALWAYS_NOTIFY_DEVICE.expo_push_token ||
      (deviceId && ids.has(deviceId))
    )
  })
  if (!exists) list.push(/** @type {T} */ (always))
  return list
}

/** Final push audience: relevant subscribers + the Trigger iPhone 16. */
export function resolvePushRecipients(subscribers, appKey = 'trigger') {
  return ensureAlwaysNotifyRecipient(subscribers || [], appKey)
}

export function getNotificationRecipientPolicySnapshot() {
  return {
    mode: 'subscribers_plus_always',
    description:
      'Relevant enabled subscribers, plus Trigger app · iPhone 16 on every notification',
    alwaysNotify: {
      id: ALWAYS_NOTIFY_DEVICE.id,
      label: ALWAYS_NOTIFY_DEVICE.label,
      device_id: ALWAYS_NOTIFY_DEVICE.device_id,
      expo_push_token: ALWAYS_NOTIFY_DEVICE.expo_push_token,
      aliases: [...ALWAYS_NOTIFY_DEVICE.aliases],
    },
    featuredDevices: FEATURED_DEVICES.map((device) => ({
      id: device.id,
      label: device.label,
      role: device.role,
      device_id: device.device_id,
      expo_push_token: device.expo_push_token,
      aliases: [...device.aliases],
    })),
  }
}
