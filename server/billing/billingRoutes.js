/**
 * server/billing/billingRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Billing API routes: checkout, portal, webhooks.
 */

import { Router } from 'express';
import { authMiddleware } from '../auth/authService.js';
import { isStripeConfigured, createCheckoutSession, createPortalSession, handleWebhook } from './stripeService.js';
import express from 'express';

const router = Router();

// ── GET /billing/status ──────────────────────────────────────────────────────

router.get('/billing/status', (_req, res) => {
  res.json({
    ok: true,
    stripeConfigured: isStripeConfigured(),
    message: isStripeConfigured()
      ? 'Stripe billing is active'
      : 'Stripe not configured — set STRIPE_SECRET_KEY in .env to enable billing',
  });
});

// ── POST /billing/checkout ───────────────────────────────────────────────────

router.post('/billing/checkout', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!plan || !['starter', 'professional', 'enterprise'].includes(plan)) {
      return res.status(400).json({ ok: false, error: 'Invalid plan' });
    }
    const result = await createCheckoutSession(req.user.userId, plan);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /billing/portal ────────────────────────────────────────────────────

router.post('/billing/portal', authMiddleware, async (req, res) => {
  try {
    const result = await createPortalSession(req.user.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /billing/webhook ────────────────────────────────────────────────────
// Stripe sends raw body — must use express.raw() before JSON parsing

router.post('/billing/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const signature = req.headers['stripe-signature'];
      const result = await handleWebhook(req.body, signature);
      res.json(result);
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

export default router;
