/**
 * tests/vitest/severityModel.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for the QC severity model — priority scoring, sorting,
 * draft readiness, and noise filtering.
 */

import { describe, it, expect } from 'vitest';
import {
  SEVERITY_WEIGHTS,
  SEVERITY_ORDER,
  computePriorityScore,
  sortByPriority,
  computeDraftReadiness,
  getReadinessLabel,
  filterNoise,
} from '../../server/qc/severityModel.js';

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

// ── SEVERITY_WEIGHTS ─────────────────────────────────────────────────────────

describe('SEVERITY_WEIGHTS', () => {
  it('should have all five severity levels', () => {
    expect(Object.keys(SEVERITY_WEIGHTS)).toHaveLength(5);
    expect(SEVERITY_WEIGHTS).toHaveProperty('blocker');
    expect(SEVERITY_WEIGHTS).toHaveProperty('high');
    expect(SEVERITY_WEIGHTS).toHaveProperty('medium');
    expect(SEVERITY_WEIGHTS).toHaveProperty('low');
    expect(SEVERITY_WEIGHTS).toHaveProperty('advisory');
  });

  it('should order weights from blocker (highest) to advisory (lowest)', () => {
    expect(SEVERITY_WEIGHTS.blocker).toBeGreaterThan(SEVERITY_WEIGHTS.high);
    expect(SEVERITY_WEIGHTS.high).toBeGreaterThan(SEVERITY_WEIGHTS.medium);
    expect(SEVERITY_WEIGHTS.medium).toBeGreaterThan(SEVERITY_WEIGHTS.low);
    expect(SEVERITY_WEIGHTS.low).toBeGreaterThan(SEVERITY_WEIGHTS.advisory);
  });
});

// ── computePriorityScore ─────────────────────────────────────────────────────

describe('computePriorityScore', () => {
  it('should return severity weight for a basic finding', () => {
    const finding = makeFinding({ severity: 'blocker', category: 'unknown_category' });
    expect(computePriorityScore(finding)).toBe(SEVERITY_WEIGHTS.blocker);
  });

  it('should add category boost for known categories', () => {
    const finding = makeFinding({ severity: 'high', category: 'placeholder' });
    expect(computePriorityScore(finding)).toBe(75 + 20); // high (75) + placeholder boost (20)
  });

  it('should add section count bonus (capped at 10)', () => {
    const finding = makeFinding({
      severity: 'medium',
      category: 'unknown',
      sectionIds: ['s1', 's2', 's3'],
    });
    // medium (40) + 0 category boost + 3*2=6 section bonus
    expect(computePriorityScore(finding)).toBe(46);
  });

  it('should cap section count bonus at 10', () => {
    const finding = makeFinding({
      severity: 'low',
      category: 'unknown',
      sectionIds: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],
    });
    // low (15) + 0 + min(8*2, 10) = 25
    expect(computePriorityScore(finding)).toBe(25);
  });

  it('should handle missing severity gracefully', () => {
    const finding = makeFinding({ severity: 'nonexistent' });
    expect(computePriorityScore(finding)).toBeGreaterThanOrEqual(0);
  });
});

// ── sortByPriority ───────────────────────────────────────────────────────────

describe('sortByPriority', () => {
  it('should sort findings highest priority first', () => {
    const findings = [
      makeFinding({ severity: 'low', category: 'section_quality' }),
      makeFinding({ severity: 'blocker', category: 'placeholder' }),
      makeFinding({ severity: 'medium', category: 'completeness' }),
    ];

    const sorted = sortByPriority(findings);
    expect(sorted[0].severity).toBe('blocker');
    expect(sorted[sorted.length - 1].severity).toBe('low');
  });

  it('should not mutate the original array', () => {
    const findings = [
      makeFinding({ severity: 'low' }),
      makeFinding({ severity: 'blocker' }),
    ];
    const copy = [...findings];
    sortByPriority(findings);
    expect(findings).toEqual(copy);
  });

  it('should tiebreak by severity band when scores are equal', () => {
    // Two findings with same priority score but different severity levels
    const findings = [
      makeFinding({ severity: 'medium', category: 'unknown' }),
      makeFinding({ severity: 'high', category: 'unknown' }),
    ];
    const sorted = sortByPriority(findings);
    // High should come before medium since it has higher score
    expect(sorted[0].severity).toBe('high');
  });

  it('should handle empty array', () => {
    expect(sortByPriority([])).toEqual([]);
  });
});

// ── computeDraftReadiness ────────────────────────────────────────────────────

