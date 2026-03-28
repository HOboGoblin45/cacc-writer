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
import { z } from 'zod';
import { validateBody, validateParams, CommonSchemas } from '../middleware/validateRequest.js';
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

// ── Validation Schemas ───────────────────────────────────────────────────────

const caseIdSchema = CommonSchemas.caseId;

const gridSlotSchema = z.object({
  caseId: z.string().min(1),
  gridSlot: z.string().min(1),
});

const gridSlotWithBodySchema = z.object({
  slotData: z.record(z.any()),
});

const swapGridSlotsSchema = z.object({
  slotA: z.string().min(1),
  slotB: z.string().min(1),
});

const rentCompsSchema = z.object({
  rentComps: z.array(z.record(z.any())).optional(),
}).passthrough();

const expensesSchema = z.object({
  expenses: z.array(z.record(z.any())).optional(),
}).passthrough();

const landValueSchema = z.object({
  landValue: z.number().optional(),
}).passthrough();

const replacementCostSchema = z.object({
  replacementCost: z.number().optional(),
}).passthrough();

const depreciationSchema = z.object({
  depreciation: z.number().optional(),
}).passthrough();

const approachValuesSchema = z.object({
  marketValue: z.number().optional(),
  incomeValue: z.number().optional(),
  costValue: z.number().optional(),
}).passthrough();

const weightsSchema = z.object({
  marketWeight: z.number().optional(),
  incomeWeight: z.number().optional(),
  costWeight: z.number().optional(),
}).passthrough();

const reconciliationNarrativeSchema = z.object({
  narrative: z.string().optional(),
  text: z.string().optional(),
}).passthrough();

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

router.get('/valuation/grid/:caseId',
  validateParams(caseIdSchema),
  wrap(req =>
    getCompGrid(req.validatedParams.caseId)
  )
);

router.get('/valuation/grid/:caseId/summary',
  validateParams(caseIdSchema),
  wrap(req =>
    getGridSummary(req.validatedParams.caseId)
  )
);

router.put('/valuation/grid/:caseId/:gridSlot',
  validateParams(gridSlotSchema),
  validateBody(gridSlotWithBodySchema),
  wrap(req =>
    updateGridSlot(req.validatedParams.caseId, req.validatedParams.gridSlot, req.validated)
  )
);

router.post('/valuation/grid/:caseId/swap',
  validateParams(caseIdSchema),
  validateBody(swapGridSlotsSchema),
  wrap(req =>
    swapGridSlots(req.validatedParams.caseId, req.validated.slotA, req.validated.slotB)
  )
);

router.delete('/valuation/grid/:caseId/:gridSlot',
  validateParams(gridSlotSchema),
  wrap(req =>
    removeFromGrid(req.validatedParams.caseId, req.validatedParams.gridSlot)
  )
);

// ── Income Approach Routes ───────────────────────────────────────────────────

router.get('/valuation/income/:caseId',
  validateParams(caseIdSchema),
  wrap(req =>
    getIncomeAnalysis(req.validatedParams.caseId)
  )
);

router.put('/valuation/income/:caseId/rent-comps',
  validateParams(caseIdSchema),
  validateBody(rentCompsSchema),
  wrap(req =>
    saveRentComps(req.validatedParams.caseId, req.validated.rentComps ?? req.validated)
  )
);

router.put('/valuation/income/:caseId/expenses',
  validateParams(caseIdSchema),
  validateBody(expensesSchema),
  wrap(req =>
    saveExpenseWorksheet(req.validatedParams.caseId, req.validated.expenses ?? req.validated)
  )
);

router.get('/valuation/income/:caseId/calculate',
  validateParams(caseIdSchema),
  wrap(req => {
    calculateGRM(req.validatedParams.caseId);
    calculateNetIncome(req.validatedParams.caseId);
    return getIncomeIndicatedValue(req.validatedParams.caseId);
  })
);

// ── Cost Approach Routes ─────────────────────────────────────────────────────

router.get('/valuation/cost/:caseId',
  validateParams(caseIdSchema),
  wrap(req =>
    getCostAnalysis(req.validatedParams.caseId)
  )
);

router.put('/valuation/cost/:caseId/land',
  validateParams(caseIdSchema),
  validateBody(landValueSchema),
  wrap(req =>
    saveLandValue(req.validatedParams.caseId, req.validated)
  )
);

router.put('/valuation/cost/:caseId/replacement',
  validateParams(caseIdSchema),
  validateBody(replacementCostSchema),
  wrap(req =>
    saveReplacementCost(req.validatedParams.caseId, req.validated)
  )
);

router.put('/valuation/cost/:caseId/depreciation',
  validateParams(caseIdSchema),
  validateBody(depreciationSchema),
  wrap(req =>
    saveDepreciation(req.validatedParams.caseId, req.validated)
  )
);

router.get('/valuation/cost/:caseId/calculate',
  validateParams(caseIdSchema),
  wrap(req =>
    costIndicatedValue(req.validatedParams.caseId)
  )
);

// ── Reconciliation Routes ────────────────────────────────────────────────────

router.get('/valuation/reconciliation/:caseId',
  validateParams(caseIdSchema),
  wrap(req =>
    getReconciliation(req.validatedParams.caseId)
  )
);

router.put('/valuation/reconciliation/:caseId/values',
  validateParams(caseIdSchema),
  validateBody(approachValuesSchema),
  wrap(req =>
    saveApproachValues(req.validatedParams.caseId, req.validated)
  )
);

router.put('/valuation/reconciliation/:caseId/weights',
  validateParams(caseIdSchema),
  validateBody(weightsSchema),
  wrap(req =>
    saveWeights(req.validatedParams.caseId, req.validated)
  )
);

router.put('/valuation/reconciliation/:caseId/narrative',
  validateParams(caseIdSchema),
  validateBody(reconciliationNarrativeSchema),
  wrap(req =>
    saveReconciliationNarrative(req.validatedParams.caseId, req.validated.narrative ?? req.validated.text ?? '')
  )
);

router.get('/valuation/reconciliation/:caseId/calculate',
  validateParams(caseIdSchema),
  wrap(req =>
    calculateFinalValue(req.validatedParams.caseId)
  )
);

export default router;
