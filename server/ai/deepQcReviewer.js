/**
 * server/ai/deepQcReviewer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-powered deep quality control reviewer.
 *
 * Goes beyond basic placeholder detection — uses AI to:
 *   1. Cross-reference narrative claims against case facts
 *   2. Detect unsupported value conclusions
 *   3. Check for USPAP compliance language
 *   4. Identify logical contradictions between sections
 *   5. Verify consistency of property data across all sections
 *   6. Flag potential E&O liability issues
 *   7. Check UAD standardized format compliance
 *   8. Score overall report quality (A/B/C/D/F)
 */

import { callAI } from '../openaiClient.js';
import { dbGet, dbAll } from '../db/database.js';
import log from '../logger.js';

const QC_SCHEMA = {
  type: 'object',
  properties: {
    overallGrade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
    score: { type: 'number' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          category: { type: 'string' },
          section: { type: 'string' },
          description: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

/**
 * Run deep AI-powered QC review on all sections of a case.
 */
export async function deepQcReview(caseId) {
  const startTime = Date.now();

  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  if (!caseFacts) throw new Error('Case not found');
  const facts = JSON.parse(caseFacts.facts_json || '{}');

  const sections = dbAll(
    'SELECT section_id, draft_text, reviewed_text, final_text FROM generated_sections WHERE case_id = ? ORDER BY created_at DESC',
    [caseId]
  );

  const sectionMap = {};
  for (const s of sections) {
    if (!sectionMap[s.section_id]) {
      sectionMap[s.section_id] = s.final_text || s.reviewed_text || s.draft_text || '';
    }
  }

  if (Object.keys(sectionMap).length === 0) {
    return { error: 'No generated sections to review' };
  }

  // Build context for AI review
  const factsContext = `
SUBJECT: ${facts.subject?.address || 'N/A'}, ${facts.subject?.city || ''}, ${facts.subject?.state || ''} ${facts.subject?.zip || ''}
COUNTY: ${facts.subject?.county || 'N/A'}
YEAR BUILT: ${facts.improvements?.yearBuilt || 'N/A'}
GLA: ${facts.improvements?.gla || 'N/A'} SF
BEDROOMS: ${facts.improvements?.bedrooms || 'N/A'}
BATHROOMS: ${facts.improvements?.bathrooms || 'N/A'}
LOT SIZE: ${facts.site?.lotSize || facts.site?.area || 'N/A'} SF
CONDITION: ${facts.improvements?.condition || 'N/A'}
QUALITY: ${facts.improvements?.quality || 'N/A'}
SALE PRICE: ${facts.contract?.salePrice ? '$' + Number(facts.contract.salePrice).toLocaleString() : 'N/A'}
FINAL VALUE: ${facts.reconciliation?.finalOpinionOfValue ? '$' + Number(facts.reconciliation.finalOpinionOfValue).toLocaleString() : 'N/A'}
FORM TYPE: ${facts.assignment?.type || '1004'}
PURPOSE: ${facts.assignment?.purpose || 'N/A'}`;

  const sectionTexts = Object.entries(sectionMap)
    .map(([id, text]) => `\n--- ${id.replace(/_/g, ' ').toUpperCase()} ---\n${text.slice(0, 2000)}`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content: `You are a senior appraisal reviewer performing a detailed quality control review of an appraisal report. You are checking for:

1. ACCURACY: Do narrative claims match the provided facts? (e.g., if GLA is 1800 SF, does the narrative say 1800?)
2. CONSISTENCY: Is data consistent across sections? (same address, year built, GLA everywhere)
3. COMPLETENESS: Are required elements present? (scope of work, highest & best use, reconciliation)
4. COMPLIANCE: Does language meet USPAP standards? (no hypothetical conditions without disclosure, proper extraordinary assumptions)
5. SUPPORTABILITY: Are value conclusions supported by data? (adjustments justified, approaches properly weighted)
6. PROFESSIONALISM: Grammar, clarity, tone appropriate for an appraisal report
7. LIABILITY: Any statements that could create E&O exposure? (guarantees, predictions, unsupported claims)
8. UAD FORMAT: Proper use of UAD standardized ratings (C1-C6, Q1-Q6) if applicable

Return a JSON object with:
- overallGrade: A/B/C/D/F
- score: 0-100
- issues: array of {severity, category, section, description, suggestion}
- strengths: array of positive observations
- summary: 2-3 sentence overall assessment

Be thorough but fair. Flag real issues, not style preferences.`,
    },
    {
      role: 'user',
      content: `CASE FACTS:\n${factsContext}\n\nREPORT SECTIONS:\n${sectionTexts}`,
    },
  ];

  const response = await callAI(messages, { maxTokens: 3000, temperature: 0.2 });

  let review;
  try {
    review = JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) review = JSON.parse(match[0]);
    else throw new Error('Could not parse QC review response');
  }

  const durationMs = Date.now() - startTime;

  // Save QC results
  const now = new Date().toISOString();
  try {
    const { getDb } = await import('../db/database.js');
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS qc_reviews (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      case_id TEXT NOT NULL, grade TEXT, score INTEGER,
      issues_json TEXT, strengths_json TEXT, summary TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    db.prepare('INSERT INTO qc_reviews (case_id, grade, score, issues_json, strengths_json, summary) VALUES (?, ?, ?, ?, ?, ?)')
      .run(caseId, review.overallGrade, review.score, JSON.stringify(review.issues || []), JSON.stringify(review.strengths || []), review.summary);
  } catch { /* ok */ }

  log.info('deep-qc:complete', { caseId, grade: review.overallGrade, score: review.score, issues: review.issues?.length, durationMs });

  return {
    caseId,
    grade: review.overallGrade,
    score: review.score,
    issues: review.issues || [],
    strengths: review.strengths || [],
    summary: review.summary,
    criticalCount: (review.issues || []).filter(i => i.severity === 'critical').length,
    warningCount: (review.issues || []).filter(i => i.severity === 'warning').length,
    infoCount: (review.issues || []).filter(i => i.severity === 'info').length,
    durationMs,
  };
}

export default { deepQcReview };
