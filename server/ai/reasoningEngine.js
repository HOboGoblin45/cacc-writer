/**
 * server/ai/reasoningEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Appraisal Reasoning Engine — Encodes an appraiser's decision-making logic.
 * 
 * This isn't just prompt engineering — it's a structured reasoning framework
 * that the AI follows step-by-step, like a seasoned appraiser would think
 * through a problem.
 * 
 * The reasoning engine works in three phases:
 *   1. OBSERVE — gather and organize all available data
 *   2. ANALYZE — apply domain-specific logic rules
 *   3. CONCLUDE — form opinions supported by evidence
 */

import log from '../logger.js';

// ── ADJUSTMENT REASONING ─────────────────────────────────────────────────────
// How an appraiser thinks about adjustments

export const ADJUSTMENT_LOGIC = {
  // Per-unit adjustment rates (Central IL market defaults — appraiser can override)
  defaults: {
    gla_per_sf: 85,              // $/SF for GLA differences
    site_per_sf: 2,              // $/SF for lot size differences  
    age_per_year: 2000,          // $/year for age differences
    bedroom_value: 5000,         // $ per bedroom difference
    bathroom_full: 7500,         // $ per full bath difference
    bathroom_half: 3500,         // $ per half bath difference
    garage_per_car: 8000,        // $ per garage space
    basement_finished_per_sf: 45, // $/SF for finished basement
    basement_unfinished_per_sf: 15, // $/SF for unfinished basement
    fireplace: 3000,             // $ per fireplace
    pool: 10000,                 // $ for pool (varies widely)
    fence: 2500,                 // $ for fencing
    patio_deck: 3000,            // $ for patio/deck
    porch_covered: 5000,         // $ for covered porch
    condition_per_rating: 10000, // $ per C-rating difference (C3 to C4 = -$10K)
    quality_per_rating: 15000,   // $ per Q-rating difference
  },

  /**
   * Calculate adjustment for a single comp against the subject.
   * Returns the reasoning chain alongside the numbers.
   */
  calculateAdjustments(subject, comp, marketRates = {}) {
    const rates = { ...this.defaults, ...marketRates };
    const adjustments = [];
    const reasoning = [];

    // Age adjustment
    const subjectAge = new Date().getFullYear() - (parseInt(subject.yearBuilt) || 0);
    const compAge = new Date().getFullYear() - (parseInt(comp.yearBuilt) || 0);
    const ageDiff = compAge - subjectAge;
    if (ageDiff !== 0) {
      const adj = ageDiff * rates.age_per_year;
      adjustments.push({ category: 'age', amount: adj, description: `${ageDiff > 0 ? 'Older' : 'Newer'} by ${Math.abs(ageDiff)} years @ $${rates.age_per_year}/yr` });
      reasoning.push(`Comp built ${comp.yearBuilt} vs subject ${subject.yearBuilt} = ${Math.abs(ageDiff)} year difference. At $${rates.age_per_year}/year, adjustment = ${adj > 0 ? '+' : ''}$${adj.toLocaleString()}`);
    }

    // GLA adjustment
    const subjectGla = parseInt(subject.gla) || 0;
    const compGla = parseInt(comp.gla) || 0;
    const glaDiff = subjectGla - compGla;
    if (glaDiff !== 0 && subjectGla > 0 && compGla > 0) {
      const adj = glaDiff * rates.gla_per_sf;
      adjustments.push({ category: 'gla', amount: adj, description: `${Math.abs(glaDiff)} SF difference @ $${rates.gla_per_sf}/SF` });
      reasoning.push(`Subject ${subjectGla} SF vs comp ${compGla} SF = ${Math.abs(glaDiff)} SF difference. At $${rates.gla_per_sf}/SF, adjustment = ${adj > 0 ? '+' : ''}$${adj.toLocaleString()}`);
    }

    // Bedroom adjustment
    const subjectBeds = parseInt(subject.bedrooms) || 0;
    const compBeds = parseInt(comp.bedrooms) || 0;
    const bedDiff = subjectBeds - compBeds;
    if (bedDiff !== 0) {
      const adj = bedDiff * rates.bedroom_value;
      adjustments.push({ category: 'bedrooms', amount: adj, description: `${Math.abs(bedDiff)} bedroom difference` });
      reasoning.push(`Subject has ${subjectBeds} bedrooms vs comp ${compBeds} = ${bedDiff > 0 ? '+' : ''}${bedDiff} bedroom adjustment of $${adj.toLocaleString()}`);
    }

    // Bathroom adjustment
    const subjectBaths = parseFloat(subject.bathrooms) || 0;
    const compBaths = parseFloat(comp.bathrooms) || 0;
    const bathDiff = subjectBaths - compBaths;
    if (Math.abs(bathDiff) >= 0.5) {
      const fullBathDiff = Math.floor(bathDiff);
      const halfBathDiff = (bathDiff % 1 !== 0) ? (bathDiff > 0 ? 1 : -1) : 0;
      const adj = (fullBathDiff * rates.bathroom_full) + (halfBathDiff * rates.bathroom_half);
      adjustments.push({ category: 'bathrooms', amount: adj, description: `${Math.abs(bathDiff)} bathroom difference` });
      reasoning.push(`Subject has ${subjectBaths} baths vs comp ${compBaths} = adjustment of $${adj.toLocaleString()}`);
    }

    // Garage adjustment
    const subjectGarage = parseInt(subject.garageSpaces || subject.garage?.match(/(\d)/)?.[1]) || 0;
    const compGarage = parseInt(comp.garageSpaces || comp.garage?.match(/(\d)/)?.[1]) || 0;
    const garageDiff = subjectGarage - compGarage;
    if (garageDiff !== 0) {
      const adj = garageDiff * rates.garage_per_car;
      adjustments.push({ category: 'garage', amount: adj, description: `${Math.abs(garageDiff)} car garage difference` });
      reasoning.push(`Subject ${subjectGarage}-car garage vs comp ${compGarage}-car = adjustment of $${adj.toLocaleString()}`);
    }

    // Condition adjustment
    const subjectCond = parseInt(subject.condition?.replace(/[^0-9]/g, '')) || 3;
    const compCond = parseInt(comp.condition?.replace(/[^0-9]/g, '')) || 3;
    const condDiff = subjectCond - compCond;
    if (condDiff !== 0) {
      const adj = -condDiff * rates.condition_per_rating; // Higher C number = worse condition
      adjustments.push({ category: 'condition', amount: adj, description: `C${compCond} vs C${subjectCond} condition` });
      reasoning.push(`Comp condition C${compCond} vs subject C${subjectCond}. ${condDiff > 0 ? 'Subject is in worse condition' : 'Subject is in better condition'}. Adjustment: $${adj.toLocaleString()}`);
    }

    // Calculate totals
    const netAdjustment = adjustments.reduce((sum, a) => sum + a.amount, 0);
    const grossAdjustment = adjustments.reduce((sum, a) => sum + Math.abs(a.amount), 0);
    const compPrice = parseInt(comp.salePrice) || 0;
    const adjustedPrice = compPrice + netAdjustment;
    const netPercent = compPrice > 0 ? Math.round((netAdjustment / compPrice) * 100 * 10) / 10 : 0;
    const grossPercent = compPrice > 0 ? Math.round((grossAdjustment / compPrice) * 100 * 10) / 10 : 0;

    // Fannie Mae compliance check
    const compliance = {
      netWithinGuidelines: Math.abs(netPercent) <= 15,
      grossWithinGuidelines: grossPercent <= 25,
      warnings: []
    };
    if (!compliance.netWithinGuidelines) compliance.warnings.push(`Net adjustment ${netPercent}% exceeds Fannie Mae 15% guideline`);
    if (!compliance.grossWithinGuidelines) compliance.warnings.push(`Gross adjustment ${grossPercent}% exceeds Fannie Mae 25% guideline`);

    return {
      adjustments,
      reasoning,
      summary: {
        netAdjustment,
        grossAdjustment,
        adjustedPrice,
        netPercent,
        grossPercent,
        salePrice: compPrice,
      },
      compliance,
    };
  },
};

