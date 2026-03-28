/**
 * tests/unit/contradictionResolution.test.mjs
 * ---------------------------------------------
 * Unit tests for the contradiction resolution workflow service (Phase E).
 * Tests both the query helpers and the DB-backed resolution actions.
 */

import assert from 'node:assert/strict';
import { getDb } from '../../server/db/database.js';

import {
  resolveContradiction,
  dismissContradiction,
  acknowledgeContradiction,
  reopenContradiction,
  getContradictionResolution,
  getAllResolutions,
  mergeResolutionStatus,
  buildResolutionSummary,
  RESOLUTION_STATUS,
} from '../../server/contradictionGraph/contradictionResolutionService.js';

const suiteName = 'contradictionResolution';
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  OK   ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error('       ' + err.message);
    failed++;
  }
}

console.log(suiteName);
console.log('─'.repeat(60));

const testCase = 'cres-test-01';

// ── RESOLUTION_STATUS constants ─────────────────────────────────────────────

test('RESOLUTION_STATUS has expected values', () => {
  assert.equal(RESOLUTION_STATUS.OPEN, 'open');
  assert.equal(RESOLUTION_STATUS.RESOLVED, 'resolved');
  assert.equal(RESOLUTION_STATUS.DISMISSED, 'dismissed');
  assert.equal(RESOLUTION_STATUS.ACKNOWLEDGED, 'acknowledged');
});

// ── mergeResolutionStatus ───────────────────────────────────────────────────

test('mergeResolutionStatus adds open status to unresolved items', () => {
  const items = [
    { id: 'c-1', category: 'dates', severity: 'medium', message: 'Date mismatch' },
    { id: 'c-2', category: 'gla', severity: 'high', message: 'GLA mismatch' },
  ];
  const merged = mergeResolutionStatus('nonexistent-case', items);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].resolution.status, 'open');
  assert.equal(merged[1].resolution.status, 'open');
});

// ── buildResolutionSummary ──────────────────────────────────────────────────

test('buildResolutionSummary computes correct counts for all open', () => {
  const items = [
    { id: 'c-1', category: 'dates' },
    { id: 'c-2', category: 'gla' },
  ];
  const summary = buildResolutionSummary('nonexistent-case', items);
  assert.equal(summary.total, 2);
  assert.equal(summary.open, 2);
  assert.equal(summary.resolved, 0);
  assert.equal(summary.allAddressed, false);
  assert.equal(summary.completionPercent, 0);
});

test('buildResolutionSummary handles empty items', () => {
  const summary = buildResolutionSummary('nonexistent-case', []);
  assert.equal(summary.total, 0);
  assert.equal(summary.allAddressed, true);
  assert.equal(summary.completionPercent, 100);
});

// ── DB-backed resolution actions ────────────────────────────────────────────

test('resolveContradiction creates a resolved record in DB', () => {
  const result = resolveContradiction(testCase, 'contra-1', { actor: 'tester', note: 'Fixed the date' });
  assert.equal(result.status, 'resolved');
  assert.equal(result.actor, 'tester');
  assert.equal(result.note, 'Fixed the date');
  assert.ok(result.resolvedAt);
  assert.ok(result.history.length >= 1);
  assert.equal(result.history[result.history.length - 1].action, 'resolve');
});

test('getContradictionResolution returns the resolved record', () => {
  const record = getContradictionResolution(testCase, 'contra-1');
  assert.ok(record);
  assert.equal(record.status, 'resolved');
  assert.equal(record.actor, 'tester');
});

test('dismissContradiction creates a dismissed record', () => {
  const result = dismissContradiction(testCase, 'contra-2', { actor: 'appraiser', reason: 'Acceptable variance' });
  assert.equal(result.status, 'dismissed');
  assert.equal(result.reason, 'Acceptable variance');
  assert.ok(result.history.length >= 1);
});

test('acknowledgeContradiction creates an acknowledged record', () => {
  const result = acknowledgeContradiction(testCase, 'contra-3', { actor: 'reviewer', note: 'Will fix later' });
  assert.equal(result.status, 'acknowledged');
  assert.equal(result.note, 'Will fix later');
});

test('reopenContradiction changes status back to open', () => {
  const result = reopenContradiction(testCase, 'contra-1', { actor: 'supervisor', reason: 'Needs re-review' });
  assert.equal(result.status, 'open');
  assert.ok(result.history.length >= 2); // resolve + reopen
});

test('getAllResolutions returns map of all resolutions for case', () => {
  const all = getAllResolutions(testCase);
  assert.ok(all['contra-1']);
  assert.ok(all['contra-2']);
  assert.ok(all['contra-3']);
  assert.equal(all['contra-1'].status, 'open');
  assert.equal(all['contra-2'].status, 'dismissed');
  assert.equal(all['contra-3'].status, 'acknowledged');
});

test('mergeResolutionStatus reflects DB state for resolved items', () => {
  const items = [
    { id: 'contra-1' },
    { id: 'contra-2' },
    { id: 'contra-3' },
    { id: 'contra-4' }, // not in DB
  ];
  const merged = mergeResolutionStatus(testCase, items);
  assert.equal(merged[0].resolution.status, 'open');       // reopened
  assert.equal(merged[1].resolution.status, 'dismissed');
  assert.equal(merged[2].resolution.status, 'acknowledged');
  assert.equal(merged[3].resolution.status, 'open');        // not in DB
});

test('buildResolutionSummary reflects mixed statuses', () => {
  const items = [
    { id: 'contra-1' },
    { id: 'contra-2' },
    { id: 'contra-3' },
    { id: 'contra-4' },
  ];
  const summary = buildResolutionSummary(testCase, items);
  assert.equal(summary.total, 4);
  assert.equal(summary.open, 2);        // contra-1 (reopened) + contra-4
  assert.equal(summary.dismissed, 1);    // contra-2
  assert.equal(summary.acknowledged, 1); // contra-3
  assert.equal(summary.resolved, 0);
  assert.equal(summary.allAddressed, false);
  assert.equal(summary.completionPercent, 25); // only dismissed counts (1/4)
});

test('resolveContradiction accumulates history across actions', () => {
  // contra-1 was: resolve → reopen, now resolve again
  const result = resolveContradiction(testCase, 'contra-1', { actor: 'appraiser', note: 'Fixed for real' });
  assert.equal(result.status, 'resolved');
  assert.ok(result.history.length >= 3); // resolve, reopen, resolve
  const actions = result.history.map(h => h.action);
  assert.ok(actions.includes('resolve'));
  assert.ok(actions.includes('reopen'));
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('─'.repeat(60));
console.log(`${suiteName}: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));

if (failed > 0) process.exit(1);
