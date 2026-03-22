/**
 * server/api/invoiceRoutes.js
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { createInvoice, renderInvoicePdf, markInvoicePaid, getUserInvoices, getOutstandingTotal } from '../billing/invoiceGenerator.js';

const router = Router();

// GET /invoices — list user's invoices
router.get('/invoices', authMiddleware, (req, res) => {
  const invoices = getUserInvoices(req.user.userId, { status: req.query.status });
  const outstanding = getOutstandingTotal(req.user.userId);
  res.json({ ok: true, invoices, ...outstanding });
});

// POST /cases/:caseId/invoice — create invoice for case
router.post('/cases/:caseId/invoice', authMiddleware, (req, res) => {
  try {
    const result = createInvoice(req.params.caseId, req.user.userId, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /invoices/:id/pdf — download invoice PDF
router.get('/invoices/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const pdf = await renderInvoicePdf(req.params.id);
    res.type('application/pdf').send(pdf);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /invoices/:id/paid — mark as paid
router.patch('/invoices/:id/paid', authMiddleware, (req, res) => {
  markInvoicePaid(req.params.id);
  res.json({ ok: true });
});

export default router;
