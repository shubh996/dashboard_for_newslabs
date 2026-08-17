import {
  IconChartCandle,
  IconChartLine,
  IconCoin,
  IconCurrencyBitcoin,
  IconCurrencyDollar,
} from '@tabler/icons-react'

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { fmtPct, pctTone } from './format'
import type { ActiveEpisodeRow, AssetClassId, StudioTicker } from './types'

const MARKETS: {
  id: AssetClassId
  label: string
  icon: typeof IconChartLine
}[] = [
  { id: 'equity', label: 'Stocks', icon: IconChartLine },
  { id: 'index', label: 'Indices', icon: IconChartCandle },
  { id: 'forex', label: 'Forex', icon: IconCurrencyDollar },
  { id: 'crypto', label: 'Crypto', icon: IconCurrencyBitcoin },
  { id: 'commodity', label: 'Commodities', icon: IconCoin },
]

export function NavMarkets({
  assetClass,
  byClass,
  onSelectClass,
}: {
  assetClass: AssetClassId
  byClass: Partial<Record<AssetClassId, number>>
  onSelectClass: (id: AssetClassId) => void
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Markets</SidebarGroupLabel>
      <SidebarMenu>
        {MARKETS.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              tooltip={item.label}
              isActive={assetClass === item.id}
              onClick={() => onSelectClass(item.id)}
            >
              <item.icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge>{byClass[item.id] ?? 0}</SidebarMenuBadge>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

export function NavTickers({
  label,
  tickers,
  activeTicker,
  loading,
  episodeByTicker,
  quotes,
  onSelect,
}: {
  label: string
  tickers: StudioTicker[]
  activeTicker: string
  loading: boolean
  episodeByTicker: Record<string, ActiveEpisodeRow>
  quotes: Record<string, { regularMarketChangePercent?: number | null }>
  onSelect: (ticker: string) => void
}) {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {loading ? (
          <SidebarMenuItem>
            <SidebarMenuButton disabled>
              <span className="text-muted-foreground">Loading…</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : !tickers.length ? (
          <SidebarMenuItem>
            <SidebarMenuButton className="text-sidebar-foreground/70">
              <span>No symbols</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          tickers.map((tab) => {
            const pct = quotes[tab.ticker]?.regularMarketChangePercent ?? null
            const hot = Boolean(episodeByTicker[tab.ticker])
            return (
              <SidebarMenuItem key={tab.ticker}>
                <SidebarMenuButton
                  tooltip={tab.label}
                  isActive={tab.ticker === activeTicker}
                  onClick={() => onSelect(tab.ticker)}
                >
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      hot
                        ? episodeByTicker[tab.ticker]?.direction === 'DOWN'
                          ? 'bg-rose-500'
                          : 'bg-emerald-500'
                        : 'bg-muted-foreground/30',
                    )}
                  />
                  <span>{tab.ticker}</span>
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
    </SidebarGroup>
  )
}
