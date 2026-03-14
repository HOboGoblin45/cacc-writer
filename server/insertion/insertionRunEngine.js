/**
 * server/insertion/insertionRunEngine.js
 * ----------------------------------------
 * Phase 9: Batch insertion run orchestrator.
 *
 * Assembles inputs, runs applicable fields through:
 *   format → insert → verify → fallback
 * Persists all results. Supports re-run and partial retry.
 */

import { getDb } from '../db/database.js';
import {
  createInsertionRun, updateInsertionRun,
  createInsertionRunItems, getInsertionRunItems, updateInsertionRunItem,
  getActiveProfile, getInsertionRun, getInsertionRunItem,
} from './insertionRepo.js';
import { resolveMapping, resolveAllMappings, inferTargetSoftware } from './destinationMapper.js';
import { formatForDestination } from './formatters/index.js';
import { verifyInsertion, readInsertionField } from './verificationEngine.js';
import { decideFallback, copyToClipboard } from './fallbackHandler.js';
import { callAgentInsert } from './agentClient.js';
import { getFormDraftTextMap } from './formDraftModel.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Prepare an insertion run: resolve mappings, gather texts, create run + items.
 * Does NOT execute insertion — call executeInsertionRun() after.
 *
 * @param {Object} params
 * @param {string} params.caseId
 * @param {string} params.formType
 * @param {string} [params.targetSoftware] - Auto-inferred if not provided
 * @param {string} [params.generationRunId]
 * @param {import('./types.js').InsertionRunConfig} [params.config]
 * @returns {Object} { run, items, preview }
 */
export function prepareInsertionRun({
  caseId,
  formType,
  targetSoftware = null,
  generationRunId = null,
  config = {},
}) {
  const software = targetSoftware || inferTargetSoftware(formType);
  const profile = getActiveProfile(software, formType);

  // Merge profile config with run config
  const mergedConfig = {
    dryRun: false,
    verifyAfter: true,
    skipQcBlockers: false,
    requireQcRun: false,
    requireFreshQcForGeneration: true,
    forceReinsert: false,
    rollbackOnVerificationFailure: true,
    maxRetries: 3,
    defaultFallback: 'retry_then_clipboard',
    ...(profile?.config || {}),
    ...config,
  };

  // Gather approved/final texts from generated_sections
  const fieldTexts = gatherFieldTexts(caseId, formType, generationRunId);

  // Resolve all mappings
  const allMappings = resolveAllMappings(formType, software);

  // Filter to fields that have text and are supported (unless forceReinsert)
  const eligibleMappings = allMappings.filter(m => {
    const text = fieldTexts.get(m.fieldId);
    if (!text || text.trim().length === 0) return false;
    if (!m.supported && !mergedConfig.dryRun) return false;
    // If specific fieldIds requested, filter to those
    if (mergedConfig.fieldIds && mergedConfig.fieldIds.length > 0) {
      return mergedConfig.fieldIds.includes(m.fieldId);
    }
    return true;
  });

  // Check QC gate
  const qcGate = evaluateInsertionQcGate({
    caseId,
    generationRunId,
    config: mergedConfig,
  });
  mergedConfig.qcOverrideAllowed = qcGate.overrideAllowed !== false;

  // Create the run
  const run = createInsertionRun({
    caseId,
    generationRunId,
    formType,
    targetSoftware: software,
    config: mergedConfig,
    qcRunId: qcGate.qcRunId,
    qcBlockerCount: qcGate.blockerCount,
    qcGatePassed: qcGate.passed,
  });

  // Create items
  const itemParams = eligibleMappings.map((mapping, idx) => ({
    insertionRunId: run.id,
    caseId,
    fieldId: mapping.fieldId,
    formType,
    targetSoftware: software,
    destinationKey: mapping.destinationKey,
    canonicalText: fieldTexts.get(mapping.fieldId) || '',
    maxAttempts: mergedConfig.maxRetries,
    fallbackStrategy: mapping.fallbackStrategy || mergedConfig.defaultFallback,
    sortOrder: idx,
  }));

  const itemCount = createInsertionRunItems(itemParams);

  // Update run with total count
  updateInsertionRun(run.id, {
    totalFields: itemCount,
  });

  const items = getInsertionRunItems(run.id);

  return {
    run: getInsertionRun(run.id),
    items,
    qcGate,
    profile,
  };
}

/**
 * Execute an insertion run.
 * Processes each item: format → insert → verify → fallback.
 *
 * @param {string} runId
 * @returns {Promise<Object>} Final run state with summary
 */
