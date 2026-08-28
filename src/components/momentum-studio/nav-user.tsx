import {
  ChevronsUpDown,
  ExternalLink,
  LayoutDashboard,
  Newspaper,
  Zap,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import type { MomentumStudioState } from './useMomentumStudio'

/**
 * Top-left brand control: Trigger logo + name.
 * Click opens app switcher (Momentum Studio / Original desk / Trigger / 9AM).
 */
export function NavBrand({ studio }: { studio: MomentumStudioState }) {
  const { isMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground data-[slot=sidebar-menu-button]:p-1.5!"
              tooltip="Trigger"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarImage src="/icons/momentum-logo.png" alt="Trigger" />
                <AvatarFallback className="rounded-lg text-[10px]">
                  TR
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate text-base font-semibold">Trigger</span>
                <span className="truncate text-xs text-muted-foreground">
                  Momentum Studio
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="size-8 rounded-lg">
                  <AvatarImage src="/icons/momentum-logo.png" alt="Trigger" />
                  <AvatarFallback className="rounded-lg text-[10px]">
                    TR
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Trigger</span>
                  <span className="truncate text-xs text-muted-foreground">
                    App switcher
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() => {
                  studio.clearRailEntityFocus()
                  studio.setView('overview')
                }}
              >
                <LayoutDashboard />
                Momentum dashboard
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/notifications">
                  <Newspaper />
                  Original desk
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/notifications?app=trigger">
                  <Zap />
                  Trigger
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href="https://9am.site"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink />
                  9AM
                </a>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** @deprecated Use NavBrand — kept as alias for existing imports. */
export const NavUser = NavBrand
