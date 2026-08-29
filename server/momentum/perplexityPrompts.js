/**
 * Editable Perplexity prompt templates.
 *
 * Source of truth: Supabase `public.perplexity_prompts`.
 * Always pull from Supabase into the in-memory cache before use
 * (boot, API GET, research / bulletin). Disk (`data/perplexity-prompts.json`)
 * is a write-through mirror + offline fallback only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildMomentumResearchGeminiPromptTemplate,
} from '../notifications.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROMPT_STORE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'data',
  'perplexity-prompts.json',
)

/** @typedef {{ id: string, label: string, group: string, description: string, placeholders: string[] }} PromptMeta */

/** @type {PromptMeta[]} */
export const PERPLEXITY_PROMPT_CATALOG = [
  {
    id: 'momentum_research_equity',
    label: 'Momentum research · Equity',
    group: 'momentum_research',
    description:
      'Auto + manual Perplexity reason for stock momentum starts. Keep {{USER_MOVEMENT}} and {{INPUT_FACTS}}.',
    placeholders: ['{{USER_MOVEMENT}}', '{{INPUT_FACTS}}'],
  },
  {
    id: 'momentum_research_commodity',
    label: 'Momentum research · Commodity',
    group: 'momentum_research',
    description:
      'Perplexity reason template for gold, oil, silver, etc. Keep {{USER_MOVEMENT}} and {{INPUT_FACTS}}.',
    placeholders: ['{{USER_MOVEMENT}}', '{{INPUT_FACTS}}'],
  },
  {
    id: 'momentum_research_crypto',
    label: 'Momentum research · Crypto',
    group: 'momentum_research',
    description:
      'Perplexity reason template for BTC, ETH, and other crypto. Keep {{USER_MOVEMENT}} and {{INPUT_FACTS}}.',
    placeholders: ['{{USER_MOVEMENT}}', '{{INPUT_FACTS}}'],
  },
  {
    id: 'momentum_research_forex',
    label: 'Momentum research · Forex',
    group: 'momentum_research',
    description:
      'Perplexity reason template for FX pairs. Keep {{USER_MOVEMENT}} and {{INPUT_FACTS}}.',
    placeholders: ['{{USER_MOVEMENT}}', '{{INPUT_FACTS}}'],
  },
  {
    id: 'momentum_research_index',
    label: 'Momentum research · Index / ETF',
    group: 'momentum_research',
    description:
      'Perplexity reason template for indexes and ETFs. Keep {{USER_MOVEMENT}} and {{INPUT_FACTS}}.',
    placeholders: ['{{USER_MOVEMENT}}', '{{INPUT_FACTS}}'],
  },
  {
    id: 'momentum_reversal_override',
    label: 'Reversal research override',
    group: 'momentum_research',
    description:
      'Prepended when an episode reverses. Focuses Perplexity on the reversal catalyst.',
    placeholders: [],
  },
  {
    id: 'market_bulletin',
    label: 'Market open / close bulletin',
    group: 'market_bulletin',
    description:
      'Short 2–3 sentence push body for US / India market OPEN and CLOSE bulletins.',
    placeholders: [
      '{{SHORT_LABEL}}',
      '{{OPENED_OR_CLOSED}}',
      '{{SESSION_DATE}}',
      '{{TIMEZONE}}',
      '{{MARKET_ID}}',
      '{{SLOT}}',
      '{{YAHOO_PROBE}}',
      '{{YAHOO_MARKET_STATE}}',
      '{{YAHOO_LAST}}',
      '{{YAHOO_OPEN}}',
      '{{YAHOO_PREVIOUS_CLOSE}}',
      '{{YAHOO_DAY_CHANGE_PERCENT}}',
    ],
  },
]

const RESEARCH_ASSET_CLASS_TO_ID = {
  equity: 'momentum_research_equity',
  commodity: 'momentum_research_commodity',
  crypto: 'momentum_research_crypto',
  forex: 'momentum_research_forex',
  fx: 'momentum_research_forex',
  currency: 'momentum_research_forex',
  index: 'momentum_research_index',
  indices: 'momentum_research_index',
  etf: 'momentum_research_index',
}

/** @type {Map<string, string>} id → body (overrides only; missing = use default) */
const overrides = new Map()

