/**
 * server/services/sectionPolicyService.js
 * -----------------------------------------
 * Phase D — Section Factory Governance
 *
 * Deterministic section policy module that governs:
 *   - prompt version pinning by generation profile
 *   - dependency-aware section policy metadata
 *   - section freshness / staleness detection
 *   - quality scoring for generated sections
 *   - audit metadata assembly
 *
 * This module is the single source of truth for section generation policy.
 * The orchestrator and job runner consult this module before and after generation.
 */

import { SECTION_DEPENDENCIES, getMissingFacts, getSectionDependencies } from '../sectionDependencies.js';
import { resolveProfileForSection } from '../generators/generatorProfiles.js';

// ── Prompt version registry ──────────────────────────────────────────────────
// Each profile version is pinned to a semver string.
// Bump version when the prompt template changes materially.

const PROMPT_VERSIONS = {
  'template-heavy':     '1.0.0',
  'retrieval-guided':   '1.0.0',
  'data-driven':        '1.0.0',
  'logic-template':     '1.0.0',
  'analysis-narrative':  '1.0.0',
  'synthesis':           '1.0.0',
};

/**
 * Get the current prompt version for a given profile or section.
 * @param {string} profileIdOrSectionId
 * @returns {string} semver version string
 */
export function getPromptVersion(profileIdOrSectionId) {
  if (PROMPT_VERSIONS[profileIdOrSectionId]) {
    return PROMPT_VERSIONS[profileIdOrSectionId];
  }
  const profile = resolveProfileForSection(profileIdOrSectionId);
  return PROMPT_VERSIONS[profile.id] || '1.0.0';
}

// ── Section freshness states ─────────────────────────────────────────────────

export const FRESHNESS = {
  CURRENT:                      'current',
  STALE_DUE_TO_FACT_CHANGE:     'stale_due_to_fact_change',
  STALE_DUE_TO_DEPENDENCY_CHANGE: 'stale_due_to_dependency_change',
  STALE_DUE_TO_PROMPT_CHANGE:   'stale_due_to_prompt_change',
  NOT_GENERATED:                'not_generated',
};

// ── Dependency snapshot ──────────────────────────────────────────────────────

/**
 * Build a dependency snapshot capturing the current state of all fact paths
 * that a section depends on. This snapshot is stored with the generated section
 * and used later to detect staleness.
 *
 * @param {string} sectionId
 * @param {object} facts - case facts object
 * @returns {object} dependency snapshot
 */
export function buildDependencySnapshot(sectionId, facts) {
  const deps = getSectionDependencies(sectionId);
  const snapshot = {
    sectionId,
    capturedAt: new Date().toISOString(),
    promptVersion: getPromptVersion(sectionId),
    requiredFacts: {},
    recommendedFacts: {},
  };

  for (const path of (deps.required || [])) {
    snapshot.requiredFacts[path] = resolveFactValue(facts, path);
  }
  for (const path of (deps.recommended || [])) {
    snapshot.recommendedFacts[path] = resolveFactValue(facts, path);
  }

  return snapshot;
}

/**
 * Resolve a dotted fact path to its current value hash (for comparison).
 * Returns a normalized string representation for equality checking.
 */
function resolveFactValue(facts, dotPath) {
  if (!facts || !dotPath) return null;
  const parts = dotPath.split('.');
  let cur = facts;
  for (const part of parts) {
    if (cur === null || cur === undefined) return null;
    const idx = parseInt(part, 10);
    if (!isNaN(idx) && Array.isArray(cur)) {
      cur = cur[idx];
    } else {
      cur = cur[part];
    }
  }
  if (cur === null || cur === undefined) return null;
  const val = (cur && typeof cur === 'object' && 'value' in cur) ? cur.value : cur;
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  return str.length ? str : null;
}

// ── Section freshness detection ──────────────────────────────────────────────

/**
 * Determine the freshness status of a generated section by comparing
 * its stored dependency snapshot against current case state.
 *
 * @param {object} storedSnapshot - dependency snapshot from when section was generated
 * @param {object} currentFacts - current case facts
 * @param {string} currentPromptVersion - current prompt version for this section
 * @returns {{ freshness: string, changedPaths: string[], reasons: string[] }}
 */
