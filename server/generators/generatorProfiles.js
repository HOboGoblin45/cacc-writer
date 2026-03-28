/**
 * server/generators/generatorProfiles.js
 * ----------------------------------------
 * Reusable generation profiles for the full-draft orchestrator.
 *
 * Each profile defines how a section should be generated:
 *   - temperature       — creativity vs determinism
 *   - maxTokens         — output length cap
 *   - retrievalWeight   — how much to weight retrieved examples
 *   - templateWeight    — how much to weight template structure
 *   - systemHint        — additional system-level instruction for this profile
 *   - sections          — which section IDs use this profile by default
 *
 * Profiles:
 *   template-heavy      — boilerplate sections (contract, concessions)
 *   retrieval-guided    — neighborhood and market narratives
 *   data-driven         — improvements / property descriptions
 *   logic-template      — highest and best use / zoning logic
 *   analysis-narrative  — comparable commentary / sales comparison
 *   synthesis           — reconciliation and conclusions
 */

export const GENERATOR_PROFILES = {

  // ── template-heavy ──────────────────────────────────────────────────────────
  // For boilerplate sections with fixed structure and low variability.
  // Prioritizes template adherence over creative retrieval.
  'template-heavy': {
    id:              'template-heavy',
    label:           'Template-Heavy',
    description:     'For boilerplate sections with fixed structure',
    temperature:     0.25,
    maxTokens:       500,
    retrievalWeight: 0.2,
    templateWeight:  0.8,
    systemHint: [
      'Follow the standard appraisal template structure closely.',
      'Use precise, factual language. Minimal variation from standard form language.',
      'Do not add creative embellishments — stick to the facts provided.',
    ].join(' '),
    sections: ['contract_analysis', 'concessions_analysis'],
  },

  // ── retrieval-guided ────────────────────────────────────────────────────────
  // For neighborhood and market narratives where prior approved examples
  // are the strongest signal for quality and style.
  'retrieval-guided': {
    id:              'retrieval-guided',
    label:           'Retrieval-Guided',
    description:     'For neighborhood and market narratives',
    temperature:     0.65,
    maxTokens:       800,
    retrievalWeight: 0.8,
    templateWeight:  0.2,
    systemHint: [
      'Match the voice, structure, and detail level of the provided examples.',
      'Incorporate local market knowledge and neighborhood characteristics.',
      'Write in first-person professional appraiser voice.',
    ].join(' '),
    sections: ['neighborhood_description', 'neighborhood', 'market_conditions', 'market_overview'],
  },

  // ── data-driven ─────────────────────────────────────────────────────────────
  // For improvements and property descriptions where subject data
  // is the primary input and accuracy is paramount.
  'data-driven': {
    id:              'data-driven',
    label:           'Data-Driven',
    description:     'For improvements and property descriptions',
    temperature:     0.45,
    maxTokens:       650,
    retrievalWeight: 0.4,
    templateWeight:  0.6,
    systemHint: [
      'Prioritize accuracy of the subject property data above all else.',
      'Only describe features that are explicitly provided in the facts.',
      'Do not invent or assume property features not stated in the input.',
      'Use precise measurements and condition ratings as provided.',
    ].join(' '),
    sections: [
      'site_description',
      'improvements_description',
      'condition_description',
    ],
  },

  // ── logic-template ──────────────────────────────────────────────────────────
  // For highest and best use and zoning logic sections where
  // structured reasoning must follow a specific analytical framework.
  'logic-template': {
    id:              'logic-template',
    label:           'Logic-Template',
    description:     'For highest and best use and zoning logic',
    temperature:     0.35,
    maxTokens:       700,
    retrievalWeight: 0.35,
    templateWeight:  0.65,
    systemHint: [
      'Follow the four-part HBU test: legally permissible, physically possible,',
      'financially feasible, maximally productive.',
      'State conclusions clearly and support each with the provided facts.',
      'Do not reach conclusions unsupported by the data.',
    ].join(' '),
    sections: ['highest_best_use'],
  },

  // ── analysis-narrative ──────────────────────────────────────────────────────
  // For comparable commentary and sales comparison sections where
  // structured analysis must be converted into narrative language.
  'analysis-narrative': {
    id:              'analysis-narrative',
    label:           'Analysis-Narrative',
    description:     'For comparable commentary and sales comparison',
    temperature:     0.55,
    maxTokens:       900,
    retrievalWeight: 0.55,
    templateWeight:  0.45,
    systemHint: [
      'Explain the comparable selection process and adjustment rationale.',
      'Do NOT fabricate comparable addresses, prices, or specific dollar amounts.',
      'Only describe adjustment categories — never invent adjustment amounts.',
      'Reference the search process and market time adjustment if applicable.',
    ].join(' '),
    sections: ['sales_comparison_summary'],
  },

  // ── valuation-approach ──────────────────────────────────────────────────────
  // For cost approach and income approach narratives that must accurately
  // describe computation methodology and the resulting value indication.
  'valuation-approach': {
    id:              'valuation-approach',
    label:           'Valuation-Approach',
    description:     'For cost and income approach narrative summaries',
    temperature:     0.30,
    maxTokens:       600,
    retrievalWeight: 0.3,
    templateWeight:  0.7,
    systemHint: [
      'Describe the valuation approach methodology accurately.',
      'State all dollar amounts, rates, and multipliers exactly as provided in the facts.',
      'Do not invent or estimate values not present in the input data.',
      'Follow the standard URAR form structure for the approach being described.',
      'If data is insufficient, state that the approach was considered but not developed.',
    ].join(' '),
    sections: [
      'cost_approach_summary',
      'income_approach_summary',
    ],
  },

  // ── prior-transaction ─────────────────────────────────────────────────────
  // For prior sales/transfer history and offering history sections that
  // require factual recounting of transaction events.
  'prior-transaction': {
    id:              'prior-transaction',
    label:           'Prior-Transaction',
    description:     'For prior sales history and offering history',
    temperature:     0.20,
    maxTokens:       400,
    retrievalWeight: 0.15,
    templateWeight:  0.85,
    systemHint: [
      'Report the prior sale history and offering history of the subject property factually.',
      'Include dates, prices, and any concessions exactly as provided.',
      'If no prior sales exist within the required period, state that clearly.',
      'Do not speculate about market conditions affecting prior transactions.',
    ].join(' '),
    sections: ['prior_sales', 'offering_history'],
  },

  // ── exposure-time ─────────────────────────────────────────────────────────
  // For exposure/marketing time estimates based on market data.
  'exposure-time': {
    id:              'exposure-time',
    label:           'Exposure-Time',
    description:     'For exposure and marketing time estimates',
    temperature:     0.25,
    maxTokens:       300,
    retrievalWeight: 0.25,
    templateWeight:  0.75,
    systemHint: [
      'State the estimated exposure time based on market data provided.',
      'Reference the typical DOM and market trend from the facts.',
      'Keep the narrative concise and directly supported by data.',
    ].join(' '),
    sections: ['exposure_time'],
  },

  // ── synthesis ───────────────────────────────────────────────────────────────
  // For reconciliation and conclusions where the narrative must
  // synthesize all prior sections into a coherent final statement.
  'synthesis': {
    id:              'synthesis',
    label:           'Synthesis',
    description:     'For reconciliation and conclusions',
    temperature:     0.50,
    maxTokens:       600,
    retrievalWeight: 0.45,
    templateWeight:  0.55,
    systemHint: [
      'Synthesize the key findings from the neighborhood, market, improvements,',
      'and sales comparison sections into a coherent reconciliation.',
      'State the final value conclusion clearly and support it with the analysis.',
      'Do not introduce new facts not established in prior sections.',
    ].join(' '),
    sections: ['reconciliation'],
    // Note: synthesis sections depend on prior sections being completed first
    requiresPriorSections: true,
  },

  // ── micro-narrative ────────────────────────────────────────────────────────
  // For per-adjustment micro-narratives in sales comparison approach.
  // Low creativity, high precision for individual comparable descriptions.
  'micro-narrative': {
    id:              'micro-narrative',
    label:           'Micro-Narrative',
    description:     'For per-adjustment micro-narratives in sales comparison',
    temperature:     0.30,
    maxTokens:       150,
    retrievalWeight: 0.2,
    templateWeight:  0.8,
    systemHint: [
      'Generate precise, factual micro-narratives for individual comparable properties.',
      'Focus on specific differences from subject property and quantified adjustments.',
      'Do not invent data. Use [INSERT] for missing information.',
      'Be concise and technical; each narrative should support one adjustment rationale.',
    ].join(' '),
    sections: ['sales_comparison_adjustment', 'comparable_detail'],
  },

  // ── structured-hybrid ──────────────────────────────────────────────────────
  // For sections that mix structured data fields with narrative text.
  // Neighborhood, site, improvements, market conditions.
  'structured-hybrid': {
    id:              'structured-hybrid',
    label:           'Structured-Hybrid',
    description:     'For sections mixing structured fields with narrative',
    temperature:     0.50,
    maxTokens:       600,
    retrievalWeight: 0.4,
    templateWeight:  0.6,
    systemHint: [
      'Balance structured fact presentation with explanatory narrative.',
      'Use specific data: percentages, measurements, ratings (C1-C6, Q1-Q6, UAD codes).',
      'Introduce data fields naturally within flowing paragraphs.',
      'Maintain technical accuracy while preserving readability.',
    ].join(' '),
    sections: [
      'neighborhood_structured',
      'site_structured',
      'improvements_structured',
      'market_conditions_integrated',
    ],
  },
};

