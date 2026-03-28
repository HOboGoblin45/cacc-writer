/**
 * server/qc/qcRunEngine.js
 * --------------------------
 * Phase 7 — QC Run Engine
 *
 * Orchestrates a complete QC evaluation:
 *   1. Assembles needed inputs (draft package, assignment context, flags, etc.)
 *   2. Loads and registers all checker modules
 *   3. Runs applicable rules against the draft
 *   4. Persists findings to SQLite
 *   5. Builds and persists summary
 *   6. Supports re-run behavior
 *
 * Usage:
 *   import { runQC } from './qc/qcRunEngine.js';
 *   const result = await runQC({ caseId, generationRunId });
 */

import { getDb } from '../db/database.js';
import { getRunById, getGeneratedSectionsForRun } from '../db/repositories/generationRepo.js';
import log from '../logger.js';
import { getApplicableRules, RULE_SET_VERSION } from './qcRuleRegistry.js';
import { sortByPriority, filterNoise, computeDraftReadiness } from './severityModel.js';
import { buildQCSummary } from './summaryBuilder.js';
import {
  createQcRun,
  completeQcRun,
  failQcRun,
  insertFindings,
} from './qcRepo.js';

// ── Ensure all checker modules are loaded (side-effect: registers rules) ────
// These imports trigger registerRules() in each checker module.
import './checkers/requiredCoverageChecker.js';
import './checkers/crossSectionConsistencyChecker.js';
import './checkers/placeholderGenericityChecker.js';
import './checkers/complianceSignalChecker.js';
import './checkers/contradictionGraphChecker.js';
import './checkers/comparableIntelligenceChecker.js';
import './checkers/factCompletenessChecker.js';
import './checkers/uad36ComplianceChecker.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Load the assignment intelligence bundle for a case.
 * @param {string} caseId
 * @returns {object|null}
 */
function loadIntelligenceBundle(caseId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT bundle_json FROM assignment_intelligence WHERE case_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(caseId);

  if (!row || !row.bundle_json) return null;

  try {
    return JSON.parse(row.bundle_json);
  } catch {
    return null;
  }
}

/**
 * Load the assignment context for a case.
 * @param {string} caseId
 * @returns {object|null}
 */
function loadAssignmentContext(caseId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT context_json FROM assignments WHERE case_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(caseId);

  if (!row || !row.context_json) return null;

  try {
    return JSON.parse(row.context_json);
  } catch {
    return null;
  }
}

/**
 * Build the sections map from generated sections.
 * @param {object[]} generatedSections — rows from generated_sections table
 * @returns {Object<string, { text: string, ok: boolean }>}
 */
function buildSectionsMap(generatedSections) {
  const sections = {};
  for (const gs of generatedSections) {
    const text = gs.final_text || gs.draft_text || '';
    sections[gs.section_id] = {
      text,
      ok: text.trim().length > 0,
    };
  }
  return sections;
}

/**
 * Build the QCRuleContext from assembled inputs.
 * @param {object} params
 * @returns {import('./types.js').QCRuleContext}
 */
