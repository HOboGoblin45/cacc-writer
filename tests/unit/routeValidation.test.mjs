/**
 * tests/unit/routeValidation.test.mjs
 * -------------------------------------
 * Milestone 7 (Phase A) — Tests for shared route utilities and schema validation.
 */

import assert from 'assert/strict';

let passed = 0;
let failed = 0;
const failures = [];

async function test(label, fn) {
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

// ── Import modules under test ────────────────────────────────────────────────

const { parsePayload, sendError } = await import('../../server/utils/routeUtils.js');
const { z } = await import('zod');

// ── Mock Express response ────────────────────────────────────────────────────

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

// ══════════════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n── Phase A Route Validation Tests ──────────────────────────────');

// ── parsePayload ─────────────────────────────────────────────────────────────

await test('parsePayload — returns parsed data on valid input', () => {
  const schema = z.object({ name: z.string(), age: z.number() });
  const res = mockRes();
  const result = parsePayload(schema, { name: 'Alice', age: 30 }, res);

  assert.deepEqual(result, { name: 'Alice', age: 30 });
  assert.equal(res.statusCode, null, 'should not set status on success');
});

await test('parsePayload — returns null and sends 400 on invalid input', () => {
  const schema = z.object({ name: z.string(), age: z.number() });
  const res = mockRes();
  const result = parsePayload(schema, { name: 123 }, res);

  assert.equal(result, null);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PAYLOAD');
  assert.ok(Array.isArray(res.body.details), 'should include details array');
  assert.ok(res.body.details.length > 0, 'should have at least one detail');
});

await test('parsePayload — details include path and message', () => {
  const schema = z.object({ email: z.string().email() });
  const res = mockRes();
  parsePayload(schema, { email: 'not-an-email' }, res);

  assert.ok(res.body.details[0].path, 'should have path');
  assert.ok(res.body.details[0].message, 'should have message');
});

await test('parsePayload — passthrough allows extra fields', () => {
  const schema = z.object({ name: z.string() }).passthrough();
  const res = mockRes();
  const result = parsePayload(schema, { name: 'Alice', extra: true }, res);

  assert.deepEqual(result, { name: 'Alice', extra: true });
});

await test('parsePayload — handles empty object with required fields', () => {
  const schema = z.object({ name: z.string() });
  const res = mockRes();
  const result = parsePayload(schema, {}, res);

  assert.equal(result, null);
  assert.equal(res.statusCode, 400);
});

// ── sendError ────────────────────────────────────────────────────────────────

await test('sendError — sends basic error response', () => {
  const res = mockRes();
  sendError(res, 404, 'Not found');

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'Not found');
  assert.equal(res.body.code, undefined);
});

await test('sendError — includes code when provided', () => {
  const res = mockRes();
  sendError(res, 400, 'Invalid input', 'INVALID_PAYLOAD');

  assert.equal(res.body.code, 'INVALID_PAYLOAD');
});

await test('sendError — includes extra fields when provided', () => {
  const res = mockRes();
  sendError(res, 409, 'Conflict', 'CONFLICT', { details: ['a', 'b'] });

  assert.equal(res.body.error, 'Conflict');
  assert.deepEqual(res.body.details, ['a', 'b']);
});

// ── Schema validation patterns used in routes ────────────────────────────────

await test('learning route schemas — applicationOutcome validates enum', () => {
  const schema = z.object({ outcome: z.enum(['accepted', 'rejected', 'ignored']) });
  const res = mockRes();

  const valid = parsePayload(schema, { outcome: 'accepted' }, res);
  assert.ok(valid, 'should accept valid outcome');

  const res2 = mockRes();
  const invalid = parsePayload(schema, { outcome: 'invalid' }, res2);
  assert.equal(invalid, null, 'should reject invalid outcome');
  assert.equal(res2.statusCode, 400);
});

await test('export route schemas — deliverSchema requires exportJobId', () => {
  const schema = z.object({
    exportJobId: z.string().min(1).max(80),
    method: z.string().max(40).optional(),
  }).passthrough();

  const res = mockRes();
  const invalid = parsePayload(schema, { method: 'email' }, res);
  assert.equal(invalid, null, 'should reject without exportJobId');

  const res2 = mockRes();
  const valid = parsePayload(schema, { exportJobId: 'job-123', method: 'email' }, res2);
  assert.ok(valid, 'should accept with exportJobId');
});

await test('business route schemas — recordPayment validates positive amount', () => {
  const schema = z.object({
    amount: z.number().positive(),
    method: z.string().max(60).optional(),
  }).passthrough();

  const res = mockRes();
  const invalid = parsePayload(schema, { amount: -5 }, res);
  assert.equal(invalid, null, 'should reject negative amount');

  const res2 = mockRes();
  const valid = parsePayload(schema, { amount: 100 }, res2);
  assert.ok(valid, 'should accept positive amount');
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const { label, err } of failures) {
    console.log(`  - ${label}: ${err.message}`);
  }
}
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);
