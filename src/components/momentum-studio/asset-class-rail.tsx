import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { fmtPct, pctTone } from './format'
import { TickerLogo } from './ticker-logo'
import type { MomentumStudioState } from './useMomentumStudio'

const CLASS_LABEL: Record<string, string> = {
  equity: 'Stocks',
  index: 'Indices',
  forex: 'Forex',
  crypto: 'Crypto',
  commodity: 'Commodities',
}

export function AssetClassRail({ studio }: { studio: MomentumStudioState }) {
  const label = CLASS_LABEL[studio.assetClass] || 'List'
  const list = studio.classTickers

  return (
    <aside className="flex w-60 shrink-0 flex-col border-l bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{list.length}</p>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <SidebarMenu className="p-2">
          {studio.listLoading ? (
            <SidebarMenuItem>
              <SidebarMenuButton disabled>
                <span>Loading…</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : !list.length ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No {label.toLowerCase()} yet
            </p>
          ) : (
            list.map((tab) => {
              const q = studio.quotes[tab.ticker]
              const pct =
                q?.regularMarketChangePercent ??
                q?.preMarketChangePercent ??
                q?.postMarketChangePercent ??
                null
              return (
                <SidebarMenuItem key={tab.ticker}>
                  <SidebarMenuButton
                    isActive={tab.ticker === studio.activeTicker}
                    onClick={() => {
                      studio.setView('watchlist')
                      studio.setActiveTicker(tab.ticker)
                    }}
                  >
                    <TickerLogo
                      ticker={tab.ticker}
                      quote={q}
                      companyName={tab.label}
                    />
                    <span className="min-w-0 truncate">{tab.ticker}</span>
                    <span
                      className={cn(
                        'ml-auto tabular-nums text-xs',
                        pctTone(pct),
                      )}
                    >
                      {fmtPct(pct)}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })
          )}
        </SidebarMenu>
      </ScrollArea>
    </aside>
  )
}
