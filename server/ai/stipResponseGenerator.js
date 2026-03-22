/**
 * server/ai/stipResponseGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Stipulation Response Generator.
 *
 * Stips (stipulations/revision requests) are the #1 time waster for appraisers.
 * Average appraiser spends 2-4 hours/week responding to stips.
 *
 * Common stips:
 *   - "Provide support for your C3 condition rating"
 *   - "Explain why you didn't use comp at 123 Main St"
 *   - "Provide market support for time adjustment"
 *   - "Address the GLA discrepancy between MLS and your measurement"
 *   - "Provide additional support for your value conclusion"
 *
 * This AI:
 *   1. Reads the stip request
 *   2. Pulls relevant case data (comps, photos, sections)
 *   3. Drafts a professional response with data support
 *   4. Cites specific evidence from the report
 *   5. Uses the appraiser's voice profile for consistency
 */

import { getDb } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';

const STIP_CATEGORIES = {
  value_support: { label: 'Value Conclusion Support', template: 'Explain and defend the appraised value with market data.' },
  condition_rating: { label: 'Condition Rating Support', template: 'Justify the C-rating with physical evidence.' },
  quality_rating: { label: 'Quality Rating Support', template: 'Justify the Q-rating with construction/design evidence.' },
  comp_selection: { label: 'Comp Selection Justification', template: 'Explain why chosen comps are the best available.' },
  comp_rejection: { label: 'Comp Rejection Explanation', template: 'Explain why a suggested comp was not used.' },
  adjustment_support: { label: 'Adjustment Support', template: 'Provide market data supporting specific adjustments.' },
  gla_discrepancy: { label: 'GLA Discrepancy', template: 'Address difference between reported GLA and other sources.' },
  market_conditions: { label: 'Market Conditions', template: 'Provide data on current market trends.' },
  time_adjustment: { label: 'Time Adjustment Support', template: 'Support or explain time/market conditions adjustments.' },
  general: { label: 'General Response', template: 'Address a general reviewer concern.' },
};

/**
 * Generate a response to a stipulation.
 */
export async function generateStipResponse(caseId, { stipText, category, reviewerName, lenderName } = {}) {
  const db = getDb();

  // Gather case context
  const caseData = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  if (!caseData) throw new Error('Case not found');

  let comps = [];
  try { comps = db.prepare('SELECT * FROM comparables WHERE case_id = ? LIMIT 10').all(caseId); } catch { /* ok */ }

  let sections = [];
  try { sections = db.prepare("SELECT section_type, content FROM report_sections WHERE case_id = ? AND status = 'approved'").all(caseId); } catch { /* ok */ }

  // Build context
  const compSummary = comps.map((c, i) =>
    `Comp ${i + 1}: ${c.address || 'N/A'} | $${c.sold_price?.toLocaleString() || 'N/A'} | ${c.gla || '?'} SF | ${c.year_built || '?'}`
  ).join('\n');

  const sectionSummary = sections.map(s => `${s.section_type}: ${(s.content || '').slice(0, 200)}...`).join('\n');

  const catInfo = STIP_CATEGORIES[category] || STIP_CATEGORIES.general;

  const prompt = `You are a licensed real estate appraiser responding to a revision request (stipulation) from a lender's review department.

Your response must be:
- Professional and confident, not defensive
- Supported by specific data from the report
- Concise but thorough
- Written in first person
- Reference specific comps, photos, and observations where relevant

CASE DATA:
Subject: ${caseData.property_address || 'N/A'}, ${caseData.city || ''} ${caseData.state || ''} ${caseData.zip || ''}
Property Type: ${caseData.property_type || 'SFR'}
GLA: ${caseData.gla || caseData.living_area || 'N/A'} SF
Year Built: ${caseData.year_built || 'N/A'}
Condition/Quality: ${caseData.condition_rating || 'N/A'} / ${caseData.quality_rating || 'N/A'}
Appraised Value: $${caseData.opinion_value?.toLocaleString() || caseData.estimated_value?.toLocaleString() || 'N/A'}

COMPARABLES:
${compSummary || 'No comps on file'}

REPORT SECTIONS:
${sectionSummary || 'No sections on file'}

STIPULATION REQUEST:
${stipText}

${reviewerName ? `Reviewer: ${reviewerName}` : ''}
${lenderName ? `Lender: ${lenderName}` : ''}

Category: ${catInfo.label}
${catInfo.template}

Draft a professional response addressing this stipulation. Be specific and cite data.`;

  const response = await callAI([{ role: 'user', content: prompt }], { maxTokens: 800, temperature: 0.3 });

  log.info('stip:generated', { caseId, category: category || 'general' });

  return {
    response,
    category: catInfo.label,
    caseAddress: caseData.property_address,
    compsReferenced: comps.length,
    sectionsReferenced: sections.length,
  };
}

/**
 * Batch generate responses for multiple stips on the same case.
 */
export async function batchStipResponses(caseId, stips) {
  const results = [];
  for (const stip of stips) {
    try {
      const result = await generateStipResponse(caseId, stip);
      results.push({ ...stip, ...result });
    } catch (err) {
      results.push({ ...stip, error: err.message });
    }
  }
  return results;
}

export { STIP_CATEGORIES };
export default { generateStipResponse, batchStipResponses, STIP_CATEGORIES };
