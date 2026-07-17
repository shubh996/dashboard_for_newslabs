import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertCircle, Check, X } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type BottomToastVariant = 'default' | 'destructive'

export type BottomToastAction = {
  label: string
  onClick: () => void
}

export type BottomToastInput = {
  title: string
  description?: string
  variant?: BottomToastVariant
  /** Optional CTA (e.g. Undo). When present, toast stays longer. */
  action?: BottomToastAction
  /** Auto-dismiss ms. Defaults: success 4.5s, error 6.5s, with action 8s. */
  durationMs?: number
}

type BottomToastState = BottomToastInput & { id: number }

type BottomToastContextValue = {
  toast: (input: BottomToastInput | string, description?: string, variant?: BottomToastVariant) => void
  dismiss: () => void
}

const BottomToastContext = createContext<BottomToastContextValue | null>(null)

export function useBottomToast() {
  const ctx = useContext(BottomToastContext)
  if (!ctx) {
    throw new Error('useBottomToast must be used within BottomToastProvider')
  }
  return ctx
}

/** Safe hook — no-ops if provider is missing (avoids crashes in isolated trees). */
export function useBottomToastOptional() {
  return useContext(BottomToastContext)
}

export function BottomToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<BottomToastState | null>(null)
  const idRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  const dismiss = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setCurrent(null)
  }, [])

  const toast = useCallback(
    (input: BottomToastInput | string, description?: string, variant: BottomToastVariant = 'default') => {
      const payload: BottomToastInput =
        typeof input === 'string'
          ? { title: input, description, variant }
          : { variant: 'default', ...input }

      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }

      const id = ++idRef.current
      setCurrent({ ...payload, id })

      const ms =
        payload.durationMs ??
        (payload.action ? 8000 : payload.variant === 'destructive' ? 6500 : 4500)

      timerRef.current = window.setTimeout(() => {
        setCurrent((prev) => (prev?.id === id ? null : prev))
        timerRef.current = null
      }, ms)
    },
    [],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <BottomToastContext.Provider value={value}>
      {children}
      {current ? (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-5 z-[200] flex justify-center px-4 sm:bottom-6"
          role="status"
          aria-live="polite"
        >
          <div
            key={current.id}
            className="pointer-events-auto w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300"
          >
            <Alert
              variant={current.variant === 'destructive' ? 'destructive' : 'default'}
              className={cn(
                'border bg-background/95 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-background/90',
                current.variant === 'destructive' ? 'border-destructive/45' : 'border-emerald-500/35',
              )}
            >
              {current.variant === 'destructive' ? <AlertCircle /> : <Check />}
              <AlertTitle>{current.title}</AlertTitle>
              {current.description ? (
                <AlertDescription>{current.description}</AlertDescription>
              ) : null}
              <AlertAction className="flex items-center gap-1">
                {current.action ? (
                  <Button
                    size="sm"
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const run = current.action?.onClick
                      dismiss()
                      run?.()
                    }}
                  >
                    {current.action.label}
                  </Button>
                ) : null}
                <Button
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  aria-label="Dismiss"
                  onClick={dismiss}
                >
                  <X className="size-4" />
                </Button>
              </AlertAction>
            </Alert>
          </div>
        </div>
      ) : null}
    </BottomToastContext.Provider>
  )
}
