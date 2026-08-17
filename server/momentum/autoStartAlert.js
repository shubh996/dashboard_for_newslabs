/**
 * Auto Perplexity pipeline — ONLY these two moments:
 *   1) MOMENTUM_STARTED (not AFTER_REVERSAL silent leg)
 *   2) MOMENTUM_REVERSED — why the reverse happened (different prompt)
 *
 * Nowhere else (Holding / Accel / Strong giveback / etc.) runs Perplexity.
 *
 * Flow: research RUNNING → DONE → Expo push → ALERT_SENT timeline row.
 * Disable: MOMENTUM_AUTO_START_RESEARCH=0
 */
import { createClient } from '@supabase/supabase-js'
import {
  insertEvents,
  deleteResearchRunningEvents,
  persistTick,
} from './persist.js'
import { classifyAsset } from '../tradingEconomics.js'
import {
  buildMomentumResearchGeminiPromptTemplate,
  buildMomentumUserMovementLine,
  buildMomentumInputFacts,
  fillMomentumResearchPrompt,
  callPerplexityResearch,
  extractLikelyDriver,
  structuredReasonHasLikelyDriver,
  sanitizeGeminiSessionHeadline,
  geminiMaxOutputTokens,
  recordPerplexityUsageLedger,
  saveMomentumResearchRow,
  sendTriggerEpisodePush,
} from '../notifications.js'
import {
  MOMENTUM_AUTO_START_RESEARCH,
  START_PUSH_MAX_AGE_MS,
  getEpisodePolicyForClass,
  isMomentumDummyResearchMode,
} from './config.js'
import { classifyMomentumAsset } from './candles.js'
import { calendarAllowsHeavyWork } from './engineGate.js'
import {
  buildMomentumAlertTitle,
  buildNotificationCopy,
  formatDashesToCommas,
  sanitizeStockHeadlineInSummary,
} from './notifyCopy.js'
import * as store from './store.js'

/** key → in-flight or completed auto pipeline (start or reverse) */
const processedStarts = new Map()

function persistTimelineEvents(ticker, events) {
  const list = (events || []).filter(Boolean)
  if (!list.length) return
  void insertEvents(ticker, list)
    .then((rows) => {
      if (rows?.length) store.markEventsPersisted(ticker, rows)
    })
    .catch(() => {
      /* persist is best-effort */
    })
}

function getSupabaseOrNull() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  } catch {
    return null
  }
}

function normTicker(t) {
  return store.normalizeMomentumTicker(t) || String(t || '').trim().toUpperCase()
}