// ── Lookup helpers ────────────────────────────────────────────────────────────

/**
 * Get a generator profile by ID.
 * Falls back to 'retrieval-guided' if not found.
 *
 * @param {string} profileId
 * @returns {object}
 */
export function getProfile(profileId) {
  return GENERATOR_PROFILES[profileId] || GENERATOR_PROFILES['retrieval-guided'];
}

/**
 * Resolve the generator profile for a section ID.
 * Scans all profiles for a matching section assignment.
 * Falls back to 'retrieval-guided'.
 *
 * @param {string} sectionId
 * @returns {object}
 */
export function resolveProfileForSection(sectionId) {
  for (const profile of Object.values(GENERATOR_PROFILES)) {
    if (Array.isArray(profile.sections) && profile.sections.includes(sectionId)) {
      return profile;
    }
  }
  return GENERATOR_PROFILES['retrieval-guided'];
}

/**
 * Get all profile IDs.
 *
 * @returns {string[]}
 */
export function listProfileIds() {
  return Object.keys(GENERATOR_PROFILES);
}

/**
 * Build the generation options object for a section job.
 * Merges profile defaults with any per-section overrides.
 *
 * @param {string} profileId
 * @param {object} overrides — optional per-section overrides
 * @returns {object}
 */
export function buildGenerationOptions(profileId, overrides = {}) {
  const profile = getProfile(profileId);
  return {
    temperature:     overrides.temperature     ?? profile.temperature,
    maxTokens:       overrides.maxTokens       ?? profile.maxTokens,
    retrievalWeight: overrides.retrievalWeight ?? profile.retrievalWeight,
    templateWeight:  overrides.templateWeight  ?? profile.templateWeight,
    systemHint:      overrides.systemHint      ?? profile.systemHint,
    profileId:       profile.id,
    profileLabel:    profile.label,
  };
}
