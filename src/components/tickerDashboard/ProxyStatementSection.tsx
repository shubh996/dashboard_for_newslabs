import type { ProxyStatementData } from '@/types/edgar'
import { compactDollarAmountsInText, KeyValueList, SectionCard, SectionEmpty } from './shared'

function formatCell(value: string | number | null) {
  if (value === null || value === undefined) return '—'
  return typeof value === 'string' ? compactDollarAmountsInText(value) : value
}

function GenericTable({ rows }: { rows: Record<string, string | number | null>[] }) {
  if (!rows.length) return <SectionEmpty message="Not parsed for this filing." />
  const columns = Object.keys(rows[0])
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            {columns.map((col) => (
              <th key={col} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b last:border-0 hover:bg-muted/30">
              {columns.map((col) => (
                <td key={col} className="whitespace-nowrap px-3 py-2">
                  {formatCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ProxyStatementSection({ data }: { data: ProxyStatementData }) {
  if (!data.found) {
    return (
      <SectionCard title="Proxy Statement (DEF 14A)">
        <SectionEmpty message="No DEF 14A proxy statement found for this company." />
      </SectionCard>
    )
  }

  return (
    <SectionCard title="Proxy Statement (DEF 14A)" description="Executive compensation & governance -- best-effort table extraction from the filing HTML">
      <KeyValueList
        pairs={[
          { label: 'Filed', value: data.filingDate || 'N/A' },
          { label: 'Accession No.', value: data.accessionNumber || 'N/A' },
          {
            label: 'Link',
            value: data.filingUrl ? (
              <a className="text-primary underline underline-offset-2" href={data.filingUrl} rel="noreferrer" target="_blank">
                View filing
              </a>
            ) : (
              'N/A'
            ),
          },
        ]}
      />

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold">Summary Compensation Table (Named Executive Officers)</h3>
        <GenericTable rows={data.summaryCompensationTable} />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold">Director Compensation</h3>
        <GenericTable rows={data.directorCompensationTable} />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold">Beneficial Ownership (Major Holders & Insiders)</h3>
        <GenericTable rows={data.beneficialOwnership} />
      </div>
    </SectionCard>
  )
}
