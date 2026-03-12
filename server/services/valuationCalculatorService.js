/**
 * server/services/valuationCalculatorService.js
 * -----------------------------------------------
 * Phase H — Valuation Calculator Foundation
 *
 * Provides deterministic valuation computations:
 *   - Net and gross adjustment calculations per comp
 *   - Adjusted sale price derivation
 *   - Burden metrics (net/gross adjustment percentages)
 *   - Comp weighting and indicated value range
 *   - Income approach support (GRM computation)
 *   - Cost approach support (depreciation, indicated value)
 *   - Reconciliation support (weighted indication)
 *
 * This module COMPUTES — it does not DECIDE.
 * The appraiser retains control over:
 *   - final adjustment amounts
 *   - comp weighting
 *   - reconciliation emphasis
 *   - final opinion of value
 */

// ── Adjustment Calculator ────────────────────────────────────────────────────

/**
 * Parse a numeric value from various input formats.
 * Strips currency symbols, commas, and whitespace.
 *
 * @param {*} value
 * @returns {number|null}
 */
export function parseNumeric(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/[$,\s%]/g, '').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Compute net and gross adjustment metrics for a single comparable.
 *
 * @param {object} params
 * @param {number} params.salePrice - original sale price
 * @param {object} params.adjustments - { [category]: dollarAmount }
 * @returns {object} { netAdjustment, grossAdjustment, adjustedSalePrice, netPercent, grossPercent }
 */
export function computeCompAdjustments({ salePrice, adjustments }) {
  const price = parseNumeric(salePrice);
  if (!price || price <= 0) {
    return {
      salePrice: price,
      netAdjustment: 0,
      grossAdjustment: 0,
      adjustedSalePrice: null,
      netPercent: null,
      grossPercent: null,
      adjustmentCount: 0,
      adjustmentDetails: [],
    };
  }

  let net = 0;
  let gross = 0;
  const details = [];

  for (const [category, amount] of Object.entries(adjustments || {})) {
    const adj = parseNumeric(amount);
    if (adj === null || adj === 0) continue;
    net += adj;
    gross += Math.abs(adj);
    details.push({ category, amount: adj });
  }

  return {
    salePrice: price,
    netAdjustment: net,
    grossAdjustment: gross,
    adjustedSalePrice: price + net,
    netPercent: Math.round((Math.abs(net) / price) * 1000) / 10,
    grossPercent: Math.round((gross / price) * 1000) / 10,
    adjustmentCount: details.length,
    adjustmentDetails: details,
  };
}

/**
 * Compute burden metrics across all comps in the grid.
 * Flags comps with excessive adjustment percentages.
 *
 * @param {object[]} compMetrics - array of computeCompAdjustments results
 * @returns {object} burden summary
 */
export function computeBurdenMetrics(compMetrics) {
  const NET_THRESHOLD = 15;   // % — net adjustment warning
  const GROSS_THRESHOLD = 25; // % — gross adjustment warning
  const valid = (compMetrics || []).filter(c => c.adjustedSalePrice != null);

  const warnings = [];
  const compBurdens = valid.map((c, i) => {
    const label = `Comp ${i + 1}`;
    const burden = { label, ...c };
    if (c.netPercent != null && c.netPercent > NET_THRESHOLD) {
      warnings.push({ comp: label, type: 'net_adjustment_high', value: c.netPercent, threshold: NET_THRESHOLD });
    }
    if (c.grossPercent != null && c.grossPercent > GROSS_THRESHOLD) {
      warnings.push({ comp: label, type: 'gross_adjustment_high', value: c.grossPercent, threshold: GROSS_THRESHOLD });
    }
    return burden;
  });

  const adjustedPrices = valid.map(c => c.adjustedSalePrice).filter(p => p != null);
  const range = adjustedPrices.length > 0 ? {
    low: Math.min(...adjustedPrices),
    high: Math.max(...adjustedPrices),
    spread: Math.max(...adjustedPrices) - Math.min(...adjustedPrices),
  } : null;

  return {
    compCount: valid.length,
    compBurdens,
    warnings,
    adjustedPriceRange: range,
    averageNetPercent: valid.length > 0
      ? Math.round(valid.reduce((s, c) => s + (c.netPercent || 0), 0) / valid.length * 10) / 10
      : null,
    averageGrossPercent: valid.length > 0
      ? Math.round(valid.reduce((s, c) => s + (c.grossPercent || 0), 0) / valid.length * 10) / 10
      : null,
  };
}

