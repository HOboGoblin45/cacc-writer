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

// ── Summary ────────────────────────────────────────────────────────────────────

console.log('────────────────────────────────────────────────────────────');
console.log(`authMiddleware: ${passed} passed, ${failed} failed`);
console.log('────────────────────────────────────────────────────────────');
if (failed > 0) process.exit(1);
