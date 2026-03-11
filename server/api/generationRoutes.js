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
import fs from 'fs';
import path from 'path';

// ── Shared utilities ──────────────────────────────────────────────────────────
import { resolveCaseDir, normalizeFormType, getCaseFormConfig } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { trimText, asArray, aiText } from '../utils/textUtils.js';
import { ensureAI } from '../utils/middleware.js';

// ── Domain modules ────────────────────────────────────────────────────────────
import { DEFAULT_FORM_TYPE } from '../../forms/index.js';
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
      if (caseId && !bodyFacts) {
        const cd = resolveCaseDir(caseId);
        if (cd && fs.existsSync(cd)) {
          caseFacts = readJSON(path.join(cd, 'facts.json'), {});
          if (LOCATION_CONTEXT_FIELDS.has(fieldId)) {
            const geo = readJSON(path.join(cd, 'geocode.json'), null);
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
      }
      const ft = normalizeFormType(formType);
      let assignmentMeta = null;
      if (caseId) {
        const cd = resolveCaseDir(caseId);
        if (cd && fs.existsSync(cd)) {
          assignmentMeta = buildAssignmentMetaBlock(applyMetaDefaults(readJSON(path.join(cd, 'meta.json'), {})));
        }
      }
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

    let caseFacts = {};
    let caseDir = null;
    let caseFormType = DEFAULT_FORM_TYPE;
    let batchLocationContext = null;
    let batchAssignmentMeta = null;

    if (caseId) {
      caseDir = resolveCaseDir(caseId);
      if (!caseDir) return res.status(400).json({ ok: false, error: 'Invalid caseId format' });
      if (!fs.existsSync(caseDir)) return res.status(404).json({ ok: false, error: 'Case not found' });
      caseFacts = readJSON(path.join(caseDir, 'facts.json'), {});
      const { formType: bFt, meta: bMeta } = getCaseFormConfig(caseDir);
      caseFormType = bFt;
      batchAssignmentMeta = buildAssignmentMetaBlock(applyMetaDefaults(bMeta || {}));
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
      if (fields.some(f => LOCATION_CONTEXT_FIELDS.has(f?.id))) {
        const geo = readJSON(path.join(caseDir, 'geocode.json'), null);
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

    if (caseDir) {
      const outFile = path.join(caseDir, 'outputs.json');
      const existing = readJSON(outFile, {});
      const histFile = path.join(caseDir, 'history.json');
      const history = readJSON(histFile, {});
      for (const fid of Object.keys(results)) {
        if (existing[fid]?.text) {
          if (!history[fid]) history[fid] = [];
          history[fid].unshift({
            text: existing[fid].text,
            title: existing[fid].title,
            savedAt: new Date().toISOString(),
          });
          history[fid] = history[fid].slice(0, 3);
        }
      }
      writeJSON(histFile, history);
      writeJSON(outFile, { ...existing, ...results, updatedAt: new Date().toISOString() });
      const meta = readJSON(path.join(caseDir, 'meta.json'));
      meta.updatedAt = new Date().toISOString();
      writeJSON(path.join(caseDir, 'meta.json'), meta);
    }
    res.json({ ok: true, results, errors });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Batch generation failed' });
  }
});

// ── POST /similar-examples (legacy compat, now modular) ──────────────────────
router.post('/similar-examples', (req, res) => {
  try {
    const { fieldId, limit = 3, formType } = req.body;
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
  try {
    const caseDir = req.caseDir;
    if (!fs.existsSync(caseDir)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const { formType, formConfig } = getCaseFormConfig(caseDir);
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType, 'POST /api/cases/:caseId/generate-core', log);
      return res.status(400).json({ ok: false, supported: false, formType, scope: 'deferred' });
    }

    const facts = readJSON(path.join(caseDir, 'facts.json'), {});
    const assignmentMeta = buildAssignmentMetaBlock(
      applyMetaDefaults(readJSON(path.join(caseDir, 'meta.json'), {})),
    );
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

    const outputsFile = path.join(caseDir, 'outputs.json');
    const existing = readJSON(outputsFile, {});
    writeJSON(outputsFile, { ...existing, ...results, updatedAt: new Date().toISOString() });

    const sectionStatusFile = path.join(caseDir, 'section_statuses.json');
    const sectionStatuses = readJSON(sectionStatusFile, {});
    for (const [sid, st] of Object.entries(statuses)) {
      sectionStatuses[sid] = {
        status: st,
        updatedAt: new Date().toISOString(),
        title: results[sid]?.title || sid,
      };
    }
    writeJSON(sectionStatusFile, sectionStatuses);

    const meta = readJSON(path.join(caseDir, 'meta.json'));
    meta.updatedAt = new Date().toISOString();
    meta.pipelineStage = 'generating';
    writeJSON(path.join(caseDir, 'meta.json'), meta);

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
  try {
    const caseDir = req.caseDir;
    if (!fs.existsSync(caseDir)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const { formType } = getCaseFormConfig(caseDir);
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

    const facts = readJSON(path.join(caseDir, 'facts.json'), {});
    const assignmentMeta = buildAssignmentMetaBlock(
      applyMetaDefaults(readJSON(path.join(caseDir, 'meta.json'), {})),
    );
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

    if (results.length) {
      const outputsFile = path.join(caseDir, 'outputs.json');
      const existing = readJSON(outputsFile, {});
      existing.comp_commentary = { comps: results, generatedAt: new Date().toISOString() };
      writeJSON(outputsFile, existing);
    }

    const compFocus = trimText(req.body?.compFocus, 40) || 'all';
    const combinedText = results.map(result => result.compLabel + ': ' + result.text).join('\n\n');
    if (results.length) {
      const outputsFile = path.join(caseDir, 'outputs.json');
      const existing = readJSON(outputsFile, {});
      existing.sca_summary = { text: combinedText, comps: results, generatedAt: new Date().toISOString() };
      writeJSON(outputsFile, existing);
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
  try {
    const caseDir = req.caseDir;
    if (!fs.existsSync(caseDir)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const { formType, formConfig } = getCaseFormConfig(caseDir);
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType, 'POST /api/cases/:caseId/generate-all', log);
      return res.status(400).json({ ok: false, supported: false, formType, scope: 'deferred' });
    }

    const facts = readJSON(path.join(caseDir, 'facts.json'), {});
    const assignmentMeta = buildAssignmentMetaBlock(
      applyMetaDefaults(readJSON(path.join(caseDir, 'meta.json'), {})),
    );
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

    const outputsFile = path.join(caseDir, 'outputs.json');
    const existing = readJSON(outputsFile, {});
    writeJSON(outputsFile, { ...existing, ...results, updatedAt: new Date().toISOString() });

    const sectionStatusFile = path.join(caseDir, 'section_statuses.json');
    const sectionStatuses = readJSON(sectionStatusFile, {});
    for (const [sid, st] of Object.entries(statuses)) {
      sectionStatuses[sid] = {
        ...(sectionStatuses[sid] || {}),
        status: st,
        updatedAt: new Date().toISOString(),
      };
    }
    writeJSON(sectionStatusFile, sectionStatuses);

    const meta = readJSON(path.join(caseDir, 'meta.json'));
    meta.updatedAt = new Date().toISOString();
    meta.pipelineStage = 'generating';
    writeJSON(path.join(caseDir, 'meta.json'), meta);

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
  const { caseId }           = req.params;
  const { formType, options = {} } = req.body || {};

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
  const caseDir = req.caseDir;
  if (!fs.existsSync(caseDir)) {
    return res.status(404).json({ ok: false, error: `Case not found: ${caseId}` });
  }

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
  const { caseId, formType, options = {} } = req.body || {};

  if (!caseId) {
    return res.status(400).json({ ok: false, error: 'caseId is required in request body' });
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
  if (!fs.existsSync(caseDir)) {
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
  const { runId, sectionId, caseId } = req.body || {};

  if (!runId || !sectionId || !caseId) {
    return res.status(400).json({ ok: false, error: 'runId, sectionId, and caseId are required' });
  }

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
router.post('/db/migrate-legacy-kb', async (_req, res) => {
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
