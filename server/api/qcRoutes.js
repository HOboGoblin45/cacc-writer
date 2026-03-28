/**
 * server/api/qcRoutes.js
 * ------------------------
 * Phase 7 — Quality Control API Routes
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Endpoints:
 *   POST  /qc/run                              — run QC on a draft package
 *   GET   /qc/runs/:qcRunId                    — get QC run details
 *   GET   /qc/runs/:qcRunId/findings           — list findings for a run
 *   GET   /qc/runs/:qcRunId/findings/:findingId — get single finding detail
 *   GET   /qc/runs/:qcRunId/summary            — get QC summary
 *   GET   /qc/runs/:qcRunId/sections/:sectionId — get findings for a section
 *   POST  /qc/findings/:findingId/dismiss       — dismiss a finding
 *   POST  /qc/findings/:findingId/resolve       — resolve a finding
 *   POST  /qc/findings/:findingId/reopen        — reopen a finding
 *   GET   /cases/:caseId/qc-runs                — list QC runs for a case
 *   GET   /qc/registry/stats                    — get rule registry stats
 */

import { Router } from 'express';
import { z } from 'zod';
import { validateBody, validateParams, validateQuery } from '../middleware/validateRequest.js';
import { runQC } from '../qc/qcRunEngine.js';
import {
  getQcRun,
  listQcRuns,
  getFindings,
  getFinding,
  getFindingsForSection,
  dismissFinding,
  resolveFinding,
  reopenFinding,
  getLatestQcRunForGeneration,
} from '../qc/qcRepo.js';
import { getRegistryStats } from '../qc/qcRuleRegistry.js';
import log from '../logger.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────

/** POST /qc/run body */
const qcRunBodySchema = z.object({
  caseId: z.string().min(1).max(80),
  generationRunId: z.string().max(120).optional(),
});

/** GET /qc/runs/:qcRunId params */
const qcRunIdSchema = z.object({
  qcRunId: z.string().min(1),
});

/** GET /qc/runs/:qcRunId/findings params and query */
const qcRunFindingsParamsSchema = z.object({
  qcRunId: z.string().min(1),
});
const qcRunFindingsQuerySchema = z.object({
  status: z.string().optional(),
  severity: z.string().optional(),
  category: z.string().optional(),
});

/** GET /qc/runs/:qcRunId/findings/:findingId params */
const findingDetailParamsSchema = z.object({
  qcRunId: z.string().min(1),
  findingId: z.string().min(1),
});

/** GET /qc/runs/:qcRunId/summary params */
const qcRunSummaryParamsSchema = z.object({
  qcRunId: z.string().min(1),
});

/** GET /qc/runs/:qcRunId/sections/:sectionId params */
const sectionFindingsParamsSchema = z.object({
  qcRunId: z.string().min(1),
  sectionId: z.string().min(1),
});

/** POST /qc/findings/:findingId/* body */
const findingActionBodySchema = z.object({
  note: z.string().max(2000).optional(),
});

/** POST /qc/findings/:findingId/dismiss params */
const dismissFindingParamsSchema = z.object({
  findingId: z.string().min(1),
});

/** POST /qc/findings/:findingId/resolve params */
const resolveFindingParamsSchema = z.object({
  findingId: z.string().min(1),
});

/** POST /qc/findings/:findingId/reopen params */
const reopenFindingParamsSchema = z.object({
  findingId: z.string().min(1),
});

/** GET /cases/:caseId/qc-runs params and query */
const caseQcRunsParamsSchema = z.object({
  caseId: z.string().min(1),
});
const caseQcRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(20),
});

/** GET /qc/generation-runs/:generationRunId/latest params */
const generationRunIdSchema = z.object({
  generationRunId: z.string().min(1),
});

// ── POST /qc/run ─────────────────────────────────────────────────────────────
/**
 * Run QC on a draft package.
 *
 * Body: { caseId: string, generationRunId?: string }
 * Returns: { ok, qcRunId, summary, draftReadiness, findingCount, duration }
 */
