/**
 * Full-screen editor for Perplexity prompt templates.
 * Loads/saves via /api/momentum/perplexity-prompts.
 * Server always pulls from Supabase into memory; disk is mirror/fallback only.
 * Browser also mirrors into localStorage for the alert composer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Loader2, RotateCcw, Save, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const LOCAL_CACHE_KEY = 'momentum-research-prompt-templates-v1'
const LOCAL_ALL_PROMPTS_KEY = 'momentum-perplexity-prompts-v1'

export type PerplexityPromptItem = {
  id: string
  label: string
  group: string
  description: string
  placeholders: string[]
  body: string
  default_body: string
  overridden: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function normalizeResearchClassFromId(id: string): string | null {
  if (id === 'momentum_research_equity') return 'equity'
  if (id === 'momentum_research_commodity') return 'commodity'
  if (id === 'momentum_research_crypto') return 'crypto'
  if (id === 'momentum_research_forex') return 'forex'
  if (id === 'momentum_research_index') return 'index'
  return null
}

/** Keep legacy localStorage research templates in sync for the alert composer. */
function mirrorResearchTemplatesToLocal(prompts: Record<string, string>) {
  try {
    const research: Record<string, string> = {}
    for (const [id, body] of Object.entries(prompts)) {
      const cls = normalizeResearchClassFromId(id)
      if (cls && body.trim()) research[cls] = body
    }
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(research))
    localStorage.setItem(LOCAL_ALL_PROMPTS_KEY, JSON.stringify(prompts))
  } catch {
    /* ignore quota */
  }
}

