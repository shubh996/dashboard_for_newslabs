/**
 * Watchlist-gated Trigger episode notification delivery.
 *
 * Transport: same Expo Push API path as Trigger screen alerts
 * (`sendTriggerEpisodePush` → `sendExpoPushMessages` in notifications.js).
 *
 * Eligibility source of truth: in-app Momentum/watchlist selections, synced to
 * `device_monitored_tickers.subscribers`. A push only goes to devices that
 * currently have that exact ticker enabled for the Trigger app.
 *
 * Delivery is re-checked at send time so watchlist removals take effect immediately.
 */

import { createClient } from '@supabase/supabase-js'
import {
  sendTriggerEpisodePush,
  loadExpoRecipientsForTicker,
} from '../notifications.js'
import * as store from './store.js'
import { isPushWorthy, buildNotificationCopy } from './notifyCopy.js'

function getSupabaseOrNull() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  } catch {
    return null
  }
}

function normTicker(t) {
  return store.normalizeMomentumTicker(t) || String(t || '').trim().toUpperCase()
}

/**
 * Eligible Expo devices for a ticker (Trigger app watchlist).
 * @param {string} ticker
 */
export async function loadWatchlistEligibleDevices(ticker) {
  const symbol = normTicker(ticker)
  if (!symbol) return []

  const supabase = getSupabaseOrNull()
  if (!supabase) {
    // No Supabase → cannot resolve real device tokens; empty (no broadcast).
    return []
  }

  try {
    const recipients = await loadExpoRecipientsForTicker(supabase, symbol, 'trigger')
    return recipients.map((r) => ({
      device_id: r.device_id,
      expo_push_token: r.expo_push_token,
      ticker: symbol,
      push_enabled: true,
      app_key: 'trigger',
    }))
  } catch (err) {
    console.warn(
      '[momentum delivery] watchlist load failed:',
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

/**
 * Re-check eligibility at delivery time.
 * @param {string} ticker
 * @param {Array<{ device_id?: string|null, expo_push_token?: string }>} [candidates]
 */
export async function filterEligibleAtDeliveryTime(ticker, candidates) {
  const live = await loadWatchlistEligibleDevices(ticker)
  const liveTokens = new Set(live.map((d) => d.expo_push_token).filter(Boolean))
  const liveIds = new Set(live.map((d) => d.device_id).filter(Boolean))
  const list = Array.isArray(candidates) ? candidates : live
  return list.filter(
    (d) =>
      d &&
      ((d.expo_push_token && liveTokens.has(d.expo_push_token)) ||
        (d.device_id && liveIds.has(d.device_id))),
  )
}

/**
 * Attach notification copy + eligibility metadata; optionally send via Expo.
 *
 * @param {Record<string, unknown>} event
 * @param {Record<string, unknown>|null} [episode]
 * @param {{ send?: boolean }} [opts]
 */
export async function enrichEventForDelivery(event, episode = null, opts = {}) {
  const send = opts.send !== false
  const ev = { ...event }
  if (episode) ev.episode = episode

  const push = isPushWorthy(ev.eventType, ev.reason, ev.shouldNotify)
  ev.shouldNotify = push

  if (!push) {
    ev.notification = null
    ev.eligibleDeviceCount = 0
    ev.eligibleDevices = []
    ev.pushResult = null
    delete ev.episode
    return ev
  }

  const copy =
    ev.notification && ev.notification.title
      ? ev.notification
      : buildNotificationCopy(ev)
  if (copy) ev.notification = copy

  const symbol = normTicker(String(ev.ticker || episode?.ticker || ''))
  const supabase = getSupabaseOrNull()

  if (!send) {
    const eligible = await loadWatchlistEligibleDevices(symbol)
    ev.eligibleDeviceCount = eligible.length
    ev.eligibleDevices = eligible.map((d) => d.device_id).filter(Boolean)
    ev.pushResult = { dry_run: true, recipient_count: eligible.length }
    // Copy is ready; alert not actually sent in dry-run
    ev.notifiedAt = null
    delete ev.episode
    return ev
  }

  const pushResult = await sendTriggerEpisodePush({
    supabase,
    ticker: symbol,
    title: copy?.title || `${symbol} momentum`,
    body: copy?.body || '',
    eventType: String(ev.eventType || ''),
    direction: String(ev.direction || ''),
    movePercent: ev.movePercent,
    price: ev.price,
    episodeId: episode?.episodeId || episode?.episode_id || null,
    detectedWindow: ev.detectedWindow,
    reason: ev.reason,
    marketSession: ev.marketSession,
    appKey: 'trigger',
    dryRun: process.env.MOMENTUM_PUSH_DRY_RUN === '1',
  })

  // Stamp after delivery so timeline can show: backend event → alert (later)
  const notifiedAt = new Date().toISOString()
  ev.notifiedAt = notifiedAt
  ev.eligibleDeviceCount = pushResult.recipient_count || 0
  ev.eligibleDevices = pushResult.device_ids || []
  ev.pushResult = {
    ok: pushResult.ok,
    skipped: pushResult.skipped || false,
    reason: pushResult.reason || null,
    sent_ok: pushResult.sent_ok,
    sent_failed: pushResult.sent_failed,
    recipient_count: pushResult.recipient_count,
    deep_link: pushResult.deep_link || null,
    notification_type: pushResult.notification_type || null,
    errors: pushResult.errors || [],
    device_ids: pushResult.device_ids || [],
    recipients: pushResult.recipients || [],
    forced_allowlist: Boolean(pushResult.forced_allowlist),
    tickets: pushResult.tickets || [],
    at: notifiedAt,
  }

  delete ev.episode
  return ev
}

/**
 * Process episode events: enrich copy, send Expo pushes for push-worthy events.
 *
 * @param {string} ticker
 * @param {Array<Record<string, unknown>>} events
 * @param {Record<string, unknown>|null} [episode]
 */
export async function deliverEpisodeEvents(ticker, events, episode = null) {
  const out = []
  for (const raw of events || []) {
    const enriched = await enrichEventForDelivery(raw, episode, { send: true })
    out.push(enriched)

    const pr = enriched.pushResult
    if (enriched.shouldNotify) {
      const n = enriched.notification
      const sent = pr?.sent_ok || 0
      const skipped = pr?.skipped
      const count = pr?.recipient_count || 0
      let level = 'success'
      let msg = `Notify · ${enriched.eventType} · Expo ${sent}/${count} · “${n?.title || ''}”`
      if (skipped && count === 0) {
        level = 'warn'
        msg = `Notify skipped · ${enriched.eventType} · ${pr?.reason || 'no watchlist devices'} for ${ticker}`
      } else if (pr && pr.ok === false && !skipped) {
        level = 'error'
        msg = `Notify failed · ${enriched.eventType} · sent=${sent} failed=${pr.sent_failed || 0}`
      }
      store.pushLog(ticker, level, msg, 'notify', {
        title: n?.title,
        body: n?.body,
        pushResult: pr,
      })
    }
  }
  return out
}
