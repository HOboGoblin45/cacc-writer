/**
 * server/api/intelligenceRoutes.js
 * -----------------------------------
 * Phase 4 — Assignment Intelligence API endpoints.
 *
 * Mounted at: /api  (via cacc-writer-server.js)
 *
 * Endpoints:
 *   POST /cases/:caseId/intelligence/build   — build intelligence bundle
 *   GET  /cases/:caseId/intelligence         — get persisted intelligence bundle
 *   GET  /cases/:caseId/intelligence/requirements — get deterministic section requirement matrix
 *   GET  /cases/:caseId/intelligence/compliance-check — get deterministic compliance check results
 *   GET  /intelligence/report-families       — list all report family manifests
 *   GET  /intelligence/canonical-fields      — canonical field registry stats
 *   GET  /intelligence/manifest-summaries    — all manifest summaries
 */

import { Router } from 'express';
import { resolveCaseDir } from '../utils/caseUtils.js';
import { getCaseProjection } from '../caseRecord/caseRecordService.js';
import {
  buildIntelligenceBundle,
  getIntelligenceBundle,
  listReportFamilies,
  getManifestSummaries,
  getCanonicalFieldStats,
  getAllCanonicalFields,
} from '../intelligence/index.js';
import {
  runPhaseCBenchmarksFromFile,
  readPhaseCBenchmarkResults,
  writePhaseCBenchmarkResults,
} from '../factIntegrity/benchmarkRunner.js';
import log from '../logger.js';

const router = Router();

async function loadOrBuildBundle(caseId) {
  let bundle = getIntelligenceBundle(caseId);
  if (bundle) return { bundle, rebuilt: false };
  bundle = await buildIntelligenceBundle(caseId);
  return { bundle, rebuilt: true };
}

// ── param: caseId validation ────────────────────────────────────────────────

router.param('caseId', (req, res, next, caseId) => {
  const cd = resolveCaseDir(caseId);
  if (!cd) return res.status(400).json({ error: 'Invalid case ID format' });
  if (!getCaseProjection(caseId)) return res.status(404).json({ error: 'Case not found' });
  req.caseDir = cd;
  next();
});

// ── POST /cases/:caseId/intelligence/build ──────────────────────────────────
/**
 * Build (or rebuild) the full assignment intelligence bundle for a case.
 * Reads canonical case projection (meta + facts), runs all Phase 4 subsystems,
 * persists the result to SQLite, and returns the bundle.
 */
router.post('/cases/:caseId/intelligence/build', async (req, res) => {
  try {
    const t0 = Date.now();
    const bundle = await buildIntelligenceBundle(req.params.caseId);

    log.info('[intelligence] Built bundle', {
      caseId:     req.params.caseId,
      formType:   bundle.context.formType,
      flags:      bundle.flagSummary.count,
      fields:     bundle.canonicalFields.totalApplicable,
      sections:   bundle.sectionPlan.totalSections,
      buildMs:    Date.now() - t0,
    });

    res.json({
      ok: true,
      bundle,
    });
  } catch (err) {
    log.error('[intelligence] Build failed', { caseId: req.params.caseId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /cases/:caseId/intelligence ─────────────────────────────────────────
/**
 * Retrieve the persisted intelligence bundle for a case.
 * Returns 404 if no bundle has been built yet.
 */
router.get('/cases/:caseId/intelligence', (req, res) => {
  try {
    const bundle = getIntelligenceBundle(req.params.caseId);
    if (!bundle) {
      return res.status(404).json({
        error: 'No intelligence bundle found. Call POST /cases/:caseId/intelligence/build first.',
      });
    }
    res.json({ ok: true, bundle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// —— GET /cases/:caseId/intelligence/requirements ————————————————
/**
 * Get deterministic required/optional section matrix for a case.
 * Auto-builds intelligence if bundle does not exist yet.
 */
router.get('/cases/:caseId/intelligence/requirements', async (req, res) => {
  try {
    const { bundle, rebuilt } = await loadOrBuildBundle(req.params.caseId);
    res.json({
      ok: true,
      rebuilt,
      sectionRequirements: bundle.sectionRequirements || null,
    });
  } catch (err) {
    const msg = String(err?.message || '');
    const code = msg.includes('Case directory not found') || msg.includes('Case not found') ? 404 : 500;
    res.status(code).json({ error: err.message });
  }
});

// —— GET /cases/:caseId/intelligence/compliance-check ————————————
/**
 * Get deterministic hard-rule compliance findings for a case.
 * Auto-builds intelligence if bundle does not exist yet.
 */
router.get('/cases/:caseId/intelligence/compliance-check', async (req, res) => {
  try {
    const { bundle, rebuilt } = await loadOrBuildBundle(req.params.caseId);
    res.json({
      ok: true,
      rebuilt,
      complianceChecks: bundle.complianceChecks || null,
    });
  } catch (err) {
    const msg = String(err?.message || '');
    const code = msg.includes('Case directory not found') || msg.includes('Case not found') ? 404 : 500;
    res.status(code).json({ error: err.message });
  }
});

// ── GET /intelligence/report-families ───────────────────────────────────────
/**
 * List all supported report family IDs and their summaries.
 */
router.get('/intelligence/report-families', (_req, res) => {
  res.json({
    ok: true,
    families: listReportFamilies(),
    summaries: getManifestSummaries(),
  });
});

// ── GET /intelligence/canonical-fields ──────────────────────────────────────
/**
 * Get canonical field registry statistics and full field list.
 */
router.get('/intelligence/canonical-fields', (_req, res) => {
  res.json({
    ok: true,
    stats: getCanonicalFieldStats(),
    fields: getAllCanonicalFields().map(f => ({
      fieldId:        f.fieldId,
      label:          f.label,
      sectionGroup:   f.sectionGroup,
      contentType:    f.contentType,
      whenNeeded:     f.whenNeeded,
      triggeringFlags: f.triggeringFlags,
      families:       f.applicableReportFamilies,
    })),
  });
});

// ── GET /intelligence/manifest-summaries ────────────────────────────────────
/**
 * Get summary data for all report family manifests.
 */
router.get('/intelligence/manifest-summaries', (_req, res) => {
  res.json({
    ok: true,
    summaries: getManifestSummaries(),
  });
});

// —— GET /intelligence/benchmarks/phase-c ——————————————————————————————————————
/**
 * Return latest persisted Phase C benchmark results.
 * If no snapshot exists yet, runs benchmarks once and returns ephemeral results.
 */
router.get('/intelligence/benchmarks/phase-c', async (_req, res) => {
  try {
    const cached = readPhaseCBenchmarkResults();
    if (cached) {
      return res.json({
        ok: true,
        cached: true,
        results: cached,
      });
    }

    const run = await runPhaseCBenchmarksFromFile();

    res.json({
      ok: true,
      cached: false,
      results: run.results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// —— POST /intelligence/benchmarks/phase-c/run ————————————————————————————————
/**
 * Force-run Phase C benchmarks and optionally persist the snapshot.
 * Query param: ?persist=false to skip file write.
 */
router.post('/intelligence/benchmarks/phase-c/run', async (req, res) => {
  try {
    const persist = String(req.query.persist || 'true').toLowerCase() !== 'false';
    const run = await runPhaseCBenchmarksFromFile();
    if (persist) writePhaseCBenchmarkResults(run.results);

    res.json({
      ok: true,
      persisted: persist,
      results: run.results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
