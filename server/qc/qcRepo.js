/**
 * server/qc/qcRepo.js
 * ----------------------
 * Phase 7 — QC Run & Finding Repository
 *
 * Persistence layer for QC runs and findings.
 * All data stored in SQLite via the existing database module.
 *
 * Tables:
 *   qc_runs     — one row per QC evaluation
 *   qc_findings — one row per finding within a run
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';

// ── QC Run CRUD ─────────────────────────────────────────────────────────────

/**
 * Create a new QC run record.
 *
 * @param {{
 *   caseId: string,
 *   generationRunId?: string,
 *   ruleSetVersion: string,
 *   reportFamily?: string,
 *   flagsSnapshot?: object,
 * }} params
 * @returns {{ id: string }}
 */
export function createQcRun({ caseId, generationRunId, ruleSetVersion, reportFamily, flagsSnapshot }) {
  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO qc_runs (
      id, case_id, generation_run_id, status, rule_set_version,
      report_family, flags_snapshot_json,
      blocker_count, high_count, medium_count, low_count, advisory_count,
      total_findings, draft_readiness,
      created_at
    ) VALUES (
      ?, ?, ?, 'running', ?,
      ?, ?,
      0, 0, 0, 0, 0,
      0, 'unknown',
      datetime('now')
    )
  `).run(
    id,
    caseId,
    generationRunId || null,
    ruleSetVersion,
    reportFamily || null,
    flagsSnapshot ? JSON.stringify(flagsSnapshot) : null,
  );

  return { id };
}

/**
 * Complete a QC run with summary data.
 *
 * @param {string} qcRunId
 * @param {{
 *   status: string,
 *   summaryJson: object,
 *   blockerCount: number,
 *   highCount: number,
 *   mediumCount: number,
 *   lowCount: number,
 *   advisoryCount: number,
 *   totalFindings: number,
 *   draftReadiness: string,
 *   durationMs: number,
 * }} data
 */
export function completeQcRun(qcRunId, data) {
  const db = getDb();

  db.prepare(`
    UPDATE qc_runs SET
      status = ?,
      summary_json = ?,
      blocker_count = ?,
      high_count = ?,
      medium_count = ?,
      low_count = ?,
      advisory_count = ?,
      total_findings = ?,
      draft_readiness = ?,
      duration_ms = ?,
      completed_at = datetime('now')
    WHERE id = ?
  `).run(
    data.status,
    JSON.stringify(data.summaryJson),
    data.blockerCount,
    data.highCount,
    data.mediumCount,
    data.lowCount,
    data.advisoryCount,
    data.totalFindings,
    data.draftReadiness,
    data.durationMs,
    qcRunId,
  );
}

/**
 * Mark a QC run as failed.
 *
 * @param {string} qcRunId
 * @param {string} errorMessage
 */
export function failQcRun(qcRunId, errorMessage) {
  const db = getDb();

  db.prepare(`
    UPDATE qc_runs SET
      status = 'failed',
      summary_json = ?,
      completed_at = datetime('now')
    WHERE id = ?
  `).run(
    JSON.stringify({ error: errorMessage }),
    qcRunId,
  );
}

/**
 * Get a QC run by ID.
 *
 * @param {string} qcRunId
 * @returns {object|null}
 */
export function getQcRun(qcRunId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM qc_runs WHERE id = ?').get(qcRunId);
  return row ? hydrateRun(row) : null;
}

/**
 * List QC runs for a case, newest first.
 *
 * @param {string} caseId
 * @param {{ limit?: number }} [opts]
 * @returns {object[]}
 */
export function listQcRuns(caseId, opts = {}) {
  const db = getDb();
  const limit = opts.limit || 20;

  const rows = db.prepare(`
    SELECT * FROM qc_runs
    WHERE case_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(caseId, limit);

  return rows.map(hydrateRun);
}

/**
 * Get the latest QC run for a generation run.
 *
 * @param {string} generationRunId
 * @returns {object|null}
 */
export function getLatestQcRunForGeneration(generationRunId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM qc_runs
    WHERE generation_run_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(generationRunId);
  return row ? hydrateRun(row) : null;
}

// ── QC Finding CRUD ─────────────────────────────────────────────────────────

/**
 * Insert a batch of findings for a QC run.
 *
 * @param {string} qcRunId
 * @param {import('./types.js').QCCheckResult[]} findings
 * @returns {{ count: number, ids: string[] }}
 */
