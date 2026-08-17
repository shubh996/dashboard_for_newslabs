import { Moon, RefreshCw, Settings, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import type { ThemeMode } from '@/hooks/useTheme'
import type { MomentumStudioState } from './useMomentumStudio'

export function SiteHeader({
  studio,
  theme,
  onToggleTheme,
}: {
  studio: MomentumStudioState
  theme: ThemeMode
  onToggleTheme: () => void
}) {
  const title =
    studio.view === 'overview'
      ? 'Dashboard'
      : studio.view === 'episodes'
        ? 'Active episodes'
        : studio.view === 'users'
          ? 'Users'
          : studio.view === 'perplexity'
            ? 'Perplexity'
            : studio.view === 'activity'
              ? 'Activity'
              : studio.activeTicker || 'Momentum'

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="min-w-0 truncate text-base font-medium">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleTheme}
            className="hidden sm:flex"
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
            <span className="sr-only">Toggle theme</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              void studio.loadWatchlist()
              if (studio.activeTicker) void studio.loadStatus(studio.activeTicker)
              void studio.loadActiveEpisodes()
            }}
          >
            <RefreshCw />
            <span className="sr-only">Refresh</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => studio.setSettingsOpen(true)}
          >
            <Settings />
            <span className="sr-only">Settings</span>
          </Button>
          <Button variant="ghost" asChild size="sm" className="hidden sm:flex">
            <a href="/notifications" className="dark:text-foreground">
              Original desk
            </a>
          </Button>
        </div>
      </div>
    </header>
  )
}
