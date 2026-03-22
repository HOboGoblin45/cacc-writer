/**
 * server/api/copilotRoutes.js
 * Appraisal Copilot chat + quick actions + narrative review.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { chat, quickAction, reviewNarrative, getQuickActions } from '../ai/appraisalCopilot.js';

const router = Router();

// POST /copilot/chat — conversational AI
router.post('/copilot/chat', authMiddleware, async (req, res) => {
  try {
    const response = await chat(req.user.userId, req.body.caseId, req.body.message, req.body.history || []);
    res.json({ ok: true, response });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /copilot/actions — list quick actions
router.get('/copilot/actions', (_req, res) => {
  res.json({ ok: true, actions: getQuickActions() });
});

// POST /copilot/quick/:action — run a quick action
router.post('/copilot/quick/:action', authMiddleware, async (req, res) => {
  try {
    const response = await quickAction(req.user.userId, req.body.caseId, req.params.action);
    res.json({ ok: true, response });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /copilot/review — review a narrative section
router.post('/copilot/review', authMiddleware, async (req, res) => {
  try {
    const response = await reviewNarrative(req.user.userId, req.body.sectionType, req.body.narrative);
    res.json({ ok: true, response });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

export default router;
