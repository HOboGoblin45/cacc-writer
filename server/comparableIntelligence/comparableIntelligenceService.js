/**
 * server/comparableIntelligence/comparableIntelligenceService.js
 * --------------------------------------------------------------
 * Initial Comparable Intelligence Engine slice:
 * - normalize candidate comps from extracted facts + case facts
 * - persist canonical candidate records
 * - compute transparent subject-to-comp similarity scoring
 * - expose ranked recommendation tiers + grid preview payloads
 */

import {
  getComparableCandidate,
  listComparableCandidates,
  listComparableScores,
  listComparableTierAssignments,
  listComparableAcceptanceEvents,
  listAdjustmentSupportRecords,
  replaceAdjustmentSupportRecords,
  updateAdjustmentSupportDecision,
  replaceAdjustmentRecommendations,
  replaceCompBurdenMetrics,
  upsertPairedSalesLibraryRecord,
  listPairedSalesLibraryRecords,
  markComparableCandidatesInactive,
  recordComparableAcceptanceEvent,
  recordComparableRejectionEvent,
  replaceComparableScores,
  summarizeComparableHistory,
  updateComparableCandidateReviewStatus,
  upsertComparableCandidate,
} from '../db/repositories/comparableIntelligenceRepo.js';
import { getCaseProjection, saveCaseProjection } from '../caseRecord/caseRecordService.js';
import { getExtractedFacts } from '../ingestion/stagingService.js';
import { getNestedValue, setNestedValue } from '../workspace/workspaceService.js';

const DEFAULT_SCORE_WEIGHTS = {
  geographicProximity: 0.12,
  marketAreaSimilarity: 0.08,
  recencyOfSale: 0.1,
  propertyTypeSimilarity: 0.06,
  designStyleSimilarity: 0.08,
  qualitySimilarity: 0.06,
  conditionSimilarity: 0.08,
  ageSimilarity: 0.07,
  glaSimilarity: 0.1,
  siteSizeSimilarity: 0.07,
  roomCountSimilarity: 0.04,
  bedroomBathSimilarity: 0.06,
  basementUtilitySimilarity: 0.03,
  garageSimilarity: 0.03,
  zoningUseSimilarity: 0.05,
  externalInfluenceSimilarity: 0.02,
  dataConfidence: 0.05,
};

const TIER_THRESHOLDS = [
  { tier: 'tier_1', minScore: 0.82, label: 'Tier 1' },
  { tier: 'tier_2', minScore: 0.68, label: 'Tier 2' },
  { tier: 'tier_3', minScore: 0.52, label: 'Tier 3' },
  { tier: 'tier_4', minScore: 0, label: 'Tier 4' },
];

const REJECTION_REASON_LABELS = {
  too_distant: 'Too distant',
  inferior_data_quality: 'Inferior data quality',
  poor_condition_match: 'Poor condition match',
  poor_design_style_match: 'Poor design/style match',
  poor_market_area_match: 'Poor market area match',
  poor_date_relevance: 'Poor date relevance',
  atypical_sale: 'Atypical sale',
  unsupported_verification: 'Unsupported verification',
  other: 'Other',
};

const ADJUSTMENT_CATEGORY_CONFIG = [
  { category: 'sale_financing_concessions', label: 'Sale / Financing Concessions', rowFeature: 'Sale or Financing Concessions', factor: 'dataConfidence', type: 'text' },
  { category: 'market_conditions_time', label: 'Market Conditions / Time', rowFeature: 'Date of Sale / Time', factor: 'recencyOfSale', type: 'date', monthlyRate: 0.003 },
  { category: 'location', label: 'Location', rowFeature: 'Location', factor: 'geographicProximity', type: 'text' },
  { category: 'leasehold_fee_simple', label: 'Leasehold / Fee Simple', rowFeature: 'Leasehold / Fee Simple', factor: 'propertyTypeSimilarity', type: 'text' },
  { category: 'site_size', label: 'Site Size', rowFeature: 'Site', factor: 'siteSizeSimilarity', type: 'numeric', subjectKey: 'siteSize', candidateKey: 'siteSize', rate: 1.5 },
  { category: 'view', label: 'View', rowFeature: 'View', factor: 'externalInfluenceSimilarity', type: 'text' },
  { category: 'design_style', label: 'Design / Style', rowFeature: 'Design (Style)', factor: 'designStyleSimilarity', type: 'text', subjectKey: 'style', candidateKey: 'designStyle' },
  { category: 'quality', label: 'Quality', rowFeature: 'Quality of Construction', factor: 'qualitySimilarity', type: 'text' },
  { category: 'age', label: 'Age', rowFeature: 'Actual Age', factor: 'ageSimilarity', type: 'numeric', subjectKey: 'yearBuilt', candidateKey: 'yearBuilt', rate: 500 },
  { category: 'condition', label: 'Condition', rowFeature: 'Condition', factor: 'conditionSimilarity', type: 'condition' },
  { category: 'bedrooms_bathrooms', label: 'Bedrooms / Bathrooms', rowFeature: 'Above Grade Beds / Baths', factor: 'bedroomBathSimilarity', type: 'bedbath', bedRate: 2500, bathRate: 3500 },
  { category: 'room_count', label: 'Room Count', rowFeature: 'Room Count', factor: 'roomCountSimilarity', type: 'numeric', subjectKey: 'roomCount', candidateKey: 'roomCount', rate: 1500 },
  { category: 'gla', label: 'Gross Living Area', rowFeature: 'Gross Living Area', factor: 'glaSimilarity', type: 'numeric', subjectKey: 'gla', candidateKey: 'gla', rate: 45 },
  { category: 'basement_finished_below_grade', label: 'Basement / Finished Below Grade', rowFeature: 'Basement / Finished Rooms Below Grade', factor: 'basementUtilitySimilarity', type: 'basement', rate: 20 },
  { category: 'functional_utility', label: 'Functional Utility', rowFeature: 'Functional Utility', factor: 'roomCountSimilarity', type: 'text' },
  { category: 'hvac', label: 'HVAC / Heating / Cooling', rowFeature: 'Heating / Cooling', factor: 'garageSimilarity', type: 'text' },
  { category: 'energy_efficient_items', label: 'Energy Efficient Items', rowFeature: 'Energy Efficient Items', factor: 'dataConfidence', type: 'text' },
  { category: 'garage_carport', label: 'Garage / Carport', rowFeature: 'Garage / Carport', factor: 'garageSimilarity', type: 'garage', rate: 7500 },
  { category: 'porch_patio_deck', label: 'Porch / Patio / Deck', rowFeature: 'Porch / Patio / Deck', factor: 'dataConfidence', type: 'text' },
];

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function asText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeText(value) {
  return asText(value).toLowerCase().replace(/\s+/g, ' ');
}

function asNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value).replace(/[^0-9.\-]/g, '');
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function asDate(value) {
  const text = asText(value);
  if (!text) return null;
  const ts = Date.parse(text);
  if (Number.isNaN(ts)) return null;
  return new Date(ts);
}

function confidenceScore(value) {
  const normalized = normalizeText(value);
  if (normalized === 'high') return 1;
  if (normalized === 'medium') return 0.7;
  if (normalized === 'low') return 0.4;
  return 0.5;
}

