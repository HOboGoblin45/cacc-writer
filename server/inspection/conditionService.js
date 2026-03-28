/**
 * server/inspection/conditionService.js
 * ----------------------------------------
 * Phase 13 — Property Condition Assessment Service
 *
 * CRUD and analysis for property component conditions.
 * All functions are synchronous (better-sqlite3).
 *
 * Functions:
 *   addCondition(inspectionId, caseId, data)
 *   getCondition(id)
 *   listConditions(inspectionId)
 *   updateCondition(id, updates)
 *   deleteCondition(id)
 *   getConditionSummary(inspectionId)
 *   getRepairList(inspectionId)
 *   getOverallConditionRating(inspectionId)
 *   linkPhotosToCondition(conditionId, photoIds)
 *   exportConditions(inspectionId)
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() {
  return 'cond_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

function parseJSON(val, fallback = null) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function toJSON(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

// ── Rating weights for overall condition computation ──────────────────────────
// Structural/critical components weigh heavier than cosmetic ones.

const COMPONENT_WEIGHTS = {
  foundation:       3.0,
  roof:             3.0,
  exterior_walls:   2.5,
  plumbing:         2.0,
  electrical:       2.0,
  hvac:             2.0,
  insulation:       1.5,
  windows:          1.5,
  doors:            1.0,
  gutters:          1.0,
  flooring:         1.0,
  walls_interior:   1.0,
  ceiling:          1.0,
  appliances:       0.5,
  fireplace:        0.5,
  pool:             0.5,
  deck:             0.5,
  driveway:         0.5,
  landscaping:      0.5,
};

const RATING_SCORES = {
  good:            4,
  average:         3,
  fair:            2,
  poor:            1,
  not_present:     null,  // excluded from calculation
  not_inspected:   null,  // excluded from calculation
};

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Add a condition assessment.
 *
 * @param {string} inspectionId
 * @param {string} caseId
 * @param {Object} data
 * @returns {{ id: string } | { error: string }}
 */
