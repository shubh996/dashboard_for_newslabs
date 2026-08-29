import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from 'react'
import { Activity, BellRing, ChevronRight, Loader2, Watch } from 'lucide-react'
import { HoverCard as HoverCardPrimitive } from 'radix-ui'

import {
  PlatformDeviceLogo,
  buildDeskLifecycleActivities,
  deskDeviceKey,
  deskPlatformLabel,
  type DeskDevice,
  type DeskUserActivity,
} from '@/components/hub/desk-users'
import { CompanyLogo } from '@/components/hub/company-logo'
import { Badge } from '@/components/ui/badge'
import { fmtDateTime } from '@/components/hub/format'
import { cn } from '@/lib/utils'

type SubscriberApp = 'trigger' | 'nineam'

type DeviceActivityState = {
  loading: boolean
  error: string | null
  activities: DeskUserActivity[]
}

type DeviceCacheEntry = {
  at: number
  devices: DeskDevice[]
}

const DEVICE_CACHE_TTL_MS = 30_000
const deviceCache = new Map<SubscriberApp, DeviceCacheEntry>()
const deviceRequests = new Map<SubscriberApp, Promise<DeskDevice[]>>()
const activityCache = new Map<string, DeskUserActivity[]>()
const activityRequests = new Map<string, Promise<DeskUserActivity[]>>()

async function loadDevices(app: SubscriberApp): Promise<DeskDevice[]> {
  const cached = deviceCache.get(app)
  if (cached && Date.now() - cached.at < DEVICE_CACHE_TTL_MS) {
    return cached.devices
  }
  const inflight = deviceRequests.get(app)
  if (inflight) return inflight

  const request = fetch(
    `/api/notifications/devices?app=${encodeURIComponent(app)}&_=${Date.now()}`,
  )
    .then(async (response) => {
      const body = (await response.json().catch(() => ({}))) as {
        devices?: DeskDevice[]
        error?: string
      }
      if (!response.ok) {
        throw new Error(body.error || `Devices failed (${response.status})`)
      }
      const devices = Array.isArray(body.devices) ? body.devices : []
      deviceCache.set(app, { at: Date.now(), devices })
      return devices
    })
    .finally(() => deviceRequests.delete(app))

  deviceRequests.set(app, request)
  return request
}

async function loadDeviceActivity(device: DeskDevice): Promise<DeskUserActivity[]> {
  const key = deskDeviceKey(device)
  if (!key) return buildDeskLifecycleActivities(device)
  const cached = activityCache.get(key)
  if (cached) return cached
  const inflight = activityRequests.get(key)
  if (inflight) return inflight

  const params = new URLSearchParams({ limit: '30' })
  if (device.device_id) params.set('device_id', String(device.device_id))
  if (device.expo_push_token) {
    params.set('expo_push_token', String(device.expo_push_token))
  }
  const request = fetch(`/api/notifications/devices/activity?${params}`)
    .then(async (response) => {
      const body = (await response.json().catch(() => ({}))) as {
        activities?: DeskUserActivity[]
        error?: string
      }
      if (!response.ok) {
        throw new Error(body.error || `Activity failed (${response.status})`)
      }
      const merged = new Map<string, DeskUserActivity>()
      for (const row of [
        ...(Array.isArray(body.activities) ? body.activities : []),
        ...buildDeskLifecycleActivities(device),
      ]) {
        if (!merged.has(row.id)) merged.set(row.id, row)
      }
      const activities = [...merged.values()].sort(
        (a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0),
      )
      activityCache.set(key, activities)
      return activities
    })
    .finally(() => activityRequests.delete(key))

  activityRequests.set(key, request)
  return request
}

