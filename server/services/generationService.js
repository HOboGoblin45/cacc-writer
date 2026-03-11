/**
 * server/services/generationService.js
 * --------------------------------------
 * Unified generation service — single source of truth for the
 * "retrieve examples → build prompt → call AI → optional two-pass review"
 * pipeline that was previously duplicated across 6 endpoints.
 *
 * All generation endpoints should call these functions instead of
 * inlining the pipeline logic.
 */

import fs from 'fs';
import path from 'path';

import { resolveCaseDir, normalizeFormType, getCaseFormConfig } from '../utils/caseUtils.js';
import { readJSON } from '../utils/fileUtils.js';
import { trimText } from '../utils/textUtils.js';
import { callAI, estimateTokens, getContextWindowLimit } from '../openaiClient.js';
import { getRelevantExamplesWithVoice } from '../retrieval.js';
import { buildPromptMessages, buildReviewMessages } from '../promptBuilder.js';
import { getNeighborhoodBoundaryFeatures, formatLocationContextBlock, LOCATION_CONTEXT_FIELDS } from '../neighborhoodContext.js';
import { applyMetaDefaults, buildAssignmentMetaBlock } from '../caseMetadata.js';
import { getSectionDef } from '../context/reportPlanner.js';
import log from '../logger.js';

// ── Review response parsing ──────────────────────────────────────────────────

/**
 * parseReviewResponse(raw)
 * Parses a two-pass review response from the AI, stripping markdown fences.
 * Replaces the duplicated regex: rr.trim().replace(/^`json\n?/,'').replace(/\n?`$/,'')
 *
 * @param {string} raw — raw AI review response
 * @returns {{ revisedText?: string, issues?: any[], score?: number, changesMade?: boolean }}
 */
export function parseReviewResponse(raw) {
  const cleaned = raw.trim()
    .replace(/^```json\n?/, '')
    .replace(/\n?```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    log.warn('generation:parse-review-failed', { error: err.message });
    return {};
  }
}

// ── Case context loading ─────────────────────────────────────────────────────

/**
 * loadCaseContext(caseId)
 * Loads all context needed for generation from a case directory.
 * Centralizes the repeated pattern of reading facts, meta, geocode, and
 * building assignment meta + location context.
 *
 * @param {string} caseId
 * @returns {{ caseDir, formType, formConfig, facts, assignmentMeta, locationContext }}
 */
export async function loadCaseContext(caseId) {
  const caseDir = resolveCaseDir(caseId);
  if (!caseDir || !fs.existsSync(caseDir)) {
    return null;
  }

  const facts = readJSON(path.join(caseDir, 'facts.json'), {});
  const rawMeta = readJSON(path.join(caseDir, 'meta.json'), {});
  const { formType, formConfig } = getCaseFormConfig(caseDir);
  const assignmentMeta = buildAssignmentMetaBlock(applyMetaDefaults(rawMeta));

  // Load location context from geocode data
  let locationContext = null;
  const geo = readJSON(path.join(caseDir, 'geocode.json'), null);
  if (geo?.subject?.result?.lat) {
    try {
      const { lat, lng } = geo.subject.result;
      const bf = await getNeighborhoodBoundaryFeatures(lat, lng, 1.5);
      locationContext = formatLocationContextBlock({
        subject: geo.subject,
        comps: geo.comps || [],
        boundaryFeatures: bf,
      });
    } catch (e) {
      log.warn('generation:location-context-unavailable', { error: e.message });
    }
  }

  return { caseDir, formType, formConfig, facts, assignmentMeta, locationContext };
}

// ── Single section generation ────────────────────────────────────────────────

/**
 * generateSection(options)
 * Generates text for a single field/section.
 * This is the core pipeline that replaces the duplicated logic.
 *
 * @param {object} options
 * @param {string} options.formType     — normalized form type
 * @param {string} options.fieldId      — field/section ID
 * @param {object} options.facts        — case facts object
 * @param {string|null} options.assignmentMeta — assignment metadata block
 * @param {string|null} options.locationContext — location context block (only injected for location-sensitive fields)
 * @param {boolean} [options.twoPass=false] — whether to run two-pass review
 * @param {string|null} [options.extraContext=null] — prior section outputs for synthesis sections
 * @returns {{ text: string, examplesUsed: number }}
 */
