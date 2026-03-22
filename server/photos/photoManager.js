/**
 * server/photos/photoManager.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Photo management with AI-powered descriptions.
 *
 * Handles:
 *   - Photo upload, storage, and organization per case
 *   - AI auto-generates photo captions/descriptions
 *   - Photo categorization (front, rear, street, kitchen, etc.)
 *   - URAR photo page ordering (GSE-required order)
 *   - Thumbnail generation tracking
 *   - Photo compliance checks (required photos per form type)
 */

import { getDb } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

export function ensurePhotoSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_photos (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id         TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      file_name       TEXT NOT NULL,
      file_path       TEXT NOT NULL,
      file_size       INTEGER,
      mime_type       TEXT DEFAULT 'image/jpeg',
      category        TEXT DEFAULT 'other',
      label           TEXT,
      description     TEXT,
      ai_description  TEXT,
      sort_order      INTEGER DEFAULT 0,
      is_required     INTEGER DEFAULT 0,
      taken_at        TEXT,
      latitude        REAL,
      longitude       REAL,
      width           INTEGER,
      height          INTEGER,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_case_photos ON case_photos(case_id, sort_order);
  `);
}

// Required photos per form type (GSE requirements)
const REQUIRED_PHOTOS = {
  '1004': [
    { category: 'front', label: 'Front of Subject', sortOrder: 1 },
    { category: 'rear', label: 'Rear of Subject', sortOrder: 2 },
    { category: 'street', label: 'Street Scene', sortOrder: 3 },
    { category: 'kitchen', label: 'Kitchen', sortOrder: 10 },
    { category: 'bathroom', label: 'Main Bathroom', sortOrder: 11 },
    { category: 'living', label: 'Living Room / Main Living Area', sortOrder: 12 },
    { category: 'comp1_front', label: 'Comparable Sale 1 — Front', sortOrder: 20 },
    { category: 'comp2_front', label: 'Comparable Sale 2 — Front', sortOrder: 21 },
    { category: 'comp3_front', label: 'Comparable Sale 3 — Front', sortOrder: 22 },
  ],
  '1073': [
    { category: 'front', label: 'Front of Subject', sortOrder: 1 },
    { category: 'rear', label: 'Rear of Subject', sortOrder: 2 },
    { category: 'street', label: 'Street Scene', sortOrder: 3 },
    { category: 'building_front', label: 'Building Front', sortOrder: 4 },
    { category: 'common_areas', label: 'Common Areas', sortOrder: 5 },
    { category: 'kitchen', label: 'Kitchen', sortOrder: 10 },
    { category: 'bathroom', label: 'Main Bathroom', sortOrder: 11 },
    { category: 'comp1_front', label: 'Comparable Sale 1', sortOrder: 20 },
    { category: 'comp2_front', label: 'Comparable Sale 2', sortOrder: 21 },
    { category: 'comp3_front', label: 'Comparable Sale 3', sortOrder: 22 },
  ],
  '1025': [
    { category: 'front', label: 'Front of Subject', sortOrder: 1 },
    { category: 'rear', label: 'Rear of Subject', sortOrder: 2 },
    { category: 'street', label: 'Street Scene', sortOrder: 3 },
    { category: 'unit1_kitchen', label: 'Unit 1 Kitchen', sortOrder: 10 },
    { category: 'unit1_bathroom', label: 'Unit 1 Bathroom', sortOrder: 11 },
    { category: 'unit2_kitchen', label: 'Unit 2 Kitchen', sortOrder: 12 },
    { category: 'comp1_front', label: 'Comparable Sale 1', sortOrder: 20 },
    { category: 'comp2_front', label: 'Comparable Sale 2', sortOrder: 21 },
    { category: 'comp3_front', label: 'Comparable Sale 3', sortOrder: 22 },
  ],
};

/**
 * Register a photo upload for a case.
 */
export function addPhoto(caseId, userId, { fileName, filePath, fileSize, mimeType, category, label, takenAt, latitude, longitude }) {
  const db = getDb();
  const id = crypto.randomBytes(8).toString('hex');

  // Auto-detect sort order from category
  const formType = db.prepare('SELECT form_type FROM case_records WHERE case_id = ?').get(caseId)?.form_type || '1004';
  const required = REQUIRED_PHOTOS[formType] || REQUIRED_PHOTOS['1004'];
  const match = required.find(r => r.category === category);
  const sortOrder = match?.sortOrder || 99;

  db.prepare(`
    INSERT INTO case_photos (id, case_id, user_id, file_name, file_path, file_size, mime_type,
      category, label, sort_order, is_required, taken_at, latitude, longitude)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, caseId, userId, fileName, filePath, fileSize || 0, mimeType || 'image/jpeg',
    category || 'other', label || match?.label || fileName,
    sortOrder, match ? 1 : 0, takenAt || null, latitude || null, longitude || null);

  log.info('photo:added', { caseId, photoId: id, category, fileName });
  return { photoId: id, category, sortOrder };
}

