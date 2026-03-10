/**
 * server/engines/compCommentaryEngine.js
 * ----------------------------------------
 * Comparable Sales Commentary Engine
 *
 * Generates USPAP-compliant sales comparison commentary for appraisal reports.
 * Retrieves relevant examples from approvedNarratives and phrases from the
 * phrase bank, then builds a structured narrative via OpenAI.
 *
 * Input:
 *   {
 *     formType:                    '1004' | 'commercial'
 *     subjectPropertyType:         e.g. 'zero lot line', 'single family', 'office'
 *     marketArea:                  e.g. 'Bloomington, IL'
 *     subjectCondition:            e.g. 'C3'
 *     adjustmentCategories:        string[]  e.g. ['Site Size', 'Age', 'GLA']
 *     marketTimeAdjustmentPercent: number    e.g. 3.9
 *     compCount:                   number    e.g. 3
 *     compSearchNotes:             string    e.g. 'Extensive search for zero lot lines...'
 *     caseId:                      string    (optional — for logging)
 *   }
 *
 * Output:
 *   {
 *     ok:       true
 *     text:     string   — the generated commentary
 *     sources:  string[] — e.g. ['approvedNarrative:abc123', 'phraseBank:gla_adjustment']
 *     phraseIds: string[]
 *   }
 *
 * USPAP compliance:
 *   - Only explains adjustments already entered by the appraiser
 *   - Never fabricates comparable sale data
 *   - Never invents addresses, prices, or adjustment amounts
 *   - Describes the search process and adjustment rationale only
 */

import { getApprovedNarrativeIndex, getApprovedNarrativeById } from '../storage/saveApprovedNarrative.js';
import { callAI } from '../openaiClient.js';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const PHRASE_BANK = path.join(__dirname, '..', '..', 'knowledge_base', 'phrase_bank', 'phrases.json');

// ── Phrase bank loader ────────────────────────────────────────────────────────

function loadPhrases() {
  try {
    const data = JSON.parse(fs.readFileSync(PHRASE_BANK, 'utf8'));
    return Array.isArray(data.phrases) ? data.phrases : [];
  } catch {
    return [];
  }
}

// ── Retrieve relevant approved narratives ─────────────────────────────────────

function retrieveRelevantExamples(input, maxExamples = 3) {
  const index = getApprovedNarrativeIndex();

  // Filter to sca_summary / sales_comparison sections for the right form type
  const candidates = index.filter(e => {
    const sectionMatch = ['sca_summary', 'sales_comparison', 'sales_comparison_commentary'].includes(e.sectionType);
    const formMatch    = !e.formType || e.formType === input.formType;
    return sectionMatch && formMatch;
  });

  // Score candidates
  const scored = candidates.map(e => {
    let score = 0;
    if (e.subjectCondition && e.subjectCondition === input.subjectCondition) score += 10;
    if (e.marketType       && e.marketType       === input.marketType)       score += 5;
    if (e.city             && input.marketArea?.toLowerCase().includes(e.city.toLowerCase())) score += 5;
    if (e.county           && input.marketArea?.toLowerCase().includes(e.county.toLowerCase())) score += 3;
    score += (e.qualityScore || 75) / 10;
    return { ...e, _score: score };
  });

  scored.sort((a, b) => b._score - a._score);

  // Load text for top candidates
  const results = [];
  for (const candidate of scored.slice(0, maxExamples)) {
    const full = getApprovedNarrativeById(candidate.id);
    if (full?.text) {
      results.push({ id: candidate.id, text: full.text, score: candidate._score });
    }
  }
  return results;
}

// ── Retrieve relevant phrases ─────────────────────────────────────────────────

function retrieveRelevantPhrases(input) {
  const phrases = loadPhrases();
  const relevantTags = new Set(['sales_comparison', 'market_conditions', 'condition', 'reconciliation']);

  return phrases.filter(p => relevantTags.has(p.tag));
}

// ── Fallback template ─────────────────────────────────────────────────────────

