/**
 * tests/unit/logger.test.mjs
 * Unit tests for server/logger.js
 * Run: node tests/unit/logger.test.mjs
 */

import assert from 'assert/strict';

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

// ── Capture stdout/stderr for testing ─────────────────────────────────────────

function captureOutput(fn) {
  const chunks = { stdout: [], stderr: [] };
  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;
  process.stdout.write = (chunk) => { chunks.stdout.push(chunk); return true; };
  process.stderr.write = (chunk) => { chunks.stderr.push(chunk); return true; };
  try {
    fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
  return {
    stdout: chunks.stdout.join(''),
    stderr: chunks.stderr.join(''),
  };
}

// ── Import logger (dynamically to avoid env side effects) ─────────────────────

// Set LOG_LEVEL to debug so all levels are captured
process.env.LOG_LEVEL = 'debug';

// Fresh import
const { default: log, setFileLogWriter } = await import('../../server/logger.js');

// ── log.info ─────────────────────────────────────────────────────────────────

console.log('\nlog.info');

test('outputs JSON to stdout', () => {
  const { stdout } = captureOutput(() => log.info('test-msg', { key: 'val' }));
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.msg, 'test-msg');
  assert.equal(parsed.key, 'val');
  assert.ok(parsed.ts);
});

test('includes ISO timestamp', () => {
  const { stdout } = captureOutput(() => log.info('ts-test'));
  const parsed = JSON.parse(stdout.trim());
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(parsed.ts));
});

// ── log.warn ─────────────────────────────────────────────────────────────────

console.log('\nlog.warn');

test('outputs to stderr', () => {
  const { stderr, stdout } = captureOutput(() => log.warn('warn-msg'));
  assert.ok(stderr.length > 0);
  const parsed = JSON.parse(stderr.trim());
  assert.equal(parsed.level, 'warn');
  assert.equal(parsed.msg, 'warn-msg');
});

// ── log.error ────────────────────────────────────────────────────────────────

console.log('\nlog.error');

test('outputs to stderr with error level', () => {
  const { stderr } = captureOutput(() => log.error('err-msg', { code: 500 }));
  const parsed = JSON.parse(stderr.trim());
  assert.equal(parsed.level, 'error');
  assert.equal(parsed.msg, 'err-msg');
  assert.equal(parsed.code, 500);
});

// ── log.debug ────────────────────────────────────────────────────────────────

console.log('\nlog.debug');

test('outputs to stdout at debug level', () => {
  const { stdout } = captureOutput(() => log.debug('dbg', { x: 1 }));
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.level, 'debug');
  assert.equal(parsed.x, 1);
});

// ── log.request ──────────────────────────────────────────────────────────────

console.log('\nlog.request');

test('formats HTTP request log entry', () => {
  const { stdout } = captureOutput(() => log.request('GET', '/api/cases', 200, 42));
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.msg, 'http');
  assert.equal(parsed.method, 'GET');
  assert.equal(parsed.path, '/api/cases');
  assert.equal(parsed.status, 200);
  assert.equal(parsed.ms, 42);
});

// ── log.ai ───────────────────────────────────────────────────────────────────

console.log('\nlog.ai');

test('prefixes action with ai:', () => {
  const { stdout } = captureOutput(() => log.ai('generate', { model: 'gpt-4.1' }));
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.msg, 'ai:generate');
  assert.equal(parsed.model, 'gpt-4.1');
});

// ── log.kb ───────────────────────────────────────────────────────────────────

console.log('\nlog.kb');

test('prefixes action with kb:', () => {
  const { stdout } = captureOutput(() => log.kb('save', { field: 'neighborhood' }));
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.msg, 'kb:save');
  assert.equal(parsed.field, 'neighborhood');
});

// ── setFileLogWriter ─────────────────────────────────────────────────────────

console.log('\nsetFileLogWriter');

test('calls file log writer on each emit', () => {
  const entries = [];
  setFileLogWriter((entry) => entries.push(entry));
  captureOutput(() => log.info('fan-out-test'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].msg, 'fan-out-test');
  // Reset
  setFileLogWriter(null);
});

test('does not crash if file writer throws', () => {
  setFileLogWriter(() => { throw new Error('disk full'); });
  assert.doesNotThrow(() => {
    captureOutput(() => log.info('should-not-crash'));
  });
  setFileLogWriter(null);
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`logger: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);
