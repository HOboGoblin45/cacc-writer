// ============================================================
// Appraisal Agent - Production Scope Configuration
// ============================================================
// Central authority for active vs deferred form type scope.
// All API endpoints, UI logic, and workflow routing should
// import from this module to enforce scope boundaries.
//
// ACTIVE PRODUCTION SCOPE:
//   Lane 1: 1004 single-family residential (ACI)
//   Lane 2: commercial (Real Quantum)
//
// DEFERRED (preserved, not extended):
//   1025, 1073, 1004c
//
// Last updated: 2025 - Scope correction applied.
// See SCOPE.md for full scope definition.
// ============================================================

export const CACC_APPRAISALS_ROOT = process.env.CACC_APPRAISALS_ROOT
  || 'C:\\Users\\ccres\\OneDrive\\Desktop\\CACC Appraisals';

// â”€â”€ Active production form types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Only forms with a proven golden-path (import → generate → export) are active.
export const ACTIVE_FORMS = ['1004', 'commercial'];

// â”€â”€ Deferred form types (files preserved, not actively extended) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 1025/1073 moved here — no proven end-to-end golden path yet.
export const DEFERRED_FORMS = ['1025', '1073', '1004c'];

// â”€â”€ Lane 1: 1004 Single-Family Residential â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const ACTIVE_RESIDENTIAL_LANE = {
  formType:    '1004',
  software:    'aci',
  agentPort:   5180,
  label:       '1004 Single-Family Residential',
  description: 'ACI desktop automation via pywinauto',
};

// â”€â”€ Deferred Lane: 1025 Small Residential Income â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const DEFERRED_1025_LANE = {
  formType:    '1025',
  software:    'aci',
  agentPort:   5180,
  label:       '1025 Small Residential Income (2-4 Unit) — DEFERRED',
  description: 'Not yet proven end-to-end. Deferred from active production.',
};

// â”€â”€ Deferred Lane: 1073 Individual Condo Unit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const DEFERRED_1073_LANE = {
  formType:    '1073',
  software:    'aci',
  agentPort:   5180,
  label:       '1073 Individual Condominium Unit — DEFERRED',
  description: 'Not yet proven end-to-end. Deferred from active production.',
};

// â”€â”€ Lane 2: Commercial â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const ACTIVE_COMMERCIAL_LANE = {
  formType:    'commercial',
  software:    'real_quantum',
  agentPort:   5181,
  label:       'Commercial (Real Quantum)',
  description: 'Real Quantum browser automation via Playwright',
};

// â”€â”€ Priority sections: 1004 (deepest implementation focus) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const PRIORITY_SECTIONS_1004 = [
  'neighborhood_description',
  'market_conditions',
  'site_description',
  'improvements_description',
  'condition_description',
  'contract_analysis',
  'concessions_analysis',
  'highest_best_use',
  'sales_comparison_summary',
  'reconciliation',
];

// â”€â”€ Priority sections: commercial (deepest implementation focus) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const PRIORITY_SECTIONS_COMMERCIAL = [
  'neighborhood',
  'market_overview',
  'improvements_description',
  'highest_best_use',
  'reconciliation',
];

// â”€â”€ Deferred form metadata (for UI display and logging) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const DEFERRED_FORM_META = {
  '1025':  { label: '1025 Small Residential Income', reason: 'No proven end-to-end golden path for generation+export' },
  '1073':  { label: '1073 Individual Condominium Unit', reason: 'No proven end-to-end golden path for generation+export' },
  '1004c': { label: '1004C — Manufactured Home', reason: 'Lower usage frequency; inherits 1004 fields' },
};

// â”€â”€ Scope check helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * isActiveForm(formType)
 * Returns true if the form type is in the active production scope.
 */
export function isActiveForm(formType) {
  return ACTIVE_FORMS.includes(String(formType || '').trim().toLowerCase());
}

/**
 * isDeferredForm(formType)
 * Returns true if the form type is deferred (preserved but not actively supported).
 */
export function isDeferredForm(formType) {
  return DEFERRED_FORMS.includes(String(formType || '').trim().toLowerCase());
}

/**
 * getScopeWarning(formType)
 * Returns a structured scope warning object for deferred forms.
 * Returns null for active forms.
 *
 * Example return for deferred form:
 * {
 *   supported: false,
 *   formType: '1025',
 *   scope: 'deferred',
 *   message: '1025 is currently outside active production scope...',
 * }
 */
export function getScopeWarning(formType) {
  const key = String(formType || '').trim().toLowerCase();
  if (!isDeferredForm(key)) return null;
  const meta = DEFERRED_FORM_META[key] || {};
  return {
    supported: false,
    formType:  key,
    scope:     'deferred',
    message:   `${key} is currently outside active production scope and is not available for active processing. Active forms: ${ACTIVE_FORMS.join(', ')}. ${meta.reason || ''}`.trim(),
  };
}

/**
 * logDeferredAccess(formType, context, logger)
 * Logs a standardized warning when a deferred form is accessed.
 *
 * @param {string} formType  - The deferred form type (e.g. '1025')
 * @param {string} context   - Where the access occurred (e.g. 'POST /api/generate-batch')
 * @param {object} logger    - Logger instance with a .warn() method (optional, falls back to console)
 */
export function logDeferredAccess(formType, context, logger) {
  const log = (logger && typeof logger.warn === 'function') ? logger : console;
  log.warn(
    `[SCOPE] Deferred form access blocked - formType="${formType}" context="${context}" ` +
    `Active scope: ${ACTIVE_FORMS.join(', ')}. ` +
    `This form is deferred and not available for active production workflows.`
  );
}

/**
 * getScopeMetaForForm(formType)
 * Returns scope metadata for any form type (active or deferred).
 * Used by /api/forms to annotate each form with its scope status.
 */
export function getScopeMetaForForm(formType) {
  const key = String(formType || '').trim().toLowerCase();
  if (isActiveForm(key)) {
    return { scope: 'active', supported: true };
  }
  if (isDeferredForm(key)) {
    const meta = DEFERRED_FORM_META[key] || {};
    return {
      scope:     'deferred',
      supported: false,
      reason:    meta.reason || 'Outside active production scope',
    };
  }
  return { scope: 'unknown', supported: false };
}