function buildFallbackTemplate(input) {
  const {
    subjectPropertyType = 'subject property',
    marketArea          = 'the subject market area',
    adjustmentCategories = [],
    marketTimeAdjustmentPercent,
    compCount           = 3,
    compSearchNotes     = '',
  } = input;

  const adjList = adjustmentCategories.length > 0
    ? adjustmentCategories.join(', ')
    : 'relevant property characteristics';

  const mktTimeStr = marketTimeAdjustmentPercent && marketTimeAdjustmentPercent > 0
    ? `Due to recent market trends, the comparables have received a market time adjustment of ${marketTimeAdjustmentPercent}% based on the sales statistics chart included in this report. `
    : '';

  const searchStr = compSearchNotes
    ? `${compSearchNotes} `
    : `An extensive search was conducted to identify comparable sales of similar ${subjectPropertyType} properties in ${marketArea}. `;

  return [
    searchStr,
    `${compCount} comparable sale${compCount !== 1 ? 's were' : ' was'} selected as the best available indicators of market value. `,
    mktTimeStr,
    `The comparables have been adjusted for differences in ${adjList}. `,
    `After adjustments are made, the comparables provide a good basis for an estimate of market value.`,
  ].join('').trim();
}

// ── Main engine function ──────────────────────────────────────────────────────

/**
 * generateCompCommentary(input)
 *
 * @param {object} input
 * @returns {Promise<{ ok: boolean, text: string, sources: string[], phraseIds: string[] }>}
 */
export async function generateCompCommentary(input) {
  const {
    formType                    = '1004',
    subjectPropertyType         = 'single family',
    marketArea                  = '',
    subjectCondition            = '',
    adjustmentCategories        = [],
    marketTimeAdjustmentPercent = 0,
    compCount                   = 3,
    compSearchNotes             = '',
  } = input;

  const sources   = [];
  const phraseIds = [];

  // ── Retrieve examples ───────────────────────────────────────────────────────
  const examples = retrieveRelevantExamples({ formType, subjectCondition, marketArea });
  const phrases  = retrieveRelevantPhrases({ formType });

  // ── Build prompt ────────────────────────────────────────────────────────────
  const examplesBlock = examples.length > 0
    ? examples.map((e, i) => {
        sources.push(`approvedNarrative:${e.id}`);
        return `EXAMPLE ${i + 1}:\n${e.text}`;
      }).join('\n\n')
    : null;

  const phrasesBlock = phrases.length > 0
    ? phrases.map(p => {
        phraseIds.push(p.id);
        return `[${p.tag}] ${p.text}`;
      }).join('\n')
    : null;

  const adjList = adjustmentCategories.length > 0
    ? adjustmentCategories.join(', ')
    : 'relevant property characteristics';

  const mktTimeNote = marketTimeAdjustmentPercent > 0
    ? `A market time adjustment of ${marketTimeAdjustmentPercent}% has been applied to all comparables.`
    : 'No market time adjustment was applied.';

  const systemPrompt = [
    `You are an expert real estate appraiser writing USPAP-compliant appraisal report commentary.`,
    ``,
    `CRITICAL RULES:`,
    `- Write in first-person professional appraiser voice`,
    `- Do NOT fabricate comparable sale addresses, prices, or specific dollar amounts`,
    `- Do NOT invent adjustment amounts — only describe the categories being adjusted`,
    `- Only explain the search process, market time adjustment, and adjustment rationale`,
    `- Write 80–200 words of clean, professional narrative`,
    `- No bullet points, no headers — flowing paragraph prose only`,
    `- Match the style of the provided examples if available`,
  ].join('\n');

  const userPrompt = [
    `Write a comparable sales commentary section for a ${formType} appraisal report.`,
    ``,
    `ASSIGNMENT DETAILS:`,
    `- Property type: ${subjectPropertyType}`,
    `- Market area: ${marketArea || 'the subject market area'}`,
    `- Subject condition: ${subjectCondition || 'not specified'}`,
    `- Number of comparables: ${compCount}`,
    `- Adjustment categories: ${adjList}`,
    `- Market time: ${mktTimeNote}`,
    compSearchNotes ? `- Comp search notes: ${compSearchNotes}` : '',
    ``,
    examplesBlock ? `STYLE EXAMPLES (match this voice and structure):\n${examplesBlock}` : '',
    ``,
    phrasesBlock ? `REUSABLE PHRASES (incorporate where appropriate):\n${phrasesBlock}` : '',
    ``,
    `Write the commentary now:`,
  ].filter(Boolean).join('\n');

  // ── Call AI ─────────────────────────────────────────────────────────────────
  let text = '';
  try {
    text = await callAI([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ]);
    text = text.trim();
  } catch (err) {
    // Fallback to template if AI fails
    console.warn('[compCommentaryEngine] AI call failed, using fallback template:', err.message);
    text = buildFallbackTemplate(input);
    sources.push('fallback:template');
  }

  // Final safety check — if AI returned empty, use fallback
  if (!text || text.length < 30) {
    text = buildFallbackTemplate(input);
    sources.push('fallback:template');
  }

  return { ok: true, text, sources, phraseIds };
}

export default { generateCompCommentary };
