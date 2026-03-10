/**
 * server/api/healthRoutes.js
 * ---------------------------
 * Express Router for system health, forms, logs, export, templates,
 * and destination-registry endpoints.
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Extracted routes:
 *   GET    /health                              — basic health ping
 *   GET    /health/detailed                     — comprehensive health check
 *   GET    /health/services                     — per-service probe
 *   GET    /forms                               — list all form configs
 *   GET    /forms/:formType                     — single form config
 *   GET    /destination-registry                — all destination entries
 *   GET    /destination-registry/:formType/:sectionId — single entry
 *   GET    /logs                                — list log files
 *   GET    /logs/:date                          — read log file by date
 *   GET    /export/stats                        — bundle stats
 *   POST   /export/bundle                       — create support bundle
 *   GET    /export/list                         — list existing bundles
 *   GET    /templates/neighborhood              — list neighborhood templates
 *   POST   /templates/neighborhood              — create template
 *   DELETE /templates/neighborhood/:id          — delete template
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Shared utilities ──────────────────────────────────────────────────────────
import { CASES_DIR, CASE_ID_RE } from '../utils/caseUtils.js';
import { readJSON, writeJSON } from '../utils/fileUtils.js';
import { trimText } from '../utils/textUtils.js';

// ── Domain modules ────────────────────────────────────────────────────────────
import {
  DEFAULT_FORM_TYPE,
  isValidFormType,
  getFormConfig,
  listForms,
  getActiveForms,
  getDeferredForms,
} from '../../forms/index.js';
import { ACTIVE_FORMS, DEFERRED_FORMS } from '../config/productionScope.js';
// Note: ACTIVE_FORMS and DEFERRED_FORMS come from productionScope, not forms/index.js
import {
  listAllDestinations,
  getDestination,
} from '../destinationRegistry.js';
import {
  getLogFiles,
  readLogFile,
  getLogsDir,
} from '../fileLogger.js';
import {
  getBundleStats,
  createSupportBundle,
  listExports,
} from '../backupExport.js';
import { MODEL } from '../openaiClient.js';
import log from '../logger.js';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT   = path.join(__dirname, '..', '..');
const VOICE_FILE     = path.join(PROJECT_ROOT, 'voice_training.json');
const KB_DIR         = path.join(PROJECT_ROOT, 'knowledge_base');
const TEMPLATES_FILE = path.join(PROJECT_ROOT, 'neighborhood_templates.json');

// ── Agent URLs ────────────────────────────────────────────────────────────────
const ACI_AGENT_URL = process.env.ACI_AGENT_URL || 'http://localhost:5180';
const RQ_AGENT_URL  = process.env.RQ_AGENT_URL  || 'http://localhost:5181';
const PORT          = Number(process.env.PORT)   || 5178;
const PIPELINE_STAGES = ['intake', 'extracting', 'generating', 'review', 'approved', 'inserting', 'complete'];

// ── Router ────────────────────────────────────────────────────────────────────
const router = Router();

// ── GET /health ───────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ ok: true, model: MODEL, version: '2.0.0' });
});

// ── GET /health/detailed ──────────────────────────────────────────────────────
router.get('/health/detailed', async (_req, res) => {
  try {
    const kbIndex    = readJSON(path.join(KB_DIR, 'index.json'), { counts: {}, examples: [] });
    const voiceCount = readJSON(VOICE_FILE, []).length;

    let caseCount = 0;
    try {
      if (fs.existsSync(CASES_DIR)) {
        caseCount = fs.readdirSync(CASES_DIR).filter(d => CASE_ID_RE.test(d)).length;
      }
    } catch { /* non-fatal */ }

    const [aciOk, rqOk] = await Promise.all([
      fetch(`${ACI_AGENT_URL}/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false),
      fetch(`${RQ_AGENT_URL}/health`,  { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false),
    ]);

    res.json({
      ok:       true,
      version:  '2.0.0',
      model:    MODEL,
      uptimeS:  Math.round(process.uptime()),
      aiKeySet: Boolean(process.env.OPENAI_API_KEY),
      kb: {
        totalExamples:      Array.isArray(kbIndex.examples) ? kbIndex.examples.length : 0,
        counts:             kbIndex.counts || {},
        lastUpdated:        kbIndex.lastUpdated || null,
        voiceTrainingCount: voiceCount,
      },
      cases:          { total: caseCount },
      agents:         { aci: aciOk, rq: rqOk },
      pipelineStages: PIPELINE_STAGES,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /health/services ──────────────────────────────────────────────────────
router.get('/health/services', async (_req, res) => {
  try {
    // Probe KB read/write
    let kbStatus = 'healthy', kbDetail = null;
    try {
      const testPath = path.join(KB_DIR, '.health_probe');
      fs.writeFileSync(testPath, '1', 'utf8');
      fs.unlinkSync(testPath);
    } catch (e) {
      kbStatus = 'degraded';
      kbDetail = 'KB write probe failed: ' + e.message;
    }

    // Probe approvedNarratives
    let narStatus = 'healthy', narDetail = null;
    const narDir = path.join(KB_DIR, 'approvedNarratives');
    try {
      if (!fs.existsSync(narDir)) {
        narStatus = 'degraded';
        narDetail = 'approvedNarratives/ directory does not exist yet';
      } else {
        const testPath = path.join(narDir, '.health_probe');
        fs.writeFileSync(testPath, '1', 'utf8');
        fs.unlinkSync(testPath);
        const idx = readJSON(path.join(narDir, 'index.json'), { entries: [] });
        narDetail = `${(idx.entries || []).length} entries`;
      }
    } catch (e) {
      narStatus = 'degraded';
      narDetail = 'approvedNarratives probe failed: ' + e.message;
    }

    // Probe agents
    const [aciOk, rqOk] = await Promise.all([
      fetch(`${ACI_AGENT_URL}/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false),
      fetch(`${RQ_AGENT_URL}/health`,  { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false),
    ]);

    res.json({
      ok: true,
      services: {
        server:             { status: 'healthy',                    detail: `port ${PORT}, model ${MODEL}` },
        aciAgent:           { status: aciOk ? 'healthy' : 'offline', detail: aciOk ? ACI_AGENT_URL : 'Not reachable — start desktop_agent/agent.py' },
        rqAgent:            { status: rqOk  ? 'healthy' : 'offline', detail: rqOk  ? RQ_AGENT_URL  : 'Not reachable — start real_quantum_agent/agent.py' },
        knowledgeBase:      { status: kbStatus,  detail: kbDetail },
        approvedNarratives: { status: narStatus, detail: narDetail },
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /forms ────────────────────────────────────────────────────────────────
router.get('/forms', (_req, res) => {
  res.json({
    ok:              true,
    forms:           listForms(),
    activeForms:     getActiveForms(),
    deferredForms:   getDeferredForms(),
    defaultFormType: DEFAULT_FORM_TYPE,
    activeScope:     ACTIVE_FORMS,
    deferredScope:   DEFERRED_FORMS,
  });
});

// ── GET /forms/:formType ──────────────────────────────────────────────────────
router.get('/forms/:formType', (req, res) => {
  const ft = String(req.params.formType || '').trim();
  if (!isValidFormType(ft)) {
    return res.status(404).json({ ok: false, error: `Unknown form type: ${ft}` });
  }
  const cfg = getFormConfig(ft);
  res.json({
    ok: true,
    config: {
      id:          cfg.id,
      label:       cfg.label,
      uspap:       cfg.uspap,
      fields:      cfg.fields      || [],
      docTypes:    cfg.docTypes    || [],
      voiceFields: cfg.voiceFields || [],
    },
  });
});

// ── GET /destination-registry ─────────────────────────────────────────────────
router.get('/destination-registry', (req, res) => {
  try {
    const includeDeferred = req.query?.includeDeferred === 'true';
    const entries = listAllDestinations(includeDeferred);
    res.json({ ok: true, entries, count: entries.length, includeDeferred });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /destination-registry/:formType/:sectionId ────────────────────────────
router.get('/destination-registry/:formType/:sectionId', (req, res) => {
  try {
    const { formType, sectionId } = req.params;
    const includeDeferred = req.query?.includeDeferred === 'true';
    const entry = getDestination(formType, sectionId, includeDeferred);
    if (!entry) {
      return res.status(404).json({
        ok:        false,
        error:     `No destination found for formType="${formType}" sectionId="${sectionId}"`,
        formType,
        sectionId,
      });
    }
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /logs ─────────────────────────────────────────────────────────────────
router.get('/logs', (_req, res) => {
  try {
    const files = getLogFiles();
    res.json({ ok: true, files, count: files.length, logsDir: getLogsDir() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /logs/:date ───────────────────────────────────────────────────────────
router.get('/logs/:date', (req, res) => {
  try {
    const date = String(req.params.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD format' });
    }
    const limit   = Math.min(1000, Math.max(1, parseInt(req.query?.limit) || 200));
    const entries = readLogFile(date);
    const sliced  = entries.slice(-limit);
    res.json({ ok: true, date, entries: sliced, total: entries.length, returned: sliced.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /export/stats ─────────────────────────────────────────────────────────
router.get('/export/stats', (_req, res) => {
  try {
    const stats = getBundleStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /export/bundle ───────────────────────────────────────────────────────
router.post('/export/bundle', async (req, res) => {
  try {
    log.info('[export] Creating support bundle...');
    const result = await createSupportBundle({
      includeAllLogs: Boolean(req.body?.includeAllLogs),
      zip:            req.body?.zip !== false, // default true
    });
    if (!result.ok) {
      return res.status(500).json({ ok: false, error: result.error });
    }
    log.info('[export] Support bundle created', { path: result.bundlePath, isZip: result.isZip });
    res.json({
      ok:         true,
      bundlePath: result.bundlePath,
      isZip:      result.isZip,
      manifest:   result.manifest,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /export/list ──────────────────────────────────────────────────────────
router.get('/export/list', (_req, res) => {
  try {
    const exports = listExports();
    res.json({ ok: true, exports, count: exports.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /templates/neighborhood ───────────────────────────────────────────────
router.get('/templates/neighborhood', (_req, res) => {
  res.json({ ok: true, templates: readJSON(TEMPLATES_FILE, []) });
});

// ── POST /templates/neighborhood ──────────────────────────────────────────────
router.post('/templates/neighborhood', (req, res) => {
  try {
    const name = trimText(req.body?.name, 120);
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    const templates = readJSON(TEMPLATES_FILE, []);
    templates.push({
      id:          uuidv4().replace(/-/g, '').slice(0, 8),
      name,
      boundaries:  trimText(req.body?.boundaries,  600),
      description: trimText(req.body?.description, 1200),
      createdAt:   new Date().toISOString(),
    });
    writeJSON(TEMPLATES_FILE, templates);
    res.json({ ok: true, templates });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DELETE /templates/neighborhood/:id ────────────────────────────────────────
router.delete('/templates/neighborhood/:id', (req, res) => {
  try {
    const templates = readJSON(TEMPLATES_FILE, []).filter(t => t.id !== req.params.id);
    writeJSON(TEMPLATES_FILE, templates);
    res.json({ ok: true, templates });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
