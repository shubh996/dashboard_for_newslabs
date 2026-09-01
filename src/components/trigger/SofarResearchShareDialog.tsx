/**
 * So Far / Peak research composer on /trigger — 3 columns:
 * 1) Perplexity (likely driver on top, prompt + run below)
 * 2) Notification preview + notify
 * 3) Share image preview + Edit / Share on social
 * Close (X) closes this tab and returns focus to the desk tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BellRing,
  Loader2,
  Pencil,
  Search,
  Share2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { TriggerSharePayload } from '@/lib/triggerShare'

const RESEARCH_PROMPT_TEMPLATES_KEY = 'momentum-research-prompt-templates-v1'

export type SofarShareEvent = {
  event_date: string
  display_date?: string | null
  time_label?: string | null
  price?: string | null
  price_change?: string | null
  momentum?: string | null
  direction?: 'up' | 'down' | string | null
  summary?: string | null
  sources?: unknown[]
  save_status?: string
  gemini_formating?: boolean
}

type ResearchMeta = {
  reason?: string | null
  likely_driver?: string | null
  secondary_driver?: string | null
  move_classification?: string | null
  confidence?: string | null
  model?: string | null
  model_version?: string | null
  cost_usd_display?: string | null
  citations?: string[]
}

type ShareArgs = {
  ticker: string
  companyName: string
  event: SofarShareEvent
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  payload: TriggerSharePayload | null
  /**
   * dialog = fullscreen Trigger tab overlay (default).
   * panel = embed in episode-desk right rail (no window.close).
   */
  variant?: 'dialog' | 'panel'
  className?: string
  /** Full share-card editor (layout / text / platforms). */
  onEditShare: (args: ShareArgs) => void | Promise<void>
  /** Direct social sharing flow (opens share desk ready to post). */
  onShareSocial: (args: ShareArgs) => void | Promise<void>
  /** Render share-card PNG for the right-column preview. */
  onRenderPreview: (
    args: ShareArgs,
  ) => Promise<{ imageUrl: string | null }>
  onNotify: (args: {
    ticker: string
    companyName: string
    title: string
    body: string
    event: SofarShareEvent
  }) => void | Promise<void>
}

function loadSavedTemplate(assetClassHint?: string | null): string | null {
  try {
    const raw = localStorage.getItem(RESEARCH_PROMPT_TEMPLATES_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, string>
    const cls = String(assetClassHint || 'equity')
      .trim()
      .toLowerCase()
    const key =
      cls === 'commodity' || cls === 'commodities'
        ? 'commodity'
        : cls === 'crypto'
          ? 'crypto'
          : cls === 'forex' || cls === 'fx'
            ? 'forex'
            : cls === 'index' || cls === 'etf'
              ? 'index'
              : 'equity'
    const t = parsed[key]
    return t && t.trim() ? t : null
  } catch {
    return null
  }
}

function todayEt(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  })
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return ''
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtSharePriceNum(raw: number | string | null | undefined): string | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (Number.isFinite(n)) {
    if (Math.abs(n) >= 1) return n.toFixed(2)
    if (Math.abs(n) >= 0.01) return n.toFixed(4)
    return String(n)
  }
  const s = String(raw).trim().replace(/^\$/, '')
  return s || null
}

/**
 * Share-card price line: `$from → $to` when both known, else a single `$price`.
 * Starts with `$` so formatSharePriceLabel leaves it intact.
 */
function fmtSharePriceRange(
  from: number | string | null | undefined,
  to: number | string | null | undefined,
): string | null {
  const a = fmtSharePriceNum(from)
  const b = fmtSharePriceNum(to)
  if (a && b && a !== b) return `$${a} → $${b}`
  if (b) return `$${b}`
  if (a) return `$${a}`
  return null
}

