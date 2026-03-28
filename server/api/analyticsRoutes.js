/**
 * server/api/analyticsRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Business analytics API routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateQuery } from '../middleware/validateRequest.js';
import { getProductivityStats, getProjections } from '../analytics/productivityTracker.js';

const router = Router();

// Zod schemas
const productivityQuerySchema = z.object({
  period: z.string().min(1).optional(),
});

// GET /analytics/productivity — productivity stats
router.get('/analytics/productivity', authMiddleware, validateQuery(productivityQuerySchema), (req, res) => {
  const stats = getProductivityStats(req.user.userId, { period: req.validatedQuery.period });
  res.json({ ok: true, ...stats });
});

// GET /analytics/projections — financial projections
router.get('/analytics/projections', authMiddleware, (req, res) => {
  const projections = getProjections(req.user.userId);
  res.json({ ok: true, ...projections });
});

export default router;
