import express from 'express';
import log from '../logger.js';
import {
  processUploadedReportsEnhanced,
  generateVoicePreviewEnhanced,
  generateSampleNarrativeEnhanced,
  getOnboardingAnalytics,
} from '../onboarding/onboardingEnhanced.js';

const router = express.Router();

/**
 * POST /api/onboarding/v2/upload
 * Enhanced file upload with validation and extraction job creation
 */
router.post('/upload', (req, res) => {
  try {
    const { userId } = req.body;
    const files = req.body.files || [];

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    if (!Array.isArray(files)) {
      return res.status(400).json({ error: 'files must be array' });
    }

    // Get user database
    const db = req.app.locals.getUserDb?.(userId);
    if (!db) {
      return res.status(500).json({ error: 'Database initialization failed' });
    }

    const result = processUploadedReportsEnhanced(db, userId, files);

    log.info(`[${userId}] POST /upload: ${result.processingStarted}/${result.filesReceived} files processed`);

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    log.error(`POST /upload error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/onboarding/v2/voice-preview/:userId
 * Enhanced voice preview with analysis
 */
router.get('/voice-preview/:userId', (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const db = req.app.locals.getUserDb?.(userId);
    if (!db) {
      return res.status(500).json({ error: 'Database initialization failed' });
    }

    const preview = generateVoicePreviewEnhanced(db, userId);

    log.info(`[${userId}] GET /voice-preview: score=${preview.voiceMatchScore}, level=${preview.confidenceLevel}`);

    res.json({
      success: true,
      ...preview,
    });
  } catch (err) {
    log.error(`GET /voice-preview error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/onboarding/v2/generate/:userId
 * Enhanced narrative generation with voice style
 * Body: { sectionId, options: { style, length } }
 */
router.post('/generate/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const { sectionId, options = {} } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    if (!sectionId) {
      return res.status(400).json({ error: 'sectionId required' });
    }

    const db = req.app.locals.getUserDb?.(userId);
    if (!db) {
      return res.status(500).json({ error: 'Database initialization failed' });
    }

    const result = generateSampleNarrativeEnhanced(db, userId, sectionId, options);

    log.info(`[${userId}] POST /generate: ${sectionId}, quality=${result.qualityScore}, time=${result.generationTimeMs}ms`);

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    log.error(`POST /generate error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/onboarding/v2/analytics/:userId
 * Onboarding analytics
 */
router.get('/analytics/:userId', (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const db = req.app.locals.getUserDb?.(userId);
    if (!db) {
      return res.status(500).json({ error: 'Database initialization failed' });
    }

    const analytics = getOnboardingAnalytics(db, userId);

    log.info(`[${userId}] GET /analytics: ${analytics.totalProgress}% complete`);

    res.json({
      success: true,
      ...analytics,
    });
  } catch (err) {
    log.error(`GET /analytics error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
