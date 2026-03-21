/**
 * tests/unit/destinationMapper.test.mjs
 * Verifies nested agent field-map resolution for insertion mapping.
 */

import assert from 'assert/strict';
import { resolveMapping, resolveAllMappings } from '../../server/insertion/destinationMapper.js';

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

console.log('\ndestinationMapper');

await test('resolveMapping finds nested 1004 ACI narrative fields', () => {
  const mapping = resolveMapping('neighborhood_description', '1004', 'aci');

  assert.equal(mapping.supported, true);
  assert.equal(mapping.agentFieldKey, 'neighborhood_description');
  assert.equal(mapping.agentSection, 'narratives');
  assert.equal(mapping.tabName, 'Neig');
});

await test('resolveAllMappings exposes multiple supported nested 1004 ACI fields', () => {
  const supportedIds = resolveAllMappings('1004', 'aci')
    .filter((mapping) => mapping.supported)
    .map((mapping) => mapping.fieldId);

  assert.ok(supportedIds.includes('neighborhood_description'));
  assert.ok(supportedIds.includes('market_conditions'));
  assert.ok(supportedIds.includes('improvements_condition'));
});

console.log('\n' + '-'.repeat(60));
console.log(`destinationMapper: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
