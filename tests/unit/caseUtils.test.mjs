/**
 * tests/unit/caseUtils.test.mjs
 * Unit tests for server/utils/caseUtils.js
 * Zero external dependencies — uses Node built-in assert + path.
 * Run: node tests/unit/caseUtils.test.mjs
 */

import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CASES_DIR,
  CASE_ID_RE,
  casePath,
  resolveCaseDir,
  normalizeFormType,
} from '../../server/utils/caseUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// ── CASES_DIR ─────────────────────────────────────────────────────────────────

console.log('\nCASES_DIR');

test('is an absolute path', () => {
  assert.ok(path.isAbsolute(CASES_DIR), 'CASES_DIR should be absolute');
});

test('ends with "cases"', () => {
  assert.equal(path.basename(CASES_DIR), 'cases');
});

test('is a string', () => {
  assert.equal(typeof CASES_DIR, 'string');
});

// ── CASE_ID_RE ────────────────────────────────────────────────────────────────

console.log('\nCASE_ID_RE');

test('matches exactly 8 lowercase hex chars', () => {
  assert.ok(CASE_ID_RE.test('abcdef12'));
  assert.ok(CASE_ID_RE.test('00000000'));
  assert.ok(CASE_ID_RE.test('ffffffff'));
  assert.ok(CASE_ID_RE.test('1a2b3c4d'));
});

test('matches uppercase hex (case-insensitive flag)', () => {
  assert.ok(CASE_ID_RE.test('ABCDEF12'));
  assert.ok(CASE_ID_RE.test('FFFFFFFF'));
});

test('rejects fewer than 8 chars', () => {
  assert.ok(!CASE_ID_RE.test('abcdef1'));
  assert.ok(!CASE_ID_RE.test(''));
  assert.ok(!CASE_ID_RE.test('1234567'));
});

test('rejects more than 8 chars', () => {
  assert.ok(!CASE_ID_RE.test('abcdef123'));
  assert.ok(!CASE_ID_RE.test('123456789'));
});

test('rejects non-hex characters', () => {
  assert.ok(!CASE_ID_RE.test('ghijklmn'));
  assert.ok(!CASE_ID_RE.test('abcdef1g'));
  assert.ok(!CASE_ID_RE.test('abcdef1!'));
  assert.ok(!CASE_ID_RE.test('abcdef1 '));
});

test('rejects strings with path separators', () => {
  assert.ok(!CASE_ID_RE.test('abcdef1/'));
  assert.ok(!CASE_ID_RE.test('abcdef1\\'));
  assert.ok(!CASE_ID_RE.test('../abcd'));
});

// ── casePath ──────────────────────────────────────────────────────────────────

console.log('\ncasePath');

test('returns an absolute path', () => {
  assert.ok(path.isAbsolute(casePath('abcdef12')));
});

test('path ends with the case ID', () => {
  assert.equal(path.basename(casePath('abcdef12')), 'abcdef12');
});

test('path is inside CASES_DIR', () => {
  const cp = casePath('abcdef12');
  assert.ok(cp.startsWith(CASES_DIR));
});

test('different IDs produce different paths', () => {
  assert.notEqual(casePath('abcdef12'), casePath('12345678'));
});

test('does not validate the ID format (raw join)', () => {
  // casePath is a raw join — it does not validate
  const cp = casePath('invalid!');
  assert.ok(typeof cp === 'string');
});

// ── resolveCaseDir ────────────────────────────────────────────────────────────

console.log('\nresolveCaseDir');

test('returns absolute path for valid 8-char hex ID', () => {
  const result = resolveCaseDir('abcdef12');
  assert.ok(result !== null, 'should not return null');
  assert.ok(path.isAbsolute(result));
});

test('returned path ends with the case ID', () => {
  const result = resolveCaseDir('abcdef12');
  assert.equal(path.basename(result), 'abcdef12');
});

test('returned path is inside CASES_DIR', () => {
  const result = resolveCaseDir('abcdef12');
  assert.ok(result.startsWith(CASES_DIR));
});

test('returns null for ID shorter than 8 chars', () => {
  assert.equal(resolveCaseDir('abcdef1'), null);
  assert.equal(resolveCaseDir(''), null);
});

test('returns null for ID longer than 8 chars', () => {
  assert.equal(resolveCaseDir('abcdef123'), null);
});

test('returns null for non-hex characters', () => {
  assert.equal(resolveCaseDir('ghijklmn'), null);
  assert.equal(resolveCaseDir('abcdef1!'), null);
});

test('returns null for null input', () => {
  assert.equal(resolveCaseDir(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(resolveCaseDir(undefined), null);
});

test('returns null for path traversal attempt (../)', () => {
  // These won't match CASE_ID_RE so they return null
  assert.equal(resolveCaseDir('../etc/passwd'), null);
  assert.equal(resolveCaseDir('../../root'), null);
});

test('returns null for path with slashes', () => {
  assert.equal(resolveCaseDir('abcdef12/extra'), null);
});

test('accepts uppercase hex (case-insensitive)', () => {
  const result = resolveCaseDir('ABCDEF12');
  assert.ok(result !== null);
});

test('is consistent — same ID always returns same path', () => {
  const a = resolveCaseDir('abcdef12');
  const b = resolveCaseDir('abcdef12');
  assert.equal(a, b);
});

// ── normalizeFormType ─────────────────────────────────────────────────────────

console.log('\nnormalizeFormType');

test('returns "1004" for valid form type "1004"', () => {
  assert.equal(normalizeFormType('1004'), '1004');
});

test('returns "1073" for valid form type "1073"', () => {
  assert.equal(normalizeFormType('1073'), '1073');
});

test('returns "1025" for valid form type "1025"', () => {
  assert.equal(normalizeFormType('1025'), '1025');
});

test('returns "1004c" for valid form type "1004c"', () => {
  assert.equal(normalizeFormType('1004c'), '1004c');
});

test('returns default form type for empty string', () => {
  const result = normalizeFormType('');
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0, 'should return a non-empty default');
});

test('returns default form type for null', () => {
  const result = normalizeFormType(null);
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
});

test('returns default form type for undefined', () => {
  const result = normalizeFormType(undefined);
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
});

test('returns default form type for unknown form type', () => {
  const result = normalizeFormType('9999');
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
  // Should not return the invalid value
  assert.notEqual(result, '9999');
});

test('trims whitespace before validation', () => {
  // '  1004  ' trimmed → '1004' which is valid
  const result = normalizeFormType('  1004  ');
  assert.equal(result, '1004');
});

test('returns a string for numeric input', () => {
  const result = normalizeFormType(1004);
  assert.equal(typeof result, 'string');
});

test('is idempotent — normalizing twice gives same result', () => {
  const once  = normalizeFormType('1004');
  const twice = normalizeFormType(once);
  assert.equal(once, twice);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`caseUtils: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);
