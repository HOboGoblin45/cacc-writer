import express from 'express';
import log from '../logger.js';
import * as selfTrainingPipeline from '../training/selfTrainingPipeline.js';
import * as selfTrainingAnalyzer from '../training/selfTrainingAnalyzer.js';
import * as selfTrainingRepo from '../db/repositories/selfTrainingRepo.js';

const router = express.Router();

/**
 * POST /api/self-training/batch
 * Start new batch evaluation
 * Body: { corpusEntries: Array, regenerationFn?: Function, options?: Object }
 */
router.post('/batch', (req, res) => {
  try {
    const { corpusEntries = [], options = {} } = req.body;

    if (!corpusEntries || !Array.isArray(corpusEntries) || corpusEntries.length === 0) {
      return res.status(400).json({
        error: 'Invalid request: corpusEntries must be a non-empty array'
      });
    }

    log.info(`Starting self-training batch with ${corpusEntries.length} entries`);

    const result = selfTrainingPipeline.runBatchEval(req.db, corpusEntries, options);

    res.json({
      success: true,
      batchId: result.batchId,
      totalEntries: result.totalEntries,
      completedEntries: result.completedEntries,
      passCount: result.passCount,
      closeCount: result.closeCount,
      weakCount: result.weakCount,
      failCount: result.failCount,
      avgCompositeScore: result.avgCompositeScore
    });
  } catch (err) {
    log.error('Error starting self-training batch:', err);
    res.status(500).json({
      error: 'Failed to start self-training batch',
      message: err.message
    });
  }
});

/**
 * GET /api/self-training/batch/:batchId
 * Get batch status
 */
router.get('/batch/:batchId', (req, res) => {
  try {
    const { batchId } = req.params;

    const batch = selfTrainingRepo.getBatch(req.db, batchId);

    if (!batch) {
      return res.status(404).json({
        error: 'Batch not found',
        batchId
      });
    }

    res.json({
      success: true,
      batch
    });
  } catch (err) {
    log.error(`Error getting batch ${req.params.batchId}:`, err);
    res.status(500).json({
      error: 'Failed to get batch',
      message: err.message
    });
  }
});

/**
 * GET /api/self-training/batch/:batchId/results
 * Get batch results with pagination and filtering
 * Query: limit=50, offset=0, classification=PASS|CLOSE|WEAK|FAIL
 */
router.get('/batch/:batchId/results', (req, res) => {
  try {
    const { batchId } = req.params;
    const { limit = 50, offset = 0, classification } = req.query;

    const batch = selfTrainingRepo.getBatch(req.db, batchId);
    if (!batch) {
      return res.status(404).json({
        error: 'Batch not found',
        batchId
      });
    }

    let results;
    if (classification) {
      results = selfTrainingRepo.getResultsByClassification(req.db, batchId, classification);
    } else {
      results = selfTrainingRepo.getResultsByBatch(req.db, batchId, {
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    }

    // Parse JSON fields
    const parsedResults = results.map(r => ({
      ...r,
      extracted_facts: r.extracted_facts ? JSON.parse(r.extracted_facts) : [],
      missing_facts: r.missing_facts ? JSON.parse(r.missing_facts) : []
    }));

    res.json({
      success: true,
      batchId,
      resultCount: parsedResults.length,
      results: parsedResults
    });
  } catch (err) {
    log.error(`Error getting results for batch ${req.params.batchId}:`, err);
    res.status(500).json({
      error: 'Failed to get batch results',
      message: err.message
    });
  }
});

/**
 * GET /api/self-training/batches
 * List all batches with pagination
 * Query: limit=50, offset=0
 */
router.get('/batches', (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const batches = selfTrainingRepo.listBatches(req.db, {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      batchCount: batches.length,
      batches
    });
  } catch (err) {
    log.error('Error listing batches:', err);
    res.status(500).json({
      error: 'Failed to list batches',
      message: err.message
    });
  }
});

/**
 * GET /api/self-training/batch/:batchId/analysis
 * Run gap analysis on batch
 */
router.get('/batch/:batchId/analysis', (req, res) => {
  try {
    const { batchId } = req.params;

    const batch = selfTrainingRepo.getBatch(req.db, batchId);
    if (!batch) {
      return res.status(404).json({
        error: 'Batch not found',
        batchId
      });
    }

    const analysis = selfTrainingAnalyzer.analyzeGaps(req.db, batchId);

    res.json({
      success: true,
      analysis
    });
  } catch (err) {
    log.error(`Error analyzing batch ${req.params.batchId}:`, err);
    res.status(500).json({
      error: 'Failed to analyze batch',
      message: err.message
    });
  }
});

/**
 * GET /api/self-training/batch/:batchId/plan
 * Get improvement plan for batch
 */
router.get('/batch/:batchId/plan', (req, res) => {
  try {
    const { batchId } = req.params;

    const batch = selfTrainingRepo.getBatch(req.db, batchId);
    if (!batch) {
      return res.status(404).json({
        error: 'Batch not found',
        batchId
      });
    }

    const plan = selfTrainingAnalyzer.generateImprovementPlan(req.db, batchId);

    res.json({
      success: true,
      plan
    });
  } catch (err) {
    log.error(`Error generating plan for batch ${req.params.batchId}:`, err);
    res.status(500).json({
      error: 'Failed to generate improvement plan',
      message: err.message
    });
  }
});

/**
 * GET /api/self-training/compare
 * Compare two batches
 * Query: batch1=ID, batch2=ID
 */
router.get('/compare', (req, res) => {
  try {
    const { batch1, batch2 } = req.query;

    if (!batch1 || !batch2) {
      return res.status(400).json({
        error: 'Missing required parameters: batch1 and batch2'
      });
    }

    const comparison = selfTrainingAnalyzer.compareBatches(req.db, batch1, batch2);

    res.json({
      success: true,
      comparison
    });
  } catch (err) {
    log.error('Error comparing batches:', err);
    res.status(500).json({
      error: 'Failed to compare batches',
      message: err.message
    });
  }
});

/**
 * GET /api/self-training/trends/:sectionType
 * Get section trends
 * Query: limit=20
 */
router.get('/trends/:sectionType', (req, res) => {
  try {
    const { sectionType } = req.params;
    const { limit = 20 } = req.query;

    const trends = selfTrainingRepo.getSectionTrends(req.db, sectionType, {
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      sectionType,
      trendCount: trends.length,
      trends
    });
  } catch (err) {
    log.error(`Error getting trends for section ${req.params.sectionType}:`, err);
    res.status(500).json({
      error: 'Failed to get section trends',
      message: err.message
    });
  }
});

export default router;
