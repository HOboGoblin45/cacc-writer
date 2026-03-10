/**
 * server/context/retrievalPackBuilder.js
 * ----------------------------------------
 * Builds a RetrievalPack for an assignment.
 *
 * Retrieves ALL narrative memory ONCE per assignment:
 *   - Approved narrative examples per section
 *   - Phrase bank candidates
 *   - Voice/style examples
 *
 * Caches the result in SQLite for 1 hour (TTL configurable).
 * On cache hit, returns immediately without disk I/O.
 *
 * Performance target: < 500ms (cold), < 10ms (cache hit)
 *
 * Usage:
 *   import { buildRetrievalPack } from './context/retrievalPackBuilder.js';
 *   const pack = await buildRetrievalPack(context, plan);
 *   const sectionMemory = pack.sections['neighborhood_description'];
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';
import { getApprovedNarrativeIndex, getApprovedNarrativeById } from '../storage/saveApprovedNarrative.js';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PHRASE_BANK_PATH = path.join(
  __dirname, '..', '..', 'knowledge_base', 'phrase_bank', 'phrases.json'
);
const KB_INDEX_PATH = path.join(
  __dirname, '..', '..', 'knowledge_base', 'index.json'
);

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_EXAMPLES_PER_SECTION = 3;
const MAX_PHRASES_PER_SECTION  = 5;

// ── Loaders ───────────────────────────────────────────────────────────────────

function loadPhrases() {
  try {
    const data = JSON.parse(fs.readFileSync(PHRASE_BANK_PATH, 'utf8'));
    return Array.isArray(data.phrases) ? data.phrases : [];
  } catch {
    return [];
  }
}

function loadKbIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(KB_INDEX_PATH, 'utf8'));
    return Array.isArray(data.examples) ? data.examples : [];
  } catch {
    return [];
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Score a KB example against the current assignment context.
 * Higher score = better match.
 */
function scoreExample(example, context, sectionId) {
  let score = example.qualityScore || 70;

  // Exact form type match
  if (example.formType === context.formType) score += 20;

  // Field/section match
  const exFieldId = example.fieldId || example.sectionType || '';
  if (exFieldId === sectionId) score += 30;

  // Market type match
  if (example.marketType && example.marketType === context.market?.marketType) score += 10;

  // City match
  const exCity = (example.marketArea || example.city || '').toLowerCase();
  const ctxCity = (context.subject?.city || context.market?.marketArea || '').toLowerCase();
  if (exCity && ctxCity && exCity.includes(ctxCity)) score += 15;

  // Source type bonus
  if (example.sourceType === 'approvedNarrative') score += 15;
  if (example.sourceType === 'approved_edit')     score += 10;
  if (example.sourceType === 'imported')          score += 0;

  return score;
}

/**
 * Score a phrase against a section.
 */
function scorePhrase(phrase, sectionId) {
  const tags = Array.isArray(phrase.tags) ? phrase.tags : [];
  const sectionTagMap = {
    neighborhood_description:  ['market_conditions', 'flood_zone', 'zoning'],
    neighborhood:              ['market_conditions', 'flood_zone', 'zoning'],
    market_conditions:         ['market_conditions'],
    market_overview:           ['market_conditions'],
    site_description:          ['flood_zone', 'zoning', 'fha_well_septic', 'rural_acreage'],
    improvements_description:  ['accessory_dwelling'],
    condition_description:     [],
    contract_analysis:         ['concession_adjustment'],
    concessions_analysis:      ['concession_adjustment'],
    highest_best_use:          ['highest_best_use', 'zoning'],
    sales_comparison_summary:  ['concession_adjustment', 'gla_adjustment', 'market_conditions'],
    reconciliation:            ['highest_best_use', 'market_conditions'],
  };

  const relevantTags = sectionTagMap[sectionId] || [];
  const matchCount   = tags.filter(t => relevantTags.includes(t)).length;
  return matchCount > 0 ? 100 + matchCount * 10 : 0;
}

// ── Section memory builder ────────────────────────────────────────────────────

