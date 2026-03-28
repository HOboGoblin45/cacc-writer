/**
 * server/api/ucdpRoutes.js
 * UCDP submission preparation and validation routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateParams, validateBody, CommonSchemas } from '../middleware/validateRequest.js';
import { preValidateForUcdp, prepareSubmission, autoFixErrors, getSubmissionHistory } from '../integrations/ucdpSubmission.js';

const router = Router();

// ── Zod Schemas ─────────────────────────────────────────────────────────────

const caseIdSchema = CommonSchemas.caseId;

const prepareSubmissionSchema = z.object({
  // Submission preparation payload
}).passthrough();

const autoFixErrorsSchema = z.object({
  errors: z.array(z.any()).optional().default([]),
});

// POST /cases/:caseId/ucdp/validate — pre-submission validation
router.post('/cases/:caseId/ucdp/validate', authMiddleware, validateParams(caseIdSchema), async (req, res) => {
  try {
    const result = await preValidateForUcdp(req.validatedParams.caseId, req.user.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/ucdp/prepare — prepare submission package
router.post('/cases/:caseId/ucdp/prepare', authMiddleware, validateParams(caseIdSchema), validateBody(prepareSubmissionSchema), async (req, res) => {
  try {
    const result = await prepareSubmission(req.validatedParams.caseId, req.user.userId, req.validated);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/ucdp/auto-fix — AI suggest fixes for validation errors
router.post('/cases/:caseId/ucdp/auto-fix', authMiddleware, validateParams(caseIdSchema), validateBody(autoFixErrorsSchema), async (req, res) => {
  try {
    const fixes = await autoFixErrors(req.validatedParams.caseId, req.validated.errors);
    res.json({ ok: true, fixes });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /cases/:caseId/ucdp/history — submission history
router.get('/cases/:caseId/ucdp/history', authMiddleware, validateParams(caseIdSchema), (req, res) => {
  const history = getSubmissionHistory(req.validatedParams.caseId);
  res.json({ ok: true, submissions: history });
});

export default router;
