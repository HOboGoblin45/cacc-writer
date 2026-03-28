/**
 * server/orchestrator/draftAssembler.js
 * ---------------------------------------
 * Assembles the final DraftPackage from all section job results.
 *
 * Responsibilities:
 *   1. Validate completeness (all required sections present)
 *   2. Check cross-section consistency
 *   3. Generate warnings for missing or thin sections
 *   4. Compute run metrics summary
 *   5. Return a structured DraftPackage
 *
 * Performance target: < 1 second
 *
 * DraftPackage shape:
 *   {
 *     runId, caseId, formType, status,
 *     sections: { [sectionId]: { text, sectionId, label, ok, metrics } },
 *     warnings: [{ type, sectionId, message, severity }],
 *     validation: { ok, status, missingRequired, thinSections, warningCount },
 *     metrics: { totalDurationMs, phaseTimings, sectionMetrics, retrievalStats },
 *     insertionTargets: { [sectionId]: { software, tab/section } },
 *     _assembledAt: ISO string,
 *   }
 */

import { getSectionDefs } from '../context/reportPlanner.js';
import {
  buildSectionPolicy,
  buildDependencySnapshot,
  computeQualityScore,
  getPromptVersion,
} from '../services/sectionPolicyService.js';

// ── Minimum text length thresholds ────────────────────────────────────────────
const MIN_TEXT_LENGTH = {
  'template-heavy':     80,
  'retrieval-guided':  150,
  'data-driven':       100,
  'logic-template':    120,
  'analysis-narrative': 150,
  'synthesis':         100,
  default:              80,
};

// ── Warning types ─────────────────────────────────────────────────────────────
const WARNING_TYPES = {
  MISSING_REQUIRED:   'missing_required',
  THIN_SECTION:       'thin_section',
  SECTION_FAILED:     'section_failed',
  SECTION_RETRIED:    'section_retried',
  SLOW_SECTION:       'slow_section',
  CONSISTENCY:        'consistency',
  PERFORMANCE:        'performance',
};

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate the assembled draft.
 * Returns a validation result with warnings.
 */
