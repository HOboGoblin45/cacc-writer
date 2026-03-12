/**
 * server/api/casesRoutes.js
 * --------------------------
 * Express Router for all /api/cases/* endpoints.
 *
 * Mounted at: /api/cases  (in cacc-writer-server.js)
 *
 * Extracted routes (new architecture path):
 *   POST   /                              — create case
 *   GET    /                              — list cases
 *   GET    /:caseId                       — load case
 *   PATCH  /:caseId                       — update case metadata
 *   DELETE /:caseId                       — delete case
 *   PATCH  /:caseId/status                — set active/submitted/archived
 *   PATCH  /:caseId/pipeline              — advance pipeline stage
 *   PATCH  /:caseId/workflow-status       — set workflowStatus
 *   PUT    /:caseId/facts                 — save/merge facts
 *   GET    /:caseId/history               — section version history
 *   GET    /:caseId/generation-runs       — list orchestrator runs for case
 *   POST   /:caseId/geocode               — geocode subject + comps
 *   GET    /:caseId/location-context      — geocode + Overpass boundary features
 *   GET    /:caseId/missing-facts/:fieldId — single-field missing facts check
 *   POST   /:caseId/missing-facts         — batch missing facts check
 *
 * Legacy compatibility routes now live in:
 *   server/api/caseCompatRoutes.js
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// ── Shared utilities ──────────────────────────────────────────────────────────
import { casePath, resolveCaseDir, normalizeFormType, getCaseFormConfig } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { trimText } from '../utils/textUtils.js';

// ── Domain modules ────────────────────────────────────────────────────────────
import { DEFAULT_FORM_TYPE } from '../../forms/index.js';
import { ACTIVE_FORMS, isDeferredForm, logDeferredAccess } from '../config/productionScope.js';
import { applyMetaDefaults, extractMetaFields } from '../caseMetadata.js';
import { isValidWorkflowStatus } from '../workflowStatus.js';
import { getMissingFacts, formatMissingFactsForUI } from '../sectionDependencies.js';
import { geocodeAddress, distanceMiles, cardinalDirection, buildAddressString } from '../geocoder.js';
import { getNeighborhoodBoundaryFeatures, formatLocationContextBlock } from '../neighborhoodContext.js';
import { getRunsForCase } from '../orchestrator/generationOrchestrator.js';
import {
  saveCaseProjection,
  getCaseProjection,
  listCaseProjections,
  deleteCanonicalCaseRecord,
  updateCaseFactProvenance,
  getCaseFactProvenance,
  runCanonicalBackfill,
  getCanonicalBackfillStatus,
} from '../caseRecord/caseRecordService.js';
import { PIPELINE_STAGES, evaluatePipelineTransition } from '../caseRecord/workflowStateMachine.js';
import { detectFactConflicts } from '../factIntegrity/factConflictEngine.js';
import { evaluatePreDraftGate } from '../factIntegrity/preDraftGate.js';
import { buildFactDecisionQueue, resolveFactDecision } from '../factIntegrity/factDecisionQueue.js';
import { evaluateCaseApprovalGate } from '../qc/caseApprovalGate.js';
import log from '../logger.js';

// ── Pipeline stages constant ──────────────────────────────────────────────────
const CASE_STATUSES = ['active', 'submitted', 'archived'];
const QC_GATED_CASE_STATUSES = new Set(['submitted']);
const QC_GATED_PIPELINE_STAGES = new Set(['approved', 'inserting', 'complete']);

const createCaseSchema = z.object({
  address: z.string().max(240).optional(),
  borrower: z.string().max(180).optional(),
  notes: z.string().max(1000).optional(),
  formType: z.string().max(40).optional(),
  unresolvedIssues: z.array(z.string().max(240)).max(100).optional(),
}).passthrough();

const updateCaseSchema = z.object({
  address: z.string().max(240).optional(),
  borrower: z.string().max(180).optional(),
  notes: z.string().max(1000).optional(),
  formType: z.string().max(40).optional(),
  assignmentPurpose: z.string().optional(),
  loanProgram: z.string().optional(),
  propertyType: z.string().optional(),
  occupancyType: z.string().optional(),
  reportConditionMode: z.string().optional(),
  subjectCondition: z.string().optional(),
  marketType: z.string().optional(),
  clientName: z.string().max(200).optional(),
  lenderName: z.string().max(200).optional(),
  amcName: z.string().max(200).optional(),
  state: z.string().max(50).optional(),
  county: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  marketArea: z.string().max(200).optional(),
  neighborhood: z.string().max(200).optional(),
  assignmentNotes: z.string().max(2000).optional(),
  unresolvedIssues: z.array(z.string().max(240)).max(100).optional(),
}).passthrough();

const statusSchema = z.object({
  status: z.enum(CASE_STATUSES),
});

const pipelineSchema = z.object({
  stage: z.enum(PIPELINE_STAGES),
});

const workflowStatusSchema = z.object({
  workflowStatus: z.string().min(1).max(40),
});

const factsSchema = z.object({}).passthrough();
const resolveFactDecisionSchema = z.object({
  factPath: z.string().min(1).max(180),
  selectedValue: z.string().min(1).max(4000),
  sourceType: z.enum(['manual', 'canonical', 'extracted']).optional(),
  sourceId: z.string().max(180).optional().nullable(),
  selectedFactId: z.string().uuid().optional().nullable(),
  rejectOtherPending: z.boolean().optional(),
  note: z.string().max(1000).optional(),
});

const factSourcesSchema = z.object({
  sources: z.record(z.unknown()).optional(),
  replace: z.boolean().optional(),
}).passthrough();

const migrationBackfillSchema = z.object({
  caseIds: z.array(z.string().regex(/^[a-f0-9]{8}$/i)).max(500).optional(),
  verifyAfterWrite: z.boolean().optional(),
  limit: z.number().int().min(1).max(5000).optional(),
}).passthrough();

const geocodeSchema = z.object({
  subjectAddress: z.string().max(240).optional(),
}).passthrough();

const missingFactsBatchSchema = z.object({
  fieldIds: z.array(z.string().max(80)).max(200).optional(),
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

// ── Router ────────────────────────────────────────────────────────────────────
function safeDeleteCaseRecord(caseId) {
  try {
    deleteCanonicalCaseRecord(caseId);
  } catch (err) {
    log.warn('case-record:delete-failed', { caseId, error: err.message });
  }
}

function sanitizeUnresolvedIssues(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const sanitized = [];

  for (const raw of input) {
    const text = trimText(raw, 240);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sanitized.push(text);
    if (sanitized.length >= 100) break;
  }
  return sanitized;
}

function sanitizeFactSources(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let count = 0;

  for (const [factPathRaw, value] of Object.entries(raw)) {
    if (count >= 400) break;
    const factPath = trimText(factPathRaw, 180);
    if (!factPath) continue;

    if (value === null) {
      out[factPath] = null;
      count++;
      continue;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;

    const sourceEntry = {
      sourceType: trimText(value.sourceType, 60),
      sourceId: trimText(value.sourceId, 180),
      docType: trimText(value.docType, 100),
      page: trimText(value.page, 40),
      confidence: trimText(value.confidence, 20).toLowerCase(),
      quote: trimText(value.quote, 2000),
      note: trimText(value.note, 600),
      updatedAt: new Date().toISOString(),
    };

    if (!sourceEntry.sourceType) delete sourceEntry.sourceType;
    if (!sourceEntry.sourceId) delete sourceEntry.sourceId;
    if (!sourceEntry.docType) delete sourceEntry.docType;
    if (!sourceEntry.page) delete sourceEntry.page;
    if (!sourceEntry.confidence) delete sourceEntry.confidence;
    if (!sourceEntry.quote) delete sourceEntry.quote;
    if (!sourceEntry.note) delete sourceEntry.note;

    out[factPath] = sourceEntry;
    count++;
  }

  return out;
}

const router = Router();

/**
 * router.param('caseId')
 * Validates the caseId format and attaches req.caseDir for all /:caseId routes.
 * Note: app.param() does NOT propagate to mounted routers — this is required here.
 */
