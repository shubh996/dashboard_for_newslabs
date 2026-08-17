import { IconCircleCheckFilled, IconLoader } from '@tabler/icons-react'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { eventLabel, fmtDateTime, fmtPct, fmtTime, pctTone } from './format'
import { cn } from '@/lib/utils'
import type { MomentumStudioState } from './useMomentumStudio'

export function EventsTable({ studio }: { studio: MomentumStudioState }) {
  const events = studio.status?.events || []
  const logs = studio.status?.logs || []
  const returns = studio.status?.snapshot?.returns
  const keys = studio.status?.snapshot?.visibleReturnKeys?.length
    ? studio.status.snapshot.visibleReturnKeys
    : ['5m', '15m', '30m', '60m', '2h', '8h', '24h', 'day']

  return (
    <Tabs defaultValue="returns" className="w-full flex-col justify-start gap-6">
      <div className="flex items-center justify-between px-4 lg:px-6">
        <TabsList className="hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:px-1 @4xl/main:flex">
          <TabsTrigger value="returns">Returns</TabsTrigger>
          <TabsTrigger value="events">
            Events <Badge variant="secondary">{events.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="activity">
            Activity <Badge variant="secondary">{logs.length}</Badge>
          </TabsTrigger>
        </TabsList>
        <TabsList className="@4xl/main:hidden">
          <TabsTrigger value="returns">Returns</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="events"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
      >
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Window</TableHead>
                <TableHead className="text-right">Move</TableHead>
                <TableHead>Notify</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length ? (
                events.slice(0, 30).map((ev, i) => (
                  <TableRow key={`${ev.detectedAt}-${i}`}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {fmtDateTime(ev.detectedAt || ev.notifiedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="px-1.5 text-muted-foreground"
                      >
                        {eventLabel(ev.eventType)}
                      </Badge>
                    </TableCell>
                    <TableCell>{ev.detectedWindow || '—'}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        pctTone(ev.movePercent),
                      )}
                    >
                      {fmtPct(ev.movePercent)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="px-1.5 text-muted-foreground"
                      >
                        {ev.shouldNotify ? (
                          <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                        ) : (
                          <IconLoader />
                        )}
                        {ev.shouldNotify ? 'Push' : 'Silent'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="returns" className="flex flex-col px-4 lg:px-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {keys.map((key) => {
            const val = returns?.[key]
            return (
              <div
                key={key}
                className="rounded-xl bg-muted/50 px-3 py-3"
              >
                <p className="text-xs text-muted-foreground">{key}</p>
                <p
                  className={cn(
                    'text-base font-medium tabular-nums',
                    pctTone(val),
                  )}
                >
                  {fmtPct(val)}
                </p>
              </div>
            )
          })}
        </div>
      </TabsContent>

      <TabsContent value="activity" className="flex flex-col px-4 lg:px-6">
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length ? (
                logs.slice(0, 40).map((log, i) => (
                  <TableRow key={`${log.at}-${i}`}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {fmtTime(log.at)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="px-1.5 text-muted-foreground"
                      >
                        {log.level || 'info'}
                      </Badge>
                    </TableCell>
                    <TableCell>{log.source || '—'}</TableCell>
                    <TableCell className="max-w-[36rem] truncate">
                      {log.message}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>
    </Tabs>
  )
}
