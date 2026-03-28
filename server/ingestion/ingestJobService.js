/**
 * server/ingestion/ingestJobService.js
 * -------------------------------------
 * Phase C (OS-C1): document ingestion job orchestration with per-step state.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';

const DEFAULT_MAX_RETRIES = 2;
const ALLOWED_JOB_STATUSES = new Set(['pending', 'running', 'completed', 'failed', 'partial', 'cancelled']);
const ALLOWED_STEP_STATUSES = new Set(['pending', 'running', 'completed', 'failed', 'retrying', 'skipped']);

function asText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseJSON(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function clampRetries(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_RETRIES;
  if (n < 0) return 0;
  if (n > 10) return 10;
  return Math.floor(n);
}

function normalizeStepName(step) {
  return asText(step).toLowerCase();
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object') return null;
  const id = asText(action.id);
  if (!id) return null;
  return {
    id,
    label: asText(action.label) || id,
    hint: asText(action.hint),
  };
}

function normalizeActionList(actions = []) {
  if (!Array.isArray(actions)) return [];
  return actions.map(normalizeAction).filter(Boolean);
}

function hydrateRow(row) {
  if (!row) return null;
  const steps = parseJSON(row.steps_json, {});
  const recoverableActions = parseJSON(row.recoverable_actions_json, []);
  return {
    id: row.id,
    caseId: row.case_id,
    documentId: row.document_id || null,
    originalFilename: row.original_filename || '',
    status: row.status,
    currentStep: row.current_step || null,
    retryCount: Number(row.retry_count || 0),
    maxRetries: Number(row.max_retries || DEFAULT_MAX_RETRIES),
    steps,
    errorText: row.error_text || null,
    recoverableActions: Array.isArray(recoverableActions) ? recoverableActions : [],
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    updatedAt: row.updated_at || null,
    createdAt: row.created_at || null,
  };
}

function readJobRow(jobId) {
  return getDb().prepare(`
    SELECT *
      FROM document_ingest_jobs
     WHERE id = ?
     LIMIT 1
  `).get(jobId);
}

function updateJobRow(jobId, updates = {}) {
  const allowed = {
    status: 'status',
    currentStep: 'current_step',
    retryCount: 'retry_count',
    maxRetries: 'max_retries',
    stepsJson: 'steps_json',
    errorText: 'error_text',
    recoverableActionsJson: 'recoverable_actions_json',
    documentId: 'document_id',
    completedAt: 'completed_at',
    startedAt: 'started_at',
  };

  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
    sets.push(`${column} = ?`);
    values.push(updates[key]);
  }
  if (!sets.length) return;

  sets.push(`updated_at = datetime('now')`);
  values.push(jobId);

  getDb().prepare(`
    UPDATE document_ingest_jobs
       SET ${sets.join(', ')}
     WHERE id = ?
  `).run(...values);
}

function mutateStep(job, step, mutate) {
  const stepName = normalizeStepName(step);
  if (!stepName) return { steps: job.steps || {} };
  const steps = { ...(job.steps || {}) };
  const existing = steps[stepName] && typeof steps[stepName] === 'object' ? { ...steps[stepName] } : {};
  steps[stepName] = mutate(existing);
  return { steps, stepName };
}

function getFailedStepNames(steps = {}) {
  const names = [];
  for (const [step, state] of Object.entries(steps || {})) {
    if (state?.status === 'failed') names.push(step);
  }
  return names;
}

function finalizeStatus(steps = {}) {
  const states = Object.values(steps || {});
  if (!states.length) return 'completed';
  const hasFailed = states.some(state => state?.status === 'failed');
  if (!hasFailed) return 'completed';
  const hasCompleted = states.some(state => state?.status === 'completed');
  return hasCompleted ? 'partial' : 'failed';
}

export function createDocumentIngestJob({
  caseId,
  originalFilename,
  documentId = null,
  maxRetries = DEFAULT_MAX_RETRIES,
}) {
  const id = uuidv4();
  const safeCaseId = asText(caseId);
  const safeFilename = asText(originalFilename) || 'document';
  const retries = clampRetries(maxRetries);

  getDb().prepare(`
    INSERT INTO document_ingest_jobs (
      id, case_id, document_id, original_filename, status, current_step,
      retry_count, max_retries, steps_json, recoverable_actions_json,
      started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'running', 'upload', 0, ?, '{}', '[]', datetime('now'), datetime('now'), datetime('now'))
  `).run(id, safeCaseId, documentId, safeFilename, retries);

  return getDocumentIngestJob(id);
}

export function getDocumentIngestJob(jobId) {
  return hydrateRow(readJobRow(jobId));
}

export function listCaseDocumentIngestJobs(caseId, limit = 50) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = getDb().prepare(`
    SELECT *
      FROM document_ingest_jobs
     WHERE case_id = ?
     ORDER BY created_at DESC
     LIMIT ?
  `).all(caseId, safeLimit);
  return rows.map(hydrateRow);
}

export function attachDocumentToIngestJob(jobId, documentId) {
  updateJobRow(jobId, { documentId: asText(documentId) || null });
  return getDocumentIngestJob(jobId);
}

export function startDocumentIngestStep(jobId, step) {
  const job = getDocumentIngestJob(jobId);
  if (!job) return null;
  const now = new Date().toISOString();
  const { steps, stepName } = mutateStep(job, step, (existing) => ({
    ...existing,
    status: 'running',
    attempts: Number(existing.attempts || 0) + 1,
    startedAt: existing.startedAt || now,
    lastAttemptAt: now,
    completedAt: null,
  }));
  updateJobRow(jobId, {
    currentStep: stepName,
    status: 'running',
    stepsJson: JSON.stringify(steps),
  });
  return getDocumentIngestJob(jobId);
}

export function completeDocumentIngestStep(jobId, step, meta = null) {
  const job = getDocumentIngestJob(jobId);
  if (!job) return null;
  const now = new Date().toISOString();
  const { steps, stepName } = mutateStep(job, step, (existing) => ({
    ...existing,
    status: 'completed',
    completedAt: now,
    error: null,
    meta: meta && typeof meta === 'object'
      ? { ...(existing.meta || {}), ...meta }
      : (existing.meta || {}),
  }));
  updateJobRow(jobId, {
    currentStep: stepName,
    stepsJson: JSON.stringify(steps),
    errorText: null,
  });
  return getDocumentIngestJob(jobId);
}

export function skipDocumentIngestStep(jobId, step, reason = '') {
  const job = getDocumentIngestJob(jobId);
  if (!job) return null;
  const now = new Date().toISOString();
  const { steps, stepName } = mutateStep(job, step, (existing) => ({
    ...existing,
    status: 'skipped',
    completedAt: now,
    skipReason: asText(reason) || existing.skipReason || '',
  }));
  updateJobRow(jobId, {
    currentStep: stepName,
    stepsJson: JSON.stringify(steps),
  });
  return getDocumentIngestJob(jobId);
}

export function markDocumentIngestStepRetrying(jobId, step, errorText = '') {
  const job = getDocumentIngestJob(jobId);
  if (!job) return null;
  const now = new Date().toISOString();
  const { steps } = mutateStep(job, step, (existing) => ({
    ...existing,
    status: 'retrying',
    lastError: asText(errorText),
    lastErrorAt: now,
  }));
  updateJobRow(jobId, {
    retryCount: Number(job.retryCount || 0) + 1,
    stepsJson: JSON.stringify(steps),
  });
  return getDocumentIngestJob(jobId);
}

export function failDocumentIngestStep(jobId, step, {
  errorText = '',
  recoverableActions = [],
  fatal = true,
} = {}) {
  const job = getDocumentIngestJob(jobId);
  if (!job) return null;
  const now = new Date().toISOString();
  const actions = normalizeActionList(recoverableActions);
  const { steps, stepName } = mutateStep(job, step, (existing) => ({
    ...existing,
    status: 'failed',
    completedAt: now,
    lastError: asText(errorText),
    lastErrorAt: now,
  }));

  updateJobRow(jobId, {
    currentStep: stepName,
    status: fatal ? 'failed' : (job.status || 'running'),
    errorText: asText(errorText) || job.errorText || null,
    recoverableActionsJson: JSON.stringify(actions),
    stepsJson: JSON.stringify(steps),
    completedAt: fatal ? now : null,
  });
  return getDocumentIngestJob(jobId);
}

export function setDocumentIngestJobStatus(jobId, {
  status,
  currentStep = null,
  errorText = null,
  recoverableActions = null,
  completed = false,
} = {}) {
  const safeStatus = asText(status).toLowerCase();
  if (!ALLOWED_JOB_STATUSES.has(safeStatus)) return getDocumentIngestJob(jobId);
  const updates = {
    status: safeStatus,
    currentStep,
  };
  if (errorText !== null) updates.errorText = asText(errorText) || null;
  if (recoverableActions !== null) {
    updates.recoverableActionsJson = JSON.stringify(normalizeActionList(recoverableActions));
  }
  if (completed) updates.completedAt = new Date().toISOString();
  updateJobRow(jobId, updates);
  return getDocumentIngestJob(jobId);
}

export function finalizeDocumentIngestJob(jobId) {
  const job = getDocumentIngestJob(jobId);
  if (!job) return null;
  const status = finalizeStatus(job.steps || {});
  const failedSteps = getFailedStepNames(job.steps || {});
  const next = setDocumentIngestJobStatus(jobId, {
    status,
    currentStep: failedSteps[0] || null,
    completed: true,
  });
  return next;
}

/**
 * Run one ingest step with retries and persisted step-state transitions.
 *
 * @param {string} jobId
 * @param {string} step
 * @param {object} opts
 * @param {number} [opts.maxAttempts]
 * @param {boolean} [opts.fatalOnFinalFailure]
 * @param {object[]} [opts.recoverableActionsOnFailure]
 * @param {(ctx:{attempt:number}) => Promise<any>} handler
 * @returns {Promise<{ok:boolean, result?:any, attempts:number, error?:Error}>}
 */
