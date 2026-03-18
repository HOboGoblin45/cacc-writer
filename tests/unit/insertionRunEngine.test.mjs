/**
 * tests/unit/insertionRunEngine.test.mjs
 * Unit tests for agent timeout policy in insertionRunEngine.js
 */

import assert from 'assert/strict';
import { getAgentTimeoutMs } from '../../server/insertion/insertionRunEngine.js';

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

console.log('\ninsertionRunEngine');

await test('getAgentTimeoutMs enforces the ACI minimum timeout', async () => {
  assert.equal(getAgentTimeoutMs('aci', 15000), 30000);
  assert.equal(getAgentTimeoutMs('aci', 45000), 45000);
});

await test('getAgentTimeoutMs preserves Real Quantum timeout defaults', async () => {
  assert.equal(getAgentTimeoutMs('real_quantum', 15000), 15000);
  assert.equal(getAgentTimeoutMs('real_quantum', 22000), 22000);
});

console.log('\n' + '-'.repeat(60));
console.log(`insertionRunEngine: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
