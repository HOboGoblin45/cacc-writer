/**
 * server/ai/ultraplanianEvaluator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Deep Quality Scoring for Appraisal Narratives
 *
 * Evaluates narrative quality across appraisal-specific dimensions:
 *   - factualAccuracy: Facts match case data
 *   - logicalCoherence: Arguments flow logically
 *   - professionalVoice: Certified appraiser quality
 *   - uadCompliance: UAD codes, C/Q ratings, quantified adjustments
 *   - completeness: All required data points addressed
 *   - conciseness: No filler, appropriate length
 *   - supportability: Claims backed by data
 *   - readability: Clear sentence structure, vocabulary
 *
 * Two evaluation modes:
 *   - Quick: Regex/heuristic-based (fast, no AI cost)
 *   - Deep: AI-assisted evaluation (slower, more accurate)
 *
 * Env config:
 *   ULTRAPLINIAN_ENABLED (default: false)
 *   ULTRAPLINIAN_MODE (default: 'quick') - 'quick', 'deep', 'hybrid'
 */

import log from '../logger.js';

// ─── Configuration ──────────────────────────────────────────────────────────

function isUltraplanianEnabled() {
  return process.env.ULTRAPLINIAN_ENABLED === 'true';
}

const EVALUATION_MODE = (process.env.ULTRAPLINIAN_MODE || 'quick').toLowerCase();

export const EVALUATION_DIMENSIONS = [
  'factualAccuracy',
  'logicalCoherence',
  'professionalVoice',
  'uadCompliance',
  'completeness',
  'conciseness',
  'supportability',
  'readability',
];

// Default weights (sum should equal 1.0)
const DEFAULT_WEIGHTS = {
  factualAccuracy: 0.20,
  logicalCoherence: 0.15,
  professionalVoice: 0.10,
  uadCompliance: 0.15,
  completeness: 0.15,
  conciseness: 0.10,
  supportability: 0.10,
  readability: 0.05,
};

// Section-specific weight profiles
const SECTION_WEIGHT_PROFILES = {
  // Approach sections need strong UAD compliance
  sales_comparison_approach: {
    ...DEFAULT_WEIGHTS,
    uadCompliance: 0.25,
    supportability: 0.20,
    factualAccuracy: 0.15,
  },

  cost_approach: {
    ...DEFAULT_WEIGHTS,
    uadCompliance: 0.25,
    supportability: 0.20,
    factualAccuracy: 0.15,
  },

  income_approach: {
    ...DEFAULT_WEIGHTS,
    uadCompliance: 0.25,
    supportability: 0.20,
    completeness: 0.10,
  },

  // Reconciliation needs strong logic and completeness
  reconciliation: {
    ...DEFAULT_WEIGHTS,
    logicalCoherence: 0.25,
    completeness: 0.20,
    supportability: 0.15,
    factualAccuracy: 0.15,
  },

  // Neighborhood description emphasizes professional voice and readability
  neighborhood_description: {
    ...DEFAULT_WEIGHTS,
    professionalVoice: 0.20,
    readability: 0.15,
    logicalCoherence: 0.15,
    completeness: 0.15,
  },
};

// Verdict thresholds
const VERDICT_THRESHOLDS = {
  excellent: 0.90,
  good: 0.75,
  acceptable: 0.60,
  needs_revision: 0.45,
  reject: 0,
};

export const VERDICTS = ['excellent', 'good', 'acceptable', 'needs_revision', 'reject'];

// ─── Quick Evaluation (Heuristic) ──────────────────────────────────────────

/**
 * Quick regex-based evaluation of a narrative.
 * No AI calls, fast results.
 *
 * @param {string} text - Narrative text
 * @param {object} facts - Case facts for reference
 * @param {string} [sectionId] - Section identifier
 * @returns {object} Evaluation results with scores per dimension
 */
