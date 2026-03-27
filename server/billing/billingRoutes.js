/**
 * server/billing/billingRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Billing API routes: checkout, portal, webhooks.
 */

import { Router } from 'express';
import { authMiddleware, getSubscription, checkReportQuota } from '../auth/authService.js';
import { isStripeConfigured, createCheckoutSession, createPortalSession, handleWebhook } from './stripeService.js';
import express from 'express';
import log from '../logger.js';

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
  if (!isStripeConfigured()) return res.status(503).json({ ok: false, error: 'Billing not configured' });
  try {
    const { plan } = req.body || {};
    log.info('billing:checkout-attempt', { plan, userId: req.user?.userId, userKeys: Object.keys(req.user || {}) });
    if (!plan || !['starter', 'professional', 'enterprise'].includes(plan)) {
      return res.status(400).json({ ok: false, error: 'Invalid plan' });
    }
    const result = await createCheckoutSession(req.user.userId, plan);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('billing:checkout-error', { error: err.message, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /billing/create-checkout-session (alias) ────────────────────────────

router.post('/billing/create-checkout-session', authMiddleware, async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ ok: false, error: 'Billing not configured' });
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

// ── GET /billing/subscription ─────────────────────────────────────────────────

router.get('/billing/subscription