import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Lock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Public pages that skip the site passcode. */
const PUBLIC_PATHS = new Set(['/privacy', '/terms', '/support'])

const SITE_PASSCODE = '6565'
const UNLOCK_STORAGE_KEY = '9am-site-unlocked'

function isPublicPath(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/'
  return PUBLIC_PATHS.has(path)
}

function readUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeUnlocked() {
  try {
    sessionStorage.setItem(UNLOCK_STORAGE_KEY, '1')
  } catch {
    /* private mode */
  }
}

/**
 * Lightweight site gate. Blocks the whole app until passcode is entered,
 * except Privacy / Terms / Support which stay public.
 */
export function SitePasscodeGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const publicPage = useMemo(() => isPublicPath(location.pathname), [location.pathname])
  const [unlocked, setUnlocked] = useState(() => readUnlocked())
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  if (publicPage || unlocked) {
    return <>{children}</>
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (code.trim() === SITE_PASSCODE) {
      writeUnlocked()
      setUnlocked(true)
      setError('')
      return
    }
    setError('Incorrect passcode')
    setCode('')
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-border/70 bg-card p-6 shadow-sm"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="inline-flex size-11 items-center justify-center rounded-full bg-muted">
            <Lock className="size-5 text-muted-foreground" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">Enter passcode</h1>
          <p className="text-sm text-muted-foreground">
            This site is password protected.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="site-passcode">Passcode</Label>
          <Input
            id="site-passcode"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              if (error) setError('')
            }}
            placeholder="••••"
            className="text-center text-lg tracking-[0.35em]"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <Button type="submit" className="w-full">
          Unlock
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Privacy, Terms, and Support are public and do not need a passcode.
        </p>
      </form>
    </div>
  )
}
