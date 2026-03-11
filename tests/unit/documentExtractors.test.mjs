/**
 * tests/unit/documentExtractors.test.mjs
 * ---------------------------------------
 * Unit tests for deterministic structured extraction behavior.
 */

import assert from 'assert/strict';
import { extractStructuredFacts, getExtractorTypes } from '../../server/ingestion/documentExtractors.js';

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

function findFact(facts, path) {
  return facts.find(f => f.factPath === path) || null;
}

console.log('\ndocumentExtractors');

await test('getExtractorTypes exposes expected deterministic extractor families', () => {
  const types = getExtractorTypes();
  assert.ok(types.includes('contract'));
  assert.ok(types.includes('mls_sheet'));
  assert.ok(types.includes('zoning_document'));
});

await test('extractStructuredFacts returns contract facts from deterministic text', async () => {
  const text = [
    'Purchase Contract',
    'Contract Date: 01/02/2026',
    'Purchase Price: $525,000',
    'Closing Date: 02/14/2026',
  ].join('\n');

  const facts = await extractStructuredFacts('contract', text);
  assert.ok(findFact(facts, 'contract.salePrice'));
  assert.ok(findFact(facts, 'contract.contractDate'));
});

await test('extractStructuredFacts returns MLS facts without AI fallback', async () => {
  const text = [
    'MLS Listing Sheet',
    'Address: 101 Market St',
    'List Price: $410,000',
    'DOM: 9',
    'GLA: 1820',
    'Year Built: 2004',
  ].join('\n');

  const facts = await extractStructuredFacts('mls_sheet', text);
  assert.ok(findFact(facts, 'market.listPrice'));
  assert.ok(findFact(facts, 'market.dom'));
  assert.ok(findFact(facts, 'subject.gla'));
});

await test('extractStructuredFacts prioritizes legal_nonconforming zoning signal', async () => {
  const text = [
    'Zoning Classification: R-3',
    'Permitted Use: Residential',
    'The subject is a legal nonconforming use under current ordinance.',
  ].join('\n');

  const facts = await extractStructuredFacts('zoning_document', text);
  const conformity = findFact(facts, 'site.zoningConformity');
  assert.ok(conformity, 'expected zoning conformity fact');
  assert.equal(conformity.value, 'legal_nonconforming');
});

await test('extractStructuredFacts returns empty for unknown doc type', async () => {
  const facts = await extractStructuredFacts('unknown_doc_type', 'Some text that should not matter.');
  assert.deepEqual(facts, []);
});

await test('extractStructuredFacts returns empty for very short text', async () => {
  const facts = await extractStructuredFacts('contract', 'tiny');
  assert.deepEqual(facts, []);
});

console.log('\n' + '-'.repeat(60));
console.log(`documentExtractors: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
