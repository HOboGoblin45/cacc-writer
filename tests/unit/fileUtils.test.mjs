/**
 * tests/unit/fileUtils.test.mjs
 * Unit tests for server/utils/fileUtils.js
 * Zero external dependencies — uses Node built-in assert + fs + os.
 * Run: node tests/unit/fileUtils.test.mjs
 */

import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJSON, writeJSON, withVoiceLock } from '../../server/utils/fileUtils.js';

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

async function testAsync(label, fn) {
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

// ── Temp directory helpers ────────────────────────────────────────────────────

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cacc-fileutils-test-'));

function tmpFile(name) {
  return path.join(TMP, name);
}

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}

// ── readJSON ──────────────────────────────────────────────────────────────────

console.log('\nreadJSON');

test('reads and parses a valid JSON file', () => {
  const p = tmpFile('valid.json');
  fs.writeFileSync(p, JSON.stringify({ a: 1, b: 'two' }), 'utf8');
  const result = readJSON(p, {});
  assert.deepEqual(result, { a: 1, b: 'two' });
});

test('reads a JSON array file', () => {
  const p = tmpFile('array.json');
  fs.writeFileSync(p, JSON.stringify([1, 2, 3]), 'utf8');
  assert.deepEqual(readJSON(p, []), [1, 2, 3]);
});

test('returns fallback when file does not exist', () => {
  const result = readJSON(tmpFile('nonexistent.json'), { default: true });
  assert.deepEqual(result, { default: true });
});

test('returns fallback when file contains invalid JSON', () => {
  const p = tmpFile('invalid.json');
  fs.writeFileSync(p, '{bad json}', 'utf8');
  assert.deepEqual(readJSON(p, 'fallback'), 'fallback');
});

test('returns empty object as default fallback when none provided', () => {
  const result = readJSON(tmpFile('missing.json'));
  assert.deepEqual(result, {});
});

test('returns null fallback when explicitly passed', () => {
  const result = readJSON(tmpFile('missing2.json'), null);
  assert.equal(result, null);
});

test('returns false fallback when explicitly passed', () => {
  const result = readJSON(tmpFile('missing3.json'), false);
  assert.equal(result, false);
});

test('reads nested objects correctly', () => {
  const p = tmpFile('nested.json');
  const data = { outer: { inner: { deep: [1, 2, 3] } } };
  fs.writeFileSync(p, JSON.stringify(data), 'utf8');
  assert.deepEqual(readJSON(p, {}), data);
});

// ── writeJSON ─────────────────────────────────────────────────────────────────

console.log('\nwriteJSON');

test('writes a JSON object to file', () => {
  const p = tmpFile('write-obj.json');
  writeJSON(p, { x: 1, y: 'hello' });
  const raw = fs.readFileSync(p, 'utf8');
  assert.deepEqual(JSON.parse(raw), { x: 1, y: 'hello' });
});

test('writes a JSON array to file', () => {
  const p = tmpFile('write-arr.json');
  writeJSON(p, [10, 20, 30]);
  const raw = fs.readFileSync(p, 'utf8');
  assert.deepEqual(JSON.parse(raw), [10, 20, 30]);
});

test('output is pretty-printed (2-space indent)', () => {
  const p = tmpFile('pretty.json');
  writeJSON(p, { a: 1 });
  const raw = fs.readFileSync(p, 'utf8');
  assert.ok(raw.includes('\n'), 'should contain newlines');
  assert.ok(raw.includes('  '), 'should contain 2-space indent');
});

test('does not leave a .tmp file after write', () => {
  const p = tmpFile('no-tmp.json');
  writeJSON(p, { clean: true });
  assert.ok(!fs.existsSync(p + '.tmp'), '.tmp file should not exist after write');
});

test('overwrites existing file', () => {
  const p = tmpFile('overwrite.json');
  writeJSON(p, { version: 1 });
  writeJSON(p, { version: 2 });
  const result = readJSON(p, {});
  assert.equal(result.version, 2);
});

test('round-trips through readJSON', () => {
  const p = tmpFile('roundtrip.json');
  const original = { name: 'test', values: [1, 2, 3], nested: { ok: true } };
  writeJSON(p, original);
  const result = readJSON(p, {});
  assert.deepEqual(result, original);
});

test('handles unicode content', () => {
  const p = tmpFile('unicode.json');
  const data = { text: 'café résumé naïve' };
  writeJSON(p, data);
  assert.deepEqual(readJSON(p, {}), data);
});

// ── withVoiceLock ─────────────────────────────────────────────────────────────

console.log('\nwithVoiceLock');

await testAsync('executes a synchronous function', async () => {
  let ran = false;
  await withVoiceLock(() => { ran = true; });
  assert.ok(ran, 'function should have run');
});

await testAsync('executes an async function', async () => {
  let ran = false;
  await withVoiceLock(async () => {
    await new Promise(r => setTimeout(r, 5));
    ran = true;
  });
  assert.ok(ran, 'async function should have run');
});

await testAsync('returns the function return value', async () => {
  const result = await withVoiceLock(() => 42);
  assert.equal(result, 42);
});

await testAsync('serializes concurrent calls (no interleaving)', async () => {
  const order = [];
  const p1 = withVoiceLock(async () => {
    order.push('start-1');
    await new Promise(r => setTimeout(r, 20));
    order.push('end-1');
  });
  const p2 = withVoiceLock(async () => {
    order.push('start-2');
    await new Promise(r => setTimeout(r, 5));
    order.push('end-2');
  });
  await Promise.all([p1, p2]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2'],
    'calls should be serialized: 1 must complete before 2 starts');
});

await testAsync('continues after a failed call', async () => {
  // First call throws
  try {
    await withVoiceLock(() => { throw new Error('intentional'); });
  } catch {}
  // Second call should still run
  let ran = false;
  await withVoiceLock(() => { ran = true; });
  assert.ok(ran, 'lock should recover after error');
});

await testAsync('serializes three concurrent calls in order', async () => {
  const order = [];
  const p1 = withVoiceLock(async () => { order.push(1); await new Promise(r => setTimeout(r, 15)); });
  const p2 = withVoiceLock(async () => { order.push(2); await new Promise(r => setTimeout(r, 5));  });
  const p3 = withVoiceLock(async () => { order.push(3); });
  await Promise.all([p1, p2, p3]);
  assert.deepEqual(order, [1, 2, 3], 'all three should run in submission order');
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

cleanup();

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`fileUtils: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);
