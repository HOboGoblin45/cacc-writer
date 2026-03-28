/**
 * server/orchestrator/sectionJobRunner.js
 * -----------------------------------------
 * Executes individual section generation jobs within a full-draft run.
 *
 * Phase 3 — Workflow Authority
 *
 * Section job lifecycle (canonical):
 *   queued | blocked → running → retrying → complete | failed | skipped
 *
 * For each section job:
 *   1. Accept pre-created jobId (from orchestrator) or create a new record
 *   2. Resolve the correct generator profile
 *   3. Build prompt messages via buildPromptMessages()
 *   4. Execute generation through callAI()
 *   5. Capture timing, attempt count, warnings, output size, retrieval source IDs
 *   6. Implement 1-retry policy on failure (status: retrying before retry)
 *   7. Update job status in SQLite via generationRepo
 *   8. Save generated section text to generated_sections
 *
 * Every section job is independently debuggable.
 * A failed section does not make the whole run impossible unless it is truly fatal.
 *
 * Performance target: ~2–4s per section (network-bound)
 */

import { getDb } from '../db/database.js';
import { callAI } from '../openaiClient.js';
import { buildPromptMessages } from '../promptBuilder.js';
import { getProfile } from '../generators/generatorProfiles.js';
import {
  JOB_STATUS,
  createSectionJob,
  markJobRunning,
  markJobRetrying,
  markJobCompleted,
  markJobFailed,
  getSectionJobsForRun,
  saveGeneratedSection,
} from '../db/repositories/generationRepo.js';
import { getCaseProjection } from '../caseRecord/caseRecordService.js';
import {
  resolveSectionPolicy,
  buildDependencySnapshot,
  scoreSectionOutput,
} from '../sectionFactory/sectionPolicyService.js';
import log  from '../logger.js';
import { normalizeOutput } from '../ai/stmNormalizer.js';
import { getOptimizedParams, recordOutcome, classifyContext } from '../ai/autoTuneClassifier.js';
import { scoreVoiceConsistency } from '../ai/voiceConsistencyScorer.js';

const MAX_RETRIES = 1; // 1 retry per section as specified

// ── Helpers ───────────────────────────────────────────────────────────────────

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
 * Also extracts source IDs for traceability.
 *
 * Phase 6 enhancement: If a Phase 6 retrieval pack is available,
 * merge its richer examples (with scored ranking) into the arrays.
 * Phase 3 pack remains the baseline; Phase 6 pack enriches it.
 *
 * @param {string} sectionId
 * @param {object} retrievalPack — Phase 3 retrieval pack
 * @param {object} [phase6Pack]  — Phase 6 retrieval pack bundle (optional)
 * @returns {{ voiceExamples, otherExamples, sourceIds, voiceHints, disallowedPhrases, compCommentary }}
 */
function buildExamplesFromPack(sectionId, retrievalPack, phase6Pack) {
  const sectionMemory = retrievalPack?.sections?.[sectionId];

  // Start with Phase 3 examples
  const voiceExamples = (sectionMemory?.examples || [])
    .filter(e => e.sourceType === 'approvedNarrative')
    .map(e => ({ text: e.text, fieldId: e.fieldId || sectionId, source: 'voice' }));

  const otherExamples = (sectionMemory?.examples || [])
    .filter(e => e.sourceType !== 'approvedNarrative')
    .map(e => ({ text: e.text, fieldId: e.fieldId || sectionId, source: e.sourceType || 'kb' }));

  const sourceIds = (sectionMemory?.examples || [])
    .map(e => e.id)
    .filter(Boolean);

  // Phase 6 enrichment
  let voiceHints = null;
  let disallowedPhrases = [];
  let compCommentary = [];

  const p6Section = phase6Pack?.packs?.[sectionId];
  if (p6Section && !p6Section.error) {
    // Merge Phase 6 narrative examples (higher quality, scored)
    const existingTexts = new Set([
      ...voiceExamples.map(e => e.text?.slice(0, 100)),
      ...otherExamples.map(e => e.text?.slice(0, 100)),
    ]);

    for (const ex of (p6Section.narrativeExamples || [])) {
      const prefix = ex.text?.slice(0, 100);
      if (prefix && !existingTexts.has(prefix)) {
        // Phase 6 approved memory examples go into voice examples
        // (they are curated/approved material)
        voiceExamples.push({
          text: ex.text,
          fieldId: sectionId,
          source: 'approved_memory',
          score: ex.score?.totalScore || 0,
          rationale: ex.rationale || null,
        });
        if (ex.id) sourceIds.push(ex.id);
        existingTexts.add(prefix);
      }
    }

    // Merge Phase 6 voice exemplars
    for (const ex of (p6Section.voiceExemplars || [])) {
      const prefix = ex.text?.slice(0, 100);
      if (prefix && !existingTexts.has(prefix)) {
        voiceExamples.push({
          text: ex.text,
          fieldId: sectionId,
          source: 'voice_exemplar',
          score: ex.score || 0,
        });
        if (ex.id) sourceIds.push(ex.id);
        existingTexts.add(prefix);
      }
    }

    // Merge Phase 6 phrase bank items into other examples
    for (const ph of (p6Section.phraseBankItems || [])) {
      otherExamples.push({
        text: ph.text,
        fieldId: sectionId,
        source: 'phrase_bank',
        score: ph.score || 0,
      });
      if (ph.id) sourceIds.push(ph.id);
    }

    // Extract voice hints and disallowed phrases
    voiceHints = p6Section.voiceHints || null;
    disallowedPhrases = p6Section.disallowedPhrases || [];
    compCommentary = p6Section.compCommentary || [];
  }

  return { voiceExamples, otherExamples, sourceIds, voiceHints, disallowedPhrases, compCommentary };
}

