/**
 * server/intelligence/derivedFlags.js
 * --------------------------------------
 * Phase 4 — Derived Assignment Flags Engine
 *
 * Deterministic, testable logic that derives operational flags from a
 * NormalizedAssignmentContext (v2). No LLM involvement.
 *
 * Every flag is a boolean. The flag set drives:
 *   - compliance profile selection
 *   - report family resolution
 *   - canonical field applicability
 *   - section planning
 *   - future QC category tagging
 *
 * Usage:
 *   import { deriveAssignmentFlags } from './intelligence/derivedFlags.js';
 *   const flags = deriveAssignmentFlags(normalizedContext);
 */

// ── Flood zone helpers ──────────────────────────────────────────────────────

const NON_FLOOD_ZONES = new Set(['X', 'Zone X', 'C', 'Zone C', 'B', 'Zone B', '']);

function isFloodZone(floodZoneVal) {
  if (!floodZoneVal) return false;
  const normalized = String(floodZoneVal).trim();
  return normalized !== '' && !NON_FLOOD_ZONES.has(normalized);
}

function isHighRiskFloodZone(floodZoneVal) {
  if (!floodZoneVal) return false;
  const normalized = String(floodZoneVal).trim().toUpperCase();
  return /^(A|AE|AH|AO|AR|A1-A30|A99|V|VE|V1-V30)$/i.test(normalized);
}

// ── Main flag derivation ────────────────────────────────────────────────────

/**
 * Derive all assignment flags from a NormalizedAssignmentContext (v2).
 *
 * @param {import('./assignmentSchema.js').NormalizedAssignmentContext} ctx
 * @returns {import('./assignmentSchema.js').DerivedAssignmentFlags}
 */
