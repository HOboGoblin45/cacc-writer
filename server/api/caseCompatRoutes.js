/**
 * server/api/caseCompatRoutes.js
 * --------------------------------
 * Compatibility routes for legacy /api/cases/* endpoints that have not yet
 * been absorbed into the newer feature routers.
 *
 * This file exists to keep the server entrypoint free of business logic.
 *
 * Mounted at: /api/cases
 */

import { Router } from 'express';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

import { resolveCaseDir, normalizeFormType } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import {
  trimText,
  asArray,
  aiText,
  parseJSONObject,
  normalizeQuestions,
  normalizeGrade,
} from '../utils/textUtils.js';
import { upload, ensureAI, readUploadedFile, cleanupUploadedFile } from '../utils/middleware.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';
import { getFormConfig } from '../../forms/index.js';

import { CORE_SECTIONS } from '../config/coreSections.js';
import { ACTIVE_FORMS, isDeferredForm, logDeferredAccess } from '../config/productionScope.js';
import { client, MODEL, callAI } from '../openaiClient.js';
import { addApprovedNarrative } from '../knowledgeBase.js';
import {
  listAllDestinations,
  getDestination,
  getTargetSoftware,
  getFallbackStrategy,
} from '../destinationRegistry.js';
import {
  evaluateInsertionQcGate,
  prepareInsertionRun,
  executeInsertionRun,
} from '../insertion/insertionRunEngine.js';
import { getInsertionRunItems } from '../insertion/insertionRepo.js';
import { inferTargetSoftware, resolveMapping } from '../insertion/destinationMapper.js';
import { buildReviewMessages } from '../promptBuilder.js';
import { onSectionApproved, onSectionRejected } from '../learning/feedbackLoopService.js';
import { getCaseProjection, saveCaseProjection } from '../caseRecord/caseRecordService.js';
import log from '../logger.js';
import { sendErrorResponse } from '../utils/errorResponse.js';
import { saveUserApprovedSection } from '../retrieval/userScopedRetrieval.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const VALID_SECTION_STATUSES = ['not_started', 'drafted', 'reviewed', 'approved', 'inserted', 'verified', 'copied', 'error'];

const gradeSchema = z.object({
  fieldId: z.string().max(80).optional(),
  text: z.string().max(8000).optional(),
}).passthrough();
const uploadSchema = z.object({
  docType: z.string().max(60).optional(),
}).passthrough();
const extractFactsSchema = z.object({
  answers: z.record(z.unknown()).optional(),
}).passthrough();
const questionnaireSchema = z.object({}).strict();

const feedbackSchema = z.object({
  fieldId: z.string().max(80),
  fieldTitle: z.string().max(160).optional(),
  originalText: z.string().max(8000).optional(),
  editedText: z.string().max(8000).optional(),
  text: z.string().max(8000).optional(),
  action: z.string().max(40).optional(),
  approved: z.boolean().optional(),
  rating: z.string().max(20).optional(),
}).passthrough();

const reviewSchema = z.object({
  fieldId: z.string().max(80),
  text: z.string().max(8000),
}).passthrough();

const sectionStatusSchema = z.object({
  status: z.enum(VALID_SECTION_STATUSES),
  notes: z.string().max(500).optional(),
});

const patchOutputSchema = z.object({
  text: z.string().max(16000),
});

const insertSectionSchema = z.object({
  text: z.string().max(16000).optional(),
  generationRunId: z.string().max(80).optional(),
  skipQcBlockers: z.boolean().optional(),
}).passthrough();

const copySectionSchema = z.object({
  text: z.string().max(16000).optional(),
}).passthrough();