export async function executeInsertionRun(runId) {
  const run = getInsertionRun(runId);
  if (!run) throw new Error(`Insertion run not found: ${runId}`);

  // Check if QC gate blocks execution
  const canBypassQcGate = !!run.config.skipQcBlockers && run.config.qcOverrideAllowed !== false;
  if (!run.qcGatePassed && !canBypassQcGate) {
    updateInsertionRun(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      summaryJson: { error: 'QC gate blocked insertion', blockerCount: run.qcBlockerCount },
    });
    return getInsertionRun(runId);
  }

  // Mark run as running
  updateInsertionRun(runId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  const profile = getActiveProfile(run.targetSoftware, run.formType);
  const agentBaseUrl = profile?.baseUrl || getDefaultAgentUrl(run.targetSoftware);
  const items = getInsertionRunItems(runId);

  // Check agent health before starting
  const agentHealthy = await checkAgentHealth(agentBaseUrl);
  if (!agentHealthy && !run.config.dryRun) {
    updateInsertionRun(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      summaryJson: { error: `Agent unreachable at ${agentBaseUrl}` },
    });
    return getInsertionRun(runId);
  }

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let verified = 0;
  const failedFieldIds = [];
  const mismatchFieldIds = [];

  // Process each item sequentially (agents handle one field at a time)
  for (const item of items) {
    try {
      const result = await processItem(item, run, profile, agentBaseUrl);

      if (result.status === 'verified') {
        completed++;
        verified++;
      } else if (result.status === 'inserted') {
        completed++;
      } else if (result.status === 'skipped') {
        skipped++;
      } else if (result.status === 'failed' || result.status === 'fallback_used') {
        if (result.status === 'failed') {
          failed++;
          failedFieldIds.push(item.fieldId);
        } else {
          completed++;
        }
      }

      if (result.verificationStatus === 'mismatch') {
        mismatchFieldIds.push(item.fieldId);
      }

      // Update run counters periodically
      updateInsertionRun(runId, {
        completedFields: completed,
        failedFields: failed,
        skippedFields: skipped,
        verifiedFields: verified,
      });
    } catch (err) {
      failed++;
      failedFieldIds.push(item.fieldId);
      updateInsertionRunItem(item.id, {
        status: 'failed',
        errorCode: 'unknown',
        errorText: err.message,
        completedAt: new Date().toISOString(),
      });
    }
  }

  const finalItems = getInsertionRunItems(runId);
  const rollbackCount = finalItems.filter((entry) => entry.rollbackStatus === 'restored').length;
  const fallbackUsedCount = finalItems.filter((entry) => entry.fallbackUsed).length;

  // Build summary
  const durationMs = Date.now() - new Date(run.startedAt || run.createdAt).getTime();
  let readinessSignal = 'ready';
  if (failed > 0 && completed === 0) readinessSignal = 'failed';
  else if (failed > 0 || mismatchFieldIds.length > 0) readinessSignal = 'needs_review';
  else if (skipped > items.length * 0.3) readinessSignal = 'incomplete';

  const summary = {
    totalFields: items.length,
    inserted: completed,
    verified,
    failed,
    skipped,
    fallbackUsed: fallbackUsedCount,
    rollbackFields: rollbackCount,
    durationMs,
    failedFieldIds,
    mismatchFieldIds,
    readinessSignal,
  };
  const replayPackage = buildInsertionReplayPackage({ run, items: finalItems });

  const finalStatus = failed === 0 && skipped === 0 ? 'completed'
    : failed === items.length ? 'failed'
    : 'partial';

  updateInsertionRun(runId, {
    status: finalStatus,
    completedFields: completed,
    failedFields: failed,
    skippedFields: skipped,
    verifiedFields: verified,
    rollbackFields: rollbackCount,
    completedAt: new Date().toISOString(),
    durationMs,
    summaryJson: summary,
    replayPackageJson: replayPackage,
  });

  return getInsertionRun(runId);
}

// ── Item Processing ───────────────────────────────────────────────────────────

/**
 * Process a single insertion item through the full lifecycle.
 * Exported for reuse by replayEngine.
 *
 * @param {Object} item - Insertion run item
 * @param {Object} run - Parent insertion run
 * @param {Object} profile - Destination profile
 * @param {string} agentBaseUrl
 * @returns {Promise<Object>} Updated item state
 */
