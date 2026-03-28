/**
 * server/api/dataAdvancedRoutes.js
 * Zoning analysis routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateBody } from '../middleware/validateRequest.js';
import { analyzeZoning, ZONING_CATEGORIES } from '../data/zoningAnalyzer.js';

const router = Router();

// Schemas
const zoningAnalyzeSchema = z.object({
  // Expected body for zoning analysis — adjust per actual requirements
  propertyAddress: z.string().min(1).optional(),
  zoneCode: z.string().min(1).optional(),
  coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
}).passthrough(); // Allow additional fields for flexibility

// GET /zoning/categories — list standard zoning codes
router.get('/zoning/categories', (_req, res) => {
  res.json({ ok: true, categories: Object.entries(ZONING_CATEGORIES).map(([code, info]) => ({ code, ...info })) });
});

// POST /zoning/analyze — analyze zoning for a property
router.post('/zoning/analyze', authMiddleware, validateBody(zoningAnalyzeSchema), (req, res) => {
  const result = analyzeZoning(req.validated);
  res.json({ ok: true, ...result });
});

export default router;
