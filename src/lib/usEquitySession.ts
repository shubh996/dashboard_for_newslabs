/**
 * US equity session + Trigger weekend window (UI).
 *
 * Canonical clock: America/New_York. Never add a fixed “ET + 5 = London”
 * offset — DST change dates differ, so London is sometimes only 4h ahead.
 * Keep in sync with server/momentum/usEquitySession.js.
 */

export const ET_ZONE = 'America/New_York'
export const UK_ZONE = 'Europe/London'

export const US_EQUITY_MIN = {
  overnightStart: 20 * 60,
  preStart: 4 * 60,
  rthStart: 9 * 60 + 30,
  rthEnd: 16 * 60,
  ahEnd: 20 * 60,
} as const

export type UsEquitySessionId =
  | 'overnight'
  | 'pre-market'
  | 'regular'
  | 'after-hours'
  | 'closed'

export function etPartsAt(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const minute = Number(get('minute')) || 0
  return {
    weekday: get('weekday'),
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute,
    second: Number(get('second')) || 0,
    minutes: hour * 60 + minute,
  }
}

export function etWallToUtcMs(
  y: string,
  mo: string,
  d: string,
  hour: number,
  minute: number,
): number | null {
  let utc = Date.parse(
    `${y}-${mo}-${d}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
  )
  if (!Number.isFinite(utc)) return null
  for (let i = 0; i < 5; i += 1) {
    const p = etPartsAt(utc)
    if (p.year !== y || p.month !== mo || p.day !== d) {
      const want = Date.parse(`${y}-${mo}-${d}T12:00:00.000Z`)
      const got = Date.parse(`${p.year}-${p.month}-${p.day}T12:00:00.000Z`)
      if (Number.isFinite(want) && Number.isFinite(got)) utc += want - got
    }
    const wantMin = hour * 60 + minute
    const gotMin = p.hour * 60 + p.minute
    const adj = (wantMin - gotMin) * 60 * 1000
    if (adj === 0) break
    utc += adj
  }
  return utc
}

/** Yahoo ATS extended window (Sun 20:00 → Fri 20:00 ET) — display / tape only. */
export function isUsEquityTriggerOpen(ms = Date.now()) {
  const { weekday, minutes } = etPartsAt(ms)
  if (weekday === 'Sat') return false
  if (weekday === 'Sun') return minutes >= US_EQUITY_MIN.overnightStart
  if (weekday === 'Fri') return minutes < US_EQUITY_MIN.ahEnd
  return true
}

/** Cash RTH Mon–Fri 09:30–16:00 ET — momentum engine run window for US equities. */
export function isUsEquityRthOpen(ms = Date.now()) {
  const { weekday, minutes } = etPartsAt(ms)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return minutes >= US_EQUITY_MIN.rthStart && minutes < US_EQUITY_MIN.rthEnd
}

export function usEquitySessionId(ms = Date.now()): UsEquitySessionId {
  if (!isUsEquityTriggerOpen(ms)) return 'closed'
  const { minutes } = etPartsAt(ms)
  if (
    minutes >= US_EQUITY_MIN.overnightStart ||
    minutes < US_EQUITY_MIN.preStart
  ) {
    return 'overnight'
  }
  if (minutes < US_EQUITY_MIN.rthStart) return 'pre-market'
  if (minutes < US_EQUITY_MIN.rthEnd) return 'regular'
  return 'after-hours'
}

export function usEquitySessionLabel(id: UsEquitySessionId) {
  if (id === 'overnight') return 'Overnight'
  if (id === 'pre-market') return 'Pre-market'
  if (id === 'regular') return 'Regular'
  if (id === 'after-hours') return 'After-hours'
  return 'Closed'
}

export function usEquitySessionTone(
  id: UsEquitySessionId,
): 'open' | 'pre' | 'post' | 'overnight' | 'closed' {
  if (id === 'regular') return 'open'
  if (id === 'pre-market') return 'pre'
  if (id === 'after-hours') return 'post'
  if (id === 'overnight') return 'overnight'
  return 'closed'
}

export function formatHmInTimeZone(ms: number, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms))
  } catch {
    return '—'
  }
}

/** Convert today’s ET wall-clock into another zone (not a fixed hour offset). */
export function formatEtWallInTimeZone(
  hourEt: number,
  minuteEt: number,
  timeZone: string,
  ms = Date.now(),
) {
  const p = etPartsAt(ms)
  const utc = etWallToUtcMs(p.year, p.month, p.day, hourEt, minuteEt)
  if (utc == null) return '—'
  return formatHmInTimeZone(utc, timeZone)
}

export function usEquitySessionFromEtClock(nowMs = Date.now()) {
  const id = usEquitySessionId(nowMs)
  return {
    id,
    label: usEquitySessionLabel(id),
    tone: usEquitySessionTone(id),
    triggerOpen: isUsEquityTriggerOpen(nowMs),
  }
}