router.param('caseId', (req, res, next, caseId) => {
  const cd = resolveCaseDir(caseId);
  if (!cd) return res.status(400).json({ ok: false, error: 'Invalid caseId format' });
  req.caseDir = cd;
  next();
});

// ── POST / and /create — Create case ─────────────────────────────────────────
function createCaseHandler(req, res) {
  const body = parsePayload(createCaseSchema, req.body || {}, res);
  if (!body) return;

  try {
    const requestedFormType = String(body.formType || '').trim().toLowerCase() || DEFAULT_FORM_TYPE;

    // Scope enforcement: block new cases for deferred form types
    if (isDeferredForm(requestedFormType)) {
      logDeferredAccess(requestedFormType, 'POST /api/cases/create', log);
      return res.status(400).json({
        ok:        false,
        supported: false,
        formType:  requestedFormType,
        scope:     'deferred',
        message:   `Cannot create a new case for form type "${requestedFormType}". This form type is outside active production scope. Active forms: ${ACTIVE_FORMS.join(', ')}.`,
      });
    }

    let caseId = '', caseDir = '';
    do {
      caseId  = uuidv4().replace(/-/g, '').slice(0, 8);
      caseDir = casePath(caseId);
    } while (fs.existsSync(caseDir));

    const baseMeta = {
      caseId,
      address:       trimText(body.address,  240),
      borrower:      trimText(body.borrower, 180),
      notes:         trimText(body.notes,    1000),
      formType:      normalizeFormType(body.formType),
      status:        'active',
      pipelineStage: 'intake',
      unresolvedIssues: sanitizeUnresolvedIssues(body.unresolvedIssues),
      createdAt:     new Date().toISOString(),
      updatedAt:     new Date().toISOString(),
    };

    const assignmentFields = extractMetaFields(body, trimText);
    const meta = applyMetaDefaults({ ...baseMeta, ...assignmentFields });

    fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });
    const projection = saveCaseProjection({
      caseId,
      meta,
      facts: {},
      provenance: {},
      outputs: {},
      history: {},
      docText: {},
    });
    res.json({ ok: true, caseId, meta: projection.meta });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

