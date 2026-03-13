/**
 * server/orchestrator/generationOrchestrator.js
 * -----------------------------------------------
 * Full-draft generation orchestrator for CACC Writer.
 *
 * Phase 3 — Workflow Authority
 *
 * Core principle:
 *   Build context once → Retrieve memory once → Analyze once →
 *   Draft sections in parallel → Validate once → Assemble → Persist
 *
 * Run lifecycle (canonical):
 *   queued → preparing → retrieving → analyzing → drafting →
 *   validating → assembling → complete | partial_complete | failed
 *
 * Section job lifecycle (canonical):
 *   queued (independent) | blocked (dependent) →
 *   running → retrying → complete | failed | skipped
 *
 * Concurrency: max 3 parallel section jobs
 * Retry policy: 1 retry per section
 *
 * Performance targets (1004 typical assignment):
 *   P50: < 12 seconds
 *   P90: < 20 seconds
 *   Warning: > 30 seconds
 *
 * Legacy path:
 *   POST /api/generate-batch remains fully operational alongside this.
 *   Do not remove the legacy path during Phase 3 transition.
 *
 * Usage:
 *   import { runFullDraftOrchestrator, getRunStatus, getRunResult } from './orchestrator/generationOrchestrator.js';
 *   const result = await runFullDraftOrchestrator({ caseId, formType });
 */

import { v4 as uuidv4 } from 'uuid';
import serverLog from '../logger.js';
import { buildAssignmentContext } from '../context/assignmentContextBuilder.js';
import { buildReportPlan } from '../context/reportPlanner.js';
import { buildRetrievalPack, getRetrievalStats } from '../context/retrievalPackBuilder.js';
import { buildRetrievalPackBundle as buildPhase6RetrievalBundle } from '../memory/retrievalPackBuilder.js';
import { runSectionJob } from './sectionJobRunner.js';
import { assembleDraftPackage } from './draftAssembler.js';
import { buildIntelligenceForOrchestrator } from '../intelligence/index.js';
import { evaluatePreDraftGate } from '../factIntegrity/preDraftGate.js';
import { buildFactDecisionQueue } from '../factIntegrity/factDecisionQueue.js';
import {
  RUN_STATUS,
  JOB_STATUS,
  createRun,
  updateRunStatus,
  updateRunAssignment,
  updateRunPhaseMetrics,
  persistDraftPackage,
  completeRun,
  failRun,
  getRunById,
  getRunsForCase,
  createSectionJob,
  markJobSkipped,
  getSectionJobsForRun,
  saveAnalysisArtifact,
  getGeneratedSectionsForRun,
} from '../db/repositories/generationRepo.js';
import { resolveSectionPolicy, buildDependencySnapshot } from '../sectionFactory/sectionPolicyService.js';
import { emitCaseEvent } from '../operations/auditLogger.js';

const MAX_PARALLEL = Number(process.env.MAX_PARALLEL_SECTIONS) || 5; // max concurrent section jobs
const ALLOW_FORCE_GATE_BYPASS = ['1', 'true', 'yes', 'on']
  .includes(String(process.env.CACC_ALLOW_FORCE_GATE_BYPASS || '').trim().toLowerCase());

// ── Structured logger ─────────────────────────────────────────────────────────

function log(level, phase, runId, data = {}) {
  const tag = `orchestrator:${phase}`;
  const entry = { runId: runId || 'none', ...data };
  if (level === 'error') {
    serverLog.error(tag, entry);
  } else {
    serverLog.info(tag, entry);
  }
}

