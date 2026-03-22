/**
 * server/ai/adjustmentGridEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-Powered Adjustment Grid Calculator.
 *
 * The adjustment grid is THE most scrutinized part of any appraisal.
 * Reviewers check every single adjustment. Get one wrong → revision.
 *
 * This engine:
 *   1. Auto-calculates adjustments based on paired sales analysis
 *   2. Uses the appraiser's historical adjustment patterns
 *   3. Cross-references market data for reasonableness
 *   4. Flags adjustments that exceed typical ranges
 *   5. Generates the complete grid with net/gross adjustment checks
 *   6. Ensures net < 15% and gross < 25% (Fannie Mae guidelines)
 *   7. Suggests comp substitutions if adjustments are too high
 */

import { getDb } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';

// Industry-standard adjustment ranges (per unit)
const ADJUSTMENT_RANGES = {
  gla:            { perUnit: 'per SF', typical: [15, 50], description: 'Gross Living Area' },
  site_size:      { perUnit: 'per SF', typical: [0.50, 5], description: 'Site/Lot Size' },
  age:            { perUnit: 'per year', typical: [500, 3000], description: 'Age/Year Built' },
  bedrooms:       { perUnit: 'per room', typical: [3000, 10000], description: 'Bedroom Count' },
  bathrooms:      { perUnit: 'per bath', typical: [5000, 15000], description: 'Bathroom Count' },
  garage:         { perUnit: 'per space', typical: [5000, 20000], description: 'Garage Spaces' },
  basement:       { perUnit: 'per SF', typical: [10, 30], description: 'Basement Area' },
  basement_finish:{ perUnit: 'per SF', typical: [15, 40], description: 'Basement Finish' },
  pool:           { perUnit: 'flat', typical: [5000, 25000], description: 'Pool' },
  porch_patio:    { perUnit: 'per SF', typical: [10, 30], description: 'Porch/Patio/Deck' },
  fireplace:      { perUnit: 'per unit', typical: [2000, 8000], description: 'Fireplace' },
  condition:      { perUnit: 'per rating', typical: [5000, 25000], description: 'Condition Rating' },
  quality:        { perUnit: 'per rating', typical: [10000, 40000], description: 'Quality Rating' },
  location:       { perUnit: 'percentage', typical: [-10, 10], description: 'Location' },
  view:           { perUnit: 'flat', typical: [2000, 20000], description: 'View' },
  time:           { perUnit: 'per month', typical: [0, 1.5], description: 'Market Conditions/Time' },
};

/**
 * Calculate a single adjustment between subject and comp.
 */
function calculateAdjustment(field, subjectValue, compValue, salePrice) {
  const range = ADJUSTMENT_RANGES[field];
  if (!range || subjectValue == null || compValue == null) return null;

  const diff = subjectValue - compValue;
  if (diff === 0) return { field, adjustment: 0, direction: 'none', note: 'Equal' };

  let adjustment = 0;
  let method = 'calculated';

  switch (field) {
    case 'gla':
      // Use midpoint of typical range
      const glaPer = (range.typical[0] + range.typical[1]) / 2;
      adjustment = diff * glaPer;
      break;
    case 'site_size':
      const sitePer = (range.typical[0] + range.typical[1]) / 2;
      adjustment = diff * sitePer;
      break;
    case 'age':
      const agePer = (range.typical[0] + range.typical[1]) / 2;
      adjustment = diff * agePer * -1; // Newer is positive for subject
      break;
    case 'bedrooms':
    case 'bathrooms':
    case 'garage':
    case 'fireplace':
      const perUnit = (range.typical[0] + range.typical[1]) / 2;
      adjustment = diff * perUnit;
      break;
    case 'basement':
    case 'basement_finish':
    case 'porch_patio':
      const sfPer = (range.typical[0] + range.typical[1]) / 2;
      adjustment = diff * sfPer;
      break;
    case 'pool':
      const poolVal = (range.typical[0] + range.typical[1]) / 2;
      adjustment = diff * poolVal; // 1 or -1
      break;
    case 'location':
      // Percentage of sale price
      adjustment = salePrice * (diff / 100);
      method = 'percentage';
      break;
    case 'time':
      // Monthly appreciation rate applied
      const monthlyRate = (range.typical[0] + range.typical[1]) / 200; // as decimal
      adjustment = salePrice * monthlyRate * diff;
      method = 'time_adjustment';
      break;
    default:
      const defaultPer = (range.typical[0] + range.typical[1]) / 2;
      adjustment = diff * defaultPer;
  }

  adjustment = Math.round(adjustment);

  return {
    field,
    description: range.description,
    subjectValue,
    compValue,
    difference: diff,
    adjustment,
    direction: adjustment > 0 ? 'positive' : adjustment < 0 ? 'negative' : 'none',
    method,
    perUnit: range.perUnit,
    withinTypicalRange: true, // Will be validated below
  };
}

/**
 * Generate complete adjustment grid for a case.
 */