export async function processItem(item, run, profile, agentBaseUrl) {
  const startTime = Date.now();
  const attemptLog = [];
  let retryClass = null;

  updateInsertionRunItem(item.id, {
    status: 'formatting',
    startedAt: new Date().toISOString(),
  });

  // 1. Resolve mapping
  const mapping = resolveMapping(item.fieldId, item.formType, item.targetSoftware);

  // 2. Format text
  const formatResult = formatForDestination({
    canonicalText: item.canonicalText,
    fieldId: item.fieldId,
    formType: item.formType,
    targetSoftware: item.targetSoftware,
    formattingMode: mapping.formattingMode,
    mapping,
  });

  updateInsertionRunItem(item.id, {
    formattedText: formatResult.formattedText,
    formattedTextLength: formatResult.formattedLength,
  });

  if (!formatResult.formattedText || formatResult.formattedText.trim().length === 0) {
    retryClass = classifyRetryClass('no_text');
    updateInsertionRunItem(item.id, {
      status: 'skipped',
      retryClass,
      attemptLogJson: attemptLog,
      errorCode: 'no_text',
      errorText: 'Formatted text is empty',
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    });
    return { status: 'skipped', verificationStatus: 'skipped' };
  }

  // 3. Dry run — stop here
  if (run.config.dryRun) {
    updateInsertionRunItem(item.id, {
      status: 'skipped',
      attemptLogJson: attemptLog,
      errorText: 'Dry run — insertion skipped',
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    });
    return { status: 'skipped', verificationStatus: 'skipped' };
  }

  const readbackEnabled = supportsReadback(profile, mapping);
  let preInsertSnapshot = {
    status: 'not_supported',
    rawValue: null,
    normalizedValue: null,
    message: null,
  };
  if (readbackEnabled) {
    preInsertSnapshot = await readInsertionField({
      agentFieldKey: mapping.agentFieldKey || item.fieldId,
      formType: item.formType,
      targetSoftware: item.targetSoftware,
      agentBaseUrl,
      timeout: profile?.config?.timeout || 10000,
    });
    updateInsertionRunItem(item.id, {
      preinsertRaw: preInsertSnapshot.rawValue,
      preinsertNormalized: preInsertSnapshot.normalizedValue,
    });
  }

  // 4. Insert via agent
  updateInsertionRunItem(item.id, { status: 'inserting' });

  let insertResult;
  let attemptCount = 0;
  let lastError = null;

  while (attemptCount < (item.maxAttempts || 3)) {
    attemptCount++;
    try {
      insertResult = await callAgentInsert({
        fieldId: mapping.agentFieldKey || item.fieldId,
        text: formatResult.formattedText,
        formType: item.formType,
        agentBaseUrl,
        timeout: profile?.config?.timeout || 15000,
      });

      if (insertResult.success) {
        attemptLog.push({
          attemptCount,
          phase: 'insert',
          outcome: 'success',
          retryClass,
          at: new Date().toISOString(),
        });
        break;
      }

      lastError = {
        code: insertResult.errorCode || 'insertion_rejected',
        text: insertResult.message || 'Agent rejected insertion',
        detail: insertResult,
      };
    } catch (err) {
      lastError = {
        code: err.name === 'AbortError' ? 'agent_timeout' : 'agent_unreachable',
        text: err.message,
        detail: { stack: err.stack },
      };
    }

    retryClass = classifyRetryClass(lastError.code);
    attemptLog.push({
      attemptCount,
      phase: 'insert',
      outcome: 'failed',
      retryClass,
      errorCode: lastError.code,
      errorText: lastError.text,
      at: new Date().toISOString(),
    });

    // Check fallback
    const fallback = decideFallback({
      fallbackStrategy: item.fallbackStrategy,
      attemptCount,
      maxAttempts: item.maxAttempts,
      errorCode: lastError.code,
      targetSoftware: item.targetSoftware,
    });

    if (!fallback.shouldRetry) {
      // Handle clipboard fallback
      if (fallback.shouldClipboard) {
        await copyToClipboard(formatResult.formattedText, item.targetSoftware, agentBaseUrl);
        updateInsertionRunItem(item.id, {
          status: 'fallback_used',
          attemptCount,
          retryClass,
          attemptLogJson: attemptLog,
          fallbackUsed: true,
          errorCode: lastError.code,
          errorText: `${lastError.text} — clipboard fallback used`,
          errorDetailJson: lastError.detail,
          agentResponseJson: insertResult || {},
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        });
        return { status: 'fallback_used', verificationStatus: 'skipped' };
      }

      // Failed — no more retries
      updateInsertionRunItem(item.id, {
        status: 'failed',
        attemptCount,
        retryClass,
        attemptLogJson: attemptLog,
        errorCode: lastError.code,
        errorText: lastError.text,
        errorDetailJson: lastError.detail,
        agentResponseJson: insertResult || {},
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      });
      return { status: 'failed', verificationStatus: 'skipped' };
    }

    // Brief delay before retry
    await sleep(retryDelayMs(retryClass, attemptCount));
  }

  // Insertion succeeded
  updateInsertionRunItem(item.id, {
    status: 'inserted',
    attemptCount,
    retryClass,
    attemptLogJson: attemptLog,
    agentResponseJson: insertResult || {},
  });

  // 5. Verify if configured
  let verificationStatus = 'skipped';
  if (run.config.verifyAfter && mapping.supported) {
    const verResult = await verifyInsertion({
      fieldId: item.fieldId,
      agentFieldKey: mapping.agentFieldKey || item.fieldId,
      formattedText: formatResult.formattedText,
      formType: item.formType,
      targetSoftware: item.targetSoftware,
      agentBaseUrl,
      verificationMode: mapping.verificationMode,
      targetRect: insertResult?.diagnostics?.tx32_rect || null,
      timeout: profile?.config?.timeout || 10000,
    });

    verificationStatus = verResult.status;
    attemptLog.push({
      attemptCount,
      phase: 'verify',
      outcome: verResult.status,
      retryClass: classifyRetryClass('verification_mismatch'),
      similarityScore: verResult.similarityScore ?? null,
      at: new Date().toISOString(),
    });

    updateInsertionRunItem(item.id, {
      verificationStatus: verResult.status,
      verificationRaw: verResult.rawValue,
      verificationNormalized: verResult.normalizedValue,
      verificationExpected: verResult.expectedNormalized,
      attemptLogJson: attemptLog,
    });

    if (verResult.status === 'passed') {
      updateInsertionRunItem(item.id, {
        status: 'verified',
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      });
      return { status: 'verified', verificationStatus: 'passed' };
    }

    if (['mismatch', 'unreadable', 'failed'].includes(verResult.status)) {
      retryClass = classifyRetryClass('verification_mismatch');
      const rollbackResult = await rollbackInsertedField({
        item,
        run,
        mapping,
        profile,
        agentBaseUrl,
        preInsertSnapshot,
      });

      updateInsertionRunItem(item.id, {
        status: 'failed',
        retryClass,
        attemptLogJson: attemptLog,
        rollbackAttempted: rollbackResult.attempted,
        rollbackStatus: rollbackResult.status,
        rollbackText: rollbackResult.rollbackText,
        rollbackErrorText: rollbackResult.errorText,
        errorCode: 'verification_mismatch',
        errorText: verResult.mismatchDetail || `Insertion verification ${verResult.status}`,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      });

      return {
        status: 'failed',
        verificationStatus,
        rollbackStatus: rollbackResult.status,
      };
    }
  }

  // Mark as inserted (verification skipped or not passed but insertion succeeded)
  updateInsertionRunItem(item.id, {
    attemptLogJson: attemptLog,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  });

  return { status: 'inserted', verificationStatus };
}

