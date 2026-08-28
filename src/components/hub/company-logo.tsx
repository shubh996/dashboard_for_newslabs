import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import {
  resolveYahooLogoUrl,
  type YahooLiveQuote,
} from '@/services/yahooApi'

function tradingViewSymbolUrl(ticker: string) {
  const t = String(ticker || '')
    .trim()
    .toUpperCase()
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(t)}`
}

/** Best-effort company logo: TradingView CDN slug → Yahoo/IEX chain */
export function companyLogoCandidates(
  ticker: string,
  companyName?: string | null,
  quote?: YahooLiveQuote | null,
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

/** Circular company logo with multi-CDN fallback chain */
export function CompanyLogo({
  ticker,
  companyName,
  quote,
  size = 'md',
  className,
  asLink = false,
}: {
  ticker: string
  companyName?: string | null
  quote?: YahooLiveQuote | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Wrap in TradingView chart link (detail header) */
  asLink?: boolean
}) {
  const [attempt, setAttempt] = useState(0)
  const candidates = companyLogoCandidates(ticker, companyName, quote)
  useEffect(() => {
    setAttempt(0)
  }, [ticker, companyName, quote?.logoUrl, quote?.longName, quote?.shortName])
  const src = attempt < candidates.length ? candidates[attempt] : null
  const dim =
    size === 'sm' ? 'size-7' : size === 'lg' ? 'size-11' : 'size-9'
  const textSize =
    size === 'sm' ? 'text-[9px]' : size === 'lg' ? 'text-[11px]' : 'text-[10px]'
  const inner = (
    <>
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          className="size-full rounded-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() =>
            setAttempt((i) => (i + 1 < candidates.length ? i + 1 : i + 1))
          }
        />
      ) : (
        <span
          className={cn(
            'font-mono font-semibold text-muted-foreground',
            textSize,
          )}
        >
          {String(ticker || '??')
            .replace(/[^A-Za-z0-9]/g, '')
            .slice(0, 2)
            .toUpperCase() || '??'}
        </span>
      )}
    </>
  )
  const shellClass = cn(
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted/40',
    dim,
    className,
  )
  if (asLink) {
    return (
      <a
        href={tradingViewSymbolUrl(ticker)}
        target="_blank"
        rel="noopener noreferrer"
        className={shellClass}
        title={`Open ${ticker} on TradingView`}
        aria-label={`${companyName || ticker} logo`}
      >
        {inner}
      </a>
    )
  }
  return (
    <span className={shellClass} aria-hidden={!src}>
      {inner}
    </span>
  )
}
