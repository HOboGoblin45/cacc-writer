/**
 * server/ingestion/narrativeExtractor.js
 * ----------------------------------------
 * Phase 5 — Narrative Section Extraction from Prior Appraisal PDFs
 *
 * Detects and segments narrative sections from completed appraisal reports.
 * Extracted sections are staged for memory review — not auto-approved.
 *
 * Extraction strategy:
 *   1. Deterministic section boundary detection (header patterns)
 *   2. AI-assisted section splitting for complex/scanned PDFs
 *
 * Target sections (mapped to canonical field IDs):
 *   neighborhood_description, site_comments, improvements_condition,
 *   sales_comparison_commentary, reconciliation, cost_approach_commentary,
 *   income_approach_commentary, highest_best_use, market_conditions,
 *   zoning_commentary, flood_commentary, condo_project_comments,
 *   manufactured_home_commentary, certification_addendum
 *
 * Usage:
 *   import { extractNarrativeSections } from '../ingestion/narrativeExtractor.js';
 *   const sections = await extractNarrativeSections(text, formType);
 */

import crypto from 'crypto';
import { callAI } from '../openaiClient.js';
import log from '../logger.js';

// ── Section header patterns ──────────────────────────────────────────────────
// Maps regex patterns to canonical field IDs.
// Order matters — first match wins for boundary detection.

const SECTION_HEADERS = [
  { pattern: /neighborhood\s*description/i,                  fieldId: 'neighborhood_description',      label: 'Neighborhood Description' },
  { pattern: /market\s*(?:area|conditions?)\s*(?:analysis)?/i, fieldId: 'market_conditions',           label: 'Market Conditions' },
  { pattern: /site\s*(?:comments?|description|analysis)/i,   fieldId: 'site_comments',                label: 'Site Comments' },
  { pattern: /(?:site|utilities|adverse)\s*conditions?/i,    fieldId: 'site_comments',                label: 'Site / Adverse Conditions' },
  { pattern: /improvement(?:s)?\s*[\/\s]*(?:description|condition|analysis|comments?)/i, fieldId: 'improvements_condition', label: 'Improvements / Condition' },
  { pattern: /condition\s*[\/\s]*(?:of\s*(?:the\s*)?)?improvement/i, fieldId: 'improvements_condition',      label: 'Condition of Improvements' },
  { pattern: /sales?\s*comparison\s*(?:approach|analysis|commentary)/i, fieldId: 'sales_comparison_commentary', label: 'Sales Comparison Commentary' },
  { pattern: /reconciliation/i,                               fieldId: 'reconciliation',               label: 'Reconciliation' },
  { pattern: /cost\s*approach/i,                              fieldId: 'cost_approach_commentary',      label: 'Cost Approach' },
  { pattern: /income\s*(?:approach|capitalization)/i,         fieldId: 'income_approach_commentary',    label: 'Income Approach' },
  { pattern: /highest\s*(?:and|&)\s*best\s*use/i,           fieldId: 'highest_best_use',              label: 'Highest and Best Use' },
  { pattern: /zoning\s*(?:description|comments?|analysis)/i, fieldId: 'zoning_commentary',            label: 'Zoning Commentary' },
  { pattern: /flood\s*(?:zone|comments?|discussion)/i,       fieldId: 'flood_commentary',             label: 'Flood Commentary' },
  { pattern: /condo(?:minium)?\s*(?:project|comments?)/i,    fieldId: 'condo_project_comments',       label: 'Condo Project Comments' },
  { pattern: /manufactured\s*(?:home|housing)\s*(?:comments?)?/i, fieldId: 'manufactured_home_commentary', label: 'Manufactured Home Commentary' },
  { pattern: /certification\s*(?:addendum|statement)/i,      fieldId: 'certification_addendum',        label: 'Certification Addendum' },
  { pattern: /appraiser(?:'s)?\s*certification/i,            fieldId: 'certification_addendum',        label: 'Appraiser Certification' },
  { pattern: /additional\s*comments?/i,                       fieldId: 'additional_comments',          label: 'Additional Comments' },
];

// ── Form-specific target fields ──────────────────────────────────────────────

const FORM_TARGET_FIELDS = {
  '1004': [
    'neighborhood_description', 'market_conditions', 'site_comments',
    'improvements_condition', 'sales_comparison_commentary', 'reconciliation',
    'cost_approach_commentary', 'highest_best_use', 'zoning_commentary',
    'flood_commentary', 'certification_addendum', 'additional_comments',
  ],
  '1025': [
    'neighborhood_description', 'market_conditions', 'site_comments',
    'improvements_condition', 'sales_comparison_commentary', 'reconciliation',
    'cost_approach_commentary', 'income_approach_commentary', 'highest_best_use',
    'certification_addendum', 'additional_comments',
  ],
  '1073': [
    'neighborhood_description', 'market_conditions', 'site_comments',
    'improvements_condition', 'sales_comparison_commentary', 'reconciliation',
    'condo_project_comments', 'certification_addendum', 'additional_comments',
  ],
  '1004c': [
    'neighborhood_description', 'market_conditions', 'site_comments',
    'improvements_condition', 'sales_comparison_commentary', 'reconciliation',
    'manufactured_home_commentary', 'certification_addendum', 'additional_comments',
  ],
  'commercial': [
    'neighborhood_description', 'market_conditions', 'site_comments',
    'improvements_condition', 'sales_comparison_commentary', 'reconciliation',
    'cost_approach_commentary', 'income_approach_commentary', 'highest_best_use',
    'certification_addendum',
  ],
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract narrative sections from prior appraisal PDF text.
 *
 * @param {string} text     — full extracted text from PDF
 * @param {string} formType — form type (1004, 1025, etc.)
 * @returns {Promise<NarrativeSection[]>}
 *
 * @typedef {object} NarrativeSection
 * @property {string} fieldId     — canonical field ID
 * @property {string} label       — human-readable label
 * @property {string} text        — extracted narrative text
 * @property {string} textHash    — SHA-256 hash of cleaned text
 * @property {number} wordCount   — word count
 * @property {number} confidence  — 0.0–1.0
 * @property {string} method      — 'deterministic' | 'ai'
 */
export async function extractNarrativeSections(text, formType = '1004') {
  if (!text || text.length < 100) return [];

  const targetFields = FORM_TARGET_FIELDS[formType] || FORM_TARGET_FIELDS['1004'];

  // Try deterministic extraction first
  const deterministicSections = extractByHeaders(text, targetFields);

  // If we got good coverage (3+ sections), use deterministic results
  if (deterministicSections.length >= 3) {
    return deterministicSections;
  }

  // Fall back to AI-assisted extraction
  try {
    const aiSections = await extractByAI(text, formType, targetFields);
    if (aiSections.length > deterministicSections.length) {
      return aiSections;
    }
  } catch (err) {
    log.warn('[narrativeExtractor] AI extraction failed:', err.message);
  }

  return deterministicSections;
}

/**
 * Get the target field IDs for a form type.
 * @param {string} formType
 * @returns {string[]}
 */
export function getTargetFieldsForForm(formType) {
  return FORM_TARGET_FIELDS[formType] || FORM_TARGET_FIELDS['1004'];
}

// ── Deterministic extraction ─────────────────────────────────────────────────

function extractByHeaders(text, targetFields) {
  const targetSet = new Set(targetFields);
  const lines = text.split('\n');
  const boundaries = [];

  // Find section boundary positions
  // Only match header-like lines: short, uppercase-heavy, and not full sentences.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length < 3 || line.length > 80) continue;

    // Skip lines that look like body text (contain sentence structure)
    if (line.length > 50 && !isHeaderLine(line)) continue;

    for (const header of SECTION_HEADERS) {
      if (!targetSet.has(header.fieldId)) continue;
      if (header.pattern.test(line)) {
        // Keep FIRST occurrence — the actual header, not body-text matches
        const existing = boundaries.findIndex(b => b.fieldId === header.fieldId);
        if (existing >= 0) continue; // already found this header
        boundaries.push({ lineIndex: i, fieldId: header.fieldId, label: header.label });
        break;
      }
    }
  }

  // Sort by line index
  boundaries.sort((a, b) => a.lineIndex - b.lineIndex);

  // Extract text between boundaries
  const sections = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].lineIndex + 1; // skip the header line
    const end = i + 1 < boundaries.length
      ? boundaries[i + 1].lineIndex
      : Math.min(lines.length, start + 100); // cap at 100 lines if no next header

    const sectionText = cleanNarrativeText(
      lines.slice(start, end).join('\n')
    );

    if (sectionText.length < 30) continue; // too short to be meaningful

    sections.push({
      fieldId:    boundaries[i].fieldId,
      label:      boundaries[i].label,
      text:       sectionText,
      textHash:   hashText(sectionText),
      wordCount:  sectionText.split(/\s+/).filter(Boolean).length,
      confidence: 0.8,
      method:     'deterministic',
    });
  }

  return sections;
}

