/**
 * server/api/businessIntelRoutes.js
 * Business intelligence: market trends, fee calculator, profitability.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { getMarketTrends, generateMarketSummary, recordMarketData } from '../intelligence/marketTrendEngine.js';
import { calculateSuggestedFee, getProfitabilityAnalysis } from '../business/feeCalculator.js';

const router = Router();

// Market trends
router.get('/market/trends', authMiddleware, (req, res) => {
  try {
    const { county, city, months } = req.query;
    if (!county) return res.status(400).json({ ok: false, error: 'county required' });
    const trends = getMarketTrends(county, city, { months: parseInt(months || '12') });
    res.json({ ok: true, ...trends });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/market/summary', authMiddleware, (req, res) => {
  try {
    const { county, city } = req.query;
    if (!county) return res.status(400).json({ ok: false, error: 'county required' });
    const result = generateMarketSummary(county, city);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Fee calculator
router.get('/cases/:caseId/suggested-fee', authMiddleware, (req, res) => {
  try {
    const result = calculateSuggestedFee(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Profitability
router.get('/business/profitability', authMiddleware, (req, res) => {
  try {
    const result = getProfitabilityAnalysis(req.user.userId, req.query.period);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Manually record market data for a case
router.post('/cases/:caseId/record-market-data', authMiddleware, (req, res) => {
  try {
    recordMarketData(req.params.caseId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
