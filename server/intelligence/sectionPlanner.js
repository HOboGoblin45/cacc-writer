/**
 * server/intelligence/sectionPlanner.js
 * ----------------------------------------
 * Phase 4 — Section Planning Engine v2
 *
 * Uses the full assignment intelligence stack to produce a detailed,
 * flag-driven section plan. This replaces the hardcoded SECTION_PLANS
 * approach in reportPlanner.js with an intelligence-aware planner.
 *
 * Inputs:
 *   - NormalizedAssignmentContext (v2)
 *   - DerivedAssignmentFlags
 *   - ComplianceProfile
 *   - ReportFamilyManifest
 *   - Applicable canonical fields
 *
 * Output: SectionPlanV2
 *   - which sections/jobs are required
 *   - which sections are optional
 *   - which canonical fields should be generated
 *   - which special commentary blocks are required
 *   - dependency ordering
 *   - QC tags per section
 *   - what should be excluded
 *
 * This makes the orchestrator smarter without replacing the Phase 3
 * orchestrator itself. The orchestrator continues to execute the plan;
 * this module produces a better plan.
 *
 * Usage:
 *   import { buildSectionPlanV2 } from './intelligence/sectionPlanner.js';
 *   const plan = buildSectionPlanV2(ctx, flags, compliance, manifest, applicableFields);
 */

import { v4 as uuidv4 } from 'uuid';
import { getFieldDefinition } from '../fieldRegistry.js';

// ── Generator profile resolution ────────────────────────────────────────────
// Maps content types to default generator profiles.

const CONTENT_TYPE_PROFILES = {
  narrative:    'retrieval-guided',
  commentary:   'data-driven',
  analysis:     'analysis-narrative',
  boilerplate:  'template-heavy',
};

// ── Section priority mapping ────────────────────────────────────────────────

const SECTION_GROUP_PRIORITY = {
  contract:         1,
  neighborhood:     2,
  site:             3,
  improvements:     4,
  condo_project:    4,
  manufactured_home: 4,
  property_data:    4,
  introduction:     1,
  market_data:      2,
  highest_best_use: 5,
  sales_comparison: 6,
  cost_approach:    7,
  income_approach:  7,
  market_rent:      7,
  reconciliation:   8,
};

// ── Core planner ────────────────────────────────────────────────────────────

/**
 * Build a v2 section plan from the full intelligence stack.
 *
 * @param {object} ctx         — NormalizedAssignmentContext v2
 * @param {object} flags       — DerivedAssignmentFlags
 * @param {object} compliance  — ComplianceProfile
 * @param {object} manifest    — ReportFamilyManifest
 * @param {object[]} applicableFields — from getApplicableFields()
 * @returns {object} SectionPlanV2
 */
