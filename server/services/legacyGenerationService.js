/**
 * server/services/legacyGenerationService.js
 * --------------------------------------------
 * Legacy generation support helpers — transitional module.
 *
 * This service exists to isolate remaining legacy generation behavior
 * during the transition to the modular orchestrator system.
 *
 * The long-term authoritative path is:
 *   server/orchestrator/generationOrchestrator.js
 *   server/context/assignmentContextBuilder.js
 *   server/promptBuilder.js
 *
 * Do NOT add new generation logic here.
 * This module exists only to support backward-compatible inline endpoints
 * in cacc-writer-server.js during the transition period.
 *
 * Contents:
 *   GENERATION_SYSTEM_PROMPT  — loaded from prompts/ at startup
 *   genInput(userPrompt)      — wraps raw prompt with system prompt
 *   buildFactsContext(facts)  — builds facts context string (legacy, currently unused)
 *   collectExamples(...)      — legacy KB retrieval (used by /api/similar-examples)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { CASES_DIR, CASE_ID_RE, normalizeFormType } from '../utils/caseUtils.js';
import { getCaseProjection } from '../caseRecord/caseRecordService.js';
import { readJSON } from '../utils/fileUtils.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts');
const VOICE_FILE  = path.join(__dirname, '..', '..', 'voice_training.json');

// ── Prompt loading ────────────────────────────────────────────────────────────

function loadPromptFile(filename) {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8').trim();
  } catch {
    return '';
  }
}

const _sysMain  = loadPromptFile('system_cacc_writer.txt');
const _sysStyle = loadPromptFile('style_guide_cresci.txt');

/**
 * GENERATION_SYSTEM_PROMPT
 * Combined system prompt for legacy generation calls.
 * New endpoints use buildPromptMessages() from server/promptBuilder.js instead.
 */
export const GENERATION_SYSTEM_PROMPT =
  [_sysMain, _sysStyle].filter(Boolean).join('\n\n---\n\n');

// ── genInput ──────────────────────────────────────────────────────────────────

/**
 * genInput(userPrompt)
 * Wraps a raw user prompt with the system prompt for legacy generation calls.
 * Used only by the raw-prompt path in POST /api/generate.
 *
 * @param {string} userPrompt
 * @returns {string | Array<{ role: string, content: string }>}
 */
export function genInput(userPrompt) {
  if (!GENERATION_SYSTEM_PROMPT) return userPrompt;
  return [
    { role: 'system', content: GENERATION_SYSTEM_PROMPT },
    { role: 'user',   content: userPrompt },
  ];
}

// ── buildFactsContext ─────────────────────────────────────────────────────────

/**
 * buildFactsContext(facts)
 * Builds a structured facts context string from a case facts object.
 * Legacy helper — currently unused in active endpoints.
 * Preserved for reference during transition.
 *
 * @param {object} facts — case facts.json object
 * @returns {string}
 */
