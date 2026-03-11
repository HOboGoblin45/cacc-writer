/**
 * server/intelligence/assignmentSchema.js
 * -----------------------------------------
 * Phase 4 — Assignment Intelligence: Type definitions, constants,
 * and normalization utilities for the expanded assignment context.
 *
 * This module defines the canonical shapes for:
 *   - RawAssignmentInput
 *   - NormalizedAssignmentContext (v2)
 *   - DerivedAssignmentFlags
 *   - ComplianceProfile
 *   - AssignmentIntelligenceBundle
 *
 * All shapes are documented via JSDoc typedefs.
 */

// ── Assignment standard constants ───────────────────────────────────────────

export const ASSIGNMENT_PURPOSES = ['purchase', 'refinance', 'equity', 'relocation', 'estate', 'divorce', 'pmi_removal', 'other'];

export const LOAN_PROGRAMS = ['conventional', 'fha', 'va', 'usda', 'portfolio', 'jumbo', 'heloc', 'other'];

export const REPORT_TYPES = ['appraisal_report', 'restricted_appraisal_report'];

export const FORM_TYPES = ['1004', '1025', '1073', '1004c', 'commercial'];

export const PROPERTY_TYPES = [
  'single_family', 'condo', 'townhouse', 'pud',
  'multi_unit_2', 'multi_unit_3', 'multi_unit_4',
  'manufactured_home', 'modular_home',
  'mixed_use', 'commercial', 'industrial', 'land',
  'agricultural', 'special_purpose',
];

export const OCCUPANCY_TYPES = ['owner_occupied', 'tenant_occupied', 'vacant', 'investment'];

export const TENURE_TYPES = ['fee_simple', 'leasehold'];

export const VALUE_CONDITIONS = [
  'as_is',
  'subject_to_completion',
  'subject_to_repairs',
  'subject_to_inspection',
  'prospective',
  'retrospective',
];

export const ZONING_CONFORMITY = ['legal_conforming', 'legal_nonconforming', 'illegal', 'no_zoning'];

export const CONDITION_RATINGS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

export const QUALITY_RATINGS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];

// ── JSDoc Typedefs ──────────────────────────────────────────────────────────

/**
 * @typedef {object} RawAssignmentInput
 * Raw case data as ingested from meta.json + facts.json before normalization.
 * @property {string}      caseId
 * @property {object}      meta           — from meta.json
 * @property {object}      facts          — from facts.json
 */

/**
 * @typedef {object} NormalizedAssignmentContext
 * Expanded v2 context representing the full assignment problem.
 *
 * @property {string}      caseId
 * @property {string}      formType                — e.g. '1004', 'commercial'
 * @property {string}      reportType              — 'appraisal_report' | 'restricted_appraisal_report'
 * @property {string}      assignmentPurpose       — 'purchase' | 'refinance' | ...
 * @property {string}      loanProgram             — 'conventional' | 'fha' | 'va' | 'usda' | ...
 * @property {string}      valueCondition          — 'as_is' | 'subject_to_completion' | ...
 * @property {string}      propertyType            — 'single_family' | 'condo' | ...
 * @property {string}      occupancyType           — 'owner_occupied' | 'tenant_occupied' | ...
 * @property {string}      tenureType              — 'fee_simple' | 'leasehold'
 * @property {number}      unitCount               — 1-4 for residential, any for commercial
 *
 * @property {object}      client
 * @property {string|null} client.name
 * @property {string|null} client.lender
 * @property {string|null} client.amc
 *
 * @property {string|null} intendedUse
 * @property {string|null} intendedUser
 *
 * @property {string[]}    extraordinaryAssumptions
 * @property {string[]}    hypotheticalConditions
 *
 * @property {object}      subject                 — expanded subject property data
 * @property {object}      site                    — expanded site characteristics
 * @property {object}      improvements            — expanded improvements data
 * @property {object}      neighborhood            — neighborhood data
 * @property {object}      market                  — market data
 * @property {object}      assignment              — assignment details
 * @property {object[]}    comps                   — normalized comparables
 *
 * @property {object}      approaches              — valuation approaches
 * @property {boolean}     approaches.salesApplicable
 * @property {boolean}     approaches.costApplicable
 * @property {boolean}     approaches.incomeApplicable
 * @property {string|null} approaches.salesExclusionReason
 * @property {string|null} approaches.costExclusionReason
 * @property {string|null} approaches.incomeExclusionReason
 *
 * @property {object}      indicators              — special property indicators
 * @property {boolean}     indicators.mixedUse
 * @property {boolean}     indicators.adu
 * @property {boolean}     indicators.manufacturedHome
 * @property {boolean}     indicators.rural
 * @property {boolean}     indicators.incomeProducing
 * @property {boolean}     indicators.newConstruction
 * @property {boolean}     indicators.proposedConstruction
 * @property {boolean}     indicators.rehabilitation
 *
 * @property {string}      _version                — '2.0'
 * @property {string}      _builtAt                — ISO timestamp
 */

/**
 * @typedef {object} DerivedAssignmentFlags
 * Deterministic flags derived from NormalizedAssignmentContext.
 * Every flag is a boolean. No LLM involvement.
 *
 * See derivedFlags.js for the full flag set.
 */

/**
 * @typedef {object} ComplianceProfile
 * Structured compliance identification (not a rule engine).
 *
 * @property {boolean}     uspap_applicable
 * @property {boolean}     fha_overlay
 * @property {boolean}     usda_overlay
 * @property {boolean}     va_overlay
 * @property {string}      report_family            — resolved report family id
 * @property {string[]}    property_type_implications
 * @property {string[]}    assignment_condition_implications
 * @property {string[]}    likely_commentary_families
 * @property {string[]}    likely_qc_categories
 */

/**
 * @typedef {object} AssignmentIntelligenceBundle
 * The complete Phase 4 output for a case.
 *
 * @property {NormalizedAssignmentContext} context
 * @property {DerivedAssignmentFlags}     flags
 * @property {ComplianceProfile}          compliance
 * @property {object}                     reportFamily    — resolved ReportFamilyManifest
 * @property {object[]}                   canonicalFields — applicable canonical fields
 * @property {object}                     sectionPlan     — v2 section plan
 * @property {object}                     sectionRequirements — deterministic requirement matrix
 * @property {object}                     complianceChecks — deterministic hard-rule findings
 * @property {string}                     _version
 * @property {string}                     _builtAt
 * @property {number}                     _buildMs
 */

// ── Normalization helpers ───────────────────────────────────────────────────

/**
 * Coerce a string to a known enum value, or return the fallback.
 * Case-insensitive, trims whitespace, converts spaces/dashes to underscores.
 */
export function coerceEnum(value, allowedValues, fallback) {
  if (!value) return fallback;
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return allowedValues.includes(normalized) ? normalized : fallback;
}

/**
 * Safe fact value extractor — handles both plain values and { value, confidence } objects.
 */
export function factVal(obj, key, fallback = null) {
  if (!obj || typeof obj !== 'object') return fallback;
  const entry = obj[key];
  if (entry === null || entry === undefined) return fallback;
  if (typeof entry === 'object' && 'value' in entry) {
    return entry.value ?? fallback;
  }
  return entry ?? fallback;
}

/**
 * Parse a value as a positive integer, or return null.
 */
export function asPositiveInt(v) {
  if (v === null || v === undefined) return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) || n < 0 ? null : n;
}

/**
 * Parse a boolean-ish value.
 */
export function asBool(v, fallback = false) {
  if (v === true || v === 'true' || v === '1' || v === 'yes') return true;
  if (v === false || v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}
