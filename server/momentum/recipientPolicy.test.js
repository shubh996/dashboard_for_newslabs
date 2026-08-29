import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALWAYS_NOTIFY_DEVICE,
  FEATURED_DEVICES,
  ensureAlwaysNotifyRecipient,
  findFeaturedDevice,
  resolvePushRecipients,
} from './recipientPolicy.js'

describe('notification recipient policy', () => {
  it('keeps relevant subscribers and adds only the Trigger iPhone', () => {
    const subscriber = {
      device_id: 'ios-user-1',
      expo_push_token: 'ExponentPushToken[UserOneTokenXXXX]',
    }
    const recipients = resolvePushRecipients([subscriber])
    assert.equal(recipients.length, 2)
    assert.ok(recipients.some((row) => row.device_id === subscriber.device_id))
    assert.ok(
      recipients.some(
        (row) => row.device_id === ALWAYS_NOTIFY_DEVICE.device_id,
      ),
    )
    assert.ok(
      !recipients.some(
        (row) => row.device_id === FEATURED_DEVICES[1].device_id,
      ),
    )
  })

  it('dedupes the always recipient by token and legacy device-id alias', () => {
    const byToken = ensureAlwaysNotifyRecipient([
      {
        device_id: 'some-old-id',
        expo_push_token: ALWAYS_NOTIFY_DEVICE.expo_push_token,
      },
    ])
    assert.equal(byToken.length, 1)

    const byAlias = ensureAlwaysNotifyRecipient([
      {
        device_id: ALWAYS_NOTIFY_DEVICE.aliases[0],
        expo_push_token: ALWAYS_NOTIFY_DEVICE.expo_push_token,
      },
    ])
    assert.equal(byAlias.length, 1)
  })

  it('identifies both featured Users-tab devices without forcing Expo app', () => {
    for (const device of FEATURED_DEVICES) {
      assert.equal(
        findFeaturedDevice(device.device_id, device.expo_push_token)?.id,
        device.id,
      )
    }
  })
})
