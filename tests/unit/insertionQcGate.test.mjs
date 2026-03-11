/**
 * tests/unit/insertionQcGate.test.mjs
 * -----------------------------------
 * Unit tests for insertion QC gate freshness + blocker behavior.
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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-insertion-qc-'));
process.env.CACC_DB_PATH = path.join(tmpRoot, 'insertion-qc.db');

const { getDb, closeDb } = await import('../../server/db/database.js');
const { prepareInsertionRun } = await import('../../server/insertion/insertionRunEngine.js');

function insertQcRun({
  caseId,
  generationRunId = null,
  status = 'completed',
  createdAt = new Date().toISOString(),
  completedAt = null,
}) {
  const db = getDb();
  const id = randomId('qc');
  db.prepare(`
    INSERT INTO qc_runs (
      id, case_id, generation_run_id, status, rule_set_version,
      created_at, completed_at
    ) VALUES (?, ?, ?, ?, '1.0', ?, ?)
  `).run(
    id,
    caseId,
    generationRunId,
    status,
    createdAt,
    completedAt || (status === 'completed' ? createdAt : null),
  );
  return { id };
}

function insertFinding({
  qcRunId,
  severity = 'blocker',
  status = 'open',
  message = 'Blocker finding',
}) {
  const db = getDb();
  const id = randomId('finding');
  db.prepare(`
    INSERT INTO qc_findings (
      id, qc_run_id, rule_id, severity, category, message, status, created_at
    ) VALUES (?, ?, 'rule.test', ?, 'general', ?, ?, ?)
  `).run(id, qcRunId, severity, message, status, new Date().toISOString());
  return { id };
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

console.log('\ninsertionRunEngine QC gate');

await test('proceeds with no QC when generation run is not provided', () => {
  const caseId = randomId('case');
  const result = prepareInsertionRun({ caseId, formType: '1004' });
  assert.equal(result.qcGate.passed, true);
  assert.equal(result.qcGate.recommendation, 'proceed');
  assert.equal(result.qcGate.reason, 'no_qc_run');
});

await test('blocks when generation run has no completed QC', () => {
  const caseId = randomId('case');
  const generationRunId = randomId('gen');
  const result = prepareInsertionRun({ caseId, formType: '1004', generationRunId });
  assert.equal(result.qcGate.passed, false);
  assert.equal(result.qcGate.recommendation, 'blocked');
  assert.equal(result.qcGate.reason, 'missing_fresh_generation_qc');
  assert.match(result.qcGate.blockerMessages[0], /Run QC before insertion/i);
});

await test('passes when matching completed generation QC exists and is clean', () => {
  const caseId = randomId('case');
  const generationRunId = randomId('gen');
  const qc = insertQcRun({ caseId, generationRunId, status: 'completed' });
  const result = prepareInsertionRun({ caseId, formType: '1004', generationRunId });
  assert.equal(result.qcGate.passed, true);
  assert.equal(result.qcGate.qcRunId, qc.id);
  assert.equal(result.qcGate.reason, 'clean');
});

await test('blocks when matching completed generation QC has open blocker findings', () => {
  const caseId = randomId('case');
  const generationRunId = randomId('gen');
  const qc = insertQcRun({ caseId, generationRunId, status: 'completed' });
  insertFinding({ qcRunId: qc.id, severity: 'blocker', status: 'open' });
  const result = prepareInsertionRun({ caseId, formType: '1004', generationRunId });
  assert.equal(result.qcGate.passed, false);
  assert.equal(result.qcGate.blockerCount, 1);
  assert.equal(result.qcGate.reason, 'blocker_findings');
});

await test('uses latest completed case QC when freshness override is disabled', () => {
  const caseId = randomId('case');
  const olderGen = randomId('gen');
  const requestedGen = randomId('gen');
  const qc = insertQcRun({
    caseId,
    generationRunId: olderGen,
    status: 'completed',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const result = prepareInsertionRun({
    caseId,
    formType: '1004',
    generationRunId: requestedGen,
    config: { requireFreshQcForGeneration: false },
  });
  assert.equal(result.qcGate.passed, true);
  assert.equal(result.qcGate.qcRunId, qc.id);
});

await test('blocks when requireQcRun is enabled and no completed QC exists', () => {
  const caseId = randomId('case');
  const result = prepareInsertionRun({
    caseId,
    formType: '1004',
    config: { requireQcRun: true },
  });
  assert.equal(result.qcGate.passed, false);
  assert.equal(result.qcGate.recommendation, 'blocked');
  assert.equal(result.qcGate.reason, 'missing_qc_run');
});

await test('ignores non-completed QC runs when evaluating gate', () => {
  const caseId = randomId('case');
  insertQcRun({ caseId, generationRunId: randomId('gen'), status: 'running' });
  const result = prepareInsertionRun({
    caseId,
    formType: '1004',
    config: { requireQcRun: true, requireFreshQcForGeneration: false },
  });
  assert.equal(result.qcGate.passed, false);
  assert.equal(result.qcGate.reason, 'missing_qc_run');
});

await cleanup();

console.log('\n' + '-'.repeat(60));
console.log(`insertionQcGate: ${passed} passed, ${failed} failed`);
console.log('-'.repeat(60));

if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`- ${f.label}: ${f.err.message}`);
  }
  process.exit(1);
}