export function normalizeResearchPromptAssetClass(raw) {
  const c = String(raw || 'equity')
    .trim()
    .toLowerCase()
  if (c === 'commodity' || c === 'commodities') return 'commodity'
  if (c === 'crypto' || c === 'cryptocurrency') return 'crypto'
  if (c === 'forex' || c === 'fx' || c === 'currency') return 'forex'
  if (c === 'index' || c === 'indices' || c === 'etf') return 'index'
  return 'equity'
}

export function defaultMomentumReversalOverride() {
  return [
    '═══ TASK OVERRIDE: REVERSAL RESEARCH ═══',
    'This is NOT a fresh momentum start. An existing directional episode just REVERSED.',
    'Focus your answer on: what likely caused the reverse (profit-taking, news flip, sector rotation, forced liquidations, technical break, etc.).',
    'Lead with “Likely driver:” for the REVERSAL catalyst specifically.',
  ].join('\n')
}

export function defaultMarketBulletinPromptTemplate() {
  return [
    'INSTRUCTIONS',
    'Write exactly 2 or 3 short sentences about how the {{SHORT_LABEL}} {{OPENED_OR_CLOSED}} on {{SESSION_DATE}} ({{TIMEZONE}}).',
    'Keep the whole answer under ~320 characters so it fits a phone notification.',
    'Sentence 1: direction (up / down / flat) and size, using the Yahoo day % below when available.',
    'Sentence 2: one likely reason or catalyst from web_search for that session (be concrete).',
    'Optional sentence 3: one notable index/sector note.',
    'No investment advice. No bullet lists. No markdown. British English.',
    'OUTPUT',
    'Return only the 2–3 sentences. No title line.',
    'INPUT',
    'market={{MARKET_ID}}',
    'slot={{SLOT}}',
    'session_date={{SESSION_DATE}}',
    'yahoo_probe={{YAHOO_PROBE}}',
    'yahoo_market_state={{YAHOO_MARKET_STATE}}',
    'yahoo_last={{YAHOO_LAST}}',
    'yahoo_open={{YAHOO_OPEN}}',
    'yahoo_previous_close={{YAHOO_PREVIOUS_CLOSE}}',
    'yahoo_day_change_percent={{YAHOO_DAY_CHANGE_PERCENT}}',
  ].join('\n')
}

const DEFAULT_RESEARCH_BY_ID = {
  momentum_research_equity: 'equity',
  momentum_research_commodity: 'commodity',
  momentum_research_crypto: 'crypto',
  momentum_research_forex: 'forex',
  momentum_research_index: 'index',
}

export function getDefaultPromptBody(id) {
  const key = String(id || '').trim()
  if (key === 'momentum_reversal_override') {
    return defaultMomentumReversalOverride()
  }
  if (key === 'market_bulletin') {
    return defaultMarketBulletinPromptTemplate()
  }
  const cls = DEFAULT_RESEARCH_BY_ID[key]
  if (cls) return buildMomentumResearchGeminiPromptTemplate(cls)
  return ''
}

export function getPromptBody(id) {
  const key = String(id || '').trim()
  if (!key) return ''
  const override = overrides.get(key)
  if (typeof override === 'string' && override.trim()) return override
  return getDefaultPromptBody(key)
}

export function isPromptOverridden(id) {
  const key = String(id || '').trim()
  const override = overrides.get(key)
  return typeof override === 'string' && override.trim().length > 0
}

/** Resolved momentum research template for an asset class. */
export function getMomentumResearchPromptTemplate(assetClass) {
  const cls = normalizeResearchPromptAssetClass(assetClass)
  const id = RESEARCH_ASSET_CLASS_TO_ID[cls] || RESEARCH_ASSET_CLASS_TO_ID.equity
  return getPromptBody(id)
}

export function getMomentumReversalOverride() {
  return getPromptBody('momentum_reversal_override')
}

export function getMarketBulletinPromptTemplate() {
  return getPromptBody('market_bulletin')
}

/**
 * Fill market bulletin template placeholders.
 * @param {string} template
 * @param {Record<string, string|number|null|undefined>} vars
 */
export function fillMarketBulletinPrompt(template, vars = {}) {
  let out = String(template || '')
  for (const [k, v] of Object.entries(vars)) {
    const token = k.startsWith('{{') ? k : `{{${k}}}`
    out = out.split(token).join(v == null ? '' : String(v))
  }
  return out
}

function catalogIds() {
  return new Set(PERPLEXITY_PROMPT_CATALOG.map((p) => p.id))
}

