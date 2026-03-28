/**
 * tests/unit/learningLoop.test.mjs
 * ----------------------------------
 * Unit tests for the controlled learning loop:
 *   - Revision diff capture and retrieval
 *   - Diff stats computation
 *   - Suggestion outcome recording
 *   - Acceptance rate calculation
 *   - Ranked suggestion retrieval
 *   - Influence explanation generation
 *   - Case learning report
 */

import assert from 'node:assert/strict';
import { getDb } from '../../server/db/database.js';

import {
  captureRevisionDiff,
  getRevisionDiffs,
  getDiffStats,
  getDiffPatterns,
} from '../../server/learning/revisionDiffService.js';

import {
  recordSuggestionOutcome,
  getSuggestionHistory,
  getSuggestionAcceptanceRate,
  getRankedSuggestions,
  getLearnedInfluenceExplanation,
} from '../../server/learning/suggestionRankingService.js';

import {
  getInfluenceExplanation,
  getCaseLearningReport,
} from '../../server/learning/learningExplanationService.js';

const suiteName = 'learningLoop';
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

const testCase = 'loop-test-' + Date.now();

// ── Revision Diff Tests ──────────────────────────────────────────────────

test('captureRevisionDiff requires caseId and sectionId', () => {
  const result = captureRevisionDiff(null, null, 'draft', 'final');
  assert.ok(result.error);
});

test('captureRevisionDiff captures diff between draft and final', () => {
  const result = captureRevisionDiff(
    testCase,
    'neighborhood_description',
    'The neighborhood is good with many amenities.',
    'The neighborhood is excellent with numerous amenities and parks.',
    { formType: '1004', propertyType: 'single_family' }
  );
  assert.ok(result.id);
  assert.equal(result.caseId, testCase);
  assert.equal(result.sectionId, 'neighborhood_description');
  assert.ok(result.changeRatio >= 0);
  assert.ok(result.changeRatio <= 1);
  assert.ok(result.diff);
});

test('captureRevisionDiff handles identical texts', () => {
  const result = captureRevisionDiff(testCase, 'site_description', 'Same text', 'Same text');
  assert.equal(result.changeRatio, 0);
});

test('captureRevisionDiff handles empty to non-empty', () => {
  const result = captureRevisionDiff(testCase, 'improvements', '', 'New content here.');
  assert.equal(result.changeRatio, 1);
});

test('getRevisionDiffs retrieves all diffs for a case', () => {
  const diffs = getRevisionDiffs(testCase);
  assert.ok(diffs.length >= 3);
  assert.equal(diffs[0].caseId, testCase);
  assert.ok(diffs[0].sectionId);
  assert.ok(diffs[0].diff);
});

test('getRevisionDiffs returns empty for nonexistent case', () => {
  const diffs = getRevisionDiffs('no-such-case');
  assert.ok(Array.isArray(diffs));
  assert.equal(diffs.length, 0);
});

test('getDiffStats computes correct summary', () => {
  const stats = getDiffStats(testCase);
  assert.ok(stats.totalSections >= 3);
  assert.ok(stats.sectionsChanged >= 2); // at least the two non-identical diffs
  assert.ok(stats.averageChangeRatio >= 0);
  assert.ok(stats.mostChangedSections.length > 0);
  assert.ok(stats.mostChangedSections[0].sectionId);
  assert.ok(stats.mostChangedSections[0].changeRatio >= 0);
});

test('getDiffStats returns zeros for empty case', () => {
  const stats = getDiffStats('empty-case-no-diffs');
  assert.equal(stats.sectionsChanged, 0);
  assert.equal(stats.totalSections, 0);
  assert.equal(stats.averageChangeRatio, 0);
});

// ── Suggestion Outcome Tests ─────────────────────────────────────────────

test('recordSuggestionOutcome requires caseId and sectionId', () => {
  const result = recordSuggestionOutcome(null, null, {});
  assert.ok(result.error);
});

test('recordSuggestionOutcome records accepted suggestion', () => {
  const result = recordSuggestionOutcome(testCase, 'sug-1', {
    accepted: true,
    sectionId: 'neighborhood_description',
    suggestionType: 'narrative',
    originalText: 'Original text',
    suggestedText: 'Suggested text',
    formType: '1004',
    propertyType: 'single_family',
  });
  assert.ok(result.id);
  assert.equal(result.accepted, true);
  assert.equal(result.modified, false);
});

