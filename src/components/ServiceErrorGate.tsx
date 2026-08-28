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
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { getApiBase, hasExternalApiBase } from '@/lib/apiBase'
import { supabase, supabaseAuthConfigured } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'

export type ServiceName =
  | 'api'
  | 'railway'
  | 'supabase'
  | 'yahoo'
  | 'unknown'
  | string

export type ServiceErrorItem = {
  id: string
  service: ServiceName
  title: string
  message: string
  detail?: string | null
  path?: string | null
  httpStatus?: number | null
  at: string
}

type ReportInput = {
  service?: ServiceName
  title?: string
  message: string
  detail?: string | null
  path?: string | null
  httpStatus?: number | null
}

type ServiceErrorContextValue = {
  reportServiceError: (input: ReportInput) => void
  clearServiceErrors: () => void
  errors: ServiceErrorItem[]
}

const ServiceErrorContext = createContext<ServiceErrorContextValue | null>(null)

const DEDUPE_MS = 20_000
const MAX_ERRORS = 25

/** Paths that poll often — still reported, but deduped harder. */
const QUIET_PATH_HINTS = [
  '/api/momentum/active-episodes',
  '/api/notifications/devices',
]

function inferService(pathOrUrl: string): ServiceName {
  const u = String(pathOrUrl || '').toLowerCase()
  if (u.includes('supabase.co') || u.includes('supabase')) return 'supabase'
  if (u.includes('yahoo') || u.includes('finance.yahoo')) return 'yahoo'
  if (u.includes('railway.app') || u.includes('railway')) return 'railway'
  if (u.includes('/api/')) {
    return hasExternalApiBase() ? 'railway' : 'api'
  }
  return 'unknown'
}

