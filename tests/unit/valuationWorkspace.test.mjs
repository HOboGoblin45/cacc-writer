/**
 * tests/unit/valuationWorkspace.test.mjs
 * ----------------------------------------
 * Unit tests for the valuation workspace services:
 * - Comp Grid Editor
 * - Income Approach
 * - Cost Approach
 * - Reconciliation
 */

import assert from 'node:assert/strict';

// Force in-memory DB via env before any imports
import { getDb, closeDb } from '../../server/db/database.js';

import {
  getCompGrid,
  getGridSummary,
  calculateIndicatedValue as gridIndicatedValue,
} from '../../server/comparableIntelligence/compGridService.js';

import {
  getIncomeAnalysis,
  saveRentComps,
  calculateGRM,
  saveExpenseWorksheet,
  calculateNetIncome,
  getIncomeIndicatedValue,
} from '../../server/comparableIntelligence/incomeApproachService.js';

import {
  getCostAnalysis,
  saveLandValue,
  saveReplacementCost,
  saveDepreciation,
  calculateIndicatedValue as costIndicatedValue,
  getFullCostSummary,
} from '../../server/comparableIntelligence/costApproachService.js';

import {
  getReconciliation,
  saveApproachValues,
  saveWeights,
  calculateFinalValue,
  saveReconciliationNarrative,
  getReconciliationSummary,
} from '../../server/comparableIntelligence/reconciliationService.js';

const suiteName = 'valuationWorkspace';
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  OK   ' + name);
    passed++;
  } catch (err) {
    console.error('  FAIL ' + name);
    console.error('       ' + err.message);
    failed++;
  }
}

console.log(suiteName);
console.log('─'.repeat(60));

const CASE_ID = 'test-valuation-case-001';

// ── Comp Grid Tests ──────────────────────────────────────────────────────────

test('getCompGrid returns empty grid for new case', () => {
  const grid = getCompGrid(CASE_ID);
  assert.equal(grid.caseId, CASE_ID);
  assert.deepEqual(grid.slots, {});
});

test('getCompGrid throws on missing caseId', () => {
  assert.throws(() => getCompGrid(null), /caseId is required/);
});

test('getGridSummary returns empty summary for new case', () => {
  const summary = getGridSummary(CASE_ID);
  assert.equal(summary.caseId, CASE_ID);
  assert.equal(summary.compCount, 0);
  assert.equal(summary.range.low, null);
  assert.equal(summary.range.high, null);
  assert.equal(summary.average, null);
});

test('gridIndicatedValue returns null for empty slot', () => {
  const result = gridIndicatedValue(CASE_ID, '1');
  assert.equal(result.gridSlot, '1');
  assert.equal(result.indicatedValue, null);
});

// ── Income Approach Tests ────────────────────────────────────────────────────

const INCOME_CASE = 'test-income-case-001';

test('getIncomeAnalysis returns defaults for new case', () => {
  const data = getIncomeAnalysis(INCOME_CASE);
  assert.equal(data.caseId, INCOME_CASE);
  assert.deepEqual(data.rentComps, []);
  assert.equal(data.grm, null);
  assert.equal(data.indicatedValue, null);
});

test('saveRentComps saves and derives monthly market rent', () => {
  const comps = [
    { address: '100 Main St', monthlyRent: 1500, gla: 1200, adjustedRent: 1600 },
    { address: '200 Oak Ave', monthlyRent: 1400, gla: 1100, adjustedRent: 1400 },
  ];
  const result = saveRentComps(INCOME_CASE, comps);
  assert.equal(result.success, true);
  assert.equal(result.rentCompCount, 2);
  assert.equal(result.monthlyMarketRent, 1500); // avg of 1600 and 1400

  const data = getIncomeAnalysis(INCOME_CASE);
  assert.equal(data.rentComps.length, 2);
  assert.equal(data.monthlyMarketRent, 1500);
});

test('saveRentComps throws on non-array', () => {
  assert.throws(() => saveRentComps(INCOME_CASE, 'bad'), /must be an array/);
});

test('calculateGRM computes from rent comps with salePrice', () => {
  const comps = [
    { address: '100 Main St', monthlyRent: 1000, salePrice: 150000 },
    { address: '200 Oak Ave', monthlyRent: 1200, salePrice: 180000 },
  ];
  saveRentComps(INCOME_CASE, comps);
  const result = calculateGRM(INCOME_CASE);
  // GRM: (150000/1000 + 180000/1200) / 2 = (150 + 150) / 2 = 150
  assert.equal(result.grm, 150);
  assert.equal(result.sampleSize, 2);
});

test('saveExpenseWorksheet saves expenses', () => {
  const expenses = { taxes: 3600, insurance: 1200, maintenance: 2400, vacancy: 1000 };
  const result = saveExpenseWorksheet(INCOME_CASE, expenses);
  assert.equal(result.success, true);

  const data = getIncomeAnalysis(INCOME_CASE);
  assert.equal(data.expenses.taxes, 3600);
});

