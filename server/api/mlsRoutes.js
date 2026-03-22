/**
 * server/api/mlsRoutes.js
 * MLS integration + AI comp selection endpoints.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { registerMlsConnection, searchComps, importListings, getListingHistory, MLS_PROVIDERS } from '../integrations/mlsConnector.js';
import { selectComps, recordCompPreference } from '../ai/compSelectionEngine.js';

const router = Router();

// GET /mls/providers
router.get('/mls/providers', (_req, res) => {
  res.json({ ok: true, providers: Object.entries(MLS_PROVIDERS).map(([k, v]) => ({ id: k, ...v })) });
});

// POST /mls/connections — register MLS connection
router.post('/mls/connections', authMiddleware, (req, res) => {
  try {
    const result = registerMlsConnection(req.user.userId, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /mls/:connectionId/search — search comps from MLS
router.post('/mls/:connectionId/search', authMiddleware, async (req, res) => {
  try {
    const results = await searchComps(req.params.connectionId, req.body);
    res.json({ ok: true, ...results });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /mls/:connectionId/import — bulk import listings
router.post('/mls/:connectionId/import', authMiddleware, (req, res) => {
  try {
    const result = importListings(req.params.connectionId, req.body.listings || []);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// GET /mls/:connectionId/history — listing history for an address
router.get('/mls/:connectionId/history', authMiddleware, (req, res) => {
  const history = getListingHistory(req.params.connectionId, req.query.address || '');
  res.json({ ok: true, history });
});

// POST /cases/:id/comp-selection — AI comp selection
router.post('/cases/:id/comp-selection', authMiddleware, async (req, res) => {
  try {
    const result = await selectComps(req.params.id, req.body);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// POST /cases/:id/comp-preference — record accept/reject
router.post('/cases/:id/comp-preference', authMiddleware, (req, res) => {
  recordCompPreference(req.user.userId, req.params.id, req.body.mlsNumber, req.body.action, req.body.reason);
  res.json({ ok: true });
});

export default router;