/**
 * Build a voice/style context block for prompt injection from Phase 6 voice hints.
 * Returns a structured text block that guides the AI on writing style.
 *
 * @param {object|null} voiceHints — resolved voice profile hints
 * @param {string[]} disallowedPhrases — phrases to avoid
 * @returns {string|null}
 */
function buildVoiceContextBlock(voiceHints, disallowedPhrases, profileHint) {
  // If no voice hints and no disallowed phrases, try to inject at least the profile hint
  if (!voiceHints && (!disallowedPhrases || disallowedPhrases.length === 0)) {
    if (profileHint) {
      return `WRITING STYLE GUIDANCE:\n- ${profileHint}`;
    }
    return null;
  }

  const lines = ['WRITING STYLE GUIDANCE (from appraiser voice profile):'];

  if (voiceHints) {
    if (voiceHints.tone) lines.push(`- Tone: ${voiceHints.tone}`);
    if (voiceHints.sentenceLength) lines.push(`- Sentence length preference: ${voiceHints.sentenceLength}`);
    if (voiceHints.hedgingDegree) lines.push(`- Hedging/certainty level: ${voiceHints.hedgingDegree}`);
    if (voiceHints.terminologyPreference) lines.push(`- Terminology: ${voiceHints.terminologyPreference}`);
    if (voiceHints.reconciliationStyle) lines.push(`- Reconciliation style: ${voiceHints.reconciliationStyle}`);

    // Preferred phrasing patterns
    if (voiceHints.preferredPatterns && voiceHints.preferredPatterns.length > 0) {
      lines.push('- Preferred phrasing patterns:');
      for (const p of voiceHints.preferredPatterns.slice(0, 5)) {
        lines.push(`  • ${p}`);
      }
    }

    // Section-specific openings/closings
    if (voiceHints.preferredOpening) lines.push(`- Preferred section opening style: ${voiceHints.preferredOpening}`);
    if (voiceHints.preferredClosing) lines.push(`- Preferred section closing style: ${voiceHints.preferredClosing}`);
  }

  if (disallowedPhrases && disallowedPhrases.length > 0) {
    lines.push('- DO NOT use these generic/disfavored phrases:');
    for (const phrase of disallowedPhrases.slice(0, 15)) {
      lines.push(`  ✗ "${phrase}"`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

/**
 * Build a comparable commentary context block for prompt injection.
 * Only relevant for sales comparison and reconciliation sections.
 *
 * @param {object[]} compCommentary — comparable commentary examples
 * @param {string} sectionId
 * @returns {string|null}
 */
function buildCompCommentaryBlock(compCommentary, sectionId) {
  if (!compCommentary || compCommentary.length === 0) return null;

  // Only inject comp commentary for sections that benefit from comparable context
  const compSections = [
    'sales_comparison_summary', 'reconciliation', 'comp_analysis',
    'market_conditions', 'sales_comparison_approach',
    'sales_comparison', 'sales_comparison_commentary',
    'sca_summary', 'cost_approach_summary', 'income_approach_summary',
  ];
  if (!compSections.includes(sectionId)) return null;

  const lines = ['COMPARABLE COMMENTARY EXAMPLES (from approved prior work):'];
  for (const cc of compCommentary.slice(0, 3)) {
    lines.push(`\n--- Example (${cc.commentaryType || 'general'}) ---`);
    if (cc.text) lines.push(cc.text.slice(0, 400) + (cc.text.length > 400 ? '...' : ''));
  }

  return lines.length > 1 ? lines.join('\n') : null;
}

/**
 * Count warning indicators in generated text.
 * Warnings are [INSERT...] placeholders that indicate the AI couldn't fill in a value.
 *
 * @param {string} text
 * @returns {number}
 */
function countWarnings(text) {
  if (!text) return 0;
  const insertMatches = (text.match(/\[INSERT/gi) || []).length;
  const todoMatches   = (text.match(/\[TODO/gi)   || []).length;
  const tktMatches    = (text.match(/\[TKT/gi)    || []).length;
  return insertMatches + todoMatches + tktMatches;
}

/**
 * Build the analysis context string from analysis artifacts for a section.
 * Injects pre-computed analysis results into the prompt.
 *
 * @param {string} sectionId
 * @param {object} analysisArtifacts
 * @returns {string|null}
 */
function buildAnalysisContext(sectionId, analysisArtifacts) {
  if (!analysisArtifacts || Object.keys(analysisArtifacts).length === 0) return null;

  const lines = [];

  for (const [artifactType, artifact] of Object.entries(analysisArtifacts)) {
    if (!artifact || artifact.error) continue;

    switch (artifactType) {
      case 'comp_analysis':
        if (
          sectionId === 'sales_comparison_summary' ||
          sectionId === 'reconciliation' ||
          sectionId === 'highest_best_use'
        ) {
          if (artifact.summary) {
            lines.push('COMPARABLE SALES ANALYSIS (pre-computed):');
            lines.push(artifact.summary);
            if (artifact.adjustmentCategories?.length > 0) {
              lines.push(`Adjustment categories: ${artifact.adjustmentCategories.join(', ')}`);
            }
            if (artifact.marketTimeAdjustmentPercent > 0) {
              lines.push(`Market time adjustment: ${artifact.marketTimeAdjustmentPercent}%`);
            }
          }
        }
        break;

      case 'market_analysis':
        if (
          sectionId === 'market_conditions' ||
          sectionId === 'neighborhood_description' ||
          sectionId === 'reconciliation'
        ) {
          if (artifact.summary) {
            lines.push('MARKET ANALYSIS (pre-computed):');
            lines.push(artifact.summary);
          }
        }
        break;

      case 'hbu_logic':
        if (
          sectionId === 'highest_best_use' ||
          sectionId === 'reconciliation'
        ) {
          if (artifact.conclusion) {
            lines.push('HIGHEST AND BEST USE ANALYSIS (pre-computed):');
            lines.push(`Legally permissible: ${artifact.legallyPermissible || '[see zoning]'}`);
            lines.push(`Physically possible: ${artifact.physicallyPossible || '[see site data]'}`);
            lines.push(`Financially feasible: ${artifact.financiallyFeasible || '[see market data]'}`);
            lines.push(`Maximally productive: ${artifact.maximallyProductive || '[see analysis]'}`);
            lines.push(`Conclusion: ${artifact.conclusion}`);
          }
        }
        break;
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Build the prior sections context string for synthesis sections.
 * Injects completed section text into the prompt for reconciliation/conclusion sections.
 *
 * @param {string} sectionId
 * @param {object} priorResults — { [sectionId]: { text, ok } }
 * @returns {string|null}
 */
function buildPriorSectionsContext(sectionId, priorResults) {
  if (!priorResults || Object.keys(priorResults).length === 0) return null;

  // Only inject prior sections for synthesis sections
  const synthesisSections = ['reconciliation', 'sales_comparison_summary', 'conclusion_remarks'];
  if (!synthesisSections.includes(sectionId)) return null;

  const lines = ['PRIOR SECTIONS (for synthesis reference):'];
  let hasContent = false;

  const sectionLabels = {
    neighborhood_description:  'Neighborhood Description',
    market_conditions:         'Market Conditions',
    site_description:          'Site Description',
    improvements_description:  'Improvements Description',
    condition_description:     'Condition Description',
    highest_best_use:          'Highest and Best Use',
    sales_comparison_summary:  'Sales Comparison Summary',
  };

  for (const [sid, result] of Object.entries(priorResults)) {
    if (result?.ok && result?.text && sid !== sectionId) {
      const label = sectionLabels[sid] || sid;
      lines.push(`\n--- ${label} ---`);
      // Truncate to 500 chars to keep prompt manageable
      lines.push(result.text.slice(0, 500) + (result.text.length > 500 ? '...' : ''));
      hasContent = true;
    }
  }

  return hasContent ? lines.join('\n') : null;
}

// ── Main section job runner ───────────────────────────────────────────────────

/**
 * Run a single section generation job.
 *
 * Accepts a pre-created jobId from the orchestrator (preferred) or creates
 * a new job record if not provided.
 *
 * @param {object} params
 *   @param {string}      params.runId
 *   @param {string}      params.caseId
 *   @param {object}      params.sectionDef        — section definition from report plan
 *   @param {object}      params.context           — AssignmentContext
 *   @param {object}      params.retrievalPack     — RetrievalPack
 *   @param {object}      [params.analysisArtifacts] — pre-computed analysis results
 *   @param {object}      [params.priorResults]    — prior section results for synthesis
 *   @param {string|null} [params.existingJobId]   — pre-created job ID from orchestrator
 *
 * @returns {Promise<SectionJobResult>}
 *   {
 *     ok: boolean,
 *     sectionId: string,
 *     text: string,
 *     metrics: { durationMs, attemptCount, inputChars, outputChars, warningsCount },
 *     error?: string,
 *   }
 */
export async function runSectionJob({
  runId,
  caseId,
  sectionDef,
  context,
  retrievalPack,
  phase6Pack        = null,
  analysisArtifacts = {},
  priorResults      = {},
  existingJobId     = null,
}) {
  const sectionId = sectionDef.id;
  const t0        = Date.now();
  const resolvedFormType = context.formType || '1004';
  const sectionPolicy = resolveSectionPolicy({
    formType: resolvedFormType,
    sectionDef,
  });
  const dependencySnapshot = buildDependencySnapshot({
    sectionPolicy,
    generatedSections: priorResults,
  });

  // ── Resolve job ID ─────────────────────────────────────────────────────────
  // Use pre-created jobId from orchestrator if provided.
  // Otherwise create a new job record (fallback for standalone calls).
  let jobId = existingJobId;

  if (!jobId) {
    jobId = createSectionJob({
      runId,
      sectionId,
      status:    JOB_STATUS.QUEUED,
      profileId: sectionDef.generatorProfile || 'retrieval-guided',
      dependsOn: sectionDef.dependsOn || [],
      promptVersion: sectionPolicy.promptVersion,
      sectionPolicy,
      dependencySnapshot,
    });
  }

  // ── Resolve generator profile ──────────────────────────────────────────────
  const profile = getProfile(sectionDef.generatorProfile || 'retrieval-guided');

  // ── Phase 3: AutoTune parameter optimization ────────────────────────────────
  const contextKey = classifyContext({ sectionId, formType: resolvedFormType, facts }).contextKey;
  const optimized = getOptimizedParams(sectionId, resolvedFormType, facts, profile);
  const effectiveTemp = optimized.temperature;
  const effectiveMaxTokens = optimized.maxTokens;

  // ── Build examples from retrieval pack (Phase 3 + Phase 6 enrichment) ────
  const { voiceExamples, otherExamples, sourceIds, voiceHints, disallowedPhrases, compCommentary } =
    buildExamplesFromPack(sectionId, retrievalPack, phase6Pack);

  // ── Build analysis context ─────────────────────────────────────────────────
  const analysisContext = buildAnalysisContext(sectionId, analysisArtifacts);

  // ── Build prior sections context (for synthesis sections) ─────────────────
  const priorSectionsContext = buildPriorSectionsContext(sectionId, priorResults);

  // ── Load case facts ────────────────────────────────────────────────────────
  const projection = getCaseProjection(caseId);
  const facts = projection?.facts || {};

  // ── Build pipeline data context (crawled data from Cloudflare pipeline) ───
  let pipelineDataContext = null;
  try {
    const { buildPipelineContext } = await import('../dataPipeline/pipelineContextBuilder.js');
    pipelineDataContext = buildPipelineContext(caseId, sectionDef.id);
  } catch {
    // Pipeline module not available or no crawled data — non-fatal
  }

  // ── Build assignment meta ──────────────────────────────────────────────────
  const assignmentMeta = buildAssignmentMetaFromContext(context);

  // ── Build Phase 6 voice/style context blocks ──────────────────────────────
  const voiceContextBlock = buildVoiceContextBlock(voiceHints, disallowedPhrases, profile.systemHint);
  const compCommentaryBlock = buildCompCommentaryBlock(compCommentary, sectionId);

  // ── Memory injection audit ──────────────────────────────────────────────
  const memoryInjectionTrace = {
    voiceExampleCount: voiceExamples.length,
    otherExampleCount: otherExamples.length,
    sourceIdCount: sourceIds.length,
    voiceHintsAvailable: Boolean(voiceHints),
    disallowedPhrasesCount: disallowedPhrases.length,
    compCommentaryCount: compCommentary.length,
    voiceContextInjected: Boolean(voiceContextBlock),
    compCommentaryInjected: Boolean(compCommentaryBlock),
    analysisContextInjected: Boolean(analysisContext),
    priorSectionsInjected: Boolean(priorSectionsContext),
    phase6Available: Boolean(phase6Pack?.packs?.[sectionId]),
    droppedBlocks: [],
  };
  if (voiceHints && !voiceContextBlock) memoryInjectionTrace.droppedBlocks.push('voiceContext');
  if (compCommentary.length > 0 && !compCommentaryBlock) memoryInjectionTrace.droppedBlocks.push('compCommentary_section_gated');
  if (phase6Pack && !phase6Pack.packs?.[sectionId]) memoryInjectionTrace.droppedBlocks.push('phase6_section_missing');

  // ── Build prompt messages ──────────────────────────────────────────────────
  const promptMessages = buildPromptMessages({
    fieldId:        sectionId,
    formType:       resolvedFormType,
    facts,
    voiceExamples,
    examples:       otherExamples,
    assignmentMeta,
    systemHint:     profile.systemHint,
    extraContext:   [analysisContext, priorSectionsContext, voiceContextBlock, compCommentaryBlock, pipelineDataContext]
                      .filter(Boolean).join('\n\n') || null,
  });

  const inputChars = JSON.stringify(promptMessages).length;
  const analysisContextUsed = Boolean(analysisContext);
  const priorSectionsContextUsed = Boolean(priorSectionsContext);

  // ── Execute with retry ─────────────────────────────────────────────────────
  let attemptCount = 0;
  let lastError    = null;
  let outputText   = '';

  while (attemptCount <= MAX_RETRIES) {
    attemptCount++;

    if (attemptCount === 1) {
      // First attempt: transition from queued/blocked → running
      markJobRunning(jobId);
    } else {
      // Retry: transition to retrying status before retry attempt
      markJobRetrying(jobId);
    }

    try {
      outputText = await callAI(promptMessages, {
        temperature: effectiveTemp,
        maxTokens:   effectiveMaxTokens,
      });

      if (!outputText || outputText.trim().length === 0) {
        throw new Error('AI returned empty output');
      }

      // ── Phase 3: STM Output Normalization ─────────────────────────────────
      const stmResult = await normalizeOutput(outputText, {
        sectionId,
        formType: resolvedFormType,
        maxChars: sectionDef.maxChars || null,
        enableLlmPass: profile.id === 'synthesis' || profile.id === 'analysis',
        userId: context.userId,
      });
      outputText = stmResult.text;

      // ── Phase 3: Voice Consistency Scoring ────────────────────────────────
      let voiceResult = null;
      try {
        voiceResult = await scoreVoiceConsistency(outputText, context.userId, resolvedFormType);
      } catch (voiceErr) {
        log.warn('sectionJobRunner:voiceScoring', { error: voiceErr.message, sectionId });
      }

      // ── Success ────────────────────────────────────────────────────────────
      const durationMs    = Date.now() - t0;
      const outputChars   = outputText.length;
      const warningsCount = countWarnings(outputText);
      const quality = scoreSectionOutput({
        sectionPolicy,
        text: outputText,
        warningsCount,
        dependencySnapshot,
        analysisContextUsed,
        priorSectionsContextUsed,
        retrievalSourceIds: sourceIds,
        voiceScore: voiceResult?.score ?? null,
      });

      // ── Phase 3: Record AutoTune outcome ──────────────────────────────────
      try {
        recordOutcome(contextKey, {
          qualityScore: quality.score,
          tokensUsed: outputText.length,
          wasApproved: quality.score >= 0.7,
          sectionId,
        });
      } catch (autoTuneErr) {
        log.warn('sectionJobRunner:autoTuneRecord', { error: autoTuneErr.message, sectionId });
      }

      markJobCompleted(jobId, {
        durationMs,
        inputChars,
        outputChars,
        warningsCount,
        promptTokens:       null, // not available from current callAI signature
        completionTokens:   null,
        retrievalSourceIds: sourceIds,
        dependencySnapshot,
      });

      // Save generated section text
      saveGeneratedSection({
        jobId,
        runId,
        caseId,
        sectionId,
        formType:     resolvedFormType,
        text:         outputText,
        examplesUsed: voiceExamples.length + otherExamples.length,
        auditMetadata: {
          sectionId,
          generatorProfile: profile.id,
          promptVersion: sectionPolicy.promptVersion,
          retrievalSourceIds: sourceIds,
          dependencySnapshot,
          contextBlocksUsed: {
            analysisContext: analysisContextUsed,
            priorSectionsContext: priorSectionsContextUsed,
            voiceContext: Boolean(voiceContextBlock),
            compCommentaryContext: Boolean(compCommentaryBlock),
          },
          memoryInjectionTrace,
          stmMetrics: stmResult?.metrics || null,
          voiceScore: voiceResult?.score ?? null,
          voiceVerdict: voiceResult?.details?.verdict ?? null,
          autoTuneContextKey: contextKey,
          effectiveTemperature: effectiveTemp,
          effectiveMaxTokens: effectiveMaxTokens,
        },
        qualityScore: quality.score,
        qualityMetadata: quality.metadata,
      });

      return {
        ok:        true,
        sectionId,
        text:      outputText,
        promptVersion: sectionPolicy.promptVersion,
        sectionPolicy,
        qualityScore: quality.score,
        auditMetadata: {
          sectionId,
          generatorProfile: profile.id,
          promptVersion: sectionPolicy.promptVersion,
          retrievalSourceIds: sourceIds,
          dependencySnapshot,
          stmMetrics: stmResult?.metrics || null,
          voiceScore: voiceResult?.score ?? null,
          voiceVerdict: voiceResult?.details?.verdict ?? null,
          autoTuneContextKey: contextKey,
          effectiveTemperature: effectiveTemp,
          effectiveMaxTokens: effectiveMaxTokens,
        },
        metrics: {
          durationMs,
          attemptCount,
          inputChars,
          outputChars,
          warningsCount,
          retrievalSourceIds: sourceIds,
          dependencySnapshot,
          promptVersion: sectionPolicy.promptVersion,
          qualityScore: quality.score,
        },
      };

    } catch (err) {
      lastError = err;

      log.error('sectionJobRunner:attempt-failed', {
        sectionId, attempt: attemptCount, error: err.message,
      });

      if (attemptCount > MAX_RETRIES) {
        // All attempts exhausted
        break;
      }

      // Brief pause before retry
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // ── All attempts failed ────────────────────────────────────────────────────
  const durationMs = Date.now() - t0;
  const errorText  = lastError?.message || 'unknown error';

  markJobFailed(jobId, errorText, durationMs);

  return {
    ok:        false,
    sectionId,
    text:      '',
    error:     errorText,
    promptVersion: sectionPolicy.promptVersion,
    sectionPolicy,
    metrics: {
      durationMs,
      attemptCount,
      inputChars,
      outputChars:   0,
      warningsCount: 0,
      dependencySnapshot,
      promptVersion: sectionPolicy.promptVersion,
    },
  };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

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
           input_chars, output_chars, generator_profile, prompt_version
      FROM section_jobs WHERE id = ?
  `).get(jobId) || null;
}

/**
 * Get all section jobs for a run.
 *
 * @param {string} runId
 * @returns {object[]}
 */
export { getSectionJobsForRun };

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


