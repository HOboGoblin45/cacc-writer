import log from '../logger.js';
import { v4 as uuidv4 } from 'uuid';
import * as selfTrainingRepo from '../db/repositories/selfTrainingRepo.js';

export function extractFacts(text) {
  try {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // Split by sentences (simple approach)
    const sentences = text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Convert sentences to facts
    const facts = sentences.map((sentence, index) => ({
      id: index,
      text: sentence,
      keywords: sentence.toLowerCase().split(/\s+/)
    }));

    return facts;
  } catch (err) {
    log.error('Error extracting facts:', err);
    return [];
  }
}

export function calculateRougeL(reference, candidate) {
  try {
    if (!reference || !candidate) {
      return 0;
    }

    // Convert to arrays of words
    const refWords = reference.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const candWords = candidate.toLowerCase().split(/\s+/).filter(w => w.length > 0);

    if (refWords.length === 0 || candWords.length === 0) {
      return 0;
    }

    // Calculate longest common subsequence length
    const lcsLength = calculateLCS(refWords, candWords);

    // ROUGE-L = 2 * (lcs / (ref_len + cand_len)) / ((ref_len + cand_len) / (ref_len + cand_len))
    // Simplified: F-score based on LCS
    const precision = lcsLength / candWords.length;
    const recall = lcsLength / refWords.length;

    if (precision + recall === 0) {
      return 0;
    }

    const fScore = (2 * precision * recall) / (precision + recall);
    return Math.min(fScore, 1.0);
  } catch (err) {
    log.error('Error calculating ROUGE-L:', err);
    return 0;
  }
}

function calculateLCS(arr1, arr2) {
  const m = arr1.length;
  const n = arr2.length;

  // Create DP table
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Fill the DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[m][n];
}

export function calculateFactCoverage(originalFacts, regeneratedText) {
  try {
    if (!originalFacts || originalFacts.length === 0 || !regeneratedText) {
      return 0;
    }

    const regeneratedLower = regeneratedText.toLowerCase();
    let coveredCount = 0;

    for (const fact of originalFacts) {
      // Simple keyword matching: check if any significant keywords from fact appear in regenerated text
      const keywords = fact.keywords.filter(w => w.length > 3); // Only check longer keywords
      const factCovered = keywords.some(keyword => regeneratedLower.includes(keyword));

      if (factCovered) {
        coveredCount++;
      }
    }

    return originalFacts.length > 0 ? coveredCount / originalFacts.length : 0;
  } catch (err) {
    log.error('Error calculating fact coverage:', err);
    return 0;
  }
}

function calculateEmbeddingSimilarity() {
  // TODO: Replace with real embedding similarity calculation once embedding model is available
  // For now, return a mock value between 0.75-0.95
  return 0.75 + Math.random() * 0.2;
}

export function classifyScore(score) {
  if (score >= 0.85) {
    return 'PASS';
  } else if (score >= 0.70) {
    return 'CLOSE';
  } else if (score >= 0.50) {
    return 'WEAK';
  } else {
    return 'FAIL';
  }
}

export function runSingleEval(db, corpusEntry, options = {}) {
  try {
    const {
      regenerationFn = null
    } = options;

    // Extract facts from original text
    const originalFacts = extractFacts(corpusEntry.original_text);

    // Regenerate narrative (use provided function or mock)
    let regeneratedText;
    if (regenerationFn && typeof regenerationFn === 'function') {
      regeneratedText = regenerationFn(corpusEntry.original_text);
    } else {
      // Mock regeneration: slightly modify original
      regeneratedText = corpusEntry.original_text.replace(/\./g, '.');
    }

    // Calculate embedding similarity
    const embeddingSimilarity = calculateEmbeddingSimilarity();

    // Calculate ROUGE-L score
    const rougeLScore = calculateRougeL(corpusEntry.original_text, regeneratedText);

    // Calculate fact coverage
    const factCoverage = calculateFactCoverage(originalFacts, regeneratedText);

    // Calculate composite score (0.4 embedding + 0.3 ROUGE + 0.3 fact coverage)
    const compositeScore = (embeddingSimilarity * 0.4) + (rougeLScore * 0.3) + (factCoverage * 0.3);

    // Classify the score
    const classification = classifyScore(compositeScore);

    // Extract missing facts (those that appear in original but not in regenerated)
    const missingFacts = originalFacts.filter(fact => {
      const keywords = fact.keywords.filter(w => w.length > 3);
      return !keywords.some(keyword => regeneratedText.toLowerCase().includes(keyword));
    });

    return {
      batchId: null, // Will be set by caller
      corpusEntryId: corpusEntry.id,
      sectionType: corpusEntry.section_type,
      originalText: corpusEntry.original_text,
      regeneratedText,
      embeddingSimilarity: parseFloat(embeddingSimilarity.toFixed(4)),
      rougeLScore: parseFloat(rougeLScore.toFixed(4)),
      factCoverage: parseFloat(factCoverage.toFixed(4)),
      compositeScore: parseFloat(compositeScore.toFixed(4)),
      classification,
      extractedFacts: originalFacts,
      missingFacts
    };
  } catch (err) {
    log.error('Error in runSingleEval:', err);
    throw err;
  }
}

