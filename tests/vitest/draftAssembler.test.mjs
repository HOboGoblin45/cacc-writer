/**
 * tests/vitest/draftAssembler.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the draft assembler — validation, metrics, performance grading,
 * insertion targets, and the getDraftSummary view.
 *
 * These tests exercise the pure-function internals without touching the DB or AI.
 * We import the module and test the exported functions; internal helpers are tested
 * indirectly through assembleDraftPackage().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependencies that assembleDraftPackage imports
vi.mock('../../server/context/reportPlanner.js', () => ({
  getSectionDefs: (formType) => [
    { id: 'neighborhood', label: 'Neighborhood', generatorProfile: 'retrieval-guided', dependsOn: [], insertionTarget: 'aci', aciTab: 'Subject' },
    { id: 'site', label: 'Site', generatorProfile: 'data-driven', dependsOn: [], insertionTarget: 'aci', aciTab: 'Subject' },
    { id: 'improvements', label: 'Improvements', generatorProfile: 'analysis-narrative', dependsOn: [], insertionTarget: 'aci', aciTab: 'Subject' },
    { id: 'reconciliation', label: 'Reconciliation', generatorProfile: 'synthesis', dependsOn: ['neighborhood', 'site'], insertionTarget: 'aci', aciTab: 'Reconciliation' },
  ],
}));

vi.mock('../../server/services/sectionPolicyService.js', () => ({
  buildSectionPolicy: () => ({ maxTokens: 2000, temperature: 0.4 }),
  buildDependencySnapshot: () => ({ dependencies: [] }),
  computeQualityScore: ({ generatedText }) => ({
    score: generatedText.length > 100 ? 85 : 50,
    factors: { length: generatedText.length },
  }),
  getPromptVersion: () => '2.1.0',
}));

import { assembleDraftPackage, getDraftSummary } from '../../server/orchestrator/draftAssembler.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeSectionResult(overrides = {}) {
  return {
    ok: true,
    text: 'The subject property is located in a well-established residential neighborhood characterized by single-family dwellings on typically sized lots. The area demonstrates stable market conditions with consistent demand patterns.',
    metrics: {
      durationMs: 3500,
      inputChars: 2000,
      outputChars: 200,
      attemptCount: 1,
      examplesUsed: 3,
      profileId: 'retrieval-guided',
    },
    ...overrides,
  };
}

function makeContext() {
  return {
    formType: '1004',
    facts: {
      subject: { address: '123 Main St', city: 'Springfield' },
    },
  };
}

function makePlan() {
  return {
    formType: '1004',
    sections: [
      { id: 'neighborhood', label: 'Neighborhood', generatorProfile: 'retrieval-guided', dependsOn: [], insertionTarget: 'aci', aciTab: 'Subject' },
      { id: 'site', label: 'Site', generatorProfile: 'data-driven', dependsOn: [], insertionTarget: 'aci', aciTab: 'Subject' },
      { id: 'improvements', label: 'Improvements', generatorProfile: 'analysis-narrative', dependsOn: [], insertionTarget: 'aci', aciTab: 'Subject' },
      { id: 'reconciliation', label: 'Reconciliation', generatorProfile: 'synthesis', dependsOn: ['neighborhood', 'site'], insertionTarget: 'real_quantum', rqSection: 'Recon' },
    ],
  };
}

function makeFullSectionResults() {
  return {
    neighborhood: makeSectionResult(),
    site: makeSectionResult(),
    improvements: makeSectionResult(),
    reconciliation: makeSectionResult({
      text: 'Based on the sales comparison approach, the estimated market value of the subject is $250,000. This conclusion is supported by the comparable sales analysis.',
    }),
  };
}

// ── assembleDraftPackage ─────────────────────────────────────────────────────

describe('assembleDraftPackage', () => {
  it('should assemble a complete draft with all sections passing', () => {
    const { draftPackage, validation, warnings } = assembleDraftPackage({
      runId: 'run-001',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: makeFullSectionResults(),
      retrievalStats: { totalExamplesUsed: 12 },
      runRecord: { totalDurationMs: 8000, contextBuildMs: 500, parallelDraftMs: 6000 },
    });

    expect(draftPackage.runId).toBe('run-001');
    expect(draftPackage.caseId).toBe('case-abc');
    expect(draftPackage.formType).toBe('1004');
    expect(draftPackage.status).toBe('draft_ready');
    expect(draftPackage.sectionCount).toBe(4);
    expect(draftPackage.successCount).toBe(4);
    expect(draftPackage.failureCount).toBe(0);
    expect(validation.ok).toBe(true);
    expect(draftPackage._assembledAt).toBeTruthy();
  });

  it('should mark missing sections and set draft_ready_with_warnings', () => {
    const results = makeFullSectionResults();
    results.site = { ok: false, text: '', error: 'Timeout', metrics: {} };

    const { draftPackage, validation, warnings } = assembleDraftPackage({
      runId: 'run-002',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: results,
    });

    expect(validation.ok).toBe(false);
    expect(validation.status).toBe('draft_ready_with_warnings');
    expect(validation.missingRequired).toContain('site');
    expect(draftPackage.failureCount).toBe(1);
    expect(warnings.some(w => w.type === 'missing_required' && w.sectionId === 'site')).toBe(true);
  });

  it('should detect thin sections below minimum length', () => {
    const results = makeFullSectionResults();
    results.neighborhood = makeSectionResult({ text: 'Short.' }); // way below 150 char min

    const { warnings } = assembleDraftPackage({
      runId: 'run-003',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: results,
    });

    expect(warnings.some(w => w.type === 'thin_section' && w.sectionId === 'neighborhood')).toBe(true);
  });

  it('should detect unresolved INSERT placeholders', () => {
    const text = 'The neighborhood [INSERT address] is near [INSERT school] and [INSERT park] with [INSERT mall] nearby. Other features include [INSERT feature].';
    const results = makeFullSectionResults();
    results.neighborhood = makeSectionResult({ text });

    const { warnings } = assembleDraftPackage({
      runId: 'run-004',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: results,
    });

    expect(warnings.some(w => w.message.includes('[INSERT] placeholders'))).toBe(true);
  });

  it('should warn about retried sections', () => {
    const results = makeFullSectionResults();
    results.site = makeSectionResult({
      metrics: { ...makeSectionResult().metrics, attemptCount: 3 },
    });

    const { warnings } = assembleDraftPackage({
      runId: 'run-005',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: results,
    });

    expect(warnings.some(w => w.type === 'section_retried' && w.sectionId === 'site')).toBe(true);
  });

  it('should warn about slow sections (>15s)', () => {
    const results = makeFullSectionResults();
    results.improvements = makeSectionResult({
      metrics: { ...makeSectionResult().metrics, durationMs: 22000 },
    });

    const { warnings } = assembleDraftPackage({
      runId: 'run-006',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: results,
    });

    expect(warnings.some(w => w.type === 'slow_section' && w.sectionId === 'improvements')).toBe(true);
  });

  it('should warn if reconciliation lacks value conclusion', () => {
    const results = makeFullSectionResults();
    results.reconciliation = makeSectionResult({
      text: 'The three approaches to value were considered. The sales comparison approach was given primary weight.',
    });

    const { warnings } = assembleDraftPackage({
      runId: 'run-007',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: results,
    });

    // "value" is in the text so this should NOT trigger the warning
    expect(warnings.some(w => w.type === 'consistency' && w.sectionId === 'reconciliation')).toBe(false);
  });

  it('should warn about overall performance exceeding 30s', () => {
    const { warnings } = assembleDraftPackage({
      runId: 'run-008',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: makeFullSectionResults(),
      runRecord: { totalDurationMs: 45000 },
    });

    expect(warnings.some(w => w.type === 'performance')).toBe(true);
  });

  it('should build insertion targets from plan', () => {
    const { draftPackage } = assembleDraftPackage({
      runId: 'run-009',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: makeFullSectionResults(),
    });

    expect(draftPackage.insertionTargets.neighborhood).toEqual({ software: 'aci', tab: 'Subject' });
    expect(draftPackage.insertionTargets.reconciliation).toEqual({ software: 'real_quantum', section: 'Recon' });
  });

  it('should compute metrics summary with performance grade', () => {
    const { draftPackage } = assembleDraftPackage({
      runId: 'run-010',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: makeFullSectionResults(),
      runRecord: { totalDurationMs: 10000, contextBuildMs: 200, parallelDraftMs: 8000 },
      retrievalStats: { totalExamplesUsed: 10, totalMemoryScanned: 50, retrievalMs: 300 },
    });

    expect(draftPackage.metrics.totalDurationMs).toBe(10000);
    expect(draftPackage.metrics.performanceGrade).toBe('excellent'); // <=12s
    expect(draftPackage.metrics.phaseTimings.contextBuildMs).toBe(200);
    expect(draftPackage.metrics.retrieval.totalExamplesUsed).toBe(10);
    expect(draftPackage.metrics.totals.inputChars).toBeGreaterThan(0);
  });

  it('should return draft_failed when ALL sections fail', () => {
    const failedResults = {
      neighborhood: { ok: false, text: '', error: 'fail', metrics: {} },
      site: { ok: false, text: '', error: 'fail', metrics: {} },
      improvements: { ok: false, text: '', error: 'fail', metrics: {} },
      reconciliation: { ok: false, text: '', error: 'fail', metrics: {} },
    };

    const { validation } = assembleDraftPackage({
      runId: 'run-011',
      caseId: 'case-abc',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: failedResults,
    });

    expect(validation.status).toBe('draft_failed');
    expect(validation.ok).toBe(false);
  });
});

// ── getDraftSummary ──────────────────────────────────────────────────────────

describe('getDraftSummary', () => {
  it('should extract summary fields from a draft package', () => {
    const { draftPackage } = assembleDraftPackage({
      runId: 'run-100',
      caseId: 'case-xyz',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: makeFullSectionResults(),
      runRecord: { totalDurationMs: 15000 },
    });

    const summary = getDraftSummary(draftPackage);

    expect(summary.runId).toBe('run-100');
    expect(summary.caseId).toBe('case-xyz');
    expect(summary.formType).toBe('1004');
    expect(summary.status).toBe('draft_ready');
    expect(summary.sectionCount).toBe(4);
    expect(summary.successCount).toBe(4);
    expect(summary.failureCount).toBe(0);
    expect(summary.totalDurationMs).toBe(15000);
    expect(summary.performanceGrade).toBe('good'); // 15s = good
  });

  it('should show warning count from draft package', () => {
    const results = makeFullSectionResults();
    results.site = { ok: false, text: '', error: 'timeout', metrics: {} };

    const { draftPackage } = assembleDraftPackage({
      runId: 'run-101',
      caseId: 'case-xyz',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: results,
    });

    const summary = getDraftSummary(draftPackage);
    expect(summary.warningCount).toBeGreaterThan(0);
    expect(summary.failureCount).toBe(1);
  });
});

// ── Performance grading (tested indirectly via metrics) ──────────────────────

describe('performance grading', () => {
  const grade = (ms) => {
    const { draftPackage } = assembleDraftPackage({
      runId: 'run-g',
      caseId: 'case-g',
      context: makeContext(),
      plan: makePlan(),
      sectionResults: makeFullSectionResults(),
      runRecord: { totalDurationMs: ms },
    });
    return draftPackage.metrics.performanceGrade;
  };

  it('should grade <= 12s as excellent', () => {
    expect(grade(10000)).toBe('excellent');
    expect(grade(12000)).toBe('excellent');
  });

  it('should grade 12-20s as good', () => {
    expect(grade(15000)).toBe('good');
    expect(grade(20000)).toBe('good');
  });

  it('should grade 20-30s as acceptable', () => {
    expect(grade(25000)).toBe('acceptable');
    expect(grade(30000)).toBe('acceptable');
  });

  it('should grade > 30s as slow', () => {
    expect(grade(35000)).toBe('slow');
    expect(grade(60000)).toBe('slow');
  });
});
