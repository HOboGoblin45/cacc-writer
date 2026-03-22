/**
 * cacc-writer-server.js
 * ----------------------
 * Server entrypoint: environment setup, middleware, static assets,
 * router mounting, and process startup only.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import './server/utils/patchExpressAsync.js';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
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
import { requireAuth } from './server/middleware/authMiddleware.js';

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
import inspectionRouter from './server/api/inspectionRoutes.js';
import businessRouter from './server/api/businessRoutes.js';
import exportRouter from './server/api/exportRoutes.js';
import securityRouter from './server/api/securityRoutes.js';
import valuationRouter from './server/api/valuationRoutes.js';
import contradictionLifecycleRouter from './server/api/contradictionLifecycleRoutes.js';
import sectionGovernanceRouter from './server/api/sectionGovernanceRoutes.js';
import dataPipelineRouter from './server/api/dataPipelineRoutes.js';
import intakeRouter from './server/api/intakeRoutes.js';
import compsRouter from './server/api/compsRoutes.js';
import gmailRouter from './server/api/gmailRoutes.js';
import sseRouter from './server/api/sseRoutes.js';
import authRouter from './server/auth/authRoutes.js';
import billingRouter from './server/billing/billingRoutes.js';
import adminRouter from './server/api/adminRoutes.js';
import batchRouter from './server/api/batchRoutes.js';
import templateRouter from './server/api/templateRoutes.js';
import { ensureTemplateSchema } from './server/templates/reportTemplates.js';
import pipelineRouter from './server/api/pipelineRoutes.js';
import amcRouter from './server/api/amcRoutes.js';
import { ensureAmcSchema } from './server/integrations/amcConnector.js';
import { ensureAdjustmentLearnerSchema } from './server/intelligence/adjustmentLearner.js';
import revisionRouter from './server/api/revisionRoutes.js';
import { ensureRevisionSchema } from './server/revisions/revisionTracker.js';
import analyticsRouter from './server/api/analyticsRoutes.js';
import notificationRouter from './server/api/notificationRoutes.js';
import { ensureNotificationSchema } from './server/notifications/notificationService.js';
import schedulingRouter from './server/api/schedulingRoutes.js';
import { ensureSchedulingSchema } from './server/scheduling/inspectionScheduler.js';
import portalRouter from './server/api/portalRoutes.js';
import { ensurePortalSchema } from './server/portal/clientPortal.js';
import complianceRouter from './server/api/complianceRoutes.js';
import { ensureComplianceSchema } from './server/compliance/workfileCompliance.js';
import { ensurePhotoSchema } from './server/photos/photoManager.js';
import valuationEngineRouter from './server/api/valuationEngineRoutes.js';
import publicApiRouter, { ensureApiKeySchema } from './server/api/publicApiRoutes.js';
import collaborationRouter from './server/api/collaborationRoutes.js';
import { ensureCollabSchema } from './server/realtime/collaborationService.js';
import dataEnrichRouter from './server/api/dataRoutes.js';
import mobileRouter, { ensureMobileSchema } from './server/mobile/mobileApiRoutes.js';
import businessIntelRouter from './server/api/businessIntelRoutes.js';
import { ensureMarketTrendSchema } from './server/intelligence/marketTrendEngine.js';
import aiRouter from './server/api/aiRoutes.js';
import aiAdvancedRouter from './server/api/aiAdvancedRoutes.js';
import automationRouter from './server/api/automationRoutes.js';
import { ensureAutomationSchema } from './server/automation/workflowAutomation.js';
import trainingRouter from './server/api/trainingRoutes.js';
import platformAIRouter from './server/api/platformAIRoutes.js';
import calendarRouter from './server/api/calendarRoutes.js';
import docGenRouter from './server/api/documentGenerationRoutes.js';
import voiceRouter from './server/api/voiceRoutes.js';
import webhookRouter from './server/api/webhookRoutes.js';
import intelAdvancedRouter from './server/api/intelligenceAdvancedRoutes.js';
import ratingRouter from './server/api/ratingRoutes.js';
import ucdpRouter from './server/api/ucdpRoutes.js';
import { ensureUcdpSchema } from './server/integrations/ucdpSubmission.js';
import marketplaceRouter from './server/api/marketplaceRoutes.js';
import { ensureMarketplaceSchema } from './server/marketplace/templateMarketplace.js';
import growthRouter from './server/api/growthRoutes.js';
import { ensureReferralSchema } from './server/growth/referralSystem.js';
import educationRouter from './server/api/educationRoutes.js';
import { ensureLearningSchema } from './server/education/learningCenter.js';
import { ensureSecurityAuditSchema, securityAuditMiddleware } from './server/security/auditLog.js';
import securityAdvRouter from './server/api/securityAdvancedRoutes.js';
import mlsRouter from './server/api/mlsRoutes.js';
import { ensureMlsSchema } from './server/integrations/mlsConnector.js';
import copilotRouter from './server/api/copilotRoutes.js';
import signatureRouter from './server/api/signatureRoutes.js';
import { ensureSignatureSchema } from './server/integrations/eSignature.js';
import complianceAdvRouter from './server/api/complianceAdvancedRoutes.js';
import forecastRouter from './server/api/forecastRoutes.js';
import hazardRouter from './server/api/hazardRoutes.js';
import dataAdvRouter from './server/api/dataAdvancedRoutes.js';
import gridRouter from './server/api/gridRoutes.js';
import trainingAdvRouter from './server/api/trainingAdvancedRoutes.js';
import { ensureWebhookSchema } from './server/integrations/webhookNotifier.js';
import { ensureWhitelabelSchema } from './server/whitelabel/whitelabelService.js';
import deliveryRouter from './server/api/deliveryRoutes.js';
import { ensureDeliverySchema } from './server/integrations/emailDelivery.js';
import invoiceRouter from './server/api/invoiceRoutes.js';
import demoRouter from './server/api/demoRoutes.js';
import { ensureInvoiceSchema } from './server/billing/invoiceGenerator.js';
import { ensureAuthSchema } from './server/auth/authService.js';

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
app.use(cors({
  origin: ['http://localhost:5178', 'http://127.0.0.1:5178', 'https://appraisal-agent.com', 'https://www.appraisal-agent.com'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Api-Key', 'Authorization'],
}));

// Rate limit only the AI generation endpoints to prevent runaway API costs.
// Cases/CRUD endpoints are not limited — this is a single-user local tool.
const genLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  message: { ok: false, error: 'Rate limit exceeded' },
  skip: (req) => req.method === 'GET', // Only limit write/generate operations
});
app.use('/api/generate', genLimiter);

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

app.get('/', (_q, r) => r.sendFile(path.join(__dirname, 'landing.html')));
app.get('/app', (_q, r) => r.sendFile(path.join(__dirname, 'index.html')));
app.get('/workspace', (_q, r) => r.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (_q, r) => r.sendFile(path.join(__dirname, 'index.html')));
app.get('/landing', (_q, r) => r.sendFile(path.join(__dirname, 'landing.html')));
app.get('/dashboard', (_q, r) => r.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/admin', (_q, r) => r.sendFile(path.join(__dirname, 'admin.html')));
app.get('/case', (_q, r) => r.sendFile(path.join(__dirname, 'frontend', 'caseworkspace', 'code.html')));
app.get('/case/:id', (_q, r) => r.sendFile(path.join(__dirname, 'frontend', 'caseworkspace', 'code.html')));
app.get('/settings', (_q, r) => r.sendFile(path.join(__dirname, 'frontend', 'settings', 'code.html')));
app.get('/analytics', (_q, r) => r.sendFile(path.join(__dirname, 'frontend', 'analytics', 'code.html')));
app.get('/login', (_q, r) => r.sendFile(path.join(__dirname, 'login.html')));
app.get('/login.html', (_q, r) => r.sendFile(path.join(__dirname, 'login.html')));
app.get('/app.js', (_q, r) => r.sendFile(path.join(__dirname, 'app.js')));
app.get('/workspace.js', (_q, r) => r.sendFile(path.join(__dirname, 'workspace.js')));
app.get('/styles.css', (_q, r) => r.sendFile(path.join(__dirname, 'styles.css')));
app.get('/phase8.css', (_q, r) => r.sendFile(path.join(__dirname, 'phase8.css')));
app.get('/dataPipeline.js', (_q, r) => r.sendFile(path.join(__dirname, 'dataPipeline.js')));
app.get('/favicon.ico', (_q, r) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0b1020"/><text x="16" y="23" font-family="Arial" font-size="20" font-weight="bold" fill="#d7b35a" text-anchor="middle">C</text></svg>';
  r.setHeader('Content-Type', 'image/svg+xml');
  r.setHeader('Cache-Control', 'public, max-age=86400');
  r.send(svg);
});

app.use(requireAuth);

// Auth schema + routes (before other routes)
try { ensureAuthSchema(); } catch (e) { console.warn('Auth schema init:', e.message); }
try { ensureTemplateSchema(); } catch (e) { console.warn('Template schema init:', e.message); }
try { ensureAmcSchema(); } catch (e) { console.warn('AMC schema init:', e.message); }
try { ensureAdjustmentLearnerSchema(); } catch (e) { console.warn('Adj learner schema init:', e.message); }
try { ensureRevisionSchema(); } catch (e) { console.warn('Revision schema init:', e.message); }
try { ensureNotificationSchema(); } catch (e) { console.warn('Notification schema init:', e.message); }
try { ensureSchedulingSchema(); } catch (e) { console.warn('Scheduling schema init:', e.message); }
try { ensurePortalSchema(); } catch (e) { console.warn('Portal schema init:', e.message); }
try { ensureComplianceSchema(); } catch (e) { console.warn('Compliance schema init:', e.message); }
try { ensurePhotoSchema(); } catch (e) { console.warn('Photo schema init:', e.message); }
try { ensureApiKeySchema(); } catch (e) { console.warn('API key schema init:', e.message); }
try { ensureCollabSchema(); } catch (e) { console.warn('Collab schema init:', e.message); }
try { ensureMobileSchema(); } catch (e) { console.warn('Mobile schema init:', e.message); }
try { ensureMarketTrendSchema(); } catch (e) { console.warn('Market trend schema init:', e.message); }
try { ensureAutomationSchema(); } catch (e) { console.warn('Automation schema init:', e.message); }
try { ensureWebhookSchema(); } catch (e) { console.warn('Webhook schema init:', e.message); }
try { ensureWhitelabelSchema(); } catch (e) { console.warn('Whitelabel schema init:', e.message); }
try { ensureUcdpSchema(); } catch (e) { console.warn('UCDP schema init:', e.message); }
try { ensureMarketplaceSchema(); } catch (e) { console.warn('Marketplace schema init:', e.message); }
try { ensureReferralSchema(); } catch (e) { console.warn('Referral schema init:', e.message); }
try { ensureLearningSchema(); } catch (e) { console.warn('Learning schema init:', e.message); }
try { ensureSecurityAuditSchema(); } catch (e) { console.warn('Security audit schema init:', e.message); }
try { ensureMlsSchema(); } catch (e) { console.warn('MLS schema init:', e.message); }
try { ensureSignatureSchema(); } catch (e) { console.warn('Signature schema init:', e.message); }
try { ensureDeliverySchema(); } catch (e) { console.warn('Delivery schema init:', e.message); }
try { ensureInvoiceSchema(); } catch (e) { console.warn('Invoice schema init:', e.message); }
app.use('/api', authRouter);
app.use('/api', billingRouter);
app.use('/api', adminRouter);
app.use('/api', batchRouter);
app.use('/api', templateRouter);
app.use('/api', pipelineRouter);
app.use('/api', amcRouter);
app.use('/api', revisionRouter);
app.use('/api', analyticsRouter);
app.use('/api', notificationRouter);
app.use('/api', schedulingRouter);
app.use('/api', portalRouter);
app.use('/api', complianceRouter);
app.use('/api', valuationEngineRouter);
app.use('/api', publicApiRouter);
app.use('/api', collaborationRouter);
app.use('/api', dataEnrichRouter);
app.use('/api', mobileRouter);
app.use('/api', businessIntelRouter);
app.use('/api', deliveryRouter);
app.use('/api', aiRouter);
app.use('/api', aiAdvancedRouter);
app.use('/api', automationRouter);
app.use('/api', trainingRouter);
app.use('/api', platformAIRouter);
app.use('/api', calendarRouter);
app.use('/api', docGenRouter);
app.use('/api', voiceRouter);
app.use('/api', webhookRouter);
app.use('/api', intelAdvancedRouter);
app.use('/api', ratingRouter);
app.use('/api', ucdpRouter);
app.use('/api', marketplaceRouter);
app.use('/api', growthRouter);
app.use('/api', educationRouter);
app.use('/api', securityAdvRouter);
app.use('/api', mlsRouter);
app.use('/api', copilotRouter);
app.use('/api', signatureRouter);
app.use('/api', complianceAdvRouter);
app.use('/api', forecastRouter);
app.use('/api', hazardRouter);
app.use('/api', dataAdvRouter);
app.use('/api', gridRouter);
app.use('/api', trainingAdvRouter);
app.use('/api', invoiceRouter);
app.use('/api', healthRouter);
app.use('/api', exportRouter);
app.use('/api', sseRouter);
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
app.use('/api', inspectionRouter);
app.use('/api', businessRouter);
app.use('/api', securityRouter);
app.use('/api', valuationRouter);
app.use('/api', contradictionLifecycleRouter);
app.use('/api', sectionGovernanceRouter);
app.use('/api', dataPipelineRouter);
app.use('/api', intakeRouter);
app.use('/api', compsRouter);
app.use('/api', gmailRouter);
app.use('/api', demoRouter);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status = Number(err?.status || err?.statusCode) || 500;
  const message = String(err?.message || 'Request failed');

  log.error('request:error', {
    method: req.method,
    path: req.path,
    status,
    error: message,
  });

  const payload = {
    ok: false,
    error: status >= 500 ? 'Internal server error' : message,
  };

  if (err?.code) {
    payload.code = String(err.code);
  }

  if (status >= 500 && process.env.NODE_ENV !== 'production') {
    payload.detail = message;
  }

  res.status(status).json(payload);
});

const server = app.listen(PORT, () => {
  console.log('Appraisal Agent server running on port ' + PORT);
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
    emitSystemEvent('system.startup', 'Appraisal Agent server started', {
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