function buildRuleContext({ caseId, assignmentContext, flags, compliance, sectionPlan, reportFamily, canonicalFields, draftPackage, sections, formType, reportFamilyId }) {
  return {
    caseId,
    assignmentContext: assignmentContext || {},
    flags: flags || {},
    compliance: compliance || {},
    sectionPlan: sectionPlan || {},
    reportFamily: reportFamily || null,
    canonicalFields: canonicalFields || [],
    draftPackage: draftPackage || null,
    sections: sections || {},
    formType: formType || '1004',
    reportFamilyId: reportFamilyId || 'urar_1004',
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run a full QC evaluation on a draft package.
 *
 * @param {{
 *   caseId: string,
 *   generationRunId?: string,
 * }} params
 * @returns {Promise<{
 *   qcRunId: string,
 *   summary: import('./types.js').QCSummary,
 *   findings: import('./types.js').QCCheckResult[],
 *   draftReadiness: import('./types.js').DraftReadinessSignal,
 *   duration: number,
 * }>}
 */
export async function runQC({ caseId, generationRunId }) {
  const t0 = Date.now();

  // ── 1. Create QC run record ───────────────────────────────────────────
  let qcRunId;
  try {
    // Load intelligence bundle early to get flags for the run record
    const bundle = loadIntelligenceBundle(caseId);
    const flags = bundle?.flags || {};
    const reportFamilyId = bundle?.reportFamily?.familyId || null;

    const { id } = createQcRun({
      caseId,
      generationRunId: generationRunId || null,
      ruleSetVersion: RULE_SET_VERSION,
      reportFamily: reportFamilyId,
      flagsSnapshot: flags,
    });
    qcRunId = id;
  } catch (err) {
    throw new Error(`Failed to create QC run: ${err.message}`);
  }

  try {
    // ── 2. Assemble inputs ────────────────────────────────────────────────
    const bundle = loadIntelligenceBundle(caseId);
    const assignmentContext = loadAssignmentContext(caseId) || bundle?.context || {};
    const flags = bundle?.flags || {};
    const compliance = bundle?.compliance || {};
    const sectionPlan = bundle?.sectionPlan || {};
    const reportFamily = bundle?.reportFamily || null;
    const canonicalFields = bundle?.canonicalFields || [];
    const formType = assignmentContext.formType || '1004';
    const reportFamilyId = reportFamily?.familyId || 'urar_1004';

    // Load draft package
    let sections = {};
    let draftPackage = null;
    let allSectionIds = [];

    if (generationRunId) {
      const run = getRunById(generationRunId);
      if (!run) {
        throw new Error(`Generation run not found: ${generationRunId}`);
      }

      // Try to get draft package from persisted JSON
      if (run.draft_package_json) {
        try {
          draftPackage = JSON.parse(run.draft_package_json);
        } catch (e) { log.warn('[QC] failed to parse draft_package_json for run', generationRunId, e.message); }
      }

      // Load generated sections
      const generatedSections = getGeneratedSectionsForRun(generationRunId);
      sections = buildSectionsMap(generatedSections);
      allSectionIds = Object.keys(sections);
    } else {
      // No specific run — try to find the latest completed run for this case
      const db = getDb();
      const latestRun = db.prepare(`
        SELECT id, draft_package_json FROM generation_runs
        WHERE case_id = ? AND status IN ('complete', 'partial_complete')
        ORDER BY created_at DESC LIMIT 1
      `).get(caseId);

      if (latestRun) {
        generationRunId = latestRun.id;
        if (latestRun.draft_package_json) {
          try {
            draftPackage = JSON.parse(latestRun.draft_package_json);
          } catch (e) { log.warn('[QC] failed to parse draft_package_json for latest run', e.message); }
        }
        const generatedSections = getGeneratedSectionsForRun(latestRun.id);
        sections = buildSectionsMap(generatedSections);
        allSectionIds = Object.keys(sections);
      }
    }

    // ── 3. Build rule context ─────────────────────────────────────────────
    const ruleContext = buildRuleContext({
      caseId,
      assignmentContext,
      flags,
      compliance,
      sectionPlan,
      reportFamily,
      canonicalFields,
      draftPackage,
      sections,
      formType,
      reportFamilyId,
    });

    // ── 4. Get applicable rules ───────────────────────────────────────────
    const applicableRules = getApplicableRules({
      reportFamilyId,
      flags,
    });

    // ── 5. Execute all rules ──────────────────────────────────────────────
    let rawFindings = [];

    for (const rule of applicableRules) {
      if (!rule.check || typeof rule.check !== 'function') continue;

      try {
        const results = rule.check(ruleContext);
        if (Array.isArray(results)) {
          rawFindings.push(...results);
        }
      } catch (err) {
        // Rule execution failure — log but don't abort the run
        log.error('qcRunEngine:rule-failed', { ruleId: rule.ruleId, error: err.message });
        rawFindings.push({
          ruleId: rule.ruleId,
          severity: 'advisory',
          category: 'internal',
          sectionIds: [],
          canonicalFieldIds: [],
          message: `Rule execution error: ${rule.ruleId}`,
          detailMessage: `Rule ${rule.ruleId} threw an error during execution: ${err.message}. This finding is informational only.`,
          suggestedAction: 'Report this issue if it persists.',
          evidence: { type: 'error', errorMessage: err.message },
        });
      }
    }

    // ── 6. Sort and filter ────────────────────────────────────────────────
    const sortedFindings = sortByPriority(rawFindings);
    const filteredFindings = filterNoise(sortedFindings);

    // ── 7. Persist findings ───────────────────────────────────────────────
    const { count: findingCount } = insertFindings(qcRunId, filteredFindings);

    // ── 8. Build summary ──────────────────────────────────────────────────
    const summary = buildQCSummary(filteredFindings, { allSectionIds });
    const draftReadiness = computeDraftReadiness(filteredFindings);

    // ── 9. Complete QC run ────────────────────────────────────────────────
    const durationMs = Date.now() - t0;

    completeQcRun(qcRunId, {
      status: 'complete',
      summaryJson: summary,
      blockerCount: summary.severityCounts.blocker || 0,
      highCount: summary.severityCounts.high || 0,
      mediumCount: summary.severityCounts.medium || 0,
      lowCount: summary.severityCounts.low || 0,
      advisoryCount: summary.severityCounts.advisory || 0,
      totalFindings: findingCount,
      draftReadiness,
      durationMs,
    });

    return {
      qcRunId,
      summary,
      findings: filteredFindings,
      draftReadiness,
      duration: durationMs,
    };

  } catch (err) {
    // ── Failure path ────────────────────────────────────────────────────
    const durationMs = Date.now() - t0;
    failQcRun(qcRunId, err.message);

    throw new Error(`QC run failed: ${err.message}`);
  }
}

export default { runQC };
