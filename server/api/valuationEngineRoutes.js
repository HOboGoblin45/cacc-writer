/**
 * server/api/valuationEngineRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Valuation engine routes: cost approach, income approach, reconciliation.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateParams } from '../middleware/validateRequest.js';
import { calculateCostApproach, generateCostNarrative } from '../valuation/costApproachEngine.js';
import { calculateIncomeApproach, generateIncomeNarrative } from '../valuation/incomeApproachEngine.js';
import { reconcile, generateReconciliationNarrative } from '../valuation/reconciliationEngine.js';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

const caseIdParamsSchema = z.object({
  caseId: z.string().min(1, 'Case ID required'),
});

// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// POST /cases/:caseId/valuation/cost — calculate cost approach
router.post('/cases/:caseId/valuation/cost', authMiddleware, validateParams(caseIdParamsSchema), (req, res) => {
  try {
    const result = calculateCostApproach(req.validatedParams.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/cost/narrative — generate cost narrative
router.post('/cases/:caseId/valuation/cost/narrative', authMiddleware, validateParams(caseIdParamsSchema), async (req, res) => {
  try {
    const narrative = await generateCostNarrative(req.validatedParams.caseId);
    res.json({ ok: true, narrative });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/income — calculate income approach
router.post('/cases/:caseId/valuation/income', authMiddleware, validateParams(caseIdParamsSchema), (req, res) => {
  try {
    const result = calculateIncomeApproach(req.validatedParams.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/income/narrative — generate income narrative
router.post('/cases/:caseId/valuation/income/narrative', authMiddleware, validateParams(caseIdParamsSchema), async (req, res) => {
  try {
    const narrative = await generateIncomeNarrative(req.validatedParams.caseId);
    res.json({ ok: true, narrative });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/reconcile — perform reconciliation
router.post('/cases/:caseId/valuation/reconcile', authMiddleware, validateParams(caseIdParamsSchema), (req, res) => {
  try {
    const result = reconcile(req.validatedParams.caseId);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/reconcile/narrative — generate reconciliation narrative
router.post('/cases/:caseId/valuation/reconcile/narrative', authMiddleware, validateParams(caseIdParamsSchema), async (req, res) => {
  try {
    const narrative = await generateReconciliationNarrative(req.validatedParams.caseId);
    res.json({ ok: true, narrative });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/valuation/full — run all three approaches + reconcile
router.post('/cases/:caseId/valuation/full', authMiddleware, validateParams(caseIdParamsSchema), async (req, res) => {
  const results = { approaches: {} };
  try {
    // Cost approach
    try { results.approaches.cost = calculateCostApproach(req.validatedParams.caseId); } catch (e) { results.approaches.cost = { error: e.message }; }

    // Income approach (for applicable form types)
    try { results.approaches.income = calculateIncomeApproach(req.validatedParams.caseId); } catch (e) { results.approaches.income = { error: e.message }; }

    // Reconciliation
    try { results.reconciliation = reconcile(req.validatedParams.caseId); } catch (e) { results.reconciliation = { error: e.message }; }

    res.json({ ok: true, ...results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
