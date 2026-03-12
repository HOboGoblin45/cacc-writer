/**
 * tests/unit/generationRegenerateRoutes.test.mjs
 * ----------------------------------------------
 * Integration coverage for deterministic regenerate policy enforcement.
 */

import assert from 'assert/strict';
import { ensureServerRunning } from '../helpers/serverHarness.mjs';
import { createRun, updateRunStatus, RUN_STATUS } from '../../server/db/repositories/generationRepo.js';
import { getCaseProjection, saveCaseProjection } from '../../server/caseRecord/caseRecordService.js';

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
  return body.caseId;
}

async function deleteCase(caseId) {
  if (!caseId) return;
  await fetch(`${harness.baseUrl}/api/cases/${caseId}`, { method: 'DELETE' });
}

console.log('\ngeneration regenerate routes');

await testAsync('blocks dependent section regenerate when upstream sections are missing', async () => {
  harness = await ensureServerRunning({ baseUrl, autoStart, cwd: process.cwd() });
  const caseId = await createCase('Regenerate Policy Missing Dependency');
  const runId = 'regen-route-missing-deps';

  try {
    createRun({ runId, caseId, formType: '1004', assignmentId: null });
    updateRunStatus(runId, RUN_STATUS.COMPLETE);
    const projection = getCaseProjection(caseId);
    saveCaseProjection({
      caseId,
      meta: projection.meta,
      facts: {
        ...(projection.facts || {}),
        subject: {
          ...((projection.facts || {}).subject || {}),
          gla: 1840,
          condition: 'C3',
          quality: 'Q4',
        },
      },
      provenance: {
        ...(projection.provenance || {}),
        'subject.gla': { source: 'test-fixture' },
        'subject.condition': { source: 'test-fixture' },
        'subject.quality': { source: 'test-fixture' },
      },
      outputs: projection.outputs || {},
      history: projection.history || {},
      docText: projection.docText || {},
    });

    const response = await fetch(`${harness.baseUrl}/api/generation/regenerate-section`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        caseId,
        sectionId: 'reconciliation',
      }),
    });

    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'SECTION_DEPENDENCIES_INCOMPLETE');
    assert.equal(body.promptVersion, 'cacc-section-factory/synthesis@1');
    assert.ok(Array.isArray(body.dependencySnapshot.missingDependencies));
    assert.ok(body.dependencySnapshot.missingDependencies.includes('market_conditions'));
    assert.ok(body.dependencySnapshot.missingDependencies.includes('sales_comparison_summary'));
  } finally {
    await deleteCase(caseId);
  }
});

if (harness) {
  await harness.stop();
}

console.log('\n' + '-'.repeat(60));
console.log(`generationRegenerateRoutes: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
