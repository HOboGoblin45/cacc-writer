/**
 * server/valuation/reconciliationEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered reconciliation engine.
 *
 * Takes the indicated values from all three approaches and:
 *   1. Weights each approach based on property type and data quality
 *   2. Analyzes the spread between approaches
 *   3. Determines the final opinion of value
 *   4. Generates the reconciliation narrative
 *   5. Flags any concerns (wide spread, data gaps)
 */

import { callAI } from '../openaiClient.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// Typical approach weights by property type
const APPROACH_WEIGHTS = {
  'single_family': { salesComparison: 0.80, cost: 0.15, income: 0.05 },
  'condo': { salesComparison: 0.85, cost: 0.10, income: 0.05 },
  '2-4_unit': { salesComparison: 0.50, cost: 0.10, income: 0.40 },
  'commercial': { salesComparison: 0.30, cost: 0.10, income: 0.60 },
  'vacant_land': { salesComparison: 0.90, cost: 0.00, income: 0.10 },
  'new_construction': { salesComparison: 0.50, cost: 0.45, income: 0.05 },
};

/**
 * Perform reconciliation for a case.
 */
export function reconcile(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case facts not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const caseRecord = dbGet('SELECT * FROM case_records WHERE case_id = ?', [caseId]);
  const formType = caseRecord?.form_type || '1004';

  // Determine property type for weighting
  let propertyType = 'single_family';
  if (formType === '1073') propertyType = 'condo';
  else if (formType === '1025') propertyType = '2-4_unit';
  else if (formType === 'commercial') propertyType = 'commercial';

  const yearBuilt = parseInt(facts.improvements?.yearBuilt || 0);
  const currentYear = new Date().getFullYear();
  if (yearBuilt && (currentYear - yearBuilt) <= 2) propertyType = 'new_construction';

  // Get indicated values from each approach
  const salesValue = parseFloat(facts.reconciliation?.indicatedValueBySalesComparison || 0);
  const costValue = parseFloat(facts.costApproach?.indicatedValue || facts.reconciliation?.indicatedValueByCostApproach || 0);
  const incomeValue = parseFloat(facts.incomeApproachCalc?.indicatedValue || facts.reconciliation?.indicatedValueByIncomeApproach || 0);

  const approaches = [];
  if (salesValue > 0) approaches.push({ name: 'Sales Comparison', value: salesValue, key: 'salesComparison' });
  if (costValue > 0) approaches.push({ name: 'Cost', value: costValue, key: 'cost' });
  if (incomeValue > 0) approaches.push({ name: 'Income', value: incomeValue, key: 'income' });

  if (approaches.length === 0) {
    return { error: 'At least one approach value is required for reconciliation' };
  }

  // Get weights
  const baseWeights = APPROACH_WEIGHTS[propertyType] || APPROACH_WEIGHTS.single_family;

  // Adjust weights based on which approaches have data
  const activeWeights = {};
  let totalWeight = 0;
  for (const approach of approaches) {
    activeWeights[approach.key] = baseWeights[approach.key] || 0;
    totalWeight += activeWeights[approach.key];
  }

  // Normalize weights to sum to 1.0
  for (const key of Object.keys(activeWeights)) {
    activeWeights[key] = totalWeight > 0 ? activeWeights[key] / totalWeight : 1 / approaches.length;
  }

  // Calculate weighted value
  let weightedValue = 0;
  for (const approach of approaches) {
    approach.weight = activeWeights[approach.key];
    approach.weightedContribution = Math.round(approach.value * approach.weight);
    weightedValue += approach.weightedContribution;
  }

  // Round to nearest $1,000
  const finalValue = Math.round(weightedValue / 1000) * 1000;

  // Analyze spread
  const values = approaches.map(a => a.value);
  const spread = Math.max(...values) - Math.min(...values);
  const spreadPct = weightedValue > 0 ? ((spread / weightedValue) * 100).toFixed(1) : 0;

  // Flags
  const flags = [];
  if (parseFloat(spreadPct) > 15) flags.push(`Wide spread between approaches (${spreadPct}%) — additional support may be needed`);
  if (approaches.length === 1) flags.push('Only one approach available — consider developing additional approaches');
  if (salesValue > 0 && costValue > 0 && Math.abs(salesValue - costValue) / salesValue > 0.20) {
    flags.push('Sales and Cost approaches differ by more than 20%');
  }

  const reconciliationData = {
    propertyType,
    approaches,
    weights: activeWeights,
    weightedValue: Math.round(weightedValue),
    finalOpinionOfValue: finalValue,
    spread,
    spreadPercentage: spreadPct + '%',
    flags,
    roundedTo: '$1,000',
  };

  // Save to facts
  const updatedFacts = {
    ...facts,
    reconciliation: {
      ...(facts.reconciliation || {}),
      indicatedValueBySalesComparison: salesValue || null,
      indicatedValueByCostApproach: costValue || null,
      indicatedValueByIncomeApproach: incomeValue || null,
      finalOpinionOfValue: finalValue,
      reconciliationData,
    },
  };

  const now = new Date().toISOString();
  dbRun('UPDATE case_facts SET facts_json = ?, updated_at = ? WHERE case_id = ?',
    [JSON.stringify(updatedFacts), now, caseId]);

  log.info('reconciliation:complete', { caseId, finalValue, approaches: approaches.length, spread });

  return reconciliationData;
}

/**
 * Generate reconciliation narrative.
 */
export async function generateReconciliationNarrative(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = JSON.parse(caseFacts?.facts_json || '{}');
  let reconData = facts.reconciliation?.reconciliationData;

  if (!reconData) {
    reconData = reconcile(caseId);
    if (reconData.error) throw new Error(reconData.error);
  }

  const messages = [
    {
      role: 'system',
      content: `You are an expert residential real estate appraiser writing the reconciliation section. Explain the weight given to each approach and why. State the final opinion of value clearly. Be professional, concise, and defensible.`,
    },
    {
      role: 'user',
      content: `Write the reconciliation narrative:

Property Type: ${reconData.propertyType}
Approaches Developed:
${reconData.approaches.map(a => `- ${a.name}: $${a.value.toLocaleString()} (weight: ${(a.weight * 100).toFixed(0)}%)`).join('\n')}

Spread: $${reconData.spread.toLocaleString()} (${reconData.spreadPercentage})
${reconData.flags.length > 0 ? `Concerns: ${reconData.flags.join('; ')}` : ''}

Final Opinion of Value: $${reconData.finalOpinionOfValue.toLocaleString()}`,
    },
  ];

  return await callAI(messages, { maxTokens: 800, temperature: 0.3 });
}

export default { reconcile, generateReconciliationNarrative, APPROACH_WEIGHTS };