/** Snapshot for API / UI. */
export function listPerplexityPrompts() {
  return PERPLEXITY_PROMPT_CATALOG.map((meta) => {
    const body = getPromptBody(meta.id)
    const defaultBody = getDefaultPromptBody(meta.id)
    const overridden = isPromptOverridden(meta.id)
    return {
      ...meta,
      body,
      default_body: defaultBody,
      overridden,
      updated_at: null,
    }
  })
}

function writeDiskMirror() {
  /** @type {Record<string, string>} */
  const prompts = {}
  for (const [id, body] of overrides.entries()) {
    if (typeof body === 'string' && body.trim()) prompts[id] = body
  }
  try {
    fs.mkdirSync(path.dirname(PROMPT_STORE_PATH), { recursive: true })
    fs.writeFileSync(
      PROMPT_STORE_PATH,
      `${JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          prompts,
        },
        null,
        2,
      )}\n`,
    )
  } catch (err) {
    console.warn(
      '[momentum] could not persist perplexity prompts to disk:',
      err instanceof Error ? err.message : err,
    )
  }
}

function loadDiskMirror() {
  try {
    if (!fs.existsSync(PROMPT_STORE_PATH)) return false
    const raw = JSON.parse(fs.readFileSync(PROMPT_STORE_PATH, 'utf8'))
    const map =
      raw && typeof raw === 'object' && raw.prompts && typeof raw.prompts === 'object'
        ? raw.prompts
        : raw
    if (!map || typeof map !== 'object') return false
    const allowed = catalogIds()
    let n = 0
    for (const [id, body] of Object.entries(map)) {
      if (!allowed.has(id)) continue
      if (typeof body === 'string' && body.trim()) {
        overrides.set(id, body)
        n += 1
      }
    }
    return n > 0
  } catch (err) {
    console.warn(
      '[momentum] could not load perplexity prompts from disk:',
      err instanceof Error ? err.message : err,
    )
    return false
  }
}

/** @type {import('@supabase/supabase-js').SupabaseClient|null|undefined} */
let supabaseCached

/** Last successful Supabase → memory hydrate (ms). */
let lastSupabaseHydratedAt = 0
/** @type {Promise<{ ok: boolean, source: string, prompts: ReturnType<typeof listPerplexityPrompts> }>|null} */
let hydrateInFlight = null

async function getSupabase() {
  if (supabaseCached !== undefined) return supabaseCached
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    supabaseCached = null
    return null
  }
  try {
    const { createClient } = await import('@supabase/supabase-js')
    supabaseCached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return supabaseCached
  } catch {
    supabaseCached = null
    return null
  }
}