export function PerplexityPromptsDialog({ open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveOk, setSaveOk] = useState(false)
  const [items, setItems] = useState<PerplexityPromptItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [activeId, setActiveId] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setSaveOk(false)
    try {
      const res = await fetch('/api/momentum/perplexity-prompts')
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        prompts?: PerplexityPromptItem[]
      }
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Load failed (${res.status})`)
      }
      const list = Array.isArray(body.prompts) ? body.prompts : []
      setItems(list)
      const nextDrafts: Record<string, string> = {}
      for (const p of list) {
        nextDrafts[p.id] = p.body || p.default_body || ''
      }
      setDrafts(nextDrafts)
      setActiveId((prev) => {
        if (prev && list.some((p) => p.id === prev)) return prev
        return list[0]?.id || ''
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prompts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const active = useMemo(
    () => items.find((p) => p.id === activeId) || null,
    [items, activeId],
  )

  const dirtyIds = useMemo(() => {
    const dirty = new Set<string>()
    for (const p of items) {
      const draft = String(drafts[p.id] ?? '')
      const current = String(p.body || '')
      if (draft.trim() !== current.trim()) dirty.add(p.id)
    }
    return dirty
  }, [items, drafts])

  const dirtyCount = dirtyIds.size

  function resetActiveToDefault() {
    if (!active) return
    setDrafts((prev) => ({
      ...prev,
      [active.id]: active.default_body || '',
    }))
    setSaveOk(false)
  }

  async function saveAll() {
    setSaving(true)
    setError('')
    setSaveOk(false)
    try {
      /** @type {Record<string, string>} */
      const prompts: Record<string, string> = {}
      for (const p of items) {
        const draft = String(drafts[p.id] ?? '').trim()
        const defaultBody = String(p.default_body || '').trim()
        // Empty or equal-to-default → clear override (server uses built-in)
        prompts[p.id] = draft && draft !== defaultBody ? draft : ''
      }
      const res = await fetch('/api/momentum/perplexity-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        prompts?: PerplexityPromptItem[]
        supabase?: { ok?: boolean; error?: string }
      }
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Save failed (${res.status})`)
      }
      const list = Array.isArray(body.prompts) ? body.prompts : []
      setItems(list)
      const nextDrafts: Record<string, string> = {}
      for (const p of list) {
        nextDrafts[p.id] = p.body || p.default_body || ''
      }
      setDrafts(nextDrafts)
      mirrorResearchTemplatesToLocal(
        Object.fromEntries(
          list.map((p) => [p.id, p.body || p.default_body || '']),
        ),
      )
      if (body.supabase && body.supabase.ok === false) {
        setError(
          `Saved on server, but Supabase failed: ${body.supabase.error || 'unknown'}. Run supabase/schema_perplexity_prompts.sql if the table is missing.`,
        )
      } else {
        setSaveOk(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save prompts')
    } finally {
      setSaving(false)
    }
  }

  const groups = useMemo(() => {
    const order = ['momentum_research', 'market_bulletin']
    const byGroup = new Map<string, PerplexityPromptItem[]>()
    for (const p of items) {
      const g = p.group || 'other'
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g)!.push(p)
    }
    const keys = [
      ...order.filter((g) => byGroup.has(g)),
      ...[...byGroup.keys()].filter((g) => !order.includes(g)),
    ]
    return keys.map((g) => ({
      id: g,
      label:
        g === 'momentum_research'
          ? 'Momentum research'
          : g === 'market_bulletin'
            ? 'Market bulletins'
            : g,
      items: byGroup.get(g) || [],
    }))
  }, [items])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="fixed inset-0 z-50 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3 pr-14 text-left">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ScrollText className="size-4" strokeWidth={1.75} />
            Perplexity prompts
          </DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            Edit momentum research and market bulletin templates. Save writes to
            the API + Supabase, and caches a copy in this browser.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <aside className="flex max-h-[40vh] w-full shrink-0 flex-col border-b border-border bg-muted/20 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {loading && !items.length ? (
                <p className="flex items-center gap-1.5 px-2 py-3 text-[12px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading prompts…
                </p>
              ) : null}
              {groups.map((group) => (
                <div key={group.id} className="mb-3">
                  <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((p) => {
                      const selected = p.id === activeId
                      const dirty = dirtyIds.has(p.id)
                      const draft = String(drafts[p.id] ?? '')
                      const isCustom =
                        draft.trim() &&
                        draft.trim() !== String(p.default_body || '').trim()
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setActiveId(p.id)
                            setSaveOk(false)
                          }}
                          className={cn(
                            'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                            selected
                              ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                              : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] font-medium leading-snug">
                              {p.label}
                            </span>
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              {isCustom ? (
                                <Badge
                                  variant="secondary"
                                  className="h-4 px-1.5 text-[9px]"
                                >
                                  Custom
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="h-4 px-1.5 text-[9px]"
                                >
                                  Default
                                </Badge>
                              )}
                              {dirty ? (
                                <Badge className="h-4 bg-amber-500/15 px-1.5 text-[9px] text-amber-800 dark:text-amber-200">
                                  Unsaved
                                </Badge>
                              ) : null}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {active ? (
              <>
                <div className="shrink-0 space-y-2 border-b border-border px-5 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold text-foreground">
                        {active.label}
                      </h3>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {active.description}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={resetActiveToDefault}
                      disabled={
                        String(drafts[active.id] ?? '').trim() ===
                        String(active.default_body || '').trim()
                      }
                    >
                      <RotateCcw className="size-3.5" strokeWidth={1.75} />
                      Reset to default
                    </Button>
                  </div>
                  {active.placeholders?.length ? (
                    <p className="text-[11px] text-muted-foreground">
                      Placeholders:{' '}
                      <span className="font-mono text-[10px] text-foreground/80">
                        {active.placeholders.join(' · ')}
                      </span>
                    </p>
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 p-4">
                  <Textarea
                    value={drafts[active.id] ?? ''}
                    onChange={(e) => {
                      const value = e.target.value
                      setDrafts((prev) => ({ ...prev, [active.id]: value }))
                      setSaveOk(false)
                    }}
                    spellCheck={false}
                    className="h-full min-h-[280px] resize-none font-mono text-[12px] leading-relaxed"
                    placeholder="Prompt template…"
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-[13px] text-muted-foreground">
                {loading ? 'Loading…' : 'Select a prompt to edit.'}
              </div>
            )}

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background px-5 py-3">
              {error ? (
                <p className="mr-auto max-w-xl text-[11px] text-rose-700 dark:text-rose-300">
                  {error}
                </p>
              ) : saveOk ? (
                <p className="mr-auto inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                  <Check className="size-3.5" />
                  Saved
                </p>
              ) : dirtyCount > 0 ? (
                <p className="mr-auto text-[11px] text-muted-foreground">
                  {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}
                </p>
              ) : (
                <p className="mr-auto text-[11px] text-muted-foreground">
                  No unsaved changes
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load()}
                disabled={loading || saving}
              >
                Reload
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => void saveAll()}
                disabled={saving || loading || dirtyCount === 0}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" strokeWidth={1.75} />
                )}
                Save all
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
