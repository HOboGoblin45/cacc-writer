/**
 * server/api/ratingRoutes.js
 * C&Q rating analysis + neighborhood boundary + HBU routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateParams, CommonSchemas } from '../middleware/validateRequest.js';
import { analyzeConditionQuality, CQ_DEFINITIONS } from '../ai/conditionRatingAssistant.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const caseIdParamSchema = CommonSchemas.caseId;

// POST /cases/:caseId/analyze-cq — AI condition/quality rating analysis
router.post('/cases/:caseId/analyze-cq', authMiddleware, validateParams(caseIdParamSchema), async (req, res) => {
  try {
    const result = await analyzeConditionQuality(req.validatedParams.caseId);
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