function classifyRetryClass(errorCode = 'unknown') {
  const normalized = String(errorCode || 'unknown').toLowerCase();
  if (normalized === 'agent_unreachable' || normalized === 'agent_timeout') return 'transport';
  if (normalized === 'insertion_rejected') return 'destination';
  if (normalized === 'verification_mismatch') return 'verification';
  if (normalized === 'field_not_found') return 'mapping';
  if (normalized === 'format_error' || normalized === 'no_text' || normalized === 'qc_blocked') return 'data';
  if (normalized === 'auth_failed' || normalized === 'permission_denied' || normalized === 'unauthorized') return 'auth';
  if (normalized === 'session_expired' || normalized === 'stale_session') return 'stale_session';
  if (normalized === 'rate_limited' || normalized === 'throttled' || normalized === 'too_many_requests') return 'rate_limit';
  return 'unknown';
}

/**
 * Retry delay recommendations per class.
 * @type {Record<string, {baseDelayMs: number, maxRetries: number}>}
 */
const RETRY_CLASS_CONFIG = {
  transport:     { baseDelayMs: 1200, maxRetries: 3 },
  destination:   { baseDelayMs: 750,  maxRetries: 2 },
  verification:  { baseDelayMs: 500,  maxRetries: 1 },
  mapping:       { baseDelayMs: 0,    maxRetries: 0 },
  data:          { baseDelayMs: 0,    maxRetries: 0 },
  auth:          { baseDelayMs: 0,    maxRetries: 0 },
  stale_session: { baseDelayMs: 2000, maxRetries: 1 },
  rate_limit:    { baseDelayMs: 5000, maxRetries: 3 },
  unknown:       { baseDelayMs: 1000, maxRetries: 2 },
};

/**
 * Get retry configuration for a given class.
 * @param {string} retryClass
 * @returns {{baseDelayMs: number, maxRetries: number}}
 */
export function getRetryClassConfig(retryClass) {
  return RETRY_CLASS_CONFIG[retryClass] || RETRY_CLASS_CONFIG.unknown;
}

function retryDelayMs(retryClass, attemptCount) {
  const config = RETRY_CLASS_CONFIG[retryClass] || RETRY_CLASS_CONFIG.unknown;
  return config.baseDelayMs * attemptCount;
}

function supportsReadback(profile, mapping) {
  return Boolean(
    mapping?.supported &&
    mapping?.agentFieldKey &&
    profile?.capabilities?.supportsReadback !== false
  );
}

async function rollbackInsertedField({
  item,
  run,
  mapping,
  profile,
  agentBaseUrl,
  preInsertSnapshot,
}) {
  if (run.config.rollbackOnVerificationFailure === false) {
    return {
      attempted: false,
      status: 'skipped',
      rollbackText: null,
      errorText: 'Rollback disabled by config',
    };
  }

  if (!supportsReadback(profile, mapping) || preInsertSnapshot.status !== 'passed') {
    return {
      attempted: false,
      status: 'skipped',
      rollbackText: null,
      errorText: 'No reliable pre-insert snapshot available',
    };
  }

  try {
    const rollbackText = preInsertSnapshot.rawValue || '';
    const result = await callAgentInsert({
      fieldId: mapping.agentFieldKey || item.fieldId,
      text: rollbackText,
      formType: item.formType,
      agentBaseUrl,
      timeout: profile?.config?.timeout || 15000,
    });

    if (!result.success) {
      return {
        attempted: true,
        status: 'failed',
        rollbackText,
        errorText: result.message || result.error || 'Rollback rejected by agent',
      };
    }

    return {
      attempted: true,
      status: 'restored',
      rollbackText,
      errorText: null,
    };
  } catch (err) {
    return {
      attempted: true,
      status: 'failed',
      rollbackText: preInsertSnapshot.rawValue || '',
      errorText: err.message,
    };
  }
}

