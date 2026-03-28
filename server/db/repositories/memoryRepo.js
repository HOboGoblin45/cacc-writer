/**
 * server/db/repositories/memoryRepo.js
 * ----------------------------------------
 * Phase 6 — Memory, Voice, and Proprietary Writing Engine
 *
 * Centralized repository for all Phase 6 SQLite operations:
 *   - approved_memory CRUD
 *   - voice_profiles CRUD
 *   - voice_rules CRUD
 *   - comp_commentary_memory CRUD
 *   - memory_staging_candidates CRUD
 *
 * All functions are synchronous (better-sqlite3).
 * Follows the same pattern as generationRepo.js.
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getDb, dbAll, dbGet, dbRun, dbTransaction } from '../database.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute a short SHA-256 hash for dedup.
 * @param {string} text
 * @returns {string} first 16 hex chars
 */
export function textHash(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex').slice(0, 16);
}

/**
 * Safely parse a JSON column, returning fallback on error.
 */
function parseJSON(val, fallback = []) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

/**
 * Stringify a value for JSON column storage.
 */
function toJSON(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

// ══════════════════════════════════════════════════════════════════════════════
// APPROVED MEMORY
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Insert a new approved memory item.
 * @param {Object} item — fields matching approved_memory columns
 * @returns {string} the new item ID
 */
export function createApprovedMemory(item) {
  const id = item.id || uuidv4();
  const hash = item.textHash || textHash(item.text);
  const now = new Date().toISOString();

  dbRun(`
    INSERT INTO approved_memory (
      id, bucket, source_type, text, text_hash,
      source_document_id, source_run_id, source_section_id, case_id,
      report_family, form_type, property_type, assignment_type,
      canonical_field_id, section_group,
      market_type, county, city, state, loan_program, subject_condition,
      style_tags_json, issue_tags_json,
      quality_score, approval_status, approval_timestamp, approved_by,
      provenance_note, notes, active, pinned,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `, [
    id,
    item.bucket || 'narrative_section',
    item.sourceType || 'imported',
    item.text,
    hash,
    item.sourceDocumentId || null,
    item.sourceRunId || null,
    item.sourceSectionId || null,
    item.caseId || null,
    item.reportFamily || null,
    item.formType || null,
    item.propertyType || null,
    item.assignmentType || null,
    item.canonicalFieldId || null,
    item.sectionGroup || null,
    item.marketType || null,
    item.county || null,
    item.city || null,
    item.state || null,
    item.loanProgram || null,
    item.subjectCondition || null,
    toJSON(item.styleTags || []),
    toJSON(item.issueTags || []),
    item.qualityScore ?? 75,
    item.approvalStatus || 'approved',
    item.approvalTimestamp || now,
    item.approvedBy || null,
    item.provenanceNote || null,
    item.notes || null,
    item.active !== undefined ? (item.active ? 1 : 0) : 1,
    item.pinned ? 1 : 0,
    now,
    now,
  ]);

  return id;
}

/**
 * Update an existing approved memory item.
 * Only updates provided fields.
 * @param {string} id
 * @param {Object} updates
 */
export function updateApprovedMemory(id, updates) {
  const sets = [];
  const params = [];

  const fieldMap = {
    bucket: 'bucket',
    sourceType: 'source_type',
    text: 'text',
    reportFamily: 'report_family',
    formType: 'form_type',
    propertyType: 'property_type',
    assignmentType: 'assignment_type',
    canonicalFieldId: 'canonical_field_id',
    sectionGroup: 'section_group',
    marketType: 'market_type',
    county: 'county',
    city: 'city',
    state: 'state',
    loanProgram: 'loan_program',
    subjectCondition: 'subject_condition',
    qualityScore: 'quality_score',
    approvalStatus: 'approval_status',
    approvalTimestamp: 'approval_timestamp',
    approvedBy: 'approved_by',
    provenanceNote: 'provenance_note',
    notes: 'notes',
  };

  for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
    if (updates[jsKey] !== undefined) {
      sets.push(`${dbCol} = ?`);
      params.push(updates[jsKey]);
    }
  }

  // JSON array fields
  if (updates.styleTags !== undefined) {
    sets.push('style_tags_json = ?');
    params.push(toJSON(updates.styleTags));
  }
  if (updates.issueTags !== undefined) {
    sets.push('issue_tags_json = ?');
    params.push(toJSON(updates.issueTags));
  }

  // Boolean fields
  if (updates.active !== undefined) {
    sets.push('active = ?');
    params.push(updates.active ? 1 : 0);
  }
  if (updates.pinned !== undefined) {
    sets.push('pinned = ?');
    params.push(updates.pinned ? 1 : 0);
  }

  // Recompute hash if text changed
  if (updates.text !== undefined) {
    sets.push('text_hash = ?');
    params.push(textHash(updates.text));
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  dbRun(`UPDATE approved_memory SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * Get a single approved memory item by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getApprovedMemoryById(id) {
  const row = dbGet('SELECT * FROM approved_memory WHERE id = ?', [id]);
  return row ? hydrateApprovedMemory(row) : null;
}

/**
 * List approved memory items with filters.
 * @param {Object} filters
 * @returns {Object[]}
 */
export function listApprovedMemory(filters = {}) {
  const where = ['active = 1'];
  const params = [];

  if (filters.bucket) {
    where.push('bucket = ?');
    params.push(filters.bucket);
  }
  if (filters.approvalStatus) {
    where.push('approval_status = ?');
    params.push(filters.approvalStatus);
  }
  if (filters.canonicalFieldId) {
    where.push('canonical_field_id = ?');
    params.push(filters.canonicalFieldId);
  }
  if (filters.formType) {
    where.push('form_type = ?');
    params.push(filters.formType);
  }
  if (filters.reportFamily) {
    where.push('report_family = ?');
    params.push(filters.reportFamily);
  }
  if (filters.sourceType) {
    where.push('source_type = ?');
    params.push(filters.sourceType);
  }
  if (filters.propertyType) {
    where.push('property_type = ?');
    params.push(filters.propertyType);
  }
  if (filters.includeInactive) {
    // Remove the active = 1 filter
    where.shift();
  }

  const limit = filters.limit || 100;
  const offset = filters.offset || 0;
  const orderBy = filters.orderBy || 'quality_score DESC, updated_at DESC';

  const sql = `
    SELECT * FROM approved_memory
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  return dbAll(sql, params).map(hydrateApprovedMemory);
}

/**
 * Count approved memory items with filters.
 * @param {Object} filters
 * @returns {number}
 */
export function countApprovedMemory(filters = {}) {
  const where = ['active = 1'];
  const params = [];

  if (filters.bucket) { where.push('bucket = ?'); params.push(filters.bucket); }
  if (filters.approvalStatus) { where.push('approval_status = ?'); params.push(filters.approvalStatus); }
  if (filters.canonicalFieldId) { where.push('canonical_field_id = ?'); params.push(filters.canonicalFieldId); }
  if (filters.formType) { where.push('form_type = ?'); params.push(filters.formType); }

  const row = dbGet(`SELECT COUNT(*) AS n FROM approved_memory WHERE ${where.join(' AND ')}`, params);
  return row?.n || 0;
}

/**
 * Get all active approved memory for retrieval scoring.
 * Returns a lightweight projection for the ranking engine.
 * @param {Object} filters — optional pre-filters
 * @returns {Object[]}
 */
export function getApprovedMemoryForRetrieval(filters = {}) {
  const where = ['active = 1', "approval_status = 'approved'"];
  const params = [];

  if (filters.bucket) { where.push('bucket = ?'); params.push(filters.bucket); }
  if (filters.formType) { where.push('(form_type = ? OR form_type IS NULL)'); params.push(filters.formType); }

  const sql = `
    SELECT
      id, bucket, source_type, text, text_hash,
      report_family, form_type, property_type, assignment_type,
      canonical_field_id, section_group,
      market_type, county, city, state, loan_program, subject_condition,
      style_tags_json, issue_tags_json,
      quality_score, pinned, created_at
    FROM approved_memory
    WHERE ${where.join(' AND ')}
    ORDER BY quality_score DESC
  `;

  return dbAll(sql, params).map(row => ({
    id: row.id,
    bucket: row.bucket,
    sourceType: row.source_type,
    text: row.text,
    textHash: row.text_hash,
    reportFamily: row.report_family,
    formType: row.form_type,
    propertyType: row.property_type,
    assignmentType: row.assignment_type,
    canonicalFieldId: row.canonical_field_id,
    sectionGroup: row.section_group,
    marketType: row.market_type,
    county: row.county,
    city: row.city,
    state: row.state,
    loanProgram: row.loan_program,
    subjectCondition: row.subject_condition,
    styleTags: parseJSON(row.style_tags_json, []),
    issueTags: parseJSON(row.issue_tags_json, []),
    qualityScore: row.quality_score,
    pinned: !!row.pinned,
    createdAt: row.created_at,
  }));
}

/**
 * Soft-delete (deactivate) an approved memory item.
 */
export function deactivateApprovedMemory(id) {
  dbRun("UPDATE approved_memory SET active = 0, updated_at = datetime('now') WHERE id = ?", [id]);
}

/**
 * Check if a text hash already exists in approved memory.
 */
export function approvedMemoryHashExists(hash) {
  const row = dbGet('SELECT id FROM approved_memory WHERE text_hash = ? AND active = 1', [hash]);
  return !!row;
}

/**
 * Hydrate a raw DB row into a JS-friendly approved memory object.
 */
function hydrateApprovedMemory(row) {
  return {
    id: row.id,
    bucket: row.bucket,
    sourceType: row.source_type,
    text: row.text,
    textHash: row.text_hash,
    sourceDocumentId: row.source_document_id,
    sourceRunId: row.source_run_id,
    sourceSectionId: row.source_section_id,
    caseId: row.case_id,
    reportFamily: row.report_family,
    formType: row.form_type,
    propertyType: row.property_type,
    assignmentType: row.assignment_type,
    canonicalFieldId: row.canonical_field_id,
    sectionGroup: row.section_group,
    marketType: row.market_type,
    county: row.county,
    city: row.city,
    state: row.state,
    loanProgram: row.loan_program,
    subjectCondition: row.subject_condition,
    styleTags: parseJSON(row.style_tags_json, []),
    issueTags: parseJSON(row.issue_tags_json, []),
    qualityScore: row.quality_score,
    approvalStatus: row.approval_status,
    approvalTimestamp: row.approval_timestamp,
    approvedBy: row.approved_by,
    provenanceNote: row.provenance_note,
    notes: row.notes,
    active: !!row.active,
    pinned: !!row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// VOICE PROFILES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new voice profile.
 * @param {Object} profile
 * @returns {string} profile ID
 */
export function createVoiceProfile(profile) {
  const id = profile.id || uuidv4();
  const now = new Date().toISOString();

  dbRun(`
    INSERT INTO voice_profiles (
      id, name, scope, report_family, canonical_field_id,
      tone, sentence_length, hedging_degree, terminology_preference,
      reconciliation_style, section_opening_style, section_closing_style,
      preferred_phrases_json, forbidden_phrases_json, phrasing_patterns_json,
      custom_dimensions_json, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    profile.name || 'Untitled Profile',
    profile.scope || 'global',
    profile.reportFamily || null,
    profile.canonicalFieldId || null,
    profile.tone || null,
    profile.sentenceLength || null,
    profile.hedgingDegree || null,
    profile.terminologyPreference || null,
    profile.reconciliationStyle || null,
    profile.sectionOpeningStyle || null,
    profile.sectionClosingStyle || null,
    toJSON(profile.preferredPhrases || []),
    toJSON(profile.forbiddenPhrases || []),
    toJSON(profile.phrasingPatterns || []),
    toJSON(profile.customDimensions || {}),
    profile.active !== undefined ? (profile.active ? 1 : 0) : 1,
    now,
    now,
  ]);

  return id;
}

/**
 * Update a voice profile.
 */
export function updateVoiceProfile(id, updates) {
  const sets = [];
  const params = [];

  const fieldMap = {
    name: 'name',
    scope: 'scope',
    reportFamily: 'report_family',
    canonicalFieldId: 'canonical_field_id',
    tone: 'tone',
    sentenceLength: 'sentence_length',
    hedgingDegree: 'hedging_degree',
    terminologyPreference: 'terminology_preference',
    reconciliationStyle: 'reconciliation_style',
    sectionOpeningStyle: 'section_opening_style',
    sectionClosingStyle: 'section_closing_style',
  };

  for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
    if (updates[jsKey] !== undefined) {
      sets.push(`${dbCol} = ?`);
      params.push(updates[jsKey]);
    }
  }

  // JSON fields
  for (const jsonField of ['preferredPhrases', 'forbiddenPhrases', 'phrasingPatterns', 'customDimensions']) {
    const dbCol = jsonField.replace(/([A-Z])/g, '_$1').toLowerCase() + '_json';
    if (updates[jsonField] !== undefined) {
      sets.push(`${dbCol} = ?`);
      params.push(toJSON(updates[jsonField]));
    }
  }

  if (updates.active !== undefined) {
    sets.push('active = ?');
    params.push(updates.active ? 1 : 0);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  dbRun(`UPDATE voice_profiles SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * Get a voice profile by ID.
 */
export function getVoiceProfileById(id) {
  const row = dbGet('SELECT * FROM voice_profiles WHERE id = ?', [id]);
  return row ? hydrateVoiceProfile(row) : null;
}

/**
 * List voice profiles.
 */
export function listVoiceProfiles(filters = {}) {
  const where = ['active = 1'];
  const params = [];

  if (filters.scope) { where.push('scope = ?'); params.push(filters.scope); }
  if (filters.reportFamily) { where.push('report_family = ?'); params.push(filters.reportFamily); }
  if (filters.canonicalFieldId) { where.push('canonical_field_id = ?'); params.push(filters.canonicalFieldId); }

  return dbAll(
    `SELECT * FROM voice_profiles WHERE ${where.join(' AND ')} ORDER BY scope, name`,
    params
  ).map(hydrateVoiceProfile);
}

/**
 * Resolve the effective voice profile for a given context.
 * Cascades: canonical_field → report_family → global
 * Returns merged profile with most-specific overrides winning.
 *
 * @param {Object} params
 * @param {string|null} params.canonicalFieldId
 * @param {string|null} params.reportFamily
 * @returns {Object|null} merged voice profile
 */
export function resolveVoiceProfile({ canonicalFieldId, reportFamily } = {}) {
  // Load all active profiles ordered by specificity (global first, then family, then field)
  const profiles = dbAll(
    `SELECT * FROM voice_profiles WHERE active = 1 ORDER BY
      CASE scope
        WHEN 'global' THEN 1
        WHEN 'report_family' THEN 2
        WHEN 'canonical_field' THEN 3
      END`,
    []
  ).map(hydrateVoiceProfile);

  if (profiles.length === 0) return null;

  // Find applicable profiles
  const globalProfile = profiles.find(p => p.scope === 'global');
  const familyProfile = reportFamily
    ? profiles.find(p => p.scope === 'report_family' && p.reportFamily === reportFamily)
    : null;
  const fieldProfile = canonicalFieldId
    ? profiles.find(p => p.scope === 'canonical_field' && p.canonicalFieldId === canonicalFieldId)
    : null;

  // Merge: global ← family ← field (most specific wins)
  const merged = { ...(globalProfile || {}) };

  if (familyProfile) {
    for (const [key, val] of Object.entries(familyProfile)) {
      if (val !== null && val !== undefined && key !== 'id' && key !== 'scope' && key !== 'name') {
        // For arrays, concatenate rather than replace
        if (Array.isArray(val) && val.length > 0) {
          merged[key] = [...new Set([...(merged[key] || []), ...val])];
        } else if (val) {
          merged[key] = val;
        }
      }
    }
  }

  if (fieldProfile) {
    for (const [key, val] of Object.entries(fieldProfile)) {
      if (val !== null && val !== undefined && key !== 'id' && key !== 'scope' && key !== 'name') {
        if (Array.isArray(val) && val.length > 0) {
          merged[key] = [...new Set([...(merged[key] || []), ...val])];
        } else if (val) {
          merged[key] = val;
        }
      }
    }
  }

  // Also load voice rules for the resolved profile chain
  const profileIds = [globalProfile?.id, familyProfile?.id, fieldProfile?.id].filter(Boolean);
  if (profileIds.length > 0) {
    const placeholders = profileIds.map(() => '?').join(',');
    const rules = dbAll(
      `SELECT * FROM voice_rules WHERE profile_id IN (${placeholders}) AND active = 1 ORDER BY priority DESC`,
      profileIds
    ).map(hydrateVoiceRule);

    merged._rules = rules;
    merged._resolvedFrom = {
      globalId: globalProfile?.id || null,
      familyId: familyProfile?.id || null,
      fieldId: fieldProfile?.id || null,
    };
  }

  return merged;
}

function hydrateVoiceProfile(row) {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    reportFamily: row.report_family,
    canonicalFieldId: row.canonical_field_id,
    tone: row.tone,
    sentenceLength: row.sentence_length,
    hedgingDegree: row.hedging_degree,
    terminologyPreference: row.terminology_preference,
    reconciliationStyle: row.reconciliation_style,
    sectionOpeningStyle: row.section_opening_style,
    sectionClosingStyle: row.section_closing_style,
    preferredPhrases: parseJSON(row.preferred_phrases_json, []),
    forbiddenPhrases: parseJSON(row.forbidden_phrases_json, []),
    phrasingPatterns: parseJSON(row.phrasing_patterns_json, []),
    customDimensions: parseJSON(row.custom_dimensions_json, {}),
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// VOICE RULES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a voice rule.
 */
export function createVoiceRule(rule) {
  const id = rule.id || uuidv4();
  dbRun(`
    INSERT INTO voice_rules (id, profile_id, rule_type, rule_value, priority, canonical_field_id, notes, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    id,
    rule.profileId,
    rule.ruleType,
    rule.ruleValue,
    rule.priority ?? 50,
    rule.canonicalFieldId || null,
    rule.notes || null,
    rule.active !== undefined ? (rule.active ? 1 : 0) : 1,
  ]);
  return id;
}

/**
 * List voice rules for a profile.
 */
export function listVoiceRules(profileId, filters = {}) {
  const where = ['profile_id = ?', 'active = 1'];
  const params = [profileId];

  if (filters.ruleType) { where.push('rule_type = ?'); params.push(filters.ruleType); }
  if (filters.canonicalFieldId) { where.push('canonical_field_id = ?'); params.push(filters.canonicalFieldId); }

  return dbAll(
    `SELECT * FROM voice_rules WHERE ${where.join(' AND ')} ORDER BY priority DESC`,
    params
  ).map(hydrateVoiceRule);
}

/**
 * Delete a voice rule.
 */
export function deleteVoiceRule(id) {
  dbRun('UPDATE voice_rules SET active = 0 WHERE id = ?', [id]);
}

function hydrateVoiceRule(row) {
  return {
    id: row.id,
    profileId: row.profile_id,
    ruleType: row.rule_type,
    ruleValue: row.rule_value,
    priority: row.priority,
    canonicalFieldId: row.canonical_field_id,
    notes: row.notes,
    active: !!row.active,
    createdAt: row.created_at,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// COMP COMMENTARY MEMORY
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a comp commentary memory item.
 */
export function createCompCommentary(item) {
  const id = item.id || uuidv4();
  const hash = item.textHash || textHash(item.text);
  const now = new Date().toISOString();

  dbRun(`
    INSERT INTO comp_commentary_memory (
      id, text, text_hash, commentary_type,
      subject_property_type, comp_property_type, market_density, urban_suburban_rural,
      report_family, form_type, canonical_field_id,
      issue_tags_json, adjustment_categories_json,
      quality_score, approval_status, approved_by,
      source_document_id, source_run_id, case_id, provenance_note,
      active, pinned, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, item.text, hash, item.commentaryType || 'general',
    item.subjectPropertyType || null, item.compPropertyType || null,
    item.marketDensity || null, item.urbanSuburbanRural || null,
    item.reportFamily || null, item.formType || null, item.canonicalFieldId || null,
    toJSON(item.issueTags || []), toJSON(item.adjustmentCategories || []),
    item.qualityScore ?? 75, item.approvalStatus || 'approved', item.approvedBy || null,
    item.sourceDocumentId || null, item.sourceRunId || null,
    item.caseId || null, item.provenanceNote || null,
    item.active !== undefined ? (item.active ? 1 : 0) : 1,
    item.pinned ? 1 : 0,
    now, now,
  ]);

  return id;
}

/**
 * List comp commentary memory items.
 */
export function listCompCommentary(filters = {}) {
  const where = ['active = 1'];
  const params = [];

  if (filters.commentaryType) { where.push('commentary_type = ?'); params.push(filters.commentaryType); }
  if (filters.reportFamily) { where.push('report_family = ?'); params.push(filters.reportFamily); }
  if (filters.formType) { where.push('form_type = ?'); params.push(filters.formType); }
  if (filters.canonicalFieldId) { where.push('canonical_field_id = ?'); params.push(filters.canonicalFieldId); }

  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  return dbAll(
    `SELECT * FROM comp_commentary_memory WHERE ${where.join(' AND ')}
     ORDER BY quality_score DESC, updated_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).map(hydrateCompCommentary);
}

/**
 * Get comp commentary for retrieval scoring.
 */
export function getCompCommentaryForRetrieval(filters = {}) {
  const where = ['active = 1', "approval_status = 'approved'"];
  const params = [];

  if (filters.formType) { where.push('(form_type = ? OR form_type IS NULL)'); params.push(filters.formType); }

  return dbAll(
    `SELECT * FROM comp_commentary_memory WHERE ${where.join(' AND ')} ORDER BY quality_score DESC`,
    params
  ).map(row => ({
    id: row.id,
    text: row.text,
    textHash: row.text_hash,
    commentaryType: row.commentary_type,
    subjectPropertyType: row.subject_property_type,
    compPropertyType: row.comp_property_type,
    marketDensity: row.market_density,
    urbanSuburbanRural: row.urban_suburban_rural,
    reportFamily: row.report_family,
    formType: row.form_type,
    canonicalFieldId: row.canonical_field_id,
    issueTags: parseJSON(row.issue_tags_json, []),
    adjustmentCategories: parseJSON(row.adjustment_categories_json, []),
    qualityScore: row.quality_score,
    pinned: !!row.pinned,
    createdAt: row.created_at,
  }));
}

/**
 * Update a comp commentary item.
 */
export function updateCompCommentary(id, updates) {
  const sets = [];
  const params = [];

  const fieldMap = {
    text: 'text',
    commentaryType: 'commentary_type',
    subjectPropertyType: 'subject_property_type',
    compPropertyType: 'comp_property_type',
    marketDensity: 'market_density',
    urbanSuburbanRural: 'urban_suburban_rural',
    reportFamily: 'report_family',
    formType: 'form_type',
    canonicalFieldId: 'canonical_field_id',
    qualityScore: 'quality_score',
    approvalStatus: 'approval_status',
    approvedBy: 'approved_by',
    provenanceNote: 'provenance_note',
  };

  for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
    if (updates[jsKey] !== undefined) {
      sets.push(`${dbCol} = ?`);
      params.push(updates[jsKey]);
    }
  }

  if (updates.issueTags !== undefined) {
    sets.push('issue_tags_json = ?');
    params.push(toJSON(updates.issueTags));
  }
  if (updates.adjustmentCategories !== undefined) {
    sets.push('adjustment_categories_json = ?');
    params.push(toJSON(updates.adjustmentCategories));
  }
  if (updates.active !== undefined) {
    sets.push('active = ?');
    params.push(updates.active ? 1 : 0);
  }
  if (updates.pinned !== undefined) {
    sets.push('pinned = ?');
    params.push(updates.pinned ? 1 : 0);
  }
  if (updates.text !== undefined) {
    sets.push('text_hash = ?');
    params.push(textHash(updates.text));
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  dbRun(`UPDATE comp_commentary_memory SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * Deactivate a comp commentary item.
 */
export function deactivateCompCommentary(id) {
  dbRun("UPDATE comp_commentary_memory SET active = 0, updated_at = datetime('now') WHERE id = ?", [id]);
}

function hydrateCompCommentary(row) {
  return {
    id: row.id,
    text: row.text,
    textHash: row.text_hash,
    commentaryType: row.commentary_type,
    subjectPropertyType: row.subject_property_type,
    compPropertyType: row.comp_property_type,
    marketDensity: row.market_density,
    urbanSuburbanRural: row.urban_suburban_rural,
    reportFamily: row.report_family,
    formType: row.form_type,
    canonicalFieldId: row.canonical_field_id,
    issueTags: parseJSON(row.issue_tags_json, []),
    adjustmentCategories: parseJSON(row.adjustment_categories_json, []),
    qualityScore: row.quality_score,
    approvalStatus: row.approval_status,
    approvedBy: row.approved_by,
    sourceDocumentId: row.source_document_id,
    sourceRunId: row.source_run_id,
    caseId: row.case_id,
    provenanceNote: row.provenance_note,
    active: !!row.active,
    pinned: !!row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MEMORY STAGING CANDIDATES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a staging candidate.
 * @param {Object} candidate
 * @returns {string} candidate ID
 */
export function createStagingCandidate(candidate) {
  const id = candidate.id || uuidv4();
  const hash = candidate.textHash || textHash(candidate.text);
  const now = new Date().toISOString();
  const wordCount = (candidate.text || '').split(/\s+/).filter(Boolean).length;

  dbRun(`
    INSERT INTO memory_staging_candidates (
      id, candidate_source, text, text_hash,
      target_bucket, canonical_field_id, report_family, form_type, property_type,
      case_id, source_document_id, source_run_id, source_section_id,
      style_tags_json, issue_tags_json,
      quality_score, word_count,
      review_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, candidate.candidateSource || 'extracted_narrative',
    candidate.text, hash,
    candidate.targetBucket || null,
    candidate.canonicalFieldId || null,
    candidate.reportFamily || null,
    candidate.formType || null,
    candidate.propertyType || null,
    candidate.caseId || null,
    candidate.sourceDocumentId || null,
    candidate.sourceRunId || null,
    candidate.sourceSectionId || null,
    toJSON(candidate.styleTags || []),
    toJSON(candidate.issueTags || []),
    candidate.qualityScore ?? 50,
    wordCount,
    'pending',
    now, now,
  ]);

  return id;
}

/**
 * List staging candidates with filters.
 */
export function listStagingCandidates(filters = {}) {
  const where = [];
  const params = [];

  if (filters.reviewStatus) {
    where.push('review_status = ?');
    params.push(filters.reviewStatus);
  } else {
    where.push("review_status = 'pending'");
  }

  if (filters.candidateSource) { where.push('candidate_source = ?'); params.push(filters.candidateSource); }
  if (filters.canonicalFieldId) { where.push('canonical_field_id = ?'); params.push(filters.canonicalFieldId); }
  if (filters.formType) { where.push('form_type = ?'); params.push(filters.formType); }
  if (filters.caseId) { where.push('case_id = ?'); params.push(filters.caseId); }

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  return dbAll(
    `SELECT * FROM memory_staging_candidates WHERE ${where.join(' AND ')}
     ORDER BY quality_score DESC, created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).map(hydrateStagingCandidate);
}

/**
 * Count staging candidates by status.
 */
export function countStagingCandidates(filters = {}) {
  const where = [];
  const params = [];

  if (filters.reviewStatus) { where.push('review_status = ?'); params.push(filters.reviewStatus); }
  if (filters.candidateSource) { where.push('candidate_source = ?'); params.push(filters.candidateSource); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const row = dbGet(`SELECT COUNT(*) AS n FROM memory_staging_candidates ${whereClause}`, params);
  return row?.n || 0;
}

/**
 * Get a single staging candidate by ID.
 */
export function getStagingCandidateById(id) {
  const row = dbGet('SELECT * FROM memory_staging_candidates WHERE id = ?', [id]);
  return row ? hydrateStagingCandidate(row) : null;
}

/**
 * Update a staging candidate (review workflow).
 */
export function updateStagingCandidate(id, updates) {
  const sets = [];
  const params = [];

  if (updates.reviewStatus) { sets.push('review_status = ?'); params.push(updates.reviewStatus); }
  if (updates.reviewedBy) { sets.push('reviewed_by = ?'); params.push(updates.reviewedBy); }
  if (updates.reviewNotes) { sets.push('review_notes = ?'); params.push(updates.reviewNotes); }
  if (updates.targetBucket) { sets.push('target_bucket = ?'); params.push(updates.targetBucket); }
  if (updates.canonicalFieldId !== undefined) { sets.push('canonical_field_id = ?'); params.push(updates.canonicalFieldId); }
  if (updates.reportFamily !== undefined) { sets.push('report_family = ?'); params.push(updates.reportFamily); }
  if (updates.formType !== undefined) { sets.push('form_type = ?'); params.push(updates.formType); }
  if (updates.propertyType !== undefined) { sets.push('property_type = ?'); params.push(updates.propertyType); }
  if (updates.qualityScore !== undefined) { sets.push('quality_score = ?'); params.push(updates.qualityScore); }
  if (updates.promotedMemoryId) { sets.push('promoted_memory_id = ?'); params.push(updates.promotedMemoryId); }
  if (updates.promotedAt) { sets.push('promoted_at = ?'); params.push(updates.promotedAt); }
  if (updates.text) {
    sets.push('text = ?');
    params.push(updates.text);
    sets.push('text_hash = ?');
    params.push(textHash(updates.text));
    sets.push('word_count = ?');
    params.push((updates.text || '').split(/\s+/).filter(Boolean).length);
  }
  if (updates.styleTags !== undefined) { sets.push('style_tags_json = ?'); params.push(toJSON(updates.styleTags)); }
  if (updates.issueTags !== undefined) { sets.push('issue_tags_json = ?'); params.push(toJSON(updates.issueTags)); }

  if (updates.reviewStatus === 'approved' || updates.reviewStatus === 'rejected') {
    sets.push("reviewed_at = datetime('now')");
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  dbRun(`UPDATE memory_staging_candidates SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * Check if a text hash already exists in staging.
 */
export function stagingHashExists(hash) {
  const row = dbGet(
    "SELECT id FROM memory_staging_candidates WHERE text_hash = ? AND review_status = 'pending'",
    [hash]
  );
  return !!row;
}

function hydrateStagingCandidate(row) {
  return {
    id: row.id,
    candidateSource: row.candidate_source,
    text: row.text,
    textHash: row.text_hash,
    targetBucket: row.target_bucket,
    canonicalFieldId: row.canonical_field_id,
    reportFamily: row.report_family,
    formType: row.form_type,
    propertyType: row.property_type,
    caseId: row.case_id,
    sourceDocumentId: row.source_document_id,
    sourceRunId: row.source_run_id,
    sourceSectionId: row.source_section_id,
    styleTags: parseJSON(row.style_tags_json, []),
    issueTags: parseJSON(row.issue_tags_json, []),
    qualityScore: row.quality_score,
    wordCount: row.word_count,
    reviewStatus: row.review_status,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    reviewNotes: row.review_notes,
    promotedMemoryId: row.promoted_memory_id,
    promotedAt: row.promoted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// AGGREGATE QUERIES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get Phase 6 table counts for status reporting.
 */
export function getPhase6TableCounts() {
  const tables = [
    'approved_memory',
    'voice_profiles',
    'voice_rules',
    'comp_commentary_memory',
    'memory_staging_candidates',
  ];

  const counts = {};
  const db = getDb();
  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
      counts[t] = row?.n ?? 0;
    } catch {
      counts[t] = -1;
    }
  }
  return counts;
}

/**
 * Get memory summary statistics.
 * Returns a shape matching what the UI expects.
 */
export function getMemorySummary() {
  const db = getDb();

  const byBucket = {};
  let approvedTotal = 0;
  try {
    const rows = db.prepare(
      "SELECT bucket, COUNT(*) AS n FROM approved_memory WHERE active = 1 AND approval_status = 'approved' GROUP BY bucket"
    ).all();
    for (const r of rows) { byBucket[r.bucket] = r.n; approvedTotal += r.n; }
  } catch { /* table may not exist */ }

  const bySource = {};
  try {
    const rows = db.prepare(
      "SELECT source_type, COUNT(*) AS n FROM approved_memory WHERE active = 1 GROUP BY source_type"
    ).all();
    for (const r of rows) bySource[r.source_type] = r.n;
  } catch { /* table may not exist */ }

  // Voice profile count
  let voiceProfileCount = 0;
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM voice_profiles WHERE active = 1").get();
    voiceProfileCount = row?.n ?? 0;
  } catch { /* table may not exist */ }

  // Comp commentary count
  let compCommentaryTotal = 0;
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM comp_commentary_memory WHERE active = 1").get();
    compCommentaryTotal = row?.n ?? 0;
  } catch { /* table may not exist */ }

  const stagingPending = countStagingCandidates({ reviewStatus: 'pending' });
  const stagingApproved = countStagingCandidates({ reviewStatus: 'approved' });
  const stagingRejected = countStagingCandidates({ reviewStatus: 'rejected' });

  return {
    approvedMemory: { total: approvedTotal, byBucket, bySource },
    stagingCandidates: { pending: stagingPending, approved: stagingApproved, rejected: stagingRejected },
    voiceProfiles: voiceProfileCount,
    compCommentary: { total: compCommentaryTotal },
    tableCounts: getPhase6TableCounts(),
  };
}
