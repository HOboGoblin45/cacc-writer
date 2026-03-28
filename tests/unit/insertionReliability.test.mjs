/**
 * tests/unit/insertionReliability.test.mjs
 * Verifies insertion readback snapshots, rollback, retry classes, and replay packaging.
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

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() { return data; },
    async text() { return JSON.stringify(data); },
  };
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-insertion-reliability-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'insertion-reliability.db');

const originalFetch = global.fetch;

const { getDb, closeDb } = await import('../../server/db/database.js');
const { resolveAllMappings } = await import('../../server/insertion/destinationMapper.js');
const {
  prepareInsertionRun,
  executeInsertionRun,
  getInsertionReplayPackage,
} = await import('../../server/insertion/insertionRunEngine.js');
const { getInsertionRunItems } = await import('../../server/insertion/insertionRepo.js');

function insertGeneratedSection({ caseId, formType, fieldId, text }) {
  const db = getDb();
  const runId = randomId('run');
  const jobId = randomId('job');
  db.prepare(`
    INSERT INTO generation_runs (
      id, case_id, form_type, status, created_at
    ) VALUES (?, ?, ?, 'completed', ?)
  `).run(
    runId,
    caseId,
    formType,
    new Date().toISOString(),
  );
  db.prepare(`
    INSERT INTO section_jobs (
      id, run_id, section_id, status, created_at
    ) VALUES (?, ?, ?, 'completed', ?)
  `).run(
    jobId,
    runId,
    fieldId,
    new Date().toISOString(),
  );
  db.prepare(`
    INSERT INTO generated_sections (
      id, job_id, run_id, case_id, section_id, form_type, final_text, approved, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    randomId('gs'),
    jobId,
    runId,
    caseId,
    fieldId,
    formType,
    text,
    new Date().toISOString(),
  );
}

function firstSupportedMapping(formType = '1004', software = 'aci') {
  const mapping = resolveAllMappings(formType, software).find((entry) => entry.supported);
  assert.ok(mapping, `expected a supported ${software} mapping for ${formType}`);
  return mapping;
}

async function cleanup() {
  global.fetch = originalFetch;
  try {
    closeDb();
  } catch {
    // best effort
  }

  try {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

console.log('\ninsertionReliability');

await test('executeInsertionRun rolls back field state after verification mismatch and builds replay package', async () => {
  const caseId = randomId('case');
  const mapping = firstSupportedMapping();
  insertGeneratedSection({
    caseId,
    formType: '1004',
    fieldId: mapping.fieldId,
    text: 'Updated reconciliation narrative text.',
  });

  const insertedTexts = [];
  let readCount = 0;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) {
      const body = JSON.parse(options.body);
      insertedTexts.push(body.text);
      return jsonResponse({ success: true, value: body.text });
    }
    if (String(url).endsWith('/read-field')) {
      readCount++;
      if (readCount === 1) return jsonResponse({ success: true, value: 'Previous destination value' });
      if (readCount === 2) return jsonResponse({ success: true, value: 'Mismatched destination value' });
      return jsonResponse({ success: true, value: 'Previous destination value' });
    }
    throw new Error(`Unhandled fetch URL: ${url}`);
  };

  const prepared = prepareInsertionRun({ caseId, formType: '1004' });
  assert.equal(prepared.items.length, 1, 'expected one insertion item');

  const executed = await executeInsertionRun(prepared.run.id);
  assert.equal(executed.status, 'failed');
  assert.equal(executed.rollbackFields, 1);
  assert.equal(executed.summary.rollbackFields, 1);

  const item = getInsertionRunItems(prepared.run.id)[0];
  assert.equal(item.status, 'failed');
  assert.equal(item.verificationStatus, 'mismatch');
  assert.equal(item.retryClass, 'verification');
  assert.equal(item.preinsertRaw, 'Previous destination value');
  assert.equal(item.rollbackAttempted, true);
  assert.equal(item.rollbackStatus, 'restored');
  assert.equal(insertedTexts[insertedTexts.length - 1], 'Previous destination value');

  const replayPackage = getInsertionReplayPackage(prepared.run.id);
  assert.ok(replayPackage, 'expected replay package');
  assert.equal(replayPackage.summary.rollbackCount, 1);
  assert.equal(replayPackage.items.length, 1);
  assert.equal(replayPackage.items[0].rollbackStatus, 'restored');
});

await test('executeInsertionRun classifies transport retries and succeeds on retry', async () => {
  const caseId = randomId('case');
  const mapping = firstSupportedMapping();
  insertGeneratedSection({
    caseId,
    formType: '1004',
    fieldId: mapping.fieldId,
    text: 'Stable destination narrative for retry test.',
  });

  let insertAttempts = 0;
  const insertedTexts = [];
  let readCount = 0;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/health')) return jsonResponse({ ok: true });
    if (String(url).endsWith('/insert')) {
      insertAttempts++;
      if (insertAttempts === 1) {
        const err = new Error('Timed out contacting agent');
        err.name = 'AbortError';
        throw err;
      }
      const body = JSON.parse(options.body);
      insertedTexts.push(body.text);
      return jsonResponse({ success: true, value: body.text });
    }
    if (String(url).endsWith('/read-field')) {
      readCount++;
      if (readCount === 1) return jsonResponse({ success: true, value: 'Original value' });
      return jsonResponse({ success: true, value: insertedTexts[insertedTexts.length - 1] || '' });
    }
    throw new Error(`Unhandled fetch URL: ${url}`);
  };

  const prepared = prepareInsertionRun({ caseId, formType: '1004' });
  const executed = await executeInsertionRun(prepared.run.id);
  assert.equal(executed.status, 'completed');
  assert.equal(executed.summary.rollbackFields, 0);

  const item = getInsertionRunItems(prepared.run.id)[0];
  assert.equal(item.status, 'verified');
  assert.equal(item.attemptCount, 2);
  assert.equal(item.retryClass, 'transport');
  assert.ok(item.attemptLog.some((entry) => entry.retryClass === 'transport' && entry.outcome === 'failed'));

  const replayPackage = getInsertionReplayPackage(prepared.run.id);
  assert.equal(replayPackage.items.length, 0, 'clean successful run should not need replay items');
});

await test('prepareInsertionRun uses alias-backed draft text for stable insertion fields', async () => {
  const caseId = randomId('case');
  insertGeneratedSection({
    caseId,
    formType: '1004',
    fieldId: 'sca_summary',
    text: 'Alias-backed sales comparison summary text.',
  });

  const prepared = prepareInsertionRun({
    caseId,
    formType: '1004',
    config: { fieldIds: ['sales_comparison_commentary'] },
  });

  assert.equal(prepared.items.length, 1);
  assert.equal(prepared.items[0].fieldId, 'sales_comparison_commentary');
  assert.equal(prepared.items[0].canonicalText, 'Alias-backed sales comparison summary text.');
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const failure of failures) {
    console.log('\n - ' + failure.label);
    console.log('   ' + failure.err.stack);
  }
  await cleanup();
  process.exit(1);
}

await cleanup();
