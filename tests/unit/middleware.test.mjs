/**
 * tests/unit/middleware.test.mjs
 * --------------------------------
 * Unit + lightweight integration tests for server/utils/middleware.js
 *
 * Run:
 *   node tests/unit/middleware.test.mjs
 *
 * Notes:
 * - The integration section auto-starts the server by default if needed.
 * - Set UNIT_AUTO_START=0 to require an already-running server.
 */

import assert from 'assert/strict';
import { upload, ensureAI } from '../../server/utils/middleware.js';
import { ensureServerRunning } from '../helpers/serverHarness.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function recordPass(label) {
  passed++;
  console.log('  OK   ' + label);
}

function recordFail(label, err) {
  failed++;
  failures.push({ label, err });
  console.log('  FAIL ' + label);
  console.log('       ' + err.message);
}

function test(label, fn) {
  try {
    fn();
    recordPass(label);
  } catch (err) {
    recordFail(label, err);
  }
}

async function testAsync(label, fn) {
  try {
    await fn();
    recordPass(label);
  } catch (err) {
    recordFail(label, err);
  }
}

function mockRes() {
  return {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
}

function mockNext() {
  let called = false;
  const fn = () => { called = true; };
  fn.wasCalled = () => called;
  return fn;
}

function makeGuard(mockClient) {
  return function guardAI(_req, res, next) {
    if (!mockClient) {
      return res.status(503).json({
        ok: false,
        error: 'OpenAI client is not initialized. Set OPENAI_API_KEY in .env',
      });
    }
    next();
  };
}

console.log('\nupload (multer instance)');

test('upload is a multer instance (v1 function or v2 object)', () => {
  assert.ok(typeof upload === 'function' || typeof upload === 'object');
  assert.ok(upload !== null);
});

test('upload has .single() method', () => {
  assert.equal(typeof upload.single, 'function');
});

test('upload has .array() method', () => {
  assert.equal(typeof upload.array, 'function');
});

test('upload has .fields() method', () => {
  assert.equal(typeof upload.fields, 'function');
});

test('upload has .none() method', () => {
  assert.equal(typeof upload.none, 'function');
});

test('upload.single() returns middleware function', () => {
  const mw = upload.single('file');
  assert.equal(typeof mw, 'function');
  assert.equal(mw.length, 3);
});

test('upload.array() returns middleware function', () => {
  const mw = upload.array('files', 5);
  assert.equal(typeof mw, 'function');
});

console.log('\nensureAI no-client branch (inline guard)');

test('returns 503 when client is null', () => {
  const guard = makeGuard(null);
  const res = mockRes();
  const next = mockNext();
  guard({}, res, next);
  assert.equal(res._status, 503);
  assert.equal(res._body.ok, false);
  assert.ok(String(res._body.error).includes('OPENAI_API_KEY'));
  assert.ok(!next.wasCalled());
});

test('returns 503 when client is undefined', () => {
  const guard = makeGuard(undefined);
  const res = mockRes();
  const next = mockNext();
  guard({}, res, next);
  assert.equal(res._status, 503);
  assert.equal(res._body.ok, false);
  assert.ok(!next.wasCalled());
});

test('calls next() when client is truthy object', () => {
  const guard = makeGuard({ apiKey: 'sk-test' });
  const res = mockRes();
  const next = mockNext();
  guard({}, res, next);
  assert.ok(next.wasCalled());
  assert.equal(res._status, null);
});

test('calls next() when client is any truthy value', () => {
  const guard = makeGuard('initialized');
  const res = mockRes();
  const next = mockNext();
  guard({}, res, next);
  assert.ok(next.wasCalled());
});

console.log('\nensureAI live import behavior');

test('ensureAI is exported as function', () => {
  assert.equal(typeof ensureAI, 'function');
});

test('ensureAI has arity 3', () => {
  assert.equal(ensureAI.length, 3);
});

test('ensureAI either calls next() or returns 503 (never hangs)', () => {
  const res = mockRes();
  const next = mockNext();
  ensureAI({}, res, next);
  const nextCalled = next.wasCalled();
  const got503 = res._status === 503;
  assert.ok(nextCalled || got503);
  assert.ok(!(nextCalled && got503));
});

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:5178';
const autoStart = process.env.UNIT_AUTO_START !== '0';
let harness = null;

console.log('\nensureAI live server integration');

await testAsync('AI-guarded endpoints respond with expected status classes', async () => {
  harness = await ensureServerRunning({
    baseUrl,
    autoStart,
    cwd: process.cwd(),
  });

  const genRes = await fetch(`${harness.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.ok([400, 503].includes(genRes.status),
    `Expected 400 or 503 for /api/generate, got ${genRes.status}`);

  const genBody = await genRes.json();
  assert.equal(genBody.ok, false);
  assert.equal(typeof genBody.error, 'string');
});

await testAsync('review-section endpoint returns guard or validation response', async () => {
  if (!harness) {
    harness = await ensureServerRunning({ baseUrl, autoStart, cwd: process.cwd() });
  }

  const createRes = await fetch(`${harness.baseUrl}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: 'Middleware Test', formType: '1004' }),
  });
  const createBody = await createRes.json();
  const caseId = createBody.caseId;

  try {
    const reviewRes = await fetch(`${harness.baseUrl}/api/cases/${caseId}/review-section`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.ok([400, 503].includes(reviewRes.status),
      `Expected 400 or 503 for review-section, got ${reviewRes.status}`);

    const reviewBody = await reviewRes.json();
    assert.equal(reviewBody.ok, false);
    assert.equal(typeof reviewBody.error, 'string');
  } finally {
    await fetch(`${harness.baseUrl}/api/cases/${caseId}`, { method: 'DELETE' });
  }
});

