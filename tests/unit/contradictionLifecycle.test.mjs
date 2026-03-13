/**
 * tests/unit/contradictionLifecycle.test.mjs
 * -------------------------------------------
 * Unit tests for the contradiction lifecycle: gate checks, history,
 * and integration with the resolution service.
 */

import assert from 'node:assert/strict';
import { getDb } from '../../server/db/database.js';

import {
  resolveContradiction,
  dismissContradiction,
  acknowledgeContradiction,
  reopenContradiction,
  getAllResolutions,
  buildResolutionSummary,
  mergeResolutionStatus,
  RESOLUTION_STATUS,
} from '../../server/contradictionGraph/contradictionResolutionService.js';

import {
  checkContradictionGate,
  getContradictionHistory,
} from '../../server/contradictionGraph/contradictionGateService.js';

const suiteName = 'contradictionLifecycle';
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
console.log('-'.repeat(60));

const testCase = 'clc-test-' + Date.now();

// ── Gate check with no contradictions ──────────────────────────────────────

test('gate check with no contradictions should pass', () => {
  // Use a case with no graph items (buildContradictionGraph will fail gracefully)
  const result = checkContradictionGate('nonexistent-case-no-contradictions');
  assert.equal(result.passed, true);
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.open, 0);
  assert.equal(result.blockers.length, 0);
});

// ── Gate check with open contradictions ────────────────────────────────────

test('gate check with open contradictions should fail', () => {
  // Simulate: we pass graph items that have no resolutions (they are open by default)
  const fakeGraphItems = [
    { id: 'gc-1', category: 'dates', severity: 'high', message: 'Date mismatch' },
    { id: 'gc-2', category: 'gla', severity: 'medium', message: 'GLA mismatch' },
  ];
  const summary = buildResolutionSummary(testCase, fakeGraphItems);
  assert.equal(summary.allAddressed, false);
  assert.equal(summary.open, 2);
});

// ── Resolution followed by gate check ──────────────────────────────────────

test('resolve all contradictions then gate should pass', () => {
  const gateCase = 'gate-case-' + Date.now();
  // Resolve two contradictions
  resolveContradiction(gateCase, 'g-1', { actor: 'tester', note: 'Fixed' });
  dismissContradiction(gateCase, 'g-2', { actor: 'tester', reason: 'Acceptable' });

  // Simulate graph items matching those IDs
  const items = [{ id: 'g-1' }, { id: 'g-2' }];
  const summary = buildResolutionSummary(gateCase, items);
  assert.equal(summary.allAddressed, true);
  assert.equal(summary.open, 0);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.dismissed, 1);
});

// ── Summary computation ───────────────────────────────────────────────────

test('summary includes all status counts', () => {
  const summaryCase = 'summary-case-' + Date.now();
  resolveContradiction(summaryCase, 's-1', { actor: 'a', note: '' });
  dismissContradiction(summaryCase, 's-2', { actor: 'a', reason: '' });
  acknowledgeContradiction(summaryCase, 's-3', { actor: 'a', note: '' });

  const items = [{ id: 's-1' }, { id: 's-2' }, { id: 's-3' }, { id: 's-4' }];
  const summary = buildResolutionSummary(summaryCase, items);
  assert.equal(summary.total, 4);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.dismissed, 1);
  assert.equal(summary.acknowledged, 1);
  assert.equal(summary.open, 1);
  assert.equal(summary.completionPercent, 50); // (resolved + dismissed) / total
});

test('summary completionPercent is 100 for empty graph', () => {
  const summary = buildResolutionSummary('empty-case', []);
  assert.equal(summary.completionPercent, 100);
  assert.equal(summary.allAddressed, true);
});

// ── History retrieval ─────────────────────────────────────────────────────

test('history retrieval returns timeline events', () => {
  const histCase = 'hist-case-' + Date.now();
  resolveContradiction(histCase, 'h-1', { actor: 'appraiser', note: 'Fixed date' });
  reopenContradiction(histCase, 'h-1', { actor: 'reviewer', reason: 'Needs re-check' });
  dismissContradiction(histCase, 'h-2', { actor: 'appraiser', reason: 'OK' });

  const history = getContradictionHistory(histCase);
  assert.ok(history.length >= 3);
  // First event should be chronologically earliest
  const actions = history.map(e => e.action);
  assert.ok(actions.includes('resolve'));
  assert.ok(actions.includes('reopen'));
  assert.ok(actions.includes('dismiss'));
});

test('history for nonexistent case returns empty array', () => {
  const history = getContradictionHistory('no-such-case');
  assert.ok(Array.isArray(history));
  assert.equal(history.length, 0);
});

// ── Reopen changes gate status ─────────────────────────────────────────────

test('reopening a contradiction changes gate from pass to fail', () => {
  const reopCase = 'reop-case-' + Date.now();
  resolveContradiction(reopCase, 'r-1', { actor: 'a', note: '' });

  const items = [{ id: 'r-1' }];
  const beforeReopen = buildResolutionSummary(reopCase, items);
  assert.equal(beforeReopen.allAddressed, true);

  reopenContradiction(reopCase, 'r-1', { actor: 'supervisor', reason: 'Re-review' });
  const afterReopen = buildResolutionSummary(reopCase, items);
  assert.equal(afterReopen.allAddressed, false);
  assert.equal(afterReopen.open, 1);
});

// ── Acknowledged items are not blockers (allAddressed = true) ────────────

test('acknowledged items count as addressed', () => {
  const ackCase = 'ack-case-' + Date.now();
  acknowledgeContradiction(ackCase, 'a-1', { actor: 'appraiser', note: 'Noted' });

  const items = [{ id: 'a-1' }];
  const summary = buildResolutionSummary(ackCase, items);
  assert.equal(summary.allAddressed, true);
  assert.equal(summary.acknowledged, 1);
  assert.equal(summary.open, 0);
});

// ── History events have proper structure ────────────────────────────────

test('history events contain contradictionId, action, actor, and timestamp', () => {
  const structCase = 'struct-case-' + Date.now();
  resolveContradiction(structCase, 'st-1', { actor: 'tester', note: 'Done' });

  const history = getContradictionHistory(structCase);
  assert.ok(history.length >= 1);
  const event = history[0];
  assert.equal(event.contradictionId, 'st-1');
  assert.equal(event.action, 'resolve');
  assert.equal(event.actor, 'tester');
  assert.ok(event.at, 'event should have a timestamp');
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log('-'.repeat(60));
console.log(`${suiteName}: ${passed} passed, ${failed} failed`);
console.log('-'.repeat(60));

if (failed > 0) process.exit(1);
