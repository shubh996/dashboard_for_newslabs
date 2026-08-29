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
import { useLocation } from 'react-router-dom'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  RefreshCw,
} from 'lucide-react'

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
import { getApiBase, hasExternalApiBase } from '@/lib/apiBase'
import { supabase, supabaseAuthConfigured } from '@/lib/supabaseClient'
import { formatLocalDateTimeWithZone } from '@/lib/localTimeZone'
import { cn } from '@/lib/utils'

/** Trigger desk routes (extremes / share / users audience). */
function isTriggerDeskRoute(pathname: string): boolean {
  const p = String(pathname || '').replace(/\/+$/, '') || '/'
  return p === '/trigger' || p.startsWith('/trigger/') || p === '/notifications'
}

/** APIs that belong to Trigger desk only — never probe/report these on Episode. */
function isTriggerDeskApiPath(pathOrUrl: string): boolean {
  const p = String(pathOrUrl || '').toLowerCase()
  return (
    p.includes('/api/yahoo/extreme-movers') ||
    p.includes('/api/notifications/scrape') ||
    p.includes('/api/notifications/firecrawl') ||
    p.includes('/api/notifications/usage/') ||
    p.includes('/api/notifications/monitored-tickers') ||
    p.includes('/api/notifications/gemini') ||
    p.includes('/api/notifications/alert') ||
    p.includes('/api/notifications/save/') ||
    p.includes('/api/notifications/preview/')
  )
}

function isTriggerDeskError(err: {
  path?: string | null
  title?: string | null
  failed?: string | null
  intended?: string | null
}): boolean {
  const blob = `${err.path || ''} ${err.title || ''} ${err.failed || ''} ${err.intended || ''}`.toLowerCase()
  if (isTriggerDeskApiPath(blob)) return true
  return (
    blob.includes('extreme-movers') ||
    blob.includes('extreme movers') ||
    blob.includes('trigger desk') ||
    blob.includes('for the trigger')
  )
}

/** Expected failures from optional, fallback-backed desk requests. */
function isNonActionableOptionalFailure(input: {
  path?: string | null
  message?: string | null
  httpStatus?: number | null
}): boolean {
  const path = String(input.path || '')
    .toLowerCase()
    .replace(/\/+$/, '')
  const message = String(input.message || '').toLowerCase()
  const status = input.httpStatus ?? null

  // Deliberately disabled in desk-only mode; Momentum is the active source.
  if (
    path === '/api/yahoo/saved-tickers' &&
    status === 503 &&
    message.includes('momentum_desk_only')
  ) {
    return true
  }

  // Optional legacy table: the desk keeps its existing/local ticker buckets.
  if (
    path === '/api/momentum/monitored-tickers' &&
    message.includes('device_monitor') &&
    (message.includes('schema cache') ||
      message.includes('could not find the table') ||
      message.includes('does not exist'))
  ) {
    return true
  }

  // Optional pinned list: the Trigger page intentionally retains local cache.
  if (
    path === '/api/notifications/pinned-tickers' &&
    (message.includes('failed to load pinned tickers') ||
      (message.includes('pinned_monitored_tickers') &&
        (message.includes('missing') || message.includes('does not exist'))))
  ) {
    return true
  }

  return false
}

/**
 * Service Error panel is critical-infra only.
 * Hide routine desk polls (/live, active-episodes, Yahoo quotes, usage, …).
 */
function isCriticalServiceFailure(input: {
  path?: string | null
  message?: string | null
  title?: string | null
  httpStatus?: number | null
  service?: string | null
}): boolean {
  if (
    isNonActionableOptionalFailure({
      path: input.path,
      message: input.message,
      httpStatus: input.httpStatus,
    })
  ) {
    return false
  }

  const path = String(input.path || '')
    .toLowerCase()
    .replace(/\/+$/, '')
  const message = String(input.message || '').toLowerCase()
  const title = String(input.title || '').toLowerCase()
  const service = String(input.service || '').toLowerCase()

  // API / Railway health & reachability (whole backend down).
  if (
    path.includes('/api/health') ||
    title.includes('unreachable') ||
    title.includes('api connection failed') ||
    title.includes('railway / api connection failed') ||
    title.includes('railway / api unreachable') ||
    title.includes('api unreachable')
  ) {
    return true
  }

  // Supabase missing / not configured / startup probe broken.
  if (
    service === 'supabase' ||
    title.includes('supabase') ||
    path === 'device_profiles' ||
    path.includes('device_profiles')
  ) {
    if (
      title.includes('client missing') ||
      title.includes('not configured') ||
      title.includes('connection failed') ||
      title.includes('query failed') ||
      message.includes('supabase not configured') ||
      message.includes('supabase_url') ||
      message.includes('anon_key')
    ) {
      return true
    }
  }

  return false
}

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
  /** Optional structured payload (response body, thrown error, etc.) */
  raw?: unknown
  /** What this call was trying to fetch / do */
  intended?: string | null
  /** What we successfully got (if anything) before/alongside the failure */
  pulled?: string | null
  /** What specifically failed to load */
  failed?: string | null
}

