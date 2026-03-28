/**
 * server/services/reportQueueService.js
 * ----------------------------------------
 * File-backed report queue for processing multiple cases back-to-back.
 *
 * Accepts an array of caseIds, processes them sequentially (one full
 * orchestrator run per case), and tracks per-case status. Failed sections
 * within a report are auto-retried before moving to the next case.
 *
 * Design decisions:
 *   - In-memory queue with file-backed persistence — survives server restarts
 *   - No Redis/Bull dependency — fits single-server desktop deployment
 *   - One report at a time to avoid overwhelming the OpenAI API
 *   - Auto-retry: if a run returns partial_complete, retry failed sections once
 *   - Queue is bounded to 50 pending jobs to prevent abuse
 *   - State is persisted to data/queue_state.json on every mutation
 *   - On startup, previously-running jobs are marked 'failed' (crash recovery)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import log from '../logger.js';
import {
  runFullDraftOrchestrator,
  getRunStatus,
} from '../orchestrator/generationOrchestrator.js';
import { evaluatePreDraftGate } from '../factIntegrity/preDraftGate.js';
import { buildFactDecisionQueue } from '../factIntegrity/factDecisionQueue.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_QUEUE_SIZE   = 50;
const MAX_SECTION_RETRY = 1;  // retry failed sections once per report
const ALLOW_FORCE_GATE_BYPASS = ['1', 'true', 'yes', 'on']
  .includes(String(process.env.CACC_ALLOW_FORCE_GATE_BYPASS || '').trim().toLowerCase());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_STATE_FILE = process.env.CACC_QUEUE_STATE_FILE
  ? path.resolve(process.env.CACC_QUEUE_STATE_FILE)
  : path.join(__dirname, '..', '..', 'data', 'queue_state.json');

// ── Persistence helpers ──────────────────────────────────────────────────────

function persistState() {
  try {
    const state = {
      queue: _queue,
      batches: Object.fromEntries(_batches),
    };
    const dir = path.dirname(QUEUE_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUEUE_STATE_FILE + '.tmp', JSON.stringify(state, null, 2));
    fs.renameSync(QUEUE_STATE_FILE + '.tmp', QUEUE_STATE_FILE);
  } catch (e) {
    log.warn('queue:persist-failed', { error: e.message });
  }
}

function loadState() {
  try {
    if (!fs.existsSync(QUEUE_STATE_FILE)) return;
    const raw = fs.readFileSync(QUEUE_STATE_FILE, 'utf8');
    const state = JSON.parse(raw);
    if (!state?.queue || !Array.isArray(state.queue)) return;

    // Restore queue
    for (const job of state.queue) {
      // Crash recovery: any job that was 'running' when server died → mark 'failed'
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'Server restarted while job was running';
        job.completedAt = new Date().toISOString();
      }
      _queue.push(job);
      _jobIndex.set(job.jobId, job);
    }

    // Restore batches
    if (state.batches && typeof state.batches === 'object') {
      for (const [batchId, jobIdsJson] of Object.entries(state.batches)) {
        _batches.set(batchId, jobIdsJson);
      }
    }

    const recovered = _queue.filter(j => j.status === 'queued').length;
    const crashed = state.queue.filter(j => j.status === 'running').length;
    if (_queue.length > 0) {
      log.info('queue:restored', { total: _queue.length, queued: recovered, crashRecovered: crashed });
    }
  } catch (e) {
    log.warn('queue:restore-failed', { error: e.message });
  }
}

// ── Queue state ───────────────────────────────────────────────────────────────

/**
 * @typedef {'queued'|'running'|'complete'|'partial_complete'|'failed'|'cancelled'} QueueJobStatus
 *
 * @typedef {Object} QueueJob
 * @property {string} jobId
 * @property {string} caseId
 * @property {string} [formType]
 * @property {QueueJobStatus} status
 * @property {string|null} runId        — orchestrator runId once started
 * @property {string|null} error
 * @property {number|null} durationMs
 * @property {string} queuedAt
 * @property {string|null} startedAt
 * @property {string|null} completedAt
 * @property {number} retryAttempt
 */

/** @type {QueueJob[]} */
const _queue = [];

/** @type {Map<string, QueueJob>} jobId → QueueJob */
const _jobIndex = new Map();

/** @type {Map<string, string>} batchId → array of jobIds (JSON) */
const _batches = new Map();

let _processing = false;

// ── Load persisted state on startup ──────────────────────────────────────────
loadState();

