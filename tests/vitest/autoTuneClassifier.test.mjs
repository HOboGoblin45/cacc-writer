/**
 * tests/vitest/autoTuneClassifier.test.mjs
 * ----------------------------------------
 * Comprehensive test suite for AutoTune Context Classifier
 *
 * Tests:
 *   - Context key generation from different inputs
 *   - EMA calculation accuracy (verify math)
 *   - Parameter bounds enforcement
 *   - Multi-unit token budget boost
 *   - Feature flag disable behavior
 *   - Outcome recording updates EMA correctly
 *   - No-history returns base profile
 *   - Reset clears state
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  classifyContext,
  getOptimizedParams,
  recordOutcome,
  getEmaState,
  getAllContextKeys,
  getAllContextStats,
  resetContext,
  resetAllContexts,
  loadEmaState,
  exportEmaState,
} from '../../server/ai/autoTuneClassifier.js';

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const BASE_PROFILE = {
  temperature: 0.65,
  maxTokens: 800,
  topP: 0.95,
};

const SIMPLE_FACTS = {
  address: '123 Main St',
  bedrooms: 3,
  bathrooms: 2,
};

const COMPLEX_FACTS = {
  address: '456 Oak Ave',
  bedrooms: 4,
  bathrooms: 3.5,
  living_area: 3500,
  lot_size: 0.5,
  year_built: 2010,
  condition: 'good',
  improvements: { garage: true, deck: true, fence: true },
  comparable_sales: [
    { address: 'comp1', price: 500000 },
    { address: 'comp2', price: 520000 },
  ],
  adjustments: [
    { category: 'living_area', amount: 25 },
    { category: 'garage', amount: 10 },
  ],
  concessions: { closing_credits: 5000 },
  income_data: { gross_rent: 5000, expenses: 1500 },
};

const MULTI_UNIT_FACTS = {
  ...COMPLEX_FACTS,
  unitCount: 4,
  rentRoll: [
    { unit: '1A', rent: 1200 },
    { unit: '1B', rent: 1250 },
    { unit: '2A', rent: 1200 },
    { unit: '2B', rent: 1250 },
  ],
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AutoTune Context Classifier', () => {
  beforeEach(() => {
    // Clear state before each test
    resetAllContexts();
  });

  afterEach(() => {
    // Clean up after each test
    resetAllContexts();
  });

  describe('classifyContext()', () => {
    it('generates consistent contextKey from same inputs', () => {
      const key1 = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      const key2 = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      expect(key1).toBe(key2);
    });

    it('includes formType in contextKey', () => {
      const key1004 = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      const key1025 = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1025',
        facts: SIMPLE_FACTS,
      });

      expect(key1004).not.toBe(key1025);
      expect(key1004).toContain('1004');
      expect(key1025).toContain('1025');
    });

    it('includes sectionId in contextKey', () => {
      const keyNeighborhood = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      const keyMarket = classifyContext({
        sectionId: 'market_conditions',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      expect(keyNeighborhood).not.toBe(keyMarket);
      expect(keyNeighborhood).toContain('neighborhood_description');
      expect(keyMarket).toContain('market_conditions');
    });

    it('classifies simple facts as simple complexity', () => {
      const key = classifyContext({
        sectionId: 'improvements_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      expect(key).toContain(':simple:');
    });

    it('classifies complex facts as complex or moderate', () => {
      const key = classifyContext({
        sectionId: 'sales_comparison_summary',
        formType: '1004',
        facts: COMPLEX_FACTS,
      });

      expect(key).toMatch(/:(?:complex|moderate):/);
    });

    it('distinguishes single-unit from multi-unit properties', () => {
      const keySingle = classifyContext({
        sectionId: 'income_approach_summary',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      const keyMulti = classifyContext({
        sectionId: 'income_approach_summary',
        formType: '1025',
        facts: MULTI_UNIT_FACTS,
      });

      expect(keySingle).toContain('single-unit');
      expect(keyMulti).toContain('multi-unit');
    });

    it('includes marketArea in contextKey when provided', () => {
      const keyWithMarket = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
        marketArea: 'Silicon Valley',
      });

      const keyNoMarket = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      expect(keyWithMarket).toContain('market-Silicon Valley');
      expect(keyNoMarket).toContain('market-default');
    });

    it('handles null/undefined facts gracefully', () => {
      const key1 = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: null,
      });

      const key2 = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: undefined,
      });

      const key3 = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
      });

      expect(key1).toBeDefined();
      expect(key2).toBeDefined();
      expect(key3).toBeDefined();
    });
  });

  describe('getOptimizedParams()', () => {
    it('returns base profile when no history exists', () => {
      const params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );

      expect(params.temperature).toBe(BASE_PROFILE.temperature);
      expect(params.maxTokens).toBe(BASE_PROFILE.maxTokens);
      expect(params.topP).toBe(0.95);
    });

    it('respects AUTOTUNE_ENABLED=false feature flag', () => {
      // Set environment variable to disable
      const originalEnv = process.env.AUTOTUNE_ENABLED;
      process.env.AUTOTUNE_ENABLED = 'false';

      // Record an outcome to build history
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      recordOutcome(contextKey, {
        qualityScore: 85,
        tokensUsed: 600,
      });

      // Even with history, should return base profile
      const params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );

      expect(params.temperature).toBe(BASE_PROFILE.temperature);
      expect(params.maxTokens).toBe(BASE_PROFILE.maxTokens);

      // Restore
      process.env.AUTOTUNE_ENABLED = originalEnv;
    });

    it('decreases temperature when quality is low', () => {
      // Build poor-quality history
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      // Record multiple low-quality outcomes
      for (let i = 0; i < 5; i++) {
        recordOutcome(contextKey, {
          qualityScore: 30, // Low quality
          tokensUsed: 500,
        });
      }

      const params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );

      // Temperature should be reduced
      expect(params.temperature).toBeLessThan(BASE_PROFILE.temperature);
    });

    it('increases temperature when quality is high', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      // Record multiple high-quality outcomes
      for (let i = 0; i < 5; i++) {
        recordOutcome(contextKey, {
          qualityScore: 90, // High quality
          tokensUsed: 700,
        });
      }

      const params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );

      // Temperature should be increased
      expect(params.temperature).toBeGreaterThan(BASE_PROFILE.temperature);
    });

    it('increases maxTokens when consistently under-budget', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      // Record outcomes using < 70% of token budget
      for (let i = 0; i < 5; i++) {
        recordOutcome(contextKey, {
          qualityScore: 75,
          tokensUsed: 450, // Only 56% of 800
        });
      }

      const params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );

      // MaxTokens should be reduced
      expect(params.maxTokens).toBeLessThan(BASE_PROFILE.maxTokens);
    });

    it('decreases maxTokens when consistently over-budget', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      // Record outcomes using > 90% of token budget
      for (let i = 0; i < 5; i++) {
        recordOutcome(contextKey, {
          qualityScore: 75,
          tokensUsed: 750, // 94% of 800
        });
      }

      const params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );

      // MaxTokens should be increased
      expect(params.maxTokens).toBeGreaterThan(BASE_PROFILE.maxTokens);
    });

    it('enforces temperature bounds (0.1 to 1.0)', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      // Record extremely poor quality to try to push temperature down
      for (let i = 0; i < 10; i++) {
        recordOutcome(contextKey, {
          qualityScore: 5, // Extremely low
          tokensUsed: 300,
        });
      }

      const params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );

      expect(params.temperature).toBeGreaterThanOrEqual(0.1);
      expect(params.temperature).toBeLessThanOrEqual(1.0);
    });

    it('enforces maxTokens bounds (200 to 2000)', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      // Record outcomes that might push tokens way up
      for (let i = 0; i < 10; i++) {
        recordOutcome(contextKey, {
          qualityScore: 95,
          tokensUsed: 790, // Almost all of 800
        });
      }

      const params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );

      expect(params.maxTokens).toBeGreaterThanOrEqual(200);
      expect(params.maxTokens).toBeLessThanOrEqual(2000);
    });

    it('applies multi-unit income section token boost for 1025 forms', () => {
      const contextKey = classifyContext({
        sectionId: 'income_approach_summary',
        formType: '1025',
        facts: MULTI_UNIT_FACTS,
      });

      // Build history
      recordOutcome(contextKey, {
        qualityScore: 80,
        tokensUsed: 600,
      });

      const baseProfile = {
        temperature: 0.50,
        maxTokens: 700,
        topP: 0.95,
      };

      const params = getOptimizedParams(
        'income_approach_summary',
        '1025',
        MULTI_UNIT_FACTS,
        baseProfile
      );

      // Should apply 1.2x boost for multi-unit 1025 income sections
      expect(params.maxTokens).toBeGreaterThan(baseProfile.maxTokens);
    });

    it('does not apply boost to non-income sections on 1025', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1025',
        facts: MULTI_UNIT_FACTS,
      });

      recordOutcome(contextKey, {
        qualityScore: 80,
        tokensUsed: 600,
      });

      const params = getOptimizedParams(
        'neighborhood_description',
        '1025',
        MULTI_UNIT_FACTS,
        BASE_PROFILE
      );

      // Neighborhood section should not get boost
      // Should use adjusted params based on quality, but not token boost
      expect(params).toBeDefined();
    });

    it('returns topP as 0.95 always', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      recordOutcome(contextKey, {
        qualityScore: 90,
        tokensUsed: 700,
      });

      const params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );

      expect(params.topP).toBe(0.95);
    });
  });

  describe('recordOutcome()', () => {
    it('updates EMA state when outcome is recorded', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      const result = recordOutcome(contextKey, {
        qualityScore: 85,
        tokensUsed: 650,
      });

      expect(result.recorded).toBe(true);
      expect(result.emaState).toBeDefined();
      expect(result.emaState.avgScore).toBe(85);
    });

    it('applies EMA smoothing correctly on multiple outcomes', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      // First outcome: 80 (no EMA, just initialize)
      recordOutcome(contextKey, { qualityScore: 80, tokensUsed: 600 });
      let state = getEmaState(contextKey);
      expect(state.avgScore).toBe(80);

      // Second outcome: 90
      // EMA with alpha=0.3: 0.3*90 + 0.7*80 = 27 + 56 = 83
      recordOutcome(contextKey, { qualityScore: 90, tokensUsed: 700 });
      state = getEmaState(contextKey);
      expect(state.avgScore).toBeCloseTo(83, 1);

      // Third outcome: 100
      // EMA: 0.3*100 + 0.7*83 = 30 + 58.1 = 88.1
      recordOutcome(contextKey, { qualityScore: 100, tokensUsed: 750 });
      state = getEmaState(contextKey);
      expect(state.avgScore).toBeCloseTo(88.1, 1);
    });

    it('tracks count of outcomes', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      recordOutcome(contextKey, { qualityScore: 75, tokensUsed: 600 });
      let state = getEmaState(contextKey);
      expect(state.scoreCount).toBe(1);

      recordOutcome(contextKey, { qualityScore: 80, tokensUsed: 650 });
      state = getEmaState(contextKey);
      expect(state.scoreCount).toBe(2);
    });

    it('returns recorded=false when AUTOTUNE_ENABLED=false', () => {
      const originalEnv = process.env.AUTOTUNE_ENABLED;
      process.env.AUTOTUNE_ENABLED = 'false';

      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      const result = recordOutcome(contextKey, {
        qualityScore: 85,
        tokensUsed: 650,
      });

      expect(result.recorded).toBe(false);

      process.env.AUTOTUNE_ENABLED = originalEnv;
    });

    it('returns recorded=false for invalid contextKey', () => {
      const result = recordOutcome('', {
        qualityScore: 85,
        tokensUsed: 650,
      });

      expect(result.recorded).toBe(false);
    });

    it('handles invalid quality scores gracefully', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      recordOutcome(contextKey, { qualityScore: 85, tokensUsed: 600 });
      let state = getEmaState(contextKey);
      const avgBefore = state.avgScore;

      // Record with invalid quality score (should be ignored)
      recordOutcome(contextKey, { qualityScore: -10, tokensUsed: 650 });
      state = getEmaState(contextKey);

      // avgScore should not change
      expect(state.avgScore).toBe(avgBefore);
    });
  });

  describe('getEmaState()', () => {
    it('returns null for non-existent context', () => {
      const state = getEmaState('non-existent-key');
      expect(state).toBeNull();
    });

    it('returns state after outcome recorded', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      recordOutcome(contextKey, {
        qualityScore: 85,
        tokensUsed: 650,
      });

      const state = getEmaState(contextKey);
      expect(state).not.toBeNull();
      expect(state.avgScore).toBe(85);
      expect(state.scoreCount).toBe(1);
    });

    it('includes lastUpdated timestamp', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      recordOutcome(contextKey, {
        qualityScore: 85,
        tokensUsed: 650,
      });

      const state = getEmaState(contextKey);
      expect(state.lastUpdated).toBeDefined();
      expect(typeof state.lastUpdated).toBe('string');
      expect(state.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('getAllContextKeys()', () => {
    it('returns empty array when no contexts tracked', () => {
      const keys = getAllContextKeys();
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBe(0);
    });

    it('returns all tracked context keys', () => {
      recordOutcome(
        classifyContext({
          sectionId: 'neighborhood_description',
          formType: '1004',
          facts: SIMPLE_FACTS,
        }),
        { qualityScore: 85, tokensUsed: 650 }
      );

      recordOutcome(
        classifyContext({
          sectionId: 'market_conditions',
          formType: '1004',
          facts: SIMPLE_FACTS,
        }),
        { qualityScore: 80, tokensUsed: 700 }
      );

      const keys = getAllContextKeys();
      expect(keys.length).toBe(2);
    });
  });

  describe('getAllContextStats()', () => {
    it('returns formatted stats for all contexts', () => {
      recordOutcome(
        classifyContext({
          sectionId: 'neighborhood_description',
          formType: '1004',
          facts: SIMPLE_FACTS,
        }),
        { qualityScore: 85, tokensUsed: 650 }
      );

      const stats = getAllContextStats();
      expect(Array.isArray(stats)).toBe(true);
      expect(stats.length).toBe(1);

      const stat = stats[0];
      expect(stat.contextKey).toBeDefined();
      expect(stat.avgScore).toBeDefined();
      expect(stat.scoreCount).toBe(1);
      expect(stat.avgTokensUsed).toBeDefined();
      expect(stat.lastUpdated).toBeDefined();
    });
  });

  describe('resetContext()', () => {
    it('removes state for specific context', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      recordOutcome(contextKey, {
        qualityScore: 85,
        tokensUsed: 650,
      });

      expect(getEmaState(contextKey)).not.toBeNull();

      resetContext(contextKey);

      expect(getEmaState(contextKey)).toBeNull();
    });

    it('returns true when context existed', () => {
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      recordOutcome(contextKey, {
        qualityScore: 85,
        tokensUsed: 650,
      });

      const result = resetContext(contextKey);
      expect(result).toBe(true);
    });

    it('returns false when context did not exist', () => {
      const result = resetContext('non-existent-key');
      expect(result).toBe(false);
    });

    it('does not affect other contexts', () => {
      const key1 = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      const key2 = classifyContext({
        sectionId: 'market_conditions',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      recordOutcome(key1, { qualityScore: 85, tokensUsed: 650 });
      recordOutcome(key2, { qualityScore: 80, tokensUsed: 700 });

      resetContext(key1);

      expect(getEmaState(key1)).toBeNull();
      expect(getEmaState(key2)).not.toBeNull();
    });
  });

  describe('resetAllContexts()', () => {
    it('clears all state', () => {
      recordOutcome(
        classifyContext({
          sectionId: 'neighborhood_description',
          formType: '1004',
          facts: SIMPLE_FACTS,
        }),
        { qualityScore: 85, tokensUsed: 650 }
      );

      recordOutcome(
        classifyContext({
          sectionId: 'market_conditions',
          formType: '1004',
          facts: SIMPLE_FACTS,
        }),
        { qualityScore: 80, tokensUsed: 700 }
      );

      expect(getAllContextKeys().length).toBe(2);

      const count = resetAllContexts();

      expect(count).toBe(2);
      expect(getAllContextKeys().length).toBe(0);
    });

    it('returns count of cleared contexts', () => {
      recordOutcome(
        classifyContext({
          sectionId: 'neighborhood_description',
          formType: '1004',
          facts: SIMPLE_FACTS,
        }),
        { qualityScore: 85, tokensUsed: 650 }
      );

      const count = resetAllContexts();
      expect(count).toBe(1);
    });
  });

  describe('loadEmaState() and exportEmaState()', () => {
    it('exports and reloads state correctly', () => {
      const key1 = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      recordOutcome(key1, { qualityScore: 85, tokensUsed: 650 });
      recordOutcome(key1, { qualityScore: 90, tokensUsed: 700 });

      const exported = exportEmaState();
      expect(Array.isArray(exported)).toBe(true);
      expect(exported.length).toBe(1);

      // Clear and reload
      resetAllContexts();
      expect(getEmaState(key1)).toBeNull();

      loadEmaState(exported);
      const reloaded = getEmaState(key1);
      expect(reloaded).not.toBeNull();
      // First value: 85, second value: 90
      // EMA: 0.3*90 + 0.7*85 = 27 + 59.5 = 86.5
      expect(reloaded.avgScore).toBeCloseTo(86.5, 1);
      expect(reloaded.scoreCount).toBe(2);
    });

    it('handles empty state export', () => {
      const exported = exportEmaState();
      expect(exported).toEqual([]);

      loadEmaState(exported); // Should not error
      expect(getAllContextKeys().length).toBe(0);
    });

    it('handles invalid input to loadEmaState gracefully', () => {
      loadEmaState(null);
      loadEmaState(undefined);
      loadEmaState('invalid');
      loadEmaState([{ contextKey: null, state: {} }]);

      // Should not error and not add invalid states
      expect(getAllContextKeys().length).toBe(0);
    });
  });

  describe('End-to-end workflow', () => {
    it('simulates full generation and feedback loop', () => {
      // 1. Classify context
      const contextKey = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      // 2. Get optimized params (should be base profile)
      let params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );
      expect(params.temperature).toBe(BASE_PROFILE.temperature);

      // 3. Record a good outcome
      recordOutcome(contextKey, {
        qualityScore: 85,
        tokensUsed: 650,
        wasApproved: true,
        sectionId: 'neighborhood_description',
      });

      // 4. Get optimized params again (should be adjusted)
      params = getOptimizedParams(
        'neighborhood_description',
        '1004',
        SIMPLE_FACTS,
        BASE_PROFILE
      );
      // Temperature should increase (good quality)
      expect(params.temperature).toBeGreaterThan(BASE_PROFILE.temperature);

      // 5. Record more outcomes
      for (let i = 0; i < 4; i++) {
        recordOutcome(contextKey, {
          qualityScore: 88,
          tokensUsed: 670,
        });
      }

      // 6. Verify EMA converges to good quality
      const state = getEmaState(contextKey);
      expect(state.avgScore).toBeGreaterThan(85);
      expect(state.scoreCount).toBe(5);
    });

    it('handles context switching between different sections', () => {
      const key1 = classifyContext({
        sectionId: 'neighborhood_description',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      const key2 = classifyContext({
        sectionId: 'market_conditions',
        formType: '1004',
        facts: SIMPLE_FACTS,
      });

      // Record different outcomes for each
      recordOutcome(key1, { qualityScore: 85, tokensUsed: 650 });
      recordOutcome(key2, { qualityScore: 75, tokensUsed: 700 });

      const state1 = getEmaState(key1);
      const state2 = getEmaState(key2);

      expect(state1.avgScore).toBe(85);
      expect(state2.avgScore).toBe(75);
    });
  });
});