function fmtMove(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return ''
  const n = Number(pct)
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

function preferredTimePhraseFor(windowKey, marketSession, exactLabel, windowLabel) {
  const sess = String(marketSession || '').toUpperCase()
  if (windowKey === 'day') {
    if (sess === 'PRE') return 'in pre-market trading'
    if (sess === 'PREPRE') return 'overnight'
    if (sess === 'POST' || sess === 'POSTPOST') return 'in after-hours trading'
    if (sess === 'CLOSED') return 'at the close'
    return 'so far in regular trading'
  }
  if (exactLabel) return `in the last ${exactLabel}`
  if (windowLabel) return `over the last ${windowLabel}`
  return `over the last ${windowKey || 'session'}`
}

/**
 * Run Perplexity for a start move. Returns push copy + research payload.
 * @param {Record<string, unknown>} input
 */
export async function researchStartMove(input) {
  const ticker = normTicker(input.ticker)
  const companyName = String(input.companyName || input.company_name || '').trim()
  const windowKey = String(input.windowKey || input.window_key || 'day').trim() || 'day'
  const windowLabel = String(input.windowLabel || input.window_label || windowKey).trim()
  const exactLabel = String(input.exactLabel || input.exact_label || '').trim()
  const exactMinutes = Number(input.exactMinutes ?? input.exact_minutes)
  const movePercent = Number(input.movePercent ?? input.move_percent)
  const moveText = Number.isFinite(movePercent) ? fmtMove(movePercent) : ''
  const livePrice = input.livePrice ?? input.live_price ?? null
  const referencePrice = input.referencePrice ?? input.reference_price ?? null
  const referenceTime = input.referenceTime || input.reference_time || null
  const marketSession = String(input.marketSession || input.market_session || '').trim()
  const assetClassIn = String(input.assetClass || input.asset_class || '').trim()
  const classification = classifyAsset(ticker, companyName)
  const cls = String(
    assetClassIn ||
      classification.asset_class ||
      classification.scrape_source ||
      'equity',
  ).toLowerCase()

  const preferredTimePhrase = preferredTimePhraseFor(
    windowKey,
    marketSession,
    exactLabel,
    windowLabel,
  )

  const researchMode =
    String(input.researchMode || input.mode || 'start').toLowerCase() ===
    'reversal'
      ? 'reversal'
      : 'start'
  const priorDirection = String(
    input.priorDirection || input.prior_direction || '',
  ).toUpperCase()
  const dir =
    Number.isFinite(movePercent) && movePercent < 0
      ? 'DOWN'
      : String(input.direction || '').toUpperCase() === 'DOWN'
        ? 'DOWN'
        : 'UP'

  let userMovement = buildMomentumUserMovementLine({
    ticker,
    companyName,
    moveText,
    preferredTimePhrase,
    exactLabel,
    windowLabel,
    windowKey,
  })
  if (researchMode === 'reversal') {
    const from = priorDirection === 'DOWN' ? 'DOWN' : priorDirection === 'UP' ? 'UP' : 'the prior'
    const to = dir === 'DOWN' ? 'DOWN' : 'UP'
    userMovement = [
      `${companyName || ticker} (${ticker}) REVERSED: the earlier ${from} momentum episode was erased and the market flipped ${to}.`,
      moveText
        ? `Live move vs episode reference is now ${moveText} ${preferredTimePhrase}.`
        : `Reversal detected ${preferredTimePhrase}.`,
      'Explain the most likely catalyst for THIS REVERSAL (why the prior move failed / what flipped direction) — not a generic session summary.',
    ].join(' ')
  }

  const inputFacts = buildMomentumInputFacts({
    ticker,
    companyName,
    assetClass: cls,
    moveText,
    preferredTimePhrase,
    exactLabel,
    exactMinutes: Number.isFinite(exactMinutes) ? exactMinutes : null,
    windowLabel,
    windowKey,
    livePrice,
    referencePrice,
    referenceTime,
    marketSession,
  })

  const promptTemplate = buildMomentumResearchGeminiPromptTemplate(cls)
  let fullPrompt = fillMomentumResearchPrompt(
    promptTemplate,
    userMovement,
    inputFacts,
  )
  if (researchMode === 'reversal') {
    fullPrompt = [
      '═══ TASK OVERRIDE: REVERSAL RESEARCH ═══',
      'This is NOT a fresh momentum start. An existing directional episode just REVERSED.',
      'Focus your answer on: what likely caused the reverse (profit-taking, news flip, sector rotation, forced liquidations, technical break, etc.).',
      'Lead with “Likely driver:” for the REVERSAL catalyst specifically.',
      '',
      fullPrompt,
    ].join('\n')
  }

  // Testing / push-allowlist mode: skip Perplexity API, keep timeline + alert flow
  if (isMomentumDummyResearchMode()) {
    const name = companyName || ticker
    // Detection-time span only (exactMinutes frozen at STARTED) — never Date.now()
    // direction on REVERSED event = the OLD episode leg that was erased
    const pushTitle =
      researchMode === 'reversal'
        ? dir === 'UP'
          ? `🔴 ${ticker} reverses lower`
          : `🟢 ${ticker} rebounds sharply`
        : buildMomentumAlertTitle({
            ticker,
            direction: dir,
            movePercent: Number.isFinite(movePercent) ? movePercent : null,
            exactMinutes: Number.isFinite(exactMinutes) ? exactMinutes : null,
            exactLabel: exactLabel || null,
            windowKey,
            referenceTime,
            marketSession,
          })
    const dummyDriver = formatDashesToCommas(
      researchMode === 'reversal'
        ? dir === 'UP'
          ? `Simulated profit-taking / negative catalyst for ${name} after the prior surge reversed.`
          : `Simulated short-covering / bounce catalyst for ${name} after the prior decline reversed.`
        : Number.isFinite(movePercent) && movePercent < 0
          ? `Simulated pressure on ${name} after a sharp session move.`
          : `Simulated buying interest in ${name} after a sharp session move.`,
    )
    const dummyReason = [
      researchMode === 'reversal'
        ? `${name} reversed ${preferredTimePhrase}.`
        : `${name} ${moveText || 'moved'} ${preferredTimePhrase}.`,
      '',
      `Likely driver: ${dummyDriver}`,
      '',
      'Secondary driver: No clear secondary driver identified.',
      '',
      researchMode === 'reversal'
        ? 'Move classification: reverse catalyst research (dummy).'
        : 'Move classification: 60% company-specific, 40% sector/market/macro-related.',
      '',
      'Confidence: Low — dummy data for push allowlist testing.',
    ].join('\n')

    // Brief pause so the UI can poll the "Perplexity running" row
    await new Promise((r) => setTimeout(r, 900))

    return {
      ok: true,
      dummy: true,
      ticker,
      company_name: companyName || null,
      asset_class: cls,
      window_key: windowKey,
      window_label: windowLabel,
      exact_label: exactLabel || null,
      move_percent: Number.isFinite(movePercent) ? movePercent : null,
      user_movement: userMovement,
      reason: formatDashesToCommas(dummyReason),
      likely_driver: dummyDriver,
      push_title: pushTitle,
      push_body: dummyDriver,
      model: 'dummy-test',
      model_version: 'dummy-test',
      request_id: `dummy-${Date.now()}`,
      provider: 'dummy',
      citations: [],
      search_results: [],
      cost_usd_display: '$0.000000',
      structure_retried: false,
      supabase_save: { ok: false, skipped: true, reason: 'dummy research' },
    }
  }

  const apiKey = String(process.env.PERPLEXITY_API_KEY || '').trim()
  if (!apiKey) {
    return {
      ok: false,
      error:
        'PERPLEXITY_API_KEY missing — cannot auto-research start reason',
      user_movement: userMovement,
      asset_class: cls,
    }
  }

  const preferredModel =
    String(process.env.PERPLEXITY_MODEL || '').trim() ||
    'perplexity/deepseek-v4-flash-0731'
  const maxOutputTokens = geminiMaxOutputTokens()

  let result
  let structureRetried = false
  try {
    result = await callPerplexityResearch({
      apiKey,
      model: preferredModel,
      prompt: fullPrompt,
      maxTokens: maxOutputTokens,
    })
    if (!structuredReasonHasLikelyDriver(result.summary)) {
      structureRetried = true
      const retryPrompt = [
        fullPrompt,
        '',
        'CRITICAL REVISION:',
        'Your previous answer did not include a valid structured reason.',
        'You MUST output the exact format with these labels on their own lines:',
        'Likely driver: …',
        'Secondary driver: …',
        'Move classification: …',
        'Confidence: …',
        'Do not omit "Likely driver:".',
      ].join('\n')
      try {
        result = await callPerplexityResearch({
          apiKey,
          model: preferredModel,
          prompt: retryPrompt,
          maxTokens: maxOutputTokens,
        })
      } catch {
        /* keep first result */
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      user_movement: userMovement,
      asset_class: cls,
    }
  }

  const sess = marketSession.toUpperCase()
  let summary = sanitizeGeminiSessionHeadline(result.summary, {
    preferred_time_phrase: preferredTimePhrase,
    allow_todays_session: windowKey === 'day' && sess === 'CLOSED',
    phase:
      sess === 'PRE'
        ? 'pre_market'
        : sess === 'PREPRE'
          ? 'overnight'
          : sess === 'POST' || sess === 'POSTPOST'
            ? 'after_hours'
            : sess === 'CLOSED'
              ? 'regular_closed'
              : 'regular_hours_open',
  })
  summary = sanitizeStockHeadlineInSummary(
    summary,
    ticker,
    companyName,
    cls,
  )

  if (!summary?.trim()) {
    return {
      ok: false,
      error: 'Perplexity returned an empty reason',
      user_movement: userMovement,
      asset_class: cls,
    }
  }

  // Robust extract (handles **Likely driver:** and mid-line after [TICKER] header)
  const likelyDriver = formatDashesToCommas(extractLikelyDriver(summary))
  const summaryFormatted = formatDashesToCommas(summary)

  // Title: start = emoji + % + trading-hours lookback; reverse = reverse headline
  // Body:  ONLY likely driver
  // REVERSED event.direction = old leg (UP erased → market lower)
  const pushTitle =
    researchMode === 'reversal'
      ? dir === 'UP'
        ? `🔴 ${ticker} reverses lower`
        : `🟢 ${ticker} rebounds sharply`
      : buildMomentumAlertTitle({
          ticker,
          companyName,
          direction: dir,
          movePercent: Number.isFinite(movePercent) ? movePercent : null,
          exactMinutes: Number.isFinite(exactMinutes) ? exactMinutes : null,
          exactLabel: exactLabel || null,
          windowKey,
          referenceTime,
          nowIso: new Date().toISOString(),
          marketSession,
        })
  // Strict: body is ONLY the likely driver text (no move restatement)
  const pushBody = likelyDriver || ''

  // Best-effort Supabase save + usage ledger
  const supabase = getSupabaseOrNull()
  let saveResult = null
  try {
    if (supabase) {
      saveResult = await saveMomentumResearchRow(supabase, {
        ticker,
        company_name: companyName || null,
        asset_class: cls,
        window_key: windowKey,
        window_label: windowLabel,
        exact_label: exactLabel || null,
        exact_minutes: Number.isFinite(exactMinutes) ? exactMinutes : null,
        move_percent: Number.isFinite(movePercent) ? movePercent : null,
        user_movement: userMovement,
        market_session: marketSession || null,
        live_price: livePrice,
        reference_price: referencePrice,
        reference_time: referenceTime,
        likely_driver: likelyDriver || null,
        reason: summaryFormatted || summary,
        push_title: pushTitle,
        push_body: pushBody,
        model: result.model,
        model_version: result.modelVersion,
        request_id: result.requestId,
        provider: 'perplexity',
        citations: result.citations || [],
        search_results: result.search_results || [],
        tools: result.tools || [],
        tokens: {
          prompt: result.usageRaw?.prompt_tokens ?? null,
          completion: result.usageRaw?.completion_tokens ?? null,
          total: result.usageRaw?.total_tokens ?? null,
        },
        cost: result.cost,
        cost_usd_display: result.cost_usd_display,
        prompt: fullPrompt,
        input_facts: inputFacts,
      })
      void recordPerplexityUsageLedger(supabase, {
        ticker,
        credits_used: Number(result.usageRaw?.total_tokens) || 0,
        total_tokens: Number(result.usageRaw?.total_tokens) || 0,
        prompt_tokens: Number(result.usageRaw?.prompt_tokens) || 0,
        completion_tokens: Number(result.usageRaw?.completion_tokens) || 0,
        cost_usd: Number(result.cost?.total_cost) || 0,
        meta: {
          model: result.model,
          request_id: result.requestId,
          window_key: windowKey,
          asset_class: cls,
          structure_retried: structureRetried,
          source: 'auto_start',
        },
      })
    }
  } catch {
    /* non-fatal */
  }

  return {
    ok: true,
    ticker,
    company_name: companyName || null,
    asset_class: cls,
    window_key: windowKey,
    window_label: windowLabel,
    exact_label: exactLabel || null,
    move_percent: Number.isFinite(movePercent) ? movePercent : null,
    user_movement: userMovement,
    reason: summaryFormatted || summary,
    likely_driver: likelyDriver || null,
    push_title: pushTitle,
    push_body: pushBody,
    model: result.model,
    model_version: result.modelVersion,
    request_id: result.requestId,
    provider: 'perplexity',
    citations: result.citations || [],
    search_results: result.search_results || [],
    cost_usd_display: result.cost_usd_display || null,
    structure_retried: structureRetried,
    supabase_save: saveResult,
  }
}

/**
 * After a tick: Perplexity only for STARTED or REVERSED events.
 *
 * @param {{
 *   ticker: string,
 *   events: Array<Record<string, unknown>>,
 *   episode: Record<string, unknown>|null,
 *   snapshot?: Record<string, unknown>|null,
 *   meta?: { shortName?: string|null, longName?: string|null }|null,
 * }} opts
 */
export async function handleAutoStartResearchAlerts(opts) {
  if (!MOMENTUM_AUTO_START_RESEARCH) return { ok: true, skipped: true, reason: 'disabled' }

  const ticker = normTicker(opts.ticker)
  const episode = opts.episode || null
  const snapshot = opts.snapshot || null
  const meta = opts.meta || null
  const events = Array.isArray(opts.events) ? opts.events : []

  /** @type {Array<{ ev: Record<string, unknown>, mode: 'start'|'reversal' }>} */
  const jobs = []
  for (const ev of events) {
    const type = String(ev?.eventType || '')
    if (type === 'MOMENTUM_REVERSED') {
      jobs.push({ ev, mode: 'reversal' })
      continue
    }
    if (type === 'MOMENTUM_STARTED' || type.endsWith('_STARTED')) {
      // Silent opposite-leg start after reverse — no second research/push
      if (String(ev?.reason || '').toUpperCase() === 'AFTER_REVERSAL') continue
      jobs.push({ ev, mode: 'start' })
    }
  }

  if (!jobs.length) return { ok: true, skipped: true, reason: 'no_start_or_reversal' }

  const results = []
  for (const { ev: startEv, mode: researchMode } of jobs) {
    const episodeId =
      startEv.episodeId ||
      episode?.episodeId ||
      episode?.episode_id ||
      `${ticker}-${startEv.detectedAt || ''}`
    const jobKey = `${researchMode}:${episodeId}:${startEv.detectedAt || ''}`

    if (processedStarts.has(jobKey)) {
      results.push({ episodeId, skipped: true, reason: 'already_processed', mode: researchMode })
      continue
    }
    processedStarts.set(jobKey, { at: Date.now(), status: 'running', mode: researchMode })

    // Cap map size
    if (processedStarts.size > 200) {
      const first = processedStarts.keys().next().value
      processedStarts.delete(first)
    }

    const dummyMode = isMomentumDummyResearchMode()
    store.pushLog(
      ticker,
      'info',
      dummyMode
        ? `Auto-${researchMode} pipeline · DUMMY research for ${startEv.direction || episode?.direction || '?'}…`
        : `Auto-${researchMode} pipeline · Perplexity research for ${startEv.direction || episode?.direction || '?'}…`,
      'research',
    )

    // ── Frozen trigger identity (immutable for this research job) ──
    // Research explains THIS trigger event — never regenerate from live market.
    const frozenTrigger = {
      episodeId: String(episodeId),
      triggerTimestamp: String(
        startEv.detectedAt ||
          episode?.triggerTime ||
          episode?.episodeStartedAt ||
          '',
      ),
      triggerMovePct: Number(
        startEv.movePercent ??
          startEv.initialMovePercent ??
          startEv.triggerMovePct ??
          episode?.triggerMovePct ??
          episode?.initialMovePercent ??
          0,
      ),
      triggerPrice: Number(
        startEv.price ??
          startEv.triggerPrice ??
          episode?.triggerPrice ??
          episode?.episodeStartPrice ??
          NaN,
      ),
      detectedWindow: String(
        startEv.detectedWindow || episode?.detectedWindow || 'day',
      ),
      direction: String(startEv.direction || episode?.direction || 'UP'),
      referencePrice: Number(
        startEv.referencePrice ?? episode?.referencePrice ?? NaN,
      ),
      referenceTime: String(
        startEv.referenceTime || episode?.referenceTime || '',
      ),
      exactMinutes: Number(
        startEv.exactMinutes ?? episode?.exactMinutes ?? NaN,
      ),
      exactLabel: startEv.exactLabel || episode?.exactLabel || null,
    }

    const windowKey = frozenTrigger.detectedWindow
    const exactMinutesFrozen = frozenTrigger.exactMinutes
    const exactLabelFrozen = frozenTrigger.exactLabel
    const exact = Number.isFinite(exactMinutesFrozen)
      ? {
          exactMinutes: exactMinutesFrozen,
          exactLabel: exactLabelFrozen,
          referenceTime: frozenTrigger.referenceTime || null,
        }
      : snapshot?.exactLookbacks?.[windowKey] ||
        snapshot?.exactLookbacks?.[String(windowKey)] ||
        null
    const companyName =
      meta?.longName ||
      meta?.shortName ||
      episode?.companyName ||
      null

    const direction = frozenTrigger.direction
    // Immutable trigger move from STARTED event (not live currentMove after hours)
    const movePercent = Number.isFinite(frozenTrigger.triggerMovePct)
      ? frozenTrigger.triggerMovePct
      : 0
    const price = Number.isFinite(frozenTrigger.triggerPrice)
      ? frozenTrigger.triggerPrice
      : null
    const researchStartedAt = new Date().toISOString()

    // Live timeline row — UI blinks while status=running, then becomes "done"
    const runningEv = store.pushEvent(ticker, {
      ticker,
      direction,
      eventType: 'MOMENTUM_RESEARCH_RUNNING',
      price,
      movePercent,
      detectedWindow: windowKey,
      detectedAt: researchStartedAt,
      marketSession: startEv.marketSession || snapshot?.marketSession || null,
      reason: researchMode === 'reversal' ? 'REVERSAL_RUNNING' : 'RUNNING',
      shouldNotify: false,
      notification: null,
      episodeId,
      research: {
        status: 'running',
        mode: researchMode,
        provider: dummyMode ? 'dummy' : 'perplexity',
        startedAt: researchStartedAt,
        reason: dummyMode
          ? 'Dummy research (no API call)…'
          : researchMode === 'reversal'
            ? 'Researching why the move reversed…'
            : 'Researching likely driver…',
      },
    })
    persistTimelineEvents(ticker, [runningEv])

    let research
    try {
      research = await researchStartMove({
        ticker,
        companyName,
        windowKey,
        windowLabel: windowKey,
        exactLabel: exactLabelFrozen || exact?.exactLabel || null,
        exactMinutes: Number.isFinite(exactMinutesFrozen)
          ? exactMinutesFrozen
          : exact?.exactMinutes ?? null,
        movePercent,
        livePrice: price,
        referencePrice:
          startEv.referencePrice ??
          episode?.referencePrice ??
          exact?.referencePrice ??
          null,
        referenceTime:
          startEv.referenceTime ??
          episode?.referenceTime ??
          exact?.referenceTime ??
          null,
        marketSession:
          startEv.marketSession ||
          snapshot?.marketSession ||
          episode?.marketSession,
        assetClass: snapshot?.assetClass || 'equity',
        direction,
        researchMode,
        // Closed episode direction before reverse (payload may still hold it)
        priorDirection:
          researchMode === 'reversal'
            ? startEv.direction || episode?.direction || null
            : null,
      })
    } catch (err) {
      research = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }

    const researchAt = new Date().toISOString()

    // Flip running → done/error. Keep startedAt on the row; always remove any
    // leftover RESEARCH_RUNNING so the rail cannot show dual "running" + "done".
    const researchPayload = research.ok
      ? {
          status: 'done',
          reason: research.reason,
          likely_driver: research.likely_driver,
          provider: research.provider || (dummyMode ? 'dummy' : 'perplexity'),
          model: research.model_version || research.model,
          citations: research.citations || [],
          search_results: research.search_results || [],
          cost_usd_display: research.cost_usd_display,
          startedAt: researchStartedAt,
          completedAt: researchAt,
        }
      : {
          status: 'error',
          reason: research.error || 'Research failed',
          likely_driver: null,
          provider: research.provider || (dummyMode ? 'dummy' : 'perplexity'),
          startedAt: researchStartedAt,
          completedAt: researchAt,
          error: true,
        }
    const researchPatch = {
      eventType: 'MOMENTUM_RESEARCH_DONE',
      detectedAt: researchAt,
      reason: research.ok
        ? research.reason
        : `Research failed: ${research.error || 'unknown'}`,
      likely_driver: research.ok ? research.likely_driver : null,
      research: researchPayload,
    }

    // Prefer in-place upgrade of the running row (same object identity for UI).
    let researchEv = store.updateEvent(
      ticker,
      (e) =>
        String(e?.eventType) === 'MOMENTUM_RESEARCH_RUNNING' &&
        (!episodeId || String(e?.episodeId || '') === String(episodeId)),
      researchPatch,
    )
    // Drop any other RUNNING rows for this episode (or ticker if no episodeId).
    store.removeEvents(
      ticker,
      (e) =>
        String(e?.eventType) === 'MOMENTUM_RESEARCH_RUNNING' &&
        (!episodeId || String(e?.episodeId || '') === String(episodeId)),
    )
    if (!researchEv) {
      researchEv = store.pushEvent(ticker, {
        ticker,
        direction,
        price,
        movePercent,
        detectedWindow: windowKey,
        marketSession: startEv.marketSession || snapshot?.marketSession || null,
        shouldNotify: false,
        notification: null,
        episodeId,
        ...researchPatch,
      })
    }
    // Persist DONE and hard-delete RUNNING rows (different unique key in Supabase).
    persistTimelineEvents(ticker, [researchEv])
    void deleteResearchRunningEvents(ticker, episodeId)
    store.pushLog(
      ticker,
      research.ok ? 'success' : 'error',
      research.ok
        ? `Perplexity done · ${String(research.likely_driver || research.reason || '').slice(0, 100)}`
        : `Perplexity failed · ${research.error || 'unknown'}`,
      'research',
      researchEv,
    )

    // ── Gate: do not push if episode is no longer the live ACTIVE one ──
    // Covers: expire mid-research, or #001 research finishing after #002 started.
    // MUST match frozenTrigger.episodeId — never push against a newer episode.
    const liveNow = store.getActiveEpisode(ticker)
    const liveId = liveNow
      ? String(liveNow.episodeId || liveNow.episode_id || '')
      : ''
    const wantId = String(frozenTrigger.episodeId || episodeId || '')
    const liveStatus = String(liveNow?.status || '').toUpperCase()
    const startStillLive =
      researchMode === 'reversal'
        ? true // reverse push is about the closed leg; still allow if job was reverse
        : Boolean(
            liveNow &&
              liveStatus === 'ACTIVE' &&
              wantId &&
              liveId === wantId,
          )
    if (researchMode === 'start' && !startStillLive) {
      store.pushLog(
        ticker,
        'warn',
        `Auto-start push skipped — frozen episodeId ${wantId || '?'} ≠ live ${liveId || 'none'} (status=${liveStatus || 'none'})`,
        'notify',
        {
          frozenTrigger,
          liveId,
          liveStatus,
        },
      )
      processedStarts.set(jobKey, {
        at: Date.now(),
        status: 'skipped_terminal',
        mode: researchMode,
      })
      // Still may attach research DONE to history for the old episodeId only
      results.push({
        episodeId: wantId,
        skipped: true,
        reason: 'episode_not_active',
        mode: researchMode,
        frozenTrigger,
      })
      continue
    }

    // ── Gate: START push TTL — research may finish late; push must not ──
    // same episodeId + ACTIVE + (now − triggerTimestamp) ≤ START_PUSH_MAX_AGE
    // Max age is per asset class (stocks can differ from commodities).
    if (researchMode === 'start') {
      const assetCls =
        liveNow?.assetClass ||
        liveNow?.asset_class ||
        classifyMomentumAsset(ticker) ||
        'equity'
      const startPushMaxAgeMs =
        getEpisodePolicyForClass(assetCls).startPushMaxAgeMs ??
        START_PUSH_MAX_AGE_MS
      const triggerMs = Date.parse(String(frozenTrigger.triggerTimestamp || ''))
      const ageMs = Number.isFinite(triggerMs)
        ? Date.now() - triggerMs
        : Number.POSITIVE_INFINITY
      if (!Number.isFinite(triggerMs) || ageMs > startPushMaxAgeMs) {
        const ageMin = Number.isFinite(ageMs)
          ? (ageMs / 60_000).toFixed(1)
          : '?'
        store.pushLog(
          ticker,
          'warn',
          `Auto-start push skipped — trigger age ${ageMin}m > max ${(startPushMaxAgeMs / 60_000).toFixed(1)}m (research saved, push suppressed)`,
          'notify',
          {
            frozenTrigger,
            ageMs: Number.isFinite(ageMs) ? ageMs : null,
            maxAgeMs: startPushMaxAgeMs,
            assetClass: assetCls,
          },
        )
        processedStarts.set(jobKey, {
          at: Date.now(),
          status: 'skipped_stale',
          mode: researchMode,
        })
        results.push({
          episodeId: wantId,
          skipped: true,
          reason: 'start_push_stale',
          mode: researchMode,
          ageMs: Number.isFinite(ageMs) ? ageMs : null,
          maxAgeMs: startPushMaxAgeMs,
          frozenTrigger,
        })
        continue
      }
    }

    // Push idempotency: episodeId + eventType + cycle (START cycle = 0)
    const pushIdemKey =
      researchMode === 'reversal'
        ? `${wantId || episodeId}:MOMENTUM_REVERSED:0`
        : `${wantId || episodeId}:MOMENTUM_STARTED:0`
    if (!store.tryClaimPushIdempotency(pushIdemKey)) {
      store.pushLog(
        ticker,
        'warn',
        `Auto-${researchMode} push skipped — duplicate idempotency key ${pushIdemKey}`,
        'notify',
      )
      processedStarts.set(jobKey, {
        at: Date.now(),
        status: 'skipped_duplicate',
        mode: researchMode,
      })
      results.push({
        episodeId: wantId,
        skipped: true,
        reason: 'duplicate_idempotency_key',
        mode: researchMode,
        idempotencyKey: pushIdemKey,
        frozenTrigger,
      })
      continue
    }

    // Title / body — frozen STARTED move + window (trading hours wording)
    // Rebuild title from frozen move always (ignore research push_title if it
    // used a different % — e.g. day return vs episode move).
    let title
    if (researchMode === 'reversal') {
      // Circle shows market direction after the reverse (not the erased leg)
      const revEmoji = direction === 'UP' ? '🔴' : '🟢'
      const revCore =
        (research.ok && research.push_title) ||
        (direction === 'UP'
          ? `${ticker} reverses lower`
          : `${ticker} rebounds sharply`)
      title = /^[🟢🔴]/.test(String(revCore).trim())
        ? String(revCore).trim()
        : `${revEmoji} ${String(revCore).trim()}`
    } else {
      title = buildMomentumAlertTitle({
        ticker,
        companyName,
        direction,
        movePercent,
        exactMinutes: Number.isFinite(exactMinutesFrozen)
          ? exactMinutesFrozen
          : exact?.exactMinutes ?? null,
        exactLabel: exactLabelFrozen || exact?.exactLabel || null,
        windowKey,
        referenceTime:
          startEv.referenceTime ||
          episode?.referenceTime ||
          exact?.referenceTime ||
          null,
        nowIso: startEv.detectedAt || null,
        marketSession:
          startEv.marketSession ||
          snapshot?.marketSession ||
          episode?.marketSession ||
          null,
      })
    }
    // Body: ONLY likely driver (start or reverse catalyst).
    // Re-extract from full reason if push_body / likely_driver were empty
    // (e.g. markdown **Likely driver:** mid-line after [TICKER] header).
    let body =
      research.ok && research.push_body
        ? String(research.push_body).trim()
        : research.ok && research.likely_driver
          ? String(research.likely_driver).trim()
          : ''
    if (!body && research.ok && research.reason) {
      body = formatDashesToCommas(extractLikelyDriver(research.reason))
    }
    if (!body) {
      const generic = buildNotificationCopy({
        ticker,
        companyName,
        eventType:
          researchMode === 'reversal' ? 'MOMENTUM_REVERSED' : 'MOMENTUM_STARTED',
        direction,
        movePercent,
        detectedAt: startEv.detectedAt,
        detectedWindow: windowKey,
        price,
        episode: {
          ...(episode || {}),
          initialMovePercent: movePercent,
          exactMinutes: exactMinutesFrozen || episode?.exactMinutes,
          exactLabel: exactLabelFrozen || episode?.exactLabel,
          referencePrice: startEv.referencePrice ?? episode?.referencePrice,
          referenceTime: startEv.referenceTime ?? episode?.referenceTime,
        },
        exactMinutes: Number.isFinite(exactMinutesFrozen)
          ? exactMinutesFrozen
          : exact?.exactMinutes ?? null,
        exactLabel: exactLabelFrozen || exact?.exactLabel || null,
        // Pass through any driver we may still have
        likelyDriver: research.ok ? research.likely_driver || null : null,
      })
      if (!title) {
        title =
          generic?.title ||
          (researchMode === 'reversal'
            ? `${ticker} reverse`
            : `${ticker} momentum`)
      }
      body = generic?.body || ''
    }

    if (!calendarAllowsHeavyWork(ticker)) {
      store.pushLog(
        ticker,
        'info',
        `Auto-${researchMode} push skipped — market calendar is closed / maintenance / holiday`,
        'notify',
      )
      processedStarts.set(jobKey, {
        at: Date.now(),
        status: 'skipped_paused',
        mode: researchMode,
      })
      results.push({
        episodeId: wantId,
        skipped: true,
        reason: 'us-equity-trigger-paused',
        mode: researchMode,
        frozenTrigger,
      })
      continue
    }

    const supabase = getSupabaseOrNull()
    const dryRun = process.env.MOMENTUM_PUSH_DRY_RUN === '1'
    const pushEventType =
      researchMode === 'reversal' ? 'MOMENTUM_REVERSED' : 'MOMENTUM_STARTED'
    let pushResult
    try {
      pushResult = await sendTriggerEpisodePush({
        supabase,
        ticker,
        title,
        body,
        eventType: pushEventType,
        direction,
        movePercent,
        price,
        episodeId,
        detectedWindow: windowKey,
        reason:
          researchMode === 'reversal'
            ? research.ok
              ? 'REVERSAL_RESEARCH'
              : 'REVERSAL_RESEARCH_FALLBACK'
            : research.ok
              ? 'RESEARCH'
              : 'RESEARCH_FALLBACK',
        marketSession: startEv.marketSession || snapshot?.marketSession,
        appKey: 'trigger',
        dryRun,
      })
    } catch (err) {
      pushResult = {
        ok: false,
        skipped: false,
        reason: err instanceof Error ? err.message : String(err),
        sent_ok: 0,
        sent_failed: 0,
        recipient_count: 0,
      }
    }

    const notifiedAt = new Date().toISOString()
    const alertEv = {
      ticker,
      direction,
      eventType: 'MOMENTUM_ALERT_SENT',
      price,
      movePercent,
      detectedWindow: windowKey,
      detectedAt: notifiedAt,
      notifiedAt,
      marketSession: startEv.marketSession || snapshot?.marketSession || null,
      reason:
        researchMode === 'reversal'
          ? research.ok
            ? 'REVERSAL_RESEARCH'
            : 'REVERSAL_RESEARCH_FALLBACK'
          : research.ok
            ? 'RESEARCH'
            : 'RESEARCH_FALLBACK',
      shouldNotify: true,
      // Full user-facing copy for mobile
      notification: { title, body },
      notificationTitle: title,
      notificationBody: body,
      // Frozen trigger — mobile/history must use these, not live market
      frozenTrigger,
      episodeId: frozenTrigger.episodeId,
      exactMinutes: Number.isFinite(exactMinutesFrozen)
        ? exactMinutesFrozen
        : exact?.exactMinutes ?? null,
      exactLabel: exactLabelFrozen || exact?.exactLabel || null,
      windowMinutes: startEv.windowMinutes ?? episode?.windowMinutes ?? null,
      referencePrice: Number.isFinite(frozenTrigger.referencePrice)
        ? frozenTrigger.referencePrice
        : null,
      referenceTime: frozenTrigger.referenceTime || null,
      triggerPrice: price,
      triggerMovePct: movePercent,
      triggerTimestamp: frozenTrigger.triggerTimestamp,
      initialMovePercent: movePercent,
      lookbackMinutes: Number.isFinite(exactMinutesFrozen)
        ? exactMinutesFrozen
        : exact?.exactMinutes ?? null,
      measureNote: Number.isFinite(movePercent)
        ? exactLabelFrozen || exact?.exactLabel
          ? `Alert uses frozen STARTED move ${movePercent >= 0 ? '+' : ''}${Number(movePercent).toFixed(2)}% over ${exactLabelFrozen || exact?.exactLabel}.`
          : `Alert uses frozen STARTED move ${movePercent >= 0 ? '+' : ''}${Number(movePercent).toFixed(2)}% on window ${windowKey}.`
        : null,
      research: research.ok
        ? {
            mode: researchMode,
            reason: research.reason,
            likely_driver:
              research.likely_driver ||
              extractLikelyDriver(research.reason) ||
              body ||
              null,
            provider: research.provider || (dummyMode ? 'dummy' : 'perplexity'),
            model: research.model_version || research.model || null,
            completedAt: researchAt,
            push_title: title,
            push_body: body,
            // Persist sources for Supabase / mobile (same as RESEARCH_DONE)
            citations: research.citations || [],
            search_results: research.search_results || [],
          }
        : {
            status: 'error',
            mode: researchMode,
            reason: research.error || 'Research failed',
            completedAt: researchAt,
          },
      pushResult: {
        ok: pushResult?.ok,
        skipped: pushResult?.skipped || false,
        reason: pushResult?.reason || null,
        sent_ok: pushResult?.sent_ok,
        sent_failed: pushResult?.sent_failed,
        recipient_count: pushResult?.recipient_count,
        deep_link: pushResult?.deep_link || null,
        device_ids: pushResult?.device_ids || [],
        recipients: pushResult?.recipients || [],
        forced_allowlist: Boolean(pushResult?.forced_allowlist),
        tickets: pushResult?.tickets || [],
        at: notifiedAt,
        source: researchMode === 'reversal' ? 'auto_reversal' : 'auto_start',
      },
    }
    store.pushEvent(ticker, alertEv)
    // Persist alert with full mobile payload (title/body/measure/pushResult)
    const liveForPersist = store.getActiveEpisode(ticker)
    void persistTick(
      ticker,
      liveForPersist &&
        String(liveForPersist.episodeId || '') === String(episodeId)
        ? {
            ...liveForPersist,
            lastNotification: {
              title,
              body,
              at: notifiedAt,
              eventType: 'MOMENTUM_ALERT_SENT',
              movePercent,
              exactMinutes: Number.isFinite(exactMinutesFrozen)
                ? exactMinutesFrozen
                : null,
              exactLabel: exactLabelFrozen || null,
            },
          }
        : liveForPersist,
      [alertEv],
    )

    const sent = pushResult?.sent_ok || 0
    const count = pushResult?.recipient_count || 0
    const kindLabel = researchMode === 'reversal' ? 'REVERSED' : 'STARTED'
    let level = 'success'
    let msg = `Notify · ${kindLabel} (auto research) · Expo ${sent}/${count} · “${title}”`
    if (pushResult?.skipped && count === 0) {
      level = 'warn'
      msg = `Notify skipped · ${kindLabel} · ${pushResult?.reason || 'no watchlist devices'} for ${ticker}`
    } else if (pushResult && pushResult.ok === false && !pushResult.skipped) {
      level = 'error'
      msg = `Notify failed · ${kindLabel} · sent=${sent} failed=${pushResult.sent_failed || 0}`
    }
    store.pushLog(ticker, level, msg, 'notify', {
      title,
      body,
      pushResult: alertEv.pushResult,
      research_ok: research.ok,
      mode: researchMode,
    })

    // Keep episode alert baseline in sync with actual push (start only)
    if (researchMode === 'start') {
      const live = store.getActiveEpisode(ticker)
      if (live && String(live.episodeId || live.episode_id || '') === String(episodeId)) {
        store.setActiveEpisode(ticker, {
          ...live,
          lastAlertAt: notifiedAt,
          lastAlertMovePercent: movePercent,
          lastNotification: {
            title,
            body,
            at: notifiedAt,
            eventType: 'MOMENTUM_ALERT_SENT',
            movePercent,
            exactMinutes: Number.isFinite(exactMinutesFrozen)
              ? exactMinutesFrozen
              : null,
            exactLabel: exactLabelFrozen || null,
          },
          lastNotifiedTime: notifiedAt,
          lastNotifiedPrice: price ?? live.lastNotifiedPrice,
          lastNotifiedEpisodeMovePct: movePercent,
        })
      } else if (live) {
        const sameStart =
          live.episodeStartedAt &&
          startEv.detectedAt &&
          live.episodeStartedAt === startEv.detectedAt
        if (sameStart || !live.episodeId) {
          store.setActiveEpisode(ticker, {
            ...live,
            lastAlertAt: notifiedAt,
            lastAlertMovePercent: movePercent,
            lastNotifiedTime: notifiedAt,
            lastNotifiedPrice: price ?? live.lastNotifiedPrice,
            lastNotifiedEpisodeMovePct: movePercent,
          })
        }
      }
    }

    processedStarts.set(jobKey, {
      at: Date.now(),
      status: 'done',
      mode: researchMode,
      research_ok: research.ok,
      sent_ok: sent,
    })
    results.push({
      episodeId,
      mode: researchMode,
      research_ok: research.ok,
      sent_ok: sent,
      recipient_count: count,
      title,
    })
  }

  return { ok: true, results }
}
