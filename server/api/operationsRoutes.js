/**
 * server/api/operationsRoutes.js
 * --------------------------------
 * Phase 10 — Operations REST Endpoints
 *
 * Routes:
 *   GET  /api/operations/audit                — Query audit events
 *   GET  /api/operations/audit/:id            — Get single audit event
 *   GET  /api/operations/audit/types           — Get distinct event types
 *   GET  /api/operations/audit/counts          — Get counts by category
 *
 *   GET  /api/operations/timeline/:caseId      — Get case timeline
 *   GET  /api/operations/timeline/:caseId/summary — Get timeline summary
 *
 *   GET  /api/operations/metrics               — Query operational metrics
 *   POST /api/operations/metrics/compute       — Compute all metrics now
 *   POST /api/operations/metrics/daily         — Compute daily summary
 *
 *   GET  /api/operations/health/diagnostics    — Full health diagnostics
 *   GET  /api/operations/health/quick          — Quick health status
 *
 *   POST /api/operations/archive/:caseId       — Archive a case
 *   POST /api/operations/restore/:caseId       — Restore a case
 *   GET  /api/operations/archived              — List archived cases
 *   GET  /api/operations/retention             — Get retention policy
 *   POST /api/operations/cleanup               — Run transient cleanup
 *
 *   GET  /api/operations/export/:caseId        — Export case manifest
 *   GET  /api/operations/export/:caseId/download — Download case export JSON
 *   GET  /api/operations/bundle-data           — Get support bundle data
 *
 *   GET  /api/operations/dashboard             — Full dashboard
 *   GET  /api/operations/dashboard/light       — Light dashboard (no agent probes)
 */

import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import {
  queryAuditEvents,
  countAuditEvents,
  getAuditEvent,
  getAuditEventTypes,
  getAuditCountsByCategory,
  queryCaseTimeline,
  queryMetrics,
} from '../operations/operationsRepo.js';
import { buildCaseTimeline, getCaseTimelineSummary } from '../operations/caseTimeline.js';
import {
  computeAllMetrics,
  computeDailySummary,
} from '../operations/metricsCollector.js';
import { runHealthDiagnostics, quickHealthCheck } from '../operations/healthDiagnostics.js';
import {
  archiveCase,
  restoreCase,
  listArchivedCases,
  getRetentionPolicy,
  runTransientCleanup,
} from '../operations/retentionManager.js';
import { buildCaseExportManifest, exportCaseManifest, getSupportBundleData } from '../operations/exportEnhancer.js';
import { buildDashboard, buildLightDashboard } from '../operations/dashboardBuilder.js';
import {
  detectStuckStates,
  failStuckGenerationRun,
  failStuckExtractionJob,
} from '../operations/stuckStateDetector.js';
import { createBackup, listBackups } from '../security/backupRestoreService.js';
import { emitSystemEvent } from '../operations/auditLogger.js';
import log from '../logger.js';

const router = Router();

// ── Zod Schemas ────────────────────────────────────────────────────────────────

const emptyMutationSchema = z.object({}).strict();

const metricsDailySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format').optional(),
}).strict();

