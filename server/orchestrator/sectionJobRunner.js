/**
 * server/orchestrator/sectionJobRunner.js
 * -----------------------------------------
 * Executes individual section generation jobs within a full-draft run.
 *
 * Each job:
 *   1. Creates a section_jobs record in SQLite
 *   2. Builds prompt messages via buildPromptMessages()
 *   3. Calls callAI() with the profile's temperature/maxTokens
 *   4. Captures per-section metrics (duration, chars, tokens)
 *   5. Implements 1-retry policy on failure
 *   6. Updates job status in SQLite
 *   7. Creates a generated_sections record
 *
 * Performance target: ~2–4s per section (network-bound)
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import { buildPromptMessages } from '../promptBuilder.js';
import { getProfile } from '../generators/generatorProfiles.js';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR  = path.join(__dirname, '..', '..', 'cases');
const MAX_RETRIES = 1; // 1 retry per section as specified

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJSON(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Build an assignmentMeta object from AssignmentContext for prompt injection.
 * Maps the normalized context fields to the shape expected by buildPromptMessages().
 */
function buildAssignmentMetaFromContext(context) {
  return {
    assignmentPurpose:   context.assignmentPurpose   || 'purchase',
    loanProgram:         context.loanProgram         || 'conventional',
    propertyType:        context.propertyType        || 'residential',
    occupancyType:       context.occupancyType       || 'owner_occupied',
    reportConditionMode: context.reportConditionMode || 'as_is',
    county:              context.subject?.county     || '',
    marketArea:          context.market?.marketArea  || context.subject?.city || '',
    state:               context.subject?.state      || 'IL',
    clientName:          context.assignment?.clientName || '',
    subjectCondition:    context.improvements?.condition || context.subject?.condition || '',
  };
}

/**
 * Build the examples arrays from the retrieval pack for a section.
 * Splits into voiceExamples (approvedNarrative) and otherExamples.
 */
function buildExamplesFromPack(retrievalPack, sectionId) {
  const sectionMemory = retrievalPack?.sections?.[sectionId];
  if (!sectionMemory) return { voiceExamples: [], otherExamples: [] };

  const examples = sectionMemory.examples || [];
  const voiceExamples = examples.filter(e =>
    e.sourceType === 'approvedNarrative' || e.sourceType === 'voice'
  );
  const otherExamples = examples.filter(e =>
    e.sourceType !== 'approvedNarrative' && e.sourceType !== 'voice'
  );

  return { voiceExamples, otherExamples };
}

/**
 * Build a synthesis context block for dependent sections (e.g. reconciliation).
 * Injects prior section texts as additional context.
 */
function buildSynthesisContext(sectionDef, priorResults) {
  if (!sectionDef.dependsOn?.length || !priorResults) return null;

  const lines = ['PRIOR SECTION DRAFTS (synthesize these into the current section):'];
  let hasContent = false;

  for (const depId of sectionDef.dependsOn) {
    const result = priorResults[depId];
    if (result?.text && result.text.length > 20) {
      lines.push('');
      lines.push(`[${depId.replace(/_/g, ' ').toUpperCase()}]:`);
      lines.push(result.text.slice(0, 600)); // cap at 600 chars per section
      hasContent = true;
    }
  }

  return hasContent ? lines.join('\n') : null;
}

// ── SQLite job record helpers ─────────────────────────────────────────────────

function createJobRecord(runId, sectionDef, profileId) {
  const db    = getDb();
  const jobId = uuidv4();

  db.prepare(`
    INSERT INTO section_jobs
      (id, run_id, section_id, status, generator_profile, dependencies_json,
       attempt_count, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?, 0, datetime('now'))
  `).run(
    jobId,
    runId,
    sectionDef.id,
    profileId,
    JSON.stringify(sectionDef.dependsOn || [])
  );

  return jobId;
}

function markJobRunning(jobId) {
  getDb().prepare(`
    UPDATE section_jobs
       SET status = 'running',
           started_at = datetime('now'),
           attempt_count = attempt_count + 1
     WHERE id = ?
  `).run(jobId);
}

function markJobCompleted(jobId, metrics) {
  getDb().prepare(`
    UPDATE section_jobs
       SET status = 'completed',
           completed_at = datetime('now'),
           duration_ms = ?,
           input_chars = ?,
           output_chars = ?,
           warnings_count = ?,
           prompt_tokens = ?,
           completion_tokens = ?
     WHERE id = ?
  `).run(
    metrics.durationMs     || 0,
    metrics.inputChars     || 0,
    metrics.outputChars    || 0,
    metrics.warningsCount  || 0,
    metrics.promptTokens   || null,
    metrics.completionTokens || null,
    jobId
  );
}

