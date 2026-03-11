/**
 * cacc-writer-server.js
 * ----------------------
 * Root server — startup, wiring, and legacy inline endpoints.
 *
 * Responsibilities: config/env, middleware, static files, router mounting,
 * legacy inline endpoints (not yet in modular routers), server startup.
 *
 * All business logic lives in server/api/* and server/services/*.
 * Do NOT add new logic here — extend the modular routers instead.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ARCHITECTURE UPGRADE IN PROGRESS                               ║
 * ║  New workflow: server/workflow/appraisalWorkflow.ts             ║
 * ║  DO NOT EXTEND the legacy generation/insertion logic here.      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });

import express from 'express';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  isDeferredForm, logDeferredAccess, ACTIVE_FORMS, DEFERRED_FORMS,
} from './server/config/productionScope.js';
import { CORE_SECTIONS } from './server/config/coreSections.js';

import {
  CASES_DIR, resolveCaseDir, getCaseFormConfig,
} from './server/utils/caseUtils.js';
import { readJSON, writeJSON, withVoiceLock } from './server/utils/fileUtils.js';
import {
  trimText, asArray, aiText,
  parseJSONObject, parseJSONArray,
  normSev, normalizeQuestions, normalizeGrade,
} from './server/utils/textUtils.js';
import { upload, ensureAI } from './server/utils/middleware.js';
import { extractPdfText } from './server/ingestion/pdfExtractor.js';

import { callAI, client, MODEL } from './server/openaiClient.js';
import { addExample, indexExamples, addApprovedNarrative } from './server/knowledgeBase.js';
import { initFileLogger, writeLogEntry, getLogFiles, readLogFile, getLogsDir } from './server/fileLogger.js';
import { setFileLogWriter } from './server/logger.js';
import { listAllDestinations, getDestination, getTargetSoftware, getFallbackStrategy } from './server/destinationRegistry.js';
import { getBundleStats, createSupportBundle, listExports } from './server/backupExport.js';
import { buildReviewMessages } from './server/promptBuilder.js';
import log from './server/logger.js';
import { geocodeAddress, distanceMiles, cardinalDirection, buildAddressString } from './server/geocoder.js';
import { computeWorkflowStatus, isValidWorkflowStatus, pipelineToWorkflowStatus } from './server/workflowStatus.js';
import { getMissingFacts, formatMissingFactsForUI } from './server/sectionDependencies.js';

import {
  runFullDraftOrchestrator, getRunStatus, getRunsForCase, getGeneratedSectionsForRun,
} from './server/orchestrator/generationOrchestrator.js';
import { runSectionJob, getSectionJobsForRun } from './server/orchestrator/sectionJobRunner.js';
import { buildAssignmentContext } from './server/context/assignmentContextBuilder.js';
import { buildReportPlan, getSectionDef } from './server/context/reportPlanner.js';
import { buildRetrievalPack } from './server/context/retrievalPackBuilder.js';
import { runLegacyKbImport, getMemoryItemStats } from './server/migration/legacyKbImport.js';
import { getDb, getDbPath, getDbSizeBytes, getTableCounts } from './server/db/database.js';

import casesRouter        from './server/api/casesRoutes.js';
import generationRouter   from './server/api/generationRoutes.js';
import workflowRouter     from './server/api/workflowRoutes.js';
import memoryRouter       from './server/api/memoryRoutes.js';
import agentsRouter       from './server/api/agentsRoutes.js';
import healthRouter       from './server/api/healthRoutes.js';
import intelligenceRouter from './server/api/intelligenceRoutes.js';
import documentRouter    from './server/api/documentRoutes.js';
import phase6MemoryRouter from './server/api/phase6Routes.js';
import qcRouter           from './server/api/qcRoutes.js';
import insertionRouter    from './server/api/insertionRoutes.js';
import operationsRouter   from './server/api/operationsRoutes.js';
import queueRouter        from './server/api/queueRoutes.js';
import { initAuditLogger, emitSystemEvent } from './server/operations/auditLogger.js';
import { runTransientCleanup } from './server/operations/retentionManager.js';
<<<<<<< HEAD
import { loadCaseContext, generateSection, generateSections, parseReviewResponse } from './server/services/generationService.js';
=======
import { runStartupChecks } from './server/config/startupChecks.js';
>>>>>>> 4e8c1fb (Phase A: modularize workflow/generation routes and expand smoke coverage)

const require  = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT           = Number(process.env.PORT) || 5178;
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const ACI_AGENT_URL  = process.env.ACI_AGENT_URL || 'http://localhost:5180';
const RQ_AGENT_URL   = process.env.RQ_AGENT_URL  || 'http://localhost:5181';
const PIPELINE_STAGES  = ['intake','extracting','generating','review','approved','inserting','complete'];
const VALID_SECTION_STATUSES = ['not_started','drafted','reviewed','approved','inserted','verified','copied','error'];

<<<<<<< HEAD
// ── Startup validation ────────────────────────────────────────────────────────
{
  const warnings = [];
  if (!OPENAI_API_KEY) warnings.push('OPENAI_API_KEY is not set — AI endpoints will return 503');
  if (!process.env.PINECONE_API_KEY) warnings.push('PINECONE_API_KEY is not set — vector retrieval will be unavailable');
  if (!process.env.PINECONE_INDEX_NAME) warnings.push('PINECONE_INDEX_NAME is not set — vector retrieval will be unavailable');
  for (const w of warnings) log.warn('startup:env-check', w);
}

if (!fs.existsSync(CASES_DIR)) fs.mkdirSync(CASES_DIR, { recursive: true });
const app = express();
app.use(express.json({ limit: '10mb' }));
log.info('startup', `CACC Writer starting... Model: ${MODEL}`);
=======
runStartupChecks({
  port: PORT,
  casesDir: CASES_DIR,
  openAiApiKey: OPENAI_API_KEY,
  logger: console,
});

const app = express();
app.use(express.json({ limit: '10mb' }));
console.log('CACC Writer starting... Model:', MODEL);
>>>>>>> 4e8c1fb (Phase A: modularize workflow/generation routes and expand smoke coverage)

app.use((req, res, next) => {
  const start = Date.now();
  const skip  = ['/favicon.ico','/app.js','/styles.css','/index.html','/'].includes(req.path);
  res.on('finish', () => { if (!skip) log.request(req.method, req.path, res.statusCode, Date.now() - start); });
  next();
});

// Static files — serve only the specific frontend files (not the whole project root)
app.get('/',           (_q, r) => r.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (_q, r) => r.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js',     (_q, r) => r.sendFile(path.join(__dirname, 'app.js')));
app.get('/styles.css', (_q, r) => r.sendFile(path.join(__dirname, 'styles.css')));
app.get('/favicon.ico', (_q, r) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0b1020"/><text x="16" y="23" font-family="Arial" font-size="20" font-weight="bold" fill="#d7b35a" text-anchor="middle">C</text></svg>';
  r.setHeader('Content-Type','image/svg+xml'); r.setHeader('Cache-Control','public, max-age=86400'); r.send(svg);
});

app.param('caseId', (req, res, next, caseId) => {
  const cd = resolveCaseDir(caseId);
  if (!cd) return res.status(400).json({ ok: false, error: 'Invalid caseId format' });
  req.caseDir = cd; next();
});

app.use('/api',        healthRouter);
app.use('/api/cases',  casesRouter);
app.use('/api',        generationRouter);
app.use('/api',        workflowRouter);
app.use('/api',        memoryRouter);
app.use('/api',        agentsRouter);
app.use('/api',        intelligenceRouter);
app.use('/api',        documentRouter);
app.use('/api/memory', phase6MemoryRouter);
app.use('/api',        qcRouter);
app.use('/api',        insertionRouter);
app.use('/api',        operationsRouter);
app.use('/api',        queueRouter);

// ══════════════════════════════════════════════════════════════════════════════
// LEGACY INLINE ENDPOINTS — preserved for compatibility, do not extend
// ══════════════════════════════════════════════════════════════════════════════

<<<<<<< HEAD
// ── Shared helpers for consistent behavior across all generation endpoints ───

/**
 * saveOutputsWithHistory(caseDir, newResults)
 * Archives previous output text to history.json before overwriting outputs.json.
 * Ensures all generation endpoints preserve version history consistently.
 */
