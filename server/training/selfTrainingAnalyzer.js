import log from '../logger.js';
import * as selfTrainingRepo from '../db/repositories/selfTrainingRepo.js';

export function analyzeGaps(db, batchId) {
  try {
    log.info(`Analyzing gaps for batch: ${batchId}`);

    // Get batch info
    const batch = selfTrainingRepo.getBatch(db, batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    // Get all results for the batch
    const results = selfTrainingRepo.getResultsByBatch(db, batchId, { limit: 10000 });

    // Group by section type
    const gapsBySection = {};

    for (const result of results) {
      if (!gapsBySection[result.section_type]) {
        gapsBySection[result.section_type] = {
          sectionType: result.section_type,
          totalResults: 0,
          passResults: 0,
          closeResults: 0,
          weakResults: 0,
          failResults: 0,
          avgCompositeScore: 0,
          avgEmbedding: 0,
          avgRouge: 0,
          avgFactCoverage: 0,
          weakAreas: [],
          failingExamples: []
        };
      }

      const section = gapsBySection[result.section_type];
      section.totalResults++;

      // Count by classification
      if (result.classification === 'PASS') section.passResults++;
      else if (result.classification === 'CLOSE') section.closeResults++;
      else if (result.classification === 'WEAK') section.weakResults++;
      else if (result.classification === 'FAIL') section.failResults++;

      // Accumulate scores for averaging
      section.avgCompositeScore += result.composite_score || 0;
      section.avgEmbedding += result.embedding_similarity || 0;
      section.avgRouge += result.rouge_l_score || 0;
      section.avgFactCoverage += result.fact_coverage || 0;

      // Track weak/fail areas
      if (result.classification === 'WEAK' || result.classification === 'FAIL') {
        const missingFacts = result.missing_facts ? JSON.parse(result.missing_facts) : [];
        section.weakAreas.push({
          corpusEntryId: result.corpus_entry_id,
          classification: result.classification,
          score: result.composite_score,
          missingFactsCount: missingFacts.length
        });
      }

      // Track failing examples for detailed analysis
      if (result.classification === 'FAIL') {
        section.failingExamples.push({
          corpusEntryId: result.corpus_entry_id,
          score: result.composite_score,
          embeddingSimilarity: result.embedding_similarity,
          rougeL: result.rouge_l_score,
          factCoverage: result.fact_coverage
        });
      }
    }

    // Calculate averages
    for (const section of Object.values(gapsBySection)) {
      if (section.totalResults > 0) {
        section.avgCompositeScore = parseFloat((section.avgCompositeScore / section.totalResults).toFixed(4));
        section.avgEmbedding = parseFloat((section.avgEmbedding / section.totalResults).toFixed(4));
        section.avgRouge = parseFloat((section.avgRouge / section.totalResults).toFixed(4));
        section.avgFactCoverage = parseFloat((section.avgFactCoverage / section.totalResults).toFixed(4));
      }

      // Keep only top 5 weak areas
      section.weakAreas = section.weakAreas.sort((a, b) => a.score - b.score).slice(0, 5);
      section.failingExamples = section.failingExamples.slice(0, 3);
    }

    const analysis = {
      batchId,
      analysisDate: new Date().toISOString(),
      overallPassRate: batch.passed / batch.completed_entries,
      overallAvgScore: batch.avg_composite_score,
      gapsBySection
    };

    log.info(`Gap analysis complete for batch ${batchId}: ${Object.keys(gapsBySection).length} sections analyzed`);
    return analysis;
  } catch (err) {
    log.error(`Error analyzing gaps for batch ${batchId}:`, err);
    throw err;
  }
}

export function generateImprovementPlan(db, batchId) {
  try {
    log.info(`Generating improvement plan for batch: ${batchId}`);

    // Run gap analysis first
    const gapAnalysis = analyzeGaps(db, batchId);

    const improvements = [];

    for (const [sectionType, gaps] of Object.entries(gapAnalysis.gapsBySection)) {
      // Identify sections below 0.70 threshold
      if (gaps.avgCompositeScore < 0.70) {
        const improvement = {
          sectionType,
          priority: gaps.avgCompositeScore < 0.50 ? 'CRITICAL' : 'HIGH',
          currentScore: gaps.avgCompositeScore,
          targetScore: 0.85,
          scoreGap: 0.85 - gaps.avgCompositeScore,
          recommendations: []
        };

        // Generate recommendations based on weak metrics
        if (gaps.avgEmbedding < 0.70) {
          improvement.recommendations.push({
            area: 'embedding_similarity',
            suggestion: 'Improve semantic understanding - ensure regenerated text captures nuanced meanings from original',
            currentScore: gaps.avgEmbedding
          });
        }

        if (gaps.avgRouge < 0.70) {
          improvement.recommendations.push({
            area: 'rouge_l_score',
            suggestion: 'Enhance text preservation - maintain more specific language patterns and word choices from originals',
            currentScore: gaps.avgRouge
          });
        }

        if (gaps.avgFactCoverage < 0.70) {
          improvement.recommendations.push({
            area: 'fact_coverage',
            suggestion: 'Preserve critical facts - extract and include all key data points and findings from original narratives',
            currentScore: gaps.avgFactCoverage
          });
        }

        // Add examples of missing facts from weak areas
        if (gaps.weakAreas.length > 0) {
          const exampleGaps = gaps.weakAreas.slice(0, 2);
          improvement.examples = exampleGaps.map(ex => ({
            corpusEntryId: ex.corpusEntryId,
            missingFactsCount: ex.missingFactsCount,
            targetImprovement: 'Address these missing facts in regeneration'
          }));
        }

        improvements.push(improvement);
      }
    }

    // Sort by priority and score gap
    improvements.sort((a, b) => {
      const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return b.scoreGap - a.scoreGap;
    });

    const plan = {
      batchId,
      generatedAt: new Date().toISOString(),
      totalSectionsNeedingImprovement: improvements.length,
      improvements,
      nextSteps: [
        'Review CRITICAL and HIGH priority sections first',
        'Implement recommended changes to embedding/ROUGE/fact coverage calculation',
        'Run follow-up batch evaluation to measure improvement',
        'Compare results with previous batch using compareBatches'
      ]
    };

    log.info(`Improvement plan generated: ${improvements.length} sections need improvement`);
    return plan;
  } catch (err) {
    log.error(`Error generating improvement plan for batch ${batchId}:`, err);
    throw err;
  }
}

export function compareBatches(db, batchId1, batchId2) {
  try {
    log.info(`Comparing batches: ${batchId1} vs ${batchId2}`);

    const batch1 = selfTrainingRepo.getBatch(db, batchId1);
    const batch2 = selfTrainingRepo.getBatch(db, batchId2);

    if (!batch1 || !batch2) {
      throw new Error('One or both batches not found');
    }

    // Get section trends for both batches
    const sections1 = db.prepare(`
      SELECT * FROM self_training_section_trends
      WHERE batch_id = ?
    `).all(batchId1);

    const sections2 = db.prepare(`
      SELECT * FROM self_training_section_trends
      WHERE batch_id = ?
    `).all(batchId2);

    const sectionMap1 = Object.fromEntries(sections1.map(s => [s.section_type, s]));
    const sectionMap2 = Object.fromEntries(sections2.map(s => [s.section_type, s]));

    // Compare metrics
    const sectionComparisons = [];
    const allSections = new Set([...sections1.map(s => s.section_type), ...sections2.map(s => s.section_type)]);

    for (const sectionType of allSections) {
      const s1 = sectionMap1[sectionType];
      const s2 = sectionMap2[sectionType];

      const comparison = {
        sectionType,
        batch1Metrics: s1 ? {
          avgComposite: s1.avg_composite,
          avgEmbedding: s1.avg_embedding,
          avgRouge: s1.avg_rouge,
          avgFactCoverage: s1.avg_fact_coverage,
          sampleCount: s1.sample_count
        } : null,
        batch2Metrics: s2 ? {
          avgComposite: s2.avg_composite,
          avgEmbedding: s2.avg_embedding,
          avgRouge: s2.avg_rouge,
          avgFactCoverage: s2.avg_fact_coverage,
          sampleCount: s2.sample_count
        } : null,
        deltas: {}
      };

      if (s1 && s2) {
        comparison.deltas = {
          compositeScoreDelta: parseFloat((s2.avg_composite - s1.avg_composite).toFixed(4)),
          embeddingDelta: parseFloat((s2.avg_embedding - s1.avg_embedding).toFixed(4)),
          rougeDelta: parseFloat((s2.avg_rouge - s1.avg_rouge).toFixed(4)),
          factCoverageDelta: parseFloat((s2.avg_fact_coverage - s1.avg_fact_coverage).toFixed(4)),
          trend: s2.avg_composite > s1.avg_composite ? 'IMPROVED' : s2.avg_composite < s1.avg_composite ? 'DEGRADED' : 'STABLE'
        };
      }

      sectionComparisons.push(comparison);
    }

    // Sort by trend
    sectionComparisons.sort((a, b) => {
      const trendOrder = { IMPROVED: -1, STABLE: 0, DEGRADED: 1 };
      return (trendOrder[a.deltas.trend] || 0) - (trendOrder[b.deltas.trend] || 0);
    });

    const comparison = {
      batch1: {
        batchId: batch1.batch_id,
        createdAt: batch1.created_at,
        avgCompositeScore: batch1.avg_composite_score,
        passRate: batch1.passed / batch1.completed_entries
      },
      batch2: {
        batchId: batch2.batch_id,
        createdAt: batch2.created_at,
        avgCompositeScore: batch2.avg_composite_score,
        passRate: batch2.passed / batch2.completed_entries
      },
      overallDelta: {
        scoreDelta: parseFloat((batch2.avg_composite_score - batch1.avg_composite_score).toFixed(4)),
        passRateDelta: parseFloat(((batch2.passed / batch2.completed_entries) - (batch1.passed / batch1.completed_entries)).toFixed(4))
      },
      sectionComparisons
    };

    log.info(`Batch comparison complete: overall score delta = ${comparison.overallDelta.scoreDelta}`);
    return comparison;
  } catch (err) {
    log.error(`Error comparing batches ${batchId1} and ${batchId2}:`, err);
    throw err;
  }
}

export function applyLearnings(db, batchId) {
  try {
    log.info(`Applying learnings from batch: ${batchId}`);

    const batch = selfTrainingRepo.getBatch(db, batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    // Generate improvement plan
    const plan = generateImprovementPlan(db, batchId);

    // In V1, this is a stub that logs what would be applied
    const application = {
      batchId,
      appliedAt: new Date().toISOString(),
      message: 'Learning application is stubbed for V1',
      improvements: plan.improvements.length,
      status: 'NOT_IMPLEMENTED',
      nextSteps: [
        'Integrate improvements into model fine-tuning pipeline',
        'Adjust embedding model weights based on poor similarity scores',
        'Update fact extraction prompt templates',
        'Retrain with augmented corpus focusing on weak sections'
      ]
    };

    log.info(`Learnings from batch ${batchId} would be applied: ${plan.improvements.length} improvements identified`);
    return application;
  } catch (err) {
    log.error(`Error applying learnings from batch ${batchId}:`, err);
    throw err;
  }
}
