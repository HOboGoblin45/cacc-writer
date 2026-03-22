/**
 * server/api/amcRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AMC integration routes: connection management + webhook receiver.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { registerConnection, getConnections, processWebhookOrder } from '../integrations/amcConnector.js';
import express from 'express';

const router = Router();

// GET /amc/connections — list user's AMC connections
router.get('/amc/connections', authMiddleware, (req, res) => {
  const connections = getConnections(req.user.userId);
  res.json({ ok: true, connections });
});

// POST /amc/connections — register new AMC connection
router.post('/amc/connections', authMiddleware, (req, res) => {
  try {
    const result = registerConnection(req.user.userId, req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /amc/webhook/:connectionId — receive order from AMC
// Uses raw body for signature verification
router.post('/amc/webhook/:connectionId',
  express.json({ limit: '5mb' }),
  async (req, res) => {
    try {
      const signature = req.headers['x-webhook-signature'] || req.headers['x-hub-signature-256'] || '';
      const result = await processWebhookOrder(req.params.connectionId, req.body, signature);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

// GET /amc/platforms — list supported AMC platforms
router.get('/amc/platforms', (_req, res) => {
  res.json({
    ok: true,
    platforms: [
      { id: 'mercury', name: 'Mercury Network', description: 'CoreLogic Mercury Network — most popular AMC platform', status: 'supported' },
      { id: 'reggora', name: 'Reggora', description: 'Modern appraisal management platform with REST API', status: 'supported' },
      { id: 'anow', name: 'Anow', description: 'Growing appraisal platform', status: 'supported' },
      { id: 'generic', name: 'Generic Webhook', description: 'Custom webhook receiver for any AMC', status: 'supported' },
    ],
  });
});

export default router;