function kindLabel(
  kind?: string | null,
): 'peak' | 'sofar' | 'extreme' | 'research' {
  const k = String(kind || '')
    .trim()
    .toLowerCase()
  if (k === 'peak') return 'peak'
  if (k === 'sofar') return 'sofar'
  if (k === 'extreme' || k === 'extremes') return 'extreme'
  return 'research'
}

function flowTitle(kind?: string | null): string {
  const which = kindLabel(kind)
  if (which === 'peak') return 'Peak research'
  if (which === 'extreme') return 'Extreme research'
  if (which === 'sofar') return 'So Far research'
  return 'Research'
}

function buildDefaultTitle(
  ticker: string,
  move: number | null,
  headline?: string | null,
  kind?: string | null,
): string {
  // Prefer the handoff headline (already includes “in the last X minutes” for peak)
  if (headline && String(headline).trim()) return String(headline).trim()
  const pct = fmtPct(move)
  const which = kindLabel(kind)
  if (which === 'peak') {
    return pct ? `$${ticker} ${pct}` : `$${ticker} peak move`
  }
  if (which === 'extreme') {
    return pct ? `$${ticker} ${pct}` : `$${ticker} extreme move`
  }
  return pct
    ? `$${ticker} ${pct} so far in regular trading`
    : `$${ticker} so far in regular trading`
}

function closeResearchTab() {
  try {
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.focus()
      } catch {
        /* cross-origin */
      }
    }
  } catch {
    /* ignore */
  }
  try {
    window.close()
  } catch {
    /* ignore */
  }
  // If the browser refuses window.close(), at least leave /trigger home
  window.setTimeout(() => {
    try {
      if (!window.closed) {
        window.location.assign('/')
      }
    } catch {
      /* ignore */
    }
  }, 150)
}

