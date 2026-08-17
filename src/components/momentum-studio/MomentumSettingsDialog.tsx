import { useState } from 'react'
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

type SettingsNavId = 'appearance' | 'test' | 'engine' | 'thresholds'

const NAV: { id: SettingsNavId; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'test', label: 'Test mode', icon: Bell },
  { id: 'engine', label: 'Engine', icon: Settings2 },
  { id: 'thresholds', label: 'Thresholds', icon: SlidersHorizontal },
]

export function MomentumSettingsDialog({
  open,
  onOpenChange,
  theme,
  onToggleTheme,
  testModeEnabled,
  testModeSaving,
  onToggleTestMode,
  status,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme: ThemeMode
  onToggleTheme: () => void
  testModeEnabled: boolean
  testModeSaving: boolean
  onToggleTestMode: (next: boolean) => void
  status: StudioStatus | null
}) {
  const [nav, setNav] = useState<SettingsNavId>('appearance')
  const tester = status?.config?.testMode?.alwaysNotify
  const snap = status?.config?.thresholdSnapshot
  const windows = snap?.windows || {}

  return (
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
                          <Badge variant={testModeEnabled ? 'secondary' : 'outline'}>
                            {testModeEnabled ? 'ON' : 'OFF'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {testModeEnabled
                            ? 'Pushes only to the tester device. Perplexity is dummy.'
                            : 'Pushes to ticker subscribers plus the always-notify tester. Real Perplexity.'}
                        </p>
                      </div>
                      <Switch
                        checked={testModeEnabled}
                        disabled={testModeSaving}
                        onCheckedChange={(v) => onToggleTestMode(Boolean(v))}
                      />
                    </div>
                    <div className="space-y-1 rounded-lg border p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Always-notify device
                      </p>
                      <p className="break-all font-mono text-xs">
                        {tester?.device_id ||
                          'ios-d003c3d5-2c11-4766-866e-8bf8e511929c'}
                      </p>
                      <p className="break-all font-mono text-[11px] text-muted-foreground">
                        {tester?.expo_push_token ||
                          'ExponentPushToken[FmqQg-OgjuWt8hLmcQDJCF]'}
                      </p>
                    </div>
                  </div>
                ) : null}

                {nav === 'engine' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Meta label="Poll interval" value={`${Math.round((status?.pollIntervalMs || 60000) / 1000)}s`} />
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
                    <Meta label="Ticks" value={String(status?.tickCount ?? 0)} />
                  </div>
                ) : null}

                {nav === 'thresholds' ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Window</TableHead>
                        <TableHead className="text-right">Threshold</TableHead>
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
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