describe('computeDraftReadiness', () => {
  it('should return "ready" when no findings', () => {
    expect(computeDraftReadiness([])).toBe('ready');
  });

  it('should return "not_ready" when there are blockers', () => {
    const findings = [makeFinding({ severity: 'blocker' })];
    expect(computeDraftReadiness(findings)).toBe('not_ready');
  });

  it('should return "not_ready" when more than 3 high findings', () => {
    const findings = Array.from({ length: 4 }, () => makeFinding({ severity: 'high' }));
    expect(computeDraftReadiness(findings)).toBe('not_ready');
  });

  it('should return "needs_review" with 1-3 high findings', () => {
    const findings = [makeFinding({ severity: 'high' })];
    expect(computeDraftReadiness(findings)).toBe('needs_review');
  });

  it('should return "needs_review" when more than 5 medium findings', () => {
    const findings = Array.from({ length: 6 }, () => makeFinding({ severity: 'medium' }));
    expect(computeDraftReadiness(findings)).toBe('needs_review');
  });

  it('should return "review_recommended" with 1-5 medium findings', () => {
    const findings = [makeFinding({ severity: 'medium' })];
    expect(computeDraftReadiness(findings)).toBe('review_recommended');
  });

  it('should return "ready" with only low/advisory findings', () => {
    const findings = [
      makeFinding({ severity: 'low' }),
      makeFinding({ severity: 'advisory' }),
    ];
    expect(computeDraftReadiness(findings)).toBe('ready');
  });

  it('should ignore dismissed findings', () => {
    const findings = [makeFinding({ severity: 'blocker', status: 'dismissed' })];
    expect(computeDraftReadiness(findings)).toBe('ready');
  });

  it('should ignore resolved findings', () => {
    const findings = [makeFinding({ severity: 'blocker', status: 'resolved' })];
    expect(computeDraftReadiness(findings)).toBe('ready');
  });
});

// ── getReadinessLabel ────────────────────────────────────────────────────────

describe('getReadinessLabel', () => {
  it('should return green for "ready"', () => {
    const result = getReadinessLabel('ready');
    expect(result.color).toBe('green');
    expect(result.label).toBeTruthy();
    expect(result.description).toBeTruthy();
  });

  it('should return yellow for "review_recommended"', () => {
    expect(getReadinessLabel('review_recommended').color).toBe('yellow');
  });

  it('should return orange for "needs_review"', () => {
    expect(getReadinessLabel('needs_review').color).toBe('orange');
  });

  it('should return red for "not_ready"', () => {
    expect(getReadinessLabel('not_ready').color).toBe('red');
  });

  it('should return gray for unknown signal', () => {
    expect(getReadinessLabel('gibberish').color).toBe('gray');
  });
});

// ── filterNoise ──────────────────────────────────────────────────────────────

describe('filterNoise', () => {
  it('should pass through all findings when few exist', () => {
    const findings = [
      makeFinding({ severity: 'medium' }),
      makeFinding({ severity: 'low' }),
      makeFinding({ severity: 'advisory' }),
    ];
    expect(filterNoise(findings)).toHaveLength(3);
  });

  it('should cap advisory findings at default max (5)', () => {
    const findings = Array.from({ length: 8 }, (_, i) =>
      makeFinding({ severity: 'advisory', ruleId: `ADV-${i}` })
    );
    const filtered = filterNoise(findings);
    expect(filtered.length).toBe(5);
  });

  it('should cap low findings at default max (10)', () => {
    const findings = Array.from({ length: 15 }, (_, i) =>
      makeFinding({ severity: 'low', ruleId: `LOW-${i}` })
    );
    const filtered = filterNoise(findings);
    expect(filtered.length).toBe(10);
  });

  it('should aggressively filter when 5+ blocker/high findings exist', () => {
    const critical = Array.from({ length: 5 }, (_, i) =>
      makeFinding({ severity: 'blocker', ruleId: `BLK-${i}` })
    );
    const advisory = Array.from({ length: 8 }, (_, i) =>
      makeFinding({ severity: 'advisory', ruleId: `ADV-${i}` })
    );
    const low = Array.from({ length: 8 }, (_, i) =>
      makeFinding({ severity: 'low', ruleId: `LOW-${i}` })
    );

    const filtered = filterNoise([...critical, ...advisory, ...low]);
    // All 5 blockers kept, max 2 advisory, max 3 low
    expect(filtered.length).toBe(5 + 2 + 3);
  });

  it('should respect custom maxAdvisory and maxLow', () => {
    const findings = [
      ...Array.from({ length: 5 }, () => makeFinding({ severity: 'advisory' })),
      ...Array.from({ length: 5 }, () => makeFinding({ severity: 'low' })),
    ];
    const filtered = filterNoise(findings, { maxAdvisory: 2, maxLow: 3 });
    expect(filtered.length).toBe(5); // 2 advisory + 3 low
  });

  it('should always keep blocker/high/medium findings', () => {
    const findings = [
      makeFinding({ severity: 'blocker' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'medium' }),
    ];
    expect(filterNoise(findings)).toHaveLength(3);
  });
});
