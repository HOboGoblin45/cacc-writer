/**
 * tests/unit/textUtils.test.mjs
 * Unit tests for server/utils/textUtils.js
 * Zero external dependencies — uses Node built-in assert.
 * Run: node tests/unit/textUtils.test.mjs
 */

import assert from 'assert/strict';
import {
  trimText,
  asArray,
  aiText,
  extractBalancedJSON,
  parseJSONObject,
  parseJSONArray,
  normSev,
  normalizeQuestions,
  normalizeGrade,
} from '../../server/utils/textUtils.js';

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

// ── trimText ──────────────────────────────────────────────────────────────────

console.log('\ntrimText');

test('trims whitespace from a string', () => {
  assert.equal(trimText('  hello  '), 'hello');
});

test('converts non-string to string', () => {
  assert.equal(trimText(42), '42');
});

test('handles null/undefined → empty string', () => {
  assert.equal(trimText(null), '');
  assert.equal(trimText(undefined), '');
});

test('caps at max characters', () => {
  assert.equal(trimText('hello world', 5), 'hello');
});

test('does not cap when max not provided', () => {
  const long = 'a'.repeat(1000);
  assert.equal(trimText(long).length, 1000);
});

test('max=0 returns empty string', () => {
  assert.equal(trimText('hello', 0), '');
});

// ── asArray ───────────────────────────────────────────────────────────────────

console.log('\nasArray');

test('returns array as-is', () => {
  const arr = [1, 2, 3];
  assert.equal(asArray(arr), arr);
});

test('splits comma-separated string', () => {
  assert.deepEqual(asArray('a, b, c'), ['a', 'b', 'c']);
});

test('trims whitespace from split parts', () => {
  assert.deepEqual(asArray('  foo  ,  bar  '), ['foo', 'bar']);
});

test('filters empty parts from split', () => {
  assert.deepEqual(asArray('a,,b'), ['a', 'b']);
});

test('wraps non-string truthy value in array', () => {
  assert.deepEqual(asArray(42), [42]);
});

test('returns empty array for falsy value', () => {
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray(''), []);
});

test('returns empty array for empty string', () => {
  assert.deepEqual(asArray(''), []);
});

// ── aiText ────────────────────────────────────────────────────────────────────

console.log('\naiText');

test('returns empty string for null/undefined', () => {
  assert.equal(aiText(null), '');
  assert.equal(aiText(undefined), '');
});

test('extracts output_text shortcut', () => {
  assert.equal(aiText({ output_text: 'hello' }), 'hello');
});

test('extracts nested output array text', () => {
  const resp = { output: [{ content: [{ text: 'nested text' }] }] };
  assert.equal(aiText(resp), 'nested text');
});

test('prefers output_text over nested output', () => {
  const resp = {
    output_text: 'top level',
    output: [{ content: [{ text: 'nested' }] }],
  };
  assert.equal(aiText(resp), 'top level');
});

test('returns empty string when neither field present', () => {
  assert.equal(aiText({}), '');
});

test('handles malformed nested output gracefully', () => {
  assert.equal(aiText({ output: [] }), '');
  assert.equal(aiText({ output: [{}] }), '');
  assert.equal(aiText({ output: [{ content: [] }] }), '');
});

// ── extractBalancedJSON ───────────────────────────────────────────────────────

console.log('\nextractBalancedJSON');

test('extracts a simple object', () => {
  assert.equal(extractBalancedJSON('{"a":1}', '{', '}'), '{"a":1}');
});

test('extracts a simple array', () => {
  assert.equal(extractBalancedJSON('[1,2,3]', '[', ']'), '[1,2,3]');
});

test('extracts object from surrounding text', () => {
  assert.equal(extractBalancedJSON('prefix {"a":1} suffix', '{', '}'), '{"a":1}');
});

test('handles nested objects', () => {
  const src = '{"a":{"b":{"c":1}}}';
  assert.equal(extractBalancedJSON(src, '{', '}'), src);
});

