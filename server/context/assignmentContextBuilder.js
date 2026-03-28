/**
 * server/context/assignmentContextBuilder.js
 * -------------------------------------------
 * Builds a normalized AssignmentContext from case data.
 *
 * The AssignmentContext is the single source of truth during full-draft
 * generation. It is built ONCE per assignment and stored in SQLite.
 *
 * Performance target: < 300ms
 *
 * Usage:
 *   import { buildAssignmentContext, getAssignmentContext } from './context/assignmentContextBuilder.js';
 *   const ctx = await buildAssignmentContext('case-abc123');
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';
import { getCaseProjection } from '../caseRecord/caseRecordService.js';

/** Safely extract a fact value from the nested facts schema. */
function factVal(obj, key, fallback = null) {
  if (!obj || typeof obj !== 'object') return fallback;
  const entry = obj[key];
  if (entry === null || entry === undefined) return fallback;
  if (typeof entry === 'object' && 'value' in entry) {
    return entry.value ?? fallback;
  }
  return entry ?? fallback;
}

// ── Comp normalizer ───────────────────────────────────────────────────────────

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

// ── Flag derivation ───────────────────────────────────────────────────────────

function deriveFlags(meta, facts) {
  const site   = facts.site   || {};
  const market = facts.market || {};
  const comps  = facts.comps  || [];

  const loanProgram        = (meta.loanProgram        || '').toLowerCase();
  const assignmentPurpose  = (meta.assignmentPurpose  || '').toLowerCase();
  const reportConditionMode = (meta.reportConditionMode || '').toLowerCase();
  const formType           = (meta.formType           || '1004').toLowerCase();

  const floodZoneVal = factVal(site, 'floodZone') || '';
  const mktAdj       = factVal(market, 'timeAdjustmentPct') || 0;

  return {
    isFHA:                  loanProgram === 'fha',
    isVA:                   loanProgram === 'va',
    isUSDA:                 loanProgram === 'usda',
    isConventional:         loanProgram === 'conventional' || loanProgram === '',
    isConstruction:         reportConditionMode === 'subject_to_completion',
    isSubjectToRepairs:     reportConditionMode === 'subject_to_repairs',
    isAsIs:                 reportConditionMode === 'as_is' || reportConditionMode === '',
    isRefinance:            assignmentPurpose === 'refinance',
    isPurchase:             assignmentPurpose === 'purchase' || assignmentPurpose === '',
    hasFloodZone:           !!(floodZoneVal && floodZoneVal !== 'X' && floodZoneVal !== 'Zone X'),
    hasComps:               Array.isArray(comps) && comps.length > 0,
    compCount:              Array.isArray(comps) ? comps.length : 0,
    hasMarketTimeAdjustment: Number(mktAdj) > 0,
    marketTimeAdjPct:       Number(mktAdj) || 0,
    isCommercial:           formType === 'commercial',
    isResidential:          formType === '1004',
    formType,
  };
}

// ── Core normalizer ───────────────────────────────────────────────────────────

