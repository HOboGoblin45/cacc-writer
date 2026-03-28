/**
 * server/ingestion/documentClassifier.js
 * ----------------------------------------
 * Phase 5 — Document Classification Engine
 *
 * Classifies uploaded files into document types using deterministic rules:
 *   1. Filename pattern matching (highest priority)
 *   2. Text keyword/signal matching
 *   3. Known form markers
 *
 * No AI involved — fully deterministic and inspectable.
 *
 * Document types:
 *   order_sheet | engagement_letter | contract | mls_sheet |
 *   assessor_record | zoning_document | flood_document |
 *   prior_appraisal | comp_sheet | map_exhibit | photo_batch |
 *   guideline | handwritten_notes | narrative_source | unknown
 *
 * Usage:
 *   import { classifyDocument } from '../ingestion/documentClassifier.js';
 *   const result = classifyDocument(filename, extractedText);
 */

// ── Document type constants ──────────────────────────────────────────────────

export const DOC_TYPES = [
  'order_sheet',
  'engagement_letter',
  'contract',
  'mls_sheet',
  'assessor_record',
  'zoning_document',
  'flood_document',
  'prior_appraisal',
  'comp_sheet',
  'map_exhibit',
  'photo_batch',
  'guideline',
  'handwritten_notes',
  'narrative_source',
  'unknown',
];

export const DOC_TYPE_LABELS = {
  order_sheet:        'Order Sheet / Assignment',
  engagement_letter:  'Engagement Letter',
  contract:           'Purchase Contract',
  mls_sheet:          'MLS Sheet / Listing',
  assessor_record:    'Assessor / Tax Record',
  zoning_document:    'Zoning Document',
  flood_document:     'Flood Document / FEMA',
  prior_appraisal:    'Prior Appraisal Report',
  comp_sheet:         'Comparable Sale Sheet',
  map_exhibit:        'Map / Exhibit',
  photo_batch:        'Photo Addendum',
  guideline:          'Guideline / Manual',
  handwritten_notes:  'Handwritten Notes',
  narrative_source:   'Narrative Source PDF',
  unknown:            'Unknown / Unclassified',
};

// ── Filename pattern rules (checked first) ───────────────────────────────────
// Each rule: { pattern: RegExp, docType: string, confidence: number }

const FILENAME_RULES = [
  // Order sheets
  { pattern: /order[_\s-]*(sheet|form)?/i,     docType: 'order_sheet',       confidence: 0.9 },
  { pattern: /appraisal[_\s-]*order/i,         docType: 'order_sheet',       confidence: 0.9 },
  { pattern: /assignment[_\s-]*(form|sheet)?/i, docType: 'order_sheet',      confidence: 0.85 },
  { pattern: /engagement/i,                     docType: 'engagement_letter', confidence: 0.9 },
  { pattern: /scope[_\s-]*of[_\s-]*work/i,     docType: 'engagement_letter', confidence: 0.85 },

  // Contracts
  { pattern: /contract/i,                       docType: 'contract',          confidence: 0.9 },
  { pattern: /purchase[_\s-]*(agreement|contract)/i, docType: 'contract',    confidence: 0.95 },
  { pattern: /sales?[_\s-]*(agreement|contract)/i,   docType: 'contract',    confidence: 0.9 },
  { pattern: /offer[_\s-]*(to[_\s-]*purchase)?/i,    docType: 'contract',    confidence: 0.85 },

  // MLS
  { pattern: /mls/i,                            docType: 'mls_sheet',        confidence: 0.95 },
  { pattern: /listing[_\s-]*(sheet|data|print)/i, docType: 'mls_sheet',      confidence: 0.9 },
  { pattern: /realtor/i,                         docType: 'mls_sheet',       confidence: 0.7 },

  // Assessor / Tax
  { pattern: /assess(or|ment)/i,                docType: 'assessor_record',  confidence: 0.9 },
  { pattern: /tax[_\s-]*(record|bill|data)/i,   docType: 'assessor_record',  confidence: 0.9 },
  { pattern: /property[_\s-]*card/i,            docType: 'assessor_record',  confidence: 0.85 },
  { pattern: /parcel/i,                          docType: 'assessor_record',  confidence: 0.75 },

  // Zoning
  { pattern: /zoning/i,                          docType: 'zoning_document', confidence: 0.9 },
  { pattern: /land[_\s-]*use/i,                  docType: 'zoning_document', confidence: 0.8 },

  // Flood / FEMA
  { pattern: /flood/i,                           docType: 'flood_document',  confidence: 0.9 },
  { pattern: /fema/i,                            docType: 'flood_document',  confidence: 0.9 },
  { pattern: /firm[_\s-]*(map|panel)/i,          docType: 'flood_document',  confidence: 0.9 },

  // Prior appraisal
  { pattern: /prior[_\s-]*(appraisal|report)/i, docType: 'prior_appraisal', confidence: 0.9 },
  { pattern: /previous[_\s-]*(appraisal|report)/i, docType: 'prior_appraisal', confidence: 0.9 },
  { pattern: /appraisal[_\s-]*(report|pdf)/i,   docType: 'prior_appraisal', confidence: 0.75 },
  { pattern: /urar/i,                            docType: 'prior_appraisal', confidence: 0.85 },
  { pattern: /1004/i,                            docType: 'prior_appraisal', confidence: 0.7 },

  // Comp sheets
  { pattern: /comp(arable)?[_\s-]*\d/i,          docType: 'comp_sheet',     confidence: 0.9 },
  { pattern: /comp(arable)?[_\s-]*(sheet|sale|data)/i, docType: 'comp_sheet', confidence: 0.9 },

  // Maps
  { pattern: /plat[_\s-]*(map)?/i,               docType: 'map_exhibit',    confidence: 0.9 },
  { pattern: /map/i,                              docType: 'map_exhibit',    confidence: 0.75 },
  { pattern: /aerial/i,                           docType: 'map_exhibit',    confidence: 0.8 },
  { pattern: /location[_\s-]*map/i,              docType: 'map_exhibit',    confidence: 0.9 },

  // Photos
  { pattern: /photo/i,                            docType: 'photo_batch',    confidence: 0.9 },
  { pattern: /image/i,                            docType: 'photo_batch',    confidence: 0.7 },
  { pattern: /addendum/i,                         docType: 'photo_batch',    confidence: 0.5 },

  // Guidelines
  { pattern: /guideline/i,                        docType: 'guideline',      confidence: 0.9 },
  { pattern: /handbook/i,                          docType: 'guideline',     confidence: 0.85 },
  { pattern: /manual/i,                            docType: 'guideline',    confidence: 0.8 },
  { pattern: /fha[_\s-]*(guide|handbook)/i,        docType: 'guideline',    confidence: 0.95 },
  { pattern: /va[_\s-]*(guide|handbook)/i,         docType: 'guideline',    confidence: 0.95 },
  { pattern: /usda[_\s-]*(guide|handbook)/i,       docType: 'guideline',    confidence: 0.95 },
];

