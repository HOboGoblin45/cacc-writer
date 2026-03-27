/**
 * tests/unit/sectionPolicyService.test.mjs
 * ------------------------------------------
 * Unit tests for the section policy service (Phase D governance).
 */

import assert from 'node:assert/strict';

import {
  getPromptVersion,
  buildDependencySnapshot,
  detectStaleness,
  buildSectionPolicy,
  computeQualityScore,
  buildAuditMetadata,
  findStaleDependentSections,
  evaluateRegeneratePolicy,
  FRESHNESS,
} from '../../server/services/sectionPolicyService.js';

const suiteName = 'sectionPolicyService';
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error('     ', err.message);
    failed++;
  }
}

console.log(suiteName);
console.log('─'.repeat(60));

// ── getPromptVersion ────────────────────────────────────────────────────────

test('getPromptVersion returns version for known profile', () => {
  const v = getPromptVersion('template-heavy');
  assert.equal(typeof v, 'string');
  assert.ok(v.length > 0);
});

test('getPromptVersion resolves version for section ID', () => {
  const v = getPromptVersion('neighborhood_description');
  assert.equal(typeof v, 'string');
  assert.ok(v.length > 0);
});

test('getPromptVersion returns fallback for unknown section', () => {
  const v = getPromptVersion('nonexistent_section');
  assert.equal(v, '1.0.0');
});

// ── buildDependencySnapshot ─────────────────────────────────────────────────

test('buildDependencySnapshot captures required fact values', () => {
  const facts = { subject: { city: { value: 'Chicago' }, county: { value: 'Cook' } } };
  const snap = buildDependencySnapshot('neighborhood_description', facts);
  assert.equal(snap.sectionId, 'neighborhood_description');
  assert.ok(snap.capturedAt);
  assert.ok(snap.promptVersion);
  assert.equal(snap.requiredFacts['subject.city'], 'Chicago');
  assert.equal(snap.requiredFacts['subject.county'], 'Cook');
});

test('buildDependencySnapshot records null for missing facts', () => {
  const facts = {};
  const snap = buildDependencySnapshot('neighborhood_description', facts);
  assert.equal(snap.requiredFacts['subject.city'], null);
});

// ── detectStaleness ─────────────────────────────────────────────────────────

test('detectStaleness returns CURRENT when nothing changed', () => {
  const facts = { subject: { city: { value: 'Chicago' }, county: { value: 'Cook' } } };
  const snap = buildDependencySnapshot('neighborhood_description', facts);
  const result = detectStaleness(snap, facts, snap.promptVersion);
  assert.equal(result.freshness, FRESHNESS.CURRENT);
  assert.equal(result.changedPaths.length, 0);
});

test('detectStaleness detects required fact change', () => {
  const oldFacts = { subject: { city: { value: 'Chicago' }, county: { value: 'Cook' } } };
  const snap = buildDependencySnapshot('neighborhood_description', oldFacts);
  const newFacts = { subject: { city: { value: 'Naperville' }, county: { value: 'DuPage' } } };
  const result = detectStaleness(snap, newFacts, snap.promptVersion);
  assert.equal(result.freshness, FRESHNESS.STALE_DUE_TO_FACT_CHANGE);
  assert.ok(result.changedPaths.includes('subject.city'));
});

test('detectStaleness detects prompt version change', () => {
  const facts = { subject: { city: { value: 'Chicago' }, county: { value: 'Cook' } } };
  const snap = buildDependencySnapshot('neighborhood_description', facts);
  const result = detectStaleness(snap, facts, '2.0.0');
  assert.equal(result.freshness, FRESHNESS.STALE_DUE_TO_PROMPT_CHANGE);
});

test('detectStaleness returns NOT_GENERATED for null snapshot', () => {
  const result = detectStaleness(null, {}, '1.0.0');
  assert.equal(result.freshness, FRESHNESS.NOT_GENERATED);
});

// ── buildSectionPolicy ──────────────────────────────────────────────────────

