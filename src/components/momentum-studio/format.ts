import type { AssetClassId } from './types'

export function detectAssetClass(ticker: string): AssetClassId {
  const t = String(ticker || '').trim().toUpperCase()
  if (t.startsWith('^')) return 'index'
  if (t.endsWith('=X') || /^[A-Z]{6}$/.test(t)) return 'forex'
  if (t.endsWith('=F')) return 'commodity'
  if (
    t.endsWith('-USD') ||
    t.endsWith('-USDT') ||
    t === 'BTC' ||
    t === 'ETH'
  ) {
    return 'crypto'
  }
  return 'equity'
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

export function fmtPrice(
  n: number | null | undefined,
  currency?: string | null,
): string {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const abs = Math.abs(v)
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : 4
  const body = v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return currency && currency !== 'USD' ? `${body} ${currency}` : `$${body}`
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function fmtEpisodeNo(n: number | null | undefined): string | null {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return null
  return `#${String(Math.floor(v)).padStart(3, '0')}`
}

export function formatEpisodeState(state: string | null | undefined): string {
  if (!state) return '—'
  return String(state)
    .replace(/^MOMENTUM_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function pctTone(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return 'text-muted-foreground'
  const v = Number(n)
  if (v > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (v < 0) return 'text-rose-600 dark:text-rose-400'
  return 'text-muted-foreground'
}

export function eventLabel(type: string | null | undefined): string {
  return String(type || 'event')
    .replace(/^MOMENTUM_/, '')
    .replace(/_/g, ' ')
}

export const DEFAULT_RETURN_KEYS = [
  '5m',
  '10m',
  '15m',
  '30m',
  '45m',
  '60m',
  '90m',
  '2h',
  '3h',
  '5h',
  '8h',
  '24h',
  'day',
] as const