function saveOutputsWithHistory(caseDir, newResults) {
  const outFile = path.join(caseDir, 'outputs.json');
  const histFile = path.join(caseDir, 'history.json');
  const existing = readJSON(outFile, {});
  const history = readJSON(histFile, {});
  for (const fid of Object.keys(newResults)) {
    if (existing[fid]?.text) {
      if (!history[fid]) history[fid] = [];
      history[fid].unshift({ text: existing[fid].text, title: existing[fid].title, savedAt: new Date().toISOString() });
      history[fid] = history[fid].slice(0, 3);
    }
  }
  writeJSON(histFile, history);
  writeJSON(outFile, { ...existing, ...newResults, updatedAt: new Date().toISOString() });
}

/**
 * updateSectionStatuses(caseDir, results, errors)
 * Writes section_statuses.json with 'drafted' for successes and 'error' for failures.
 * Ensures all generation endpoints update section status consistently.
 */
function updateSectionStatuses(caseDir, results, errors) {
  const secFile = path.join(caseDir, 'section_statuses.json');
  const secStatuses = readJSON(secFile, {});
  for (const sid of Object.keys(results)) {
    secStatuses[sid] = { ...(secStatuses[sid] || {}), status: 'drafted', updatedAt: new Date().toISOString(), title: results[sid]?.title || sid };
  }
  for (const sid of Object.keys(errors)) {
    secStatuses[sid] = { ...(secStatuses[sid] || {}), status: 'error', updatedAt: new Date().toISOString() };
  }
  writeJSON(secFile, secStatuses);
  return secStatuses;
}

