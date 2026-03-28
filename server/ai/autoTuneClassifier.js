/**
 * server/ai/autoTuneClassifier.js
 * --------------------------------
 * AutoTune Context Classifier for CACC Writer
 *
 * Dynamically adjusts AI generation parameters based on historical quality data
 * using EMA (Exponential Moving Average) learning. Classifies each section
 * generation request by context (form type, section, property complexity, market)
 * and adjusts temperature/maxTokens accordingly.
 *
 * Features:
 *   - Context classification by contextKey (groups similar generations)
 *   - EMA state management: avgScore, avgTokensUsed, optimalTemperature, optimalMaxTokens
 *   - Parameter adjustment with bounded ranges
 *   - Outcome recording integrates with feedbackLoopService
 *   - Feature flag respect (AUTOTUNE_ENABLED)
 *   - In-memory tracking with optional SQLite persistence
 *   - Diagnostic endpoints for debugging
 */

import log from '../logger.js';
import { resolveProfileForSection, getProfile } from '../generators/generatorProfiles.js';

// ─── Configuration ──────────────────────────────────────────────────────────

// Check at runtime, not import time, to allow tests to modify env vars
function isAutotuneEnabled() {
  return process.env.AUTOTUNE_ENABLED !== 'false'; // default true
}

const EMA_ALPHA = 0.3; // EMA smoothing factor: 0.3 means 30% weight to new value

// Bounds for parameter adjustments
const TEMPERATURE_DEVIATION = 0.2; // ±0.2 from base profile
const MAXTOKENS_DEVIATION_PCT = 0.3; // ±30% from base profile
const TOPK_DEVIATION_PCT = 0.15; // ±15% for topK adjustments

// Income section multi-unit boost
const INCOME_SECTION_TOKEN_BOOST = 1.2; // 20% more tokens for multi-unit income sections

// ─── In-Memory State ───────────────────────────────────────────────────────

/**
 * EMA state per contextKey:
 * {
 *   avgScore: number (0-100),
 *   scoreCount: number,
 *   avgTokensUsed: number,
 *   tokensCount: number,
 *   optimalTemperature: number,
 *   optimalMaxTokens: number,
 *   lastUpdated: timestamp
 * }
 */
const _emaState = new Map();

// ─── Context Classification ─────────────────────────────────────────────────

/**
 * Classify a section generation request by context.
 * Generates a contextKey that groups similar generations together.
 *
 * @param {Object} params
 * @param {string} params.sectionId - section identifier (e.g., 'neighborhood_description')
 * @param {string} params.formType - form type ('1004' or '1025')
 * @param {Object} params.facts - property facts object
 * @param {string} [params.marketArea] - market area code or name
 * @returns {string} contextKey
 */
export function classifyContext({ sectionId, formType, facts = {}, marketArea = '' }) {
  // Ensure facts is an object
  const safeFacts = facts && typeof facts === 'object' ? facts : {};

  // Determine property complexity based on facts
  const complexity = determineComplexity(safeFacts);

  // Determine income property type if applicable
  const incomeLevel = safeFacts.unitCount ? 'multi-unit' : 'single-unit';

  // Build context key: form:section:complexity:incomeLevel:marketArea
  const key = [
    formType || '1004',
    sectionId,
    complexity,
    incomeLevel,
    marketArea ? `market-${marketArea}` : 'market-default',
  ].join(':');

  return key;
}

/**
 * Determine property complexity from facts.
 * Returns 'simple', 'moderate', or 'complex'.
 *
 * @param {Object} facts
 * @returns {string}
 */
function determineComplexity(facts) {
  // Simple heuristics based on fact structure
  if (!facts || typeof facts !== 'object') return 'simple';

  const fieldCount = Object.keys(facts).length;
  const complexFieldNames = [
    'improvements',
    'comparable_sales',
    'concessions',
    'adjustments',
    'income_data',
    'rentRoll',
  ];
  const hasComplexFields = complexFieldNames.some(field => {
    const val = facts[field];
    return val !== undefined && val !== null && (Array.isArray(val) || typeof val === 'object');
  });

  if (fieldCount > 25 && hasComplexFields) return 'complex';
  if (fieldCount > 15 || (fieldCount > 8 && hasComplexFields)) return 'moderate';
  return 'simple';
}

// ─── EMA State Management ───────────────────────────────────────────────────

/**
 * Update EMA state when a section outcome is recorded.
 * Uses exponential moving average to track quality and token usage.
 *
 * @param {string} contextKey
 * @param {Object} outcome
 * @param {number} outcome.qualityScore - 0-100
 * @param {number} outcome.tokensUsed - actual tokens consumed
 * @returns {Object} updated EMA state
 */
