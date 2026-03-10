/**
 * server/qc/checkers/requiredCoverageChecker.js
 * ------------------------------------------------
 * Phase 7 — Required Coverage / Missing Content Checks
 *
 * Verifies that required sections, canonical fields, and commentary families
 * are present and sufficiently populated in the draft package.
 *
 * Checks:
 *   - Required section missing entirely
 *   - Required section present but empty/thin
 *   - Required canonical field not addressed
 *   - Commentary family required by flags but missing
 *   - Section plan says required but draft omitted it
 *   - Assignment flags imply commentary but no section text exists
 *
 * All checks are deterministic — no LLM involvement.
 */

import { registerRules } from '../qcRuleRegistry.js';

// ── Thresholds ──────────────────────────────────────────────────────────────

/** Minimum character count for a section to be considered "populated" */
const MIN_SECTION_CHARS = 80;

/** Minimum word count for a section to be considered substantive */
const MIN_SECTION_WORDS = 15;

/** Minimum character count for a commentary block */
const MIN_COMMENTARY_CHARS = 40;

// ── Rule definitions ────────────────────────────────────────────────────────

const rules = [
  {
    ruleId: 'REQ-001',
    displayName: 'Required Section Missing',
    category: 'completeness',
    defaultSeverity: 'blocker',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'plan'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'A section marked as required in the section plan is completely missing from the draft package.',
    check: checkRequiredSectionMissing,
  },
  {
    ruleId: 'REQ-002',
    displayName: 'Required Section Empty or Thin',
    category: 'completeness',
    defaultSeverity: 'high',
    scope: 'section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'plan'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'A required section exists but contains insufficient content (below minimum threshold).',
    check: checkRequiredSectionThin,
  },
  {
    ruleId: 'REQ-003',
    displayName: 'Commentary Family Required but Missing',
    category: 'completeness',
    defaultSeverity: 'high',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'plan', 'flags', 'compliance'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'Assignment flags indicate a commentary family is required, but no corresponding section text exists.',
    check: checkCommentaryFamilyMissing,
  },
  {
    ruleId: 'REQ-004',
    displayName: 'Planned Section Not in Draft',
    category: 'completeness',
    defaultSeverity: 'medium',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'plan'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'A section was included in the section plan but is absent from the draft package output.',
    check: checkPlannedSectionNotInDraft,
  },
  {
    ruleId: 'REQ-005',
    displayName: 'Optional Section Thin',
    category: 'section_quality',
    defaultSeverity: 'low',
    scope: 'section',
    applicableReportFamilies: [],
    applicableCanonicalFields: [],
    applicableFlags: [],
    requiredInputs: ['sections', 'plan'],
    ruleType: 'deterministic',
    sourceReference: null,
    active: true,
    description: 'An optional section exists but contains very little content.',
    check: checkOptionalSectionThin,
  },
  {
    ruleId: 'REQ-006',
    displayName: 'Reconciliation Section Missing',
    category: 'completeness',
    defaultSeverity: 'blocker',
    scope: 'draft_package',
    applicableReportFamilies: [],
    applicableCanonicalFields: ['reconciliation'],
    applicableFlags: [],
    requiredInputs: ['sections'],
    ruleType: 'deterministic',
    sourceReference: 'USPAP Standards Rule 1-6, 2-2',
    active: true,
    description: 'The reconciliation section is missing — this is always required.',
    check: checkReconciliationMissing,
  },
];

// ── Check implementations ───────────────────────────────────────────────────

/**
 * @param {import('../types.js').QCRuleContext} ctx
 * @returns {import('../types.js').QCCheckResult[]}
 */
