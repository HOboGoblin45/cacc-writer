/**
 * server/intelligence/normalizer.js
 * ------------------------------------
 * Phase 4 — Assignment Context v2 Normalizer
 *
 * Builds the expanded NormalizedAssignmentContext v2 from raw case data
 * (meta.json + facts.json). This is the upgrade path from the v1
 * normalizeContext() in assignmentContextBuilder.js.
 *
 * The v2 context adds:
 *   - Full assignment standard fields (intended use, client, lender, etc.)
 *   - Value condition (as-is, subject-to, prospective, retrospective)
 *   - Property indicators (ADU, mixed-use, manufactured, rural, etc.)
 *   - Approaches applicability
 *   - Extraordinary assumptions / hypothetical conditions
 *   - Expanded site characteristics (zoning conformity, etc.)
 *   - Unit count, tenure type
 *
 * Usage:
 *   import { normalizeAssignmentContextV2 } from './intelligence/normalizer.js';
 *   const ctx = normalizeAssignmentContextV2(caseId, meta, facts);
 */

import {
  factVal, coerceEnum, asPositiveInt, asBool,
  ASSIGNMENT_PURPOSES, LOAN_PROGRAMS, REPORT_TYPES, FORM_TYPES,
  PROPERTY_TYPES, OCCUPANCY_TYPES, TENURE_TYPES, VALUE_CONDITIONS,
  ZONING_CONFORMITY, CONDITION_RATINGS, QUALITY_RATINGS,
} from './assignmentSchema.js';

// ── Comp normalizer ─────────────────────────────────────────────────────────

function normalizeComp(comp, index) {
  if (!comp || typeof comp !== 'object') return null;
  return {
    index:     index + 1,
    address:   factVal(comp, 'address')   ?? comp.address   ?? '',
    salePrice: factVal(comp, 'salePrice') ?? comp.salePrice ?? null,
    saleDate:  factVal(comp, 'saleDate')  ?? comp.saleDate  ?? null,
    gla:       factVal(comp, 'gla')       ?? comp.gla       ?? null,
    lotSize:   factVal(comp, 'lotSize')   ?? comp.lotSize   ?? null,
    yearBuilt: factVal(comp, 'yearBuilt') ?? comp.yearBuilt ?? null,
    condition: factVal(comp, 'condition') ?? comp.condition ?? null,
    adjustments: comp.adjustments ?? {},
  };
}

// ── Core v2 normalizer ──────────────────────────────────────────────────────

/**
 * Build a NormalizedAssignmentContext v2 from raw case data.
 *
 * @param {string} caseId
 * @param {object} meta  — from meta.json
 * @param {object} facts — from facts.json
 * @returns {import('./assignmentSchema.js').NormalizedAssignmentContext}
 */
