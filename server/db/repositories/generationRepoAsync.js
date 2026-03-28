/**
 * server/db/repositories/generationRepoAsync.js
 * =============================================
 * Async version of generationRepo for the migration phase.
 *
 * This module is the reference implementation for async repository conversion.
 * It re-exports all constants from generationRepo and provides async-wrapped versions
 * of all repository functions.
 *
 * Usage during migration:
 *   Phase 1: Import this async version in new code
 *   Phase 2: Update calling code to await all functions
 *   Phase 3: Once all callers are updated, replace sync generationRepo with this
 *   Phase 4: Remove the sync version
 *
 * Both versions can coexist during the migration. New code should prefer the async version.
 *
 * @module generationRepoAsync
 */

import { v4 as uuidv4 } from 'uuid';
import { createAsyncRunner } from '../AsyncQueryRunner.js';
import log from '../../logger.js';

// Re-export all constants from sync version
export {
  RUN_STATUS,
  JOB_STATUS,
  normalizeRunStatus,
} from './generationRepo.js';

import {
  RUN_STATUS,
  JOB_STATUS,
} from './generationRepo.js';

/**
 * Create a new generation run record.
 * Initial status: 'queued'
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {object} params
 *   @param {string} params.runId
 *   @param {string} params.caseId
 *   @param {string} params.formType
 *   @param {string|null} [params.assignmentId]
 * @returns {Promise<void>}
 */
