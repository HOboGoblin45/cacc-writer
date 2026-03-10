/**
 * server/memory/retrievalPackBuilder.js
 * ----------------------------------------
 * Phase 6 — Retrieval Pack Builder v2
 *
 * Assembles structured generation inputs for each section/canonical field.
 * A retrieval pack is more than "top N text blobs" — it includes:
 *   - assignment context summary
 *   - report family / canonical field context
 *   - ranked approved memory examples
 *   - voice profile hints
 *   - phrase bank snippets
 *   - comparable commentary examples
 *   - disallowed phrasing hints
 *   - provenance / confidence metadata
 *   - compact rationale for each selected item
 *
 * This replaces/enhances the Phase 3 retrievalPackBuilder in
 * server/context/retrievalPackBuilder.js by providing richer inputs.
 */

import { rankApprovedMemory, rankCompCommentary } from './retrievalRankingEngine.js';
import { resolveVoiceProfile, listApprovedMemory } from '../db/repositories/memoryRepo.js';

// ── Configuration ───────────────────────────────────────────────────────────

const PACK_DEFAULTS = {
  maxNarrativeExamples: 5,
  maxPhraseBank: 8,
  maxCompCommentary: 3,
  maxVoiceExemplars: 3,
  maxDisallowedPhrases: 15,
  includeScoreBreakdown: true,
  includeProvenance: true,
};

// ── Main Builder ────────────────────────────────────────────────────────────

/**
 * Build a retrieval pack for a single section/canonical field.
 *
 * @param {Object} params
 * @param {Object} params.assignmentContext — normalized assignment context
 * @param {string} params.canonicalFieldId — target section
 * @param {string} params.reportFamily — e.g. 'URAR', 'GP_RES', 'COMMERCIAL'
 * @param {string} params.formType — e.g. '1004', '1025', '1073'
 * @param {Object} [params.sectionPlan] — section plan from Phase 4
 * @param {Object} [params.options] — override defaults
 * @returns {import('./memoryTypes.js').RetrievalPack}
 */
export function buildRetrievalPack(params) {
  const t0 = Date.now();
  const {
    assignmentContext,
    canonicalFieldId,
    reportFamily,
    formType,
    sectionPlan,
    options = {},
  } = params;

  const config = { ...PACK_DEFAULTS, ...options };

  // ── 1. Build the retrieval query from assignment context ────────────────
  const query = buildRetrievalQuery(assignmentContext, canonicalFieldId, reportFamily, formType, sectionPlan);

  // ── 2. Rank approved memory (narrative examples) ───────────────────────
  const narrativeResult = rankApprovedMemory({
    ...query,
    bucketFilter: null, // search all buckets
    maxResults: config.maxNarrativeExamples,
  });

  // ── 3. Rank phrase bank items ──────────────────────────────────────────
  const phraseBankResult = rankApprovedMemory({
    ...query,
    bucketFilter: 'phrase_bank',
    maxResults: config.maxPhraseBank,
  });

  // ── 4. Rank voice exemplars ────────────────────────────────────────────
  const voiceExemplarResult = rankApprovedMemory({
    ...query,
    bucketFilter: 'voice_exemplar',
    maxResults: config.maxVoiceExemplars,
  });

  // ── 5. Rank comp commentary (if relevant section) ─────────────────────
  const isCompSection = isComparableSection(canonicalFieldId);
  let compCommentaryResult = { candidates: [], totalScanned: 0, durationMs: 0 };
  if (isCompSection) {
    compCommentaryResult = rankCompCommentary({
      ...query,
      commentaryType: inferCommentaryType(canonicalFieldId),
      maxResults: config.maxCompCommentary,
    });
  }

  // ── 6. Resolve voice profile ───────────────────────────────────────────
  const voiceProfile = resolveVoiceProfile({
    canonicalFieldId,
    reportFamily,
  });

  // ── 7. Build voice hints ──────────────────────────────────────────────
  const voiceHints = buildVoiceHints(voiceProfile);

  // ── 8. Build disallowed phrases ────────────────────────────────────────
  const disallowedPhrases = buildDisallowedPhrases(voiceProfile, config.maxDisallowedPhrases);

  // ── 9. Build assignment context summary ────────────────────────────────
  const contextSummary = buildContextSummary(assignmentContext, canonicalFieldId);

  // ── 10. Assemble the pack ─────────────────────────────────────────────
  const pack = {
    canonicalFieldId,
    reportFamily: reportFamily || null,
    formType: formType || null,
    version: 2,

    contextSummary,

    narrativeExamples: narrativeResult.candidates.map(c => ({
      id: c.id,
      text: c.text,
      bucket: c.bucket,
      sourceType: c.sourceType,
      score: config.includeScoreBreakdown ? c.score : { totalScore: c.score.totalScore },
      rationale: c.score.matchReasons.slice(0, 3).join('; '),
    })),

    phraseBankItems: phraseBankResult.candidates.map(c => ({
      id: c.id,
      text: c.text,
      score: c.score.totalScore,
      rationale: c.score.matchReasons.slice(0, 2).join('; '),
    })),

    voiceExemplars: voiceExemplarResult.candidates.map(c => ({
      id: c.id,
      text: c.text,
      score: c.score.totalScore,
    })),

    compCommentary: compCommentaryResult.candidates.map(c => ({
      id: c.id,
      text: c.text,
      commentaryType: c.commentaryType,
      score: c.score.totalScore,
      rationale: c.score.matchReasons.slice(0, 2).join('; '),
    })),

    voiceHints,
    disallowedPhrases,

    metadata: {
      builtAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      totalScanned: narrativeResult.totalScanned + phraseBankResult.totalScanned +
                    voiceExemplarResult.totalScanned + compCommentaryResult.totalScanned,
      narrativeScanned: narrativeResult.totalScanned,
      phraseBankScanned: phraseBankResult.totalScanned,
      voiceExemplarScanned: voiceExemplarResult.totalScanned,
      compCommentaryScanned: compCommentaryResult.totalScanned,
      voiceProfileResolved: !!voiceProfile,
      voiceProfileSource: voiceProfile?._resolvedFrom || null,
    },
  };

  return pack;
}

