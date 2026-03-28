/**
 * server/inspection/photoService.js
 * ------------------------------------
 * Phase 13 — Inspection Photo Management Service
 *
 * CRUD and organization for inspection photos.
 * All functions are synchronous (better-sqlite3).
 *
 * Functions:
 *   addPhoto(inspectionId, caseId, data)
 *   getPhoto(id)
 *   listPhotos(inspectionId, opts)
 *   listPhotosByCase(caseId)
 *   updatePhoto(id, updates)
 *   deletePhoto(id)
 *   reorderPhotos(inspectionId, category, orderedIds)
 *   setPrimaryPhoto(id)
 *   getPhotosByCategory(inspectionId)
 *   getPhotoManifest(caseId)
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun, dbTransaction } from '../db/database.js';
import log from '../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() {
  return 'phot_' + randomUUID().slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Add a photo record to an inspection.
 *
 * @param {string} inspectionId
 * @param {string} caseId
 * @param {Object} data
 * @returns {{ id: string } | { error: string }}
 */
export function addPhoto(inspectionId, caseId, data = {}) {
  if (!inspectionId) return { error: 'inspectionId is required' };
  if (!caseId) return { error: 'caseId is required' };
  if (!data.photo_category) return { error: 'photo_category is required' };

  const id = genId();
  const ts = now();

  dbRun(`
    INSERT INTO inspection_photos (
      id, inspection_id, case_id, photo_category,
      label, file_path, file_name, mime_type, file_size,
      capture_date, gps_lat, gps_lon,
      sort_order, notes, is_primary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, inspectionId, caseId, data.photo_category,
    data.label || null,
    data.file_path || null,
    data.file_name || null,
    data.mime_type || null,
    data.file_size || null,
    data.capture_date || null,
    data.gps_lat ?? null,
    data.gps_lon ?? null,
    data.sort_order ?? 0,
    data.notes || null,
    data.is_primary ? 1 : 0,
    ts,
  ]);

  // Update photos_count on the inspection
  const count = dbGet(
    'SELECT COUNT(*) AS n FROM inspection_photos WHERE inspection_id = ?',
    [inspectionId]
  );
  dbRun('UPDATE inspections SET photos_count = ?, updated_at = ? WHERE id = ?', [
    count?.n ?? 0, ts, inspectionId,
  ]);

  log.info('photo:added', { id, inspectionId, caseId, category: data.photo_category });
  return { id };
}

/**
 * Get a single photo by ID.
 *
 * @param {string} id
 * @returns {Object|null}
 */
export function getPhoto(id) {
  if (!id) return null;
  return dbGet('SELECT * FROM inspection_photos WHERE id = ?', [id]) || null;
}

/**
 * List photos for an inspection, optionally filtered by category.
 *
 * @param {string} inspectionId
 * @param {Object} [opts={}]
 * @param {string} [opts.category]
 * @returns {Object[]}
 */
export function listPhotos(inspectionId, opts = {}) {
  if (!inspectionId) return [];

  if (opts.category) {
    return dbAll(
      `SELECT * FROM inspection_photos
       WHERE inspection_id = ? AND photo_category = ?
       ORDER BY sort_order ASC, created_at ASC`,
      [inspectionId, opts.category]
    );
  }

  return dbAll(
    `SELECT * FROM inspection_photos
     WHERE inspection_id = ?
     ORDER BY photo_category ASC, sort_order ASC, created_at ASC`,
    [inspectionId]
  );
}

/**
 * List all photos for a case across all inspections.
 *
 * @param {string} caseId
 * @returns {Object[]}
 */
export function listPhotosByCase(caseId) {
  if (!caseId) return [];

  return dbAll(
    `SELECT * FROM inspection_photos
     WHERE case_id = ?
     ORDER BY inspection_id, photo_category ASC, sort_order ASC, created_at ASC`,
    [caseId]
  );
}

/**
 * Update photo metadata.
 *
 * @param {string} id
 * @param {Object} updates
 * @returns {{ ok: boolean } | { error: string }}
 */
export function updatePhoto(id, updates = {}) {
  if (!id) return { error: 'id is required' };

  const existing = dbGet('SELECT * FROM inspection_photos WHERE id = ?', [id]);
  if (!existing) return { error: `Photo ${id} not found` };

  const allowed = [
    'photo_category', 'label', 'file_path', 'file_name', 'mime_type',
    'file_size', 'capture_date', 'gps_lat', 'gps_lon',
    'sort_order', 'notes', 'is_primary',
  ];

  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (key in updates) {
      sets.push(`${key} = ?`);
      vals.push(updates[key]);
    }
  }

  if (sets.length === 0) return { ok: true };
  vals.push(id);

  dbRun(`UPDATE inspection_photos SET ${sets.join(', ')} WHERE id = ?`, vals);

  log.info('photo:updated', { id, fields: Object.keys(updates) });
  return { ok: true };
}

/**
 * Delete a photo record.
 *
 * @param {string} id
 * @returns {{ ok: boolean } | { error: string }}
 */
export function deletePhoto(id) {
  if (!id) return { error: 'id is required' };

  const existing = dbGet('SELECT * FROM inspection_photos WHERE id = ?', [id]);
  if (!existing) return { error: `Photo ${id} not found` };

  dbRun('DELETE FROM inspection_photos WHERE id = ?', [id]);

  // Update photos_count on the inspection
  const count = dbGet(
    'SELECT COUNT(*) AS n FROM inspection_photos WHERE inspection_id = ?',
    [existing.inspection_id]
  );
  const ts = now();
  dbRun('UPDATE inspections SET photos_count = ?, updated_at = ? WHERE id = ?', [
    count?.n ?? 0, ts, existing.inspection_id,
  ]);

  log.info('photo:deleted', { id, inspectionId: existing.inspection_id });
  return { ok: true };
}

/**
 * Reorder photos within a category by setting sort_order.
 *
 * @param {string} inspectionId
 * @param {string} category
 * @param {string[]} orderedIds — array of photo IDs in desired order
 * @returns {{ ok: boolean } | { error: string }}
 */
export function reorderPhotos(inspectionId, category, orderedIds) {
  if (!inspectionId) return { error: 'inspectionId is required' };
  if (!category) return { error: 'category is required' };
  if (!Array.isArray(orderedIds)) return { error: 'orderedIds must be an array' };

  dbTransaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      dbRun(
        `UPDATE inspection_photos SET sort_order = ?
         WHERE id = ? AND inspection_id = ? AND photo_category = ?`,
        [i, orderedIds[i], inspectionId, category]
      );
    }
  });

  log.info('photo:reordered', { inspectionId, category, count: orderedIds.length });
  return { ok: true };
}

/**
 * Set a photo as the primary photo for its category.
 * Unsets any previous primary in the same category/inspection.
 *
 * @param {string} id
 * @returns {{ ok: boolean } | { error: string }}
 */
export function setPrimaryPhoto(id) {
  if (!id) return { error: 'id is required' };

  const photo = dbGet('SELECT * FROM inspection_photos WHERE id = ?', [id]);
  if (!photo) return { error: `Photo ${id} not found` };

  dbTransaction(() => {
    // Unset previous primary for this category in this inspection
    dbRun(
      `UPDATE inspection_photos SET is_primary = 0
       WHERE inspection_id = ? AND photo_category = ? AND is_primary = 1`,
      [photo.inspection_id, photo.photo_category]
    );

    // Set new primary
    dbRun('UPDATE inspection_photos SET is_primary = 1 WHERE id = ?', [id]);
  });

  log.info('photo:set-primary', { id, inspectionId: photo.inspection_id, category: photo.photo_category });
  return { ok: true };
}

/**
 * Get photos grouped by category with counts.
 *
 * @param {string} inspectionId
 * @returns {Object} — { [category]: { count, photos, primary } }
 */
export function getPhotosByCategory(inspectionId) {
  if (!inspectionId) return {};

  const photos = dbAll(
    `SELECT * FROM inspection_photos
     WHERE inspection_id = ?
     ORDER BY photo_category ASC, sort_order ASC, created_at ASC`,
    [inspectionId]
  );

  const grouped = {};
  for (const photo of photos) {
    const cat = photo.photo_category;
    if (!grouped[cat]) {
      grouped[cat] = { count: 0, photos: [], primary: null };
    }
    grouped[cat].count++;
    grouped[cat].photos.push(photo);
    if (photo.is_primary) {
      grouped[cat].primary = photo;
    }
  }

  return grouped;
}

/**
 * Build a structured photo manifest for 1004 form photo pages.
 * Selects primary photos for front, rear, street and interior selections.
 *
 * @param {string} caseId
 * @returns {Object}
 */
export function getPhotoManifest(caseId) {
  if (!caseId) return { error: 'caseId is required' };

  const allPhotos = listPhotosByCase(caseId);

  // Group by category
  const byCategory = {};
  for (const photo of allPhotos) {
    const cat = photo.photo_category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(photo);
  }

  // Select primary or first photo for each required category
  function pickPrimary(category) {
    const photos = byCategory[category] || [];
    const primary = photos.find(p => p.is_primary);
    return primary || photos[0] || null;
  }

  // Interior categories for photo pages
  const interiorCategories = [
    'kitchen', 'bathroom', 'bedroom', 'living_room',
    'dining_room', 'basement', 'attic', 'garage',
  ];

  const interiorSelections = {};
  for (const cat of interiorCategories) {
    const photo = pickPrimary(cat);
    if (photo) interiorSelections[cat] = photo;
  }

  return {
    front: pickPrimary('front'),
    rear: pickPrimary('rear'),
    street: pickPrimary('street'),
    interior: interiorSelections,
    damage: byCategory['damage'] || [],
    comparable: byCategory['comparable'] || [],
    other: byCategory['other'] || [],
    totalPhotos: allPhotos.length,
    categoryCount: Object.keys(byCategory).length,
  };
}

export default {
  addPhoto,
  getPhoto,
  listPhotos,
  listPhotosByCase,
  updatePhoto,
  deletePhoto,
  reorderPhotos,
  setPrimaryPhoto,
  getPhotosByCategory,
  getPhotoManifest,
};
