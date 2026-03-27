/**
 * server/db/repositories/generationRepo.js
 * ------------------------------------------
 * Centralized repository for all generation-related SQLite operations.
 *
 * Phase 3 — Workflow Authority
 *
 * This module is the single DB access layer for:
 *   - generation_runs     — run lifecycle tracking
 *   - section_jobs        — section job lifecycle tracking
 *   - generated_sections  — output text per section
 *   - analysis_artifacts  — structured pre-generation analysis outputs
 *
 * All orchestrator and job runner DB calls should go through this module.
 * No raw getDb().prepare() calls should exist in orchestrator files.
 *
 * Run lifecycle (canonical):
 *   queued → preparing → retrieving → analyzing → drafting →
 *   validating → assembling → complete | partial_complete | failed
 *
 * Section job lifecycle (canonical):
 *   queued (independent) | blocked (dependent) →
 *   running → retrying → complete | failed | skipped
 *
 * Backward-compat mapping (thin layer only):
 *   Legacy consumers that expect old status names get a normalized view
 *   via normalizeRunStatus(). The internal model always uses the new names.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database.js';
import log from '../../logger.js';

// ── Canonical status constants ────────────────────────────────────────────────

/**
 * Canonical run lifecycle statuses.
 * These are the authoritative internal values stored in generation_runs.status.
 */
export const RUN_STATUS = {
  QUEUED:          'queued',
  PREPARING:       'preparing',
  RETRIEVING:      'retrieving',
  ANALYZING:       'analyzing',
  DRAFTING:        'drafting',
  VALIDATING:      'validating',
  ASSEMBLING:      'assembling',
  COMPLETE:        'complete',
  PARTIAL_COMPLETE: 'partial_complete',
  FAILED:          'failed',
};

/**
 * Canonical section job lifecycle statuses.
 * These are the authoritative internal values stored in section_jobs.status.
 */
export const JOB_STATUS = {
  QUEUED:    'queued',    // independent section, waiting to run
  BLOCKED:   'blocked',   // dependent section, waiting for prerequisites
  RUNNING:   'running',   // currently executing
  RETRYING:  'retrying',  // failed once, retrying
  COMPLETE:  'complete',  // successfully generated
  FAILED:    'failed',    // all attempts exhausted
  SKIPPED:   'skipped',   // skipped due to fatal dependency failure
};

// ── Backward-compat status mapping ───────────────────────────────────────────

/**
 * normalizeRunStatus(status)
 *
 * Maps legacy or alternate run status names to the canonical model.
 * Used only for backward compatibility with older UI or API consumers.
 * The internal model always uses the canonical names above.
 *
 * Legacy → Canonical:
 *   'pending'   → 'queued'
 *   'running'   → 'drafting'  (best approximation for mid-run state)
 *   'completed' → 'complete'
 *   'partial'   → 'partial_complete'
 *   'error'     → 'failed'
 *   'done'      → 'complete'
 *   'success'   → 'complete'
 *
 * @param {string} status
 * @returns {string} canonical status
 */
export function normalizeRunStatus(status) {
  const map = {
    pending:   RUN_STATUS.QUEUED,
    running:   RUN_STATUS.DRAFTING,
    completed: RUN_STATUS.COMPLETE,
    partial:   RUN_STATUS.PARTIAL_COMPLETE,
    error:     RUN_STATUS.FAILED,
    done:      RUN_STATUS.COMPLETE,
    success:   RUN_STATUS.COMPLETE,
  };
  return map[status] || status;
}

// ── Run operations ────────────────────────────────────────────────────────────

/**
 * Create a new generation run record.
 * Initial status: 'queued'
 *
 * @param {object} params
 *   @param {string} params.runId
 *   @param {string} params.caseId
 *   @param {string} params.formType
 *   @param {string|null} [params.assignmentId]
 * @returns {void}
 */
