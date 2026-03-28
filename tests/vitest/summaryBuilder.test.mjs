/**
 * tests/vitest/summaryBuilder.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the QC summary builder — aggregation of findings into a
 * practical review snapshot.
 */

import { describe, it, expect } from 'vitest';
import { buildQCSummary } from '../../server/qc/summaryBuilder.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFinding(overrides = {}) {
  return {
    ruleId: 'TEST-001',
    severity: 'medium',
    category: 'section_quality',
    message: 'Test finding',
    sectionIds: [],
    canonicalFieldIds: [],
    status: 'open',
    ...overrides,
  };
}

// ── buildQCSummary ───────────────────────────────────────────────────────────

describe('buildQCSummary', () => {
  it('should return zero-count summary for empty findings', () => {
    const summary = buildQCSummary([]);
    expect(summary.totalFindings).toBe(0);
    expect(summary.severityCounts.blocker).toBe(0);
    expect(summary.severityCounts.high).toBe(0);
    expect(summary.draftReadiness).toBe('ready');
    expect(summary.readinessColor).toBe('green');
    expect(summary.topReviewRisks).toHaveLength(0);
  });

  it('should count findings by severity', () => {
    const findings = [
      makeFinding({ severity: 'blocker' }),
      makeFinding({ severity: 'blocker' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'medium' }),
      makeFinding({ severity: 'low' }),
      makeFinding({ severity: 'advisory' }),
    ];

    const summary = buildQCSummary(findings);
    expect(summary.totalFindings).toBe(6);
    expect(summary.severityCounts.blocker).toBe(2);
    expect(summary.severityCounts.high).toBe(1);
    expect(summary.severityCounts.medium).toBe(1);
    expect(summary.severityCounts.low).toBe(1);
    expect(summary.severityCounts.advisory).toBe(1);
  });

  it('should count findings by category', () => {
    const findings = [
      makeFinding({ category: 'placeholder' }),
      makeFinding({ category: 'placeholder' }),
      makeFinding({ category: 'consistency' }),
    ];

    const summary = buildQCSummary(findings);
    expect(summary.categoryCounts.placeholder).toBe(2);
    expect(summary.categoryCounts.consistency).toBe(1);
  });

  it('should track affected sections', () => {
    const findings = [
      makeFinding({ sectionIds: ['neighborhood', 'site'] }),
      makeFinding({ sectionIds: ['site', 'improvements'] }),
    ];

    const summary = buildQCSummary(findings);
    expect(summary.affectedSections).toHaveLength(3);
    expect(summary.affectedSections).toContain('neighborhood');
    expect(summary.affectedSections).toContain('site');
    expect(summary.affectedSections).toContain('improvements');
  });

  it('should identify cleared sections', () => {
    const findings = [
      makeFinding({ sectionIds: ['neighborhood'] }),
    ];

    const summary = buildQCSummary(findings, {
      allSectionIds: ['neighborhood', 'site', 'improvements'],
    });

    expect(summary.clearedSections).toContain('site');
    expect(summary.clearedSections).toContain('improvements');
    expect(summary.clearedSections).not.toContain('neighborhood');
  });

  it('should track fields needing attention sorted by count', () => {
    const findings = [
      makeFinding({ canonicalFieldIds: ['F001', 'F002'] }),
      makeFinding({ canonicalFieldIds: ['F001'] }),
      makeFinding({ canonicalFieldIds: ['F003'] }),
    ];

    const summary = buildQCSummary(findings);
    expect(summary.fieldsNeedingAttention[0].fieldId).toBe('F001');
    expect(summary.fieldsNeedingAttention[0].findingCount).toBe(2);
  });

  it('should extract cross-section conflicts', () => {
    const findings = [
      makeFinding({ category: 'consistency', ruleId: 'CON-001', sectionIds: ['s1', 's2'] }),
      makeFinding({ category: 'reconciliation', ruleId: 'REC-001', sectionIds: ['s3'] }),
      makeFinding({ category: 'section_quality' }), // not a conflict
    ];

    const summary = buildQCSummary(findings);
    expect(summary.crossSectionConflicts).toHaveLength(2);
  });

  it('should extract placeholder issues', () => {
    const findings = [
      makeFinding({ category: 'placeholder', ruleId: 'PH-001' }),
      makeFinding({ category: 'placeholder', ruleId: 'PH-002' }),
      makeFinding({ category: 'section_quality' }),
    ];

    const summary = buildQCSummary(findings);
    expect(summary.placeholderIssues).toHaveLength(2);
  });

  it('should return top 5 review risks sorted by priority', () => {
    const findings = Array.from({ length: 10 }, (_, i) =>
      makeFinding({
        severity: i < 2 ? 'blocker' : 'medium',
        ruleId: `RISK-${i}`,
        category: i < 2 ? 'placeholder' : 'section_quality',
      })
    );

    const summary = buildQCSummary(findings);
    expect(summary.topReviewRisks).toHaveLength(5);
    // Blockers should be in the top spots
    expect(summary.topReviewRisks[0].severity).toBe('blocker');
    expect(summary.topReviewRisks[1].severity).toBe('blocker');
  });

  it('should set readiness based on findings', () => {
    const blockerFindings = [makeFinding({ severity: 'blocker' })];
    expect(buildQCSummary(blockerFindings).draftReadiness).toBe('not_ready');
    expect(buildQCSummary(blockerFindings).readinessColor).toBe('red');

    const cleanFindings = [makeFinding({ severity: 'advisory' })];
    expect(buildQCSummary(cleanFindings).draftReadiness).toBe('ready');
    expect(buildQCSummary(cleanFindings).readinessColor).toBe('green');
  });
});
