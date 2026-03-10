/**
 * saveApprovedNarrative.js
 * ------------------------
 * Personal Appraiser Voice Engine — Storage Layer
 *
 * Saves approved narrative sections to knowledge_base/approvedNarratives/
 * with the full metadata schema required for weighted retrieval.
 *
 * This is the primary write path for the voice engine. Every section
 * approved by the appraiser flows through here, building the style memory
 * that future generation draws from.
 *
 * Storage layout:
 *   knowledge_base/approvedNarratives/
 *     index.json          ← master index (all entries + metadata, no text)
 *     <id>.json           ← individual entry files (includes text)
 *
 * Schema (fixed core + optional standard + customMetadata):
 *   Required:  id, text, sectionType, formType, propertyType, assignmentPurpose,
 *              loanProgram, subjectCondition, state, county, city, marketType,
 *              approvalTimestamp
 *   Optional:  marketArea, neighborhood, occupancyType, reportConditionMode,
 *              clientName, sourceReportId, qualityScore, approvedBy, tags
 *   Extension: customMetadata (backend-controlled only — no free-form UI keys)
 *
 * customMetadata policy:
 *   - Populated through backend logic and developer-approved mappings only.
 *   - NOT exposed as a free-form key creator in the UI.
 *   - Prevents schema drift and keeps retrieval ranking consistent.
 *
 * Active production scope: 1004 (ACI) + commercial (Real Quantum)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR              = path.join(__dirname, '..', '..', 'knowledge_base');
const APPROVED_NARR_DIR   = path.join(KB_DIR, 'approvedNarratives');
const APPROVED_NARR_INDEX = path.join(APPROVED_NARR_DIR, 'index.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJSON(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeStr(v, fallback = '') {
  if (v == null || v === '') return fallback;
  return String(v).trim();
}

// ── Schema builder ────────────────────────────────────────────────────────────

/**
 * buildEntry(data)
 * Constructs a validated, normalized approved narrative entry.
 * Required fields default to empty string if not provided (never null).
 * Optional fields are omitted if not provided (keeps index lean).
 *
 * @param {object} data
 * @returns {object} Normalized entry ready for storage
 */