export async function createRun(runner, { runId, caseId, formType, assignmentId = null }) {
  if (!runner) throw new Error('createRun: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
    INSERT INTO generation_runs
      (id, case_id, assignment_id, form_type, status, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [runId, caseId, assignmentId, formType, RUN_STATUS.QUEUED]);
}

/**
 * Update the status of a generation run.
 * Also sets started_at on first transition to 'preparing'.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @param {string} status - one of RUN_STATUS values
 * @returns {Promise<void>}
 */
export async function updateRunStatus(runner, runId, status) {
  if (!runner) throw new Error('updateRunStatus: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  if (status === RUN_STATUS.PREPARING) {
    await sqlRunner.run(`
      UPDATE generation_runs
         SET status = ?, started_at = datetime('now')
       WHERE id = ?
    `, [status, runId]);
  } else {
    await sqlRunner.run(`
      UPDATE generation_runs SET status = ? WHERE id = ?
    `, [status, runId]);
  }
}

/**
 * Update the assignment_id and form_type on a run record.
 * Called after context is built and assignment ID is resolved.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @param {string} assignmentId
 * @param {string} formType
 * @returns {Promise<void>}
 */
export async function updateRunAssignment(runner, runId, assignmentId, formType) {
  if (!runner) throw new Error('updateRunAssignment: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
    UPDATE generation_runs
       SET assignment_id = ?, form_type = ?
     WHERE id = ?
  `, [assignmentId, formType, runId]);
}

/**
 * Persist phase-level timing and section metrics to a run record.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @param {object} metrics
 * @returns {Promise<void>}
 */
export async function updateRunPhaseMetrics(runner, runId, metrics) {
  if (!runner) throw new Error('updateRunPhaseMetrics: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
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
  `, [
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
  ]);
}

/**
 * Persist the assembled draft package JSON to the run record.
 * Enables result retrieval after server restart without re-querying all sections.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @param {object} draftPackage
 * @returns {Promise<void>}
 */
export async function persistDraftPackage(runner, runId, draftPackage) {
  if (!runner) throw new Error('persistDraftPackage: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  try {
    await sqlRunner.run(`
      UPDATE generation_runs SET draft_package_json = ? WHERE id = ?
    `, [JSON.stringify(draftPackage), runId]);
  } catch (err) {
    // Non-fatal — draft package persistence failure should not block completion
    log.error('generationRepoAsync:persistDraftPackage', { error: err.message });
  }
}

/**
 * Mark a run as complete (complete or partial_complete).
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @param {string} status - RUN_STATUS.COMPLETE or RUN_STATUS.PARTIAL_COMPLETE
 * @param {number} totalMs
 * @returns {Promise<void>}
 */
export async function completeRun(runner, runId, status, totalMs) {
  if (!runner) throw new Error('completeRun: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
    UPDATE generation_runs SET
      status           = ?,
      completed_at     = datetime('now'),
      duration_ms      = ?,
      partial_complete = ?
    WHERE id = ?
  `, [
    status,
    totalMs,
    status === RUN_STATUS.PARTIAL_COMPLETE ? 1 : 0,
    runId
  ]);
}

/**
 * Mark a run as failed.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @param {string} errorText
 * @param {number} totalMs
 * @returns {Promise<void>}
 */
export async function failRun(runner, runId, errorText, totalMs) {
  if (!runner) throw new Error('failRun: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
    UPDATE generation_runs SET
      status       = ?,
      completed_at = datetime('now'),
      duration_ms  = ?,
      error_text   = ?
    WHERE id = ?
  `, [RUN_STATUS.FAILED, totalMs || 0, String(errorText || 'unknown'), runId]);
}

/**
 * Get a generation run by ID.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @returns {Promise<object|null>}
 */
export async function getRunById(runner, runId) {
  if (!runner) throw new Error('getRunById: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  const row = await sqlRunner.get(`
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
  `, [runId]);
  return row || null;
}

/**
 * Get all generation runs for a case (most recent first, limit 20).
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} caseId
 * @returns {Promise<object[]>}
 */
export async function getRunsForCase(runner, caseId) {
  if (!runner) throw new Error('getRunsForCase: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  return await sqlRunner.all(`
    SELECT id, case_id, form_type, status,
           started_at, completed_at, duration_ms,
           section_count, success_count, error_count,
           created_at
      FROM generation_runs
     WHERE case_id = ?
     ORDER BY created_at DESC
     LIMIT 20
  `, [caseId]);
}

/**
 * Create a section job record with an initial status.
 * Called during pre-creation at run start for all planned sections.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {object} params
 *   @param {string} params.runId
 *   @param {string} params.sectionId
 *   @param {string} params.status - JOB_STATUS.QUEUED or JOB_STATUS.BLOCKED
 *   @param {string} params.profileId - generator profile ID
 *   @param {string[]} params.dependsOn - section IDs this job depends on
 * @returns {Promise<string>} jobId
 */
export async function createSectionJob(runner, { runId, sectionId, status, profileId, dependsOn = [] }) {
  if (!runner) throw new Error('createSectionJob: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  const jobId = uuidv4();
  await sqlRunner.run(`
    INSERT INTO section_jobs
      (id, run_id, section_id, status, generator_profile,
       dependencies_json, attempt_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
  `, [
    jobId,
    runId,
    sectionId,
    status,
    profileId,
    JSON.stringify(dependsOn)
  ]);
  return jobId;
}

/**
 * Update the status of a section job.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} jobId
 * @param {string} status - one of JOB_STATUS values
 * @returns {Promise<void>}
 */
export async function updateJobStatus(runner, jobId, status) {
  if (!runner) throw new Error('updateJobStatus: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
    UPDATE section_jobs SET status = ? WHERE id = ?
  `, [status, jobId]);
}

/**
 * Mark a section job as running.
 * Sets started_at and increments attempt_count.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function markJobRunning(runner, jobId) {
  if (!runner) throw new Error('markJobRunning: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
    UPDATE section_jobs
       SET status        = ?,
           started_at    = datetime('now'),
           attempt_count = attempt_count + 1
     WHERE id = ?
  `, [JOB_STATUS.RUNNING, jobId]);
}

/**
 * Mark a section job as retrying.
 * Increments attempt_count and updates status.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function markJobRetrying(runner, jobId) {
  if (!runner) throw new Error('markJobRetrying: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
    UPDATE section_jobs
       SET status        = ?,
           attempt_count = attempt_count + 1
     WHERE id = ?
  `, [JOB_STATUS.RETRYING, jobId]);
}

/**
 * Mark a section job as complete with output metrics.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} jobId
 * @param {object} metrics
 *   @param {number} metrics.durationMs
 *   @param {number} metrics.inputChars
 *   @param {number} metrics.outputChars
 *   @param {number} metrics.warningsCount
 *   @param {number|null} [metrics.promptTokens]
 *   @param {number|null} [metrics.completionTokens]
 *   @param {string[]} [metrics.retrievalSourceIds]
 * @returns {Promise<void>}
 */
export async function markJobCompleted(runner, jobId, metrics) {
  if (!runner) throw new Error('markJobCompleted: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
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
  `, [
    JOB_STATUS.COMPLETE,
    metrics.durationMs          || 0,
    metrics.inputChars          || 0,
    metrics.outputChars         || 0,
    metrics.warningsCount       || 0,
    metrics.promptTokens        || null,
    metrics.completionTokens    || null,
    JSON.stringify(metrics.retrievalSourceIds || []),
    jobId
  ]);
}

/**
 * Mark a section job as failed.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} jobId
 * @param {string} errorText
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
export async function markJobFailed(runner, jobId, errorText, durationMs) {
  if (!runner) throw new Error('markJobFailed: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
    UPDATE section_jobs
       SET status       = ?,
           completed_at = datetime('now'),
           duration_ms  = ?,
           error_text   = ?
     WHERE id = ?
  `, [JOB_STATUS.FAILED, durationMs || 0, String(errorText || 'unknown error'), jobId]);
}

/**
 * Mark a section job as skipped.
 * Used when a dependent section cannot run due to a fatal prerequisite failure.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} jobId
 * @param {string} reason
 * @returns {Promise<void>}
 */
export async function markJobSkipped(runner, jobId, reason) {
  if (!runner) throw new Error('markJobSkipped: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  await sqlRunner.run(`
    UPDATE section_jobs
       SET status       = ?,
           completed_at = datetime('now'),
           error_text   = ?
     WHERE id = ?
  `, [JOB_STATUS.SKIPPED, String(reason || 'prerequisite failed'), jobId]);
}

/**
 * Get all section jobs for a run, ordered by creation time.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @returns {Promise<object[]>}
 */
export async function getSectionJobsForRun(runner, runId) {
  if (!runner) throw new Error('getSectionJobsForRun: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  return await sqlRunner.all(`
    SELECT id, run_id, section_id, status, generator_profile,
           dependencies_json, attempt_count,
           started_at, completed_at, duration_ms,
           input_chars, output_chars, warnings_count,
           prompt_tokens, completion_tokens,
           retrieval_source_ids_json, error_text, created_at
      FROM section_jobs
     WHERE run_id = ?
     ORDER BY created_at ASC
  `, [runId]);
}

/**
 * Get a single section job by ID.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} jobId
 * @returns {Promise<object|null>}
 */
export async function getSectionJobById(runner, jobId) {
  if (!runner) throw new Error('getSectionJobById: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  const row = await sqlRunner.get(`
    SELECT id, run_id, section_id, status, generator_profile,
           attempt_count, started_at, completed_at, duration_ms,
           input_chars, output_chars, warnings_count, error_text
      FROM section_jobs WHERE id = ?
  `, [jobId]);
  return row || null;
}

/**
 * Get the job ID for a specific section within a run.
 * Used to look up pre-created job IDs.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @param {string} sectionId
 * @returns {Promise<string|null>} jobId
 */
export async function getJobIdForSection(runner, runId, sectionId) {
  if (!runner) throw new Error('getJobIdForSection: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  const row = await sqlRunner.get(`
    SELECT id FROM section_jobs
     WHERE run_id = ? AND section_id = ?
     ORDER BY created_at DESC LIMIT 1
  `, [runId, sectionId]);
  return row?.id || null;
}

/**
 * Save or update a generated section record.
 * Upserts: if a record already exists for this run+section, updates it.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {object} params
 *   @param {string} params.jobId
 *   @param {string} params.runId
 *   @param {string} params.caseId
 *   @param {string} params.sectionId
 *   @param {string} params.formType
 *   @param {string} params.text
 *   @param {number} params.examplesUsed
 * @returns {Promise<string>} record ID
 */
export async function saveGeneratedSection(runner, { jobId, runId, caseId, sectionId, formType, text, examplesUsed }) {
  if (!runner) throw new Error('saveGeneratedSection: runner is required');
  const sqlRunner = createAsyncRunner(runner);

  const existing = await sqlRunner.get(`
    SELECT id FROM generated_sections WHERE run_id = ? AND section_id = ?
  `, [runId, sectionId]);

  if (existing) {
    await sqlRunner.run(`
      UPDATE generated_sections
         SET draft_text = ?, final_text = ?, examples_used = ?, job_id = ?
       WHERE id = ?
    `, [text, text, examplesUsed, jobId, existing.id]);
    return existing.id;
  }

  const id = uuidv4();
  await sqlRunner.run(`
    INSERT INTO generated_sections
      (id, job_id, run_id, case_id, section_id, form_type,
       draft_text, final_text, examples_used, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [id, jobId, runId, caseId, sectionId, formType, text, text, examplesUsed]);

  return id;
}

/**
 * Update a generated section review.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @param {string} sectionId
 * @param {string} text
 * @param {boolean} [approved=false]
 * @returns {Promise<object|null>}
 */
export async function updateGeneratedSectionReview(runner, { runId, sectionId, text, approved = false }) {
  if (!runner) throw new Error('updateGeneratedSectionReview: runner is required');
  const sqlRunner = createAsyncRunner(runner);

  const existing = await sqlRunner.get(`
    SELECT id, job_id, case_id, form_type, examples_used
      FROM generated_sections
     WHERE run_id = ? AND section_id = ?
     ORDER BY created_at DESC
     LIMIT 1
  `, [runId, sectionId]);

  if (!existing) return null;

  const reviewedText = String(text || '').trim();
  const approvedAt = approved ? new Date().toISOString() : null;

  await sqlRunner.run(`
    UPDATE generated_sections
       SET reviewed_text = ?,
           final_text = ?,
           approved = ?,
           approved_at = ?
     WHERE id = ?
  `, [
    reviewedText,
    reviewedText,
    approved ? 1 : 0,
    approvedAt,
    existing.id,
  ]);

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
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @returns {Promise<object[]>}
 */
export async function getGeneratedSectionsForRun(runner, runId) {
  if (!runner) throw new Error('getGeneratedSectionsForRun: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  return await sqlRunner.all(`
    SELECT section_id, final_text, draft_text, reviewed_text, approved, approved_at,
           inserted_at, examples_used, created_at
      FROM generated_sections
     WHERE run_id = ?
     ORDER BY created_at ASC
  `, [runId]);
}

/**
 * Save an analysis artifact for a run.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {object} params
 *   @param {string} params.runId
 *   @param {string} params.artifactType - e.g. 'comp_analysis', 'market_analysis', 'hbu_logic'
 *   @param {object} params.data
 *   @param {number} params.durationMs
 *   @param {string|null} [params.sectionId]
 * @returns {Promise<string>} artifact ID
 */
export async function saveAnalysisArtifact(runner, { runId, artifactType, data, durationMs, sectionId = null }) {
  if (!runner) throw new Error('saveAnalysisArtifact: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  const id = uuidv4();
  await sqlRunner.run(`
    INSERT INTO analysis_artifacts
      (id, run_id, artifact_type, section_id, data_json, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `, [id, runId, artifactType, sectionId, JSON.stringify(data), durationMs || 0]);
  return id;
}

/**
 * Get all analysis artifacts for a run.
 *
 * @async
 * @param {Object} runner - AsyncQueryRunner or database object
 * @param {string} runId
 * @returns {Promise<object[]>}
 */
export async function getArtifactsForRun(runner, runId) {
  if (!runner) throw new Error('getArtifactsForRun: runner is required');
  const sqlRunner = createAsyncRunner(runner);
  return await sqlRunner.all(`
    SELECT id, artifact_type, section_id, data_json, duration_ms, created_at
      FROM analysis_artifacts
     WHERE run_id = ?
     ORDER BY created_at ASC
  `, [runId]);
}
