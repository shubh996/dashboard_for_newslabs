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
    return ''
  }
}

export function localTimeZoneSuffix(date: Date): string {
  return timeZoneSuffix(date)
}

export function withLocalTimeZone(value: string, date: Date): string {
  const suffix = localTimeZoneSuffix(date)
  return suffix ? `${value} ${suffix}` : value
}
