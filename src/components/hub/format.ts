/** Shared date/time helpers for hub desk UI. */

import { formatLocalDateTimeWithZone } from '@/lib/localTimeZone'

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return formatLocalDateTimeWithZone(d, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