function deviceTickers(device: DeskDevice): string[] {
  return [
    ...new Set(
      [
        ...(device.enabled_tickers || []),
        ...(device.tickers || []),
      ]
        .map((ticker) => String(ticker || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  ]
}

function deviceMatchesTicker(device: DeskDevice, ticker: string): boolean {
  if (device.enabled === false || device.subscription_status === 'off') {
    return false
  }
  return deviceTickers(device).includes(ticker)
}

function deviceLastActivityAt(device: DeskDevice): string | null {
  return (
    device.last_seen_at ||
    device.subscriber_updated_at ||
    device.token_updated_at ||
    device.profile_updated_at ||
    device.created_at ||
    null
  )
}

function DeviceDetailPanel({
  device,
  activity,
}: {
  device: DeskDevice
  activity: DeviceActivityState | undefined
}) {
  const tickers = deviceTickers(device)
  const platform = deskPlatformLabel(device.platform, device.device_id) || '—'
  const details = [
    ['Platform', platform],
    ['Model', device.device_model || '—'],
    ['OS', device.os_version || '—'],
    [
      'App',
      [device.app_version, device.build_number ? `build ${device.build_number}` : '']
        .filter(Boolean)
        .join(' · ') || '—',
    ],
    ['Permission', device.permission_status || '—'],
    ['Timezone', device.timezone || '—'],
    ['User ID', device.user_id || '—'],
    ['Last seen', device.last_seen_at ? fmtDateTime(device.last_seen_at) : '—'],
  ]

  return (
    <div className="absolute left-full top-0 z-[70] ml-2 w-[25rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl group-data-[side=left]/subscribers:left-auto group-data-[side=left]/subscribers:right-full group-data-[side=left]/subscribers:ml-0 group-data-[side=left]/subscribers:mr-2 max-lg:left-0 max-lg:right-auto max-lg:ml-0 max-lg:mr-0">
      <div className="flex items-start gap-3 border-b border-border px-3.5 py-3">
        <PlatformDeviceLogo
          platform={device.platform}
          deviceId={device.device_id}
          className="size-11"
        />
        <div className="min-w-0 flex-1">
          <p className="break-all text-[13px] font-bold leading-snug">
            {device.device_id || 'Unknown device'}
          </p>
          <p className="mt-1 break-all font-mono text-[10px] leading-snug text-muted-foreground">
            {device.expo_push_token || 'No Expo push token'}
          </p>
        </div>
      </div>

      <div className="mom-hide-scrollbar max-h-[min(34rem,calc(100vh-2rem))] overflow-y-auto p-3">
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg bg-muted/45 px-3 py-2.5 text-[11px]">
          {details.map(([label, value]) => (
            <div key={label} className="contents">
              <span className="text-muted-foreground">{label}</span>
              <span className="break-all font-medium">{value}</span>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Subscribed stocks · {tickers.length}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tickers.length ? (
              tickers.map((ticker) => (
                <Badge
                  key={ticker}
                  variant="outline"
                  className="h-6 gap-1 py-0 pl-0.5 pr-1.5 font-mono text-[10px]"
                >
                  <CompanyLogo
                    ticker={ticker}
                    companyName={ticker}
                    size="sm"
                    className="size-5 rounded-full"
                  />
                  {ticker}
                </Badge>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground">No enabled stocks</span>
            )}
          </div>
        </div>

        <div className="mt-3 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Latest activity
            </p>
            {activity?.loading ? (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          {activity?.error ? (
            <p className="mt-1.5 text-[11px] text-destructive">{activity.error}</p>
          ) : null}
          {!activity?.loading && !activity?.activities.length ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              No recent activity recorded.
            </p>
          ) : null}
          <div className="mt-1.5 space-y-1.5">
            {(activity?.activities || []).slice(0, 8).map((row) => {
              const Icon =
                row.kind === 'push'
                  ? BellRing
                  : row.kind === 'watch'
                    ? Watch
                    : Activity
              return (
                <div
                  key={row.id}
                  className="flex items-start gap-2 rounded-lg border border-border/70 px-2.5 py-2"
                >
                  {row.ticker ? (
                    <CompanyLogo
                      ticker={row.ticker}
                      companyName={row.ticker}
                      size="sm"
                      className="size-6"
                    />
                  ) : (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon className="size-3 text-muted-foreground" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold">
                      {row.title}
                    </span>
                    <span className="mt-0.5 block text-[9px] tabular-nums text-muted-foreground">
                      {fmtDateTime(row.at)}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SubscriberHoverCard({
  ticker,
  count,
  app = 'trigger',
  children,
  className,
}: {
  ticker: string
  count?: number | null
  app?: SubscriberApp
  children: ReactElement
  className?: string
}) {
  const symbol = String(ticker || '').trim().toUpperCase()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allDevices, setAllDevices] = useState<DeskDevice[]>([])
  const [activeDeviceKey, setActiveDeviceKey] = useState('')
  const [activityByDevice, setActivityByDevice] = useState<
    Record<string, DeviceActivityState>
  >({})

  const devices = useMemo(
    () => allDevices.filter((device) => deviceMatchesTicker(device, symbol)),
    [allDevices, symbol],
  )
  const activeDevice =
    devices.find((device) => deskDeviceKey(device) === activeDeviceKey) || null

  const fetchDevices = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    try {
      setAllDevices(await loadDevices(app))
    } catch (err) {
      setAllDevices([])
      setError(err instanceof Error ? err.message : 'Failed to load subscribers')
    } finally {
      setLoading(false)
    }
  }, [app, symbol])

  const showDevice = useCallback((device: DeskDevice) => {
    const key = deskDeviceKey(device)
    if (!key) return
    setActiveDeviceKey(key)
    setActivityByDevice((prev) => {
      if (prev[key]) return prev
      return {
        ...prev,
        [key]: { loading: true, error: null, activities: [] },
      }
    })
    void loadDeviceActivity(device)
      .then((activities) => {
        setActivityByDevice((prev) => ({
          ...prev,
          [key]: { loading: false, error: null, activities },
        }))
      })
      .catch((err) => {
        setActivityByDevice((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            error: err instanceof Error ? err.message : 'Activity failed',
            activities: buildDeskLifecycleActivities(device),
          },
        }))
      })
  }, [])

  return (
    <HoverCardPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void fetchDevices()
        else setActiveDeviceKey('')
      }}
      openDelay={220}
      closeDelay={450}
    >
      <HoverCardPrimitive.Trigger asChild>{children}</HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className={cn(
            'group/subscribers z-[65] w-[27rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none',
            className,
          )}
        >
          <div className="relative">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">
                  {symbol} subscribers
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {loading
                    ? 'Loading devices…'
                    : `${devices.length || Math.max(0, Number(count) || 0)} enabled device${(devices.length || Number(count) || 0) === 1 ? '' : 's'} · hover a device for full details`}
                </p>
              </div>
              {loading ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            <div className="mom-hide-scrollbar max-h-[28rem] overflow-y-auto p-2">
              {error ? (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  {error}
                </p>
              ) : null}
              {!loading && !error && !devices.length ? (
                <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">
                  No enabled subscriber devices for {symbol}.
                </p>
              ) : null}
              <div className="space-y-1">
                {devices.map((device) => {
                  const key = deskDeviceKey(device)
                  const tickers = deviceTickers(device)
                  const activity = activityByDevice[key]
                  const latest = activity?.activities[0]
                  const lastAt = latest?.at || deviceLastActivityAt(device)
                  return (
                    <div
                      key={key}
                      tabIndex={0}
                      onMouseEnter={() => showDevice(device)}
                      onFocus={() => showDevice(device)}
                      className={cn(
                        'group flex cursor-default items-start gap-2.5 rounded-lg border px-2.5 py-2 outline-none transition-colors',
                        activeDeviceKey === key
                          ? 'border-border bg-muted'
                          : 'border-transparent hover:bg-muted/60 focus:bg-muted/60',
                      )}
                    >
                      <PlatformDeviceLogo
                        platform={device.platform}
                        deviceId={device.device_id}
                        className="size-9"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="break-all text-[12px] font-bold leading-snug">
                          {device.device_id || 'Unknown device'}
                        </p>
                        <p className="mt-0.5 break-all font-mono text-[9px] leading-snug text-muted-foreground">
                          {device.expo_push_token || 'No Expo push token'}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {tickers.map((item) => (
                            <span
                              key={item}
                              className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-background/70 py-0.5 pl-0.5 pr-1.5"
                            >
                              <CompanyLogo
                                ticker={item}
                                companyName={item}
                                size="sm"
                                className="size-4 rounded-full"
                              />
                              <span className="font-mono text-[9px] font-medium">
                                {item}
                              </span>
                            </span>
                          ))}
                        </div>
                        <p className="mt-1.5 truncate text-[9px] text-muted-foreground">
                          {latest ? latest.title : 'Last activity'} ·{' '}
                          {lastAt ? fmtDateTime(lastAt) : 'not recorded'}
                        </p>
                      </div>
                      {activity?.loading ? (
                        <Loader2 className="mt-1 size-3 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {activeDevice ? (
              <DeviceDetailPanel
                device={activeDevice}
                activity={activityByDevice[activeDeviceKey]}
              />
            ) : null}
          </div>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  )
}
