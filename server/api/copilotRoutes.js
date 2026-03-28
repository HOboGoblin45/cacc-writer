/**
 * server/api/copilotRoutes.js
 * Appraisal Copilot chat + quick actions + narrative review.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateBody, validateParams } from '../middleware/validateRequest.js';
import { chat, quickAction, reviewNarrative, getQuickActions } from '../ai/appraisalCopilot.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const chatBodySchema = z.object({
  caseId: z.string().min(1),
  message: z.string().min(1),
  history: z.array(z.any()).optional(),
});

const quickActionBodySchema = z.object({
  caseId: z.string().min(1),
});

const quickActionParamsSchema = z.object({
  action: z.string().min(1),
});

const reviewNarrativeBodySchema = z.object({
  sectionType: z.string().min(1),
  narrative: z.string().min(1),
});

// ── Routes ───────────────────────────────────────────────────────────────────

// POST /copilot/chat — conversational AI
router.post('/copilot/chat', authMiddleware, validateBody(chatBodySchema), async (req, res) => {
  try {
    const response = await chat(req.user.userId, req.validated.caseId, req.validated.message, req.validated.history || []);
    res.json({ ok: true, response });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /copilot/actions — list quick actions
router.get('/copilot/actions', (_req, res) => {
  res.json({ ok: true, actions: getQuickActions() });
});

// POST /copilot/quick/:action — run a quick action
router.post('/copilot/quick/:action', authMiddleware, validateParams(quickActionParamsSchema), validateBody(quickActionBodySchema), async (req, res) => {
  try {
    const response = await quickAction(req.user.userId, req.validated.caseId, req.validatedParams.action);
    res.json({ ok: true, response });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /copilot/review — review a narrative section
router.post('/copilot/review', authMiddleware, validateBody(reviewNarrativeBodySchema), async (req, res) => {
  try {
    const response = await reviewNarrative(req.user.userId, req.validated.sectionType, req.validated.narrative);
    res.json({ ok: true, response });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

export default router;