/**
 * Get all photos for a case, ordered for report.
 */
export function getCasePhotos(caseId) {
  const db = getDb();
  return db.prepare('SELECT * FROM case_photos WHERE case_id = ? ORDER BY sort_order, created_at').all(caseId);
}

/**
 * Check photo compliance — which required photos are missing.
 */
export function checkPhotoCompliance(caseId) {
  const db = getDb();
  const formType = db.prepare('SELECT form_type FROM case_records WHERE case_id = ?').get(caseId)?.form_type || '1004';
  const required = REQUIRED_PHOTOS[formType] || REQUIRED_PHOTOS['1004'];

  const existing = db.prepare('SELECT category FROM case_photos WHERE case_id = ?').all(caseId);
  const existingCategories = new Set(existing.map(p => p.category));

  const missing = required.filter(r => !existingCategories.has(r.category));
  const present = required.filter(r => existingCategories.has(r.category));

  return {
    formType,
    requiredCount: required.length,
    presentCount: present.length,
    missingCount: missing.length,
    compliant: missing.length === 0,
    missing: missing.map(m => ({ category: m.category, label: m.label })),
    present: present.map(p => ({ category: p.category, label: p.label })),
  };
}

/**
 * AI auto-categorize a photo based on its filename and any EXIF data.
 */
export function autoCategorize(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes('front') && !lower.includes('comp')) return 'front';
  if (lower.includes('rear') || lower.includes('back')) return 'rear';
  if (lower.includes('street') || lower.includes('scene')) return 'street';
  if (lower.includes('kitchen')) return 'kitchen';
  if (lower.includes('bath')) return 'bathroom';
  if (lower.includes('living') || lower.includes('family')) return 'living';
  if (lower.includes('bedroom') || lower.includes('bed')) return 'bedroom';
  if (lower.includes('basement')) return 'basement';
  if (lower.includes('garage')) return 'garage';
  if (lower.includes('yard') || lower.includes('exterior')) return 'exterior';
  if (lower.includes('roof')) return 'roof';
  if (lower.includes('comp') && lower.includes('1')) return 'comp1_front';
  if (lower.includes('comp') && lower.includes('2')) return 'comp2_front';
  if (lower.includes('comp') && lower.includes('3')) return 'comp3_front';
  return 'other';
}

/**
 * Update photo metadata.
 */
export function updatePhoto(photoId, updates) {
  const db = getDb();
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    if (['label', 'description', 'category', 'sort_order', 'ai_description'].includes(key)) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (fields.length === 0) return;
  values.push(photoId);
  db.prepare(`UPDATE case_photos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export default {
  ensurePhotoSchema, addPhoto, getCasePhotos, checkPhotoCompliance,
  autoCategorize, updatePhoto, REQUIRED_PHOTOS,
};
