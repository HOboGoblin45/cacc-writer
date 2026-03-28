/**
 * server/api/workflowRoutes.js
 * -----------------------------
 * Express Router for legacy workflow execution endpoints.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Extracted routes:
 *   POST /workflow/run
 *   POST /workflow/run-batch
 *   GET  /workflow/health
 *   POST /workflow/ingest-pdf
 */

import { Router } from 'express';
import path from 'path';
import { z } from 'zod';

import { validateBody, validateParams, validateQuery } from '../middleware/validateRequest.js';
import {
  CASES_DIR,
  resolveCaseDir,
  normalizeFormType,
} from '../utils/caseUtils.js';
import { readJSON } from '../utils/fileUtils.js';
import { trimText } from '../utils/textUtils.js';
import { upload, ensureAI, readUploadedFile, cleanupUploadedFile } from '../utils/middleware.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';
import { getFormConfig } from '../../forms/index.js';

import {
  ACTIVE_FORMS,
  DEFERRED_FORMS,
  isDeferredForm,
  logDeferredAccess,
} from '../config/productionScope.js';
import { CORE_SECTIONS } from '../config/coreSections.js';
import { callAI, client, MODEL } from '../openaiClient.js';
import { getRelevantExamplesWithVoice } from '../retrieval.js';
import { buildPromptMessages, buildReviewMessages } from '../promptBuilder.js';
import { applyMetaDefaults, buildAssignmentMetaBlock } from '../caseMetadata.js';
import { sendErrorResponse } from '../utils/errorResponse.js';
import { getCaseProjection, saveCaseProjection, listCaseProjections } from '../caseRecord/caseRecordService.js';
import { evaluatePreDraftGate } from '../factIntegrity/preDraftGate.js';
import { buildFactDecisionQueue } from '../factIntegrity/factDecisionQueue.js';
import {
  getNeighborhoodBoundaryFeatures,
  formatLocationContextBlock,
  LOCATION_CONTEXT_FIELDS,
} from '../neighborhoodContext.js';
import log from '../logger.js';
import { emitCaseEvent } from '../operations/auditLogger.js';

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const ALLOW_FORCE_GATE_BYPASS = ['1', 'true', 'yes', 'on']
  .includes(String(process.env.CACC_ALLOW_FORCE_GATE_BYPASS || '').trim().toLowerCase());
const router = Router();
const workflowFieldRefSchema = z.union([
  z.string().max(80),
  z.object({
    id: z.string().max(80),
    title: z.string().max(160).optional(),
  }).passthrough(),
]);
const workflowRunSchema = z.object({
  caseId: z.string().min(1).max(80),
  fields: z.array(workflowFieldRefSchema).max(200).optional(),
  formType: z.string().max(40).optional(),
  twoPass: z.boolean().optional(),
  saveOutputs: z.boolean().optional(),
  options: z.object({
    forceGateBypass: z.boolean().optional(),
  }).passthrough().optional(),
  forceGateBypass: z.boolean().optional(),
}).passthrough();
const workflowRunBatchSchema = z.object({
  cases: z.array(z.string().min(1).max(80)).min(1).max(10),
  fields: z.array(workflowFieldRefSchema).max(200).optional(),
  formType: z.string().max(40).optional(),
  twoPass: z.boolean().optional(),
  options: z.object({
    forceGateBypass: z.boolean().optional(),
  }).passthrough().optional(),
  forceGateBypass: z.boolean().optional(),
}).passthrough();

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

function requestedGateBypass(req) {
  const body = req.validated || req.body;
  return Boolean(body?.forceGateBypass || body?.options?.forceGateBypass);
}

function shouldBypassPreDraftGate(req) {
  return requestedGateBypass(req) && ALLOW_FORCE_GATE_BYPASS;
}

function rejectBypassWhenDisabled(req, res) {
  if (!requestedGateBypass(req) || ALLOW_FORCE_GATE_BYPASS) return false;
  res.status(403).json({
    ok: false,
    code: 'PRE_DRAFT_GATE_BYPASS_DISABLED',
    error: 'forceGateBypass is disabled in this environment',
    hint: 'Set CACC_ALLOW_FORCE_GATE_BYPASS=true to allow explicit pre-draft gate bypass.',
  });
  return true;
}

function evaluateGateForCase(caseId, formType, sectionIds) {
  return evaluatePreDraftGate({ caseId, formType, sectionIds });
}

function buildGateBlockedResponse(caseId, gate, scopeMessage) {
  const queue = buildFactDecisionQueue(caseId);
  const factReviewQueuePath = `/api/cases/${caseId}/fact-review-queue`;
  return {
    ok: false,
    code: 'PRE_DRAFT_GATE_BLOCKED',
    error: scopeMessage,
    gate,
    factReviewQueuePath,
    factReviewQueueSummary: queue?.summary || null,
    hint: ALLOW_FORCE_GATE_BYPASS
      ? `Resolve blocker items from GET ${factReviewQueuePath}, or pass forceGateBypass=true.`
      : `Resolve blocker items from GET ${factReviewQueuePath}.`,
  };
}