function buildSectionMemory(sectionId, context, allExamples, allPhrases) {
  // Score and rank examples for this section
  const scored = allExamples
    .map(ex => ({ ...ex, _score: scoreExample(ex, context, sectionId) }))
    .filter(ex => ex._score > 50) // minimum relevance threshold
    .sort((a, b) => b._score - a._score)
    .slice(0, MAX_EXAMPLES_PER_SECTION);

  // Score and rank phrases for this section
  const relevantPhrases = allPhrases
    .map(ph => ({ ...ph, _score: scorePhrase(ph, sectionId) }))
    .filter(ph => ph._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, MAX_PHRASES_PER_SECTION);

  return {
    sectionId,
    examples:      scored,
    phrases:       relevantPhrases,
    exampleCount:  scored.length,
    phraseCount:   relevantPhrases.length,
    exampleIds:    scored.map(e => e.id),
  };
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function getCachedPack(assignmentId) {
  const db  = getDb();
  const now = new Date().toISOString();
  const row = db.prepare(`
    SELECT pack_json FROM retrieval_cache
     WHERE assignment_id = ?
       AND section_id IS NULL
       AND expires_at > ?
     ORDER BY created_at DESC
     LIMIT 1
  `).get(assignmentId, now);

  if (!row) return null;
  try {
    return JSON.parse(row.pack_json);
  } catch {
    return null;
  }
}

function saveCachedPack(assignmentId, pack) {
  const db        = getDb();
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

  // Evict old cache entries for this assignment
  db.prepare(`
    DELETE FROM retrieval_cache
     WHERE assignment_id = ? AND section_id IS NULL
  `).run(assignmentId);

  db.prepare(`
    INSERT INTO retrieval_cache (id, assignment_id, section_id, pack_json, expires_at, created_at)
    VALUES (?, ?, NULL, ?, ?, datetime('now'))
  `).run(uuidv4(), assignmentId, JSON.stringify(pack), expiresAt);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a RetrievalPack for an assignment.
 * Retrieves all narrative memory once and caches it.
 *
 * @param {object} context — AssignmentContext
 * @param {object} plan    — ReportPlan
 * @returns {Promise<object>} RetrievalPack
 */
export async function buildRetrievalPack(context, plan) {
  const t0 = Date.now();

  // ── Cache check ─────────────────────────────────────────────────────────────
  if (context.id) {
    const cached = getCachedPack(context.id);
    if (cached) {
      cached._fromCache  = true;
      cached._retrievalMs = Date.now() - t0;
      return cached;
    }
  }

  // ── Load all memory sources once ────────────────────────────────────────────
  const t1 = Date.now();

  // 1. Approved narratives index
  let narrativeIndex = [];
  try {
    narrativeIndex = getApprovedNarrativeIndex() || [];
  } catch {
    narrativeIndex = [];
  }

  // 2. Legacy KB index (approved_edits + imported)
  const kbExamples = loadKbIndex();

  // 3. Phrase bank
  const phrases = loadPhrases();

  // Merge all examples, deduplicating by id
  const allExamplesMap = new Map();
  for (const ex of kbExamples) {
    if (ex.id) allExamplesMap.set(ex.id, ex);
  }
  for (const ex of narrativeIndex) {
    if (ex.id) allExamplesMap.set(ex.id, { ...ex, sourceType: 'approvedNarrative' });
  }
  const allExamples = Array.from(allExamplesMap.values());

  const loadMs = Date.now() - t1;

  // ── Build per-section memory ─────────────────────────────────────────────────
  const t2 = Date.now();
  const sections = {};
  for (const sectionDef of plan.sections) {
    sections[sectionDef.id] = buildSectionMemory(
      sectionDef.id,
      context,
      allExamples,
      phrases
    );
  }
  const rankMs = Date.now() - t2;

  // ── Compute retrieval stats ──────────────────────────────────────────────────
  const totalExamplesUsed = Object.values(sections)
    .reduce((sum, s) => sum + s.exampleCount, 0);

  const pack = {
    assignmentId:        context.id,
    caseId:              context.caseId,
    formType:            context.formType,
    sections,

    // Global stats
    totalMemoryScanned:  allExamples.length,
    totalPhrasesScanned: phrases.length,
    totalExamplesUsed,
    fromCache:           false,

    // Timing breakdown
    _loadMs:       loadMs,
    _rankMs:       rankMs,
    _retrievalMs:  Date.now() - t0,
    _builtAt:      new Date().toISOString(),
  };

  // ── Cache the pack ───────────────────────────────────────────────────────────
  if (context.id) {
    try {
      saveCachedPack(context.id, pack);
    } catch {
      // Non-fatal — cache failure should not block generation
    }
  }

  return pack;
}

/**
 * Invalidate the retrieval cache for an assignment.
 * Call this when new memory items are added.
 *
 * @param {string} assignmentId
 */
export function invalidateRetrievalCache(assignmentId) {
  const db = getDb();
  db.prepare('DELETE FROM retrieval_cache WHERE assignment_id = ?').run(assignmentId);
}

/**
 * Get retrieval stats for a pack (for metrics logging).
 *
 * @param {object} pack
 * @returns {object}
 */
export function getRetrievalStats(pack) {
  return {
    totalMemoryScanned:  pack.totalMemoryScanned  || 0,
    totalPhrasesScanned: pack.totalPhrasesScanned || 0,
    totalExamplesUsed:   pack.totalExamplesUsed   || 0,
    fromCache:           pack.fromCache           || pack._fromCache || false,
    retrievalMs:         pack._retrievalMs        || 0,
  };
}
