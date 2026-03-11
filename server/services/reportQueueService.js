/**
 * server/services/reportQueueService.js
 * ----------------------------------------
 * In-memory report queue for processing multiple cases back-to-back.
 *
 * Accepts an array of caseIds, processes them sequentially (one full
 * orchestrator run per case), and tracks per-case status. Failed sections
 * within a report are auto-retried before moving to the next case.
 *
 * Design decisions:
 *   - In-memory queue (no Redis/Bull dependency) — fits single-server deployment
 *   - One report at a time to avoid overwhelming the OpenAI API
 *   - Auto-retry: if a run returns partial_complete, retry failed sections once
 *   - Queue is bounded to 50 pending jobs to prevent abuse
 *   - Queue state survives across requests but not server restarts
 */

import { v4 as uuidv4 } from 'uuid';
import log from '../logger.js';
import {
  runFullDraftOrchestrator,
  getRunStatus,
} from '../orchestrator/generationOrchestrator.js';
import { RUN_STATUS } from '../db/repositories/generationRepo.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_QUEUE_SIZE   = 50;
const MAX_SECTION_RETRY = 1;  // retry failed sections once per report

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

  for (const { caseId, formType } of cases) {
    if (!caseId) continue;

    const job = {
      jobId:        uuidv4(),
      batchId,
      caseId,
      formType:     formType || null,
      status:       'queued',
      runId:        null,
      error:        null,
      durationMs:   null,
      queuedAt:     new Date().toISOString(),
      startedAt:    null,
      completedAt:  null,
      retryAttempt: 0,
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

  log.info('queue:job-start', { jobId: job.jobId, caseId: job.caseId, formType: job.formType });

  try {
    const result = await runFullDraftOrchestrator({
      caseId:   job.caseId,
      formType: job.formType || undefined,
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
      job.error  = result.error || 'Orchestrator returned ok=false';
    }
  } catch (err) {
    job.status = 'failed';
    job.error  = err.message;
    log.error('queue:job-failed', { jobId: job.jobId, caseId: job.caseId, error: err.message });
  }

  job.durationMs   = Date.now() - t0;
  job.completedAt  = new Date().toISOString();

  log.info('queue:job-done', {
    jobId:      job.jobId,
    caseId:     job.caseId,
    status:     job.status,
    durationMs: job.durationMs,
    runId:      job.runId,
    sections:   { total: job.sectionsTotal, completed: job.sectionsCompleted, failed: job.sectionsFailed },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function summarizeJob(job) {
  return {
    jobId:             job.jobId,
    batchId:           job.batchId,
    caseId:            job.caseId,
    formType:          job.formType,
    status:            job.status,
    runId:             job.runId,
    error:             job.error,
    durationMs:        job.durationMs,
    queuedAt:          job.queuedAt,
    startedAt:         job.startedAt,
    completedAt:       job.completedAt,
    retryAttempt:      job.retryAttempt,
    sectionsTotal:     job.sectionsTotal,
    sectionsCompleted: job.sectionsCompleted,
    sectionsFailed:    job.sectionsFailed,
  };
}
