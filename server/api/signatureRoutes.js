/**
 * server/api/signatureRoutes.js
 * E-signature management + report signing endpoints.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { saveSignature, getSignatures, signReport, verifySignature, batchSign } from '../integrations/eSignature.js';

const router = Router();

// POST /signatures — upload a signature
router.post('/signatures', authMiddleware, (req, res) => {
  try {
    const result = saveSignature(req.user.userId, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// GET /signatures — list user's signatures
router.get('/signatures', authMiddleware, (req, res) => {
  res.json({ ok: true, signatures: getSignatures(req.user.userId) });
});

// POST /cases/:id/sign — sign a report
router.post('/cases/:id/sign', authMiddleware, (req, res) => {
  try {
    const result = signReport(req.user.userId, req.params.id, { ...req.body, ipAddress: req.ip });
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// GET /cases/:id/signature — verify signature
router.get('/cases/:id/signature', authMiddleware, (req, res) => {
  res.json({ ok: true, ...verifySignature(req.params.id) });
});

// POST /signatures/batch-sign — sign multiple reports
router.post('/signatures/batch-sign', authMiddleware, (req, res) => {
  const results = batchSign(req.user.userId, req.body.caseIds || [], { ...req.body, ipAddress: req.ip });
  res.json({ ok: true, results });
});

export default router;
