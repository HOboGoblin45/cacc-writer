/**
 * tests/unit/authMiddleware.test.mjs
 * Unit tests for authentication middleware scaffold.
 */

import assert from 'assert';
import { requireAuth, requireRole } from '../../server/middleware/authMiddleware.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('  OK   ' + name);
    passed++;
  } catch (err) {
    console.log('  FAIL ' + name);
    console.log('       ' + err.message);
    failed++;
  }
}

async function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

await test('requireAuth passes through when AUTH_ENABLED is not set', () => {
  let called = false;
  const req = { headers: {}, path: '/api/cases' };
  const res = {};
  const next = () => { called = true; };
  requireAuth(req, res, next);
  assert.strictEqual(called, true);
});

await test('exports requireAuth and requireRole functions', () => {
  assert.strictEqual(typeof requireAuth, 'function');
  assert.strictEqual(typeof requireRole, 'function');
});

await test('requireRole returns middleware that passes through when AUTH_ENABLED is not set', () => {
  const middleware = requireRole('admin');
  assert.strictEqual(typeof middleware, 'function');
  let called = false;
  const req = { headers: {}, path: '/api/cases' };
  const res = {};
  const next = () => { called = true; };
  middleware(req, res, next);
  assert.strictEqual(called, true);
});

await test('requireAuth returns 503 when auth is enabled but API key is missing', async () => {
  await withEnv({ CACC_AUTH_ENABLED: 'true', CACC_API_KEY: undefined }, async () => {
    const { requireAuth: requireAuthEnabled } = await import(`../../server/middleware/authMiddleware.js?test=${Date.now()}`);
    let called = false;
    const req = { headers: {}, path: '/api/cases' };
    const res = {
      _status: null,
      _body: null,
      status(code) { this._status = code; return this; },
      json(body) { this._body = body; return this; },
    };
    const next = () => { called = true; };

    requireAuthEnabled(req, res, next);

    assert.strictEqual(called, false);
    assert.strictEqual(res._status, 503);
    assert.strictEqual(res._body?.code, 'AUTH_MISCONFIGURED');
  });
});

await test('requireAuth validates bearer token when auth is enabled', async () => {
  await withEnv({ CACC_AUTH_ENABLED: 'true', CACC_API_KEY: 'test-key-123' }, async () => {
    const { requireAuth: requireAuthEnabled } = await import(`../../server/middleware/authMiddleware.js?test=${Date.now()}-2`);
    let called = false;
    const req = {
      headers: { authorization: 'Bearer test-key-123' },
      path: '/api/cases',
    };
    const res = {
      status() { throw new Error('status should not be called for valid auth'); },
      json() { throw new Error('json should not be called for valid auth'); },
    };
    const next = () => { called = true; };

    requireAuthEnabled(req, res, next);

    assert.strictEqual(called, true);
    assert.deepStrictEqual(req.authenticatedUser, { role: 'admin', source: 'api_key' });
  });
});

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('────────────────────────────────────────────────────────────');
console.log(`authMiddleware: ${passed} passed, ${failed} failed`);
console.log('────────────────────────────────────────────────────────────');
if (failed > 0) process.exit(1);
