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
import { callAI } from '../openaiClient.js';
import { getRelevantExamplesWithVoice } from '../retrieval.js';
import { buildPromptMessages, buildReviewMessages } from '../promptBuilder.js';
import { getNeighborhoodBoundaryFeatures, formatLocationContextBlock, LOCATION_CONTEXT_FIELDS } from '../neighborhoodContext.js';
import { applyMetaDefaults, buildAssignmentMetaBlock } from '../caseMetadata.js';
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
    log.warn('[generationService] parseReviewResponse failed:', err.message);
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
      log.warn('[generationService] location context unavailable:', e.message);
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
 * @returns {{ text: string, examplesUsed: number }}
 */
export async function generateSection({
  formType,
  fieldId,
  facts,
  assignmentMeta = null,
  locationContext = null,
  twoPass = false,
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
  });

  let text = await callAI(messages);

  if (twoPass && text) {
    try {
      const rm = buildReviewMessages({ draftText: text, facts, fieldId, formType });
      const rr = await callAI(rm);
      const rv = parseReviewResponse(rr);
      if (rv?.revisedText) text = rv.revisedText;
    } catch (e) {
      log.warn('[generationService] two-pass review parse failed for', fieldId, ':', e.message);
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
  let qi = 0;

  async function processField() {
    while (qi < fields.length) {
      const f = fields[qi++];
      const sid = trimText(f?.id || f, 80) || ('field_' + Math.random().toString(36).slice(2, 8));
      try {
        const { text, examplesUsed } = await generateSection({
          formType,
          fieldId: sid,
          facts,
          assignmentMeta,
          locationContext,
          twoPass,
        });
        results[sid] = {
          title: trimText(f?.title, 160) || sid,
          text,
          examplesUsed,
        };
      } catch (e) {
        errors[sid] = e?.message || 'Unknown error';
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, fields.length) }, processField)
  );

  return { results, errors };
}
