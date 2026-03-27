/**
 * tests/unit/inspectionWorkflow.test.mjs
 * ----------------------------------------
 * Unit tests for Phase 13 Mobile/Inspection Workflow:
 *   - Inspection lifecycle
 *   - Photo management
 *   - Measurements and GLA calculation
 *   - Condition assessments
 */

import assert from 'assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

let passed = 0;
let failed = 0;
const failures = [];

async function test(label, fn) {
  try {
    await fn();
    passed++;
    console.log('  OK   ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, err });
    console.log('  FAIL ' + label);
    console.log('       ' + err.message);
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-inspection-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'inspection-test.db');

const { getDb } = await import('../../server/db/database.js');
getDb();

const {
  createInspection, getInspection, listInspections,
  startInspection, completeInspection, cancelInspection, rescheduleInspection,
} = await import('../../server/inspection/inspectionService.js');

const {
  addPhoto, getPhoto, listPhotos, updatePhoto, deletePhoto,
  setPrimaryPhoto, getPhotosByCategory, getPhotoManifest,
} = await import('../../server/inspection/photoService.js');

const {
  addMeasurement, getMeasurement, listMeasurements, updateMeasurement,
  deleteMeasurement, calculateGLA, calculateTotalArea, getLevelBreakdown,
} = await import('../../server/inspection/measurementService.js');

const {
  addCondition, getCondition, listConditions,
  getConditionSummary, getRepairList, getOverallConditionRating,
} = await import('../../server/inspection/conditionService.js');

// ── Seed helpers ─────────────────────────────────────────────────────────────

function seedCase(caseId) {
  const db = getDb();
  try {
    db.prepare(`INSERT INTO case_records (case_id, form_type) VALUES (?, '1004')`).run(caseId);
    db.prepare(`INSERT INTO case_facts (case_id, facts_json, provenance_json) VALUES (?, '{}', '{}')`).run(caseId);
  } catch { /* may already exist */ }
}

const caseId = 'case-insp-' + crypto.randomBytes(4).toString('hex');
seedCase(caseId);

// ═══════════════════════════════════════════════════════════════════════════
// Inspections
// ═══════════════════════════════════════════════════════════════════════════

let inspId;

await test('createInspection creates a scheduled inspection', () => {
  const result = createInspection(caseId, {
    inspection_type: 'interior',
    scheduled_date: '2026-03-20',
    scheduled_time: '10:00',
    inspector_name: 'Jane Doe',
    contact_name: 'Owner',
    contact_phone: '555-1234',
  });
  assert.ok(result.id.startsWith('insp_'), 'should have insp_ prefix');
  inspId = result.id;

  const insp = getInspection(inspId);
  assert.equal(insp.inspection_status, 'scheduled');
  assert.equal(insp.inspection_type, 'interior');
});

await test('listInspections returns inspections for case', () => {
  const list = listInspections(caseId);
  assert.ok(list.length >= 1, 'should have at least 1 inspection');
});

await test('startInspection transitions to in_progress', () => {
  const result = startInspection(inspId);
  assert.ok(!result.error, 'should not error');
  const insp = getInspection(inspId);
  assert.equal(insp.inspection_status, 'in_progress');
  assert.ok(insp.actual_date, 'should set actual_date');
});

await test('completeInspection transitions to completed', () => {
  const result = completeInspection(inspId, { duration_minutes: 90 });
  assert.ok(!result.error, 'should not error');
  const insp = getInspection(inspId);
  assert.equal(insp.inspection_status, 'completed');
});

await test('cancelInspection and rescheduleInspection work', () => {
  const insp2 = createInspection(caseId, {
    inspection_type: 'exterior_only',
    scheduled_date: '2026-03-25',
  });

  const rResult = rescheduleInspection(insp2.id, '2026-03-28', '14:00');
  assert.ok(!rResult.error, 'reschedule should not error');
  const rescheduled = getInspection(insp2.id);
  assert.equal(rescheduled.inspection_status, 'rescheduled');

  const insp3 = createInspection(caseId, {
    inspection_type: 'drive_by',
    scheduled_date: '2026-03-30',
  });
  const cResult = cancelInspection(insp3.id, 'Client cancelled');
  assert.ok(!cResult.error, 'cancel should not error');
  const cancelled = getInspection(insp3.id);
  assert.equal(cancelled.inspection_status, 'cancelled');
});

// ═══════════════════════════════════════════════════════════════════════════
// Photos
// ═══════════════════════════════════════════════════════════════════════════

await test('addPhoto adds photo to inspection', () => {
  const result = addPhoto(inspId, caseId, {
    photo_category: 'front',
    label: 'Front elevation',
    file_name: 'front.jpg',
    mime_type: 'image/jpeg',
    file_size: 1024000,
  });
  assert.ok(result.id.startsWith('phot_'), 'should have phot_ prefix');

  const photo = getPhoto(result.id);
  assert.equal(photo.photo_category, 'front');
});

await test('listPhotos and getPhotosByCategory work', () => {
  addPhoto(inspId, caseId, { photo_category: 'rear', label: 'Rear', file_name: 'rear.jpg' });
  addPhoto(inspId, caseId, { photo_category: 'street', label: 'Street', file_name: 'street.jpg' });
  addPhoto(inspId, caseId, { photo_category: 'kitchen', label: 'Kitchen', file_name: 'kitchen.jpg' });

  const photos = listPhotos(inspId);
  assert.ok(photos.length >= 4, 'should have at least 4 photos');

  const byCategory = getPhotosByCategory(inspId);
  assert.ok(typeof byCategory === 'object', 'should return grouped object');
});

await test('setPrimaryPhoto marks photo as primary', () => {
  const photos = listPhotos(inspId);
  const frontPhoto = photos.find(p => p.photo_category === 'front');
  assert.ok(frontPhoto, 'should find front photo');

  const result = setPrimaryPhoto(frontPhoto.id);
  assert.ok(!result.error, 'should not error');

  const updated = getPhoto(frontPhoto.id);
  assert.equal(updated.is_primary, 1);
});

await test('getPhotoManifest returns structured manifest', () => {
  const manifest = getPhotoManifest(caseId);
  assert.ok(typeof manifest === 'object', 'should return manifest');
});

// ═══════════════════════════════════════════════════════════════════════════
// Measurements
// ═══════════════════════════════════════════════════════════════════════════

await test('addMeasurement auto-calculates area', () => {
  const result = addMeasurement(inspId, caseId, {
    area_name: 'Living Room', area_type: 'room', level: 'main',
    length_ft: 20, width_ft: 15,
  });
  assert.ok(result.id.startsWith('meas_'), 'should have meas_ prefix');

  const m = getMeasurement(result.id);
  assert.equal(m.area_sqft, 300, 'should auto-calc 20*15=300');
});

await test('calculateGLA excludes basement and garage', () => {
  addMeasurement(inspId, caseId, { area_name: 'Bedroom 1', area_type: 'room', level: 'upper', length_ft: 14, width_ft: 12 });
  addMeasurement(inspId, caseId, { area_name: 'Kitchen', area_type: 'room', level: 'main', length_ft: 12, width_ft: 10 });
  addMeasurement(inspId, caseId, { area_name: 'Basement Rec', area_type: 'basement', level: 'basement', length_ft: 30, width_ft: 20 });
  addMeasurement(inspId, caseId, { area_name: 'Garage', area_type: 'garage', level: 'main', length_ft: 20, width_ft: 20 });

  const gla = calculateGLA(inspId);
  // GLA should include main+upper rooms but NOT basement or garage
  // Living Room (300) + Bedroom 1 (168) + Kitchen (120) = 588
  assert.ok(gla.gla >= 588, `GLA should be at least 588, got ${gla.gla}`);
  assert.ok(gla.gla < 1200, 'GLA should not include basement/garage');
});

await test('getLevelBreakdown shows area per level', () => {
  const breakdown = getLevelBreakdown(inspId);
  assert.ok(typeof breakdown === 'object', 'should return level breakdown');
});

await test('calculateTotalArea includes all areas', () => {
  const total = calculateTotalArea(inspId);
  assert.ok(total.totalArea > 0 || total.total > 0, 'should have total area');
});

// ═══════════════════════════════════════════════════════════════════════════
// Conditions
// ═══════════════════════════════════════════════════════════════════════════

await test('addCondition records component condition', () => {
  const result = addCondition(inspId, caseId, {
    component: 'roof',
    condition_rating: 'average',
    material: 'asphalt shingle',
    age_years: 10,
    remaining_life_years: 15,
  });
  assert.ok(result.id.startsWith('cond_'), 'should have cond_ prefix');

  const cond = getCondition(result.id);
  assert.equal(cond.condition_rating, 'average');
});

await test('getConditionSummary provides condition overview', () => {
  addCondition(inspId, caseId, { component: 'foundation', condition_rating: 'good', material: 'poured concrete' });
  addCondition(inspId, caseId, { component: 'hvac', condition_rating: 'fair', deficiency: 'Needs filter', repair_needed: true, estimated_repair_cost: 200 });
  addCondition(inspId, caseId, { component: 'flooring', condition_rating: 'poor', deficiency: 'Worn carpet', repair_needed: true, estimated_repair_cost: 3000 });

  const summary = getConditionSummary(inspId);
  assert.ok(summary.countsByRating, 'should have countsByRating');
  assert.ok(summary.totalRepairCost >= 3200, 'should have repair costs');
});

await test('getRepairList returns items needing repair', () => {
  const repairs = getRepairList(inspId);
  assert.ok(repairs.length >= 2, 'should have at least 2 repairs');
  assert.ok(repairs.every(r => r.component), 'all should have component');
});

await test('getOverallConditionRating computes weighted rating', () => {
  const rating = getOverallConditionRating(inspId);
  assert.ok(typeof rating === 'object', 'should return rating object');
  assert.ok(rating.overall, 'should have overall rating');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(40));
console.log(`inspectionWorkflow: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const { label, err } of failures) {
    console.log(`  ✗ ${label}`);
    console.log(`    ${err.stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}
