/**
 * cacc-writer-server.js
 * ----------------------
 * Server entrypoint: environment setup, middleware, static assets,
 * router mounting, and process startup only.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { ACTIVE_FORMS, DEFERRED_FORMS } from './server/config/productionScope.js';
import { CASES_DIR } from './server/utils/caseUtils.js';
import { initFileLogger, writeLogEntry } from './server/fileLogger.js';
import log, { setFileLogWriter } from './server/logger.js';
import { runStartupChecks } from './server/config/startupChecks.js';
import { runTransientCleanup } from './server/operations/retentionManager.js';
import { initAuditLogger, emitSystemEvent } from './server/operations/auditLogger.js';
import { getDb } from './server/db/database.js';
import { MODEL } from './server/openaiClient.js';

import healthRouter from './server/api/healthRoutes.js';
import casesRouter from './server/api/casesRoutes.js';
import caseCompatRouter from './server/api/caseCompatRoutes.js';
import generationRouter from './server/api/generationRoutes.js';
import workflowRouter from './server/api/workflowRoutes.js';
import memoryRouter from './server/api/memoryRoutes.js';
import agentsRouter from './server/api/agentsRoutes.js';
import intelligenceRouter from './server/api/intelligenceRoutes.js';
import documentRouter from './server/api/documentRoutes.js';
import phase6MemoryRouter from './server/api/phase6Routes.js';
import qcRouter from './server/api/qcRoutes.js';
import insertionRouter from './server/api/insertionRoutes.js';
import operationsRouter from './server/api/operationsRoutes.js';
import queueRouter from './server/api/queueRoutes.js';
import learningRouter from './server/api/learningRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 5178;
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();

runStartupChecks({
  port: PORT,
  casesDir: CASES_DIR,
  openAiApiKey: OPENAI_API_KEY,
  logger: console,
});

const app = express();
app.use(express.json({ limit: '10mb' }));

log.info('server:start', { model: MODEL, port: PORT });

app.use((req, res, next) => {
  const start = Date.now();
  const skip = ['/favicon.ico', '/app.js', '/phase8.css', '/index.html', '/'].includes(req.path);
  res.on('finish', () => {
    if (!skip) {
      log.request(req.method, req.path, res.statusCode, Date.now() - start);
    }
  });
  next();
});

app.get('/', (_q, r) => r.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (_q, r) => r.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js', (_q, r) => r.sendFile(path.join(__dirname, 'app.js')));
app.get('/workspace.js', (_q, r) => r.sendFile(path.join(__dirname, 'workspace.js')));
app.get('/styles.css', (_q, r) => r.sendFile(path.join(__dirname, 'styles.css')));
app.get('/phase8.css', (_q, r) => r.sendFile(path.join(__dirname, 'phase8.css')));
app.get('/favicon.ico', (_q, r) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0b1020"/><text x="16" y="23" font-family="Arial" font-size="20" font-weight="bold" fill="#d7b35a" text-anchor="middle">C</text></svg>';
  r.setHeader('Content-Type', 'image/svg+xml');
  r.setHeader('Cache-Control', 'public, max-age=86400');
  r.send(svg);
});

app.use('/api', healthRouter);
app.use('/api/cases', casesRouter);
app.use('/api/cases', caseCompatRouter);
app.use('/api', generationRouter);
app.use('/api', workflowRouter);
app.use('/api', memoryRouter);
app.use('/api', agentsRouter);
app.use('/api', intelligenceRouter);
app.use('/api', documentRouter);
app.use('/api/memory', phase6MemoryRouter);
app.use('/api', qcRouter);
app.use('/api', insertionRouter);
app.use('/api', operationsRouter);
app.use('/api', queueRouter);
app.use('/api', learningRouter);

const server = app.listen(PORT, () => {
  console.log('CACC Writer server running on port ' + PORT);
  console.log('Model: ' + MODEL);
  console.log('Cases dir: ' + CASES_DIR);
  console.log('Active forms: ' + ACTIVE_FORMS.join(', '));
  if (DEFERRED_FORMS.length) {
    console.log('Deferred forms: ' + DEFERRED_FORMS.join(', '));
  }

  try {
    initFileLogger();
    setFileLogWriter(writeLogEntry);
  } catch (e) {
    console.warn('File logger init failed:', e.message);
  }

  try {
    initAuditLogger(getDb);
  } catch (e) {
    console.warn('Audit logger init failed:', e.message);
  }

  try {
    emitSystemEvent('system.startup', 'CACC Writer server started', {
      port: PORT,
      model: MODEL,
      activeForms: ACTIVE_FORMS,
    });
  } catch {
    // non-fatal
  }

  try {
    runTransientCleanup();
  } catch (e) {
    console.warn('Startup cleanup failed:', e.message);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' is already in use. Kill the existing process and restart.');
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});

export default app;