app.post('/api/generate', ensureAI, async (req, res) => {
  try {
    const { fieldId, formType, caseId, facts: bodyFacts } = req.body;
    const prompt = trimText(req.body?.prompt, 24000);
    const requestedFt = String(formType || '').trim().toLowerCase();
    if (requestedFt && isDeferredForm(requestedFt)) {
      logDeferredAccess(requestedFt, 'POST /api/generate', log);
      return res.status(400).json({ ok:false, supported:false, formType:requestedFt, scope:'deferred',
        message:`Generation is not available for form type "${requestedFt}". Active forms: ${ACTIVE_FORMS.join(', ')}.` });
    }
    if (fieldId) {
      const ft = normalizeFormType(formType);
      let facts = bodyFacts || {}, assignmentMeta = null, locationContext = null;
      if (caseId) {
        const ctx = await loadCaseContext(caseId);
        if (ctx) {
          if (!bodyFacts) facts = ctx.facts;
          assignmentMeta = ctx.assignmentMeta;
          locationContext = ctx.locationContext;
        }
      }
      const { text, examplesUsed } = await generateSection({ formType: ft, fieldId, facts, assignmentMeta, locationContext });
      return res.json({ ok:true, result:text, fieldId, formType:ft, examplesUsed, locationContextInjected:Boolean(locationContext) });
    }
    if (!prompt) return res.status(400).json({ ok:false, error:'prompt or fieldId is required' });
    const r = await client.responses.create({ model:MODEL, input:genInput(prompt) });
    res.json({ ok:true, result:aiText(r) });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

app.post('/api/generate-batch', ensureAI, async (req, res) => {
  try {
    const { fields, caseId, twoPass = false } = req.body;
    if (!Array.isArray(fields)||!fields.length) return res.status(400).json({ ok:false, error:'fields must be a non-empty array' });
    if (fields.length > MAX_BATCH_FIELDS) return res.status(400).json({ ok:false, error:'fields must be <= '+MAX_BATCH_FIELDS });
    let caseDir = null, caseFormType = DEFAULT_FORM_TYPE, ctx = null;
    if (caseId) {
      ctx = await loadCaseContext(caseId);
      if (!ctx) return res.status(404).json({ ok:false, error:'Case not found' });
      caseDir = ctx.caseDir;
      caseFormType = ctx.formType;
      if (isDeferredForm(caseFormType)) {
        logDeferredAccess(caseFormType,'POST /api/generate-batch',log);
        return res.status(400).json({ ok:false, supported:false, formType:caseFormType, scope:'deferred',
          message:`Batch generation is not available for form type "${caseFormType}". Active forms: ${ACTIVE_FORMS.join(', ')}.` });
      }
    }
    const { results, errors } = await generateSections({
      fields, formType: caseFormType, facts: ctx?.facts || {},
      assignmentMeta: ctx?.assignmentMeta, locationContext: ctx?.locationContext, twoPass,
    });
    if (caseDir) {
      saveOutputsWithHistory(caseDir, results);
      updateSectionStatuses(caseDir, results, errors);
      const meta=readJSON(path.join(caseDir,'meta.json'));
      meta.updatedAt=new Date().toISOString(); meta.pipelineStage='generating';
      writeJSON(path.join(caseDir,'meta.json'),meta);
    }
    res.json({ ok:true, results, errors });
  } catch (err) { log.error('[generate-batch]', err.message); res.status(500).json({ ok:false, error:err.message }); }
});

app.post('/api/cases/create', (req, res) => {
  try {
    const requestedFormType = String(req.body?.formType||'').trim().toLowerCase() || DEFAULT_FORM_TYPE;
    if (isDeferredForm(requestedFormType)) {
      logDeferredAccess(requestedFormType,'POST /api/cases/create',log);
      return res.status(400).json({ ok:false, supported:false, formType:requestedFormType, scope:'deferred',
        message:'Cannot create a new case for form type '+JSON.stringify(requestedFormType)+'. Active forms: '+ACTIVE_FORMS.join(', ')+'.' });
    }
    let caseId='', caseDir='';
    do { caseId=uuidv4().replace(/-/g,'').slice(0,8); caseDir=casePath(caseId); } while (fs.existsSync(caseDir));
    const baseMeta = { caseId, address:trimText(req.body?.address,240), borrower:trimText(req.body?.borrower,180),
      notes:trimText(req.body?.notes,1000), formType:normalizeFormType(req.body?.formType),
      status:'active', pipelineStage:'intake', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
    const meta = applyMetaDefaults({ ...baseMeta, ...extractMetaFields(req.body,trimText) });
    fs.mkdirSync(path.join(caseDir,'documents'),{ recursive:true });
    ['meta.json','facts.json','doc_text.json','outputs.json'].forEach(f=>writeJSON(path.join(caseDir,f),{}));
    writeJSON(path.join(caseDir,'feedback.json'),[]);
    writeJSON(path.join(caseDir,'meta.json'),meta);
    res.json({ ok:true, caseId, meta });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});
=======
>>>>>>> 4e8c1fb (Phase A: modularize workflow/generation routes and expand smoke coverage)
app.post('/api/cases/:caseId/upload', upload.single('file'), async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    if (!req.file) return res.status(400).json({ ok:false, error:'No file uploaded' });
    const isPdf=req.file.mimetype==='application/pdf'||String(req.file.originalname||'').toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ ok:false, error:'Only PDF files are allowed' });
    const docType=trimText(req.body.docType||'unknown',60).replace(/[^a-z0-9_-]/gi,'_');
    fs.mkdirSync(path.join(cd,'documents'),{ recursive:true });
    fs.writeFileSync(path.join(cd,'documents',docType+'.pdf'),req.file.buffer);
    let extractedText='', pageCount=0;
    try {
      const { text, method } = await extractPdfText(req.file.buffer,client,MODEL);
      extractedText=text||'';
      try { const p=await pdfParse(req.file.buffer); pageCount=p.numpages||0; } catch { pageCount=0; }
      log.info('upload:ocr', { method, chars: extractedText.length, docType: req.body.docType });
    } catch (ocrErr) { log.warn('upload:ocr-failed', { error: ocrErr.message }); extractedText='[PDF text extraction failed]'; }
    extractedText=extractedText.replace(/\n{4,}/g,'\n\n').replace(/[ \t]{3,}/g,'  ').trim();
    const dtf=path.join(cd,'doc_text.json'), docText=readJSON(dtf,{});
    docText[docType]=extractedText; writeJSON(dtf,docText);
    const mf=path.join(cd,'meta.json'), meta=readJSON(mf);
    meta.updatedAt=new Date().toISOString();
    if (!meta.docs) meta.docs={};
    meta.docs[docType]={ uploadedAt:new Date().toISOString(), pages:pageCount, bytes:req.file.size };
    writeJSON(mf,meta);
    res.json({ ok:true, docType, wordCount:extractedText.split(/\s+/).filter(Boolean).length, pages:pageCount, preview:extractedText.slice(0,400) });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});
app.post('/api/cases/:caseId/extract-facts', ensureAI, async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const docText=readJSON(path.join(cd,'doc_text.json'),{}), existingFacts=readJSON(path.join(cd,'facts.json'),{});
    const answers=req.body.answers||{}, { formType, formConfig }=getCaseFormConfig(cd);
    if (!Object.keys(docText).length&&!Object.keys(answers).length) return res.status(400).json({ ok:false, error:'No documents or answers. Upload PDFs first.' });
    const docBlock=Object.entries(docText).map(([t,x])=>'=== '+t.toUpperCase()+' ===\n'+String(x).slice(0,5000)).join('\n\n');
    const ansBlock=Object.keys(answers).length?'\n\nAPPRAISER ANSWERS:\n'+Object.entries(answers).map(([q,a])=>'Q: '+q+'\nA: '+a).join('\n\n'):'';
    const prompt=(formConfig.extractContext||('Appraisal data extractor for form '+formType+'.'))+'\nReturn ONLY valid JSON. Use null for missing. confidence: high/medium/low.\n\nSCHEMA:\n'+JSON.stringify(formConfig.factsSchema||{},null,2)+'\n\nDOCUMENTS:\n'+docBlock+ansBlock+'\n\nReturn ONLY the JSON object.';
    const r=await client.responses.create({ model:MODEL, input:prompt });
    const facts=parseJSONObject(aiText(r));
    const merged={ ...existingFacts, ...facts, extractedAt:new Date().toISOString() };
    writeJSON(path.join(cd,'facts.json'),merged);
    res.json({ ok:true, facts:merged });
  } catch (err) { res.status(500).json({ ok:false, error:'Failed to parse facts JSON: '+err.message }); }
});

