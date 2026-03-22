/**
 * server/api/intelligenceAdvancedRoutes.js
 * Advanced intelligence routes: boundaries, HBU, neighborhood deep analysis.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { detectBoundaries } from '../ai/neighborhoodBoundaryDetector.js';
import { analyzeHighestBestUse } from '../ai/highestBestUseAnalyzer.js';

const router = Router();

// POST /cases/:caseId/detect-boundaries — find neighborhood boundaries using OSM + AI
router.post('/cases/:caseId/detect-boundaries', authMiddleware, async (req, res) => {
  try {
    const result = await detectBoundaries(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/highest-best-use — generate HBU analysis
router.post('/cases/:caseId/highest-best-use', authMiddleware, async (req, res) => {
  try {
    const result = await analyzeHighestBestUse(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
