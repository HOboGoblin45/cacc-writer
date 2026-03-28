/**
 * server/api/valuationRoutes.js
 * --------------------------------
 * Valuation Workspace REST Endpoints
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   GET    /valuation/grid/:caseId            — comp grid
 *   PUT    /valuation/grid/:caseId/:gridSlot  — update grid slot
 *   POST   /valuation/grid/:caseId/swap       — swap grid slots
 *   DELETE /valuation/grid/:caseId/:gridSlot  — remove from grid
 *   GET    /valuation/grid/:caseId/summary    — grid summary
 *
 *   GET    /valuation/income/:caseId          — income approach data
 *   PUT    /valuation/income/:caseId/rent-comps — save rent comps
 *   PUT    /valuation/income/:caseId/expenses — save expenses
 *   GET    /valuation/income/:caseId/calculate — calculate income value
 *
 *   GET    /valuation/cost/:caseId            — cost approach data
 *   PUT    /valuation/cost/:caseId/land       — save land value
 *   PUT    /valuation/cost/:caseId/replacement — save replacement cost
 *   PUT    /valuation/cost/:caseId/depreciation — save depreciation
 *   GET    /valuation/cost/:caseId/calculate  — calculate cost value
 *
 *   GET    /valuation/reconciliation/:caseId  — reconciliation data
 *   PUT    /valuation/reconciliation/:caseId/values — save approach values
 *   PUT    /valuation/reconciliation/:caseId/weights — save weights
 *   PUT    /valuation/reconciliation/:caseId/narrative — save narrative
 *   GET    /valuation/reconciliation/:caseId/calculate — calculate final value
 */

import { Router } from 'express';
import {
  getCompGrid,
  updateGridSlot,
  swapGridSlots,
  removeFromGrid,
  calculateIndicatedValue as gridIndicatedValue,
  getGridSummary,
} from '../comparableIntelligence/compGridService.js';
import {
  getIncomeAnalysis,
  saveRentComps,
  calculateGRM,
  saveExpenseWorksheet,
  calculateNetIncome,
  getIncomeIndicatedValue,
} from '../comparableIntelligence/incomeApproachService.js';
import {
  getCostAnalysis,
  saveLandValue,
  saveReplacementCost,
  saveDepreciation,
  calculateIndicatedValue as costIndicatedValue,
  getFullCostSummary,
} from '../comparableIntelligence/costApproachService.js';
import {
  getReconciliation,
  saveApproachValues,
  saveWeights,
  calculateFinalValue,
  saveReconciliationNarrative,
  getReconciliationSummary,
} from '../comparableIntelligence/reconciliationService.js';

const router = Router();

// ── Helper ───────────────────────────────────────────────────────────────────

function wrap(fn) {
  return (req, res) => {
    try {
      const result = fn(req);
      res.json(result);
    } catch (err) {
      const status = err.message.includes('required') || err.message.includes('must') ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  };
}

// ── Comp Grid Routes ─────────────────────────────────────────────────────────

router.get('/valuation/grid/:caseId', wrap(req =>
  getCompGrid(req.params.caseId)
));

router.get('/valuation/grid/:caseId/summary', wrap(req =>
  getGridSummary(req.params.caseId)
));

router.put('/valuation/grid/:caseId/:gridSlot', wrap(req =>
  updateGridSlot(req.params.caseId, req.params.gridSlot, req.body)
));

router.post('/valuation/grid/:caseId/swap', wrap(req =>
  swapGridSlots(req.params.caseId, req.body.slotA, req.body.slotB)
));

router.delete('/valuation/grid/:caseId/:gridSlot', wrap(req =>
  removeFromGrid(req.params.caseId, req.params.gridSlot)
));

// ── Income Approach Routes ───────────────────────────────────────────────────

router.get('/valuation/income/:caseId', wrap(req =>
  getIncomeAnalysis(req.params.caseId)
));

router.put('/valuation/income/:caseId/rent-comps', wrap(req =>
  saveRentComps(req.params.caseId, req.body.rentComps ?? req.body)
));

router.put('/valuation/income/:caseId/expenses', wrap(req =>
  saveExpenseWorksheet(req.params.caseId, req.body.expenses ?? req.body)
));

router.get('/valuation/income/:caseId/calculate', wrap(req => {
  calculateGRM(req.params.caseId);
  calculateNetIncome(req.params.caseId);
  return getIncomeIndicatedValue(req.params.caseId);
}));

// ── Cost Approach Routes ─────────────────────────────────────────────────────

router.get('/valuation/cost/:caseId', wrap(req =>
  getCostAnalysis(req.params.caseId)
));

router.put('/valuation/cost/:caseId/land', wrap(req =>
  saveLandValue(req.params.caseId, req.body)
));

router.put('/valuation/cost/:caseId/replacement', wrap(req =>
  saveReplacementCost(req.params.caseId, req.body)
));

router.put('/valuation/cost/:caseId/depreciation', wrap(req =>
  saveDepreciation(req.params.caseId, req.body)
));

router.get('/valuation/cost/:caseId/calculate', wrap(req =>
  costIndicatedValue(req.params.caseId)
));

// ── Reconciliation Routes ────────────────────────────────────────────────────

router.get('/valuation/reconciliation/:caseId', wrap(req =>
  getReconciliation(req.params.caseId)
));

router.put('/valuation/reconciliation/:caseId/values', wrap(req =>
  saveApproachValues(req.params.caseId, req.body)
));

router.put('/valuation/reconciliation/:caseId/weights', wrap(req =>
  saveWeights(req.params.caseId, req.body)
));

router.put('/valuation/reconciliation/:caseId/narrative', wrap(req =>
  saveReconciliationNarrative(req.params.caseId, req.body.narrative ?? req.body.text ?? '')
));

router.get('/valuation/reconciliation/:caseId/calculate', wrap(req =>
  calculateFinalValue(req.params.caseId)
));

export default router;