function markJobFailed(jobId, errorText, durationMs) {
  getDb().prepare(`
    UPDATE section_jobs
       SET status = 'failed',
           completed_at = datetime('now'),
           duration_ms = ?,
           error_text = ?
     WHERE id = ?
  `).run(durationMs || 0, String(errorText || 'unknown error'), jobId);
}

function saveGeneratedSection(jobId, runId, caseId, sectionId, formType, text, examplesUsed) {
  const db = getDb();
  const id = uuidv4();

  // Upsert: if a section already exists for this run+section, update it
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

  db.prepare(`
    INSERT INTO generated_sections
      (id, job_id, run_id, case_id, section_id, form_type,
       draft_text, final_text, examples_used, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, jobId, runId, caseId, sectionId, formType, text, text, examplesUsed);

  return id;
}

// ── Core execution ────────────────────────────────────────────────────────────

/**
 * Execute a single section generation job.
 *
 * @param {object} params
 *   @param {string} params.runId
 *   @param {string} params.caseId
 *   @param {object} params.sectionDef    — from reportPlanner.js SECTION_PLANS
 *   @param {object} params.context       — AssignmentContext
 *   @param {object} params.retrievalPack — RetrievalPack from retrievalPackBuilder
 *   @param {object} [params.priorResults] — { [sectionId]: { text } } for synthesis sections
 *   @param {object} [params.analysisArtifacts] — { [artifactType]: data }
 *
 * @returns {Promise<SectionJobResult>}
 *   {
 *     ok: boolean,
 *     jobId: string,
 *     sectionId: string,
 *     text: string,
 *     metrics: { durationMs, inputChars, outputChars, attemptCount, examplesUsed },
 *     error?: string,
 *   }
 */
export async function runSectionJob({
  runId,
  caseId,
  sectionDef,
  context,
  retrievalPack,
  priorResults = {},
  analysisArtifacts = {},
}) {
  const profileId = sectionDef.generatorProfile || 'retrieval-guided';
  const profile   = getProfile(profileId);
  const jobId     = createJobRecord(runId, sectionDef, profileId);

  let attemptCount = 0;
  let lastError    = null;

  // Load full facts from disk (needed by buildPromptMessages)
  const facts = readJSON(path.join(CASES_DIR, caseId, 'facts.json'), {});

  // Build examples from retrieval pack
  const { voiceExamples, otherExamples } = buildExamplesFromPack(retrievalPack, sectionDef.id);

  // Build assignment meta for prompt injection
  const assignmentMeta = buildAssignmentMetaFromContext(context);

  // Build synthesis context for dependent sections
  const synthesisContext = buildSynthesisContext(sectionDef, priorResults);

  // Build analysis context for sections that need it
  const analysisContext = buildAnalysisContext(sectionDef, analysisArtifacts);

  // Attempt generation with 1 retry
  while (attemptCount <= MAX_RETRIES) {
    attemptCount++;
    const t0 = Date.now();

    if (attemptCount === 1) {
      markJobRunning(jobId);
    } else {
      // On retry: increment attempt_count in DB
      getDb().prepare(`
        UPDATE section_jobs SET attempt_count = attempt_count + 1 WHERE id = ?
      `).run(jobId);
    }

    try {
      // Build prompt messages
      const messages = buildPromptMessages({
        formType:      context.formType || '1004',
        fieldId:       sectionDef.id,
        propertyType:  context.propertyType || 'residential',
        marketType:    context.market?.marketType || 'suburban',
        marketArea:    context.market?.marketArea || context.subject?.city || '',
        facts,
        voiceExamples,
        examples:      otherExamples,
        assignmentMeta,
      });

      // Inject synthesis context for dependent sections
      if (synthesisContext) {
        messages.splice(messages.length - 1, 0, {
          role:    'system',
          content: synthesisContext,
        });
      }

      // Inject analysis context (comp analysis, HBU logic, etc.)
      if (analysisContext) {
        messages.splice(messages.length - 1, 0, {
          role:    'system',
          content: analysisContext,
        });
      }

      // Inject profile system hint
      if (profile.systemHint) {
        messages.splice(1, 0, {
          role:    'system',
          content: `GENERATION PROFILE (${profile.label}): ${profile.systemHint}`,
        });
      }

      // Measure input size
      const inputChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);

      // Call AI
      const text = await callAI(messages, {
        temperature: profile.temperature,
        timeout:     30_000, // 30s per section
      });

      const durationMs  = Date.now() - t0;
      const outputChars = text?.length || 0;
      const examplesUsed = voiceExamples.length + otherExamples.length;

      // Save to SQLite
      markJobCompleted(jobId, {
        durationMs,
        inputChars,
        outputChars,
        warningsCount: 0,
      });

      saveGeneratedSection(jobId, runId, caseId, sectionDef.id, context.formType, text, examplesUsed);

      return {
        ok:        true,
        jobId,
        sectionId: sectionDef.id,
        text:      text?.trim() || '',
        metrics: {
          durationMs,
          inputChars,
          outputChars,
          attemptCount,
          examplesUsed,
          profileId,
        },
      };

    } catch (err) {
      lastError = err;
      const durationMs = Date.now() - t0;

      if (attemptCount > MAX_RETRIES) {
        // All attempts exhausted
        markJobFailed(jobId, err.message, durationMs);
        return {
          ok:        false,
          jobId,
          sectionId: sectionDef.id,
          text:      '',
          error:     err.message,
          metrics: {
            durationMs,
            inputChars:  0,
            outputChars: 0,
            attemptCount,
            examplesUsed: 0,
            profileId,
          },
        };
      }

      // Wait briefly before retry
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // Should not reach here, but safety fallback
  markJobFailed(jobId, lastError?.message || 'unknown', 0);
  return {
    ok:        false,
    jobId,
    sectionId: sectionDef.id,
    text:      '',
    error:     lastError?.message || 'unknown',
    metrics:   { durationMs: 0, inputChars: 0, outputChars: 0, attemptCount, examplesUsed: 0, profileId },
  };
}

// ── Analysis context builder ──────────────────────────────────────────────────

/**
 * Build an analysis context block from pre-computed analysis artifacts.
 * Injected into the prompt for sections that require structured analysis.
 */
function buildAnalysisContext(sectionDef, analysisArtifacts) {
  if (!sectionDef.analysisRequired?.length || !analysisArtifacts) return null;

  const lines = [];

  for (const artifactType of sectionDef.analysisRequired) {
    const artifact = analysisArtifacts[artifactType];
    if (!artifact) continue;

    switch (artifactType) {
      case 'comp_analysis':
        if (artifact.summary) {
          lines.push('COMPARABLE SALES ANALYSIS (pre-computed):');
          lines.push(artifact.summary);
          if (artifact.adjustmentCategories?.length) {
            lines.push(`Adjustment categories: ${artifact.adjustmentCategories.join(', ')}`);
          }
          if (artifact.marketTimeAdjustmentPercent > 0) {
            lines.push(`Market time adjustment: ${artifact.marketTimeAdjustmentPercent}%`);
          }
        }
        break;

      case 'market_analysis':
        if (artifact.summary) {
          lines.push('MARKET ANALYSIS (pre-computed):');
          lines.push(artifact.summary);
        }
        break;

      case 'hbu_logic':
        if (artifact.conclusion) {
          lines.push('HIGHEST AND BEST USE ANALYSIS (pre-computed):');
          lines.push(`Legally permissible: ${artifact.legallyPermissible || '[see zoning]'}`);
          lines.push(`Physically possible: ${artifact.physicallyPossible || '[see site data]'}`);
          lines.push(`Financially feasible: ${artifact.financiallyFeasible || '[see market data]'}`);
          lines.push(`Maximally productive: ${artifact.maximallyProductive || '[see analysis]'}`);
          lines.push(`Conclusion: ${artifact.conclusion}`);
        }
        break;
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Get the current status of a section job from SQLite.
 *
 * @param {string} jobId
 * @returns {object|null}
 */
export function getSectionJobStatus(jobId) {
  return getDb().prepare(`
    SELECT id, run_id, section_id, status, attempt_count,
           started_at, completed_at, duration_ms, error_text,
           input_chars, output_chars, generator_profile
      FROM section_jobs WHERE id = ?
  `).get(jobId) || null;
}

/**
 * Get all section jobs for a run.
 *
 * @param {string} runId
 * @returns {object[]}
 */
export function getSectionJobsForRun(runId) {
  return getDb().prepare(`
    SELECT id, section_id, status, attempt_count, generator_profile,
           started_at, completed_at, duration_ms, error_text,
           input_chars, output_chars, warnings_count
      FROM section_jobs WHERE run_id = ?
      ORDER BY created_at ASC
  `).all(runId);
}

/**
 * Get the generated text for a section in a run.
 *
 * @param {string} runId
 * @param {string} sectionId
 * @returns {string|null}
 */
export function getGeneratedSectionText(runId, sectionId) {
  const row = getDb().prepare(`
    SELECT final_text FROM generated_sections
     WHERE run_id = ? AND section_id = ?
     ORDER BY created_at DESC LIMIT 1
  `).get(runId, sectionId);
  return row?.final_text || null;
}