/**
 * Manually rollback a specific insertion item to its pre-insert value.
 * Can be called by the appraiser from the UI when they want to undo an insertion.
 *
 * @param {string} itemId - The insertion run item ID
 * @param {Object} [options]
 * @param {boolean} [options.verify] - Verify rollback succeeded via readback (default: true)
 * @returns {Promise<Object>} Rollback result
 */
export async function manualRollbackItem(itemId, options = {}) {
  const item = getInsertionRunItem(itemId);
  if (!item) throw new Error(`Insertion item not found: ${itemId}`);

  const run = getInsertionRun(item.runId);
  if (!run) throw new Error(`Insertion run not found: ${item.runId}`);

  if (!item.preinsertRaw && !item.preinsert_raw) {
    return {
      itemId,
      status: 'skipped',
      reason: 'No pre-insert snapshot available for this field',
    };
  }

  const profile = getActiveProfile(run.targetSoftware);
  if (!profile) {
    return {
      itemId,
      status: 'failed',
      reason: `No active profile for ${run.targetSoftware}`,
    };
  }

  const mapping = resolveMapping(item.fieldId, run.formType, run.targetSoftware);
  const agentBaseUrl = profile.agentUrl || profile.agent_url;
  const rollbackText = item.preinsertRaw || item.preinsert_raw || '';

  try {
    const result = await callAgentInsert({
      fieldId: mapping.agentFieldKey || item.fieldId,
      text: rollbackText,
      formType: run.formType,
      agentBaseUrl,
      timeout: profile?.config?.timeout || 15000,
    });

    if (!result.success) {
      updateInsertionRunItem(itemId, {
        rollbackAttempted: true,
        rollbackStatus: 'failed',
        rollbackText,
        rollbackErrorText: result.message || 'Rollback rejected by agent',
      });
      return {
        itemId,
        status: 'failed',
        reason: result.message || 'Rollback rejected by agent',
      };
    }

    // Verify rollback if requested
    let verificationResult = null;
    if (options.verify !== false && supportsReadback(profile, mapping)) {
      try {
        verificationResult = await verifyInsertion({
          fieldId: item.fieldId,
          agentFieldKey: mapping.agentFieldKey || item.fieldId,
          formattedText: rollbackText,
          formType: run.formType,
          targetSoftware: run.targetSoftware,
          agentBaseUrl,
          timeout: profile?.config?.timeout || 10000,
        });
      } catch {
        verificationResult = { status: 'unreadable' };
      }
    }

    updateInsertionRunItem(itemId, {
      rollbackAttempted: true,
      rollbackStatus: 'restored',
      rollbackText,
      rollbackErrorText: null,
      status: 'rolled_back',
    });

    return {
      itemId,
      status: 'restored',
      rollbackText: rollbackText.slice(0, 200),
      verification: verificationResult ? verificationResult.status : 'not_checked',
    };
  } catch (err) {
    updateInsertionRunItem(itemId, {
      rollbackAttempted: true,
      rollbackStatus: 'failed',
      rollbackText,
      rollbackErrorText: err.message,
    });
    return {
      itemId,
      status: 'failed',
      reason: err.message,
    };
  }
}

/**
 * Batch rollback: rollback all eligible items in a run.
 *
 * @param {string} runId
 * @param {Object} [options]
 * @param {boolean} [options.verify] - Verify each rollback (default: true)
 * @param {string[]} [options.fieldIds] - Limit to specific fields (default: all eligible)
 * @returns {Promise<Object>} Batch rollback summary
 */
export async function batchRollback(runId, options = {}) {
  const run = getInsertionRun(runId);
  if (!run) throw new Error(`Insertion run not found: ${runId}`);

  const items = getInsertionRunItems(runId);
  let eligible = items.filter(item =>
    (item.preinsertRaw || item.preinsert_raw) &&
    (item.status === 'inserted' || item.status === 'verified' || item.status === 'failed')
  );

  if (options.fieldIds) {
    const fieldSet = new Set(options.fieldIds);
    eligible = eligible.filter(item => fieldSet.has(item.fieldId));
  }

  const results = [];
  for (const item of eligible) {
    const result = await manualRollbackItem(item.id, { verify: options.verify });
    results.push(result);
  }

  return {
    runId,
    totalEligible: eligible.length,
    restored: results.filter(r => r.status === 'restored').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results,
  };
}