// ── AI-assisted extraction ───────────────────────────────────────────────────

async function extractByAI(text, formType, targetFields) {
  const fieldList = targetFields.map(f => `  "${f}": "<narrative text or null>"`).join(',\n');

  const prompt = [
    `You are an appraisal report section extractor. Extract the narrative text for each section from this ${formType} appraisal report.`,
    `Return ONLY valid JSON. Use null if a section is not found. Extract the FULL narrative text for each section, not a summary.`,
    ``,
    `{`,
    fieldList,
    `}`,
    ``,
    `REPORT TEXT:`,
    text.slice(0, 28000),
  ].join('\n');

  const raw = await callAI([{ role: 'user', content: prompt }]);
  const cleaned = raw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return [];

  let parsed;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    log.warn('[narrativeExtractor] AI response JSON parse failed:', err.message);
    return [];
  }
  const sections = [];

  for (const fieldId of targetFields) {
    const sectionText = parsed[fieldId];
    if (!sectionText || typeof sectionText !== 'string' || sectionText.length < 30) continue;

    const clean = cleanNarrativeText(sectionText);
    if (clean.length < 30) continue;

    const header = SECTION_HEADERS.find(h => h.fieldId === fieldId);
    sections.push({
      fieldId,
      label:      header?.label || fieldIdToLabel(fieldId),
      text:       clean,
      textHash:   hashText(clean),
      wordCount:  clean.split(/\s+/).filter(Boolean).length,
      confidence: 0.7,
      method:     'ai',
    });
  }

  return sections;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cleanNarrativeText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/^\s*\d+\s*$/gm, '')              // standalone page numbers
    .replace(/^\s*Page \d+ of \d+\s*$/gim, '') // Page X of Y
    .replace(/\[INSERT\]/gi, '[INSERT]')       // normalize placeholders
    .trim();
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function fieldIdToLabel(fieldId) {
  return fieldId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function isHeaderLine(line) {
  // Headers are typically: all caps, short, no periods/commas in middle, no articles
  const upper = line.replace(/[^a-zA-Z]/g, '');
  const upperCount = (line.match(/[A-Z]/g) || []).length;
  const lowerCount = (line.match(/[a-z]/g) || []).length;
  // Mostly uppercase = header
  if (upperCount > lowerCount) return true;
  // Short line with no period at end = header
  if (line.length < 40 && !line.endsWith('.')) return true;
  return false;
}
