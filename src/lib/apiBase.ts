/**
 * Production API origin for Cloudflare Pages (static) deploys.
 *
 * Local: Vite proxies `/api` → localhost:3001 (same-origin relative URLs work).
 * Production: set `VITE_API_BASE_URL=https://your-api-host` in Cloudflare Pages
 * env so the browser calls the real Node Express server (momentum, yahoo, …).
 *
 * The momentum engine cannot run as a Pages Function — it needs a long-lived
 * Node process (poll loop, Yahoo, Expo push).
 */

const RAW = String(import.meta.env.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/$/, '')

/** Absolute or same-origin URL for an `/api/...` path. */
export function apiUrl(path: string): string {
  if (!path) return RAW || ''
  if (/^https?:\/\//i.test(path)) return path
  const p = path.startsWith('/') ? path : `/${path}`
  if (!RAW) return p
  return `${RAW}${p}`
}

/** True when the UI was built with an external API host. */
export function hasExternalApiBase(): boolean {
  return Boolean(RAW)
}

export function getApiBase(): string {
  return RAW
}