export function detectStaleness(storedSnapshot, currentFacts, currentPromptVersion) {
  if (!storedSnapshot) {
    return { freshness: FRESHNESS.NOT_GENERATED, changedPaths: [], reasons: ['No generation snapshot found'] };
  }

  const reasons = [];
  const changedPaths = [];

  // Check prompt version change
  if (storedSnapshot.promptVersion && storedSnapshot.promptVersion !== currentPromptVersion) {
    reasons.push(`Prompt version changed: ${storedSnapshot.promptVersion} → ${currentPromptVersion}`);
  }

  // Check required fact changes
  for (const [path, oldValue] of Object.entries(storedSnapshot.requiredFacts || {})) {
    const newValue = resolveFactValue(currentFacts, path);
    if (normalize(oldValue) !== normalize(newValue)) {
      changedPaths.push(path);
      reasons.push(`Required fact changed: ${path}`);
    }
  }

  // Check recommended fact changes
  for (const [path, oldValue] of Object.entries(storedSnapshot.recommendedFacts || {})) {
    const newValue = resolveFactValue(currentFacts, path);
    if (normalize(oldValue) !== normalize(newValue)) {
      changedPaths.push(path);
    }
  }

  // Determine freshness category
  if (reasons.some(r => r.startsWith('Prompt version'))) {
    return { freshness: FRESHNESS.STALE_DUE_TO_PROMPT_CHANGE, changedPaths, reasons };
  }
  if (reasons.some(r => r.startsWith('Required fact'))) {
    return { freshness: FRESHNESS.STALE_DUE_TO_FACT_CHANGE, changedPaths, reasons };
  }
  if (changedPaths.length > 0) {
    return { freshness: FRESHNESS.STALE_DUE_TO_DEPENDENCY_CHANGE, changedPaths, reasons: [`${changedPaths.length} recommended fact(s) changed`] };
  }

  return { freshness: FRESHNESS.CURRENT, changedPaths: [], reasons: [] };
}

function normalize(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().toLowerCase();
}

// ── Section policy ───────────────────────────────────────────────────────────

/**
 * Build the section policy object for a given section.
 * This captures all governance metadata for a section generation job.
 *
 * @param {string} sectionId
 * @param {object} facts
 * @returns {object} section policy
 */
export function buildSectionPolicy(sectionId, facts) {
  const profile = resolveProfileForSection(sectionId);
  const missing = getMissingFacts(sectionId, facts);
  const deps = getSectionDependencies(sectionId);
  const promptVersion = getPromptVersion(sectionId);

  return {
    sectionId,
    profileId: profile.id,
    profileLabel: profile.label,
    promptVersion,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    dependencies: {
      required: deps.required || [],
      recommended: deps.recommended || [],
    },
    missingFacts: {
      required: missing.required,
      recommended: missing.recommended,
      hasBlockers: missing.hasBlockers,
    },
    requiresPriorSections: profile.requiresPriorSections || false,
    generatedAt: null,
  };
}

// ── Quality scoring ──────────────────────────────────────────────────────────

/**
 * Compute a deterministic quality score for a generated section.
 * Scoring factors:
 *   - dependency coverage (were all required facts present?)
 *   - output length adequacy
 *   - review pass (did the two-pass review pass?)
 *   - profile adherence
 *
 * @param {object} params
 * @param {string} params.sectionId
 * @param {object} params.facts
 * @param {string} params.generatedText
 * @param {boolean} [params.reviewPassed]
 * @param {number} [params.examplesUsed]
 * @returns {{ score: number, maxScore: number, factors: object[] }}
 */
export function computeQualityScore({ sectionId, facts, generatedText, reviewPassed = false, examplesUsed = 0 }) {
  const factors = [];
  let score = 0;
  const maxScore = 100;

  // Factor 1: Dependency coverage (0-40 points)
  const missing = getMissingFacts(sectionId, facts);
  const deps = getSectionDependencies(sectionId);
  const totalRequired = (deps.required || []).length;
  const missingRequired = (missing.required || []).length;
  const requiredCoverage = totalRequired > 0 ? ((totalRequired - missingRequired) / totalRequired) : 1;
  const depScore = Math.round(requiredCoverage * 40);
  score += depScore;
  factors.push({ name: 'dependency_coverage', score: depScore, max: 40, detail: `${totalRequired - missingRequired}/${totalRequired} required facts present` });

  // Factor 2: Output length adequacy (0-20 points)
  const textLen = (generatedText || '').trim().length;
  const profile = resolveProfileForSection(sectionId);
  const targetChars = (profile.maxTokens || 500) * 3; // rough chars estimate
  let lengthScore = 0;
  if (textLen === 0) {
    lengthScore = 0;
  } else if (textLen < targetChars * 0.2) {
    lengthScore = 5; // too short
  } else if (textLen > targetChars * 3) {
    lengthScore = 10; // too long
  } else {
    lengthScore = 20; // adequate
  }
  score += lengthScore;
  factors.push({ name: 'output_length', score: lengthScore, max: 20, detail: `${textLen} chars (target ~${targetChars})` });

  // Factor 3: Review pass (0-25 points)
  const reviewScore = reviewPassed ? 25 : 10;
  score += reviewScore;
  factors.push({ name: 'review_pass', score: reviewScore, max: 25, detail: reviewPassed ? 'Two-pass review passed' : 'No review or review not passed' });

  // Factor 4: Example availability (0-15 points)
  const exampleScore = examplesUsed >= 3 ? 15 : examplesUsed >= 1 ? 10 : 5;
  score += exampleScore;
  factors.push({ name: 'example_availability', score: exampleScore, max: 15, detail: `${examplesUsed} examples used` });

  return { score: Math.min(score, maxScore), maxScore, factors };
}

// ── Audit metadata assembly ──────────────────────────────────────────────────

