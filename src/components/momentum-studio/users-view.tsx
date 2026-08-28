import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Pencil, Smartphone, X } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { fmtDateTime } from './format'

export type StudioDevice = {
  device_id?: string | null
  expo_push_token?: string | null
  app_key?: string | null
  enabled?: boolean
  subscription_status?: string | null
  tickers?: string[]
  enabled_tickers?: string[]
  enabled_count?: number
  disabled_count?: number
  pro_crypto?: boolean
  user_id?: string | null
  platform?: string | null
  device_model?: string | null
  manufacturer?: string | null
  os_version?: string | null
  app_version?: string | null
  build_number?: string | null
  timezone?: string | null
  locale?: string | null
  notifications_enabled?: boolean | null
  permission_status?: string | null
  last_seen_at?: string | null
  token_updated_at?: string | null
  created_at?: string | null
  profile_updated_at?: string | null
  subscriber_updated_at?: string | null
}

const DETAIL_FIELDS: {
  key: keyof StudioDevice
  label: string
  hint: string
}[] = [
  {
    key: 'expo_push_token',
    label: 'expo_push_token',
    hint: 'notification destination',
  },
  {
    key: 'device_id',
    label: 'device_id',
    hint: 'installation / device association',
  },
  {
    key: 'user_id',
    label: 'user_id',
    hint: 'logged-in user, if authenticated',
  },
  { key: 'platform', label: 'platform', hint: 'iOS / Android' },
  {
    key: 'device_model',
    label: 'device_model',
    hint: 'e.g. iPhone 16 Pro',
  },
  {
    key: 'manufacturer',
    label: 'manufacturer',
    hint: 'Apple / Samsung, etc.',
  },
  {
    key: 'os_version',
    label: 'os_version',
    hint: 'iOS / Android version',
  },
  {
    key: 'app_version',
    label: 'app_version',
    hint: 'installed Trigger version',
  },
  {
    key: 'build_number',
    label: 'build_number',
    hint: 'exact native build',
  },
  {
    key: 'timezone',
    label: 'timezone',
    hint: 'user device timezone',
  },
  { key: 'locale', label: 'locale', hint: 'e.g. en-GB' },
  {
    key: 'notifications_enabled',
    label: 'notifications_enabled',
    hint: 'push permission status',
  },
  {
    key: 'permission_status',
    label: 'permission_status',
    hint: 'OS notification permission',
  },
  {
    key: 'last_seen_at',
    label: 'last_seen_at',
    hint: 'last app / backend interaction',
  },
  {
    key: 'token_updated_at',
    label: 'token_updated_at',
    hint: 'when token was registered / refreshed',
  },
  {
    key: 'created_at',
    label: 'created_at',
    hint: 'first registration',
  },
]

