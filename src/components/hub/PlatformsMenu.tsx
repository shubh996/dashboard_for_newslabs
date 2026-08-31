import { useMemo, useState, type ComponentType, type SVGProps } from 'react'
import {
  Bot,
  Check,
  Cloud,
  Copy,
  Database,
  Flame,
  Globe,
  Info,
  LayoutTemplate,
  Search,
  Server,
  Smartphone,
  Sparkles,
  SquareTerminal,
  Table2,
  TrainFront,
  type LucideProps,
} from 'lucide-react'

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import {
  copyPlatformText,
  getDeskPlatformLinks,
  getSupabaseProjectApiUrl,
  openPlatformLink,
  type PlatformIconId,
  type PlatformLink,
} from '@/lib/platformLinks'
import { cn } from '@/lib/utils'

function GithubMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
      {...props}
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.28-.01-1.02-.02-2.01-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.48 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  )
}

function PlatformIcon({
  id,
  className,
}: {
  id: PlatformIconId
  className?: string
}) {
  const cls = cn('size-3.5 shrink-0 text-muted-foreground', className)
  if (id === 'github') return <GithubMark className={cls} />

  const Icon =
    (
      {
        railway: TrainFront,
        'railway-api': Server,
        cloudflare: Cloud,
        'cloudflare-pages': LayoutTemplate,
        supabase: Database,
        perplexity: Search,
        gemini: Sparkles,
        grok: Bot,
        firecrawl: Flame,
        expo: Smartphone,
        sql: SquareTerminal,
        'table-editor': Table2,
        database: Database,
        details: Info,
        link: Globe,
        github: Globe,
      } as const
    )[id] || Globe

  return <Icon className={cls} strokeWidth={1.75} />
}

function LinkRows({
  label,
  description,
}: {
  label: string
  description: string
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-[12px] font-medium leading-snug">{label}</span>
      <span className="block truncate text-[10px] text-muted-foreground">
        {description}
      </span>
    </span>
  )
}

function SupabasePlatformSub({
  link,
  onKeepOpen,
}: {
  link: PlatformLink
  onKeepOpen?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const projectUrl = useMemo(() => getSupabaseProjectApiUrl(), [])
  const sections = link.supabaseSections || []

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        <PlatformIcon id={link.icon} />
        <LinkRows label={link.label} description={link.description} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="min-w-[15rem] max-w-[18rem]"
        sideOffset={8}
        onPointerEnter={onKeepOpen}
      >
        <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Supabase
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sections.map((section) => {
          if (section.showProjectUrl) {
            return (
              <DropdownMenuSub key={section.id}>
                <DropdownMenuSubTrigger className="gap-2">
                  <PlatformIcon id={section.icon} />
                  <LinkRows
                    label={section.label}
                    description={section.description}
                  />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  className="min-w-[16rem] max-w-[20rem]"
                  sideOffset={8}
                  onPointerEnter={onKeepOpen}
                >
                  <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Project URL
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2"
                    disabled={!projectUrl}
                    onSelect={(event) => {
                      event.preventDefault()
                      if (!projectUrl) return
                      void copyPlatformText(projectUrl).then((ok) => {
                        if (!ok) return
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1400)
                      })
                    }}
                  >
                    {copied ? (
                      <Check
                        className="size-3.5 shrink-0 text-emerald-600"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <Copy
                        className="size-3.5 shrink-0 text-muted-foreground"
                        strokeWidth={1.75}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] leading-snug">
                        {projectUrl || 'VITE_SUPABASE_URL not set'}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {copied ? 'Copied' : 'Click to copy'}
                      </span>
                    </span>
                  </DropdownMenuItem>
                  {link.url ? (
                    <DropdownMenuItem
                      className="gap-2"
                      onSelect={(event) => {
                        event.preventDefault()
                        openPlatformLink(link.url)
                      }}
                    >
                      <PlatformIcon id="supabase" />
                      <LinkRows
                        label="Open project"
                        description="Supabase dashboard"
                      />
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          }

          return (
            <DropdownMenuItem
              key={section.id}
              className="gap-2"
              onSelect={(event) => {
                event.preventDefault()
                if (section.url) openPlatformLink(section.url)
              }}
            >
              <PlatformIcon id={section.icon} />
              <LinkRows
                label={section.label}
                description={section.description}
              />
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function PlatformsMenuItems({
  onKeepOpen,
}: {
  /** Keep parent Settings menu open while hovering nested panels. */
  onKeepOpen?: () => void
}) {
  const links = useMemo(() => getDeskPlatformLinks(), [])

  return (
    <>
      <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Open console
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {links.map((link) => {
        if (link.id === 'supabase' && link.supabaseSections?.length) {
          return (
            <SupabasePlatformSub
              key={link.id}
              link={link}
              onKeepOpen={onKeepOpen}
            />
          )
        }
        return (
          <DropdownMenuItem
            key={link.id}
            className="gap-2"
            onSelect={(event) => {
              event.preventDefault()
              openPlatformLink(link.url)
            }}
          >
            <PlatformIcon id={link.icon} />
            <LinkRows label={link.label} description={link.description} />
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

/** Full Platforms nested trigger used inside Settings menus. */
export function PlatformsMenuSub({
  onKeepOpen,
  onPointerLeave,
  TriggerIcon = Globe,
}: {
  onKeepOpen?: () => void
  onPointerLeave?: () => void
  TriggerIcon?: ComponentType<LucideProps>
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2">
        <TriggerIcon className="size-3.5" strokeWidth={1.75} />
        Platforms
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="min-w-[15.5rem] max-w-[18rem]"
        sideOffset={8}
        onPointerEnter={onKeepOpen}
        onPointerLeave={onPointerLeave}
      >
        <PlatformsMenuItems onKeepOpen={onKeepOpen} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
