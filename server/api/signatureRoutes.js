/**
 * server/api/signatureRoutes.js
 * E-signature management + report signing endpoints.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateBody, validateParams, CommonSchemas } from '../middleware/validateRequest.js';
import { saveSignature, getSignatures, signReport, verifySignature, batchSign } from '../integrations/eSignature.js';

const router = Router();

// ── Zod Schemas ─────────────────────────────────────────────────────────────

const saveSignatureSchema = z.object({
  // Signature data payload
}).passthrough();

const signReportSchema = z.object({
  // Report signing payload
}).passthrough();

const batchSignSchema = z.object({
  caseIds: z.array(z.string().min(1)).optional().default([]),
}).passthrough();

// POST /signatures — upload a signature
router.post('/signatures', authMiddleware, validateBody(saveSignatureSchema), (req, res) => {
  try {
    const result = saveSignature(req.user.userId, req.validated);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// GET /signatures — list user's signatures
router.get('/signatures', authMiddleware, (req, res) => {
  res.json({ ok: true, signatures: getSignatures(req.user.userId) });
});

// POST /cases/:id/sign — sign a report
router.post('/cases/:id/sign', authMiddleware, validateParams(CommonSchemas.id), validateBody(signReportSchema), (req, res) => {
  try {
    const result = signReport(req.user.userId, req.validatedParams.id, { ...req.validated, ipAddress: req.ip });
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// GET /cases/:id/signature — verify signature
router.get('/cases/:id/signature', authMiddleware, validateParams(CommonSchemas.id), (req, res) => {
  res.json({ ok: true, ...verifySignature(req.validatedParams.id) });
});

// POST /signatures/batch-sign — sign multiple reports
router.post('/signatures/batch-sign', authMiddleware, validateBody(batchSignSchema), (req, res) => {
  const results = batchSign(req.user.userId, req.validated.caseIds, { ...req.validated, ipAddress: req.ip });
  res.json({ ok: true, results });
});

export default router;
