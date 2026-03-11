/**
 * tests/unit/middleware.test.mjs
 * Unit + integration tests for server/utils/middleware.js
 *
 * Strategy:
 *   - upload:   test the multer instance properties directly (no HTTP needed)
 *   - ensureAI: test both branches using mock req/res/next objects
 *               Branch A (client present)  — tested against the live import
 *               Branch B (client absent)   — tested with an inline guard clone
 *               Branch C (live server)     — hit a guarded endpoint via fetch
 *
 * Zero external dependencies — uses Node built-in assert.
 * Run: node tests/unit/middleware.test.mjs
 */

import assert from 'assert/strict';
import { upload, ensureAI } from '../../server/utils/middleware.js';

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

// ── Mock helpers ──────────────────────────────────────────────────────────────

function mockRes() {
  const res = {
    _status: null,
    _body:   null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body   = body; return this; },
  };
  return res;
}

function mockNext() {
  let called = false;
  const fn = () => { called = true; };
  fn.wasCalled = () => called;
  return fn;
}

// ── upload ────────────────────────────────────────────────────────────────────

console.log('\nupload (multer instance)');

test('upload is exported as a multer instance (object with middleware methods)', () => {
  // multer v2 returns an object, not a callable function
  assert.ok(
    typeof upload === 'function' || typeof upload === 'object',
    'upload should be a multer instance (function in v1, object in v2)'
  );
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

test('upload.single() returns a middleware function', () => {
  const mw = upload.single('file');
  assert.equal(typeof mw, 'function');
  // Express middleware has arity 3 (req, res, next)
  assert.equal(mw.length, 3);
});

test('upload.array() returns a middleware function', () => {
  const mw = upload.array('files', 5);
  assert.equal(typeof mw, 'function');
});

// ── ensureAI — branch B: no client (inline guard clone) ──────────────────────

console.log('\nensureAI — no-client branch (inline guard)');

/**
 * Inline clone of ensureAI with an injected client value.
 * Tests the guard logic without needing ES module mocking.
 */
function makeGuard(mockClient) {
  return function guardAI(_req, res, next) {
    if (!mockClient) {
      return res.status(503).json({
        ok:    false,
        error: 'OpenAI client is not initialized. Set OPENAI_API_KEY in .env',
      });
    }
    next();
  };
}

test('returns 503 when client is null', () => {
  const guard = makeGuard(null);
  const res   = mockRes();
  const next  = mockNext();
  guard({}, res, next);
  assert.equal(res._status, 503);
  assert.equal(res._body.ok, false);
  assert.ok(res._body.error.includes('OPENAI_API_KEY'));
  assert.ok(!next.wasCalled(), 'next() should NOT be called when client is absent');
});

test('returns 503 when client is undefined', () => {
  const guard = makeGuard(undefined);
  const res   = mockRes();
  const next  = mockNext();
  guard({}, res, next);
  assert.equal(res._status, 503);
  assert.equal(res._body.ok, false);
});

test('returns 503 when client is false', () => {
  const guard = makeGuard(false);
  const res   = mockRes();
  const next  = mockNext();
  guard({}, res, next);
  assert.equal(res._status, 503);
});

test('calls next() when client is a truthy object', () => {
  const guard = makeGuard({ apiKey: 'sk-test' });
  const res   = mockRes();
  const next  = mockNext();
  guard({}, res, next);
  assert.ok(next.wasCalled(), 'next() should be called when client is present');
  assert.equal(res._status, null, 'res.status() should NOT be called');
});

test('calls next() when client is any truthy value', () => {
  const guard = makeGuard('initialized');
  const res   = mockRes();
  const next  = mockNext();
  guard({}, res, next);
  assert.ok(next.wasCalled());
});

test('error response body has ok:false and error string', () => {
  const guard = makeGuard(null);
  const res   = mockRes();
  guard({}, res, () => {});
  assert.equal(typeof res._body.error, 'string');
  assert.ok(res._body.error.length > 0);
});

// ── ensureAI — branch A: live import (client state from environment) ──────────

console.log('\nensureAI — live import (environment client state)');

test('ensureAI is exported as a function', () => {
  assert.equal(typeof ensureAI, 'function');
});

test('ensureAI has arity 3 (req, res, next)', () => {
  assert.equal(ensureAI.length, 3);
});

test('ensureAI either calls next() or returns 503 — never hangs', () => {
  const res  = mockRes();
  const next = mockNext();
  ensureAI({}, res, next);
  // One of the two branches must have fired
  const nextCalled   = next.wasCalled();
  const got503       = res._status === 503;
  assert.ok(
    nextCalled || got503,
    'ensureAI must either call next() or return 503 — neither happened'
  );
  // They must be mutually exclusive
  assert.ok(
    !(nextCalled && got503),
    'ensureAI must not both call next() AND return 503'
  );
});

test('when ensureAI returns 503, body has ok:false', () => {
  const res  = mockRes();
  const next = mockNext();
  ensureAI({}, res, next);
  if (res._status === 503) {
    assert.equal(res._body.ok, false);
    assert.equal(typeof res._body.error, 'string');
  }
  // If next() was called instead, this test is vacuously satisfied
});

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
console.log(`middleware: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);