router.post('/qc/run', validateBody(qcRunBodySchema), async (req, res) => {
  const { caseId, generationRunId } = req.validated;

  try {
    log.info('[qc] Starting QC run', { caseId, generationRunId });

    const result = await runQC({ caseId, generationRunId });

    log.info('[qc] QC run complete', {
      qcRunId: result.qcRunId,
      draftReadiness: result.draftReadiness,
      findingCount: result.findings.length,
      duration: result.duration,
    });

    res.json({
      ok: true,
      qcRunId: result.qcRunId,
      summary: result.summary,
      draftReadiness: result.draftReadiness,
      findingCount: result.findings.length,
      duration: result.duration,
    });
  } catch (err) {
    log.error('[qc/run]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /qc/runs/:qcRunId ────────────────────────────────────────────────────
/**
 * Get QC run details.
 *
 * Returns: { ok, run }
 */
router.get('/qc/runs/:qcRunId', validateParams(qcRunIdSchema), (req, res) => {
  const { qcRunId } = req.validatedParams;

  try {
    const run = getQcRun(qcRunId);
    if (!run) {
      return res.status(404).json({ ok: false, error: `QC run not found: ${qcRunId}` });
    }
    res.json({ ok: true, run });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /qc/runs/:qcRunId/findings ───────────────────────────────────────────
/**
 * List findings for a QC run.
 *
 * Query params: status, severity, category (optional filters)
 * Returns: { ok, findings, count }
 */
router.get('/qc/runs/:qcRunId/findings', validateParams(qcRunFindingsParamsSchema), validateQuery(qcRunFindingsQuerySchema), (req, res) => {
  const { qcRunId } = req.validatedParams;
  const { status, severity, category } = req.validatedQuery;

  try {
    const run = getQcRun(qcRunId);
    if (!run) {
      return res.status(404).json({ ok: false, error: `QC run not found: ${qcRunId}` });
    }

    const findings = getFindings(qcRunId, { status, severity, category });

    res.json({
      ok: true,
      qcRunId,
      findings,
      count: findings.length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /qc/runs/:qcRunId/findings/:findingId ───────────────────────────────
/**
 * Get a single finding detail.
 *
 * Returns: { ok, finding }
 */
router.get('/qc/runs/:qcRunId/findings/:findingId', validateParams(findingDetailParamsSchema), (req, res) => {
  const { findingId } = req.validatedParams;

  try {
    const finding = getFinding(findingId);
    if (!finding) {
      return res.status(404).json({ ok: false, error: `Finding not found: ${findingId}` });
    }
    res.json({ ok: true, finding });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /qc/runs/:qcRunId/summary ───────────────────────────────────────────
/**
 * Get QC summary for a run.
 *
 * Returns: { ok, summary, draftReadiness }
 */
router.get('/qc/runs/:qcRunId/summary', validateParams(qcRunSummaryParamsSchema), (req, res) => {
  const { qcRunId } = req.validatedParams;

  try {
    const run = getQcRun(qcRunId);
    if (!run) {
      return res.status(404).json({ ok: false, error: `QC run not found: ${qcRunId}` });
    }

    res.json({
      ok: true,
      qcRunId,
      summary: run.summary,
      draftReadiness: run.draft_readiness,
      severityCounts: {
        blocker: run.blocker_count,
        high: run.high_count,
        medium: run.medium_count,
        low: run.low_count,
        advisory: run.advisory_count,
      },
      totalFindings: run.total_findings,
      status: run.status,
      duration: run.duration_ms,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /qc/runs/:qcRunId/sections/:sectionId ──────────────────────────────
/**
 * Get findings for a specific section within a QC run.
 *
 * Returns: { ok, sectionId, findings, count }
 */
router.get('/qc/runs/:qcRunId/sections/:sectionId', validateParams(sectionFindingsParamsSchema), (req, res) => {
  const { qcRunId, sectionId } = req.validatedParams;

  try {
    const run = getQcRun(qcRunId);
    if (!run) {
      return res.status(404).json({ ok: false, error: `QC run not found: ${qcRunId}` });
    }

    const findings = getFindingsForSection(qcRunId, sectionId);

    res.json({
      ok: true,
      qcRunId,
      sectionId,
      findings,
      count: findings.length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /qc/findings/:findingId/dismiss ────────────────────────────────────
/**
 * Dismiss a finding with an optional note.
 *
 * Body: { note?: string }
 * Returns: { ok, findingId, status }
 */
router.post('/qc/findings/:findingId/dismiss', validateParams(dismissFindingParamsSchema), validateBody(findingActionBodySchema), (req, res) => {
  const { findingId } = req.validatedParams;
  const { note } = req.validated;

  try {
    const success = dismissFinding(findingId, note);
    if (!success) {
      return res.status(404).json({ ok: false, error: `Finding not found or already dismissed/resolved: ${findingId}` });
    }
    res.json({ ok: true, findingId, status: 'dismissed' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /qc/findings/:findingId/resolve ────────────────────────────────────
/**
 * Resolve a finding with an optional note.
 *
 * Body: { note?: string }
 * Returns: { ok, findingId, status }
 */
router.post('/qc/findings/:findingId/resolve', validateParams(resolveFindingParamsSchema), validateBody(findingActionBodySchema), (req, res) => {
  const { findingId } = req.validatedParams;
  const { note } = req.validated;

  try {
    const success = resolveFinding(findingId, note);
    if (!success) {
      return res.status(404).json({ ok: false, error: `Finding not found or already dismissed/resolved: ${findingId}` });
    }
    res.json({ ok: true, findingId, status: 'resolved' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /qc/findings/:findingId/reopen ─────────────────────────────────────
/**
 * Reopen a dismissed or resolved finding.
 *
 * Returns: { ok, findingId, status }
 */
router.post('/qc/findings/:findingId/reopen', validateParams(reopenFindingParamsSchema), validateBody(findingActionBodySchema), (req, res) => {
  const { findingId } = req.validatedParams;

  try {
    const success = reopenFinding(findingId);
    if (!success) {
      return res.status(404).json({ ok: false, error: `Finding not found or already open: ${findingId}` });
    }
    res.json({ ok: true, findingId, status: 'open' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /cases/:caseId/qc-runs ──────────────────────────────────────────────
/**
 * List QC runs for a case.
 *
 * Query params: limit (default 20)
 * Returns: { ok, caseId, runs, count }
 */
router.get('/cases/:caseId/qc-runs', validateParams(caseQcRunsParamsSchema), validateQuery(caseQcRunsQuerySchema), (req, res) => {
  const { caseId } = req.validatedParams;
  const { limit } = req.validatedQuery;

  try {
    const runs = listQcRuns(caseId, { limit });
    res.json({
      ok: true,
      caseId,
      runs,
      count: runs.length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /qc/generation-runs/:generationRunId/latest ─────────────────────────
/**
 * Get the latest QC run for a generation run.
 *
 * Returns: { ok, run }
 */
router.get('/qc/generation-runs/:generationRunId/latest', validateParams(generationRunIdSchema), (req, res) => {
  const { generationRunId } = req.validatedParams;

  try {
    const run = getLatestQcRunForGeneration(generationRunId);
    if (!run) {
      return res.status(404).json({ ok: false, error: `No QC run found for generation run: ${generationRunId}` });
    }
    res.json({ ok: true, run });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /qc/registry/stats ──────────────────────────────────────────────────
/**
 * Get rule registry statistics.
 *
 * Returns: { ok, stats }
 */
router.get('/qc/registry/stats', (_req, res) => {
  try {
    const stats = getRegistryStats();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