export function buildSectionPlanV2(ctx, flags, compliance, manifest, applicableFields) {
  const t0 = Date.now();

  const requiredSet = new Set(manifest.requiredSections || []);
  const activeConditionalSet = new Set(
    (manifest.conditionalSections || [])
      .filter(section => section.condition === 'always' || flags[section.condition] === true)
      .map(section => section.sectionId),
  );
  const dependencyHints = manifest.dependencyHints || {};

  // ── 1. Classify each applicable field ─────────────────────────────────

  const sections = [];
  const commentaryBlocks = [];
  const excludedSections = [];
  const fieldIdSet = new Set();

  for (const field of applicableFields) {
    // Avoid duplicates
    if (fieldIdSet.has(field.fieldId)) continue;
    fieldIdSet.add(field.fieldId);

    const isRequired = requiredSet.has(field.fieldId) || activeConditionalSet.has(field.fieldId);
    const isCommentary = field.contentType === 'commentary';
    const isTriggered = field.triggeringFlags.length === 0 ||
      field.triggeringFlags.some(f => flags[f] === true);

    if (!isTriggered) {
      excludedSections.push({
        fieldId: field.fieldId,
        label:   field.label,
        reason:  `Triggering flags not active: ${field.triggeringFlags.join(', ')}`,
      });
      continue;
    }

    const priority = SECTION_GROUP_PRIORITY[field.sectionGroup] ?? 5;
    const dependsOn = dependencyHints[field.fieldId] || [];
    const generatorProfile = resolveGeneratorProfile(field);

    const sectionEntry = {
      id:               field.fieldId,
      label:            field.label,
      sectionGroup:     field.sectionGroup,
      contentType:      field.contentType,
      required:         isRequired,
      generatorProfile,
      dependsOn,
      priority,
      qcTags:           field.qcHints || [],
      triggeringFlags:  field.triggeringFlags,
    };

    if (isCommentary) {
      commentaryBlocks.push(sectionEntry);
    } else {
      sections.push(sectionEntry);
    }
  }

  // ── 2. Check for conditional sections from manifest ───────────────────

  for (const cs of (manifest.conditionalSections || [])) {
    if (fieldIdSet.has(cs.sectionId)) continue; // already included

    const conditionMet = cs.condition === 'always' || flags[cs.condition] === true;
    if (!conditionMet) {
      excludedSections.push({
        fieldId: cs.sectionId,
        label:   cs.label,
        reason:  `Condition not met: ${cs.condition}`,
      });
      continue;
    }

    // Find the canonical field if it exists
    const canonicalField = applicableFields.find(f => f.fieldId === cs.sectionId);
    if (canonicalField) {
      fieldIdSet.add(cs.sectionId);
      sections.push({
        id:               cs.sectionId,
        label:            cs.label,
        sectionGroup:     canonicalField.sectionGroup,
        contentType:      canonicalField.contentType,
        required:         true,
        generatorProfile: resolveGeneratorProfile(canonicalField),
        dependsOn:        dependencyHints[cs.sectionId] || [],
        priority:         SECTION_GROUP_PRIORITY[canonicalField.sectionGroup] ?? 5,
        qcTags:           canonicalField.qcHints || [],
        triggeringFlags:  canonicalField.triggeringFlags,
      });
      continue;
    }

    const registryField = getFieldDefinition(ctx.formType || manifest.formType, cs.sectionId);
    if (!registryField) {
      excludedSections.push({
        fieldId: cs.sectionId,
        label: cs.label,
        reason: 'Condition met, but no canonical or registry-backed field definition was found.',
      });
      continue;
    }

    fieldIdSet.add(cs.sectionId);
    const sectionGroup = inferManifestSectionGroup(manifest, cs.sectionId) || normalizeRegistrySectionGroup(registryField.sectionName);
    sections.push({
      id:               cs.sectionId,
      label:            cs.label || registryField.humanLabel || registryField.title || cs.sectionId,
      sectionGroup,
      contentType:      registryField.narrativeType === 'commentary' ? 'commentary' : 'narrative',
      required:         true,
      generatorProfile: CONTENT_TYPE_PROFILES.narrative,
      dependsOn:        dependencyHints[cs.sectionId] || [],
      priority:         SECTION_GROUP_PRIORITY[sectionGroup] ?? 5,
      qcTags:           [],
      triggeringFlags:  [cs.condition],
    });
  }

  // ── 3. Check optional commentary blocks from manifest ─────────────────

  for (const ocb of (manifest.optionalCommentaryBlocks || [])) {
    if (fieldIdSet.has(ocb.id)) continue;
    if (flags[ocb.triggerFlag] === true) {
      // Already handled via canonical fields if it was in applicableFields
      // This catches any manifest-defined blocks not in the canonical registry
      commentaryBlocks.push({
        id:               ocb.id,
        label:            ocb.id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        sectionGroup:     'commentary',
        contentType:      'commentary',
        required:         false,
        generatorProfile: 'data-driven',
        dependsOn:        [],
        priority:         9,
        qcTags:           [],
        triggeringFlags:  [ocb.triggerFlag],
      });
    }
  }

  // ── 4. Sort sections by priority then alphabetically ──────────────────

  sections.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  commentaryBlocks.sort((a, b) => a.id.localeCompare(b.id));

  // ── 5. Classify parallel vs dependent ─────────────────────────────────

  const allSections = [...sections, ...commentaryBlocks];
  const parallelSections = allSections.filter(s => s.dependsOn.length === 0);
  const dependentSections = allSections.filter(s => s.dependsOn.length > 0);

  // ── 6. Compute analysis jobs required ─────────────────────────────────

  const analysisJobs = computeAnalysisJobs(flags, manifest);

  // ── 7. Estimate duration ──────────────────────────────────────────────

  const parallelBatches = Math.ceil(parallelSections.length / 3);
  const estimatedDurationMs = (parallelBatches * 4000) + (dependentSections.length * 3000) + 2000;

  // ── 8. Build the plan ─────────────────────────────────────────────────

  return {
    id:              uuidv4(),
    version:         '2.0',
    reportFamily:    manifest.id,
    formType:        ctx.formType || manifest.formType,
    caseId:          ctx.caseId,

    sections:          allSections,
    requiredSections:  allSections.filter(s => s.required).map(s => s.id),
    optionalSections:  allSections.filter(s => !s.required && s.contentType !== 'commentary').map(s => s.id),
    commentaryBlocks:  commentaryBlocks.map(s => s.id),
    excludedSections,

    parallelSections:  parallelSections.map(s => s.id),
    dependentSections: dependentSections.map(s => s.id),
    analysisJobs,

    totalSections:       allSections.length,
    requiredCount:       allSections.filter(s => s.required).length,
    optionalCount:       allSections.filter(s => !s.required && s.contentType !== 'commentary').length,
    commentaryCount:     commentaryBlocks.length,
    excludedCount:       excludedSections.length,
    parallelCount:       parallelSections.length,
    dependentCount:      dependentSections.length,
    estimatedDurationMs,

    complianceTags: compliance.likely_qc_categories || [],

    _builtAt: new Date().toISOString(),
    _buildMs: Date.now() - t0,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveGeneratorProfile(field) {
  return CONTENT_TYPE_PROFILES[field.contentType] || 'retrieval-guided';
}

function inferManifestSectionGroup(manifest, fieldId) {
  for (const [groupId, fieldIds] of Object.entries(manifest.canonicalFieldGroups || {})) {
    if (Array.isArray(fieldIds) && fieldIds.includes(fieldId)) return groupId;
  }
  return null;
}

function normalizeRegistrySectionGroup(sectionName) {
  const raw = String(sectionName || '').trim();
  if (!raw) return 'commentary';
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\s+/g, '_')
    .toLowerCase();
}

function computeAnalysisJobs(flags, manifest) {
  const jobs = [];

  // Comp analysis if sales approach is used
  if (flags.sales_approach_required && flags.has_comps) {
    jobs.push('comp_analysis');
  }

  // Market analysis always useful
  jobs.push('market_analysis');

  // HBU logic if commercial or if manifest includes HBU sections
  const hasHbu = (manifest.requiredSections || []).some(s =>
    s.includes('hbu') || s.includes('highest_best_use')
  );
  if (hasHbu || flags.commercial_property) {
    jobs.push('hbu_logic');
  }

  return [...new Set(jobs)];
}

/**
 * Convert a SectionPlanV2 into the format expected by the Phase 3 orchestrator.
 * This is a compatibility bridge so the orchestrator doesn't need changes.
 *
 * @param {object} planV2 — SectionPlanV2 from buildSectionPlanV2()
 * @param {string} assignmentId — assignment row id
 * @returns {object} — format compatible with Phase 3 buildReportPlan() output
 */
export function toOrchestratorPlan(planV2, assignmentId) {
  return {
    id:             planV2.id,
    assignmentId,
    formType:       planV2.formType,
    caseId:         planV2.caseId,

    // Map v2 sections to the shape the orchestrator expects
    sections: planV2.sections.map(s => ({
      id:               s.id,
      label:            s.label,
      generatorProfile: s.generatorProfile,
      dependsOn:        s.dependsOn,
      analysisRequired: [],  // analysis jobs are run globally, not per-section in v2
      priority:         s.priority,
    })),

    parallelSections:  planV2.parallelSections,
    dependentSections: planV2.dependentSections,
    analysisJobs:      planV2.analysisJobs,

    totalSections:       planV2.totalSections,
    parallelCount:       planV2.parallelCount,
    dependentCount:      planV2.dependentCount,
    estimatedDurationMs: planV2.estimatedDurationMs,

    _builtAt: planV2._builtAt,
    _buildMs: planV2._buildMs,
  };
}
