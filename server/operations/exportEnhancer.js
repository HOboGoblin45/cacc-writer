/**
 * server/operations/exportEnhancer.js
 * --------------------------------------
 * Phase 10 — Enhanced Export
 *
 * Builds structured case export manifests and enhanced support bundles.
 * Includes key table exports + structured artifacts, not full DB snapshot.
 *
 * Export contents:
 *   - Case metadata snapshot
 *   - Assignment intelligence snapshot
 *   - Document manifest
 *   - Extraction summary
 *   - Generation run history
 *   - QC history/findings summary
 *   - Insertion run history/results
 *   - Audit events for the case
 *   - Health snapshot
 *   - Version/build manifest
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/database.js';
import { queryAuditEvents } from './operationsRepo.js';
import { getCaseTimelineSummary } from './caseTimeline.js';
import { runHealthDiagnostics } from './healthDiagnostics.js';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, '..', '..', 'cases');
const PKG_PATH = path.join(__dirname, '..', '..', 'package.json');

// ── Case Export Manifest ──────────────────────────────────────────────────────

/**
 * Build a structured case export manifest.
 * This is a JSON document containing all key data for a case.
 *
 * @param {string} caseId
 * @returns {Promise<import('./types.js').CaseExportManifest>}
 */
export async function buildCaseExportManifest(caseId) {
  const db = getDb();
  const now = new Date().toISOString();

  const manifest = {
    caseId,
    exportedAt: now,
    appVersion: getAppVersion(),
    caseMetadata: null,
    assignmentIntelligence: null,
    documentManifest: [],
    extractionSummary: [],
    generationRunHistory: [],
    qcHistory: [],
    insertionRunHistory: [],
    auditEvents: [],
    timelineSummary: null,
    healthSnapshot: null,
  };

  // 1. Case metadata from file
  manifest.caseMetadata = readCaseFile(caseId, 'meta.json');

  // 2. Assignment intelligence from DB
  try {
    const intel = db.prepare('SELECT * FROM assignment_intelligence WHERE case_id = ?').get(caseId);
    if (intel) {
      manifest.assignmentIntelligence = {
        id: intel.id,
        formType: intel.form_type,
        bundle: safeParseJSON(intel.bundle_json, {}),
        createdAt: intel.created_at,
        updatedAt: intel.updated_at,
      };
    }
  } catch (err) { log.warn('export:assignment-intelligence', { caseId, error: err.message }); }

  // 3. Document manifest
  try {
    const docs = db.prepare('SELECT * FROM case_documents WHERE case_id = ? ORDER BY uploaded_at').all(caseId);
    manifest.documentManifest = docs.map(d => ({
      id: d.id,
      originalFilename: d.original_filename,
      docType: d.doc_type,
      fileType: d.file_type,
      fileSizeBytes: d.file_size_bytes,
      extractionStatus: d.extraction_status,
      uploadedAt: d.uploaded_at,
    }));
  } catch (err) { log.warn('export:document-manifest', { caseId, error: err.message }); }

  // 4. Extraction summary
  try {
    const extractions = db.prepare('SELECT * FROM document_extractions WHERE case_id = ? ORDER BY created_at').all(caseId);
    manifest.extractionSummary = extractions.map(e => ({
      id: e.id,
      documentId: e.document_id,
      docType: e.doc_type,
      status: e.status,
      method: e.extraction_method,
      factsExtracted: e.facts_extracted,
      sectionsExtracted: e.sections_extracted,
      durationMs: e.duration_ms,
      createdAt: e.created_at,
    }));
  } catch (err) { log.warn('export:extraction-summary', { caseId, error: err.message }); }

  // 5. Generation run history
  try {
    const runs = db.prepare(
      'SELECT id, status, form_type, started_at, completed_at, duration_ms, section_count, success_count, error_count, retry_count FROM generation_runs WHERE case_id = ? ORDER BY created_at DESC'
    ).all(caseId);

    for (const run of runs) {
      const sections = db.prepare(
        'SELECT section_id, status, duration_ms, output_chars FROM section_jobs WHERE run_id = ?'
      ).all(run.id);

      manifest.generationRunHistory.push({
        ...run,
        sections: sections.map(s => ({
          sectionId: s.section_id,
          status: s.status,
          durationMs: s.duration_ms,
          outputChars: s.output_chars,
        })),
      });
    }
  } catch (err) { log.warn('export:generation-runs', { caseId, error: err.message }); }

  // 6. QC history
  try {
    const qcRuns = db.prepare(
      'SELECT id, status, created_at, findings_count, blocker_count, high_count, medium_count, low_count, advisory_count, readiness_signal FROM qc_runs WHERE case_id = ? ORDER BY created_at DESC'
    ).all(caseId);

    for (const run of qcRuns) {
      const findings = db.prepare(
        'SELECT id, rule_id, severity, category, status, brief_message, affected_section_ids FROM qc_findings WHERE qc_run_id = ?'
      ).all(run.id);

      manifest.qcHistory.push({
        ...run,
        findings: findings.map(f => ({
          id: f.id,
          ruleId: f.rule_id,
          severity: f.severity,
          category: f.category,
          status: f.status,
          message: f.brief_message,
          affectedSections: f.affected_section_ids,
        })),
      });
    }
  } catch (err) { log.warn('export:qc-history', { caseId, error: err.message }); }

  // 7. Insertion run history
  try {
    const insRuns = db.prepare(
      'SELECT id, status, destination, started_at, completed_at, total_items, success_count, failed_count, verified_count FROM insertion_runs WHERE case_id = ? ORDER BY created_at DESC'
    ).all(caseId);

    for (const run of insRuns) {
      const items = db.prepare(
        'SELECT field_id, status, verification_status, error_code, duration_ms FROM insertion_run_items WHERE run_id = ?'
      ).all(run.id);

      manifest.insertionRunHistory.push({
        ...run,
        items: items.map(i => ({
          fieldId: i.field_id,
          status: i.status,
          verificationStatus: i.verification_status,
          errorCode: i.error_code,
          durationMs: i.duration_ms,
        })),
      });
    }
  } catch (err) { log.warn('export:insertion-runs', { caseId, error: err.message }); }

  // 8. Audit events for this case
  try {
    manifest.auditEvents = queryAuditEvents({ caseId, limit: 500 });
  } catch (err) { log.warn('export:audit-events', { caseId, error: err.message }); }

  // 9. Timeline summary
  try {
    manifest.timelineSummary = getCaseTimelineSummary(caseId);
  } catch (err) { log.warn('export:timeline-summary', { caseId, error: err.message }); }

  // 10. Health snapshot
  try {
    manifest.healthSnapshot = await runHealthDiagnostics();
  } catch (err) { log.warn('export:health-snapshot', { error: err.message }); }

  return manifest;
}

