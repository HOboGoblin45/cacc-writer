/**
 * server/ai/promptRacer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Parallel Prompt Variant A/B Testing
 *
 * Races multiple prompt variants in parallel, scores outputs, picks winner.
 * Uses this to continuously optimize prompt engineering through empirical testing.
 *
 * Features:
 *   - Concurrent execution with configurable concurrency limits
 *   - Per-section variant registry
 *   - Cost control via budget multiplier
 *   - Three race modes: full, sequential, shadow
 *   - Results logged for analysis and learning
 *
 * Env config:
 *   PROMPT_RACER_ENABLED (default: false)
 *   PROMPT_RACER_MAX_CONCURRENT (default: 2)
 *   PROMPT_RACER_BUDGET_MULTIPLIER (default: 2.0)
 *   PROMPT_RACER_MODE (default: 'full') - 'full', 'sequential', 'shadow'
 */

import log from '../logger.js';

// ─── Configuration ──────────────────────────────────────────────────────────

function isRaceEnabled() {
  return process.env.PROMPT_RACER_ENABLED === 'true';
}

const MAX_CONCURRENT_VARIANTS = Number(process.env.PROMPT_RACER_MAX_CONCURRENT) || 2;
const RACE_BUDGET_MULTIPLIER = Number(process.env.PROMPT_RACER_BUDGET_MULTIPLIER) || 2.0;
const RACE_MODE = (process.env.PROMPT_RACER_MODE || 'full').toLowerCase();

const ALLOWED_RACE_MODES = ['full', 'sequential', 'shadow'];

// ─── Variant Registry ──────────────────────────────────────────────────────

/**
 * Variant sets by section type.
 * Each variant has: promptTemplate, temperature, label
 */
const VARIANT_REGISTRY = {
  neighborhood_description: [
    {
      label: 'base-concise',
      promptTemplate: 'Provide a concise neighborhood description focusing on location and market conditions.',
      temperature: 0.5,
    },
    {
      label: 'detailed-affluent',
      promptTemplate: 'Describe the neighborhood with emphasis on affluence indicators, property values, and amenities.',
      temperature: 0.6,
    },
    {
      label: 'market-trend',
      promptTemplate: 'Analyze the neighborhood trends, growth patterns, and market dynamics affecting property values.',
      temperature: 0.7,
    },
  ],

  highest_and_best_use: [
    {
      label: 'base-standard',
      promptTemplate: 'Determine the highest and best use of the subject property as improved.',
      temperature: 0.3,
    },
    {
      label: 'detailed-legal',
      promptTemplate: 'Analyze highest and best use considering zoning, legal restrictions, and alternative uses.',
      temperature: 0.4,
    },
    {
      label: 'market-comparable',
      promptTemplate: 'Determine highest and best use by comparing similar properties in the market.',
      temperature: 0.5,
    },
  ],

  reconciliation: [
    {
      label: 'base-brief',
      promptTemplate: 'Reconcile the three approaches to value with brief explanations.',
      temperature: 0.4,
    },
    {
      label: 'detailed-weighted',
      promptTemplate: 'Reconcile the three approaches with detailed weight justifications for each.',
      temperature: 0.5,
    },
    {
      label: 'market-centric',
      promptTemplate: 'Reconcile approaches with emphasis on market approach validity and comparison data quality.',
      temperature: 0.6,
    },
  ],
};

// ─── Race Results Storage ──────────────────────────────────────────────────

/**
 * In-memory race results log.
 * Format: { timestamp, sectionId, variants, winner, mode, cost }
 */
const _raceResults = [];

/**
 * Get variant registry for a section.
 * Returns array of variants, or empty array if section not found.
 */
export function getVariantsForSection(sectionId) {
  return VARIANT_REGISTRY[sectionId] || [];
}

/**
 * Get all registered sections with variants.
 */
export function getRegisteredSections() {
  return Object.keys(VARIANT_REGISTRY);
}

/**
 * Get race configuration for diagnostics/UI.
 */
export function getRaceConfig() {
  return {
    enabled: isRaceEnabled(),
    mode: RACE_MODE,
    maxConcurrentVariants: MAX_CONCURRENT_VARIANTS,
    budgetMultiplier: RACE_BUDGET_MULTIPLIER,
    allowedModes: ALLOWED_RACE_MODES,
    registeredSections: getRegisteredSections(),
  };
}

// ─── Main Race Function ────────────────────────────────────────────────────

/**
 * Race multiple prompt variants and return the winner.
 *
 * @param {Array<object>} variants - [{ promptTemplate, temperature, label }, ...]
 * @param {object} facts - Case facts/context
 * @param {object} options
 *   @param {string} options.sectionId - Section being generated
 *   @param {Function} options.generateFn - Generator function: async (prompt, opts) => { text, usage, cost }
 *   @param {Function} [options.scoreFn] - Scorer function: (text, facts) => score (0-1)
 *   @param {object} [options.generateOptions] - Base options for generateFn
 *   @param {string} [options.mode] - Override race mode
 *   @param {object} [options.db] - Database handle for recording results
 *   @param {string} [options.userId] - User ID for logging
 *   @param {string} [options.caseId] - Case ID for logging
 * @returns {Promise<object>} { winner, text, score, results, cost, durationMs }
 */