app.post('/api/cases/:caseId/questionnaire', ensureAI, async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const facts=readJSON(path.join(cd,'facts.json'),{}), { formType, formConfig }=getCaseFormConfig(cd);
    const priorities=asArray(formConfig.questionnairePriorities).map((p,i)=>(i+1)+'. '+p).join('\n');
    const prompt='You are an appraisal assistant. Based on the facts below, generate 5-8 targeted questions to fill gaps.\n\nFORM: '+formType+'\nPRIORITIES:\n'+priorities+'\n\nFACTS:\n'+JSON.stringify(facts,null,2)+'\n\nReturn JSON: { questions: [{id,question,priority,category}] }';
    const r=await client.responses.create({ model:MODEL, input:prompt });
    const parsed=parseJSONObject(aiText(r));
    res.json({ ok:true, questions:normalizeQuestions(parsed?.questions||[]) });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

app.post('/api/cases/:caseId/grade', ensureAI, async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const outputs=readJSON(path.join(cd,'outputs.json'),{}), facts=readJSON(path.join(cd,'facts.json'),{});
    const { formType }=getCaseFormConfig(cd);
    const fieldId=trimText(req.body?.fieldId,80), text=trimText(req.body?.text,8000)||outputs[fieldId]?.text||'';
    if (!text) return res.status(400).json({ ok:false, error:'No text to grade' });
    const prompt='Grade this appraisal narrative. Return JSON: { score:0-100, grade:A/B/C/D/F, strengths:[str], weaknesses:[str], suggestions:[str], issues:[{severity,message}] }\n\nFIELD: '+fieldId+'\nFORM: '+formType+'\n\nTEXT:\n'+text;
    const r=await client.responses.create({ model:MODEL, input:prompt });
    const grade=parseJSONObject(aiText(r));
    res.json({ ok:true, fieldId, grade:normalizeGrade(grade) });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});