export async function generateSection({
  formType,
  fieldId,
  facts,
  assignmentMeta = null,
  locationContext = null,
  twoPass = false,
  extraContext = null,
}) {
  const { voiceExamples, otherExamples } = getRelevantExamplesWithVoice({
    formType,
    fieldId,
  });

  const messages = buildPromptMessages({
    formType,
    fieldId,
    facts,
    voiceExamples,
    examples: otherExamples,
    locationContext: LOCATION_CONTEXT_FIELDS.has(fieldId) ? locationContext : null,
    assignmentMeta,
    extraContext,
  });

  // Guard: warn if prompt is approaching context window limit
  const estTokens = estimateTokens(messages);
  const windowLimit = getContextWindowLimit();
  const safeLimit = Math.floor(windowLimit * 0.85); // leave 15% for output
  if (estTokens > safeLimit) {
    log.warn('generation:context-window-warning', {
      fieldId, estimatedTokens: estTokens, windowLimit, safeLimit,
    });
    // Trim examples to fit — remove lowest-priority examples first
    while (messages.length > 4 && estimateTokens(messages) > safeLimit) {
      // Find and remove the last examples block (Block 3b — lowest priority)
      const exIdx = messages.findLastIndex(m =>
        m.role === 'system' && (m.content || '').startsWith('SUPPLEMENTAL EXAMPLES')
      );
      if (exIdx > -1) {
        messages.splice(exIdx, 1);
        continue;
      }
      // Then try removing phrase bank entries
      const phIdx = messages.findLastIndex(m =>
        m.role === 'system' && (m.content || '').startsWith('APPROVED PHRASES')
      );
      if (phIdx > -1) {
        messages.splice(phIdx, 1);
        continue;
      }
      break; // don't remove system prompts, facts, or user request
    }
  }

  let text = await callAI(messages);

  if (twoPass && text) {
    try {
      const rm = buildReviewMessages({
        draftText: text, facts, fieldId, formType, assignmentMeta, locationContext,
      });
      const rr = await callAI(rm);
      const rv = parseReviewResponse(rr);
      if (rv?.revisedText) text = rv.revisedText;
    } catch (e) {
      log.warn('generation:two-pass-review-failed', { fieldId, error: e.message });
    }
  }

  return {
    text,
    examplesUsed: voiceExamples.length + otherExamples.length,
  };
}

// ── Concurrent multi-section generation ──────────────────────────────────────

/**
 * generateSections(options)
 * Generates text for multiple fields concurrently (max 3 parallel).
 * Replaces the duplicated concurrent generation pattern across endpoints.
 *
 * @param {object} options
 * @param {Array<{id: string, title?: string}>} options.fields — fields to generate
 * @param {string} options.formType — normalized form type
 * @param {object} options.facts — case facts object
 * @param {string|null} options.assignmentMeta — assignment metadata block
 * @param {string|null} options.locationContext — location context block
 * @param {boolean} [options.twoPass=false] — whether to run two-pass review
 * @param {number} [options.concurrency=3] — max concurrent generations
 * @returns {{ results: object, errors: object }}
 */
export async function generateSections({
  fields,
  formType,
  facts,
  assignmentMeta = null,
  locationContext = null,
  twoPass = false,
  concurrency = 3,
}) {
  const results = {};
  const errors = {};

  // Separate parallel (no dependencies) from dependent sections
  const parallel = [];
  const dependent = [];

  for (const f of fields) {
    const fid = trimText(f?.id || f, 80) || ('field_' + Math.random().toString(36).slice(2, 8));
    const def = getSectionDef(formType, fid);
    if (def?.dependsOn?.length > 0) {
      dependent.push({ field: f, id: fid, dependsOn: def.dependsOn });
    } else {
      parallel.push({ field: f, id: fid });
    }
  }

  // Phase 1: Generate parallel sections concurrently
  let qi = 0;
  async function processParallel() {
    while (qi < parallel.length) {
      const { field: f, id: sid } = parallel[qi++];
      try {
        const { text, examplesUsed } = await generateSection({
          formType, fieldId: sid, facts, assignmentMeta, locationContext, twoPass,
        });
        results[sid] = { title: trimText(f?.title, 160) || sid, text, examplesUsed };
      } catch (e) {
        errors[sid] = e?.message || 'Unknown error';
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, parallel.length) }, processParallel)
  );

  // Phase 2: Generate dependent sections with prior section context
  for (const { field: f, id: sid, dependsOn } of dependent) {
    try {
      // Build extraContext from completed dependency outputs
      const priorSections = dependsOn
        .filter(depId => results[depId]?.text)
        .map(depId => `[${results[depId].title || depId}]\n${results[depId].text}`)
        .join('\n\n');

      const extraContext = priorSections
        ? `PRIOR SECTION OUTPUTS (reference these for consistency — do not contradict):\n\n${priorSections}`
        : null;

      if (extraContext) {
        log.info('generation:cross-section-context', {
          fieldId: sid,
          dependsOn,
          priorSectionsAvailable: dependsOn.filter(d => results[d]?.text).length,
        });
      }

      const { text, examplesUsed } = await generateSection({
        formType, fieldId: sid, facts, assignmentMeta, locationContext, twoPass, extraContext,
      });
      results[sid] = { title: trimText(f?.title, 160) || sid, text, examplesUsed };
    } catch (e) {
      errors[sid] = e?.message || 'Unknown error';
    }
  }

  return { results, errors };
}
