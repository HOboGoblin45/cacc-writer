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
const fullDraftOptionsSchema = z.object({
  forceGateBypass: z.boolean().optional(),
}).passthrough();
const generateSchema = z.object({
  fieldId: z.string().max(80).optional(),
  formType: z.string().max(40).optional(),
  caseId: z.string().max(80).optional(),
  facts: z.record(z.unknown()).optional(),
  prompt: z.string().max(24000).optional(),
  forceGateBypass: z.boolean().optional(),
  options: fullDraftOptionsSchema.optional(),
}).passthrough();
const generateBatchFieldSchema = z.union([
  z.string().max(80),
  z.object({
    id: z.string().max(80).optional(),
    title: z.string().max(200).optional(),
  }).passthrough(),
]);
const generateBatchSchema = z.object({
  fields: z.array(generateBatchFieldSchema).min(1).max(MAX_BATCH_FIELDS),
  caseId: z.string().max(80).optional(),
  twoPass: z.boolean().optional(),
  forceGateBypass: z.boolean().optional(),
  options: fullDraftOptionsSchema.optional(),
}).passthrough();
const similarExamplesSchema = z.object({
  fieldId: z.string().max(80).optional(),
  limit: z.union([z.number(), z.string()]).optional(),
  formType: z.string().max(40).optional(),
}).passthrough();
const generateCoreSchema = z.object({
  fields: z.array(z.string().max(80)).max(200).optional(),
  forceGateBypass: z.boolean().optional(),
  options: fullDraftOptionsSchema.optional(),
}).passthrough();
const generateCompCommentarySchema = z.object({
  comps: z.array(z.unknown()).max(200).optional(),
  compFocus: z.string().max(40).optional(),
  forceGateBypass: z.boolean().optional(),
  options: fullDraftOptionsSchema.optional(),
}).passthrough();
const generateAllSchema = z.object({
  forceGateBypass: z.boolean().optional(),
  options: fullDraftOptionsSchema.optional(),
}).passthrough();
const generateFullDraftSchema = z.object({
  formType: z.string().max(40).optional(),
  options: fullDraftOptionsSchema.optional(),
  forceGateBypass: z.boolean().optional(),
}).passthrough();
const fullDraftAliasSchema = generateFullDraftSchema.extend({
  caseId: z.string().min(1).max(80),
});
const regenerateSectionSchema = z.object({
  runId: z.string().min(1).max(80),
  sectionId: z.string().min(1).max(80),
  caseId: z.string().min(1).max(80),
}).passthrough();
const emptyMutationSchema = z.object({}).strict();

function parsePayload(schema, payload, res) {
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

function shouldBypassPreDraftGate(req) {
  return Boolean(req.body?.forceGateBypass || req.body?.options?.forceGateBypass);
}

function enforcePreDraftGate(req, res, { caseId, formType, sectionIds = null }) {
  if (shouldBypassPreDraftGate(req)) return true;

  const gate = evaluatePreDraftGate({ caseId, formType, sectionIds });
  if (!gate) {
    res.status(404).json({ ok: false, error: 'Case not found' });
    return false;
  }

  if (gate.ok) return true;
  const queue = buildFactDecisionQueue(caseId);
  const factReviewQueuePath = `/api/cases/${caseId}/fact-review-queue`;

  res.status(409).json({
    ok: false,
    code: 'PRE_DRAFT_GATE_BLOCKED',
    error: 'Pre-draft integrity gate blocked generation',
    gate,
    factReviewQueuePath,
    factReviewQueueSummary: queue?.summary || null,
    hint: `Resolve blocker items from GET ${factReviewQueuePath} (or /pre-draft-check), or pass forceGateBypass=true.`,
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
  const body = parsePayload(generateSchema, req.body || {}, res);
  if (!body) return;
  req.body = body;

  try {
    const { fieldId, formType, caseId, facts: bodyFacts } = body;
    const prompt = trimText(body.prompt, 24000);
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
  const body = parsePayload(generateBatchSchema, req.body || {}, res);
  if (!body) return;
  req.body = body;

  try {
    const { fields, caseId, twoPass = false } = body;
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
router.post('/similar-examples', (req, res) => {
  const body = parsePayload(similarExamplesSchema, req.body || {}, res);
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

router.post('/cases/:caseId/generate-core', ensureAI, async (req, res) => {
  const body = parsePayload(generateCoreSchema, req.body || {}, res);
  if (!body) return;
  req.body = body;

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

    const requestedFields = asArray(body.fields);
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
  const body = parsePayload(generateCompCommentarySchema, req.body || {}, res);
  if (!body) return;
  req.body = body;

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
    const comps = asArray(body.comps || facts?.comps || []);
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

    const compFocus = trimText(body.compFocus, 40) || 'all';
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
  const body = parsePayload(generateAllSchema, req.body || {}, res);
  if (!body) return;
  req.body = body;

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
        log.warn('[generate-all] location context unavailable:', e.message);
      }
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
    const CONCURRENCY = 3;
    let qi = 0;

    async function runAll() {
      while (qi < allFields.length) {
        const field = allFields[qi++];
        const sid = trimText(field?.id || field, 80);
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
            title: field?.title || sid,
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

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, allFields.length) }, runAll));
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
/**
 * Trigger full-draft generation for a case via the orchestrator.
 * Runs asynchronously — returns runId immediately for polling.
 *
 * Body:    { formType?: string, options?: object }
 * Returns: { ok, runId, status, estimatedDurationMs, message }
 */
router.post('/cases/:caseId/generate-full-draft', async (req, res) => {
  const { caseId } = req.params;
  const body = parsePayload(generateFullDraftSchema, req.body || {}, res);
  if (!body) return;
  const { formType, options = {} } = body;

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
  const body = parsePayload(fullDraftAliasSchema, req.body || {}, res);
  if (!body) return;
  const { caseId, formType, options = {} } = body;

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
router.post('/generation/regenerate-section', async (req, res) => {
  const body = parsePayload(regenerateSectionSchema, req.body || {}, res);
  if (!body) return;
  const { runId, sectionId, caseId } = body;

  try {
    const runStatus = getRunStatus(runId);
    if (!runStatus) {
      return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
    }

    const formType   = runStatus.formType || '1004';
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
  if (!parsePayload(emptyMutationSchema, req.body || {}, res)) return;

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
