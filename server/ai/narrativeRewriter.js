/**
 * server/ai/narrativeRewriter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Narrative Rewriter — the "make it better" button.
 *
 * Takes any generated section and can:
 *   1. Rewrite to match a specific tone (formal, conversational, technical)
 *   2. Expand thin sections with more detail
 *   3. Condense verbose sections
 *   4. Fix compliance issues flagged by QC
 *   5. Merge voice notes from field inspection into narrative
 *   6. Translate to/from UAD standardized language
 *   7. Generate multiple variations for appraiser to choose from
 *   8. Side-by-side diff showing what changed
 */

import { callAI } from '../openaiClient.js';
import { dbGet, dbRun, dbAll } from '../db/database.js';
import log from '../logger.js';

const REWRITE_MODES = {
  formal: {
    label: 'More Formal',
    instruction: 'Rewrite this appraisal narrative in a more formal, technical tone suitable for a litigation-quality report. Use precise terminology and measured language.',
  },
  concise: {
    label: 'More Concise',
    instruction: 'Condense this narrative while preserving all factual content. Remove redundancy, filler phrases, and unnecessary qualifiers. Target 30% shorter.',
  },
  detailed: {
    label: 'More Detailed',
    instruction: 'Expand this narrative with more specific details, supporting observations, and professional analysis. Add context where appropriate.',
  },
  uspap: {
    label: 'USPAP Compliance',
    instruction: 'Rewrite to ensure full USPAP compliance. Use required terminology, ensure scope of work is clear, and remove any unsupported conclusions.',
  },
  plain: {
    label: 'Plain Language',
    instruction: 'Rewrite in clear, accessible language that a homeowner or attorney could understand. Avoid jargon but maintain professionalism.',
  },
  fix_issues: {
    label: 'Fix QC Issues',
    instruction: 'Rewrite to address the following quality issues. Remove placeholders, fix contradictions, and ensure all claims are supported.',
  },
  from_notes: {
    label: 'From Field Notes',
    instruction: 'Transform these raw field inspection notes into a polished appraisal narrative. Maintain all factual observations while creating professional prose.',
  },
};

/**
 * Rewrite a narrative section.
 *
 * @param {string} caseId
 * @param {string} sectionId
 * @param {Object} options
 * @param {string} options.mode — rewrite mode key
 * @param {string} [options.customInstruction] — custom rewrite instruction
 * @param {string} [options.fieldNotes] — raw field notes to incorporate
 * @param {string[]} [options.issues] — QC issues to fix
 * @returns {Promise<Object>} { original, rewritten, diff, mode }
 */
export async function rewriteSection(caseId, sectionId, options = {}) {
  const mode = REWRITE_MODES[options.mode] || REWRITE_MODES.formal;
  const startTime = Date.now();

  // Get current text
  const section = dbGet(
    'SELECT * FROM generated_sections WHERE case_id = ? AND section_id = ? ORDER BY created_at DESC LIMIT 1',
    [caseId, sectionId]
  );

  const originalText = section?.final_text || section?.reviewed_text || section?.draft_text;
  if (!originalText) throw new Error(`No text found for section ${sectionId}`);

  // Get case context
  const caseFacts = dbGet('SELECT facts_json FROM case_facts WHERE case_id = ?', [caseId]);
  const facts = caseFacts ? JSON.parse(caseFacts.facts_json || '{}') : {};

  let instruction = options.customInstruction || mode.instruction;

  // Add QC issues context if fixing
  if (options.mode === 'fix_issues' && options.issues?.length) {
    instruction += '\n\nIssues to fix:\n' + options.issues.map((i, n) => `${n + 1}. ${i}`).join('\n');
  }

  // Add field notes if converting
  if (options.mode === 'from_notes' && options.fieldNotes) {
    instruction += '\n\nField notes:\n' + options.fieldNotes;
  }

  const messages = [
    {
      role: 'system',
      content: `You are an expert residential real estate appraiser rewriting a narrative section. ${instruction}

Property: ${facts.subject?.address || 'N/A'}, ${facts.subject?.city || ''} ${facts.subject?.state || ''}
Section: ${sectionId.replace(/_/g, ' ')}

Return ONLY the rewritten text. No explanations, labels, or markdown.`,
    },
    { role: 'user', content: originalText },
  ];

  const rewritten = await callAI(messages, { maxTokens: 2000, temperature: 0.3 });
  const durationMs = Date.now() - startTime;

  // Generate simple diff
  const diff = generateSimpleDiff(originalText, rewritten);

  log.info('rewrite:complete', { caseId, sectionId, mode: options.mode, originalChars: originalText.length, rewrittenChars: rewritten.length, durationMs });

  return {
    caseId,
    sectionId,
    mode: options.mode || 'custom',
    modeLabel: mode.label,
    original: originalText,
    rewritten,
    diff,
    stats: {
      originalChars: originalText.length,
      rewrittenChars: rewritten.length,
      charDiff: rewritten.length - originalText.length,
      percentChange: Math.round(((rewritten.length - originalText.length) / originalText.length) * 100),
      durationMs,
    },
  };
}

/**
 * Generate multiple rewrite variations for a section.
 */
export async function generateVariations(caseId, sectionId, count = 3) {
  const results = [];
  const modes = ['formal', 'concise', 'detailed'];

  for (let i = 0; i < Math.min(count, modes.length); i++) {
    try {
      const result = await rewriteSection(caseId, sectionId, { mode: modes[i] });
      results.push({ mode: modes[i], label: REWRITE_MODES[modes[i]].label, text: result.rewritten, stats: result.stats });
    } catch (err) {
      results.push({ mode: modes[i], error: err.message });
    }
  }

  return { caseId, sectionId, variations: results };
}

/**
 * Apply a rewrite — save as the new text for the section.
 */
export function applyRewrite(caseId, sectionId, rewrittenText) {
  const now = new Date().toISOString();
  dbRun(
    `UPDATE generated_sections SET reviewed_text = ?, updated_at = ?
     WHERE case_id = ? AND section_id = ?
     AND id = (SELECT id FROM generated_sections WHERE case_id = ? AND section_id = ? ORDER BY created_at DESC LIMIT 1)`,
    [rewrittenText, now, caseId, sectionId, caseId, sectionId]
  );
  return { applied: true };
}

/**
 * Convert voice/field notes into a narrative section.
 */
export async function notesToNarrative(caseId, sectionId, notes) {
  return rewriteSection(caseId, sectionId, { mode: 'from_notes', fieldNotes: notes });
}

function generateSimpleDiff(original, rewritten) {
  const origWords = original.split(/\s+/);
  const newWords = rewritten.split(/\s+/);
  const added = newWords.filter(w => !origWords.includes(w)).length;
  const removed = origWords.filter(w => !newWords.includes(w)).length;
  return { wordsAdded: added, wordsRemoved: removed, totalOriginalWords: origWords.length, totalNewWords: newWords.length };
}

export { REWRITE_MODES };
export default { rewriteSection, generateVariations, applyRewrite, notesToNarrative, REWRITE_MODES };