// ── Comp Weighting ───────────────────────────────────────────────────────────

/**
 * Compute a suggested weighting for comps based on adjustment burden.
 * Lower-burden comps get higher weight.
 * Appraiser can override all weights.
 *
 * @param {object[]} compMetrics
 * @returns {object[]} weights array: [{ compIndex, suggestedWeight, reason }]
 */
export function suggestCompWeighting(compMetrics) {
  const valid = (compMetrics || []).filter(c => c.adjustedSalePrice != null);
  if (valid.length === 0) return [];

  // Inverse gross adjustment weighting — lower gross % = higher weight
  const totalInverse = valid.reduce((s, c) => {
    const gp = Math.max(c.grossPercent || 1, 1);
    return s + (1 / gp);
  }, 0);

  return valid.map((c, i) => {
    const gp = Math.max(c.grossPercent || 1, 1);
    const weight = totalInverse > 0 ? Math.round(((1 / gp) / totalInverse) * 100) : Math.round(100 / valid.length);
    const reasons = [];
    if (c.grossPercent != null && c.grossPercent <= 10) reasons.push('Low overall adjustment');
    if (c.grossPercent != null && c.grossPercent > 25) reasons.push('High overall adjustment');
    if (c.adjustmentCount <= 3) reasons.push('Few adjustments needed');
    return { compIndex: i, suggestedWeight: weight, adjustedPrice: c.adjustedSalePrice, reasons };
  });
}

/**
 * Compute the weighted indicated value from comps and their weights.
 *
 * @param {object[]} weightedComps - [{ adjustedPrice, weight }]
 * @returns {object} { indicatedValue, method }
 */
export function computeWeightedIndication(weightedComps) {
  const valid = (weightedComps || []).filter(c => c.adjustedPrice != null && c.weight != null);
  if (valid.length === 0) return { indicatedValue: null, method: 'none' };

  const totalWeight = valid.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return { indicatedValue: null, method: 'none' };

  const indicated = valid.reduce((s, c) => s + (c.adjustedPrice * (c.weight / totalWeight)), 0);
  return {
    indicatedValue: Math.round(indicated),
    method: 'weighted_average',
    components: valid.map(c => ({
      adjustedPrice: c.adjustedPrice,
      weight: c.weight,
      contribution: Math.round(c.adjustedPrice * (c.weight / totalWeight)),
    })),
  };
}

// ── Income Approach Support ──────────────────────────────────────────────────

/**
 * Compute the GRM-based indicated value.
 *
 * @param {object} params
 * @param {number} params.monthlyRent
 * @param {number} params.grm - Gross Rent Multiplier
 * @returns {object}
 */
export function computeIncomeApproachValue({ monthlyRent, grm }) {
  const rent = parseNumeric(monthlyRent);
  const multiplier = parseNumeric(grm);
  if (!rent || !multiplier || rent <= 0 || multiplier <= 0) {
    return { indicatedValue: null, method: 'grm', monthlyRent: rent, grm: multiplier };
  }
  return {
    indicatedValue: Math.round(rent * multiplier),
    method: 'grm',
    monthlyRent: rent,
    grm: multiplier,
    annualRent: rent * 12,
  };
}

/**
 * Compute a GRM from rent comparables.
 *
 * @param {object[]} rentComps - [{ salePrice, monthlyRent }]
 * @returns {object} { grm, compCount, details }
 */
export function deriveGRM(rentComps) {
  const valid = (rentComps || []).filter(c => {
    const price = parseNumeric(c.salePrice);
    const rent = parseNumeric(c.monthlyRent);
    return price && rent && price > 0 && rent > 0;
  });

  if (valid.length === 0) return { grm: null, compCount: 0, details: [] };

  const details = valid.map(c => {
    const price = parseNumeric(c.salePrice);
    const rent = parseNumeric(c.monthlyRent);
    return {
      salePrice: price,
      monthlyRent: rent,
      grm: Math.round((price / rent) * 10) / 10,
    };
  });

  const avgGrm = Math.round(details.reduce((s, d) => s + d.grm, 0) / details.length * 10) / 10;
  return { grm: avgGrm, compCount: details.length, details };
}

