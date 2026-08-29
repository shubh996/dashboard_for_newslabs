export type TriggerSharePayload = {
  ticker: string
  /** scrape = Firecrawl+Gemini then share; direct = share only; research = Perplexity composer */
  mode: 'scrape' | 'direct' | 'research'
  label?: string
  move?: number | null
  /** End / peak (or live) price for share-card “share price” under the %. */
  price?: number | string | null
  /** Start / reference price — shown as from → to with `price`. */
  priceFrom?: number | string | null
  window?: string | null
  /** Exact peak lookback label e.g. "5 minutes" / "45m". */
  exactLabel?: string | null
  exactMinutes?: number | null
  direction?: string | null
  kind?: string
  /** Alert / share session line */
  headline?: string | null
  /** Likely driver for direct share reason body */
  likelyDriver?: string | null
  /** When the payload was written (ms). Consumer ignores stale entries. */
  createdAt?: number
}

export const TRIGGER_SHARE_PAYLOAD_KEY = 'trigger-share-payload-v1'

/** Cross-tab handoff (sessionStorage is per-tab and breaks window.open). */
export const TRIGGER_SHARE_LOCAL_KEY = 'trigger-share-payload-local-v1'

const PAYLOAD_MAX_AGE_MS = 2 * 60 * 1000

export function writeTriggerSharePayload(payload: TriggerSharePayload) {
  const stamped: TriggerSharePayload = {
    ...payload,
    createdAt: Date.now(),
  }
  const raw = JSON.stringify(stamped)
  try {
    localStorage.setItem(TRIGGER_SHARE_LOCAL_KEY, raw)
  } catch {
    /* private mode / quota */
  }
  try {
    sessionStorage.setItem(TRIGGER_SHARE_PAYLOAD_KEY, raw)
  } catch {
    /* ignore */
  }
}

export function readTriggerSharePayload(
  expectedTicker?: string | null,
): TriggerSharePayload | null {
  const want = String(expectedTicker || '')
    .trim()
    .toUpperCase()
  const tryParse = (raw: string | null): TriggerSharePayload | null => {
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as TriggerSharePayload
      if (!parsed || typeof parsed !== 'object') return null
      const ticker = String(parsed.ticker || '')
        .trim()
        .toUpperCase()
      if (!ticker) return null
      if (want && ticker !== want) return null
      const createdAt = Number(parsed.createdAt) || 0
      if (createdAt > 0 && Date.now() - createdAt > PAYLOAD_MAX_AGE_MS) {
        return null
      }
      return { ...parsed, ticker }
    } catch {
      return null
    }
  }

  let payload: TriggerSharePayload | null = null
  try {
    payload = tryParse(localStorage.getItem(TRIGGER_SHARE_LOCAL_KEY))
    if (payload) localStorage.removeItem(TRIGGER_SHARE_LOCAL_KEY)
  } catch {
    /* ignore */
  }
  if (!payload) {
    try {
      payload = tryParse(sessionStorage.getItem(TRIGGER_SHARE_PAYLOAD_KEY))
      if (payload) sessionStorage.removeItem(TRIGGER_SHARE_PAYLOAD_KEY)
    } catch {
      /* ignore */
    }
  } else {
    try {
      sessionStorage.removeItem(TRIGGER_SHARE_PAYLOAD_KEY)
    } catch {
      /* ignore */
    }
  }
  return payload
}

export function buildTriggerShareUrl(payload: TriggerSharePayload): string {
  const params = new URLSearchParams()
  const ticker = String(payload.ticker || '')
    .trim()
    .toUpperCase()
  params.set('ticker', ticker)
  params.set('share', '1')
  params.set('mode', payload.mode || 'scrape')
  if (payload.kind) params.set('kind', String(payload.kind))
  if (payload.move != null && Number.isFinite(Number(payload.move))) {
    params.set('move', String(Number(payload.move)))
  }
  if (payload.price != null && String(payload.price).trim() !== '') {
    const n = Number(payload.price)
    params.set(
      'price',
      Number.isFinite(n) ? String(n) : String(payload.price).trim(),
    )
  }
  if (payload.priceFrom != null && String(payload.priceFrom).trim() !== '') {
    const n = Number(payload.priceFrom)
    params.set(
      'priceFrom',
      Number.isFinite(n) ? String(n) : String(payload.priceFrom).trim(),
    )
  }
  if (payload.exactLabel) params.set('exactLabel', String(payload.exactLabel))
  if (
    payload.exactMinutes != null &&
    Number.isFinite(Number(payload.exactMinutes))
  ) {
    params.set('exactMinutes', String(Number(payload.exactMinutes)))
  }
  if (payload.label) params.set('label', String(payload.label))
  if (payload.direction) params.set('direction', String(payload.direction))
  return `/trigger?${params.toString()}`
}

/**
 * Open Trigger share/research in a **new tab only**.
 * Never navigates the current desk tab — even if the popup is blocked.
 *
 * Note: `window.open(..., 'noopener')` often returns `null` even when the tab
 * opened successfully, so we must not treat null as “failed → same-tab navigate”.
 */
export function openTriggerShareInNewTab(
  payload: TriggerSharePayload,
): { ok: boolean; url: string; blocked?: boolean } {
  writeTriggerSharePayload(payload)
  const url = buildTriggerShareUrl(payload)
  let abs = url
  try {
    abs = new URL(url, window.location.href).toString()
  } catch {
    /* keep relative */
  }
  try {
    // Avoid feature-string `noopener` so we can detect a real window handle when
    // the browser provides one; still clear opener for isolation.
    const win = window.open(abs, '_blank')
    if (win) {
      try {
        win.opener = null
      } catch {
        /* ignore */
      }
      try {
        win.focus()
      } catch {
        /* ignore */
      }
      return { ok: true, url: abs }
    }
    // null can mean blocked OR noopener-style null; do not touch current tab.
    return { ok: false, url: abs, blocked: true }
  } catch {
    return { ok: false, url: abs, blocked: true }
  }
}
