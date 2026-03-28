/**
 * knowledgeBase.js
 * ----------------
 * Manages the local JSON knowledge base for Appraisal Agent.
 *
 * Storage layout:
 *   knowledge_base/
 *     index.json                    â† master index (all example metadata)
 *     approved_edits/               â† appraiser-approved edits (highest quality)
 *       <id>.json
 *     curated_examples/             â† hand-curated examples per form type
 *       1004/<id>.json
 *       1025/<id>.json
 *       1073/<id>.json
 *       commercial/<id>.json
 *     phrase_bank/
 *       phrases.json                â† reusable clauses
 *
 * Each example JSON file contains:
 *   {
 *     id, formType, fieldId, propertyType, marketType, marketArea,
 *     sourceType, qualityScore, tags, text, createdAt, updatedAt
 *   }
 *
 * How to extend:
 *   - To add vector search: replace the in-memory filter in getExamples()
 *     with an embedding lookup (e.g., using OpenAI embeddings + cosine similarity).
 *   - To add a database backend: swap readJSON/writeJSON with DB queries.
 *     The public API (addExample, getExamples, indexExamples) stays the same.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import log from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, '..', 'knowledge_base');
const INDEX_FILE = path.join(KB_DIR, 'index.json');
const APPROVED_DIR = path.join(KB_DIR, 'approved_edits');
const CURATED_DIR = path.join(KB_DIR, 'curated_examples');
const PHRASE_FILE = path.join(KB_DIR, 'phrase_bank', 'phrases.json');
const NARRATIVES_DIR        = path.join(KB_DIR, 'narratives');
const APPROVED_NARR_DIR     = path.join(KB_DIR, 'approvedNarratives');

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function readJSON(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function kbWritesDisabled() {
  return process.env.CACC_DISABLE_KB_WRITES === '1';
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// â”€â”€ Index management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * indexExamples()
 * Scans all example files on disk and rebuilds index.json from scratch.
 * Call this after bulk imports or manual file edits.
 *
 * @returns {object} The rebuilt index.
 */
export function indexExamples() {
  const examples = [];

  // Scan approved_edits/
  ensureDir(APPROVED_DIR);
  for (const file of fs.readdirSync(APPROVED_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const ex = readJSON(path.join(APPROVED_DIR, file));
      if (ex.id) examples.push({ ...ex, sourceType: 'approved_edit' });
    } catch (e) { log.warn('[KB] skipping corrupt file:', file, e.message); }
  }

  // Scan curated_examples/<formType>/
  ensureDir(CURATED_DIR);
  for (const formType of fs.readdirSync(CURATED_DIR)) {
    const formDir = path.join(CURATED_DIR, formType);
    if (!fs.statSync(formDir).isDirectory()) continue;
    for (const file of fs.readdirSync(formDir).filter(f => f.endsWith('.json'))) {
      try {
        const ex = readJSON(path.join(formDir, file));
        if (ex.id) examples.push({ ...ex, sourceType: ex.sourceType || 'curated' });
      } catch (e) { log.warn('[KB] skipping corrupt curated file:', file, e.message); }
    }
  }

  const counts = {
    approved_edits: examples.filter(e => e.sourceType === 'approved_edit').length,
    curated_examples: examples.filter(e => e.sourceType === 'curated').length,
    imported_examples: examples.filter(e => e.sourceType === 'imported').length,
    phrases: readJSON(PHRASE_FILE, { phrases: [] }).phrases.length,
  };

  const index = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    counts,
    examples,
  };

  if (!kbWritesDisabled()) {
    writeJSON(INDEX_FILE, index);
  }
  return index;
}

// â”€â”€ Core CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * addExample(data)
 * Saves a new example to disk and updates the index.
 *
 * @param {object} data
 *   Required: fieldId, text
 *   Optional: formType, propertyType, marketType, marketArea, sourceType,
 *             qualityScore (0â€“100), tags (string[])
 *
 * @returns {object} The saved example with generated id and timestamps.
 */
