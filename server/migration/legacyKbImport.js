/**
 * server/migration/legacyKbImport.js
 * ------------------------------------
 * Imports existing flat-file knowledge base into the SQLite memory_items table.
 *
 * Sources (in priority order):
 *   1. knowledge_base/approvedNarratives/  → approved=1, quality_score=95
 *   2. knowledge_base/approved_edits/      → approved=1, quality_score=85
 *   3. knowledge_base/index.json (imported entries) → approved=0, quality_score=70
 *
 * Deduplication:
 *   - SHA-256 text hash used as unique key
 *   - Higher-priority source wins on conflict
 *   - approvedNarratives always overrides approved_edits on same text
 *
 * Idempotent: safe to run multiple times — skips already-imported items.
 *
 * Usage:
 *   import { runLegacyKbImport } from './migration/legacyKbImport.js';
 *   const result = await runLegacyKbImport();
 *   // { imported, skipped, errors, sources }
 *
 * API endpoint: POST /api/db/migrate-legacy-kb
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_ROOT   = path.join(__dirname, '..', '..', 'knowledge_base');

const APPROVED_NARRATIVES_DIR = path.join(KB_ROOT, 'approvedNarratives');
const APPROVED_EDITS_DIR      = path.join(KB_ROOT, 'approved_edits');
const KB_INDEX_PATH           = path.join(KB_ROOT, 'index.json');
const APPROVED_NARRATIVES_INDEX = path.join(APPROVED_NARRATIVES_DIR, 'index.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function textHash(text) {
  return createHash('sha256')
    .update(String(text || '').trim().toLowerCase())
    .digest('hex')
    .slice(0, 32); // 32-char prefix is sufficient for dedup
}

function readJSON(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function safeStr(v) {
  return v != null ? String(v) : null;
}

// ── Section type normalizer ───────────────────────────────────────────────────
// Maps various fieldId / sectionType values to canonical section IDs

const SECTION_TYPE_MAP = {
  // 1004 fields
  neighborhood_description:    'neighborhood_description',
  neighborhood:                'neighborhood_description',
  market_conditions:           'market_conditions',
  market_conditions_addendum:  'market_conditions',
  site_description:            'site_description',
  site_comments:               'site_description',
  improvements_description:    'improvements_description',
  improvements_condition:      'improvements_description',
  improvement_description:     'improvements_description',
  condition_description:       'condition_description',
  contract_analysis:           'contract_analysis',
  concessions_analysis:        'concessions_analysis',
  concessions:                 'concessions_analysis',
  highest_best_use:            'highest_best_use',
  hbu_analysis:                'highest_best_use',
  sales_comparison_summary:    'sales_comparison_summary',
  sca_summary:                 'sales_comparison_summary',
  sales_comparison:            'sales_comparison_summary',
  sales_comparison_commentary: 'sales_comparison_summary',
  reconciliation:              'reconciliation',
  // Commercial fields
  market_overview:             'market_overview',
  market_area:                 'market_overview',
  neighborhood_commercial:     'neighborhood',
};

function normalizeSectionType(fieldId) {
  if (!fieldId) return 'general';
  const lower = String(fieldId).toLowerCase().trim();
  return SECTION_TYPE_MAP[lower] || lower;
}

// ── Insert helper ─────────────────────────────────────────────────────────────

/**
 * Insert a memory item into SQLite.
 * Returns 'inserted' | 'skipped' | 'upgraded' | 'error'
 */