router.post('/', createCaseHandler);
router.post('/create', createCaseHandler);

// ── GET / — List cases ────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  try {
    const cases = listCaseProjections().map(c => c.meta);
    res.json({ ok: true, cases });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /records — List canonical case headers ────────────────────────────────
router.get('/records', (_req, res) => {
  try {
    const records = listCaseProjections().map(c => c.caseRecord);
    const headers = records.map(r => r.header);
    res.json({ ok: true, count: records.length, headers });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /:caseId/record — Canonical case projection ──────────────────────────
router.get('/migration/status', (req, res) => {
  try {
    const includeIntegrity = ['1', 'true', 'yes'].includes(String(req.query.integrity || '').toLowerCase());
    const requestedLimit = Number.parseInt(String(req.query.integrityLimit || ''), 10);
    const integrityLimit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 5000)
      : null;

    const status = getCanonicalBackfillStatus({ includeIntegrity, integrityLimit });
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/migration/backfill', (req, res) => {
  const body = parsePayload(migrationBackfillSchema, req.body || {}, res);
  if (!body) return;

  try {
    const result = runCanonicalBackfill({
      caseIds: body.caseIds || null,
      verifyAfterWrite: body.verifyAfterWrite !== false,
      limit: body.limit || null,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:caseId/record', (req, res) => {
  try {
    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({
      ok: true,
      caseId: req.params.caseId,
      record: projection.caseRecord,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:caseId/fact-sources', (req, res) => {
  try {
    const sources = getCaseFactProvenance(req.params.caseId);
    if (!sources) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({
      ok: true,
      caseId: req.params.caseId,
      sources,
      count: Object.keys(sources).length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/:caseId/fact-sources', (req, res) => {
  const body = parsePayload(factSourcesSchema, req.body || {}, res);
  if (!body) return;

  try {
    const incoming = sanitizeFactSources(body.sources || {});
    const replace = Boolean(body.replace);

    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    const merged = replace
      ? {}
      : { ...(projection.provenance || {}) };

    for (const [factPath, sourceData] of Object.entries(incoming)) {
      if (sourceData === null) {
        delete merged[factPath];
        continue;
      }
      merged[factPath] = sourceData;
    }

    const updated = updateCaseFactProvenance(req.params.caseId, merged, { replace: true });
    if (!updated) return res.status(404).json({ ok: false, error: 'Case not found' });

    res.json({
      ok: true,
      caseId: req.params.caseId,
      sources: updated.provenance || {},
      count: Object.keys(updated.provenance || {}).length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /:caseId — Load case ──────────────────────────────────────────────────
router.get('/:caseId/fact-conflicts', (req, res) => {
  try {
    const report = detectFactConflicts(req.params.caseId);
    if (!report) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({ ok: true, ...report });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:caseId/fact-review-queue', (req, res) => {
  try {
    const queue = buildFactDecisionQueue(req.params.caseId);
    if (!queue) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({ ok: true, queue });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:caseId/fact-review-queue/resolve', (req, res) => {
  const body = parsePayload(resolveFactDecisionSchema, req.body || {}, res);
  if (!body) return;

  try {
    const result = resolveFactDecision({
      caseId: req.params.caseId,
      factPath: body.factPath,
      selectedValue: body.selectedValue,
      sourceType: body.sourceType || 'manual',
      sourceId: body.sourceId || null,
      selectedFactId: body.selectedFactId || null,
      rejectOtherPending: body.rejectOtherPending !== false,
      note: body.note || '',
    });
    if (!result) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:caseId/pre-draft-check', (req, res) => {
  try {
    const formType = trimText(req.query.formType, 40) || null;
    const sectionIds = trimText(req.query.sections, 4000)
      .split(',')
      .map(v => trimText(v, 80))
      .filter(Boolean);

    const gate = evaluatePreDraftGate({
      caseId: req.params.caseId,
      formType,
      sectionIds: sectionIds.length ? sectionIds : null,
    });
    if (!gate) return res.status(404).json({ ok: false, error: 'Case not found' });
    const decisionQueue = buildFactDecisionQueue(req.params.caseId);
    res.json({
      ok: true,
      gate,
      factReviewQueuePath: `/api/cases/${req.params.caseId}/fact-review-queue`,
      decisionQueueSummary: decisionQueue?.summary || null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:caseId', (req, res) => {
  try {
    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });
    const { meta, facts, provenance, outputs, docSummary, scopeMeta, caseRecord } = projection;
    if (scopeMeta.scope === 'deferred') {
      log.warn(`[SCOPE] Legacy deferred-form case loaded — caseId="${req.params.caseId}" formType="${meta.formType}"`);
    }

    res.json({
      ok: true, meta, facts, provenance, docSummary, outputs, caseRecord,
      scopeStatus:    scopeMeta.scope,
      scopeSupported: scopeMeta.supported,
      ...(scopeMeta.scope === 'deferred' ? {
        scopeWarning: {
          message:  `This case uses form type "${meta.formType}" which is outside active production scope. Generation and insertion are not available. Active forms: ${ACTIVE_FORMS.join(', ')}.`,
          formType: meta.formType,
        },
      } : {}),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /:caseId — Update case metadata ─────────────────────────────────────
router.patch('/:caseId', (req, res) => {
  const body = parsePayload(updateCaseSchema, req.body || {}, res);
  if (!body) return;

  try {
    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    let meta = { ...(projection.meta || {}) };

    meta.address  = trimText(body.address  ?? meta.address,  240);
    meta.borrower = trimText(body.borrower ?? meta.borrower, 180);
    if (body.notes    !== undefined) meta.notes    = trimText(body.notes, 1000);
    if (body.formType !== undefined) meta.formType = normalizeFormType(body.formType);

    const assignmentFields = extractMetaFields(body, trimText);
    meta = { ...meta, ...assignmentFields };
    if (body.unresolvedIssues !== undefined) {
      meta.unresolvedIssues = sanitizeUnresolvedIssues(body.unresolvedIssues);
    }
    meta.updatedAt = new Date().toISOString();

    const updated = saveCaseProjection({
      caseId: req.params.caseId,
      meta,
      facts: projection.facts || {},
      provenance: projection.provenance || {},
      outputs: projection.outputs || {},
      history: projection.history || {},
      docText: projection.docText || {},
    });
    res.json({ ok: true, meta: updated.meta || applyMetaDefaults(meta) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /:caseId — Delete case ─────────────────────────────────────────────
router.delete('/:caseId', (req, res) => {
  if (!parsePayload(emptyMutationSchema, req.body || {}, res)) return;

  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    fs.rmSync(cd, { recursive: true, force: true });
    safeDeleteCaseRecord(req.params.caseId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /:caseId/status — Set case status ───────────────────────────────────
router.patch('/:caseId/status', (req, res) => {
  const body = parsePayload(statusSchema, req.body || {}, res);
  if (!body) return;

  try {
    const nextStatus = trimText(body.status, 20).toLowerCase() || 'active';
    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });
    const meta = { ...(projection.meta || {}) };
    if (QC_GATED_CASE_STATUSES.has(nextStatus) && nextStatus !== (meta.status || '')) {
      const gate = evaluateCaseApprovalGate(req.params.caseId);
      if (!gate.ok) {
        return res.status(409).json({
          ok: false,
          code: gate.code,
          error: gate.message,
          status: nextStatus,
          qcGate: gate,
        });
      }
    }
    meta.status    = nextStatus;
    meta.updatedAt = new Date().toISOString();
    const updated = saveCaseProjection({
      caseId: req.params.caseId,
      meta,
      facts: projection.facts || {},
      provenance: projection.provenance || {},
      outputs: projection.outputs || {},
      history: projection.history || {},
      docText: projection.docText || {},
    });
    res.json({ ok: true, meta: updated.meta || meta });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /:caseId/pipeline — Advance pipeline stage ─────────────────────────
router.patch('/:caseId/pipeline', (req, res) => {
  const body = parsePayload(pipelineSchema, req.body || {}, res);
  if (!body) return;

  try {
    const stage = trimText(body.stage, 20).toLowerCase();
    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });
    const meta = { ...(projection.meta || {}) };
    const transition = evaluatePipelineTransition({
      currentStage: meta.pipelineStage || 'intake',
      nextStage: stage,
      caseStatus: meta.status || 'active',
    });
    if (!transition.ok) {
      return res.status(409).json({
        ok: false,
        code: transition.code,
        error: transition.message,
        fromStage: transition.fromStage,
        toStage: transition.toStage,
        allowedNextStages: transition.allowedNextStages,
      });
    }
    if (QC_GATED_PIPELINE_STAGES.has(stage) && stage !== (meta.pipelineStage || '')) {
      const gate = evaluateCaseApprovalGate(req.params.caseId);
      if (!gate.ok) {
        return res.status(409).json({
          ok: false,
          code: gate.code,
          error: gate.message,
          fromStage: meta.pipelineStage || 'intake',
          toStage: stage,
          qcGate: gate,
        });
      }
    }

    meta.pipelineStage = stage;
    meta.updatedAt     = new Date().toISOString();
    if (!Array.isArray(meta.pipelineHistory)) meta.pipelineHistory = [];
    meta.pipelineHistory.push({ stage, at: meta.updatedAt });
    const updated = saveCaseProjection({
      caseId: req.params.caseId,
      meta,
      facts: projection.facts || {},
      provenance: projection.provenance || {},
      outputs: projection.outputs || {},
      history: projection.history || {},
      docText: projection.docText || {},
    });
    res.json({
      ok: true,
      pipelineStage: stage,
      meta: updated?.meta || meta,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /:caseId/workflow-status — Set workflowStatus ──────────────────────
router.patch('/:caseId/workflow-status', (req, res) => {
  const body = parsePayload(workflowStatusSchema, req.body || {}, res);
  if (!body) return;

  try {
    const status = trimText(body.workflowStatus, 40);
    if (!isValidWorkflowStatus(status)) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_WORKFLOW_STATUS',
        error: `Invalid workflowStatus. Valid values: ${[
          'facts_incomplete', 'ready_for_generation', 'generation_in_progress',
          'sections_drafted', 'awaiting_review', 'automation_ready',
          'insertion_in_progress', 'verified', 'exception_flagged',
        ].join(', ')}`,
      });
    }

    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });
    const meta = { ...(projection.meta || {}) };
    meta.workflowStatus = status;
    meta.updatedAt      = new Date().toISOString();
    const updated = saveCaseProjection({
      caseId: req.params.caseId,
      meta,
      facts: projection.facts || {},
      provenance: projection.provenance || {},
      outputs: projection.outputs || {},
      history: projection.history || {},
      docText: projection.docText || {},
    });
    res.json({
      ok: true,
      workflowStatus: status,
      meta: updated?.meta || applyMetaDefaults(meta),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PUT /:caseId/facts — Save/merge facts ─────────────────────────────────────
router.put('/:caseId/facts', (req, res) => {
  const body = parsePayload(factsSchema, req.body || {}, res);
  if (!body) return;

  try {
    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    const updated = { ...(projection.facts || {}), ...body, updatedAt: new Date().toISOString() };
    const meta = { ...(projection.meta || {}) };
    meta.updatedAt = new Date().toISOString();

    saveCaseProjection({
      caseId: req.params.caseId,
      meta,
      facts: updated,
      provenance: projection.provenance || {},
      outputs: projection.outputs || {},
      history: projection.history || {},
      docText: projection.docText || {},
    });
    res.json({ ok: true, facts: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /:caseId/history — Section version history ────────────────────────────
router.get('/:caseId/history', (req, res) => {
  try {
    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({ ok: true, history: projection.history || {} });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /:caseId/generation-runs — List orchestrator runs ─────────────────────
router.get('/:caseId/generation-runs', (req, res) => {
  try {
    const runs = getRunsForCase(req.params.caseId);
    res.json({ ok: true, runs, count: runs.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /:caseId/geocode — Geocode subject + comps ───────────────────────────
router.post('/:caseId/geocode', async (req, res) => {
  const body = parsePayload(geocodeSchema, req.body || {}, res);
  if (!body) return;

  try {
    const cd = req.caseDir;
    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });

    const facts = projection.facts || {};
    const fv    = (key) => { const f = facts[key]; return f ? String(f?.value ?? f ?? '').trim() : ''; };

    const subjectAddress =
      buildAddressString(facts, 'subject') ||
      (() => {
        const street = fv('subject_address');
        if (!street) return null;
        if (street.includes(',')) return street;
        const city  = fv('subject_city');
        const state = fv('subject_state');
        const zip   = fv('subject_zip');
        return [street, city, state, zip].filter(Boolean).join(', ');
      })() ||
      (body.subjectAddress ? String(body.subjectAddress).trim() : null);

    if (!subjectAddress) {
      return res.status(400).json({
        ok:    false,
        error: 'No subject address found in facts. Extract facts first or provide subjectAddress in request body.',
      });
    }

    const subjectResult = await geocodeAddress(subjectAddress);
    if (!subjectResult) {
      return res.status(422).json({
        ok:    false,
        error: `Could not geocode subject address: "${subjectAddress}". Check the address format.`,
      });
    }

    const compsData = [];
    const rawComps  = Array.isArray(facts.comps) ? facts.comps : [];

    for (let i = 0; i < rawComps.length; i++) {
      const comp = rawComps[i];
      const v    = (key) => { const f = comp[key]; return f ? String(f?.value ?? f ?? '').trim() : ''; };
      const street   = v('address');
      const city     = v('city')  || subjectResult.city  || '';
      const state    = v('state') || subjectResult.state || '';
      const fullAddr = street ? [street, city, state].filter(Boolean).join(', ') : null;

      if (!fullAddr) {
        compsData.push({ index: i + 1, address: null, result: null, distance: null, direction: null, error: 'No address in comp data' });
        continue;
      }

      const compResult = await geocodeAddress(fullAddr);
      let distance = null, direction = null;
      if (compResult) {
        distance  = distanceMiles(subjectResult.lat, subjectResult.lng, compResult.lat, compResult.lng);
        direction = cardinalDirection(subjectResult.lat, subjectResult.lng, compResult.lat, compResult.lng);
      }
      compsData.push({ index: i + 1, address: fullAddr, result: compResult, distance, direction });
    }

    const geocodeData = {
      subject:    { address: subjectAddress, result: subjectResult },
      comps:      compsData,
      geocodedAt: new Date().toISOString(),
    };
    writeJSON(path.join(cd, 'geocode.json'), geocodeData);

    res.json({
      ok:      true,
      subject: {
        address: subjectAddress,
        lat:     subjectResult.lat,
        lng:     subjectResult.lng,
        city:    subjectResult.city,
        county:  subjectResult.county,
        state:   subjectResult.state,
      },
      comps: compsData.map(c => ({
        index:     c.index,
        address:   c.address,
        distance:  c.distance,
        direction: c.direction,
        city:      c.result?.city || null,
        error:     c.error || null,
      })),
      geocodedAt: geocodeData.geocodedAt,
    });
  } catch (err) {
    log.error('[/geocode]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /:caseId/location-context — Geocode + Overpass boundary features ──────
router.get('/:caseId/location-context', async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const radius      = Math.max(0.5, Math.min(5, parseFloat(req.query?.radius) || 1.5));
    const geocodeData = readJSON(path.join(cd, 'geocode.json'), null);

    if (!geocodeData) {
      return res.status(400).json({
        ok:    false,
        error: 'No geocode data found. Run POST /api/cases/:caseId/geocode first.',
        hint:  `POST /api/cases/${req.params.caseId}/geocode`,
      });
    }

    const { lat, lng } = geocodeData.subject?.result || {};
    if (!lat || !lng) {
      return res.status(422).json({
        ok:    false,
        error: 'Geocode data is missing subject coordinates. Re-run geocode.',
      });
    }

    const boundaryFeatures    = await getNeighborhoodBoundaryFeatures(lat, lng, radius);
    const locationContextBlock = formatLocationContextBlock({
      subject:          geocodeData.subject,
      comps:            geocodeData.comps || [],
      boundaryFeatures,
    });

    res.json({
      ok:                   true,
      subject:              geocodeData.subject,
      comps:                geocodeData.comps,
      boundaryFeatures,
      locationContextBlock,
      geocodedAt:           geocodeData.geocodedAt,
      radiusMiles:          radius,
    });
  } catch (err) {
    log.error('[/location-context]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /:caseId/missing-facts/:fieldId — Single-field missing facts ───────────
router.get('/:caseId/missing-facts/:fieldId', (req, res) => {
  try {
    const fieldId = trimText(req.params.fieldId, 80);
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId required' });

    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });
    const facts     = projection.facts || {};
    const missing   = getMissingFacts(fieldId, facts);
    const formatted = formatMissingFactsForUI(missing);
    res.json({ ok: true, fieldId, ...formatted });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /:caseId/missing-facts — Batch missing facts check ───────────────────
router.post('/:caseId/missing-facts', (req, res) => {
  const body = parsePayload(missingFactsBatchSchema, req.body || {}, res);
  if (!body) return;

  try {
    const fieldIds = Array.isArray(body.fieldIds) ? body.fieldIds : [];
    if (!fieldIds.length) return res.json({ ok: true, warnings: [] });

    const projection = getCaseProjection(req.params.caseId);
    if (!projection) return res.status(404).json({ ok: false, error: 'Case not found' });
    const facts       = projection.facts || {};
    const allWarnings = [];

    for (const rawFieldId of fieldIds) {
      const fieldId = trimText(rawFieldId, 80);
      if (!fieldId) continue;
      try {
        const missing   = getMissingFacts(fieldId, facts);
        const formatted = formatMissingFactsForUI(missing);
        for (const label of (formatted.required || [])) {
          allWarnings.push({ fieldId, field: label, severity: 'required',    message: `Missing required fact: ${label}` });
        }
        for (const label of (formatted.recommended || [])) {
          allWarnings.push({ fieldId, field: label, severity: 'recommended', message: `Missing recommended fact: ${label}` });
        }
      } catch { /* non-fatal: skip fields with no dependency config */ }
    }

    res.json({ ok: true, warnings: allWarnings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;

