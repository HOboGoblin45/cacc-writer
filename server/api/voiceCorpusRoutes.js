import express from 'express';
import log from '../logger.js';
import {
  ingestFeedbackToCorpus,
  batchIngestFromFeedback,
  getIngestionStats,
} from '../integrations/voiceCorpusIngester.js';

const router = express.Router();

/**
 * POST /api/voice-corpus/ingest/:feedbackId
 * Ingest single feedback record into voice corpus
 */
router.post('/ingest/:feedbackId', (req, res) => {
  try {
    const { feedbackId } = req.params;

    if (!feedbackId) {
      return res.status(400).json({ error: 'feedbackId required in URL params' });
    }

    // Get user database - corpus is typically per-user
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId required in body' });
    }

    const db = req.app.locals.getUserDb?.(userId);
    if (!db) {
      return res.status(500).json({ error: 'Database initialization failed' });
    }

    const result = ingestFeedbackToCorpus(db, feedbackId);

    log.info(`[${userId}] POST /ingest: ${feedbackId} - ${result.message}`);

    if (result.success) {
      res.json({
        success: true,
        corpusEntryId: result.corpusEntryId,
        message: result.message,
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message,
      });
    }
  } catch (err) {
    log.error(`POST /ingest error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/voice-corpus/batch-ingest
 * Batch ingest feedback records
 * Body: { userId, options: { minRating, limit, userIdFilter } }
 */
router.post('/batch-ingest', (req, res) => {
  try {
    const { userId, options = {} } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required in body' });
    }

    const db = req.app.locals.getUserDb?.(userId);
    if (!db) {
      return res.status(500).json({ error: 'Database initialization failed' });
    }

    const result = batchIngestFromFeedback(db, options);

    log.info(
      `[${userId}] POST /batch-ingest: ingested=${result.ingested}, skipped=${result.skipped}`
    );

    res.json({
      success: result.success,
      ...result,
    });
  } catch (err) {
    log.error(`POST /batch-ingest error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/voice-corpus/stats
 * Get voice corpus ingestion statistics
 */
router.get('/stats', (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId required as query param' });
    }

    const db = req.app.locals.getUserDb?.(userId);
    if (!db) {
      return res.status(500).json({ error: 'Database initialization failed' });
    }

    const stats = getIngestionStats(db);

    log.info(`[${userId}] GET /stats: ${stats.totalCorpusEntries} corpus entries`);

    res.json({
      success: true,
      ...stats,
    });
  } catch (err) {
    log.error(`GET /stats error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
