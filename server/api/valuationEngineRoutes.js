/**
 * server/api/valuationEngineRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Valuation engine routes: cost approach, income approach, reconciliation.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { calculateCostApproach, generateCostNarrative } from '../valuation/costApproachEngine.js';
import { calculateIncomeApproach, generateIncomeNarrative } from '../valuation/incomeApproachEngine.js';
import { reconcile, generateReconciliationNarrative } from '../valuation/reconciliationEngine.js';

const router = Router();

// POST /cases/:caseId/valuation/cost — calculate cost approach
router.post('/cases/:caseId/valuation/cost', authMiddleware, (req, res) => {
  try {
    const result = calculateCostApproach(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/cost/narrative — generate cost narrative
router.post('/cases/:caseId/valuation/cost/narrative', authMiddleware, async (req, res) => {
  try {
    const narrative = await generateCostNarrative(req.params.caseId);
    res.json({ ok: true, narrative });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/income — calculate income approach
router.post('/cases/:caseId/valuation/income', authMiddleware, (req, res) => {
  try {
    const result = calculateIncomeApproach(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/income/narrative — generate income narrative
router.post('/cases/:caseId/valuation/income/narrative', authMiddleware, async (req, res) => {
  try {
    const narrative = await generateIncomeNarrative(req.params.caseId);
    res.json({ ok: true, narrative });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/reconcile — perform reconciliation
router.post('/cases/:caseId/valuation/reconcile', authMiddleware, (req, res) => {
  try {
    const result = reconcile(req.params.caseId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/reconcile/narrative — generate reconciliation narrative
router.post('/cases/:caseId/valuation/reconcile/narrative', authMiddleware, async (req, res) => {
  try {
    const narrative = await generateReconciliationNarrative(req.params.caseId);
    res.json({ ok: true, narrative });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/full — run all three approaches + reconcile
router.post('/cases/:caseId/valuation/full', authMiddleware, async (req, res) => {
  const results = { approaches: {} };
  try {
    // Cost approach
    try { results.approaches.cost = calculateCostApproach(req.params.caseId); } catch (e) { results.approaches.cost = { error: e.message }; }

    // Income approach (for applicable form types)
    try { results.approaches.income = calculateIncomeApproach(req.params.caseId); } catch (e) { results.approaches.income = { error: e.message }; }

    // Reconciliation
    try { results.reconciliation = reconcile(req.params.caseId); } catch (e) { results.reconciliation = { error: e.message }; }

    res.json({ ok: true, ...results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
