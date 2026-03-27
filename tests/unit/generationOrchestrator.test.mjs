/**
 * tests/unit/generationOrchestrator.test.mjs
 * -------------------------------------------
 * Unit tests for orchestrator pre-draft gate enforcement.
 */

import assert from 'assert/strict';

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

const { runFullDraftOrchestrator } = await import('../../server/orchestrator/generationOrchestrator.js');

console.log('\ngenerationOrchestrator');

await test('returns CASE_NOT_FOUND before orchestration when case is missing', async () => {
  const result = await runFullDraftOrchestrator({
    caseId: 'missing-case-guard',
    formType: '1004',
  });

  assert.equal(result?.ok, false, 'expected orchestrator call to fail for missing case');
  assert.equal(result?.code, 'CASE_NOT_FOUND', 'expected CASE_NOT_FOUND code');
});

await test('rejects forceGateBypass when bypass is disabled', async () => {
  const result = await runFullDraftOrchestrator({
    caseId: 'missing-case-bypass',
    formType: '1004',
    options: { forceGateBypass: true },
  });

  assert.equal(result?.ok, false, 'expected orchestrator call to fail when bypass disabled');
  assert.equal(result?.code, 'PRE_DRAFT_GATE_BYPASS_DISABLED', 'expected PRE_DRAFT_GATE_BYPASS_DISABLED code');
});

console.log('\n' + '-'.repeat(60));
console.log(`generationOrchestrator: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
