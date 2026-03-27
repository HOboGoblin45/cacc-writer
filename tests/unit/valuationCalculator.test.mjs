/**
 * tests/unit/valuationCalculator.test.mjs
 * ------------------------------------------
 * Unit tests for the valuation calculator service (Phase H).
 */

import assert from 'node:assert/strict';

import {
  parseNumeric,
  computeCompAdjustments,
  computeBurdenMetrics,
  suggestCompWeighting,
  computeWeightedIndication,
  computeIncomeApproachValue,
  deriveGRM,
  computeCostApproachValue,
  buildReconciliationSupport,
} from '../../server/services/valuationCalculatorService.js';

const suiteName = 'valuationCalculator';
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error('     ', err.message);
    failed++;
  }
}

console.log(suiteName);
console.log('─'.repeat(60));

// ── parseNumeric ────────────────────────────────────────────────────────────

test('parseNumeric handles plain numbers', () => {
  assert.equal(parseNumeric(250000), 250000);
  assert.equal(parseNumeric(0), 0);
});

test('parseNumeric handles currency strings', () => {
  assert.equal(parseNumeric('$250,000'), 250000);
  assert.equal(parseNumeric('$ 1,500.50'), 1500.5);
});

test('parseNumeric returns null for empty/null', () => {
  assert.equal(parseNumeric(null), null);
  assert.equal(parseNumeric(''), null);
  assert.equal(parseNumeric(undefined), null);
});

// ── computeCompAdjustments ──────────────────────────────────────────────────

test('computeCompAdjustments calculates correctly', () => {
  const result = computeCompAdjustments({
    salePrice: 300000,
    adjustments: {
      location: 5000,
      gla: -3000,
      condition: 2000,
    },
  });
  assert.equal(result.salePrice, 300000);
  assert.equal(result.netAdjustment, 4000);
  assert.equal(result.grossAdjustment, 10000);
  assert.equal(result.adjustedSalePrice, 304000);
  assert.equal(result.adjustmentCount, 3);
});

test('computeCompAdjustments handles zero sale price', () => {
  const result = computeCompAdjustments({ salePrice: 0, adjustments: { gla: 5000 } });
  assert.equal(result.adjustedSalePrice, null);
});

test('computeCompAdjustments handles no adjustments', () => {
  const result = computeCompAdjustments({ salePrice: 300000, adjustments: {} });
  assert.equal(result.adjustedSalePrice, 300000);
  assert.equal(result.netAdjustment, 0);
});

// ── computeBurdenMetrics ────────────────────────────────────────────────────

test('computeBurdenMetrics summarizes comps', () => {
  const comps = [
    computeCompAdjustments({ salePrice: 300000, adjustments: { location: 5000, gla: -3000 } }),
    computeCompAdjustments({ salePrice: 310000, adjustments: { condition: -10000 } }),
    computeCompAdjustments({ salePrice: 295000, adjustments: { gla: 2000 } }),
  ];
  const burden = computeBurdenMetrics(comps);
  assert.equal(burden.compCount, 3);
  assert.ok(burden.adjustedPriceRange);
  assert.ok(burden.adjustedPriceRange.low > 0);
  assert.ok(burden.adjustedPriceRange.high > burden.adjustedPriceRange.low);
});

test('computeBurdenMetrics warns on high adjustment', () => {
  const comps = [
    computeCompAdjustments({ salePrice: 100000, adjustments: { everything: 30000 } }),
  ];
  const burden = computeBurdenMetrics(comps);
  assert.ok(burden.warnings.length > 0);
});

// ── suggestCompWeighting ────────────────────────────────────────────────────

test('suggestCompWeighting gives higher weight to lower-burden comps', () => {
  const comps = [
    computeCompAdjustments({ salePrice: 300000, adjustments: { gla: 1000 } }), // low burden
    computeCompAdjustments({ salePrice: 300000, adjustments: { gla: 50000, condition: -20000 } }), // high burden
  ];
  const weights = suggestCompWeighting(comps);
  assert.equal(weights.length, 2);
  assert.ok(weights[0].suggestedWeight > weights[1].suggestedWeight);
});

// ── computeWeightedIndication ───────────────────────────────────────────────

test('computeWeightedIndication computes weighted average', () => {
  const result = computeWeightedIndication([
    { adjustedPrice: 300000, weight: 50 },
    { adjustedPrice: 310000, weight: 30 },
    { adjustedPrice: 290000, weight: 20 },
  ]);
  assert.ok(result.indicatedValue);
  assert.equal(result.method, 'weighted_average');
  // Should be close to 300000 (weighted toward comp 1)
  assert.ok(result.indicatedValue >= 295000 && result.indicatedValue <= 310000);
});

test('computeWeightedIndication handles empty', () => {
  const result = computeWeightedIndication([]);
  assert.equal(result.indicatedValue, null);
});

// ── Income Approach ─────────────────────────────────────────────────────────

test('computeIncomeApproachValue from GRM', () => {
  const result = computeIncomeApproachValue({ monthlyRent: 1500, grm: 180 });
  assert.equal(result.indicatedValue, 270000);
  assert.equal(result.method, 'grm');
  assert.equal(result.annualRent, 18000);
});

test('deriveGRM from rent comparables', () => {
  const result = deriveGRM([
    { salePrice: 270000, monthlyRent: 1500 },
    { salePrice: 288000, monthlyRent: 1600 },
  ]);
  assert.ok(result.grm);
  assert.equal(result.compCount, 2);
  assert.ok(result.grm >= 170 && result.grm <= 185);
});

// ── Cost Approach ───────────────────────────────────────────────────────────

test('computeCostApproachValue calculates correctly', () => {
  const result = computeCostApproachValue({
    siteValue: 80000,
    dwellingCostNew: 250000,
    garageCarportCost: 20000,
    otherCosts: 5000,
    totalDepreciation: 50000,
    siteImprovementsValue: 10000,
  });
  // totalCostNew = 275000, depreciated = 225000, indicated = 80000 + 225000 + 10000 = 315000
  assert.equal(result.indicatedValue, 315000);
  assert.equal(result.method, 'cost');
  assert.equal(result.totalCostNew, 275000);
});

test('computeCostApproachValue handles missing site value', () => {
  const result = computeCostApproachValue({ dwellingCostNew: 250000, totalDepreciation: 50000 });
  assert.equal(result.indicatedValue, null);
});

// ── Reconciliation ──────────────────────────────────────────────────────────

test('buildReconciliationSupport aggregates approaches', () => {
  const result = buildReconciliationSupport({
    salesComparisonValue: 300000,
    costApproachValue: 310000,
    incomeApproachValue: 280000,
    weights: { salesComparison: 60, costApproach: 20, incomeApproach: 20 },
  });
  assert.equal(result.approachCount, 3);
  assert.ok(result.range);
  assert.equal(result.range.low, 280000);
  assert.equal(result.range.high, 310000);
  assert.ok(result.weightedValue);
  assert.equal(result.reconciliationReady, true);
});

test('buildReconciliationSupport handles single approach', () => {
  const result = buildReconciliationSupport({
    salesComparisonValue: 300000,
  });
  assert.equal(result.approachCount, 1);
  assert.equal(result.reconciliationReady, true);
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('─'.repeat(60));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
