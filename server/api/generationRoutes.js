/**
 * server/api/generationRoutes.js
 * --------------------------------
 * Express Router for orchestrator + DB endpoints.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Extracted routes (new architecture path):
 *   POST  /cases/:caseId/generate-full-draft   — trigger full-draft orchestrator
 *   GET   /generation/runs/:runId/status        — poll run status
 *   GET   /generation/runs/:runId/result        — get final result
 *   POST  /generation/regenerate-section        — regenerate one section
 *   POST  /db/migrate-legacy-kb                 — import flat-file KB to SQLite
 *   GET   /db/status                            — SQLite health + table counts
 *
 * Note: GET /cases/:caseId/generation-runs is handled in casesRoutes.js
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';

// ── Shared utilities ──────────────────────────────────────────────────────────
import { resolveCaseDir } from '../utils/caseUtils.js';

// ── Domain modules ────────────────────────────────────────────────────────────
import { isDeferredForm, logDeferredAccess } from '../config/productionScope.js';
import {
  runFullDraftOrchestrator,
  getRunStatus,
  getGeneratedSectionsForRun,
} from '../orchestrator/generationOrchestrator.js';
import {
  runSectionJob,
} from '../orchestrator/sectionJobRunner.js';
import { buildAssignmentContext } from '../context/assignmentContextBuilder.js';
import { buildReportPlan, getSectionDef } from '../context/reportPlanner.js';
import { buildRetrievalPack } from '../context/retrievalPackBuilder.js';
import { runLegacyKbImport, getMemoryItemStats } from '../migration/legacyKbImport.js';
import { getDb, getDbPath, getDbSizeBytes, getTableCounts } from '../db/database.js';
import log from '../logger.js';

// ── In-memory run result store ────────────────────────────────────────────────
// Stores the full draftPackage result keyed by runId.
// Run status is always read from SQLite; this stores the full result object
// for fast retrieval without re-querying all section rows.
const _runResults = new Map();

// ── Router ────────────────────────────────────────────────────────────────────
const router = Router();

/**
 * router.param('caseId')
 * Validates caseId format and attaches req.caseDir for /:caseId routes.
 */
router.param('caseId', (req, res, next, caseId) => {
  const cd = resolveCaseDir(caseId);
  if (!cd) return res.status(400).json({ ok: false, error: 'Invalid caseId format' });
  req.caseDir = cd;
  next();
});

// ── POST /cases/:caseId/generate-full-draft ───────────────────────────────────
/**
 * Trigger full-draft generation for a case via the orchestrator.
 * Runs asynchronously — returns runId immediately for polling.
 *
 * Body:    { formType?: string, options?: object }
 * Returns: { ok, runId, status, estimatedDurationMs, message }
 */
router.post('/cases/:caseId/generate-full-draft', async (req, res) => {
  const { caseId }           = req.params;
  const { formType, options = {} } = req.body || {};

  // Scope enforcement — deferred forms blocked
  const resolvedFormType = formType || 'unknown';
  if (resolvedFormType !== 'unknown' && isDeferredForm(resolvedFormType)) {
    logDeferredAccess(resolvedFormType, '/api/cases/:caseId/generate-full-draft', log);
    return res.status(400).json({
      ok:        false,
      supported: false,
      scope:     'deferred',
      error:     `Form type "${resolvedFormType}" is deferred and not supported in the current production scope.`,
    });
  }

  // Verify case exists
  const caseDir = req.caseDir;
  if (!fs.existsSync(caseDir)) {
    return res.status(404).json({ ok: false, error: `Case not found: ${caseId}` });
  }

  let runId = null;

  try {
    // Get estimated duration from report plan (quick, synchronous)
    let estimatedDurationMs = 12_000;
    try {
      const ctx  = await buildAssignmentContext(caseId);
      const plan = buildReportPlan(ctx);
      estimatedDurationMs = plan.estimatedDurationMs || 12_000;
    } catch { /* non-fatal — use default estimate */ }

    // Launch orchestrator in background (non-blocking)
    const orchestratorPromise = runFullDraftOrchestrator({
      caseId,
      formType: resolvedFormType === 'unknown' ? undefined : resolvedFormType,
      options,
    });

    // Store result when complete
    orchestratorPromise
      .then(result => {
        if (result?.runId) {
          _runResults.set(result.runId, result);
          log.info('[orchestrator] run complete', { runId: result.runId, ok: result.ok });
        }
      })
      .catch(err => {
        log.error('[orchestrator] run error', { error: err.message });
      });

    // Brief yield so orchestrator can create the run record in SQLite
    await new Promise(r => setTimeout(r, 50));

    // Read the most recent pending/running run for this case
    const db         = getDb();
    const latestRun  = db.prepare(`
      SELECT id FROM generation_runs
       WHERE case_id = ? AND status IN ('pending', 'running')
       ORDER BY created_at DESC LIMIT 1
    `).get(caseId);
    runId = latestRun?.id || null;

    res.json({
      ok:                 true,
      runId,
      status:             'running',
      estimatedDurationMs,
      message:            'Full-draft generation started. Poll /api/generation/runs/:runId/status for progress.',
    });
  } catch (err) {
    log.error('[generate-full-draft]', err.message);
    res.status(500).json({ ok: false, error: err.message, runId });
  }
});