function validateDraft(sectionResults, plan, warnings) {
  const sectionDefs = plan.sections || getSectionDefs(plan.formType);
  const missingRequired = [];
  const thinSections    = [];
  const failedSections  = [];

  for (const def of sectionDefs) {
    const result = sectionResults[def.id];

    if (!result || !result.ok || !result.text) {
      missingRequired.push(def.id);
      failedSections.push(def.id);
      warnings.push({
        type:      WARNING_TYPES.MISSING_REQUIRED,
        sectionId: def.id,
        message:   `Section "${def.label || def.id}" failed to generate`,
        severity:  'error',
      });
      continue;
    }

    // Check minimum length
    const minLen = MIN_TEXT_LENGTH[def.generatorProfile] || MIN_TEXT_LENGTH.default;
    if (result.text.length < minLen) {
      thinSections.push(def.id);
      warnings.push({
        type:      WARNING_TYPES.THIN_SECTION,
        sectionId: def.id,
        message:   `Section "${def.label || def.id}" is unusually short (${result.text.length} chars, min ${minLen})`,
        severity:  'warning',
      });
    }

    // Check for unresolved INSERT placeholders
    const insertCount = (result.text.match(/\[INSERT/gi) || []).length;
    if (insertCount > 0) {
      const severity = insertCount >= 3 ? 'error' : 'warning';
      warnings.push({
        type:      WARNING_TYPES.THIN_SECTION,
        sectionId: def.id,
        message:   `Section "${def.label || def.id}" has ${insertCount} unresolved [INSERT] placeholder${insertCount > 1 ? 's' : ''}`,
        severity,
      });
    }

    // Check for retried sections
    if (result.metrics?.attemptCount > 1) {
      warnings.push({
        type:      WARNING_TYPES.SECTION_RETRIED,
        sectionId: def.id,
        message:   `Section "${def.label || def.id}" required ${result.metrics.attemptCount} attempts`,
        severity:  'info',
      });
    }

    // Check for slow sections (> 15s)
    if (result.metrics?.durationMs > 15_000) {
      warnings.push({
        type:      WARNING_TYPES.SLOW_SECTION,
        sectionId: def.id,
        message:   `Section "${def.label || def.id}" took ${(result.metrics.durationMs / 1000).toFixed(1)}s`,
        severity:  'info',
      });
    }
  }

  // Consistency check: reconciliation should reference value conclusion and approaches
  const reconciliation = sectionResults['reconciliation'];
  if (reconciliation?.ok && reconciliation.text) {
    const hasValueRef = /value|opinion|conclusion|estimate/i.test(reconciliation.text);
    if (!hasValueRef) {
      warnings.push({
        type:      WARNING_TYPES.CONSISTENCY,
        sectionId: 'reconciliation',
        message:   'Reconciliation section may not contain a clear value conclusion',
        severity:  'warning',
      });
    }

    // Check that reconciliation references the sales comparison approach
    const hasSalesRef = /sales\s*comparison|comparable\s*sales|market\s*approach/i.test(reconciliation.text);
    if (!hasSalesRef) {
      warnings.push({
        type:      WARNING_TYPES.CONSISTENCY,
        sectionId: 'reconciliation',
        message:   'Reconciliation does not reference the Sales Comparison Approach',
        severity:  'warning',
      });
    }

    // Check that reconciliation addresses cost approach (developed or not)
    const hasCostRef = /cost\s*approach/i.test(reconciliation.text);
    if (!hasCostRef) {
      warnings.push({
        type:      WARNING_TYPES.CONSISTENCY,
        sectionId: 'reconciliation',
        message:   'Reconciliation does not address the Cost Approach',
        severity:  'warning',
      });
    }

    // Check that reconciliation addresses income approach (developed or not)
    const hasIncomeRef = /income\s*approach/i.test(reconciliation.text);
    if (!hasIncomeRef) {
      warnings.push({
        type:      WARNING_TYPES.CONSISTENCY,
        sectionId: 'reconciliation',
        message:   'Reconciliation does not address the Income Approach',
        severity:  'warning',
      });
    }
  }

  const allRequired = sectionDefs.filter(s => s.dependsOn.length === 0);
  const requiredComplete = allRequired.every(s => sectionResults[s.id]?.ok);

  const status = failedSections.length === 0
    ? 'draft_ready'
    : failedSections.length < sectionDefs.length
      ? 'draft_ready_with_warnings'
      : 'draft_failed';

  return {
    ok:              failedSections.length === 0,
    status,
    missingRequired: failedSections,
    thinSections,
    requiredComplete,
    warningCount:    warnings.length,
  };
}

// ── Metrics summary ───────────────────────────────────────────────────────────

function buildMetricsSummary(runRecord, sectionResults, retrievalStats) {
  const sectionMetrics = {};
  let totalInputChars  = 0;
  let totalOutputChars = 0;
  let totalRetries     = 0;

  for (const [sectionId, result] of Object.entries(sectionResults)) {
    if (result?.metrics) {
      sectionMetrics[sectionId] = {
        durationMs:   result.metrics.durationMs   || 0,
        inputChars:   result.metrics.inputChars   || 0,
        outputChars:  result.metrics.outputChars  || 0,
        attemptCount: result.metrics.attemptCount || 1,
        examplesUsed: result.metrics.examplesUsed || 0,
        profileId:    result.metrics.profileId    || 'unknown',
        ok:           result.ok,
      };
      totalInputChars  += result.metrics.inputChars  || 0;
      totalOutputChars += result.metrics.outputChars || 0;
      if ((result.metrics.attemptCount || 1) > 1) totalRetries++;
    }
  }

  return {
    totalDurationMs:    runRecord.totalDurationMs || 0,
    phaseTimings: {
      contextBuildMs:   runRecord.contextBuildMs   || 0,
      reportPlanMs:     runRecord.reportPlanMs     || 0,
      retrievalMs:      runRecord.retrievalMs      || 0,
      analysisMs:       runRecord.analysisMs       || 0,
      parallelDraftMs:  runRecord.parallelDraftMs  || 0,
      validationMs:     runRecord.validationMs     || 0,
      assemblyMs:       runRecord.assemblyMs       || 0,
    },
    sectionMetrics,
    retrieval: {
      totalMemoryScanned:  retrievalStats?.totalMemoryScanned  || 0,
      totalPhrasesScanned: retrievalStats?.totalPhrasesScanned || 0,
      totalExamplesUsed:   retrievalStats?.totalExamplesUsed   || 0,
      fromCache:           retrievalStats?.fromCache           || false,
      retrievalMs:         retrievalStats?.retrievalMs         || 0,
    },
    totals: {
      inputChars:   totalInputChars,
      outputChars:  totalOutputChars,
      totalRetries,
    },
    performanceGrade: gradePerformance(runRecord.totalDurationMs || 0),
  };
}

function gradePerformance(totalMs) {
  if (totalMs <= 12_000) return 'excellent';  // P50 target
  if (totalMs <= 20_000) return 'good';       // P90 target
  if (totalMs <= 30_000) return 'acceptable'; // warning threshold
  return 'slow';
}

// ── Insertion targets ─────────────────────────────────────────────────────────

function buildInsertionTargets(plan) {
  const targets = {};
  for (const def of (plan.sections || [])) {
    if (def.insertionTarget === 'aci') {
      targets[def.id] = { software: 'aci', tab: def.aciTab || null };
    } else if (def.insertionTarget === 'real_quantum') {
      targets[def.id] = { software: 'real_quantum', section: def.rqSection || null };
    }
  }
  return targets;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Assemble the final DraftPackage from all section results.
 *
 * @param {object} params
 *   @param {string} params.runId
 *   @param {string} params.caseId
 *   @param {object} params.context         — AssignmentContext
 *   @param {object} params.plan            — ReportPlan
 *   @param {object} params.sectionResults  — { [sectionId]: SectionJobResult }
 *   @param {object} params.retrievalStats  — from getRetrievalStats()
 *   @param {object} params.runRecord       — timing data from orchestrator
 *
 * @returns {{ draftPackage: object, validation: object, warnings: object[] }}
 */
export function assembleDraftPackage({
  runId,
  caseId,
  context,
  plan,
  sectionResults,
  retrievalStats = {},
  runRecord = {},
}) {
  const t0       = Date.now();
  const warnings = [];

  // ── Build sections map ────────────────────────────────────────────────────
  const sectionDefs = plan.sections || getSectionDefs(context.formType);
  const sections    = {};

  const facts = context?.facts || context?.subject ? context : {};
  for (const def of sectionDefs) {
    const result = sectionResults[def.id];
    const text = result?.text || '';

    // Phase D — section-level audit metadata
    const promptVersion = getPromptVersion(def.id);
    let qualityResult = null;
    let sectionPolicy = null;
    let dependencySnapshot = null;
    try {
      sectionPolicy = buildSectionPolicy(def.id, facts);
      dependencySnapshot = buildDependencySnapshot(def.id, facts);
      if (text) {
        qualityResult = computeQualityScore({
          sectionId: def.id,
          facts,
          generatedText: text,
          reviewPassed: result?.reviewPassed || false,
          examplesUsed: result?.metrics?.examplesUsed || 0,
        });
      }
    } catch {
      // Non-fatal — audit metadata is best-effort
    }

    sections[def.id] = {
      sectionId:       def.id,
      label:           def.label,
      generatorProfile: def.generatorProfile,
      ok:              result?.ok || false,
      text,
      metrics:         result?.metrics || {},
      error:           result?.error || null,
      promptVersion:   result?.promptVersion || null,
      sectionPolicy:   result?.sectionPolicy || null,
      auditMetadata:   result?.auditMetadata || null,
      qualityScore:    typeof result?.qualityScore === 'number' ? result.qualityScore : null,
      insertionTarget: def.insertionTarget,
      aciTab:          def.aciTab || null,
      rqSection:       def.rqSection || null,
      // Phase D audit metadata
      promptVersion,
      sectionPolicy:      sectionPolicy || null,
      dependencySnapshot: dependencySnapshot || null,
      qualityScore:       qualityResult?.score ?? null,
      qualityFactors:     qualityResult?.factors ?? null,
    };
  }

  // ── Validate ──────────────────────────────────────────────────────────────
  const validation = validateDraft(sectionResults, plan, warnings);

  // ── Performance warning ───────────────────────────────────────────────────
  if ((runRecord.totalDurationMs || 0) > 30_000) {
    warnings.push({
      type:      WARNING_TYPES.PERFORMANCE,
      sectionId: null,
      message:   `Full draft took ${((runRecord.totalDurationMs || 0) / 1000).toFixed(1)}s — exceeds 30s warning threshold`,
      severity:  'warning',
    });
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  const metrics = buildMetricsSummary(runRecord, sectionResults, retrievalStats);
  metrics.phaseTimings.assemblyMs = Date.now() - t0;

  // ── Insertion targets ─────────────────────────────────────────────────────
  const insertionTargets = buildInsertionTargets(plan);

  // ── Final package ─────────────────────────────────────────────────────────
  const draftPackage = {
    runId,
    caseId,
    formType:         context.formType,
    status:           validation.status,
    sections,
    warnings,
    validation,
    metrics,
    insertionTargets,
    sectionCount:     sectionDefs.length,
    successCount:     Object.values(sectionResults).filter(r => r?.ok).length,
    failureCount:     Object.values(sectionResults).filter(r => !r?.ok).length,
    _assembledAt:     new Date().toISOString(),
  };

  return { draftPackage, validation, warnings };
}

/**
 * Get a summary of a draft package suitable for the status endpoint.
 *
 * @param {object} draftPackage
 * @returns {object}
 */
export function getDraftSummary(draftPackage) {
  return {
    runId:        draftPackage.runId,
    caseId:       draftPackage.caseId,
    formType:     draftPackage.formType,
    status:       draftPackage.status,
    sectionCount: draftPackage.sectionCount,
    successCount: draftPackage.successCount,
    failureCount: draftPackage.failureCount,
    warningCount: draftPackage.warnings?.length || 0,
    totalDurationMs: draftPackage.metrics?.totalDurationMs || 0,
    performanceGrade: draftPackage.metrics?.performanceGrade || 'unknown',
  };
}
