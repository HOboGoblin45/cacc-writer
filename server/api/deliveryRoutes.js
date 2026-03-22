/**
 * server/api/deliveryRoutes.js
 * Report delivery routes: email, portal links, delivery tracking.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { deliverReport, getDeliveryHistory, isEmailConfigured } from '../integrations/emailDelivery.js';

const router = Router();

// GET /delivery/status — check email config
router.get('/delivery/status', (_req, res) => {
  res.json({ ok: true, emailConfigured: isEmailConfigured() });
});

// POST /cases/:caseId/deliver — email the report
router.post('/cases/:caseId/deliver', authMiddleware, async (req, res) => {
  try {
    const result = await deliverReport(req.params.caseId, req.user.userId, req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /cases/:caseId/deliveries — delivery history
router.get('/cases/:caseId/deliveries', authMiddleware, (req, res) => {
  const history = getDeliveryHistory(req.params.caseId);
  res.json({ ok: true, deliveries: history });
});

export default router;
