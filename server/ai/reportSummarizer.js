/**
 * server/ai/reportSummarizer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered report summarizer.
 *
 * Generates executive summaries and transmittal letters:
 *   1. One-page executive summary of the entire report
 *   2. Transmittal letter to lender/AMC
 *   3. Key findings bullet points
 *   4. Risk assessment summary
 *   5. Comparable selection summary table
 *
 * Platform AI feature — free for all users.
 */

import { dbGet, dbAll } from '../db/database.js';
import log from '../logger.js';

const PLATFORM_GEMINI_KEY = process.env.PLATFORM_GEMINI_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

async function callPlatform(prompt, systemPrompt, maxTokens = 2000) {
  if (!PLATFORM_GEMINI_KEY) throw new Error('Platform AI not configured');

  const url = `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${PLATFORM_GEMINI_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens },
  };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Generate a one-page executive summary of the entire appraisal.
 */
export async function generateExecutiveSummary(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const sections = dbAll('SELECT section_id, final_text, reviewed_text, draft_text FROM generated_sections WHERE case_id = ? ORDER BY created_at DESC', [caseId]);
  const sectionMap = {};
  for (const s of sections) { if (!sectionMap[s.section_id]) sectionMap[s.section_id] = s.final_text || s.reviewed_text || s.draft_text || ''; }

  const subject = facts.subject || {};
  const recon = facts.reconciliation || {};

  const context = `
PROPERTY: ${subject.address || 'N/A'}, ${subject.city || ''}, ${subject.state || ''} ${subject.zip || ''}
COUNTY: ${subject.county || 'N/A'}
FORM TYPE: ${facts.assignment?.type || '1004'}
PURPOSE: ${facts.assignment?.purpose || 'Purchase'}
YEAR BUILT: ${facts.improvements?.yearBuilt || 'N/A'}
GLA: ${facts.improvements?.gla || 'N/A'} SF
CONDITION: ${facts.improvements?.condition || 'N/A'}
QUALITY: ${facts.improvements?.quality || 'N/A'}
CONTRACT PRICE: ${facts.contract?.salePrice ? '$' + Number(facts.contract.salePrice).toLocaleString() : 'N/A'}
FINAL VALUE: ${recon.finalOpinionOfValue ? '$' + Number(recon.finalOpinionOfValue).toLocaleString() : 'N/A'}

SECTIONS:
${Object.entries(sectionMap).map(([id, text]) => `${id}: ${text.slice(0, 500)}`).join('\n\n')}`;

  return await callPlatform(context,
    'Generate a professional one-page executive summary of this appraisal report. Include: property identification, purpose, scope, key findings, valuation approaches used, final opinion of value, and any extraordinary assumptions or limiting conditions. Format with clear headers.',
    1500);
}

/**
 * Generate a transmittal letter.
 */
export async function generateTransmittalLetter(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const subject = facts.subject || {};
  const appraiser = facts.appraiser || {};
  const lender = facts.lender || {};
  const recon = facts.reconciliation || {};

  const context = `
TO: ${lender.name || 'Lender'}
${lender.address || ''}

FROM: ${appraiser.name || 'Appraiser'}
${appraiser.company || 'Cresci Appraisal & Consulting Company'}
License: ${appraiser.licenseNumber || ''} (${appraiser.licenseState || ''})

RE: Appraisal of ${subject.address || 'N/A'}, ${subject.city || ''}, ${subject.state || ''} ${subject.zip || ''}
Borrower: ${subject.borrower || 'N/A'}
Loan Number: ${lender.loanNumber || 'N/A'}
Purpose: ${facts.assignment?.purpose || 'Purchase'}
Final Value: ${recon.finalOpinionOfValue ? '$' + Number(recon.finalOpinionOfValue).toLocaleString() : 'N/A'}
Effective Date: ${facts.assignment?.effectiveDate || new Date().toISOString().split('T')[0]}`;

  return await callPlatform(context,
    'Write a professional appraisal transmittal letter. Include: date, addressee, property identification, purpose of appraisal, type of value, effective date, final opinion of value, and a brief scope statement. Sign off professionally. This is a formal business letter.',
    1200);
}

/**
 * Generate risk assessment summary.
 */
export async function generateRiskAssessment(caseId) {
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const context = JSON.stringify({
    property: facts.subject,
    improvements: facts.improvements,
    site: facts.site,
    contract: facts.contract,
    reconciliation: facts.reconciliation,
    marketConditions: facts.marketConditions,
    photoAnalysis: facts.photoAnalysis,
  }, null, 2);

  const response = await callPlatform(context,
    `Analyze this appraisal data and generate a risk assessment. Return JSON:
{
  "overallRisk": "Low|Medium|High",
  "riskScore": 1-10,
  "factors": [
    { "category": "Market|Property|Transaction|Compliance", "risk": "Low|Medium|High", "description": "", "mitigation": "" }
  ],
  "redFlags": ["list of potential concerns"],
  "strengths": ["list of positive factors"],
  "recommendation": "summary recommendation"
}`,
    1500);

  try { return JSON.parse(response); } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { overallRisk: 'Unknown', summary: response };
  }
}

export default { generateExecutiveSummary, generateTransmittalLetter, generateRiskAssessment };