export function buildFactsContext(facts) {
  if (!facts || !Object.keys(facts).length) return '';

  const s     = facts.subject      || {};
  const c     = facts.contract     || {};
  const m     = facts.market       || {};
  const n     = facts.neighborhood || {};
  const a     = facts.assignment   || {};
  const comps = facts.comps        || [];

  const v = (o) => (o && o.value != null ? o.value : null);
  const L = ['CASE FACT SHEET (use these facts; where null write [INSERT]):'];

  if (Object.keys(s).length) {
    L.push('\nSUBJECT PROPERTY:');
    if (v(s.address)) {
      L.push('  Address: ' + v(s.address) + ', ' + (v(s.city) || '') + ' ' + (v(s.state) || ''));
    }
    ['county', 'gla', 'beds', 'baths', 'yearBuilt', 'style', 'basement', 'garage',
     'condition', 'quality', 'siteSize', 'zoning', 'parcelId'].forEach(k => {
      if (v(s[k])) L.push('  ' + k + ': ' + v(s[k]));
    });
  }

  if (v(c.contractPrice) || v(c.contractDate)) {
    L.push('\nCONTRACT:');
    ['contractPrice', 'contractDate', 'closingDate', 'sellerConcessions',
     'financing', 'daysOnMarket', 'offeringHistory'].forEach(k => {
      if (v(c[k]) != null) L.push('  ' + k + ': ' + v(c[k]));
    });
  }

  const marketVals = Object.entries(m).filter(([, fobj]) => v(fobj));
  if (marketVals.length) {
    L.push('\nMARKET:');
    marketVals.forEach(([k, fobj]) => L.push('  ' + k + ': ' + v(fobj)));
  }

  if (v(n.boundaries) || v(n.description)) {
    L.push('\nNEIGHBORHOOD:');
    ['boundaries', 'description', 'landUse', 'builtUp'].forEach(k => {
      if (v(n[k])) L.push('  ' + k + ': ' + v(n[k]));
    });
  }

  if (v(a.intendedUse) || v(a.intendedUser)) {
    L.push('\nASSIGNMENT:');
    ['intendedUse', 'intendedUser', 'effectiveDate', 'extraordinaryAssumptions',
     'hypotheticalConditions', 'scopeOfWork'].forEach(k => {
      if (v(a[k])) L.push('  ' + k + ': ' + v(a[k]));
    });
  }

  if (comps.length) {
    L.push('\nCOMPARABLE SALES:');
    comps.forEach((comp, i) => {
      L.push('  Comp ' + (i + 1) + ':');
      ['address', 'salePrice', 'saleDate', 'gla', 'dom', 'adjustments'].forEach(k => {
        if (v(comp[k])) L.push('    ' + k + ': ' + v(comp[k]));
      });
    });
  }

  // Generic rendering for non-standard sections (commercial, income, etc.)
  const covered = new Set([
    'subject', 'contract', 'market', 'neighborhood',
    'assignment', 'comps', 'extractedAt', 'updatedAt',
  ]);
  for (const secKey of Object.keys(facts)) {
    if (covered.has(secKey)) continue;
    const sec = facts[secKey];
    if (Array.isArray(sec)) {
      const hasData = sec.some(item =>
        Object.entries(item).some(([k, fobj]) => k !== 'number' && v(fobj)),
      );
      if (!hasData) continue;
      L.push('\n' + secKey.toUpperCase() + ':');
      sec.forEach((item, i) => {
        L.push('  Item ' + (i + 1) + ':');
        Object.entries(item).forEach(([k, fobj]) => {
          if (k !== 'number' && v(fobj)) L.push('    ' + k + ': ' + v(fobj));
        });
      });
    } else if (sec && typeof sec === 'object') {
      const vals = Object.entries(sec).filter(([, fobj]) => v(fobj));
      if (!vals.length) continue;
      L.push('\n' + secKey.toUpperCase() + ':');
      vals.forEach(([k, fobj]) => L.push('  ' + k + ': ' + v(fobj)));
    }
  }

  return '\n\n' + L.join('\n');
}

// ── collectExamples ───────────────────────────────────────────────────────────

/**
 * collectExamples(fieldId, limit, formType)
 * Legacy KB retrieval — scans case feedback.json files and voice_training.json
 * for approved examples matching the given field and form type.
 *
 * Used by POST /api/similar-examples.
 * New endpoints use getRelevantExamplesWithVoice() from server/retrieval.js instead.
 *
 * @param {string|null} fieldId  — field ID to filter by (null = all fields)
 * @param {number}      limit    — max examples to return
 * @param {string|null} formType — form type to filter by (null = all types)
 * @returns {object[]}
 */
export function collectExamples(fieldId, limit, formType) {
  try {
    const all = [];

    if (fs.existsSync(CASES_DIR)) {
      const dirs = fs.readdirSync(CASES_DIR)
        .filter(d => CASE_ID_RE.test(d))
        .map(d => {
          try {
            return { d, mtime: fs.statSync(path.join(CASES_DIR, d)).mtimeMs };
          } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 50)
        .map(x => x.d);

      for (const id of dirs) {
        const fb   = readJSON(path.join(CASES_DIR, id, 'feedback.json'), []);
        const projection = getCaseProjection(id);
        const cft = normalizeFormType(projection?.meta?.formType);
        all.push(
          ...fb.filter(f =>
            (!fieldId  || f.fieldId === fieldId) &&
            (!formType || cft === formType) &&
            f.editedText &&
            f.editedText !== f.originalText &&
            f.rating !== 'down',
          ),
        );
      }
    }

    all.push(
      ...readJSON(VOICE_FILE, []).filter(e =>
        (!fieldId  || e.fieldId === fieldId) &&
        (!formType || normalizeFormType(e.formType) === formType) &&
        e.editedText,
      ),
    );

    return all
      .sort((a, b) =>
        new Date(b.savedAt || b.importedAt || 0) - new Date(a.savedAt || a.importedAt || 0),
      )
      .slice(0, limit || 10);
  } catch {
    return [];
  }
}
