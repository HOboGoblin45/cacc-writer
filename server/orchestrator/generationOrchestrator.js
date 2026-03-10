/**
 * server/orchestrator/generationOrchestrator.js
 * -----------------------------------------------
 * Full-draft generation orchestrator for CACC Writer.
 *
 * Implements the core principle:
 *   Build context once → Retrieve memory once → Analyze once →
 *   Draft sections in parallel → Validate once → Insert cleanly
 *
 * This is the NEW path. The legacy section-by-section path
 * (POST /api/generate-batch) remains fully operational alongside this.
 *
 * Performance targets (1004 typical assignment):
 *   P50: < 12 seconds
 *   P90: < 20 seconds
 *   Warning: > 30 seconds
 *
 * Concurrency: max 3 parallel section jobs
 * Retry policy: 1 retry per section
 *
 * Usage:
 *   import { runFullDraftOrchestrator, getRunStatus, getRunResult } from './orchestrator/generationOrchestrator.js';
 *   const result = await runFullDraftOrchestrator({ caseId, formType });
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';
import { buildAssignmentContext } from '../context/assignmentContextBuilder.js';
import { buildReportPlan } from '../context/reportPlanner.js';
import { buildRetrievalPack, getRetrievalStats } from '../context/retrievalPackBuilder.js';
import { runSectionJob, getSectionJobsForRun } from './sectionJobRunner.js';
import { assembleDraftPackage } from './draftAssembler.js';

const MAX_PARALLEL = 3; // max concurrent section jobs

// ── Structured logger ─────────────────────────────────────────────────────────

function log(level, phase, runId, data = {}) {
  const entry = {
    ts:    new Date().toISOString(),
    level,
    phase,
    runId: runId || 'none',
    ...data,
  };
  const prefix = `[orchestrator:${phase}]`;
  if (level === 'error') {
    console.error(prefix, JSON.stringify(entry));
  } else {
    console.log(prefix, JSON.stringify(entry));
  }
}

// ── SQLite run record helpers ─────────────────────────────────────────────────

function createRunRecord(runId, caseId, formType, assignmentId) {
  getDb().prepare(`
    INSERT INTO generation_runs
      (id, case_id, assignment_id, form_type, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', datetime('now'))
  `).run(runId, caseId, assignmentId || null, formType);
}

function markRunRunning(runId) {
  getDb().prepare(`
    UPDATE generation_runs
       SET status = 'running', started_at = datetime('now')
     WHERE id = ?
  `).run(runId);
}

function updateRunPhaseMetrics(runId, metrics) {
  getDb().prepare(`
    UPDATE generation_runs SET
      context_build_ms  = ?,
      report_plan_ms    = ?,
      retrieval_ms      = ?,
      analysis_ms       = ?,
      parallel_draft_ms = ?,
      validation_ms     = ?,
      assembly_ms       = ?,
      section_count     = ?,
      success_count     = ?,
      error_count       = ?,
      retry_count       = ?,
      retrieval_cache_hit  = ?,
      memory_items_scanned = ?,
      memory_items_used    = ?,
      warnings_json     = ?,
      metrics_json      = ?
    WHERE id = ?
  `).run(
    metrics.contextBuildMs   || 0,
    metrics.reportPlanMs     || 0,
    metrics.retrievalMs      || 0,
    metrics.analysisMs       || 0,
    metrics.parallelDraftMs  || 0,
    metrics.validationMs     || 0,
    metrics.assemblyMs       || 0,
    metrics.sectionCount     || 0,
    metrics.successCount     || 0,
    metrics.errorCount       || 0,
    metrics.retryCount       || 0,
    metrics.retrievalCacheHit ? 1 : 0,
    metrics.memoryItemsScanned || 0,
    metrics.memoryItemsUsed    || 0,
    JSON.stringify(metrics.warnings || []),
    JSON.stringify(metrics.summary  || {}),
    runId
  );
}

function completeRunRecord(runId, totalMs, status, draftPackage) {
  getDb().prepare(`
    UPDATE generation_runs SET
      status       = ?,
      completed_at = datetime('now'),
      duration_ms  = ?,
      partial_complete = ?
    WHERE id = ?
  `).run(
    status,
    totalMs,
    status === 'partial' ? 1 : 0,
    runId
  );
}

function failRunRecord(runId, errorText, totalMs) {
  getDb().prepare(`
    UPDATE generation_runs SET
      status       = 'failed',
      completed_at = datetime('now'),
      duration_ms  = ?,
      error_text   = ?
    WHERE id = ?
  `).run(totalMs || 0, String(errorText || 'unknown'), runId);
}

// ── Analysis jobs ─────────────────────────────────────────────────────────────

/**
 * Run all required analysis jobs for the report plan.
 * Returns a map of { [artifactType]: artifactData }.
 *
 * Analysis jobs produce structured data that is injected into section prompts.
 * They run before parallel section drafting.
 */
