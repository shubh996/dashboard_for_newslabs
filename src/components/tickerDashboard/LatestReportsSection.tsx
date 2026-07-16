import type { LatestReportSnapshot } from '@/types/edgar'
import { KeyValueList, SectionCard } from './shared'

export function LatestReportsSection({ reports }: { reports: LatestReportSnapshot[] }) {
  return (
    <div className="flex flex-col gap-4">
      {reports.map((report) => (
        <SectionCard key={report.label} title={report.label === '10-K' ? '10-K (Annual Report)' : '10-Q (Quarterly Report)'}>
          {report.found ? (
            <KeyValueList
              pairs={[
                { label: 'Period of Report', value: report.periodOfReport || 'N/A' },
                { label: 'Filed', value: report.filingDate || 'N/A' },
                { label: 'Accession No.', value: report.accessionNumber || 'N/A' },
                {
                  label: 'Link',
                  value: report.filingUrl ? (
                    <a className="text-primary underline underline-offset-2" href={report.filingUrl} rel="noreferrer" target="_blank">
                      View filing
                    </a>
                  ) : (
                    'N/A'
                  ),
                },
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Not found.</p>
          )}
          {report.businessDescription ? (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold">Business Description (excerpt)</h3>
              <blockquote className="border-l-4 pl-3 text-sm text-muted-foreground">{report.businessDescription}…</blockquote>
            </div>
          ) : null}
          {report.riskFactors ? (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold">Risk Factors (excerpt)</h3>
              <blockquote className="border-l-4 pl-3 text-sm text-muted-foreground">{report.riskFactors}…</blockquote>
            </div>
          ) : null}
        </SectionCard>
      ))}
    </div>
  )
}