export function SofarResearchShareDialog({
  open,
  onOpenChange,
  payload,
  variant = 'dialog',
  className,
  onEditShare,
  onShareSocial,
  onRenderPreview,
  onNotify,
}: Props) {
  const isPanel = variant === 'panel'
  const ticker = String(payload?.ticker || '')
    .trim()
    .toUpperCase()
  const companyName = String(payload?.label || ticker).trim() || ticker
  const move =
    payload?.move != null && Number.isFinite(Number(payload.move))
      ? Number(payload.move)
      : null
  const flowKind = kindLabel(payload?.kind)
  const seededDriver = String(payload?.likelyDriver || '').trim()

  const [prompt, setPrompt] = useState('')
  const [promptReady, setPromptReady] = useState(false)
  const [prepareError, setPrepareError] = useState('')
  const [researchBusy, setResearchBusy] = useState(false)
  const [researchError, setResearchError] = useState('')
  const [meta, setMeta] = useState<ResearchMeta | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [assetClass, setAssetClass] = useState('equity')
  const [actionBusy, setActionBusy] = useState<
    'notify' | 'edit' | 'share' | null
  >(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  /** When true, hiding this dialog should NOT close the browser tab (Edit/Share parked). */
  const suppressLeaveTabRef = useRef(false)

  const direction = useMemo(() => {
    if (payload?.direction === 'DOWN' || payload?.direction === 'UP') {
      return payload.direction
    }
    if (move != null && move < 0) return 'DOWN'
    return 'UP'
  }, [payload?.direction, move])

  const buildEvent = useCallback((): SofarShareEvent => {
    const pct = fmtPct(move)
    const day = todayEt()
    const priceLabel = fmtSharePriceRange(
      payload?.priceFrom ?? null,
      payload?.price ?? null,
    )
    const driverText =
      meta?.likely_driver || body.trim() || seededDriver || ''
    // First summary line becomes the share-card session line
    const sessionHeadline =
      title.trim() ||
      buildDefaultTitle(ticker, move, payload?.headline, payload?.kind)
    const summaryParts = [
      sessionHeadline,
      driverText ? `Likely driver: ${driverText}` : '',
      meta?.secondary_driver
        ? `Secondary driver: ${meta.secondary_driver}`
        : '',
      meta?.move_classification
        ? `Move classification: ${meta.move_classification}`
        : '',
      meta?.confidence ? `Confidence: ${meta.confidence}` : '',
    ].filter(Boolean)
    return {
      event_date: day,
      display_date: day,
      time_label: payload?.window || 'day',
      price: priceLabel,
      price_change: pct || null,
      momentum: pct || null,
      direction: direction === 'DOWN' ? 'down' : 'up',
      summary: summaryParts.join('\n\n'),
      sources: Array.isArray(meta?.citations)
        ? meta!.citations!.map((url) => ({ url }))
        : [],
      save_status: 'new',
      gemini_formating: Boolean(driverText),
    }
  }, [
    body,
    direction,
    meta,
    move,
    payload?.headline,
    payload?.kind,
    payload?.price,
    payload?.priceFrom,
    payload?.window,
    seededDriver,
    ticker,
    title,
  ])

  const driverDisplay =
    meta?.likely_driver || body.trim() || seededDriver || ''

  const refreshPreview = useCallback(async () => {
    if (!ticker || !open) return
    const hasDriver = Boolean(
      body.trim() || meta?.likely_driver || seededDriver,
    )
    if (!hasDriver && !title.trim()) {
      setPreviewUrl((prev) => {
        if (prev) {
          try {
            URL.revokeObjectURL(prev)
          } catch {
            /* ignore */
          }
        }
        return null
      })
      return
    }
    setPreviewBusy(true)
    setPreviewError('')
    try {
      const result = await onRenderPreview({
        ticker,
        companyName,
        event: buildEvent(),
      })
      setPreviewUrl((prev) => {
        if (prev && prev !== result.imageUrl) {
          try {
            URL.revokeObjectURL(prev)
          } catch {
            /* ignore */
          }
        }
        return result.imageUrl
      })
      if (!result.imageUrl) {
        setPreviewError('Could not render share image yet.')
      }
    } catch (err) {
      setPreviewError(
        err instanceof Error ? err.message : 'Preview render failed',
      )
    } finally {
      setPreviewBusy(false)
    }
  }, [
    body,
    buildEvent,
    companyName,
    meta?.likely_driver,
    onRenderPreview,
    open,
    seededDriver,
    ticker,
    title,
  ])

  useEffect(() => {
    if (!open || !ticker) return
    let cancelled = false
    setPrepareError('')
    setPromptReady(false)
    setResearchError('')
    setTitle(
      buildDefaultTitle(ticker, move, payload?.headline, payload?.kind),
    )
    const seeded = String(payload?.likelyDriver || '').trim()
    setBody(seeded)
    setMeta(
      seeded
        ? {
            likely_driver: seeded,
            reason: null,
            secondary_driver: null,
            move_classification: null,
            confidence: null,
          }
        : null,
    )
    void (async () => {
      try {
        const savedTemplate = loadSavedTemplate('equity')
        const res = await fetch('/api/notifications/momentum-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phase: 'prepare',
            ticker,
            company_name: companyName,
            window_key: 'day',
            window_label: 'session',
            move_percent: move,
            prompt_template: savedTemplate || undefined,
          }),
        })
        const data = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >
        if (cancelled) return
        if (!res.ok) {
          throw new Error(
            String(data.error || `Prepare failed (${res.status})`),
          )
        }
        if (typeof data.asset_class === 'string' && data.asset_class) {
          setAssetClass(data.asset_class)
        }
        const built = String(data.prompt || '').trim()
        setPrompt(built)
        setPromptReady(true)
        if (!built) {
          setPrepareError('Empty research prompt — edit manually or retry.')
        }
      } catch (err) {
        if (cancelled) return
        setPrepareError(
          err instanceof Error ? err.message : 'Failed to prepare prompt',
        )
        setPromptReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    open,
    ticker,
    companyName,
    move,
    payload?.headline,
    payload?.kind,
    payload?.likelyDriver,
  ])

  // Debounced share-image preview when title/body/driver change
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      void refreshPreview()
    }, 450)
    return () => window.clearTimeout(t)
  }, [open, title, body, meta, refreshPreview])

  useEffect(() => {
    return () => {
      if (previewUrl) {
        try {
          URL.revokeObjectURL(previewUrl)
        } catch {
          /* ignore */
        }
      }
    }
  }, [previewUrl])

  async function runResearch() {
    if (!ticker || researchBusy) return
    setResearchBusy(true)
    setResearchError('')
    try {
      const savedTemplate = loadSavedTemplate(assetClass)
      const res = await fetch('/api/notifications/momentum-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase: 'run',
          ticker,
          company_name: companyName,
          window_key: 'day',
          window_label: 'session',
          move_percent: move,
          prompt: prompt.trim() || undefined,
          prompt_template: prompt.trim()
            ? undefined
            : savedTemplate || undefined,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      if (!res.ok) {
        throw new Error(
          String(data.error || `Research failed (${res.status})`),
        )
      }
      const likely = String(data.likely_driver || '').trim()
      const nextMeta: ResearchMeta = {
        reason: String(data.reason || '') || null,
        likely_driver: likely || null,
        secondary_driver: String(data.secondary_driver || '') || null,
        move_classification: String(data.move_classification || '') || null,
        confidence: String(data.confidence || '') || null,
        model: String(data.model || '') || null,
        model_version: String(data.model_version || '') || null,
        cost_usd_display: String(data.cost_usd_display || '') || null,
        citations: Array.isArray(data.citations)
          ? (data.citations as string[])
          : [],
      }
      setMeta(nextMeta)
      if (likely) setBody(likely)
      if (!title.trim()) {
        setTitle(
          buildDefaultTitle(ticker, move, payload?.headline, payload?.kind),
        )
      }
      if (prompt.trim() && data.user_movement && data.input_facts) {
        try {
          const um = String(data.user_movement)
          const facts = String(data.input_facts)
          let template = prompt
          if (um && template.includes(um)) {
            template = template.split(um).join('{{USER_MOVEMENT}}')
          }
          if (facts && template.includes(facts)) {
            template = template.split(facts).join('{{INPUT_FACTS}}')
          }
          if (
            template.includes('{{USER_MOVEMENT}}') &&
            template.includes('{{INPUT_FACTS}}')
          ) {
            const raw = localStorage.getItem(RESEARCH_PROMPT_TEMPLATES_KEY)
            const all = raw
              ? (JSON.parse(raw) as Record<string, string>)
              : {}
            const cls = String(data.asset_class || assetClass || 'equity')
              .toLowerCase()
            all[cls === 'commodities' ? 'commodity' : cls] = template
            localStorage.setItem(
              RESEARCH_PROMPT_TEMPLATES_KEY,
              JSON.stringify(all),
            )
          }
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      setResearchError(
        err instanceof Error ? err.message : 'Perplexity research failed',
      )
    } finally {
      setResearchBusy(false)
    }
  }

  async function handleNotify() {
    if (!ticker || actionBusy) return
    setActionBusy('notify')
    try {
      await onNotify({
        ticker,
        companyName,
        title:
          title.trim() ||
          buildDefaultTitle(ticker, move, payload?.headline, payload?.kind),
        body: body.trim() || meta?.likely_driver || seededDriver || '',
        event: buildEvent(),
      })
    } finally {
      setActionBusy(null)
    }
  }

  async function handleEdit() {
    if (!ticker || actionBusy) return
    setActionBusy('edit')
    if (!isPanel) {
      // Park composer under the share editor — do not close this browser tab
      suppressLeaveTabRef.current = true
      onOpenChange(false)
    }
    try {
      await onEditShare({
        ticker,
        companyName,
        event: buildEvent(),
      })
    } finally {
      setActionBusy(null)
    }
  }

  async function handleShareSocial() {
    if (!ticker || actionBusy) return
    setActionBusy('share')
    if (!isPanel) {
      suppressLeaveTabRef.current = true
      onOpenChange(false)
    }
    try {
      await onShareSocial({
        ticker,
        companyName,
        event: buildEvent(),
      })
    } finally {
      setActionBusy(null)
    }
  }

  function handleDialogOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      if (suppressLeaveTabRef.current) {
        // Edit / Share parked this composer — keep the tab open
        suppressLeaveTabRef.current = false
        return
      }
      if (isPanel) return
      // X / Escape on Peak Research — close this Trigger tab → desk tab
      closeResearchTab()
    }
  }

  const canShare = Boolean(
    body.trim() || meta?.likely_driver || seededDriver,
  )

  const headerTitle = (
    <>
      {flowTitle(payload?.kind)} · {ticker}
      {move != null ? (
        <span
          className={cn(
            'ml-2 text-sm font-semibold tabular-nums',
            move < 0 ? 'text-rose-600' : 'text-emerald-600',
          )}
        >
          {fmtPct(move)}
        </span>
      ) : null}
    </>
  )

  const headerDescription = (
    <>
      Research · notification · share image
      {isPanel
        ? '. Edit / Share opens Trigger.'
        : '. Close (X) returns to the episode desk tab.'}
      {companyName && companyName !== ticker ? ` · ${companyName}` : ''}
    </>
  )

  const bodyGrid = (
        <div
          className={cn(
            'grid min-h-0 flex-1 grid-cols-1 divide-y divide-border overflow-hidden',
            isPanel
              ? 'lg:grid-cols-1 xl:grid-cols-3 xl:divide-x xl:divide-y-0'
              : 'lg:grid-cols-3 lg:divide-x lg:divide-y-0',
          )}
        >
          {/* ── 1 · Perplexity: findings TOP, prompt below ── */}
          <div className="flex min-h-0 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                1 · Perplexity research
              </p>

              {driverDisplay ? (
                <div className="space-y-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-300">
                    Likely driver
                  </p>
                  <p className="text-[13px] font-medium leading-snug">
                    {driverDisplay}
                  </p>
                  {meta?.secondary_driver ? (
                    <>
                      <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Secondary
                      </p>
                      <p className="text-[12px] leading-snug text-foreground/90">
                        {meta.secondary_driver}
                      </p>
                    </>
                  ) : null}
                  {meta?.move_classification ? (
                    <>
                      <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Move classification
                      </p>
                      <p className="text-[12px] leading-snug">
                        {meta.move_classification}
                      </p>
                    </>
                  ) : null}
                  {meta?.confidence ? (
                    <>
                      <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Confidence
                      </p>
                      <p className="text-[12px] leading-snug">
                        {meta.confidence}
                      </p>
                    </>
                  ) : null}
                  {flowKind === 'peak' &&
                  seededDriver &&
                  driverDisplay === seededDriver ? (
                    <p className="pt-1 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                      Prefilled from episode STARTED research
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1 text-[10px] text-muted-foreground">
                    {meta?.model_version || meta?.model ? (
                      <span className="font-mono">
                        {meta.model_version || meta.model}
                      </span>
                    ) : null}
                    {meta?.cost_usd_display ? (
                      <span>{meta.cost_usd_display}</span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
                  {flowKind === 'peak'
                    ? 'No STARTED likely driver yet — run research or it will appear here.'
                    : 'Likely driver appears here after research.'}
                </p>
              )}

              {prepareError ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  {prepareError}
                </p>
              ) : null}
              {researchError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                  {researchError}
                </p>
              ) : null}

              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Prompt
              </p>
              {!promptReady ? (
                <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Building research prompt…
                </p>
              ) : (
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={researchBusy}
                  spellCheck={false}
                  className="min-h-[180px] resize-y font-mono text-[11px] leading-relaxed"
                  placeholder="Perplexity research prompt…"
                />
              )}
            </div>
            <div className="shrink-0 border-t border-border p-4">
              <Button
                type="button"
                className="w-full gap-2"
                disabled={researchBusy || !promptReady || !prompt.trim()}
                onClick={() => void runResearch()}
              >
                {researchBusy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                {researchBusy ? 'Running Perplexity…' : 'Run research'}
              </Button>
            </div>
          </div>

          {/* ── 2 · Notification preview ── */}
          <div className="flex min-h-0 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                2 · Notification
              </p>
              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Title
                </p>
                <p className="mt-1 text-[15px] font-semibold leading-snug">
                  {title || '—'}
                </p>
                {fmtSharePriceRange(
                  payload?.priceFrom ?? null,
                  payload?.price ?? null,
                ) ? (
                  <p className="mt-2 text-[12px] tabular-nums text-muted-foreground">
                    Share price{' '}
                    <span className="font-semibold text-foreground">
                      {fmtSharePriceRange(
                        payload?.priceFrom ?? null,
                        payload?.price ?? null,
                      )}
                    </span>
                    {move != null ? (
                      <span
                        className={cn(
                          'ml-2 font-semibold',
                          move < 0 ? 'text-rose-600' : 'text-emerald-600',
                        )}
                      >
                        {fmtPct(move)}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Body
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">
                  {body || 'Likely driver for the push…'}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sofar-title">Edit title</Label>
                <Input
                  id="sofar-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-10 text-sm font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sofar-body">Edit body</Label>
                <Textarea
                  id="sofar-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  className="resize-y text-sm leading-relaxed"
                  placeholder="Likely driver text for the push / share card"
                />
              </div>
            </div>
            <div className="shrink-0 border-t border-border p-4">
              <Button
                type="button"
                className="w-full gap-2"
                disabled={Boolean(actionBusy) || !title.trim()}
                onClick={() => void handleNotify()}
              >
                {actionBusy === 'notify' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <BellRing className="size-4" />
                )}
                Notify users
              </Button>
            </div>
          </div>

          {/* ── 3 · Share image + Edit / Share ── */}
          <div className="flex min-h-0 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                3 · Share image
              </p>
              <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-border bg-muted/20 p-3">
                {previewBusy ? (
                  <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Rendering preview…
                  </p>
                ) : previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={`${ticker} share preview`}
                    className="max-h-[min(58vh,560px)] w-auto max-w-full rounded-lg object-contain shadow-sm"
                  />
                ) : (
                  <p className="px-4 text-center text-[12px] text-muted-foreground">
                    {previewError ||
                      'Add a likely driver to see the share image preview.'}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-border p-4">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                disabled={Boolean(actionBusy) || !canShare}
                onClick={() => void handleEdit()}
              >
                {actionBusy === 'edit' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Pencil className="size-4" />
                )}
                Edit
              </Button>
              <Button
                type="button"
                className="w-full gap-2"
                disabled={Boolean(actionBusy) || !canShare}
                onClick={() => void handleShareSocial()}
              >
                {actionBusy === 'share' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Share2 className="size-4" />
                )}
                Share on social media
              </Button>
            </div>
          </div>
        </div>
  )

  if (!open || !ticker) return null

  if (isPanel) {
    return (
      <div
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden bg-background',
          className,
        )}
      >
        <div className="shrink-0 border-b border-border px-4 py-3 pr-3 text-left">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-semibold leading-snug">
                {headerTitle}
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {headerDescription}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 shrink-0"
              aria-label="Close research panel"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        {bodyGrid}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        showCloseButton
        className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3 pr-14 text-left">
          <DialogTitle className="text-lg">{headerTitle}</DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            {headerDescription}
          </DialogDescription>
        </DialogHeader>
        {bodyGrid}
      </DialogContent>
    </Dialog>
  )
}