export function quickEvaluate(text, facts = {}, sectionId = 'default') {
  const scores = {};

  // ── Factual Accuracy ─────────────────────────────────────────────────────
  // Check for obvious placeholder or unresolved markers
  const hasPlaceholders = /\[INSERT\]|\[TBD\]|\[.*?\]|\{\{.*?\}\}/g.test(text);
  const placeholderCount = (text.match(/\[INSERT\]|\[TBD\]/gi) || []).length;
  scores.factualAccuracy = hasPlaceholders ? Math.max(0.5, 1.0 - (placeholderCount * 0.1)) : 0.95;

  // ── Logical Coherence ───────────────────────────────────────────────────
  // Check for sentence flow, transition words
  const transitionWords = [
    'therefore', 'however', 'furthermore', 'in addition', 'consequently',
    'as a result', 'on the other hand', 'similarly', 'in contrast',
  ];
  const transitionCount = transitionWords.filter(word =>
    new RegExp(`\\b${word}\\b`, 'i').test(text)
  ).length;
  const sentenceCount = (text.match(/[.!?]/g) || []).length;
  const avgTransitionsPerSentence = sentenceCount > 0 ? transitionCount / sentenceCount : 0;
  scores.logicalCoherence = Math.min(1.0, 0.5 + (avgTransitionsPerSentence * 0.2));

  // ── Professional Voice ───────────────────────────────────────────────────
  // Check for informal language vs professional appraisal terms
  const informalPatterns = /\b(like|really|very|stuff|thing|guy|you know|LOL|etc\.)\b/gi;
  const formalPatterns = /\b(appraised|subject property|subject|dwelling|improvement|comparable|approach|valuation)\b/gi;
  const informalCount = (text.match(informalPatterns) || []).length;
  const formalCount = (text.match(formalPatterns) || []).length;
  const hasSubjectProperty = /\bsubject\s+(property|property|dwelling)/.test(text);
  scores.professionalVoice = Math.min(1.0, Math.max(0.3, 0.7 + (formalCount * 0.05) - (informalCount * 0.2) + (hasSubjectProperty ? 0.1 : 0)));

  // ── UAD Compliance ───────────────────────────────────────────────────────
  // Check for C/Q ratings, UAD codes, condition/quality vocabulary
  const uadPatterns = /\b(C[1-6]|Q[1-6]|condition|quality|as-is|repairs|renovations|adjustments|depreciation|value impact)\b/gi;
  const quantifiedPatterns = /(\$[\d,]+|[\d,]+%|[\d.]+%)/g;
  const uadCount = (text.match(uadPatterns) || []).length;
  const quantifiedCount = (text.match(quantifiedPatterns) || []).length;
  scores.uadCompliance = Math.min(1.0, 0.5 + (uadCount * 0.05) + (quantifiedCount * 0.03));

  // ── Completeness ────────────────────────────────────────────────────────
  // Check for adequate length and data point coverage
  const wordCount = text.split(/\s+/).length;
  const minWords = 75; // Typical appraisal section minimum
  const optimalWords = 300;
  const lengthScore = wordCount < minWords ? 0.4 : (wordCount < optimalWords ? 0.8 : 1.0);
  scores.completeness = lengthScore;

  // ── Conciseness ────────────────────────────────────────────────────────
  // Check for redundancy and filler
  const redundantPatterns = /\b(very\s+\w+|really\s+\w+|kind of|sort of|basically|essentially)\b/gi;
  const redundantCount = (text.match(redundantPatterns) || []).length;
  const fillerScore = Math.max(0.5, 1.0 - (redundantCount * 0.15));
  scores.conciseness = fillerScore;

  // ── Supportability ─────────────────────────────────────────────────────
  // Check for evidence markers: comparables, data, analysis
  const evidencePatterns = /\b(comparable|comparable sales|adjustment|compared|analysis|data|market|similar)\b/gi;
  const evidenceCount = (text.match(evidencePatterns) || []).length;
  scores.supportability = Math.min(1.0, 0.5 + (evidenceCount * 0.03));

  // ── Readability ──────────────────────────────────────────────────────
  // Check for reasonable sentence length and paragraph structure
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgSentenceLength = sentences.length > 0
    ? sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length
    : 0;
  // Ideal: 15-20 words per sentence
  const isReadable = avgSentenceLength > 10 && avgSentenceLength < 25;
  scores.readability = isReadable ? 0.85 : 0.6;

  // Calculate composite score
  const weights = SECTION_WEIGHT_PROFILES[sectionId] || DEFAULT_WEIGHTS;
  let compositeScore = 0;
  for (const [dimension, weight] of Object.entries(weights)) {
    compositeScore += (scores[dimension] || 0.5) * weight;
  }

  return {
    mode: 'quick',
    scores,
    compositeScore: Math.min(1.0, Math.max(0, compositeScore)),
    weights,
    verdict: getVerdict(compositeScore),
    durationMs: 0,
  };
}