export function createRun({ runId, caseId, formType, assignmentId = null }) {
  getDb().prepare(`
    INSERT INTO generation_runs
      (id, case_id, assignment_id, form_type, status, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(runId, caseId, assignmentId, formType, RUN_STATUS.QUEUED);
}

/**
 * Update the status of a generation run.
 * Also sets started_at on first transition to 'preparing'.
 *
 * @param {string} runId
 * @param {string} status — one of RUN_STATUS values
 * @returns {void}
 */
export function updateRunStatus(runId, status) {
  if (status === RUN_STATUS.PREPARING) {
    getDb().prepare(`
      UPDATE generation_runs
         SET status = ?, started_at = datetime('now')
       WHERE id = ?
    `).run(status, runId);
  } else {
    getDb().prepare(`
      UPDATE generation_runs SET status = ? WHERE id = ?
    `).run(status, runId);
  }
}

/**
 * Update the assignment_id and form_type on a run record.
 * Called after context is built and assignment ID is resolved.
 *
 * @param {string} runId
 * @param {string} assignmentId
 * @param {string} formType
 * @returns {void}
 */
export function updateRunAssignment(runId, assignmentId, formType) {
  getDb().prepare(`
    UPDATE generation_runs
       SET assignment_id = ?, form_type = ?
     WHERE id = ?
  `).run(assignmentId, formType, runId);
}

/**
 * Persist phase-level timing and section metrics to a run record.
 *
 * @param {string} runId
 * @param {object} metrics
 * @returns {void}
 */
export function updateRunPhaseMetrics(runId, metrics) {
  getDb().prepare(`
    UPDATE generation_runs SET
      context_build_ms     = ?,
      report_plan_ms       = ?,
      retrieval_ms         = ?,
      analysis_ms          = ?,
      parallel_draft_ms    = ?,
      validation_ms        = ?,
      assembly_ms          = ?,
      section_count        = ?,
      success_count        = ?,
      error_count          = ?,
      retry_count          = ?,
      retrieval_cache_hit  = ?,
      memory_items_scanned = ?,
      memory_items_used    = ?,
      warnings_json        = ?,
      metrics_json         = ?
    WHERE id = ?
  `).run(
    metrics.contextBuildMs    || 0,
    metrics.reportPlanMs      || 0,
    metrics.retrievalMs       || 0,
    metrics.analysisMs        || 0,
    metrics.parallelDraftMs   || 0,
    metrics.validationMs      || 0,
    metrics.assemblyMs        || 0,
    metrics.sectionCount      || 0,
    metrics.successCount      || 0,
    metrics.errorCount        || 0,
    metrics.retryCount        || 0,
    metrics.retrievalCacheHit ? 1 : 0,
    metrics.memoryItemsScanned || 0,
    metrics.memoryItemsUsed    || 0,
    JSON.stringify(metrics.warnings || []),
    JSON.stringify(metrics.summary  || {}),
    runId
  );
}

/**
 * Persist the assembled draft package JSON to the run record.
 * Enables result retrieval after server restart without re-querying all sections.
 *
 * @param {string} runId
 * @param {object} draftPackage
 * @returns {void}
 */
export function persistDraftPackage(runId, draftPackage) {
  try {
    getDb().prepare(`
      UPDATE generation_runs SET draft_package_json = ? WHERE id = ?
    `).run(JSON.stringify(draftPackage), runId);
  } catch (err) {
    // Non-fatal — draft package persistence failure should not block completion
    log.error('generationRepo:persistDraftPackage', { error: err.message });
  }
}

/**
 * Mark a run as complete (complete or partial_complete).
 *
 * @param {string} runId
 * @param {string} status — RUN_STATUS.COMPLETE or RUN_STATUS.PARTIAL_COMPLETE
 * @param {number} totalMs
 * @returns {void}
 */
export function completeRun(runId, status, totalMs) {
  getDb().prepare(`
    UPDATE generation_runs SET
      status           = ?,
      completed_at     = datetime('now'),
      duration_ms      = ?,
      partial_complete = ?
    WHERE id = ?
  `).run(
    status,
    totalMs,
    status === RUN_STATUS.PARTIAL_COMPLETE ? 1 : 0,
    runId
  );
}

/**
 * Mark a run as failed.
 *
 * @param {string} runId
 * @param {string} errorText
 * @param {number} totalMs
 * @returns {void}
 */
export function failRun(runId, errorText, totalMs) {
  getDb().prepare(`
    UPDATE generation_runs SET
      status       = ?,
      completed_at = datetime('now'),
      duration_ms  = ?,
      error_text   = ?
    WHERE id = ?
  `).run(RUN_STATUS.FAILED, totalMs || 0, String(errorText || 'unknown'), runId);
}

/**
 * Get a generation run by ID.
 *
 * @param {string} runId
 * @returns {object|null}
 */
export function getRunById(runId) {
  return getDb().prepare(`
    SELECT id, case_id, assignment_id, form_type, status,
           started_at, completed_at, duration_ms,
           context_build_ms, report_plan_ms, retrieval_ms,
           analysis_ms, parallel_draft_ms, validation_ms, assembly_ms,
           section_count, success_count, error_count, retry_count,
           partial_complete, retrieval_cache_hit,
           memory_items_scanned, memory_items_used,
           warnings_json, metrics_json, error_text,
           draft_package_json, created_at
      FROM generation_runs WHERE id = ?
  `).get(runId) || null;
}

/**
 * Get all generation runs for a case (most recent first, limit 20).
 *
 * @param {string} caseId
 * @returns {object[]}
 */
export function getRunsForCase(caseId) {
  return getDb().prepare(`
    SELECT id, case_id, form_type, status,
           started_at, completed_at, duration_ms,
           section_count, success_count, error_count,
           created_at
      FROM generation_runs
     WHERE case_id = ?
     ORDER BY created_at DESC
     LIMIT 20
  `).all(caseId);
}

// ── Section job operations ────────────────────────────────────────────────────

/**
 * Create a section job record with an initial status.
 * Called during pre-creation at run start for all planned sections.
 *
 * @param {object} params
 *   @param {string} params.runId
 *   @param {string} params.sectionId
 *   @param {string} params.status       — JOB_STATUS.QUEUED or JOB_STATUS.BLOCKED
 *   @param {string} params.profileId    — generator profile ID
 *   @param {string[]} params.dependsOn  — section IDs this job depends on
 * @returns {string} jobId
 */
export function createSectionJob({ runId, sectionId, status, profileId, dependsOn = [] }) {
  const jobId = uuidv4();
  getDb().prepare(`
    INSERT INTO section_jobs
      (id, run_id, section_id, status, generator_profile,
       dependencies_json, attempt_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
  `).run(
    jobId,
    runId,
    sectionId,
    status,
    profileId,
    JSON.stringify(dependsOn)
  );
  return jobId;
}

/**
 * Update the status of a section job.
 *
 * @param {string} jobId
 * @param {string} status — one of JOB_STATUS values
 * @returns {void}
 */
export function updateJobStatus(jobId, status) {
  getDb().prepare(`
    UPDATE section_jobs SET status = ? WHERE id = ?
  `).run(status, jobId);
}

/**
 * Mark a section job as running.
 * Sets started_at and increments attempt_count.
 *
 * @param {string} jobId
 * @returns {void}
 */
export function markJobRunning(jobId) {
  getDb().prepare(`
    UPDATE section_jobs
       SET status        = ?,
           started_at    = datetime('now'),
           attempt_count = attempt_count + 1
     WHERE id = ?
  `).run(JOB_STATUS.RUNNING, jobId);
}

/**
 * Mark a section job as retrying.
 * Increments attempt_count and updates status.
 *
 * @param {string} jobId
 * @returns {void}
 */
export function markJobRetrying(jobId) {
  getDb().prepare(`
    UPDATE section_jobs
       SET status        = ?,
           attempt_count = attempt_count + 1
     WHERE id = ?
  `).run(JOB_STATUS.RETRYING, jobId);
}

/**
 * Mark a section job as complete with output metrics.
 *
 * @param {string} jobId
 * @param {object} metrics
 *   @param {number} metrics.durationMs
 *   @param {number} metrics.inputChars
 *   @param {number} metrics.outputChars
 *   @param {number} metrics.warningsCount
 *   @param {number|null} [metrics.promptTokens]
 *   @param {number|null} [metrics.completionTokens]
 *   @param {string[]} [metrics.retrievalSourceIds]
 * @returns {void}
 */
export function markJobCompleted(jobId, metrics) {
  getDb().prepare(`
    UPDATE section_jobs
       SET status                  = ?,
           completed_at            = datetime('now'),
           duration_ms             = ?,
           input_chars             = ?,
           output_chars            = ?,
           warnings_count          = ?,
           prompt_tokens           = ?,
           completion_tokens       = ?,
           retrieval_source_ids_json = ?
     WHERE id = ?
  `).run(
    JOB_STATUS.COMPLETE,
    metrics.durationMs          || 0,
    metrics.inputChars          || 0,
    metrics.outputChars         || 0,
    metrics.warningsCount       || 0,
    metrics.promptTokens        || null,
    metrics.completionTokens    || null,
    JSON.stringify(metrics.retrievalSourceIds || []),
    jobId
  );
}

/**
 * Mark a section job as failed.
 *
 * @param {string} jobId
 * @param {string} errorText
 * @param {number} durationMs
 * @returns {void}
 */
export function markJobFailed(jobId, errorText, durationMs) {
  getDb().prepare(`
    UPDATE section_jobs
       SET status       = ?,
           completed_at = datetime('now'),
           duration_ms  = ?,
           error_text   = ?
     WHERE id = ?
  `).run(JOB_STATUS.FAILED, durationMs || 0, String(errorText || 'unknown error'), jobId);
}

/**
 * Mark a section job as skipped.
 * Used when a dependent section cannot run due to a fatal prerequisite failure.
 *
 * @param {string} jobId
 * @param {string} reason
 * @returns {void}
 */
export function markJobSkipped(jobId, reason) {
  getDb().prepare(`
    UPDATE section_jobs
       SET status       = ?,
           completed_at = datetime('now'),
           error_text   = ?
     WHERE id = ?
  `).run(JOB_STATUS.SKIPPED, String(reason || 'prerequisite failed'), jobId);
}

/**
 * Get all section jobs for a run, ordered by creation time.
 *
 * @param {string} runId
 * @returns {object[]}
 */
export function getSectionJobsForRun(runId) {
  return getDb().prepare(`
    SELECT id, run_id, section_id, status, generator_profile,
           dependencies_json, attempt_count,
           started_at, completed_at, duration_ms,
           input_chars, output_chars, warnings_count,
           prompt_tokens, completion_tokens,
           retrieval_source_ids_json, error_text, created_at
      FROM section_jobs
     WHERE run_id = ?
     ORDER BY created_at ASC
  `).all(runId);
}

/**
 * Get a single section job by ID.
 *
 * @param {string} jobId
 * @returns {object|null}
 */
export function getSectionJobById(jobId) {
  return getDb().prepare(`
    SELECT id, run_id, section_id, status, generator_profile,
           attempt_count, started_at, completed_at, duration_ms,
           input_chars, output_chars, warnings_count, error_text
      FROM section_jobs WHERE id = ?
  `).get(jobId) || null;
}

/**
 * Get the job ID for a specific section within a run.
 * Used to look up pre-created job IDs.
 *
 * @param {string} runId
 * @param {string} sectionId
 * @returns {string|null} jobId
 */
export function getJobIdForSection(runId, sectionId) {
  const row = getDb().prepare(`
    SELECT id FROM section_jobs
     WHERE run_id = ? AND section_id = ?
     ORDER BY created_at DESC LIMIT 1
  `).get(runId, sectionId);
  return row?.id || null;
}

// ── Generated sections ────────────────────────────────────────────────────────

/**
 * Save or update a generated section record.
 * Upserts: if a record already exists for this run+section, updates it.
 *
 * @param {object} params
 *   @param {string} params.jobId
 *   @param {string} params.runId
 *   @param {string} params.caseId
 *   @param {string} params.sectionId
 *   @param {string} params.formType
 *   @param {string} params.text
 *   @param {number} params.examplesUsed
 * @returns {string} record ID
 */
export function saveGeneratedSection({ jobId, runId, caseId, sectionId, formType, text, examplesUsed }) {
  const db = getDb();

  const existing = db.prepare(`
    SELECT id FROM generated_sections WHERE run_id = ? AND section_id = ?
  `).get(runId, sectionId);

  if (existing) {
    db.prepare(`
      UPDATE generated_sections
         SET draft_text = ?, final_text = ?, examples_used = ?, job_id = ?
       WHERE id = ?
    `).run(text, text, examplesUsed, jobId, existing.id);
    return existing.id;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO generated_sections
      (id, job_id, run_id, case_id, section_id, form_type,
       draft_text, final_text, examples_used, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, jobId, runId, caseId, sectionId, formType, text, text, examplesUsed);

  return id;
}

export function updateGeneratedSectionReview({ runId, sectionId, text, approved = false }) {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id, job_id, case_id, form_type, examples_used
      FROM generated_sections
     WHERE run_id = ? AND section_id = ?
     ORDER BY created_at DESC
     LIMIT 1
  `).get(runId, sectionId);

  if (!existing) return null;

  const reviewedText = String(text || '').trim();
  const approvedAt = approved ? new Date().toISOString() : null;

  db.prepare(`
    UPDATE generated_sections
       SET reviewed_text = ?,
           final_text = ?,
           approved = ?,
           approved_at = ?
     WHERE id = ?
  `).run(
    reviewedText,
    reviewedText,
    approved ? 1 : 0,
    approvedAt,
    existing.id,
  );

  return {
    id: existing.id,
    jobId: existing.job_id,
    caseId: existing.case_id,
    formType: existing.form_type,
    sectionId,
    text: reviewedText,
    approved,
    approvedAt,
    examplesUsed: existing.examples_used || 0,
  };
}

/**
 * Get all generated sections for a run, ordered by creation time.
 *
 * @param {string} runId
 * @returns {object[]}
 */
export function getGeneratedSectionsForRun(runId) {
  return getDb().prepare(`
    SELECT section_id, final_text, draft_text, reviewed_text, approved, approved_at,
           inserted_at, examples_used, created_at
      FROM generated_sections
     WHERE run_id = ?
     ORDER BY created_at ASC
  `).all(runId);
}

// ── Analysis artifacts ────────────────────────────────────────────────────────

/**
 * Save an analysis artifact for a run.
 *
 * @param {object} params
 *   @param {string} params.runId
 *   @param {string} params.artifactType — e.g. 'comp_analysis', 'market_analysis', 'hbu_logic'
 *   @param {object} params.data
 *   @param {number} params.durationMs
 *   @param {string|null} [params.sectionId]
 * @returns {string} artifact ID
 */
export function saveAnalysisArtifact({ runId, artifactType, data, durationMs, sectionId = null }) {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO analysis_artifacts
      (id, run_id, artifact_type, section_id, data_json, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, runId, artifactType, sectionId, JSON.stringify(data), durationMs || 0);
  return id;
}

/**
 * Get all analysis artifacts for a run.
 *
 * @param {string} runId
 * @returns {object[]}
 */
export function getArtifactsForRun(runId) {
  return getDb().prepare(`
    SELECT id, artifact_type, section_id, data_json, duration_ms, created_at
      FROM analysis_artifacts
     WHERE run_id = ?
     ORDER BY created_at ASC
  `).all(runId);
}
