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
 * Kept inline in cacc-writer-server.js (temporarily):
 *   upload, extract-facts, questionnaire, grade, feedback, review-section,
 *   generate-all, generate-core, generate-comp-commentary,
 *   sections/*, outputs/:fieldId, exceptions, destination-registry, insert-all
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

// ── Shared utilities ──────────────────────────────────────────────────────────
import { CASES_DIR, CASE_ID_RE, casePath, resolveCaseDir, normalizeFormType, getCaseFormConfig } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { trimText } from '../utils/textUtils.js';

// ── Domain modules ────────────────────────────────────────────────────────────
import { DEFAULT_FORM_TYPE } from '../../forms/index.js';
import { ACTIVE_FORMS, isDeferredForm, logDeferredAccess, getScopeMetaForForm } from '../config/productionScope.js';
import { applyMetaDefaults, extractMetaFields } from '../caseMetadata.js';
import { computeWorkflowStatus, isValidWorkflowStatus } from '../workflowStatus.js';
import { getMissingFacts, formatMissingFactsForUI } from '../sectionDependencies.js';
import { geocodeAddress, distanceMiles, cardinalDirection, buildAddressString } from '../geocoder.js';
import { getNeighborhoodBoundaryFeatures, formatLocationContextBlock } from '../neighborhoodContext.js';
import { getRunsForCase } from '../orchestrator/generationOrchestrator.js';
import log from '../logger.js';

// ── Pipeline stages constant ──────────────────────────────────────────────────
const PIPELINE_STAGES = ['intake', 'extracting', 'generating', 'review', 'approved', 'inserting', 'complete'];

// ── Router ────────────────────────────────────────────────────────────────────
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

// ── POST / — Create case ──────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const requestedFormType = String(req.body?.formType || '').trim().toLowerCase() || DEFAULT_FORM_TYPE;

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
      address:       trimText(req.body?.address,  240),
      borrower:      trimText(req.body?.borrower, 180),
      notes:         trimText(req.body?.notes,    1000),
      formType:      normalizeFormType(req.body?.formType),
      status:        'active',
      pipelineStage: 'intake',
      createdAt:     new Date().toISOString(),
      updatedAt:     new Date().toISOString(),
    };

    const assignmentFields = extractMetaFields(req.body, trimText);
    const meta = applyMetaDefaults({ ...baseMeta, ...assignmentFields });

    fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });
    ['meta.json', 'facts.json', 'doc_text.json', 'outputs.json'].forEach(f =>
      writeJSON(path.join(caseDir, f), {}),
    );
    writeJSON(path.join(caseDir, 'feedback.json'), []);
    writeJSON(path.join(caseDir, 'meta.json'), meta);

    res.json({ ok: true, caseId, meta });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET / — List cases ────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  try {
    if (!fs.existsSync(CASES_DIR)) return res.json({ ok: true, cases: [] });
    const dirs = fs.readdirSync(CASES_DIR).filter(
      d => CASE_ID_RE.test(d) && fs.statSync(path.join(CASES_DIR, d)).isDirectory(),
    );
    const cases = dirs
      .map(id => {
        try {
          const m = readJSON(path.join(CASES_DIR, id, 'meta.json'));
          m.formType = normalizeFormType(m.formType);
          return m;
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ ok: true, cases });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /:caseId — Load case ──────────────────────────────────────────────────
router.get('/:caseId', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    let meta = readJSON(path.join(cd, 'meta.json'));
    meta.formType = normalizeFormType(meta.formType);
    meta = applyMetaDefaults(meta);

    const facts   = readJSON(path.join(cd, 'facts.json'));
    const docText = readJSON(path.join(cd, 'doc_text.json'));
    const outputs = readJSON(path.join(cd, 'outputs.json'));

    meta.workflowStatus = computeWorkflowStatus(meta, facts, outputs);

    const docSummary = {};
    for (const [label, text] of Object.entries(docText)) {
      if (typeof text === 'string') {
        docSummary[label] = {
          wordCount: text.split(/\s+/).filter(Boolean).length,
          preview:   text.slice(0, 200),
        };
      }
    }

    const scopeMeta = getScopeMetaForForm(meta.formType);
    if (scopeMeta.scope === 'deferred') {
      log.warn(`[SCOPE] Legacy deferred-form case loaded — caseId="${req.params.caseId}" formType="${meta.formType}"`);
    }

    res.json({
      ok: true, meta, facts, docSummary, outputs,
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
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const mf = path.join(cd, 'meta.json');
    let meta = readJSON(mf);

    meta.address  = trimText(req.body?.address  ?? meta.address,  240);
    meta.borrower = trimText(req.body?.borrower ?? meta.borrower, 180);
    if (req.body?.notes    !== undefined) meta.notes    = trimText(req.body.notes, 1000);
    if (req.body?.formType !== undefined) meta.formType = normalizeFormType(req.body.formType);

    const assignmentFields = extractMetaFields(req.body, trimText);
    meta = { ...meta, ...assignmentFields };
    meta.updatedAt = new Date().toISOString();

    writeJSON(mf, meta);
    res.json({ ok: true, meta: applyMetaDefaults(meta) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /:caseId — Delete case ─────────────────────────────────────────────
router.delete('/:caseId', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    fs.rmSync(cd, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /:caseId/status — Set case status ───────────────────────────────────
router.patch('/:caseId/status', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const nextStatus = trimText(req.body?.status, 20).toLowerCase() || 'active';
    if (!['active', 'submitted', 'archived'].includes(nextStatus)) {
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    }

    const mf   = path.join(cd, 'meta.json');
    const meta = readJSON(mf);
    meta.status    = nextStatus;
    meta.updatedAt = new Date().toISOString();
    writeJSON(mf, meta);
    res.json({ ok: true, meta });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /:caseId/pipeline — Advance pipeline stage ─────────────────────────
router.patch('/:caseId/pipeline', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const stage = trimText(req.body?.stage, 20).toLowerCase();
    if (!PIPELINE_STAGES.includes(stage)) {
      return res.status(400).json({
        ok:    false,
        error: `Invalid stage. Must be one of: ${PIPELINE_STAGES.join(', ')}`,
      });
    }

    const mf   = path.join(cd, 'meta.json');
    const meta = readJSON(mf);
    meta.pipelineStage = stage;
    meta.updatedAt     = new Date().toISOString();
    if (!meta.pipelineHistory) meta.pipelineHistory = [];
    meta.pipelineHistory.push({ stage, at: meta.updatedAt });
    writeJSON(mf, meta);
    res.json({ ok: true, pipelineStage: stage, meta });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PATCH /:caseId/workflow-status — Set workflowStatus ──────────────────────
router.patch('/:caseId/workflow-status', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const status = trimText(req.body?.workflowStatus, 40);
    if (!isValidWorkflowStatus(status)) {
      return res.status(400).json({
        ok:    false,
        error: `Invalid workflowStatus. Valid values: ${[
          'facts_incomplete', 'ready_for_generation', 'generation_in_progress',
          'sections_drafted', 'awaiting_review', 'automation_ready',
          'insertion_in_progress', 'verified', 'exception_flagged',
        ].join(', ')}`,
      });
    }

    const mf   = path.join(cd, 'meta.json');
    const meta = readJSON(mf);
    meta.workflowStatus = status;
    meta.updatedAt      = new Date().toISOString();
    writeJSON(mf, meta);
    res.json({ ok: true, workflowStatus: status, meta: applyMetaDefaults(meta) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PUT /:caseId/facts — Save/merge facts ─────────────────────────────────────
router.put('/:caseId/facts', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const factsFile = path.join(cd, 'facts.json');
    const updated   = { ...readJSON(factsFile, {}), ...req.body, updatedAt: new Date().toISOString() };
    writeJSON(factsFile, updated);

    const meta = readJSON(path.join(cd, 'meta.json'));
    meta.updatedAt = new Date().toISOString();
    writeJSON(path.join(cd, 'meta.json'), meta);

    res.json({ ok: true, facts: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /:caseId/history — Section version history ────────────────────────────
router.get('/:caseId/history', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({ ok: true, history: readJSON(path.join(cd, 'history.json'), {}) });
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
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const facts = readJSON(path.join(cd, 'facts.json'), {});
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
      (req.body?.subjectAddress ? String(req.body.subjectAddress).trim() : null);

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
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const fieldId = trimText(req.params.fieldId, 80);
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId required' });

    const facts     = readJSON(path.join(cd, 'facts.json'), {});
    const missing   = getMissingFacts(fieldId, facts);
    const formatted = formatMissingFactsForUI(missing);
    res.json({ ok: true, fieldId, ...formatted });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /:caseId/missing-facts — Batch missing facts check ───────────────────
router.post('/:caseId/missing-facts', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const fieldIds = Array.isArray(req.body?.fieldIds) ? req.body.fieldIds : [];
    if (!fieldIds.length) return res.json({ ok: true, warnings: [] });

    const facts       = readJSON(path.join(cd, 'facts.json'), {});
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
