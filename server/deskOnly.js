/**
 * Momentum desk-only mode.
 * When MOMENTUM_DESK_ONLY=1, block news / 9AM / Studio / Trigger-scrape /
 * EDGAR / heavy Yahoo snapshot routes. Keep original Momentum desk APIs.
 */

export function isDeskOnlyMode() {
  const v = String(process.env.MOMENTUM_DESK_ONLY || '')
    .trim()
    .toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

/**
 * @param {string} method
 * @param {string} pathname
 */
export function isDeskOnlyAllowedPath(method, pathname) {
  const m = String(method || 'GET').toUpperCase()
  const p = String(pathname || '').split('?')[0] || '/'

  // Always allow health / root probes
  if (p === '/api/health' || p === '/health' || p === '/') return true

  // Original Momentum desk — full surface
  if (p === '/api/momentum' || p.startsWith('/api/momentum/')) return true

  // Desk helpers (Supabase deep-link to episode row)
  if (p === '/api/desk/supabase-episode-link') return m === 'GET'

  // Yahoo — Episode desk + Trigger extremes
  if (p === '/api/yahoo/quotes') return m === 'GET'
  if (p === '/api/yahoo/search') return m === 'GET'
  if (p === '/api/yahoo/extreme-movers') return m === 'GET'
  if (p === '/api/yahoo/market-lists' || p === '/api/yahoo/most-actives') return m === 'GET'
  if (/^\/api\/yahoo\/[^/]+\/quote$/.test(p)) return m === 'GET'
  if (/^\/api\/yahoo\/[^/]+\/chart$/.test(p)) return m === 'GET'
  if (/^\/api\/yahoo\/[^/]+\/profile$/.test(p)) return m === 'GET'
  // Share-card / desk logos (Peak · So Far image preview)
  if (/^\/api\/yahoo\/[^/]+\/logo$/.test(p)) return m === 'GET'

  // Notifications — Episode desk + Trigger extremes/share/scrape desk
  if (p.startsWith('/api/notifications/')) return true

  return false
}

export function deskOnlyBlockedPayload(pathname) {
  return {
    ok: false,
    error: 'MOMENTUM_DESK_ONLY=1 — this API is disabled. Only the original Momentum desk is active.',
    deskOnly: true,
    path: pathname,
  }
}
