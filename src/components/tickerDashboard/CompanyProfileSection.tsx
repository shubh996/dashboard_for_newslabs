import { Badge } from '@/components/ui/badge'
import type { CompanyProfile } from '@/types/edgar'
import { KeyValueList, SectionCard, StatGrid, formatCurrency, formatNumber } from './shared'

export function CompanyProfileSection({ profile }: { profile: CompanyProfile }) {
  const address = profile.businessAddress
  const addressLine = address
    ? [address.street1, address.street2, address.city, address.stateOrCountry, address.zipCode].filter(Boolean).join(', ')
    : 'N/A'

  return (
    <SectionCard title="Company Profile" description={`CIK ${profile.cik}`}>
      <StatGrid
        stats={[
          { label: 'Shares Outstanding', value: formatNumber(profile.sharesOutstanding) },
          { label: 'Public Float', value: formatCurrency(profile.publicFloat) },
          { label: 'Exchange', value: profile.exchanges.length ? profile.exchanges.join(', ') : 'N/A' },
          { label: 'Filer Category', value: profile.filerCategory || 'N/A' },
        ]}
      />
      <div className="mt-4">
        <KeyValueList
          pairs={[
            { label: 'Name', value: profile.name },
            { label: 'Ticker(s)', value: profile.tickers.join(', ') },
            { label: 'Industry (SIC)', value: `${profile.sic || 'N/A'} — ${profile.sicDescription || 'N/A'}` },
            { label: 'Fiscal Year End', value: profile.fiscalYearEnd || 'N/A' },
            { label: 'Entity Type', value: profile.entityType || 'N/A' },
            { label: 'State of Incorporation', value: profile.stateOfIncorporation || 'N/A' },
            { label: 'Business Address', value: addressLine },
            {
              label: 'Large Accelerated Filer',
              value: <Badge variant={profile.isLargeAcceleratedFiler ? 'default' : 'secondary'}>{profile.isLargeAcceleratedFiler ? 'Yes' : 'No'}</Badge>,
            },
            {
              label: 'Emerging Growth Company',
              value: <Badge variant={profile.isEmergingGrowthCompany ? 'default' : 'secondary'}>{profile.isEmergingGrowthCompany ? 'Yes' : 'No'}</Badge>,
            },
          ]}
        />
      </div>
    </SectionCard>
  )
}