test('calculateNetIncome computes correctly', () => {
  const result = calculateNetIncome(INCOME_CASE);
  // monthlyMarketRent = 1100 (avg of 1000 and 1200), gross = 13200
  // expenses = 3600 + 1200 + 2400 + 1000 = 8200
  // net = 13200 - 8200 = 5000
  assert.equal(result.grossIncome, 13200);
  assert.equal(result.totalExpenses, 8200);
  assert.equal(result.netIncome, 5000);
});

test('getIncomeIndicatedValue computes GRM * monthly rent', () => {
  const result = getIncomeIndicatedValue(INCOME_CASE);
  // GRM = 150, monthlyMarketRent = 1100
  assert.equal(result.indicatedValue, Math.round(150 * 1100));
});

// ── Cost Approach Tests ──────────────────────────────────────────────────────

const COST_CASE = 'test-cost-case-001';

test('getCostAnalysis returns defaults for new case', () => {
  const data = getCostAnalysis(COST_CASE);
  assert.equal(data.caseId, COST_CASE);
  assert.equal(data.landValue, null);
  assert.equal(data.indicatedValue, null);
});

test('saveLandValue persists land value', () => {
  const result = saveLandValue(COST_CASE, { landValue: 75000, source: 'comparable_sales' });
  assert.equal(result.success, true);
  assert.equal(result.landValue, 75000);

  const data = getCostAnalysis(COST_CASE);
  assert.equal(data.landValue, 75000);
  assert.equal(data.landValueSource, 'comparable_sales');
});

test('saveReplacementCost calculates RCN', () => {
  const result = saveReplacementCost(COST_CASE, {
    costPerSqft: 120,
    glaSqft: 1800,
    extras: [{ description: 'Garage', amount: 15000 }],
  });
  assert.equal(result.success, true);
  // 120 * 1800 + 15000 = 231000
  assert.equal(result.replacementCostNew, 231000);
});

test('saveDepreciation calculates total', () => {
  const result = saveDepreciation(COST_CASE, { physical: 20000, functional: 5000, external: 3000 });
  assert.equal(result.success, true);
  assert.equal(result.totalDepreciation, 28000);
});

test('costIndicatedValue calculates land + (RCN - depreciation) + site improvements', () => {
  const result = costIndicatedValue(COST_CASE);
  // land 75000 + (231000 - 28000) + 0 = 278000
  assert.equal(result.indicatedValue, 278000);
  assert.equal(result.landValue, 75000);
  assert.equal(result.replacementCostNew, 231000);
  assert.equal(result.totalDepreciation, 28000);
});

test('getFullCostSummary returns complete breakdown', () => {
  const summary = getFullCostSummary(COST_CASE);
  assert.equal(summary.caseId, COST_CASE);
  assert.equal(summary.depreciation.physical, 20000);
  assert.equal(summary.depreciation.total, 28000);
  assert.equal(summary.indicatedValue, 278000);
});

// ── Reconciliation Tests ─────────────────────────────────────────────────────

const RECON_CASE = 'test-recon-case-001';

test('getReconciliation returns defaults for new case', () => {
  const data = getReconciliation(RECON_CASE);
  assert.equal(data.caseId, RECON_CASE);
  assert.equal(data.finalOpinionValue, null);
});

test('saveApproachValues persists three approach values', () => {
  const result = saveApproachValues(RECON_CASE, {
    salesComparison: 300000,
    income: 290000,
    cost: 310000,
  });
  assert.equal(result.success, true);

  const data = getReconciliation(RECON_CASE);
  assert.equal(data.salesComparisonValue, 300000);
  assert.equal(data.incomeValue, 290000);
  assert.equal(data.costValue, 310000);
});

test('saveWeights rejects weights > 1.0', () => {
  assert.throws(
    () => saveWeights(RECON_CASE, { salesWeight: 0.6, incomeWeight: 0.3, costWeight: 0.2 }),
    /must sum to 1\.0 or less/
  );
});

test('saveWeights accepts valid weights', () => {
  const result = saveWeights(RECON_CASE, { salesWeight: 0.5, incomeWeight: 0.3, costWeight: 0.2 });
  assert.equal(result.success, true);
  assert.equal(result.totalWeight, 1.0);
});

test('calculateFinalValue computes weighted average', () => {
  const result = calculateFinalValue(RECON_CASE);
  // 300000*0.5 + 290000*0.3 + 310000*0.2 = 150000 + 87000 + 62000 = 299000
  assert.equal(result.finalOpinionValue, 299000);
  assert.equal(result.salesContribution, 150000);
  assert.equal(result.incomeContribution, 87000);
  assert.equal(result.costContribution, 62000);
});

test('saveReconciliationNarrative persists narrative', () => {
  const narrative = 'The sales comparison approach is given the most weight because...';
  const result = saveReconciliationNarrative(RECON_CASE, narrative);
  assert.equal(result.success, true);

  const data = getReconciliation(RECON_CASE);
  assert.equal(data.reconciliationNarrative, narrative);
});

test('getReconciliationSummary returns weighted contributions', () => {
  const summary = getReconciliationSummary(RECON_CASE);
  assert.equal(summary.caseId, RECON_CASE);
  assert.equal(summary.approaches.salesComparison.contribution, 150000);
  assert.equal(summary.totalWeight, 1.0);
  assert.equal(summary.finalOpinionValue, 299000);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('─'.repeat(60));
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