async function runAnalysisJobs(context, plan, runId) {
  const t0        = Date.now();
  const artifacts = {};

  for (const artifactType of (plan.analysisJobs || [])) {
    const tArt = Date.now();
    try {
      let data = null;

      switch (artifactType) {
        case 'comp_analysis':
          data = buildCompAnalysisArtifact(context);
          break;
        case 'market_analysis':
          data = buildMarketAnalysisArtifact(context);
          break;
        case 'hbu_logic':
          data = buildHbuLogicArtifact(context);
          break;
        default:
          data = { type: artifactType, note: 'no handler' };
      }

      artifacts[artifactType] = data;

      // Persist to SQLite
      const db = getDb();
      db.prepare(`
        INSERT INTO analysis_artifacts
          (id, run_id, artifact_type, data_json, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(uuidv4(), runId, artifactType, JSON.stringify(data), Date.now() - tArt);

      log('info', 'analysis', runId, {
        artifactType,
        durationMs: Date.now() - tArt,
        ok: true,
      });

    } catch (err) {
      log('error', 'analysis', runId, {
        artifactType,
        error: err.message,
        durationMs: Date.now() - tArt,
      });
      artifacts[artifactType] = { error: err.message };
    }
  }

  return { artifacts, durationMs: Date.now() - t0 };
}

// ── Analysis artifact builders ────────────────────────────────────────────────

function buildCompAnalysisArtifact(context) {
  const comps  = context.comps || [];
  const market = context.market || {};

  const adjustmentCategories = [];
  if (comps.length > 0) {
    const allAdjKeys = new Set();
    comps.forEach(c => {
      if (c.adjustments && typeof c.adjustments === 'object') {
        Object.keys(c.adjustments).forEach(k => allAdjKeys.add(k));
      }
    });
    adjustmentCategories.push(...allAdjKeys);
  }

  const mktAdj = Number(market.marketTimeAdjustmentPercent) || 0;

  const summary = [
    comps.length > 0
      ? `${comps.length} comparable sale(s) were analyzed.`
      : 'Comparable sales were analyzed.',
    adjustmentCategories.length > 0
      ? `Adjustments were applied for: ${adjustmentCategories.join(', ')}.`
      : '',
    mktAdj > 0
      ? `A market time adjustment of ${mktAdj}% was applied to all comparables.`
      : 'No market time adjustment was applied.',
  ].filter(Boolean).join(' ');

  return {
    type:                        'comp_analysis',
    compCount:                   comps.length,
    adjustmentCategories,
    marketTimeAdjustmentPercent: mktAdj,
    summary,
  };
}

function buildMarketAnalysisArtifact(context) {
  const market = context.market || {};
  const subject = context.subject || {};

  const lines = [];
  if (market.marketArea || subject.city) {
    lines.push(`Market area: ${market.marketArea || subject.city}`);
  }
  if (market.trend)    lines.push(`Market trend: ${market.trend}`);
  if (market.avgDom)   lines.push(`Average days on market: ${market.avgDom}`);
  if (market.priceLow && market.priceHigh) {
    lines.push(`Price range: $${market.priceLow.toLocaleString()} – $${market.priceHigh.toLocaleString()}`);
  }

  return {
    type:       'market_analysis',
    marketArea: market.marketArea || subject.city || '',
    trend:      market.trend      || null,
    avgDom:     market.avgDom     || null,
    priceLow:   market.priceLow   || null,
    priceHigh:  market.priceHigh  || null,
    summary:    lines.join('. ') || 'Market data not available.',
  };
}

function buildHbuLogicArtifact(context) {
  const site    = context.site    || {};
  const subject = context.subject || {};
  const flags   = context.flags   || {};

  const zoning = site.zoning || subject.zoning || 'residential';

  return {
    type:                'hbu_logic',
    zoning,
    legallyPermissible:  `The subject site is zoned ${zoning}, which permits the existing use.`,
    physicallyPossible:  'The site is of adequate size, shape, and topography to support the existing improvements.',
    financiallyFeasible: 'The existing use is financially feasible based on current market conditions.',
    maximallyProductive: 'The existing use as improved represents the maximally productive use of the site.',
    conclusion:          `As improved, the highest and best use of the subject property is its current use as a ${context.propertyType || 'residential'} property.`,
  };
}

// ── Parallel execution ────────────────────────────────────────────────────────

/**
 * Run section jobs in parallel batches of MAX_PARALLEL.
 * Returns { results: { [sectionId]: SectionJobResult }, durationMs }
 */
async function runParallelSections(sectionDefs, jobParams, runId) {
  const t0      = Date.now();
  const results = {};

  // Process in batches of MAX_PARALLEL
  for (let i = 0; i < sectionDefs.length; i += MAX_PARALLEL) {
    const batch = sectionDefs.slice(i, i + MAX_PARALLEL);

    log('info', 'parallel-batch', runId, {
      batch:    batch.map(s => s.id),
      batchNum: Math.floor(i / MAX_PARALLEL) + 1,
    });

    const batchResults = await Promise.allSettled(
      batch.map(sectionDef =>
        runSectionJob({ ...jobParams, sectionDef })
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const sectionDef = batch[j];
      const settled    = batchResults[j];

      if (settled.status === 'fulfilled') {
        results[sectionDef.id] = settled.value;
        log('info', 'section-complete', runId, {
          sectionId:  sectionDef.id,
          ok:         settled.value.ok,
          durationMs: settled.value.metrics?.durationMs,
          attempts:   settled.value.metrics?.attemptCount,
        });
      } else {
        results[sectionDef.id] = {
          ok:        false,
          sectionId: sectionDef.id,
          text:      '',
          error:     settled.reason?.message || 'promise rejected',
          metrics:   { durationMs: 0, attemptCount: 1 },
        };
        log('error', 'section-failed', runId, {
          sectionId: sectionDef.id,
          error:     settled.reason?.message,
        });
      }
    }
  }

  return { results, durationMs: Date.now() - t0 };
}

/**
 * Run dependent (synthesis) sections sequentially.
 * Each section receives the prior results as context.
 */
async function runDependentSections(sectionDefs, jobParams, priorResults, runId) {
  const t0      = Date.now();
  const results = { ...priorResults };

  for (const sectionDef of sectionDefs) {
    log('info', 'synthesis-start', runId, { sectionId: sectionDef.id });

    try {
      const result = await runSectionJob({
        ...jobParams,
        sectionDef,
        priorResults: results,
      });

      results[sectionDef.id] = result;

      log('info', 'synthesis-complete', runId, {
        sectionId:  sectionDef.id,
        ok:         result.ok,
        durationMs: result.metrics?.durationMs,
      });
    } catch (err) {
      results[sectionDef.id] = {
        ok:        false,
        sectionId: sectionDef.id,
        text:      '',
        error:     err.message,
        metrics:   { durationMs: 0, attemptCount: 1 },
      };
      log('error', 'synthesis-failed', runId, {
        sectionId: sectionDef.id,
        error:     err.message,
      });
    }
  }

  return { results, durationMs: Date.now() - t0 };
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

/**
 * Run the full-draft generation orchestrator for a case.
 *
 * @param {object} params
 *   @param {string} params.caseId
 *   @param {string} [params.formType]  — override form type (default: from case meta)
 *   @param {object} [params.options]   — future extension point
 *
 * @returns {Promise<OrchestratorResult>}
 *   {
 *     ok: boolean,
 *     runId: string,
 *     draftPackage: DraftPackage,
 *     metrics: object,
 *     error?: string,
 *   }
 */
export async function runFullDraftOrchestrator({ caseId, formType, options = {} }) {
  const runId  = uuidv4();
  const tTotal = Date.now();

  // Phase timing accumulators
  const phaseMs = {
    contextBuildMs:  0,
    reportPlanMs:    0,
    retrievalMs:     0,
    analysisMs:      0,
    parallelDraftMs: 0,
    validationMs:    0,
    assemblyMs:      0,
  };

  log('info', 'start', runId, { caseId, formType });

  // ── 1. Create generation run record ────────────────────────────────────────
  createRunRecord(runId, caseId, formType || 'unknown', null);
  markRunRunning(runId);

  try {
    // ── 2. Build assignment context ──────────────────────────────────────────
    const t2 = Date.now();
    const context = await buildAssignmentContext(caseId);
    phaseMs.contextBuildMs = Date.now() - t2;

    // Use context form type if not overridden
    const resolvedFormType = formType || context.formType || '1004';
    context.formType = resolvedFormType;

    log('info', 'context-built', runId, {
      formType:   resolvedFormType,
      caseId,
      durationMs: phaseMs.contextBuildMs,
      assignmentId: context.id,
    });

    // Update run with assignment ID
    getDb().prepare(`
      UPDATE generation_runs SET assignment_id = ?, form_type = ? WHERE id = ?
    `).run(context.id, resolvedFormType, runId);

    // ── 3. Build report plan ─────────────────────────────────────────────────
    const t3 = Date.now();
    const plan = buildReportPlan(context);
    phaseMs.reportPlanMs = Date.now() - t3;

    log('info', 'plan-built', runId, {
      totalSections:    plan.totalSections,
      parallelCount:    plan.parallelCount,
      dependentCount:   plan.dependentCount,
      analysisJobs:     plan.analysisJobs,
      estimatedMs:      plan.estimatedDurationMs,
      durationMs:       phaseMs.reportPlanMs,
    });

    // ── 4. Build retrieval pack ──────────────────────────────────────────────
    const t4 = Date.now();
    const retrievalPack = await buildRetrievalPack(context, plan);
    phaseMs.retrievalMs = Date.now() - t4;

    const retrievalStats = getRetrievalStats(retrievalPack);

    log('info', 'retrieval-built', runId, {
      fromCache:           retrievalStats.fromCache,
      totalMemoryScanned:  retrievalStats.totalMemoryScanned,
      totalExamplesUsed:   retrievalStats.totalExamplesUsed,
      durationMs:          phaseMs.retrievalMs,
    });

    // ── 5. Run analysis jobs ─────────────────────────────────────────────────
    const t5 = Date.now();
    const { artifacts: analysisArtifacts, durationMs: analysisDurationMs } =
      await runAnalysisJobs(context, plan, runId);
    phaseMs.analysisMs = analysisDurationMs;

    log('info', 'analysis-complete', runId, {
      artifactTypes: Object.keys(analysisArtifacts),
      durationMs:    phaseMs.analysisMs,
    });

    // ── 6. Execute parallel section jobs ────────────────────────────────────
    const parallelDefs = plan.sections.filter(s => s.dependsOn.length === 0);
    const jobParams    = {
      runId,
      caseId,
      context,
      retrievalPack,
      analysisArtifacts,
    };

    const t6 = Date.now();
    const { results: parallelResults, durationMs: parallelDraftMs } =
      await runParallelSections(parallelDefs, jobParams, runId);
    phaseMs.parallelDraftMs = parallelDraftMs;

    log('info', 'parallel-complete', runId, {
      sections:   Object.keys(parallelResults),
      succeeded:  Object.values(parallelResults).filter(r => r.ok).length,
      failed:     Object.values(parallelResults).filter(r => !r.ok).length,
      durationMs: phaseMs.parallelDraftMs,
    });

    // ── 7. Execute dependent synthesis sections ──────────────────────────────
    const dependentDefs = plan.sections.filter(s => s.dependsOn.length > 0);
    let allResults = { ...parallelResults };

    if (dependentDefs.length > 0) {
      const { results: dependentResults } =
        await runDependentSections(dependentDefs, jobParams, parallelResults, runId);
      allResults = { ...parallelResults, ...dependentResults };
    }

    // ── 8. Validate + assemble draft package ─────────────────────────────────
    const t8 = Date.now();

    const successCount = Object.values(allResults).filter(r => r?.ok).length;
    const errorCount   = Object.values(allResults).filter(r => !r?.ok).length;
    const retryCount   = Object.values(allResults)
      .filter(r => (r?.metrics?.attemptCount || 1) > 1).length;

    const totalDurationMs = Date.now() - tTotal;

    const runRecord = {
      totalDurationMs,
      contextBuildMs:  phaseMs.contextBuildMs,
      reportPlanMs:    phaseMs.reportPlanMs,
      retrievalMs:     phaseMs.retrievalMs,
      analysisMs:      phaseMs.analysisMs,
      parallelDraftMs: phaseMs.parallelDraftMs,
      validationMs:    0, // filled after assembly
      assemblyMs:      0, // filled after assembly
    };

    const { draftPackage, validation, warnings } = assembleDraftPackage({
      runId,
      caseId,
      context,
      plan,
      sectionResults:  allResults,
      retrievalStats,
      runRecord,
    });

    phaseMs.validationMs = draftPackage.metrics?.phaseTimings?.validationMs || 0;
    phaseMs.assemblyMs   = draftPackage.metrics?.phaseTimings?.assemblyMs   || 0;

    log('info', 'assembly-complete', runId, {
      status:       draftPackage.status,
      successCount,
      errorCount,
      warningCount: warnings.length,
      totalMs:      totalDurationMs,
      grade:        draftPackage.metrics?.performanceGrade,
    });

    // ── 9. Update run record with final metrics ──────────────────────────────
    const finalStatus = errorCount === 0
      ? 'completed'
      : errorCount < plan.totalSections
        ? 'partial'
        : 'failed';

    updateRunPhaseMetrics(runId, {
      ...phaseMs,
      sectionCount:        plan.totalSections,
      successCount,
      errorCount,
      retryCount,
      retrievalCacheHit:   retrievalStats.fromCache,
      memoryItemsScanned:  retrievalStats.totalMemoryScanned,
      memoryItemsUsed:     retrievalStats.totalExamplesUsed,
      warnings,
      summary: {
        totalDurationMs,
        grade: draftPackage.metrics?.performanceGrade,
      },
    });

    completeRunRecord(runId, totalDurationMs, finalStatus, draftPackage);

    log('info', 'run-complete', runId, {
      status:       finalStatus,
      totalMs:      totalDurationMs,
      successCount,
      errorCount,
      grade:        draftPackage.metrics?.performanceGrade,
    });

    return {
      ok:           true,
      runId,
      draftPackage,
      metrics:      draftPackage.metrics,
      validation,
      warnings,
    };

  } catch (err) {
    const totalMs = Date.now() - tTotal;
    failRunRecord(runId, err.message, totalMs);

    log('error', 'run-failed', runId, {
      error:   err.message,
      totalMs,
    });

    return {
      ok:    false,
      runId,
      error: err.message,
      draftPackage: null,
      metrics: { totalDurationMs: totalMs },
    };
  }
}

// ── Status + result queries ───────────────────────────────────────────────────

/**
 * Get the current status of a generation run.
 * Used by GET /api/generation/runs/:runId/status
 *
 * @param {string} runId
 * @returns {object|null}
 */
export function getRunStatus(runId) {
  const db  = getDb();
  const run = db.prepare(`
    SELECT id, case_id, form_type, status,
           started_at, completed_at, duration_ms,
           section_count, success_count, error_count, retry_count,
           context_build_ms, report_plan_ms, retrieval_ms,
           analysis_ms, parallel_draft_ms, validation_ms, assembly_ms,
           retrieval_cache_hit, memory_items_scanned, memory_items_used,
           warnings_json, error_text, created_at
      FROM generation_runs WHERE id = ?
  `).get(runId);

  if (!run) return null;

  // Get section job statuses
  const jobs = getSectionJobsForRun(runId);

  const elapsedMs = run.started_at
    ? Date.now() - new Date(run.started_at).getTime()
    : 0;

  // Normalize 'completed' → 'complete' so the polling contract is consistent
  // (SQLite stores 'completed'; the API contract uses 'complete')
  const normalizedStatus = run.status === 'completed' ? 'complete' : run.status;

  return {
    runId:            run.id,
    caseId:           run.case_id,
    formType:         run.form_type,
    status:           normalizedStatus,
    startedAt:        run.started_at,
    completedAt:      run.completed_at,
    durationMs:       run.duration_ms,
    elapsedMs:        run.status === 'running' ? elapsedMs : run.duration_ms,
    sectionsTotal:    run.section_count,
    sectionsCompleted: jobs.filter(j => j.status === 'completed').length,
    sectionsFailed:   jobs.filter(j => j.status === 'failed').length,
    sectionsPending:  jobs.filter(j => j.status === 'pending' || j.status === 'running').length,
    sectionStatuses:  jobs.map(j => ({
      sectionId:    j.section_id,
      status:       j.status,
      durationMs:   j.duration_ms,
      attemptCount: j.attempt_count,
      profile:      j.generator_profile,
    })),
    phaseTimings: {
      contextBuildMs:  run.context_build_ms,
      reportPlanMs:    run.report_plan_ms,
      retrievalMs:     run.retrieval_ms,
      analysisMs:      run.analysis_ms,
      parallelDraftMs: run.parallel_draft_ms,
      validationMs:    run.validation_ms,
      assemblyMs:      run.assembly_ms,
    },
    retrieval: {
      cacheHit:      !!run.retrieval_cache_hit,
      itemsScanned:  run.memory_items_scanned,
      itemsUsed:     run.memory_items_used,
    },
    warnings:  JSON.parse(run.warnings_json || '[]'),
    errorText: run.error_text || null,
  };
}

/**
 * Get all generation runs for a case.
 * Used by GET /api/cases/:caseId/generation-runs
 *
 * @param {string} caseId
 * @returns {object[]}
 */
export function getRunsForCase(caseId) {
  return getDb().prepare(`
    SELECT id, case_id, form_type, status,
           started_at, completed_at, duration_ms,
           section_count, success_count, error_count,
           created_at
      FROM generation_runs
     WHERE case_id = ?
     ORDER BY created_at DESC
     LIMIT 20
  `).all(caseId);
}

/**
 * Get the generated sections for a run (for the result endpoint).
 *
 * @param {string} runId
 * @returns {object[]}
 */
export function getGeneratedSectionsForRun(runId) {
  return getDb().prepare(`
    SELECT section_id, final_text, draft_text, approved, approved_at, inserted_at,
           examples_used, created_at
      FROM generated_sections
     WHERE run_id = ?
     ORDER BY created_at ASC
  `).all(runId);
}