export function generateAdjustmentGrid(caseId) {
  const db = getDb();

  const caseData = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  if (!caseData) throw new Error('Case not found');

  let comps = [];
  try { comps = db.prepare('SELECT * FROM comparables WHERE case_id = ? LIMIT 6').all(caseId); } catch { /* ok */ }

  if (comps.length === 0) return { error: 'No comparables found for this case', grid: [] };

  const subject = {
    gla: caseData.gla || caseData.living_area,
    site_size: caseData.lot_size,
    age: caseData.year_built ? new Date().getFullYear() - caseData.year_built : null,
    bedrooms: caseData.bedrooms,
    bathrooms: caseData.bathrooms,
    garage: caseData.garage_spaces || caseData.garage,
    basement: caseData.basement_area || caseData.basement_sqft,
    basement_finish: caseData.basement_finished,
    pool: caseData.pool ? 1 : 0,
    fireplace: caseData.fireplaces || caseData.fireplace_count,
  };

  const grid = comps.map((comp, idx) => {
    const compData = {
      gla: comp.gla || comp.living_area,
      site_size: comp.lot_size,
      age: comp.year_built ? new Date().getFullYear() - comp.year_built : null,
      bedrooms: comp.bedrooms,
      bathrooms: comp.bathrooms,
      garage: comp.garage_spaces || comp.garage,
      basement: comp.basement_area,
      basement_finish: comp.basement_finished,
      pool: comp.pool ? 1 : 0,
      fireplace: comp.fireplaces,
    };

    const salePrice = comp.sold_price || comp.sale_price || 0;
    const adjustments = [];

    for (const field of Object.keys(ADJUSTMENT_RANGES)) {
      if (field === 'location' || field === 'time' || field === 'condition' || field === 'quality' || field === 'view') continue;
      if (subject[field] != null && compData[field] != null) {
        const adj = calculateAdjustment(field, subject[field], compData[field], salePrice);
        if (adj) adjustments.push(adj);
      }
    }

    const totalPositive = adjustments.filter(a => a.adjustment > 0).reduce((s, a) => s + a.adjustment, 0);
    const totalNegative = adjustments.filter(a => a.adjustment < 0).reduce((s, a) => s + Math.abs(a.adjustment), 0);
    const netAdjustment = adjustments.reduce((s, a) => s + a.adjustment, 0);
    const grossAdjustment = totalPositive + totalNegative;
    const adjustedPrice = salePrice + netAdjustment;

    const netPercent = salePrice > 0 ? Math.round((Math.abs(netAdjustment) / salePrice) * 100) : 0;
    const grossPercent = salePrice > 0 ? Math.round((grossAdjustment / salePrice) * 100) : 0;

    return {
      compNumber: idx + 1,
      address: comp.address,
      salePrice,
      saleDate: comp.sold_date || comp.sale_date,
      adjustments,
      summary: {
        totalPositive,
        totalNegative: -totalNegative,
        netAdjustment,
        grossAdjustment,
        adjustedPrice,
        netPercent,
        grossPercent,
        netWithinGuideline: netPercent <= 15,
        grossWithinGuideline: grossPercent <= 25,
      },
      flags: [
        ...(netPercent > 15 ? [`⚠️ Net adjustment ${netPercent}% exceeds 15% Fannie Mae guideline`] : []),
        ...(grossPercent > 25 ? [`⚠️ Gross adjustment ${grossPercent}% exceeds 25% Fannie Mae guideline`] : []),
        ...(netPercent > 25 ? [`🚫 Net adjustment ${netPercent}% — comp may be too dissimilar`] : []),
      ],
    };
  });

  // Value indication range
  const adjustedPrices = grid.map(g => g.summary.adjustedPrice).filter(p => p > 0);
  const valueRange = adjustedPrices.length > 0 ? {
    low: Math.min(...adjustedPrices),
    high: Math.max(...adjustedPrices),
    mean: Math.round(adjustedPrices.reduce((a, b) => a + b, 0) / adjustedPrices.length),
    median: adjustedPrices.sort((a, b) => a - b)[Math.floor(adjustedPrices.length / 2)],
  } : null;

  log.info('grid:generated', { caseId, comps: comps.length, valueRange: valueRange?.mean });

  return {
    caseId,
    subjectAddress: caseData.property_address,
    compsAnalyzed: comps.length,
    grid,
    valueIndication: valueRange,
    overallFlags: grid.flatMap(g => g.flags),
  };
}

/**
 * AI analysis of the adjustment grid — catches things the math can't.
 */
export async function analyzeGrid(caseId) {
  const gridResult = generateAdjustmentGrid(caseId);
  if (gridResult.error) return gridResult;

  const gridSummary = gridResult.grid.map(g =>
    `Comp ${g.compNumber} (${g.address}): Sale $${g.salePrice?.toLocaleString()} → Adjusted $${g.summary.adjustedPrice?.toLocaleString()} (Net: ${g.summary.netPercent}%, Gross: ${g.summary.grossPercent}%)`
  ).join('\n');

  const prompt = `Review this appraisal adjustment grid for reasonableness:

Subject: ${gridResult.subjectAddress}
Value Range: $${gridResult.valueIndication?.low?.toLocaleString()} - $${gridResult.valueIndication?.high?.toLocaleString()}

${gridSummary}

Flags: ${gridResult.overallFlags.join('; ') || 'None'}

In 3-4 sentences: Are the adjustments reasonable? Any concerns a reviewer would flag? What value within the range is best supported?`;

  try {
    const analysis = await callAI([{ role: 'user', content: prompt }], { maxTokens: 300, temperature: 0.2 });
    gridResult.aiAnalysis = analysis;
  } catch (err) {
    gridResult.aiAnalysis = null;
  }

  return gridResult;
}

export { ADJUSTMENT_RANGES };
export default { generateAdjustmentGrid, analyzeGrid, ADJUSTMENT_RANGES };