export function insertFindings(qcRunId, findings) {
  const db = getDb();
  const ids = [];

  const stmt = db.prepare(`
    INSERT INTO qc_findings (
      id, qc_run_id, rule_id, severity, category,
      section_ids_json, canonical_field_ids_json,
      message, detail_message, suggested_action,
      evidence_json, source_refs_json,
      status, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?,
      'open', datetime('now')
    )
  `);

  const insertAll = db.transaction((items) => {
    for (const f of items) {
      const id = uuidv4();
      ids.push(id);

      stmt.run(
        id,
        qcRunId,
        f.ruleId,
        f.severity,
        f.category,
        JSON.stringify(f.sectionIds || []),
        JSON.stringify(f.canonicalFieldIds || []),
        f.message,
        f.detailMessage || null,
        f.suggestedAction || null,
        f.evidence ? JSON.stringify(f.evidence) : null,
        f.sourceRefs ? JSON.stringify(f.sourceRefs) : null,
      );
    }
  });

  insertAll(findings);

  return { count: ids.length, ids };
}

/**
 * Get all findings for a QC run.
 *
 * @param {string} qcRunId
 * @param {{ status?: string, severity?: string, category?: string }} [filters]
 * @returns {object[]}
 */
export function getFindings(qcRunId, filters = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM qc_findings WHERE qc_run_id = ?';
  const params = [qcRunId];

  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.severity) {
    sql += ' AND severity = ?';
    params.push(filters.severity);
  }
  if (filters.category) {
    sql += ' AND category = ?';
    params.push(filters.category);
  }

  sql += ' ORDER BY CASE severity WHEN \'blocker\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 WHEN \'low\' THEN 3 WHEN \'advisory\' THEN 4 ELSE 5 END, created_at';

  const rows = db.prepare(sql).all(...params);
  return rows.map(hydrateFinding);
}

/**
 * Get a single finding by ID.
 *
 * @param {string} findingId
 * @returns {object|null}
 */
export function getFinding(findingId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM qc_findings WHERE id = ?').get(findingId);
  return row ? hydrateFinding(row) : null;
}

/**
 * Get findings for a specific section across a QC run.
 *
 * @param {string} qcRunId
 * @param {string} sectionId
 * @returns {object[]}
 */
export function getFindingsForSection(qcRunId, sectionId) {
  const db = getDb();
  // Use JSON search since section_ids_json is a JSON array
  const rows = db.prepare(`
    SELECT * FROM qc_findings
    WHERE qc_run_id = ?
      AND section_ids_json LIKE ?
    ORDER BY CASE severity WHEN 'blocker' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 WHEN 'advisory' THEN 4 ELSE 5 END
  `).all(qcRunId, `%"${sectionId}"%`);

  return rows.map(hydrateFinding);
}

/**
 * Dismiss a finding.
 *
 * @param {string} findingId
 * @param {string} [note]
 * @returns {boolean}
 */
export function dismissFinding(findingId, note) {
  const db = getDb();
  const result = db.prepare(`
    UPDATE qc_findings SET
      status = 'dismissed',
      resolution_note = ?,
      resolved_at = datetime('now')
    WHERE id = ? AND status = 'open'
  `).run(note || null, findingId);

  return result.changes > 0;
}

/**
 * Resolve a finding.
 *
 * @param {string} findingId
 * @param {string} [note]
 * @returns {boolean}
 */
export function resolveFinding(findingId, note) {
  const db = getDb();
  const result = db.prepare(`
    UPDATE qc_findings SET
      status = 'resolved',
      resolution_note = ?,
      resolved_at = datetime('now')
    WHERE id = ? AND status = 'open'
  `).run(note || null, findingId);

  return result.changes > 0;
}

/**
 * Reopen a dismissed or resolved finding.
 *
 * @param {string} findingId
 * @returns {boolean}
 */
export function reopenFinding(findingId) {
  const db = getDb();
  const result = db.prepare(`
    UPDATE qc_findings SET
      status = 'open',
      resolution_note = NULL,
      resolved_at = NULL
    WHERE id = ? AND status IN ('dismissed', 'resolved')
  `).run(findingId);

  return result.changes > 0;
}

// ── Hydration helpers ───────────────────────────────────────────────────────

function hydrateRun(row) {
  return {
    ...row,
    flagsSnapshot: safeJsonParse(row.flags_snapshot_json),
    summary: safeJsonParse(row.summary_json),
  };
}

function hydrateFinding(row) {
  return {
    ...row,
    sectionIds: safeJsonParse(row.section_ids_json, []),
    canonicalFieldIds: safeJsonParse(row.canonical_field_ids_json, []),
    evidence: safeJsonParse(row.evidence_json),
    sourceRefs: safeJsonParse(row.source_refs_json, []),
  };
}

function safeJsonParse(str, fallback = null) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export default {
  createQcRun,
  completeQcRun,
  failQcRun,
  getQcRun,
  listQcRuns,
  getLatestQcRunForGeneration,
  insertFindings,
  getFindings,
  getFinding,
  getFindingsForSection,
  dismissFinding,
  resolveFinding,
  reopenFinding,
};
