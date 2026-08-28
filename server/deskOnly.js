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

  // Yahoo — only live quote/chart/search the desk needs (not full module dumps)
  if (p === '/api/yahoo/quotes') return m === 'GET'
  if (p === '/api/yahoo/search') return m === 'GET'
  if (/^\/api\/yahoo\/[^/]+\/quote$/.test(p)) return m === 'GET'
  if (/^\/api\/yahoo\/[^/]+\/chart$/.test(p)) return m === 'GET'
  if (/^\/api\/yahoo\/[^/]+\/profile$/.test(p)) return m === 'GET'

  // Notifications — only pieces the Momentum desk uses
  if (p.startsWith('/api/notifications/devices')) return true
  if (p.startsWith('/api/notifications/usage/perplexity')) return m === 'GET'
  if (p.startsWith('/api/notifications/momentum-research')) return true
  if (p === '/api/notifications/alert-news') return m === 'POST'
  if (p === '/api/notifications/test-mode' || p.startsWith('/api/notifications/test-mode')) {
    return true
  }

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
