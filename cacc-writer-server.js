/**
 * cacc-writer-server.js
 * ----------------------
 * LEGACY SYSTEM — Core production server (maintained, not extended).
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ARCHITECTURE UPGRADE IN PROGRESS                               ║
 * ║  New workflow system: server/workflow/appraisalWorkflow.ts      ║
 * ║  New agents:          server/agents/{draft,review,verification} ║
 * ║  New tools:           server/tools/{aciTool,realQuantumTool}    ║
 * ║  New retrieval:       server/retrieval/llamaIndex.ts            ║
 * ║  New observability:   server/observability/{langsmith,langfuse} ║
 * ║                                                                  ║
 * ║  All existing endpoints below are PRESERVED and UNCHANGED.      ║
 * ║  New workflow endpoints are added at the bottom of this file.   ║
 * ║  DO NOT EXTEND the legacy generation/insertion logic here.      ║
 * ║  Extend server/workflow/appraisalWorkflow.ts instead.           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
import dotenv from 'dotenv';
dotenv.config({ override: true }); // always prefer .env over system env vars
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { createRequire } from 'module';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_FORM_TYPE, isValidFormType, getFormConfig, listForms, getActiveForms, getDeferredForms } from './forms/index.js';
import { isActiveForm, isDeferredForm, getScopeWarning, logDeferredAccess, getScopeMetaForForm, ACTIVE_FORMS, DEFERRED_FORMS } from './server/config/productionScope.js';
import { spawn } from 'child_process';

// ── Modular server modules (Phase 1: unified architecture) ───────────────────
// These replace the inline collectExamples() and genInput() functions.
// callAI()              → replaces direct client.responses.create() for generation
// addExample()          → saves approved edits to knowledge_base/approved_edits/
// getRelevantExamples() → replaces collectExamples() for KB-driven retrieval
// buildPromptMessages() → replaces genInput() with full 6-block prompt pipeline
// buildReviewMessages() → builds the two-pass review prompt
import { callAI } from './server/openaiClient.js';
import { addExample, indexExamples, addApprovedNarrative } from './server/knowledgeBase.js';
import { getRelevantExamples, getRelevantExamplesWithVoice } from './server/retrieval.js';
import { initFileLogger, writeLogEntry, getLogFiles, readLogFile, getLogsDir } from './server/fileLogger.js';
import { setFileLogWriter } from './server/logger.js';
import { listAllDestinations, getDestination, getTargetSoftware, getFallbackStrategy } from './server/destinationRegistry.js';
import { getBundleStats, createSupportBundle, listExports } from './server/backupExport.js';
import { buildPromptMessages, buildReviewMessages } from './server/promptBuilder.js';
import log from './server/logger.js';
import { geocodeAddress, distanceMiles, cardinalDirection, buildAddressString } from './server/geocoder.js';
import { getNeighborhoodBoundaryFeatures, formatLocationContextBlock, LOCATION_CONTEXT_FIELDS } from './server/neighborhoodContext.js';
import { applyMetaDefaults, extractMetaFields, buildAssignmentMetaBlock } from './server/caseMetadata.js';
import { computeWorkflowStatus, isValidWorkflowStatus, pipelineToWorkflowStatus } from './server/workflowStatus.js';
import { getMissingFacts, formatMissingFactsForUI } from './server/sectionDependencies.js';

// ── Orchestrator imports (Phase 4 — Full-Draft Architecture) ─────────────────
import {
  runFullDraftOrchestrator,
  getRunStatus,
  getRunsForCase,
  getGeneratedSectionsForRun,
} from './server/orchestrator/generationOrchestrator.js';
import {
  runSectionJob,
  getSectionJobsForRun,
} from './server/orchestrator/sectionJobRunner.js';
import {
  buildAssignmentContext,
} from './server/context/assignmentContextBuilder.js';
import { buildReportPlan, getSectionDef } from './server/context/reportPlanner.js';
import { buildRetrievalPack } from './server/context/retrievalPackBuilder.js';
import { runLegacyKbImport, getMemoryItemStats } from './server/migration/legacyKbImport.js';
import { getDb, getDbPath, getDbSizeBytes, getTableCounts } from './server/db/database.js';

const require = createRequire(import.meta.url);

// ── Modular route families (Phase 1 extraction) ───────────────────────────────
import casesRouter      from './server/api/casesRoutes.js';
import generationRouter from './server/api/generationRoutes.js';
import memoryRouter     from './server/api/memoryRoutes.js';
import agentsRouter     from './server/api/agentsRoutes.js';
import healthRouter     from './server/api/healthRoutes.js';

const pdfParse = require('pdf-parse');
let napiCreateCanvas = null;
try { ({ createCanvas: napiCreateCanvas } = require('@napi-rs/canvas')); }
catch (e) { console.warn('OCR stage 3 unavailable (@napi-rs/canvas not loaded):', e.message); }
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDFJS_WORKER_SRC = 'file:///' + path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs').replace(/\\/g, '/');
const CASES_DIR = path.join(__dirname, 'cases');
const CASE_ID_RE = /^[a-f0-9]{8}$/i;
const VOICE_FILE = path.join(__dirname, 'voice_training.json');
const MAX_BATCH_FIELDS = 20;
const PORT = Number(process.env.PORT) || 5178;
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

// ── Automation agent URLs ─────────────────────────────────────────────────────
// ACI agent handles residential forms (1004, 1025, 1073, 1004c) via pywinauto
const ACI_AGENT_URL = process.env.ACI_AGENT_URL || 'http://localhost:5180';
// Real Quantum agent handles commercial form via Playwright browser automation
const RQ_AGENT_URL  = process.env.RQ_AGENT_URL  || 'http://localhost:5181';
const PROMPTS_DIR = path.join(__dirname, 'prompts');

function loadPromptFile(filename) {
  try { return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8').trim(); } catch { return ''; }
}
const _sysMain  = loadPromptFile('system_cacc_writer.txt');
const _sysStyle = loadPromptFile('style_guide_cresci.txt');
const GENERATION_SYSTEM_PROMPT = [_sysMain, _sysStyle].filter(Boolean).join('\n\n---\n\n');
if (GENERATION_SYSTEM_PROMPT) console.log('Prompts loaded: system_cacc_writer.txt + style_guide_cresci.txt (' + GENERATION_SYSTEM_PROMPT.length + ' chars)');

// Build input for narrative generation calls — wraps user prompt with system prompt when available
function genInput(userPrompt) {
  if (!GENERATION_SYSTEM_PROMPT) return userPrompt;
  return [
    { role: 'system', content: GENERATION_SYSTEM_PROMPT },
    { role: 'user',   content: userPrompt }
  ];
}

if (!fs.existsSync(CASES_DIR)) fs.mkdirSync(CASES_DIR, { recursive: true });
const app = express();
app.use(express.json({ limit: '10mb' }));

// ── Request logging middleware ─────────────────────────────────────────────────
// Logs every request with method, path, status, and duration in ms.
// Skips static asset routes to keep logs clean.
app.use((req, res, next) => {
  const start = Date.now();
  const skip = req.path === '/favicon.ico' || req.path === '/app.js' || req.path === '/index.html' || req.path === '/';
  res.on('finish', () => {
    if (!skip) log.request(req.method, req.path, res.statusCode, Date.now() - start);
  });
  next();
});
app.get('/', (_q, r) => r.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (_q, r) => r.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js', (_q, r) => r.sendFile(path.join(__dirname, 'app.js')));
app.get('/favicon.ico', (_q, r) => {
  // Inline gold "C" favicon as SVG
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0b1020"/><text x="16" y="23" font-family="Arial" font-size="20" font-weight="bold" fill="#d7b35a" text-anchor="middle">C</text></svg>';
  r.setHeader('Content-Type', 'image/svg+xml');
  r.setHeader('Cache-Control', 'public, max-age=86400');
  r.send(svg);
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
console.log('CACC Writer starting... Model:', MODEL);
if (!OPENAI_API_KEY) console.warn('OPENAI_API_KEY is missing. AI endpoints will return 503.');

function casePath(id) { return path.join(CASES_DIR, id); }
function trimText(v, max) { return String(v ?? '').trim().slice(0, max || 4000); }
function asArray(v) { return Array.isArray(v) ? v : []; }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb !== undefined ? fb : {}; } }
function writeJSON(p, d) { const t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(d, null, 2), 'utf8'); fs.renameSync(t, p); }

// Simple async mutex for voice_training.json to prevent concurrent write races
let _voiceLock = Promise.resolve();
function withVoiceLock(fn) {
  const next = _voiceLock.then(() => fn()).catch(() => fn());
  _voiceLock = next.catch(() => {});
  return next;
}
function aiText(r) { return r.output_text || r.output?.[0]?.content?.[0]?.text || ''; }
function resolveCaseDir(caseId) {
  if (!CASE_ID_RE.test(String(caseId || ''))) return null;
  const cd = casePath(caseId);
  const rel = path.relative(CASES_DIR, cd);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return cd;
}
function ensureAI(_q, res, next) {
  if (!client) return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY is not configured' });
  next();
}
function normalizeFormType(ft) {
  const s = String(ft || '').trim();
  return isValidFormType(s) ? s : DEFAULT_FORM_TYPE;
}
function getCaseFormConfig(caseDir) {
  const meta = readJSON(path.join(caseDir, 'meta.json'), {});
  const formType = normalizeFormType(meta.formType);
  return { formType, formConfig: getFormConfig(formType), meta };
}
function extractBalancedJSON(src, o, c) {
  const text = String(src || '');
  const start = text.indexOf(o);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) { esc = false; continue; } if (ch === '\\') { esc = true; continue; } if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === o) depth++;
    if (ch === c && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
function parseJSONObject(text) {
  const s = String(text || '').trim();
  const c = s.startsWith('{') ? s : extractBalancedJSON(s, '{', '}');
  if (!c) throw new Error('No JSON object found');
  return JSON.parse(c);
}
function parseJSONArray(text) {
  const s = String(text || '').trim();
  const c = s.startsWith('[') ? s : extractBalancedJSON(s, '[', ']');
  if (!c) throw new Error('No JSON array found');
  return JSON.parse(c);
}
function normSev(v, fb) { const s = String(v || fb || 'minor').toLowerCase(); return ['critical','major','minor'].includes(s) ? s : (fb || 'minor'); }
function normalizeQuestions(raw) {
  return asArray(raw).slice(0, 12).map((q, i) => ({
    id: trimText(q?.id || ('q_' + (i + 1)), 80),
    question: trimText(q?.question, 800),
    field: trimText(q?.field, 120),
    required: Boolean(q?.required),
    hint: trimText(q?.hint, 220),
  })).filter(q => q.question);
}
function normalizeGrade(raw) {
  const g = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const sc = Number(g.score);
  const score = Number.isFinite(sc) ? Math.max(0, Math.min(100, Math.round(sc))) : 0;
  const claimList = (items) => asArray(items).map(x => ({ claim: trimText(x?.claim, 400), field: trimText(x?.field, 180), fix: trimText(x?.fix, 800) })).filter(x => x.claim || x.field || x.fix);
  return {
    score,
    summary: trimText(g.summary, 3000),
    missing: asArray(g.missing).map(x => ({ field: trimText(x?.field, 180), issue: trimText(x?.issue, 1200), severity: normSev(x?.severity, 'major') })).filter(x => x.field || x.issue),
    inconsistencies: asArray(g.inconsistencies).map(x => ({ description: trimText(x?.description, 1200), severity: normSev(x?.severity, 'major') })).filter(x => x.description),
    unsupportedClaims: claimList(g.unsupportedClaims),
    underwriterQuestions: asArray(g.underwriterQuestions).map(x => trimText(typeof x === 'string' ? x : (x?.question || x?.text), 800)).filter(Boolean),
    uspapIssues: asArray(g.uspapIssues).map(x => ({ issue: trimText(x?.issue, 1200), citation: trimText(x?.citation, 300) })).filter(x => x.issue),
    strengths: asArray(g.strengths).map(x => trimText(typeof x === 'string' ? x : (x?.strength || x?.text), 600)).filter(Boolean),
  };
}
function buildFactsContext(facts) {
  if (!facts || !Object.keys(facts).length) return '';
  const s = facts.subject || {}, c = facts.contract || {}, m = facts.market || {};
  const n = facts.neighborhood || {}, a = facts.assignment || {}, comps = facts.comps || [];
  const v = (o) => (o && o.value != null ? o.value : null);
  const L = ['CASE FACT SHEET (use these facts; where null write [INSERT]):'];
  if (Object.keys(s).length) {
    L.push('\nSUBJECT PROPERTY:');
    if (v(s.address)) L.push('  Address: ' + v(s.address) + ', ' + (v(s.city)||'') + ' ' + (v(s.state)||''));
    ['county','gla','beds','baths','yearBuilt','style','basement','garage','condition','quality','siteSize','zoning','parcelId'].forEach(k => { if (v(s[k])) L.push('  ' + k + ': ' + v(s[k])); });
  }
  if (v(c.contractPrice) || v(c.contractDate)) {
    L.push('\nCONTRACT:');
    ['contractPrice','contractDate','closingDate','sellerConcessions','financing','daysOnMarket','offeringHistory'].forEach(k => { if (v(c[k]) != null) L.push('  ' + k + ': ' + v(c[k])); });
  }
  const marketVals = Object.entries(m).filter(([, fobj]) => v(fobj));
  if (marketVals.length) {
    L.push('\nMARKET:');
    marketVals.forEach(([k, fobj]) => L.push('  ' + k + ': ' + v(fobj)));
  }
  if (v(n.boundaries) || v(n.description)) {
    L.push('\nNEIGHBORHOOD:');
    ['boundaries','description','landUse','builtUp'].forEach(k => { if (v(n[k])) L.push('  ' + k + ': ' + v(n[k])); });
  }
  if (v(a.intendedUse) || v(a.intendedUser)) {
    L.push('\nASSIGNMENT:');
    ['intendedUse','intendedUser','effectiveDate','extraordinaryAssumptions','hypotheticalConditions','scopeOfWork'].forEach(k => { if (v(a[k])) L.push('  ' + k + ': ' + v(a[k])); });
  }
  if (comps.length) {
    L.push('\nCOMPARABLE SALES:');
    comps.forEach((comp, i) => {
      L.push('  Comp ' + (i+1) + ':');
      ['address','salePrice','saleDate','gla','dom','adjustments'].forEach(k => { if (v(comp[k])) L.push('    ' + k + ': ' + v(comp[k])); });
    });
  }
  // Generic rendering for non-standard sections (commercial income, improvements, sales, condoProject, etc.)
  const covered = new Set(['subject', 'contract', 'market', 'neighborhood', 'assignment', 'comps', 'extractedAt', 'updatedAt']);
  for (const secKey of Object.keys(facts)) {
    if (covered.has(secKey)) continue;
    const sec = facts[secKey];
    if (Array.isArray(sec)) {
      const hasData = sec.some(item => Object.entries(item).some(([k, fobj]) => k !== 'number' && v(fobj)));
      if (!hasData) continue;
      L.push('\n' + secKey.toUpperCase() + ':');
      sec.forEach((item, i) => {
        L.push('  Item ' + (i + 1) + ':');
        Object.entries(item).forEach(([k, fobj]) => { if (k !== 'number' && v(fobj)) L.push('    ' + k + ': ' + v(fobj)); });
      });
    } else if (sec && typeof sec === 'object') {
      const vals = Object.entries(sec).filter(([, fobj]) => v(fobj));
      if (!vals.length) continue;
      L.push('\n' + secKey.toUpperCase() + ':');
      vals.forEach(([k, fobj]) => L.push('  ' + k + ': ' + v(fobj)));
    }
  }
  return '\n\n' + L.join('\n');
}
function collectExamples(fieldId, limit, formType) {
  try {
    const all = [];
    if (fs.existsSync(CASES_DIR)) {
      const dirs = fs.readdirSync(CASES_DIR)
        .filter(d => CASE_ID_RE.test(d))
        .map(d => { try { return { d, mtime: fs.statSync(path.join(CASES_DIR, d)).mtimeMs }; } catch { return null; } })
        .filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(0, 50).map(x => x.d);
      for (const id of dirs) {
        const fb = readJSON(path.join(CASES_DIR, id, 'feedback.json'), []);
        const meta = readJSON(path.join(CASES_DIR, id, 'meta.json'), {});
        const cft = normalizeFormType(meta.formType);
        all.push(...fb.filter(f => (!fieldId || f.fieldId === fieldId) && (!formType || cft === formType) && f.editedText && f.editedText !== f.originalText && f.rating !== 'down'));
      }
    }
    all.push(...readJSON(VOICE_FILE, []).filter(e => (!fieldId || e.fieldId === fieldId) && (!formType || normalizeFormType(e.formType) === formType) && e.editedText));
    return all.sort((a, b) => new Date(b.savedAt || b.importedAt || 0) - new Date(a.savedAt || a.importedAt || 0)).slice(0, limit || 10);
  } catch { return []; }
}

app.param('caseId', (req, res, next, caseId) => {
  const cd = resolveCaseDir(caseId);
  if (!cd) return res.status(400).json({ ok: false, error: 'Invalid caseId format' });
  req.caseDir = cd; next();
});

// ── Mount modular route families ──────────────────────────────────────────────
// These routers handle the extracted endpoints. Inline handlers below for the
// same routes are shadowed and will be removed in the Phase 1 cleanup pass.
app.use('/api', healthRouter);      // /health, /forms, /logs, /export, /templates, /destination-registry
app.use('/api/cases', casesRouter); // /cases/* (CRUD, geocode, missing-facts, history, generation-runs)
app.use('/api', generationRouter);  // /cases/:caseId/generate-full-draft, /generation/*, /db/*
app.use('/api', memoryRouter);      // /kb/*, /voice/*
app.use('/api', agentsRouter);      // /agents/*, /insert-aci, /insert-rq

// GET /api/forms — returns all forms with scope metadata
// activeForms: only 1004 + commercial (active production)
// deferredForms: 1025, 1073, 1004c (preserved, not actively supported)
app.get('/api/forms', (_q, res) => res.json({
  ok:             true,
  forms:          listForms(),
  activeForms:    getActiveForms(),
  deferredForms:  getDeferredForms(),
  defaultFormType: DEFAULT_FORM_TYPE,
  activeScope:    ACTIVE_FORMS,
  deferredScope:  DEFERRED_FORMS,
}));
app.get('/api/forms/:formType', (req, res) => {
  const ft = String(req.params.formType || '').trim();
  if (!isValidFormType(ft)) return res.status(404).json({ ok: false, error: 'Unknown form type: ' + ft });
  const cfg = getFormConfig(ft);
  res.json({
    ok: true,
    config: {
      id: cfg.id,
      label: cfg.label,
      uspap: cfg.uspap,
      fields: cfg.fields || [],
      docTypes: cfg.docTypes || [],
      voiceFields: cfg.voiceFields || [],
    },
  });
});
app.get('/api/health', (_q, res) => res.json({ ok: true, model: MODEL, version: '2.0.0' }));

// GET /api/health/detailed — comprehensive health check for monitoring
// Returns: server uptime, model, KB status, case count, agent reachability
app.get('/api/health/detailed', async (_q, res) => {
  try {
    const KB_DIR = path.join(__dirname, 'knowledge_base');
    const kbIndex = readJSON(path.join(KB_DIR, 'index.json'), { counts: {}, examples: [] });
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
      ok:          true,
      version:     '2.0.0',
      model:       MODEL,
      uptimeS:     Math.round(process.uptime()),
      aiKeySet:    Boolean(OPENAI_API_KEY),
      kb: {
        totalExamples:    Array.isArray(kbIndex.examples) ? kbIndex.examples.length : 0,
        counts:           kbIndex.counts || {},
        lastUpdated:      kbIndex.lastUpdated || null,
        voiceTrainingCount: voiceCount,
      },
      cases:       { total: caseCount },
      agents:      { aci: aciOk, rq: rqOk },
      pipelineStages: PIPELINE_STAGES,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/generate', ensureAI, async (req, res) => {
  try {
    const { fieldId, formType, caseId, facts: bodyFacts } = req.body;
    const prompt = trimText(req.body?.prompt, 24000);

    // ── Scope enforcement: block generation for deferred form types ───────────
    const requestedFt = String(formType || '').trim().toLowerCase();
    if (requestedFt && isDeferredForm(requestedFt)) {
      logDeferredAccess(requestedFt, 'POST /api/generate', log);
      return res.status(400).json({
        ok:        false,
        supported: false,
        formType:  requestedFt,
        scope:     'deferred',
        message:   `Generation is not available for form type "${requestedFt}". This form type is outside active production scope. Active forms: ${ACTIVE_FORMS.join(', ')}.`,
      });
    }

    // ── Modular pipeline path: use buildPromptMessages() when fieldId is provided ──
    if (fieldId) {
      let caseFacts = bodyFacts || {};
      let locationContext = null;

      // Load facts + optional location context from case directory
      if (caseId && !bodyFacts) {
        const cd = resolveCaseDir(caseId);
        if (cd && fs.existsSync(cd)) {
          caseFacts = readJSON(path.join(cd, 'facts.json'), {});

          // Inject location context for neighborhood/market fields (non-fatal if unavailable)
          if (LOCATION_CONTEXT_FIELDS.has(fieldId)) {
            const geocodeData = readJSON(path.join(cd, 'geocode.json'), null);
            if (geocodeData?.subject?.result?.lat) {
              try {
                const { lat, lng } = geocodeData.subject.result;
                const boundaryFeatures = await getNeighborhoodBoundaryFeatures(lat, lng, 1.5);
                locationContext = formatLocationContextBlock({
                  subject: geocodeData.subject,
                  comps:   geocodeData.comps || [],
                  boundaryFeatures,
                });
              } catch (locErr) {
                log.warn('[generate] location context unavailable (non-fatal):', locErr.message);
              }
            }
          }
        }
      }

      const ft = normalizeFormType(formType);
      // Load assignment meta for context injection (non-fatal if unavailable)
      let _genAssignmentMeta = null;
      if (caseId) {
        const _genCd = resolveCaseDir(caseId);
        if (_genCd && fs.existsSync(_genCd)) {
          const _genRawMeta = readJSON(path.join(_genCd, 'meta.json'), {});
          _genAssignmentMeta = buildAssignmentMetaBlock(applyMetaDefaults(_genRawMeta));
        }
      }
      const { voiceExamples: _genVoice, otherExamples: _genOther } = getRelevantExamplesWithVoice({ formType: ft, fieldId });
      const messages = buildPromptMessages({ formType: ft, fieldId, facts: caseFacts, voiceExamples: _genVoice, examples: _genOther, locationContext, assignmentMeta: _genAssignmentMeta });
      const text = await callAI(messages);
      return res.json({ ok: true, result: text, fieldId, formType: ft, examplesUsed: _genVoice.length + _genOther.length, locationContextInjected: Boolean(locationContext) });
    }

    // ── Legacy path: raw prompt (backward compatibility) ──────────────────────
    if (!prompt) return res.status(400).json({ ok: false, error: 'prompt or fieldId is required' });
    const r = await client.responses.create({ model: MODEL, input: genInput(prompt) });
    res.json({ ok: true, result: aiText(r) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/generate-batch', ensureAI, async (req, res) => {
  try {
    const { fields, caseId, twoPass = false } = req.body;
    if (!Array.isArray(fields) || !fields.length) return res.status(400).json({ ok: false, error: 'fields must be a non-empty array' });
    if (fields.length > MAX_BATCH_FIELDS) return res.status(400).json({ ok: false, error: 'fields must be <= ' + MAX_BATCH_FIELDS });

    // ── Load case context ─────────────────────────────────────────────────────
    let caseFacts = {}, caseDir = null, caseFormType = DEFAULT_FORM_TYPE;
    // Shared location context — loaded once, reused for all location-sensitive fields in the batch
    let _batchLocationContext = null;
    let _batchAssignmentMeta = null; // loaded once, injected into all buildPromptMessages() calls
    if (caseId) {
      caseDir = resolveCaseDir(caseId);
      if (!caseDir) return res.status(400).json({ ok: false, error: 'Invalid caseId format' });
      if (!fs.existsSync(caseDir)) return res.status(404).json({ ok: false, error: 'Case not found' });
      caseFacts = readJSON(path.join(caseDir, 'facts.json'), {});
      const { formType: _batchFt, meta: _batchRawMeta } = getCaseFormConfig(caseDir);
      caseFormType = _batchFt;
      _batchAssignmentMeta = buildAssignmentMetaBlock(applyMetaDefaults(_batchRawMeta || {}));

      // ── Scope enforcement: block batch generation for deferred form types ───
      if (isDeferredForm(caseFormType)) {
        logDeferredAccess(caseFormType, 'POST /api/generate-batch', log);
        return res.status(400).json({
          ok:        false,
          supported: false,
          formType:  caseFormType,
          scope:     'deferred',
          message:   `Batch generation is not available for form type "${caseFormType}". This form type is outside active production scope. Active forms: ${ACTIVE_FORMS.join(', ')}.`,
        });
      }

      // Pre-load location context once if any field in the batch is location-sensitive
      const hasLocationField = fields.some(f => LOCATION_CONTEXT_FIELDS.has(f?.id));
      if (hasLocationField) {
        const geocodeData = readJSON(path.join(caseDir, 'geocode.json'), null);
        if (geocodeData?.subject?.result?.lat) {
          try {
            const { lat, lng } = geocodeData.subject.result;
            const boundaryFeatures = await getNeighborhoodBoundaryFeatures(lat, lng, 1.5);
            _batchLocationContext = formatLocationContextBlock({
              subject: geocodeData.subject,
              comps:   geocodeData.comps || [],
              boundaryFeatures,
            });
          } catch (locErr) {
            log.warn('[generate-batch] location context unavailable (non-fatal):', locErr.message);
          }
        }
      }
    }

    const results = {}, errors = {};
    const CONCURRENCY = 3;
    let qi = 0;

    // ── Per-field generation using full modular pipeline ──────────────────────
    async function processField() {
      while (qi < fields.length) {
        const f = fields[qi++];
        const sid = trimText(f?.id, 80) || ('field_' + Math.random().toString(36).slice(2, 8));
        try {
          // Step 1: Retrieve relevant examples from KB (voice-first)
          const { voiceExamples: _batchVoice, otherExamples: _batchOther } = getRelevantExamplesWithVoice({ formType: caseFormType, fieldId: sid });

          // Step 2: Build full 6-block prompt — inject location context for relevant fields
          const messages = buildPromptMessages({
            formType: caseFormType,
            fieldId: sid,
            facts: caseFacts,
            voiceExamples: _batchVoice,
            examples: _batchOther,
            locationContext: LOCATION_CONTEXT_FIELDS.has(sid) ? _batchLocationContext : null,
            assignmentMeta: _batchAssignmentMeta,
          });

          // Step 3: Draft generation
          let text = await callAI(messages);

          // Step 4: Optional two-pass review
          if (twoPass && text) {
            try {
              const reviewMessages = buildReviewMessages({ draftText: text, facts: caseFacts, fieldId: sid, formType: caseFormType });
              const reviewRaw = await callAI(reviewMessages);
              const reviewResult = JSON.parse(reviewRaw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, ''));
              if (reviewResult?.revisedText) text = reviewResult.revisedText;
            } catch { /* review parse failure is non-fatal — keep draft */ }
          }

          results[sid] = { title: trimText(f?.title, 160) || sid, text, examplesUsed: _batchVoice.length + _batchOther.length };
        } catch (e) { errors[sid] = e?.message || 'Unknown error'; }
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
          history[fid].unshift({ text: existing[fid].text, title: existing[fid].title, savedAt: new Date().toISOString() });
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
  } catch (err) { res.status(500).json({ ok: false, error: 'Batch generation failed' }); }
});