// ── GET /generation/runs/:runId/status ────────────────────────────────────────
/**
 * Poll the status of a generation run.
 *
 * Returns: { ok, runId, status, phase, sectionsCompleted, sectionsTotal,
 *            elapsedMs, sectionStatuses, phaseTimings, retrieval, warnings }
 */
router.get('/generation/runs/:runId/status', (req, res) => {
  const { runId } = req.params;
  try {
    const status = getRunStatus(runId);
    if (!status) {
      return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
    }
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /generation/runs/:runId/result ────────────────────────────────────────
/**
 * Get the final result of a completed generation run.
 *
 * Returns: { ok, runId, draftPackage, metrics, warnings, sections }
 */
router.get('/generation/runs/:runId/result', (req, res) => {
  const { runId } = req.params;
  try {
    // Check in-memory store first (fastest path)
    const cached = _runResults.get(runId);
    if (cached) {
      return res.json({
        ok:           true,
        runId,
        draftPackage: cached.draftPackage,
        sections:     cached.draftPackage?.sections || {},
        metrics:      cached.metrics,
        warnings:     cached.warnings || [],
        fromCache:    true,
      });
    }

    // Fall back to SQLite
    const status = getRunStatus(runId);
    if (!status) {
      return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
    }

    if (status.status === 'running' || status.status === 'pending') {
      return res.json({
        ok:        true,
        runId,
        status:    status.status,
        message:   'Run is still in progress. Try again shortly.',
        elapsedMs: status.elapsedMs,
      });
    }

    // Load generated sections from SQLite
    const sections    = getGeneratedSectionsForRun(runId);
    const sectionsMap = {};
    for (const s of sections) {
      sectionsMap[s.section_id] = {
        sectionId:    s.section_id,
        text:         s.final_text || s.draft_text || '',
        approved:     !!s.approved,
        approvedAt:   s.approved_at,
        insertedAt:   s.inserted_at,
        examplesUsed: s.examples_used,
      };
    }

    res.json({
      ok:          true,
      runId,
      status:      status.status,
      sections:    sectionsMap,
      sectionList: sections,
      metrics:     status.phaseTimings,
      warnings:    status.warnings || [],
      retrieval:   status.retrieval,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /generation/regenerate-section ──────────────────────────────────────
/**
 * Regenerate a single section within an existing run.
 * Useful for fixing a failed or thin section without re-running the full draft.
 *
 * Body:    { runId, sectionId, caseId }
 * Returns: { ok, sectionId, text, metrics }
 */
router.post('/generation/regenerate-section', async (req, res) => {
  const { runId, sectionId, caseId } = req.body || {};

  if (!runId || !sectionId || !caseId) {
    return res.status(400).json({ ok: false, error: 'runId, sectionId, and caseId are required' });
  }

  try {
    const runStatus = getRunStatus(runId);
    if (!runStatus) {
      return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
    }

    const formType   = runStatus.formType || '1004';
    const sectionDef = getSectionDef(formType, sectionId);
    if (!sectionDef) {
      return res.status(400).json({ ok: false, error: `Unknown section: ${sectionId} for form ${formType}` });
    }

    const context       = await buildAssignmentContext(caseId);
    const plan          = buildReportPlan(context);
    const retrievalPack = await buildRetrievalPack(context, plan);

    // Collect prior section results for synthesis sections
    const priorSections = getGeneratedSectionsForRun(runId);
    const priorResults  = {};
    for (const s of priorSections) {
      if (s.section_id !== sectionId) {
        priorResults[s.section_id] = { text: s.final_text || '', ok: true };
      }
    }

    const result = await runSectionJob({
      runId,
      caseId,
      sectionDef,
      context,
      retrievalPack,
      priorResults,
      analysisArtifacts: {},
    });

    res.json({
      ok:        result.ok,
      sectionId: result.sectionId,
      text:      result.text,
      metrics:   result.metrics,
      error:     result.error || null,
    });
  } catch (err) {
    log.error('[regenerate-section]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /db/migrate-legacy-kb ────────────────────────────────────────────────
/**
 * Import the existing flat-file knowledge base into SQLite memory_items.
 * Idempotent — safe to run multiple times.
 *
 * Returns: { ok, imported, skipped, upgraded, errors, sources, durationMs }
 */
router.post('/db/migrate-legacy-kb', async (_req, res) => {
  try {
    log.info('[db] Starting legacy KB migration...');
    const result = await runLegacyKbImport();
    log.info('[db] Legacy KB migration complete', result);
    res.json({ ok: result.ok, ...result });
  } catch (err) {
    log.error('[db/migrate-legacy-kb]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /db/status ────────────────────────────────────────────────────────────
/**
 * SQLite database health check and table counts.
 *
 * Returns: { ok, dbPath, dbSizeBytes, tables, memory, initialized }
 */
router.get('/db/status', (_req, res) => {
  try {
    const tableCounts = getTableCounts();
    const memoryStats = getMemoryItemStats();
    const dbPath      = getDbPath();
    const dbSizeBytes = getDbSizeBytes();

    res.json({
      ok:          true,
      dbPath,
      dbSizeBytes,
      dbSizeKb:    Math.round(dbSizeBytes / 1024),
      tables:      tableCounts,
      memory:      memoryStats,
      initialized: true,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, initialized: false });
  }
});

export default router;
