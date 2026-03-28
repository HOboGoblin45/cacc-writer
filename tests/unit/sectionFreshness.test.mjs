/**
 * tests/unit/sectionFreshness.test.mjs
 * --------------------------------------
 * Unit tests for Priority 3 — Section Factory Hardening.
 *
 * Covers:
 *   - Section freshness evaluation (sectionFreshnessService)
 *   - Fact-change invalidation
 *   - Enhanced regenerate policies
 *   - Enhanced quality scoring (placeholder detection, consistency, completeness)
 */

import assert from 'node:assert/strict';

import {
  getPromptVersion,
  buildDependencySnapshot,
  detectStaleness,
  computeQualityScore,
  evaluateRegeneratePolicy,
  detectPlaceholders,
  FRESHNESS,
} from '../../server/services/sectionPolicyService.js';

import {
  detectChangedFactPaths,
} from '../../server/services/sectionFreshnessService.js';

const suiteName = 'sectionFreshness (Priority 3)';
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

// ═══════════════════════════════════════════════════════════════════════════════
// Section Freshness Detection
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  -- Section Freshness Detection --');

test('detectStaleness: CURRENT when facts unchanged', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const snap = buildDependencySnapshot('neighborhood_description', facts);
  const result = detectStaleness(snap, facts, snap.promptVersion);
  assert.equal(result.freshness, FRESHNESS.CURRENT);
  assert.equal(result.changedPaths.length, 0);
  assert.equal(result.reasons.length, 0);
});

test('detectStaleness: STALE_DUE_TO_FACT_CHANGE when required fact changes', () => {
  const oldFacts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const snap = buildDependencySnapshot('neighborhood_description', oldFacts);
  const newFacts = {
    subject: { city: { value: 'Boulder' }, county: { value: 'Boulder' } },
  };
  const result = detectStaleness(snap, newFacts, snap.promptVersion);
  assert.equal(result.freshness, FRESHNESS.STALE_DUE_TO_FACT_CHANGE);
  assert.ok(result.changedPaths.includes('subject.city'));
  assert.ok(result.reasons.length > 0);
});

test('detectStaleness: STALE_DUE_TO_PROMPT_CHANGE when version changes', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const snap = buildDependencySnapshot('neighborhood_description', facts);
  const result = detectStaleness(snap, facts, '99.0.0');
  assert.equal(result.freshness, FRESHNESS.STALE_DUE_TO_PROMPT_CHANGE);
});

test('detectStaleness: STALE_DUE_TO_DEPENDENCY_CHANGE for recommended-only changes', () => {
  const oldFacts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
    neighborhood: { description: { value: 'urban area' } },
  };
  const snap = buildDependencySnapshot('neighborhood_description', oldFacts);
  const newFacts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
    neighborhood: { description: { value: 'suburban area near foothills' } },
  };
  const result = detectStaleness(snap, newFacts, snap.promptVersion);
  assert.equal(result.freshness, FRESHNESS.STALE_DUE_TO_DEPENDENCY_CHANGE);
  assert.ok(result.changedPaths.length > 0);
});

test('detectStaleness: NOT_GENERATED for null snapshot', () => {
  const result = detectStaleness(null, {}, '1.0.0');
  assert.equal(result.freshness, FRESHNESS.NOT_GENERATED);
  assert.ok(result.reasons.length > 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fact-Change Invalidation
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  -- Fact-Change Invalidation --');

test('detectChangedFactPaths: detects changed fact paths', () => {
  const oldFacts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const newFacts = {
    subject: { city: { value: 'Boulder' }, county: { value: 'Denver' } },
  };
  const changed = detectChangedFactPaths(oldFacts, newFacts);
  assert.ok(Array.isArray(changed));
  assert.ok(changed.includes('subject.city'));
  assert.ok(!changed.includes('subject.county'));
});

test('detectChangedFactPaths: returns empty for identical facts', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
    market: { trend: { value: 'stable' } },
  };
  const changed = detectChangedFactPaths(facts, facts);
  assert.equal(changed.length, 0);
});

test('detectChangedFactPaths: detects new fact (null → value)', () => {
  const oldFacts = {};
  const newFacts = {
    subject: { city: { value: 'Denver' } },
  };
  const changed = detectChangedFactPaths(oldFacts, newFacts);
  assert.ok(changed.includes('subject.city'));
});

test('detectChangedFactPaths: detects removed fact (value → null)', () => {
  const oldFacts = {
    subject: { city: { value: 'Denver' } },
  };
  const newFacts = {};
  const changed = detectChangedFactPaths(oldFacts, newFacts);
  assert.ok(changed.includes('subject.city'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Enhanced Regenerate Policies
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  -- Enhanced Regenerate Policies --');

test('evaluateRegeneratePolicy: allows regeneration with all facts present', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const result = evaluateRegeneratePolicy('neighborhood_description', facts);
  assert.equal(result.allowed, true);
  assert.equal(result.blockers.length, 0);
});

test('evaluateRegeneratePolicy: blocks when required facts missing', () => {
  const result = evaluateRegeneratePolicy('neighborhood_description', {});
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.length > 0);
});

test('evaluateRegeneratePolicy: warns on stale_due_to_prompt_change', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const result = evaluateRegeneratePolicy('neighborhood_description', facts, {}, {
    freshnessStatus: FRESHNESS.STALE_DUE_TO_PROMPT_CHANGE,
  });
  assert.equal(result.allowed, true);
  assert.ok(result.warnings.some(w => w.includes('prompt version')));
});

test('evaluateRegeneratePolicy: warns on low quality score', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const result = evaluateRegeneratePolicy('neighborhood_description', facts, {}, {
    qualityScore: 30,
  });
  assert.equal(result.allowed, true);
  assert.ok(result.warnings.some(w => w.includes('Quality score')));
});

test('evaluateRegeneratePolicy: blocks when regeneration limit reached', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const result = evaluateRegeneratePolicy('neighborhood_description', facts, {}, {
    regenerationCount: 10,
    maxRegenerations: 10,
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some(b => b.includes('Regeneration limit')));
});

test('evaluateRegeneratePolicy: warns when approaching regeneration limit', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const result = evaluateRegeneratePolicy('neighborhood_description', facts, {}, {
    regenerationCount: 8,
    maxRegenerations: 10,
  });
  assert.equal(result.allowed, true);
  assert.ok(result.warnings.some(w => w.includes('Approaching regeneration limit')));
});

