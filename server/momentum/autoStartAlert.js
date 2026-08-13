/**
 * Auto pipeline on MOMENTUM_STARTED:
 *   1) Perplexity research (reason / likely driver)
 *   2) Expo push to watchlist devices
 *   3) Timeline markers: RESEARCH_DONE → ALERT_SENT
 *
 * STARTED itself stays shouldNotify=false (no generic pre-research push).
 * AFTER_REVERSAL silent starts are skipped (REVERSED already pushed).
 *
 * Disable: MOMENTUM_AUTO_START_RESEARCH=0
 */
import { createClient } from '@supabase/supabase-js'
import { classifyAsset } from '../tradingEconomics.js'
import {
  buildMomentumResearchGeminiPromptTemplate,
  buildMomentumUserMovementLine,
  buildMomentumInputFacts,
  fillMomentumResearchPrompt,
  callPerplexityResearch,
  structuredReasonHasLikelyDriver,
  sanitizeGeminiSessionHeadline,
  geminiMaxOutputTokens,
  recordPerplexityUsageLedger,
  saveMomentumResearchRow,
  sendTriggerEpisodePush,
} from '../notifications.js'
import {
  MOMENTUM_AUTO_START_RESEARCH,
  isMomentumDummyResearchMode,
} from './config.js'
import {
  buildMomentumAlertTitle,
  buildNotificationCopy,
  formatDashesToCommas,
  resolveLookbackMinutes,
} from './notifyCopy.js'
import * as store from './store.js'