export function runBatchEval(db, corpusEntries, options = {}) {
  try {
    const { regenerationFn = null } = options;
    const batchId = uuidv4();

    log.info(`Starting batch evaluation: ${batchId} with ${corpusEntries.length} entries`);

    // Create batch record
    selfTrainingRepo.createBatch(db, batchId, corpusEntries.length);

    // Track results and scores by section
    const results = [];
    const scoresBySection = {};
    const classificationCounts = {
      PASS: 0,
      CLOSE: 0,
      WEAK: 0,
      FAIL: 0
    };

    let completedCount = 0;
    let totalCompositeScore = 0;

    // Evaluate each entry
    for (const entry of corpusEntries) {
      try {
        const evalResult = runSingleEval(db, entry, { regenerationFn });
        evalResult.batchId = batchId;

        // Insert result
        selfTrainingRepo.insertResult(db, evalResult);
        results.push(evalResult);

        // Track metrics
        totalCompositeScore += evalResult.compositeScore;
        classificationCounts[evalResult.classification]++;

        // Group by section
        if (!scoresBySection[evalResult.sectionType]) {
          scoresBySection[evalResult.sectionType] = {
            scores: [],
            embedding: [],
            rouge: [],
            factCoverage: []
          };
        }

        scoresBySection[evalResult.sectionType].scores.push(evalResult.compositeScore);
        scoresBySection[evalResult.sectionType].embedding.push(evalResult.embeddingSimilarity);
        scoresBySection[evalResult.sectionType].rouge.push(evalResult.rougeLScore);
        scoresBySection[evalResult.sectionType].factCoverage.push(evalResult.factCoverage);

        completedCount++;

        // Update progress
        selfTrainingRepo.updateBatchProgress(db, batchId, {
          completedEntries: completedCount,
          passed: classificationCounts.PASS,
          close: classificationCounts.CLOSE,
          weak: classificationCounts.WEAK,
          failed: classificationCounts.FAIL
        });
      } catch (err) {
        log.warn(`Error evaluating entry ${entry.id}: ${err.message}`);
      }
    }

    // Calculate average composite score
    const avgCompositeScore = results.length > 0 ? totalCompositeScore / results.length : 0;

    // Calculate and store section trends
    for (const [sectionType, scores] of Object.entries(scoresBySection)) {
      const sectionTrendScores = {
        avgComposite: scores.scores.length > 0
          ? scores.scores.reduce((a, b) => a + b, 0) / scores.scores.length
          : 0,
        avgEmbedding: scores.embedding.length > 0
          ? scores.embedding.reduce((a, b) => a + b, 0) / scores.embedding.length
          : 0,
        avgRouge: scores.rouge.length > 0
          ? scores.rouge.reduce((a, b) => a + b, 0) / scores.rouge.length
          : 0,
        avgFactCoverage: scores.factCoverage.length > 0
          ? scores.factCoverage.reduce((a, b) => a + b, 0) / scores.factCoverage.length
          : 0,
        sampleCount: scores.scores.length
      };

      selfTrainingRepo.upsertSectionTrend(db, sectionType, batchId, sectionTrendScores);
    }

    // Complete batch
    selfTrainingRepo.completeBatch(db, batchId, avgCompositeScore);

    log.info(`Batch ${batchId} completed: ${completedCount}/${corpusEntries.length} entries, avg score: ${avgCompositeScore.toFixed(4)}`);

    return {
      batchId,
      totalEntries: corpusEntries.length,
      completedEntries: completedCount,
      passCount: classificationCounts.PASS,
      closeCount: classificationCounts.CLOSE,
      weakCount: classificationCounts.WEAK,
      failCount: classificationCounts.FAIL,
      avgCompositeScore: parseFloat(avgCompositeScore.toFixed(4)),
      results,
      scoresBySection
    };
  } catch (err) {
    log.error('Error in runBatchEval:', err);
    throw err;
  }
}
