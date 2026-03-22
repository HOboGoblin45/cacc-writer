/**
 * server/api/dataAdvancedRoutes.js
 * Zoning analysis routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { analyzeZoning, ZONING_CATEGORIES } from '../data/zoningAnalyzer.js';

const router = Router();

// GET /zoning/categories — list standard zoning codes
router.get('/zoning/categories', (_req, res) => {
  res.json({ ok: true, categories: Object.entries(ZONING_CATEGORIES).map(([code, info]) => ({ code, ...info })) });
});

// POST /zoning/analyze — analyze zoning for a property
router.post('/zoning/analyze', authMiddleware, (req, res) => {
  const result = analyzeZoning(req.body);
  res.json({ ok: true, ...result });
});

export default router;
