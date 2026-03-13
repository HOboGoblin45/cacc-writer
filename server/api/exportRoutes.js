/**
 * server/api/exportRoutes.js
 * ----------------------------
 * Phase 14 — Export Layer REST Endpoints
 *
 * Mounted at: /api  (in cacc-writer-server.js)
 */

import { Router } from 'express';
import log from '../logger.js';

import { generatePdf, getPdfPageManifest, estimatePageCount } from '../export/pdfExportService.js';
import { generateMismo, getMismoFieldMapping, validateMismoOutput } from '../export/mismoExportService.js';
import {
  createBundle, getBundleContents, getExportJob, listExportJobs,
  cancelExportJob, createDeliveryRecord, getDeliveryRecord, listDeliveries,
  confirmDelivery, getExportSummary, getTemplate, listTemplates,
  createTemplate, updateTemplate,
} from '../export/bundleService.js';

import { z } from 'zod';
import { parsePayload } from '../utils/routeUtils.js';

// ── Schemas ─────────────────────────────────────────────────────────────────

const pdfExportSchema = z.object({
  formType: z.string().max(40).optional(),
  templateId: z.string().max(80).optional(),
  options: z.record(z.unknown()).optional(),
}).passthrough();

const mismoExportSchema = z.object({
  formType: z.string().max(40).optional(),
  version: z.string().max(20).optional(),
}).passthrough();

const bundleSchema = z.object({
  formats: z.array(z.string().max(20)).optional(),
  templateId: z.string().max(80).optional(),
}).passthrough();

const deliverSchema = z.object({
  exportJobId: z.string().min(1).max(80),
  method: z.string().max(40).optional(),
  recipient: z.string().max(200).optional(),
}).passthrough();

const confirmDeliverySchema = z.object({
  method: z.string().max(40).optional(),
}).passthrough();

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  formType: z.string().max(40).optional(),
}).passthrough();

const updateTemplateSchema = z.object({}).passthrough();

const router = Router();

// ── PDF Export ──────────────────────────────────────────────────────────────

router.post('/cases/:caseId/export/pdf', (req, res) => {
  try {
    const body = parsePayload(pdfExportSchema, req.body || {}, res);
    if (!body) return;
    const result = generatePdf(req.params.caseId, body);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:export-pdf', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/cases/:caseId/export/pdf/estimate', (req, res) => {
  try {
    const estimate = estimatePageCount(req.params.caseId);
    res.json({ ok: true, estimate });
  } catch (err) {
    log.error('api:export-pdf-estimate', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── MISMO XML Export ────────────────────────────────────────────────────────

router.post('/cases/:caseId/export/mismo', (req, res) => {
  try {
    const body = parsePayload(mismoExportSchema, req.body || {}, res);
    if (!body) return;
    const result = generateMismo(req.params.caseId, body);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('api:export-mismo', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/export/mismo/mapping/:formType', (req, res) => {
  try {
    const mapping = getMismoFieldMapping(req.params.formType);
    res.json({ ok: true, mapping });
  } catch (err) {
    log.error('api:export-mismo-mapping', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Bundle ──────────────────────────────────────────────────────────────────

router.post('/cases/:caseId/export/bundle', (req, res) => {
  try {
    const body = parsePayload(bundleSchema, req.body || {}, res);
    if (!body) return;
    const bundle = createBundle(req.params.caseId, body);
    res.json({ ok: true, bundle });
  } catch (err) {
    log.error('api:export-bundle', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Export Jobs ──────────────────────────────────────────────────────────────

router.get('/cases/:caseId/export/jobs', (req, res) => {
  try {
    const jobs = listExportJobs(req.params.caseId, req.query);
    res.json({ ok: true, jobs });
  } catch (err) {
    log.error('api:export-jobs-list', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/cases/:caseId/export/jobs/:jobId', (req, res) => {
  try {
    const job = getExportJob(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: 'Export job not found' });
    res.json({ ok: true, job });
  } catch (err) {
    log.error('api:export-job-get', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/cases/:caseId/export/jobs/:jobId/cancel', (req, res) => {
  try {
    const job = cancelExportJob(req.params.jobId);
    res.json({ ok: true, job });
  } catch (err) {
    log.error('api:export-job-cancel', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/cases/:caseId/export/jobs/:jobId/manifest', (req, res) => {
  try {
    const manifest = getPdfPageManifest(req.params.caseId, req.query.formType || '1004');
    res.json({ ok: true, manifest });
  } catch (err) {
    log.error('api:export-manifest', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Delivery ────────────────────────────────────────────────────────────────

router.post('/cases/:caseId/export/deliver', (req, res) => {
  try {
    const body = parsePayload(deliverSchema, req.body || {}, res);
    if (!body) return;
    const delivery = createDeliveryRecord(body.exportJobId, body);
    res.json({ ok: true, delivery });
  } catch (err) {
    log.error('api:export-deliver', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.get('/cases/:caseId/export/deliveries', (req, res) => {
  try {
    const deliveries = listDeliveries(req.params.caseId);
    res.json({ ok: true, deliveries });
  } catch (err) {
    log.error('api:export-deliveries', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/cases/:caseId/export/deliveries/:deliveryId/confirm', (req, res) => {
  try {
    const body = parsePayload(confirmDeliverySchema, req.body || {}, res);
    if (!body) return;
    const delivery = confirmDelivery(req.params.deliveryId, body.method);
    res.json({ ok: true, delivery });
  } catch (err) {
    log.error('api:export-delivery-confirm', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Export Summary ──────────────────────────────────────────────────────────

router.get('/cases/:caseId/export/summary', (req, res) => {
  try {
    const summary = getExportSummary(req.params.caseId);
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('api:export-summary', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Templates ───────────────────────────────────────────────────────────────

router.get('/export/templates', (req, res) => {
  try {
    const templates = listTemplates(req.query);
    res.json({ ok: true, templates });
  } catch (err) {
    log.error('api:export-templates-list', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/export/templates', (req, res) => {
  try {
    const body = parsePayload(createTemplateSchema, req.body || {}, res);
    if (!body) return;
    const template = createTemplate(body);
    res.json({ ok: true, template });
  } catch (err) {
    log.error('api:export-template-create', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put('/export/templates/:templateId', (req, res) => {
  try {
    const body = parsePayload(updateTemplateSchema, req.body || {}, res);
    if (!body) return;
    const template = updateTemplate(req.params.templateId, body);
    res.json({ ok: true, template });
  } catch (err) {
    log.error('api:export-template-update', { error: err.message });
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
