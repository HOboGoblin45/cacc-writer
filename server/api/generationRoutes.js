/**
 * server/api/generationRoutes.js
 * --------------------------------
 * Express Router for orchestrator + DB endpoints.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Extracted routes (new architecture path):
 *   POST  /cases/:caseId/generate-full-draft   — trigger full-draft orchestrator (primary)
 *   POST  /generation/full-draft               — alias for above (caseId in body)
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
  getRunResult,
  getGeneratedSectionsForRun,
} from '../orchestrator/generationOrchestrator.js';
import { RUN_STATUS } from '../db/repositories/generationRepo.js';
import {
  runSectionJob,
} from '../orchestrator/sectionJobRunner.js';
import { buildAssignmentContext } from '../context/assignmentContextBuilder.js';
import { buildReportPlan, getSectionDef } from '../context/reportPlanner.js';
import { buildRetrievalPack } from '../context/retrievalPackBuilder.js';
import { runLegacyKbImport, getMemoryItemStats } from '../migration/legacyKbImport.js';
import { getDb, getDbPath, getDbSizeBytes, getTableCounts } from '../db/database.js';
import log from '../logger.js';

// ── In-memory run result store (LRU-bounded) ─────────────────────────────────
// Stores the full draftPackage result keyed by runId.
// Run status is always read from SQLite; this stores the full result object
// for fast retrieval without re-querying all section rows.
// Capped at 100 entries to prevent unbounded memory growth.
const _MAX_RUN_RESULTS = 100;
const _runResults = new Map();

function _setRunResult(runId, result) {
  // Evict oldest entry if at capacity (Map preserves insertion order)
  if (_runResults.size >= _MAX_RUN_RESULTS) {
    const oldestKey = _runResults.keys().next().value;
    _runResults.delete(oldestKey);
  }
  _runResults.set(runId, result);
}

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
          _setRunResult(result.runId, result);
          log.info('[orchestrator] run complete', { runId: result.runId, ok: result.ok });
        }
      })
      .catch(err => {
        log.error('[orchestrator] run error', { error: err.message });
      });

    // Brief yield so orchestrator can create the run record in SQLite
    await new Promise(r => setTimeout(r, 50));

    // Read the most recent active run for this case using canonical statuses
    const db        = getDb();
    const latestRun = db.prepare(`
      SELECT id FROM generation_runs
       WHERE case_id = ? AND status IN (
         'queued','preparing','retrieving','analyzing',
         'drafting','validating','assembling'
       )
       ORDER BY created_at DESC LIMIT 1
    `).get(caseId);
    runId = latestRun?.id || null;

    res.json({
      ok:                 true,
      runId,
      status:             RUN_STATUS.PREPARING,
      estimatedDurationMs,
      message:            'Full-draft generation started. Poll /api/generation/runs/:runId/status for progress.',
    });
  } catch (err) {
    log.error('[generate-full-draft]', err.message);
    res.status(500).json({ ok: false, error: err.message, runId });
  }
});

// ── POST /generation/full-draft ───────────────────────────────────────────────
/**
 * Alias for POST /cases/:caseId/generate-full-draft.
 * Accepts caseId in the request body instead of the URL path.
 * Useful for clients that prefer a flat API surface.
 *
 * Body:    { caseId, formType?: string, options?: object }
 * Returns: { ok, runId, status, estimatedDurationMs, message }
 */
