import { useEffect, useMemo, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { resolveYahooLogoUrl, type YahooLiveQuote } from '@/services/yahooApi'

function logoCandidates(
  ticker: string,
  quote?: YahooLiveQuote | null,
  companyName?: string | null,
): string[] {
  const out: string[] = []
  const name = String(companyName || quote?.longName || quote?.shortName || '')
    .trim()
    .toLowerCase()
  const slug = name
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-inc$|-corp$|-corporation$|-ltd$|-plc$|-co$/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug) {
    out.push(`https://s3-symbol-logo.tradingview.com/${slug}--big.svg`)
    out.push(`https://s3-symbol-logo.tradingview.com/${slug}.svg`)
  }
  const yahoo = resolveYahooLogoUrl(quote, ticker)
  if (yahoo) out.push(yahoo)
  const clean = String(ticker || '')
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, '')
  if (clean) {
    out.push(`https://storage.googleapis.com/iex/api/logos/${clean}.png`)
    out.push(`https://assets.parqet.com/logos/symbol/${clean}`)
  }
  return [...new Set(out.filter(Boolean))]
}

export function TickerLogo({
  ticker,
  quote,
  companyName,
}: {
  ticker: string
  quote?: YahooLiveQuote | null
  companyName?: string | null
}) {
  const [attempt, setAttempt] = useState(0)
  const candidates = useMemo(
    () => logoCandidates(ticker, quote, companyName),
    [ticker, quote, companyName],
  )

  useEffect(() => {
    setAttempt(0)
  }, [ticker, quote?.logoUrl, quote?.longName, quote?.shortName, companyName])

  const src = attempt < candidates.length ? candidates[attempt] : undefined
  const initials =
    String(ticker || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 2)
      .toUpperCase() || '?'

  return (
    <Avatar size="sm" className="rounded-md">
      {src ? (
        <AvatarImage
          src={src}
          alt=""
          className="rounded-md"
          referrerPolicy="no-referrer"
          onError={() =>
            setAttempt((i) => (i + 1 < candidates.length ? i + 1 : i + 1))
          }
        />
      ) : null}
      <AvatarFallback className="rounded-md text-[9px] font-medium">
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}