function insertMemoryItem(item, priority) {
  const db   = getDb();
  const hash = textHash(item.text);

  if (!item.text || item.text.trim().length < 30) {
    return 'skipped'; // too short to be useful
  }

  try {
    // Check if this hash already exists
    const existing = db.prepare(
      'SELECT id, source_type, quality_score FROM memory_items WHERE text_hash = ?'
    ).get(hash);

    if (existing) {
      // Upgrade if new source has higher priority
      const existingPriority = SOURCE_PRIORITY[existing.source_type] || 0;
      if (priority > existingPriority) {
        db.prepare(`
          UPDATE memory_items SET
            source_type   = ?,
            quality_score = ?,
            approved      = ?,
            updated_at    = datetime('now')
          WHERE text_hash = ?
        `).run(item.sourceType, item.qualityScore, item.approved ? 1 : 0, hash);
        return 'upgraded';
      }
      return 'skipped';
    }

    // Insert new item
    db.prepare(`
      INSERT INTO memory_items (
        id, section_type, form_type, text, text_hash,
        source_type, quality_score, approved, staged,
        property_type, market_type, city, county, state,
        assignment_purpose, loan_program, subject_condition,
        tags_json, metadata_json, source_file, source_report_id,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        datetime('now'), datetime('now')
      )
    `).run(
      uuidv4(),
      normalizeSectionType(item.sectionType || item.fieldId),
      safeStr(item.formType)    || '1004',
      item.text.trim(),
      hash,
      safeStr(item.sourceType)  || 'imported',
      Number(item.qualityScore) || 70,
      item.approved ? 1 : 0,
      item.staged   ? 1 : 0,
      safeStr(item.propertyType)      || null,
      safeStr(item.marketType)        || null,
      safeStr(item.city || item.marketArea) || null,
      safeStr(item.county)            || null,
      safeStr(item.state)             || null,
      safeStr(item.assignmentPurpose) || null,
      safeStr(item.loanProgram)       || null,
      safeStr(item.subjectCondition)  || null,
      JSON.stringify(Array.isArray(item.tags) ? item.tags : []),
      JSON.stringify(item.metadata   || item.customMetadata || {}),
      safeStr(item.sourceFile)        || null,
      safeStr(item.sourceReportId || item.id) || null
    );

    return 'inserted';

  } catch (err) {
    log.error('legacyKbImport:insert', { error: err.message, hash });
    return 'error';
  }
}

// Source priority for deduplication (higher = wins)
const SOURCE_PRIORITY = {
  approvedNarrative: 3,
  approved_edit:     2,
  imported:          1,
  voice:             3,
  staged:            0,
};

// ── Source 1: approvedNarratives/ ────────────────────────────────────────────

async function importApprovedNarratives(stats) {
  if (!fs.existsSync(APPROVED_NARRATIVES_DIR)) return;

  // Load from index.json if it exists
  const index = readJSON(APPROVED_NARRATIVES_INDEX, null);
  const items = Array.isArray(index) ? index : [];

  // Also scan individual .json files not in the index
  let files = [];
  try {
    files = fs.readdirSync(APPROVED_NARRATIVES_DIR)
      .filter(f => f.endsWith('.json') && f !== 'index.json');
  } catch { /* dir may be empty */ }

  const processedIds = new Set(items.map(i => i.id).filter(Boolean));

  // Process index entries
  for (const entry of items) {
    if (!entry.text) continue;
    const result = insertMemoryItem({
      ...entry,
      sourceType:   'approvedNarrative',
      qualityScore: entry.qualityScore || 95,
      approved:     true,
      staged:       false,
      sectionType:  entry.sectionType || entry.fieldId,
    }, SOURCE_PRIORITY.approvedNarrative);

    stats.sources.approvedNarratives++;
    if (result === 'inserted')  stats.imported++;
    else if (result === 'upgraded') { stats.imported++; stats.upgraded++; }
    else if (result === 'skipped')  stats.skipped++;
    else if (result === 'error')    stats.errors++;
  }

  // Process individual files not in index
  for (const file of files) {
    const filePath = path.join(APPROVED_NARRATIVES_DIR, file);
    const data     = readJSON(filePath, null);
    if (!data || !data.text) continue;

    const id = data.id || file.replace('.json', '');
    if (processedIds.has(id)) continue; // already processed via index

    const result = insertMemoryItem({
      ...data,
      sourceType:   'approvedNarrative',
      qualityScore: data.qualityScore || 95,
      approved:     true,
      staged:       false,
      sourceFile:   file,
    }, SOURCE_PRIORITY.approvedNarrative);

    stats.sources.approvedNarratives++;
    if (result === 'inserted')  stats.imported++;
    else if (result === 'upgraded') { stats.imported++; stats.upgraded++; }
    else if (result === 'skipped')  stats.skipped++;
    else if (result === 'error')    stats.errors++;
  }
}

// ── Source 2: approved_edits/ ─────────────────────────────────────────────────