function checkRequiredSectionMissing(ctx) {
  const results = [];
  const plan = ctx.sectionPlan;
  if (!plan || !plan.sections) return results;

  const requiredSections = plan.sections.filter(s => s.required);

  for (const planned of requiredSections) {
    const sectionId = planned.id;
    const section = ctx.sections[sectionId];

    if (!section || !section.text || section.text.trim().length === 0) {
      results.push({
        ruleId: 'REQ-001',
        severity: 'blocker',
        category: 'completeness',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `Required section "${planned.label || sectionId}" is missing from the draft.`,
        detailMessage: `The section plan marks "${sectionId}" as required for this report type, but no content was generated or the section is completely empty.`,
        suggestedAction: `Regenerate this section or add content manually before finalizing the report.`,
        evidence: {
          type: 'missing_field',
          expectedValue: sectionId,
          actualValue: null,
        },
      });
    }
  }

  return results;
}

/**
 * @param {import('../types.js').QCRuleContext} ctx
 * @returns {import('../types.js').QCCheckResult[]}
 */
function checkRequiredSectionThin(ctx) {
  const results = [];
  const plan = ctx.sectionPlan;
  if (!plan || !plan.sections) return results;

  const requiredSections = plan.sections.filter(s => s.required);

  for (const planned of requiredSections) {
    const sectionId = planned.id;
    const section = ctx.sections[sectionId];

    if (!section || !section.text) continue;

    const text = section.text.trim();
    const charCount = text.length;
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (charCount > 0 && (charCount < MIN_SECTION_CHARS || wordCount < MIN_SECTION_WORDS)) {
      results.push({
        ruleId: 'REQ-002',
        severity: 'high',
        category: 'completeness',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `Required section "${planned.label || sectionId}" is too thin (${wordCount} words, ${charCount} chars).`,
        detailMessage: `The section exists but contains only ${wordCount} words (${charCount} characters). Minimum expected: ${MIN_SECTION_WORDS} words / ${MIN_SECTION_CHARS} characters. This likely needs expansion.`,
        suggestedAction: `Review and expand this section with substantive content appropriate for the assignment.`,
        evidence: {
          type: 'threshold',
          charCount,
          threshold: MIN_SECTION_CHARS,
          excerpt: text.substring(0, 200),
        },
      });
    }
  }

  return results;
}

/**
 * @param {import('../types.js').QCRuleContext} ctx
 * @returns {import('../types.js').QCCheckResult[]}
 */
function checkCommentaryFamilyMissing(ctx) {
  const results = [];
  const plan = ctx.sectionPlan;
  if (!plan) return results;

  // Commentary blocks from the plan that are triggered by flags
  const commentaryIds = plan.commentaryBlocks || [];

  // Also check compliance profile's likely commentary families
  const compliance = ctx.compliance || {};
  const likelyFamilies = compliance.likely_commentary_families || [];

  // Merge both sources
  const expectedCommentary = new Set([...commentaryIds, ...likelyFamilies]);

  for (const commentaryId of expectedCommentary) {
    const section = ctx.sections[commentaryId];
    const hasContent = section && section.text && section.text.trim().length >= MIN_COMMENTARY_CHARS;

    if (!hasContent) {
      // Determine which flag triggered this
      const planEntry = (plan.sections || []).find(s => s.id === commentaryId);
      const triggeringFlags = planEntry ? planEntry.triggeringFlags : [];

      results.push({
        ruleId: 'REQ-003',
        severity: 'high',
        category: 'completeness',
        sectionIds: [commentaryId],
        canonicalFieldIds: [commentaryId],
        message: `Required commentary "${commentaryId}" is missing or insufficient.`,
        detailMessage: `Assignment flags or compliance profile indicate that "${commentaryId}" commentary is needed, but no substantive content was found. Triggering flags: ${triggeringFlags.join(', ') || 'compliance profile'}.`,
        suggestedAction: `Add appropriate commentary for "${commentaryId}" to address the assignment conditions.`,
        evidence: {
          type: 'missing_field',
          expectedValue: commentaryId,
          actualValue: section ? `${(section.text || '').trim().length} chars` : null,
        },
      });
    }
  }

  return results;
}