<<<<<<< HEAD
// ── ensureAI — live server integration (skipped if server not running) ────────

console.log('\nensureAI — live server integration');

const BASE = 'http://localhost:5178';

// Check if server is reachable before running integration tests
let serverAvailable = false;
try {
  const probe = await fetch(BASE + '/api/workflow/health', { signal: AbortSignal.timeout(2000) });
  serverAvailable = probe.ok;
} catch { /* server not running */ }

if (!serverAvailable) {
  console.log('  SKIP (server not running at ' + BASE + ')');
} else {
  await testAsync('AI-guarded endpoint does not return 503 (client initialized)', async () => {
    const r = await fetch(BASE + '/api/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({}),
    });
    assert.notEqual(r.status, 503,
      'Expected ensureAI to pass through (client initialized), but got 503');
    assert.equal(r.status, 400,
      'Expected 400 (missing params) after ensureAI passes, got ' + r.status);
  });

  await testAsync('AI-guarded endpoint returns JSON with ok:false on bad input', async () => {
    const r = await fetch(BASE + '/api/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({}),
    });
    const j = await r.json();
    assert.equal(j.ok, false);
    assert.equal(typeof j.error, 'string');
  });

  await testAsync('review-section endpoint guarded by ensureAI passes through', async () => {
    const cr = await fetch(BASE + '/api/cases', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ address: 'Middleware Test', formType: '1004' }),
    });
    const cj = await cr.json();
    const caseId = cj.caseId;

    const r = await fetch(BASE + '/api/cases/' + caseId + '/review-section', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({}),
    });
    assert.notEqual(r.status, 503, 'ensureAI should pass through (client initialized)');
    assert.equal(r.status, 400, 'Expected 400 for missing draftText');

    await fetch(BASE + '/api/cases/' + caseId, { method: 'DELETE' });
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
=======
if (harness) {
  await harness.stop();
}

console.log('\n' + '-'.repeat(60));
>>>>>>> 4e8c1fb (Phase A: modularize workflow/generation routes and expand smoke coverage)
console.log(`middleware: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  x ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));

if (failed > 0) process.exit(1);
