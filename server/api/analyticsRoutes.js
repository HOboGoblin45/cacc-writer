/**
 * server/api/analyticsRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Business analytics API routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { getProductivityStats, getProjections } from '../analytics/productivityTracker.js';

const router = Router();

// GET /analytics/productivity — productivity stats
router.get('/analytics/productivity', authMiddleware, (req, res) => {
  const stats = getProductivityStats(req.user.userId, { period: req.query.period });
  res.json({ ok: true, ...stats });
});

// GET /analytics/projections — financial projections
router.get('/analytics/projections', authMiddleware, (req, res) => {
  const projections = getProjections(req.user.userId);
  res.json({ ok: true, ...projections });
});

export default router;