// ── Text keyword rules (checked when filename is inconclusive) ───────────────
// Each rule: { keywords: string[], docType: string, minMatches: number, confidence: number }

const TEXT_RULES = [
  // Order sheet signals
  {
    keywords: ['order number', 'order date', 'appraisal order', 'amc', 'due date', 'product type', 'loan number'],
    docType: 'order_sheet', minMatches: 3, confidence: 0.85,
  },
  // Engagement letter signals
  {
    keywords: ['engagement letter', 'scope of work', 'intended use', 'intended user', 'competency', 'extraordinary assumption'],
    docType: 'engagement_letter', minMatches: 3, confidence: 0.85,
  },
  // Contract signals
  {
    keywords: ['purchase price', 'contract price', 'buyer', 'seller', 'earnest money', 'closing date', 'contingent', 'financing'],
    docType: 'contract', minMatches: 3, confidence: 0.85,
  },
  // MLS signals
  {
    keywords: ['mls#', 'mls number', 'list price', 'list date', 'days on market', 'dom', 'cdom', 'listing agent', 'listing office'],
    docType: 'mls_sheet', minMatches: 3, confidence: 0.85,
  },
  // Assessor signals
  {
    keywords: ['parcel', 'assessed value', 'tax year', 'property class', 'legal description', 'township', 'exemption'],
    docType: 'assessor_record', minMatches: 3, confidence: 0.8,
  },
  // Zoning signals
  {
    keywords: ['zoning district', 'zoning classification', 'permitted use', 'setback', 'lot coverage', 'height restriction', 'variance'],
    docType: 'zoning_document', minMatches: 2, confidence: 0.8,
  },
  // Flood signals
  {
    keywords: ['flood zone', 'firm panel', 'fema', 'flood insurance', 'base flood elevation', 'community number', 'map number'],
    docType: 'flood_document', minMatches: 2, confidence: 0.85,
  },
  // Prior appraisal signals
  {
    keywords: ['uniform residential appraisal report', 'appraiser certification', 'opinion of market value',
               'reconciliation', 'sales comparison approach', 'cost approach', 'subject section',
               'neighborhood description', 'highest and best use'],
    docType: 'prior_appraisal', minMatches: 3, confidence: 0.8,
  },
  // Comp sheet signals
  {
    keywords: ['comparable sale', 'sale price', 'sale date', 'adjustment', 'indicated value', 'net adjustment', 'gross adjustment'],
    docType: 'comp_sheet', minMatches: 3, confidence: 0.75,
  },
];

