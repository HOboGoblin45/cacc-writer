/**
 * server/api/ratingRoutes.js
 * C&Q rating analysis + neighborhood boundary + HBU routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { analyzeConditionQuality, CQ_DEFINITIONS } from '../ai/conditionRatingAssistant.js';

const router = Router();

// POST /cases/:caseId/analyze-cq — AI condition/quality rating analysis
router.post('/cases/:caseId/analyze-cq', authMiddleware, async (req, res) => {
  try {
    const result = await analyzeConditionQuality(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /cq-definitions — UAD condition and quality rating definitions
router.get('/cq-definitions', (_req, res) => {
  res.json({ ok: true, definitions: CQ_DEFINITIONS });
});

export default router;
