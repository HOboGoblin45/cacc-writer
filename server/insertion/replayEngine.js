/**
 * server/insertion/replayEngine.js
 * ----------------------------------
 * Priority 5: Replay engine for re-running failed/mismatched insertion items.
 *
 * Replays create a new insertion run linked to the original via originalRunId.
 * Reuses the processItem pipeline from insertionRunEngine.
 */

import {
  createInsertionRun, updateInsertionRun,
  createInsertionRunItems, getInsertionRunItems, updateInsertionRunItem,
  getActiveProfile, getInsertionRun,
} from './insertionRepo.js';
import { processItem } from './insertionRunEngine.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Re-run only failed/mismatched items from a previous insertion run.
 * Creates a new run linked to the original.
 *
 * @param {string} runId - Original run ID
 * @param {Object} [options]
 * @param {Object} [options.config] - Config overrides for the replay run
 * @returns {Promise<Object>} The completed replay run
 */
export async function executeReplay(runId, options = {}) {
  const originalRun = getInsertionRun(runId);
  if (!originalRun) throw new Error(`Original insertion run not found: ${runId}`);

  const originalItems = getInsertionRunItems(runId);

  // Filter to failed/mismatched items
  const replayableItems = originalItems.filter(item =>
    item.status === 'failed' ||
    item.verificationStatus === 'mismatch' ||
    item.fallbackUsed ||
    item.rollbackAttempted
  );

  if (replayableItems.length === 0) {
    throw new Error('No failed or mismatched items to replay');
  }

  const fieldIds = replayableItems.map(item => item.fieldId);
  return _executeReplayInternal(originalRun, replayableItems, fieldIds, options);
}

/**
 * Replay specific fields from a previous insertion run.
 *
 * @param {string} runId - Original run ID
 * @param {string[]} fieldIds - Specific field IDs to replay
 * @param {Object} [options]
 * @param {Object} [options.config] - Config overrides for the replay run
 * @returns {Promise<Object>} The completed replay run
 */
export async function executeSelectiveReplay(runId, fieldIds, options = {}) {
  const originalRun = getInsertionRun(runId);
  if (!originalRun) throw new Error(`Original insertion run not found: ${runId}`);

  if (!Array.isArray(fieldIds) || fieldIds.length === 0) {
    throw new Error('fieldIds must be a non-empty array');
  }

  const originalItems = getInsertionRunItems(runId);
  const fieldIdSet = new Set(fieldIds);
  const selectedItems = originalItems.filter(item => fieldIdSet.has(item.fieldId));

  if (selectedItems.length === 0) {
    throw new Error(`No items found matching the specified field IDs: ${fieldIds.join(', ')}`);
  }

  return _executeReplayInternal(originalRun, selectedItems, fieldIds, options);
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Internal replay execution that creates a new run and processes items.
 *
 * @param {Object} originalRun - Original insertion run
 * @param {Object[]} sourceItems - Items from the original run to replay
 * @param {string[]} fieldIds - Field IDs being replayed
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function _executeReplayInternal(originalRun, sourceItems, fieldIds, options = {}) {
  const mergedConfig = {
    ...originalRun.config,
    ...(options.config || {}),
    dryRun: false,
    fieldIds,
  };

  // Create a new replay run linked to the original
  const replayRun = createInsertionRun({
    caseId: originalRun.caseId,
    generationRunId: originalRun.generationRunId,
    formType: originalRun.formType,
    targetSoftware: originalRun.targetSoftware,
    config: mergedConfig,
    qcRunId: originalRun.qcRunId,
    qcBlockerCount: originalRun.qcBlockerCount,
    qcGatePassed: originalRun.qcGatePassed,
  });

  // Set replay lineage
  updateInsertionRun(replayRun.id, {
    originalRunId: originalRun.id,
    runType: 'replay',
  });

  // Create new items for the replay run, carrying over canonical text
  const itemParams = sourceItems.map((srcItem, idx) => ({
    insertionRunId: replayRun.id,
    caseId: srcItem.caseId,
    fieldId: srcItem.fieldId,
    formType: srcItem.formType,
    targetSoftware: srcItem.targetSoftware,
    destinationKey: srcItem.destinationKey,
    canonicalText: srcItem.canonicalText || '',
    maxAttempts: mergedConfig.maxRetries || srcItem.maxAttempts || 3,
    fallbackStrategy: srcItem.fallbackStrategy || mergedConfig.defaultFallback || 'retry_then_clipboard',
    sortOrder: idx,
  }));

  const itemCount = createInsertionRunItems(itemParams);
  updateInsertionRun(replayRun.id, { totalFields: itemCount });

  // Get the profile and agent URL
  const profile = getActiveProfile(replayRun.targetSoftware, replayRun.formType);
  const agentBaseUrl = profile?.baseUrl || getDefaultAgentUrl(replayRun.targetSoftware);

  // Check agent health
  const agentHealthy = await checkAgentHealth(agentBaseUrl);
  if (!agentHealthy) {
    updateInsertionRun(replayRun.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      summaryJson: { error: `Agent unreachable at ${agentBaseUrl}` },
    });
    return getInsertionRun(replayRun.id);
  }

  // Mark as running
  updateInsertionRun(replayRun.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  const run = getInsertionRun(replayRun.id);
  const items = getInsertionRunItems(replayRun.id);

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let verified = 0;
  const failedFieldIds = [];
  const mismatchFieldIds = [];

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

      updateInsertionRun(replayRun.id, {
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

  const finalItems = getInsertionRunItems(replayRun.id);
  const rollbackCount = finalItems.filter(e => e.rollbackStatus === 'restored').length;
  const fallbackUsedCount = finalItems.filter(e => e.fallbackUsed).length;
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
    isReplay: true,
    originalRunId: originalRun.id,
  };

  const finalStatus = failed === 0 && skipped === 0 ? 'completed'
    : failed === items.length ? 'failed'
    : 'partial';

  updateInsertionRun(replayRun.id, {
    status: finalStatus,
    completedFields: completed,
    failedFields: failed,
    skippedFields: skipped,
    verifiedFields: verified,
    rollbackFields: rollbackCount,
    completedAt: new Date().toISOString(),
    durationMs,
    summaryJson: summary,
  });

  return getInsertionRun(replayRun.id);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function getDefaultAgentUrl(targetSoftware) {
  return targetSoftware === 'aci'
    ? 'http://localhost:5180'
    : 'http://localhost:5181';
}

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
