/**
 * server/api/automationRoutes.js
 * Workflow automation rules engine routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateBody, validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import { createRule, getRules, fireTrigger, getAutomationLog, TRIGGER_TYPES, ACTION_TYPES } from '../automation/workflowAutomation.js';
import { enrichCaseWithMarketContext } from '../integrations/zillow.js';

const router = Router();

/**
 * Zod schemas for request validation
 */
const CreateRuleBody = z.object({
  trigger: z.string().min(1),
  action: z.string().min(1),
  conditions: z.record(z.any()).optional(),
  enabled: z.boolean().default(true),
});

const TestFireBody = z.object({
  triggerType: z.string().min(1),
  caseId: z.string().min(1),
});

const LogQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// GET /automation/triggers — available trigger types
router.get('/automation/triggers', (_req, res) => {
  res.json({ ok: true, triggers: Object.entries(TRIGGER_TYPES).map(([k, v]) => ({ id: k, ...v })) });
});

// GET /automation/actions — available action types
router.get('/automation/actions', (_req, res) => {
  res.json({ ok: true, actions: Object.entries(ACTION_TYPES).map(([k, v]) => ({ id: k, ...v })) });
});

// GET /automation/rules — user's automation rules
router.get('/automation/rules', authMiddleware, (req, res) => {
  const rules = getRules(req.user.userId);
  res.json({ ok: true, rules });
});

// POST /automation/rules — create rule
router.post('/automation/rules', authMiddleware, validateBody(CreateRuleBody), (req, res) => {
  try {
    const result = createRule(req.user.userId, req.validated);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /automation/test-fire — manually fire a trigger (testing)
router.post('/automation/test-fire', authMiddleware, validateBody(TestFireBody), async (req, res) => {
  try {
    const { triggerType, caseId } = req.validated;
    const result = await fireTrigger(triggerType, { caseId, userId: req.user.userId });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /automation/log — automation execution history
router.get('/automation/log', authMiddleware, validateQuery(LogQuery), (req, res) => {
  const auditLog = getAutomationLog(req.user.userId, req.validatedQuery.limit);
  res.json({ ok: true, log: auditLog });
});

// POST /cases/:caseId/market-context — pull market intelligence
router.post(
  '/cases/:caseId/market-context',
  authMiddleware,
  validateParams(CommonSchemas.caseId),
  async (req, res) => {
    try {
      const result = await enrichCaseWithMarketContext(req.validatedParams.caseId);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

export default router;