export function addExample(data) {
  const id = uuidv4().replace(/-/g, '').slice(0, 12);
  const now = new Date().toISOString();

  const example = {
    id,
    formType:     String(data.formType     || '1004'),
    fieldId:      String(data.fieldId      || 'unknown'),
    propertyType: String(data.propertyType || 'residential'),
    marketType:   String(data.marketType   || 'suburban'),
    marketArea:   String(data.marketArea   || ''),
    sourceType:   String(data.sourceType   || 'approved_edit'),
    qualityScore: Number(data.qualityScore ?? 80),
    tags:         Array.isArray(data.tags) ? data.tags : [],
    text:         String(data.text || '').trim(),
    createdAt:    now,
    updatedAt:    now,
  };

  if (!example.text) throw new Error('addExample: text is required');

  if (kbWritesDisabled()) {
    return example;
  }

  // Determine storage path based on sourceType
  let filePath;
  if (example.sourceType === 'approved_edit') {
    ensureDir(APPROVED_DIR);
    filePath = path.join(APPROVED_DIR, `${id}.json`);
  } else {
    const formDir = path.join(CURATED_DIR, example.formType);
    ensureDir(formDir);
    filePath = path.join(formDir, `${id}.json`);
  }

  writeJSON(filePath, example);

  // Update index incrementally (append + update counts)
  const index = readJSON(INDEX_FILE, { version: '1.0.0', examples: [], counts: {} });
  index.examples = index.examples.filter(e => e.id !== id); // deduplicate
  index.examples.push(example);
  index.lastUpdated = now;
  index.counts = {
    approved_edits:    index.examples.filter(e => e.sourceType === 'approved_edit').length,
    curated_examples:  index.examples.filter(e => e.sourceType === 'curated').length,
    imported_examples: index.examples.filter(e => e.sourceType === 'imported').length,
    phrases:           readJSON(PHRASE_FILE, { phrases: [] }).phrases.length,
  };
  writeJSON(INDEX_FILE, index);

  return example;
}

/**
 * getExamples(filters, limit)
 * Returns examples from the index matching the given filters.
 *
 * Ranking priority (highest first):
 *   1. approved_edit  (qualityScore weight Ã— 1.5)
 *   2. curated        (qualityScore weight Ã— 1.0)
 *   3. imported       (qualityScore weight Ã— 0.7)
 *
 * @param {object} filters
 *   @param {string} [filters.formType]
 *   @param {string} [filters.fieldId]
 *   @param {string} [filters.propertyType]
 *   @param {string} [filters.marketType]
 *
 * @param {number} [limit=5]  Maximum examples to return.
 *
 * @returns {object[]} Ranked examples.
 */