function serviceLabel(service: ServiceName): string {
  switch (service) {
    case 'api':
      return 'API'
    case 'railway':
      return 'Railway / API'
    case 'supabase':
      return 'Supabase'
    case 'yahoo':
      return 'Yahoo Finance'
    default:
      return String(service || 'Service')
  }
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

let reportSink: ((input: ReportInput) => void) | null = null

/** Call from anywhere (hooks, services) without React context. */
export function reportServiceError(input: ReportInput) {
  reportSink?.(input)
}

export function useServiceErrors() {
  const ctx = useContext(ServiceErrorContext)
  if (!ctx) {
    throw new Error('useServiceErrors must be used within ServiceErrorGate')
  }
  return ctx
}

export function ServiceErrorGate({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<ServiceErrorItem[]>([])
  const [open, setOpen] = useState(false)
  const dedupeRef = useRef<Map<string, number>>(new Map())
  const checkingRef = useRef(false)

  const reportServiceErrorInternal = useCallback((input: ReportInput) => {
    const message = String(input.message || '').trim()
    if (!message) return

    const service =
      input.service ||
      (input.path ? inferService(input.path) : 'unknown')
    const path = input.path || null
    const httpStatus = input.httpStatus ?? null
    const dedupeKey = [
      service,
      httpStatus ?? '',
      path || '',
      message.slice(0, 120),
    ].join('|')

    const now = Date.now()
    const last = dedupeRef.current.get(dedupeKey) || 0
    const quiet = QUIET_PATH_HINTS.some((h) =>
      String(path || '').includes(h),
    )
    if (now - last < (quiet ? DEDUPE_MS * 2 : DEDUPE_MS)) return
    dedupeRef.current.set(dedupeKey, now)

    const item: ServiceErrorItem = {
      id: makeId(),
      service,
      title: input.title || `${serviceLabel(service)} error`,
      message,
      detail: input.detail || null,
      path,
      httpStatus,
      at: new Date().toISOString(),
    }

    setErrors((prev) => [item, ...prev].slice(0, MAX_ERRORS))
    setOpen(true)
  }, [])

  useEffect(() => {
    reportSink = reportServiceErrorInternal
    return () => {
      if (reportSink === reportServiceErrorInternal) reportSink = null
    }
  }, [reportServiceErrorInternal])

  const clearServiceErrors = useCallback(() => {
    setErrors([])
    setOpen(false)
  }, [])

  const runStartupChecks = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    try {
      // 1) API / Railway
      try {
        const res = await fetch(`/api/health?_=${Date.now()}`, {
          cache: 'no-store',
        })
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          supabaseConfigured?: boolean
          error?: string
          service?: string
        }
        if (!res.ok || body.ok === false) {
          reportServiceErrorInternal({
            service: hasExternalApiBase() ? 'railway' : 'api',
            title: hasExternalApiBase()
              ? 'Railway / API unreachable'
              : 'API unreachable',
            message:
              body.error ||
              `Health check failed (HTTP ${res.status})`,
            path: '/api/health',
            httpStatus: res.status,
            detail: getApiBase() || 'same-origin /api',
          })
        } else if (body.supabaseConfigured === false) {
          reportServiceErrorInternal({
            service: 'supabase',
            title: 'Supabase not configured',
            message:
              'API is up, but SUPABASE_URL / keys are missing on the server.',
            path: '/api/health',
          })
        }
      } catch (err) {
        reportServiceErrorInternal({
          service: hasExternalApiBase() ? 'railway' : 'api',
          title: hasExternalApiBase()
            ? 'Railway / API connection failed'
            : 'API connection failed',
          message: err instanceof Error ? err.message : 'Network error',
          path: '/api/health',
          detail: getApiBase() || 'same-origin /api',
        })
      }

      // 2) Supabase (browser client)
      if (!supabaseAuthConfigured || !supabase) {
        reportServiceErrorInternal({
          service: 'supabase',
          title: 'Supabase client missing',
          message:
            'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set in the frontend build.',
        })
      } else {
        try {
          const { error } = await supabase
            .from('device_profiles')
            .select('device_id')
            .limit(1)
          if (error) {
            reportServiceErrorInternal({
              service: 'supabase',
              title: 'Supabase query failed',
              message: error.message,
              detail: error.code || error.details || null,
              path: 'device_profiles',
            })
          }
        } catch (err) {
          reportServiceErrorInternal({
            service: 'supabase',
            title: 'Supabase connection failed',
            message: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }

      // 3) Yahoo Finance route (modules catalog — lightweight)
      try {
        const res = await fetch(`/api/yahoo/modules?_=${Date.now()}`, {
          cache: 'no-store',
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          reportServiceErrorInternal({
            service: 'yahoo',
            title: 'Yahoo Finance API error',
            message: body.error || `HTTP ${res.status}`,
            path: '/api/yahoo/modules',
            httpStatus: res.status,
          })
        }
      } catch (err) {
        reportServiceErrorInternal({
          service: 'yahoo',
          title: 'Yahoo Finance unreachable',
          message: err instanceof Error ? err.message : 'Network error',
          path: '/api/yahoo/modules',
        })
      }
    } finally {
      checkingRef.current = false
    }
  }, [reportServiceErrorInternal])

  // Startup probes as soon as the gate mounts (after passcode unlock, etc.)
  useEffect(() => {
    void runStartupChecks()
  }, [runStartupChecks])

  // Intercept failed /api fetch responses for the whole app
  useEffect(() => {
    const nativeFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let url = ''
      try {
        if (typeof input === 'string') url = input
        else if (input instanceof URL) url = input.toString()
        else if (input instanceof Request) url = input.url
      } catch {
        url = ''
      }

      try {
        const res = await nativeFetch(input, init)
        const isApi =
          url.includes('/api/') ||
          (hasExternalApiBase() &&
            getApiBase() &&
            url.startsWith(getApiBase()))
        if (isApi && !res.ok) {
          const path = (() => {
            try {
              return new URL(url, window.location.origin).pathname
            } catch {
              return url
            }
          })()
          const clone = res.clone()
          void clone
            .json()
            .then((body: { error?: string; message?: string }) => {
              reportServiceErrorInternal({
                service: inferService(url),
                title: `${serviceLabel(inferService(url))} request failed`,
                message:
                  body?.error ||
                  body?.message ||
                  res.statusText ||
                  `HTTP ${res.status}`,
                path,
                httpStatus: res.status,
              })
            })
            .catch(() => {
              reportServiceErrorInternal({
                service: inferService(url),
                title: `${serviceLabel(inferService(url))} request failed`,
                message: res.statusText || `HTTP ${res.status}`,
                path,
                httpStatus: res.status,
              })
            })
        }
        return res
      } catch (err) {
        const aborted =
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error &&
            (/abort/i.test(err.message) || err.name === 'AbortError'))
        if (
          !aborted &&
          (url.includes('/api/') ||
            url.includes('supabase') ||
            url.includes('yahoo'))
        ) {
          reportServiceErrorInternal({
            service: inferService(url),
            title: `${serviceLabel(inferService(url))} network error`,
            message: err instanceof Error ? err.message : 'Fetch failed',
            path: url,
          })
        }
        throw err
      }
    }

    return () => {
      window.fetch = nativeFetch
    }
  }, [reportServiceErrorInternal])

  // Unhandled promise rejections that look like service failures
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : ''
      if (!msg) return
      const lower = msg.toLowerCase()
      if (lower.includes('abort')) return
      if (
        lower.includes('supabase') ||
        lower.includes('yahoo') ||
        lower.includes('railway') ||
        lower.includes('/api/') ||
        lower.includes('failed to fetch')
      ) {
        reportServiceErrorInternal({
          service: inferService(msg),
          title: 'Unhandled service error',
          message: msg,
        })
      }
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [reportServiceErrorInternal])

  const ctx = useMemo(
    () => ({
      reportServiceError: reportServiceErrorInternal,
      clearServiceErrors,
      errors,
    }),
    [reportServiceErrorInternal, clearServiceErrors, errors],
  )

  const latest = errors[0] || null

  return (
    <ServiceErrorContext.Provider value={ctx}>
      {children}

      <Dialog
        open={open && errors.length > 0}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            // Keep history but close the popup; user can re-open via retry if needed
          }
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              Service error
              {errors.length > 1 ? (
                <Badge variant="destructive" className="ml-1">
                  {errors.length}
                </Badge>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              Something failed while talking to Supabase, Railway/API, Yahoo
              Finance, or another backend service.
            </DialogDescription>
          </DialogHeader>

          {latest ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{serviceLabel(latest.service)}</Badge>
                {latest.httpStatus != null ? (
                  <Badge variant="secondary">HTTP {latest.httpStatus}</Badge>
                ) : null}
                {latest.path ? (
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {latest.path}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm font-medium leading-snug">
                {latest.title}
              </p>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {latest.message}
              </p>
              {latest.detail ? (
                <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                  {latest.detail}
                </p>
              ) : null}
              <p className="mt-2 text-[10px] tabular-nums text-muted-foreground">
                {new Date(latest.at).toLocaleString()}
              </p>
            </div>
          ) : null}

          {errors.length > 1 ? (
            <>
              <Separator />
              <p className="text-xs font-medium text-muted-foreground">
                Recent errors
              </p>
              <ScrollArea className="max-h-40">
                <div className="space-y-2 pr-2">
                  {errors.slice(1).map((err) => (
                    <div
                      key={err.id}
                      className={cn(
                        'rounded-lg border px-2.5 py-2 text-xs',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {serviceLabel(err.service)}
                        </Badge>
                        <span className="truncate font-medium">{err.title}</span>
                      </div>
                      <p className="mt-1 break-words text-muted-foreground">
                        {err.message}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runStartupChecks()}
            >
              <RefreshCw className="size-3.5" />
              Re-check services
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearServiceErrors}
              >
                Dismiss all
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ServiceErrorContext.Provider>
  )
}
