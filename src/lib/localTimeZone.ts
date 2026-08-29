/**
 * Return the browser's conventional short timezone label for a date.
 *
 * Locale selection matters: en-US renders London summer time as "GMT+1",
 * whereas en-GB renders the more recognisable "BST". India similarly needs
 * en-IN for "IST". Other zones keep Intl's safe short name / GMT offset.
 */
export function timeZoneSuffix(date: Date, requestedTimeZone?: string): string {
  try {
    const timeZone =
      requestedTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!timeZone) return ''
    const locale =
      timeZone === 'Europe/London'
        ? 'en-GB'
        : timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta'
          ? 'en-IN'
          : 'en-US'
    return (
      new Intl.DateTimeFormat(locale, {
        timeZone,
        timeZoneName: 'short',
      })
        .formatToParts(date)
        .find((part) => part.type === 'timeZoneName')
        ?.value.trim() || ''
    )
  } catch {
    if (requestedTimeZone) return requestedTimeZone
    const offsetMinutes = -date.getTimezoneOffset()
    if (offsetMinutes === 0) return 'UTC'
    const sign = offsetMinutes >= 0 ? '+' : '-'
    const absolute = Math.abs(offsetMinutes)
    const hours = Math.floor(absolute / 60)
    const minutes = absolute % 60
    return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`
  }
}

export function localTimeZoneSuffix(date: Date): string {
  return timeZoneSuffix(date)
}

export function withLocalTimeZone(value: string, date: Date): string {
  const suffix = localTimeZoneSuffix(date)
  return suffix ? `${value} ${suffix}` : value
}

type LocalDateTimeInput = Date | string | number

function validLocalDate(value: LocalDateTimeInput): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Format a browser-local date/time and always append its short timezone. */
export function formatLocalDateTimeWithZone(
  value: LocalDateTimeInput,
  options: Intl.DateTimeFormatOptions = {},
  locale = 'en-US',
): string {
  const date = validLocalDate(value)
  if (!date) return '—'
  return withLocalTimeZone(date.toLocaleString(locale, options), date)
}

/** Format a browser-local clock and always append its short timezone. */
export function formatLocalTimeWithZone(
  value: LocalDateTimeInput,
  options: Intl.DateTimeFormatOptions = {},
  locale = 'en-US',
): string {
  const date = validLocalDate(value)
  if (!date) return '—'
  return withLocalTimeZone(date.toLocaleTimeString(locale, options), date)
}
