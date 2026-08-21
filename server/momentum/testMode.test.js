import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALWAYS_NOTIFY_DEVICES,
  setTestModeEnabled,
  resolvePushRecipients,
  getTestModeSnapshot,
} from './testMode.js'

describe('testMode allowlist', () => {
  it('OFF includes subscribers plus both always-notify testers', () => {
    setTestModeEnabled(false)
    const subs = [
      {
        device_id: 'ios-user-1',
        expo_push_token: 'ExponentPushToken[UserOneTokenXXXX]',
      },
    ]
    const recipients = resolvePushRecipients(subs)
    const ids = recipients.map((r) => r.device_id)
    assert.ok(ids.includes('ios-user-1'))
    for (const d of ALWAYS_NOTIFY_DEVICES) {
      assert.ok(ids.includes(d.device_id), `missing ${d.label}`)
    }
  })

  it('ON delivers only selected Expo app tester', () => {
    const expo = ALWAYS_NOTIFY_DEVICES[1]
    setTestModeEnabled(true, {
      selectedDeviceIds: [expo.device_id],
      selectedTokens: [expo.expo_push_token],
    })
    const recipients = resolvePushRecipients([
      {
        device_id: 'ios-user-1',
        expo_push_token: 'ExponentPushToken[UserOneTokenXXXX]',
      },
    ])
    assert.equal(recipients.length, 1)
    assert.equal(recipients[0].device_id, expo.device_id)
    assert.equal(recipients[0].expo_push_token, expo.expo_push_token)
  })

  it('snapshot lists both always-notify devices with labels', () => {
    setTestModeEnabled(false)
    const snap = getTestModeSnapshot()
    assert.equal(snap.alwaysNotifyDevices.length, 2)
    assert.ok(
      snap.alwaysNotifyDevices.some((d) =>
        String(d.label).includes('Trigger'),
      ),
    )
    assert.ok(
      snap.alwaysNotifyDevices.some((d) => String(d.label).includes('Expo')),
    )
  })

  it('MOMENTUM_TEST_MODE=1 forces allowlist even if UI turns OFF', () => {
    const prev = process.env.MOMENTUM_TEST_MODE
    process.env.MOMENTUM_TEST_MODE = '1'
    const expo = ALWAYS_NOTIFY_DEVICES[1]
    setTestModeEnabled(true, {
      selectedDeviceIds: [expo.device_id],
      selectedTokens: [expo.expo_push_token],
    })
    // UI tries to go live — env must keep allowlist-only
    setTestModeEnabled(false)
    const recipients = resolvePushRecipients([
      {
        device_id: 'ios-user-1',
        expo_push_token: 'ExponentPushToken[UserOneTokenXXXX]',
      },
    ])
    assert.equal(recipients.length, 1)
    assert.equal(recipients[0].expo_push_token, expo.expo_push_token)
    assert.equal(getTestModeSnapshot().forcedByEnv, true)
    if (prev === undefined) delete process.env.MOMENTUM_TEST_MODE
    else process.env.MOMENTUM_TEST_MODE = prev
  })

  // Leave OFF so local/dev server state is not stuck in test mode
  delete process.env.MOMENTUM_TEST_MODE
  setTestModeEnabled(false)
})