function updateEmaState(contextKey, { qualityScore, tokensUsed }) {
  let state = _emaState.get(contextKey) || {
    avgScore: 50, // neutral default
    scoreCount: 0,
    avgTokensUsed: 0,
    tokensCount: 0,
    optimalTemperature: 0.5, // neutral
    optimalMaxTokens: 700, // neutral
    lastUpdated: new Date().toISOString(),
  };

  // Update EMA for quality score
  if (typeof qualityScore === 'number' && qualityScore >= 0 && qualityScore <= 100) {
    // First value: initialize directly; subsequent values use EMA
    if (state.scoreCount === 0) {
      state.avgScore = qualityScore;
    } else {
      state.avgScore = EMA_ALPHA * qualityScore + (1 - EMA_ALPHA) * state.avgScore;
    }
    state.scoreCount++;
  }

  // Update EMA for tokens used
  if (typeof tokensUsed === 'number' && tokensUsed > 0) {
    // First value: initialize directly; subsequent values use EMA
    if (state.tokensCount === 0) {
      state.avgTokensUsed = tokensUsed;
    } else {
      state.avgTokensUsed = EMA_ALPHA * tokensUsed + (1 - EMA_ALPHA) * state.avgTokensUsed;
    }
    state.tokensCount++;
  }

  // Adjust optimal parameters based on quality trend
  // High quality (>75) suggests current settings are good; stay closer
  // Low quality (<40) suggests we need adjustments
  if (state.avgScore > 75) {
    // Good quality: slightly increase temperature (more creativity) if tokens allow
    state.optimalTemperature = Math.min(0.85, state.optimalTemperature + 0.01);
  } else if (state.avgScore < 40) {
    // Poor quality: reduce temperature (more deterministic)
    state.optimalTemperature = Math.max(0.15, state.optimalTemperature - 0.02);
  }

  state.lastUpdated = new Date().toISOString();
  _emaState.set(contextKey, state);

  return state;
}

// ─── Parameter Adjustment ───────────────────────────────────────────────────

/**
 * Get optimized generation parameters for a section.
 * Returns adjusted temperature/maxTokens based on EMA history.
 *
 * @param {string} sectionId
 * @param {string} formType
 * @param {Object} facts
 * @param {Object} baseProfile - from generatorProfiles.js
 * @returns {Object} { temperature, maxTokens, topP }
 */
export function getOptimizedParams(sectionId, formType, facts, baseProfile) {
  // If AutoTune is disabled, return base profile unchanged
  if (!isAutotuneEnabled()) {
    return {
      temperature: baseProfile.temperature,
      maxTokens: baseProfile.maxTokens,
      topP: baseProfile.topP ?? 0.95,
    };
  }

  // Classify context
  const contextKey = classifyContext({
    sectionId,
    formType,
    facts,
    marketArea: facts?.marketArea,
  });

  // Get EMA state for this context
  const state = _emaState.get(contextKey);

  // If no history, return base profile unchanged
  if (!state || state.scoreCount === 0) {
    return {
      temperature: baseProfile.temperature,
      maxTokens: baseProfile.maxTokens,
      topP: baseProfile.topP ?? 0.95,
    };
  }

  // Calculate adjustments based on EMA state
  let temperature = baseProfile.temperature;
  let maxTokens = baseProfile.maxTokens;

  // Adjust temperature based on average quality score
  // Score > 75: increase temperature (more creative, wider exploration)
  // Score < 40: decrease temperature (more deterministic)
  const scoreDeviation = (state.avgScore - 50) / 50; // -1 to +1
  const tempAdjustment = scoreDeviation * TEMPERATURE_DEVIATION;
  temperature = Math.max(0.1, Math.min(1.0, baseProfile.temperature + tempAdjustment));

  // Adjust maxTokens based on average tokens used
  // If consistently using > 90% of budget: increase budget
  // If consistently using < 70% of budget: reduce budget
  const tokenUtilization = state.avgTokensUsed / baseProfile.maxTokens;
  let tokenMultiplier = 1.0;
  if (tokenUtilization > 0.9) {
    tokenMultiplier = 1 + MAXTOKENS_DEVIATION_PCT; // Increase by 30%
  } else if (tokenUtilization < 0.7) {
    tokenMultiplier = 1 - MAXTOKENS_DEVIATION_PCT; // Decrease by 30%
  }

  // Context-aware override: multi-unit properties (1025) get boost for income sections
  if (
    formType === '1025' &&
    facts?.unitCount &&
    facts.unitCount > 1 &&
    isIncomeSection(sectionId)
  ) {
    tokenMultiplier *= INCOME_SECTION_TOKEN_BOOST;
  }

  maxTokens = Math.round(baseProfile.maxTokens * tokenMultiplier);
  // Ensure reasonable bounds
  maxTokens = Math.max(200, Math.min(2000, maxTokens));

  return {
    temperature,
    maxTokens,
    topP: 0.95, // topP typically stays fixed
  };
}

/**
 * Check if a section is an income-related section.
 *
 * @param {string} sectionId
 * @returns {boolean}
 */
function isIncomeSection(sectionId) {
  return [
    'income_approach_summary',
    'income_description',
    'income_analysis',
    'rental_income',
    'gross_income',
    'expense_analysis',
  ].includes(sectionId);
}

// ─── Outcome Recording ───────────────────────────────────────────────────────