export function deriveAssignmentFlags(ctx) {
  const lp   = (ctx.loanProgram || '').toLowerCase();
  const ap   = (ctx.assignmentPurpose || '').toLowerCase();
  const vc   = (ctx.valueCondition || '').toLowerCase();
  const ft   = (ctx.formType || '1004').toLowerCase();
  const pt   = (ctx.propertyType || '').toLowerCase();
  const ot   = (ctx.occupancyType || '').toLowerCase();
  const tt   = (ctx.tenureType || '').toLowerCase();
  const uc   = ctx.unitCount ?? 1;

  const site   = ctx.site || {};
  const subj   = ctx.subject || {};
  const market = ctx.market || {};
  const ind    = ctx.indicators || {};
  const app    = ctx.approaches || {};
  const ea     = ctx.extraordinaryAssumptions || [];
  const hc     = ctx.hypotheticalConditions || [];
  const comps  = ctx.comps || [];
  const zc     = (site.zoningConformity || '').toLowerCase();

  // ── Loan program flags ──────────────────────────────────────────────────
  const conventional_assignment = lp === 'conventional' || lp === '' || lp === 'jumbo' || lp === 'portfolio';
  const fha_assignment          = lp === 'fha';
  const usda_assignment         = lp === 'usda';
  const va_assignment           = lp === 'va';
  const government_loan         = fha_assignment || usda_assignment || va_assignment;

  // ── Property type flags ─────────────────────────────────────────────────
  const single_family       = pt === 'single_family' || pt === 'townhouse' || pt === 'pud' || (ft === '1004' && !pt);
  const condo               = pt === 'condo' || ft === '1073';
  const multi_unit           = uc >= 2 && uc <= 4;
  const manufactured_home   = pt === 'manufactured_home' || pt === 'modular_home' || ft === '1004c' || ind.manufacturedHome === true;
  const mixed_use           = pt === 'mixed_use' || ind.mixedUse === true;
  const commercial_property = pt === 'commercial' || pt === 'industrial' || ft === 'commercial';
  const adu_present         = ind.adu === true;
  const rural_property      = ind.rural === true;
  const income_producing    = ind.incomeProducing === true || multi_unit || commercial_property;

  // ── Value condition flags ───────────────────────────────────────────────
  const as_is_value            = vc === 'as_is' || vc === '';
  const subject_to_repairs     = vc === 'subject_to_repairs';
  const subject_to_completion  = vc === 'subject_to_completion';
  const subject_to_inspection  = vc === 'subject_to_inspection';
  const prospective_value      = vc === 'prospective';
  const retrospective_value    = vc === 'retrospective';
  const subject_to_any         = subject_to_repairs || subject_to_completion || subject_to_inspection;

  // ── Construction / rehab flags ──────────────────────────────────────────
  const new_construction       = ind.newConstruction === true;
  const proposed_construction  = ind.proposedConstruction === true;
  const rehabilitation         = ind.rehabilitation === true;
  const repair_commentary_required = subject_to_repairs || rehabilitation || (fha_assignment && subject_to_any);

  // ── Site / zoning / flood flags ─────────────────────────────────────────
  const flood_zone              = isFloodZone(site.floodZone);
  const high_risk_flood_zone    = isHighRiskFloodZone(site.floodZone);
  const nonconforming_zoning    = zc === 'legal_nonconforming' || zc === 'illegal';
  const illegal_zoning          = zc === 'illegal';
  const zoning_commentary_required = nonconforming_zoning || illegal_zoning;
  const flood_commentary_required  = flood_zone;

  // ── Approach flags ──────────────────────────────────────────────────────
  const sales_approach_required  = app.salesApplicable !== false;
  const cost_approach_likely     = new_construction || proposed_construction || (app.costApplicable === true);
  const income_approach_likely   = income_producing || multi_unit || commercial_property || (app.incomeApplicable === true);

  // ── Assignment condition flags ──────────────────────────────────────────
  const extraordinary_assumption_present = ea.length > 0;
  const hypothetical_condition_present   = hc.length > 0;
  const additional_certification_risk    = extraordinary_assumption_present || hypothetical_condition_present || subject_to_any || retrospective_value || prospective_value;

  // ── Market / comp flags ─────────────────────────────────────────────────
  const has_comps                  = comps.length > 0;
  const limited_comps              = comps.length > 0 && comps.length < 3;
  const market_time_adjustment     = Number(market.marketTimeAdjustmentPercent) > 0;
  const declining_market           = (market.trend || '').toLowerCase() === 'declining';

  // ── Occupancy / tenure flags ────────────────────────────────────────────
  const owner_occupied  = ot === 'owner_occupied' || ot === '';
  const investment      = ot === 'investment';
  const vacant          = ot === 'vacant';
  const leasehold       = tt === 'leasehold';

  // ── FHA-specific flags ──────────────────────────────────────────────────
  const fha_repair_required = fha_assignment && (subject_to_repairs || repair_commentary_required);
  const usda_site_eligibility_required = usda_assignment;

  return {
    // Loan program
    conventional_assignment,
    fha_assignment,
    usda_assignment,
    va_assignment,
    government_loan,

    // Property type
    single_family,
    condo,
    multi_unit,
    manufactured_home,
    mixed_use,
    commercial_property,
    adu_present,
    rural_property,
    income_producing,

    // Value condition
    as_is_value,
    subject_to_repairs,
    subject_to_completion,
    subject_to_inspection,
    subject_to_any,
    prospective_value,
    retrospective_value,

    // Construction / rehab
    new_construction,
    proposed_construction,
    rehabilitation,
    repair_commentary_required,

    // Site / zoning / flood
    flood_zone,
    high_risk_flood_zone,
    nonconforming_zoning,
    illegal_zoning,
    zoning_commentary_required,
    flood_commentary_required,

    // Approaches
    sales_approach_required,
    cost_approach_likely,
    income_approach_likely,

    // Assignment conditions
    extraordinary_assumption_present,
    hypothetical_condition_present,
    additional_certification_risk,

    // Market / comps
    has_comps,
    limited_comps,
    market_time_adjustment,
    declining_market,

    // Occupancy / tenure
    owner_occupied,
    investment,
    vacant,
    leasehold,

    // Program-specific
    fha_repair_required,
    usda_site_eligibility_required,
  };
}

/**
 * Get a human-readable summary of active (true) flags.
 * Useful for UI display and logging.
 *
 * @param {DerivedAssignmentFlags} flags
 * @returns {{ active: string[], count: number, total: number }}
 */
export function summarizeFlags(flags) {
  const entries = Object.entries(flags);
  const active = entries.filter(([, v]) => v === true).map(([k]) => k);
  return {
    active,
    count: active.length,
    total: entries.length,
  };
}
