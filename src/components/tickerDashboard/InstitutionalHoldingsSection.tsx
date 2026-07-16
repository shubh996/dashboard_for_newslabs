import { Link } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSavedEntities } from '@/hooks/useSavedEntities'
import type { InstitutionalHoldingsData } from '@/types/edgar'
import { SavedBadge, SectionCard, SimpleTable, StatGrid, formatCurrency, formatNumber } from './shared'

function HoldersTable({ data, title }: { data: InstitutionalHoldingsData; title: string }) {
  const { isManagerSaved } = useSavedEntities()
  const totalValue = data.holders.reduce((sum, h) => sum + (h.valueUsd || 0), 0)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Based on the latest Form 13F-HR filed by each of a curated list of well-known institutional managers -- not an
        exhaustive scan of all 13F filers.
      </p>
      <StatGrid
        stats={[
          { label: `${title} Holding`, value: data.holders.length },
          { label: 'Combined Disclosed Value', value: formatCurrency(totalValue) },
          { label: 'Managers Checked', value: data.managersChecked },
          { label: 'Managers Failed', value: data.managersFailed },
        ]}
      />
      <SimpleTable
        columns={[
          { key: 'manager', label: 'Manager' },
          { key: 'shares', label: 'Shares', align: 'right' },
          { key: 'value', label: 'Value', align: 'right' },
          { key: 'filed', label: '13F Filed' },
          { key: 'link', label: '' },
        ]}
        rows={data.holders.map((holder) => ({
          manager: holder.cik ? (
            <Link
              className="flex items-center gap-1.5 text-primary underline underline-offset-2"
              to={`/dashboard/ticker/manager/${holder.cik}${isManagerSaved(holder.cik) ? '?source=saved' : ''}`}
            >
              {isManagerSaved(holder.cik) ? <SavedBadge /> : null}
              {holder.managerName}
            </Link>
          ) : (
            holder.managerName
          ),
          shares: formatNumber(holder.shares),
          value: formatCurrency(holder.valueUsd),
          filed: holder.filingDate || 'N/A',
          link: holder.filingUrl ? (
            <a className="text-primary underline underline-offset-2" href={holder.filingUrl} rel="noreferrer" target="_blank">
              Source
            </a>
          ) : null,
        }))}
        emptyMessage="None of the checked institutions currently report holding this ticker."
      />
    </div>
  )
}

export function InstitutionalHoldingsSection({
  hedgeFund,
  investmentFund,
}: {
  hedgeFund: InstitutionalHoldingsData
  investmentFund: InstitutionalHoldingsData
}) {
  return (
    <SectionCard title="Institutional Holdings" description="13F-HR filings from curated large managers">
      <Tabs defaultValue="hedge-fund">
        <TabsList>
          <TabsTrigger value="hedge-fund">Hedge Funds & Institutions</TabsTrigger>
          <TabsTrigger value="investment-fund">Investment / Mutual Funds</TabsTrigger>
        </TabsList>
        <TabsContent value="hedge-fund" className="mt-4">
          <HoldersTable data={hedgeFund} title="Institutions" />
        </TabsContent>
        <TabsContent value="investment-fund" className="mt-4">
          <HoldersTable data={investmentFund} title="Fund Managers" />
        </TabsContent>
      </Tabs>
    </SectionCard>
  )
}
