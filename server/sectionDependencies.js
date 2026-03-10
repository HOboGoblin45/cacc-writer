/**
 * server/sectionDependencies.js
 * ------------------------------
 * Section dependency rules for narrative generation.
 *
 * Each section declares:
 *   required:    facts that should exist before generation (warn if missing)
 *   recommended: facts that improve quality (note if missing, don't block)
 *
 * Fact paths use dot notation: 'subject.city', 'comps.0.salePrice', etc.
 * Array indices like 'comps.0.address' resolve against facts.comps[0].address.
 *
 * ── ACTIVE PRODUCTION SCOPE ──────────────────────────────────────────────────
 * Lane 1: 1004 single-family residential (ACI) — FULLY TUNED
 * Lane 2: commercial (Real Quantum)             — FULLY TUNED
 *
 * ── DEFERRED SCOPE ───────────────────────────────────────────────────────────
 * 1025, 1073, 1004c — files preserved, NOT actively extended.
 * See SCOPE.md for full scope definition.
 */

// ── Section dependency map ────────────────────────────────────────────────────

export const SECTION_DEPENDENCIES = {

  // ── 1004 URAR fields ────────────────────────────────────────────────────────

  offering_history: {
    required:    ['subject.address', 'contract.contractPrice', 'contract.contractDate'],
    recommended: ['contract.offeringHistory', 'contract.daysOnMarket', 'contract.closingDate'],
  },

  contract_analysis: {
    required:    ['contract.contractPrice', 'contract.contractDate'],
    recommended: ['contract.sellerConcessions', 'contract.financing', 'contract.closingDate', 'contract.daysOnMarket'],
  },

  concessions: {
    required:    ['contract.sellerConcessions'],
    recommended: ['contract.contractPrice', 'contract.financing'],
  },

  neighborhood_boundaries: {
    required:    ['neighborhood.boundaries'],
    recommended: ['subject.city', 'subject.county', 'subject.state'],
  },

  neighborhood_description: {
    required:    ['subject.city', 'subject.county'],
    recommended: ['neighborhood.description', 'neighborhood.landUse', 'neighborhood.builtUp', 'market.trend'],
  },

  market_conditions: {
    required:    ['market.trend'],
    recommended: ['market.trendStat', 'market.trendStatSource', 'market.typicalDOM', 'market.priceRange', 'market.exposureTime'],
  },

  site_comments: {
    required:    ['subject.address', 'subject.siteSize', 'subject.zoning'],
    recommended: ['subject.parcelId', 'subject.county'],
  },

  improvements_condition: {
    required:    ['subject.gla', 'subject.beds', 'subject.baths', 'subject.condition'],
    recommended: ['subject.yearBuilt', 'subject.style', 'subject.basement', 'subject.garage', 'subject.quality'],
  },

  sca_summary: {
    required:    ['subject.gla', 'subject.condition'],
    recommended: [
      'comps.0.address', 'comps.0.salePrice', 'comps.0.saleDate',
      'comps.1.address', 'comps.1.salePrice',
      'comps.2.address', 'comps.2.salePrice',
      'market.trend',
    ],
  },

  reconciliation: {
    required:    ['subject.gla', 'subject.condition', 'subject.quality'],
    recommended: [
      'comps.0.salePrice', 'comps.1.salePrice', 'comps.2.salePrice',
      'market.trend', 'market.trendStat',
    ],
  },

  exposure_time: {
    required:    ['market.typicalDOM'],
    recommended: ['market.exposureTime', 'market.trend'],
  },

  // ── Shared fields (1004 + commercial — active) ───────────────────────────────

  site_description: {
    required:    ['subject.address', 'subject.siteSize'],
    recommended: ['subject.zoning', 'subject.county'],
  },

  improvements_description: {
    required:    ['subject.gla', 'subject.condition'],
    recommended: ['subject.yearBuilt', 'subject.style', 'subject.quality'],
  },

  sales_comparison_commentary: {
    required:    ['subject.gla', 'subject.condition'],
    recommended: ['comps.0.salePrice', 'comps.1.salePrice', 'comps.2.salePrice'],
  },

  market_area: {
    required:    ['subject.city'],
    recommended: ['market.trend', 'neighborhood.description', 'subject.county'],
  },

  sales_comparison: {
    required:    ['subject.gla'],
    recommended: ['comps.0.salePrice', 'comps.1.salePrice', 'comps.2.salePrice', 'market.trend'],
  },

  // ── Commercial sections (Lane 2 — Real Quantum) ──────────────────────────────

  // Commercial: neighborhood overview (Introduction section in RQ)
  neighborhood: {
    required:    ['subject.city', 'subject.county'],
    recommended: ['neighborhood.description', 'neighborhood.landUse', 'market.trend', 'subject.state'],
  },

  // Commercial: market overview (MarketData section in RQ)
  market_overview: {
    required:    ['market.trend', 'subject.city'],
    recommended: [
      'market.trendStat', 'market.trendStatSource',
      'market.typicalDOM', 'market.priceRange',
      'market.vacancyRate', 'market.absorptionRate',
      'subject.county',
    ],
  },

  // Commercial: highest and best use (HighestBestUse section in RQ)
  highest_best_use: {
    required:    ['subject.address', 'subject.zoning'],
    recommended: [
      'subject.siteSize', 'subject.city', 'subject.county',
      'neighborhood.landUse', 'market.trend',
    ],
  },

  // Commercial: conclusion / reconciliation remarks (Reconciliation section in RQ)
  // Note: 'reconciliation' key is shared with 1004 — commercial uses same key
  // The prompt builder differentiates by formType context

  // Commercial: income approach summary (IncomeApproach section in RQ)
  income_approach_summary: {
    required:    ['subject.gla', 'subject.condition'],
    recommended: [
      'income.grossRent', 'income.vacancyRate', 'income.effectiveGrossIncome',
      'income.operatingExpenses', 'income.netOperatingIncome', 'income.capRate',
    ],
  },

  // Commercial: cost approach summary (CostApproach section in RQ)
  cost_approach_summary: {
    required:    ['subject.gla'],
    recommended: [
      'cost.landValue', 'cost.improvementValue', 'cost.depreciation',
      'cost.totalValue', 'subject.yearBuilt',
    ],
  },

  // Commercial: sales comparison approach (SalesComparison section in RQ)
  sales_comparison_approach: {
    required:    ['subject.gla', 'subject.condition'],
    recommended: [
      'comps.0.salePrice', 'comps.0.saleDate', 'comps.0.address',
      'comps.1.salePrice', 'comps.1.saleDate',
      'comps.2.salePrice', 'comps.2.saleDate',
      'market.trend',
    ],
  },

  // ── DEFERRED: 1025-specific sections ─────────────────────────────────────────
  // DEFERRED — 1025 form type not in active production scope.
  // See SCOPE.md. Do not extend these until 1025 lane is activated.

  income_approach: {
    // DEFERRED (1025)
    required:    [],
    recommended: ['subject.gla', 'subject.condition'],
  },

  // ── DEFERRED: 1073-specific sections ─────────────────────────────────────────
  // DEFERRED — 1073 form type not in active production scope.
  // See SCOPE.md. Do not extend these until 1073 lane is activated.

  project_information: {
    // DEFERRED (1073)
    required:    ['subject.address'],
    recommended: ['subject.city', 'subject.county'],
  },
};

