/**
 * server/api/forecastRoutes.js
 * Revenue forecasting, AMC profitability, capacity planning.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { forecastRevenue, amcProfitability, turnTimeAnalytics, capacityPlanning, feeOptimization } from '../analytics/revenueForecaster.js';
import { generateStipResponse, batchStipResponses, STIP_CATEGORIES } from '../ai/stipResponseGenerator.js';

const router = Router();

// Revenue forecasting
router.get('/forecast/revenue', authMiddleware, (req, res) => {
  const forecast = forecastRevenue(req.user.userId, parseInt(req.query.days || '90'));
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

router.post('/cases/:id/stip-response', authMiddleware, async (req, res) => {
  try {
    const result = await generateStipResponse(req.params.id, req.body);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

router.post('/cases/:id/stip-batch', authMiddleware, async (req, res) => {
  try {
    const results = await batchStipResponses(req.params.id, req.body.stips || []);
    res.json({ ok: true, results });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
