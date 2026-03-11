/**
 * tests/unit/openaiClient.test.mjs
 * Unit tests for server/openaiClient.js (pure functions only — no API calls)
 * Run: node tests/unit/openaiClient.test.mjs
 */

import assert from 'assert/strict';
import { estimateTokens, getContextWindowLimit } from '../../server/openaiClient.js';

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

// ── estimateTokens ───────────────────────────────────────────────────────────

console.log('\nestimateTokens');

test('estimates tokens for a plain string', () => {
  // "hello world" = 11 chars → ceil(11/4) + 4 = 3 + 4 = 7
  const result = estimateTokens('hello world');
  assert.equal(result, 7);
});

test('returns 0 for non-string non-array', () => {
  assert.equal(estimateTokens(42), 0);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
});

test('estimates tokens for message array', () => {
  const msgs = [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello' },
  ];
  // msg 1: 4 overhead + ceil(16/4) = 4 + 4 = 8
  // msg 2: 4 overhead + ceil(5/4) = 4 + 2 = 6
  // total = 8 + 6 + 2 (priming) = 16
  const result = estimateTokens(msgs);
  assert.equal(result, 16);
});

test('handles empty array', () => {
  assert.equal(estimateTokens([]), 2); // just priming overhead
});

test('handles messages with empty content', () => {
  const msgs = [{ role: 'system', content: '' }];
  // 4 overhead + ceil(0/4)=0 + 2 priming = 6
  assert.equal(estimateTokens(msgs), 6);
});

test('handles messages with undefined content', () => {
  const msgs = [{ role: 'system' }];
  // content is undefined → '' → 0 chars
  assert.equal(estimateTokens(msgs), 6);
});

// ── getContextWindowLimit ────────────────────────────────────────────────────

console.log('\ngetContextWindowLimit');

test('returns 1M for gpt-4.1', () => {
  assert.equal(getContextWindowLimit('gpt-4.1'), 1_000_000);
});

test('returns 1M for gpt-4.1-mini', () => {
  assert.equal(getContextWindowLimit('gpt-4.1-mini'), 1_000_000);
});

test('returns 128K for gpt-4o', () => {
  assert.equal(getContextWindowLimit('gpt-4o'), 128_000);
});

test('returns 128K for gpt-4-turbo', () => {
  assert.equal(getContextWindowLimit('gpt-4-turbo'), 128_000);
});

test('returns 128K for gpt-4', () => {
  assert.equal(getContextWindowLimit('gpt-4'), 128_000);
});

test('returns 16K for gpt-3.5', () => {
  assert.equal(getContextWindowLimit('gpt-3.5-turbo'), 16_385);
});

test('returns 200K for o1/o3/o4 models', () => {
  assert.equal(getContextWindowLimit('o1-preview'), 200_000);
  assert.equal(getContextWindowLimit('o3-mini'), 200_000);
  assert.equal(getContextWindowLimit('o4-mini'), 200_000);
});

test('returns 128K as default for unknown model', () => {
  assert.equal(getContextWindowLimit('some-future-model'), 128_000);
});

test('uses default MODEL when no argument provided', () => {
  const result = getContextWindowLimit();
  assert.ok(result >= 16_385); // should be a valid token limit
});

test('is case-insensitive', () => {
  assert.equal(getContextWindowLimit('GPT-4.1'), 1_000_000);
  assert.equal(getContextWindowLimit('GPT-4O'), 128_000);
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`openaiClient: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);
