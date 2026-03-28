/**
 * server/api/billingPortalRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Customer Portal API Routes
 *
 * Endpoints:
 *   POST   /api/billing/portal
 *   GET    /api/billing/history
 *   POST   /api/billing/cancel
 *   POST   /api/billing/reactivate
 *   POST   /api/billing/upgrade
 *   POST   /api/billing/promo
 *   GET    /api/billing/usage
 *   GET    /api/billing/features
 */

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/authMiddleware.js';
import {
  createPortalSession,
  getCustomerBillingHistory,
  cancelSubscription,
  reactivateSubscription,
  applyPromoCode,
  getUpgradePreview,
  isStripeConfigured,
} from '../billing/customerPortal.js';
import {
  getUsageOverage,
  canAccessFeature,
  getAvailableFeatures,
  getTierInfo,
  getTrialStatus,
} from '../billing/pricingEngine.js';
import { getSubscriptionStatus, getUsageSummary } from '../billing/subscriptionEnforcer.js';
import { getMonthlyUsage } from '../billing/usageTracker.js';
import { validateBody } from '../middleware/validateRequest.js';
import log from '../logger.js';

const router = Router();

// ── Validation Schemas ─────────────────────────────────────────────────────────

const portalSchema = z.object({
  returnUrl: z.string().url().optional(),
});

const cancelSchema = z.object({
  reason: z.string().optional(),
  feedback: z.string().optional(),
});

const reactivateSchema = z.object({});

const upgradeSchema = z.object({
  newTier: z.enum(['starter', 'pro', 'enterprise']),
  newPriceId: z.string(),
});

const promoSchema = z.object({
  code: z.string().min(1).max(50),
});

// ── Stripe Configuration Guard ─────────────────────────────────────────────────

function requireStripe(req, res, next) {
  if (!isStripeConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'Billing not configured',
      code: 'BILLING_NOT_CONFIGURED',
    });
  }
  next();
}

// ── POST /api/billing/portal ───────────────────────────────────────────────────
// Create Stripe Customer Portal session

router.post('/portal', authMiddleware, requireStripe, validateBody(portalSchema), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { returnUrl } = req.validated;

    const result = await createPortalSession(userId, returnUrl);

    log.info('billing:portal-session-created', { userId });
    res.json({ ok: true, portalUrl: result.portalUrl });
  } catch (err) {
    log.error('billing:portal-error', { error: err.message, userId: req.user.userId });
    res.status(400).json({
      ok: false,
      error: err.message,
      code: 'PORTAL_ERROR',
    });
  }
});

// ── GET /api/billing/history ───────────────────────────────────────────────────
// Get invoice history with pagination

router.get('/history', authMiddleware, requireStripe, (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = getCustomerBillingHistory(userId, { limit, offset });

    log.info('billing:history-retrieved', { userId, count: result.invoices.length });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('billing:history-error', { error: err.message, userId: req.user.userId });
    res.status(400).json({
      ok: false,
      error: err.message,
      code: 'HISTORY_ERROR',
    });
  }
});

// ── POST /api/billing/cancel ───────────────────────────────────────────────────
// Cancel subscription with feedback

router.post('/cancel', authMiddleware, requireStripe, validateBody(cancelSchema), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reason, feedback } = req.validated;

    const result = await cancelSubscription(userId, reason, feedback);

    log.info('billing:cancel-requested', { userId, reason });
    res.json({
      ok: true,
      message: 'Subscription cancelled. You will have access until the end of your billing cycle.',
    });
  } catch (err) {
    log.error('billing:cancel-error', { error: err.message, userId: req.user.userId });
    res.status(400).json({
      ok: false,
      error: err.message,
      code: 'CANCEL_ERROR',
    });
  }
});

// ── POST /api/billing/reactivate ───────────────────────────────────────────────
// Reactivate canceled subscription

router.post('/reactivate', authMiddleware, requireStripe, validateBody(reactivateSchema), async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await reactivateSubscription(userId);

    log.info('billing:reactivate-requested', { userId });
    res.json({
      ok: true,
      message: 'Subscription reactivated. Cancellation has been reversed.',
    });
  } catch (err) {
    log.error('billing:reactivate-error', { error: err.message, userId: req.user.userId });
    res.status(400).json({
      ok: false,
      error: err.message,
      code: 'REACTIVATE_ERROR',
    });
  }
});

// ── POST /api/billing/upgrade ──────────────────────────────────────────────────
// Get upgrade preview (proration)

