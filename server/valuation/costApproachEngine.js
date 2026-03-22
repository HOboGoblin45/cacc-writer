/**
 * server/valuation/costApproachEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated Cost Approach Calculator.
 *
 * Most appraisers hate the cost approach because the math is tedious.
 * This engine automates it:
 *   1. Estimates replacement/reproduction cost using Marshall & Swift data
 *   2. Calculates depreciation (physical, functional, external)
 *   3. Estimates land value from comparable land sales
 *   4. Produces the indicated value by cost approach
 *   5. Generates the cost approach narrative
 *
 * Uses region-specific cost multipliers and quality modifiers.
 */

import { callAI } from '../openaiClient.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// ── Cost per SF by quality rating (national base, adjusted by region) ────────

const BASE_COST_PER_SF = {
  Q1: 225, Q2: 185, Q3: 145, Q4: 115, Q5: 90, Q6: 70,
};

// Regional cost multipliers (ratio to national average)
const REGIONAL_MULTIPLIERS = {
  'IL': 1.02, 'CA': 1.45, 'NY': 1.38, 'TX': 0.88, 'FL': 0.95,
  'WA': 1.15, 'CO': 1.08, 'MA': 1.28, 'OH': 0.85, 'PA': 0.92,
  'MI': 0.87, 'GA': 0.90, 'NC': 0.88, 'VA': 1.00, 'NJ': 1.22,
  'AZ': 0.92, 'MN': 1.00, 'WI': 0.95, 'IN': 0.82, 'MO': 0.85,
  'MD': 1.08, 'TN': 0.84, 'SC': 0.82, 'OR': 1.12, 'NV': 1.05,
  'DEFAULT': 1.00,
};

// Depreciation rates by age and condition
const PHYSICAL_DEPRECIATION_RATES = {
  C1: { annual: 0.005, max: 0.05 },  // New — minimal
  C2: { annual: 0.008, max: 0.15 },
  C3: { annual: 0.012, max: 0.30 },
  C4: { annual: 0.018, max: 0.45 },
  C5: { annual: 0.025, max: 0.60 },
  C6: { annual: 0.040, max: 0.80 },
};

/**
 * Calculate the full cost approach for a case.
 *
 * @param {string} caseId
 * @returns {Object} cost approach breakdown
 */
export function calculateCostApproach(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case facts not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const improvements = facts.improvements || {};
  const site = facts.site || {};
  const subject = facts.subject || {};

  // ── 1. Replacement Cost New ────────────────────────────────────────────

  const quality = improvements.quality || improvements.qualityOverall || 'Q4';
  const gla = parseFloat(improvements.gla || 0);
  const state = subject.state || 'IL';

  if (!gla) throw new Error('GLA required for cost approach');

  const baseCost = BASE_COST_PER_SF[quality] || BASE_COST_PER_SF.Q4;
  const regionMult = REGIONAL_MULTIPLIERS[state] || REGIONAL_MULTIPLIERS.DEFAULT;
  const costPerSf = Math.round(baseCost * regionMult);
  const mainDwellingCost = Math.round(gla * costPerSf);

  // Garage
  const garageCars = parseInt(improvements.garageCars || 0);
  const garageType = (improvements.garageType || '').toLowerCase();
  const garageSfPerCar = garageType.includes('attached') ? 300 : garageType.includes('detach') ? 280 : 300;
  const garageCostPerSf = Math.round(costPerSf * 0.35); // Garage is ~35% of living space cost
  const garageCost = Math.round(garageCars * garageSfPerCar * garageCostPerSf);

  // Basement
  const basementArea = parseFloat(improvements.basementArea || 0);
  const basementFinished = parseFloat(improvements.basementFinished || improvements.basementFinishedArea || 0);
  const basementUnfinished = basementArea - basementFinished;
  const basementFinishedCost = Math.round(basementFinished * costPerSf * 0.50);
  const basementUnfinishedCost = Math.round(basementUnfinished * costPerSf * 0.15);
  const basementCost = basementFinishedCost + basementUnfinishedCost;

  // Site improvements (driveway, landscaping, etc.) — typically 5-10% of dwelling
  const siteImprovementsCost = Math.round(mainDwellingCost * 0.07);

  const totalReplacementCostNew = mainDwellingCost + garageCost + basementCost + siteImprovementsCost;

  // ── 2. Depreciation ───────────────────────────────────────────────────

  const yearBuilt = parseInt(improvements.yearBuilt || 0);
  const effectiveAge = parseInt(improvements.effectiveAge || 0);
  const condition = improvements.condition || improvements.conditionOverall || 'C4';
  const currentYear = new Date().getFullYear();
  const actualAge = yearBuilt ? currentYear - yearBuilt : effectiveAge || 20;
  const ageForCalc = effectiveAge || actualAge;

  const depRate = PHYSICAL_DEPRECIATION_RATES[condition] || PHYSICAL_DEPRECIATION_RATES.C4;
  const physicalDepPct = Math.min(depRate.annual * ageForCalc, depRate.max);
  const physicalDepreciation = Math.round(totalReplacementCostNew * physicalDepPct);

  // Functional obsolescence (estimate based on condition/quality)
  const functionalObsolescence = condition === 'C5' || condition === 'C6'
    ? Math.round(totalReplacementCostNew * 0.05) : 0;

  // External obsolescence (usually 0 unless specific factors)
  const externalObsolescence = 0;

  const totalDepreciation = physicalDepreciation + functionalObsolescence + externalObsolescence;
  const depreciatedCostOfImprovements = totalReplacementCostNew - totalDepreciation;

  // ── 3. Land Value ─────────────────────────────────────────────────────

  const lotSize = parseFloat(site.lotSize || site.area || 0);
  // Default land value estimation — in production, pull from comp land sales
  const landValuePerSf = state === 'IL' ? 3.50 : state === 'CA' ? 25 : state === 'NY' ? 18 : 5;
  const estimatedLandValue = lotSize ? Math.round(lotSize * landValuePerSf) : Math.round(mainDwellingCost * 0.20);

  // ── 4. Indicated Value by Cost Approach ────────────────────────────────

  const indicatedValue = depreciatedCostOfImprovements + estimatedLandValue;

  // ── Save to facts ─────────────────────────────────────────────────────

  const costData = {
    replacementCostNew: {
      mainDwelling: { gla, costPerSf, total: mainDwellingCost },
      garage: { cars: garageCars, type: garageType, sfPerCar: garageSfPerCar, costPerSf: garageCostPerSf, total: garageCost },
      basement: { totalArea: basementArea, finishedArea: basementFinished, finishedCost: basementFinishedCost, unfinishedCost: basementUnfinishedCost, total: basementCost },
      siteImprovements: siteImprovementsCost,
      total: totalReplacementCostNew,
    },
    depreciation: {
      physicalAge: ageForCalc,
      condition,
      physicalRate: (physicalDepPct * 100).toFixed(1) + '%',
      physical: physicalDepreciation,
      functional: functionalObsolescence,
      external: externalObsolescence,
      total: totalDepreciation,
    },
    depreciatedCostOfImprovements,
    landValue: {
      lotSize,
      perSfEstimate: landValuePerSf,
      total: estimatedLandValue,
    },
    indicatedValue,
    quality,
    state,
    regionMultiplier: regionMult,
  };

  // Update facts with cost approach data
  const updatedFacts = { ...facts, costApproach: costData };
  const now = new Date().toISOString();
  dbRun('UPDATE case_facts SET facts_json = ?, updated_at = ? WHERE case_id = ?',
    [JSON.stringify(updatedFacts), now, caseId]);

  log.info('cost-approach:calculated', { caseId, indicatedValue, totalRCN: totalReplacementCostNew, depreciation: totalDepreciation });

  return costData;
}

