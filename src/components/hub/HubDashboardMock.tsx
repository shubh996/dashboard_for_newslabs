/**
 * Pure UI mock — pixel-close recreation of the Vizora dashboard reference.
 * Google Sans Flex · static only · no backend.
 */
import type { ReactNode } from 'react'
import {
  ArrowRight,
  BarChart2,
  BarChart3,
  Bell,
  ChevronDown,
  CircleHelp,
  Clock,
  LayoutGrid,
  LogOut,
  Mail,
  MessageSquare,
  Package,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings,
  TrendingUp,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type HubAppTab = 'hub' | 'trigger' | 'nineam'

type HubDashboardMockProps = {
  appTab: HubAppTab
  onAppTabChange: (tab: HubAppTab) => void
}

/** Design tokens from reference screenshot */
const T = {
  sidebar: '#0D3B32',
  sidebarDeep: '#0A322A',
  canvas: '#E7EFEC',
  white: '#FFFFFF',
  ink: '#1A1F1E',
  inkSoft: '#2C3331',
  muted: '#8A9691',
  muted2: '#A0AAA5',
  border: '#E8EEEC',
  borderSoft: '#F0F4F2',
  mint: '#22C55E',
  mintDeep: '#16A34A',
  mintSoft: '#E8F8EF',
  mintChip: '#D8F3E4',
  mintIconBg: '#EAF7F0',
  rose: '#F43F5E',
  roseSoft: '#FDE8EC',
  roseChip: '#FADCE2',
  chartTop: '#86EFAC',
  chartTopLine: '#4ADE80',
  chartBot: '#A7C4C0',
  chartBotLine: '#7BA3A0',
  font: '"Google Sans Flex", "Google Sans", system-ui, sans-serif',
} as const

/* ─── Small icon marks matching the ref style ─── */

function IconDonut({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M12 4a8 8 0 0 1 8 8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="3.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function IconBars({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 18V11M10 18V7M15 18v-5M20 18V5"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconBag({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 8.5h11l-1 11H7.5l-1-11Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 8.5V7a3 3 0 0 1 6 0v1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconSparkLine({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 16.5 8.5 11l3.5 3.5L21 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M15 6h6v6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function IconExport({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v11"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
      <path
        d="M8 7.5 12 3.5 16 7.5"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconCube({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 12.5V20.5M12 12.5 20 8M12 12.5 4 8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function IconHome({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.5 10.5 12 4l7.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-3.5v-5h-5v5H6A1.5 1.5 0 0 1 4.5 19v-8.5Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PctChip({
  value,
  up,
}: {
  value: string
  up: boolean
}) {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-[3px] text-[10px] font-semibold tabular-nums leading-none"
      style={{
        color: up ? T.mintDeep : T.rose,
        backgroundColor: up ? T.mintChip : T.roseChip,
        fontFamily: T.font,
      }}
    >
      <span
        className="inline-flex size-[13px] items-center justify-center rounded-full border"
        style={{
          borderColor: up ? 'rgba(22,163,74,0.35)' : 'rgba(244,63,94,0.35)',
          backgroundColor: up ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.7)',
        }}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
          {up ? (
            <path d="M4 6V2M4 2 2.2 3.8M4 2l1.8 1.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          ) : (
            <path d="M4 2v4M4 6 2.2 4.2M4 6l1.8-1.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          )}
        </svg>
      </span>
      {value}
    </span>
  )
}

function KpiCard({
  label,
  value,
  pct,
  pctUp,
  footerLead,
  footerLeadColor,
  icon,
}: {
  label: string
  value: string
  pct: string
  pctUp: boolean
  footerLead: string
  footerLeadColor: string
  icon: ReactNode
}) {
  return (
    <div
      className="flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-white"
      style={{
        borderColor: T.border,
        boxShadow: '0 1px 2px rgba(15,28,25,0.03)',
        fontFamily: T.font,
      }}
    >
      {/* body */}
      <div className="flex items-start justify-between gap-2 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <p
            className="text-[10px] font-medium uppercase tracking-[0.06em]"
            style={{ color: T.muted }}
          >
            {label}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p
              className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums leading-none"
              style={{ color: T.ink }}
            >
              {value}
            </p>
            <PctChip value={pct} up={pctUp} />
          </div>
        </div>
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-[10px]"
          style={{ backgroundColor: T.mintIconBg, color: T.mintDeep }}
        >
          {icon}
        </div>
      </div>

      {/* footer — exact pattern: colored delta · muted rest · arrow square */}
      <div
        className="flex items-center gap-2 border-t px-4 py-2.5"
        style={{ borderColor: T.borderSoft, backgroundColor: '#FBFCFC' }}
      >
        <p className="min-w-0 flex-1 truncate text-[11.5px] leading-none">
          <span className="font-semibold tabular-nums" style={{ color: footerLeadColor }}>
            {footerLead}
          </span>
          <span style={{ color: T.muted }}> from last month</span>
        </p>
        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] border bg-white"
          style={{ borderColor: T.border, color: T.muted }}
          aria-label="Open detail"
        >
          <ArrowRight className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

function SidebarItem({
  icon,
  label,
  active,
  badge,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  badge?: string | number
}) {
  return (
    <button
      type="button"
      className={cn(
        'relative flex w-full items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-left text-[13px] transition-colors',
        active ? 'font-semibold text-white' : 'font-medium',
      )}
      style={{
        fontFamily: T.font,
        backgroundColor: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: active ? '#FFFFFF' : 'rgba(255,255,255,0.58)',
      }}
    >
      {active ? (
        <span
          className="absolute right-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-l-full"
          style={{ backgroundColor: '#5EEAD4' }}
        />
      ) : null}
      <span className="inline-flex size-[18px] shrink-0 items-center justify-center opacity-95">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge != null ? (
        <span
          className="inline-flex min-w-[22px] items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white"
          style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}

function SalesChart() {
  // Softer mint top + cool grey-green bottom — closer to ref
  const topLine =
    'M0,132 C36,118 70,88 108,96 C148,105 188,62 230,58 C270,54 310,92 352,80 C394,68 436,38 478,48 C520,58 562,32 600,42 L640,48'
  const topFill = `${topLine} L640,220 L0,220 Z`
  const botLine =
    'M0,168 C40,160 80,152 118,158 C158,164 198,148 238,152 C278,156 318,162 358,156 C398,150 438,142 478,148 C518,154 558,138 600,144 L640,148'
  const botFill = `${botLine} L640,220 L0,220 Z`

  return (
    <div className="relative mt-1 h-[230px] w-full" style={{ fontFamily: T.font }}>
      <svg viewBox="0 0 640 220" className="h-full w-full" preserveAspectRatio="none" aria-hidden>
        {[48, 90, 132, 174].map((y) => (
          <line
            key={y}
            x1="48"
            y1={y}
            x2="640"
            y2={y}
            stroke="#EEF2F0"
            strokeWidth="1"
          />
        ))}
        <defs>
          <linearGradient id="hubTopFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.chartTop} stopOpacity="0.55" />
            <stop offset="55%" stopColor={T.chartTop} stopOpacity="0.18" />
            <stop offset="100%" stopColor={T.chartTop} stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="hubBotFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.chartBot} stopOpacity="0.28" />
            <stop offset="100%" stopColor={T.chartBot} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={botFill} fill="url(#hubBotFill)" />
        <path d={topFill} fill="url(#hubTopFill)" />
        <path
          d={botLine}
          fill="none"
          stroke={T.chartBotLine}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={topLine}
          fill="none"
          stroke={T.chartTopLine}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* focus column wash */}
        <rect x="250" y="30" width="36" height="175" fill={T.chartTop} opacity="0.12" rx="4" />
        <circle cx="268" cy="58" r="5" fill="#fff" stroke={T.chartTopLine} strokeWidth="2.5" />
        <circle cx="268" cy="152" r="4.5" fill="#fff" stroke={T.chartBotLine} strokeWidth="2" />
      </svg>

      {/* tooltip card */}
      <div
        className="pointer-events-none absolute left-[36%] top-3 rounded-[10px] border bg-white px-3 py-2 shadow-[0_8px_24px_rgba(15,28,25,0.08)]"
        style={{ borderColor: T.border }}
      >
        <p
          className="text-[9px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: T.muted }}
        >
          Net sales
        </p>
        <p className="mt-0.5 text-[13px] font-semibold tabular-nums" style={{ color: T.ink }}>
          $53.5k
        </p>
        <p className="text-[11px] tabular-nums" style={{ color: T.muted2 }}>
          $23.3k
        </p>
        <p className="mt-0.5 text-[10px]" style={{ color: T.muted2 }}>
          Aug 12, 2024
        </p>
      </div>

      <div
        className="pointer-events-none absolute inset-y-3 left-0 flex w-11 flex-col justify-between text-[10px] tabular-nums"
        style={{ color: T.muted2 }}
      >
        <span>$25k</span>
        <span>$20k</span>
        <span>$15k</span>
        <span>$10k</span>
      </div>
      <div
        className="pointer-events-none absolute bottom-0 left-12 right-1 flex justify-between text-[10px]"
        style={{ color: T.muted2 }}
      >
        <span>Aug 01, 2024</span>
        <span>Aug 32, 2024</span>
      </div>
    </div>
  )
}

const PRODUCT_ROWS = [
  { name: 'Cooper, Kristin', avatar: 'CK', price: '$119.92', stock: 34, sold: 340, active: true },
  { name: 'Miles, Jacob', avatar: 'MJ', price: '$89.00', stock: 12, sold: 210, active: true },
  { name: 'Fox, Annette', avatar: 'FA', price: '$54.40', stock: 8, sold: 96, active: false },
]

export function HubDashboardMock({ appTab, onAppTabChange }: HubDashboardMockProps) {
  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden"
      style={{ backgroundColor: T.canvas, fontFamily: T.font }}
      aria-label="Home dashboard"
    >
      {/* ════════ SIDEBAR ════════ */}
      <aside
        className="flex w-[232px] shrink-0 flex-col"
        style={{ backgroundColor: T.sidebar }}
      >
        <div className="flex items-center gap-2.5 px-4 pb-2 pt-5">
          <div
            className="flex size-[30px] items-center justify-center rounded-[8px]"
            style={{ backgroundColor: 'rgba(94,234,212,0.15)' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M8 1.5 14 5v6L8 14.5 2 11V5L8 1.5Z"
                stroke="#5EEAD4"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path d="M8 6.5v4M6 8.5h4" stroke="#5EEAD4" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-white">Vizora</span>
          <button
            type="button"
            className="ml-auto inline-flex size-7 items-center justify-center rounded-[8px] text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
            aria-label="Collapse"
          >
            <PanelLeftClose className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-3 pb-4 pt-2">
          <div
            className="flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-[12px]"
            style={{
              backgroundColor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.45)',
            }}
          >
            <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="flex-1">Search</span>
            <span
              className="rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
            >
              ⌘F
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          <p
            className="mb-1 px-3 text-[10px] font-medium uppercase tracking-[0.14em]"
            style={{ color: 'rgba(255,255,255,0.32)' }}
          >
            Main Menu
          </p>
          <div className="space-y-0.5">
            <SidebarItem icon={<IconHome className="size-[18px]" />} label="Dashboard" active />
            <SidebarItem icon={<Package className="size-[17px]" strokeWidth={1.65} />} label="Products" />
            <SidebarItem icon={<BarChart2 className="size-[17px]" strokeWidth={1.65} />} label="Order" />
            <SidebarItem icon={<Users className="size-[17px]" strokeWidth={1.65} />} label="Customer" />
            <SidebarItem
              icon={<MessageSquare className="size-[17px]" strokeWidth={1.65} />}
              label="Chat"
              badge={10}
            />
          </div>

          <p
            className="mb-1 mt-5 px-3 text-[10px] font-medium uppercase tracking-[0.14em]"
            style={{ color: 'rgba(255,255,255,0.32)' }}
          >
            Other
          </p>
          <div className="space-y-0.5">
            <SidebarItem icon={<Mail className="size-[17px]" strokeWidth={1.65} />} label="Email" />
            <SidebarItem icon={<BarChart3 className="size-[17px]" strokeWidth={1.65} />} label="Analytics" />
            <SidebarItem icon={<Settings className="size-[17px]" strokeWidth={1.65} />} label="Integration" />
            <SidebarItem icon={<TrendingUp className="size-[17px]" strokeWidth={1.65} />} label="Performance" />
          </div>

          <p
            className="mb-1 mt-5 px-3 text-[10px] font-medium uppercase tracking-[0.14em]"
            style={{ color: 'rgba(255,255,255,0.32)' }}
          >
            Account
          </p>
          <div className="space-y-0.5">
            <SidebarItem icon={<CircleHelp className="size-[17px]" strokeWidth={1.65} />} label="Help Center" />
            <SidebarItem icon={<Settings className="size-[17px]" strokeWidth={1.65} />} label="Settings" />
          </div>
        </div>

        <div
          className="mt-auto flex items-center gap-2.5 px-3 py-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div
            className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-semibold"
            style={{ backgroundColor: '#E8A838', color: '#1a1a1a' }}
          >
            TR
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">Tony Robert</p>
          </div>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-[8px] text-white/55 hover:bg-white/10 hover:text-white/90"
            aria-label="Sign out"
          >
            <LogOut className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </aside>

      {/* ════════ MAIN ════════ */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        {/* Top header — white, not heavy bar */}
        <header
          className="flex shrink-0 items-center gap-3 px-6 py-4 sm:px-8"
          style={{ borderBottom: `1px solid ${T.borderSoft}` }}
        >
          <div className="min-w-0 flex-1">
            <h1
              className="text-[22px] font-semibold tracking-[-0.02em] leading-tight"
              style={{ color: T.ink, fontFamily: T.font }}
            >
              Dashboard
            </h1>
            <p className="mt-0.5 text-[13px]" style={{ color: T.muted }}>
              Welcome back Tony
            </p>
          </div>

          {/* keep app switch for navigation */}
          <div
            className="hidden items-center gap-0.5 rounded-[10px] border p-0.5 sm:flex"
            style={{ borderColor: T.border, backgroundColor: '#F6F9F7' }}
            role="tablist"
            aria-label="App"
          >
            {(
              [
                { id: 'hub' as const, label: 'Home', icon: <LayoutGrid className="size-3.5" /> },
                { id: 'trigger' as const, label: 'Trigger', icon: <Zap className="size-3.5" /> },
                {
                  id: 'nineam' as const,
                  label: '9AM',
                  icon: <span className="text-[11px] font-bold leading-none">9</span>,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={appTab === tab.id}
                title={tab.label}
                onClick={() => onAppTabChange(tab.id)}
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-[8px] transition-colors',
                  appTab === tab.id
                    ? 'bg-white shadow-sm'
                    : 'text-[#8A9691] hover:text-[#1A1F1E]',
                )}
                style={{ color: appTab === tab.id ? T.sidebar : undefined }}
              >
                {tab.icon}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center -space-x-2">
              {['#F0B429', '#3B82F6', '#EC4899'].map((c, i) => (
                <div
                  key={i}
                  className="size-[30px] rounded-full border-[2px] border-white"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              type="button"
              className="inline-flex size-[30px] items-center justify-center rounded-full border bg-white"
              style={{ borderColor: T.border, color: T.muted }}
              aria-label="Add"
            >
              <Plus className="size-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-full"
              style={{ color: T.muted }}
              aria-label="History"
            >
              <Clock className="size-[18px]" strokeWidth={1.65} />
            </button>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-full"
              style={{ color: T.muted }}
              aria-label="Notifications"
            >
              <Bell className="size-[18px]" strokeWidth={1.65} />
            </button>
            {/* Export — less rounded, ~10px radius like ref */}
            <button
              type="button"
              className="ml-1 inline-flex h-9 items-center gap-1.5 px-3.5 text-[13px] font-semibold text-white"
              style={{
                backgroundColor: T.sidebar,
                borderRadius: 10,
                fontFamily: T.font,
              }}
            >
              Export
              <IconExport className="size-3.5 opacity-90" />
            </button>
          </div>
        </header>

        {/* Content canvas */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6"
          style={{ backgroundColor: T.canvas }}
        >
          {/* KPI row */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="New net income"
              value="$53,765"
              pct="10.5%"
              pctUp
              footerLead="+$2,156"
              footerLeadColor={T.mintDeep}
              icon={<IconDonut className="size-5" />}
            />
            <KpiCard
              label="Average sales"
              value="$12,549"
              pct="13.5%"
              pctUp
              footerLead="+$4,275"
              footerLeadColor={T.mintDeep}
              icon={<IconBars className="size-5" />}
            />
            <KpiCard
              label="Total order"
              value="13,439"
              pct="0.5%"
              pctUp={false}
              footerLead="+$2,156"
              footerLeadColor={T.mintDeep}
              icon={<IconBag className="size-5" />}
            />
            <KpiCard
              label="Impression"
              value="349K"
              pct="25.1%"
              pctUp={false}
              footerLead="-98.5K"
              footerLeadColor={T.rose}
              icon={<IconSparkLine className="size-5" />}
            />
          </div>

          {/* Chart + conversion */}
          <div className="mt-3.5 grid gap-3.5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section
              className="rounded-[14px] border bg-white p-4 sm:p-5"
              style={{ borderColor: T.border, boxShadow: '0 1px 2px rgba(15,28,25,0.03)' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p
                    className="text-[10px] font-medium uppercase tracking-[0.07em]"
                    style={{ color: T.muted }}
                  >
                    Overall sales
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <p
                      className="text-[26px] font-semibold tracking-[-0.02em] tabular-nums leading-none"
                      style={{ color: T.ink }}
                    >
                      $63,332
                    </p>
                    <PctChip value="10.5%" up />
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex size-9 items-center justify-center rounded-[10px] border"
                  style={{ borderColor: T.border, color: T.mintDeep, backgroundColor: T.mintIconBg }}
                  aria-label="Chart"
                >
                  <TrendingUp className="size-4" strokeWidth={1.75} />
                </button>
              </div>

              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1 rounded-[8px] border bg-white px-2.5 text-[12px] font-medium"
                  style={{ borderColor: T.border, color: T.inkSoft }}
                >
                  Dashboard
                  <ChevronDown className="size-3.5 opacity-50" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1 rounded-[8px] border bg-white px-2.5 text-[12px] font-medium"
                  style={{ borderColor: T.border, color: T.inkSoft }}
                >
                  All Categories
                  <ChevronDown className="size-3.5 opacity-50" />
                </button>
                <div
                  className="ml-auto flex items-center gap-3.5 text-[11px] font-medium"
                  style={{ color: T.muted }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-[2px]" style={{ backgroundColor: T.chartTopLine }} />
                    This Period
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-[2px]" style={{ backgroundColor: T.chartBotLine }} />
                    Last Period
                  </span>
                </div>
              </div>

              <SalesChart />
            </section>

            <section
              className="rounded-[14px] border bg-white p-4 sm:p-5"
              style={{ borderColor: T.border, boxShadow: '0 1px 2px rgba(15,28,25,0.03)' }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p
                    className="text-[10px] font-medium uppercase tracking-[0.07em]"
                    style={{ color: T.muted }}
                  >
                    Conversion rate
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <p
                      className="text-[26px] font-semibold tracking-[-0.02em] tabular-nums leading-none"
                      style={{ color: T.ink }}
                    >
                      4.55%
                    </p>
                    <PctChip value="0.5%" up />
                  </div>
                </div>
                <div
                  className="flex size-10 items-center justify-center rounded-[10px]"
                  style={{ backgroundColor: T.mintIconBg, color: T.mintDeep }}
                >
                  <IconBars className="size-5" />
                </div>
              </div>

              <ul className="mt-5">
                {(
                  [
                    { label: 'Product Views', pct: '15%', value: '6,545' },
                    { label: 'Add to cart', pct: '8%', value: '3,491' },
                    { label: 'Checkout Initiated', pct: '4%', value: '1,342' },
                    { label: 'Completed purchases', pct: '1.89%', value: '1,200' },
                  ] as const
                ).map((row, i, arr) => (
                  <li
                    key={row.label}
                    className="flex items-center gap-3 py-[13px]"
                    style={{
                      borderBottom: i < arr.length - 1 ? `1px solid ${T.borderSoft}` : undefined,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium" style={{ color: T.ink }}>
                        {row.label}
                      </p>
                      <p className="mt-0.5 text-[11px] tabular-nums" style={{ color: T.muted }}>
                        {row.pct}
                      </p>
                    </div>
                    <p className="text-[13px] font-semibold tabular-nums" style={{ color: T.ink }}>
                      {row.value}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Upgrade + products */}
          <div className="mt-3.5 grid gap-3.5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.4fr)]">
            <section
              className="rounded-[14px] border bg-white p-5"
              style={{ borderColor: T.border, boxShadow: '0 1px 2px rgba(15,28,25,0.03)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className="text-[10px] font-medium uppercase tracking-[0.07em]"
                    style={{ color: T.muted }}
                  >
                    Upgrade
                  </p>
                  <p
                    className="mt-1 text-[18px] font-semibold tracking-tight"
                    style={{ color: T.ink }}
                  >
                    Premium Plan
                  </p>
                </div>
                <button
                  type="button"
                  className="h-9 px-3.5 text-[13px] font-semibold text-white"
                  style={{ backgroundColor: T.sidebar, borderRadius: 10, fontFamily: T.font }}
                >
                  Upgrade
                </button>
              </div>
              <p className="mt-3 max-w-sm text-[13px] leading-[1.55]" style={{ color: T.muted }}>
                Supercharge your sales management and unlock your full potential for extraordinary
                success.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div
                  className="rounded-[12px] px-3 py-3"
                  style={{ backgroundColor: '#F4F7F6' }}
                >
                  <p className="text-[11px]" style={{ color: T.muted }}>
                    Performance
                  </p>
                  <p className="mt-1 text-[14px] font-semibold" style={{ color: T.mintDeep }}>
                    ↑ 79%
                  </p>
                </div>
                <div
                  className="rounded-[12px] px-3 py-3"
                  style={{ backgroundColor: '#F4F7F6' }}
                >
                  <p className="text-[11px]" style={{ color: T.muted }}>
                    Tools
                  </p>
                  <p
                    className="mt-1 inline-flex items-center gap-1 text-[14px] font-semibold"
                    style={{ color: T.ink }}
                  >
                    <Wrench className="size-3.5" style={{ color: '#D4A017' }} strokeWidth={1.75} />
                    30+
                  </p>
                </div>
              </div>
            </section>

            <section
              className="rounded-[14px] border bg-white p-4 sm:p-5"
              style={{ borderColor: T.border, boxShadow: '0 1px 2px rgba(15,28,25,0.03)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p
                    className="text-[10px] font-medium uppercase tracking-[0.07em]"
                    style={{ color: T.muted }}
                  >
                    Product list
                  </p>
                  <p className="text-[20px] font-semibold tabular-nums leading-none" style={{ color: T.ink }}>
                    390
                  </p>
                  <PctChip value="+12" up />
                </div>
                <div
                  className="flex size-9 items-center justify-center rounded-[10px]"
                  style={{ backgroundColor: T.mintIconBg, color: T.mintDeep }}
                >
                  <IconCube className="size-[18px]" />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div
                  className="flex h-9 min-w-[11rem] flex-1 items-center gap-2 rounded-[10px] border bg-white px-3 text-[12px]"
                  style={{ borderColor: T.border, color: T.muted }}
                >
                  <Search className="size-3.5" strokeWidth={1.75} />
                  <span>Search</span>
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border bg-white px-3 text-[12px] font-medium"
                  style={{ borderColor: T.border, color: T.inkSoft }}
                >
                  <RefreshCw className="size-3.5 opacity-55" strokeWidth={1.75} />
                  Refresh
                </button>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] border-collapse text-left text-[12px]">
                  <thead>
                    <tr style={{ color: T.muted }}>
                      <th className="pb-2.5 pr-2 font-medium">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block size-3.5 rounded-[3px] border"
                            style={{ borderColor: '#C9D4CF' }}
                          />
                          Product Info
                        </span>
                      </th>
                      <th className="px-2 pb-2.5 font-medium">Price</th>
                      <th className="px-2 pb-2.5 font-medium">Stock</th>
                      <th className="px-2 pb-2.5 font-medium">Sold</th>
                      <th className="pb-2.5 pl-2 font-medium">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRODUCT_ROWS.map((row) => (
                      <tr key={row.name} style={{ borderTop: `1px solid ${T.borderSoft}`, color: T.ink }}>
                        <td className="py-2.5 pr-2">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="inline-block size-3.5 rounded-[3px] border"
                              style={{ borderColor: '#C9D4CF' }}
                            />
                            <span
                              className="flex size-8 items-center justify-center rounded-full text-[10px] font-semibold"
                              style={{ backgroundColor: '#E0F2FE', color: '#0369A1' }}
                            >
                              {row.avatar}
                            </span>
                            <span className="font-medium">{row.name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 tabular-nums">{row.price}</td>
                        <td className="px-2 py-2.5 tabular-nums">{row.stock}</td>
                        <td className="px-2 py-2.5 tabular-nums">{row.sold}</td>
                        <td className="py-2.5 pl-2">
                          <span
                            className="relative inline-flex h-[20px] w-[36px] items-center rounded-full p-[2px]"
                            style={{
                              backgroundColor: row.active ? T.sidebar : '#C5CECA',
                              justifyContent: row.active ? 'flex-end' : 'flex-start',
                            }}
                          >
                            <span className="size-4 rounded-full bg-white shadow-sm" />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