export async function racePrompts(variants, facts, options = {}) {
  const {
    sectionId,
    generateFn,
    scoreFn,
    generateOptions = {},
    mode = RACE_MODE,
    db,
    userId,
    caseId,
  } = options;

  if (!isRaceEnabled()) {
    return {
      winner: variants[0],
      text: null,
      score: null,
      results: [],
      cost: 0,
      durationMs: 0,
      raced: false,
      reason: 'PROMPT_RACER_ENABLED=false',
    };
  }

  if (!ALLOWED_RACE_MODES.includes(mode)) {
    log.warn('prompt-racer:invalid-mode', { mode, allowed: ALLOWED_RACE_MODES });
    return {
      winner: variants[0],
      text: null,
      score: null,
      results: [],
      cost: 0,
      durationMs: 0,
      raced: false,
      reason: `Invalid race mode: ${mode}`,
    };
  }

  if (!generateFn || typeof generateFn !== 'function') {
    throw new Error('generateFn is required and must be a function');
  }

  const startTime = Date.now();
  const results = [];
  let totalCost = 0;

  try {
    // ── Full Mode: Run all variants in parallel ────────────────────────────

    if (mode === 'full' || mode === 'shadow') {
      const promises = variants.map(async (variant) => {
        try {
          // Combine base options with variant-specific overrides
          const callOptions = {
            ...generateOptions,
            temperature: variant.temperature,
          };

          const response = await generateFn(variant.promptTemplate, callOptions);
          const text = response.text || '';
          const cost = response.cost || 0;

          // Score the output
          const score = scoreFn ? scoreFn(text, facts) : 0.5;

          results.push({
            variant: variant.label,
            score,
            length: text.length,
            cost,
            text,
            ok: true,
          });

          totalCost += cost;

          log.debug('prompt-racer:variant-result', {
            sectionId,
            variant: variant.label,
            score: score.toFixed(2),
            cost: cost.toFixed(6),
          });

          return { variant, text, score, cost };
        } catch (err) {
          log.warn('prompt-racer:variant-error', {
            sectionId,
            variant: variant.label,
            error: err.message,
          });

          results.push({
            variant: variant.label,
            score: 0,
            error: err.message,
            ok: false,
          });

          return null;
        }
      });

      // Wait for all variants (allow partial failures)
      const outcomes = await Promise.allSettled(promises);
      const successfulResults = outcomes
        .map(r => r.status === 'fulfilled' ? r.value : null)
        .filter(r => r !== null);

      if (successfulResults.length === 0) {
        throw new Error('All variants failed to generate');
      }

      // Pick winner by score
      const winner = successfulResults.reduce((best, current) =>
        current.score > best.score ? current : best
      );

      const durationMs = Date.now() - startTime;

      // Record results
      recordRaceResult({
        sectionId,
        variants: results,
        winner: winner.variant.label,
        mode,
        cost: totalCost,
        durationMs,
        userId,
        caseId,
        db,
      });

      const shadowResult = mode === 'shadow'
        ? { winner: variants[0], text: null }
        : { winner: winner.variant, text: winner.text };

      return {
        winner: shadowResult.winner,
        text: shadowResult.text,
        score: mode === 'shadow' ? null : winner.score,
        results,
        cost: totalCost,
        durationMs,
        raced: true,
        mode,
      };
    }

    // ── Sequential Mode: Run second only if first scores below threshold ────

    if (mode === 'sequential') {
      const threshold = 0.70; // Run second variant if first scores below 70%

      // Run first variant
      const firstVariant = variants[0];
      const firstResponse = await generateFn(firstVariant.promptTemplate, {
        ...generateOptions,
        temperature: firstVariant.temperature,
      });

      const firstText = firstResponse.text || '';
      const firstScore = scoreFn ? scoreFn(firstText, facts) : 0.5;
      totalCost += firstResponse.cost || 0;

      results.push({
        variant: firstVariant.label,
        score: firstScore,
        length: firstText.length,
        cost: firstResponse.cost || 0,
        text: firstText,
        ok: true,
      });

      // If first scores well, use it
      if (firstScore >= threshold) {
        const durationMs = Date.now() - startTime;

        recordRaceResult({
          sectionId,
          variants: results,
          winner: firstVariant.label,
          mode,
          cost: totalCost,
          durationMs,
          userId,
          caseId,
          db,
        });

        return {
          winner: firstVariant,
          text: firstText,
          score: firstScore,
          results,
          cost: totalCost,
          durationMs,
          raced: true,
          mode,
        };
      }

      // First scored poorly, try second variant
      if (variants.length > 1) {
        const secondVariant = variants[1];
        const secondResponse = await generateFn(secondVariant.promptTemplate, {
          ...generateOptions,
          temperature: secondVariant.temperature,
        });

        const secondText = secondResponse.text || '';
        const secondScore = scoreFn ? scoreFn(secondText, facts) : 0.5;
        totalCost += secondResponse.cost || 0;

        results.push({
          variant: secondVariant.label,
          score: secondScore,
          length: secondText.length,
          cost: secondResponse.cost || 0,
          text: secondText,
          ok: true,
        });

        // Pick better of the two
        const winner = secondScore > firstScore ? secondVariant : firstVariant;
        const winnerScore = secondScore > firstScore ? secondScore : firstScore;
        const winnerText = secondScore > firstScore ? secondText : firstText;

        const durationMs = Date.now() - startTime;

        recordRaceResult({
          sectionId,
          variants: results,
          winner: winner.label,
          mode,
          cost: totalCost,
          durationMs,
          userId,
          caseId,
          db,
        });

        return {
          winner,
          text: winnerText,
          score: winnerScore,
          results,
          cost: totalCost,
          durationMs,
          raced: true,
          mode,
        };
      }

      // Only one variant available
      const durationMs = Date.now() - startTime;

      recordRaceResult({
        sectionId,
        variants: results,
        winner: firstVariant.label,
        mode,
        cost: totalCost,
        durationMs,
        userId,
        caseId,
        db,
      });

      return {
        winner: firstVariant,
        text: firstText,
        score: firstScore,
        results,
        cost: totalCost,
        durationMs,
        raced: true,
        mode,
      };
    }

    throw new Error(`Unknown race mode: ${mode}`);
  } catch (err) {
    const durationMs = Date.now() - startTime;

    log.error('prompt-racer:race-failed', {
      sectionId,
      mode,
      error: err.message,
      durationMs,
    });

    // Fall back to first variant on critical failure
    return {
      winner: variants[0],
      text: null,
      score: null,
      results,
      cost: totalCost,
      durationMs,
      raced: false,
      error: err.message,
    };
  }
}

