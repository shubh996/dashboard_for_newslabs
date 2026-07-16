import { Badge } from '@/components/ui/badge'
import type { InsiderTransaction } from '@/types/edgar'
import { SectionCard, SimpleTable, formatCurrency, formatNumber } from './shared'

function codeTone(code: string | null) {
  if (code === 'P' || code === 'A') return 'default'
  if (code === 'S' || code === 'D') return 'destructive'
  return 'secondary'
}

export function InsiderTransactionsSection({ transactions }: { transactions: InsiderTransaction[] }) {
  return (
    <SectionCard title="Insider Transactions" description="Forms 3, 4, and 5">
      <SimpleTable
        columns={[
          { key: 'transactionDate', label: 'Date' },
          { key: 'insider', label: 'Insider' },
          { key: 'type', label: 'Type' },
          { key: 'shares', label: 'Shares', align: 'right' },
          { key: 'price', label: 'Price', align: 'right' },
          { key: 'value', label: 'Value', align: 'right' },
          { key: 'ownedAfter', label: 'Owned After', align: 'right' },
          { key: 'link', label: '' },
        ]}
        rows={transactions.map((tx) => ({
          transactionDate: tx.transactionDate || tx.filingDate,
          insider: (
            <div>
              <div>{tx.insiderName || 'N/A'}</div>
              {tx.insiderTitle ? <div className="text-xs text-muted-foreground">{tx.insiderTitle}</div> : null}
            </div>
          ),
          type: (
            <Badge variant={codeTone(tx.transactionCode)}>
              {tx.transactionCodeLabel || tx.transactionCode || `Form ${tx.formType}`}
            </Badge>
          ),
          shares: formatNumber(tx.shares),
          price: tx.pricePerShare !== null ? formatCurrency(tx.pricePerShare) : '—',
          value: formatCurrency(tx.value),
          ownedAfter: formatNumber(tx.sharesOwnedAfter),
          link: (
            <a className="text-primary underline underline-offset-2" href={tx.sourceUrl} rel="noreferrer" target="_blank">
              Filing
            </a>
          ),
        }))}
        emptyMessage="No insider transaction filings found."
      />
    </SectionCard>
  )
}
