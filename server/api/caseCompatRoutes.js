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

import { resolveCaseDir, getCaseFormConfig } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import {
  trimText,
  asArray,
  aiText,
  parseJSONObject,
  normalizeQuestions,
  normalizeGrade,
} from '../utils/textUtils.js';
import { upload, ensureAI } from '../utils/middleware.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';

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
import { buildReviewMessages } from '../promptBuilder.js';
import log from '../logger.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const VALID_SECTION_STATUSES = ['not_started', 'drafted', 'reviewed', 'approved', 'inserted', 'verified', 'copied', 'error'];

const gradeSchema = z.object({
  fieldId: z.string().max(80).optional(),
  text: z.string().max(8000).optional(),
}).passthrough();

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

function parsePayload(schema, payload, res) {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    ok: false,
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
  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });

    const isPdf = req.file.mimetype === 'application/pdf'
      || String(req.file.originalname || '').toLowerCase().endsWith('.pdf');

    if (!isPdf) return res.status(400).json({ ok: false, error: 'Only PDF files are allowed' });

    const docType = trimText(req.body.docType || 'unknown', 60).replace(/[^a-z0-9_-]/gi, '_');
    fs.mkdirSync(path.join(cd, 'documents'), { recursive: true });
    fs.writeFileSync(path.join(cd, 'documents', docType + '.pdf'), req.file.buffer);

    let extractedText = '';
    let pageCount = 0;
    try {
      const { text, method } = await extractPdfText(req.file.buffer, client, MODEL);
      extractedText = text || '';
      try {
        const p = await pdfParse(req.file.buffer);
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

    const docTextPath = path.join(cd, 'doc_text.json');
    const docText = readJSON(docTextPath, {});
    docText[docType] = extractedText;
    writeJSON(docTextPath, docText);

    const metaPath = path.join(cd, 'meta.json');
    const meta = readJSON(metaPath, {});
    meta.updatedAt = new Date().toISOString();
    if (!meta.docs) meta.docs = {};
    meta.docs[docType] = {
      uploadedAt: new Date().toISOString(),
      pages: pageCount,
      bytes: req.file.size,
    };
    writeJSON(metaPath, meta);

    res.json({
      ok: true,
      docType,
      wordCount: extractedText.split(/\s+/).filter(Boolean).length,
      pages: pageCount,
      preview: extractedText.slice(0, 400),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:caseId/extract-facts', ensureAI, async (req, res) => {
  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const docText = readJSON(path.join(cd, 'doc_text.json'), {});
    const existingFacts = readJSON(path.join(cd, 'facts.json'), {});
    const answers = req.body?.answers || {};
    const { formType, formConfig } = getCaseFormConfig(cd);

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
    writeJSON(path.join(cd, 'facts.json'), merged);

    res.json({ ok: true, facts: merged });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to parse facts JSON: ' + err.message });
  }
});

router.post('/:caseId/questionnaire', ensureAI, async (req, res) => {
  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const facts = readJSON(path.join(cd, 'facts.json'), {});
    const { formType, formConfig } = getCaseFormConfig(cd);
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:caseId/grade', ensureAI, async (req, res) => {
  const body = parsePayload(gradeSchema, req.body || {}, res);
  if (!body) return;

  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const outputs = readJSON(path.join(cd, 'outputs.json'), {});
    const { formType } = getCaseFormConfig(cd);

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
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:caseId/feedback', async (req, res) => {
  const body = parsePayload(feedbackSchema, req.body || {}, res);
  if (!body) return;

  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

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
        const { formType } = getCaseFormConfig(cd);
        await addApprovedNarrative({
          fieldId: sid,
          text: safeText,
          formType,
          source: 'user-approved',
        });
        savedToKB = true;
      } catch (kbErr) {
        log.warn('feedback:kb-write-failed', { error: kbErr.message, fieldId: sid });
      }
    }

    const metaPath = path.join(cd, 'meta.json');
    const meta = readJSON(metaPath, {});
    meta.updatedAt = new Date().toISOString();
    writeJSON(metaPath, meta);

    res.json({ ok: true, saved: true, count: feedbackItems.length, savedToKB });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:caseId/review-section', ensureAI, async (req, res) => {
  const body = parsePayload(reviewSchema, req.body || {}, res);
  if (!body) return;

  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const fieldId = trimText(body.fieldId, 80);
    const draftText = trimText(body.text, 8000);

    const facts = readJSON(path.join(cd, 'facts.json'), {});
    const { formType } = getCaseFormConfig(cd);

    const reviewMessages = buildReviewMessages({ draftText, facts, fieldId, formType });
    const reviewRaw = await callAI(reviewMessages);
    const review = parseReviewResult(reviewRaw) || { revisedText: reviewRaw, issues: [], score: null };

    res.json({ ok: true, fieldId, review });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/:caseId/sections/:fieldId/status', (req, res) => {
  const body = parsePayload(sectionStatusSchema, req.body || {}, res);
  if (!body) return;

  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const fieldId = trimText(req.params.fieldId, 80);
    const newStatus = body.status;

    const sectionStatusFile = path.join(cd, 'section_statuses.json');
    const statuses = readJSON(sectionStatusFile, {});
    statuses[fieldId] = {
      ...(statuses[fieldId] || {}),
      status: newStatus,
      updatedAt: new Date().toISOString(),
    };
    if (body.notes) statuses[fieldId].notes = trimText(body.notes, 500);
    writeJSON(sectionStatusFile, statuses);

    const metaPath = path.join(cd, 'meta.json');
    const meta = readJSON(metaPath, {});
    meta.updatedAt = new Date().toISOString();
    writeJSON(metaPath, meta);

    const outputsFile = path.join(cd, 'outputs.json');
    const outputs = readJSON(outputsFile, {});
    const hasText = Boolean(outputs[fieldId]?.text);
    const isApprovedStatus = ['approved', 'inserted', 'verified'].includes(newStatus);
    if (outputs[fieldId]) {
      outputs[fieldId].sectionStatus = newStatus;
      outputs[fieldId].approved = isApprovedStatus && hasText;
      writeJSON(outputsFile, outputs);
    }

    res.json({
      ok: true,
      fieldId,
      status: newStatus,
      sectionStatus: newStatus,
      approved: isApprovedStatus && hasText,
      updatedAt: statuses[fieldId].updatedAt,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:caseId/sections/:fieldId/copy', (req, res) => {
  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const fieldId = trimText(req.params.fieldId, 80);
    const outputs = readJSON(path.join(cd, 'outputs.json'), {});
    const text = trimText(req.body?.text, 16000) || outputs[fieldId]?.text || '';
    if (!text) return res.status(400).json({ ok: false, error: 'No text to copy for field: ' + fieldId });

    const sectionStatusFile = path.join(cd, 'section_statuses.json');
    const statuses = readJSON(sectionStatusFile, {});
    statuses[fieldId] = {
      ...(statuses[fieldId] || {}),
      status: 'copied',
      copiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJSON(sectionStatusFile, statuses);

    res.json({ ok: true, fieldId, text, charCount: text.length, status: 'copied', message: 'Text ready for manual paste' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:caseId/sections/status', (req, res) => {
  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const { formType } = getCaseFormConfig(cd);
    const statuses = readJSON(path.join(cd, 'section_statuses.json'), {});
    const outputs = readJSON(path.join(cd, 'outputs.json'), {});

    const coreSections = CORE_SECTIONS[formType] || [];
    const sectionsArr = coreSections.map((sec) => {
      const st = statuses[sec.id]?.status || 'not_started';
      return {
        id: sec.id,
        title: sec.title,
        status: st,
        sectionStatus: st,
        approved: ['approved', 'inserted', 'verified'].includes(st),
        hasOutput: Boolean(outputs[sec.id]?.text),
        updatedAt: statuses[sec.id]?.updatedAt || null,
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:caseId/destination-registry', (req, res) => {
  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const { formType } = getCaseFormConfig(cd);
    const destinations = listAllDestinations(formType);

    const statuses = readJSON(path.join(cd, 'section_statuses.json'), {});
    const outputs = readJSON(path.join(cd, 'outputs.json'), {});

    const fields = Object.fromEntries(destinations.map((d) => {
      const st = statuses[d.fieldId]?.status || 'not_started';
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/:caseId/exceptions', (req, res) => {
  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const statuses = readJSON(path.join(cd, 'section_statuses.json'), {});
    const outputs = readJSON(path.join(cd, 'outputs.json'), {});

    const coreSections = CORE_SECTIONS[getCaseFormConfig(cd).formType] || [];
    const titleMap = Object.fromEntries(coreSections.map(s => [s.id, s.title]));

    const exceptionMap = {};
    Object.entries(statuses).forEach(([id, value]) => {
      if (value?.status === 'error' || value?.status === 'copied') {
        exceptionMap[id] = {
          status: value.status,
          notes: value.notes || null,
          updatedAt: value.updatedAt,
        };
      }
    });

    Object.entries(outputs).forEach(([id, value]) => {
      if (id === 'updatedAt' || typeof value !== 'object' || !value) return;
      if (value.sectionStatus === 'error' || value.sectionStatus === 'copied') {
        if (!exceptionMap[id]) {
          exceptionMap[id] = {
            status: value.sectionStatus,
            notes: value.statusNote || null,
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:caseId/sections/:fieldId/insert', (req, res) => {
  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const fieldId = trimText(req.params.fieldId, 80);
    const outputs = readJSON(path.join(cd, 'outputs.json'), {});
    const text = trimText(req.body?.text, 16000) || outputs[fieldId]?.text || '';
    if (!text) return res.status(400).json({ ok: false, error: 'No text to insert for field: ' + fieldId });

    const { formType } = getCaseFormConfig(cd);
    const destination = getDestination(formType, fieldId);

    const sectionStatusFile = path.join(cd, 'section_statuses.json');
    const statuses = readJSON(sectionStatusFile, {});
    statuses[fieldId] = {
      ...(statuses[fieldId] || {}),
      status: 'inserted',
      insertedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJSON(sectionStatusFile, statuses);

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
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/:caseId/insert-all', (req, res) => {
  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const { formType } = getCaseFormConfig(cd);
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

    const outputs = readJSON(path.join(cd, 'outputs.json'), {});
    const sectionStatusFile = path.join(cd, 'section_statuses.json');
    const statuses = readJSON(sectionStatusFile, {});
    const coreSections = CORE_SECTIONS[formType] || [];

    const inserted = [];
    const skipped = [];
    const errors = [];

    const hasApproved = coreSections.some(sec => outputs[sec.id]?.sectionStatus === 'approved');
    if (!hasApproved) return res.status(400).json({ ok: false, error: 'No approved sections to insert' });

    for (const section of coreSections) {
      const sid = section.id;
      const text = outputs[sid]?.text || '';
      if (!text) {
        skipped.push({ fieldId: sid, reason: 'no output' });
        continue;
      }

      const currentStatus = statuses[sid]?.status || 'not_started';
      if (['inserted', 'verified'].includes(currentStatus)) {
        skipped.push({ fieldId: sid, reason: 'already inserted' });
        continue;
      }

      try {
        statuses[sid] = {
          ...(statuses[sid] || {}),
          status: 'inserted',
          insertedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (outputs[sid]) {
          outputs[sid].sectionStatus = 'inserted';
          outputs[sid].approved = false;
        }
        inserted.push({ fieldId: sid, title: section.title, charCount: text.length });
      } catch (e) {
        errors.push({ fieldId: sid, error: e.message });
      }
    }

    writeJSON(sectionStatusFile, statuses);
    writeJSON(path.join(cd, 'outputs.json'), outputs);

    const metaPath = path.join(cd, 'meta.json');
    const meta = readJSON(metaPath, {});
    meta.updatedAt = new Date().toISOString();
    if (inserted.length === coreSections.length) meta.pipelineStage = 'inserting';
    writeJSON(metaPath, meta);

    res.json({
      ok: true,
      inserted: inserted.length,
      insertedSections: inserted,
      skipped,
      errors,
      totalInserted: inserted.length,
      pipelineStage: meta.pipelineStage || 'inserting',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/:caseId/outputs/:fieldId', (req, res) => {
  const body = parsePayload(patchOutputSchema, req.body || {}, res);
  if (!body) return;

  try {
    const cd = ensureCaseDir(req, res);
    if (!cd) return;

    const fieldId = trimText(req.params.fieldId, 80);
    const text = trimText(body.text, 16000);

    const outputsFile = path.join(cd, 'outputs.json');
    const outputs = readJSON(outputsFile, {});

    const historyFile = path.join(cd, 'history.json');
    const history = readJSON(historyFile, {});
    if (outputs[fieldId]?.text) {
      if (!history[fieldId]) history[fieldId] = [];
      history[fieldId].unshift({
        text: outputs[fieldId].text,
        title: outputs[fieldId].title,
        savedAt: new Date().toISOString(),
      });
      history[fieldId] = history[fieldId].slice(0, 3);
      writeJSON(historyFile, history);
    }

    outputs[fieldId] = {
      ...(outputs[fieldId] || {}),
      text,
      updatedAt: new Date().toISOString(),
    };
    writeJSON(outputsFile, outputs);

    const metaPath = path.join(cd, 'meta.json');
    const meta = readJSON(metaPath, {});
    meta.updatedAt = new Date().toISOString();
    writeJSON(metaPath, meta);

    res.json({ ok: true, fieldId, charCount: text.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
