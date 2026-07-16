import { useEffect, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

const initialState: AsyncState<never> = { data: null, loading: true, error: null }

// Module-level, so it survives across navigations for the life of the tab --
// revisiting a ticker you've already opened shows cached data instantly
// instead of re-running the full fetch (slow sections like 13F institutional
// holdings otherwise re-fan-out to SEC on every single visit).
const cache = new Map<string, unknown>()

export function useEdgarSection<T>(key: string, fetcher: () => Promise<T>, errorMessage: string): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>(() =>
    cache.has(key) ? { data: cache.get(key) as T, loading: false, error: null } : initialState,
  )

  useEffect(() => {
    if (cache.has(key)) {
      setState({ data: cache.get(key) as T, loading: false, error: null })
      return
    }

    let cancelled = false
    setState(initialState)

    fetcher()
      .then((data) => {
        cache.set(key, data)
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ data: null, loading: false, error: error instanceof Error ? error.message : errorMessage })
        }
      })

    return () => {
      cancelled = true
    }
  }, [key])

  return state
}
