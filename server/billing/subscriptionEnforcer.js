/**
 * server/billing/subscriptionEnforcer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Subscription Enforcement at Runtime
 *
 * Tiers:
 *   free:       5 generations/month, 1004 only, no export
 *   starter:    50 generations/month, 1004+1025, PDF export
 *   pro:        500 generations/month, all forms, all exports, priority support
 *   enterprise: unlimited, all forms, API access, white-label, dedicated support
 *
 * Enforces subscription limits, tracks usage, validates form/export access.
 */

import { getDb } from '../db/database.js';
import log from '../logger.js';

// ── Tier Limits ───────────────────────────────────────────────────────────────

export const TIER_LIMITS = {
  free: {
    generationsPerMonth: 5,
    forms: ['1004'],
    exports: [],
    aiPriority: 'low',
    maxConcurrentGeneration: 1,
  },
  starter: {
    generationsPerMonth: 50,
    forms: ['1004', '1025'],
    exports: ['pdf'],
    aiPriority: 'normal',
    maxConcurrentGeneration: 2,
  },
  pro: {
    generationsPerMonth: 500,
    forms: ['1004', '1025', '1073', 'uad36'],
    exports: ['pdf', 'xml', 'mismo'],
    aiPriority: 'high',
    maxConcurrentGeneration: 5,
  },
  enterprise: {
    generationsPerMonth: Infinity,
    forms: ['*'],
    exports: ['*'],
    aiPriority: 'highest',
    maxConcurrentGeneration: Infinity,
  },
};

// ── Subscription Status ────────────────────────────────────────────────────────

/**
 * Get current subscription status for a user.
 * Returns: { tier, plan, status, generationCount, limit, remaining, renewalDate, isOverQuota }
 */
export function getSubscriptionStatus(userId) {
  const db = getDb();

  const sub = db.prepare(`
    SELECT plan, status, reports_this_month, reports_limit,
           current_period_end, created_at
    FROM subscriptions
    WHERE user_id = ?
  `).get(userId);

  if (!sub) {
    return {
      tier: 'free',
      plan: 'free',
      status: 'inactive',
      generationCount: 0,
      limit: 5,
      remaining: 5,
      isOverQuota: false,
      renewalDate: null,
    };
  }

  const plan = sub.plan || 'free';
  const limits = TIER_LIMITS[plan] || TIER_LIMITS.free;
  const generationCount = sub.reports_this_month || 0;
  const limit = limits.generationsPerMonth;
  const remaining = Math.max(0, limit - generationCount);
  const isOverQuota = generationCount >= limit && limit !== Infinity;

  return {
    tier: plan,
    plan,
    status: sub.status,
    generationCount,
    limit,
    remaining,
    isOverQuota,
    renewalDate: sub.current_period_end,
    createdAt: sub.created_at,
  };
}

// ── Generation Quota Checks ────────────────────────────────────────────────────

/**
 * Check if user has remaining generation quota for this month.
 * Returns true if allowed, false if over quota.
 */
export function checkGenerationQuota(userId) {
  const status = getSubscriptionStatus(userId);
  return !status.isOverQuota;
}

/**
 * Increment generation count for a user (called after successful generation).
 */
export function incrementGenerationCount(userId) {
  const db = getDb();
  db.prepare(`
    UPDATE subscriptions
    SET reports_this_month = reports_this_month + 1,
        updated_at = datetime('now')
    WHERE user_id = ?
  `).run(userId);

  log.info('subscription:generation-counted', { userId });
}

/**
 * Reset monthly generation count (called on monthly renewal).
 */
export function resetMonthlyQuota(userId) {
  const db = getDb();
  db.prepare(`
    UPDATE subscriptions
    SET reports_this_month = 0,
        current_period_start = datetime('now'),
        current_period_end = datetime('now', '+30 days'),
        updated_at = datetime('now')
    WHERE user_id = ?
  `).run(userId);

  log.info('subscription:monthly-quota-reset', { userId });
}

// ── Form & Export Access ───────────────────────────────────────────────────────

/**
 * Check if a user's tier allows a specific form type.
 * Returns true if allowed, false otherwise.
 */
export function isFormAllowed(userId, formType) {
  const status = getSubscriptionStatus(userId);
  const limits = TIER_LIMITS[status.tier] || TIER_LIMITS.free;

  if (limits.forms.includes('*')) return true;
  return limits.forms.includes(formType);
}

/**
 * Check if a user's tier allows a specific export format.
 * Returns true if allowed, false otherwise.
 */
