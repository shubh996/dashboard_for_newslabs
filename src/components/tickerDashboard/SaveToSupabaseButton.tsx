import { useState } from 'react'
import { Check, Database, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { saveManagerSnapshot, savePoliticianSnapshot, saveTickerSnapshot } from '@/services/tickerDashboardService'
import type { ManagerPortfolio, PoliticianPageData, TickerDashboardBundle } from '@/types/edgar'

type SaveProps =
  | { kind: 'ticker'; identifier: string; bundle: TickerDashboardBundle }
  | { kind: 'manager'; identifier: string | number; bundle: ManagerPortfolio }
  | { kind: 'politician'; identifier: string; bundle: PoliticianPageData }

export function SaveToSupabaseButton(
  props: SaveProps & {
    sourceMetadata: Record<string, unknown>
    alreadySaved: boolean
    onSaved?: (savedAt: string) => void
  },
) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

  async function handleSave() {
    setState('saving')
    setError('')
    try {
      const saved =
        props.kind === 'ticker'
          ? await saveTickerSnapshot(props.identifier, props.bundle, props.sourceMetadata)
          : props.kind === 'manager'
            ? await saveManagerSnapshot(props.identifier, props.bundle, props.sourceMetadata)
            : await savePoliticianSnapshot(props.identifier, props.bundle, props.sourceMetadata)

      setState('saved')
      props.onSaved?.(saved?.createdAt || new Date().toISOString())
      setTimeout(() => setState('idle'), 3000)
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const label = state === 'saved' ? 'Saved' : props.alreadySaved ? 'Update to Supabase' : 'Save to Supabase'

  return (
    <div className="flex flex-col items-end gap-1">
      <Button disabled={state === 'saving'} onClick={handleSave} size="sm" variant="outline">
        {state === 'saving' ? <Loader2 className="size-4 animate-spin" /> : state === 'saved' ? <Check className="size-4" /> : <Database className="size-4" />}
        {label}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}
