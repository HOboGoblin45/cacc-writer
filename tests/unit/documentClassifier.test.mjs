/**
 * tests/unit/documentClassifier.test.mjs
 * ---------------------------------------
 * Unit tests for deterministic intake document classification.
 */

import assert from 'assert/strict';
import { classifyDocument, mapLegacyDocType } from '../../server/ingestion/documentClassifier.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(label, fn) {
  try {
    fn();
    passed++;
    console.log('  OK   ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, err });
    console.log('  FAIL ' + label);
    console.log('       ' + err.message);
  }
}

console.log('\ndocumentClassifier');

test('mapLegacyDocType maps known legacy key to phase doc type', () => {
  assert.equal(mapLegacyDocType('purchase_contract'), 'contract');
});

test('classifyDocument respects manual legacy phase doc type', () => {
  const result = classifyDocument('anything.pdf', '', 'contract');
  assert.equal(result.docType, 'contract');
  assert.equal(result.method, 'manual');
  assert.equal(result.confidence, 1);
});

test('classifyDocument classifies by filename when high-confidence match exists', () => {
  const result = classifyDocument('MLS_Listing_Sheet_2026.pdf');
  assert.equal(result.docType, 'mls_sheet');
  assert.equal(result.method, 'filename');
  assert.ok(result.confidence >= 0.9);
});

test('classifyDocument classifies by keywords when filename is inconclusive', () => {
  const text = [
    'Purchase agreement between buyer and seller.',
    'Contract price is 500000 with earnest money deposit.',
    'Closing date is 01/01/2026 and financing contingency applies.',
  ].join(' ');
  const result = classifyDocument('scan_001.pdf', text);
  assert.equal(result.docType, 'contract');
  assert.equal(result.method, 'keyword');
  assert.ok(result.confidence >= 0.7);
});

test('classifyDocument returns unknown when no rules match', () => {
  const result = classifyDocument('misc_file.bin', 'x'.repeat(200));
  assert.equal(result.docType, 'unknown');
  assert.equal(result.method, 'none');
  assert.equal(result.confidence, 0);
});

console.log('\n' + '-'.repeat(60));
console.log(`documentClassifier: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