function loadCaseRuntime(caseId) {
  const projection = getCaseProjection(caseId);
  if (!projection) return null;
  const formType = normalizeFormType(projection.meta?.formType);
  return {
    projection,
    formType,
    formConfig: getFormConfig(formType),
    facts: projection.facts || {},
    assignmentMeta: buildAssignmentMetaBlock(applyMetaDefaults(projection.meta || {})),
  };
}

function persistWorkflowOutputs(caseId, projection, results = {}) {
  if (!projection) return null;
  const now = new Date().toISOString();
  const nextMeta = {
    ...(projection.meta || {}),
    updatedAt: now,
    pipelineStage: 'generating',
  };
  const nextOutputs = {
    ...(projection.outputs || {}),
    ...(results || {}),
    updatedAt: now,
  };
  return saveCaseProjection({
    caseId,
    meta: nextMeta,
    facts: projection.facts || {},
    provenance: projection.provenance || {},
    outputs: nextOutputs,
    history: projection.history || {},
    docText: projection.docText || {},
  });
}

router.post('/workflow/run', ensureAI, validateBody(workflowRunSchema), async (req, res) => {
  try {
    res.setHeader('X-Deprecated', 'true');
    res.setHeader('X-Deprecation-Notice', 'Use POST /api/cases/:caseId/generate-full-draft instead');
    const body = req.validated;
    if (rejectBypassWhenDisabled(req, res)) return;
    const { caseId, fields, twoPass = false, saveOutputs = true } = body;
    const requestedFt = String(body.formType || '').trim().toLowerCase();
    if (requestedFt && isDeferredForm(requestedFt)) {
      logDeferredAccess(requestedFt, 'POST /api/workflow/run', log);
      return res.status(400).json({ ok: false, supported: false, formType: requestedFt, scope: 'deferred' });
    }
    const runtime = loadCaseRuntime(caseId);
    if (!runtime) return res.status(404).json({ ok: false, error: 'Case not found' });
    const { projection, formType, formConfig, facts, assignmentMeta } = runtime;

    if (isDeferredForm(formType)) {
      logDeferredAccess(formType, 'POST /api/workflow/run', log);
      return res.status(400).json({ ok: false, supported: false, formType, scope: 'deferred' });
    }

    const caseDir = resolveCaseDir(caseId);
    const geo = caseDir ? readJSON(path.join(caseDir, 'geocode.json'), null) : null;
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
        log.warn('[workflow/run] location context unavailable:', e.message);
      }
    }

    const targetFields = Array.isArray(fields) && fields.length
      ? fields
      : (formConfig.workflowFields || CORE_SECTIONS[formType] || []);
    if (!targetFields.length) return res.status(400).json({ ok: false, error: 'No fields to generate' });
    if (!shouldBypassPreDraftGate(req)) {
      const gate = evaluateGateForCase(caseId, formType, toSectionIds(targetFields));
      if (!gate) return res.status(404).json({ ok: false, error: 'Case not found' });
      if (!gate.ok) {
        return res.status(409).json(buildGateBlockedResponse(
          caseId,
          gate,
          'Pre-draft integrity gate blocked workflow run',
        ));
      }
    }

    const results = {};
    const errors = {};
    const CONCURRENCY = 3;
    let qi = 0;

    async function runField() {
      while (qi < targetFields.length) {
        const field = targetFields[qi++];
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
          let text = await callAI(messages);
          if (twoPass && text) {
            try {
              const reviewMessages = buildReviewMessages({ draftText: text, facts, fieldId: sid, formType });
              const reviewRaw = await callAI(reviewMessages);
              const reviewJson = reviewRaw
                .trim()
                .replace(/^```json\n?/, '')
                .replace(/\n?```$/, '')
                .replace(/^`json\n?/, '')
                .replace(/\n?`$/, '');
              const review = JSON.parse(reviewJson);
              if (review?.revisedText) text = review.revisedText;
            } catch {
              // non-fatal
            }
          }
          results[sid] = {
            title: field?.title || sid,
            text,
            examplesUsed: voiceExamples.length + otherExamples.length,
          };
        } catch (e) {
          errors[sid] = e?.message || 'Unknown error';
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targetFields.length) }, runField));

    if (saveOutputs && Object.keys(results).length) {
      persistWorkflowOutputs(caseId, projection, results);
    }

    emitCaseEvent(caseId, 'generation.legacy_run', 'Legacy workflow/run generation completed', {
      fieldsAttempted: targetFields.length,
      fieldsSucceeded: Object.keys(results).length,
      deprecated: true,
    });

    res.json({ ok: true, results, errors, formType, fieldsAttempted: targetFields.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/workflow/run-batch', ensureAI, validateBody(workflowRunBatchSchema), async (req, res) => {
  try {
    res.setHeader('X-Deprecated', 'true');
    res.setHeader('X-Deprecation-Notice', 'Use POST /api/cases/:caseId/generate-full-draft instead');
    const body = req.validated;
    if (rejectBypassWhenDisabled(req, res)) return;
    const { cases, fields, twoPass = false } = body;
    const requestedFt = String(body.formType || '').trim().toLowerCase();
    if (requestedFt && isDeferredForm(requestedFt)) {
      logDeferredAccess(requestedFt, 'POST /api/workflow/run-batch', log);
      return res.status(400).json({ ok: false, supported: false, formType: requestedFt, scope: 'deferred' });
    }
    const batchResults = [];
    const batchErrors = [];
    for (const caseId of cases) {
      const runtime = loadCaseRuntime(caseId);
      if (!runtime) {
        batchErrors.push({ caseId, error: 'Case not found' });
        continue;
      }
      const { projection, formType, formConfig, facts, assignmentMeta } = runtime;
      if (isDeferredForm(formType)) {
        batchErrors.push({ caseId, error: 'Deferred form type: ' + formType });
        continue;
      }
      try {
        const targetFields = Array.isArray(fields) && fields.length
          ? fields
          : (formConfig.workflowFields || CORE_SECTIONS[formType] || []);
        if (!shouldBypassPreDraftGate(req)) {
          const gate = evaluateGateForCase(caseId, formType, toSectionIds(targetFields));
          if (!gate) {
            batchErrors.push({ caseId, error: 'Case not found' });
            continue;
          }
          if (!gate.ok) {
            batchErrors.push({
              caseId,
              ...buildGateBlockedResponse(
                caseId,
                gate,
                'Pre-draft integrity gate blocked workflow run',
              ),
            });
            continue;
          }
        }

        const results = {};
        const errors = {};
        for (const field of targetFields) {
          const sid = trimText(field?.id || field, 80);
          try {
            const { voiceExamples, otherExamples } = getRelevantExamplesWithVoice({ formType, fieldId: sid });
            const messages = buildPromptMessages({
              formType,
              fieldId: sid,
              facts,
              voiceExamples,
              examples: otherExamples,
              assignmentMeta,
            });
            let text = await callAI(messages);
            if (twoPass && text) {
              try {
                const reviewMessages = buildReviewMessages({ draftText: text, facts, fieldId: sid, formType });
                const reviewRaw = await callAI(reviewMessages);
                const reviewJson = reviewRaw
                  .trim()
                  .replace(/^```json\n?/, '')
                  .replace(/\n?```$/, '')
                  .replace(/^`json\n?/, '')
                  .replace(/\n?`$/, '');
                const review = JSON.parse(reviewJson);
                if (review?.revisedText) text = review.revisedText;
              } catch {
                // non-fatal
              }
            }
            results[sid] = { title: field?.title || sid, text };
          } catch (e) {
            errors[sid] = e?.message || 'Unknown error';
          }
        }
        persistWorkflowOutputs(caseId, projection, results);
        batchResults.push({ caseId, results, errors });
      } catch (e) {
        batchErrors.push({ caseId, error: e.message });
      }
    }

    res.json({ ok: true, batchResults, batchErrors });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/workflow/health', (_req, res) => {
  const projections = listCaseProjections();
  const totalCases = projections.length;
  const activeCases = projections.filter(p => p?.meta?.status === 'active').length;
  res.json({
    ok: true,
    status: 'healthy',
    casesDir: CASES_DIR,
    totalCases,
    activeCases,
    model: MODEL,
    aiAvailable: Boolean(OPENAI_API_KEY),
    activeForms: ACTIVE_FORMS,
    deferredForms: DEFERRED_FORMS,
  });
});

router.post('/workflow/ingest-pdf', upload.single('file'), ensureAI, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const isPdf = req.file.mimetype === 'application/pdf'
      || String(req.file.originalname || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ ok: false, error: 'Only PDF files are allowed' });

    const pdfBuffer = await readUploadedFile(req.file);
    const { text, method } = await extractPdfText(pdfBuffer, client, MODEL);
    const clean = text
      .replace(/\n{4,}/g, '\n\n')
      .replace(/[ \t]{3,}/g, '  ')
      .trim();

    res.json({
      ok: true,
      text: clean,
      method,
      wordCount: clean.split(/\s+/).filter(Boolean).length,
      preview: clean.slice(0, 500),
    });
  } catch (err) {
    return sendErrorResponse(res, err);
  } finally {
    await cleanupUploadedFile(req.file);
  }
});

export default router;
