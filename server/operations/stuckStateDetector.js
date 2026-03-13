/**
 * server/operations/stuckStateDetector.js
 * ----------------------------------------
 * Detects and optionally force-fails processes stuck in running/processing
 * states beyond configurable time thresholds.
 *
 * Covers: generation runs, extraction jobs, insertion runs, ingest jobs.
 */

import { getDb } from '../db/database.js';
import { emitCaseEvent, emitSystemEvent } from './auditLogger.js';

// ── Thresholds (minutes) ────────────────────────────────────────────────────

const THRESHOLDS = {
  generation_run:  30,
  extraction_job:  20,
  insertion_run:   15,
  ingest_job:      20,
};

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Scan all running/processing entities and flag any that exceed their threshold.
 * @returns {{ generationRuns: object[], extractionJobs: object[], insertionRuns: object[], ingestJobs: object[] }}
 */
export function detectStuckStates() {
  const db = getDb();
  const now = Date.now();

  const stuckGenerationRuns = findStuck(db,
    `SELECT id, case_id, status, started_at FROM generation_runs WHERE status = 'running'`,
    THRESHOLDS.generation_run, now);

  const stuckExtractionJobs = findStuck(db,
    `SELECT id, document_id, case_id, status, started_at FROM document_extractions WHERE status = 'running'`,
    THRESHOLDS.extraction_job, now);

  const stuckInsertionRuns = findStuck(db,
    `SELECT id, case_id, status, started_at FROM insertion_runs WHERE status = 'running'`,
    THRESHOLDS.insertion_run, now);

  const stuckIngestJobs = findStuck(db,
    `SELECT id, source_file, status, started_at FROM ingest_jobs WHERE status = 'processing'`,
    THRESHOLDS.ingest_job, now);

  return {
    generationRuns: stuckGenerationRuns,
    extractionJobs: stuckExtractionJobs,
    insertionRuns:  stuckInsertionRuns,
    ingestJobs:     stuckIngestJobs,
    totalStuck: stuckGenerationRuns.length + stuckExtractionJobs.length +
                stuckInsertionRuns.length + stuckIngestJobs.length,
  };
}

function findStuck(db, sql, thresholdMinutes, now) {
  const rows = db.prepare(sql).all();
  const thresholdMs = thresholdMinutes * 60 * 1000;
  return rows.filter(row => {
    const started = row.started_at ? new Date(row.started_at).getTime() : 0;
    return started > 0 && (now - started) > thresholdMs;
  }).map(row => ({
    ...row,
    stuckMinutes: Math.round((now - new Date(row.started_at).getTime()) / 60000),
    threshold: thresholdMinutes,
  }));
}

// ── Force-fail helpers ──────────────────────────────────────────────────────

/**
 * Force-fail a stuck generation run.
 */
export function failStuckGenerationRun(runId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM generation_runs WHERE id = ?').get(runId);
  if (!row) throw new Error(`Generation run ${runId} not found`);
  if (row.status !== 'running') throw new Error(`Run ${runId} is not running (status: ${row.status})`);

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE generation_runs SET status = 'failed', error_text = ?, completed_at = ? WHERE id = ?`
  ).run('Force-failed by stuck state detector', now, runId);

  emitCaseEvent(row.case_id, 'generation.stuck_failed',
    `Generation run ${runId} force-failed after being stuck`, { runId });

  return { runId, previousStatus: 'running', newStatus: 'failed', failedAt: now };
}

/**
 * Force-fail a stuck extraction job.
 */
export function failStuckExtractionJob(jobId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM document_extractions WHERE id = ?').get(jobId);
  if (!row) throw new Error(`Extraction job ${jobId} not found`);
  if (row.status !== 'running') throw new Error(`Job ${jobId} is not running (status: ${row.status})`);

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE document_extractions SET status = 'failed', error_text = ?, completed_at = ? WHERE id = ?`
  ).run('Force-failed by stuck state detector', now, jobId);

  return { jobId, previousStatus: 'running', newStatus: 'failed', failedAt: now };
}

export default { detectStuckStates, failStuckGenerationRun, failStuckExtractionJob };