test('handles nested arrays', () => {
  const src = '[[1,2],[3,4]]';
  assert.equal(extractBalancedJSON(src, '[', ']'), src);
});

test('handles strings containing braces', () => {
  const src = '{"key":"value with { brace }"}';
  assert.equal(extractBalancedJSON(src, '{', '}'), src);
});

test('handles escaped quotes in strings', () => {
  const src = '{"key":"say \\"hello\\""}';
  assert.equal(extractBalancedJSON(src, '{', '}'), src);
});

test('returns null when no opening character found', () => {
  assert.equal(extractBalancedJSON('no json here', '{', '}'), null);
});

test('returns null for unbalanced structure', () => {
  assert.equal(extractBalancedJSON('{"unclosed":', '{', '}'), null);
});

// ── parseJSONObject ───────────────────────────────────────────────────────────

console.log('\nparseJSONObject');

test('parses a clean JSON object string', () => {
  assert.deepEqual(parseJSONObject('{"a":1,"b":"two"}'), { a: 1, b: 'two' });
});

test('parses object embedded in text', () => {
  assert.deepEqual(parseJSONObject('Here is the result: {"score":8}'), { score: 8 });
});

test('returns null for non-object input', () => {
  assert.equal(parseJSONObject('[1,2,3]'), null);
});

test('returns null for empty string', () => {
  assert.equal(parseJSONObject(''), null);
});

test('returns null for null/undefined', () => {
  assert.equal(parseJSONObject(null), null);
  assert.equal(parseJSONObject(undefined), null);
});

test('returns null for invalid JSON', () => {
  assert.equal(parseJSONObject('{bad json}'), null);
});

// ── parseJSONArray ────────────────────────────────────────────────────────────

console.log('\nparseJSONArray');

test('parses a clean JSON array string', () => {
  assert.deepEqual(parseJSONArray('[1,2,3]'), [1, 2, 3]);
});

test('parses array embedded in text', () => {
  assert.deepEqual(parseJSONArray('Result: [{"q":"What?"}]'), [{ q: 'What?' }]);
});

test('returns null for non-array input', () => {
  assert.equal(parseJSONArray('{"a":1}'), null);
});

test('returns null for empty string', () => {
  assert.equal(parseJSONArray(''), null);
});

test('returns null for null/undefined', () => {
  assert.equal(parseJSONArray(null), null);
  assert.equal(parseJSONArray(undefined), null);
});

// ── normSev ───────────────────────────────────────────────────────────────────

console.log('\nnormSev');

test('normalizes "high" → "high"', () => {
  assert.equal(normSev('high'), 'high');
});

test('normalizes "critical" → "high"', () => {
  assert.equal(normSev('critical'), 'high');
});

test('normalizes "low" → "low"', () => {
  assert.equal(normSev('low'), 'low');
});

test('normalizes "minor" → "low"', () => {
  assert.equal(normSev('minor'), 'low');
});

test('normalizes "medium" → "medium"', () => {
  assert.equal(normSev('medium'), 'medium');
});

test('normalizes "moderate" → "medium"', () => {
  assert.equal(normSev('moderate'), 'medium');
});

test('is case-insensitive', () => {
  assert.equal(normSev('HIGH'), 'high');
  assert.equal(normSev('Low'), 'low');
  assert.equal(normSev('MEDIUM'), 'medium');
});

test('returns default fallback for unknown value', () => {
  assert.equal(normSev('unknown'), 'medium');
  assert.equal(normSev(''), 'medium');
  assert.equal(normSev(null), 'medium');
});

test('uses custom fallback when provided', () => {
  assert.equal(normSev('garbage', 'low'), 'low');
});

// ── normalizeQuestions ────────────────────────────────────────────────────────

console.log('\nnormalizeQuestions');

test('returns empty array for null/undefined', () => {
  assert.deepEqual(normalizeQuestions(null), []);
  assert.deepEqual(normalizeQuestions(undefined), []);
});

