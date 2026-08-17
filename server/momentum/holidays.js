/**
 * Exchange holiday / early-close calendars.
 * 2026 Nasdaq dates are an acceptance fixture (spec §17) — not the only year.
 * Add years to NASDAQ_CALENDAR without changing evaluation logic.
 */
import { etPartsAt } from './usEquitySession.js'

/** @type {Record<string, { full: string[], earlyClose: Record<string, { hour: number, minute: number }> }>} */
export const NASDAQ_CALENDAR = {
  2026: {
    full: [
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-04-03',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03',
      '2026-09-07',
      '2026-11-26',
      '2026-12-25',
    ],
    earlyClose: {
      '2026-11-27': { hour: 13, minute: 0 },
      '2026-12-24': { hour: 13, minute: 0 },
    },
  },
}

function etDateKey(ms) {
  const p = etPartsAt(ms)
  return `${p.year}-${p.month}-${p.day}`
}

function yearBucket(ms) {
  return NASDAQ_CALENDAR[String(etPartsAt(ms).year)] || null
}

export function nasdaqHolidayOn(ms) {
  const key = etDateKey(ms)
  const year = yearBucket(ms)
  if (!year) return null
  if (year.full.includes(key)) {
    return { kind: 'HOLIDAY', date: key, closeHour: null, closeMinute: null }
  }
  const early = year.earlyClose[key]
  if (early) {
    return {
      kind: 'EARLY_CLOSE',
      date: key,
      closeHour: early.hour,
      closeMinute: early.minute,
    }
  }
  return null
}

/** Monday holiday also shuts Sunday overnight (Sun 20:00 ET onward). */
export function nasdaqBlocksOvernightPrelude(ms) {
  const p = etPartsAt(ms)
  if (p.weekday !== 'Sun' || p.minutes < 20 * 60) return false
  const nextDay = nasdaqHolidayOn(ms + 12 * 60 * 60 * 1000)
  return Boolean(nextDay && nextDay.kind === 'HOLIDAY')
}