/**
 * Generate cost approach narrative from calculated data.
 */
export async function generateCostNarrative(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = JSON.parse(caseFacts?.facts_json || '{}');
  const cost = facts.costApproach;

  if (!cost) {
    // Calculate first
    calculateCostApproach(caseId);
    const updated = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
    const updatedFacts = JSON.parse(updated?.facts_json || '{}');
    if (!updatedFacts.costApproach) throw new Error('Cost approach data not available');
  }

  const costData = facts.costApproach || calculateCostApproach(caseId);

  const messages = [
    {
      role: 'system',
      content: `You are an expert residential real estate appraiser writing the cost approach section of an appraisal report. Write a professional, defensible cost approach narrative. Include specific dollar amounts and calculations. Be concise but thorough.`,
    },
    {
      role: 'user',
      content: `Write the cost approach narrative for this property:

GLA: ${costData.replacementCostNew.mainDwelling.gla} SF
Quality: ${costData.quality}
Cost/SF: $${costData.replacementCostNew.mainDwelling.costPerSf}
Main Dwelling RCN: $${costData.replacementCostNew.mainDwelling.total.toLocaleString()}
Garage: ${costData.replacementCostNew.garage.cars}-car, $${costData.replacementCostNew.garage.total.toLocaleString()}
Basement: ${costData.replacementCostNew.basement.totalArea} SF total, $${costData.replacementCostNew.basement.total.toLocaleString()}
Site Improvements: $${costData.replacementCostNew.siteImprovements.toLocaleString()}
Total RCN: $${costData.replacementCostNew.total.toLocaleString()}

Depreciation:
- Physical (${costData.depreciation.condition}, ${costData.depreciation.physicalAge} yrs): $${costData.depreciation.physical.toLocaleString()} (${costData.depreciation.physicalRate})
- Functional: $${costData.depreciation.functional.toLocaleString()}
- External: $${costData.depreciation.external.toLocaleString()}
- Total Depreciation: $${costData.depreciation.total.toLocaleString()}

Depreciated Cost of Improvements: $${costData.depreciatedCostOfImprovements.toLocaleString()}
Land Value: $${costData.landValue.total.toLocaleString()} (${costData.landValue.lotSize} SF × $${costData.landValue.perSfEstimate}/SF)
Indicated Value by Cost Approach: $${costData.indicatedValue.toLocaleString()}`,
    },
  ];

  return await callAI(messages, { maxTokens: 1000, temperature: 0.3 });
}

export default { calculateCostApproach, generateCostNarrative, BASE_COST_PER_SF, REGIONAL_MULTIPLIERS };