// Resume processing any queued jobs from prior session
if (_queue.some(j => j.status === 'queued') && !_processing) {
  processQueue();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueue one or more cases for report generation.
 *
 * @param {Object} params
 * @param {Array<{caseId: string, formType?: string}>} params.cases
 * @returns {{ batchId: string, jobs: QueueJob[] }}
 */
export function enqueueReports({ cases }) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('cases array is required and must not be empty');
  }

  const pendingCount = _queue.filter(j => j.status === 'queued' || j.status === 'running').length;
  if (pendingCount + cases.length > MAX_QUEUE_SIZE) {
    throw new Error(`Queue limit reached (${MAX_QUEUE_SIZE}). ${pendingCount} jobs already pending.`);
  }

  const batchId = uuidv4();
  const jobs = [];

  for (const { caseId, formType, forceGateBypass } of cases) {
    if (!caseId) continue;

    const job = {
      jobId:        uuidv4(),
      batchId,
      caseId,
      formType:     formType || null,
      status:       'queued',
      runId:        null,
      error:        null,
      errorCode:    null,
      durationMs:   null,
      queuedAt:     new Date().toISOString(),
      startedAt:    null,
      completedAt:  null,
      retryAttempt: 0,
      forceGateBypass: Boolean(forceGateBypass),
      preDraftGate: null,
      sectionsTotal:     null,
      sectionsCompleted: null,
      sectionsFailed:    null,
    };

    _queue.push(job);
    _jobIndex.set(job.jobId, job);
    jobs.push(job);
  }

  _batches.set(batchId, JSON.stringify(jobs.map(j => j.jobId)));

  log.info('queue:enqueued', {
    batchId,
    count:      jobs.length,
    caseIds:    jobs.map(j => j.caseId),
    queueDepth: _queue.filter(j => j.status === 'queued').length,
  });

  persistState();

  // Kick off processing if not already running
  if (!_processing) {
    processQueue();
  }

  return { batchId, jobs };
}

/**
 * Get the status of the entire queue.
 *
 * @returns {{ processing: boolean, queued: number, running: number, completed: number, failed: number, jobs: QueueJob[] }}
 */
export function getQueueStatus() {
  const queued    = _queue.filter(j => j.status === 'queued').length;
  const running   = _queue.filter(j => j.status === 'running').length;
  const completed = _queue.filter(j => j.status === 'complete' || j.status === 'partial_complete').length;
  const failed    = _queue.filter(j => j.status === 'failed').length;

  return {
    processing: _processing,
    queued,
    running,
    completed,
    failed,
    total:      _queue.length,
    jobs:       _queue.map(summarizeJob),
  };
}

/**
 * Get the status of a specific batch.
 *
 * @param {string} batchId
 * @returns {{ batchId: string, jobs: QueueJob[] } | null}
 */
export function getBatchStatus(batchId) {
  const jobIdsJson = _batches.get(batchId);
  if (!jobIdsJson) return null;

  const jobIds = JSON.parse(jobIdsJson);
  const jobs = jobIds.map(id => _jobIndex.get(id)).filter(Boolean);

  const queued    = jobs.filter(j => j.status === 'queued').length;
  const running   = jobs.filter(j => j.status === 'running').length;
  const completed = jobs.filter(j => j.status === 'complete' || j.status === 'partial_complete').length;
  const failed    = jobs.filter(j => j.status === 'failed').length;

  return {
    batchId,
    queued,
    running,
    completed,
    failed,
    total: jobs.length,
    jobs:  jobs.map(summarizeJob),
  };
}

/**
 * Get the status of a single job.
 *
 * @param {string} jobId
 * @returns {QueueJob | null}
 */
export function getJobStatus(jobId) {
  const job = _jobIndex.get(jobId);
  return job ? summarizeJob(job) : null;
}

/**
 * Cancel all queued (not yet running) jobs.
 *
 * @returns {number} number of cancelled jobs
 */
export function cancelQueued() {
  let cancelled = 0;
  for (const job of _queue) {
    if (job.status === 'queued') {
      job.status      = 'cancelled';
      job.completedAt = new Date().toISOString();
      cancelled++;
    }
  }
  persistState();
  log.info('queue:cancelled', { count: cancelled });
  return cancelled;
}

/**
 * Clear completed/failed jobs from the queue (housekeeping).
 *
 * @returns {number} number of cleared jobs
 */
export function clearCompleted() {
  const before = _queue.length;
  const toRemove = _queue.filter(j =>
    j.status === 'complete' || j.status === 'partial_complete' ||
    j.status === 'failed' || j.status === 'cancelled'
  );
  for (const job of toRemove) {
    const idx = _queue.indexOf(job);
    if (idx >= 0) _queue.splice(idx, 1);
    _jobIndex.delete(job.jobId);
  }
  persistState();
  return before - _queue.length;
}

// ── Internal processing loop ──────────────────────────────────────────────────

async function processQueue() {
  if (_processing) return;
  _processing = true;

  log.info('queue:processing-start', { depth: _queue.filter(j => j.status === 'queued').length });

  while (true) {
    const next = _queue.find(j => j.status === 'queued');
    if (!next) break;

    await processJob(next);
  }

  _processing = false;
  log.info('queue:processing-idle', { total: _queue.length });
}

