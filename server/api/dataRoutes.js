/**
 * server/api/dataRoutes.js
 * Public records + data enrichment routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { pullPublicRecords } from '../data/publicRecordsService.js';
import { verifyAddress, verifyCaseAddress, isUspsConfigured } from '../data/addressVerification.js';

const router = Router();

// POST /cases/:caseId/public-records — pull public records
router.post('/cases/:caseId/public-records', authMiddleware, async (req, res) => {
  try {
    const result = await pullPublicRecords(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /cases/:caseId/verify-address — verify + standardize subject address vs USPS
router.post('/cases/:caseId/verify-address', authMiddleware, async (req, res) => {
  try {
    const result = await verifyCaseAddress(req.params.caseId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /address/verify — standalone address verification (no case needed)
router.post('/address/verify', authMiddleware, async (req, res) => {
  try {
    const { street, unit, city, state, zip } = req.body;
    if (!street) return res.status(400).json({ ok: false, error: 'street is required' });
    const result = await verifyAddress({ street, unit, city, state, zip });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /address/usps-status — check if USPS API is configured
router.get('/address/usps-status', (_req, res) => {
  res.json({
    ok: true,
    uspsConfigured: isUspsConfigured(),
    note: isUspsConfigured()
      ? 'USPS Addresses 3.0 API is configured — full verification available'
      : 'USPS not configured. Set USPS_CLIENT_ID and USPS_CLIENT_SECRET in .env. Falling back to geocoder verification.',
  });
});

export default router;