test('evaluateRegeneratePolicy: warns on stale_due_to_dependency_change', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const result = evaluateRegeneratePolicy('neighborhood_description', facts, {}, {
    freshnessStatus: FRESHNESS.STALE_DUE_TO_DEPENDENCY_CHANGE,
  });
  assert.equal(result.allowed, true);
  assert.ok(result.warnings.some(w => w.includes('dependency section changed')));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Enhanced Quality Scoring
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n  -- Enhanced Quality Scoring --');

test('computeQualityScore: produces score with 7 factors', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const result = computeQualityScore({
    sectionId: 'neighborhood_description',
    facts,
    generatedText: 'The subject property is located in Denver, Denver County, in a stable residential area.',
    reviewPassed: true,
    examplesUsed: 3,
  });
  assert.equal(typeof result.score, 'number');
  assert.ok(result.score > 0);
  assert.ok(result.score <= 100);
  assert.ok(Array.isArray(result.factors));
  assert.equal(result.factors.length, 7);
  // Verify all factor names are present
  const names = result.factors.map(f => f.name);
  assert.ok(names.includes('dependency_coverage'));
  assert.ok(names.includes('output_length'));
  assert.ok(names.includes('review_pass'));
  assert.ok(names.includes('example_availability'));
  assert.ok(names.includes('placeholder_detection'));
  assert.ok(names.includes('consistency_check'));
  assert.ok(names.includes('completeness_coverage'));
});

test('computeQualityScore: penalizes placeholder text', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const withPlaceholders = computeQualityScore({
    sectionId: 'neighborhood_description',
    facts,
    generatedText: 'The subject property is located in [TBD], [INSERT CITY] County. The area has [PLACEHOLDER] amenities.',
    reviewPassed: true,
    examplesUsed: 3,
  });
  const withoutPlaceholders = computeQualityScore({
    sectionId: 'neighborhood_description',
    facts,
    generatedText: 'The subject property is located in Denver, Denver County. The area has excellent amenities.',
    reviewPassed: true,
    examplesUsed: 3,
  });
  const placeholderFactor = withPlaceholders.factors.find(f => f.name === 'placeholder_detection');
  const cleanFactor = withoutPlaceholders.factors.find(f => f.name === 'placeholder_detection');
  assert.ok(placeholderFactor.score < cleanFactor.score);
});

test('computeQualityScore: rewards consistency with facts', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const consistent = computeQualityScore({
    sectionId: 'neighborhood_description',
    facts,
    generatedText: 'Located in Denver, Denver County, the neighborhood features...',
    reviewPassed: false,
    examplesUsed: 0,
  });
  const inconsistent = computeQualityScore({
    sectionId: 'neighborhood_description',
    facts,
    generatedText: 'Located in some place in some county, the neighborhood features...',
    reviewPassed: false,
    examplesUsed: 0,
  });
  const consistentFactor = consistent.factors.find(f => f.name === 'consistency_check');
  const inconsistentFactor = inconsistent.factors.find(f => f.name === 'consistency_check');
  assert.ok(consistentFactor.score >= inconsistentFactor.score);
});

test('computeQualityScore: penalizes empty text', () => {
  const facts = {
    subject: { city: { value: 'Denver' }, county: { value: 'Denver' } },
  };
  const result = computeQualityScore({
    sectionId: 'neighborhood_description',
    facts,
    generatedText: '',
  });
  assert.ok(result.score < 50);
});

// ── Placeholder detection unit tests ──────────────────────────────────────────

console.log('\n  -- Placeholder Detection --');

test('detectPlaceholders: finds [TBD]', () => {
  const result = detectPlaceholders('The value is [TBD] and the date is [TBD].');
  assert.equal(result.count, 2);
  assert.ok(result.matches.includes('[TBD]'));
});

test('detectPlaceholders: finds [INSERT ...]', () => {
  const result = detectPlaceholders('Please [INSERT ADDRESS HERE] for the subject.');
  assert.equal(result.count, 1);
});

test('detectPlaceholders: finds XX patterns', () => {
  const result = detectPlaceholders('The sale price was $XX and the date was XX/XX/2024.');
  assert.ok(result.count >= 2);
});

test('detectPlaceholders: finds underscore runs', () => {
  const result = detectPlaceholders('Name: _____ Address: _________');
  assert.ok(result.count >= 2);
});

test('detectPlaceholders: returns zero for clean text', () => {
  const result = detectPlaceholders('The subject property is a well-maintained single-family residence.');
  assert.equal(result.count, 0);
  assert.equal(result.matches.length, 0);
});

test('detectPlaceholders: handles null/empty input', () => {
  assert.equal(detectPlaceholders(null).count, 0);
  assert.equal(detectPlaceholders('').count, 0);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('─'.repeat(60));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
