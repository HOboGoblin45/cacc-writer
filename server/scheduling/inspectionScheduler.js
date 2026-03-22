/**
 * server/scheduling/inspectionScheduler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Inspection scheduling and route optimization.
 *
 * An appraiser's day is: drive to property → inspect → drive home → write.
 * This module optimizes the driving part:
 *   - Schedules inspections based on due dates and geography
 *   - Groups nearby properties for same-day inspection
 *   - Estimates drive times between stops
 *   - Generates an optimized daily route
 *   - Tracks inspection status and notes
 *
 * Integrates with the case pipeline — after inspection,
 * auto-triggers photo upload and generation.
 */

import { getDb } from '../db/database.js';
import { geocodeAddress, distanceMiles } from '../geocoder.js';
import log from '../logger.js';
import crypto from 'crypto';

export function ensureSchedulingSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS inspections (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id         TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      scheduled_date  TEXT,
      scheduled_time  TEXT,
      status          TEXT DEFAULT 'pending',
      inspection_type TEXT DEFAULT 'interior',
      address         TEXT,
      city            TEXT,
      state           TEXT,
      zip             TEXT,
      latitude        REAL,
      longitude       REAL,
      contact_name    TEXT,
      contact_phone   TEXT,
      access_notes    TEXT,
      duration_minutes INTEGER DEFAULT 45,
      drive_minutes   INTEGER,
      notes           TEXT,
      completed_at    TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_inspections_user_date ON inspections(user_id, scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_inspections_case ON inspections(case_id);
  `);
}

/**
 * Schedule an inspection for a case.
 */
export function scheduleInspection(userId, caseId, details) {
  const db = getDb();
  const id = crypto.randomBytes(8).toString('hex');

  // Pull address from case if not provided
  let address = details.address;
  let city = details.city;
  let state = details.state;
  let zip = details.zip;

  if (!address) {
    try {
      const caseFacts = db.prepare('SELECT facts_json FROM case_facts WHERE case_id = ?').get(caseId);
      const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};
      address = facts.subject?.address || facts.subject?.streetAddress;
      city = facts.subject?.city;
      state = facts.subject?.state;
      zip = facts.subject?.zip || facts.subject?.zipCode;
    } catch { /* ok */ }
  }

  db.prepare(`
    INSERT INTO inspections (id, case_id, user_id, scheduled_date, scheduled_time,
      inspection_type, address, city, state, zip, latitude, longitude,
      contact_name, contact_phone, access_notes, duration_minutes, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, caseId, userId,
    details.date || null, details.time || null,
    details.type || 'interior',
    address, city, state, zip,
    details.latitude || null, details.longitude || null,
    details.contactName || null, details.contactPhone || null,
    details.accessNotes || null, details.durationMinutes || 45,
    details.notes || null
  );

  log.info('inspection:scheduled', { userId, caseId, date: details.date, address });
  return { inspectionId: id, address, date: details.date };
}

/**
 * Get inspections for a user on a specific date.
 */
export function getDaySchedule(userId, date) {
  const db = getDb();
  return db.prepare(`
    SELECT i.*, r.form_type, r.case_status
    FROM inspections i
    LEFT JOIN case_records r ON r.case_id = i.case_id
    WHERE i.user_id = ? AND i.scheduled_date = ?
    ORDER BY i.scheduled_time
  `).all(userId, date);
}

/**
 * Get upcoming inspections for a user.
 */
export function getUpcomingInspections(userId, days = 7) {
  const db = getDb();
  return db.prepare(`
    SELECT i.*, r.form_type
    FROM inspections i
    LEFT JOIN case_records r ON r.case_id = i.case_id
    WHERE i.user_id = ? AND i.status = 'pending'
      AND i.scheduled_date >= date('now')
      AND i.scheduled_date <= date('now', '+' || ? || ' days')
    ORDER BY i.scheduled_date, i.scheduled_time
  `).all(userId, days);
}

/**
 * Suggest optimal inspection grouping for unscheduled cases.
 * Groups properties that are near each other for same-day visits.
 *
 * @param {string} userId
 * @returns {Array} suggested day groups
 */
export async function suggestInspectionGroups(userId) {
  const db = getDb();

  // Get unscheduled cases with addresses
  const unscheduled = db.prepare(`
    SELECT r.case_id, r.form_type,
           json_extract(f.facts_json, '$.subject.address') as address,
           json_extract(f.facts_json, '$.subject.city') as city,
           json_extract(f.facts_json, '$.subject.state') as state,
           json_extract(f.facts_json, '$.subject.zip') as zip,
           json_extract(f.facts_json, '$.order.dueDate') as due_date
    FROM case_records r
    JOIN case_facts f ON f.case_id = r.case_id
    LEFT JOIN inspections i ON i.case_id = r.case_id
    WHERE r.case_status IN ('draft', 'received', 'pipeline')
      AND i.id IS NULL
      AND json_extract(f.facts_json, '$.subject.address') IS NOT NULL
    ORDER BY json_extract(f.facts_json, '$.order.dueDate')
  `).all();

  if (unscheduled.length === 0) return [];

  // Geocode all addresses
  const geocoded = [];
  for (const c of unscheduled) {
    try {
      const fullAddr = `${c.address}, ${c.city || ''}, ${c.state || ''} ${c.zip || ''}`;
      const geo = await geocodeAddress(fullAddr);
      if (geo) {
        geocoded.push({ ...c, lat: geo.lat, lon: geo.lon });
      } else {
        geocoded.push({ ...c, lat: null, lon: null });
      }
    } catch {
      geocoded.push({ ...c, lat: null, lon: null });
    }
  }

  // Simple clustering: group properties within 10 miles of each other
  const groups = [];
  const assigned = new Set();

  for (let i = 0; i < geocoded.length; i++) {
    if (assigned.has(i)) continue;
    if (!geocoded[i].lat) {
      groups.push({ properties: [geocoded[i]], estimatedDriveMinutes: 0 });
      assigned.add(i);
      continue;
    }

    const group = [geocoded[i]];
    assigned.add(i);

    for (let j = i + 1; j < geocoded.length; j++) {
      if (assigned.has(j) || !geocoded[j].lat) continue;

      const dist = distanceMiles(
        geocoded[i].lat, geocoded[i].lon,
        geocoded[j].lat, geocoded[j].lon
      );

      if (dist <= 10) {
        group.push(geocoded[j]);
        assigned.add(j);
      }
    }

    // Estimate total drive time (rough: 2 min/mile between stops)
    let totalDrive = 0;
    for (let k = 1; k < group.length; k++) {
      if (group[k].lat && group[k - 1].lat) {
        totalDrive += distanceMiles(group[k - 1].lat, group[k - 1].lon, group[k].lat, group[k].lon) * 2;
      }
    }

    groups.push({
      properties: group,
      count: group.length,
      estimatedDriveMinutes: Math.round(totalDrive),
      estimatedTotalMinutes: Math.round(totalDrive + group.length * 45), // 45 min per inspection
    });
  }

  return groups;
}

/**
 * Complete an inspection.
 */
export function completeInspection(inspectionId, { notes, photos }) {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE inspections SET status = 'completed', notes = COALESCE(?, notes),
      completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(notes || null, now, now, inspectionId);

  return { completed: true };
}

export default {
  ensureSchedulingSchema, scheduleInspection, getDaySchedule,
  getUpcomingInspections, suggestInspectionGroups, completeInspection,
};