app.post('/api/cases/create', (req, res) => {
  try {
    const requestedFormType = String(req.body?.formType || '').trim().toLowerCase() || DEFAULT_FORM_TYPE;

    // ── Scope enforcement: block new cases for deferred form types ────────────
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
    do { caseId = uuidv4().replace(/-/g, '').slice(0, 8); caseDir = casePath(caseId); } while (fs.existsSync(caseDir));
    // Build base meta with legacy fields
    const baseMeta = {
      caseId,
      address:  trimText(req.body?.address,  240),
      borrower: trimText(req.body?.borrower, 180),
      notes:    trimText(req.body?.notes,    1000),
      formType: normalizeFormType(req.body?.formType),
      status:   'active',
      pipelineStage: 'intake',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Merge new assignment metadata fields
    const assignmentFields = extractMetaFields(req.body, trimText);
    const meta = applyMetaDefaults({ ...baseMeta, ...assignmentFields });
    fs.mkdirSync(path.join(caseDir, 'documents'), { recursive: true });
    ['meta.json','facts.json','doc_text.json','outputs.json'].forEach(f => writeJSON(path.join(caseDir, f), {}));
    writeJSON(path.join(caseDir, 'feedback.json'), []);
    writeJSON(path.join(caseDir, 'meta.json'), meta);
    res.json({ ok: true, caseId, meta });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/cases', (_q, res) => {
  try {
    if (!fs.existsSync(CASES_DIR)) return res.json({ ok: true, cases: [] });
    const dirs = fs.readdirSync(CASES_DIR).filter(d => CASE_ID_RE.test(d) && fs.statSync(path.join(CASES_DIR, d)).isDirectory());
    const cases = dirs.map(id => { try { const m = readJSON(path.join(CASES_DIR, id, 'meta.json')); m.formType = normalizeFormType(m.formType); return m; } catch { return null; } }).filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ ok: true, cases });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/cases/:caseId', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    let meta = readJSON(path.join(cd, 'meta.json'));
    meta.formType = normalizeFormType(meta.formType);
    // Apply defaults for new assignment metadata fields (backward compat)
    meta = applyMetaDefaults(meta);
    const facts   = readJSON(path.join(cd, 'facts.json'));
    const docText = readJSON(path.join(cd, 'doc_text.json'));
    const outputs = readJSON(path.join(cd, 'outputs.json'));
    // Compute current workflowStatus from case state
    meta.workflowStatus = computeWorkflowStatus(meta, facts, outputs);
    const docSummary = {};
    for (const [label, text] of Object.entries(docText)) {
      if (typeof text === 'string') docSummary[label] = { wordCount: text.split(/\s+/).filter(Boolean).length, preview: text.slice(0, 200) };
    }

    // ── Scope status: annotate deferred-form legacy cases ─────────────────────
    // Legacy cases with deferred form types are allowed to load (read-only mode).
    // New generation/insertion is blocked at those endpoints.
    const scopeMeta = getScopeMetaForForm(meta.formType);
    if (scopeMeta.scope === 'deferred') {
      log.warn(`[SCOPE] Legacy deferred-form case loaded — caseId="${req.params.caseId}" formType="${meta.formType}"`);
    }

    res.json({
      ok: true, meta, facts, docSummary, outputs,
      scopeStatus:  scopeMeta.scope,
      scopeSupported: scopeMeta.supported,
      ...(scopeMeta.scope === 'deferred' ? {
        scopeWarning: {
          message: `This case uses form type "${meta.formType}" which is outside active production scope. Generation and insertion are not available. Active forms: ${ACTIVE_FORMS.join(', ')}.`,
          formType: meta.formType,
        }
      } : {}),
    });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.patch('/api/cases/:caseId', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const mf = path.join(cd, 'meta.json');
    let meta = readJSON(mf);
    // Legacy fields
    meta.address  = trimText(req.body?.address  ?? meta.address,  240);
    meta.borrower = trimText(req.body?.borrower ?? meta.borrower, 180);
    if (req.body?.notes    !== undefined) meta.notes    = trimText(req.body.notes, 1000);
    if (req.body?.formType !== undefined) meta.formType = normalizeFormType(req.body.formType);
    // New assignment metadata fields
    const assignmentFields = extractMetaFields(req.body, trimText);
    meta = { ...meta, ...assignmentFields };
    meta.updatedAt = new Date().toISOString();
    writeJSON(mf, meta);
    res.json({ ok: true, meta: applyMetaDefaults(meta) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── GET /api/cases/:caseId/missing-facts/:fieldId ─────────────────────────────
// Returns which required and recommended facts are missing for a given section.
// Used by the UI to show soft warnings before generation.
app.get('/api/cases/:caseId/missing-facts/:fieldId', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const fieldId = trimText(req.params.fieldId, 80);
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId required' });
    const facts = readJSON(path.join(cd, 'facts.json'), {});
    const missing = getMissingFacts(fieldId, facts);
    const formatted = formatMissingFactsForUI(missing);
    res.json({ ok: true, fieldId, ...formatted });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── POST /api/cases/:caseId/missing-facts ─────────────────────────────────────
// Batch version: check missing facts for multiple fields at once.
// Body: { fieldIds: string[] }
// Returns: { ok, warnings: Array<{ fieldId, field, severity, message }> }
// Used by the Generate tab before running a batch to show soft warnings.
// formatMissingFactsForUI returns { required: string[], recommended: string[], hasBlockers }
// We convert those arrays into warning objects with severity tags for the UI.
app.post('/api/cases/:caseId/missing-facts', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const fieldIds = Array.isArray(req.body?.fieldIds) ? req.body.fieldIds : [];
    if (!fieldIds.length) return res.json({ ok: true, warnings: [] });
    const facts = readJSON(path.join(cd, 'facts.json'), {});
    const allWarnings = [];
    for (const rawFieldId of fieldIds) {
      const fieldId = trimText(rawFieldId, 80);
      if (!fieldId) continue;
      try {
        const missing = getMissingFacts(fieldId, facts);
        const formatted = formatMissingFactsForUI(missing);
        // Convert required[] and recommended[] string arrays into warning objects
        for (const label of (formatted.required || [])) {
          allWarnings.push({ fieldId, field: label, severity: 'required', message: `Missing required fact: ${label}` });
        }
        for (const label of (formatted.recommended || [])) {
          allWarnings.push({ fieldId, field: label, severity: 'recommended', message: `Missing recommended fact: ${label}` });
        }
      } catch { /* non-fatal: skip fields with no dependency config */ }
    }
    res.json({ ok: true, warnings: allWarnings });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── PATCH /api/cases/:caseId/workflow-status ──────────────────────────────────
// Manually set the workflowStatus for a case (e.g. flag as exception).
app.patch('/api/cases/:caseId/workflow-status', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const status = trimText(req.body?.workflowStatus, 40);
    if (!isValidWorkflowStatus(status)) {
      return res.status(400).json({ ok: false, error: `Invalid workflowStatus. Valid values: ${['facts_incomplete','ready_for_generation','generation_in_progress','sections_drafted','awaiting_review','automation_ready','insertion_in_progress','verified','exception_flagged'].join(', ')}` });
    }
    const mf = path.join(cd, 'meta.json');
    const meta = readJSON(mf);
    meta.workflowStatus = status;
    meta.updatedAt = new Date().toISOString();
    writeJSON(mf, meta);
    res.json({ ok: true, workflowStatus: status, meta: applyMetaDefaults(meta) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/cases/:caseId/upload', upload.single('file'), async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const isPdf = req.file.mimetype === 'application/pdf' || String(req.file.originalname || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ ok: false, error: 'Only PDF files are allowed' });
    const docType = trimText(req.body.docType || 'unknown', 60).replace(/[^a-z0-9_-]/gi, '_');
    fs.mkdirSync(path.join(cd, 'documents'), { recursive: true });
    fs.writeFileSync(path.join(cd, 'documents', docType + '.pdf'), req.file.buffer);
    // Use full 3-stage OCR pipeline (same as voice import) so scanned PDFs work
    let extractedText = '', pageCount = 0;
    try {
      const { text, method } = await extractPdfText(req.file.buffer, client, MODEL);
      extractedText = text || '';
      // Get page count separately via pdfParse (fast, no OCR needed)
      try { const p = await pdfParse(req.file.buffer); pageCount = p.numpages || 0; } catch { pageCount = 0; }
      console.log('/upload OCR method:', method, 'chars:', extractedText.length, 'docType:', req.body.docType);
    } catch (ocrErr) {
      console.warn('/upload OCR failed:', ocrErr.message);
      extractedText = '[PDF text extraction failed]';
    }
    extractedText = extractedText.replace(/\n{4,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ').trim();
    const dtf = path.join(cd, 'doc_text.json');
    const docText = readJSON(dtf, {}); docText[docType] = extractedText; writeJSON(dtf, docText);
    const mf = path.join(cd, 'meta.json');
    const meta = readJSON(mf); meta.updatedAt = new Date().toISOString();
    if (!meta.docs) meta.docs = {};
    meta.docs[docType] = { uploadedAt: new Date().toISOString(), pages: pageCount, bytes: req.file.size };
    writeJSON(mf, meta);
    res.json({ ok: true, docType, wordCount: extractedText.split(/\s+/).filter(Boolean).length, pages: pageCount, preview: extractedText.slice(0, 400) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/cases/:caseId/extract-facts', ensureAI, async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const docText = readJSON(path.join(cd, 'doc_text.json'), {});
    const existingFacts = readJSON(path.join(cd, 'facts.json'), {});
    const answers = req.body.answers || {};
    const { formType, formConfig } = getCaseFormConfig(cd);
    if (!Object.keys(docText).length && !Object.keys(answers).length) return res.status(400).json({ ok: false, error: 'No documents or answers. Upload PDFs first.' });
    const docBlock = Object.entries(docText).map(([t, x]) => '=== ' + t.toUpperCase() + ' ===\n' + String(x).slice(0, 5000)).join('\n\n');
    const ansBlock = Object.keys(answers).length ? '\n\nAPPRAISER ANSWERS:\n' + Object.entries(answers).map(([q, a]) => 'Q: ' + q + '\nA: ' + a).join('\n\n') : '';
    const ctx = formConfig.extractContext || ('Appraisal data extractor for form ' + formType + '.');
    const prompt = ctx + '\nReturn ONLY valid JSON matching this schema. Use null for missing. confidence: high/medium/low.\n\nSCHEMA:\n' + JSON.stringify(formConfig.factsSchema || {}, null, 2) + '\n\nDOCUMENTS:\n' + docBlock + ansBlock + '\n\nReturn ONLY the JSON object.';
    const r = await client.responses.create({ model: MODEL, input: prompt });
    const facts = parseJSONObject(aiText(r));
    const merged = { ...existingFacts, ...facts, extractedAt: new Date().toISOString() };
    writeJSON(path.join(cd, 'facts.json'), merged);
    res.json({ ok: true, facts: merged });
  } catch (err) { res.status(500).json({ ok: false, error: 'Failed to parse facts JSON: ' + err.message }); }
});

app.post('/api/cases/:caseId/questionnaire', ensureAI, async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const facts = readJSON(path.join(cd, 'facts.json'), {});
    const { formType, formConfig } = getCaseFormConfig(cd);
    const priorities = asArray(formConfig.questionnairePriorities).map((p, i) => (i + 1) + '. ' + p).join('\n');
    const prompt = 'Appraisal assistant for Charlie Cresci. Generate targeted questions for form ' + formType + '.\nPrioritize:\n' + priorities + '\n\nFACT SHEET:\n' + JSON.stringify(facts, null, 2).slice(0, 6000) + '\n\nReturn ONLY JSON array: [{"id":"","question":"","field":"","required":true,"hint":""}]';
    const r = await client.responses.create({ model: MODEL, input: prompt });
    res.json({ ok: true, questions: normalizeQuestions(parseJSONArray(aiText(r))) });
  } catch (err) { res.status(500).json({ ok: false, error: 'Failed: ' + err.message }); }
});

app.post('/api/cases/:caseId/grade', ensureAI, async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const facts = readJSON(path.join(cd, 'facts.json'), {});
    const outputs = readJSON(path.join(cd, 'outputs.json'), {});
    const pastedText = (req.body.pastedText || '').slice(0, 4000);
    const { formType, formConfig } = getCaseFormConfig(cd);
    const narrativesBlock = Object.entries(outputs)
      .filter(([k]) => k !== 'updatedAt')
      .map(([field, r]) => '=== ' + ((r && r.title) || field).toUpperCase() + ' ===\n' + ((r && r.text) || ''))
      .join('\n\n');
    if (!narrativesBlock.trim() && !pastedText) return res.status(400).json({ ok: false, error: 'No narratives to grade.' });
    const rubric = String(formConfig.gradingRubric || '').trim();
    const factStr = JSON.stringify(facts, null, 2).slice(0, 2000);
    const gradeSchema = '{"score":0,"summary":"","missing":[{"field":"","issue":"","severity":"critical"}],"inconsistencies":[{"description":"","severity":"major"}],"unsupportedClaims":[{"claim":"","field":"","fix":""}],"underwriterQuestions":[],"uspapIssues":[{"issue":"","citation":""}],"strengths":[]}';
    const prompt = 'Senior appraisal reviewer and USPAP expert.\nFORM TYPE: ' + formType + '\nSCORING (100 pts):\n' + rubric + '\n\nFACT SHEET:\n' + factStr + '\n\nNARRATIVES:\n' + narrativesBlock + (pastedText ? '\n\nADDITIONAL TEXT:\n' + pastedText : '') + '\n\nReturn ONLY JSON: ' + gradeSchema;
    const r = await client.responses.create({ model: MODEL, input: prompt });
    const grade = normalizeGrade(parseJSONObject(aiText(r)));
    writeJSON(path.join(cd, 'grade.json'), { ...grade, gradedAt: new Date().toISOString() });
    res.json({ ok: true, grade });
  } catch (err) { res.status(500).json({ ok: false, error: 'Failed to parse grade JSON: ' + err.message }); }
});

app.post('/api/cases/:caseId/feedback', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const { fieldId, fieldTitle, originalText, editedText, rating, prompt } = req.body;
    const safeFieldId = trimText(fieldId, 80);
    if (!safeFieldId) return res.status(400).json({ ok: false, error: 'fieldId required' });

    // ── Save to case feedback.json (existing behavior) ────────────────────────
    const feedbackFile = path.join(cd, 'feedback.json');
    const feedback = readJSON(feedbackFile, []);
    const safeEditedText = trimText(editedText, 24000);
    const safeOriginalText = trimText(originalText, 24000);
    feedback.push({
      id: uuidv4(),
      fieldId: safeFieldId,
      fieldTitle: trimText(fieldTitle || safeFieldId, 180),
      prompt: trimText(prompt, 24000),
      originalText: safeOriginalText,
      editedText: safeEditedText,
      rating: rating === 'up' || rating === 'down' ? rating : null,
      savedAt: new Date().toISOString(),
    });
    const capped = feedback.length > 500 ? feedback.slice(-500) : feedback;
    writeJSON(feedbackFile, capped);

    // ── Phase 2.1: Also save to KB when approved (rating=up or text was edited) ──
    // This is the critical loop that makes the KB grow with real approved examples.
    const isApproved = rating === 'up';
    const wasEdited = safeEditedText && safeEditedText !== safeOriginalText && safeEditedText.length > 20;
    if ((isApproved || wasEdited) && safeEditedText) {
      try {
        const { formType, meta: _fbMeta } = getCaseFormConfig(cd);
        addExample({
          fieldId: safeFieldId,
          formType,
          sourceType: 'approved_edit',
          qualityScore: isApproved ? 90 : 80, // explicit approval = higher score
          tags: [],
          text: safeEditedText,
        });
        // Voice engine: also save to approvedNarratives with full metadata (explicit approval only)
        if (isApproved) {
          addApprovedNarrative({
            text:          safeEditedText,
            sectionType:   safeFieldId,
            formType,
            meta:          _fbMeta,
            sourceReportId: req.params.caseId,
            qualityScore:  90,
            approvedBy:    'cresci',
          });
        }
      } catch (kbErr) {
        // KB save failure is non-fatal — log but don't fail the request
        console.warn('[feedback] KB save failed (non-fatal):', kbErr.message);
      }
    }

    res.json({ ok: true, count: capped.length, savedToKB: (isApproved || wasEdited) && Boolean(safeEditedText) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── POST /api/cases/:caseId/review-section ────────────────────────────────────
// Two-pass review: takes a draft narrative and returns a reviewed/revised version
// with a list of issues found (unsupported claims, tone, USPAP, confidence violations).
app.post('/api/cases/:caseId/review-section', ensureAI, async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const { fieldId, draftText } = req.body;
    if (!fieldId)   return res.status(400).json({ ok: false, error: 'fieldId is required' });
    if (!draftText) return res.status(400).json({ ok: false, error: 'draftText is required' });

    const facts = readJSON(path.join(cd, 'facts.json'), {});
    const { formType } = getCaseFormConfig(cd);

    const reviewMessages = buildReviewMessages({ draftText: trimText(draftText, 12000), facts, fieldId, formType });
    const reviewRaw = await callAI(reviewMessages, { timeout: 60_000 });

    // Parse the JSON response from the reviewer
    let reviewResult;
    try {
      const cleaned = reviewRaw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
      reviewResult = JSON.parse(cleaned);
    } catch {
      // If JSON parse fails, return the raw text as revisedText with a parse warning
      return res.json({
        ok: true,
        revisedText: draftText, // keep original if parse fails
        issues: [{ type: 'parse_error', description: 'Review response could not be parsed as JSON', severity: 'minor' }],
        confidence: 'low',
        changesMade: false,
        raw: reviewRaw.slice(0, 500),
      });
    }

    res.json({
      ok: true,
      revisedText: reviewResult.revisedText || draftText,
      issues: Array.isArray(reviewResult.issues) ? reviewResult.issues : [],
      confidence: reviewResult.confidence || 'medium',
      changesMade: Boolean(reviewResult.changesMade),
      fieldId,
      formType,
    });
  } catch (err) {
    console.error('[/review-section]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Knowledge Base management endpoints ───────────────────────────────────────

// GET /api/kb/status — return KB health: counts of all example types
app.get('/api/kb/status', (_q, res) => {
  try {
    const KB_DIR = path.join(__dirname, 'knowledge_base');
    const index = readJSON(path.join(KB_DIR, 'index.json'), { counts: {}, examples: [] });
    const voiceCount = readJSON(VOICE_FILE, []).length;
    res.json({
      ok: true,
      counts: index.counts || {},
      totalExamples: Array.isArray(index.examples) ? index.examples.length : 0,
      lastUpdated: index.lastUpdated || null,
      voiceTrainingCount: voiceCount,
    });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/kb/reindex — rebuild KB index from disk
app.post('/api/kb/reindex', (_q, res) => {
  try {
    const index = indexExamples();
    res.json({ ok: true, counts: index.counts, total: Array.isArray(index.examples) ? index.examples.length : 0 });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/kb/migrate-voice — migrate voice_training.json entries into the KB
// This populates the KB from existing voice training data (one-time migration).
app.post('/api/kb/migrate-voice', (_q, res) => {
  try {
    const voiceEntries = readJSON(VOICE_FILE, []);
    if (!voiceEntries.length) {
      return res.json({ ok: true, migrated: 0, message: 'No voice training entries to migrate.' });
    }
    let migrated = 0, skipped = 0;
    for (const entry of voiceEntries) {
      const text = trimText(entry.editedText || entry.text || '', 8000);
      if (!text || text.length < 20) { skipped++; continue; }
      try {
        addExample({
          fieldId: entry.fieldId || 'unknown',
          formType: normalizeFormType(entry.formType),
          sourceType: 'imported',
          qualityScore: 70,
          tags: [],
          text,
        });
        migrated++;
      } catch { skipped++; }
    }
    res.json({ ok: true, migrated, skipped, total: voiceEntries.length });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Geospatial / Location Context endpoints ───────────────────────────────────

/**
 * POST /api/cases/:caseId/geocode
 * Geocodes the subject address and all comp addresses from facts.json.
 * Calculates distance (miles) and cardinal direction from subject to each comp.
 * Saves results to geocode.json in the case directory.
 * Results are cached — re-call to refresh after facts change.
 */
app.post('/api/cases/:caseId/geocode', async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const facts = readJSON(path.join(cd, 'facts.json'), {});

    // ── Build subject address string ──────────────────────────────────────────
    // facts.json uses flat keys: subject_address, subject_city, subject_state, subject_zip
    // Each value may be a plain string OR a { value, confidence } object.
    const fv = (key) => { const f = facts[key]; return f ? String(f?.value ?? f ?? '').trim() : ''; };
    const subjectAddress = buildAddressString(facts, 'subject')
      || (() => {
          const street = fv('subject_address');
          if (!street) return null;
          // If subject_address already contains a comma it's a full address — use as-is
          // to avoid doubling city/state/zip (e.g. "123 Main St, Bloomington, IL 61701")
          if (street.includes(',')) return street;
          const city = fv('subject_city');
          const state = fv('subject_state');
          const zip   = fv('subject_zip');
          return [street, city, state, zip].filter(Boolean).join(', ');
        })()
      || (req.body?.subjectAddress ? String(req.body.subjectAddress).trim() : null);

    if (!subjectAddress) {
      return res.status(400).json({ ok: false, error: 'No subject address found in facts. Extract facts first or provide subjectAddress in request body.' });
    }

    // ── Geocode subject ───────────────────────────────────────────────────────
    const subjectResult = await geocodeAddress(subjectAddress);
    if (!subjectResult) {
      return res.status(422).json({ ok: false, error: `Could not geocode subject address: "${subjectAddress}". Check the address format.` });
    }

    // ── Geocode comps ─────────────────────────────────────────────────────────
    const compsData = [];
    const rawComps = Array.isArray(facts.comps) ? facts.comps : [];

    for (let i = 0; i < rawComps.length; i++) {
      const comp = rawComps[i];
      const compAddr = buildAddressString(facts, null) || (() => {
        // Try to build address from comp object directly
        const v = (key) => {
          const f = comp[key];
          return f ? String(f?.value ?? f ?? '').trim() : '';
        };
        const street = v('address');
        const city   = v('city');
        const state  = v('state');
        if (!street) return null;
        return [street, city, state].filter(Boolean).join(', ');
      })();

      // Build comp address from comp fields
      const v = (key) => { const f = comp[key]; return f ? String(f?.value ?? f ?? '').trim() : ''; };
      const street = v('address');
      const city   = v('city') || subjectResult.city || '';
      const state  = v('state') || subjectResult.state || '';
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

      compsData.push({
        index:     i + 1,
        address:   fullAddr,
        result:    compResult,
        distance,
        direction,
      });
    }

    // ── Save geocode.json ─────────────────────────────────────────────────────
    const geocodeData = {
      subject:    { address: subjectAddress, result: subjectResult },
      comps:      compsData,
      geocodedAt: new Date().toISOString(),
    };
    writeJSON(path.join(cd, 'geocode.json'), geocodeData);

    res.json({
      ok:      true,
      subject: { address: subjectAddress, lat: subjectResult.lat, lng: subjectResult.lng, city: subjectResult.city, county: subjectResult.county, state: subjectResult.state },
      comps:   compsData.map(c => ({ index: c.index, address: c.address, distance: c.distance, direction: c.direction, city: c.result?.city || null, error: c.error || null })),
      geocodedAt: geocodeData.geocodedAt,
    });
  } catch (err) {
    console.error('[/geocode]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/cases/:caseId/location-context
 * Returns full location context: geocode data + neighborhood boundary features.
 * Uses cached geocode.json if available; runs Overpass query for boundary features.
 * This data is injected into the AI prompt for neighborhood/market fields.
 *
 * Query params:
 *   ?refresh=true  — re-run geocoding even if cached
 *   ?radius=1.5    — Overpass search radius in miles (default 1.5)
 */
app.get('/api/cases/:caseId/location-context', async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const refresh = req.query?.refresh === 'true';
    const radius  = Math.max(0.5, Math.min(5, parseFloat(req.query?.radius) || 1.5));

    // ── Load or refresh geocode data ──────────────────────────────────────────
    let geocodeData = readJSON(path.join(cd, 'geocode.json'), null);
    if (!geocodeData || refresh) {
      return res.status(400).json({
        ok: false,
        error: 'No geocode data found. Run POST /api/cases/:caseId/geocode first.',
        hint: 'POST /api/cases/' + req.params.caseId + '/geocode',
      });
    }

    const { lat, lng } = geocodeData.subject?.result || {};
    if (!lat || !lng) {
      return res.status(422).json({ ok: false, error: 'Geocode data is missing subject coordinates. Re-run geocode.' });
    }

    // ── Query Overpass for boundary features ──────────────────────────────────
    const boundaryFeatures = await getNeighborhoodBoundaryFeatures(lat, lng, radius);

    // ── Format the full location context block ────────────────────────────────
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
      locationContextBlock, // ready to inject into buildPromptMessages()
      geocodedAt:           geocodeData.geocodedAt,
      radiusMiles:          radius,
    });
  } catch (err) {
    console.error('[/location-context]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/similar-examples', (req, res) => {
  try {
    const { fieldId, limit = 3, formType } = req.body;
    const safeLimit = Math.max(1, Math.min(Number(limit) || 3, 10));
    const normalized = formType ? normalizeFormType(formType) : null;
    res.json({ ok: true, examples: collectExamples(trimText(fieldId, 80) || null, safeLimit, normalized) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/cases/:caseId/history', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({ ok: true, history: readJSON(path.join(cd, 'history.json'), {}) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.put('/api/cases/:caseId/facts', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const factsFile = path.join(cd, 'facts.json');
    const updated = { ...readJSON(factsFile, {}), ...req.body, updatedAt: new Date().toISOString() };
    writeJSON(factsFile, updated);
    const meta = readJSON(path.join(cd, 'meta.json'));
    meta.updatedAt = new Date().toISOString();
    writeJSON(path.join(cd, 'meta.json'), meta);
    res.json({ ok: true, facts: updated });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

const TEMPLATES_FILE = path.join(__dirname, 'neighborhood_templates.json');
app.get('/api/templates/neighborhood', (_q, res) => res.json({ ok: true, templates: readJSON(TEMPLATES_FILE, []) }));
app.post('/api/templates/neighborhood', (req, res) => {
  try {
    const name = trimText(req.body?.name, 120);
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    const templates = readJSON(TEMPLATES_FILE, []);
    templates.push({ id: uuidv4().replace(/-/g, '').slice(0, 8), name, boundaries: trimText(req.body?.boundaries, 600), description: trimText(req.body?.description, 1200), createdAt: new Date().toISOString() });
    writeJSON(TEMPLATES_FILE, templates);
    res.json({ ok: true, templates });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.delete('/api/templates/neighborhood/:id', (req, res) => {
  try {
    const templates = readJSON(TEMPLATES_FILE, []).filter(t => t.id !== req.params.id);
    writeJSON(TEMPLATES_FILE, templates);
    res.json({ ok: true, templates });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.patch('/api/cases/:caseId/status', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const nextStatus = trimText(req.body?.status, 20).toLowerCase() || 'active';
    if (!['active', 'submitted', 'archived'].includes(nextStatus)) return res.status(400).json({ ok: false, error: 'Invalid status' });
    const mf = path.join(cd, 'meta.json');
    const meta = readJSON(mf);
    meta.status = nextStatus;
    meta.updatedAt = new Date().toISOString();
    writeJSON(mf, meta);
    res.json({ ok: true, meta });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Phase 8: Pipeline status tracking ────────────────────────────────────────
// Pipeline stages: intake → extracting → generating → review → approved → inserting → complete
const PIPELINE_STAGES = ['intake', 'extracting', 'generating', 'review', 'approved', 'inserting', 'complete'];

// PATCH /api/cases/:caseId/pipeline — advance or set the pipeline stage
app.patch('/api/cases/:caseId/pipeline', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const stage = trimText(req.body?.stage, 20).toLowerCase();
    if (!PIPELINE_STAGES.includes(stage)) {
      return res.status(400).json({ ok: false, error: `Invalid stage. Must be one of: ${PIPELINE_STAGES.join(', ')}` });
    }
    const mf = path.join(cd, 'meta.json');
    const meta = readJSON(mf);
    meta.pipelineStage = stage;
    meta.updatedAt = new Date().toISOString();
    if (!meta.pipelineHistory) meta.pipelineHistory = [];
    meta.pipelineHistory.push({ stage, at: meta.updatedAt });
    writeJSON(mf, meta);
    res.json({ ok: true, pipelineStage: stage, meta });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Phase 8: Section-level approval ──────────────────────────────────────────

// PATCH /api/cases/:caseId/outputs/:fieldId — approve or reject a single section
app.patch('/api/cases/:caseId/outputs/:fieldId', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    const fieldId = trimText(req.params.fieldId, 80);
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId required' });

    const outFile = path.join(cd, 'outputs.json');
    const outputs = readJSON(outFile, {});
    if (!outputs[fieldId]) return res.status(404).json({ ok: false, error: `Field '${fieldId}' not found in outputs` });

    const { approved, text } = req.body;
    const now = new Date().toISOString();

    // Allow text update (manual edit) alongside approval
    if (text !== undefined) {
      outputs[fieldId].text = trimText(text, 24000);
      outputs[fieldId].editedAt = now;
    }
    if (approved !== undefined) {
      outputs[fieldId].approved = Boolean(approved);
      outputs[fieldId].approvedAt = approved ? now : null;
    }
    outputs[fieldId].updatedAt = now;
    outputs.updatedAt = now;
    writeJSON(outFile, outputs);

    // If text was edited and approved, also save to KB + approvedNarratives
    if (approved && outputs[fieldId].text) {
      try {
        const { formType, meta: _outMeta } = getCaseFormConfig(cd);
        addExample({
          fieldId,
          formType,
          sourceType: 'approved_edit',
          qualityScore: 90,
          tags: [],
          text: outputs[fieldId].text,
        });
        // Voice engine: also save to approvedNarratives with full metadata
        addApprovedNarrative({
          text:          outputs[fieldId].text,
          sectionType:   fieldId,
          formType,
          meta:          _outMeta,
          sourceReportId: req.params.caseId,
          qualityScore:  90,
          approvedBy:    'cresci',
        });
      } catch (kbErr) {
        console.warn('[outputs patch] KB save failed (non-fatal):', kbErr.message);
      }
    }

    res.json({ ok: true, fieldId, approved: outputs[fieldId].approved, updatedAt: now });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Phase 8: generate-all ─────────────────────────────────────────────────────
// Generate all configured fields for a case in one call.
// Uses the same modular pipeline as generate-batch.
app.post('/api/cases/:caseId/generate-all', ensureAI, async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const { twoPass = false, fieldIds } = req.body;
    const caseFacts = readJSON(path.join(cd, 'facts.json'), {});
    const { formType, formConfig, meta: _genAllRawMeta } = getCaseFormConfig(cd);
    const _genAllAssignmentMeta = buildAssignmentMetaBlock(applyMetaDefaults(_genAllRawMeta || {}));

    // Determine which fields to generate
    const allFields = asArray(formConfig.fields).filter(f => f.id && f.title);
    const targetFields = fieldIds && Array.isArray(fieldIds) && fieldIds.length
      ? allFields.filter(f => fieldIds.includes(f.id))
      : allFields;

    if (!targetFields.length) {
      return res.status(400).json({ ok: false, error: 'No fields configured for this form type' });
    }
    if (targetFields.length > MAX_BATCH_FIELDS) {
      return res.status(400).json({ ok: false, error: `Too many fields (${targetFields.length} > ${MAX_BATCH_FIELDS})` });
    }

    // Pre-load location context once for all location-sensitive fields in this generate-all run
    let _genAllLocationContext = null;
    const hasLocationField = targetFields.some(f => LOCATION_CONTEXT_FIELDS.has(f.id));
    if (hasLocationField) {
      const geocodeData = readJSON(path.join(cd, 'geocode.json'), null);
      if (geocodeData?.subject?.result?.lat) {
        try {
          const { lat, lng } = geocodeData.subject.result;
          const boundaryFeatures = await getNeighborhoodBoundaryFeatures(lat, lng, 1.5);
          _genAllLocationContext = formatLocationContextBlock({
            subject: geocodeData.subject,
            comps:   geocodeData.comps || [],
            boundaryFeatures,
          });
        } catch (locErr) {
          log.warn('[generate-all] location context unavailable (non-fatal):', locErr.message);
        }
      }
    }

    // Advance pipeline stage to 'generating'
    const mf = path.join(cd, 'meta.json');
    const meta = readJSON(mf);
    meta.pipelineStage = 'generating';
    meta.updatedAt = new Date().toISOString();
    writeJSON(mf, meta);

    const results = {}, errors = {};
    const CONCURRENCY = 3;
    let qi = 0;

    async function processField() {
      while (qi < targetFields.length) {
        const f = targetFields[qi++];
        const sid = f.id;
        try {
          const { voiceExamples: _allVoice, otherExamples: _allOther } = getRelevantExamplesWithVoice({ formType, fieldId: sid });
          const messages  = buildPromptMessages({
            formType,
            fieldId: sid,
            facts: caseFacts,
            voiceExamples: _allVoice,
            examples: _allOther,
            locationContext: LOCATION_CONTEXT_FIELDS.has(sid) ? _genAllLocationContext : null,
            assignmentMeta: _genAllAssignmentMeta,
          });
          let text = await callAI(messages);

          if (twoPass && text) {
            try {
              const reviewMessages = buildReviewMessages({ draftText: text, facts: caseFacts, fieldId: sid, formType });
              const reviewRaw = await callAI(reviewMessages);
              const reviewResult = JSON.parse(reviewRaw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, ''));
              if (reviewResult?.revisedText) text = reviewResult.revisedText;
            } catch { /* non-fatal */ }
          }

          results[sid] = { title: f.title, text, examplesUsed: _allVoice.length + _allOther.length, approved: false };
        } catch (e) { errors[sid] = e?.message || 'Unknown error'; }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targetFields.length) }, processField));

    // Save outputs and advance pipeline to 'review'
    const outFile = path.join(cd, 'outputs.json');
    const existing = readJSON(outFile, {});
    const histFile = path.join(cd, 'history.json');
    const history  = readJSON(histFile, {});
    for (const fid of Object.keys(results)) {
      if (existing[fid]?.text) {
        if (!history[fid]) history[fid] = [];
        history[fid].unshift({ text: existing[fid].text, title: existing[fid].title, savedAt: new Date().toISOString() });
        history[fid] = history[fid].slice(0, 3);
      }
    }
    writeJSON(histFile, history);
    writeJSON(outFile, { ...existing, ...results, updatedAt: new Date().toISOString() });

    meta.pipelineStage = Object.keys(errors).length === targetFields.length ? 'generating' : 'review';
    meta.updatedAt = new Date().toISOString();
    writeJSON(mf, meta);

    res.json({
      ok: true,
      results,
      errors,
      formType,
      pipelineStage: meta.pipelineStage,
      generated: Object.keys(results).length,
      failed: Object.keys(errors).length,
    });
  } catch (err) {
    console.error('[/generate-all]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Phase 8: insert-all ───────────────────────────────────────────────────────
// Insert all approved sections from outputs.json into ACI or Real Quantum.
// Only sections with approved=true are inserted.
app.post('/api/cases/:caseId/insert-all', async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const outputs = readJSON(path.join(cd, 'outputs.json'), {});
    const { formType } = getCaseFormConfig(cd);

    // Collect approved sections
    const approvedSections = Object.entries(outputs)
      .filter(([k, v]) => k !== 'updatedAt' && v?.text && v?.approved === true)
      .map(([fieldId, v]) => ({ fieldId, text: v.text, title: v.title }));

    if (!approvedSections.length) {
      return res.status(400).json({ ok: false, error: 'No approved sections to insert. Approve sections first.' });
    }

    // Determine which agent to use based on form type
    const isCommercial = formType === 'commercial';
    const agentUrl = isCommercial ? RQ_AGENT_URL : ACI_AGENT_URL;
    const agentName = isCommercial ? 'Real Quantum' : 'ACI';

    // Advance pipeline to 'inserting'
    const mf = path.join(cd, 'meta.json');
    const meta = readJSON(mf);
    meta.pipelineStage = 'inserting';
    meta.updatedAt = new Date().toISOString();
    writeJSON(mf, meta);

    // Call the agent's /insert-batch endpoint
    let agentRes, agentData;
    try {
      agentRes = await fetch(`${agentUrl}/insert-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formType, fields: approvedSections }),
        signal: AbortSignal.timeout(120_000),
      });
      agentData = await agentRes.json().catch(() => ({}));
    } catch (fetchErr) {
      const connRefused = fetchErr.code === 'ECONNREFUSED' || fetchErr.cause?.code === 'ECONNREFUSED';
      return res.status(503).json({
        ok: false,
        error: `${agentName} agent is not running. Start it first.`,
        connRefused,
      });
    }

    if (!agentRes.ok) {
      return res.status(502).json({ ok: false, error: `${agentName} agent returned ${agentRes.status}`, agent: agentData });
    }

    // Mark inserted sections in outputs.json with sectionStatus lifecycle
    const insertedFields = Object.keys(agentData.results || {});
    const outFile = path.join(cd, 'outputs.json');
    const updatedOutputs = readJSON(outFile, {});
    const now = new Date().toISOString();
    for (const fid of insertedFields) {
      if (updatedOutputs[fid]) {
        updatedOutputs[fid].insertedAt      = now;
        updatedOutputs[fid].insertMethod    = agentData.results[fid]?.method || 'unknown';
        updatedOutputs[fid].sectionStatus   = 'inserted';
        updatedOutputs[fid].statusUpdatedAt = now;
      }
    }
    // Mark failed insertions as error
    for (const [fid, errMsg] of Object.entries(agentData.errors || {})) {
      if (updatedOutputs[fid]) {
        updatedOutputs[fid].sectionStatus   = 'error';
        updatedOutputs[fid].statusNote      = String(errMsg).slice(0, 300);
        updatedOutputs[fid].statusUpdatedAt = now;
      }
    }
    updatedOutputs.updatedAt = now;
    writeJSON(outFile, updatedOutputs);

    // Advance pipeline to 'complete' if all approved sections were inserted
    const allInserted = approvedSections.every(s => insertedFields.includes(s.fieldId));
    meta.pipelineStage = allInserted ? 'complete' : 'inserting';
    meta.updatedAt = now;
    writeJSON(mf, meta);

    res.json({
      ok: true,
      inserted: insertedFields.length,
      errors: agentData.errors || {},
      results: agentData.results || {},
      pipelineStage: meta.pipelineStage,
      agentName,
    });
  } catch (err) {
    console.error('[/insert-all]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- PDF TEXT EXTRACTION (3-stage: pdf-parse → pdfjs-dist text → OCR via OpenAI Vision) ---
async function extractPdfText(buffer, aiClient, model) {
  // Stage 1: pdf-parse (fast, works for digitally-created PDFs)
  try {
    const p = await pdfParse(buffer);
    const text = (p.text || '').replace(/\n{4,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ').trim();
    if (text.length >= 200) return { text, method: 'pdf-parse' };
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('encrypt') || msg.includes('password'))
      return { text: '', method: 'failed', error: 'PDF is password-protected. Remove the password and try again.' };
  }

  // Stage 2: pdfjs-dist text extraction (handles more PDF variants)
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
    let fullText = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(item => item.str || '').join(' ') + '\n';
    }
    const text = fullText.replace(/\n{4,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ').trim();
    if (text.length >= 200) return { text, method: 'pdfjs-text' };
  } catch {}

  // Stage 3: OCR — render pages with pdfjs-dist + @napi-rs/canvas → OpenAI Vision
  if (!aiClient) return { text: '', method: 'failed', error: 'PDF appears image-based and no AI client is available for OCR.' };
  if (!napiCreateCanvas) return { text: '', method: 'failed', error: 'PDF appears image-based but OCR canvas is unavailable (@napi-rs/canvas failed to load).' };
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    class NodeCanvasFactory {
      create(w, h) { const canvas = napiCreateCanvas(w, h); return { canvas, context: canvas.getContext('2d') }; }
      reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; }
      destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; cc.canvas = null; cc.context = null; }
    }
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
    const pageCount = Math.min(pdf.numPages, 15);
    let ocrText = '';
    for (let i = 1; i <= pageCount; i++) {
      try {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const factory = new NodeCanvasFactory();
        const cc = factory.create(Math.round(viewport.width), Math.round(viewport.height));
        await page.render({ canvasContext: cc.context, viewport, canvasFactory: factory }).promise;
        const base64 = cc.canvas.toBuffer('image/png').toString('base64');
        factory.destroy(cc);
        const r = await aiClient.responses.create({ model, input: [{ role: 'user', content: [
          { type: 'input_text', text: 'Extract all text from this appraisal report page. Return raw text only, preserving paragraph structure. No commentary.' },
          { type: 'input_image', image_url: 'data:image/png;base64,' + base64, detail: 'high' }
        ]}]}, { signal: AbortSignal.timeout(30000) });
        ocrText += (r.output_text || '') + '\n\n';
      } catch (pageErr) { console.warn('OCR page', i, 'error:', pageErr.message); }
    }
    const text = ocrText.replace(/\n{4,}/g, '\n\n').trim();
    if (text.length >= 200) return { text, method: 'ocr-vision' };
    return { text: '', method: 'failed', error: 'OCR extracted insufficient text from this PDF.' };
  } catch (err) { return { text: '', method: 'failed', error: 'OCR failed: ' + err.message }; }
}

app.post('/api/voice/import-pdf', ensureAI, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const isPdf = req.file.mimetype === 'application/pdf' || String(req.file.originalname || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ ok: false, error: 'Only PDF files are allowed' });
    const requestedFormType = normalizeFormType(req.body?.formType || req.query?.formType || DEFAULT_FORM_TYPE);
    const formConfig = getFormConfig(requestedFormType);
    const voiceFields = asArray(formConfig.voiceFields);
    if (!voiceFields.length) return res.status(400).json({ ok: false, error: 'No voice fields configured for this form type' });
    const { text: pdfText, method: extractMethod, error: extractError } = await extractPdfText(req.file.buffer, client, MODEL);
    console.log('Voice import-pdf:', req.file.originalname, '— method:', extractMethod, 'chars:', pdfText.length);
    if (!pdfText || pdfText.length < 200) {
      return res.status(422).json({ ok: false, error: extractError || 'Could not extract sufficient text from this PDF (method: ' + extractMethod + ').' });
    }
    const fieldList = voiceFields.map(f => '  "' + f.id + '": "' + f.title + '"').join(',\n');
    const prompt = 'Extract ONLY narrative text for each field. Form: ' + requestedFormType + '.\nReturn ONLY JSON:\n{\n' + fieldList + '\n}\n\nREPORT TEXT:\n' + pdfText.slice(0, 28000);
    const r = await client.responses.create({ model: MODEL, input: prompt });
    const extracted = parseJSONObject(aiText(r));
    const existing = readJSON(VOICE_FILE, []);
    const importedAt = new Date().toISOString();
    const importId = uuidv4().replace(/-/g, '').slice(0, 8);
    const filename = trimText(req.file.originalname || 'unknown.pdf', 180);
    const added = [];
    for (const field of voiceFields) {
      const text = trimText(extracted[field.id] || '', 8000);
      if (!text || text.length < 20) continue;
      existing.push({ id: uuidv4().replace(/-/g, '').slice(0, 12), importId, filename, fieldId: field.id, fieldTitle: field.title, editedText: text, source: 'import', formType: requestedFormType, importedAt });
      added.push(field.id);
      // Phase 2.4: Also save to KB so new imports immediately improve generation
      try { addExample({ fieldId: field.id, formType: requestedFormType, sourceType: 'imported', qualityScore: 70, tags: [], text }); } catch { /* non-fatal */ }
    }
    await withVoiceLock(() => {
      const latest = readJSON(VOICE_FILE, []);
      for (const entry of added.map(fieldId => existing.find(e => e.importId === importId && e.fieldId === fieldId)).filter(Boolean)) {
        if (!latest.some(e => e.id === entry.id)) latest.push(entry);
      }
      const capped = latest.length > 500 ? latest.slice(-500) : latest;
      writeJSON(VOICE_FILE, capped);
    });
    const total = readJSON(VOICE_FILE, []).length;
    res.json({ ok: true, importId, filename, formType: requestedFormType, extracted: added, total });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/voice/examples', (req, res) => {
  try {
    const requested = req.query?.formType ? normalizeFormType(req.query.formType) : null;
    const examples = readJSON(VOICE_FILE, []).filter(e => !requested || normalizeFormType(e.formType) === requested);
    const byImport = {};
    for (const e of examples) {
      if (!byImport[e.importId]) byImport[e.importId] = { importId: e.importId, filename: e.filename, importedAt: e.importedAt, formType: e.formType, fields: [], previews: {} };
      byImport[e.importId].fields.push(e.fieldId);
      if (!byImport[e.importId].previews[e.fieldId]) byImport[e.importId].previews[e.fieldId] = trimText(e.editedText, 400);
    }
    const counts = {};
    for (const e of examples) counts[e.fieldId] = (counts[e.fieldId] || 0) + 1;
    res.json({ ok: true, total: examples.length, counts, imports: Object.values(byImport).sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt)) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

function deleteVoiceExamplesBy(field, rawValue, res) {
  try {
    const val = trimText(rawValue, 20);
    const examples = readJSON(VOICE_FILE, []).filter(e => e[field] !== val);
    writeJSON(VOICE_FILE, examples);
    res.json({ ok: true, total: examples.length });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
}
app.delete('/api/voice/examples/import/:importId', (req, res) => deleteVoiceExamplesBy('importId', req.params.importId, res));
app.delete('/api/voice/examples/:id', (req, res) => deleteVoiceExamplesBy('id', req.params.id, res));

const VOICE_PDFS_DIR = path.join(__dirname, 'voice_pdfs');

// POST /api/voice/import-folder  — scan voice_pdfs/<formType>/ and import any new PDFs
app.post('/api/voice/import-folder', ensureAI, async (req, res) => {
  try {
    const requestedFormType = normalizeFormType(req.body?.formType || DEFAULT_FORM_TYPE);
    const formConfig = getFormConfig(requestedFormType);
    const voiceFields = asArray(formConfig.voiceFields);
    if (!voiceFields.length) return res.status(400).json({ ok: false, error: 'No voice fields configured for this form type' });

    const folderPath = path.join(VOICE_PDFS_DIR, requestedFormType);
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ ok: false, error: 'Folder not found: voice_pdfs/' + requestedFormType + '/. Create it and drop PDFs inside.' });
    }

    // Find all PDF files in the subfolder
    const allFiles = fs.readdirSync(folderPath).filter(f => /\.pdf$/i.test(f));
    if (!allFiles.length) {
      return res.json({ ok: true, formType: requestedFormType, scanned: 0, imported: [], skipped: [], total: readJSON(VOICE_FILE, []).length });
    }

    // Build set of already-imported filenames for this formType
    const existing = readJSON(VOICE_FILE, []);
    const alreadyImported = new Set(
      existing
        .filter(e => normalizeFormType(e.formType) === requestedFormType)
        .map(e => e.filename)
    );

    const toImport = allFiles.filter(f => !alreadyImported.has(f));
    const skipped = allFiles.filter(f => alreadyImported.has(f));

    if (!toImport.length) {
      return res.json({ ok: true, formType: requestedFormType, scanned: allFiles.length, imported: [], skipped, message: 'All PDFs already imported. Drop new PDFs into voice_pdfs/' + requestedFormType + '/ to add more.', total: existing.length });
    }

    const fieldList = voiceFields.map(f => '  "' + f.id + '": "' + f.title + '"').join(',\n');
    const importedFiles = [];
    const errors = [];
    const importedAt = new Date().toISOString();

    for (const filename of toImport) {
      const filePath = path.join(folderPath, filename);
      try {
        const buffer = fs.readFileSync(filePath);
        const { text: pdfText, method: extractMethod, error: extractError } = await extractPdfText(buffer, client, MODEL);
        console.log('Voice import-folder:', filename, '— method:', extractMethod, 'chars:', pdfText.length);
        if (!pdfText || pdfText.length < 200) {
          errors.push({ filename, error: extractError || 'Could not extract text (method: ' + extractMethod + ')' });
          continue;
        }

        const prompt = 'Extract ONLY narrative text for each field. Form: ' + requestedFormType + '.\nReturn ONLY JSON:\n{\n' + fieldList + '\n}\n\nREPORT TEXT:\n' + pdfText.slice(0, 28000);
        const r = await client.responses.create({ model: MODEL, input: prompt });
        const extracted = parseJSONObject(aiText(r));

        const importId = uuidv4().replace(/-/g, '').slice(0, 8);
        let addedCount = 0;
        for (const field of voiceFields) {
          const text = trimText(extracted[field.id] || '', 8000);
          if (!text || text.length < 20) continue;
          existing.push({
            id: uuidv4().replace(/-/g, '').slice(0, 12),
            importId,
            filename,
            fieldId: field.id,
            fieldTitle: field.title,
            editedText: text,
            source: 'folder',
            formType: requestedFormType,
            importedAt,
          });
          addedCount++;
          // Phase 2.4: Also save to KB so folder imports immediately improve generation
          try { addExample({ fieldId: field.id, formType: requestedFormType, sourceType: 'imported', qualityScore: 70, tags: [], text }); } catch { /* non-fatal */ }
        }
        importedFiles.push({ filename, importId, fields: addedCount });
      } catch (err) {
        errors.push({ filename, error: err.message });
      }
    }

    await withVoiceLock(() => {
      const latest = readJSON(VOICE_FILE, []);
      const newEntries = existing.filter(e => e.importedAt === importedAt);
      for (const entry of newEntries) {
        if (!latest.some(e => e.id === entry.id)) latest.push(entry);
      }
      const capped = latest.length > 500 ? latest.slice(-500) : latest;
      writeJSON(VOICE_FILE, capped);
    });
    const total = readJSON(VOICE_FILE, []).length;

    res.json({
      ok: true,
      formType: requestedFormType,
      scanned: allFiles.length,
      imported: importedFiles,
      skipped,
      errors,
      total,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/voice/folder-status
app.get('/api/voice/folder-status', (req, res) => {
  try {
    const requestedFormType = normalizeFormType(req.query?.formType || DEFAULT_FORM_TYPE);
    const folderPath = path.join(VOICE_PDFS_DIR, requestedFormType);
    if (!fs.existsSync(folderPath)) {
      return res.json({ ok: true, formType: requestedFormType, files: [], folderExists: false });
    }
    const allFiles = fs.readdirSync(folderPath).filter(f => /\.pdf$/i.test(f));
    const existing = readJSON(VOICE_FILE, []);
    const importedSet = new Set(
      existing
        .filter(e => normalizeFormType(e.formType) === requestedFormType)
        .map(e => e.filename)
    );
    const files = allFiles.map(f => ({ filename: f, imported: importedSet.has(f) }));
    res.json({ ok: true, formType: requestedFormType, folderExists: true, files, total: allFiles.length, newCount: files.filter(f => !f.imported).length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/cases/:caseId', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });
    fs.rmSync(cd, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── POST /api/insert-aci ──────────────────────────────────────────────────────
// Forward generated text to the ACI desktop automation agent (residential forms).
// The ACI agent (desktop_agent/agent.py) must be running on port 5180.
// Form types: 1004, 1025, 1073, 1004c
app.post('/api/insert-aci', async (req, res) => {
  try {
    const { fieldId, text, formType = '1004' } = req.body;
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId is required' });
    if (!text)    return res.status(400).json({ ok: false, error: 'text is required' });

    const agentRes = await fetch(`${ACI_AGENT_URL}/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldId, text, formType }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!agentRes.ok) {
      const errBody = await agentRes.text().catch(() => '');
      return res.status(502).json({ ok: false, error: `ACI agent returned ${agentRes.status}: ${errBody}` });
    }

    const agentData = await agentRes.json().catch(() => ({}));
    res.json({ ok: true, inserted: true, agent: agentData });
  } catch (err) {
    const connRefused = err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED';
    const timedOut    = err.name === 'TimeoutError'  || err.cause?.name === 'TimeoutError';
    if (connRefused || timedOut) {
      return res.status(503).json({
        ok: false,
        error: 'ACI automation agent is not running. Start desktop_agent/agent.py first.',
      });
    }
    console.error('[/api/insert-aci]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/insert-rq ───────────────────────────────────────────────────────
// Forward generated text to the Real Quantum browser automation agent (commercial).
// The RQ agent (real_quantum_agent/agent.py) must be running on port 5181.
// Chrome must be open with --remote-debugging-port=9222 and Real Quantum loaded.
// Form type: commercial
app.post('/api/insert-rq', async (req, res) => {
  try {
    const { fieldId, text, formType = 'commercial' } = req.body;
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId is required' });
    if (!text)    return res.status(400).json({ ok: false, error: 'text is required' });

    const agentRes = await fetch(`${RQ_AGENT_URL}/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldId, text, formType }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!agentRes.ok) {
      const errBody = await agentRes.text().catch(() => '');
      return res.status(502).json({ ok: false, error: `Real Quantum agent returned ${agentRes.status}: ${errBody}` });
    }

    const agentData = await agentRes.json().catch(() => ({}));
    res.json({ ok: true, inserted: true, agent: agentData });
  } catch (err) {
    const connRefused = err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED';
    const timedOut    = err.name === 'TimeoutError'  || err.cause?.name === 'TimeoutError';
    if (connRefused || timedOut) {
      return res.status(503).json({
        ok: false,
        error: 'Real Quantum agent is not running. Start real_quantum_agent/agent.py first.',
      });
    }
    console.error('[/api/insert-rq]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Agent process management ──────────────────────────────────────────────────
// Tracks spawned Python agent processes so they can be stopped from the UI.
const _agentProcs = { aci: null, rq: null };

async function pingAgent(url) {
  try {
    const r = await fetch(url + '/health', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

// GET /api/agents/status — check if both agents are reachable
app.get('/api/agents/status', async (_q, res) => {
  const [aci, rq] = await Promise.all([pingAgent(ACI_AGENT_URL), pingAgent(RQ_AGENT_URL)]);
  res.json({ ok: true, aci, rq });
});

// POST /api/agents/aci/start — spawn desktop_agent/agent.py
app.post('/api/agents/aci/start', (_q, res) => {
  if (_agentProcs.aci && !_agentProcs.aci.killed) {
    return res.json({ ok: true, message: 'ACI agent already running' });
  }
  const script = path.join(__dirname, 'desktop_agent', 'agent.py');
  const proc = spawn('python', [script], { stdio: 'pipe' });
  _agentProcs.aci = proc;
  proc.on('exit', () => { _agentProcs.aci = null; });
  proc.stderr?.on('data', d => console.error('[aci-agent]', d.toString().trim()));
  res.json({ ok: true, message: 'ACI agent starting…' });
});

// POST /api/agents/aci/stop — kill the ACI agent process
app.post('/api/agents/aci/stop', (_q, res) => {
  if (_agentProcs.aci && !_agentProcs.aci.killed) {
    _agentProcs.aci.kill();
    _agentProcs.aci = null;
    return res.json({ ok: true, message: 'ACI agent stopped' });
  }
  res.json({ ok: true, message: 'ACI agent was not running' });
});

// POST /api/agents/rq/start — spawn real_quantum_agent/agent.py
app.post('/api/agents/rq/start', (_q, res) => {
  if (_agentProcs.rq && !_agentProcs.rq.killed) {
    return res.json({ ok: true, message: 'RQ agent already running' });
  }
  const script = path.join(__dirname, 'real_quantum_agent', 'agent.py');
  const proc = spawn('python', [script], { stdio: 'pipe' });
  _agentProcs.rq = proc;
  proc.on('exit', () => { _agentProcs.rq = null; });
  proc.stderr?.on('data', d => console.error('[rq-agent]', d.toString().trim()));
  res.json({ ok: true, message: 'RQ agent starting…' });
});

// POST /api/agents/rq/stop — kill the RQ agent process
app.post('/api/agents/rq/stop', (_q, res) => {
  if (_agentProcs.rq && !_agentProcs.rq.killed) {
    _agentProcs.rq.kill();
    _agentProcs.rq = null;
    return res.json({ ok: true, message: 'RQ agent stopped' });
  }
  res.json({ ok: true, message: 'RQ agent was not running' });
});

// ══════════════════════════════════════════════════════════════════════════════
// NEW ARCHITECTURE — Workflow endpoints
// These endpoints expose the LangGraph workflow system alongside the legacy API.
// All existing endpoints above are unchanged.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/workflow/run
 * Run the full LangGraph workflow for a single field.
 *
 * Body:
 *   caseId:   string  — case ID (8-char hex)
 *   formType: string  — '1004' | '1025' | '1073' | '1004c' | 'commercial'
 *   fieldId:  string  — field to generate (e.g. 'neighborhood_description')
 *   facts:    object  — optional facts override (defaults to case facts.json)
 *   insert:   boolean — whether to insert into ACI/RQ (default: false)
 *
 * Returns:
 *   { ok, caseId, fieldId, finalText, draftText, reviewedText,
 *     inserted, verified, stage, examplesUsed, durationMs, errors, warnings }
 */
app.post('/api/workflow/run', ensureAI, async (req, res) => {
  try {
    const { caseId, formType, fieldId, insert = false } = req.body;
    if (!formType) return res.status(400).json({ ok: false, error: 'formType is required' });
    const _ftEarly = normalizeFormType(formType);
    // ── Scope enforcement: block workflow for deferred form types ─────────────
    // NOTE: scope check runs BEFORE caseId validation so deferred forms are
    // rejected with a clear scope error rather than a generic "caseId required".
    if (isDeferredForm(_ftEarly)) {
      logDeferredAccess(_ftEarly, 'POST /api/workflow/run', log);
      return res.status(400).json({
        ok:        false,
        supported: false,
        formType:  _ftEarly,
        scope:     'deferred',
        message:   `Workflow is not available for form type "${_ftEarly}". This form type is outside active production scope. Active forms: ${ACTIVE_FORMS.join(', ')}.`,
      });
    }
    if (!caseId)  return res.status(400).json({ ok: false, error: 'caseId is required' });
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId is required' });

    // Load facts from case directory if not provided in body
    let facts = req.body.facts || {};
    if (!Object.keys(facts).length) {
      const cd = resolveCaseDir(caseId);
      if (cd && fs.existsSync(cd)) {
        facts = readJSON(path.join(cd, 'facts.json'), {});
      }
    }

    // Dynamically import the workflow (TypeScript compiled or tsx)
    let runWorkflow;
    try {
      const wf = await import('./dist/workflow/appraisalWorkflow.js').catch(() =>
        import('./server/workflow/appraisalWorkflow.js')
      );
      runWorkflow = wf.runWorkflow;
    } catch (importErr) {
      return res.status(503).json({
        ok: false,
        error: 'Workflow system not available. Run: npm run build',
        hint: 'npm run build  (compiles TypeScript workflow modules)',
      });
    }

    const ft = _ftEarly; // already normalized and scope-checked above

    const result = await runWorkflow({ caseId, formType: ft, fieldId, facts });

    // Save output to case directory
    const cd = resolveCaseDir(caseId);
    if (cd && fs.existsSync(cd)) {
      const text = result.finalText || result.reviewedText || result.draftText || '';
      if (text) {
        const outFile = path.join(cd, 'outputs.json');
        const outputs = readJSON(outFile, {});
        outputs[fieldId] = {
          title:       fieldId,
          text,
          draftText:   result.draftText,
          reviewedText: result.reviewedText,
          workflowRun: true,
          stage:       result.currentStage,
          generatedAt: new Date().toISOString(),
        };
        outputs.updatedAt = new Date().toISOString();
        writeJSON(outFile, outputs);
      }
    }

    res.json({
      ok:           result.currentStage !== 'failed',
      caseId,
      fieldId,
      formType:     ft,
      finalText:    result.finalText    || '',
      draftText:    result.draftText    || '',
      reviewedText: result.reviewedText || '',
      inserted:     result.insertionResult?.success     || false,
      verified:     result.verificationResult?.passed   || false,
      stage:        result.currentStage,
      examplesUsed: result.examples?.length || 0,
      durationMs:   result.durationMs   || 0,
      errors:       result.errors       || [],
      warnings:     result.warnings     || [],
      runId:        result.runId        || null,
    });
  } catch (err) {
    console.error('[/api/workflow/run]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/workflow/run-batch
 * Run the workflow for multiple fields (the 5 production lane fields).
 *
 * Body:
 *   caseId:   string    — case ID
 *   formType: string    — form type
 *   fieldIds: string[]  — fields to generate (default: 5 production lane fields)
 *   facts:    object    — optional facts override
 *   twoPass:  boolean   — enable two-pass review (default: true)
 *
 * Returns:
 *   { ok, caseId, formType, results: { [fieldId]: WorkflowFieldResult }, errors, durationMs }
 */
app.post('/api/workflow/run-batch', ensureAI, async (req, res) => {
  try {
    const { caseId, formType, twoPass = true } = req.body;
    if (!formType) return res.status(400).json({ ok: false, error: 'formType is required' });

    const ft = normalizeFormType(formType);

    // ── Scope enforcement: block batch workflow for deferred form types ────────
    // NOTE: scope check runs BEFORE caseId validation so deferred forms are
    // rejected with a clear scope error rather than a generic "caseId required".
    if (isDeferredForm(ft)) {
      logDeferredAccess(ft, 'POST /api/workflow/run-batch', log);
      return res.status(400).json({
        ok:        false,
        supported: false,
        formType:  ft,
        scope:     'deferred',
        message:   `Batch workflow is not available for form type "${ft}". This form type is outside active production scope. Active forms: ${ACTIVE_FORMS.join(', ')}.`,
      });
    }

    if (!caseId) return res.status(400).json({ ok: false, error: 'caseId is required' });

    // Default to the 5 production lane fields for 1004
    const DEFAULT_FIELDS = {
      '1004':       ['neighborhood_description', 'site_comments', 'improvements_condition', 'sales_comparison_commentary', 'reconciliation'],
      '1025':       ['neighborhood_description', 'site_comments', 'improvements_condition', 'sales_comparison_commentary', 'reconciliation'],
      '1073':       ['neighborhood_description', 'site_comments', 'improvements_condition', 'sales_comparison_commentary', 'reconciliation'],
      '1004c':      ['neighborhood_description', 'site_comments', 'improvements_condition', 'sales_comparison_commentary', 'reconciliation'],
      'commercial': ['site_description', 'improvement_description', 'market_area', 'sales_comparison', 'reconciliation'],
    };
    const fieldIds = Array.isArray(req.body.fieldIds) && req.body.fieldIds.length
      ? req.body.fieldIds
      : (DEFAULT_FIELDS[ft] || DEFAULT_FIELDS['1004']);

    // Load facts
    let facts = req.body.facts || {};
    if (!Object.keys(facts).length) {
      const cd = resolveCaseDir(caseId);
      if (cd && fs.existsSync(cd)) {
        facts = readJSON(path.join(cd, 'facts.json'), {});
      }
    }

    // Dynamically import the workflow
    let runBatchWorkflow;
    try {
      const wf = await import('./dist/workflow/appraisalWorkflow.js').catch(() =>
        import('./server/workflow/appraisalWorkflow.js')
      );
      runBatchWorkflow = wf.runBatchWorkflow;
    } catch (importErr) {
      return res.status(503).json({
        ok: false,
        error: 'Workflow system not available. Run: npm run build',
      });
    }

    const batchResult = await runBatchWorkflow({ caseId, formType: ft, fieldIds, facts });

    // Save all outputs to case directory
    const cd = resolveCaseDir(caseId);
    if (cd && fs.existsSync(cd)) {
      const outFile = path.join(cd, 'outputs.json');
      const outputs = readJSON(outFile, {});
      for (const [fid, r] of Object.entries(batchResult.results)) {
        if (r.finalText) {
          outputs[fid] = {
            title:        fid,
            text:         r.finalText,
            draftText:    r.draftText,
            reviewedText: r.reviewedText,
            workflowRun:  true,
            stage:        r.stage,
            generatedAt:  new Date().toISOString(),
          };
        }
      }
      outputs.updatedAt = new Date().toISOString();
      writeJSON(outFile, outputs);

      // Advance pipeline stage
      const mf = path.join(cd, 'meta.json');
      const meta = readJSON(mf);
      const allFailed = Object.values(batchResult.results).every(r => r.stage === 'failed');
      meta.pipelineStage = allFailed ? 'generating' : 'review';
      meta.updatedAt = new Date().toISOString();
      writeJSON(mf, meta);
    }

    res.json({
      ok:         true,
      caseId,
      formType:   ft,
      fieldIds,
      results:    batchResult.results,
      errors:     batchResult.errors,
      durationMs: batchResult.durationMs,
      completedAt: batchResult.completedAt,
    });
  } catch (err) {
    console.error('[/api/workflow/run-batch]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/workflow/health
 * Check the health of all workflow system components.
 *
 * Returns status of: OpenAI, Pinecone, LangSmith, Langfuse, ACI agent, RQ agent
 */
app.get('/api/workflow/health', async (_q, res) => {
  try {
    const checks = await Promise.allSettled([
      // OpenAI
      fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      }).then(r => ({ ok: r.ok, status: r.status })).catch(e => ({ ok: false, error: e.message })),

      // ACI agent
      fetch(`${ACI_AGENT_URL}/health`, { signal: AbortSignal.timeout(2000) })
        .then(r => r.json()).catch(() => ({ ok: false })),

      // RQ agent
      fetch(`${RQ_AGENT_URL}/health`, { signal: AbortSignal.timeout(2000) })
        .then(r => r.json()).catch(() => ({ ok: false })),
    ]);

    const [openaiCheck, aciCheck, rqCheck] = checks.map(c =>
      c.status === 'fulfilled' ? c.value : { ok: false, error: c.reason?.message }
    );

    res.json({
      ok:      true,
      version: '2.0.0',
      components: {
        openai:    { ok: openaiCheck.ok,  configured: Boolean(OPENAI_API_KEY) },
        pinecone:  { ok: Boolean(process.env.PINECONE_API_KEY), configured: Boolean(process.env.PINECONE_API_KEY) },
        langsmith: { ok: Boolean(process.env.LANGCHAIN_API_KEY), configured: Boolean(process.env.LANGCHAIN_API_KEY) },
        langfuse:  { ok: Boolean(process.env.LANGFUSE_SECRET_KEY), configured: Boolean(process.env.LANGFUSE_SECRET_KEY) },
        aci:       { ok: Boolean(aciCheck.ok), version: aciCheck.version || null },
        rq:        { ok: Boolean(rqCheck.ok),  version: rqCheck.version  || null },
      },
      workflowReady: Boolean(OPENAI_API_KEY),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/kb/ingest-to-pinecone
 * One-time migration: ingest all local KB examples into Pinecone.
 * Safe to re-run — upsert is idempotent.
 * Requires PINECONE_API_KEY and PINECONE_INDEX_NAME to be set.
 */
app.post('/api/kb/ingest-to-pinecone', async (_q, res) => {
  try {
    let ingestLocalKBToPinecone;
    try {
      const mod = await import('./dist/retrieval/llamaIndex.js').catch(() =>
        import('./server/retrieval/llamaIndex.js')
      );
      ingestLocalKBToPinecone = mod.ingestLocalKBToPinecone;
    } catch {
      return res.status(503).json({
        ok: false,
        error: 'Retrieval module not available. Run: npm run build',
      });
    }

    const result = await ingestLocalKBToPinecone();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/workflow/ingest-pdf
 * Ingest a PDF into the knowledge base via the new document parser.
 * Parses narrative sections and stores them in Pinecone + local KB.
 *
 * Body (multipart/form-data):
 *   file:         PDF file
 *   formType:     string (default: '1004')
 *   marketArea:   string (optional)
 *   county:       string (optional)
 */
app.post('/api/workflow/ingest-pdf', ensureAI, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const isPdf = req.file.mimetype === 'application/pdf' || String(req.file.originalname || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ ok: false, error: 'Only PDF files are allowed' });

    const formType  = normalizeFormType(req.body?.formType || '1004');
    const filename  = trimText(req.file.originalname || 'unknown.pdf', 180);

    // Extract PDF text using existing 3-stage pipeline
    const { text: pdfText, method, error: extractError } = await extractPdfText(req.file.buffer, client, MODEL);
    if (!pdfText || pdfText.length < 200) {
      return res.status(422).json({ ok: false, error: extractError || `Could not extract text (method: ${method})` });
    }

    // Import and run the document parser
    let ingestDocument;
    try {
      const mod = await import('./dist/ingestion/documentParser.js').catch(() =>
        import('./server/ingestion/documentParser.js')
      );
      ingestDocument = mod.ingestDocument;
    } catch {
      return res.status(503).json({ ok: false, error: 'Document parser not available. Run: npm run build' });
    }

    const result = await ingestDocument(pdfText, formType, filename, {
      market_area:   trimText(req.body?.marketArea || '', 200),
      county:        trimText(req.body?.county     || '', 100),
      approved_flag: true,
    });

    res.json({ ok: true, ...result, extractMethod: method });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 2 — Generate Core Sections (one-click, active production scope only)
// Lane 1: 1004 single-family (ACI workflow)
// Lane 2: commercial (Real Quantum workflow)
// ══════════════════════════════════════════════════════════════════════════════

// Core section sets per active form type
const CORE_SECTIONS = {
  '1004': [
    { id: 'neighborhood_description', title: 'Neighborhood Description' },
    { id: 'market_conditions',        title: 'Market Conditions' },
    { id: 'improvements_condition',   title: 'Improvements / Condition' },
    { id: 'sca_summary',              title: 'Sales Comparison Summary' },
    { id: 'reconciliation',           title: 'Reconciliation' },
  ],
  'commercial': [
    { id: 'market_area',              title: 'Market Area / Neighborhood' },
    { id: 'improvement_description',  title: 'Improvements Description' },
    { id: 'hbu_analysis',             title: 'Highest & Best Use' },
    { id: 'reconciliation',           title: 'Reconciliation / Conclusion' },
    { id: 'site_description',         title: 'Site Description' },
  ],
};

// Valid section status values
// Lifecycle: not_started → drafted → reviewed → approved → inserted → verified | copied | error
// 'copied' = clipboard fallback activated; manual paste required; distinct from 'inserted'/'verified'
const VALID_SECTION_STATUSES = ['not_started', 'drafted', 'reviewed', 'approved', 'inserted', 'verified', 'copied', 'error'];

/**
 * POST /api/cases/:caseId/generate-core
 * One-click "Generate + Review + Queue for Insert" for the 5 core sections.
 * Active production scope only: 1004 (ACI) and commercial (Real Quantum).
 * Deferred form types are blocked.
 *
 * Body:
 *   twoPass: boolean — enable two-pass review per section (default: true)
 *
 * Returns:
 *   { ok, caseId, formType, results, errors, generated, failed, coreSections }
 *   Each result includes: { title, text, draftText, reviewedText, sectionStatus, examplesUsed }
 */
app.post('/api/cases/:caseId/generate-core', ensureAI, async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const { twoPass = true } = req.body;
    const caseFacts = readJSON(path.join(cd, 'facts.json'), {});
    const { formType, meta: _coreRawMeta } = getCaseFormConfig(cd);

    // ── Scope enforcement: only 1004 and commercial are active ───────────────
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType, 'POST /api/cases/:caseId/generate-core', log);
      return res.status(400).json({
        ok:        false,
        supported: false,
        formType,
        scope:     'deferred',
        message:   `generate-core is not available for form type "${formType}". Active forms: ${ACTIVE_FORMS.join(', ')}.`,
      });
    }

    const coreSections = CORE_SECTIONS[formType];
    if (!coreSections) {
      return res.status(400).json({
        ok: false,
        error: `No core sections defined for form type "${formType}". Active forms: ${ACTIVE_FORMS.join(', ')}.`,
      });
    }

    // Build assignment meta block once
    const assignmentMeta = buildAssignmentMetaBlock(applyMetaDefaults(_coreRawMeta || {}));

    // Pre-load location context once for location-sensitive core sections
    let coreLocationContext = null;
    const hasLocationField = coreSections.some(f => LOCATION_CONTEXT_FIELDS.has(f.id));
    if (hasLocationField) {
      const geocodeData = readJSON(path.join(cd, 'geocode.json'), null);
      if (geocodeData?.subject?.result?.lat) {
        try {
          const { lat, lng } = geocodeData.subject.result;
          const boundaryFeatures = await getNeighborhoodBoundaryFeatures(lat, lng, 1.5);
          coreLocationContext = formatLocationContextBlock({
            subject: geocodeData.subject,
            comps:   geocodeData.comps || [],
            boundaryFeatures,
          });
        } catch (locErr) {
          log.warn('[generate-core] location context unavailable (non-fatal):', locErr.message);
        }
      }
    }

    // Advance pipeline to 'generating'
    const mf = path.join(cd, 'meta.json');
    const meta = readJSON(mf);
    meta.pipelineStage = 'generating';
    meta.updatedAt = new Date().toISOString();
    writeJSON(mf, meta);

    const results = {}, errors = {};
    const CONCURRENCY = 3;
    let qi = 0;

    async function processCoreField() {
      while (qi < coreSections.length) {
        const f = coreSections[qi++];
        const sid = f.id;
        try {
          // Step 1: Draft generation (voice-first retrieval)
          const { voiceExamples: _coreVoice, otherExamples: _coreOther } = getRelevantExamplesWithVoice({ formType, fieldId: sid });
          const messages = buildPromptMessages({
            formType,
            fieldId: sid,
            facts: caseFacts,
            voiceExamples: _coreVoice,
            examples: _coreOther,
            locationContext: LOCATION_CONTEXT_FIELDS.has(sid) ? coreLocationContext : null,
            assignmentMeta,
          });
          let draftText = await callAI(messages);
          let reviewedText = draftText;
          let sectionStatus = 'drafted';

          // Step 2: Two-pass review
          if (twoPass && draftText) {
            try {
              const reviewMessages = buildReviewMessages({ draftText, facts: caseFacts, fieldId: sid, formType });
              const reviewRaw = await callAI(reviewMessages);
              const reviewResult = JSON.parse(reviewRaw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, ''));
              if (reviewResult?.revisedText) {
                reviewedText = reviewResult.revisedText;
                sectionStatus = 'reviewed';
              }
            } catch { /* review parse failure is non-fatal — keep draft */ }
          }

          results[sid] = {
            title:        f.title,
            text:         reviewedText,
            draftText,
            reviewedText,
            sectionStatus,
            examplesUsed: _coreVoice.length + _coreOther.length,
            approved:     false,
          };
        } catch (e) {
          errors[sid] = e?.message || 'Unknown error';
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, coreSections.length) }, processCoreField));

    // Save outputs with sectionStatus
    const outFile = path.join(cd, 'outputs.json');
    const existing = readJSON(outFile, {});
    const histFile = path.join(cd, 'history.json');
    const history  = readJSON(histFile, {});
    for (const fid of Object.keys(results)) {
      if (existing[fid]?.text) {
        if (!history[fid]) history[fid] = [];
        history[fid].unshift({ text: existing[fid].text, title: existing[fid].title, savedAt: new Date().toISOString() });
        history[fid] = history[fid].slice(0, 3);
      }
    }
    writeJSON(histFile, history);
    writeJSON(outFile, { ...existing, ...results, updatedAt: new Date().toISOString() });

    // Advance pipeline to 'review' if any sections succeeded
    meta.pipelineStage = Object.keys(errors).length === coreSections.length ? 'generating' : 'review';
    meta.updatedAt = new Date().toISOString();
    writeJSON(mf, meta);

    res.json({
      ok:           true,
      caseId:       req.params.caseId,
      formType,
      results,
      errors,
      generated:    Object.keys(results).length,
      failed:       Object.keys(errors).length,
      coreSections: coreSections.map(f => f.id),
      pipelineStage: meta.pipelineStage,
    });
  } catch (err) {
    console.error('[/generate-core]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /api/cases/:caseId/sections/:fieldId/status
 * Update the sectionStatus lifecycle for a single section.
 * Valid statuses: not_started | drafted | reviewed | approved | inserted | verified | error
 *
 * Body:
 *   status: string — new section status
 *   note:   string — optional note (e.g. error message, reviewer comment)
 *
 * Returns:
 *   { ok, fieldId, sectionStatus, updatedAt }
 */
app.patch('/api/cases/:caseId/sections/:fieldId/status', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const fieldId = trimText(req.params.fieldId, 80);
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId required' });

    const status = trimText(req.body?.status, 40).toLowerCase();
    if (!VALID_SECTION_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid sectionStatus "${status}". Valid values: ${VALID_SECTION_STATUSES.join(', ')}`,
      });
    }

    const outFile = path.join(cd, 'outputs.json');
    const outputs = readJSON(outFile, {});
    const now = new Date().toISOString();

    // Create a stub entry if the field doesn't exist yet (e.g. marking as not_started)
    if (!outputs[fieldId]) {
      outputs[fieldId] = { title: fieldId, text: '', sectionStatus: 'not_started', createdAt: now };
    }

    outputs[fieldId].sectionStatus = status;
    outputs[fieldId].statusUpdatedAt = now;
    outputs[fieldId].updatedAt = now;
    if (req.body?.note) outputs[fieldId].statusNote = trimText(req.body.note, 500);

    // ── Approval-to-memory loop ───────────────────────────────────────────────
    // When a section is approved, set approved=true and save to KB immediately.
    // This ensures every human-approved narrative improves future generation.
    if (status === 'approved' && outputs[fieldId].text) {
      outputs[fieldId].approved    = true;
      outputs[fieldId].approvedAt  = now;
      try {
        const { formType: _approveFormType, meta: _approveMeta } = getCaseFormConfig(cd);
        addExample({
          fieldId,
          formType:     _approveFormType,
          sourceType:   'approved_edit',
          qualityScore: 90,
          tags:         [],
          text:         outputs[fieldId].text,
        });
        // Voice engine: also save to approvedNarratives with full metadata
        addApprovedNarrative({
          text:          outputs[fieldId].text,
          sectionType:   fieldId,
          formType:      _approveFormType,
          meta:          _approveMeta,
          sourceReportId: req.params.caseId,
          qualityScore:  90,
          approvedBy:    'cresci',
        });
        log.info(`[approval-to-memory] saved ${fieldId} (${_approveFormType}) to KB + approvedNarratives`);
      } catch (kbErr) {
        log.warn('[approval-to-memory] KB save failed (non-fatal):', kbErr.message);
      }
    }

    outputs.updatedAt = now;
    writeJSON(outFile, outputs);

    res.json({
      ok:            true,
      fieldId,
      sectionStatus: status,
      approved:      outputs[fieldId].approved || false,
      updatedAt:     now,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/cases/:caseId/sections/:fieldId/copy
 * Clipboard fallback — marks section as 'copied' and returns text for manual paste.
 *
 * Called when automatic insertion fails or the user explicitly requests clipboard copy.
 * This is a SAFE, EXPLICIT manual completion path — not a silent success.
 *
 * Body:
 *   failureReason: string — optional reason why automatic insertion failed
 *
 * Returns:
 *   { ok, fieldId, text, sectionStatus: 'copied', manualPasteRequired: true,
 *     target, failureReason, copiedAt, message }
 *
 * Status lifecycle note:
 *   'copied' is DISTINCT from 'inserted' and 'verified'.
 *   The UI must clearly show that manual paste is still required.
 *   Do not treat 'copied' as a successful insertion.
 */
app.post('/api/cases/:caseId/sections/:fieldId/copy', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const fieldId = trimText(req.params.fieldId, 80);
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId required' });

    const outputs = readJSON(path.join(cd, 'outputs.json'), {});
    const section = outputs[fieldId];

    if (!section?.text) {
      return res.status(400).json({
        ok:    false,
        error: `No text found for field "${fieldId}". Generate the section first.`,
      });
    }

    const { formType } = getCaseFormConfig(cd);
    const failureReason = trimText(req.body?.failureReason || '', 500) || null;
    const now = new Date().toISOString();

    // Determine target software label for the response message
    const targetSoftware = getTargetSoftware(formType, fieldId) || (formType === 'commercial' ? 'real_quantum' : 'aci');
    const targetLabel    = targetSoftware === 'real_quantum' ? 'Real Quantum' : 'ACI';

    // Update section status to 'copied' in outputs.json
    const outFile = path.join(cd, 'outputs.json');
    const updatedOutputs = readJSON(outFile, {});
    if (updatedOutputs[fieldId]) {
      updatedOutputs[fieldId].sectionStatus   = 'copied';
      updatedOutputs[fieldId].copiedAt        = now;
      updatedOutputs[fieldId].statusUpdatedAt = now;
      updatedOutputs[fieldId].updatedAt       = now;
      if (failureReason) {
        updatedOutputs[fieldId].statusNote = 'Clipboard fallback: ' + failureReason;
      }
    }
    updatedOutputs.updatedAt = now;
    writeJSON(outFile, updatedOutputs);

    log.warn(`[clipboard-fallback] fieldId="${fieldId}" formType="${formType}" target="${targetLabel}" reason="${failureReason || 'manual'}"`);

    res.json({
      ok:                  true,
      fieldId,
      text:                section.text,
      sectionStatus:       'copied',
      manualPasteRequired: true,
      target: {
        software: targetSoftware,
        label:    targetLabel,
        fieldId,
      },
      failureReason,
      copiedAt: now,
      message:  `Automatic insertion did not complete. Clipboard fallback activated. ` +
                `Please manually paste the returned text into ${targetLabel} for field "${fieldId}". ` +
                `Section status is now "copied" — this is NOT the same as a verified insertion.`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/cases/:caseId/sections/status
 * Returns the sectionStatus for all sections in outputs.json.
 * Used by the UI to render status badges for each section.
 *
 * Returns:
 *   { ok, caseId, sections: { [fieldId]: { sectionStatus, title, updatedAt } } }
 */
app.get('/api/cases/:caseId/sections/status', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const outputs = readJSON(path.join(cd, 'outputs.json'), {});
    const sections = {};
    for (const [fid, v] of Object.entries(outputs)) {
      if (fid === 'updatedAt' || !v || typeof v !== 'object') continue;
      sections[fid] = {
        title:         v.title || fid,
        sectionStatus: v.sectionStatus || (v.text ? 'drafted' : 'not_started'),
        approved:      Boolean(v.approved),
        insertedAt:    v.insertedAt || null,
        statusUpdatedAt: v.statusUpdatedAt || v.updatedAt || null,
      };
    }

    res.json({ ok: true, caseId: req.params.caseId, sections });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Destination Registry, Single-Section Insert, Exception Queue,
//            Comp Commentary Engine
// Active production scope: 1004 (ACI) + commercial (Real Quantum)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/cases/:caseId/destination-registry
 * Returns the unified field map for the case's form type, enriched with
 * current sectionStatus from outputs.json.
 * This is the single source of truth for section→software target mapping.
 *
 * Returns:
 *   { ok, caseId, formType, software, fields: { [fieldId]: { label, tab_name|nav_url_slug, sectionStatus, ... } } }
 */
app.get('/api/cases/:caseId/destination-registry', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const { formType } = getCaseFormConfig(cd);
    const outputs = readJSON(path.join(cd, 'outputs.json'), {});

    // Load the appropriate field map
    const isCommercial = formType === 'commercial';
    const mapPath = isCommercial
      ? path.join(__dirname, 'real_quantum_agent', 'field_maps', 'commercial.json')
      : path.join(__dirname, 'desktop_agent', 'field_maps', `${formType}.json`);

    let rawMap = {};
    try { rawMap = readJSON(mapPath, {}); } catch { /* field map may not exist for deferred forms */ }

    // Strip meta keys, enrich each field with current sectionStatus
    const fields = {};
    for (const [fid, fdef] of Object.entries(rawMap)) {
      if (fid.startsWith('_')) continue; // skip _meta, _comment, _schema
      const out = outputs[fid];
      fields[fid] = {
        ...fdef,
        sectionStatus:   out?.sectionStatus || (out?.text ? 'drafted' : 'not_started'),
        approved:        Boolean(out?.approved),
        hasText:         Boolean(out?.text),
        insertedAt:      out?.insertedAt || null,
        statusUpdatedAt: out?.statusUpdatedAt || null,
      };
    }

    res.json({
      ok:       true,
      caseId:   req.params.caseId,
      formType,
      software: isCommercial ? 'real_quantum' : 'aci',
      fields,
      fieldCount: Object.keys(fields).length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/cases/:caseId/sections/:fieldId/insert
 * Single-section insert with full status lifecycle tracking.
 * Routes to ACI (1004) or Real Quantum (commercial) based on form type.
 * Updates sectionStatus: approved → inserted (success) | error (failure).
 *
 * Body:
 *   verify: boolean — request verification readback from agent (default: true)
 *
 * Returns:
 *   { ok, fieldId, sectionStatus, inserted, verified, agent, updatedAt }
 */
app.post('/api/cases/:caseId/sections/:fieldId/insert', async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const fieldId = trimText(req.params.fieldId, 80);
    if (!fieldId) return res.status(400).json({ ok: false, error: 'fieldId required' });

    const { verify = true } = req.body;
    const outputs = readJSON(path.join(cd, 'outputs.json'), {});
    const section = outputs[fieldId];

    if (!section?.text) {
      return res.status(400).json({ ok: false, error: `No text found for field "${fieldId}". Generate the section first.` });
    }

    const { formType } = getCaseFormConfig(cd);
    const isCommercial = formType === 'commercial';
    const agentUrl  = isCommercial ? RQ_AGENT_URL : ACI_AGENT_URL;
    const agentName = isCommercial ? 'Real Quantum' : 'ACI';
    const timeout   = isCommercial ? 20_000 : 15_000;

    // Call the agent's /insert endpoint
    let agentData = {};
    let insertOk = false;
    let insertErr = null;
    try {
      const agentRes = await fetch(`${agentUrl}/insert`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fieldId, text: section.text, formType, verify }),
        signal:  AbortSignal.timeout(timeout),
      });
      agentData = await agentRes.json().catch(() => ({}));
      insertOk = agentRes.ok && (agentData.ok !== false);
    } catch (fetchErr) {
      const connRefused = fetchErr.code === 'ECONNREFUSED' || fetchErr.cause?.code === 'ECONNREFUSED';
      if (connRefused) {
        return res.status(503).json({
          ok: false,
          error: `${agentName} agent is not running. Start it first.`,
          fieldId,
          sectionStatus: section.sectionStatus || 'approved',
        });
      }
      insertErr = fetchErr.message;
    }

    // Update sectionStatus based on result
    const now = new Date().toISOString();
    const outFile = path.join(cd, 'outputs.json');
    const updatedOutputs = readJSON(outFile, {});
    if (updatedOutputs[fieldId]) {
      if (insertOk) {
        updatedOutputs[fieldId].sectionStatus   = 'inserted';
        updatedOutputs[fieldId].insertedAt      = now;
        updatedOutputs[fieldId].insertMethod    = agentData.method || 'agent';
        // If agent confirmed verification, advance to 'verified'
        if (agentData.verified === true || agentData.verification?.passed === true) {
          updatedOutputs[fieldId].sectionStatus = 'verified';
          updatedOutputs[fieldId].verifiedAt    = now;
        }
      } else {
        updatedOutputs[fieldId].sectionStatus = 'error';
        updatedOutputs[fieldId].statusNote    = String(insertErr || agentData.error || 'Insert failed').slice(0, 300);
      }
      updatedOutputs[fieldId].statusUpdatedAt = now;
      updatedOutputs[fieldId].updatedAt       = now;
    }
    updatedOutputs.updatedAt = now;
    writeJSON(outFile, updatedOutputs);

    res.json({
      ok:            insertOk,
      fieldId,
      sectionStatus: updatedOutputs[fieldId]?.sectionStatus || (insertOk ? 'inserted' : 'error'),
      inserted:      insertOk,
      verified:      updatedOutputs[fieldId]?.sectionStatus === 'verified',
      agent:         agentData,
      updatedAt:     now,
      ...(insertErr ? { error: insertErr } : {}),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/cases/:caseId/exceptions
 * Returns all sections with sectionStatus=error — the exception queue.
 * Used by the UI to show failed insertions and allow retry.
 *
 * Returns:
 *   { ok, caseId, exceptions: [{ fieldId, title, sectionStatus, statusNote, statusUpdatedAt }], count }
 */
app.get('/api/cases/:caseId/exceptions', (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const outputs = readJSON(path.join(cd, 'outputs.json'), {});
    const exceptions = [];
    for (const [fid, v] of Object.entries(outputs)) {
      if (fid === 'updatedAt' || !v || typeof v !== 'object') continue;
      if (v.sectionStatus === 'error') {
        exceptions.push({
          fieldId:         fid,
          title:           v.title || fid,
          sectionStatus:   'error',
          statusNote:      v.statusNote || null,
          statusUpdatedAt: v.statusUpdatedAt || v.updatedAt || null,
          hasText:         Boolean(v.text),
          approved:        Boolean(v.approved),
        });
      }
    }

    res.json({ ok: true, caseId: req.params.caseId, exceptions, count: exceptions.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/cases/:caseId/generate-comp-commentary
 * Comparable Sales Commentary Engine — 1004 only (active production scope).
 * Generates commentary for the sca_summary section using comp data from facts.json.
 * Supports concession analysis, adjustment support, and comp selection rationale.
 *
 * Body:
 *   twoPass:    boolean — enable two-pass review (default: true)
 *   compFocus:  string  — 'selection' | 'adjustments' | 'concessions' | 'all' (default: 'all')
 *
 * Returns:
 *   { ok, fieldId, text, draftText, reviewedText, sectionStatus, compsUsed }
 */
app.post('/api/cases/:caseId/generate-comp-commentary', ensureAI, async (req, res) => {
  try {
    const cd = req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok: false, error: 'Case not found' });

    const { formType, meta: _compRawMeta } = getCaseFormConfig(cd);

    // Comp commentary is 1004-only in active production scope
    if (formType !== '1004') {
      return res.status(400).json({
        ok:      false,
        error:   `Comp commentary is only available for 1004 single-family. Current form type: "${formType}".`,
        formType,
      });
    }

    const { twoPass = true, compFocus = 'all' } = req.body;
    const caseFacts = readJSON(path.join(cd, 'facts.json'), {});

    // Validate comp data exists
    const comps = Array.isArray(caseFacts.comps) ? caseFacts.comps : [];
    if (!comps.length) {
      return res.status(400).json({
        ok:    false,
        error: 'No comparable sales data found in facts.json. Extract facts from the appraisal first.',
      });
    }

    const assignmentMeta = buildAssignmentMetaBlock(applyMetaDefaults(_compRawMeta || {}));
    const fieldId = 'sca_summary';

    // Build comp-focused prompt context
    const compFocusInstructions = {
      selection:    'Focus on comp selection rationale: proximity, similarity, market area, time adjustments.',
      adjustments:  'Focus on adjustment support: GLA, condition, location, time, concession adjustments with market evidence.',
      concessions:  'Focus on concession analysis: seller concessions, financing terms, market-typical concession levels.',
      all:          'Cover comp selection rationale, adjustment support, and concession analysis comprehensively.',
    };
    const focusInstruction = compFocusInstructions[compFocus] || compFocusInstructions.all;

    // Inject comp focus into facts for the prompt
    const enrichedFacts = {
      ...caseFacts,
      _compFocusInstruction: focusInstruction,
      _compsCount: comps.length,
    };

    const { voiceExamples: _compVoice, otherExamples: _compOther } = getRelevantExamplesWithVoice({ formType, fieldId });
    const messages = buildPromptMessages({
      formType,
      fieldId,
      facts:          enrichedFacts,
      voiceExamples:  _compVoice,
      examples:       _compOther,
      locationContext: null,
      assignmentMeta,
    });

    let draftText = await callAI(messages);
    let reviewedText = draftText;
    let sectionStatus = 'drafted';

    if (twoPass && draftText) {
      try {
        const reviewMessages = buildReviewMessages({ draftText, facts: caseFacts, fieldId, formType });
        const reviewRaw = await callAI(reviewMessages);
        const reviewResult = JSON.parse(reviewRaw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, ''));
        if (reviewResult?.revisedText) {
          reviewedText = reviewResult.revisedText;
          sectionStatus = 'reviewed';
        }
      } catch { /* non-fatal */ }
    }

    // Save to outputs.json
    const outFile = path.join(cd, 'outputs.json');
    const existing = readJSON(outFile, {});
    const now = new Date().toISOString();
    if (existing[fieldId]?.text) {
      const histFile = path.join(cd, 'history.json');
      const history = readJSON(histFile, {});
      if (!history[fieldId]) history[fieldId] = [];
      history[fieldId].unshift({ text: existing[fieldId].text, title: existing[fieldId].title, savedAt: now });
      history[fieldId] = history[fieldId].slice(0, 3);
      writeJSON(histFile, history);
    }
    existing[fieldId] = {
      title:         'Sales Comparison Summary',
      text:          reviewedText,
      draftText,
      reviewedText,
      sectionStatus,
      compFocus,
      examplesUsed:  _compVoice.length + _compOther.length,
      approved:      false,
      updatedAt:     now,
    };
    existing.updatedAt = now;
    writeJSON(outFile, existing);

    res.json({
      ok:            true,
      fieldId,
      text:          reviewedText,
      draftText,
      reviewedText,
      sectionStatus,
      compFocus,
      compsUsed:     comps.length,
      examplesUsed:  _compVoice.length + _compOther.length,
    });
  } catch (err) {
    console.error('[/generate-comp-commentary]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── End new workflow endpoints ─────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// Production Desktop Phase — Health Services, Destination Registry,
//                            Logging, Backup/Export
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/health/services
 * Per-service health status for the desktop health panel.
 * Returns: server, aciAgent, rqAgent, knowledgeBase, approvedNarratives
 * Each service: { status: 'healthy'|'degraded'|'offline', detail? }
 */
app.get('/api/health/services', async (_q, res) => {
  try {
    const KB_DIR = path.join(__dirname, 'knowledge_base');

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
        server:             { status: 'healthy', detail: `port ${PORT}, model ${MODEL}` },
        aciAgent:           { status: aciOk ? 'healthy' : 'offline', detail: aciOk ? `${ACI_AGENT_URL}` : 'Not reachable — start desktop_agent/agent.py' },
        rqAgent:            { status: rqOk  ? 'healthy' : 'offline', detail: rqOk  ? `${RQ_AGENT_URL}`  : 'Not reachable — start real_quantum_agent/agent.py' },
        knowledgeBase:      { status: kbStatus,  detail: kbDetail },
        approvedNarratives: { status: narStatus, detail: narDetail },
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/destination-registry
 * Returns all active destination registry entries.
 * Query: ?includeDeferred=true to include deferred form entries.
 */
app.get('/api/destination-registry', (req, res) => {
  try {
    const includeDeferred = req.query?.includeDeferred === 'true';
    const entries = listAllDestinations(includeDeferred);
    res.json({ ok: true, entries, count: entries.length, includeDeferred });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/destination-registry/:formType/:sectionId
 * Lookup a specific destination entry.
 */
app.get('/api/destination-registry/:formType/:sectionId', (req, res) => {
  try {
    const { formType, sectionId } = req.params;
    const includeDeferred = req.query?.includeDeferred === 'true';
    const entry = getDestination(formType, sectionId, includeDeferred);
    if (!entry) {
      return res.status(404).json({
        ok: false,
        error: `No destination found for formType="${formType}" sectionId="${sectionId}"`,
        formType,
        sectionId,
      });
    }
    res.json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/logs
 * List all log files in logs/.
 */
app.get('/api/logs', (_q, res) => {
  try {
    const files = getLogFiles();
    res.json({ ok: true, files, count: files.length, logsDir: getLogsDir() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/logs/:date
 * Read a specific log file by date (YYYY-MM-DD).
 * Returns parsed log entries (JSON objects).
 * Query: ?limit=100 to limit entries returned (default: 200)
 */
app.get('/api/logs/:date', (req, res) => {
  try {
    const date = String(req.params.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD format' });
    }
    const limit = Math.min(1000, Math.max(1, parseInt(req.query?.limit) || 200));
    const entries = readLogFile(date);
    const sliced = entries.slice(-limit);
    res.json({ ok: true, date, entries: sliced, total: entries.length, returned: sliced.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/export/stats
 * Returns what would be included in a support bundle (counts, sizes).
 */
app.get('/api/export/stats', (_q, res) => {
  try {
    const stats = getBundleStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/export/bundle
 * Create a support bundle (cases + approvedNarratives + logs).
 * Body: { includeAllLogs: boolean, zip: boolean }
 * Returns: { ok, bundlePath, isZip, manifest }
 */
app.post('/api/export/bundle', async (_q, res) => {
  try {
    log.info('[export] Creating support bundle...');
    const result = await createSupportBundle({
      includeAllLogs: Boolean(_q.body?.includeAllLogs),
      zip:            _q.body?.zip !== false, // default true
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

/**
 * GET /api/export/list
 * List existing support bundles in exports/.
 */
app.get('/api/export/list', (_q, res) => {
  try {
    const exports = listExports();
    res.json({ ok: true, exports, count: exports.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── End production desktop endpoints ──────────────────────────────────────────

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  FULL-DRAFT ORCHESTRATOR ENDPOINTS (NEW PATH — Phase 4 Architecture)   ║
// ║                                                                          ║
// ║  These endpoints implement the new context-driven full-draft generation. ║
// ║  The legacy section-by-section endpoints above are PRESERVED and        ║
// ║  UNCHANGED. Both paths operate simultaneously (dual-path mode).         ║
// ║                                                                          ║
// ║  New endpoints:                                                          ║
// ║    POST /api/cases/:caseId/generate-full-draft  — trigger orchestrator  ║
// ║    GET  /api/generation/runs/:runId/status      — poll run status       ║
// ║    GET  /api/generation/runs/:runId/result      — get final result      ║
// ║    GET  /api/cases/:caseId/generation-runs      — list runs for case    ║
// ║    POST /api/generation/regenerate-section      — regenerate one section ║
// ║    POST /api/db/migrate-legacy-kb               — import KB to SQLite   ║
// ║    GET  /api/db/status                          — SQLite health check   ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ── In-memory run store for async polling ─────────────────────────────────────
// Stores the full draftPackage result keyed by runId.
// The run status is always read from SQLite; this stores the full result object.
const _runResults = new Map();

// ── POST /api/cases/:caseId/generate-full-draft ───────────────────────────────
/**
 * Trigger full-draft generation for a case via the orchestrator.
 *
 * This is the NEW path. The legacy POST /api/generate-batch remains unchanged.
 *
 * Body: { formType?: string, options?: object }
 * Returns: { ok, runId, status, estimatedDurationMs, message }
 *
 * The run executes asynchronously. Poll GET /api/generation/runs/:runId/status
 * to track progress, then GET /api/generation/runs/:runId/result for the output.
 */
app.post('/api/cases/:caseId/generate-full-draft', async (req, res) => {
  const { caseId } = req.params;
  const { formType, options = {} } = req.body || {};

  if (!caseId) {
    return res.status(400).json({ ok: false, error: 'caseId is required' });
  }

  // Scope enforcement — deferred forms blocked
  const resolvedFormType = formType || 'unknown';
  if (resolvedFormType !== 'unknown' && isDeferredForm(resolvedFormType)) {
    logDeferredAccess(resolvedFormType, '/api/cases/:caseId/generate-full-draft', log);
    return res.status(400).json({
      ok: false,
      supported: false,
      scope: 'deferred',
      error: `Form type "${resolvedFormType}" is deferred and not supported in the current production scope.`,
    });
  }

  // Verify case exists (use process.cwd() — safe in both CJS and ESM contexts)
  const caseDir = path.join(process.cwd(), 'cases', caseId);
  if (!fs.existsSync(caseDir)) {
    return res.status(404).json({ ok: false, error: `Case not found: ${caseId}` });
  }

  // Start orchestrator asynchronously — return runId immediately
  let runId = null;

  try {
    // Get estimated duration from report plan (quick, synchronous)
    let estimatedDurationMs = 12000; // default estimate
    try {
      const ctx  = await buildAssignmentContext(caseId);
      const plan = buildReportPlan(ctx);
      estimatedDurationMs = plan.estimatedDurationMs || 12000;
      runId = null; // will be set by orchestrator
    } catch { /* non-fatal — use default estimate */ }

    // Launch orchestrator in background (non-blocking)
    const orchestratorPromise = runFullDraftOrchestrator({
      caseId,
      formType: resolvedFormType === 'unknown' ? undefined : resolvedFormType,
      options,
    });

    // Get the runId from the first tick (orchestrator creates it synchronously before first await)
    // We use a small trick: resolve the promise and store the result
    orchestratorPromise.then(result => {
      if (result?.runId) {
        _runResults.set(result.runId, result);
        log.info('[orchestrator] run complete', { runId: result.runId, ok: result.ok });
      }
    }).catch(err => {
      log.error('[orchestrator] run error', { error: err.message });
    });

    // We need the runId synchronously — read it from SQLite after a brief yield
    // The orchestrator creates the run record before any async work
    await new Promise(r => setTimeout(r, 50));

    // Find the most recent pending/running run for this case
    const db = getDb();
    const latestRun = db.prepare(`
      SELECT id FROM generation_runs
       WHERE case_id = ? AND status IN ('pending', 'running')
       ORDER BY created_at DESC LIMIT 1
    `).get(caseId);

    runId = latestRun?.id || null;

    res.json({
      ok:                 true,
      runId,
      status:             'running',
      estimatedDurationMs,
      message:            'Full-draft generation started. Poll /api/generation/runs/:runId/status for progress.',
    });

  } catch (err) {
    log.error('[generate-full-draft]', err.message);
    res.status(500).json({ ok: false, error: err.message, runId });
  }
});

// ── GET /api/generation/runs/:runId/status ────────────────────────────────────
/**
 * Poll the status of a generation run.
 *
 * Returns: {
 *   ok, runId, status, phase, sectionsCompleted, sectionsTotal,
 *   elapsedMs, sectionStatuses, phaseTimings, retrieval, warnings
 * }
 */
app.get('/api/generation/runs/:runId/status', (req, res) => {
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

// ── GET /api/generation/runs/:runId/result ────────────────────────────────────
/**
 * Get the final result of a completed generation run.
 *
 * Returns: {
 *   ok, runId, draftPackage, metrics, warnings, sections[]
 * }
 */
app.get('/api/generation/runs/:runId/result', (req, res) => {
  const { runId } = req.params;

  try {
    // Check in-memory store first (fastest)
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
      });
    }

    // Fall back to SQLite
    const status = getRunStatus(runId);
    if (!status) {
      return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
    }

    if (status.status === 'running' || status.status === 'pending') {
      return res.json({
        ok:      true,
        runId,
        status:  status.status,
        message: 'Run is still in progress. Try again shortly.',
        elapsedMs: status.elapsedMs,
      });
    }

    // Load generated sections from SQLite
    const sections = getGeneratedSectionsForRun(runId);
    const sectionsMap = {};
    for (const s of sections) {
      sectionsMap[s.section_id] = {
        sectionId: s.section_id,
        text:      s.final_text || s.draft_text || '',
        approved:  !!s.approved,
        approvedAt: s.approved_at,
        insertedAt: s.inserted_at,
        examplesUsed: s.examples_used,
      };
    }

    res.json({
      ok:          true,
      runId,
      status:      status.status,
      sections:    sectionsMap,
      sectionList: sections,
      metrics:     status.phaseTimings,
      warnings:    status.warnings || [],
      retrieval:   status.retrieval,
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/cases/:caseId/generation-runs ────────────────────────────────────
/**
 * List all generation runs for a case (most recent first, max 20).
 *
 * Returns: { ok, runs[], count }
 */
app.get('/api/cases/:caseId/generation-runs', (req, res) => {
  const { caseId } = req.params;

  try {
    const runs = getRunsForCase(caseId);
    res.json({ ok: true, runs, count: runs.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/generation/regenerate-section ───────────────────────────────────
/**
 * Regenerate a single section within an existing run.
 * Useful for fixing a failed or thin section without re-running the full draft.
 *
 * Body: { runId, sectionId, caseId }
 * Returns: { ok, sectionId, text, metrics }
 */
app.post('/api/generation/regenerate-section', async (req, res) => {
  const { runId, sectionId, caseId } = req.body || {};

  if (!runId || !sectionId || !caseId) {
    return res.status(400).json({ ok: false, error: 'runId, sectionId, and caseId are required' });
  }

  try {
    // Load run status to get form type
    const runStatus = getRunStatus(runId);
    if (!runStatus) {
      return res.status(404).json({ ok: false, error: `Run not found: ${runId}` });
    }

    const formType   = runStatus.formType || '1004';
    const sectionDef = getSectionDef(formType, sectionId);
    if (!sectionDef) {
      return res.status(400).json({ ok: false, error: `Unknown section: ${sectionId} for form ${formType}` });
    }

    // Build context and retrieval pack
    const context      = await buildAssignmentContext(caseId);
    const plan         = buildReportPlan(context);
    const retrievalPack = await buildRetrievalPack(context, plan);

    // Get prior results for synthesis sections
    const priorSections = getGeneratedSectionsForRun(runId);
    const priorResults  = {};
    for (const s of priorSections) {
      if (s.section_id !== sectionId) {
        priorResults[s.section_id] = { text: s.final_text || '', ok: true };
      }
    }

    // Run the section job
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

// ── POST /api/db/migrate-legacy-kb ────────────────────────────────────────────
/**
 * Import the existing flat-file knowledge base into SQLite memory_items.
 * Idempotent — safe to run multiple times.
 *
 * Returns: { ok, imported, skipped, upgraded, errors, sources, durationMs }
 */
app.post('/api/db/migrate-legacy-kb', async (_req, res) => {
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

// ── GET /api/db/status ────────────────────────────────────────────────────────
/**
 * SQLite database health check and table counts.
 *
 * Returns: { ok, dbPath, dbSizeBytes, tables, memoryCounts }
 */
app.get('/api/db/status', (req, res) => {
  try {
    const tableCounts  = getTableCounts();
    const memoryStats  = getMemoryItemStats();
    const dbPath       = getDbPath();
    const dbSizeBytes  = getDbSizeBytes();

    res.json({
      ok:           true,
      dbPath,
      dbSizeBytes,
      dbSizeKb:     Math.round(dbSizeBytes / 1024),
      tables:       tableCounts,
      memory:       memoryStats,
      initialized:  true,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, initialized: false });
  }
});

// ── End orchestrator endpoints ────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  // ── Initialize file logger and wire to stdout logger ─────────────────────
  try {
    initFileLogger();
    setFileLogWriter(writeLogEntry);
    log.info('file-logger:wired', { logFile: getLogsDir() });
  } catch (flErr) {
    console.warn('[fileLogger] init failed (non-fatal):', flErr.message);
  }

  console.log('\nCACC Writer running at http://localhost:' + PORT);
  console.log('Model: ' + MODEL);
  console.log('Open http://localhost:' + PORT + ' in your browser.\n');
});
server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') { console.error('Port ' + PORT + ' is already in use.'); process.exit(1); }
  console.error('Server startup error:', err?.message || err);
  process.exit(1);
});