function evaluateOrchestratorPreDraftGate({ caseId, formType = null, options = {} }) {
  const forceGateBypass = Boolean(options?.forceGateBypass);

  if (forceGateBypass && !ALLOW_FORCE_GATE_BYPASS) {
    return {
      ok: false,
      code: 'PRE_DRAFT_GATE_BYPASS_DISABLED',
      error: 'forceGateBypass is disabled in this environment',
    };
  }

  if (forceGateBypass) {
    return { ok: true, bypassed: true };
  }

  const gate = evaluatePreDraftGate({ caseId, formType: formType || null });
  if (!gate) {
    return {
      ok: false,
      code: 'CASE_NOT_FOUND',
      error: `Case not found: ${caseId}`,
    };
  }
  if (gate.ok) {
    return { ok: true, bypassed: false };
  }

  const queue = buildFactDecisionQueue(caseId);
  return {
    ok: false,
    code: 'PRE_DRAFT_GATE_BLOCKED',
    error: 'Pre-draft integrity gate blocked orchestrator run',
    gate,
    factReviewQueuePath: `/api/cases/${caseId}/fact-review-queue`,
    factReviewQueueSummary: queue?.summary || null,
  };
}

// ── Pre-create section job records ────────────────────────────────────────────

/**
 * Pre-create section job records for all planned sections at run start.
 *
 * This gives the UI and logs immediate full visibility into the planned run:
 *   - Independent sections → JOB_STATUS.QUEUED
 *   - Dependent sections   → JOB_STATUS.BLOCKED
 *
 * Returns a Map<sectionId, jobId> for use throughout the run.
 *
 * @param {object} plan   — ReportPlan from buildReportPlan()
 * @param {string} runId
 * @returns {Map<string, string>} sectionId → jobId
 */
function preCreateSectionJobs(plan, runId) {
  const jobMap = new Map();

  for (const sectionDef of plan.sections) {
    const isDependent = sectionDef.dependsOn && sectionDef.dependsOn.length > 0;
    const initialStatus = isDependent ? JOB_STATUS.BLOCKED : JOB_STATUS.QUEUED;
    const sectionPolicy = resolveSectionPolicy({
      formType: plan.formType || '1004',
      sectionDef,
    });

    const jobId = createSectionJob({
      runId,
      sectionId:  sectionDef.id,
      status:     initialStatus,
      profileId:  sectionDef.generatorProfile || 'retrieval-guided',
      dependsOn:  sectionDef.dependsOn || [],
      promptVersion: sectionPolicy.promptVersion,
      sectionPolicy,
      dependencySnapshot: buildDependencySnapshot({
        sectionPolicy,
        generatedSections: [],
      }),
    });

    jobMap.set(sectionDef.id, jobId);
  }

  log('info', 'jobs-precreated', runId, {
    total:     plan.sections.length,
    queued:    plan.sections.filter(s => !s.dependsOn?.length).length,
    blocked:   plan.sections.filter(s => s.dependsOn?.length > 0).length,
  });

  return jobMap;
}