/** episodeId → in-flight or completed auto pipeline */
const processedStarts = new Map()

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

  const userMovement = buildMomentumUserMovementLine({
    ticker,
    companyName,
    moveText,
    preferredTimePhrase,
    exactLabel,
    windowLabel,
    windowKey,
  })
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
  const fullPrompt = fillMomentumResearchPrompt(
    promptTemplate,
    userMovement,
    inputFacts,
  )

  // Testing / push-allowlist mode: skip Perplexity API, keep timeline + alert flow
  if (isMomentumDummyResearchMode()) {
    const name = companyName || ticker
    const lookbackMinutes = resolveLookbackMinutes({
      exactMinutes: Number.isFinite(exactMinutes) ? exactMinutes : null,
      exactLabel: exactLabel || null,
      windowKey,
      referenceTime,
      nowIso: new Date().toISOString(),
    })
    const dir =
      Number.isFinite(movePercent) && movePercent < 0
        ? 'DOWN'
        : String(input.direction || '').toUpperCase() === 'DOWN'
          ? 'DOWN'
          : 'UP'
    const pushTitle = buildMomentumAlertTitle({
      ticker,
      direction: dir,
      movePercent: Number.isFinite(movePercent) ? movePercent : null,
      lookbackMinutes,
    })
    const dummyDriver = formatDashesToCommas(
      Number.isFinite(movePercent) && movePercent < 0
        ? `Simulated pressure on ${name} after a sharp session move.`
        : `Simulated buying interest in ${name} after a sharp session move.`,
    )
    const dummyReason = [
      `${name} ${moveText || 'moved'} ${preferredTimePhrase}.`,
      '',
      `Likely driver: ${dummyDriver}`,
      '',
      'Secondary driver: No clear secondary driver identified.',
      '',
      'Move classification: 60% company-specific, 40% sector/market/macro-related.',
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

  if (!summary?.trim()) {
    return {
      ok: false,
      error: 'Perplexity returned an empty reason',
      user_movement: userMovement,
      asset_class: cls,
    }
  }

  const likelyLine = summary
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^likely driver:\s*/i.test(l))
  // Dashes → commas before save / push (Perplexity often uses em-dashes)
  const likelyDriver = formatDashesToCommas(
    likelyLine ? likelyLine.replace(/^likely driver:\s*/i, '').trim() : '',
  )
  const summaryFormatted = formatDashesToCommas(summary)

  // Title: 🟢 SNDK +7.6% in last 42 minutes  (ticker, not company name)
  // Body:  Likely driver only
  const lookbackMinutes = resolveLookbackMinutes({
    exactMinutes: Number.isFinite(exactMinutes) ? exactMinutes : null,
    exactLabel: exactLabel || null,
    windowKey,
    referenceTime,
    nowIso: new Date().toISOString(),
  })
  const dir =
    Number.isFinite(movePercent) && movePercent < 0
      ? 'DOWN'
      : String(input.direction || '').toUpperCase() === 'DOWN'
        ? 'DOWN'
        : 'UP'
  const pushTitle = buildMomentumAlertTitle({
    ticker,
    direction: dir,
    movePercent: Number.isFinite(movePercent) ? movePercent : null,
    lookbackMinutes,
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
 * After a tick that emitted MOMENTUM_STARTED: research + push + timeline rows.
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

  const starts = events.filter((ev) => {
    const type = String(ev?.eventType || '')
    if (type !== 'MOMENTUM_STARTED' && !type.endsWith('_STARTED')) return false
    // Opposite leg after reversal already got a REVERSED push
    if (String(ev?.reason || '').toUpperCase() === 'AFTER_REVERSAL') return false
    return true
  })

  if (!starts.length) return { ok: true, skipped: true, reason: 'no_start' }

  const results = []
  for (const startEv of starts) {
    const episodeId =
      episode?.episodeId ||
      episode?.episode_id ||
      `${ticker}-${startEv.detectedAt || ''}`

    if (processedStarts.has(episodeId)) {
      results.push({ episodeId, skipped: true, reason: 'already_processed' })
      continue
    }
    processedStarts.set(episodeId, { at: Date.now(), status: 'running' })

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
        ? `Auto-start pipeline · DUMMY research (no Perplexity API) for ${startEv.direction || episode?.direction || '?'} start…`
        : `Auto-start pipeline · Perplexity research for ${startEv.direction || episode?.direction || '?'} start…`,
      'research',
    )

    const windowKey =
      startEv.detectedWindow || episode?.detectedWindow || 'day'
    const exact =
      snapshot?.exactLookbacks?.[windowKey] ||
      snapshot?.exactLookbacks?.[String(windowKey)] ||
      null
    const companyName =
      meta?.longName ||
      meta?.shortName ||
      episode?.companyName ||
      null

    const direction =
      startEv.direction || episode?.direction || 'UP'
    const movePercent = Number(
      startEv.movePercent ??
        episode?.initialMovePercent ??
        episode?.currentMovePercent ??
        0,
    )
    const price =
      startEv.price ?? episode?.currentPrice ?? snapshot?.currentPrice
    const researchStartedAt = new Date().toISOString()

    // Live timeline row — UI blinks while status=running, then becomes "done"
    store.pushEvent(ticker, {
      ticker,
      direction,
      eventType: 'MOMENTUM_RESEARCH_RUNNING',
      price,
      movePercent,
      detectedWindow: windowKey,
      detectedAt: researchStartedAt,
      marketSession: startEv.marketSession || snapshot?.marketSession || null,
      reason: 'RUNNING',
      shouldNotify: false,
      notification: null,
      episodeId,
      research: {
        status: 'running',
        provider: dummyMode ? 'dummy' : 'perplexity',
        startedAt: researchStartedAt,
        reason: dummyMode
          ? 'Dummy research (no API call)…'
          : 'Researching likely driver…',
      },
    })

    let research
    try {
      research = await researchStartMove({
        ticker,
        companyName,
        windowKey,
        windowLabel: windowKey,
        exactLabel: exact?.exactLabel || null,
        exactMinutes: exact?.exactMinutes ?? null,
        movePercent:
          startEv.movePercent ??
          episode?.initialMovePercent ??
          episode?.currentMovePercent,
        livePrice:
          startEv.price ??
          episode?.currentPrice ??
          snapshot?.currentPrice,
        referencePrice:
          exact?.referencePrice ??
          snapshot?.references?.[windowKey] ??
          episode?.referencePrice ??
          snapshot?.previousClose,
        referenceTime:
          exact?.referenceTime ??
          snapshot?.referenceTimes?.[windowKey] ??
          episode?.referenceTime ??
          snapshot?.previousCloseTime,
        marketSession:
          startEv.marketSession ||
          snapshot?.marketSession ||
          episode?.marketSession,
        assetClass: snapshot?.assetClass || 'equity',
      })
    } catch (err) {
      research = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }

    const researchAt = new Date().toISOString()

    // Flip running → done/error in place so the rail stops blinking
    const researchPatch = {
      eventType: 'MOMENTUM_RESEARCH_DONE',
      detectedAt: researchAt,
      reason: research.ok
        ? research.reason
        : `Research failed: ${research.error || 'unknown'}`,
      likely_driver: research.ok ? research.likely_driver : null,
      research: research.ok
        ? {
            status: 'done',
            reason: research.reason,
            likely_driver: research.likely_driver,
            provider: 'perplexity',
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
            provider: 'perplexity',
            startedAt: researchStartedAt,
            completedAt: researchAt,
            error: true,
          },
    }
    let researchEv = store.updateEvent(
      ticker,
      (e) =>
        String(e?.eventType) === 'MOMENTUM_RESEARCH_RUNNING' &&
        String(e?.episodeId || '') === String(episodeId),
      researchPatch,
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
    store.pushLog(
      ticker,
      research.ok ? 'success' : 'error',
      research.ok
        ? `Perplexity done · ${String(research.likely_driver || research.reason || '').slice(0, 100)}`
        : `Perplexity failed · ${research.error || 'unknown'}`,
      'research',
      researchEv,
    )

    // Title always uses emoji + ticker + % + lookback phrase
    const lookbackMinutes = resolveLookbackMinutes({
      exactMinutes: exact?.exactMinutes ?? null,
      exactLabel: exact?.exactLabel || null,
      windowKey,
      referenceTime:
        exact?.referenceTime ??
        episode?.referenceTime ??
        snapshot?.previousCloseTime ??
        null,
      nowIso: startEv.detectedAt || new Date().toISOString(),
    })
    let title =
      (research.ok && research.push_title) ||
      buildMomentumAlertTitle({
        ticker,
        direction,
        movePercent,
        lookbackMinutes,
      })
    // Body: ONLY likely driver (nothing else)
    let body =
      research.ok && research.push_body
        ? String(research.push_body).trim()
        : research.ok && research.likely_driver
          ? String(research.likely_driver).trim()
          : ''
    if (!body) {
      const generic = buildNotificationCopy({
        ticker,
        eventType: 'MOMENTUM_STARTED',
        direction,
        movePercent,
        detectedAt: startEv.detectedAt,
        detectedWindow: windowKey,
        price,
        episode,
        exactMinutes: exact?.exactMinutes ?? null,
        exactLabel: exact?.exactLabel || null,
        likelyDriver: null,
      })
      // Keep title shape; body only if we truly have no research driver
      if (!title) title = generic?.title || `${ticker} momentum`
      body = generic?.body || ''
    }

    const supabase = getSupabaseOrNull()
    const dryRun = process.env.MOMENTUM_PUSH_DRY_RUN === '1'
    let pushResult
    try {
      pushResult = await sendTriggerEpisodePush({
        supabase,
        ticker,
        title,
        body,
        eventType: 'MOMENTUM_STARTED',
        direction,
        movePercent,
        price,
        episodeId,
        detectedWindow: windowKey,
        reason: research.ok ? 'RESEARCH' : 'RESEARCH_FALLBACK',
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
      reason: research.ok ? 'RESEARCH' : 'RESEARCH_FALLBACK',
      shouldNotify: true,
      notification: { title, body },
      research: research.ok
        ? {
            reason: research.reason,
            likely_driver: research.likely_driver,
            provider: 'perplexity',
            completedAt: researchAt,
          }
        : null,
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
        source: 'auto_start',
      },
    }
    store.pushEvent(ticker, alertEv)

    const sent = pushResult?.sent_ok || 0
    const count = pushResult?.recipient_count || 0
    let level = 'success'
    let msg = `Notify · STARTED (auto research) · Expo ${sent}/${count} · “${title}”`
    if (pushResult?.skipped && count === 0) {
      level = 'warn'
      msg = `Notify skipped · STARTED · ${pushResult?.reason || 'no watchlist devices'} for ${ticker}`
    } else if (pushResult && pushResult.ok === false && !pushResult.skipped) {
      level = 'error'
      msg = `Notify failed · STARTED · sent=${sent} failed=${pushResult.sent_failed || 0}`
    }
    store.pushLog(ticker, level, msg, 'notify', {
      title,
      body,
      pushResult: alertEv.pushResult,
      research_ok: research.ok,
    })

    // Keep episode alert baseline in sync with actual push
    const live = store.getActiveEpisode(ticker)
    if (live && String(live.episodeId || live.episode_id || '') === String(episodeId)) {
      store.setActiveEpisode(ticker, {
        ...live,
        lastAlertAt: notifiedAt,
        lastAlertMovePercent: movePercent,
        lastNotifiedTime: notifiedAt,
        lastNotifiedPrice: price ?? live.lastNotifiedPrice,
        lastNotifiedEpisodeMovePct: movePercent,
      })
    } else if (live) {
      // episodeId mismatch (e.g. not set) — still update if same start time
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

    processedStarts.set(episodeId, {
      at: Date.now(),
      status: 'done',
      research_ok: research.ok,
      sent_ok: sent,
    })
    results.push({
      episodeId,
      research_ok: research.ok,
      sent_ok: sent,
      recipient_count: count,
      title,
    })
  }

  return { ok: true, results }
}