// ── Legacy docType → new doc_type mapping ────────────────────────────────────
// Maps the old form-defined docTypes to the new Phase 5 doc_types.

const LEGACY_DOCTYPE_MAP = {
  purchase_contract: 'contract',
  public_record:     'assessor_record',
  appraisal_order:   'order_sheet',
  mls_sheet:         'mls_sheet',
  plat_map:          'map_exhibit',
  fema_flood:        'flood_document',
  comp_1:            'comp_sheet',
  comp_2:            'comp_sheet',
  comp_3:            'comp_sheet',
  comp_4:            'comp_sheet',
  comp_5:            'comp_sheet',
  comp_6:            'comp_sheet',
  prior_appraisal:   'prior_appraisal',
  tax_record:        'assessor_record',
  photos:            'photo_batch',
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a document using deterministic rules.
 *
 * @param {string} filename — original filename
 * @param {string} [extractedText=''] — extracted text (first ~5000 chars is enough)
 * @param {string} [legacyDocType] — legacy docType from form config (e.g. 'purchase_contract')
 * @returns {{ docType: string, confidence: number, method: string, label: string }}
 */
export function classifyDocument(filename, extractedText = '', legacyDocType = null) {
  // 1. If a legacy docType was specified by the user, map it
  if (legacyDocType && LEGACY_DOCTYPE_MAP[legacyDocType]) {
    return {
      docType:    LEGACY_DOCTYPE_MAP[legacyDocType],
      confidence: 1.0,
      method:     'manual',
      label:      DOC_TYPE_LABELS[LEGACY_DOCTYPE_MAP[legacyDocType]] || legacyDocType,
    };
  }

  // If legacy docType is a valid Phase 5 type, use it directly
  if (legacyDocType && DOC_TYPES.includes(legacyDocType)) {
    return {
      docType:    legacyDocType,
      confidence: 1.0,
      method:     'manual',
      label:      DOC_TYPE_LABELS[legacyDocType] || legacyDocType,
    };
  }

  // 2. Try filename rules
  const fnResult = classifyByFilename(filename);
  if (fnResult && fnResult.confidence >= 0.7) {
    return {
      ...fnResult,
      method: 'filename',
      label:  DOC_TYPE_LABELS[fnResult.docType] || fnResult.docType,
    };
  }

  // 3. Try text keyword rules
  if (extractedText && extractedText.length > 50) {
    const textResult = classifyByText(extractedText);
    if (textResult && textResult.confidence >= 0.7) {
      return {
        ...textResult,
        method: 'keyword',
        label:  DOC_TYPE_LABELS[textResult.docType] || textResult.docType,
      };
    }

    // 4. Combine weak filename + weak text signals
    if (fnResult && textResult && fnResult.docType === textResult.docType) {
      const combined = Math.min(1.0, fnResult.confidence + textResult.confidence * 0.5);
      if (combined >= 0.7) {
        return {
          docType:    fnResult.docType,
          confidence: combined,
          method:     'combined',
          label:      DOC_TYPE_LABELS[fnResult.docType] || fnResult.docType,
        };
      }
    }
  }

  // 5. Use best guess from filename even if below threshold
  if (fnResult) {
    return {
      ...fnResult,
      method: 'filename',
      label:  DOC_TYPE_LABELS[fnResult.docType] || fnResult.docType,
    };
  }

  return {
    docType:    'unknown',
    confidence: 0.0,
    method:     'none',
    label:      DOC_TYPE_LABELS.unknown,
  };
}

/**
 * Map a legacy docType to Phase 5 doc_type.
 * @param {string} legacyDocType
 * @returns {string}
 */
export function mapLegacyDocType(legacyDocType) {
  return LEGACY_DOCTYPE_MAP[legacyDocType] || legacyDocType || 'unknown';
}

// ── Internal classifiers ─────────────────────────────────────────────────────

function classifyByFilename(filename) {
  if (!filename) return null;
  const name = String(filename).toLowerCase();

  let best = null;
  for (const rule of FILENAME_RULES) {
    if (rule.pattern.test(name)) {
      if (!best || rule.confidence > best.confidence) {
        best = { docType: rule.docType, confidence: rule.confidence };
      }
    }
  }
  return best;
}

function classifyByText(text) {
  if (!text) return null;
  const lower = text.slice(0, 5000).toLowerCase();

  let best = null;
  for (const rule of TEXT_RULES) {
    const matches = rule.keywords.filter(kw => lower.includes(kw)).length;
    if (matches >= rule.minMatches) {
      const adjustedConfidence = rule.confidence * Math.min(1.0, matches / rule.keywords.length + 0.3);
      if (!best || adjustedConfidence > best.confidence) {
        best = { docType: rule.docType, confidence: Math.min(1.0, adjustedConfidence) };
      }
    }
  }
  return best;
}
