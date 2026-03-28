import assert from 'assert/strict';

import { buildSimplePdf } from '../helpers/simplePdf.mjs';

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

console.log('\nsimplePdf');

await test('buildSimplePdf returns a valid-looking PDF buffer', () => {
  const pdf = buildSimplePdf([
    'Golden path fixture',
    'Subject Address: 123 Test Street',
    'Contract Price: $455,000',
  ]);

  assert.ok(Buffer.isBuffer(pdf), 'expected Buffer');
  assert.ok(pdf.length > 200, 'expected non-trivial PDF size');
  assert.equal(pdf.slice(0, 8).toString('utf8'), '%PDF-1.4', 'expected PDF header');
  assert.ok(pdf.toString('utf8').includes('startxref'), 'expected cross-reference table');
  assert.ok(pdf.toString('utf8').includes('Subject Address: 123 Test Street'), 'expected embedded text');
});

console.log('\n' + '-'.repeat(60));
console.log(`simplePdf: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
