/**
 * server/billing/billingRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Billing API routes: checkout, portal, subscription status, webhooks.
 */

import { Router } from 'express';
import { authMiddleware, getSubscription, checkReportQuota } from '../auth/authService.js';
import { isStripeConfigured, createCheckoutSession, createPortalSession, handleWebhook } from './stripeService.js';
import express from 'express';
import log from '../logger.js';

const router = Router();

// ── Stripe configuration guard ──────────────────────────────────────────────
// Returns 503 for all billing endpoints when Stripe is not configured.

function requireStripe(req, res, next) {
  if (!isStripeConfigured()) {
    return res.status(503).json({
      error: 'Billing not configured',
      code: 'BILLING_NOT_CONFIGURED',
    });
  }
  next();
}

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

router.post('/billing/checkout', authMiddleware, requireStripe, async (req, res) => {
  try {
    const { plan } = req.body || {};
    log.info('billing:checkout-attempt', { plan, userId: req.user?.userId });
    if (!plan || !['starter', 'professional', 'enterprise'].includes(plan)) {
      return res.status(400).json({ ok: false, error: 'Invalid plan' });
    }
    const result = await createCheckoutSession(req.user.userId, plan);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('billing:checkout-error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /billing/create-checkout-session (alias) ────────────────────────────

router.post('/billing/create-checkout-session', authMiddleware, requireStripe, async (req, res) => {
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

// ── GET /billing/subscription ────────────────────────────────────────────────

router.get('/billing/subscription', authMiddleware, requireStripe, (req, res) => {
  try {
    const sub = getSubscription(req.user.userId);
    if (!sub) {
      return res.json({ ok: true, subscription: null, message: 'No subscription found' });
    }
    const quota = checkReportQuota(req.user.userId);
    res.json({
      ok: true,
      subscription: {
        plan: sub.plan,
        status: sub.status,
        reportsThisMonth: sub.reports_this_month,
        reportsLimit: sub.reports_limit,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
      },
      quota,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /billing/portal ──────────────────────────────────────────────────────

router.get('/billing/portal', authMiddleware, requireStripe, async (req, res) => {
  try {
    const result = await createPortalSession(req.user.userId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /billing/quota ───────────────────────────────────────────────────────

router.get('/billing/quota', authMiddleware, (req, res) => {
  try {
    const quota = checkReportQuota(req.user.userId);
    res.json({ ok: true, ...quota });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /billing/webhook ────────────────────────────────────────────────────
// Uses raw body parsing for Stripe signature verification.

router.post('/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: 'Billing not configured' });
  }
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }
    const result = await handleWebhook(req.body, sig);
    res.json(result);
  } catch (err) {
    log.error('billing:webhook-error', { error: err.message });
    res.status(400).json({ error: `Webhook error: ${err.message}` });
  }
});

export default router;
