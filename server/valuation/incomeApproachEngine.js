/**
 * server/valuation/incomeApproachEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated Income Approach Calculator.
 *
 * For 1025 (2-4 unit) and commercial properties:
 *   1. GRM (Gross Rent Multiplier) method
 *   2. Direct Capitalization method
 *   3. Operating expense analysis
 *   4. NOI calculation
 *   5. Income approach narrative generation
 */

import { callAI } from '../openaiClient.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

// Typical expense ratios by property type
const EXPENSE_RATIOS = {
  '2-unit': { vacancy: 0.05, management: 0.08, maintenance: 0.10, insurance: 0.03, taxes: 0.15, reserves: 0.03 },
  '3-unit': { vacancy: 0.05, management: 0.08, maintenance: 0.10, insurance: 0.03, taxes: 0.15, reserves: 0.03 },
  '4-unit': { vacancy: 0.05, management: 0.10, maintenance: 0.10, insurance: 0.03, taxes: 0.15, reserves: 0.04 },
  'commercial': { vacancy: 0.07, management: 0.10, maintenance: 0.08, insurance: 0.04, taxes: 0.18, reserves: 0.05 },
};

/**
 * Calculate income approach for a case.
 */
export function calculateIncomeApproach(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case facts not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const income = facts.income || facts.incomeApproach || {};
  const contract = facts.contract || {};

  const numberOfUnits = parseInt(income.numberOfUnits || facts.improvements?.units || 2);
  const propertyType = numberOfUnits <= 4 ? `${numberOfUnits}-unit` : 'commercial';

  // ── Monthly rent per unit ──────────────────────────────────────────────

  const units = [];
  for (let i = 1; i <= numberOfUnits; i++) {
    const unitRent = parseFloat(income[`unit${i}Rent`] || income.monthlyRent || income.avgRent || 0);
    units.push({ unit: i, monthlyRent: unitRent });
  }

  const totalMonthlyRent = units.reduce((sum, u) => sum + u.monthlyRent, 0);
  const totalAnnualRent = totalMonthlyRent * 12;

  if (totalAnnualRent === 0) {
    return { error: 'Monthly rent data required for income approach' };
  }

  // ── GRM Method ─────────────────────────────────────────────────────────

  const grm = parseFloat(income.grossRentMultiplier || income.grm || 0);
  const grmValue = grm > 0 ? Math.round(totalMonthlyRent * grm) : null;

  // ── Direct Capitalization ──────────────────────────────────────────────

  const expenses = EXPENSE_RATIOS[propertyType] || EXPENSE_RATIOS['2-unit'];

  const grossIncome = totalAnnualRent;
  const vacancyLoss = Math.round(grossIncome * expenses.vacancy);
  const effectiveGrossIncome = grossIncome - vacancyLoss;

  const operatingExpenses = {
    management: Math.round(effectiveGrossIncome * expenses.management),
    maintenance: Math.round(effectiveGrossIncome * expenses.maintenance),
    insurance: Math.round(effectiveGrossIncome * expenses.insurance),
    taxes: Math.round(effectiveGrossIncome * expenses.taxes),
    reserves: Math.round(effectiveGrossIncome * expenses.reserves),
  };

  // Custom expenses override
  if (income.annualInsurance) operatingExpenses.insurance = parseFloat(income.annualInsurance);
  if (income.annualTaxes) operatingExpenses.taxes = parseFloat(income.annualTaxes);
  if (income.annualMaintenance) operatingExpenses.maintenance = parseFloat(income.annualMaintenance);

  const totalExpenses = Object.values(operatingExpenses).reduce((sum, v) => sum + v, 0);
  const expenseRatio = effectiveGrossIncome > 0 ? ((totalExpenses / effectiveGrossIncome) * 100).toFixed(1) : 0;
  const noi = effectiveGrossIncome - totalExpenses;

  const capRate = parseFloat(income.capRate || 0);
  const capValue = capRate > 0 ? Math.round(noi / (capRate / 100)) : null;

  // ── Indicated Value ────────────────────────────────────────────────────

  const indicatedValue = capValue || grmValue || null;

  const incomeData = {
    units,
    numberOfUnits,
    propertyType,
    grossIncome: {
      totalMonthlyRent,
      totalAnnualRent: grossIncome,
      vacancyRate: (expenses.vacancy * 100) + '%',
      vacancyLoss,
      effectiveGrossIncome,
    },
    operatingExpenses: {
      ...operatingExpenses,
      total: totalExpenses,
      expenseRatio: expenseRatio + '%',
    },
    noi,
    grm: {
      multiplier: grm || null,
      indicatedValue: grmValue,
    },
    capitalization: {
      capRate: capRate ? capRate + '%' : null,
      indicatedValue: capValue,
    },
    indicatedValue,
  };

  // Save to facts
  const updatedFacts = { ...facts, incomeApproachCalc: incomeData };
  const now = new Date().toISOString();
  dbRun('UPDATE case_facts SET facts_json = ?, updated_at = ? WHERE case_id = ?',
    [JSON.stringify(updatedFacts), now, caseId]);

  log.info('income-approach:calculated', { caseId, noi, indicatedValue });

  return incomeData;
}

/**
 * Generate income approach narrative.
 */
export async function generateIncomeNarrative(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = JSON.parse(caseFacts?.facts_json || '{}');
  let incomeData = facts.incomeApproachCalc;

  if (!incomeData) {
    incomeData = calculateIncomeApproach(caseId);
    if (incomeData.error) throw new Error(incomeData.error);
  }

  const messages = [
    {
      role: 'system',
      content: `You are an expert real estate appraiser writing the income approach section. Write a professional narrative with specific numbers. Include rent analysis, expense ratios, NOI calculation, and final indicated value.`,
    },
    {
      role: 'user',
      content: `Write the income approach narrative:

Units: ${incomeData.numberOfUnits}
${incomeData.units.map(u => `Unit ${u.unit}: $${u.monthlyRent}/month`).join('\n')}

Gross Annual Income: $${incomeData.grossIncome.totalAnnualRent.toLocaleString()}
Vacancy (${incomeData.grossIncome.vacancyRate}): -$${incomeData.grossIncome.vacancyLoss.toLocaleString()}
Effective Gross Income: $${incomeData.grossIncome.effectiveGrossIncome.toLocaleString()}

Operating Expenses:
- Management: $${incomeData.operatingExpenses.management.toLocaleString()}
- Maintenance: $${incomeData.operatingExpenses.maintenance.toLocaleString()}
- Insurance: $${incomeData.operatingExpenses.insurance.toLocaleString()}
- Taxes: $${incomeData.operatingExpenses.taxes.toLocaleString()}
- Reserves: $${incomeData.operatingExpenses.reserves.toLocaleString()}
- Total: $${incomeData.operatingExpenses.total.toLocaleString()} (${incomeData.operatingExpenses.expenseRatio})

NOI: $${incomeData.noi.toLocaleString()}
${incomeData.grm.multiplier ? `GRM: ${incomeData.grm.multiplier} → $${incomeData.grm.indicatedValue.toLocaleString()}` : ''}
${incomeData.capitalization.capRate ? `Cap Rate: ${incomeData.capitalization.capRate} → $${incomeData.capitalization.indicatedValue.toLocaleString()}` : ''}
Indicated Value: $${(incomeData.indicatedValue || 0).toLocaleString()}`,
    },
  ];

  return await callAI(messages, { maxTokens: 1000, temperature: 0.3 });
}

export default { calculateIncomeApproach, generateIncomeNarrative };
