import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { FinancialStatement, FinancialsData } from '@/types/edgar'
import { formatCurrency, SectionCard, SectionEmpty } from './shared'

function formatValue(label: string, value: number | null) {
  if (value === null || value === undefined) return '—'
  if (label.startsWith('EPS')) return `$${value.toFixed(1)}`
  return formatCurrency(value)
}

function StatementTable({ statement }: { statement: FinancialStatement | null }) {
  if (!statement || !statement.rows.length) {
    return <SectionEmpty message="Not available for this filer." />
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground">Line Item</th>
            {statement.periods.map((period) => (
              <th key={period} className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                {period}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {statement.rows.map((row) => (
            <tr key={row.label} className="border-b last:border-0 hover:bg-muted/30">
              <td className="whitespace-nowrap px-3 py-2">{row.label}</td>
              {statement.periods.map((period) => (
                <td key={period} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {formatValue(row.label, row.values[period] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function FinancialsSection({ annual, quarterly }: { annual: FinancialsData; quarterly: FinancialsData }) {
  return (
    <SectionCard title="Financial Statements" description="From SEC XBRL company facts">
      <Tabs defaultValue="annual">
        <TabsList>
          <TabsTrigger value="annual">Annual</TabsTrigger>
          <TabsTrigger value="quarterly">Quarterly</TabsTrigger>
        </TabsList>

        <TabsContent value="annual" className="mt-4 flex flex-col gap-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Income Statement</h3>
            <StatementTable statement={annual.incomeStatement} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Balance Sheet</h3>
            <StatementTable statement={annual.balanceSheet} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Cash Flow Statement</h3>
            <StatementTable statement={annual.cashFlowStatement} />
          </div>
        </TabsContent>

        <TabsContent value="quarterly" className="mt-4 flex flex-col gap-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Income Statement</h3>
            <StatementTable statement={quarterly.incomeStatement} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Balance Sheet</h3>
            <StatementTable statement={quarterly.balanceSheet} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Cash Flow Statement</h3>
            <StatementTable statement={quarterly.cashFlowStatement} />
          </div>
        </TabsContent>
      </Tabs>
    </SectionCard>
  )
}
