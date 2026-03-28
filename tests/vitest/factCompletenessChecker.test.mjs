/**
 * tests/vitest/factCompletenessChecker.test.mjs
 * -----------------------------------------------
 * Unit tests for Fact Completeness QC Checker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the registry so we can capture rules
const registeredRules = [];
vi.mock('../../server/qc/qcRuleRegistry.js', () => ({
  registerRules: (rules) => registeredRules.push(...rules),
}));

// Import after mock
const mod = await import('../../server/qc/checkers/factCompletenessChecker.js');

describe('factCompletenessChecker', () => {
  it('should register 3 rules', () => {
    expect(registeredRules.length).toBe(3);
    const ids = registeredRules.map(r => r.ruleId);
    expect(ids).toContain('FACT-001');
    expect(ids).toContain('FACT-002');
    expect(ids).toContain('FACT-003');
  });

  describe('FACT-001: Critical Subject Facts Missing', () => {
    const rule = registeredRules.find(r => r.ruleId === 'FACT-001');

    it('should return blocker when 3+ critical facts missing', () => {
      const ctx = {
        assignmentContext: {
          facts: {
            subject: {
              address: { value: null },
              city: { value: null },
              gla: { value: null },
              beds: { value: 3 },
              baths: { value: 2 },
              condition: { value: 'C3' },
              yearBuilt: { value: 1990 },
              siteSize: { value: '0.25 acres' },
            },
          },
        },
      };
      const results = rule.check(ctx);
      expect(results.length).toBe(1);
      expect(results[0].severity).toBe('blocker');
      expect(results[0].ruleId).toBe('FACT-001');
    });

    it('should return high when 1-2 critical facts missing', () => {
      const ctx = {
        assignmentContext: {
          facts: {
            subject: {
              address: { value: '123 Main St' },
              city: { value: 'Bloomington' },
              gla: { value: null },
              beds: { value: 3 },
              baths: { value: 2 },
              condition: { value: 'C3' },
              yearBuilt: { value: 1990 },
              siteSize: { value: '0.25 acres' },
            },
          },
        },
      };
      const results = rule.check(ctx);
      expect(results.length).toBe(1);
      expect(results[0].severity).toBe('high');
    });

    it('should return empty when all critical facts present', () => {
      const ctx = {
        assignmentContext: {
          facts: {
            subject: {
              address: { value: '123 Main St' },
              city: { value: 'Bloomington' },
              gla: { value: 1500 },
              beds: { value: 3 },
              baths: { value: 2 },
              condition: { value: 'C3' },
              yearBuilt: { value: 1990 },
              siteSize: { value: '0.25 acres' },
            },
          },
        },
      };
      const results = rule.check(ctx);
      expect(results.length).toBe(0);
    });

    it('should handle missing assignmentContext gracefully', () => {
      const ctx = {};
      const results = rule.check(ctx);
      expect(results.length).toBe(1);
      expect(results[0].severity).toBe('blocker');
    });
  });

  describe('FACT-002: Critical Market/Comp Facts Missing', () => {
    const rule = registeredRules.find(r => r.ruleId === 'FACT-002');

    it('should flag when no comps have address+salePrice', () => {
      const ctx = {
        assignmentContext: {
          facts: {
            market: { trend: { value: 'stable' } },
            contract: { contractPrice: { value: 250000 } },
            comps: [
              { number: 1, address: { value: null }, salePrice: { value: null } },
            ],
          },
        },
      };
      const results = rule.check(ctx);
      expect(results.length).toBe(1);
      expect(results[0].ruleId).toBe('FACT-002');
    });

    it('should not flag when market data and comps present', () => {
      const ctx = {
        assignmentContext: {
          facts: {
            market: { trend: { value: 'stable' } },
            contract: { contractPrice: { value: 250000 } },
            comps: [
              { number: 1, address: { value: '456 Oak St' }, salePrice: { value: 245000 } },
            ],
          },
        },
      };
      const results = rule.check(ctx);
      expect(results.length).toBe(0);
    });
  });

  describe('FACT-003: Assignment Context Incomplete', () => {
    const rule = registeredRules.find(r => r.ruleId === 'FACT-003');

    it('should flag when 3+ assignment context facts missing', () => {
      const ctx = {
        assignmentContext: {
          facts: {
            assignment: {
              intendedUse: { value: null },
              intendedUser: { value: null },
              effectiveDate: { value: null },
            },
            subject: {
              quality: { value: null },
              zoning: { value: null },
              style: { value: null },
            },
          },
        },
      };
      const results = rule.check(ctx);
      expect(results.length).toBe(1);
      expect(results[0].severity).toBe('medium');
    });

    it('should not flag when assignment context mostly complete', () => {
      const ctx = {
        assignmentContext: {
          facts: {
            assignment: {
              intendedUse: { value: 'Mortgage lending' },
              intendedUser: { value: 'ABC Bank' },
              effectiveDate: { value: '2024-01-15' },
            },
            subject: {
              quality: { value: 'Q3' },
              zoning: { value: 'R-1' },
              style: { value: 'Ranch' },
            },
          },
        },
      };
      const results = rule.check(ctx);
      expect(results.length).toBe(0);
    });
  });
});
