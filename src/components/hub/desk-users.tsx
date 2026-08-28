import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BellRing,
  Check,
  Loader2,
  Pencil,
  Smartphone,
  Watch,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { fmtDateTime } from '@/components/momentum-studio/format'
import type { StudioDevice } from '@/components/momentum-studio/users-view'
import { CompanyLogo } from '@/components/hub/company-logo'

export type DeskDevice = StudioDevice

export type DeskUserActivity = {
  id: string
  kind: 'push' | 'lifecycle' | 'watch'
  at: string
  title: string
  body?: string | null
  ticker?: string | null
  eventType?: string | null
  direction?: string | null
  movePercent?: number | null
  detectedWindow?: string | null
  delivery_status?: string | null
  delivery_error?: string | null
}

const PROFILE_FIELDS: {
  key: keyof DeskDevice
  label: string
  hint: string
}[] = [
  { key: 'platform', label: 'platform', hint: 'iOS / Android' },
  { key: 'device_model', label: 'device_model', hint: 'e.g. iPhone 16 Pro' },
  { key: 'manufacturer', label: 'manufacturer', hint: 'Apple / Samsung' },
  { key: 'os_version', label: 'os_version', hint: 'OS version' },
  { key: 'app_version', label: 'app_version', hint: 'Trigger app version' },
  { key: 'build_number', label: 'build_number', hint: 'Native build number' },
  { key: 'timezone', label: 'timezone', hint: 'Device timezone' },
  { key: 'locale', label: 'locale', hint: 'e.g. en-GB' },
  {
    key: 'notifications_enabled',
    label: 'notifications_enabled',
    hint: 'Push permission',
  },
  {
    key: 'permission_status',
    label: 'permission_status',
    hint: 'OS notification permission',
  },
  { key: 'last_seen_at', label: 'last_seen_at', hint: 'Last interaction' },
  {
    key: 'token_updated_at',
    label: 'token_updated_at',
    hint: 'Token registered / refreshed',
  },
  { key: 'created_at', label: 'created_at', hint: 'First registration' },
  { key: 'user_id', label: 'user_id', hint: 'Logged-in user, if any' },
  {
    key: 'expo_push_token',
    label: 'expo_push_token',
    hint: 'Notification destination',
  },
  { key: 'device_id', label: 'device_id', hint: 'Installation id' },
]

function hasValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string' && !value.trim()) return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

function formatFieldValue(
  key: keyof DeskDevice,
  value: DeskDevice[keyof DeskDevice],
): string {
  if (!hasValue(value)) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (
    key === 'last_seen_at' ||
    key === 'token_updated_at' ||
    key === 'created_at' ||
    key === 'profile_updated_at' ||
    key === 'subscriber_updated_at'
  ) {
    return fmtDateTime(String(value))
  }
  return String(value)
}

export function deskDeviceKey(d: DeskDevice): string {
  return String(d.device_id || d.expo_push_token || '').trim()
}

export function deskPlatformLabel(
  platform?: string | null,
  deviceId?: string | null,
): string {
  const p = String(platform || '').toLowerCase()
  if (p.includes('ios') || p === 'iphone' || p === 'ipad') return 'iOS'
  if (p.includes('android')) return 'Android'
  const id = String(deviceId || '').toLowerCase()
  if (id.startsWith('ios-')) return 'iOS'
  if (id.startsWith('android-')) return 'Android'
  return String(platform || '').trim()
}

export function deskDeviceInitials(device: DeskDevice): string {
  const platform = deskPlatformLabel(device.platform, device.device_id)
  if (platform === 'iOS') return 'iO'
  if (platform === 'Android') return 'AN'
  const id = String(device.device_id || '').trim()
  if (id.length >= 2) return id.slice(0, 2).toUpperCase()
  return 'DV'
}

function maskToken(token?: string | null): string {
  const t = String(token || '').trim()
  if (!t) return ''
  if (t.length <= 28) return t
  return `${t.slice(0, 22)}…${t.slice(-6)}`
}