function safeLeafValue(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  if (!Object.prototype.hasOwnProperty.call(node, 'value')) return null;
  return node.value;
}

function buildSubjectSnapshot(projection) {
  const facts = projection?.facts || {};
  const meta = projection?.meta || {};
  return {
    address: safeLeafValue(facts.subject?.address),
    city: safeLeafValue(facts.subject?.city) || meta.city || '',
    county: safeLeafValue(facts.subject?.county) || meta.county || '',
    state: safeLeafValue(facts.subject?.state) || meta.state || '',
    zip: safeLeafValue(facts.subject?.zip) || '',
    marketArea: meta.marketArea || safeLeafValue(facts.subject?.neighborhoodName) || '',
    propertyType: meta.propertyType || '',
    style: safeLeafValue(facts.subject?.style) || '',
    quality: safeLeafValue(facts.subject?.quality) || '',
    condition: safeLeafValue(facts.subject?.condition) || '',
    yearBuilt: asNumber(safeLeafValue(facts.subject?.yearBuilt)),
    gla: asNumber(safeLeafValue(facts.subject?.gla)),
    siteSize: asNumber(safeLeafValue(facts.subject?.siteSize) || safeLeafValue(facts.subject?.lotSize)),
    roomCount: asNumber(safeLeafValue(facts.improvements?.roomCount)),
    bedrooms: asNumber(safeLeafValue(facts.subject?.beds)),
    bathrooms: asNumber(safeLeafValue(facts.subject?.baths)),
    basement: safeLeafValue(facts.subject?.basement) || '',
    garage: safeLeafValue(facts.subject?.garage) || '',
    zoning: safeLeafValue(facts.subject?.zoning) || safeLeafValue(facts.site?.zoningClassification) || '',
    view: safeLeafValue(facts.site?.view) || '',
    effectiveDate: safeLeafValue(facts.assignment?.effectiveDate) || meta.effectiveDate || null,
  };
}

function buildExtractedCompCandidates(extractedFacts = []) {
  const groups = new Map();

  for (const fact of extractedFacts) {
    const docType = normalizeText(fact.doc_type || '');
    if (!['comp_1', 'comp_2', 'comp_3', 'comp_sheet'].includes(docType)) continue;
    const factPath = asText(fact.fact_path || fact.factPath);
    if (!factPath.startsWith('comp.')) continue;

    const groupKey = asText(fact.document_id || fact.documentId || fact.doc_type || fact.original_filename);
    if (!groupKey) continue;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        sourceKey: `doc:${groupKey}`,
        sourceType: 'extracted_document',
        sourceDocumentId: fact.document_id || fact.documentId || null,
        sourceDocType: fact.doc_type || fact.docType || null,
        sourceFilename: fact.original_filename || fact.filename || null,
        reviewStatus: 'pending',
        values: {},
        confidences: {},
        evidence: {},
      });
    }

    const group = groups.get(groupKey);
    const fieldName = factPath.slice('comp.'.length);
    group.values[fieldName] = fact.fact_value ?? fact.value ?? null;
    group.confidences[fieldName] = fact.confidence || 'medium';
    group.evidence[fieldName] = {
      sourceText: fact.source_text || fact.sourceText || '',
      factId: fact.id || fact.factId || null,
    };
  }

  return [...groups.values()].map((group, index) => normalizeCompCandidate({
    sourceKey: group.sourceKey,
    sourceType: group.sourceType,
    sourceDocumentId: group.sourceDocumentId,
    sourceDocType: group.sourceDocType,
    sourceFilename: group.sourceFilename,
    reviewStatus: group.reviewStatus,
    rawValues: group.values,
    rawConfidences: group.confidences,
    evidence: group.evidence,
    ordinalHint: index + 1,
  }));
}

function buildManualCompCandidates(projection) {
  const comps = Array.isArray(projection?.facts?.comps) ? projection.facts.comps : [];
  return comps
    .map((comp, index) => {
      const address = safeLeafValue(comp?.address);
      const salePrice = safeLeafValue(comp?.salePrice);
      const saleDate = safeLeafValue(comp?.saleDate);
      const gla = safeLeafValue(comp?.gla);
      const daysOnMarket = safeLeafValue(comp?.dom);
      const adjustments = safeLeafValue(comp?.adjustments);

      if (!address && !salePrice && !saleDate && !gla) return null;

      return normalizeCompCandidate({
        sourceKey: `manual:comp_${index + 1}`,
        sourceType: 'manual_comp',
        sourceDocumentId: null,
        sourceDocType: 'manual_comp',
        sourceFilename: `Comp ${index + 1}`,
        reviewStatus: 'accepted',
        rawValues: {
          address,
          salePrice,
          saleDate,
          gla,
          daysOnMarket,
          adjustments,
        },
        rawConfidences: {
          address: comp?.address?.confidence || 'medium',
          salePrice: comp?.salePrice?.confidence || 'medium',
          saleDate: comp?.saleDate?.confidence || 'medium',
          gla: comp?.gla?.confidence || 'medium',
        },
        evidence: {},
        ordinalHint: index + 1,
      });
    })
    .filter(Boolean);
}

function normalizeCompCandidate({
  sourceKey,
  sourceType,
  sourceDocumentId,
  sourceDocType,
  sourceFilename,
  reviewStatus,
  rawValues = {},
  rawConfidences = {},
  evidence = {},
  ordinalHint = null,
}) {
  const bedrooms = asNumber(rawValues.bedrooms);
  const bathrooms = asNumber(rawValues.bathrooms);
  const confidenceValues = Object.values(rawConfidences).filter(Boolean);
  const avgConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + confidenceScore(value), 0) / confidenceValues.length
    : 0.5;

  return {
    sourceKey,
    sourceType,
    sourceDocumentId,
    reviewStatus,
    address: asText(rawValues.address) || null,
    city: asText(rawValues.city) || null,
    county: asText(rawValues.county) || null,
    state: asText(rawValues.state) || null,
    zip: asText(rawValues.zip) || null,
    saleDate: asText(rawValues.saleDate) || null,
    salePrice: asNumber(rawValues.salePrice),
    dataSource: sourceDocType || sourceType,
    verificationSource: sourceFilename || sourceDocType || sourceType,
    propertyType: asText(rawValues.propertyType) || null,
    designStyle: asText(rawValues.style) || null,
    quality: asText(rawValues.quality) || null,
    condition: asText(rawValues.condition) || null,
    actualAge: asNumber(rawValues.actualAge),
    yearBuilt: asNumber(rawValues.yearBuilt),
    effectiveAge: asNumber(rawValues.effectiveAge),
    gla: asNumber(rawValues.gla),
    basementArea: asNumber(rawValues.basementArea),
    basement: asText(rawValues.basement) || null,
    roomCount: asNumber(rawValues.roomCount),
    bedroomCount: bedrooms,
    bathCount: bathrooms,
    garageCarport: asText(rawValues.garage) || null,
    siteSize: asNumber(rawValues.siteSize || rawValues.lotSize),
    zoning: asText(rawValues.zoning) || null,
    locationNotes: asText(rawValues.locationNotes) || null,
    viewInfluences: asText(rawValues.view) || null,
    concessions: asText(rawValues.concessions) || null,
    priorSaleHistory: asText(rawValues.priorSaleHistory) || null,
    listingHistory: asText(rawValues.listingHistory) || null,
    daysOnMarket: asNumber(rawValues.daysOnMarket || rawValues.dom),
    sourceConfidence: avgConfidence,
    sourceConfidenceLabel: avgConfidence >= 0.85 ? 'high' : avgConfidence >= 0.6 ? 'medium' : 'low',
    extractedEvidence: cloneValue(evidence),
    adjustments: asText(rawValues.adjustments) || null,
    ordinalHint,
  };
}

