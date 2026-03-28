/**
 * server/comparableIntelligence/costApproachService.js
 * -----------------------------------------------------
 * Cost Approach Service — manages land value, replacement cost new,
 * depreciation, site improvements, and cost-indicated value.
 */

import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeParseJSON(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function ensureRecord(caseId) {
  const existing = dbGet(`SELECT id FROM cost_approach_data WHERE case_id = ?`, [caseId]);
  if (!existing) {
    dbRun(`
      INSERT INTO cost_approach_data (id, case_id)
      VALUES (?, ?)
    `, [uuidv4(), caseId]);
  }
}

// ── getCostAnalysis ──────────────────────────────────────────────────────────

/**
 * Get the full cost approach workspace data.
 */
export function getCostAnalysis(caseId) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const row = dbGet(`SELECT * FROM cost_approach_data WHERE case_id = ?`, [caseId]);

  return {
    id: row.id,
    caseId: row.case_id,
    landValue: row.land_value,
    landValueSource: row.land_value_source,
    replacementCostNew: row.replacement_cost_new,
    costMethod: row.cost_method,
    costPerSqft: row.cost_per_sqft,
    glaSqft: row.gla_sqft,
    extras: safeParseJSON(row.extras_json, []),
    physicalDepreciation: row.physical_depreciation,
    functionalDepreciation: row.functional_depreciation,
    externalDepreciation: row.external_depreciation,
    totalDepreciation: row.total_depreciation,
    depreciatedValue: row.depreciated_value,
    siteImprovements: row.site_improvements,
    indicatedValue: row.indicated_value,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── saveLandValue ────────────────────────────────────────────────────────────

/**
 * Save land value and source.
 */
export function saveLandValue(caseId, { landValue, source }) {
  if (!caseId) throw new Error('caseId is required');
  if (landValue == null || isNaN(landValue)) throw new Error('landValue must be a number');
  ensureRecord(caseId);

  const now = new Date().toISOString();
  dbRun(`
    UPDATE cost_approach_data
       SET land_value = ?, land_value_source = ?, updated_at = ?
     WHERE case_id = ?
  `, [landValue, source || null, now, caseId]);

  log.info('cost:saveLandValue', { caseId, landValue, source });
  return { success: true, caseId, landValue, source };
}

// ── saveReplacementCost ──────────────────────────────────────────────────────

/**
 * Save replacement cost new components.
 */
export function saveReplacementCost(caseId, { costPerSqft, glaSqft, extras }) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const cps = costPerSqft ?? 0;
  const gla = glaSqft ?? 0;
  const extrasArr = Array.isArray(extras) ? extras : [];
  const extrasTotal = extrasArr
    .filter(e => e && typeof e.amount === 'number')
    .reduce((a, e) => a + e.amount, 0);
  const replacementCostNew = (cps * gla) + extrasTotal;

  const now = new Date().toISOString();
  dbRun(`
    UPDATE cost_approach_data
       SET cost_per_sqft = ?,
           gla_sqft = ?,
           extras_json = ?,
           replacement_cost_new = ?,
           cost_method = 'cost_manual',
           updated_at = ?
     WHERE case_id = ?
  `, [cps, gla, JSON.stringify(extrasArr), replacementCostNew, now, caseId]);

  log.info('cost:saveReplacementCost', { caseId, costPerSqft: cps, glaSqft: gla, replacementCostNew });
  return { success: true, caseId, replacementCostNew };
}

// ── saveDepreciation ─────────────────────────────────────────────────────────

/**
 * Save depreciation amounts (physical, functional, external).
 */
export function saveDepreciation(caseId, { physical, functional, external: ext }) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const p = physical ?? 0;
  const f = functional ?? 0;
  const e = ext ?? 0;
  const total = p + f + e;

  const now = new Date().toISOString();
  dbRun(`
    UPDATE cost_approach_data
       SET physical_depreciation = ?,
           functional_depreciation = ?,
           external_depreciation = ?,
           total_depreciation = ?,
           updated_at = ?
     WHERE case_id = ?
  `, [p, f, e, total, now, caseId]);

  log.info('cost:saveDepreciation', { caseId, physical: p, functional: f, external: e, total });
  return { success: true, caseId, totalDepreciation: total };
}

// ── calculateIndicatedValue ──────────────────────────────────────────────────

/**
 * Calculate cost approach indicated value:
 *   land + (RCN - depreciation) + site improvements
 */
export function calculateIndicatedValue(caseId) {
  if (!caseId) throw new Error('caseId is required');
  ensureRecord(caseId);

  const row = dbGet(`
    SELECT land_value, replacement_cost_new, total_depreciation, site_improvements
      FROM cost_approach_data
     WHERE case_id = ?
  `, [caseId]);

  const landValue = row?.land_value ?? 0;
  const rcn = row?.replacement_cost_new ?? 0;
  const totalDepreciation = row?.total_depreciation ?? 0;
  const siteImprovements = row?.site_improvements ?? 0;

  const depreciatedValue = rcn - totalDepreciation;
  const indicatedValue = Math.round(landValue + depreciatedValue + siteImprovements);

  const now = new Date().toISOString();
  dbRun(`
    UPDATE cost_approach_data
       SET depreciated_value = ?,
           indicated_value = ?,
           updated_at = ?
     WHERE case_id = ?
  `, [depreciatedValue, indicatedValue, now, caseId]);

  log.info('cost:calculateIndicatedValue', { caseId, landValue, rcn, totalDepreciation, siteImprovements, indicatedValue });
  return { caseId, landValue, replacementCostNew: rcn, totalDepreciation, depreciatedValue, siteImprovements, indicatedValue };
}

// ── getFullCostSummary ───────────────────────────────────────────────────────

/**
 * Full summary with all cost approach components.
 */
export function getFullCostSummary(caseId) {
  if (!caseId) throw new Error('caseId is required');
  const analysis = getCostAnalysis(caseId);

  return {
    caseId,
    landValue: analysis.landValue,
    landValueSource: analysis.landValueSource,
    replacementCostNew: analysis.replacementCostNew,
    costMethod: analysis.costMethod,
    costPerSqft: analysis.costPerSqft,
    glaSqft: analysis.glaSqft,
    extras: analysis.extras,
    depreciation: {
      physical: analysis.physicalDepreciation,
      functional: analysis.functionalDepreciation,
      external: analysis.externalDepreciation,
      total: analysis.totalDepreciation,
    },
    depreciatedValue: analysis.depreciatedValue,
    siteImprovements: analysis.siteImprovements,
    indicatedValue: analysis.indicatedValue,
  };
}

// ── Default export ───────────────────────────────────────────────────────────

export default {
  getCostAnalysis,
  saveLandValue,
  saveReplacementCost,
  saveDepreciation,
  calculateIndicatedValue,
  getFullCostSummary,
};
