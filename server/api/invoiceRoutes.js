/**
 * server/api/invoiceRoutes.js
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { createInvoice, renderInvoicePdf, markInvoicePaid, getUserInvoices, getOutstandingTotal } from '../billing/invoiceGenerator.js';

const router = Router();

// Zod schemas
const caseIdSchema = z.string().min(1, 'caseId is required');
const invoiceIdSchema = z.string().min(1, 'Invoice ID is required');
const invoiceBodySchema = z.object({}).strict();
const queryStatusSchema = z.object({
  status: z.string().optional(),
});

// Validation middleware
const validateParams = (schema) => (req, res, next) => {
  try {
    req.validatedParams = schema.parse(req.params);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

const validateBody = (schema) => (req, res, next) => {
  try {
    req.validated = schema.parse(req.body);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

const validateQuery = (schema) => (req, res, next) => {
  try {
    req.validatedQuery = schema.parse(req.query);
    next();
  } catch (err) {
    res.status(400).json({ ok: false, error: err.errors[0].message });
  }
};

// GET /invoices — list user's invoices
router.get('/invoices', authMiddleware, validateQuery(queryStatusSchema), (req, res) => {
  const invoices = getUserInvoices(req.user.userId, { status: req.validatedQuery.status });
  const outstanding = getOutstandingTotal(req.user.userId);
  res.json({ ok: true, invoices, ...outstanding });
});

// POST /cases/:caseId/invoice — create invoice for case
router.post('/cases/:caseId/invoice', authMiddleware, validateParams(z.object({ caseId: caseIdSchema })), validateBody(invoiceBodySchema), (req, res) => {
  try {
    const result = createInvoice(req.validatedParams.caseId, req.user.userId, req.validated);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /invoices/:id/pdf — download invoice PDF
router.get('/invoices/:id/pdf', authMiddleware, validateParams(z.object({ id: invoiceIdSchema })), async (req, res) => {
  try {
    const pdf = await renderInvoicePdf(req.validatedParams.id);
    res.type('application/pdf').send(pdf);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /invoices/:id/paid — mark as paid
router.patch('/invoices/:id/paid', authMiddleware, validateParams(z.object({ id: invoiceIdSchema })), (req, res) => {
  markInvoicePaid(req.validatedParams.id);
  res.json({ ok: true });
});

export default router;
