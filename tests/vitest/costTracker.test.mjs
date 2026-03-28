/**
 * tests/vitest/costTracker.test.mjs
 * ---------------------------------------------------------------------------
 * Unit tests for AI cost tracking utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  estimateCost,
  recordAiCost,
  getUserCostSummary,
  getDailyCostSummary,
  getAllUserCosts,
  resetCosts,
  COST_RATES,
} from '../../server/middleware/costTracker.js';

describe('COST_RATES', () => {
  it('should define rates for common models', () => {
    expect(COST_RATES['gpt-4.1']).toBeDefined();
    expect(COST_RATES['gemini-2.5-flash']).toBeDefined();
    expect(COST_RATES['cacc-appraiser']).toBeDefined();
  });

  it('should have zero cost for self-hosted models', () => {
    expect(COST_RATES['cacc-appraiser'].input).toBe(0);
    expect(COST_RATES['cacc-appraiser'].output).toBe(0);
  });
});

describe('estimateCost', () => {
  it('should calculate GPT-4.1 cost correctly', () => {
    const { cost, breakdown } = estimateCost({
      model: 'gpt-4.1',
      inputTokens: 1000,
      outputTokens: 500,
    });

    // 1000/1M * $2 = $0.002 input, 500/1M * $8 = $0.004 output
    expect(breakdown.input).toBeCloseTo(0.002, 5);
    expect(breakdown.output).toBeCloseTo(0.004, 5);
    expect(cost).toBeCloseTo(0.006, 5);
  });

  it('should calculate Gemini Flash cost correctly', () => {
    const { cost } = estimateCost({
      model: 'gemini-2.5-flash',
      inputTokens: 2000,
      outputTokens: 1000,
    });

    // 2000/1M * $0.15 = $0.0003, 1000/1M * $0.60 = $0.0006
    expect(cost).toBeCloseTo(0.0009, 5);
  });

  it('should return zero for self-hosted models', () => {
    const { cost } = estimateCost({
      model: 'cacc-appraiser-v6',
      inputTokens: 10000,
      outputTokens: 5000,
    });
    expect(cost).toBe(0);
  });

  it('should handle unknown models with default rates', () => {
    const { cost } = estimateCost({
      model: 'unknown-model-xyz',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(cost).toBeGreaterThan(0);
  });

  it('should handle zero tokens', () => {
    const { cost } = estimateCost({ model: 'gpt-4.1' });
    expect(cost).toBe(0);
  });

  it('should handle partial model name matching', () => {
    const { cost } = estimateCost({
      model: 'gpt-4.1-preview-2025',
      inputTokens: 1000,
      outputTokens: 0,
    });
    expect(cost).toBeCloseTo(0.002, 5);
  });
});

describe('recordAiCost', () => {
  beforeEach(() => {
    resetCosts();
  });

  it('should record cost for a user', () => {
    recordAiCost({
      userId: 'user-1',
      model: 'gpt-4.1',
      inputTokens: 1000,
      outputTokens: 500,
      feature: 'narrative',
    });

    const summary = getUserCostSummary('user-1');
    expect(summary.total).toBeCloseTo(0.006, 5);
    expect(summary.calls).toBe(1);
    expect(summary.lastCall).toBeTruthy();
  });

  it('should accumulate costs across calls', () => {
    recordAiCost({ userId: 'user-2', model: 'gpt-4.1', inputTokens: 1000, outputTokens: 0 });
    recordAiCost({ userId: 'user-2', model: 'gpt-4.1', inputTokens: 1000, outputTokens: 0 });

    const summary = getUserCostSummary('user-2');
    expect(summary.calls).toBe(2);
    expect(summary.total).toBeCloseTo(0.004, 5);
  });

  it('should track daily costs', () => {
    recordAiCost({ userId: 'user-3', model: 'gpt-4.1', inputTokens: 1000, outputTokens: 500 });

    const daily = getDailyCostSummary();
    expect(daily.total).toBeGreaterThan(0);
    expect(daily.calls).toBe(1);
    expect(daily.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should return cost breakdown', () => {
    const result = recordAiCost({
      userId: 'user-4',
      model: 'gemini-2.5-flash',
      inputTokens: 5000,
      outputTokens: 2000,
    });
    expect(result.cost).toBeGreaterThan(0);
    expect(result.breakdown.input).toBeGreaterThan(0);
    expect(result.breakdown.output).toBeGreaterThan(0);
  });
});

describe('getAllUserCosts', () => {
  beforeEach(() => {
    resetCosts();
  });

  it('should return empty array when no costs recorded', () => {
    expect(getAllUserCosts()).toEqual([]);
  });

  it('should sort users by total cost descending', () => {
    recordAiCost({ userId: 'low', model: 'gemini-2.5-flash', inputTokens: 100, outputTokens: 50 });
    recordAiCost({ userId: 'high', model: 'gpt-4.1', inputTokens: 100000, outputTokens: 50000 });

    const all = getAllUserCosts();
    expect(all[0].userId).toBe('high');
    expect(all[1].userId).toBe('low');
  });
});

describe('resetCosts', () => {
  it('should clear all tracking data', () => {
    recordAiCost({ userId: 'user-x', model: 'gpt-4.1', inputTokens: 1000, outputTokens: 500 });
    resetCosts();

    expect(getUserCostSummary('user-x').total).toBe(0);
    expect(getDailyCostSummary().total).toBe(0);
    expect(getAllUserCosts()).toEqual([]);
  });
});