router.post('/upgrade', authMiddleware, requireStripe, validateBody(upgradeSchema), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { newTier, newPriceId } = req.validated;

    const preview = await getUpgradePreview(userId, newTier, newPriceId);

    log.info('billing:upgrade-preview-generated', { userId, newTier });
    res.json({
      ok: true,
      upgrade: {
        newTier,
        proratedAmount: preview.proratedAmount,
        estimatedNewAmount: preview.estimatedNewAmount,
        effectiveDate: preview.effectiveDate,
      },
    });
  } catch (err) {
    log.error('billing:upgrade-error', { error: err.message, userId: req.user.userId });
    res.status(400).json({
      ok: false,
      error: err.message,
      code: 'UPGRADE_ERROR',
    });
  }
});

// ── POST /api/billing/promo ────────────────────────────────────────────────────
// Apply promotional code

router.post('/promo', authMiddleware, requireStripe, validateBody(promoSchema), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { code } = req.validated;

    const result = await applyPromoCode(userId, code);

    if (!result.applied) {
      return res.status(400).json({
        ok: false,
        error: result.message,
        code: 'PROMO_INVALID',
      });
    }

    log.info('billing:promo-applied', { userId, code, discount: result.discount });
    res.json({
      ok: true,
      message: result.message,
      discount: result.discount,
    });
  } catch (err) {
    log.error('billing:promo-error', { error: err.message, userId: req.user.userId });
    res.status(400).json({
      ok: false,
      error: err.message,
      code: 'PROMO_ERROR',
    });
  }
});

// ── GET /api/billing/usage ────────────────────────────────────────────────────
// Get current usage stats

router.get('/usage', authMiddleware, (req, res) => {
  try {
    const userId = req.user.userId;
    const subscription = getSubscriptionStatus(userId);
    const monthlyUsage = getMonthlyUsage(userId);
    const overage = getUsageOverage(userId);
    const trial = getTrialStatus(userId);

    res.json({
      ok: true,
      subscription: {
        tier: subscription.tier,
        status: subscription.status,
        renewalDate: subscription.renewalDate,
      },
      usage: {
        month: monthlyUsage.month,
        reportsGenerated: monthlyUsage.count,
        reportsLimit: subscription.limit,
        reportsRemaining: subscription.remaining,
        percentUsed: subscription.limit === Infinity ? 0 : Math.round((monthlyUsage.count / subscription.limit) * 100),
      },
      overage: {
        count: overage.overageCount || 0,
        costCents: overage.amountCents || 0,
        costDisplay: `$${((overage.amountCents || 0) / 100).toFixed(2)}`,
      },
      trial: trial ? {
        isActive: trial.status === 'active' && !trial.isExpired,
        daysRemaining: trial.daysRemaining,
        expiresAt: trial.expiresAt,
      } : null,
    });
  } catch (err) {
    log.error('billing:usage-error', { error: err.message, userId: req.user.userId });
    res.status(400).json({
      ok: false,
      error: err.message,
      code: 'USAGE_ERROR',
    });
  }
});

// ── GET /api/billing/features ──────────────────────────────────────────────────
// Get available features for current tier

router.get('/features', authMiddleware, (req, res) => {
  try {
    const userId = req.user.userId;
    const subscription = getSubscriptionStatus(userId);

    const features = getAvailableFeatures(subscription.tier);
    const tierInfo = getTierInfo(subscription.tier, userId);

    res.json({
      ok: true,
      tier: subscription.tier,
      tierInfo,
      features: {
        available: features,
        // Map features to readable names
        featureList: [
          { key: 'voice_training', enabled: features.includes('voice_training'), name: 'Voice Training' },
          { key: 'advanced_voice_engine', enabled: features.includes('advanced_voice_engine'), name: 'Advanced Voice Engine' },
          { key: 'pdf_export', enabled: features.includes('pdf_export'), name: 'PDF Export' },
          { key: 'docx_export', enabled: features.includes('docx_export'), name: 'DOCX Export' },
          { key: 'aci_insertion', enabled: features.includes('aci_insertion'), name: 'ACI Insertion' },
          { key: 'rq_insertion', enabled: features.includes('rq_insertion'), name: 'Real Quantum Insertion' },
          { key: 'qc_engine', enabled: features.includes('qc_engine'), name: 'QC Engine' },
          { key: 'comp_intelligence', enabled: features.includes('comp_intelligence'), name: 'Comp Intelligence' },
          { key: 'api_access', enabled: features.includes('api_access'), name: 'API Access' },
          { key: 'white_label', enabled: features.includes('white_label'), name: 'White Label' },
          { key: 'team_management', enabled: features.includes('team_management'), name: 'Team Management' },
          { key: 'automation', enabled: features.includes('automation'), name: 'Automation' },
          { key: 'dedicated_support', enabled: features.includes('dedicated_support'), name: 'Dedicated Support' },
        ],
      },
    });
  } catch (err) {
    log.error('billing:features-error', { error: err.message, userId: req.user.userId });
    res.status(400).json({
      ok: false,
      error: err.message,
      code: 'FEATURES_ERROR',
    });
  }
});

export default router;