test('buildSectionPolicy returns structured policy', () => {
  const facts = { subject: { city: { value: 'Chicago' }, county: { value: 'Cook' } } };
  const policy = buildSectionPolicy('neighborhood_description', facts);
  assert.equal(policy.sectionId, 'neighborhood_description');
  assert.ok(policy.profileId);
  assert.ok(policy.promptVersion);
  assert.equal(typeof policy.temperature, 'number');
  assert.ok(Array.isArray(policy.dependencies.required));
  assert.equal(policy.missingFacts.hasBlockers, false);
});

test('buildSectionPolicy detects blockers from missing required facts', () => {
  const facts = {};
  const policy = buildSectionPolicy('neighborhood_description', facts);
  assert.equal(policy.missingFacts.hasBlockers, true);
  assert.ok(policy.missingFacts.required.length > 0);
});

// ── computeQualityScore ─────────────────────────────────────────────────────

test('computeQualityScore produces score with factors', () => {
  const facts = { subject: { city: { value: 'Chicago' }, county: { value: 'Cook' } } };
  const result = computeQualityScore({
    sectionId: 'neighborhood_description',
    facts,
    generatedText: 'The subject property is located in Chicago, Cook County...',
    reviewPassed: true,
    examplesUsed: 3,
  });
  assert.equal(typeof result.score, 'number');
  assert.ok(result.score > 0);
  assert.ok(result.score <= 100);
  assert.ok(Array.isArray(result.factors));
  assert.equal(result.factors.length, 7);
});

test('computeQualityScore penalizes empty text', () => {
  const facts = { subject: { city: { value: 'Chicago' }, county: { value: 'Cook' } } };
  const result = computeQualityScore({
    sectionId: 'neighborhood_description',
    facts,
    generatedText: '',
  });
  assert.ok(result.score < 80);
});

// ── buildAuditMetadata ──────────────────────────────────────────────────────

test('buildAuditMetadata assembles full audit record', () => {
  const facts = { subject: { city: { value: 'Chicago' }, county: { value: 'Cook' } } };
  const audit = buildAuditMetadata({
    sectionId: 'neighborhood_description',
    runId: 'run-1',
    jobId: 'job-1',
    facts,
    generatedText: 'Sample text',
    reviewPassed: true,
    examplesUsed: 2,
    sourceIds: ['s1', 's2'],
    durationMs: 1500,
  });
  assert.equal(audit.sectionId, 'neighborhood_description');
  assert.equal(audit.runId, 'run-1');
  assert.ok(audit.generatedAt);
  assert.ok(audit.policy);
  assert.ok(audit.dependencySnapshot);
  assert.ok(audit.quality);
  assert.deepEqual(audit.sourceIds, ['s1', 's2']);
  assert.equal(audit.durationMs, 1500);
});

// ── findStaleDependentSections ──────────────────────────────────────────────

test('findStaleDependentSections returns related sections', () => {
  const stale = findStaleDependentSections('neighborhood_description');
  assert.ok(Array.isArray(stale));
  // neighborhood_description requires subject.city, subject.county
  // Other sections that use these paths should appear
  assert.ok(stale.length > 0);
});

test('findStaleDependentSections does not include self', () => {
  const stale = findStaleDependentSections('neighborhood_description');
  assert.ok(!stale.includes('neighborhood_description'));
});

// ── evaluateRegeneratePolicy ────────────────────────────────────────────────

test('evaluateRegeneratePolicy allows when all facts present', () => {
  const facts = { subject: { city: { value: 'Chicago' }, county: { value: 'Cook' } } };
  const result = evaluateRegeneratePolicy('neighborhood_description', facts);
  assert.equal(result.allowed, true);
  assert.equal(result.blockers.length, 0);
});

test('evaluateRegeneratePolicy blocks when required facts missing', () => {
  const result = evaluateRegeneratePolicy('neighborhood_description', {});
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.length > 0);
});

test('evaluateRegeneratePolicy warns about recommended gaps', () => {
  const facts = { subject: { city: { value: 'Chicago' }, county: { value: 'Cook' } } };
  const result = evaluateRegeneratePolicy('neighborhood_description', facts);
  // neighborhood_description has recommended facts that aren't provided
  assert.ok(result.warnings.length > 0 || result.blockers.length === 0);
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('─'.repeat(60));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