/**
 * Build retrieval packs for all sections in a report plan.
 * Returns a RetrievalPackBundle.
 *
 * @param {Object} params
 * @param {Object} params.assignmentContext
 * @param {Object} params.reportPlan — Phase 4 report plan
 * @param {string} params.reportFamily
 * @param {string} params.formType
 * @param {Object} [params.options]
 * @returns {import('./memoryTypes.js').RetrievalPackBundle}
 */
export function buildRetrievalPackBundle(params) {
  const t0 = Date.now();
  const { assignmentContext, reportPlan, reportFamily, formType, options } = params;

  const sections = reportPlan?.sections || reportPlan?.plan?.sections || [];
  const packs = {};

  for (const section of sections) {
    const fieldId = section.canonicalFieldId || section.sectionId || section.id;
    if (!fieldId) continue;

    try {
      packs[fieldId] = buildRetrievalPack({
        assignmentContext,
        canonicalFieldId: fieldId,
        reportFamily,
        formType,
        sectionPlan: section,
        options,
      });
    } catch (err) {
      console.error(`[retrievalPackBuilder] Error building pack for ${fieldId}:`, err.message);
      packs[fieldId] = {
        canonicalFieldId: fieldId,
        error: err.message,
        narrativeExamples: [],
        phraseBankItems: [],
        voiceExemplars: [],
        compCommentary: [],
        voiceHints: null,
        disallowedPhrases: [],
        contextSummary: null,
        metadata: { error: true },
      };
    }
  }

  return {
    packs,
    reportFamily,
    formType,
    sectionCount: Object.keys(packs).length,
    builtAt: new Date().toISOString(),
    totalDurationMs: Date.now() - t0,
  };
}

// ── Query Builder ───────────────────────────────────────────────────────────

/**
 * Build a retrieval query from assignment context and section info.
 */
function buildRetrievalQuery(ctx, canonicalFieldId, reportFamily, formType, sectionPlan) {
  const query = {
    canonicalFieldId,
    reportFamily,
    formType,
    propertyType: ctx?.propertyType || ctx?.subject?.propertyType || null,
    assignmentType: ctx?.assignmentType || ctx?.purpose || null,
    loanProgram: ctx?.loanProgram || ctx?.lender?.program || null,
    marketType: ctx?.marketType || ctx?.subject?.marketType || null,
    county: ctx?.subject?.county || ctx?.county || null,
    city: ctx?.subject?.city || ctx?.city || null,
    state: ctx?.subject?.state || ctx?.state || null,
    subjectCondition: ctx?.subject?.condition || null,
    issueTags: [],
    styleTags: [],
  };

  // Extract issue tags from section plan if available
  if (sectionPlan?.issueTags) {
    query.issueTags = sectionPlan.issueTags;
  }
  if (sectionPlan?.flags) {
    query.issueTags = [...query.issueTags, ...sectionPlan.flags];
  }

  // Extract from derived flags if available
  if (ctx?.derivedFlags) {
    const flags = ctx.derivedFlags;
    if (flags.isRural) query.issueTags.push('rural');
    if (flags.isComplex) query.issueTags.push('complex');
    if (flags.hasAccessIssues) query.issueTags.push('access_issues');
    if (flags.hasFloodZone) query.issueTags.push('flood_zone');
    if (flags.isNewConstruction) query.issueTags.push('new_construction');
    if (flags.isREO) query.issueTags.push('reo');
    if (flags.isRelocation) query.issueTags.push('relocation');
    if (flags.hasLimitedComps) query.issueTags.push('limited_comps');
  }

  return query;
}