function compareExactOrSimilar(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return null;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.82;
  const aParts = new Set(a.split(/\s+/));
  const bParts = b.split(/\s+/);
  const overlap = bParts.filter((part) => aParts.has(part)).length;
  return overlap ? Math.min(0.75, overlap / Math.max(aParts.size, bParts.length)) : 0.25;
}

function compareNumericSimilarity(left, right, tolerance = 1) {
  const a = asNumber(left);
  const b = asNumber(right);
  if (a == null || b == null) return null;
  if (a === b) return 1;
  const max = Math.max(Math.abs(a), Math.abs(b), tolerance);
  const diff = Math.abs(a - b) / max;
  return Math.max(0, 1 - diff);
}

function computeRecencySimilarity(subjectDateValue, saleDateValue) {
  const saleDate = asDate(saleDateValue);
  const subjectDate = asDate(subjectDateValue) || new Date();
  if (!saleDate) return null;
  const months = Math.abs((subjectDate.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
  if (months <= 6) return 1;
  if (months <= 12) return 0.92;
  if (months <= 18) return 0.82;
  if (months <= 24) return 0.72;
  if (months <= 36) return 0.55;
  return 0.35;
}

function computeGeographicSimilarity(subject, candidate) {
  const exact = compareExactOrSimilar(subject.address, candidate.address);
  if (exact === 1) return 0.2;
  const city = compareExactOrSimilar(subject.city, candidate.city);
  const county = compareExactOrSimilar(subject.county, candidate.county);
  const state = compareExactOrSimilar(subject.state, candidate.state);
  if (city) return 0.75 + (city * 0.2);
  if (county) return 0.55 + (county * 0.2);
  if (state) return 0.35 + (state * 0.15);
  return null;
}

function computeMarketAreaSimilarity(subject, candidate) {
  const marketArea = compareExactOrSimilar(subject.marketArea, candidate.locationNotes || candidate.city || candidate.county);
  const city = compareExactOrSimilar(subject.city, candidate.city);
  return marketArea ?? city;
}

function computeAgeSimilarity(subject, candidate) {
  if (subject.yearBuilt != null && candidate.yearBuilt != null) {
    return compareNumericSimilarity(subject.yearBuilt, candidate.yearBuilt, 5);
  }
  return compareNumericSimilarity(subject.yearBuilt, candidate.actualAge, 5);
}

function computeBedroomBathSimilarity(subject, candidate) {
  const bedScore = compareNumericSimilarity(subject.bedrooms, candidate.bedroomCount, 1);
  const bathScore = compareNumericSimilarity(subject.bathrooms, candidate.bathCount, 1);
  const scores = [bedScore, bathScore].filter((value) => value != null);
  if (!scores.length) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function computeCompositeSimilarity(subject, candidate, weights) {
  const breakdown = {
    geographicProximity: computeGeographicSimilarity(subject, candidate),
    marketAreaSimilarity: computeMarketAreaSimilarity(subject, candidate),
    recencyOfSale: computeRecencySimilarity(subject.effectiveDate, candidate.saleDate),
    propertyTypeSimilarity: compareExactOrSimilar(subject.propertyType, candidate.propertyType),
    designStyleSimilarity: compareExactOrSimilar(subject.style, candidate.designStyle),
    qualitySimilarity: compareExactOrSimilar(subject.quality, candidate.quality),
    conditionSimilarity: compareExactOrSimilar(subject.condition, candidate.condition),
    ageSimilarity: computeAgeSimilarity(subject, candidate),
    glaSimilarity: compareNumericSimilarity(subject.gla, candidate.gla, 100),
    siteSizeSimilarity: compareNumericSimilarity(subject.siteSize, candidate.siteSize, 1000),
    roomCountSimilarity: compareNumericSimilarity(subject.roomCount, candidate.roomCount, 1),
    bedroomBathSimilarity: computeBedroomBathSimilarity(subject, candidate),
    basementUtilitySimilarity: compareExactOrSimilar(subject.basement, candidate.basement),
    garageSimilarity: compareExactOrSimilar(subject.garage, candidate.garageCarport),
    zoningUseSimilarity: compareExactOrSimilar(subject.zoning, candidate.zoning),
    externalInfluenceSimilarity: compareExactOrSimilar(subject.view, candidate.viewInfluences),
    dataConfidence: candidate.sourceConfidence ?? 0.5,
  };

  let weightedScore = 0;
  let availableWeight = 0;
  let totalWeight = 0;
  for (const [factor, weight] of Object.entries(weights)) {
    totalWeight += weight;
    const score = breakdown[factor];
    if (typeof score === 'number' && Number.isFinite(score)) {
      weightedScore += score * weight;
      availableWeight += weight;
    }
  }

  const coverageScore = totalWeight ? (availableWeight / totalWeight) : 0;
  const average = availableWeight ? (weightedScore / availableWeight) : 0;
  const overallScore = average * (0.6 + (coverageScore * 0.4));

  const availableBreakdown = Object.entries(breakdown)
    .filter(([, score]) => typeof score === 'number' && Number.isFinite(score))
    .map(([factor, score]) => ({ factor, score, weight: weights[factor] || 0 }))
    .sort((left, right) => right.score - left.score);

  const missingFactors = Object.entries(breakdown)
    .filter(([, score]) => score == null)
    .map(([factor]) => factor);

  const keyMatches = availableBreakdown
    .filter((entry) => entry.score >= 0.78)
    .slice(0, 4)
    .map((entry) => entry.factor);
  const keyMismatches = availableBreakdown
    .filter((entry) => entry.score <= 0.55)
    .sort((left, right) => left.score - right.score)
    .slice(0, 4)
    .map((entry) => entry.factor);

  const warnings = [];
  if (!candidate.address) warnings.push('Missing candidate address');
  if (!candidate.salePrice) warnings.push('Missing verified sale price');
  if (!candidate.saleDate) warnings.push('Missing sale date');
  if (candidate.sourceConfidence < 0.6) warnings.push('Weak source confidence');
  if (coverageScore < 0.55) warnings.push('Limited comparable detail for ranking');

  return {
    overallScore,
    coverageScore,
    breakdown,
    weights,
    keyMatches,
    keyMismatches,
    missingFactors,
    warnings,
  };
}

function tierForScore(score) {
  return TIER_THRESHOLDS.find((entry) => score >= entry.minScore) || TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1];
}

export function buildComparableGridPreview(candidate = {}) {
  const bedsBaths = [
    candidate.bedroomCount != null ? candidate.bedroomCount : null,
    candidate.bathCount != null ? candidate.bathCount : null,
  ].filter((value) => value != null);

  return {
    Address: candidate.address || '',
    'Sale Price': candidate.salePrice != null ? `$${Math.round(candidate.salePrice).toLocaleString()}` : '',
    'Date of Sale / Time': candidate.saleDate || '',
    'Data Source(s)': candidate.dataSource || '',
    'Verification Source(s)': candidate.verificationSource || '',
    'Sale or Financing Concessions': candidate.concessions || '',
    Location: candidate.city || candidate.locationNotes || '',
    Site: candidate.siteSize != null ? String(candidate.siteSize) : '',
    View: candidate.viewInfluences || '',
    'Design (Style)': candidate.designStyle || '',
    'Quality of Construction': candidate.quality || '',
    'Actual Age': candidate.actualAge != null ? String(candidate.actualAge) : (candidate.yearBuilt != null ? String(candidate.yearBuilt) : ''),
    Condition: candidate.condition || '',
    'Above Grade Beds / Baths': bedsBaths.length ? bedsBaths.join(' / ') : '',
    'Room Count': candidate.roomCount != null ? String(candidate.roomCount) : '',
    'Gross Living Area': candidate.gla != null ? String(candidate.gla) : '',
    'Basement / Finished Rooms Below Grade': candidate.basement || (candidate.basementArea != null ? String(candidate.basementArea) : ''),
    'Garage / Carport': candidate.garageCarport || '',
  };
}

function cleanObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry != null && entry !== '' && !(typeof entry === 'number' && Number.isNaN(entry)))
  );
}

