/**
 * server/api/businessRoutes.js
 * --------------------------------
 * Phase 12 — Business Operations REST Endpoints
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 *
 * Routes:
 *   POST   /business/quotes                        — create fee quote
 *   GET    /business/quotes                        — list quotes
 *   GET    /business/quotes/summary                — quote summary stats
 *   GET    /business/quotes/:quoteId               — get quote
 *   PUT    /business/quotes/:quoteId               — update quote
 *   POST   /business/quotes/:quoteId/send          — send quote
 *   POST   /business/quotes/:quoteId/accept        — accept quote
 *   POST   /business/quotes/:quoteId/decline       — decline quote
 *   POST   /business/quotes/:quoteId/expire        — expire quote
 *   POST   /business/quotes/:quoteId/convert       — convert to engagement
 *   POST   /business/quotes/calculate-fee          — calculate fee estimate
 *
 *   POST   /business/engagements                   — create engagement
 *   GET    /business/engagements                   — list engagements
 *   GET    /business/engagements/upcoming           — upcoming due dates
 *   GET    /business/engagements/overdue            — overdue engagements
 *   GET    /business/engagements/:engId             — get engagement
 *   PUT    /business/engagements/:engId             — update engagement
 *   POST   /business/engagements/:engId/accept      — accept engagement
 *   POST   /business/engagements/:engId/hold        — put on hold
 *   POST   /business/engagements/:engId/resume      — resume from hold
 *   POST   /business/engagements/:engId/complete    — complete engagement
 *   POST   /business/engagements/:engId/cancel      — cancel engagement
 *   POST   /business/engagements/:engId/fee-adjustment — add fee adjustment
 *
 *   POST   /business/invoices                       — create invoice
 *   GET    /business/invoices                       — list invoices
 *   GET    /business/invoices/summary               — invoice summary stats
 *   GET    /business/invoices/overdue               — overdue invoices
 *   GET    /business/invoices/:invoiceId            — get invoice
 *   PUT    /business/invoices/:invoiceId            — update invoice
 *   POST   /business/invoices/:invoiceId/issue      — issue invoice
 *   POST   /business/invoices/:invoiceId/payment    — record payment
 *   POST   /business/invoices/:invoiceId/void       — void invoice
 *   POST   /business/invoices/:invoiceId/reminder   — send reminder
 *   POST   /business/invoices/from-engagement/:engId — create from engagement
 *
 *   GET    /business/pipeline                       — list pipeline
 *   GET    /business/pipeline/summary               — pipeline summary
 *   GET    /business/pipeline/workload              — appraiser workload
 *   POST   /business/pipeline                       — create pipeline entry
 *   GET    /business/pipeline/:entryId              — get pipeline entry
 *   PUT    /business/pipeline/:entryId              — update pipeline entry
 *   POST   /business/pipeline/:entryId/advance      — advance stage
 *   POST   /business/pipeline/:entryId/priority     — set priority
 *   POST   /business/pipeline/:entryId/tags         — add tag
 *   DELETE /business/pipeline/:entryId/tags/:tag    — remove tag
 *   POST   /business/pipeline/sync/:caseId          — sync from case
 */

import { Router } from 'express';
import { z } from 'zod';
import log from '../logger.js';
import { parsePayload } from '../utils/routeUtils.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validateRequest.js';

import {
  createQuote, getQuote, listQuotes, updateQuote,
  sendQuote, acceptQuote, declineQuote, expireQuote,
  convertQuoteToCaseAndEngagement, getQuoteSummary, calculateFee,
} from '../business/quoteService.js';

import {
  createEngagement, getEngagement, listEngagements, updateEngagement,
  acceptEngagement, putOnHold, resumeEngagement, completeEngagement,
  cancelEngagement, addFeeAdjustment, getEngagementsByDueDate, getOverdueEngagements,
} from '../business/engagementService.js';

import {
  createInvoice, getInvoice, listInvoices, updateInvoice,
  issueInvoice, recordPayment, voidInvoice, markOverdue, sendReminder,
  getInvoiceSummary, getOverdueInvoices, createInvoiceFromEngagement,
} from '../business/invoiceService.js';