function normalizeContext(caseId, meta, facts) {
  const subject      = facts.subject      || {};
  const market       = facts.market       || {};
  const neighborhood = facts.neighborhood || {};
  const site         = facts.site         || {};
  const improvements = facts.improvements || {};
  const assignment   = facts.assignment   || {};
  const comps        = Array.isArray(facts.comps) ? facts.comps : [];

  const flags = deriveFlags(meta, facts);

  return {
    // ── Identity ──────────────────────────────────────────────────────────────
    caseId,
    formType:            meta.formType            || '1004',
    assignmentPurpose:   meta.assignmentPurpose   || 'purchase',
    loanProgram:         meta.loanProgram         || 'conventional',
    reportConditionMode: meta.reportConditionMode || 'as_is',
    propertyType:        meta.propertyType        || 'residential',
    occupancyType:       meta.occupancyType       || 'owner_occupied',

    // ── Subject property ──────────────────────────────────────────────────────
    subject: {
      address:   factVal(subject, 'address')   || '',
      city:      factVal(subject, 'city')      || '',
      county:    factVal(subject, 'county')    || '',
      state:     factVal(subject, 'state')     || 'IL',
      zip:       factVal(subject, 'zip')       || '',
      yearBuilt: factVal(subject, 'yearBuilt') || null,
      gla:       factVal(subject, 'gla')       || null,
      lotSize:   factVal(subject, 'lotSize')   || null,
      bedrooms:  factVal(subject, 'bedrooms')  || null,
      bathrooms: factVal(subject, 'bathrooms') || null,
      condition: factVal(subject, 'condition') || null,
      quality:   factVal(subject, 'quality')   || null,
    },

    // ── Market data ───────────────────────────────────────────────────────────
    market: {
      marketArea:                  factVal(market, 'marketArea')         || factVal(subject, 'city') || '',
      marketType:                  meta.marketType                       || 'suburban',
      priceLow:                    factVal(market, 'priceRangeLow')      || null,
      priceHigh:                   factVal(market, 'priceRangeHigh')     || null,
      trend:                       factVal(market, 'trend')              || null,
      avgDom:                      factVal(market, 'avgDom')             || null,
      marketTimeAdjustmentPercent: factVal(market, 'timeAdjustmentPct')  || 0,
      supplyDemand:                factVal(market, 'supplyDemand')       || null,
    },

    // ── Neighborhood ──────────────────────────────────────────────────────────
    neighborhood: {
      description:     factVal(neighborhood, 'description')     || '',
      boundaries:      factVal(neighborhood, 'boundaries')      || '',
      characteristics: factVal(neighborhood, 'characteristics') || '',
      builtUp:         factVal(neighborhood, 'builtUp')         || null,
      growth:          factVal(neighborhood, 'growth')          || null,
    },

    // ── Site ──────────────────────────────────────────────────────────────────
    site: {
      zoning:      factVal(site, 'zoning')      || null,
      utilities:   factVal(site, 'utilities')   || null,
      floodZone:   factVal(site, 'floodZone')   || null,
      topography:  factVal(site, 'topography')  || null,
      view:        factVal(site, 'view')        || null,
      siteSize:    factVal(site, 'siteSize')    || null,
    },

    // ── Improvements ──────────────────────────────────────────────────────────
    improvements: {
      condition:         factVal(improvements, 'condition')         || null,
      quality:           factVal(improvements, 'quality')           || null,
      functionalUtility: factVal(improvements, 'functionalUtility') || null,
      updates:           factVal(improvements, 'updates')           || null,
      basement:          factVal(improvements, 'basement')          || null,
      garage:            factVal(improvements, 'garage')            || null,
    },

    // ── Assignment ────────────────────────────────────────────────────────────
    assignment: {
      effectiveDate: factVal(assignment, 'effectiveDate') || null,
      intendedUse:   factVal(assignment, 'intendedUse')   || null,
      intendedUser:  factVal(assignment, 'intendedUser')  || null,
      clientName:    factVal(assignment, 'clientName')    || null,
    },

    // ── Comparables ───────────────────────────────────────────────────────────
    comps: comps.slice(0, 6).map(normalizeComp).filter(Boolean),

    // ── Derived flags ─────────────────────────────────────────────────────────
    flags,

    // ── Metadata ──────────────────────────────────────────────────────────────
    _version: '1.0',
    _builtAt: new Date().toISOString(),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build and persist a normalized AssignmentContext for a case.
 * If a context already exists for this case, it is updated in place.
 *
 * @param {string} caseId
 * @returns {Promise<object>} AssignmentContext with .id and ._buildMs
 */
export async function buildAssignmentContext(caseId) {
  const t0      = Date.now();
  const projection = getCaseProjection(caseId);
  if (!projection) throw new Error(`Case not found: ${caseId}`);

  const meta = projection.meta || {};
  const facts = projection.facts || {};

  const context = normalizeContext(caseId, meta, facts);

  // Persist to SQLite
  const db      = getDb();
  const existing = db.prepare('SELECT id FROM assignments WHERE case_id = ?').get(caseId);

  if (existing) {
    db.prepare(`
      UPDATE assignments
         SET context_json = ?,
             form_type    = ?,
             updated_at   = datetime('now')
       WHERE case_id = ?
    `).run(JSON.stringify(context), context.formType, caseId);
    context.id = existing.id;
  } else {
    const id = uuidv4();
    context.id = id;
    db.prepare(`
      INSERT INTO assignments (id, case_id, form_type, context_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(id, caseId, context.formType, JSON.stringify(context));
  }

  context._buildMs = Date.now() - t0;
  return context;
}

/**
 * Retrieve an existing AssignmentContext from SQLite.
 * Returns null if not found.
 *
 * @param {string} caseId
 * @returns {object|null}
 */
export function getAssignmentContext(caseId) {
  const db  = getDb();
  const row = db.prepare('SELECT context_json FROM assignments WHERE case_id = ?').get(caseId);
  if (!row) return null;
  try {
    return JSON.parse(row.context_json);
  } catch {
    return null;
  }
}

/**
 * Get the assignment row (id + form_type) for a case.
 * Returns null if not found.
 *
 * @param {string} caseId
 * @returns {{ id: string, form_type: string }|null}
 */
export function getAssignmentRow(caseId) {
  const db = getDb();
  return db.prepare('SELECT id, form_type FROM assignments WHERE case_id = ?').get(caseId) || null;
}
