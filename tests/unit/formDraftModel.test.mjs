/**
 * tests/unit/formDraftModel.test.mjs
 * Verifies the explicit internal form draft model projection used before insertion.
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

function randomId(prefix = 'id') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-form-draft-model-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'form-draft-model.db');

const { getDb, closeDb } = await import('../../server/db/database.js');
const { buildFormDraftModel, getFormDraftTextMap } = await import('../../server/insertion/formDraftModel.js');

function insertGeneratedSection({ caseId, formType, sectionId, text, final = true }) {
  const db = getDb();
  const runId = randomId('run');
  const jobId = randomId('job');
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO generation_runs (
      id, case_id, form_type, status, created_at
    ) VALUES (?, ?, ?, 'completed', ?)
  `).run(runId, caseId, formType, createdAt);

  db.prepare(`
    INSERT INTO section_jobs (
      id, run_id, section_id, status, created_at
    ) VALUES (?, ?, ?, 'completed', ?)
  `).run(jobId, runId, sectionId, createdAt);

  db.prepare(`
    INSERT INTO generated_sections (
      id, job_id, run_id, case_id, section_id, form_type, draft_text, reviewed_text, final_text, approved, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    randomId('gs'),
    jobId,
    runId,
    caseId,
    sectionId,
    formType,
    final ? '' : text,
    '',
    final ? text : '',
    createdAt,
  );
}

async function cleanup() {
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

console.log('\nformDraftModel');

await test('buildFormDraftModel backfills sales comparison commentary from sca_summary', () => {
  const caseId = randomId('case');
  insertGeneratedSection({
    caseId,
    formType: '1004',
    sectionId: 'sca_summary',
    text: 'Reviewed sales comparison summary text.',
  });

  const draftModel = buildFormDraftModel({ caseId, formType: '1004', targetSoftware: 'aci' });
  const salesCommentary = draftModel.fields.find(field => field.fieldId === 'sales_comparison_commentary');

  assert.ok(salesCommentary, 'expected sales comparison commentary field');
  assert.equal(salesCommentary.sourceFieldId, 'sca_summary');
  assert.equal(salesCommentary.hasText, true);
  assert.equal(salesCommentary.aliasUsed, true);
  assert.match(salesCommentary.text, /sales comparison summary/i);
  assert.ok(draftModel.summary.aliasBackfilledFields >= 1);
});

await test('getFormDraftTextMap exposes alias-backed field text to insertion prep', () => {
  const caseId = randomId('case');
  insertGeneratedSection({
    caseId,
    formType: '1004',
    sectionId: 'prior_sales',
    text: 'Prior sale history text used to backfill offering history.',
  });

  const fieldTexts = getFormDraftTextMap({ caseId, formType: '1004', targetSoftware: 'aci' });

  assert.equal(
    fieldTexts.get('offering_history'),
    'Prior sale history text used to backfill offering history.',
  );
});

await test('buildFormDraftModel backfills commercial rent roll remarks from market rent analysis', () => {
  const caseId = randomId('case');
  insertGeneratedSection({
    caseId,
    formType: 'commercial',
    sectionId: 'market_rent_analysis',
    text: 'Market rent analysis text used for rent roll remarks.',
  });

  const draftModel = buildFormDraftModel({ caseId, formType: 'commercial', targetSoftware: 'real_quantum' });
  const rentRollRemarks = draftModel.fields.find(field => field.fieldId === 'rent_roll_remarks');

  assert.ok(rentRollRemarks, 'expected rent roll remarks field');
  assert.equal(rentRollRemarks.sourceFieldId, 'market_rent_analysis');
  assert.equal(rentRollRemarks.hasText, true);
  assert.equal(rentRollRemarks.aliasUsed, true);
  assert.match(rentRollRemarks.text, /market rent analysis/i);
});

await test('getFormDraftTextMap backfills commercial income approach subfields from income approach text', () => {
  const caseId = randomId('case');
  insertGeneratedSection({
    caseId,
    formType: 'commercial',
    sectionId: 'income_approach',
    text: 'Income approach conclusion text used for expense remarks and direct capitalization.',
  });

  const fieldTexts = getFormDraftTextMap({ caseId, formType: 'commercial', targetSoftware: 'real_quantum' });

  assert.equal(
    fieldTexts.get('expense_remarks'),
    'Income approach conclusion text used for expense remarks and direct capitalization.',
  );
  assert.equal(
    fieldTexts.get('direct_capitalization_conclusion'),
    'Income approach conclusion text used for expense remarks and direct capitalization.',
  );
});

await cleanup();

console.log('\n' + '-'.repeat(60));
console.log(`formDraftModel: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
