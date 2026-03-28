/**
 * destinationRegistry.js
 * ----------------------
 * Centralized registry of all insertion targets for Appraisal Agent.
 *
 * Maps sectionId + formType â†’ targetSoftware, tab/section, field selector,
 * verification method, and fallback strategy.
 *
 * All insertion logic (ACI agent, Real Quantum agent) must resolve through
 * this registry before attempting insertion. No hardcoded targets elsewhere.
 *
 * Active production scope: 1004 (ACI) + commercial (Real Quantum)
 * Deferred: 1025, 1073, 1004c â€” entries kept but marked deferred.
 */

// â”€â”€ Registry entries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * @typedef {Object} DestinationEntry
 * @property {string}   sectionId         - fieldId / sectionType key
 * @property {string}   formType          - '1004' | 'commercial' | '1025' | '1073' | '1004c'
 * @property {string}   targetSoftware    - 'aci' | 'real_quantum'
 * @property {string}   tabName           - Tab or section name in target software
 * @property {string}   fieldLabel        - Human-readable field label in target software
 * @property {string}   editorTarget      - CSS selector, field name, or ACI box ID
 * @property {string}   verificationMethod - 'contains_text' | 'exact_match' | 'dom_presence' | 'screenshot_ocr'
 * @property {string}   fallbackStrategy  - 'retry' | 'clipboard' | 'manual_prompt' | 'retry_then_clipboard'
 * @property {boolean}  active            - true = active production scope; false = deferred
 * @property {string}   [notes]           - Optional notes for the appraiser/developer
 */

const REGISTRY = [

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // 1004 SINGLE-FAMILY â€” ACI (ACTIVE PRODUCTION)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  {
    sectionId:          'neighborhood_description',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Neighborhood',
    fieldLabel:         'Neighborhood Description',
    editorTarget:       'neighborhood_description',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'market_conditions',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Market Conditions',
    fieldLabel:         'Market Conditions',
    editorTarget:       'market_conditions',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'site_description',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Site',
    fieldLabel:         'Site Description',
    editorTarget:       'site_description',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'improvements_description',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Improvements',
    fieldLabel:         'Improvements Description',
    editorTarget:       'improvements_description',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'improvements_condition',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Improvements',
    fieldLabel:         'Condition Description',
    editorTarget:       'improvements_condition',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'condition_description',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Improvements',
    fieldLabel:         'Condition Description',
    editorTarget:       'condition_description',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'contract_analysis',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Sales Comparison',
    fieldLabel:         'Contract Analysis',
    editorTarget:       'contract_analysis',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'concessions_analysis',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Sales Comparison',
    fieldLabel:         'Concessions Analysis',
    editorTarget:       'concessions_analysis',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'highest_best_use',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Site',
    fieldLabel:         'Highest and Best Use',
    editorTarget:       'highest_best_use',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'sca_summary',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Sales Comparison',
    fieldLabel:         'Sales Comparison Summary',
    editorTarget:       'sca_summary',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'sales_comparison_summary',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Sales Comparison',
    fieldLabel:         'Sales Comparison Summary',
    editorTarget:       'sales_comparison_summary',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'reconciliation',
    formType:           '1004',
    targetSoftware:     'aci',
    tabName:            'Reconciliation',
    fieldLabel:         'Reconciliation',
    editorTarget:       'reconciliation',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // COMMERCIAL â€” REAL QUANTUM (ACTIVE PRODUCTION)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  {
    sectionId:          'neighborhood',
    formType:           'commercial',
    targetSoftware:     'real_quantum',
    tabName:            'Property Data',
    fieldLabel:         'Neighborhood',
    editorTarget:       '[data-section="neighborhood"] .ql-editor, #neighborhood-editor',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'market_area',
    formType:           'commercial',
    targetSoftware:     'real_quantum',
    tabName:            'Market Data',
    fieldLabel:         'Market Overview',
    editorTarget:       '[data-section="market_area"] .ql-editor, #market-area-editor',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'market_overview',
    formType:           'commercial',
    targetSoftware:     'real_quantum',
    tabName:            'Market Data',
    fieldLabel:         'Market Overview',
    editorTarget:       '[data-section="market_overview"] .ql-editor, #market-overview-editor',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'site_description',
    formType:           'commercial',
    targetSoftware:     'real_quantum',
    tabName:            'Property Data',
    fieldLabel:         'Site Description',
    editorTarget:       '[data-section="site_description"] .ql-editor, #site-description-editor',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'improvement_description',
    formType:           'commercial',
    targetSoftware:     'real_quantum',
    tabName:            'Property Data',
    fieldLabel:         'Improvements Description',
    editorTarget:       '[data-section="improvement_description"] .ql-editor, #improvement-description-editor',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'hbu_analysis',
    formType:           'commercial',
    targetSoftware:     'real_quantum',
    tabName:            'Highest and Best Use',
    fieldLabel:         'Highest and Best Use',
    editorTarget:       '[data-section="hbu_analysis"] .ql-editor, #hbu-editor',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },
  {
    sectionId:          'reconciliation',
    formType:           'commercial',
    targetSoftware:     'real_quantum',
    tabName:            'Reconciliation',
    fieldLabel:         'Reconciliation / Conclusion',
    editorTarget:       '[data-section="reconciliation"] .ql-editor, #reconciliation-editor',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             true,
  },

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // DEFERRED FORMS â€” kept for future, not actively wired
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  {
    sectionId:          'neighborhood_description',
    formType:           '1025',
    targetSoftware:     'aci',
    tabName:            'Neighborhood',
    fieldLabel:         'Neighborhood Description',
    editorTarget:       'neighborhood_description',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             false,
    notes:              'DEFERRED â€” 1025 not in active production scope',
  },
  {
    sectionId:          'neighborhood_description',
    formType:           '1073',
    targetSoftware:     'aci',
    tabName:            'Neighborhood',
    fieldLabel:         'Neighborhood Description',
    editorTarget:       'neighborhood_description',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             false,
    notes:              'DEFERRED â€” 1073 not in active production scope',
  },
  {
    sectionId:          'neighborhood_description',
    formType:           '1004c',
    targetSoftware:     'aci',
    tabName:            'Neighborhood',
    fieldLabel:         'Neighborhood Description',
    editorTarget:       'neighborhood_description',
    verificationMethod: 'contains_text',
    fallbackStrategy:   'retry_then_clipboard',
    active:             false,
    notes:              'DEFERRED â€” 1004c not in active production scope',
  },
];

