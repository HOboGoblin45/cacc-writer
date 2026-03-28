/**
 * tests/unit/knowledgeBase.test.mjs
 * ----------------------------------
 * Unit tests for knowledge base write-disable behavior.
 */

import assert from 'assert/strict';
import fs from 'fs';
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

const ROOT = process.cwd();
const KB_INDEX_FILE = path.join(ROOT, 'knowledge_base', 'index.json');
const APPROVED_NARR_INDEX_FILE = path.join(ROOT, 'knowledge_base', 'approvedNarratives', 'index.json');

const {
  addExample,
  addApprovedNarrative,
  indexExamples,
} = await import('../../server/knowledgeBase.js');

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function withKbWriteDisabled(fn) {
  const prev = process.env.CACC_DISABLE_KB_WRITES;
  process.env.CACC_DISABLE_KB_WRITES = '1';
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CACC_DISABLE_KB_WRITES;
    else process.env.CACC_DISABLE_KB_WRITES = prev;
  }
}

console.log('\nknowledgeBase');

await test('addExample does not mutate KB index when writes are disabled', () => {
  const before = readText(KB_INDEX_FILE);

  const example = withKbWriteDisabled(() => addExample({
    formType: '1004',
    fieldId: 'neighborhood_description',
    text: 'Smoke KB write-disable narrative.',
  }));

  const after = readText(KB_INDEX_FILE);
  assert.equal(after, before, 'knowledge_base/index.json should not change');
  assert.equal(typeof example?.id, 'string', 'example id should be string');
  assert(example.id.length > 0, 'example id should be non-empty');
});

await test('addApprovedNarrative does not mutate approved narrative index when writes are disabled', () => {
  const before = readText(APPROVED_NARR_INDEX_FILE);

  const entry = withKbWriteDisabled(() => addApprovedNarrative({
    sectionType: 'neighborhood_description',
    formType: '1004',
    text: 'Approved narrative smoke text.',
  }));

  const after = readText(APPROVED_NARR_INDEX_FILE);
  assert.equal(after, before, 'knowledge_base/approvedNarratives/index.json should not change');
  assert.equal(typeof entry?.id, 'string', 'entry id should be string');
  assert(entry.id.length > 0, 'entry id should be non-empty');
});

await test('indexExamples returns index object without mutating index file when writes are disabled', () => {
  const before = readText(KB_INDEX_FILE);

  const index = withKbWriteDisabled(() => indexExamples());

  const after = readText(KB_INDEX_FILE);
  assert.equal(after, before, 'knowledge_base/index.json should not change');
  assert.equal(typeof index, 'object', 'index should be an object');
  assert.equal(Array.isArray(index.examples), true, 'index.examples should be an array');
});

console.log('\n' + '-'.repeat(60));
console.log(`knowledgeBase: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);

