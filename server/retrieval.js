/**
 * retrieval.js
 * ------------
 * Retrieves relevant examples from the knowledge base for a given generation request.
 *
 * Retrieval priority order (Pass 0 → Pass 4):
 *   Pass 0: approvedNarratives — appraiser's own completed reports (HIGHEST TRUST)
 *           Weighted multi-dimensional scoring via approvedNarrativeRetriever.js
 *           Weights centralized in server/config/retrievalWeights.js
 *   Pass 1: Exact match on formType + fieldId + propertyType + marketType
 *   Pass 2: Relax propertyType + marketType — match form + field only
 *   Pass 3: Relax formType — match fieldId only across all forms
 *   Pass 4: No examples found — return empty (prompt builder handles gracefully)
 *
 * Voice engine design:
 *   - getRelevantExamplesWithVoice() returns { voiceExamples, otherExamples }
 *   - promptBuilder.js injects them as separate labeled blocks (Block 3a + 3b)
 *   - getRelevantExamples() preserved for backward compatibility (returns flat array)
 *
 * Active production scope: 1004 (ACI) + commercial (Real Quantum)
 */

import { getExamples } from './knowledgeBase.js';
import { getApprovedNarratives } from './retrieval/approvedNarrativeRetriever.js';
import {
  MIN_VOICE_EXAMPLES,
  MAX_VOICE_EXAMPLES,
  MAX_OTHER_EXAMPLES,
  MAX_TOTAL_EXAMPLES,
} from './config/retrievalWeights.js';

const MIN_EXAMPLES = 2;  // Minimum desired for other-examples fallback passes
const MAX_EXAMPLES = 5;  // Hard cap for backward-compat getRelevantExamples()

// ── Voice Engine: Pass 0 ──────────────────────────────────────────────────────

/**
 * getRelevantExamplesWithVoice(params)
 *
 * Primary retrieval function for the Personal Appraiser Voice Engine.
 * Returns voice examples (appraiser's own approved narratives) separately
 * from other examples (approved_edits, curated, imported).
 *
 * The prompt builder injects these as two distinct labeled blocks:
 *   Block 3a — voice examples (highest priority, primary style reference)
 *   Block 3b — other examples (supplemental style reference)
 *
 * @param {object} params
 *   @param {string} params.formType           e.g. '1004', 'commercial'
 *   @param {string} params.fieldId            e.g. 'neighborhood_description'
 *   @param {string} [params.sectionType]      alias for fieldId (voice engine uses sectionType)
 *   @param {string} [params.propertyType]     e.g. 'residential'
 *   @param {string} [params.marketType]       e.g. 'suburban'
 *   @param {string} [params.subjectCondition] e.g. 'C3'
 *   @param {string} [params.county]           e.g. 'McLean'
 *   @param {string} [params.city]             e.g. 'Bloomington'
 *   @param {string} [params.assignmentPurpose] e.g. 'Purchase'
 *   @param {string} [params.loanProgram]      e.g. 'Conventional'
 *
 * @returns {{ voiceExamples: object[], otherExamples: object[] }}
 */
export function getRelevantExamplesWithVoice(params) {
  const {
    formType, fieldId, sectionType,
    propertyType, marketType,
    subjectCondition, county, city,
    assignmentPurpose, loanProgram,
  } = params || {};

  const resolvedSectionType = sectionType || fieldId;

  // ── Pass 0: approvedNarratives (voice engine — highest trust) ─────────────
  const voiceQuery = {
    sectionType:       resolvedSectionType,
    formType,
    propertyType,
    marketType,
    subjectCondition,
    county,
    city,
    assignmentPurpose,
    loanProgram,
  };
  const voiceExamples = getApprovedNarratives(voiceQuery, MAX_VOICE_EXAMPLES);

  // ── Pass 1–3: Other examples (approved_edits, curated, imported) ──────────
  // Limit other examples to MAX_OTHER_EXAMPLES, and cap total at MAX_TOTAL_EXAMPLES
  const remainingSlots = Math.max(0, MAX_TOTAL_EXAMPLES - voiceExamples.length);
  const otherLimit     = Math.min(MAX_OTHER_EXAMPLES, remainingSlots);

  let otherExamples = [];

  if (otherLimit > 0) {
    // Pass 1: Exact match on all four dimensions
    otherExamples = getExamples({ formType, fieldId: resolvedSectionType, propertyType, marketType }, otherLimit);

    if (otherExamples.length < MIN_EXAMPLES) {
      // Pass 2: Relax propertyType + marketType
      otherExamples = getExamples({ formType, fieldId: resolvedSectionType }, otherLimit);
    }

    if (otherExamples.length === 0) {
      // Pass 3: Relax formType — match fieldId only
      otherExamples = getExamples({ fieldId: resolvedSectionType }, otherLimit);
    }

    otherExamples = otherExamples.slice(0, otherLimit);
  }

  return { voiceExamples, otherExamples };
}