import {
  createPipelineEntry, getPipelineEntry, listPipeline, updatePipelineEntry,
  advanceStage, setPriority, addTag, removeTag,
  getPipelineSummary, getAppraisersWorkload, syncPipelineFromCase,
} from '../business/pipelineService.js';

import {
  createTenant, getTenant, listTenants, updateTenant,
} from '../business/tenantService.js';

import {
  createFlag, getFlag, listFlags, enableFlag, disableFlag,
} from '../business/featureFlagService.js';

import {
  recordBillingEvent, getBillingHistory, getBillingSummary,
} from '../business/billingService.js';

import { sendErrorResponse } from '../utils/errorResponse.js';
const createQuoteSchema = z.object({
  clientName: z.string().max(200),
  propertyAddress: z.string().max(500).optional(),
  formType: z.string().max(40).optional(),
  propertyType: z.string().max(60).optional(),
  feeAmount: z.number().positive().optional(),
  notes: z.string().max(2000).optional(),
}).passthrough();

const updateQuoteSchema = z.object({}).passthrough();

const calculateFeeSchema = z.object({
  formType: z.string().max(40).optional(),
  propertyType: z.string().max(60).optional(),
  complexity: z.string().max(40).optional(),
}).passthrough();

const convertQuoteSchema = z.object({
  caseId: z.string().max(80).optional(),
}).passthrough();

const createEngagementSchema = z.object({
  caseId: z.string().max(80).optional(),
  quoteId: z.string().max(80).optional(),
  clientName: z.string().max(200).optional(),
  formType: z.string().max(40).optional(),
}).passthrough();

const updateEngagementSchema = z.object({}).passthrough();

const feeAdjustmentSchema = z.object({
  amount: z.number(),
  reason: z.string().max(500).optional(),
}).passthrough();

const createInvoiceSchema = z.object({
  engagementId: z.string().max(80).optional(),
  amount: z.number().positive().optional(),
}).passthrough();

const updateInvoiceSchema = z.object({}).passthrough();

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.string().max(60).optional(),
}).passthrough();

const createPipelineSchema = z.object({
  caseId: z.string().max(80).optional(),
  clientName: z.string().max(200).optional(),
}).passthrough();

const updatePipelineSchema = z.object({}).passthrough();

const advanceStageSchema = z.object({
  stage: z.string().max(60),
}).passthrough();

const setPrioritySchema = z.object({
  priority: z.union([z.string().max(20), z.number()]),
}).passthrough();

const addTagSchema = z.object({
  tag: z.string().max(80),
}).passthrough();

// ── Parameter Schemas ──────────────────────────────────────────────────────────

const quoteIdParamSchema = z.object({
  quoteId: z.string().min(1),
});

const engIdParamSchema = z.object({
  engId: z.string().min(1),
});

const invoiceIdParamSchema = z.object({
  invoiceId: z.string().min(1),
});

const entryIdParamSchema = z.object({
  entryId: z.string().min(1),
});

const tagParamSchema = z.object({
  entryId: z.string().min(1),
  tag: z.string().min(1),
});

const caseIdParamSchema = z.object({
  caseId: z.string().min(1),
});

const tenantIdParamSchema = z.object({
  id: z.string().min(1),
});

const keyParamSchema = z.object({
  key: z.string().min(1),
});

// ── Query Schemas ──────────────────────────────────────────────────────────────

const upcomingDaysQuerySchema = z.object({
  days: z.coerce.number().int().min(1).default(7),
}).passthrough();

const router = Router();

// ── Quotes ──────────────────────────────────────────────────────────────────

