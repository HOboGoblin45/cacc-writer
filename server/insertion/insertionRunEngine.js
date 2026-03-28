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
  getActiveProfile, getInsertionRun,
} from './insertionRepo.js';
import { resolveMapping, resolveAllMappings, inferTargetSoftware } from './destinationMapper.js';
import { formatForDestination } from './formatters/index.js';
import { verifyInsertion } from './verificationEngine.js';
import { decideFallback, copyToClipboard } from './fallbackHandler.js';
import { getFormDraftTextMap } from './formDraftModel.js';
import { callAgentInsert as callLiveAgentInsert } from './agentClient.js';

const MIN_AGENT_TIMEOUT_MS = {
  aci: 30000,
  real_quantum: 15000,
};

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
    forceReinsert: false,
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
  const qcGate = checkQcGate(caseId, mergedConfig, generationRunId);

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
  if (!run.qcGatePassed && !run.config.skipQcBlockers) {
    updateInsertionRun(runId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      summaryJson: { error: 'QC gate blocked — blocker findings exist', blockerCount: run.qcBlockerCount },
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

  // Build summary
  const durationMs = Date.now() - new Date(run.startedAt || run.createdAt).getTime();
  const totalProcessed = completed + failed + skipped;
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
    fallbackUsed: items.filter(i => i.fallbackUsed).length,
    durationMs,
    failedFieldIds,
    mismatchFieldIds,
    readinessSignal,
  };

  const finalStatus = failed === 0 && skipped === 0 ? 'completed'
    : failed === items.length ? 'failed'
    : 'partial';

  updateInsertionRun(runId, {
    status: finalStatus,
    completedFields: completed,
    failedFields: failed,
    skippedFields: skipped,
    verifiedFields: verified,
    completedAt: new Date().toISOString(),
    durationMs,
    summaryJson: summary,
  });

  return getInsertionRun(runId);
}

// ── Item Processing ───────────────────────────────────────────────────────────

/**
 * Process a single insertion item through the full lifecycle.
 *
 * @param {Object} item - Insertion run item
 * @param {Object} run - Parent insertion run
 * @param {Object} profile - Destination profile
 * @param {string} agentBaseUrl
 * @returns {Promise<Object>} Updated item state
 */
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
      formattedText: item.formattedText || '',
      preinsertRaw: item.preinsertRaw || undefined,
      verificationRaw: item.verificationRaw || undefined,
      rollbackStatus: item.rollbackStatus || undefined,
      errorCode: item.errorCode || undefined,
      errorText: item.errorText || undefined,
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

export function getInsertionReplayPackage(runId) {
  const run = getInsertionRun(runId);
  if (!run) return null;
  if (run.replayPackage && Array.isArray(run.replayPackage.items)) return run.replayPackage;
  return buildInsertionReplayPackage({ run, items: getInsertionRunItems(runId) });
}