app.post('/api/cases/:caseId/feedback', async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const { fieldId, fieldTitle, originalText, editedText, text, action, approved, rating } = req.body;
    const sid=trimText(fieldId,80);
    const safeText=trimText(editedText||text,8000);
    const isApproved=Boolean(approved)||(rating==='up');
    if (!sid||!safeText) return res.status(400).json({ ok:false, error:'fieldId and text/editedText are required' });
    const fbFile=path.join(cd,'feedback.json'), fb=readJSON(fbFile,[]);
    fb.unshift({ fieldId:sid, fieldTitle:fieldTitle||sid, originalText:trimText(originalText,8000)||null,
      text:safeText, action:action||'approve', approved:isApproved, rating:rating||null, createdAt:new Date().toISOString() });
    writeJSON(fbFile,fb.slice(0,50));
    let savedToKB=false;
    if (isApproved&&safeText.length>30) {
      try {
        const { formType }=getCaseFormConfig(cd);
        await addApprovedNarrative({ fieldId:sid, text:safeText, formType, source:'user-approved' });
        savedToKB=true;
      } catch (kbErr) { log.warn('feedback:kb-write', { error: kbErr.message }); }
    }
    const meta=readJSON(path.join(cd,'meta.json'));
    meta.updatedAt=new Date().toISOString();
    writeJSON(path.join(cd,'meta.json'),meta);
    res.json({ ok:true, saved:true, count:fb.length, savedToKB });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

app.post('/api/cases/:caseId/review-section', ensureAI, async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const fieldId=trimText(req.body?.fieldId,80), draftText=trimText(req.body?.text,8000);
    if (!fieldId||!draftText) return res.status(400).json({ ok:false, error:'fieldId and text are required' });
    const facts=readJSON(path.join(cd,'facts.json'),{}), { formType }=getCaseFormConfig(cd);
    const reviewMessages=buildReviewMessages({ draftText, facts, fieldId, formType });
    const reviewRaw=await callAI(reviewMessages);
    let reviewResult;
    try { reviewResult=parseReviewResponse(reviewRaw); }
    catch { reviewResult={ revisedText:reviewRaw, issues:[], score:null }; }
    res.json({ ok:true, fieldId, review:reviewResult });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

<<<<<<< HEAD
app.post('/api/similar-examples', (req, res) => {
  try {
    const { fieldId, limit=3, formType } = req.body;
    const safeLimit=Math.max(1,Math.min(Number(limit)||3,10));
    const normalized=formType?normalizeFormType(formType):null;
    res.json({ ok:true, examples:collectExamples(trimText(fieldId,80)||null,safeLimit,normalized) });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});
app.post('/api/workflow/run', ensureAI, async (req, res) => {
  try {
    const { caseId, fields, twoPass=false, saveOutputs=true } = req.body;
    const _wfFt=String(req.body?.formType||'').trim().toLowerCase();
    if (_wfFt&&isDeferredForm(_wfFt)) { logDeferredAccess(_wfFt,'POST /api/workflow/run',log); return res.status(400).json({ ok:false, supported:false, formType:_wfFt, scope:'deferred', message:`Generation is not available for form type "${_wfFt}". Active forms: ${ACTIVE_FORMS.join(', ')}.` }); }
    if (!caseId) return res.status(400).json({ ok:false, error:'caseId is required' });
    const ctx = await loadCaseContext(caseId);
    if (!ctx) return res.status(404).json({ ok:false, error:'Case not found' });
    const { caseDir, formType, formConfig, facts, assignmentMeta, locationContext } = ctx;
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType,'POST /api/workflow/run',log);
      return res.status(400).json({ ok:false, supported:false, formType, scope:'deferred', message:`Generation is not available for form type "${formType}". Active forms: ${ACTIVE_FORMS.join(', ')}.` });
    }
    const targetFields=Array.isArray(fields)&&fields.length?fields:(formConfig.workflowFields||CORE_SECTIONS[formType]||[]);
    if (!targetFields.length) return res.status(400).json({ ok:false, error:'No fields to generate' });
    const { results, errors } = await generateSections({ fields: targetFields, formType, facts, assignmentMeta, locationContext, twoPass });
    if (saveOutputs&&Object.keys(results).length) {
      saveOutputsWithHistory(caseDir, results);
      updateSectionStatuses(caseDir, results, errors);
      const meta=readJSON(path.join(caseDir,'meta.json'));
      meta.updatedAt=new Date().toISOString(); meta.pipelineStage='generating';
      writeJSON(path.join(caseDir,'meta.json'),meta);
    }
    res.json({ ok:true, results, errors, formType, fieldsAttempted:targetFields.length });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});
app.post('/api/workflow/run-batch', ensureAI, async (req, res) => {
  try {
    const { cases, fields, twoPass=false } = req.body;
    const _wfbFt=String(req.body?.formType||'').trim().toLowerCase();
    if (_wfbFt&&isDeferredForm(_wfbFt)) { logDeferredAccess(_wfbFt,'POST /api/workflow/run-batch',log); return res.status(400).json({ ok:false, supported:false, formType:_wfbFt, scope:'deferred', message:`Batch generation is not available for form type "${_wfbFt}". Active forms: ${ACTIVE_FORMS.join(', ')}.` }); }
    if (!Array.isArray(cases)||!cases.length) return res.status(400).json({ ok:false, error:'cases must be a non-empty array' });
    if (cases.length>10) return res.status(400).json({ ok:false, error:'cases must be <= 10' });
    const batchResults=[], batchErrors=[];
    for (const caseId of cases) {
      const ctx = await loadCaseContext(caseId);
      if (!ctx) { batchErrors.push({ caseId, error:'Case not found' }); continue; }
      const { caseDir, formType, formConfig, facts, assignmentMeta, locationContext } = ctx;
      if (isDeferredForm(formType)) { batchErrors.push({ caseId, error:'Deferred form type: '+formType }); continue; }
      try {
        const targetFields=Array.isArray(fields)&&fields.length?fields:(formConfig.workflowFields||CORE_SECTIONS[formType]||[]);
        const { results, errors } = await generateSections({ fields: targetFields, formType, facts, assignmentMeta, locationContext, twoPass });
        saveOutputsWithHistory(caseDir, results);
        updateSectionStatuses(caseDir, results, errors);
        const meta=readJSON(path.join(caseDir,'meta.json'));
        meta.updatedAt=new Date().toISOString(); meta.pipelineStage='generating';
        writeJSON(path.join(caseDir,'meta.json'),meta);
        batchResults.push({ caseId, results, errors });
      } catch (e) { batchErrors.push({ caseId, error:e.message }); }
    }
    res.json({ ok:true, batchResults, batchErrors });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

app.get('/api/workflow/health', (req, res) => {
  const caseDirs=fs.existsSync(CASES_DIR)?fs.readdirSync(CASES_DIR).filter(d=>CASE_ID_RE.test(d)):[];
  const activeCases=caseDirs.filter(d=>{ try { const m=readJSON(path.join(CASES_DIR,d,'meta.json')); return m?.status==='active'; } catch { return false; } });
  res.json({ ok:true, status:'healthy', casesDir:CASES_DIR, totalCases:caseDirs.length, activeCases:activeCases.length,
    model:MODEL, aiAvailable:Boolean(OPENAI_API_KEY), activeForms:ACTIVE_FORMS, deferredForms:DEFERRED_FORMS });
});

app.post('/api/workflow/ingest-pdf', upload.single('file'), ensureAI, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok:false, error:'No file uploaded' });
    const isPdf=req.file.mimetype==='application/pdf'||String(req.file.originalname||'').toLowerCase().endsWith('.pdf');
    if (!isPdf) return res.status(400).json({ ok:false, error:'Only PDF files are allowed' });
    const { text, method }=await extractPdfText(req.file.buffer,client,MODEL);
    const clean=text.replace(/\n{4,}/g,'\n\n').replace(/[ \t]{3,}/g,'  ').trim();
    res.json({ ok:true, text:clean, method, wordCount:clean.split(/\s+/).filter(Boolean).length, preview:clean.slice(0,500) });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});
app.post('/api/cases/:caseId/generate-core', ensureAI, async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const ctx = await loadCaseContext(req.params.caseId);
    if (!ctx) return res.status(404).json({ ok:false, error:'Case not found' });
    const { formType, formConfig, facts, assignmentMeta, locationContext } = ctx;
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType,'POST /api/cases/:caseId/generate-core',log);
      return res.status(400).json({ ok:false, supported:false, formType, scope:'deferred' });
    }
    const requestedFields=asArray(req.body?.fields);
    const coreSections=CORE_SECTIONS[formType]||[];
    const targetFields=requestedFields.length?coreSections.filter(s=>requestedFields.includes(s.id)):coreSections;
    if (!targetFields.length) return res.status(400).json({ ok:false, error:'No core sections defined for form type: '+formType });
    const { results, errors } = await generateSections({ fields: targetFields, formType, facts, assignmentMeta, locationContext });
    saveOutputsWithHistory(cd, results);
    const secStatuses = updateSectionStatuses(cd, results, errors);
    const meta=readJSON(path.join(cd,'meta.json'));
    meta.updatedAt=new Date().toISOString(); meta.pipelineStage='generating';
    writeJSON(path.join(cd,'meta.json'),meta);
    const statuses = {};
    for (const sid of Object.keys(results)) statuses[sid] = 'drafted';
    for (const sid of Object.keys(errors)) statuses[sid] = 'error';
    const genResults={}; for(const [sid,v] of Object.entries(results)) genResults[sid]={...v,sectionStatus:statuses[sid]||'drafted'};
    res.json({ ok:true, results:genResults, errors, statuses, formType, sectionsAttempted:targetFields.length,
      coreSections:targetFields, generated:Object.keys(results).length, failed:Object.keys(errors).length, pipelineStage:'generating' });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});