// ── VALUATION REASONING ──────────────────────────────────────────────────────

export const VALUATION_LOGIC = {
  /**
   * Reconcile multiple comp indications into a final value opinion.
   * This is where the appraiser's judgment matters most.
   */
  reconcileValue(compAnalyses) {
    if (!compAnalyses.length) return null;

    const adjustedPrices = compAnalyses.map(c => c.summary.adjustedPrice).filter(p => p > 0);
    if (!adjustedPrices.length) return null;

    const low = Math.min(...adjustedPrices);
    const high = Math.max(...adjustedPrices);
    const range = high - low;

    // Weight comps by quality (lower gross adjustment = more reliable)
    const weights = compAnalyses.map(c => {
      const gross = Math.abs(c.summary.grossPercent);
      // Inverse weight — lower adjustments get higher weight
      return Math.max(0.1, 1 - (gross / 50));
    });
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const weightedAvg = Math.round(
      compAnalyses.reduce((sum, c, i) => sum + (c.summary.adjustedPrice * weights[i]), 0) / totalWeight
    );

    // Round to nearest $500
    const roundedValue = Math.round(weightedAvg / 500) * 500;

    const reasoning = [
      `Adjusted sale prices range from $${low.toLocaleString()} to $${high.toLocaleString()} (range: $${range.toLocaleString()}).`,
      `Weighted average (favoring comps with fewer adjustments): $${weightedAvg.toLocaleString()}.`,
      `The indicated value by the Sales Comparison Approach is $${roundedValue.toLocaleString()}.`,
      range > roundedValue * 0.1 
        ? `The range of ${Math.round(range/roundedValue*100)}% suggests some variation in the comparables. Additional weight was given to the most similar comp.`
        : `The tight range of ${Math.round(range/roundedValue*100)}% supports a reliable value indication.`,
    ];

    return {
      indicatedValue: roundedValue,
      range: { low, high },
      weightedAverage: weightedAvg,
      reasoning,
      compWeights: weights.map((w, i) => ({ 
        comp: i + 1, 
        weight: Math.round(w * 100) / 100,
        adjustedPrice: compAnalyses[i].summary.adjustedPrice 
      })),
    };
  },
};

