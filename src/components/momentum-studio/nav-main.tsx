import {
  IconActivity,
  IconBookmark,
  IconChartBar,
} from '@tabler/icons-react'

import { Badge } from '@/components/ui/badge'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import type { StudioView } from './types'

export function NavMain({
  view,
  onView,
  watchCount,
  episodeCount,
}: {
  view: StudioView
  onView: (view: StudioView) => void
  watchCount: number
  episodeCount: number
}) {
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Watchlist"
              isActive={view === 'watchlist'}
              onClick={() => onView('watchlist')}
            >
              <IconBookmark />
              <span>Watchlist</span>
              <Badge
                variant="secondary"
                className="ml-auto size-5 justify-center rounded-full px-1 text-[10px]"
              >
                {watchCount}
              </Badge>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Active episodes"
              isActive={view === 'episodes'}
              onClick={() => onView('episodes')}
            >
              <IconChartBar />
              <span>Active episodes</span>
              <Badge
                variant="secondary"
                className="ml-auto size-5 justify-center rounded-full px-1 text-[10px]"
              >
                {episodeCount}
              </Badge>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Activity"
              isActive={view === 'activity'}
              onClick={() => onView('activity')}
            >
              <IconActivity />
              <span>Activity</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
