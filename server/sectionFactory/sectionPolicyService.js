/**
 * server/sectionFactory/sectionPolicyService.js
 * ---------------------------------------------
 * Deterministic section-factory policy for prompt versioning, dependency
 * handling, regenerate rules, and section-level quality scoring.
 */

import { getDependentSections } from '../context/reportPlanner.js';
import { RUN_STATUS } from '../db/repositories/generationRepo.js';

const ACTIVE_RUN_STATUSES = new Set([
  RUN_STATUS.QUEUED,
  RUN_STATUS.PREPARING,
  RUN_STATUS.RETRIEVING,
  RUN_STATUS.ANALYZING,
  RUN_STATUS.DRAFTING,
  RUN_STATUS.VALIDATING,
  RUN_STATUS.ASSEMBLING,
]);

const PROMPT_VERSION_BY_PROFILE = {
  'template-heavy': 'cacc-section-factory/template-heavy@1',
  'retrieval-guided': 'cacc-section-factory/retrieval-guided@1',
  'data-driven': 'cacc-section-factory/data-driven@1',
  'logic-template': 'cacc-section-factory/logic-template@1',
  'analysis-narrative': 'cacc-section-factory/analysis-narrative@1',
  synthesis: 'cacc-section-factory/synthesis@1',
  default: 'cacc-section-factory/default@1',
};

const QUALITY_PROFILES = {
  'template-heavy': { minChars: 80, warningBudget: 1 },
  'retrieval-guided': { minChars: 150, warningBudget: 1 },
  'data-driven': { minChars: 100, warningBudget: 0 },
  'logic-template': { minChars: 120, warningBudget: 0 },
  'analysis-narrative': { minChars: 150, warningBudget: 0 },
  synthesis: { minChars: 120, warningBudget: 0 },
  default: { minChars: 100, warningBudget: 1 },
};

function normalizeText(value) {
  return String(value || '').trim();
}

function resolvePromptVersion(generatorProfile) {
  return PROMPT_VERSION_BY_PROFILE[generatorProfile]
    || PROMPT_VERSION_BY_PROFILE.default;
}

function resolveQualityProfile(sectionDef) {
  const base = QUALITY_PROFILES[sectionDef?.generatorProfile] || QUALITY_PROFILES.default;
  return {
    ...base,
    requireDependencyContext: Array.isArray(sectionDef?.dependsOn) && sectionDef.dependsOn.length > 0,
    requireAnalysisContext: Array.isArray(sectionDef?.analysisRequired) && sectionDef.analysisRequired.length > 0,
  };
}

function hasSectionText(sectionValue) {
  if (!sectionValue) return false;
  if (typeof sectionValue === 'string') return normalizeText(sectionValue).length > 0;
  const text = sectionValue.final_text
    || sectionValue.finalText
    || sectionValue.text
    || sectionValue.draft_text
    || sectionValue.draftText
    || '';
  return normalizeText(text).length > 0;
}

function toGeneratedSectionMap(generatedSections) {
  if (!generatedSections) return new Map();

  if (!Array.isArray(generatedSections) && typeof generatedSections === 'object') {
    return new Map(
      Object.entries(generatedSections).map(([sectionId, value]) => [sectionId, value])
    );
  }

  return new Map(
    (generatedSections || []).map(section => [
      section.section_id || section.sectionId,
      section,
    ]).filter(([sectionId]) => !!sectionId)
  );
}

export function resolveSectionPolicy({ formType, sectionDef }) {
  const upstreamSections = Array.isArray(sectionDef?.dependsOn)
    ? [...sectionDef.dependsOn]
    : [];
  const downstreamSections = getDependentSections(formType || '1004', sectionDef?.id || '');
  const qualityProfile = resolveQualityProfile(sectionDef);

  return {
    sectionId: sectionDef?.id || '',
    formType: formType || '1004',
    generatorProfile: sectionDef?.generatorProfile || 'retrieval-guided',
    promptVersion: resolvePromptVersion(sectionDef?.generatorProfile || 'retrieval-guided'),
    dependencyGraph: {
      upstreamSections,
      downstreamSections,
    },
    regeneratePolicy: {
      mode: upstreamSections.length > 0 ? 'requires_dependencies' : 'direct',
      blocksWhileRunActive: true,
      requiresCompletedDependencies: upstreamSections.length > 0,
      staleDependentSections: downstreamSections,
    },
    qualityProfile,
  };
}