export function normalizeAssignmentContextV2(caseId, meta, facts) {
  const subject      = facts.subject      || {};
  const market       = facts.market       || {};
  const neighborhood = facts.neighborhood || {};
  const site         = facts.site         || {};
  const improvements = facts.improvements || {};
  const assignment   = facts.assignment   || {};
  const comps        = Array.isArray(facts.comps) ? facts.comps : [];

  // ── Identity / assignment standard ────────────────────────────────────
  const formType          = coerceEnum(meta.formType, FORM_TYPES, '1004');
  const reportType        = coerceEnum(meta.reportType, REPORT_TYPES, 'appraisal_report');
  const assignmentPurpose = coerceEnum(meta.assignmentPurpose || meta.purpose, ASSIGNMENT_PURPOSES, 'purchase');
  const loanProgram       = coerceEnum(meta.loanProgram || meta.loanType, LOAN_PROGRAMS, 'conventional');
  const valueCondition    = coerceEnum(meta.reportConditionMode || meta.valueCondition, VALUE_CONDITIONS, 'as_is');
  const propertyType      = coerceEnum(meta.propertyType, PROPERTY_TYPES, inferPropertyType(formType, meta));
  const occupancyType     = coerceEnum(meta.occupancyType || meta.occupancy, OCCUPANCY_TYPES, 'owner_occupied');
  const tenureType        = coerceEnum(meta.tenureType || meta.tenure, TENURE_TYPES, 'fee_simple');
  const unitCount         = asPositiveInt(meta.unitCount || meta.units) ?? inferUnitCount(formType, propertyType);

  // ── Client info ───────────────────────────────────────────────────────
  const client = {
    name:   meta.clientName   || factVal(assignment, 'clientName')   || null,
    lender: meta.lenderName   || factVal(assignment, 'lenderName')  || null,
    amc:    meta.amcName      || factVal(assignment, 'amcName')     || null,
  };

  // ── Intended use / user ───────────────────────────────────────────────
  const intendedUse  = meta.intendedUse  || factVal(assignment, 'intendedUse')  || inferIntendedUse(loanProgram);
  const intendedUser = meta.intendedUser || factVal(assignment, 'intendedUser') || null;

  // ── Extraordinary assumptions / hypothetical conditions ───────────────
  const extraordinaryAssumptions = asArray(meta.extraordinaryAssumptions || factVal(assignment, 'extraordinaryAssumptions'));
  const hypotheticalConditions   = asArray(meta.hypotheticalConditions   || factVal(assignment, 'hypotheticalConditions'));

  // ── Subject property ──────────────────────────────────────────────────
  const normalizedSubject = {
    address:       factVal(subject, 'address')      || meta.address   || '',
    city:          factVal(subject, 'city')          || meta.city      || '',
    county:        factVal(subject, 'county')        || meta.county    || '',
    state:         factVal(subject, 'state')         || meta.state     || 'IL',
    zip:           factVal(subject, 'zip')           || meta.zip       || '',
    yearBuilt:     asPositiveInt(factVal(subject, 'yearBuilt')),
    effectiveAge:  asPositiveInt(factVal(subject, 'effectiveAge') || factVal(improvements, 'effectiveAge')),
    gla:           asPositiveInt(factVal(subject, 'gla')),
    lotSize:       factVal(subject, 'lotSize')       || null,
    bedrooms:      asPositiveInt(factVal(subject, 'bedrooms')),
    bathrooms:     factVal(subject, 'bathrooms')     || null,
    rooms:         asPositiveInt(factVal(subject, 'rooms') || factVal(subject, 'totalRooms')),
    design:        factVal(subject, 'design')        || factVal(subject, 'style')  || null,
    condition:     factVal(subject, 'condition')      || factVal(improvements, 'condition') || null,
    quality:       factVal(subject, 'quality')        || factVal(improvements, 'quality')   || null,
  };

  // ── Site characteristics ──────────────────────────────────────────────
  const normalizedSite = {
    zoning:           factVal(site, 'zoning')        || factVal(subject, 'zoning')    || null,
    zoningConformity: coerceEnum(factVal(site, 'zoningConformity') || factVal(site, 'zoningCompliance'), ZONING_CONFORMITY, null),
    utilities:        factVal(site, 'utilities')     || null,
    floodZone:        factVal(site, 'floodZone')     || null,
    floodMapNumber:   factVal(site, 'floodMapNumber')|| null,
    floodMapDate:     factVal(site, 'floodMapDate')  || null,
    topography:       factVal(site, 'topography')    || null,
    view:             factVal(site, 'view')           || null,
    siteSize:         factVal(site, 'siteSize')      || factVal(subject, 'lotSize') || null,
    shape:            factVal(site, 'shape')          || null,
    drainage:         factVal(site, 'drainage')       || null,
    easements:        factVal(site, 'easements')      || null,
    encroachments:    factVal(site, 'encroachments')  || null,
  };

  // ── Improvements ──────────────────────────────────────────────────────
  const normalizedImprovements = {
    condition:         factVal(improvements, 'condition')         || normalizedSubject.condition || null,
    quality:           factVal(improvements, 'quality')           || normalizedSubject.quality   || null,
    functionalUtility: factVal(improvements, 'functionalUtility') || null,
    updates:           factVal(improvements, 'updates')           || null,
    basement:          factVal(improvements, 'basement')          || null,
    garage:            factVal(improvements, 'garage')            || null,
    heating:           factVal(improvements, 'heating')           || null,
    cooling:           factVal(improvements, 'cooling')           || null,
    foundation:        factVal(improvements, 'foundation')        || null,
    roof:              factVal(improvements, 'roof')              || null,
    exterior:          factVal(improvements, 'exterior')          || null,
  };

  // ── Neighborhood ──────────────────────────────────────────────────────
  const normalizedNeighborhood = {
    description:     factVal(neighborhood, 'description')     || '',
    boundaries:      factVal(neighborhood, 'boundaries')      || '',
    characteristics: factVal(neighborhood, 'characteristics') || '',
    builtUp:         factVal(neighborhood, 'builtUp')         || null,
    growth:          factVal(neighborhood, 'growth')           || null,
    landUse:         factVal(neighborhood, 'landUse')          || null,
  };

  // ── Market data ───────────────────────────────────────────────────────
  const normalizedMarket = {
    marketArea:                  factVal(market, 'marketArea') || normalizedSubject.city || '',
    marketType:                  meta.marketType || 'suburban',
    priceLow:                    factVal(market, 'priceRangeLow')      || null,
    priceHigh:                   factVal(market, 'priceRangeHigh')     || null,
    trend:                       factVal(market, 'trend')              || null,
    avgDom:                      factVal(market, 'avgDom')             || null,
    marketTimeAdjustmentPercent: factVal(market, 'timeAdjustmentPct')  || 0,
    supplyDemand:                factVal(market, 'supplyDemand')       || null,
  };

  // ── Assignment details ────────────────────────────────────────────────
  const normalizedAssignment = {
    effectiveDate: factVal(assignment, 'effectiveDate') || meta.effectiveDate || null,
    intendedUse,
    intendedUser,
    clientName:    client.name,
  };

  // ── Approaches applicability ──────────────────────────────────────────
  const approaches = {
    salesApplicable:         asBool(meta.salesApplicable,  true),
    costApplicable:          asBool(meta.costApplicable,   false),
    incomeApplicable:        asBool(meta.incomeApplicable, unitCount >= 2 || formType === 'commercial'),
    salesExclusionReason:    meta.salesExclusionReason  || null,
    costExclusionReason:     meta.costExclusionReason   || null,
    incomeExclusionReason:   meta.incomeExclusionReason || null,
  };

  // ── Property indicators ───────────────────────────────────────────────
  const indicators = {
    mixedUse:              asBool(meta.mixedUse              || factVal(subject, 'mixedUse')),
    adu:                   asBool(meta.adu                   || factVal(subject, 'adu') || factVal(improvements, 'adu')),
    manufacturedHome:      formType === '1004c' || asBool(meta.manufacturedHome || factVal(subject, 'manufacturedHome')),
    rural:                 asBool(meta.rural                 || factVal(subject, 'rural')),
    incomeProducing:       unitCount >= 2 || formType === 'commercial' || asBool(meta.incomeProducing),
    newConstruction:       asBool(meta.newConstruction       || factVal(subject, 'newConstruction')),
    proposedConstruction:  asBool(meta.proposedConstruction  || factVal(subject, 'proposedConstruction')),
    rehabilitation:        asBool(meta.rehabilitation        || factVal(subject, 'rehabilitation')),
  };

  // ── Comparables ───────────────────────────────────────────────────────
  const normalizedComps = comps.slice(0, 6).map(normalizeComp).filter(Boolean);

  return {
    caseId,
    formType,
    reportType,
    assignmentPurpose,
    loanProgram,
    valueCondition,
    propertyType,
    occupancyType,
    tenureType,
    unitCount,

    client,
    intendedUse,
    intendedUser,

    extraordinaryAssumptions,
    hypotheticalConditions,

    subject:      normalizedSubject,
    site:         normalizedSite,
    improvements: normalizedImprovements,
    neighborhood: normalizedNeighborhood,
    market:       normalizedMarket,
    assignment:   normalizedAssignment,
    comps:        normalizedComps,

    approaches,
    indicators,

    _version: '2.0',
    _builtAt: new Date().toISOString(),
  };
}

// ── Inference helpers ───────────────────────────────────────────────────────

function inferPropertyType(formType, meta) {
  const ft = (formType || '').toLowerCase();
  if (ft === '1073') return 'condo';
  if (ft === '1004c') return 'manufactured_home';
  if (ft === '1025') return 'multi_unit_2';
  if (ft === 'commercial') return 'commercial';
  return 'single_family';
}

function inferUnitCount(formType, propertyType) {
  const ft = (formType || '').toLowerCase();
  const pt = (propertyType || '').toLowerCase();
  if (ft === '1025' || pt.startsWith('multi_unit_')) {
    const match = pt.match(/multi_unit_(\d)/);
    return match ? parseInt(match[1], 10) : 2;
  }
  return 1;
}

function inferIntendedUse(loanProgram) {
  const lp = (loanProgram || '').toLowerCase();
  if (['fha', 'va', 'usda', 'conventional'].includes(lp)) {
    return 'The intended use is to evaluate the property that is the subject of this appraisal for a mortgage finance transaction.';
  }
  return null;
}

function asArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}
