/**
 * server/api/intelligenceAdvancedRoutes.js
 * Advanced intelligence routes: boundaries, HBU, neighborhood deep analysis.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateParams, CommonSchemas } from '../middleware/validateRequest.js';
import { detectBoundaries } from '../ai/neighborhoodBoundaryDetector.js';
import { analyzeHighestBestUse } from '../ai/highestBestUseAnalyzer.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const caseIdParamSchema = CommonSchemas.caseId;

// POST /cases/:caseId/detect-boundaries — find neighborhood boundaries using OSM + AI
router.post('/cases/:caseId/detect-boundaries', authMiddleware, validateParams(caseIdParamSchema), async (req, res) => {
  try {
    const result = await detectBoundaries(req.validatedParams.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/highest-best-use — generate HBU analysis
router.post('/cases/:caseId/highest-best-use', authMiddleware, validateParams(caseIdParamSchema), async (req, res) => {
  try {
    const result = await analyzeHighestBestUse(req.validatedParams.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
