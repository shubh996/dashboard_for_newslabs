import type {
  ComponentProps,
  ComponentType,
  ReactNode,
  SVGProps,
} from 'react'
import {
  AtSign,
  BarChart3,
  Bitcoin,
  Bot,
  Building2,
  CandlestickChart,
  ChevronRight,
  Cloud,
  Code2,
  Coins,
  Database,
  DollarSign,
  ExternalLink,
  Flame,
  Globe,
  HardDrive,
  Hexagon,
  Image,
  Landmark,
  LayoutDashboard,
  LineChart,
  Newspaper,
  Radar,
  ScanSearch,
  Server,
  Settings,
  Smartphone,
  Sparkles,
  Train,
  TrendingUp,
  Users,
  Wheat,
} from 'lucide-react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { fmtEpisodeNo, fmtPct } from './format'
import { NavBrand } from './nav-user'
import type { AssetClassId } from './types'
import type { MomentumStudioState } from './useMomentumStudio'

type IconType = ComponentType<SVGProps<SVGSVGElement>>

const ASSET_ITEMS: {
  id: AssetClassId
  label: string
  icon: typeof LineChart
}[] = [
  { id: 'equity', label: 'Stocks', icon: LineChart },
  { id: 'index', label: 'Indices', icon: BarChart3 },
  { id: 'forex', label: 'Forex', icon: DollarSign },
  { id: 'crypto', label: 'Crypto', icon: Bitcoin },
  { id: 'commodity', label: 'Commodities', icon: Wheat },
]

const SUPABASE_PROJECT = 'ebcjsmpqogbwaxypgllh'
const RAILWAY_API_ORIGIN =
  'https://dashboardfornewslabs-production.up.railway.app'
const CLOUDFLARE_PAGES_DASH =
  'https://dash.cloudflare.com/6e16b40b9e538c30251f8a763797de41/pages/view/dashboard-for-newslabs'
const CLOUDFLARE_PAGES_LIVE = 'https://dashboard-for-newslabs.pages.dev'
const GITHUB_REPO = 'https://github.com/shubh996/dashboard_for_newslabs'

type ServiceSubLink = { title: string; href: string }

type ServiceItem =
  | {
      kind: 'link'
      title: string
      tooltip: string
      href: string
      icon: IconType
    }
  | {
      kind: 'collapsible'
      title: string
      tooltip: string
      icon: IconType
      links: ServiceSubLink[]
    }
  | {
      kind: 'inApp'
      title: string
      tooltip: string
      icon: IconType
      view: 'perplexity'
      external?: ServiceSubLink[]
    }

type ServiceCategory = {
  id: string
  label: string
  items: ServiceItem[]
}