export function buildDependencySnapshot({ sectionPolicy, generatedSections }) {
  const map = toGeneratedSectionMap(generatedSections);
  const upstreamSections = sectionPolicy?.dependencyGraph?.upstreamSections || [];
  const satisfiedDependencies = upstreamSections.filter(sectionId => hasSectionText(map.get(sectionId)));
  const missingDependencies = upstreamSections.filter(sectionId => !satisfiedDependencies.includes(sectionId));

  return {
    upstreamSections,
    satisfiedDependencies,
    missingDependencies,
    downstreamSections: sectionPolicy?.dependencyGraph?.downstreamSections || [],
  };
}

export function evaluateRegeneratePolicy({ runStatus, sectionPolicy, generatedSections }) {
  const dependencySnapshot = buildDependencySnapshot({ sectionPolicy, generatedSections });

  if (sectionPolicy?.regeneratePolicy?.blocksWhileRunActive && ACTIVE_RUN_STATUSES.has(runStatus?.status)) {
    return {
      ok: false,
      code: 'RUN_STILL_ACTIVE',
      error: 'Cannot regenerate a section while the full-draft run is still active',
      dependencySnapshot,
      staleDependentSections: sectionPolicy?.regeneratePolicy?.staleDependentSections || [],
    };
  }

  if (
    sectionPolicy?.regeneratePolicy?.requiresCompletedDependencies
    && dependencySnapshot.missingDependencies.length > 0
  ) {
    return {
      ok: false,
      code: 'SECTION_DEPENDENCIES_INCOMPLETE',
      error: 'Required upstream sections must exist before this section can be regenerated',
      dependencySnapshot,
      staleDependentSections: sectionPolicy?.regeneratePolicy?.staleDependentSections || [],
    };
  }

  return {
    ok: true,
    dependencySnapshot,
    staleDependentSections: sectionPolicy?.regeneratePolicy?.staleDependentSections || [],
  };
}

export function scoreSectionOutput({
  sectionPolicy,
  text,
  warningsCount = 0,
  dependencySnapshot = null,
  analysisContextUsed = false,
  priorSectionsContextUsed = false,
  retrievalSourceIds = [],
}) {
  const normalizedText = normalizeText(text);
  const qualityProfile = sectionPolicy?.qualityProfile || QUALITY_PROFILES.default;
  const penalties = [];
  let score = 1;

  if (normalizedText.length < qualityProfile.minChars) {
    penalties.push({
      code: 'thin_output',
      amount: 0.2,
      detail: `Output length ${normalizedText.length} < ${qualityProfile.minChars}`,
    });
    score -= 0.2;
  }

  if (warningsCount > qualityProfile.warningBudget) {
    const overflow = warningsCount - qualityProfile.warningBudget;
    const amount = Math.min(0.3, overflow * 0.1);
    penalties.push({
      code: 'warning_overflow',
      amount,
      detail: `Warnings ${warningsCount} exceed budget ${qualityProfile.warningBudget}`,
    });
    score -= amount;
  }

  if (qualityProfile.requireDependencyContext && dependencySnapshot?.missingDependencies?.length > 0) {
    penalties.push({
      code: 'missing_dependency_context',
      amount: 0.2,
      detail: `Missing dependencies: ${dependencySnapshot.missingDependencies.join(', ')}`,
    });
    score -= 0.2;
  }

  if (qualityProfile.requireDependencyContext && !priorSectionsContextUsed) {
    penalties.push({
      code: 'prior_context_not_injected',
      amount: 0.1,
      detail: 'Dependent section ran without prior section context',
    });
    score -= 0.1;
  }

  if (qualityProfile.requireAnalysisContext && !analysisContextUsed) {
    penalties.push({
      code: 'analysis_context_not_injected',
      amount: 0.1,
      detail: 'Analysis-required section ran without analysis context',
    });
    score -= 0.1;
  }

  if (normalizedText.length > 0 && retrievalSourceIds.length === 0 && sectionPolicy?.generatorProfile !== 'data-driven') {
    penalties.push({
      code: 'no_retrieval_sources',
      amount: 0.05,
      detail: 'No retrieval examples were linked to the output',
    });
    score -= 0.05;
  }

  const boundedScore = Math.max(0, Math.min(1, Number(score.toFixed(2))));
  return {
    score: boundedScore,
    metadata: {
      charCount: normalizedText.length,
      warningsCount,
      retrievalSourceCount: retrievalSourceIds.length,
      qualityProfile,
      dependencySnapshot: dependencySnapshot || {
        upstreamSections: [],
        satisfiedDependencies: [],
        missingDependencies: [],
        downstreamSections: [],
      },
      analysisContextUsed,
      priorSectionsContextUsed,
      penalties,
    },
  };
}
