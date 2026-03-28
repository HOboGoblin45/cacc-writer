/**
 * server/api/forecastRoutes.js
 * Revenue forecasting, AMC profitability, capacity planning.
 */

import { Router } from 'express';
import { z } from 'zod';
import { validateParams, validateQuery, validateBody, CommonSchemas } from '../middleware/validateRequest.js';
import { authMiddleware } from '../auth/authService.js';
import { forecastRevenue, amcProfitability, turnTimeAnalytics, capacityPlanning, feeOptimization } from '../analytics/revenueForecaster.js';
import { generateStipResponse, batchStipResponses, STIP_CATEGORIES } from '../ai/stipResponseGenerator.js';

const router = Router();

// ── Validation Schemas ───────────────────────────────────────────────────────
const forecastQuerySchema = z.object({
  days: z.coerce.number().int().min(1).default(90),
});

const caseIdSchema = CommonSchemas.id;

const stipResponseSchema = z.object({
  category: z.string().min(1),
  stipText: z.string().min(1),
});

const stipBatchSchema = z.object({
  stips: z.array(z.any()).default([]),
});

// Revenue forecasting
router.get('/forecast/revenue', authMiddleware, validateQuery(forecastQuerySchema), (req, res) => {
  const { days } = req.validatedQuery;
  const forecast = forecastRevenue(req.user.userId, days);
  res.json({ ok: true, ...forecast });
});

// AMC profitability
router.get('/forecast/amc-profitability', authMiddleware, (req, res) => {
  res.json({ ok: true, amcs: amcProfitability(req.user.userId) });
});

// Turn-time analytics
router.get('/forecast/turn-times', authMiddleware, (req, res) => {
  res.json({ ok: true, analytics: turnTimeAnalytics(req.user.userId) });
});

// Capacity planning
router.get('/forecast/capacity', authMiddleware, (req, res) => {
  res.json({ ok: true, ...capacityPlanning(req.user.userId) });
});

// Fee optimization
router.get('/forecast/fee-optimization', authMiddleware, (req, res) => {
  res.json({ ok: true, suggestions: feeOptimization(req.user.userId) });
});

// Stip response generation
router.get('/stip/categories', (_req, res) => {
  res.json({ ok: true, categories: Object.entries(STIP_CATEGORIES).map(([k, v]) => ({ id: k, ...v })) });
});

router.post('/cases/:id/stip-response', authMiddleware, validateParams(caseIdSchema), validateBody(stipResponseSchema), async (req, res) => {
  try {
    const caseId = req.validatedParams.id;
    const result = await generateStipResponse(caseId, req.validated);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

router.post('/cases/:id/stip-batch', authMiddleware, validateParams(caseIdSchema), validateBody(stipBatchSchema), async (req, res) => {
  try {
    const caseId = req.validatedParams.id;
    const results = await batchStipResponses(caseId, req.validated.stips);
    res.json({ ok: true, results });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