/**
 * Build a comprehensive audit metadata record for a generated section.
 *
 * @param {object} params
 * @param {string} params.sectionId
 * @param {string} params.runId
 * @param {string} params.jobId
 * @param {object} params.facts
 * @param {string} params.generatedText
 * @param {boolean} [params.reviewPassed]
 * @param {number} [params.examplesUsed]
 * @param {string[]} [params.sourceIds]
 * @param {number} [params.durationMs]
 * @returns {object} audit metadata
 */
export function buildAuditMetadata({ sectionId, runId, jobId, facts, generatedText, reviewPassed, examplesUsed, sourceIds, durationMs }) {
  const policy = buildSectionPolicy(sectionId, facts);
  const snapshot = buildDependencySnapshot(sectionId, facts);
  const quality = computeQualityScore({ sectionId, facts, generatedText, reviewPassed, examplesUsed });

  return {
    sectionId,
    runId,
    jobId,
    generatedAt: new Date().toISOString(),
    policy,
    dependencySnapshot: snapshot,
    quality,
    sourceIds: sourceIds || [],
    durationMs: durationMs || null,
    promptVersion: policy.promptVersion,
  };
}

// ── Stale dependent sections ─────────────────────────────────────────────────

/**
 * Given a section that was just regenerated, find all other sections
 * that depend on the same facts and may now be stale.
 *
 * @param {string} regeneratedSectionId
 * @returns {string[]} list of potentially stale section IDs
 */
export function findStaleDependentSections(regeneratedSectionId) {
  const regeneratedDeps = getSectionDependencies(regeneratedSectionId);
  const allPaths = new Set([
    ...(regeneratedDeps.required || []),
    ...(regeneratedDeps.recommended || []),
  ]);

  const staleSections = [];
  for (const [sectionId, deps] of Object.entries(SECTION_DEPENDENCIES)) {
    if (sectionId === regeneratedSectionId) continue;
    const sectionPaths = [...(deps.required || []), ...(deps.recommended || [])];
    const overlap = sectionPaths.some(p => allPaths.has(p));
    if (overlap) {
      staleSections.push(sectionId);
    }
  }
  return staleSections;
}

// ── Regenerate policy ────────────────────────────────────────────────────────

/**
 * Determine whether a section regeneration should be allowed, blocked, or warned.
 *
 * @param {string} sectionId
 * @param {object} facts
 * @param {object} [existingSections] - map of sectionId → { generatedAt, ... }
 * @param {object} [options]
 * @param {string} [options.freshnessStatus] - current freshness_status from DB
 * @param {number} [options.qualityScore] - current quality score (0-100)
 * @param {number} [options.regenerationCount] - times this section has been regenerated
 * @param {number} [options.maxRegenerations] - max allowed regenerations (default: 10)
 * @returns {{ allowed: boolean, warnings: string[], blockers: string[] }}
 */
export function evaluateRegeneratePolicy(sectionId, facts, existingSections = {}, options = {}) {
  const profile = resolveProfileForSection(sectionId);
  const missing = getMissingFacts(sectionId, facts);
  const warnings = [];
  const blockers = [];

  const {
    freshnessStatus,
    qualityScore,
    regenerationCount = 0,
    maxRegenerations = 10,
  } = options;

  // Block if required facts are missing
  if (missing.hasBlockers) {
    blockers.push(`Missing required facts: ${missing.required.join(', ')}`);
  }

  // Block synthesis sections if prior sections haven't been generated
  if (profile.requiresPriorSections) {
    const priorSectionIds = ['neighborhood_description', 'improvements_description', 'sales_comparison_summary'];
    const missingPrior = priorSectionIds.filter(id => !existingSections[id]);
    if (missingPrior.length > 0) {
      blockers.push(`Required prior sections not generated: ${missingPrior.join(', ')}`);
    }
  }

  // Block if regeneration count exceeds maximum (prevent loops)
  if (regenerationCount >= maxRegenerations) {
    blockers.push(`Regeneration limit reached (${regenerationCount}/${maxRegenerations}). Manual review required.`);
  }

  // Warn about recommended fact gaps
  if (missing.recommended.length > 0) {
    warnings.push(`Missing recommended facts: ${missing.recommended.join(', ')}`);
  }

  // Warn about stale_due_to_prompt_change — allow but warn
  if (freshnessStatus === FRESHNESS.STALE_DUE_TO_PROMPT_CHANGE) {
    warnings.push('Section is stale due to prompt version change. Regeneration recommended to use updated prompt.');
  }

  // Warn about low quality scores — suggest regeneration
  if (typeof qualityScore === 'number' && qualityScore < 50) {
    warnings.push(`Quality score is low (${qualityScore}/100). Regeneration recommended.`);
  }

  // Warn about sections that are dependencies of other stale sections
  if (freshnessStatus === FRESHNESS.STALE_DUE_TO_DEPENDENCY_CHANGE) {
    warnings.push('Section is stale because a dependency section changed. Regeneration recommended.');
  }

  // Warn when approaching regeneration limit
  if (regenerationCount >= maxRegenerations - 2 && regenerationCount < maxRegenerations) {
    warnings.push(`Approaching regeneration limit (${regenerationCount}/${maxRegenerations}).`);
  }

  return {
    allowed: blockers.length === 0,
    warnings,
    blockers,
  };
}
