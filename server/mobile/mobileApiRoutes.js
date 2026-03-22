/**
 * server/mobile/mobileApiRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Mobile-optimized API for field inspection app.
 *
 * Appraisers do inspections on phones/tablets. This API is designed for:
 *   - Offline-first: sync when back online
 *   - Photo capture with GPS tagging
 *   - Voice-to-text inspection notes
 *   - Room-by-room checklist
 *   - Property measurement entry
 *   - Sketch/floor plan capture
 *   - Quick comp photo capture at drive-bys
 *
 * All data syncs back to the main case when connected.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { dbGet, dbRun, dbAll } from '../db/database.js';
import { getDb } from '../db/database.js';
import { addPhoto, autoCategorize } from '../photos/photoManager.js';
import { upload } from '../utils/middleware.js';
import log from '../logger.js';
import crypto from 'crypto';

const router = Router();

export function ensureMobileSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS inspection_checklists (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      room        TEXT NOT NULL,
      items_json  TEXT DEFAULT '[]',
      notes       TEXT,
      completed   INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_checklist_case ON inspection_checklists(case_id);

    CREATE TABLE IF NOT EXISTS field_measurements (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      area_name   TEXT NOT NULL,
      length_ft   REAL,
      width_ft    REAL,
      area_sqft   REAL,
      floor_level TEXT DEFAULT '1',
      notes       TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_measurements_case ON field_measurements(case_id);

    CREATE TABLE IF NOT EXISTS voice_notes (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id     TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      transcript  TEXT,
      section     TEXT,
      duration_s  INTEGER,
      file_path   TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_voice_notes_case ON voice_notes(case_id);

    CREATE TABLE IF NOT EXISTS offline_sync_queue (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      user_id     TEXT NOT NULL,
      case_id     TEXT,
      action      TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      synced      INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      synced_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_queue ON offline_sync_queue(user_id, synced);
  `);
}

// Standard room checklist template
const ROOM_CHECKLIST = {
  exterior_front: ['Siding condition', 'Windows condition', 'Roof visible condition', 'Gutters/downspouts', 'Foundation visible', 'Landscaping', 'Driveway condition', 'Porch/entry'],
  exterior_rear: ['Siding condition', 'Windows condition', 'Deck/patio', 'Fence', 'Outbuildings', 'Pool/spa', 'Drainage'],
  kitchen: ['Countertops material', 'Cabinets condition', 'Appliances (list)', 'Flooring type', 'Backsplash', 'Island/breakfast bar', 'Lighting', 'Overall condition'],
  living_room: ['Flooring type', 'Fireplace', 'Built-ins', 'Crown molding', 'Windows count', 'Ceiling height', 'Overall condition'],
  master_bedroom: ['Flooring type', 'Closet type', 'Windows count', 'Ceiling fan', 'En-suite bath', 'Overall condition'],
  bathroom: ['Vanity type', 'Tub/shower', 'Tile condition', 'Fixtures quality', 'Ventilation', 'Flooring', 'Overall condition'],
  basement: ['Finished/unfinished', 'Ceiling height', 'Moisture signs', 'Sump pump', 'Egress windows', 'HVAC equipment', 'Water heater'],
  garage: ['Attached/detached', 'Car capacity', 'Door type', 'Floor condition', 'Storage', 'Electrical'],
  mechanical: ['Heating type', 'Cooling type', 'Age of HVAC', 'Water heater type/age', 'Electrical panel amps', 'Plumbing type'],
};

// ── GET /mobile/cases — lightweight case list for mobile ─────────────────────

router.get('/mobile/cases', authMiddleware, (req, res) => {
  try {
    const cases = dbAll(`
      SELECT r.case_id, r.form_type, r.status,
             json_extract(f.facts_json, '$.subject.address') as address,
             json_extract(f.facts_json, '$.subject.city') as city,
             json_extract(f.facts_json, '$.order.dueDate') as due_date
      FROM case_records r
      LEFT JOIN case_facts f ON f.case_id = r.case_id
      WHERE r.status NOT IN ('complete', 'exported', 'delivered', 'cancelled')
      ORDER BY json_extract(f.facts_json, '$.order.dueDate')
      LIMIT 50
    `);
    res.json({ ok: true, cases });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /mobile/cases/:caseId — case summary for mobile ──────────────────────

router.get('/mobile/cases/:caseId', authMiddleware, (req, res) => {
  try {
    const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [req.params.caseId]);
    if (!caseRecord) return res.status(404).json({ ok: false, error: 'Case not found' });

    const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [req.params.caseId]);
    const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

    const photoCount = dbGet('SELECT COUNT(*) as c FROM case_photos WHERE case_id = ?', [req.params.caseId])?.c || 0;
    const measurementCount = dbGet('SELECT COUNT(*) as c FROM field_measurements WHERE case_id = ?', [req.params.caseId])?.c || 0;

    res.json({
      ok: true,
      caseId: caseRecord.case_id,
      formType: caseRecord.form_type,
      status: caseRecord.status,
      subject: facts.subject || {},
      improvements: facts.improvements || {},
      photoCount,
      measurementCount,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Room Checklists ──────────────────────────────────────────────────────────

router.get('/mobile/checklist-template', (_req, res) => {
  res.json({ ok: true, rooms: ROOM_CHECKLIST });
});

router.get('/mobile/cases/:caseId/checklists', authMiddleware, (req, res) => {
  const checklists = dbAll('SELECT * FROM inspection_checklists WHERE case_id = ? ORDER BY room', [req.params.caseId]);
  res.json({ ok: true, checklists: checklists.map(c => ({ ...c, items: JSON.parse(c.items_json || '[]') })) });
});

router.post('/mobile/cases/:caseId/checklists', authMiddleware, (req, res) => {
  const { room, items, notes } = req.body;
  const id = crypto.randomBytes(8).toString('hex');
  dbRun(
    'INSERT INTO inspection_checklists (id, case_id, user_id, room, items_json, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [id, req.params.caseId, req.user.userId, room, JSON.stringify(items || ROOM_CHECKLIST[room] || []), notes || null]
  );
  res.status(201).json({ ok: true, checklistId: id });
});

router.patch('/mobile/checklists/:id', authMiddleware, (req, res) => {
  const { items, notes, completed } = req.body;
  const sets = [];
  const vals = [];
  if (items !== undefined) { sets.push('items_json = ?'); vals.push(JSON.stringify(items)); }
  if (notes !== undefined) { sets.push('notes = ?'); vals.push(notes); }
  if (completed !== undefined) { sets.push('completed = ?'); vals.push(completed ? 1 : 0); }
  sets.push("updated_at = datetime('now')");
  vals.push(req.params.id);
  dbRun(`UPDATE inspection_checklists SET ${sets.join(', ')} WHERE id = ?`, vals);
  res.json({ ok: true });
});

// ── Measurements ─────────────────────────────────────────────────────────────

router.get('/mobile/cases/:caseId/measurements', authMiddleware, (req, res) => {
  const measurements = dbAll('SELECT * FROM field_measurements WHERE case_id = ? ORDER BY floor_level, area_name', [req.params.caseId]);
  res.json({ ok: true, measurements });
});

router.post('/mobile/cases/:caseId/measurements', authMiddleware, (req, res) => {
  const { areaName, lengthFt, widthFt, floorLevel, notes } = req.body;
  const id = crypto.randomBytes(8).toString('hex');
  const areaSqft = (lengthFt && widthFt) ? Math.round(lengthFt * widthFt * 100) / 100 : null;
  dbRun(
    'INSERT INTO field_measurements (id, case_id, user_id, area_name, length_ft, width_ft, area_sqft, floor_level, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, req.params.caseId, req.user.userId, areaName, lengthFt || null, widthFt || null, areaSqft, floorLevel || '1', notes || null]
  );
  res.status(201).json({ ok: true, measurementId: id, areaSqft });
});

// Calculate total GLA from measurements
router.get('/mobile/cases/:caseId/measurements/gla', authMiddleware, (req, res) => {
  const measurements = dbAll('SELECT * FROM field_measurements WHERE case_id = ?', [req.params.caseId]);
  const byFloor = {};
  for (const m of measurements) {
    const floor = m.floor_level || '1';
    if (!byFloor[floor]) byFloor[floor] = { rooms: [], totalSqft: 0 };
    byFloor[floor].rooms.push({ name: m.area_name, sqft: m.area_sqft || 0 });
    byFloor[floor].totalSqft += m.area_sqft || 0;
  }
  const totalGla = Object.values(byFloor).reduce((sum, f) => sum + f.totalSqft, 0);
  res.json({ ok: true, byFloor, totalGla: Math.round(totalGla) });
});

// ── Voice Notes ──────────────────────────────────────────────────────────────

router.post('/mobile/cases/:caseId/voice-notes', authMiddleware, (req, res) => {
  const { transcript, section, durationS } = req.body;
  const id = crypto.randomBytes(8).toString('hex');
  dbRun(
    'INSERT INTO voice_notes (id, case_id, user_id, transcript, section, duration_s) VALUES (?, ?, ?, ?, ?, ?)',
    [id, req.params.caseId, req.user.userId, transcript, section || null, durationS || null]
  );
  res.status(201).json({ ok: true, noteId: id });
});

router.get('/mobile/cases/:caseId/voice-notes', authMiddleware, (req, res) => {
  const notes = dbAll('SELECT * FROM voice_notes WHERE case_id = ? ORDER BY created_at DESC', [req.params.caseId]);
  res.json({ ok: true, notes });
});

// ── Photo Upload (mobile-optimized) ──────────────────────────────────────────

router.post('/mobile/cases/:caseId/photos', authMiddleware, upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No photo' });
    const category = req.body.category || autoCategorize(req.file.originalname);
    const result = addPhoto(req.params.caseId, req.user.userId, {
      fileName: req.file.originalname,
      filePath: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      category,
      label: req.body.label,
      latitude: req.body.latitude ? parseFloat(req.body.latitude) : null,
      longitude: req.body.longitude ? parseFloat(req.body.longitude) : null,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Offline Sync ─────────────────────────────────────────────────────────────

router.post('/mobile/sync', authMiddleware, async (req, res) => {
  const { actions } = req.body;
  if (!Array.isArray(actions)) return res.status(400).json({ ok: false, error: 'actions array required' });

  const results = [];
  for (const action of actions) {
    try {
      const id = crypto.randomBytes(8).toString('hex');
      dbRun(
        'INSERT INTO offline_sync_queue (id, user_id, case_id, action, payload_json, synced) VALUES (?, ?, ?, ?, ?, 1)',
        [id, req.user.userId, action.caseId || null, action.type, JSON.stringify(action.data || {})]
      );

      // Process the action immediately
      if (action.type === 'measurement') {
        const d = action.data;
        dbRun('INSERT INTO field_measurements (id, case_id, user_id, area_name, length_ft, width_ft, area_sqft, floor_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [crypto.randomBytes(8).toString('hex'), action.caseId, req.user.userId, d.areaName, d.lengthFt, d.widthFt, d.areaSqft, d.floorLevel || '1']);
      } else if (action.type === 'checklist') {
        const d = action.data;
        dbRun('INSERT OR REPLACE INTO inspection_checklists (id, case_id, user_id, room, items_json, notes, completed) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [d.id || crypto.randomBytes(8).toString('hex'), action.caseId, req.user.userId, d.room, JSON.stringify(d.items || []), d.notes, d.completed ? 1 : 0]);
      } else if (action.type === 'voice_note') {
        const d = action.data;
        dbRun('INSERT INTO voice_notes (id, case_id, user_id, transcript, section, duration_s) VALUES (?, ?, ?, ?, ?, ?)',
          [crypto.randomBytes(8).toString('hex'), action.caseId, req.user.userId, d.transcript, d.section, d.durationS]);
      }

      results.push({ id, type: action.type, ok: true });
    } catch (err) {
      results.push({ type: action.type, ok: false, error: err.message });
    }
  }

  res.json({ ok: true, synced: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
});

export default router;
