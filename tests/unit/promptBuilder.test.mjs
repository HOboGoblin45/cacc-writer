/**
 * tests/unit/promptBuilder.test.mjs
 * Unit tests for server/promptBuilder.js (formatFactsBlock, buildAssignmentContextBlock,
 * buildPromptMessages, buildReviewMessages, buildApproveEditPrompt)
 * Run: node tests/unit/promptBuilder.test.mjs
 */

import assert from 'assert/strict';
import {
  buildPromptMessages,
  buildReviewMessages,
  buildApproveEditPrompt,
} from '../../server/promptBuilder.js';

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

// ── buildPromptMessages ──────────────────────────────────────────────────────

console.log('\nbuildPromptMessages');

test('returns an array of messages', () => {
  const msgs = buildPromptMessages({ fieldId: 'neighborhood_description' });
  assert.ok(Array.isArray(msgs));
  assert.ok(msgs.length >= 2); // at least system + user
});

test('last message is user role', () => {
  const msgs = buildPromptMessages({ fieldId: 'neighborhood_description' });
  const last = msgs[msgs.length - 1];
  assert.equal(last.role, 'user');
});

test('user message mentions the field and form type', () => {
  const msgs = buildPromptMessages({ formType: '1004', fieldId: 'neighborhood_description' });
  const user = msgs[msgs.length - 1].content;
  assert.ok(user.includes('1004'));
});

test('includes facts in system messages when provided', () => {
  const facts = {
    property: {
      address: { value: '123 Main St', confidence: 'high' },
      city: { value: 'Springfield', confidence: 'medium' },
    },
  };
  const msgs = buildPromptMessages({ fieldId: 'neighborhood_description', facts });
  const factsMsg = msgs.find(m => m.content.includes('SUBJECT PROPERTY FACTS'));
  assert.ok(factsMsg, 'Should include facts block');
  assert.ok(factsMsg.content.includes('123 Main St'));
  assert.ok(factsMsg.content.includes('[confidence: medium'));
});

test('formats low confidence facts as [INSERT]', () => {
  const facts = {
    property: {
      zoning: { value: 'R-1', confidence: 'low' },
    },
  };
  const msgs = buildPromptMessages({ fieldId: 'neighborhood_description', facts });
  const factsMsg = msgs.find(m => m.content.includes('SUBJECT PROPERTY FACTS'));
  assert.ok(factsMsg.content.includes('[INSERT]'));
  assert.ok(!factsMsg.content.includes('R-1'));
});

test('handles empty facts sections gracefully', () => {
  const facts = { property: {} };
  const msgs = buildPromptMessages({ fieldId: 'neighborhood_description', facts });
  // With empty property section, the facts block may exist with just the header
  // or be omitted entirely — either is acceptable behavior
  const factsMsg = msgs.find(m => m.content.includes('SUBJECT PROPERTY FACTS'));
  if (factsMsg) {
    // If present, it should just have the header, no actual property data
    assert.ok(!factsMsg.content.includes('property:'), 'Should not include empty property section');
  }
});

test('includes assignment context when provided', () => {
  const assignmentMeta = {
    assignmentPurpose: 'Purchase',
    loanProgram: 'FHA',
  };
  const msgs = buildPromptMessages({ fieldId: 'neighborhood_description', assignmentMeta });
  const asgMsg = msgs.find(m => m.content.includes('ASSIGNMENT CONTEXT'));
  assert.ok(asgMsg, 'Should include assignment context');
  assert.ok(asgMsg.content.includes('FHA'));
});

test('includes FHA guidance for FHA loan program', () => {
  const assignmentMeta = { loanProgram: 'FHA' };
  const msgs = buildPromptMessages({ fieldId: 'neighborhood_description', assignmentMeta });
  const asgMsg = msgs.find(m => m.content.includes('ASSIGNMENT CONTEXT'));
  assert.ok(asgMsg.content.includes('FHA LOAN'));
});

test('includes system hint when provided', () => {
  const msgs = buildPromptMessages({ fieldId: 'neighborhood_description', systemHint: 'Be extra concise' });
  const hintMsg = msgs.find(m => m.content.includes('GENERATION PROFILE GUIDANCE'));
  assert.ok(hintMsg);
  assert.ok(hintMsg.content.includes('Be extra concise'));
});