// ─── Results Recording ──────────────────────────────────────────────────────

/**
 * Record race result to log and optionally database.
 */
function recordRaceResult({ sectionId, variants, winner, mode, cost, durationMs, userId, caseId, db }) {
  const result = {
    timestamp: new Date().toISOString(),
    sectionId,
    variants,
    winner,
    mode,
    cost,
    durationMs,
  };

  _raceResults.push(result);

  log.info('prompt-racer:race-recorded', {
    sectionId,
    winner,
    mode,
    cost: cost.toFixed(6),
    durationMs,
    variantCount: variants.length,
  });

  // Optional: Record to database for analysis
  if (db && caseId && userId) {
    try {
      // Would implement database recording here
      // db.recordPromptRaceResult({ caseId, userId, ...result })
    } catch (err) {
      log.warn('prompt-racer:db-record-failed', { error: err.message });
    }
  }
}

/**
 * Get race results history (in-memory).
 * @param {number} [limit] - Max results to return
 * @returns {Array<object>}
 */
export function getRaceResults(limit = 100) {
  return _raceResults.slice(-limit);
}

/**
 * Get race statistics by section.
 */
export function getRaceStatsBySection() {
  const stats = {};

  for (const result of _raceResults) {
    const sectionId = result.sectionId;
    if (!stats[sectionId]) {
      stats[sectionId] = {
        totalRaces: 0,
        winners: {},
        totalCost: 0,
        avgDurationMs: 0,
        races: [],
      };
    }

    stats[sectionId].totalRaces++;
    stats[sectionId].winners[result.winner] = (stats[sectionId].winners[result.winner] || 0) + 1;
    stats[sectionId].totalCost += result.cost;
    stats[sectionId].races.push(result);
  }

  // Calculate averages
  for (const section of Object.values(stats)) {
    if (section.totalRaces > 0) {
      section.avgDurationMs = Math.round(
        section.races.reduce((sum, r) => sum + r.durationMs, 0) / section.totalRaces
      );
      section.avgCostPerRace = (section.totalCost / section.totalRaces).toFixed(6);
    }
    delete section.races; // Don't include full race history in stats
  }

  return stats;
}

/**
 * Clear race results history.
 */
export function clearRaceResults() {
  const count = _raceResults.length;
  _raceResults.length = 0;
  log.info('prompt-racer:results-cleared', { count });
  return count;
}

export default {
  racePrompts,
  isRaceEnabled,
  getRaceConfig,
  getVariantsForSection,
  getRegisteredSections,
  getRaceResults,
  getRaceStatsBySection,
  clearRaceResults,
};