export async function runDocumentIngestStep(jobId, step, opts = {}, handler) {
  const maxAttempts = Math.max(1, Number(opts.maxAttempts || 1));
  const fatalOnFinalFailure = opts.fatalOnFinalFailure !== false;
  const recoverableActions = normalizeActionList(opts.recoverableActionsOnFailure || []);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    startDocumentIngestStep(jobId, step);
    try {
      const result = await handler({ attempt });
      const meta = result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'meta')
        ? result.meta
        : null;
      completeDocumentIngestStep(jobId, step, meta);
      return { ok: true, result, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        markDocumentIngestStepRetrying(jobId, step, err?.message || String(err));
        continue;
      }

      failDocumentIngestStep(jobId, step, {
        errorText: err?.message || String(err),
        recoverableActions,
        fatal: fatalOnFinalFailure,
      });

      if (fatalOnFinalFailure) throw err;
      return { ok: false, attempts: attempt, error: err };
    }
  }

  const error = lastError || new Error(`Step failed: ${step}`);
  if (fatalOnFinalFailure) throw error;
  return { ok: false, attempts: maxAttempts, error };
}

export function isDocumentIngestStepFailed(job, step) {
  const stepName = normalizeStepName(step);
  const status = job?.steps?.[stepName]?.status || '';
  return status === 'failed';
}

export function getDocumentIngestRetryState(job, step) {
  if (!job) {
    return {
      ok: false,
      reason: 'job_not_found',
      retryCount: 0,
      maxRetries: 0,
      remainingRetries: 0,
    };
  }

  const retryCount = Number(job.retryCount || 0);
  const maxRetries = Math.max(0, Number(job.maxRetries || 0));
  if (!isDocumentIngestStepFailed(job, step)) {
    return {
      ok: false,
      reason: 'step_not_failed',
      retryCount,
      maxRetries,
      remainingRetries: Math.max(0, maxRetries - retryCount),
    };
  }

  if (retryCount >= maxRetries) {
    return {
      ok: false,
      reason: 'retry_limit_reached',
      retryCount,
      maxRetries,
      remainingRetries: 0,
    };
  }

  return {
    ok: true,
    reason: null,
    retryCount,
    maxRetries,
    remainingRetries: Math.max(0, maxRetries - retryCount),
  };
}

export function isValidDocumentIngestStatus(status) {
  return ALLOWED_JOB_STATUSES.has(asText(status).toLowerCase());
}

export function isValidDocumentIngestStepStatus(status) {
  return ALLOWED_STEP_STATUSES.has(asText(status).toLowerCase());
}