export async function savePerplexityPromptsToSupabase(promptMap) {
  const supabase = await getSupabase()
  if (!supabase) return { ok: false, error: 'Supabase not configured' }
  const allowed = catalogIds()
  const rows = []
  const now = new Date().toISOString()
  for (const [id, body] of Object.entries(promptMap || {})) {
    if (!allowed.has(id)) continue
    const meta = PERPLEXITY_PROMPT_CATALOG.find((p) => p.id === id)
    const trimmed = typeof body === 'string' ? body.trim() : ''
    rows.push({
      id,
      label: meta?.label || id,
      body: trimmed,
      updated_at: now,
    })
  }
  if (!rows.length) return { ok: true, saved: 0 }
  const { error } = await supabase.from('perplexity_prompts').upsert(rows, {
    onConflict: 'id',
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, saved: rows.length }
}

export async function loadPerplexityPromptsFromSupabase() {
  const supabase = await getSupabase()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('perplexity_prompts')
    .select('id, body, updated_at, label')
  if (error) {
    console.warn('[momentum] perplexity_prompts load failed:', error.message)
    return null
  }
  /** @type {Record<string, string>} */
  const map = {}
  for (const row of data || []) {
    const id = String(row?.id || '').trim()
    const body = typeof row?.body === 'string' ? row.body : ''
    if (!id) continue
    if (body.trim()) map[id] = body
  }
  return map
}

/**
 * Apply overrides in memory (+ disk). Pass empty string / null to clear an id
 * back to the built-in default.
 * @param {Record<string, string|null|undefined>} promptMap
 */
export function applyPerplexityPromptOverrides(promptMap) {
  const allowed = catalogIds()
  let changed = 0
  for (const [id, body] of Object.entries(promptMap || {})) {
    if (!allowed.has(id)) continue
    const trimmed = typeof body === 'string' ? body.trim() : ''
    if (!trimmed) {
      if (overrides.has(id)) {
        overrides.delete(id)
        changed += 1
      }
      continue
    }
    if (overrides.get(id) !== trimmed) {
      overrides.set(id, trimmed)
      changed += 1
    }
  }
  writeDiskMirror()
  return { changed, prompts: listPerplexityPrompts() }
}

/**
 * Persist prompts: Supabase (source of truth) → memory → disk mirror.
 * @param {Record<string, string|null|undefined>} promptMap
 */
export async function persistPerplexityPrompts(promptMap) {
  /** @type {Record<string, string>} */
  const toSave = {}
  const allowed = catalogIds()
  for (const id of allowed) {
    if (Object.prototype.hasOwnProperty.call(promptMap || {}, id)) {
      const raw = promptMap[id]
      toSave[id] = typeof raw === 'string' && raw.trim() ? raw.trim() : ''
    } else if (overrides.has(id)) {
      toSave[id] = overrides.get(id) || ''
    }
  }

  const sb = await savePerplexityPromptsToSupabase(toSave)
  // Always update memory + disk so local process matches what we intended.
  const applied = applyPerplexityPromptOverrides(promptMap)
  if (sb?.ok) {
    lastSupabaseHydratedAt = Date.now()
  }
  return {
    ok: true,
    ...applied,
    supabase: sb,
  }
}

/**
 * Pull prompts from Supabase into the in-memory cache.
 * On Supabase failure: keep existing memory, or load disk mirror if memory empty.
 */
export async function hydratePerplexityPromptsFromSupabase() {
  const result = await ensurePerplexityPromptsFromSupabase({ force: true })
  return result.prompts
}

/**
 * Ensure memory cache is filled from Supabase.
 * @param {{ force?: boolean, maxAgeMs?: number }} [options]
 *   force — always re-pull from Supabase
 *   maxAgeMs — skip re-pull if last successful hydrate is fresher (default 30s)
 */
export async function ensurePerplexityPromptsFromSupabase(options = {}) {
  const force = options.force === true
  const maxAgeMs =
    options.maxAgeMs == null ? 30_000 : Math.max(0, Number(options.maxAgeMs) || 0)

  if (
    !force &&
    lastSupabaseHydratedAt > 0 &&
    Date.now() - lastSupabaseHydratedAt < maxAgeMs
  ) {
    return {
      ok: true,
      source: 'memory',
      prompts: listPerplexityPrompts(),
    }
  }

  if (hydrateInFlight) return hydrateInFlight

  hydrateInFlight = (async () => {
    try {
      const map = await loadPerplexityPromptsFromSupabase()
      if (map && typeof map === 'object') {
        overrides.clear()
        const allowed = catalogIds()
        for (const [id, body] of Object.entries(map)) {
          if (!allowed.has(id)) continue
          if (typeof body === 'string' && body.trim()) {
            overrides.set(id, body)
          }
        }
        lastSupabaseHydratedAt = Date.now()
        writeDiskMirror()
        console.log(
          `[momentum] perplexity prompts pulled from Supabase → memory · ${overrides.size} override(s)`,
        )
        return {
          ok: true,
          source: 'supabase',
          prompts: listPerplexityPrompts(),
        }
      }

      // Supabase unavailable / misconfigured — disk fallback only if cache empty.
      if (overrides.size === 0) {
        const loaded = loadDiskMirror()
        if (loaded) {
          console.warn(
            '[momentum] perplexity prompts: Supabase miss — loaded disk mirror into memory',
          )
          return {
            ok: false,
            source: 'disk',
            prompts: listPerplexityPrompts(),
          }
        }
      }
      console.warn(
        '[momentum] perplexity prompts: Supabase miss — using memory/defaults',
      )
      return {
        ok: false,
        source: overrides.size ? 'memory' : 'defaults',
        prompts: listPerplexityPrompts(),
      }
    } catch (err) {
      console.warn(
        '[momentum] supabase perplexity-prompts pull failed:',
        err instanceof Error ? err.message : err,
      )
      if (overrides.size === 0) loadDiskMirror()
      return {
        ok: false,
        source: overrides.size ? 'memory-or-disk' : 'defaults',
        prompts: listPerplexityPrompts(),
      }
    } finally {
      hydrateInFlight = null
    }
  })()

  return hydrateInFlight
}
