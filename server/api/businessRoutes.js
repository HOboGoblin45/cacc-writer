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
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/business/quotes', (req, res) => {
  try {
    const quotes = listQuotes(req.query);
    res.json({ ok: true, quotes });
  } catch (err) {
    log.error('api:quote-list', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/business/quotes/:quoteId', (req, res) => {
  try {
    const quote = getQuote(req.params.quoteId);
    if (!quote) return res.status(404).json({ ok: false, error: 'Quote not found' });
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-get', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/business/quotes/:quoteId', (req, res) => {
  try {
    const body = parsePayload(updateQuoteSchema, req.body || {}, res);
    if (!body) return;
    const quote = updateQuote(req.params.quoteId, body);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-update', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/:quoteId/send', (req, res) => {
  try {
    const quote = sendQuote(req.params.quoteId);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-send', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/:quoteId/accept', (req, res) => {
  try {
    const quote = acceptQuote(req.params.quoteId);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-accept', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/:quoteId/decline', (req, res) => {
  try {
    const quote = declineQuote(req.params.quoteId, req.body.reason);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-decline', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/:quoteId/expire', (req, res) => {
  try {
    const quote = expireQuote(req.params.quoteId);
    res.json({ ok: true, quote });
  } catch (err) {
    log.error('api:quote-expire', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/quotes/:quoteId/convert', (req, res) => {
  try {
    const body = parsePayload(convertQuoteSchema, req.body || {}, res);
    if (!body) return;
    const result = convertQuoteToCaseAndEngagement(req.params.quoteId, body.caseId);
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

router.get('/business/engagements/upcoming', (req, res) => {
  try {
    const days = parseInt(req.query.days || '7', 10);
    const engagements = getEngagementsByDueDate(days);
    res.json({ ok: true, engagements });
  } catch (err) {
    log.error('api:engagement-upcoming', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/business/engagements/overdue', (_req, res) => {
  try {
    const engagements = getOverdueEngagements();
    res.json({ ok: true, engagements });
  } catch (err) {
    log.error('api:engagement-overdue', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/business/engagements', (req, res) => {
  try {
    const engagements = listEngagements(req.query);
    res.json({ ok: true, engagements });
  } catch (err) {
    log.error('api:engagement-list', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/business/engagements/:engId', (req, res) => {
  try {
    const engagement = getEngagement(req.params.engId);
    if (!engagement) return res.status(404).json({ ok: false, error: 'Engagement not found' });
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-get', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/business/engagements/:engId', (req, res) => {
  try {
    const body = parsePayload(updateEngagementSchema, req.body || {}, res);
    if (!body) return;
    const engagement = updateEngagement(req.params.engId, body);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-update', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/accept', (req, res) => {
  try {
    const engagement = acceptEngagement(req.params.engId);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-accept', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/hold', (req, res) => {
  try {
    const engagement = putOnHold(req.params.engId, req.body.reason);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-hold', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/resume', (req, res) => {
  try {
    const engagement = resumeEngagement(req.params.engId);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-resume', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/complete', (req, res) => {
  try {
    const engagement = completeEngagement(req.params.engId);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-complete', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/cancel', (req, res) => {
  try {
    const engagement = cancelEngagement(req.params.engId, req.body.reason);
    res.json({ ok: true, engagement });
  } catch (err) {
    log.error('api:engagement-cancel', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/engagements/:engId/fee-adjustment', (req, res) => {
  try {
    const body = parsePayload(feeAdjustmentSchema, req.body || {}, res);
    if (!body) return;
    const engagement = addFeeAdjustment(req.params.engId, body);
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/business/invoices/overdue', (_req, res) => {
  try {
    const invoices = getOverdueInvoices();
    res.json({ ok: true, invoices });
  } catch (err) {
    log.error('api:invoice-overdue', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/business/invoices', (req, res) => {
  try {
    const invoices = listInvoices(req.query);
    res.json({ ok: true, invoices });
  } catch (err) {
    log.error('api:invoice-list', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/business/invoices/:invoiceId', (req, res) => {
  try {
    const invoice = getInvoice(req.params.invoiceId);
    if (!invoice) return res.status(404).json({ ok: false, error: 'Invoice not found' });
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-get', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/business/invoices/:invoiceId', (req, res) => {
  try {
    const body = parsePayload(updateInvoiceSchema, req.body || {}, res);
    if (!body) return;
    const invoice = updateInvoice(req.params.invoiceId, body);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-update', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/invoices/:invoiceId/issue', (req, res) => {
  try {
    const invoice = issueInvoice(req.params.invoiceId);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-issue', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/invoices/:invoiceId/payment', (req, res) => {
  try {
    const body = parsePayload(recordPaymentSchema, req.body || {}, res);
    if (!body) return;
    const invoice = recordPayment(req.params.invoiceId, body);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-payment', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/invoices/:invoiceId/void', (req, res) => {
  try {
    const invoice = voidInvoice(req.params.invoiceId, req.body.reason);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-void', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/invoices/:invoiceId/reminder', (req, res) => {
  try {
    const invoice = sendReminder(req.params.invoiceId);
    res.json({ ok: true, invoice });
  } catch (err) {
    log.error('api:invoice-reminder', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/invoices/from-engagement/:engId', (req, res) => {
  try {
    const invoice = createInvoiceFromEngagement(req.params.engId);
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
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/business/pipeline/workload', (_req, res) => {
  try {
    const workload = getAppraisersWorkload();
    res.json({ ok: true, workload });
  } catch (err) {
    log.error('api:pipeline-workload', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/business/pipeline', (req, res) => {
  try {
    const entries = listPipeline(req.query);
    res.json({ ok: true, entries });
  } catch (err) {
    log.error('api:pipeline-list', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
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

router.get('/business/pipeline/:entryId', (req, res) => {
  try {
    const entry = getPipelineEntry(req.params.entryId);
    if (!entry) return res.status(404).json({ ok: false, error: 'Pipeline entry not found' });
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-get', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/business/pipeline/:entryId', (req, res) => {
  try {
    const body = parsePayload(updatePipelineSchema, req.body || {}, res);
    if (!body) return;
    const entry = updatePipelineEntry(req.params.entryId, body);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-update', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/pipeline/:entryId/advance', (req, res) => {
  try {
    const body = parsePayload(advanceStageSchema, req.body || {}, res);
    if (!body) return;
    const entry = advanceStage(req.params.entryId, body.stage);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-advance', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/pipeline/:entryId/priority', (req, res) => {
  try {
    const body = parsePayload(setPrioritySchema, req.body || {}, res);
    if (!body) return;
    const entry = setPriority(req.params.entryId, body.priority);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-priority', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/pipeline/:entryId/tags', (req, res) => {
  try {
    const body = parsePayload(addTagSchema, req.body || {}, res);
    if (!body) return;
    const entry = addTag(req.params.entryId, body.tag);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-add-tag', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/business/pipeline/:entryId/tags/:tag', (req, res) => {
  try {
    const entry = removeTag(req.params.entryId, req.params.tag);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-remove-tag', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/business/pipeline/sync/:caseId', (req, res) => {
  try {
    const entry = syncPipelineFromCase(req.params.caseId);
    res.json({ ok: true, entry });
  } catch (err) {
    log.error('api:pipeline-sync', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
