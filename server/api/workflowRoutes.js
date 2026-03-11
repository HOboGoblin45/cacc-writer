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
import fs from 'fs';
import path from 'path';

import {
  CASES_DIR,
  CASE_ID_RE,
  resolveCaseDir,
  getCaseFormConfig,
} from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { trimText } from '../utils/textUtils.js';
import { upload, ensureAI } from '../utils/middleware.js';
import { extractPdfText } from '../ingestion/pdfExtractor.js';

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
import { syncCaseRecordFromFilesystem } from '../caseRecord/caseRecordService.js';
import { evaluatePreDraftGate } from '../factIntegrity/preDraftGate.js';
import {
  getNeighborhoodBoundaryFeatures,
  formatLocationContextBlock,
  LOCATION_CONTEXT_FIELDS,
} from '../neighborhoodContext.js';
import log from '../logger.js';

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const router = Router();

function safeSyncCaseRecord(caseId) {
  try {
    syncCaseRecordFromFilesystem(caseId);
  } catch (err) {
    // Keep legacy workflow endpoints stable if canonical sync has an issue.
    log.warn('case-record:sync-failed', { caseId, error: err.message });
  }
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

function evaluateGateForCase(caseId, formType, sectionIds) {
  return evaluatePreDraftGate({ caseId, formType, sectionIds });
}

router.post('/workflow/run', ensureAI, async (req, res) => {
  try {
    const { caseId, fields, twoPass = false, saveOutputs = true } = req.body;
    const requestedFt = String(req.body?.formType || '').trim().toLowerCase();
    if (requestedFt && isDeferredForm(requestedFt)) {
      logDeferredAccess(requestedFt, 'POST /api/workflow/run', log);
      return res.status(400).json({ ok: false, supported: false, formType: requestedFt, scope: 'deferred' });
    }
    if (!caseId) return res.status(400).json({ ok: false, error: 'caseId is required' });

    const caseDir = resolveCaseDir(caseId);
    if (!caseDir || !fs.existsSync(caseDir)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const { formType, formConfig } = getCaseFormConfig(caseDir);
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType, 'POST /api/workflow/run', log);
      return res.status(400).json({ ok: false, supported: false, formType, scope: 'deferred' });
    }

    const facts = readJSON(path.join(caseDir, 'facts.json'), {});
    const rawMeta = readJSON(path.join(caseDir, 'meta.json'), {});
    const assignmentMeta = buildAssignmentMetaBlock(applyMetaDefaults(rawMeta));

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
        return res.status(409).json({
          ok: false,
          code: 'PRE_DRAFT_GATE_BLOCKED',
          error: 'Pre-draft integrity gate blocked workflow run',
          gate,
        });
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
      const outputsFile = path.join(caseDir, 'outputs.json');
      const existing = readJSON(outputsFile, {});
      writeJSON(outputsFile, { ...existing, ...results, updatedAt: new Date().toISOString() });

      const meta = readJSON(path.join(caseDir, 'meta.json'));
      meta.updatedAt = new Date().toISOString();
      meta.pipelineStage = 'generating';
      writeJSON(path.join(caseDir, 'meta.json'), meta);
      safeSyncCaseRecord(caseId);
    }

    res.json({ ok: true, results, errors, formType, fieldsAttempted: targetFields.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/workflow/run-batch', ensureAI, async (req, res) => {
  try {
    const { cases, fields, twoPass = false } = req.body;
    const requestedFt = String(req.body?.formType || '').trim().toLowerCase();
    if (requestedFt && isDeferredForm(requestedFt)) {
      logDeferredAccess(requestedFt, 'POST /api/workflow/run-batch', log);
      return res.status(400).json({ ok: false, supported: false, formType: requestedFt, scope: 'deferred' });
    }
    if (!Array.isArray(cases) || !cases.length) {
      return res.status(400).json({ ok: false, error: 'cases must be a non-empty array' });
    }
    if (cases.length > 10) return res.status(400).json({ ok: false, error: 'cases must be <= 10' });

    const batchResults = [];
    const batchErrors = [];
    for (const caseId of cases) {
      const caseDir = resolveCaseDir(caseId);
      if (!caseDir || !fs.existsSync(caseDir)) {
        batchErrors.push({ caseId, error: 'Case not found' });
        continue;
      }
      const { formType, formConfig } = getCaseFormConfig(caseDir);
      if (isDeferredForm(formType)) {
        batchErrors.push({ caseId, error: 'Deferred form type: ' + formType });
        continue;
      }
      try {
        const facts = readJSON(path.join(caseDir, 'facts.json'), {});
        const assignmentMeta = buildAssignmentMetaBlock(
          applyMetaDefaults(readJSON(path.join(caseDir, 'meta.json'), {})),
        );
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
              error: 'Pre-draft integrity gate blocked workflow run',
              code: 'PRE_DRAFT_GATE_BLOCKED',
              gate,
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
        const outputsFile = path.join(caseDir, 'outputs.json');
        const existing = readJSON(outputsFile, {});
        writeJSON(outputsFile, { ...existing, ...results, updatedAt: new Date().toISOString() });

        const metaPath = path.join(caseDir, 'meta.json');
        const meta = readJSON(metaPath, {});
        meta.updatedAt = new Date().toISOString();
        meta.pipelineStage = 'generating';
        writeJSON(metaPath, meta);
        safeSyncCaseRecord(caseId);
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
  const caseDirs = fs.existsSync(CASES_DIR)
    ? fs.readdirSync(CASES_DIR).filter(d => CASE_ID_RE.test(d))
    : [];
  const activeCases = caseDirs.filter(d => {
    try {
      const meta = readJSON(path.join(CASES_DIR, d, 'meta.json'));
      return meta?.status === 'active';
    } catch {
      return false;
    }
  });
  res.json({
    ok: true,
    status: 'healthy',
    casesDir: CASES_DIR,
    totalCases: caseDirs.length,
    activeCases: activeCases.length,
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

    const { text, method } = await extractPdfText(req.file.buffer, client, MODEL);
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