// ─── Deep Evaluation (AI-Assisted) ───────────────────────────────────────

/**
 * Deep AI-assisted evaluation of narrative quality.
 * Uses Claude/AI to analyze dimensions that require semantic understanding.
 *
 * @param {string} text - Narrative text
 * @param {object} facts - Case facts for context
 * @param {string} [sectionId] - Section identifier
 * @param {Function} [aiCallFn] - Function to call AI (async)
 * @returns {Promise<object>} Detailed evaluation results
 */
export async function deepEvaluate(text, facts = {}, sectionId = 'default', aiCallFn = null) {
  if (!aiCallFn) {
    log.warn('ultraplinian:deep-eval-no-ai', { sectionId });
    return quickEvaluate(text, facts, sectionId);
  }

  const startTime = Date.now();

  try {
    // Call AI to evaluate each dimension
    const prompt = buildEvaluationPrompt(text, facts, sectionId);

    const response = await aiCallFn(prompt, {
      maxTokens: 800,
      temperature: 0.2,
    });

    const evaluationText = response.text || response;
    const scores = parseEvaluationResponse(evaluationText);

    // Calculate composite score using section-specific weights
    const weights = SECTION_WEIGHT_PROFILES[sectionId] || DEFAULT_WEIGHTS;
    let compositeScore = 0;
    for (const [dimension, weight] of Object.entries(weights)) {
      compositeScore += (scores[dimension] || 0.5) * weight;
    }

    const durationMs = Date.now() - startTime;

    return {
      mode: 'deep',
      scores,
      compositeScore: Math.min(1.0, Math.max(0, compositeScore)),
      weights,
      verdict: getVerdict(compositeScore),
      durationMs,
      aiResponse: evaluationText,
    };
  } catch (err) {
    log.warn('ultraplinian:deep-eval-failed', {
      sectionId,
      error: err.message,
    });

    // Fall back to quick evaluation
    const quickResult = quickEvaluate(text, facts, sectionId);
    return {
      ...quickResult,
      mode: 'hybrid', // Started as deep, fell back to quick
      fallback: true,
      fallbackReason: err.message,
    };
  }
}

/**
 * Build evaluation prompt for AI.
 */
function buildEvaluationPrompt(text, facts, sectionId) {
  return `Evaluate this appraisal narrative section on the following dimensions. Score each 0-1.

TEXT TO EVALUATE:
${text}

EVALUATION DIMENSIONS:
1. factualAccuracy (0-1): Are all stated facts accurate and matching case data?
2. logicalCoherence (0-1): Do arguments flow logically with no contradictions?
3. professionalVoice (0-1): Reads like work of certified appraiser? (0=unprofessional, 1=excellent)
4. uadCompliance (0-1): Contains C/Q ratings, UAD codes, quantified adjustments?
5. completeness (0-1): Are all required data points for this section addressed?
6. conciseness (0-1): No filler/redundancy? Appropriate length? (0=verbose/incomplete, 1=concise/complete)
7. supportability (0-1): Are claims backed by data/analysis/comparables?
8. readability (0-1): Clear sentence structure, appropriate vocabulary, good flow?

Respond with ONLY valid JSON:
{"factualAccuracy": 0.0, "logicalCoherence": 0.0, "professionalVoice": 0.0, "uadCompliance": 0.0, "completeness": 0.0, "conciseness": 0.0, "supportability": 0.0, "readability": 0.0}`;
}

