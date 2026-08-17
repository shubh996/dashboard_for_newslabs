import type { ComponentProps } from 'react'
import {
  BarChart3,
  Bitcoin,
  ChevronRight,
  Cloud,
  Code2,
  Database,
  DollarSign,
  LayoutDashboard,
  LineChart,
  PanelLeft,
  Sparkles,
  Users,
  Wheat,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
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
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { fmtEpisodeNo, fmtPct } from './format'
import { NavUser } from './nav-user'
import type { AssetClassId } from './types'
import type { MomentumStudioState } from './useMomentumStudio'

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

const SUPABASE_PROJECT = 'xufydubsuztxgsylzxub'
const SUPABASE_LINKS = [
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
    title: 'Settings',
    href: `https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/settings/general`,
  },
]

/** External platform links (open in new tab). */
const PLATFORM_LINKS = [
  {
    title: 'GitHub',
    tooltip: 'Source repo',
    href: 'https://github.com/shubh996/dashboard_for_newslabs',
    // lucide dropped brand icons (no Github export) — use Code2
    icon: Code2,
  },
  {
    title: 'Cloudflare',
    tooltip: 'Pages deploy',
    href: 'https://dash.cloudflare.com/6e16b40b9e538c30251f8a763797de41/pages/view/dashboard-for-newslabs',
    icon: Cloud,
  },
  {
    title: 'PostHog',
    tooltip: 'Trigger analytics',
    href: 'https://eu.posthog.com/project/239556/persons',
    icon: BarChart3,
  },
] as const

export function AppSidebar({
  studio,
  ...props
}: ComponentProps<typeof Sidebar> & {
  studio: MomentumStudioState
}) {
  const { toggleSidebar } = useSidebar()
  const userCount = studio.tickers.reduce(
    (n, t) => n + (t.subscriberCount || 0),
    0,
  )

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1">
            <SidebarMenuButton size="lg" asChild tooltip="Trigger">
              <a href="/momentum-studio">
                <img
                  src="/icons/momentum-logo.png"
                  alt="Momentum"
                  className="size-8 rounded-lg object-cover"
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Trigger</span>
                  <span className="truncate text-xs">Momentum</span>
                </div>
              </a>
            </SidebarMenuButton>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="group-data-[collapsible=icon]:hidden"
              onClick={toggleSidebar}
            >
              <PanelLeft />
              <span className="sr-only">Toggle Sidebar</span>
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Overview</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Dashboard"
                isActive={studio.view === 'overview'}
                onClick={() => studio.setView('overview')}
              >
                <LayoutDashboard />
                <span>Dashboard</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Asset class</SidebarGroupLabel>
          <SidebarMenu>
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
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Active episodes</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Active episodes"
                isActive={studio.view === 'episodes'}
                onClick={() => studio.setView('episodes')}
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
                  onClick={() => {
                    const item = studio.tickers.find(
                      (t) => t.ticker === row.ticker,
                    )
                    if (item) studio.setAssetClass(item.assetClass)
                    studio.setActiveTicker(row.ticker)
                    studio.setView('watchlist')
                  }}
                >
                  <span>{row.ticker}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {fmtEpisodeNo(row.episodeNo) || fmtPct(row.currentMovePercent)}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Users</SidebarGroupLabel>
          <SidebarMenu>
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
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Billing & platforms</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Perplexity usage and billing"
                isActive={studio.view === 'perplexity'}
                onClick={() => studio.setView('perplexity')}
              >
                <Sparkles />
                <span>Perplexity</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <Collapsible asChild defaultOpen={false} className="group/collapsible">
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip="Supabase">
                    <Database />
                    <span>Supabase</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {SUPABASE_LINKS.map((link) => (
                      <SidebarMenuSubItem key={link.title}>
                        <SidebarMenuSubButton asChild>
                          <a
                            href={link.href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span>{link.title}</span>
                          </a>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>

            {PLATFORM_LINKS.map((link) => {
              const Icon = link.icon
              return (
                <SidebarMenuItem key={link.title}>
                  <SidebarMenuButton tooltip={link.tooltip} asChild>
                    <a href={link.href} target="_blank" rel="noreferrer">
                      <Icon />
                      <span>{link.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser studio={studio} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