function parseJsonSafe(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// ── Analysis jobs ─────────────────────────────────────────────────────────────

/**
 * Run all required analysis jobs for the report plan.
 * Returns a map of { [artifactType]: artifactData }.
 *
 * Analysis jobs produce structured data injected into section prompts.
 * They run before parallel section drafting.
 * Results are persisted to analysis_artifacts via generationRepo.
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

      // Persist to SQLite via generationRepo
      saveAnalysisArtifact({
        runId,
        artifactType,
        data,
        durationMs: Date.now() - tArt,
      });

      log('info', 'analysis', runId, {
        artifactType,
        durationMs: Date.now() - tArt,
        ok: true,
      });

    } catch (err) {
      log('error', 'analysis', runId, {
        artifactType,
        error:     err.message,
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
  const market  = context.market  || {};
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
 * Run independent section jobs in parallel batches of MAX_PARALLEL.
 * Each section receives its pre-created jobId.
 *
 * Returns { results: { [sectionId]: SectionJobResult }, durationMs }
 */
async function runParallelSections(sectionDefs, jobParams, jobMap, runId) {
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
        runSectionJob({
          ...jobParams,
          sectionDef,
          existingJobId: jobMap.get(sectionDef.id),
        })
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
 * Each section receives its pre-created jobId and prior results as context.
 *
 * If a section's prerequisites all failed, the section is skipped.
 */
async function runDependentSections(sectionDefs, jobParams, priorResults, jobMap, runId) {
  const t0      = Date.now();
  const results = { ...priorResults };

  for (const sectionDef of sectionDefs) {
    const jobId = jobMap.get(sectionDef.id);

    // Check if all prerequisites completed successfully
    const prereqsFailed = sectionDef.dependsOn.every(
      depId => !results[depId]?.ok
    );

    if (prereqsFailed && sectionDef.dependsOn.length > 0) {
      // Skip this section — all prerequisites failed
      if (jobId) {
        markJobSkipped(jobId, `All prerequisites failed: ${sectionDef.dependsOn.join(', ')}`);
      }
      results[sectionDef.id] = {
        ok:        false,
        sectionId: sectionDef.id,
        text:      '',
        error:     'skipped — all prerequisites failed',
        metrics:   { durationMs: 0, attemptCount: 0 },
      };
      log('info', 'section-skipped', runId, {
        sectionId: sectionDef.id,
        reason:    'all prerequisites failed',
      });
      continue;
    }

    log('info', 'synthesis-start', runId, { sectionId: sectionDef.id });

    try {
      const result = await runSectionJob({
        ...jobParams,
        sectionDef,
        priorResults: results,
        existingJobId: jobId,
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

  // ── 1. Create generation run record (status: queued) ───────────────────────
  createRun({ runId, caseId, formType: formType || 'unknown', assignmentId: null });

  const gateCheck = evaluateOrchestratorPreDraftGate({ caseId, formType, options });
  if (!gateCheck.ok) {
    const totalMs = Date.now() - tTotal;
    failRun(runId, `${gateCheck.code}: ${gateCheck.error}`, totalMs);
    log('info', 'pre-draft-gate-blocked', runId, {
      caseId,
      code: gateCheck.code,
      gateSummary: gateCheck.gate?.summary || null,
      totalMs,
    });
    return {
      ok: false,
      runId,
      code: gateCheck.code,
      error: gateCheck.error,
      gate: gateCheck.gate || null,
      factReviewQueuePath: gateCheck.factReviewQueuePath || null,
      factReviewQueueSummary: gateCheck.factReviewQueueSummary || null,
      draftPackage: null,
      metrics: { totalDurationMs: totalMs },
    };
  }
  if (gateCheck.bypassed) {
    log('info', 'pre-draft-gate-bypassed', runId, {
      caseId,
      reason: 'forceGateBypass=true',
    });
    emitCaseEvent(caseId, 'generation.gate_bypassed', 'Pre-draft gate bypassed by user', {
      blockerCount: gateCheck.gate?.blockers?.length || 0,
      blockerTypes: (gateCheck.gate?.blockers || []).map(b => b.type),
    }, { severity: 'warning' });
  }

  emitCaseEvent(caseId, 'generation.started', 'Full-draft generation started', {
    runId,
    formType: formType || 'unknown',
    gateBypassed: !!gateCheck.bypassed,
  });

  try {
    // ── 2. Transition to preparing — build assignment context ────────────────
    updateRunStatus(runId, RUN_STATUS.PREPARING);

    let context, plan, intelligenceBundle = null;
    const useIntelligence = options.useIntelligence !== false; // default: true

    const t2 = Date.now();

    if (useIntelligence) {
      try {
        // Phase 4 path: build intelligence bundle → get v2 context + smart plan
        const intel = await buildIntelligenceForOrchestrator(caseId);
        context = intel.context;
        plan = intel.orchestratorPlan;
        intelligenceBundle = intel.bundle;

        // Apply form type override if provided
        const resolvedFormType = formType || context.formType || '1004';
        context.formType = resolvedFormType;

        phaseMs.contextBuildMs = Date.now() - t2;

        log('info', 'intelligence-built', runId, {
          formType:     resolvedFormType,
          caseId,
          flags:        intelligenceBundle.flagSummary.count,
          sections:     plan.totalSections,
          reportFamily: intelligenceBundle.reportFamily.id,
          durationMs:   phaseMs.contextBuildMs,
          assignmentId: context.id,
        });

        // Report plan timing is included in the intelligence build
        phaseMs.reportPlanMs = intelligenceBundle.sectionPlan._buildMs || 0;

      } catch (err) {
        // Fall back to Phase 3 path
        log('info', 'intelligence-fallback', runId, {
          reason: err.message,
          caseId,
        });
        context = null;
        plan = null;
      }
    }

    // Phase 3 fallback path (or if intelligence is disabled)
    if (!context) {
      context = await buildAssignmentContext(caseId);
      phaseMs.contextBuildMs = Date.now() - t2;

      const resolvedFormType = formType || context.formType || '1004';
      context.formType = resolvedFormType;

      const t3 = Date.now();
      plan = buildReportPlan(context);
      phaseMs.reportPlanMs = Date.now() - t3;
    }

    log('info', 'context-built', runId, {
      formType:     context.formType,
      caseId,
      durationMs:   phaseMs.contextBuildMs,
      assignmentId: context.id,
      intelligence: !!intelligenceBundle,
    });

    // Update run with resolved assignment ID and form type
    updateRunAssignment(runId, context.id, context.formType);

    log('info', 'plan-built', runId, {
      totalSections:  plan.totalSections,
      parallelCount:  plan.parallelCount,
      dependentCount: plan.dependentCount,
      analysisJobs:   plan.analysisJobs,
      estimatedMs:    plan.estimatedDurationMs,
      durationMs:     phaseMs.reportPlanMs,
      version:        intelligenceBundle ? '2.0' : '1.0',
    });

    // ── 4. Pre-create all section job records ────────────────────────────────
    // Independent sections → queued, Dependent sections → blocked
    // This gives the UI immediate full visibility into the planned run.
    const jobMap = preCreateSectionJobs(plan, runId);

    // ── 5. Transition to retrieving — build retrieval pack ───────────────────
    updateRunStatus(runId, RUN_STATUS.RETRIEVING);

    const t5            = Date.now();
    const retrievalPack = await buildRetrievalPack(context, plan);

    // Phase 6: Build enhanced retrieval pack bundle with voice/memory
    let phase6Pack = null;
    try {
      phase6Pack = buildPhase6RetrievalBundle({
        assignmentContext: context,
        reportPlan:        plan,
        reportFamily:      intelligenceBundle?.reportFamily?.id || context.reportFamily || null,
        formType:          context.formType,
      });
      log('info', 'phase6-retrieval-built', runId, {
        sectionCount:  phase6Pack.sectionCount,
        totalDurationMs: phase6Pack.totalDurationMs,
      });
    } catch (err) {
      log('warn', 'phase6-retrieval-failed', runId, {
        reason: err.message,
        stack: err.stack?.split('\n').slice(0, 3).join(' | '),
        impact: 'Voice hints, disallowed phrases, and scored memory ranking unavailable. Falling back to Phase 3 retrieval.',
      });
      // Non-fatal: Phase 3 pack is the fallback, but memory quality will be reduced
    }

    phaseMs.retrievalMs = Date.now() - t5;

    const retrievalStats = getRetrievalStats(retrievalPack);

    log('info', 'retrieval-built', runId, {
      fromCache:          retrievalStats.fromCache,
      totalMemoryScanned: retrievalStats.totalMemoryScanned,
      totalExamplesUsed:  retrievalStats.totalExamplesUsed,
      phase6Available:    !!phase6Pack,
      durationMs:         phaseMs.retrievalMs,
    });

    // ── 6. Transition to analyzing — run analysis jobs ───────────────────────
    updateRunStatus(runId, RUN_STATUS.ANALYZING);

    const { artifacts: analysisArtifacts, durationMs: analysisDurationMs } =
      await runAnalysisJobs(context, plan, runId);
    phaseMs.analysisMs = analysisDurationMs;

    log('info', 'analysis-complete', runId, {
      artifactTypes: Object.keys(analysisArtifacts),
      durationMs:    phaseMs.analysisMs,
    });

    // ── 7. Transition to drafting — execute section jobs ─────────────────────
    updateRunStatus(runId, RUN_STATUS.DRAFTING);

    const parallelDefs = plan.sections.filter(s => s.dependsOn.length === 0);
    const jobParams    = {
      runId,
      caseId,
      context,
      retrievalPack,
      phase6Pack,
      analysisArtifacts,
    };

    const { results: parallelResults, durationMs: parallelDraftMs } =
      await runParallelSections(parallelDefs, jobParams, jobMap, runId);
    phaseMs.parallelDraftMs = parallelDraftMs;

    log('info', 'parallel-complete', runId, {
      sections:   Object.keys(parallelResults),
      succeeded:  Object.values(parallelResults).filter(r => r.ok).length,
      failed:     Object.values(parallelResults).filter(r => !r.ok).length,
      durationMs: phaseMs.parallelDraftMs,
    });

    // ── 8. Execute dependent synthesis sections ──────────────────────────────
    const dependentDefs = plan.sections.filter(s => s.dependsOn.length > 0);
    let allResults = { ...parallelResults };

    if (dependentDefs.length > 0) {
      const { results: dependentResults } =
        await runDependentSections(dependentDefs, jobParams, parallelResults, jobMap, runId);
      allResults = { ...parallelResults, ...dependentResults };
    }

    // ── 9. Transition to validating ──────────────────────────────────────────
    updateRunStatus(runId, RUN_STATUS.VALIDATING);

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

    // ── 10. Transition to assembling — assemble draft package ────────────────
    updateRunStatus(runId, RUN_STATUS.ASSEMBLING);

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

    // ── 11. Persist phase metrics ────────────────────────────────────────────
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

    // ── 12. Persist draft package to SQLite ──────────────────────────────────
    // Enables result retrieval after server restart without re-querying all sections.
    persistDraftPackage(runId, draftPackage);

    // ── 13. Finalize run status ──────────────────────────────────────────────
    const finalStatus = errorCount === 0
      ? RUN_STATUS.COMPLETE
      : errorCount < plan.totalSections
        ? RUN_STATUS.PARTIAL_COMPLETE
        : RUN_STATUS.FAILED;

    completeRun(runId, finalStatus, Date.now() - tTotal);

    log('info', 'run-complete', runId, {
      status:       finalStatus,
      totalMs:      Date.now() - tTotal,
      successCount,
      errorCount,
      grade:        draftPackage.metrics?.performanceGrade,
    });

    emitCaseEvent(caseId, 'generation.completed', 'Full-draft generation completed', {
      runId,
      status: finalStatus,
      totalDurationMs: Date.now() - tTotal,
      successCount,
      errorCount,
      grade: draftPackage.metrics?.performanceGrade,
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
    failRun(runId, err.message, totalMs);

    log('error', 'run-failed', runId, {
      error:   err.message,
      totalMs,
    });

    emitCaseEvent(caseId, 'generation.failed', 'Full-draft generation failed', {
      runId,
      error: err.message,
      totalDurationMs: totalMs,
    }, { severity: 'error' });

    return {
      ok:           false,
      runId,
      error:        err.message,
      draftPackage: null,
      metrics:      { totalDurationMs: totalMs },
    };
  }
}

// ── Status + result queries ───────────────────────────────────────────────────

/**
 * Get the current status of a generation run.
 * Used by GET /api/generation/runs/:runId/status
 *
 * Returns the canonical run status model.
 * Includes a thin backward-compat 'legacyStatus' field for older consumers.
 *
 * @param {string} runId
 * @returns {object|null}
 */
export function getRunStatus(runId) {
  const run = getRunById(runId);
  if (!run) return null;

  // Get section job statuses
  const jobs = getSectionJobsForRun(runId);

  const elapsedMs = run.started_at
    ? Date.now() - new Date(run.started_at).getTime()
    : 0;

  // Thin backward-compat mapping for legacy consumers
  // The canonical status is always the new model.
  const legacyStatusMap = {
    [RUN_STATUS.QUEUED]:          'pending',
    [RUN_STATUS.PREPARING]:       'running',
    [RUN_STATUS.RETRIEVING]:      'running',
    [RUN_STATUS.ANALYZING]:       'running',
    [RUN_STATUS.DRAFTING]:        'running',
    [RUN_STATUS.VALIDATING]:      'running',
    [RUN_STATUS.ASSEMBLING]:      'running',
    [RUN_STATUS.COMPLETE]:        'complete',
    [RUN_STATUS.PARTIAL_COMPLETE]: 'partial_complete',
    [RUN_STATUS.FAILED]:          'failed',
  };

  const canonicalStatus = run.status;
  const legacyStatus    = legacyStatusMap[canonicalStatus] || canonicalStatus;

  return {
    runId:             run.id,
    caseId:            run.case_id,
    formType:          run.form_type,
    status:            canonicalStatus,   // canonical — use this
    legacyStatus,                         // backward-compat only — do not build new logic on this
    startedAt:         run.started_at,
    completedAt:       run.completed_at,
    durationMs:        run.duration_ms,
    elapsedMs:         run.status === RUN_STATUS.DRAFTING ||
                       run.status === RUN_STATUS.RETRIEVING ||
                       run.status === RUN_STATUS.ANALYZING ||
                       run.status === RUN_STATUS.PREPARING ||
                       run.status === RUN_STATUS.VALIDATING ||
                       run.status === RUN_STATUS.ASSEMBLING
                         ? elapsedMs
                         : run.duration_ms,
    sectionsTotal:     run.section_count,
    sectionsCompleted: jobs.filter(j => j.status === JOB_STATUS.COMPLETE).length,
    sectionsFailed:    jobs.filter(j => j.status === JOB_STATUS.FAILED).length,
    sectionsBlocked:   jobs.filter(j => j.status === JOB_STATUS.BLOCKED).length,
    sectionsQueued:    jobs.filter(j => j.status === JOB_STATUS.QUEUED).length,
    sectionsRunning:   jobs.filter(j => j.status === JOB_STATUS.RUNNING || j.status === JOB_STATUS.RETRYING).length,
    sectionsSkipped:   jobs.filter(j => j.status === JOB_STATUS.SKIPPED).length,
    sectionStatuses:   jobs.map(j => ({
      sectionId:    j.section_id,
      status:       j.status,
      durationMs:   j.duration_ms,
      attemptCount: j.attempt_count,
      profile:      j.generator_profile,
      promptVersion: j.prompt_version || null,
      sectionPolicy: parseJsonSafe(j.section_policy_json, null),
      dependencySnapshot: parseJsonSafe(j.dependency_snapshot_json, null),
      errorText:    j.error_text || null,
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
      cacheHit:     !!run.retrieval_cache_hit,
      itemsScanned: run.memory_items_scanned,
      itemsUsed:    run.memory_items_used,
    },
    warnings:  JSON.parse(run.warnings_json || '[]'),
    errorText: run.error_text || null,
  };
}

/**
 * Get the full result of a completed generation run.
 * Attempts to reconstruct from persisted draft_package_json first.
 * Falls back to section-by-section reconstruction from generated_sections.
 *
 * @param {string} runId
 * @returns {object|null}
 */
export function getRunResult(runId) {
  const run = getRunById(runId);
  if (!run) return null;

  // Fast path: draft package was persisted to SQLite
  if (run.draft_package_json) {
    try {
      const draftPackage = JSON.parse(run.draft_package_json);
      return {
        runId,
        status:       run.status,
        draftPackage,
        sections:     draftPackage.sections || {},
        metrics:      draftPackage.metrics  || {},
        warnings:     draftPackage.warnings || [],
        fromCache:    true,
      };
    } catch {
      // Fall through to section reconstruction
    }
  }

  // Fallback: reconstruct from generated_sections rows
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
      auditMetadata: parseJsonSafe(s.audit_metadata_json, {}),
      qualityScore: typeof s.quality_score === 'number' ? s.quality_score : null,
      qualityMetadata: parseJsonSafe(s.quality_metadata_json, {}),
    };
  }

  return {
    runId,
    status:    run.status,
    sections:  sectionsMap,
    metrics:   JSON.parse(run.metrics_json || '{}'),
    warnings:  JSON.parse(run.warnings_json || '[]'),
    fromCache: false,
  };
}

/**
 * Get all generation runs for a case.
 * Used by GET /api/cases/:caseId/generation-runs
 *
 * @param {string} caseId
 * @returns {object[]}
 */
export { getRunsForCase };

/**
 * Get the generated sections for a run (for the result endpoint).
 *
 * @param {string} runId
 * @returns {object[]}
 */
export { getGeneratedSectionsForRun };