// â”€â”€ Lookup helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * getDestination(formType, sectionId)
 * Returns the registry entry for a given form + section, or null if not found.
 * Only returns active entries unless includeDeferred=true.
 *
 * @param {string}  formType
 * @param {string}  sectionId
 * @param {boolean} [includeDeferred=false]
 * @returns {DestinationEntry|null}
 */
export function getDestination(formType, sectionId, includeDeferred = false) {
  const entry = REGISTRY.find(
    e => e.formType === formType && e.sectionId === sectionId
  );
  if (!entry) return null;
  if (!entry.active && !includeDeferred) return null;
  return entry;
}

/**
 * getDestinationsForForm(formType)
 * Returns all active registry entries for a given form type.
 *
 * @param {string}  formType
 * @param {boolean} [includeDeferred=false]
 * @returns {DestinationEntry[]}
 */
export function getDestinationsForForm(formType, includeDeferred = false) {
  return REGISTRY.filter(
    e => e.formType === formType && (e.active || includeDeferred)
  );
}

/**
 * getTargetSoftware(formType, sectionId)
 * Returns 'aci' | 'real_quantum' | null for a given form + section.
 *
 * @param {string} formType
 * @param {string} sectionId
 * @returns {string|null}
 */
export function getTargetSoftware(formType, sectionId) {
  const entry = getDestination(formType, sectionId);
  return entry ? entry.targetSoftware : null;
}

/**
 * getFallbackStrategy(formType, sectionId)
 * Returns the fallback strategy for a given form + section.
 *
 * @param {string} formType
 * @param {string} sectionId
 * @returns {string} fallback strategy or 'retry_then_clipboard' as default
 */
export function getFallbackStrategy(formType, sectionId) {
  const entry = getDestination(formType, sectionId);
  return entry ? entry.fallbackStrategy : 'retry_then_clipboard';
}

/**
 * listAllDestinations(includeDeferred)
 * Returns the full registry for inspection/API exposure.
 *
 * @param {boolean} [includeDeferred=false]
 * @returns {DestinationEntry[]}
 */
export function listAllDestinations(includeDeferred = false) {
  return includeDeferred ? REGISTRY : REGISTRY.filter(e => e.active);
}

export default {
  getDestination,
  getDestinationsForForm,
  getTargetSoftware,
  getFallbackStrategy,
  listAllDestinations,
};

