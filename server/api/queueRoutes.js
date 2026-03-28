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
import { z } from 'zod';
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
const queueCaseSchema = z.object({
  caseId: z.string().min(1).max(80),
  formType: z.string().max(20).optional(),
  forceGateBypass: z.boolean().optional(),
}).passthrough();
const enqueueSchema = z.object({
  cases: z.array(queueCaseSchema).min(1).max(200),
}).passthrough();
const emptyMutationSchema = z.object({}).strict();

const batchIdParamsSchema = z.object({
  batchId: z.string().min(1),
}).strict();

const jobIdParamsSchema = z.object({
  jobId: z.string().min(1),
}).strict();

function parsePayload(schema, payload, res) {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    ok: false,
    code: 'INVALID_PAYLOAD',
    error: 'Invalid request payload',
    details: parsed.error.issues.map(i => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    })),
  });
  return null;
}

function validateBodyMiddleware(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_PAYLOAD',
        error: 'Invalid request payload',
        details: parsed.error.issues.map(i => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      });
    }
    req.validated = parsed.data;
    next();
  };
}

function validateParamsMiddleware(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_PARAMS',
        error: 'Invalid route parameters',
        details: parsed.error.issues.map(i => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      });
    }
    req.validatedParams = parsed.data;
    next();
  };
}

// ── POST /reports/queue ───────────────────────────────────────────────────────
// Enqueue cases for report generation.
//
// Body: { cases: [{ caseId: string, formType?: string }, ...] }
// Response: { batchId: string, jobs: [...] }

router.post('/reports/queue', validateBodyMiddleware(enqueueSchema), (req, res) => {
  try {
    const { cases } = req.validated;
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

router.get('/reports/queue/batch/:batchId', validateParamsMiddleware(batchIdParamsSchema), (req, res) => {
  const status = getBatchStatus(req.validatedParams.batchId);
  if (!status) {
    return res.status(404).json({ error: 'Batch not found' });
  }
  res.json(status);
});

// ── GET /reports/queue/job/:jobId ─────────────────────────────────────────────
// Returns the status of a single queued job.

router.get('/reports/queue/job/:jobId', validateParamsMiddleware(jobIdParamsSchema), (req, res) => {
  const status = getJobStatus(req.validatedParams.jobId);
  if (!status) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(status);
});

// ── POST /reports/queue/cancel ────────────────────────────────────────────────
// Cancel all queued (not-yet-started) jobs.

router.post('/reports/queue/cancel', validateBodyMiddleware(emptyMutationSchema), (_req, res) => {
  const cancelled = cancelQueued();
  res.json({ cancelled });
});

// ── POST /reports/queue/clear ─────────────────────────────────────────────────
// Remove completed/failed/cancelled jobs from the queue.

router.post('/reports/queue/clear', validateBodyMiddleware(emptyMutationSchema), (_req, res) => {
  const cleared = clearCompleted();
  res.json({ cleared });
});

export default router;
