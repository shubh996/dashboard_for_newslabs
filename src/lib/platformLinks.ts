/**
 * Desk Settings → Platforms: quick links to consoles used by this stack.
 * Override any URL with VITE_PLATFORM_<ID>_URL (see .env.example).
 */

export type PlatformIconId =
  | 'github'
  | 'railway'
  | 'railway-api'
  | 'cloudflare'
  | 'cloudflare-pages'
  | 'supabase'
  | 'perplexity'
  | 'gemini'
  | 'grok'
  | 'firecrawl'
  | 'expo'
  | 'sql'
  | 'table-editor'
  | 'database'
  | 'details'
  | 'link'

export type PlatformLink = {
  id: string
  label: string
  description: string
  url: string
  icon: PlatformIconId
  /** Nested Supabase console sections (SQL / Table / Database / Details). */
  supabaseSections?: SupabaseSection[]
}

export type SupabaseSection = {
  id: string
  label: string
  description: string
  icon: PlatformIconId
  /** Open this dashboard URL (SQL / editor / database). */
  url?: string
  /** Details panel: show project API URL only (no keys). */
  showProjectUrl?: boolean
}

function envUrl(key: string): string {
  try {
    const v = String(
      (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[key] ||
        '',
    ).trim()
    return v
  } catch {
    return ''
  }
}

export function getSupabaseProjectRef(): string {
  const raw = envUrl('VITE_SUPABASE_URL') || envUrl('SUPABASE_URL') || ''
  try {
    const host = new URL(raw).hostname
    const ref = host.split('.')[0]
    if (ref && ref !== 'supabase') return ref
  } catch {
    /* ignore */
  }
  return ''
}

export function getSupabaseProjectApiUrl(): string {
  const raw = envUrl('VITE_SUPABASE_URL') || envUrl('SUPABASE_URL') || ''
  if (raw) {
    try {
      return new URL(raw).origin
    } catch {
      return raw.replace(/\/+$/, '')
    }
  }
  const ref = getSupabaseProjectRef()
  return ref ? `https://${ref}.supabase.co` : ''
}

function supabaseProjectDashboardUrl(): string {
  const ref = getSupabaseProjectRef()
  if (ref) {
    return `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}`
  }
  return 'https://supabase.com/dashboard'
}

function supabaseSectionUrls(ref: string): SupabaseSection[] {
  const base = ref
    ? `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}`
    : 'https://supabase.com/dashboard'
  return [
    {
      id: 'sql-editor',
      label: 'SQL Editor',
      description: 'Run queries',
      icon: 'sql',
      url: `${base}/sql/new`,
    },
    {
      id: 'table-editor',
      label: 'Table Editor',
      description: 'Browse / edit rows',
      icon: 'table-editor',
      url: `${base}/editor`,
    },
    {
      id: 'database',
      label: 'Database',
      description: 'Tables · schemas',
      icon: 'database',
      url: `${base}/database/tables`,
    },
    {
      id: 'details',
      label: 'Details',
      description: 'Project URL',
      icon: 'details',
      showProjectUrl: true,
    },
  ]
}

function railwayServiceUrl(): string {
  return envUrl('VITE_API_BASE_URL').replace(/\/+$/, '')
}

/** Ordered list for Settings → Platforms hover submenu. */
export function getDeskPlatformLinks(): PlatformLink[] {
  const overrides = (id: string, fallback: string) =>
    envUrl(`VITE_PLATFORM_${id.toUpperCase().replace(/-/g, '_')}_URL`) ||
    fallback

  const supabaseRef = getSupabaseProjectRef()
  const supabaseBase = overrides('supabase', supabaseProjectDashboardUrl())

  const links: PlatformLink[] = [
    {
      id: 'github',
      label: 'GitHub',
      description: 'Source · dashboard_for_newslabs',
      icon: 'github',
      url: overrides(
        'github',
        'https://github.com/shubh996/dashboard_for_newslabs',
      ),
    },
    {
      id: 'railway',
      label: 'Railway',
      description: 'API host console',
      icon: 'railway',
      url: overrides('railway', 'https://railway.app/dashboard'),
    },
    {
      id: 'cloudflare',
      label: 'Cloudflare',
      description: 'Pages · Workers · DNS',
      icon: 'cloudflare',
      url: overrides('cloudflare', 'https://dash.cloudflare.com'),
    },
    {
      id: 'cloudflare-pages',
      label: 'Cloudflare Pages (live)',
      description: 'Public front-end',
      icon: 'cloudflare-pages',
      url: overrides(
        'cloudflare_pages',
        'https://dashboard-for-newslabs.pages.dev',
      ),
    },
    {
      id: 'supabase',
      label: 'Supabase',
      description: 'SQL · tables · details',
      icon: 'supabase',
      url: supabaseBase,
      supabaseSections: supabaseSectionUrls(supabaseRef),
    },
    {
      id: 'perplexity',
      label: 'Perplexity',
      description: 'API keys · usage',
      icon: 'perplexity',
      url: overrides(
        'perplexity',
        'https://www.perplexity.ai/account/api/group',
      ),
    },
    {
      id: 'gemini',
      label: 'Gemini',
      description: 'Google AI Studio',
      icon: 'gemini',
      url: overrides('gemini', 'https://aistudio.google.com/app/apikey'),
    },
    {
      id: 'grok',
      label: 'Grok / xAI',
      description: 'xAI console',
      icon: 'grok',
      url: overrides('grok', 'https://console.x.ai/'),
    },
    {
      id: 'firecrawl',
      label: 'Firecrawl',
      description: 'Scrape API · usage',
      icon: 'firecrawl',
      url: overrides('firecrawl', 'https://www.firecrawl.dev/app'),
    },
    {
      id: 'expo',
      label: 'Expo',
      description: 'Push / mobile builds',
      icon: 'expo',
      url: overrides('expo', 'https://expo.dev/'),
    },
  ]

  const railwayLive = railwayServiceUrl()
  if (railwayLive) {
    links.splice(2, 0, {
      id: 'railway-api',
      label: 'Railway API (live)',
      description: railwayLive.replace(/^https?:\/\//, ''),
      icon: 'railway-api',
      url: overrides('railway_api', railwayLive),
    })
  }

  return links.filter((l) => Boolean(l.url))
}

export function openPlatformLink(url: string) {
  const href = String(url || '').trim()
  if (!href) return
  try {
    window.open(href, '_blank', 'noopener,noreferrer')
  } catch {
    window.location.assign(href)
  }
}

export async function copyPlatformText(text: string): Promise<boolean> {
  const value = String(text || '').trim()
  if (!value) return false
  try {
    await navigator.clipboard?.writeText(value)
    return true
  } catch {
    return false
  }
}
