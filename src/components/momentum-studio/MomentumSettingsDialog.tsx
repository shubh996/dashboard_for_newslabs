import { useMemo, useState } from 'react'
import {
  Bell,
  Moon,
  Palette,
  Settings2,
  SlidersHorizontal,
  Sun,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { ThemeMode } from '@/hooks/useTheme'
import type { StudioStatus } from './types'
import {
  TestModeRecipientsDialog,
  type AlwaysNotifyDevice,
} from './TestModeRecipientsDialog'

type SettingsNavId = 'appearance' | 'test' | 'engine' | 'thresholds'

const NAV: { id: SettingsNavId; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'test', label: 'Test mode', icon: Bell },
  { id: 'engine', label: 'Engine', icon: Settings2 },
  { id: 'thresholds', label: 'Thresholds', icon: SlidersHorizontal },
]

const FALLBACK_ALWAYS: AlwaysNotifyDevice[] = [
  {
    id: 'trigger-iphone16',
    label: 'Trigger app · iPhone 16',
    device_id: 'ios-0c793db2-c3a0-4ee7-b742-4270d81e20f7',
    expo_push_token: 'ExponentPushToken[FmqQg-OgjuWt8hLmcQDJCF]',
    aliases: ['ios-d003c3d5-2c11-4766-866e-8bf8e511929c'],
  },
  {
    id: 'expo-app',
    label: 'Expo app',
    device_id: 'ios-1ddd5b0c-5ff8-401f-b0a6-ae9beaac8ea1',
    expo_push_token: 'ExponentPushToken[Q4Q4xqGpb9fyE9kpMPdUYZ]',
  },
]

