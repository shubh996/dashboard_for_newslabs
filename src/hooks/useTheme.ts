import { useEffect, useState } from 'react'
import { readPref, writePref } from '@/lib/prefs'

export type ThemeMode = 'light' | 'dark'

/**
 * Light/dark theme with persistence via `9am-theme` (same key as App.tsx).
 * Applies the `dark` class on <html> so Tailwind `dark:` variants work.
 */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    readPref('theme') === 'dark' ? 'dark' : 'light',
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    writePref('theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  return { theme, setTheme, toggleTheme } as const
}