/** Lifecycle + watchlist rows always available from the device payload. */
export function buildDeskLifecycleActivities(
  device: DeskDevice,
): DeskUserActivity[] {
  const rows: DeskUserActivity[] = []
  if (device.created_at) {
    rows.push({
      id: `life-created-${device.created_at}`,
      kind: 'lifecycle',
      at: String(device.created_at),
      title: 'Device registered',
      body: 'First seen in Trigger device profiles',
    })
  }
  if (device.token_updated_at) {
    rows.push({
      id: `life-token-${device.token_updated_at}`,
      kind: 'lifecycle',
      at: String(device.token_updated_at),
      title: 'Push token updated',
      body: maskToken(device.expo_push_token) || undefined,
    })
  }
  if (device.last_seen_at) {
    rows.push({
      id: `life-seen-${device.last_seen_at}`,
      kind: 'lifecycle',
      at: String(device.last_seen_at),
      title: 'Last seen',
      body: deskPlatformLabel(device.platform, device.device_id) || undefined,
    })
  }
  if (device.permission_status) {
    rows.push({
      id: `life-perm-${device.permission_status}-${device.profile_updated_at || device.last_seen_at || ''}`,
      kind: 'lifecycle',
      at: String(
        device.profile_updated_at ||
          device.last_seen_at ||
          device.created_at ||
          new Date().toISOString(),
      ),
      title: `Notification permission · ${device.permission_status}`,
      body:
        device.notifications_enabled === false
          ? 'Notifications disabled on device'
          : 'Notifications enabled',
    })
  }
  const tickers = device.enabled_tickers?.length
    ? device.enabled_tickers
    : device.tickers || []
  for (const ticker of tickers) {
    rows.push({
      id: `watch-${ticker}`,
      kind: 'watch',
      at: String(
        device.subscriber_updated_at ||
          device.last_seen_at ||
          device.created_at ||
          new Date().toISOString(),
      ),
      title: `Watching ${ticker}`,
      body: 'Enabled in device_monitor',
      ticker,
    })
  }
  rows.sort((a, b) => {
    const tb = Date.parse(a.at) || 0
    const ta = Date.parse(b.at) || 0
    // watches after lifecycle by same time — keep watch secondary
    if (tb === ta) {
      if (a.kind === 'watch' && b.kind !== 'watch') return 1
      if (b.kind === 'watch' && a.kind !== 'watch') return -1
    }
    return tb - ta > 0 ? -1 : 1
  })
  return rows
}

/** Platform mark for Users list (Apple / Android) with Smartphone fallback. */
function PlatformDeviceLogo({
  platform,
  deviceId,
  className,
}: {
  platform?: string | null
  deviceId?: string | null
  className?: string
}) {
  const label = deskPlatformLabel(platform, deviceId)
  const src =
    label === 'iOS'
      ? 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/apple.svg'
      : label === 'Android'
        ? 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/android.svg'
        : null
  const large = Boolean(className && /\bsize-(1[1-9]|[2-9]\d)\b/.test(className))
  return (
    <Avatar className={cn('size-8 shrink-0 rounded-lg', className)}>
      {src ? (
        <AvatarImage
          src={src}
          alt=""
          className={cn(
            'bg-muted/40 object-contain dark:invert',
            large ? 'p-3' : 'p-1.5',
          )}
        />
      ) : null}
      <AvatarFallback className="rounded-lg bg-muted/40">
        <Smartphone
          className={cn(
            'text-muted-foreground',
            large ? 'size-6' : 'size-4',
          )}
        />
      </AvatarFallback>
    </Avatar>
  )
}

