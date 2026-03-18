/**
 * server/api/generationRoutes.js
 * --------------------------------
 * Express Router for orchestrator + DB endpoints.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Extracted routes (new architecture path):
 *   POST  /cases/:caseId/generate-full-draft   — trigger full-draft orchestrator (primary)
 *   POST  /generation/full-draft               — alias for above (caseId in body)
 *   GET   /generation/runs/:runId/status        — poll run status
 *   GET   /generation/runs/:runId/result        — get final result
 *   POST  /generation/regenerate-section        — regenerate one section
 *   POST  /db/migrate-legacy-kb                 — import flat-file KB to SQLite
 *   GET   /db/status                            — SQLite health + table counts
 *
 * Note: GET /cases/:caseId/generation-runs is handled in casesRoutes.js
 */

import { Router } from 'express';
import path from 'path';
import { z } from 'zod';

// ── Shared utilities ──────────────────────────────────────────────────────────
import { resolveCaseDir, normalizeFormType } from '../utils/caseUtils.js';
import { readJSON } from '../utils/fileUtils.js';
import { trimText, asArray, aiText } from '../utils/textUtils.js';
import { ensureAI } from '../utils/middleware.js';

// ── Domain modules ────────────────────────────────────────────────────────────
import { DEFAULT_FORM_TYPE, getFormConfig } from '../../forms/index.js';
import { ACTIVE_FORMS, isDeferredForm, logDeferredAccess } from '../config/productionScope.js';
import { CORE_SECTIONS } from '../config/coreSections.js';
import { callAI, client, MODEL } from '../openaiClient.js';
import { getRelevantExamplesWithVoice } from '../retrieval.js';
import { buildPromptMessages, buildReviewMessages } from '../promptBuilder.js';
import { applyMetaDefaults, buildAssignmentMetaBlock } from '../caseMetadata.js';
import { getNeighborhoodBoundaryFeatures, formatLocationContextBlock, LOCATION_CONTEXT_FIELDS } from '../neighborhoodContext.js';
import { genInput, collectExamples } from '../services/legacyGenerationService.js';
import {
  runFullDraftOrchestrator,
  getRunStatus,
  getRunResult,
  getGeneratedSectionsForRun,
} from '../orchestrator/generationOrchestrator.js';
import { RUN_STATUS } from '../db/repositories/generationRepo.js';
import {
  runSectionJob,
} from '../orchestrator/sectionJobRunner.js';
import {
  getRunById,
  getJobIdForSection,
  saveGeneratedSection,
  updateGeneratedSectionReview,
} from '../db/repositories/generationRepo.js';
import { buildAssignmentContext } from '../context/assignmentContextBuilder.js';
import { buildReportPlan, getSectionDef } from '../context/reportPlanner.js';
import { buildRetrievalPack } from '../context/retrievalPackBuilder.js';
import { runLegacyKbImport, getMemoryItemStats } from '../migration/legacyKbImport.js';
import { getDb, getDbPath, getDbSizeBytes, getTableCounts } from '../db/database.js';
import { getCaseProjection, saveCaseProjection } from '../caseRecord/caseRecordService.js';
import { evaluatePreDraftGate } from '../factIntegrity/preDraftGate.js';
import { buildFactDecisionQueue } from '../factIntegrity/factDecisionQueue.js';
import log from '../logger.js';

// ── In-memory run result store (LRU-bounded) ─────────────────────────────────
// Stores the full draftPackage result keyed by runId.
// Run status is always read from SQLite; this stores the full result object
// for fast retrieval without re-querying all section rows.
// Capped at 100 entries to prevent unbounded memory growth.
const _MAX_RUN_RESULTS = 100;
const _runResults = new Map();
const MAX_BATCH_FIELDS = 20;

function _setRunResult(runId, result) {
  // Evict oldest entry if at capacity (Map preserves insertion order)
  if (_runResults.size >= _MAX_RUN_RESULTS) {
    const oldestKey = _runResults.keys().next().value;
    _runResults.delete(oldestKey);
  }
  _runResults.set(runId, result);
}