=======
>>>>>>> 4e8c1fb (Phase A: modularize workflow/generation routes and expand smoke coverage)
app.patch('/api/cases/:caseId/sections/:fieldId/status', (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const fieldId=trimText(req.params.fieldId,80), newStatus=String(req.body?.status||'').trim();
    if (!VALID_SECTION_STATUSES.includes(newStatus)) return res.status(400).json({ ok:false, error:'Invalid status: '+newStatus });
    const secFile=path.join(cd,'section_statuses.json'), statuses=readJSON(secFile,{});
    statuses[fieldId]={ ...(statuses[fieldId]||{}), status:newStatus, updatedAt:new Date().toISOString() };
    if (req.body?.notes) statuses[fieldId].notes=trimText(req.body.notes,500);
    writeJSON(secFile,statuses);
    const meta=readJSON(path.join(cd,'meta.json')); meta.updatedAt=new Date().toISOString();
    writeJSON(path.join(cd,'meta.json'),meta);
    const patchOutFile=path.join(cd,'outputs.json'); const patchOutputs=readJSON(patchOutFile,{}); const hasText=Boolean(patchOutputs[fieldId]?.text);
    const isApprovedStatus=['approved','inserted','verified'].includes(newStatus);
    if (patchOutputs[fieldId]) { patchOutputs[fieldId].sectionStatus=newStatus; patchOutputs[fieldId].approved=isApprovedStatus&&hasText; writeJSON(patchOutFile,patchOutputs); }
    res.json({ ok:true, fieldId, status:newStatus, sectionStatus:newStatus, approved:isApprovedStatus&&hasText, updatedAt:statuses[fieldId].updatedAt });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

app.post('/api/cases/:caseId/sections/:fieldId/copy', async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const fieldId=trimText(req.params.fieldId,80);
    const outputs=readJSON(path.join(cd,'outputs.json'),{});
    const text=trimText(req.body?.text,16000)||outputs[fieldId]?.text||'';
    if (!text) return res.status(400).json({ ok:false, error:'No text to copy for field: '+fieldId });
    const secFile=path.join(cd,'section_statuses.json'), statuses=readJSON(secFile,{});
    statuses[fieldId]={ ...(statuses[fieldId]||{}), status:'copied', copiedAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
    writeJSON(secFile,statuses);
    res.json({ ok:true, fieldId, text, charCount:text.length, status:'copied', message:'Text ready for manual paste' });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

app.get('/api/cases/:caseId/sections/status', (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const { formType }=getCaseFormConfig(cd);
    const statuses=readJSON(path.join(cd,'section_statuses.json'),{});
    const outputs=readJSON(path.join(cd,'outputs.json'),{});
    const coreSections=CORE_SECTIONS[formType]||[];
    const sectionsArr=coreSections.map(sec=>{ const st=statuses[sec.id]?.status||'not_started'; return { id:sec.id, title:sec.title, status:st, sectionStatus:st, approved:['approved','inserted','verified'].includes(st), hasOutput:Boolean(outputs[sec.id]?.text), updatedAt:statuses[sec.id]?.updatedAt||null }; });
    const sections=Object.fromEntries(sectionsArr.map(sec=>[sec.id,sec]));
    res.json({ ok:true, caseId:req.params.caseId, formType, sections, totalSections:sectionsArr.length,
      completedSections:sectionsArr.filter(sec=>['approved','inserted','verified'].includes(sec.status)).length });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

app.get('/api/cases/:caseId/destination-registry', (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const { formType }=getCaseFormConfig(cd);
    const destinations=listAllDestinations(formType);
    const drStatuses=readJSON(path.join(cd,'section_statuses.json'),{}), drOutputs=readJSON(path.join(cd,'outputs.json'),{});
    const fields=Object.fromEntries(destinations.map(d=>{ const st=drStatuses[d.fieldId]?.status||'not_started'; return [d.fieldId,{ ...d, sectionStatus:st, approved:['approved','inserted','verified'].includes(st), hasText:Boolean(drOutputs[d.fieldId]?.text) }]; }));
    const SW_MAP={'1004':'aci','commercial':'real_quantum'};
    const software=SW_MAP[formType]||(destinations[0]?getTargetSoftware(formType,destinations[0].fieldId):null);
    res.json({ ok:true, caseId:req.params.caseId, formType, software, destinations, fields, fieldCount:destinations.length, count:destinations.length });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

app.get('/api/cases/:caseId/exceptions', (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const statuses=readJSON(path.join(cd,'section_statuses.json'),{});
    const exOutputs=readJSON(path.join(cd,'outputs.json'),{});
    const coreSec=CORE_SECTIONS[getCaseFormConfig(cd).formType]||[];
    const titleMap=Object.fromEntries(coreSec.map(s=>[s.id,s.title]));
    const exMap={};
    Object.entries(statuses).forEach(([id,v])=>{ if(v?.status==='error'||v?.status==='copied') exMap[id]={status:v.status,notes:v.notes||null,updatedAt:v.updatedAt}; });
    Object.entries(exOutputs).forEach(([id,v])=>{ if(id==='updatedAt'||typeof v!=='object'||!v) return; if(v?.sectionStatus==='error'||v?.sectionStatus==='copied') { if(!exMap[id]) exMap[id]={status:v.sectionStatus,notes:v.statusNote||null,updatedAt:v.updatedAt||null}; } });
    const exceptions=Object.entries(exMap).map(([id,v])=>({ fieldId:id, title:titleMap[id]||id, status:v.status, sectionStatus:v.status, statusNote:v.notes||null, notes:v.notes||null, hasText:Boolean(exOutputs[id]?.text), updatedAt:v.updatedAt }));
    res.json({ ok:true, caseId:req.params.caseId, exceptions, count:exceptions.length });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});
app.post('/api/cases/:caseId/sections/:fieldId/insert', async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const fieldId=trimText(req.params.fieldId,80);
    const outputs=readJSON(path.join(cd,'outputs.json'),{});
    const text=trimText(req.body?.text,16000)||outputs[fieldId]?.text||'';
    if (!text) return res.status(400).json({ ok:false, error:'No text to insert for field: '+fieldId });
    const { formType }=getCaseFormConfig(cd);
    const dest=getDestination(formType,fieldId);
    const secFile=path.join(cd,'section_statuses.json'), statuses=readJSON(secFile,{});
    statuses[fieldId]={ ...(statuses[fieldId]||{}), status:'inserted', insertedAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
    writeJSON(secFile,statuses);
    res.json({ ok:true, inserted:true, fieldId, text, charCount:text.length, status:'inserted', sectionStatus:'inserted',
      destination:dest||null, targetSoftware:getTargetSoftware(formType,fieldId), fallback:getFallbackStrategy(formType,fieldId) });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

<<<<<<< HEAD
app.post('/api/cases/:caseId/generate-comp-commentary', ensureAI, async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const ctx = await loadCaseContext(req.params.caseId);
    if (!ctx) return res.status(404).json({ ok:false, error:'Case not found' });
    const { formType, facts, assignmentMeta } = ctx;
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType,'POST /api/cases/:caseId/generate-comp-commentary',log);
      return res.status(400).json({ ok:false, supported:false, formType, scope:'deferred' });
    }
    if (formType!=='1004') return res.status(400).json({ ok:false, error:'Comp commentary is only available for 1004 form type', formType });
    const comps=asArray(req.body?.comps||facts?.comps||[]);
    if (!comps.length) return res.status(400).json({ ok:false, error:'No comparables provided' });
    const results=[], errors=[];
    for (let i=0;i<comps.length;i++) {
      const comp=comps[i], compLabel='Comp '+(i+1);
      try {
        const compFacts={ ...facts, currentComp:comp, compIndex:i+1, compLabel };
        const { text } = await generateSection({ formType, fieldId:'comp_commentary', facts:compFacts, assignmentMeta });
        results.push({ compIndex:i+1, compLabel, text, address:comp?.address||null });
      } catch (e) { errors.push({ compIndex:i+1, compLabel, error:e.message }); }
    }
    if (results.length) {
      const outFile=path.join(cd,'outputs.json'), existing=readJSON(outFile,{});
      existing.comp_commentary={ comps:results, generatedAt:new Date().toISOString() };
      writeJSON(outFile,existing);
    }
    const compFocus=trimText(req.body?.compFocus,40)||'all';
    const combinedText=results.map(r=>r.compLabel+': '+r.text).join('\n\n');
    if (results.length) {
      const outFile2=path.join(cd,'outputs.json'), existing2=readJSON(outFile2,{});
      existing2.sca_summary={ text:combinedText, comps:results, generatedAt:new Date().toISOString() };
      writeJSON(outFile2,existing2);
    }
    const totalExamples=results.reduce((a,r)=>a+(r.examplesUsed||0),0);
    res.json({ ok:true, fieldId:'sca_summary', text:combinedText, sectionStatus:'drafted', results, errors, compsAttempted:comps.length, compsUsed:results.length, compFocus, examplesUsed:totalExamples });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

=======
>>>>>>> 4e8c1fb (Phase A: modularize workflow/generation routes and expand smoke coverage)
app.post('/api/cases/:caseId/insert-all', async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const { formType }=getCaseFormConfig(cd);
    const outputs=readJSON(path.join(cd,'outputs.json'),{});
    const secFile=path.join(cd,'section_statuses.json'), statuses=readJSON(secFile,{});
    const coreSections=CORE_SECTIONS[formType]||[];
    const inserted=[], skipped=[], errors=[];
    // Only 'approved' counts as "ready to insert".
    // Sections already 'inserted' or 'verified' are done — they do not satisfy the guard.
    const hasApproved = coreSections.some(sec => outputs[sec.id]?.sectionStatus === 'approved');
    if (!hasApproved) return res.status(400).json({ ok: false, error: 'No approved sections to insert' });
    const APPR_ST = ['approved', 'inserted', 'verified'];
    for (const section of coreSections) {
      const sid=section.id, text=outputs[sid]?.text||'';
      if (!text) { skipped.push({ fieldId:sid, reason:'no output' }); continue; }
      const currentStatus=statuses[sid]?.status||'not_started';
      if (['inserted','verified'].includes(currentStatus)) { skipped.push({ fieldId:sid, reason:'already inserted' }); continue; }
      try {
        statuses[sid]={ ...(statuses[sid]||{}), status:'inserted', insertedAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
        if (outputs[sid]) { outputs[sid].sectionStatus='inserted'; outputs[sid].approved=false; }
        inserted.push({ fieldId:sid, title:section.title, charCount:text.length });
      } catch (e) { errors.push({ fieldId:sid, error:e.message }); }
    }
    writeJSON(secFile,statuses);
    writeJSON(path.join(cd,'outputs.json'),outputs);
    const meta=readJSON(path.join(cd,'meta.json')); meta.updatedAt=new Date().toISOString();
    if (inserted.length===coreSections.length) meta.pipelineStage='inserting';
    writeJSON(path.join(cd,'meta.json'),meta);
    res.json({ ok:true, inserted:inserted.length, insertedSections:inserted, skipped, errors, totalInserted:inserted.length, pipelineStage:meta.pipelineStage||'inserting' });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});
<<<<<<< HEAD
app.post('/api/cases/:caseId/generate-all', ensureAI, async (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const ctx = await loadCaseContext(req.params.caseId);
    if (!ctx) return res.status(404).json({ ok:false, error:'Case not found' });
    const { formType, formConfig, facts, assignmentMeta, locationContext } = ctx;
    if (isDeferredForm(formType)) {
      logDeferredAccess(formType,'POST /api/cases/:caseId/generate-all',log);
      return res.status(400).json({ ok:false, supported:false, formType, scope:'deferred' });
    }
    const allFields=formConfig.workflowFields||CORE_SECTIONS[formType]||[];
    if (!allFields.length) return res.status(400).json({ ok:false, error:'No fields configured for form type: '+formType });
    const { results, errors } = await generateSections({ fields: allFields, formType, facts, assignmentMeta, locationContext });
    saveOutputsWithHistory(cd, results);
    updateSectionStatuses(cd, results, errors);
    const statuses = {};
    for (const sid of Object.keys(results)) statuses[sid] = 'drafted';
    for (const sid of Object.keys(errors)) statuses[sid] = 'error';
    const meta=readJSON(path.join(cd,'meta.json')); meta.updatedAt=new Date().toISOString(); meta.pipelineStage='generating';
    writeJSON(path.join(cd,'meta.json'),meta);
    res.json({ ok:true, results, errors, statuses, formType, fieldsAttempted:allFields.length });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

=======
>>>>>>> 4e8c1fb (Phase A: modularize workflow/generation routes and expand smoke coverage)
app.patch('/api/cases/:caseId/outputs/:fieldId', (req, res) => {
  try {
    const cd=req.caseDir;
    if (!fs.existsSync(cd)) return res.status(404).json({ ok:false, error:'Case not found' });
    const fieldId=trimText(req.params.fieldId,80);
    const text=trimText(req.body?.text,16000);
    if (text===null||text===undefined) return res.status(400).json({ ok:false, error:'text is required' });
    const outFile=path.join(cd,'outputs.json'), outputs=readJSON(outFile,{});
    const histFile=path.join(cd,'history.json'), history=readJSON(histFile,{});
    if (outputs[fieldId]?.text) {
      if (!history[fieldId]) history[fieldId]=[];
      history[fieldId].unshift({ text:outputs[fieldId].text, title:outputs[fieldId].title, savedAt:new Date().toISOString() });
      history[fieldId]=history[fieldId].slice(0,3);
      writeJSON(histFile,history);
    }
    outputs[fieldId]={ ...(outputs[fieldId]||{}), text, updatedAt:new Date().toISOString() };
    writeJSON(outFile,outputs);
    const meta=readJSON(path.join(cd,'meta.json')); meta.updatedAt=new Date().toISOString();
    writeJSON(path.join(cd,'meta.json'),meta);
    res.json({ ok:true, fieldId, charCount:text.length });
  } catch (err) { res.status(500).json({ ok:false, error:err.message }); }
});

// ── Server startup ────────────────────────────────────────────────────────────
const server=app.listen(PORT, () => {
  log.info('startup:listening', { port: PORT, model: MODEL, casesDir: CASES_DIR, activeForms: ACTIVE_FORMS });
  if (DEFERRED_FORMS.length) log.info('startup:deferred-forms', { forms: DEFERRED_FORMS });
  try { initFileLogger(); setFileLogWriter(writeLogEntry); } catch (e) { log.warn('startup:file-logger', { error: e.message }); }

  // Phase 10: Initialize audit logger with DB accessor
  try { initAuditLogger(getDb); } catch (e) { log.warn('startup:audit-logger', { error: e.message }); }

  // Phase 10: Emit system startup event
  try { emitSystemEvent('system.startup', 'CACC Writer server started', { port: PORT, model: MODEL, activeForms: ACTIVE_FORMS }); } catch (e) { log.warn('startup:audit-event', { error: e.message }); }

  // Phase 10: Run transient cleanup on startup (expired cache, etc.)
  try { runTransientCleanup(); } catch (e) { log.warn('startup:cleanup', { error: e.message }); }
});

server.on('error', (err) => {
  if (err.code==='EADDRINUSE') {
    log.error('startup:port-in-use', { port: PORT });
  } else {
    log.error('startup:server-error', { error: err.message });
  }
  process.exit(1);
});

export default app;
