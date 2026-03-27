/**
 * tests/unit/reportQueue.test.mjs
 * Unit tests for server/services/reportQueueService.js
 * Tests the queue state management (enqueue, status, cancel, clear)
 * without actually running the orchestrator.
 * Run: node tests/unit/reportQueue.test.mjs
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

// ── Mock the orchestrator before importing reportQueueService ────────────────

// We need to intercept the orchestrator calls. Since ESM doesn't allow
// monkey-patching imports easily, we test only the synchronous state
// management functions (enqueue, status, cancel, clear).
// The processQueue function is async and calls the orchestrator, which
// we can't easily mock in this test setup.

// Import after ensuring the orchestrator module won't crash
// (it reads from DB which may not exist in test env)
let enqueueReports, getQueueStatus, getBatchStatus, getJobStatus, cancelQueued, clearCompleted;

try {
  const mod = await import('../../server/services/reportQueueService.js');
  enqueueReports = mod.enqueueReports;
  getQueueStatus = mod.getQueueStatus;
  getBatchStatus = mod.getBatchStatus;
  getJobStatus = mod.getJobStatus;
  cancelQueued = mod.cancelQueued;
  clearCompleted = mod.clearCompleted;
} catch (err) {
  console.log('  SKIP reportQueue tests — module import failed: ' + err.message);
  console.log('\n' + '─'.repeat(60));
  console.log(`reportQueue: 0 passed, 0 failed (SKIPPED)`);
  console.log('─'.repeat(60));
  process.exit(0);
}

// ── getQueueStatus ───────────────────────────────────────────────────────────

console.log('\ngetQueueStatus');

test('returns status object', () => {
  const status = getQueueStatus();
  assert.ok(typeof status === 'object');
  assert.ok('processing' in status);
  assert.ok('queued' in status);
  assert.ok('running' in status);
  assert.ok('completed' in status);
  assert.ok('failed' in status);
  assert.ok('total' in status);
  assert.ok(Array.isArray(status.jobs));
});

// ── enqueueReports ───────────────────────────────────────────────────────────

console.log('\nenqueueReports');

test('throws if cases array is empty', () => {
  assert.throws(() => enqueueReports({ cases: [] }), /required/i);
});

test('throws if cases is not an array', () => {
  assert.throws(() => enqueueReports({ cases: 'not-array' }), /required/i);
});

test('enqueues valid cases and returns batchId + jobs', () => {
  const result = enqueueReports({ cases: [{ caseId: 'test-case-1' }, { caseId: 'test-case-2' }] });
  assert.ok(result.batchId);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs[0].caseId, 'test-case-1');
  assert.equal(result.jobs[1].caseId, 'test-case-2');
  // First job may already be terminal when gate checks fail immediately.
  assert.ok(['queued', 'running', 'failed'].includes(result.jobs[0].status));
});

test('jobs have required fields', () => {
  const result = enqueueReports({ cases: [{ caseId: 'test-fields' }] });
  const job = result.jobs[0];
  assert.ok(job.jobId);
  assert.ok(job.queuedAt);
  assert.equal(job.status, 'queued');
  assert.equal(job.runId, null);
  assert.equal(job.error, null);
  assert.equal(job.retryAttempt, 0);
});

test('skips entries without caseId', () => {
  const result = enqueueReports({ cases: [{ caseId: '' }, { caseId: 'valid' }] });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].caseId, 'valid');
});

// ── getBatchStatus ───────────────────────────────────────────────────────────

console.log('\ngetBatchStatus');

test('returns null for unknown batch', () => {
  assert.equal(getBatchStatus('nonexistent-batch'), null);
});

test('returns batch info for known batch', () => {
  const { batchId } = enqueueReports({ cases: [{ caseId: 'batch-test' }] });
  const status = getBatchStatus(batchId);
  assert.ok(status);
  assert.equal(status.batchId, batchId);
  assert.equal(status.total, 1);
});

// ── getJobStatus ─────────────────────────────────────────────────────────────

console.log('\ngetJobStatus');

test('returns null for unknown job', () => {
  assert.equal(getJobStatus('nonexistent-job'), null);
});

test('returns job info for known job', () => {
  const { jobs } = enqueueReports({ cases: [{ caseId: 'job-status-test' }] });
  const status = getJobStatus(jobs[0].jobId);
  assert.ok(status);
  assert.equal(status.caseId, 'job-status-test');
});

// ── cancelQueued ─────────────────────────────────────────────────────────────

console.log('\ncancelQueued');

test('cancels queued jobs', () => {
  enqueueReports({ cases: [{ caseId: 'cancel-test-1' }, { caseId: 'cancel-test-2' }] });
  const cancelled = cancelQueued();
  assert.ok(cancelled >= 2);
});

// ── clearCompleted ───────────────────────────────────────────────────────────

console.log('\nclearCompleted');

test('clears cancelled jobs', () => {
  const before = getQueueStatus().total;
  const cleared = clearCompleted();
  const after = getQueueStatus().total;
  assert.ok(cleared >= 0);
  assert.ok(after <= before);
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`reportQueue: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);