/**
 * Write a case export manifest to disk as JSON.
 *
 * @param {string} caseId
 * @param {string} [outputDir] - defaults to exports/
 * @returns {Promise<{ path: string, sizeBytes: number }>}
 */
export async function exportCaseManifest(caseId, outputDir) {
  const manifest = await buildCaseExportManifest(caseId);

  const dir = outputDir || path.join(__dirname, '..', '..', 'exports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `case-export-${caseId}-${timestamp}.json`;
  const filePath = path.join(dir, filename);

  const content = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(filePath, content, 'utf8');

  log.info('export:case-manifest', { caseId, path: filePath, sizeBytes: content.length });

  return { path: filePath, sizeBytes: content.length };
}

// ── Enhanced Support Bundle Data ──────────────────────────────────────────────

/**
 * Get structured data to include in a support bundle.
 * This supplements the existing backupExport.js bundle with DB-sourced data.
 *
 * @returns {Object}
 */
export function getSupportBundleData() {
  const db = getDb();
  const data = {
    generatedAt: new Date().toISOString(),
    appVersion: getAppVersion(),
    dbStats: {},
    recentAuditEvents: [],
    recentGenerationRuns: [],
    recentQcRuns: [],
    recentInsertionRuns: [],
  };

  // DB table counts
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for (const t of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get();
        data.dbStats[t.name] = row?.cnt || 0;
      } catch { data.dbStats[t.name] = -1; }
    }
  } catch (err) { log.warn('export:db-stats', { error: err.message }); }

  // Recent audit events (last 100)
  try {
    data.recentAuditEvents = queryAuditEvents({ limit: 100 });
  } catch (err) { log.warn('export:recent-audit', { error: err.message }); }

  // Recent generation runs (last 10)
  try {
    data.recentGenerationRuns = db.prepare(
      'SELECT id, case_id, status, form_type, started_at, completed_at, duration_ms, section_count, success_count, error_count FROM generation_runs ORDER BY created_at DESC LIMIT 10'
    ).all();
  } catch (err) { log.warn('export:recent-gen-runs', { error: err.message }); }

  // Recent QC runs (last 10)
  try {
    data.recentQcRuns = db.prepare(
      'SELECT id, case_id, status, created_at, findings_count, blocker_count, high_count, readiness_signal FROM qc_runs ORDER BY created_at DESC LIMIT 10'
    ).all();
  } catch (err) { log.warn('export:recent-qc-runs', { error: err.message }); }

  // Recent insertion runs (last 10)
  try {
    data.recentInsertionRuns = db.prepare(
      'SELECT id, case_id, status, destination, started_at, completed_at, total_items, success_count, failed_count, verified_count FROM insertion_runs ORDER BY created_at DESC LIMIT 10'
    ).all();
  } catch (err) { log.warn('export:recent-insertion-runs', { error: err.message }); }

  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readCaseFile(caseId, filename) {
  try {
    const filePath = path.join(CASES_DIR, caseId, filename);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getAppVersion() {
  try {
    if (fs.existsSync(PKG_PATH)) {
      const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
      return pkg.version || 'unknown';
    }
  } catch (err) { log.warn('export:app-version', { error: err.message }); }
  return 'unknown';
}

function safeParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

export default {
  buildCaseExportManifest,
  exportCaseManifest,
  getSupportBundleData,
};