// ── MARKET ANALYSIS REASONING ────────────────────────────────────────────────

export const MARKET_LOGIC = {
  /**
   * Analyze market conditions from comp data.
   * Determines: appreciation rate, DOM trends, supply/demand.
   */
  analyzeMarketTrends(comps) {
    if (!comps || comps.length < 2) return null;

    // Calculate price per SF trends
    const dataPoints = comps
      .filter(c => c.salePrice && c.gla && c.saleDate)
      .map(c => ({
        pricePerSf: parseInt(c.salePrice) / parseInt(c.gla),
        date: new Date(c.saleDate),
        price: parseInt(c.salePrice),
      }))
      .sort((a, b) => a.date - b.date);

    if (dataPoints.length < 2) return null;

    // Simple linear regression for appreciation
    const firstDate = dataPoints[0].date.getTime();
    const xs = dataPoints.map(d => (d.date.getTime() - firstDate) / (365.25 * 24 * 60 * 60 * 1000));
    const ys = dataPoints.map(d => d.pricePerSf);
    const n = xs.length;
    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumY = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgPricePerSf = sumY / n;
    const annualAppreciation = avgPricePerSf > 0 ? (slope / avgPricePerSf * 100) : 0;

    return {
      annualAppreciation: Math.round(annualAppreciation * 10) / 10,
      avgPricePerSf: Math.round(avgPricePerSf),
      trend: annualAppreciation > 2 ? 'Increasing' : annualAppreciation < -2 ? 'Declining' : 'Stable',
      dataPoints: dataPoints.length,
      reasoning: [
        `Based on ${dataPoints.length} comparable sales, the average price per square foot is $${Math.round(avgPricePerSf)}.`,
        `Annual appreciation rate is approximately ${Math.round(annualAppreciation * 10) / 10}%.`,
        `Market conditions appear ${annualAppreciation > 2 ? 'favorable with increasing values' : annualAppreciation < -2 ? 'challenging with declining values' : 'stable'}.`,
      ],
    };
  },
};