export function addCondition(inspectionId, caseId, data = {}) {
  if (!inspectionId) return { error: 'inspectionId is required' };
  if (!caseId) return { error: 'caseId is required' };
  if (!data.component) return { error: 'component is required' };
  if (!data.condition_rating) return { error: 'condition_rating is required' };

  const id = genId();
  const ts = now();

  dbRun(`
    INSERT INTO inspection_conditions (
      id, inspection_id, case_id, component, condition_rating,
      material, age_years, remaining_life_years,
      deficiency, repair_needed, estimated_repair_cost,
      photo_ids_json, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, inspectionId, caseId, data.component, data.condition_rating,
    data.material || null,
    data.age_years ?? null,
    data.remaining_life_years ?? null,
    data.deficiency || null,
    data.repair_needed ? 1 : 0,
    data.estimated_repair_cost ?? null,
    toJSON(data.photo_ids_json) || null,
    data.notes || null,
    ts,
  ]);

  log.info('condition:added', { id, inspectionId, caseId, component: data.component });
  return { id };
}

/**
 * Get a single condition by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getCondition(id) {
  if (!id) return null;
  const row = dbGet('SELECT * FROM inspection_conditions WHERE id = ?', [id]);
  if (!row) return null;
  return {
    ...row,
    photo_ids_json: parseJSON(row.photo_ids_json, []),
  };
}

/**
 * List all conditions for an inspection.
 *
 * @param {string} inspectionId
 * @returns {Object[]}
 */
export function listConditions(inspectionId) {
  if (!inspectionId) return [];

  return dbAll(
    `SELECT * FROM inspection_conditions
     WHERE inspection_id = ?
     ORDER BY component ASC`,
    [inspectionId]
  ).map(row => ({
    ...row,
    photo_ids_json: parseJSON(row.photo_ids_json, []),
  }));
}

/**
 * Update a condition assessment.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {{ ok: boolean } | { error: string }}
 */
export function updateCondition(id, updates = {}) {
  if (!id) return { error: 'id is required' };

  const existing = dbGet('SELECT * FROM inspection_conditions WHERE id = ?', [id]);
  if (!existing) return { error: `Condition ${id} not found` };

  const allowed = [
    'component', 'condition_rating', 'material', 'age_years',
    'remaining_life_years', 'deficiency', 'repair_needed',
    'estimated_repair_cost', 'photo_ids_json', 'notes',
  ];

  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (key in updates) {
      sets.push(`${key} = ?`);
      vals.push(key === 'photo_ids_json' ? toJSON(updates[key]) : updates[key]);
    }
  }

  if (sets.length === 0) return { ok: true };
  vals.push(id);

  dbRun(`UPDATE inspection_conditions SET ${sets.join(', ')} WHERE id = ?`, vals);

  log.info('condition:updated', { id, fields: Object.keys(updates) });
  return { ok: true };
}

/**
 * Delete a condition record.
 *
 * @param {string} id
 * @returns {{ ok: boolean } | { error: string }}
 */
export function deleteCondition(id) {
  if (!id) return { error: 'id is required' };

  const existing = dbGet('SELECT * FROM inspection_conditions WHERE id = ?', [id]);
  if (!existing) return { error: `Condition ${id} not found` };

  dbRun('DELETE FROM inspection_conditions WHERE id = ?', [id]);

  log.info('condition:deleted', { id, inspectionId: existing.inspection_id });
  return { ok: true };
}

// ── Analysis ──────────────────────────────────────────────────────────────────

/**
 * Get a condition summary: counts by rating, total repair costs,
 * and list of deficiencies.
 *
 * @param {string} inspectionId
 * @returns {Object}
 */
export function getConditionSummary(inspectionId) {
  if (!inspectionId) return { error: 'inspectionId is required' };

  const conditions = listConditions(inspectionId);

  const countsByRating = {};
  const deficiencies = [];
  let totalRepairCost = 0;
  let repairCount = 0;

  for (const c of conditions) {
    // Count by rating
    const r = c.condition_rating;
    countsByRating[r] = (countsByRating[r] || 0) + 1;

    // Collect deficiencies
    if (c.deficiency) {
      deficiencies.push({
        component: c.component,
        deficiency: c.deficiency,
        rating: c.condition_rating,
        repairNeeded: !!c.repair_needed,
        estimatedCost: c.estimated_repair_cost,
      });
    }

    // Sum repair costs
    if (c.repair_needed) {
      repairCount++;
      totalRepairCost += c.estimated_repair_cost || 0;
    }
  }

  return {
    totalConditions: conditions.length,
    countsByRating,
    repairCount,
    totalRepairCost: Math.round(totalRepairCost * 100) / 100,
    deficiencies,
  };
}

/**
 * Get items needing repair with estimated costs.
 *
 * @param {string} inspectionId
 * @returns {Object[]}
 */
export function getRepairList(inspectionId) {
  if (!inspectionId) return [];

  const rows = dbAll(
    `SELECT * FROM inspection_conditions
     WHERE inspection_id = ? AND repair_needed = 1
     ORDER BY estimated_repair_cost DESC`,
    [inspectionId]
  );

  return rows.map(row => ({
    id: row.id,
    component: row.component,
    conditionRating: row.condition_rating,
    material: row.material,
    deficiency: row.deficiency,
    estimatedRepairCost: row.estimated_repair_cost,
    photoIds: parseJSON(row.photo_ids_json, []),
    notes: row.notes,
  }));
}

/**
 * Compute overall condition rating based on weighted component ratings.
 * Structural components (foundation, roof) weigh more heavily than cosmetic.
 *
 * @param {string} inspectionId
 * @returns {{ overall: string, score: number, weightedScore: number, components: Object[] }}
 */
export function getOverallConditionRating(inspectionId) {
  if (!inspectionId) return { overall: 'not_inspected', score: 0, weightedScore: 0, components: [] };

  const conditions = listConditions(inspectionId);

  let totalWeight = 0;
  let totalWeightedScore = 0;
  const components = [];

  for (const c of conditions) {
    const ratingScore = RATING_SCORES[c.condition_rating];
    if (ratingScore === null || ratingScore === undefined) continue; // skip not_present/not_inspected

    const weight = COMPONENT_WEIGHTS[c.component] || 1.0;
    totalWeight += weight;
    totalWeightedScore += ratingScore * weight;

    components.push({
      component: c.component,
      rating: c.condition_rating,
      score: ratingScore,
      weight,
    });
  }

  if (totalWeight === 0) {
    return { overall: 'not_inspected', score: 0, weightedScore: 0, components };
  }

  const weightedAvg = totalWeightedScore / totalWeight;

  // Map weighted average back to a rating
  let overall;
  if (weightedAvg >= 3.5) overall = 'good';
  else if (weightedAvg >= 2.5) overall = 'average';
  else if (weightedAvg >= 1.5) overall = 'fair';
  else overall = 'poor';

  return {
    overall,
    score: Math.round(weightedAvg * 100) / 100,
    weightedScore: Math.round(totalWeightedScore * 100) / 100,
    components,
  };
}

/**
 * Link photos to a condition record.
 *
 * @param {string} conditionId
 * @param {string[]} photoIds
 * @returns {{ ok: boolean } | { error: string }}
 */
export function linkPhotosToCondition(conditionId, photoIds) {
  if (!conditionId) return { error: 'conditionId is required' };
  if (!Array.isArray(photoIds)) return { error: 'photoIds must be an array' };

  const existing = dbGet('SELECT * FROM inspection_conditions WHERE id = ?', [conditionId]);
  if (!existing) return { error: `Condition ${conditionId} not found` };

  dbRun(
    'UPDATE inspection_conditions SET photo_ids_json = ? WHERE id = ?',
    [JSON.stringify(photoIds), conditionId]
  );

  log.info('condition:photos-linked', { conditionId, photoCount: photoIds.length });
  return { ok: true };
}

/**
 * Structured export for 1004 form condition sections.
 *
 * @param {string} inspectionId
 * @returns {Object}
 */
export function exportConditions(inspectionId) {
  if (!inspectionId) return { error: 'inspectionId is required' };

  const conditions = listConditions(inspectionId);
  const summary = getConditionSummary(inspectionId);
  const repairList = getRepairList(inspectionId);
  const overallRating = getOverallConditionRating(inspectionId);

  // Group by component category for form sections
  const exteriorComponents = ['foundation', 'exterior_walls', 'roof', 'gutters', 'windows', 'doors', 'driveway', 'deck', 'landscaping', 'pool'];
  const interiorComponents = ['flooring', 'walls_interior', 'ceiling', 'appliances', 'fireplace'];
  const systemComponents = ['plumbing', 'electrical', 'hvac', 'insulation'];

  function filterByComponents(list, componentNames) {
    return list.filter(c => componentNames.includes(c.component));
  }

  return {
    overallRating: overallRating.overall,
    overallScore: overallRating.score,
    exterior: filterByComponents(conditions, exteriorComponents),
    interior: filterByComponents(conditions, interiorComponents),
    systems: filterByComponents(conditions, systemComponents),
    summary,
    repairList,
    totalConditions: conditions.length,
  };
}

export default {
  addCondition,
  getCondition,
  listConditions,
  updateCondition,
  deleteCondition,
  getConditionSummary,
  getRepairList,
  getOverallConditionRating,
  linkPhotosToCondition,
  exportConditions,
};
