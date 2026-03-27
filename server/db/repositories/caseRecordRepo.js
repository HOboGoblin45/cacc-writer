/**
 * server/db/repositories/caseRecordRepo.js
 * -----------------------------------------
 * Canonical case record persistence layer (Phase B foundation).
 *
 * Tables:
 *   - case_records
 *   - case_facts
 *   - case_outputs
 *   - case_history
 */

import { getDb } from '../database.js';

function parseJSON(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function toJSON(value, fallback) {
  const safe = value === undefined ? fallback : value;
  return JSON.stringify(safe);
}

export function saveCaseAggregate({ caseId, meta = {}, facts = {}, outputs = {}, history = {}, provenance = {} }) {
  if (!caseId) throw new Error('caseId is required');

  const db = getDb();
  const now = new Date().toISOString();

  const safeMeta = {
    ...meta,
    caseId,
    formType: meta.formType || '1004',
    status: meta.status || 'active',
    pipelineStage: meta.pipelineStage || 'intake',
    workflowStatus: meta.workflowStatus || 'facts_incomplete',
    address: meta.address || '',
    borrower: meta.borrower || '',
    unresolvedIssues: Array.isArray(meta.unresolvedIssues) ? meta.unresolvedIssues : [],
    createdAt: meta.createdAt || now,
    updatedAt: meta.updatedAt || now,
  };

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO case_records (
        case_id, form_type, status, pipeline_stage, workflow_status,
        address, borrower, unresolved_issues_json, meta_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        form_type = excluded.form_type,
        status = excluded.status,
        pipeline_stage = excluded.pipeline_stage,
        workflow_status = excluded.workflow_status,
        address = excluded.address,
        borrower = excluded.borrower,
        unresolved_issues_json = excluded.unresolved_issues_json,
        meta_json = excluded.meta_json,
        updated_at = excluded.updated_at
    `).run(
      caseId,
      safeMeta.formType,
      safeMeta.status,
      safeMeta.pipelineStage,
      safeMeta.workflowStatus,
      safeMeta.address,
      safeMeta.borrower,
      toJSON(safeMeta.unresolvedIssues, []),
      toJSON(safeMeta, {}),
      safeMeta.createdAt,
      safeMeta.updatedAt,
    );

    db.prepare(`
      INSERT INTO case_facts (case_id, facts_json, provenance_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        facts_json = excluded.facts_json,
        provenance_json = excluded.provenance_json,
        updated_at = excluded.updated_at
    `).run(
      caseId,
      toJSON(facts, {}),
      toJSON(provenance, {}),
      safeMeta.updatedAt,
    );

    db.prepare(`
      INSERT INTO case_outputs (case_id, outputs_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        outputs_json = excluded.outputs_json,
        updated_at = excluded.updated_at
    `).run(
      caseId,
      toJSON(outputs, {}),
      safeMeta.updatedAt,
    );

    db.prepare(`
      INSERT INTO case_history (case_id, history_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        history_json = excluded.history_json,
        updated_at = excluded.updated_at
    `).run(
      caseId,
      toJSON(history, {}),
      safeMeta.updatedAt,
    );
  });

  tx();
}

export function getCaseAggregate(caseId) {
  if (!caseId) return null;

  const row = getDb().prepare(`
    SELECT
      r.case_id,
      r.meta_json,
      r.created_at,
      r.updated_at,
      f.facts_json,
      f.provenance_json,
      o.outputs_json,
      h.history_json
    FROM case_records r
    LEFT JOIN case_facts f   ON f.case_id = r.case_id
    LEFT JOIN case_outputs o ON o.case_id = r.case_id
    LEFT JOIN case_history h ON h.case_id = r.case_id
    WHERE r.case_id = ?
  `).get(caseId);

  if (!row) return null;

  return {
    caseId: row.case_id,
    meta: parseJSON(row.meta_json, {}),
    facts: parseJSON(row.facts_json, {}),
    outputs: parseJSON(row.outputs_json, {}),
    history: parseJSON(row.history_json, {}),
    provenance: parseJSON(row.provenance_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function listCaseAggregates(limit = 500) {
  const rows = getDb().prepare(`
    SELECT
      r.case_id,
      r.meta_json,
      r.created_at,
      r.updated_at,
      f.facts_json,
      f.provenance_json,
      o.outputs_json,
      h.history_json
    FROM case_records r
    LEFT JOIN case_facts f   ON f.case_id = r.case_id
    LEFT JOIN case_outputs o ON o.case_id = r.case_id
    LEFT JOIN case_history h ON h.case_id = r.case_id
    ORDER BY datetime(r.updated_at) DESC, r.case_id DESC
    LIMIT ?
  `).all(limit);

  return rows.map(row => ({
    caseId: row.case_id,
    meta: parseJSON(row.meta_json, {}),
    facts: parseJSON(row.facts_json, {}),
    outputs: parseJSON(row.outputs_json, {}),
    history: parseJSON(row.history_json, {}),
    provenance: parseJSON(row.provenance_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }));
}

export function deleteCaseAggregate(caseId) {
  if (!caseId) return;
  getDb().prepare('DELETE FROM case_records WHERE case_id = ?').run(caseId);
}
