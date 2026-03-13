/**
 * tests/unit/stuckStateDetector.test.mjs
 * Unit tests for stuck state detection and force-fail.
 */

import assert from 'assert';
import { getDb } from '../../server/db/database.js';
import {
  detectStuckStates,
  failStuckGenerationRun,
  failStuckExtractionJob,
} from '../../server/operations/stuckStateDetector.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('  OK   ' + name);
    passed++;
  } catch (err) {
    console.log('  FAIL ' + name);
    console.log('       ' + err.message);
    failed++;
  }
}

const caseId = 'stuck001';

// ── Tests ─────────────────────────────────────────────────────────────────────

await test('detectStuckStates returns empty when nothing is stuck', () => {
  const result = detectStuckStates();
  assert.strictEqual(result.totalStuck, 0);
  assert.ok(Array.isArray(result.generationRuns));
  assert.ok(Array.isArray(result.extractionJobs));
});

await test('detectStuckStates finds stuck generation run', () => {
  const db = getDb();
  const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
  db.prepare(`INSERT OR IGNORE INTO case_records (case_id, form_type, status) VALUES (?, '1004', 'generating')`).run(caseId);
  db.prepare(
    `INSERT INTO generation_runs (id, case_id, form_type, status, started_at, created_at) VALUES (?, ?, '1004', 'running', ?, ?)`
  ).run('stuck-gen-1', caseId, longAgo, longAgo);

  const result = detectStuckStates();
  assert.ok(result.generationRuns.length >= 1);
  const found = result.generationRuns.find(r => r.id === 'stuck-gen-1');
  assert.ok(found, 'should find the stuck run');
  assert.ok(found.stuckMinutes >= 55);
});

await test('failStuckGenerationRun force-fails a stuck run', () => {
  const result = failStuckGenerationRun('stuck-gen-1');
  assert.strictEqual(result.previousStatus, 'running');
  assert.strictEqual(result.newStatus, 'failed');

  const db = getDb();
  const row = db.prepare('SELECT * FROM generation_runs WHERE id = ?').get('stuck-gen-1');
  assert.strictEqual(row.status, 'failed');
});

await test('failStuckGenerationRun rejects non-running run', () => {
  try {
    failStuckGenerationRun('stuck-gen-1'); // already failed above
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('not running'));
  }
});

await test('detectStuckStates finds stuck extraction job', () => {
  const db = getDb();
  const longAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  // Create parent document first (FK constraint)
  db.prepare(
    `INSERT OR IGNORE INTO case_documents (id, case_id, original_filename, stored_filename, doc_type, file_type, uploaded_at) VALUES (?, ?, 'test.pdf', 'test_stored.pdf', 'unknown', 'pdf', ?)`
  ).run('stuck-doc-1', caseId, longAgo);
  db.prepare(
    `INSERT INTO document_extractions (id, document_id, case_id, doc_type, status, started_at, created_at) VALUES (?, ?, ?, 'unknown', 'running', ?, ?)`
  ).run('stuck-ext-1', 'stuck-doc-1', caseId, longAgo, longAgo);

  const result = detectStuckStates();
  assert.ok(result.extractionJobs.length >= 1);
  const found = result.extractionJobs.find(r => r.id === 'stuck-ext-1');
  assert.ok(found, 'should find the stuck extraction');
});

await test('failStuckExtractionJob force-fails a stuck extraction', () => {
  const result = failStuckExtractionJob('stuck-ext-1');
  assert.strictEqual(result.newStatus, 'failed');

  const db = getDb();
  const row = db.prepare('SELECT * FROM document_extractions WHERE id = ?').get('stuck-ext-1');
  assert.strictEqual(row.status, 'failed');
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('────────────────────────────────────────────────────────────');
console.log(`stuckStateDetector: ${passed} passed, ${failed} failed`);
console.log('────────────────────────────────────────────────────────────');
if (failed > 0) process.exit(1);