/**
 * @param {import('../types.js').QCRuleContext} ctx
 * @returns {import('../types.js').QCCheckResult[]}
 */
function checkPlannedSectionNotInDraft(ctx) {
  const results = [];
  const plan = ctx.sectionPlan;
  if (!plan || !plan.sections) return results;

  // Only check non-required sections (required ones are caught by REQ-001)
  const optionalPlanned = plan.sections.filter(s => !s.required);

  for (const planned of optionalPlanned) {
    const sectionId = planned.id;
    const section = ctx.sections[sectionId];

    if (!section || !section.text || section.text.trim().length === 0) {
      results.push({
        ruleId: 'REQ-004',
        severity: 'medium',
        category: 'completeness',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `Planned section "${planned.label || sectionId}" was not generated.`,
        detailMessage: `The section plan included "${sectionId}" but no content was produced. This may be acceptable if the section was intentionally skipped, but should be reviewed.`,
        suggestedAction: `Verify whether this section should be included. If needed, regenerate it.`,
        evidence: {
          type: 'missing_field',
          expectedValue: sectionId,
          actualValue: null,
        },
      });
    }
  }

  return results;
}

/**
 * @param {import('../types.js').QCRuleContext} ctx
 * @returns {import('../types.js').QCCheckResult[]}
 */
function checkOptionalSectionThin(ctx) {
  const results = [];
  const plan = ctx.sectionPlan;
  if (!plan || !plan.sections) return results;

  const optionalSections = plan.sections.filter(s => !s.required);

  for (const planned of optionalSections) {
    const sectionId = planned.id;
    const section = ctx.sections[sectionId];

    if (!section || !section.text) continue;

    const text = section.text.trim();
    const charCount = text.length;
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    // Only flag if it exists but is very thin
    if (charCount > 0 && charCount < MIN_COMMENTARY_CHARS) {
      results.push({
        ruleId: 'REQ-005',
        severity: 'low',
        category: 'section_quality',
        sectionIds: [sectionId],
        canonicalFieldIds: [sectionId],
        message: `Optional section "${planned.label || sectionId}" is very thin (${wordCount} words).`,
        detailMessage: `This section has only ${wordCount} words (${charCount} characters). Consider expanding or removing it.`,
        suggestedAction: `Either expand with substantive content or remove if not needed.`,
        evidence: {
          type: 'threshold',
          charCount,
          threshold: MIN_COMMENTARY_CHARS,
          excerpt: text.substring(0, 200),
        },
      });
    }
  }

  return results;
}

/**
 * @param {import('../types.js').QCRuleContext} ctx
 * @returns {import('../types.js').QCCheckResult[]}
 */
function checkReconciliationMissing(ctx) {
  const results = [];

  // Check for reconciliation in any form
  const reconKeys = ['reconciliation', 'Reconciliation', 'reco', 'Reco'];
  let found = false;

  for (const key of reconKeys) {
    const section = ctx.sections[key];
    if (section && section.text && section.text.trim().length >= MIN_SECTION_CHARS) {
      found = true;
      break;
    }
  }

  if (!found) {
    results.push({
      ruleId: 'REQ-006',
      severity: 'blocker',
      category: 'completeness',
      sectionIds: ['reconciliation'],
      canonicalFieldIds: ['reconciliation'],
      message: 'Reconciliation section is missing or empty.',
      detailMessage: 'Every appraisal report must include a reconciliation of approaches and a final value opinion. This is a USPAP requirement.',
      suggestedAction: 'Generate or write the reconciliation section before finalizing the report.',
      evidence: {
        type: 'missing_field',
        expectedValue: 'reconciliation',
        actualValue: null,
      },
      sourceRefs: ['USPAP Standards Rule 1-6', 'USPAP Standards Rule 2-2'],
    });
  }

  return results;
}

// ── Register all rules ──────────────────────────────────────────────────────

registerRules(rules);

export { rules as requiredCoverageRules };
export default rules;