// ── Backward-compatible retrieval (flat array) ────────────────────────────────

/**
 * getRelevantExamples(params)
 *
 * Backward-compatible retrieval — returns a flat array of examples.
 * Preserved for existing callers. New code should use getRelevantExamplesWithVoice().
 *
 * Internally calls getRelevantExamplesWithVoice() and merges results,
 * so voice examples are included (ranked first) in the flat array.
 *
 * @param {object} params  Same as getRelevantExamplesWithVoice()
 * @returns {object[]}     Flat array: voice examples first, then other examples
 */
export function getRelevantExamples(params) {
  const { voiceExamples, otherExamples } = getRelevantExamplesWithVoice(params);
  // Voice examples first (highest trust), then other examples
  return [...voiceExamples, ...otherExamples].slice(0, MAX_EXAMPLES);
}

// ── Formatters ────────────────────────────────────────────────────────────────

/**
 * formatVoiceExamplesBlock(examples)
 *
 * Formats approved narrative examples (appraiser's own completed reports)
 * into a prompt-ready string block with the authoritative voice engine label.
 *
 * This label is critical — it tells the AI these are the primary style reference,
 * written by the appraiser themselves, not generic examples.
 *
 * @param {object[]} examples  Voice examples from approvedNarratives/
 * @returns {string}
 */
export function formatVoiceExamplesBlock(examples) {
  if (!examples || examples.length === 0) return '';

  const lines = [
    'APPROVED NARRATIVE EXAMPLES FROM PREVIOUS COMPLETED APPRAISAL REPORTS WRITTEN BY THE APPRAISER:',
    '(These are the primary style reference. Match this appraiser\'s voice, tone, and phrasing closely.)',
  ];

  examples.forEach((ex, i) => {
    const meta = [
      ex.sectionType   ? `section: ${ex.sectionType}`   : null,
      ex.formType      ? `form: ${ex.formType}`          : null,
      ex.county        ? `county: ${ex.county}`          : null,
      ex.subjectCondition ? `condition: ${ex.subjectCondition}` : null,
    ].filter(Boolean).join(' | ');

    lines.push(`\n--- Approved Example ${i + 1}${meta ? ` (${meta})` : ''} ---`);
    const voiceText = (ex.text || '').trim();
    if (voiceText) lines.push(voiceText);
  });

  lines.push('\n--- End of approved examples ---');
  return lines.join('\n');
}

/**
 * formatExamplesBlock(examples, label)
 *
 * Formats supplemental examples (approved_edits, curated, imported)
 * into a prompt-ready string block.
 *
 * @param {object[]} examples
 * @param {string}   [label]  Optional custom label (defaults to standard writing examples label)
 * @returns {string}
 */
export function formatExamplesBlock(examples, label) {
  if (!examples || examples.length === 0) return '';

  const heading = label || 'ADDITIONAL WRITING EXAMPLES (supplemental style reference):';
  const lines   = [heading];

  examples.forEach((ex, i) => {
    lines.push(`\n--- Example ${i + 1} (${ex.sourceType || 'example'}) ---`);
    const exText = (ex.text || '').trim();
    if (exText) lines.push(exText);
  });

  lines.push('\n--- End of examples ---');
  return lines.join('\n');
}
