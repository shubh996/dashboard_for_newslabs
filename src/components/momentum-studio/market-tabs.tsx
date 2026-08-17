import {
  IconChartCandle,
  IconChartLine,
  IconCoin,
  IconCurrencyBitcoin,
  IconCurrencyDollar,
} from '@tabler/icons-react'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { AssetClassId } from './types'

export const MARKETS: {
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

export function MarketTabs({
  value,
  onChange,
}: {
  value: AssetClassId
  onChange: (id: AssetClassId) => void
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as AssetClassId)
      }}
      variant="outline"
      size="sm"
      className="justify-center"
    >
      {MARKETS.map((item) => (
        <ToggleGroupItem
          key={item.id}
          value={item.id}
          aria-label={item.label}
          className="gap-1.5 px-2.5"
        >
          <item.icon className="size-4" />
          <span className="hidden sm:inline">{item.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