// ── Cost Approach Support ────────────────────────────────────────────────────

/**
 * Compute cost approach indicated value.
 *
 * @param {object} params
 * @param {number} params.siteValue
 * @param {number} params.dwellingCostNew
 * @param {number} [params.garageCarportCost]
 * @param {number} [params.otherCosts]
 * @param {number} params.totalDepreciation
 * @param {number} [params.siteImprovementsValue]
 * @returns {object}
 */
export function computeCostApproachValue({
  siteValue,
  dwellingCostNew,
  garageCarportCost = 0,
  otherCosts = 0,
  totalDepreciation,
  siteImprovementsValue = 0,
}) {
  const site = parseNumeric(siteValue);
  const dwelling = parseNumeric(dwellingCostNew);
  const garage = parseNumeric(garageCarportCost) || 0;
  const other = parseNumeric(otherCosts) || 0;
  const depreciation = parseNumeric(totalDepreciation) || 0;
  const siteImp = parseNumeric(siteImprovementsValue) || 0;

  if (!site || !dwelling) {
    return { indicatedValue: null, method: 'cost' };
  }

  const totalCostNew = dwelling + garage + other;
  const depreciatedCost = totalCostNew - depreciation;
  const indicatedValue = site + Math.max(depreciatedCost, 0) + siteImp;

  return {
    indicatedValue: Math.round(indicatedValue),
    method: 'cost',
    siteValue: site,
    totalCostNew,
    totalDepreciation: depreciation,
    depreciatedCost: Math.max(depreciatedCost, 0),
    siteImprovementsValue: siteImp,
    breakdown: {
      dwelling,
      garage,
      other,
    },
  };
}

// ── Reconciliation Support ───────────────────────────────────────────────────

/**
 * Build a reconciliation support object from the three approach values.
 *
 * @param {object} params
 * @param {number|null} params.salesComparisonValue
 * @param {number|null} params.costApproachValue
 * @param {number|null} params.incomeApproachValue
 * @param {object} [params.weights] - { salesComparison, costApproach, incomeApproach }
 * @returns {object}
 */
export function buildReconciliationSupport({
  salesComparisonValue,
  costApproachValue,
  incomeApproachValue,
  weights = {},
}) {
  const sc = parseNumeric(salesComparisonValue);
  const ca = parseNumeric(costApproachValue);
  const ia = parseNumeric(incomeApproachValue);

  const approaches = [];
  if (sc != null) approaches.push({ name: 'Sales Comparison', value: sc, weight: weights.salesComparison || 0 });
  if (ca != null) approaches.push({ name: 'Cost Approach', value: ca, weight: weights.costApproach || 0 });
  if (ia != null) approaches.push({ name: 'Income Approach', value: ia, weight: weights.incomeApproach || 0 });

  const values = approaches.map(a => a.value).filter(v => v != null);
  const range = values.length > 0 ? {
    low: Math.min(...values),
    high: Math.max(...values),
    spread: Math.max(...values) - Math.min(...values),
  } : null;

  // Compute weighted indication if weights provided
  const totalWeight = approaches.reduce((s, a) => s + (a.weight || 0), 0);
  let weightedValue = null;
  if (totalWeight > 0) {
    weightedValue = Math.round(
      approaches.reduce((s, a) => s + (a.value * (a.weight / totalWeight)), 0)
    );
  }

  const supportStrength = [];
  if (sc != null) supportStrength.push({ approach: 'Sales Comparison', reliability: 'primary', reason: 'Most directly market-derived' });
  if (ca != null) supportStrength.push({ approach: 'Cost Approach', reliability: 'supportive', reason: 'Supports replacement cost basis' });
  if (ia != null) supportStrength.push({ approach: 'Income Approach', reliability: 'supportive', reason: 'Supports investment/rental value basis' });

  return {
    approaches,
    range,
    weightedValue,
    approachCount: approaches.length,
    supportStrength,
    reconciliationReady: approaches.length >= 1,
  };
}
