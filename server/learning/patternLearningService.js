/**
 * server/learning/patternLearningService.js
 * --------------------------------------------
 * Phase 11 — Pattern Learning Service
 *
 * Extracts learnable patterns from archived assignments:
 *   - Comp acceptance patterns (what was accepted/rejected and why)
 *   - Adjustment patterns (typical amounts by category and market area)
 *   - Narrative edit patterns (systematic changes the appraiser makes)
 *   - Reconciliation weighting patterns
 *
 * All patterns are observational — they rank and suggest, never auto-decide.
 *
 * All functions are synchronous (better-sqlite3).
 */

import { v4 as uuidv4 } from 'uuid';
import { dbAll, dbGet, dbRun, dbTransaction } from '../db/database.js';
import { getArchiveById } from './assignmentArchiveService.js';
import log from '../logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJSON(val, fallback = {}) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

function toJSON(val) {
  if (val === null || val === undefined) return '{}';
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

// ── Pattern Extraction ──────────────────────────────────────────────────────

/**
 * Learn patterns from a completed archive.
 * Extracts all pattern types and stores them in the learned_patterns table.
 *
 * @param {string} archiveId
 * @returns {{ patternsCreated: number, patternTypes: Object } | { error: string }}
 */
export function learnFromArchive(archiveId) {
  const archive = getArchiveById(archiveId);
  if (!archive) return { error: `Archive ${archiveId} not found` };

  const patterns = [];

  // ── 1. Comp acceptance patterns ────────────────────────────────────────
  const compPatterns = extractCompAcceptancePatterns(archive);
  patterns.push(...compPatterns);

  // ── 2. Adjustment patterns ─────────────────────────────────────────────
  const adjPatterns = extractAdjustmentPatterns(archive);
  patterns.push(...adjPatterns);

  // ── 3. Narrative edit patterns ─────────────────────────────────────────
  const editPatterns = extractNarrativeEditPatterns(archive);
  patterns.push(...editPatterns);

  // ── 4. Reconciliation patterns ─────────────────────────────────────────
  const reconPatterns = extractReconciliationPatterns(archive);
  patterns.push(...reconPatterns);

  // ── Store all patterns ─────────────────────────────────────────────────
  const patternTypes = {};
  dbTransaction(() => {
    for (const pattern of patterns) {
      const id = uuidv4();
      dbRun(`
        INSERT INTO learned_patterns (
          id, archive_id, case_id, pattern_type, pattern_key, pattern_data_json, confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        archiveId,
        archive.caseId,
        pattern.patternType,
        pattern.patternKey,
        toJSON(pattern.data),
        pattern.confidence || 0.5,
      ]);

      patternTypes[pattern.patternType] = (patternTypes[pattern.patternType] || 0) + 1;
    }
  });

  log.info('learning:patterns-extracted', {
    archiveId,
    caseId: archive.caseId,
    patternsCreated: patterns.length,
    patternTypes,
  });

  return { patternsCreated: patterns.length, patternTypes };
}

// ── Comp Acceptance Pattern Extraction ───────────────────────────────────────

function extractCompAcceptancePatterns(archive) {
  const patterns = [];
  const compSet = archive.compSet || {};

  // Pattern for accepted comps
  for (const comp of (compSet.accepted || [])) {
    const data = comp.candidateData || {};
    const key = buildCompPatternKey(data, archive);
    patterns.push({
      patternType: 'comp_acceptance',
      patternKey: `accepted:${key}`,
      data: {
        action: 'accepted',
        propertyType: data.propertyType || data.property_type || null,
        sourceType: comp.sourceType,
        gridSlot: comp.gridSlot,
        score: comp.score?.overall || null,
        reasoning: comp.acceptanceReasoning || {},
        marketArea: archive.marketArea,
        formType: archive.formType,
      },
      confidence: 0.5,
    });
  }

  // Pattern for rejected comps
  for (const comp of (compSet.rejected || [])) {
    const data = comp.candidateData || {};
    const key = buildCompPatternKey(data, archive);
    patterns.push({
      patternType: 'comp_acceptance',
      patternKey: `rejected:${key}`,
      data: {
        action: 'rejected',
        propertyType: data.propertyType || data.property_type || null,
        sourceType: comp.sourceType,
        reasonCode: comp.rejectionReason || null,
        reasoning: comp.rejectionReasoning || {},
        score: comp.score?.overall || null,
        marketArea: archive.marketArea,
        formType: archive.formType,
      },
      confidence: 0.5,
    });
  }

  return patterns;
}

function buildCompPatternKey(compData, archive) {
  const parts = [
    archive.formType || 'unknown',
    archive.propertyType || 'unknown',
    archive.marketArea || 'unknown',
  ];
  return parts.join(':').toLowerCase().replace(/\s+/g, '_');
}

// ── Adjustment Pattern Extraction ───────────────────────────────────────────

function extractAdjustmentPatterns(archive) {
  const patterns = [];
  const adjustments = archive.adjustments || [];

  // Group adjustments by category
  const byCategory = {};
  for (const adj of adjustments) {
    const cat = adj.adjustmentCategory;
    if (!cat) continue;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(adj);
  }

  // Create a pattern for each category with its typical values
  for (const [category, adjs] of Object.entries(byCategory)) {
    const finalAmounts = adjs
      .filter(a => a.finalAmount !== null && a.finalAmount !== undefined)
      .map(a => a.finalAmount);

    if (finalAmounts.length === 0) continue;

    const avgAmount = finalAmounts.reduce((s, v) => s + v, 0) / finalAmounts.length;
    const minAmount = Math.min(...finalAmounts);
    const maxAmount = Math.max(...finalAmounts);

    const key = `${archive.formType || 'unknown'}:${archive.propertyType || 'unknown'}:${category}`
      .toLowerCase().replace(/\s+/g, '_');

    patterns.push({
      patternType: 'adjustment',
      patternKey: key,
      data: {
        category,
        avgAmount,
        minAmount,
        maxAmount,
        sampleSize: finalAmounts.length,
        supportTypes: [...new Set(adjs.map(a => a.supportType).filter(Boolean))],
        marketArea: archive.marketArea,
        formType: archive.formType,
        propertyType: archive.propertyType,
      },
      confidence: Math.min(0.5 + (finalAmounts.length * 0.1), 0.9),
    });
  }

  return patterns;
}

// ── Narrative Edit Pattern Extraction ────────────────────────────────────────

function extractNarrativeEditPatterns(archive) {
  const patterns = [];
  const editDiff = archive.editDiff || {};
  const narratives = archive.narratives || {};
  const sections = narratives.sections || [];

  for (const section of sections) {
    const diff = editDiff[section.sectionId];
    if (!diff || !diff.changed) continue;

    // Record that the appraiser made edits to this section type
    const key = `${archive.formType || 'unknown'}:${section.sectionId}`
      .toLowerCase().replace(/\s+/g, '_');

    patterns.push({
      patternType: 'narrative_edit',
      patternKey: key,
      data: {
        sectionId: section.sectionId,
        draftLength: diff.draftLength,
        finalLength: diff.finalLength,
        lengthDelta: diff.lengthDelta,
        lengthChangePercent: diff.draftLength > 0
          ? Math.round((diff.lengthDelta / diff.draftLength) * 100)
          : 0,
        wasApproved: section.approved,
        formType: archive.formType,
        propertyType: archive.propertyType,
        marketArea: archive.marketArea,
      },
      confidence: 0.5,
    });
  }

  return patterns;
}

// ── Reconciliation Pattern Extraction ────────────────────────────────────────

function extractReconciliationPatterns(archive) {
  const patterns = [];
  const recon = archive.reconciliation || {};

  // Only extract if there is meaningful reconciliation data
  if (!recon || Object.keys(recon).length === 0) return patterns;

  const key = `${archive.formType || 'unknown'}:${archive.propertyType || 'unknown'}:reconciliation`
    .toLowerCase().replace(/\s+/g, '_');

  patterns.push({
    patternType: 'reconciliation',
    patternKey: key,
    data: {
      reconciliationData: recon,
      formType: archive.formType,
      propertyType: archive.propertyType,
      marketArea: archive.marketArea,
    },
    confidence: 0.5,
  });

  return patterns;
}

// ── Pattern Retrieval ────────────────────────────────────────────────────────

/**
 * Get patterns relevant to a new assignment context.
 * Returns patterns ordered by relevance (confidence * recency).
 *
 * @param {Object} context
 * @param {string} [context.formType]
 * @param {string} [context.propertyType]
 * @param {string} [context.marketArea]
 * @param {string} [context.patternType] — filter by pattern type
 * @param {number} [context.limit]
 * @returns {Object[]}
 */
export function getRelevantPatterns(context = {}) {
  const where = [];
  const params = [];

  if (context.patternType) {
    where.push('lp.pattern_type = ?');
    params.push(context.patternType);
  }

  // Build pattern key prefix for matching
  if (context.formType) {
    where.push('lp.pattern_key LIKE ?');
    params.push(`%${context.formType.toLowerCase()}%`);
  }

  if (context.propertyType) {
    where.push('lp.pattern_key LIKE ?');
    params.push(`%${context.propertyType.toLowerCase().replace(/\s+/g, '_')}%`);
  }

  const whereClause = where.length > 0
    ? `WHERE ${where.join(' AND ')}`
    : '';

  const limit = context.limit || 20;

  const rows = dbAll(`
    SELECT lp.*, aa.market_area, aa.form_type AS archive_form_type
    FROM learned_patterns lp
    LEFT JOIN assignment_archives aa ON lp.archive_id = aa.id
    ${whereClause}
    ORDER BY lp.confidence DESC, lp.usage_count DESC, lp.created_at DESC
    LIMIT ?
  `, [...params, limit]);

  return rows.map(row => ({
    id: row.id,
    archiveId: row.archive_id,
    caseId: row.case_id,
    patternType: row.pattern_type,
    patternKey: row.pattern_key,
    data: parseJSON(row.pattern_data_json, {}),
    confidence: row.confidence,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    marketArea: row.market_area,
  }));
}

/**
 * List all learned patterns with optional filters.
 *
 * @param {Object} [filters]
 * @param {string} [filters.patternType]
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {Object[]}
 */
export function listPatterns(filters = {}) {
  const where = [];
  const params = [];

  if (filters.patternType) {
    where.push('pattern_type = ?');
    params.push(filters.patternType);
  }
  if (filters.archiveId) {
    where.push('archive_id = ?');
    params.push(filters.archiveId);
  }

  const whereClause = where.length > 0
    ? `WHERE ${where.join(' AND ')}`
    : '';

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const rows = dbAll(
    `SELECT * FROM learned_patterns ${whereClause}
     ORDER BY confidence DESC, usage_count DESC, created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return rows.map(row => ({
    id: row.id,
    archiveId: row.archive_id,
    caseId: row.case_id,
    patternType: row.pattern_type,
    patternKey: row.pattern_key,
    data: parseJSON(row.pattern_data_json, {}),
    confidence: row.confidence,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  }));
}

// ── Pattern Application Tracking ─────────────────────────────────────────────

/**
 * Record that a pattern was applied in a new assignment.
 *
 * @param {Object} params
 * @param {string} params.patternId
 * @param {string} params.caseId
 * @param {string} params.appliedContext — description of how it was applied
 * @returns {{ id: string }}
 */
export function recordPatternApplication(params) {
  const { patternId, caseId, appliedContext } = params;

  const id = uuidv4();
  dbRun(`
    INSERT INTO pattern_applications (id, pattern_id, case_id, applied_context)
    VALUES (?, ?, ?, ?)
  `, [id, patternId, caseId, appliedContext]);

  // Update usage count and last_used_at on the pattern
  dbRun(`
    UPDATE learned_patterns
    SET usage_count = usage_count + 1,
        last_used_at = datetime('now')
    WHERE id = ?
  `, [patternId]);

  return { id };
}

/**
 * Record the outcome of a pattern application.
 *
 * @param {string} applicationId
 * @param {string} outcome — 'accepted' | 'rejected' | 'ignored'
 */
export function recordApplicationOutcome(applicationId, outcome) {
  dbRun(
    'UPDATE pattern_applications SET outcome = ? WHERE id = ?',
    [outcome, applicationId]
  );

  // Get the pattern ID to adjust confidence
  const app = dbGet('SELECT pattern_id FROM pattern_applications WHERE id = ?', [applicationId]);
  if (app) {
    adjustPatternConfidence(app.pattern_id, outcome);
  }
}

/**
 * Adjust pattern confidence based on outcome.
 * Accepted outcomes increase confidence, rejected decrease it.
 */
function adjustPatternConfidence(patternId, outcome) {
  const pattern = dbGet('SELECT confidence FROM learned_patterns WHERE id = ?', [patternId]);
  if (!pattern) return;

  let delta = 0;
  if (outcome === 'accepted') {
    delta = 0.05; // Small increase for positive feedback
  } else if (outcome === 'rejected') {
    delta = -0.05; // Small decrease for negative feedback
  }

  if (delta === 0) return;

  const newConfidence = Math.max(0.1, Math.min(0.95, pattern.confidence + delta));
  dbRun(
    'UPDATE learned_patterns SET confidence = ? WHERE id = ?',
    [newConfidence, patternId]
  );
}