async function processItem(item, run, profile, agentBaseUrl) {
  const startTime = Date.now();
  const agentTimeout = getAgentTimeoutMs(item.targetSoftware, profile?.config?.timeout);

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
    updateInsertionRunItem(item.id, {
      status: 'skipped',
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
      errorText: 'Dry run — insertion skipped',
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    });
    return { status: 'skipped', verificationStatus: 'skipped' };
  }

  // 4. Insert via agent
  updateInsertionRunItem(item.id, { status: 'inserting' });

  let insertResult;
  let attemptCount = 0;
  let lastError = null;

  while (attemptCount < (item.maxAttempts || 3)) {
    attemptCount++;
    try {
      insertResult = await callLiveAgentInsert({
        fieldId: mapping.agentFieldKey || item.fieldId,
        text: formatResult.formattedText,
        formType: item.formType,
        section: mapping.agentSection || null,
        agentBaseUrl,
        timeout: agentTimeout,
      });

      if (insertResult.success) break;

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
    await sleep(1000 * attemptCount);
  }

  // Insertion succeeded
  updateInsertionRunItem(item.id, {
    status: 'inserted',
    attemptCount,
    agentResponseJson: insertResult || {},
  });

  if (insertResult?.verified === true) {
    updateInsertionRunItem(item.id, {
      status: 'verified',
      verificationStatus: 'passed',
      verificationRaw: null,
      verificationNormalized: null,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    });
    return { status: 'verified', verificationStatus: 'passed' };
  }

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
      section: mapping.agentSection || null,
      verificationMode: mapping.verificationMode,
      targetRect: insertResult?.diagnostics?.tx32_rect || null,
      timeout: agentTimeout,
    });

    verificationStatus = verResult.status;

    updateInsertionRunItem(item.id, {
      verificationStatus: verResult.status,
      verificationRaw: verResult.rawValue,
      verificationNormalized: verResult.normalizedValue,
    });

    if (verResult.status === 'passed') {
      updateInsertionRunItem(item.id, {
        status: 'verified',
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      });
      return { status: 'verified', verificationStatus: 'passed' };
    }
  }

  // Mark as inserted (verification skipped or not passed but insertion succeeded)
  updateInsertionRunItem(item.id, {
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  });

  return { status: 'inserted', verificationStatus };
}

// ── Agent Communication ───────────────────────────────────────────────────────

/**
 * Call the agent's /insert endpoint.
 *
 * @param {string} fieldKey - Agent field key
 * @param {string} text - Formatted text to insert
 * @param {'aci' | 'real_quantum'} targetSoftware
 * @param {string} agentBaseUrl
 * @param {number} timeout
 * @returns {Promise<Object>}
 */
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

export function evaluateInsertionQcGate({
  caseId,
  generationRunId = null,
  config = {},
}) {
  return checkQcGate(caseId, config, generationRunId);
}

/**
 * Check QC gate for a case.
 * Returns whether insertion should proceed based on QC findings.
 *
 * @param {string} caseId
 * @param {Object} config
 * @returns {import('./types.js').QCGateResult}
 */
function checkQcGate(caseId, config, generationRunId = null) {
  const db = getDb();

  // If a generationRunId is provided, require a fresh QC run linked to it
  if (generationRunId) {
    let freshQcRun = null;
    try {
      freshQcRun = db.prepare(
        "SELECT * FROM qc_runs WHERE case_id = ? AND generation_run_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(caseId, generationRunId);
    } catch {
      // Column may not exist yet; fall through to general check
    }
    if (!freshQcRun) {
      return {
        passed: false,
        qcRunId: null,
        blockerCount: 0,
        highCount: 0,
        blockerMessages: [],
        highMessages: [],
        recommendation: 'blocked',
        reason: 'missing_fresh_generation_qc',
        overrideAllowed: false,
      };
    }
  }

  // Find the latest QC run for this case
  let qcRun = null;
  try {
    qcRun = db.prepare(
      'SELECT * FROM qc_runs WHERE case_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(caseId);
  } catch {
    // QC tables may not exist yet
  }

  if (!qcRun) {
    // If requireQcRun is set, treat missing QC run as a blocker
    if (config && config.requireQcRun) {
      return {
        passed: false,
        qcRunId: null,
        blockerCount: 0,
        highCount: 0,
        blockerMessages: [],
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
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getDefaultAgentUrl(targetSoftware) {
  return targetSoftware === 'aci'
    ? 'http://localhost:5180'
    : 'http://localhost:5181';
}

export function getAgentTimeoutMs(targetSoftware, configuredTimeout = null) {
  const numericTimeout = Number(configuredTimeout);
  const baseTimeout = Number.isFinite(numericTimeout) && numericTimeout > 0
    ? numericTimeout
    : 15000;
  return Math.max(baseTimeout, MIN_AGENT_TIMEOUT_MS[targetSoftware] || 15000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
