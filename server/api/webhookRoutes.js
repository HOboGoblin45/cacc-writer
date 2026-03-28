/**
 * server/api/webhookRoutes.js
 * Outbound webhook management + white-label config routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authService.js';
import { validateBody, validateParams } from '../middleware/validateRequest.js';
import { registerEndpoint, getEndpoints, notifyUser } from '../integrations/webhookNotifier.js';
import { getWhitelabelConfig, setWhitelabelConfig, generateCssOverrides } from '../whitelabel/whitelabelService.js';

const router = Router();

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const registerWebhookBodySchema = z.object({
  url: z.string().url(),
  service: z.string().min(1),
});

const firmIdParamsSchema = z.object({
  firmId: z.string().min(1),
});

const setWhitelabelBodySchema = z.object({
  brandName: z.string().min(1).optional(),
  primaryColor: z.string().optional(),
  logoUrl: z.string().url().optional(),
});

// ── Webhook Endpoints ────────────────────────────────────────────────────────

router.get('/webhooks', authMiddleware, (req, res) => {
  res.json({ ok: true, endpoints: getEndpoints(req.user.userId) });
});

router.post('/webhooks', authMiddleware, validateBody(registerWebhookBodySchema), (req, res) => {
  try {
    const result = registerEndpoint(req.user.userId, req.validated);
    res.status(201).json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

router.post('/webhooks/test', authMiddleware, async (req, res) => {
  try {
    const results = await notifyUser(req.user.userId, {
      type: 'test', title: 'Test Notification', message: 'This is a test from Appraisal Agent.',
      priority: 'normal',
    });
    res.json({ ok: true, results });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Supported notification services ──────────────────────────────────────────

router.get('/webhooks/services', (_req, res) => {
  res.json({
    ok: true,
    services: [
      { id: 'slack', name: 'Slack', description: 'Send to a Slack channel', requiresUrl: true },
      { id: 'discord', name: 'Discord', description: 'Send to a Discord webhook', requiresUrl: true },
      { id: 'sms', name: 'SMS (Twilio)', description: 'Text message alerts', requiresConfig: true },
      { id: 'email', name: 'Email Alert', description: 'Quick email notifications', requiresConfig: true },
      { id: 'zapier', name: 'Zapier', description: 'Connect to 5000+ apps via Zapier', requiresUrl: true },
      { id: 'custom', name: 'Custom Webhook', description: 'Any HTTP endpoint', requiresUrl: true },
    ],
  });
});

// ── White-Label ──────────────────────────────────────────────────────────────

router.get('/whitelabel/:firmId', authMiddleware, validateParams(firmIdParamsSchema), (req, res) => {
  const config = getWhitelabelConfig(req.validatedParams.firmId);
  if (!config) return res.json({ ok: true, config: null, message: 'No white-label config. Enterprise tier required.' });
  res.json({ ok: true, config });
});

router.put('/whitelabel/:firmId', authMiddleware, validateParams(firmIdParamsSchema), validateBody(setWhitelabelBodySchema), (req, res) => {
  try {
    const config = setWhitelabelConfig(req.validatedParams.firmId, req.validated);
    res.json({ ok: true, config });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

router.get('/whitelabel/:firmId/css', validateParams(firmIdParamsSchema), (req, res) => {
  const config = getWhitelabelConfig(req.validatedParams.firmId);
  const css = generateCssOverrides(config);
  res.type('text/css').send(css);
});

export default router;
