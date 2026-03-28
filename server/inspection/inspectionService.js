/**
 * server/inspection/inspectionService.js
 * -----------------------------------------
 * Phase 13 — Inspection Management Service
 *
 * CRUD and lifecycle operations for property inspections.
 * All functions are synchronous (better-sqlite3).
 *
 * Functions:
 *   createInspection(caseId, data)
 *   getInspection(id)
 *   listInspections(caseId)
 *   updateInspection(id, updates)
 *   startInspection(id)
 *   completeInspection(id, summary)
 *   cancelInspection(id, reason)
 *   rescheduleInspection(id, newDate, newTime)
 *   getInspectionSummary(inspectionId)
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun } from '../db/database.js';
import { emitCaseEvent } from '../operations/auditLogger.js';
import log from '../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() {
  return 'insp_' + randomUUID().slice(0, 12);
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

function now() {
  return new Date().toISOString();
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Create a new inspection for a case.
 *
 * @param {string} caseId
 * @param {Object} data
 * @returns {{ id: string, caseId: string }}
 */
export function createInspection(caseId, data = {}) {
  if (!caseId) return { error: 'caseId is required' };
  if (!data.inspection_type) return { error: 'inspection_type is required' };

  const id = genId();
  const ts = now();

  dbRun(`
    INSERT INTO inspections (
      id, case_id, inspection_type, inspection_status,
      scheduled_date, scheduled_time, actual_date,
      inspector_name, access_instructions,
      contact_name, contact_phone,
      weather_conditions, notes,
      duration_minutes, photos_count, measurements_complete,
      checklist_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, caseId, data.inspection_type,
    data.inspection_status || 'scheduled',
    data.scheduled_date || null,
    data.scheduled_time || null,
    data.actual_date || null,
    data.inspector_name || null,
    data.access_instructions || null,
    data.contact_name || null,
    data.contact_phone || null,
    data.weather_conditions || null,
    data.notes || null,
    data.duration_minutes || null,
    0, 0,
    toJSON(data.checklist_json) || null,
    ts, ts,
  ]);

  emitCaseEvent(caseId, 'inspection.created', `Inspection scheduled: ${data.inspection_type}`, {
    inspectionId: id,
    inspectionType: data.inspection_type,
    scheduledDate: data.scheduled_date,
  });

  log.info('inspection:created', { id, caseId, type: data.inspection_type });
  return { id, caseId };
}

/**
 * Get a single inspection with photo/measurement/condition counts.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getInspection(id) {
  if (!id) return null;

  const row = dbGet('SELECT * FROM inspections WHERE id = ?', [id]);
  if (!row) return null;

  const photosCount = dbGet(
    'SELECT COUNT(*) AS n FROM inspection_photos WHERE inspection_id = ?', [id]
  );
  const measurementsCount = dbGet(
    'SELECT COUNT(*) AS n FROM inspection_measurements WHERE inspection_id = ?', [id]
  );
  const conditionsCount = dbGet(
    'SELECT COUNT(*) AS n FROM inspection_conditions WHERE inspection_id = ?', [id]
  );

  return {
    ...row,
    checklist_json: parseJSON(row.checklist_json, []),
    _counts: {
      photos: photosCount?.n ?? 0,
      measurements: measurementsCount?.n ?? 0,
      conditions: conditionsCount?.n ?? 0,
    },
  };
}

/**
 * List all inspections for a case.
 *
 * @param {string} caseId
 * @returns {Object[]}
 */
export function listInspections(caseId) {
  if (!caseId) return [];

  const rows = dbAll(
    'SELECT * FROM inspections WHERE case_id = ? ORDER BY created_at DESC',
    [caseId]
  );

  return rows.map(row => ({
    ...row,
    checklist_json: parseJSON(row.checklist_json, []),
  }));
}

/**
 * Update inspection fields.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {{ ok: boolean } | { error: string }}
 */
export function updateInspection(id, updates = {}) {
  if (!id) return { error: 'id is required' };

  const existing = dbGet('SELECT * FROM inspections WHERE id = ?', [id]);
  if (!existing) return { error: `Inspection ${id} not found` };

  const allowed = [
    'inspection_type', 'inspection_status', 'scheduled_date', 'scheduled_time',
    'actual_date', 'inspector_name', 'access_instructions',
    'contact_name', 'contact_phone', 'weather_conditions', 'notes',
    'duration_minutes', 'photos_count', 'measurements_complete', 'checklist_json',
  ];

  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (key in updates) {
      sets.push(`${key} = ?`);
      vals.push(key === 'checklist_json' ? toJSON(updates[key]) : updates[key]);
    }
  }

  if (sets.length === 0) return { ok: true };

  sets.push('updated_at = ?');
  vals.push(now());
  vals.push(id);

  dbRun(`UPDATE inspections SET ${sets.join(', ')} WHERE id = ?`, vals);

  log.info('inspection:updated', { id, fields: Object.keys(updates) });
  return { ok: true };
}

/**
 * Mark inspection as in_progress and set actual_date.
 *
 * @param {string} id
 * @returns {{ ok: boolean } | { error: string }}
 */
export function startInspection(id) {
  if (!id) return { error: 'id is required' };

  const existing = dbGet('SELECT * FROM inspections WHERE id = ?', [id]);
  if (!existing) return { error: `Inspection ${id} not found` };
  if (existing.inspection_status === 'completed') {
    return { error: 'Inspection is already completed' };
  }
  if (existing.inspection_status === 'cancelled') {
    return { error: 'Inspection is cancelled' };
  }

  const ts = now();
  const actualDate = ts.split('T')[0];

  dbRun(`
    UPDATE inspections
    SET inspection_status = 'in_progress', actual_date = ?, updated_at = ?
    WHERE id = ?
  `, [actualDate, ts, id]);

  emitCaseEvent(existing.case_id, 'inspection.started', `Inspection started: ${existing.inspection_type}`, {
    inspectionId: id,
  });

  log.info('inspection:started', { id, caseId: existing.case_id });
  return { ok: true };
}

/**
 * Mark inspection as completed with optional summary data.
 *
 * @param {string} id
 * @param {Object} [summary={}]
 * @returns {{ ok: boolean } | { error: string }}
 */
export function completeInspection(id, summary = {}) {
  if (!id) return { error: 'id is required' };

  const existing = dbGet('SELECT * FROM inspections WHERE id = ?', [id]);
  if (!existing) return { error: `Inspection ${id} not found` };
  if (existing.inspection_status === 'completed') {
    return { error: 'Inspection is already completed' };
  }

  const ts = now();

  // Count related records
  const photosCount = dbGet(
    'SELECT COUNT(*) AS n FROM inspection_photos WHERE inspection_id = ?', [id]
  );
  const measurementsCount = dbGet(
    'SELECT COUNT(*) AS n FROM inspection_measurements WHERE inspection_id = ?', [id]
  );

  dbRun(`
    UPDATE inspections
    SET inspection_status = 'completed',
        duration_minutes = ?,
        weather_conditions = COALESCE(?, weather_conditions),
        notes = COALESCE(?, notes),
        photos_count = ?,
        measurements_complete = ?,
        updated_at = ?
    WHERE id = ?
  `, [
    summary.duration_minutes || existing.duration_minutes || null,
    summary.weather_conditions || null,
    summary.notes || null,
    photosCount?.n ?? 0,
    measurementsCount?.n ?? 0,
    ts,
    id,
  ]);

  emitCaseEvent(existing.case_id, 'inspection.completed', `Inspection completed: ${existing.inspection_type}`, {
    inspectionId: id,
    photosCount: photosCount?.n ?? 0,
    measurementsCount: measurementsCount?.n ?? 0,
    durationMinutes: summary.duration_minutes,
  });

  log.info('inspection:completed', { id, caseId: existing.case_id });
  return { ok: true };
}

/**
 * Cancel an inspection with a reason.
 *
 * @param {string} id
 * @param {string} [reason]
 * @returns {{ ok: boolean } | { error: string }}
 */
export function cancelInspection(id, reason) {
  if (!id) return { error: 'id is required' };

  const existing = dbGet('SELECT * FROM inspections WHERE id = ?', [id]);
  if (!existing) return { error: `Inspection ${id} not found` };
  if (existing.inspection_status === 'completed') {
    return { error: 'Cannot cancel a completed inspection' };
  }

  const ts = now();
  const notes = reason
    ? `${existing.notes ? existing.notes + '\n' : ''}Cancelled: ${reason}`
    : existing.notes;

  dbRun(`
    UPDATE inspections
    SET inspection_status = 'cancelled', notes = ?, updated_at = ?
    WHERE id = ?
  `, [notes, ts, id]);

  emitCaseEvent(existing.case_id, 'inspection.cancelled', `Inspection cancelled: ${existing.inspection_type}`, {
    inspectionId: id,
    reason,
  });

  log.info('inspection:cancelled', { id, caseId: existing.case_id, reason });
  return { ok: true };
}

/**
 * Reschedule an inspection with new date/time.
 *
 * @param {string} id
 * @param {string} newDate
 * @param {string} [newTime]
 * @returns {{ ok: boolean } | { error: string }}
 */
export function rescheduleInspection(id, newDate, newTime) {
  if (!id) return { error: 'id is required' };
  if (!newDate) return { error: 'newDate is required' };

  const existing = dbGet('SELECT * FROM inspections WHERE id = ?', [id]);
  if (!existing) return { error: `Inspection ${id} not found` };
  if (existing.inspection_status === 'completed') {
    return { error: 'Cannot reschedule a completed inspection' };
  }

  const ts = now();

  dbRun(`
    UPDATE inspections
    SET inspection_status = 'rescheduled',
        scheduled_date = ?,
        scheduled_time = ?,
        updated_at = ?
    WHERE id = ?
  `, [newDate, newTime || null, ts, id]);

  emitCaseEvent(existing.case_id, 'inspection.rescheduled', `Inspection rescheduled to ${newDate}`, {
    inspectionId: id,
    previousDate: existing.scheduled_date,
    newDate,
    newTime,
  });

  log.info('inspection:rescheduled', { id, caseId: existing.case_id, newDate });
  return { ok: true };
}

/**
 * Get a full inspection summary with photos, measurements, conditions counts
 * and completion status.
 *
 * @param {string} inspectionId
 * @returns {Object|null}
 */
export function getInspectionSummary(inspectionId) {
  if (!inspectionId) return null;

  const inspection = getInspection(inspectionId);
  if (!inspection) return null;

  // Photo counts by category
  const photosByCategory = dbAll(`
    SELECT photo_category, COUNT(*) AS count
    FROM inspection_photos
    WHERE inspection_id = ?
    GROUP BY photo_category
    ORDER BY photo_category
  `, [inspectionId]);

  // Measurement counts by level
  const measurementsByLevel = dbAll(`
    SELECT level, COUNT(*) AS count, SUM(area_sqft) AS total_sqft
    FROM inspection_measurements
    WHERE inspection_id = ?
    GROUP BY level
    ORDER BY level
  `, [inspectionId]);

  // Condition counts by rating
  const conditionsByRating = dbAll(`
    SELECT condition_rating, COUNT(*) AS count
    FROM inspection_conditions
    WHERE inspection_id = ?
    GROUP BY condition_rating
    ORDER BY condition_rating
  `, [inspectionId]);

  // Repair items
  const repairsNeeded = dbGet(`
    SELECT COUNT(*) AS count, SUM(estimated_repair_cost) AS total_cost
    FROM inspection_conditions
    WHERE inspection_id = ? AND repair_needed = 1
  `, [inspectionId]);

  // Completion checklist
  const requiredPhotos = ['front', 'rear', 'street'];
  const existingCategories = photosByCategory.map(r => r.photo_category);
  const missingPhotos = requiredPhotos.filter(p => !existingCategories.includes(p));

  const hasMeasurements = inspection._counts.measurements > 0;
  const hasConditions = inspection._counts.conditions > 0;

  return {
    inspection,
    photos: {
      total: inspection._counts.photos,
      byCategory: photosByCategory,
    },
    measurements: {
      total: inspection._counts.measurements,
      byLevel: measurementsByLevel,
    },
    conditions: {
      total: inspection._counts.conditions,
      byRating: conditionsByRating,
      repairsNeeded: repairsNeeded?.count ?? 0,
      totalRepairCost: repairsNeeded?.total_cost ?? 0,
    },
    completion: {
      hasRequiredPhotos: missingPhotos.length === 0,
      missingPhotos,
      hasMeasurements,
      hasConditions,
      isComplete: missingPhotos.length === 0 && hasMeasurements && hasConditions,
    },
  };
}

export default {
  createInspection,
  getInspection,
  listInspections,
  updateInspection,
  startInspection,
  completeInspection,
  cancelInspection,
  rescheduleInspection,
  getInspectionSummary,
};
