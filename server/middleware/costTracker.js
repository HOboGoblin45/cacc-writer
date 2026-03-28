/**
 * server/middleware/costTracker.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI cost tracking middleware and utilities.
 *
 * Tracks estimated AI costs per user and per request for:
 *   - Usage-based billing calculations
 *   - Cost anomaly detection (runaway generation loops)
 *   - Admin dashboard metrics
 *   - Per-user cost caps (free tier protection)
 *
 * Cost model:
 *   OpenAI GPT-4.1:       $2.00/M input, $8.00/M output
 *   Gemini 2.5 Flash:     $0.15/M input, $0.60/M output
 *   Platform AI (Gemini):  Same as Gemini
 *   Fine-tuned Llama:     $0 (self-hosted on RunPod)
 */

import log from '../logger.js';

// ── Cost rates per million tokens ────────────────────────────────────────────
export const COST_RATES = {
  'gpt-4.1':          { input: 2.00,  output: 8.00  },
  'gpt-4o':           { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':      { input: 0.15,  output: 0.60  },
  'gpt-4-turbo':      { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo':    { input: 0.50,  output: 1.50  },
  'gemini-2.5-flash': { input: 0.15,  output: 0.60  },
  'gemini-2.5-pro':   { input: 1.25,  output: 10.00 },
  'o1':               { input: 15.00, output: 60.00 },
  'o3':               { input: 15.00, output: 60.00 },
  'o4-mini':          { input: 1.10,  output: 4.40  },
  // Self-hosted models are free
  'cacc-appraiser':   { input: 0,     output: 0     },
  'llama':            { input: 0,     output: 0     },
};

// ── In-memory cost accumulator ──────────────────────────────────────────────
// Tracks per-user costs for the current billing period.
// Reset on server restart or via resetCosts().
const _userCosts = new Map();
const _dailyCosts = { date: null, total: 0, calls: 0 };

/**
 * Estimate cost for an AI call.
 *
 * @param {object} params
 *   @param {string} params.model
 *   @param {number} params.inputTokens
 *   @param {number} params.outputTokens
 * @returns {{ cost: number, breakdown: { input: number, output: number } }}
 */
export function estimateCost({ model, inputTokens = 0, outputTokens = 0 }) {
  // Find matching rate (partial match for model families)
  let rates = null;
  const modelLower = (model || '').toLowerCase();
  for (const [key, value] of Object.entries(COST_RATES)) {
    if (modelLower.includes(key)) {
      rates = value;
      break;
    }
  }
  if (!rates) rates = { input: 2.00, output: 8.00 }; // default to GPT-4.1 rates

  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;

  return {
    cost: inputCost + outputCost,
    breakdown: { input: inputCost, output: outputCost },
  };
}

/**
 * Record an AI call cost.
 *
 * @param {object} params
 *   @param {string} params.userId
 *   @param {string} params.model
 *   @param {number} params.inputTokens
 *   @param {number} params.outputTokens
 *   @param {string} [params.feature] — what triggered the call
 *   @param {string} [params.requestId]
 */
export function recordAiCost({ userId, model, inputTokens, outputTokens, feature, requestId }) {
  const { cost, breakdown } = estimateCost({ model, inputTokens, outputTokens });

  // Update user accumulator
  if (userId) {
    const current = _userCosts.get(userId) || { total: 0, calls: 0 };
    current.total += cost;
    current.calls += 1;
    current.lastCall = new Date().toISOString();
    _userCosts.set(userId, current);
  }

  // Update daily accumulator
  const today = new Date().toISOString().slice(0, 10);
  if (_dailyCosts.date !== today) {
    _dailyCosts.date = today;
    _dailyCosts.total = 0;
    _dailyCosts.calls = 0;
  }
  _dailyCosts.total += cost;
  _dailyCosts.calls += 1;

  // Log for analysis
  if (cost > 0) {
    log.info('ai:cost', {
      userId,
      model,
      inputTokens,
      outputTokens,
      cost: `$${cost.toFixed(6)}`,
      feature: feature || 'unknown',
      requestId,
    });
  }

  // Cost anomaly detection — warn if a single call costs more than $0.50
  if (cost > 0.50) {
    log.warn('ai:cost-anomaly', {
      userId,
      model,
      cost: `$${cost.toFixed(4)}`,
      inputTokens,
      outputTokens,
      feature,
    });
  }

  return { cost, breakdown };
}

/**
 * Get cost summary for a user.
 *
 * @param {string} userId
 * @returns {{ total: number, calls: number, lastCall: string|null }}
 */
export function getUserCostSummary(userId) {
  return _userCosts.get(userId) || { total: 0, calls: 0, lastCall: null };
}

/**
 * Get daily cost summary.
 * @returns {{ date: string, total: number, calls: number }}
 */
export function getDailyCostSummary() {
  const today = new Date().toISOString().slice(0, 10);
  if (_dailyCosts.date !== today) {
    return { date: today, total: 0, calls: 0 };
  }
  return { ..._dailyCosts };
}

/**
 * Get all user costs (for admin dashboard).
 * @returns {Array<{ userId: string, total: number, calls: number }>}
 */
export function getAllUserCosts() {
  const results = [];
  for (const [userId, data] of _userCosts) {
    results.push({ userId, ...data });
  }
  return results.sort((a, b) => b.total - a.total);
}

/**
 * Reset all cost tracking (for testing or billing period reset).
 */
export function resetCosts() {
  _userCosts.clear();
  _dailyCosts.date = null;
  _dailyCosts.total = 0;
  _dailyCosts.calls = 0;
}

export default {
  estimateCost,
  recordAiCost,
  getUserCostSummary,
  getDailyCostSummary,
  getAllUserCosts,
  resetCosts,
  COST_RATES,
};