router.post('/generation/full-draft', async (req, res) => {
  const { caseId, formType, options = {} } = req.body || {};

  if (!caseId) {
    return res.status(400).json({ ok: false, error: 'caseId is required in request body' });
  }

  // Delegate to the canonical route handler by forwarding to the same logic
  req.params.caseId = caseId;
  req.body.formType = formType;
  req.body.options  = options;

  // Resolve caseDir manually (router.param won't fire for this route)
  const caseDir = resolveCaseDir(caseId);
  if (!caseDir) {
    return res.status(400).json({ ok: false, error: 'Invalid caseId format' });
  }
  if (!fs.existsSync(caseDir)) {
    return res.status(404).json({ ok: false, error: `Case not found: ${caseId}` });
  }
  req.caseDir = caseDir;

  // Scope enforcement
  const resolvedFormType = formType || 'unknown';
  if (resolvedFormType !== 'unknown' && isDeferredForm(resolvedFormType)) {
    logDeferredAccess(resolvedFormType, '/api/generation/full-draft', log);
    return res.status(400).json({
      ok:        false,
      supported: false,
      scope:     'deferred',
      error:     `Form type "${resolvedFormType}" is deferred and not supported in the current production scope.`,
    });
  }

  let runId = null;

  try {
    let estimatedDurationMs = 12_000;
    try {
      const ctx  = await buildAssignmentContext(caseId);
      const plan = buildReportPlan(ctx);
      estimatedDurationMs = plan.estimatedDurationMs || 12_000;
    } catch { /* non-fatal */ }

    const orchestratorPromise = runFullDraftOrchestrator({
      caseId,
      formType: resolvedFormType === 'unknown' ? undefined : resolvedFormType,
      options,
    });

    orchestratorPromise
      .then(result => {
        if (result?.runId) {
          _setRunResult(result.runId, result);
          log.info('[orchestrator] run complete', { runId: result.runId, ok: result.ok });
        }
      })
      .catch(err => {
        log.error('[orchestrator] run error', { error: err.message });
      });

    await new Promise(r => setTimeout(r, 50));

    const db        = getDb();
    const latestRun = db.prepare(`
      SELECT id FROM generation_runs
       WHERE case_id = ? AND status IN (
         'queued','preparing','retrieving','analyzing',
         'drafting','validating','assembling'
       )
       ORDER BY created_at DESC LIMIT 1
    `).get(caseId);
    runId = latestRun?.id || null;

    res.json({
      ok:                 true,
      runId,
      status:             RUN_STATUS.PREPARING,
      estimatedDurationMs,
      message:            'Full-draft generation started. Poll /api/generation/runs/:runId/status for progress.',
    });
  } catch (err) {
    log.error('[generation/full-draft]', err.message);
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
 * Priority order:
 *   1. In-memory _runResults (fastest — same server process, run just completed)
 *   2. getRunResult() from orchestrator (reads draft_package_json from SQLite)
 *   3. Section-by-section reconstruction from generated_sections rows
 *
 * Returns: { ok, runId, draftPackage, metrics, warnings, sections, fromCache }
 */
router.get('/generation/runs/:runId/result', (req, res) => {
  const { runId } = req.params;
  try {
    // ── 1. In-memory store (fastest path — run just completed this session) ──
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
        source:       'memory',
      });
    }

    // ── 2. Check run status first ─────────────────────────────────────────────
    const status = getRunStatus(runId);
    if (!status) {
      return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
    }

    // Run is still active — return progress info, not a result
    const activeStatuses = [
      RUN_STATUS.QUEUED,
      RUN_STATUS.PREPARING,
      RUN_STATUS.RETRIEVING,
      RUN_STATUS.ANALYZING,
      RUN_STATUS.DRAFTING,
      RUN_STATUS.VALIDATING,
      RUN_STATUS.ASSEMBLING,
    ];
    if (activeStatuses.includes(status.status)) {
      return res.json({
        ok:                true,
        runId,
        status:            status.status,
        legacyStatus:      status.legacyStatus,
        message:           'Run is still in progress. Try again shortly.',
        elapsedMs:         status.elapsedMs,
        sectionsCompleted: status.sectionsCompleted,
        sectionsTotal:     status.sectionsTotal,
        sectionStatuses:   status.sectionStatuses,
      });
    }

    // ── 3. Use getRunResult() — reads draft_package_json or reconstructs ──────
    const result = getRunResult(runId);
    if (result) {
      return res.json({
        ok:          true,
        runId,
        status:      status.status,
        legacyStatus: status.legacyStatus,
        draftPackage: result.draftPackage || null,
        sections:    result.sections || {},
        metrics:     result.metrics  || status.phaseTimings,
        warnings:    result.warnings || status.warnings || [],
        retrieval:   status.retrieval,
        fromCache:   result.fromCache,
        source:      result.fromCache ? 'sqlite-package' : 'sqlite-sections',
      });
    }

    // ── 4. Fallback: manual section reconstruction ────────────────────────────
    const sectionRows = getGeneratedSectionsForRun(runId);
    const sectionsMap = {};
    for (const s of sectionRows) {
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
      legacyStatus: status.legacyStatus,
      sections:    sectionsMap,
      metrics:     status.phaseTimings,
      warnings:    status.warnings || [],
      retrieval:   status.retrieval,
      fromCache:   false,
      source:      'sqlite-fallback',
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
