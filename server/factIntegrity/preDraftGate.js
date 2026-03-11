/**
 * server/factIntegrity/preDraftGate.js
 * -------------------------------------
 * Phase C: deterministic pre-draft integrity gate.
 *
 * Blocks generation when:
 *  - required facts are missing for planned sections
 *  - blocker-level fact conflicts are present
 *
 * Also reports warnings for:
 *  - unresolved issues noted on the case
 *  - critical fact provenance gaps
 */

import { getCaseProjection } from '../caseRecord/caseRecordService.js';
import { getDb } from '../db/database.js';
import { getSectionDefs } from '../context/reportPlanner.js';
import { getSectionDependencies } from '../sectionDependencies.js';
import { detectFactConflicts } from './factConflictEngine.js';
import { normalizeAssignmentContextV2 } from '../intelligence/normalizer.js';
import { deriveAssignmentFlags } from '../intelligence/derivedFlags.js';
import { buildComplianceProfile } from '../intelligence/complianceProfile.js';
import { resolveReportFamily, getManifestForFormType } from '../intelligence/reportFamilyManifest.js';
import { getApplicableFields } from '../intelligence/canonicalFields.js';
import { buildSectionRequirementMatrix } from '../intelligence/sectionRequirementMatrix.js';
import { evaluateHardComplianceRules } from '../intelligence/hardComplianceRules.js';

const FACT_ALIASES = {
  'subject.siteSize': ['subject.lotSize', 'site.areaSqFt', 'site.siteSize'],
  'subject.zoning': ['site.zoning'],
  'subject.beds': ['subject.bedrooms'],
  'subject.baths': ['subject.bathrooms'],
  'subject.parcelId': ['subject.parcelNumber', 'site.parcelId'],
  'subject.style': ['subject.design'],
  'subject.quality': ['improvements.quality'],
  'contract.contractPrice': ['contract.salePrice', 'contract.price'],
  'contract.sellerConcessions': ['contract.concessions'],
  'contract.closingDate': ['contract.saleDate'],
  'contract.daysOnMarket': ['market.dom'],
};

const CRITICAL_PROVENANCE_PATHS = [
  'subject.address',
  'subject.gla',
  'subject.siteSize',
  'subject.parcelId',
  'contract.contractPrice',
  'contract.contractDate',
];
const CRITICAL_PENDING_REVIEW_PATHS = new Set(CRITICAL_PROVENANCE_PATHS);