function buildInsertionReplayPackage({ run, items }) {
  const replayItems = items
    .filter((item) => (
      item.status === 'failed' ||
      item.verificationStatus === 'mismatch' ||
      item.fallbackUsed ||
      item.rollbackAttempted
    ))
    .map((item) => ({
      fieldId: item.fieldId,
      destinationKey: item.destinationKey,
      status: item.status,
      verificationStatus: item.verificationStatus,
      retryClass: item.retryClass || 'unknown',
      formattedText: item.formattedText || '',
      preinsertRaw: item.preinsertRaw || undefined,
      verificationRaw: item.verificationRaw || undefined,
      rollbackStatus: item.rollbackStatus || undefined,
      errorCode: item.errorCode || undefined,
      errorText: item.errorText || undefined,
      attemptLog: Array.isArray(item.attemptLog) ? item.attemptLog : [],
    }));

  return {
    runId: run.id,
    caseId: run.caseId,
    formType: run.formType,
    targetSoftware: run.targetSoftware,
    generatedAt: new Date().toISOString(),
    summary: {
      failedCount: replayItems.filter((item) => item.status === 'failed').length,
      mismatchCount: replayItems.filter((item) => item.verificationStatus === 'mismatch').length,
      rollbackCount: replayItems.filter((item) => item.rollbackStatus === 'restored').length,
    },
    items: replayItems,
  };
}

/**
 * Build a structured dry-run report showing what WOULD be inserted.
 * Uses the items from a prepared run (run.config.dryRun should be true).
 *
 * @param {string} runId
 * @returns {Object} Dry-run report with field previews and potential issues
 */
