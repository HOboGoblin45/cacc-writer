/**
 * server/api/deliveryRoutes.js
 * Report delivery routes: email, portal links, delivery tracking.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { deliverReport, getDeliveryHistory, isEmailConfigured } from '../integrations/emailDelivery.js';

const router = Router();

// Zod schemas
const caseIdSchema = z.string().min(1, 'caseId is required');
const deliveryBodySchema = z.object({}).strict();

// Validation middleware
const validateParams = (schema) => (req, res, next) => {
  try {
    req.validatedParams = schema.parse(req.params);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

const validateBody = (schema) => (req, res, next) => {
  try {
    req.validated = schema.parse(req.body);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

// GET /delivery/status — check email config
router.get('/delivery/status', (_req, res) => {
  res.json({ ok: true, emailConfigured: isEmailConfigured() });
});

// POST /cases/:caseId/deliver — email the report
router.post('/cases/:caseId/deliver', authMiddleware, validateParams(z.object({ caseId: caseIdSchema })), validateBody(deliveryBodySchema), async (req, res) => {
  try {
    const result = await deliverReport(req.validatedParams.caseId, req.user.userId, req.validated);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /cases/:caseId/deliveries — delivery history
router.get('/cases/:caseId/deliveries', authMiddleware, validateParams(z.object({ caseId: caseIdSchema })), (req, res) => {
  const history = getDeliveryHistory(req.validatedParams.caseId);
  res.json({ ok: true, deliveries: history });
});

export default router;