export function DeskUserListButton({
  device,
  active,
  onClick,
}: {
  device: DeskDevice
  active: boolean
  onClick: () => void
}) {
  const platform = deskPlatformLabel(device.platform, device.device_id)
  const status = String(device.subscription_status || 'off')
  const tickerCount = Math.max(
    0,
    Number(
      device.enabled_count ??
        device.enabled_tickers?.length ??
        device.tickers?.length ??
        0,
    ) || 0,
  )
  return (
    <Button
      type="button"
      variant="ghost"
      data-pill="false"
      onClick={onClick}
      className={cn(
        'h-auto min-h-10 w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left',
        active && 'bg-muted hover:bg-muted',
      )}
    >
      <PlatformDeviceLogo
        platform={device.platform}
        deviceId={device.device_id}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold tracking-tight">
            {device.device_model ||
              platform ||
              String(device.device_id || 'Device').slice(0, 18)}
          </span>
          {platform ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {platform}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {status}
          {` · ${tickerCount} ticker${tickerCount === 1 ? '' : 's'}`}
          {device.build_number ? ` · build ${device.build_number}` : ''}
        </span>
      </span>
    </Button>
  )
}

export function DeskUserActivitiesPanel({
  device,
  pushActivities,
  loading,
}: {
  device: DeskDevice | null
  pushActivities: DeskUserActivity[]
  loading: boolean
}) {
  const lifecycle = useMemo(
    () => (device ? buildDeskLifecycleActivities(device) : []),
    [device],
  )

  const merged = useMemo(() => {
    const map = new Map<string, DeskUserActivity>()
    for (const row of [...pushActivities, ...lifecycle]) {
      if (!map.has(row.id)) map.set(row.id, row)
    }
    return [...map.values()].sort((a, b) => {
      const tb = Date.parse(b.at) || 0
      const ta = Date.parse(a.at) || 0
      return tb - ta
    })
  }, [pushActivities, lifecycle])

  if (!device) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <Smartphone
          className="size-6 text-muted-foreground/70"
          strokeWidth={1.5}
        />
        <p className="text-sm font-medium">Select a user</p>
        <p className="max-w-sm text-[12px] text-muted-foreground">
          Click a device on the left to see their push and watchlist activity
          here.
        </p>
      </div>
    )
  }

  const platform = deskPlatformLabel(device.platform, device.device_id)

  return (
    <div className="flex h-full min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
      <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            Activity
          </h2>
          <p className="truncate text-[13px] text-muted-foreground">
            {[platform, device.device_model, device.device_id]
              .filter(Boolean)
              .join(' · ')}
            {merged.length ? ` · ${merged.length} events` : ''}
          </p>
        </div>
        {loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      <div className="mom-hide-scrollbar min-h-0 flex-1 overflow-y-auto">
        {!merged.length ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-16 text-center">
            <Activity
              className="size-6 text-muted-foreground/70"
              strokeWidth={1.5}
            />
            <p className="text-base font-medium">No activity yet</p>
            <p className="max-w-sm text-[13px] text-muted-foreground">
              Pushes that reach this device and watchlist changes will show up
              here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {merged.map((row) => {
              const Icon =
                row.kind === 'push'
                  ? BellRing
                  : row.kind === 'watch'
                    ? Watch
                    : Smartphone
              return (
                <li
                  key={row.id}
                  className="rounded-xl border border-border bg-card px-3.5 py-3"
                >
                  <div className="flex items-start gap-3">
                    {row.ticker ? (
                      <CompanyLogo
                        ticker={String(row.ticker).toUpperCase()}
                        companyName={String(row.ticker).toUpperCase()}
                        size="sm"
                        className="mt-0.5"
                      />
                    ) : (
                      <span
                        className={cn(
                          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                          row.kind === 'push'
                            ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                            : row.kind === 'watch'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        <Icon className="size-4" strokeWidth={2} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-[15px] font-semibold leading-snug">
                          {row.title}
                        </p>
                        {row.ticker ? (
                          <Badge
                            variant="outline"
                            className="font-mono text-[11px]"
                          >
                            {row.ticker}
                          </Badge>
                        ) : null}
                        {row.delivery_status ? (
                          <Badge
                            variant="secondary"
                            className="text-[11px] capitalize"
                          >
                            {row.delivery_status}
                          </Badge>
                        ) : null}
                      </div>
                      {row.body ? (
                        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-foreground/85">
                          {row.body}
                        </p>
                      ) : null}
                      <p className="mt-1.5 text-[12px] tabular-nums text-muted-foreground">
                        {fmtDateTime(row.at)}
                        {row.detectedWindow ? ` · ${row.detectedWindow}` : ''}
                        {row.movePercent != null &&
                        Number.isFinite(row.movePercent)
                          ? ` · ${row.movePercent > 0 ? '+' : ''}${row.movePercent.toFixed(2)}%`
                          : ''}
                      </p>
                      {row.delivery_error ? (
                        <p className="mt-1 text-[12px] text-rose-700 dark:text-rose-300">
                          {String(row.delivery_error)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export function DeskUserProfilePanel({
  device,
  onTickersChanged,
}: {
  device: DeskDevice
  onTickersChanged?: () => void | Promise<void>
}) {
  const tickers = device.enabled_tickers?.length
    ? device.enabled_tickers
    : device.tickers || []
  const platform = deskPlatformLabel(device.platform, device.device_id)

  const [editing, setEditing] = useState(false)
  const [selectedTickers, setSelectedTickers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setEditing(false)
    setSelectedTickers([])
    setActionError(null)
  }, [device.device_id, device.expo_push_token])

  const fields = PROFILE_FIELDS.map((field) => {
    const raw = device[field.key]
    if (!hasValue(raw)) return null
    const display = formatFieldValue(field.key, raw)
    if (!display) return null
    return { ...field, display }
  }).filter(Boolean) as Array<(typeof PROFILE_FIELDS)[number] & { display: string }>

  const toggleTicker = (ticker: string) => {
    setSelectedTickers((prev) =>
      prev.includes(ticker)
        ? prev.filter((t) => t !== ticker)
        : [...prev, ticker],
    )
  }

  const exitEdit = () => {
    setEditing(false)
    setSelectedTickers([])
    setActionError(null)
  }

  const unsubscribe = async (mode: 'selected' | 'all') => {
    if (busy) return
    const payloadTickers =
      mode === 'all' ? tickers : selectedTickers.filter(Boolean)
    if (mode === 'selected' && !payloadTickers.length) return
    const label =
      mode === 'all'
        ? `Remove this device from all ${tickers.length} ticker${tickers.length === 1 ? '' : 's'}?`
        : `Remove this device from ${payloadTickers.length} selected ticker${payloadTickers.length === 1 ? '' : 's'}?`
    if (
      !window.confirm(
        `${label}\n\nThis deletes the subscriber row(s) in device_monitor.`,
      )
    ) {
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch('/api/notifications/devices/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app: 'trigger',
          device_id: device.device_id || undefined,
          expo_push_token: device.expo_push_token || undefined,
          ...(mode === 'all' ? { all: true } : { tickers: payloadTickers }),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Status ${res.status}`)
      }
      exitEdit()
      await onTickersChanged?.()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to delete subscriptions',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="space-y-3 px-3 py-3">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <PlatformDeviceLogo
            platform={device.platform}
            deviceId={device.device_id}
            className="size-14 rounded-2xl"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">
              {device.device_model || platform || 'Device'}
            </p>
            <p className="truncate text-[12px] text-muted-foreground">
              {[platform, device.build_number ? `build ${device.build_number}` : null]
                .filter(Boolean)
                .join(' · ') || 'Profile'}
            </p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {String(device.device_id || '').slice(0, 28) ||
                maskToken(device.expo_push_token) ||
                '—'}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {fields.length ? (
            fields.map((field, index) => (
              <div key={field.key}>
                {index > 0 ? <Separator /> : null}
                <div className="space-y-1 px-3 py-2.5">
                  <p className="font-mono text-[11px] font-medium text-muted-foreground">
                    {field.label}
                  </p>
                  <p className="break-all text-[13px] font-medium tabular-nums">
                    {field.display}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {field.hint}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
              No profile fields available for this device yet.
            </p>
          )}
        </div>

        {tickers.length ? (
          <div className="space-y-2 rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-muted-foreground">
                Enabled tickers · {tickers.length}
                {editing && selectedTickers.length
                  ? ` · ${selectedTickers.length} selected`
                  : ''}
              </p>
              {editing ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={exitEdit}
                  disabled={busy}
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2"
                  onClick={() => {
                    setEditing(true)
                    setSelectedTickers([])
                    setActionError(null)
                  }}
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tickers.map((ticker) => {
                const selected = selectedTickers.includes(ticker)
                if (!editing) {
                  return (
                    <Badge key={ticker} variant="outline" className="font-mono">
                      {ticker}
                    </Badge>
                  )
                }
                return (
                  <button
                    key={ticker}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleTicker(ticker)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs transition-colors',
                      selected
                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                        : 'border-border bg-background text-foreground hover:bg-muted',
                    )}
                    aria-pressed={selected}
                  >
                    {selected ? <Check className="size-3" /> : null}
                    {ticker}
                  </button>
                )
              })}
            </div>
            {editing ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy || selectedTickers.length === 0}
                  onClick={() => void unsubscribe('selected')}
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Delete selected
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="text-destructive"
                  onClick={() => void unsubscribe('all')}
                >
                  Delete all
                </Button>
              </div>
            ) : null}
            {actionError ? (
              <p className="text-[11px] text-destructive">{actionError}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