export function isExportAllowed(userId, exportType) {
  const status = getSubscriptionStatus(userId);
  const limits = TIER_LIMITS[status.tier] || TIER_LIMITS.free;

  if (limits.exports.includes('*')) return true;
  return limits.exports.includes(exportType);
}

// ── Express Middleware ─────────────────────────────────────────────────────────

/**
 * Middleware factory that enforces subscription tier access.
 * Usage: router.post('/generate', enforceSubscription('pro'), handler)
 *
 * @param {string} requiredTier - Minimum tier required ('free', 'starter', 'pro', 'enterprise')
 * @returns Express middleware function
 */
export function enforceSubscription(requiredTier = 'free') {
  const tierOrder = ['free', 'starter', 'pro', 'enterprise'];
  const requiredIndex = tierOrder.indexOf(requiredTier);

  return (req, res, next) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        error: 'Authentication required',
      });
    }

    const status = getSubscriptionStatus(userId);
    const userIndex = tierOrder.indexOf(status.tier);

    if (userIndex < requiredIndex) {
      return res.status(403).json({
        ok: false,
        code: 'SUBSCRIPTION_TIER_REQUIRED',
        error: `${requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)} subscription required`,
        currentTier: status.tier,
        requiredTier,
      });
    }

    // Attach subscription status to request for downstream use
    req.subscription = status;
    next();
  };
}

/**
 * Middleware that checks monthly generation quota.
 * Returns 429 (Too Many Requests) if quota exceeded.
 */
export function enforceGenerationQuota(req, res, next) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({
      ok: false,
      error: 'Authentication required',
    });
  }

  if (!checkGenerationQuota(userId)) {
    const status = getSubscriptionStatus(userId);
    return res.status(429).json({
      ok: false,
      code: 'QUOTA_EXCEEDED',
      error: 'Monthly generation quota exceeded',
      used: status.generationCount,
      limit: status.limit,
      renewalDate: status.renewalDate,
    });
  }

  req.subscription = getSubscriptionStatus(userId);
  next();
}

/**
 * Middleware that validates form type access.
 * Usage: router.post('/generate/1025', enforceFormAccess('1025'), handler)
 */
export function enforceFormAccess(formType) {
  return (req, res, next) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    if (!isFormAllowed(userId, formType)) {
      const status = getSubscriptionStatus(userId);
      return res.status(403).json({
        ok: false,
        code: 'FORM_NOT_ALLOWED',
        error: `Form ${formType} not available in ${status.tier} tier`,
        currentTier: status.tier,
        availableForms: TIER_LIMITS[status.tier].forms,
      });
    }

    next();
  };
}

/**
 * Middleware that validates export type access.
 * Usage: router.get('/case/:id/export/xml', enforceExportAccess('xml'), handler)
 */
export function enforceExportAccess(exportType) {
  return (req, res, next) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    if (!isExportAllowed(userId, exportType)) {
      const status = getSubscriptionStatus(userId);
      return res.status(403).json({
        ok: false,
        code: 'EXPORT_NOT_ALLOWED',
        error: `${exportType.toUpperCase()} export not available in ${status.tier} tier`,
        currentTier: status.tier,
        availableExports: TIER_LIMITS[status.tier].exports,
      });
    }

    next();
  };
}

// ── Usage Summary ──────────────────────────────────────────────────────────────

/**
 * Get comprehensive usage summary for a user.
 * Includes quota, remaining, tier info, and feature access.
 */
export function getUsageSummary(userId) {
  const status = getSubscriptionStatus(userId);
  const limits = TIER_LIMITS[status.tier] || TIER_LIMITS.free;

  return {
    subscription: {
      tier: status.tier,
      status: status.status,
      createdAt: status.createdAt,
      renewalDate: status.renewalDate,
    },
    quota: {
      used: status.generationCount,
      limit: status.limit,
      remaining: status.remaining,
      percentUsed: status.limit === Infinity ? 0 : Math.round((status.generationCount / status.limit) * 100),
      isOverQuota: status.isOverQuota,
    },
    features: {
      forms: limits.forms,
      exports: limits.exports,
      aiPriority: limits.aiPriority,
      maxConcurrentGeneration: limits.maxConcurrentGeneration,
    },
  };
}

export default {
  TIER_LIMITS,
  getSubscriptionStatus,
  checkGenerationQuota,
  incrementGenerationCount,
  resetMonthlyQuota,
  isFormAllowed,
  isExportAllowed,
  enforceSubscription,
  enforceGenerationQuota,
  enforceFormAccess,
  enforceExportAccess,
  getUsageSummary,
};
