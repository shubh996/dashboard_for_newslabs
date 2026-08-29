import { useNavigate } from 'react-router-dom'
import { EpisodeDashboard } from '@/components/hub/EpisodeDashboard'
import { useTheme } from '@/hooks/useTheme'
import {
  openTriggerShareInNewTab,
  type TriggerSharePayload,
} from '@/lib/triggerShare'

/**
 * Default home — Momentum Episode Dashboard only.
 * Trigger (share cards / push desk) lives at /trigger.
 */
export default function EpisodePage() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()

  return (
    <div
      data-desk="hub"
      className="flex h-svh flex-col overflow-hidden bg-background text-foreground"
    >
      <EpisodeDashboard
        onOpenInTrigger={(ticker, opts) => {
          const symbol = String(ticker || '')
            .trim()
            .toUpperCase()
          if (!symbol) return
          const mode: TriggerSharePayload['mode'] =
            opts?.mode === 'direct'
              ? 'direct'
              : opts?.mode === 'research' ||
                  opts?.kind === 'sofar' ||
                  opts?.kind === 'peak'
                ? 'research'
                : 'scrape'
          const payload: TriggerSharePayload = {
            ticker: symbol,
            mode,
            label: opts?.label,
            move: opts?.move ?? null,
            price: opts?.price ?? null,
            priceFrom: opts?.priceFrom ?? null,
            window: opts?.window ?? null,
            exactLabel: opts?.exactLabel ?? null,
            exactMinutes: opts?.exactMinutes ?? null,
            direction: opts?.direction ?? null,
            kind: opts?.kind,
            headline: opts?.headline ?? null,
            likelyDriver: opts?.likelyDriver ?? null,
          }
          // Always new tab — never navigate the episode desk away.
          const result = openTriggerShareInNewTab(payload)
          if (result.blocked) {
            window.alert(
              'Popup blocked — allow popups for this site so So Far / Peak can open Trigger in a new tab.\n\nYour episode desk stays open.',
            )
          }
        }}
        onOpenTriggerApp={() => navigate('/trigger')}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    </div>
  )
}
