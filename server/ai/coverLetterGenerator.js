/**
 * server/ai/coverLetterGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates professional engagement/cover letters and scope of work documents.
 *
 * When an appraiser accepts an order, they often need to send:
 *   1. Engagement letter (scope of work agreement)
 *   2. Fee quote with complexity breakdown
 *   3. Estimated delivery timeline
 *   4. Scope of work limitations
 *   5. Extraordinary assumptions disclosure
 *
 * Platform AI feature — free for all users.
 */

import { dbGet } from '../db/database.js';
import log from '../logger.js';

const PLATFORM_GEMINI_KEY = process.env.PLATFORM_GEMINI_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

async function callPlatform(prompt, system, maxTokens = 1500) {
  if (!PLATFORM_GEMINI_KEY) throw new Error('Platform AI not configured');
  const url = `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${PLATFORM_GEMINI_KEY}`;
  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Generate an engagement letter for accepting an appraisal order.
 */
export async function generateEngagementLetter(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const context = `
Appraiser: ${facts.appraiser?.name || 'Charles Cresci'}
Company: ${facts.appraiser?.company || 'Cresci Appraisal & Consulting Company'}
License: ${facts.appraiser?.licenseNumber || ''} (${facts.appraiser?.licenseState || 'IL'})

Client: ${facts.amc?.name || facts.lender?.name || 'Client'}
Order Number: ${facts.amc?.orderNumber || facts.order?.orderNumber || ''}

Property: ${facts.subject?.address || 'N/A'}, ${facts.subject?.city || ''}, ${facts.subject?.state || ''} ${facts.subject?.zip || ''}
Form Type: ${facts.order?.formType || '1004'} ${facts.order?.formType === '1004' ? 'URAR' : ''}
Purpose: ${facts.assignment?.purpose || 'Purchase'}
Loan Type: ${facts.assignment?.loanType || 'Conventional'}
Property Rights: ${facts.assignment?.propertyRightsAppraised || 'Fee Simple'}

Fee: $${facts.order?.fee || 'TBD'}
Due Date: ${facts.order?.dueDate || 'TBD'}
Special Instructions: ${facts.order?.specialInstructions || 'None'}`;

  return await callPlatform(context,
    `Write a professional appraisal engagement letter. Include:
1. Formal acceptance of the assignment
2. Scope of work description (property inspection, comparable research, report preparation)
3. Fee and payment terms
4. Estimated delivery date
5. Type of report and form
6. Intended use and intended users
7. Property rights appraised
8. Any extraordinary assumptions or hypothetical conditions
9. USPAP compliance statement
10. Cancellation/postponement terms
11. Professional signature block

Format as a formal business letter. Date it today.`);
}

/**
 * Generate a scope of work document.
 */
export async function generateScopeOfWork(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const context = `
Property: ${facts.subject?.address || 'N/A'}, ${facts.subject?.city || ''}, ${facts.subject?.state || ''}
Form Type: ${facts.order?.formType || '1004'}
Purpose: ${facts.assignment?.purpose || 'Purchase'}
Property Type: ${facts.assignment?.propertyType || 'Single Family'}
Intended Use: ${facts.assignment?.intendedUse || 'Mortgage lending decision'}`;

  return await callPlatform(context,
    `Write a detailed USPAP-compliant Scope of Work document for this appraisal. Include:
1. Problem identification (client, intended users, intended use, type of value, effective date)
2. Scope determination (extent of research, analysis, and reporting)
3. Data sources to be utilized
4. Approaches to value to be developed (and why)
5. Type of inspection (interior/exterior)
6. Comparable search criteria
7. Market analysis scope
8. Assumptions and limiting conditions
9. Compliance statement

Be thorough and professional. This must withstand regulatory review.`);
}

/**
 * Generate extraordinary assumptions disclosure.
 */
export async function generateExtraordinaryAssumptions(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const context = JSON.stringify({
    subject: facts.subject,
    improvements: facts.improvements,
    site: facts.site,
    contract: facts.contract,
    assignment: facts.assignment,
  });

  return await callPlatform(context,
    `Review this appraisal case data and identify any situations that may require extraordinary assumptions or hypothetical conditions per USPAP. Common triggers: property access limitations, incomplete construction, pending renovations, environmental concerns, title issues, market volatility, zoning changes.

Return a professional disclosure section listing each extraordinary assumption with:
1. The assumption statement
2. Why it's being made
3. Impact on the value conclusion if the assumption proves incorrect

If no extraordinary assumptions are needed, state that clearly.`);
}

export default { generateEngagementLetter, generateScopeOfWork, generateExtraordinaryAssumptions };