test('normalizes a pre-parsed array', () => {
  const input = [{ question: 'What is the GLA?', reason: 'Missing', confidence: 'high' }];
  const result = normalizeQuestions(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].question, 'What is the GLA?');
  assert.equal(result[0].reason, 'Missing');
  assert.equal(result[0].confidence, 'high');
});

test('parses a JSON string array', () => {
  const input = JSON.stringify([{ question: 'Q1?', reason: 'R1', confidence: 'medium' }]);
  const result = normalizeQuestions(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].question, 'Q1?');
});

test('accepts short-form keys q/r/c', () => {
  const input = [{ q: 'Short Q?', r: 'Short R', c: 'low' }];
  const result = normalizeQuestions(input);
  assert.equal(result[0].question, 'Short Q?');
  assert.equal(result[0].reason, 'Short R');
  assert.equal(result[0].confidence, 'low');
});

test('filters out entries with empty question', () => {
  const input = [
    { question: 'Valid?', reason: 'ok', confidence: 'high' },
    { question: '', reason: 'empty', confidence: 'low' },
    { question: '   ', reason: 'whitespace', confidence: 'low' },
  ];
  const result = normalizeQuestions(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].question, 'Valid?');
});

test('caps question at 500 chars', () => {
  const input = [{ question: 'Q'.repeat(600), reason: 'r', confidence: 'medium' }];
  const result = normalizeQuestions(input);
  assert.equal(result[0].question.length, 500);
});

test('caps reason at 300 chars', () => {
  const input = [{ question: 'Q?', reason: 'R'.repeat(400), confidence: 'medium' }];
  const result = normalizeQuestions(input);
  assert.equal(result[0].reason.length, 300);
});

test('returns empty array for non-array non-string input', () => {
  assert.deepEqual(normalizeQuestions(42), []);
  assert.deepEqual(normalizeQuestions({}), []);
});

// ── normalizeGrade ────────────────────────────────────────────────────────────

console.log('\nnormalizeGrade');

test('returns fallback for null/undefined', () => {
  const fb = normalizeGrade(null);
  assert.equal(fb.score, 0);
  assert.equal(fb.label, 'unknown');
  assert.deepEqual(fb.issues, []);
  assert.deepEqual(fb.suggestions, []);
});

test('normalizes a pre-parsed object', () => {
  const input = { score: 8, label: 'good', issues: ['Issue 1'], suggestions: ['Fix 1'] };
  const result = normalizeGrade(input);
  assert.equal(result.score, 8);
  assert.equal(result.label, 'good');
  assert.deepEqual(result.issues, ['Issue 1']);
  assert.deepEqual(result.suggestions, ['Fix 1']);
});

test('parses a JSON string', () => {
  const input = JSON.stringify({ score: 7, label: 'fair', issues: [], suggestions: [] });
  const result = normalizeGrade(input);
  assert.equal(result.score, 7);
  assert.equal(result.label, 'fair');
});

test('accepts "grade" as alias for score', () => {
  const result = normalizeGrade({ grade: 9, label: 'excellent', issues: [], suggestions: [] });
  assert.equal(result.score, 9);
});

test('accepts "rating" as alias for label', () => {
  const result = normalizeGrade({ score: 5, rating: 'average', issues: [], suggestions: [] });
  assert.equal(result.label, 'average');
});

test('caps label at 50 chars', () => {
  const result = normalizeGrade({ score: 5, label: 'L'.repeat(100), issues: [], suggestions: [] });
  assert.equal(result.label.length, 50);
});

test('caps issue strings at 300 chars', () => {
  const result = normalizeGrade({ score: 5, label: 'ok', issues: ['I'.repeat(400)], suggestions: [] });
  assert.equal(result.issues[0].length, 300);
});

test('handles missing issues/suggestions gracefully', () => {
  const result = normalizeGrade({ score: 5, label: 'ok' });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.suggestions, []);
});

test('returns fallback for invalid JSON string', () => {
  const result = normalizeGrade('{bad json}');
  assert.equal(result.score, 0);
  assert.equal(result.label, 'unknown');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`textUtils: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);