const auditQuerySchema = z.object({
  caseId: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  eventType: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  severity: z.string().min(1).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const auditCountsQuerySchema = z.object({
  since: z.string().optional(),
});

const auditIdParamsSchema = z.object({
  id: z.string().min(1),
});

const timelineParamsSchema = z.object({
  caseId: z.string().min(1),
});

const timelineQuerySchema = z.object({
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  since: z.string().optional(),
  until: z.string().optional(),
  includePreAudit: z.coerce.boolean().default(true),
});

const metricsQuerySchema = z.object({
  metricType: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(30),
});

const caseIdParamsSchema = z.object({
  caseId: z.string().min(1),
});

const runIdParamsSchema = z.object({
  runId: z.string().min(1),
});

const jobIdParamsSchema = z.object({
  jobId: z.string().min(1),
});

// ── Audit Events ──────────────────────────────────────────────────────────────

router.get('/operations/audit/types', (req, res) => {
  try {
    const types = getAuditEventTypes();
    res.json({ types });
  } catch (err) {
    log.error('api:audit-types', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/operations/audit/counts', validateQuery(auditCountsQuerySchema), (req, res) => {
  try {
    const since = req.validatedQuery.since || undefined;
    const counts = getAuditCountsByCategory(since);
    res.json({ counts });
  } catch (err) {
    log.error('api:audit-counts', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/operations/audit/:id', validateParams(auditIdParamsSchema), (req, res) => {
  try {
    const event = getAuditEvent(req.validatedParams.id);
    if (!event) return res.status(404).json({ error: 'Audit event not found' });
    res.json(event);
  } catch (err) {
    log.error('api:audit-get', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/operations/audit', validateQuery(auditQuerySchema), (req, res) => {
  try {
    const opts = {
      caseId: req.validatedQuery.caseId,
      category: req.validatedQuery.category,
      eventType: req.validatedQuery.eventType,
      entityType: req.validatedQuery.entityType,
      entityId: req.validatedQuery.entityId,
      severity: req.validatedQuery.severity,
      since: req.validatedQuery.since,
      until: req.validatedQuery.until,
      limit: req.validatedQuery.limit,
      offset: req.validatedQuery.offset,
    };

    const events = queryAuditEvents(opts);
    const total = countAuditEvents(opts);

    res.json({ events, total, limit: opts.limit, offset: opts.offset });
  } catch (err) {
    log.error('api:audit-query', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Case Timeline ─────────────────────────────────────────────────────────────

router.get('/operations/timeline/:caseId/summary', validateParams(timelineParamsSchema), (req, res) => {
  try {
    const summary = getCaseTimelineSummary(req.validatedParams.caseId);
    res.json(summary);
  } catch (err) {
    log.error('api:timeline-summary', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/operations/timeline/:caseId', validateParams(timelineParamsSchema), validateQuery(timelineQuerySchema), (req, res) => {
  try {
    const opts = {
      category: req.validatedQuery.category,
      limit: req.validatedQuery.limit,
      offset: req.validatedQuery.offset,
      since: req.validatedQuery.since,
      until: req.validatedQuery.until,
      includePreAudit: req.validatedQuery.includePreAudit,
    };

    const timeline = buildCaseTimeline(req.validatedParams.caseId, opts);
    res.json(timeline);
  } catch (err) {
    log.error('api:timeline', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Metrics ───────────────────────────────────────────────────────────────────

router.get('/operations/metrics', validateQuery(metricsQuerySchema), (req, res) => {
  try {
    const opts = {
      metricType: req.validatedQuery.metricType,
      since: req.validatedQuery.since,
      until: req.validatedQuery.until,
      limit: req.validatedQuery.limit,
    };

    const metrics = queryMetrics(opts);
    res.json({ metrics });
  } catch (err) {
    log.error('api:metrics-query', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/operations/metrics/compute', validateBody(emptyMutationSchema), (req, res) => {
  try {
    const results = computeAllMetrics();
    res.json({ ok: true, results });
  } catch (err) {
    log.error('api:metrics-compute', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/operations/metrics/daily', validateBody(metricsDailySchema), (req, res) => {
  try {
    const date = req.validated.date || undefined;
    const summary = computeDailySummary(date);
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('api:metrics-daily', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Health Diagnostics ────────────────────────────────────────────────────────

router.get('/operations/health/diagnostics', async (req, res) => {
  try {
    const diagnostics = await runHealthDiagnostics();
    res.json(diagnostics);
  } catch (err) {
    log.error('api:health-diagnostics', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/operations/health/quick', async (req, res) => {
  try {
    const status = await quickHealthCheck();
    res.json({ status });
  } catch (err) {
    res.status(500).json({ status: 'unavailable', error: err.message });
  }
});

// ── Archival / Retention ──────────────────────────────────────────────────────

router.post('/operations/archive/:caseId', validateParams(caseIdParamsSchema), validateBody(emptyMutationSchema), (req, res) => {
  try {
    const result = archiveCase(req.validatedParams.caseId);
    res.json(result);
  } catch (err) {
    log.error('api:archive', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/operations/restore/:caseId', validateParams(caseIdParamsSchema), validateBody(emptyMutationSchema), (req, res) => {
  try {
    const result = restoreCase(req.validatedParams.caseId);
    res.json(result);
  } catch (err) {
    log.error('api:restore', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/operations/archived', (req, res) => {
  try {
    const cases = listArchivedCases();
    res.json({ cases });
  } catch (err) {
    log.error('api:archived-list', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/operations/retention', (req, res) => {
  try {
    const policy = getRetentionPolicy();
    res.json(policy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/operations/cleanup', validateBody(emptyMutationSchema), (req, res) => {
  try {
    const result = runTransientCleanup();
    res.json({ ok: true, result });
  } catch (err) {
    log.error('api:cleanup', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Export ────────────────────────────────────────────────────────────────────

router.get('/operations/export/:caseId', validateParams(caseIdParamsSchema), async (req, res) => {
  try {
    const manifest = await buildCaseExportManifest(req.validatedParams.caseId);
    res.json(manifest);
  } catch (err) {
    log.error('api:export-manifest', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/operations/export/:caseId/download', validateParams(caseIdParamsSchema), async (req, res) => {
  try {
    const result = await exportCaseManifest(req.validatedParams.caseId);
    res.json({ ok: true, path: result.path, sizeBytes: result.sizeBytes });
  } catch (err) {
    log.error('api:export-download', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/operations/bundle-data', (req, res) => {
  try {
    const data = getSupportBundleData();
    res.json(data);
  } catch (err) {
    log.error('api:bundle-data', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get('/operations/dashboard', async (req, res) => {
  try {
    const dashboard = await buildDashboard();
    res.json(dashboard);
  } catch (err) {
    log.error('api:dashboard', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get('/operations/dashboard/light', (req, res) => {
  try {
    const dashboard = buildLightDashboard();
    res.json(dashboard);
  } catch (err) {
    log.error('api:dashboard-light', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Database Backup ──────────────────────────────────────────────────────────

router.post('/operations/backup', async (req, res) => {
  try {
    const backup = await createBackup({ type: 'full' });
    if (backup?.error) {
      return res.status(500).json({ ok: false, error: backup.error });
    }

    emitSystemEvent('system.backup_created', 'Database backup created', {
      path: backup.filePath,
      sizeBytes: backup.fileSizeBytes,
    });

    res.json({
      ok: true,
      path: backup.filePath,
      sizeBytes: backup.fileSizeBytes,
      createdAt: backup.createdAt,
      backupId: backup.id,
    });
  } catch (err) {
    log.error('api:backup', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/operations/backups', (req, res) => {
  try {
    const backups = listBackups().map(backup => ({
      id: backup.id,
      filename: backup.filePath ? backup.filePath.split(/[\\/]/).pop() : null,
      sizeBytes: backup.fileSizeBytes,
      createdAt: backup.createdAt,
      status: backup.status,
      verifiedAt: backup.verifiedAt,
    }));
    res.json({ ok: true, backups });
  } catch (err) {
    log.error('api:backups-list', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Stuck State Detection ────────────────────────────────────────────────────

router.get('/operations/stuck-states', (req, res) => {
  try {
    const result = detectStuckStates();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:stuck-states', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/operations/stuck-states/fail-run/:runId', validateParams(runIdParamsSchema), (req, res) => {
  try {
    const result = failStuckGenerationRun(req.validatedParams.runId);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:fail-stuck-run', { runId: req.validatedParams.runId, error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/operations/stuck-states/fail-extraction/:jobId', validateParams(jobIdParamsSchema), (req, res) => {
  try {
    const result = failStuckExtractionJob(req.validatedParams.jobId);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:fail-stuck-extraction', { jobId: req.validatedParams.jobId, error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
