/**
 * server/ai/reconsiderationOfValue.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reconsideration of Value (ROV) handler.
 *
 * When a borrower or lender disputes the appraised value, they file
 * a Reconsideration of Value. The appraiser must:
 *   1. Review the new comps/data provided
 *   2. Analyze whether they're truly superior to original comps
 *   3. Write a formal response (maintain or change value)
 *   4. Document the reasoning
 *
 * New FHFA rules (2024) require lenders to have a formal ROV process.
 * This makes our tool even more critical — every ROV needs documentation.
 *
 * This AI:
 *   - Compares suggested comps to your original comps
 *   - Identifies strengths/weaknesses of each
 *   - Drafts formal ROV response letter
 *   - Supports both "value maintained" and "value revised" outcomes
 */

import { getDb } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';

/**
 * Analyze suggested comps from an ROV request.
 */
export async function analyzeRov(caseId, { suggestedComps, rovReason, requestedValue, requestedBy }) {
  const db = getDb();

  const caseData = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  if (!caseData) throw new Error('Case not found');

  let originalComps = [];
  try { originalComps = db.prepare('SELECT * FROM comparables WHERE case_id = ?').all(caseId); } catch { /* ok */ }

  const originalCompText = originalComps.map((c, i) =>
    `Original Comp ${i + 1}: ${c.address || 'N/A'} | $${c.sold_price?.toLocaleString() || 'N/A'} | ${c.gla || '?'} SF | ${c.year_built || '?'} | Sold: ${c.sold_date || 'N/A'}`
  ).join('\n');

  const suggestedCompText = (suggestedComps || []).map((c, i) =>
    `Suggested Comp ${i + 1}: ${c.address || 'N/A'} | $${c.soldPrice?.toLocaleString() || 'N/A'} | ${c.gla || '?'} SF | ${c.yearBuilt || '?'} | Sold: ${c.soldDate || 'N/A'}`
  ).join('\n');

  const prompt = `You are a licensed real estate appraiser analyzing a Reconsideration of Value (ROV) request.

SUBJECT PROPERTY:
Address: ${caseData.property_address}, ${caseData.city} ${caseData.state} ${caseData.zip}
GLA: ${caseData.gla || caseData.living_area} SF | Year Built: ${caseData.year_built}
Original Appraised Value: $${(caseData.opinion_value || caseData.estimated_value || 0).toLocaleString()}

ORIGINAL COMPARABLE SALES (used in report):
${originalCompText || 'None on file'}

ROV REQUEST:
Requested by: ${requestedBy || 'Borrower/Lender'}
Requested value: ${requestedValue ? '$' + Number(requestedValue).toLocaleString() : 'Not specified'}
Reason: ${rovReason || 'Not provided'}

SUGGESTED COMPARABLE SALES (from ROV request):
${suggestedCompText || 'None provided'}

Analyze the ROV request:
1. Compare each suggested comp to the subject — are they truly comparable?
2. Compare suggested comps to your original comps — which set is superior?
3. Identify any issues with the suggested comps (location, condition, age, sale date, etc.)
4. Provide a recommendation: MAINTAIN original value or REVISE
5. Draft a brief formal response

Be objective. If the suggested comps are genuinely better, acknowledge it.`;

  const analysis = await callAI([{ role: 'user', content: prompt }], { maxTokens: 1000, temperature: 0.2 });

  log.info('rov:analyzed', { caseId, suggestedComps: (suggestedComps || []).length });

  return {
    caseId,
    subjectAddress: caseData.property_address,
    originalValue: caseData.opinion_value || caseData.estimated_value,
    requestedValue: requestedValue || null,
    requestedBy: requestedBy || 'Unknown',
    originalCompsCount: originalComps.length,
    suggestedCompsCount: (suggestedComps || []).length,
    analysis,
  };
}

/**
 * Generate formal ROV response letter.
 */
export async function generateRovLetter(caseId, { decision, reasoning, revisedValue } = {}) {
  const db = getDb();
  const caseData = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  if (!caseData) throw new Error('Case not found');

  const maintained = decision !== 'revise';

  const prompt = `Draft a formal Reconsideration of Value response letter.

Subject Property: ${caseData.property_address}, ${caseData.city} ${caseData.state} ${caseData.zip}
Original Appraised Value: $${(caseData.opinion_value || caseData.estimated_value || 0).toLocaleString()}
Decision: ${maintained ? 'VALUE MAINTAINED — original value stands' : `VALUE REVISED to $${Number(revisedValue).toLocaleString()}`}
${reasoning ? `Reasoning: ${reasoning}` : ''}

Write a professional letter that:
1. Acknowledges the ROV request
2. States that additional data was reviewed
3. ${maintained ? 'Explains why the original value is supported and the suggested comps are inferior' : 'Explains why the new data supports a value revision'}
4. References USPAP obligations and independence
5. Is respectful but firm
6. Includes standard closing language

Format as a proper business letter.`;

  const letter = await callAI([{ role: 'user', content: prompt }], { maxTokens: 800, temperature: 0.2 });

  return { letter, decision: maintained ? 'maintained' : 'revised', revisedValue: maintained ? null : revisedValue };
}

export default { analyzeRov, generateRovLetter };