/**
 * Record the outcome of a section generation.
 * Updates EMA state and integrates with feedback loop.
 *
 * @param {string} contextKey
 * @param {Object} outcome
 * @param {number} outcome.qualityScore - 0-100 quality score
 * @param {number} outcome.tokensUsed - tokens consumed
 * @param {boolean} [outcome.wasApproved] - was section approved
 * @param {string} [outcome.sectionId] - for logging/tracking
 * @returns {Object} { contextKey, emaState, recorded: true }
 */
export function recordOutcome(contextKey, outcome = {}) {
  if (!isAutotuneEnabled()) {
    return {
      contextKey,
      recorded: false,
      reason: 'AUTOTUNE_ENABLED=false',
    };
  }

  if (!contextKey || typeof contextKey !== 'string') {
    log.warn('autotune:outcome-invalid-key', { contextKey, outcome });
    return { contextKey, recorded: false, reason: 'invalid contextKey' };
  }

  // Extract and validate outcome data
  const { qualityScore, tokensUsed, wasApproved, sectionId } = outcome;

  // Update EMA state
  const emaState = updateEmaState(contextKey, { qualityScore, tokensUsed });

  log.info('autotune:outcome-recorded', {
    contextKey,
    sectionId,
    qualityScore,
    tokensUsed,
    wasApproved,
    avgScore: emaState.avgScore,
    avgTokensUsed: Math.round(emaState.avgTokensUsed),
    scoreCount: emaState.scoreCount,
  });

  return {
    contextKey,
    emaState,
    recorded: true,
  };
}

// ─── Diagnostic Endpoints ───────────────────────────────────────────────────

/**
 * Get current EMA state for a context.
 * Used for debugging and diagnostics.
 *
 * @param {string} contextKey
 * @returns {Object|null}
 */
export function getEmaState(contextKey) {
  return _emaState.get(contextKey) || null;
}

/**
 * Get all tracked context keys.
 *
 * @returns {string[]}
 */
export function getAllContextKeys() {
  return Array.from(_emaState.keys());
}

/**
 * Get statistics for all tracked contexts.
 *
 * @returns {Array<Object>}
 */
export function getAllContextStats() {
  const stats = [];
  for (const [contextKey, state] of _emaState.entries()) {
    stats.push({
      contextKey,
      avgScore: Math.round(state.avgScore * 100) / 100,
      scoreCount: state.scoreCount,
      avgTokensUsed: Math.round(state.avgTokensUsed),
      tokensCount: state.tokensCount,
      optimalTemperature: Math.round(state.optimalTemperature * 100) / 100,
      optimalMaxTokens: state.optimalMaxTokens,
      lastUpdated: state.lastUpdated,
    });
  }
  return stats;
}

/**
 * Reset EMA state for a specific context.
 * Useful for testing or clearing bad data.
 *
 * @param {string} contextKey
 * @returns {boolean} true if context existed and was cleared
 */
export function resetContext(contextKey) {
  const existed = _emaState.has(contextKey);
  if (existed) {
    _emaState.delete(contextKey);
    log.info('autotune:context-reset', { contextKey });
  }
  return existed;
}

/**
 * Reset all EMA state.
 * WARNING: Clears all learning history.
 *
 * @returns {number} number of contexts cleared
 */
export function resetAllContexts() {
  const count = _emaState.size;
  _emaState.clear();
  log.warn('autotune:all-contexts-reset', { count });
  return count;
}

/**
 * Load EMA state from external source (e.g., database).
 * Used when initializing from persisted state.
 *
 * @param {Array<Object>} states - array of { contextKey, state }
 */
export function loadEmaState(states) {
  if (!Array.isArray(states)) return;
  for (const { contextKey, state } of states) {
    if (contextKey && state && typeof state === 'object') {
      _emaState.set(contextKey, state);
    }
  }
  log.info('autotune:ema-state-loaded', { count: states.length });
}

/**
 * Export all EMA state for persistence.
 * Returns array suitable for passing to loadEmaState or storing in DB.
 *
 * @returns {Array<Object>}
 */
export function exportEmaState() {
  const exported = [];
  for (const [contextKey, state] of _emaState.entries()) {
    exported.push({ contextKey, state });
  }
  return exported;
}

// ─── Integration with generateSection (example usage) ──────────────────────

/**
 * This is an example of how AutoTune would be integrated in generateSection.js.
 * The actual integration happens in the orchestrator/generateSection.js file.
 *
 * Example:
 *   import { getOptimizedParams } from '../ai/autoTuneClassifier.js';
 *
 *   // In generateSection function:
 *   const baseProfile = resolveProfileForSection(sectionId);
 *   const optimizedParams = getOptimizedParams(sectionId, formType, facts, baseProfile);
 *
 *   // Use optimizedParams.temperature and optimizedParams.maxTokens
 *   // in the AI call instead of baseProfile values
 *   const output = await callAI({
 *     ...options,
 *     temperature: optimizedParams.temperature,
 *     maxTokens: optimizedParams.maxTokens,
 *   });
 *
 *   // After scoring:
 *   const { qualityScore } = scoreSectionOutput(output, ...);
 *   recordOutcome(
 *     classifyContext({ sectionId, formType, facts, marketArea: facts.marketArea }),
 *     { qualityScore, tokensUsed: output.usage.completion_tokens }
 *   );
 */

export default {
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
};