async function importApprovedEdits(stats) {
  if (!fs.existsSync(APPROVED_EDITS_DIR)) return;

  let files = [];
  try {
    files = fs.readdirSync(APPROVED_EDITS_DIR).filter(f => f.endsWith('.json'));
  } catch { return; }

  for (const file of files) {
    const filePath = path.join(APPROVED_EDITS_DIR, file);
    const data     = readJSON(filePath, null);
    if (!data || !data.text) continue;

    const result = insertMemoryItem({
      ...data,
      sourceType:   'approved_edit',
      qualityScore: data.qualityScore || 85,
      approved:     true,
      staged:       false,
      sourceFile:   file,
    }, SOURCE_PRIORITY.approved_edit);

    stats.sources.approvedEdits++;
    if (result === 'inserted')  stats.imported++;
    else if (result === 'upgraded') { stats.imported++; stats.upgraded++; }
    else if (result === 'skipped')  stats.skipped++;
    else if (result === 'error')    stats.errors++;
  }
}

// ── Source 3: knowledge_base/index.json ──────────────────────────────────────

async function importKbIndex(stats) {
  const index = readJSON(KB_INDEX_PATH, null);
  if (!index) return;

  const examples = Array.isArray(index.examples) ? index.examples : [];

  for (const entry of examples) {
    if (!entry.text) continue;

    // Skip if already imported from a higher-priority source
    const sourceType = entry.sourceType || 'imported';
    if (sourceType === 'approvedNarrative' || sourceType === 'approved_edit') {
      // These are handled by the dedicated importers above
      continue;
    }

    const result = insertMemoryItem({
      ...entry,
      sourceType:   'imported',
      qualityScore: entry.qualityScore || 70,
      approved:     false,
      staged:       false,
    }, SOURCE_PRIORITY.imported);

    stats.sources.kbIndex++;
    if (result === 'inserted')  stats.imported++;
    else if (result === 'upgraded') { stats.imported++; stats.upgraded++; }
    else if (result === 'skipped')  stats.skipped++;
    else if (result === 'error')    stats.errors++;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the full legacy KB import into SQLite memory_items.
 * Idempotent — safe to run multiple times.
 *
 * @returns {Promise<ImportResult>}
 *   {
 *     ok: boolean,
 *     imported: number,
 *     skipped: number,
 *     upgraded: number,
 *     errors: number,
 *     sources: { approvedNarratives, approvedEdits, kbIndex },
 *     durationMs: number,
 *   }
 */
export async function runLegacyKbImport() {
  const t0    = Date.now();
  const stats = {
    imported: 0,
    skipped:  0,
    upgraded: 0,
    errors:   0,
    sources: {
      approvedNarratives: 0,
      approvedEdits:      0,
      kbIndex:            0,
    },
  };

  log.info('legacyKbImport:start', { detail: 'Starting legacy KB import' });

  // Run in priority order: approvedNarratives first, then approved_edits, then index
  await importApprovedNarratives(stats);
  log.info('legacyKbImport:approvedNarratives', { processed: stats.sources.approvedNarratives });

  await importApprovedEdits(stats);
  log.info('legacyKbImport:approvedEdits', { processed: stats.sources.approvedEdits });

  await importKbIndex(stats);
  log.info('legacyKbImport:kbIndex', { processed: stats.sources.kbIndex });

  const durationMs = Date.now() - t0;

  log.info('legacyKbImport:complete', { imported: stats.imported, skipped: stats.skipped, upgraded: stats.upgraded, errors: stats.errors, durationMs });

  return {
    ok:        stats.errors === 0 || stats.imported > 0,
    imported:  stats.imported,
    skipped:   stats.skipped,
    upgraded:  stats.upgraded,
    errors:    stats.errors,
    sources:   stats.sources,
    durationMs,
  };
}

/**
 * Get the current memory_items count by source type.
 * Used by GET /api/db/status.
 *
 * @returns {object}
 */
export function getMemoryItemStats() {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT source_type, COUNT(*) as count, AVG(quality_score) as avg_score
        FROM memory_items
       GROUP BY source_type
    `).all();

    const bySource = {};
    let total = 0;
    for (const row of rows) {
      bySource[row.source_type] = {
        count:    row.count,
        avgScore: Math.round(row.avg_score || 0),
      };
      total += row.count;
    }

    return { total, bySource };
  } catch {
    return { total: 0, bySource: {} };
  }
}