type ReportInput = {
  service?: ServiceName
  title?: string
  message: string
  detail?: string | null
  path?: string | null
  httpStatus?: number | null
  raw?: unknown
  intended?: string | null
  pulled?: string | null
  failed?: string | null
}

function tryParseJson(text: string | null | undefined): unknown {
  if (!text) return null
  const s = String(text).trim()
  if (!s) return null
  if (!(s.startsWith('{') || s.startsWith('['))) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** Guess what an API path was trying to load when reporters omit intended/failed. */
function inferPullContext(input: {
  service?: ServiceName
  path?: string | null
  title?: string | null
  message?: string | null
}): { intended: string; pulled: string; failed: string } {
  const path = String(input.path || '').toLowerCase()
  const title = String(input.title || '').toLowerCase()
  const msg = String(input.message || '').toLowerCase()
  const svc = serviceLabel(input.service || inferService(path || msg))

  if (path.includes('/api/health') || title.includes('unreachable') || title.includes('health')) {
    return {
      intended:
        'API health check — confirm the server is up and whether Supabase keys are configured on the backend',
      pulled: 'Nothing useful — health check did not return a healthy response',
      failed: 'Server health / reachability (and any config flags health would have returned)',
    }
  }
  if (path.includes('extreme-movers') || title.includes('yahoo')) {
    return {
      intended:
        'Yahoo Finance extreme movers (≥5% day move) — tickers, % change, prices for the Trigger desk',
      pulled: 'No movers list — the Yahoo request failed before usable rows came back',
      failed: 'Extreme movers / Yahoo quote batch for that probe',
    }
  }
  if (path.includes('device_profiles') || title.includes('supabase query')) {
    return {
      intended:
        'Supabase probe — read one row from device_profiles to prove DB + keys work',
      pulled: 'No device_profiles row — query did not succeed',
      failed: 'device_profiles read (and by extension live Supabase access from the browser)',
    }
  }
  if (title.includes('supabase client missing') || title.includes('not configured')) {
    return {
      intended: 'Use Supabase from the app (auth + table reads/writes)',
      pulled: 'Nothing from Supabase — client/config is missing',
      failed: 'Supabase URL / anon or service keys (frontend or server env)',
    }
  }
  if (path.includes('/api/momentum') || path.includes('episode')) {
    return {
      intended:
        'Momentum / episode data from the API (live episode, events, or history for the desk)',
      pulled: 'No usable momentum payload from this request',
      failed: path
        ? `Momentum data at ${path}`
        : 'Momentum / episode API response',
    }
  }
  if (path.includes('/api/yahoo') || path.includes('quote') || path.includes('chart')) {
    return {
      intended: 'Yahoo Finance market data (quotes, charts, or related modules)',
      pulled: 'No usable Yahoo payload from this request',
      failed: path ? `Yahoo data at ${path}` : 'Yahoo Finance request',
    }
  }
  if (path.includes('/api/notifications') || path.includes('device')) {
    return {
      intended: 'Trigger notification / device data from the API',
      pulled: 'No usable devices/notifications payload from this request',
      failed: path ? `Notifications data at ${path}` : 'Notifications API request',
    }
  }
  if (path.includes('/api/')) {
    return {
      intended: `Backend API data via ${path}`,
      pulled: 'No usable response body for the desk',
      failed: `API call to ${path}`,
    }
  }
  return {
    intended: `Talk to ${svc} for the operation that just failed`,
    pulled: 'Nothing confirmed — request did not complete successfully',
    failed: path || title || msg || `${svc} request`,
  }
}

/** Full dump for the expanded error view. */
function errorToJsonPayload(err: ServiceErrorItem): Record<string, unknown> {
  const parsedDetail = tryParseJson(err.detail)
  const pull = inferPullContext(err)
  return {
    id: err.id,
    service: err.service,
    serviceLabel: serviceLabel(err.service),
    title: err.title,
    message: err.message,
    path: err.path ?? null,
    httpStatus: err.httpStatus ?? null,
    at: err.at,
    intended: err.intended || pull.intended,
    pulled: err.pulled || pull.pulled,
    failed: err.failed || pull.failed,
    detail: parsedDetail ?? err.detail ?? null,
    raw: err.raw ?? null,
  }
}

function formatErrorJson(err: ServiceErrorItem): string {
  try {
    return JSON.stringify(errorToJsonPayload(err), null, 2)
  } catch {
    return String(err.message || err)
  }
}

/** Human-readable walkthrough of the error JSON for non-engineers. */
function explainErrorInPlainEnglish(err: ServiceErrorItem): string[] {
  const lines: string[] = []
  const svc = serviceLabel(err.service)
  const status = err.httpStatus
  const path = err.path ? String(err.path) : null
  const msg = String(err.message || '').trim()
  const pull = inferPullContext(err)
  const intended = String(err.intended || pull.intended).trim()
  const pulled = String(err.pulled || pull.pulled).trim()
  const failed = String(err.failed || pull.failed).trim()

  lines.push(
    `What broke: a request to ${svc} failed${path ? ` while calling ${path}` : ''}.`,
  )
  lines.push(`What we were trying to pull: ${intended}`)
  lines.push(`What we actually got: ${pulled}`)
  lines.push(`What did NOT pull: ${failed}`)

  if (status != null) {
    if (status === 401 || status === 403) {
      lines.push(
        `HTTP ${status} means the app was not allowed to talk to ${svc} (missing/expired key, or permission denied).`,
      )
    } else if (status === 404) {
      lines.push(
        `HTTP ${status} means ${svc} could not find that API route or resource (wrong path or not deployed).`,
      )
    } else if (status === 408 || status === 504) {
      lines.push(
        `HTTP ${status} means the request timed out — ${svc} was too slow or unreachable.`,
      )
    } else if (status >= 500) {
      lines.push(
        `HTTP ${status} means ${svc} itself crashed or returned a server error (not your browser).`,
      )
    } else if (status >= 400) {
      lines.push(
        `HTTP ${status} means the request was rejected as invalid (bad params, missing fields, or rate limit).`,
      )
    } else {
      lines.push(`HTTP status recorded: ${status}.`)
    }
  } else {
    lines.push(
      `No HTTP status was recorded — often a network failure (offline, CORS, or DNS) before a response arrived.`,
    )
  }

  if (msg) {
    lines.push(`System message: “${msg}”.`)
  }

  if (err.detail) {
    const parsed = tryParseJson(err.detail)
    if (parsed && typeof parsed === 'object') {
      lines.push(
        'Extra detail was returned as structured data (shown in JSON below) — usually the API’s own error body.',
      )
    } else {
      lines.push(
        `Extra detail: ${String(err.detail).slice(0, 240)}${String(err.detail).length > 240 ? '…' : ''}`,
      )
    }
  }

  if (err.raw != null) {
    lines.push(
      'A raw payload is attached (response body or thrown error). Scroll to Full JSON for exact fields.',
    )
  }

  if (err.service === 'supabase') {
    lines.push(
      'What to check: Supabase URL/keys in .env, table/RLS policies, and whether the project is paused.',
    )
  } else if (err.service === 'yahoo') {
    lines.push(
      'What to check: Yahoo API route on the server, rate limits, and whether the symbol/module is valid.',
    )
  } else if (err.service === 'railway' || err.service === 'api') {
    lines.push(
      'What to check: API server running, VITE_API_BASE_URL / Railway URL, and /api/health.',
    )
  } else {
    lines.push(
      'What to check: network tab for the failing request, then retry with Re-check services.',
    )
  }

  lines.push(
    `When: ${formatLocalDateTimeWithZone(err.at)} · Error id: ${err.id}`,
  )

  return lines
}

type ServiceErrorContextValue = {
  reportServiceError: (input: ReportInput) => void
  clearServiceErrors: () => void
  errors: ServiceErrorItem[]
}

const ServiceErrorContext = createContext<ServiceErrorContextValue | null>(null)

const DEDUPE_MS = 20_000
const MAX_ERRORS = 8

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
  const location = useLocation()
  const onTriggerDesk = isTriggerDeskRoute(location.pathname)
  const [errors, setErrors] = useState<ServiceErrorItem[]>([])
  const [open, setOpen] = useState(false)
  /** When set, dialog goes full-screen and shows this error’s full JSON. */
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const dedupeRef = useRef<Map<string, number>>(new Map())
  const checkingRef = useRef(false)
  const onTriggerDeskRef = useRef(onTriggerDesk)
  onTriggerDeskRef.current = onTriggerDesk

  const reportServiceErrorInternal = useCallback((input: ReportInput) => {
    const message = String(input.message || '').trim()
    if (!message) return

    const serviceGuess =
      input.service ||
      (input.path ? inferService(input.path) : 'unknown')

    // Critical infrastructure only — ignore poll / route noise.
    if (
      !isCriticalServiceFailure({
        path: input.path,
        message,
        title: input.title,
        httpStatus: input.httpStatus,
        service: serviceGuess,
      })
    ) {
      return
    }

    // Episode desk must not surface Trigger-desk-only failures.
    if (
      !onTriggerDeskRef.current &&
      isTriggerDeskError({
        path: input.path,
        title: input.title,
        failed: input.failed,
        intended: input.intended,
      })
    ) {
      return
    }

    const service = serviceGuess
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
    if (now - last < DEDUPE_MS) return
    dedupeRef.current.set(dedupeKey, now)

    const inferred = inferPullContext({
      service,
      path,
      title: input.title,
      message,
    })
    const item: ServiceErrorItem = {
      id: makeId(),
      service,
      title: input.title || `${serviceLabel(service)} error`,
      message,
      detail: input.detail || null,
      path,
      httpStatus,
      at: new Date().toISOString(),
      raw: input.raw ?? null,
      intended: input.intended || inferred.intended,
      pulled: input.pulled || inferred.pulled,
      failed: input.failed || inferred.failed,
    }

    setErrors((prev) => [item, ...prev].slice(0, MAX_ERRORS))
    setOpen(true)
    setExpandedId(null)
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
    setExpandedId(null)
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
            raw: body,
            intended:
              'Confirm API/Railway is online and report whether Supabase is configured on the server',
            pulled: 'Health check failed — no healthy status payload',
            failed: 'API health (uptime + supabaseConfigured flag)',
          })
        } else if (body.supabaseConfigured === false) {
          reportServiceErrorInternal({
            service: 'supabase',
            title: 'Supabase not configured',
            message:
              'API is up, but SUPABASE_URL / keys are missing on the server.',
            path: '/api/health',
            raw: body,
            intended:
              'Use Supabase from the API (episodes, devices, research, etc.)',
            pulled:
              'API health OK — server is reachable, but it reported Supabase as not configured',
            failed: 'Server-side SUPABASE_URL / service or anon keys',
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
          intended:
            'Confirm API/Railway is online before loading desk data',
          pulled: 'Nothing — could not complete /api/health',
          failed: 'API/Railway network connection',
        })
      }

      // 2) Supabase (browser client)
      if (!supabaseAuthConfigured || !supabase) {
        reportServiceErrorInternal({
          service: 'supabase',
          title: 'Supabase client missing',
          message:
            'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set in the frontend build.',
          intended:
            'Browser Supabase client for live table reads (devices, episodes hydrate, etc.)',
          pulled: 'Nothing — Vite env keys missing, client never created',
          failed: 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY',
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
              raw: error,
              intended:
                'Probe Supabase by reading one device_profiles.device_id',
              pulled: 'Query error — no device_id row returned',
              failed: 'device_profiles select (RLS, schema, or keys)',
            })
          }
        } catch (err) {
          reportServiceErrorInternal({
            service: 'supabase',
            title: 'Supabase connection failed',
            message: err instanceof Error ? err.message : 'Unknown error',
            intended: 'Open a live connection to Supabase from the browser',
            pulled: 'Nothing — connection threw before a query result',
            failed: 'Supabase browser connection',
            raw:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : err,
          })
        }
      }

      // Feature probes (Yahoo movers, momentum polls, …) are not critical infra.
    } finally {
      checkingRef.current = false
    }
  }, [reportServiceErrorInternal])

  // Startup probes on mount + when entering Trigger desk.
  useEffect(() => {
    void runStartupChecks()
  }, [runStartupChecks, onTriggerDesk])

  // Leaving Trigger → drop Trigger-desk-only errors so Episode stays clean.
  useEffect(() => {
    if (onTriggerDesk) return
    setErrors((prev) => {
      const next = prev.filter((e) => !isTriggerDeskError(e))
      if (next.length === prev.length) return prev
      if (next.length === 0) setOpen(false)
      return next
    })
  }, [onTriggerDesk])

  // Intercept failed /api fetch — only surface critical infra (/api/health).
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
        const path = (() => {
          try {
            return new URL(url, window.location.origin).pathname
          } catch {
            return url
          }
        })()
        const isHealth =
          path.includes('/api/health') ||
          String(url).includes('/api/health')
        if (isHealth && !res.ok) {
          const clone = res.clone()
          void clone
            .json()
            .then((body: { error?: string; message?: string }) => {
              reportServiceErrorInternal({
                service: hasExternalApiBase() ? 'railway' : 'api',
                title: hasExternalApiBase()
                  ? 'Railway / API unreachable'
                  : 'API unreachable',
                message:
                  body?.error ||
                  body?.message ||
                  res.statusText ||
                  `HTTP ${res.status}`,
                path: '/api/health',
                httpStatus: res.status,
                raw: body,
                detail:
                  typeof body === 'object'
                    ? JSON.stringify(body)
                    : String(body ?? ''),
                intended:
                  'Confirm API/Railway is online and report whether Supabase is configured on the server',
                pulled: 'Health check failed — no healthy status payload',
                failed: 'API health (uptime + supabaseConfigured flag)',
              })
            })
            .catch(() => {
              reportServiceErrorInternal({
                service: hasExternalApiBase() ? 'railway' : 'api',
                title: hasExternalApiBase()
                  ? 'Railway / API unreachable'
                  : 'API unreachable',
                message: res.statusText || `HTTP ${res.status}`,
                path: '/api/health',
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
        const isHealth = String(url).includes('/api/health')
        if (!aborted && isHealth) {
          reportServiceErrorInternal({
            service: hasExternalApiBase() ? 'railway' : 'api',
            title: hasExternalApiBase()
              ? 'Railway / API connection failed'
              : 'API connection failed',
            message: err instanceof Error ? err.message : 'Fetch failed',
            path: '/api/health',
            raw:
              err instanceof Error
                ? { name: err.name, message: err.message, stack: err.stack }
                : err,
            intended: 'Confirm API/Railway is online before loading desk data',
            pulled: 'Nothing — could not complete /api/health',
            failed: 'API/Railway network connection',
          })
        }
        throw err
      }
    }

    return () => {
      window.fetch = nativeFetch
    }
  }, [reportServiceErrorInternal])

  // Unhandled rejections — only Supabase / API reachability, not poll noise.
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
      const looksInfra =
        (lower.includes('supabase') &&
          (lower.includes('not configured') ||
            lower.includes('invalid api key') ||
            lower.includes('jwt') ||
            lower.includes('failed to fetch'))) ||
        lower.includes('/api/health')
      if (!looksInfra) return
      reportServiceErrorInternal({
        service: inferService(msg),
        title: lower.includes('supabase')
          ? 'Supabase connection failed'
          : 'API connection failed',
        message: msg,
      })
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [reportServiceErrorInternal])

  const actionableErrors = useMemo(
    () =>
      errors.filter((error) =>
        isCriticalServiceFailure({
          path: error.path,
          message: error.message,
          title: error.title,
          httpStatus: error.httpStatus,
          service: error.service,
        }),
      ),
    [errors],
  )

  const ctx = useMemo(
    () => ({
      reportServiceError: reportServiceErrorInternal,
      clearServiceErrors,
      errors: actionableErrors,
    }),
    [reportServiceErrorInternal, clearServiceErrors, actionableErrors],
  )

  const expanded = expandedId
    ? actionableErrors.find((e) => e.id === expandedId) || null
    : null
  const expandedJson = expanded ? formatErrorJson(expanded) : ''
  const expandedExplain = expanded ? explainErrorInPlainEnglish(expanded) : []

  return (
    <ServiceErrorContext.Provider value={ctx}>
      {children}

      <Dialog
        open={open && actionableErrors.length > 0}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setExpandedId(null)
        }}
      >
        <DialogContent
          showCloseButton={!expanded}
          className={cn(
            // Right-aligned full-height side panel (overrides centered dialog defaults)
            'fixed inset-y-0 right-0 top-0 left-auto flex h-dvh max-h-dvh w-[min(100vw,28rem)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l p-0 sm:max-w-none',
            'data-open:zoom-in-100 data-closed:zoom-out-100',
          )}
        >
          {expanded ? (
            <>
              <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-0.5 h-8 shrink-0 gap-1 px-2"
                  onClick={() => setExpandedId(null)}
                >
                  <ChevronLeft className="size-4" />
                  Back
                </Button>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                    <AlertTriangle className="size-4 shrink-0 text-destructive" />
                    <span className="break-words">{expanded.title}</span>
                  </DialogTitle>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">
                      {serviceLabel(expanded.service)}
                    </Badge>
                    {expanded.httpStatus != null ? (
                      <Badge variant="secondary">
                        HTTP {expanded.httpStatus}
                      </Badge>
                    ) : null}
                  </div>
                  <DialogDescription className="mt-1.5 break-words text-left">
                    {expanded.message}
                  </DialogDescription>
                  {expanded.path ? (
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {expanded.path}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5"
                  onClick={() => {
                    void navigator.clipboard?.writeText(expandedJson)
                  }}
                  title="Copy full JSON"
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className="space-y-4 px-4 py-4">
                  <section className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Plain English
                    </p>
                    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3 text-[13px] leading-snug text-foreground">
                      <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-2.5">
                        <p>
                          <span className="font-semibold text-sky-700 dark:text-sky-300">
                            Trying to pull:{' '}
                          </span>
                          <span className="break-words">
                            {expanded.intended ||
                              inferPullContext(expanded).intended}
                          </span>
                        </p>
                        <p>
                          <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                            Actually got:{' '}
                          </span>
                          <span className="break-words">
                            {expanded.pulled ||
                              inferPullContext(expanded).pulled}
                          </span>
                        </p>
                        <p>
                          <span className="font-semibold text-rose-700 dark:text-rose-300">
                            Did NOT pull:{' '}
                          </span>
                          <span className="break-words">
                            {expanded.failed ||
                              inferPullContext(expanded).failed}
                          </span>
                        </p>
                      </div>
                      <ul className="space-y-2">
                        {expandedExplain
                          .filter(
                            (line) =>
                              !line.startsWith('What we were trying to pull:') &&
                              !line.startsWith('What we actually got:') &&
                              !line.startsWith('What did NOT pull:'),
                          )
                          .map((line, i) => (
                            <li
                              key={`${i}-${line.slice(0, 24)}`}
                              className="flex gap-2"
                            >
                              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40" />
                              <span className="min-w-0 break-words">{line}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Full JSON
                    </p>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground">
                      {expandedJson}
                    </pre>
                  </section>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {formatLocalDateTimeWithZone(expanded.at)}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedId(null)}
                  >
                    Collapse
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setExpandedId(null)
                      setOpen(false)
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0 space-y-1.5 border-b border-border px-4 py-4">
                <DialogHeader className="gap-1.5 pr-8 text-left">
                  <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-destructive" />
                    Service error
                    {actionableErrors.length > 1 ? (
                      <Badge variant="destructive" className="ml-1">
                        {actionableErrors.length}
                      </Badge>
                    ) : null}
                  </DialogTitle>
                  <DialogDescription>
                    Critical infrastructure only (API down, Supabase broken).
                    Desk poll noise is hidden.
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
                <div className="space-y-2 py-3">
                  {actionableErrors.map((err) => {
                    const isOpen = expandedId === err.id
                    return (
                      <button
                        key={err.id}
                        type="button"
                        onClick={() => setExpandedId(err.id)}
                        className={cn(
                          'w-full rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-left transition-colors hover:border-destructive/50 hover:bg-destructive/10',
                        )}
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">
                                {serviceLabel(err.service)}
                              </Badge>
                              {err.httpStatus != null ? (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  HTTP {err.httpStatus}
                                </Badge>
                              ) : null}
                              {err.path ? (
                                <span className="truncate font-mono text-[10px] text-muted-foreground">
                                  {err.path}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1.5 text-sm font-medium leading-snug">
                              {err.title}
                            </p>
                            <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
                              {err.message}
                            </p>
                            <p className="mt-1.5 text-[10px] tabular-nums text-muted-foreground">
                              {formatLocalDateTimeWithZone(err.at)} · Expand
                            </p>
                          </div>
                          <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                            {isOpen ? (
                              <ChevronUp className="size-4" />
                            ) : (
                              <ChevronDown className="size-4" />
                            )}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <DialogFooter className="shrink-0 gap-2 border-t border-border px-4 py-3 sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runStartupChecks()}
                >
                  <RefreshCw className="size-3.5" />
                  Re-check
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
            </>
          )}
        </DialogContent>
      </Dialog>
    </ServiceErrorContext.Provider>
  )
}
