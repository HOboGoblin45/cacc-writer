/**
 * tests/unit/generationRepo.test.mjs
 * Focused regression coverage for reviewed-section persistence on generation runs.
 */

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-generation-repo-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'generation-repo.db');

const dbModule = await import('../../server/db/database.js');
const repo = await import('../../server/db/repositories/generationRepo.js');

function uniqueId() {
  return crypto.randomBytes(4).toString('hex');
}

async function cleanup() {
  try {
    dbModule.closeDb();
  } catch {
    // best effort
  }

  try {
    if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

console.log('\ngenerationRepo');

await test('updateGeneratedSectionReview updates reviewed/final text and approval metadata', () => {
  const runId = `run-${uniqueId()}`;
  const caseId = uniqueId();
  const sectionId = 'reconciliation';

  repo.createRun({ runId, caseId, formType: '1004' });
  const jobId = repo.createSectionJob({
    runId,
    sectionId,
    status: repo.JOB_STATUS.QUEUED,
    profileId: 'synthesis',
    dependsOn: [],
  });

  repo.saveGeneratedSection({
    jobId,
    runId,
    caseId,
    sectionId,
    formType: '1004',
    text: 'Initial generated reconciliation draft.',
    examplesUsed: 2,
  });

  const updated = repo.updateGeneratedSectionReview({
    runId,
    sectionId,
    text: 'Reviewed reconciliation text with explicit operator completion.',
    approved: true,
  });

  assert.ok(updated, 'expected generated section update result');
  assert.equal(updated.approved, true);
  assert.ok(updated.approvedAt, 'approvedAt should be set');

  const rows = repo.getGeneratedSectionsForRun(runId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].section_id, sectionId);
  assert.equal(rows[0].final_text, 'Reviewed reconciliation text with explicit operator completion.');
  assert.equal(rows[0].approved, 1);
  assert.ok(rows[0].approved_at, 'persisted approved_at should be present');
});

await cleanup();

console.log('\n' + '-'.repeat(60));
console.log(`generationRepo: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