/**
 * Parse AI evaluation response.
 */
function parseEvaluationResponse(responseText) {
  const scores = {};

  try {
    // Try to parse JSON directly
    const json = JSON.parse(responseText);
    for (const dimension of EVALUATION_DIMENSIONS) {
      scores[dimension] = Math.min(1.0, Math.max(0, Number(json[dimension]) || 0.5));
    }
    return scores;
  } catch {
    // Try to find JSON in response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const json = JSON.parse(jsonMatch[0]);
        for (const dimension of EVALUATION_DIMENSIONS) {
          scores[dimension] = Math.min(1.0, Math.max(0, Number(json[dimension]) || 0.5));
        }
        return scores;
      } catch {
        // Fall back to defaults
      }
    }
  }

  // Default to neutral scores on parse failure
  for (const dimension of EVALUATION_DIMENSIONS) {
    scores[dimension] = 0.5;
  }
  return scores;
}

// ─── Utility Functions ──────────────────────────────────────────────────────

/**
 * Get verdict (verdict string) from composite score.
 */
function getVerdict(score) {
  if (score >= VERDICT_THRESHOLDS.excellent) return 'excellent';
  if (score >= VERDICT_THRESHOLDS.good) return 'good';
  if (score >= VERDICT_THRESHOLDS.acceptable) return 'acceptable';
  if (score >= VERDICT_THRESHOLDS.needs_revision) return 'needs_revision';
  return 'reject';
}

/**
 * Get evaluation configuration.
 */
export function getEvaluationConfig() {
  return {
    enabled: isUltraplanianEnabled(),
    mode: EVALUATION_MODE,
    dimensions: EVALUATION_DIMENSIONS,
    verdictThresholds: VERDICT_THRESHOLDS,
    verdicts: VERDICTS,
    defaultWeights: DEFAULT_WEIGHTS,
    sectionProfiles: Object.keys(SECTION_WEIGHT_PROFILES),
  };
}

/**
 * Get weights for a section.
 */
export function getWeightsForSection(sectionId) {
  return SECTION_WEIGHT_PROFILES[sectionId] || DEFAULT_WEIGHTS;
}

/**
 * Evaluate narrative (main entry point).
 * Automatically selects quick or deep evaluation based on configuration.
 *
 * @param {string} text - Narrative text
 * @param {object} options
 *   @param {object} [options.facts] - Case facts
 *   @param {string} [options.sectionId] - Section identifier
 *   @param {Function} [options.aiCallFn] - AI call function for deep evaluation
 * @returns {Promise<object>} Evaluation results
 */
export async function evaluateNarrative(text, options = {}) {
  const { facts = {}, sectionId = 'default', aiCallFn = null } = options;

  if (!isUltraplanianEnabled()) {
    return {
      enabled: false,
      reason: 'ULTRAPLINIAN_ENABLED=false',
    };
  }

  if (EVALUATION_MODE === 'deep' && aiCallFn) {
    return deepEvaluate(text, facts, sectionId, aiCallFn);
  }

  if (EVALUATION_MODE === 'hybrid') {
    // For hybrid: Quick eval first, then deep if low score
    const quickResult = quickEvaluate(text, facts, sectionId);
    if (quickResult.compositeScore < 0.70 && aiCallFn) {
      const deepResult = await deepEvaluate(text, facts, sectionId, aiCallFn);
      return {
        ...deepResult,
        quickScoreBefore: quickResult.compositeScore,
      };
    }
    return quickResult;
  }

  // Default: quick
  return quickEvaluate(text, facts, sectionId);
}

export default {
  evaluateNarrative,
  quickEvaluate,
  deepEvaluate,
  getEvaluationConfig,
  getWeightsForSection,
  isUltraplanianEnabled,
  EVALUATION_DIMENSIONS,
  VERDICTS,
};