function hasValue(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string' && !value.trim()) return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

function formatFieldValue(
  key: keyof StudioDevice,
  value: StudioDevice[keyof StudioDevice],
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

function maskToken(token?: string | null): string {
  const t = String(token || '').trim()
  if (!t) return ''
  if (t.length <= 28) return t
  return `${t.slice(0, 22)}…${t.slice(-6)}`
}

function deviceKey(d: StudioDevice): string {
  return String(d.device_id || d.expo_push_token || '').trim()
}

function platformLabel(
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

function deviceInitials(device: StudioDevice): string {
  const platform = platformLabel(device.platform, device.device_id)
  if (platform === 'iOS') return 'iOS'
  if (platform === 'Android') return 'AND'
  const id = String(device.device_id || '').trim()
  if (id.length >= 2) return id.slice(0, 2).toUpperCase()
  return 'DV'
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'on') return 'default'
  if (status === 'partial') return 'secondary'
  return 'outline'
}

export function UsersView() {
  const isMobile = useIsMobile()
  const [devices, setDevices] = useState<StudioDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/notifications/devices?app=trigger&_=${Date.now()}`,
      )
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        devices?: StudioDevice[]
        error?: string
      }
      if (!res.ok) throw new Error(body.error || `Status ${res.status}`)
      setDevices(Array.isArray(body.devices) ? body.devices : [])
    } catch (err) {
      setDevices([])
      setError(err instanceof Error ? err.message : 'Failed to load devices')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sorted = useMemo(() => {
    return [...devices].sort((a, b) => {
      const ae = a.enabled ? 0 : 1
      const be = b.enabled ? 0 : 1
      if (ae !== be) return ae - be
      return deviceKey(a).localeCompare(deviceKey(b))
    })
  }, [devices])

  const selected = useMemo(
    () => sorted.find((d) => deviceKey(d) === selectedKey) || null,
    [sorted, selectedKey],
  )

  const alertable = devices.filter((d) => d.enabled).length

  const selectDevice = (device: StudioDevice) => {
    const key = deviceKey(device)
    setSelectedKey((prev) => (prev === key ? null : key))
  }

  const detailPanel = selected ? (
    <DeviceDetailPanel
      device={selected}
      onClose={() => setSelectedKey(null)}
      onTickersChanged={async () => {
        const key = selectedKey
        await load()
        // Keep the same device selected after reload (may have fewer tickers).
        if (key) setSelectedKey(key)
      }}
    />
  ) : null

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 lg:px-6">
          <div className="min-w-0">
            <h2 className="text-base font-medium">Users</h2>
            <p className="text-sm text-muted-foreground">
              Unique Trigger devices
              {devices.length
                ? ` · ${alertable} alertable of ${devices.length}`
                : ''}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Refresh
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive lg:px-6">
              {error}
            </p>
          ) : loading && !devices.length ? (
            <p className="px-4 py-6 text-sm text-muted-foreground lg:px-6">
              Loading devices…
            </p>
          ) : !sorted.length ? (
            <p className="px-4 py-6 text-sm text-muted-foreground lg:px-6">
              No Trigger devices found
            </p>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-[34%]">Device</TableHead>
                  <TableHead className="hidden sm:table-cell">Token</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tickers</TableHead>
                  <TableHead className="hidden lg:table-cell">Tags</TableHead>
                  <TableHead className="hidden md:table-cell text-right">
                    Last seen
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((device) => {
                  const key = deviceKey(device)
                  const status = String(device.subscription_status || 'off')
                  const active = selectedKey === key
                  const platform = platformLabel(
                    device.platform,
                    device.device_id,
                  )
                  const tickers =
                    device.enabled_tickers?.length
                      ? device.enabled_tickers
                      : device.tickers || []
                  return (
                    <TableRow
                      key={key}
                      data-state={active ? 'selected' : undefined}
                      className={cn(
                        'cursor-pointer',
                        active && 'bg-muted/60',
                      )}
                      onClick={() => selectDevice(device)}
                    >
                      <TableCell>
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="size-8 rounded-lg">
                            <AvatarFallback className="rounded-lg text-[10px]">
                              {deviceInitials(device)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {device.device_id || 'Unknown device'}
                            </p>
                            {device.device_model ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {device.device_model}
                              </p>
                            ) : device.user_id ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {device.user_id}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-[14rem] sm:table-cell">
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {maskToken(device.expo_push_token) || '—'}
                        </span>
                      </TableCell>
                      <TableCell>{platform || '—'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={statusVariant(status)}
                          className="capitalize"
                        >
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {device.enabled_count ?? tickers.length}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {device.enabled ? (
                            <Badge variant="outline" className="text-[10px]">
                              alerts
                            </Badge>
                          ) : null}
                          {device.pro_crypto ? (
                            <Badge variant="secondary" className="text-[10px]">
                              crypto
                            </Badge>
                          ) : null}
                          {device.notifications_enabled === false ? (
                            <Badge variant="outline" className="text-[10px]">
                              muted
                            </Badge>
                          ) : null}
                          {!device.enabled &&
                          device.notifications_enabled !== false ? (
                            <Badge variant="outline" className="text-[10px]">
                              stopped
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                        {device.last_seen_at
                          ? fmtDateTime(device.last_seen_at)
                          : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </div>

      {/* Desktop / tablet: right detail column */}
      {!isMobile && selected ? (
        <aside className="flex w-[24rem] shrink-0 flex-col border-l bg-background xl:w-[28rem]">
          {detailPanel}
        </aside>
      ) : null}

      {/* Mobile: detail as sheet */}
      {isMobile ? (
        <Sheet
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open) setSelectedKey(null)
          }}
        >
          <SheetContent side="right" className="w-[min(100vw,24rem)] p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>
                {selected?.device_id || 'Device details'}
              </SheetTitle>
            </SheetHeader>
            {detailPanel}
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}

function DeviceDetailPanel({
  device,
  onClose,
  onTickersChanged,
}: {
  device: StudioDevice
  onClose: () => void
  onTickersChanged?: () => void | Promise<void>
}) {
  const tickers = device.enabled_tickers?.length
    ? device.enabled_tickers
    : device.tickers || []
  const platform = platformLabel(device.platform, device.device_id)

  const [editing, setEditing] = useState(false)
  const [selectedTickers, setSelectedTickers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    setEditing(false)
    setSelectedTickers([])
    setActionError(null)
  }, [device.device_id, device.expo_push_token])

  const fields = DETAIL_FIELDS.map((field) => {
    const raw = device[field.key]
    if (!hasValue(raw)) return null
    const display = formatFieldValue(field.key, raw)
    if (!display) return null
    return { ...field, display }
  }).filter(Boolean) as Array<(typeof DETAIL_FIELDS)[number] & { display: string }>

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
    if (!window.confirm(`${label}\n\nThis deletes the subscriber row(s) in device_monitor.`)) {
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
          ...(mode === 'all'
            ? { all: true }
            : { tickers: payloadTickers }),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        updated_count?: number
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {device.device_id || 'Device'}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[platform, device.device_model, device.subscription_status]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Close details"
        >
          <X />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-3">
            <Avatar className="size-12 rounded-xl">
              <AvatarFallback className="rounded-xl text-xs">
                {deviceInitials(device)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {device.device_id || 'Unknown device'}
              </p>
              {hasValue(device.expo_push_token) ? (
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {maskToken(device.expo_push_token)}
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border bg-card">
            {fields.map((field, index) => (
              <div key={field.key}>
                {index > 0 ? <Separator /> : null}
                <div className="space-y-1 px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-mono text-[11px] font-medium text-muted-foreground">
                      {field.label}
                    </p>
                  </div>
                  <p className="break-all text-sm font-medium tabular-nums">
                    {field.display}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {field.hint}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {tickers.length ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">
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

              {editing ? (
                <p className="text-[11px] text-muted-foreground">
                  Tap pills to select for delete. Selected pills are marked for
                  removal from device_monitor.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-1.5">
                {tickers.map((ticker) => {
                  const selected = selectedTickers.includes(ticker)
                  if (!editing) {
                    return (
                      <Badge
                        key={ticker}
                        variant="outline"
                        className="font-mono"
                      >
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
                        'inline-flex items-center gap-1 rounded-4xl border px-2 py-0.5 font-mono text-xs transition-colors',
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
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy || selectedTickers.length === 0}
                      onClick={() => void unsubscribe('selected')}
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : null}
                      Delete selected
                      {selectedTickers.length
                        ? ` (${selectedTickers.length})`
                        : ''}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={busy || !tickers.length}
                      onClick={() => void unsubscribe('all')}
                    >
                      Delete all
                    </Button>
                  </div>
                  {actionError ? (
                    <p className="text-xs text-destructive">{actionError}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {!fields.length && !tickers.length ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
              <Smartphone className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No profile details available for this device yet
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