function toSectionIds(fields) {
  if (!Array.isArray(fields)) return [];
  const ids = [];
  for (const field of fields) {
    const id = trimText(field?.id || field, 80);
    if (!id) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

const GATE_BYPASS_ALLOWED = process.env.CACC_ALLOW_FORCE_GATE_BYPASS !== '0';

function shouldBypassPreDraftGate(req) {
  return Boolean(req.body?.forceGateBypass || req.body?.options?.forceGateBypass);
}

/**
 * Enforce the pre-draft gate. Returns true if generation can proceed.
 * Sends error response and returns false if blocked.
 * Accepts optional `caseIdForQueue` for building the decision queue path.
 */
function enforcePreDraftGate(req, res, { caseId, formType, sectionIds = null }) {
  // Check if forceGateBypass is requested
  if (shouldBypassPreDraftGate(req)) {
    if (!GATE_BYPASS_ALLOWED) {
      res.status(403).json({
        ok: false,
        code: 'PRE_DRAFT_GATE_BYPASS_DISABLED',
        error: 'Force gate bypass is disabled in this environment.',
      });
      return false;
    }
    return true;
  }

  const gate = evaluatePreDraftGate({ caseId, formType, sectionIds });
  if (!gate) {
    res.status(404).json({ ok: false, error: 'Case not found' });
    return false;
  }

  if (gate.ok) return true;

  let factReviewQueuePath = null;
  let factReviewQueueSummary = null;
  try {
    factReviewQueuePath = `/api/cases/${caseId}/fact-review-queue`;
    const decisionQueue = buildFactDecisionQueue(caseId);
    factReviewQueueSummary = decisionQueue?.summary || null;
  } catch {
    // non-fatal
  }

  res.status(409).json({
    ok: false,
    code: 'PRE_DRAFT_GATE_BLOCKED',
    error: 'Pre-draft integrity gate blocked generation',
    gate,
    factReviewQueuePath,
    factReviewQueueSummary,
    hint: 'Resolve blocker items from GET /api/cases/:caseId/pre-draft-check, or pass forceGateBypass=true.',
  });
  return false;
}

function loadCaseRuntime(caseId) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;

  const formType = normalizeFormType(projection.meta?.formType);
  const caseDir = resolveCaseDir(caseId);

  return {
    projection,
    caseId,
    caseDir,
    formType,
    formConfig: getFormConfig(formType),
    facts: projection.facts || {},
    assignmentMeta: buildAssignmentMetaBlock(applyMetaDefaults(projection.meta || {})),
  };
}

function persistGeneratedOutputs({
  caseId,
  projection,
  results = {},
  statuses = null,
  trackHistory = false,
}) {
  if (!projection || !Object.keys(results || {}).length) return projection;

  const now = new Date().toISOString();
  const nextOutputs = { ...(projection.outputs || {}) };
  const nextHistory = { ...(projection.history || {}) };

  for (const [sectionId, value] of Object.entries(results || {})) {
    const previous = nextOutputs[sectionId];
    if (trackHistory && previous?.text) {
      const prior = Array.isArray(nextHistory[sectionId]) ? [...nextHistory[sectionId]] : [];
      prior.unshift({
        text: previous.text,
        title: previous.title || sectionId,
        savedAt: now,
      });
      nextHistory[sectionId] = prior.slice(0, 3);
    }

    const sectionStatus = statuses?.[sectionId];
    nextOutputs[sectionId] = sectionStatus
      ? { ...(value || {}), sectionStatus }
      : { ...(value || {}) };
  }
  nextOutputs.updatedAt = now;

  const nextMeta = {
    ...(projection.meta || {}),
    updatedAt: now,
    pipelineStage: 'generating',
  };

  return saveCaseProjection({
    caseId,
    meta: nextMeta,
    facts: projection.facts || {},
    provenance: projection.provenance || {},
    outputs: nextOutputs,
    history: nextHistory,
    docText: projection.docText || {},
  });
}

// ── Router ────────────────────────────────────────────────────────────────────
const router = Router();

/**
 * router.param('caseId')
 * Validates caseId format and attaches req.caseDir for /:caseId routes.
 */
router.param('caseId', (req, res, next, caseId) => {
  const cd = resolveCaseDir(caseId);
  if (!cd) return res.status(400).json({ ok: false, error: 'Invalid caseId format' });
  req.caseDir = cd;
  next();
});

// ── POST /generate (legacy compat, now modular) ──────────────────────────────
router.post('/generate', ensureAI, async (req, res) => {
  try {
    const { fieldId, formType, caseId, facts: bodyFacts } = req.body;
    const prompt = trimText(req.body?.prompt, 24000);
    const requestedFt = String(formType || '').trim().toLowerCase();
    if (requestedFt && isDeferredForm(requestedFt)) {
      logDeferredAccess(requestedFt, 'POST /api/generate', log);
      return res.status(400).json({
        ok: false,
        supported: false,
        formType: requestedFt,
        scope: 'deferred',
        message: `Generation is not available for form type "${requestedFt}". Active forms: ${ACTIVE_FORMS.join(', ')}.`,
      });
    }
    if (fieldId) {
      let caseFacts = bodyFacts || {};
      let locationContext = null;
      let assignmentMeta = null;
      let runtime = null;
      if (caseId && !bodyFacts) {
        runtime = loadCaseRuntime(caseId);
        if (!runtime) return res.status(404).json({ ok: false, error: 'Case not found' });
        caseFacts = runtime.facts;
        assignmentMeta = runtime.assignmentMeta;
        if (LOCATION_CONTEXT_FIELDS.has(fieldId) && runtime.caseDir) {
          const geo = readJSON(path.join(runtime.caseDir, 'geocode.json'), null);
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
              log.warn('[generate] location context unavailable:', e.message);
            }
          }
        }
      }
      const ft = normalizeFormType(formType);
      if (!assignmentMeta && runtime?.assignmentMeta) assignmentMeta = runtime.assignmentMeta;
      if (caseId && !enforcePreDraftGate(req, res, {
        caseId,
        formType: ft,
        sectionIds: [fieldId],
      })) return;
      const { voiceExamples, otherExamples } = getRelevantExamplesWithVoice({ formType: ft, fieldId });
      const messages = buildPromptMessages({
        formType: ft,
        fieldId,
        facts: caseFacts,
        voiceExamples,
        examples: otherExamples,
        locationContext,
        assignmentMeta,
      });
      const text = await callAI(messages);
      return res.json({
        ok: true,
        result: text,
        fieldId,
        formType: ft,
        examplesUsed: voiceExamples.length + otherExamples.length,
        locationContextInjected: Boolean(locationContext),
      });
    }
    if (!prompt) return res.status(400).json({ ok: false, error: 'prompt or fieldId is required' });
    const r = await client.responses.create({ model: MODEL, input: genInput(prompt) });
    res.json({ ok: true, result: aiText(r) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /generate-batch (legacy compat, now modular) ────────────────────────
router.post('/generate-batch', ensureAI, async (req, res) => {
  try {
    const { fields, caseId, twoPass = false } = req.body;
    if (!Array.isArray(fields) || !fields.length) {
      return res.status(400).json({ ok: false, error: 'fields must be a non-empty array' });
    }
    if (fields.length > MAX_BATCH_FIELDS) {
      return res.status(400).json({ ok: false, error: 'fields must be <= ' + MAX_BATCH_FIELDS });
    }
    const requestedSectionIds = toSectionIds(fields);

    let caseFacts = {};
    let caseRuntime = null;
    let caseFormType = DEFAULT_FORM_TYPE;
    let batchLocationContext = null;
    let batchAssignmentMeta = null;

    if (caseId) {
      caseRuntime = loadCaseRuntime(caseId);
      if (!caseRuntime) return res.status(404).json({ ok: false, error: 'Case not found' });
      caseFacts = caseRuntime.facts;
      caseFormType = caseRuntime.formType;
      batchAssignmentMeta = caseRuntime.assignmentMeta;
      if (isDeferredForm(caseFormType)) {
        logDeferredAccess(caseFormType, 'POST /api/generate-batch', log);
        return res.status(400).json({
          ok: false,
          supported: false,
          formType: caseFormType,
          scope: 'deferred',
          message: `Batch generation is not available for form type "${caseFormType}". Active forms: ${ACTIVE_FORMS.join(', ')}.`,
        });
      }
      if (!enforcePreDraftGate(req, res, {
        caseId,
        formType: caseFormType,
        sectionIds: requestedSectionIds.length ? requestedSectionIds : null,
      })) return;
      if (fields.some(f => LOCATION_CONTEXT_FIELDS.has(f?.id))) {
        const geo = caseRuntime.caseDir ? readJSON(path.join(caseRuntime.caseDir, 'geocode.json'), null) : null;
        if (geo?.subject?.result?.lat) {
          try {
            const { lat, lng } = geo.subject.result;
            const bf = await getNeighborhoodBoundaryFeatures(lat, lng, 1.5);
            batchLocationContext = formatLocationContextBlock({
              subject: geo.subject,
              comps: geo.comps || [],
              boundaryFeatures: bf,
            });
          } catch (e) {
            log.warn('[generate-batch] location context unavailable:', e.message);
          }
        }
      }
    }

    const results = {};
    const errors = {};
    const CONCURRENCY = 3;
    let qi = 0;
    async function processField() {
      while (qi < fields.length) {
        const f = fields[qi++];
        const sid = trimText(f?.id, 80) || ('field_' + Math.random().toString(36).slice(2, 8));
        try {
          const { voiceExamples, otherExamples } = getRelevantExamplesWithVoice({ formType: caseFormType, fieldId: sid });
          const messages = buildPromptMessages({
            formType: caseFormType,
            fieldId: sid,
            facts: caseFacts,
            voiceExamples,
            examples: otherExamples,
            locationContext: LOCATION_CONTEXT_FIELDS.has(sid) ? batchLocationContext : null,
            assignmentMeta: batchAssignmentMeta,
          });
          let text = await callAI(messages);
          if (twoPass && text) {
            try {
              const rm = buildReviewMessages({ draftText: text, facts: caseFacts, fieldId: sid, formType: caseFormType });
              const rr = await callAI(rm);
              const rv = JSON.parse(rr.trim().replace(/^```json\n?/, '').replace(/\n?```$/, ''));
              if (rv?.revisedText) text = rv.revisedText;
            } catch {
              // non-fatal
            }
          }
          results[sid] = {
            title: trimText(f?.title, 160) || sid,
            text,
            examplesUsed: voiceExamples.length + otherExamples.length,
          };
        } catch (e) {
          errors[sid] = e?.message || 'Unknown error';
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fields.length) }, processField));

    if (caseRuntime) {
      persistGeneratedOutputs({
        caseId,
        projection: caseRuntime.projection,
        results,
        trackHistory: true,
      });
    }
    res.json({ ok: true, results, errors });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Batch generation failed' });
  }
});

// ── POST /similar-examples (legacy compat, now modular) ──────────────────────
const similarExamplesSchema = z.object({
  fieldId: z.string().max(80).optional().nullable(),
  formType: z.string().max(40).optional().nullable(),
  limit: z.number().int().min(1).max(10).optional(),
}).passthrough();

router.post('/similar-examples', (req, res) => {
  const body = parseGenPayload(similarExamplesSchema, req.body || {}, res);
  if (!body) return;

  try {
    const { fieldId, limit = 3, formType } = body;
    const safeLimit = Math.max(1, Math.min(Number(limit) || 3, 10));
    const normalized = formType ? normalizeFormType(formType) : null;
    res.json({
      ok: true,
      examples: collectExamples(trimText(fieldId, 80) || null, safeLimit, normalized),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const generateCoreSchema = z.object({
  fields: z.array(z.string().max(80)).max(200).optional(),
  forceGateBypass: z.boolean().optional(),
  options: z.record(z.unknown()).optional(),
}).passthrough();

const generateCompCommentarySchema = z.object({
  comps: z.array(z.unknown()).max(100).optional(),
  compFocus: z.string().max(40).optional(),
  forceGateBypass: z.boolean().optional(),
}).passthrough();

const generateAllSchema = z.object({
  forceGateBypass: z.boolean().optional(),
  options: z.record(z.unknown()).optional(),
}).passthrough();

router.post('/cases/:caseId/generate-core', ensureAI, async (req, res) => {
  const body = parseGenPayload(generateCoreSchema, req.body || {}, res);
  if (!body) return;

  try {
    const runtime = loadCaseRuntime(req.params.caseId);
    if (!runtime) return res.status(404).json({ ok: false, error: 'Case not found' });
    const { projection, caseDir, formType, formConfig, facts, assignmentMeta } = runtime;
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType, 'POST /api/cases/:caseId/generate-core', log);
      return res.status(400).json({ ok: false, supported: false, formType, scope: 'deferred' });
    }

    const geo = readJSON(path.join(caseDir, 'geocode.json'), null);
    let locationContext = null;
    if (geo?.subject?.result?.lat) {
      try {
        const { lat, lng } = geo.subject.result;
        const boundaryFeatures = await getNeighborhoodBoundaryFeatures(lat, lng, 1.5);
        locationContext = formatLocationContextBlock({
          subject: geo.subject,
          comps: geo.comps || [],
          boundaryFeatures,
        });
      } catch (e) {
        log.warn('[generate-core] location context unavailable:', e.message);
      }
    }

    const requestedFields = asArray(req.body?.fields);
    const coreSections = formConfig.workflowFields || CORE_SECTIONS[formType] || [];
    const targetFields = requestedFields.length
      ? coreSections.filter(section => requestedFields.includes(section.id))
      : coreSections;
    if (!targetFields.length) {
      return res.status(400).json({ ok: false, error: 'No core sections defined for form type: ' + formType });
    }
    if (!enforcePreDraftGate(req, res, {
      caseId: req.params.caseId,
      formType,
      sectionIds: targetFields.map(section => section.id),
    })) return;

    const results = {};
    const errors = {};
    const statuses = {};
    const CONCURRENCY = 3;
    let qi = 0;

    async function runSection() {
      while (qi < targetFields.length) {
        const section = targetFields[qi++];
        const sid = section.id;
        try {
          const { voiceExamples, otherExamples } = getRelevantExamplesWithVoice({ formType, fieldId: sid });
          const messages = buildPromptMessages({
            formType,
            fieldId: sid,
            facts,
            voiceExamples,
            examples: otherExamples,
            locationContext: LOCATION_CONTEXT_FIELDS.has(sid) ? locationContext : null,
            assignmentMeta,
          });
          const text = await callAI(messages);
          results[sid] = {
            title: section.title,
            text,
            examplesUsed: voiceExamples.length + otherExamples.length,
          };
          statuses[sid] = 'drafted';
        } catch (e) {
          errors[sid] = e?.message || 'Unknown error';
          statuses[sid] = 'error';
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targetFields.length) }, runSection));
    persistGeneratedOutputs({
      caseId: req.params.caseId,
      projection,
      results,
      statuses,
      trackHistory: false,
    });

    const genResults = {};
    for (const [sid, value] of Object.entries(results)) {
      genResults[sid] = { ...value, sectionStatus: statuses[sid] || 'drafted' };
    }

    res.json({
      ok: true,
      results: genResults,
      errors,
      statuses,
      formType,
      sectionsAttempted: targetFields.length,
      coreSections: targetFields,
      generated: Object.keys(results).length,
      failed: Object.keys(errors).length,
      pipelineStage: 'generating',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/cases/:caseId/generate-comp-commentary', ensureAI, async (req, res) => {
  const body = parseGenPayload(generateCompCommentarySchema, req.body || {}, res);
  if (!body) return;

  try {
    const runtime = loadCaseRuntime(req.params.caseId);
    if (!runtime) return res.status(404).json({ ok: false, error: 'Case not found' });
    const { projection, formType, facts, assignmentMeta } = runtime;
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType, 'POST /api/cases/:caseId/generate-comp-commentary', log);
      return res.status(400).json({ ok: false, supported: false, formType, scope: 'deferred' });
    }
    if (formType !== '1004') {
      return res.status(400).json({
        ok: false,
        error: 'Comp commentary is only available for 1004 form type',
        formType,
      });
    }

    if (!enforcePreDraftGate(req, res, {
      caseId: req.params.caseId,
      formType,
      sectionIds: ['sca_summary'],
    })) return;
    const comps = asArray(req.body?.comps || facts?.comps || []);
    if (!comps.length) return res.status(400).json({ ok: false, error: 'No comparables provided' });

    const results = [];
    const errors = [];
    for (let i = 0; i < comps.length; i++) {
      const comp = comps[i];
      const compLabel = 'Comp ' + (i + 1);
      try {
        const compFacts = { ...facts, currentComp: comp, compIndex: i + 1, compLabel };
        const { voiceExamples, otherExamples } = getRelevantExamplesWithVoice({
          formType,
          fieldId: 'comp_commentary',
        });
        const messages = buildPromptMessages({
          formType,
          fieldId: 'comp_commentary',
          facts: compFacts,
          voiceExamples,
          examples: otherExamples,
          assignmentMeta,
        });
        const text = await callAI(messages);
        results.push({
          compIndex: i + 1,
          compLabel,
          text,
          address: comp?.address || null,
          examplesUsed: voiceExamples.length + otherExamples.length,
        });
      } catch (e) {
        errors.push({ compIndex: i + 1, compLabel, error: e.message });
      }
    }

    const compFocus = trimText(req.body?.compFocus, 40) || 'all';
    const combinedText = results.map(result => result.compLabel + ': ' + result.text).join('\n\n');
    if (results.length) {
      const generatedAt = new Date().toISOString();
      persistGeneratedOutputs({
        caseId: req.params.caseId,
        projection,
        results: {
          comp_commentary: { comps: results, generatedAt },
          sca_summary: { text: combinedText, comps: results, generatedAt },
        },
        statuses: {
          sca_summary: 'drafted',
        },
        trackHistory: false,
      });
    }

    const totalExamples = results.reduce((acc, result) => acc + (result.examplesUsed || 0), 0);
    res.json({
      ok: true,
      fieldId: 'sca_summary',
      text: combinedText,
      sectionStatus: 'drafted',
      results,
      errors,
      compsAttempted: comps.length,
      compsUsed: results.length,
      compFocus,
      examplesUsed: totalExamples,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/cases/:caseId/generate-all', ensureAI, async (req, res) => {
  const body = parseGenPayload(generateAllSchema, req.body || {}, res);
  if (!body) return;

  try {
    const runtime = loadCaseRuntime(req.params.caseId);
    if (!runtime) return res.status(404).json({ ok: false, error: 'Case not found' });
    const { projection, caseDir, formType, formConfig, facts, assignmentMeta } = runtime;
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType, 'POST /api/cases/:caseId/generate-all', log);
      return res.status(400).json({ ok: false, supported: false, formType, scope: 'deferred' });
    }

    const geo = readJSON(path.join(caseDir, 'geocode.json'), null);
    let locationContext = null;
    // Enrich facts with boundary roads and location data from geocode/Overpass
    // so [NORTH_BOUNDARY] etc. in style guide templates can be filled by the AI
    let enrichedFacts = { ...facts };
    if (geo?.subject?.result?.lat) {
      try {
        const { lat, lng } = geo.subject.result;
        const boundaryFeatures = await getNeighborhoodBoundaryFeatures(lat, lng, 1.5);
        locationContext = formatLocationContextBlock({
          subject: geo.subject,
          comps: geo.comps || [],
          boundaryFeatures,
        });
        // Inject boundary roads and location data into facts so formatFactsBlock
        // includes them as high-confidence facts (fills [NORTH_BOUNDARY] etc.)
        const br = boundaryFeatures?.boundaryRoads || {};
        const sr = geo.subject?.result || {};
        const neighborhoodFacts = { ...(enrichedFacts.neighborhood || {}) };
        // Store boundary roads under both naming schemes so the AI can resolve
        // [NORTH_BOUNDARY] placeholders in the style guide template.
        if (br.north) { neighborhoodFacts.boundary_north  = { value: br.north, confidence: 'high' }; neighborhoodFacts.NORTH_BOUNDARY = { value: br.north, confidence: 'high' }; }
        if (br.south) { neighborhoodFacts.boundary_south  = { value: br.south, confidence: 'high' }; neighborhoodFacts.SOUTH_BOUNDARY = { value: br.south, confidence: 'high' }; }
        if (br.east)  { neighborhoodFacts.boundary_east   = { value: br.east,  confidence: 'high' }; neighborhoodFacts.EAST_BOUNDARY  = { value: br.east,  confidence: 'high' }; }
        if (br.west)  { neighborhoodFacts.boundary_west   = { value: br.west,  confidence: 'high' }; neighborhoodFacts.WEST_BOUNDARY  = { value: br.west,  confidence: 'high' }; }
        if (sr.city)  neighborhoodFacts.city            = { value: sr.city,  confidence: 'high' };
        if (sr.suburb || sr.neighborhood) {
          neighborhoodFacts.subdivision = { value: sr.suburb || sr.neighborhood, confidence: 'high' };
        }
        enrichedFacts = { ...enrichedFacts, neighborhood: neighborhoodFacts };
      } catch (e) {
        log.warn('[generate-all] location context unavailable:', e.message);
      }
    }
    // Also inject subject city from geo if not already in facts
    if (geo?.subject?.result?.city && !enrichedFacts.subject?.city?.value) {
      enrichedFacts.subject = {
        ...(enrichedFacts.subject || {}),
        city: { value: geo.subject.result.city, confidence: 'high' },
      };
    }

    const allFields = formConfig.workflowFields || CORE_SECTIONS[formType] || [];
    if (!allFields.length) {
      return res.status(400).json({ ok: false, error: 'No fields configured for form type: ' + formType });
    }
    if (!enforcePreDraftGate(req, res, {
      caseId: req.params.caseId,
      formType,
      sectionIds: toSectionIds(allFields),
    })) return;

    const results = {};
    const errors = {};
    const statuses = {};
    // Sequential generation with delay to avoid hitting OpenAI TPM limits.
    // 30K TPM limit with ~3-4K tokens per field = max ~8 fields/min safely.
    // 3s gap keeps us under the limit even for longer fields like reconciliation.
    const INTER_FIELD_DELAY_MS = 5000;

    for (const field of allFields) {
      const sid = trimText(field?.id || field, 80);
      try {
        const { voiceExamples, otherExamples } = getRelevantExamplesWithVoice({ formType, fieldId: sid });
        const messages = buildPromptMessages({
          formType,
          fieldId: sid,
          facts: enrichedFacts,
          voiceExamples,
          examples: otherExamples,
          locationContext: LOCATION_CONTEXT_FIELDS.has(sid) ? locationContext : null,
          assignmentMeta,
        });
        const text = await callAI(messages);
        results[sid] = {
          title: field?.title || sid,
          text,
          examplesUsed: voiceExamples.length + otherExamples.length,
        };
        statuses[sid] = 'drafted';
      } catch (e) {
        errors[sid] = e?.message || 'Unknown error';
        statuses[sid] = 'error';
      }
      // Small delay between fields to stay under token rate limits
      await new Promise(r => setTimeout(r, INTER_FIELD_DELAY_MS));
    }
    persistGeneratedOutputs({
      caseId: req.params.caseId,
      projection,
      results,
      statuses,
      trackHistory: false,
    });

    res.json({ ok: true, results, errors, statuses, formType, fieldsAttempted: allFields.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /cases/:caseId/generate-full-draft ───────────────────────────────────
// ── Payload schemas ───────────────────────────────────────────────────────────

const generateOptionsSchema = z.object({
  forceGateBypass: z.boolean().optional(),
}).passthrough();

const generateFullDraftSchema = z.object({
  formType: z.string().max(40).optional(),
  options: generateOptionsSchema.optional(),
  forceGateBypass: z.boolean().optional(),
}).strict();

const generateFullDraftBodySchema = z.object({
  caseId: z.string().regex(/^[a-f0-9]{8}$/i),
  formType: z.string().max(40).optional(),
  options: generateOptionsSchema.optional(),
  forceGateBypass: z.boolean().optional(),
}).strict();

const regenerateSectionSchema = z.object({
  runId: z.string().min(1).max(120),
  sectionId: z.string().min(1).max(120),
  caseId: z.string().regex(/^[a-f0-9]{8}$/i),
}).strict();

function parseGenPayload(schema, payload, res) {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    ok: false,
    code: 'INVALID_PAYLOAD',
    error: 'Invalid request payload',
    details: parsed.error.issues.map(i => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    })),
  });
  return null;
}

/**
 * Trigger full-draft generation for a case via the orchestrator.
 * Runs asynchronously — returns runId immediately for polling.
 *
 * Body:    { formType?: string, options?: object }
 * Returns: { ok, runId, status, estimatedDurationMs, message }
 */
router.post('/cases/:caseId/generate-full-draft', async (req, res) => {
  const { caseId }           = req.params;
  // Validate payload first
  const parsedBody = parseGenPayload(generateFullDraftSchema, req.body || {}, res);
  if (!parsedBody) return;
  const { formType, options = {} } = parsedBody;

  // Scope enforcement — deferred forms blocked
  const resolvedFormType = formType || 'unknown';
  if (resolvedFormType !== 'unknown' && isDeferredForm(resolvedFormType)) {
    logDeferredAccess(resolvedFormType, '/api/cases/:caseId/generate-full-draft', log);
    return res.status(400).json({
      ok:        false,
      supported: false,
      scope:     'deferred',
      error:     `Form type "${resolvedFormType}" is deferred and not supported in the current production scope.`,
    });
  }

  // Verify case exists
  if (!getCaseProjection(caseId)) {
    return res.status(404).json({ ok: false, error: `Case not found: ${caseId}` });
  }
  if (!enforcePreDraftGate(req, res, {
    caseId,
    formType: resolvedFormType === 'unknown' ? null : resolvedFormType,
  })) return;

  let runId = null;

  try {
    // Get estimated duration from report plan (quick, synchronous)
    let estimatedDurationMs = 12_000;
    try {
      const ctx  = await buildAssignmentContext(caseId);
      const plan = buildReportPlan(ctx);
      estimatedDurationMs = plan.estimatedDurationMs || 12_000;
    } catch { /* non-fatal — use default estimate */ }

    // Launch orchestrator in background (non-blocking)
    const orchestratorPromise = runFullDraftOrchestrator({
      caseId,
      formType: resolvedFormType === 'unknown' ? undefined : resolvedFormType,
      options,
    });

    // Store result when complete
    orchestratorPromise
      .then(result => {
        if (result?.runId) {
          _setRunResult(result.runId, result);
          log.info('[orchestrator] run complete', { runId: result.runId, ok: result.ok });
        }
      })
      .catch(err => {
        log.error('[orchestrator] run error', { error: err.message });
      });

    // Poll for the run record the orchestrator creates synchronously via createRun().
    // Retry up to 5 times (50ms apart) to handle scheduling jitter.
    const db = getDb();
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(r => setTimeout(r, 50));
      const latestRun = db.prepare(`
        SELECT id FROM generation_runs
         WHERE case_id = ? AND status IN (
           'queued','preparing','retrieving','analyzing',
           'drafting','validating','assembling'
         )
         ORDER BY created_at DESC LIMIT 1
      `).get(caseId);
      if (latestRun?.id) { runId = latestRun.id; break; }
    }

    res.json({
      ok:                 true,
      runId,
      status:             RUN_STATUS.PREPARING,
      estimatedDurationMs,
      message:            'Full-draft generation started. Poll /api/generation/runs/:runId/status for progress.',
    });
  } catch (err) {
    log.error('[generate-full-draft]', err.message);
    res.status(500).json({ ok: false, error: err.message, runId });
  }
});

// ── POST /generation/full-draft ───────────────────────────────────────────────
/**
 * Alias for POST /cases/:caseId/generate-full-draft.
 * Accepts caseId in the request body instead of the URL path.
 * Useful for clients that prefer a flat API surface.
 *
 * Body:    { caseId, formType?: string, options?: object }
 * Returns: { ok, runId, status, estimatedDurationMs, message }
 */
router.post('/generation/full-draft', async (req, res) => {
  // Validate payload first
  const parsedBody = parseGenPayload(generateFullDraftBodySchema, req.body || {}, res);
  if (!parsedBody) return;

  const { caseId, formType, options = {} } = parsedBody;

  if (!caseId) {
    return res.status(400).json({ ok: false, code: 'INVALID_PAYLOAD', error: 'caseId is required in request body' });
  }

  // Delegate to the canonical route handler by forwarding to the same logic
  req.params.caseId = caseId;
  req.body.formType = formType;
  req.body.options  = options;

  // Resolve caseDir manually (router.param won't fire for this route)
  const caseDir = resolveCaseDir(caseId);
  if (!caseDir) {
    return res.status(400).json({ ok: false, error: 'Invalid caseId format' });
  }
  if (!getCaseProjection(caseId)) {
    return res.status(404).json({ ok: false, error: `Case not found: ${caseId}` });
  }
  req.caseDir = caseDir;

  // Scope enforcement
  const resolvedFormType = formType || 'unknown';
  if (resolvedFormType !== 'unknown' && isDeferredForm(resolvedFormType)) {
    logDeferredAccess(resolvedFormType, '/api/generation/full-draft', log);
    return res.status(400).json({
      ok:        false,
      supported: false,
      scope:     'deferred',
      error:     `Form type "${resolvedFormType}" is deferred and not supported in the current production scope.`,
    });
  }
  if (!enforcePreDraftGate(req, res, {
    caseId,
    formType: resolvedFormType === 'unknown' ? null : resolvedFormType,
  })) return;

  let runId = null;

  try {
    let estimatedDurationMs = 12_000;
    try {
      const ctx  = await buildAssignmentContext(caseId);
      const plan = buildReportPlan(ctx);
      estimatedDurationMs = plan.estimatedDurationMs || 12_000;
    } catch { /* non-fatal */ }

    const orchestratorPromise = runFullDraftOrchestrator({
      caseId,
      formType: resolvedFormType === 'unknown' ? undefined : resolvedFormType,
      options,
    });

    orchestratorPromise
      .then(result => {
        if (result?.runId) {
          _setRunResult(result.runId, result);
          log.info('[orchestrator] run complete', { runId: result.runId, ok: result.ok });
        }
      })
      .catch(err => {
        log.error('[orchestrator] run error', { error: err.message });
      });

    // Poll for the run record the orchestrator creates synchronously via createRun().
    const db = getDb();
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(r => setTimeout(r, 50));
      const latestRun = db.prepare(`
        SELECT id FROM generation_runs
         WHERE case_id = ? AND status IN (
           'queued','preparing','retrieving','analyzing',
           'drafting','validating','assembling'
         )
         ORDER BY created_at DESC LIMIT 1
      `).get(caseId);
      if (latestRun?.id) { runId = latestRun.id; break; }
    }

    res.json({
      ok:                 true,
      runId,
      status:             RUN_STATUS.PREPARING,
      estimatedDurationMs,
      message:            'Full-draft generation started. Poll /api/generation/runs/:runId/status for progress.',
    });
  } catch (err) {
    log.error('[generation/full-draft]', err.message);
    res.status(500).json({ ok: false, error: err.message, runId });
  }
});

// ── GET /generation/runs/:runId/status ────────────────────────────────────────
/**
 * Poll the status of a generation run.
 *
 * Returns: { ok, runId, status, phase, sectionsCompleted, sectionsTotal,
 *            elapsedMs, sectionStatuses, phaseTimings, retrieval, warnings }
 */
router.get('/generation/runs/:runId/status', (req, res) => {
  const { runId } = req.params;
  try {
    const status = getRunStatus(runId);
    if (!status) {
      return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
    }
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /generation/runs/:runId/result ────────────────────────────────────────
/**
 * Get the final result of a completed generation run.
 *
 * Priority order:
 *   1. In-memory _runResults (fastest — same server process, run just completed)
 *   2. getRunResult() from orchestrator (reads draft_package_json from SQLite)
 *   3. Section-by-section reconstruction from generated_sections rows
 *
 * Returns: { ok, runId, draftPackage, metrics, warnings, sections, fromCache }
 */
router.get('/generation/runs/:runId/result', (req, res) => {
  const { runId } = req.params;
  try {
    // ── 1. In-memory store (fastest path — run just completed this session) ──
    const cached = _runResults.get(runId);
    if (cached) {
      return res.json({
        ok:           true,
        runId,
        draftPackage: cached.draftPackage,
        sections:     cached.draftPackage?.sections || {},
        metrics:      cached.metrics,
        warnings:     cached.warnings || [],
        fromCache:    true,
        source:       'memory',
      });
    }

    // ── 2. Check run status first ─────────────────────────────────────────────
    const status = getRunStatus(runId);
    if (!status) {
      return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
    }

    // Run is still active — return progress info, not a result
    const activeStatuses = [
      RUN_STATUS.QUEUED,
      RUN_STATUS.PREPARING,
      RUN_STATUS.RETRIEVING,
      RUN_STATUS.ANALYZING,
      RUN_STATUS.DRAFTING,
      RUN_STATUS.VALIDATING,
      RUN_STATUS.ASSEMBLING,
    ];
    if (activeStatuses.includes(status.status)) {
      return res.json({
        ok:                true,
        runId,
        status:            status.status,
        legacyStatus:      status.legacyStatus,
        message:           'Run is still in progress. Try again shortly.',
        elapsedMs:         status.elapsedMs,
        sectionsCompleted: status.sectionsCompleted,
        sectionsTotal:     status.sectionsTotal,
        sectionStatuses:   status.sectionStatuses,
      });
    }

    // ── 3. Use getRunResult() — reads draft_package_json or reconstructs ──────
    const result = getRunResult(runId);
    if (result) {
      return res.json({
        ok:          true,
        runId,
        status:      status.status,
        legacyStatus: status.legacyStatus,
        draftPackage: result.draftPackage || null,
        sections:    result.sections || {},
        metrics:     result.metrics  || status.phaseTimings,
        warnings:    result.warnings || status.warnings || [],
        retrieval:   status.retrieval,
        fromCache:   result.fromCache,
        source:      result.fromCache ? 'sqlite-package' : 'sqlite-sections',
      });
    }

    // ── 4. Fallback: manual section reconstruction ────────────────────────────
    const sectionRows = getGeneratedSectionsForRun(runId);
    const sectionsMap = {};
    for (const s of sectionRows) {
      sectionsMap[s.section_id] = {
        sectionId:    s.section_id,
        text:         s.final_text || s.draft_text || '',
        approved:     !!s.approved,
        approvedAt:   s.approved_at,
        insertedAt:   s.inserted_at,
        examplesUsed: s.examples_used,
      };
    }

    res.json({
      ok:          true,
      runId,
      status:      status.status,
      legacyStatus: status.legacyStatus,
      sections:    sectionsMap,
      metrics:     status.phaseTimings,
      warnings:    status.warnings || [],
      retrieval:   status.retrieval,
      fromCache:   false,
      source:      'sqlite-fallback',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /generation/regenerate-section ──────────────────────────────────────
/**
 * Regenerate a single section within an existing run.
 * Useful for fixing a failed or thin section without re-running the full draft.
 *
 * Body:    { runId, sectionId, caseId }
 * Returns: { ok, sectionId, text, metrics }
 */
router.patch('/generation/runs/:runId/sections/:sectionId', (req, res) => {
  const runId = trimText(req.params.runId, 80);
  const sectionId = trimText(req.params.sectionId, 80);
  const text = trimText(req.body?.text, 16000);
  const requestedStatus = trimText(req.body?.sectionStatus, 40).toLowerCase();
  const sectionStatus = ['approved', 'reviewed'].includes(requestedStatus) ? requestedStatus : 'reviewed';

  if (!runId || !sectionId || !text) {
    return res.status(400).json({ ok: false, error: 'runId, sectionId, and text are required' });
  }

  try {
    const run = getRunById(runId);
    if (!run) return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });

    let updated = updateGeneratedSectionReview({
      runId,
      sectionId,
      text,
      approved: sectionStatus === 'approved',
    });

    if (!updated) {
      const jobId = getJobIdForSection(runId, sectionId);
      if (!jobId) {
        return res.status(404).json({
          ok: false,
          error: `Generated section not found for run ${runId}: ${sectionId}`,
        });
      }

      saveGeneratedSection({
        jobId,
        runId,
        caseId: run.case_id,
        sectionId,
        formType: run.form_type,
        text,
        examplesUsed: 0,
      });

      updated = updateGeneratedSectionReview({
        runId,
        sectionId,
        text,
        approved: sectionStatus === 'approved',
      });
    }

    if (!updated) {
      return res.status(404).json({
        ok: false,
        error: `Generated section not found for run ${runId}: ${sectionId}`,
      });
    }

    const projection = getCaseProjection(run.case_id);
    if (projection) {
      persistGeneratedOutputs({
        caseId: run.case_id,
        projection,
        results: {
          [sectionId]: {
            ...(projection.outputs?.[sectionId] || {}),
            title: projection.outputs?.[sectionId]?.title || getSectionDef(run.form_type, sectionId)?.label || sectionId,
            text,
            updatedAt: new Date().toISOString(),
          },
        },
        statuses: { [sectionId]: sectionStatus },
        trackHistory: true,
      });
    }

    const cached = _runResults.get(runId);
    if (cached?.draftPackage) {
      _setRunResult(runId, {
        ...cached,
        draftPackage: {
          ...cached.draftPackage,
          sections: {
            ...(cached.draftPackage.sections || {}),
            [sectionId]: {
              ...((cached.draftPackage.sections || {})[sectionId] || {}),
              sectionId,
              ok: true,
              error: null,
              text,
            },
          },
        },
      });
    }

    res.json({
      ok: true,
      runId,
      caseId: run.case_id,
      sectionId,
      sectionStatus,
      approved: sectionStatus === 'approved',
      charCount: text.length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/generation/regenerate-section', async (req, res) => {
  // Validate payload
  const parsedBody = parseGenPayload(regenerateSectionSchema, req.body || {}, res);
  if (!parsedBody) return;

  const { runId, sectionId, caseId } = parsedBody;

  try {
    // Check run exists
    const run = getRunById(runId);
    if (!run) {
      return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
    }

    // Check run/case mismatch
    const runCaseId = run.case_id;
    if (runCaseId && runCaseId !== caseId) {
      return res.status(409).json({
        ok: false,
        code: 'RUN_CASE_MISMATCH',
        error: `Run ${runId} belongs to case ${runCaseId}, not ${caseId}`,
        runCaseId,
      });
    }

    const formType = run.form_type || '1004';

    // Enforce pre-draft gate
    if (!enforcePreDraftGate(req, res, { caseId, formType, sectionIds: [sectionId] })) return;

    const runStatus = getRunStatus(runId);
    const sectionDef = getSectionDef(formType, sectionId);
    if (!sectionDef) {
      return res.status(400).json({ ok: false, error: `Unknown section: ${sectionId} for form ${formType}` });
    }

    const context       = await buildAssignmentContext(caseId);
    const plan          = buildReportPlan(context);
    const retrievalPack = await buildRetrievalPack(context, plan);

    // Collect prior section results for synthesis sections
    const priorSections = getGeneratedSectionsForRun(runId);
    const priorResults  = {};
    for (const s of priorSections) {
      if (s.section_id !== sectionId) {
        priorResults[s.section_id] = { text: s.final_text || '', ok: true };
      }
    }

    const result = await runSectionJob({
      runId,
      caseId,
      sectionDef,
      context,
      retrievalPack,
      priorResults,
      analysisArtifacts: {},
    });

    res.json({
      ok:        result.ok,
      sectionId: result.sectionId,
      text:      result.text,
      metrics:   result.metrics,
      error:     result.error || null,
    });
  } catch (err) {
    log.error('[regenerate-section]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /db/migrate-legacy-kb ────────────────────────────────────────────────
/**
 * Import the existing flat-file knowledge base into SQLite memory_items.
 * Idempotent — safe to run multiple times.
 *
 * Returns: { ok, imported, skipped, upgraded, errors, sources, durationMs }
 */
router.post('/db/migrate-legacy-kb', async (req, res) => {
  // Reject unexpected payload fields
  const body = req.body;
  if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length > 0) {
    return res.status(400).json({ ok: false, code: 'INVALID_PAYLOAD', error: 'Unexpected payload fields' });
  }
  try {
    log.info('[db] Starting legacy KB migration...');
    const result = await runLegacyKbImport();
    log.info('[db] Legacy KB migration complete', result);
    res.json({ ok: result.ok, ...result });
  } catch (err) {
    log.error('[db/migrate-legacy-kb]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /db/status ────────────────────────────────────────────────────────────
/**
 * SQLite database health check and table counts.
 *
 * Returns: { ok, dbPath, dbSizeBytes, tables, memory, initialized }
 */
router.get('/db/status', (_req, res) => {
  try {
    const tableCounts = getTableCounts();
    const memoryStats = getMemoryItemStats();
    const dbPath      = getDbPath();
    const dbSizeBytes = getDbSizeBytes();

    res.json({
      ok:          true,
      dbPath,
      dbSizeBytes,
      dbSizeKb:    Math.round(dbSizeBytes / 1024),
      tables:      tableCounts,
      memory:      memoryStats,
      initialized: true,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, initialized: false });
  }
});

export default router;