async function processJob(job) {
  const t0 = Date.now();
  job.status    = 'running';
  job.startedAt = new Date().toISOString();
  job.errorCode = null;
  job.preDraftGate = null;

  persistState();
  log.info('queue:job-start', { jobId: job.jobId, caseId: job.caseId, formType: job.formType });

  try {
    const gateCheck = evaluateQueuePreDraftGate(job);
    if (!gateCheck.ok) {
      job.status = 'failed';
      job.errorCode = gateCheck.errorCode;
      job.error = gateCheck.error;
      job.preDraftGate = gateCheck.preDraftGate || null;
      log.info('queue:job-blocked', {
        jobId: job.jobId,
        caseId: job.caseId,
        errorCode: gateCheck.errorCode,
        gateSummary: gateCheck.preDraftGate?.summary || null,
      });
    } else {
      const result = await runFullDraftOrchestrator({
        caseId:   job.caseId,
        formType: job.formType || undefined,
        options: gateCheck.options || {},
      });

      job.runId = result.runId;

      if (result.ok) {
        // Check for partial completion
        const status = getRunStatus(result.runId);
        job.sectionsTotal     = status?.sectionsTotal     || null;
        job.sectionsCompleted = status?.sectionsCompleted || null;
        job.sectionsFailed    = status?.sectionsFailed    || null;

        if (status?.sectionsFailed > 0 && job.retryAttempt < MAX_SECTION_RETRY) {
          // Auto-retry: re-run the orchestrator for partial failures
          job.retryAttempt++;
          log.info('queue:auto-retry', {
            jobId:      job.jobId,
            caseId:     job.caseId,
            failedSections: status.sectionsFailed,
            attempt:    job.retryAttempt,
          });

          const retryResult = await runFullDraftOrchestrator({
            caseId:   job.caseId,
            formType: job.formType || undefined,
            options: gateCheck.options || {},
          });

          job.runId = retryResult.runId;
          const retryStatus = getRunStatus(retryResult.runId);
          job.sectionsTotal     = retryStatus?.sectionsTotal     || job.sectionsTotal;
          job.sectionsCompleted = retryStatus?.sectionsCompleted || job.sectionsCompleted;
          job.sectionsFailed    = retryStatus?.sectionsFailed    || 0;

          job.status = retryStatus?.sectionsFailed > 0 ? 'partial_complete' : 'complete';
        } else {
          job.status = status?.sectionsFailed > 0 ? 'partial_complete' : 'complete';
        }
      } else {
        job.status = 'failed';
        job.errorCode = 'ORCHESTRATOR_RUN_FAILED';
        job.error = result.error || 'Orchestrator returned ok=false';
      }
    }
  } catch (err) {
    job.status = 'failed';
    job.errorCode = 'QUEUE_JOB_EXCEPTION';
    job.error  = err.message;
    log.error('queue:job-failed', { jobId: job.jobId, caseId: job.caseId, error: err.message });
  }

  job.durationMs   = Date.now() - t0;
  job.completedAt  = new Date().toISOString();

  persistState();
  log.info('queue:job-done', {
    jobId:      job.jobId,
    caseId:     job.caseId,
    status:     job.status,
    durationMs: job.durationMs,
    runId:      job.runId,
    errorCode:  job.errorCode,
    sections:   { total: job.sectionsTotal, completed: job.sectionsCompleted, failed: job.sectionsFailed },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function evaluateQueuePreDraftGate(job) {
  const forceGateBypass = Boolean(job?.forceGateBypass);

  if (forceGateBypass && !ALLOW_FORCE_GATE_BYPASS) {
    return {
      ok: false,
      errorCode: 'PRE_DRAFT_GATE_BYPASS_DISABLED',
      error: 'forceGateBypass is disabled in this environment',
      preDraftGate: null,
    };
  }

  if (forceGateBypass) {
    return { ok: true, options: { forceGateBypass: true } };
  }

  const gate = evaluatePreDraftGate({
    caseId: job.caseId,
    formType: job.formType || null,
  });
  if (!gate) {
    return {
      ok: false,
      errorCode: 'CASE_NOT_FOUND',
      error: `Case not found: ${job.caseId}`,
      preDraftGate: null,
    };
  }
  if (gate.ok) {
    return { ok: true, options: {} };
  }

  const queue = buildFactDecisionQueue(job.caseId);
  return {
    ok: false,
    errorCode: 'PRE_DRAFT_GATE_BLOCKED',
    error: 'Pre-draft integrity gate blocked queued generation',
    preDraftGate: {
      ok: false,
      summary: gate.summary || null,
      blockerCount: Array.isArray(gate.blockers) ? gate.blockers.length : 0,
      warningCount: Array.isArray(gate.warnings) ? gate.warnings.length : 0,
      factReviewQueuePath: `/api/cases/${job.caseId}/fact-review-queue`,
      factReviewQueueSummary: queue?.summary || null,
    },
  };
}

function summarizeJob(job) {
  return {
    jobId:             job.jobId,
    batchId:           job.batchId,
    caseId:            job.caseId,
    formType:          job.formType,
    status:            job.status,
    runId:             job.runId,
    error:             job.error,
    errorCode:         job.errorCode || null,
    preDraftGate:      job.preDraftGate || null,
    durationMs:        job.durationMs,
    queuedAt:          job.queuedAt,
    startedAt:         job.startedAt,
    completedAt:       job.completedAt,
    retryAttempt:      job.retryAttempt,
    forceGateBypass:   Boolean(job.forceGateBypass),
    sectionsTotal:     job.sectionsTotal,
    sectionsCompleted: job.sectionsCompleted,
    sectionsFailed:    job.sectionsFailed,
  };
}