const insertAllSchema = z.object({
  generationRunId: z.string().max(80).optional(),
  skipQcBlockers: z.boolean().optional(),
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

function ensureCaseDir(req, res) {
  const cd = req.caseDir;
  if (!fs.existsSync(cd)) {
    res.status(404).json({ ok: false, error: 'Case not found' });
    return null;
  }
  return cd;
}

function ensureCaseProjection(req, res) {
  const projection = getCaseProjection(req.params.caseId);
  if (!projection) {
    res.status(404).json({ ok: false, error: 'Case not found' });
    return null;
  }
  return projection;
}

function getCaseRuntime(req, res) {
  const projection = ensureCaseProjection(req, res);
  if (!projection) return null;
  const formType = normalizeFormType(projection.meta?.formType);
  return {
    projection,
    formType,
    formConfig: getFormConfig(formType),
    meta: projection.meta || {},
    facts: projection.facts || {},
    outputs: projection.outputs || {},
    history: projection.history || {},
    docText: projection.docText || {},
    provenance: projection.provenance || {},
  };
}

function saveCaseRuntime(caseId, runtime, overrides = {}) {
  const projection = runtime?.projection || {};
  return saveCaseProjection({
    caseId,
    meta: overrides.meta ?? runtime.meta ?? projection.meta ?? {},
    facts: overrides.facts ?? runtime.facts ?? projection.facts ?? {},
    provenance: overrides.provenance ?? runtime.provenance ?? projection.provenance ?? {},
    outputs: overrides.outputs ?? runtime.outputs ?? projection.outputs ?? {},
    history: overrides.history ?? runtime.history ?? projection.history ?? {},
    docText: overrides.docText ?? runtime.docText ?? projection.docText ?? {},
  });
}

function parseReviewResult(raw) {
  const parsed = parseJSONObject(raw);
  if (parsed) return parsed;

  const cleaned = String(raw || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const obj = JSON.parse(cleaned);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

const router = Router();

router.param('caseId', (req, res, next, caseId) => {
  const cd = resolveCaseDir(caseId);
  if (!cd) return res.status(400).json({ ok: false, error: 'Invalid caseId format' });
  req.caseDir = cd;
  next();
});

router.post('/:caseId/upload', upload.single('file'), async (req, res) => {
  const body = parsePayload(uploadSchema, req.body || {}, res);
  if (!body) return;

  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const pdfBuffer = await readUploadedFile(req.file);

    const isPdf = req.file.mimetype === 'application/pdf'
      || String(req.file.originalname || '').toLowerCase().endsWith('.pdf');

    if (!isPdf) return res.status(400).json({ ok: false, error: 'Only PDF files are allowed' });

    const docType = trimText(body.docType || 'unknown', 60).replace(/[^a-z0-9_-]/gi, '_');
    fs.mkdirSync(path.join(cd, 'documents'), { recursive: true });
    fs.copyFileSync(req.file.path, path.join(cd, 'documents', docType + '.pdf'));

    let extractedText = '';
    let pageCount = 0;
    try {
      const { text, method } = await extractPdfText(pdfBuffer, client, MODEL);
      extractedText = text || '';
      try {
        const p = await pdfParse(pdfBuffer);
        pageCount = p.numpages || 0;
      } catch {
        pageCount = 0;
      }
      log.info('upload:ocr', { method, chars: extractedText.length, docType });
    } catch (ocrErr) {
      log.warn('upload:ocr-failed', { error: ocrErr.message });
      extractedText = '[PDF text extraction failed]';
    }

    extractedText = extractedText
      .replace(/\n{4,}/g, '\n\n')
      .replace(/[ \t]{3,}/g, '  ')
      .trim();

    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;

    const docText = { ...(runtime.docText || {}) };
    docText[docType] = extractedText;

    const meta = { ...(runtime.meta || {}) };
    meta.updatedAt = new Date().toISOString();
    if (!meta.docs) meta.docs = {};
    meta.docs[docType] = {
      uploadedAt: new Date().toISOString(),
      pages: pageCount,
      bytes: req.file.size,
    };
    saveCaseRuntime(req.params.caseId, runtime, { meta, docText });

    res.json({
      ok: true,
      docType,
      wordCount: extractedText.split(/\s+/).filter(Boolean).length,
      pages: pageCount,
      preview: extractedText.slice(0, 400),
    });
  } catch (err) {
    return sendErrorResponse(res, err);
  } finally {
    await cleanupUploadedFile(req.file);
  }
});

router.post('/:caseId/extract-facts', ensureAI, async (req, res) => {
  const body = parsePayload(extractFactsSchema, req.body || {}, res);
  if (!body) return;

  try {
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;

    const docText = runtime.docText || {};
    const existingFacts = runtime.facts || {};
    const answers = body.answers || {};
    const { formType, formConfig } = runtime;

    if (!Object.keys(docText).length && !Object.keys(answers).length) {
      return res.status(400).json({ ok: false, error: 'No documents or answers. Upload PDFs first.' });
    }

    const docBlock = Object.entries(docText)
      .map(([t, x]) => '=== ' + t.toUpperCase() + ' ===\n' + String(x).slice(0, 5000))
      .join('\n\n');

    const ansBlock = Object.keys(answers).length
      ? '\n\nAPPRAISER ANSWERS:\n' + Object.entries(answers).map(([q, a]) => 'Q: ' + q + '\nA: ' + a).join('\n\n')
      : '';

    const prompt = (formConfig.extractContext || ('Appraisal data extractor for form ' + formType + '.'))
      + '\nReturn ONLY valid JSON. Use null for missing. confidence: high/medium/low.\n\nSCHEMA:\n'
      + JSON.stringify(formConfig.factsSchema || {}, null, 2)
      + '\n\nDOCUMENTS:\n'
      + docBlock
      + ansBlock
      + '\n\nReturn ONLY the JSON object.';

    const r = await client.responses.create({ model: MODEL, input: prompt });
    const facts = parseJSONObject(aiText(r)) || {};
    const merged = { ...existingFacts, ...facts, extractedAt: new Date().toISOString() };
    const meta = { ...(runtime.meta || {}), updatedAt: new Date().toISOString() };
    saveCaseRuntime(req.params.caseId, runtime, { meta, facts: merged });

    res.json({ ok: true, facts: merged });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to parse facts JSON: ' + err.message });
  }
});

router.post('/:caseId/questionnaire', ensureAI, async (req, res) => {
  if (!parsePayload(questionnaireSchema, req.body || {}, res)) return;

  try {
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;

    const facts = runtime.facts || {};
    const { formType, formConfig } = runtime;
    const priorities = asArray(formConfig.questionnairePriorities)
      .map((p, i) => (i + 1) + '. ' + p)
      .join('\n');

    const prompt = 'You are an appraisal assistant. Based on the facts below, generate 5-8 targeted questions to fill gaps.'
      + '\n\nFORM: ' + formType
      + '\nPRIORITIES:\n' + priorities
      + '\n\nFACTS:\n' + JSON.stringify(facts, null, 2)
      + '\n\nReturn JSON: { questions: [{id,question,priority,category}] }';

    const r = await client.responses.create({ model: MODEL, input: prompt });
    const parsed = parseJSONObject(aiText(r));
    res.json({ ok: true, questions: normalizeQuestions(parsed?.questions || []) });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.post('/:caseId/grade', ensureAI, async (req, res) => {
  const body = parsePayload(gradeSchema, req.body || {}, res);
  if (!body) return;

  try {
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;

    const outputs = runtime.outputs || {};
    const { formType } = runtime;

    const fieldId = trimText(body.fieldId, 80);
    const text = trimText(body.text, 8000) || outputs[fieldId]?.text || '';
    if (!text) return res.status(400).json({ ok: false, error: 'No text to grade' });

    const prompt = 'Grade this appraisal narrative. Return JSON: { score:0-100, grade:A/B/C/D/F, strengths:[str], weaknesses:[str], suggestions:[str], issues:[{severity,message}] }'
      + '\n\nFIELD: ' + fieldId
      + '\nFORM: ' + formType
      + '\n\nTEXT:\n' + text;

    const r = await client.responses.create({ model: MODEL, input: prompt });
    const grade = parseJSONObject(aiText(r));

    res.json({ ok: true, fieldId, grade: normalizeGrade(grade) });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.post('/:caseId/feedback', async (req, res) => {
  const body = parsePayload(feedbackSchema, req.body || {}, res);
  if (!body) return;

  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;

    const sid = trimText(body.fieldId, 80);
    const safeText = trimText(body.editedText || body.text, 8000);
    if (!sid || !safeText) {
      return res.status(400).json({ ok: false, error: 'fieldId and text/editedText are required' });
    }

    const isApproved = Boolean(body.approved) || body.rating === 'up';

    const feedbackFile = path.join(cd, 'feedback.json');
    const feedbackItems = readJSON(feedbackFile, []);
    feedbackItems.unshift({
      fieldId: sid,
      fieldTitle: body.fieldTitle || sid,
      originalText: trimText(body.originalText, 8000) || null,
      text: safeText,
      action: body.action || 'approve',
      approved: isApproved,
      rating: body.rating || null,
      createdAt: new Date().toISOString(),
    });
    writeJSON(feedbackFile, feedbackItems.slice(0, 50));

    let savedToKB = false;
    if (isApproved && safeText.length > 30) {
      try {
        await addApprovedNarrative({
          fieldId: sid,
          text: safeText,
          formType: runtime.formType,
          source: 'user-approved',
        });
        savedToKB = true;
      } catch (kbErr) {
        log.warn('feedback:kb-write-failed', { error: kbErr.message, fieldId: sid });
      }
    }

    // Propagate outcome to learning system feedback loop
    let feedbackLoopResult = null;
    try {
      if (isApproved) {
        feedbackLoopResult = onSectionApproved(req.params.caseId, sid);
      } else if (body.rating === 'down' || body.action === 'reject') {
        feedbackLoopResult = onSectionRejected(req.params.caseId, sid);
      }
    } catch (flErr) {
      log.warn('feedback:feedback-loop-failed', { error: flErr.message, fieldId: sid });
    }

    const meta = { ...(runtime.meta || {}) };
    meta.updatedAt = new Date().toISOString();
    saveCaseRuntime(req.params.caseId, runtime, { meta });

    res.json({ ok: true, saved: true, count: feedbackItems.length, savedToKB, feedbackLoop: feedbackLoopResult });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.post('/:caseId/review-section', ensureAI, async (req, res) => {
  const body = parsePayload(reviewSchema, req.body || {}, res);
  if (!body) return;

  try {
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;

    const fieldId = trimText(body.fieldId, 80);
    const draftText = trimText(body.text, 8000);

    const facts = runtime.facts || {};
    const { formType } = runtime;

    const reviewMessages = buildReviewMessages({ draftText, facts, fieldId, formType });
    const reviewRaw = await callAI(reviewMessages);
    const review = parseReviewResult(reviewRaw) || { revisedText: reviewRaw, issues: [], score: null };

    res.json({ ok: true, fieldId, review });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.patch('/:caseId/sections/:fieldId/status', (req, res) => {
  const body = parsePayload(sectionStatusSchema, req.body || {}, res);
  if (!body) return;

  try {
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;

    const fieldId = trimText(req.params.fieldId, 80);
    const newStatus = body.status;
    const now = new Date().toISOString();
    const outputs = { ...(runtime.outputs || {}) };
    const hasText = Boolean(outputs[fieldId]?.text);
    const isApprovedStatus = ['approved', 'inserted', 'verified'].includes(newStatus);
    if (!outputs[fieldId]) {
      outputs[fieldId] = {
        title: fieldId,
        text: '',
      };
    }
    outputs[fieldId].sectionStatus = newStatus;
    outputs[fieldId].status = newStatus;
    outputs[fieldId].updatedAt = now;
    outputs[fieldId].approved = isApprovedStatus && hasText;
    if (body.notes) outputs[fieldId].statusNote = trimText(body.notes, 500);

    const meta = { ...(runtime.meta || {}), updatedAt: now };
    saveCaseRuntime(req.params.caseId, runtime, { meta, outputs });

    // Save to user's personal KB when approved (multi-tenant voice learning)
    if (isApprovedStatus && hasText) {
      try {
        const userId = req.user?.userId || 'default';
        const formType = runtime.formType || meta.formType || '1004';
        saveUserApprovedSection(userId, {
          caseId: req.params.caseId,
          fieldId,
          formType,
          text: outputs[fieldId].text,
          county: runtime.facts?.subject?.county?.value,
          city: runtime.facts?.subject?.city?.value,
        });
      } catch (kbErr) {
        log.warn('user-kb:save-failed', { fieldId, error: kbErr.message });
      }
    }

    res.json({
      ok: true,
      fieldId,
      status: newStatus,
      sectionStatus: newStatus,
      approved: isApprovedStatus && hasText,
      updatedAt: now,
    });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.post('/:caseId/sections/:fieldId/copy', (req, res) => {
  const body = parsePayload(copySectionSchema, req.body || {}, res);
  if (!body) return;

  try {
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;

    const fieldId = trimText(req.params.fieldId, 80);
    const outputs = { ...(runtime.outputs || {}) };
    const text = trimText(body.text, 16000) || outputs[fieldId]?.text || '';
    if (!text) return res.status(400).json({ ok: false, error: 'No text to copy for field: ' + fieldId });

    const now = new Date().toISOString();
    outputs[fieldId] = {
      ...(outputs[fieldId] || { title: fieldId }),
      text,
      status: 'copied',
      sectionStatus: 'copied',
      copiedAt: now,
      updatedAt: now,
    };
    const meta = { ...(runtime.meta || {}), updatedAt: now };
    saveCaseRuntime(req.params.caseId, runtime, { meta, outputs });

    res.json({ ok: true, fieldId, text, charCount: text.length, status: 'copied', message: 'Text ready for manual paste' });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.get('/:caseId/sections/status', (req, res) => {
  try {
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;
    const { formType } = runtime;
    const outputs = runtime.outputs || {};

    const coreSections = CORE_SECTIONS[formType] || [];
    const sectionsArr = coreSections.map((sec) => {
      const st = outputs[sec.id]?.sectionStatus || outputs[sec.id]?.status || 'not_started';
      return {
        id: sec.id,
        title: sec.title,
        status: st,
        sectionStatus: st,
        approved: ['approved', 'inserted', 'verified'].includes(st),
        hasOutput: Boolean(outputs[sec.id]?.text),
        updatedAt: outputs[sec.id]?.updatedAt || null,
      };
    });

    const sections = Object.fromEntries(sectionsArr.map((sec) => [sec.id, sec]));
    res.json({
      ok: true,
      caseId: req.params.caseId,
      formType,
      sections,
      totalSections: sectionsArr.length,
      completedSections: sectionsArr.filter(sec => ['approved', 'inserted', 'verified'].includes(sec.status)).length,
    });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.get('/:caseId/destination-registry', (req, res) => {
  try {
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;
    const { formType } = runtime;
    const destinations = listAllDestinations(formType);

    const outputs = runtime.outputs || {};

    const fields = Object.fromEntries(destinations.map((d) => {
      const st = outputs[d.fieldId]?.sectionStatus || outputs[d.fieldId]?.status || 'not_started';
      return [d.fieldId, {
        ...d,
        sectionStatus: st,
        approved: ['approved', 'inserted', 'verified'].includes(st),
        hasText: Boolean(outputs[d.fieldId]?.text),
      }];
    }));

    const softwareMap = { '1004': 'aci', 'commercial': 'real_quantum' };
    const software = softwareMap[formType]
      || (destinations[0] ? getTargetSoftware(formType, destinations[0].fieldId) : null);

    res.json({
      ok: true,
      caseId: req.params.caseId,
      formType,
      software,
      destinations,
      fields,
      fieldCount: destinations.length,
      count: destinations.length,
    });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.get('/:caseId/exceptions', (req, res) => {
  try {
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;
    const outputs = runtime.outputs || {};

    const coreSections = CORE_SECTIONS[runtime.formType] || [];
    const titleMap = Object.fromEntries(coreSections.map(s => [s.id, s.title]));

    const exceptionMap = {};
    Object.entries(outputs).forEach(([id, value]) => {
      if (id === 'updatedAt' || typeof value !== 'object' || !value) return;
      const sectionStatus = value.sectionStatus || value.status;
      if (sectionStatus === 'error' || sectionStatus === 'copied') {
        if (!exceptionMap[id]) {
          exceptionMap[id] = {
            status: sectionStatus,
            notes: value.statusNote || value.notes || null,
            updatedAt: value.updatedAt || null,
          };
        }
      }
    });

    const exceptions = Object.entries(exceptionMap).map(([id, value]) => ({
      fieldId: id,
      title: titleMap[id] || id,
      status: value.status,
      sectionStatus: value.status,
      statusNote: value.notes || null,
      notes: value.notes || null,
      hasText: Boolean(outputs[id]?.text),
      updatedAt: value.updatedAt,
    }));

    res.json({ ok: true, caseId: req.params.caseId, exceptions, count: exceptions.length });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.post('/:caseId/sections/:fieldId/insert', (req, res) => {
  const body = parsePayload(insertSectionSchema, req.body || {}, res);
  if (!body) return;

  try {
    res.setHeader('X-Deprecated', 'true');
    res.setHeader('X-Deprecation-Notice', 'Use POST /api/insertion/run instead');
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;

    const fieldId = trimText(req.params.fieldId, 80);
    const outputs = { ...(runtime.outputs || {}) };
    const text = trimText(body.text, 16000) || outputs[fieldId]?.text || '';
    if (!text) return res.status(400).json({ ok: false, error: 'No text to insert for field: ' + fieldId });

    const generationRunId = trimText(body.generationRunId, 80) || null;
    const skipQcBlockers = Boolean(body.skipQcBlockers);
    const qcGate = evaluateInsertionQcGate({
      caseId: req.params.caseId,
      generationRunId,
      config: {
        requireQcRun: true,
        requireFreshQcForGeneration: Boolean(generationRunId),
      },
    });
    const canBypassQcGate = skipQcBlockers && qcGate.overrideAllowed !== false;
    if (!qcGate.passed && !canBypassQcGate) {
      return res.status(409).json({
        ok: false,
        code: 'QC_GATE_BLOCKED',
        error: 'QC gate blocked insertion',
        qcGate,
        overrideAllowed: qcGate.overrideAllowed !== false,
        message: qcGate.overrideAllowed === false
          ? 'Run QC for this case before insertion.'
          : 'Resolve QC blockers or set skipQcBlockers=true to bypass.',
      });
    }

    const { formType } = runtime;
    const destination = getDestination(formType, fieldId);
    const now = new Date().toISOString();
    outputs[fieldId] = {
      ...(outputs[fieldId] || { title: fieldId }),
      text,
      status: 'inserted',
      sectionStatus: 'inserted',
      insertedAt: now,
      updatedAt: now,
      approved: false,
    };
    const meta = { ...(runtime.meta || {}), updatedAt: now };
    saveCaseRuntime(req.params.caseId, runtime, { meta, outputs });

    res.json({
      ok: true,
      inserted: true,
      fieldId,
      text,
      charCount: text.length,
      status: 'inserted',
      sectionStatus: 'inserted',
      destination: destination || null,
      targetSoftware: getTargetSoftware(formType, fieldId),
      fallback: getFallbackStrategy(formType, fieldId),
      qcGate,
    });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.post('/:caseId/insert-all', async (req, res) => {
  const body = parsePayload(insertAllSchema, req.body || {}, res);
  if (!body) return;

  try {
    res.setHeader('X-Deprecated', 'true');
    res.setHeader('X-Deprecation-Notice', 'Use POST /api/insertion/run instead');
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;
    const { formType } = runtime;
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType, 'POST /api/cases/:caseId/insert-all', log);
      return res.status(400).json({
        ok: false,
        supported: false,
        formType,
        scope: 'deferred',
        message: `Insertion is not available for form type "${formType}". Active forms: ${ACTIVE_FORMS.join(', ')}.`,
      });
    }

    const outputs = { ...(runtime.outputs || {}) };
    const coreSections = CORE_SECTIONS[formType] || [];
    const titleMap = Object.fromEntries(coreSections.map(section => [section.id, section.title]));
    const targetSoftware = inferTargetSoftware(formType);

    const skipped = [];
    const errors = [];

    const hasApproved = coreSections.some((section) => {
      const output = outputs[section.id] || {};
      const status = output.sectionStatus || output.status || 'not_started';
      return output.approved || status === 'approved';
    });
    if (!hasApproved) return res.status(400).json({ ok: false, error: 'No approved sections to insert' });

    const generationRunId = trimText(body.generationRunId, 80) || null;
    const skipQcBlockers = Boolean(body.skipQcBlockers);
    const qcGate = evaluateInsertionQcGate({
      caseId: req.params.caseId,
      generationRunId,
      config: {
        requireQcRun: true,
        requireFreshQcForGeneration: Boolean(generationRunId),
      },
    });
    const canBypassQcGate = skipQcBlockers && qcGate.overrideAllowed !== false;
    if (!qcGate.passed && !canBypassQcGate) {
      return res.status(409).json({
        ok: false,
        code: 'QC_GATE_BLOCKED',
        error: 'QC gate blocked insertion',
        qcGate,
        overrideAllowed: qcGate.overrideAllowed !== false,
        message: qcGate.overrideAllowed === false
          ? 'Run QC for this case before insertion.'
          : 'Resolve QC blockers or set skipQcBlockers=true to bypass.',
      });
    }

    const requestedFieldIds = [];
    for (const section of coreSections) {
      const sid = section.id;
      const output = outputs[sid] || {};
      const text = trimText(output.text, 16000);
      const currentStatus = output.sectionStatus || output.status || 'not_started';
      const approved = output.approved || currentStatus === 'approved';

      if (!approved) continue;

      if (!text) {
        skipped.push({ fieldId: sid, reason: 'no output' });
        continue;
      }

      if (['inserted', 'verified'].includes(currentStatus)) {
        skipped.push({ fieldId: sid, reason: 'already inserted' });
        continue;
      }

      const mapping = resolveMapping(sid, formType, targetSoftware);
      if (!mapping.supported) {
        skipped.push({ fieldId: sid, reason: 'unsupported destination' });
        continue;
      }

      requestedFieldIds.push(sid);
    }

    if (!requestedFieldIds.length) {
      return res.status(400).json({
        ok: false,
        error: 'No supported approved sections to insert',
        skipped,
        qcGate,
      });
    }

    const prepared = prepareInsertionRun({
      caseId: req.params.caseId,
      formType,
      generationRunId,
      config: {
        skipQcBlockers,
        fieldIds: requestedFieldIds,
      },
    });

    if (!prepared.items.length) {
      return res.status(400).json({
        ok: false,
        error: 'No eligible insertion items were prepared',
        skipped,
        qcGate,
      });
    }

    const executedRun = await executeInsertionRun(prepared.run.id);
    const runItems = getInsertionRunItems(prepared.run.id);
    const insertedSections = runItems
      .filter(item => item.status === 'inserted' || item.status === 'verified')
      .map(item => ({
        fieldId: item.fieldId,
        title: titleMap[item.fieldId] || item.fieldId,
        charCount: item.formattedTextLength || item.canonicalText?.length || 0,
        verificationStatus: item.verificationStatus || null,
      }));

    for (const item of runItems) {
      if (item.status === 'skipped' || item.status === 'fallback_used') {
        skipped.push({
          fieldId: item.fieldId,
          reason: item.errorText || item.errorCode || (item.status === 'fallback_used' ? 'manual fallback required' : 'skipped'),
        });
      }

      if (item.status === 'failed') {
        errors.push({ fieldId: item.fieldId, error: item.errorText || item.errorCode || 'Insertion failed' });
      }
    }

    if (!insertedSections.length && !errors.length && executedRun?.summaryJson?.error) {
      errors.push({ fieldId: 'insertion_run', error: executedRun.summaryJson.error });
    }

    const now = new Date().toISOString();
    for (const item of runItems) {
      if (!outputs[item.fieldId]) continue;

      if (item.status === 'verified' || item.status === 'inserted') {
        const nextStatus = item.status === 'verified' ? 'verified' : 'inserted';
        outputs[item.fieldId] = {
          ...outputs[item.fieldId],
          status: nextStatus,
          sectionStatus: nextStatus,
          approved: false,
          insertedAt: now,
          updatedAt: now,
          insertionRunId: prepared.run.id,
          lastInsertionError: null,
        };
      } else if (item.status === 'failed') {
        outputs[item.fieldId] = {
          ...outputs[item.fieldId],
          status: 'error',
          sectionStatus: 'error',
          updatedAt: now,
          insertionRunId: prepared.run.id,
          lastInsertionError: item.errorText || item.errorCode || 'Insertion failed',
        };
      } else if (item.status === 'fallback_used') {
        outputs[item.fieldId] = {
          ...outputs[item.fieldId],
          updatedAt: now,
          insertionRunId: prepared.run.id,
          lastInsertionError: item.errorText || 'Manual fallback required',
        };
      }
    }

    const meta = { ...(runtime.meta || {}) };
    meta.updatedAt = now;
    if (insertedSections.length > 0) meta.pipelineStage = 'inserting';
    saveCaseRuntime(req.params.caseId, runtime, { meta, outputs });

    res.json({
      ok: true,
      inserted: insertedSections.length,
      insertedSections,
      skipped,
      errors,
      qcGate,
      totalInserted: insertedSections.length,
      pipelineStage: meta.pipelineStage || 'inserting',
      runId: prepared.run.id,
      runStatus: executedRun?.status || null,
      summary: executedRun?.summaryJson || null,
    });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

router.patch('/:caseId/outputs/:fieldId', (req, res) => {
  const body = parsePayload(patchOutputSchema, req.body || {}, res);
  if (!body) return;

  try {
    const runtime = getCaseRuntime(req, res);
    if (!runtime) return;

    const fieldId = trimText(req.params.fieldId, 80);
    const text = trimText(body.text, 16000);

    const outputs = { ...(runtime.outputs || {}) };
    const history = { ...(runtime.history || {}) };
    const now = new Date().toISOString();
    if (outputs[fieldId]?.text) {
      if (!history[fieldId]) history[fieldId] = [];
      history[fieldId].unshift({
        text: outputs[fieldId].text,
        title: outputs[fieldId].title,
        savedAt: now,
      });
      history[fieldId] = history[fieldId].slice(0, 3);
    }

    outputs[fieldId] = {
      ...(outputs[fieldId] || {}),
      text,
      updatedAt: now,
    };
    const meta = { ...(runtime.meta || {}), updatedAt: now };
    saveCaseRuntime(req.params.caseId, runtime, { meta, outputs, history });

    res.json({ ok: true, fieldId, charCount: text.length });
  } catch (err) {
    return sendErrorResponse(res, err);
  }
});

export default router;
