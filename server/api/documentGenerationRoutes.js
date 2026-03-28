/**
 * server/api/documentGenerationRoutes.js
 * Routes for engagement letters, scope of work, tax estimates, and more.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateParams } from '../middleware/validateRequest.js';
import { generateEngagementLetter, generateScopeOfWork, generateExtraordinaryAssumptions } from '../ai/coverLetterGenerator.js';
import { estimateTaxData, calculateLandRatio } from '../data/taxLookup.js';

const router = Router();

// Schemas
const caseIdSchema = z.object({ caseId: z.string().min(1) });

// POST /cases/:caseId/engagement-letter
router.post('/cases/:caseId/engagement-letter', authMiddleware, validateParams(caseIdSchema), async (req, res) => {
  try {
    const letter = await generateEngagementLetter(req.validatedParams.caseId);
    res.json({ ok: true, letter });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /cases/:caseId/scope-of-work
router.post('/cases/:caseId/scope-of-work', authMiddleware, validateParams(caseIdSchema), async (req, res) => {
  try {
    const scope = await generateScopeOfWork(req.validatedParams.caseId);
    res.json({ ok: true, scope });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /cases/:caseId/extraordinary-assumptions
router.post('/cases/:caseId/extraordinary-assumptions', authMiddleware, validateParams(caseIdSchema), async (req, res) => {
  try {
    const assumptions = await generateExtraordinaryAssumptions(req.validatedParams.caseId);
    res.json({ ok: true, assumptions });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /cases/:caseId/tax-estimate
router.post('/cases/:caseId/tax-estimate', authMiddleware, validateParams(caseIdSchema), async (req, res) => {
  try {
    const taxData = await estimateTaxData(req.validatedParams.caseId);
    res.json({ ok: true, ...taxData });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /cases/:caseId/land-ratio
router.get('/cases/:caseId/land-ratio', authMiddleware, validateParams(caseIdSchema), (req, res) => {
  const ratio = calculateLandRatio(req.validatedParams.caseId);
  if (!ratio) return res.status(400).json({ ok: false, error: 'Tax data not available — run tax estimate first' });
  res.json({ ok: true, ...ratio });
});

export default router;
