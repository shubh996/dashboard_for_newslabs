/**
 * Persist / hydrate momentum episodes + timeline events in Supabase.
 * In-memory store remains the live source; this is how history survives restarts.
 */
import { createClient } from '@supabase/supabase-js'
import * as store from './store.js'
import { formatExactLookbackLabel } from './returns.js'
import {
  episodePayloadForSupabase,
  eventPayloadForSupabase,
} from './mobilePayload.js'

let client = null
let clientTried = false

function getSupabaseOrNull() {
  if (clientTried) return client
  clientTried = true
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  } catch {
    client = null
  }
  return client
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function iso(v) {
  if (!v) return null
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Per-asset-class episode tables (replaces single episodes writes). */
export const EPISODE_CLASS_TABLES = {
  stocks: 'episodes_stocks',
  indexes: 'episodes_indexes',
  forex: 'episodes_forex',
  etfs: 'episodes_etfs',
  crypto: 'episodes_crypto',
  commodities: 'episodes_commodities',
}

export function episodeAssetClassKey(ticker, hint) {
  const raw = String(hint || '').trim().toLowerCase()
  if (raw === 'etf' || raw === 'etfs') return 'etfs'
  if (raw === 'index' || raw === 'indices' || raw === 'indexes') return 'indexes'
  if (raw === 'forex' || raw === 'fx' || raw === 'currency') return 'forex'
  if (raw === 'crypto' || raw === 'cryptocurrency') return 'crypto'
  if (
    raw === 'commodity' ||
    raw === 'commodities' ||
    raw === 'futures'
  ) {
    return 'commodities'
  }
  if (raw === 'equity' || raw === 'stock' || raw === 'stocks') return 'stocks'
  const t = String(ticker || '').trim().toUpperCase()
  if (t.startsWith('^')) return 'indexes'
  if (t.endsWith('=X') || /^[A-Z]{6}$/.test(t)) return 'forex'
  if (t.endsWith('=F')) return 'commodities'
  if (t.endsWith('-USD') || t.endsWith('-USDT')) return 'crypto'
  return 'stocks'
}

export function episodeTableFor(ticker, hint) {
  const key = episodeAssetClassKey(ticker, hint)
  return EPISODE_CLASS_TABLES[key] || EPISODE_CLASS_TABLES.stocks
}

function isMissingRelationError(err) {
  const msg = String(err?.message || err || '')
  return /schema cache|does not exist|could not find the table/i.test(msg)
}

async function fromEpisodeTable(supabase, ticker, hint, run) {
  const table = episodeTableFor(ticker, hint)
  let res = await run(supabase.from(table), table)
  if (res?.error && isMissingRelationError(res.error)) {
    res = await run(supabase.from('episodes'), 'episodes')
  }
  return res
}

export function episodeRowFromMemory(ep) {
  if (!ep) return null
  const episodeNo = num(ep.episodeNo)
  const fullPayload = episodePayloadForSupabase(ep)
  const lastNotif =
    fullPayload.lastNotification && typeof fullPayload.lastNotification === 'object'
      ? fullPayload.lastNotification
      : null
  const row = {
    episode_id: String(ep.episodeId || ''),
    ticker: String(ep.ticker || '').toUpperCase(),
    direction: ep.direction === 'DOWN' ? 'DOWN' : 'UP',
    status: String(ep.status || 'ACTIVE'),
    state: ep.state || null,
    detected_window: ep.detectedWindow || ep.windowType || null,
    started_at: iso(ep.episodeStartedAt || ep.triggerTime) || new Date().toISOString(),
    ended_at: iso(ep.endedAt),
    end_reason: ep.endReason || null,
    peak_move_percent: num(ep.peakMovePercent),
    current_move_percent: num(ep.currentMovePercent),
    initial_move_percent: num(ep.initialMovePercent ?? ep.triggerMovePct),
    reference_price: num(ep.referencePrice),
    reference_time: iso(ep.referenceTime),
    trigger_price: num(ep.triggerPrice),
    current_price: num(ep.currentPrice),
    // True elapsed span at detection (e.g. 48 minutes for a "1h" key)
    exact_minutes:
      ep.exactMinutes != null && Number.isFinite(Number(ep.exactMinutes))
        ? Math.round(Number(ep.exactMinutes))
        : null,
    exact_label: ep.exactLabel || null,
    window_minutes:
      ep.windowMinutes != null && Number.isFinite(Number(ep.windowMinutes))
        ? Math.round(Number(ep.windowMinutes))
        : null,
    last_alert: (() => {
      const title = lastNotif?.title || ep.lastNotification?.title || null
      const body = lastNotif?.body || ep.lastNotification?.body || null
      const researchId =
        lastNotif?.researchId ||
        lastNotif?.research_id ||
        ep.lastNotification?.researchId ||
        ep.latestResearchId ||
        ep.researchId ||
        null
      if (!title && !body && !researchId) return null
      return { title, body, research_id: researchId }
    })(),
    last_notification_at: iso(lastNotif?.at || ep.lastAlertAt),
    latest_research_id:
      lastNotif?.researchId ||
      lastNotif?.research_id ||
      ep.latestResearchId ||
      ep.researchId ||
      null,
    // Live giveback (ratio 0–1 and percent 0–100) for queries + mobile
    giveback_ratio: (() => {
      const fromEp = num(ep.givebackRatio ?? ep.giveback_ratio)
      if (fromEp != null) return fromEp
      const fromDisp = num(fullPayload?.display?.headlineGivebackPct)
      if (fromDisp != null) return fromDisp / 100
      const fromMeas = num(fullPayload?.measure?.givebackRatio)
      return fromMeas
    })(),
    giveback_pct: (() => {
      const fromEp = num(ep.givebackPct ?? ep.giveback_pct)
      if (fromEp != null) return fromEp
      const fromDisp = num(fullPayload?.display?.headlineGivebackPct)
      if (fromDisp != null) return fromDisp
      const fromMeas = num(fullPayload?.measure?.givebackPercent)
      if (fromMeas != null) return fromMeas
      const ratio = num(ep.givebackRatio ?? fullPayload?.measure?.givebackRatio)
      return ratio != null ? ratio * 100 : null
    })(),
    asset_class: episodeAssetClassKey(ep.ticker, ep.assetClass || ep.asset_class),
    updated_at: new Date().toISOString(),
  }
  // Per-ticker #001 / #002 — set explicitly (not global bigserial)
  if (episodeNo != null && episodeNo > 0) row.episode_no = episodeNo
  return row
}

export function memoryEpisodeFromRow(row) {
  if (!row) return null
  const lastAlert =
    row.last_alert && typeof row.last_alert === 'object' ? row.last_alert : null
  const researchId =
    lastAlert?.research_id || row.latest_research_id || null
  return {
    episodeId: row.episode_id || null,
    episodeNo: row.episode_no ?? null,
    ticker: row.ticker,
    direction: row.direction,
    status: row.status,
    state: row.state,
    detectedWindow: row.detected_window,
    episodeStartedAt: row.started_at,
    endedAt: row.ended_at || null,
    endReason: row.end_reason || null,
    givebackPct: num(row.giveback_pct),
    peakMovePercent: num(row.peak_move_percent),
    currentMovePercent: num(row.current_move_percent),
    initialMovePercent: num(row.initial_move_percent),
    referencePrice: num(row.reference_price),
    referenceTime: row.reference_time || null,
    triggerPrice: num(row.trigger_price),
    currentPrice: num(row.current_price),
    exactMinutes: num(row.exact_minutes),
    exactLabel: row.exact_label || null,
    windowMinutes: num(row.window_minutes),
    assetClass: row.asset_class || null,
    lastAlertAt: row.last_notification_at || null,
    lastNotification: lastAlert
      ? {
          title: lastAlert.title || null,
          body: lastAlert.body || null,
          researchId: researchId,
          at: row.last_notification_at || null,
        }
      : null,
    latestResearchId: row.latest_research_id || researchId || null,
    researchId: researchId,
  }
}

/** If older rows lack exactMinutes, derive from referenceTime → started_at. */
export function ensureEpisodeExactSpan(ep) {
  if (!ep) return ep
  const windowKey = String(ep.detectedWindow || ep.windowType || '').trim()
  // Day card: label is session name (pre-market / after-hours / today), not wall span
  if (windowKey === 'day') {
    const sess = String(ep.marketSession || '').toUpperCase()
    const dayLabel =
      sess === 'PRE'
        ? 'pre-market'
        : sess === 'PREPRE'
          ? 'overnight'
          : sess === 'POST' || sess === 'POSTPOST'
            ? 'after-hours'
            : sess === 'CLOSED' || sess === 'CLOSE'
              ? 'at the close'
              : 'today'
    if (ep.exactMinutes != null && Number.isFinite(Number(ep.exactMinutes))) {
      if (!ep.exactLabel) return { ...ep, exactLabel: dayLabel }
      return ep
    }
    const refMs = Date.parse(String(ep.referenceTime || ''))
    const startMs = Date.parse(
      String(ep.episodeStartedAt || ep.triggerTime || ep.started_at || ''),
    )
    if (Number.isFinite(refMs) && Number.isFinite(startMs) && startMs >= refMs) {
      return {
        ...ep,
        exactMinutes: Math.max(1, Math.round((startMs - refMs) / 60_000)),
        exactLabel: ep.exactLabel || dayLabel,
      }
    }
    return ep.exactLabel ? ep : { ...ep, exactLabel: dayLabel }
  }
  if (ep.exactMinutes != null && Number.isFinite(Number(ep.exactMinutes))) {
    if (!ep.exactLabel) {
      return {
        ...ep,
        exactLabel: formatExactLookbackLabel(Number(ep.exactMinutes)),
      }
    }
    return ep
  }
  const refMs = Date.parse(String(ep.referenceTime || ''))
  const startMs = Date.parse(
    String(ep.episodeStartedAt || ep.triggerTime || ep.started_at || ''),
  )
  if (!Number.isFinite(refMs) || !Number.isFinite(startMs) || startMs < refMs) {
    return ep
  }
  const exactMinutes = Math.max(1, Math.round((startMs - refMs) / 60_000))
  return {
    ...ep,
    exactMinutes,
    exactLabel: formatExactLookbackLabel(exactMinutes),
  }
}

export function memoryEventFromRow(row) {
  if (!row) return null
  const title = row.notification_title || null
  const body = row.notification_body || null
  return {
    ticker: row.ticker,
    eventType: row.event_type,
    state: row.state ?? null,
    direction: row.direction,
    detectedWindow: row.detected_window,
    detectedAt: row.detected_at,
    movePercent: num(row.move_percent),
    price: num(row.price),
    reason: row.reason ?? null,
    givebackPct: num(row.giveback_pct ?? row.giveback_percent),
    episodeId: row.episode_id || null,
    episodeNo: row.episode_no ?? null,
    researchId: row.research_id || null,
    exactMinutes: num(row.exact_minutes),
    referenceTime: row.reference_time || null,
    referencePrice: num(row.reference_price),
    notifiedAt: row.notified_at || null,
    shouldNotify: row.should_notify != null ? Boolean(row.should_notify) : undefined,
    assetClass: row.asset_class || null,
    notification:
      title || body
        ? { title: title || undefined, body: body || undefined }
        : null,
    supabaseSaved: true,
    supabasePersist: {
      ok: true,
      action:
        row.updated_at &&
        row.created_at &&
        Date.parse(row.updated_at) - Date.parse(row.created_at) > 1500
          ? 'updated'
          : 'saved',
      at: row.updated_at || row.created_at || null,
      id: row.id || null,
    },
  }
}

/**
 * Upsert episode. Returns assigned episode_no (or null if skipped / failed).
 * @param {Record<string, unknown>} ep
 */
const SPAN_COLUMNS = [
  'exact_minutes',
  'exact_label',
  'window_minutes',
  'reference_time',
  'reference_price',
  'last_alert',
  'last_notification_at',
  'latest_research_id',
  'notification_title',
  'notification_body',
  'notified_at',
  'should_notify',
  'giveback_pct',
  'measure',
  'research_id',
  'short_reason',
  'asset_class',
  // Optional until schema_momentum_one_active_per_ticker.sql applied
  'idempotency_key',
]

/** Columns that may be missing until schema_momentum_mobile_detail.sql is applied */
const GIVEBACK_COLUMNS = ['giveback_pct']

const EPISODE_LIGHT_COLUMNS = [
  'episode_id',
  'episode_no',
  'ticker',
  'direction',
  'status',
  'state',
  'detected_window',
  'started_at',
  'ended_at',
  'end_reason',
  'peak_move_percent',
  'current_move_percent',
  'initial_move_percent',
  'reference_price',
  'reference_time',
  'trigger_price',
  'current_price',
  'exact_minutes',
  'exact_label',
  'window_minutes',
  'last_alert',
  'last_notification_at',
  'latest_research_id',
  'giveback_pct',
  'asset_class',
  'updated_at',
].join(',')

const EVENT_LIGHT_COLUMNS = [
  'id',
  'episode_id',
  'episode_no',
  'ticker',
  'asset_class',
  'event_type',
  'state',
  'direction',
  'detected_window',
  'detected_at',
  'move_percent',
  'price',
  'reason',
  'exact_minutes',
  'notification_title',
  'notification_body',
  'notified_at',
  'should_notify',
  'giveback_pct',
  'research_id',
].join(',')

const EVENT_LIGHT_COLUMNS_NO_RESEARCH_ID = [
  'id',
  'episode_id',
  'episode_no',
  'ticker',
  'asset_class',
  'event_type',
  'state',
  'direction',
  'detected_window',
  'detected_at',
  'move_percent',
  'price',
  'reason',
  'exact_minutes',
  'notification_title',
  'notification_body',
  'notified_at',
  'should_notify',
  'giveback_pct',
].join(',')

const MATERIAL_MOVE_PP = 0.08
const EPISODE_HEARTBEAT_MS = 8 * 60_000
/** episodeId → { status, state, move, peak, at } of last upsert */
const lastEpisodePersist = new Map()

function episodeNeedsPersist(ep, { closed = false, hasEvents = false } = {}) {
  if (!ep?.episodeId) return false
  if (closed) return true
  const status = String(ep.status || '').toUpperCase()
  if (status && status !== 'ACTIVE') return true
  const prev = lastEpisodePersist.get(String(ep.episodeId))
  if (!prev) return true
  if (String(prev.status || '') !== status) return true
  if (String(prev.state || '') !== String(ep.state || '')) return true
  const move = Number(ep.currentMovePercent)
  const peak = Number(ep.peakMovePercent)
  if (
    Number.isFinite(move) &&
    Number.isFinite(prev.move) &&
    Math.abs(move - prev.move) >= MATERIAL_MOVE_PP
  ) {
    return true
  }
  if (
    Number.isFinite(peak) &&
    Number.isFinite(prev.peak) &&
    Math.abs(peak - prev.peak) >= MATERIAL_MOVE_PP
  ) {
    return true
  }
  if (Date.now() - prev.at >= EPISODE_HEARTBEAT_MS) return true
  // New events still persist themselves; skip rewriting the master row.
  void hasEvents
  return false
}

function markEpisodePersistedLocal(ep) {
  if (!ep?.episodeId) return
  lastEpisodePersist.set(String(ep.episodeId), {
    status: String(ep.status || ''),
    state: String(ep.state || ''),
    move: Number(ep.currentMovePercent),
    peak: Number(ep.peakMovePercent),
    at: Date.now(),
  })
}

function stripSpanColumns(row) {
  if (!row || typeof row !== 'object') return row
  const out = { ...row }
  for (const k of SPAN_COLUMNS) delete out[k]
  return out
}

function isMissingColumnError(err) {
  const msg = String(err?.message || err || '')
  return /column|schema cache|does not exist/i.test(msg)
}

export async function upsertEpisode(ep) {
  const supabase = getSupabaseOrNull()
  if (!supabase || !ep?.episodeId) return ep?.episodeNo ?? null
  const row = episodeRowFromMemory(ep)
  if (!row?.episode_id || !row.ticker) return ep?.episodeNo ?? null
  let { data, error } = await fromEpisodeTable(
    supabase,
    row.ticker,
    row.asset_class,
    (q) =>
      q.upsert(row, { onConflict: 'episode_id' }).select('episode_no').maybeSingle(),
  )
  // Until schema_momentum_exact_span.sql is applied, retry without new columns
  // (exactMinutes still lives in payload jsonb for mobile).
  if (error && isMissingColumnError(error)) {
    const slim = stripSpanColumns(row)
    const retry = await fromEpisodeTable(
      supabase,
      row.ticker,
      row.asset_class,
      (q) =>
        q
          .upsert(slim, { onConflict: 'episode_id' })
          .select('episode_no')
          .maybeSingle(),
    )
    data = retry.data
    error = retry.error
    if (!error) {
      console.warn(
        '[momentum persist] episode upsert used payload-only exact span (run schema_momentum_exact_span.sql for columns)',
      )
    }
  }
  if (error) {
    console.warn('[momentum persist] episode upsert failed:', error.message)
    return ep?.episodeNo ?? null
  }
  markEpisodePersistedLocal(ep)
  return data?.episode_no ?? ep?.episodeNo ?? null
}

/**
 * Insert timeline events (deduped). Best-effort.
 * @param {string} ticker
 * @param {Array<Record<string, unknown>>} events
 */
export async function insertEvents(ticker, events) {
  const supabase = getSupabaseOrNull()
  if (!supabase || !events?.length) return []
  const symbol = String(ticker || '').toUpperCase()
  const rows = []
  for (const ev of events) {
    if (!ev) continue
    const detectedAt = iso(ev.detectedAt)
    if (!detectedAt) continue
    const fullPayload = eventPayloadForSupabase(ev, ev.episode || null)
    const notif = fullPayload.notification || ev.notification || null
    const givebackPct = (() => {
      const pct = num(ev.givebackPct ?? fullPayload.givebackPct)
      if (pct != null) return pct
      const r = num(ev.givebackRatio ?? fullPayload.givebackRatio)
      if (r != null) return r * 100
      return num(fullPayload?.measure?.givebackPercent)
    })()
    rows.push({
      episode_no: Number.isFinite(Number(ev.episodeNo)) ? Number(ev.episodeNo) : null,
      episode_id: String(ev.episodeId || ''),
      ticker: symbol,
      asset_class: episodeAssetClassKey(
        symbol,
        ev.assetClass || ev.episode?.assetClass,
      ),
      event_type: String(ev.eventType || 'MOMENTUM_STATE'),
      state: ev.state || fullPayload.state || null,
      direction: ev.direction || null,
      detected_window: ev.detectedWindow || null,
      detected_at: detectedAt,
      move_percent: num(ev.movePercent),
      price: num(ev.price),
      reason: ev.reason || null,
      idempotency_key:
        ev.idempotencyKey || fullPayload.idempotencyKey || null,
      exact_minutes:
        ev.exactMinutes != null && Number.isFinite(Number(ev.exactMinutes))
          ? Math.round(Number(ev.exactMinutes))
          : null,
      reference_time: iso(ev.referenceTime),
      reference_price: num(ev.referencePrice),
      notification_title: notif?.title || fullPayload.notificationTitle || null,
      notification_body: notif?.body || fullPayload.notificationBody || null,
      notified_at: iso(ev.notifiedAt || fullPayload.notifiedAt),
      should_notify:
        ev.shouldNotify != null ? Boolean(ev.shouldNotify) : null,
      giveback_pct: givebackPct,
      measure: fullPayload.measure || null,
      research_id:
        ev.researchId ||
        fullPayload.researchId ||
        ev.research?.researchId ||
        ev.research?.id ||
        null,
      short_reason:
        ev.shortReason ||
        (typeof fullPayload.likely_driver === 'string'
          ? fullPayload.likely_driver
          : ev.reason) ||
        null,
      updated_at: new Date().toISOString(),
    })
  }
  if (!rows.length) return []
  let { data, error } = await supabase
    .from('episodes_events')
    .upsert(rows, { onConflict: 'ticker,event_type,detected_at,episode_id' })
    .select(
      'id, ticker, event_type, detected_at, episode_id, asset_class, giveback_pct, created_at, updated_at',
    )
  if (error && isMissingColumnError(error)) {
    // Retry without optional mobile columns
    const slimRows = rows.map((r) => stripSpanColumns(r))
    const retry = await supabase
      .from('episodes_events')
      .upsert(slimRows, { onConflict: 'ticker,event_type,detected_at,episode_id' })
      .select('id, ticker, event_type, detected_at, episode_id, created_at, updated_at')
    data = retry.data
    error = retry.error
    if (!error) {
      console.warn(
        '[momentum persist] event upsert without giveback columns — run schema_momentum_mobile_detail.sql',
      )
    }
  }
  if (error) {
    console.warn('[momentum persist] event insert failed:', error.message)
    return []
  }
  return data || []
}

/**
 * Drop stale RESEARCH_RUNNING rows after research completes.
 * RUNNING and DONE use different event_type + detected_at, so upsert cannot replace them.
 * @param {string} ticker
 * @param {string|null|undefined} episodeId
 */
export async function deleteResearchRunningEvents(ticker, episodeId) {
  const supabase = getSupabaseOrNull()
  if (!supabase) return
  const symbol = String(ticker || '').toUpperCase()
  if (!symbol) return
  try {
    let q = supabase
      .from('episodes_events')
      .delete()
      .eq('ticker', symbol)
      .eq('event_type', 'MOMENTUM_RESEARCH_RUNNING')
    if (episodeId) {
      q = q.eq('episode_id', String(episodeId))
    }
    const { error } = await q
    if (error) {
      console.warn(
        '[momentum persist] delete RESEARCH_RUNNING failed:',
        error.message,
      )
    }
  } catch (err) {
    console.warn(
      '[momentum persist] delete RESEARCH_RUNNING error:',
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Persist active and/or closed episodes + timeline events.
 * @param {string} ticker
 * @param {Record<string, unknown>|null|undefined} episode live/active episode (may be null after end)
 * @param {Array<Record<string, unknown>>} events
 * @param {Record<string, unknown>|null|undefined} [closedEpisode] just-ended row to archive
 */
export async function persistTick(ticker, episode, events, closedEpisode = null) {
  try {
    let episodeNo = episode?.episodeNo ?? closedEpisode?.episodeNo ?? null
    // If an ALERT_SENT is in this batch, stamp lastNotification on the episode
    for (const ev of events || []) {
      const type = String(ev?.eventType || '')
      const title = ev?.notification?.title
      if (
        (type === 'MOMENTUM_ALERT_SENT' || type.endsWith('_ALERT_SENT')) &&
        title
      ) {
        const stamp = {
          title: String(title),
          body: String(ev.notification?.body || ''),
          at: ev.notifiedAt || ev.detectedAt || new Date().toISOString(),
          eventType: type,
          movePercent: ev.movePercent ?? null,
          exactMinutes: ev.exactMinutes ?? null,
          exactLabel: ev.exactLabel ?? null,
          researchId:
            ev.researchId ||
            ev.research?.researchId ||
            ev.research?.id ||
            null,
        }
        if (episode?.episodeId && String(ev.episodeId || episode.episodeId) === String(episode.episodeId)) {
          episode.lastNotification = stamp
          episode.lastAlertAt = stamp.at
        }
        if (
          closedEpisode?.episodeId &&
          String(ev.episodeId || closedEpisode.episodeId) ===
            String(closedEpisode.episodeId)
        ) {
          closedEpisode.lastNotification = stamp
          closedEpisode.lastAlertAt = stamp.at
        }
      }
    }
    const hasEvents = Boolean((events || []).length)
    const toUpsert = []
    if (closedEpisode?.episodeId) toUpsert.push(closedEpisode)
    if (
      episode?.episodeId &&
      (!closedEpisode?.episodeId ||
        String(episode.episodeId) !== String(closedEpisode.episodeId)) &&
      episodeNeedsPersist(episode, { closed: false, hasEvents })
    ) {
      toUpsert.push(episode)
    }
    for (const ep of toUpsert) {
      const no = await upsertEpisode({ ...ep, ticker, episodeNo: ep.episodeNo ?? null })
      if (no != null) {
        ep.episodeNo = no
        if (episode && String(ep.episodeId) === String(episode.episodeId)) {
          episode.episodeNo = no
          episodeNo = no
        }
        if (
          closedEpisode &&
          String(ep.episodeId) === String(closedEpisode.episodeId)
        ) {
          closedEpisode.episodeNo = no
          if (episodeNo == null) episodeNo = no
        }
        store.upsertHistoryEpisode(ticker, { ...ep, episodeNo: no })
        if (episode && String(ep.episodeId) === String(episode.episodeId)) {
          store.markEpisodePersisted(ticker, {
            ok: true,
            action: 'saved',
            at: new Date().toISOString(),
          })
        }
      } else if (ep?.episodeId) {
        store.upsertHistoryEpisode(ticker, ep)
      }
    }
    const epById = new Map()
    if (episode?.episodeId) epById.set(String(episode.episodeId), episode)
    if (closedEpisode?.episodeId) {
      epById.set(String(closedEpisode.episodeId), closedEpisode)
    }
    const stamped = (events || []).map((ev) => {
      const eid = String(ev.episodeId || episode?.episodeId || closedEpisode?.episodeId || '')
      const epSnap = epById.get(eid) || episode || closedEpisode || null
      return {
        ...ev,
        episodeId: eid,
        episodeNo: ev.episodeNo ?? episodeNo ?? epSnap?.episodeNo ?? null,
        // Attach episode for mobile payload builder (stripped of cycles in JSON)
        episode: epSnap
          ? {
              episodeId: epSnap.episodeId,
              episodeNo: epSnap.episodeNo,
              status: epSnap.status,
              state: epSnap.state,
              direction: epSnap.direction,
              referencePrice: epSnap.referencePrice,
              referenceTime: epSnap.referenceTime,
              peakPrice: epSnap.peakPrice,
              peakMovePercent: epSnap.peakMovePercent,
              troughPrice: epSnap.troughPrice,
              initialMovePercent: epSnap.initialMovePercent,
              triggerMovePct: epSnap.triggerMovePct,
              triggerPrice: epSnap.triggerPrice,
              exactMinutes: epSnap.exactMinutes,
              exactLabel: epSnap.exactLabel,
              detectedWindow: epSnap.detectedWindow,
              windowType: epSnap.windowType,
            }
          : undefined,
      }
    })
    const savedRows = await insertEvents(ticker, stamped)
    if (savedRows?.length) store.markEventsPersisted(ticker, savedRows)
    return episodeNo
  } catch (err) {
    console.warn(
      '[momentum persist] tick failed:',
      err instanceof Error ? err.message : err,
    )
    return episode?.episodeNo ?? closedEpisode?.episodeNo ?? null
  }
}

/**
 * Load recent episodes + events for a ticker.
 * @param {string} ticker
 * @param {{ episodeLimit?: number }} [opts]
 */
export async function loadTickerHistory(ticker, opts = {}) {
  const supabase = getSupabaseOrNull()
  const empty = { episodes: [], events: [], maxEpisodeNo: 0 }
  if (!supabase) return { ...empty, available: false }
  const symbol = String(ticker || '').toUpperCase()
  const episodeLimit = Math.min(80, Math.max(5, Number(opts.episodeLimit) || 40))
  try {
    const loadEpisodes = (q) =>
      q
        .select(EPISODE_LIGHT_COLUMNS)
        .eq('ticker', symbol)
        .order('started_at', { ascending: false })
        .limit(episodeLimit)
    let epQ = await fromEpisodeTable(supabase, symbol, null, loadEpisodes)
    if (epQ.error && isMissingColumnError(epQ.error)) {
      epQ = await fromEpisodeTable(supabase, symbol, null, (q) =>
        q
          .select(
            'episode_id,episode_no,ticker,direction,status,state,detected_window,started_at,ended_at,end_reason,peak_move_percent,current_move_percent,initial_move_percent,reference_price,trigger_price,current_price,updated_at',
          )
          .eq('ticker', symbol)
          .order('started_at', { ascending: false })
          .limit(episodeLimit),
      )
    }
    if (!epQ.error && !(epQ.data || []).length) {
      const legacy = await supabase
        .from('episodes')
        .select(EPISODE_LIGHT_COLUMNS)
        .eq('ticker', symbol)
        .order('started_at', { ascending: false })
        .limit(episodeLimit)
      if (!legacy.error && (legacy.data || []).length) epQ = legacy
    }
    const epErr = epQ.error
    const epRows = epQ.data
    if (epErr) {
      console.warn('[momentum persist] load episodes failed:', epErr.message)
      return { ...empty, available: false, error: epErr.message }
    }
    const episodes = (epRows || []).map(memoryEpisodeFromRow).filter(Boolean)
    let evQ = await supabase
      .from('episodes_events')
      .select(EVENT_LIGHT_COLUMNS)
      .eq('ticker', symbol)
      .order('detected_at', { ascending: false })
      .limit(400)
    if (evQ.error && isMissingColumnError(evQ.error)) {
      evQ = await supabase
        .from('episodes_events')
        .select(EVENT_LIGHT_COLUMNS_NO_RESEARCH_ID)
        .eq('ticker', symbol)
        .order('detected_at', { ascending: false })
        .limit(400)
    }
    if (evQ.error && isMissingColumnError(evQ.error)) {
      evQ = await supabase
        .from('episodes_events')
        .select(
          'id,episode_id,episode_no,ticker,event_type,state,direction,detected_window,detected_at,move_percent,price,reason',
        )
        .eq('ticker', symbol)
        .order('detected_at', { ascending: false })
        .limit(400)
    }
    const evErr = evQ.error
    const evRows = evQ.data
    if (evErr) {
      console.warn('[momentum persist] load events failed:', evErr.message)
      return { episodes, events: [], maxEpisodeNo: maxNo(episodes), available: true }
    }
    const events = (evRows || []).map(memoryEventFromRow).filter(Boolean)
    // Max episode_no for THIS ticker only (per-ticker #001, #002, …)
    let maxRes = await fromEpisodeTable(supabase, symbol, null, (q) =>
      q
        .select('episode_no')
        .eq('ticker', symbol)
        .order('episode_no', { ascending: false })
        .limit(1)
        .maybeSingle(),
    )
    if (!maxRes.data) {
      const legacyMax = await supabase
        .from('episodes')
        .select('episode_no')
        .eq('ticker', symbol)
        .order('episode_no', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (legacyMax.data) maxRes = legacyMax
    }
    const maxRow = maxRes.data
    return {
      episodes,
      events,
      maxEpisodeNo: Math.max(maxNo(episodes), Number(maxRow?.episode_no) || 0),
      available: true,
    }
  } catch (err) {
    console.warn(
      '[momentum persist] load failed:',
      err instanceof Error ? err.message : err,
    )
    return { ...empty, available: false }
  }
}

function maxNo(episodes) {
  let n = 0
  for (const ep of episodes || []) {
    const v = Number(ep.episodeNo)
    if (Number.isFinite(v) && v > n) n = v
  }
  return n
}

/** Filter hydrated timeline: no RESEARCH_RUNNING if DONE/error exists for episode. */
function dropStaleResearchRunning(events) {
  if (!events?.length) return events || []
  const doneIds = new Set()
  let anyDone = false
  for (const ev of events) {
    const type = String(ev?.eventType || '')
    const st = String(ev?.research?.status || '').toLowerCase()
    if (
      type === 'MOMENTUM_RESEARCH_DONE' ||
      st === 'done' ||
      st === 'error'
    ) {
      anyDone = true
      if (ev.episodeId) doneIds.add(String(ev.episodeId))
    }
  }
  if (!anyDone) return events
  return events.filter((ev) => {
    const type = String(ev?.eventType || '')
    const st = String(ev?.research?.status || '').toLowerCase()
    const running =
      type === 'MOMENTUM_RESEARCH_RUNNING' || st === 'running'
    if (!running) return true
    const eid = ev?.episodeId ? String(ev.episodeId) : ''
    if (eid && doneIds.has(eid)) return false
    if (!eid && anyDone) return false
    return true
  })
}

/**
 * Only the newest ACTIVE row stays live. Older rows left ACTIVE in Supabase
 * (ends that never archived) are shown as ENDED on the rail.
 * Input is newest-first (started_at desc).
 */
function normalizeHistoryEpisodes(episodes) {
  let keptActive = false
  return (episodes || []).map((ep) => {
    if (!ep) return ep
    const st = String(ep.status || '').toUpperCase()
    if (st !== 'ACTIVE') return ep
    if (!keptActive) {
      keptActive = true
      return ep
    }
    return {
      ...ep,
      status: 'ENDED',
      endReason: ep.endReason || 'SUPERSEDED',
      endedAt: ep.endedAt || ep.episodeStartedAt || null,
    }
  })
}

/**
 * Operator edit: merge fields onto an episode (memory + Supabase) and optionally
 * patch timeline events by supabase row id or (eventType + detectedAt).
 *
 * @param {string} ticker
 * @param {string} episodeId
 * @param {Record<string, unknown>} patch
 * @param {Array<Record<string, unknown>>} [eventPatches]
 * @returns {Promise<{ ok: boolean, error?: string, episode?: object, eventsUpdated?: number }>}
 */
export async function applyEpisodeEdit(ticker, episodeId, patch = {}, eventPatches = []) {
  const key = store.normalizeMomentumTicker(ticker)
  const eid = String(episodeId || '').trim()
  if (!key || !eid) {
    return { ok: false, error: 'ticker and episodeId required' }
  }

  // Resolve base episode: live active → history → Supabase
  let base = null
  const live = store.getActiveEpisode(key)
  if (live && String(live.episodeId || '') === eid) {
    base = { ...live }
  } else {
    base =
      store.listHistoryEpisodes(key, 80).find(
        (ep) => String(ep?.episodeId || '') === eid,
      ) || null
  }
  if (!base) {
    const supabase = getSupabaseOrNull()
    if (supabase) {
      const { data, error } = await fromEpisodeTable(
        supabase,
        key,
        null,
        (q) =>
          q.select('*').eq('ticker', key).eq('episode_id', eid).maybeSingle(),
      )
      if (!error && data) base = memoryEpisodeFromRow(data)
      if (!base) {
        const legacy = await supabase
          .from('episodes')
          .select('*')
          .eq('ticker', key)
          .eq('episode_id', eid)
          .maybeSingle()
        if (!legacy.error && legacy.data) base = memoryEpisodeFromRow(legacy.data)
      }
    }
  }
  if (!base) {
    return { ok: false, error: 'Episode not found' }
  }

  const p = patch && typeof patch === 'object' ? patch : {}
  const numOr = (v, fallback) => {
    if (v === '' || v === undefined || v === null) return fallback
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const strOr = (v, fallback) => {
    if (v === undefined) return fallback
    if (v === null || v === '') return null
    return String(v)
  }
  const isoOr = (v, fallback) => {
    if (v === undefined) return fallback
    if (v === null || v === '') return null
    return iso(v) || fallback
  }

  const direction =
    p.direction !== undefined
      ? String(p.direction).toUpperCase() === 'DOWN'
        ? 'DOWN'
        : 'UP'
      : base.direction === 'DOWN'
        ? 'DOWN'
        : 'UP'

  const status = strOr(p.status, base.status) || 'ACTIVE'
  const state = strOr(p.state, base.state)
  const detectedWindow =
    strOr(p.detectedWindow ?? p.windowType, base.detectedWindow) ||
    base.detectedWindow

  /** @type {Record<string, unknown>} */
  const next = {
    ...base,
    ticker: key,
    episodeId: eid,
    direction,
    status: String(status).toUpperCase(),
    state: state != null ? String(state).toUpperCase() : state,
    detectedWindow,
    windowType: detectedWindow,
    episodeStartedAt:
      isoOr(p.episodeStartedAt ?? p.startedAt, base.episodeStartedAt) ||
      base.episodeStartedAt,
    endedAt: isoOr(p.endedAt, base.endedAt),
    endReason: strOr(p.endReason, base.endReason),
    referencePrice: numOr(p.referencePrice, base.referencePrice),
    referenceTime: isoOr(p.referenceTime, base.referenceTime),
    triggerPrice: numOr(p.triggerPrice, base.triggerPrice),
    triggerTime: isoOr(p.triggerTime, base.triggerTime),
    currentPrice: numOr(p.currentPrice, base.currentPrice),
    currentTime: isoOr(p.currentTime, base.currentTime) || new Date().toISOString(),
    peakPrice: numOr(p.peakPrice, base.peakPrice),
    peakTime: isoOr(p.peakTime, base.peakTime),
    troughPrice: numOr(p.troughPrice, base.troughPrice),
    troughTime: isoOr(p.troughTime, base.troughTime),
    initialMovePercent: numOr(
      p.initialMovePercent ?? p.triggerMovePct,
      base.initialMovePercent,
    ),
    triggerMovePct: numOr(
      p.triggerMovePct ?? p.initialMovePercent,
      base.triggerMovePct ?? base.initialMovePercent,
    ),
    peakMovePercent: numOr(p.peakMovePercent, base.peakMovePercent),
    currentMovePercent: numOr(p.currentMovePercent, base.currentMovePercent),
    lastNotifiedEpisodeMovePct: numOr(
      p.lastNotifiedEpisodeMovePct,
      base.lastNotifiedEpisodeMovePct,
    ),
    lastAlertMovePercent: numOr(
      p.lastAlertMovePercent,
      base.lastAlertMovePercent,
    ),
    lastAlertAt: isoOr(p.lastAlertAt, base.lastAlertAt),
    lastMaterialProgressAt: isoOr(
      p.lastMaterialProgressAt ?? p.lastMaterialMomentumAt,
      base.lastMaterialProgressAt ?? base.lastMaterialMomentumAt,
    ),
    lastMaterialMomentumAt: isoOr(
      p.lastMaterialMomentumAt ?? p.lastMaterialProgressAt,
      base.lastMaterialMomentumAt ?? base.lastMaterialProgressAt,
    ),
    inactivityEligibleMs: numOr(
      p.inactivityEligibleMs,
      base.inactivityEligibleMs,
    ),
    meaningfulExtremeMovePct: numOr(
      p.meaningfulExtremeMovePct,
      base.meaningfulExtremeMovePct,
    ),
    exactMinutes: numOr(p.exactMinutes, base.exactMinutes),
    exactLabel: strOr(p.exactLabel, base.exactLabel),
    windowMinutes: numOr(p.windowMinutes, base.windowMinutes),
    lastNotifiedPrice: numOr(p.lastNotifiedPrice, base.lastNotifiedPrice),
    lastNotifiedTime: isoOr(p.lastNotifiedTime, base.lastNotifiedTime),
  }

  // Terminal statuses should clear active; ACTIVE claims the slot
  const st = String(next.status || '').toUpperCase()
  const isTerminal = ['EXPIRED', 'ENDED', 'REVERSED', 'CLOSED_AT_MARKET_CLOSE'].includes(
    st,
  )
  if (isTerminal && !next.endedAt) {
    next.endedAt = new Date().toISOString()
  }
  if (!isTerminal) {
    next.endedAt = next.endedAt && st === 'ACTIVE' ? null : next.endedAt
    if (st === 'ACTIVE') {
      next.endedAt = null
      next.endReason = null
    }
  }

  // Memory: active slot
  const liveNow = store.getActiveEpisode(key)
  if (st === 'ACTIVE') {
    store.setActiveEpisode(key, next)
  } else if (liveNow && String(liveNow.episodeId || '') === eid) {
    store.setActiveEpisode(key, null)
  }
  store.upsertHistoryEpisode(key, next)

  // Persist episode
  const no = await upsertEpisode(next)
  if (no != null) next.episodeNo = no

  // Patch timeline events
  let eventsUpdated = 0
  const patches = Array.isArray(eventPatches) ? eventPatches : []
  if (patches.length) {
    const supabase = getSupabaseOrNull()
    const memEvents = store.listEvents(key, 400)
    for (const epatch of patches) {
      if (!epatch || typeof epatch !== 'object') continue
      const rowId = String(epatch.id || epatch.supabaseId || '').trim()
      const oldDetectedAt = iso(epatch.originalDetectedAt || epatch.detectedAt)
      const newDetectedAt = iso(epatch.detectedAt) || oldDetectedAt
      const eventType = String(
        epatch.eventType || epatch.event_type || 'MOMENTUM_STATE',
      )

      // Update memory event
      const memIdx = memEvents.findIndex((ev) => {
        if (rowId && String(ev?.supabasePersist?.id || '') === rowId) return true
        if (
          String(ev?.episodeId || '') === eid &&
          String(ev?.eventType || '') === eventType &&
          iso(ev?.detectedAt) === oldDetectedAt
        ) {
          return true
        }
        return false
      })
      if (memIdx >= 0) {
        const prev = memEvents[memIdx]
        memEvents[memIdx] = {
          ...prev,
          eventType,
          state: epatch.state !== undefined ? epatch.state : prev.state,
          direction:
            epatch.direction !== undefined
              ? String(epatch.direction).toUpperCase() === 'DOWN'
                ? 'DOWN'
                : 'UP'
              : prev.direction,
          detectedAt: newDetectedAt || prev.detectedAt,
          movePercent:
            epatch.movePercent !== undefined
              ? num(epatch.movePercent)
              : prev.movePercent,
          price: epatch.price !== undefined ? num(epatch.price) : prev.price,
          reason: epatch.reason !== undefined ? epatch.reason : prev.reason,
          detectedWindow:
            epatch.detectedWindow !== undefined
              ? epatch.detectedWindow
              : prev.detectedWindow,
          referencePrice:
            epatch.referencePrice !== undefined
              ? num(epatch.referencePrice)
              : prev.referencePrice,
          referenceTime:
            epatch.referenceTime !== undefined
              ? iso(epatch.referenceTime)
              : prev.referenceTime,
        }
        eventsUpdated += 1
      }

      if (!supabase) continue

      /** @type {Record<string, unknown>} */
      const update = {
        updated_at: new Date().toISOString(),
      }
      if (epatch.eventType !== undefined) update.event_type = eventType
      if (epatch.state !== undefined) update.state = epatch.state
      if (epatch.direction !== undefined) {
        update.direction =
          String(epatch.direction).toUpperCase() === 'DOWN' ? 'DOWN' : 'UP'
      }
      if (epatch.detectedAt !== undefined) update.detected_at = newDetectedAt
      if (epatch.movePercent !== undefined) {
        update.move_percent = num(epatch.movePercent)
      }
      if (epatch.price !== undefined) update.price = num(epatch.price)
      if (epatch.reason !== undefined) update.reason = epatch.reason
      if (epatch.detectedWindow !== undefined) {
        update.detected_window = epatch.detectedWindow
      }

      let q = supabase.from('episodes_events').update(update)
      if (rowId) {
        q = q.eq('id', rowId)
      } else {
        q = q
          .eq('ticker', key)
          .eq('episode_id', eid)
          .eq('event_type', eventType)
          .eq('detected_at', oldDetectedAt)
      }
      const { error } = await q
      if (error) {
        console.warn('[momentum persist] event patch failed:', error.message)
      } else if (memIdx < 0) {
        eventsUpdated += 1
      }
    }
    // Write back memory events (preserve order by replacing matching)
    store.replaceEvents(key, memEvents)
  }

  store.pushLog(
    key,
    'info',
    `Episode edited · ${eid} · status=${next.status} · state=${next.state || '—'} · events≈${eventsUpdated}`,
    'api',
    { episodeId: eid, status: next.status, state: next.state, eventsUpdated },
  )

  return { ok: true, episode: next, eventsUpdated }
}

function isTerminalTimelineEvent(ev) {
  if (!ev) return false
  const type = String(ev.eventType || ev.event_type || '').toUpperCase()
  const reason = String(ev.reason || '').toUpperCase()
  const state = String(ev.state || '').toUpperCase()
  if (type === 'MOMENTUM_ENDED' || type.endsWith('_ENDED')) return true
  if (type === 'MOMENTUM_REVERSED' || type.endsWith('_REVERSED')) return true
  if (state === 'EXPIRED' || state === 'ENDED' || state === 'REVERSAL') return true
  if (
    reason === 'EXPIRED' ||
    reason === 'MARKET_CLOSE' ||
    reason === 'MARKET_FULL_CLOSE' ||
    reason === 'NO_MATERIAL_MOMENTUM_3H' ||
    reason === 'MANUAL' ||
    reason === 'USER_EXIT' ||
    reason === 'REVERSAL' ||
    reason === 'WINDOW_OUT_OF_SCOPE'
  ) {
    // Only if it is an end-style row, not a random state with MANUAL reason
    if (type.includes('ENDED') || type.includes('REVERS') || type === 'MOMENTUM_ENDED') {
      return true
    }
  }
  return false
}

/**
 * If an end/reversal timeline row is removed, reopen the episode:
 * status ACTIVE, clear endedAt / endReason (end is the event itself).
 * @param {string} key
 * @param {string} episodeId
 * @returns {Promise<object|null>} updated episode or null
 */
async function reopenEpisodeAfterEndEventDeleted(key, episodeId) {
  const eid = String(episodeId || '').trim()
  if (!key || !eid) return null

  let base = null
  const live = store.getActiveEpisode(key)
  if (live && String(live.episodeId || '') === eid) base = { ...live }
  if (!base) {
    base =
      store.listHistoryEpisodes(key, 80).find(
        (ep) => String(ep?.episodeId || '') === eid,
      ) || null
  }
  if (!base) {
    const supabase = getSupabaseOrNull()
    if (supabase) {
      const { data } = await fromEpisodeTable(supabase, key, null, (q) =>
        q.select('*').eq('ticker', key).eq('episode_id', eid).maybeSingle(),
      )
      if (data) base = memoryEpisodeFromRow(data)
      if (!base) {
        const legacy = await supabase
          .from('episodes')
          .select('*')
          .eq('ticker', key)
          .eq('episode_id', eid)
          .maybeSingle()
        if (legacy.data) base = memoryEpisodeFromRow(legacy.data)
      }
    }
  }
  if (!base) return null

  // Pick last non-terminal state from remaining timeline
  const remaining = store
    .listEvents(key, 400)
    .filter((ev) => String(ev?.episodeId || '') === eid)
    .sort(
      (a, b) =>
        (Date.parse(String(b.detectedAt || '')) || 0) -
        (Date.parse(String(a.detectedAt || '')) || 0),
    )
  let liveState = 'HOLDING'
  for (const ev of remaining) {
    if (isTerminalTimelineEvent(ev)) continue
    const st = String(ev.state || '').toUpperCase()
    if (
      st &&
      st !== 'EXPIRED' &&
      st !== 'ENDED' &&
      st !== 'REVERSAL'
    ) {
      liveState = st
      break
    }
    if (
      String(ev.eventType || '').includes('ACCELERAT') ||
      String(ev.eventType || '').includes('STARTED')
    ) {
      liveState = String(ev.eventType || '').includes('STARTED')
        ? 'HOLDING'
        : 'ACCELERATING'
      break
    }
  }

  const next = {
    ...base,
    ticker: key,
    episodeId: eid,
    status: 'ACTIVE',
    state: liveState,
    endedAt: null,
    endReason: null,
    currentTime: new Date().toISOString(),
  }

  // Only one ACTIVE per ticker
  const currentLive = store.getActiveEpisode(key)
  if (
    currentLive &&
    String(currentLive.episodeId || '') !== eid &&
    String(currentLive.status || '').toUpperCase() === 'ACTIVE'
  ) {
    // Keep existing live episode; store this as history ACTIVE is invalid — mark history as ACTIVE but don't steal slot
    // Operator deleted end on a past episode while another is live: still clear end fields in history.
    store.upsertHistoryEpisode(key, next)
    await upsertEpisode(next)
    store.pushLog(
      key,
      'info',
      `End event removed · episode ${eid} reopened in history (another ACTIVE episode is live)`,
      'api',
      { episodeId: eid, state: liveState },
    )
    return next
  }

  store.setActiveEpisode(key, next)
  store.upsertHistoryEpisode(key, next)
  await upsertEpisode(next)
  store.pushLog(
    key,
    'info',
    `End event removed · episode ${eid} reopened (ACTIVE · ${liveState}) · endReason cleared`,
    'api',
    { episodeId: eid, state: liveState },
  )
  return next
}

/**
 * Delete one timeline event completely (memory + Supabase).
 * Match by supabase row id, or (episodeId + eventType + detectedAt).
 * If the deleted row was an END / REVERSAL close line, the episode is reopened
 * (status ACTIVE, endedAt + endReason cleared).
 *
 * @param {string} ticker
 * @param {{
 *   episodeId?: string,
 *   id?: string,
 *   eventType?: string,
 *   detectedAt?: string,
 * }} opts
 * @returns {Promise<{ ok: boolean, error?: string, deleted?: number, episodeReopened?: boolean, episode?: object }>}
 */
export async function deleteEpisodeEvent(ticker, opts = {}) {
  const key = store.normalizeMomentumTicker(ticker)
  if (!key) return { ok: false, error: 'ticker required' }

  const rowId = String(opts.id || opts.supabaseId || '').trim()
  const episodeId = String(opts.episodeId || opts.episode_id || '').trim()
  const eventType = String(opts.eventType || opts.event_type || '').trim()
  const detectedAt = iso(opts.detectedAt || opts.detected_at)

  if (!rowId && !(episodeId && eventType && detectedAt)) {
    return {
      ok: false,
      error: 'Provide event id, or episodeId + eventType + detectedAt',
    }
  }

  // Snapshot the event before delete (for end-event cascade)
  const beforeList = store.listEvents(key, 400)
  const matched = beforeList.find((ev) => {
    if (rowId && String(ev?.supabasePersist?.id || '') === rowId) return true
    if (
      episodeId &&
      eventType &&
      detectedAt &&
      String(ev?.episodeId || '') === episodeId &&
      String(ev?.eventType || '') === eventType &&
      iso(ev?.detectedAt) === detectedAt
    ) {
      return true
    }
    return false
  })
  const wasTerminal = isTerminalTimelineEvent(matched)
  const eidForReopen =
    episodeId ||
    String(matched?.episodeId || opts.episodeId || '').trim()

  // Memory first
  const removedMem = store.removeEvents(key, (ev) => {
    if (rowId && String(ev?.supabasePersist?.id || '') === rowId) return true
    if (
      episodeId &&
      eventType &&
      detectedAt &&
      String(ev?.episodeId || '') === episodeId &&
      String(ev?.eventType || '') === eventType &&
      iso(ev?.detectedAt) === detectedAt
    ) {
      return true
    }
    return false
  })

  const supabase = getSupabaseOrNull()
  let deleted = removedMem
  if (supabase) {
    let q = supabase.from('episodes_events').delete({ count: 'exact' })
    if (rowId) {
      q = q.eq('id', rowId)
    } else {
      q = q
        .eq('ticker', key)
        .eq('episode_id', episodeId)
        .eq('event_type', eventType)
        .eq('detected_at', detectedAt)
    }
    const { error, count } = await q
    if (error) {
      console.warn('[momentum persist] delete event failed:', error.message)
      return { ok: false, error: error.message, deleted: removedMem }
    }
    deleted = Math.max(count || 0, removedMem)
  } else if (!removedMem) {
    return { ok: false, error: 'Supabase not configured and event not in memory' }
  }

  if (!deleted) {
    return { ok: false, error: 'Event not found', deleted: 0 }
  }

  let episodeReopened = false
  let episode = null
  // Also treat explicit end types when memory miss but client sent type
  const typeLooksTerminal =
    wasTerminal ||
    /ENDED|REVERS/i.test(eventType) ||
    String(matched?.reason || opts.reason || '').toUpperCase() === 'MARKET_CLOSE'

  if (typeLooksTerminal && eidForReopen) {
    episode = await reopenEpisodeAfterEndEventDeleted(key, eidForReopen)
    episodeReopened = Boolean(episode)
  }

  store.pushLog(
    key,
    'warn',
    `Timeline event deleted · ${eventType || rowId} · rows=${deleted}` +
      (episodeReopened ? ' · episode reopened (end cleared)' : ''),
    'api',
    {
      episodeId: eidForReopen || null,
      eventType,
      detectedAt,
      id: rowId || null,
      deleted,
      episodeReopened,
    },
  )
  return {
    ok: true,
    deleted,
    memoryOnly: !supabase,
    episodeReopened,
    episode,
  }
}

/**
 * Permanently delete one episode + its timeline events from Supabase.
 * Also clears in-memory active/history if they match.
 * @param {string} ticker
 * @param {string} episodeId
 * @returns {Promise<{ ok: boolean, error?: string, deletedEvents?: number }>}
 */
export async function deleteEpisodeFromSupabase(ticker, episodeId) {
  const supabase = getSupabaseOrNull()
  const key = store.normalizeMomentumTicker(ticker)
  const eid = String(episodeId || '').trim()
  if (!key || !eid) {
    return { ok: false, error: 'ticker and episodeId required' }
  }
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured' }
  }
  store.invalidateHydration(key)

  try {
    // Events first (no FK required, but cleaner)
    const { error: evErr, count: evCount } = await supabase
      .from('episodes_events')
      .delete({ count: 'exact' })
      .eq('ticker', key)
      .eq('episode_id', eid)
    if (evErr) {
      console.warn('[momentum persist] delete events failed:', evErr.message)
      return { ok: false, error: evErr.message }
    }

    const classDel = await fromEpisodeTable(supabase, key, null, (q) =>
      q.delete({ count: 'exact' }).eq('ticker', key).eq('episode_id', eid),
    )
    const { error: epErr, count: classCount } = classDel
    const legacyDel = await supabase
      .from('episodes')
      .delete({ count: 'exact' })
      .eq('ticker', key)
      .eq('episode_id', eid)
    const epCount = (classCount || 0) + (legacyDel.count || 0)
    if (epErr) {
      console.warn('[momentum persist] delete episode failed:', epErr.message)
      return { ok: false, error: epErr.message }
    }

    if (!epCount) {
      return {
        ok: false,
        error: 'Episode not found in Supabase',
        deletedEvents: evCount || 0,
      }
    }

    // Clear live engine state if this was the active episode
    const live = store.getActiveEpisode(key)
    if (live && String(live.episodeId || '') === eid) {
      store.setActiveEpisode(key, null)
      store.markRestartGate(key, eid)
    }

    // Drop from in-memory history / events immediately
    store.removeEvents(key, (ev) => String(ev?.episodeId || '') === eid)
    const remaining = store
      .listHistoryEpisodes(key, 80)
      .filter((ep) => String(ep?.episodeId || '') !== eid)
    store.setHistoryEpisodes(key, remaining)

    store.pushLog(
      key,
      'warn',
      `Episode deleted from Supabase · ${eid} · events removed=${evCount || 0}`,
      'api',
      { episodeId: eid, deletedEvents: evCount || 0 },
    )

    return { ok: true, deletedEvents: evCount || 0, episodeId: eid }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[momentum persist] delete episode error:', msg)
    return { ok: false, error: msg }
  }
}

/**
 * Episodes rail is Supabase-only — every call reloads and replaces memory.
 * Never merges live engine cache into history (deleted DB rows stay gone).
 * @param {string} ticker
 * @param {{ digests?: boolean }} [opts]
 */
export async function refreshEpisodesFromSupabase(ticker, opts = {}) {
  const key = store.normalizeMomentumTicker(ticker)
  if (!key) return { ok: false, reason: 'ticker required' }
  // Automatic TTL hydrate removed — callers must pass force:true
  // (boot / wake / manual / UI refresh=1 only).
  const force = Boolean(opts.force)
  if (!force) {
    return { ok: true, skipped: true, reason: 'no-auto-hydrate', available: true }
  }

  const hist = await loadTickerHistory(key)
  if (!hist.available) {
    // No silent cache fallback: empty rail if Supabase is down / misconfigured.
    store.setHistoryEpisodes(key, [])
    store.replaceEvents(key, [])
    return { ok: false, reason: hist.error || 'supabase unavailable', available: false }
  }

  if (hist.maxEpisodeNo) store.noteEpisodeNo(key, hist.maxEpisodeNo)
  const episodes = normalizeHistoryEpisodes(
    (hist.episodes || []).map((ep) => ensureEpisodeExactSpan(ep)),
  )
  store.setHistoryEpisodes(key, episodes)
  // Full replace — do not merge with pushEvent ring buffer
  store.replaceEvents(key, dropStaleResearchRunning(hist.events || []))

  // Engine active slot: only seed from DB if memory has none
  if (!store.getActiveEpisode(key)) {
    const live = episodes.find(
      (ep) => String(ep?.status || '').toUpperCase() === 'ACTIVE',
    )
    if (live) store.setActiveEpisode(key, live)
  }

  store.markHydrated(key)

  if (opts.digests === true) {
    void import('./dailyDigest.js')
      .then((m) => m.hydrateDigests(key))
      .catch(() => {})
  }

  return {
    ok: true,
    available: true,
    episodeCount: episodes.length,
    eventCount: (hist.events || []).length,
    maxEpisodeNo: hist.maxEpisodeNo || 0,
  }
}

/** Hydrate ticker history from Supabase unless TTL still fresh. */
export async function hydrateTicker(ticker, opts = {}) {
  return refreshEpisodesFromSupabase(ticker, opts)
}

const RESEARCH_UNIFIED_SELECT =
  'id,episode_id,ticker,asset_class,likely_driver,secondary_driver,alert,model_version,citations,cost_usd,cost_usd_display,created_at'

/** Heavy research row — only for detail views. */
export async function loadResearchById(researchId) {
  const supabase = getSupabaseOrNull()
  const id = String(researchId || '').trim()
  if (!supabase || !id) return null
  const unified = await supabase
    .from('research')
    .select(RESEARCH_UNIFIED_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (!unified.error && unified.data) return unified.data
  return null
}

export async function loadResearchByEpisodeId(episodeId) {
  const supabase = getSupabaseOrNull()
  const eid = String(episodeId || '').trim()
  if (!supabase || !eid) return []
  const { data, error } = await supabase
    .from('research')
    .select(
      'id,episode_id,ticker,asset_class,likely_driver,secondary_driver,alert,model_version,citations,cost_usd,cost_usd_display,created_at',
    )
    .eq('episode_id', eid)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return []
  return data || []
}

/**
 * Upsert global rolling-return thresholds (id = 'global').
 * @param {Record<string, number|null>} thresholdsMap
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function saveThresholdsToSupabase(thresholdsMap) {
  const supabase = getSupabaseOrNull()
  if (!supabase) return { ok: false, error: 'Supabase not configured' }
  try {
    const { error } = await supabase.from('thresholds').upsert(
      {
        id: 'global',
        thresholds: thresholdsMap && typeof thresholdsMap === 'object' ? thresholdsMap : {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    if (error) {
      console.warn('[momentum persist] thresholds upsert failed:', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[momentum persist] thresholds upsert error:', msg)
    return { ok: false, error: msg }
  }
}

/**
 * Load global thresholds from Supabase.
 * @returns {Promise<Record<string, number|null>|null>}
 */
export async function loadThresholdsFromSupabase() {
  const supabase = getSupabaseOrNull()
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('thresholds')
      .select('thresholds, updated_at')
      .eq('id', 'global')
      .maybeSingle()
    if (error) {
      // Table may not exist yet — quiet warn
      console.warn('[momentum persist] thresholds load failed:', error.message)
      return null
    }
    const map = data?.thresholds
    if (!map || typeof map !== 'object') return null
    return map
  } catch (err) {
    console.warn(
      '[momentum persist] thresholds load error:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * Upsert global episode policy (accel / giveback / inactivity / …).
 * @param {Record<string, unknown>} policyMap
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function saveEpisodePolicyToSupabase(policyMap) {
  const supabase = getSupabaseOrNull()
  if (!supabase) return { ok: false, error: 'Supabase not configured' }
  try {
    const { error } = await supabase.from('momentum_episode_policy').upsert(
      {
        id: 'global',
        policy: policyMap && typeof policyMap === 'object' ? policyMap : {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    if (error) {
      console.warn(
        '[momentum persist] episode policy upsert failed:',
        error.message,
      )
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[momentum persist] episode policy upsert error:', msg)
    return { ok: false, error: msg }
  }
}

/**
 * Load global episode policy from Supabase.
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function loadEpisodePolicyFromSupabase() {
  const supabase = getSupabaseOrNull()
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('momentum_episode_policy')
      .select('policy, updated_at')
      .eq('id', 'global')
      .maybeSingle()
    if (error) {
      console.warn(
        '[momentum persist] episode policy load failed:',
        error.message,
      )
      return null
    }
    const map = data?.policy
    if (!map || typeof map !== 'object') return null
    return map
  } catch (err) {
    console.warn(
      '[momentum persist] episode policy load error:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