test('recordSuggestionOutcome records rejected suggestion', () => {
  const result = recordSuggestionOutcome(testCase, 'sug-2', {
    accepted: false,
    sectionId: 'neighborhood_description',
    suggestionType: 'narrative',
    rejectionReason: 'Too generic',
    formType: '1004',
  });
  assert.ok(result.id);
  assert.equal(result.accepted, false);
});

test('recordSuggestionOutcome records modified suggestion', () => {
  const result = recordSuggestionOutcome(testCase, 'sug-3', {
    accepted: true,
    modifiedText: 'Modified version of suggestion',
    sectionId: 'site_description',
    suggestionType: 'narrative',
    formType: '1004',
  });
  assert.ok(result.id);
  assert.equal(result.accepted, true);
  assert.equal(result.modified, true);
});

test('getSuggestionHistory retrieves all outcomes for a case', () => {
  const history = getSuggestionHistory(testCase);
  assert.ok(history.length >= 3);
  assert.equal(history[0].caseId, testCase);
});

test('getSuggestionAcceptanceRate computes correct rate', () => {
  const rate = getSuggestionAcceptanceRate({ formType: '1004' });
  assert.ok(rate.total >= 3);
  assert.ok(rate.accepted >= 2); // sug-1 and sug-3 accepted
  assert.ok(rate.acceptanceRate > 0);
  assert.ok(rate.acceptanceRate <= 1);
});

test('getSuggestionAcceptanceRate returns zero for no data', () => {
  const rate = getSuggestionAcceptanceRate({ formType: 'nonexistent' });
  assert.equal(rate.total, 0);
  assert.equal(rate.acceptanceRate, 0);
});

test('getRankedSuggestions returns ranked list', () => {
  const ranked = getRankedSuggestions('neighborhood_description', '1004');
  assert.ok(Array.isArray(ranked));
  if (ranked.length > 0) {
    assert.ok(ranked[0].suggestionType);
    assert.ok(ranked[0].acceptanceRate >= 0);
    assert.ok(ranked[0].total > 0);
  }
});

// ── Influence Explanation Tests ──────────────────────────────────────────

test('getInfluenceExplanation returns explanation for section with data', () => {
  const explanation = getInfluenceExplanation('neighborhood_description', '1004');
  assert.ok(explanation.sectionId);
  assert.ok(typeof explanation.acceptanceRate === 'number');
  assert.ok(typeof explanation.sampleSize === 'number');
  assert.ok(explanation.explanation);
  assert.ok(Array.isArray(explanation.influenceFactors));
  assert.ok(Array.isArray(explanation.topPatterns));
});

test('getInfluenceExplanation returns default message for no data', () => {
  const explanation = getInfluenceExplanation('no_such_section', 'no_form');
  assert.equal(explanation.sampleSize, 0);
  assert.ok(explanation.explanation.includes('No historical data'));
});

// ── Case Learning Report Tests ──────────────────────────────────────────

test('getCaseLearningReport returns comprehensive report', () => {
  const report = getCaseLearningReport(testCase);
  assert.equal(report.caseId, testCase);
  assert.ok(report.suggestions);
  assert.ok(typeof report.suggestions.total === 'number');
  assert.ok(typeof report.suggestions.accepted === 'number');
  assert.ok(typeof report.suggestions.acceptanceRate === 'number');
  assert.ok(report.revisionStats);
  assert.ok(typeof report.revisionStats.totalSections === 'number');
  assert.ok(typeof report.patternsCount === 'number');
});

test('getCaseLearningReport for nonexistent case has empty data', () => {
  const report = getCaseLearningReport('nonexistent-report-case');
  assert.equal(report.archive, null);
  assert.equal(report.suggestions.total, 0);
  assert.equal(report.revisionStats.totalSections, 0);
});

// ── getDiffPatterns across cases ──────────────────────────────────────────

test('getDiffPatterns returns aggregated patterns', () => {
  // Add diffs for a second case to verify cross-case aggregation
  captureRevisionDiff('loop-test-2', 'neighborhood_description', 'Draft A', 'Final A', { formType: '1004' });

  const patterns = getDiffPatterns({ formType: '1004' });
  assert.ok(Array.isArray(patterns));
  if (patterns.length > 0) {
    assert.ok(patterns[0].sectionId);
    assert.ok(typeof patterns[0].averageChangeRatio === 'number');
    assert.ok(typeof patterns[0].sampleCount === 'number');
  }
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log('-'.repeat(60));
console.log(`${suiteName}: ${passed} passed, ${failed} failed`);
console.log('-'.repeat(60));

if (failed > 0) process.exit(1);
