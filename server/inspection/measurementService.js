/**
 * server/inspection/measurementService.js
 * ------------------------------------------
 * Phase 13 — Inspection Measurement Service
 *
 * CRUD and calculation functions for property measurements.
 * All functions are synchronous (better-sqlite3).
 *
 * Functions:
 *   addMeasurement(inspectionId, caseId, data)
 *   getMeasurement(id)
 *   listMeasurements(inspectionId, opts)
 *   updateMeasurement(id, updates)
 *   deleteMeasurement(id)
 *   calculateGLA(inspectionId)
 *   calculateTotalArea(inspectionId)
 *   getLevelBreakdown(inspectionId)
 *   exportMeasurements(inspectionId)
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() {
  return 'meas_' + randomUUID().slice(0, 12);
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

/**
 * Auto-calculate area_sqft from length and width if both are present
 * and area_sqft is not explicitly provided.
 */
function computeArea(data) {
  if (data.area_sqft != null) return data.area_sqft;
  if (data.length_ft != null && data.width_ft != null) {
    return Math.round(data.length_ft * data.width_ft * 100) / 100;
  }
  return null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Add a measurement record.
 * Auto-calculates area_sqft from length_ft * width_ft if not provided.
 *
 * @param {string} inspectionId
 * @param {string} caseId
 * @param {Object} data
 * @returns {{ id: string } | { error: string }}
 */
export function addMeasurement(inspectionId, caseId, data = {}) {
  if (!inspectionId) return { error: 'inspectionId is required' };
  if (!caseId) return { error: 'caseId is required' };
  if (!data.area_name) return { error: 'area_name is required' };
  if (!data.area_type) return { error: 'area_type is required' };

  const id = genId();
  const ts = now();
  const areaSqft = computeArea(data);

  dbRun(`
    INSERT INTO inspection_measurements (
      id, inspection_id, case_id, area_name, area_type,
      level, length_ft, width_ft, area_sqft,
      ceiling_height_ft, shape, dimensions_json,
      notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, inspectionId, caseId, data.area_name, data.area_type,
    data.level || null,
    data.length_ft ?? null,
    data.width_ft ?? null,
    areaSqft,
    data.ceiling_height_ft ?? null,
    data.shape || 'rectangular',
    toJSON(data.dimensions_json) || null,
    data.notes || null,
    ts,
  ]);

  // Update measurements_complete count on inspection
  const count = dbGet(
    'SELECT COUNT(*) AS n FROM inspection_measurements WHERE inspection_id = ?',
    [inspectionId]
  );
  dbRun('UPDATE inspections SET measurements_complete = ?, updated_at = ? WHERE id = ?', [
    count?.n ?? 0, ts, inspectionId,
  ]);

  log.info('measurement:added', { id, inspectionId, caseId, areaName: data.area_name });
  return { id };
}

/**
 * Get a single measurement by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getMeasurement(id) {
  if (!id) return null;
  const row = dbGet('SELECT * FROM inspection_measurements WHERE id = ?', [id]);
  if (!row) return null;
  return {
    ...row,
    dimensions_json: parseJSON(row.dimensions_json, []),
  };
}

/**
 * List measurements for an inspection, optionally filtered.
 *
 * @param {string} inspectionId
 * @param {Object} [opts={}]
 * @param {string} [opts.level]
 * @param {string} [opts.area_type]
 * @returns {Object[]}
 */
export function listMeasurements(inspectionId, opts = {}) {
  if (!inspectionId) return [];

  let sql = 'SELECT * FROM inspection_measurements WHERE inspection_id = ?';
  const params = [inspectionId];

  if (opts.level) {
    sql += ' AND level = ?';
    params.push(opts.level);
  }
  if (opts.area_type) {
    sql += ' AND area_type = ?';
    params.push(opts.area_type);
  }

  sql += ' ORDER BY level ASC, area_name ASC';

  return dbAll(sql, params).map(row => ({
    ...row,
    dimensions_json: parseJSON(row.dimensions_json, []),
  }));
}

/**
 * Update a measurement. Recalculates area_sqft if length/width change.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {{ ok: boolean } | { error: string }}
 */
export function updateMeasurement(id, updates = {}) {
  if (!id) return { error: 'id is required' };

  const existing = dbGet('SELECT * FROM inspection_measurements WHERE id = ?', [id]);
  if (!existing) return { error: `Measurement ${id} not found` };

  // Recalculate area_sqft if length or width changed
  if (('length_ft' in updates || 'width_ft' in updates) && !('area_sqft' in updates)) {
    const newLength = updates.length_ft ?? existing.length_ft;
    const newWidth = updates.width_ft ?? existing.width_ft;
    if (newLength != null && newWidth != null) {
      updates.area_sqft = Math.round(newLength * newWidth * 100) / 100;
    }
  }

  const allowed = [
    'area_name', 'area_type', 'level', 'length_ft', 'width_ft',
    'area_sqft', 'ceiling_height_ft', 'shape', 'dimensions_json', 'notes',
  ];

  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (key in updates) {
      sets.push(`${key} = ?`);
      vals.push(key === 'dimensions_json' ? toJSON(updates[key]) : updates[key]);
    }
  }

  if (sets.length === 0) return { ok: true };
  vals.push(id);

  dbRun(`UPDATE inspection_measurements SET ${sets.join(', ')} WHERE id = ?`, vals);

  log.info('measurement:updated', { id, fields: Object.keys(updates) });
  return { ok: true };
}

/**
 * Delete a measurement record.
 *
 * @param {string} id
 * @returns {{ ok: boolean } | { error: string }}
 */
export function deleteMeasurement(id) {
  if (!id) return { error: 'id is required' };

  const existing = dbGet('SELECT * FROM inspection_measurements WHERE id = ?', [id]);
  if (!existing) return { error: `Measurement ${id} not found` };

  dbRun('DELETE FROM inspection_measurements WHERE id = ?', [id]);

  // Update measurements_complete count
  const count = dbGet(
    'SELECT COUNT(*) AS n FROM inspection_measurements WHERE inspection_id = ?',
    [existing.inspection_id]
  );
  const ts = now();
  dbRun('UPDATE inspections SET measurements_complete = ?, updated_at = ? WHERE id = ?', [
    count?.n ?? 0, ts, existing.inspection_id,
  ]);

  log.info('measurement:deleted', { id, inspectionId: existing.inspection_id });
  return { ok: true };
}

// ── Calculations ──────────────────────────────────────────────────────────────

/**
 * Calculate Gross Living Area (GLA) from above-grade rooms.
 * GLA excludes basement, garage, and accessory areas.
 *
 * @param {string} inspectionId
 * @returns {{ gla: number, byLevel: Object[] }}
 */
export function calculateGLA(inspectionId) {
  if (!inspectionId) return { gla: 0, byLevel: [] };

  // GLA = above-grade living area (excludes basement, garage, accessory)
  const excludedTypes = ['garage', 'basement', 'accessory'];
  const excludedLevels = ['basement'];

  const rows = dbAll(
    `SELECT level, area_type, area_sqft
     FROM inspection_measurements
     WHERE inspection_id = ?
     ORDER BY level`,
    [inspectionId]
  );

  let totalGLA = 0;
  const byLevel = {};

  for (const row of rows) {
    // Skip excluded types and levels
    if (excludedTypes.includes(row.area_type)) continue;
    if (excludedLevels.includes(row.level)) continue;

    const sqft = row.area_sqft || 0;
    totalGLA += sqft;

    const lvl = row.level || 'unknown';
    if (!byLevel[lvl]) byLevel[lvl] = 0;
    byLevel[lvl] += sqft;
  }

  const levelBreakdown = Object.entries(byLevel).map(([level, sqft]) => ({
    level,
    sqft: Math.round(sqft * 100) / 100,
  }));

  return {
    gla: Math.round(totalGLA * 100) / 100,
    byLevel: levelBreakdown,
  };
}

/**
 * Calculate total area including all areas (basement, garage, etc.).
 *
 * @param {string} inspectionId
 * @returns {{ totalArea: number, gla: number, belowGrade: number, garage: number, accessory: number }}
 */
export function calculateTotalArea(inspectionId) {
  if (!inspectionId) return { totalArea: 0, gla: 0, belowGrade: 0, garage: 0, accessory: 0 };

  const rows = dbAll(
    `SELECT area_type, level, area_sqft
     FROM inspection_measurements
     WHERE inspection_id = ?`,
    [inspectionId]
  );

  let totalArea = 0;
  let gla = 0;
  let belowGrade = 0;
  let garage = 0;
  let accessory = 0;

  for (const row of rows) {
    const sqft = row.area_sqft || 0;
    totalArea += sqft;

    if (row.area_type === 'garage') {
      garage += sqft;
    } else if (row.area_type === 'accessory') {
      accessory += sqft;
    } else if (row.area_type === 'basement' || row.level === 'basement') {
      belowGrade += sqft;
    } else {
      gla += sqft;
    }
  }

  return {
    totalArea: Math.round(totalArea * 100) / 100,
    gla: Math.round(gla * 100) / 100,
    belowGrade: Math.round(belowGrade * 100) / 100,
    garage: Math.round(garage * 100) / 100,
    accessory: Math.round(accessory * 100) / 100,
  };
}

/**
 * Get area breakdown by level (main, upper, lower, basement).
 *
 * @param {string} inspectionId
 * @returns {Object[]} — [{ level, roomCount, totalSqft, rooms }]
 */
export function getLevelBreakdown(inspectionId) {
  if (!inspectionId) return [];

  const rows = dbAll(
    `SELECT *
     FROM inspection_measurements
     WHERE inspection_id = ?
     ORDER BY level ASC, area_name ASC`,
    [inspectionId]
  );

  const levels = {};
  for (const row of rows) {
    const lvl = row.level || 'unknown';
    if (!levels[lvl]) {
      levels[lvl] = { level: lvl, roomCount: 0, totalSqft: 0, rooms: [] };
    }
    levels[lvl].roomCount++;
    levels[lvl].totalSqft += row.area_sqft || 0;
    levels[lvl].rooms.push({
      id: row.id,
      areaName: row.area_name,
      areaType: row.area_type,
      lengthFt: row.length_ft,
      widthFt: row.width_ft,
      areaSqft: row.area_sqft,
      ceilingHeightFt: row.ceiling_height_ft,
      shape: row.shape,
    });
  }

  // Round totals
  for (const lvl of Object.values(levels)) {
    lvl.totalSqft = Math.round(lvl.totalSqft * 100) / 100;
  }

  // Return in a sensible level order
  const levelOrder = ['main', 'upper', 'lower', 'basement', 'attic', 'unknown'];
  return levelOrder
    .filter(l => levels[l])
    .map(l => levels[l]);
}

/**
 * Structured export for 1004 form sketch/area sections.
 *
 * @param {string} inspectionId
 * @returns {Object}
 */
export function exportMeasurements(inspectionId) {
  if (!inspectionId) return { error: 'inspectionId is required' };

  const glaResult = calculateGLA(inspectionId);
  const totalResult = calculateTotalArea(inspectionId);
  const levelBreakdown = getLevelBreakdown(inspectionId);
  const allMeasurements = listMeasurements(inspectionId);

  return {
    gla: glaResult.gla,
    glaBylevel: glaResult.byLevel,
    totalArea: totalResult.totalArea,
    belowGrade: totalResult.belowGrade,
    garage: totalResult.garage,
    accessory: totalResult.accessory,
    levelBreakdown,
    measurements: allMeasurements,
    roomCount: allMeasurements.length,
  };
}

export default {
  addMeasurement,
  getMeasurement,
  listMeasurements,
  updateMeasurement,
  deleteMeasurement,
  calculateGLA,
  calculateTotalArea,
  getLevelBreakdown,
  exportMeasurements,
};