export function buildDryRunReport(runId) {
  const run = getInsertionRun(runId);
  if (!run) throw new Error(`Insertion run not found: ${runId}`);

  const items = getInsertionRunItems(runId);
  const fieldPreviews = [];
  const potentialIssues = [];

  for (const item of items) {
    const mapping = resolveMapping(item.fieldId, item.formType, item.targetSoftware);

    // Format the text to see what would be sent
    const formatResult = formatForDestination({
      canonicalText: item.canonicalText,
      fieldId: item.fieldId,
      formType: item.formType,
      targetSoftware: item.targetSoftware,
      formattingMode: mapping.formattingMode,
      mapping,
    });

    const preview = {
      fieldId: item.fieldId,
      humanLabel: mapping.humanLabel,
      destinationKey: item.destinationKey,
      supported: mapping.supported,
      calibrated: mapping.calibrated,
      formattingMode: mapping.formattingMode,
      tabName: mapping.tabName,
      editorTarget: mapping.editorTarget,
      verificationMode: mapping.verificationMode,
      fallbackStrategy: mapping.fallbackStrategy || item.fallbackStrategy,
      canonicalTextLength: (item.canonicalText || '').length,
      canonicalTextPreview: (item.canonicalText || '').slice(0, 300),
      formattedTextLength: formatResult.formattedLength,
      formattedTextPreview: (formatResult.formattedText || '').slice(0, 300),
      formatWarnings: formatResult.warnings || [],
      truncated: formatResult.truncated || false,
    };

    fieldPreviews.push(preview);

    // Flag potential issues
    if (!mapping.supported) {
      potentialIssues.push({
        fieldId: item.fieldId,
        severity: 'error',
        issue: 'unsupported_field',
        message: `Field "${mapping.humanLabel}" has no agent mapping for ${item.targetSoftware}`,
      });
    }
    if (!mapping.calibrated && mapping.supported) {
      potentialIssues.push({
        fieldId: item.fieldId,
        severity: 'warning',
        issue: 'uncalibrated_field',
        message: `Field "${mapping.humanLabel}" agent mapping is not calibrated/verified`,
      });
    }
    if (formatResult.truncated) {
      potentialIssues.push({
        fieldId: item.fieldId,
        severity: 'warning',
        issue: 'text_truncated',
        message: `Text for "${mapping.humanLabel}" was truncated from ${formatResult.originalLength} to ${formatResult.formattedLength} chars`,
      });
    }
    if ((formatResult.warnings || []).length > 0) {
      for (const w of formatResult.warnings) {
        potentialIssues.push({
          fieldId: item.fieldId,
          severity: 'warning',
          issue: 'format_warning',
          message: `${mapping.humanLabel}: ${w}`,
        });
      }
    }
    if (!item.canonicalText || item.canonicalText.trim().length === 0) {
      potentialIssues.push({
        fieldId: item.fieldId,
        severity: 'info',
        issue: 'empty_text',
        message: `Field "${mapping.humanLabel}" has no text to insert`,
      });
    }
  }

  return {
    runId: run.id,
    caseId: run.caseId,
    formType: run.formType,
    targetSoftware: run.targetSoftware,
    isDryRun: true,
    totalFields: fieldPreviews.length,
    supportedFields: fieldPreviews.filter(f => f.supported).length,
    unsupportedFields: fieldPreviews.filter(f => !f.supported).length,
    fieldPreviews,
    potentialIssues,
    issuesBySevertiy: {
      error: potentialIssues.filter(i => i.severity === 'error').length,
      warning: potentialIssues.filter(i => i.severity === 'warning').length,
      info: potentialIssues.filter(i => i.severity === 'info').length,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Resume a failed or partial insertion run from where it stopped.
 * Only processes items that are pending (queued) or failed.
 * Skips already-verified items.
 *
 * @param {string} runId
 * @returns {Promise<Object>} Final run state with summary
 */
export async function resumeInsertionRun(runId) {
  const run = getInsertionRun(runId);
  if (!run) throw new Error(`Insertion run not found: ${runId}`);

  if (!['failed', 'partial', 'running'].includes(run.status)) {
    throw new Error(`Cannot resume run in status '${run.status}' — must be 'failed', 'partial', or 'running'`);
  }

  const profile = getActiveProfile(run.targetSoftware, run.formType);
  const agentBaseUrl = profile?.baseUrl || getDefaultAgentUrl(run.targetSoftware);

  // Check agent health
  const agentHealthy = await checkAgentHealth(agentBaseUrl);
  if (!agentHealthy) {
    throw new Error(`Agent unreachable at ${agentBaseUrl}`);
  }

  // Mark run as running again
  updateInsertionRun(runId, {
    status: 'running',
    startedAt: run.startedAt || new Date().toISOString(),
  });

  const allItems = getInsertionRunItems(runId);

  // Only process items that need work
  const resumableStatuses = new Set(['queued', 'failed', 'formatting', 'inserting']);
  const itemsToProcess = allItems.filter(item => resumableStatuses.has(item.status));
  const alreadyDone = allItems.filter(item => !resumableStatuses.has(item.status));

  // Count already completed items
  let completed = alreadyDone.filter(i => ['verified', 'inserted', 'fallback_used'].includes(i.status)).length;
  let failed = 0;
  let skipped = alreadyDone.filter(i => i.status === 'skipped').length;
  let verified = alreadyDone.filter(i => i.status === 'verified').length;
  const failedFieldIds = [];
  const mismatchFieldIds = [];

  // Carry over mismatches from already-done items
  for (const item of alreadyDone) {
    if (item.verificationStatus === 'mismatch') {
      mismatchFieldIds.push(item.fieldId);
    }
  }

  // Process resumable items
  for (const item of itemsToProcess) {
    // Reset failed items to queued before reprocessing
    if (item.status === 'failed') {
      updateInsertionRunItem(item.id, {
        status: 'queued',
        errorCode: null,
        errorText: null,
        attemptCount: 0,
        verificationStatus: 'pending',
      });
    }

    try {
      const result = await processItem(item, run, profile, agentBaseUrl);

      if (result.status === 'verified') {
        completed++;
        verified++;
      } else if (result.status === 'inserted') {
        completed++;
      } else if (result.status === 'skipped') {
        skipped++;
      } else if (result.status === 'failed' || result.status === 'fallback_used') {
        if (result.status === 'failed') {
          failed++;
          failedFieldIds.push(item.fieldId);
        } else {
          completed++;
        }
      }

      if (result.verificationStatus === 'mismatch') {
        mismatchFieldIds.push(item.fieldId);
      }

      updateInsertionRun(runId, {
        completedFields: completed,
        failedFields: failed,
        skippedFields: skipped,
        verifiedFields: verified,
      });
    } catch (err) {
      failed++;
      failedFieldIds.push(item.fieldId);
      updateInsertionRunItem(item.id, {
        status: 'failed',
        errorCode: 'unknown',
        errorText: err.message,
        completedAt: new Date().toISOString(),
      });
    }
  }

  const finalItems = getInsertionRunItems(runId);
  const rollbackCount = finalItems.filter(e => e.rollbackStatus === 'restored').length;
  const fallbackUsedCount = finalItems.filter(e => e.fallbackUsed).length;

  const durationMs = Date.now() - new Date(run.startedAt || run.createdAt).getTime();
  let readinessSignal = 'ready';
  if (failed > 0 && completed === 0) readinessSignal = 'failed';
  else if (failed > 0 || mismatchFieldIds.length > 0) readinessSignal = 'needs_review';
  else if (skipped > allItems.length * 0.3) readinessSignal = 'incomplete';

  const summary = {
    totalFields: allItems.length,
    inserted: completed,
    verified,
    failed,
    skipped,
    fallbackUsed: fallbackUsedCount,
    rollbackFields: rollbackCount,
    durationMs,
    failedFieldIds,
    mismatchFieldIds,
    readinessSignal,
    resumed: true,
    resumedItemCount: itemsToProcess.length,
  };

  const replayPackage = buildInsertionReplayPackage({ run, items: finalItems });

  const finalStatus = failed === 0 && skipped === 0 ? 'completed'
    : failed === allItems.length ? 'failed'
    : 'partial';

  updateInsertionRun(runId, {
    status: finalStatus,
    completedFields: completed,
    failedFields: failed,
    skippedFields: skipped,
    verifiedFields: verified,
    rollbackFields: rollbackCount,
    completedAt: new Date().toISOString(),
    durationMs,
    summaryJson: summary,
    replayPackageJson: replayPackage,
  });

  return getInsertionRun(runId);
}

export function getInsertionReplayPackage(runId) {
  const run = getInsertionRun(runId);
  if (!run) return null;
  if (run.replayPackage && Array.isArray(run.replayPackage.items)) return run.replayPackage;
  return buildInsertionReplayPackage({ run, items: getInsertionRunItems(runId) });
}

/**
 * Check agent health.
 * @param {string} agentBaseUrl
 * @returns {Promise<boolean>}
 */
async function checkAgentHealth(agentBaseUrl) {
  try {
    const response = await fetch(`${agentBaseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ── Data Gathering ────────────────────────────────────────────────────────────

/**
 * Gather approved/final texts from generated_sections for a case.
 * Priority: final_text > reviewed_text > draft_text (only if approved)
 *
 * @param {string} caseId
 * @param {string} formType
 * @param {string} [generationRunId]
 * @returns {Map<string, string>} fieldId → text
 */
function gatherFieldTexts(caseId, formType, generationRunId = null) {
  return getFormDraftTextMap({ caseId, formType, generationRunId });
}

/**
 * Evaluate QC gate for insertion without creating a run record.
 *
 * @param {Object} params
 * @param {string} params.caseId
 * @param {string|null} [params.generationRunId]
 * @param {Object} [params.config]
 * @returns {import('./types.js').QCGateResult}
 */
export function evaluateInsertionQcGate({
  caseId,
  generationRunId = null,
  config = {},
}) {
  const mergedConfig = {
    requireQcRun: false,
    requireFreshQcForGeneration: true,
    ...config,
  };
  return checkQcGate(caseId, generationRunId, mergedConfig);
}

/**
 * Check QC gate for a case.
 * Returns whether insertion should proceed based on QC findings.
 *
 * @param {string} caseId
 * @param {Object} config
 * @returns {import('./types.js').QCGateResult}
 */
function checkQcGate(caseId, generationRunId, config) {
  const db = getDb();
  const requireQcRun = !!config.requireQcRun;
  const requireFreshQcForGeneration = config.requireFreshQcForGeneration !== false;

  // Prefer a completed QC run bound to the same generation run.
  // This prevents insertion from relying on stale QC from an older draft.
  let qcRun = null;
  try {
    if (generationRunId && requireFreshQcForGeneration) {
      qcRun = db.prepare(`
        SELECT *
        FROM qc_runs
        WHERE case_id = ?
          AND generation_run_id = ?
          AND status IN ('complete', 'completed', 'partial_complete')
        ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC
        LIMIT 1
      `).get(caseId, generationRunId);
    } else {
      qcRun = db.prepare(`
        SELECT *
        FROM qc_runs
        WHERE case_id = ?
          AND status IN ('complete', 'completed', 'partial_complete')
        ORDER BY COALESCE(completed_at, created_at) DESC, created_at DESC
        LIMIT 1
      `).get(caseId);
    }
  } catch {
    // QC tables may not exist yet
  }

  if (!qcRun) {
    if (generationRunId && requireFreshQcForGeneration) {
      return {
        passed: false,
        qcRunId: null,
        blockerCount: 0,
        highCount: 0,
        blockerMessages: [
          `No completed QC run found for generation run ${generationRunId}. Run QC before insertion.`,
        ],
        highMessages: [],
        recommendation: 'blocked',
        reason: 'missing_fresh_generation_qc',
        overrideAllowed: false,
      };
    }

    if (requireQcRun) {
      return {
        passed: false,
        qcRunId: null,
        blockerCount: 0,
        highCount: 0,
        blockerMessages: ['No completed QC run found. Run QC before insertion.'],
        highMessages: [],
        recommendation: 'blocked',
        reason: 'missing_qc_run',
        overrideAllowed: false,
      };
    }

    return {
      passed: true,
      qcRunId: null,
      blockerCount: 0,
      highCount: 0,
      blockerMessages: [],
      highMessages: [],
      recommendation: 'proceed',
      reason: 'no_qc_run',
      overrideAllowed: true,
    };
  }

  // Count blocker and high findings
  let blockerFindings = [];
  let highFindings = [];
  try {
    blockerFindings = db.prepare(
      "SELECT * FROM qc_findings WHERE qc_run_id = ? AND severity = 'blocker' AND status = 'open'"
    ).all(qcRun.id);

    highFindings = db.prepare(
      "SELECT * FROM qc_findings WHERE qc_run_id = ? AND severity = 'high' AND status = 'open'"
    ).all(qcRun.id);
  } catch {
    // QC tables may not exist
  }

  const blockerCount = blockerFindings.length;
  const highCount = highFindings.length;

  let recommendation = 'proceed';
  let passed = true;

  if (blockerCount > 0) {
    recommendation = 'blocked';
    passed = false;
  } else if (highCount > 0) {
    recommendation = 'review_first';
    // High findings warn but don't block
    passed = true;
  }

  return {
    passed,
    qcRunId: qcRun.id,
    blockerCount,
    highCount,
    blockerMessages: blockerFindings.map(f => f.brief_message || f.message || 'Blocker finding'),
    highMessages: highFindings.map(f => f.brief_message || f.message || 'High finding'),
    recommendation,
    reason: blockerCount > 0 ? 'blocker_findings' : (highCount > 0 ? 'high_findings' : 'clean'),
    overrideAllowed: blockerCount > 0,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getDefaultAgentUrl(targetSoftware) {
  return targetSoftware === 'aci'
    ? 'http://localhost:5180'
    : 'http://localhost:5181';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

