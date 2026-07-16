// Per-request "what actually happened" trace, so the frontend can show the
// exact backend sequence (each SEC/local-file call, in order) next to the
// raw JSON response instead of leaving that as a black box.
import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage()

export function withSteps(fn) {
  return storage.run({ steps: [], startedAt: Date.now() }, fn)
}

export function step(message) {
  const ctx = storage.getStore()
  if (!ctx) return
  ctx.steps.push(`[+${Date.now() - ctx.startedAt}ms] ${message}`)
}

export function getSteps() {
  const ctx = storage.getStore()
  return ctx ? ctx.steps : []
}