// ── Voice Hints Builder ─────────────────────────────────────────────────────

/**
 * Build voice hints from a resolved voice profile.
 * These are structured instructions for the generation prompt.
 */
function buildVoiceHints(profile) {
  if (!profile) return null;

  const hints = {
    tone: profile.tone || null,
    sentenceLength: profile.sentenceLength || null,
    hedgingDegree: profile.hedgingDegree || null,
    terminologyPreference: profile.terminologyPreference || null,
    reconciliationStyle: profile.reconciliationStyle || null,
    sectionOpeningStyle: profile.sectionOpeningStyle || null,
    sectionClosingStyle: profile.sectionClosingStyle || null,
    preferredPhrases: (profile.preferredPhrases || []).slice(0, 10),
    phrasingPatterns: (profile.phrasingPatterns || []).slice(0, 5),
    rules: [],
  };

  // Add voice rules as structured hints
  if (profile._rules && profile._rules.length > 0) {
    hints.rules = profile._rules.map(r => ({
      type: r.ruleType,
      value: r.ruleValue,
      priority: r.priority,
    }));
  }

  return hints;
}

/**
 * Build disallowed phrases list from voice profile.
 */
function buildDisallowedPhrases(profile, maxPhrases) {
  if (!profile) return [];

  const phrases = [...(profile.forbiddenPhrases || [])];

  // Add rule-based forbidden phrases
  if (profile._rules) {
    for (const rule of profile._rules) {
      if (rule.ruleType === 'forbidden_phrase' && rule.ruleValue) {
        phrases.push(rule.ruleValue);
      }
    }
  }

  // Deduplicate and limit
  return [...new Set(phrases)].slice(0, maxPhrases);
}

// ── Context Summary Builder ─────────────────────────────────────────────────

/**
 * Build a compact assignment context summary for the retrieval pack.
 * This is a focused subset of the full context, relevant to the section.
 */
function buildContextSummary(ctx, canonicalFieldId) {
  if (!ctx) return null;

  const summary = {
    propertyType: ctx.propertyType || ctx.subject?.propertyType || null,
    assignmentType: ctx.assignmentType || ctx.purpose || null,
    formType: ctx.formType || null,
    reportFamily: ctx.reportFamily || null,
    address: ctx.subject?.address || ctx.address || null,
    city: ctx.subject?.city || ctx.city || null,
    county: ctx.subject?.county || ctx.county || null,
    state: ctx.subject?.state || ctx.state || null,
    marketType: ctx.marketType || ctx.subject?.marketType || null,
    loanProgram: ctx.loanProgram || null,
    condition: ctx.subject?.condition || null,
    gla: ctx.subject?.gla || null,
    yearBuilt: ctx.subject?.yearBuilt || null,
    lotSize: ctx.subject?.lotSize || null,
    zoning: ctx.subject?.zoning || null,
  };

  // Add section-specific context
  if (canonicalFieldId?.includes('neighborhood') || canonicalFieldId?.includes('market')) {
    summary.neighborhoodName = ctx.subject?.neighborhood || null;
    summary.marketConditions = ctx.marketConditions || null;
  }

  if (canonicalFieldId?.includes('site') || canonicalFieldId?.includes('zoning')) {
    summary.zoningDetails = ctx.subject?.zoningDetails || null;
    summary.floodZone = ctx.subject?.floodZone || null;
    summary.utilities = ctx.subject?.utilities || null;
  }

  if (canonicalFieldId?.includes('improvement') || canonicalFieldId?.includes('condition')) {
    summary.rooms = ctx.subject?.rooms || null;
    summary.basement = ctx.subject?.basement || null;
    summary.heating = ctx.subject?.heating || null;
    summary.cooling = ctx.subject?.cooling || null;
  }

  return summary;
}

// ── Section Classification Helpers ──────────────────────────────────────────

/**
 * Check if a canonical field is a comparable-related section.
 */
function isComparableSection(canonicalFieldId) {
  if (!canonicalFieldId) return false;
  const compSections = [
    'sales_comparison_summary',
    'comp_selection_rationale',
    'adjustment_commentary',
    'reconciliation',
    'market_data',
    'sale_valuation',
  ];
  return compSections.some(s => canonicalFieldId.includes(s));
}

/**
 * Infer the commentary type for comp commentary retrieval.
 */
function inferCommentaryType(canonicalFieldId) {
  if (canonicalFieldId.includes('selection') || canonicalFieldId.includes('rationale')) {
    return 'comp_selection';
  }
  if (canonicalFieldId.includes('adjustment')) {
    return 'adjustment';
  }
  if (canonicalFieldId.includes('reconciliation')) {
    return 'reconciliation';
  }
  return 'general';
}