const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    id: 'hosting',
    label: 'Hosting',
    items: [
      {
        kind: 'collapsible',
        title: 'Cloudflare',
        tooltip: 'Pages frontend host',
        icon: Cloud,
        links: [
          { title: 'Pages project', href: CLOUDFLARE_PAGES_DASH },
          { title: 'Live site', href: CLOUDFLARE_PAGES_LIVE },
          {
            title: 'Dashboard home',
            href: 'https://dash.cloudflare.com/',
          },
        ],
      },
      {
        kind: 'link',
        title: 'Docker',
        tooltip: 'API image / Railway builder',
        href: 'https://hub.docker.com/',
        icon: HardDrive,
      },
      {
        kind: 'collapsible',
        title: 'GitHub',
        tooltip: 'Source repo',
        icon: Code2,
        links: [
          { title: 'Repository', href: GITHUB_REPO },
          { title: 'Actions', href: `${GITHUB_REPO}/actions` },
          { title: 'Commits', href: `${GITHUB_REPO}/commits` },
        ],
      },
      {
        kind: 'link',
        title: 'Hetzner',
        tooltip: 'Optional VPS API host',
        href: 'https://console.hetzner.cloud/',
        icon: Server,
      },
      {
        kind: 'collapsible',
        title: 'Railway',
        tooltip: 'Always-on Node API host',
        icon: Train,
        links: [
          { title: 'Dashboard', href: 'https://railway.com/dashboard' },
          { title: 'Live API', href: RAILWAY_API_ORIGIN },
          { title: 'Health check', href: `${RAILWAY_API_ORIGIN}/api/health` },
        ],
      },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    items: [
      {
        kind: 'link',
        title: 'PostHog',
        tooltip: 'Trigger product analytics',
        href: 'https://eu.posthog.com/project/239556/persons',
        icon: Radar,
      },
      {
        kind: 'collapsible',
        title: 'Supabase',
        tooltip: 'Postgres, auth storage, edge cron',
        icon: Database,
        links: [
          {
            title: 'Project home',
            href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}`,
          },
          {
            title: 'Data editor',
            href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/editor`,
          },
          {
            title: 'SQL editor',
            href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/sql/new`,
          },
          {
            title: 'Edge Functions',
            href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/functions`,
          },
          {
            title: 'Settings',
            href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/settings/general`,
          },
        ],
      },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    items: [
      {
        kind: 'link',
        title: 'DeepSeek',
        tooltip: 'Model used via Perplexity (deepseek-v4-flash)',
        href: 'https://platform.deepseek.com/',
        icon: Bot,
      },
      {
        kind: 'collapsible',
        title: 'Firecrawl',
        tooltip: 'Web scrape for TE / finance pages',
        icon: Flame,
        links: [
          { title: 'App / usage', href: 'https://www.firecrawl.dev/app' },
          { title: 'Docs', href: 'https://docs.firecrawl.dev/' },
          {
            title: 'API reference',
            href: 'https://docs.firecrawl.dev/api-reference/introduction',
          },
        ],
      },
      {
        kind: 'collapsible',
        title: 'Gemini',
        tooltip: 'Market classification (Google AI)',
        icon: Sparkles,
        links: [
          { title: 'AI Studio', href: 'https://aistudio.google.com/' },
          { title: 'API keys', href: 'https://aistudio.google.com/apikey' },
          {
            title: 'Cloud console',
            href: 'https://console.cloud.google.com/apis/credentials',
          },
        ],
      },
      {
        kind: 'inApp',
        title: 'Perplexity',
        tooltip: 'Research + in-app usage / billing',
        icon: ScanSearch,
        view: 'perplexity',
        external: [
          {
            title: 'API billing',
            href: 'https://www.perplexity.ai/account/api/billing',
          },
          {
            title: 'API settings',
            href: 'https://www.perplexity.ai/account/api',
          },
          { title: 'Finance pages', href: 'https://www.perplexity.ai/finance' },
        ],
      },
    ],
  },
  {
    id: 'market-data',
    label: 'Market data',
    items: [
      {
        kind: 'collapsible',
        title: 'Alpha Vantage',
        tooltip: 'Market news provider',
        icon: TrendingUp,
        links: [
          {
            title: 'API key support',
            href: 'https://www.alphavantage.co/support/#api-key',
          },
          {
            title: 'Documentation',
            href: 'https://www.alphavantage.co/documentation/',
          },
          { title: 'Home', href: 'https://www.alphavantage.co/' },
        ],
      },
      {
        kind: 'link',
        title: 'DuckDuckGo Icons',
        tooltip: 'Favicon fallback for tickers',
        href: 'https://icons.duckduckgo.com/',
        icon: Image,
      },
      {
        kind: 'link',
        title: 'Financial Modeling Prep',
        tooltip: 'Ticker logo CDN fallback',
        href: 'https://site.financialmodelingprep.com/',
        icon: Image,
      },
      {
        kind: 'collapsible',
        title: 'Finnhub',
        tooltip: 'Company / market news',
        icon: Newspaper,
        links: [
          { title: 'Dashboard', href: 'https://finnhub.io/dashboard' },
          { title: 'API docs', href: 'https://finnhub.io/docs/api' },
          { title: 'Home', href: 'https://finnhub.io/' },
        ],
      },
      {
        kind: 'link',
        title: 'Google Favicons',
        tooltip: 's2 favicon / logo fallback',
        href: 'https://www.google.com/s2/favicons',
        icon: Image,
      },
      {
        kind: 'link',
        title: 'IEX Logos',
        tooltip: 'storage.googleapis.com/iex logo CDN',
        href: 'https://iexcloud.io/',
        icon: Image,
      },
      {
        kind: 'link',
        title: 'Logo.dev',
        tooltip: 'Domain logo fallback',
        href: 'https://www.logo.dev/',
        icon: Image,
      },
      {
        kind: 'collapsible',
        title: 'NewsAPI',
        tooltip: 'Everything news search',
        icon: Newspaper,
        links: [
          { title: 'Account', href: 'https://newsapi.org/account' },
          { title: 'Docs', href: 'https://newsapi.org/docs' },
          { title: 'Home', href: 'https://newsapi.org/' },
        ],
      },
      {
        kind: 'link',
        title: 'Parqet Logos',
        tooltip: 'assets.parqet.com ticker logos',
        href: 'https://www.parqet.com/',
        icon: Image,
      },
      {
        kind: 'collapsible',
        title: 'Polygon',
        tooltip: 'Market news (polygon.io)',
        icon: Hexagon,
        links: [
          { title: 'Dashboard', href: 'https://polygon.io/dashboard' },
          { title: 'Docs', href: 'https://polygon.io/docs' },
          { title: 'Home', href: 'https://polygon.io/' },
        ],
      },
      {
        kind: 'collapsible',
        title: 'SEC EDGAR',
        tooltip: 'Filings, 13F, insiders, congress',
        icon: Landmark,
        links: [
          {
            title: 'Search & access',
            href: 'https://www.sec.gov/edgar/search-and-access',
          },
          { title: 'data.sec.gov', href: 'https://data.sec.gov/' },
          {
            title: 'Company tickers',
            href: 'https://www.sec.gov/files/company_tickers.json',
          },
        ],
      },
      {
        kind: 'link',
        title: 'Synth Finance',
        tooltip: 'logo.synthfinance.com ticker logos',
        href: 'https://synthfinance.com/',
        icon: Image,
      },
      {
        kind: 'collapsible',
        title: 'Trading Economics',
        tooltip: 'Commodities / FX / crypto narratives',
        icon: Globe,
        links: [
          { title: 'Home', href: 'https://tradingeconomics.com/' },
          {
            title: 'Commodities',
            href: 'https://tradingeconomics.com/commodities',
          },
          {
            title: 'Currencies',
            href: 'https://tradingeconomics.com/currencies',
          },
        ],
      },
      {
        kind: 'collapsible',
        title: 'TradingView',
        tooltip: 'Embedded charts + symbol pages',
        icon: CandlestickChart,
        links: [
          { title: 'Home', href: 'https://www.tradingview.com/' },
          {
            title: 'Widget docs',
            href: 'https://www.tradingview.com/widget-docs/',
          },
          {
            title: 'Charting library',
            href: 'https://www.tradingview.com/charting-library-docs/',
          },
        ],
      },
      {
        kind: 'collapsible',
        title: 'X (Twitter)',
        tooltip: 'Recent search API for social',
        icon: AtSign,
        links: [
          { title: 'Developer portal', href: 'https://developer.x.com/' },
          {
            title: 'Apps',
            href: 'https://developer.x.com/en/portal/projects-and-apps',
          },
          { title: 'X home', href: 'https://x.com/' },
        ],
      },
      {
        kind: 'collapsible',
        title: 'Yahoo Finance',
        tooltip: 'Quotes, charts, stream, yfinance',
        icon: Coins,
        links: [
          { title: 'Finance home', href: 'https://finance.yahoo.com/' },
          {
            title: 'yfinance (Python)',
            href: 'https://github.com/ranaroussi/yfinance',
          },
          {
            title: 'yahoo-finance2 (npm)',
            href: 'https://www.npmjs.com/package/yahoo-finance2',
          },
        ],
      },
    ],
  },
  {
    id: 'mobile',
    label: 'Mobile',
    items: [
      {
        kind: 'collapsible',
        title: 'Expo',
        tooltip: 'Push notifications to phones',
        icon: Smartphone,
        links: [
          { title: 'Expo home', href: 'https://expo.dev/' },
          {
            title: 'Push tool',
            href: 'https://expo.dev/notifications',
          },
          {
            title: 'Push docs',
            href: 'https://docs.expo.dev/push-notifications/overview/',
          },
          {
            title: 'Access tokens',
            href: 'https://expo.dev/settings/access-tokens',
          },
        ],
      },
      {
        kind: 'link',
        title: '9AM site',
        tooltip: 'Product / User-Agent origin',
        href: 'https://9am.site',
        icon: Building2,
      },
    ],
  },
]

function ServiceMenuItem({
  item,
  studio,
}: {
  item: ServiceItem
  studio: MomentumStudioState
}) {
  if (item.kind === 'link') {
    const Icon = item.icon
    return (
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={item.tooltip} asChild>
          <a href={item.href} target="_blank" rel="noreferrer">
            <Icon />
            <span>{item.title}</span>
            <ExternalLink className="ml-auto size-3.5 opacity-50" />
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  if (item.kind === 'inApp') {
    const Icon = item.icon
    const external = item.external || []
    if (!external.length) {
      return (
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={item.tooltip}
            isActive={studio.view === item.view}
            onClick={() => studio.setView(item.view)}
          >
            <Icon />
            <span>{item.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      )
    }
    return (
      <Collapsible asChild defaultOpen={false} className="group/collapsible">
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              tooltip={item.tooltip}
              isActive={studio.view === item.view}
            >
              <Icon />
              <span>{item.title}</span>
              <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              <SidebarMenuSubItem>
                <SidebarMenuSubButton
                  isActive={studio.view === item.view}
                  onClick={() => studio.setView(item.view)}
                >
                  <span>Studio usage</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
              {external.map((link) => (
                <SidebarMenuSubItem key={link.href}>
                  <SidebarMenuSubButton asChild>
                    <a href={link.href} target="_blank" rel="noreferrer">
                      <span>{link.title}</span>
                    </a>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    )
  }

  const Icon = item.icon
  return (
    <Collapsible asChild defaultOpen={false} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.tooltip}>
            <Icon />
            <span>{item.title}</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.links.map((link) => (
              <SidebarMenuSubItem key={`${item.title}-${link.title}`}>
                <SidebarMenuSubButton asChild>
                  <a href={link.href} target="_blank" rel="noreferrer">
                    <span>{link.title}</span>
                  </a>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function SidebarSection({
  label,
  children,
  defaultOpen = false,
}: {
  label: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/section">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 outline-none">
            <span className="truncate">{label}</span>
            <ChevronRight className="ml-auto size-3.5 opacity-60 transition-transform duration-200 group-data-[state=open]/section:rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarMenu>{children}</SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

export function AppSidebar({
  studio,
  ...props
}: ComponentProps<typeof Sidebar> & {
  studio: MomentumStudioState
}) {
  const userCount = studio.tickers.reduce(
    (n, t) => n + (t.subscriberCount || 0),
    0,
  )

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <NavBrand studio={studio} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarSection label="Overview" defaultOpen>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Dashboard"
              isActive={studio.view === 'overview'}
              onClick={() => {
                studio.clearRailEntityFocus()
                studio.setView('overview')
              }}
            >
              <LayoutDashboard />
              <span>Dashboard</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              onClick={() => studio.setSettingsOpen(true)}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarSection>

        <SidebarSection label="Asset class" defaultOpen>
          {ASSET_ITEMS.map((item) => {
            const Icon = item.icon
            const active =
              studio.assetClass === item.id && studio.view === 'watchlist'
            const list = studio.tickers.filter((t) => t.assetClass === item.id)
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  tooltip={item.label}
                  isActive={active}
                  onClick={() => {
                    studio.setAssetClass(item.id)
                    studio.setView('watchlist')
                    if (
                      !list.some((t) => t.ticker === studio.activeTicker) &&
                      list[0]
                    ) {
                      studio.setActiveTicker(list[0].ticker)
                    }
                  }}
                >
                  <Icon />
                  <span>{item.label}</span>
                  <SidebarMenuBadge>{list.length}</SidebarMenuBadge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarSection>

        <SidebarSection label="Active episodes" defaultOpen>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Active episodes"
              isActive={studio.view === 'episodes'}
              onClick={() => {
                studio.clearRailEntityFocus()
                studio.setView('episodes')
              }}
            >
              <BarChart3 />
              <span>Active episodes</span>
              <SidebarMenuBadge>
                {studio.activeEpisodes.length}
              </SidebarMenuBadge>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {studio.activeEpisodes.slice(0, 8).map((row) => (
            <SidebarMenuItem
              key={`${row.ticker}-${row.episodeNo || row.episodeStartedAt}`}
              className="group-data-[collapsible=icon]:hidden"
            >
              <SidebarMenuButton
                size="sm"
                isActive={
                  studio.view === 'episodes' &&
                  String(row.ticker || '').toUpperCase() ===
                    String(studio.activeTicker || '').toUpperCase()
                }
                onClick={() => studio.selectActiveEpisode(row)}
              >
                <span>{row.ticker}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {fmtEpisodeNo(row.episodeNo) ||
                    fmtPct(row.currentMovePercent)}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarSection>

        <SidebarSection label="Users" defaultOpen>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Users"
              isActive={studio.view === 'users'}
              onClick={() => studio.setView('users')}
            >
              <Users />
              <span>Users</span>
              <SidebarMenuBadge>{userCount}</SidebarMenuBadge>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarSection>

        {SERVICE_CATEGORIES.map((category) => (
          <SidebarSection key={category.id} label={category.label}>
            {category.items.map((item) => (
              <ServiceMenuItem
                key={`${category.id}-${item.title}`}
                item={item}
                studio={studio}
              />
            ))}
          </SidebarSection>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
