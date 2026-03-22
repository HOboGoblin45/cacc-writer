/**
 * server/api/ucdpRoutes.js
 * UCDP submission preparation and validation routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { preValidateForUcdp, prepareSubmission, autoFixErrors, getSubmissionHistory } from '../integrations/ucdpSubmission.js';

const router = Router();

// POST /cases/:caseId/ucdp/validate — pre-submission validation
router.post('/cases/:caseId/ucdp/validate', authMiddleware, async (req, res) => {
  try {
    const result = await preValidateForUcdp(req.params.caseId, req.user.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/ucdp/prepare — prepare submission package
router.post('/cases/:caseId/ucdp/prepare', authMiddleware, async (req, res) => {
  try {
    const result = await prepareSubmission(req.params.caseId, req.user.userId, req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/ucdp/auto-fix — AI suggest fixes for validation errors
router.post('/cases/:caseId/ucdp/auto-fix', authMiddleware, async (req, res) => {
  try {
    const fixes = await autoFixErrors(req.params.caseId, req.body.errors || []);
    res.json({ ok: true, fixes });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /cases/:caseId/ucdp/history — submission history
router.get('/cases/:caseId/ucdp/history', authMiddleware, (req, res) => {
  const history = getSubmissionHistory(req.params.caseId);
  res.json({ ok: true, submissions: history });
});

export default router;