// ── resolvePath ───────────────────────────────────────────────────────────────
/**
 * Resolves a dotted fact path against a facts object.
 * Handles array indices: 'comps.0.salePrice' → facts.comps[0].salePrice
 *
 * @param {object} facts
 * @param {string} dotPath — e.g. 'subject.city', 'comps.0.salePrice'
 * @returns {*} resolved value, or null if missing/empty
 */
function resolvePath(facts, dotPath) {
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
  // Support both plain values and { value, confidence } objects
  const val = (cur && typeof cur === 'object' && 'value' in cur) ? cur.value : cur;
  if (val === null || val === undefined) return null;
  return String(val).trim() !== '' ? val : null;
}

// ── getMissingFacts ───────────────────────────────────────────────────────────
/**
 * Computes which required and recommended facts are missing for a given section.
 *
 * @param {string} fieldId — e.g. 'neighborhood_description'
 * @param {object} facts   — case facts.json
 * @returns {{ required: string[], recommended: string[], hasBlockers: boolean }}
 */
export function getMissingFacts(fieldId, facts) {
  const deps = SECTION_DEPENDENCIES[fieldId];
  if (!deps) return { required: [], recommended: [], hasBlockers: false };

  const missingRequired    = (deps.required    || []).filter(p => !resolvePath(facts, p));
  const missingRecommended = (deps.recommended || []).filter(p => !resolvePath(facts, p));

  return {
    required:    missingRequired,
    recommended: missingRecommended,
    hasBlockers: missingRequired.length > 0,
  };
}

// ── formatMissingFactsForUI ───────────────────────────────────────────────────
/**
 * Formats missing facts into a human-readable structure for the UI.
 * Converts dotted paths to readable labels.
 *
 * @param {{ required: string[], recommended: string[] }} missing
 * @returns {{ required: string[], recommended: string[] }} — human-readable labels
 */
export function formatMissingFactsForUI(missing) {
  const label = path => {
    // Convert 'subject.gla' → 'Subject: GLA'
    // Convert 'comps.0.salePrice' → 'Comp 1: Sale Price'
    const parts = path.split('.');
    if (parts[0] === 'comps' && parts.length >= 3) {
      const compNum = parseInt(parts[1], 10) + 1;
      const field = parts[2].replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
      return `Comp ${compNum}: ${field}`;
    }
    const section = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const field = (parts[1] || '').replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    return field ? `${section}: ${field}` : section;
  };

  return {
    required:    (missing.required    || []).map(label),
    recommended: (missing.recommended || []).map(label),
    hasBlockers: (missing.required    || []).length > 0,
  };
}

// ── getSectionDependencies ────────────────────────────────────────────────────
/**
 * Returns the raw dependency config for a field.
 * Returns empty deps if field has no declared dependencies.
 */
export function getSectionDependencies(fieldId) {
  return SECTION_DEPENDENCIES[fieldId] || { required: [], recommended: [] };
}