function normalizeAddressKey(value) {
  return normalizeText(value)
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bdrive\b/g, 'dr');
}

function valuesDiffer(left, right) {
  const aNum = asNumber(left);
  const bNum = asNumber(right);
  if (aNum != null && bNum != null) {
    return Math.abs(aNum - bNum) > 0.01;
  }
  return normalizeText(left) !== normalizeText(right);
}

function scoreStrength(score) {
  if (score >= 0.85) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
}

function rangeForAmount(amount) {
  if (amount == null || !Number.isFinite(amount) || amount === 0) return {};
  return {
    low: Math.round(amount * 0.85),
    high: Math.round(amount * 1.15),
  };
}

function parseBedsBaths(value) {
  const text = asText(value);
  if (!text) return { beds: null, baths: null };
  const matches = text.match(/-?\d+(?:\.\d+)?/g) || [];
  return {
    beds: matches[0] != null ? Number(matches[0]) : null,
    baths: matches[1] != null ? Number(matches[1]) : null,
  };
}

function parseGarageSpaces(value) {
  const text = asText(value);
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function monthsBetween(dateA, dateB) {
  const left = asDate(dateA);
  const right = asDate(dateB);
  if (!left || !right) return null;
  return Math.abs((left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
}

function buildGridRowIndex(rows = []) {
  return new Map(
    rows
      .filter((row) => row && typeof row === 'object' && row.feature)
      .map((row) => [String(row.feature), row])
  );
}

function candidateFieldValue(candidate, key) {
  if (!candidate || !key) return '';
  const value = candidate[key];
  return value == null ? '' : String(value);
}

function subjectFieldValue(subject, key) {
  if (!subject || !key) return '';
  const value = subject[key];
  return value == null ? '' : String(value);
}

function deriveSupportValues(config, rowIndex, gridSlot, subject, candidate) {
  const row = rowIndex.get(config.rowFeature) || null;
  const rowSubject = asText(row?.subject);
  const rowComp = asText(row?.[gridSlot]);

  let subjectValue = rowSubject;
  let compValue = rowComp;

  if (!subjectValue) {
    if (config.type === 'bedbath') {
      subjectValue = [subject.bedrooms, subject.bathrooms].filter((value) => value != null && value !== '').join(' / ');
    } else if (config.type === 'garage') {
      subjectValue = subjectFieldValue(subject, 'garage');
    } else if (config.type === 'basement') {
      subjectValue = subjectFieldValue(subject, 'basement');
    } else {
      subjectValue = subjectFieldValue(subject, config.subjectKey);
    }
  }

  if (!compValue) {
    if (config.type === 'bedbath') {
      compValue = [candidate.bedroomCount, candidate.bathCount].filter((value) => value != null && value !== '').join(' / ');
    } else if (config.type === 'garage') {
      compValue = candidateFieldValue(candidate, 'garageCarport');
    } else if (config.type === 'basement') {
      compValue = candidateFieldValue(candidate, 'basement') || candidateFieldValue(candidate, 'basementArea');
    } else {
      compValue = candidateFieldValue(candidate, config.candidateKey);
    }
  }

  return {
    subjectValue: asText(subjectValue),
    compValue: asText(compValue),
  };
}

function buildAdjustmentRecommendation(config, values, candidateRecord, subject) {
  const subjectValue = values.subjectValue;
  const compValue = values.compValue;
  const factorScore = Number(candidateRecord?.weightedBreakdown?.[config.factor] ?? 0.5);
  const supportStrength = scoreStrength(factorScore);
  const salePrice = asNumber(candidateRecord?.candidate?.salePrice);
  let requiresAdjustment = false;
  let supportType = 'appraiser_judgment_with_explanation';
  let suggestedAmount = null;
  let suggestedRange = {};

  if (config.type === 'numeric') {
    const subjectNumber = asNumber(subjectValue);
    const compNumber = asNumber(compValue);
    if (subjectNumber != null && compNumber != null) {
      const delta = subjectNumber - compNumber;
      requiresAdjustment = delta !== 0;
      supportType = requiresAdjustment ? 'sensitivity_analysis' : 'no_adjustment_warranted';
      if (requiresAdjustment) {
        suggestedAmount = Math.round(delta * (config.rate || 0));
        suggestedRange = rangeForAmount(suggestedAmount);
      }
    }
  } else if (config.type === 'date') {
    const months = monthsBetween(subject.effectiveDate, compValue);
    requiresAdjustment = months != null && months > 0.25;
    supportType = requiresAdjustment ? 'sensitivity_analysis' : 'no_adjustment_warranted';
    if (requiresAdjustment && salePrice != null) {
      suggestedAmount = Math.round((config.monthlyRate || 0) * salePrice * months);
      suggestedRange = rangeForAmount(suggestedAmount);
    }
  } else if (config.type === 'bedbath') {
    const subjectMix = parseBedsBaths(subjectValue);
    const compMix = parseBedsBaths(compValue);
    if (subjectMix.beds != null && compMix.beds != null) {
      const deltaBeds = subjectMix.beds - compMix.beds;
      const deltaBaths = (subjectMix.baths ?? 0) - (compMix.baths ?? 0);
      requiresAdjustment = deltaBeds !== 0 || deltaBaths !== 0;
      supportType = requiresAdjustment ? 'sensitivity_analysis' : 'no_adjustment_warranted';
      if (requiresAdjustment) {
        suggestedAmount = Math.round((deltaBeds * (config.bedRate || 0)) + (deltaBaths * (config.bathRate || 0)));
        suggestedRange = rangeForAmount(suggestedAmount);
      }
    }
  } else if (config.type === 'garage') {
    const subjectSpaces = parseGarageSpaces(subjectValue);
    const compSpaces = parseGarageSpaces(compValue);
    if (subjectSpaces != null && compSpaces != null) {
      const delta = subjectSpaces - compSpaces;
      requiresAdjustment = delta !== 0;
      supportType = requiresAdjustment ? 'sensitivity_analysis' : 'no_adjustment_warranted';
      if (requiresAdjustment) {
        suggestedAmount = Math.round(delta * (config.rate || 0));
        suggestedRange = rangeForAmount(suggestedAmount);
      }
    }
  } else if (config.type === 'basement') {
    const subjectNumber = asNumber(subjectValue);
    const compNumber = asNumber(compValue);
    if (subjectNumber != null && compNumber != null) {
      const delta = subjectNumber - compNumber;
      requiresAdjustment = delta !== 0;
      supportType = requiresAdjustment ? 'sensitivity_analysis' : 'no_adjustment_warranted';
      if (requiresAdjustment) {
        suggestedAmount = Math.round(delta * (config.rate || 0));
        suggestedRange = rangeForAmount(suggestedAmount);
      }
    } else {
      requiresAdjustment = normalizeText(subjectValue) !== normalizeText(compValue) && Boolean(subjectValue || compValue);
      supportType = requiresAdjustment ? 'qualitative_support_only' : 'no_adjustment_warranted';
    }
  } else if (config.type === 'condition') {
    requiresAdjustment = normalizeText(subjectValue) !== normalizeText(compValue) && Boolean(subjectValue || compValue);
    supportType = requiresAdjustment ? 'qualitative_support_only' : 'no_adjustment_warranted';
  } else {
    requiresAdjustment = normalizeText(subjectValue) !== normalizeText(compValue) && Boolean(subjectValue || compValue);
    supportType = requiresAdjustment ? 'qualitative_support_only' : 'no_adjustment_warranted';
  }

  const recommendationText = requiresAdjustment
    ? `${config.label} differs between subject and ${candidateRecord.gridSlotLabel}. Review support before finalizing the comp adjustment.`
    : `${config.label} appears aligned; no adjustment is indicated from current workspace evidence.`;

  return {
    subjectValue,
    compValue,
    supportType,
    supportStrength,
    suggestedAmount,
    suggestedRange,
    requiresAdjustment,
    supportEvidence: [
      cleanObject({
        kind: 'similarity_factor',
        factor: config.factor,
        score: Number(factorScore.toFixed(4)),
      }),
      cleanObject({
        kind: 'candidate_source',
        sourceType: candidateRecord.sourceType,
        verificationSource: candidateRecord.candidate?.verificationSource,
        sourceDocumentId: candidateRecord.sourceDocumentId,
      }),
    ].filter((entry) => Object.keys(entry).length),
    recommendation: {
      category: config.category,
      label: config.label,
      recommendedAction: requiresAdjustment ? 'review_adjustment' : 'no_adjustment_warranted',
      supportStrength,
      supportType,
      suggestedAmount,
      suggestedRange,
      why: recommendationText,
      missingEvidence: [subjectValue, compValue].every((value) => !value) ? ['subject_and_comp_values_missing'] : [],
    },
  };
}

function buildLibraryMatches({
  caseId,
  category,
  marketArea,
  propertyType,
}) {
  const records = listPairedSalesLibraryRecords({
    variableAnalyzed: category,
    marketArea,
    propertyType,
    approvalStatus: 'approved',
    limit: 5,
  });

  return records
    .filter((record) => !Array.isArray(record.linkedAssignments) || !record.linkedAssignments.includes(caseId))
    .slice(0, 3)
    .map((record) => ({
      id: record.id,
      supportMethod: record.supportMethod,
      conclusion: record.conclusion,
      confidence: record.confidence,
      narrativeSummary: record.narrativeSummary,
      sampleSize: record.sampleSize,
      marketArea: record.marketArea,
      propertyType: record.propertyType,
    }));
}

function syncPairedSalesLibraryRecords(caseId, subject, acceptedSlots = []) {
  let approvedRecordCount = 0;

  for (const slot of acceptedSlots) {
    for (const record of slot.adjustmentSupport || []) {
      if (!['accepted', 'modified'].includes(record.decisionStatus)) continue;
      const selectedAmount = selectedAmountForRecord(record);
      const conclusion = selectedAmount
        ? `${record.label || record.adjustmentCategory}: ${selectedAmount > 0 ? '+' : ''}$${Math.abs(selectedAmount).toLocaleString()}`
        : `${record.label || record.adjustmentCategory}: no adjustment warranted`;

      upsertPairedSalesLibraryRecord({
        id: `${caseId}:${slot.gridSlot}:${record.adjustmentCategory}`,
        marketArea: subject.marketArea || '',
        propertyType: subject.propertyType || '',
        dateRangeStart: subject.effectiveDate || null,
        dateRangeEnd: subject.effectiveDate || null,
        variableAnalyzed: record.adjustmentCategory,
        supportMethod: record.supportType || 'appraiser_judgment_with_explanation',
        sampleSize: 1,
        conclusion,
        confidence: record.supportStrength || 'medium',
        narrativeSummary: record.rationaleNote || '',
        linkedAssignments: [caseId],
        linkedCompSets: [slot.candidateId],
        creator: 'appraiser',
        reviewer: 'appraiser',
        approvalStatus: 'approved',
      });
      approvedRecordCount++;
    }
  }

  const allRelevant = ADJUSTMENT_CATEGORY_CONFIG.map((config) => config.category);
  const scoped = allRelevant.flatMap((category) => listPairedSalesLibraryRecords({
    variableAnalyzed: category,
    marketArea: subject.marketArea || '',
    propertyType: subject.propertyType || '',
    approvalStatus: 'approved',
    limit: 50,
  }));
  const uniqueScoped = new Map(scoped.map((record) => [record.id, record]));

  return {
    approvedRecordCount,
    scopedRecordCount: uniqueScoped.size,
  };
}

function buildComparableContradictions({ projection, acceptedSlots = [], rankedCandidates = [] }) {
  const contradictions = [];
  const duplicateGroups = new Map();

  for (const candidate of rankedCandidates) {
    const addressKey = normalizeAddressKey(candidate.candidate?.address);
    if (!addressKey) continue;
    if (!duplicateGroups.has(addressKey)) duplicateGroups.set(addressKey, []);
    duplicateGroups.get(addressKey).push(candidate);
  }

  const duplicateConflicts = new Map();
  for (const [addressKey, group] of duplicateGroups.entries()) {
    if (group.length < 2) continue;
    const first = group[0].candidate || {};
    const hasConflict = group.slice(1).some((candidate) => {
      const current = candidate.candidate || {};
      return valuesDiffer(first.salePrice, current.salePrice)
        || valuesDiffer(first.saleDate, current.saleDate)
        || valuesDiffer(first.gla, current.gla)
        || valuesDiffer(first.condition, current.condition);
    });
    if (hasConflict) duplicateConflicts.set(addressKey, group.map((candidate) => candidate.id));
  }

  const gridRows = getNestedValue(projection.facts || {}, 'workspace1004.salesComparison.grid')?.value || [];
  const rowIndex = buildGridRowIndex(gridRows);

  for (const slot of acceptedSlots) {
    const slotContradictions = [];
    const candidate = rankedCandidates.find((entry) => entry.id === slot.candidateId);
    const candidateData = candidate?.candidate || {};
    const preview = candidate?.gridPreview || {};
    const addressKey = normalizeAddressKey(candidateData.address);

    const rowPairs = [
      { feature: 'Address', code: 'address_mismatch' },
      { feature: 'Sale Price', code: 'sale_price_mismatch' },
      { feature: 'Date of Sale / Time', code: 'sale_date_mismatch' },
      { feature: 'Gross Living Area', code: 'gla_mismatch' },
      { feature: 'Condition', code: 'condition_mismatch' },
    ];

    for (const pair of rowPairs) {
      const rowValue = asText(rowIndex.get(pair.feature)?.[slot.gridSlot]);
      const previewValue = asText(preview[pair.feature]);
      if (rowValue && previewValue && valuesDiffer(rowValue, previewValue)) {
        slotContradictions.push({
          code: pair.code,
          severity: 'high',
          message: `${slot.gridSlotLabel} ${pair.feature} differs from the accepted candidate source.`,
          expectedValue: previewValue,
          actualValue: rowValue,
        });
      }
    }

    if (candidate?.sourceStrength === 'low') {
      slotContradictions.push({
        code: 'weak_verification_source',
        severity: 'medium',
        message: `${slot.gridSlotLabel} relies on weak verification data.`,
      });
    }

    const concessionsGrid = asText(rowIndex.get('Sale or Financing Concessions')?.[slot.gridSlot]);
    if (concessionsGrid && !asText(candidateData.concessions)) {
      slotContradictions.push({
        code: 'unsupported_concessions',
        severity: 'medium',
        message: `${slot.gridSlotLabel} concessions are populated in the grid without matching candidate support.`,
        actualValue: concessionsGrid,
      });
    }

    if ((slot.burdenMetrics?.grossAdjustmentPercent || 0) > 25) {
      slotContradictions.push({
        code: 'outlier_adjustment_burden',
        severity: 'high',
        message: `${slot.gridSlotLabel} gross adjustment burden exceeds 25%.`,
        actualValue: String(slot.burdenMetrics.grossAdjustmentPercent),
      });
    }

    if ((slot.burdenMetrics?.overallStabilityScore || 0) < 0.55) {
      slotContradictions.push({
        code: 'low_stability_score',
        severity: 'medium',
        message: `${slot.gridSlotLabel} stability score is low and may weaken reconciliation weight.`,
        actualValue: String(slot.burdenMetrics.overallStabilityScore),
      });
    }

    if (addressKey && duplicateConflicts.has(addressKey)) {
      slotContradictions.push({
        code: 'duplicate_source_conflict',
        severity: 'high',
        message: `${slot.gridSlotLabel} shares an address with conflicting candidate records.`,
      });
    }

    slot.contradictions = slotContradictions;
    contradictions.push(...slotContradictions.map((entry) => ({
      ...entry,
      gridSlot: slot.gridSlot,
      candidateId: slot.candidateId,
    })));
  }

  return contradictions;
}

function latestAcceptanceEventByGridSlot(caseId) {
  const latest = new Map();
  for (const event of listComparableAcceptanceEvents(caseId)) {
    if (!event.gridSlot || latest.has(event.gridSlot)) continue;
    latest.set(event.gridSlot, event);
  }
  return latest;
}

function mergeAdjustmentSupportRecords({
  caseId,
  gridSlot,
  gridSlotLabel,
  subject,
  candidateRecord,
  rowIndex,
  existingRecords = [],
}) {
  const existingByCategory = new Map(existingRecords.map((record) => [record.adjustmentCategory, record]));
  const records = [];
  const recommendations = [];

  for (const config of ADJUSTMENT_CATEGORY_CONFIG) {
    const values = deriveSupportValues(config, rowIndex, gridSlot, subject, candidateRecord.candidate || {});
    const derived = buildAdjustmentRecommendation(config, values, candidateRecord, subject);
    const libraryMatches = buildLibraryMatches({
      caseId,
      category: config.category,
      marketArea: subject.marketArea,
      propertyType: subject.propertyType,
    });
    const existing = existingByCategory.get(config.category);
    const preserveDecision = existing && existing.compCandidateId === candidateRecord.id;
    const record = {
      id: existing?.id,
      caseId,
      compCandidateId: candidateRecord.id,
      gridSlot,
      adjustmentCategory: config.category,
      subjectValue: derived.subjectValue,
      compValue: derived.compValue,
      supportType: preserveDecision ? (existing.supportType || derived.supportType) : derived.supportType,
      supportStrength: derived.supportStrength,
      suggestedAmount: derived.suggestedAmount,
      suggestedRange: derived.suggestedRange,
      finalAmount: preserveDecision ? (existing.finalAmount ?? null) : null,
      finalRange: preserveDecision ? (existing.finalRange || {}) : {},
      supportEvidence: [
        ...derived.supportEvidence,
        ...libraryMatches.map((match) => cleanObject({
          kind: 'paired_sales_library_match',
          libraryRecordId: match.id,
          supportMethod: match.supportMethod,
          conclusion: match.conclusion,
          confidence: match.confidence,
        })),
      ],
      rationaleNote: preserveDecision ? (existing.rationaleNote || derived.recommendation.why) : derived.recommendation.why,
      decisionStatus: preserveDecision ? (existing.decisionStatus || 'pending') : 'pending',
      recommendationSource: 'heuristic_seed',
      gridSlotLabel,
      label: config.label,
      requiresAdjustment: derived.requiresAdjustment,
      libraryMatches,
    };
    records.push(record);
    recommendations.push({
      compCandidateId: candidateRecord.id,
      gridSlot,
      adjustmentCategory: config.category,
      recommendation: derived.recommendation,
    });
  }

  return { records, recommendations };
}

function selectedAmountForRecord(record) {
  if (record.decisionStatus === 'rejected') return 0;
  if (record.decisionStatus === 'modified') return record.finalAmount ?? 0;
  if (record.decisionStatus === 'accepted') return record.finalAmount ?? record.suggestedAmount ?? 0;
  return record.suggestedAmount ?? 0;
}

function computeCompBurdenMetrics({ gridSlot, candidateRecord, records = [] }) {
  const salePrice = asNumber(candidateRecord?.candidate?.salePrice) || 0;
  const burdenByCategory = {};
  let grossAmount = 0;
  let netAmount = 0;

  for (const record of records) {
    const selectedAmount = selectedAmountForRecord(record);
    if (!selectedAmount) continue;
    burdenByCategory[record.adjustmentCategory] = selectedAmount;
    grossAmount += Math.abs(selectedAmount);
    netAmount += selectedAmount;
  }

  const grossAdjustmentPercent = salePrice ? Number(((grossAmount / salePrice) * 100).toFixed(2)) : 0;
  const netAdjustmentPercent = salePrice ? Number(((Math.abs(netAmount) / salePrice) * 100).toFixed(2)) : 0;
  const dataConfidenceScore = Number(candidateRecord.weightedBreakdown?.dataConfidence ?? 0);
  const dateRelevanceScore = Number(candidateRecord.weightedBreakdown?.recencyOfSale ?? 0);
  const locationConfidenceScore = Number((((candidateRecord.weightedBreakdown?.geographicProximity ?? 0) + (candidateRecord.weightedBreakdown?.marketAreaSimilarity ?? 0)) / 2).toFixed(4));
  const majorMismatchCount = records.filter((record) => record.requiresAdjustment && record.supportStrength !== 'high').length;
  const adjustmentHealth = Math.max(0, 1 - Math.min(grossAdjustmentPercent / 30, 1));
  const overallStabilityScore = Number((
    (
      adjustmentHealth +
      dataConfidenceScore +
      dateRelevanceScore +
      locationConfidenceScore +
      Number(candidateRecord.relevanceScore || 0)
    ) / 5
  ).toFixed(4));

  return {
    compCandidateId: candidateRecord.id,
    gridSlot,
    grossAdjustmentPercent,
    netAdjustmentPercent,
    burdenByCategory,
    majorMismatchCount,
    dataConfidenceScore,
    dateRelevanceScore,
    locationConfidenceScore,
    overallStabilityScore,
    computedAt: new Date().toISOString(),
  };
}

function buildAcceptedSlotSupport(caseId, projection, rankedCandidates, subject) {
  const rowIndex = buildGridRowIndex(getNestedValue(projection.facts || {}, 'workspace1004.salesComparison.grid')?.value || []);
  const latestBySlot = latestAcceptanceEventByGridSlot(caseId);
  const rankedById = new Map(rankedCandidates.map((candidate) => [candidate.id, candidate]));
  const existingRecords = listAdjustmentSupportRecords(caseId);
  const existingBySlot = new Map();
  for (const record of existingRecords) {
    if (!existingBySlot.has(record.gridSlot)) existingBySlot.set(record.gridSlot, []);
    existingBySlot.get(record.gridSlot).push(record);
  }

  const persistedRecords = [];
  const persistedRecommendations = [];
  const persistedMetrics = [];
  const acceptedSlots = [];

  for (const gridSlot of ['comp1', 'comp2', 'comp3']) {
    const event = latestBySlot.get(gridSlot);
    const candidateRecord = event ? rankedById.get(event.compCandidateId) : null;
    if (!candidateRecord) continue;

    const { records, recommendations } = mergeAdjustmentSupportRecords({
      caseId,
      gridSlot,
      gridSlotLabel: gridSlot.replace('comp', 'Comp '),
      subject,
      candidateRecord,
      rowIndex,
      existingRecords: existingBySlot.get(gridSlot) || [],
    });
    const burdenMetrics = computeCompBurdenMetrics({
      gridSlot,
      candidateRecord,
      records,
    });

    persistedRecords.push(...records);
    persistedRecommendations.push(...recommendations);
    persistedMetrics.push(burdenMetrics);
    acceptedSlots.push({
      gridSlot,
      gridSlotLabel: gridSlot.replace('comp', 'Comp '),
      candidateId: candidateRecord.id,
      address: candidateRecord.candidate?.address || rowIndex.get('Address')?.[gridSlot] || '',
      relevanceScore: candidateRecord.relevanceScore,
      tierLabel: candidateRecord.tierLabel,
      sourceStrength: candidateRecord.sourceStrength,
      burdenMetrics,
      adjustmentSupport: records,
    });
  }

  replaceAdjustmentSupportRecords(caseId, persistedRecords);
  replaceAdjustmentRecommendations(caseId, persistedRecommendations);
  replaceCompBurdenMetrics(caseId, persistedMetrics);
  const contradictions = buildComparableContradictions({
    projection,
    acceptedSlots,
    rankedCandidates,
  });
  const librarySummary = syncPairedSalesLibraryRecords(caseId, subject, acceptedSlots);

  return {
    acceptedSlots,
    contradictions,
    librarySummary,
  };
}

function mergeWeights(meta = {}) {
  const override = meta?.comparableIntelligence?.weights;
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return { ...DEFAULT_SCORE_WEIGHTS };
  }
  return {
    ...DEFAULT_SCORE_WEIGHTS,
    ...override,
  };
}

function syncComparableCandidates(caseId, projection) {
  const extractedFacts = getExtractedFacts(caseId);
  const normalizedCandidates = [
    ...buildExtractedCompCandidates(extractedFacts),
    ...buildManualCompCandidates(projection),
  ];

  markComparableCandidatesInactive(caseId);

  for (const candidate of normalizedCandidates) {
    upsertComparableCandidate({
      caseId,
      sourceKey: candidate.sourceKey,
      sourceType: candidate.sourceType,
      sourceDocumentId: candidate.sourceDocumentId,
      reviewStatus: candidate.reviewStatus,
      isActive: 1,
      candidate,
    });
  }

  return normalizedCandidates.length;
}

export function buildComparableIntelligence(caseId) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;

  syncComparableCandidates(caseId, projection);

  const candidates = listComparableCandidates(caseId, { activeOnly: true });
  const weights = mergeWeights(projection.meta || {});
  const subject = buildSubjectSnapshot(projection);

  const scored = candidates.map((row) => {
    const candidate = row.candidate || {};
    const score = computeCompositeSimilarity(subject, candidate, weights);
    const tier = tierForScore(score.overallScore);
    return {
      compCandidateId: row.id,
      overallScore: Number(score.overallScore.toFixed(4)),
      coverageScore: Number(score.coverageScore.toFixed(4)),
      breakdown: score.breakdown,
      weights,
      warnings: score.warnings,
      tier: tier.tier,
      tierReasoning: {
        label: tier.label,
        keyMatches: score.keyMatches,
        keyMismatches: score.keyMismatches,
        missingFactors: score.missingFactors,
      },
    };
  });

  replaceComparableScores(caseId, scored);

  const scoreMap = new Map(listComparableScores(caseId).map((row) => [row.compCandidateId, row]));
  const tierMap = new Map(listComparableTierAssignments(caseId).map((row) => [row.compCandidateId, row]));
  const historyMap = summarizeComparableHistory(caseId);

  const rankedCandidates = candidates.map((row) => {
    const candidate = row.candidate || {};
    const score = scoreMap.get(row.id);
    const tier = tierMap.get(row.id);
    const history = historyMap.get(row.id) || { acceptedCount: 0, rejectedCount: 0 };
    return {
      id: row.id,
      sourceKey: row.sourceKey,
      sourceType: row.sourceType,
      sourceDocumentId: row.sourceDocumentId,
      reviewStatus: row.reviewStatus,
      candidate,
      relevanceScore: score?.overallScore ?? 0,
      coverageScore: score?.coverageScore ?? 0,
      weightedBreakdown: cloneValue(score?.breakdown || {}),
      weights: cloneValue(score?.weights || weights),
      tier: tier?.tier || 'tier_4',
      tierLabel: tier?.reasoning?.label || 'Tier 4',
      keyMatches: tier?.reasoning?.keyMatches || [],
      keyMismatches: tier?.reasoning?.keyMismatches || [],
      missingFactors: tier?.reasoning?.missingFactors || [],
      warnings: score?.warnings || [],
      sourceStrength: candidate.sourceConfidenceLabel || 'medium',
      priorUsage: history,
      gridPreview: buildComparableGridPreview(candidate),
    };
  }).sort((left, right) => right.relevanceScore - left.relevanceScore);

  const supportBundle = buildAcceptedSlotSupport(caseId, projection, rankedCandidates, subject);
  const acceptedSlots = supportBundle.acceptedSlots;
  const contradictions = supportBundle.contradictions;
  const librarySummary = supportBundle.librarySummary;

  return {
    caseId,
    subject,
    weights,
    summary: {
      candidateCount: rankedCandidates.length,
      acceptedCount: rankedCandidates.filter((candidate) => candidate.reviewStatus === 'accepted').length,
      heldCount: rankedCandidates.filter((candidate) => candidate.reviewStatus === 'held').length,
      rejectedCount: rankedCandidates.filter((candidate) => candidate.reviewStatus === 'rejected').length,
      acceptedSlotCount: acceptedSlots.length,
      adjustmentSupportCount: acceptedSlots.reduce((sum, slot) => sum + slot.adjustmentSupport.length, 0),
      contradictionCount: contradictions.length,
    },
    candidates: rankedCandidates,
    acceptedSlots,
    contradictions,
    librarySummary,
  };
}

function buildVisibleReasoning(candidateRecord) {
  return {
    relevanceScore: candidateRecord.relevanceScore,
    tier: candidateRecord.tier,
    keyMatches: candidateRecord.keyMatches,
    keyMismatches: candidateRecord.keyMismatches,
    warnings: candidateRecord.warnings,
  };
}

export function holdComparableCandidate({
  caseId,
  candidateId,
}) {
  const candidate = getComparableCandidate(caseId, candidateId);
  if (!candidate) return null;
  updateComparableCandidateReviewStatus(caseId, candidateId, 'held');
  return buildComparableIntelligence(caseId);
}

export function rejectComparableCandidate({
  caseId,
  candidateId,
  reasonCode = 'other',
  rejectedBy = 'appraiser',
  note = '',
}) {
  const intelligence = buildComparableIntelligence(caseId);
  const candidateRecord = intelligence?.candidates?.find((item) => item.id === candidateId);
  if (!candidateRecord) return null;

  updateComparableCandidateReviewStatus(caseId, candidateId, 'rejected');
  recordComparableRejectionEvent({
    caseId,
    compCandidateId: candidateId,
    rejectedBy,
    reasonCode,
    rankingScore: candidateRecord.relevanceScore,
    visibleReasoning: buildVisibleReasoning(candidateRecord),
    note: note || REJECTION_REASON_LABELS[reasonCode] || reasonCode,
  });

  return buildComparableIntelligence(caseId);
}

function applyGridPreviewToWorkspaceGrid(gridRows = [], gridPreview = {}, gridSlot = 'comp1') {
  return gridRows.map((row) => {
    const feature = asText(row?.feature);
    if (!feature) return row;
    const previewValue = gridPreview[feature];
    if (previewValue == null || previewValue === '') return row;
    return {
      ...row,
      [gridSlot]: String(previewValue),
    };
  });
}

function syncLegacyCompFacts(facts, gridPreview, gridSlot) {
  const compIndexMap = { comp1: 0, comp2: 1, comp3: 2 };
  const compIndex = compIndexMap[gridSlot];
  if (compIndex == null) return facts;

  const nextFacts = cloneValue(facts || {});
  if (!Array.isArray(nextFacts.comps)) nextFacts.comps = [];
  while (nextFacts.comps.length <= compIndex) {
    nextFacts.comps.push({
      number: nextFacts.comps.length + 1,
      address: { value: null, confidence: 'low', source: '' },
      salePrice: { value: null, confidence: 'low', source: '' },
      saleDate: { value: null, confidence: 'low', source: '' },
      gla: { value: null, confidence: 'low', source: '' },
      dom: { value: null, confidence: 'low', source: '' },
      adjustments: { value: null, confidence: 'low', source: '' },
    });
  }

  const comp = nextFacts.comps[compIndex];
  const now = new Date().toISOString();
  if (gridPreview.Address) comp.address = { value: gridPreview.Address, confidence: 'high', source: 'comp-intelligence', updatedAt: now };
  if (gridPreview['Sale Price']) comp.salePrice = { value: gridPreview['Sale Price'], confidence: 'high', source: 'comp-intelligence', updatedAt: now };
  if (gridPreview['Date of Sale / Time']) comp.saleDate = { value: gridPreview['Date of Sale / Time'], confidence: 'high', source: 'comp-intelligence', updatedAt: now };
  if (gridPreview['Gross Living Area']) comp.gla = { value: gridPreview['Gross Living Area'], confidence: 'medium', source: 'comp-intelligence', updatedAt: now };
  return nextFacts;
}

export function acceptComparableCandidate({
  caseId,
  candidateId,
  acceptedBy = 'appraiser',
  gridSlot = null,
  becameFinalComp = false,
}) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;

  const intelligence = buildComparableIntelligence(caseId);
  const candidateRecord = intelligence?.candidates?.find((item) => item.id === candidateId);
  if (!candidateRecord) return null;

  updateComparableCandidateReviewStatus(caseId, candidateId, 'accepted');
  recordComparableAcceptanceEvent({
    caseId,
    compCandidateId: candidateId,
    acceptedBy,
    gridSlot,
    rankingScore: candidateRecord.relevanceScore,
    visibleReasoning: buildVisibleReasoning(candidateRecord),
    becameFinalComp,
    note: gridSlot ? `Loaded into ${gridSlot}` : 'Accepted from comparable intelligence panel',
  });

  let updatedProjection = projection;
  if (gridSlot) {
    const gridPath = 'workspace1004.salesComparison.grid';
    const currentGridLeaf = getNestedValue(projection.facts || {}, gridPath);
    const currentRows = Array.isArray(currentGridLeaf?.value) ? currentGridLeaf.value : [];
    const nextRows = applyGridPreviewToWorkspaceGrid(currentRows, candidateRecord.gridPreview, gridSlot);
    const now = new Date().toISOString();
    const nextFacts = cloneValue(projection.facts || {});
    setNestedValue(nextFacts, gridPath, {
      value: nextRows,
      confidence: 'high',
      source: 'comp-intelligence',
      updatedAt: now,
    });

    updatedProjection = saveCaseProjection({
      caseId,
      meta: {
        ...(projection.meta || {}),
        updatedAt: now,
      },
      facts: syncLegacyCompFacts(nextFacts, candidateRecord.gridPreview, gridSlot),
      provenance: projection.provenance || {},
      outputs: projection.outputs || {},
      history: projection.history || {},
      docText: projection.docText || {},
    }, { writeLegacyFiles: true });
  }

  return {
    intelligence: buildComparableIntelligence(caseId),
    projection: updatedProjection,
  };
}

export function saveAdjustmentSupportDecision({
  caseId,
  gridSlot,
  adjustmentCategory,
  decisionStatus = 'pending',
  rationaleNote = '',
  finalAmount = null,
  finalRange = undefined,
  supportType = undefined,
}) {
  const updated = updateAdjustmentSupportDecision({
    caseId,
    gridSlot,
    adjustmentCategory,
    decisionStatus,
    rationaleNote,
    finalAmount,
    finalRange,
    supportType,
  });

  if (!updated) return null;
  return buildComparableIntelligence(caseId);
}
