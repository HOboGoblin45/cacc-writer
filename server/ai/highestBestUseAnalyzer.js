/**
 * server/ai/highestBestUseAnalyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered Highest and Best Use (HBU) analysis.
 *
 * USPAP requires every appraisal to include HBU analysis.
 * The four tests: Legally permissible, Physically possible,
 * Financially feasible, Maximally productive.
 *
 * This module AI-generates the HBU analysis based on:
 *   - Zoning data
 *   - Physical characteristics
 *   - Market conditions
 *   - Current use
 *   - Neighborhood context
 */

import { callAI } from '../openaiClient.js';
import { dbGet, dbRun } from '../db/database.js';
import log from '../logger.js';

/**
 * Generate a complete HBU analysis for a case.
 */
export async function analyzeHighestBestUse(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const subject = facts.subject || {};
  const site = facts.site || {};
  const improvements = facts.improvements || {};
  const neighborhood = facts.neighborhood || {};
  const marketConditions = facts.marketConditions || {};

  const messages = [
    {
      role: 'system',
      content: `You are an expert residential real estate appraiser performing a Highest and Best Use analysis per USPAP Standards Rule 1-3. Analyze both "as vacant" and "as improved" using the four-test framework.

Return JSON:
{
  "asVacant": {
    "legallyPermissible": { "analysis": "", "conclusion": "" },
    "physicallyPossible": { "analysis": "", "conclusion": "" },
    "financiallyFeasible": { "analysis": "", "conclusion": "" },
    "maximallyProductive": { "analysis": "", "conclusion": "" },
    "conclusion": "The highest and best use of the site as vacant is..."
  },
  "asImproved": {
    "legallyPermissible": { "analysis": "", "conclusion": "" },
    "physicallyPossible": { "analysis": "", "conclusion": "" },
    "financiallyFeasible": { "analysis": "", "conclusion": "" },
    "maximallyProductive": { "analysis": "", "conclusion": "" },
    "conclusion": "The highest and best use of the property as improved is..."
  },
  "narrative": "Complete 2-3 paragraph HBU narrative suitable for the appraisal report"
}

Be specific to this property. Reference actual zoning, physical characteristics, and market conditions.`,
    },
    {
      role: 'user',
      content: `Property: ${subject.address || 'N/A'}, ${subject.city || ''}, ${subject.state || ''}
Zoning: ${site.zoning || 'N/A'} — ${site.zoningDescription || 'Residential'}
Lot Size: ${site.lotSize || site.area || 'N/A'} SF (${site.lotAcres || 'N/A'} acres)
Current Use: ${subject.propertyType || 'Single Family Residential'}
Year Built: ${improvements.yearBuilt || 'N/A'}
GLA: ${improvements.gla || 'N/A'} SF
Condition: ${improvements.condition || 'N/A'}
Quality: ${improvements.quality || 'N/A'}
Neighborhood: ${neighborhood.name || 'N/A'}, ${neighborhood.builtUp || 'N/A'} built up
Market: ${marketConditions.trend || 'Stable'}, ${marketConditions.medianDaysOnMarket || 'N/A'} avg DOM
Land Use: ${neighborhood.landUse ? JSON.stringify(neighborhood.landUse) : 'Predominantly residential'}`,
    },
  ];

  const response = await callAI(messages, { maxTokens: 2000, temperature: 0.2 });

  let hbu;
  try { hbu = JSON.parse(response); } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) hbu = JSON.parse(match[0]); else hbu = { narrative: response };
  }

  // Save to facts
  facts.highestBestUse = { ...hbu, analyzedAt: new Date().toISOString() };
  dbRun(`UPDATE case_facts SET facts_json = ?, updated_at = datetime('now') WHERE case_id = ?`, [JSON.stringify(facts), caseId]);

  log.info('hbu:analyzed', { caseId });
  return hbu;
}

export default { analyzeHighestBestUse };
