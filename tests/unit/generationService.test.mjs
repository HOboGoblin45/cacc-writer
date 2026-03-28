/**
 * tests/unit/generationService.test.mjs
 * Unit tests for server/services/generationService.js (parseReviewResponse only)
 * Run: node tests/unit/generationService.test.mjs
 */

import assert from 'assert/strict';
import { parseReviewResponse } from '../../server/services/generationService.js';

// ── Minimal test runner ───────────────────────────────────────────────────────

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

// ── parseReviewResponse ──────────────────────────────────────────────────────

console.log('\nparseReviewResponse');

test('parses clean JSON', () => {
  const raw = '{"revisedText":"Hello","issues":[],"changesMade":false}';
  const result = parseReviewResponse(raw);
  assert.equal(result.revisedText, 'Hello');
  assert.deepEqual(result.issues, []);
  assert.equal(result.changesMade, false);
});

test('strips markdown code fences', () => {
  const raw = '```json\n{"revisedText":"Fixed","issues":[]}\n```';
  const result = parseReviewResponse(raw);
  assert.equal(result.revisedText, 'Fixed');
});

test('handles leading/trailing whitespace', () => {
  const raw = '  \n{"revisedText":"Trimmed"}\n  ';
  const result = parseReviewResponse(raw);
  assert.equal(result.revisedText, 'Trimmed');
});

test('returns empty object for invalid JSON', () => {
  const result = parseReviewResponse('not valid json at all');
  assert.deepEqual(result, {});
});

test('returns empty object for empty string', () => {
  const result = parseReviewResponse('');
  assert.deepEqual(result, {});
});

test('handles JSON with issues array', () => {
  const raw = JSON.stringify({
    revisedText: 'Updated narrative.',
    issues: [
      { type: 'unsupported_claim', description: 'Made up stat', severity: 'critical' },
      { type: 'tone', description: 'Too casual', severity: 'minor' },
    ],
    confidence: 'high',
    changesMade: true,
  });
  const result = parseReviewResponse(raw);
  assert.equal(result.issues.length, 2);
  assert.equal(result.issues[0].type, 'unsupported_claim');
  assert.equal(result.confidence, 'high');
  assert.equal(result.changesMade, true);
});

test('handles markdown fences with extra whitespace', () => {
  const raw = '```json\n  {"revisedText":"Spaced"}  \n```';
  const result = parseReviewResponse(raw);
  assert.equal(result.revisedText, 'Spaced');
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`generationService: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);
