/**
 * server/factIntegrity/factConflictEngine.js
 * -------------------------------------------
 * Phase C: deterministic fact conflict detection before drafting.
 *
 * Detects conflicting values across:
 *  1) Canonical case facts (current source of truth)
 *  2) Extracted fact candidates from staged document extraction
 *
 * The engine is intentionally deterministic and explainable.
 */

import { getDb } from '../db/database.js';
import { getCaseProjection } from '../caseRecord/caseRecordService.js';

const CONFIDENCE_RANK = {
  high: 3,
  medium: 2,
  low: 1,
};

const CRITICAL_FACT_PATHS = new Set([
  'subject.address',
  'subject.parcelId',
  'subject.parcelNumber',
  'subject.gla',
  'subject.siteSize',
  'subject.lotSize',
  'contract.contractPrice',
  'contract.salePrice',
  'contract.contractDate',
  'site.zoning',
]);

const NUMERIC_PATH_HINTS = /(price|value|gla|size|lot|dom|bed|bath|year|rate|income|expense|noi|count|area|sf)/i;
const DATE_PATH_HINTS = /(date|effectiveDate|saleDate|closingDate|contractDate|dueDate)/i;
const ADDRESS_PATH_HINTS = /(address)/i;

function confidenceRank(value) {
  return CONFIDENCE_RANK[String(value || '').toLowerCase()] || 0;
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeDate(value) {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  const ts = Date.parse(text);
  if (!Number.isNaN(ts)) return new Date(ts).toISOString().slice(0, 10);
  return text.toLowerCase();
}

function normalizeNumeric(value) {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  const raw = text.replace(/[^0-9.\-]/g, '');
  if (!raw) return text.toLowerCase();
  const num = Number(raw);
  if (Number.isNaN(num)) return text.toLowerCase();
  return String(num);
}

function normalizeAddress(value) {
  return normalizeWhitespace(value).toLowerCase().replace(/[.,#]/g, '');
}

function normalizeValueForPath(factPath, value) {
  const text = normalizeWhitespace(value);
  if (!text) return '';

  if (DATE_PATH_HINTS.test(factPath)) return normalizeDate(text);
  if (NUMERIC_PATH_HINTS.test(factPath)) return normalizeNumeric(text);
  if (ADDRESS_PATH_HINTS.test(factPath)) return normalizeAddress(text);

  return text.toLowerCase();
}

function flattenFacts(node, prefix = '', out = {}) {
  if (node === null || node === undefined) return out;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const nextPath = prefix ? `${prefix}.${i}` : String(i);
      flattenFacts(node[i], nextPath, out);
    }
    return out;
  }

  if (typeof node !== 'object') {
    if (prefix) out[prefix] = node;
    return out;
  }

  // Standard fact object shape: { value, confidence, source, ... }.
  if (Object.prototype.hasOwnProperty.call(node, 'value')) {
    if (prefix) out[prefix] = node.value;
    return out;
  }

  for (const [key, value] of Object.entries(node)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    flattenFacts(value, nextPath, out);
  }
  return out;
}

function readCanonicalFactCandidates(facts = {}) {
  const flatFacts = flattenFacts(facts);
  const byPath = new Map();

  for (const [factPath, value] of Object.entries(flatFacts)) {
    const textValue = normalizeWhitespace(value);
    if (!textValue) continue;
    byPath.set(factPath, [{
      sourceType: 'canonical',
      sourceId: 'case-record',
      docType: 'canonical',
      filename: 'facts.json',
      confidence: 'high',
      reviewStatus: 'merged',
      value: textValue,
      sourceText: '',
    }]);
  }

  return byPath;
}

function readExtractedFactCandidates(caseId) {
  const rows = getDb().prepare(`
    SELECT
      ef.id AS fact_id,
      ef.fact_path,
      ef.fact_value,
      ef.confidence,
      ef.review_status,
      ef.document_id,
      ef.source_text,
      cd.doc_type,
      cd.original_filename
    FROM extracted_facts ef
    LEFT JOIN case_documents cd ON cd.id = ef.document_id
    WHERE ef.case_id = ?
      AND ef.review_status IN ('pending', 'accepted', 'merged')
    ORDER BY ef.created_at DESC
  `).all(caseId);

  const byPath = new Map();
  for (const row of rows) {
    const factPath = String(row.fact_path || '').trim();
    const value = normalizeWhitespace(row.fact_value);
    if (!factPath || !value) continue;

    if (!byPath.has(factPath)) byPath.set(factPath, []);
    byPath.get(factPath).push({
      factId: row.fact_id || null,
      sourceType: 'extracted',
      sourceId: row.document_id || null,
      docType: row.doc_type || null,
      filename: row.original_filename || null,
      confidence: String(row.confidence || 'low').toLowerCase(),
      reviewStatus: row.review_status || 'pending',
      value,
      sourceText: row.source_text || '',
    });
  }

  return byPath;
}

function mergeCandidates(canonicalMap, extractedMap) {
  const merged = new Map();
  const keys = new Set([...canonicalMap.keys(), ...extractedMap.keys()]);

  for (const key of keys) {
    const fromCanonical = canonicalMap.get(key) || [];
    const fromExtracted = extractedMap.get(key) || [];
    merged.set(key, [...fromCanonical, ...fromExtracted]);
  }

  return merged;
}

function summarizeValueBuckets(factPath, candidates) {
  const buckets = new Map();

  for (const candidate of candidates) {
    const normalizedValue = normalizeValueForPath(factPath, candidate.value);
    if (!normalizedValue) continue;

    if (!buckets.has(normalizedValue)) {
      buckets.set(normalizedValue, {
        normalizedValue,
        displayValue: candidate.value,
        maxConfidenceRank: confidenceRank(candidate.confidence),
        sources: [],
      });
    }

    const bucket = buckets.get(normalizedValue);
    bucket.maxConfidenceRank = Math.max(bucket.maxConfidenceRank, confidenceRank(candidate.confidence));
    bucket.sources.push({
      factId: candidate.factId || null,
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      docType: candidate.docType,
      filename: candidate.filename,
      confidence: candidate.confidence,
      reviewStatus: candidate.reviewStatus,
      sourceText: candidate.sourceText ? candidate.sourceText.slice(0, 300) : '',
      value: candidate.value,
    });
  }

  return [...buckets.values()].map(bucket => ({
    normalizedValue: bucket.normalizedValue,
    displayValue: bucket.displayValue,
    maxConfidence: bucket.maxConfidenceRank >= 3 ? 'high' : (bucket.maxConfidenceRank >= 2 ? 'medium' : 'low'),
    sourceCount: bucket.sources.length,
    sources: bucket.sources,
  }));
}

function severityForConflict(factPath, valueBuckets) {
  const maxRank = valueBuckets.reduce((max, bucket) => {
    const rank = confidenceRank(bucket.maxConfidence);
    return Math.max(max, rank);
  }, 0);

  if (CRITICAL_FACT_PATHS.has(factPath) && maxRank >= 2) return 'blocker';
  if (maxRank >= 2) return 'high';
  return 'medium';
}

const SEVERITY_ORDER = { blocker: 3, high: 2, medium: 1 };

/**
 * Detect fact conflicts for a case.
 *
 * @param {string} caseId
 * @returns {null|object}
 */
export function detectFactConflicts(caseId) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;

  const canonicalMap = readCanonicalFactCandidates(projection.facts || {});
  const extractedMap = readExtractedFactCandidates(caseId);
  const allCandidates = mergeCandidates(canonicalMap, extractedMap);

  const conflicts = [];

  for (const [factPath, candidates] of allCandidates.entries()) {
    if (!candidates.length) continue;

    const valueBuckets = summarizeValueBuckets(factPath, candidates);
    if (valueBuckets.length <= 1) continue;

    const severity = severityForConflict(factPath, valueBuckets);
    conflicts.push({
      factPath,
      severity,
      valueCount: valueBuckets.length,
      candidateCount: candidates.length,
      values: valueBuckets,
      hasCanonicalValue: candidates.some(c => c.sourceType === 'canonical'),
      hasPendingReview: candidates.some(c => c.reviewStatus === 'pending'),
    });
  }

  conflicts.sort((a, b) => {
    const sevDelta = (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0);
    if (sevDelta !== 0) return sevDelta;
    return a.factPath.localeCompare(b.factPath);
  });

  const blockerCount = conflicts.filter(c => c.severity === 'blocker').length;
  const highCount = conflicts.filter(c => c.severity === 'high').length;
  const mediumCount = conflicts.filter(c => c.severity === 'medium').length;

  return {
    caseId,
    checkedAt: new Date().toISOString(),
    summary: {
      totalConflicts: conflicts.length,
      blockerCount,
      highCount,
      mediumCount,
    },
    conflicts,
  };
}