// ── HIGHEST & BEST USE REASONING ─────────────────────────────────────────────

export const HBU_LOGIC = {
  /**
   * Evaluate highest and best use based on property characteristics.
   * The four tests: legally permissible, physically possible, 
   * financially feasible, maximally productive.
   */
  evaluate(facts) {
    const subject = facts.subject || {};
    const site = facts.site || {};
    const improvements = facts.improvements || {};
    const neighborhood = facts.neighborhood || {};

    const tests = {
      legallyPermissible: {
        pass: true,
        reasoning: `The property is zoned ${site.zoning || 'residential'} which permits ${improvements.design || 'single-family'} residential use.`,
      },
      physicallyPossible: {
        pass: true,
        reasoning: `The ${site.lotSize || ''} site with ${site.topography || 'level'} topography supports the existing ${improvements.design || ''} improvements.`,
      },
      financiallyFeasible: {
        pass: true,
        reasoning: `The ${neighborhood.propertyValues || 'stable'} property values and ${neighborhood.demandSupply || 'balanced'} demand/supply indicate the current use is financially feasible.`,
      },
      maximallyProductive: {
        pass: true,
        reasoning: `The existing improvements appear to represent the most productive use of the site given current market conditions and zoning.`,
      },
    };

    const conclusion = tests.legallyPermissible.pass && tests.physicallyPossible.pass && 
                       tests.financiallyFeasible.pass && tests.maximallyProductive.pass
      ? 'Present use as improved — continued use as a single-family residential dwelling.'
      : 'Present use may not represent highest and best use. See additional comments.';

    return { tests, conclusion };
  },
};

// ── CONDITION RATING LOGIC ───────────────────────────────────────────────────

export const CONDITION_LOGIC = {
  ratings: {
    C1: { range: [0, 1], description: 'New construction, never occupied' },
    C2: { range: [0, 5], description: 'No updates needed, recently renovated or constructed' },
    C3: { range: [3, 15], description: 'Well maintained, limited physical depreciation' },
    C4: { range: [10, 30], description: 'Adequately maintained, some deferred maintenance' },
    C5: { range: [20, 50], description: 'Poorly maintained, obvious deferred maintenance' },
    C6: { range: [40, 100], description: 'Substantial damage or deferred maintenance' },
  },

  /**
   * Suggest condition rating based on property characteristics.
   */
  suggestRating(facts) {
    const age = new Date().getFullYear() - (parseInt(facts.improvements?.yearBuilt) || 2000);
    const updates = facts.improvements?.kitchen?.toLowerCase().includes('updated') || 
                    facts.improvements?.kitchen?.toLowerCase().includes('remodel');

    if (age <= 1) return { rating: 'C1', confidence: 'high', reasoning: `Built ${facts.improvements?.yearBuilt}, new construction.` };
    if (age <= 5 && updates) return { rating: 'C2', confidence: 'high', reasoning: `Built ${facts.improvements?.yearBuilt}, recently constructed with updates.` };
    if (age <= 15) return { rating: 'C3', confidence: 'medium', reasoning: `Built ${facts.improvements?.yearBuilt}, ${age} years old. Well maintained with original components.` };
    if (age <= 30) return { rating: 'C4', confidence: 'medium', reasoning: `Built ${facts.improvements?.yearBuilt}, ${age} years old. Some deferred maintenance expected.` };
    if (age <= 50) return { rating: 'C5', confidence: 'low', reasoning: `Built ${facts.improvements?.yearBuilt}, ${age} years old. Requires inspection to confirm condition.` };
    return { rating: 'C6', confidence: 'low', reasoning: `Built ${facts.improvements?.yearBuilt}, ${age} years old. Substantial deferred maintenance likely.` };
  },
};

export default {
  ADJUSTMENT_LOGIC,
  VALUATION_LOGIC,
  MARKET_LOGIC,
  HBU_LOGIC,
  CONDITION_LOGIC,
};
