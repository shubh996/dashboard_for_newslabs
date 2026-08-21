import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export type TestModeDeviceRow = {
  device_id: string | null
  expo_push_token: string
  label?: string | null
  pinned?: boolean
  enabled?: boolean
  subscription_status?: string | null
  tickers?: string[]
}

export type AlwaysNotifyDevice = {
  id?: string
  label: string
  device_id: string
  expo_push_token: string
  aliases?: string[]
}

function maskToken(token: string) {
  const t = String(token || '')
  if (t.length < 28) return t
  return `${t.slice(0, 22)}…${t.slice(-6)}`
}

function deviceKey(d: { device_id?: string | null; expo_push_token?: string }) {
  return String(d.expo_push_token || d.device_id || '').trim()
}

function isPinnedMatch(
  row: TestModeDeviceRow,
  pinned: AlwaysNotifyDevice[],
) {
  const tok = String(row.expo_push_token || '').trim()
  const id = String(row.device_id || '').trim()
  return pinned.some(
    (p) =>
      p.expo_push_token === tok ||
      p.device_id === id ||
      (p.aliases || []).includes(id),
  )
}

export function TestModeRecipientsDialog({
  open,
  onOpenChange,
  mode,
  alwaysNotifyDevices,
  initialSelectedDeviceIds,
  initialSelectedTokens,
  saving,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Turning test mode on, or editing allowlist while already on */
  mode: 'enable' | 'edit'
  alwaysNotifyDevices: AlwaysNotifyDevice[]
  initialSelectedDeviceIds: string[]
  initialSelectedTokens: string[]
  saving: boolean
  onConfirm: (payload: {
    selectedDeviceIds: string[]
    selectedTokens: string[]
  }) => void | Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<TestModeDeviceRow[]>([])
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])

  const pinned = useMemo(
    () =>
      (alwaysNotifyDevices || []).map((d) => ({
        ...d,
        label: d.label || d.device_id,
      })),
    [alwaysNotifyDevices],
  )

  const loadDevices = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/notifications/devices?app=trigger&_=${Date.now()}`,
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Status ${res.status}`)
      const rows: TestModeDeviceRow[] = Array.isArray(body.devices)
        ? body.devices
        : Array.isArray(body.recipients)
          ? body.recipients
          : []
      setDevices(
        rows
          .map((r) => ({
            device_id: r.device_id ? String(r.device_id) : null,
            expo_push_token: String(r.expo_push_token || r.to || '').trim(),
            enabled: r.enabled !== false,
            subscription_status: r.subscription_status || null,
            tickers: Array.isArray(r.tickers) ? r.tickers : [],
            label: null,
            pinned: false,
          }))
          .filter((r) => r.expo_push_token),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices')
      setDevices([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadDevices()

    const initialKeys = new Set<string>()
    for (const tok of initialSelectedTokens || []) {
      if (tok) initialKeys.add(String(tok).trim())
    }
    for (const id of initialSelectedDeviceIds || []) {
      const match = pinned.find(
        (p) => p.device_id === id || (p.aliases || []).includes(id),
      )
      if (match) initialKeys.add(match.expo_push_token)
      else if (id) initialKeys.add(String(id).trim())
    }
    if (initialKeys.size === 0) {
      for (const p of pinned) initialKeys.add(p.expo_push_token)
    }
    setSelectedKeys([...initialKeys])
  }, [open, initialSelectedDeviceIds, initialSelectedTokens, pinned, loadDevices])

  const mergedList = useMemo(() => {
    const pinnedRows: TestModeDeviceRow[] = pinned.map((p) => ({
      device_id: p.device_id,
      expo_push_token: p.expo_push_token,
      label: p.label,
      pinned: true,
      enabled: true,
      subscription_status: 'always',
      tickers: [],
    }))
    const rest = devices.filter((d) => !isPinnedMatch(d, pinned))
    return [...pinnedRows, ...rest]
  }, [pinned, devices])

  const allKeys = useMemo(
    () => mergedList.map((d) => deviceKey(d)).filter(Boolean),
    [mergedList],
  )

  function toggleKey(key: string) {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  function selectAll() {
    setSelectedKeys(allKeys)
  }

  function clearAll() {
    setSelectedKeys([])
  }

  async function handleConfirm() {
    const selectedRows = mergedList.filter((d) =>
      selectedKeys.includes(deviceKey(d)),
    )
    if (selectedRows.length === 0) {
      setError('Select at least one device (including the pinned testers).')
      return
    }
    setError(null)
    const selectedDeviceIds = selectedRows
      .map((r) => r.device_id)
      .filter((id): id is string => Boolean(id))
    const selectedTokens = selectedRows
      .map((r) => r.expo_push_token)
      .filter(Boolean)
    await onConfirm({ selectedDeviceIds, selectedTokens })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(40rem,90svh)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>
            {mode === 'edit' ? 'Edit test recipients' : 'Choose test recipients'}
          </DialogTitle>
          <DialogDescription>
            Test mode ON sends pushes only to checked devices. The two pinned
            testers at the top also have checkboxes — select or unselect them
            like any other device.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 border-b px-5 py-2">
          <p className="text-xs text-muted-foreground">
            {selectedKeys.length}/{mergedList.length} selected
          </p>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!allKeys.length || saving}
              onClick={selectAll}
            >
              Select all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!selectedKeys.length || saving}
              onClick={clearAll}
            >
              Clear all
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-2 p-4">
            {loading ? (
              <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading devices…
              </div>
            ) : null}
            {error ? (
              <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="text-destructive">{error}</p>
                {/load|failed|status/i.test(error) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void loadDevices()}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : null}
            {!loading && !mergedList.length ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No devices found. Pinned testers still appear when configured.
              </p>
            ) : null}

            {mergedList.map((device, index) => {
              const key = deviceKey(device)
              const checked = selectedKeys.includes(key)
              const showPinnedHeader = index === 0 && device.pinned
              const showOthersHeader =
                device.pinned !== true &&
                (index === 0 || mergedList[index - 1]?.pinned)
              const rowId = `test-mode-device-${key}`
              return (
                <div key={key}>
                  {showPinnedHeader ? (
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Always notify — check to include in test pushes
                    </p>
                  ) : null}
                  {showOthersHeader ? (
                    <p className="mb-2 mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      All devices
                    </p>
                  ) : null}
                  <label
                    htmlFor={rowId}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                      checked
                        ? 'border-foreground bg-muted/50'
                        : 'border-border hover:bg-muted/30',
                      saving && 'pointer-events-none opacity-60',
                    )}
                  >
                    <input
                      id={rowId}
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-foreground"
                      checked={checked}
                      disabled={saving}
                      onChange={() => toggleKey(key)}
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">
                          {device.label ||
                            device.device_id ||
                            'Unknown device'}
                        </span>
                        {device.pinned ? (
                          <Badge variant="secondary">Pinned</Badge>
                        ) : null}
                        {device.subscription_status &&
                        device.subscription_status !== 'always' ? (
                          <Badge variant="outline">
                            {device.subscription_status}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block break-all font-mono text-[11px] text-muted-foreground">
                        {device.device_id || '—'}
                      </span>
                      <span className="block break-all font-mono text-[11px] text-muted-foreground">
                        {maskToken(device.expo_push_token)}
                      </span>
                    </span>
                  </label>
                </div>
              )
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 border-t px-5 py-3 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || loading}
            onClick={() => void handleConfirm()}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : mode === 'edit' ? (
              'Save selection'
            ) : (
              'Turn on test mode'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
