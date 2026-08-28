/**
 * Client mirror of MOMENTUM_DESK_ONLY.
 * Set VITE_MOMENTUM_DESK_ONLY=1 to stop Studio / news / Trigger UI polls.
 * Server still enforces the real allowlist.
 */
export function isDeskOnlyMode(): boolean {
  const v = String(import.meta.env.VITE_MOMENTUM_DESK_ONLY ?? '')
    .trim()
    .toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}
