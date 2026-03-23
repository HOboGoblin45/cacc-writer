/**
 * server/api/revisionRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Revision management routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import {
  createRevisionRequest, generateStipulationResponses,
  resolveStipulation, getRevisionHistory, generateRevisionSummary,
} from '../revisions/revisionTracker.js';

const router = Router();

// GET /cases/:caseId/revisions — revision history
router.get('/cases/:caseId/revisions', authMiddleware, (req, res) => {
  const history = getRevisionHistory(req.params.caseId);
  res.json({ ok: true, revisions: history });
});

// POST /cases/:caseId/revisions — create revision request
router.post('/cases/:caseId/revisions', authMiddleware, (req, res) => {
  try {
    const result = createRevisionRequest(req.params.caseId, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/revisions/:revisionId/ai-respond — AI generate responses
router.post('/cases/:caseId/revisions/:revisionId/ai-respond', authMiddleware, async (req, res) => {
  try {
    const result = await generateStipulationResponses(req.params.caseId, req.params.revisionId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/revisions/:revId/respond — alias for ai-respond (underwriter condition response)
router.post('/cases/:caseId/revisions/:revId/respond', authMiddleware, async (req, res) => {
  try {
    const result = await generateStipulationResponses(req.params.caseId, req.params.revId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /stipulations/:stipId/resolve — mark stipulation as resolved
router.patch('/stipulations/:stipId/resolve', authMiddleware, (req, res) => {
  try {
    const result = resolveStipulation(req.params.stipId, req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /cases/:caseId/revisions/summary — revision summary for UCDP
router.get('/cases/:caseId/revisions/summary', authMiddleware, (req, res) => {
  const summary = generateRevisionSummary(req.params.caseId);
  res.json({ ok: true, summary });
});

export default router;
