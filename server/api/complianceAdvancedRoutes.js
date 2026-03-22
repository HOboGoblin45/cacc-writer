/**
 * server/api/complianceAdvancedRoutes.js
 * Multi-regulation compliance check + e-signature wiring.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { runComplianceCheck, REGULATIONS } from '../compliance/regulatoryCompliance.js';

const router = Router();

// GET /regulations — list all supported regulations
router.get('/regulations', (_req, res) => {
  const regs = Object.entries(REGULATIONS).map(([id, r]) => ({ id, label: r.label, checkCount: r.checks.length }));
  res.json({ ok: true, regulations: regs });
});

// POST /cases/:id/compliance-check — full multi-regulation check
router.post('/cases/:id/compliance-check', authMiddleware, (req, res) => {
  try {
    const result = runComplianceCheck(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

export default router;
