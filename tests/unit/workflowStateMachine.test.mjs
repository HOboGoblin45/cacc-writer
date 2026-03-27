/**
 * tests/unit/workflowStateMachine.test.mjs
 * -----------------------------------------
 * Unit tests for deterministic pipeline transition guardrails.
 */

import assert from 'assert/strict';
import {
  PIPELINE_STAGES,
  getAllowedNextPipelineStages,
  evaluatePipelineTransition,
} from '../../server/caseRecord/workflowStateMachine.js';

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

console.log('\nworkflowStateMachine');

test('exports canonical stage sequence', () => {
  assert.deepEqual(PIPELINE_STAGES, [
    'intake',
    'extracting',
    'generating',
    'review',
    'approved',
    'inserting',
    'complete',
  ]);
});

test('allows forward adjacent transition', () => {
  const result = evaluatePipelineTransition({
    currentStage: 'intake',
    nextStage: 'extracting',
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
});

test('allows idempotent same-stage transition', () => {
  const result = evaluatePipelineTransition({
    currentStage: 'review',
    nextStage: 'review',
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'NO_OP');
});

test('rejects backward transition', () => {
  const result = evaluatePipelineTransition({
    currentStage: 'generating',
    nextStage: 'extracting',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PIPELINE_BACKWARD_NOT_ALLOWED');
});

test('rejects skipped transition', () => {
  const result = evaluatePipelineTransition({
    currentStage: 'extracting',
    nextStage: 'review',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PIPELINE_SKIP_NOT_ALLOWED');
  assert.deepEqual(result.allowedNextStages, ['extracting', 'generating']);
});

test('rejects advancing archived cases', () => {
  const result = evaluatePipelineTransition({
    currentStage: 'review',
    nextStage: 'approved',
    caseStatus: 'archived',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CASE_ARCHIVED_LOCKED');
});

test('complete is terminal', () => {
  const result = evaluatePipelineTransition({
    currentStage: 'complete',
    nextStage: 'approved',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PIPELINE_TERMINAL');
});

test('getAllowedNextPipelineStages returns current + next', () => {
  assert.deepEqual(getAllowedNextPipelineStages('intake'), ['intake', 'extracting']);
  assert.deepEqual(getAllowedNextPipelineStages('complete'), ['complete']);
});

console.log('\n' + '─'.repeat(60));
console.log(`workflowStateMachine: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);

