import type { EdgarFiling } from '@/types/edgar'
import { SectionCard, SimpleTable } from './shared'

export function RecentFilingsSection({ filings }: { filings: EdgarFiling[] }) {
  return (
    <SectionCard title="Recent Filings" description={`Latest ${filings.length} filings`}>
      <SimpleTable
        columns={[
          { key: 'form', label: 'Form' },
          { key: 'filingDate', label: 'Filed' },
          { key: 'accessionNumber', label: 'Accession No.' },
          { key: 'description', label: 'Description' },
          { key: 'link', label: '' },
        ]}
        rows={filings.map((filing) => ({
          form: filing.form,
          filingDate: filing.filingDate,
          accessionNumber: filing.accessionNumber,
          description: filing.primaryDocDescription || '—',
          link: (
            <a className="text-primary underline underline-offset-2" href={filing.filingUrl} rel="noreferrer" target="_blank">
              View
            </a>
          ),
        }))}
        emptyMessage="No filings found for this ticker."
      />
    </SectionCard>
  )
}