function buildEntry(data) {
  const id  = uuidv4().replace(/-/g, '').slice(0, 12);
  const now = new Date().toISOString();

  // ── Required core fields ──────────────────────────────────────────────────
  const entry = {
    id,
    text:              safeStr(data.text),
    sectionType:       safeStr(data.sectionType   || data.fieldId),
    formType:          safeStr(data.formType,        '1004'),
    propertyType:      safeStr(data.propertyType,    'residential'),
    assignmentPurpose: safeStr(data.assignmentPurpose),
    loanProgram:       safeStr(data.loanProgram),
    subjectCondition:  safeStr(data.subjectCondition),
    state:             safeStr(data.state),
    county:            safeStr(data.county),
    city:              safeStr(data.city),
    marketType:        safeStr(data.marketType,      'suburban'),
    approvalTimestamp: safeStr(data.approvalTimestamp || now),
    // Internal source type — always 'approvedNarrative' for this storage layer
    sourceType:        'approvedNarrative',
  };

  if (!entry.text) throw new Error('saveApprovedNarrative: text is required');
  if (!entry.sectionType) throw new Error('saveApprovedNarrative: sectionType (or fieldId) is required');

  // ── Optional standard fields (only include if non-empty) ─────────────────
  const optionalFields = [
    'marketArea', 'neighborhood', 'occupancyType', 'reportConditionMode',
    'clientName', 'sourceReportId', 'approvedBy',
  ];
  for (const key of optionalFields) {
    const v = safeStr(data[key]);
    if (v) entry[key] = v;
  }

  // qualityScore: default 95 for approved narratives (highest trust tier)
  entry.qualityScore = typeof data.qualityScore === 'number'
    ? Math.min(100, Math.max(0, data.qualityScore))
    : 95;

  // tags: array of strings
  entry.tags = Array.isArray(data.tags) ? data.tags.filter(t => typeof t === 'string') : [];

  // customMetadata: backend-controlled only — validated object, no free-form UI keys
  entry.customMetadata = (data.customMetadata && typeof data.customMetadata === 'object' && !Array.isArray(data.customMetadata))
    ? data.customMetadata
    : {};

  entry.createdAt  = now;
  entry.updatedAt  = now;

  return entry;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * saveApprovedNarrative(data)
 *
 * Saves an approved narrative section to the voice engine storage.
 * Called from all approval paths in cacc-writer-server.js.
 *
 * @param {object} data
 *   Required:
 *     text          {string}  The approved narrative text
 *     sectionType   {string}  e.g. 'neighborhood_description' (or pass fieldId)
 *     formType      {string}  e.g. '1004', 'commercial'
 *
 *   From case meta.json (pass the full meta object as `meta`):
 *     meta          {object}  Case meta — assignmentPurpose, loanProgram,
 *                             subjectCondition, state, county, city, marketType,
 *                             propertyType, occupancyType, reportConditionMode,
 *                             clientName, marketArea, neighborhood
 *
 *   Optional:
 *     sourceReportId  {string}  Case ID for batch traceability
 *     qualityScore    {number}  0–100 (default: 95)
 *     approvedBy      {string}  e.g. 'cresci'
 *     tags            {string[]}
 *     customMetadata  {object}  Backend-controlled extension fields only
 *
 * @returns {object} The saved entry (without text in index, with text in file)
 */
export function saveApprovedNarrative(data) {
  ensureDir(APPROVED_NARR_DIR);

  // Flatten meta fields into data for schema builder
  const meta = (data.meta && typeof data.meta === 'object') ? data.meta : {};
  const merged = {
    ...data,
    assignmentPurpose:   data.assignmentPurpose   || meta.assignmentPurpose   || meta.purpose || '',
    loanProgram:         data.loanProgram         || meta.loanProgram         || '',
    subjectCondition:    data.subjectCondition     || meta.subjectCondition    || meta.condition || '',
    state:               data.state               || meta.state               || '',
    county:              data.county              || meta.county              || '',
    city:                data.city                || meta.city                || '',
    marketType:          data.marketType          || meta.marketType          || 'suburban',
    propertyType:        data.propertyType        || meta.propertyType        || 'residential',
    occupancyType:       data.occupancyType       || meta.occupancyType       || '',
    reportConditionMode: data.reportConditionMode || meta.reportConditionMode || '',
    clientName:          data.clientName          || meta.clientName          || '',
    marketArea:          data.marketArea          || meta.marketArea          || '',
    neighborhood:        data.neighborhood        || meta.neighborhood        || '',
    sourceReportId:      data.sourceReportId      || meta.caseId              || '',
  };

  const entry = buildEntry(merged);

  // ── Save individual entry file (includes text) ────────────────────────────
  const entryFile = path.join(APPROVED_NARR_DIR, `${entry.id}.json`);
  writeJSON(entryFile, entry);

  // ── Update index (metadata only — no text in index for performance) ───────
  const index = readJSON(APPROVED_NARR_INDEX, {
    version:     '1.0.0',
    description: 'Personal Appraiser Voice Engine — Approved Narrative Index',
    lastUpdated: entry.createdAt,
    count:       0,
    entries:     [],
  });

  // Build index entry (all fields except text — text is in the individual file)
  const { text: _text, ...indexEntry } = entry;  // eslint-disable-line no-unused-vars
  indexEntry.hasText = true;

  // Deduplicate by id (shouldn't happen but defensive)
  index.entries = index.entries.filter(e => e.id !== entry.id);
  index.entries.push(indexEntry);
  index.count       = index.entries.length;
  index.lastUpdated = entry.createdAt;

  writeJSON(APPROVED_NARR_INDEX, index);

  return entry;
}

/**
 * getApprovedNarrativeIndex()
 * Returns the full index (metadata only, no text).
 * Used by the retriever to score candidates without loading all text files.
 *
 * @returns {object[]} Array of index entries
 */
export function getApprovedNarrativeIndex() {
  ensureDir(APPROVED_NARR_DIR);
  const index = readJSON(APPROVED_NARR_INDEX, { entries: [] });
  return Array.isArray(index.entries) ? index.entries : [];
}

/**
 * getApprovedNarrativeById(id)
 * Loads the full entry (including text) for a specific narrative.
 * Used after scoring to load the text of top-ranked candidates.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function getApprovedNarrativeById(id) {
  const entryFile = path.join(APPROVED_NARR_DIR, `${id}.json`);
  if (!fs.existsSync(entryFile)) return null;
  try { return JSON.parse(fs.readFileSync(entryFile, 'utf8')); }
  catch { return null; }
}

/**
 * getApprovedNarrativesDir()
 * Returns the storage directory path.
 * Used by knowledgeBase.js for indexing.
 *
 * @returns {string}
 */
export function getApprovedNarrativesDir() {
  return APPROVED_NARR_DIR;
}
