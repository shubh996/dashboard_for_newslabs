/** 9AM preference keys. Falls back to legacy `newslabs-*` keys once. */

function names(key: string) {
  return [`9am-${key}`, `newslabs-${key}`] as const
}

export function readPref(key: string): string | null {
  if (typeof window === 'undefined') return null
  const [current, legacy] = names(key)
  return window.localStorage.getItem(current) ?? window.localStorage.getItem(legacy)
}

export function writePref(key: string, value: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(`9am-${key}`, value)
}