export function getExamples(filters = {}, limit = 5) {
  const index = readJSON(INDEX_FILE, { examples: [] });
  const all = Array.isArray(index.examples) ? index.examples : [];

  const SOURCE_WEIGHT = { approved_edit: 1.5, curated: 1.0, imported: 0.7 };

  const scored = all
    .filter(e => {
      if (filters.formType    && e.formType    !== filters.formType)    return false;
      if (filters.fieldId     && e.fieldId     !== filters.fieldId)     return false;
      if (filters.propertyType && e.propertyType !== filters.propertyType) return false;
      if (filters.marketType  && e.marketType  !== filters.marketType)  return false;
      return Boolean(e.text);
    })
    .map(e => ({
      ...e,
      _score: (e.qualityScore || 50) * (SOURCE_WEIGHT[e.sourceType] || 0.7),
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  // Strip internal score before returning
  return scored.map(({ _score, ...rest }) => rest);
}

/**
 * getPhrases(tag)
 * Returns phrase bank entries, optionally filtered by tag.
 *
 * @param {string} [tag]  Filter by tag (e.g. 'flood_zone', 'zoning').
 * @returns {object[]}
 */
export function getPhrases(tag) {
  const bank = readJSON(PHRASE_FILE, { phrases: [] });
  const phrases = Array.isArray(bank.phrases) ? bank.phrases : [];
  return tag ? phrases.filter(p => p.tag === tag) : phrases;
}

// â”€â”€ Personal Appraiser Voice Engine â€” KB integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * addApprovedNarrative(data)
 *
 * Saves an approved narrative section to the voice engine storage layer.
 * Inline implementation using the same uuidv4 + readJSON/writeJSON helpers
 * already available in this module â€” avoids circular ESM import issues.
 *
 * Called from all approval paths in cacc-writer-server.js.
 *
 * @param {object} data
 *   Required: text, sectionType (or fieldId), formType
 *   Optional: meta (case meta.json object), sourceReportId, qualityScore,
 *             approvedBy, tags, customMetadata
 * @returns {object} The saved entry
 */
export function addApprovedNarrative(data) {
  ensureDir(APPROVED_NARR_DIR);
  const id  = uuidv4().replace(/-/g, '').slice(0, 12);
  const now = new Date().toISOString();

  const meta = (data.meta && typeof data.meta === 'object') ? data.meta : {};

  const entry = {
    id,
    text:              String(data.text || '').trim(),
    sectionType:       String(data.sectionType || data.fieldId || '').trim(),
    formType:          String(data.formType          || meta.formType          || '1004').trim(),
    propertyType:      String(data.propertyType      || meta.propertyType      || 'residential').trim(),
    assignmentPurpose: String(data.assignmentPurpose || meta.assignmentPurpose || meta.purpose || '').trim(),
    loanProgram:       String(data.loanProgram       || meta.loanProgram       || '').trim(),
    subjectCondition:  String(data.subjectCondition  || meta.subjectCondition  || meta.condition || '').trim(),
    state:             String(data.state             || meta.state             || '').trim(),
    county:            String(data.county            || meta.county            || '').trim(),
    city:              String(data.city              || meta.city              || '').trim(),
    marketType:        String(data.marketType        || meta.marketType        || 'suburban').trim(),
    approvalTimestamp: now,
    sourceType:        'approvedNarrative',
    sourceReportId:    String(data.sourceReportId    || meta.caseId            || '').trim(),
    qualityScore:      typeof data.qualityScore === 'number' ? data.qualityScore : 95,
    tags:              Array.isArray(data.tags) ? data.tags : [],
    customMetadata:    (data.customMetadata && typeof data.customMetadata === 'object' && !Array.isArray(data.customMetadata))
                         ? data.customMetadata : {},
    createdAt:         now,
    updatedAt:         now,
  };

  // Optional standard fields â€” only include if non-empty
  for (const k of ['marketArea', 'neighborhood', 'occupancyType', 'reportConditionMode', 'clientName', 'approvedBy']) {
    const v = String(data[k] || meta[k] || '').trim();
    if (v) entry[k] = v;
  }

  if (!entry.text)        throw new Error('addApprovedNarrative: text is required');
  if (!entry.sectionType) throw new Error('addApprovedNarrative: sectionType (or fieldId) is required');

  if (kbWritesDisabled()) {
    return entry;
  }

  // Save individual entry file (includes text)
  writeJSON(path.join(APPROVED_NARR_DIR, `${id}.json`), entry);

  // Update index â€” metadata only, no text (keeps index lean for fast retrieval)
  const indexFile = path.join(APPROVED_NARR_DIR, 'index.json');
  const index = readJSON(indexFile, {
    version:     '1.0.0',
    description: 'Personal Appraiser Voice Engine â€” Approved Narrative Index',
    count:       0,
    entries:     [],
  });
  const { text: _t, ...indexEntry } = entry;  // strip text from index entry
  indexEntry.hasText = true;
  index.entries     = index.entries.filter(e => e.id !== id); // deduplicate
  index.entries.push(indexEntry);
  index.count       = index.entries.length;
  index.lastUpdated = now;
  writeJSON(indexFile, index);

  return entry;
}

/**
 * getApprovedNarratives(query, limit)
 *
 * Retrieves top-N approved narrative examples using weighted multi-dimensional scoring.
 * Delegates to server/retrieval/approvedNarrativeRetriever.js.
 *
 * @param {object} query   Retrieval dimensions (sectionType, formType, county, etc.)
 * @param {number} [limit] Max results (default: MAX_VOICE_EXAMPLES from retrievalWeights.js)
 * @returns {object[]}     Scored entries with full text, sorted by score descending
 */
export { getApprovedNarratives } from './retrieval/approvedNarrativeRetriever.js';

// â”€â”€ Narrative template library â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * getNarrativeTemplate(formType, category, key)
 *
 * Returns a narrative template entry from the form-specific narratives file.
 * Used to inject UAD condition language, market condition guidance, and
 * other structured templates into generation prompts.
 *
 * @param {string} formType  e.g. '1004'
 * @param {string} category  e.g. 'condition', 'market_conditions', 'neighborhood_description'
 * @param {string} key       e.g. 'C3', 'C4', 'stable', 'suburban'
 *
 * @returns {object|null}  Template object with promptInstruction, narrativeGuidance, etc.
 *                         Returns null if not found.
 *
 * Example:
 *   getNarrativeTemplate('1004', 'condition', 'C3')
 *   â†’ { uadDefinition: '...', narrativeGuidance: '...', promptInstruction: '...' }
 */
export function getNarrativeTemplate(formType, category, key) {
  if (!formType || !category || !key) return null;
  try {
    const narrativeFile = path.join(NARRATIVES_DIR, `${formType}Narratives.json`);
    if (!fs.existsSync(narrativeFile)) return null;
    const data = readJSON(narrativeFile, {});
    const categoryData = data[category];
    if (!categoryData || typeof categoryData !== 'object') return null;
    return categoryData[key] || null;
  } catch {
    return null;
  }
}

