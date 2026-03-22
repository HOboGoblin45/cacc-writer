/**
 * server/api/dataRoutes.js
 * Public records + data enrichment routes.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { pullPublicRecords } from '../data/publicRecordsService.js';

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

export default router;