function unique(values = []) {
  return [...new Set(values)];
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function resolvePath(root, dotPath) {
  if (!root || !dotPath) return null;
  const parts = String(dotPath).split('.');
  let current = root;

  for (const part of parts) {
    if (current === null || current === undefined) return null;
    const idx = Number(part);
    if (!Number.isNaN(idx) && Array.isArray(current)) {
      current = current[idx];
      continue;
    }
    current = current[part];
  }

  if (current === null || current === undefined) return null;
  if (typeof current === 'object' && !Array.isArray(current) && Object.prototype.hasOwnProperty.call(current, 'value')) {
    return current.value;
  }
  return current;
}

function candidatePaths(path) {
  return unique([path, ...(FACT_ALIASES[path] || [])]);
}

function hasFactValue(facts, path) {
  for (const candidatePath of candidatePaths(path)) {
    const value = resolvePath(facts, candidatePath);
    if (normalizeText(value)) return true;
  }
  return false;
}

function hasProvenanceEntry(provenance, path) {
  for (const candidatePath of candidatePaths(path)) {
    const direct = provenance?.[candidatePath];
    if (direct && (typeof direct !== 'object' || Object.keys(direct).length > 0)) return true;

    const nested = resolvePath(provenance, candidatePath);
    if (nested && (typeof nested !== 'object' || Object.keys(nested).length > 0)) return true;
  }
  return false;
}

function resolveSectionIds(formType, requestedSectionIds = null, sectionRequirements = null) {
  if (Array.isArray(requestedSectionIds) && requestedSectionIds.length) {
    return unique(
      requestedSectionIds
        .map(v => normalizeText(v))
        .filter(Boolean),
    );
  }

  const requiredFromMatrix = Array.isArray(sectionRequirements?.requiredSectionIds)
    ? sectionRequirements.requiredSectionIds.filter(Boolean)
    : [];
  if (requiredFromMatrix.length) return unique(requiredFromMatrix);

  return getSectionDefs(formType).map(section => section.id);
}

function buildIntelligenceDiagnostics(caseId, projection, resolvedFormType) {
  const context = normalizeAssignmentContextV2(
    caseId,
    {
      ...(projection.meta || {}),
      formType: resolvedFormType || projection?.meta?.formType || '1004',
    },
    projection.facts || {},
  );

  const flags = deriveAssignmentFlags(context);
  const compliance = buildComplianceProfile(context, flags);
  const reportFamilyId = resolveReportFamily(context.formType, flags);
  const manifest = getManifestForFormType(context.formType, flags);
  const applicableFields = getApplicableFields(flags, reportFamilyId);
  const sectionRequirements = buildSectionRequirementMatrix({
    manifest,
    flags,
    applicableFields,
  });
  const complianceChecks = evaluateHardComplianceRules({
    context,
    flags,
    compliance,
    sectionRequirements,
  });

  return {
    context,
    flags,
    compliance,
    sectionRequirements,
    complianceChecks,
  };
}

function collectMissingRequiredFacts(facts, sectionIds) {
  const bySection = [];
  const allRequiredPaths = [];

  for (const sectionId of sectionIds) {
    const deps = getSectionDependencies(sectionId);
    const required = Array.isArray(deps.required) ? deps.required : [];
    allRequiredPaths.push(...required);

    const missingPaths = required.filter(path => !hasFactValue(facts, path));
    if (!missingPaths.length) continue;

    bySection.push({
      sectionId,
      missingPaths,
      missingCount: missingPaths.length,
    });
  }

  const uniqueMissingPaths = unique(bySection.flatMap(section => section.missingPaths));
  return {
    bySection,
    uniqueMissingPaths,
    missingCount: uniqueMissingPaths.length,
    requiredPaths: unique(allRequiredPaths),
  };
}

function collectProvenanceWarnings(facts, provenance = {}, requiredPaths = []) {
  const consideredPaths = unique([...requiredPaths, ...CRITICAL_PROVENANCE_PATHS]);
  const gaps = [];
  let presentCount = 0;
  let withProvenanceCount = 0;

  for (const path of consideredPaths) {
    if (!hasFactValue(facts, path)) continue;
    presentCount++;
    if (hasProvenanceEntry(provenance, path)) {
      withProvenanceCount++;
      continue;
    }
    gaps.push(path);
  }

  const coveragePct = presentCount > 0
    ? Math.round((withProvenanceCount / presentCount) * 100)
    : 100;

  return {
    gaps,
    presentCount,
    withProvenanceCount,
    coveragePct,
  };
}

function collectPendingReviewQueue(caseId) {
  const db = getDb();

  const pendingFactRows = db.prepare(`
    SELECT id, fact_path, fact_value, confidence, document_id
      FROM extracted_facts
     WHERE case_id = ? AND review_status = 'pending'
     ORDER BY created_at ASC
     LIMIT 25
  `).all(caseId);

  const pendingFactPathRows = db.prepare(`
    SELECT fact_path, COUNT(*) AS count
      FROM extracted_facts
     WHERE case_id = ? AND review_status = 'pending'
     GROUP BY fact_path
     ORDER BY count DESC, fact_path ASC
  `).all(caseId);

  const pendingSectionRows = db.prepare(`
    SELECT id, section_type, section_label, confidence, document_id
      FROM extracted_sections
     WHERE case_id = ? AND review_status = 'pending'
     ORDER BY created_at ASC
     LIMIT 25
  `).all(caseId);

  const pendingFactsCount = db.prepare(`
    SELECT COUNT(*) AS count
      FROM extracted_facts
     WHERE case_id = ? AND review_status = 'pending'
  `).get(caseId)?.count || 0;

  const pendingSectionsCount = db.prepare(`
    SELECT COUNT(*) AS count
      FROM extracted_sections
     WHERE case_id = ? AND review_status = 'pending'
  `).get(caseId)?.count || 0;

  return {
    pendingFactsCount,
    pendingSectionsCount,
    pendingFacts: pendingFactRows,
    pendingFactPaths: pendingFactPathRows
      .map(row => ({
        factPath: normalizeText(row.fact_path),
        count: Number(row.count || 0),
      }))
      .filter(row => row.factPath),
    pendingSections: pendingSectionRows,
    truncated: pendingFactsCount > pendingFactRows.length || pendingSectionsCount > pendingSectionRows.length,
  };
}

function arePathsEquivalent(pathA, pathB) {
  const a = normalizeText(pathA);
  const b = normalizeText(pathB);
  if (!a || !b) return false;
  if (a === b) return true;
  const aCandidates = new Set(candidatePaths(a));
  const bCandidates = candidatePaths(b);
  return bCandidates.some(candidate => aCandidates.has(candidate));
}

function collectBlockingPendingFactPaths(pendingFactPaths = [], requiredPaths = []) {
  const blocking = [];
  for (const row of pendingFactPaths) {
    const factPath = normalizeText(row?.factPath);
    if (!factPath) continue;

    const isCritical = CRITICAL_PENDING_REVIEW_PATHS.has(factPath)
      || [...CRITICAL_PENDING_REVIEW_PATHS].some(criticalPath => arePathsEquivalent(criticalPath, factPath));
    const isRequiredForPlannedSections = requiredPaths.some(requiredPath => arePathsEquivalent(requiredPath, factPath));

    if (isCritical || isRequiredForPlannedSections) {
      blocking.push({
        factPath,
        count: Number(row.count || 0),
        critical: isCritical,
        requiredForPlannedSections: isRequiredForPlannedSections,
      });
    }
  }
  return blocking;
}

/**
 * Evaluate pre-draft data integrity gate for a case.
 *
 * @param {object} params
 * @param {string} params.caseId
 * @param {string} [params.formType]
 * @param {string[]} [params.sectionIds]
 * @returns {null|object}
 */
export function evaluatePreDraftGate({ caseId, formType = null, sectionIds = null }) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;

  const resolvedFormType = normalizeText(formType) || normalizeText(projection?.meta?.formType) || '1004';
  const intelligence = buildIntelligenceDiagnostics(caseId, projection, resolvedFormType);

  const resolvedSectionIds = resolveSectionIds(
    intelligence.context.formType || resolvedFormType,
    sectionIds,
    intelligence.sectionRequirements,
  );
  const knownSectionIds = new Set([
    ...getSectionDefs(intelligence.context.formType || resolvedFormType).map(section => section.id),
    ...((intelligence.sectionRequirements?.sections || []).map(section => section.sectionId)),
  ]);
  const validSectionIds = resolvedSectionIds.filter(sectionId => knownSectionIds.has(sectionId));
  const sectionsToCheck = validSectionIds.length ? validSectionIds : resolvedSectionIds;

  const missing = collectMissingRequiredFacts(projection.facts || {}, sectionsToCheck);
  const conflictReport = detectFactConflicts(caseId) || {
    summary: { blockerCount: 0, totalConflicts: 0 },
    conflicts: [],
  };
  const blockerConflicts = conflictReport.conflicts.filter(conflict => conflict.severity === 'blocker');
  const highConflicts = conflictReport.conflicts.filter(conflict => conflict.severity === 'high');

  const provenance = collectProvenanceWarnings(
    projection.facts || {},
    projection.provenance || {},
    missing.requiredPaths,
  );
  const pendingReview = collectPendingReviewQueue(caseId);
  const blockerPendingFactPaths = collectBlockingPendingFactPaths(
    pendingReview.pendingFactPaths,
    missing.requiredPaths,
  );

  const unresolvedIssues = Array.isArray(projection.meta?.unresolvedIssues)
    ? projection.meta.unresolvedIssues.filter(Boolean)
    : [];

  const blockers = [];
  if (missing.bySection.length) {
    blockers.push({
      type: 'missing_required_facts',
      message: 'One or more planned sections are missing required facts.',
      count: missing.bySection.length,
      sections: missing.bySection,
    });
  }
  if (blockerConflicts.length) {
    blockers.push({
      type: 'blocker_fact_conflicts',
      message: 'Blocker-level fact conflicts must be resolved before drafting.',
      count: blockerConflicts.length,
      conflicts: blockerConflicts,
    });
  }
  if ((intelligence.complianceChecks?.blockers || []).length) {
    blockers.push({
      type: 'compliance_hard_rules',
      message: 'Deterministic compliance hard-rule blockers were detected.',
      count: intelligence.complianceChecks.blockers.length,
      findings: intelligence.complianceChecks.blockers,
    });
  }
  if (blockerPendingFactPaths.length > 0) {
    blockers.push({
      type: 'pending_fact_reviews',
      message: 'Pending fact reviews exist on critical or required fact paths.',
      count: blockerPendingFactPaths.reduce((sum, row) => sum + row.count, 0),
      blockerPaths: blockerPendingFactPaths,
      pendingFactPathCount: pendingReview.pendingFactPaths.length,
      pendingFacts: pendingReview.pendingFacts,
      truncated: pendingReview.truncated,
    });
  }

  const warnings = [];
  if (highConflicts.length) {
    warnings.push({
      type: 'high_fact_conflicts',
      message: 'High-severity fact conflicts were detected.',
      count: highConflicts.length,
      conflicts: highConflicts,
    });
  }
  if (provenance.gaps.length) {
    warnings.push({
      type: 'provenance_gaps',
      message: 'Some key fact values are present without provenance links.',
      count: provenance.gaps.length,
      paths: provenance.gaps,
    });
  }
  if (unresolvedIssues.length) {
    warnings.push({
      type: 'unresolved_issues',
      message: 'Case has unresolved issues that should be reviewed.',
      count: unresolvedIssues.length,
      issues: unresolvedIssues,
    });
  }
  if ((intelligence.complianceChecks?.warnings || []).length) {
    warnings.push({
      type: 'compliance_warnings',
      message: 'Deterministic compliance warnings were detected.',
      count: intelligence.complianceChecks.warnings.length,
      findings: intelligence.complianceChecks.warnings,
    });
  }
  if (pendingReview.pendingSectionsCount > 0) {
    warnings.push({
      type: 'pending_section_reviews',
      message: 'Extracted narrative sections are pending review.',
      count: pendingReview.pendingSectionsCount,
      pendingSections: pendingReview.pendingSections,
      truncated: pendingReview.truncated,
    });
  }
  if (pendingReview.pendingFactsCount > 0 && blockerPendingFactPaths.length === 0) {
    warnings.push({
      type: 'pending_fact_reviews_non_blocking',
      message: 'Pending fact reviews exist on non-critical paths; review before finalization.',
      count: pendingReview.pendingFactsCount,
      pendingFactPathCount: pendingReview.pendingFactPaths.length,
      pendingFacts: pendingReview.pendingFacts,
      truncated: pendingReview.truncated,
    });
  }

  return {
    caseId,
    formType: intelligence.context.formType || resolvedFormType,
    sectionIds: sectionsToCheck,
    checkedAt: new Date().toISOString(),
    ok: blockers.length === 0,
    summary: {
      sectionsChecked: sectionsToCheck.length,
      missingRequiredFacts: missing.missingCount,
      blockerConflicts: blockerConflicts.length,
      complianceBlockers: intelligence.complianceChecks?.summary?.blockerCount || 0,
      pendingFactReviews: pendingReview.pendingFactsCount,
      blockerPendingFactPathCount: blockerPendingFactPaths.length,
      pendingSectionReviews: pendingReview.pendingSectionsCount,
      totalConflicts: conflictReport.summary.totalConflicts || 0,
      unresolvedIssues: unresolvedIssues.length,
      provenanceCoveragePct: provenance.coveragePct,
    },
    blockers,
    warnings,
    details: {
      missingRequiredBySection: missing.bySection,
      conflictSummary: conflictReport.summary,
      conflicts: conflictReport.conflicts,
      provenance: {
        checkedFactCount: provenance.presentCount,
        withProvenanceCount: provenance.withProvenanceCount,
        missingPaths: provenance.gaps,
        coveragePct: provenance.coveragePct,
      },
      pendingReview,
      blockerPendingFactPaths,
      intelligence: {
        reportFamilyId: intelligence.compliance?.report_family || null,
        activeFlags: Object.keys(intelligence.flags || {}).filter(flag => intelligence.flags[flag] === true),
        sectionRequirementsSummary: intelligence.sectionRequirements?.summary || null,
      },
      complianceChecks: intelligence.complianceChecks,
    },
  };
}
