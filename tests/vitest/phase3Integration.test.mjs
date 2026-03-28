/**
 * tests/vitest/phase3Integration.test.mjs
 * ──────────────────────────────────────────────────────────────────────────────
 * Phase 3 Narrative Intelligence Pipeline Integration Tests
 *
 * Tests the full integration of:
 *   1. STM (Section Text Munger) normalization pipeline
 *   2. AutoTune learning loop with EMA
 *   3. Voice consistency scoring with embeddings
 *   4. Composite scoring with voice/fact coverage penalties
 *   5. End-to-end pipeline simulation
 *
 * Test Groups:
 *   - STM → Scoring Pipeline
 *   - AutoTune Learning Loop
 *   - Voice Consistency Flow (mocked embeddings)
 *   - Composite Scoring Enhancement
 *   - End-to-End Pipeline Simulation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizeOutput } from '../../server/ai/stmNormalizer.js';
import {
  classifyContext,
  getOptimizedParams,
  recordOutcome,
  getEmaState,
  resetAllContexts,
} from '../../server/ai/autoTuneClassifier.js';
import {
  cosineSimilarity,
  averageEmbedding,
  clearReferenceCache,
} from '../../server/ai/voiceConsistencyScorer.js';
import voiceScorer from '../../server/ai/voiceConsistencyScorer.js';

const EMBEDDING_DIMENSION = voiceScorer.EMBEDDING_DIMENSION;
import { scoreSectionOutput } from '../../server/sectionFactory/sectionPolicyService.js';

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

const SECTION_POLICY = {
  qualityProfile: {
    minChars: 100,
    warningBudget: 1,
  },
};

// Helper to generate deterministic embeddings for testing
function createDeterministicEmbedding(text) {
  const hash = text
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const seed = hash % 1000;
  const embedding = [];
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    const value = Math.sin((seed + i) * 0.01) * 0.5 + 0.5;
    embedding.push(value);
  }
  return embedding;
}

// ─── GROUP 1: STM → Scoring Pipeline ────────────────────────────────────────

describe('STM → Scoring Pipeline', () => {
  beforeEach(() => {
    resetAllContexts();
  });

  afterEach(() => {
    resetAllContexts();
  });

  it('cleans raw AI output and produces metrics', async () => {
    const rawText = 'Sure, here is the neighborhood description: The property is located in a vibrant area with good schools.';

    const result = await normalizeOutput(rawText, {
      sectionId: 'neighborhood_description',
      formType: '1004',
    });

    expect(result.text).toBeTruthy();
    expect(result.metrics).toBeTruthy();
    expect(result.metrics.originalLength).toBe(rawText.length);
    expect(result.metrics.cleanedLength).toBeLessThan(result.metrics.originalLength);
    expect(result.metrics.preambleStripped).toBe(true);
    expect(result.metrics.regexChanges).toBeGreaterThanOrEqual(1);
  });

  it('cleaned text scores higher than raw text through scoreSectionOutput', async () => {
    const rawText = 'Sure, here is the neighborhood description: The property is located in a nice area with good schools and parks. This is a desirable location.';

    const cleaned = await normalizeOutput(rawText, {
      sectionId: 'neighborhood_description',
      formType: '1004',
    });

    // Score raw text
    const rawScore = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text: rawText,
      warningsCount: 0,
    });

    // Score cleaned text
    const cleanedScore = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text: cleaned.text,
      warningsCount: 0,
    });

    // Cleaned should score higher (less artificial preamble, cleaner voice)
    expect(cleanedScore.score).toBeGreaterThanOrEqual(rawScore.score);
  });

  it('STM metrics are populated after processing', async () => {
    const rawText = 'Here is the text: **This is bold** and `this is code`. The subject property is well-maintained.';

    const result = await normalizeOutput(rawText, {
      sectionId: 'condition_description',
      formType: '1004',
    });

    expect(result.metrics.originalLength).toBeGreaterThan(0);
    expect(result.metrics.cleanedLength).toBeGreaterThan(0);
    expect(result.metrics.cleanedLength).toBeLessThanOrEqual(result.metrics.originalLength);
    expect(typeof result.metrics.regexChanges).toBe('number');
    expect(typeof result.metrics.preambleStripped).toBe('boolean');
    expect(typeof result.metrics.postambleStripped).toBe('boolean');
    expect(typeof result.metrics.llmPassUsed).toBe('boolean');
    expect(typeof result.metrics.truncated).toBe('boolean');
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('preamble-heavy text produces cleaner second normalized version', async () => {
    const rawText = 'Certainly! Here is the neighborhood description: The home is in a great area with good schools.';

    const pass1 = await normalizeOutput(rawText, {
      sectionId: 'neighborhood_description',
      formType: '1004',
    });

    expect(pass1.metrics.preambleStripped).toBe(true);
    expect(pass1.text).not.toContain('Certainly');

    // Preamble should have been stripped (detected)
    expect(pass1.metrics.regexChanges).toBeGreaterThanOrEqual(1);
  });

  it('text with character limit is truncated at sentence boundary', async () => {
    const rawText = 'The property is located in a good neighborhood. There are many parks nearby. The schools are highly rated. The area is safe and well-maintained.';

    const result = await normalizeOutput(rawText, {
      sectionId: 'neighborhood_description',
      formType: '1004',
      maxChars: 80,
    });

    expect(result.text.length).toBeLessThanOrEqual(80);
    expect(result.metrics.truncated).toBe(true);
    // Should end at sentence boundary, not mid-word
    expect(result.text).toMatch(/[.!?]\s*$/);
  });
});

// ─── GROUP 2: AutoTune Learning Loop ────────────────────────────────────────

describe('AutoTune Learning Loop', () => {
  beforeEach(() => {
    resetAllContexts();
  });

  afterEach(() => {
    resetAllContexts();
  });

  it('context classification generates consistent key', () => {
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

  it('records outcome and updates EMA state', () => {
    const contextKey = classifyContext({
      sectionId: 'condition_description',
      formType: '1004',
      facts: SIMPLE_FACTS,
    });

    const outcome = recordOutcome(contextKey, {
      qualityScore: 85,
      tokensUsed: 650,
      sectionId: 'condition_description',
    });

    expect(outcome.recorded).toBe(true);
    expect(outcome.emaState).toBeTruthy();

    const emaState = getEmaState(contextKey);
    expect(emaState).toBeTruthy();
    expect(emaState.avgScore).toBe(85); // First value, no EMA yet
    expect(emaState.scoreCount).toBe(1);
  });

  it('multiple good outcomes increase temperature', () => {
    const contextKey = classifyContext({
      sectionId: 'analysis',
      formType: '1004',
      facts: SIMPLE_FACTS,
    });

    // Record 3 high-quality outcomes
    recordOutcome(contextKey, { qualityScore: 88, tokensUsed: 700 });
    recordOutcome(contextKey, { qualityScore: 86, tokensUsed: 720 });
    recordOutcome(contextKey, { qualityScore: 89, tokensUsed: 680 });

    const emaState = getEmaState(contextKey);
    expect(emaState.avgScore).toBeGreaterThan(80);
    // Temperature should shift up from neutral
    expect(emaState.optimalTemperature).toBeGreaterThan(0.5);
  });

  it('poor outcomes decrease temperature toward conservative', () => {
    const contextKey = classifyContext({
      sectionId: 'analysis',
      formType: '1004',
      facts: SIMPLE_FACTS,
    });

    // Record 3 low-quality outcomes
    recordOutcome(contextKey, { qualityScore: 25, tokensUsed: 300 });
    recordOutcome(contextKey, { qualityScore: 30, tokensUsed: 320 });
    recordOutcome(contextKey, { qualityScore: 28, tokensUsed: 310 });

    const emaState = getEmaState(contextKey);
    expect(emaState.avgScore).toBeLessThan(40);
    // Temperature should shift down toward conservative
    expect(emaState.optimalTemperature).toBeLessThan(0.5);
  });

  it('EMA smoothing averages scores correctly', () => {
    const contextKey = classifyContext({
      sectionId: 'test',
      formType: '1004',
      facts: SIMPLE_FACTS,
    });

    // Record outcomes with alternating scores
    recordOutcome(contextKey, { qualityScore: 80, tokensUsed: 600 });
    recordOutcome(contextKey, { qualityScore: 60, tokensUsed: 600 });
    recordOutcome(contextKey, { qualityScore: 80, tokensUsed: 600 });

    const emaState = getEmaState(contextKey);
    // With EMA alpha=0.3, avg should be somewhere between 60 and 80
    expect(emaState.avgScore).toBeGreaterThan(60);
    expect(emaState.avgScore).toBeLessThan(80);
  });

  it('reset context clears learning history', () => {
    const contextKey = classifyContext({
      sectionId: 'test',
      formType: '1004',
      facts: SIMPLE_FACTS,
    });

    recordOutcome(contextKey, { qualityScore: 85, tokensUsed: 700 });
    expect(getEmaState(contextKey)).toBeTruthy();

    resetAllContexts();
    expect(getEmaState(contextKey)).toBeNull();
  });

  it('disabled AUTOTUNE_ENABLED flag returns unchanged base profile', () => {
    const prevValue = process.env.AUTOTUNE_ENABLED;
    process.env.AUTOTUNE_ENABLED = 'false';

    const contextKey = classifyContext({
      sectionId: 'test',
      formType: '1004',
      facts: SIMPLE_FACTS,
    });

    // Record outcome with good score
    recordOutcome(contextKey, { qualityScore: 90, tokensUsed: 700 });

    // Get params — should return base profile unchanged since disabled
    const params = getOptimizedParams('test', '1004', SIMPLE_FACTS, BASE_PROFILE);

    expect(params.temperature).toBe(BASE_PROFILE.temperature);
    expect(params.maxTokens).toBe(BASE_PROFILE.maxTokens);

    // Restore
    if (prevValue === undefined) {
      delete process.env.AUTOTUNE_ENABLED;
    } else {
      process.env.AUTOTUNE_ENABLED = prevValue;
    }
  });
});

// ─── GROUP 3: Voice Consistency Flow ────────────────────────────────────────

describe('Voice Consistency Flow', () => {
  beforeEach(() => {
    clearReferenceCache();
  });

  afterEach(() => {
    clearReferenceCache();
  });

  it('cosineSimilarity function handles vector inputs correctly', () => {
    const vec = [1, 2, 3];
    const similarity = cosineSimilarity(vec, vec);
    // Same vector should give perfect similarity (or close to 1)
    expect(similarity).toBeGreaterThan(0.99);
  });

  it('cosineSimilarity returns 0 for mismatched lengths', () => {
    const vec1 = [1, 2, 3];
    const vec2 = [1, 2, 3, 4];

    const similarity = cosineSimilarity(vec1, vec2);
    expect(similarity).toBe(0);
  });

  it('different vectors produce lower similarity scores', () => {
    // Create two reasonably different vectors
    const vec1 = [1, 0, 0, 0, 0];
    const vec2 = [0, 1, 0, 0, 0];

    const similarity = cosineSimilarity(vec1, vec2);
    expect(similarity).toBe(0); // Orthogonal vectors have 0 similarity
  });

  it('averageEmbedding computes centroid correctly', () => {
    // Create two different embeddings of size EMBEDDING_DIMENSION
    const emb1 = new Array(EMBEDDING_DIMENSION).fill(1.0);
    const emb2 = new Array(EMBEDDING_DIMENSION).fill(2.0);

    const avgEmbed = averageEmbedding([emb1, emb2]);

    expect(Array.isArray(avgEmbed)).toBe(true);
    expect(avgEmbed.length === EMBEDDING_DIMENSION).toBe(true);

    // Average of 1.0 and 2.0 is 1.5
    expect(avgEmbed[0]).toBeCloseTo(1.5, 5);
    expect(avgEmbed[EMBEDDING_DIMENSION - 1]).toBeCloseTo(1.5, 5);
  });

  it('empty embedding array returns zero-filled vector', () => {
    const avgEmbed = averageEmbedding([]);

    expect(Array.isArray(avgEmbed)).toBe(true);
    expect(avgEmbed.length === EMBEDDING_DIMENSION).toBe(true);
    // All values should be 0
    const allZeros = avgEmbed.every(v => v === 0);
    expect(allZeros).toBe(true);
  });

  it('zero vectors return zero similarity', () => {
    const zeroVec = new Array(EMBEDDING_DIMENSION).fill(0);
    const someVec = createDeterministicEmbedding('text');

    const similarity = cosineSimilarity(zeroVec, someVec);
    expect(similarity).toBe(0);
  });
});

// ─── GROUP 4: Composite Scoring Enhancement ─────────────────────────────────

describe('Composite Scoring Enhancement', () => {
  beforeEach(() => {
    resetAllContexts();
  });

  afterEach(() => {
    resetAllContexts();
  });

  it('voiceScore < 0.70 incurs voice_drift penalty', () => {
    const text = 'The subject property is in good condition. It has well-maintained systems and finishes.';

    const scoreWithoutVoice = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text,
      warningsCount: 0,
    });

    const scoreWithLowVoice = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text,
      warningsCount: 0,
      voiceScore: 0.65, // Below 0.70 threshold
    });

    // Score with voice drift should be lower
    expect(scoreWithLowVoice.score).toBeLessThan(scoreWithoutVoice.score);

    // Penalty should be 0.15
    const penalties = scoreWithLowVoice.metadata.penalties;
    const voicePenalty = penalties.find(p => p.code === 'voice_drift');
    expect(voicePenalty).toBeTruthy();
    expect(voicePenalty.amount).toBe(0.15);
  });

  it('voiceScore >= 0.85 has no voice penalty', () => {
    const text = 'The subject property is in good condition. It has well-maintained systems and finishes.';

    const scoreWithHighVoice = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text,
      warningsCount: 0,
      voiceScore: 0.92, // Above 0.85 threshold
    });

    // No voice penalty should be applied
    const voicePenalties = scoreWithHighVoice.metadata.penalties.filter(
      p => p.code === 'voice_drift' || p.code === 'voice_weak'
    );
    expect(voicePenalties.length).toBe(0);
  });

  it('voiceScore in 0.70-0.85 range incurs weak voice penalty', () => {
    const text = 'The subject property is in good condition. It has well-maintained systems and finishes.';

    const scoreWithWeakVoice = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text,
      warningsCount: 0,
      voiceScore: 0.75, // Between 0.70 and 0.85
    });

    // Weak voice penalty should be applied (0.05)
    const weakVoicePenalty = scoreWithWeakVoice.metadata.penalties.find(p => p.code === 'voice_weak');
    expect(weakVoicePenalty).toBeTruthy();
    expect(weakVoicePenalty.amount).toBe(0.05);
  });

  it('factCoverage < 0.3 incurs low_fact_coverage penalty of 0.20', () => {
    const text = 'The subject property is in good condition. It has well-maintained systems and finishes.';

    const scoreWithLowCoverage = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text,
      warningsCount: 0,
      factCoverage: 0.25, // Below 0.3 threshold
    });

    const coveragePenalty = scoreWithLowCoverage.metadata.penalties.find(p => p.code === 'low_fact_coverage');
    expect(coveragePenalty).toBeTruthy();
    expect(coveragePenalty.amount).toBe(0.20);
  });

  it('factCoverage in 0.3-0.5 range incurs 0.10 penalty', () => {
    const text = 'The subject property is in good condition. It has well-maintained systems and finishes.';

    const scoreWithModCoverage = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text,
      warningsCount: 0,
      factCoverage: 0.40, // Between 0.3 and 0.5
    });

    const coveragePenalty = scoreWithModCoverage.metadata.penalties.find(p => p.code === 'low_fact_coverage');
    expect(coveragePenalty).toBeTruthy();
    expect(coveragePenalty.amount).toBe(0.10);
  });

  it('factCoverage >= 0.5 has no fact coverage penalty', () => {
    const text = 'The subject property is in good condition. It has well-maintained systems and finishes.';

    const scoreWithGoodCoverage = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text,
      warningsCount: 0,
      factCoverage: 0.65, // Above 0.5 threshold
    });

    const coveragePenalties = scoreWithGoodCoverage.metadata.penalties.filter(p => p.code === 'low_fact_coverage');
    expect(coveragePenalties.length).toBe(0);
  });

  it('without voiceScore/factCoverage remains backwards compatible', () => {
    const text = 'The subject property is in good condition. It has well-maintained systems and finishes.';

    const scoreWithoutNewParams = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text,
      warningsCount: 0,
    });

    // Should score normally without voice/fact penalties
    expect(scoreWithoutNewParams.score).toBeGreaterThan(0);
    expect(scoreWithoutNewParams.score).toBeLessThanOrEqual(1);

    const newPenalties = scoreWithoutNewParams.metadata.penalties.filter(
      p => p.code === 'voice_drift' || p.code === 'voice_weak' || p.code === 'low_fact_coverage'
    );
    expect(newPenalties.length).toBe(0);
  });

  it('voiceScore and factCoverage can be applied together', () => {
    const text = 'The subject property is in good condition. It has well-maintained systems and finishes.';

    const scoreWithBoth = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text,
      warningsCount: 0,
      voiceScore: 0.65, // Low voice
      factCoverage: 0.25, // Low coverage
    });

    // Should have both penalties
    const voicePenalty = scoreWithBoth.metadata.penalties.find(p => p.code === 'voice_drift');
    const coveragePenalty = scoreWithBoth.metadata.penalties.find(p => p.code === 'low_fact_coverage');

    expect(voicePenalty).toBeTruthy();
    expect(voicePenalty.amount).toBe(0.15);
    expect(coveragePenalty).toBeTruthy();
    expect(coveragePenalty.amount).toBe(0.20);

    // Combined penalty should be 0.35
    expect(scoreWithBoth.score).toBeLessThanOrEqual(1 - 0.35);
  });
});

// ─── GROUP 5: End-to-End Pipeline Simulation ────────────────────────────────

describe('End-to-End Pipeline Simulation', () => {
  beforeEach(() => {
    resetAllContexts();
    clearReferenceCache();
  });

  afterEach(() => {
    resetAllContexts();
    clearReferenceCache();
  });

  it('raw AI output → STM normalize → score → AutoTune learns', async () => {
    // Step 1: Raw AI output with preamble
    const rawOutput = 'Sure, here is the condition narrative: The subject property is in very good condition with well-maintained systems and finishes throughout.';

    // Step 2: Normalize through STM
    const normalized = await normalizeOutput(rawOutput, {
      sectionId: 'condition_description',
      formType: '1004',
    });

    expect(normalized.text).toBeTruthy();
    expect(normalized.metrics.preambleStripped).toBe(true);

    // Step 3: Score the normalized output
    const scoreResult = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text: normalized.text,
      warningsCount: 0,
      voiceScore: 0.88,
      factCoverage: 0.75,
    });

    expect(scoreResult.score).toBeGreaterThan(0.7); // Good quality

    // Step 4: Record outcome in AutoTune
    const contextKey = classifyContext({
      sectionId: 'condition_description',
      formType: '1004',
      facts: SIMPLE_FACTS,
    });

    const outcome = recordOutcome(contextKey, {
      qualityScore: Math.round(scoreResult.score * 100),
      tokensUsed: 120,
      sectionId: 'condition_description',
    });

    expect(outcome.recorded).toBe(true);

    // Step 5: Verify EMA state is populated
    const emaState = getEmaState(contextKey);
    expect(emaState).toBeTruthy();
    expect(emaState.avgScore).toBeGreaterThan(0);
    expect(emaState.scoreCount).toBe(1);
  });

  it('multiple iterations show AutoTune learning', async () => {
    const contextKey = classifyContext({
      sectionId: 'location_analysis',
      formType: '1004',
      facts: SIMPLE_FACTS,
    });

    // Simulate 3 iterations of generation
    const iterations = [
      { rawOutput: 'The home is in a great area.', qualityScore: 75, tokens: 100 },
      { rawOutput: 'The subject property is in a desirable neighborhood with good schools.', qualityScore: 88, tokens: 140 },
      { rawOutput: 'The subject property is located in a highly desirable area with excellent schools and amenities.', qualityScore: 92, tokens: 160 },
    ];

    for (const iter of iterations) {
      // Normalize
      const normalized = await normalizeOutput(iter.rawOutput, {
        sectionId: 'location_analysis',
        formType: '1004',
      });

      // Record outcome
      recordOutcome(contextKey, {
        qualityScore: iter.qualityScore,
        tokensUsed: iter.tokens,
        sectionId: 'location_analysis',
      });
    }

    // Check final EMA state shows learning
    const finalEma = getEmaState(contextKey);
    expect(finalEma).toBeTruthy();
    expect(finalEma.scoreCount).toBe(3);

    // Average score should reflect the mix (75, 88, 92)
    expect(finalEma.avgScore).toBeGreaterThan(80);
    expect(finalEma.avgScore).toBeLessThan(92);
  });

  it('all metrics and audit data are populated in full pipeline', async () => {
    const rawOutput = 'Certainly! The subject property is in excellent condition with modern improvements.';

    // Step 1: STM normalization
    const normalized = await normalizeOutput(rawOutput, {
      sectionId: 'condition',
      formType: '1004',
    });

    // Step 2: Scoring with all parameters
    const scoreResult = scoreSectionOutput({
      sectionPolicy: SECTION_POLICY,
      text: normalized.text,
      warningsCount: 1,
      voiceScore: 0.82,
      factCoverage: 0.60,
      analysisContextUsed: true,
      priorSectionsContextUsed: true,
      retrievalSourceIds: ['source1', 'source2'],
    });

    // Step 3: Verify audit metadata
    expect(scoreResult.metadata).toBeTruthy();
    expect(scoreResult.metadata.charCount).toBe(normalized.text.length);
    expect(scoreResult.metadata.warningsCount).toBe(1);
    expect(scoreResult.metadata.retrievalSourceCount).toBe(2);
    expect(scoreResult.metadata.voiceScore).toBe(0.82);
    expect(scoreResult.metadata.factCoverage).toBe(0.60);
    expect(scoreResult.metadata.analysisContextUsed).toBe(true);
    expect(scoreResult.metadata.priorSectionsContextUsed).toBe(true);
    expect(scoreResult.metadata.penalties).toBeInstanceOf(Array);

    // Step 4: Verify STM metrics are available
    expect(normalized.metrics.originalLength).toBeGreaterThan(0);
    expect(normalized.metrics.cleanedLength).toBeGreaterThan(0);
    expect(normalized.metrics.durationMs).toBeGreaterThanOrEqual(0);
  });
});