export function MomentumSettingsDialog({
  open,
  onOpenChange,
  theme,
  onToggleTheme,
  testModeEnabled,
  testModeSaving,
  onConfirmTestMode,
  status,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme: ThemeMode
  onToggleTheme: () => void
  testModeEnabled: boolean
  testModeSaving: boolean
  onConfirmTestMode: (payload: {
    enabled: boolean
    selectedDeviceIds?: string[]
    selectedTokens?: string[]
  }) => void | Promise<void>
  status: StudioStatus | null
}) {
  const [nav, setNav] = useState<SettingsNavId>('appearance')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<'enable' | 'edit'>('enable')

  const snap = status?.config?.thresholdSnapshot
  const windows = snap?.windows || {}
  const testSnap = status?.config?.testMode

  const alwaysNotifyDevices = useMemo<AlwaysNotifyDevice[]>(() => {
    const fromApi = testSnap?.alwaysNotifyDevices
    if (Array.isArray(fromApi) && fromApi.length) {
      return fromApi.map((d) => ({
        id: d.id,
        label: d.label || d.device_id || 'Tester',
        device_id: String(d.device_id || ''),
        expo_push_token: String(d.expo_push_token || ''),
        aliases: Array.isArray(d.aliases) ? d.aliases : [],
      }))
    }
    if (testSnap?.alwaysNotify?.device_id) {
      return [
        {
          label: testSnap.alwaysNotify.label || 'Always-notify tester',
          device_id: String(testSnap.alwaysNotify.device_id),
          expo_push_token: String(testSnap.alwaysNotify.expo_push_token || ''),
        },
        ...FALLBACK_ALWAYS.filter(
          (f) => f.device_id !== testSnap.alwaysNotify?.device_id,
        ).slice(0, 1),
      ]
    }
    return FALLBACK_ALWAYS
  }, [testSnap])

  const initialSelectedDeviceIds =
    testSnap?.selectedAllowlist?.selectedDeviceIds ||
    alwaysNotifyDevices.map((d) => d.device_id)
  const initialSelectedTokens =
    testSnap?.selectedAllowlist?.selectedTokens ||
    alwaysNotifyDevices.map((d) => d.expo_push_token)

  function handleTestModeSwitch(next: boolean) {
    if (next) {
      setPickerMode('enable')
      setPickerOpen(true)
      return
    }
    void onConfirmTestMode({ enabled: false })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex h-[min(36rem,88svh)] max-w-[min(52rem,calc(100%-2rem))] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[min(52rem,calc(100%-2rem))]"
          showCloseButton
        >
          <div className="flex min-h-0 flex-1">
            <aside className="flex w-52 shrink-0 flex-col border-r bg-muted/30 p-2">
              <p className="px-2 py-2 text-xs font-medium text-muted-foreground">
                Settings
              </p>
              <nav className="flex flex-col gap-0.5">
                {NAV.map((item) => {
                  const Icon = item.icon
                  const active = nav === item.id
                  return (
                    <Button
                      key={item.id}
                      type="button"
                      variant="ghost"
                      className={cn(
                        'h-8 justify-start gap-2 px-2',
                        active && 'bg-background text-foreground shadow-sm',
                      )}
                      onClick={() => setNav(item.id)}
                    >
                      <Icon />
                      {item.label}
                    </Button>
                  )
                })}
              </nav>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              <DialogHeader className="border-b px-5 py-4">
                <DialogTitle>
                  {NAV.find((n) => n.id === nav)?.label}
                </DialogTitle>
                <DialogDescription>
                  {nav === 'appearance'
                    ? 'Light and dark follow the shadcn New York tokens.'
                    : nav === 'test'
                      ? 'Control who receives momentum pushes.'
                      : nav === 'engine'
                        ? 'Live engine status from the same API as the original dashboard.'
                        : 'Window thresholds currently loaded on the engine.'}
                </DialogDescription>
              </DialogHeader>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-5 p-5">
                  {nav === 'appearance' ? (
                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <Label>Dark mode</Label>
                        <p className="text-xs text-muted-foreground">
                          Uses the same html.dark class as the rest of the app.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {theme === 'dark' ? (
                          <Moon className="size-4 text-muted-foreground" />
                        ) : (
                          <Sun className="size-4 text-muted-foreground" />
                        )}
                        <Switch
                          checked={theme === 'dark'}
                          onCheckedChange={() => onToggleTheme()}
                        />
                      </div>
                    </div>
                  ) : null}

                  {nav === 'test' ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Label>Test mode</Label>
                            <Badge
                              variant={
                                testModeEnabled ? 'secondary' : 'outline'
                              }
                            >
                              {testModeEnabled ? 'ON' : 'OFF'}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {testModeEnabled
                              ? 'Pushes only to selected devices. Perplexity is dummy.'
                              : 'Pushes to ticker subscribers plus both always-notify testers. Real Perplexity.'}
                          </p>
                        </div>
                        <Switch
                          checked={testModeEnabled}
                          disabled={testModeSaving}
                          onCheckedChange={(v) =>
                            handleTestModeSwitch(Boolean(v))
                          }
                        />
                      </div>

                      <div className="space-y-2 rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Always-notify testers
                          </p>
                          {testModeEnabled ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={testModeSaving}
                              onClick={() => {
                                setPickerMode('edit')
                                setPickerOpen(true)
                              }}
                            >
                              Edit recipients
                            </Button>
                          ) : null}
                        </div>
                        <ul className="space-y-3">
                          {alwaysNotifyDevices.map((d) => (
                            <li key={d.device_id} className="space-y-0.5">
                              <p className="text-sm font-medium">{d.label}</p>
                              <p className="break-all font-mono text-xs text-muted-foreground">
                                {d.device_id}
                              </p>
                              <p className="break-all font-mono text-[11px] text-muted-foreground">
                                {d.expo_push_token}
                              </p>
                            </li>
                          ))}
                        </ul>
                        {testModeEnabled &&
                        testSnap?.selectedAllowlist?.selectedTokens?.length ? (
                          <p className="pt-1 text-[11px] text-muted-foreground">
                            Allowlist:{' '}
                            {testSnap.selectedAllowlist.selectedTokens.length}{' '}
                            token(s) selected
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {nav === 'engine' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Meta
                        label="Poll interval"
                        value={`${Math.round((status?.pollIntervalMs || 60000) / 1000)}s`}
                      />
                      <Meta label="Mode" value={status?.pollMode || '—'} />
                      <Meta
                        label="Universe"
                        value={String(
                          status?.watchedCount ??
                            status?.watchedTickers?.length ??
                            '—',
                        )}
                      />
                      <Meta
                        label="Per cycle"
                        value={String(status?.pollPerCycle ?? '—')}
                      />
                      <Meta
                        label="Loop"
                        value={
                          status?.loopRunning
                            ? 'Running'
                            : status?.engineEnabled === false
                              ? 'Disabled'
                              : 'Idle'
                        }
                      />
                      <Meta
                        label="Ticks"
                        value={String(status?.tickCount ?? 0)}
                      />
                    </div>
                  ) : null}

                  {nav === 'thresholds' ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Window</TableHead>
                          <TableHead className="text-right">
                            Threshold
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell>day</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {snap?.day != null ? `${snap.day}%` : 'off'}
                          </TableCell>
                        </TableRow>
                        {Object.entries(windows).map(([key, val]) => (
                          <TableRow key={key}>
                            <TableCell>{key}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {val != null && Number(val) > 0
                                ? `${val}%`
                                : 'off'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                </div>
              </ScrollArea>
              <Separator />
              <div className="flex justify-end px-5 py-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <TestModeRecipientsDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        mode={pickerMode}
        alwaysNotifyDevices={alwaysNotifyDevices}
        initialSelectedDeviceIds={initialSelectedDeviceIds}
        initialSelectedTokens={initialSelectedTokens}
        saving={testModeSaving}
        onConfirm={async ({ selectedDeviceIds, selectedTokens }) => {
          await onConfirmTestMode({
            enabled: true,
            selectedDeviceIds,
            selectedTokens,
          })
          setPickerOpen(false)
        }}
      />
    </>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}