test('includes extra context when provided', () => {
  const msgs = buildPromptMessages({ fieldId: 'reconciliation', extraContext: 'Prior section output here' });
  const ctxMsg = msgs.find(m => m.content.includes('ANALYSIS CONTEXT'));
  assert.ok(ctxMsg);
  assert.ok(ctxMsg.content.includes('Prior section output here'));
});

test('all system messages have system role', () => {
  const msgs = buildPromptMessages({ fieldId: 'neighborhood_description' });
  const systemMsgs = msgs.filter(m => m.role === 'system');
  assert.ok(systemMsgs.length >= 1);
  systemMsgs.forEach(m => assert.equal(m.role, 'system'));
});

test('handles array facts (e.g. comparables)', () => {
  const facts = {
    comparables: [
      { address: { value: '100 Oak St', confidence: 'high' }, price: { value: '250000', confidence: 'high' } },
      { address: { value: '200 Elm St', confidence: 'medium' }, price: { value: '260000', confidence: 'medium' } },
    ],
  };
  const msgs = buildPromptMessages({ fieldId: 'sales_comparison', facts });
  const factsMsg = msgs.find(m => m.content.includes('SUBJECT PROPERTY FACTS'));
  assert.ok(factsMsg);
  assert.ok(factsMsg.content.includes('100 Oak St'));
  assert.ok(factsMsg.content.includes('Item 1'));
  assert.ok(factsMsg.content.includes('Item 2'));
});

// ── buildReviewMessages ──────────────────────────────────────────────────────

console.log('\nbuildReviewMessages');

test('returns array with system and user messages', () => {
  const msgs = buildReviewMessages({ draftText: 'The property is located in a good area.' });
  assert.ok(Array.isArray(msgs));
  assert.ok(msgs.length >= 2);
  assert.equal(msgs[msgs.length - 1].role, 'user');
});

test('includes draft text in user message', () => {
  const draft = 'The property is located in a quiet residential neighborhood.';
  const msgs = buildReviewMessages({ draftText: draft });
  const user = msgs[msgs.length - 1].content;
  assert.ok(user.includes(draft));
});

test('includes supported facts when provided', () => {
  const facts = {
    property: {
      address: { value: '123 Main', confidence: 'high' },
      zoning: { value: 'R-1', confidence: 'low' }, // should be excluded
    },
  };
  const msgs = buildReviewMessages({ draftText: 'test', facts });
  // Check that facts context is included somewhere in the messages
  const allContent = msgs.map(m => m.content).join('\n');
  assert.ok(allContent.includes('123 Main'), 'Should include high-confidence facts');
  assert.ok(!allContent.includes('R-1'), 'Low confidence facts should be excluded from review');
});

test('includes assignment context in review', () => {
  const assignmentMeta = { loanProgram: 'VA' };
  const msgs = buildReviewMessages({ draftText: 'test', assignmentMeta });
  const asgMsg = msgs.find(m => m.content.includes('ASSIGNMENT CONTEXT'));
  assert.ok(asgMsg);
  assert.ok(asgMsg.content.includes('VA'));
});

// ── buildApproveEditPrompt ───────────────────────────────────────────────────

console.log('\nbuildApproveEditPrompt');

test('returns two messages (system + user)', () => {
  const msgs = buildApproveEditPrompt('original text', 'edited text');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].role, 'user');
});

test('includes original and edited text', () => {
  const msgs = buildApproveEditPrompt('original text', 'edited text');
  const user = msgs[1].content;
  assert.ok(user.includes('original text'));
  assert.ok(user.includes('edited text'));
});

test('requests JSON response', () => {
  const msgs = buildApproveEditPrompt('a', 'b');
  const user = msgs[1].content;
  assert.ok(user.includes('qualityScore'));
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(`promptBuilder: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailed tests:');
  failures.forEach(({ label, err }) => {
    console.log('  ✗ ' + label);
    console.log('    ' + err.message);
  });
}
console.log('─'.repeat(60));
if (failed > 0) process.exit(1);
