/**
 * server/data/taxLookup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Property tax data lookup and analysis.
 *
 * Uses AI to estimate tax data when assessor records aren't available,
 * and structures any uploaded tax data for the report.
 *
 * Key for:
 *   - Cost approach (land value from assessed values)
 *   - Income approach (tax expense estimation)
 *   - Site description (zoning, lot size verification)
 *   - Highest and best use analysis
 */

import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

const PLATFORM_GEMINI_KEY = process.env.PLATFORM_GEMINI_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Estimate tax data for a property using AI.
 * Used when actual assessor records aren't uploaded.
 */
export async function estimateTaxData(caseId) {
  if (!PLATFORM_GEMINI_KEY) throw new Error('Platform AI not configured');

  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const subject = facts.subject || {};
  const improvements = facts.improvements || {};

  const url = `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${PLATFORM_GEMINI_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: `Estimate property tax and assessment data for this residential property. Return JSON:
{
  "assessedLand": estimated_number,
  "assessedImprovement": estimated_number,
  "assessedTotal": estimated_number,
  "estimatedAnnualTax": estimated_number,
  "effectiveTaxRate": "percentage string",
  "assessmentRatio": "percentage string",
  "taxingJurisdiction": "description",
  "estimationBasis": "how these estimates were derived",
  "confidence": "high|medium|low"
}

Property: ${subject.address || 'N/A'}, ${subject.city || ''}, ${subject.state || ''} ${subject.zip || ''}
County: ${subject.county || 'N/A'}
Year Built: ${improvements.yearBuilt || 'N/A'}
GLA: ${improvements.gla || 'N/A'} SF
Lot Size: ${facts.site?.lotSize || 'N/A'} SF
Sale Price: ${facts.contract?.salePrice ? '$' + facts.contract.salePrice : 'N/A'}
Final Value: ${facts.reconciliation?.finalOpinionOfValue ? '$' + facts.reconciliation.finalOpinionOfValue : 'N/A'}

Use typical assessment ratios and tax rates for ${subject.county || 'the'} county, ${subject.state || ''}.` }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
  };

  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  let taxData;
  try { taxData = JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) taxData = JSON.parse(match[0]); else throw new Error('Parse failed');
  }

  // Save to facts
  facts.taxData = { ...taxData, estimatedAt: new Date().toISOString(), source: 'ai_estimate' };
  dbRun(`UPDATE case_facts SET facts_json = ?, updated_at = datetime("now") WHERE case_id = ?`,
    [JSON.stringify(facts), caseId]);

  log.info('tax:estimated', { caseId, annualTax: taxData.estimatedAnnualTax });
  return taxData;
}

/**
 * Calculate land-to-value ratio from tax assessment.
 * Useful for cost approach land value support.
 */
export function calculateLandRatio(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) return null;
  const facts = JSON.parse(caseFacts.facts_json || '{}');
  const tax = facts.taxData || {};

  const land = parseFloat(tax.assessedLand || 0);
  const total = parseFloat(tax.assessedTotal || 0);

  if (!land || !total) return null;

  const ratio = land / total;
  const salePrice = parseFloat(facts.contract?.salePrice || facts.reconciliation?.finalOpinionOfValue || 0);
  const estimatedLandValue = salePrice ? Math.round(salePrice * ratio) : null;

  return {
    assessedLand: land,
    assessedTotal: total,
    landRatio: Math.round(ratio * 100) / 100,
    landRatioPercent: (ratio * 100).toFixed(1) + '%',
    estimatedLandValue,
    source: tax.source || 'unknown',
  };
}

export default { estimateTaxData, calculateLandRatio };
