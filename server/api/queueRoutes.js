/**
 * server/api/queueRoutes.js
 * ---------------------------
 * Express Router for the report queue system.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   POST   /reports/queue          — enqueue one or more cases for generation
 *   GET    /reports/queue/status   — get overall queue status
 *   GET    /reports/queue/batch/:batchId — get status of a specific batch
 *   GET    /reports/queue/job/:jobId     — get status of a specific job
 *   POST   /reports/queue/cancel   — cancel all queued (not-yet-running) jobs
 *   POST   /reports/queue/clear    — clear completed/failed jobs from queue
 */

import { Router } from 'express';
import {
  enqueueReports,
  getQueueStatus,
  getBatchStatus,
  getJobStatus,
  cancelQueued,
  clearCompleted,
} from '../services/reportQueueService.js';
import log from '../logger.js';

const router = Router();

// ── POST /reports/queue ───────────────────────────────────────────────────────
// Enqueue cases for report generation.
//
// Body: { cases: [{ caseId: string, formType?: string }, ...] }
// Response: { batchId: string, jobs: [...] }

router.post('/reports/queue', (req, res) => {
  try {
    const { cases } = req.body;

    if (!Array.isArray(cases) || cases.length === 0) {
      return res.status(400).json({
        error: 'Request body must include a non-empty "cases" array',
        example: { cases: [{ caseId: 'case-001' }, { caseId: 'case-002', formType: '1004' }] },
      });
    }

    // Validate each case entry
    for (const c of cases) {
      if (!c.caseId || typeof c.caseId !== 'string') {
        return res.status(400).json({ error: `Invalid caseId: ${JSON.stringify(c)}` });
      }
    }

    const result = enqueueReports({ cases });
    res.json(result);
  } catch (err) {
    log.error('queue:enqueue-error', { error: err.message });
    res.status(422).json({ error: err.message });
  }
});

// ── GET /reports/queue/status ─────────────────────────────────────────────────
// Returns overall queue health and all jobs.

router.get('/reports/queue/status', (_req, res) => {
  const status = getQueueStatus();
  res.json(status);
});

// ── GET /reports/queue/batch/:batchId ─────────────────────────────────────────
// Returns the status of all jobs in a specific batch.

router.get('/reports/queue/batch/:batchId', (req, res) => {
  const status = getBatchStatus(req.params.batchId);
  if (!status) {
    return res.status(404).json({ error: 'Batch not found' });
  }
  res.json(status);
});

// ── GET /reports/queue/job/:jobId ─────────────────────────────────────────────
// Returns the status of a single queued job.

router.get('/reports/queue/job/:jobId', (req, res) => {
  const status = getJobStatus(req.params.jobId);
  if (!status) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(status);
});

// ── POST /reports/queue/cancel ────────────────────────────────────────────────
// Cancel all queued (not-yet-started) jobs.

router.post('/reports/queue/cancel', (_req, res) => {
  const cancelled = cancelQueued();
  res.json({ cancelled });
});

// ── POST /reports/queue/clear ─────────────────────────────────────────────────
// Remove completed/failed/cancelled jobs from the queue.

router.post('/reports/queue/clear', (_req, res) => {
  const cleared = clearCompleted();
  res.json({ cleared });
});

export default router;
