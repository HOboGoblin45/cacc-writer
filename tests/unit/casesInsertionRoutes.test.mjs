/**
 * tests/unit/casesInsertionRoutes.test.mjs
 * ----------------------------------------
 * Lightweight integration coverage for case-scoped insertion reliability routes.
 */

import assert from 'assert/strict';
import { ensureServerRunning } from '../helpers/serverHarness.mjs';
import {
  createInsertionRun,
  createInsertionRunItems,
  getInsertionRunItems,
  updateInsertionRun,
  updateInsertionRunItem,
} from '../../server/insertion/insertionRepo.js';

let passed = 0;
let failed = 0;
const failures = [];

function recordPass(label) {
  passed++;
  console.log('  OK   ' + label);
}

function recordFail(label, err) {
  failed++;
  failures.push({ label, err });
  console.log('  FAIL ' + label);
  console.log('       ' + err.message);
}

async function testAsync(label, fn) {
  try {
    await fn();
    recordPass(label);
  } catch (err) {
    recordFail(label, err);
  }
}

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:5186';
const autoStart = process.env.UNIT_AUTO_START !== '0';
let harness = null;

async function createCase(address) {
  const response = await fetch(`${harness.baseUrl}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, formType: '1004' }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.caseId);
  return body.caseId;
}

async function deleteCase(caseId) {
  if (!caseId) return;
  await fetch(`${harness.baseUrl}/api/cases/${caseId}`, { method: 'DELETE' });
}

function seedFailedInsertionRun(caseId) {
  const startedAt = new Date(Date.now() - 5000).toISOString();
  const completedAt = new Date().toISOString();
  const run = createInsertionRun({
    caseId,
    formType: '1004',
    targetSoftware: 'aci',
    config: { verifyAfter: true, rollbackOnVerificationFailure: true },
  });

  createInsertionRunItems([{
    insertionRunId: run.id,
    caseId,
    fieldId: 'subject_address',
    formType: '1004',
    targetSoftware: 'aci',
    destinationKey: 'SUBJECT_ADDRESS',
    canonicalText: '123 Main St',
    sortOrder: 1,
  }]);

  const [item] = getInsertionRunItems(run.id);
  updateInsertionRunItem(item.id, {
    status: 'failed',
    formattedText: '123 Main St',
    verificationStatus: 'mismatch',
    verificationExpected: '123 MAIN ST',
    verificationRaw: '125 Main St',
    preinsertRaw: 'Old destination value',
    attemptCount: 2,
    retryClass: 'verification',
    rollbackAttempted: true,
    rollbackStatus: 'restored',
    rollbackText: 'Old destination value',
    errorCode: 'verification_mismatch',
    errorText: 'Destination readback did not match canonical text',
    startedAt,
    completedAt,
  });

  updateInsertionRun(run.id, {
    status: 'failed',
    totalFields: 1,
    completedFields: 0,
    failedFields: 1,
    skippedFields: 0,
    verifiedFields: 0,
    rollbackFields: 1,
    startedAt,
    completedAt,
    durationMs: 5000,
    summaryJson: {
      totalFields: 1,
      inserted: 0,
      verified: 0,
      failed: 1,
      skipped: 0,
      fallbackUsed: 0,
      rollbackFields: 1,
      failedFieldIds: ['subject_address'],
      mismatchFieldIds: ['subject_address'],
      readinessSignal: 'needs_review',
    },
    replayPackageJson: {
      runId: run.id,
      caseId,
      formType: '1004',
      targetSoftware: 'aci',
      generatedAt: completedAt,
      summary: {
        failedCount: 1,
        mismatchCount: 1,
        rollbackCount: 1,
      },
      items: [{
        fieldId: 'subject_address',
        destinationKey: 'SUBJECT_ADDRESS',
        status: 'failed',
        verificationStatus: 'mismatch',
        retryClass: 'verification',
        rollbackStatus: 'restored',
        errorCode: 'verification_mismatch',
        errorText: 'Destination readback did not match canonical text',
        attemptLog: [],
      }],
    },
  });

  return run.id;
}

console.log('\ncase-scoped insertion reliability routes');

await testAsync('workspace payload includes latest insertion reliability summary', async () => {
  harness = await ensureServerRunning({ baseUrl, autoStart, cwd: process.cwd() });
  const caseId = await createCase('Insertion Workspace Summary Test');

  try {
    const runId = seedFailedInsertionRun(caseId);
    const response = await fetch(`${harness.baseUrl}/api/cases/${caseId}/workspace`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.workspace.insertionReliability.latestRun.id, runId);
    assert.equal(body.workspace.insertionReliability.latestRun.status, 'failed');
    assert.equal(body.workspace.insertionReliability.latestRun.rollbackFields, 1);
    assert.equal(body.workspace.insertionReliability.latestRun.issueFieldCount, 1);
    assert.equal(body.workspace.qc.latestInsertionStatus, 'failed');
    assert.equal(body.workspace.qc.latestInsertionIssueCount, 1);
    assert.equal(body.workspace.qc.latestInsertionRollbackCount, 1);
  } finally {
    await deleteCase(caseId);
  }
});

await testAsync('case routes return insertion run detail and enforce case ownership', async () => {
  harness = harness || await ensureServerRunning({ baseUrl, autoStart, cwd: process.cwd() });
  const caseId = await createCase('Insertion Detail Case');
  const otherCaseId = await createCase('Insertion Ownership Case');

  try {
    const runId = seedFailedInsertionRun(caseId);

    const listResponse = await fetch(`${harness.baseUrl}/api/cases/${caseId}/insertion-runs`);
    const listBody = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.summary.totalRuns, 1);
    assert.equal(listBody.latestRun.id, runId);
    assert.equal(listBody.runs[0].issueFieldCount, 1);

    const detailResponse = await fetch(`${harness.baseUrl}/api/cases/${caseId}/insertion-runs/${runId}`);
    const detailBody = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.run.id, runId);
    assert.equal(detailBody.items.length, 1);
    assert.equal(detailBody.replayPackage.items.length, 1);
    assert.equal(detailBody.replayPackage.summary.rollbackCount, 1);

    const replayResponse = await fetch(`${harness.baseUrl}/api/cases/${caseId}/insertion-runs/${runId}/replay-package`);
    const replayBody = await replayResponse.json();
    assert.equal(replayResponse.status, 200);
    assert.equal(replayBody.run.id, runId);
    assert.equal(replayBody.replayPackage.items[0].fieldId, 'subject_address');

    const wrongCaseResponse = await fetch(`${harness.baseUrl}/api/cases/${otherCaseId}/insertion-runs/${runId}`);
    const wrongCaseBody = await wrongCaseResponse.json();
    assert.equal(wrongCaseResponse.status, 404);
    assert.equal(wrongCaseBody.ok, false);
  } finally {
    await deleteCase(caseId);
    await deleteCase(otherCaseId);
  }
});

if (harness) {
  await harness.stop();
}

console.log('\n' + '-'.repeat(60));
console.log(`casesInsertionRoutes: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));

if (failed > 0) process.exit(1);
