/**
 * tests/unit/caseApprovalGate.test.mjs
 * -------------------------------------
 * Unit tests for deterministic case approval QC gate.
 */

import assert from 'assert/strict';
import { evaluateCaseApprovalGate } from '../../server/qc/caseApprovalGate.js';

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

console.log('\ncaseApprovalGate');

test('returns CASE_ID_REQUIRED when caseId is blank', () => {
  const gate = evaluateCaseApprovalGate('', {
    listQcRuns: () => [],
    getFindings: () => [],
    listGenerationRuns: () => [],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'CASE_ID_REQUIRED');
});

test('returns QC_REQUIRED_BEFORE_APPROVAL when no QC runs exist', () => {
  const gate = evaluateCaseApprovalGate('abc12345', {
    listQcRuns: () => [],
    getFindings: () => [],
    listGenerationRuns: () => [],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'QC_REQUIRED_BEFORE_APPROVAL');
});

test('returns QC_IN_PROGRESS when latest QC run is running', () => {
  const gate = evaluateCaseApprovalGate('abc12345', {
    listQcRuns: () => [{ id: 'run-1', status: 'running', draft_readiness: 'unknown', created_at: '2026-03-12T00:00:00Z' }],
    getFindings: () => [],
    listGenerationRuns: () => [],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'QC_IN_PROGRESS');
  assert.equal(gate.latestQcRun?.qcRunId, 'run-1');
});

test('returns QC_BLOCKERS_OPEN when latest completed run has open blocker findings', () => {
  const gate = evaluateCaseApprovalGate('abc12345', {
    listQcRuns: () => [{ id: 'run-2', status: 'complete', draft_readiness: 'not_ready', created_at: '2026-03-12T00:00:00Z' }],
    getFindings: () => [{ id: 'finding-1' }],
    listGenerationRuns: () => [],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'QC_BLOCKERS_OPEN');
  assert.equal(gate.openBlockerCount, 1);
});

test('returns QC_NOT_READY when latest completed run has no blockers but not_ready status', () => {
  const gate = evaluateCaseApprovalGate('abc12345', {
    listQcRuns: () => [{ id: 'run-3', status: 'complete', draft_readiness: 'not_ready', created_at: '2026-03-12T00:00:00Z' }],
    getFindings: () => [],
    listGenerationRuns: () => [],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'QC_NOT_READY');
});

// Helper: standard passing deps (all checks pass)
function passingDeps(overrides = {}) {
  return {
    listQcRuns: () => [{ id: 'run-ok', status: 'complete', draft_readiness: 'ready', created_at: '2026-03-12T00:00:00Z' }],
    getFindings: () => [],
    listGenerationRuns: () => [],
    evaluateAllSectionsFreshness: () => ({ sections: [], summary: { total: 0, current: 0, stale: 0, notGenerated: 0 } }),
    buildContradictionGraph: () => ({ items: [] }),
    buildResolutionSummary: () => ({ total: 0, open: 0, resolved: 0, dismissed: 0, acknowledged: 0, allAddressed: true }),
    ...overrides,
  };
}

test('returns OK when latest completed run has no open blocker findings', () => {
  const gate = evaluateCaseApprovalGate('abc12345', passingDeps());
  assert.equal(gate.ok, true);
  assert.equal(gate.code, 'OK');
  assert.equal(gate.latestQcRun?.qcRunId, 'run-ok');
});

test('accepts legacy completed QC status as complete for gate evaluation', () => {
  const gate = evaluateCaseApprovalGate('abc12345', passingDeps({
    listQcRuns: () => [{ id: 'run-legacy', status: 'completed', draft_readiness: 'ready', created_at: '2026-03-12T00:00:00Z' }],
  }));
  assert.equal(gate.ok, true);
  assert.equal(gate.code, 'OK');
  assert.equal(gate.latestQcRun?.qcRunId, 'run-legacy');
});

test('returns QC_STALE_FOR_CURRENT_DRAFT when generation run is newer than latest QC run', () => {
  const gate = evaluateCaseApprovalGate('abc12345', {
    listQcRuns: () => [{ id: 'run-5', status: 'complete', draft_readiness: 'ready', created_at: '2026-03-12T00:00:00Z' }],
    listGenerationRuns: () => [{ id: 'gen-1', status: 'complete', created_at: '2026-03-12T01:00:00Z' }],
    getFindings: () => [],
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'QC_STALE_FOR_CURRENT_DRAFT');
  assert.equal(gate.latestGenerationRun?.runId, 'gen-1');
});

// ── Milestone 4: New gate checks ──────────────────────────────────────────────

test('returns SECTIONS_STALE when generated sections are stale', () => {
  const gate = evaluateCaseApprovalGate('abc12345', passingDeps({
    evaluateAllSectionsFreshness: () => ({
      sections: [
        { sectionId: 'neighborhood_description', freshness: 'stale_due_to_fact_change', qualityScore: 75, regenerationCount: 1 },
      ],
      summary: { total: 1, current: 0, stale: 1, notGenerated: 0 },
    }),
  }));
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'SECTIONS_STALE');
  assert.equal(gate.staleSectionCount, 1);
  assert.ok(gate.staleSections.includes('neighborhood_description'));
});

test('returns SECTIONS_LOW_QUALITY when quality score is below threshold', () => {
  const gate = evaluateCaseApprovalGate('abc12345', passingDeps({
    evaluateAllSectionsFreshness: () => ({
      sections: [
        { sectionId: 'reconciliation', freshness: 'current', qualityScore: 15, regenerationCount: 0 },
      ],
      summary: { total: 1, current: 1, stale: 0, notGenerated: 0 },
    }),
  }));
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'SECTIONS_LOW_QUALITY');
  assert.equal(gate.lowQualitySections.length, 1);
  assert.equal(gate.lowQualitySections[0].sectionId, 'reconciliation');
  assert.equal(gate.lowQualitySections[0].qualityScore, 15);
});

test('returns CONTRADICTIONS_UNRESOLVED when open contradictions exist', () => {
  const gate = evaluateCaseApprovalGate('abc12345', passingDeps({
    buildContradictionGraph: () => ({
      items: [{ id: 'c1' }, { id: 'c2' }],
    }),
    buildResolutionSummary: () => ({
      total: 2, open: 1, resolved: 1, dismissed: 0, acknowledged: 0, allAddressed: false,
    }),
  }));
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'CONTRADICTIONS_UNRESOLVED');
  assert.equal(gate.contradictionSummary.open, 1);
  assert.equal(gate.contradictionSummary.total, 2);
});

test('returns OK when all contradictions are resolved', () => {
  const gate = evaluateCaseApprovalGate('abc12345', passingDeps({
    buildContradictionGraph: () => ({
      items: [{ id: 'c1' }, { id: 'c2' }],
    }),
    buildResolutionSummary: () => ({
      total: 2, open: 0, resolved: 2, dismissed: 0, acknowledged: 0, allAddressed: true,
    }),
  }));
  assert.equal(gate.ok, true);
  assert.equal(gate.code, 'OK');
});

test('returns OK when quality scores are above threshold', () => {
  const gate = evaluateCaseApprovalGate('abc12345', passingDeps({
    evaluateAllSectionsFreshness: () => ({
      sections: [
        { sectionId: 'neighborhood_description', freshness: 'current', qualityScore: 85, regenerationCount: 1 },
        { sectionId: 'reconciliation', freshness: 'current', qualityScore: 72, regenerationCount: 0 },
      ],
      summary: { total: 2, current: 2, stale: 0, notGenerated: 0 },
    }),
  }));
  assert.equal(gate.ok, true);
  assert.equal(gate.code, 'OK');
});

console.log('\n' + '-'.repeat(60));
console.log(`caseApprovalGate: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  X ' + label);
    console.log('    ' + err.message);
  });
}
console.log('-'.repeat(60));
if (failed > 0) process.exit(1);