router.post('/business/quotes', (req, res) => {
  try {
    const body = parsePayload(createQuoteSchema, req.body || {}, res);
    if (!body) return;
    const quote = createQuote(body);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-create', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/business/quotes/summary', (_req, res) => {
  try {
    const summary = getQuoteSummary();
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('api:quote-summary', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/quotes', (req, res) => {
  try {
    const quotes = listQuotes(req.query);
    res.json({ ok: true, quotes });
  } catch (err) {
    log.error('api:quote-list', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/quotes/:quoteId', validateParams(quoteIdParamSchema), (req, res) => {
  try {
    const quote = getQuote(req.validatedParams.quoteId);
    if (!quote) return res.status(404).json({ ok: false, error: 'Quote not found' });
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-get', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.put('/business/quotes/:quoteId', validateParams(quoteIdParamSchema), validateBody(updateQuoteSchema), (req, res) => {
  try {
    const quote = updateQuote(req.validatedParams.quoteId, req.validated);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-update', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/:quoteId/send', validateParams(quoteIdParamSchema), (req, res) => {
  try {
    const quote = sendQuote(req.validatedParams.quoteId);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-send', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/:quoteId/accept', validateParams(quoteIdParamSchema), (req, res) => {
  try {
    const quote = acceptQuote(req.validatedParams.quoteId);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-accept', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/:quoteId/decline', validateParams(quoteIdParamSchema), validateBody(z.object({ reason: z.string().optional() }).passthrough()), (req, res) => {
  try {
    const quote = declineQuote(req.validatedParams.quoteId, req.validated.reason);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-decline', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/:quoteId/expire', validateParams(quoteIdParamSchema), (req, res) => {
  try {
    const quote = expireQuote(req.validatedParams.quoteId);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-expire', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/:quoteId/convert', validateParams(quoteIdParamSchema), validateBody(convertQuoteSchema), (req, res) => {
  try {
    const result = convertQuoteToCaseAndEngagement(req.validatedParams.quoteId, req.validated.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:quote-convert', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/calculate-fee', (req, res) => {
  try {
    const body = parsePayload(calculateFeeSchema, req.body || {}, res);
    if (!body) return;
    const fee = calculateFee(body);
    res.json({ ok: true, fee });
  } catch (err) {
    log.error('api:quote-calculate', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Engagements ─────────────────────────────────────────────────────────────

router.post('/business/engagements', (req, res) => {
  try {
    const body = parsePayload(createEngagementSchema, req.body || {}, res);
    if (!body) return;
    const engagement = createEngagement(body);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-create', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/business/engagements/upcoming', validateQuery(upcomingDaysQuerySchema), (req, res) => {
  try {
    const engagements = getEngagementsByDueDate(req.validatedQuery.days);
    res.json({ ok: true, engagements });
  } catch (err) {
    log.error('api:engagement-upcoming', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/engagements/overdue', (_req, res) => {
  try {
    const engagements = getOverdueEngagements();
    res.json({ ok: true, engagements });
  } catch (err) {
    log.error('api:engagement-overdue', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/engagements', (req, res) => {
  try {
    const engagements = listEngagements(req.query);
    res.json({ ok: true, engagements });
  } catch (err) {
    log.error('api:engagement-list', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/engagements/:engId', validateParams(engIdParamSchema), (req, res) => {
  try {
    const engagement = getEngagement(req.validatedParams.engId);
    if (!engagement) return res.status(404).json({ ok: false, error: 'Engagement not found' });
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-get', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.put('/business/engagements/:engId', validateParams(engIdParamSchema), validateBody(updateEngagementSchema), (req, res) => {
  try {
    const engagement = updateEngagement(req.validatedParams.engId, req.validated);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-update', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/accept', validateParams(engIdParamSchema), (req, res) => {
  try {
    const engagement = acceptEngagement(req.validatedParams.engId);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-accept', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/hold', validateParams(engIdParamSchema), validateBody(z.object({ reason: z.string().optional() }).passthrough()), (req, res) => {
  try {
    const engagement = putOnHold(req.validatedParams.engId, req.validated.reason);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-hold', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/resume', validateParams(engIdParamSchema), (req, res) => {
  try {
    const engagement = resumeEngagement(req.validatedParams.engId);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-resume', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/complete', validateParams(engIdParamSchema), (req, res) => {
  try {
    const engagement = completeEngagement(req.validatedParams.engId);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-complete', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/cancel', validateParams(engIdParamSchema), validateBody(z.object({ reason: z.string().optional() }).passthrough()), (req, res) => {
  try {
    const engagement = cancelEngagement(req.validatedParams.engId, req.validated.reason);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-cancel', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/fee-adjustment', validateParams(engIdParamSchema), validateBody(feeAdjustmentSchema), (req, res) => {
  try {
    const engagement = addFeeAdjustment(req.validatedParams.engId, req.validated);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-fee-adj', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Invoices ────────────────────────────────────────────────────────────────

router.post('/business/invoices', (req, res) => {
  try {
    const body = parsePayload(createInvoiceSchema, req.body || {}, res);
    if (!body) return;
    const invoice = createInvoice(body);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-create', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/business/invoices/summary', (_req, res) => {
  try {
    const summary = getInvoiceSummary();
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('api:invoice-summary', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/invoices/overdue', (_req, res) => {
  try {
    const invoices = getOverdueInvoices();
    res.json({ ok: true, invoices });
  } catch (err) {
    log.error('api:invoice-overdue', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/invoices', (req, res) => {
  try {
    const invoices = listInvoices(req.query);
    res.json({ ok: true, invoices });
  } catch (err) {
    log.error('api:invoice-list', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/invoices/:invoiceId', validateParams(invoiceIdParamSchema), (req, res) => {
  try {
    const invoice = getInvoice(req.validatedParams.invoiceId);
    if (!invoice) return res.status(404).json({ ok: false, error: 'Invoice not found' });
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-get', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.put('/business/invoices/:invoiceId', validateParams(invoiceIdParamSchema), validateBody(updateInvoiceSchema), (req, res) => {
  try {
    const invoice = updateInvoice(req.validatedParams.invoiceId, req.validated);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-update', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/invoices/:invoiceId/issue', validateParams(invoiceIdParamSchema), (req, res) => {
  try {
    const invoice = issueInvoice(req.validatedParams.invoiceId);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-issue', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/invoices/:invoiceId/payment', validateParams(invoiceIdParamSchema), validateBody(recordPaymentSchema), (req, res) => {
  try {
    const invoice = recordPayment(req.validatedParams.invoiceId, req.validated);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-payment', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/invoices/:invoiceId/void', validateParams(invoiceIdParamSchema), validateBody(z.object({ reason: z.string().optional() }).passthrough()), (req, res) => {
  try {
    const invoice = voidInvoice(req.validatedParams.invoiceId, req.validated.reason);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-void', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/invoices/:invoiceId/reminder', validateParams(invoiceIdParamSchema), (req, res) => {
  try {
    const invoice = sendReminder(req.validatedParams.invoiceId);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-reminder', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/invoices/from-engagement/:engId', validateParams(engIdParamSchema), (req, res) => {
  try {
    const invoice = createInvoiceFromEngagement(req.validatedParams.engId);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-from-engagement', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Pipeline ────────────────────────────────────────────────────────────────

router.get('/business/pipeline/summary', (_req, res) => {
  try {
    const summary = getPipelineSummary();
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('api:pipeline-summary', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/pipeline/workload', (_req, res) => {
  try {
    const workload = getAppraisersWorkload();
    res.json({ ok: true, workload });
  } catch (err) {
    log.error('api:pipeline-workload', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/pipeline', (req, res) => {
  try {
    const entries = listPipeline(req.query);
    res.json({ ok: true, entries });
  } catch (err) {
    log.error('api:pipeline-list', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.post('/business/pipeline', (req, res) => {
  try {
    const body = parsePayload(createPipelineSchema, req.body || {}, res);
    if (!body) return;
    const entry = createPipelineEntry(body);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-create', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/business/pipeline/:entryId', validateParams(entryIdParamSchema), (req, res) => {
  try {
    const entry = getPipelineEntry(req.validatedParams.entryId);
    if (!entry) return res.status(404).json({ ok: false, error: 'Pipeline entry not found' });
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-get', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.put('/business/pipeline/:entryId', validateParams(entryIdParamSchema), validateBody(updatePipelineSchema), (req, res) => {
  try {
    const entry = updatePipelineEntry(req.validatedParams.entryId, req.validated);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-update', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/pipeline/:entryId/advance', validateParams(entryIdParamSchema), validateBody(advanceStageSchema), (req, res) => {
  try {
    const entry = advanceStage(req.validatedParams.entryId, req.validated.stage);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-advance', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/pipeline/:entryId/priority', validateParams(entryIdParamSchema), validateBody(setPrioritySchema), (req, res) => {
  try {
    const entry = setPriority(req.validatedParams.entryId, req.validated.priority);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-priority', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/pipeline/:entryId/tags', validateParams(entryIdParamSchema), validateBody(addTagSchema), (req, res) => {
  try {
    const entry = addTag(req.validatedParams.entryId, req.validated.tag);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-add-tag', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/business/pipeline/:entryId/tags/:tag', validateParams(tagParamSchema), (req, res) => {
  try {
    const entry = removeTag(req.validatedParams.entryId, req.validatedParams.tag);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-remove-tag', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/pipeline/sync/:caseId', validateParams(caseIdParamSchema), (req, res) => {
  try {
    const entry = syncPipelineFromCase(req.validatedParams.caseId);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-sync', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Tenants ──────────────────────────────────────────────────────────────────

router.get('/business/tenants', (req, res) => {
  try {
    const tenants = listTenants(req.query);
    res.json({ ok: true, tenants });
  } catch (err) {
    log.error('api:tenant-list', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.post('/business/tenants', (req, res) => {
  try {
    const result = createTenant(req.body || {});
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:tenant-create', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/business/tenants/:id', validateParams(tenantIdParamSchema), (req, res) => {
  try {
    const tenant = getTenant(req.validatedParams.id);
    if (!tenant) return res.status(404).json({ ok: false, error: 'Tenant not found' });
    res.json({ ok: true, tenant });
  } catch (err) {
    log.error('api:tenant-get', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.put('/business/tenants/:id', validateParams(tenantIdParamSchema), validateBody(z.object({}).passthrough()), (req, res) => {
  try {
    const result = updateTenant(req.validatedParams.id, req.validated);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:tenant-update', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Feature Flags ────────────────────────────────────────────────────────────

router.get('/business/feature-flags', (req, res) => {
  try {
    const flags = listFlags(req.query.tenantId);
    res.json({ ok: true, flags });
  } catch (err) {
    log.error('api:feature-flag-list', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/feature-flags/:key', validateParams(keyParamSchema), (req, res) => {
  try {
    const flag = getFlag(req.validatedParams.key);
    if (!flag) return res.status(404).json({ ok: false, error: 'Flag not found' });
    res.json({ ok: true, flag });
  } catch (err) {
    log.error('api:feature-flag-get', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.post('/business/feature-flags', (req, res) => {
  try {
    const result = createFlag(req.body || {});
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:feature-flag-create', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put('/business/feature-flags/:key/enable', validateParams(keyParamSchema), validateBody(z.object({ tenantId: z.string().optional() }).passthrough()), (req, res) => {
  try {
    const result = enableFlag(req.validatedParams.key, req.validated.tenantId);
    if (result.error) return res.status(404).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:feature-flag-enable', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put('/business/feature-flags/:key/disable', validateParams(keyParamSchema), validateBody(z.object({ tenantId: z.string().optional() }).passthrough()), (req, res) => {
  try {
    const result = disableFlag(req.validatedParams.key, req.validated.tenantId);
    if (result.error) return res.status(404).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:feature-flag-disable', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Billing ──────────────────────────────────────────────────────────────────

router.get('/business/billing/:tenantId', validateParams(z.object({ tenantId: z.string().min(1) })), (req, res) => {
  try {
    const history = getBillingHistory(req.validatedParams.tenantId, req.query);
    res.json({ ok: true, history });
  } catch (err) {
    log.error('api:billing-history', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.get('/business/billing/:tenantId/summary', validateParams(z.object({ tenantId: z.string().min(1) })), validateQuery(z.object({ period: z.string().optional() }).passthrough()), (req, res) => {
  try {
    const summary = getBillingSummary(req.validatedParams.tenantId, req.validatedQuery.period);
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('api:billing-summary', { error: err.message });
    return sendErrorResponse(res, err);
  }
});

router.post('/business/billing/event', validateBody(z.object({}).passthrough()), (req, res) => {
  try {
    const result = recordBillingEvent(req.validated);
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:billing-event', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
