/**
 * server/api/businessIntelRoutes.js
 * Business intelligence: market trends, fee calculator, profitability.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateParams, validateQuery, CommonSchemas } from '../middleware/validateRequest.js';
import { getMarketTrends, generateMarketSummary, recordMarketData } from '../intelligence/marketTrendEngine.js';
import { calculateSuggestedFee, getProfitabilityAnalysis } from '../business/feeCalculator.js';

const router = Router();

/**
 * Zod schemas for request validation
 */
const MarketTrendsQuery = z.object({
  county: z.string().min(1),
  city: z.string().optional(),
  months: z.coerce.number().int().min(1).max(60).default(12),
});

const MarketSummaryQuery = z.object({
  county: z.string().min(1),
  city: z.string().optional(),
});

const ProfitabilityQuery = z.object({
  period: z.string().optional(),
});

// Market trends
router.get('/market/trends', authMiddleware, validateQuery(MarketTrendsQuery), (req, res) => {
  try {
    const { county, city, months } = req.validatedQuery;
    const trends = getMarketTrends(county, city, { months });
    res.json({ ok: true, ...trends });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/market/summary', authMiddleware, validateQuery(MarketSummaryQuery), (req, res) => {
  try {
    const { county, city } = req.validatedQuery;
    const result = generateMarketSummary(county, city);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Fee calculator
router.get('/cases/:caseId/suggested-fee', authMiddleware, validateParams(CommonSchemas.caseId), (req, res) => {
  try {
    const result = calculateSuggestedFee(req.validatedParams.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Profitability
router.get('/business/profitability', authMiddleware, validateQuery(ProfitabilityQuery), (req, res) => {
  try {
    const result = getProfitabilityAnalysis(req.user.userId, req.validatedQuery.period);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Manually record market data for a case
router.post('/cases/:caseId/record-market-data', authMiddleware, validateParams(CommonSchemas.caseId), (req, res) => {
  try {
    recordMarketData(req.validatedParams.caseId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
